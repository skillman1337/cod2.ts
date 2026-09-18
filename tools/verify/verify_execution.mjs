/*
===============================================================================

	verify_execution.mjs

	Call of Duty 2 / id Tech Execution Graph & Control Flow Verifier
	Enforces static architectural invariants on engine execution flow:
	- Prohibits top-level await in engine bootstrap and frame paths.
	- Constrains requestAnimationFrame exclusively to Com_BeginLoop / Com_RafCallback.
	- Validates @exec cadence tags and synchronous frame guarantees.
	- Verifies mandatory call sequences and subsystem handoffs.

===============================================================================
*/

import { buildCallGraph, functionKey, reachableFunctions } from '../lib/call_graph.mjs';
import {
	DEFAULT_ROOT,
	isMainModule,
	parseVerificationArgs,
	printIssues,
	scanProject,
} from '../lib/ts_project.mjs';


// ---------------------------------------------------------------------------
// constants & cadence tags
// ---------------------------------------------------------------------------

const VALID_EXEC_TAGS = new Set( [
	'bootstrap-once',
	'init-once',
	'per-frame',
	'async-callback',
	'helper',
] );


// ---------------------------------------------------------------------------
// issue reporting & graph query helpers
// ---------------------------------------------------------------------------

/*
====================
issue

Constructs a structured issue record with source file position.
====================
*/
function issue( definition, message, call = null ) {
	return {
		file: definition.file,
		line: call?.line ?? definition.line,
		column: call?.column ?? definition.column,
		message,
	};
}

/*
====================
getDefinition

Retrieves a function definition from the call graph by file and symbol name,
logging a missing required function issue if absent.
====================
*/
function getDefinition( graph, file, name, issues ) {
	const key = functionKey( file, name );
	const definition = graph.definitions.get( key );

	if ( !definition ) {
		issues.push( { file, message: `missing required function ${name}` } );
	}

	return definition ?? null;
}

/*
====================
callIndex

Returns the index of a named function call within a function definition.
====================
*/
function callIndex( definition, name ) {
	return definition.calls.findIndex( ( call ) => call.name === name );
}

/*
====================
requireCalls

Verifies that the target definition invokes every function specified in names.
====================
*/
function requireCalls( definition, names, issues ) {
	for ( const name of names ) {
		if ( callIndex( definition, name ) < 0 ) {
			issues.push( issue( definition, `must call ${name}` ) );
		}
	}
}

/*
====================
forbidCalls

Checks that a definition does not call any forbidden functions matching predicate.
====================
*/
function forbidCalls( definition, predicate, description, issues ) {
	for ( const call of definition.calls ) {
		if ( predicate( call.name ) ) {
			issues.push( issue( definition, description.replace( '{call}', call.name ), call ) );
		}
	}
}

/*
====================
requireOrder

Ensures a sequence of named calls occurs in the specified relative order.
====================
*/
function requireOrder( definition, names, issues ) {
	let previous = -1;

	for ( const name of names ) {
		const index = callIndex( definition, name );

		if ( index < 0 ) {
			issues.push( issue( definition, `call sequence is missing ${name}` ) );
			return;
		}

		if ( index <= previous ) {
			issues.push( issue( definition, `call sequence must be ${names.join( ' -> ' )}` ) );
			return;
		}

		previous = index;
	}
}


// ---------------------------------------------------------------------------
// invariant verification rules
// ---------------------------------------------------------------------------

/*
====================
verifyNoTopLevelAwait

Enforces that no top-level await expressions exist outside of function declarations.
====================
*/
function verifyNoTopLevelAwait( project, issues ) {
	const { ts } = project;

	for ( const file of project.files ) {
		const visit = ( node, functionDepth ) => {
			const isFunction = ts.isFunctionLike( node );
			const nextDepth = functionDepth + ( isFunction ? 1 : 0 );

			if ( ts.isAwaitExpression( node ) && functionDepth === 0 ) {
				const point = file.sourceFile.getLineAndCharacterOfPosition( node.getStart( file.sourceFile ) );
				issues.push( {
					file: file.path,
					line: point.line + 1,
					column: point.character + 1,
					message: 'top-level await is forbidden in the engine bootstrap and frame graph',
				} );
			}

			ts.forEachChild( node, ( child ) => visit( child, nextDepth ) );
		};

		visit( file.sourceFile, 0 );
	}
}

