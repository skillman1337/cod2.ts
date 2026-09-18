#!/usr/bin/env node
/*
===============================================================================

	test_verification.mjs

	Call of Duty 2 / id Tech Static Verifier Mutation Self-Tests
	Validates that the project verifiers reliably catch architectural violations:
	- Ownership boundaries, encapsulation leaks, and circular dependencies.
	- WebGPU device leaks, forbidden child passes, and AbortSignal propagation.
	- Async execution leaks, invalid @exec tags, and frame ordering inversions.

===============================================================================
*/

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_ROOT } from '../../lib/ts_project.mjs';
import { verifyExecution } from '../../verify/verify_execution.mjs';
import { verifyOwnership } from '../../verify/verify_ownership.mjs';
import { verifyWebGPUArchitecture } from '../../verify/verify_webgpu_architecture.mjs';

// ---------------------------------------------------------------------------
// paths & target files
// ---------------------------------------------------------------------------

const SCRIPT_PATH = fileURLToPath( import.meta.url );
const INPUT_FILE = 'engine/com/client/input/input.ts';
const CLIENT_FILE = 'engine/com/client/cl_main.ts';
const CL_STATE_FILE = 'engine/com/client/cl_main/cl_state.ts';
const MENU_FILE = 'engine/com/client/screen/scr_draw/rgpu/rgpu_menu/rgpu_menu.ts';
const INIT_FILE = 'engine/com/client/screen/scr_draw/rgpu/rgpu_init.ts';
const SURFACE_FILE = 'engine/com/client/screen/scr_draw/rgpu/rgpu_surface.ts';
const COM_FILE = 'engine/com/com.ts';
const PARENT_FILE = 'engine/com/client/screen/scr_draw/r_webgpu.ts';
const SCREEN_FILE = 'engine/com/client/screen/scr_draw.ts';
const UI_LAYOUT_FILE = 'engine/common/ui_layout.ts';


// ---------------------------------------------------------------------------
// project copy & mutation helpers
// ---------------------------------------------------------------------------

/*
====================
copyProject

Recursively copies the engine code, root entry, and tsconfig into a test destination.
====================
*/
function copyProject( source, destination ) {
	fs.mkdirSync( destination, { recursive: true } );
	for ( const relative of ['engine', 'index.ts', 'tsconfig.json'] ) {
		fs.cpSync( path.join( source, relative ), path.join( destination, relative ), {
			recursive: true,
			force: true,
		} );
	}
}

/*
====================
append

Appends text to a relative file in the target project root.
====================
*/
function append( root, relative, text ) {
	fs.appendFileSync( path.join( root, relative ), `\n${text}\n`, 'utf8' );
}

/*
====================
replaceRequired

Replaces an exact source snippet in a relative file or asserts if not found.
====================
*/
function replaceRequired( root, relative, before, after ) {
	const absolute = path.join( root, relative );
	const source = fs.readFileSync( absolute, 'utf8' );
	assert.ok( source.includes( before ), `${relative}: self-test mutation anchor is missing: ${JSON.stringify( before )}` );
	fs.writeFileSync( absolute, source.replaceAll( before, after ), 'utf8' );
}

/*
====================
issueText

Formats issue diagnostics from a verification run into a single string.
====================
*/
function issueText( result ) {
	return result.issues.map( ( issue ) => `${issue.file ?? '<project>'}: ${issue.message}` ).join( '\n' );
}

/*
====================
assertPass

Asserts that a verifier reports zero issues.
====================
*/
function assertPass( name, verifier, root ) {
	const result = verifier( root );
	assert.equal( result.issues.length, 0, `${name} unexpectedly failed:\n${issueText( result )}` );
}

/*
====================
assertRejects

Asserts that a verifier reports issues matching an expected regex pattern.
====================
*/
function assertRejects( name, verifier, root, expected ) {
	const result = verifier( root );
	const text = issueText( result );
	assert.ok( result.issues.length > 0, `${name} unexpectedly passed` );
	assert.match( text, expected, `${name} failed, but not for the expected invariant:\n${text}` );
}

/*
====================
mutateManifest

Modifies engine/ownership.json for an ownership verification test case.
====================
*/
function mutateManifest( root, mutate ) {
	const absolute = path.join( root, 'engine/ownership.json' );
	const manifest = JSON.parse( fs.readFileSync( absolute, 'utf8' ) );
	mutate( manifest );
	fs.writeFileSync( absolute, `${JSON.stringify( manifest, null, 2 )}\n`, 'utf8' );
}

