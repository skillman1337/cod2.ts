/*
===============================================================================

	site-publication.test.mjs

	Original miniature build fixtures exercise the Pages artifact verifier.
	A fixture pass is not a replacement for building the actual application.

===============================================================================
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath( new URL( '../../', import.meta.url ) );

/*
====================
fixture
====================
*/
function fixture( base ) {
	const directory = fs.mkdtempSync( path.join( os.tmpdir(), 'cod2-site-test-' ) );
	const put = ( name, data ) => {
		const target = path.join( directory, name );
		fs.mkdirSync( path.dirname( target ), { recursive: true } );
		fs.writeFileSync( target, data );
	};
	put( 'index.html', `<meta name="cod2-base" content="${base}"><script type="module" src="${base}app-code/main.js"></script><link rel="license" href="${base}LICENSE.txt">` );
	put( 'app-code/main.js', "import './part.js'; export async function load() { return import('./part.js'); }" );
	put( 'app-code/part.js', 'export const originalFixture = true;' );
	put( 'local-assets.sw.js', "import './browser-runtime/deployment.mjs';" );
	put( 'browser-runtime/deployment.mjs', `export const APP_BASE = '${base}';` );
	put( 'browser-runtime/import.worker.js', "import './deployment.mjs';" );
	put( 'browser-runtime/demand.worker.js', "import './deployment.mjs';" );
	put( 'LICENSE.txt', 'Original synthetic license placeholder. Not distributed as the application license.' );
	put( 'THIRD_PARTY_NOTICES.txt', 'Synthetic fixture: no third-party content.' );
	put( 'build-info.json', JSON.stringify( { base, retailAssetsIncluded: false } ) );
	return { directory, put, run: () => spawnSync( process.execPath, ['tools/verify/verify_site.mjs', '--base', base, '--dist', directory], { cwd: root, encoding: 'utf8', timeout: 20_000 } ) };
}

for ( const base of ['/', '/cod2.ts/', '/nested/cod2-ts/'] ) {
	test( `publication verifier accepts a complete code-only fixture at ${base}`, () => {
		const f = fixture( base );
		try { const result = f.run(); assert.equal( result.status, 0, result.stderr ); }
		finally { fs.rmSync( f.directory, { recursive: true, force: true } ); }
	} );
}

const mutations = [
	['domain-root module import', f => f.put( 'app-code/main.js', "import '/app-code/part.js';" ), /escaped base/],
	['missing module', f => f.put( 'app-code/main.js', "import './missing.js';" ), /Missing emitted resource/],
	['missing dedicated worker', f => fs.unlinkSync( path.join( f.directory, 'browser-runtime/demand.worker.js' ) ), /Required site file missing/],
	['source archive', f => f.put( 'main/iw_00.iwd', 'synthetic bytes' ), /Private\/retail content/],
	['executable with innocent extension', f => f.put( 'app-code/hidden.txt', Buffer.from( '7f454c460000', 'hex' ) ), /Executable in site/],
	['wrong base in build metadata', f => f.put( 'build-info.json', JSON.stringify( { base: '/', retailAssetsIncluded: false } ) ), /Invalid public build metadata/],
	['outside-scope stylesheet URL', f => f.put( 'app-code/style.css', 'a { background: url(/private.png); }' ), /escaped base/],
	['symlink to a private path', f => fs.symlinkSync( '/private/not-real', path.join( f.directory, 'leak' ) ), /Publication symlink/],
];
for ( const [name, mutate, message] of mutations ) {
	test( `publication verifier rejects ${name}`, ( t ) => {
		const f = fixture( '/cod2.ts/' );
		try {
			try {
				mutate( f );
			} catch ( error ) {
				if ( ( error?.code === 'EPERM' || error?.code === 'ENOSYS' ) && process.platform === 'win32' ) {
					t.skip( 'Platform does not permit symlink creation without elevated privileges' );
					return;
				}
				throw error;
			}
			const result = f.run();
			assert.notEqual( result.status, 0 );
			assert.match( result.stderr, message );
		} finally {
			fs.rmSync( f.directory, { recursive: true, force: true } );
		}
	} );
}
