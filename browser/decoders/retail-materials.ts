/*
===============================================================================

	retail-materials.ts

	Call of Duty 2 / id Tech Material Parser
	Decodes binary material definitions, sampler states, shader constants,
	and hardware rasterizer blend, depth test, and culling flags.

===============================================================================
*/

import { readCString, readVec4 } from './retail-constants.js';


// ---------------------------------------------------------------------------
// constants & table strides
// ---------------------------------------------------------------------------

export const MATERIAL_TEXTURE_ENTRY_SIZE  = 12;
export const MATERIAL_CONSTANT_ENTRY_SIZE = 20;

export const MATERIAL_COLOR_OFFSET          = 44;
export const MATERIAL_DEPTH_OFFSET          = 48;
export const MATERIAL_TEXTURES_OFFSET       = 52;
export const MATERIAL_CONSTANTS_OFFSET      = 54;
export const MATERIAL_TECHNIQUE_PTR_OFFSET  = 56;
export const MATERIAL_TEXTURE_TABLE_OFFSET  = 60;
export const MATERIAL_CONSTANT_TABLE_OFFSET = 64;
export const MATERIAL_SORT_OFFSET           = 13;

export const MATERIAL_BLEND_MASK            = 0x0f;
export const MATERIAL_BLEND_DST_SHIFT       = 4;
export const MATERIAL_DEPTH_OFFSET_SHIFT    = 4;
export const MATERIAL_DEPTH_OFFSET_MASK     = 0x03;
export const MATERIAL_DEPTH_WRITE_MASK      = 0x01;
export const MATERIAL_DEPTH_COMPARE_MASK    = 0x02;
export const MATERIAL_ALPHA_TEST_DISABLE    = 0x800;
export const MATERIAL_ALPHA_FUNC_SHIFT      = 12;
export const MATERIAL_ALPHA_FUNC_MASK       = 0x03;
export const MATERIAL_CULL_SHIFT            = 14;
export const MATERIAL_CULL_MASK             = 0x03;
export const MATERIAL_CULL_MODES            = ['none', 'none', 'back', 'front'];


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface MaterialBinding {
	image: string;
	sampler: number;
}

export interface MaterialState {
	src: number;
	dst: number;
	offset: number;
	write: boolean;
	sort: number;
	alpha: number;
	compare: string;
	cull: string;
	lit: boolean;
	fog: boolean;
	multiply: boolean;
}

export interface MaterialDefinition {
	bindings: Record<string, MaterialBinding>;
	constants: Record<string, number[]>;
	technique: string;
	state: MaterialState;
}


// ---------------------------------------------------------------------------
// material definition parsing
// ---------------------------------------------------------------------------

/*
====================
parseMaterialDefinition

Decodes binary material definition records into structured textures and GPU pipeline states:
- Extracts null-terminated semantic, image, and constant parameter strings.
- Parses sampler indices and 4-component float uniform vectors.
- Decodes blend modes, depth comparison flags, face culling, and lighting passes.
====================
*/
export function parseMaterialDefinition( data: Uint8Array ): MaterialDefinition {
	const decoder = new TextDecoder( 'ascii' );
	const readString = ( offset: number ): string => readCString( data, offset, decoder ).text;

	const view = new DataView( data.buffer, data.byteOffset, data.byteLength );
	const color = view.getUint32( MATERIAL_COLOR_OFFSET, true );
	const depth = view.getUint32( MATERIAL_DEPTH_OFFSET, true );

	const textures = view.getUint16( MATERIAL_TEXTURES_OFFSET, true );
	const constants = view.getUint16( MATERIAL_CONSTANTS_OFFSET, true );
	const techniqueOffset = view.getUint32( MATERIAL_TECHNIQUE_PTR_OFFSET, true );
	const textureTable = view.getUint32( MATERIAL_TEXTURE_TABLE_OFFSET, true );
	const constantTable = view.getUint32( MATERIAL_CONSTANT_TABLE_OFFSET, true );

	const bindings: Record<string, MaterialBinding> = {};

	for ( let i = 0; i < textures; i++ ) {
		const entryOffset = textureTable + i * MATERIAL_TEXTURE_ENTRY_SIZE;
		const sem = view.getUint32( entryOffset, true );
		const sampler = view.getUint32( entryOffset + 4, true );
		const img = view.getUint32( entryOffset + 8, true );

		bindings[readString( sem )] = {
			image: readString( img ),
			sampler,
		};
	}

	const values: Record<string, number[]> = {};

	for ( let i = 0; i < constants; i++ ) {
		const entryOffset = constantTable + i * MATERIAL_CONSTANT_ENTRY_SIZE;
		const nameOffset = view.getUint32( entryOffset, true );
		values[readString( nameOffset )] = readVec4( view, entryOffset + 4 );
	}

	const technique = readString( techniqueOffset );

	const state: MaterialState = {
		src: color & MATERIAL_BLEND_MASK,
		dst: ( color >> MATERIAL_BLEND_DST_SHIFT ) & MATERIAL_BLEND_MASK,
		offset: ( depth >> MATERIAL_DEPTH_OFFSET_SHIFT ) & MATERIAL_DEPTH_OFFSET_MASK,
		write: Boolean( depth & MATERIAL_DEPTH_WRITE_MASK ),
		sort: data[MATERIAL_SORT_OFFSET],
		alpha: ( color & MATERIAL_ALPHA_TEST_DISABLE ) ? -1 : ( color >> MATERIAL_ALPHA_FUNC_SHIFT ) & MATERIAL_ALPHA_FUNC_MASK,
		compare: ( depth & MATERIAL_DEPTH_COMPARE_MASK ) || ( ( depth & 12 ) !== 4 && ( depth & 12 ) !== 8 )
			? 'always'
			: ( ( depth & 12 ) === 4 ? 'less-equal' : 'equal' ),
		cull: MATERIAL_CULL_MODES[( color >> MATERIAL_CULL_SHIFT ) & MATERIAL_CULL_MASK],
		lit: technique.startsWith( 'phong_' ) || technique.startsWith( 'ambient_' ) || technique.startsWith( 'water' ),
		fog: !technique.endsWith( '_nofog' ),
		multiply: technique.startsWith( 'effect_multiply' ),
	};

	return {
		bindings,
		constants: values,
		technique,
		state,
	};
}
