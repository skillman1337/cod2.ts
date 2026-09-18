/*
===============================================================================

	verify_docs.mjs

	Check the generated atlas and local Markdown destinations in maintained
	entry documentation. No network calls and no inferred payment identities.

===============================================================================
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath( new URL( '../../', import.meta.url ) );
execFileSync( process.execPath, ['tools/build/build_readme_map.mjs'], { cwd: root, stdio: 'inherit' } );
const docs = ['README.md','CONTRIBUTING.md','SECURITY.md','THIRD_PARTY_NOTICES.md','docs/GITHUB-SETUP.md','docs/GITHUB-VERIFICATION.md','docs/SUPPORT.md','docs/OPERATIONS-MAP.md','docs/EXECUTION_MAP.md'];
let count = 0;
for ( const name of docs ) {
	const source = fs.readFileSync( path.join( root, name ), 'utf8' );
	const text = source.replace( /^```[^\n]*\n[\s\S]*?^```/gm, '' );
	for ( const match of text.matchAll( /!?\[[^\]\n]*\]\(([^)\s]+)\)/g ) ) {
		const url = match[1];
		if ( /^(?:https?:|mailto:|#)/.test( url ) ) continue;
		const [filename, fragment] = url.split( '#' );
		const target = path.resolve( path.dirname( path.join( root, name ) ), decodeURIComponent( filename ) );
		if ( !target.startsWith( root ) || !fs.existsSync( target ) ) throw new Error( `Broken local documentation link in ${name}: ${url}` );
		if ( fragment && /^L\d+/.test( fragment ) ) {
			const max = Math.max( ...fragment.match( /\d+/g ).map( Number ) );
			if ( max > fs.readFileSync( target, 'utf8' ).split( '\n' ).length ) throw new Error( `Invalid source line in ${name}: ${url}` );
		}
		count++;
	}
}
const funding = fs.readFileSync( path.join( root, '.github/FUNDING.yml' ), 'utf8' ).split( '\n' ).filter( line => !line.trim().startsWith( '#' ) ).join( '\n' );
if ( /YOUR_|PLACEHOLDER|example\.(?:com|org)|<[^>]+>/i.test( funding ) ) throw new Error( 'Do not activate placeholder funding destinations.' );
const workflow = fs.readFileSync( path.join( root, '.github/workflows/ci.yml' ), 'utf8' );
for ( const match of workflow.matchAll( /uses:\s+([^\s]+)/g ) ) {
	if ( !/^[^@]+@[a-f0-9]{40}$/.test( match[1] ) ) throw new Error( `Action must be SHA-pinned: ${match[1]}` );
}
console.log( `Documentation: ${docs.length} entry documents, ${count} local destinations, funding placeholders and action pins checked.` );
