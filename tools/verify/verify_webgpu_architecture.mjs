/*
===============================================================================

	verify_webgpu_architecture.mjs

	Call of Duty 2 / id Tech WebGPU Hardware Architecture Verifier
	Enforces architectural boundary invariants on WebGPU usage:
	- Confines GPUAdapter, GPUDevice, and GPUQueue to rgpu_init.ts and r_webgpu.ts.
	- Confines GPUCanvasContext to rgpu_surface.ts; prohibits surface context leaks.
	- Confines GPUCommandEncoder and beginRenderPass to rgpu_frame.ts.
	- Ensures child render passes operate through attenuated capabilities.
	- Verifies epoch lifecycle, AbortSignal propagation, and UI alignment uniqueness.

===============================================================================
*/

import {
	DEFAULT_ROOT,
	hasModifier,
	isFunctionLike,
	isMainModule,
	location,
	parseVerificationArgs,
	printIssues,
	scanProject,
} from '../lib/ts_project.mjs';


// ---------------------------------------------------------------------------
// constants & critical file paths
// ---------------------------------------------------------------------------

const INIT_FILE = 'engine/com/client/screen/scr_draw/rgpu/rgpu_init.ts';
const SURFACE_FILE = 'engine/com/client/screen/scr_draw/rgpu/rgpu_surface.ts';
const FRAME_FILE = 'engine/com/client/screen/scr_draw/rgpu/rgpu_frame.ts';
const PARENT_FILE = 'engine/com/client/screen/scr_draw/r_webgpu.ts';
const MENU_FILE = 'engine/com/client/screen/scr_draw/rgpu/rgpu_menu/rgpu_menu.ts';
const MENU_CONTRACT_FILE = 'engine/com/client/screen/scr_draw/rgpu/rgpu_menu/internal/rgpu_menu_contract.ts';
const MENU_TEXT_FILE = 'engine/com/client/screen/scr_draw/rgpu/rgpu_menu/internal/rgpu_menu_text.ts';
const DRAW_FILE = 'engine/com/client/screen/scr_draw/rgpu/rgpu_draw.ts';
const SCREEN_FILE = 'engine/com/client/screen/scr_draw.ts';
const CLIENT_FILE = 'engine/com/client/cl_main.ts';
const CLIENT_MENU_FILE = 'engine/com/client/cl_main/scr_menu.ts';
const UI_LAYOUT_FILE = 'engine/common/ui_layout.ts';

const EXPECTED_UI_CONSTANTS = new Set( [
	'UI_HORZ_ALIGN_SUBLEFT',
	'UI_HORZ_ALIGN_FULLSCREEN',
	'UI_VERT_ALIGN_SUBTOP',
	'UI_VERT_ALIGN_FULLSCREEN',
] );


// ---------------------------------------------------------------------------
// AST inspection & query helpers
// ---------------------------------------------------------------------------

/*
====================
issue

Constructs a structured issue record with source file position.
====================
*/
function issue( file, sourceFile, node, message ) {
	const point = location( sourceFile, node );

	return {
		file,
		line: point.line,
		column: point.column,
		message,
	};
}

/*
====================
methodName

Extracts the method name identifier from a call expression (property or element access).
====================
*/
function methodName( ts, call ) {
	if ( ts.isPropertyAccessExpression( call.expression ) ) {
		return call.expression.name.text;
	}
	if ( ts.isElementAccessExpression( call.expression ) ) {
		const argument = call.expression.argumentExpression;
		if ( argument && ( ts.isStringLiteral( argument ) || ts.isNoSubstitutionTemplateLiteral( argument ) ) ) {
			return argument.text;
		}
	}

	return null;
}

/*
====================
receiverText

Extracts the raw source text of the expression receiver.
====================
*/
function receiverText( ts, sourceFile, call ) {
	if ( ts.isPropertyAccessExpression( call.expression ) || ts.isElementAccessExpression( call.expression ) ) {
		return call.expression.expression.getText( sourceFile );
	}

	return '';
}

