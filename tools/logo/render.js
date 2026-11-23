const { chromium } = require('playwright'); const fs = require('fs');
(async () => { const br = await chromium.launch(); const p = await br.newPage({ viewport: { width: 1520, height: 560 } });
  for (const [n, bg] of [['black', '#f4efe6'], ['gold', '#1c1630'], ['white', '#14102a']]) {
    const svg = fs.readFileSync('/home/user/mp_2026/client/assets/logo/logo_' + n + '.svg', 'utf8');
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`); await p.screenshot({ path: '/home/user/mp_2026/client/assets/logo/logo_' + n + '.png', omitBackground: true, clip: { x: 0, y: 0, width: 1520, height: 560 } });
    await p.setContent(`<html><body style="margin:0;background:${bg}">${svg}</body></html>`); await p.screenshot({ path: 'prev_' + n + '.png', clip: { x: 0, y: 0, width: 1520, height: 560 } }); }
  await br.close(); })();
