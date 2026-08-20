import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TUIOS_VERSION = '0.7.0';
const TARBALL = `tuios_${TUIOS_VERSION}_Linux_i386.tar.gz`;
const URL = `https://github.com/Gaurav-Gosain/tuios/releases/download/v${TUIOS_VERSION}/${TARBALL}`;
const EXPECTED_SHA256 = 'fb040294ac384fd21f89855d37bef689feba1425530d6ffefec0cd5a088a6202';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outPath = path.join(root, 'public', 'tuios');

function readString(buf, start, length) {
  const end = buf.indexOf(0, start);
  const realEnd = end !== -1 && end < start + length ? end : start + length;
  return buf.subarray(start, realEnd).toString('utf8');
}

function extractTuiosFromTar(tar) {
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const sizeText = readString(header, 124, 12).trim().replace(/\0/g, '');
    const size = Number.parseInt(sizeText || '0', 8);
    const type = header[156];
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if ((type === 0 || type === 48) && (fullName === 'tuios' || fullName.endsWith('/tuios'))) {
      return tar.subarray(dataStart, dataEnd);
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  throw new Error('tuios binary not found in release archive');
}

export async function ensureDevTuios() {
  try {
    const s = await stat(outPath);
    if (s.size > 1024 * 1024) {
      console.log('==> Using cached public/tuios');
      return;
    }
  } catch {}

  console.log(`==> Downloading TUIOS v${TUIOS_VERSION} i386 for Windows dev fallback`);
  const response = await fetch(URL, { redirect: 'follow' });
  if (!response.ok) throw new Error(`TUIOS download failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(archive).digest('hex');
  if (actual !== EXPECTED_SHA256) {
    throw new Error(`TUIOS checksum mismatch: ${actual}`);
  }

  const binary = extractTuiosFromTar(gunzipSync(archive));
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, binary);
  console.log(`==> Wrote public/tuios (${(binary.length / 1024 / 1024).toFixed(1)} MiB)`);
}
