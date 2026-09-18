/*
===============================================================================

	test_character_pipeline.mjs

	Call of Duty 2 / id Tech Character Skeletal Animation & Controller Unit Tests
	Validates track interpolation, torso/legs blending, attachment posing,
	IK foot placement controllers, and dual-quaternion mesh skinning.

===============================================================================
*/

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
	Character_SelectAnim,
	Character_SelectTorsoAnim,
	Character_AnimDurationMs,
	Character_EvaluateTracks,
	Character_AnimMoveSpeed,
	BG_RunLerpFrameRate,
	BG_PlayerAnimation,
	Character_WorldRoot,
	Character_PoseModel,
	Character_PoseAttachedModel,
	Character_PoseHelmet,
	Character_PoseWeapon,
	Character_SkinSurface,
	Character_Slerp,
	Character_Lerp,
	Character_BlendTracks,
	CHARACTER_TORSO_BONES,
} from '../../../dist/engine/common/character.js';
import {
	Character_CreateControllers,
	Character_ControllerTargets,
	Character_StepControllers,
	Character_ControllerOverrides,
} from '../../../dist/engine/common/character_controllers.js';

console.log( 'Testing Character Pipeline (animation selection, posing, skinning)...' );

// 1. Animation selection tests
assert.equal(
	Character_SelectAnim( { time_ms: 0, stance: 60, yaw: 0, pitch: 0 } ),
	'stand_idle',
	'Standing still should select stand_idle'
);

assert.equal(
	Character_SelectAnim( { time_ms: 0, stance: 60, yaw: 0, pitch: 0, ads: true } ),
	'stand_ads',
	'Standing still with ADS should select stand_ads'
);

assert.equal(
	Character_SelectAnim( { time_ms: 0, stance: 60, yaw: 0, pitch: 0, velocity: [ 100, 0, 0 ] } ),
	'run_forward',
	'Moving forward (yaw=0, vel=[100,0,0]) should select run_forward'
);

assert.equal(
	Character_SelectAnim( { time_ms: 0, stance: 60, yaw: 0, pitch: 0, velocity: [ -100, 0, 0 ] } ),
	'run_back',
	'Moving backward (yaw=0, vel=[-100,0,0]) should select run_back'
);

assert.equal(
	Character_SelectAnim( { time_ms: 0, stance: 60, yaw: 0, pitch: 0, velocity: [ 0, 100, 0 ] } ),
	'run_left',
	'Strafing left (yaw=0, vel=[0,100,0]) should select run_left'
);

assert.equal(
	Character_SelectAnim( { time_ms: 0, stance: 60, yaw: 0, pitch: 0, velocity: [ 0, -100, 0 ] } ),
	'run_right',
	'Strafing right (yaw=0, vel=[0,-100,0]) should select run_right'
);

assert.equal(
	Character_SelectAnim( { time_ms: 0, stance: 40, yaw: 0, pitch: 0 } ),
	'crouch_idle',
	'Crouched still should select crouch_idle'
);

assert.equal(
	Character_SelectAnim( { time_ms: 0, stance: 40, yaw: 0, pitch: 0, velocity: [ 80, 0, 0 ] } ),
	'crouch_forward',
	'Crouched moving forward should select crouch_forward'
);

assert.equal(
	Character_SelectAnim( { time_ms: 0, stance: 11, yaw: 0, pitch: 0 } ),
	'prone_idle',
	'Prone still should select prone_idle'
);

assert.equal(
	Character_SelectAnim( { time_ms: 0, stance: 11, yaw: 0, pitch: 0, velocity: [ 40, 0, 0 ] } ),
	'prone_forward',
	'Prone crawling forward should select prone_forward'
);

// Run-to-stop transition: when velocity drops below 5 units/s, must immediately select stand_idle
assert.equal(
	Character_SelectAnim( { time_ms: 500, stance: 60, yaw: 0, pitch: 0, velocity: [ 0, 0, 0 ] } ),
	'stand_idle',
	'Stopping running (vel=[0,0,0]) must immediately select stand_idle'
);

