/*
===============================================================================

	retail-metadata-stage.ts

	Single-purpose retail conversion stage. All writes use the injected job context.

===============================================================================
*/

import type { RetailContext } from './retail-context.js';
import { decompressDvars, DEFAULT_STANCE, DEFAULT_SURFACES, decodeWeightsPng } from './retail-constants.js';

/*
====================
extractConfigs
====================
*/
export async function extractConfigs( ctx: RetailContext): Promise<void> {
		const dvarsBytes = await decompressDvars();

		await ctx.saveFile( 'assets/ui/dvars.json', dvarsBytes );
		await ctx.saveJson( 'assets/ui/stance.json', DEFAULT_STANCE );
		await ctx.saveJson( 'assets/ui/surfaces.json', DEFAULT_SURFACES );
	}

/*
====================
extractMantle
====================
*/
export async function extractMantle( ctx: RetailContext): Promise<void> {
		const { decodeXAnim } = await import( './retail-xanim.js' );
		const mantleAnimations: Record<string, any> = {};

		for ( const filename of ctx.archives.allFilenames() ) {
			if (
				( filename.startsWith( 'xanim/mp_mantle_' ) && !filename.endsWith( 'over_low' ) )
				|| filename === 'xanim/player_mantle_over_low'
			) {
				const raw = await ctx.archives.read( filename );
				const anim = decodeXAnim( raw );
				const key = filename.split( 'mantle_' ).pop()!;
				const duration = Math.floor( ( ( anim.frames - 1 ) * 1000 ) / anim.rate );
				const points = anim.delta?.translations || [];

				mantleAnimations[key] = {
					duration,
					frames: anim.frames,
					times: anim.delta?.translation_times || [],
					points,
				};
			}
		}

		await ctx.saveJson( 'assets/gameplay/mantle.json', mantleAnimations );
	}

/*
====================
extractLightmapWeights
====================
*/
export async function extractLightmapWeights( ctx: RetailContext): Promise<void> {
		const pngBytes = decodeWeightsPng();
		await ctx.saveFile( 'assets/images/lightmap_weights.png', pngBytes );
	}