/*
====================
isExported

Determines if a function node has an export modifier or is assigned to an exported variable.
====================
*/
function isExported( ts, node ) {
	if ( hasModifier( ts, node, ts.SyntaxKind.ExportKeyword ) ) {
		return true;
	}

	return ( ts.isArrowFunction( node ) || ts.isFunctionExpression( node ) ) &&
		ts.isVariableDeclaration( node.parent ) &&
		ts.isVariableStatement( node.parent.parent ) &&
		hasModifier( ts, node.parent.parent, ts.SyntaxKind.ExportKeyword );
}

/*
====================
functionName

Retrieves the identifier name of a function node.
====================
*/
function functionName( ts, node ) {
	if ( node.name && ts.isIdentifier( node.name ) ) {
		return node.name.text;
	}
	if ( ( ts.isArrowFunction( node ) || ts.isFunctionExpression( node ) ) &&
		ts.isVariableDeclaration( node.parent ) &&
		ts.isIdentifier( node.parent.name ) ) {
		return node.parent.name.text;
	}

	return '<anonymous>';
}

/*
====================
objectHasProperty

Checks if an object literal expression defines a property with the specified name.
====================
*/
function objectHasProperty( ts, objectLiteral, name ) {
	if ( !ts.isObjectLiteralExpression( objectLiteral ) ) {
		return false;
	}

	return objectLiteral.properties.some( ( property ) => {
		if ( ts.isShorthandPropertyAssignment( property ) ) {
			return property.name.text === name;
		}
		if ( !property.name ) {
			return false;
		}

		return ( ts.isIdentifier( property.name ) || ts.isStringLiteral( property.name ) ) &&
			property.name.text === name;
	} );
}

/*
====================
typeText

Retrieves the text of a type annotation node.
====================
*/
function typeText( node, sourceFile ) {
	return node?.getText( sourceFile ) ?? '';
}

/*
====================
exportedRawParameterIssue

Verifies that exported child APIs do not leak raw WebGPU capabilities in parameters.
====================
*/
function exportedRawParameterIssue( ts, file, sourceFile, node, issues ) {
	if ( [INIT_FILE, SURFACE_FILE].includes( file ) ) {
		return;
	}
	if ( !isFunctionLike( ts, node ) || !isExported( ts, node ) ) {
		return;
	}

	const forbidden = /\b(?:GPUDevice|GPUQueue|GPUCanvasContext|GPUCommandEncoder)\b/;

	for ( const parameter of node.parameters ) {
		if ( forbidden.test( typeText( parameter.type, sourceFile ) ) ) {
			issues.push( issue(
				file,
				sourceFile,
				parameter,
				`exported child API ${functionName( ts, node )} exposes a raw parent WebGPU capability`,
			) );
		}
	}
}


// ---------------------------------------------------------------------------
// per-file AST traversal & rules
// ---------------------------------------------------------------------------