assert.equal(
	Character_SelectAnim( { time_ms: 500, stance: 60, yaw: 0, pitch: 0, velocity: [ 2, 1, 0 ] } ),
	'stand_idle',
	'Residual speed under 5 units/s must select stand_idle'
);

// ADS locomotion and release tests (retail playeranim.script parity)
assert.equal(
	Character_SelectAnim( { time_ms: 500, stance: 60, yaw: 0, pitch: 0, velocity: [ 80, 0, 0 ], ads: true } ),
	'walk_forward',
	'ADS moving forward must select walk_forward'
);

assert.equal(
	Character_SelectAnim( { time_ms: 600, stance: 60, yaw: 0, pitch: 0, velocity: [ 0, 0, 0 ], ads: true } ),
	'stand_ads',
	'Releasing movement while ADS must select stand_ads'
);

assert.equal(
	Character_SelectAnim( { time_ms: 500, stance: 40, yaw: 0, pitch: 0, velocity: [ 50, 0, 0 ], ads: true } ),
	'crouch_walk_forward',
	'Crouched ADS moving forward must select crouch_walk_forward'
);

assert.equal(
	Character_SelectAnim( { time_ms: 600, stance: 40, yaw: 0, pitch: 0, velocity: [ 0, 0, 0 ], ads: true } ),
	'crouch_ads',
	'Releasing movement while crouched in ADS must select crouch_ads'
);

// Ladder climbing tests
const ladderInfo = { normal: [ 0, 1, 0 ], surfaceFlags: 8 };
assert.equal(
	Character_SelectAnim( { time_ms: 500, stance: 60, yaw: 0, pitch: 0, velocity: [ 0, 0, 60 ], ladder: ladderInfo } ),
	'ladder_up',
	'Moving up on ladder (vz=60) must select ladder_up'
);

assert.equal(
	Character_SelectAnim( { time_ms: 500, stance: 60, yaw: 0, pitch: 0, velocity: [ 0, 0, -60 ], ladder: ladderInfo } ),
	'ladder_down',
	'Moving down on ladder (vz=-60) must select ladder_down'
);

assert.equal(
	Character_SelectAnim( { time_ms: 500, stance: 60, yaw: 0, pitch: 0, velocity: [ 0, 0, 0 ], ladder: ladderInfo } ),
	'ladder_up',
	'Stationary on ladder must stay in ladder animation'
);

// Airborne / Jumping tests
assert.equal(
	Character_SelectAnim( { time_ms: 500, stance: 60, yaw: 0, pitch: 0, velocity: [ 0, 0, 100 ], jumping: true } ),
	'jump_stand',
	'Jumping vertically with low horizontal speed must select jump_stand'
);

assert.equal(
	Character_SelectAnim( { time_ms: 500, stance: 60, yaw: 0, pitch: 0, velocity: [ 100, 0, 100 ], jumping: true } ),
	'jump_run',
	'Jumping forward with running horizontal speed must select jump_run'
);

// Landing tests
assert.equal(
	Character_SelectAnim( { time_ms: 500, stance: 60, yaw: 0, pitch: 0, velocity: [ 0, 0, 0 ], landing: true } ),
	'land_stand',
	'Landing without horizontal speed must select land_stand'
);

assert.equal(
	Character_SelectAnim( { time_ms: 500, stance: 60, yaw: 0, pitch: 0, velocity: [ 80, 0, 0 ], landing: true } ),
	'land_run',
	'Landing while moving must select land_run'
);

// Track Blending tests (Slerp / Lerp / BlendTracks)
const trackA = {
	tag_torso: {
		q: [ 0, 0, 0, 1 ],
		p: [ 0, 0, 0 ],
	},
};
const trackB = {
	tag_torso: {
		q: [ 0, 0, Math.sin( Math.PI / 4 ), Math.cos( Math.PI / 4 ) ], // 90 deg around Z
		p: [ 10, 20, 30 ],
	},
};
const blendedHalf = Character_BlendTracks( trackA, trackB, 0.5 );
assert( Math.abs( blendedHalf.tag_torso.p[0] - 5 ) < 1e-5, 'Lerp midpoint X must be 5' );
assert( Math.abs( blendedHalf.tag_torso.p[1] - 10 ) < 1e-5, 'Lerp midpoint Y must be 10' );
assert( Math.abs( blendedHalf.tag_torso.p[2] - 15 ) < 1e-5, 'Lerp midpoint Z must be 15' );
// Halfway between 0 and 90 deg is 45 deg: sin(pi/8) approx 0.38268
assert( Math.abs( blendedHalf.tag_torso.q[2] - Math.sin( Math.PI / 8 ) ) < 1e-4, 'Slerp midpoint Z must be sin(pi/8)' );

