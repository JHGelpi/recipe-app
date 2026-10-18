// Makes the app icons from the owner's artwork (UI spec §6). Run by hand when
// the artwork changes: `pnpm icons:make`. The outputs are committed.
// app_icon.png is a crop of the theme board: the navy rounded square sits
// inside it, with some of the board's background around it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

const SOURCE = 'apps/mobile/assets/ui/app_icon.png';
// The rounded square inside the source, in source pixels.
const CROP = { x: 66, y: 59, size: 268 };
// Corner radius of the rounded square, as a share of its side.
const RADIUS = 0.2;
// The icon's own navy, so filled corners blend with it.
const NAVY = '#101B31';
const OUTPUTS = [
  { file: 'apps/mobile/assets/icon.png', size: 1024, kind: 'square' },
  { file: 'apps/mobile/public/icons/apple-touch-icon.png', size: 180, kind: 'square' },
  { file: 'apps/mobile/public/icons/icon-192.png', size: 192, kind: 'square' },
  { file: 'apps/mobile/public/icons/icon-512.png', size: 512, kind: 'square' },
  // Android crops maskable icons to a circle: keep the art in the middle 80%.
  { file: 'apps/mobile/public/icons/icon-maskable-512.png', size: 512, kind: 'maskable' },
  { file: 'apps/mobile/assets/favicon.png', size: 48, kind: 'rounded' },
  { file: 'apps/mobile/assets/brand/mark.png', size: 256, kind: 'rounded' },
];

const source = `data:image/png;base64,${readFileSync(SOURCE).toString('base64')}`;
const browser = await chromium.launch();
const page = await browser.newPage();

for (const output of OUTPUTS) {
  const dataUrl = await page.evaluate(
    async ({ source, crop, radius, navy, size, kind }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      const inner = kind === 'maskable' ? size * 0.8 : size;
      const offset = (size - inner) / 2;
      // Square and maskable icons are full-bleed: the platform rounds them.
      if (kind !== 'rounded') {
        context.fillStyle = navy;
        context.fillRect(0, 0, size, size);
      }
      context.save();
      context.beginPath();
      context.roundRect(offset, offset, inner, inner, inner * radius);
      context.clip();
      context.drawImage(image, crop.x, crop.y, crop.size, crop.size, offset, offset, inner, inner);
      context.restore();
      return canvas.toDataURL('image/png');
    },
    { source, crop: CROP, radius: RADIUS, navy: NAVY, size: output.size, kind: output.kind },
  );
  mkdirSync(dirname(output.file), { recursive: true });
  writeFileSync(output.file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`wrote ${output.file} (${output.size})`);
}
await browser.close();
