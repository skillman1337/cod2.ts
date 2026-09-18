/*
===============================================================================

	ui_text.ts

	Call of Duty 2 / id Tech UI Text Layout & Typography
	Font glyph table resolution, advance measurement, text line wrapping,
	and line height calculation based on retail routines at 0x53ee70 and 0x53f3a0.

===============================================================================
*/

import smallFont from '@/assets/fonts/smallFont.json';
import normalFont from '@/assets/fonts/normalFont.json';
import bigFont from '@/assets/fonts/bigFont.json';
import extraBigFont from '@/assets/fonts/extraBigFont.json';
import consoleFont from '@/assets/fonts/consoleFont.json';


// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const UI_FONT_DEFAULT         = 1;
export const UI_FONT_BIG             = 2;
export const UI_FONT_SMALL           = 3;
export const UI_FONT_CONSOLE         = 5;
export const UI_FONT_BASELINE_HEIGHT = 480;


// ---------------------------------------------------------------------------
// font selection & measurement
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * UI_TextFont
 *
 * Selects active font metrics asset table based on font enum index and target scale:
 * 1 = normal, 2 = big, 3 = small, 5 = console.
 * Scales text proportionally against native 480p virtual baseline.
 * ================
 */
export function UI_TextFont( scale: number, height: number, font: number = UI_FONT_DEFAULT ): typeof normalFont {
	if ( font === UI_FONT_CONSOLE ) {
		return consoleFont;
	}

	if ( font === UI_FONT_BIG ) {
		return bigFont;
	}

	if ( font === UI_FONT_SMALL ) {
		return smallFont;
	}

	const physical = Math.fround(
		Math.fround( scale ) * Math.fround( height * Math.fround( 1 / UI_FONT_BASELINE_HEIGHT ) )
	);

	if ( physical <= Math.fround( 0.25 ) ) {
		return smallFont;
	}

	if ( physical >= Math.fround( 0.55 ) ) {
		return extraBigFont;
	}

	if ( physical >= Math.fround( 0.4 ) ) {
		return bigFont;
	}

	return normalFont;
}

/**
 * @exec helper
 * ================
 * UI_TextWidth
 *
 * Computes rendered text width in virtual pixels, stripping color escape sequences (^0-^9).
 * Reconstructed from native string width calculation at 0x53ee70.
 * ================
 */
export function UI_TextWidth(
	text: string,
	scale: number,
	height: number = 480,
	font: number = 1
): number {
	const data = UI_TextFont( scale, height, font );
	const glyphs: Record<string, { mr: number }> = data.glyphs;
	let width = 0;

	for ( const ch of text.replace( /\^[0-9]/g, '' ) ) {
		width += glyphs[ch]?.mr ?? 0;
	}

	return Math.trunc( ( width * scale * 48 ) / data.font_size );
}


// ---------------------------------------------------------------------------
// text formatting & line wrapping
// ---------------------------------------------------------------------------

/**
 * @exec helper
 * ================
 * UI_TextLines
 *
 * Implements Item_Text_AutoWrapped_Paint (0x53f3a0):
 * Breaks text paragraphs by balanced whitespace word wrapping to fit target box width.
 * ================
 */
export function UI_TextLines(
	text: string,
	scale: number,
	width: number,
	height: number = 480,
	font: number = 1,
	automatic: boolean = true
): string[] {
	const result: string[] = [];

	for ( const paragraph of text.replace( /\r/g, ' ' ).split( '\n' ) ) {
		if ( !automatic || width <= 0 ) {
			result.push( paragraph );
			continue;
		}

		const total = UI_TextWidth( paragraph, scale, height, font );
		const target = total > width ? total / Math.ceil( total / width ) : width;
		let line = '';

		for ( const word of paragraph.split( / +/ ) ) {
			const next = line ? line + ' ' + word : word;

			if (
				line &&
				( UI_TextWidth( next, scale, height, font ) > width ||
				  UI_TextWidth( line, scale, height, font ) > target )
			) {
				result.push( line );
				line = word;
			} else {
				line = next;
			}
		}

		result.push( line );
	}

	return result;
}

/**
 * @exec helper
 * ================
 * UI_TextLineHeight
 *
 * Returns native scaled line pitch in pixels: scale * 48, plus 1 below 16px, or 4 otherwise.
 * ================
 */
export function UI_TextLineHeight( scale: number ): number {
	const h = Math.trunc( scale * 48 );
	return h + ( h < 16 ? 1 : 4 );
}
