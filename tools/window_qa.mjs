// Visual QA for schema-3 window themes: renders every cruise segment mid-landmark (and 40 s before it) via the preview page and saves PNGs.
// usage: THEME=<id> OUT=/tmp/qa node tools/window_qa.mjs
import { chromium } from 'playwright';
import fs from 'fs';
const THEME = process.env.THEME || 'dark-academia-train', OUT = process.env.OUT || '/tmp/qa', URL = process.env.E2E_URL || 'http://localhost:8099/';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 900, height: 900 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(`${URL}preview.html?theme=${THEME}`); await p.waitForSelector('.row');
const rows = await p.$$eval('.row', els => els.map((e, i) => ({ i: +e.dataset.i, cruise: !!e.querySelector('.tag') && e.textContent.includes('cruise'), t: e.querySelector('b').textContent })));
for (const r of rows.filter(r => r.cruise)) {
  await p.click(`.row[data-i="${r.i}"]`, { position: { x: 8, y: 8 } }); await p.waitForTimeout(1500);   // (not the centre: that is the notes textarea)
  await p.click('#lmj'); await p.waitForTimeout(1200);
  await p.locator('.screen').screenshot({ path: `${OUT}/${r.i}-a.png` });
  await p.waitForTimeout(8000); await p.locator('.screen').screenshot({ path: `${OUT}/${r.i}-b.png` });
  console.log('shot', r.i, r.t);
}
console.log('errors', errs); await b.close();