// 2. World root transform test
const rootOrigin = [ 100, 200, 50 ];
const rootYaw = 90; // 90 deg rotation around Z
const worldRoot = Character_WorldRoot( rootOrigin, rootYaw );
assert.deepEqual( worldRoot[1], [ 100, 200, 50 ], 'World root origin must match input' );
assert( Math.abs( worldRoot[0][2] - Math.sin( Math.PI / 4 ) ) < 1e-4, 'Quaternion Z component must match 90 deg yaw' );
assert( Math.abs( worldRoot[0][3] - Math.cos( Math.PI / 4 ) ) < 1e-4, 'Quaternion W component must match 90 deg yaw' );

// 3. Load model and animation JSON from dist
const modelsDir = path.resolve( 'dist/characters/models' );
const animsDir = path.resolve( 'dist/characters/animations' );

const bodyModel = JSON.parse( fs.readFileSync( path.join( modelsDir, 'playerbody_american_normandy01.json' ), 'utf8' ) );
const headModel = JSON.parse( fs.readFileSync( path.join( modelsDir, 'head_us_ranger_braeburn.json' ), 'utf8' ) );
const helmetModel = JSON.parse( fs.readFileSync( path.join( modelsDir, 'helmet_us_ranger_generic.json' ), 'utf8' ) );
const idleAnim = JSON.parse( fs.readFileSync( path.join( animsDir, 'pb_stand_alert.json' ), 'utf8' ) );

assert( bodyModel.bones.length > 50, 'Body model must have bones' );
assert( headModel.bones.length > 10, 'Head model must have bones' );
assert( helmetModel.bones.length >= 1, 'Helmet model must have bones' );
assert( idleAnim.frames > 0, 'Animation must have frames' );

// 4. Pose evaluation
const tracks = Character_EvaluateTracks( idleAnim, 500 );
assert( Object.keys( tracks ).length > 0, 'Evaluated tracks must not be empty' );

const bodyPoses = Character_PoseModel( bodyModel, tracks, worldRoot );
assert.equal( bodyPoses.length, bodyModel.bones.length, 'Every body bone must have an evaluated pose' );

const headPoses = Character_PoseAttachedModel( headModel, bodyModel, bodyPoses, worldRoot );
assert.equal( headPoses.length, headModel.bones.length, 'Every head bone must have an evaluated pose' );

const headBoneIdx = bodyModel.bones.findIndex( ( b ) => b.name === 'j_head' );
assert( headBoneIdx >= 0, 'j_head bone must exist in body' );
const headAttachment = bodyPoses[headBoneIdx];
const helmetPoses = Character_PoseHelmet( helmetModel, headAttachment );
assert.equal( helmetPoses.length, helmetModel.bones.length, 'Every helmet bone must have an evaluated pose' );

// 5. Skinning test
const bodySurface = bodyModel.surfaces[0];
const skinnedBody = Character_SkinSurface( bodySurface, bodyPoses );
assert.equal( skinnedBody.length, bodySurface.indices.length * 8, 'Skinned vertex buffer length must match indices * 8 floats' );

// Verify skinned coordinates are non-degenerate and close to player origin
let minZ = Infinity, maxZ = -Infinity;
for ( let i = 0; i < skinnedBody.length; i += 8 ) {
	const x = skinnedBody[i];
	const y = skinnedBody[i + 1];
	const z = skinnedBody[i + 2];
	assert( !isNaN( x ) && !isNaN( y ) && !isNaN( z ), 'Skinned coordinates must not be NaN' );
	if ( z < minZ ) minZ = z;
	if ( z > maxZ ) maxZ = z;
}

