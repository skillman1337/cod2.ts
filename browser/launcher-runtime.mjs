/*
===============================================================================

	launcher-runtime.mjs

	Service-worker binding and engine-start observation. No import UI state.

===============================================================================
*/

import { APP_BASE, appURL } from './deployment.mjs';

// ---------------------------------------------------------------------------
// service worker coordination
// ---------------------------------------------------------------------------

/*
====================
workerReady

Ensures the local asset service worker is registered, active, and controlling the page.
====================
*/
async function workerReady() {
	const scriptURL = new URL( appURL( 'local-assets.sw.js' ), location.href ).href;
	await navigator.serviceWorker.register( scriptURL, {
		type: 'module',
		scope: APP_BASE,
		updateViaCache: 'none',
	} );

	// A parent-scope worker must never satisfy this project's binding.
	const controlsThisApp = () => navigator.serviceWorker.controller?.scriptURL === scriptURL;

	if ( !controlsThisApp() ) {
		await new Promise( ( resolve, reject ) => {
			const timeout = setTimeout( () => {
				navigator.serviceWorker.removeEventListener( 'controllerchange', changed );
				reject( new Error( 'The local asset worker could not take control. Reload this page.' ) );
			}, 15000 );

			function changed() {
				if ( controlsThisApp() ) {
					clearTimeout( timeout );
					navigator.serviceWorker.removeEventListener( 'controllerchange', changed );
					resolve();
				}
			}

			navigator.serviceWorker.addEventListener( 'controllerchange', changed );
			changed();
		} );
	}
}

/*
====================
bind

Binds this page's Service Worker client to the specified cache generation ID.
====================
*/
export async function bind( id ) {
	await workerReady();

	await new Promise( ( resolve, reject ) => {
		const channel = new MessageChannel();

		const timer = setTimeout( () => {
			channel.port1.close();
			reject( new Error( 'Timed out connecting local assets.' ) );
		}, 15000 );

		channel.port1.onmessage = ( event ) => {
			clearTimeout( timer );
			channel.port1.close();

			if ( event.data.ok ) {
				resolve();
			} else {
				reject( new Error( event.data.error ) );
			}
		};

		navigator.serviceWorker.controller.postMessage( { type: 'cod2-bind', id }, [channel.port2] );
	} );
}


// ---------------------------------------------------------------------------
// game engine startup & telemetry
// ---------------------------------------------------------------------------

/*
====================
watchEngine

Monitors engine status events and resource loading during WebGPU startup.
====================
*/
export function watchEngine( ui, log ) {
	let resolve;
	let reject;
	let timer;
	let observer;
	let assets = 0;

	const promise = new Promise( ( yes, no ) => {
		resolve = yes;
		reject = no;
	} );

	// Attach a handler immediately; module evaluation may still be in progress.
	promise.catch( () => {} );

	function progress( event ) {
		const info = event.detail;

		if ( info?.phase === 'ready' ) {
			resolve();
		} else if ( info?.phase === 'error' ) {
			reject( new Error( info.message ) );
		} else if ( info?.message ) {
			ui.stage( info.message, { label: 'GRAPHICS', step: 'launch', cached: true } );
			log( info.message );
		}
	}

	window.addEventListener( 'cod2:engine-status', progress );

	if ( 'PerformanceObserver' in window ) {
		observer = new PerformanceObserver( ( list ) => {
			for ( const entry of list.getEntries() ) {
				const url = new URL( entry.name, location.href );

				const localPath = url.pathname.startsWith( APP_BASE ) ? '/' + url.pathname.slice( APP_BASE.length ) : '';
				if ( url.origin !== location.origin || !/^\/(?:__cod2_local|assets|maps|viewmodels|characters|weaponfx|sound)\//.test( localPath ) ) {
					continue;
				}

				const path = decodeURIComponent( localPath.replace( /^\/__cod2_local\/[^/]+\//, '' ).replace( /^\//, '' ) );

				assets++;
				ui.task( { path, detail: `${assets} ASSETS READ` } );
				log( `Loaded ${path} (${entry.duration.toFixed( 1 )} ms)` );
			}
		} );

		observer.observe( { type: 'resource', buffered: false } );
	}

	timer = setTimeout( () => {
		reject( new Error( 'Graphics did not finish loading. Open Import log for loading details, then retry.' ) );
	}, 90000 );

	return {
		promise,
		stop() {
			clearTimeout( timer );
			observer?.disconnect();
			window.removeEventListener( 'cod2:engine-status', progress );
		},
	};
}

