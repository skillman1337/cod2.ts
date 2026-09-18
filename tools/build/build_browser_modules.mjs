/*
===============================================================================

	build_browser_modules.mjs

	Call of Duty 2 / id Tech Browser Module Compiler & Standalone Packager
	Compiles and transforms TypeScript source files into standalone browser-ready
	ES2022 JavaScript modules, resolving virtual asset imports and generating
	verification build manifests.

===============================================================================
*/

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	DEFAULT_ROOT,
	exportDeclarationIsTypeOnly,
	importClauseIsTypeOnly,
	isInside,
	isLocalCodeSpecifier,
	loadTypeScript,
	projectSourcePaths,
	repoRelative,
	resolveLocalImport,
	scanProject,
	sha256Hex,
	toPosix,
	walkFiles,
} from '../lib/ts_project.mjs';


// ---------------------------------------------------------------------------
// constants & paths
// ---------------------------------------------------------------------------

const MODULE_DIR = path.dirname( fileURLToPath( import.meta.url ) );
const DEFAULT_OUTPUT = path.resolve( MODULE_DIR, '../../dist' );
const BUILD_MANIFEST = 'build_manifest.json';


// ---------------------------------------------------------------------------
// CLI arguments & containment verification
// ---------------------------------------------------------------------------

/*
====================
parseArguments

Parses CLI options (--check, --out <directory>).
====================
*/
function parseArguments( argv ) {
	const result = {
		check: false,
		output: DEFAULT_OUTPUT,
	};

	for ( let index = 0; index < argv.length; index += 1 ) {
		const argument = argv[index];
		if ( argument === '--check' ) {
			result.check = true;
			continue;
		}
		if ( argument === '--out' ) {
			const value = argv[index + 1];
			if ( !value ) {
				throw new Error( '--out requires a directory' );
			}
			result.output = path.resolve( value );
			index += 1;
			continue;
		}
		throw new Error( `unknown argument: ${argument}` );
	}

	if ( result.check && result.output !== DEFAULT_OUTPUT ) {
		throw new Error( '--check and --out cannot be combined' );
	}

	return result;
}

/*
====================
assertInside

Throws an error if candidate path escapes the designated parent directory.
====================
*/
function assertInside( parent, candidate, label ) {
	if ( !isInside( parent, candidate ) ) {
		throw new Error( `${label} escapes project root: ${candidate}` );
	}
}

/*
====================
emittedPath

Computes the target output path for a given TypeScript source file.
====================
*/
function emittedPath( root, outputRoot, sourcePath ) {
	assertInside( root, sourcePath, 'source path' );
	const relative = path.relative( root, sourcePath );
	const withoutExtension = relative.replace( /\.(?:[cm]?ts|tsx)$/i, '' );
	return path.join( outputRoot, `${withoutExtension}.js` );
}

/*
====================
browserSpecifier

Computes a relative browser module specifier from one output file to another.
====================
*/
function browserSpecifier( fromOutput, toOutput ) {
	let relative = toPosix( path.relative( path.dirname( fromOutput ), toOutput ) );
	if ( !relative.startsWith( '.' ) ) {
		relative = `./${relative}`;
	}
	return relative;
}