/*
====================
verifyFile

Performs recursive AST verification on a single TypeScript source file, checking
hardware capability access, raw WebGPU types, queue submission boundaries,
render-pass ownership, and alignment constant definitions.
====================
*/
function verifyFile( project, fileInfo, issues, declarationCounts ) {
	const { ts } = project;
	const { path: file, sourceFile } = fileInfo;
	const functionStack = [];

	const allowedRawTypes = new Map( [
		['GPUAdapter', new Set( [INIT_FILE] )],
		['GPUDevice', new Set( [INIT_FILE, SURFACE_FILE] )],
		['GPUQueue', new Set( [INIT_FILE] )],
		['GPUCanvasContext', new Set( [SURFACE_FILE] )],
		['GPUCommandEncoder', new Set( [FRAME_FILE] )],
	] );

	const visit = ( node ) => {
		const pushedFunction = isFunctionLike( ts, node );
		if ( pushedFunction ) {
			functionStack.push( node );
		}

		if ( ts.isIdentifier( node ) ) {
			const allowed = allowedRawTypes.get( node.text );
			if ( allowed && !allowed.has( file ) ) {
				issues.push( issue( file, sourceFile, node, `${node.text} is a raw WebGPU capability and is not allowed in this module` ) );
			}
			if ( file.startsWith( 'engine/common/' ) && /^GPU[A-Z]/.test( node.text ) ) {
				issues.push( issue( file, sourceFile, node, 'engine/common must not expose or depend on WebGPU object types' ) );
			}
			if ( node.text === 'rgpu_t' || node.text === 'rgpu_state' ) {
				issues.push( issue( file, sourceFile, node, `forbidden master-state symbol ${node.text}` ) );
			}
			if ( node.text === 'RGPU_MenuResourcesReady' && ![PARENT_FILE, MENU_FILE].includes( file ) ) {
				issues.push( issue(
					file,
					sourceFile,
					node,
					'renderer resource readiness must not determine or escape into client UI state',
				) );
			}
		}

		if ( ts.isVariableDeclaration( node ) && ts.isIdentifier( node.name ) ) {
			const name = node.name.text;
			if ( name.startsWith( 'UI_HORZ_ALIGN_' ) || name.startsWith( 'UI_VERT_ALIGN_' ) ) {
				if ( !declarationCounts.has( name ) ) {
					declarationCounts.set( name, []);
				}
				declarationCounts.get( name ).push( { file, sourceFile, node } );
			}
		}

		if ( ts.isCallExpression( node ) ) {
			const method = methodName( ts, node );
			const receiver = receiverText( ts, sourceFile, node );

			if ( method === 'requestAdapter' && file !== INIT_FILE ) {
				issues.push( issue( file, sourceFile, node, 'GPU adapter requests belong exclusively to rgpu_init.ts' ) );
			}
			if ( method === 'requestDevice' && file !== INIT_FILE ) {
				issues.push( issue( file, sourceFile, node, 'GPU device requests belong exclusively to rgpu_init.ts' ) );
			}
			if ( method === 'getPreferredCanvasFormat' && file !== INIT_FILE ) {
				issues.push( issue( file, sourceFile, node, 'swapchain-format negotiation belongs to rgpu_init.ts' ) );
			}

			if ( method === 'getContext' && node.arguments[0] && node.arguments[0].getText( sourceFile ).includes( 'webgpu' ) && file !== SURFACE_FILE ) {
				issues.push( issue( file, sourceFile, node, "getContext('webgpu') belongs exclusively to rgpu_surface.ts" ) );
			}
			if ( ['configure', 'unconfigure', 'getCurrentTexture'].includes( method ) && file !== SURFACE_FILE ) {
				issues.push( issue( file, sourceFile, node, `GPUCanvasContext.${method} belongs exclusively to rgpu_surface.ts` ) );
			}

			if ( method === 'createCommandEncoder' ) {
				if ( file !== PARENT_FILE && file !== FRAME_FILE ) {
					issues.push( issue( file, sourceFile, node, 'command-encoder creation is restricted to the parent capability wrapper and rgpu_frame.ts' ) );
				}
				if ( file === FRAME_FILE && receiver !== 'commands' ) {
					issues.push( issue( file, sourceFile, node, 'rgpu_frame.ts must create encoders through its attenuated commands capability' ) );
				}
				if ( file === PARENT_FILE && receiver !== 'epoch.device' ) {
					issues.push( issue( file, sourceFile, node, 'r_webgpu.ts must bind encoder creation to the current device epoch' ) );
				}
			}
			if ( method === 'beginRenderPass' && file !== FRAME_FILE ) {
				issues.push( issue( file, sourceFile, node, 'render-pass lifetime belongs exclusively to rgpu_frame.ts' ) );
			}
			if ( method === 'submit' ) {
				if ( file !== PARENT_FILE && file !== FRAME_FILE ) {
					issues.push( issue( file, sourceFile, node, 'queue submission is restricted to the parent capability wrapper and rgpu_frame.ts' ) );
				}
				if ( file === FRAME_FILE && receiver !== 'commands' ) {
					issues.push( issue( file, sourceFile, node, 'rgpu_frame.ts must submit through its attenuated commands capability' ) );
				}
				if ( file === PARENT_FILE && receiver !== 'epoch.queue' ) {
					issues.push( issue( file, sourceFile, node, 'r_webgpu.ts must bind submit to the current device epoch' ) );
				}
			}

			if ( ['pushErrorScope', 'popErrorScope'].includes( method ) && file !== PARENT_FILE ) {
				issues.push( issue( file, sourceFile, node, 'WebGPU error scopes are serialized by r_webgpu.ts' ) );
			}
			if ( ['writeBuffer', 'writeTexture', 'copyExternalImageToTexture'].includes( method ) && receiver.includes( '.queue' ) && file !== PARENT_FILE ) {
				issues.push( issue( file, sourceFile, node, 'raw queue uploads must be wrapped by r_webgpu.ts' ) );
			}

			if ( ts.isIdentifier( node.expression ) && node.expression.text === 'fetch' && file.startsWith( 'engine/com/client/screen/scr_draw/rgpu/rgpu_menu/' ) ) {
				if ( node.arguments.length < 2 || !objectHasProperty( ts, node.arguments[1], 'signal' ) ) {
					issues.push( issue( file, sourceFile, node, 'menu asset fetch must be scoped to the device epoch AbortSignal' ) );
				}
			}

			if ( method === 'requestDevice' && file === INIT_FILE ) {
				if ( node.arguments.length < 1 || !objectHasProperty( ts, node.arguments[0], 'requiredFeatures' ) ) {
					issues.push( issue( file, sourceFile, node, 'requestDevice must receive the owner-negotiated requiredFeatures list' ) );
				}
			}

			if ( method === 'validate' && node.arguments[1] &&
				( ts.isArrowFunction( node.arguments[1] ) || ts.isFunctionExpression( node.arguments[1] ) ) &&
				hasModifier( ts, node.arguments[1], ts.SyntaxKind.AsyncKeyword ) ) {
				issues.push( issue(
					file,
					sourceFile,
					node.arguments[1],
					'WebGPU validation-scope operations must be synchronous',
				) );
			}

			const currentFunction = functionStack.at( -1 );
			if ( currentFunction && hasModifier( ts, currentFunction, ts.SyntaxKind.AsyncKeyword ) &&
				['beginRenderPass', 'submit', 'draw', 'drawIndexed', 'setPipeline', 'setBindGroup'].includes( method ) ) {
				issues.push( issue(
					file,
					sourceFile,
					node,
					`async function ${functionName( ts, currentFunction )} must not encode or submit frame rendering`,
				) );
			}
		}

		if ( ts.isReturnStatement( node ) && file === SURFACE_FILE && node.expression ) {
			let expression = node.expression;
			while ( ts.isParenthesizedExpression( expression ) || ts.isAsExpression( expression ) || ts.isTypeAssertionExpression( expression ) ) {
				expression = expression.expression;
			}
			if ( ts.isIdentifier( expression ) && expression.text === 'rgpu_surface_context' ) {
				issues.push( issue( file, sourceFile, node, 'raw GPUCanvasContext must never leave rgpu_surface.ts' ) );
			}
		}

		exportedRawParameterIssue( ts, file, sourceFile, node, issues );
		ts.forEachChild( node, visit );

		if ( pushedFunction ) {
			functionStack.pop();
		}
	};

	visit( sourceFile );
}