/*
====================
verifyRafOwnership

Ensures that requestAnimationFrame is only invoked by Com_BeginLoop or Com_RafCallback.
====================
*/
function verifyRafOwnership( graph, issues ) {
	const allowedFile = 'engine/com/com.ts';
	const allowedFunctions = new Set( ['Com_BeginLoop', 'Com_RafCallback'] );

	for ( const definition of graph.definitions.values() ) {
		for ( const call of definition.calls ) {
			if ( call.name !== 'requestAnimationFrame' ) {
				continue;
			}

			if ( definition.file !== allowedFile || !allowedFunctions.has( definition.name ) ) {
				issues.push( issue(
					definition,
					'requestAnimationFrame belongs exclusively to Com_BeginLoop / Com_RafCallback in com.ts',
					call,
				) );
			}
		}
	}
}

/*
====================
verifyTaggedCadence

Validates @exec JSDoc cadence tags and guarantees that per-frame functions
are strictly synchronous without await or generator yields.
====================
*/
function verifyTaggedCadence( graph, issues ) {
	for ( const definition of graph.definitions.values() ) {
		const tags = definition.tags.exec ?? [];

		for ( const tag of tags ) {
			if ( !VALID_EXEC_TAGS.has( tag ) ) {
				issues.push( issue( definition, `invalid @exec value ${JSON.stringify( tag )}` ) );
			}
		}

		if ( !tags.includes( 'per-frame' ) ) {
			continue;
		}

		if ( definition.async ) {
			issues.push( issue( definition, '@exec per-frame function must be synchronous' ) );
		}
		if ( definition.awaitCount > 0 ) {
			issues.push( issue( definition, '@exec per-frame function must not use await' ) );
		}
		if ( definition.yieldCount > 0 ) {
			issues.push( issue( definition, '@exec per-frame function must not yield' ) );
		}
	}
}

/*
====================
verifyFrameClosure

Verifies that the complete transitive call closure reachable from the Com_RafCallback
frame root contains only synchronous functions without async, await, or yield.
====================
*/
function verifyFrameClosure( graph, issues ) {
	const root = functionKey( 'engine/com/com.ts', 'Com_RafCallback' );

	if ( !graph.definitions.has( root ) ) {
		issues.push( { file: 'engine/com/com.ts', message: 'missing Com_RafCallback frame root' } );
		return;
	}

	const reachable = reachableFunctions( graph, [root] );

	for ( const key of reachable ) {
		const definition = graph.definitions.get( key );

		if ( definition.async ) {
			issues.push( issue( definition, `function reachable from Com_RafCallback must be synchronous (${key})` ) );
		}
		if ( definition.awaitCount > 0 ) {
			issues.push( issue( definition, `function reachable from Com_RafCallback must not await (${key})` ) );
		}
		if ( definition.yieldCount > 0 ) {
			issues.push( issue( definition, `function reachable from Com_RafCallback must not yield (${key})` ) );
		}
	}
}

