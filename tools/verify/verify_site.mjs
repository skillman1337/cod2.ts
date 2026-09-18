/*
===============================================================================

	verify_site.mjs

	Check the actual publish directory, not merely source code. Runtime import
	graphs and HTML resources must stay within the selected deployment base.
	This is a release hygiene check, not a copyright or secret certification.

===============================================================================
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { normalizeBase } from '../../browser/deployment.mjs';

const { values } = parseArgs( { options: { base: { type: 'string', default: process.env.COD2_BASE_PATH || '/' }, dist: { type: 'string', default: 'temp/dist' } } } );
const root = fileURLToPath( new URL( '../../', import.meta.url ) );
const dist = path.resolve( root, values.dist ), base = normalizeBase( values.base );
const origin = 'https://site.invalid';
const names = [];
/*
====================
walk
====================
*/
function walk( folder, prefix = '' ) {
	for ( const entry of fs.readdirSync( folder, { withFileTypes: true } ) ) {
		const name = prefix + entry.name, file = path.join( folder, entry.name );
		if ( entry.isSymbolicLink() ) throw new Error( `Publication symlink: ${name}` );
		if ( entry.isDirectory() ) walk( file, name + '/' );
		else names.push( name );
	}
}
walk( dist );
const files = new Set( names );
const blocked = /^(?:assets|maps|sound|viewmodels|characters|weaponfx|retail|node_modules|browser\/tests)\/|(?:^|\/)(?:\.env(?:\..*)?|Trace-[^/]*|cod2mp_[^/]*)$|\.(?:iwd|iwi|d3dbsp|bc3|bin|exe|dll|so|dylib|ttf|otf|woff2?|fnt|mp3|wav|ogg|cpuprofile|heapsnapshot)$/i;
let size = 0, imports = 0;
for ( const name of names ) {
	if ( blocked.test( name ) ) throw new Error( `Private/retail content in site: ${name}` );
	const data = fs.readFileSync( path.join( dist, name ) ); size += data.length;
	if ( data.length > 8 * 1024 * 1024 ) throw new Error( `Unexpectedly large public file: ${name}` );
	const magic = data.subarray( 0, 4 ).toString( 'hex' );
	if ( ['7f454c46','cefaedfe','cffaedfe','feedface','feedfacf','cafebabe'].includes( magic ) || data.subarray( 0, 2 ).toString() === 'MZ' ) throw new Error( `Executable in site: ${name}` );
	if ( !/\.(?:m?js)$/.test( name ) ) continue;
	const source = ts.createSourceFile( name, data.toString(), ts.ScriptTarget.Latest, true );
	function visit( node ) {
		let specifier;
		if ( ( ts.isImportDeclaration( node ) || ts.isExportDeclaration( node ) ) && node.moduleSpecifier && ts.isStringLiteral( node.moduleSpecifier ) ) specifier = node.moduleSpecifier.text;
		if ( ts.isCallExpression( node ) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0 && ts.isStringLiteral( node.arguments[0] ) ) specifier = node.arguments[0].text;
		if ( specifier ) { checkURL( specifier, name ); imports++; }
		ts.forEachChild( node, visit );
	}
	visit( source );
}
/*
====================
checkURL
====================
*/
function checkURL( value, from ) {
	if ( value.startsWith( 'data:' ) ) return;
	if ( !value.startsWith( '.' ) && !value.startsWith( '/' ) ) throw new Error( `External/bare resource in ${from}: ${value}` );
	const url = new URL( value, origin + base + from );
	if ( url.origin !== origin || !url.pathname.startsWith( base ) ) throw new Error( `Resource escaped base in ${from}: ${value}` );
	const target = decodeURIComponent( url.pathname.slice( base.length ) );
	if ( !files.has( target ) ) throw new Error( `Missing emitted resource in ${from}: ${value}` );
}
const html = fs.readFileSync( path.join( dist, 'index.html' ), 'utf8' );
if ( !html.includes( `name="cod2-base" content="${base}"` ) ) throw new Error( 'Built HTML has the wrong deployment base.' );
for ( const match of html.matchAll( /(?:src|href)="([^"]+)"/g ) ) checkURL( match[1], 'index.html' );
for ( const name of names.filter( name => name.endsWith( '.css' ) ) ) {
	for ( const match of fs.readFileSync( path.join( dist, name ), 'utf8' ).matchAll( /url\(\s*["']?([^)'"\s]+)["']?\s*\)/g ) ) {
		let url = match[1]; if ( !url.startsWith( '/' ) && !url.startsWith( 'data:' ) ) url = './' + url;
		checkURL( url, name );
	}
}
for ( const name of ['local-assets.sw.js','browser-runtime/import.worker.js','browser-runtime/demand.worker.js','browser-runtime/deployment.mjs','LICENSE.txt','THIRD_PARTY_NOTICES.txt','build-info.json'] ) {
	if ( !files.has( name ) ) throw new Error( `Required site file missing: ${name}` );
}
const info = JSON.parse( fs.readFileSync( path.join( dist, 'build-info.json' ) ) );
if ( info.base !== base || info.retailAssetsIncluded !== false ) throw new Error( 'Invalid public build metadata.' );
if ( size > 30 * 1024 * 1024 ) throw new Error( 'Code-only site exceeded the 30 MiB publication budget.' );
console.log( `Public site: ${names.length} files, ${imports} module references, ${size} bytes; base ${base}; no blocked retail paths.` );
