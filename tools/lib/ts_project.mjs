/*
===============================================================================

	ts_project.mjs

	Call of Duty 2 / id Tech TypeScript Project Scanner & AST Analysis Toolkit
	Scans, indexes, and analyzes TypeScript engine modules, tracking imports,
	function definitions, call expressions, and source diagnostics.

===============================================================================
*/

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire( import.meta.url );
const MODULE_DIR = path.dirname( fileURLToPath( import.meta.url ) );

export const DEFAULT_ROOT = path.resolve( MODULE_DIR, '../..' );

let cachedTypeScript = null;


// ---------------------------------------------------------------------------
// TypeScript compiler runtime loader
// ---------------------------------------------------------------------------

/*
====================
loadTypeScript

Dynamically loads the TypeScript compiler module from candidate locations:
explicit TYPESCRIPT_PATH, local project node_modules, global npm, or throws.
====================
*/
export function loadTypeScript() {
	if ( cachedTypeScript ) {
		return cachedTypeScript;
	}

	const candidates = [];
	if ( process.env.TYPESCRIPT_PATH ) {
		candidates.push( process.env.TYPESCRIPT_PATH );
	}
	candidates.push( 'typescript' );
	candidates.push( path.resolve( path.dirname( process.execPath ), '../lib/node_modules/typescript' ) );

	try {
		const npmRoot = execFileSync( 'npm', ['root', '-g'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		} ).trim();
		if ( npmRoot ) {
			candidates.push( path.join( npmRoot, 'typescript' ) );
		}
	} catch {
		// A local project dependency is the normal path; global npm is only a fallback.
	}

	const failures = [];
	for ( const candidate of candidates ) {
		try {
			cachedTypeScript = require( candidate );
			return cachedTypeScript;
		} catch ( error ) {
			failures.push( `${candidate}: ${error instanceof Error ? error.message : String( error )}` );
		}
	}

	throw new Error(
		'Unable to load TypeScript. Run npm install, or set TYPESCRIPT_PATH.\n' +
		failures.map( ( failure ) => `  - ${failure}` ).join( '\n' ),
	);
}


// ---------------------------------------------------------------------------
// path & filesystem utilities
// ---------------------------------------------------------------------------

/*
====================
toPosix

Normalizes system path separators to POSIX slashes.
====================
*/
export function toPosix( value ) {
	return value.split( path.sep ).join( '/' );
}

/*
====================
repoRelative

Computes a POSIX relative path from root to absolutePath.
====================
*/
export function repoRelative( root, absolutePath ) {
	return toPosix( path.relative( root, absolutePath ) );
}

/*
====================
isInside

Verifies that candidate resides strictly within or is equal to parent directory.
====================
*/
export function isInside( parent, candidate ) {
	const relative = path.relative( parent, candidate );
	return relative === '' || ( !relative.startsWith( `..${path.sep}` ) && relative !== '..' && !path.isAbsolute( relative ) );
}

/*
====================
walkFiles

Recursively enumerates all files under directory matching predicate, sorted by name.
====================
*/
export function walkFiles( directory, predicate = () => true ) {
	const result = [];
	if ( !fs.existsSync( directory ) ) {
		return result;
	}

	const entries = fs.readdirSync( directory, { withFileTypes: true } )
		.sort( ( a, b ) => a.name.localeCompare( b.name ) );

	for ( const entry of entries ) {
		const absolute = path.join( directory, entry.name );
		if ( entry.isDirectory() ) {
			result.push( ...walkFiles( absolute, predicate ) );
		} else if ( entry.isFile() && predicate( absolute ) ) {
			result.push( absolute );
		}
	}

	return result;
}

/*
====================
projectSourcePaths

Collects all active engine TypeScript source files (index.ts and engine/**\/*.ts).
====================
*/
export function projectSourcePaths( root = DEFAULT_ROOT ) {
	const paths = [];
	const index = path.join( root, 'index.ts' );

	if ( fs.existsSync( index ) ) {
		paths.push( index );
	}
	paths.push( ...walkFiles( path.join( root, 'engine' ), ( file ) => /\.(?:[cm]?ts|tsx)$/.test( file ) ) );

	return paths;
}