// Character standing height is roughly 60-70 units
assert( maxZ > rootOrigin[2], 'Head/upper body must be above root origin' );
assert( maxZ - minZ >= 50 && maxZ - minZ <= 90, `Character model height (${maxZ - minZ}) must be within reasonable bounds (50-90)` );

// 6. Native Lean and Character Controllers test (Q/E)
const ctrlState = Character_CreateControllers();
const ctrlTarget = Character_CreateControllers();
Character_ControllerTargets( {
	playerAngles: [ 0, 0, 0 ],
	legsYaw: 0,
	torsoYaw: 0,
	torsoPitch: 0,
	lean: 0.5, // Lean right
	eFlags: 0, // Standing
}, ctrlTarget );
Character_StepControllers( ctrlState, ctrlTarget, 1000 ); // Step smoothly to target
const overrides = Character_ControllerOverrides( ctrlState );
assert( overrides.has( 'head' ), 'Overrides must contain head control tag' );
assert( overrides.has( 'back_mid' ), 'Overrides must contain back_mid control tag' );
assert( overrides.get( 'head' ).control, 'Head override must have control bit set' );

const unrotatedRoot = Character_WorldRoot( [ 0, 0, 0 ], 0 );
const normalPoses = Character_PoseModel( bodyModel, Character_EvaluateTracks( idleAnim, 0 ), unrotatedRoot );
const leanPoses = Character_PoseModel( bodyModel, Character_EvaluateTracks( idleAnim, 0 ), unrotatedRoot, overrides );
const normalHeadPos = normalPoses[headBoneIdx][1];
const leanHeadPos = leanPoses[headBoneIdx][1];
assert( leanHeadPos[1] < normalHeadPos[1], 'Head must be laterally displaced to the right (negative Y) when leaning right (E key)' );

// 7. Weapon attachment and skinning test
const weaponModel = JSON.parse( fs.readFileSync( path.join( modelsDir, 'weapon_m1carbine.json' ), 'utf8' ) );
const tagWeaponRightIdx = bodyModel.bones.findIndex( ( b ) => b.name === 'tag_weapon_right' );
assert( tagWeaponRightIdx >= 0, 'tag_weapon_right must exist in body model' );
const weaponAttachment = bodyPoses[tagWeaponRightIdx];
const weaponPoses = Character_PoseWeapon( weaponModel, weaponAttachment );
assert.equal( weaponPoses.length, weaponModel.bones.length, 'Every weapon bone must have an evaluated pose' );
const weaponSurface = weaponModel.surfaces[0];
const skinnedWeapon = Character_SkinSurface( weaponSurface, weaponPoses );
assert.equal( skinnedWeapon.length, weaponSurface.indices.length * 8, 'Skinned weapon vertices must match surface indices' );
for ( let i = 0; i < Math.min( 64, skinnedWeapon.length ); i++ ) {
	assert( !isNaN( skinnedWeapon[i] ), 'Weapon skinned coords must not be NaN' );
}

// 8. Footstep / bobCycle sync test
const runAnim = JSON.parse( fs.readFileSync( path.join( animsDir, 'pb_combatrun_forward_loop.json' ), 'utf8' ) );
const runDuration = ( runAnim.frames / runAnim.rate ) * 1000.0;
// bobCycle = 64 (left step, 25% phase)
const leftStepTime = ( 64 / 256.0 ) * runDuration;
const leftTracks = Character_EvaluateTracks( runAnim, leftStepTime );
const leftPoses = Character_PoseModel( bodyModel, leftTracks, Character_WorldRoot( [ 0, 0, 0 ], 0 ) );
const ankleLeIdx = bodyModel.bones.findIndex( ( b ) => b.name === 'j_ankle_le' );
const ankleRiIdx = bodyModel.bones.findIndex( ( b ) => b.name === 'j_ankle_ri' );
const leftStepAnkleLeZ = leftPoses[ankleLeIdx][1][2];
const leftStepAnkleRiZ = leftPoses[ankleRiIdx][1][2];
assert( leftStepAnkleLeZ < leftStepAnkleRiZ, 'At bobCycle=64 (left footstrike), left ankle must be lower than right ankle' );

