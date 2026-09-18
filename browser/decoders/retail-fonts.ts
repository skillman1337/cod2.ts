/*
===============================================================================

	retail-fonts.ts

	Call of Duty 2 / id Tech Font Decoder
	Decodes smallFont, normalFont, bigFont, extraBigFont, and consoleFont tables.
	Extracts glyph bounding dimensions, kerning metrics, and texture coordinate UVs.

===============================================================================
*/


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const FONT_HEADER_SIZE      = 16;
export const FONT_GLYPH_ENTRY_SIZE = 24;
export const FONT_MAX_GLYPH_CODE   = 255;

export const FONT_SIZE_OFFSET      = 4;
export const FONT_COUNT_OFFSET     = 8;

export const GLYPH_LEFT_OFFSET     = 2;
export const GLYPH_TOP_OFFSET      = 3;
export const GLYPH_ADVANCE_OFFSET  = 4;
export const GLYPH_WIDTH_OFFSET    = 5;
export const GLYPH_HEIGHT_OFFSET   = 6;
export const GLYPH_U0_OFFSET       = 8;
export const GLYPH_T0_OFFSET       = 12;
export const GLYPH_U1_OFFSET       = 16;
export const GLYPH_T1_OFFSET       = 20;


// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface FontGlyph {
	ml: number;
	mt: number;
	mr: number;
	pw: number;
	ph: number;
	u0: number;
	t0: number;
	u1: number;
	t1: number;
}

export interface DecodedFont {
	font_size: number;
	glyphs: Record<string, FontGlyph>;
}


// ---------------------------------------------------------------------------
// font parsing
// ---------------------------------------------------------------------------

/*
====================
parseFont

Decodes binary font tables into structured glyph metrics and texture coordinates:
- Reads font point size and total glyph count from binary header.
- Extracts per-glyph margins, dimensions, and normalized UV bounds.
====================
*/
export function parseFont( data: Uint8Array ): DecodedFont {
	const view = new DataView( data.buffer, data.byteOffset, data.byteLength );
	const size = view.getUint32( FONT_SIZE_OFFSET, true );
	const count = view.getUint32( FONT_COUNT_OFFSET, true );
	const glyphs: Record<string, FontGlyph> = {};

	for ( let index = 0; index < count; index++ ) {
		const offset = FONT_HEADER_SIZE + index * FONT_GLYPH_ENTRY_SIZE;
		const code = view.getUint16( offset, true );

		if ( code <= 0 || code > FONT_MAX_GLYPH_CODE ) {
			continue;
		}

		const left = view.getInt8( offset + GLYPH_LEFT_OFFSET );
		const top = view.getInt8( offset + GLYPH_TOP_OFFSET );
		const advance = view.getUint8( offset + GLYPH_ADVANCE_OFFSET );
		const width = view.getUint8( offset + GLYPH_WIDTH_OFFSET );
		const height = view.getUint8( offset + GLYPH_HEIGHT_OFFSET );

		const u0 = view.getFloat32( offset + GLYPH_U0_OFFSET, true );
		const t0 = view.getFloat32( offset + GLYPH_T0_OFFSET, true );
		const u1 = view.getFloat32( offset + GLYPH_U1_OFFSET, true );
		const t1 = view.getFloat32( offset + GLYPH_T1_OFFSET, true );

		glyphs[String.fromCharCode( code )] = {
			ml: left,
			mt: top,
			mr: advance,
			pw: width,
			ph: height,
			u0,
			t0,
			u1,
			t1,
		};
	}

	return { font_size: size, glyphs };
}
