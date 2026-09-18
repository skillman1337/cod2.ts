/*
===============================================================================

	synthetic.mjs

	Original, deliberately tiny format fixtures. No retail media is embedded.

===============================================================================
*/

export const utf8 = text => new TextEncoder().encode( text );

/*
====================
fixtureCRC

Independent, slow reference implementation for fixture generation.
====================
*/
function fixtureCRC( bytes ) {
	let crc = 0xffffffff;
	for ( const byte of bytes ) {
		crc ^= byte;
		for ( let bit = 0; bit < 8; bit++ ) crc = crc >>> 1 ^ ( crc & 1 ? 0xedb88320 : 0 );
	}
	return ( crc ^ 0xffffffff ) >>> 0;
}

/*
====================
syntheticIwd
====================
*/
export function syntheticIwd( entries ) {
	const parts = [], directory = [];
	let offset = 0;
	for ( const [name, value] of Object.entries( entries ) ) {
		const bytes = typeof value === 'string' ? utf8( value ) : value;
		const filename = utf8( name ), crc = fixtureCRC( bytes );
		const header = new Uint8Array( 30 ), h = new DataView( header.buffer );
		h.setUint32( 0, 0x04034b50, true ); h.setUint16( 4, 20, true );
		h.setUint32( 14, crc, true ); h.setUint32( 18, bytes.length, true ); h.setUint32( 22, bytes.length, true );
		h.setUint16( 26, filename.length, true );
		parts.push( header, filename, bytes );
		const central = new Uint8Array( 46 ), c = new DataView( central.buffer );
		c.setUint32( 0, 0x02014b50, true ); c.setUint16( 4, 20, true ); c.setUint16( 6, 20, true );
		c.setUint32( 16, crc, true ); c.setUint32( 20, bytes.length, true ); c.setUint32( 24, bytes.length, true );
		c.setUint16( 28, filename.length, true ); c.setUint32( 42, offset, true );
		directory.push( central, filename );
		offset += header.length + filename.length + bytes.length;
	}
	const tail = new Uint8Array( 22 ), t = new DataView( tail.buffer );
	t.setUint32( 0, 0x06054b50, true ); t.setUint16( 8, directory.length / 2, true ); t.setUint16( 10, directory.length / 2, true );
	t.setUint32( 12, directory.reduce( ( n, bytes ) => n + bytes.length, 0 ), true ); t.setUint32( 16, offset, true );
	return new File( [...parts, ...directory, tail], 'synthetic.iwd', { lastModified: 1 } );
}

/*
====================
syntheticIwi

One white DXT5 block, not a game image.
====================
*/
export function syntheticIwi() {
	const bytes = new Uint8Array( 44 ), view = new DataView( bytes.buffer );
	bytes.set( [0x49, 0x57, 0x69, 5, 13, 0] );
	view.setUint16( 6, 4, true ); view.setUint16( 8, 4, true );
	for ( let offset = 12; offset < 28; offset += 4 ) view.setUint32( offset, 44, true );
	bytes[28] = 255; bytes[29] = 255; bytes[36] = 255; bytes[37] = 255;
	return bytes;
}

/*
====================
syntheticBsp

An empty IBSP v4 world with bounded model/entity lumps. Not a retail map.
====================
*/
export function syntheticBsp( extraEntities = '', overrides = {} ) {
	const header = new Uint8Array( 8 + 38 * 8 ), h = new DataView( header.buffer );
	header.set( utf8( 'IBSP' ) ); h.setUint32( 4, 4, true );
	const model = new Uint8Array( 48 ), m = new DataView( model.buffer );
	[-16, -32, -64, 16, 32, 64].forEach( ( v, i ) => m.setFloat32( i * 4, v, true ) );
	const world = { classname: 'worldspawn', sundirection: '90 0 0', suncolor: '1 1 1', sunlight: '1', ...overrides };
	const entities = utf8( '{\n' + Object.entries( world ).map( ( [key, value] ) => `"${key}" "${value}"` ).join( '\n' ) + '\n}\n' + extraEntities );
	h.setUint32( 8 + 35 * 8, model.length, true ); h.setUint32( 12 + 35 * 8, header.length, true );
	h.setUint32( 8 + 37 * 8, entities.length, true ); h.setUint32( 12 + 37 * 8, header.length + model.length, true );
	const bytes = new Uint8Array( header.length + model.length + entities.length );
	bytes.set( header ); bytes.set( model, header.length ); bytes.set( entities, header.length + model.length );
	return bytes;
}

/*
====================
syntheticInstall
====================
*/
export function syntheticInstall() {
	const entries = {};
	for ( const font of ['smallFont', 'normalFont', 'bigFont', 'extraBigFont', 'consoleFont'] ) {
		const bytes = new Uint8Array( 16 ); new DataView( bytes.buffer ).setUint32( 4, 16, true );
		entries[`fonts/${font}`] = bytes;
	}
	for ( const image of ['gamefonts', '3_cursor3', 'background_american_w', 'test/shared#image'] ) entries[`images/${image}.iwi`] = syntheticIwi();
	for ( const sound of ['music/menu_GRTEMP.mp3', 'misc/mouse_ylover.wav', 'misc/mouse_ylselect.wav', 'test/shared.wav'] ) entries[`sound/${sound}`] = utf8( 'SYNTHETIC-AUDIO' );
	entries['maps/mp/mp_fixture_alpha.d3dbsp'] = syntheticBsp();
	entries['maps/mp/mp_fixture_beta.d3dbsp'] = syntheticBsp();
	entries['maps/mp/mp_fixture_alpha.gsc'] = 'game["allies"] = "british"; game["axis"] = "german"; setExpFog(0.002,0.2,0.3,0.4,0);';
	entries['maps/mp/mp_fixture_beta.gsc'] = 'game["allies"] = "russian"; game["axis"] = "german";';
	entries['ui_mp/menus.txt'] = 'loadMenu { "ui_mp/main.menu" }';
	entries['ui_mp/main.menu'] = '{ menuDef { name "main" rect 0 0 640 480 visible 1 } }';
	entries['soundaliases/synthetic.csv'] = 'name,file,vol_min,vol_max,pitch_min,pitch_max,probability,loadspec\nweapon_test,test/shared.wav,0,0.8,1,1,1,all_mp';
	entries['weapons/mp/test_projectile'] = 'WEAPONFILE\\weaponType\\projectile\\gunModel\\fixture_gun\\worldModel\\fixture_world';
	const animation = new Uint8Array( 9 ), av = new DataView( animation.buffer );
	av.setUint16( 0, 14, true ); av.setUint16( 2, 1, true ); av.setUint16( 7, 30, true );
	entries['xanim/fixture_motion'] = animation;
	const model = new Uint8Array( 80 ), mv = new DataView( model.buffer );
	mv.setUint16( 0, 20, true ); model.set( utf8( 'fixture_lod' ), 31 );
	// Remaining LOD names, collision count and material count are zero.
	entries['xmodel/fixture_gun'] = model;
	entries['xmodelsurfs/fixture_lod'] = new Uint8Array( [20, 0, 0, 0] );
	entries['xmodelparts/fixture_lod'] = new Uint8Array( [20, 0, 0, 0, 0, 0] );
	return entries;
}