// ---------------------------------------------------------------------------
// tsconfig parsing
// ---------------------------------------------------------------------------

/*
====================
parseTsConfig

Parses and validates the root tsconfig.json compiler options.
====================
*/
function parseTsConfig( root, ts ) {
	const configPath = path.join( root, 'tsconfig.json' );
	if ( !fs.existsSync( configPath ) ) {
		return {
			allowJs: false,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			target: ts.ScriptTarget.ES2022,
			baseUrl: root,
			paths: { '@/*': ['./*'] },
		};
	}

	const read = ts.readConfigFile( configPath, ts.sys.readFile );
	if ( read.error ) {
		throw new Error( ts.formatDiagnosticsWithColorAndContext( [read.error], {
			getCanonicalFileName: ( file ) => file,
			getCurrentDirectory: () => root,
			getNewLine: () => '\n',
		} ) );
	}

	const parsed = ts.parseJsonConfigFileContent( read.config, ts.sys, root, undefined, configPath );
	if ( parsed.errors.length > 0 ) {
		throw new Error( ts.formatDiagnosticsWithColorAndContext( parsed.errors, {
			getCanonicalFileName: ( file ) => file,
			getCurrentDirectory: () => root,
			getNewLine: () => '\n',
		} ) );
	}

	return parsed.options;
}


// ---------------------------------------------------------------------------
// import clause & binding analysis
// ---------------------------------------------------------------------------

/*
====================
importClauseIsTypeOnly

Checks whether an import clause is marked type-only (top-level or all named specifiers).
====================
*/
export function importClauseIsTypeOnly( ts, clause ) {
	if ( !clause ) {
		return false;
	}
	if ( clause.isTypeOnly ) {
		return true;
	}
	if ( clause.name ) {
		return false;
	}

	const bindings = clause.namedBindings;
	if ( !bindings || !ts.isNamedImports( bindings ) || bindings.elements.length === 0 ) {
		return false;
	}

	return bindings.elements.every( ( element ) => element.isTypeOnly );
}

/*
====================
exportDeclarationIsTypeOnly

Checks whether an export declaration is marked type-only (top-level or all named exports).
====================
*/
export function exportDeclarationIsTypeOnly( ts, declaration ) {
	if ( declaration.isTypeOnly ) {
		return true;
	}
	if ( !declaration.exportClause || !ts.isNamedExports( declaration.exportClause ) ) {
		return false;
	}
	return declaration.exportClause.elements.length > 0 &&
		declaration.exportClause.elements.every( ( element ) => element.isTypeOnly );
}

/*
====================
location

Retrieves 1-indexed line and column numbers for an AST node in sourceFile.
====================
*/
export function location( sourceFile, node ) {
	const point = sourceFile.getLineAndCharacterOfPosition( node.getStart( sourceFile ) );
	return { line: point.line + 1, column: point.character + 1 };
}

/*
====================
stringLiteralText

Extracts string text from string literal or un-substituted template literal nodes.
====================
*/
function stringLiteralText( ts, node ) {
	return node && ( ts.isStringLiteral( node ) || ts.isNoSubstitutionTemplateLiteral( node ) )
		? node.text
		: null;
}

