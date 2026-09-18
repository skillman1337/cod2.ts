/*
===============================================================================

	retail-menu-stage.ts

	Single-purpose retail conversion stage. All writes use the injected job context.

===============================================================================
*/

import { menuImageKey } from './retail-names.js';
import type { RetailContext } from './retail-context.js';
import { parseFont } from './retail-fonts.js';
import { MenuPreprocessor } from './retail-preprocessor.js';
import { MenuParser, compileMenu, stripQuotes, tokenize } from './retail-menus.js';
import { readIwiMip0 } from './retail-iwi.js';
import { encodePNG } from './retail-png.js';
import { parseMaterialDefinition } from './retail-materials.js';
import { FALLBACK_MENUS } from './retail-constants.js';
import { BASE_UI_MATERIALS, BASE_UI_AUDIO_CUES, POPUP_BACKGROUND_IMAGES, STANDARD_UI_WIDGET_MATERIALS } from './retail-stage-constants.js';

/*
====================
parseMenuDefs
====================
*/
export function parseMenuDefs( ctx: RetailContext,  expanded: string, referencedMaterials: Set<string> ): any[] {
		const result: any[] = [];
		const parser = new MenuParser( expanded );

		while ( parser.index < parser.tokens.length ) {
			const t = parser.take().toLowerCase();

			if ( t === 'menudef' ) {
				const compiled = compileMenu( parser.props() );
				result.push( compiled );

				if ( compiled.background ) {
					referencedMaterials.add( compiled.background );
				}

				for ( const item of compiled.items || [] ) {
					if ( item.background ) {
						referencedMaterials.add( item.background );
					}
				}
			} else if ( t === 'assetglobaldef' ) {
				parser.blockTokens();
			}
		}

		return result;
	}

/*
====================
extractFonts
====================
*/
export async function extractFonts( ctx: RetailContext): Promise<void> {
		for ( const name of ['smallFont', 'normalFont', 'bigFont', 'extraBigFont', 'consoleFont'] ) {
			const entryPath = `fonts/${name}`;

			if ( ctx.archives.has( entryPath ) ) {
				const raw = await ctx.archives.read( entryPath );
				const font = parseFont( raw );
				await ctx.saveJson( `assets/fonts/${name}.json`, font );
			}
		}

		ctx.log( 'Extracted five retail font tables.' );
	}

