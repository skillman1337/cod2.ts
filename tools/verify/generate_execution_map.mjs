/*
===============================================================================

	generate_execution_map.mjs

	Call of Duty 2 / id Tech Execution Map & Static Call Graph Generator
	Extracts deterministic static call graphs from TypeScript ASTs.
	Maps engine bootstrap and frame spine reachable functions, and outputs
	machine-readable JSON (docs/execution_map.json) and markdown documentation (docs/EXECUTION_MAP.md).

===============================================================================
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCallGraph, functionKey, reachableFunctions } from '../lib/call_graph.mjs';
import { DEFAULT_ROOT, parseVerificationArgs, scanProject } from '../lib/ts_project.mjs';


// ---------------------------------------------------------------------------
// constants & paths
// ---------------------------------------------------------------------------

const OUTPUT_JSON = 'docs/execution_map.json';
const OUTPUT_MARKDOWN = 'docs/EXECUTION_MAP.md';


// ---------------------------------------------------------------------------
// markdown & graph formatting helpers
// ---------------------------------------------------------------------------

/*
====================
sourceLink

Formats a Markdown link to a source file location with line anchor.
====================
*/
function sourceLink( definition, label = definition.name ) {
	return `[${label}](${definition.file}#L${definition.line})`;
}

/*
====================
unique

Returns a copy of an array with duplicate elements removed while preserving order.
====================
*/
function unique( values ) {
	return [...new Set( values )];
}

/*
====================
inferPhases

Infers the runtime phase categories (bootstrap, frame, async-callback, helper)
applicable to a given function definition based on AST tags and graph reachability.
====================
*/
function inferPhases( definition, bootstrapReachable, frameReachable ) {
	const phases = [];

	if ( bootstrapReachable.has( definition.key ) ) {
		phases.push( 'bootstrap' );
	}
	if ( frameReachable.has( definition.key ) ) {
		phases.push( 'frame' );
	}
	if ( definition.async || definition.tags.exec?.includes( 'async-callback' ) ) {
		phases.push( 'async-callback' );
	}
	if ( phases.length === 0 ) {
		phases.push( 'helper' );
	}

	return phases;
}


// ---------------------------------------------------------------------------
// model generation & AST analysis
// ---------------------------------------------------------------------------

/*
====================
buildModel

Scans the TypeScript project from the specified root, constructs the static call graph,
identifies bootstrap and frame root entry points, resolves incoming and outgoing edges,
and compiles the execution map data model.
====================
*/
function buildModel( root ) {
	const project = scanProject( root );

	if ( project.syntaxIssues.length > 0 ) {
		throw new Error(
			'cannot generate execution map from syntactically invalid TypeScript:\n' +
			project.syntaxIssues.map( ( issue ) => `  - ${issue.file}:${issue.line}:${issue.column}: ${issue.message}` ).join( '\n' ),
		);
	}

	const graph = buildCallGraph( project );

	const bootstrapRoots = [
		functionKey( 'index.ts', 'main' ),
		functionKey( 'index.ts', 'Main_Restart' ),
	].filter( ( key ) => graph.definitions.has( key ) );

	const frameRoots = [
		functionKey( 'engine/com/com.ts', 'Com_RafCallback' ),
	].filter( ( key ) => graph.definitions.has( key ) );

	const bootstrapReachable = reachableFunctions( graph, bootstrapRoots );
	const frameReachable = reachableFunctions( graph, frameRoots );

	const functions = [...graph.definitions.values()]
		.sort( ( a, b ) => a.file.localeCompare( b.file ) || a.line - b.line || a.name.localeCompare( b.name ) )
		.map( ( definition ) => {
			const outgoingEdges = graph.outgoing.get( definition.key ) ?? [];
			const resolvedCalls = unique( outgoingEdges.map( ( edge ) => edge.target ) );
			const callers = unique( ( graph.incoming.get( definition.key ) ?? [] ).map( ( edge ) => edge.source ) ).sort();
			const externalCalls = unique(
				definition.calls
					.filter( ( call ) => call.form === 'identifier' )
					.filter( ( call ) => !outgoingEdges.some( ( edge ) => edge.call === call ) )
					.map( ( call ) => call.name ),
			).sort();

			return {
				id: definition.key,
				file: definition.file,
				line: definition.line,
				name: definition.name,
				exported: definition.exported,
				async: definition.async,
				phases: inferPhases( definition, bootstrapReachable, frameReachable ),
				callers,
				calls: resolvedCalls,
				externalCalls,
			};
		} );

	return {
		schemaVersion: 2,
		generatedBy: 'tools/verify/generate_execution_map.mjs',
		roots: {
			bootstrap: bootstrapRoots,
			frame: frameRoots,
		},
		stats: {
			files: project.files.length,
			functions: functions.length,
			resolvedCallEdges: [...graph.outgoing.values()].reduce( ( sum, edges ) => sum + edges.length, 0 ),
			unresolvedIdentifierCalls: graph.unresolved.length,
		},
		functions,
	};
}


// ---------------------------------------------------------------------------
// markdown report rendering
// ---------------------------------------------------------------------------

