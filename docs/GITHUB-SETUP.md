# Publish cod2.ts on GitHub

Prepared for **skillman1337/cod2.ts**. This guide does not mean the repository, Pages site or payment accounts already exist. Source verification works independently of deployment and financial support.

## 1. Review and create the repository

A period is allowed in a repository name; `cod2.ts` does not need to become `cod2-ts`. This package's intended URLs use `skillman1337/cod2.ts`. GitHub itself hosts dotted names such as [three.js](https://github.com/mrdoob/three.js).

Before publishing, review [LICENSE](../LICENSE), [third-party notices](../THIRD_PARTY_NOTICES.md), provenance and [Compatibility](COMPATIBILITY.md). A disclaimer is not permission to distribute somebody else's content. No game archive, executable, converted retail media, actual font file, private trace, payment secret or local folder is needed in the repository.

Create an **empty repository** named `cod2.ts` under your account. Do not initialize another README, license or gitignore; these are supplied. A public repository is the straightforward free-Pages option; private-repository Pages availability depends on your plan. See [GitHub's custom-workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) and [creating a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository).

From the extracted project directory, containing `package.json` and `.github/`:

```sh
git init -b main
git add .
node tools/verify/verify_release.mjs
git diff --cached --stat
git commit -m "Prepare cod2.ts source, verification and Pages deployment"
git remote add origin https://github.com/skillman1337/cod2.ts.git
git push -u origin main
```

Use your normal GitHub authentication; do not paste credentials into repository files. If this is already a Git working tree, retain its history and configured remote rather than reinitializing blindly. `.gitignore` does not remove previously tracked secrets or media. Review the staged files before pushing. GitHub CLI or Git preserves hidden `.github` files; a manual upload must include them too.

## 2. Let verification run first

In **Actions**, open **Verify and publish**. The initial push to `main` runs source checks and browser builds at both `/` and `/cod2.ts/`. `Verified` is the single aggregate check to require for merging. Deployment stays skipped until explicitly enabled.

The workflow installs Node 22, Python 3.12 and pinned Playwright, then downloads its matching Chromium. Tests use original synthetic assets. It never asks you to upload retail IWD files. TypeScript and Vite remain pinned by `package-lock.json`; do not repair a red build by bypassing a failed lane.

Configure the `main` branch ruleset or branch protection to require **Verified** once the status has appeared. Prefer pull requests for changes. Disallow force pushes and branch deletion as appropriate. Review payment destination and workflow changes carefully. `.github/CODEOWNERS` names the maintainer for these paths, but the file alone does not enforce reviews. Do not require an independent approving reviewer that a solo-maintainer repository does not actually have.

Actions are pinned to full commit SHAs, credentials are not persisted by checkout, and deployment write permissions are isolated from test jobs. There is no `pull_request_target` execution of untrusted pull-request code. Dependabot proposes updates for npm, actions and Python test dependencies. See [GitHub Actions security guidance](https://docs.github.com/en/actions/reference/security/secure-use).

## 3. Enable Pages when verification is green

1. Open **Settings → Pages → Build and deployment** and set **Source: GitHub Actions**. Save if prompted. You do not need a `gh-pages` branch or a second generated workflow.
2. Open **Settings → Secrets and variables → Actions → Variables**. Add a **repository variable**, not a secret: name `ENABLE_PAGES`, value `true` (lowercase).
3. Open **Actions → Verify and publish → Run workflow**, select `main`, and run. Future pushes to `main` also verify and deploy automatically while that variable is enabled.
4. Check the **Deploy GitHub Pages** job and its deployment URL. In **Settings → Environments → github-pages**, restrict deployments to `main` as appropriate for the account's available settings.

Expected project URL, after a successful deployment:

```text
https://skillman1337.github.io/cod2.ts/
```

No personal access token, cloud account or payment credential is required. The workflow uses GitHub's built-in token and Pages identity permissions. The `configure-pages` action reads the actual base path; the artifact is rebuilt and tested for that path before deployment. Deleting or disabling `ENABLE_PAGES` stops future publication jobs; it does not automatically unpublish an already deployed site. Use Pages settings to unpublish when needed. [Official workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Only `temp/dist/` is uploaded. It contains code, launcher art, license notices and `build-info.json`, which records the source revision and exact source URL during GitHub builds. No local game files are available to GitHub Actions. The deployed site serves a client, not a multiplayer server. Do not describe Pages deployment as proof of retail gameplay compatibility.

## 4. Understand subpaths and cache boundaries

Vite's `base` alone is insufficient here: worker entrypoints, service-worker routing and engine assets also require the same prefix. The code now shares validated deployment paths, scopes the worker to the app path and uses path-specific IndexedDB/OPFS names. Runtime asset identities remain canonical; HTTP requests acquire the deployment prefix at the boundary. This preserves sharing across consumers without turning every archive filename into a hosting URL.

Root hosting retains the original logical storage names. A different origin, base path or browser profile uses a different cache. Moving from localhost to Pages therefore requires local setup on the Pages origin; no automatic migration or upload is implied. Browser storage can be evicted, and uncached content may need renewed source permission.

All project paths on `skillman1337.github.io` share an origin. Path-specific storage names avoid accidental mixing; they are **not a protection against malicious same-origin JavaScript**. Keep that origin trusted. A dedicated domain can separate origins. See [MDN: same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy).

### Test the Pages layout locally

POSIX shell:

```sh
npm ci
COD2_BASE_PATH=/cod2.ts/ npm run build
npm run verify:site -- --base /cod2.ts/
COD2_BASE_PATH=/cod2.ts/ npm run preview -- --host 127.0.0.1 --port 5173 --strictPort
```

PowerShell:

```powershell
npm ci
$env:COD2_BASE_PATH = '/cod2.ts/'
npm run build
npm run verify:site -- --base /cod2.ts/
npm run preview -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173/cod2.ts/`. Keep the base environment when starting preview. Test roots separately with `COD2_BASE_PATH=/`. GitHub Pages does not provide custom COOP/COEP headers in this configuration, and the synthetic test server intentionally does not add them. WebGPU availability still depends on the visitor's browser, device and policies. [Vite deployment guidance](https://vite.dev/guide/static-deploy.html).

## 5. Activate financial support separately

Nothing in the package names a receiving wallet or assumes that your GitHub name is your payment-provider handle. `.github/FUNDING.yml` is commented out. The README bottom links to [Support](SUPPORT.md) and explicitly says payments are not enabled.

### Fiat: GitHub Sponsors or Ko-fi

**GitHub Sponsors** is the repository-native route once your account is approved. Check eligibility for your actual country/region of residence and payout arrangement. Complete the profile, payout/bank and tax information, enable 2FA and submit for approval. Your GitHub account existing does not mean it can already receive sponsorships. [Official account setup](https://docs.github.com/en/sponsors/receiving-sponsorships-through-github-sponsors/setting-up-github-sponsors-for-your-personal-account).

After approval, uncomment this entry and confirm that the page belongs to you:

```yaml
github: [skillman1337]
```

**Ko-fi** is another simple link-based route: create your creator account, connect your eligible PayPal or Stripe receiving account and choose the currency. Confirm the receiving name, live URL, withdrawal support and current platform/processing fees. Your Ko-fi handle need not equal your GitHub handle. [Getting started](https://help.ko-fi.com/hc/en-us/articles/360014098514-Getting-started-on-Ko-fi) · [Payment flow](https://help.ko-fi.com/hc/en-us/articles/115003980093-How-do-I-get-paid) · [Fees](https://help.ko-fi.com/hc/en-us/articles/360002506494-Does-Ko-fi-take-a-fee).

Then set `ko_fi` to your **actual confirmed handle**, not a template string. Add the same confirmed destination to the README/Support page, remove the inactive wording, and open the link logged out to verify it. You may enable one provider without waiting for the other.

### Crypto: verified receive address or hosted checkout

For a minimal setup, create a wallet you control and copy its **public receive address**. Publish only the address, exact asset and exact network in `docs/SUPPORT.md`; verify the address independently and perform a small test first. A Bitcoin on-chain address, a Lightning invoice and an address on another blockchain are not interchangeable. No private key, seed phrase, wallet backup, API secret or extended private key belongs in GitHub or Actions.

A static Bitcoin donation address is simple but publicly links transactions to the project and reusing it has privacy costs. Transactions cannot generally be reversed. For rotating invoices or a more private checkout, use an appropriately hosted payment service; **BTCPay Server** offers payment/donation apps but needs its own server or trusted host, not just GitHub Pages. Start with links, not a wallet-connect widget in the game launcher. [Bitcoin security/privacy guidance](https://bitcoin.org/en/you-need-to-know) · [BTCPay apps](https://docs.btcpayserver.org/Apps/).

Only a confirmed **HTTPS** payment-page URL belongs in FUNDING's `custom` list. Keep raw addresses with their network label in Support; never invent a plausible wallet as a placeholder. GitHub supports multiple funding providers and custom URLs through `.github/FUNDING.yml`; ensure **Sponsorships** is enabled in repository Features. [Sponsor-button documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/displaying-a-sponsor-button-in-your-repository).

These are voluntary tips for independent software development, not sales of retail content, purchases of access or promises of completion. Do not describe them as tax-deductible charitable donations. Check your own reporting obligations and provider terms. Use a provider-hosted checkout; never collect card details or put payment secrets on a static Pages site. [Pages limits and permitted usage](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

## Stop points

Do not enable Pages while `Verified` is red. Do not activate a payment link before confirming the recipient. Do not publish content whose provenance is unresolved. Do not mark retail compatibility or speed claims as verified based solely on the synthetic suite. See [this implementation's verification record](GITHUB-VERIFICATION.md).