/*
====================
splitSpecifier

Splits a module specifier into clean path and query/hash suffix.
====================
*/
function splitSpecifier( specifier ) {
	const marker = specifier.search( /[?#]/ );
	if ( marker < 0 ) {
		return { path: specifier, suffix: '' };
	}
	return { path: specifier.slice( 0, marker ), suffix: specifier.slice( marker ) };
}

/*
====================
hasUrlQuery

Returns true if suffix contains a ?url query parameter.
====================
*/
function hasUrlQuery( suffix ) {
	if ( !suffix.startsWith( '?' ) ) {
		return false;
	}
	const query = suffix.slice( 1 ).split( '#', 1 )[0];
	return new URLSearchParams( query ).has( 'url' );
}

/*
====================
resolveProjectFile

Resolves a module or asset specifier against the source project root.
====================
*/
function resolveProjectFile( root, sourcePath, specifier ) {
	const split = splitSpecifier( specifier );
	let absolute;

	if ( split.path.startsWith( '@/' ) ) {
		absolute = path.resolve( root, split.path.slice( 2 ) );
	} else if ( split.path.startsWith( '.' ) ) {
		absolute = path.resolve( path.dirname( sourcePath ), split.path );
	} else {
		return null;
	}

	assertInside( root, absolute, `import ${specifier}` );
	return absolute;
}


// ---------------------------------------------------------------------------
// AST transformation & node synthesizers
// ---------------------------------------------------------------------------

/*
====================
createConst

Synthesizes a `const <name> = <initializer>;` statement.
====================
*/
function createConst( ts, name, initializer ) {
	const factory = ts.factory;

	return factory.createVariableStatement(
		undefined,
		factory.createVariableDeclarationList(
			[factory.createVariableDeclaration( name, undefined, undefined, initializer )],
			ts.NodeFlags.Const,
		),
	);
}

/*
====================
createAssetUrlStatement

Synthesizes a `const <name> = new URL( '<relativeAsset>', import.meta.url ).href;` statement.
====================
*/
function createAssetUrlStatement( ts, localName, relativeAsset ) {
	const factory = ts.factory;
	const importMeta = factory.createMetaProperty(
		ts.SyntaxKind.ImportKeyword,
		factory.createIdentifier( 'meta' ),
	);
	const url = factory.createNewExpression(
		factory.createIdentifier( 'URL' ),
		undefined,
		[
			factory.createStringLiteral( relativeAsset ),
			factory.createPropertyAccessExpression( importMeta, 'url' ),
		],
	);

	return createConst( ts, localName, factory.createPropertyAccessExpression( url, 'href' ) );
}

/*
====================
createJsonStatement

Synthesizes a `const <name> = JSON.parse( '<jsonText>' );` statement.
====================
*/
function createJsonStatement( ts, localName, jsonText ) {
	const factory = ts.factory;
	const parse = factory.createCallExpression(
		factory.createPropertyAccessExpression( factory.createIdentifier( 'JSON' ), 'parse' ),
		undefined,
		[factory.createStringLiteral( jsonText )],
	);

	return createConst( ts, localName, parse );
}

/*
====================
requireDefaultOnlyImport

Asserts that an import declaration uses strictly a single default binding.
====================
*/
function requireDefaultOnlyImport( ts, root, sourceFile, declaration, kind ) {
	const clause = declaration.importClause;

	if ( !clause || clause.isTypeOnly || !clause.name || clause.namedBindings ) {
		const point = sourceFile.getLineAndCharacterOfPosition( declaration.getStart( sourceFile ) );
		throw new Error(
			`${repoRelative( root, sourceFile.fileName )}:${point.line + 1}:${point.character + 1}: ` +
			`${kind} imports must use exactly one default binding`,
		);
	}

	return clause.name;
}

/*
====================
makeTransformer

Constructs an AST transformer that rewrites module specifiers, inlines JSON,
and transforms asset URLs into import.meta.url references.
====================
*/
function makeTransformer( root, outputRoot, sourcePath, outputPath, diagnostics ) {
	const ts = loadTypeScript();
	const factory = ts.factory;

	function fail( sourceFile, node, message ) {
		const point = sourceFile.getLineAndCharacterOfPosition( node.getStart( sourceFile ) );
		diagnostics.push(
			`${repoRelative( root, sourcePath )}:${point.line + 1}:${point.character + 1}: ${message}`,
		);
	}

	function rewriteCodeSpecifier( sourceFile, node, specifier ) {
		if ( !( specifier.startsWith( '.' ) || specifier.startsWith( '@/' ) ) ) {
			return null;
		}
		if ( !isLocalCodeSpecifier( specifier ) ) {
			fail( sourceFile, node, `runtime import is not a code module: ${specifier}` );
			return specifier;
		}
		const target = resolveLocalImport( root, sourcePath, specifier );
		if ( !target ) {
			fail( sourceFile, node, `cannot resolve browser module ${specifier}` );
			return specifier;
		}
		assertInside( root, target, `module ${specifier}` );
		const targetOutput = emittedPath( root, outputRoot, target );
		return browserSpecifier( outputPath, targetOutput );
	}

	return ( context ) => {
		const visit = ( sourceFile ) => {
			const visitor = ( node ) => {
				if ( ts.isImportDeclaration( node ) ) {
					if ( !ts.isStringLiteral( node.moduleSpecifier ) ) {
						fail( sourceFile, node, 'non-literal import declaration is unsupported' );
						return node;
					}
					const specifier = node.moduleSpecifier.text;
					const split = splitSpecifier( specifier );
					const extension = path.posix.extname( split.path ).toLowerCase();

					if ( hasUrlQuery( split.suffix ) ) {
						const localName = requireDefaultOnlyImport( ts, root, sourceFile, node, '?url asset' );
						const assetSource = resolveProjectFile( root, sourcePath, specifier );
						if ( !assetSource || !fs.existsSync( assetSource ) || !fs.statSync( assetSource ).isFile() ) {
							fail( sourceFile, node, `asset does not exist: ${specifier}` );
							return node;
						}
						const assetOutput = path.join( outputRoot, path.relative( root, assetSource ) );
						return createAssetUrlStatement( ts, localName, browserSpecifier( outputPath, assetOutput ) );
					}

					if ( extension === '.json' ) {
						const localName = requireDefaultOnlyImport( ts, root, sourceFile, node, 'JSON' );
						const jsonSource = resolveProjectFile( root, sourcePath, specifier );
						if ( !jsonSource || !fs.existsSync( jsonSource ) || !fs.statSync( jsonSource ).isFile() ) {
							fail( sourceFile, node, `JSON file does not exist: ${specifier}` );
							return node;
						}
						let canonical;
						try {
							canonical = JSON.stringify( JSON.parse( fs.readFileSync( jsonSource, 'utf8' ) ) );
						} catch ( error ) {
							fail( sourceFile, node, `invalid JSON ${specifier}: ${error instanceof Error ? error.message : String( error )}` );
							return node;
						}
						return createJsonStatement( ts, localName, canonical );
					}

					const rewritten = rewriteCodeSpecifier( sourceFile, node, specifier );
					if ( rewritten !== null ) {
						return factory.updateImportDeclaration(
							node,
							node.modifiers,
							node.importClause,
							factory.createStringLiteral( rewritten ),
							node.attributes,
						);
					}
					if ( !importClauseIsTypeOnly( ts, node.importClause ) ) {
						fail( sourceFile, node, `bare runtime import is not browser-buildable: ${specifier}` );
					}
					return node;
				}

				if ( ts.isExportDeclaration( node ) && node.moduleSpecifier ) {
					if ( !ts.isStringLiteral( node.moduleSpecifier ) ) {
						fail( sourceFile, node, 'non-literal export declaration is unsupported' );
						return node;
					}
					const specifier = node.moduleSpecifier.text;
					const rewritten = rewriteCodeSpecifier( sourceFile, node, specifier );
					if ( rewritten !== null ) {
						return factory.updateExportDeclaration(
							node,
							node.modifiers,
							node.isTypeOnly,
							node.exportClause,
							factory.createStringLiteral( rewritten ),
							node.attributes,
						);
					}
					if ( !exportDeclarationIsTypeOnly( ts, node ) ) {
						fail( sourceFile, node, `bare runtime re-export is not browser-buildable: ${specifier}` );
					}
					return node;
				}

				if ( ts.isCallExpression( node ) ) {
					if ( node.expression.kind === ts.SyntaxKind.ImportKeyword ) {
						if ( node.arguments.length !== 1 || !ts.isStringLiteralLike( node.arguments[0] ) ) {
							fail( sourceFile, node, 'computed dynamic import is not browser-buildable' );
							return node;
						}
						const specifier = node.arguments[0].text;
						const rewritten = rewriteCodeSpecifier( sourceFile, node, specifier );
						if ( rewritten === null ) {
							fail( sourceFile, node, `bare dynamic import is not browser-buildable: ${specifier}` );
							return node;
						}
						return factory.updateCallExpression(
							node,
							node.expression,
							node.typeArguments,
							[factory.createStringLiteral( rewritten )],
						);
					}
					if ( ts.isIdentifier( node.expression ) && node.expression.text === 'require' ) {
						fail( sourceFile, node, 'require() is not browser-buildable' );
						return node;
					}
				}

				return ts.visitEachChild( node, visitor, context );
			};
			return ts.visitNode( sourceFile, visitor );
		};
		return visit;
	};
}


// ---------------------------------------------------------------------------
// emission & static asset bundling
// ---------------------------------------------------------------------------

/*
====================
compilerOptions

Configures the TypeScript transpileModule compiler options for ES2022 output.
====================
*/
function compilerOptions( ts ) {
	return {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ES2022,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		isolatedModules: true,
		sourceMap: false,
		inlineSourceMap: false,
		removeComments: false,
		newLine: ts.NewLineKind.LineFeed,
	};
}

/*
====================
emitSources

Transpiles all project TypeScript source files to JavaScript in outputRoot.
====================
*/
function emitSources( root, outputRoot ) {
	const ts = loadTypeScript();
	const diagnostics = [];
	const emitted = [];

	for ( const sourcePath of projectSourcePaths( root ) ) {
		if ( /\.d\.[cm]?ts$/i.test( sourcePath ) ) {
			continue;
		}
		const outputPath = emittedPath( root, outputRoot, sourcePath );
		const sourceText = fs.readFileSync( sourcePath, 'utf8' );
		const result = ts.transpileModule( sourceText, {
			fileName: sourcePath,
			compilerOptions: compilerOptions( ts ),
			transformers: {
				before: [makeTransformer( root, outputRoot, sourcePath, outputPath, diagnostics )],
			},
			reportDiagnostics: true,
		} );

		for ( const diagnostic of result.diagnostics ?? [] ) {
			if ( diagnostic.category !== ts.DiagnosticCategory.Error ) {
				continue;
			}
			let where = repoRelative( root, sourcePath );
			if ( diagnostic.file && diagnostic.start !== undefined ) {
				const point = diagnostic.file.getLineAndCharacterOfPosition( diagnostic.start );
				where += `:${point.line + 1}:${point.character + 1}`;
			}
			diagnostics.push( `${where}: ${ts.flattenDiagnosticMessageText( diagnostic.messageText, '\n' )}` );
		}

		fs.mkdirSync( path.dirname( outputPath ), { recursive: true } );
		fs.writeFileSync( outputPath, result.outputText, 'utf8' );
		emitted.push( outputPath );
	}

	if ( diagnostics.length > 0 ) {
		throw new Error( `browser module emission failed:\n${diagnostics.map( ( item ) => `  - ${item}` ).join( '\n' )}` );
	}
	return emitted;
}

/*
====================
copyTree

Recursively copies a directory tree if source exists.
====================
*/
function copyTree( source, destination ) {
	if ( !fs.existsSync( source ) ) {
		return;
	}
	fs.cpSync( source, destination, { recursive: true, force: true, errorOnExist: false } );
}

/*
====================
emitStaticFiles

Copies static asset folders and transforms index.html entry points.
====================
*/
function emitStaticFiles( root, outputRoot ) {
	copyTree( path.join( root, 'assets' ), path.join( outputRoot, 'assets' ) );
	copyTree( path.join( root, 'public' ), outputRoot );

	const sourceHtml = fs.readFileSync( path.join( root, 'index.html' ), 'utf8' );
	const outputHtml = sourceHtml
		.replace( /src=(['"])\/(?:index\.ts|browser\/main\.mjs)\1/, 'src="./index.js"' )
		.replace( /href=(['"])\/favicon\.ico\1/, 'href="./favicon.ico"' );
	if ( !outputHtml.includes( 'src="./index.js"' ) ) {
		throw new Error( 'index.html does not contain the expected /index.ts module entry' );
	}
	fs.writeFileSync( path.join( outputRoot, 'index.html' ), outputHtml, 'utf8' );
}

/*
====================
importMetaUrl

Matches `import.meta.url` AST expressions.
====================
*/
function importMetaUrl( ts, node ) {
	return ts.isPropertyAccessExpression( node ) &&
		node.name.text === 'url' &&
		ts.isMetaProperty( node.expression ) &&
		node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
		node.expression.name.text === 'meta';
}

/*
====================
validateOutputModules

Verifies that all emitted JavaScript output files parse cleanly and that all
import and asset references resolve strictly within the output directory.
====================
*/
function validateOutputModules( outputRoot, emitted ) {
	const ts = loadTypeScript();
	const issues = [];
	let importCount = 0;
	let assetReferenceCount = 0;

	const checkModuleSpecifier = ( file, sourceFile, node, specifier ) => {
		importCount += 1;
		const point = sourceFile.getLineAndCharacterOfPosition( node.getStart( sourceFile ) );
		const where = `${repoRelative( outputRoot, file )}:${point.line + 1}:${point.character + 1}`;
		if ( !( specifier.startsWith( './' ) || specifier.startsWith( '../' ) ) ) {
			issues.push( `${where}: emitted runtime import is not relative: ${specifier}` );
			return;
		}
		if ( specifier.includes( '@/' ) || /\.(?:[cm]?ts|tsx)(?:[?#]|$)/i.test( specifier ) || specifier.includes( '?url' ) ) {
			issues.push( `${where}: source-only module syntax remains: ${specifier}` );
			return;
		}
		const target = path.resolve( path.dirname( file ), splitSpecifier( specifier ).path );
		if ( !isInside( outputRoot, target ) ) {
			issues.push( `${where}: module import escapes output root: ${specifier}` );
			return;
		}
		if ( !fs.existsSync( target ) || !fs.statSync( target ).isFile() ) {
			issues.push( `${where}: emitted module is missing: ${specifier}` );
		}
	};

	for ( const file of emitted ) {
		const text = fs.readFileSync( file, 'utf8' );
		const sourceFile = ts.createSourceFile( file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS );

		for ( const diagnostic of sourceFile.parseDiagnostics ?? [] ) {
			const point = sourceFile.getLineAndCharacterOfPosition( diagnostic.start ?? 0 );
			issues.push(
				`${repoRelative( outputRoot, file )}:${point.line + 1}:${point.character + 1}: ` +
				`${ts.flattenDiagnosticMessageText( diagnostic.messageText, '\n' )}`,
			);
		}

		const visit = ( node ) => {
			if ( ts.isImportDeclaration( node ) && ts.isStringLiteralLike( node.moduleSpecifier ) ) {
				checkModuleSpecifier( file, sourceFile, node, node.moduleSpecifier.text );
			} else if ( ts.isExportDeclaration( node ) && node.moduleSpecifier && ts.isStringLiteralLike( node.moduleSpecifier ) ) {
				checkModuleSpecifier( file, sourceFile, node, node.moduleSpecifier.text );
			} else if ( ts.isCallExpression( node ) && node.expression.kind === ts.SyntaxKind.ImportKeyword ) {
				if ( node.arguments.length !== 1 || !ts.isStringLiteralLike( node.arguments[0] ) ) {
					const point = sourceFile.getLineAndCharacterOfPosition( node.getStart( sourceFile ) );
					issues.push( `${repoRelative( outputRoot, file )}:${point.line + 1}:${point.character + 1}: emitted dynamic import is computed` );
				} else {
					checkModuleSpecifier( file, sourceFile, node, node.arguments[0].text );
				}
			} else if (
				ts.isNewExpression( node ) &&
				ts.isIdentifier( node.expression ) &&
				node.expression.text === 'URL' &&
				node.arguments?.length === 2 &&
				ts.isStringLiteralLike( node.arguments[0] ) &&
				importMetaUrl( ts, node.arguments[1] )
			) {
				assetReferenceCount += 1;
				const specifier = node.arguments[0].text;
				const point = sourceFile.getLineAndCharacterOfPosition( node.getStart( sourceFile ) );
				const where = `${repoRelative( outputRoot, file )}:${point.line + 1}:${point.character + 1}`;
				const target = path.resolve( path.dirname( file ), splitSpecifier( specifier ).path );
				if ( !isInside( outputRoot, target ) ) {
					issues.push( `${where}: asset URL escapes output root: ${specifier}` );
				} else if ( !fs.existsSync( target ) || !fs.statSync( target ).isFile() ) {
					issues.push( `${where}: emitted asset is missing: ${specifier}` );
				}
			}
			ts.forEachChild( node, visit );
		};

		visit( sourceFile );
	}

	if ( issues.length > 0 ) {
		throw new Error( `browser output validation failed:\n${issues.map( ( item ) => `  - ${item}` ).join( '\n' )}` );
	}
	return { importCount, assetReferenceCount };
}


// ---------------------------------------------------------------------------
// manifest generation & public API
// ---------------------------------------------------------------------------

/*
====================
sha256

Computes the hex SHA-256 digest of a file.
====================
*/
function sha256( file ) {
	return sha256Hex( fs.readFileSync( file ) );
}

/*
====================
fileKind

Classifies emitted file as 'module', 'document', or 'asset'.
====================
*/
function fileKind( relative ) {
	if ( relative.endsWith( '.js' ) ) {
		return 'module';
	}
	if ( relative.endsWith( '.html' ) ) {
		return 'document';
	}
	return 'asset';
}

/*
====================
writeManifest

Generates build_manifest.json with entry point, file sizes, and SHA-256 digests.
====================
*/
function writeManifest( outputRoot ) {
	const files = walkFiles( outputRoot, ( file ) => path.basename( file ) !== BUILD_MANIFEST )
		.map( ( file ) => {
			const relative = repoRelative( outputRoot, file );
			return {
				path: relative,
				kind: fileKind( relative ),
				bytes: fs.statSync( file ).size,
				sha256: sha256( file ),
			};
		} )
		.sort( ( a, b ) => a.path.localeCompare( b.path ) );

	const manifest = {
		schemaVersion: 1,
		entry: 'index.js',
		files,
	};

	fs.writeFileSync(
		path.join( outputRoot, BUILD_MANIFEST ),
		`${JSON.stringify( manifest, null, 2 )}\n`,
		'utf8',
	);

	return manifest;
}

/*
====================
buildBrowserModules

Full build pipeline: validates syntax, transpiles sources, copies static assets,
validates output modules, and emits build_manifest.json.
====================
*/
export function buildBrowserModules( root = DEFAULT_ROOT, outputRoot = DEFAULT_OUTPUT ) {
	const scan = scanProject( root );
	if ( scan.syntaxIssues.length > 0 ) {
		throw new Error(
			`source syntax validation failed:\n${scan.syntaxIssues.map( ( issue ) =>
				`  - ${issue.file}:${issue.line}:${issue.column}: ${issue.message}` ).join( '\n' )}`,
		);
	}

	fs.rmSync( outputRoot, { recursive: true, force: true } );
	fs.mkdirSync( outputRoot, { recursive: true } );
	const emitted = emitSources( root, outputRoot );
	emitStaticFiles( root, outputRoot );
	const validation = validateOutputModules( outputRoot, emitted );
	const manifest = writeManifest( outputRoot );

	return {
		outputRoot,
		moduleCount: emitted.length,
		importCount: validation.importCount,
		assetReferenceCount: validation.assetReferenceCount,
		fileCount: manifest.files.length,
	};
}

/*
====================
main

CLI entry point parsing arguments and executing browser module compilation or verification check.
====================
*/
function main() {
	const args = parseArguments( process.argv.slice( 2 ) );
	let temporary = null;
	let output = args.output;

	try {
		if ( args.check ) {
			temporary = fs.mkdtempSync( path.join( os.tmpdir(), 'id-webgpu-browser-build-' ) );
			output = path.join( temporary, 'dist' );
		}
		const result = buildBrowserModules( DEFAULT_ROOT, output );
		console.log(
			`browser module build: ok (${result.moduleCount} modules, ${result.importCount} imports, ` +
			`${result.assetReferenceCount} asset URLs, ${result.fileCount} files)`,
		);
	} finally {
		if ( temporary ) {
			fs.rmSync( temporary, { recursive: true, force: true } );
		}
	}
}

if ( fileURLToPath( import.meta.url ) === path.resolve( process.argv[1] ?? '' ) ) {
	try {
		main();
	} catch ( error ) {
		console.error( error instanceof Error ? error.message : String( error ) );
		process.exitCode = 1;
	}
}
