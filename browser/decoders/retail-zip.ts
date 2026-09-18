/*
===============================================================================

	retail-zip.ts

	Call of Duty 2 / id Tech Archive Decoder
	Zero-dependency ZIP / IWD reader with Web Standard DecompressionStream.
	Provides central directory enumeration, streaming local header parsing,
	and multi-archive overlay indexing with LRU byte caching.

===============================================================================
*/

import { crc32 } from './retail-crc.js';
import { ByteCache } from './retail-cache.js';


// ---------------------------------------------------------------------------
// constants & signatures
// ---------------------------------------------------------------------------

export const ZIP_EOCD_SIGNATURE        = 0x06054b50;
export const ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50;
export const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;

export const ZIP_METHOD_STORE   = 0;
export const ZIP_METHOD_DEFLATE = 8;

export const ZIP_EOCD_MIN_SIZE       = 22;
export const ZIP_MAX_COMMENT_SIZE    = 65536;
export const ZIP_CENTRAL_HEADER_SIZE = 46;
export const ZIP_LOCAL_HEADER_SIZE   = 30;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface ZipEntryHeader {
	filename: string;
	crc: number;
	compressionMethod: number;
	compressedSize: number;
	uncompressedSize: number;
	localHeaderOffset: number;
}


// ---------------------------------------------------------------------------
// single archive reader
// ---------------------------------------------------------------------------

/*
====================
RetailZipArchive

Parses and decompresses entries from a single ZIP or Call of Duty 2 .IWD archive.
====================
*/
export class RetailZipArchive {
	private file: Blob;
	indexDigest = '';
	private entries = new Map<string, ZipEntryHeader>();

	constructor( file: Blob ) {
		this.file = file;
	}

