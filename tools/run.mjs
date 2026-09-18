#!/usr/bin/env node
/*
===============================================================================

	run.mjs

	Call of Duty 2 / id Tech Node Tool Dispatcher & Process Runner
	Dispatches registered Node.js engineering tools from tools/catalog.json
	without altering their main-module identity, process arguments, or exit codes.

===============================================================================
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';


// ---------------------------------------------------------------------------
// paths & command catalog
// ---------------------------------------------------------------------------

const tools = path.dirname( fileURLToPath( import.meta.url ) );
const root = path.dirname( tools );
const catalogPath = path.join( tools, 'catalog.json' );
const commands = JSON.parse( fs.readFileSync( catalogPath, 'utf8' ) ).commands;

const [operation = 'list', ...arguments_] = process.argv.slice( 2 );


// ---------------------------------------------------------------------------
// tool dispatching
// ---------------------------------------------------------------------------

/*
====================
main

Locates target tool by id or alias, verifies isolation bounds, and spawns
a child Node process with inherited standard I/O streams and signal forwarding.
====================
*/
async function main() {
	if ( ['list', '--list', '--help', '-h'].includes( operation ) ) {
		console.log( 'Usage: node tools/run.mjs <command|info command|list> [arguments...]' );

		for ( const command of commands.filter( ( c ) => c.runtime === 'node' ) ) {
			console.log( `${command.id.padEnd( 54 )} ${command.description}` );
		}
		return 0;
	}

	const info = operation === 'info';
	const name = info ? arguments_[0] : operation;
	const command = commands.find( ( c ) => [c.id, c.path, ...c.aliases].includes( name ) );

	if ( !command ) {
		throw new Error( `Unknown or archived command: ${name}. Run node tools/run.mjs list.` );
	}

	if ( info ) {
		console.log( JSON.stringify( command, null, 2 ) );
		return 0;
	}

	if ( command.runtime !== 'node' ) {
		throw new Error( `Use py tools/run.py ${command.id}.` );
	}

	const target = path.resolve( tools, command.path );
	const relative = path.relative( tools, target );

	if (
		path.isAbsolute( relative ) ||
		relative.split( path.sep ).includes( '..' ) ||
		relative.split( path.sep ).includes( 'archive' ) ||
		!fs.existsSync( target )
	) {
		throw new Error( 'Command target is missing or outside the active tool tree' );
	}

	const options = arguments_[0] === '--' ? arguments_.slice( 1 ) : arguments_;
	const flags = [...new Set( [...process.execArgv, ...( command.nodeArguments ?? [] )] )];

	return await new Promise( ( resolve, reject ) => {
		const child = spawn( process.execPath, [...flags, target, ...options], {
			cwd: root,
			stdio: 'inherit',
		} );

		const onInterrupt = () => child.kill( 'SIGINT' );
		const onTerminate = () => child.kill( 'SIGTERM' );

		process.once( 'SIGINT', onInterrupt );
		process.once( 'SIGTERM', onTerminate );

		function clean() {
			process.removeListener( 'SIGINT', onInterrupt );
			process.removeListener( 'SIGTERM', onTerminate );
		}

		child.once( 'error', ( error ) => {
			clean();
			reject( error );
		} );

		child.once( 'exit', ( code, signal ) => {
			clean();
			resolve( code ?? ( 128 + ( os.constants.signals[signal] ?? 1 ) ) );
		} );
	} );
}

try {
	process.exitCode = await main();
} catch ( error ) {
	console.error( error instanceof Error ? error.message : String( error ) );
	process.exitCode = 1;
}
