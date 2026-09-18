/*
===============================================================================

	verify_ownership.mjs

	Call of Duty 2 / id Tech Subsystem Ownership & Boundary Verifier
	Enforces architectural boundaries, acyclic DAG topology, and encapsulation:
	- Validates the ownership manifest (engine/ownership.json).
	- Ensures every com file is classified as a module or package-private internal.
	- Enforces single parent ownership hierarchy rooted at index.ts.
	- Prohibits circular dependencies and unauthorized cross-subsystem imports.

===============================================================================
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	DEFAULT_ROOT,
	isLocalCodeSpecifier,
	parseVerificationArgs,
	printIssues,
	repoRelative,
	resolveLocalImport,
	scanProject,
	toPosix,
} from '../lib/ts_project.mjs';


// ---------------------------------------------------------------------------
// diagnostics & path helpers
// ---------------------------------------------------------------------------

/*
====================
issue

Constructs a structured diagnostic issue record with source position.
====================
*/
function issue( file, message, edge = null ) {
	return {
		file,
		message,
		line: edge?.line,
		column: edge?.column,
	};
}

/*
====================
normalizeManifestPath

Normalizes and validates a repository-relative path from the ownership manifest.
Rejects non-strings, backslashes, absolute paths, and traversal elements ('..').
====================
*/
function normalizeManifestPath( value ) {
	if ( typeof value !== 'string' ) {
		return null;
	}

	const normalized = path.posix.normalize( value.replaceAll( '\\', '/' ) );

	if ( path.posix.isAbsolute( normalized ) || normalized === '..' || normalized.startsWith( '../' ) ) {
		return null;
	}

	return normalized;
}

/*
====================
isUnder

Checks whether child path resides strictly beneath parentDirectory.
====================
*/
function isUnder( child, parentDirectory ) {
	return child.startsWith( `${parentDirectory}/` );
}


// ---------------------------------------------------------------------------
// manifest parsing & schema validation
// ---------------------------------------------------------------------------

/*
====================
readManifest

Reads, parses, and validates the ownership manifest JSON file from disk.
====================
*/
function readManifest( root, manifestRelative, issues ) {
	const absolute = path.join( root, manifestRelative );
	let parsed;

	try {
		parsed = JSON.parse( fs.readFileSync( absolute, 'utf8' ) );
	} catch ( error ) {
		issues.push( issue( manifestRelative, `cannot read ownership manifest: ${error instanceof Error ? error.message : String( error )}` ) );
		return null;
	}

	if ( parsed?.version !== 1 ) {
		issues.push( issue( manifestRelative, 'ownership manifest version must be 1' ) );
	}
	if ( !parsed || typeof parsed.modules !== 'object' || Array.isArray( parsed.modules ) ) {
		issues.push( issue( manifestRelative, 'modules must be an object mapping module -> owner' ) );
	}
	if ( !parsed || typeof parsed.internals !== 'object' || Array.isArray( parsed.internals ) ) {
		issues.push( issue( manifestRelative, 'internals must be an object mapping internal file -> package entry' ) );
	}
	if ( issues.length > 0 ) {
		return null;
	}

	const modules = new Map();
	const internals = new Map();

	for ( const [rawFile, rawOwner] of Object.entries( parsed.modules ) ) {
		const file = normalizeManifestPath( rawFile );
		const owner = normalizeManifestPath( rawOwner );

		if ( !file || !owner ) {
			issues.push( issue( manifestRelative, `invalid module path mapping: ${JSON.stringify( rawFile )} -> ${JSON.stringify( rawOwner )}` ) );
			continue;
		}

		modules.set( file, owner );
	}

	for ( const [rawFile, rawPackage] of Object.entries( parsed.internals ) ) {
		const file = normalizeManifestPath( rawFile );
		const packageEntry = normalizeManifestPath( rawPackage );

		if ( !file || !packageEntry ) {
			issues.push( issue( manifestRelative, `invalid internal path mapping: ${JSON.stringify( rawFile )} -> ${JSON.stringify( rawPackage )}` ) );
			continue;
		}

		internals.set( file, packageEntry );
	}

	const rootModule = normalizeManifestPath( parsed.root );
	if ( !rootModule ) {
		issues.push( issue( manifestRelative, 'root must be a repository-relative path' ) );
	}

	return {
		rootModule,
		modules,
		internals,
		manifestRelative,
	};
}

