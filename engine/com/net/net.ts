/*
===============================================================================

	net.ts

	In-process snapshot and usercmd channel.  Parent is com.ts — com wires
	listen handoff vs loopback queues vs remote WebSocket.

===============================================================================
*/

import { client_snapshot_t, usercmd_t } from '@/engine/common/types.js';
import { Con_Printf } from '@/engine/common/common.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const NET_SNAPSHOT_QUEUE_MAX = 4;
const NET_MAX_ENTITIES = 256;
const NET_RECONNECT_COOLDOWN_FRAMES = 60;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface net_init_config_t {
	net_address: string;
	net_loopback: boolean;
	is_net_client: boolean;
}


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

const net_snapshot_queue: client_snapshot_t[] = [];
const net_loopback_usercmd_queue: usercmd_t[] = [];

let net_config: net_init_config_t = {
	net_address: '',
	net_loopback: false,
	is_net_client: false,
};

let net_remote_socket: WebSocket | null = null;
let net_remote_connected = false;
let net_reconnect_cooldown = 0;


// ---------------------------------------------------------------------------
// forward
// NET_CopySnapshot, NET_EnqueueSnapshot, NET_SendSnapshot
// NET_ReadLatestSnapshot, NET_ClearSnapshots
// NET_SendUsercmd, NET_ConsumeLoopbackUsercmd
// NET_ValidateSnapshot, NET_ConnectRemote, NET_Disconnect, NET_Frame
// NET_Init, NET_Shutdown
// ---------------------------------------------------------------------------


/**
 * ================
 * NET_CopySnapshot
 * ================
 */
function NET_CopySnapshot( snap: client_snapshot_t ): client_snapshot_t {
	let i: number;
	let entities: client_snapshot_t['entities'];

	entities = [];
	for ( i = 0; i < snap.entities.length; i++ ) {
		entities.push( {
			origin: [
				snap.entities[i].origin[0],
				snap.entities[i].origin[1],
				snap.entities[i].origin[2],
			],
		} );
	}

	return {
		sequence: snap.sequence,
		server_time: snap.server_time,
		host_sent_ms: snap.host_sent_ms,
		vieworg: [ snap.vieworg[0], snap.vieworg[1], snap.vieworg[2] ],
		viewangles: [ snap.viewangles[0], snap.viewangles[1], snap.viewangles[2] ],
		entities,
	};
}


/**
 * ================
 * NET_IsFiniteNumber
 * ================
 */
function NET_IsFiniteNumber( n: unknown ): n is number {
	return typeof n === 'number' && Number.isFinite( n );
}


/**
 * @exec init-once
 * ================
 * NET_ValidateVec3
 * ================
 */
function NET_ValidateVec3( v: unknown ): v is [number, number, number] {
	if ( !Array.isArray( v ) || v.length !== 3 )
		return false;

	return NET_IsFiniteNumber( v[0] )
		&& NET_IsFiniteNumber( v[1] )
		&& NET_IsFiniteNumber( v[2] );
}


/**
 * @exec init-once
 * ================
 * NET_ValidateSnapshot
 *
 * Reject malformed or oversized remote snapshots before enqueue.
 * ================
 */
function NET_ValidateSnapshot( snap: unknown ): snap is client_snapshot_t {
	let i: number;
	let raw: client_snapshot_t;

	if ( snap === null || typeof snap !== 'object' )
		return false;

	raw = snap as client_snapshot_t;

	if ( !NET_IsFiniteNumber( raw.sequence ) )
		return false;
	if ( !NET_IsFiniteNumber( raw.server_time ) )
		return false;
	if ( !NET_IsFiniteNumber( raw.host_sent_ms ) )
		return false;
	if ( !NET_ValidateVec3( raw.vieworg ) )
		return false;
	if ( !NET_ValidateVec3( raw.viewangles ) )
		return false;
	if ( !Array.isArray( raw.entities ) )
		return false;
	if ( raw.entities.length > NET_MAX_ENTITIES )
		return false;

	for ( i = 0; i < raw.entities.length; i++ ) {
		if ( raw.entities[i] === null || typeof raw.entities[i] !== 'object' )
			return false;
		if ( !NET_ValidateVec3( raw.entities[i].origin ) )
			return false;
	}

	return true;
}


/**
 * ================
 * NET_EnqueueSnapshot
 * ================
 */
function NET_EnqueueSnapshot( snap: client_snapshot_t ): void {
	net_snapshot_queue.push( NET_CopySnapshot( snap ) );

	while ( net_snapshot_queue.length > NET_SNAPSHOT_QUEUE_MAX )
		net_snapshot_queue.shift();
}


/**
 * @exec per-frame
 * ================
 * NET_SendSnapshot
 *
 * Loopback / remote net path: server publishes into the client net queue.
 * Com calls this after SV_Frame when snapshot routing uses the net channel.
 * ================
 */
export function NET_SendSnapshot( snap: client_snapshot_t ): void {
	if ( !net_config.is_net_client )
		return;

	NET_EnqueueSnapshot( snap );
}


/**
 * @exec per-frame
 * ================
 * NET_ReadLatestSnapshot
 *
 * Drain net queue and return newest snapshot.
 * ================
 */
export function NET_ReadLatestSnapshot(): client_snapshot_t | null {
	let snap: client_snapshot_t | null;
	let latest: client_snapshot_t | null;

	latest = null;
	while ( net_snapshot_queue.length > 0 ) {
		snap = net_snapshot_queue.shift()!;
		latest = snap;
	}

	return latest;
}


/**
 * ================
 * NET_ClearSnapshots
 * ================
 */