/*
====================
scanImportBindings

Scans all import declarations and extracts local binding names and imported symbols.
====================
*/
function scanImportBindings( ts, sourceFile ) {
	const bindings = [];

	for ( const statement of sourceFile.statements ) {
		if ( !ts.isImportDeclaration( statement ) || !statement.importClause ) {
			continue;
		}

		const specifier = stringLiteralText( ts, statement.moduleSpecifier );
		if ( specifier === null ) {
			continue;
		}

		const clause = statement.importClause;
		if ( clause.name ) {
			bindings.push( {
				local: clause.name.text,
				imported: 'default',
				specifier,
				typeOnly: Boolean( clause.isTypeOnly ),
			} );
		}

		const named = clause.namedBindings;
		if ( named && ts.isNamespaceImport( named ) ) {
			bindings.push( {
				local: named.name.text,
				imported: '*',
				specifier,
				typeOnly: Boolean( clause.isTypeOnly ),
			} );
		} else if ( named && ts.isNamedImports( named ) ) {
			for ( const element of named.elements ) {
				bindings.push( {
					local: element.name.text,
					imported: element.propertyName?.text ?? element.name.text,
					specifier,
					typeOnly: Boolean( clause.isTypeOnly || element.isTypeOnly ),
				} );
			}
		}
	}

	return bindings;
}

/*
====================
scanImports

Scans all import, export-from, import-equals, dynamic-import, require, and triple-slash
reference directives in sourceFile.
====================
*/
function scanImports( ts, sourceFile ) {
	const imports = [];
	const opaqueImports = [];

	const add = ( node, specifier, kind, typeOnly = false ) => {
		const at = location( sourceFile, node );
		imports.push( { specifier, kind, typeOnly, line: at.line, column: at.column } );
	};

	const addOpaque = ( node, kind ) => {
		const at = location( sourceFile, node );
		opaqueImports.push( { kind, line: at.line, column: at.column } );
	};

	for ( const reference of sourceFile.referencedFiles ) {
		const at = sourceFile.getLineAndCharacterOfPosition( reference.pos );
		imports.push( {
			specifier: reference.fileName,
			kind: 'reference-path',
			typeOnly: true,
			line: at.line + 1,
			column: at.character + 1,
		} );
	}

	const visit = ( node ) => {
		if ( ts.isImportDeclaration( node ) ) {
			const specifier = stringLiteralText( ts, node.moduleSpecifier );
			if ( specifier !== null ) {
				add( node, specifier, 'import', importClauseIsTypeOnly( ts, node.importClause ) );
			}
		} else if ( ts.isExportDeclaration( node ) && node.moduleSpecifier ) {
			const specifier = stringLiteralText( ts, node.moduleSpecifier );
			if ( specifier !== null ) {
				add( node, specifier, 'export-from', Boolean( node.isTypeOnly ) );
			}
		} else if ( ts.isImportEqualsDeclaration( node ) && ts.isExternalModuleReference( node.moduleReference ) ) {
			const specifier = stringLiteralText( ts, node.moduleReference.expression );
			if ( specifier !== null ) {
				add( node, specifier, 'import-equals', Boolean( node.isTypeOnly ) );
			}
		} else if ( ts.isImportTypeNode( node ) ) {
			const argument = node.argument;
			if ( ts.isLiteralTypeNode( argument ) ) {
				const specifier = stringLiteralText( ts, argument.literal );
				if ( specifier !== null ) {
					add( node, specifier, 'import-type', true );
				}
			}
		} else if ( ts.isCallExpression( node ) ) {
			const specifier = node.arguments.length > 0 ? stringLiteralText( ts, node.arguments[0] ) : null;
			if ( node.expression.kind === ts.SyntaxKind.ImportKeyword ) {
				if ( specifier !== null ) {
					add( node, specifier, 'dynamic-import', false );
				} else {
					addOpaque( node, 'dynamic-import' );
				}
			} else if ( ts.isIdentifier( node.expression ) && node.expression.text === 'require' ) {
				if ( specifier !== null ) {
					add( node, specifier, 'require', false );
				} else {
					addOpaque( node, 'require' );
				}
			}
		}

		ts.forEachChild( node, visit );
	};

	visit( sourceFile );

	imports.sort( ( a, b ) => a.line - b.line || a.column - b.column || a.specifier.localeCompare( b.specifier ) );
	opaqueImports.sort( ( a, b ) => a.line - b.line || a.column - b.column || a.kind.localeCompare( b.kind ) );

	return { imports, opaqueImports };
}


// ---------------------------------------------------------------------------
// function extraction & AST call site inspection
// ---------------------------------------------------------------------------