/*
====================
renderMarkdown

Renders the compiled execution map model into formatted Markdown documentation
detailing entry roots, the frame spine, graph statistics, and a per-file function index.
====================
*/
function renderMarkdown( model ) {
	const byId = new Map( model.functions.map( ( fn ) => [fn.id, fn] ) );
	const lines = [
		'# Execution map',
		'',
		'> Generated by `node tools/verify/generate_execution_map.mjs --write`. Do not edit by hand.',
		'> The call graph comes from the TypeScript AST; comments and string literals cannot create edges.',
		'',
		'## Roots',
		'',
		`- Bootstrap: ${model.roots.bootstrap.map( ( id ) => sourceLink( byId.get( id ) ) ).join( ', ' ) || 'none'}`,
		`- Frame: ${model.roots.frame.map( ( id ) => sourceLink( byId.get( id ) ) ).join( ', ' ) || 'none'}`,
		'',
		'## Frame spine',
		'',
		'```text',
		'Com_RafCallback',
		'  -> Com_HandleVidResize',
		'  -> Com_Frame',
		'       -> Cbuf_Execute',
		'       -> Com_RunServerClientFrames',
		'            -> CL_SampleUsercmd -> SV_Frame / NET_* -> CL_Frame',
		'                 -> CL_BuildScrFrame -> SCR_UpdateScreen',
		'                      -> RGPU_InitPoll',
		'                      -> RGPU_BeginFrame -> draw encoding -> RGPU_EndFrame',
		'  -> requestAnimationFrame',
		'```',
		'',
		'## Statistics',
		'',
		`- Source files: ${model.stats.files}`,
		`- Named functions: ${model.stats.functions}`,
		`- Resolved local call edges: ${model.stats.resolvedCallEdges}`,
		`- Unresolved identifier calls (browser APIs, constructors, callbacks, or ambiguous names): ${model.stats.unresolvedIdentifierCalls}`,
		'',
		'## Function index',
		'',
	];

	let currentFile = null;
	for ( const fn of model.functions ) {
		if ( fn.file !== currentFile ) {
			currentFile = fn.file;
			lines.push( '### `' + currentFile + '`', '' );
			lines.push( '| Line | Function | Export | Phase | Called by | Calls |', '|---:|---|:---:|---|---|---|' );
		}
		const callers = fn.callers.map( ( id ) => sourceLink( byId.get( id ) ) ).join( '<br>' ) || '—';
		const calls = fn.calls.map( ( id ) => sourceLink( byId.get( id ) ) ).join( '<br>' ) || '—';
		lines.push(
			`| ${fn.line} | ${sourceLink( fn )} | ${fn.exported ? 'yes' : ''} | ${fn.phases.join( ', ' )} | ${callers} | ${calls} |`,
		);
	}

	lines.push( '' );
	return lines.join( '\n' );
}

/*
====================
expectedOutputs

Computes the in-memory execution model and serializes both JSON and Markdown representations.
====================
*/
export function expectedOutputs( root ) {
	const model = buildModel( root );

	return {
		model,
		json: `${JSON.stringify( model, null, 2 )}\n`,
		markdown: `${renderMarkdown( model )}\n`,
	};
}


// ---------------------------------------------------------------------------
// verification & output writing
// ---------------------------------------------------------------------------

/*
====================
writeOutputs

Writes the serialized execution map JSON and Markdown files to their canonical paths.
====================
*/
function writeOutputs( root, outputs ) {
	fs.writeFileSync( path.join( root, OUTPUT_JSON ), outputs.json );
	fs.writeFileSync( path.join( root, OUTPUT_MARKDOWN ), outputs.markdown );
	console.log( `wrote ${OUTPUT_JSON} and ${OUTPUT_MARKDOWN}` );
}

/*
====================
checkOutputs

Checks that docs/execution_map.json and docs/EXECUTION_MAP.md match the current AST graph.
Returns true if clean, or false with diagnostic mismatch messages if stale or missing.
====================
*/
function checkOutputs( root, outputs ) {
	const mismatches = [];

	for ( const [relative, expected] of [[OUTPUT_JSON, outputs.json], [OUTPUT_MARKDOWN, outputs.markdown]] ) {
		const absolute = path.join( root, relative );

		if ( !fs.existsSync( absolute ) ) {
			mismatches.push( `${relative} is missing` );
			continue;
		}

		if ( fs.readFileSync( absolute, 'utf8' ) !== expected ) {
			mismatches.push( `${relative} is stale` );
		}
	}

	if ( mismatches.length > 0 ) {
		console.error( 'execution map verification: failed' );
		for ( const mismatch of mismatches ) {
			console.error( `  - ${mismatch}` );
		}
		console.error( '  - run: npm run exec:map' );
		return false;
	}

	console.log( 'execution map verification: ok' );
	return true;
}

/*
====================
parseArgs

Parses command-line options (--root <path>, --write, --check).
====================
*/
function parseArgs( argv ) {
	return parseVerificationArgs(
		argv,
		{ mode: 'check' },
		{
			'--write': ( options ) => {
				options.mode = 'write';
			},
			'--check': ( options ) => {
				options.mode = 'check';
			},
		}
	);
}


// ---------------------------------------------------------------------------
// main CLI entry point
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && path.resolve( process.argv[1] ) === fileURLToPath( import.meta.url );

if ( isMain ) {
	try {
		const options = parseArgs( process.argv.slice( 2 ) );
		const outputs = expectedOutputs( options.root );

		if ( options.mode === 'write' ) {
			writeOutputs( options.root, outputs );
		} else {
			process.exitCode = checkOutputs( options.root, outputs ) ? 0 : 1;
		}
	} catch ( error ) {
		console.error( error instanceof Error ? error.stack : String( error ) );
		process.exitCode = 1;
	}
}
