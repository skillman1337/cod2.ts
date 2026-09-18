/*
===============================================================================

	retail-pipeline.ts

	Menu-first bootstrap. Gameplay conversion is owned by the demand compiler.

===============================================================================
*/

import { RetailContext } from './retail-context.js';
import { extractFonts, extractMenusAndHud, extractUiMaterials } from './retail-menu-stage.js';
import { extractConfigs } from './retail-metadata-stage.js';
import type { ArchiveCollection } from './retail-zip.js';
import type { WriteFileCallback, ProgressCallback, LogCallback, TaskCallback, FileRecord } from './retail-contracts.js';

export type { FileRecord } from './retail-contracts.js';

/*
====================
RetailPipeline

Only menu definitions, fonts and visible frontend images gate the first frame.
====================
*/
export class RetailPipeline {
	readonly context: RetailContext;
	constructor( archives: ArchiveCollection, write: WriteFileCallback,
		progress: ProgressCallback = () => {}, log: LogCallback = () => {}, task: TaskCallback = () => {} ) {
		this.context = new RetailContext( archives, write, progress, log, task );
	}

	/*
	====================
	run
	====================
	*/
	async run(): Promise<FileRecord[]> {
		const ctx = this.context;
		ctx.progress( '1/4: Reading retail font tables…' );
		await extractFonts( ctx );
		ctx.progress( '2/4: Reading menus and asset definitions…' );
		const { materials } = await extractMenusAndHud( ctx );
		ctx.progress( '3/4: Preparing the main menu…' );
		await extractUiMaterials( ctx, materials );
		ctx.progress( '4/4: Saving local configuration…' );
		await extractConfigs( ctx );
		// Imported engine modules hold a stable table; map entry hydrates it later.
		await ctx.saveJson( 'assets/ui/mantle.json', {} );
		ctx.progress( 'Menu ready. Gameplay assets will be cached when requested.' );
		return ctx.finish();
	}
}