/*
====================
validateManifest

Verifies semantic manifest rules: module coverage, single root ownership by index.ts,
nested directory containment, absence of internal module leaks, and acyclic module ownership.
====================
*/
function validateManifest( root, model, sourceFiles, issues ) {
	const { rootModule, modules, internals, manifestRelative } = model;
	const comFiles = sourceFiles
		.map( ( file ) => file.path )
		.filter( ( file ) => file.startsWith( 'engine/com/' ) )
		.sort();
	const covered = new Set( [...modules.keys(), ...internals.keys()] );

	for ( const source of sourceFiles ) {
		if ( source.path === 'index.ts' || source.path.startsWith( 'engine/common/' ) || source.path.startsWith( 'engine/com/' ) ) {
			continue;
		}
		issues.push( issue(
			source.path,
			`${source.path} is not classified in engine/ownership.json (engine TypeScript sources must live in engine/common/ or be classified by engine/ownership.json under engine/com/)`,
		) );
	}

	if ( !rootModule || !modules.has( rootModule ) ) {
		issues.push( issue( manifestRelative, `root module ${rootModule ?? '<missing>'} is not listed in modules` ) );
	}
	if ( rootModule && modules.get( rootModule ) !== 'index.ts' ) {
		issues.push( issue( manifestRelative, `root module ${rootModule} must be owned by index.ts` ) );
	}

	const indexChildren = [...modules.entries()].filter( ( [, owner] ) => owner === 'index.ts' ).map( ( [file] ) => file );
	if ( indexChildren.length !== 1 || indexChildren[0] !== rootModule ) {
		issues.push( issue( manifestRelative, `index.ts must own exactly the declared root; got ${indexChildren.join( ', ' ) || '<none>'}` ) );
	}

	for ( const file of comFiles ) {
		if ( !covered.has( file ) ) {
			issues.push( issue( file, 'engine/com TypeScript file is not classified as a module or package internal' ) );
		}
	}
	for ( const file of covered ) {
		if ( !comFiles.includes( file ) ) {
			issues.push( issue( manifestRelative, `manifest entry does not exist or is not an engine/com TypeScript file: ${file}` ) );
		}
	}
	for ( const file of modules.keys() ) {
		if ( internals.has( file ) ) {
			issues.push( issue( manifestRelative, `${file} is listed as both a module and an internal` ) );
		}
		if ( file.includes( '/internal/' ) ) {
			issues.push( issue( manifestRelative, `lifecycle module must not live under internal/: ${file}` ) );
		}
	}

	for ( const [file, owner] of modules ) {
		if ( owner !== 'index.ts' && !modules.has( owner ) ) {
			issues.push( issue( manifestRelative, `${file}: owner is not a declared module: ${owner}` ) );
			continue;
		}
		if ( owner === 'index.ts' ) {
			continue;
		}

		const ownerDirectory = path.posix.dirname( owner );
		const childDirectory = path.posix.dirname( file );

		if ( childDirectory === ownerDirectory || !isUnder( childDirectory, ownerDirectory ) ) {
			issues.push( issue(
				manifestRelative,
				`${file}: lifecycle child must live in a subfolder of owner ${owner} (owner directory ${ownerDirectory}/)`,
			) );
		}
	}

	for ( const [file, packageEntry] of internals ) {
		if ( !modules.has( packageEntry ) ) {
			issues.push( issue( manifestRelative, `${file}: internal package entry is not a declared module: ${packageEntry}` ) );
			continue;
		}

		const expectedPrefix = `${path.posix.dirname( packageEntry )}/internal/`;
		if ( !file.startsWith( expectedPrefix ) ) {
			issues.push( issue( manifestRelative, `${file}: package internals must live under ${expectedPrefix}` ) );
		}
	}

	const visiting = new Set();
	const visited = new Set();
	const stack = [];

	const visitOwner = ( module ) => {
		if ( visited.has( module ) ) {
			return;
		}
		if ( visiting.has( module ) ) {
			const cycleStart = stack.indexOf( module );
			const cycle = [...stack.slice( cycleStart ), module];
			issues.push( issue( manifestRelative, `ownership cycle: ${cycle.join( ' -> ' )}` ) );
			return;
		}

		visiting.add( module );
		stack.push( module );

		const owner = modules.get( module );
		if ( owner && owner !== 'index.ts' && modules.has( owner ) ) {
			visitOwner( owner );
		}

		stack.pop();
		visiting.delete( module );
		visited.add( module );
	};

	for ( const module of modules.keys() ) {
		visitOwner( module );
	}
}


// ---------------------------------------------------------------------------
// import boundary classification & cycle checks
// ---------------------------------------------------------------------------

