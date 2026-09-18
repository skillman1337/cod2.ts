/*
===============================================================================

	vite.config.ts

	Call of Duty 2 / id Tech Dev Server & Bundler Configuration
	Development server and bundler settings for the id-webgpu browser build.

===============================================================================
*/

import { fileURLToPath, URL } from 'node:url';

import { defineConfig, type UserConfig } from 'vite';
import { normalizeBase } from './browser/deployment.mjs';
import { browserAssetsPlugin } from './tools/build/browser_assets_plugin.mjs';
import { movementTraceMiddleware } from './tools/debug/movement_trace_server.mjs';


// ---------------------------------------------------------------------------
// forward
// Vite_BuildRootConfig
// ---------------------------------------------------------------------------

/*
====================
Vite_BuildRootConfig

Root configuration for Vite dev server and production builds.
Root at workspace root so index.html and engine modules resolve locally.
====================
*/
function Vite_BuildRootConfig(): UserConfig {
	const root = fileURLToPath( new URL( '.', import.meta.url ) );

	const config: UserConfig = {} as UserConfig;
	config.root = '.';
	config.base = normalizeBase( process.env.COD2_BASE_PATH || '/' );
	config.publicDir = false; // Never copy extracted proprietary assets into the site.
	config.build = {
		outDir: 'temp/dist',
		assetsDir: 'app-code',
		target: 'es2022',
		modulePreload: false,
	};

	config.plugins = [
		browserAssetsPlugin( root ),
		{
			name: 'local-movement-traces',
			configureServer( server ) {
				server.middlewares.use( movementTraceMiddleware( root ) );
			},
			configurePreviewServer( server ) {
				server.middlewares.use( movementTraceMiddleware( root ) );
			},
		},
	];

	config.server = {
		warmup: {
			clientFiles: ['./index.ts'],
		},
	};

	config.resolve = {
		alias: {
			'@': root.replace( /[\\/]+$/, '' ),
		},
	};

	return config;
}


// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

export default defineConfig( Vite_BuildRootConfig() );
