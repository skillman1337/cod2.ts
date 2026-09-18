# Test groups

The original assertions and reference suites are retained. Files moved; differing behavioral tests were not collapsed merely because their scaffolding looks alike.

- `tooling/`: command/path infrastructure, packaging, build/link/HTTP checks, verification self-tests, and movement trace endpoint tests.
- `runtime/`: input, character pipeline, lifecycle, recording, and frame-cap behavior.
- `native/`: movement, collision, weapon, audio, and other comparisons against native-reference data. These often consume generated captures rather than executing a native binary themselves.

The `test_cleanup.py` and `test_reorganization.mjs` suites are new and asset-free; they do not establish native parity. `test_movement_trace_server.mjs` also runs without retail files and now owns/removes its temporary directory. Most other suites need the full engine checkout, compiled output, and specific assets or evidence captures. Keep those prerequisites; do not replace failing native comparisons with empty fixtures.

Use `python tools/run.py info NAME` or `node tools/run.mjs info NAME` to find a command without executing it. Both launchers run commands with the project root as working directory. Only the newly added tests are designed to be completely independent of the engine checkout.
