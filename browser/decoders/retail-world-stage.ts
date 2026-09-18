/*
===============================================================================

	retail-world-stage.ts

	Single-purpose retail conversion stage. All writes use the injected job context.

===============================================================================
*/

import { mapMetadata } from './retail-map-metadata.js';
import { imageURL } from './retail-names.js';
import type { RetailContext } from './retail-context.js';
import { BspParser, sampleLightGrid, LUMP_LIGHTMAPS, VERTEX_OUTPUT_STRIDE } from './retail-bsp.js';
import { poseModel, skinVertex } from './retail-model.js';
import { parseMaterialDefinition } from './retail-materials.js';
import { encodePNG } from './retail-png.js';
import { decodeIwiToRgba } from './retail-iwi.js';
import { concatByteArrays } from './retail-constants.js';
import { CONTENTS_SOLID_OR_OPAQUE, PROBE_INDEX_MASK, STATIC_MODEL_FLAG, LIGHTMAP_BLOCK_SIZE, LIGHTMAP_CHANNEL_SIZE, SUNMAP_OFFSET_IN_BLOCK, SUNMAP_CHANNEL_SIZE, LIGHTMAP_TEXTURE_DIMENSION, SUNMAP_TEXTURE_DIMENSION } from './retail-stage-constants.js';