/*
====================
docCarrierNode

Resolves the parent statement carrying leading JSDoc comments for arrow or expression functions.
====================
*/
function docCarrierNode( ts, node ) {
	if ( ( ts.isArrowFunction( node ) || ts.isFunctionExpression( node ) ) &&
		ts.isVariableDeclaration( node.parent ) && ts.isVariableStatement( node.parent.parent ) ) {
		return node.parent.parent;
	}

	return node;
}

/*
====================
parseLeadingDocTags

Parses JSDoc tags (@tag value) from the leading comments of a function carrier node.
====================
*/
function parseLeadingDocTags( ts, sourceFile, node ) {
	const carrier = docCarrierNode( ts, node );
	const ranges = ts.getLeadingCommentRanges( sourceFile.text, carrier.getFullStart() ) ?? [];
	const docs = ranges
		.map( ( range ) => sourceFile.text.slice( range.pos, range.end ) )
		.filter( ( comment ) => comment.startsWith( '/**' ) );
	const block = docs.at( -1 ) ?? '';
	const tags = {};

	for ( const rawLine of block.split( /\r?\n/ ) ) {
		const line = rawLine
			.replace( /^\s*\/\*\*?\s?/, '' )
			.replace( /^\s*\*\s?/, '' )
			.replace( /\s*\*\/\s*$/, '' )
			.trim();
		const match = /^@([\w-]+)(?:\s+(.*))?$/.exec( line );
		if ( !match ) {
			continue;
		}

		const key = match[1];
		const value = ( match[2] ?? '' ).trim();

		if ( !tags[key] ) {
			tags[key] = [];
		}
		tags[key].push( value );
	}

	return tags;
}

/*
====================
functionDisplayName

Extracts the display name of a function declaration, expression, or arrow variable binding.
====================
*/
function functionDisplayName( ts, node ) {
	if ( node.name && ts.isIdentifier( node.name ) ) {
		return node.name.text;
	}
	if ( ( ts.isArrowFunction( node ) || ts.isFunctionExpression( node ) ) && ts.isVariableDeclaration( node.parent ) ) {
		return ts.isIdentifier( node.parent.name ) ? node.parent.name.text : null;
	}

	return null;
}

/*
====================
isFunctionLike

Checks if an AST node represents a function declaration, expression, arrow, or method.
====================
*/
export function isFunctionLike( ts, node ) {
	return ts.isFunctionDeclaration( node ) ||
		ts.isFunctionExpression( node ) ||
		ts.isArrowFunction( node ) ||
		ts.isMethodDeclaration( node );
}

/*
====================
hasModifier

Returns true if the node contains a modifier matching kind.
====================
*/
export function hasModifier( ts, node, kind ) {
	return Boolean( node.modifiers?.some( ( modifier ) => modifier.kind === kind ) );
}

/*
====================
callInfo

Extracts the call target symbol name, form (identifier, property, element), and receiver text.
====================
*/
function callInfo( ts, sourceFile, expression ) {
	if ( ts.isIdentifier( expression ) ) {
		return { name: expression.text, form: 'identifier', receiver: '' };
	}
	if ( ts.isPropertyAccessExpression( expression ) ) {
		return {
			name: expression.name.text,
			form: 'property',
			receiver: expression.expression.getText( sourceFile ),
		};
	}
	if ( ts.isElementAccessExpression( expression ) && expression.argumentExpression ) {
		const name = stringLiteralText( ts, expression.argumentExpression );
		return name === null ? null : {
			name,
			form: 'element',
			receiver: expression.expression.getText( sourceFile ),
		};
	}

	return null;
}

