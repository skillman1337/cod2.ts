/*
===============================================================================

	verify_local_runtime.mjs

	Validate the source-only local asset build graph. No retail files required.
	This does NOT replace Vite's production bundle or a real browser integration.

===============================================================================
*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { assetSpecifier, runtimeFiles } from '../build/browser_assets_plugin.mjs';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '../..' );
const files = runtimeFiles( root, true );
let edges = 0, virtual = 0;

/*
====================
imports

Include dynamic imports: skeletal/world code deliberately sits off bootstrap.
====================
*/
function imports( name, text ) {
	const source = ts.createSourceFile( name, text, ts.ScriptTarget.Latest, true );
	const result = [];
	function visit( node ) {
		if ( ( ts.isImportDeclaration( node ) || ts.isExportDeclaration( node ) ) && node.moduleSpecifier && ts.isStringLiteral( node.moduleSpecifier ) ) result.push( node.moduleSpecifier.text );
		if ( ts.isCallExpression( node ) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral( node.arguments[0] ) ) result.push( node.arguments[0].text );
		ts.forEachChild( node, visit );
	}
	visit( source );
	return result;
}

for ( const [name, bytes] of files ) {
	if ( !/\.(?:m?js)$/.test( name ) ) continue;
	new vm.SourceTextModule( bytes.toString(), { identifier: name } );
	for ( const specifier of imports( name, bytes.toString() ) ) {
		const destination = specifier.startsWith( '/' ) ? specifier.slice( 1 ) : path.posix.normalize( path.posix.join( path.posix.dirname( name ), specifier ) );
		if ( !files.has( destination ) ) throw new Error( `${name}: missing emitted runtime dependency ${specifier}` );
		edges++;
	}
}
function walk( directory ) {
	for ( const entry of fs.readdirSync( directory, { withFileTypes: true } ) ) {
		const filename = path.join( directory, entry.name );
		if ( entry.isDirectory() ) walk( filename );
		else if ( filename.endsWith( '.ts' ) && !filename.endsWith( '.d.ts' ) ) {
			for ( const specifier of imports( filename, fs.readFileSync( filename, 'utf8' ) ) ) {
				if ( assetSpecifier( specifier, root ) ) virtual++;
			}
		}
	}
}
walk( path.join( root, 'engine' ) );
for ( const required of ['local-assets.sw.js', 'browser-runtime/import.worker.js', 'browser-runtime/demand.worker.js', 'browser-runtime/retail-asset-compiler.js'] ) {
	if ( !files.has( required ) ) throw new Error( `Missing required runtime ${required}` );
}
console.log( `Local runtime: ${files.size} emitted files, ${edges} resolved import edges, ${virtual} virtual asset imports; no retail files read.` );
