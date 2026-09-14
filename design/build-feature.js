/**
 * Build the Play Store feature graphic.
 *
 * Separate from `build-icons.js` because it does something that script does
 * not: it *measures*. The title is rendered, its real width read back from the
 * browser, and the font shrunk a point at a time until the longest line clears
 * the right-hand edge with a margin. A feature graphic with a clipped word is
 * the kind of mistake that survives a hundred views before anyone mentions it.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { featureGraphic } = require('./icon-source');

const OUT = path.join(__dirname, 'play-store', 'feature-graphic.png');
const RIGHT_EDGE = 1024 - 40; // keep text out of the last 40px

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });

  let size = 58;
  let svg = '';

  for (; size >= 36; size -= 1) {
    svg = featureGraphic({ titleSize: size });
    await page.setContent(
      `<style>html,body{margin:0;padding:0}svg{display:block}</style>${svg}`,
    );
    const widest = await page.evaluate(() =>
      Math.max(
        ...['t', 'g', 'f'].map((id) => {
          const el = document.getElementById(id);
          const box = el.getBBox();
          return box.x + box.width;
        }),
      ),
    );
    if (widest <= RIGHT_EDGE) break;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1024, height: 500 } });
  await browser.close();
  console.log(`built ${OUT} at title size ${size}`);
})();
