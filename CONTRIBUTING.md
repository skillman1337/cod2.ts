# Contributing

## Scope and ownership

Keep archive parsing, asset conversion, persistence, page permissions and engine state ownership separate. Do not add a map-name or weapon-name exception to fix a format-family problem. Reproduce the issue with synthetic data and at least two unrelated identities. Changes that improve loading do not establish animation, gameplay or visual parity.

The engine's ownership manifest and execution tags are contracts, not decorative documentation. Run `npm run verify` and update `npm run exec:map` after changing the call graph. `npm run build` is a separate production bundling check.

## Comments and formatting

Use tabs for TypeScript/JavaScript indentation and preserve nearby spacing. Use id-style file banners and function blocks, for example:

```ts
/*
===============================================================================

	asset_catalog.ts

	Owns named asset metadata. It does not own renderer or filesystem state.

===============================================================================
*/

/*
====================
Asset_Resolve

Returns a canonical asset identity; never substitutes a different map's data.
====================
*/
function Asset_Resolve( name: string ): string {
	return name.toLowerCase();
}
```

Describe invariants, lifecycle ownership and the reason behind non-obvious work. Do not narrate every line or copy a copyright header from unrelated code. Existing `@exec` annotations must remain intact. Public functions need a purpose and explicit failure behavior.

## Tests and performance

A cache change should test cold hit, warm hit, duplicate requests, worker restart, source mismatch, denied permission, cancellation, corrupt/truncated output and failed publication. Do not substitute a PNG microbenchmark or synthetic empty map for end-to-end retail measurements.

Record first menu, first selected-map load and second selected-map load separately. Include browser, hardware, build mode, archive set and throttling settings. Never attach retail files, private paths or raw reference executables to an issue. Use minimal original synthetic fixtures.

## Before publishing

Review `THIRD_PARTY_NOTICES.md`, confirm authority to license all pre-existing source, and retain upstream licenses. Stage files deliberately, then run `npm run verify:release` to inspect the Git index. `.gitignore` does not remove an already tracked file. The source archive must not include `temp/`, extracted assets, binaries, fonts, traces, credentials or dependencies.
