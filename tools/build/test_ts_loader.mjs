/*
===============================================================================

	test_ts_loader.mjs

	Call of Duty 2 / id Tech Node TypeScript Custom Loader
	Resolves '@/...' aliases and maps '.js' specifiers to underlying '.ts'
	sources, transpiling TypeScript on-the-fly for Node test runners.

===============================================================================
*/

import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';

const root = fileURLToPath( new URL( '../..', import.meta.url ) );


// ---------------------------------------------------------------------------
// node loader hooks
// ---------------------------------------------------------------------------

/*
====================
resolve

Custom module resolution mapping root-relative aliases and .js imports to .ts files.
====================
*/
export async function resolve( specifier, context, next ) {
	if ( specifier.startsWith( '@/' ) ) {
		specifier = pathToFileURL( path.join( root, specifier.slice( 2 ) ) ).href;
	}

	if ( ( specifier.startsWith( '.' ) || specifier.startsWith( 'file:' ) ) && specifier.endsWith( '.js' ) ) {
		const candidate = new URL( specifier.slice( 0, -3 ) + '.ts', context.parentURL );
		if ( fs.existsSync( candidate ) ) {
			return { url: candidate.href, shortCircuit: true };
		}
	}

	return next( specifier, context );
}

/*
====================
load

Transpiles on-disk TypeScript files directly to ESNext JavaScript modules.
====================
*/
export async function load( url, context, next ) {
	if ( url.startsWith( 'file:' ) && url.endsWith( '.ts' ) ) {
		const source = fs.readFileSync( new URL( url ), 'utf8' );
		const transpiled = ts.transpileModule( source, {
			compilerOptions: {
				module: ts.ModuleKind.ESNext,
				target: ts.ScriptTarget.ES2022,
			},
		} );

		return {
			format: 'module',
			source: transpiled.outputText,
			shortCircuit: true,
		};
	}

	return next( url, context );
}
