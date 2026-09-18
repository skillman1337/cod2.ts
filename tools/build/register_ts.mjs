/*
===============================================================================

	register_ts.mjs

	Call of Duty 2 / id Tech Node Module Registration Hook
	Registers the TypeScript loader for Node test suites and CLI tooling.

===============================================================================
*/

import { register } from 'node:module';

register( './test_ts_loader.mjs', import.meta.url );
