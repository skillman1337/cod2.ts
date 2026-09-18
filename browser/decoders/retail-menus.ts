/*
===============================================================================

	retail-menus.ts

	Call of Duty 2 / id Tech UI Menu Parser & Compiler
	Pure TypeScript menu definition parser, action compiler, and C-preprocessor.
	Compiles .menu scripts, itemDef hierarchies, dvar bindings, and UI callbacks.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants & grammar definitions
// ---------------------------------------------------------------------------

export const TOKEN_REGEX = /"(?:\\.|[^"\\])*"|[{};,]|[^\s{};,"]+/g;

const BLOCKS = new Set( [
	'accept', 'onopen', 'onclose', 'onesc', 'action', 'mouseenter', 'mouseexit',
	'mouseentertext', 'mouseexittext', 'onfocus', 'leavefocus', 'doubleclick',
	'dvarstrlist', 'dvarfloatlist', 'showdvar', 'hidedvar', 'enabledvar', 'disabledvar',
] );

const ARITY: Record<string, number> = {
	name: 1, group: 1, text: 1, dvar: 1, dvartest: 1, background: 1, type: 1, style: 1,
	visible: 1, fullscreen: 1, textfont: 1, textscale: 1, textstyle: 1, textalign: 1,
	textalignx: 1, textaligny: 1, border: 1, bordersize: 1, outlinecolor: 4, ownerdraw: 1,
	ownerdrawflag: 1, align: 1, feeder: 1, elementwidth: 1, elementheight: 1,
	elementtype: 1, maxchars: 1, maxpaintchars: 1, soundloop: 1, focuscolor: 4,
	disablecolor: 4, cinematic: 1, exp: 1, material: 1, teamcolor: 1, hotkey: 1,
	dvarenum: 1, accept: 1, dvarenumlist: 1,
	forecolor: 4, backcolor: 4, bordercolor: 4,
	maxcharsgotonext: 0, decoration: 0, popup: 0, outofboundsclick: 0,
	wrapped: 0, autowrapped: 0, horizontalscroll: 0, notselectable: 0, noscrollbars: 0,
	origin: 2, rect: 4, dvarfloat: 4, dvarint: 4, columns: -1, blurworld: 1,
};


// ---------------------------------------------------------------------------
// string utilities
// ---------------------------------------------------------------------------

/*
====================
stripQuotes

Unescapes double-quoted tokens, unescaping escaped quotation marks and newlines.
====================
*/
export function stripQuotes( token: string ): string {
	if ( token.startsWith( '"' ) && token.endsWith( '"' ) && token.length >= 2 ) {
		return token.slice( 1, -1 ).replace( /\\"/g, '"' ).replace( /\\n/g, '\n' );
	}

	return token;
}

/*
====================
tokenize

Splits menu definitions or configuration script strings into token arrays.
====================
*/
export function tokenize( text: string ): string[] {
	return text.match( TOKEN_REGEX ) || [];
}


// ---------------------------------------------------------------------------
// token stream menu parser
// ---------------------------------------------------------------------------

/*
====================
MenuParser

Parses tokenized menu scripts into raw property dictionaries and itemDef hierarchies.
====================
*/
export class MenuParser {
	public tokens: string[];
	public index = 0;

	constructor( text: string ) {
		this.tokens = tokenize( text );
	}

	/*
	====================
	take

	Consumes and returns the current token, advancing the stream pointer.
	====================
	*/
	take(): string {
		return this.tokens[this.index++];
	}

	/*
	====================
	peek

	Inspects the next token without advancing the stream pointer.
	====================
	*/
	peek(): string | undefined {
		return this.tokens[this.index];
	}

	/*
	====================
	blockTokens

	Consumes a balanced curly-bracket block { ... } and returns enclosed tokens.
	====================
	*/
	blockTokens(): string[] {
		this.take(); // '{'
		let depth = 1;
		const out: string[] = [];

		while ( depth > 0 && this.index < this.tokens.length ) {
			const t = this.take();

			if ( t === '{' ) {
				depth++;
			} else if ( t === '}' ) {
				depth--;
			}

			if ( depth > 0 ) {
				out.push( t );
			}
		}

		return out;
	}

	/*
	====================
	props

	Parses key-value properties and nested itemDef declarations inside a block.
	====================
	*/
	props(): Record<string, any> {
		this.take(); // '{'
		const p: Record<string, any> = {};
		const items: any[] = [];

		while ( this.index < this.tokens.length && this.tokens[this.index] !== '}' ) {
			const k = this.take().toLowerCase();

			if ( k === ';' || k === ',' ) {
				continue;
			}

			if ( k === 'itemdef' ) {
				items.push( this.props() );
				continue;
			}

			if ( k === 'execkey' || k === 'execkeyint' ) {
				const key = stripQuotes( this.take() );
				p.exec_keys = p.exec_keys || {};
				p.exec_keys[key] = this.blockTokens();
				continue;
			}

			if ( BLOCKS.has( k ) ) {
				p[k] = this.blockTokens();
				continue;
			}

			const n = ARITY[k];

			if ( n === undefined ) {
				// Skip unknown property
				continue;
			}

			if ( n === -1 ) {
				const count = parseInt( this.take(), 10 );
				const cols: string[] = [];

				for ( let i = 0; i < count * 3; i++ ) {
					cols.push( this.take() );
				}

				p[k] = cols;
				continue;
			}

			const v: string[] = [];

			for ( let i = 0; i < n; i++ ) {
				v.push( stripQuotes( this.take() ) );
			}

			if ( k === 'rect' ) {
				for ( let i = 0; i < 2; i++ ) {
					if ( this.index < this.tokens.length && /^-?\d+$/.test( this.tokens[this.index] ) ) {
						v.push( this.take() );
					}
				}
			}

			if ( k === 'origin' ) {
				p.rect = p.rect || ['0', '0', '0', '0'];
				p.rect[0] = String( parseFloat( p.rect[0] ) + parseFloat( v[0] ) );
				p.rect[1] = String( parseFloat( p.rect[1] ) + parseFloat( v[1] ) );
			} else {
				p[k] = v;
			}
		}

		this.take(); // '}'
		p.items = items;

		return p;
	}
}


// ---------------------------------------------------------------------------
// ui action parser
// ---------------------------------------------------------------------------

/*
====================
parseActions

Compiles tokenized menu event handler scripts into executable command structures:
play, close, open, setdvar, exec, uiscript, show, hide, etc.
====================
*/
export function parseActions( tokens: string[] ): any[] {
	const cmds = new Set( [
		'play', 'close', 'open', 'setdvar', 'exec', 'ingameclose', 'uiscript',
		'setfocus', 'hide', 'show', 'fadein', 'fadeout', 'setitemcolor', 'transition',
		'orbit', 'setplayerhead', 'setplayermodel',
	] );

	const out: any[] = [];
	let i = 0;

	while ( i < tokens.length ) {
		const op = tokens[i].toLowerCase();
		i++;

		if ( op === ';' || op === ',' ) {
			continue;
		}

		const args: string[] = [];

		while ( i < tokens.length && tokens[i] !== ';' && !cmds.has( tokens[i].toLowerCase() ) ) {
			args.push( stripQuotes( tokens[i] ) );
			i++;
		}

		if ( ['play', 'close', 'open', 'setfocus', 'ingameclose'].includes( op ) && args.length > 0 ) {
			const fieldMap: Record<string, string> = {
				play: 'sound',
				close: 'menu',
				open: 'menu',
				setfocus: 'item',
				ingameclose: 'menu',
			};
			out.push( { op, [fieldMap[op]]: args[0] } );
		} else if ( op === 'setdvar' && args.length >= 2 ) {
			out.push( { op: 'setdvar', name: args[0], value: args[1] } );
		} else if ( op === 'exec' && args.length > 0 ) {
			out.push( { op: 'exec', command: args[0] } );
		} else if ( op === 'uiscript' && args.length > 0 ) {
			out.push( { op: 'uiScript', name: args[0], args: args.slice( 1 ) } );
		} else if ( ( op === 'show' || op === 'hide' ) && args.length > 0 ) {
			out.push( { op, item: args[0] } );
		} else {
			out.push( { op: 'unsupported', name: op, args } );
		}
	}

	return out;
}


// ---------------------------------------------------------------------------
// property conversion helpers
// ---------------------------------------------------------------------------

/*
====================
propertyString

Extracts the first string value of a property from a property dictionary with fallback.
====================
*/
function propertyString( props: Record<string, any>, key: string, fallback: string = '' ): string {
	return props[key] && props[key][0] ? props[key][0] : fallback;
}

/*
====================
propertyNumber

Parses a property value as a decimal or hexadecimal integer/float with fallback.
====================
*/
function propertyNumber( props: Record<string, any>, key: string, fallback: number = 0 ): number {
	const v = String( propertyString( props, key, String( fallback ) ) );
	return v.toLowerCase().startsWith( '0x' ) ? parseInt( v, 16 ) : parseFloat( v ) || 0;
}


// ---------------------------------------------------------------------------
// item & menu compilation
// ---------------------------------------------------------------------------

/*
====================
compileItem

Compiles a raw itemDef property bag into typed runtime menu item structures.
====================
*/
export function compileItem( p: Record<string, any> ): Record<string, any> {
	const one = ( k: string, d: string = '' ): string => propertyString( p, k, d );
	const num = ( k: string, d: number = 0 ): number => propertyNumber( p, k, d );

	const rawRect = ( p.rect || ['0', '0', '0', '0'] ).map( ( v: string ) => parseFloat( v ) || 0 );

	while ( rawRect.length < 6 ) {
		rawRect.push( 0 );
	}

	const o: Record<string, any> = {
		name: one( 'name' ),
		type: Math.trunc( num( 'type' ) ),
		style: Math.trunc( num( 'style' ) ),
		rect_x: rawRect[0],
		rect_y: rawRect[1],
		rect_w: rawRect[2],
		rect_h: rawRect[3],
		horz_align: rawRect[4],
		vert_align: rawRect[5],
		textscale: num( 'textscale', 0.55 ),
		textalignx: num( 'textalignx' ),
		textaligny: num( 'textaligny' ),
		textalign: num( 'textalign' ),
		textstyle: num( 'textstyle' ),
		textfont: num( 'textfont' ),
		forecolor: ( p.forecolor || [1, 1, 1, 1] ).map( ( v: string ) => parseFloat( v ) || 0 ),
		backcolor: ( p.backcolor || [0, 0, 0, 0] ).map( ( v: string ) => parseFloat( v ) || 0 ),
		visible: Boolean( num( 'visible' ) ),
		decoration: 'decoration' in p,
	};

	if ( p.text ) {
		o.text_key = one( 'text' );
	}
	if ( p.dvar ) {
		o.dvar = one( 'dvar' );
	}
	if ( p.background ) {
		o.background = one( 'background' );
	}
	if ( p.group ) {
		o.group = one( 'group' );
	}

	if ( p.action ) {
		o.action = parseActions( p.action );
	}
	if ( p.mouseenter ) {
		o.mouse_enter = parseActions( p.mouseenter );
	}
	if ( p.onfocus ) {
		o.on_focus = parseActions( p.onfocus );
	}
	if ( p.mouseexit ) {
		o.mouse_exit = parseActions( p.mouseexit );
	}
	if ( p.accept ) {
		o.accept = parseActions( p.accept );
	}
	if ( p.doubleclick ) {
		o.double_click = parseActions( p.doubleclick );
	}

	for ( const k of ['showdvar', 'hidedvar', 'enabledvar', 'disabledvar'] ) {
		if ( p[k] ) {
			o.conditions = o.conditions || [];
			o.conditions.push( {
				kind: k,
				dvar: one( 'dvartest' ),
				values: p[k].filter( ( v: string ) => v !== ';' && v !== ',' ).map( stripQuotes ),
			} );
		}
	}

	for ( const k of ['dvarfloat', 'dvarint'] ) {
		if ( p[k] ) {
			o.dvar = p[k][0];
			o.range = p[k].slice( 1 ).map( ( v: string ) => parseFloat( v ) || 0 );
		}
	}

	for ( const k of ['dvarfloatlist', 'dvarstrlist'] ) {
		if ( p[k] ) {
			const v = p[k].filter( ( t: string ) => t !== ',' && t !== ';' ).map( stripQuotes );
			const choices: { label: string; value: string }[] = [];

			for ( let i = 0; i < v.length; i += 2 ) {
				if ( i + 1 < v.length ) {
					choices.push( { label: v[i], value: v[i + 1] } );
				}
			}

			o.choices = choices;
		}
	}

	if ( p.dvarenum ) {
		o.dvar = one( 'dvarenum' );
	}

	o.border = num( 'border' );
	o.bordercolor = ( p.bordercolor || [0, 0, 0, 0] ).map( ( v: string ) => parseFloat( v ) || 0 );
	o.bordersize = num( 'bordersize', 1 );
	o.outlinecolor = ( p.outlinecolor || [0, 0, 0, 0] ).map( ( v: string ) => parseFloat( v ) || 0 );

	if ( p.ownerdraw ) {
		o.ownerdraw = num( 'ownerdraw' );
		o.type = 8;
	}

	for ( const k of ['autowrapped', 'wrapped', 'noscrollbars'] ) {
		o[k] = k in p;
	}

	for ( const k of ['feeder', 'elementheight', 'elementwidth', 'maxchars', 'maxpaintchars'] ) {
		if ( p[k] ) {
			o[k] = num( k );
		}
	}

	if ( p.columns ) {
		const rawCols = p.columns.map( ( x: string ) => parseFloat( x ) || 0 );
		const cols: number[][] = [];

		for ( let i = 0; i < rawCols.length; i += 3 ) {
			cols.push( rawCols.slice( i, i + 3 ) );
		}

		o.columns = cols;
	}

	if ( p.dvarenumlist ) {
		o.enum_list = one( 'dvarenumlist' );
	}

	return o;
}

/*
====================
compileMenu

Compiles a top-level menuDef declaration, configuring dimensions,
popups, key handlers, and compiling all child itemDef components.
====================
*/
export function compileMenu( p: Record<string, any> ): Record<string, any> {
	const o = compileItem( p );

	o.fullscreen = Boolean( propertyNumber( p, 'fullscreen' ) );
	o.focus_color = ( p.focuscolor || [0.98, 0.827, 0.58, 1] ).map( ( v: string ) => parseFloat( v ) || 0 );
	o.items = ( p.items || [] ).map( compileItem );

	if ( p.blurworld ) {
		o.blur_world = parseFloat( p.blurworld[0] ) || 0;
	}
	if ( p.onopen ) {
		o.on_open = parseActions( p.onopen );
	}
	if ( p.onclose ) {
		o.on_close = parseActions( p.onclose );
	}
	if ( p.onesc ) {
		o.on_esc = parseActions( p.onesc );
	}

	o.popup = 'popup' in p;

	if ( p.exec_keys ) {
		const execKeys: Record<string, any> = {};

		for ( const [key, script] of Object.entries( p.exec_keys ) ) {
			execKeys[key] = parseActions( script as string[] );
		}

		o.exec_keys = execKeys;
	}

	return o;
}


// ---------------------------------------------------------------------------
// c-preprocessor
// ---------------------------------------------------------------------------

/*
====================
MenuPreprocessor

Lightweight C-preprocessor resolving #include directives and #define macro constants
prior to menu tokenization.
====================
*/
export class MenuPreprocessor {
	private fileReader: ( path: string ) => Promise<string | null>;
	private definitions = new Map<string, string>();

	constructor( fileReader: ( path: string ) => Promise<string | null> ) {
		this.fileReader = fileReader;
	}

	/*
	====================
	define

	Registers a preprocessor macro definition.
	====================
	*/
	define( key: string, value: string ): void {
		this.definitions.set( key, value );
	}

	/*
	====================
	preprocess

	Recursively resolves #include files, strips comments, and substitutes #define macro tokens.
	Guards against cyclic inclusion with a visited file set.
	====================
	*/
	async preprocess( entryPath: string, visited: Set<string> = new Set<string>() ): Promise<string> {
		const cleanPath = entryPath.replaceAll( '\\', '/' );

		if ( visited.has( cleanPath.toLowerCase() ) ) {
			return '';
		}

		visited.add( cleanPath.toLowerCase() );

		const content = await this.fileReader( cleanPath );

		if ( content === null ) {
			return '';
		}

		// Strip block comments /* ... */ and line comments // ... while preserving quoted strings
		const stripped = content.replace(
			/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
			( match ) => ( match.startsWith( '"' ) ? match : '' )
		);
		const lines = stripped.split( /\r?\n/ );
		const outputLines: string[] = [];

		for ( const line of lines ) {
			const trimmed = line.trim();

			// #include "path" or <path>
			const includeMatch = trimmed.match( /^#[ \t]*include[ \t]+["<]([^">]+)[">]/ );

			if ( includeMatch ) {
				const targetPath = includeMatch[1];
				const includedContent = await this.preprocess( targetPath, visited );
				outputLines.push( includedContent );
				continue;
			}

			// #define CONSTANT VALUE
			const defineMatch = trimmed.match( /^#[ \t]*define[ \t]+([A-Za-z0-9_]+)(?:[ \t]+(.*))?$/ );

			if ( defineMatch ) {
				const name = defineMatch[1];
				const val = ( defineMatch[2] ?? '' ).trim();
				this.definitions.set( name, val );
				continue;
			}

			if ( trimmed.startsWith( '#' ) ) {
				continue;
			}

			outputLines.push( line );
		}

		let text = outputLines.join( '\n' );

		// Replace defined constants with word boundary matching
		if ( this.definitions.size > 0 ) {
			const keys = Array.from( this.definitions.keys() ).sort( ( a, b ) => b.length - a.length );

			for ( const key of keys ) {
				const val = this.definitions.get( key )!;

				if ( !val || val === key ) {
					continue;
				}

				const regex = new RegExp( `\\b${key}\\b`, 'g' );
				text = text.replace( regex, val );
			}
		}

		return text;
	}
}