/*
====================
extractMenusAndHud
====================
*/
export async function extractMenusAndHud( ctx: RetailContext): Promise<{
		weapons: Record<string, Record<string, string>>;
		materials: Set<string>;
	}> {
		const referencedMaterials = new Set<string>();

		// Load localized strings
		const strings: Record<string, string> = {};

		for ( const filename of ctx.archives.allFilenames() ) {
			if ( filename.startsWith( 'localizedstrings/' ) && filename.endsWith( '.str' ) ) {
				const stem = filename.slice( 'localizedstrings/'.length, -4 ).toUpperCase();
				const text = await ctx.archives.readText( filename, 'windows-1252' );
				let ref = '';

				for ( const line of text.split( /\r?\n/ ) ) {
					const refMatch = line.match( /^\s*REFERENCE\s+(.+?)\s*$/ );

					if ( refMatch ) {
						ref = refMatch[1];
					}

					const langMatch = line.match( /^\s*LANG_ENGLISH\s+"(.*)"/ );

					if ( langMatch ) {
						strings[`${stem}_${ref}`] = langMatch[1].replace( /\\n/g, '\n' );
					}
				}
			}
		}

		await ctx.saveJson( 'assets/ui/strings.json', strings );

		// Load default_mp.cfg
		const defaults: Record<string, string> = {};

		if ( ctx.archives.has( 'default_mp.cfg' ) ) {
			const cfg = await ctx.archives.readText( 'default_mp.cfg' );

			for ( const line of cfg.split( /\r?\n/ ) ) {
				const bindMatch = line.match( /^bind\s+(\S+)\s+"([^"]+)"/ );

				if ( bindMatch ) {
					const action = bindMatch[2];
					defaults[action] = defaults[action] ? `${defaults[action]} or ${bindMatch[1].toUpperCase()}` : bindMatch[1].toUpperCase();
				}

				const setMatch = line.match( /^set\s+(\S+)\s+("[^"]*"|\S+)/ );

				if ( setMatch ) {
					defaults[setMatch[1]] = stripQuotes( setMatch[2] );
				}
			}
		}

		await ctx.saveJson( 'assets/ui/defaults.json', defaults );

		// Load map arena providers
		const maps: Record<string, string>[] = [];

		for ( const filename of ctx.archives.allFilenames() ) {
			if ( filename.startsWith( 'mp/' ) && filename.endsWith( '.arena' ) ) {
				const text = await ctx.archives.readText( filename );
				const blockRegex = /\{([^}]+)\}/g;
				let match: RegExpExecArray | null;

				while ( ( match = blockRegex.exec( text ) ) !== null ) {
					const tokens = tokenize( match[1] );
					const entry: Record<string, string> = {};

					for ( let i = 0; i < tokens.length; i += 2 ) {
						if ( i + 1 < tokens.length ) {
							entry[stripQuotes( tokens[i] )] = stripQuotes( tokens[i + 1] );
						}
					}

					if ( entry.map ) {
						maps.push( entry );
					}
				}
			}
		}
		for ( const filename of ctx.archives.allFilenames() ) {
			const match = /^maps\/mp\/([^/]+)\.d3dbsp$/i.exec( filename );
			if ( match && !maps.some( ( map ) => map.map.toLowerCase() === match[1].toLowerCase() ) ) {
				maps.push( { map: match[1].toLowerCase(), longname: match[1], gametype: '' } );
			}
		}

		maps.sort( ( a, b ) => ( a.longname || a.map ).localeCompare( b.longname || b.map ) );

		const gametypes: { value: string; label: string }[] = [];

		for ( const filename of ctx.archives.allFilenames() ) {
			if ( filename.startsWith( 'maps/mp/gametypes/' ) && filename.endsWith( '.txt' ) ) {
				const stem = filename.slice( 'maps/mp/gametypes/'.length, -4 );
				const text = await ctx.archives.readText( filename );
				const tokens = tokenize( text );

				if ( tokens.length > 0 && tokens[0] ) {
					gametypes.push( { value: stem, label: stripQuotes( tokens[0] ) } );
				}
			}
		}

		await ctx.saveJson( 'assets/ui/providers.json', { maps, gametypes } );

		// Load configs
		const configs: Record<string, string> = {};

		for ( const filename of ctx.archives.allFilenames() ) {
			if ( filename.endsWith( '.cfg' ) ) {
				configs[filename] = await ctx.archives.readText( filename );
			}
		}

		await ctx.saveJson( 'assets/ui/configs.json', configs );

		// Preprocessor setup
		const preprocessor = new MenuPreprocessor( async ( path: string ) => {
			const lower = path.toLowerCase();

			if ( ctx.archives.has( lower ) ) {
				return ctx.archives.readText( lower );
			}
			return FALLBACK_MENUS[lower] || null;
		} );

		// Menus
		const menuPool: any[] = [];
		let menuList: string[] = [];

		if ( ctx.archives.has( 'ui_mp/menus.txt' ) ) {
			const menusTxt = await ctx.archives.readText( 'ui_mp/menus.txt' );
			const matches = menusTxt.matchAll( /loadMenu\s*\{\s*"([^"]+)"/g );

			for ( const m of matches ) {
				menuList.push( m[1] );
			}
		}

		menuList.push( 'ui_mp/connect.menu' );

		for ( const f of ctx.archives.allFilenames() ) {
			if ( f.startsWith( 'ui_mp/scriptmenus/' ) && f.endsWith( '.menu' ) ) {
				menuList.push( f );
			}
		}

		menuList = Array.from( new Set( menuList ) );

		for ( const menuPath of menuList ) {
			try {
				const expanded = await preprocessor.preprocess( menuPath );

				if ( expanded ) {
					menuPool.push( ...parseMenuDefs( ctx, expanded, referencedMaterials ) );
				}
			} catch ( err ) {
				ctx.log( `Menu parse failed: ${menuPath}: ${String( err )}` );
			}
		}

		await ctx.saveJson( 'assets/ui/menus.json', menuPool );

		// Weapons
		const weapons: Record<string, Record<string, string>> = {};

		for ( const filename of ctx.archives.allFilenames() ) {
			if ( filename.startsWith( 'weapons/mp/' ) && !filename.endsWith( '/' ) ) {
				const text = await ctx.archives.readText( filename, 'ascii' );
				const tokens = text.split( '\\' );

				if ( tokens[0] === 'WEAPONFILE' ) {
					const weaponName = filename.slice( 'weapons/mp/'.length );
					const wObj: Record<string, string> = {};

					for ( let i = 1; i < tokens.length; i += 2 ) {
						if ( i + 1 < tokens.length ) {
							wObj[tokens[i]] = tokens[i + 1];
						}
					}

					weapons[weaponName] = wObj;

					if ( wObj.hudIcon ) {
						referencedMaterials.add( wObj.hudIcon );
					}
				}
			}
		}

		await ctx.saveJson( 'assets/ui/weapons.json', weapons );

		// HUD Menus
		const hudMenus: any[] = [];

		if ( ctx.archives.has( 'ui_mp/hud.menu' ) ) {
			const hudExpanded = await preprocessor.preprocess( 'ui_mp/hud.menu' );

			if ( hudExpanded ) {
				hudMenus.push( ...parseMenuDefs( ctx, hudExpanded, referencedMaterials ) );
			}
		}

		await ctx.saveJson( 'assets/ui/hud.json', hudMenus );
		ctx.log( `Compiled ${menuPool.length} menus, ${hudMenus.length} HUD menus, and ${Object.keys( weapons ).length} weapon definitions.` );

		// Standard UI widgets and HUD materials
		for ( const name of STANDARD_UI_WIDGET_MATERIALS ) {
			referencedMaterials.add( name );
		}

		// All map loadscreens from providers.json
		for ( const { map } of maps ) {
			referencedMaterials.add( `loadscreen_${map}` );
		}

		return { weapons, materials: referencedMaterials };
	}

