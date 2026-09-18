/*
===============================================================================

	animation-assets-loader.mjs

	Synthetic metadata definitions for the skeletal animation regression suite.
	Only replaces runtime JSON assets. Math, posing, animation evaluation,
	and weapon animation selection still execute the production source.
	Registered only inside the isolated Node test process; never in the app.

===============================================================================
*/

const prefix = 'cod2-test:animation-asset/';
const definitions = {
	fixture: {
		idleAnim: 'idle', fireAnim: 'fire', reloadAnim: 'reload',
		adsDownAnim: 'adsDown', adsUpAnim: 'adsUp',
	},
};

const assets = {
	weapons: definitions,
	dvars: { dvars: [] },
	stance: {}, // No stance interpolation is used by this suite.
};

/*
====================
resolve

Provide only the three imported metadata tables; leave source imports alone.
====================
*/
export function resolve( specifier, context, next ) {
	const match = /^@\/assets\/ui\/(weapons|dvars|stance)\.json$/.exec( specifier );
	if ( match ) {
		return { url: prefix + match[1], shortCircuit: true };
	}
	return next( specifier, context );
}

/*
====================
load

Return an ESM data fixture without retail files or network access.
====================
*/
export function load( url, context, next ) {
	if ( url.startsWith( prefix ) ) {
		const data = assets[url.slice( prefix.length )];
		if ( data === undefined ) throw new Error( 'Unknown synthetic animation asset: ' + url );
		return { format: 'module', source: `export default ${JSON.stringify( data )};`, shortCircuit: true };
	}
	return next( url, context );
}
