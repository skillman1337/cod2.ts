/*
===============================================================================

	retail-effects-stage.ts

	Single-purpose retail conversion stage. All writes use the injected job context.

===============================================================================
*/

import { imageURL } from './retail-names.js';
import type { RetailContext } from './retail-context.js';
import { parseMaterialDefinition } from './retail-materials.js';

/*
====================
extractWeaponEffects
====================
*/
export async function extractWeaponEffects( ctx: RetailContext,  weapons: Record<string, Record<string, string>> ): Promise<void> {
		const parseEfx = ( raw: string ): any[] => {
			const lines = raw.split( /\r?\n/ ).map( ( s ) => s.split( '//' )[0].trim() ).filter( ( s ) => s.length > 0 );
			let i = 0;

			const block = ( end: string ): Record<string, any> => {
				const result: Record<string, any> = {};

				while ( i < lines.length && lines[i] !== end ) {
					const s = lines[i++];
					const parts = s.split( /\s+/ );
					const key = parts[0];
					let value: any;

					if ( i < lines.length && lines[i] === '{' ) {
						i++;
						value = block( '}' );
					} else if ( i < lines.length && lines[i] === '[' ) {
						i++;
						value = [];

						while ( i < lines.length && lines[i] !== ']' ) {
							value.push( lines[i++].split( /\s+/ ) );
						}
						i++;
					} else {
						value = parts.slice( 1 );
					}

					if ( ['Particle', 'OrientedParticle', 'Tail', 'Decal', 'Light', 'Emitter', 'Runner', 'Sound', 'Cylinder', 'Line', 'Cloud'].includes( key ) ) {
						result.children = result.children || [];
						result.children.push( { kind: key, ...value } );
						continue;
					}

					result[key] = value;
				}

				i++;
				return result;
			};

			const result: any[] = [];

			while ( i < lines.length ) {
				const kind = lines[i++];

				if ( i < lines.length && lines[i] === '{' ) {
					i++;
					result.push( { kind, ...block( '}' ) } );
				}
			}

			return result;
		};

		const names = new Set<string>();

		for ( const w of Object.values( weapons ) ) {
			for ( const [field, value] of Object.entries( w ) ) {
				if ( /Effect$/i.test( field ) && value ) names.add( value );
			}
		}

		const impacts: Record<string, Record<string, string>> = {};

		if ( ctx.archives.has( 'fx/iw_impacts.csv' ) ) {
			const impactsText = await ctx.archives.readText( 'fx/iw_impacts.csv', 'windows-1252' );

			for ( const line of impactsText.split( /\r?\n/ ) ) {
				const row = line.split( ',' ).map( ( s ) => s.trim() );

				if ( row.length >= 3 && row[0].startsWith( 'bullet_' ) ) {
					impacts[row[0]] = impacts[row[0]] || {};
					impacts[row[0]][row[1]] = row[2];

					if ( row[2] ) {
						names.add( row[2] );
					}
				}
			}
		}

		const effects: Record<string, any> = {};
		const materials: Record<string, any> = {};
		const pending = Array.from( names );

		const walk = ( parts: any[] ) => {
			for ( const part of parts ) {
				for ( const shader of part.shaders || [] ) {
					if ( shader[0] ) {
						materials[shader[0]] = null;
					}
				}

				for ( const field of ['emitfx', 'fx', 'playfx', 'impactfx', 'deathfx'] ) {
					for ( const ref of part[field] || [] ) {
						let value = ( ref[0] || '' ).replace( /^\/+/, '' );
						value = value.endsWith( '.efx' ) ? value : value + '.efx';

						if ( ctx.archives.has( value.toLowerCase() ) ) {
							pending.push( value );
						}
					}
				}

				if ( part.children ) {
					walk( part.children );
				}
			}
		};

		while ( pending.length > 0 ) {
			const name = pending.pop()!;

			if ( effects[name] ) {
				continue;
			}
			if ( !ctx.archives.has( name.toLowerCase() ) ) {
				continue;
			}

			try {
				const raw = await ctx.archives.readText( name, 'windows-1252' );
				const parts = parseEfx( raw );
				effects[name] = parts;
				walk( parts );
			} catch {
				// Ignore corrupted effect definition
			}
		}

		for ( const w of Object.values( weapons ) ) {
			for ( const field of ['reticleSide', 'reticleCenter'] ) {
				if ( w[field] ) {
					materials[w[field]] = null;
				}
			}
		}

		for ( const name of Object.keys( materials ) ) {
			const key = ctx.archives.has( ( 'materials/' + name ).toLowerCase() ) ? name : name.replace( /\.tga$/i, '' );

			if ( !ctx.archives.has( ( 'materials/' + key ).toLowerCase() ) ) {
				continue;
			}

			try {
				const raw = await ctx.archives.read( 'materials/' + key );
				const definition = parseMaterialDefinition( raw );
				( definition as any ).atlas = [raw[14], raw[15]];
				const color = definition.bindings.colorMap?.image;

				if ( !color ) {
					materials[name] = { definition };
					continue;
				}

				if ( ctx.archives.has( ( 'images/' + color + '.iwi' ).toLowerCase() ) ) {
					const file = imageURL( 'textures', color );
					materials[name] = { file, definition };
				} else {
					materials[name] = { definition };
				}
			} catch {
				// Continue on individual texture error
			}
		}

		await ctx.saveJson( 'weaponfx/catalog.json', { effects, impacts, materials } );
		ctx.log( `Exported ${Object.keys( effects ).length} weapon effects and ${Object.keys( materials ).length} weaponfx materials.` );
	}