/*
====================
verifyCoreSequences

Enforces strict order and presence of core engine initialization, loop bootstrap,
server/client frame handoffs, screen drawing, and WebGPU pipeline sequences.
====================
*/
function verifyCoreSequences( graph, issues ) {
	const mainStart = getDefinition( graph, 'index.ts', 'Main_StartGame', issues );
	if ( mainStart ) {
		requireCalls( mainStart, ['Com_Init', 'Com_BeginLoop'], issues );
		requireOrder( mainStart, ['Com_Init', 'Com_BeginLoop'], issues );
	}

	const indexMain = getDefinition( graph, 'index.ts', 'main', issues );
	if ( indexMain ) {
		requireCalls( indexMain, ['Main_StartGame'], issues );
	}

	for ( const definition of graph.byFile.get( 'index.ts' )?.values() ?? [] ) {
		forbidCalls(
			definition,
			( name ) => name.startsWith( 'VID_' ) || name.startsWith( 'RGPU_' ),
			'index.ts must not bypass com.ts by calling {call}',
			issues,
		);
	}

	const beginLoop = getDefinition( graph, 'engine/com/com.ts', 'Com_BeginLoop', issues );
	if ( beginLoop ) {
		requireCalls( beginLoop, ['requestAnimationFrame'], issues );
	}

	const raf = getDefinition( graph, 'engine/com/com.ts', 'Com_RafCallback', issues );
	if ( raf ) {
		requireCalls( raf, ['Com_HandleVidResize', 'Com_Frame', 'requestAnimationFrame'], issues );
		requireOrder( raf, ['Com_HandleVidResize', 'Com_Frame', 'requestAnimationFrame'], issues );
	}

	const comInit = getDefinition( graph, 'engine/com/com.ts', 'Com_Init', issues );
	if ( comInit ) {
		requireCalls( comInit, [
			'Com_InitHost',
			'Con_Init',
			'Cbuf_Init',
			'SV_Init',
			'NET_Init',
			'Com_InitGraphics',
		], issues );
	}

	const comInitHost = getDefinition( graph, 'engine/com/com.ts', 'Com_InitHost', issues );
	if ( comInitHost ) {
		requireCalls( comInitHost, ['Host_Init'], issues );
	}

	const comInitGraphics = getDefinition( graph, 'engine/com/com.ts', 'Com_InitGraphics', issues );
	if ( comInitGraphics ) {
		requireCalls( comInitGraphics, ['Com_InitDedicatedGraphics', 'Com_InitListenGraphics'], issues );
	}

	const comInitListen = getDefinition( graph, 'engine/com/com.ts', 'Com_InitListenGraphics', issues );
	if ( comInitListen ) {
		requireCalls( comInitListen, ['CL_Init'], issues );
	}

	const comFrame = getDefinition( graph, 'engine/com/com.ts', 'Com_Frame', issues );
	if ( comFrame ) {
		requireCalls( comFrame, ['Cbuf_Execute', 'Com_RunServerClientFrames'], issues );
		requireOrder( comFrame, ['Cbuf_Execute', 'Com_RunServerClientFrames'], issues );
	}

	const handoff = getDefinition( graph, 'engine/com/com.ts', 'Com_RunServerClientFrames', issues );
	if ( handoff ) {
		requireCalls( handoff, [
			'CL_SampleUsercmd',
			'SV_Frame',
			'NET_Frame',
			'CL_Frame',
		], issues );
		requireOrder( handoff, ['CL_SampleUsercmd', 'CL_Frame'], issues );
	}

	const clInit = getDefinition( graph, 'engine/com/client/cl_main.ts', 'CL_Init', issues );
	if ( clInit ) {
		requireCalls( clInit, ['VID_SetCanvas', 'CL_InitInput', 'S_Init', 'SCR_MenuInit', 'SCR_InitGpu'], issues );
	}

	const clFrame = getDefinition( graph, 'engine/com/client/cl_main.ts', 'CL_Frame', issues );
	if ( clFrame ) {
		requireCalls( clFrame, ['CL_RunActiveFrame'], issues );
	}

	const clActive = getDefinition( graph, 'engine/com/client/cl_main.ts', 'CL_RunActiveFrame', issues );
	if ( clActive ) {
		requireCalls( clActive, ['CL_BuildScrFrame', 'SCR_UpdateScreen', 'CL_UpdateSound'], issues );
	}

	const scrInit = getDefinition( graph, 'engine/com/client/screen/scr_draw.ts', 'SCR_InitGpu', issues );
	if ( scrInit ) {
		requireCalls( scrInit, ['RGPU_InitBegin'], issues );
	}

	const scrUpdate = getDefinition( graph, 'engine/com/client/screen/scr_draw.ts', 'SCR_UpdateScreen', issues );
	if ( scrUpdate ) {
		requireCalls( scrUpdate, ['RGPU_InitPoll', 'RGPU_IsReady', 'VID_IsValid', 'RGPU_HasSwapchain', 'SCR_DrawGameScreen'], issues );
		requireOrder( scrUpdate, ['RGPU_InitPoll', 'SCR_DrawGameScreen'], issues );
	}

	const scrGame = getDefinition( graph, 'engine/com/client/screen/scr_draw.ts', 'SCR_DrawGameScreen', issues );
	if ( scrGame ) {
		requireCalls( scrGame, ['RGPU_BeginFrame', 'R_RenderScene', 'RGPU_EndFrame'], issues );
		requireOrder( scrGame, ['RGPU_BeginFrame', 'R_RenderScene', 'RGPU_EndFrame'], issues );
	}

	const renderScene = getDefinition( graph, 'engine/com/client/screen/scr_draw.ts', 'R_RenderScene', issues );
	if ( renderScene ) {
		requireCalls( renderScene, ['RGPU_UploadFrameUniforms', 'RGPU_DrawWorld', 'RGPU_DrawEntitiesOnList'], issues );
		requireOrder( renderScene, ['RGPU_UploadFrameUniforms', 'RGPU_DrawWorld', 'RGPU_DrawEntitiesOnList'], issues );
	}

	const initBegin = getDefinition( graph, 'engine/com/client/screen/scr_draw/r_webgpu.ts', 'RGPU_InitBegin', issues );
	if ( initBegin ) {
		requireCalls( initBegin, ['RGPU_Shutdown', 'RGPU_SurfaceClaim', 'RGPU_DeviceStart'], issues );
		requireOrder( initBegin, ['RGPU_Shutdown', 'RGPU_SurfaceClaim', 'RGPU_DeviceStart'], issues );
	}

	const initPoll = getDefinition( graph, 'engine/com/client/screen/scr_draw/r_webgpu.ts', 'RGPU_InitPoll', issues );
	if ( initPoll ) {
		if ( initPoll.async || initPoll.awaitCount > 0 ) {
			issues.push( issue( initPoll, 'parent RGPU_InitPoll must be a synchronous poll/state transition' ) );
		}
		requireCalls( initPoll, ['RGPU_DevicePoll', 'RGPU_SurfaceConfigure', 'RGPU_StartResourceBuild'], issues );
	}

	const beginFrame = getDefinition( graph, 'engine/com/client/screen/scr_draw/r_webgpu.ts', 'RGPU_BeginFrame', issues );
	if ( beginFrame ) {
		requireCalls( beginFrame, ['RGPU_IsReady', 'RGPU_SurfaceAcquireView', 'RGPU_FrameBegin'], issues );
		requireOrder( beginFrame, ['RGPU_IsReady', 'RGPU_SurfaceAcquireView', 'RGPU_FrameBegin'], issues );
	}

	for ( const name of ['RGPU_UploadFrameUniforms', 'RGPU_DrawWorld', 'RGPU_DrawEntitiesOnList', 'RGPU_DrawParticles', 'RGPU_DrawViewModel'] ) {
		const definition = getDefinition( graph, 'engine/com/client/screen/scr_draw/r_webgpu.ts', name, issues );
		if ( definition ) {
			requireCalls( definition, ['RGPU_IsReady'], issues );
		}
	}

	for ( const name of ['RGPU_DrawLoadingFrame', 'RGPU_DrawFailedFrame'] ) {
		const definition = getDefinition( graph, 'engine/com/client/screen/scr_draw/r_webgpu.ts', name, issues );
		if ( definition ) {
			requireCalls( definition, ['RGPU_FrameBegin', 'RGPU_FrameEnd'], issues );
			requireOrder( definition, ['RGPU_FrameBegin', 'RGPU_FrameEnd'], issues );
		}
	}

	const endFrame = getDefinition( graph, 'engine/com/client/screen/scr_draw/r_webgpu.ts', 'RGPU_EndFrame', issues );
	if ( endFrame ) {
		requireCalls( endFrame, ['RGPU_FrameEnd'], issues );
	}
}


