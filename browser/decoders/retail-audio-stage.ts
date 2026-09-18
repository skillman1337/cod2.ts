/*
===============================================================================

	retail-audio-stage.ts

	Demand-driven retail asset compilation. No retail content is bundled here.

===============================================================================
*/


import { stripScriptComments } from './retail-map-metadata.js';
import type { RetailContext } from './retail-context.js';
import { DEFAULT_SURFACES } from './retail-constants.js';
import type { SoundAliasRow } from './retail-contracts.js';

/*
====================
parseCSV

Quoted commas, escaped quotes, CRLF and empty fields are significant.
====================
*/
export function parseCSV( text: string ): string[][] {
	const rows: string[][] = [];
	let row: string[] = [], field = '', quoted = false;
	for ( let i = 0; i < text.length; i++ ) {
		const ch = text[i];
		if ( ch === '"' ) {
			if ( quoted && text[i + 1] === '"' ) { field += '"'; i++; }
			else quoted = !quoted;
		} else if ( !quoted && ( ch === ',' || ch === '\n' ) ) {
			row.push( field.trim() ); field = '';
			if ( ch === '\n' ) { rows.push( row ); row = []; }
		} else field += ch;
	}
	if ( quoted ) throw new Error( 'Unterminated quoted CSV field.' );
	if ( field || row.length ) { row.push( field.trim() ); rows.push( row ); }
	return rows;
}

/*
====================
soundEntry
====================
*/
export function soundEntry( _ctx: RetailContext, row: SoundAliasRow ) {
	return { url: '/' + row.soundPath.split( '/' ).map( encodeURIComponent ).join( '/' ), probability: row.probability,
		volumeMin: row.volumeMin, volumeMax: row.volumeMax, pitchMin: row.pitchMin, pitchMax: row.pitchMax, loadspec: row.loadspec };
}

/*
====================
forEachSoundAlias

Blank names continue the preceding alias. Explicit zero is not a default value.
====================
*/
export async function forEachSoundAlias( ctx: RetailContext, visitor: ( row: SoundAliasRow ) => Promise<void> | void ): Promise<void> {
	for ( const filename of ctx.archives.allFilenames().filter( name => /^soundaliases\/.+\.csv$/i.test( name ) ).sort() ) {
		const rows = parseCSV( await ctx.archives.readText( filename, 'windows-1252' ) );
		const start = rows.findIndex( row => row[0]?.replace( /^\uFEFF/, '' ).toLowerCase() === 'name' );
		if ( start < 0 ) continue;
		const headers = rows[start].map( name => name.toLowerCase() );
		let previous = '';
		for ( const row of rows.slice( start + 1 ) ) {
			if ( row[0]?.startsWith( '#' ) || row[0]?.startsWith( '//' ) ) continue;
			const get = ( name: string ) => row[headers.indexOf( name )]?.trim() || '';
			const num = ( name: string, fallback = 1 ) => {
				const value = get( name );
				return value !== '' && Number.isFinite( Number( value ) ) ? Number( value ) : fallback;
			};
			const rawAlias = get( 'name' ) || previous, file = get( 'file' );
			if ( get( 'name' ) ) previous = get( 'name' );
			if ( !rawAlias || !file ) continue;
			await visitor( { rawAlias, alias: rawAlias.toLowerCase(), file,
				soundPath: 'sound/' + file.replaceAll( '\\', '/' ).replace( /^sound\//i, '' ),
				probability: num( 'probability' ), volumeMin: num( 'vol_min' ), volumeMax: num( 'vol_max', num( 'vol_min' ) ),
				pitchMin: num( 'pitch_min' ), pitchMax: num( 'pitch_max', num( 'pitch_min' ) ),
				loop: get( 'loop' ).toLowerCase() === 'looping', channel: get( 'channel' ) || 'local', loadspec: get( 'loadspec' ) } );
		}
	}
}

/*
====================
extractMovementAudio

Metadata only. A shared alias table covers all weapon/surface names; actual
sound bytes are copied solely in response to a sound URL request.
====================
*/
export async function extractMovementAudio( ctx: RetailContext ): Promise<void> {
	const aliases: Record<string, any[]> = Object.create( null ), ambient: Record<string, any[]> = Object.create( null );
	const maps: Record<string, string> = Object.create( null );
	for ( const filename of ctx.archives.allFilenames() ) {
		const match = /^maps\/mp\/([^/]+)\.gsc$/i.exec( filename );
		if ( !match ) continue;
		const text = stripScriptComments( await ctx.archives.readText( filename, 'windows-1252' ) );
		const name = /ambientPlay\s*\(\s*"([^"]+)"/i.exec( text )?.[1];
		if ( name ) maps[match[1].toLowerCase()] = name;
	}
	await forEachSoundAlias( ctx, row => {
		if ( !ctx.archives.has( row.soundPath ) ) { ctx.log( `MISSING sound alias ${row.rawAlias}: ${row.soundPath}` ); return; }
		( aliases[row.alias] ??= [] ).push( soundEntry( ctx, row ) );
		( ambient[row.rawAlias] ??= [] ).push( { url: soundEntry( ctx, row ).url, volume: row.volumeMin,
			loop: row.loop, channel: row.channel, loadspec: row.loadspec } );
	} );
	const movement = Object.fromEntries( Object.entries( aliases ).filter( ( [name] ) => /^(?:step_|land_|gear_rattle_)/.test( name ) ) );
	await ctx.saveJson( 'sound/movement.json', { surfaces: DEFAULT_SURFACES, aliases: movement } );
	await ctx.saveJson( 'sound/weapons.json', { aliases } );
	await ctx.saveJson( 'sound/ambient.json', { maps, aliases: ambient } );
}
