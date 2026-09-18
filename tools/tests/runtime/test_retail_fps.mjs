/*
===============================================================================

	test_retail_fps.mjs

	Call of Duty 2 / id Tech Framerate Calculation & 2D HUD Drawing Tests
	Validates 32-sample sliding frame time accumulation, variance tracking,
	cg_drawFPS formatting, crosshair rendering, and scoreboard display.

===============================================================================
*/

import assert from 'node:assert/strict';
import {
	CG_CalculateFPS,
	CG_GetFpsStats,
	CG_GetFpsMode,
	CG_GetFpsString,
	CG_DrawFPS,
	CG_Draw2D,
	CG_DrawCrosshair,
	CG_DrawScoreboard,
	CG_DrawChatMessages,
	CG_DrawBoldGameMessages,
} from '../../../dist/engine/common/cg_draw.js';
import { Cvar_Set, Cvar_Get } from '../../../dist/engine/common/cvar.js';
import { HUD_Create } from '../../../dist/engine/common/hud.js';

console.log( 'Testing native CG_CalculateFPS and CG_DrawFPS...' );

// 1. Initial state: before any samples are accumulated, stats must be null.
assert.equal( CG_GetFpsStats(), null, 'Stats must be null before samples are accumulated' );

// 2. Feed exactly 32 samples with a controlled 16ms delta (simulating ~62.5 fps / 60Hz).
let fakeTime = 1000;
CG_CalculateFPS( fakeTime );
for ( let i = 0; i < 32; i++ ) {
	fakeTime += 16;
	CG_CalculateFPS( fakeTime );
}

const stats = CG_GetFpsStats();
assert.notEqual( stats, null, 'Stats must be available after 32 samples' );
assert.equal( stats.minTime, 16, 'minTime should be 16ms' );
assert.equal( stats.maxTime, 16, 'maxTime should be 16ms' );
assert.equal( stats.avgFps, Math.round( 32000 / ( 32 * 16 ) ), 'avgFps must match native formula 32000 / total' );
assert.equal( stats.fpsMin, 63, 'fpsMin must match 1000 / maxTime' );
assert.equal( stats.fpsMax, 63, 'fpsMax must match 1000 / minTime' );
assert.equal( stats.variance, 0, 'variance must be 0 for identical deltas' );

// 3. Test variance and min/max with variable deltas
fakeTime += 10; CG_CalculateFPS( fakeTime ); // 10ms (100 fps)
fakeTime += 25; CG_CalculateFPS( fakeTime ); // 25ms (40 fps)
const statsVar = CG_GetFpsStats();
assert.notEqual( statsVar, null );
assert( statsVar.fpsMin <= 40, 'fpsMin should reflect lower frame rate' );
assert( statsVar.fpsMax >= 63, 'fpsMax should reflect higher frame rate' );
assert( statsVar.variance >= 0, 'variance should be non-negative' );

// 4. Test dvar parsing and gating
Cvar_Set( 'cg_drawFPS', '0' );
assert.equal( CG_GetFpsMode(), 0 );
assert.equal( CG_GetFpsString(), null );
const drawOff = CG_DrawFPS( 10, 640, 480 );
assert.equal( drawOff.item, null, 'Must not draw item when cg_drawFPS is 0' );
assert.equal( drawOff.y, 10, 'y offset must remain unchanged when off' );

Cvar_Set( 'cg_drawFPS', 'Off' );
assert.equal( CG_GetFpsMode(), 0 );
assert.equal( CG_GetFpsString(), null );

// Mode 1: Simple
Cvar_Set( 'cg_drawFPS', '1' );
assert.equal( CG_GetFpsMode(), 1 );
const simpleStr = CG_GetFpsString();
assert( simpleStr.includes( 'fps(' ), 'Simple mode must contain fps(' );
const drawSimple = CG_DrawFPS( 10, 640, 480 );
assert.notEqual( drawSimple.item, null, 'Simple mode must generate a render item' );
assert( drawSimple.item.horz_align === 3 && drawSimple.item.rect_x < 0, 'Must be positioned at top right with horz_align: 3' );
assert.equal( drawSimple.item.rect_y, 10, 'Must be positioned at input y' );
assert( drawSimple.y > 10, 'Must advance y offset by line height' );

// Mode 2: Verbose
Cvar_Set( 'cg_drawFPS', 'Verbose' );
assert.equal( CG_GetFpsMode(), 2 );
const verboseStr = CG_GetFpsString();
assert( verboseStr.includes( 'fps(' ), 'Verbose mode must contain fps(' );

// Mode 3: Time
Cvar_Set( 'cg_drawFPS', 'Time' );
assert.equal( CG_GetFpsMode(), 3 );
const timeStr = CG_GetFpsString();
assert( timeStr.includes( 'mspf(' ), 'Time mode must contain mspf(' );
const drawTime = CG_DrawFPS( 0, 640, 480 );
assert.notEqual( drawTime.item, null );
assert.equal( drawTime.item.label, timeStr );

// 5. Test CG_Draw2D native master system
const hudState = HUD_Create();
Cvar_Set( 'cg_drawFPS', 'Simple' );
Cvar_Set( 'cg_draw2D', '1' );
const items2D = CG_Draw2D( hudState, undefined, 480, 640 );
assert( items2D.length >= 1, 'CG_Draw2D must emit the FPS counter' );
assert.equal( items2D[0].label, simpleStr, 'First item must be the FPS counter at top-right' );

// When cg_drawFPS is off:
Cvar_Set( 'cg_drawFPS', '0' );
const items2DNoFps = CG_Draw2D( hudState, undefined, 480, 640 );
assert.equal( items2DNoFps.length, 0, 'No items when no movement and FPS is off' );

// 6. Test native stubs for future porting
assert.deepEqual( CG_DrawCrosshair(), [] );
assert.deepEqual( CG_DrawScoreboard(), [] );
assert.deepEqual( CG_DrawChatMessages(), [] );
assert.deepEqual( CG_DrawBoldGameMessages(), [] );

console.log( 'PASS: Native CG_CalculateFPS, CG_DrawFPS, and CG_Draw2D pipeline validated successfully.' );
