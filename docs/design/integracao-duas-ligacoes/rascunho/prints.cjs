const { chromium } = require('playwright');
const S = process.argv[2];
(async () => {
  const b = await chromium.launch();
  for (const n of ['integracao', 'integracao-sem-chave', 'dados']) for (const [w, h] of [[1280, 800], [390, 844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.goto(`file://${S}/${n}.html`);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    await p.screenshot({ path: `${S}/${n}-${w}.png`, fullPage: true });
    console.log(n, w, 'scrollWidth', sw);
  }
  await b.close();
})();
