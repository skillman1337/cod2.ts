/*
===============================================================================

	setup-view.mjs

	Call of Duty 2 / id Tech Local Installation & Cache Setup DOM View
	Constructs the user interface for local game directory authorization,
	asset extraction progress reporting, diagnostic logs, and cache launch controls.

===============================================================================
*/


// ---------------------------------------------------------------------------
// byte formatting & progress calculation
// ---------------------------------------------------------------------------

/*
====================
formatBytes

Formats a byte count into a human-readable display string (B, KB, MB, GB).
====================
*/
export function formatBytes( value ) {
	if ( !Number.isFinite( value ) || value < 0 ) {
		return '0 B';
	}
	if ( value < 1024 ) {
		return `${Math.round( value )} B`;
	}

	const units = ['KB', 'MB', 'GB'];
	let n = value / 1024;
	let i = 0;

	while ( n >= 1024 && i < units.length - 1 ) {
		n /= 1024;
		i++;
	}

	return `${n.toFixed( n < 10 ? 1 : 0 )} ${units[i]}`;
}

/*
====================
progressValue

Normalizes progress values, clamping completed units to the range [0, total].
Returns null if total is not finite or non-positive to represent indeterminate state.
====================
*/
export function progressValue( done, total ) {
	return Number.isFinite( done ) && Number.isFinite( total ) && total > 0
		? { done: Math.min( total, Math.max( 0, done ) ), total }
		: null;
}


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const ACTIONS = ['choose', 'resume', 'play', 'cancel', 'change', 'rebuild', 'forget'];

const words = ( text ) => String( text ).toLowerCase();


// ---------------------------------------------------------------------------
// setup view factory
// ---------------------------------------------------------------------------

