# WebTUIOS optimization notes

## v0.0.1 audit

The browser shell had two correctness problems that also created avoidable work:

1. The app forced `.xterm-screen` to `width: 100%; height: 100%`. xterm owns that
   element's cell-grid dimensions, so stretching it independently from the grid can
   desynchronise the visible screen from terminal coordinates. WebTUIOS now sizes
   only the outer `.xterm` container and leaves `.xterm-screen` untouched.
2. The project pins TUIOS v0.7.0, but the `[startup]` configuration options were
   added upstream after that release. v0.0.1 therefore removes the ignored section
   and leaves layout ownership to TUIOS.
3. The guest and host used the exact same width. A full-width frame can leave xterm
   wrap-pending on its last physical cell; a subsequent byte then appears at column
   zero. v0.0.1 reports a guest TTY that is one column narrower than the host xterm,
   leaving a safety gutter on the right and preventing this edge-wrap failure.

Runtime optimizations:

- Optional xterm WebGL renderer with automatic fallback.
- Outer xterm scrollback reduced from 10,000 to 1,000 lines because TUIOS already
  owns pane scrollback.
- TUIOS animations disabled for the browser profile.
- Locked-grid font fitting is skipped for unchanged viewport dimensions and uses
  binary search instead of scanning every font size.
- CheerpX/xterm/FitAddon updated to current stable versions used by this project.
- Production ext2 default reduced from 64 MiB to 48 MiB; writes still go to the
  IndexedDB overlay.
- Disk SHA-256 generation now streams the image instead of buffering the whole
  ext2 file in Node.js memory.

The project intentionally keeps TUIOS v0.7.0 for now because it is the latest
packaged i386 release used by the Windows no-WSL development path. Upstream main
has newer rendering/performance fixes but does not currently provide the same
release artifact workflow.
