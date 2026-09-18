/*
===============================================================================

	retail-names.ts

	Demand-driven retail asset compilation. No retail content is bundled here.

===============================================================================
*/


/*
====================
assetName

Preserve path identity; replacing punctuation with underscores causes collisions.
====================
*/
export function assetName( value: string, prefix = '' ): string {
	let name = value.replaceAll( '\\', '/' ).replace( /^\/+/, '' ).toLowerCase();
	if ( prefix && name.startsWith( prefix + '/' ) ) name = name.slice( prefix.length + 1 );
	if ( !name || name.length > 768 || name.split( '/' ).some( part => !part || part === '.' || part === '..' || /[:\0]/.test( part ) ) ) {
		throw new Error( `Unsafe asset identity: ${value}` );
	}
	return name;
}

/*
====================
imageURL
====================
*/
export function imageURL( family: 'textures' | 'normalmaps', name: string ): string {
	return `/assets/${family}/${assetName( name, 'images' ).split( '/' ).map( encodeURIComponent ).join( '/' )}.png`;
}

/*
====================
menuImageKey

Injective, URL-safe key. A literal '~23' must not collide with '#'.
====================
*/
export function menuImageKey( name: string ): string {
	return [...new TextEncoder().encode( assetName( name, 'images' ) )]
		.map( byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
}