export function NET_ClearSnapshots(): void {
	net_snapshot_queue.length = 0;
}


/**
 * @exec per-frame
 * ================
 * NET_CopyUsercmd
 * ================
 */
function NET_CopyUsercmd( cmd: usercmd_t ): usercmd_t {
	return {
		viewangles: [ cmd.viewangles[0], cmd.viewangles[1], cmd.viewangles[2] ],
		forwardmove: cmd.forwardmove,
		sidemove: cmd.sidemove,
		buttons: cmd.buttons,
		impulse: cmd.impulse,
        stance:cmd.stance,
	};
}


/**
 * @exec per-frame
 * ================
 * NET_SendUsercmd
 *
 * Loopback: queue for SV_ConsumeUsercmd on the next server tick.
 * Remote: serialize and send when socket is up.
 * Com calls this for net-client paths before SV_Frame.
 * ================
 */
export function NET_SendUsercmd( cmd: usercmd_t ): void {
	if ( net_config.net_loopback ) {
		net_loopback_usercmd_queue.push( NET_CopyUsercmd( cmd ) );

		while ( net_loopback_usercmd_queue.length > NET_SNAPSHOT_QUEUE_MAX )
			net_loopback_usercmd_queue.shift();

		return;
	}

	if ( !net_remote_connected || !net_remote_socket )
		return;

	net_remote_socket.send( JSON.stringify( {
		type: 'usercmd',
		cmd,
	} ) );
}


/**
 * @exec per-frame
 * ================
 * NET_ConsumeLoopbackUsercmd
 *
 * Com pulls one queued cmd for SV_Frame on loopback clients.
 * Returns null when the queue is empty.
 * ================
 */
export function NET_ConsumeLoopbackUsercmd(): usercmd_t | null {
	if ( net_loopback_usercmd_queue.length < 1 )
		return null;

	return net_loopback_usercmd_queue.shift()!;
}


/**
 * ================
 * NET_ClearLoopbackUsercmds
 * ================
 */
function NET_ClearLoopbackUsercmds(): void {
	net_loopback_usercmd_queue.length = 0;
}


/**
 * @exec init-once
 * ================
 * NET_ConnectRemote
 *
 * Open WebSocket to a remote dedicated host.  Browser transport until UDP exists.
 * Bare host: wss:// on https pages, ws:// for local dev over http.
 * ================
 */
function NET_ConnectRemote( address: string ): void {
	let url: string;
	let scheme: string;

	if ( net_remote_socket )
		NET_Disconnect();

	if ( address.startsWith( 'ws://' ) || address.startsWith( 'wss://' ) )
		url = address;
	else {
		// Match page transport: secure pages require wss://; http dev uses ws://.
		scheme = ( typeof location !== 'undefined' && location.protocol === 'https:' )
			? 'wss://'
			: 'ws://';
		url = scheme + address;
	}

	net_remote_socket = new WebSocket( url );

	net_remote_socket.onopen = () => {
		net_remote_connected = true;
		Con_Printf( 'NET: connected to ' + url + '\n' );
	};

	net_remote_socket.onclose = () => {
		net_remote_connected = false;
		net_remote_socket = null;
		Con_Printf( 'NET: disconnected\n' );
	};

	net_remote_socket.onerror = () => {
		Con_Printf( 'NET: connection error\n' );
	};

	net_remote_socket.onmessage = ( ev: MessageEvent ) => {
		let msg: { type?: string; snap?: client_snapshot_t };

		try {
			msg = JSON.parse( String( ev.data ) );
		} catch {
			return;
		}

		if ( msg.type !== 'snapshot' || !msg.snap )
			return;

		if ( !NET_ValidateSnapshot( msg.snap ) )
			return;

		NET_EnqueueSnapshot( msg.snap );
	};
}


/**
 * ================
 * NET_Disconnect
 * ================
 */
function NET_Disconnect(): void {
	if ( net_remote_socket )
		net_remote_socket.close();

	net_remote_socket = null;
	net_remote_connected = false;
}


/**
 * @exec per-frame
 * ================
 * NET_Frame
 *
 * Poll remote socket readyState and reconnect after drop.  Loopback is in-process.
 * ================
 */
export function NET_Frame(): void {
	if ( net_config.net_loopback || net_config.net_address.length === 0 )
		return;

	if ( net_remote_socket ) {
		if ( net_remote_socket.readyState === WebSocket.OPEN )
			net_remote_connected = true;
		else if ( net_remote_socket.readyState === WebSocket.CLOSED )
			net_remote_connected = false;

		return;
	}

	if ( net_reconnect_cooldown > 0 ) {
		net_reconnect_cooldown--;
		return;
	}

	NET_ConnectRemote( net_config.net_address );
	net_reconnect_cooldown = NET_RECONNECT_COOLDOWN_FRAMES;
}


/**
 * @exec init-once
 * ================
 * NET_Init
 *
 * Com passes parsed host net config.  Loopback is in-process; remote opens WebSocket.
 * ================
 */
export function NET_Init( config: net_init_config_t ): void {
	net_config = config;

	if ( config.net_address.length === 0 )
		return;

	if ( config.net_loopback ) {
		Con_Printf( 'NET: loopback client path\n' );
		return;
	}

	NET_ConnectRemote( config.net_address );
}


/**
 * ================
 * NET_Shutdown
 * ================
 */
export function NET_Shutdown(): void {
	NET_Disconnect();
	NET_ClearSnapshots();
	NET_ClearLoopbackUsercmds();
	net_reconnect_cooldown = 0;
}
