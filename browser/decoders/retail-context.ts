/*
===============================================================================

	retail-context.ts

	Per-job output, byte-budgeted texture reuse, diagnostics and decoder IO.

===============================================================================
*/

import { ArchiveCollection } from './retail-zip.js';
import { ByteCache } from './retail-cache.js';
import { decodeIwiToRgba, decodeIwiFaceToRgba } from './retail-iwi.js';
import { encodePNG } from './retail-png.js';
import type { FileRecord, TaskCallback, ProgressCallback, LogCallback, WriteFileCallback } from './retail-contracts.js';

const PNG_CACHE_CAPACITY_BYTES = 48 * 1024 * 1024;

export class RetailContext {
	readonly archives: ArchiveCollection;
	readonly progress: ProgressCallback;
	readonly log: LogCallback;
	private write: WriteFileCallback;
	private records = new Map<string, FileRecord>();
	private pngCache = new ByteCache( PNG_CACHE_CAPACITY_BYTES );
	private pngPending = new Map<string, Promise<Uint8Array>>();
	private outputBytes = 0;
	private writeFailure: unknown = null;
	private models: Promise<import('./retail-model.js').RetailModelDecoder> | null = null;
	readonly task: TaskCallback;

	/*
	====================
	constructor
	====================
	*/
	constructor(
		archives: ArchiveCollection,
		write: WriteFileCallback,
		progress: ProgressCallback = () => {},
		log: LogCallback = () => {},
		task: TaskCallback = () => {}
	) {
		this.archives = archives;
		this.write = write;
		this.progress = progress;
		this.log = log;
		this.task = task;
	}

	// -----------------------------------------------------------------------
	// file persistence & texture caching
	// -----------------------------------------------------------------------

	/*
	====================
	saveFile

	Normalizes path delimiters, notifies task monitors, and delegates binary writes
	to the configured storage sink while maintaining running byte tallies.
	====================
	*/
	async saveFile( path: string, bytes: Uint8Array ): Promise<void> {
		if ( this.writeFailure ) {
			throw this.writeFailure;
		}

		const cleanPath = path.replaceAll( '\\', '/' ).replace( /^\//, '' );
		this.task( { path: cleanPath } );

		try {
			await this.write( cleanPath, bytes );
		} catch ( error ) {
			this.writeFailure = error;
			throw error;
		}

		this.outputBytes += bytes.byteLength - ( this.records.get( cleanPath )?.size || 0 );
		this.records.set( cleanPath, { path: cleanPath, size: bytes.byteLength } );
		this.task( { path: cleanPath, files: this.records.size, bytes: this.outputBytes } );
	}

	/*
	====================
	saveJson

	Serializes an arbitrary JavaScript object to UTF-8 encoded JSON bytes and saves it.
	====================
	*/
	async saveJson( path: string, obj: unknown ): Promise<void> {
		await this.saveFile( path, new TextEncoder().encode( JSON.stringify( obj ) ) );
	}

	/*
	====================
	copyAsset

	Copies an unmodified archive payload directly to the output filesystem if not already present.
	====================
	*/
	async copyAsset( source: string, target = source ): Promise<void> {
		if ( !this.records.has( target ) ) {
			await this.saveFile( target, await this.archives.read( source ) );
		}
	}

	/*
	====================
	texturePng

	Decodes an IWI texture (or cubemap face) into RGBA and encodes it as a standard PNG.
	Uses an in-memory LRU ByteCache and request coalescing to prevent redundant work.
	====================
	*/
	async texturePng( source: string, face = -1 ): Promise<Uint8Array> {
		const key = source.toLowerCase() + ':' + face;
		const hit = this.pngCache.get( key );

		if ( hit ) {
			return hit;
		}

		let pending = this.pngPending.get( key );

		if ( !pending ) {
			this.task( { path: source } );
			pending = this.archives.read( source ).then( async ( raw ) => {
				const { width, height, rgba } = face < 0 ? decodeIwiToRgba( raw ) : decodeIwiFaceToRgba( raw, face );
				const png = await encodePNG( width, height, rgba );
				this.pngCache.set( key, png );
				return png;
			} );
			this.pngPending.set( key, pending );
		}

		try {
			return await pending;
		} finally {
			this.pngPending.delete( key );
		}
	}

	/*
	====================
	saveMenuTexture

	Saves a UI menu texture under both its base and 'menu_' prefixed assets image path.
	====================
	*/
	async saveMenuTexture( name: string, png: Uint8Array ): Promise<void> {
		await this.saveFile( `assets/images/${name}.png`, png );
		await this.saveFile( `assets/images/menu_${name}.png`, png );
	}

	/*
	====================
	decodeModelAsync

	Await the full model/LOD dependency chain. Reuse decoded props within a map,
	and keep the skeletal decoder off the menu-only module graph.
	====================
	*/
	async decodeModelAsync( name: string ): Promise<any> {
		this.models ??= import( './retail-model.js' ).then( module =>
			new module.RetailModelDecoder( path => this.archives.read( path ) ) );
		return ( await this.models ).load( name );
	}
	/*
	====================
	finish

	A caught stage error must never erase an earlier storage failure.
	====================
	*/
	finish(): FileRecord[] {
		if ( this.writeFailure ) throw this.writeFailure;
		this.pngCache.clear();
		return [...this.records.values()];
	}
}
