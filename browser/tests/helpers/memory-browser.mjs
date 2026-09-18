/*
===============================================================================

	memory-browser.mjs

	Deterministic browser-port fakes, not a substitute for native-browser tests.
	Models committed writes, IDB publication failure, shared/exclusive Web Locks.

===============================================================================
*/

export function memoryBrowser() {
	const stores = new Map( [['settings', new Map()], ['bindings', new Map()]] );
	let publicationFailure = null;
	const missing = () => { throw new DOMException( 'Missing in memory filesystem', 'NotFoundError' ); };
	class Directory {
		constructor( name = '' ) { this.name = name; this.kind = 'directory'; this.children = new Map(); }
		async getDirectoryHandle( name, { create = false } = {} ) {
			if ( !this.children.has( name ) ) { if ( !create ) missing(); this.children.set( name, new Directory( name ) ); }
			const result = this.children.get( name ); if ( result.kind !== 'directory' ) throw new DOMException( 'Wrong kind', 'TypeMismatchError' ); return result;
		}
		async getFileHandle( name, { create = false } = {} ) {
			if ( !this.children.has( name ) ) {
				if ( !create ) missing();
				const handle = { name, kind: 'file', bytes: new Uint8Array() };
				handle.getFile = async () => new File( [handle.bytes], name );
				handle.createWritable = async () => {
					let pending = handle.bytes;
					return { write: async bytes => { pending = new Uint8Array( await new Blob( [bytes] ).arrayBuffer() ); }, close: async () => { handle.bytes = pending; }, abort: async () => {} };
				};
				this.children.set( name, handle );
			}
			const result = this.children.get( name ); if ( result.kind !== 'file' ) throw new DOMException( 'Wrong kind', 'TypeMismatchError' ); return result;
		}
		async removeEntry( name ) { if ( !this.children.delete( name ) ) missing(); }
		async *values() { yield* this.children.values(); }
	}
	const root = new Directory();
	const indexedDB = {
		open() {
			const request = {};
			setImmediate( () => {
				request.result = {
					close() {},
					transaction( name, mode ) {
						const tx = {};
						tx.objectStore = () => Object.fromEntries( ['get','put','delete','clear'].map( action => [action, ( value, key ) => {
							const operation = {};
							setImmediate( () => {
								if ( mode === 'readwrite' && publicationFailure && String( key ).startsWith( 'unit:' ) ) {
									tx.error = publicationFailure; publicationFailure = null; tx.onabort?.(); return;
								}
								const store = stores.get( name );
								if ( action === 'get' ) operation.result = store.get( value );
								if ( action === 'put' ) { store.set( key, value ); operation.result = key; }
								if ( action === 'delete' ) store.delete( value );
								if ( action === 'clear' ) store.clear();
								tx.oncomplete?.();
							} );
							return operation;
						}] ) );
						return tx;
					},
				};
				request.onsuccess?.();
			} );
			return request;
		},
	};
	const queues = new Map();
	const locks = {
		request( name, options, run ) {
			if ( typeof options === 'function' ) { run = options; options = {}; }
			const queue = queues.get( name ) || { jobs: [], active: 0, exclusive: false };
			queues.set( name, queue );
			return new Promise( ( resolve, reject ) => {
				const pump = () => {
					if ( queue.exclusive ) return;
					while ( queue.jobs.length ) {
						const next = queue.jobs[0];
						if ( !next.shared && queue.active ) return;
						queue.jobs.shift(); queue.active++; queue.exclusive = !next.shared;
						Promise.resolve().then( next.run ).then( next.resolve, next.reject ).finally( () => { queue.active--; queue.exclusive = false; pump(); } );
						if ( !next.shared ) return;
					}
				};
				queue.jobs.push( { run, resolve, reject, shared: options.mode === 'shared' } ); pump();
			} );
		},
	};
	return { root, indexedDB, locks, stores, failPublication( error ) { publicationFailure = error; } };
}