/*
====================
classifyTarget

Determines the architectural role of an imported file path.
====================
*/
function classifyTarget( target, model ) {
	if ( target.startsWith( 'engine/common/' ) ) {
		return 'common';
	}
	if ( model.modules.has( target ) ) {
		return 'module';
	}
	if ( model.internals.has( target ) ) {
		return 'internal';
	}
	if ( target === 'index.ts' ) {
		return 'index';
	}
	if ( target.startsWith( 'engine/com/' ) ) {
		return 'unclassified-com';
	}

	return 'other';
}

/*
====================
allowedTarget

Determines whether source is permitted to import target according to the ownership model.
====================
*/
function allowedTarget( source, target, model ) {
	const targetKind = classifyTarget( target, model );

	if ( source === 'index.ts' ) {
		return targetKind === 'common' || target === model.rootModule;
	}
	if ( source.startsWith( 'engine/common/' ) ) {
		return targetKind === 'common';
	}
	if ( model.modules.has( source ) ) {
		if ( targetKind === 'common' ) {
			return true;
		}
		if ( targetKind === 'module' ) {
			return model.modules.get( target ) === source;
		}
		if ( targetKind === 'internal' ) {
			return model.internals.get( target ) === source;
		}
		return false;
	}
	if ( model.internals.has( source ) ) {
		if ( targetKind === 'common' ) {
			return true;
		}
		if ( targetKind === 'internal' ) {
			return model.internals.get( target ) === model.internals.get( source );
		}
		return false;
	}

	return targetKind === 'other';
}

/*
====================
detectValueCycles

Detects and reports cycles in the runtime value import graph.
====================
*/
function detectValueCycles( adjacency, issues ) {
	const visiting = new Set();
	const visited = new Set();
	const stack = [];
	const reported = new Set();

	const visit = ( node ) => {
		if ( visited.has( node ) ) {
			return;
		}
		if ( visiting.has( node ) ) {
			const start = stack.indexOf( node );
			const cycle = [...stack.slice( start ), node];
			const canonical = [...cycle.slice( 0, -1 )].sort().join( '|' );
			if ( !reported.has( canonical ) ) {
				reported.add( canonical );
				issues.push( issue( node, `circular dependency detected: runtime import cycle: ${cycle.join( ' -> ' )}` ) );
			}
			return;
		}

		visiting.add( node );
		stack.push( node );

		for ( const target of adjacency.get( node ) ?? [] ) {
			visit( target );
		}

		stack.pop();
		visiting.delete( node );
		visited.add( node );
	};

	for ( const node of adjacency.keys() ) {
		visit( node );
	}
}


// ---------------------------------------------------------------------------
// public API & CLI entry point
// ---------------------------------------------------------------------------

