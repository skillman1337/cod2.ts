/*
===============================================================================

	retail-cache.ts

	Call of Duty 2 / id Tech Decoder Byte Cache
	Byte-bounded least-recently-used (LRU) buffer cache.
	Cached decoder buffers are immutable and read-only by contract.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const DEFAULT_BYTE_CACHE_LIMIT = 64 * 1024 * 1024; // 64 MB default cache budget


// ---------------------------------------------------------------------------
// byte-bounded lru cache
// ---------------------------------------------------------------------------

/*
====================
ByteCache

Tracks and evicts raw byte buffers under a configurable memory budget.
When adding buffers that would exceed the byte threshold, the least-recently
used buffers are evicted in FIFO access order.
====================
*/
export class ByteCache {
	private entries = new Map<string, Uint8Array>();
	bytes = 0;

	constructor( readonly limit: number = DEFAULT_BYTE_CACHE_LIMIT ) {
		if ( !Number.isSafeInteger( limit ) || limit < 0 ) {
			throw new RangeError( 'Invalid byte cache limit' );
		}
	}

	/*
	====================
	get

	Retrieves a cached byte buffer by key, refreshing its LRU access recency.
	Returns undefined if the key is not cached.
	====================
	*/
	get( key: string ): Uint8Array | undefined {
		const value = this.entries.get( key );

		if ( value ) {
			this.entries.delete( key );
			this.entries.set( key, value );
		}

		return value;
	}

	/*
	====================
	set

	Inserts a byte buffer into the cache, evicting oldest entries as necessary
	until the total cached byte volume satisfies the memory limit.
	Zero-byte buffers or buffers larger than the entire cache budget are ignored.
	====================
	*/
	set( key: string, value: Uint8Array ): void {
		const previous = this.entries.get( key );

		if ( previous ) {
			this.bytes -= previous.byteLength;
			this.entries.delete( key );
		}

		if ( !value.byteLength || value.byteLength > this.limit ) {
			return;
		}

		while ( this.bytes + value.byteLength > this.limit && this.entries.size ) {
			const oldest = this.entries.keys().next().value!;
			const entry = this.entries.get( oldest )!;

			this.bytes -= entry.byteLength;
			this.entries.delete( oldest );
		}

		this.entries.set( key, value );
		this.bytes += value.byteLength;
	}

	/*
	====================
	clear

	Purges all cached entries and resets tracked byte count to zero.
	====================
	*/
	clear(): void {
		this.entries.clear();
		this.bytes = 0;
	}
}