	/*
	====================
	loadCentralDirectory

	Scans the archive tail for the End of Central Directory (EOCD) record,
	parses central directory file headers, and indexes entries by normalized lower-case paths.
	====================
	*/
	async loadCentralDirectory(): Promise<Map<string, ZipEntryHeader>> {
		const fileSize = this.file.size;

		if ( fileSize < ZIP_EOCD_MIN_SIZE ) {
			throw new Error( 'File too small to be a valid ZIP archive.' );
		}

		// Look for End of Central Directory Record (EOCD) in the last 65KB + 22 bytes
		const readSize = Math.min( fileSize, ZIP_MAX_COMMENT_SIZE + ZIP_EOCD_MIN_SIZE );
		const tailBuffer = await this.file.slice( fileSize - readSize, fileSize ).arrayBuffer();
		const tailView = new DataView( tailBuffer );

		let eocdOffset = -1;

		for ( let i = tailBuffer.byteLength - ZIP_EOCD_MIN_SIZE; i >= 0; i-- ) {
			if ( tailView.getUint32( i, true ) === ZIP_EOCD_SIGNATURE && i + 22 + tailView.getUint16( i + 20, true ) === tailBuffer.byteLength ) {
				eocdOffset = i;
				break;
			}
		}

		if ( eocdOffset === -1 ) {
			throw new Error( 'End of Central Directory record not found in archive.' );
		}

		const cdEntries = tailView.getUint16( eocdOffset + 10, true );
		const cdSize = tailView.getUint32( eocdOffset + 12, true );
		const cdOffset = tailView.getUint32( eocdOffset + 16, true );

		if ( tailView.getUint16( eocdOffset + 4, true ) || tailView.getUint16( eocdOffset + 6, true ) || cdEntries === 0xffff || cdOffset + cdSize > fileSize - readSize + eocdOffset ) throw new Error( 'Unsupported or invalid ZIP directory.' );
		const cdBuffer = await this.file.slice( cdOffset, cdOffset + cdSize ).arrayBuffer();
		const cdView = new DataView( cdBuffer );
		this.indexDigest = [...new Uint8Array( await crypto.subtle.digest( 'SHA-256', cdBuffer ) )].map( value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
		const decoder = new TextDecoder( 'utf-8' );

		let cursor = 0;

		for ( let i = 0; i < cdEntries; i++ ) {
			if ( cursor + ZIP_CENTRAL_HEADER_SIZE > cdBuffer.byteLength ) {
				throw new Error( 'Truncated ZIP central directory.' );
			}

			const signature = cdView.getUint32( cursor, true );

			if ( signature !== ZIP_CENTRAL_DIR_SIGNATURE ) {
				throw new Error( 'Invalid ZIP central directory entry.' );
			}

			const compressionMethod = cdView.getUint16( cursor + 10, true );
			const crc = cdView.getUint32( cursor + 16, true );
			if ( cdView.getUint16( cursor + 8, true ) & 1 ) throw new Error( 'Encrypted ZIP entries are not supported.' );
			const compressedSize = cdView.getUint32( cursor + 20, true );
			const uncompressedSize = cdView.getUint32( cursor + 24, true );
			const filenameLength = cdView.getUint16( cursor + 28, true );
			const extraLength = cdView.getUint16( cursor + 30, true );
			const commentLength = cdView.getUint16( cursor + 32, true );
			const localHeaderOffset = cdView.getUint32( cursor + 42, true );

			cursor += ZIP_CENTRAL_HEADER_SIZE;
			if ( cursor + filenameLength + extraLength + commentLength > cdBuffer.byteLength ) throw new Error( 'Truncated ZIP filename.' );

			const filenameBytes = new Uint8Array( cdBuffer, cursor, filenameLength );
			const filename = decoder.decode( filenameBytes ).replaceAll( '\\', '/' );

			cursor += filenameLength + extraLength + commentLength;

			if ( !filename.endsWith( '/' ) ) {
				if ( filename.startsWith( '/' ) || filename.split( '/' ).some( part => !part || part === '.' || part === '..' || /[:\0]/.test( part ) ) ) throw new Error( 'Unsafe archive entry path.' );
				this.entries.set( filename.toLowerCase(), {
					filename,
					crc,
					compressionMethod,
					compressedSize,
					uncompressedSize,
					localHeaderOffset,
				} );
			}
		}

		return this.entries;
	}

	/*
	====================
	getEntry

	Returns metadata header for an archive entry, or undefined if not found.
	====================
	*/
	getEntry( name: string ): ZipEntryHeader | undefined {
		return this.entries.get( name.toLowerCase() );
	}

	/*
	====================
	listEntries

	Returns an array of original preserved file paths in this archive.
	====================
	*/
	listEntries(): string[] {
		return Array.from( this.entries.values() ).map( ( e ) => e.filename );
	}

	/*
	====================
	read

	Reads and decompresses a single file payload from the archive blob.
	Supports method 0 (STORE) and method 8 (DEFLATE).
	====================
	*/
	async read( name: string ): Promise<Uint8Array> {
		const entry = this.getEntry( name );

		if ( !entry ) {
			throw new Error( `Entry not found in archive: ${name}` );
		}

		if ( entry.uncompressedSize > 512 * 1024 * 1024 ) throw new Error( `Asset exceeds the 512 MiB decode budget: ${name}` );
		// Read local file header to find data offset
		const localHeaderBuffer = await this.file.slice(
			entry.localHeaderOffset,
			entry.localHeaderOffset + ZIP_LOCAL_HEADER_SIZE
		).arrayBuffer();
		const localView = new DataView( localHeaderBuffer );

		if ( localHeaderBuffer.byteLength !== ZIP_LOCAL_HEADER_SIZE || localView.getUint32( 0, true ) !== ZIP_LOCAL_HEADER_SIGNATURE ) {
			throw new Error( `Invalid local file header for entry: ${entry.filename}` );
		}

		const filenameLength = localView.getUint16( 26, true );
		const extraLength = localView.getUint16( 28, true );
		const dataOffset = entry.localHeaderOffset + ZIP_LOCAL_HEADER_SIZE + filenameLength + extraLength;

		if ( dataOffset + entry.compressedSize > this.file.size ) throw new Error( `Truncated ZIP payload: ${name}` );
		const dataSlice = this.file.slice( dataOffset, dataOffset + entry.compressedSize );
		const validate = ( data: Uint8Array ) => {
			if ( data.byteLength !== entry.uncompressedSize || crc32( data ) !== entry.crc ) throw new Error( `ZIP integrity check failed: ${name}` );
			return data;
		};

		if ( entry.compressionMethod === ZIP_METHOD_STORE ) {
			// STORE
			if ( entry.compressedSize !== entry.uncompressedSize ) throw new Error( `Invalid stored ZIP size: ${name}` );
			return validate( new Uint8Array( await dataSlice.arrayBuffer() ) );
		} else if ( entry.compressionMethod === ZIP_METHOD_DEFLATE ) {
			// DEFLATE
			const stream = dataSlice.stream();
			const ds = new DecompressionStream( 'deflate-raw' );
			const decompressedStream = stream.pipeThrough( ds );
			const reader = decompressedStream.getReader();
			const output = new Uint8Array( entry.uncompressedSize );
			let offset = 0;
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if ( done ) break;
					if ( offset + value.length > output.length ) throw new Error( `ZIP expands beyond declared size: ${name}` );
					output.set( value, offset ); offset += value.length;
				}
				if ( offset !== output.length ) throw new Error( `Truncated ZIP output: ${name}` );
				return validate( output );
			} catch ( error ) {
				await reader.cancel().catch( () => {} );
				throw error;
			} finally { reader.releaseLock(); }
		} else {
			throw new Error( `Unsupported compression method ${entry.compressionMethod} for ${entry.filename}` );
		}
	}

	/*
	====================
	readText

	Convenience helper to read an entry and decode it as text.
	====================
	*/
	async readText( name: string, encoding: string = 'utf-8' ): Promise<string> {
		const bytes = await this.read( name );

		return new TextDecoder( encoding ).decode( bytes );
	}
}