// bobCycle = 192 (right step, 75% phase)
const rightStepTime = ( 192 / 256.0 ) * runDuration;
const rightTracks = Character_EvaluateTracks( runAnim, rightStepTime );
const rightPoses = Character_PoseModel( bodyModel, rightTracks, Character_WorldRoot( [ 0, 0, 0 ], 0 ) );
const rightStepAnkleLeZ = rightPoses[ankleLeIdx][1][2];
const rightStepAnkleRiZ = rightPoses[ankleRiIdx][1][2];
assert( rightStepAnkleRiZ < rightStepAnkleLeZ, 'At bobCycle=192 (right footstrike), right ankle must be lower than left ankle' );

// 9. ADS continuous blending test
const adsAnim = JSON.parse( fs.readFileSync( path.join( animsDir, 'pb_stand_ads.json' ), 'utf8' ) );
const idleTracks = Character_EvaluateTracks( idleAnim, 0 );
const adsTracks = Character_EvaluateTracks( adsAnim, 0 );
const blendedAdsHalf = Character_BlendTracks( idleTracks, adsTracks, 0.5 );
assert( blendedAdsHalf.j_shoulder_ri, 'Blended ADS must contain shoulder bones' );
assert( blendedAdsHalf.j_shoulder_ri.q, 'Blended ADS shoulder must have quaternion' );

// 9b. Moving ADS test (torso layers ADS while legs keep running)
const runTracksForAds = Character_EvaluateTracks( runAnim, 200 );
const movingAdsBlended = Character_BlendTracks( runTracksForAds, adsTracks, 1.0, CHARACTER_TORSO_BONES );
// Torso bones must come from ADS pose
assert.deepEqual( movingAdsBlended.j_shoulder_ri.q, adsTracks.j_shoulder_ri.q, 'Torso bones must aim down sights when moving' );
// Leg bones must come from running pose, NOT stand_ads
assert.deepEqual( movingAdsBlended.j_ankle_le.q, runTracksForAds.j_ankle_le.q, 'Leg bones must keep running animation while ADS moving' );
assert.deepEqual( movingAdsBlended.j_ankle_ri.p, runTracksForAds.j_ankle_ri.p, 'Leg bone positions must keep running stride while ADS moving' );

// 10. Jump landing transition test (no mid-air freezing after touchdown)
const landingState = {
	time_ms: 1000,
	stance: 60,
	velocity: [ 0, 0, 0 ],
	yaw: 0,
	pitch: 0,
	grounded: true,
	airborne: false,
	landing: true,
	jumping: true, // Physics cooldown is still true, but landing must take precedence
};
assert.equal( Character_SelectAnim( landingState ), 'land_stand', 'When touching down, landing animation must play even if jumping cooldown is true' );

const groundedAfterLandingState = {
	time_ms: 1300,
	stance: 60,
	velocity: [ 0, 0, 0 ],
	yaw: 0,
	pitch: 0,
	grounded: true,
	airborne: false,
	landing: false,
	jumping: true, // Physics cooldown is still true (within 1.8s)
};
assert.equal( Character_SelectAnim( groundedAfterLandingState ), 'stand_idle', 'Once landing completes, must transition to stand_idle, not hold jump animation' );

// 11. ADS movement animation selection test
const movingAdsState = {
	time_ms: 1000,
	stance: 60,
	velocity: [ 100, 0, 0 ],
	yaw: 0,
	pitch: 0,
	ads: true,
	grounded: true,
	airborne: false,
	landing: false,
};
assert.equal( Character_SelectAnim( movingAdsState ), 'walk_forward', 'Moving while ADS must select dedicated walk_forward animation' );

const movingCrouchAdsState = {
	time_ms: 1000,
	stance: 40,
	velocity: [ 100, 0, 0 ],
	yaw: 0,
	pitch: 0,
	ads: true,
	grounded: true,
	airborne: false,
	landing: false,
};
assert.equal( Character_SelectAnim( movingCrouchAdsState ), 'crouch_walk_forward', 'Crouch moving while ADS must select crouch_walk_forward animation' );

