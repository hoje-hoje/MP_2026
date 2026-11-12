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
  let ulleung = null;    // 울릉도 (신들의 섬, 중립) — 본토에서 걸어갈 수 없음
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
    if (t === T.VOID || t === T.HOLY || t === T.WATER || t === T.MOUNTAIN || t === T.WALL || solid[y * W + x] === 1 || treeAt(x, y) !== null) return true;
    const e = TILES[y * W + x]; if (e && e.k === 'wall' && e.n !== MY_NID) return true; // 남의 방벽
    return STORE_AT.has(y * W + x);
  }
  // ---- 영지: 설치물(바닥·방벽), 우리 덫, 저장소 자리
  let TILES = {};                 // 칸 번호 -> { k: 'floor'|'wall', n: 나라 }
  let MY_TRAPS = new Set();       // 우리 나라 덫 (다른 나라엔 안 보임)
  let STORE_AT = new Map();       // 칸 번호 -> 나라 (수도 저장소)
  const FACE_D = [[0, 1], [0, -1], [-1, 0], [1, 0]];
  // 나무: 바닥에 굽지 않고 따로 그려서(깊이 정렬) 뒤로 지나갈 수 있게, 줄기 칸은 못 지나가게.
  let noTree = new Uint8Array(1);
  function treeAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H || noTree[y * W + x]) return null;
    const t = terrain[y * W + x];
    if (t !== T.FOREST && t !== T.GRASS) return null;
    const o = terr[y * W + x]; if (o !== 65535 && o > 0 && gone[o]) return null;
    const h = hash(x, y, 7);
    if (t === T.FOREST) {
      if (h < 0.07 && (x + y) % 3 === 0) return h < 0.035 ? 'treeA' : 'treeB';
      if (h < 0.26 && (x + 2 * y) % 2 === 0) return h < 0.17 ? 'midA' : 'midB';
      return null;
    }
    return h < 0.004 ? 'midA' : null;
  }
  function clearTrees(cx, cy, r) { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (x >= 0 && y >= 0 && x < W && y < H) noTree[y * W + x] = 1; }
  function speedAt(x, y) { const e = TILES[y * W + x]; if (e && e.k === 'floor' && e.n === MY_NID) return MPRules.NUM.floorSpeed; const t = tileAt(x, y); return t === T.FOREST ? 0.7 : t === T.SAND ? 0.85 : 1; }

  // 영토 이름 (번호로 고정)
  const SYL = ['라온', '솔빛', '미르', '벼리', '가람', '누리', '다온', '초롱', '하람', '윤슬', '아라', '한결', '새벽', '별하', '온새', '나린', '해솔', '그루', '여울', '도담', '마루', '보람', '시나', '이든'];
  const SUFFIX = { inner: '령', middle: '주', frontier: ' 변경' };
  function terrName(t) {
    const a = SYL[(t.id * 7) % SYL.length];
    if (t.region) return `${t.region} ${a}`;
    const b = ['', '', '동', '서', '남', '북'][(t.id * 13) % 6]; return a + b + SUFFIX[t.ring];
  }

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
    noTree = new Uint8Array(W * H);
    for (const t of data.territories) { clearTrees(t.altar[0], t.altar[1], 3); if (t.portal) clearTrees(t.portal[0], t.portal[1], 3); }
    ulleung = data.ulleung;
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
    if (ulleung) {
      const [ux, uy] = ulleung.center;
      sprites.push({ x: P(ux) + 16, y: P(uy) + 16, draw: (g, x, y) => { drawTower(g, x, y); sign(g, x, y - 330, '울릉도 · 신들의 섬'); } });
    }
    for (const t of terrs) {
      if (!t || gone[t.id]) continue;
      const [ax, ay] = t.altar;
      block(ax, ay, 1, 1);
      sprites.push({ x: P(ax) + 16, y: P(ay) + 28, draw: (g, x, y) => drawAltar(g, x, y, t) });
      if (t.capitalCandidate) {
        let fx = ax + 2, fy = ay;
        if (blocked(fx, fy)) { fx = ax - 2; }
        if (!blocked(fx, fy)) { block(fx, fy, 1, 1); sprites.push({ x: P(fx) + 16, y: P(fy) + 28, draw: (g, x, y) => drawFlag(g, x, y, t === home) }); }
        const [qx, qy] = t.portal;
        sprites.push({ x: P(qx) + 16, y: P(qy) + 20, portal: t, draw: (g, x, y) => drawPortal(g, x, y, t === home) });
      }
      // 금광 (온라인 자원 지점): 영토마다 1곳, 하루 1번 캘 수 있음
      for (let k = 0; k < 40; k++) {
        const nx = ax + Math.round((hash(t.id, k, 11) - 0.5) * 18), ny = ay + Math.round((hash(t.id, k, 12) - 0.5) * 18);
        if (Math.abs(nx - ax) + Math.abs(ny - ay) < 4 || blocked(nx, ny) || terrAt(nx, ny) !== t.id) continue;
        const n = { id: t.id, t, x: P(nx) + 16, y: P(ny) + 24 };
        clearTrees(nx, ny, 1);
        nodes.push(n);
        sprites.push({ x: n.x, y: n.y, draw: (g, x, y) => drawOre(g, x, y, mined.has(n.id)) });
        break;
      }
    }
  }

  function drawOre(g, x, y, empty) {
    g.fillStyle = 'rgba(0,0,0,0.18)'; ell(g, x, y, 24, 7);
    pix(g, 'boulder', x, y + 2);
    if (empty) return;
    const bob = Math.sin(performance.now() / 300 + x) * 2;
    pix(g, 'coin', x - 10, y - 18 + bob, 0, 16); pix(g, 'coin', x + 8, y - 24 - bob, 0, 14);
    pix(g, 'burst', x + 14, y - 30, 0, 14 + Math.sin(performance.now() / 200 + x) * 4, 0.8);
  }

  // 하늘로 가는 빛기둥
  function drawPortal(g, x, y, mine) {
    const now = performance.now() / 1000;
    const pulse = 0.5 + Math.sin(now * 3) * 0.15;
    g.fillStyle = `rgba(255,236,140,${0.35 * pulse + 0.15})`; ell(g, x, y, 30, 11);
    const prev = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    g.drawImage(ART.towers, 192, 64, 32, 32, x - 32, y - 58, 64, 64);
    g.imageSmoothingEnabled = prev;
    y -= 40;
    const grd = g.createLinearGradient(0, y - 220, 0, y);
    grd.addColorStop(0, 'rgba(255,248,200,0)'); grd.addColorStop(1, `rgba(255,240,170,${0.55 * pulse + 0.2})`);
    g.fillStyle = grd; g.fillRect(x - 16, y - 220, 32, 220);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 4; i++) { const k = (now * 0.6 + i / 4) % 1; circ(g, x + Math.sin(i * 2.1 + now) * 10, y - k * 200, 2.2); }
    pix(g, 'burst', x, y - 196, 0, 46 + Math.sin(now * 3) * 8, 0.85);
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
    const f = Math.floor(performance.now() / 260 + t.id) % 3;
    g.fillStyle = 'rgba(0,0,0,0.2)'; ell(g, x, y + 2, 22, 7);
    const prev = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    const fl = HITFX.get(t.id), hot = fl && performance.now() < fl; // 맞으면 0.12초 빨갛게 + 흔들림
    const sx = hot ? Math.round(Math.sin(performance.now() / 12) * 3) : 0;
    g.drawImage(altarSheet(t.type), f * 32, 0, 32, 32, x - 32 + sx, y - 60, 64, 64);
    if (hot) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,40,60,0.55)'; g.fillRect(x - 32 + sx, y - 60, 64, 64); g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(255,60,80,0.35)'; ell(g, x + sx, y - 34, 22, 26); }
    g.imageSmoothingEnabled = prev;
  }
  const HITFX = new Map();
  function drawWall(g, x, y, nid) { // 방벽: 벽돌 덩어리 + 나라 색 띠
    const prev = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x - 17, y - 4, 34, 6);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) g.drawImage(ART.x_brick, 0, 0, 16, 16, x - 16 + c * 16, y - 46 + r * 14, 16, 14);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x - 16, y - 8, 32, 6);
    g.fillStyle = natColor(nid); g.fillRect(x - 16, y - 50, 32, 6); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x - 16, y - 50, 32, 2);
    g.imageSmoothingEnabled = prev;
  }
  function drawTrap(g, x, y) { // 우리 덫 (우리 나라에만 보임)
    g.fillStyle = 'rgba(80,60,40,0.55)'; ell(g, x, y - 6, 12, 5);
    g.fillStyle = '#c9c2b6'; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(x + k * 5 - 2, y - 4); g.lineTo(x + k * 5, y - 12); g.lineTo(x + k * 5 + 2, y - 4); g.fill(); }
  }
  function drawStore(g, x, y, nid) { // 수도 저장소
    pix(g, 'cabin', x, y + 4, 2); pix(g, 'woodpile', x + 44, y + 4, 2); pix(g, 'coin', x - 44, y - 2, 0, 18);
    sign(g, x, y - 92, nid === MY_NID ? '우리 저장소' : `${natName(nid)} 저장소`);
  }

  function drawFlag(g, x, y, mine) {
    const f = Math.floor(performance.now() / 160) % 4;
    const prev = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    g.drawImage(ART.flags, f * 16, (mine ? 1 : 0) * 16, 16, 16, x - 20, y - 46, 48, 48);
    g.imageSmoothingEnabled = prev;
  }

  // 팻말: 각진 픽셀 나무판 + 픽셀 글꼴
  function sign(g, x, y, text) {
    g.font = `700 22px ${PFONT}`;
    const w = Math.ceil(g.measureText(text).width / 2) * 2 + 24, h = 32;
    const L = Math.round(x - w / 2), T = Math.round(y - h / 2);
    g.fillStyle = '#2b2340'; g.fillRect(L - 2, T - 2, w + 4, h + 4);
    g.fillStyle = '#c9915c'; g.fillRect(L, T, w, h);
    g.fillStyle = '#e0b07a'; g.fillRect(L, T, w, 4);
    g.fillStyle = '#9a6a3c'; g.fillRect(L, T + h - 4, w, 4);
    g.fillStyle = '#fff6d6'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#5a3a20'; g.fillText(text, x + 1, y + 2);
    g.fillStyle = '#fff6d6'; g.fillText(text, x, y + 1);
  }
  const PFONT = "'Galmuri11', 'Galmuri11Full', sans-serif";

  // 도형 도우미
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill(); }
  function ell(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }
  function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  function tri(g, a, b, c, d, e, f) { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.lineTo(e, f); g.closePath(); g.fill(); }

  // ------------------------------------------------------------ 그림 (Ninja Adventure, CC0)
  const ART = {};
  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('그림 파일을 불러오지 못했어요: ' + src)); i.src = src; }); }
  async function loadArt() {
    const names = { water: 'na/water.png', floor: 'ninja/floor.png', village: 'ninja/village.png', chars: 'na/chars.png', faces: 'na/faces.png', towers: 'na/towers.png', flags: 'na/flags.png' };
    const meta = fetch('assets/na/chars.json').then((r) => r.json()).then((j) => { CHARS.cols = j.cols; CHARS.names = j.names; });
    const users = fetch('assets/user/users.json').then((r) => r.json()).then((j) => {
      USER.chars = j.chars; USER.animals = j.animals; USER.monsters = j.monsters;
      return Promise.all([...j.chars, ...j.animals, ...j.monsters].map(async (k) => { ART['u_' + k] = await loadImg('assets/user/' + k + '.png'); }));
    });
    for (const k of EXTRA) names['x_' + k] = 'extra/' + k + '.png';
    for (const k of TEMPLE) names['x_' + k] = 'na/' + k + '.png';
    const fonts = document.fonts ? Promise.all([document.fonts.load("11px Galmuri11"), document.fonts.load("700 22px Galmuri11")]).catch(() => {}) : Promise.resolve();
    await Promise.all([meta, users, fonts, ...Object.entries(names).map(async ([k, f]) => { ART[k] = await loadImg('assets/' + f); })]);
  }
  const EXTRA = ['coin', 'cloud', 'burst', 'pin', 'tower', 'marble', 'stonefloor', 'carpet', 'grass', 'dirt', 'pillar', 'candelabra', 'rosewin', 'tomb', 'altar', 'book', 'candles', 'chalice', 'key', 'bishop', 'keeper', 'tent', 'cabin', 'campfire', 'woodpile', 'log', 'boulder', 'boulder_sm', 'flower_r', 'flower_y', 'mushroom', 'fern', 'stump', 'berry'];
  const TEMPLE = ['emote0', 'emote1', 'emote2', 'emote3', 'emote4', 'emote5', 'emote6', 'emote7', 'statue_orb', 'statue_lion', 'pillar_na', 'plant', 'arch', 'pool', 'floor_palace', 'brick', 'banner0', 'banner1', 'banner2', 'banner3', 'banner4', 'banner5', 'banner6'];
  // 픽셀 그림 하나를 '바닥 가운데'에 맞춰 그린다. k: 배율 / fitH: 높이(px)에 맞추기 (큰 그림용)
  function pix(g, key, cx, bottom, k = 2, fitH = 0, alpha = 1) {
    const im = key.startsWith('u:') ? ART['u_' + key.slice(2)] : ART['x_' + key]; if (!im) return;
    const sc = fitH ? fitH / im.height : k, w = im.width * sc, h = im.height * sc;
    const prev = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    if (alpha !== 1) g.globalAlpha = alpha;
    g.drawImage(im, Math.round(cx - w / 2), Math.round(bottom - h), Math.round(w), Math.round(h));
    g.globalAlpha = 1; g.imageSmoothingEnabled = prev;
  }
  const tentCache = {};
  function tintedTent(deg) {
    if (tentCache[deg]) return tentCache[deg];
    const im = ART.x_tent, cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    const g = cv.getContext('2d'); g.drawImage(im, 0, 0); hueShift(g, cv.width, cv.height, deg);
    return (tentCache[deg] = cv);
  }
  // 바닥 타일 (floor.png 의 16px 칸 좌표)
  const TL = {
    grass: [[0, 12], [0, 12], [0, 12], [0, 12], [0, 12], [0, 12], [0, 12], [0, 12], [1, 12], [2, 12], [3, 12]],
    forest: [[11, 12], [11, 12], [11, 12], [12, 12], [13, 12], [14, 12]],
    sand: [[0, 5], [0, 5], [0, 5], [1, 5], [2, 5], [3, 5]],
    water: [[1, 22]],
    // water.png 의 작은 연못(3x3): 물가 자동 타일
    shore: { c: [1, 7], n: [1, 6], s: [1, 8], w: [0, 7], e: [2, 7], nw: [0, 6], ne: [2, 6], sw: [0, 8], se: [2, 8] },
    rock: [[13, 16]],
  };
  function tile(g, list, h, px, py) { const [cx, cy] = list[(h * list.length) | 0]; g.drawImage(ART.floor, cx * 16, cy * 16, 16, 16, px, py, TILE, TILE); }
  // 큰 그림 (village.png 잘라 쓰기): [x, y, w, h]
  const SP = { treeA: [0, 96, 64, 48], treeB: [0, 144, 64, 48], midA: [64, 96, 32, 32], midB: [64, 144, 32, 32], stone: [112, 80, 32, 32], bush: [64, 78, 32, 18], house: [192, 97, 64, 79], house2: [256, 96, 64, 70] };
  function spr(g, name, cx, bottom, k = 2) { const [x, y, w, h] = SP[name]; g.drawImage(ART.village, x, y, w, h, Math.round(cx - w * k / 2), Math.round(bottom - h * k), w * k, h * k); }

  // 캐릭터: 16px 칸, 열 = 방향(아래·위·왼쪽·오른쪽), 행 = 걷기 프레임. 팀/꾸미기 색은 색상 회전으로.
  const CHARS = { cols: 10, names: ['NinjaBlue'] };   // assets/na/chars.json
  const USER = { chars: [], animals: [], monsters: [] }; // assets/user/users.json (동아리 제공 캐릭터, 앞번호)
  const charCount = () => USER.chars.length + CHARS.names.length;
  const userTint = new Map();
  function userSprite(k, hi) {
    const key = k + ':' + hi; let cv = userTint.get(key); if (cv) return cv;
    const im = ART['u_' + k]; cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    const g = cv.getContext('2d'); g.drawImage(im, 0, 0); hueShift(g, cv.width, cv.height, HUES[hi] || 0);
    userTint.set(key, cv); return cv;
  }
  const HUES = [0, 50, 110, 170, 230, 300];
  const sheets = new Map();
  function charSheet(c, hi) {
    const key = c + ':' + hi; let cv = sheets.get(key); if (cv) return cv;
    c = Math.max(0, Math.min(CHARS.names.length - 1, c | 0));
    cv = document.createElement('canvas'); cv.width = 64; cv.height = 112;
    const g = cv.getContext('2d'); g.drawImage(ART.chars, (c % CHARS.cols) * 64, Math.floor(c / CHARS.cols) * 112, 64, 112, 0, 0, 64, 112);
    hueShift(g, cv.width, cv.height, HUES[hi] || 0);
    sheets.set(key, cv); return cv;
  }
  function hueShift(g, w, h, deg) {
    if (deg) {
      const d = g.getImageData(0, 0, w, h), px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        const r = px[i] / 255, gg = px[i + 1] / 255, b = px[i + 2] / 255;
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, dd = mx - mn;
        if (dd < 0.12) continue; // 회색·검정·흰색(얼굴, 윤곽)은 그대로
        const sat = dd / (1 - Math.abs(2 * l - 1));
        let hh = mx === r ? ((gg - b) / dd) % 6 : mx === gg ? (b - r) / dd + 2 : (r - gg) / dd + 4;
        hh = (hh * 60 + deg + 360) % 360;
        const C = (1 - Math.abs(2 * l - 1)) * sat, X = C * (1 - Math.abs((hh / 60) % 2 - 1)), m = l - C / 2;
        const [r1, g1, b1] = hh < 60 ? [C, X, 0] : hh < 120 ? [X, C, 0] : hh < 180 ? [0, C, X] : hh < 240 ? [0, X, C] : hh < 300 ? [X, 0, C] : [C, 0, X];
        px[i] = (r1 + m) * 255; px[i + 1] = (g1 + m) * 255; px[i + 2] = (b1 + m) * 255;
      }
      g.putImageData(d, 0, 0);
    }
  }
  // 제단: 수정 신전(towers.png 3행 10~12열, 3프레임)을 속성 색으로
  const TYPE_HUE = { 기하: 135, 대수: -95, 확통: 45, 미적분: 185, 수열: -60, 논리: 95 };
  const altarCache = {};
  function altarSheet(type) {
    if (altarCache[type]) return altarCache[type];
    const cv = document.createElement('canvas'); cv.width = 96; cv.height = 32;
    const g = cv.getContext('2d'); g.drawImage(ART.towers, 288, 64, 96, 32, 0, 0, 96, 32);
    hueShift(g, 96, 32, TYPE_HUE[type] || 0);
    return (altarCache[type] = cv);
  }
  const CH_K = 3; // 16px → 48px
  function drawSprite(g, x, y, look, t, moving, face) {
    if (look.red) { g.fillStyle = look.red >= 2 ? 'rgba(230,20,50,0.85)' : 'rgba(235,50,70,0.6)'; ell(g, x, y, 24, 9); g.fillStyle = 'rgba(120,0,20,0.5)'; ell(g, x, y, 15, 5); } // 체포당한 사람은 그림자가 빨갛게 (2번이면 더 진하게)
    else { g.fillStyle = 'rgba(0,0,0,0.22)'; ell(g, x, y, 15, 5); }
    if (look.me) { g.strokeStyle = '#ffd23f'; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath(); g.ellipse(x, y, 20, 7, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
    const c = look.char | 0;
    const prev = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    if (c < USER.chars.length) {
      // 동아리 캐릭터: 한 장짜리 그림 → 걸을 때 통통 튀고, 왼쪽으로 가면 좌우 뒤집기
      const im = userSprite(USER.chars[c], look.hue | 0);
      const k = 2, w = im.width * k, h = im.height * k;
      const ph = Math.floor(t * 9 + (look.seed || 0)) % 2;
      const bob = moving ? (ph ? 3 : 0) : Math.round(Math.sin(t * 2 + (look.seed || 0)) * 0.6);
      g.save(); g.translate(Math.round(x), Math.round(y + 2 - bob));
      if (face === 2) g.scale(-1, 1);
      if (moving && ph) g.rotate(face === 2 ? 0.06 : -0.06);
      g.drawImage(im, -Math.round(w / 2), -h, w, h);
      g.restore();
    } else {
      const sheet = charSheet(c - USER.chars.length, look.hue | 0);
      const row = moving ? (Math.floor(t * 8 + (look.seed || 0)) % 4) : 0;
      g.drawImage(sheet, (face | 0) * 16, row * 16, 16, 16, Math.round(x - 8 * CH_K), Math.round(y - 16 * CH_K + 2), 16 * CH_K, 16 * CH_K);
    }
    g.imageSmoothingEnabled = prev;
  }
  const faceOf = (dx, dy, prev) => (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) ? prev : (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy < 0 ? 1 : 0));

  // ------------------------------------------------------------ 바닥 청크
  const chunks = new Map();
  let chunkBudget = 0;

  function dirtyTile(i) { const x = i % W, y = Math.floor(i / W); for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) chunks.delete(Math.floor((x + dx * 3) / CHUNK) + ',' + Math.floor((y + dy * 3) / CHUNK)); }
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
    g.imageSmoothingEnabled = false;
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
          case T.GRASS: tile(g, TL.grass, h, px, py); break;
          case T.FOREST: tile(g, TL.forest, h, px, py); break;
          case T.SAND: tile(g, TL.sand, h, px, py); break;
          case T.WATER: {
            const land = (a, b) => { const q = tileAt(a, b); return q !== T.WATER && q !== T.VOID; };
            const N = land(x, y - 1), S = land(x, y + 1), Wd = land(x - 1, y), E = land(x + 1, y);
            const sh = TL.shore;
            const key = N && Wd ? 'nw' : N && E ? 'ne' : S && Wd ? 'sw' : S && E ? 'se' : N ? 'n' : S ? 's' : Wd ? 'w' : E ? 'e' : 'c';
            const [cx, cy] = sh[key];
            g.drawImage(ART.water, cx * 16, cy * 16, 16, 16, px, py, TILE, TILE);
            break;
          }
          case T.MOUNTAIN: {
            tile(g, TL.rock, h, px, py);
            g.fillStyle = 'rgba(52,34,26,0.45)';
            const open = (a, b) => tileAt(a, b) !== T.MOUNTAIN;
            if (open(x, y - 1)) g.fillRect(px, py, TILE, 3);
            if (open(x, y + 1)) g.fillRect(px, py + TILE - 5, TILE, 5);
            if (open(x - 1, y)) g.fillRect(px, py, 3, TILE);
            if (open(x + 1, y)) g.fillRect(px + TILE - 3, py, 3, TILE);
            break;
          }
          case T.HOLY: {
            g.fillStyle = '#f3ecdc'; g.fillRect(px, py, TILE, TILE);
            if (tileAt(x, y - 1) === T.VOID || tileAt(x - 1, y) === T.VOID || tileAt(x + 1, y) === T.VOID || tileAt(x, y + 1) === T.VOID) { g.fillStyle = '#efdcae'; g.fillRect(px, py, TILE, TILE); }
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
        { const e = TILES[y * W + x]; if (e && e.k === 'floor') { g.drawImage(ART.x_stonefloor, px, py, TILE, TILE); g.fillStyle = natColor(e.n); g.globalAlpha = 0.18; g.fillRect(px, py, TILE, TILE); g.globalAlpha = 1; } }
        // 영토 색 + 국경선: 우리 나라는 진하게, 경계는 우리 나라 색 띠 / 나머지 경계는 흰 선
        const o = terrAt(x, y);
        const own = o > 0 ? ownerOf(o) : null;
        const mine = !!own && own === MY_NID;
        if (own && t !== T.WATER && t !== T.MOUNTAIN) { g.fillStyle = natColor(own); g.globalAlpha = mine ? 0.34 : 0.2; g.fillRect(px, py, TILE, TILE); g.globalAlpha = 1; }
        else if (o > 0 && t !== T.WATER && t !== T.MOUNTAIN) {
          const [r, gg, b] = TYPE_RGB[terrs[o].type];
          g.fillStyle = `rgba(${r},${gg},${b},0.07)`; g.fillRect(px, py, TILE, TILE);
        }
        if (o > 0) {
          // 흰 경계선 (오른쪽·아래 칸과 영토가 다르면). 주인이 다르면 실선, 같으면 점선
          const right = terrAt(x + 1, y), down = terrAt(x, y + 1);
          for (const [q, vert] of [[right, true], [down, false]]) {
            if (!(q > 0) || q === o) continue;
            const solidB = ownerOf(q) !== own;
            g.fillStyle = solidB ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)';
            if (vert) { if (solidB) g.fillRect(px + TILE - 3, py, 3, TILE); else for (let k = 0; k < TILE; k += 8) g.fillRect(px + TILE - 2, py + k, 2, 4); }
            else { if (solidB) g.fillRect(px, py + TILE - 3, TILE, 3); else for (let k = 0; k < TILE; k += 8) g.fillRect(px + k, py + TILE - 2, 4, 2); }
          }
          // 우리 나라 바깥 경계: 안쪽으로 굵은 우리 색 띠 + 바깥 테두리
          if (mine) {
            const out = (a, b) => { const q = terrAt(a, b); return q > 0 && q !== o && ownerOf(q) !== MY_NID; };
            const col = natColor(own);
            const N = out(x, y - 1), S = out(x, y + 1), Wd = out(x - 1, y), E = out(x + 1, y);
            g.fillStyle = col;
            if (N) g.fillRect(px, py, TILE, 10); if (S) g.fillRect(px, py + TILE - 10, TILE, 10);
            if (Wd) g.fillRect(px, py, 10, TILE); if (E) g.fillRect(px + TILE - 10, py, 10, TILE);
            g.fillStyle = '#ffd34d'; // 금색 바깥 테두리
            if (N) g.fillRect(px, py, TILE, 3); if (S) g.fillRect(px, py + TILE - 3, TILE, 3);
            if (Wd) g.fillRect(px, py, 3, TILE); if (E) g.fillRect(px + TILE - 3, py, 3, TILE);
          }
        }
      }
    }
    // 장식 (나무, 바위) — 아래쪽 줄이 앞에 오도록, 이웃 청크까지 걸쳐 그린다
    for (let y = y0 - 1; y < y0 + CHUNK + 4; y++) {
      for (let x = x0 - 3; x < x0 + CHUNK + 3; x++) {
        const t = tileAt(x, y), h = hash(x, y, 7);
        const px = (x - x0) * TILE, py = (y - y0) * TILE;
        const og = terrAt(x, y);
        if (og > 0 && gone[og]) continue;
        if (treeAt(x, y)) continue;
        if (t === T.FOREST) {
          if (h >= 0.26 && h < 0.29) pix(g, h < 0.275 ? 'stump' : 'berry', px + 16, py + 30);
        } else if (t === T.GRASS) {
          if (h < 0.004) { /* 나무 자리 */ }
          else if (h < 0.010) spr(g, 'bush', px + 16, py + 30);
          else if (h < 0.016) pix(g, h < 0.013 ? 'flower_r' : 'flower_y', px + 16, py + 30);
          else if (h < 0.019) pix(g, 'mushroom', px + 16, py + 30);
          else if (h < 0.023) pix(g, 'fern', px + 16, py + 30);
        } else if (t === T.MOUNTAIN && h < 0.16 && (x + y) % 2 === 0) spr(g, 'stone', px + 16, py + 30);
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
    g.font = `11px ${PFONT}`;
    let w = tagW.get(text);
    if (!w) { w = Math.ceil(g.measureText(text).width) + 10; tagW.set(text, w); }
    const L = Math.round(x - w / 2), T = Math.round(y - 8);
    g.fillStyle = '#1b1430'; g.fillRect(L - 1, T - 1, w + 2, 18);
    g.fillStyle = color; g.fillRect(L, T, w, 16);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(L, T, w, 2);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, Math.round(x), T + 9);
  }
  function bubble(g, x, y, text) {
    const ei = EMOTE_LIST.indexOf(text);
    if (ei >= 0 && ART['x_emote' + ei]) { pix(g, 'emote' + ei, x, y + 14, 3); return; }
    g.font = `11px ${PFONT}`;
    const w = Math.ceil(g.measureText(text).width) + 14, h = 20;
    const L = Math.round(x - w / 2), T = Math.round(y - 12);
    g.fillStyle = '#2b2340'; g.fillRect(L - 2, T - 2, w + 4, h + 4); g.fillRect(x - 3, T + h, 6, 6);
    g.fillStyle = '#fffdf8'; g.fillRect(L, T, w, h); g.fillRect(x - 1, T + h, 2, 3);
    g.fillStyle = '#2b2340'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, Math.round(x), T + 11);
  }



  // ------------------------------------------------------------ 하늘 (신들의 땅, 중립 지역, 방으로 나뉨)
  // 각 나라 수도의 포털로 올라오고, 내려갈 땐 올라온 포털(=자기 나라 수도)로만 내려간다.
  const ROOMS = {
    temple: {
      name: '하늘 신전', desc: '신들의 공지 · 신탁 제단 · 멸망의 탑', w: 30, h: 18, pos: [1, 1], crowd: 10,
      floor: 'floor_palace', wall: true, trim: '#e2b93b',
      emotes: ['신탁 봤어?', '오늘 공지 뭐임', '!', '?', '내일 어디 무너짐?', '탑이 빛난다'],
      doors: [{ side: 'W', at: 8, to: 'market' }, { side: 'E', at: 8, to: 'council' }, { side: 'N', at: 15, to: 'plaza' }, { side: 'S', at: 15, to: 'ground' }],
      props: [
        { x: 3, y: 0, w: 1, h: 2, draw: (g, x, y) => pix(g, 'banner1', x, y + 4, 2) }, { x: 9, y: 0, w: 1, h: 2, draw: (g, x, y) => pix(g, 'banner5', x, y + 4, 2) },
        { x: 20, y: 0, w: 1, h: 2, draw: (g, x, y) => pix(g, 'banner5', x, y + 4, 2) }, { x: 26, y: 0, w: 1, h: 2, draw: (g, x, y) => pix(g, 'banner1', x, y + 4, 2) },
        { x: 11, y: 2, w: 1, h: 1, draw: (g, x, y) => pix(g, 'candelabra', x, y + 2) }, { x: 18, y: 2, w: 1, h: 1, draw: (g, x, y) => pix(g, 'candelabra', x, y + 2) },
        { x: 5, y: 2, w: 1, h: 1, draw: (g, x, y) => pix(g, 'plant', x, y + 2, 2) }, { x: 24, y: 2, w: 1, h: 1, draw: (g, x, y) => pix(g, 'plant', x, y + 2, 2) },
        { x: 3, y: 5, w: 1, h: 1, draw: (g, x, y) => pix(g, 'pillar_na', x, y + 4, 2) }, { x: 3, y: 13, w: 1, h: 1, draw: (g, x, y) => pix(g, 'pillar_na', x, y + 4, 2) },
        { x: 26, y: 5, w: 1, h: 1, draw: (g, x, y) => pix(g, 'pillar_na', x, y + 4, 2) }, { x: 26, y: 13, w: 1, h: 1, draw: (g, x, y) => pix(g, 'pillar_na', x, y + 4, 2) },
        { x: 11, y: 11, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_orb', x, y + 4, 2) }, { x: 18, y: 11, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_orb', x, y + 4, 2) },
        { x: 11, y: 14, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_lion', x, y + 4, 1.5) }, { x: 18, y: 14, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_lion', x, y + 4, 1.5) },
        { x: 5, y: 11, w: 3, h: 1, board: true, draw: (g, x, y) => { pix(g, 'altar', x, y + 4); pix(g, 'book', x, y - 44); sign(g, x, y - 92, '신탁 제단'); } },
        { x: 8, y: 12, w: 1, h: 1, draw: (g, x, y) => { pix(g, 'bishop', x, y + 2); nameTag(g, x, y - 58, '신의 사제', '#6b4fb3'); } },
        { x: 2, y: 15, w: 1, h: 1, draw: (g, x, y) => pix(g, 'plant', x, y + 2, 2) }, { x: 27, y: 15, w: 1, h: 1, draw: (g, x, y) => pix(g, 'plant', x, y + 2, 2) },
        { x: 22, y: 11, w: 1, h: 1, draw: (g, x, y) => pix(g, 'candelabra', x, y + 2) },
      ],
    },
    market: {
      name: '거래소', desc: '자원·병력·정보를 사고파는 곳', w: 30, h: 18, pos: [0, 1], crowd: 9,
      floor: 'stonefloor', wall: true, trim: '#e7a33e',
      emotes: ['열쇠 조각 팝니다', '병력 100 ↔ 코인 3천', '강화석 삼', '정보 삽니다', '흥정 ㄱ?', '너무 비쌈;;'],
      doors: [{ side: 'E', at: 9, to: 'temple' }],
      props: [
        { x: 4, y: 3, w: 4, h: 2, shop: 'build', draw: (g, x, y) => stall(g, x, y, 0, 'woodpile', '바닥·방벽·덫') },
        { x: 12, y: 3, w: 4, h: 2, draw: (g, x, y) => stall(g, x, y, 200, 'key', '병력') },
        { x: 20, y: 3, w: 4, h: 2, draw: (g, x, y) => stall(g, x, y, 120, 'book', '정보') },
        { x: 4, y: 12, w: 4, h: 2, shop: 'vaccine', draw: (g, x, y) => stall(g, x, y, 260, 'chalice', '백신 (균열 방어)') },
        { x: 12, y: 12, w: 4, h: 2, draw: (g, x, y) => stall(g, x, y, 40, 'coin', '경매') },
        { x: 20, y: 12, w: 4, h: 2, draw: (g, x, y) => stall(g, x, y, 160, 'candles', '환전') },
        { x: 9, y: 0, w: 1, h: 2, draw: (g, x, y) => pix(g, 'banner6', x, y + 4, 2) }, { x: 17, y: 0, w: 1, h: 2, draw: (g, x, y) => pix(g, 'banner3', x, y + 4, 2) }, { x: 25, y: 0, w: 1, h: 2, draw: (g, x, y) => pix(g, 'banner6', x, y + 4, 2) },
      ],
    },
    council: {
      name: '회담장', desc: '나라끼리 조약을 맺는 곳 · 밀실 2개', w: 26, h: 16, pos: [2, 1], crowd: 7,
      floor: 'floor_palace', wall: true, carpets: [[8, 4, 10, 8], [0, 7, 8, 3]], trim: '#5b7fd6',
      emotes: ['불가침 조약 ㄱ?', '동맹 맺자', '조건이 뭔데', '배신하면 알지?', '왕끼리 얘기하자'],
      doors: [{ side: 'W', at: 8, to: 'temple' }, { side: 'E', at: 4, to: 'secret1' }, { side: 'E', at: 12, to: 'secret2' }],
      props: [
        { x: 11, y: 6, w: 4, h: 2, draw: (g, x, y) => { pix(g, 'altar', x, y + 6, 3); pix(g, 'book', x - 20, y - 70); pix(g, 'chalice', x + 22, y - 72); sign(g, x, y - 110, '조약 제단'); } },
        { x: 9, y: 5, w: 1, h: 1, draw: (g, x, y) => pix(g, 'candelabra', x, y + 2) }, { x: 16, y: 5, w: 1, h: 1, draw: (g, x, y) => pix(g, 'candelabra', x, y + 2) },
        { x: 9, y: 10, w: 1, h: 1, draw: (g, x, y) => pix(g, 'candelabra', x, y + 2) }, { x: 16, y: 10, w: 1, h: 1, draw: (g, x, y) => pix(g, 'candelabra', x, y + 2) },
        { x: 5, y: 0, w: 1, h: 2, draw: (g, x, y) => pix(g, 'banner2', x, y + 4, 2) }, { x: 13, y: 0, w: 1, h: 2, draw: (g, x, y) => pix(g, 'banner4', x, y + 4, 2) }, { x: 20, y: 0, w: 1, h: 2, draw: (g, x, y) => pix(g, 'banner2', x, y + 4, 2) },
        { x: 3, y: 12, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_orb', x, y + 4, 2) }, { x: 22, y: 12, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_orb', x, y + 4, 2) },
        { x: 3, y: 3, w: 1, h: 1, draw: (g, x, y) => pix(g, 'plant', x, y + 2, 2) }, { x: 22, y: 3, w: 1, h: 1, draw: (g, x, y) => pix(g, 'plant', x, y + 2, 2) },
      ],
    },
    secret1: {
      name: '밀실 1', desc: '들어온 사람끼리만 보이는 작은 방 (예정)', w: 14, h: 10, pos: [3, 0.55], crowd: 2,
      floor: 'stonefloor', dark: true, wall: true, trim: '#6b4fb3',
      emotes: ['쉿', '여기서 한 얘기는 비밀', '...'],
      doors: [{ side: 'W', at: 5, to: 'council' }],
      props: [{ x: 6, y: 4, w: 2, h: 1, draw: smallTable }],
    },
    secret2: {
      name: '밀실 2', desc: '들어온 사람끼리만 보이는 작은 방 (예정)', w: 14, h: 10, pos: [3, 1.45], crowd: 1,
      floor: 'stonefloor', dark: true, wall: true, trim: '#6b4fb3',
      emotes: ['쉿', '...'],
      doors: [{ side: 'W', at: 5, to: 'council' }],
      props: [{ x: 6, y: 4, w: 2, h: 1, draw: smallTable }],
    },
    plaza: {
      name: '구름 광장', desc: '모여서 노는 곳 · 이벤트가 열리는 곳', w: 34, h: 20, pos: [1, 0], crowd: 14,
      floor: 'na:11,12', trim: '#4bb3c4',
      emotes: ['3팀 모여~', 'ㅋㅋㅋ', '안녕!', '이벤트 언제?', '같이 다닐 사람', '우리 나라 짱'],
      doors: [{ side: 'S', at: 17, to: 'temple' }, { side: 'N', at: 17, to: 'wander' }],
      props: [
        { x: 16, y: 11, w: 2, h: 1, draw: bonfire },
        { x: 16, y: 4, w: 3, h: 3, draw: (g, x, y) => pix(g, 'pool', x, y, 2) },
        { x: 8, y: 9, w: 1, h: 1, draw: (g, x, y) => pix(g, 'u:chick', x, y + 2, 2) }, { x: 9, y: 10, w: 1, h: 1, draw: (g, x, y) => pix(g, 'u:hen', x, y + 2, 2) },
        { x: 25, y: 10, w: 1, h: 1, draw: (g, x, y) => pix(g, 'u:rabbit', x, y + 2, 2) }, { x: 26, y: 15, w: 2, h: 1, draw: (g, x, y) => pix(g, 'u:pig', x, y + 2, 2) },
        { x: 10, y: 4, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_orb', x, y + 4, 2) }, { x: 23, y: 4, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_orb', x, y + 4, 2) },
        { x: 12, y: 8, w: 2, h: 1, draw: (g, x, y) => pix(g, 'log', x, y + 2, 3) }, { x: 20, y: 8, w: 2, h: 1, draw: (g, x, y) => pix(g, 'log', x, y + 2, 3) },
        { x: 12, y: 12, w: 2, h: 1, draw: (g, x, y) => pix(g, 'log', x, y + 2, 3) }, { x: 20, y: 12, w: 2, h: 1, draw: (g, x, y) => pix(g, 'log', x, y + 2, 3) },
        { x: 6, y: 5, w: 1, h: 1, draw: (g, x, y) => pix(g, 'stump', x, y + 2, 3) }, { x: 27, y: 5, w: 1, h: 1, draw: (g, x, y) => pix(g, 'berry', x, y + 2, 3) },
        { x: 6, y: 14, w: 1, h: 1, draw: (g, x, y) => pix(g, 'berry', x, y + 2, 3) }, { x: 27, y: 14, w: 1, h: 1, draw: (g, x, y) => pix(g, 'stump', x, y + 2, 3) },
      ],
    },
    jail: { // 체포 3번이면 1시간. 문이 없어서 시간이 끝나야 나갈 수 있다
      name: '감옥', desc: '오늘 3번 잡힌 사람이 갇히는 곳', w: 15, h: 10, pos: [0, -1], crowd: 0, hidden: true,
      floor: 'stonefloor', dark: true, wall: true, trim: '#5a5a6e',
      emotes: ['억울해', '꺼내 줘', '...', '다음엔 안 잡혀'],
      doors: [],
      props: [
        { x: 3, y: 2, w: 1, h: 1, draw: (g, x, y) => pix(g, 'candles', x, y + 2) }, { x: 11, y: 2, w: 1, h: 1, draw: (g, x, y) => pix(g, 'candles', x, y + 2) },
        { x: 7, y: 2, w: 1, h: 1, draw: (g, x, y) => { pix(g, 'tomb', x, y + 2); sign(g, x, y - 70, '감옥 · 시간이 끝나면 풀려나요'); } },
      ],
    },
    wander: {
      name: '유랑민 등록소', desc: '나라 없는 사람이 귀화·용병·건국을 등록하는 곳', w: 24, h: 14, pos: [1, -1], crowd: 6,
      floor: 'na:0,5', trim: '#3fa37a',
      emotes: ['용병 구합니다', '귀화시켜 주세요', '우리 4명 모이면 건국함', '몸값 얼마?', '어느 나라가 좋음?'],
      doors: [{ side: 'S', at: 12, to: 'plaza' }],
      props: [
        { x: 9, y: 2, w: 6, h: 2, board: true, desk: 'wander', draw: (g, x, y) => { pix(g, 'cabin', x, y + 6, 3); sign(g, x, y - 132, '등록 창구'); } },
        { x: 4, y: 8, w: 1, h: 1, draw: (g, x, y) => pix(g, 'woodpile', x, y + 2, 3) }, { x: 15, y: 9, w: 2, h: 1, draw: (g, x, y) => pix(g, 'u:cow', x, y + 2, 2) }, { x: 19, y: 8, w: 1, h: 1, draw: bonfire },
        { x: 5, y: 3, w: 1, h: 1, draw: (g, x, y) => { pix(g, 'keeper', x, y + 2); nameTag(g, x, y - 58, '등록 담당', '#277a58'); } },
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
      if (R.wall) for (let x = 1; x < R.w - 1; x++) if (R.grid[R.w + x] === 0 && !R.doors.some((d) => d.side === 'N' && Math.abs(d.at - x) <= 1)) R.grid[R.w + x] = 1;
      for (const p of R.props) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (R.grid[y * R.w + x] < 10) R.grid[y * R.w + x] = 1;
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
    const pat = (key) => {
      const tc = document.createElement('canvas'); const tg = tc.getContext('2d');
      if (key.startsWith('na:')) { const [cx, cy] = key.slice(3).split(',').map(Number); tc.width = tc.height = TILE; tg.imageSmoothingEnabled = false; tg.drawImage(ART.floor, cx * 16, cy * 16, 16, 16, 0, 0, TILE, TILE); }
      else { const im = ART['x_' + key]; tc.width = im.width * 2; tc.height = im.height * 2; tg.imageSmoothingEnabled = false; tg.drawImage(im, 0, 0, tc.width, tc.height); }
      return g.createPattern(tc, 'repeat');
    };
    g.fillStyle = pat(R.floor); rr(g, 18, 18, w - 36, h - 36, 18);
    if (R.dark) { g.fillStyle = 'rgba(30,20,60,0.35)'; rr(g, 18, 18, w - 36, h - 36, 18); }
    else if (R.floor === 'stonefloor') { g.fillStyle = 'rgba(255,248,235,0.22)'; rr(g, 18, 18, w - 36, h - 36, 18); }
    for (const [cx, cy, cw, ch] of R.carpets || []) { g.fillStyle = pat('carpet'); g.fillRect(cx * TILE, cy * TILE, cw * TILE, ch * TILE); }
    if (R.wall) {
      const bt = document.createElement('canvas'); bt.width = bt.height = TILE; const bg2 = bt.getContext('2d'); bg2.imageSmoothingEnabled = false; bg2.drawImage(ART.x_brick, 0, 0, TILE, TILE);
      g.fillStyle = g.createPattern(bt, 'repeat'); g.fillRect(18, 18, w - 36, 2 * TILE - 18);
      g.fillStyle = '#c9a77a'; g.fillRect(18, 18, w - 36, 8);
      g.fillStyle = 'rgba(60,35,20,0.45)'; g.fillRect(18, 2 * TILE - 6, w - 36, 6);
    }
    for (const d of R.doors) {
      g.fillStyle = d.to === 'ground' ? 'rgba(255,236,140,0.85)' : 'rgba(255,255,255,0.0)';
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
    if (d) [player.x, player.y] = doorInside(R, d); else [player.x, player.y] = [(R.w >> 1) * TILE + 16, (R.h >> 1) * TILE + 16];
    player.scene = 'sky'; player.room = R; fadeT = 0.35; lastTerr = null; netTp = true; step.on = false;
  }
  function ascend(portalTerr) {
    player.entry = portalTerr;
    player.skyLeft = SKY_LIMIT;
    enterRoom('temple', 'ground');
    toast('하늘 신전에 올라왔어요 · 여기선 싸울 수 없어요');
  }
  function descend() {
    const t = player.entry || home;
    player.scene = 'ground'; player.room = null; fadeT = 0.35; lastTerr = null; netTp = true; step.on = false;
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
  function stall(g, x, y, hue, item, label) {
    g.fillStyle = 'rgba(0,0,0,0.14)'; ell(g, x, y, 60, 9);
    const im = tintedTent(hue);
    const prev = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    g.drawImage(im, Math.round(x - im.width * 1.75), Math.round(y - im.height * 3.5), im.width * 3.5, im.height * 3.5);
    g.imageSmoothingEnabled = prev;
    if (item === 'coin') pix(g, 'coin', x + 46, y + 2, 0, 22); else pix(g, item, x + 46, y + 2);
    sign(g, x, y - im.height * 3.5 - 20, label);
  }
  function smallTable(g, x, y) {
    pix(g, 'tomb', x, y + 2);
    pix(g, 'candles', x, y - 22);
    g.fillStyle = 'rgba(255,210,90,0.35)'; circ(g, x, y - 34, 14 + Math.sin(performance.now() / 120) * 2);
  }
  function bonfire(g, x, y) {
    const t = performance.now() / 1000;
    g.fillStyle = `rgba(255,170,60,${0.25 + Math.sin(t * 6) * 0.08})`; ell(g, x, y - 6, 70, 30);
    pix(g, 'campfire', x, y + 4, 3.5 + Math.sin(t * 9) * 0.08);
  }
  function arch(g, x, y, side, label, down) {
    const vertical = side === 'W' || side === 'E';
    if (vertical) {
      pix(g, 'arch', x, y - 8, 1.6);
      if (down) { g.fillStyle = 'rgba(255,240,170,0.45)'; g.fillRect(x - 14, y - 60, 28, 50); }
      sign(g, x + (side === 'W' ? 80 : -80), y - 2 * TILE - 30, (side === 'W' ? '← ' : '') + label + (side === 'E' ? ' →' : ''));
    } else {
      const by = side === 'N' ? y + 8 : y;
      if (down) { g.fillStyle = 'rgba(255,240,170,0.5)'; g.fillRect(x - 40, by - 70, 80, 70); }
      pix(g, 'arch', x, by, 2.2);
      sign(g, x, by - 124, (side === 'N' ? '↑ ' : '↓ ') + label);
    }
  }

  function drawSkyBackground(t) {
    const grd = ctx.createLinearGradient(0, 0, 0, vh);
    grd.addColorStop(0, DOOM ? '#cbb6ee' : '#a9dcff'); grd.addColorStop(1, DOOM ? '#ffd2dc' : '#fdf3ff');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, vw, vh);
    for (let i = 0; i < 9; i++) {
      const x = ((i * 337 + t * (8 + i * 2)) % (vw + 400)) - 200, y = (i * 173) % Math.max(1, vh);
      pix(ctx, 'cloud', x, y + 60, 0, 70 + (i % 3) * 30, 0.85);
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
  function renderInv() { $('invCoin').textContent = (myView ? myView.me.coin : inv.coin).toLocaleString(); $('invArmy').textContent = (myView ? myView.me.army : inv.army).toLocaleString(); $('invVac').textContent = myView ? myView.me.vaccine : inv.vaccine; $('invWood').textContent = myView ? myView.me.wood : 0; if (build.on) setBuild(true); }
  const player = {
    x: 0, y: 0, dir: 1, moving: false, scene: 'ground', room: null, entry: null,
    name: saved.name || '나', tag: '#277a58', team: store('mp2026.team') || 3,
    face: 0,
    look: { char: saved.char | 0, hue: saved.hue | 0, hair: saved.hair || '#8a5a3c', outfit: saved.outfit || '#3fa37a', skin: '#ffe1cc', accent: '#ff5d7a', long: saved.long !== false, me: true, seed: 0 },
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
        face: 0, look: { char: (r() * 104) | 0, hue: (r() * 6) | 0, hair: HAIRS[(r() * 6) | 0], outfit: OUTFITS[(r() * 6) | 0], skin: SKINS[(r() * 3) | 0], accent: TYPE_FILL[TYPES[(r() * 6) | 0]], long: r() < 0.45, seed: r() * 3 },
        home: [cx, cy, rad], goal: null, wait: r() * 3, speed: (0.55 + r() * 0.35) * WALK,
        emote: null, emoteT: 0, rand: rng((r() * 1e9) | 0),
        scene: room ? 'sky' : 'ground', room: room || null,
      });
    };
    if (window.MP_ONLINE) return;
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
    b.face = faceOf(dx, dy, b.face);
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
    if (k === 'b') toggleWar();
    if (k === 't') goHome();
    if (k === 'e' && !e.repeat) pressE();
    if (k === 'g' && ONLINE) setBuild(!build.on);
    if (k >= '1' && k <= '8') emote(+k - 1);
    if (k === 'enter' && ONLINE) { e.preventDefault(); $('chatIn').focus(); }
    if (k === '[' || k === ']') { location.hash = 'day' + Math.max(1, Math.min(15, DAY + (k === ']' ? 1 : -1))); }
    if (k === 'escape') { $('bigmap').hidden = true; $('closet').hidden = true; $('coupon').hidden = true; $('wanderBox').hidden = true; $('war').hidden = true; $('puzzle').hidden = true; $('storeBox').hidden = true; $('shopBox').hidden = true; if (build.on) setBuild(false); }
  });
  addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'e') releaseE(); });
  // 패드·폰: 화면 아래 안내를 누르면 E (꾹 누르기도 됨)
  $('prompt').addEventListener('pointerdown', (e) => { e.preventDefault(); pressE(); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('prompt').addEventListener(ev, releaseE);
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
  let lastTerr = null, whereDirty = false;
  const chip = (text, color, line) => { const s = document.createElement('span'); s.className = 'chip' + (line ? ' line' : ''); s.textContent = text; if (color) s.style.background = color; $('whereChips').appendChild(s); };
  function updateWhere() {
    if (player.scene === 'sky') {
      const R = player.room;
      if (lastTerr === 'sky:' + R.id) return;
      lastTerr = 'sky:' + R.id;
      $('whereChips').textContent = '';
      $('whereName').textContent = `하늘 · ${R.name.replace('하늘 ', '')}`;
      $('whereSub').textContent = R.desc;
      chip('중립 · 전투 불가', '#2b2340');
      if (R.id === 'council' || R.id.startsWith('secret')) chip('작전 회의는 나라 채팅에서', null, true);
      return;
    }
    const tx = player.x / TILE | 0, ty = player.y / TILE | 0;
    const o = terrAt(tx, ty);
    if (o === lastTerr && !whereDirty) return;
    whereDirty = false;
    lastTerr = o;
    $('whereChips').textContent = '';
    if (o > 0) {
      const t = terrs[o];
      $('whereName').textContent = t.name;
      $('whereSub').textContent = `영토 #${t.id} · ${t.type} 지방 · ${RING[t.ring]} · 넓이 ${t.area.toLocaleString()}칸`;
      chip(`${t.type} 문제`, TYPE_TAG[t.type]);
      const own = ownerOf(t.id);
      if (own) chip(myView && own === myView.me.id ? (home === t ? '우리 수도' : '우리 땅') : natName(own) + (nationsPub[own] && nationsPub[own].capital === t.id ? ' 수도' : ''), natColor(own));
      else chip('주인 없음 (중립)', null, true);
      if (myView && (myView.incoming.some((b) => b.target === t.id) || myView.outgoing.some((b) => b.target === t.id))) chip(`⚔ ${nextFight()} 전투`, '#c22f53');
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
        if (sp.board && Math.hypot(sp.x - player.x, sp.y + 16 - player.y) < 90) best = sp.prop && sp.prop.desk === 'wander' ? { kind: 'desk', text: '등록 창구 이용하기' } : { kind: 'board', text: '게시판 읽기' };
        if (sp.prop && sp.prop.shop && Math.hypot(sp.x - player.x, sp.y + 20 - player.y) < 100) best = ONLINE ? { kind: 'shop', text: sp.prop.shop === 'build' ? '바닥·방벽·덫 사기' : '백신 사기' } : sp.prop.shop === 'vaccine' ? { kind: 'vaccine', text: `백신 사기 · 코인 ${vaccinePrice().toLocaleString()}` } : null;
      }
    } else {
      const tx = player.x / TILE, ty = player.y / TILE;
      const o = terrAt(tx | 0, ty | 0);
      if (o > 0) {
        const t = terrs[o];
        const n = nodes.find((q) => q.id === t.id);
        if (t.portal && Math.hypot(t.portal[0] + 0.5 - tx, t.portal[1] + 0.5 - ty) < 1.8) best = { kind: 'portal', t, text: '하늘로 올라가기' };
        else if (n && Math.hypot(n.x - player.x, n.y - player.y) < 52) best = { kind: 'node', n, text: mined.has(n.id) ? '오늘은 다 캤어요 (내일 다시)' : '금광 캐기 · 코인' };
        else if (Math.hypot(t.altar[0] + 0.5 - tx, t.altar[1] + 0.5 - ty) < 2.4) {
          const own = ownerOf(t.id), mine = myView && own === myView.me.id;
          const canClaim = myView && !own && Object.keys(owners).some((k) => owners[k] === myView.me.id && terrs[k] && terrs[k].neighbors.includes(t.id));
          if (ONLINE && own && !mine) best = { kind: 'hit', t, text: `${natName(own)}의 수정 때리기 · ${MPRules.NUM.scoutHits}번이면 병력이 보여요` };
          else best = { kind: 'altar', t, claim: canClaim, solvable: canClaim || mine, text: canClaim ? `${t.name} · 문제 풀고 점령하기` : mine ? `우리 제단 · ${t.type} 문제 풀기 (병력)` : own ? `${natName(own)}의 제단` : `${t.name} 제단 · 우리 땅과 붙어야 점령 가능` };
        }
      }
    }
    if (player.scene === 'ground' && ONLINE && best && best.t && (best.kind === 'altar' || best.kind === 'hit')) { // 저장소가 제단보다 가까우면 저장소
      const ptx = player.x / TILE, pty = player.y / TILE, dA = Math.hypot(best.t.altar[0] + 0.5 - ptx, best.t.altar[1] + 0.5 - pty);
      for (const [i] of STORE_AT) if (Math.hypot((i % W) + 0.5 - ptx, Math.floor(i / W) + 0.5 - pty) <= Math.min(1.9, dA)) { best = null; break; }
    }
    if (!best && player.scene === 'ground' && ONLINE) best = groundAction();
    const key = best ? best.kind + best.text : '';
    if (key !== (near ? near.kind + near.text : '')) {
      $('prompt').hidden = !best;
      if (best) $('promptText').textContent = best.text;
    }
    near = best;
  }
  let toastTimer = 0;
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800); }
  function facingTile() { const d = FACE_D[player.face | 0] || [0, 1]; return [Math.floor(player.x / TILE) + d[0], Math.floor(player.y / TILE) + d[1]]; }
  const ITEM_NAME = { floor: '바닥', wall: '방벽', trap: '덫' };
  // 땅에서 할 수 있는 일: 저장소, 설치 모드, 나무 베기, 방벽 부수기
  function groundAction() {
    const ptx = player.x / TILE, pty = player.y / TILE;
    if (MY_NID) for (const [id, r] of remotes) { // 우리 땅에 들어온 적 → 체포
      if (r.x == null || !r.nid || r.nid === MY_NID || Math.hypot(r.x - player.x, r.y - player.y) > 52) continue;
      if (ownerOf(terrAt(r.x / TILE | 0, r.y / TILE | 0)) === MY_NID) return { kind: 'arrest', id, text: `${r.name}${r.carry ? ' (도둑!)' : ''} 체포하기` };
    }
    for (const [i, nid] of STORE_AT) if (Math.hypot((i % W) + 0.5 - ptx, Math.floor(i / W) + 0.5 - pty) < 1.9) {
      if (nid === MY_NID) return player.carry ? { kind: 'deposit', text: '훔쳐 온 것 저장소에 넣기' } : { kind: 'store', text: '우리 저장소 열기' };
      if (!MY_NID) return { kind: 'info', text: `${natName(nid)} 저장소` };
      if (player.carry) return { kind: 'info', text: '이미 훔친 걸 들고 있어요 · 우리 저장소로!' };
      return { kind: 'steal', nid, hold: MPRules.NUM.stealSec * 1000, text: `${natName(nid)} 저장소 털기 · E 꾹 ${MPRules.NUM.stealSec}초` };
    }
    const [fx, fy] = facingTile(), i = fy * W + fx, e = TILES[i];
    if (build.on && myView) {
      if ((e && e.n === MY_NID) || MY_TRAPS.has(i)) return { kind: 'pickup', x: fx, y: fy, text: `${ITEM_NAME[e ? e.k : 'trap']} 거두기` };
      if (ownerOf(terrAt(fx, fy)) !== MY_NID) return { kind: 'info', text: '설치 모드 · 우리 땅에만 놓을 수 있어요' };
      return { kind: 'place', x: fx, y: fy, text: `${ITEM_NAME[build.k]} 놓기 · 남은 ${myView.me.items[build.k]}개` };
    }
    if (treeAt(fx, fy) && MY_NID && ownerOf(terrAt(fx, fy)) === MY_NID) return { kind: 'chop', x: fx, y: fy, hold: MPRules.NUM.chopSec * 1000, text: '나무 베기 · E 꾹 누르기' };
    if (e && e.k === 'wall' && e.n !== MY_NID) return { kind: 'break', x: fx, y: fy, hold: MPRules.NUM.wallBreakSec * 1000, text: `${natName(e.n)} 방벽 부수기 · E 꾹 ${MPRules.NUM.wallBreakSec}초` };
    return null;
  }
  // 꾹 누르기 (나무 베기 2초, 방벽 부수기 5초)
  const hold = { on: false, t0: 0, ms: 0, kind: '', x: 0, y: 0 };
  let stunUntil = 0, jailUntil = 0;
  function pressE() { if (near && near.hold) startHold(near); else interact(); }
  function releaseE() { if (hold.on) cancelHold(); }
  function startHold(n) {
    Object.assign(hold, { on: true, t0: performance.now(), ms: n.hold, kind: n.kind, x: n.x, y: n.y });
    hold.nid = n.nid;
    if (n.kind === 'break') ws.send(JSON.stringify({ t: 'breakStart', x: n.x, y: n.y }));
    if (n.kind === 'steal') ws.send(JSON.stringify({ t: 'stealStart', nid: n.nid }));
  }
  function cancelHold() { hold.on = false; }
  function tickHold() {
    if (!hold.on || performance.now() - hold.t0 < hold.ms) return;
    hold.on = false;
    if (netOn) ws.send(JSON.stringify(hold.kind === 'steal' ? { t: 'steal', nid: hold.nid } : { t: hold.kind === 'chop' ? 'chop' : 'breakWall', x: hold.x, y: hold.y }));
  }
  // 설치 모드 (G): 저장소의 바닥·방벽·덫을 바로 앞 칸에 놓기
  const build = { on: false, k: 'floor' };
  function setBuild(on, k) {
    if (on && !myView) { toast('나라가 있어야 설치할 수 있어요'); return; }
    build.on = on; if (k) build.k = k;
    $('buildBar').hidden = !on;
    for (const b of document.querySelectorAll('#buildBar [data-k]')) { b.setAttribute('aria-pressed', String(b.dataset.k === build.k)); b.querySelector('small').textContent = myView ? myView.me.items[b.dataset.k] : 0; }
    near = null;
  }
  for (const b of document.querySelectorAll('#buildBar [data-k]')) b.addEventListener('click', () => setBuild(true, b.dataset.k));
  $('buildOff').addEventListener('click', () => setBuild(false));
  // 우리 저장소 창
  function openStore() {
    const me = myView && myView.me; if (!me) return;
    const row = (icon, name, v) => `<div class="row"><span>${icon} ${name}</span><b>${(v || 0).toLocaleString()}</b></div>`;
    $('storeBody').innerHTML = `<p class="msg">우리 나라 모두가 같이 쓰는 저장소예요. 개인 소지품은 없어요.</p>` +
      row('🪙', '코인', me.coin) + row('⚔', '병력', me.army) + row('🪵', '목재', me.wood) + row('💉', '백신', me.vaccine) +
      row('▦', '바닥', me.items.floor) + row('🧱', '방벽', me.items.wall) + row('🪤', '덫', me.items.trap) +
      `<p class="msg">바닥·방벽·덫은 하늘 거래소에서 사요. <b>설치 모드(G)</b>를 켜고 우리 땅에서 바로 앞 칸에 E로 놓아요. 바닥 위에선 우리 국민이 빨라지고, 방벽은 다른 나라 사람을 막고, 덫은 밟은 적을 3초 묶어요.</p>`;
    $('storeBox').hidden = false;
  }
  $('storeBuild').addEventListener('click', () => { $('storeBox').hidden = true; setBuild(true); });
  $('storeClose').addEventListener('click', () => { $('storeBox').hidden = true; });
  // 하늘 거래소 창
  function openShop() {
    const me = myView && myView.me;
    if (!me) { toast('나라가 있어야 살 수 있어요 (나라 공용 저장소에서 내요)'); return; }
    const P = MPRules.NUM.price;
    const item = (k, name, desc, price, counts) => `<div class="shopItem"><div><b>${name}</b> <small>${desc}</small><br><span>코인 ${price.toLocaleString()}${counts ? ' / 개' : ''}</span></div><div class="seg">${(counts || [1]).map((c) => `<button data-buy="${k}" data-n="${c}">${counts ? c + '개' : '사기'}</button>`).join('')}</div></div>`;
    $('shopBody').innerHTML = `<p class="msg">우리 저장소 코인 <b>${me.coin.toLocaleString()}</b> · 산 물건은 우리 저장소에 들어가요</p>` +
      item('floor', '▦ 바닥', '우리 국민이 1.5배 빨라짐', P.floor, [1, 5, 20]) + item('wall', '🧱 방벽', '다른 나라 사람을 막음 (5초면 부서짐)', P.wall, [1, 5, 10]) +
      item('trap', '🪤 덫', '밟은 적이 3초 동안 못 움직임 · 적에겐 안 보임', P.trap, [1, 3]) + item('vaccine', '💉 백신', '균열에서 영토 하나를 지킴 · 살수록 비싸짐', me.vaccinePrice, null);
    for (const b of $('shopBody').querySelectorAll('[data-buy]')) b.onclick = () => { ws.send(JSON.stringify({ t: 'buy', item: b.dataset.buy, n: +b.dataset.n })); };
    $('shopBox').hidden = false;
  }
  $('shopClose').addEventListener('click', () => { $('shopBox').hidden = true; });
  function interact() {
    if (!near) return;
    if (near.kind === 'store') { openStore(); return; }
    if (near.kind === 'shop') { openShop(); return; }
    if (near.kind === 'hit') { HITFX.set(near.t.id, performance.now() + 120); if (netOn) ws.send(JSON.stringify({ t: 'hit', terr: near.t.id })); return; }
    if (near.kind === 'place' || near.kind === 'pickup') { if (netOn) ws.send(JSON.stringify({ t: near.kind, x: near.x, y: near.y, k: build.k })); return; }
    if (near.kind === 'info') { toast(near.text); return; }
    if (near.kind === 'deposit') { if (netOn) ws.send(JSON.stringify({ t: 'deposit' })); return; }
    if (near.kind === 'arrest') { if (netOn) ws.send(JSON.stringify({ t: 'arrest', id: near.id })); return; }
    if (near.kind === 'node' && ONLINE) { if (mined.has(near.n.id)) { toast('이 금광은 오늘 이미 캤어요'); return; } if (netOn) ws.send(JSON.stringify({ t: 'mine', terr: near.n.id })); return; }
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
    else if (near.kind === 'altar') { if (near.solvable) openPuzzle(near.t); else toast(near.text); }
    else if (near.kind === 'desk') { $('wanderMsg').textContent = '나라가 없다면 여기서 등록하세요.'; renderWander(); $('wanderBox').hidden = false; }
    else if (near.kind === 'board') {
      if (!DOOM) toast('[공지] 신들은 아직 침묵하고 있다.');
      else toast(`[신탁] 다음 균열이 다가온다… ${TYPES[DAY % 6]} 지방을 조심하라.`);
    }
  }

  function goHome() {
    if (player.scene === 'sky') { descend(); return; }
    player.x = home.portal[0] * TILE + 16; player.y = (home.portal[1] + 1) * TILE + 16;
    if (!free(player.x, player.y, null)) teleportTo(home.portal[0], home.portal[1] + 1);
    lastTerr = null; netTp = true; step.on = false;
    toast(`우리 수도 ${home.name}(으)로 돌아왔어요`);
  }

  // ------------------------------------------------------------ 지도 이미지 (미니맵·세계 지도)
  let mapImg = null;
  function buildMapImage() {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const d = img.data;
    const base = { [T.VOID]: [27, 20, 48], [T.WATER]: [111, 183, 232], [T.MOUNTAIN]: [138, 129, 151], [T.HOLY]: [250, 238, 200] };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, t = terrain[i], o = terr[i];
      let c3 = base[t];
      if (o !== 65535 && o > 0 && gone[o]) c3 = [52, 30, 88];
      else if (!c3) {
        const tt = terrs[o];
        const own = tt ? ownerOf(o) : null;
        const mine = !!own && own === MY_NID;
        const rgb = own ? hexRgb(natColor(own)).map((v) => v * 1.25 - 40) : tt ? TYPE_RGB[tt.type] : [159, 216, 138];
        const k = t === T.FOREST ? 0.78 : t === T.SAND ? 1.05 : 0.95;
        // 우리 나라 > 다른 나라 > 중립 순으로 진하게 (중립은 유형 색을 옅게)
        const mix = mine ? 0.9 : own ? 0.75 : 0.32, add = mine ? 30 : own ? 55 : 150;
        c3 = [rgb[0] * k * mix + add, rgb[1] * k * mix + add, rgb[2] * k * mix + add];
        const r = x + 1 < W ? terr[i + 1] : o, dn = y + 1 < H ? terr[i + W] : o;
        if ((r !== o && r !== 65535 && r !== 0) || (dn !== o && dn !== 65535 && dn !== 0)) c3 = [255, 255, 255];
        if (mine) { // 우리 나라 바깥 경계 2칸: 바깥은 밝은 테두리, 안쪽은 우리 색
          const notMine = (xx, yy) => { if (xx < 0 || yy < 0 || xx >= W || yy >= H) return false; const q = terr[yy * W + xx]; return q !== 65535 && q > 0 && q !== o && ownerOf(q) !== MY_NID; };
          if (notMine(x + 1, y) || notMine(x - 1, y) || notMine(x, y + 1) || notMine(x, y - 1) || notMine(x + 1, y + 1) || notMine(x - 1, y - 1) || notMine(x + 1, y - 1) || notMine(x - 1, y + 1)) c3 = [255, 211, 77];
          else if (notMine(x + 2, y) || notMine(x - 2, y) || notMine(x, y + 2) || notMine(x, y - 2)) c3 = hexRgb(natColor(own)).map((v) => v * 0.8);
        }
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
    mg.fillStyle = '#bfe3ff'; mg.fillRect(0, 0, s, s);
    const P = (R) => [s * (0.16 + R.pos[0] * 0.23), s * (0.38 + R.pos[1] * 0.22)];
    mg.strokeStyle = '#ffffff'; mg.lineWidth = 6;
    for (const R of Object.values(ROOMS)) if (!R.hidden) for (const d of R.doors) if (d.to !== 'ground') { const [a, b] = P(R), [c, e] = P(ROOMS[d.to]); mg.beginPath(); mg.moveTo(a, b); mg.lineTo(c, e); mg.stroke(); }
    mg.font = `700 22px ${PFONT}`; mg.textAlign = 'center'; mg.textBaseline = 'middle';
    for (const R of Object.values(ROOMS)) {
      if (R.hidden) continue;
      const [x, y] = P(R), w = R.id.startsWith('secret') ? 60 : 84, h = R.id.startsWith('secret') ? 34 : 44;
      mg.fillStyle = R === player.room ? '#2b2340' : '#fffdf8'; mg.fillRect(x - w / 2, y - h / 2, w, h); mg.beginPath(); mg.rect(x - w / 2, y - h / 2, w, h);
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
    for (const b of others('ground', null)) { const bx = (b.x / TILE - tx + span / 2) * k, by = (b.y / TILE - ty + span / 2) * k; if (bx > 0 && by > 0 && bx < s && by < s) mg.fillRect(bx - 2, by - 2, 4, 4); }
    const vw = canvas.clientWidth / zoom / TILE * k, vh = canvas.clientHeight / zoom / TILE * k;
    mg.strokeStyle = '#ffffff'; mg.lineWidth = 2; mg.strokeRect(s / 2 - vw / 2, s / 2 - vh / 2, vw, vh);
    pix(mg, 'pin', s / 2, s / 2 + 2, 0, 34);
  }
  function teleportTo(tx, ty) {
    for (let r = 0; r < 30; r++) for (let a = 0; a < 16; a++) {
      const x = Math.round(tx + Math.cos(a / 16 * Math.PI * 2) * r), y = Math.round(ty + Math.sin(a / 16 * Math.PI * 2) * r);
      if (!blocked(x, y)) { netTp = true; step.on = false; player.scene = 'ground'; player.room = null; lastTerr = null; player.x = x * TILE + 16; player.y = y * TILE + 16; return true; }
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
    if (player.scene === 'ground') for (const b of others('ground', null)) bg.fillRect(b.x / TILE * k - 1.5, b.y / TILE * k - 1.5, 3, 3);
    for (const t of terrs) if (t && t.portal && !gone[t.id]) { bg.fillStyle = '#ffec8c'; bg.beginPath(); bg.arc(t.portal[0] * k, t.portal[1] * k, 3, 0, Math.PI * 2); bg.fill(); }
    const px = player.scene === 'sky' ? (player.entry || home).portal[0] * TILE : player.x, py = player.scene === 'sky' ? (player.entry || home).portal[1] * TILE : player.y;
    pix(bg, 'pin', px / TILE * k, py / TILE * k + 2, 0, 40);
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
    const cw = $('hairSw'); cw.textContent = ''; cw.classList.add('facegrid');
    const all = [...USER.chars.map((k) => ['u', k]), ...CHARS.names.map((n, j) => ['na', n, j])];
    all.forEach(([kind, name, j], i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'facebtn';
      b.setAttribute('aria-label', name);
      const cv = document.createElement('canvas'); cv.width = 38; cv.height = 38; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
      if (kind === 'u') { const im = userSprite(name, player.look.hue | 0); const sc = Math.min(36 / im.width, 36 / im.height); g.drawImage(im, (38 - im.width * sc) / 2, 38 - im.height * sc, im.width * sc, im.height * sc); }
      else g.drawImage(ART.faces, (j % CHARS.cols) * 38, Math.floor(j / CHARS.cols) * 38, 38, 38, 0, 0, 38, 38);
      b.appendChild(cv);
      b.setAttribute('aria-pressed', String((player.look.char | 0) === i));
      b.addEventListener('click', () => { player.look.char = i; closetUI(); saveLook(); });
      cw.appendChild(b);
    });
    const hw = $('outfitSw'); hw.textContent = '';
    HUES.forEach((deg, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sw';
      b.style.background = `hsl(${(200 + deg) % 360}, 55%, 55%)`;
      b.setAttribute('aria-label', `색 ${i + 1}`);
      b.setAttribute('aria-pressed', String((player.look.hue | 0) === i));
      b.addEventListener('click', () => { player.look.hue = i; closetUI(); saveLook(); });
      hw.appendChild(b);
    });
  }
  function saveLook() {
    store('mp2026.look', { name: player.name, char: player.look.char | 0, hue: player.look.hue | 0, hair: player.look.hair, outfit: player.look.outfit, long: player.look.long });
    if (window.MP_ONLINE && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'look', name: player.name, look: lookPayload() }));
  }
  $('lenSeg').parentElement.hidden = true;
  // 이름: 미리보기에선 바로 바뀌고, 온라인에선 [이름 바꾸기] 버튼 (중복 금지, 3번까지)
  let nameSet = false, renamesLeft = 3;
  $('nick').addEventListener('input', (e) => { if (window.MP_ONLINE) { $('nickMsg').textContent = ''; return; } player.name = e.target.value.trim() || '나'; tagW.delete(player.name); saveLook(); });
  function renderNameBox() { if (!window.MP_ONLINE) return; $('nickBtn').hidden = false; $('nickBtn').textContent = `이름 바꾸기 (남은 ${renamesLeft}번)`; $('nickBtn').disabled = renamesLeft <= 0; $('nick').value = player.name; }
  $('nickBtn').addEventListener('click', () => {
    const want = $('nick').value.trim(); if (want === player.name) { $('nickMsg').textContent = '지금 이름과 같아요'; return; }
    if (!confirm(`이름을 '${want}'(으)로 바꿀까요? (남은 변경 ${renamesLeft}번)`)) return;
    ws.send(JSON.stringify({ t: 'setName', name: want }));
  });
  $('btnCloset').addEventListener('click', () => { $('nick').value = player.name; $('nickMsg').textContent = ''; renderNameBox(); closetUI(); $('closet').hidden = false; });
  $('btnClosetDone').addEventListener('click', () => { $('closet').hidden = true; });

  // 쿠폰 (오프라인에서 받은 1회용 코드). 실제 게임에서는 서버가 확인하고, 한 번 쓰면 모두에게 사라진다.
  const DEMO_CODES = { 'MP-TEST-0001': { coin: 1000 }, 'MP-TEST-0002': { army: 30 }, 'MP-TEST-0003': { vaccine: 1 } };
  const REWARD_NAME = { coin: '코인', army: '병력', vaccine: '백신' };
  function redeem() {
    const raw = $('couponIn').value.toUpperCase().replace(/\s+/g, '');
    const code = /^MP[A-Z0-9]{8}$/.test(raw) ? `MP-${raw.slice(2, 6)}-${raw.slice(6)}` : raw;
    const msg = $('couponMsg');
    if (!/^MP-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) { msg.textContent = '코드 모양이 달라요. 예: MP-AB12-CD34'; return; }
    if (window.MP_ONLINE) { // 온라인: 서버가 확인하고 우리 나라에 넣어 준다
      if (!ws || ws.readyState !== 1) { msg.textContent = '서버에 연결되지 않았어요. 잠시 후 다시 해 주세요.'; return; }
      ws.send(JSON.stringify({ t: 'redeem', code })); msg.textContent = '확인하는 중…'; return;
    }
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

  // ------------------------------------------------------------ 온라인 (게임 서버에서 열었을 때만 켜짐)
  const ONLINE = !!window.MP_ONLINE;
  const TEAM_COLORS = ['#3d5fb8', '#c94a3c', '#277a58', '#8a4fc0', '#9a5f10', '#1f7f8f', '#b03a78', '#4f6b1f', '#5a4fc0', '#a0522d', '#2b6f9e', '#7a3fa0'];
  const teamColor = (n) => TEAM_COLORS[((n | 0) - 1 + TEAM_COLORS.length * 10) % TEAM_COLORS.length];
  const remotes = new Map();
  let ws = null, myId = null, netOn = false, onlineCount = 0, lastSent = 0, lastKey = '', netTp = false;
  let chatLog = [], wanderList = [];
  const EMOTE_LIST = ['안녕!', '거래 구함!', '동맹 할래?', 'ㅋㅋㅋ', '!', '?', '도와줘!', '고마워'];

  function lookPayload() { const l = player.look; return { char: l.char | 0, hue: l.hue | 0, hair: l.hair, outfit: l.outfit, skin: l.skin, accent: l.accent, long: l.long }; }
  function setNet(text) { $('netText').textContent = text; }
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: store('mp2026.token'), name: player.name, team: 0, look: lookPayload() }));
    ws.onmessage = (ev) => { try { onNet(JSON.parse(ev.data)); } catch (e) { /* 무시 */ } };
    ws.onclose = () => { netOn = false; remotes.clear(); setNet('연결이 끊겼어요 · 다시 연결하는 중…'); setTimeout(connect, 2000); };
  }
  function onNet(m) {
    switch (m.t) {
      case 'welcome': {
        myId = m.id; netOn = true; store('mp2026.token', m.token);
        if (m.name) { player.name = m.name; nameSet = !!m.nameSet; renamesLeft = m.renamesLeft; tagW.clear(); renderNameBox(); }
        player.carry = m.carry || null; player.look.red = m.red | 0; jailUntil = m.jailUntil || 0;
        TILES = m.tiles || {}; MY_TRAPS = new Set(m.traps || []); for (const i of m.chopped || []) noTree[i] = 1; if (m.stun) stunUntil = performance.now() + m.stun;
        testMode = !!m.testMode; foundingOpen = m.foundingOpen !== false; applyWorld(m.owners, m.nations, m.view || null); showNotice(m.notice); unseenBattles();
        if (!m.view) openFound('who'); else $('found').hidden = true;
        chatLog = m.chat || []; renderChat();
        wanderList = m.wander || [];
        const p = m.pos;
        if (p && p.scene === 'sky' && ROOMS[p.room]) { player.scene = 'sky'; player.room = ROOMS[p.room]; player.x = p.x; player.y = p.y; player.skyLeft = SKY_LIMIT; }
        else if (p && p.x != null && free(p.x, p.y, null)) { player.scene = 'ground'; player.room = null; player.x = p.x; player.y = p.y; }
        else goHome();
        lastTerr = null; netTp = true;
        break;
      }
      case 'meta': {
        const q = m.p;
        if (q.id === myId) { player.carry = q.carry ? (player.carry || {}) : null; player.look.red = q.red | 0; break; }
        let r = remotes.get(q.id);
        if (!r) { r = { x: null, y: null, tx: null, ty: null, dir: 1, moving: false, emote: null, emoteT: 0 }; remotes.set(q.id, r); }
        r.name = q.name; r.team = q.team; r.tag = teamColor(q.team);
        r.look = Object.assign({ seed: (q.id * 0.37) % 3 }, q.look, { red: q.red | 0 });
        r.nid = q.nid; r.carry = q.carry; r.jailed = q.jailed;
        break;
      }
      case 'leave': remotes.delete(m.id); break;
      case 'state':
        onlineCount = m.n;
        for (const [id, x, y, dir, mv, f] of m.p) {
          const r = remotes.get(id); if (!r) continue;
          if (r.x == null || Math.hypot(x - r.x, y - r.y) > 400) { r.x = x; r.y = y; }
          r.tx = x; r.ty = y; r.dir = dir; r.moving = !!mv; r.face = f | 0;
        }
        setNet(`접속 중 ${onlineCount}명 · ${player.team}팀 채팅`);
        break;
      case 'chat': chatLog.push(m); if (chatLog.length > 60) chatLog.shift(); renderChat(); break;
      case 'emote': { const r = m.id === myId ? player : remotes.get(m.id); if (r) { r.emote = m.text; r.emoteT = 3; } break; }
      case 'wander': wanderList = m.list || []; renderWander(); break;
      case 'owners': applyWorld(m.owners, m.nations); if (!$('found').hidden && foundSel !== undefined && !document.querySelector('#found [data-step=found]').hidden) drawFoundMap(); break;
      case 'joined': chatLog = m.chat || []; renderChat(); afterFounded(m.founded); break;
      case 'view': applyWorld(null, null, m.view); break;
      case 'night': applyWorld(null, null, m.view); showNight(m.reports || []); break;
      case 'puzzle': showPuzzle(m); break;
      case 'answer': puzzleResult(m.correct, m.text); break;
      case 'err': if (!$('puzzle').hidden) puzzleResult(false, m.text); toast(m.text); if (!$('war').hidden) renderWar(); break;
      case 'ok': toast(m.text); break;
      case 'name': {
        if (m.ok) { player.name = m.name; nameSet = true; renamesLeft = m.left; tagW.clear(); store('mp2026.look', Object.assign(store('mp2026.look') || {}, { name: m.name })); $('fMsg').textContent = ''; renderNameBox(); if (nameNext) { const f = nameNext; nameNext = null; f(); } else toast(`이름을 '${m.name}'(으)로 바꿨어요 · 남은 변경 ${m.left}번`); }
        else { nameNext = null; if (!$('found').hidden) $('fMsg').textContent = m.text; else { $('nickMsg').textContent = m.text; toast(m.text); } }
        break;
      }
      case 'redeem': $('couponMsg').textContent = m.text; if (m.ok) $('couponIn').value = ''; break;
      case 'tile': { if (m.e) TILES[m.i] = m.e; else delete TILES[m.i]; dirtyTile(m.i); break; }
      case 'trap': if (m.on) MY_TRAPS.add(m.i); else MY_TRAPS.delete(m.i); break;
      case 'chopped': noTree[m.i] = 1; dirtyTile(m.i); break;
      case 'hitfx': HITFX.set(m.terr, performance.now() + 120); break;
      case 'scout': toast(m.text); break;
      case 'stun': stunUntil = performance.now() + m.ms; step.on = false; toast(m.text); break;
      case 'pos': player.x = m.x; player.y = m.y; step.on = false; netTp = true; break;
      case 'mined': mined.add(m.terr); toast(m.text); break;
      case 'warp': { const p = m.pos; if (p.scene === 'sky' && ROOMS[p.room]) { player.scene = 'sky'; player.room = ROOMS[p.room]; } else { player.scene = 'ground'; player.room = null; } player.x = p.x; player.y = p.y; step.on = false; hold.on = false; fadeT = 0.35; lastTerr = null; break; }
      case 'carry': player.carry = m.carry; toast(m.text); break;
      case 'arrested': player.carry = null; jailUntil = m.jailUntil || 0; toast(m.text); break;
      case 'released': jailUntil = 0; if (player.scene === 'sky' && player.room.id === 'jail') goHome(); toast(m.text); break;
      case 'notice': showNotice(m.notice, true); break;
      case 'settings': testMode = !!m.testMode; foundingOpen = m.foundingOpen !== false; if (!$('war').hidden) renderWar(); break;
    }
  }
  // 신(운영진)의 공지: 화면 위에 띄워 두고, 닫으면 같은 공지는 다시 안 띄운다
  function showNotice(n, fresh) {
    const el = $('notice');
    if (!n || !n.text) { el.hidden = true; return; }
    if (!fresh && store('mp2026.noticeSeen') === n.ts) return;
    $('noticeText').textContent = n.text; el.hidden = false; el.dataset.ts = n.ts;
  }
  $('noticeClose').addEventListener('click', () => { $('notice').hidden = true; store('mp2026.noticeSeen', +$('notice').dataset.ts); });
  function netTick(dt) {
    for (const r of remotes.values()) {
      if (r.tx == null) continue;
      const k = Math.min(1, dt * 12);
      r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k;
      if (r.emote) { r.emoteT -= dt; if (r.emoteT <= 0) r.emote = null; }
    }
    if (player.emote) { player.emoteT -= dt; if (player.emoteT <= 0) player.emote = null; }
    if (!netOn) return;
    const nowMs = performance.now();
    if (nowMs - lastSent < 100) return;
    const key = `${Math.round(player.x)},${Math.round(player.y)},${player.moving},${player.face},${player.scene},${player.room ? player.room.id : ''}`;
    if (key === lastKey && nowMs - lastSent < 2000) return;
    lastKey = key; lastSent = nowMs;
    ws.send(JSON.stringify({ t: 'move', x: Math.round(player.x), y: Math.round(player.y), dir: player.dir, f: player.face, moving: player.moving ? 1 : 0, scene: player.scene, room: player.room ? player.room.id : null, tp: netTp ? 1 : 0 }));
    netTp = false;
  }
  // 지금 장면에 그릴 다른 사람들 (온라인: 진짜 접속자 / 오프라인: 가짜 참가자)
  function others(scene, room) {
    if (ONLINE) { const a = []; for (const r of remotes.values()) if (r.x != null) a.push(r); return a; }
    return bots.filter((b) => b.scene === scene && (scene !== 'sky' || b.room === room));
  }
  function emote(i) {
    if (ONLINE) { if (netOn) ws.send(JSON.stringify({ t: 'emote', i })); }
    else { player.emote = EMOTE_LIST[i]; player.emoteT = 3; }
  }

  // 나라 채팅
  function renderChat() {
    const box = $('chatLog');
    box.textContent = '';
    for (const m of chatLog.slice(-8)) {
      const line = document.createElement('div');
      const who = document.createElement('b'); who.textContent = m.name + ' '; line.appendChild(who);
      line.appendChild(document.createTextNode(m.text));
      box.appendChild(line);
    }
    box.scrollTop = box.scrollHeight;
  }
  function sendChat() {
    const el = $('chatIn'); const text = el.value.trim();
    if (!text || !netOn) return;
    ws.send(JSON.stringify({ t: 'chat', text })); el.value = '';
  }

  // 유랑민 등록소
  const WANDER_KIND = { naturalize: '귀화 신청', mercenary: '용병 등록', found: '건국 대기' };
  function renderWander() {
    const box = $('wanderList'); box.textContent = '';
    if (!wanderList.length) { box.textContent = '아직 등록한 사람이 없어요.'; return; }
    for (const w of wanderList) {
      const d = document.createElement('div');
      d.textContent = `${WANDER_KIND[w.kind]} · ${w.name}${w.target ? ` → ${w.target}팀` : ''}`;
      box.appendChild(d);
    }
  }
  function wanderRegister(kind, cancel) {
    const target = $('wanderTarget').value.trim();
    if (kind === 'naturalize' && !cancel && !target) { $('wanderMsg').textContent = '귀화할 나라(팀 번호)를 적어 주세요.'; return; }
    if (ONLINE) { if (netOn) ws.send(JSON.stringify({ t: 'wander', kind, target, cancel: !!cancel })); }
    else {
      wanderList = wanderList.filter((w) => w.name !== player.name);
      if (!cancel) wanderList.push({ name: player.name, kind, target });
      renderWander();
    }
    $('wanderMsg').textContent = cancel ? '등록을 취소했어요.' : `${WANDER_KIND[kind]} 완료! 왕들이 이 목록을 보고 연락해요.`;
  }
  $('btnNat').addEventListener('click', () => wanderRegister('naturalize'));
  $('btnMerc').addEventListener('click', () => wanderRegister('mercenary'));
  $('btnFound').addEventListener('click', () => wanderRegister('found'));
  $('btnWanderCancel').addEventListener('click', () => wanderRegister('mercenary', true));
  $('btnWanderClose').addEventListener('click', () => { $('wanderBox').hidden = true; });

  // 접속 화면
  function startOnline() {
    $('help').hidden = true; $('chat').hidden = false;
    setNet('서버에 연결하는 중…');
    connect();
  }
  $('chatIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { sendChat(); } if (e.key === 'Escape') e.target.blur(); });
  $('chatIn').addEventListener('focus', () => keys.clear());
  $('btnChatSend').addEventListener('click', sendChat);

  // ------------------------------------------------------------ 나라 · 영토 · 블로토 전투 (화면)
  // 온라인: 서버가 결과를 정한다 / 오프라인 미리보기: 같은 규칙(rules.js)을 브라우저에서 봇 나라들과 돌린다
  let OFF = null;                  // 오프라인 World
  let owners = {}, nationsPub = {}, myView = null, testMode = true, MY_NID = null; // MY_NID: 우리 나라 (지도에서 진하게 표시)
  const ownerOf = (tid) => owners[tid] || null;
  const natColor = (nid) => (nationsPub[nid] && nationsPub[nid].color) || '#888888';
  const natName = (nid) => (nationsPub[nid] && nationsPub[nid].name) || '중립';
  const terrLabel = (tid) => (terrs[tid] ? `${terrs[tid].name}` : `#${tid}`);

  function applyWorld(o, n, v) {
    if (o) owners = o;
    if (n) nationsPub = n;
    if (v !== undefined) myView = v;
    MY_NID = myView ? myView.me.id : null;
    STORE_AT = new Map();
    for (const n of Object.values(nationsPub)) if (!n.dead && terrs[n.capital]) { const [sx, sy] = MPRules.storageSpot(terrs[n.capital], tileAt); STORE_AT.set(sy * W + sx, n.id); clearTrees(sx, sy, 1); }
    if (myView && terrs[myView.me.capital]) { home = terrs[myView.me.capital]; player.tag = myView.me.color; }
    chunks.clear(); buildMapImage(); lastTerr = null; renderInv();
    if (!$('war').hidden) renderWar();
    checkWarAlert();
  }
  // 선전포고 알림: 처음 보는 '우리 땅 공격'이 있으면 창을 띄운다 (접속했을 때도, 접속 중에도)
  function checkWarAlert() {
    if (!myView || !myView.incoming || !myView.incoming.length) return;
    const seen = new Set(store('mp2026.warSeen') || []);
    const fresh = myView.incoming.filter((b) => !seen.has(myView.night + ':' + b.id));
    if (!fresh.length) return;
    $('warAlertList').innerHTML = fresh.map((b) => `<li><b style="color:${natColor(b.att)}">${esc(natName(b.att))}</b> → ${esc(terrLabel(b.target))}${myView.me.capital === b.target ? ' <b class="cap">수도!</b>' : ''} ${b.d ? '<small>(방어 배치 완료)</small>' : '<small>(미배치)</small>'}</li>`).join('');
    $('warAlertNote').textContent = myView.me.isKing ? `${nextFight()} 전투 전에 세 전선(A·B·C)에 방어 병력을 나눠 두세요.` + ' 안 하면 자동으로 나눠져요.' : '왕에게 알려서 방어 배치를 하게 하세요. 그 땅에 서 있으면 지휘관 보너스도 생겨요.';
    $('warAlert').hidden = false;
    $('warAlert').dataset.keys = JSON.stringify(fresh.map((b) => myView.night + ':' + b.id));
  }
  function closeWarAlert(goDefend) {
    const keys = JSON.parse($('warAlert').dataset.keys || '[]');
    store('mp2026.warSeen', [...new Set([...(store('mp2026.warSeen') || []), ...keys])].slice(-50));
    $('warAlert').hidden = true;
    if (goDefend) { warTab = 'defend'; toggleWar(true); }
  }
  $('warAlertGo').addEventListener('click', () => closeWarAlert(true));
  $('warAlertClose').addEventListener('click', () => closeWarAlert(false));
  function offSync() { applyWorld(OFF.s.owner, OFF.publicNations(), OFF_ME ? OFF.view(OFF_ME, 'me') : null); }
  let OFF_ME = null;

  function setupOffline(capId, nationName) {
    OFF = new MPRules.World({ territories: terrs.filter(Boolean) }, null);
    const center = capId ? terrs[capId] : home;
    if (capId) {
      const r = OFF.foundNation('me', player.name, nationName, capId);
      OFF_ME = r.nation.id;
      const me = r.nation; me.army = 120; me.actions = 99;
      for (const nb of terrs[capId].neighbors.slice(0, 2)) OFF.claim(me.id, nb);
      me.actions = 10;
    } else OFF_ME = null;
    home = center;
    // 가까운 수도 후보 5곳에 봇 나라를 세우고 우리 쪽으로 땅을 넓혀 둔다
    const caps = terrs.filter((t) => t && t.capitalCandidate && t.id !== home.id && !gone[t.id] && !OFF.ownerOf(t.id) && !t.neighbors.some((nb) => OFF.ownerOf(nb)))
      .sort((a, b) => OFF.distance(home.id, a.id) - OFF.distance(home.id, b.id)).slice(0, 5);
    const BOT_NAMES = ['라온 왕국', '미르 제국', '솔빛 연합', '가람 공국', '누리 왕조'];
    caps.forEach((c, i) => {
      const b = OFF.ensureNation(30 + i, 'bot' + i, '봇' + (i + 1), c.id);
      if (b) b.color = ['#c94a3c', '#8a4fc0', '#9a5f10', '#1f7f8f', '#b03a78'][i];
      if (!b) return;
      b.name = BOT_NAMES[i]; b.army = 60 + ((hash(i, 3) * 80) | 0); b.actions = 99;
      for (let k = 0; k < 9; k++) {
        const cand = [];
        for (const tid of OFF.territoriesOf(b.id)) for (const nb of terrs[tid].neighbors) if (!OFF.ownerOf(nb) && !gone[nb]) cand.push(nb);
        if (!cand.length) break;
        cand.sort((x, y) => OFF.distance(x, home.id) - OFF.distance(y, home.id));
        OFF.claim(b.id, cand[0]);
      }
    });
    botsDeclare();
    offSync();
  }
  // 봇들이 우리 땅을 노린다 (미리보기에서 방어 화면을 볼 수 있게)
  function botsDeclare() {
    if (!OFF_ME) return;
    const mine = OFF.territoriesOf(OFF_ME);
    for (const b of OFF.alive().filter((n) => n.id !== OFF_ME)) {
      if (hash(b.team, OFF.s.night, 9) > 0.55 && !(OFF.s.night === 1 && !OFF.s.battles.length)) continue;
      const tgt = mine.find((tid) => OFF.touches(b.id, tid) && !OFF.s.battles.some((x) => x.target === tid));
      if (!tgt) continue;
      const total = Math.min(b.army, 30 + ((hash(b.team, OFF.s.night) * 50) | 0));
      const r = [hash(b.team, 1, OFF.s.night), hash(b.team, 2, OFF.s.night), hash(b.team, 3, OFF.s.night)];
      const tr = r.map((v) => Math.floor(total * v / (r[0] + r[1] + r[2])));
      OFF.declare(b.id, tgt, tr);
    }
  }
  function offCmd(nid, tid) { return nid === OFF_ME && player.scene === 'ground' && terrAt(player.x / TILE | 0, player.y / TILE | 0) === tid ? 1 : 0; }

  // 행동 보내기 (온라인: 서버로 / 오프라인: 바로 적용)
  function warAction(t, payload) {
    if (ONLINE) { if (netOn) ws.send(JSON.stringify(Object.assign({ t }, payload))); return; }
    if (t === 'kingTo') { toast('미리보기에선 왕을 넘길 국민이 없어요'); return; }
    if (!OFF_ME && t !== 'resolveNow') { toast('나라가 없어요 · 유랑민 등록소에서 귀화나 건국을 하세요'); return; }
    let r;
    if (t === 'claim') r = OFF.claim(OFF_ME, payload.terr);
    else if (t === 'declare') r = OFF.declare(OFF_ME, payload.terr, payload.troops);
    else if (t === 'cancel') r = OFF.cancel(OFF_ME, payload.battle);
    else if (t === 'defend') r = OFF.defend(OFF_ME, payload.terr, payload.troops);
    else if (t === 'resolveNow') return offNight();
    if (!r.ok) { toast(r.err); return; }
    toast(t === 'claim' ? `${terrLabel(payload.terr)}을(를) 점령했어요` : t === 'declare' ? `선전포고 완료 · ${nextFight()}에 결과가 나와요` : t === 'cancel' ? '선전포고를 취소했어요' : '방어 배치 저장');
    offSync();
  }
  function offNight() {
    const reps = OFF.resolveAll(offCmd);
    for (const n of OFF.alive()) { n.army += n.id === OFF_ME ? 0 : 30; n.actions = n.id === OFF_ME ? 10 : 99; }
    botsDeclare();
    offSync();
    showNight(reps.filter((r) => r.att === OFF_ME || r.def === OFF_ME));
  }
  function showNight(reps) {
    if (!reps.length) { toast('이번 전투: 우리 나라는 전투가 없었어요'); return; }
    playBattles(reps, () => {
      warTab = 'report'; $('war').hidden = false; renderWar();
      const w = reps.filter((r) => (r.winner === 'att') === (r.att === myView.me.id)).length; toast(`전투 결과: ${reps.length}전 ${w}승`);
    });
  }
  // 다음 전투 시각 (13시·22시, 한국 시간)
  function nextFight() { const h = new Date(Date.now() + 9 * 3600e3).getUTCHours(); return h < 13 ? '오늘 13시' : h < 22 ? '오늘 22시' : '내일 13시'; }
  // ---- 전투 장면: 전투마다 약 3.5초 연출 + 왼쪽 요약. 화면을 누르면 결과로 건너뛴다
  const BT = { list: [], i: 0, t0: 0, done: null, raf: 0 };
  function playBattles(reps, done) {
    const seen = new Set(store('mp2026.battleSeen') || []);
    BT.list = reps.slice(); BT.i = 0; BT.done = done;
    store('mp2026.battleSeen', [...seen, ...reps.map((r) => r.id)].slice(-80));
    $('battle').hidden = false; startBattle();
  }
  // 접속했을 때 아직 못 본 지난밤 전투가 있으면 보여 준다
  function unseenBattles() {
    if (!myView || !myView.reports || !myView.reports.length) return;
    const seen = new Set(store('mp2026.battleSeen') || []);
    const last = Math.max(...myView.reports.map((r) => r.night));
    const reps = myView.reports.filter((r) => r.night === last && !seen.has(r.id));
    if (reps.length) setTimeout(() => playBattles(reps, () => {}), 600);
  }
  function startBattle() {
    const r = BT.list[BT.i]; BT.t0 = performance.now();
    const meAtt = myView && r.att === myView.me.id;
    const won = (r.winner === 'att') === meAtt;
    $('btSide').innerHTML = `<h3>⚔ ${r.night}번째 전투</h3><div class="where">${esc(terrLabel(r.target))}${r.capital ? ' · <b>수도</b>' : ''}</div>
      <div class="vs"><b style="color:${natColor(r.att)}">${esc(r.attName)}</b> 공격 ×${r.mA}<br><b style="color:${natColor(r.def)}">${esc(r.defName)}</b> 방어 ×${r.mD}${r.autoDef ? ' (자동 배치)' : ''}</div>
      <table>${['A', 'B', 'C'].map((f, i) => `<tr data-lane="${i}"><th>${f}</th><td>${r.effA[i]}</td><td>vs</td><td>${r.effD[i]}</td><td class="res"></td></tr>`).join('')}</table>
      <div class="sum" hidden>${won ? '🎉 승리' : '패배'} · 전선 ${r.fronts.filter((x) => x === 'att').length}:${r.fronts.filter((x) => x === 'def').length}<br>${r.winner === 'att' ? (meAtt ? '영토를 점령했어요' : '영토를 빼앗겼어요') : (meAtt ? '공격이 막혔어요' : '방어 성공!')}${r.merged ? '<br><b>수도 함락 · 나라 병합</b>' : ''}<br><small>잃은 병력 ${esc(r.attName)} −${r.lossA} · ${esc(r.defName)} −${r.lossD}</small></div>
      <div class="btns"><button id="btNext">${BT.i < BT.list.length - 1 ? `다음 전투 (${BT.i + 2}/${BT.list.length})` : '닫기'}</button></div>`;
    $('btNext').onclick = (e) => { e.stopPropagation(); nextBattle(); };
    cancelAnimationFrame(BT.raf); const loop = () => { drawBattle(r, (performance.now() - BT.t0) / 1000); BT.raf = requestAnimationFrame(loop); }; loop();
  }
  function nextBattle() {
    if (++BT.i < BT.list.length) return startBattle();
    cancelAnimationFrame(BT.raf); $('battle').hidden = true; if (BT.done) BT.done();
  }
  $('battle').addEventListener('click', () => { if (performance.now() - BT.t0 < BT_END * 1000) BT.t0 = performance.now() - BT_END * 1000; });
  const BT_LANE = (i) => 0.9 + i * 0.55, BT_END = 2.9; // 전선별 충돌 시작 시각, 결과 시각
  function drawBattle(r, t) {
    const cv = $('btCanvas'), W2 = cv.clientWidth, H2 = cv.clientHeight;
    if (cv.width !== W2 || cv.height !== H2) { cv.width = W2; cv.height = H2; }
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    const ease = (x) => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x), lerp = (a, b, k) => a + (b - a) * k;
    const sc = Math.max(2, Math.min(4, Math.floor(H2 / 160)));
    g.fillStyle = '#4f7a3a'; g.fillRect(0, 0, W2, H2);
    for (let i = 0; i < 140; i++) { g.fillStyle = i % 3 ? '#5c8a44' : '#456b32'; g.fillRect((i * 97) % W2, (i * 53) % H2, 6, 3); }
    const lanes = [0.25, 0.5, 0.75].map((k) => H2 * k), mid = W2 / 2;
    const cA = natColor(r.att), cD = natColor(r.def);
    g.fillStyle = cA; g.fillRect(0, 0, 8, H2); g.fillStyle = cD; g.fillRect(W2 - 8, 0, 8, H2);
    const march = ease(t / 0.8), walk = Math.floor(t * 8) % 4;
    const spr = (name, col, row, x, y, a) => { const k = Math.max(0, CHARS.names.indexOf(name)); g.globalAlpha = a; g.drawImage(ART.chars, (k % CHARS.cols) * 64 + col * 16, Math.floor(k / CHARS.cols) * 112 + row * 16, 16, 16, Math.round(x - 8 * sc), Math.round(y - 16 * sc), 16 * sc, 16 * sc); g.globalAlpha = 1; };
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      const y = lanes[i], local = t - BT_LANE(i), win = r.fronts[i];
      g.fillStyle = 'rgba(60,40,30,.35)'; g.fillRect(20, y - 4, W2 - 40, 10);
      const nA = Math.max(1, Math.min(5, Math.round(r.a[i] / 5))), nD = Math.max(1, Math.min(5, Math.round(r.d[i] / 5)));
      const fight = local > 0 && local < 0.45, done = local >= 0.45;
      let ax = lerp(30 + 16 * sc, mid - 18 * sc, march), dx = lerp(W2 - 30 - 16 * sc, mid + 18 * sc, march);
      if (fight) { const sh = Math.sin(local * 70) * 3; ax += sh; dx -= sh; }
      if (done) { const k = ease((local - 0.45) / 0.3) * 14 * sc; ax += win === 'att' ? k : -k; dx += win === 'att' ? k : -k; }
      for (let k = 0; k < nA; k++) spr('SamuraiBlue', 3, fight ? 4 : march < 1 ? walk : 0, ax - (k % 3) * 11 * sc, y + 6 + Math.floor(k / 3) * 7 * sc - 4, done && win !== 'att' && k >= Math.floor(nA / 2) ? 0.25 : 1);
      for (let k = 0; k < nD; k++) spr('CamouflageRed', 2, fight ? 4 : march < 1 ? walk : 0, dx + (k % 3) * 11 * sc, y + 6 + Math.floor(k / 3) * 7 * sc - 4, done && win === 'att' && k >= Math.floor(nD / 2) ? 0.25 : 1);
      g.font = `700 ${6 * sc}px ${PFONT}`; g.lineWidth = 4; g.lineJoin = 'round';
      for (const [v, x, col] of [[r.effA[i], ax - 10 * sc, cA], [r.effD[i], dx + 10 * sc, cD]]) { g.strokeStyle = col; g.strokeText(v, x, y - 19 * sc); g.fillStyle = '#fff'; g.fillText(v, x, y - 19 * sc); }
      if (local > 0 && local < 0.55) { const s2 = (1 + local * 3) * sc * 9, a = 1 - local / 0.55; g.globalAlpha = a; g.drawImage(ART.x_burst, mid - s2 / 2, y - s2 * 0.65, s2, s2); g.globalAlpha = 1; }
      if (local > 0.4) {
        const p = ease((local - 0.4) / 0.2), col = win === 'att' ? cA : cD;
        g.save(); g.translate(mid, y - 2); g.scale(lerp(2, 1, p), lerp(2, 1, p)); g.rotate(-0.08); g.globalAlpha = p;
        g.fillStyle = col; g.fillRect(-23 * sc, -7 * sc, 46 * sc, 14 * sc); g.fillStyle = '#fff6d6'; g.fillRect(-22 * sc, -6 * sc, 44 * sc, 12 * sc);
        g.fillStyle = col; g.font = `700 ${7 * sc}px ${PFONT}`; g.fillText(win === 'att' ? '공격 승' : '방어 승', 0, 1);
        g.restore(); g.globalAlpha = 1;
        const row = document.querySelector(`#btSide tr[data-lane="${i}"]`);
        if (row && !row.dataset.done) { row.dataset.done = 1; row.querySelector('.res').textContent = win === 'att' ? '공격 승' : '방어 승'; row.className = win; }
      }
    }
    if (t < 0.6) { // 시작 글자
      g.globalAlpha = 1 - ease((t - 0.3) / 0.3); g.font = `700 ${12 * sc}px ${PFONT}`; g.lineWidth = 6; g.strokeStyle = '#c22f53'; g.strokeText('⚔ 전투 시작', mid, H2 / 2); g.fillStyle = '#fff'; g.fillText('⚔ 전투 시작', mid, H2 / 2); g.globalAlpha = 1;
    }
    if (t >= BT_END) {
      const sum = document.querySelector('#btSide .sum'); if (sum && sum.hidden) { sum.hidden = false; for (let i = 0; i < 3; i++) { const row = document.querySelector(`#btSide tr[data-lane="${i}"]`); if (!row.dataset.done) { row.dataset.done = 1; row.querySelector('.res').textContent = r.fronts[i] === 'att' ? '공격 승' : '방어 승'; row.className = r.fronts[i]; } } }
      const meAtt = myView && r.att === myView.me.id, won = (r.winner === 'att') === meAtt;
      const p = ease((t - BT_END) / 0.35);
      g.globalAlpha = p * 0.55; g.fillStyle = '#1b1430'; g.fillRect(0, 0, W2, H2); g.globalAlpha = p;
      g.font = `700 ${16 * sc}px ${PFONT}`; g.lineWidth = 8; g.strokeStyle = won ? '#c27a00' : '#7a1f3a'; g.strokeText(won ? '승리!' : '패배', mid, H2 / 2); g.fillStyle = won ? '#ffd34d' : '#ffb3c4'; g.fillText(won ? '승리!' : '패배', mid, H2 / 2);
      g.globalAlpha = 1;
    }
  }

  // ---- 전쟁 창
  let warTab = 'nation', warTarget = null;
  const troopsOf = (id) => [0, 1, 2].map((i) => Math.max(0, parseInt($(id + i).value, 10) || 0));
  function troopInputs(prefix, vals, disabled) {
    return `<div class="fronts">${['A', 'B', 'C'].map((f, i) => `<label class="front"><span>${f} 전선</span><input id="${prefix}${i}" type="number" min="0" max="99999" step="1" inputmode="numeric" value="${vals[i] | 0}" ${disabled ? 'disabled' : ''}></label>`).join('')}</div>`;
  }
  function renderWar() {
    const v = myView, box = $('warBody');
    if (!v) { $('warHead').textContent = ''; box.innerHTML = '<p class="msg">아직 나라가 없어요. 하늘의 유랑민 등록소에서 귀화·용병·건국을 등록하거나, 건국 기간에는 나라를 세울 수 있어요.</p>'; return; }
    const me = v.me, king = me.isKing;
    $('warHead').innerHTML = `<b style="color:${me.color}">■</b> ${esc(me.name)} · 왕 ${esc(me.kingName || '')}<br><span>병력 <b>${me.army}</b> · 영토 ${me.territories}곳 · 이번 전투 선전포고 ${me.declaresLeft}/${MPRules.NUM.maxDeclare} · 행동력 ${me.actions}</span>`;
    for (const b of document.querySelectorAll('#warTabs button')) b.setAttribute('aria-pressed', String(b.dataset.tab === warTab));
    let h = '';
    if (!king) h += '<p class="note">전쟁 결정(선전포고·방어 배치)은 왕만 할 수 있어요. 여기선 상황만 볼 수 있어요.</p>';
    if (warTab === 'nation') {
      h += `<div class="plan"><div class="row"><span>초대 코드</span><b class="code">${esc(me.code || '')}</b></div><p class="msg">팀원에게 이 코드를 알려 주면 [초대 코드로 들어가기]로 우리 나라에 들어와요 (최대 ${MPRules.NUM.maxMembers}명).</p></div>`;
      h += `<h3>국민 (${me.members}/${MPRules.NUM.maxMembers})</h3>` + (me.memberList || []).map((m) => `<div class="row"><span>${m.king ? '👑 ' : ''}${esc(m.name)}${m.me ? ' (나)' : ''}</span>${king && !m.king ? `<button data-king="${m.idx}">왕 넘기기</button>` : ''}</div>`).join('');
      h += `<h3>나라 정보</h3><div class="msg">수도 ${esc(terrLabel(me.capital))} · 영토 ${me.territories}곳 · 병력 ${me.army} · 행동력 ${me.actions}</div>`;
    } else if (warTab === 'attack') {
      const mineSet = new Set(Object.keys(owners).filter((k) => owners[k] === me.id).map(Number));
      const targets = [];
      for (const tid of mineSet) for (const nb of terrs[tid].neighbors) if (owners[nb] && owners[nb] !== me.id && !gone[nb] && !targets.includes(nb)) targets.push(nb);
      if (v.outgoing.length) h += `<h3>${nextFight()} 전투 · 우리 공격</h3>` + v.outgoing.map((b) => `<div class="row"><span>⚔ ${esc(terrLabel(b.target))} <i style="color:${natColor(b.def)}">${esc(natName(b.def))}</i> · ${b.a.join(' / ')}</span>${king ? `<button data-cancel="${b.id}">취소</button>` : ''}</div>`).join('');
      h += `<h3>공격할 수 있는 적 영토 (${targets.length})</h3>`;
      if (!targets.length) h += '<p class="msg">우리 땅과 붙어 있는 적 영토가 없어요. 중립 땅을 점령해서 적과 국경을 맞대세요 (제단에서 E).</p>';
      h += '<div class="targets">' + targets.map((tid) => `<button class="tgt" data-tgt="${tid}" aria-pressed="${tid === warTarget}"><b style="color:${natColor(owners[tid])}">■</b> ${esc(terrLabel(tid))}<small>${esc(natName(owners[tid]))}${nationsPub[owners[tid]] && nationsPub[owners[tid]].capital === tid ? ' · 수도!' : ''}</small></button>`).join('') + '</div>';
      if (warTarget && targets.includes(warTarget)) {
        const dist = OFF ? OFF.distance(me.capital, warTarget) : null;
        h += `<div class="plan"><h3>${esc(terrLabel(warTarget))} 공격 계획</h3>
          <p class="msg">병력을 세 전선에 몰래 나눠요. 세 곳 중 <b>두 곳 이상</b> 이기면 승리. 상대도 몰래 나눠요.${dist != null ? ` 보급선 ${Math.min(40, Math.max(0, dist - 1) * 5)}% 감소.` : ''}</p>
          ${troopInputs('atk', [0, 0, 0], !king)}
          <div class="row"><span id="atkSum">합계 0 / ${me.army}</span>${king ? '<button id="btnDeclare">선전포고</button>' : ''}</div></div>`;
      }
    } else if (warTab === 'defend') {
      h += `<h3>${nextFight()} 전투 · 우리 땅을 노리는 공격 (${v.incoming.length})</h3>`;
      if (!v.incoming.length) h += '<p class="msg">지금은 공격받는 곳이 없어요.</p>';
      h += v.incoming.map((b) => `<div class="plan"><div class="row"><span>🛡 ${esc(terrLabel(b.target))} ← <i style="color:${natColor(b.att)}">${esc(natName(b.att))}</i>${nationsPub[me.id] && me.capital === b.target ? ' · <b>수도!</b>' : ''}</span><span>${b.d ? '배치 완료' : '<b>미배치</b> (안 하면 자동 배치)'}</span></div>
        ${troopInputs('def' + b.id + '_', b.d || [0, 0, 0], !king)}${king ? `<div class="row"><span id="defSum${b.id}" data-max="${me.army + (b.d ? b.d[0] + b.d[1] + b.d[2] : 0)}">합계 ${b.d ? b.d[0] + b.d[1] + b.d[2] : 0} / ${me.army + (b.d ? b.d[0] + b.d[1] + b.d[2] : 0)} · 상대 병력은 비밀</span><button data-defend="${b.target}" data-bid="${b.id}">방어 배치 저장</button></div>` : ''}</div>`).join('');
    } else {
      h += `<h3>지난 전투 결과</h3>`;
      if (!v.reports.length) h += '<p class="msg">아직 전투 기록이 없어요.</p>';
      h += v.reports.slice().reverse().map((r) => {
        const weAtt = r.att === me.id, won = (r.winner === 'att') === weAtt;
        return `<div class="report ${won ? 'won' : 'lost'}"><div class="row"><b>${won ? '승리' : '패배'}</b><span>${r.night}번째 전투 · ${esc(terrLabel(r.target))}</span></div>
          <div class="msg">${esc(r.attName)}(공격) → ${esc(r.defName)}(방어)${r.autoDef ? ' · 방어 자동 배치' : ''}</div>
          <table><tr><th></th><th>A</th><th>B</th><th>C</th></tr>
          <tr><td>공격 ×${r.mA}</td>${r.effA.map((x, i) => `<td class="${r.fronts[i] === 'att' ? 'w' : ''}">${x}</td>`).join('')}</tr>
          <tr><td>방어 ×${r.mD}</td>${r.effD.map((x, i) => `<td class="${r.fronts[i] === 'def' ? 'w' : ''}">${x}</td>`).join('')}</tr></table>
          <div class="msg">손실: 공격 −${r.lossA} · 방어 −${r.lossD}${r.winner === 'att' ? ' · 영토가 넘어갔어요' : ''}${r.merged ? ' · <b>수도 함락! 나라 전체가 병합됐어요</b>' : ''}</div></div>`;
      }).join('');
    }
    if (testMode) h += `<div class="row test"><span>테스트용</span><button id="btnResolve">지금 전투 처리</button></div>`;
    box.innerHTML = h;
    // 이벤트
    for (const b of box.querySelectorAll('[data-king]')) b.onclick = () => warAction('kingTo', { idx: +b.dataset.king });
    for (const b of box.querySelectorAll('[data-tgt]')) b.onclick = () => { warTarget = +b.dataset.tgt; renderWar(); };
    for (const b of box.querySelectorAll('[data-cancel]')) b.onclick = () => warAction('cancel', { battle: +b.dataset.cancel });
    // 방어 배치: 쓸 수 있는 병력(지금 병력 + 이 전투에 이미 배치한 병력)을 넘으면 저장 막기
    for (const b of box.querySelectorAll('[data-defend]')) {
      const bid = b.dataset.bid, sumEl = $('defSum' + bid), max = +sumEl.dataset.max;
      const check = () => { const t = troopsOf('def' + bid + '_'), s = t[0] + t[1] + t[2]; sumEl.textContent = s > max ? `합계 ${s} / ${max} · 병력이 모자라요!` : `합계 ${s} / ${max} · 상대 병력은 비밀`; sumEl.style.color = s > max ? '#c22f53' : ''; b.disabled = s > max; return s <= max; };
      for (let i = 0; i < 3; i++) $('def' + bid + '_' + i).oninput = check;
      check();
      b.onclick = () => { if (check()) warAction('defend', { terr: +b.dataset.defend, troops: troopsOf('def' + bid + '_') }); };
    }
    const upd = () => { const t = troopsOf('atk'); const el = $('atkSum'); if (el) { const s = t[0] + t[1] + t[2]; el.textContent = s > me.army ? `합계 ${s} / ${me.army} · 병력이 모자라요!` : `합계 ${s} / ${me.army}`; el.style.color = s > me.army ? '#c22f53' : ''; if ($('btnDeclare')) $('btnDeclare').disabled = s > me.army || s <= 0; } };
    for (let i = 0; i < 3; i++) { const el = document.getElementById('atk' + i); if (el) el.oninput = upd; }
    if ($('btnDeclare')) { upd(); $('btnDeclare').onclick = () => warAction('declare', { terr: warTarget, troops: troopsOf('atk') }); }
    if ($('btnResolve')) $('btnResolve').onclick = () => warAction('resolveNow', {});
  }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function toggleWar(force) {
    const el = $('war'); el.hidden = force !== undefined ? !force : !el.hidden;
    if (!el.hidden) { if (ONLINE && netOn) ws.send(JSON.stringify({ t: 'war' })); renderWar(); }
  }
  $('btnWar').addEventListener('click', () => toggleWar());
  $('btnWarClose').addEventListener('click', () => toggleWar(false));
  for (const b of document.querySelectorAll('#warTabs button')) b.addEventListener('click', () => { warTab = b.dataset.tab; renderWar(); });

  // ------------------------------------------------------------ 건국 화면
  let foundingOpen = true, foundSel = null;
  function capOptions() {
    const capOf = {};
    for (const n of Object.values(nationsPub)) if (!n.dead) capOf[n.capital] = n.id;
    return terrs.filter((t) => t && t.capitalCandidate).map((c) => {
      let status = 'free';
      if (gone[c.id]) status = 'gone';
      else if (capOf[c.id]) status = 'taken';
      else if (owners[c.id]) status = 'owned';
      else if (c.neighbors.some((nb) => capOf[nb])) status = 'near';
      return { t: c, status, nation: capOf[c.id] || owners[c.id] || null };
    });
  }
  function openFound(step) {
    $('found').hidden = false;
    for (const el of document.querySelectorAll('#found [data-step]')) el.hidden = el.dataset.step !== step;
    if (step === 'who') { $('fNick').value = player.name; $('fJoinCard').disabled = !ONLINE; $('fJoinNote').hidden = ONLINE; $('fFoundCard').disabled = !foundingOpen; $('fFoundNote').hidden = foundingOpen; }
    if (step === 'found') { foundSel = null; drawFoundMap(); showFoundInfo(); $('fName').focus(); }
    if (step === 'done') { $('fCode').textContent = myView ? myView.me.code : '-----'; $('fDoneName').textContent = myView ? myView.me.name : ''; }
    $('fMsg').textContent = '';
  }
  function saveNick() {
    player.name = $('fNick').value.trim().slice(0, 10) || '나';
    tagW.clear(); saveLook();
  }
  const fCanvas = $('fMap'), fg = fCanvas.getContext('2d');
  function drawFoundMap() {
    const S = fCanvas.width, k = S / W;
    fg.imageSmoothingEnabled = false;
    fg.fillStyle = '#1b1430'; fg.fillRect(0, 0, S, S);
    fg.drawImage(mapImg, 0, 0, S, S);
    for (const o of capOptions()) {
      const [x, y] = [o.t.altar[0] * k, o.t.altar[1] * k];
      if (o.status === 'free') { fg.drawImage(ART.flags, 0, 0, 16, 16, x - 9, y - 16, 22, 22); }
      else if (o.status === 'taken') { fg.fillStyle = '#1b1430'; fg.fillRect(x - 7, y - 7, 14, 14); fg.fillStyle = natColor(o.nation); fg.fillRect(x - 5, y - 5, 10, 10); }
      else { fg.fillStyle = 'rgba(27,20,48,0.6)'; fg.fillRect(x - 4, y - 4, 8, 8); }
      if (foundSel === o.t.id) { fg.strokeStyle = '#ffd23f'; fg.lineWidth = 3; fg.strokeRect(x - 13, y - 19, 26, 28); }
    }
  }
  function showFoundInfo() {
    const box = $('fInfo');
    if (!foundSel) { box.innerHTML = '<b>지도에서 깃발(수도 후보)을 눌러 고르세요.</b><br><span>깃발 = 비어 있음 · 색 네모 = 다른 나라 수도 · 어두운 점 = 고를 수 없음</span>'; $('btnFound').disabled = true; return; }
    const t = terrs[foundSel];
    const near = Object.values(nationsPub).filter((n) => !n.dead && terrs[n.capital] && Math.hypot(terrs[n.capital].center[0] - t.center[0], terrs[n.capital].center[1] - t.center[1]) < 90).length;
    const nbFree = t.neighbors.filter((nb) => !owners[nb] && !gone[nb]).length;
    box.innerHTML = `<b>${esc(t.name)}</b> · ${t.type} 지방 · ${RING[t.ring]}<br><span>넓이 ${t.area.toLocaleString()}칸 · 이웃 영토 ${t.neighbors.length}곳 (빈 땅 ${nbFree}) · 가까운 다른 나라 ${near}곳</span>`;
    $('btnFound').disabled = false;
  }
  fCanvas.addEventListener('click', (e) => {
    const r = fCanvas.getBoundingClientRect(), k = fCanvas.width / W;
    const mx = (e.clientX - r.left) / r.width * fCanvas.width, my = (e.clientY - r.top) / r.height * fCanvas.height;
    let best = null, bd = 18;
    for (const o of capOptions()) { const d = Math.hypot(o.t.altar[0] * k - mx, o.t.altar[1] * k - my); if (d < bd) { bd = d; best = o; } }
    if (!best) return;
    if (best.status !== 'free') { $('fMsg').textContent = best.status === 'taken' ? `${natName(best.nation)}의 수도예요` : best.status === 'near' ? '다른 나라 수도 바로 옆이라 고를 수 없어요' : '고를 수 없는 곳이에요'; return; }
    foundSel = best.t.id; $('fMsg').textContent = ''; drawFoundMap(); showFoundInfo();
  });
  // 온라인: 이름은 서버가 확인 (동명이인 금지). 통과하면 다음 단계로
  let nameNext = null;
  function withName(next) {
    if (!ONLINE) { saveNick(); next(); return; }
    const want = $('fNick').value.trim();
    if (nameSet && want === player.name) { next(); return; }
    if (!netOn) { $('fMsg').textContent = '서버에 연결하는 중이에요. 잠시 후 다시 눌러 주세요'; return; }
    nameNext = next; $('fMsg').textContent = '이름 확인 중…';
    ws.send(JSON.stringify({ t: 'setName', name: want }));
  }
  $('fFoundCard').addEventListener('click', () => withName(() => openFound('found')));
  $('fJoinCard').addEventListener('click', () => withName(() => openFound('join')));
  $('fWanderCard').addEventListener('click', () => withName(() => startWanderer()));
  for (const b of document.querySelectorAll('#found [data-back]')) b.addEventListener('click', () => openFound('who'));
  $('btnFound').addEventListener('click', () => {
    const name = $('fName').value.trim();
    if (name.length < 2) { $('fMsg').textContent = '나라 이름을 2글자 이상 지어 주세요'; return; }
    if (!foundSel) return;
    if (ONLINE) { netAfterLook(); ws.send(JSON.stringify({ t: 'found', name, capital: foundSel })); }
    else { setupOffline(foundSel, name); afterFounded(true); }
  });
  $('btnJoinCode').addEventListener('click', () => {
    const code = $('fCodeIn').value.trim().toUpperCase();
    if (code.length !== 5) { $('fMsg').textContent = '초대 코드는 5글자예요'; return; }
    if (ONLINE) { netAfterLook(); ws.send(JSON.stringify({ t: 'join', code })); }
  });
  $('fCodeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoinCode').click(); });
  $('btnCopyCode').addEventListener('click', () => {
    const code = $('fCode').textContent;
    const done = () => { $('btnCopyCode').textContent = '복사됨'; setTimeout(() => { $('btnCopyCode').textContent = '코드 복사'; }, 1500); };
    try { navigator.clipboard.writeText(code).then(done, () => { selectText($('fCode')); }); } catch (e) { selectText($('fCode')); }
  });
  function selectText(el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  $('btnStart').addEventListener('click', () => { $('found').hidden = true; goHome(); });
  function netAfterLook() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'look', name: player.name, look: lookPayload() })); }
  function afterFounded(founded) {
    if (founded) openFound('done');
    else { $('found').hidden = true; goHome(); toast(`${myView.me.name}에 들어왔어요!`); }
  }
  function startWanderer() {
    $('found').hidden = true;
    if (!ONLINE && !OFF) setupOffline(null, null);
    // 유랑민: 지도 아무 곳(무너진 땅 제외)에 떨어진다
    const r = rng((Date.now() / 1000) | 0);
    for (let i = 0; i < 500; i++) { const x = (r() * W) | 0, y = (r() * H) | 0; if (!blocked(x, y)) { teleportTo(x, y); break; } }
    toast('유랑민으로 떨어졌어요 · 하늘 유랑민 등록소에서 귀화·용병·건국을 등록할 수 있어요');
  }

  // ------------------------------------------------------------ 제단 수학 퍼즐
  // 온라인: 문제만 받고 답은 서버가 확인 / 미리보기: puzzles.preview.json (샘플)
  let previewPuzzles = null, curPuzzle = null;
  const offSolved = new Set(store('mp2026.solved') || []);
  async function openPuzzle(t) {
    if (ONLINE) { if (netOn) ws.send(JSON.stringify({ t: 'puzzle', terr: t.id })); return; }
    if (!OFF_ME) { toast('나라가 있어야 퍼즐 보상을 받을 수 있어요'); return; }
    if (!previewPuzzles) { try { previewPuzzles = (await (await fetch('puzzles.preview.json')).json()).puzzles; } catch (e) { previewPuzzles = []; } }
    const pool = previewPuzzles.filter((q) => !offSolved.has(q.id));
    if (!pool.length) { toast('지금 풀 수 있는 문제가 없어요 (문제가 곧 추가돼요)'); return; }
    const same = pool.filter((q) => q.type === t.type);
    const q = (same.length ? same : pool)[0];
    showPuzzle({ id: q.id, terr: t.id, type: q.type, question: q.question, image: q.image, mode: ownerOf(t.id) ? 'army' : 'claim' }, q);
  }
  function showPuzzle(p, local) {
    curPuzzle = Object.assign({}, p, { local });
    $('pzTitle').textContent = `🔮 ${p.type} 문제`;
    $('pzMode').textContent = p.mode === 'claim' ? `맞히면 ${terrLabel(p.terr)}을(를) 점령해요` : `맞히면 병력 +${MPRules.NUM.puzzleArmy}`;
    $('pzQ').textContent = p.question || '';
    const img = $('pzImg'); img.hidden = !p.image; if (p.image) { img.src = p.image; img.alt = p.question || '문제 그림'; }
    $('pzQ').hidden = !!p.image; // 그림이 있으면 글은 그림 설명(alt)으로만
    $('pzIn').value = ''; $('pzMsg').textContent = '한 번 낼 때마다 행동력 1을 써요.'; $('pzMsg').className = 'msg';
    $('puzzle').hidden = false; setTimeout(() => $('pzIn').focus(), 50);
  }
  function submitPuzzle() {
    if (!curPuzzle) return;
    const ans = $('pzIn').value.trim();
    if (!ans) { $('pzMsg').textContent = '답을 입력해 주세요'; return; }
    if (ONLINE) { ws.send(JSON.stringify({ t: 'answer', id: curPuzzle.id, answer: ans })); return; }
    if (!OFF.useAction(OFF_ME)) return puzzleResult(false, '오늘 행동력을 다 썼어요 (자정에 다시 10)');
    if (!MPRules.sameAnswer(ans, curPuzzle.local.answer)) { offSync(); return puzzleResult(false, '틀렸어요. 다시 도전하려면 행동력 1이 들어요'); }
    offSolved.add(curPuzzle.id); store('mp2026.solved', [...offSolved]);
    const r = OFF.puzzleReward(OFF_ME, curPuzzle.terr);
    offSync();
    puzzleResult(true, r.kind === 'claim' ? '정답! 영토를 점령했어요' : r.kind === 'army' ? `정답! 병력 +${r.army}` : '정답!');
  }
  function puzzleResult(ok, text) {
    $('pzMsg').textContent = text; $('pzMsg').className = 'msg ' + (ok ? 'good' : 'warn');
    if (ok) { curPuzzle = null; setTimeout(() => { $('puzzle').hidden = true; }, 1300); toast(text); }
  }
  $('pzSend').addEventListener('click', submitPuzzle);
  $('pzIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPuzzle(); });
  $('pzClose').addEventListener('click', () => { $('puzzle').hidden = true; curPuzzle = null; });

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
    stepPlayer(dt); tickHold();
    if (player.scene === 'sky' && player.room.id !== 'jail') {
      player.skyLeft -= dt;
      if (player.skyLeft <= 0) { descend(); toast('하늘에 머물 수 있는 5분이 끝나 땅으로 내려왔어요'); }
    }
    for (const b of bots) updateBot(b, dt);
    netTick(dt);
    if (player.scene === 'sky') drawSky(t); else drawGround(t);
    if (fadeT > 0) { fadeT -= dt; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = `rgba(255,255,255,${Math.max(0, fadeT / 0.35)})`; ctx.fillRect(0, 0, vw, vh); }

    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.15;
      const sky = player.scene === 'sky';
      $('skyTimer').hidden = !sky;
      if (sky && player.room.id === 'jail') { const l = Math.max(0, Math.ceil((jailUntil - Date.now()) / 1000)); $('skyTimer').firstChild.textContent = '감옥 '; $('skyLeft').textContent = `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; $('skyTimer').classList.remove('warn'); }
      else if (sky) { $('skyTimer').firstChild.textContent = '하늘 체류 '; const l = Math.max(0, Math.ceil(player.skyLeft)); $('skyLeft').textContent = `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; $('skyTimer').classList.toggle('warn', l <= 60); }
      updateWhere(); updatePrompt(); drawMini(); if (!$('bigmap').hidden) drawBig();
    }
    requestAnimationFrame(frame);
  }

  // 칸 단위 이동: 방향키를 한 번 누르면 한 칸, 누르고 있으면 계속. (좀 더 빠르게: 한 칸 0.11초)
  const STEP = 0.11;
  const step = { on: false, fx: 0, fy: 0, tx: 0, ty: 0, t: 0, dur: STEP };
  let lastDirKey = null, queuedDir = null;
  addEventListener('keydown', (e) => { if (e.target && e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase(); if (DIRS[k]) { lastDirKey = k; if (!e.repeat) queuedDir = DIRS[k]; } });
  const DIRS = { arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0], arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1] };
  function wantDir() {
    if (stick.on && Math.hypot(stick.vx, stick.vy) > 0.35) return Math.abs(stick.vx) > Math.abs(stick.vy) ? [Math.sign(stick.vx), 0] : [0, Math.sign(stick.vy)];
    if (queuedDir) { const d = queuedDir; queuedDir = null; return d; } // 아주 짧게 눌러도 한 칸
    if (lastDirKey && keys.has(lastDirKey)) return DIRS[lastDirKey];
    for (const k in DIRS) if (keys.has(k)) return DIRS[k];
    return null;
  }
  function stepPlayer(dt) {
    if (step.on) {
      step.t += dt;
      const k = Math.min(1, step.t / step.dur);
      player.x = step.fx + (step.tx - step.fx) * k; player.y = step.fy + (step.ty - step.fy) * k;
      if (k < 1) return;
      step.on = false;
      if (player.scene === 'sky') { checkDoor(); if (step.on) return; }
    }
    const d = wantDir();
    if (!d) { player.moving = false; return; }
    if (performance.now() < stunUntil) { player.moving = false; return; }
    if (hold.on) cancelHold();
    player.face = faceOf(d[0], d[1], player.face);
    if (d[0]) player.dir = d[0];
    // 지금 칸의 가운데로 맞춘 뒤 한 칸 옆으로
    const cx = Math.floor(player.x / TILE), cy = Math.floor(player.y / TILE);
    const nx = cx + d[0], ny = cy + d[1];
    const room = player.scene === 'sky' ? player.room : null;
    if (room ? roomBlocked(room, nx, ny) : blocked(nx, ny)) { player.x = cx * TILE + 16; player.y = cy * TILE + 16; player.moving = false; return; }
    step.on = true; step.t = 0;
    step.fx = player.x; step.fy = player.y; step.tx = nx * TILE + 16; step.ty = ny * TILE + 16;
    step.dur = (keys.has('shift') ? 0.04 : STEP) / (room ? 1 : speedAt(nx, ny)) * (player.carry ? 1.25 : 1); // 훔친 걸 들면 느려짐
    player.moving = true;
  }

  function drawActors(list, t) {
    list.sort((a, b) => a.y - b.y);
    ctx.imageSmoothingEnabled = true;
    for (const o of list) {
      if (o.draw) o.draw(ctx, o.x, o.y);
      else drawSprite(ctx, o.x, o.y, o.look, t, o.moving, o.face);
    }
    for (const o of list) {
      if (o.draw) continue;
      nameTag(ctx, o.x, o.y - 56, o === player ? player.name : o.name, o === player ? player.tag : o.tag);
      if (o.carry) { // 훔친 가방: 머리 옆에 큰 자루
        const b = Math.sin(performance.now() / 150) * 2, bx = o.x + 24, by = o.y - 40 + b;
        ctx.fillStyle = '#2b2340'; ctx.fillRect(bx - 12, by - 14, 24, 22); ctx.fillStyle = '#9a6a35'; ctx.fillRect(bx - 10, by - 12, 20, 18); ctx.fillStyle = '#c98c4a'; ctx.fillRect(bx - 10, by - 12, 20, 5);
        ctx.fillStyle = '#2b2340'; ctx.fillRect(bx - 6, by - 18, 12, 6); pix(ctx, 'coin', bx, by + 4, 0, 14);
      }
      if (o.emote) bubble(ctx, o.x, o.y - 80, o.emote);
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
    for (const b of others('sky', R)) list.push(b);
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
    const tx0 = Math.floor(x0 / TILE), tx1 = Math.ceil(x1 / TILE), ty0 = Math.floor(y0 / TILE), ty1 = Math.ceil(y1 / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const k = treeAt(tx, ty);
      if (k) list.push({ x: tx * TILE + 16, y: ty * TILE + 30, draw: (g, X, Y) => spr(g, k, X, Y) });
      else if (USER.animals.length && tileAt(tx, ty) === T.GRASS && !noTree[ty * W + tx]) {
        const ha = hash(tx, ty, 21);
        if (ha < 0.0025) { const a = USER.animals[(ha * 1e6 | 0) % 6]; list.push({ x: tx * TILE + 16, y: ty * TILE + 28, draw: (g, X, Y) => pix(g, 'u:' + a, X, Y - (Math.floor(performance.now() / 400 + tx) % 2), 2) }); }
      }
    }
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * W + tx, e = TILES[i];
      if (e && e.k === 'wall') list.push({ x: tx * TILE + 16, y: ty * TILE + 30, draw: (g, X, Y) => drawWall(g, X, Y, e.n) });
      if (MY_TRAPS.has(i)) list.push({ x: tx * TILE + 16, y: ty * TILE + 4, draw: (g, X, Y) => drawTrap(g, X, Y + 24) });
    }
    for (const [i, nid] of STORE_AT) { const X = (i % W) * TILE + 16, Y = Math.floor(i / W) * TILE + 30; if (X > x0 && X < x1 && Y > y0 && Y < y1) list.push({ x: X, y: Y, draw: (g, a, b) => drawStore(g, a, b, nid) }); }
    if (build.on && player.scene === 'ground') { // 설치 모드: 앞 칸 표시
      const [fx, fy] = facingTile(); ctx.fillStyle = 'rgba(255,211,77,0.35)'; ctx.fillRect(fx * TILE, fy * TILE, TILE, TILE); ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2; ctx.strokeRect(fx * TILE + 1, fy * TILE + 1, TILE - 2, TILE - 2);
    }
    for (const b of others('ground', null)) if (b.x > x0 && b.x < x1 && b.y > y0 && b.y < y1) list.push(b);
    list.push(player);
    drawActors(list, t);
    if (hold.on) { // 꾹 누르기 게이지
      const k = Math.min(1, (performance.now() - hold.t0) / hold.ms);
      ctx.fillStyle = '#2b2340'; ctx.fillRect(player.x - 26, player.y - 96, 52, 10); ctx.fillStyle = '#ffd34d'; ctx.fillRect(player.x - 24, player.y - 94, 48 * k, 6);
    }
    if (performance.now() < stunUntil) { ctx.font = `700 13px ${PFONT}`; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd34d'; ctx.fillText('✦ 꼼짝 못 함 ✦', player.x, player.y - 100); }
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

  Promise.all([loadWorld(), loadArt()]).then(([data]) => {
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
    if (ONLINE) startOnline(); else openFound('who');
    if (DAY === 5) setTimeout(() => toast('신들이 선포했다: 12월 28일, 이 세계는 끝난다.'), 600);
    else if (DOOM) { const n = terrs.filter((t) => t && gone[t.id]).length; if (n) setTimeout(() => toast(`균열이 영토 ${n}곳을 삼켰다`), 600); }
    requestAnimationFrame((n) => { last = n; frame(n); });
  }).catch((err) => {
    $('loadingText').textContent = '지도를 불러오지 못했어요';
    $('loadingSub').textContent = err.message;
  });
})();
