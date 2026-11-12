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
  const RING = { inner: '성지 주변', middle: '중부', frontier: '변방' };
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

  let W = 0, H = 0, terrain = null, terr = null, terrs = [], holy = null;
  let solid = null;      // 건물·제단 등 막힌 칸
  let sprites = [];      // 깊이 정렬해서 그리는 큰 물체
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
    holy = data.holyCity;
    solid = new Uint8Array(W * H);
    buildSprites();
  }

  // ------------------------------------------------------------ 큰 물체 (건물, 시계탑, 제단, 깃발)
  function block(x0, y0, w, h) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < W && y < H) solid[y * W + x] = 1; }

  function buildSprites() {
    const [cx, cy] = holy.center;
    const P = (tx) => tx * TILE;
    sprites = [];
    // 시계탑 (가운데)
    block(cx - 2, cy - 1, 4, 2);
    sprites.push({ x: P(cx), y: P(cy + 1), r: 220, draw: drawTower });
    // 대성당 (북)
    block(cx - 7, cy - 22, 14, 6);
    sprites.push({ x: P(cx), y: P(cy - 16), r: 300, draw: (g, x, y) => drawBuilding(g, x, y, 14, '#6b4fb3', '대성당', 'cathedral') });
    // 거래소 (동)
    block(cx + 14, cy - 5, 10, 5);
    sprites.push({ x: P(cx + 19), y: P(cy), r: 240, draw: (g, x, y) => drawBuilding(g, x, y, 10, '#e7a33e', '거래소', 'Σ') });
    // 회담장 (서)
    block(cx - 24, cy - 5, 10, 5);
    sprites.push({ x: P(cx - 19), y: P(cy), r: 240, draw: (g, x, y) => drawBuilding(g, x, y, 10, '#3fa37a', '회담장', '⚖') });
    // 영토 제단과 수도 후보 깃발
    for (const t of terrs) {
      if (!t || gone[t.id]) continue;
      const [ax, ay] = t.altar;
      block(ax, ay, 1, 1);
      sprites.push({ x: P(ax) + 16, y: P(ay) + 28, r: 60, draw: (g, x, y) => drawAltar(g, x, y, t) });
      if (t.capitalCandidate) {
        let fx = ax + 2, fy = ay;
        if (blocked(fx, fy)) { fx = ax - 2; }
        if (!blocked(fx, fy)) { block(fx, fy, 1, 1); sprites.push({ x: P(fx) + 16, y: P(fy) + 28, r: 90, draw: drawFlag }); }
      }
    }
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
    const [hcx, hcy] = holy.center;

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
    // 성지 바닥 무늬 (원, 육각형)
    const hx = (hcx - x0) * TILE + TILE / 2, hy = (hcy - y0) * TILE;
    if (Math.abs(hcx - (x0 + CHUNK / 2)) < 40 && Math.abs(hcy - (y0 + CHUNK / 2)) < 40) {
      g.strokeStyle = '#d6c9ae'; g.lineWidth = 5;
      g.beginPath(); g.arc(hx, hy, 12 * TILE, 0, Math.PI * 2); g.stroke();
      g.setLineDash([22, 14]); g.beginPath(); g.arc(hx, hy, 8 * TILE, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      g.beginPath();
      for (let i = 0; i <= 6; i++) { const a = i * Math.PI / 3; const X = hx + Math.cos(a) * 12 * TILE, Y = hy + Math.sin(a) * 12 * TILE; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }
      g.stroke();
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

  // ------------------------------------------------------------ 플레이어와 가짜 참가자
  const saved = store('mp2026.look') || {};
  const player = {
    x: 0, y: 0, dir: 1, moving: false,
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
    const [hcx, hcy] = holy.center;
    const make = (cx, cy, rad, home) => {
      const [tx, ty] = randomPassable(r, cx, cy, rad);
      const team = 1 + ((r() * 12) | 0);
      const ty_ = TYPES[(r() * 6) | 0];
      bots.push({
        x: tx * TILE + 16, y: ty * TILE + 16, dir: r() < 0.5 ? -1 : 1, moving: false,
        name: `${team}팀 · ${BOT_NAMES[(r() * BOT_NAMES.length) | 0]}`, tag: TYPE_TAG[ty_],
        look: { hair: HAIRS[(r() * 6) | 0], outfit: OUTFITS[(r() * 6) | 0], skin: SKINS[(r() * 3) | 0], accent: TYPE_FILL[TYPES[(r() * 6) | 0]], long: r() < 0.45, seed: r() * 3 },
        home: [cx, cy, rad], goal: null, wait: r() * 3, speed: (0.55 + r() * 0.35) * WALK,
        emote: null, emoteT: 0, rand: rng((r() * 1e9) | 0),
      });
    };
    for (let i = 0; i < 40; i++) make(hcx, hcy, 34, true);
    for (const t of terrs) if (t && t.capitalCandidate && !gone[t.id] && r() < 0.6) for (let k = 0, n = 1 + ((r() * 3) | 0); k < n; k++) make(t.altar[0], t.altar[1], 8, false);
  }

  function updateBot(b, dt) {
    if (b.emote) { b.emoteT -= dt; if (b.emoteT <= 0) b.emote = null; }
    else if (b.rand() < dt * 0.04) { b.emote = EMOTES[(b.rand() * EMOTES.length) | 0]; b.emoteT = 3 + b.rand() * 2; }
    if (b.wait > 0) { b.wait -= dt; b.moving = false; return; }
    if (!b.goal) { const [cx, cy, rad] = b.home; const [gx, gy] = randomPassable(b.rand, cx, cy, rad); b.goal = [gx * TILE + 16, gy * TILE + 16]; }
    const dx = b.goal[0] - b.x, dy = b.goal[1] - b.y, d = Math.hypot(dx, dy);
    if (d < 6) { b.goal = null; b.wait = 1 + b.rand() * 4; b.moving = false; return; }
    const s = b.speed * speedAt(b.x / TILE | 0, b.y / TILE | 0) * dt;
    const moved = tryMove(b, dx / d * s, dy / d * s);
    b.moving = moved;
    if (Math.abs(dx) > 2) b.dir = dx < 0 ? -1 : 1;
    if (!moved) { b.goal = null; b.wait = 0.5; }
  }

  // 충돌: 발 밑 14x8 상자
  function free(px, py) {
    const pts = [[px - 7, py - 4], [px + 7, py - 4], [px - 7, py + 4], [px + 7, py + 4]];
    for (const [x, y] of pts) if (blocked(Math.floor(x / TILE), Math.floor(y / TILE))) return false;
    return true;
  }
  function tryMove(o, dx, dy) {
    let moved = false;
    if (dx && free(o.x + dx, o.y)) { o.x += dx; moved = true; }
    if (dy && free(o.x, o.y + dy)) { o.y += dy; moved = true; }
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
    if (k === 'escape') { $('bigmap').hidden = true; $('closet').hidden = true; }
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
  function updateWhere() {
    const tx = player.x / TILE | 0, ty = player.y / TILE | 0;
    const o = terrAt(tx, ty);
    const key = tileAt(tx, ty) === T.HOLY ? 'holy' : o;
    if (key === lastTerr) return;
    lastTerr = key;
    const chips = $('whereChips');
    chips.textContent = '';
    const chip = (text, color, line) => { const s = document.createElement('span'); s.className = 'chip' + (line ? ' line' : ''); s.textContent = text; if (color) s.style.background = color; chips.appendChild(s); };
    if (key === 'holy' || o === 0) {
      $('whereName').textContent = '중립 성지';
      $('whereSub').textContent = '전투 불가 구역 · 대성당 · 거래소 · 회담장';
      chip('안전 지대', '#2b2340');
    } else if (o > 0) {
      const t = terrs[o];
      $('whereName').textContent = t.name;
      $('whereSub').textContent = `영토 #${t.id} · ${t.type} 지방 · ${RING[t.ring]} · 넓이 ${t.area.toLocaleString()}칸`;
      chip(`${t.type} 문제`, TYPE_TAG[t.type]);
      chip('주인 없음 (중립)', null, true);
      if (t.capitalCandidate) chip('수도 후보', '#c22f53');
    } else {
      $('whereName').textContent = '알 수 없는 땅';
      $('whereSub').textContent = '';
    }
  }

  let nearAltar = null;
  function updatePrompt() {
    const tx = player.x / TILE, ty = player.y / TILE;
    let best = null;
    const o = terrAt(tx | 0, ty | 0);
    if (o > 0) {
      const t = terrs[o];
      if (Math.hypot(t.altar[0] + 0.5 - tx, t.altar[1] + 0.5 - ty) < 2.4) best = t;
    }
    if (best !== nearAltar) {
      nearAltar = best;
      $('prompt').hidden = !best;
      if (best) $('promptText').textContent = `${best.name} 제단 · ${best.type} 문제 풀기`;
    }
  }
  let toastTimer = 0;
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600); }
  function interact() { if (nearAltar) toast(`'${nearAltar.type}' 퍼즐은 다음 단계에서 붙일 예정이에요`); }

  function goHome() {
    const [cx, cy] = holy.center;
    player.x = cx * TILE + 16; player.y = (cy + 8) * TILE + 16;
    toast('성지로 돌아왔어요');
  }

  // ------------------------------------------------------------ 지도 이미지 (미니맵·세계 지도)
  let mapImg = null;
  function buildMapImage() {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const d = img.data;
    const base = { [T.VOID]: [27, 20, 48], [T.WATER]: [111, 183, 232], [T.MOUNTAIN]: [138, 129, 151], [T.HOLY]: [247, 241, 227], [T.WALL]: [107, 79, 179] };
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
  function drawMini() {
    const s = mini.width;
    const span = 180; // 미니맵이 보여주는 타일 범위
    const tx = player.x / TILE, ty = player.y / TILE;
    mg.fillStyle = '#1b1430'; mg.fillRect(0, 0, s, s);
    mg.imageSmoothingEnabled = false;
    mg.drawImage(mapImg, tx - span / 2, ty - span / 2, span, span, 0, 0, s, s);
    const k = s / span;
    mg.fillStyle = 'rgba(255,255,255,0.85)';
    for (const b of bots) { const bx = (b.x / TILE - tx + span / 2) * k, by = (b.y / TILE - ty + span / 2) * k; if (bx > 0 && by > 0 && bx < s && by < s) mg.fillRect(bx - 2, by - 2, 4, 4); }
    const vw = canvas.clientWidth / zoom / TILE * k, vh = canvas.clientHeight / zoom / TILE * k;
    mg.strokeStyle = '#ffffff'; mg.lineWidth = 2; mg.strokeRect(s / 2 - vw / 2, s / 2 - vh / 2, vw, vh);
    mg.fillStyle = '#ffd23f'; mg.strokeStyle = '#2b2340'; mg.lineWidth = 2; mg.beginPath(); mg.arc(s / 2, s / 2, 6, 0, Math.PI * 2); mg.fill(); mg.stroke();
  }
  function teleportTo(tx, ty) {
    for (let r = 0; r < 30; r++) for (let a = 0; a < 16; a++) {
      const x = Math.round(tx + Math.cos(a / 16 * Math.PI * 2) * r), y = Math.round(ty + Math.sin(a / 16 * Math.PI * 2) * r);
      if (!blocked(x, y)) { player.x = x * TILE + 16; player.y = y * TILE + 16; return true; }
    }
    return false;
  }
  mini.addEventListener('click', (e) => {
    const r = mini.getBoundingClientRect();
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
    for (const b of bots) bg.fillRect(b.x / TILE * k - 1.5, b.y / TILE * k - 1.5, 3, 3);
    bg.fillStyle = '#ffd23f'; bg.strokeStyle = '#2b2340'; bg.lineWidth = 3;
    bg.beginPath(); bg.arc(player.x / TILE * k, player.y / TILE * k, 8, 0, Math.PI * 2); bg.fill(); bg.stroke();
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
      const sp = WALK * (keys.has('shift') ? 3 : 1) * speedAt(player.x / TILE | 0, player.y / TILE | 0) * Math.min(1, mag);
      tryMove(player, mx / mag * sp * dt, my / mag * sp * dt);
      if (Math.abs(mx) > 0.1) player.dir = mx < 0 ? -1 : 1;
    }
    for (const b of bots) updateBot(b, dt);

    // 그리기
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
    for (const b of bots) if (b.x > x0 && b.x < x1 && b.y > y0 && b.y < y1) list.push(b);
    list.push(player);
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

    hudT -= dt;
    if (hudT <= 0) { hudT = 0.15; updateWhere(); updatePrompt(); drawMini(); if (!$('bigmap').hidden) drawBig(); }
    requestAnimationFrame(frame);
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
    buildMapImage();
    spawnBots();
    resize();
    goHome();
    $('toast').hidden = true;
    setupDoomCard();
    $('loading').hidden = true;
    if (DAY === 5) setTimeout(() => toast('신들이 선포했다: 12월 28일, 이 세계는 끝난다.'), 600);
    else if (DOOM) { const n = terrs.filter((t) => t && gone[t.id]).length; if (n) setTimeout(() => toast(`균열이 영토 ${n}곳을 삼켰다`), 600); }
    requestAnimationFrame((n) => { last = n; frame(n); });
  }).catch((err) => {
    $('loading').firstChild.textContent = '지도를 불러오지 못했어요';
    $('loadingSub').textContent = err.message;
  });
})();
