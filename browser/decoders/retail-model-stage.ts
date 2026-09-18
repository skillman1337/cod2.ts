/*
===============================================================================

	retail-model-stage.ts

	Demand-driven retail asset compilation. No retail content is bundled here.

===============================================================================
*/


import type { RetailContext } from './retail-context.js';
import { CHARACTER_ANIMATION_MAPPINGS } from './retail-stage-constants.js';
import { assetName, imageURL } from './retail-names.js';
import { stripScriptComments } from './retail-map-metadata.js';

type Weapons = Record<string, Record<string, string>>;

/*
====================
extractViewmodels

Catalogs are metadata. Each referenced model, animation and material has its own
request-time compiler; non-bullet weapon definitions are not discarded.
====================
*/
export async function extractViewmodels( ctx: RetailContext, weapons: Weapons ): Promise<void> {
	const catalog: Record<string, unknown> = Object.create( null );
	for ( const [name, weapon] of Object.entries( weapons ) ) {
		if ( !weapon.gunModel ) continue;
		catalog[name] = {
			gun: assetName( weapon.gunModel, 'xmodel' ),
			hands: weapon.handModel ? assetName( weapon.handModel, 'xmodel' ) : null,
		};
	}
	await ctx.saveJson( 'viewmodels/catalog.json', { weapons: catalog, materials: {} } );
}