// Verify the ADS walk animation JSON files exist and have valid bone channels
const walkAnim = JSON.parse( fs.readFileSync( path.join( animsDir, 'pb_stand_shoot_walk_forward.json' ), 'utf8' ) );
assert( walkAnim.frames > 0, 'walk_forward animation must have frames' );
assert( Object.keys( walkAnim.channels ).length > 50, 'walk_forward animation must have bone channels' );
const walkTracks = Character_EvaluateTracks( walkAnim, 250 );
assert( walkTracks.j_ankle_le?.q, 'walk_forward must evaluate left ankle orientation' );
assert( walkTracks.j_ankle_ri?.q, 'walk_forward must evaluate right ankle orientation' );

// 12. Torso action animation selection tests (fire, reload)
const fireStandAction = Character_SelectTorsoAnim(
	{ id: 'm1carbine_mp', phase: 'fire', ads: 0, elapsed: 50, remaining: 100 },
	60,
	false
);
assert.equal( fireStandAction?.animKey, 'fire_stand', 'Stand hip fire must select fire_stand' );

const fireAdsAction = Character_SelectTorsoAnim(
	{ id: 'm1carbine_mp', phase: 'fire', ads: 1, elapsed: 50, remaining: 100 },
	60,
	true
);
assert.equal( fireAdsAction?.animKey, 'fire_stand_ads', 'Stand ADS fire must select fire_stand_ads' );

const reloadAutoAction = Character_SelectTorsoAnim(
	{ id: 'm1carbine_mp', phase: 'reload', ads: 0, elapsed: 500, remaining: 1500 },
	60,
	false
);
assert.equal( reloadAutoAction?.animKey, 'reload_stand_auto', 'M1Carbine stand reload must select reload_stand_auto' );

const reloadCrouchAction = Character_SelectTorsoAnim(
	{ id: 'm1carbine_mp', phase: 'reload', ads: 0, elapsed: 500, remaining: 1500 },
	40,
	false
);
assert.equal( reloadCrouchAction?.animKey, 'reload_crouch_rifle', 'Crouch reload must select reload_crouch_rifle' );

// Prone firing and reload selection tests
const fireProneAction = Character_SelectTorsoAnim(
	{ id: 'm1carbine_mp', phase: 'fire', ads: 0, elapsed: 50, remaining: 100 },
	11,
	false
);
assert.equal( fireProneAction?.animKey, 'fire_prone', 'Prone rifle fire must select fire_prone' );

const fireProneAutoAction = Character_SelectTorsoAnim(
	{ id: 'mp40_mp', phase: 'fire', ads: 0, elapsed: 50, remaining: 100 },
	11,
	false
);
assert.equal( fireProneAutoAction?.animKey, 'fire_prone_auto', 'Prone auto fire must select fire_prone_auto' );

const fireProneBoltAction = Character_SelectTorsoAnim(
	{ id: 'kar98k_mp', phase: 'fire', ads: 0, elapsed: 50, remaining: 100 },
	11,
	false
);
assert.equal( fireProneBoltAction?.animKey, 'fire_prone_rifle', 'Prone bolt fire must select fire_prone_rifle' );

const reloadProneAutoAction = Character_SelectTorsoAnim(
	{ id: 'mp40_mp', phase: 'reload', ads: 0, elapsed: 500, remaining: 1500 },
	11,
	false
);
assert.equal( reloadProneAutoAction?.animKey, 'reload_prone_auto', 'Prone auto reload must select reload_prone_auto' );

const reloadProneRifleAction = Character_SelectTorsoAnim(
	{ id: 'kar98k_mp', phase: 'reload', ads: 0, elapsed: 500, remaining: 1500 },
	11,
	false
);
assert.equal( reloadProneRifleAction?.animKey, 'reload_prone_rifle', 'Prone rifle reload must select reload_prone_rifle' );

// 13. Retail BG_RunLerpFrameRate & BG_PlayerAnimation tests
const proneCrawlAnim = JSON.parse( fs.readFileSync( path.join( animsDir, 'pb_prone_crawl.json' ), 'utf8' ) );
const proneSpeed = Character_AnimMoveSpeed( proneCrawlAnim );
assert( proneSpeed > 14 && proneSpeed < 18, `pb_prone_crawl authored moveSpeed must be ~15.9 units/s, got ${proneSpeed}` );

