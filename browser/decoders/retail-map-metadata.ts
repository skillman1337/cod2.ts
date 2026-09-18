/*
===============================================================================

	retail-map-metadata.ts

	Demand-driven retail asset compilation. No retail content is bundled here.

===============================================================================
*/


import type { RetailContext } from './retail-context.js';
import { BspParser, LUMP_MODELS } from './retail-bsp.js';

/*
====================
stripScriptComments

Leave quoted strings intact. This is a literal reader, NOT a GSC interpreter.
====================
*/
export function stripScriptComments( text: string ): string {
	return text.replace( /"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, token => token.startsWith( '"' ) ? token : ' ' );
}

/*
====================
mapMetadata

Worldspawn and the selected map's script are authoritative. Unresolved script
expressions are reported; a different map's atmosphere is never substituted.
====================
*/
export async function mapMetadata( ctx: RetailContext, map: string, entities: Record<string, string>[], bsp: BspParser ) {
	const world = entities.find( entity => entity.classname === 'worldspawn' ) || {};
	const vector = ( value: string | undefined, fallback: number[] ) => {
		const values = ( value || '' ).trim().split( /[\s,]+/ ).map( Number );
		return values.length === 3 && values.every( Number.isFinite ) ? values : fallback;
	};
	const angles = vector( world.sundirection, [0, 0, 0] ).map( value => value * Math.PI / 180 );
	const color = vector( world.suncolor, [1, 1, 1] );
	const peak = Math.max( ...color );
	const maximum = peak > 0 ? peak : 1;
	const intensity = Number( world.sunlight || 1 );
	// Native AngleVectors convention, not a map-specific sign/hemisphere flip.
	const sun = {
		direction: [Math.cos( angles[0] ) * Math.cos( angles[1] ), Math.cos( angles[0] ) * Math.sin( angles[1] ), -Math.sin( angles[0] )],
		color: color.map( value => value / maximum * ( Number.isFinite( intensity ) ? intensity : 1 ) ),
	};
	if ( world.ambient || world.diffusefraction || world.sundiffusecolor ) {
		ctx.log( `LIMITATION ${map}: directional light is derived from worldspawn; ambient/diffuse mixing is not a complete native material implementation.` );
	}
	let script = '';
	const filename = `maps/mp/${map}.gsc`;
	if ( ctx.archives.has( filename ) ) script = stripScriptComments( await ctx.archives.readText( filename, 'windows-1252' ) );
	const nationalities: Record<string, string> = {};
	for ( const side of ['allies', 'axis'] ) {
		const literal = new RegExp( `game\\s*\\[\\s*"${side}"\\s*\\]\\s*=\\s*"([^"]+)"`, 'i' ).exec( script );
		if ( literal ) nationalities[side] = literal[1].toLowerCase();
		else ctx.log( `UNRESOLVED ${filename}: game["${side}"]; GSC execution is not implemented.` );
	}
	// Retail setExpFog(density, red, green, blue, transitionTime). The renderer
	// uses density in .x and RGB in .yzw; do not treat density as a start distance.
	let fog = [0, 0, 0, 0];
	const exponential = /setExpFog\s*\(\s*([^;)]+)\)/i.exec( script );
	if ( exponential ) {
		const values = exponential[1].split( ',' ).map( value => Number( value.trim() ) );
		if ( values.length === 5 && values.every( Number.isFinite ) && values[0] >= 0 && values[0] < 1 ) fog = values.slice( 0, 4 );
		else ctx.log( `UNRESOLVED ${filename}: non-literal fog expression.` );
	}
	const model = bsp.getLump( LUMP_MODELS );
	let bounds: number[] | undefined;
	if ( model.length >= 24 ) {
		const view = new DataView( model.buffer, model.byteOffset, model.byteLength );
		bounds = Array.from( { length: 6 }, ( _, i ) => view.getFloat32( i * 4, true ) );
		if ( !bounds.every( Number.isFinite ) ) throw new Error( `Invalid world bounds in ${map}.` );
	}
	if ( !world.sundirection ) ctx.log( `UNRESOLVED ${map}: no worldspawn sundirection; neutral lighting used.` );
	return { sun, fog, nationalities, bounds, metadata_source: 'worldspawn-and-script-literals-v1' };
}
