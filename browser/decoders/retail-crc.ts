/*
===============================================================================

	retail-crc.ts

	ZIP payload integrity. CRC is corruption detection, not authentication.

===============================================================================
*/

const table = Uint32Array.from( { length: 256 }, ( _, value ) => {
	let crc = value;
	for ( let bit = 0; bit < 8; bit++ ) crc = ( crc >>> 1 ) ^ ( ( crc & 1 ) ? 0xedb88320 : 0 );
	return crc >>> 0;
} );

/*
====================
crc32
====================
*/
export function crc32( bytes: Uint8Array ): number {
	let crc = 0xffffffff;
	for ( const value of bytes ) crc = table[( crc ^ value ) & 255] ^ ( crc >>> 8 );
	return ( crc ^ 0xffffffff ) >>> 0;
}
