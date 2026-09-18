/*
===============================================================================

	preview.mjs

	Call of Duty 2 / id Tech Interactive Design Preview Driver
	Simulates installer lifecycle stages (importing, cache loading, ready states,
	and storage errors) for UI layout evaluation and standalone offline previewing.

===============================================================================
*/

import { createSetupView } from './setup-view.mjs';


// ---------------------------------------------------------------------------
// setup view initialization & preview state
// ---------------------------------------------------------------------------

const ui = createSetupView();
ui.panel.querySelector( '.setup-preview-note' ).hidden = false;

let timers = [];
let cached = false;

/*
====================
later

Schedules a delayed callback tracked in the active timers list.
====================
*/
const later = ( fn, ms ) => {
	timers.push( setTimeout( fn, ms ) );
};

/*
====================
reset

Cancels all in-flight preview timers and halts current view activity.
====================
*/
function reset() {
	timers.forEach( clearTimeout );
	timers = [];
	ui.stop();
}


// ---------------------------------------------------------------------------
// scenario simulation
// ---------------------------------------------------------------------------

/*
====================
scene

Transitions the interactive preview UI through simulated installer states.
====================
*/
function scene( state, animate = false ) {
	reset();

	if ( state === 'loading' ) {
		ui.begin( 'import' );
		ui.show( 'cancel' );
		ui.stage( 'Extracting weapons and first-person viewmodels', {
			label: 'Weapons · 8 / 11',
			done: 7,
			total: 11,
		} );
		ui.task( {
			path: 'viewmodels/textures/mtl_weapon_kar98k.png',
			files: 864,
			bytes: 156900000,
		} );
		ui.log( '[Preview] Extracting weapons and first-person viewmodels' );
		ui.log( '[Preview] viewmodels/textures/mtl_weapon_kar98k.png' );

		if ( animate ) {
			ui.stage( 'Reading UI materials and textures', {
				label: 'Textures · 3 / 11',
				done: 2,
				total: 11,
			} );
			ui.task( {
				path: 'images/background_american_w.iwi',
				files: 142,
				bytes: 16500000,
			} );
			later( () => {
				ui.stage( 'Extracting weapons and first-person viewmodels', {
					label: 'Weapons · 8 / 11',
					done: 7,
					total: 11,
				} );
				ui.task( {
					path: 'viewmodels/textures/mtl_weapon_kar98k.png',
					files: 864,
					bytes: 156900000,
				} );
			}, 1500 );
			later( () => {
				ui.stage( 'Extracting Toujane world, collision, and lightgrid', {
					label: 'World · 11 / 11',
					done: 10,
					total: 11,
				} );
				ui.task( {
					path: 'maps/mp_toujane/world.json',
					files: 1208,
					bytes: 348000000,
				} );
			}, 3200 );
			later( () => {
				ui.stage( 'Saving and checking your local cache', {
					label: 'Final check',
					done: 11,
					total: 11,
				} );
				ui.show();
			}, 4800 );
			later( () => {
				cached = true;
				scene( 'cache', true );
			}, 5900 );
		} else {
			ui.stop();
			ui.el( 'elapsed' ).textContent = '12.8 s';
		}
	} else if ( state === 'cache' ) {
		ui.begin( 'cache' );
		ui.show();
		ui.stage( 'Loading menu artwork, font atlas and cursor', { label: 'Graphics' } );
		ui.task( {
			path: 'assets/images/background_american_w.png',
			detail: '18 assets read',
		} );
		ui.log( '[Preview] Loading cached menu artwork, font atlas and cursor' );

		if ( animate ) {
			later( () => {
				cached = true;
				scene( 'ready' );
				ui.el( 'help' ).textContent = 'Menu handoff complete.\nThe live app opens the game here.';
			}, 2400 );
		} else {
			ui.stop();
			ui.el( 'elapsed' ).textContent = '0.4 s';
		}
	} else if ( state === 'ready' ) {
		cached = true;
		ui.ready( { cached: true, saved: true } );
		ui.show( 'play', 'change', 'rebuild', 'forget' );
	} else if ( state === 'saved' ) {
		cached = false;
		ui.ready( { saved: true } );
		ui.show( 'resume', 'change', 'forget' );
	} else if ( state === 'error' ) {
		ui.ready();
		ui.fail( 'Not enough browser storage. Free disk space and retry. Your previous completed cache has not been replaced.' );
		ui.show( 'choose' );
		ui.log( '[Preview] QuotaExceededError: insufficient local storage.' );
	} else {
		cached = false;
		ui.ready();
		ui.show( 'choose' );
	}
}


// ---------------------------------------------------------------------------
// user interaction & preview bootstrapping
// ---------------------------------------------------------------------------

ui.el( 'choose' ).onclick =
ui.el( 'resume' ).onclick =
ui.el( 'change' ).onclick =
ui.el( 'rebuild' ).onclick = () => scene( 'loading', true );

ui.el( 'play' ).onclick = () => scene( 'cache', true );
ui.el( 'cancel' ).onclick = () => scene( cached ? 'ready' : 'setup' );
ui.el( 'forget' ).onclick = () => {
	if ( confirm( 'Reset this design preview? No real game files or caches are used.' ) ) {
		scene( 'setup' );
	}
};

scene( new URLSearchParams( location.search ).get( 'state' ) || 'setup' );

// Test surface exists in this preview only. The production entry never loads it.
window.__cod2Preview = { ui, scene, reset };
