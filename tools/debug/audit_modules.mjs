/*
===============================================================================

	audit_modules.mjs

	Reproducible module size/import inventory. Review signals, not SRP verdicts.

===============================================================================
*/
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '../..' );
const records = [];
function walk( directory ) {
	for ( const entry of fs.readdirSync( directory, { withFileTypes: true } ) ) {
		if ( ['tests', 'third_party', '__pycache__'].includes( entry.name ) ) continue;
		const filename = path.join( directory, entry.name );
		if ( entry.isDirectory() ) { walk( filename ); continue; }
		if ( !/\.(?:ts|mjs|js)$/.test( filename ) || filename.endsWith( '.d.ts' ) ) continue;
		const text = fs.readFileSync( filename, 'utf8' ), source = ts.createSourceFile( filename, text, ts.ScriptTarget.Latest, true );
		let imports = 0, dynamicImports = 0;
		function visit( node ) {
			if ( ts.isImportDeclaration( node ) ) imports++;
			if ( ts.isCallExpression( node ) && node.expression.kind === ts.SyntaxKind.ImportKeyword ) dynamicImports++;
			ts.forEachChild( node, visit );
		}
		visit( source );
		const lines = text.split( '\n' ).length;
		records.push( { path: path.relative( root, filename ).replaceAll( '\\', '/' ), lines, imports, dynamicImports, bytes: Buffer.byteLength( text ), review: lines > 750 || imports > 12 } );
	}
}
for ( const directory of ['browser', 'engine'] ) walk( path.join( root, directory ) );
records.sort( ( a, b ) => b.lines - a.lines || a.path.localeCompare( b.path ) );
process.stdout.write( JSON.stringify( records, null, 2 ) + '\n' );
