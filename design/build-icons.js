const { chromium } = require('playwright-core');
const { iconSvg, foregroundSvg, featureGraphic } = require('./brand');
const fs = require('fs');

const JOBS = [
  // Full-bleed square. No rounded corners: Android and Play both apply their own.
  { file: 'icon.png',            w: 1024, h: 1024, svg: () => iconSvg(1024, 0.58),  alpha: false },
  { file: 'playstore-icon.png',  w: 512,  h: 512,  svg: () => iconSvg(512, 0.58),   alpha: false },
  // Android adaptive foreground — transparent, mark inside the 66% safe circle.
  { file: 'adaptive-icon.png',   w: 1024, h: 1024, svg: () => foregroundSvg(1024, 0.52), alpha: true },
  { file: 'monochrome-icon.png', w: 1024, h: 1024, svg: () => foregroundSvg(1024, 0.52, { mono: true }), alpha: true },
  // Splash: the mark alone on the green, set as the splash background colour.
  { file: 'splash-icon.png',     w: 1024, h: 1024, svg: () => foregroundSvg(1024, 0.55), alpha: true },
  // Play requires 1024x500 and refuses transparency here.
  { file: 'feature-graphic.png', w: 1024, h: 500,  svg: () => featureGraphic(), alpha: false },
];

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  fs.mkdirSync('assets', { recursive: true });
  for (const j of JOBS) {
    const page = await b.newPage({ viewport: { width: j.w, height: j.h } });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${j.svg()}`,
    );
    await page.screenshot({
      path: `assets/${j.file}`,
      omitBackground: j.alpha,
      clip: { x: 0, y: 0, width: j.w, height: j.h },
    });
    await page.close();
  }
  await b.close();
  console.log('built');
})();