// ---------------------------------------------------------------------------
// public API & CLI entry point
// ---------------------------------------------------------------------------

/*
====================
verifyExecution

Scans the project from root, builds the static call graph, and runs all
execution invariant verification checks. Returns issues array, project, and graph.
====================
*/
export function verifyExecution( root = DEFAULT_ROOT ) {
	const project = scanProject( root );
	const graph = buildCallGraph( project );
	const issues = [...project.syntaxIssues];

	verifyNoTopLevelAwait( project, issues );
	verifyRafOwnership( graph, issues );
	verifyTaggedCadence( graph, issues );
	verifyFrameClosure( graph, issues );
	verifyCoreSequences( graph, issues );

	return { issues, project, graph };
}

if ( isMainModule( import.meta.url ) ) {
	try {
		const options = parseVerificationArgs( process.argv.slice( 2 ) );
		const result = verifyExecution( options.root );

		if ( options.json ) {
			console.log( JSON.stringify( {
				issues: result.issues,
				functions: result.graph.definitions.size,
				resolvedEdges: [...result.graph.outgoing.values()].reduce( ( sum, edges ) => sum + edges.length, 0 ),
			}, null, 2 ) );
		} else {
			printIssues( 'execution verification', result.issues );
			if ( result.issues.length === 0 ) {
				console.log( `  functions: ${result.graph.definitions.size}` );
				console.log( `  resolved call edges: ${[...result.graph.outgoing.values()].reduce( ( sum, edges ) => sum + edges.length, 0 )}` );
			}
		}

		process.exitCode = result.issues.length === 0 ? 0 : 1;
	} catch ( error ) {
		console.error( error instanceof Error ? error.stack : String( error ) );
		process.exitCode = 1;
	}
}
