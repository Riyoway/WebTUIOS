# Third-party notices

WebTUIOS source code is licensed under the MIT License. The deployed application uses third-party components under their own terms.

## TUIOS

- Project: Gaurav-Gosain/tuios
- License: MIT
- WebTUIOS downloads the upstream Linux i386 release during image/dev preparation.
- The upstream MIT notice is preserved in `licenses/TUIOS-MIT.txt`.

## CheerpX

- Vendor: Leaning Technologies
- License: CheerpX Community License / commercial licenses as applicable
- CheerpX is proprietary software, not part of WebTUIOS' MIT grant.
- The Community License permits qualifying personal, one-person-company, FOSS, and evaluation uses subject to its terms and credit requirements.
- WebTUIOS does not intentionally self-host or redistribute the CheerpX runtime; it uses Leaning Technologies' official runtime deployment.
- Review the current terms before deployment: https://cheerpx.io/docs/licensing

## xterm.js

- Project: xtermjs/xterm.js
- License: MIT
- Copyright notices belong to the xterm.js authors and earlier contributors.

## JetBrains Mono Nerd Font / Nerd Fonts

- Project: ryanoasis/nerd-fonts
- Patched font files: SIL Open Font License 1.1 (subject to the individual font directory's notices)
- Nerd Fonts source tooling: MIT
- WebTUIOS references the Nerd Font from a public CDN; the font binary is not vendored in this repository.

## Alpine Linux root filesystem

The generated `webtuios.ext2` is built from Alpine Linux's x86 minirootfs. Alpine packages are distributed under multiple licenses. The generated image is intentionally excluded from Git so this repository does not relicense those binaries under MIT. Anyone redistributing a generated image is responsible for satisfying the licenses of the included Alpine packages, including any source/notice obligations that apply.
