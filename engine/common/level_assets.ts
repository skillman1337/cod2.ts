/*
===============================================================================

	level_assets.ts

	Validated, asynchronous map data loading. The server owns transition tickets;
	this module owns asset IO and never commits a stale level.

===============================================================================
*/

import { Asset_Fetch } from './asset_paths.js';
import type { level_manifest_t } from './level.js';
import mantleCurves from '@/assets/ui/mantle.json';

/**
 * @exec helper
 * ================
 * Level_LoadAssets
 *
 * Missing or truncated content is a load error, not a silently shortened world.
 * Legacy caches already contain mantle curves; menu-first caches hydrate them
 * before simulation can start. The imported object retains its identity.
 * ================
 */
export async function Level_LoadAssets( map: string ) {
	if ( !/^[a-z0-9_][a-z0-9_-]*$/.test( map ) ) throw new Error( 'Invalid map name.' );
	const base = '/maps/' + map + '/';
	const response = await Asset_Fetch( base + 'manifest.json' );
	if ( !response.ok ) throw new Error( 'Map manifest: ' + await response.text() );
	const manifest = await response.json() as level_manifest_t;
	manifest.name ??= ( manifest as any ).map ?? map;
	manifest.vertex_stride ??= 72;
	manifest.world ??= 'world.bin';
	manifest.sun ??= { direction: [0, 0, -1], color: [1, 1, 1] };
	manifest.fog ??= [0, 0, 0, 0];
	manifest.nationalities ??= {};
	manifest.sky ??= [];
	if ( manifest.name !== map || manifest.vertex_stride !== 72 || !/^[a-z0-9_.-]+$/i.test( manifest.world ) ) throw new Error( 'Invalid map manifest.' );
	const geometry = await Asset_Fetch( base + manifest.world );
	if ( !geometry.ok ) throw new Error( 'Map geometry: ' + await geometry.text() );
	const vertices = await geometry.arrayBuffer();
	manifest.vertices ??= vertices.byteLength / 72;
	if ( !Number.isSafeInteger( manifest.vertices ) || manifest.vertices < 0 || vertices.byteLength !== manifest.vertices * 72 ) throw new Error( 'Truncated or misaligned map geometry.' );
	if ( Object.keys( mantleCurves ).length === 0 ) {
		const curves = await Asset_Fetch( '/assets/gameplay/mantle.json' );
		if ( !curves.ok ) throw new Error( 'Mantle metadata: ' + await curves.text() );
		Object.assign( mantleCurves, await curves.json() );
	}
	return { manifest, vertices, base };
}
