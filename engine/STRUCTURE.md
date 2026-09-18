# cod2.ts — Engine Ownership Structure

The engine uses a **one lifecycle owner → many direct children** model. Child
count is not constrained. The important constraints are who owns lifecycle and
which capabilities cross a boundary.

`engine/ownership.json` is the source of truth. The verifier does not infer an
owner from the current import graph; it checks the import graph against the
explicit manifest.

## Two kinds of source files

### Lifecycle modules

A lifecycle module owns some combination of initialization, shutdown, polling,
sequencing, mutable state, or handoff. Every lifecycle module under `engine/com/`
has exactly one declared owner.

### Package internals

An internal file is an implementation split, not a new runtime owner. Internals
live under their package entry's `internal/` directory and are reachable only by
the package entry or another internal in that same package.

This distinction prevents artificial tree levels created only because a file got
large.

## Current tree

```text
index.ts
└── engine/com/com.ts
    ├── cmd/cmd.ts
    ├── host/host.ts
    ├── net/net.ts
    ├── server/sv_main.ts
    └── client/cl_main.ts
        ├── cl_main/cl_state.ts
        ├── input/input.ts
        ├── sound/sound.ts
        ├── usercmd/usercmd.ts
        ├── cl_main/scr_menu.ts
        │   └── cl_main/scr_menu/ui_menu_runtime.ts
        │       └── cl_main/scr_menu/mp_main_menu/menus.ts
        │           ├── internal/menu_def.ts
        │           └── internal/menu_strings.ts
        └── screen/scr_draw.ts
            └── screen/scr_draw/r_webgpu.ts
                ├── rgpu/rgpu_init.ts
                ├── rgpu/rgpu_surface.ts
                ├── rgpu/rgpu_frame.ts
                ├── rgpu/rgpu_draw.ts
                └── rgpu/rgpu_menu/rgpu_menu.ts
                    ├── internal/rgpu_menu_contract.ts
                    └── internal/rgpu_menu_text.ts
```

`engine/common/` is outside the lifecycle tree. It may contain only
branch-neutral types/algorithms or genuinely cross-cutting foundation code, and
it must never import from `engine/com/`.

Current foundation files:

```text
engine/common/
├── common.ts       console and common error infrastructure
├── cvar.ts         configuration variables
├── math.ts         branch-neutral math
├── pm.ts           shared player movement
├── types.ts        wire/data types; no WebGPU object authority
├── ui_layout.ts    canonical virtual UI placement and alignment
└── vid.ts          canvas/layout state; no GPU context ownership
```

## Import rules

1. A lifecycle module may import its **direct lifecycle children**, its own
   package internals, and `engine/common/`.
2. A package internal may import only `engine/common/` and internals in the same
   package.
3. Siblings, ancestors, cousins, and grandchildren are not directly reachable.
4. `index.ts` may reach only the root lifecycle module and `engine/common/`.
5. `engine/common/` may reach only `engine/common/`.
6. All local code imports must be statically resolvable. Computed `import()` and
   `require()` calls are rejected because they make ownership unverifiable.
7. Type-only imports, side-effect imports, re-exports, dynamic imports, import
   types, import-equals declarations, `require()`, and reference paths all count
   as dependency edges.

A runtime import/export edge from the declared owner to every lifecycle child is
required. Any second importer is an ownership violation even when the import is
type-only.

## Sibling communication

Siblings exchange values through their parent rather than acquiring one another's
modules or mutable state.

```text
Com_RunServerClientFrames
  CL_SampleUsercmd() -> usercmd_t
  SV_Frame(cmd)      -> client_snapshot_t
  NET_Frame(...)
  CL_Frame(snapshot)

CL_RunActiveFrame
  CL_BuildScrFrame() -> scr_frame_t
  SCR_UpdateScreen(frame)
```

The same rule applies inside the renderer. `r_webgpu.ts` gives children narrow
capabilities rather than a shared master GPU state object.

The client menu follows the same ownership rule. `scr_menu.ts` owns semantic menu
intent and browser click-listener lifetime. `cl_main.ts` explicitly selects the
startup policy and consumes `SCR_MenuIsActive()` for audio/input behavior.
`SCR_MenuGpuOverlay()` produces a plain frame value for the screen branch. The
renderer is not allowed to turn resource readiness into UI state.

## WebGPU ownership

```text
r_webgpu.ts                    device-epoch and orchestration owner
├── rgpu_init.ts               adapter/device creation and device-loss watches
├── rgpu_surface.ts            GPUCanvasContext and swapchain configuration
├── rgpu_frame.ts              command encoder, render pass, and queue submit
├── rgpu_draw.ts               scene resources and pass-local draw encoding
└── rgpu_menu.ts               menu resources and pass-local draw encoding
```

Only `rgpu_frame.ts` begins/ends render passes. It receives an attenuated command
capability and gives draw children a frame-local `GPURenderPassEncoder`. Renderer
children do not receive `GPUDevice`, `GPUQueue`, `GPUCanvasContext`, or a complete
mutable renderer state object.

`rgpu_menu.ts` distinguishes its own local background/fill core from aggregate
package readiness. Its private text implementation is built only after the local
core succeeds; aggregate readiness combines both afterward. This prevents a
parent/package entry from requiring an unbuilt private child during construction.

Asynchronous menu resources receive an epoch id, `AbortSignal`, stale-generation
guard, selected constructors/uploads, and a serialized synchronous validation
callback. They do not receive the raw device epoch.

## Adding a module

1. Identify the lifecycle owner. Do not create a lifecycle level for file size.
2. For a real lifecycle child, add it to `engine/ownership.json` and place it in a
   subfolder of its owner.
3. For an implementation split, place it under the package entry's `internal/`
   directory and classify it under `internals` in the manifest.
4. Keep the interface narrow: values, callbacks, or capability methods rather
   than an owner's complete mutable state.
5. Run `npm run exec:map`, then `npm run verify`.

See `../docs/VERIFICATION.md` for the exact machine-enforced rules.

## Character correctness helpers

`common/character_controllers.ts` contains pure native-derived controller math;
its state is owned by the character renderer (or an entity owner), not by a new
lifecycle module. `common/material_assets.ts` resolves exported material identities
and loads images without acquiring WebGPU capabilities. Neither imports `com/`.
The existing renderer owner retains GPU creation, uploads, destruction and epoch
validation. These common helpers do not add lifecycle/ownership manifest entries.

The current character catalog selector is not a native playeranim.script / XAnim
tree interpreter. Native controller inputs can be carried as plain frame data in
`refdef.playerControllers`; the local-player bridge does not invent unavailable
ground-conformance, yaw-swing, or native script-condition state.
