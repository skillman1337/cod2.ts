/*
===============================================================================

	local-assets.d.ts

	Call of Duty 2 / id Tech Virtual Asset Type Declarations
	Schemas and module definitions for extracted JSON definition tables and assets.
	No proprietary asset values or game data are embedded in source code.

===============================================================================
*/


// ---------------------------------------------------------------------------
// asset schema types
// ---------------------------------------------------------------------------

declare namespace Cod2LocalAssets {
	interface Glyph {
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

	interface Font {
		font_size: number;
		glyphs: Record<string, Glyph>;
	}

	interface Dvar {
		name: string;
		kind: string;
		default?: string;
		choices?: string[];
		min?: number;
		max?: number;
		flags?: number;
	}

	interface Providers {
		maps: {
			map: string;
			longname: string;
			gametype: string;
			[key: string]: string;
		}[];
		gametypes: {
			value: string;
			label: string;
		}[];
	}

	interface Material {
		image: string;
		width: number;
		height: number;
		material_sha256?: string;
		image_sha256?: string;
	}

	interface Mantle {
		duration: number;
		frames: number;
		times: number[];
		points: number[][];
		sha256?: string;
	}
}


// ---------------------------------------------------------------------------
// virtual asset module bindings
// ---------------------------------------------------------------------------

declare module '@/assets/ui/strings.json' {
	const value: Record<string, string>;
	export default value;
}

declare module '@/assets/ui/configs.json' {
	const value: Record<string, string>;
	export default value;
}

declare module '@/assets/ui/defaults.json' {
	const value: Record<string, string>;
	export default value;
}

declare module '@/assets/ui/weapons.json' {
	const value: Record<string, Record<string, string>>;
	export default value;
}

declare module '@/assets/ui/providers.json' {
	const value: Cod2LocalAssets.Providers;
	export default value;
}

declare module '@/assets/ui/materials.json' {
	const value: Record<string, Cod2LocalAssets.Material>;
	export default value;
}

declare module '@/assets/ui/stance.json' {
	const value: Record<string, [number, number, number][]>;
	export default value;
}

declare module '@/assets/ui/mantle.json' {
	const value: Record<string, Cod2LocalAssets.Mantle>;
	export default value;
}

declare module '@/assets/ui/surfaces.json' {
	const value: string[];
	export default value;
}

declare module '@/assets/ui/dvars.json' {
	const value: {
		dvars: Cod2LocalAssets.Dvar[];
		scope: string;
		executable_sha256?: string;
	};
	export default value;
}

declare module '@/assets/ui/menus.json' {
	const value: unknown[];
	export default value;
}

declare module '@/assets/ui/hud.json' {
	const value: {
		rect_x: number;
		rect_y: number;
		horz_align: number;
		vert_align: number;
		items: import( '@/engine/com/client/cl_main/scr_menu/mp_main_menu/internal/menu_def.js' ).ui_menu_item_def_t[];
	}[];
	export default value;
}

declare module '@/assets/fonts/smallFont.json' {
	const value: Cod2LocalAssets.Font;
	export default value;
}

declare module '@/assets/fonts/normalFont.json' {
	const value: Cod2LocalAssets.Font;
	export default value;
}

declare module '@/assets/fonts/bigFont.json' {
	const value: Cod2LocalAssets.Font;
	export default value;
}

declare module '@/assets/fonts/extraBigFont.json' {
	const value: Cod2LocalAssets.Font;
	export default value;
}

declare module '@/assets/fonts/consoleFont.json' {
	const value: Cod2LocalAssets.Font;
	export default value;
}
