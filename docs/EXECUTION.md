# cod2.ts — Execution & WebGPU Lifetime Model

The import/ownership tree and the execution graph are related, but they are not
the same graph:

```text
explicit ownership manifest
        ↓
constrained AST import graph
        ↓
parent-mediated value/capability handoffs
        ↓
AST-derived execution graph
```

`docs/EXECUTION_MAP.md` and `docs/execution_map.json` are generated from the TypeScript AST.
Comments and string literals cannot create call edges. Source comments retain only
an optional `@exec` cadence tag; callers and callees are not hand-maintained.

## Bootstrap

```text
index.ts: main
  -> Main_StartGame
       -> Com_Init
            -> Host_Init
            -> Con_Init
            -> Cbuf_Init
            -> SV_Init
            -> NET_Init
            -> listen client: CL_Init
                 -> VID_SetCanvas
                 -> input / sound / menu init
                 -> SCR_MenuSetActive(true)  # explicit client startup policy
                 -> SCR_InitGpu
                      -> RGPU_InitBegin
       -> Com_BeginLoop
            -> requestAnimationFrame(Com_RafCallback)
```

`index.ts` cannot call `VID_*` or `RGPU_*` functions directly. `com.ts` is the
single engine root.

## Frame loop

```text
Com_RafCallback(now)
  -> Com_HandleVidResize
  -> Com_Frame(now)
       -> Cbuf_Execute
       -> Com_RunServerClientFrames
            -> CL_SampleUsercmd
            -> SV_Frame
            -> NET_Frame
            -> CL_Frame
                 -> SCR_MenuIsActive / SCR_MenuFrame
                 -> CL_BuildScrFrame (includes client-owned menu overlay)
                 -> SCR_UpdateScreen
                      -> RGPU_InitPoll
                      -> RGPU_BeginFrame
                      -> scene/menu draw encoding
                      -> RGPU_EndFrame
                 -> sound update
  -> requestAnimationFrame(next)
```

Every function reachable through the local call graph from `Com_RafCallback` must
be synchronous. Top-level `await`, `await` in the frame closure, generators in the
frame closure, and `requestAnimationFrame` ownership outside `com.ts` are rejected.

## Typed handoffs

State crosses subsystem boundaries as explicit data:

```text
usercmd_t
  -> server simulation
  -> client_snapshot_t
  -> client prediction/presentation
  -> scr_frame_t
  -> screen and renderer
```

This keeps temporal sequencing in the parent and prevents sibling branches from
reading one another's mutable globals.

## Client UI intent versus renderer readiness

Menu activity is semantic client state owned by `scr_menu.ts` and selected by
`cl_main.ts`. It drives UI input mode, cursor behavior, menu music, and the
`rgpu_menu_overlay_t` value placed in `scr_frame_t`.

```text
SCR_MenuSetActive(active)
  -> SCR_MenuIsActive() for input/audio policy
  -> SCR_MenuGpuOverlay() for a renderer-neutral frame value
  -> RGPU_BeginFrame(..., overlay)
  -> RGPU_DrawWorld(overlay)
```

GPU menu resource readiness only determines whether the renderer can encode the
requested overlay. It never activates the menu, changes audio/input policy, or
suppresses the world by itself. While assets are unavailable, an explicitly
requested menu frame falls back to the world path rather than manufacturing UI
state from GPU handles.

## WebGPU state machine

`r_webgpu.ts` owns the backend state machine. Adapter/device promises only update
the private init child; the parent advances the state synchronously from
`RGPU_InitPoll`.

```text
NONE
  -> REQUEST_ADAPTER
  -> REQUEST_DEVICE
  -> CONFIGURE_SURFACE
  -> BUILD_RESOURCES
  -> READY
  -> FAILED
```

`READY` means more than “JavaScript handles are non-null.” Core draw and menu
resources are created inside serialized WebGPU validation and out-of-memory error
scopes. Validation operations are synchronous; a compile-time contract, AST rule,
and runtime thenable guard prevent scopes from being popped before construction
finishes. The backend advances only after both scopes resolve without an error and
all required handles are present. Local menu-core readiness is checked before its
private text child is built; aggregate readiness is checked only after both local
and private-child construction complete.

## Device epochs

Each successful device request creates an immutable device epoch:

```text
{ id, device, queue, swapchain_format, supports_bc }
```

Only the parent receives that epoch. Children receive frozen, narrower
capabilities derived from it.

- Frame child: create-command-encoder and submit methods only.
- Draw child during construction: selected resource constructors only.
- Draw child during a frame: upload methods and the current render pass only.
- Menu package: selected constructors/uploads, epoch id, `AbortSignal`,
  `isCurrent()`, and serialized `validate()`.

No child receives a shared master `rgpu_t` object.

## Async asset work

Menu image/font work is allowed between frames, but it is bound to a device epoch.
Every request uses the epoch's `AbortSignal`; every continuation checks its serial
and `isCurrent()` after `await` before mutating GPU state. Teardown aborts the
signal, increments local load serials, destroys owned resources, and makes stale
continuations harmless.

`ImageBitmap.close()` runs in `finally` paths. Resources constructed for a stale or
failed upload are destroyed before return.

Optional BC texture compression is negotiated once at device creation. The init
owner requests `texture-compression-bc` only when the adapter advertises it, then
records whether the created device actually enabled it. Menu text uses BC3 only
through that negotiated capability and otherwise falls back to PNG.

## Frame ownership

`rgpu_surface.ts` is the only owner of `GPUCanvasContext` and returns only a
frame-local texture view.

`rgpu_frame.ts` is the only owner of:

- `GPUCommandEncoder`
- render-pass begin/end lifetime
- command-buffer finish
- queue submission

All loading, failure, gameplay, and menu rendering goes through that same frame
path. Menu code cannot create an independent encoder or submit work.

## Failure behavior

- Device loss invalidates the generation, aborts child work, resets the surface,
  destroys the device world, and enters `FAILED`.
- Validation/allocation/uncaptured errors abort renderable child resources and
  enter `FAILED` while retaining the live frame/surface capability long enough to
  present the failure clear when possible.
- Intentional shutdown increments the init generation before `device.destroy()`,
  so the resulting loss callback is stale.

## Cadence annotation

The only maintained execution annotation is optional:

```ts
/**
 * @exec bootstrap-once
 */
```

Allowed values are:

- `bootstrap-once`
- `init-once`
- `per-frame`
- `async-callback`
- `helper`

The verifier rejects invalid values and requires every `@exec per-frame` function
to remain synchronous. The generated map infers bootstrap/frame/async/helper
membership from the AST call graph rather than from hand-written caller tags.

## Commands

```sh
npm run exec:map       # rewrite AST-derived map files
npm run exec:check     # execution invariants + map freshness
npm run verify         # complete non-mutating architecture/runtime gate
npm run build          # verify, emit native ES modules, and smoke over HTTP
```

The canonical build preserves browser ES modules, rewrites aliases/assets/JSON,
writes a hashed manifest, links the complete graph, and verifies all output bytes
and MIME types through a local HTTP server.
