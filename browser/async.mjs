/*
===============================================================================

	async.mjs

	Call of Duty 2 / id Tech Asynchronous Utilities
	Bounded concurrency queue with ordered result collection and fast abort.

===============================================================================
*/


// ---------------------------------------------------------------------------
// asynchronous scheduling
// ---------------------------------------------------------------------------

/*
====================
mapLimit

Processes an array of items with a strict upper bound on concurrent executions.
Guarantees:
1. Input ordering of results is preserved.
2. In-flight tasks stop scheduling immediately upon the first failure.
3. Concurrency limit must be a positive integer.
====================
*/
export async function mapLimit( items, limit, visit ) {
	if ( !Number.isInteger( limit ) || limit < 1 ) {
		throw new RangeError( 'Concurrency must be a positive integer.' );
	}

	const result = new Array( items.length );
	let next = 0;
	let failed = false;

	const workerCount = Math.min( limit, items.length );
	const workers = Array.from( { length: workerCount }, async () => {
		while ( !failed && next < items.length ) {
			const index = next++;

			try {
				result[index] = await visit( items[index], index );
			} catch ( error ) {
				failed = true;
				throw error;
			}
		}
	} );

	await Promise.all( workers );

	return result;
}
