/*
===============================================================================

	test_browser_build.mjs

	Call of Duty 2 / id Tech Browser Module Builder Integration Tests
	Exercises mutation testing against project compilation:
	- Unresolved alias and missing asset specifiers.
	- Bare and computed dynamic runtime imports.
	- Asset URL import validation and JSON syntax enforcement.
	- Output manifest tampering detection and orphan module analysis.

===============================================================================
*/

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBrowserModules } from '../../build/build_browser_modules.mjs';
import { smokeBrowserModules } from './smoke_browser_modules.mjs';
import { sha256Hex } from '../../lib/ts_project.mjs';

// ---------------------------------------------------------------------------
// constants & paths
// ---------------------------------------------------------------------------

const MODULE_DIR = path.dirname( fileURLToPath( import.meta.url ) );
const ROOT = path.resolve( MODULE_DIR, '../../..' );
const COPY_ENTRIES = [
	'assets',
	'engine',
	'public',
	'index.html',
	'index.ts',
	'tsconfig.json',
];


// ---------------------------------------------------------------------------
// test fixture & sandbox helpers
// ---------------------------------------------------------------------------

/*
====================
cloneProject

Creates an isolated temporary copy of the project tree for mutation testing.
====================
*/
function cloneProject() {
	const sandbox = fs.mkdtempSync( path.join( os.tmpdir(), 'id-webgpu-build-test-' ) );
	const root = path.join( sandbox, 'project' );
	fs.mkdirSync( root, { recursive: true } );

	for ( const entry of COPY_ENTRIES ) {
		const source = path.join( ROOT, entry );
		if ( !fs.existsSync( source ) ) {
			continue;
		}
		fs.cpSync( source, path.join( root, entry ), {
			recursive: true,
			force: true,
		} );
	}

	return { sandbox, root, dist: path.join( root, 'dist' ) };
}

/*
====================
replaceRequired

Replaces an exact text snippet in a fixture file or throws an error.
====================
*/
function replaceRequired( file, before, after ) {
	const source = fs.readFileSync( file, 'utf8' );
	if ( !source.includes( before ) ) {
		throw new Error( `test fixture text not found in ${file}: ${before}` );
	}
	fs.writeFileSync( file, source.replace( before, after ), 'utf8' );
}

/*
====================
refreshManifestFile

Recomputes the size and SHA-256 digest for an existing manifest entry.
====================
*/
function refreshManifestFile( dist, relative ) {
	const manifestPath = path.join( dist, 'build_manifest.json' );
	const manifest = JSON.parse( fs.readFileSync( manifestPath, 'utf8' ) );
	const entry = manifest.files.find( ( file ) => file.path === relative );
	if ( !entry ) {
		throw new Error( `manifest entry not found: ${relative}` );
	}
	const bytes = fs.readFileSync( path.join( dist, relative ) );
	entry.bytes = bytes.byteLength;
	entry.sha256 = sha256Hex( bytes );
	fs.writeFileSync( manifestPath, `${JSON.stringify( manifest, null, 2 )}\n`, 'utf8' );
}

/*
====================
addManifestFile

Appends a new file entry to the output manifest and preserves sorting.
====================
*/
function addManifestFile( dist, relative, kind ) {
	const manifestPath = path.join( dist, 'build_manifest.json' );
	const manifest = JSON.parse( fs.readFileSync( manifestPath, 'utf8' ) );
	const bytes = fs.readFileSync( path.join( dist, relative ) );

	manifest.files.push( {
		path: relative,
		kind,
		bytes: bytes.byteLength,
		sha256: sha256Hex( bytes ),
	} );

	manifest.files.sort( ( a, b ) => a.path.localeCompare( b.path ) );
	fs.writeFileSync( manifestPath, `${JSON.stringify( manifest, null, 2 )}\n`, 'utf8' );
}

/*
====================
expectPass

Executes an async test operation and asserts that it resolves without throwing.
====================
*/
async function expectPass( name, operation ) {
	try {
		await operation();
		return { name, passed: true };
	} catch ( error ) {
		return {
			name,
			passed: false,
			detail: `expected pass, received: ${error instanceof Error ? error.message : String( error )}`,
		};
	}
}

/*
====================
expectFail

Executes an async test operation and asserts that it rejects matching an expected regex.
====================
*/
async function expectFail( name, expected, operation ) {
	try {
		await operation();
		return { name, passed: false, detail: 'expected failure, operation passed' };
	} catch ( error ) {
		const message = error instanceof Error ? error.message : String( error );
		if ( !expected.test( message ) ) {
			return {
				name,
				passed: false,
				detail: `failure did not match ${expected}: ${message}`,
			};
		}
		return { name, passed: true };
	}
}

/*
====================
withProject

Runs an operation within a temporary sandboxed clone of the project.
====================
*/
async function withProject( operation ) {
	const fixture = cloneProject();
	try {
		return await operation( fixture );
	} finally {
		fs.rmSync( fixture.sandbox, { recursive: true, force: true } );
	}
}