/*
====================
requireText

Asserts that specific literal needle substrings exist within the file contents.
====================
*/
function requireText( fileByPath, file, needles, issues ) {
	const info = fileByPath.get( file );

	if ( !info ) {
		issues.push( { file, message: 'required architecture file is missing' } );
		return;
	}

	for ( const [needle, message] of needles ) {
		if ( !info.text.includes( needle ) ) {
			issues.push( { file, message } );
		}
	}
}


// ---------------------------------------------------------------------------
// public API & CLI entry point
// ---------------------------------------------------------------------------

/*
====================
verifyWebGPUArchitecture

Scans the TypeScript project from root and verifies all WebGPU architectural constraints.
====================
*/
export function verifyWebGPUArchitecture( root = DEFAULT_ROOT ) {
	const project = scanProject( root );
	const issues = [...project.syntaxIssues];
	const declarationCounts = new Map();
	const fileByPath = new Map( project.files.map( ( file ) => [file.path, file] ) );

	for ( const file of project.files ) {
		verifyFile( project, file, issues, declarationCounts );
	}

	const canonicalNames = new Set( [...EXPECTED_UI_CONSTANTS, ...declarationCounts.keys()] );

	for ( const name of canonicalNames ) {
		const declarations = declarationCounts.get( name ) ?? [];

		if ( declarations.length === 1 && declarations[0].file === UI_LAYOUT_FILE ) {
			continue;
		}
		if ( declarations.length === 0 ) {
			issues.push( { file: UI_LAYOUT_FILE, message: `missing canonical ${name}` } );
			continue;
		}
		for ( const declaration of declarations ) {
			issues.push( issue(
				declaration.file,
				declaration.sourceFile,
				declaration.node,
				`${name} must have exactly one canonical declaration in ${UI_LAYOUT_FILE}`,
			) );
		}
	}

	requireText( fileByPath, PARENT_FILE, [
		['new AbortController()', 'device adoption must create a cancelable child-resource epoch'],
		['rgpu_backend_abort.abort()', 'teardown must abort in-flight child work'],
		["pushErrorScope( 'validation' )", 'resource construction must use a validation error scope'],
		["pushErrorScope( 'out-of-memory' )", 'resource construction must use an out-of-memory error scope'],
		['RGPU_MenuCoreResourcesReady()', 'READY must include validated menu core resources'],
		['RGPU_ResourcesReady()', 'READY must include validated draw resources'],
		["new Error( 'validation operation must be synchronous' )", 'validation scopes need a runtime thenable guard'],
		['menu_overlay && RGPU_MenuResourcesReady()', 'menu drawing decisions must be gated by explicit UI intent'],
	], issues );

	requireText( fileByPath, INIT_FILE, [
		["adapter.features.has( 'texture-compression-bc' )", 'optional BC compression must be negotiated from adapter capabilities'],
		['requiredFeatures: required_features', 'negotiated optional features must be requested at device creation'],
		["device.features.has( 'texture-compression-bc' )", 'the immutable device epoch must record enabled BC support'],
	], issues );

	requireText( fileByPath, MENU_FILE, [
		['function RGPU_MenuBackgroundCoreResourcesReady()', 'menu owner must distinguish its local core from private text-child readiness'],
		['return RGPU_MenuBackgroundCoreResourcesReady();', 'menu local core construction must not require a child that has not been built yet'],
		['return RGPU_MenuBackgroundCoreResourcesReady() && RGPU_MenuTextCoreResourcesReady();', 'aggregate menu readiness must include both local and private-child cores'],
	], issues );

	requireText( fileByPath, MENU_CONTRACT_FILE, [
		['readonly id: number;', 'menu child epoch must include an immutable generation id'],
		['readonly signal: AbortSignal;', 'menu child epoch must include an AbortSignal'],
		['isCurrent(): boolean;', 'menu child epoch must expose a stale-generation guard'],
		['validate( label: string, operation: () => undefined ): Promise<string | null>;', 'menu resource work must use a synchronous parent validation scope'],
	], issues );

	requireText( fileByPath, CLIENT_MENU_FILE, [
		['export function SCR_MenuSetActive', 'client menu owner must expose an explicit semantic state transition'],
		['export function SCR_MenuIsActive', 'client menu owner must expose semantic state independently of renderer readiness'],
		['export function SCR_MenuShutdown', 'client menu owner must release browser listeners and callbacks'],
	], issues );

	requireText( fileByPath, CLIENT_FILE, [
		['SCR_MenuSetActive( true );', 'the initial menu policy must be an explicit client-parent decision'],
		['menu_active = SCR_MenuIsActive();', 'sound and input mode must derive from client-owned menu state'],
	], issues );

	requireText( fileByPath, SCREEN_FILE, [
		['RGPU_BeginFrame( vid.width, vid.height, frame.menu_overlay );', 'frame clear mode must receive explicit menu intent'],
	], issues );

	for ( const file of [DRAW_FILE, MENU_FILE, MENU_TEXT_FILE, MENU_CONTRACT_FILE] ) {
		const info = fileByPath.get( file );
		if ( !info ) {
			continue;
		}
		if ( /\brgpu_device_epoch_t\b/.test( info.text ) ) {
			issues.push( { file, message: 'renderer children must not receive the parent device epoch' } );
		}
	}

	return { issues, project };
}

if ( isMainModule( import.meta.url ) ) {
	try {
		const options = parseVerificationArgs( process.argv.slice( 2 ) );
		const result = verifyWebGPUArchitecture( options.root );

		if ( options.json ) {
			console.log( JSON.stringify( { issues: result.issues }, null, 2 ) );
		} else {
			printIssues( 'WebGPU architecture verification', result.issues );
		}

		process.exitCode = result.issues.length === 0 ? 0 : 1;
	} catch ( error ) {
		console.error( error instanceof Error ? error.stack : String( error ) );
		process.exitCode = 1;
	}
}
