/*
===============================================================================

	demand-loading.test.mjs

	General-family dispatch and bootstrap contract regression tests.

===============================================================================
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticBsp, syntheticInstall, syntheticIwd } from './helpers/synthetic.mjs';
import { ArchiveCollection, RetailZipArchive } from '../decoders/retail-zip.ts';
import { RetailPipeline } from '../decoders/retail-pipeline.ts';
import { RetailContext } from '../decoders/retail-context.ts';
import { extractMap } from '../decoders/retail-world-stage.ts';
import { extractViewmodels, extractPlayermodels } from '../decoders/retail-model-stage.ts';
import { parseCSV, forEachSoundAlias } from '../decoders/retail-audio-stage.ts';
import { assetRoute } from '../asset-routing.mjs';
import { menuImageKey, imageURL } from '../decoders/retail-names.ts';
import { decompressDvars } from '../decoders/retail-constants.ts';
import { BspParser } from '../decoders/retail-bsp.ts';

async function mounted( entries ) {
	const archives = new ArchiveCollection();
	await archives.addArchive( syntheticIwd( entries ) );
	return archives;
}

function sink( archives ) {
	const files = new Map(), logs = [];
	return { files, logs, ctx: new RetailContext( archives, async ( path, bytes ) => files.set( path, bytes ), () => {}, text => logs.push( text ) ) };
}

for ( const map of ['mp_fixture_alpha', 'mp_unknown_yet_2026', 'custom-map'] ) {
	test( `route discovers arbitrary map identity: ${map}`, () => {
		const route = assetRoute( `maps/${map}/manifest.json` );
		assert.equal( route.name, map ); assert.equal( route.key, `map/${map}` );
	} );
}

test( 'first- and third-person aliases share a model / animation unit', () => {
	for ( const family of ['models', 'animations'] ) assert.deepEqual( assetRoute( `characters/${family}/new.asset.json` ), assetRoute( `viewmodels/${family}/new.asset.json` ) );
} );

test( 'asset routes reject unsafe and unknown requests', () => {
	for ( const name of ['../x', 'maps/../../x', '/maps/test/x', 'sound/C:/x.wav', 'sound/a\\b.wav', 'constructor'] ) assert.throws( () => assetRoute( name ) );
} );

test( 'image identities remain distinct across punctuation, paths and Unicode', () => {
	const names = ['texture#1', 'texture~231', 'texture_1', 'a/b', 'a_b', 'é', 'e'];
	assert.equal( new Set( names.map( menuImageKey ) ).size, names.length );
	assert.equal( imageURL( 'textures', 'test/a#b' ), '/assets/textures/test/a%23b.png' );
} );

test( 'bootstrap performs no gameplay payload reads and no gameplay writes', async () => {
	const archives = await mounted( syntheticInstall() );
	const read = archives.read.bind( archives ), requests = [], outputs = new Map();
	archives.read = async path => {
		requests.push( path );
		assert.ok( !/^(?:maps\/.*\.d3dbsp|xmodel|xanim|sound\/test\/)/i.test( path ), `eager gameplay read: ${path}` );
		return read( path );
	};
	const pipeline = new RetailPipeline( archives, async ( path, bytes ) => outputs.set( path, bytes ) );
	const records = await pipeline.run();
	assert.ok( records.length > 20 );
	assert.ok( !records.some( file => /^(?:maps|characters|viewmodels|weaponfx|sound)\//.test( file.path ) ) );
	const providers = JSON.parse( new TextDecoder().decode( outputs.get( 'assets/ui/providers.json' ) ) );
	assert.deepEqual( providers.maps.map( m => m.map ), ['mp_fixture_alpha', 'mp_fixture_beta'] );
	assert.ok( requests.includes( 'ui_mp/menus.txt' ) );
} );

for ( const map of ['mp_fixture_alpha', 'mp_fixture_beta'] ) {
	test( `world conversion is selected-map-only: ${map}`, async () => {
		const archives = await mounted( syntheticInstall() );
		const { ctx, files } = sink( archives );
		await extractMap( ctx, map );
		assert.ok( [...files.keys()].every( path => path.startsWith( `maps/${map}/` ) ) );
		const manifest = JSON.parse( new TextDecoder().decode( files.get( `maps/${map}/manifest.json` ) ) );
		assert.equal( manifest.name, map );
		assert.equal( manifest.nationalities.allies, map.endsWith( 'alpha' ) ? 'british' : 'russian' );
		assert.equal( manifest.vertices, 0 );
		assert.deepEqual( manifest.fog, map.endsWith( 'alpha' ) ? [0.002, 0.2, 0.3, 0.4] : [0, 0, 0, 0] );
	} );
}

test( 'static model decode failure is not silently dropped from a ready map', async () => {
	const archives = await mounted( { 'maps/mp/mp_prop.d3dbsp': syntheticBsp( '{ "classname" "misc_model" "model" "missing_prop" }' ) } );
	const { ctx, files } = sink( archives );
	await assert.rejects( extractMap( ctx, 'mp_prop' ), /missing_prop/ );
	assert.ok( !files.has( 'maps/mp_prop/manifest.json' ) );
} );

test( 'non-bullet weapons stay in the viewmodel catalog; hands are optional', async () => {
	const { ctx, files } = sink( await mounted( {} ) );
	await extractViewmodels( ctx, { grenade: { weaponType: 'projectile', gunModel: 'custom/grenade' } } );
	const value = JSON.parse( new TextDecoder().decode( files.get( 'viewmodels/catalog.json' ) ) );
	assert.deepEqual( value.weapons.grenade, { gun: 'custom/grenade', hands: null } );
} );

test( 'character script discovery preserves arbitrary IDs and ignores commented models', async () => {
	const { ctx, files } = sink( await mounted( { 'character/custom_unit.gsc': '// setModel("wrong");\nself setModel("body_custom"); self attach("head_custom");' } ) );
	await extractPlayermodels( ctx, {} );
	const value = JSON.parse( new TextDecoder().decode( files.get( 'characters/catalog.json' ) ) );
	assert.equal( value.characters.custom_unit.body, 'body_custom' );
	assert.equal( value.characters.custom_unit.head, 'head_custom' );
} );

test( 'sound CSV quotes and continuation preserve explicit numeric zero', async () => {
	assert.deepEqual( parseCSV( 'name,file\r\na,"sound,a.wav"\n' ), [['name','file'], ['a','sound,a.wav']] );
	assert.throws( () => parseCSV( '"bad' ), /Unterminated/ );
	const rows = [], { ctx } = sink( await mounted( { 'soundaliases/test.csv': 'name,file,vol_min,probability\na,"test,a.wav",0,0\n,test2.wav,1,1\n' } ) );
	await forEachSoundAlias( ctx, row => rows.push( row ) );
	assert.equal( rows[0].volumeMin, 0 ); assert.equal( rows[0].probability, 0 ); assert.equal( rows[1].alias, 'a' );
} );

test( 'opaque native instruction metadata is absent from bootstrap defaults', async () => {
	const text = new TextDecoder().decode( await decompressDvars() );
	const value = JSON.parse( text );
	assert.ok( value.dvars.length > 300 );
	assert.ok( !/call_bytes|name_address|"sites"/.test( text ) );
} );

test( 'archive overlay fingerprints detect same-length replacement contents', async () => {
	const a = await mounted( { 'TEST/File': '111' } ), b = await mounted( { 'TEST/File': '222' } );
	assert.notEqual( await a.fingerprint(), await b.fingerprint() );
	assert.deepEqual( a.allFilenames(), ['test/file'] );
	assert.equal( await a.readText( 'test/file' ), '111' );
} );

test( 'ZIP CRC rejects corrupt payload and central directory rejects traversal', async () => {
	const bytes = new Uint8Array( await syntheticIwd( { 'file': 'payload' } ).arrayBuffer() );
	bytes[34] ^= 1;
	const zip = new RetailZipArchive( new File( [bytes], 'bad.iwd' ) );
	await zip.loadCentralDirectory();
	await assert.rejects( zip.read( 'file' ), /integrity/ );
	const unsafe = new RetailZipArchive( syntheticIwd( { '../escape': 'x' } ) );
	await assert.rejects( unsafe.loadCentralDirectory(), /Unsafe/ );
} );

test( 'truncated BSP lump is an error rather than shortened geometry', () => {
	const bytes = syntheticBsp(), view = new DataView( bytes.buffer );
	view.setUint32( 8 + 35 * 8, 0xffffffff, true );
	assert.throws( () => new BspParser( bytes ).getLump( 35 ), /Truncated/ );
} );

/*
====================
Worldspawn color normalization uses the largest channel, not a minimum of one.
====================
*/
test( 'world sun uses native angle convention and normalized color on arbitrary maps', async () => {
	const { ctx, files } = sink( await mounted( {
		'maps/mp/mp_dark.d3dbsp': syntheticBsp( '', { sundirection: '-45 135 0', suncolor: '0.5 0.25 0.1', sunlight: '2' } ),
	} ) );
	await extractMap( ctx, 'mp_dark' );
	const manifest = JSON.parse( new TextDecoder().decode( files.get( 'maps/mp_dark/manifest.json' ) ) );
	assert.deepEqual( manifest.sun.color, [2, 1, 0.4] );
	for ( const [i, expected] of [-0.5, 0.5, Math.SQRT1_2].entries() ) assert.ok( Math.abs( manifest.sun.direction[i] - expected ) < 1e-6 );
} );
