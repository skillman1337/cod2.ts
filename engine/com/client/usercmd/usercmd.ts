/*
===============================================================================

	usercmd.ts

	User command backup ring for client prediction.
	Parent is cl_main.ts — server handoff is wired by com.ts.

===============================================================================
*/

import { usercmd_t } from '@/engine/common/types.js';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const CMD_BACKUP = 64;


// ---------------------------------------------------------------------------
// globals
// ---------------------------------------------------------------------------

let cl_cmd_head = 0;
const cl_cmd_backup: usercmd_t[] = [];

const sv_null_cmd: usercmd_t = {
	viewangles: [ 0, 0, 0 ],
	forwardmove: 0,
	sidemove: 0,
	buttons: 0,
	impulse: 0,
};


// ---------------------------------------------------------------------------
// forward
// UC_CopyUsercmd, UC_EnsureCmdBackup, CL_QueueUsercmdBackup
// CL_GetUsercmdBack, CL_GetLatestUsercmd, UC_ClearUsercmd
// ---------------------------------------------------------------------------


/**
 * ================
 * UC_CopyUsercmd
 *
 * Deep-copy one usercmd.
 * ================
 */
function UC_CopyUsercmd( cmd: usercmd_t ): usercmd_t {
	return {
		viewangles: [ cmd.viewangles[0], cmd.viewangles[1], cmd.viewangles[2] ],
		forwardmove: cmd.forwardmove,
		sidemove: cmd.sidemove,
		buttons: cmd.buttons,
		impulse: cmd.impulse,
		stance: cmd.stance,
	};
}


/**
 * @exec per-frame
 * ================
 * UC_EnsureCmdBackup
 *
 * Lazy-init cmd ring slots.
 * ================
 */
function UC_EnsureCmdBackup(): void {
	while ( cl_cmd_backup.length < CMD_BACKUP )
		cl_cmd_backup.push( UC_CopyUsercmd( sv_null_cmd ) );
}


/**
 * @exec per-frame
 * ================
 * CL_QueueUsercmdBackup
 *
 * Push sampled cmd into the client backup ring for prediction replay.
 * ================
 */
export function CL_QueueUsercmdBackup( cmd: usercmd_t ): void {
	let copy: usercmd_t;

	copy = UC_CopyUsercmd( cmd );

	UC_EnsureCmdBackup();
	cl_cmd_backup[cl_cmd_head % CMD_BACKUP] = copy;
	cl_cmd_head++;
}


/**
 * @exec per-frame
 * ================
 * CL_GetUsercmdBack
 *
 * Fetch cmd from backup.  back=0 is most recent, back=1 is one frame older.
 * Returns null when back is out of range.
 * ================
 */
export function CL_GetUsercmdBack( back: number ): usercmd_t | null {
	let idx: number;

	if ( back < 0 || back >= CMD_BACKUP )
		return null;

	if ( back >= cl_cmd_head )
		return null;

	idx = ( cl_cmd_head - 1 - back + CMD_BACKUP * 1024 ) % CMD_BACKUP;
	return cl_cmd_backup[idx];
}


/**
 * @exec per-frame
 * ================
 * CL_GetLatestUsercmd
 *
 * Most recently queued cmd, or null cmd template when none yet.
 * ================
 */
export function CL_GetLatestUsercmd(): usercmd_t {
	let cmd: usercmd_t | null;

	cmd = CL_GetUsercmdBack( 0 );
	if ( !cmd )
		return sv_null_cmd;

	return cmd;
}


/**
 * @exec init-once
 * ================
 * UC_ClearUsercmd
 *
 * Reset client backup on shutdown.
 * ================
 */
export function UC_ClearUsercmd(): void {
	cl_cmd_head = 0;
}
