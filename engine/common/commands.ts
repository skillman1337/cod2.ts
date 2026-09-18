/*
===============================================================================

	commands.ts

	Call of Duty 2 / id Tech Console Command Dispatch & Parsing
	Command registration, argument completion, line splitting, and tokenization.

===============================================================================
*/

import { Cvar_Snapshot } from './cvar.js';
import retailDvars from '@/assets/ui/dvars.json';


// ---------------------------------------------------------------------------
// types & globals
// ---------------------------------------------------------------------------

type Command = ( args: string[] ) => void;

const commands = new Map<string, Command>();
const argumentCompleters = new Map<string, ( args: string[] ) => readonly string[]>();


// ---------------------------------------------------------------------------
// command registration & dispatch
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Command_Register
 *
 * Registers a named console command handler, shared by menus, configs, and console.
 * Optionally registers an argument completion generator function.
 * ================
 */
export function Command_Register(
	name: string,
	handler: Command,
	complete?: ( args: string[] ) => readonly string[]
): void {
	commands.set( name.toLowerCase(), handler );

	if ( complete ) {
		argumentCompleters.set( name.toLowerCase(), complete );
	}
}

/**
 * @exec helper
 * ================
 * Command_IsCommand
 *
 * Checks if a command name is registered in the command table.
 * ================
 */
export function Command_IsCommand( name: string ): boolean {
	return commands.has( name.toLowerCase() );
}

/**
 * @exec helper
 * ================
 * Command_Dispatch
 *
 * Looks up and executes a command handler with the supplied argument list.
 * ================
 */
export function Command_Dispatch( args: string[] ): boolean {
	const handler = commands.get( args[0]?.toLowerCase() );

	if ( !handler ) {
		return false;
	}

	handler( args.slice( 1 ) );
	return true;
}


// ---------------------------------------------------------------------------
// parsing & tokenization
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Command_Lines
 *
 * Splits command buffer text by newlines and semicolons, respecting quoted string literals.
 * ================
 */
export function Command_Lines( text: string ): string[] {
	const lines: string[] = [];
	let start = 0;
	let quoted = false;

	for ( let i = 0; i < text.length; i++ ) {
		if ( text[i] === '"' ) {
			quoted = !quoted;
		}

		if ( text[i] === '\n' || ( text[i] === ';' && !quoted ) ) {
			lines.push( text.slice( start, i ) );
			start = i + 1;
		}
	}

	lines.push( text.slice( start ) );
	return lines;
}

/**
 * @exec helper
 * ================
 * Command_Tokens
 *
 * Tokenizes a command line into arguments, stripping surrounding double quotes.
 * ================
 */
export function Command_Tokens( text: string ): string[] {
	return Array.from(
		text.matchAll( /"([^"]*)"|([^\s"]+)/g ),
		( match ) => match[1] ?? match[2]
	);
}


// ---------------------------------------------------------------------------
// autocompletion
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * Command_ArgumentMatches
 *
 * Dispatches to registered argument completion generators for prefix matching.
 * ================
 */
export function Command_ArgumentMatches( input: string ): { prefix: string; matches: string[] } | null {
	const text = input.replace( /^[\\/]/, '' );
	const words = Command_Tokens( text );

	if ( !/\s/.test( text ) || !words.length ) {
		return null;
	}

	const complete = argumentCompleters.get( words[0].toLowerCase() );

	if ( !complete ) {
		return null;
	}

	const prefix = text.slice( 0, text.lastIndexOf( ' ' ) + 1 );
	const partial = text.slice( prefix.length ).replace( /^"/, '' ).toLowerCase();

	const matches = [...complete( words.slice( 1 ) )]
		.filter( ( name ) => name.toLowerCase().startsWith( partial ) )
		.sort();

	return { prefix, matches };
}

/**
 * @exec helper
 * ================
 * Command_Matches
 *
 * Tab completion over active commands and console variables.
 * Enforces native ordering (0x4066f7 / 0x406701): sorted dvars followed by reversed commands.
 * ================
 */
export function Command_Matches( input: string ): string[] {
	const argumentsMatch = Command_ArgumentMatches( input );

	if ( argumentsMatch ) {
		return argumentsMatch.matches;
	}

	const token = input.replace( /^[\\/]/, '' ).toLowerCase();

	if ( !token || /\s/.test( token ) ) {
		return [];
	}

	const names = new Map<string, string>();

	for ( const name of [...Object.keys( Cvar_Snapshot() ), ...retailDvars.dvars.map( ( dvar ) => dvar.name )] ) {
		names.set( name.toLowerCase(), name );
	}

	const variables = [...names.values()]
		.filter( ( name ) => name.toLowerCase().startsWith( token ) )
		.sort( ( a, b ) => ( a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0 ) );

	return [
		...variables,
		...[...commands.keys()].reverse().filter( ( name ) => name.startsWith( token ) ),
	];
}