// ---------------------------------------------------------------------------
// test cases
// ---------------------------------------------------------------------------

const cases = [
	() => expectPass( 'baseline build, link, manifest, and HTTP delivery', () => withProject( async ( { root, dist } ) => {
		buildBrowserModules( root, dist );
		await smokeBrowserModules( dist );
	} ) ),

	() => expectFail( 'unresolved alias is rejected', /cannot resolve browser module/, () => withProject( ( { root, dist } ) => {
		replaceRequired(
			path.join( root, 'index.ts' ),
			'@/engine/com/com.js',
			'@/engine/com/does_not_exist.js',
		);
		buildBrowserModules( root, dist );
	} ) ),

	() => expectFail( 'missing URL asset is rejected', /asset does not exist/, () => withProject( ( { root, dist } ) => {
		replaceRequired(
			path.join( root, 'engine/com/client/sound/sound.ts' ),
			'@/assets/sound/music/menu_GRTEMP.mp3?url',
			'@/assets/sound/music/missing.mp3?url',
		);
		buildBrowserModules( root, dist );
	} ) ),

	() => expectFail( 'bare runtime import is rejected', /bare runtime import is not browser-buildable/, () => withProject( ( { root, dist } ) => {
		const index = path.join( root, 'index.ts' );
		fs.writeFileSync( index, `import 'left-pad';\n${fs.readFileSync( index, 'utf8' )}`, 'utf8' );
		buildBrowserModules( root, dist );
	} ) ),

	() => expectFail( 'computed dynamic import is rejected', /computed dynamic import is not browser-buildable/, () => withProject( ( { root, dist } ) => {
		const index = path.join( root, 'index.ts' );
		fs.writeFileSync( index, `${fs.readFileSync( index, 'utf8' )}\nvoid import('./engine/' + 'com/com.js');\n`, 'utf8' );
		buildBrowserModules( root, dist );
	} ) ),

	() => expectFail( 'asset import without URL mode is rejected', /runtime import is not a code module/, () => withProject( ( { root, dist } ) => {
		const index = path.join( root, 'index.ts' );
		fs.writeFileSync(
			index,
			`import illegalAsset from '@/assets/images/3_cursor3.png';\nvoid illegalAsset;\n${fs.readFileSync( index, 'utf8' )}`,
			'utf8',
		);
		buildBrowserModules( root, dist );
	} ) ),

	() => expectFail( 'malformed imported JSON is rejected', /invalid JSON/, () => withProject( ( { root, dist } ) => {
		fs.writeFileSync( path.join( root, 'assets/fonts/normalFont.json' ), '{ invalid', 'utf8' );
		buildBrowserModules( root, dist );
	} ) ),

	() => expectFail( 'manifest detects output tampering', /manifest (?:size|hash) mismatch/, () => withProject( async ( { root, dist } ) => {
		buildBrowserModules( root, dist );
		fs.appendFileSync( path.join( dist, 'index.js' ), '\n// tampered\n', 'utf8' );
		await smokeBrowserModules( dist );
	} ) ),

	() => expectFail( 'module linker detects missing exports', /does not provide an export named/, () => withProject( async ( { root, dist } ) => {
		buildBrowserModules( root, dist );
		const entry = path.join( dist, 'index.js' );
		replaceRequired(
			entry,
			'import { Com_Init, Com_Shutdown, Com_BeginLoop }',
			'import { MissingComExport as Com_Init, Com_Shutdown, Com_BeginLoop }',
		);
		refreshManifestFile( dist, 'index.js' );
		await smokeBrowserModules( dist );
	} ) ),

	() => expectFail( 'unmanifested output file is rejected', /unmanifested file/, () => withProject( async ( { root, dist } ) => {
		buildBrowserModules( root, dist );
		fs.writeFileSync( path.join( dist, 'rogue.js' ), 'export const rogue = true;\n', 'utf8' );
		await smokeBrowserModules( dist );
	} ) ),

	() => expectFail( 'unreachable runtime module is rejected', /runtime modules unreachable/, () => withProject( async ( { root, dist } ) => {
		buildBrowserModules( root, dist );
		fs.writeFileSync( path.join( dist, 'orphan.js' ), 'export const orphan = true;\n', 'utf8' );
		addManifestFile( dist, 'orphan.js', 'module' );
		await smokeBrowserModules( dist );
	} ) ),
];


// ---------------------------------------------------------------------------
// test execution runner
// ---------------------------------------------------------------------------

const results = [];
for ( const run of cases ) {
	results.push( await run() );
}

const failed = results.filter( ( result ) => !result.passed );
if ( failed.length > 0 ) {
	console.error( `browser build self-test: failed (${failed.length}/${results.length})` );
	for ( const result of failed ) {
		console.error( `  - ${result.name}: ${result.detail}` );
	}
	process.exitCode = 1;
} else {
	console.log( `browser build self-test: ok (${results.length} mutation cases)` );
}
