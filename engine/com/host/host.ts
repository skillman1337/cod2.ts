/*
===============================================================================

	host.ts

	Host parms and listen / dedicated / net-client mode flags.
	State only — parent is com.ts; no upward imports.

===============================================================================
*/

import { host_type_t } from '@/engine/common/types.js';


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface host_parms_t {
	argc: number;
	argv: string[];
	basedir: string;
}


export { host_type_t };


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

export const host_parms: host_parms_t = {
	argc: 0,
	argv: [],
	basedir: '.',
};


// qboolean — simulate only, no client draw path.
export let dedicated = false;

export let host_type = host_type_t.HOST_LISTEN;

let host_net_address = '';
let host_net_loopback = false;


// ---------------------------------------------------------------------------
// forward
// Host_Init, Host_ParseConnect, Host_CheckDedicated, Host_ArgvIsDedicatedToken
// Host_IsListenServer, Host_IsNetClient, Host_NetLoopback, Host_NetAddress
// Host_SnapshotUsesNetChannel, Host_RunsLocalServer
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// host
// ---------------------------------------------------------------------------

/**
 * @exec init-once
 * ================
 * Host_Init
 *
 * Stash command line and basedir.  Dedicated / listen / net client from argv.
 * ================
 */
export function Host_Init( parms: host_parms_t ): void {
	host_parms.argc = parms.argc;
	host_parms.argv = parms.argv;
	host_parms.basedir = parms.basedir;

	dedicated = Host_CheckDedicated( parms.argc, parms.argv );
	host_net_address = '';
	host_net_loopback = false;

	if ( dedicated ) {
		host_type = host_type_t.HOST_DEDICATED;
		return;
	}

	Host_ParseConnect( parms.argc, parms.argv );

	if ( host_net_address.length > 0 )
		host_type = host_type_t.HOST_CLIENT;
	else
		host_type = host_type_t.HOST_LISTEN;
}


/**
 * @exec init-once
 * ================
 * Host_ParseConnect
 *
 * +connect loopback | +connect host:port | +connect ws://host:port
 * Triplet form: +connect / loopback / (unused)
 * ================
 */
function Host_ParseConnect( argc: number, argv: string[] ): void {
	let i: number;

	for ( i = 0; i < argc; i++ ) {
		if ( argv[i] === '+connect loopback' ) {
			host_net_address = 'loopback';
			host_net_loopback = true;
			return;
		}

		if ( argv[i] === '+connect' && i + 1 < argc ) {
			host_net_address = argv[i + 1];
			host_net_loopback = host_net_address === 'loopback';
			return;
		}
	}
}


/**
 * ================
 * Host_ArgvIsDedicatedToken
 *
 * -dedicated, +set dedicated 1 as one token, or +set / dedicated / 1 triplet.
 * Returns dedicated flag and how many argv slots were consumed.
 * ================
 */
function Host_ArgvIsDedicatedToken(
	argc: number,
	argv: string[],
	i: number,
): { dedicated: boolean; advance: number } {
	if ( argv[i] === '-dedicated' )
		return { dedicated: true, advance: 1 };

	if ( argv[i] === '+set dedicated 1' )
		return { dedicated: true, advance: 1 };

	if ( argv[i] !== '+set' )
		return { dedicated: false, advance: 1 };

	if ( i + 2 >= argc )
		return { dedicated: false, advance: 1 };

	if ( argv[i + 1] !== 'dedicated' )
		return { dedicated: false, advance: 1 };

	if ( argv[i + 2] !== '1' )
		return { dedicated: false, advance: 1 };

	return { dedicated: true, advance: 3 };
}


/**
 * @exec init-once
 * ================
 * Host_CheckDedicated
 *
 * -dedicated or +set dedicated 1 on command line.
 * ================
 */
export function Host_CheckDedicated( argc: number, argv: string[] ): boolean {
	let i: number;
	let token: ReturnType<typeof Host_ArgvIsDedicatedToken>;

	for ( i = 0; i < argc; ) {
		token = Host_ArgvIsDedicatedToken( argc, argv, i );
		if ( token.dedicated )
			return true;

		i += token.advance;
	}

	return false;
}


/**
 * @exec init-once
 * ================
 * Host_IsListenServer
 *
 * True when client and server share one host tick with direct snapshot handoff.
 * Net clients and loopback test clients return false.
 * ================
 */
export function Host_IsListenServer(): boolean {
	return host_type === host_type_t.HOST_LISTEN;
}


/**
 * ================
 * Host_IsNetClient
 *
 * True when running client-only against a server (+connect).
 * ================
 */
export function Host_IsNetClient(): boolean {
	return host_type === host_type_t.HOST_CLIENT;
}


/**
 * ================
 * Host_NetLoopback
 *
 * True when +connect loopback — server runs in-process but snapshots use net queues.
 * ================
 */
export function Host_NetLoopback(): boolean {
	return host_net_loopback;
}


/**
 * @exec init-once
 * ================
 * Host_NetAddress
 *
 * Connect target from argv.  Empty on listen / dedicated.
 * ================
 */
export function Host_NetAddress(): string {
	return host_net_address;
}


/**
 * @exec per-frame
 * ================
 * Host_SnapshotUsesNetChannel
 *
 * True when snapshots must route through NET_* instead of direct com handoff.
 * ================
 */
export function Host_SnapshotUsesNetChannel(): boolean {
	return Host_IsNetClient();
}


/**
 * ================
 * Host_RunsLocalServer
 *
 * True when SV_Frame runs on this host (listen, dedicated, loopback test).
 * ================
 */
export function Host_RunsLocalServer(): boolean {
	if ( dedicated )
		return true;

	if ( host_type === host_type_t.HOST_LISTEN )
		return true;

	return Host_NetLoopback();
}
