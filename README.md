# cod2.ts

**Your files. Your browser.**

An experimental **TypeScript + WebGPU** client for your own **Call of Duty 2** installation.

[![Verify and publish](https://github.com/skillman1337/cod2.ts/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/skillman1337/cod2.ts/actions/workflows/ci.yml)

[🧭 Architecture](docs/OPERATIONS-MAP.md) · [🚧 Compatibility](docs/COMPATIBILITY.md) · [☕ Support](https://ko-fi.com/skillman1337)

> 🚧 **Work in progress.** Weapons, GSC, animations, rendering and game modes have known gaps. This is not a finished retail-compatible port.

## 🚀 Run locally

**Node.js 22.16+**, npm, and a desktop browser with WebGPU and native folder access. The launcher checks browser support.

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open the printed URL. Select your game folder containing **`main/*.iwd`** and your language archives. No executable needed.

## ⚡ Menu first. Maps when needed.

| When            | What happens                                                |
| --------------- | ----------------------------------------------------------- |
| 📂 First launch | Index archives and prepare the menu—not every map.          |
| 🗺️ Pick a map   | Prepare that world and resolve its shared assets on demand. |
| 💾 Return       | Reuse completed cache entries. Skip repeated conversion.    |

**🔒 Your game files stay on your device.** No asset uploads or writes to your installation.

Cache hits can still require GPU upload or audio decoding. Uncached content may need folder permission again. Clearing browser storage removes the cache.

## 🛠️ Development

```sh
npm run verify   # Source + synthetic loader checks
npm run build    # Production build
npm run preview -- --host 127.0.0.1 --port 5173 --strictPort
```

Stop the dev server before previewing on the same port.

🧪 **GitHub Actions** checks source, production builds and browser loading at `/` and `/cod2.ts/`. Synthetic tests do not certify full retail compatibility.

🌐 **GitHub Pages:** select **GitHub Actions** as the Pages source and set the repository variable **`ENABLE_PAGES=true`**. [Publishing guide →](docs/GITHUB-SETUP.md)

## 🧭 Under the hood

[Loading architecture](docs/LOADING-ARCHITECTURE.md) · [Source-linked call map](docs/OPERATIONS-MAP.md) · [Performance](docs/PERFORMANCE.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## ⚖️ License & disclaimer

Code: **[GPL-3.0-only](LICENSE)**. [Third-party notices](THIRD_PARTY_NOTICES.md) apply. Provided without warranty.

**Call of Duty 2, its content and trademarks belong to their respective rights holders.** Unofficial; not affiliated with or endorsed by Activision, Infinity Ward or id Software.

Bring your own lawfully acquired files. No retail assets are distributed or licensed by this project. Maintainers must verify provenance and redistribution rights before release.

## ☕ Support development

Found a bug? Tested a map? Have a patch? Contributions welcome.

**[Buy me a coffee on Ko-fi →](https://ko-fi.com/skillman1337)**

Tips support independent development—not game content, access or promised features. No payment account or wallet is required to play. [Details](docs/SUPPORT.md).