/*
====================
scanFunctionBody

Traverses the statements inside a function body, counting awaits, yields, and calls.
====================
*/
function scanFunctionBody( ts, sourceFile, functionNode ) {
	const calls = [];
	let awaitCount = 0;
	let yieldCount = 0;

	const visit = ( node ) => {
		if ( node !== functionNode && isFunctionLike( ts, node ) ) {
			return;
		}
		if ( ts.isAwaitExpression( node ) ) {
			awaitCount += 1;
		}
		if ( ts.isYieldExpression( node ) ) {
			yieldCount += 1;
		}
		if ( ts.isCallExpression( node ) || ts.isNewExpression( node ) ) {
			const info = callInfo( ts, sourceFile, node.expression );
			if ( info ) {
				const at = location( sourceFile, node );
				calls.push( {
					...info,
					line: at.line,
					column: at.column,
					isNew: ts.isNewExpression( node ),
				} );
			}
		}

		ts.forEachChild( node, visit );
	};

	if ( functionNode.body ) {
		visit( functionNode.body );
	}

	return { calls, awaitCount, yieldCount };
}

/*
====================
scanFunctions

Scans all top-level and nested function definitions in sourceFile.
====================
*/
function scanFunctions( ts, sourceFile ) {
	const functions = [];

	const visit = ( node ) => {
		if ( isFunctionLike( ts, node ) ) {
			const name = functionDisplayName( ts, node );
			if ( name && node.body ) {
				const at = location( sourceFile, node );
				const tags = parseLeadingDocTags( ts, sourceFile, node );
				const body = scanFunctionBody( ts, sourceFile, node );

				functions.push( {
					name,
					line: at.line,
					column: at.column,
					exported: hasModifier( ts, node, ts.SyntaxKind.ExportKeyword ) ||
						( ts.isVariableDeclaration( node.parent ) &&
							ts.isVariableStatement( node.parent.parent ) &&
							hasModifier( ts, node.parent.parent, ts.SyntaxKind.ExportKeyword ) ),
					async: hasModifier( ts, node, ts.SyntaxKind.AsyncKeyword ),
					tags,
					calls: body.calls,
					awaitCount: body.awaitCount,
					yieldCount: body.yieldCount,
				} );
			}
		}

		ts.forEachChild( node, visit );
	};

	visit( sourceFile );
	functions.sort( ( a, b ) => a.line - b.line || a.column - b.column );

	return functions;
}


// ---------------------------------------------------------------------------
// project-level scanner & import resolver
// ---------------------------------------------------------------------------

/*
====================
scanProject

Performs comprehensive AST scanning across all engine TypeScript sources from root.
Returns root, ts compiler instance, parsed options, scanned files, and syntax issues.
====================
*/
export function scanProject( root = DEFAULT_ROOT ) {
	const ts = loadTypeScript();
	const options = parseTsConfig( root, ts );
	const files = [];
	const syntaxIssues = [];

	for ( const absolutePath of projectSourcePaths( root ) ) {
		const text = fs.readFileSync( absolutePath, 'utf8' );
		const sourceFile = ts.createSourceFile(
			absolutePath,
			text,
			options.target ?? ts.ScriptTarget.ES2022,
			true,
			absolutePath.endsWith( '.tsx' ) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		const relativePath = repoRelative( root, absolutePath );

		for ( const diagnostic of sourceFile.parseDiagnostics ?? [] ) {
			const start = diagnostic.start ?? 0;
			const point = sourceFile.getLineAndCharacterOfPosition( start );

			syntaxIssues.push( {
				file: relativePath,
				line: point.line + 1,
				column: point.character + 1,
				message: `TypeScript syntax error: ${ts.flattenDiagnosticMessageText( diagnostic.messageText, '\n' )}`,
			} );
		}

		const importScan = scanImports( ts, sourceFile );

		files.push( {
			path: relativePath,
			absolutePath,
			text,
			sourceFile,
			imports: importScan.imports,
			opaqueImports: importScan.opaqueImports,
			importBindings: scanImportBindings( ts, sourceFile ),
			functions: scanFunctions( ts, sourceFile ),
		} );
	}

	return {
		root,
		ts,
		options,
		files,
		syntaxIssues,
	};
}

const CODE_EXTENSIONS = new Set( ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] );