const combatRunAnim = JSON.parse( fs.readFileSync( path.join( animsDir, 'pb_combatrun_forward_loop.json' ), 'utf8' ) );
const runSpeed = Character_AnimMoveSpeed( combatRunAnim );
assert( runSpeed > 250 && runSpeed < 280, `pb_combatrun_forward_loop moveSpeed must be ~268.5 units/s, got ${runSpeed}` );

const lfTest = { rate: 1.0, oldTime: 1000, oldOrigin: [ 0, 0, 0 ], playhead: 0 };
// Move 28.5 units over 1 second (prone crawl speed)
const proneRate = BG_RunLerpFrameRate( lfTest, proneCrawlAnim, [ 28.5, 0, 0 ], 2000, false );
assert( proneRate > 1.6 && proneRate < 1.9, `Prone crawl rate at 28.5 units/s must be ~1.78, got ${proneRate}` );

// Move 190 units over 1 second (sprint speed)
const runLfTest = { rate: 1.0, oldTime: 1000, oldOrigin: [ 0, 0, 0 ], playhead: 0 };
const sprintRate = BG_RunLerpFrameRate( runLfTest, combatRunAnim, [ 190, 0, 0 ], 2000, false );
assert( sprintRate > 0.65 && sprintRate < 0.75, `Sprint rate at 190 units/s must be ~0.71, got ${sprintRate}` );

// Stationary player in locomotion animation clamps to retail floor 0.1
const stillRate = BG_RunLerpFrameRate( runLfTest, combatRunAnim, [ 190, 0, 0 ], 3000, false );
assert.equal( stillRate, 0.1, 'Stationary player in locomotion must clamp to retail floor 0.1' );

// Ladder stationary player drops to 0.0
const ladderLfTest = { rate: 1.0, oldTime: 1000, oldOrigin: [ 0, 0, 0 ], playhead: 0 };
const ladderStillRate = BG_RunLerpFrameRate( ladderLfTest, combatRunAnim, [ 0, 0, 0 ], 2000, true );
assert.equal( ladderStillRate, 0.0, 'Ladder stationary player must produce 0.0 rate' );

// Verify BG_PlayerAnimation advances legs playhead
const legsLf = { rate: 1.0, oldTime: 1000, oldOrigin: [ 0, 0, 0 ], playhead: 100 };
const torsoLf = { rate: 1.0, oldTime: 1000, oldOrigin: [ 0, 0, 0 ], playhead: 50 };
const rates = BG_PlayerAnimation( legsLf, torsoLf, combatRunAnim, undefined, [ 19, 0, 0 ], 1100, 0.1 );
assert( rates.legsRate > 0.6 && rates.legsRate < 0.8, 'BG_PlayerAnimation must compute correct legsRate' );
assert( legsLf.playhead > 150, 'BG_PlayerAnimation must advance legs playhead by dt * rate' );

// Verify torso animation files exist in dist and have valid channels
const fireAnim = JSON.parse( fs.readFileSync( path.join( animsDir, 'pt_stand_shoot.json' ), 'utf8' ) );
assert( fireAnim.frames > 0, 'pt_stand_shoot animation must have frames' );
assert( Object.keys( fireAnim.channels ).length > 50, 'pt_stand_shoot must have bone channels' );
const fireTracks = Character_EvaluateTracks( fireAnim, 50 );
assert( fireTracks.j_wrist_ri?.q, 'pt_stand_shoot must evaluate right wrist orientation' );

// 14. Torso reload action smooth blend-back test
const reloadAnim = JSON.parse( fs.readFileSync( path.join( animsDir, 'pt_reload_stand_auto.json' ), 'utf8' ) );
assert( reloadAnim.frames > 0, 'pt_reload_stand_auto must have frames' );
const reloadDuration = Character_AnimDurationMs( reloadAnim );
assert( reloadDuration > 1000 && reloadDuration < 1500, `pt_reload_stand_auto duration must be ~1292ms, got ${reloadDuration}` );

const reloadEndTracks = Character_EvaluateTracks( reloadAnim, reloadDuration );
assert( reloadEndTracks.j_wrist_ri, 'Reload end tracks must contain wrist' );

