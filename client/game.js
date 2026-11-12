/* MP 2026 — 세계 지도 걷기 프로토타입 (혼자 걷기 + 가짜 참가자들)
 * 지도 데이터: world.json (tools/mapgen/gen_map.py 로 생성)
 */
(() => {
  'use strict';

  const TILE = 32;
  const CHUNK = 16;
  const CPX = TILE * CHUNK;
  const T = { VOID: 0, GRASS: 1, FOREST: 2, SAND: 3, WATER: 4, MOUNTAIN: 5, HOLY: 6, WALL: 7 };
  const WALK = 5 * TILE;          // 초당 5칸
  const TYPES = ['기하', '대수', '확통', '미적분', '수열', '논리'];
  const TYPE_FILL = { 기하: '#5b7fd6', 대수: '#e86a5c', 확통: '#3fa37a', 미적분: '#b06fd8', 수열: '#e2a33b', 논리: '#4bb3c4' };
  const TYPE_TAG = { 기하: '#3d5fb8', 대수: '#c94a3c', 확통: '#277a58', 미적분: '#8a4fc0', 수열: '#9a5f10', 논리: '#1f7f8f' };
  const TYPE_RGB = {};
  for (const k of TYPES) TYPE_RGB[k] = hexRgb(TYPE_FILL[k]);
  const RING = { inner: '중심부', middle: '중부', frontier: '변방' };
  const HAIRS = ['#4a3428', '#2b2340', '#f2c14e', '#c45a7a', '#e8e2d6', '#2f4f8f'];
  const OUTFITS = ['#5b7fd6', '#e86a5c', '#3fa37a', '#b06fd8', '#e2a33b', '#4bb3c4'];
  const SKINS = ['#ffe1cc', '#f6d2b8', '#eec3a3'];

  // 날짜 미리보기: 주소 끝 #day1 ~ #day15 (기본 1일차). [ ] 키로도 바꿀 수 있다.
  const DAY = (() => { const m = /^#day(\d{1,2})$/.exec(location.hash); return Math.max(1, Math.min(15, m ? +m[1] : 1)); })();
  const WAVE_DAY = { 1: 6, 2: 8, 3: 10, 4: 12, 5: 14 };   // 균열 웨이브가 무너지는 날
  const DOOM = DAY >= 5;                                   // D5: 신들의 멸망 선포
  const PHASE = DAY <= 2 ? '건국기' : DAY <= 4 ? '확장기' : DAY <= 14 ? '멸망기' : '최종 결전';
  addEventListener('hashchange', () => location.reload());
  let gone = new Uint8Array(1);                            // 무너진 영토

  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, terrain = null, terr = null, terrs = [], home = null;
  let solid = null;      // 건물·제단 등 막힌 칸
  let sprites = [];      // 깊이 정렬해서 그리는 큰 물체
  const nodes = [];      // 금광 (온라인 자원 지점)
  let names = [];

  // ------------------------------------------------------------ 유틸
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(h, a) { const [r, g, b] = hexRgb(h); const f = (c) => Math.max(0, Math.min(255, Math.round(c * (1 + a)))); return `rgb(${f(r)},${f(g)},${f(b)})`; }
  function hash(x, y, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function b64bytes(s) { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  const tileAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? T.VOID : terrain[y * W + x];
  const terrAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -1 : (terr[y * W + x] === 65535 ? -1 : terr[y * W + x]);
  function blocked(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return true;
    const t = terrain[y * W + x], o = terr[y * W + x];
    if (o !== 65535 && o > 0 && gone[o]) return true;
    return t === T.VOID || t === T.WATER || t === T.MOUNTAIN || t === T.WALL || solid[y * W + x] === 1;
  }
  function speedAt(x, y) { const t = tileAt(x, y); return t === T.FOREST ? 0.7 : t === T.SAND ? 0.85 : 1; }

  // 영토 이름 (번호로 고정)
  const SYL = ['라온', '솔빛', '미르', '벼리', '가람', '누리', '다온', '초롱', '하람', '윤슬', '아라', '한결', '새벽', '별하', '온새', '나린', '해솔', '그루', '여울', '도담', '마루', '보람', '시나', '이든'];
  const SUFFIX = { inner: '령', middle: '주', frontier: ' 변경' };
  function terrName(t) { const a = SYL[(t.id * 7) % SYL.length]; const b = ['', '', '동', '서', '남', '북'][(t.id * 13) % 6]; return a + b + SUFFIX[t.ring]; }

  // ------------------------------------------------------------ 불러오기
  async function loadWorld() {
    for (const u of ['world.json', '../maps/world.json']) {
      try { const r = await fetch(u); if (r.ok) return await r.json(); } catch (e) { /* 다음 경로 */ }
    }
    throw new Error('world.json 을 찾지 못했어요. maps/world.json 이 있는지 확인해 주세요.');
  }

  function setupWorld(data) {
    W = data.width; H = data.height;
    terrain = b64bytes(data.terrain_b64);
    terr = new Uint16Array(b64bytes(data.territory_u16le_b64).buffer);
    terrs = [null];
    gone = new Uint8Array(data.territories.length + 2);
    for (const t of data.territories) { terrs[t.id] = t; t.name = terrName(t); if (t.rift && WAVE_DAY[t.rift] <= DAY) gone[t.id] = 1; }
    solid = new Uint8Array(W * H);
    // 프로토타입: 지도 가운데에서 가장 가까운 수도 후보를 '우리 수도'로 삼는다
    const caps = terrs.filter((t) => t && t.capitalCandidate && !gone[t.id]);
    home = caps.sort((a, b) => Math.hypot(a.center[0] - W / 2, a.center[1] - H / 2) - Math.hypot(b.center[0] - W / 2, b.center[1] - H / 2))[0];
    buildSprites();
  }

  // ------------------------------------------------------------ 큰 물체 (건물, 시계탑, 제단, 깃발)
  function block(x0, y0, w, h) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < W && y < H) solid[y * W + x] = 1; }

  function buildSprites() {
    const P = (tx) => tx * TILE;
    sprites = [];
    for (const t of terrs) {
      if (!t || gone[t.id]) continue;
      const [ax, ay] = t.altar;
      block(ax, ay, 1, 1);
      sprites.push({ x: P(ax) + 16, y: P(ay) + 28, draw: (g, x, y) => drawAltar(g, x, y, t) });
      if (t.capitalCandidate) {
        let fx = ax + 2, fy = ay;
        if (blocked(fx, fy)) { fx = ax - 2; }
        if (!blocked(fx, fy)) { block(fx, fy, 1, 1); sprites.push({ x: P(fx) + 16, y: P(fy) + 28, draw: drawFlag }); }
        const [qx, qy] = t.portal;
        sprites.push({ x: P(qx) + 16, y: P(qy) + 20, portal: t, draw: (g, x, y) => drawPortal(g, x, y, t === home) });
      }
      // 금광 (온라인 자원 지점): 영토마다 1곳, 하루 1번 캘 수 있음
      for (let k = 0; k < 40; k++) {
        const nx = ax + Math.round((hash(t.id, k, 11) - 0.5) * 18), ny = ay + Math.round((hash(t.id, k, 12) - 0.5) * 18);
        if (Math.abs(nx - ax) + Math.abs(ny - ay) < 4 || blocked(nx, ny) || terrAt(nx, ny) !== t.id) continue;
        const n = { id: t.id, t, x: P(nx) + 16, y: P(ny) + 24 };
        nodes.push(n);
        sprites.push({ x: n.x, y: n.y, draw: (g, x, y) => drawOre(g, x, y, mined.has(n.id)) });
        break;
      }
    }
  }

  function drawOre(g, x, y, empty) {
    g.fillStyle = 'rgba(0,0,0,0.16)'; ell(g, x, y, 20, 6);
    g.fillStyle = '#8a8197'; tri(g, x - 20, y, x - 4, y - 26, x + 8, y); tri(g, x - 6, y, x + 8, y - 20, x + 20, y);
    g.fillStyle = '#6d6580'; tri(g, x - 4, y - 26, x + 8, y, x, y);
    if (empty) return;
    g.fillStyle = '#f2c14e'; circ(g, x - 8, y - 10, 4); circ(g, x + 9, y - 8, 3.5); circ(g, x + 1, y - 17, 3);
    const tw = (Math.sin(performance.now() / 250 + x) + 1) / 2;
    g.fillStyle = `rgba(255,255,255,${tw})`; g.fillRect(x - 9, y - 12, 2, 2); g.fillRect(x + 8, y - 10, 2, 2);
  }

  // 하늘로 가는 빛기둥
  function drawPortal(g, x, y, mine) {
    const now = performance.now() / 1000;
    const pulse = 0.5 + Math.sin(now * 3) * 0.15;
    g.fillStyle = `rgba(255,236,140,${0.35 * pulse + 0.15})`; ell(g, x, y, 30, 11);
    g.strokeStyle = mine ? '#e5486a' : '#c9a227'; g.lineWidth = 3; g.beginPath(); g.ellipse(x, y, 26, 9, 0, 0, Math.PI * 2); g.stroke();
    const grd = g.createLinearGradient(0, y - 220, 0, y);
    grd.addColorStop(0, 'rgba(255,248,200,0)'); grd.addColorStop(1, `rgba(255,240,170,${0.55 * pulse + 0.2})`);
    g.fillStyle = grd; g.fillRect(x - 16, y - 220, 32, 220);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 4; i++) { const k = (now * 0.6 + i / 4) % 1; circ(g, x + Math.sin(i * 2.1 + now) * 10, y - k * 200, 2.2); }
    if (mine) sign(g, x, y - 236, '우리 수도 · 하늘 포털');
  }

  function drawTower(g, x, y) {
    g.fillStyle = 'rgba(0,0,0,0.16)'; ell(g, x, y - 4, 76, 16);
    g.fillStyle = '#9d8fc2'; rr(g, x - 64, y - 64, 128, 64, 8);
    g.fillStyle = '#b9acd6'; rr(g, x - 64, y - 70, 128, 20, 8);
    g.fillStyle = '#d9d0f0'; rr(g, x - 44, y - 200, 88, 140, 8);
    g.fillStyle = '#c6bbe4'; g.fillRect(x + 16, y - 200, 28, 140);
    g.fillStyle = '#6b4fb3'; tri(g, x - 54, y - 192, x, y - 262, x + 54, y - 192);
    g.fillStyle = '#5a3f9e'; tri(g, x, y - 262, x + 54, y - 192, x + 26, y - 192);
    const now = performance.now() / 1000;
    const orb = DOOM ? '#ff5d7a' : '#b9acd6';
    g.fillStyle = DOOM ? 'rgba(255,93,122,0.25)' : 'rgba(185,172,214,0.25)'; circ(g, x, y - 272, 22 + Math.sin(now * (DOOM ? 4 : 1)) * 3);
    g.fillStyle = orb; circ(g, x, y - 272, 11);
    g.fillStyle = '#ffd0da'; circ(g, x - 4, y - 276, 3);
    g.fillStyle = '#fffaf0'; circ(g, x, y - 150, 30); g.lineWidth = 5; g.strokeStyle = '#6b4fb3'; g.stroke();
    g.strokeStyle = '#2b2340'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y - 150); g.lineTo(x, y - 170); g.stroke();
    g.strokeStyle = '#e5486a'; g.beginPath(); g.moveTo(x, y - 150); g.lineTo(x + 13, y - 141); g.stroke();
    g.strokeStyle = '#e5486a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x - 30, y - 112); g.lineTo(x - 20, y - 100); g.lineTo(x - 28, y - 90); g.lineTo(x - 18, y - 78); g.stroke();
    g.fillStyle = '#5a3f9e'; rr(g, x - 16, y - 54, 32, 54, 16);
  }

  function drawBuilding(g, x, y, wTiles, roof, label, mark) {
    const w = wTiles * TILE, h = 150;
    g.fillStyle = 'rgba(0,0,0,0.14)'; ell(g, x, y - 2, w / 2 + 16, 16);
    g.fillStyle = '#fff4e2'; g.fillRect(x - w / 2, y - h, w, h);
    g.fillStyle = '#f0e0c4'; g.fillRect(x - w / 2, y - 22, w, 22);
    g.fillStyle = roof; tri(g, x - w / 2 - 20, y - h + 8, x, y - h - 80, x + w / 2 + 20, y - h + 8);
    g.fillStyle = shade(roof, -0.15); rr(g, x - w / 2 - 24, y - h, w + 48, 18, 9);
    const win = Math.max(2, Math.floor(wTiles / 3));
    for (let i = 0; i < win; i++) {
      const wx = x - w / 2 + (i + 0.5) * (w / win) - 20;
      if (Math.abs(wx + 20 - x) < 36) continue;
      g.fillStyle = '#cfeaff'; rr(g, wx, y - h + 44, 40, 36, 5); g.strokeStyle = shade(roof, -0.15); g.lineWidth = 4; g.stroke();
    }
    g.fillStyle = '#8b5e3c'; rr(g, x - 26, y - 76, 52, 76, 8);
    g.fillStyle = '#ffffff'; circ(g, x, y - h - 28, 22); g.strokeStyle = shade(roof, -0.15); g.lineWidth = 4; g.stroke();
    g.fillStyle = shade(roof, -0.25); g.font = '700 24px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(mark === 'cathedral' ? '∞' : mark, x, y - h - 27);
    sign(g, x, y - h - 70 - 40, label);
  }

  function drawAltar(g, x, y, t) {
    const c = TYPE_FILL[t.type];
    g.fillStyle = 'rgba(0,0,0,0.18)'; ell(g, x, y, 16, 5);
    g.fillStyle = '#b9b0c8'; rr(g, x - 13, y - 14, 26, 14, 3);
    g.fillStyle = '#d6cfe0'; rr(g, x - 10, y - 22, 20, 10, 3);
    const bob = Math.sin(performance.now() / 500 + t.id) * 2;
    g.fillStyle = c; g.beginPath(); g.moveTo(x, y - 46 + bob); g.lineTo(x + 8, y - 34 + bob); g.lineTo(x, y - 24 + bob); g.lineTo(x - 8, y - 34 + bob); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.moveTo(x - 2, y - 42 + bob); g.lineTo(x + 1, y - 38 + bob); g.lineTo(x - 3, y - 34 + bob); g.closePath(); g.fill();
  }

  function drawFlag(g, x, y) {
    g.fillStyle = 'rgba(0,0,0,0.18)'; ell(g, x, y, 10, 4);
    g.fillStyle = '#6b4a2b'; g.fillRect(x - 2, y - 64, 4, 64);
    const wv = Math.sin(performance.now() / 300) * 3;
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x + 2, y - 62); g.quadraticCurveTo(x + 18, y - 58 + wv, x + 34, y - 60); g.lineTo(x + 34, y - 38); g.quadraticCurveTo(x + 18, y - 36 + wv, x + 2, y - 40); g.closePath(); g.fill();
    g.strokeStyle = '#2b2340'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#e5486a'; g.beginPath(); g.moveTo(x + 10, y - 44); g.lineTo(x + 10, y - 54); g.lineTo(x + 14, y - 49); g.lineTo(x + 18, y - 56); g.lineTo(x + 22, y - 49); g.lineTo(x + 26, y - 54); g.lineTo(x + 26, y - 44); g.closePath(); g.fill();
  }

  function sign(g, x, y, text) {
    g.font = '20px Jua, "Noto Sans KR", sans-serif';
    const w = g.measureText(text).width + 24;
    g.fillStyle = '#fffdf8'; rr(g, x - w / 2, y - 16, w, 32, 8); g.strokeStyle = '#2b2340'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#2b2340'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 1);
  }

  // 도형 도우미
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill(); }
  function ell(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
  function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  function tri(g, a, b, c, d, e, f) { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.lineTo(e, f); g.closePath(); g.fill(); }

  // ------------------------------------------------------------ 바닥 청크
  const chunks = new Map();
  let chunkBudget = 0;

  function getChunk(ci, cj) {
    const k = ci + ',' + cj;
    let c = chunks.get(k);
    if (c) { chunks.delete(k); chunks.set(k, c); return c; }
    if (chunkBudget <= 0) return null;
    chunkBudget--;
    c = renderChunk(ci, cj);
    chunks.set(k, c);
    if (chunks.size > 64) chunks.delete(chunks.keys().next().value);
    return c;
  }

  const GRASS = ['#9fd88a', '#a5db90', '#9ad485'];
  const FOREST_G = ['#8acb77', '#86c773'];
  const SAND = ['#ecdcb4', '#e8d6aa'];

  function renderChunk(ci, cj) {
    const c = document.createElement('canvas');
    c.width = c.height = CPX;
    const g = c.getContext('2d');
    const x0 = ci * CHUNK, y0 = cj * CHUNK;
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const x = x0 + tx, y = y0 + ty, px = tx * TILE, py = ty * TILE;
        const t = tileAt(x, y), h = hash(x, y);
        const og = terrAt(x, y);
        if (og > 0 && gone[og]) {
          g.fillStyle = '#1b1430'; g.fillRect(px, py, TILE, TILE);
          if (h < 0.05) { g.fillStyle = h < 0.015 ? '#f3dcff' : '#8d7ab8'; g.fillRect(px + (h * 997 % 28), py + (h * 577 % 28), 2, 2); }
          const alive = (a, b) => { const q = terrAt(a, b); return q >= 0 && !gone[q] && tileAt(a, b) !== T.VOID; };
          g.fillStyle = '#b06fd8';
          if (alive(x, y - 1)) g.fillRect(px, py, TILE, 4);
          if (alive(x, y + 1)) g.fillRect(px, py + TILE - 4, TILE, 4);
          if (alive(x - 1, y)) g.fillRect(px, py, 4, TILE);
          if (alive(x + 1, y)) g.fillRect(px + TILE - 4, py, 4, TILE);
          continue;
        }
        switch (t) {
          case T.VOID:
            g.fillStyle = '#1b1430'; g.fillRect(px, py, TILE, TILE);
            if (h < 0.03) { g.fillStyle = h < 0.01 ? '#f3dcff' : '#8d7ab8'; g.fillRect(px + (h * 997 % 28), py + (h * 577 % 28), 2, 2); }
            break;
          case T.GRASS:
            g.fillStyle = GRASS[(h * 3) | 0]; g.fillRect(px, py, TILE, TILE);
            if (h < 0.12) { g.strokeStyle = '#84c472'; g.lineWidth = 2; g.lineCap = 'round'; const ox = px + 6 + (h * 1000 % 18), oy = py + 12 + (h * 3000 % 14); g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + 2, oy - 5); g.lineTo(ox + 4, oy); g.stroke(); }
            else if (h < 0.145) { g.fillStyle = ['#ffffff', '#ffd6e0', '#fff2a8'][(h * 1000 | 0) % 3]; circ(g, px + 8 + (h * 4000 % 16), py + 8 + (h * 7000 % 16), 3); }
            break;
          case T.FOREST:
            g.fillStyle = FOREST_G[(h * 2) | 0]; g.fillRect(px, py, TILE, TILE);
            break;
          case T.SAND:
            g.fillStyle = SAND[(h * 2) | 0]; g.fillRect(px, py, TILE, TILE);
            if (h < 0.2) { g.fillStyle = '#d9c38f'; g.fillRect(px + (h * 900 % 26), py + (h * 1300 % 26), 3, 3); }
            break;
          case T.WATER: {
            g.fillStyle = '#6fb7e8'; g.fillRect(px, py, TILE, TILE);
            if (h < 0.1) { g.strokeStyle = '#a8d8f5'; g.lineWidth = 2; g.beginPath(); g.arc(px + 16, py + 20, 7, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
            g.fillStyle = '#d8f0ff';
            const land = (a, b) => { const q = tileAt(a, b); return q !== T.WATER && q !== T.VOID; };
            if (land(x, y - 1)) g.fillRect(px, py, TILE, 5);
            if (land(x, y + 1)) g.fillRect(px, py + TILE - 4, TILE, 4);
            if (land(x - 1, y)) g.fillRect(px, py, 4, TILE);
            if (land(x + 1, y)) g.fillRect(px + TILE - 4, py, 4, TILE);
            break;
          }
          case T.MOUNTAIN:
            g.fillStyle = '#9a91a8'; g.fillRect(px, py, TILE, TILE);
            if (h < 0.3) { g.fillStyle = '#a9a1b6'; g.fillRect(px + 4, py + 6, 10, 8); }
            break;
          case T.HOLY: {
            g.fillStyle = '#efe8da'; g.fillRect(px, py, TILE, TILE);
            g.fillStyle = '#e2d8c4';
            g.fillRect(px, py + TILE - 2, TILE, 2);
            g.fillRect(px + ((y & 1) ? 0 : TILE / 2), py, 2, TILE);
            break;
          }
          case T.WALL:
            g.fillStyle = '#6b4fb3'; g.fillRect(px, py, TILE, TILE);
            g.fillStyle = '#8467c9'; g.fillRect(px, py, TILE, 12);
            if ((x + y) % 2 === 0) { g.fillStyle = '#5a3f9e'; g.fillRect(px + 4, py + 18, TILE - 8, 3); }
            break;
        }
        // 영토 색 은은하게 + 국경선
        const o = terrAt(x, y);
        if (o > 0 && t !== T.WATER && t !== T.MOUNTAIN) {
          const [r, gg, b] = TYPE_RGB[terrs[o].type];
          g.fillStyle = `rgba(${r},${gg},${b},0.10)`; g.fillRect(px, py, TILE, TILE);
        }
        if (o > 0) {
          const right = terrAt(x + 1, y), down = terrAt(x, y + 1);
          g.fillStyle = 'rgba(43,35,64,0.45)';
          if (right > 0 && right !== o) { for (let k = 0; k < TILE; k += 8) g.fillRect(px + TILE - 2, py + k, 3, 5); }
          if (down > 0 && down !== o) { for (let k = 0; k < TILE; k += 8) g.fillRect(px + k, py + TILE - 2, 5, 3); }
        }
      }
    }
    // 장식 (나무, 바위) — 아래쪽 줄이 앞에 오도록, 이웃 청크까지 걸쳐 그린다
    for (let y = y0 - 2; y < y0 + CHUNK + 2; y++) {
      for (let x = x0 - 1; x < x0 + CHUNK + 1; x++) {
        const t = tileAt(x, y), h = hash(x, y, 7);
        const px = (x - x0) * TILE, py = (y - y0) * TILE;
        const og = terrAt(x, y);
        if (og > 0 && gone[og]) continue;
        if (t === T.FOREST && h < 0.62) tree(g, px + 16 + (h * 97 % 10) - 5, py + 26, 12 + (h * 31 % 6));
        else if (t === T.GRASS && h < 0.008) tree(g, px + 16, py + 26, 15);
        else if (t === T.MOUNTAIN && h < 0.45) rock(g, px + 16, py + 28, h);
      }
    }
    return c;
  }

  function tree(g, x, y, r) {
    g.fillStyle = 'rgba(0,0,0,0.14)'; ell(g, x, y + 2, r, r * 0.35);
    g.fillStyle = '#8b5e3c'; g.fillRect(x - 3, y - 12, 6, 13);
    g.fillStyle = '#4f9e5b'; circ(g, x, y - 12 - r * 0.8, r);
    g.fillStyle = '#68bd74'; circ(g, x - r * 0.35, y - 15 - r, r * 0.45);
  }
  function rock(g, x, y, h) {
    const s = 14 + (h * 50 % 10);
    g.fillStyle = '#7f7690'; tri(g, x - s, y, x, y - s * 1.6, x + s, y);
    g.fillStyle = '#6d6580'; tri(g, x, y - s * 1.6, x + s, y, x + s * 0.3, y);
    if (h < 0.15) { g.fillStyle = '#f4f1fa'; tri(g, x - s * 0.35, y - s * 1.05, x, y - s * 1.6, x + s * 0.35, y - s * 1.05); }
  }

  // ------------------------------------------------------------ 캐릭터 (SD 2.5등신)
  const P_LONG = new Path2D('M11 30 Q11 7 32 7 Q53 7 53 30 L55 62 Q49 67 44 61 L44 42 L20 42 L20 61 Q15 67 9 62 Z');
  const P_BODY = new Path2D('M21 52 Q21 47 26 47 L38 47 Q43 47 43 52 L45 68 Q45 70 43 70 L21 70 Q19 70 19 68 Z');
  const P_BANGS = new Path2D('M12.5 31 Q12 9 32 9 Q52 9 51.5 31 Q48 23 42 21 Q39 26 33 22 Q27 27 22 21 Q16 24 12.5 31 Z');
  const CH_S = 0.62; // 64x84 → 약 40x52px

  function drawChibi(g, x, y, look, t, moving, dir) {
    const ph = t * 11;
    const sw = moving ? Math.sin(ph) : 0;
    const bob = moving ? Math.abs(Math.sin(ph)) * 1.6 : Math.sin(t * 2) * 0.4;
    g.save();
    g.translate(x, y);
    g.scale(CH_S, CH_S);
    g.translate(-32, -79);
    if (dir < 0) { g.translate(64, 0); g.scale(-1, 1); }
    g.fillStyle = 'rgba(0,0,0,0.18)'; ell(g, 32, 79, 14, 3.5);
    if (look.me) { g.strokeStyle = look.accent; g.lineWidth = 2; g.setLineDash([4, 3]); g.beginPath(); g.ellipse(32, 79, 19, 5, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
    g.translate(0, -bob);
    if (look.long) { g.fillStyle = look.hair; g.fill(P_LONG); }
    // 다리
    g.fillStyle = '#3b3552';
    rr(g, 24 + sw * 2.5, 64 + bob - Math.max(0, sw) * 2, 7, 13, 3.5);
    rr(g, 33 - sw * 2.5, 64 + bob - Math.max(0, -sw) * 2, 7, 13, 3.5);
    g.fillStyle = '#2b2340';
    rr(g, 23 + sw * 2.5, 73 + bob - Math.max(0, sw) * 2, 9, 5, 2.5);
    rr(g, 32 - sw * 2.5, 73 + bob - Math.max(0, -sw) * 2, 9, 5, 2.5);
    // 팔
    const dark = look._dark || (look._dark = shade(look.outfit, -0.18));
    for (const [ax, base] of [[17.5, 10], [46.5, -10]]) {
      g.save(); g.translate(ax, 50); g.rotate((base + (ax < 32 ? sw : -sw) * 22) * Math.PI / 180);
      g.fillStyle = dark; rr(g, -3.5, 0, 7, 15, 3.5);
      g.fillStyle = look.skin; circ(g, 0, 15, 3.2);
      g.restore();
    }
    g.fillStyle = look.outfit; g.fill(P_BODY);
    g.fillStyle = '#ffffff'; tri(g, 27, 47, 32, 54, 37, 47);
    g.fillStyle = look.accent; circ(g, 32, 60, 2);
    // 머리
    g.fillStyle = look.hair; ell(g, 32, 28, 21, 20);
    g.fillStyle = look.skin; ell(g, 32, 31, 18.5, 17.5);
    g.fillStyle = look.hair; g.fill(P_BANGS);
    g.strokeStyle = look.hair; g.lineWidth = 2.5; g.lineCap = 'round'; g.beginPath(); g.moveTo(32, 9); g.quadraticCurveTo(30, 3, 35, 2); g.stroke();
    g.fillStyle = look.accent; circ(g, 46, 18, 3.4);
    // 눈 (가끔 깜빡)
    const blink = ((t + look.seed) % 3.4) < 0.12;
    g.fillStyle = '#2b2340';
    if (blink) { g.fillRect(22, 34, 6.5, 1.8); g.fillRect(35.5, 34, 6.5, 1.8); }
    else {
      ell(g, 25.5, 34, 3.2, 4.2); ell(g, 39.5, 34, 3.2, 4.2);
      g.fillStyle = '#ffffff'; circ(g, 26.7, 32.4, 1.3); circ(g, 40.7, 32.4, 1.3);
    }
    g.fillStyle = 'rgba(255,143,168,0.55)'; ell(g, 20.5, 39.5, 3.2, 1.7); ell(g, 43.5, 39.5, 3.2, 1.7);
    g.strokeStyle = '#9a4a52'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(29.5, 41); g.quadraticCurveTo(32, 43.5, 34.5, 41); g.stroke();
    g.restore();
  }

  const tagW = new Map();
  function nameTag(g, x, y, text, color) {
    g.font = '700 12px "Noto Sans KR", sans-serif';
    let w = tagW.get(text);
    if (!w) { w = g.measureText(text).width + 14; tagW.set(text, w); }
    g.fillStyle = color; rr(g, x - w / 2, y - 9, w, 18, 9);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 0.5);
  }
  function bubble(g, x, y, text) {
    g.font = '700 12px "Noto Sans KR", sans-serif';
    const w = g.measureText(text).width + 16;
    g.fillStyle = '#ffffff'; rr(g, x - w / 2, y - 12, w, 22, 10);
    g.strokeStyle = '#2b2340'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#2b2340'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y);
  }

  // ------------------------------------------------------------ 하늘 (중립 지역, 방으로 나뉨)
  // 각 나라 수도의 포털로 올라오고, 내려갈 땐 올라온 포털(=자기 나라 수도)로만 내려간다.
  const ROOMS = {
    temple: {
      name: '하늘 신전', desc: '신들의 공지 · 신탁 게시판 · 멸망 시계', w: 30, h: 18, pos: [1, 1], crowd: 10,
      floor: '#f4efff', line: '#e6ddf7', trim: '#e2b93b',
      emotes: ['신탁 봤어?', '오늘 공지 뭐임', '!', '?', '내일 어디 무너짐?', '시계 빨개졌다'],
      doors: [{ side: 'W', at: 9, to: 'market' }, { side: 'E', at: 9, to: 'council' }, { side: 'N', at: 15, to: 'plaza' }, { side: 'S', at: 15, to: 'ground' }],
      props: [
        { x: 13, y: 4, w: 4, h: 3, draw: (g, x, y) => { g.save(); g.translate(x, y); g.scale(0.75, 0.75); drawTower(g, 0, 0); g.restore(); sign(g, x, y - 228, DOOM ? (DAY >= 15 ? '결전의 날' : `멸망까지 D-${15 - DAY}`) : '고요한 시계탑'); } },
        { x: 6, y: 3, w: 4, h: 1, board: true, draw: (g, x, y) => board(g, x, y, '신탁 게시판') },
        { x: 4, y: 6, w: 1, h: 1, draw: pillar }, { x: 4, y: 12, w: 1, h: 1, draw: pillar },
        { x: 25, y: 6, w: 1, h: 1, draw: pillar }, { x: 25, y: 12, w: 1, h: 1, draw: pillar },
      ],
    },
    market: {
      name: '거래소', desc: '자원·병력·정보를 사고파는 곳', w: 30, h: 18, pos: [0, 1], crowd: 9,
      floor: '#fff6e6', line: '#f1e3c6', trim: '#e7a33e',
      emotes: ['열쇠 조각 팝니다', '병력 100 ↔ 코인 3천', '강화석 삼', '정보 삽니다', '흥정 ㄱ?', '너무 비쌈;;'],
      doors: [{ side: 'E', at: 9, to: 'temple' }],
      props: [
        { x: 4, y: 3, w: 4, h: 2, draw: (g, x, y) => stall(g, x, y, '#e86a5c', '자원') },
        { x: 12, y: 3, w: 4, h: 2, draw: (g, x, y) => stall(g, x, y, '#5b7fd6', '병력') },
        { x: 20, y: 3, w: 4, h: 2, draw: (g, x, y) => stall(g, x, y, '#3fa37a', '정보') },
        { x: 4, y: 12, w: 4, h: 2, shop: 'vaccine', draw: (g, x, y) => stall(g, x, y, '#b06fd8', '백신 (균열 방어)') },
        { x: 12, y: 12, w: 4, h: 2, draw: (g, x, y) => stall(g, x, y, '#e2a33b', '경매') },
        { x: 20, y: 12, w: 4, h: 2, draw: (g, x, y) => stall(g, x, y, '#4bb3c4', '환전') },
      ],
    },
    council: {
      name: '회담장', desc: '나라끼리 조약을 맺는 곳 · 밀실 2개', w: 26, h: 16, pos: [2, 1], crowd: 7,
      floor: '#eef4ff', line: '#dbe5f7', trim: '#5b7fd6',
      emotes: ['불가침 조약 ㄱ?', '동맹 맺자', '조건이 뭔데', '배신하면 알지?', '왕끼리 얘기하자'],
      doors: [{ side: 'W', at: 8, to: 'temple' }, { side: 'E', at: 4, to: 'secret1' }, { side: 'E', at: 12, to: 'secret2' }],
      props: [{ x: 10, y: 6, w: 6, h: 3, draw: roundTable }],
    },
    secret1: {
      name: '밀실 1', desc: '들어온 사람끼리만 보이는 작은 방 (예정)', w: 14, h: 10, pos: [3, 0.55], crowd: 2,
      floor: '#e9e2f7', line: '#d8cdef', trim: '#6b4fb3',
      emotes: ['쉿', '여기서 한 얘기는 비밀', '...'],
      doors: [{ side: 'W', at: 5, to: 'council' }],
      props: [{ x: 6, y: 4, w: 2, h: 1, draw: smallTable }],
    },
    secret2: {
      name: '밀실 2', desc: '들어온 사람끼리만 보이는 작은 방 (예정)', w: 14, h: 10, pos: [3, 1.45], crowd: 1,
      floor: '#e9e2f7', line: '#d8cdef', trim: '#6b4fb3',
      emotes: ['쉿', '...'],
      doors: [{ side: 'W', at: 5, to: 'council' }],
      props: [{ x: 6, y: 4, w: 2, h: 1, draw: smallTable }],
    },
    plaza: {
      name: '구름 광장', desc: '모여서 노는 곳 · 이벤트가 열리는 곳', w: 34, h: 20, pos: [1, 0], crowd: 14,
      floor: '#f7fbff', line: '#e3ecf8', trim: '#4bb3c4',
      emotes: ['3팀 모여~', 'ㅋㅋㅋ', '안녕!', '이벤트 언제?', '같이 다닐 사람', '우리 나라 짱'],
      doors: [{ side: 'S', at: 17, to: 'temple' }, { side: 'N', at: 17, to: 'wander' }],
      props: [
        { x: 15, y: 8, w: 4, h: 3, draw: fountain },
        { x: 6, y: 5, w: 3, h: 1, draw: bench }, { x: 25, y: 5, w: 3, h: 1, draw: bench },
        { x: 6, y: 14, w: 3, h: 1, draw: bench }, { x: 25, y: 14, w: 3, h: 1, draw: bench },
      ],
    },
    wander: {
      name: '유랑민 쉼터', desc: '나라 없는 사람들 · 귀화·용병 모집', w: 24, h: 14, pos: [1, -1], crowd: 6,
      floor: '#f0f8ec', line: '#ddebd6', trim: '#3fa37a',
      emotes: ['용병 구합니다', '귀화시켜 주세요', '우리 4명 모이면 건국함', '몸값 얼마?', '어느 나라가 좋음?'],
      doors: [{ side: 'S', at: 12, to: 'plaza' }],
      props: [
        { x: 9, y: 2, w: 6, h: 1, board: true, draw: (g, x, y) => board(g, x, y, '귀화·용병 모집') },
        { x: 4, y: 8, w: 1, h: 1, draw: lantern }, { x: 19, y: 8, w: 1, h: 1, draw: lantern },
      ],
    },
  };

  const SKY_M = 90;
  function buildRooms() {
    for (const [id, R] of Object.entries(ROOMS)) {
      R.id = id;
      R.grid = new Uint8Array(R.w * R.h);
      for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) if (x === 0 || y === 0 || x === R.w - 1 || y === R.h - 1) R.grid[y * R.w + x] = 1;
      R.doors.forEach((d, i) => {
        for (let k = -1; k <= 1; k++) {
          const [x, y] = d.side === 'N' ? [d.at + k, 0] : d.side === 'S' ? [d.at + k, R.h - 1] : d.side === 'W' ? [0, d.at + k] : [R.w - 1, d.at + k];
          R.grid[y * R.w + x] = 10 + i;
        }
      });
      for (const p of R.props) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) R.grid[y * R.w + x] = 1;
      R.sprites = R.props.map((p) => ({ x: (p.x + p.w / 2) * TILE, y: (p.y + p.h) * TILE, draw: p.draw, board: p.board, prop: p }));
      R.doors.forEach((d) => {
        const label = d.to === 'ground' ? '땅으로 내려가기' : ROOMS[d.to].name;
        const [x, y] = d.side === 'N' ? [(d.at + 0.5) * TILE, TILE] : d.side === 'S' ? [(d.at + 0.5) * TILE, R.h * TILE] : d.side === 'W' ? [TILE, (d.at + 1) * TILE] : [(R.w - 1) * TILE, (d.at + 1) * TILE];
        R.sprites.push({ x, y, draw: (g, X, Y) => arch(g, X, Y, d.side, label, d.to === 'ground') });
      });
      R.canvas = renderRoom(R);
    }
  }

  function renderRoom(R) {
    const c = document.createElement('canvas');
    const w = R.w * TILE, h = R.h * TILE;
    c.width = w + SKY_M * 2; c.height = h + SKY_M * 2;
    const g = c.getContext('2d');
    g.translate(SKY_M, SKY_M);
    const rim = [];
    const step = 26;
    for (let x = 0; x <= w; x += step) { rim.push([x, 0]); rim.push([x, h]); }
    for (let y = 0; y <= h; y += step) { rim.push([0, y]); rim.push([w, y]); }
    g.fillStyle = 'rgba(110,130,200,0.22)';
    for (const [x, y] of rim) circ(g, x, y + 30, 30 + hash(x, y) * 14);
    g.fillStyle = '#e4ebfb';
    for (const [x, y] of rim) circ(g, x, y + 8, 28 + hash(x, y, 2) * 14);
    g.fillStyle = '#ffffff';
    for (const [x, y] of rim) circ(g, x, y, 26 + hash(x, y, 3) * 14);
    g.fillStyle = R.floor; rr(g, 18, 18, w - 36, h - 36, 18);
    g.strokeStyle = R.line; g.lineWidth = 2;
    for (let x = TILE; x < w - TILE; x += TILE) { g.beginPath(); g.moveTo(x, 22); g.lineTo(x, h - 22); g.stroke(); }
    for (let y = TILE; y < h - TILE; y += TILE) { g.beginPath(); g.moveTo(22, y); g.lineTo(w - 22, y); g.stroke(); }
    g.strokeStyle = R.trim; g.lineWidth = 4; g.beginPath(); g.roundRect ? g.roundRect(30, 30, w - 60, h - 60, 12) : g.rect(30, 30, w - 60, h - 60); g.stroke();
    for (const d of R.doors) {
      g.fillStyle = d.to === 'ground' ? 'rgba(255,236,140,0.85)' : R.floor;
      if (d.side === 'N') g.fillRect((d.at - 1) * TILE, 0, TILE * 3, TILE + 20);
      if (d.side === 'S') g.fillRect((d.at - 1) * TILE, h - TILE - 20, TILE * 3, TILE + 20);
      if (d.side === 'W') g.fillRect(0, (d.at - 1) * TILE, TILE + 20, TILE * 3);
      if (d.side === 'E') g.fillRect(w - TILE - 20, (d.at - 1) * TILE, TILE + 20, TILE * 3);
    }
    return c;
  }

  function roomBlocked(R, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= R.w || ty >= R.h) return true;
    return R.grid[ty * R.w + tx] === 1;
  }
  function roomSpot(R, r) {
    for (let i = 0; i < 200; i++) {
      const x = 2 + ((r() * (R.w - 4)) | 0), y = 2 + ((r() * (R.h - 4)) | 0);
      if (R.grid[y * R.w + x] === 0) return [x, y];
    }
    return [R.w >> 1, R.h >> 1];
  }
  function doorInside(R, d) {
    const [x, y] = d.side === 'N' ? [d.at, 2] : d.side === 'S' ? [d.at, R.h - 3] : d.side === 'W' ? [2, d.at] : [R.w - 3, d.at];
    return [x * TILE + 16, y * TILE + 16];
  }

  let fadeT = 0;
  function enterRoom(id, fromId) {
    const R = ROOMS[id];
    const d = R.doors.find((q) => q.to === fromId) || R.doors[0];
    [player.x, player.y] = doorInside(R, d);
    player.scene = 'sky'; player.room = R; fadeT = 0.35; lastTerr = null;
  }
  function ascend(portalTerr) {
    player.entry = portalTerr;
    player.skyLeft = SKY_LIMIT;
    enterRoom('temple', 'ground');
    toast('하늘 신전에 올라왔어요 · 여기선 싸울 수 없어요');
  }
  function descend() {
    const t = player.entry || home;
    player.scene = 'ground'; player.room = null; fadeT = 0.35; lastTerr = null;
    player.x = t.portal[0] * TILE + 16; player.y = (t.portal[1] + 1) * TILE + 16;
    if (!free(player.x, player.y, null)) teleportTo(t.portal[0], t.portal[1] + 1);
    toast(`${t.name} 포털로 내려왔어요`);
  }
  function checkDoor() {
    const R = player.room;
    const v = R.grid[(player.y / TILE | 0) * R.w + (player.x / TILE | 0)];
    if (v >= 10) { const d = R.doors[v - 10]; if (d.to === 'ground') descend(); else enterRoom(d.to, R.id); }
  }

  // 하늘 소품
  function pillar(g, x, y) {
    g.fillStyle = 'rgba(0,0,0,0.12)'; ell(g, x, y, 20, 6);
    g.fillStyle = '#e8e2f5'; rr(g, x - 18, y - 12, 36, 12, 4);
    g.fillStyle = '#ffffff'; g.fillRect(x - 11, y - 118, 22, 108);
    g.fillStyle = '#ece6f7'; g.fillRect(x + 3, y - 118, 8, 108);
    g.fillStyle = '#e2b93b'; rr(g, x - 18, y - 130, 36, 14, 4);
  }
  function board(g, x, y, label) {
    g.fillStyle = 'rgba(0,0,0,0.12)'; ell(g, x, y, 60, 8);
    g.fillStyle = '#8b5e3c'; g.fillRect(x - 54, y - 70, 6, 70); g.fillRect(x + 48, y - 70, 6, 70);
    g.fillStyle = '#c99a6b'; rr(g, x - 62, y - 92, 124, 62, 6);
    g.fillStyle = '#fffdf8';
    g.save(); g.translate(x - 40, y - 82); g.rotate(-0.05); g.fillRect(0, 0, 30, 36); g.restore();
    g.save(); g.translate(x - 4, y - 84); g.rotate(0.04); g.fillRect(0, 0, 34, 40); g.restore();
    g.fillStyle = '#e5486a'; circ(g, x - 25, y - 80, 3); circ(g, x + 13, y - 81, 3);
    sign(g, x, y - 112, label);
  }
  function stall(g, x, y, color, label) {
    g.fillStyle = 'rgba(0,0,0,0.12)'; ell(g, x, y, 70, 10);
    g.fillStyle = '#c99a6b'; g.fillRect(x - 60, y - 40, 120, 40);
    g.fillStyle = '#b07f50'; g.fillRect(x - 60, y - 12, 120, 12);
    g.fillStyle = '#8b5e3c'; g.fillRect(x - 58, y - 100, 5, 62); g.fillRect(x + 53, y - 100, 5, 62);
    for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#ffffff' : color; g.fillRect(x - 66 + i * 22, y - 112, 22, 26); }
    g.fillStyle = color; for (let i = 0; i < 6; i++) circ(g, x - 55 + i * 22, y - 86, 11);
    g.fillStyle = '#f2c14e'; circ(g, x - 30, y - 46, 7); g.fillStyle = '#9fd8e6'; circ(g, x - 10, y - 48, 7); g.fillStyle = '#ff8fa8'; circ(g, x + 22, y - 46, 7);
    sign(g, x, y - 132, label);
  }
  function roundTable(g, x, y) {
    const cy = y - 40;
    g.fillStyle = 'rgba(0,0,0,0.12)'; ell(g, x, cy + 30, 110, 26);
    const seats = 10;
    for (let i = 0; i < seats; i++) { const a = i / seats * Math.PI * 2; if (Math.sin(a) < 0) { g.fillStyle = '#5b7fd6'; rr(g, x + Math.cos(a) * 112 - 12, cy + Math.sin(a) * 50 - 22, 24, 26, 6); } }
    g.fillStyle = '#8b5e3c'; ell(g, x, cy + 10, 96, 40);
    g.fillStyle = '#b07f50'; ell(g, x, cy, 96, 40);
    g.fillStyle = '#fffdf8'; g.fillRect(x - 30, cy - 10, 26, 18); g.fillRect(x + 8, cy - 6, 26, 18);
    for (let i = 0; i < seats; i++) { const a = i / seats * Math.PI * 2; if (Math.sin(a) >= 0) { g.fillStyle = '#4a69bd'; rr(g, x + Math.cos(a) * 112 - 12, cy + Math.sin(a) * 50 - 6, 24, 26, 6); } }
  }
  function smallTable(g, x, y) {
    g.fillStyle = 'rgba(0,0,0,0.12)'; ell(g, x, y, 40, 8);
    g.fillStyle = '#6b4a2b'; g.fillRect(x - 34, y - 34, 68, 30);
    g.fillStyle = '#8b5e3c'; g.fillRect(x - 38, y - 40, 76, 10);
    g.fillStyle = '#fff2a8'; g.fillRect(x - 4, y - 56, 6, 16);
    g.fillStyle = 'rgba(255,210,90,0.5)'; circ(g, x - 1, y - 60, 9 + Math.sin(performance.now() / 120) * 1.5);
  }
  function fountain(g, x, y) {
    const cy = y - 40;
    g.fillStyle = 'rgba(0,0,0,0.12)'; ell(g, x, cy + 34, 80, 20);
    g.fillStyle = '#d6dcef'; ell(g, x, cy + 12, 70, 30);
    g.fillStyle = '#9fd8f5'; ell(g, x, cy + 6, 60, 24);
    g.fillStyle = '#d6dcef'; rr(g, x - 10, cy - 50, 20, 56, 6);
    const now = performance.now() / 1000;
    g.fillStyle = 'rgba(200,236,255,0.9)';
    for (let i = 0; i < 6; i++) { const k = (now * 0.8 + i / 6) % 1; const a = i / 6 * Math.PI * 2; circ(g, x + Math.cos(a) * k * 46, cy - 52 + k * k * 60, 3.5 * (1 - k) + 1); }
  }
  function bench(g, x, y) {
    g.fillStyle = 'rgba(0,0,0,0.12)'; ell(g, x, y, 48, 7);
    g.fillStyle = '#8b5e3c'; g.fillRect(x - 40, y - 22, 6, 22); g.fillRect(x + 34, y - 22, 6, 22);
    g.fillStyle = '#c99a6b'; rr(g, x - 46, y - 30, 92, 12, 4); rr(g, x - 46, y - 50, 92, 12, 4);
  }
  function lantern(g, x, y) {
    g.fillStyle = 'rgba(0,0,0,0.12)'; ell(g, x, y, 12, 4);
    g.fillStyle = '#6b4a2b'; g.fillRect(x - 2, y - 80, 4, 80);
    g.fillStyle = 'rgba(255,210,90,0.35)'; circ(g, x, y - 86, 18 + Math.sin(performance.now() / 300) * 2);
    g.fillStyle = '#ffd36b'; rr(g, x - 9, y - 98, 18, 22, 5);
  }
  function arch(g, x, y, side, label, down) {
    const vertical = side === 'W' || side === 'E';
    if (vertical) {
      g.fillStyle = down ? '#ffe98a' : '#e2b93b';
      g.fillRect(x - 6, y - 3 * TILE - 70, 12, 70); g.fillRect(x - 6, y - 70, 12, 70);
      sign(g, x + (side === 'W' ? 70 : -70), y - 2 * TILE - 40, (side === 'W' ? '← ' : '') + label + (side === 'E' ? ' →' : ''));
    } else {
      g.fillStyle = down ? '#ffe98a' : '#e2b93b';
      g.fillRect(x - 1.5 * TILE - 8, y - 110, 12, 110); g.fillRect(x + 1.5 * TILE - 4, y - 110, 12, 110);
      g.beginPath(); g.lineWidth = 12; g.strokeStyle = g.fillStyle; g.arc(x, y - 110, 1.5 * TILE + 2, Math.PI, 0); g.stroke();
      if (down) { g.fillStyle = 'rgba(255,240,170,0.45)'; g.fillRect(x - 1.5 * TILE + 4, y - 110, 3 * TILE - 8, 110); }
      sign(g, x, y - 180, (side === 'N' ? '↑ ' : '↓ ') + label);
    }
  }

  function drawSkyBackground(t) {
    const grd = ctx.createLinearGradient(0, 0, 0, vh);
    grd.addColorStop(0, DOOM ? '#cbb6ee' : '#a9dcff'); grd.addColorStop(1, DOOM ? '#ffd2dc' : '#fdf3ff');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, vw, vh);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    for (let i = 0; i < 9; i++) {
      const x = ((i * 337 + t * (8 + i * 2)) % (vw + 400)) - 200, y = (i * 173) % Math.max(1, vh);
      ell(ctx, x, y, 120 + (i % 3) * 40, 26 + (i % 2) * 10);
    }
  }

  // ------------------------------------------------------------ 플레이어와 가짜 참가자
  const saved = store('mp2026.look') || {};
  // 프로토타입 인벤토리 (이 브라우저에만 저장. 실제 게임은 서버가 관리)
  const inv = Object.assign({ coin: 1200, army: 40, vaccine: 0, bought: 0 }, store('mp2026.inv') || {});
  const usedCodes = new Set(store('mp2026.codes') || []);
  const mined = new Set(store('mp2026.mined.d' + DAY) || []);
  const VACCINE_BASE = 3000, VACCINE_STEP = 500, SKY_LIMIT = 5 * 60;
  const vaccinePrice = () => VACCINE_BASE + VACCINE_STEP * inv.bought;
  function saveInv() { store('mp2026.inv', inv); renderInv(); }
  function renderInv() { $('invCoin').textContent = inv.coin.toLocaleString(); $('invArmy').textContent = inv.army.toLocaleString(); $('invVac').textContent = inv.vaccine; }
  const player = {
    x: 0, y: 0, dir: 1, moving: false, scene: 'ground', room: null, entry: null,
    name: saved.name || '나', tag: '#277a58',
    look: { hair: saved.hair || '#8a5a3c', outfit: saved.outfit || '#3fa37a', skin: '#ffe1cc', accent: '#ff5d7a', long: saved.long !== false, me: true, seed: 0 },
  };
  const bots = [];
  const BOT_NAMES = ['하늘', '노을', '바람', '별', '모래', '파도', '숲', '달', '해', '구름', '불꽃', '이슬', '여름', '초코', '봄비', '단비', '솔', '우주', '감자', '고래'];
  const EMOTES = ['3팀 모여~', '거래 구함!', '문제 같이 풀 사람?', '동맹 할래?', '여기 땅 좋다', '!', '?', 'ㅋㅋㅋ', '수도 어디 잡지'];

  function randomPassable(r, cx, cy, rad) {
    for (let i = 0; i < 400; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
      const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
      if (!blocked(x, y)) return [x, y];
    }
    return [cx, cy];
  }

  function spawnBots() {
    const r = rng(2026);
    const make = (cx, cy, rad, room) => {
      const [tx, ty] = room ? roomSpot(room, r) : randomPassable(r, cx, cy, rad);
      const team = 1 + ((r() * 12) | 0);
      const ty_ = TYPES[(r() * 6) | 0];
      bots.push({
        x: tx * TILE + 16, y: ty * TILE + 16, dir: r() < 0.5 ? -1 : 1, moving: false,
        name: `${team}팀 · ${BOT_NAMES[(r() * BOT_NAMES.length) | 0]}`, tag: TYPE_TAG[ty_],
        look: { hair: HAIRS[(r() * 6) | 0], outfit: OUTFITS[(r() * 6) | 0], skin: SKINS[(r() * 3) | 0], accent: TYPE_FILL[TYPES[(r() * 6) | 0]], long: r() < 0.45, seed: r() * 3 },
        home: [cx, cy, rad], goal: null, wait: r() * 3, speed: (0.55 + r() * 0.35) * WALK,
        emote: null, emoteT: 0, rand: rng((r() * 1e9) | 0),
        scene: room ? 'sky' : 'ground', room: room || null,
      });
    };
    for (const room of Object.values(ROOMS)) for (let i = 0; i < room.crowd; i++) make(0, 0, 0, room);
    for (let i = 0; i < 25; i++) { const t = terrs[1 + ((r() * (terrs.length - 1)) | 0)]; if (t && !gone[t.id]) make(t.altar[0], t.altar[1], 14, null); }
    for (const t of terrs) if (t && t.capitalCandidate && !gone[t.id] && r() < 0.6) for (let k = 0, n = 1 + ((r() * 3) | 0); k < n; k++) make(t.altar[0], t.altar[1], 8, false);
  }

  function updateBot(b, dt) {
    if (b.emote) { b.emoteT -= dt; if (b.emoteT <= 0) b.emote = null; }
    else if (b.rand() < dt * 0.04) { const list = b.room ? b.room.emotes : EMOTES; b.emote = list[(b.rand() * list.length) | 0]; b.emoteT = 3 + b.rand() * 2; }
    if (b.wait > 0) { b.wait -= dt; b.moving = false; return; }
    if (!b.goal) { const [cx, cy, rad] = b.home; const [gx, gy] = b.room ? roomSpot(b.room, b.rand) : randomPassable(b.rand, cx, cy, rad); b.goal = [gx * TILE + 16, gy * TILE + 16]; }
    const dx = b.goal[0] - b.x, dy = b.goal[1] - b.y, d = Math.hypot(dx, dy);
    if (d < 6) { b.goal = null; b.wait = 1 + b.rand() * 4; b.moving = false; return; }
    const s = b.speed * (b.room ? 1 : speedAt(b.x / TILE | 0, b.y / TILE | 0)) * dt;
    const moved = tryMove(b, dx / d * s, dy / d * s);
    b.moving = moved;
    if (Math.abs(dx) > 2) b.dir = dx < 0 ? -1 : 1;
    if (!moved) { b.goal = null; b.wait = 0.5; }
  }

  // 충돌: 발 밑 14x8 상자
  function free(px, py, room) {
    const pts = [[px - 7, py - 4], [px + 7, py - 4], [px - 7, py + 4], [px + 7, py + 4]];
    for (const [x, y] of pts) {
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (room ? roomBlocked(room, tx, ty) : blocked(tx, ty)) return false;
    }
    return true;
  }
  function tryMove(o, dx, dy) {
    let moved = false;
    const room = o.scene === 'sky' ? o.room : null;
    if (dx && free(o.x + dx, o.y, room)) { o.x += dx; moved = true; }
    if (dy && free(o.x, o.y + dy, room)) { o.y += dy; moved = true; }
    return moved;
  }

  // ------------------------------------------------------------ 입력
  const keys = new Set();
  const stick = { on: false, id: null, ox: 0, oy: 0, vx: 0, vy: 0 };
  let zoom = window.innerWidth < 720 ? 0.8 : 1;

  addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (k === 'm') toggleMap();
    if (k === 't') goHome();
    if (k === 'e') interact();
    if (k === '[' || k === ']') { location.hash = 'day' + Math.max(1, Math.min(15, DAY + (k === ']' ? 1 : -1))); }
    if (k === 'escape') { $('bigmap').hidden = true; $('closet').hidden = true; $('coupon').hidden = true; }
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.5, Math.min(1.6, zoom * (e.deltaY < 0 ? 1.1 : 0.9))); }, { passive: false });

  const stickEl = $('stick'), knob = stickEl.firstElementChild;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    stick.on = true; stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.vx = stick.vy = 0;
    stickEl.style.left = (e.clientX - 55) + 'px'; stickEl.style.top = (e.clientY - 55) + 'px'; stickEl.hidden = false;
    knob.style.transform = 'translate(0,0)';
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!stick.on || e.pointerId !== stick.id) return;
    let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
    const d = Math.hypot(dx, dy), m = 45;
    if (d > m) { dx = dx / d * m; dy = dy / d * m; }
    stick.vx = dx / m; stick.vy = dy / m;
    knob.style.transform = `translate(${dx}px,${dy}px)`;
  });
  const endStick = (e) => { if (e.pointerId === stick.id) { stick.on = false; stick.vx = stick.vy = 0; stickEl.hidden = true; } };
  canvas.addEventListener('pointerup', endStick);
  canvas.addEventListener('pointercancel', endStick);

  // ------------------------------------------------------------ HUD
  let lastTerr = null;
  const chip = (text, color, line) => { const s = document.createElement('span'); s.className = 'chip' + (line ? ' line' : ''); s.textContent = text; if (color) s.style.background = color; $('whereChips').appendChild(s); };
  function updateWhere() {
    if (player.scene === 'sky') {
      const R = player.room;
      if (lastTerr === 'sky:' + R.id) return;
      lastTerr = 'sky:' + R.id;
      $('whereChips').textContent = '';
      $('whereName').textContent = `하늘 · ${R.name}`;
      $('whereSub').textContent = R.desc;
      chip('중립 · 전투 불가', '#2b2340');
      if (R.id === 'council' || R.id.startsWith('secret')) chip('작전 회의는 나라 구글챗에서', null, true);
      return;
    }
    const tx = player.x / TILE | 0, ty = player.y / TILE | 0;
    const o = terrAt(tx, ty);
    if (o === lastTerr) return;
    lastTerr = o;
    $('whereChips').textContent = '';
    if (o > 0) {
      const t = terrs[o];
      $('whereName').textContent = t.name;
      $('whereSub').textContent = `영토 #${t.id} · ${t.type} 지방 · ${RING[t.ring]} · 넓이 ${t.area.toLocaleString()}칸`;
      chip(`${t.type} 문제`, TYPE_TAG[t.type]);
      if (t === home) chip('우리 수도 (테스트)', '#277a58'); else chip('주인 없음 (중립)', null, true);
      if (t.capitalCandidate) chip('수도 후보 · 하늘 포털', '#c22f53');
    } else {
      $('whereName').textContent = '알 수 없는 땅';
      $('whereSub').textContent = '';
    }
  }

  let near = null;   // { kind: 'portal'|'altar'|'board', t, text }
  function updatePrompt() {
    let best = null;
    if (player.scene === 'sky') {
      for (const sp of player.room.sprites) {
        if (sp.board && Math.hypot(sp.x - player.x, sp.y + 16 - player.y) < 90) best = { kind: 'board', text: '게시판 읽기' };
        if (sp.prop && sp.prop.shop === 'vaccine' && Math.hypot(sp.x - player.x, sp.y + 20 - player.y) < 100) best = { kind: 'vaccine', text: `백신 사기 · 코인 ${vaccinePrice().toLocaleString()}` };
      }
    } else {
      const tx = player.x / TILE, ty = player.y / TILE;
      const o = terrAt(tx | 0, ty | 0);
      if (o > 0) {
        const t = terrs[o];
        const n = nodes.find((q) => q.id === t.id);
        if (t.portal && Math.hypot(t.portal[0] + 0.5 - tx, t.portal[1] + 0.5 - ty) < 1.8) best = { kind: 'portal', t, text: '하늘로 올라가기' };
        else if (n && Math.hypot(n.x - player.x, n.y - player.y) < 52) best = { kind: 'node', n, text: mined.has(n.id) ? '오늘은 다 캤어요 (내일 다시)' : '금광 캐기 · 코인' };
        else if (Math.hypot(t.altar[0] + 0.5 - tx, t.altar[1] + 0.5 - ty) < 2.4) best = { kind: 'altar', t, text: `${t.name} 제단 · ${t.type} 문제 풀기` };
      }
    }
    const key = best ? best.kind + best.text : '';
    if (key !== (near ? near.kind + near.text : '')) {
      $('prompt').hidden = !best;
      if (best) $('promptText').textContent = best.text;
    }
    near = best;
  }
  let toastTimer = 0;
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800); }
  function interact() {
    if (!near) return;
    if (near.kind === 'portal') ascend(near.t);
    else if (near.kind === 'node') {
      if (mined.has(near.n.id)) { toast('이 금광은 오늘 이미 캤어요'); return; }
      const got = 300 + Math.round(hash(near.n.id, DAY, 5) * 30) * 10;
      inv.coin += got; mined.add(near.n.id); store('mp2026.mined.d' + DAY, [...mined]); saveInv(); near = null;
      toast(`금광에서 코인 ${got}을 캤어요`);
    } else if (near.kind === 'vaccine') {
      const price = vaccinePrice();
      if (inv.coin < price) { toast(`코인이 ${(price - inv.coin).toLocaleString()} 모자라요`); return; }
      inv.coin -= price; inv.vaccine += 1; inv.bought += 1; saveInv(); near = null;
      toast(`백신을 샀어요 · 보유 ${inv.vaccine}개 (다음 가격 ${vaccinePrice().toLocaleString()})`);
    }
    else if (near.kind === 'altar') toast(`'${near.t.type}' 퍼즐은 다음 단계에서 붙일 예정이에요`);
    else if (near.kind === 'board') {
      if (player.room.id === 'wander') toast('[모집] 4팀 용병 1명 · 몸값 협의 / [귀화] 라온주가 국민을 받습니다');
      else if (!DOOM) toast('[공지] 신들은 아직 침묵하고 있다.');
      else toast(`[신탁] 다음 균열이 다가온다… ${TYPES[DAY % 6]} 지방을 조심하라.`);
    }
  }

  function goHome() {
    if (player.scene === 'sky') { descend(); return; }
    player.x = home.portal[0] * TILE + 16; player.y = (home.portal[1] + 1) * TILE + 16;
    if (!free(player.x, player.y, null)) teleportTo(home.portal[0], home.portal[1] + 1);
    lastTerr = null;
    toast(`우리 수도 ${home.name}(으)로 돌아왔어요`);
  }

  // ------------------------------------------------------------ 지도 이미지 (미니맵·세계 지도)
  let mapImg = null;
  function buildMapImage() {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const d = img.data;
    const base = { [T.VOID]: [27, 20, 48], [T.WATER]: [111, 183, 232], [T.MOUNTAIN]: [138, 129, 151] };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, t = terrain[i], o = terr[i];
      let c3 = base[t];
      if (o !== 65535 && o > 0 && gone[o]) c3 = [52, 30, 88];
      else if (!c3) {
        const tt = terrs[o];
        const rgb = tt ? TYPE_RGB[tt.type] : [159, 216, 138];
        const k = t === T.FOREST ? 0.78 : t === T.SAND ? 1.05 : 0.95;
        c3 = [rgb[0] * k * 0.55 + 100, rgb[1] * k * 0.55 + 100, rgb[2] * k * 0.55 + 100];
        const r = x + 1 < W ? terr[i + 1] : o, dn = y + 1 < H ? terr[i + W] : o;
        if ((r !== o && r !== 65535 && r !== 0) || (dn !== o && dn !== 65535 && dn !== 0)) c3 = [70, 60, 95];
      }
      d[i * 4] = c3[0]; d[i * 4 + 1] = c3[1]; d[i * 4 + 2] = c3[2]; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    for (const t of terrs) if (t && t.capitalCandidate && !gone[t.id]) { g.fillStyle = '#e5486a'; g.fillRect(t.altar[0] - 3, t.altar[1] - 3, 7, 7); g.fillStyle = '#ffffff'; g.fillRect(t.altar[0] - 1, t.altar[1] - 1, 3, 3); }
    mapImg = c;
  }

  const mini = $('miniCanvas'), mg = mini.getContext('2d');
  function drawSkyMini() {
    const s = mini.width;
    mg.fillStyle = '#d7ecff'; mg.fillRect(0, 0, s, s);
    const P = (R) => [s * (0.16 + R.pos[0] * 0.23), s * (0.38 + R.pos[1] * 0.22)];
    mg.strokeStyle = '#ffffff'; mg.lineWidth = 6;
    for (const R of Object.values(ROOMS)) for (const d of R.doors) if (d.to !== 'ground') { const [a, b] = P(R), [c, e] = P(ROOMS[d.to]); mg.beginPath(); mg.moveTo(a, b); mg.lineTo(c, e); mg.stroke(); }
    mg.font = '700 22px "Noto Sans KR", sans-serif'; mg.textAlign = 'center'; mg.textBaseline = 'middle';
    for (const R of Object.values(ROOMS)) {
      const [x, y] = P(R), w = R.id.startsWith('secret') ? 60 : 84, h = R.id.startsWith('secret') ? 34 : 44;
      mg.fillStyle = R === player.room ? '#2b2340' : '#ffffff'; rr(mg, x - w / 2, y - h / 2, w, h, 10);
      mg.strokeStyle = '#2b2340'; mg.lineWidth = 3; mg.stroke();
      mg.fillStyle = R === player.room ? '#ffffff' : '#2b2340';
      mg.fillText(R.name.replace('하늘 ', '').replace('유랑민 ', ''), x, y + 1);
      R._mini = [x, y, w, h];
    }
  }
  function drawMini() {
    if (player.scene === 'sky') { drawSkyMini(); return; }
    const s = mini.width;
    const span = 180; // 미니맵이 보여주는 타일 범위
    const tx = player.x / TILE, ty = player.y / TILE;
    mg.fillStyle = '#1b1430'; mg.fillRect(0, 0, s, s);
    mg.imageSmoothingEnabled = false;
    mg.drawImage(mapImg, tx - span / 2, ty - span / 2, span, span, 0, 0, s, s);
    const k = s / span;
    mg.fillStyle = 'rgba(255,255,255,0.85)';
    for (const b of bots) { if (b.scene !== 'ground') continue; const bx = (b.x / TILE - tx + span / 2) * k, by = (b.y / TILE - ty + span / 2) * k; if (bx > 0 && by > 0 && bx < s && by < s) mg.fillRect(bx - 2, by - 2, 4, 4); }
    const vw = canvas.clientWidth / zoom / TILE * k, vh = canvas.clientHeight / zoom / TILE * k;
    mg.strokeStyle = '#ffffff'; mg.lineWidth = 2; mg.strokeRect(s / 2 - vw / 2, s / 2 - vh / 2, vw, vh);
    mg.fillStyle = '#ffd23f'; mg.strokeStyle = '#2b2340'; mg.lineWidth = 2; mg.beginPath(); mg.arc(s / 2, s / 2, 6, 0, Math.PI * 2); mg.fill(); mg.stroke();
  }
  function teleportTo(tx, ty) {
    for (let r = 0; r < 30; r++) for (let a = 0; a < 16; a++) {
      const x = Math.round(tx + Math.cos(a / 16 * Math.PI * 2) * r), y = Math.round(ty + Math.sin(a / 16 * Math.PI * 2) * r);
      if (!blocked(x, y)) { player.scene = 'ground'; player.room = null; lastTerr = null; player.x = x * TILE + 16; player.y = y * TILE + 16; return true; }
    }
    return false;
  }
  mini.addEventListener('click', (e) => {
    const r = mini.getBoundingClientRect();
    if (player.scene === 'sky') {
      const mx = (e.clientX - r.left) / r.width * mini.width, my = (e.clientY - r.top) / r.height * mini.height;
      for (const R of Object.values(ROOMS)) { const [x, y, w, h] = R._mini || [0, 0, 0, 0]; if (Math.abs(mx - x) < w / 2 && Math.abs(my - y) < h / 2) { enterRoom(R.id, null); [player.x, player.y] = [(R.w >> 1) * TILE + 16, (R.h - 4) * TILE + 16]; } }
      return;
    }
    const span = 180;
    const tx = player.x / TILE + ((e.clientX - r.left) / r.width - 0.5) * span;
    const ty = player.y / TILE + ((e.clientY - r.top) / r.height - 0.5) * span;
    teleportTo(tx, ty);
  });

  const big = $('bigCanvas'), bg = big.getContext('2d');
  function drawBig() {
    bg.imageSmoothingEnabled = false;
    bg.drawImage(mapImg, 0, 0, big.width, big.height);
    const k = big.width / W;
    bg.fillStyle = '#ffffff';
    for (const b of bots) if (b.scene === 'ground') bg.fillRect(b.x / TILE * k - 1.5, b.y / TILE * k - 1.5, 3, 3);
    for (const t of terrs) if (t && t.portal && !gone[t.id]) { bg.fillStyle = '#ffec8c'; bg.beginPath(); bg.arc(t.portal[0] * k, t.portal[1] * k, 3, 0, Math.PI * 2); bg.fill(); }
    const px = player.scene === 'sky' ? (player.entry || home).portal[0] * TILE : player.x, py = player.scene === 'sky' ? (player.entry || home).portal[1] * TILE : player.y;
    bg.fillStyle = '#ffd23f'; bg.strokeStyle = '#2b2340'; bg.lineWidth = 3;
    bg.beginPath(); bg.arc(px / TILE * k, py / TILE * k, 8, 0, Math.PI * 2); bg.fill(); bg.stroke();
  }
  function toggleMap(force) {
    const el = $('bigmap');
    el.hidden = force !== undefined ? !force : !el.hidden;
    if (!el.hidden) drawBig();
  }
  big.addEventListener('click', (e) => {
    const r = big.getBoundingClientRect();
    if (teleportTo((e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H)) toggleMap(false);
  });
  $('btnMap').addEventListener('click', () => toggleMap());
  $('btnMapClose').addEventListener('click', () => toggleMap(false));
  $('btnHome').addEventListener('click', goHome);
  (function legend() {
    const L = $('legend');
    for (const ty of TYPES) { const s = document.createElement('span'); s.className = 'chip'; s.style.background = TYPE_TAG[ty]; s.textContent = `${ty} 지방`; L.appendChild(s); }
    const c = document.createElement('span'); c.className = 'chip'; c.style.background = '#c22f53'; c.textContent = '■ 수도 후보'; L.appendChild(c);
    const q = document.createElement('span'); q.className = 'chip'; q.style.background = '#7a5c00'; q.textContent = '● 하늘 포털'; L.appendChild(q);
    const n = document.createElement('span'); n.className = 'chip line'; n.textContent = '지도를 누르면 그곳으로 이동 (테스트)'; L.appendChild(n);
  })();

  // 꾸미기
  function closetUI() {
    const mk = (wrap, list, key) => {
      wrap.textContent = '';
      list.forEach((c, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sw'; b.style.background = c;
        b.setAttribute('aria-label', `${key === 'hair' ? '머리색' : '옷 색'} ${i + 1}`);
        b.setAttribute('aria-pressed', String(player.look[key] === c));
        b.addEventListener('click', () => { player.look[key] = c; player.look._dark = null; closetUI(); saveLook(); });
        wrap.appendChild(b);
      });
    };
    mk($('hairSw'), HAIRS.concat(['#8a5a3c']), 'hair');
    mk($('outfitSw'), OUTFITS, 'outfit');
    for (const b of $('lenSeg').children) b.setAttribute('aria-pressed', String((b.dataset.long === '1') === player.look.long));
  }
  function saveLook() { store('mp2026.look', { name: player.name, hair: player.look.hair, outfit: player.look.outfit, long: player.look.long }); }
  for (const b of $('lenSeg').children) b.addEventListener('click', () => { player.look.long = b.dataset.long === '1'; closetUI(); saveLook(); });
  $('nick').addEventListener('input', (e) => { player.name = e.target.value.trim() || '나'; tagW.delete(player.name); saveLook(); });
  $('btnCloset').addEventListener('click', () => { $('nick').value = player.name; closetUI(); $('closet').hidden = false; });
  $('btnClosetDone').addEventListener('click', () => { $('closet').hidden = true; });

  // 쿠폰 (오프라인에서 받은 1회용 코드). 실제 게임에서는 서버가 확인하고, 한 번 쓰면 모두에게 사라진다.
  const DEMO_CODES = { 'MP-TEST-0001': { coin: 1000 }, 'MP-TEST-0002': { army: 30 }, 'MP-TEST-0003': { vaccine: 1 } };
  const REWARD_NAME = { coin: '코인', army: '병력', vaccine: '백신' };
  function redeem() {
    const raw = $('couponIn').value.toUpperCase().replace(/\s+/g, '');
    const code = /^MP[A-Z0-9]{8}$/.test(raw) ? `MP-${raw.slice(2, 6)}-${raw.slice(6)}` : raw;
    const msg = $('couponMsg');
    if (!/^MP-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) { msg.textContent = '코드 모양이 달라요. 예: MP-AB12-CD34'; return; }
    if (usedCodes.has(code)) { msg.textContent = '이미 사용한 코드예요.'; return; }
    const r = DEMO_CODES[code];
    if (!r) { msg.textContent = '없는 코드예요. (지금은 미리보기라 MP-TEST-0001~0003만 받아요)'; return; }
    for (const [k, v] of Object.entries(r)) inv[k] += v;
    usedCodes.add(code); store('mp2026.codes', [...usedCodes]); saveInv();
    msg.textContent = `받았어요: ${Object.entries(r).map(([k, v]) => `${REWARD_NAME[k]} +${v}`).join(', ')}`;
    $('couponIn').value = '';
  }
  $('btnCoupon').addEventListener('click', () => { $('couponMsg').textContent = '점심시간에 받은 코드를 입력하세요. 코드는 한 번만 쓸 수 있어요.'; $('coupon').hidden = false; $('couponIn').focus(); });
  $('btnCouponUse').addEventListener('click', redeem);
  $('couponIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') redeem(); });
  $('btnCouponClose').addEventListener('click', () => { $('coupon').hidden = true; });

  // ------------------------------------------------------------ 루프
  let dpr = 1, vw = 0, vh = 0;
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = canvas.clientWidth; vh = canvas.clientHeight;
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
  }
  addEventListener('resize', resize);

  let last = performance.now(), hudT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = now / 1000;

    // 플레이어 이동
    let mx = 0, my = 0;
    if (keys.has('arrowleft') || keys.has('a')) mx -= 1;
    if (keys.has('arrowright') || keys.has('d')) mx += 1;
    if (keys.has('arrowup') || keys.has('w')) my -= 1;
    if (keys.has('arrowdown') || keys.has('s')) my += 1;
    if (stick.on) { mx = stick.vx; my = stick.vy; }
    const mag = Math.hypot(mx, my);
    player.moving = mag > 0.15;
    if (player.moving) {
      const terrainK = player.scene === 'sky' ? 1 : speedAt(player.x / TILE | 0, player.y / TILE | 0);
      const sp = WALK * (keys.has('shift') ? 3 : 1) * terrainK * Math.min(1, mag);
      tryMove(player, mx / mag * sp * dt, my / mag * sp * dt);
      if (Math.abs(mx) > 0.1) player.dir = mx < 0 ? -1 : 1;
      if (player.scene === 'sky') checkDoor();
    }
    if (player.scene === 'sky') {
      player.skyLeft -= dt;
      if (player.skyLeft <= 0) { descend(); toast('하늘에 머물 수 있는 5분이 끝나 땅으로 내려왔어요'); }
    }
    for (const b of bots) updateBot(b, dt);
    if (player.scene === 'sky') drawSky(t); else drawGround(t);
    if (fadeT > 0) { fadeT -= dt; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = `rgba(255,255,255,${Math.max(0, fadeT / 0.35)})`; ctx.fillRect(0, 0, vw, vh); }

    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.15;
      const sky = player.scene === 'sky';
      $('skyTimer').hidden = !sky;
      if (sky) { const l = Math.max(0, Math.ceil(player.skyLeft)); $('skyLeft').textContent = `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; $('skyTimer').classList.toggle('warn', l <= 60); }
      updateWhere(); updatePrompt(); drawMini(); if (!$('bigmap').hidden) drawBig();
    }
    requestAnimationFrame(frame);
  }

  function drawActors(list, t) {
    list.sort((a, b) => a.y - b.y);
    ctx.imageSmoothingEnabled = true;
    for (const o of list) {
      if (o.draw) o.draw(ctx, o.x, o.y);
      else drawChibi(ctx, o.x, o.y, o.look, t, o.moving, o.dir);
    }
    for (const o of list) {
      if (o.draw) continue;
      nameTag(ctx, o.x, o.y - 62, o === player ? player.name : o.name, o === player ? player.tag : o.tag);
      if (o.emote) bubble(ctx, o.x, o.y - 86, o.emote);
    }
  }

  function drawSky(t) {
    const R = player.room;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSkyBackground(t);
    const RW = R.w * TILE, RH = R.h * TILE;
    const sw = vw / zoom, sh = vh / zoom;
    const camX = RW + 160 <= sw ? RW / 2 - sw / 2 : Math.max(-80, Math.min(RW + 80 - sw, player.x - sw / 2));
    const camY = RH + 260 <= sh ? RH / 2 - sh / 2 - 40 : Math.max(-200, Math.min(RH + 80 - sh, player.y - 40 - sh / 2));
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -camX * dpr * zoom, -camY * dpr * zoom);
    ctx.drawImage(R.canvas, -SKY_M, -SKY_M);
    const list = R.sprites.slice();
    for (const b of bots) if (b.room === R) list.push(b);
    list.push(player);
    drawActors(list, t);
  }

  function drawGround(t) {

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1b1430'; ctx.fillRect(0, 0, vw, vh);
    const camX = player.x - vw / 2 / zoom, camY = player.y - 40 - vh / 2 / zoom;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -camX * dpr * zoom, -camY * dpr * zoom);
    ctx.imageSmoothingEnabled = false;

    chunkBudget = 3;
    const ci0 = Math.floor(camX / CPX), cj0 = Math.floor(camY / CPX);
    const ci1 = Math.floor((camX + vw / zoom) / CPX), cj1 = Math.floor((camY + vh / zoom) / CPX);
    const order = [];
    for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++) order.push([i, j, Math.hypot(i * CPX + CPX / 2 - player.x, j * CPX + CPX / 2 - player.y)]);
    order.sort((a, b) => a[2] - b[2]);
    for (const [i, j] of order) {
      const c = getChunk(i, j);
      if (c) ctx.drawImage(c, i * CPX, j * CPX);
      else { ctx.fillStyle = '#9fd88a'; ctx.fillRect(i * CPX, j * CPX, CPX, CPX); }
    }

    // 깊이 정렬: 큰 물체 + 캐릭터
    const x0 = camX - 300, x1 = camX + vw / zoom + 300, y0 = camY - 100, y1 = camY + vh / zoom + 350;
    const list = [];
    for (const s of sprites) if (s.x > x0 && s.x < x1 && s.y > y0 && s.y < y1) list.push(s);
    for (const b of bots) if (b.scene === 'ground' && b.x > x0 && b.x < x1 && b.y > y0 && b.y < y1) list.push(b);
    list.push(player);
    drawActors(list, t);
  }

  // ------------------------------------------------------------ 시작
  function setupDoomCard() {
    const date = 13 + DAY;
    if (!DOOM) {
      $('doomL').textContent = '아직은 평화로운 세계';
      $('doomD').textContent = `${DAY}일차`;
      $('doomR').textContent = `12/${date} · ${PHASE}`;
      $('doomBar').hidden = true;
    } else {
      $('doomL').textContent = '세계 멸망까지';
      $('doomD').textContent = DAY >= 15 ? '결전의 날' : `D-${15 - DAY}`;
      $('doomR').textContent = `${DAY}일차 · ${PHASE}`;
      $('doomFill').style.width = `${Math.round((DAY - 4) / 11 * 100)}%`;
      $('doomBar').hidden = false;
    }
  }

  loadWorld().then((data) => {
    setupWorld(data);
    buildRooms();
    buildMapImage();
    spawnBots();
    resize();
    goHome();
    $('toast').hidden = true;
    setupDoomCard();
    renderInv();
    $('loading').hidden = true;
    if (DAY === 5) setTimeout(() => toast('신들이 선포했다: 12월 28일, 이 세계는 끝난다.'), 600);
    else if (DOOM) { const n = terrs.filter((t) => t && gone[t.id]).length; if (n) setTimeout(() => toast(`균열이 영토 ${n}곳을 삼켰다`), 600); }
    requestAnimationFrame((n) => { last = n; frame(n); });
  }).catch((err) => {
    $('loading').firstChild.textContent = '지도를 불러오지 못했어요';
    $('loadingSub').textContent = err.message;
  });
})();
