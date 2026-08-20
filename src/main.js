import * as CheerpX from '@leaningtech/cheerpx';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import './style.css';
import { IMAGE_MODE, IMAGE_URL, OVERLAY_ID, BOOT_MODE } from './image.generated.js';

const terminalElement = document.getElementById('terminal');
const encoder = new TextEncoder();
const NERD_FONT_FAMILY = 'WebTUIOS Nerd Font';
const NERD_FONT_SPEC = `400 14px "${NERD_FONT_FAMILY}"`;
const NERD_FONT_BOLD_SPEC = `700 14px "${NERD_FONT_FAMILY}"`;
const FONT_LOAD_TIMEOUT_MS = 5000;
const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 5;
const MIN_STABLE_FONT_SIZE = 6;
const MAX_STABLE_FONT_SIZE = 16;
const TAILSCALE_RUNNING = 6;
const OUTER_SCROLLBACK_LINES = 1000;
const HOST_GUARD_COLS = 1;

let terminal;
let fitAddon;
let cxInstance = null;
let sendInput = null;
let fitFrame = 0;
let hostCols = 0;
let hostRows = 0;
let guestCols = 0;
let guestRows = 0;
let guestGeometryLocked = false;
let responsiveHandlersInstalled = false;
let prebootInputHandler = null;
let pendingLoginUrl = null;
let loginActionResolve = null;
let loginUrlResolve;
let networkRunningResolve;
let networkState = null;
let networkIp = null;
let lastLockedViewportKey = '';
let webglAddon = null;

const loginUrlPromise = new Promise((resolve) => {
  loginUrlResolve = resolve;
});
const networkRunningPromise = new Promise((resolve) => {
  networkRunningResolve = resolve;
});

const BROWSER_SHORTCUTS_TO_TERMINAL = new Set([
  'p', 'r', 'l', 'f', 's', 'w', 't', 'n'
]);

function timeout(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('timeout')), ms);
  });
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function loadNerdFont() {
  if (!document.fonts) return false;

  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(NERD_FONT_SPEC),
        document.fonts.load(NERD_FONT_BOLD_SPEC)
      ]),
      timeout(FONT_LOAD_TIMEOUT_MS)
    ]);

    return document.fonts.check(NERD_FONT_SPEC) &&
      document.fonts.check(NERD_FONT_BOLD_SPEC);
  } catch (error) {
    console.warn('WebTUIOS: Nerd Font unavailable; using TUIOS ASCII fallback.', error);
    return false;
  }
}

function getVisualViewportRect() {
  const viewport = window.visualViewport;
  if (viewport) {
    return {
      width: Math.max(1, viewport.width),
      height: Math.max(1, viewport.height),
      left: viewport.offsetLeft,
      top: viewport.offsetTop
    };
  }

  return {
    width: Math.max(1, document.documentElement.clientWidth || window.innerWidth),
    height: Math.max(1, document.documentElement.clientHeight || window.innerHeight),
    left: 0,
    top: 0
  };
}

function responsiveFontSize(width, height) {
  let size = 14;
  if (width <= 360) size = 11;
  else if (width <= 480) size = 12;
  else if (width <= 768) size = 13;

  if (height <= 430) size = Math.min(size, 11);
  else if (height <= 560) size = Math.min(size, 12);

  return size;
}

function updateViewportCSSVars() {
  const rect = getVisualViewportRect();
  const root = document.documentElement;
  root.style.setProperty('--app-width', `${rect.width}px`);
  root.style.setProperty('--app-height', `${rect.height}px`);
  root.style.setProperty('--app-left', `${rect.left}px`);
  root.style.setProperty('--app-top', `${rect.top}px`);
}

function sendGuestData(data) {
  if (!sendInput) return;
  const bytes = encoder.encode(data);
  for (const byte of bytes) sendInput(byte);
}

function writeConsole(buffer, vt) {
  if (vt !== 1 || !terminal) return;
  terminal.write(new Uint8Array(buffer));
}

