# WebTUIOS

A console-only CSR/PWA that runs TUIOS on Alpine Linux in the browser through CheerpX and xterm.js.

There is no application chrome: the page is the terminal.

## Run locally on Windows (no WSL required)

```powershell
npm install
npm run dev
```

When `public/webtuios.ext2` is absent, development uses WebVM's public Alpine image and downloads the pinned upstream TUIOS Linux i386 release to `public/tuios`.

## Production / Vercel

```text
Build command: npm run build
Output directory: dist
```

The Vercel build generates a custom ext2 image containing Alpine Linux, TUIOS, and the WebTUIOS browser profile. COOP/COEP headers are included in `vercel.json` for CheerpX/SharedArrayBuffer.

## Terminal geometry

The xterm grid is fitted once before CheerpX attaches its custom console. From that point the guest `cols x rows` are immutable for the VM boot.

Viewport/PWA resizes only change font metrics. WebTUIOS never calls `FitAddon.fit()` after `setCustomConsole()`, and it no longer overrides `.xterm-screen` dimensions in CSS. xterm therefore remains the single authority for its screen/cell geometry.

TUIOS v0.7.0 predates the `[startup]` configuration section, so WebTUIOS v0.0.1 removes those unsupported settings instead of pretending they are active. Window placement remains controlled by TUIOS itself.

WebTUIOS also reserves one host-only xterm column on the right. The guest TTY is reported as one column narrower than the outer xterm grid, preventing a full-width TUI frame from leaving xterm in wrap-pending state and spilling the next bytes back to physical column 0. This also keeps a one-cell safety gutter between TUIOS' rightmost edge and the browser viewport.

## Browser-safe TUIOS keys

`public/webtuios-config.toml` contains only settings supported by the pinned TUIOS release.

| Action | WebTUIOS key |
| --- | --- |
| Leader | `Ctrl+B` |
| Leave Terminal Mode | `Alt+Q` |
| Next / previous window | `Alt+N` / `Alt+P` |
| Tiling toggle | `Ctrl+B`, then `Space` |
| Command Palette | `Ctrl+P` or `Ctrl+B`, then `P` |
| Help | `Ctrl+B`, then `?` |

## Performance profile

WebTUIOS uses xterm's WebGL renderer when available and automatically falls back if WebGL cannot be initialized or the context is lost. The outer xterm history is intentionally small because TUIOS already maintains its own pane scrollback, and TUIOS animations are disabled in the browser profile to reduce redraw work under x86/WASM emulation.

See `OPTIMIZATION.md` for the audit notes.

## Client-side TCP/IP networking

WebTUIOS configures `/etc/resolv.conf` with public DNS resolvers after an Exit Node becomes available. Alpine minirootfs does not inherit a host resolver configuration on its own, so this is required for `apk`, `wget`, Git, and other hostname-based network access.


Networking stays fully CSR. CheerpX supplies the browser-side TCP/IP stack and uses Tailscale as its transport; no Vercel Function or WebTUIOS proxy is added.

Normal use does not need `#authKey=...`. On a boot that needs authentication, WebTUIOS shows a terminal-only prompt. Press Enter (or click the terminal) and the Tailscale login page opens in a new tab. Later boots call `networkLogin()` again so CheerpX/Tailscale can reuse browser-side state while it remains valid.

`#authKey=` remains accepted only as a backwards-compatible escape hatch. Headscale can be selected with:

```text
https://your-webtuios.example/#controlUrl=https://headscale.example.com
```

To access the public internet (`apk`, `curl`, `git`, `ssh`, etc.), use an Exit Node in the same tailnet. WebTUIOS now waits for `netmapUpdateCb()` to report an advertised Exit Node before it treats public Internet routing as ready; Tailnet `Running` alone is not considered sufficient. Use `curl` or `wget` rather than ICMP/ping for connectivity tests.

The Alpine guest hostname is `Riyo-WebTUIOS`. CheerpX's documented `NetworkInterface` API does not currently expose a Tailscale hostname option, so the Tailnet machine may initially appear with the WASM-side name `js`. Rename that machine once in the Tailscale admin console to `Riyo-WebTUIOS` and disable automatic regeneration from the OS hostname if you want the Tailnet name to stay fixed.

## PWA

WebTUIOS includes a web app manifest, icons, and a small service worker, so HTTPS deployments such as Vercel can be installed as a standalone PWA.

The PWA intentionally does not cache the ext2 image or CheerpX runtime. Browser-side filesystem writes persist through the CheerpX IndexedDB overlay.

## Open source and licensing

The WebTUIOS source in this repository is MIT-licensed. TUIOS is also MIT-licensed.

The complete deployed stack is not 100% FOSS because CheerpX is proprietary. See `THIRD_PARTY_NOTICES.md` and the current CheerpX terms before publishing. The generated Alpine rootfs also contains software under multiple licenses.

## Credits

- TUIOS by Gaurav Gosain
- CheerpX / WebVM technology by Leaning Technologies
- xterm.js by the xterm.js contributors
- Nerd Fonts / JetBrains Mono Nerd Font for terminal glyph coverage

## v0.0.1 changes

- Removed the CSS rule that stretched `.xterm-screen` independently from xterm's cell grid.
- Removed unsupported TUIOS v0.7 `[startup]` settings instead of relying on settings that the release ignores.
- Added a one-column host guard gutter to prevent right-edge autowrap from spilling TUI content to the physical left edge.
- Added optional xterm WebGL rendering with fallback.
- Reduced duplicate outer scrollback and disabled TUIOS animations for browser performance.
- Reduced redundant locked-grid resize work.
- Updated CheerpX/xterm/FitAddon and moved the frontend build to Vite 8.
- Reduced the production base image default to 48 MiB and made image hashing streaming.
- Kept networking fully CSR with interactive Tailscale login.