/*
====================
isLocalCodeSpecifier

Checks if an import specifier targets local source code (relative or alias @/*).
====================
*/
export function isLocalCodeSpecifier( specifier ) {
	const clean = specifier.split( '?' )[0].split( '#' )[0];

	if ( !( clean.startsWith( '.' ) || clean.startsWith( '@/' ) ) ) {
		return false;
	}

	const extension = path.posix.extname( clean );
	return extension === '' || CODE_EXTENSIONS.has( extension );
}

/*
====================
resolveLocalImport

Resolves a local code specifier to its target file on disk, handling @/ alias,
extension inference (.ts, .tsx, .js), and directory index resolution.
====================
*/
export function resolveLocalImport( root, sourceAbsolutePath, specifier ) {
	const clean = specifier.split( '?' )[0].split( '#' )[0];
	let base;

	if ( clean.startsWith( '@/' ) ) {
		base = path.resolve( root, clean.slice( 2 ) );
	} else if ( clean.startsWith( '.' ) ) {
		base = path.resolve( path.dirname( sourceAbsolutePath ), clean );
	} else {
		return null;
	}

	const extension = path.extname( base ).toLowerCase();
	const candidates = [];

	if ( CODE_EXTENSIONS.has( extension ) ) {
		candidates.push( base );
		if ( ['.js', '.jsx', '.mjs', '.cjs'].includes( extension ) ) {
			const stem = base.slice( 0, -extension.length );
			candidates.push( `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts` );
		}
	} else if ( extension === '' ) {
		candidates.push( base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.cts` );
		candidates.push( path.join( base, 'index.ts' ), path.join( base, 'index.tsx' ) );
	} else {
		candidates.push( base );
	}

	for ( const candidate of candidates ) {
		if ( fs.existsSync( candidate ) && fs.statSync( candidate ).isFile() ) {
			return path.resolve( candidate );
		}
	}

	return null;
}


// ---------------------------------------------------------------------------
// diagnostics formatting & output
// ---------------------------------------------------------------------------

/*
====================
formatIssue

Formats an issue object with file, line, column, and diagnostic message.
====================
*/
export function formatIssue( issue ) {
	const locationText = issue.line ? `:${issue.line}${issue.column ? `:${issue.column}` : ''}` : '';
	return `${issue.file ?? '<project>'}${locationText}: ${issue.message}`;
}

/*
====================
printIssues

Prints verification results to the console: title: ok or failure details.
====================
*/
export function printIssues( title, issues ) {
	if ( issues.length === 0 ) {
		console.log( `${title}: ok` );
		return;
	}

	console.error( `${title}: failed (${issues.length})` );
	for ( const issue of issues ) {
		console.error( `  - ${formatIssue( issue )}` );
	}
}

/*
====================
sha256Hex

Computes the lowercase hex-encoded SHA-256 digest of binary data or string.
====================
*/
export function sha256Hex( data ) {
	return crypto.createHash( 'sha256' ).update( data ).digest( 'hex' );
}

/*
====================
isMainModule

Determines whether the current node process entry point matches the specified module url.
====================
*/
export function isMainModule( metaUrl ) {
	return Boolean( process.argv[1] && path.resolve( process.argv[1] ) === fileURLToPath( metaUrl ) );
}

/*
====================
parseVerificationArgs

Parses common verification CLI flags (--root <path>, --json) with optional
defaults and custom argument handlers.
====================
*/
export function parseVerificationArgs( argv, defaults = {}, customHandlers = {} ) {
	const options = { root: DEFAULT_ROOT, json: false, ...defaults };

	for ( let i = 0; i < argv.length; i += 1 ) {
		const arg = argv[i];
		if ( arg === '--root' ) {
			options.root = path.resolve( argv[++i] );
		} else if ( arg === '--json' ) {
			options.json = true;
		} else if ( customHandlers[arg] ) {
			customHandlers[arg]( options, () => argv[++i] );
		} else {
			throw new Error( `unknown argument: ${arg}` );
		}
	}

	return options;
}