function fitUnlockedTerminal() {
  const { width, height } = getVisualViewportRect();
  const nextFontSize = responsiveFontSize(width, height);
  if (terminal.options.fontSize !== nextFontSize) {
    terminal.options.fontSize = nextFontSize;
  }
  fitAddon.fit();
  return true;
}

function fitLockedTerminal() {
  // Never call fitAddon.fit() after setCustomConsole(). CheerpX and xterm must
  // keep exactly the same immutable character grid for this VM boot.
  const rect = getVisualViewportRect();
  const viewportKey = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
  if (viewportKey === lastLockedViewportKey &&
      terminal.cols === hostCols && terminal.rows === hostRows) {
    return false;
  }
  lastLockedViewportKey = viewportKey;
  const previousFontSize = terminal.options.fontSize;
  let geometryRecovered = false;

  // Find the largest font that still fits the immutable guest grid. Use a
  // binary search rather than walking every size on each ResizeObserver tick.
  let low = MIN_STABLE_FONT_SIZE;
  let high = MAX_STABLE_FONT_SIZE;
  let chosen = MIN_STABLE_FONT_SIZE;

  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    terminal.options.fontSize = size;
    const proposed = fitAddon.proposeDimensions?.();

    if (proposed && proposed.cols >= hostCols && proposed.rows >= hostRows) {
      chosen = size;
      low = size + 1;
    } else {
      high = size - 1;
    }
  }

  if (terminal.options.fontSize !== chosen) terminal.options.fontSize = chosen;

  if (terminal.cols !== hostCols || terminal.rows !== hostRows) {
    console.error(
      `WebTUIOS: xterm geometry drifted (${terminal.cols}x${terminal.rows}); ` +
      `expected host ${hostCols}x${hostRows}`
    );
    terminal.resize(hostCols, hostRows);
    geometryRecovered = true;
  }

  return geometryRecovered || terminal.options.fontSize !== previousFontSize;
}

function fitTerminal() {
  if (!terminal || !fitAddon) return;
  updateViewportCSSVars();

  const changed = guestGeometryLocked
    ? fitLockedTerminal()
    : fitUnlockedTerminal();

  if (changed && terminal.rows > 0) terminal.refresh(0, terminal.rows - 1);
}

function queueFit() {
  if (fitFrame) cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    fitTerminal();
  });
}

function installResponsiveViewportHandlers() {
  if (responsiveHandlersInstalled) return;
  responsiveHandlersInstalled = true;
  updateViewportCSSVars();

  const resizeObserver = new ResizeObserver(queueFit);
  resizeObserver.observe(terminalElement);

  window.addEventListener('resize', queueFit, { passive: true });
  window.addEventListener('orientationchange', () => {
    queueFit();
    window.setTimeout(queueFit, 120);
    window.setTimeout(queueFit, 320);
  }, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', queueFit, { passive: true });
    window.visualViewport.addEventListener('scroll', queueFit, { passive: true });
  }
}

