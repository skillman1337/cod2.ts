> **Historical document.** Superseded for loading and release status by [LOADING-ARCHITECTURE.md](LOADING-ARCHITECTURE.md), [MODULE-AUDIT.md](MODULE-AUDIT.md) and [VERIFICATION.md](VERIFICATION.md). Original measurements/claims below describe an earlier revision.

# cod2.ts — WebGPU Foundation Refactor Report

## Status

The refactor is complete and the canonical production command passes:

```bash
npm run build
```

Final verified result:

- TypeScript typecheck: pass
- ownership architecture: pass
- WebGPU authority/lifetime architecture: pass
- execution graph and generated-map freshness: pass
- architecture verifier mutation suite: 35 cases pass
- native browser-module builder: pass
- browser-builder mutation suite: 11 cases pass
- executable WebGPU/client lifecycle suite: pass
- production-module link, manifest, hash, MIME, and HTTP smoke checks: pass

## Architectural result

The project now implements the rule as:

> One lifecycle owner may have many private children. Siblings do not acquire one another's authority, and shared mutable parent state is not handed to children.

The rule is represented explicitly in `engine/ownership.json`. It distinguishes two kinds of source files:

1. **Lifecycle modules** participate in the parent/child ownership tree.
2. **Package internals** are private implementation files belonging to one lifecycle module; they do not create artificial runtime-owner levels merely because code was split into another file.

The current manifest contains 20 lifecycle modules and 4 package internals. The verified local module graph contains 69 import edges.

## Major refactors

### 1. Removed the master GPU state capability

The former mutable `rgpu_t`/`rgpu_state.ts` model has been removed. Renderer children no longer receive a structure containing the adapter, device, queue, context, pass, encoder, surface state, and sibling-owned fields.

`r_webgpu.ts` now owns the renderer lifecycle and distributes narrow, immutable capabilities for only the work each child is allowed to perform.

### 2. Established single owners for WebGPU authority

The renderer boundary now has explicit owners:

- `rgpu_init.ts`: adapter/device creation, optional-feature negotiation, device loss, and uncaptured errors
- `rgpu_surface.ts`: the `GPUCanvasContext`, configuration, resize, and unconfiguration
- `rgpu_frame.ts`: command encoder creation, render-pass lifetime, command-buffer finish, and queue submission
- `rgpu_draw.ts`: world resource construction/upload and pass encoding through attenuated capabilities
- `rgpu_menu.ts`: menu resource construction/upload and pass encoding, without command submission authority
- `r_webgpu.ts`: state-machine orchestration, device epochs, validation sequencing, and child handoffs

Only the frame owner may begin/end a render pass and submit a command buffer. Menu and world drawing receive a pass-oriented encoding capability rather than the queue or the complete device state.

### 3. Added device epochs and cancelable asynchronous work

Every initialized device belongs to an immutable epoch. Asynchronous child work captures:

- the epoch identifier
- the epoch device/queue capabilities it is permitted to use
- an `AbortSignal`

Menu image/font loading checks that the captured epoch is still current after asynchronous boundaries. Shutdown or failure aborts pending work. Stale device completions are destroyed instead of being adopted. `ImageBitmap` cleanup is guaranteed on completion/failure paths.

### 4. Made WebGPU readiness validation-backed

A non-null JavaScript WebGPU handle is no longer treated as proof that a resource is valid. Resource construction is wrapped in serialized WebGPU validation and out-of-memory error scopes. The backend only reaches `READY` after the scoped operations complete without an error.

Validation callbacks are deliberately synchronous so error scopes remain correctly nested. Both the source verifier and runtime guard reject an accidental async/thenable validation operation.

### 5. Negotiated optional features at device creation

BC texture compression is now decided by the adapter/device owner. When the adapter supports `texture-compression-bc`, the feature is included in `requestDevice()`; children consume the negotiated epoch capability. The font path retains a PNG fallback.

### 6. Separated client UI intent from renderer asset readiness

