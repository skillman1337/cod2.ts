/*
===============================================================================

	types.ts

	Call of Duty 2 / id Tech Shared Engine & Renderer Types
	Shared vector, rendering, network, and input types.
	No engine logic — safe for common/ imports.

===============================================================================
*/


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export type vec3_t = [number, number, number];

export type viewaxis_t = [vec3_t, vec3_t, vec3_t];

export interface refdef_t {
	weapon?: import('./weapon.js').weapon_state_t;
	vieworg: vec3_t;
	viewangles: vec3_t;
	viewaxis: viewaxis_t;
	time: number;
	hideWeapon?: boolean;
	thirdPerson?: boolean;
	playerorg?: vec3_t;
	/** Unsmoothed simulation feet, independent of stance/step/lean camera effects. */
	playerGroundOrigin?: vec3_t;
	/** Native controller inputs when an entity/snapshot producer supplies them. */
	playerControllers?: import('./character_controllers.js').character_controller_input_t;
	playerangles?: vec3_t;
	movement?: pm_movement_t;
}

export interface entity_render_t {
	origin: vec3_t;
}

export interface usercmd_t {
	stance?: 11 | 40 | 60;
	viewangles: vec3_t;
	forwardmove: number;
	sidemove: number;
	buttons: number;
	impulse: number;
}

export interface client_snapshot_t {
	velocity?: vec3_t;
	movement?: pm_movement_t;
	sequence: number;
	server_time: number;
	host_sent_ms: number;
	vieworg: vec3_t;
	viewangles: vec3_t;
	entities: entity_render_t[];
}

export const enum host_type_t {
	HOST_DEDICATED = 0,
	HOST_LISTEN,
	HOST_CLIENT,
}


// ---------------------------------------------------------------------------
// input button flags
// ---------------------------------------------------------------------------

export const IN_FORWARD = 1;
export const IN_BACK = 2;
export const IN_MOVELEFT = 4;
export const IN_MOVERIGHT = 8;
export const IN_JUMP = 16;
export const IN_LEANLEFT = 64;
export const IN_LEANRIGHT = 128;
export const IN_ATTACK = 256;
export const IN_ADS = 512;
export const IN_RELOAD = 1024;


// ---------------------------------------------------------------------------
// movement state
// ---------------------------------------------------------------------------

export interface pm_movement_t {
	weapon?: import('./weapon.js').weapon_state_t;
	shotImpact?: {
		position: vec3_t;
		normal: vec3_t;
		surfaceFlags: number;
		time: number;
	};
	ladder?: {
		normal: vec3_t;
		surfaceFlags: number;
	};
	ladderDetached?: boolean;
	bobCycle?: number;
	soundSequence?: number;
	soundEvents?: {
		sequence: number;
		aliases: string[];
	}[];
	stance?: {
		target: 11 | 40 | 60;
		height: number;
		from: 11 | 40 | 60;
		to: 11 | 40 | 60;
		elapsed: number;
	};
	standJumpBlocked?: boolean;
	lean?: number;
	mantle?: {
		yaw: number;
		elapsed: number;
		up: string;
		over: string | null;
		end: vec3_t;
		active: boolean;
		crouched: boolean;
	};
	stepSequence?: number;
	stepEvents?: {
		sequence: number;
		delta: number;
	}[];
	landSequence?: number;
	landEvents?: {
		sequence: number;
		amount: number;
		height: number;
	}[];
	velocity?: vec3_t;
	oldVelocity?: vec3_t;
	commandTime: number;
	remainder: number;
	oldButtons: number;
	jumpTime: number;
	jumpOrigin: number;
	jumping: boolean;
	pmTime: number;
	grounded: boolean;
}


// ---------------------------------------------------------------------------
// rendering menu types
// ---------------------------------------------------------------------------

/** One main.menu text row for GPU stretch-pic rendering. */
export interface rgpu_menu_item_t {
	full_bleed?: boolean;
	autowrapped?: boolean;
	wrapped?: boolean;
	rows?: string[];
	outlinecolor?: [number, number, number, number];
	row_height?: number;
	noscrollbars?: boolean;
	row_selected?: number;
	row_start?: number;
	columns?: number[][];
	type?: number;
	style?: number;
	background?: string;
	backcolor?: [number, number, number, number];
	border?: number;
	bordersize?: number;
	bordercolor?: [number, number, number, number];
	horz_align?: number;
	vert_align?: number;
	textalign?: number;
	textstyle?: number;
	textfont?: number;
	value_label?: string;
	slider_fraction?: number;
	label: string;
	rect_x: number;
	rect_y: number;
	rect_w: number;
	rect_h: number;
	textscale: number;
	textalignx: number;
	textaligny: number;
	forecolor: [number, number, number, number];
	focuscolor: [number, number, number, number];
}

/** Per-frame menu overlay passed from scr_menu into the GPU menu pass. */
export interface rgpu_menu_overlay_t {
	blur_world?: number;
	console_only?: boolean;
	hide_cursor?: boolean;
	focus_idx: number;
	cursor_vx: number;
	cursor_vy: number;
	items: readonly rgpu_menu_item_t[];
}