async function createTerminal(nerdFontReady) {
  const { width, height } = getVisualViewportRect();
  terminal = new Terminal({
    cursorBlink: true,
    convertEol: true,
    // TUIOS owns pane scrollback. Keeping a second 10k-line history in the
    // outer xterm only duplicates memory and work during full-screen redraws.
    scrollback: OUTER_SCROLLBACK_LINES,
    fontFamily: nerdFontReady
      ? `"${NERD_FONT_FAMILY}", monospace`
      : 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontWeight: 400,
    fontWeightBold: 700,
    fontSize: responsiveFontSize(width, height),
    lineHeight: 1,
    letterSpacing: 0,
    theme: {
      background: '#000000',
      foreground: '#f4f4f5',
      cursor: '#f4f4f5',
      cursorAccent: '#000000'
    }
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalElement);

  // Prefer GPU-backed terminal rendering for TUIOS' redraw-heavy frames.
  // WebGL is an optimization only; xterm's DOM/canvas renderer remains the
  // automatic fallback when the browser/GPU cannot create a context.
  try {
    webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      console.warn('WebTUIOS: WebGL context lost; falling back to xterm renderer.');
      webglAddon?.dispose();
      webglAddon = null;
    });
    terminal.loadAddon(webglAddon);
  } catch (error) {
    webglAddon = null;
    console.warn('WebTUIOS: WebGL renderer unavailable; using xterm fallback.', error);
  }

  // Let xterm/font/layout settle before taking the one and only guest geometry.
  // No ResizeObserver is installed until after setCustomConsole().
  updateViewportCSSVars();
  fitUnlockedTerminal();
  await nextFrame();
  await nextFrame();
  fitUnlockedTerminal();
  terminal.focus();

  terminal.attachCustomKeyEventHandler((event) => {
    const key = event.key.toLowerCase();
    const ctrlOrMeta = event.ctrlKey || event.metaKey;

    if (ctrlOrMeta && !event.altKey && BROWSER_SHORTCUTS_TO_TERMINAL.has(key)) {
      event.preventDefault();
      return true;
    }

    if (event.altKey && !event.ctrlKey && !event.metaKey &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      return true;
    }

    return true;
  });

  terminal.onData((data) => {
    if (prebootInputHandler && prebootInputHandler(data)) return;
    sendGuestData(data);
  });

  const refocusTerminal = () => {
    terminal.focus();
    if (pendingLoginUrl) openPendingLogin();
  };
  terminalElement.addEventListener('pointerdown', refocusTerminal);
  terminalElement.addEventListener('click', () => terminal.focus());
}

function attachCheerpXConsole() {
  if (!cxInstance || !terminal || sendInput) return;
  if (terminal.cols - HOST_GUARD_COLS < MIN_TERMINAL_COLS || terminal.rows < MIN_TERMINAL_ROWS) {
    throw new Error(`Terminal is too small: ${terminal.cols}x${terminal.rows}`);
  }

  // Keep one host-only guard column to the right of the guest. Full-screen TUI
  // renderers frequently write exactly their reported width; on xterm that can
  // leave DECAWM wrap-pending on the physical last cell and make the next byte
  // appear at column 0. The spare cell prevents that outer-terminal wrap while
  // TUIOS still receives a normal, rectangular TTY.
  hostCols = terminal.cols;
  hostRows = terminal.rows;
  guestCols = hostCols - HOST_GUARD_COLS;
  guestRows = hostRows;
  sendInput = cxInstance.setCustomConsole(writeConsole, guestCols, guestRows);
  guestGeometryLocked = true;

  // From this point onward the host xterm cols/rows are immutable for this VM boot.
  installResponsiveViewportHandlers();
  fitLockedTerminal();
}

function writeLine(message = '') {
  terminal.write(`${message}\r\n`);
}

async function createBaseDisk() {
  if (IMAGE_MODE === 'cloud') {
    return CheerpX.CloudDevice.create(IMAGE_URL);
  }

  const imageProbe = await fetch(IMAGE_URL, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
    cache: 'no-cache'
  });
  if (!imageProbe.ok && imageProbe.status !== 206) {
    throw new Error(`Failed to load ${IMAGE_URL}: HTTP ${imageProbe.status}`);
  }
  const contentType = imageProbe.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error(`${IMAGE_URL} resolved to HTML instead of the ext2 image`);
  }
  await imageProbe.body?.cancel();
  return CheerpX.HttpBytesDevice.create(IMAGE_URL);
}

function readNetworkOptionsFromFragment() {
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  const params = new URLSearchParams(raw);
  const controlUrl = params.get('controlUrl')?.trim() || undefined;
  const authKey = params.get('authKey')?.trim() || undefined;

  // authKey is kept only as a backwards-compatible escape hatch. Normal
  // WebTUIOS use is interactive login and needs no key in the URL.
  if (authKey) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }

  return { controlUrl, authKey };
}

function validateLoginUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported Tailscale login URL: ${parsed.protocol}`);
  }
  return parsed.href;
}

function createNetworkInterface() {
  const { controlUrl, authKey } = readNetworkOptionsFromFragment();
  const networkInterface = {
    loginUrlCb(url) {
      try {
        pendingLoginUrl = validateLoginUrl(url);
        loginUrlResolve(pendingLoginUrl);
      } catch (error) {
        console.error('WebTUIOS: invalid Tailscale login URL', error);
      }
    },
    stateUpdateCb(state) {
      networkState = state;
      console.info(`WebTUIOS network state: ${state}`);
      if (state === TAILSCALE_RUNNING) {
        pendingLoginUrl = null;
        networkRunningResolve(true);
      }
    },
    netmapUpdateCb(map) {
      networkIp = map?.self?.addresses?.[0] || null;
      if (networkIp) console.info(`WebTUIOS Tailscale IP: ${networkIp}`);
    }
  };

  if (controlUrl) networkInterface.controlUrl = controlUrl;
  if (authKey) networkInterface.authKey = authKey;
  return networkInterface;
}

function openPendingLogin() {
  if (!pendingLoginUrl) return false;
  const url = pendingLoginUrl;
  const popup = window.open(url, '_blank', 'noopener,noreferrer');
  if (!popup) return false;
  pendingLoginUrl = null;
  if (loginActionResolve) {
    const resolve = loginActionResolve;
    loginActionResolve = null;
    resolve('opened');
  }
  terminal.clear();
  writeLine('Tailscale login opened in a new tab.');
  writeLine('Finish authentication there, then return to this tab.');
  writeLine('Waiting for the Tailnet connection...');
  return true;
}

function waitForLoginAction(url) {
  pendingLoginUrl = url;
  terminal.clear();
  writeLine('WebTUIOS needs Tailscale authentication for TCP/IP networking.');
  writeLine('');
  writeLine('Press Enter (or click the terminal) to open the Tailscale login page.');
  writeLine('Press S to skip networking for this boot.');
  writeLine('');
  writeLine('After the first successful login, WebTUIOS will try to reconnect');
  writeLine('with the browser-stored Tailscale state on later boots.');

  return new Promise((resolve) => {
    loginActionResolve = resolve;
    prebootInputHandler = (data) => {
      if (data === '\r' || data === '\n') {
        if (!openPendingLogin()) {
          writeLine('Popup was blocked. Click the terminal to open the login page.');
        }
        return true;
      }

      if (data.toLowerCase() === 's' || data === '\x1b') {
        pendingLoginUrl = null;
        loginActionResolve = null;
        prebootInputHandler = null;
        resolve('skip');
        return true;
      }

      return true;
    };
  }).finally(() => {
    loginActionResolve = null;
    prebootInputHandler = null;
  });
}

async function connectNetworkBeforeBoot() {
  terminal.clear();
  writeLine('Starting WebTUIOS networking...');

  let loginCall;
  try {
    loginCall = Promise.resolve(cxInstance.networkLogin()).catch((error) => {
      console.warn('WebTUIOS: Tailscale networkLogin failed', error);
      return false;
    });
  } catch (error) {
    console.warn('WebTUIOS: Tailscale networkLogin failed', error);
    return false;
  }

  const first = await Promise.race([
    networkRunningPromise.then(() => ({ kind: 'running' })),
    loginUrlPromise.then((url) => ({ kind: 'login', url })),
    new Promise((resolve) => setTimeout(() => resolve({ kind: 'slow' }), 12_000))
  ]);

  if (first.kind === 'running') {
    localStorage.setItem('webtuios.tailscale.connected', '1');
    return true;
  }

  if (first.kind === 'slow') {
    writeLine('Tailscale is still starting; continuing with local-only Linux.');
    void loginCall;
    return false;
  }

  const action = await waitForLoginAction(first.url);
  if (action === 'skip') return false;

  try {
    await Promise.race([networkRunningPromise, timeout(10 * 60 * 1000)]);
    localStorage.setItem('webtuios.tailscale.connected', '1');
    terminal.clear();
    writeLine(networkIp
      ? `Tailscale connected: ${networkIp}`
      : 'Tailscale connected.');
    await new Promise((resolve) => setTimeout(resolve, 250));
    return true;
  } catch {
    writeLine('Tailscale login timed out; continuing with local-only Linux.');
    return false;
  }
}

async function boot(nerdFontReady) {
  if (!crossOriginIsolated) {
    throw new Error('Cross-origin isolation is disabled. COOP/COEP headers are required for CheerpX.');
  }

  terminal.write('Booting WebTUIOS...\r\n');

  const baseDisk = await createBaseDisk();
  const overlayStore = await CheerpX.IDBDevice.create(OVERLAY_ID);
  const rootDisk = await CheerpX.OverlayDevice.create(baseDisk, overlayStore);
  const webDevice = await CheerpX.WebDevice.create('');

  const mounts = [
    { type: 'ext2', path: '/', dev: rootDisk },
    { type: 'dir', path: '/web', dev: webDevice },
    { type: 'devs', path: '/dev' },
    { type: 'devpts', path: '/dev/pts' },
    { type: 'proc', path: '/proc' },
    { type: 'sys', path: '/sys' }
  ];

  const networkInterface = createNetworkInterface();
  cxInstance = await CheerpX.Linux.create({ mounts, networkInterface });
  attachCheerpXConsole();

  // Interactive login is client-only. No Vercel Function/proxy is involved.
  await connectNetworkBeforeBoot();

  // Reset xterm's parser/wrap state after the pre-boot networking messages so
  // TUIOS always starts from a completely clean terminal state.
  terminal.reset();
  terminal.clear();
  terminal.resize(hostCols, hostRows);
  terminal.refresh(0, hostRows - 1);
  terminal.focus();

  const env = [
    'HOME=/root',
    'USER=root',
    'LOGNAME=root',
    'SHELL=/bin/sh',
    'TERM=xterm-256color',
    'COLORTERM=truecolor',
    'LANG=C.UTF-8',
    'LC_ALL=C.UTF-8',
    `COLUMNS=${guestCols}`,
    `LINES=${guestRows}`,
    'XDG_CONFIG_HOME=/root/.config',
    'XDG_CACHE_HOME=/root/.cache',
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  ];

  const tuiosArgs = [
    '--no-animations',
    ...(nerdFontReady ? [] : ['--ascii-only'])
  ];

  let command = '/usr/local/bin/webtuios';
  let args = tuiosArgs;
  if (BOOT_MODE === 'web-binary') {
    command = '/bin/sh';
    args = [
      '-c',
      'mkdir -p /root/.config/tuios /root/.cache /tmp/webtuios && cp /web/tuios /tmp/webtuios/tuios && cp /web/webtuios-config.toml /root/.config/tuios/config.toml && chmod 755 /tmp/webtuios/tuios && exec /tmp/webtuios/tuios "$@"',
      'webtuios',
      ...tuiosArgs
    ];
  }

  const runPromise = cxInstance.run(command, args, {
    cwd: '/root',
    uid: 0,
    gid: 0,
    env
  });

  const result = await runPromise;
  writeLine(`WebTUIOS exited with status ${result.status}. Reload the page to restart.`);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
      console.warn('WebTUIOS: service worker registration failed', error);
    });
  });
}

async function main() {
  registerServiceWorker();
  updateViewportCSSVars();
  const nerdFontReady = await loadNerdFont();
  await createTerminal(nerdFontReady);

  try {
    await boot(nerdFontReady);
  } catch (error) {
    console.error(error);
    terminal.write('\x1b[31mWebTUIOS failed to boot.\x1b[0m\r\n');
    terminal.write(`${error?.stack || error}\r\n`);
    terminal.focus();
  }
}

main();