Client-owned menu state now answers whether the UI is active. Renderer-owned readiness only answers whether menu assets can be drawn.

This removes the old semantic leak where loaded GPU menu resources could activate menu behavior, music, cursor handling, or gameplay suppression without an explicit client decision.

The client owns listener registration and teardown, including canvas replacement/rebinding. It hands the renderer either a typed menu overlay or `null` for each frame.

### 7. Consolidated shared UI layout definitions

UI alignment constants and placement logic now have one canonical definition in `engine/common/ui_layout.ts`. The verifier checks both duplication and accidental deletion of these canonical declarations.

`common/` no longer exposes branch-owned mutable WebGPU state.

## Defects found by dogfooding

The executable lifecycle suite found and permanently captured two important semantic defects.

### Renderer readiness was acting as menu intent

The previous client path treated renderer menu-resource readiness as the source of truth for menu activation. That coupled asset timing to UI behavior and could suppress world rendering or alter input/music state simply because textures had loaded.

The fix introduces explicit client-owned menu intent and a typed per-frame overlay handoff.

### Menu initialization could never legitimately reach `READY`

During the first complete parent-lifecycle mock run, menu core construction checked aggregate menu readiness before the private text child had been built. The parent therefore could not complete resource initialization in the intended order.

The fix separates:

- local menu background/fill readiness, used while constructing the menu owner itself
- aggregate menu-plus-text readiness, used after the private child has been constructed

A mutation test now rejects reintroducing the premature aggregate check, and the end-to-end lifecycle test proves that the backend progresses through validation to `READY`.

## Verification foundation

### Explicit ownership manifest

`engine/ownership.json` is authoritative. Ownership is no longer inferred from the import graph it is meant to constrain.

The ownership verifier rejects:

- sibling imports and re-exports
- side-effect imports
- literal dynamic imports
- computed dynamic imports that cannot be verified statically
- type-only imports that violate ownership
- unresolved local imports and aliases
- private-package implementation leaks
- unclassified engine files
- ownership cycles
- runtime import cycles
- syntax errors

### TypeScript AST instead of regular expressions

The verifier uses the TypeScript compiler AST. It recognizes import declarations, export declarations, import types, dynamic imports, import-equals/require forms, and triple-slash references. Comments and strings cannot forge graph edges.

This closes the original validator bypass where a side-effect import such as `import '../sibling.js';` was invisible to the regex-based script.

### WebGPU authority verifier

The architecture verifier checks structural invariants including:

- no master GPU state symbol
- no raw WebGPU object authority exported through child APIs
- one queue-submit owner
- one render-pass owner
- one canvas-context owner
- menu loaders require epoch cancellation
- optional feature negotiation is present
- renderer readiness cannot drive client menu intent
- validation callbacks cannot become async
- per-frame functions and the frame closure cannot become async
- `requestAnimationFrame` has one owner
- the frame-spine ordering remains intact
- bracket property access cannot bypass authority checks

### Mutation-tested verification

`tools/test_verification.mjs` applies 35 targeted source mutations. Each mutation must be rejected for the expected reason, while the unmodified baseline must pass.

`tools/test_browser_build.mjs` applies 11 mutations to the native module builder/smoke path, covering malformed imports, unresolved aliases/assets, manifest corruption, stale/extra files, invalid hashes, and type-only module handling.

### Executable lifecycle verification

`tools/test_webgpu_lifecycle.mjs` executes the refactored code against controlled browser/WebGPU mocks. It covers:

- optional-feature negotiation
- stale adapter/device completions
- explicit double-start/shutdown discipline
- epoch-routed device loss and uncaptured errors
- frame pass disposal and exactly one submission per frame
- surface context confinement, resize recovery, reset, and unconfiguration
- client menu intent, canvas-listener rebinding, and teardown
- serialized LIFO validation/error scopes
- complete parent initialization through `READY`
- background/font uploads and cursor-fetch cancellation
- world rendering when menu assets are ready but no menu is requested
- menu rendering only when an explicit overlay is supplied
- failure-frame submission and final shutdown cleanup
- `ImageBitmap` cleanup