/*
====================
extractUiMaterials
====================
*/
export async function extractUiMaterials( ctx: RetailContext,  referenced: Set<string> ): Promise<void> {
		const materialsCatalog: Record<string, { image: string }> = {};
		const images: Record<string, string> = {};

		// Base menu materials
		for ( const name of BASE_UI_MATERIALS ) {
			const imgPath = `images/${name}.iwi`;

			if ( ctx.archives.has( imgPath ) ) {
				const png = await ctx.texturePng( imgPath );
				await ctx.saveMenuTexture( name, png );

				if ( name === 'gamefonts' ) {
					const { texData } = readIwiMip0( await ctx.archives.read( imgPath ) );
					await ctx.saveFile( 'assets/images/gamefonts.bc3', texData );
				}
			}
		}

		// Audio cues
		for ( const name of BASE_UI_AUDIO_CUES ) {
			if ( ctx.archives.has( name ) ) {
				const raw = await ctx.archives.read( name );
				await ctx.saveFile( `assets/${name}`, raw );
			}
		}

		// Material definitions and images
		for ( const mat of referenced ) {
			const cleanMat = mat.toLowerCase();
			const matKey = ctx.archives.has( `materials/${cleanMat}` )
				? cleanMat
				: cleanMat.replace( /\.tga$/i, '' );
			const matPath = `materials/${matKey}`;

			if ( ctx.archives.has( matPath ) ) {
				try {
					const raw = await ctx.archives.read( matPath );
					const def = parseMaterialDefinition( raw );
					const colorMap = def.bindings.colorMap?.image;

					if ( colorMap && ctx.archives.has( `images/${colorMap}.iwi` ) ) {
						// Escape rather than replace: '#' and '_' are distinct asset identities.
						const clean = menuImageKey( colorMap );
						images[`menu_${clean}.png`] = `images/${colorMap}.iwi`;
						images[`${clean}.png`] = `images/${colorMap}.iwi`;
						materialsCatalog[mat] = { image: `menu_${clean}.png` };
						if ( matKey !== mat ) {
							materialsCatalog[matKey] = { image: `menu_${clean}.png` };
						}
						if ( !materialsCatalog[colorMap] ) {
							materialsCatalog[colorMap] = { image: `menu_${clean}.png` };
						}

						try {
							const png = await ctx.texturePng( `images/${colorMap}.iwi` );
							await ctx.saveMenuTexture( clean, png );
						} catch {
							// On decode failure, fallback to on-demand compilation
						}
					}
				} catch {
					ctx.log( `Material metadata failed: ${mat}` );
				}
			}
		}

		// Popup backgrounds (popups_alpha, popups_goldline)
		for ( const imgName of POPUP_BACKGROUND_IMAGES ) {
			const imgPath = `images/${imgName}.iwi`;

			if ( ctx.archives.has( imgPath ) ) {
				try {
					const png = await ctx.texturePng( imgPath );
					await ctx.saveMenuTexture( imgName, png );
				} catch {
					// Ignore corrupted image
				}
			}
		}

		// Fallback fadebox and white
		const white1x1 = new Uint8Array( [255, 255, 255, 255] );
		const fadeboxPng = await encodePNG( 1, 1, white1x1 );

		for ( const name of ['fadebox', '$white', 'white'] ) {
			await ctx.saveMenuTexture( name, fadeboxPng );
		}

		materialsCatalog.fadebox = { image: 'menu_fadebox.png' };
		materialsCatalog['ui/assets/fadebox.tga'] = { image: 'menu_fadebox.png' };
		materialsCatalog['$white'] = { image: 'menu_$white.png' };
		materialsCatalog.white = { image: 'menu_$white.png' };

		if ( !materialsCatalog.popmenu_bg ) {
			materialsCatalog.popmenu_bg = { image: 'menu_popups_alpha.png' };
		}
		if ( !materialsCatalog.popmenu_goldline ) {
			materialsCatalog.popmenu_goldline = { image: 'menu_popups_goldline.png' };
		}

		await ctx.saveJson( 'assets/ui/materials.json', materialsCatalog );
		await ctx.saveJson( 'assets/ui/image-sources.json', images );
	}

