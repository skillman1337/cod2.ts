/*
===============================================================================

	call_graph.mjs

	Call of Duty 2 / id Tech Static AST Call Graph Builder
	Extracts and resolves static identifier call graphs across TypeScript source files:
	- Indexes function definitions by file and local/exported name.
	- Resolves identifier calls via file-local, explicit imported, and unique global symbols.
	- Tracks incoming and outgoing call edges and unresolved identifier calls.
	- Computes reachable transitive closures from designated root entry points.

===============================================================================
*/

import { repoRelative, resolveLocalImport } from './ts_project.mjs';


// ---------------------------------------------------------------------------
// key generation helpers
// ---------------------------------------------------------------------------

/*
====================
functionKey

Constructs a canonical unique key identifying a function definition by file and name.
====================
*/
export function functionKey( file, name ) {
	return `${file}#${name}`;
}


// ---------------------------------------------------------------------------
// call graph construction
// ---------------------------------------------------------------------------

/*
====================
buildCallGraph

Builds an in-memory static call graph from the scanned TypeScript project AST.
Maps all function definitions, resolves import bindings, correlates call sites to
definitions, and populates incoming and outgoing edge indices.
====================
*/
export function buildCallGraph( project ) {
	const definitions = new Map();
	const byName = new Map();
	const byFile = new Map();
	const fileByPath = new Map( project.files.map( ( file ) => [file.path, file] ) );

	for ( const file of project.files ) {
		const local = new Map();

		for ( const fn of file.functions ) {
			const key = functionKey( file.path, fn.name );
			const definition = { key, file: file.path, ...fn };

			definitions.set( key, definition );
			local.set( fn.name, definition );

			if ( !byName.has( fn.name ) ) {
				byName.set( fn.name, [] );
			}
			byName.get( fn.name ).push( definition );
		}

		byFile.set( file.path, local );
	}

	const importedByFile = new Map();

	for ( const file of project.files ) {
		const bindings = new Map();

		for ( const binding of file.importBindings ) {
			if ( binding.typeOnly || binding.imported === '*' ) {
				continue;
			}

			const absolute = resolveLocalImport( project.root, file.absolutePath, binding.specifier );
			if ( !absolute ) {
				continue;
			}

			bindings.set( binding.local, {
				targetFile: repoRelative( project.root, absolute ),
				imported: binding.imported,
			} );
		}

		importedByFile.set( file.path, bindings );
	}

	const resolveIdentifierCall = ( sourceDefinition, call ) => {
		if ( call.form !== 'identifier' ) {
			return null;
		}

		const local = byFile.get( sourceDefinition.file )?.get( call.name );
		if ( local ) {
			return local;
		}

		const imported = importedByFile.get( sourceDefinition.file )?.get( call.name );
		if ( imported ) {
			const direct = byFile.get( imported.targetFile )?.get( imported.imported );
			if ( direct ) {
				return direct;
			}

			const fallback = byName.get( imported.imported ) ?? [];
			if ( fallback.length === 1 ) {
				return fallback[0];
			}
		}

		const global = byName.get( call.name ) ?? [];
		return global.length === 1 ? global[0] : null;
	};

	const outgoing = new Map();
	const incoming = new Map();
	const unresolved = [];

	for ( const definition of definitions.values() ) {
		const edges = [];

		for ( const call of definition.calls ) {
			const target = resolveIdentifierCall( definition, call );

			if ( !target ) {
				if ( call.form === 'identifier' ) {
					unresolved.push( { source: definition.key, call } );
				}
				continue;
			}

			const edge = { source: definition.key, target: target.key, call };
			edges.push( edge );

			if ( !incoming.has( target.key ) ) {
				incoming.set( target.key, [] );
			}
			incoming.get( target.key ).push( edge );
		}

		outgoing.set( definition.key, edges );
	}

	return {
		definitions,
		byName,
		byFile,
		fileByPath,
		importedByFile,
		outgoing,
		incoming,
		unresolved,
		resolveIdentifierCall,
	};
}


// ---------------------------------------------------------------------------
// graph traversal & reachable closure
// ---------------------------------------------------------------------------

/*
====================
reachableFunctions

Traverses the directed call graph depth-first starting from an array of root keys,
returning the complete set of reached function definition keys.
====================
*/
export function reachableFunctions( graph, roots ) {
	const reached = new Set();
	const stack = [...roots];

	while ( stack.length > 0 ) {
		const key = stack.pop();

		if ( reached.has( key ) || !graph.definitions.has( key ) ) {
			continue;
		}

		reached.add( key );

		for ( const edge of graph.outgoing.get( key ) ?? [] ) {
			stack.push( edge.target );
		}
	}

	return reached;
}