/*
====================
makeCaseRoot

Copies the baseline test tree into a dedicated directory for a single mutation case.
====================
*/
function makeCaseRoot( tempRoot, baseline, name ) {
	const root = path.join( tempRoot, name.replaceAll( /[^a-zA-Z0-9_-]/g, '_' ) );
	fs.cpSync( baseline, root, { recursive: true, force: true } );
	return root;
}

/*
====================
runMutationCase

Executes a single mutation test case against the target verifier.
====================
*/
function runMutationCase( tempRoot, baseline, spec ) {
	const root = makeCaseRoot( tempRoot, baseline, spec.name );
	spec.mutate( root );
	if ( spec.pass ) {
		assertPass( spec.name, spec.verify, root );
	} else {
		assertRejects( spec.name, spec.verify, root, spec.expected );
	}
	console.log( `  ok - ${spec.name}` );
}


// ---------------------------------------------------------------------------
// verification test runner
// ---------------------------------------------------------------------------

/*
====================
runVerificationSelfTests

Executes the complete suite of verification self-test mutations.
====================
*/
export function runVerificationSelfTests( projectRoot = DEFAULT_ROOT ) {
	const tempRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'webgpu-verifier-selftest-' ) );
	const baseline = path.join( tempRoot, 'baseline' );

	try {
		copyProject( projectRoot, baseline );

		assertPass( 'ownership baseline', verifyOwnership, baseline );
		assertPass( 'WebGPU architecture baseline', verifyWebGPUArchitecture, baseline );
		assertPass( 'execution baseline', verifyExecution, baseline );
		console.log( 'verification self-test baselines: ok' );

		const ownershipCases = [
			{
				name: 'comments and strings do not forge import edges',
				verify: verifyOwnership,
				pass: true,
				mutate: ( root ) => append( root, INPUT_FILE, `const verifier_fake_import = "import '../sound/sound.js'";\n/* import '../sound/sound.js'; */` ),
			},
			{
				name: 'side-effect sibling import is rejected',
				verify: verifyOwnership,
				expected: /illegal import: .* may not reach .*sound\/sound\.ts/,
				mutate: ( root ) => append( root, INPUT_FILE, `import '../sound/sound.js';` ),
			},
			{
				name: 'cross-subsystem internal import is rejected',
				verify: verifyOwnership,
				expected: /package-private file .* cannot be imported by/,
				mutate: ( root ) => append( root, CL_STATE_FILE, `import '../screen/scr_draw/rgpu/internal/rgpu_draw_contract.js';` ),
			},
			{
				name: 'internal file importing its parent is rejected',
				verify: verifyOwnership,
				expected: /internal file .* imports its parent module/,
				mutate: ( root ) => append( root, 'engine/com/client/screen/scr_draw/rgpu/internal/rgpu_draw_contract.ts', `import '../rgpu_draw.js';` ),
			},
			{
				name: 'index importing child internal file is rejected',
				verify: verifyOwnership,
				expected: /package-private file .* cannot be imported by/,
				mutate: ( root ) => append( root, 'index.ts', `import './engine/com/client/screen/scr_draw/rgpu/internal/rgpu_draw_contract.js';` ),
			},
			{
				name: 'cycle detection finds indirect loops',
				verify: verifyOwnership,
				expected: /runtime import cycle:/,
				mutate: ( root ) => append( root, 'engine/com/client/screen/scr_draw.ts', `import '../../com.js';` ),
			},
			{
				name: 'untracked file in engine is rejected',
				verify: verifyOwnership,
				expected: /engine\/untracked\.ts is not classified in engine\/ownership\.json/,
				mutate: ( root ) => append( root, 'engine/untracked.ts', `export const untracked = true;` ),
			},
			{
				name: 'missing manifest file is rejected',
				verify: verifyOwnership,
				expected: /manifest entry does not exist or is not an engine\/com TypeScript file/,
				mutate: ( root ) => mutateManifest( root, ( manifest ) => {
					manifest.modules['engine/com/does_not_exist.ts'] = 'engine/com/com.ts';
				} ),
			},
			{
				name: 'duplicate module entry is rejected',
				verify: verifyOwnership,
				expected: /is listed as both a module and an internal/,
				mutate: ( root ) => mutateManifest( root, ( manifest ) => {
					manifest.internals['engine/com/com.ts'] = 'engine/com/com.ts';
				} ),
			},
			{
				name: 'multiple owners for one file is rejected',
				verify: verifyOwnership,
				expected: /lifecycle child must live in a subfolder of owner/,
				mutate: ( root ) => mutateManifest( root, ( manifest ) => {
					manifest.modules['engine/com/client/cl_main.ts'] = 'engine/com/server/sv_main.ts';
				} ),
			},
			{
				name: 'unreachable root module is rejected',
				verify: verifyOwnership,
				expected: /declared owner .* must have a runtime import\/export edge to this module/,
				mutate: ( root ) => {
					append( root, 'engine/com/orphan.ts', `export const orphan = true;` );
					mutateManifest( root, ( manifest ) => {
						manifest.modules['engine/com/orphan.ts'] = 'index.ts';
					} );
				},
			},
			{
				name: 'relative parent escape is rejected',
				verify: verifyOwnership,
				expected: /illegal parent-directory traversal|unresolved local code/,
				mutate: ( root ) => append( root, 'index.ts', `import '../outside.js';` ),
			},
		];

		const webgpuCases = [
			{
				name: 'adapter request outside rgpu_init is rejected',
				verify: verifyWebGPUArchitecture,
				expected: /GPU adapter requests belong exclusively to rgpu_init\.ts/,
				mutate: ( root ) => append( root, MENU_FILE, `void navigator.gpu?.requestAdapter();` ),
			},
			{
				name: 'device request outside rgpu_init is rejected',
				verify: verifyWebGPUArchitecture,
				expected: /GPU device requests belong exclusively to rgpu_init\.ts/,
				mutate: ( root ) => append( root, MENU_FILE, `function rgpu_leak(adapter: GPUAdapter) { void adapter.requestDevice(); }` ),
			},
			{
				name: 'direct device property on draw contract is rejected',
				verify: verifyWebGPUArchitecture,
				expected: /GPUDevice is a raw WebGPU capability and is not allowed in this module/,
				mutate: ( root ) => replaceRequired(
					root,
					'engine/com/client/screen/scr_draw/rgpu/internal/rgpu_draw_contract.ts',
					'export interface rgpu_draw_resources_t {',
					'export interface rgpu_draw_resources_t {\n\tdevice: GPUDevice;',
				),
			},
			{
				name: 'canvas context configure outside rgpu_surface is rejected',
				verify: verifyWebGPUArchitecture,
				expected: /GPUCanvasContext\.configure belongs exclusively to rgpu_surface\.ts/,
				mutate: ( root ) => append( root, MENU_FILE, `function rgpu_leak(context: GPUCanvasContext) { void context.configure({} as any); }` ),
			},
			{
				name: 'direct canvas context access on r_webgpu is rejected',
				verify: verifyWebGPUArchitecture,
				expected: /getContext\('webgpu'\) belongs exclusively to rgpu_surface\.ts/,
				mutate: ( root ) => append( root, PARENT_FILE, `function rgpu_leak(canvas: HTMLCanvasElement) { void canvas.getContext('webgpu'); }` ),
			},
			{
				name: 'command encoder creation outside rgpu_frame is rejected',
				verify: verifyWebGPUArchitecture,
				expected: /command-encoder creation is restricted/,
				mutate: ( root ) => append( root, MENU_FILE, `function rgpu_leak(device: GPUDevice) { void device.createCommandEncoder(); }` ),
			},
			{
				name: 'beginRenderPass outside rgpu_frame is rejected',
				verify: verifyWebGPUArchitecture,
				expected: /render-pass lifetime belongs exclusively to rgpu_frame\.ts/,
				mutate: ( root ) => append( root, MENU_FILE, `function rgpu_leak(encoder: GPUCommandEncoder) { void encoder.beginRenderPass({} as any); }` ),
			},
			{
				name: 'child receiving parent device epoch is rejected',
				verify: verifyWebGPUArchitecture,
				expected: /renderer children must not receive the parent device epoch/,
				mutate: ( root ) => append( root, MENU_FILE, `const leaked_epoch: rgpu_device_epoch_t = {} as any;` ),
			},
			{
				name: 'device adoption epoch requirement is enforced',
				verify: verifyWebGPUArchitecture,
				expected: /device adoption must create a cancelable child-resource epoch/,
				mutate: ( root ) => replaceRequired(
					root,
					PARENT_FILE,
					'new AbortController()',
					'null as any',
				),
			},
			{
				name: 'menu policy parent requirement is enforced',
				verify: verifyWebGPUArchitecture,
				expected: /the initial menu policy must be an explicit client-parent decision/,
				mutate: ( root ) => replaceRequired(
					root,
					CLIENT_FILE,
					'SCR_MenuSetActive( true );',
					'/* removed */',
				),
			},
			{
				name: 'menu overlay intent requirement is enforced',
				verify: verifyWebGPUArchitecture,
				expected: /menu drawing decisions must be gated by explicit UI intent/,
				mutate: ( root ) => replaceRequired(
					root,
					PARENT_FILE,
					'menu_overlay && RGPU_MenuResourcesReady()',
					'RGPU_MenuResourcesReady()',
				),
			},
			{
				name: 'duplicate UI constant values are rejected',
				verify: verifyWebGPUArchitecture,
				expected: /must have exactly one canonical declaration in/,
				mutate: ( root ) => replaceRequired(
					root,
					UI_LAYOUT_FILE,
					'export const UI_HORZ_ALIGN_FULLSCREEN = 4;',
					'export const UI_HORZ_ALIGN_FULLSCREEN = 4;\nexport const UI_HORZ_ALIGN_FULLSCREEN = 4;',
				),
			},
			{
				name: 'unexported child draw helper is rejected',
				verify: verifyWebGPUArchitecture,
				expected: /exported child API .* exposes a raw parent WebGPU capability/,
				mutate: ( root ) => append(
					root,
					MENU_FILE,
					'export function RGPU_BadLeak( device: GPUDevice ) {}',
				),
			},
		];

		const executionCases = [
			{
				name: 'top-level await is rejected',
				verify: verifyExecution,
				expected: /top-level await is forbidden/,
				mutate: ( root ) => append( root, 'index.ts', `await Promise.resolve();` ),
			},
			{
				name: 'per-frame function cannot become async',
				verify: verifyExecution,
				expected: /@exec per-frame function must be synchronous|reachable from Com_RafCallback must be synchronous/,
				mutate: ( root ) => replaceRequired( root, COM_FILE, `export function Com_Frame(`, `export async function Com_Frame(` ),
			},
			{
				name: 'frame spine ordering is enforced',
				verify: verifyExecution,
				expected: /call sequence must be Com_HandleVidResize -> Com_Frame -> requestAnimationFrame/,
				mutate: ( root ) => replaceRequired(
					root,
					COM_FILE,
					`\tCom_HandleVidResize();\n\tCom_Frame( now_ms );`,
					`\tCom_Frame( now_ms );\n\tCom_HandleVidResize();`,
				),
			},
			{
				name: 'index cannot bypass the engine root',
				verify: verifyExecution,
				expected: /index\.ts must not bypass com\.ts by calling RGPU_BadBypass/,
				mutate: ( root ) => append( root, 'index.ts', `function Main_BadBypass(): void { RGPU_BadBypass(); }` ),
			},
			{
				name: 'invalid cadence tags are rejected',
				verify: verifyExecution,
				expected: /invalid @exec value "sometimes"/,
				mutate: ( root ) => append( root, COM_FILE, `/** @exec sometimes */\nfunction Com_BadCadence(): void {}` ),
			},
			{
				name: 'indirect frame closure cannot become async',
				verify: verifyExecution,
				expected: /reachable from Com_RafCallback must be synchronous/,
				mutate: ( root ) => replaceRequired(
					root,
					COM_FILE,
					`function Com_RunServerClientFrames(`,
					`async function Com_RunServerClientFrames(`,
				),
			},
		];

		for ( const spec of [...ownershipCases, ...webgpuCases, ...executionCases] ) {
			runMutationCase( tempRoot, baseline, spec );
		}

		const total = ownershipCases.length + webgpuCases.length + executionCases.length;
		console.log( `verification mutation self-tests: ok (${total} rejection/pass cases)` );
		return { total };
	} finally {
		fs.rmSync( tempRoot, { recursive: true, force: true } );
	}
}


// ---------------------------------------------------------------------------
// cli entry
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && path.resolve( process.argv[1] ) === SCRIPT_PATH;
if ( isMain ) {
	try {
		runVerificationSelfTests();
	} catch ( error ) {
		console.error( error instanceof Error ? error.message : String( error ) );
		process.exitCode = 1;
	}
}
