/*
===============================================================================

	retail-model-stage.ts

	Demand-driven retail asset compilation. No retail content is bundled here.

===============================================================================
*/


import type { RetailContext } from './retail-context.js';
import { CHARACTER_ANIMATION_MAPPINGS } from './retail-stage-constants.js';
import { assetName } from './retail-names.js';
import { stripScriptComments } from './retail-map-metadata.js';

type Weapons = Record<string, Record<string, string>>;

/*
====================
extractViewmodels

Catalogs are metadata. Each referenced model, animation and material has its own
request-time compiler; non-bullet weapon definitions are not discarded.
====================
*/
export async function extractViewmodels( ctx: RetailContext, weapons: Weapons ): Promise<void> {
	const catalog: Record<string, unknown> = Object.create( null );
	for ( const [name, weapon] of Object.entries( weapons ) ) {
		if ( !weapon.gunModel ) continue;
		catalog[name] = {
			gun: assetName( weapon.gunModel, 'xmodel' ),
			hands: weapon.handModel ? assetName( weapon.handModel, 'xmodel' ) : null,
		};
	}
	await ctx.saveJson( 'viewmodels/catalog.json', { weapons: catalog, materials: {} } );
}

/*
====================
extractPlayermodels

Discover body/head/attachment literals from the mounted character scripts.
Keep every discovered character ID; faction aliases are conveniences, not an
asset allowlist. Conditional scripts require the future GSC runtime.
====================
*/
export async function extractPlayermodels( ctx: RetailContext, weapons: Weapons ): Promise<void> {
	const characters: Record<string, any> = Object.create( null );
	const factions: Record<string, string[]> = Object.create( null );
	const scripts = ctx.archives.allFilenames().filter( name => /^(?:character|mptype)\/.+\.gsc$/i.test( name ) ).sort();
	for ( const path of scripts ) {
		const text = stripScriptComments( await ctx.archives.readText( path, 'windows-1252' ) );
		const body = /\bsetModel\s*\(\s*"([^"]+)"/i.exec( text )?.[1];
		if ( !body ) {
			ctx.log( `UNRESOLVED ${path}: no literal setModel; script not executed.` );
			continue;
		}
		const attachments = [...text.matchAll( /\battach\s*\(\s*"([^"]+)"/gi )].map( match => assetName( match[1], 'xmodel' ) );
		const id = path.replace( /^(?:character|mptype)\//i, '' ).replace( /\.gsc$/i, '' ).toLowerCase();
		characters[id] = {
			body: assetName( body, 'xmodel' ),
			head: attachments.find( name => /(^|\/)head_/.test( name ) ) || null,
			helmet: attachments.find( name => /(^|\/)helmet_/.test( name ) ) || null,
			attachments,
			script: path,
		};
		// Literal faction labels occur in archive identities; no per-map choices.
		const faction = /(?:^|_)(american|british|german|russian)(?:_|$)/i.exec( id )?.[1]?.toLowerCase();
		if ( faction ) ( factions[faction] ??= [] ).push( id );
	}
	for ( const [faction, ids] of Object.entries( factions ) ) characters[faction] = characters[ids[0]];
	const worldWeapons: Record<string, unknown> = Object.create( null );
	for ( const [id, weapon] of Object.entries( weapons ) ) {
		if ( weapon.worldModel ) worldWeapons[id] = { model: assetName( weapon.worldModel, 'xmodel' ) };
	}
	const animations = Object.fromEntries( Object.entries( CHARACTER_ANIMATION_MAPPINGS ).filter( ( [, name] ) => ctx.archives.has( `xanim/${name}` ) ) );
	await ctx.saveJson( 'characters/catalog.json', { characters, factions, weapons: worldWeapons, animations, materials: {}, default: null } );
	ctx.log( `Discovered ${scripts.length} character scripts; literal variants remain explicit in the catalog.` );
}
