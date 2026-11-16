const { chromium } = require('playwright'); const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => { const br = await chromium.launch(); const p = await br.newPage({ viewport: { width: 1280, height: 720 } }); const logs = []; p.on('console', m => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', e => logs.push('ERR ' + e.message));
  p.on('request', r => { if (r.url().includes('assets')) logs.push('REQ ' + r.url().split('/').slice(-2).join('/')); });
  await p.goto('http://localhost:8090/preview', { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 6; i++) { await sleep(500); const st = await Promise.race([p.evaluate(() => window.__stage), sleep(800).then(() => 'STUCK')]); console.log(i, st); if (st === 'draw') break; }
  console.log(logs.slice(0, 20)); await br.close(); })();