// ---------------------------------------------------------------------------
// multi-archive overlay collection
// ---------------------------------------------------------------------------

/*
====================
ArchiveCollection

Aggregates multiple ZIP archives into a unified virtual filesystem hierarchy.
Archives added later supersede earlier entries to match game engine patch loading rules.
In-flight decompression requests are coalesced to prevent duplicate work.
====================
*/
export class ArchiveCollection {
	private cache = new ByteCache();
	private pending = new Map<string, Promise<Uint8Array>>();
	private archives: RetailZipArchive[] = [];
	private entryMap = new Map<string, { archive: RetailZipArchive; header: ZipEntryHeader }>();

	/*
	====================
	addArchive

	Mounts an archive into the collection, updating the active overlay index
	and clearing stale cached decompression buffers.
	====================
	*/
	async addArchive( file: Blob ): Promise<void> {
		const archive = new RetailZipArchive( file );
		const entries = await archive.loadCentralDirectory();

		this.archives.push( archive );
		this.cache.clear(); // Later archives override earlier entries. Never reuse stale bytes.

		for ( const [key, header] of entries ) {
			this.entryMap.set( key, { archive, header } );
			this.pending.delete( key );
		}
	}

	/*
	====================
	fingerprint

	Ordered central-directory fingerprints detect changes without hashing GB of
	archive bodies before the menu. Individual reads also verify their ZIP CRC.
	====================
	*/
	async fingerprint(): Promise<string> {
		const data = new TextEncoder().encode( this.archives.map( archive => archive.indexDigest ).join( ':' ) );
		return [...new Uint8Array( await crypto.subtle.digest( 'SHA-256', data ) )].map( value => value.toString( 16 ).padStart( 2, '0' ) ).join( '' );
	}

	/*
	====================
	has

	Tests whether an asset path exists across any mounted archive.
	====================
	*/
	has( name: string ): boolean {
		return this.entryMap.has( name.toLowerCase() );
	}

	/*
	====================
	get

	Returns the highest-priority ZipEntryHeader for a given path.
	====================
	*/
	get( name: string ): ZipEntryHeader | undefined {
		return this.entryMap.get( name.toLowerCase() )?.header;
	}

	/*
	====================
	read

	Reads and inflates an asset from the active overlay archive.
	Results are cached in an LRU buffer and concurrent reads coalesced.
	====================
	*/
	async read( name: string ): Promise<Uint8Array> {
		const key = name.toLowerCase();
		const item = this.entryMap.get( key );

		if ( !item ) {
			throw new Error( `Archive asset not found: ${name}` );
		}

		const hit = this.cache.get( key );

		if ( hit ) {
			return hit;
		}

		let pending = this.pending.get( key );

		if ( !pending ) {
			pending = item.archive.read( name ).then( ( bytes ) => {
				// Mounting a later archive must not publish an old in-flight result.
				if ( this.entryMap.get( key ) === item ) {
					this.cache.set( key, bytes );
				}
				return bytes;
			} );

			this.pending.set( key, pending );
		}

		try {
			return await pending;
		} finally {
			if ( this.pending.get( key ) === pending ) {
				this.pending.delete( key );
			}
		}
	}

	/*
	====================
	readText

	Reads an archive entry and decodes it as a text string.
	====================
	*/
	async readText( name: string, encoding: string = 'utf-8' ): Promise<string> {
		const bytes = await this.read( name );

		return new TextDecoder( encoding ).decode( bytes );
	}

	/*
	====================
	allFilenames

	Returns all distinct file names indexed across all mounted archives.
	====================
	*/
	allFilenames(): string[] {
		return Array.from( this.entryMap.keys() );
	}
}