/*
====================
extractPlayermodels

Discover body/head/attachment configurations from mounted GSC scripts:
1. Parse xmodelalias/*.gsc arrays (body/head/helmet candidate pools).
2. Parse character/*.gsc scripts (direct setModel or setModelFromArray / attachFromArray).
3. Parse mptype/*.gsc scripts (links MP soldier types to character variant routines).
4. Resolve factions using native CoD2 multiplayer rules (_teams.gsc).
5. Extract material definitions and texture bindings for discovered character models.
====================
*/
export async function extractPlayermodels( ctx: RetailContext, weapons: Weapons ): Promise<void> {
	const allFiles = ctx.archives.allFilenames();

	// 1. Parse xmodelalias/*.gsc arrays
	const aliases: Record<string, string[]> = Object.create( null );
	const aliasFiles = allFiles.filter( name => /^xmodelalias\/.+\.gsc$/i.test( name ) );

	for ( const path of aliasFiles ) {
		const text = stripScriptComments( await ctx.archives.readText( path, 'windows-1252' ) );
		const models = [...text.matchAll( /"([^"]+)"/g )]
			.map( m => assetName( m[1], 'xmodel' ) )
			.filter( name => !name.endsWith( '.gsc' ) );

		const aliasKey = path.replace( /^xmodelalias\//i, '' ).replace( /\.gsc$/i, '' ).toLowerCase();
		if ( models.length > 0 ) {
			aliases[aliasKey] = models;
		}
	}

	// 2. Parse character/*.gsc scripts
	const characters: Record<string, any> = Object.create( null );
	const factions: Record<string, string[]> = Object.create( null );
	const charScripts = allFiles.filter( name => /^character\/.+\.gsc$/i.test( name ) ).sort();

	for ( const path of charScripts ) {
		const text = stripScriptComments( await ctx.archives.readText( path, 'windows-1252' ) );

		// Body: direct setModel or setModelFromArray(xmodelalias\...)
		let body: string | null = null;
		const directBody = /\bsetModel\s*\(\s*"([^"]+)"/i.exec( text )?.[1];

		if ( directBody ) {
			body = assetName( directBody, 'xmodel' );
		} else {
			const arrayBody = /setModelFromArray\s*\(\s*xmodelalias\\([a-zA-Z0-9_]+)::main/i.exec( text )?.[1];
			if ( arrayBody ) {
				const aliasList = aliases[arrayBody.toLowerCase()];
				if ( aliasList && aliasList.length > 0 ) {
					body = aliasList[0];
				}
			}
		}

		if ( !body ) {
			ctx.log( `UNRESOLVED ${path}: no setModel or setModelFromArray match; script skipped.` );
			continue;
		}

		// Attachments: direct attach, attachFromArray, or self.hatModel
		const attachments: string[] = [];

		for ( const match of text.matchAll( /\battach\s*\(\s*"([^"]+)"/gi ) ) {
			attachments.push( assetName( match[1], 'xmodel' ) );
		}

		for ( const match of text.matchAll( /attachFromArray\s*\(\s*xmodelalias\\([a-zA-Z0-9_]+)::main/gi ) ) {
			const aliasList = aliases[match[1].toLowerCase()];
			if ( aliasList && aliasList.length > 0 ) {
				attachments.push( aliasList[0] );
			}
		}

		const hatModel = /hatModel\s*=\s*"([^"]+)"/i.exec( text )?.[1];
		if ( hatModel ) {
			const hatName = assetName( hatModel, 'xmodel' );
			if ( !attachments.includes( hatName ) ) {
				attachments.push( hatName );
			}
		}

		const head = attachments.find( name => /(^|\/)head_/.test( name ) ) || null;
		const helmet = attachments.find( name => /(^|\/)helmet_/.test( name ) ) || null;
		const id = path.replace( /^character\//i, '' ).replace( /\.gsc$/i, '' ).toLowerCase();

		characters[id] = {
			body,
			head,
			helmet,
			attachments,
			script: path,
		};

		const faction = /(?:^|_)(american|british|german|russian)(?:_|$)/i.exec( id )?.[1]?.toLowerCase();
		if ( faction ) {
			( factions[faction] ??= [] ).push( id );
		}
	}

	// 3. Parse mptype/*.gsc scripts
	const mptypeScripts = allFiles.filter( name => /^mptype\/.+\.gsc$/i.test( name ) ).sort();

	for ( const path of mptypeScripts ) {
		const text = stripScriptComments( await ctx.archives.readText( path, 'windows-1252' ) );
		const calledChars = [...text.matchAll( /character\\([a-zA-Z0-9_]+)::main/gi )]
			.map( m => m[1].toLowerCase() );

		const mptypeId = path.replace( /^mptype\//i, '' ).replace( /\.gsc$/i, '' ).toLowerCase();

		// Use the first resolved MP character variant
		const primaryCharId = calledChars.find( cid => characters[cid] );
		if ( primaryCharId ) {
			characters[mptypeId] = {
				...characters[primaryCharId],
				script: path,
			};
		}
	}

	// 4. Resolve faction defaults (native CoD2 maps/mp/gametypes/_teams.gsc logic)
	const FACTION_PREFERENCES: Record<string, string[]> = {
		american: ['american_normandy', 'mp_american_normandy_braeburn', 'mp_american_normandy_david'],
		british: ['british_africa', 'british_normandy', 'mp_british_africa_boon', 'mp_british_normandy_boon'],
		german: ['german_normandy', 'german_africa', 'german_winterdark', 'mp_german_normandy', 'mp_german_africa'],
		russian: ['russian_coat', 'russian_padded', 'mp_russian_coat_jesse', 'mp_russian_padded_alex'],
	};

	for ( const [faction, prefs] of Object.entries( FACTION_PREFERENCES ) ) {
		const chosen = prefs.find( key => characters[key] );
		if ( chosen ) {
			characters[faction] = { ...characters[chosen] };
			( factions[faction] ??= [] ).unshift( chosen );
		} else if ( factions[faction]?.length ) {
			const mpFallback = factions[faction].find( id => id.startsWith( 'mp_' ) ) || factions[faction][0];
			characters[faction] = { ...characters[mpFallback] };
		}
	}

	// Fallback for any other discovered factions
	for ( const [faction, ids] of Object.entries( factions ) ) {
		if ( !characters[faction] && ids.length > 0 ) {
			characters[faction] = { ...characters[ids[0]] };
		}
	}

	const worldWeapons: Record<string, unknown> = Object.create( null );
	for ( const [id, weapon] of Object.entries( weapons ) ) {
		if ( weapon.worldModel ) {
			worldWeapons[id] = { model: assetName( weapon.worldModel, 'xmodel' ) };
		}
	}

	const animations = Object.fromEntries(
		Object.entries( CHARACTER_ANIMATION_MAPPINGS ).filter( ( [, name] ) => ctx.archives.has( `xanim/${name}` ) )
	);

	// 5. Extract material definitions and texture bindings for all referenced character models
	const targetModels = new Set<string>();
	for ( const charDef of Object.values( characters ) ) {
		if ( charDef?.body ) targetModels.add( charDef.body );
		if ( charDef?.head ) targetModels.add( charDef.head );
		if ( charDef?.helmet ) targetModels.add( charDef.helmet );
	}

	const materials: Record<string, unknown> = Object.create( null );
	let parseMaterialDefinition: typeof import( './retail-materials.js' )['parseMaterialDefinition'] | undefined;

	for ( const modelName of targetModels ) {
		if ( !ctx.archives.has( `xmodel/${modelName}` ) ) continue;
		try {
			const model = await ctx.decodeModelAsync( modelName );
			for ( const surface of model.surfaces ?? [] ) {
				const mat = surface.material;
				if ( mat && !materials[mat] && ctx.archives.has( `materials/${mat}` ) ) {
					parseMaterialDefinition ??= ( await import( './retail-materials.js' ) ).parseMaterialDefinition;
					const defBytes = await ctx.archives.read( `materials/${mat}` );
					const definition = parseMaterialDefinition( defBytes );
					const colorImg = definition.bindings?.colorMap?.image;
					materials[mat] = {
						definition,
						file: colorImg ? imageURL( 'textures', colorImg ) : null,
					};
				}
			}
		} catch {
			// Model load errors are logged by the model loader
		}
	}

	const defaultFaction = characters.american ? 'american' : Object.keys( factions )[0] ?? null;

	await ctx.saveJson( 'characters/catalog.json', {
		characters,
		factions,
		weapons: worldWeapons,
		animations,
		materials,
		default: defaultFaction,
	} );

	ctx.log( `Discovered ${charScripts.length} character scripts, ${aliasFiles.length} xmodelaliases, ${mptypeScripts.length} mptypes; all models and materials resolved dynamically.` );
}
