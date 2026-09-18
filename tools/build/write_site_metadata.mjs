/*
===============================================================================

	write_site_metadata.mjs

	Public build identity and source-license pointers. No retail paths, user
	configuration, payment credentials or timestamps enter the artifact.

===============================================================================
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBase } from '../../browser/deployment.mjs';

const root = fileURLToPath( new URL( '../../', import.meta.url ) );
const dist = path.join( root, 'temp/dist' );
if ( !fs.existsSync( path.join( dist, 'index.html' ) ) ) throw new Error( 'Build the application before writing site metadata.' );
const base = normalizeBase( process.env.COD2_BASE_PATH || '/' );
const repository = process.env.GITHUB_REPOSITORY || null;
const revision = process.env.GITHUB_SHA || null;
if ( repository && !/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test( repository ) ) throw new Error( 'Invalid public repository identity.' );
if ( revision && !/^[a-f0-9]{40}$/i.test( revision ) ) throw new Error( 'Invalid source revision.' );
const info = {
	project: 'cod2.ts', base, revision,
	source: repository && revision ? `https://github.com/${repository}/tree/${revision}` : null,
	license: 'GPL-3.0-only', retailAssetsIncluded: false,
};
fs.writeFileSync( path.join( dist, 'build-info.json' ), JSON.stringify( info, null, 2 ) + '\n' );
for ( const [source, destination] of [['LICENSE', 'LICENSE.txt'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.txt']] ) {
	fs.copyFileSync( path.join( root, source ), path.join( dist, destination ) );
}
let html = fs.readFileSync( path.join( dist, 'index.html' ), 'utf8' );
html = html.replace( '</head>', `<link rel="license" href="${base}LICENSE.txt">\n  </head>` );
fs.writeFileSync( path.join( dist, 'index.html' ), html );
console.log( `Site metadata: ${base}; source ${revision || 'local/unrecorded'}.` );