/*
====================
verifyOwnership

Validates the full ownership architecture for the project at root.
Returns issues, model, edges, and project.
====================
*/
export function verifyOwnership( root = DEFAULT_ROOT, options = {} ) {
	const manifestRelative = options.manifest ?? 'engine/ownership.json';
	const project = scanProject( root );
	const issues = [...project.syntaxIssues];
	const model = readManifest( root, manifestRelative, issues );

	if ( !model ) {
		return { issues, model: null, edges: [] };
	}

	validateManifest( root, model, project.files, issues );

	const edges = [];
	const importers = new Map();
	const valueAdjacency = new Map();

	for ( const file of project.files ) {
		for ( const imported of file.opaqueImports ) {
			issues.push( issue(
				file.path,
				`${imported.kind} must use a static string literal so ownership can be verified`,
				imported,
			) );
		}

		for ( const imported of file.imports ) {
			const resolved = resolveLocalImport( root, file.absolutePath, imported.specifier );

			if ( !resolved ) {
				if ( isLocalCodeSpecifier( imported.specifier ) ) {
					issues.push( issue(
						file.path,
						`unresolved local code ${imported.kind}: ${JSON.stringify( imported.specifier )}`,
						imported,
					) );
				}
				continue;
			}

			const target = repoRelative( root, resolved );
			if ( !target.endsWith( '.ts' ) && !target.endsWith( '.tsx' ) && !target.endsWith( '.mts' ) && !target.endsWith( '.cts' ) ) {
				continue;
			}

			const edge = { source: file.path, target, ...imported };
			edges.push( edge );

			if ( !importers.has( target ) ) {
				importers.set( target, [] );
			}
			importers.get( target ).push( edge );

			if ( !imported.typeOnly ) {
				if ( !valueAdjacency.has( file.path ) ) {
					valueAdjacency.set( file.path, new Set() );
				}
				valueAdjacency.get( file.path ).add( target );
			}

			if ( !allowedTarget( file.path, target, model ) ) {
				if ( model.internals.has( file.path ) && model.internals.get( file.path ) === target ) {
					issues.push( issue(
						file.path,
						`internal file ${file.path} imports its parent module ${target}`,
						imported,
					) );
				} else if ( model.internals.has( target ) ) {
					issues.push( issue(
						file.path,
						`package-private file ${target} cannot be imported by ${file.path}; only owner ${model.internals.get( target )} and sibling internals may import it`,
						imported,
					) );
				} else {
					const sourceRole = model.modules.has( file.path )
						? 'module'
						: model.internals.has( file.path )
							? 'internal'
							: file.path.startsWith( 'engine/common/' )
								? 'foundation'
								: file.path;

					issues.push( issue(
						file.path,
						`illegal ${imported.kind}: ${sourceRole} may not reach ${target}`,
						imported,
					) );
				}
			}
		}
	}

	for ( const [module, owner] of model.modules ) {
		const ownerEdges = ( importers.get( module ) ?? [] ).filter( ( edge ) => edge.source === owner );
		const valueOwnerEdges = ownerEdges.filter( ( edge ) => !edge.typeOnly );

		if ( valueOwnerEdges.length === 0 ) {
			issues.push( issue( module, `declared owner ${owner} must have a runtime import/export edge to this module` ) );
		}

		for ( const edge of importers.get( module ) ?? [] ) {
			if ( edge.source !== owner ) {
				issues.push( issue(
					edge.source,
					`${module} has undeclared importer ${edge.source}; sole lifecycle owner is ${owner}`,
					edge,
				) );
			}
		}
	}

	for ( const [internal, packageEntry] of model.internals ) {
		const packageInternals = new Set(
			[...model.internals.entries()]
				.filter( ( [, entry] ) => entry === packageEntry )
				.map( ( [file] ) => file ),
		);
		const validImporters = ( importers.get( internal ) ?? [] ).filter(
			( edge ) => edge.source === packageEntry || packageInternals.has( edge.source ),
		);

		if ( validImporters.length === 0 ) {
			issues.push( issue( internal, `package internal is unreachable from package entry ${packageEntry}` ) );
		}
	}

	detectValueCycles( valueAdjacency, issues );

	return {
		issues,
		model,
		edges,
		project,
	};
}

/*
====================
ownershipTreeLines

Formats a human-readable indented tree of modules and their internals for display.
====================
*/
export function ownershipTreeLines( model ) {
	if ( !model ) {
		return [];
	}

	const children = new Map();
	for ( const [module, owner] of model.modules ) {
		if ( !children.has( owner ) ) {
			children.set( owner, [] );
		}
		children.get( owner ).push( module );
	}
	for ( const list of children.values() ) {
		list.sort();
	}

	const lines = [];
	const visit = ( owner, depth ) => {
		for ( const child of children.get( owner ) ?? [] ) {
			lines.push( `${'  '.repeat( depth )}- ${child}` );
			const internals = [...model.internals.entries()]
				.filter( ( [, packageEntry] ) => packageEntry === child )
				.map( ( [internal] ) => internal )
				.sort();
			for ( const internal of internals ) {
				lines.push( `${'  '.repeat( depth + 1 )}- [internal] ${internal}` );
			}
			visit( child, depth + 1 );
		}
	};

	visit( 'index.ts', 0 );
	return lines;
}

/*
====================
parseArgs

Parses command line arguments (--root <path>, --manifest <path>, --json).
====================
*/
function parseArgs( argv ) {
	return parseVerificationArgs(
		argv,
		{ manifest: 'engine/ownership.json' },
		{
			'--manifest': ( options, next ) => {
				options.manifest = toPosix( next() );
			},
		}
	);
}

const isMain = process.argv[1] && path.resolve( process.argv[1] ) === fileURLToPath( import.meta.url );

if ( isMain ) {
	try {
		const options = parseArgs( process.argv.slice( 2 ) );
		const result = verifyOwnership( options.root, options );

		if ( options.json ) {
			console.log( JSON.stringify( { issues: result.issues, tree: ownershipTreeLines( result.model ) }, null, 2 ) );
		} else {
			printIssues( 'ownership verification', result.issues );
			if ( result.issues.length === 0 ) {
				console.log( `  modules: ${result.model.modules.size}` );
				console.log( `  package internals: ${result.model.internals.size}` );
				console.log( `  local import edges: ${result.edges.length}` );
			}
		}

		process.exitCode = result.issues.length === 0 ? 0 : 1;
	} catch ( error ) {
		console.error( error instanceof Error ? error.stack : String( error ) );
		process.exitCode = 1;
	}
}