## Production build and smoke path

The canonical build does not depend on Vite. `tools/build_browser_modules.mjs` emits native browser ES modules, rewrites local aliases and asset imports, fingerprints every delivered file in `dist/build_manifest.json`, and rejects stale or unexpected output.

Final output:

- 32 emitted JavaScript modules
- 53 resolved module imports
- 7 asset URL rewrites
- 43 manifested deliverable files

The smoke test:

- links 31 reachable runtime modules in a Node VM
- recognizes 1 valid type-only emitted shell
- serves and verifies 44 files over HTTP
- validates all 43 manifest entries for exact bytes, SHA-256, and expected MIME behavior

## Execution documentation

The execution map is generated from source and checked for freshness:

- 486 functions
- 689 resolved call edges

Generated artifacts:

- `docs/execution_map.json`
- `docs/EXECUTION_MAP.md`

Human-oriented lifecycle documentation is in:

- `docs/EXECUTION.md`
- `engine/STRUCTURE.md`
- `docs/VERIFICATION.md`

## Reproduction commands

```bash
npm run verify
npm run build
```

Useful focused commands:

```bash
npm run verify:ownership
npm run verify:webgpu
npm run exec:check
npm run verify:selftest
npm run verify:build
npm run verify:build-selftest
npm run verify:lifecycle
npm run build:modules
npm run smoke:modules
```

`npm run build:vite` remains available as an optional bundler path after dependencies are installed.

## Toolchain note

The project pins TypeScript `5.9.3` and Vite `6.4.3` in `package.json` and `package-lock.json`, and vendors the exact WebGPU ambient declarations used by the source under `types/third_party/` with their license.

The complete canonical gate was executed in this environment with Node `v22.16.0` and the available TypeScript compiler (`5.8.3`). A lockfile installation could not be repeated here because the environment's private npm mirror returned HTTP 404 for the pinned Vite tarball, and direct public-registry DNS is blocked. The canonical build and all architecture/lifecycle tests are deliberately Vite-independent; the optional Vite bundling command was therefore not part of the final executed gate.

## Browser/GPU limitation

The environment did not provide a usable real Chromium/WebGPU process; even a trivial browser startup attempt did not complete. Therefore this report does not claim physical GPU or browser-process execution.

The refactor was dogfooded through:

- TypeScript compilation
- AST architecture analysis
- mutation-tested verification
- executable WebGPU/browser mocks
- complete native ES-module linking
- HTTP serving and byte/hash/MIME validation

A final real-device/browser smoke run remains the appropriate platform integration check on a machine with a functioning WebGPU-capable browser.

## Key files

- `engine/ownership.json` — authoritative parent/internal ownership model
- `engine/com/client/screen/scr_draw/r_webgpu.ts` — renderer lifecycle owner
- `engine/com/client/screen/scr_draw/rgpu/rgpu_init.ts` — device epoch owner
- `engine/com/client/screen/scr_draw/rgpu/rgpu_surface.ts` — canvas-context owner
- `engine/com/client/screen/scr_draw/rgpu/rgpu_frame.ts` — pass/submission owner
- `engine/com/client/screen/scr_draw/rgpu/rgpu_menu/rgpu_menu.ts` — menu resource/encoding owner
- `engine/com/client/cl_main/scr_menu.ts` — client menu-intent owner
- `tools/verify_ownership.mjs` — ownership/import verifier
- `tools/verify_webgpu_architecture.mjs` — authority/lifetime verifier
- `tools/test_verification.mjs` — architecture mutation suite
- `tools/test_webgpu_lifecycle.mjs` — executable lifecycle suite
- `tools/build_browser_modules.mjs` — canonical production emitter
- `tools/smoke_browser_modules.mjs` — linked/HTTP build smoke test
