/*
===============================================================================

	deployment.mjs

	Deployment paths for the launcher, workers and persistent local storage.
	Root installs retain their existing cache names. Project sites are namespaced.

===============================================================================
*/

/*
====================
normalizeBase

Only an origin-relative directory is permitted; never an external asset host.
====================
*/
export function normalizeBase( value = '/' ) {
	if ( typeof value !== 'string' || !value.startsWith( '/' ) || /[\\%?#:\s]/.test( value ) || value.includes( '//' ) ) {
		throw new Error( 'COD2_BASE_PATH must be an origin-relative path, such as /cod2.ts/.' );
	}
	const parts = value.split( '/' ).filter( Boolean );
	if ( parts.some( part => part === '.' || part === '..' || !/^[a-z0-9_.-]+$/i.test( part ) ) ) {
		throw new Error( 'Unsafe deployment base path.' );
	}
	return parts.length ? '/' + parts.join( '/' ) + '/' : '/';
}

export const APP_BASE = normalizeBase( import.meta.env?.BASE_URL ?? '/' );
export const STORAGE_SUFFIX = APP_BASE === '/' ? '' : '-' + encodeURIComponent( APP_BASE ).replaceAll( '%', '_' );

export const BUILD_REVISION = typeof __BUILD_REVISION__ !== 'undefined'
	? __BUILD_REVISION__
	: ( import.meta.env?.VITE_BUILD_REVISION ?? null );

export const BUILD_COMPILER_VERSION = typeof __BUILD_COMPILER_VERSION__ !== 'undefined'
	? __BUILD_COMPILER_VERSION__
	: null;

export const BUILD_CACHE_VERSION = typeof __BUILD_CACHE_VERSION__ !== 'undefined'
	? __BUILD_CACHE_VERSION__
	: null;


/*
====================
appURL

Resolve app-owned code and navigation, not game asset identities.
====================
*/
export function appURL( path = '' ) {
	if ( typeof path !== 'string' || path.startsWith( '/' ) || /[\\\0]/.test( path ) || path.split( /[/?#]/ ).some( part => part === '.' || part === '..' ) ) {
		throw new Error( 'Expected an app-relative path.' );
	}
	return APP_BASE + path;
}