// Blend back across blendDuration (200ms) with outWeight = 1.0, 0.5, 0.0
const reloadBlendedFull = Character_BlendTracks( idleTracks, reloadEndTracks, 1.0, CHARACTER_TORSO_BONES );
const reloadBlendedHalf = Character_BlendTracks( idleTracks, reloadEndTracks, 0.5, CHARACTER_TORSO_BONES );
const reloadBlendedNone = Character_BlendTracks( idleTracks, reloadEndTracks, 0.0, CHARACTER_TORSO_BONES );

// Wrist rotation quaternion must interpolate smoothly between reload and idle
const wqFull = reloadBlendedFull.j_wrist_ri.q;
const wqHalf = reloadBlendedHalf.j_wrist_ri.q;
const wqNone = reloadBlendedNone.j_wrist_ri.q;
assert( wqFull && wqHalf && wqNone, 'Wrist orientation must be present in all blended tracks' );

// Slerp midpoint dot products should be positive and smooth
const dotFullHalf = wqFull[0] * wqHalf[0] + wqFull[1] * wqHalf[1] + wqFull[2] * wqHalf[2] + wqFull[3] * wqHalf[3];
const dotHalfNone = wqHalf[0] * wqNone[0] + wqHalf[1] * wqNone[1] + wqHalf[2] * wqNone[2] + wqHalf[3] * wqNone[3];
assert( dotFullHalf > 0.5 && dotHalfNone > 0.5, 'Blended rotation quaternions must smoothly interpolate without flipping' );

// Torso bones must interpolate while leg bones remain untouched
assert.deepEqual( reloadBlendedFull.j_knee_ri, idleTracks.j_knee_ri, 'Leg bones must not be modified by torso action blend' );
assert.deepEqual( reloadBlendedNone.j_wrist_ri, idleTracks.j_wrist_ri, 'Zero-weight blend must exactly match base idle tracks' );

// 15. ADS Walk-to-Stand crossfade continuity test (verifies releasing W during ADS does not snap)
const walkAnimAds = JSON.parse( fs.readFileSync( path.join( animsDir, 'pb_stand_shoot_walk_forward.json' ), 'utf8' ) );
const standAdsAnim = JSON.parse( fs.readFileSync( path.join( animsDir, 'pb_stand_ads.json' ), 'utf8' ) );
assert( walkAnimAds.frames > 0 && standAdsAnim.frames > 0, 'Walk and stand ADS animations must have frames' );

const walkTracksForAds = Character_EvaluateTracks( walkAnimAds, 300 );
const standAdsTracks = Character_EvaluateTracks( standAdsAnim, 0 );

// Sample blend factors over the 200ms transition window: 0%, 25%, 50%, 75%, 100%
const blendSamples = [ 0.0, 0.25, 0.5, 0.75, 1.0 ].map( ( factor ) =>
	Character_BlendTracks( walkTracksForAds, standAdsTracks, factor )
);

// Verify every bone rotation in torso and spine transitions smoothly without angular discontinuity
const testBones = [ 'j_spine4', 'j_shoulder_ri', 'j_elbow_ri', 'j_wrist_ri', 'j_head' ];
for ( const bone of testBones ) {
	for ( let i = 0; i < blendSamples.length - 1; i++ ) {
		const qA = blendSamples[i][bone]?.q;
		const qB = blendSamples[i + 1][bone]?.q;
		assert( qA && qB, `Bone ${bone} must exist in all blended poses` );
		const dot = qA[0] * qB[0] + qA[1] * qB[1] + qA[2] * qB[2] + qA[3] * qB[3];
		assert( dot > 0.85, `Bone ${bone} transition dot product must be > 0.85 (got ${dot.toFixed(3)}) across blend step` );
	}
}

console.log( `Skinning verified: ${bodySurface.indices.length} indices skinned, height range [${minZ.toFixed(1)}, ${maxZ.toFixed(1)}] units.` );
console.log( 'Lean controller, weapon attachment, bobCycle footstep sync, ADS blending, and torso reload crossfade verified!' );
console.log( 'Character pipeline tests PASSED!' );
