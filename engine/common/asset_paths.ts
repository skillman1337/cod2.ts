/*
===============================================================================

	asset_paths.ts

	HTTP boundary for canonical local game asset paths. The host supplies its
	deployment directory before the engine is imported. No global fetch patch.

===============================================================================
*/

let assetBase = '/';
const LOCAL_ASSET = /^\/(?:__cod2_local|assets|maps|viewmodels|characters|weaponfx|sound)\//;

/**
 * @exec helper
 * ================
 * Asset_SetBase
 * ================
 */
export function Asset_SetBase( base: string ): void {
	if ( !/^\/(?:[a-z0-9_.-]+\/)*$/i.test( base ) || base.split( '/' ).some( part => part === '.' || part === '..' ) ) {
		throw new Error( 'Invalid local asset deployment base.' );
	}
	assetBase = base;
}

/**
 * @exec helper
 * ================
 * Asset_LocalURL
 *
 * Convert logical root paths at the IO boundary. Catalog identities stay
 * portable between localhost, a project site and a custom domain.
 * ================
 */
export function Asset_LocalURL( path: string ): string {
	if ( assetBase !== '/' && path.startsWith( assetBase ) ) return path;
	return LOCAL_ASSET.test( path ) ? assetBase + path.slice( 1 ) : path;
}

/**
 * @exec helper
 * ================
 * Asset_Fetch
 *
 * Already-resolved URLs and Request objects retain normal fetch semantics.
 * Only same-origin logical asset routes receive the application prefix.
 * ================
 */
export function Asset_Fetch( input: RequestInfo | URL, init?: RequestInit ): Promise<Response> {
	if ( typeof input === 'string' && input.startsWith( '/' ) ) {
		return fetch( Asset_LocalURL( input ), init );
	}
	if ( typeof location !== 'undefined' ) {
		const url = new URL( typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href );
		if ( url.origin === location.origin ) {
			const pathname = Asset_LocalURL( url.pathname );
			if ( pathname !== url.pathname ) {
				url.pathname = pathname;
				return fetch( input instanceof Request ? new Request( url, input ) : url, init );
			}
		}
	}
	return fetch( input, init );
}
