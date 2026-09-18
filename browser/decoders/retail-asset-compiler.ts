/*
===============================================================================

	retail-asset-compiler.ts

	Family dispatcher for requested assets, not a retail filename allowlist.

===============================================================================
*/


import type { RetailContext } from './retail-context.js';
import { assetName, imageURL } from './retail-names.js';

type Route = { kind: string; path: string; key: string; name?: string; face?: number };
type ReadTable = ( path: string ) => Promise<any>;

/*
====================
compileAsset

One canonical identity per job. Dynamic stage imports keep map/model/effect
code off the initial menu conversion path. Failure never seals the output.
====================
*/
export async function compileAsset( ctx: RetailContext, route: Route, readTable: ReadTable ) {
	const name = route.name ? assetName( route.name ) : '';
	ctx.progress( `Preparing ${route.kind}: ${name || route.path}` );
	switch ( route.kind ) {
		case 'map': {
			const { extractMap } = await import( './retail-world-stage.js' );
			await extractMap( ctx, name );
			break;
		}
		case 'model':
			await ctx.saveJson( route.path, await ctx.decodeModelAsync( assetName( name, 'xmodel' ) ) );
			break;
		case 'animation': {
			const { decodeXAnim } = await import( './retail-xanim.js' );
			await ctx.saveJson( route.path, decodeXAnim( await ctx.archives.read( `xanim/${assetName( name, 'xanim' )}` ) ) );
			break;
		}
		case 'material': {
			const { parseMaterialDefinition } = await import( './retail-materials.js' );
			const key = ctx.archives.has( `materials/${name}` ) ? name : name.replace( /\.tga$/i, '' );
			const definition = parseMaterialDefinition( await ctx.archives.read( `materials/${key}` ) );
			const image = definition.bindings.colorMap?.image;
			await ctx.saveJson( route.path, { definition, file: image ? imageURL( 'textures', image ) : null } );
			break;
		}
		case 'image':
			await ctx.saveFile( route.path, await ctx.texturePng( `images/${name}.iwi` ) );
			break;
		case 'normal':
		case 'cube': {
			const { decodeIwiToRgba, decodeIwiFaceToRgba } = await import( './retail-iwi.js' );
			const { encodePNG } = await import( './retail-png.js' );
			const raw = await ctx.archives.read( `images/${name}.iwi` );
			const decoded = route.kind === 'cube' ? decodeIwiFaceToRgba( raw, route.face! ) : decodeIwiToRgba( raw );
			if ( route.kind === 'normal' && raw[4] === 13 ) {
				// CoD2 DXT5 normal maps store X in alpha and Y in green.
				for ( let i = 0; i < decoded.rgba.length; i += 4 ) {
					const x = decoded.rgba[i + 3] / 127.5 - 1, y = decoded.rgba[i + 1] / 127.5 - 1;
					decoded.rgba[i] = decoded.rgba[i + 3];
					decoded.rgba[i + 2] = Math.round( ( Math.sqrt( Math.max( 0, 1 - x * x - y * y ) ) + 1 ) * 127.5 );
					decoded.rgba[i + 3] = 255;
				}
			}
			await ctx.saveFile( route.path, await encodePNG( decoded.width, decoded.height, decoded.rgba ) );
			break;
		}
		case 'ui-image': {
			const sources = await readTable( 'assets/ui/image-sources.json' );
			const filename = route.path.slice( 'assets/images/'.length );
			let source = Object.hasOwn( sources, filename ) ? sources[filename] : null;
			if ( !source ) {
				const alt = filename.startsWith( 'menu_' ) ? filename.slice( 5 ) : `menu_${filename}`;
				source = Object.hasOwn( sources, alt ) ? sources[alt] : null;
			}
			if ( !source ) throw new DOMException( `No UI image mapping: ${filename}`, 'NotFoundError' );
			const png = await ctx.texturePng( source );
			await ctx.saveFile( route.path, png );
			const altName = filename.startsWith( 'menu_' ) ? filename.slice( 5 ) : `menu_${filename}`;
			await ctx.saveFile( `assets/images/${altName}`, png );
			break;
		}
		case 'sound':
			await ctx.saveFile( route.path, await ctx.archives.read( route.path ) );
			break;
		case 'audio': {
			const { extractMovementAudio } = await import( './retail-audio-stage.js' );
			await extractMovementAudio( ctx );
			break;
		}
		case 'viewmodels':
		case 'characters': {
			const stages = await import( './retail-model-stage.js' );
			const weapons = await readTable( 'assets/ui/weapons.json' );
			await ( route.kind === 'viewmodels' ? stages.extractViewmodels : stages.extractPlayermodels )( ctx, weapons );
			break;
		}
		case 'effects': {
			const { extractWeaponEffects } = await import( './retail-effects-stage.js' );
			await extractWeaponEffects( ctx, await readTable( 'assets/ui/weapons.json' ) );
			break;
		}
		case 'mantle':
		case 'lightweights': {
			const stages = await import( './retail-metadata-stage.js' );
			await ( route.kind === 'mantle' ? stages.extractMantle : stages.extractLightmapWeights )( ctx );
			break;
		}
		default: throw new Error( `Unsupported compiler family: ${route.kind}` );
	}
	return ctx.finish();
}