/*
====================
extractMap
====================
*/
export async function extractMap( ctx: RetailContext, map: string ): Promise<void> {
		if ( !/^[a-z0-9_][a-z0-9_-]*$/.test( map ) ) throw new Error( 'Invalid map name.' );
		const bspPath = `maps/mp/${map}.d3dbsp`;

		if ( !ctx.archives.has( bspPath ) ) {
			throw new Error( `Required map archive entry not found: ${bspPath}` );
		}

		const bspRaw = await ctx.archives.read( bspPath );
		const bsp = new BspParser( bspRaw );

		const materials = bsp.parseMaterials();
		const skyMaterials = new Set<number>();
		const states: any[] = [];

		for ( let i = 0; i < materials.length; i++ ) {
			const mat = materials[i];

			if ( ctx.archives.has( `materials/${mat}` ) ) {
				const matBytes = await ctx.archives.read( `materials/${mat}` );
				const def = parseMaterialDefinition( matBytes );
				states.push( def.state );
				if ( /(^|_)sky($|_)/i.test( def.technique ) ) {
					skyMaterials.add( i );
				}
			} else {
				states.push( { src: 2, dst: 0, offset: 0, write: true, sort: 3 } );
			}
		}

		const { mesh, draws, usedMaterials } = bsp.buildWorldMesh( states, skyMaterials );
		const entities = bsp.parseEntities();

		const { collision, mantle } = bsp.parseCollision();
		const lightgrid = bsp.parseLightgrid();
		await ctx.saveJson( `maps/${map}/lightgrid.json`, lightgrid );

		const isBlocked = ( a: [number, number, number], b: [number, number, number] ): boolean => {
			const minX = Math.min( a[0], b[0] );
			const maxX = Math.max( a[0], b[0] );
			const minY = Math.min( a[1], b[1] );
			const maxY = Math.max( a[1], b[1] );
			const minZ = Math.min( a[2], b[2] );
			const maxZ = Math.max( a[2], b[2] );

			for ( const brush of collision ) {
				if ( !( brush.contents & CONTENTS_SOLID_OR_OPAQUE ) ) {
					continue;
				}

				const bb = brush.bounds;

				if ( maxX < bb[0] || minX > bb[1] || maxY < bb[2] || minY > bb[3] || maxZ < bb[4] || minZ > bb[5] ) {
					continue;
				}

				let enter = 0;
				let leave = 1;
				let separated = false;

				for ( const p of brush.planes ) {
					const d0 = p[0] * a[0] + p[1] * a[1] + p[2] * a[2] - p[3];
					const d1 = p[0] * b[0] + p[1] * b[1] + p[2] * b[2] - p[3];

					if ( d0 > 0 && d1 > 0 ) {
						separated = true;
						break;
					}
					if ( d0 === d1 ) {
						continue;
					}

					const f = d0 / ( d0 - d1 );

					if ( d0 > d1 ) {
						if ( f > enter ) {
							enter = f;
						}
					} else {
						if ( f < leave ) {
							leave = f;
						}
					}
				}

				if ( !separated && enter < leave && leave > 1e-5 && enter < 0.99999 ) {
					return true;
				}
			}

			return false;
		};

		const visible = ( a: [number, number, number], b: [number, number, number] ): boolean => !isBlocked( a, b );

		// Place static misc_model world entities (houses, roofs, doors, frames, props)

		const meshChunks: Uint8Array[] = [mesh];
		let currentVertexCount = Math.floor( mesh.byteLength / 72 );
		const probes: number[][][] = [];

		for ( const ent of entities ) {
			if ( ent.classname !== 'misc_model' || !ent.model || ent.model.startsWith( '*' ) ) {
				continue;
			}

			try {
				const asset = await ctx.decodeModelAsync( ent.model.replace( /^xmodel[\\/]/i, '' ).replaceAll( '\\', '/' ).toLowerCase() );
				const transforms = poseModel( asset );

				const anglesStr = ent.angles || `0 ${ent.angle || '0'} 0`;
				const [pitchDeg, yawDeg, rollDeg] = anglesStr.trim().split( /\s+/ ).map( Number );
				const pitch = ( ( pitchDeg || 0 ) * Math.PI ) / 180;
				const yaw = ( ( yawDeg || 0 ) * Math.PI ) / 180;
				const roll = ( ( rollDeg || 0 ) * Math.PI ) / 180;

				const cp = Math.cos( pitch );
				const sp = Math.sin( pitch );
				const cy = Math.cos( yaw );
				const sy = Math.sin( yaw );
				const cr = Math.cos( roll );
				const sr = Math.sin( roll );

				const axes: [number, number, number][] = [
					[cp * cy, cp * sy, -sp],
					[sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, sr * cp],
					[cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp],
				];

				const origin = ( ent.origin || '0 0 0' ).trim().split( /\s+/ ).map( Number );
				const scale = parseFloat( ent.modelscale || '1' ) || 1;
				const probeIndex = Math.min( PROBE_INDEX_MASK, probes.length );
				const positions: [number, number, number][] = [];

				const dirTransform = ( v: [number, number, number] ): [number, number, number] => [
					axes[0][0] * v[0] + axes[1][0] * v[1] + axes[2][0] * v[2],
					axes[0][1] * v[0] + axes[1][1] * v[1] + axes[2][1] * v[2],
					axes[0][2] * v[0] + axes[1][2] * v[1] + axes[2][2] * v[2],
				];

				for ( const surface of asset.surfaces ) {
					const matName = surface.material;
					let layer = materials.indexOf( matName );

					if ( layer < 0 ) {
						layer = materials.length;
						materials.push( matName );
						let state = { src: 2, dst: 0, offset: 0, write: true, sort: 3 };

						if ( ctx.archives.has( `materials/${matName}` ) ) {
							try {
								const mb = await ctx.archives.read( `materials/${matName}` );
								state = parseMaterialDefinition( mb ).state;
							} catch {
								// Fall back to default state
							}
						}
						states.push( state );
					}

					usedMaterials.add( layer );

					draws.push( {
						start: currentVertexCount,
						count: surface.indices.length,
						state: states[layer],
					} );

					const transformedVerts: { p: number[]; n: number[]; t: number[]; b: number[]; uv: number[] }[] = [];

					for ( const vert of surface.vertices ) {
						const skinned = skinVertex( vert, transforms );
						const pRot = dirTransform( skinned.position );
						const pWorld: [number, number, number] = [
							pRot[0] * scale + ( origin[0] || 0 ),
							pRot[1] * scale + ( origin[1] || 0 ),
							pRot[2] * scale + ( origin[2] || 0 ),
						];
						positions.push( pWorld );
						transformedVerts.push( {
							p: pWorld,
							n: dirTransform( skinned.normal ),
							t: dirTransform( skinned.tangent ),
							b: dirTransform( skinned.binormal ),
							uv: vert.uv,
						} );
					}

					const chunk = new Uint8Array( surface.indices.length * VERTEX_OUTPUT_STRIDE );
					const chunkView = new DataView( chunk.buffer );
					const extraWord = ( layer | ( ( STATIC_MODEL_FLAG | probeIndex ) << 16 ) ) >>> 0;

					for ( let j = 0; j < surface.indices.length; j++ ) {
						const idx = surface.indices[j];
						const v = transformedVerts[idx];
						const off = j * VERTEX_OUTPUT_STRIDE;

						chunkView.setFloat32( off, v.p[0], true );
						chunkView.setFloat32( off + 4, v.p[1], true );
						chunkView.setFloat32( off + 8, v.p[2], true );

						chunkView.setFloat32( off + 12, v.n[0], true );
						chunkView.setFloat32( off + 16, v.n[1], true );
						chunkView.setFloat32( off + 20, v.n[2], true );

						chunk[off + 24] = 255;
						chunk[off + 25] = 255;
						chunk[off + 26] = 255;
						chunk[off + 27] = 255;

						chunkView.setFloat32( off + 28, v.uv[0], true );
						chunkView.setFloat32( off + 32, v.uv[1], true );
						chunkView.setFloat32( off + 36, 0, true );
						chunkView.setFloat32( off + 40, 0, true );

						chunkView.setFloat32( off + 44, v.t[0], true );
						chunkView.setFloat32( off + 48, v.t[1], true );
						chunkView.setFloat32( off + 52, v.t[2], true );

						chunkView.setFloat32( off + 56, v.b[0], true );
						chunkView.setFloat32( off + 60, v.b[1], true );
						chunkView.setFloat32( off + 64, v.b[2], true );

						chunkView.setUint32( off + 68, extraWord, true );
					}

					meshChunks.push( chunk );
					currentVertexCount += surface.indices.length;
				}

				const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
				for ( const point of positions ) for ( let axis = 0; axis < 3; axis++ ) {
					mins[axis] = Math.min( mins[axis], point[axis] );
					maxs[axis] = Math.max( maxs[axis], point[axis] );
				}
				const center = positions.length ? mins.map( ( value, axis ) => ( value + maxs[axis] ) * 0.5 ) : origin;


				probes.push( sampleLightGrid( lightgrid, center as [number, number, number], visible ) );
			} catch ( err ) {
				throw new Error( `Map ${map}, static model ${ent.model}: ${String( err )}` );
			}
		}

		const finalMesh = concatByteArrays( meshChunks );

		await ctx.saveFile( `maps/${map}/world.bin`, finalMesh );

		// Decode textures for used materials
		const textureManifest: any[] = [];

		for ( let index = 0; index < materials.length; index++ ) {
			if ( !usedMaterials.has( index ) ) {
				textureManifest.push( null );
				continue;
			}

			const matName = materials[index];
			let entry: any = null;

			if ( ctx.archives.has( `materials/${matName}` ) ) {
				try {
					const matBytes = await ctx.archives.read( `materials/${matName}` );
					const def = parseMaterialDefinition( matBytes );
					const colImage = def.bindings.colorMap?.image;

					if ( colImage && ctx.archives.has( `images/${colImage}.iwi` ) ) {
						// The requesting renderer warms this global image once.
						entry = {
							file: imageURL( 'textures', colImage ),
							material: matName,
							image: colImage,
							bindings: def.bindings,
							technique: def.technique,
						};

						const normalImage = def.bindings.normalMap?.image;

						if ( normalImage && ctx.archives.has( `images/${normalImage}.iwi` ) ) {
							entry.normal = imageURL( 'normalmaps', normalImage );
						}
					}
				} catch ( error ) {
					throw new Error( `Material ${matName} in ${map}: ${String( error )}` );
				}
			}

			if ( !entry ) ctx.log( `No color image resolved for ${map}: ${matName}. Technique may be textureless or unsupported.` );
			textureManifest.push( entry );
		}

		// Sky cubemap faces
		const skyFiles: string[] = [];

		for ( const skyIndex of skyMaterials ) {
			const matName = materials[skyIndex];

			if ( ctx.archives.has( `materials/${matName}` ) ) {
				try {
					const matBytes = await ctx.archives.read( `materials/${matName}` );
					const def = parseMaterialDefinition( matBytes );
					const colImage = def.bindings.colorMap?.image;

					if ( colImage && ctx.archives.has( `images/${colImage}.iwi` ) ) {
						for ( let face = 0; face < 6; face++ ) {
							const skyName = `/assets/cubemaps/${colImage.split( '/' ).map( encodeURIComponent ).join( '/' )}/${face}.png`;
							skyFiles.push( skyName );
						}
						break;
					}
				} catch ( error ) {
					throw new Error( `Sky material ${matName} in ${map}: ${String( error )}` );
				}
			}
		}

		// Lightmaps from lump 1
		const lm = bsp.getLump( LUMP_LIGHTMAPS );
		const lightmaps: string[] = [];
		const sunmaps: string[] = [];
		const blockSize = LIGHTMAP_BLOCK_SIZE;
		if ( lm.length % blockSize !== 0 ) throw new Error( `Truncated lightmap blocks in ${map}` );
		const blockCount = lm.length / blockSize;

		for ( let block = 0; block < blockCount; block++ ) {
			for ( let channel = 0; channel < 3; channel++ ) {
				const offset = block * blockSize + channel * LIGHTMAP_CHANNEL_SIZE;
				const name = `lightmap_${block}_${channel}.png`;
				const bgra = lm.subarray( offset, offset + LIGHTMAP_CHANNEL_SIZE );

				// Convert BGRA 512x512 to RGBA
				const rgba = new Uint8Array( LIGHTMAP_TEXTURE_DIMENSION * LIGHTMAP_TEXTURE_DIMENSION * 4 );

				for ( let i = 0; i < LIGHTMAP_TEXTURE_DIMENSION * LIGHTMAP_TEXTURE_DIMENSION; i++ ) {
					rgba[i * 4] = bgra[i * 4 + 2];
					rgba[i * 4 + 1] = bgra[i * 4 + 1];
					rgba[i * 4 + 2] = bgra[i * 4];
					rgba[i * 4 + 3] = bgra[i * 4 + 3];
				}

				const png = await encodePNG( LIGHTMAP_TEXTURE_DIMENSION, LIGHTMAP_TEXTURE_DIMENSION, rgba );
				await ctx.saveFile( `maps/${map}/${name}`, png );
				lightmaps.push( name );
			}

			const sunOffset = block * blockSize + SUNMAP_OFFSET_IN_BLOCK;
			const sunName = `sunlight_${block}.png`;
			const sunL8 = lm.subarray( sunOffset, sunOffset + SUNMAP_CHANNEL_SIZE );
			const sunRgba = new Uint8Array( SUNMAP_TEXTURE_DIMENSION * SUNMAP_TEXTURE_DIMENSION * 4 );

			for ( let i = 0; i < SUNMAP_TEXTURE_DIMENSION * SUNMAP_TEXTURE_DIMENSION; i++ ) {
				const val = sunL8[i];
				sunRgba[i * 4] = val;
				sunRgba[i * 4 + 1] = val;
				sunRgba[i * 4 + 2] = val;
				sunRgba[i * 4 + 3] = 255;
			}

			const sunPng = await encodePNG( SUNMAP_TEXTURE_DIMENSION, SUNMAP_TEXTURE_DIMENSION, sunRgba );
			await ctx.saveFile( `maps/${map}/${sunName}`, sunPng );
			sunmaps.push( sunName );
		}

		const manifest = {
			name: map,
			map,
			vertices: Math.floor( finalMesh.byteLength / VERTEX_OUTPUT_STRIDE ),
			vertex_stride: VERTEX_OUTPUT_STRIDE,
			world: 'world.bin',
			draws: ( draws || [] ).slice().sort( ( a, b ) => ( a.state?.sort ?? 0 ) - ( b.state?.sort ?? 0 ) ),
			textures: textureManifest,
			lightmaps,
			sunmaps,
			sky: skyFiles,
			...await mapMetadata( ctx, map, entities, bsp ),
			entities,
			
			collision_adapter: 'capsule-triangle-distance-v1',
			collision,
			mantle,
			probes,
		};

		await ctx.saveJson( `maps/${map}/manifest.json`, manifest );
		ctx.log( `Extracted ${map} world mesh (${finalMesh.byteLength} bytes), ${collision.length} collision brushes, ${lightmaps.length} lightmaps.` );
	}

