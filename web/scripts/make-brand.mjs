// Generates FORMA brand assets (PRD §13) into public/brand.
// Symbol principle: FRAGMENT → ALIGN → FORM — four rounded fragments that
// progressively align into an "F".
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "brand");
mkdirSync(OUT, { recursive: true });

export const BLUE = "#146BFF";
export const BLACK = "#0A0D12";
export const WHITE = "#FFFFFF";

// Geometry on a 32×32 grid.
const FRAGMENTS = [
  { x: 14, y: 3, w: 15, h: 8, r: 2 }, // top bar
  { x: 4, y: 9, w: 7, h: 7, r: 1.75 }, // loose fragment
  { x: 12, y: 12, w: 9, h: 9, r: 2 }, // aligning block
  { x: 4, y: 19, w: 8, h: 10, r: 2 }, // stem / form
];

const rects = (fill, dx = 0, dy = 0, s = 1) =>
  FRAGMENTS.map(
    (f) =>
      `<rect x="${dx + f.x * s}" y="${dy + f.y * s}" width="${f.w * s}" height="${f.h * s}" rx="${f.r * s}" fill="${fill}"/>`,
  ).join("");

const symbol = (fill) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">${rects(fill)}</svg>\n`;

const WORD_FONT = `font-family="Inter, 'Helvetica Neue', Arial, sans-serif" font-weight="800"`;

const logo = (symbolFill, textFill, tagline = false) => {
  const h = tagline ? 52 : 40;
  const w = tagline ? 290 : 160;
  const tag = tagline
    ? `<text x="54" y="48" ${WORD_FONT.replace("800", "500")} font-size="7.2" letter-spacing="1.6" fill="${textFill}" fill-opacity="0.72">SHAPE MESSY DATA INTO RELIABLE PIPELINES.</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${rects(symbolFill, 0, 2, 1.12)}<text x="52" y="31" ${WORD_FONT} font-size="30" letter-spacing="-0.5" fill="${textFill}">FORMA</text>${tag}</svg>\n`;
};

const appIcon = (bg, fg, size = 512) => {
  const pad = size * 0.2;
  const s = (size - pad * 2) / 32;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${bg}"/>${rects(fg, pad, pad, s)}</svg>\n`;
};

const files = {
  "forma-symbol-blue.svg": symbol(BLUE),
  "forma-symbol-black.svg": symbol(BLACK),
  "forma-symbol-white.svg": symbol(WHITE),
  "forma-logo-primary.svg": logo(BLUE, BLACK),
  "forma-logo-black.svg": logo(BLACK, BLACK),
  "forma-logo-white.svg": logo(WHITE, WHITE),
  "forma-logo-tagline.svg": logo(BLUE, BLACK, true),
  "forma-favicon.svg": symbol(BLUE),
  "forma-app-icon.svg": appIcon(BLUE, WHITE),
  "forma-app-icon-dark.svg": appIcon(BLACK, WHITE),
};
for (const [name, svg] of Object.entries(files)) writeFileSync(join(OUT, name), svg);

// Rasterise PNGs with Playwright/Chromium when available.
const pngs = [
  ["forma-favicon.svg", "favicon-16.png", 16],
  ["forma-favicon.svg", "favicon-32.png", 32],
  ["forma-favicon.svg", "favicon-48.png", 48],
  ["forma-app-icon.svg", "forma-app-icon-192.png", 192],
  ["forma-app-icon.svg", "forma-app-icon-512.png", 512],
];
try {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(process.env.FORMA_CHROMIUM ? { executablePath: process.env.FORMA_CHROMIUM } : {});
  const page = await browser.newPage();
  for (const [src, out, size] of pngs) {
    await page.setViewportSize({ width: size, height: size });
    const svg = files[src].replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.screenshot({ path: join(OUT, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await browser.close();
  console.log("brand: svg + png written");
} catch (e) {
  console.log("brand: svg written; png skipped (install playwright to rasterise)", e.message);
}
