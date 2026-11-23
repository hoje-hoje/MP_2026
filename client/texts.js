// 말투 고치기: 관리자가 정한 '원래 문장 → 바꿀 문장'을 화면 글자·알림·캔버스 글자에 바로 적용 (학생 채팅은 그대로)
(function () {
  let PAIRS = []; const cache = new Map(); let off = 0;
  const tx = (s) => { if (!PAIRS.length || typeof s !== 'string' || !s) return s; let c = cache.get(s); if (c !== undefined) return c; c = s; for (const [a, b] of PAIRS) if (c.includes(a)) c = c.split(a).join(b); if (cache.size > 5000) cache.clear(); cache.set(s, c); return c; };
  const SKIP = '#chatLog, #nchatLog, .chatlog, .nchat, input, textarea, script, style, [data-notx]';
  function walk(root) { if (!PAIRS.length || !root) return; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; const list = [];
    while ((n = w.nextNode())) { const p = n.parentElement; if (!p || p.closest(SKIP)) continue; const v = n.nodeValue, r = tx(v); if (r !== v) list.push([n, r]); }
    for (const [node, r] of list) node.nodeValue = r;
    if (root.querySelectorAll) for (const el of root.querySelectorAll('[placeholder],[title],[aria-label]')) { if (el.closest('#chatLog, #nchatLog')) continue; for (const at of ['placeholder', 'title', 'aria-label']) { const v = el.getAttribute(at); if (v) { const r = tx(v); if (r !== v) el.setAttribute(at, r); } } } }
  let pend = false; const obs = new MutationObserver(() => { if (pend || !PAIRS.length) return; pend = true; requestAnimationFrame(() => { pend = false; obs.disconnect(); walk(document.body); obs.observe(document.body, { subtree: true, childList: true, characterData: true }); }); });
  // 캔버스 글자 (팻말·이름표·안내): fillText/strokeText 를 감싸서 바꿈 (말풍선 등은 window.MP_TX.off() 로 잠깐 끔)
  for (const fn of ['fillText', 'strokeText']) { const orig = CanvasRenderingContext2D.prototype[fn]; CanvasRenderingContext2D.prototype[fn] = function (t, ...a) { return orig.call(this, off ? t : tx(t), ...a); }; }
  window.MP_TX = { map: {}, tx, set(map) { window.MP_TX.map = map || {}; PAIRS = Object.entries(map || {}).filter(([a]) => a).sort((x, y) => y[0].length - x[0].length); cache.clear(); if (document.body) { walk(document.body); obs.observe(document.body, { subtree: true, childList: true, characterData: true }); } },
    off(fn) { off++; try { return fn(); } finally { off--; } }, walk };
})();
