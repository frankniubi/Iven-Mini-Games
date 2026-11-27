/**
 * Generates launcher icons + splash screens for Android and iOS from ../assets/icon.svg (sharp/librsvg).
 *
 * Android (android/app/src/main/res):
 *   mipmap-<dpi>/ic_launcher.png             legacy icon (rounded square, as drawn in icon.svg)
 *   mipmap-<dpi>/ic_launcher_round.png       legacy round icon (circle-clipped, full-bleed background)
 *   mipmap-<dpi>/ic_launcher_foreground.png  adaptive foreground, 108dp canvas, artwork inside the 66dp safe zone
 *   mipmap-<dpi>/ic_launcher_background.png  adaptive background (the icon's gradient), 108dp canvas
 *   mipmap-anydpi-v26/ic_launcher(.xml|_round.xml)
 *   drawable-<dpi>/splash_icon.png + drawable/splash.xml (layer-list: solid colour + centred, unscaled icon)
 *   values/ic_launcher_background.xml, values/splash.xml (colours)
 * iOS (ios/App/App/Assets.xcassets):
 *   AppIcon.appiconset/AppIcon-512@2x.png    1024x1024, opaque, full-bleed (iOS applies its own mask)
 *   Splash.imageset/splash-2732x2732*.png    icon centred on the hall background colour (aspect-fill)
 *
 * Usage: node scripts/gen-assets.mjs   (or: npm run assets). Output is committed; re-run after editing icon.svg.
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PROJECT_ROOT, ANDROID_DIR, IOS_DIR, isMain } from './paths.mjs';

const SOURCE = path.join(PROJECT_ROOT, 'assets', 'icon.svg');
const SPLASH_BG = '#FFF8F2'; // hall light theme background / theme-color
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const SPLASH_ICON_DP = 128;

function loadSvgParts() {
  const svg = fs.readFileSync(SOURCE, 'utf8');
  const root = svg.match(/<svg\b[^>]*>/);
  const viewBox = root && root[0].match(/viewBox="0 0 (\d+) (\d+)"/);
  if (!viewBox || viewBox[1] !== '512' || viewBox[2] !== '512') throw new Error('icon.svg must have viewBox="0 0 512 512"');
  const inner = svg.slice(root.index + root[0].length, svg.lastIndexOf('</svg>'));
  const bgRect = inner.match(/<rect\b[^>]*fill="url\(#bg\)"[^>]*\/>/);
  if (!bgRect) throw new Error('icon.svg: background <rect fill="url(#bg)"> not found');
  const bgGradient = inner.match(/<linearGradient\b[^>]*id="bg"[^>]*>([\s\S]*?)<\/linearGradient>/);
  if (!bgGradient) throw new Error('icon.svg: <linearGradient id="bg"> not found');
  return {
    inner,
    artwork: inner.replace(bgRect[0], ''), // defs + everything except the background
    stops: bgGradient[1],
  };
}

const wrap = (viewBox, size, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}">${body}</svg>`;

/** Every variant is an SVG string rendered at an exact pixel size. */
function variants({ inner, artwork, stops }) {
  // Gradient in user space so the 108dp layers show exactly the colours of the original 512 box.
  const bgDefs = `<defs><linearGradient id="bgU" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="512" y2="512">${stops}</linearGradient></defs>`;
  return {
    rounded: (s) => wrap('0 0 512 512', s, inner),
    fullBleed: (s) => wrap('0 0 512 512', s, `${bgDefs}<rect width="512" height="512" fill="url(#bgU)"/>${artwork}`),
    round: (s) =>
      wrap(
        '0 0 512 512',
        s,
        `${bgDefs}<clipPath id="c"><circle cx="256" cy="256" r="256"/></clipPath><g clip-path="url(#c)"><rect width="512" height="512" fill="url(#bgU)"/>${artwork}</g>`,
      ),
    // Adaptive icon layers: 108dp canvas, the original 512 box = the 72dp visible centre (offset 128 units).
    foreground: (s) => wrap('-128 -128 768 768', s, artwork),
    background: (s) => wrap('-128 -128 768 768', s, `${bgDefs}<rect x="-128" y="-128" width="768" height="768" fill="url(#bgU)"/>`),
  };
}

