/*
===============================================================================

	export_setup_preview.mjs

	Call of Duty 2 / id Tech Offline Dossier Setup Preview Exporter
	Bundles the setup DOM view, stylesheet, embedded artwork, and interactive
	preview scenario driver into a single standalone offline HTML document.

===============================================================================
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


// ---------------------------------------------------------------------------
// paths & configuration
// ---------------------------------------------------------------------------

const root = fileURLToPath( new URL( '../..', import.meta.url ) );
const target = path.resolve( process.argv[2] || path.join( root, 'temp/cod2-dossier-preview.html' ) );


// ---------------------------------------------------------------------------
// asset bundling & html export
// ---------------------------------------------------------------------------

/*
====================
exportSetupPreview

Inlines local WebP artwork into CSS and serializes view & demo scripts into HTML.
====================
*/
function exportSetupPreview() {
	let css = fs.readFileSync( path.join( root, 'browser/setup.css' ), 'utf8' );

	css = css.replace( /url\('\.\/art\/([^']+)'\)/g, ( _, name ) => {
		const data = fs.readFileSync( path.join( root, 'browser/art', name ) );
		return `url('data:image/webp;base64,${data.toString( 'base64' )}')`;
	} );

	const view = fs.readFileSync( path.join( root, 'browser/setup-view.mjs' ), 'utf8' ).replace( /^export /gm, '' );
	const demo = fs.readFileSync( path.join( root, 'browser/preview.mjs' ), 'utf8' ).replace( /^import .*;\n/gm, '' );

	const escapeScript = ( text ) => text.replace( /<\/script/gi, '<\\/script' );

	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>CoD2 dossier — interactive design preview</title><link rel="icon" href="data:,"><style>${css}</style></head><body><script type="module">${escapeScript( view + '\n' + demo )}</script></body></html>`;

	fs.mkdirSync( path.dirname( target ), { recursive: true } );
	fs.writeFileSync( target, html );

	console.log( `${target} (${Buffer.byteLength( html ).toLocaleString()} bytes)` );
}

exportSetupPreview();
