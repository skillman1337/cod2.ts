# Ambient type declarations

`third_party/webgpu-types-0.1.71/index.d.ts` is a vendored, unmodified copy of
`@webgpu/types` 0.1.71. It keeps `npm run typecheck` independent of package
registry availability while the project targets TypeScript 5.x.

The upstream BSD-3-Clause license is retained beside the declaration file.
Vite-specific ambient declarations live in the repository root at
`vite-env.d.ts` and are intentionally limited to the APIs this project uses.