async function render(svgString, file, { flatten = null } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let img = sharp(Buffer.from(svgString));
  if (flatten) img = img.flatten({ background: flatten }).removeAlpha();
  await img.png({ compressionLevel: 9 }).toFile(file);
}

async function solidWithCenteredIcon(file, width, height, iconPx, v) {
  const icon = await sharp(Buffer.from(v.rounded(iconPx))).png().toBuffer();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: SPLASH_BG } })
    .composite([{ input: icon, gravity: 'center' }])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(file);
}

const writeText = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

async function genAndroid(v) {
  const res = path.join(ANDROID_DIR, 'app', 'src', 'main', 'res');
  if (!fs.existsSync(res)) return console.log('assets: android/ not found, skipped');

  // Template leftovers that would shadow or duplicate the generated resources.
  for (const dir of fs.readdirSync(res)) {
    if (/^drawable(-(land|port))?(-\w+dpi)?$/.test(dir)) fs.rmSync(path.join(res, dir, 'splash.png'), { force: true });
  }
  fs.rmSync(path.join(res, 'drawable-v24', 'ic_launcher_foreground.xml'), { force: true });
  fs.rmSync(path.join(res, 'drawable', 'ic_launcher_background.xml'), { force: true });
  for (const dir of fs.readdirSync(res)) {
    const abs = path.join(res, dir);
    if (fs.statSync(abs).isDirectory() && fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
  }

  for (const [dpi, scale] of Object.entries(DENSITIES)) {
    const mip = path.join(res, `mipmap-${dpi}`);
    const legacy = Math.round(48 * scale);
    const adaptive = Math.round(108 * scale);
    await render(v.rounded(legacy), path.join(mip, 'ic_launcher.png'));
    await render(v.round(legacy), path.join(mip, 'ic_launcher_round.png'));
    await render(v.foreground(adaptive), path.join(mip, 'ic_launcher_foreground.png'));
    await render(v.background(adaptive), path.join(mip, 'ic_launcher_background.png'));
    await render(v.rounded(Math.round(SPLASH_ICON_DP * scale)), path.join(res, `drawable-${dpi}`, 'splash_icon.png'));
  }

  const adaptiveXml =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
    '    <background android:drawable="@mipmap/ic_launcher_background" />\n' +
    '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n' +
    '</adaptive-icon>\n';
  writeText(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptiveXml);
  writeText(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptiveXml);

  writeText(
    path.join(res, 'values', 'ic_launcher_background.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FFF4E6</color>\n</resources>\n',
  );
  writeText(
    path.join(res, 'values', 'splash.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' +
      `    <color name="splash_background">${SPLASH_BG}</color>\n</resources>\n`,
  );
  // Pre-Android-12 launch window background: solid colour + unscaled centred icon (no stretching).
  writeText(
    path.join(res, 'drawable', 'splash.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n' +
      '    <item android:drawable="@color/splash_background" />\n' +
      '    <item>\n' +
      '        <bitmap android:gravity="center" android:src="@drawable/splash_icon" />\n' +
      '    </item>\n' +
      '</layer-list>\n',
  );
  console.log(`assets: android icons (legacy/round/adaptive) + splash written to ${path.relative(PROJECT_ROOT, res)}`);
}

async function genIos(v) {
  const xc = path.join(IOS_DIR, 'App', 'App', 'Assets.xcassets');
  if (!fs.existsSync(xc)) return console.log('assets: ios/ not found, skipped');
  await render(v.fullBleed(1024), path.join(xc, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), { flatten: '#FFFFFF' });
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    await solidWithCenteredIcon(path.join(xc, 'Splash.imageset', name), 2732, 2732, 440, v);
  }
  console.log(`assets: ios AppIcon (1024, opaque) + Splash (2732) written to ${path.relative(PROJECT_ROOT, xc)}`);
}

export async function genAssets() {
  const v = variants(loadSvgParts());
  await genAndroid(v);
  await genIos(v);
}

if (isMain(import.meta.url)) await genAssets();
