# GitHub publication implementation and verification

Source baseline: the supplied **cod2-browser-local-install(3).zip**. This pass adds repository automation, deployment-aware paths, publication checks and documentation. It does not replace the user's latest source with an older generated archive, certify retail compatibility, or provision GitHub/payment accounts.

## Implemented

- One `Verify and publish` workflow with source, two production/browser URL layouts, a stable `Verified` aggregate, an opt-in Pages artifact job and an isolated deployment job.
- Root and `/cod2.ts/` coverage. The Pages artifact is separately built and tested using the actual base reported by `configure-pages`, not an assumed repository name.
- A shared launcher base module; scoped service-worker registration and fetch interception; relative emitted worker imports; path-specific IndexedDB/OPFS names; an engine HTTP boundary for canonical asset URLs. Existing root cache names are unchanged.
- Removed the old explicit rejection of subdirectory launches. Quit and failed-engine retry remain under the application base. Launcher Node tests exercise both first-visit and cached boot at the project path.
- Production artifact checks for escaped/missing module and stylesheet resources, wrong base metadata, absent workers, native executable signatures, blocked retail paths, symlinks and size budgets. Eleven original build-fixture tests cover positive and negative cases. This scanner is not a copyright or secret certification.
- A production-launcher smoke check plus the existing native synthetic worker/OPFS/IDB/service-worker test harness. Failure diagnostics are written to `temp/test-results` for CI artifact retention. The server does not add cross-origin-isolation headers unavailable in this Pages setup.
- Minimal field-manual README, actual-source Mermaid entry-point map, linked source definitions, deterministic input digest and a documentation checker. The previously discussed full interactive atlas and loading animation are **not implemented in this pass**.
- Inactive FUNDING template, explicit payment setup instructions, CODEOWNERS and Dependabot configuration. No receiving account or wallet was guessed. No payment widget, key or wallet connection was added to the launcher.
- Code-only Pages builds include the GPL license, third-party notices and `build-info.json`, with the exact GitHub source revision when run in Actions.

## Verified locally in this pass

| Check | Result |
| --- | --- |
| Aggregate `npm run verify` | **Passed**, including every command in the aggregate. |
| TypeScript | **Passed with installed 5.8.3**, not the project's pinned 5.9.3. |
| Ownership / WebGPU / execution contract | **Passed**. |
| Architecture-verifier mutation cases | **31 passed**. |
| Generated execution inventory | **Passed**; regenerated for the changed source. |
| Runtime emission/import resolution | **Passed**; this is not a Vite build. |
| Node loader, launcher, path and publication checks | **136 passed, 1 optional fixture skipped**, 137 tests total. Eleven of the passes are publication-verifier fixture/mutation checks. |
| Chromium launcher DOM/layout suite | **15 passed**, including 42 state/viewport combinations, reduced motion, forced colors and disclosure controls. Exact exported view/CSS; not the bundled Vite app. |
| Documentation | Generated map freshness, local entry-document/source destinations, placeholder funding and full-SHA action references checked by `npm run verify:docs`. |
| Repository publication hygiene | Git index reviewed by `npm run verify:release` before packaging. |

Local versions: Node 22.16.0, npm 10.9.2, installed TypeScript 5.8.3, Python Playwright 1.57.0 and system Chromium 144.0.7559.96. CI uses the lockfile's TypeScript 5.9.3/Vite 6.4.3 and Playwright's managed Chromium; those distinctions matter.

## Not verified here

**Actual Vite production build:** not run successfully because the pinned dependencies could not be installed through the environment's unavailable npm-registry DNS. Vite is not installed locally. No placeholder build or synthetic fixture is presented as a production build.

**Native-browser demand integration:** attempted at `/cod2.ts/`; Chromium rejected localhost navigation with `net::ERR_BLOCKED_BY_ADMINISTRATOR`. The test failed before executing its browser checks. No browser-policy bypass was attempted. The production launcher smoke test likewise remains unverified until the normal CI runner builds and executes it.

**GitHub execution and deployment:** the workflow is prepared, not demonstrated by a completed Actions run. No remote repository, settings, secrets, payment account or Pages site was created. The owner must push, inspect the first real run and enable Pages only after `Verified` passes. A YAML parse, pinned action references or a local source-test pass is not a live deployment result.

**Real gameplay and speed:** not measured. Synthetic fixtures do not prove complete retail map, animation, weapon, material, sound or multiplayer behavior. See [Compatibility](COMPATIBILITY.md) and [Performance](PERFORMANCE.md). Existing compatibility gaps remain.

## Reproduce the full intended CI path

```sh
npm ci
npm run verify
npm run verify:docs
python -m pip install -r tools/tests/requirements.txt
python -m playwright install --with-deps chromium
npm run verify:ui
COD2_BASE_PATH=/cod2.ts/ npm run build:bundle
npm run verify:site -- --base /cod2.ts/
npm run verify:demand-browser -- --base /cod2.ts/ --dist temp/dist
```

Also repeat the production build/site/native suite with `/`. GitHub's workflow enforces both layouts and tests the exact Pages artifact before publishing. Missing browser dependencies, failing native checks or a failed build do not count as success.

[Publishing and payment setup](GITHUB-SETUP.md) · [README](../README.md) · [Prior loader verification record](VERIFICATION.md)
