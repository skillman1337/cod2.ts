/*
===============================================================================

	verify_release.mjs

	Inspect tracked/staged filenames and native magic before publishing source.
	This is a hygiene check, not a copyright, secret or provenance certification.

===============================================================================
*/
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '../..' );
let names;
try {
	names = execFileSync( 'git', ['ls-files', '--cached', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] } ).split( '\0' ).filter( Boolean );
} catch {
	throw new Error( 'Initialize Git and stage the intended source before this check. The Git index, not .gitignore alone, determines what will be published.' );
}
if ( !names.length ) throw new Error( 'No tracked/staged source to inspect.' );
const blocked = /(?:^|\/)(?:node_modules|temp|\.env(?:\..*)?|cod2mp_[^/]*)(?:\/|$)|^(?:assets|maps|viewmodels|characters|weaponfx|sound|retail|dist)\/|(?:^|\/)Trace-[^/]*|\.(?:iwd|iwi|d3dbsp|bc3|exe|dll|so|dylib|bin|ttf|otf|woff2?|fnt|mp3|wav|ogg|heapsnapshot|cpuprofile)$/i;
const failures = [];
for ( const name of names ) {
	if ( blocked.test( name ) ) { failures.push( name ); continue; }
	const filename = path.join( root, name );
	if ( !fs.existsSync( filename ) ) continue;
	const stat = fs.lstatSync( filename );
	if ( stat.isSymbolicLink() ) { failures.push( `${name}: symbolic link requires manual review` ); continue; }
	if ( stat.size > 5 * 1024 * 1024 ) { failures.push( `${name}: unexpectedly large source file` ); continue; }
	const bytes = fs.readFileSync( filename ), magic = bytes.subarray( 0, 4 ).toString( 'hex' );
	if ( ['7f454c46', 'cefaedfe', 'cffaedfe', 'feedface', 'feedfacf', 'cafebabe'].includes( magic ) || bytes.subarray( 0, 2 ).toString() === 'MZ' ) failures.push( `${name}: executable magic` );
}
if ( failures.length ) throw new Error( 'Remove these files from the index before publishing:\n' + failures.join( '\n' ) );
console.log( `Release source hygiene: ${names.length} tracked/staged files checked; no blocked path or native executable detected.` );