/*
====================
createSetupView

Instantiates and injects the Call of Duty 2 installation dossier DOM panel.
Returns control methods for state transitions, stage updates, and event logging.
====================
*/
export function createSetupView() {
	const panel = document.createElement( 'section' );
	panel.id = 'cod2-setup';
	panel.dataset.state = 'checking';
	panel.setAttribute( 'aria-label', 'Call of Duty 2 local installation' );
	panel.innerHTML = `
    <div class="setup-dossier">
      <div class="setup-atmosphere" aria-hidden="true"><div class="setup-ruins"></div><div class="setup-map"></div></div>
      <header class="setup-header">
        <div class="setup-brand"><p>COD2 BROWSER PORT</p><span>Local Install · One-Time Setup</span></div>
        <div class="setup-stamp" aria-hidden="true">WAR DEPARTMENT<br>LOCAL ARCHIVE / 02<br>PERSONAL COPY<span></span></div>
      </header>
      <div class="setup-layout">
        <main class="setup-main" aria-labelledby="setup-title">
          <h1 id="setup-title">Checking your\ninstallation.</h1>
          <div class="setup-rule" aria-hidden="true"></div>
          <p id="setup-help" class="setup-help">Looking for a completed cache on this device.</p>
          <p id="setup-error" class="setup-error" role="alert" hidden></p>
          <div class="setup-buttons">
            <button id="setup-choose" class="setup-primary" data-icon="folder" hidden>Browse for game folder<span aria-hidden="true">→</span></button>
            <button id="setup-resume" class="setup-primary" data-icon="folder" hidden>Use saved game folder<span aria-hidden="true">→</span></button>
            <button id="setup-play" class="setup-primary" data-icon="play" hidden>Launch from cache<span aria-hidden="true">→</span></button>
            <button id="setup-working" class="setup-primary setup-working" data-icon="folder" disabled hidden>Preparing your game<span aria-hidden="true">···</span></button>
          </div>
          <div class="setup-toolbar" aria-label="Installation options">
            <button id="setup-cancel" class="setup-text-button" data-icon="cancel" hidden>Cancel setup</button>
            <button id="setup-rebuild" class="setup-text-button" data-icon="rebuild" hidden>Rebuild cache</button>
            <button id="setup-log-toggle" class="setup-text-button" data-icon="log" aria-controls="setup-log-region" aria-expanded="false">Import log</button>
            <button id="setup-details-toggle" class="setup-text-button" data-icon="files" aria-controls="setup-details" aria-expanded="false">Local files</button>
          </div>
          <section id="setup-log-region" class="setup-disclosure" aria-label="Import log" hidden>
            <p class="setup-disclosure-heading">Import log <span>THIS SESSION ONLY</span></p>
            <pre id="setup-log" tabindex="0" aria-label="Loading log">No import activity yet.</pre>
          </section>
          <section id="setup-details" class="setup-disclosure" aria-label="Local files and storage" hidden>
            <p>Select your <strong>Call of Duty 2</strong> folder containing <code>main/*.iwd</code>.</p>
            <p class="setup-example">For example<br><code>D:\\Program Files (x86)\\Activision\\Call of Duty 2</code></p>
            <p>Your original files are read-only. Converted assets stay in this browser profile. Clearing site data, private browsing, or browser storage eviction can require setup again.</p>
            <div class="setup-advanced"><button id="setup-change" class="setup-secondary-button" data-icon="folder" hidden>Choose another folder</button><button id="setup-forget" class="setup-secondary-button setup-danger-button" data-icon="trash" hidden>Delete local cache</button></div>
          </section>
        </main>
        <aside class="setup-rail" aria-label="Installation status">
          <div id="setup-idle" class="setup-idle">
            <p id="setup-idle-title" class="setup-rail-title">Awaiting game folder</p>
            <p id="setup-idle-copy">Select your installed copy.\nThe folder must contain <code>main/*.iwd</code>.</p>
            <div class="setup-small-rule" aria-hidden="true"></div>
            <p class="setup-local-note">Read-only access.<br>No files uploaded.</p>
          </div>
          <div id="setup-loading" class="setup-loading" hidden>
            <p id="setup-status" class="setup-rail-title">Checking local cache</p>
            <p class="setup-stage">Stage: <span id="setup-phase">Local cache</span></p>
            <p id="setup-count" class="setup-stat" hidden></p>
            <p id="setup-bytes" class="setup-stat" hidden></p>
            <div id="setup-track" class="setup-track" data-determinate="false">
              <progress id="setup-progress" class="setup-sr-only" aria-label="Current loading stage"></progress>
              <div id="setup-fill" class="setup-fill" aria-hidden="true"></div>
              <div class="setup-sweep" aria-hidden="true"></div>
            </div>
            <p class="setup-file-row"><span>Current:</span> <span id="setup-file" class="setup-file" title="Opening browser storage">Opening browser storage</span></p>
            <p class="setup-time">Elapsed: <span id="setup-elapsed">0.0 s</span></p>
            <p id="setup-activity" class="setup-activity">Opening browser storage</p>
          </div>
          <p id="setup-announcer" class="setup-sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
          <div class="setup-theater" aria-hidden="true">EUROPE<br>1941 – 1945<span></span></div>
        </aside>
      </div>
      <footer class="setup-footer"><span>GAME FILES STAY ON THIS DEVICE</span><span class="setup-preview-note" hidden>DESIGN PREVIEW · SAMPLE LOADING DATA</span></footer>
    </div>`;

	document.body.append( panel );

	const el = ( id ) => panel.querySelector( `#setup-${id}` );

	let clock = null;
	let started = 0;
	const lines = [];
	let lastStatus = '';
	let statusTimer = null;

	/*
	====================
	logs

	Renders buffered log entries to the preformatted log panel and scrolls to the bottom.
	====================
	*/
	function logs() {
		if ( el( 'log-region' ).hidden ) {
			return;
		}
		const node = el( 'log' );
		// Don't drag the log away from someone reading an earlier entry.
		const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
		node.textContent = lines.length ? lines.join( '\n' ) : 'No import activity yet.';
		if ( atBottom ) {
			node.scrollTop = node.scrollHeight;
		}
	}

	/*
	====================
	disclosure

	Toggles visibility and aria attributes for expandable accordion sections.
	====================
	*/
	function disclosure( name, open = el( name ).hidden ) {
		el( name ).hidden = !open;
		el( name === 'log-region' ? 'log-toggle' : 'details-toggle' ).setAttribute( 'aria-expanded', String( open ) );
		if ( open ) {
			logs();
		}
	}

	el( 'log-toggle' ).onclick = () => disclosure( 'log-region' );
	el( 'details-toggle' ).onclick = () => disclosure( 'details' );

	panel.addEventListener( 'keydown', ( event ) => {
		if ( event.key !== 'Escape' ) {
			return;
		}
		const region = event.target.closest( '#setup-log-region, #setup-details' );
		if ( !region || region.hidden ) {
			return;
		}
		const name = region.id.slice( 6 );
		disclosure( name, false );
		el( name === 'log-region' ? 'log-toggle' : 'details-toggle' ).focus();
	} );

	/*
	====================
	flushStatus

	Transfers the debounced status text into the screen-reader aria-live announcer.
	====================
	*/
	function flushStatus() {
		clearTimeout( statusTimer );
		statusTimer = null;
		if ( el( 'announcer' ).textContent !== lastStatus ) {
			el( 'announcer' ).textContent = lastStatus;
		}
	}

	/*
	====================
	stop

	Stops the elapsed time clock and flushes pending screen-reader status announcements.
	====================
	*/
	function stop() {
		clearInterval( clock );
		clock = null;
		if ( statusTimer !== null ) {
			flushStatus();
		}
	}

	/*
	====================
	status

	Updates active activity label and debounces screen-reader accessibility announcements.
	====================
	*/
	function status( message ) {
		const text = String( message );
		if ( text !== el( 'activity' ).textContent ) {
			el( 'activity' ).textContent = text;
		}
		if ( text === lastStatus ) {
			return;
		}
		lastStatus = text;
		// Stage changes are announced, file-level telemetry is deliberately not live.
		if ( statusTimer === null ) {
			statusTimer = setTimeout( flushStatus, 180 );
		}
	}

	/*
	====================
	progress

	Sets the progress bar values, aria attributes, and fill width percentage.
	====================
	*/
	function progress( done, total, description = 'Current loading stage' ) {
		const value = progressValue( done, total );
		el( 'progress' ).setAttribute( 'aria-label', description );
		el( 'track' ).dataset.determinate = String( !!value );

		if ( value ) {
			el( 'progress' ).max = value.total;
			el( 'progress' ).value = value.done;
			el( 'progress' ).setAttribute( 'aria-valuetext', `${value.done} of ${value.total}. ${description}` );
			el( 'fill' ).style.width = `${( value.done / value.total ) * 100}%`;
		} else {
			el( 'progress' ).removeAttribute( 'value' );
			el( 'progress' ).setAttribute( 'aria-valuetext', `In progress. ${description}` );
			el( 'fill' ).style.width = '0%';
		}
	}

	/*
	====================
	stage

	Updates the overall installer stage header, phase label, and loading progress.
	====================
	*/
	function stage( message, { label = 'Working', done, total } = {} ) {
		status( message );
		// Legacy uppercase labels remain supported without shouting in the dossier.
		const text = String( label ).replace( /^STAGE\s+/i, '' );
		el( 'phase' ).textContent = text === text.toUpperCase()
			? text.charAt( 0 ).toUpperCase() + text.slice( 1 ).toLowerCase()
			: text;
		progress( done, total, Number.isFinite( total ) ? 'Completed preparation stages, not time remaining' : message );
	}

	/*
	====================
	task

	Displays fine-grained extraction telemetry: current file path, processed items, and bytes.
	====================
	*/
	function task( { path, files, bytes, detail, done, total, unit = 'files', byteLabel = 'cached' } = {} ) {
		if ( typeof path === 'string' ) {
			el( 'file' ).textContent = path;
			el( 'file' ).title = path;
		}

		const measurable = progressValue( done, total );
		if ( measurable ) {
			el( 'count' ).textContent = `${measurable.done.toLocaleString()} / ${measurable.total.toLocaleString()} ${unit}`;
			el( 'count' ).hidden = false;
			progress( done, total, `${unit} in this stage` );
		} else if ( detail ) {
			el( 'count' ).textContent = words( detail );
			el( 'count' ).hidden = false;
		} else if ( Number.isFinite( files ) ) {
			el( 'count' ).textContent = `${Math.max( 0, Math.floor( files ) ).toLocaleString()} files cached`;
			el( 'count' ).hidden = false;
		}

		if ( Number.isFinite( bytes ) && bytes >= 0 ) {
			el( 'bytes' ).textContent = `${formatBytes( bytes )} ${byteLabel}`;
			el( 'bytes' ).hidden = false;
		}
	}

	/*
	====================
	begin

	Initializes view state and starts the elapsed time counter for check, import, or load modes.
	====================
	*/
	function begin( mode ) {
		stop();
		lastStatus = '';
		el( 'announcer' ).textContent = '';
		started = performance.now();
		panel.hidden = false;
		panel.dataset.state = 'loading';
		panel.dataset.mode = mode;

		el( 'loading' ).hidden = false;
		el( 'idle' ).hidden = true;
		el( 'error' ).hidden = true;

		el( 'title' ).textContent = mode === 'check'
			? 'Checking your\ninstallation.'
			: mode === 'import'
				? 'Locate your\ngame folder once.'
				: 'Your game.\nReady for action.';

		el( 'help' ).textContent = mode === 'check'
			? 'Looking for a completed cache on this device.'
			: mode === 'import'
				? 'After the first import, future launches\nload from local cache.'
				: 'Loading your saved installation.\nNo folder selection. No re-import.';

		el( 'status' ).textContent = mode === 'check'
			? 'Checking local cache'
			: mode === 'import'
				? 'Preparing local assets'
				: 'Loading cached assets';

		el( 'working' ).hidden = mode === 'check';
		el( 'working' ).firstChild.textContent = mode === 'import' ? 'Preparing your game' : 'Launching from cache';
		el( 'working' ).dataset.icon = mode === 'import' ? 'folder' : 'play';
		el( 'count' ).textContent = '';
		el( 'count' ).hidden = true;
		el( 'bytes' ).textContent = '';
		el( 'bytes' ).hidden = true;
		el( 'file' ).textContent = mode === 'import' ? 'Locating main/*.iwd' : 'Opening browser storage';
		el( 'file' ).title = el( 'file' ).textContent;
		el( 'elapsed' ).textContent = '0.0 s';

		clock = setInterval( () => {
			el( 'elapsed' ).textContent = `${( ( performance.now() - started ) / 1000 ).toFixed( 1 )} s`;
		}, 100 );

		stage(
			mode === 'import' ? 'Locating game archives' : 'Checking for a completed installation',
			{ label: mode === 'import' ? 'Archives' : 'Local cache' }
		);
	}

	/*
	====================
	ready

	Displays the idle/ready screen reflecting whether game cache or directory handles are saved.
	====================
	*/
	function ready( { cached = false, saved = false, message } = {} ) {
		stop();
		panel.hidden = false;
		panel.dataset.state = cached ? 'cached' : 'setup';

		el( 'loading' ).hidden = true;
		el( 'idle' ).hidden = false;
		el( 'error' ).hidden = true;
		el( 'working' ).hidden = true;

		el( 'title' ).textContent = cached
			? 'Your game.\nReady when you are.'
			: saved
				? 'Your folder.\nAlready remembered.'
				: 'Locate your\ngame folder once.';

		el( 'help' ).textContent = message || (
			cached
				? 'Your installation is saved in this browser.\nLaunch directly. No folder selection needed.'
				: saved
					? 'Use your saved folder to prepare the local cache.\nAfter setup, future visits load automatically.'
					: 'After the first import, future launches\nload from local cache.'
		);

		el( 'idle-title' ).textContent = cached
			? 'Local cache ready'
			: saved
				? 'Saved folder available'
				: 'Awaiting game folder';

		el( 'idle-copy' ).textContent = cached
			? 'No re-import required.\nYour original folder can stay closed.'
			: saved
				? 'The local cache needs to be prepared.\nPermission is requested when you continue.'
				: 'Select your installed copy.\nThe folder must contain main/*.iwd.';

		lastStatus = cached
			? 'Local cache ready.'
			: saved
				? 'Use your saved game folder.'
				: 'Select your Call of Duty 2 game folder for one-time setup.';
		flushStatus();
	}

	/*
	====================
	fail

	Transitions the dossier panel to an error alert state with error guidance.
	====================
	*/
	function fail( message ) {
		stop();
		panel.hidden = false;
		panel.dataset.state = 'error';

		el( 'loading' ).hidden = true;
		el( 'idle' ).hidden = false;
		el( 'working' ).hidden = true;

		el( 'title' ).textContent = 'Setup\ninterrupted.';
		el( 'help' ).textContent = 'Your original game files have not been modified.';
		el( 'error' ).textContent = String( message );
		el( 'error' ).hidden = false;
		el( 'idle-title' ).textContent = 'Attention required';
		el( 'idle-copy' ).textContent = 'Review the message to continue.\nMore details are in the import log.';

		// The alert owns the error announcement; do not duplicate it in the live status.
		lastStatus = '';
		flushStatus();
	}

	return {
		panel,
		el,
		status,
		stage,
		task,
		begin,
		ready,
		fail,
		stop,
		log( message ) {
			lines.push( String( message ) );
			if ( lines.length > 160 ) {
				lines.splice( 0, lines.length - 160 );
			}
			logs();
		},
		finish() {
			stop();
			panel.hidden = true;
		},
		show( ...names ) {
			const focused = document.activeElement;
			ACTIONS.forEach( ( name ) => {
				el( name ).hidden = !names.includes( name );
			} );
			// Restore keyboard focus when a loading state replaced the previous action.
			if ( focused && panel.contains( focused ) && focused.hidden ) {
				const next = names.find( ( name ) => !el( name ).closest( '[hidden]' ) );
				( next ? el( next ) : el( 'log-toggle' ) ).focus( { preventScroll: true } );
			}
		},
	};
}
