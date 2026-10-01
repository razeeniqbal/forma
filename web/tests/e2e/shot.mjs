// Ad-hoc screenshot helper: node tests/e2e/shot.mjs <url-path> <out.png> [w] [h]
import { chromium } from "playwright";
const [, , path = "/", out = "shot.png", w = "1600", h = "940"] = process.argv;
const browser = await chromium.launch(process.env.FORMA_CHROMIUM ? { executablePath: process.env.FORMA_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`http://localhost:4173${path}`);
await page.waitForTimeout(1200);
await page.screenshot({ path: out });
console.log(errors.length ? errors.join("\n") : "no console errors");
await browser.close();
