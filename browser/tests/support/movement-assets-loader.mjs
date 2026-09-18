/*
===============================================================================

	movement-assets-loader.mjs

	Synthetic metadata for the movement gait-cycle regression suite.
	Only replaces runtime JSON assets (surface names, stance tables).
	Movement cycle math executes the production source.
	Registered only inside the isolated Node test process; never in the app.

===============================================================================
*/

const prefix = 'cod2-test:movement-asset/';

const assets = {
	surfaces: {},
	stance: {},
};

/*
====================
resolve

Provide only the imported metadata tables; leave source imports alone.
====================
*/
export function resolve( specifier, context, next ) {
	const match = /^@\/assets\/ui\/(surfaces|stance)\.json$/.exec( specifier );
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
		if ( data === undefined ) throw new Error( 'Unknown synthetic movement asset: ' + url );
		return { format: 'module', source: `export default ${JSON.stringify( data )};`, shortCircuit: true };
	}
	return next( url, context );
}
