import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeLocalImageConfig, writeCloudDevConfig } from './write-image-config.mjs';
import { ensureDevTuios } from './prepare-tuios-dev.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const imagePath = path.join(root, 'public', 'webtuios.ext2');

let hasImage = false;
try {
  const info = await stat(imagePath);
  hasImage = info.size >= 8 * 1024 * 1024;
} catch {}

if (hasImage) {
  await writeLocalImageConfig();
} else {
  await ensureDevTuios();
  await writeCloudDevConfig();
}
