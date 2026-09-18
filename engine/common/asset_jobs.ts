/*
===============================================================================

	asset_jobs.ts

	Bounded asynchronous asset IO, outside the engine frame loop.

===============================================================================
*/

/**
 * @exec helper
 * ================
 * Asset_MapJobs
 * ================
 */
export async function Asset_MapJobs<T, R>( values: readonly T[], concurrency: number, work: ( value: T, index: number ) => Promise<R> ): Promise<R[]> {
	if ( !Number.isSafeInteger( concurrency ) || concurrency < 1 ) throw new RangeError( 'Invalid asset concurrency.' );
	const results = new Array<R>( values.length );
	let next = 0, failed = false;
	await Promise.all( Array.from( { length: Math.min( values.length, concurrency ) }, async () => {
		while ( !failed && next < values.length ) {
			const index = next++;
			try { results[index] = await work( values[index], index ); }
			catch ( error ) { failed = true; throw error; }
		}
	} ) );
	return results;
}

/**
 * @exec helper
 * ================
 * Asset_LevelURL
 *
 * New caches share absolute /assets image identities between maps and models.
 * Old caches keep map-relative filenames. Never permit arbitrary remote IO.
 * ================
 */
export function Asset_LevelURL( base: string, file: string ): string {
	if ( !file || /[\\\0:?#]/.test( file ) || file.startsWith( '//' ) || file.split( '/' ).some( part => part === '..' || part === '.' ) ) throw new Error( 'Unsafe local asset URL.' );
	return file.startsWith( '/' ) ? file : base + file;
}
