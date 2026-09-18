/*
===============================================================================

	material_assets.ts

	Call of Duty 2 / id Tech Material Asset Resolver & Texture Loader
	Exported material-name to image resolver, shared by world and viewmodels.
	Resolves global material identity paths, catalog candidates, and loads ImageBitmaps.

===============================================================================
*/


import { Asset_Fetch } from './asset_paths.js';
import { Asset_MapJobs } from './asset_jobs.js';

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface material_source_t {
	/** URL of the owning catalog (not the directory of the requesting model). */
	url: string;
	materials: Record<string, { file?: string | null; definition?: unknown }>;
}

export interface material_candidate_t {
	url: string;
	material: string;
	catalog: string;
}

export interface material_io_t {
	fetch: typeof fetch;
	decode: ( blob: Blob ) => Promise<ImageBitmap>;
}


// ---------------------------------------------------------------------------
// material key normalization
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Material_Key
 *
 * Normalizes material path into canonical asset key.
 * Converts backslashes, removes leading 'materials/' prefix, collapses multiple slashes,
 * and normalizes to lowercase.
 * ================
 */
export function Material_Key( name: string ): string {
	return name
		.replace( /\\/g, '/' )
		.replace( /^\/?materials\//i, '' )
		.replace( /\/{2,}/g, '/' )
		.toLowerCase();
}

/**
 * @exec helper
 * ================
 * Material_FileURL
 *
 * Resolves file relative to catalog URL using synthetic origin for worker/node compatibility.
 * ================
 */
export function Material_FileURL( file: string, catalogURL: string ): string {
	const synthetic = 'https://cod2-assets.invalid';
	const url = new URL( file.replace( /\\/g, '/' ), new URL( catalogURL, synthetic ) );

	if ( !['http:', 'https:', 'data:', 'blob:'].includes( url.protocol ) ) {
		throw new Error( 'Unsupported material URL: ' + file );
	}

	return url.origin === synthetic ? url.pathname + url.search + url.hash : url.href;
}


// ---------------------------------------------------------------------------
// catalog asset resolution
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Material_Candidates
 *
 * Scans catalog sources for material entries matching key.
 * Exact spellings take precedence over normalized aliases within a catalog.
 * ================
 */
export function Material_Candidates(
	name: string,
	sources: readonly material_source_t[]
): material_candidate_t[] {
	const key = Material_Key( name );
	const seen = new Set<string>();
	const result: material_candidate_t[] = [];

	for ( const source of sources ) {
		const names = Object.keys( source.materials ).filter( ( n ) => Material_Key( n ) === key );

		names.sort( ( a, b ) => Number( b === name ) - Number( a === name ) );

		for ( const material of names ) {
			const file = source.materials[material]?.file;

			if ( typeof file !== 'string' || file.length === 0 ) {
				continue;
			}

			const url = Material_FileURL( file, source.url );

			if ( !seen.has( url ) ) {
				seen.add( url );
				result.push( { url, material, catalog: source.url } );
			}
		}
	}

	return result;
}


// ---------------------------------------------------------------------------
// asynchronous material image loading
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Material_LoadImages
 *
 * Loads diffuse texture images for an array of material names.
 * Queries primary catalogs first, falling back to optional catalogs if needed.
 * ================
 */
export async function Material_LoadImages(
	names: readonly string[],
	primary: readonly material_source_t[],
	optionalCatalogs: readonly string[],
	report: ( message: string ) => void,
	io: material_io_t = {
		fetch: ( ...args ) => Asset_Fetch( ...args ),
		decode: ( blob ) => createImageBitmap( blob ),
	}
): Promise<( ImageBitmap | null )[]> {
	let extra: Promise<{ sources: material_source_t[]; failures: string[] }> | undefined;

	const loadExtra = () =>
		( extra ??= Promise.all(
			optionalCatalogs.map( async ( url ) => {
				try {
					const r = await io.fetch( url );

					if ( !r.ok ) {
						throw new Error( 'HTTP ' + r.status );
					}

					const catalog: unknown = await r.json();

					if (
						!catalog ||
						typeof catalog !== 'object' ||
						!( 'materials' in catalog ) ||
						!catalog.materials ||
						typeof catalog.materials !== 'object' ||
						Array.isArray( catalog.materials )
					) {
						throw new Error( 'No material table' );
					}

					return {
						source: { url, materials: catalog.materials } as material_source_t,
						failure: '',
					};
				} catch ( error ) {
					return { source: null, failure: url + ': ' + String( error ) };
				}
			} )
		).then( ( entries ) => ( {
			sources: entries.flatMap( ( e ) => ( e.source ? [e.source] : [] ) ),
			failures: entries.flatMap( ( e ) => ( e.failure ? [e.failure] : [] ) ),
		} ) ) );

	return Asset_MapJobs( names, 6, async ( name ) => {
			const tried = new Set<string>();
			const failures: string[] = [];

			const trySources = async ( sources: readonly material_source_t[] ): Promise<ImageBitmap | null> => {
				let candidates: material_candidate_t[];

				try {
					candidates = Material_Candidates( name, sources );
				} catch ( error ) {
					failures.push( String( error ) );
					return null;
				}

				for ( const candidate of candidates ) {
					if ( tried.has( candidate.url ) ) {
						continue;
					}

					tried.add( candidate.url );

					try {
						const r = await io.fetch( candidate.url );

						if ( !r.ok ) {
							throw new Error( 'HTTP ' + r.status );
						}

						return await io.decode( await r.blob() );
					} catch ( error ) {
						failures.push( candidate.url + ': ' + String( error ) );
					}
				}

				return null;
			};

			const image = await trySources( primary );

			if ( image ) {
				return image;
			}

			try {
				const key = Material_Key( name );
				const url = '/assets/materials/' + key.split( '/' ).map( encodeURIComponent ).join( '/' ) + '.json';
				const response = await io.fetch( url );
				if ( response.ok ) {
					const descriptor = await response.json();
					const resolved = await trySources( [{ url, materials: { [name]: descriptor } }] );
					if ( resolved ) return resolved;
				}
			} catch ( error ) { failures.push( String( error ) ); }

			const fallback = await loadExtra();
			const recovered = await trySources( fallback.sources );

			if ( recovered ) {
				return recovered;
			}

			report(
				"Missing diffuse for material '" +
					name +
					"'. No replacement weapon/material was substituted. " +
					( failures.length
						? failures.join( '; ' )
						: 'No exported image mapping in ' +
							[...primary.map( ( s ) => s.url ), ...optionalCatalogs].join( ', ' ) ) +
					( fallback.failures.length ? '; ' + fallback.failures.join( '; ' ) : '' )
			);

			return null;
		}
	);
}
