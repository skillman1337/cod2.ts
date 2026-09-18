/*
===============================================================================

	asset-routing.mjs

	Canonical asset identity shared by the service worker and compiler.
	No map, weapon or model allowlist. Decoder families, not retail filenames,
	define what can be requested.

===============================================================================
*/

import { safePath } from './storage.mjs';

export const COMPILER_VERSION = 1;

/*
====================
assetRoute

Aliases share the same committed unit, including first/third-person models.
A map unit owns its geometry, lightmaps and manifest; images remain global.
====================
*/
export function assetRoute( requested ) {
	safePath( requested );
	let path = requested;
	path = path.replace( /^(?:viewmodels|characters)\/(models|animations|textures)\//, 'assets/$1/' );
	let match;

	if ( ( match = /^maps\/([a-z0-9_][a-z0-9_-]*)\/(.+)$/i.exec( path ) ) ) {
		const name = match[1].toLowerCase();
		return { kind: 'map', name, key: `map/${name}`, path: `maps/${name}/${match[2]}` };
	}
	for ( const [folder, kind] of [['models', 'model'], ['animations', 'animation'], ['materials', 'material']] ) {
		if ( ( match = new RegExp( `^assets/${folder}/(.+)\\.json$` ).exec( path ) ) ) {
			const name = match[1].toLowerCase();
			return { kind, name, key: `${kind}/${name}`, path: `assets/${folder}/${name}.json` };
		}
	}
	for ( const [folder, kind] of [['textures', 'image'], ['normalmaps', 'normal']] ) {
		if ( ( match = new RegExp( `^assets/${folder}/(.+)\\.png$` ).exec( path ) ) ) {
			const name = match[1].toLowerCase();
			return { kind, name, key: `${kind}/${name}`, path: `assets/${folder}/${name}.png` };
		}
	}
	if ( ( match = /^assets\/cubemaps\/(.+)\/([0-5])\.png$/.exec( path ) ) ) {
		const name = match[1].toLowerCase(), face = Number( match[2] );
		return { kind: 'cube', name, face, key: `cube/${name}/${face}`, path: `assets/cubemaps/${name}/${face}.png` };
	}
	const catalogs = {
		'viewmodels/catalog.json': 'viewmodels',
		'characters/catalog.json': 'characters',
		'weaponfx/catalog.json': 'effects',
		'sound/movement.json': 'audio',
		'sound/weapons.json': 'audio',
		'sound/ambient.json': 'audio',
		'assets/gameplay/mantle.json': 'mantle',
		'assets/images/lightmap_weights.png': 'lightweights',
	};
	if ( Object.hasOwn( catalogs, path ) ) return { kind: catalogs[path], key: catalogs[path], path };
	if ( /^assets\/images\/.+\.png$/.test( path ) ) return { kind: 'ui-image', key: path, path };
	if ( /^sound\/.+\.(?:wav|mp3|ogg)$/i.test( path ) ) {
		path = path.toLowerCase();
		return { kind: 'sound', key: path, path };
	}
	throw new DOMException( `No decoder is registered for ${path}`, 'NotFoundError' );
}
