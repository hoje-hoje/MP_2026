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
  // 날짜: 온라인이면 서버의 게임 시계(setClock), 미리보기면 주소 끝 #day1~#day15
  let DAY = (() => { const m = /^#day(\d{1,2})$/.exec(location.hash); return Math.max(1, Math.min(15, m ? +m[1] : 1)); })();
  const WAVE_DAY = { 1: 6, 2: 8, 3: 10, 4: 12, 5: 14 };   // 균열 웨이브가 무너지는 날 (미리보기용)
  let SLOT = 'lunch', DOOM_DAY = 5, LAST_DAY = 15, RIFT_NEXT = null;
  let DOOM = DAY >= 5;                                     // 멸망 선포 뒤
  const phaseOf = (d) => d <= 2 ? '건국기' : d <= 4 ? '확장기' : d <= 14 ? '멸망기' : '최종 결전';
  let PHASE = phaseOf(DAY);
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

  const GCLEAR = new Set(); // 관리자가 '나무·산 없애기'로 비운 칸: 산은 풀밭이 되고 나무는 안 생김
  const tileAt = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return T.VOID; const i = y * W + x, t = terrain[i]; return t === T.MOUNTAIN && GCLEAR.has(i) ? T.GRASS : t; };
  const terrAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -1 : (terr[y * W + x] === 65535 ? -1 : terr[y * W + x]);
  function blocked(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return true;
    const t = tileAt(x, y), o = terr[y * W + x];
    if (o !== 65535 && o > 0 && gone[o]) return true;
    if (t === T.VOID || t === T.HOLY || t === T.WATER || t === T.MOUNTAIN || t === T.WALL || solid[y * W + x] === 1 || treeAt(x, y) !== null) return true;
    if (GWALL.has(y * W + x)) return true; // 관리자가 칠한 장벽
    if (GFLOOR.size && isWater(GFLOOR.get(y * W + x))) return true; // 관리자가 깐 물 타일
    { const pr = GPROPS.get(y * W + x); if (pr && pr.b) return true; } // 관리자가 놓은 막힘 소품
    const e = TILES[y * W + x]; if (e && ((e.k === 'wall' && e.n !== MY_NID) || e.k === 'water')) return true; // 남의 방벽 · 수로
    return STORE_AT.has(y * W + x);
  }
  // ---- 영지: 설치물(바닥·방벽), 우리 덫, 저장소 자리
  let TILES = {};                 // 칸 번호 -> { k: 'floor'|'wall', n: 나라 }
  let RIFT_SET = new Set();       // (예전) 다음 균열에 무너질 영토
  let EROSION = {}, erosionSig = ''; // 영역별 균열 침식 % (매일 아침 +10%, 수도 제외)
  function setErosion(e) { if (!e) return; const sig = JSON.stringify(e); if (sig === erosionSig) return; erosionSig = sig; EROSION = e; invalidateChunks(); mapSig = ''; }
  // 침식된 칸: 영역 침식 %만큼 칸이 보라색으로 오염 (칸마다 정해진 순서로 번짐)
  const corruptAt = (x, y, o) => { const e = EROSION[o] | 0; return e > 0 && hash(x, y, 77) * 100 < e; };
  let BATTLES = [];               // 선포된 전투 (모두에게 보임): { id, target, att, def, f: [[x,y]×3] }
  function applyMines(mines) { for (const n of nodes) { const o = mines && mines[n.id]; n.tx = o ? o[0] : n.dx; n.ty = o ? o[1] : n.dy; if (o) clearTrees(o[0], o[1], 1); } }
  let MY_TRAPS = new Set();       // 우리 나라 덫 (다른 나라엔 안 보임)
  let STORE_AT = new Map();       // 칸 번호 -> 나라 (수도 저장소)
  const FACE_D = [[0, 1], [0, -1], [-1, 0], [1, 0]];
  // 바닥 색 (돌 무늬에 색을 입힌 6가지)
  const FLOOR_COLORS = [['돌', null], ['나무', '#c98a4a'], ['벽돌', '#d4553f'], ['모래', '#f0d48a'], ['파랑', '#5b9cf0'], ['보라', '#b07ae6']];
  const floorCache = [];
  function floorArt(c) {
    if (floorCache[c]) return floorCache[c];
    const cv = document.createElement('canvas'); cv.width = cv.height = 32; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(ART.x_stonefloor, 0, 0, 32, 32);
    const col = (FLOOR_COLORS[c] || FLOOR_COLORS[0])[1];
    if (col) { g.globalCompositeOperation = 'color'; g.fillStyle = col; g.fillRect(0, 0, 32, 32); g.globalCompositeOperation = 'soft-light'; g.fillStyle = col; g.fillRect(0, 0, 32, 32); g.globalCompositeOperation = 'destination-in'; g.drawImage(ART.x_stonefloor, 0, 0, 32, 32); g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, 32, 32); }
    return (floorCache[c] = cv);
  }
  // 나무: 바닥에 굽지 않고 따로 그려서(깊이 정렬) 뒤로 지나갈 수 있게, 줄기 칸은 못 지나가게.
  let noTree = new Uint8Array(1);
  function treeAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H || noTree[y * W + x] || GCLEAR.has(y * W + x)) return null;
    const t = tileAt(x, y);
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
  function speedAt(x, y) { const e = TILES[y * W + x]; if (e && (e.k === 'floor' || e.under) && e.n === MY_NID) return MPRules.NUM.floorSpeed; const t = tileAt(x, y); return t === T.FOREST ? 0.7 : t === T.SAND ? 0.85 : 1; }

  const terrName = (t) => MPRules.terrName(t); // 영토 이름 (rules.js 와 같은 규칙)

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
    const NM = MPRules.nameAll(data.territories);
    for (const t of data.territories) { terrs[t.id] = t; t.name = NM[t.id]; if (!window.MP_ONLINE && t.rift && WAVE_DAY[t.rift] <= DAY) gone[t.id] = 1; }
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
      // 위치는 서버와 같은 규칙(MPRules.mineSpot), 옮긴 금광은 MINES 로 바뀜 → 그림은 drawGround 에서
      const ms = MPRules.mineSpot(t, tileAt, terrAt);
      if (ms) { clearTrees(ms[0], ms[1], 1); nodes.push({ id: t.id, t, tx: ms[0], ty: ms[1], dx: ms[0], dy: ms[1], get x() { return this.tx * TILE + 16; }, get y() { return this.ty * TILE + 24; } }); }
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
    if (gone[t.id]) return;
    const f = Math.floor(performance.now() / 260 + t.id) % 3;
    g.fillStyle = 'rgba(0,0,0,0.2)'; ell(g, x, y + 2, 22, 7);
    const prev = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    const fl = HITFX.get(t.id), hot = fl && performance.now() < fl; // 맞으면 0.12초 빨갛게 + 흔들림
    const sx = hot ? Math.round(Math.sin(performance.now() / 12) * 3) : 0;
    g.drawImage(altarSheet(t.type), f * 32, 0, 32, 32, x - 32 + sx, y - 60, 64, 64);
    const hn = HITN.get(t.id); // 내가 때린 횟수
    if (hn && performance.now() - hn.at < 60000 && hn.n < MPRules.NUM.scoutHits) { g.font = `700 16px ${PFONT}`; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = '#2b2340'; g.strokeText(`${hn.n}/${MPRules.NUM.scoutHits}`, x, y - 70); g.fillStyle = '#ffd34d'; g.fillText(`${hn.n}/${MPRules.NUM.scoutHits}`, x, y - 70); }
    if (hot) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,40,60,0.55)'; g.fillRect(x - 32 + sx, y - 60, 64, 64); g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(255,60,80,0.35)'; ell(g, x + sx, y - 34, 22, 26); }
    g.imageSmoothingEnabled = prev;
  }
  const HITFX = new Map(), HITN = new Map();
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
  const STORE_ART = ['store2', 'store3', 'store4']; // 저장소 모습: 기본 → 목재 500 이상 → 1000 이상 (ninja/village.png 에서 자른 창고)
  function drawStore(g, x, y, nid) { // 수도 저장소 (크기에 맞춰 장작·코인·팻말 위치)
    const key = STORE_ART[(nationsPub[nid] && nationsPub[nid].storeLv) | 0], im = ART['x_' + key], w = im ? im.width * 2 : 96, h = im ? im.height * 2 : 80;
    pix(g, key, x, y + 4, 2); pix(g, 'woodpile', x + w / 2 + 12, y + 4, 2); pix(g, 'coin', x - w / 2 - 8, y - 2, 0, 18);
    sign(g, x, y - h - 16, nid === MY_NID ? '우리 저장소' : `${natName(nid)} 저장소`);
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
    const names = { aether: 'aether/aether.png', k_winter: 'winter/winter.png', k_town: 'kenney/town.png', k_dungeon: 'kenney/dungeon.png', k_onebit: 'kenney/onebit.png', water: 'na/water.png', floor: 'ninja/floor.png', village: 'ninja/village.png', chars: 'na/chars.png', faces: 'na/faces.png', towers: 'na/towers.png', flags: 'na/flags.png' };
    const meta = fetch('assets/na/chars.json').then((r) => r.json()).then((j) => { CHARS.cols = j.cols; CHARS.names = j.names; });
    const users = fetch('assets/user/users.json').then((r) => r.json()).then((j) => {
      USER.chars = j.chars; USER.animals = j.animals; USER.monsters = j.monsters;
      if ((player.look.char | 0) < USER.chars.length) { player.look.char = USER.chars.length + 25; setTimeout(saveLook, 0); } // 싸움 모션 없는 동아리 캐릭터 → 기사로
      return Promise.all([...j.chars, ...j.animals, ...j.monsters].map(async (k) => { ART['u_' + k] = await loadImg('assets/user/' + k + '.png'); }));
    });
    for (const k of EXTRA) names['x_' + k] = 'extra/' + k + '.png';
    for (const k of TEMPLE) names['x_' + k] = 'na/' + k + '.png';
    const fonts = document.fonts ? Promise.all([document.fonts.load("11px Galmuri11"), document.fonts.load("700 22px Galmuri11")]).catch(() => {}) : Promise.resolve();
    await Promise.all([meta, users, fonts, ...Object.entries(names).map(async ([k, f]) => { ART[k] = await loadImg('assets/' + f); })]);
  }
  const EXTRA = ['door_gold', 'door_cloud', 'store1', 'store2', 'store3', 'store4', 'coin', 'cloud', 'burst', 'pin', 'tower', 'marble', 'stonefloor', 'carpet', 'grass', 'dirt', 'pillar', 'candelabra', 'rosewin', 'tomb', 'altar', 'book', 'candles', 'chalice', 'key', 'bishop', 'keeper', 'tent', 'cabin', 'campfire', 'woodpile', 'log', 'boulder', 'boulder_sm', 'flower_r', 'flower_y', 'mushroom', 'fern', 'stump', 'berry'];
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

  // 칸이 바뀌면 그 칸이 들어 있는 청크만 바로 다시 그린다 (깜빡임 없게)
  const staleChunks = new Map();
  function dirtyTile(i) {
    const x = i % W, y = Math.floor(i / W), keys = new Set();
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) keys.add(Math.floor((x + dx * 3) / CHUNK) + ',' + Math.floor((y + dy * 3) / CHUNK));
    for (const k of keys) if (chunks.has(k)) { const [ci, cj] = k.split(',').map(Number); chunks.set(k, renderChunk(ci, cj)); }
  }
  // 땅 주인이 바뀌었을 때: 새로 그리는 동안엔 이전 그림을 그대로 보여 준다
  function invalidateChunks() { for (const [k, c] of chunks) staleChunks.set(k, c); chunks.clear(); while (staleChunks.size > 80) staleChunks.delete(staleChunks.keys().next().value); }
  function getChunk(ci, cj) {
    const k = ci + ',' + cj;
    let c = chunks.get(k);
    if (c) { chunks.delete(k); chunks.set(k, c); return c; }
    if (chunkBudget <= 0) return staleChunks.get(k) || null;
    chunkBudget--;
    c = renderChunk(ci, cj);
    chunks.set(k, c); staleChunks.delete(k);
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
        if (og > 0 && (gone[og] || corruptAt(x, y, og))) { // 균열에 삼켜진(침식된) 칸: 보라색으로 오염된 바닥 + 빛나는 금 + 독웅덩이
          g.fillStyle = ['#2a1040', '#321450', '#26103c', '#2e1248'][(h * 4) | 0]; g.fillRect(px, py, TILE, TILE);
          for (let k = 0; k < 6; k++) { const hh = hash(x * 7 + k, y * 3, 51); g.fillStyle = hh > 0.5 ? '#3d1860' : '#1e0b30'; g.fillRect(px + ((hh * 16) | 0) * 2, py + ((hash(x, y * 5 + k, 52) * 16) | 0) * 2, 4, 2); }
          if (h < 0.22) { // 갈라진 금 (자홍색으로 빛남)
            let cx = px + 4 + ((h * 97) % 1) * 24 | 0, cy = py + 2; g.fillStyle = '#c040ff';
            for (let k = 0; k < 7; k++) { g.fillRect(cx, cy, 2, 4); cx += ((hash(x, y, 60 + k) * 3) | 0) * 2 - 2; cy += 4; }
            g.fillStyle = 'rgba(255,140,255,0.6)'; g.fillRect(px + 4 + ((h * 97) % 1) * 24 | 0, py + 2, 1, 4);
          } else if (h < 0.32) { g.fillStyle = '#16061f'; g.fillRect(px + 6, py + 12, 20, 10); g.fillRect(px + 9, py + 10, 14, 14); g.fillStyle = '#7a2bb8'; g.fillRect(px + 10, py + 13, 6, 2); } // 독웅덩이
          const alive = (a, b) => { const q = terrAt(a, b); return q >= 0 && !gone[q] && !corruptAt(a, b, q) && tileAt(a, b) !== T.VOID; };
          for (const [ax, ay, rx, ry, rw, rh] of [[x, y - 1, 0, 0, TILE, 6], [x, y + 1, 0, TILE - 6, TILE, 6], [x - 1, y, 0, 0, 6, TILE], [x + 1, y, TILE - 6, 0, 6, TILE]]) if (alive(ax, ay)) { g.fillStyle = '#9b3fd8'; g.fillRect(px + rx, py + ry, rw, rh); g.fillStyle = '#e48cff'; g.fillRect(px + rx + (rw === 6 && rx ? 4 : 0), py + ry + (rh === 6 && ry ? 4 : 0), rw === 6 ? 2 : rw, rh === 6 ? 2 : rh); }
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
        { const gf = GFLOOR.get(y * W + x); if (gf) drawSheetTile(g, gf, px, py, TILE, x * TILE, y * TILE); } // 관리자가 깐 타일
        { const e = TILES[y * W + x]; if (e && (e.k === 'floor' || e.under)) g.drawImage(floorArtId(e.k === 'floor' ? tileItem(e) : e.under), px, py, TILE, TILE); else if (e && e.k === 'farm') g.drawImage(farmArt(nearCanal(x, y)), px, py, TILE, TILE); else if (e && e.k === 'water') g.drawImage(canalArt(canalMask(x, y)), px, py, TILE, TILE); } // 벽·장식 밑의 바닥도 · 밭 · 수로
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
  // 직접 그린 바닥 무늬 (64×64, 2px 도트): 잔디·꽃밭·자갈길·나무 판자
  const GEN_FLOOR = {
    lawn: (g) => { g.fillStyle = '#9edb86'; g.fillRect(0, 0, 64, 64); for (let i = 0; i < 70; i++) { const x = (hash(i, 1, 41) * 32 | 0) * 2, y = (hash(i, 2, 41) * 32 | 0) * 2; g.fillStyle = hash(i, 3, 41) > 0.5 ? '#8fd078' : '#b2e69a'; g.fillRect(x, y, 2, hash(i, 4, 41) > 0.6 ? 4 : 2); } },
    meadow: (g) => { GEN_FLOOR.lawn(g); g.fillStyle = 'rgba(70,140,60,0.18)'; g.fillRect(0, 0, 64, 64); const cols = ['#ff8fb1', '#ffd84d', '#ffffff', '#b197fc', '#ff6b6b']; for (let i = 0; i < 16; i++) { const x = (hash(i, 5, 41) * 30 | 0) * 2, y = (hash(i, 6, 41) * 30 | 0) * 2; g.fillStyle = cols[i % cols.length]; g.fillRect(x + 2, y, 2, 2); g.fillRect(x, y + 2, 2, 2); g.fillRect(x + 4, y + 2, 2, 2); g.fillRect(x + 2, y + 4, 2, 2); g.fillStyle = '#ffe066'; g.fillRect(x + 2, y + 2, 2, 2); } },
    cobble: (g) => { g.fillStyle = '#e9e2d4'; g.fillRect(0, 0, 64, 64); for (let y = 0; y < 64; y += 16) for (let x = (y / 16 % 2) * 8; x < 72; x += 16) { g.fillStyle = hash(x, y, 43) > 0.5 ? '#f6f1e6' : '#ddd4c2'; g.fillRect(x - 6, y + 2, 12, 12); g.fillStyle = '#c9bea8'; g.fillRect(x - 6, y + 12, 12, 2); } },
    planks: (g) => { for (let y = 0; y < 64; y += 8) { g.fillStyle = (y / 8) % 2 ? '#c98f55' : '#d9a066'; g.fillRect(0, y, 64, 8); g.fillStyle = '#9a6a3a'; g.fillRect(0, y + 6, 64, 2); const off = (y * 13) % 48; g.fillRect(off, y, 2, 6); g.fillRect((off + 32) % 64, y, 2, 6); } },
  };
  // 구름 광장 꾸미기: 꽃밭 소품, 이벤트 무대(무지개), 유랑민 모집 게시판
  function gardenProps(x0, y0) {
    const kinds = ['flower_r', 'flower_y', 'fern', 'flower_r', 'mushroom', 'flower_y', 'berry', 'fern'];
    const out = [];
    for (let k = 0; k < 8; k++) out.push({ x: x0 + 1 + (k % 4) * 3, y: y0 + 1 + Math.floor(k / 4) * 4, w: 1, h: 1, walk: true, draw: (g, X, Y) => pix(g, kinds[k], X, Y + 2, 2) });
    out.push({ x: x0 + 6, y: y0 + 3, w: 1, h: 1, draw: (g, X, Y) => pix(g, 'plant', X, Y + 2, 2.5) });
    return out;
  }
  function plazaStage(g, x, y) {
    const cols = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa']; // 픽셀 무지개
    for (let b = 0; b < cols.length; b++) { const r = 210 - b * 10; g.fillStyle = cols[b]; for (let a = 0; a <= 64; a++) { const t = Math.PI + a / 64 * Math.PI, px = Math.round((x + Math.cos(t) * r) / 4) * 4, py = Math.round((y - 20 + Math.sin(t) * r * 0.55) / 4) * 4; g.fillRect(px, py, 8, 8); } }
    for (const dx of [-200, -120, 120, 200]) pix(g, dx < 0 ? 'banner3' : 'banner6', x + dx, y + 4, 2);
    sign(g, x, y - 40, '이벤트 무대');
  }
  function posterBoard(g, x, y) {
    g.fillStyle = '#5a4630'; g.fillRect(x - 56, y - 60, 6, 60); g.fillRect(x + 50, y - 60, 6, 60);
    g.fillStyle = '#8a6a44'; g.fillRect(x - 60, y - 96, 120, 50); g.fillStyle = '#6b5034'; g.fillRect(x - 60, y - 50, 120, 4);
    const papers = [['용병', '구함', '#fff6d6'], ['건국', '동료', '#ffe3e3'], ['귀화', '환영', '#e3f6ff']];
    papers.forEach(([a, b, c], i) => { const px = x - 52 + i * 38; g.fillStyle = c; g.fillRect(px, y - 90, 32, 38); g.fillStyle = '#c0392b'; g.fillRect(px + 14, y - 92, 4, 4); g.fillStyle = '#2b2340'; g.font = `700 11px ${PFONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(a, px + 16, y - 77); g.fillText(b, px + 16, y - 63); });
    sign(g, x, y - 112, '모집 게시판');
  }
  // 감옥 창살: 가로 줄(y=8)과 방 사이 세로 줄(x=5,10,15,20,25), 방 이름표
  const drawBars = (g, x, y) => { g.fillStyle = '#3b3b4a'; g.fillRect(x - 16, y - 30, 32, 4); for (let k = -12; k <= 12; k += 8) { g.fillStyle = '#6d6d82'; g.fillRect(x + k - 1, y - 30, 3, 34); g.fillStyle = '#a3a3b8'; g.fillRect(x + k - 1, y - 30, 1, 34); } };
  const JAIL_BARS = [];
  for (let x = 1; x <= 29; x++) JAIL_BARS.push({ x, y: 8, w: 1, h: 1, draw: x % 5 === 3 ? (g, X, Y) => { drawBars(g, X, Y); sign(g, X, Y - 40, `감옥 ${Math.floor(x / 5) + 1}`); } : drawBars });
  for (let k = 1; k <= 5; k++) for (let y = 9; y <= 14; y++) JAIL_BARS.push({ x: 5 * k, y, w: 1, h: 1, draw: drawBars });
  // ------------------------------------------------------------ 천상계 도트 (직접 그림: 기둥·화분·등불·깃발·천사·상점 정자·분수)
  function artCanvas(w, h, fn) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; fn(g, w, h); return c; }
  function pxRows(rows, pal) { return artCanvas(rows[0].length, rows.length, (g) => rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) { const c = pal[r[x]]; if (c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); } } })); }
  function blit(g, c, x, bottom, k = 2, flip = false) { const p = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; const w = c.width * k, h = c.height * k; if (flip) { g.save(); g.translate(Math.round(x), 0); g.scale(-1, 1); g.drawImage(c, Math.round(-w / 2), Math.round(bottom - h), w, h); g.restore(); } else g.drawImage(c, Math.round(x - w / 2), Math.round(bottom - h), w, h); g.imageSmoothingEnabled = p; }
  function pxDisc(g, cx, cy, r, wrap) { for (let y = -r; y <= r; y += 2) for (let x = -r; x <= r; x += 2) if (x * x + y * y <= r * r) { const X = cx + x, Y = cy + y; g.fillRect(X, Y, 2, 2); if (wrap) { g.fillRect(X - 64, Y, 2, 2); g.fillRect(X + 64, Y, 2, 2); g.fillRect(X, Y - 64, 2, 2); g.fillRect(X, Y + 64, 2, 2); } } }
  Object.assign(GEN_FLOOR, {
    marble_w: (g) => { // 흰 대리석 + 금 장식
      g.fillStyle = '#f4efe6'; g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 4; i++) { const x = (i % 2) * 32, y = (i >> 1) * 32; g.fillStyle = i === 0 || i === 3 ? '#faf7f1' : '#f1ebe1'; g.fillRect(x + 2, y + 2, 30, 30); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x + 2, y + 2, 30, 2); }
      g.fillStyle = '#e6dccb'; for (let k = 0; k < 12; k++) { const x = (hash(k, 1, 77) * 28 | 0) * 2 + 2, y = (hash(k, 2, 77) * 28 | 0) * 2 + 2; g.fillRect(x, y, 4, 2); g.fillRect(x + 4, y + 2, 2, 2); }
      g.fillStyle = '#ddd0b8'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 32, 64, 2); g.fillRect(0, 0, 2, 64); g.fillRect(32, 0, 2, 64);
      for (const [x, y] of [[0, 0], [64, 0], [0, 64], [64, 64], [32, 32]]) { g.fillStyle = '#e8c260'; g.fillRect(x - 4, y, 10, 2); g.fillRect(x, y - 4, 2, 10); g.fillStyle = '#fff3c4'; g.fillRect(x, y, 2, 2); }
    },
    aisle: (g) => { // 하늘색 융단 + 금별
      g.fillStyle = '#93b4f0'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#88aaea'; for (let y = 0; y < 64; y += 8) for (let x = (y / 8 % 2) * 8; x < 64; x += 16) g.fillRect(x, y, 8, 8);
      for (const [x, y] of [[14, 14], [46, 46]]) { g.fillStyle = '#ffd84d'; g.fillRect(x, y - 4, 2, 10); g.fillRect(x - 4, y, 10, 2); g.fillStyle = '#fff6c8'; g.fillRect(x, y, 2, 2); }
    },
    cloud: (g) => { // 폭신한 구름 바닥
      g.fillStyle = '#eaf2ff'; g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 12; i++) { const x = (hash(i, 1, 91) * 32 | 0) * 2, y = (hash(i, 2, 91) * 32 | 0) * 2, r = 6 + (hash(i, 3, 91) * 4 | 0) * 2; g.fillStyle = '#d9e5fa'; pxDisc(g, x, y + 2, r, true); g.fillStyle = '#ffffff'; pxDisc(g, x, y, r - 2, true); }
    },
    silver: (g) => { // 감옥: 차가운 은빛 돌
      g.fillStyle = '#9aa2bb'; g.fillRect(0, 0, 64, 64);
      for (let y = 0; y < 64; y += 16) for (let x = (y / 16 % 2) * 16; x < 80; x += 32) { g.fillStyle = hash(x, y, 5) > 0.5 ? '#a7afc6' : '#a2aac1'; g.fillRect(x - 14, y + 2, 28, 12); g.fillStyle = '#8890a8'; g.fillRect(x - 14, y + 14, 28, 2); }
    },
  });

  const ART_COL = artCanvas(12, 46, (g) => { // 흰 기둥 + 금 머리
    g.fillStyle = '#e8c260'; g.fillRect(0, 0, 12, 4); g.fillStyle = '#fff0b0'; g.fillRect(1, 0, 10, 1); g.fillStyle = '#b8862b'; g.fillRect(0, 4, 12, 1); g.fillStyle = '#e8c260'; g.fillRect(1, 5, 10, 2);
    for (let y = 7; y < 40; y++) { g.fillStyle = '#fffdf8'; g.fillRect(2, y, 8, 1); g.fillStyle = '#e9e3f2'; g.fillRect(4, y, 1, 1); g.fillRect(7, y, 1, 1); g.fillStyle = '#d4cce2'; g.fillRect(9, y, 1, 1); }
    g.fillStyle = '#e8c260'; g.fillRect(1, 40, 10, 2); g.fillStyle = '#f3eee6'; g.fillRect(0, 42, 12, 3); g.fillStyle = '#d6ccbb'; g.fillRect(0, 45, 12, 1);
  });
  const ART_URN = artCanvas(14, 20, (g) => { // 흰 화분 + 꽃
    g.fillStyle = '#5fbf6a'; for (const [x, y] of [[2, 6], [4, 4], [9, 4], [11, 6], [6, 3], [3, 8], [10, 8]]) g.fillRect(x, y, 2, 2);
    g.fillStyle = '#3f9a52'; for (const [x, y] of [[5, 6], [8, 6], [7, 5]]) g.fillRect(x, y, 2, 2);
    for (const [c, x, y] of [['#ff8fb1', 3, 2], ['#ffd84d', 7, 1], ['#9fd3ff', 10, 3], ['#ff8fb1', 5, 0], ['#ffffff', 9, 0], ['#c9a7ff', 1, 5]]) { g.fillStyle = c; g.fillRect(x, y, 2, 2); }
    g.fillStyle = '#e8c260'; g.fillRect(2, 9, 10, 1); g.fillStyle = '#fffdf8'; g.fillRect(3, 10, 8, 5); g.fillRect(4, 15, 6, 2); g.fillRect(3, 17, 8, 2);
    g.fillStyle = '#ddd5e8'; g.fillRect(9, 10, 2, 5); g.fillRect(8, 15, 2, 2); g.fillStyle = '#e8c260'; g.fillRect(3, 12, 8, 1); g.fillStyle = '#cfc6dc'; g.fillRect(3, 19, 8, 1);
  });
  const artBanner = (c1, c2) => artCanvas(12, 26, (g) => { // 금 막대 깃발 + 해 무늬
    g.fillStyle = '#b8862b'; g.fillRect(0, 0, 12, 2); g.fillStyle = '#e8c260'; g.fillRect(0, 0, 12, 1);
    g.fillStyle = c1; g.fillRect(1, 2, 10, 18); for (let i = 0; i < 5; i++) g.fillRect(1 + i, 20 + i, 10 - 2 * i, 1);
    g.fillStyle = c2; g.fillRect(1, 2, 1, 18); g.fillRect(10, 2, 1, 18);
    g.fillStyle = '#ffd84d'; g.fillRect(4, 8, 4, 4); g.fillRect(5, 6, 2, 8); g.fillRect(3, 9, 6, 2); g.fillStyle = '#fff3b0'; g.fillRect(5, 9, 2, 2); g.fillStyle = '#e8c260'; g.fillRect(1, 17, 10, 1);
  });
  const BANNERS = { blue: artBanner('#5b7fd6', '#3f5fb0'), white: artBanner('#fffaf0', '#e6dccb'), red: artBanner('#d6455b', '#a8303f'), green: artBanner('#3fa37a', '#2b7a58') };
  const WING = pxRows([
    '........OOO...', '......OOWWWO..', '....OOWWWWWWO.', '...OWWWWWWWWWO', '..OWWwWWWWWWWO', '.OWWwWWwWWWWO.',
    '.OWwWWwWWWWO..', 'OWwWWwWWWWO...', 'OWwWwWWWOO....', '.OwOwWOO......', '..O.OO........',
  ], { O: '#b3c1e2', W: '#ffffff', w: '#e1e9fa' });
  const HALO = pxRows(['.YYYYYY.', 'Y......Y', '.YYYYYY.'], { Y: '#ffd84d' });
  // 천사: 게임 캐릭터 + 날개 + 금빛 고리 (statue면 하얀 돌 조각상)
  function drawAngel(g, name, x, y, statue = false) {
    const t = performance.now() / 1000, bob = statue ? 0 : Math.round(Math.sin(t * 2 + x * 0.01) * 1.5) * 2, flap = !statue && Math.sin(t * 3 + x) > 0.55 ? 2 : 0;
    g.fillStyle = 'rgba(40,40,90,0.18)'; ell(g, x, y + 1, 18, 5);
    if (statue) g.filter = 'grayscale(1) contrast(0.55) brightness(1.9)';
    blit(g, WING, x - 12, y - 10 + bob - flap, 2); blit(g, WING, x + 12, y - 10 + bob - flap, 2, true);
    const k = Math.max(0, CHARS.names.indexOf(name));
    if (ART.chars) { const p = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.drawImage(ART.chars, (k % CHARS.cols) * 64, Math.floor(k / CHARS.cols) * 112, 16, 16, Math.round(x - 16), Math.round(y - 30 + bob), 32, 32); g.imageSmoothingEnabled = p; }
    g.filter = 'none';
    if (!statue) { g.fillStyle = 'rgba(255,230,120,0.25)'; ell(g, x, y - 36 + bob, 14, 5); blit(g, HALO, x, y - 32 + bob, 2); }
  }
  function holyAltar(g, x, y, wide = 40, top = 'book') { // 흰 대리석 제단 + 금 띠 + 하늘색 천 + 위에 책/성배
    const t = performance.now() / 1000;
    g.fillStyle = 'rgba(40,40,90,0.16)'; ell(g, x, y + 2, wide + 10, 8);
    g.fillStyle = '#2b2340'; g.fillRect(x - wide - 2, y - 38, wide * 2 + 4, 40);
    g.fillStyle = '#efe8dc'; g.fillRect(x - wide, y - 30, wide * 2, 30); g.fillStyle = '#fffdf8'; g.fillRect(x - wide, y - 36, wide * 2, 8);
    g.fillStyle = '#e8c260'; g.fillRect(x - wide, y - 28, wide * 2, 3); g.fillRect(x - wide, y - 4, wide * 2, 3);
    g.fillStyle = '#7fa6ec'; g.fillRect(x - 12, y - 36, 24, 30); g.fillStyle = '#e8c260'; for (let i = 0; i < 6; i++) g.fillRect(x - 12 + i * 4, y - 6, 2, 4);
    g.fillStyle = '#ffd84d'; g.fillRect(x - 3, y - 24, 6, 6); g.fillRect(x - 1, y - 28, 2, 14); g.fillRect(x - 6, y - 22, 12, 2);
    const grd = g.createRadialGradient(x, y - 46, 2, x, y - 46, 34); grd.addColorStop(0, `rgba(255,240,170,${0.45 + Math.sin(t * 2) * 0.1})`); grd.addColorStop(1, 'rgba(255,240,170,0)'); g.fillStyle = grd; g.fillRect(x - 34, y - 80, 68, 68);
    if (top === 'book') { g.fillStyle = '#b8862b'; g.fillRect(x - 16, y - 44, 32, 8); g.fillStyle = '#ffffff'; g.fillRect(x - 15, y - 48, 14, 8); g.fillRect(x + 1, y - 48, 14, 8); g.fillStyle = '#c9c0d8'; g.fillRect(x - 12, y - 46, 8, 2); g.fillRect(x + 4, y - 46, 8, 2); g.fillRect(x - 1, y - 48, 2, 10); }
    else { g.fillStyle = '#e8c260'; g.fillRect(x - 8, y - 56, 16, 10); g.fillRect(x - 2, y - 46, 4, 6); g.fillRect(x - 6, y - 40, 12, 4); g.fillStyle = '#fff0b0'; g.fillRect(x - 6, y - 56, 4, 6); g.fillStyle = '#d6455b'; g.fillRect(x - 6, y - 58, 12, 2); }
  }
  function plaque(g, x, y, text) { // 금테 이름판
    g.font = `700 13px ${PFONT}`; const w = Math.ceil(g.measureText(text).width) + 22, L = Math.round(x - w / 2), T = Math.round(y - 11);
    g.fillStyle = '#2b2340'; g.fillRect(L - 4, T - 4, w + 8, 30); g.fillStyle = '#b8862b'; g.fillRect(L - 2, T - 2, w + 4, 26); g.fillStyle = '#e8c260'; g.fillRect(L, T, w, 22);
    g.fillStyle = '#fffaf0'; g.fillRect(L + 3, T + 3, w - 6, 16); g.fillStyle = '#ffd84d'; g.fillRect(L - 8, T + 8, 4, 6); g.fillRect(L + w + 4, T + 8, 4, 6);
    g.fillStyle = '#5a3d10'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, Math.round(x), T + 12);
  }
  function lantern(g, x, y) { // 떠 있는 빛 수정 등불
    const t = performance.now() / 1000, b = Math.round(Math.sin(t * 2.2 + x) * 2) * 2, cy = y - 58 + b;
    g.fillStyle = 'rgba(40,40,90,0.16)'; ell(g, x, y + 1, 10, 3);
    g.fillStyle = '#b8862b'; g.fillRect(x - 6, y - 4, 12, 4); g.fillStyle = '#e8c260'; g.fillRect(x - 2, y - 40, 4, 36); g.fillRect(x - 8, y - 44, 16, 4); g.fillStyle = '#fff0b0'; g.fillRect(x - 2, y - 40, 2, 36);
    const grd = g.createRadialGradient(x, cy, 2, x, cy, 30); grd.addColorStop(0, 'rgba(200,240,255,0.55)'); grd.addColorStop(1, 'rgba(200,240,255,0)'); g.fillStyle = grd; g.fillRect(x - 30, cy - 30, 60, 60);
    g.fillStyle = '#7fc8ff'; g.fillRect(x - 6, cy - 4, 12, 8); g.fillRect(x - 4, cy - 10, 8, 20); g.fillRect(x - 2, cy - 14, 4, 28);
    g.fillStyle = '#d6f1ff'; g.fillRect(x - 4, cy - 6, 4, 8); g.fillStyle = '#ffffff'; g.fillRect(x - 2, cy - 10, 2, 4);
  }
  function urn(g, x, y) { g.fillStyle = 'rgba(40,40,90,0.14)'; ell(g, x, y + 1, 14, 4); blit(g, ART_URN, x, y + 2, 2); }
  function column(g, x, y) { g.fillStyle = 'rgba(40,40,90,0.14)'; ell(g, x, y + 1, 14, 4); blit(g, ART_COL, x, y + 4, 2); }
  function lightFountain(g, x, y) { // 2단 분수: 아래 큰 못 + 가운데 기둥 위 작은 그릇 + 물줄기가 아치로 떨어짐
    const t = performance.now() / 1000;
    g.fillStyle = 'rgba(40,40,90,0.15)'; ell(g, x, y + 2, 78, 20);
    // 아래 못
    g.fillStyle = '#cfc4b0'; ell(g, x, y - 4, 74, 22); g.fillStyle = '#fffdf8'; ell(g, x, y - 8, 72, 21); g.fillStyle = '#e8c260'; ell(g, x, y - 10, 66, 18); g.fillStyle = '#fffaf0'; ell(g, x, y - 11, 62, 16);
    g.fillStyle = '#6cc4ee'; ell(g, x, y - 11, 58, 14); g.fillStyle = '#9fdcff'; ell(g, x - 10, y - 14, 36, 7);
    for (let i = 0; i < 3; i++) { const k = (t * 0.6 + i / 3) % 1; g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y - 11, 14 + k * 40, 4 + k * 10, 0, 0, Math.PI * 2); g.stroke(); }
    // 기둥
    g.fillStyle = '#2b2340'; g.fillRect(x - 9, y - 46, 18, 36); g.fillStyle = '#fffdf8'; g.fillRect(x - 7, y - 44, 14, 34); g.fillStyle = '#e9e3f2'; g.fillRect(x + 3, y - 44, 4, 34); g.fillStyle = '#e8c260'; g.fillRect(x - 9, y - 28, 18, 3);
    // 위 그릇
    g.fillStyle = '#2b2340'; ell(g, x, y - 48, 26, 9); g.fillStyle = '#fffdf8'; ell(g, x, y - 50, 25, 8); g.fillStyle = '#e8c260'; ell(g, x, y - 51, 22, 6); g.fillStyle = '#7fd0f4'; ell(g, x, y - 52, 19, 5);
    // 물줄기: 꼭대기에서 솟아 네 방향 아치로 아래 못에 떨어짐
    const top = y - 72 + Math.sin(t * 6) * 2;
    g.fillStyle = '#bfe9ff'; g.fillRect(x - 2, top, 4, y - 52 - top); g.fillStyle = '#ffffff'; g.fillRect(x - 1, top, 2, y - 52 - top);
    for (const s2 of [-1, 1]) for (let k = 0; k < 14; k++) { const u = ((t * 1.4 + k / 14) % 1), px = x + s2 * (6 + u * 46), py = top + 4 - Math.sin(u * Math.PI) * 6 + u * u * 66; g.fillStyle = k % 3 ? '#a9e4ff' : '#ffffff'; g.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3); }
    for (let k = 0; k < 6; k++) { const a = t * 2 + k, px = x + Math.cos(a) * 18, py = y - 52 + Math.sin(a) * 4; g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(Math.round(px), Math.round(py), 2, 2); }
    if (Math.sin(t * 3) > 0.7) { g.fillStyle = '#fff6c8'; g.fillRect(x + 22, y - 30, 2, 6); g.fillRect(x + 20, y - 28, 6, 2); }
  }
  function cloudBench(g, x, y) { // 구름 의자
    g.fillStyle = 'rgba(40,40,90,0.14)'; ell(g, x, y + 1, 40, 6);
    g.fillStyle = '#dbe6fb'; for (const [dx, r] of [[-26, 12], [-8, 16], [10, 15], [28, 11]]) pxDisc(g, x + dx, y - 10, r);
    g.fillStyle = '#ffffff'; for (const [dx, r] of [[-26, 10], [-8, 14], [10, 13], [28, 9]]) pxDisc(g, x + dx, y - 14, r);
  }
  function pavilion(g, x, y, c1, label, keeper) { // 상점 정자: 줄무늬 차양 + 금 지붕 + 대리석 계산대 + 천사 상인
    g.fillStyle = 'rgba(40,40,90,0.16)'; ell(g, x, y + 2, 72, 10);
    blit(g, ART_COL, x - 56, y - 8, 2); blit(g, ART_COL, x + 56, y - 8, 2);
    if (keeper) drawAngel(g, keeper, x, y - 44);
    // 지붕
    g.fillStyle = '#b8862b'; g.fillRect(x - 70, y - 124, 140, 6);
    g.fillStyle = '#e8c260'; for (let i = 0; i < 9; i++) g.fillRect(x - 66 + i * 6, y - 130 - i * 3, 132 - i * 12, 6);
    g.fillStyle = '#fff0b0'; for (let i = 0; i < 9; i++) g.fillRect(x - 66 + i * 6, y - 130 - i * 3, 132 - i * 12, 2);
    g.fillStyle = '#ffd84d'; pxDisc(g, x, y - 162, 6); g.fillStyle = '#ffffff'; g.fillRect(x - 2, y - 166, 2, 2);
    // 줄무늬 차양 + 물결 끝
    for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#ffffff' : c1; g.fillRect(x - 72 + i * 16, y - 118, 16, 22); pxDisc(g, x - 64 + i * 16, y - 96, 8); g.fillRect(x - 72 + i * 16, y - 104, 16, 8); }
    g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x - 72, y - 100, 144, 4);
    // 계산대
    g.fillStyle = '#2b2340'; g.fillRect(x - 58, y - 36, 116, 30); g.fillStyle = '#fffdf8'; g.fillRect(x - 56, y - 34, 112, 26);
    g.fillStyle = '#e8c260'; g.fillRect(x - 58, y - 38, 116, 6); g.fillStyle = '#fff0b0'; g.fillRect(x - 58, y - 38, 116, 2);
    g.fillStyle = '#efe6d4'; for (let i = -2; i <= 2; i++) { g.fillRect(x + i * 22 - 4, y - 24, 8, 8); } g.fillStyle = '#e8c260'; for (let i = -2; i <= 2; i++) g.fillRect(x + i * 22 - 2, y - 22, 4, 4);
    g.fillStyle = '#e6dccb'; g.fillRect(x - 56, y - 10, 112, 2);
    plaque(g, x, y - 108, label);
  }
  // ------------------------------------------------------------ NPC 말 걸기 (대화창) · 천상 상점 · 영역전 규칙서
  const NPCS = {
    priest: { name: '신의 사제 루미엘', ch: 'Monk', color: '#6b4fb3', lines: ['어서 오세요, 하늘 신전에.', '신탁 제단에 신들의 말씀이 내려와요. 멸망이 선포되면 균열이 어디를 삼킬지 알려 주지요.', '땅으로 내려가려면 남쪽 구름 문으로 가세요. 올라온 수도로 돌아가요.'] },
    build: { name: '건축 천사 아라엘', ch: 'Woman', color: '#3d5fb8', shop: 'build', lines: ['어서 와요! 천상·숲·겨울·돌 테마로 바닥·벽·기둥·장식이 있어요.', '테마는 모양만 달라요. 효과는 종류마다 똑같아요!', '산 물건은 나라 저장소로 바로 가요. 설치 모드(G)로 우리 땅에 놓아요.', '벽과 기둥은 내구도가 100이에요. 적이 때리면 조금씩 닳아요.'] },
    vaccine: { name: '치유 천사 세라', ch: 'Princess', color: '#d64f86', shop: 'vaccine', lines: ['균열이 무서운가요? 백신 하나면 영토 하나를 지킬 수 있어요.', '많이 살수록 비싸져요. 꼭 필요한 만큼만!'] },
    seed: { name: '정원 천사 플로라', ch: 'Villager2', color: '#3fa37a', shop: 'seed', lines: ['어서 와요! 밭·수로·씨앗·비료가 있어요.', '우리 땅에 밭을 갈고(설치 모드 농사 탭) 그 위에 서서 씨앗을 심어요.', '수로 2칸 안은 20% 빨리 자라고, 비료를 주면 남은 시간이 절반!', '다 자라면 E로 수확해서 저한테 팔아요.'] },
    war: { name: '전쟁의 천사 미카', ch: 'KnightGold', color: '#c22f53', rules: true, lines: ['나는 전쟁의 규칙을 지키는 천사.', '3일차부터 영역전이 열린다. 그때 규칙서를 보여 주지.'] },
    clerk: { name: '등록 천사 노엘', ch: 'Villager', color: '#277a58', desk: true, lines: ['나라가 없나요? 여기서 귀화·용병·건국을 등록해요.'] },
    rest: { name: '쉼터지기 하루', ch: 'Monk2', color: '#4bb3c4', lines: ['조용히 쉬어 가요.', '여긴 나중에 쓰일지도 몰라요. 지금은 쉼터예요.'] },
  };
  const npcProp = (id, x, y) => ({ x, y, w: 1, h: 1, npc: id, draw: (g, X, Y) => { drawAngel(g, NPCS[id].ch, X, Y); nameTag(g, X, Y - 64, NPCS[id].name.split(' ').pop(), NPCS[id].color); } });
  const TALK = { npc: null, i: 0 };
  const faceCache = {};
  function cleanFace(k) { // 얼굴 그림의 검은 배경을 지우고 테두리 한 줄 (가장자리에서 같은 색만 지움)
    if (faceCache[k]) return faceCache[k];
    const c = artCanvas(40, 40, (g) => g.drawImage(ART.faces, (k % CHARS.cols) * 38, Math.floor(k / CHARS.cols) * 38, 38, 38, 1, 1, 38, 38));
    const g = c.getContext('2d'), im = g.getImageData(0, 0, 40, 40), d = im.data, bg = [d[(1 * 40 + 1) * 4], d[(1 * 40 + 1) * 4 + 1], d[(1 * 40 + 1) * 4 + 2]];
    const same = (i) => d[i * 4 + 3] === 0 || (Math.abs(d[i * 4] - bg[0]) < 8 && Math.abs(d[i * 4 + 1] - bg[1]) < 8 && Math.abs(d[i * 4 + 2] - bg[2]) < 8);
    const seen = new Uint8Array(1600), st = [];
    for (let i = 0; i < 40; i++) st.push(i, 1560 + i, i * 40, i * 40 + 39);
    while (st.length) { const i = st.pop(); if (seen[i] || !same(i)) continue; seen[i] = 1; d[i * 4 + 3] = 0; const x = i % 40, y = (i / 40) | 0; if (x > 0) st.push(i - 1); if (x < 39) st.push(i + 1); if (y > 0) st.push(i - 40); if (y < 39) st.push(i + 40); }
    const out = new Uint8ClampedArray(d);
    for (let i = 0; i < 1600; i++) if (!d[i * 4 + 3]) { const x = i % 40, y = (i / 40) | 0; if ((x > 0 && d[(i - 1) * 4 + 3]) || (x < 39 && d[(i + 1) * 4 + 3]) || (y > 0 && d[(i - 40) * 4 + 3]) || (y < 39 && d[(i + 40) * 4 + 3])) { out[i * 4] = 43; out[i * 4 + 1] = 35; out[i * 4 + 2] = 64; out[i * 4 + 3] = 255; } }
    g.putImageData(new ImageData(out, 40, 40), 0, 0);
    return (faceCache[k] = c);
  }
  function facePortrait(cv, npc) { // 큰 얼굴: 하늘 배경 + 날개 + 얼굴 + 고리
    const g = cv.getContext('2d'), W2 = cv.width, H2 = cv.height; g.imageSmoothingEnabled = false;
    const grd = g.createLinearGradient(0, 0, 0, H2); grd.addColorStop(0, '#bfe6ff'); grd.addColorStop(1, '#fff6e0'); g.fillStyle = grd; g.fillRect(0, 0, W2, H2);
    g.fillStyle = '#ffffff'; for (const [x, y, r] of [[18, 96, 16], [40, 104, 14], [100, 98, 18], [80, 108, 12]]) pxDisc(g, x * W2 / 120, y * H2 / 120, r);
    g.drawImage(WING, 0, 0, 14, 11, 2, 34, 42, 33); g.save(); g.translate(W2, 0); g.scale(-1, 1); g.drawImage(WING, 0, 0, 14, 11, 2, 34, 42, 33); g.restore();
    const k = Math.max(0, CHARS.names.indexOf(npc.ch));
    if (ART.faces) g.drawImage(cleanFace(k), 0, 0, 40, 40, 20, 24, 80, 80);
    else if (ART.chars) g.drawImage(ART.chars, (k % CHARS.cols) * 64, Math.floor(k / CHARS.cols) * 112, 16, 16, 28, 34, 64, 64);
    g.drawImage(HALO, 0, 0, 8, 3, 36, 8, 48, 18);
  }
  function openTalk(id) {
    const npc = NPCS[id]; TALK.npc = id; TALK.i = 0;
    $('talkName').textContent = npc.name; $('talkName').style.background = npc.color;
    facePortrait($('talkFace'), npc); showTalkLine(); $('talk').hidden = false; SND.play('ok');
  }
  function showTalkLine() { // 스페이스(또는 E·클릭)로 다음 줄, 마지막 줄에서 누르면 대화 끝 (다시 말 걸면 처음부터)
    const npc = NPCS[TALK.npc], lines = npc.rules && DAY >= 3 ? ['영역전이 열렸다. 규칙을 모르고 싸우면 진다.', '아래 버튼으로 규칙서를 읽어 보아라.'] : npc.lines;
    TALK.lines = lines; const text = lines[Math.min(TALK.i, lines.length - 1)], last = TALK.i >= lines.length - 1;
    $('talkText').textContent = text;
    $('talkMore').textContent = last ? '■ Space 닫기' : `▼ Space (${TALK.i + 1}/${lines.length})`;
    const btn = [];
    if (npc.shop) btn.push(['물건 보기', () => { const id = TALK.npc; closeTalk(); openShop(npc.shop, id); }]);
    if (npc.rules && DAY >= 3) btn.push(['📜 영역전 규칙서', () => { closeTalk(); $('rulebook').hidden = false; }]);
    if (npc.desk) btn.push(['등록 창구', () => { closeTalk(); $('wanderMsg').textContent = '나라가 없다면 여기서 등록하세요.'; renderWander(); $('wanderBox').hidden = false; }]);
    btn.push(['잘 있어요', closeTalk]);
    const box = $('talkBtns'); box.innerHTML = ''; btn.forEach(([label, fn], k) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (k === 0 && btn.length > 1) b.className = 'main'; b.onclick = (e) => { e.stopPropagation(); fn(); }; box.appendChild(b); });
  }
  function talkNext() { if (!TALK.npc) return; if (TALK.i >= TALK.lines.length - 1) closeTalk(); else { TALK.i++; showTalkLine(); SND.play('ok'); } }
  function closeTalk() { $('talk').hidden = true; TALK.npc = null; }
  $('talk').addEventListener('click', talkNext);
  // 상점 물건 그림 (16×16 도트)
  const ICON = {
    floor: pxRows(['................', '.CCCCCCCCCCCCCC.', '.CccCccCccCccCC.', '.CcCCcCCcCCcCcC.', '.CCCCCCCCCCCCCC.', '.CccCccCccCccCC.', '.CcCCcCCcCCcCcC.', '.CCCCCCCCCCCCCC.', '.CccCccCccCccCC.', '.CcCCcCCcCCcCcC.', '.CCCCCCCCCCCCCC.', '.CccCccCccCccCC.', '.CcCCcCCcCCcCcC.', '.CCCCCCCCCCCCCC.', '.dddddddddddddd.', '................'], { C: '#e8c260', c: '#fff0b0', d: '#b8862b' }),
    wall: pxRows(['................', '.KKKKKKKKKKKKKK.', '.RRRrKRRRrKRRRK.', '.RrrrKRrrrKRrrK.', '.KKKKKKKKKKKKKK.', '.RrKRRRrKRRRrKR.', '.rrKRrrrKRrrrKr.', '.KKKKKKKKKKKKKK.', '.RRRrKRRRrKRRRK.', '.RrrrKRrrrKRrrK.', '.KKKKKKKKKKKKKK.', '.RrKRRRrKRRRrKR.', '.rrKRrrrKRrrrKr.', '.KKKKKKKKKKKKKK.', '.dddddddddddddd.', '................'], { K: '#5a4a6e', R: '#d9826a', r: '#b9604c', d: '#3b2f4a' }),
    trap: pxRows(['................', '................', '..S..S..S..S....', '..SS.SS.SS.SS...', '..S.S.S.S.S.S...', '.MMMMMMMMMMMMM..', '.MmmmmmmmmmmmM..', '.MmmmmBBBmmmmM..', '.MmmmmBbBmmmmM..', '.MmmmmBBBmmmmM..', '.MmmmmmmmmmmmM..', '.MMMMMMMMMMMMM..', '..S.S.S.S.S.S...', '..SS.SS.SS.SS...', '..S..S..S..S....', '................'], { S: '#c8ced8', M: '#5a5a6e', m: '#8a8aa0', B: '#e8423c', b: '#ffb0a8' }),
    vaccine: pxRows(['......WWWW......', '......WggW......', '.......gg.......', '......GGGG......', '.....GwwwwG.....', '....GwwPPwwG....', '....GwPPPPwG....', '....GwwPPwwG....', '....GPPPPPPG....', '....GPPPPPPG....', '....GPPPPPPG....', '....GPPPPPPG....', '....GPPPPPPG....', '.....GPPPPG.....', '......GGGG......', '................'], { W: '#e8c260', g: '#b8862b', G: '#5a4a6e', w: '#ffffff', P: '#ff8fb1' }),
    seed: pxRows(['................', '.....TTTTTT.....', '......TttT......', '.....BBBBBB.....', '....BbbbbbbB....', '...BbbbbbbbbB...', '...BbbSbbSbbB...', '..BbbbbSSbbbbB..', '..BbbbSSSSbbbB..', '..BbbbbSSbbbbB..', '..BbbbbbbbbbbB..', '..BbbbbbbbbbbB..', '...BbbbbbbbbB...', '....BBBBBBBB....', '................', '................'], { T: '#5a3416', t: '#8a5a2b', B: '#8a5a2b', b: '#d9a066', S: '#5fbf6a' }),
  };
  let SHOP_KIND = 'build', SHOP_TAB = 'all', SHOP_NPC = 'build'; // 상점마다 자기 물건만 (건축 상점 안의 탭은 종류: 전체·바닥·방벽·덫, 나중에 테마)
  function openShop(tab = 'build', npcId) {
    const me = myView && myView.me;
    if (!me) { toast('나라가 있어야 살 수 있어요 (나라 공용 저장소에서 내요)'); return; }
    SHOP_KIND = tab; SHOP_TAB = 'all'; SHOP_NPC = npcId || tab;
    const npc = NPCS[SHOP_NPC]; $('shopWho').textContent = npc.name; facePortrait($('shopFace'), npc);
    $('shopSay').textContent = npc.lines[0];
    renderShop(); $('shopBox').hidden = false;
  }
  function renderShop() {
    const me = myView && myView.me; if (!me) return;
    const P = MPRules.NUM.price;
    const tabs = SHOP_KIND === 'build' ? [['heaven', '☁ 천상'], ['forest', '🌲 숲'], ['winter', '❄ 겨울'], ['stone', '🪨 돌'], ['trap', '🪤 덫']] : SHOP_KIND === 'seed' ? [['buy', '🌱 씨앗·밭'], ['sell', '🧺 작물 팔기']] : [];
    if (SHOP_KIND === 'seed' && SHOP_TAB !== 'sell') SHOP_TAB = 'buy';
    if (SHOP_KIND === 'build' && !tabs.some(([k]) => k === SHOP_TAB)) SHOP_TAB = 'heaven';
    $('shopTabs').hidden = !tabs.length;
    $('shopTabs').innerHTML = tabs.map(([k, l]) => `<button type="button" data-tab="${k}" aria-pressed="${k === SHOP_TAB}">${l}</button>`).join('');
    for (const b of $('shopTabs').querySelectorAll('[data-tab]')) b.onclick = () => { SHOP_TAB = b.dataset.tab; renderShop(); };
    $('shopCoin').innerHTML = `<span class="coinIco"></span> 우리 저장소 <b>${me.coin.toLocaleString()}</b> 코인 <small>· 산 물건은 나라 저장소로 가요</small>`;
    const card = (k, name, desc, price, counts, have) => `<div class="hvCard"><canvas data-ico="${k}" width="64" height="64"></canvas><div class="hvInfo"><b>${name}</b><small>${desc}</small>${have != null ? `<i>가진 것 ${have}개</i>` : ''}</div><div class="hvBuy"><span class="price"><span class="coinIco"></span>${price.toLocaleString()}${counts ? '<small>/개</small>' : ''}</span><div>${(counts || [1]).map((c) => `<button type="button" data-buy="${k}" data-n="${c}" ${me.coin < price * c ? 'disabled' : ''}>${counts ? c + '개' : '사기'}</button>`).join('')}</div></div></div>`;
    let html = '';
    const want = (k) => SHOP_TAB === 'all' || SHOP_TAB === k;
    const CAT_DESC = { floor: '우리 국민이 1.5배 빨라져요', wall: `다른 나라 사람을 막아요 · 내구도 ${MPRules.NUM.buildHp}`, deco: '꾸미기 · 밟고 지나갈 수 있어요', trap: '밟은 적이 3초 동안 못 움직여요 · 적에겐 안 보임' };
    const CNT = { floor: [1, 5, 20], wall: [1, 5, 10], deco: [1, 5], trap: [1, 3] };
    if (SHOP_KIND === 'build') html = MPRules.BUILD.filter((b) => !FARM_CATS.has(b.cat) && b.cat !== 'crop' && (SHOP_TAB === 'trap' ? b.cat === 'trap' : b.theme === SHOP_TAB && b.cat !== 'trap')).map((b) => card(b.id, b.name, CAT_DESC[b.cat], P[b.cat], CNT[b.cat], me.items[b.id] || 0)).join('');
    else if (false) html = (want('floor') ? card('floor', '황금 바닥', '우리 국민이 1.5배 빨라져요', P.floor, [1, 5, 20], me.items.floor) : '') + (want('wall') ? card('wall', '방벽', '다른 나라 사람을 막아요 (5초 맞으면 부서짐)', P.wall, [1, 5, 10], me.items.wall) : '') + (want('trap') ? card('trap', '덫', '밟은 적이 3초 동안 못 움직여요 · 적에겐 안 보임', P.trap, [1, 3], me.items.trap) : '');
    else if (SHOP_KIND === 'vaccine') html = card('vaccine', '백신', '균열에서 영토 하나를 지켜요 · 살수록 비싸져요', me.vaccinePrice, null, me.vaccine);
    else if (SHOP_TAB === 'buy') html = [['farm', '밭 1칸 · 설치 모드 농사 탭에서 발밑에 갈아요', [1, 5, 20]], ['canal', '수로 1칸 · 2칸 안의 작물이 20% 빨리 자라요 (사람은 못 지나감)', [1, 5]], ['fert', '심은 작물에 주면 남은 시간이 절반!', [1, 5]]].map(([id, d, c]) => card(id, BUILD_BY[id].name, d, BUILD_BY[id].price, c, me.items[id] || 0)).join('')
      + Object.entries(CROPS).map(([k, c]) => card('s_' + k, c.name + ' 씨앗', `${fmtLeft(c.min * 60e3)} · ${c.yield}개 수확 · 1개 ${c.sell}코인에 팔림`, c.seed, [1, 5, 9], me.items['s_' + k] || 0)).join('');
    else { const owned = Object.keys(CROPS).filter((k) => me.items['p_' + k] > 0); html = owned.length ? owned.map((k) => { const n2 = me.items['p_' + k]; return `<div class="hvCard"><canvas data-ico="p_${k}" width="64" height="64"></canvas><div class="hvInfo"><b>${CROPS[k].name}</b><small>1개 ${CROPS[k].sell}코인</small><i>가진 것 ${n2}개</i></div><div class="hvBuy"><span class="price"><span class="coinIco"></span>${(CROPS[k].sell * n2).toLocaleString()}<small> 전부</small></span><div><button type="button" data-sell="p_${k}" data-n="1">1개</button><button type="button" data-sell="p_${k}" data-n="${n2}">전부</button></div></div></div>`; }).join('') : '<div class="hvSoon"><p><b>팔 작물이 없어요</b><br>우리 땅에 밭을 갈고 씨앗을 심어 보세요. 다 자라면 E로 수확!</p></div>'; }
    $('shopBody').innerHTML = html;
    for (const c of $('shopBody').querySelectorAll('[data-ico]')) { if (BUILD_BY[c.dataset.ico]) { itemIcon(c, c.dataset.ico); continue; } const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(ICON[c.dataset.ico], 0, 0, 64, 64); }
    for (const b of $('shopBody').querySelectorAll('[data-sell]')) b.onclick = () => { ws.send(JSON.stringify({ t: 'sell', item: b.dataset.sell, n: +b.dataset.n })); $('shopSay').textContent = '싱싱하네요! 코인은 나라 저장소로 보냈어요.'; SND.play('coin'); setTimeout(() => { if (!$('shopBox').hidden) renderShop(); }, 500); };
    for (const b of $('shopBody').querySelectorAll('[data-buy]')) b.onclick = () => { ws.send(JSON.stringify({ t: 'buy', item: b.dataset.buy, n: +b.dataset.n })); $('shopSay').textContent = ['고마워요! 저장소로 보냈어요.', '좋은 선택이에요!', '또 와요~'][(Math.random() * 3) | 0]; SND.play('coin'); setTimeout(() => { if (!$('shopBox').hidden) renderShop(); }, 500); };
  }
  // 영역전 규칙서 (전쟁의 천사에게서, 3일차부터)
  const RULEBOOK = [
    ['기본', ['전선 수 = 공격받는 나라의 영역 수 k로 2k+1개', '모든 전선에 (보낼 병력 ÷ 전선 수)의 20% 이상 배치', '한 전투 시간에 한 나라를 선전포고할 수 있는 나라는 최대 2나라', '전투 30분 전까지 한 선전포고만 그 전투에 들어가요', '한 나라는 한 전투 시간에 최대 2번 선전포고', '전투는 매일 13시와 22시']],
    ['⚔ 공격팀', ['왕만 경계선이 붙은 영역에 선전포고 (양쪽에 알림)', '보낼 병력을 고르고 모든 전선에 배치', '선전포고 뒤 팀원 누구나 전선 근처(E)에서 충원·빼기 (선전포고 때 병력은 못 뺌)', '충원은 선전포고 병력의 10%까지']],
    ['🛡 방어팀', ['전선 수는 방어팀 영역 수로 정해져요', '왕만 막을 병력과 배치를 전투 전까지 몇 번이든 바꿀 수 있어요', '배치 안 하면 기본 방어 비율로 자동 배치', '방어 병력은 1.1배로 계산', '여러 나라가 공격하면 전투마다 따로 배치']],
    ['📊 판정', ['전선마다 병력 비교 (방어 ×1.1)', '전선 절반 넘게 이긴 팀이 승리', '같으면 방어 승']],
    ['🏆 결과', ['공격 승: 잃는 영역 = ⌈방어 영역 수 × (공격 이긴 전선 − 방어 이긴 전선) ÷ 전선 수⌉', '넘어가는 순서: 선전포고한 영역 → 공격팀 땅에서 가까운 곳 → 같으면 수도가 아닌 곳', '재료: 잃은 비율만큼의 10%를 공격팀이 가져가요', '모든 영역을 잃으면 멸망 → 유랑민', '방어 승: 영역·재료 그대로, 공격팀이 잃은 병력의 10%를 포로로']],
    ['💀 병력 손실 (란체스터 제곱 법칙)', ['이긴 쪽 남는 병력 = √(이긴 쪽² − 진 쪽²)', '진 쪽은 20%만 살아 돌아와요']],
    ['🤝 동맹', ['왕끼리 합의, 최대 3나라', '동맹끼리 선전포고 불가', '동맹이 싸우면 참전 가능: 병력을 정해 직접 배치 (한 번만, 못 뺌)', '살아남은 참전 병력은 도와준 나라 병력']],
    ['🏛 천도', ['왕이 1000코인으로 우리 영역 아무 곳으로 수도 이동', '선전포고 받은 동안은 불가 · 하면 하루 동안 다시 못 함', '수도를 빼앗기면 공격팀에게서 가장 먼 곳으로 강제 천도']],
  ];
  function renderRulebook() {
    $('ruleBody').innerHTML = RULEBOOK.map(([h, items]) => `<section><h3>${h}</h3><ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul></section>`).join('');
  }
  // ------------------------------------------------------------ 건축물 그림 (테마별 바닥·벽·기둥·장식, 직접 그림)
  const BUILD_BY = MPRules.BUILD_BY, tileItem = MPRules.tileItem, BHP = MPRules.NUM.buildHp;
  const floorIdCache = {};
  function floorArtId(id) {
    if (floorIdCache[id]) return floorIdCache[id];
    const legacy = { f_stone: 0, f_brick: 2, f_sand: 3, f_amethyst: 5 };
    if (id in legacy) return (floorIdCache[id] = floorArt(legacy[id]));
    const c = artCanvas(32, 32, (g) => {
      const gen = { f_gold: 'marble_w', f_cloud: 'cloud', f_sky: 'aisle', f_wood: 'planks' }[id];
      if (gen) { const big = artCanvas(64, 64, (q) => GEN_FLOOR[gen](q)); g.drawImage(big, 0, 0, 32, 32, 0, 0, 32, 32); if (id === 'f_gold') { g.fillStyle = '#e8c260'; g.fillRect(0, 0, 32, 2); g.fillRect(0, 0, 2, 32); } return; }
      if (id === 'f_moss') { const big = artCanvas(64, 64, (q) => GEN_FLOOR.cobble(q)); g.drawImage(big, 0, 0, 32, 32, 0, 0, 32, 32); g.fillStyle = 'rgba(80,160,70,0.45)'; for (const [x, y, w, h] of [[0, 12, 6, 4], [14, 0, 4, 6], [20, 26, 8, 4], [28, 8, 4, 8], [8, 24, 4, 2]]) g.fillRect(x, y, w, h); g.fillStyle = '#6fbf5f'; for (const [x, y] of [[2, 14], [16, 2], [24, 28], [30, 10]]) g.fillRect(x, y, 2, 2); }
      if (id === 'f_ice') { g.fillStyle = '#bfe6ff'; g.fillRect(0, 0, 32, 32); g.fillStyle = '#d9f1ff'; g.fillRect(2, 2, 13, 13); g.fillRect(17, 17, 13, 13); g.fillStyle = '#a6d8f5'; g.fillRect(0, 15, 32, 2); g.fillRect(15, 0, 2, 32); g.fillStyle = '#ffffff'; g.fillRect(4, 4, 6, 2); g.fillRect(4, 6, 2, 2); g.fillRect(19, 19, 6, 2); g.fillStyle = '#8fc8ec'; g.fillRect(22, 6, 6, 2); g.fillRect(26, 8, 2, 4); g.fillRect(6, 22, 2, 6); }
      if (id === 'f_snow') { g.fillStyle = '#c9d6ea'; g.fillRect(0, 0, 32, 32); for (let y = 0; y < 32; y += 8) for (let x = (y / 8 % 2) * 8 - 8; x < 32; x += 16) { g.fillStyle = '#f6f9ff'; g.fillRect(x + 1, y + 1, 14, 6); g.fillStyle = '#ffffff'; g.fillRect(x + 1, y + 1, 14, 2); } }
    });
    return (floorIdCache[id] = c);
  }
  function natRibbon(g, x, y, nid) { g.fillStyle = natColor(nid); g.fillRect(x - 6, y, 12, 6); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(x - 6, y, 12, 2); g.fillStyle = '#2b2340'; g.fillRect(x - 7, y - 1, 1, 8); g.fillRect(x + 6, y - 1, 1, 8); }
  function wallBlock(g, x, y, top, body, line, hi) { // 32×40 덩어리 벽
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x - 17, y - 4, 34, 6);
    g.fillStyle = '#2b2340'; g.fillRect(x - 17, y - 48, 34, 46);
    g.fillStyle = body; g.fillRect(x - 15, y - 40, 30, 36); g.fillStyle = top; g.fillRect(x - 15, y - 46, 30, 8);
    g.fillStyle = line; g.fillRect(x - 15, y - 26, 30, 2); g.fillRect(x - 1, y - 38, 2, 12); g.fillRect(x - 9, y - 24, 2, 18); g.fillRect(x + 7, y - 24, 2, 18);
    g.fillStyle = hi; g.fillRect(x - 15, y - 46, 30, 2); g.fillRect(x - 15, y - 40, 2, 34);
  }
  function drawBuild(g, x, y, e) { // e = 칸 정보 {k, n, id, hp}
    const id = tileItem(e), t = performance.now() / 1000;
    switch (id) {
      case 'w_brick': drawWall(g, x, y, e.n); return;
      case 'w_marble': wallBlock(g, x, y, '#e8c260', '#fbf8f1', '#e3d9c6', '#ffffff'); natRibbon(g, x, y - 34, e.n); return;
      case 'w_ice': g.globalAlpha = 0.92; wallBlock(g, x, y, '#e6f6ff', '#a9dcf7', '#8cc6ea', '#ffffff'); g.globalAlpha = 1; g.fillStyle = '#ffffff'; g.fillRect(x - 10, y - 34, 4, 10); natRibbon(g, x, y - 34, e.n); return;
      case 'w_fence': {
        g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x - 17, y - 4, 34, 5);
        for (const px of [x - 14, x + 8]) { g.fillStyle = '#2b2340'; g.fillRect(px - 1, y - 40, 8, 38); g.fillStyle = '#b07a44'; g.fillRect(px, y - 38, 6, 36); g.fillStyle = '#d39a5c'; g.fillRect(px, y - 38, 2, 36); g.fillStyle = '#2b2340'; g.fillRect(px, y - 42, 6, 2); g.fillRect(px + 2, y - 44, 2, 2); }
        for (const ry of [y - 32, y - 18]) { g.fillStyle = '#2b2340'; g.fillRect(x - 17, ry - 1, 34, 8); g.fillStyle = '#c58a50'; g.fillRect(x - 16, ry, 32, 6); g.fillStyle = '#e0aa6a'; g.fillRect(x - 16, ry, 32, 2); }
        natRibbon(g, x, y - 30, e.n); return;
      }
      case 'p_marble': { g.fillStyle = 'rgba(0,0,0,0.2)'; ell(g, x, y, 14, 4); blit(g, ART_COL, x, y + 2, 1.5); natRibbon(g, x, y - 40, e.n); return; }
      case 'p_stone': case 'p_ice': case 'p_wood': {
        const P = { p_stone: ['#8c8a96', '#b3b0bc', '#6e6c78', '#cfccd6'], p_ice: ['#9fd3f2', '#d9f1ff', '#7fbfe6', '#ffffff'], p_wood: ['#9a6a3a', '#c98f55', '#7a4f28', '#e0aa6a'] }[id];
        g.fillStyle = 'rgba(0,0,0,0.2)'; ell(g, x, y, 14, 4);
        g.fillStyle = '#2b2340'; g.fillRect(x - 11, y - 66, 22, 66);
        g.fillStyle = P[0]; g.fillRect(x - 9, y - 58, 18, 52); g.fillStyle = P[1]; g.fillRect(x - 9, y - 58, 5, 52); g.fillStyle = P[2]; g.fillRect(x + 5, y - 58, 4, 52);
        g.fillStyle = P[3]; g.fillRect(x - 11, y - 66, 22, 8); g.fillRect(x - 11, y - 8, 22, 8); g.fillStyle = P[2]; g.fillRect(x - 11, y - 60, 22, 2); g.fillRect(x - 11, y - 8, 22, 2);
        if (id === 'p_wood') { g.fillStyle = '#7a4f28'; g.fillRect(x - 4, y - 64, 8, 4); g.fillStyle = '#e0aa6a'; g.fillRect(x - 2, y - 63, 4, 2); for (const yy of [y - 46, y - 30, y - 18]) { g.fillStyle = P[2]; g.fillRect(x - 7, yy, 6, 2); } }
        if (id === 'p_ice') { g.fillStyle = '#ffffff'; g.fillRect(x - 6, y - 52, 2, 18); g.fillRect(x - 6, y - 30, 2, 6); }
        natRibbon(g, x, y - 40, e.n); return;
      }
      case 'd_lantern': lantern(g, x, y); return;
      case 'd_urn': urn(g, x, y); return;
      case 'd_flower': pix(g, 'flower_r', x - 8, y - 2, 2); pix(g, 'flower_y', x + 8, y, 2); pix(g, 'fern', x, y + 4, 2); return;
      case 'd_mush': pix(g, 'mushroom', x - 6, y, 2); pix(g, 'mushroom', x + 8, y + 2, 1.5); return;
      case 'd_torch': { g.fillStyle = 'rgba(0,0,0,0.2)'; ell(g, x, y, 8, 3); g.fillStyle = '#2b2340'; g.fillRect(x - 3, y - 34, 6, 34); g.fillStyle = '#8a5a2b'; g.fillRect(x - 2, y - 32, 4, 32); g.fillStyle = '#5a3416'; g.fillRect(x - 5, y - 36, 10, 4);
        const f = Math.sin(t * 12 + x) > 0 ? 2 : 0, grd = g.createRadialGradient(x, y - 42, 2, x, y - 42, 26); grd.addColorStop(0, 'rgba(255,190,90,0.5)'); grd.addColorStop(1, 'rgba(255,190,90,0)'); g.fillStyle = grd; g.fillRect(x - 26, y - 68, 52, 52);
        g.fillStyle = '#ff7b22'; g.fillRect(x - 5, y - 46 - f, 10, 10); g.fillStyle = '#ffd35a'; g.fillRect(x - 3, y - 50 - f, 6, 10); g.fillStyle = '#fff2a8'; g.fillRect(x - 1, y - 46, 2, 4); return; }
      case 'd_snowman': { g.fillStyle = 'rgba(0,0,0,0.18)'; ell(g, x, y, 14, 4); g.fillStyle = '#c9d6ea'; pxDisc(g, x, y - 12, 12); pxDisc(g, x, y - 32, 9); g.fillStyle = '#ffffff'; pxDisc(g, x - 1, y - 13, 10); pxDisc(g, x - 1, y - 33, 7);
        g.fillStyle = '#2b2340'; g.fillRect(x - 4, y - 36, 2, 2); g.fillRect(x + 2, y - 36, 2, 2); g.fillRect(x - 1, y - 16, 2, 2); g.fillRect(x - 1, y - 10, 2, 2); g.fillStyle = '#ff8a2a'; g.fillRect(x, y - 33, 5, 2); g.fillStyle = '#d6455b'; g.fillRect(x - 8, y - 26, 16, 4); g.fillRect(x + 4, y - 24, 4, 8);
        g.fillStyle = '#2b2340'; g.fillRect(x - 7, y - 46, 14, 4); g.fillRect(x - 5, y - 54, 10, 8); return; }
      case 'd_crystal': { const b = Math.round(Math.sin(t * 2 + x) * 1) * 2; g.fillStyle = 'rgba(0,0,0,0.18)'; ell(g, x, y, 12, 4);
        const grd = g.createRadialGradient(x, y - 22, 2, x, y - 22, 26); grd.addColorStop(0, 'rgba(190,235,255,0.5)'); grd.addColorStop(1, 'rgba(190,235,255,0)'); g.fillStyle = grd; g.fillRect(x - 26, y - 48, 52, 52);
        for (const [dx, h, w] of [[-8, 22, 6], [0, 34, 8], [8, 18, 6]]) { g.fillStyle = '#2b2340'; g.fillRect(x + dx - w / 2 - 1, y - h - 1 + b, w + 2, h + 1); g.fillStyle = '#9fd8ff'; g.fillRect(x + dx - w / 2, y - h + b, w, h); g.fillStyle = '#e6f6ff'; g.fillRect(x + dx - w / 2, y - h + b, 2, h); g.fillStyle = '#6fb6e6'; g.fillRect(x + dx + w / 2 - 2, y - h + b, 2, h); }
        return; }
    }
  }
  const HPSEEN = new Map(); // 칸 → 마지막으로 맞은 시각 (내구도 바는 맞은 뒤 3초만 보임)
  function drawHpBar(g, x, y, e, i) {
    const at = HPSEEN.get(i); if (!at || performance.now() - at > 3000 || e.hp == null || e.hp >= BHP) return;
    const r = Math.max(0, e.hp / BHP), w = 34, L = Math.round(x - w / 2), T = Math.round(y - 76);
    g.fillStyle = '#2b2340'; g.fillRect(L - 2, T - 2, w + 4, 9); g.fillStyle = '#4a3f5e'; g.fillRect(L, T, w, 5);
    g.fillStyle = r > 0.5 ? '#5ad16a' : r > 0.25 ? '#ffd34d' : '#ff5a4a'; g.fillRect(L, T, Math.round(w * r), 5); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(L, T, Math.round(w * r), 2);
  }
  // ------------------------------------------------------------ 농사 그림 (밭·수로·작물 4단계, 직접 그림)
  const CROPS = MPRules.CROPS;
  const farmCache = {};
  function farmArt(wet) { // 갈아 놓은 밭: 이랑 3줄 (수로 근처면 촉촉하게 진한 색)
    const key = wet ? 'w' : 'd'; if (farmCache[key]) return farmCache[key];
    return (farmCache[key] = artCanvas(32, 32, (g) => {
      const C = wet ? ['#6b4a2e', '#5a3c24', '#7d5836', '#4a301c'] : ['#9a6a3e', '#86592f', '#b07a48', '#6e4a28'];
      g.fillStyle = C[0]; g.fillRect(0, 0, 32, 32);
      for (let r = 0; r < 3; r++) { const y = 3 + r * 10; g.fillStyle = C[1]; g.fillRect(2, y + 5, 28, 3); g.fillStyle = C[2]; g.fillRect(2, y, 28, 4); g.fillStyle = C[3]; g.fillRect(2, y + 8, 28, 1); }
      g.fillStyle = C[2]; for (const [x, y] of [[6, 1], [20, 11], [12, 21], [26, 29]]) g.fillRect(x, y, 2, 2);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, 32, 1); g.fillRect(0, 0, 1, 32);
    }));
  }
  const canalCache = {};
  function canalArt(mask) { // 수로: 물 + 이웃이 수로가 아닌 쪽에만 돌 테두리 (mask: 1=위 2=오른 4=아래 8=왼 이 수로)
    if (canalCache[mask]) return canalCache[mask];
    return (canalCache[mask] = artCanvas(32, 32, (g) => {
      g.fillStyle = '#5fb6e6'; g.fillRect(0, 0, 32, 32); g.fillStyle = '#7fcaf2'; g.fillRect(4, 8, 10, 2); g.fillRect(18, 20, 8, 2); g.fillStyle = '#d6f1ff'; g.fillRect(8, 8, 3, 2); g.fillRect(20, 20, 3, 2);
      const edge = (x, y, w, h) => { g.fillStyle = '#8c8a96'; g.fillRect(x, y, w, h); g.fillStyle = '#b3b0bc'; g.fillRect(x, y, w, Math.min(h, 2)); };
      if (!(mask & 1)) edge(0, 0, 32, 5); if (!(mask & 4)) edge(0, 27, 32, 5); if (!(mask & 8)) edge(0, 0, 5, 32); if (!(mask & 2)) edge(27, 0, 5, 32);
    }));
  }
  function canalMask(x, y) { const w = (dx, dy) => { const e = TILES[(y + dy) * W + x + dx]; return e && e.k === 'water'; }; return (w(0, -1) ? 1 : 0) | (w(1, 0) ? 2 : 0) | (w(0, 1) ? 4 : 0) | (w(-1, 0) ? 8 : 0); }
  function nearCanal(x, y) { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const e = TILES[(y + dy) * W + x + dx]; if (e && e.k === 'water') return true; } return false; }
  const cropStage = (cr) => { const k = (Date.now() - cr.at) / cr.d; return k >= 1 ? 3 : k >= 0.6 ? 2 : k >= 0.25 ? 1 : 0; };
  function px2(g, x, y, c, w = 2, h = 2) { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); }
  function drawCrop(g, x, y, c, st, t = 0) { // x = 칸 가운데, y = 칸 아래쪽
    const sway = st > 0 ? Math.round(Math.sin(t * 2 + x * 0.1)) : 0, G = '#5fbf6a', GD = '#3f9a52';
    if (st === 0) { px2(g, x - 4, y - 10, '#5a3c24', 8, 3); px2(g, x - 1, y - 12, '#e8d9a8'); return; } // 씨앗 자리
    if (st === 1) { px2(g, x - 1, y - 14, GD, 2, 6); px2(g, x - 4 + sway, y - 16, G, 4, 2); px2(g, x + 1 + sway, y - 17, G, 4, 2); return; } // 새싹
    const leaves = (h) => { px2(g, x - 1, y - 6 - h, GD, 2, h); for (let k = 0; k < h; k += 4) { px2(g, x - 6 + sway, y - 8 - k, G, 5, 2); px2(g, x + 2 + sway, y - 10 - k, G, 5, 2); } };
    if (st === 2) { leaves(c === 'wheat' ? 14 : 10); if (c === 'pumpkin') px2(g, x - 3, y - 7, '#e8a23c', 6, 4); if (c === 'berry') px2(g, x + 3, y - 12, '#f2f2f2'); return; } // 자라는 중
    // 다 자람 (작물마다 모양)
    if (c === 'wheat') { for (const dx of [-6, -2, 2, 6]) { px2(g, x + dx, y - 20 + sway, GD, 2, 14); px2(g, x + dx - 1 + sway, y - 26, '#f0c23a', 4, 8); px2(g, x + dx + sway, y - 28, '#fff0b0', 2, 2); } }
    else if (c === 'carrot') { leaves(10); for (const dx of [-5, 3]) { px2(g, x + dx, y - 8, '#ff8a2a', 5, 5); px2(g, x + dx + 1, y - 9, '#ffb05a', 3, 2); } }
    else if (c === 'potato') { leaves(12); for (const [dx, dy] of [[-7, -5], [1, -4], [5, -7]]) { px2(g, x + dx, y + dy, '#b98a50', 5, 4); px2(g, x + dx + 1, y + dy, '#d9aa6a', 2, 2); } }
    else if (c === 'berry') { px2(g, x - 8, y - 14, GD, 16, 10); px2(g, x - 7, y - 16, G, 14, 6); for (const [dx, dy] of [[-6, -10], [-1, -14], [4, -9], [1, -7], [-4, -6]]) { px2(g, x + dx, y + dy, '#e8423c', 3, 3); px2(g, x + dx, y + dy, '#ff9aa0', 1, 1); } }
    else if (c === 'pumpkin') { px2(g, x - 9, y - 8, GD, 4, 2); px2(g, x + 6, y - 9, G, 4, 2); px2(g, x - 7, y - 14, '#2b2340', 14, 12); px2(g, x - 6, y - 13, '#e8823c', 12, 10); px2(g, x - 2, y - 13, '#f0a050', 2, 10); px2(g, x + 2, y - 13, '#c86424', 2, 10); px2(g, x - 1, y - 17, '#5a7a2a', 2, 4); }
    if (Math.sin(t * 4 + x) > 0.75) { px2(g, x + 7, y - 24, '#fff6c8'); px2(g, x + 6, y - 23, '#fff6c8', 4, 1); } // 수확하라고 반짝
  }
  function farmIcon(g, id, W2, H2) { // 상점·보관함 그림
    const B = BUILD_BY[id]; g.imageSmoothingEnabled = false;
    if (B.cat === 'farm') { g.fillStyle = '#2b2340'; g.fillRect(W2 / 2 - 26, H2 / 2 - 26, 52, 52); g.drawImage(farmArt(false), W2 / 2 - 24, H2 / 2 - 24, 48, 48); return; }
    if (B.cat === 'water') { g.fillStyle = '#2b2340'; g.fillRect(W2 / 2 - 26, H2 / 2 - 26, 52, 52); g.drawImage(canalArt(10), W2 / 2 - 24, H2 / 2 - 24, 48, 48); return; }
    if (B.cat === 'fert') { g.save(); g.translate(W2 / 2, H2 / 2 + 4); g.scale(2, 2); px2(g, -9, -10, '#2b2340', 18, 18); px2(g, -8, -9, '#8fbf5a', 16, 16); px2(g, -8, -9, '#b7e07a', 16, 3); px2(g, -4, -4, '#ffffff', 8, 6); px2(g, -3, -3, '#5a7a2a', 2, 4); px2(g, 0, -3, '#5a7a2a', 2, 2); px2(g, -6, -13, '#5a3416', 12, 4); g.restore(); return; }
    if (B.cat === 'seed') { g.drawImage(ICON.seed, 0, 0, 16, 16, W2 / 2 - 24, H2 / 2 - 22, 48, 48); g.save(); g.translate(W2 / 2 + 14, H2 - 6); drawCrop(g, 0, 0, B.crop, 3, 0); g.restore(); return; }
    if (B.cat === 'crop') { g.save(); g.translate(W2 / 2, H2 / 2 + 18); g.scale(1.6, 1.6); drawCrop(g, 0, 0, B.crop, 3, 0); g.restore(); }
  }
  const FARM_CATS = new Set(['farm', 'water', 'seed', 'fert']);
  const fmtLeft = (ms) => { const m = Math.ceil(ms / 60e3); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60 ? (m % 60) + '분' : ''}` : `${m}분`; };
  function itemIcon(cv, id) { // 상점·설치 카드 그림
    const g = cv.getContext('2d'), W2 = cv.width, H2 = cv.height; g.clearRect(0, 0, W2, H2); g.imageSmoothingEnabled = false;
    const B = BUILD_BY[id]; if (!B) return;
    if (FARM_CATS.has(B.cat) || B.cat === 'crop') { farmIcon(g, id, W2, H2); return; }
    if (B.cat === 'trap') { g.drawImage(ICON.trap, 0, 0, 16, 16, (W2 - 48) / 2, (H2 - 48) / 2, 48, 48); return; }
    if (B.cat === 'floor') { const c = floorArtId(id); g.fillStyle = '#2b2340'; g.fillRect(W2 / 2 - 26, H2 / 2 - 26, 52, 52); g.drawImage(c, 0, 0, 32, 32, W2 / 2 - 24, H2 / 2 - 24, 24, 24); g.drawImage(c, 0, 0, 32, 32, W2 / 2, H2 / 2 - 24, 24, 24); g.drawImage(c, 0, 0, 32, 32, W2 / 2 - 24, H2 / 2, 24, 24); g.drawImage(c, 0, 0, 32, 32, W2 / 2, H2 / 2, 24, 24); return; }
    const k = B.id.startsWith('p_') ? 0.8 : B.cat === 'wall' ? 0.78 : 1; g.save(); g.translate(W2 / 2, H2 - 6); g.scale(k, k); drawBuild(g, 0, 0, { k: B.cat, n: MY_NID, id }); g.restore();
  }
  function heavenWall(g, w, R) { // 하늘 방 윗벽: 흰 벽 + 금 띠 + 하늘이 보이는 아치 창 + 기둥
    const top = 18, bot = 2 * TILE;
    g.fillStyle = '#fbf8f1'; g.fillRect(18, top, w - 36, bot - top);
    g.fillStyle = '#efe8dc'; g.fillRect(18, bot - 10, w - 36, 10); g.fillStyle = '#e8c260'; g.fillRect(18, bot - 12, w - 36, 2);
    for (let tx = 2; tx < R.w - 2; tx += 3) {
      const cx = tx * TILE + 16;
      g.fillStyle = '#f3ede2'; g.fillRect(cx + 44, top + 6, 8, bot - top - 16); g.fillStyle = '#e8c260'; g.fillRect(cx + 42, top + 6, 12, 3);
      if (R.doors.some((d) => d.side === 'N' && Math.abs(d.at - tx) <= 2)) continue;
      g.fillStyle = '#e8c260'; pxDisc(g, cx, 38, 14); g.fillRect(cx - 14, 38, 30, 18);
      const grd = g.createLinearGradient(0, 26, 0, 56); grd.addColorStop(0, '#8fd0ff'); grd.addColorStop(1, '#e6f6ff'); g.fillStyle = grd; pxDisc(g, cx, 38, 10); g.fillRect(cx - 10, 38, 22, 16);
      g.fillStyle = '#ffffff'; pxDisc(g, cx - 3, 50, 4); pxDisc(g, cx + 5, 51, 3); g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(cx, 28, 2, 26); g.fillRect(cx - 10, 42, 22, 2);
    }
    g.fillStyle = '#b8862b'; g.fillRect(18, top + 6, w - 36, 2); g.fillStyle = '#e8c260'; g.fillRect(18, top, w - 36, 6); g.fillStyle = '#fff0b0'; g.fillRect(18, top, w - 36, 2);
    g.fillStyle = 'rgba(60,35,20,0.12)'; g.fillRect(18, bot - 2, w - 36, 6);
  }
  const P1 = (x, y, fn, extra) => Object.assign({ x, y, w: 1, h: 1, draw: fn }, extra || {});
  const banner = (x, kind) => ({ x, y: 0, w: 1, h: 2, walk: true, draw: (g, X, Y) => blit(g, BANNERS[kind], X, Y + 6, 2) });
  const ROOMS = {
    temple: {
      name: '하늘 신전', desc: '신들의 공지 · 신탁 제단 · 멸망의 탑', w: 30, h: 18, pos: [1, 1], crowd: 10,
      floor: 'marble_w', wall: true, carpets: [[14, 2, 3, 16], [1, 7, 28, 3]], trim: '#e2b93b',
      emotes: ['신탁 봤어?', '오늘 공지 뭐임', '!', '?', '내일 어디 무너짐?', '탑이 빛난다'],
      doors: [{ side: 'W', at: 8, to: 'market' }, { side: 'E', at: 8, to: 'council' }, { side: 'N', at: 15, to: 'plaza' }, { side: 'S', at: 15, to: 'ground' }],
      props: [
        banner(4, 'blue'), banner(10, 'white'), banner(19, 'white'), banner(25, 'blue'),
        P1(4, 4, column), P1(4, 12, column), P1(25, 4, column), P1(25, 12, column), P1(12, 4, column), P1(18, 4, column),
        P1(2, 3, urn), P1(27, 3, urn), P1(2, 15, urn), P1(27, 15, urn),
        P1(12, 12, lantern), P1(18, 12, lantern),
        { x: 5, y: 11, w: 3, h: 1, board: true, draw: (g, x, y) => { holyAltar(g, x, y, 40, 'book'); plaque(g, x, y - 92, '신탁 제단'); } },
        npcProp('priest', 9, 12),
        P1(11, 15, (g, x, y) => { g.fillStyle = '#d9d0c0'; g.fillRect(x - 18, y - 14, 36, 14); g.fillStyle = '#fffdf8'; g.fillRect(x - 16, y - 18, 32, 6); drawAngel(g, 'Princess', x, y - 16, true); }),
        P1(19, 15, (g, x, y) => { g.fillStyle = '#d9d0c0'; g.fillRect(x - 18, y - 14, 36, 14); g.fillStyle = '#fffdf8'; g.fillRect(x - 16, y - 18, 32, 6); drawAngel(g, 'Knight', x, y - 16, true); }),
        { x: 13, y: 6, w: 4, h: 1, walk: true, draw: (g, x, y) => { if (!DOOM) return; g.fillStyle = '#5a4630'; g.fillRect(x - 140, y - 150, 8, 150); g.fillRect(x + 132, y - 150, 8, 150); drawDoomBanner(g, x, y - 176, 1.5); } },
      ],
    },
    market: {
      name: '천상 상점가', desc: '천사들이 여는 상점 · 건축 · 백신 · 씨앗', w: 30, h: 18, pos: [0, 1], crowd: 9,
      floor: 'marble_w', wall: true, carpets: [[1, 8, 28, 3]], trim: '#e7a33e',
      emotes: ['방벽 몇 개 살까', '백신 비싸ㅠ', '씨앗은 언제 나와?', '천사님 예쁘다', '분수 반짝반짝', '우리 저장소 코인 얼마?'],
      doors: [{ side: 'E', at: 9, to: 'temple' }],
      props: [
        banner(3, 'blue'), banner(11, 'white'), banner(18, 'white'), banner(26, 'blue'),
        { x: 3, y: 4, w: 4, h: 2, npc: 'build', draw: (g, x, y) => pavilion(g, x, y, '#7fb2ff', '건축 상점', NPCS.build.ch) },
        { x: 13, y: 4, w: 4, h: 2, npc: 'vaccine', draw: (g, x, y) => pavilion(g, x, y, '#ff9fc4', '치유의 샘 · 백신', NPCS.vaccine.ch) },
        { x: 23, y: 4, w: 4, h: 2, npc: 'seed', draw: (g, x, y) => pavilion(g, x, y, '#8fe0a8', '정원 상점 · 씨앗', NPCS.seed.ch) },
        { x: 13, y: 13, w: 4, h: 2, draw: lightFountain },
        P1(8, 13, cloudBench, { w: 2 }), P1(21, 13, cloudBench, { w: 2 }),
        P1(2, 12, urn), P1(27, 12, urn), P1(2, 16, urn), P1(27, 16, urn),
        P1(9, 8, lantern), P1(20, 8, lantern), P1(9, 15, lantern), P1(20, 15, lantern),
      ],
    },
    council: {
      name: '회담장', desc: '나라끼리 조약을 맺는 곳 · 전쟁의 천사', w: 26, h: 16, pos: [2, 1], crowd: 7,
      floor: 'marble_w', wall: true, carpets: [[8, 4, 10, 8], [0, 7, 8, 3]], trim: '#5b7fd6',
      emotes: ['불가침 조약 ㄱ?', '동맹 맺자', '조건이 뭔데', '배신하면 알지?', '왕끼리 얘기하자', '규칙서 읽어 봤어?'],
      doors: [{ side: 'W', at: 8, to: 'temple' }, { side: 'E', at: 4, to: 'secret1' }, { side: 'E', at: 12, to: 'secret2' }, { side: 'S', at: 13, to: 'jail' }],
      props: [
        banner(5, 'red'), banner(13, 'white'), banner(20, 'red'),
        { x: 11, y: 6, w: 4, h: 2, draw: (g, x, y) => { holyAltar(g, x - 22, y, 34, 'book'); holyAltar(g, x + 40, y, 22, 'cup'); plaque(g, x, y - 96, '조약 제단'); } },
        npcProp('war', 17, 7),
        P1(9, 5, lantern), P1(16, 5, lantern), P1(9, 11, lantern), P1(16, 11, lantern),
        P1(3, 12, column), P1(22, 12, column), P1(3, 3, urn), P1(22, 3, urn),
      ],
    },
    secret1: {
      name: '구름 쉼터 1', desc: '조용히 쉬어 가는 작은 방', w: 14, h: 10, pos: [3, 0.55], crowd: 2,
      floor: 'cloud', wall: true, trim: '#6b4fb3',
      emotes: ['쉿', '여기 조용하다', '...'],
      doors: [{ side: 'W', at: 5, to: 'council' }],
      props: [P1(6, 5, cloudBench, { w: 2 }), P1(3, 3, urn), P1(10, 3, urn), P1(10, 7, lantern), npcProp('rest', 6, 3)],
    },
    secret2: {
      name: '구름 쉼터 2', desc: '조용히 쉬어 가는 작은 방', w: 14, h: 10, pos: [3, 1.45], crowd: 1,
      floor: 'cloud', wall: true, trim: '#6b4fb3',
      emotes: ['쉿', '...'],
      doors: [{ side: 'W', at: 5, to: 'council' }],
      props: [P1(6, 5, cloudBench, { w: 2 }), P1(3, 3, urn), P1(10, 3, urn), P1(3, 7, lantern)],
    },
    plaza: { // 넓은 구름 광장: 가운데 빛의 분수, 네 귀퉁이 꽃밭, 위쪽 이벤트 무대
      name: '구름 광장', desc: '모여서 노는 곳 · 이벤트가 열리는 곳', w: 56, h: 34, pos: [1, 0], crowd: 24,
      floor: 'lawn', trim: '#4bb3c4',
      patches: [[26, 2, 4, 31, 'cobble', 0], [3, 16, 50, 3, 'cobble', 0], [17, 11, 22, 12, 'marble_w', 30], [4, 4, 13, 7, 'meadow', 22], [39, 4, 13, 7, 'meadow', 22], [4, 23, 13, 7, 'meadow', 22], [39, 23, 13, 7, 'meadow', 22], [20, 3, 16, 5, 'planks', 6]],
      emotes: ['3팀 모여~', 'ㅋㅋㅋ', '안녕!', '이벤트 언제?', '같이 다닐 사람', '우리 나라 짱', '분수 예쁘다', '무대 올라가 봐'],
      doors: [{ side: 'S', at: 28, to: 'temple' }, { side: 'N', at: 28, to: 'wander' }],
      props: [
        { x: 21, y: 3, w: 14, h: 2, draw: plazaStage },
        { x: 26, y: 15, w: 4, h: 3, draw: lightFountain },
        P1(20, 13, column), P1(35, 13, column), P1(20, 20, column), P1(35, 20, column),
        ...[[24, 9], [31, 9], [24, 25], [31, 25], [24, 29], [31, 29]].map(([x, y]) => P1(x, y, lantern)),
        { x: 9, y: 16, w: 2, h: 1, draw: bonfire },
        ...[[7, 15], [12, 15], [7, 18], [12, 18]].map(([x, y]) => ({ x, y, w: 1, h: 1, draw: (g, X, Y) => pix(g, 'log', X, Y + 2, 2) })),
        P1(45, 16, cloudBench, { w: 2 }), P1(45, 19, cloudBench, { w: 2 }),
        ...gardenProps(4, 4), ...gardenProps(39, 4), ...gardenProps(4, 23), ...gardenProps(39, 23),
        { x: 8, y: 7, w: 1, h: 1, walk: true, draw: (g, x, y) => pix(g, 'u:chick', x, y + 2, 2) }, { x: 44, y: 8, w: 1, h: 1, walk: true, draw: (g, x, y) => pix(g, 'u:rabbit', x, y + 2, 2) },
        { x: 10, y: 26, w: 1, h: 1, walk: true, draw: (g, x, y) => pix(g, 'u:hen', x, y + 2, 2) }, { x: 46, y: 27, w: 2, h: 1, walk: true, draw: (g, x, y) => pix(g, 'u:pig', x, y + 2, 2) },
        { x: 2, y: 2, w: 1, h: 1, walk: true, draw: (g, x, y) => cloudAt(g, 0, x + 20, y + 20, 110) }, { x: 53, y: 2, w: 1, h: 1, walk: true, draw: (g, x, y) => cloudAt(g, 1, x - 10, y + 20, 110) },
        { x: 2, y: 31, w: 1, h: 1, walk: true, draw: (g, x, y) => cloudAt(g, 2, x + 20, y + 10, 100) }, { x: 53, y: 31, w: 1, h: 1, walk: true, draw: (g, x, y) => cloudAt(g, 0, x - 10, y + 10, 100) },
      ],
    },
    jail: { // 감옥: 위쪽은 면회실(회담장과 이어짐), 아래는 나라별 감옥 방 6칸 (창살). 3스택이면 갇힘, 보석금으로 바로 나감
      name: '감옥', desc: '체포 3스택이면 갇히는 곳 · 면회실에서 보석금', w: 31, h: 16, pos: [2, 2], crowd: 0,
      floor: 'silver', dark: true, wall: true, wallStyle: 'iron', trim: '#5a5a6e',
      emotes: ['억울해', '꺼내 줘', '...', '다음엔 안 잡혀', '보석금 좀'],
      doors: [{ side: 'N', at: 15, to: 'council' }],
      props: [
        { x: 15, y: 4, w: 2, h: 1, bail: true, draw: (g, x, y) => { pix(g, 'altar', x, y + 6, 2); pix(g, 'book', x - 10, y - 46); plaque(g, x, y - 90, '면회실 · 보석금 내기'); } },
        { x: 4, y: 3, w: 1, h: 1, draw: (g, x, y) => pix(g, 'candles', x, y + 2) }, { x: 26, y: 3, w: 1, h: 1, draw: (g, x, y) => pix(g, 'candles', x, y + 2) },
        ...JAIL_BARS,
      ],
    },
    wander: { // 유랑민 캠프: 등록 창구, 모집 게시판, 천막과 모닥불
      name: '유랑민 등록소', desc: '나라 없는 사람이 귀화·용병·건국을 등록하는 곳', w: 32, h: 18, pos: [1, -1], crowd: 8,
      floor: 'lawn', trim: '#3fa37a',
      patches: [[14, 4, 5, 14, 'cobble', 0], [2, 8, 10, 8, 'meadow', 18], [21, 8, 9, 8, 'meadow', 18], [11, 2, 10, 3, 'planks', 6]],
      emotes: ['용병 구합니다', '귀화시켜 주세요', '우리 4명 모이면 건국함', '몸값 얼마?', '어느 나라가 좋음?', '여기 따뜻하다'],
      doors: [{ side: 'S', at: 16, to: 'plaza' }],
      props: [
        { x: 13, y: 2, w: 6, h: 2, board: true, desk: 'wander', draw: (g, x, y) => { pix(g, 'cabin', x, y + 6, 3); plaque(g, x, y - 132, '등록 창구'); } },
        npcProp('clerk', 11, 4),
        { x: 21, y: 3, w: 4, h: 1, draw: posterBoard },
        { x: 4, y: 9, w: 2, h: 1, draw: (g, x, y) => pix(g, 'tent', x, y + 4, 3) }, { x: 8, y: 12, w: 2, h: 1, draw: (g, x, y) => pix(g, 'tent', x, y + 4, 3) }, { x: 4, y: 14, w: 2, h: 1, draw: (g, x, y) => pix(g, 'tent', x, y + 4, 3) },
        { x: 25, y: 11, w: 2, h: 1, draw: bonfire },
        ...[[23, 10], [28, 10], [23, 13], [28, 13]].map(([x, y]) => ({ x, y, w: 1, h: 1, draw: (g, X, Y) => pix(g, 'log', X, Y + 2, 2) })),
        { x: 2, y: 4, w: 1, h: 1, draw: (g, x, y) => pix(g, 'woodpile', x, y + 2, 3) }, { x: 29, y: 4, w: 1, h: 1, draw: (g, x, y) => pix(g, 'woodpile', x, y + 2, 3) },
        { x: 21, y: 15, w: 2, h: 1, walk: true, draw: (g, x, y) => pix(g, 'u:cow', x, y + 2, 2) }, { x: 10, y: 15, w: 1, h: 1, walk: true, draw: (g, x, y) => pix(g, 'u:rabbit', x, y + 2, 2) },
        ...[[3, 11], [10, 9], [27, 15], [22, 8], [29, 9]].map(([x, y], i) => ({ x, y, w: 1, h: 1, walk: true, draw: (g, X, Y) => pix(g, ['flower_y', 'fern', 'mushroom', 'berry', 'flower_r'][i], X, Y + 2, 2) })),
        { x: 24, y: 6, w: 1, h: 1, draw: (g, x, y) => { g.fillStyle = '#5a4630'; g.fillRect(x - 2, y - 40, 4, 40); sign(g, x, y - 44, '유랑민 캠프'); } },
      ],
    },
  };
  const SKY_M = 90;
  function buildRooms() { for (const id of Object.keys(ROOMS)) buildRoom(id); }
  // 관리자 '맵 고치기'로 바꾼 방 (타일·장벽·소품 숨기기). 서버가 보내 준다
  let ROOM_EDITS = {};
  const GFLOOR = new Map(), GWALL = new Set(), GPROPS = new Map(); // GPROPS: 칸 → { r: 'x:그림'|'u:동물', b: 막힘 } // 땅 지도에 관리자가 깐 타일·장벽 (칸 번호)
  const SHEETS = { town: { key: 'k_town', cols: 12, name: '타이니 타운' }, dungeon: { key: 'k_dungeon', cols: 12, name: '타이니 던전' }, onebit: { key: 'k_onebit', cols: 49, name: '1비트 팩' }, ninja: { key: 'floor', cols: 22, name: '닌자 바닥' }, winter: { key: 'k_winter', cols: 10, name: '겨울' }, water: { key: 'water', cols: 0, name: '물가' }, base: { key: 'base_gen', cols: 8, name: '기본 지형' } };
  // '기본 지형' 탭: 원래 지도·방에 그려지던 바닥(신전 바닥·보라 벽·허공·방 바닥 무늬)을 타일처럼 깔 수 있게 함. 무늬는 칸 위치에 맞춰 이어짐
  const BASE_PATS = ['holy', 'holy_edge', 'wall', 'void', 'lawn', 'meadow', 'cobble', 'planks', 'stonefloor', 'carpet', 'grass', 'dirt', 'marble', 'floor_palace', 'brick', 'marble_w', 'aisle', 'cloud', 'silver'];
  const patCache = {};
  function patCanvas(key) {
    if (patCache[key]) return patCache[key];
    const c = document.createElement('canvas'), g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    if (key === 'holy' || key === 'holy_edge') { c.width = c.height = 64; for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { const px = x * 32, py = y * 32; g.fillStyle = key === 'holy' ? '#f3ecdc' : '#efdcae'; g.fillRect(px, py, 32, 32); g.fillStyle = '#e2d8c4'; g.fillRect(px, py + 30, 32, 2); g.fillRect(px + (y ? 0 : 16), py, 2, 32); } }
    else if (key === 'wall') { c.width = c.height = 64; for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { const px = x * 32, py = y * 32; g.fillStyle = '#6b4fb3'; g.fillRect(px, py, 32, 32); g.fillStyle = '#8467c9'; g.fillRect(px, py, 32, 12); if ((x + y) % 2 === 0) { g.fillStyle = '#5a3f9e'; g.fillRect(px + 4, py + 18, 24, 3); } } }
    else if (key === 'void') { c.width = c.height = 64; g.fillStyle = '#1b1430'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#8d7ab8'; g.fillRect(12, 40, 2, 2); g.fillStyle = '#f3dcff'; g.fillRect(46, 14, 2, 2); }
    else if (GEN_FLOOR[key]) { c.width = c.height = 64; GEN_FLOOR[key](g); }
    else { const im = ART['x_' + key]; if (!im) { c.width = c.height = 32; } else { c.width = im.width * 2; c.height = im.height * 2; g.drawImage(im, 0, 0, c.width, c.height); } }
    return (patCache[key] = c);
  }
  function drawPat(g, key, x, y, wx, wy, size) { // (wx, wy) 기준으로 무늬를 이어서 size×size 칸 그리기
    const c = patCanvas(key), k = size / TILE, cw = c.width, ch = c.height;
    let sy = ((wy % ch) + ch) % ch, dy = 0;
    while (dy < TILE) { const hgt = Math.min(TILE - dy, ch - sy); let sx = ((wx % cw) + cw) % cw, dx = 0;
      while (dx < TILE) { const wid = Math.min(TILE - dx, cw - sx); g.drawImage(c, sx, sy, wid, hgt, x + dx * k, y + dy * k, wid * k, hgt * k); dx += wid; sx = 0; }
      dy += hgt; sy = 0; }
  }
  // 물·독물 타일: 시트 그림에서 물빛(파랑)·독물(보라) 픽셀이 30% 넘는 칸 → 깔면 못 지나감 (선착장·배·얼음 무늬 없는 칸은 통과)
  const WATERY = new Set();
  const isWater = (ref) => !!ref && WATERY.has(ref);
  function findWaterTiles() {
    for (const [id, S] of Object.entries(SHEETS)) {
      if (id === 'base') continue; const im = ART[S.key]; if (!im || !S.cols) continue;
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      let d; try { d = g.getImageData(0, 0, im.width, im.height).data; } catch (e) { continue; }
      const rows = Math.floor(im.height / 16);
      for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < S.cols; tx++) {
        let op = 0, wet = 0;
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const o = ((ty * 16 + y) * im.width + tx * 16 + x) * 4, r = d[o] / 255, gg = d[o + 1] / 255, b = d[o + 2] / 255; if (d[o + 3] < 128) continue; op++;
          const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx ? (mx - mn) / mx : 0; if (mx === mn) continue;
          let h = mx === r ? ((gg - b) / (mx - mn)) % 6 : mx === gg ? (b - r) / (mx - mn) + 2 : (r - gg) / (mx - mn) + 4; h = ((h * 60) + 360) % 360 / 360;
          if ((h >= 0.47 && h <= 0.6 && sat >= 0.25 && mx >= 0.45) || (h >= 0.75 && h <= 0.95 && sat >= 0.15 && mx >= 0.35)) wet++; // 물(파랑) 또는 독물(보라)
        }
        if (op >= 200 && wet / 256 >= 0.3) WATERY.add(id + ':' + (ty * S.cols + tx));
      }
    }
    for (const [cx, cy] of Object.values(TL.shore)) WATERY.add('water:' + (cy * SHEETS.water.cols + cx)); // 게임 원래 물가 조각은 항상 물
  }
  function buildBaseSheet() {
    SHEETS.water.cols = Math.floor(ART.water.width / 16);
    const c = document.createElement('canvas'), cols = 8; c.width = cols * 16; c.height = Math.ceil(BASE_PATS.length / cols) * 16; const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    BASE_PATS.forEach((k, i) => drawPat(g, k, (i % cols) * 16, Math.floor(i / cols) * 16, 0, 0, 16));
    ART.base_gen = c;
    findWaterTiles();
  }
  // 맵 고치기 소품: 게임에 있는 그림(x:)·동물(u:)을 칸 아래쪽에 맞춰 그림 (너무 크면 높이 140px로 줄임)
  function drawProp(g, ref, x, y) { const [t, n] = ref.split(':'), key = t === 'u' ? 'u:' + n : n, im = t === 'u' ? ART['u_' + n] : ART['x_' + n]; if (!im) return; if (im.height * 2 > 140) pix(g, key, x, y, 0, 140); else pix(g, key, x, y, 2); }
  const NOT_PROPS = new Set(['stonefloor', 'carpet', 'grass', 'dirt', 'marble', 'floor_palace', 'brick', 'door_gold', 'door_cloud', 'burst', 'pin', 'cloud']);
  const propList = () => [...EXTRA, ...TEMPLE].filter((k) => !NOT_PROPS.has(k) && ART['x_' + k]).map((k) => 'x:' + k).concat([...USER.animals, ...USER.monsters].filter((k) => ART['u_' + k]).map((k) => 'u:' + k));
  function drawSheetTile(g, ref, x, y, size, wx = x, wy = y) { const [sh, n] = ref.split(':'), S = SHEETS[sh], im = S && ART[S.key]; if (!im) return; const k = +n; if (sh === 'base') { if (BASE_PATS[k]) drawPat(g, BASE_PATS[k], x, y, wx, wy, size); return; } g.drawImage(im, (k % S.cols) * 16, Math.floor(k / S.cols) * 16, 16, 16, x, y, size, size); }
  function applyGroundEdit(m) {
    if (m.reset) { GFLOOR.clear(); GWALL.clear(); GCLEAR.clear(); GPROPS.clear(); invalidateChunks(); mapSig = ''; return; }
    const touched = [];
    for (const [k, v] of Object.entries(m.set || {})) { const [x, y] = k.split(',').map(Number), i = y * W + x; if (v) GFLOOR.set(i, v); else GFLOOR.delete(i); touched.push(i); }
    for (const [k, v] of Object.entries(m.walls || {})) { const [x, y] = k.split(',').map(Number), i = y * W + x; if (v) GWALL.add(i); else GWALL.delete(i); }
    for (const [k, v] of Object.entries(m.props || {})) { const [x, y] = k.split(',').map(Number), i = y * W + x; if (v) GPROPS.set(i, v); else GPROPS.delete(i); }
    let cl = 0; for (const [k, v] of Object.entries(m.clear || {})) { const [x, y] = k.split(',').map(Number), i = y * W + x; if (v) GCLEAR.add(i); else GCLEAR.delete(i); touched.push(i); cl++; }
    if (cl) mapSig = '';
    if (touched.length < 400) for (const i of touched) dirtyTile(i); else invalidateChunks();
  }
  function applyRoomDiff(id, d) { // 다른 관리자가 바꾼 칸만 합치기
    if (d.reset) ROOM_EDITS[id] = { floor: {}, walls: {}, props: {}, hideProps: false };
    const E = ROOM_EDITS[id] = ROOM_EDITS[id] || { floor: {}, walls: {}, hideProps: false }; E.floor = E.floor || {}; E.walls = E.walls || {};
    for (const [k, v] of Object.entries(d.set || {})) { if (v) E.floor[k] = v; else delete E.floor[k]; }
    for (const [k, v] of Object.entries(d.walls || {})) { if (v) E.walls[k] = 1; else delete E.walls[k]; }
    E.props = E.props || {}; for (const [k, v] of Object.entries(d.props || {})) { if (v) E.props[k] = v; else delete E.props[k]; }
    E.hideProps = !!d.hideProps;
    if (ROOMS[id]) { buildRoom(id); if (player.room && player.room.id === id) player.room = ROOMS[id]; }
  }
  function applyRoomEdit(id, e) { ROOM_EDITS[id] = e; if (ROOMS[id]) { buildRoom(id); if (player.room === ROOMS[id]) player.room = ROOMS[id]; } }
  function buildRoom(id) {
    {
      const R = ROOMS[id], E = ROOM_EDITS[id] || {};
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
      for (const p of (E.hideProps ? [] : R.props)) if (!p.walk) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (R.grid[y * R.w + x] < 10) R.grid[y * R.w + x] = 1; // walk: 밟고 지나가는 장식(꽃·동물)
      for (const k of Object.keys(E.walls || {})) { const [x, y] = k.split(',').map(Number); if (x < R.w && y < R.h && R.grid[y * R.w + x] < 10) R.grid[y * R.w + x] = 1; } // 관리자가 칠한 빨간 장벽
      for (const [k, ref] of Object.entries(E.floor || {})) { if (!isWater(ref)) continue; const [x, y] = k.split(',').map(Number); if (x < R.w && y < R.h && R.grid[y * R.w + x] < 10) R.grid[y * R.w + x] = 1; } // 물 타일은 못 지나감
      for (const [k, v] of Object.entries(E.props || {})) { const [x, y] = k.split(',').map(Number); if (v.b && x < R.w && y < R.h && R.grid[y * R.w + x] < 10) R.grid[y * R.w + x] = 1; } // 막힘 소품
      R.sprites = (E.hideProps ? [] : R.props).map((p) => ({ x: (p.x + p.w / 2) * TILE, y: (p.y + p.h) * TILE, draw: p.draw, board: p.board, prop: p }));
      for (const [k, v] of Object.entries(E.props || {})) { const [x, y] = k.split(',').map(Number); R.sprites.push({ x: (x + 0.5) * TILE, y: (y + 1) * TILE - 2, draw: (g, X, Y) => drawProp(g, v.r, X, Y) }); } // 관리자가 놓은 소품
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
      if (GEN_FLOOR[key]) { tc.width = tc.height = 64; tg.imageSmoothingEnabled = false; GEN_FLOOR[key](tg); return g.createPattern(tc, 'repeat'); }
      if (key.startsWith('na:')) { const [cx, cy] = key.slice(3).split(',').map(Number); tc.width = tc.height = TILE; tg.imageSmoothingEnabled = false; tg.drawImage(ART.floor, cx * 16, cy * 16, 16, 16, 0, 0, TILE, TILE); }
      else { const im = ART['x_' + key]; tc.width = im.width * 2; tc.height = im.height * 2; tg.imageSmoothingEnabled = false; tg.drawImage(im, 0, 0, tc.width, tc.height); }
      return g.createPattern(tc, 'repeat');
    };
    g.fillStyle = pat(R.floor); rr(g, 18, 18, w - 36, h - 36, 18);
    if (R.dark) { g.fillStyle = 'rgba(30,20,60,0.35)'; rr(g, 18, 18, w - 36, h - 36, 18); }
    else if (R.floor === 'stonefloor') { g.fillStyle = 'rgba(255,248,235,0.22)'; rr(g, 18, 18, w - 36, h - 36, 18); }
    if (R.floor !== 'lawn') { g.strokeStyle = '#e8c260'; g.lineWidth = 4; g.beginPath(); if (g.roundRect) g.roundRect(26, 26, w - 52, h - 52, 12); else g.rect(26, 26, w - 52, h - 52); g.stroke(); g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2; g.beginPath(); if (g.roundRect) g.roundRect(32, 32, w - 64, h - 64, 10); else g.rect(32, 32, w - 64, h - 64); g.stroke(); } // 금테
    for (const [cx, cy, cw, ch] of R.carpets || []) { g.fillStyle = pat(R.carpet || 'aisle'); g.fillRect(cx * TILE, cy * TILE, cw * TILE, ch * TILE); g.strokeStyle = '#e8c260'; g.lineWidth = 4; g.strokeRect(cx * TILE + 2, cy * TILE + 2, cw * TILE - 4, ch * TILE - 4); g.strokeStyle = '#fff0b0'; g.lineWidth = 2; g.strokeRect(cx * TILE + 6, cy * TILE + 6, cw * TILE - 12, ch * TILE - 12); }
    for (const [px, py, pw, ph, key, rad] of R.patches || []) { g.fillStyle = pat(key); rr(g, px * TILE, py * TILE, pw * TILE, ph * TILE, rad || 0); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3; g.beginPath(); g.roundRect ? g.roundRect(px * TILE, py * TILE, pw * TILE, ph * TILE, rad || 0) : g.rect(px * TILE, py * TILE, pw * TILE, ph * TILE); g.stroke(); } // 꽃밭·길·광장 바닥
    if (R.wall && R.wallStyle !== 'iron') heavenWall(g, w, R);
    else if (R.wall) {
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
    const E = ROOM_EDITS[R.id]; // 관리자가 깐 타일 (16px → 32px)
    if (E && E.floor) { g.imageSmoothingEnabled = false; for (const [k, ref] of Object.entries(E.floor)) { const [x, y] = k.split(',').map(Number); if (x < R.w && y < R.h) drawSheetTile(g, ref, x * TILE, y * TILE, TILE); } }
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
    if (build.on) setBuild(false); // 하늘에 가면 설치 모드 자동으로 끄기
  }
  function ascend(portalTerr) {
    if (player.carry) { toast('훔친 걸 들고 있으면 포털을 쓸 수 없어요 · 걸어서 우리 저장소로!'); return; }
    player.entry = portalTerr;
    player.skyLeft = SKY_LIMIT;
    enterRoom('temple', 'ground');
    toast('하늘 신전에 올라왔어요 · 여기선 싸울 수 없어요');
  }
  function descend() {
    const t = player.entry || home;
    player.scene = 'ground'; player.room = null; fadeT = 0.35; lastTerr = null; netTp = true; step.on = false;
    const tp = MPRules.portalSpot(t, tileAt);
    player.x = tp[0] * TILE + 16; player.y = (tp[1] + 1) * TILE + 16;
    if (!free(player.x, player.y, null)) teleportTo(tp[0], tp[1] + 1);
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
    // 위·아래 벽 가운데 문(3칸)은 구름 문, 옆벽 문은 금빛 대문 — 둘 다 문 구멍 3칸에 꽉 맞게
    if (vertical) {
      pix(g, 'door_gold', x, y + 16, 0, 3 * TILE);
      sign(g, x + (side === 'W' ? 80 : -80), y - 2 * TILE - 30, (side === 'W' ? '← ' : '') + label + (side === 'E' ? ' →' : ''));
    } else {
      const by = side === 'N' ? y + 8 : y;
      const im = ART.x_door_cloud, k = 3 * TILE / im.width;
      pix(g, 'door_cloud', x, by, k);
      sign(g, x, by - im.height * k - 18, (side === 'N' ? '↑ ' : '↓ ') + label);
    }
  }

  const CLOUDS = [0, 1, 2].map((v) => artCanvas(64, 32, (g) => { // 직접 그린 구름 (테두리 없이 흰색 + 아래쪽만 연한 하늘색 그늘)
    const blobs = [[[14, 20, 9], [26, 14, 11], [40, 16, 10], [50, 21, 8]], [[12, 21, 8], [24, 16, 10], [36, 12, 11], [48, 18, 9]], [[16, 18, 10], [30, 12, 12], [44, 19, 9]]][v];
    g.fillStyle = '#d6e6fb'; for (const [x, y, r] of blobs) pxDisc(g, x, y + 3, r); g.fillRect(8, 22, 48, 6);
    g.fillStyle = '#ffffff'; for (const [x, y, r] of blobs) pxDisc(g, x, y, r - 1); g.fillRect(10, 20, 44, 5);
    g.fillStyle = '#f2f8ff'; for (const [x, y, r] of blobs) g.fillRect(x - 2, y + r - 5, 4, 2);
  }));
  function cloudAt(g, i, x, bottom, w, alpha = 1) { const c = CLOUDS[i % 3], k = w / 64; g.globalAlpha = alpha; const p = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.drawImage(c, Math.round(x - w / 2), Math.round(bottom - 32 * k), Math.round(w), Math.round(32 * k)); g.imageSmoothingEnabled = p; g.globalAlpha = 1; }
  function drawSkyBackground(t) {
    if (ONLINE && SLOT === 'night') { drawStarSky(t); return; }
    const grd = ctx.createLinearGradient(0, 0, 0, vh);
    grd.addColorStop(0, DOOM ? '#cbb6ee' : '#a9dcff'); grd.addColorStop(1, DOOM ? '#ffd2dc' : '#fdf3ff');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, vw, vh);
    for (let i = 0; i < 9; i++) {
      const x = ((i * 337 + t * (8 + i * 2)) % (vw + 400)) - 200, y = (i * 173) % Math.max(1, vh);
      cloudAt(ctx, i, x, y + 60, 128 + (i % 3) * 48, 0.9);
    }
  }

  // 밤 하늘: 별이 반짝이며 천천히 흐르고, 가끔 별똥별
  function drawStarSky(t) {
    const grd = ctx.createLinearGradient(0, 0, 0, vh);
    grd.addColorStop(0, DOOM ? '#140a2e' : '#0a1030'); grd.addColorStop(1, DOOM ? '#3a1d5c' : '#24306a');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, vw, vh);
    for (let i = 0; i < 280; i++) {
      const sp = 3 + (i % 5) * 2, x = ((hash(i, 1, 31) * (vw + 200) + t * sp) % (vw + 200)) - 100, y = hash(i, 2, 31) * vh;
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(t * (0.8 + hash(i, 3, 31) * 2.2) + i)), big = hash(i, 4, 31) > 0.82;
      ctx.globalAlpha = tw; ctx.fillStyle = hash(i, 5, 31) > 0.8 ? '#ffe9a8' : hash(i, 6, 31) > 0.7 ? '#b8d8ff' : '#ffffff';
      const sz = big ? 4 : 2; ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
      if (big && tw > 0.85) { ctx.fillRect(Math.round(x) - 2, Math.round(y) + 1, 7, 1); ctx.fillRect(Math.round(x) + 1, Math.round(y) - 2, 1, 7); } // 반짝
    }
    ctx.globalAlpha = 1;
    const cyc = t % 7; // 별똥별 (7초에 한 번)
    if (cyc < 0.9) { const k = cyc / 0.9, sx = vw * (0.2 + hash(Math.floor(t / 7), 1, 9) * 0.6), sy = vh * 0.1; const x = sx + k * 260, y = sy + k * 130; for (let j = 0; j < 14; j++) { ctx.globalAlpha = (1 - j / 14) * (1 - k); ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x - j * 6), Math.round(y - j * 3), 3, 2); } ctx.globalAlpha = 1; }
    // 큰 픽셀 달
    const mx = vw - 210, my = Math.min(vh * 0.36, 300), R2 = 6;
    for (let yy = -8; yy <= 8; yy++) for (let xx = -8; xx <= 8; xx++) { const a = Math.hypot(xx, yy), b = Math.hypot(xx - 3, yy + 2); if (a <= 7.5 && b > 6) { ctx.fillStyle = a > 6.5 ? '#c9b860' : '#fff1a8'; ctx.fillRect(mx + xx * R2, my + yy * R2, R2, R2); } }
    for (let i = 0; i < 6; i++) { const x = ((i * 337 + t * (5 + i)) % (vw + 400)) - 200, y = (i * 173) % Math.max(1, vh); cloudAt(ctx, i, x, y + 60, 128 + (i % 3) * 48, 0.25); }
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
    if (k === 't') { if (player.carry) toast('훔친 걸 들고 있으면 순간이동할 수 없어요'); else goHome(); }
    if ((k === 'e' || k === ' ') && !$('talk').hidden) { e.preventDefault(); if (!e.repeat) talkNext(); return; }
    if (k === 'e' && !e.repeat && !document.querySelector('.modalbox:not([hidden]), #closet:not([hidden])')) pressE(); // 창이 열려 있으면 E 무시 (상점 연 뒤 대화창이 또 뜨던 버그)
    if (k === 'g' && ONLINE) setBuild(!build.on);
    if (k >= '1' && k <= '8') emote(+k - 1);
    if (k === 'enter' && ONLINE) { e.preventDefault(); $('chatIn').focus(); }
    if ((k === '[' || k === ']') && !ONLINE) { location.hash = 'day' + Math.max(1, Math.min(15, DAY + (k === ']' ? 1 : -1))); }
    if (k === 'escape') { closeTalk(); $('rulebook').hidden = true; $('bigmap').hidden = true; $('closet').hidden = true; $('coupon').hidden = true; $('wanderBox').hidden = true; $('war').hidden = true; $('puzzle').hidden = true; $('reinBox').hidden = true; $('bailBox').hidden = true; $('warCast').hidden = true; $('storeBox').hidden = true; $('shopBox').hidden = true; if (build.on) setBuild(false); }
  });
  addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'e') releaseE(); });
  // 패드·폰: 화면 아래 안내를 누르면 E (꾹 누르기도 됨)
  $('prompt').addEventListener('pointerdown', (e) => { e.preventDefault(); pressE(); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('prompt').addEventListener(ev, releaseE);
  addEventListener('blur', () => keys.clear());
  // 확대·축소는 지도만 (브라우저 화면 확대 대신): 휠, Ctrl+휠(터치패드 핀치), Ctrl +/−/0, 두 손가락 핀치, ＋/－ 버튼
  const setZoom = (z) => { zoom = Math.max(0.5, Math.min(1.8, z)); };
  addEventListener('wheel', (e) => {
    const onMap = e.target === canvas;
    if (!onMap && !e.ctrlKey) return; // 창 안 스크롤은 그대로
    e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9));
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (['=', '+', '-', '_', '0'].includes(e.key)) { e.preventDefault(); setZoom(e.key === '0' ? (innerWidth < 720 ? 0.8 : 1) : zoom * (e.key === '-' || e.key === '_' ? 0.9 : 1.1)); }
  });
  $('zoomIn').addEventListener('click', () => setZoom(zoom * 1.15));
  $('zoomOut').addEventListener('click', () => setZoom(zoom / 1.15));
  const touches = new Map(); let pinch0 = 0, zoom0 = 1;
  const pinchDist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (touches.size === 2) { pinch0 = pinchDist(); zoom0 = zoom; stick.on = false; stickEl.hidden = true; } });
  canvas.addEventListener('pointermove', (e) => { if (!touches.has(e.pointerId)) return; touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (touches.size === 2 && pinch0) setZoom(zoom0 * pinchDist() / pinch0); });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch0 = 0; });

  const stickEl = $('stick'), knob = stickEl.firstElementChild;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    stick.on = true; stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.vx = stick.vy = 0;
    stickEl.style.left = (e.clientX - 55) + 'px'; stickEl.style.top = (e.clientY - 55) + 'px'; stickEl.hidden = false;
    knob.style.transform = 'translate(0,0)';
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!stick.on || e.pointerId !== stick.id || touches.size >= 2) return;
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
      if (RIFT_SET.has(t.id)) chip(`🌀 ${RIFT_NEXT.day}일차 균열`, '#8a3fd0');
      if (EROSION[t.id] > 0) chip(`🌀 침식 ${EROSION[t.id]}%`, '#8a3fd0');
      if (myView && (myView.incoming.some((b) => b.target === t.id) || myView.outgoing.some((b) => b.target === t.id))) chip(`⚔ ${nextFight()} 전투`, '#c22f53');
      if (t.capitalCandidate) chip('수도 후보 · 하늘 포털', '#c22f53');
    } else {
      $('whereName').textContent = '알 수 없는 땅';
      $('whereSub').textContent = '';
    }
  }

  let near = null, lastPKey = '';   // { kind: 'portal'|'altar'|'board', t, text }
  function updatePrompt() {
    let best = null;
    if (player.scene === 'sky') {
      for (const sp of player.room.sprites) {
        if (sp.board && Math.hypot(sp.x - player.x, sp.y + 16 - player.y) < 90) best = sp.prop && sp.prop.desk === 'wander' ? { kind: 'desk', text: '등록 창구 이용하기' } : { kind: 'board', text: '게시판 읽기' };
        if (sp.prop && sp.prop.bail && ONLINE && MY_NID && Math.hypot(sp.x - player.x, sp.y + 20 - player.y) < 100) best = { kind: 'bail', text: '면회실 · 우리 팀원 보석금 내기' };
        if (sp.prop && sp.prop.npc && Math.hypot(sp.x - player.x, sp.y + 24 - player.y) < 96) best = { kind: 'npc', npc: sp.prop.npc, text: `${NPCS[sp.prop.npc].name}에게 말 걸기` };
        if (sp.prop && sp.prop.shop && Math.hypot(sp.x - player.x, sp.y + 20 - player.y) < 100) best = ONLINE ? { kind: 'shop', text: sp.prop.shop === 'build' ? '바닥·방벽·덫 사기' : '백신 사기' } : sp.prop.shop === 'vaccine' ? { kind: 'vaccine', text: `백신 사기 · 코인 ${vaccinePrice().toLocaleString()}` } : null;
      }
    } else {
      const tx = player.x / TILE, ty = player.y / TILE;
      const o = terrAt(tx | 0, ty | 0);
      if (o > 0) {
        const t = terrs[o];
        let n = null, nd = 52; for (const q of nodes) { const d = Math.hypot(q.x - player.x, q.y - player.y); if (d < nd) { nd = d; n = q; } }
        for (const [i] of STORE_AT) if (n && Math.hypot((i % W) * TILE + 16 - player.x, Math.floor(i / W) * TILE + 16 - player.y) < nd) n = null; // 저장소가 더 가까우면 저장소
        const tp = t.portal || (t === home ? homePortal() : null);
        if (tp && Math.hypot(tp[0] + 0.5 - tx, tp[1] + 0.5 - ty) < 1.8) best = { kind: 'portal', t, text: '하늘로 올라가기' };
        else if (n && !build.on) best = { kind: 'node', n, text: mined.has(n.id) ? '오늘은 다 캤어요 (내일 다시)' : '금광 캐기 · 코인' };
        else if (Math.hypot(t.altar[0] + 0.5 - tx, t.altar[1] + 0.5 - ty) < 2.4) {
          const own = ownerOf(t.id), mine = myView && own === myView.me.id;
          const canClaim = myView && !own && Object.keys(owners).some((k) => owners[k] === myView.me.id && terrs[k] && terrs[k].neighbors.includes(t.id));
          if (ONLINE && own && !mine) { const hn = HITN.get(t.id), c = hn && performance.now() - hn.at < 60000 ? hn.n : 0; best = { kind: 'hit', t, text: `${natName(own)}의 수정 때리기 ${c}/${MPRules.NUM.scoutHits} · 다 채우면 병력·첩보` }; }
          else best = { kind: 'altar', t, claim: canClaim, solvable: canClaim || mine, text: canClaim ? `${t.name} · 문제 풀고 점령하기` : mine ? `우리 제단 · ${t.type} 문제 풀기 (병력)` : own ? `${natName(own)}의 제단` : `${t.name} 제단 · 우리 땅과 붙어야 점령 가능` };
        }
      }
    }
    if (player.scene === 'ground' && ONLINE && best && best.t && (best.kind === 'altar' || best.kind === 'hit')) { // 저장소가 제단보다 가까우면 저장소
      const ptx = player.x / TILE, pty = player.y / TILE, dA = Math.hypot(best.t.altar[0] + 0.5 - ptx, best.t.altar[1] + 0.5 - pty);
      for (const [i] of STORE_AT) if (Math.hypot((i % W) + 0.5 - ptx, Math.floor(i / W) + 0.5 - pty) <= Math.min(1.9, dA)) { best = null; break; }
    }
    if (player.scene === 'ground' && ONLINE && build.on && !(best && best.kind === 'portal')) { const b = groundAction(); if (b) best = b; } // 설치 모드에선 설치가 먼저 (포털만 예외)
    if (!best && player.scene === 'ground' && ONLINE) best = groundAction();
    const key = best ? best.kind + best.text : '';
    if (key !== lastPKey) { lastPKey = key; // (설치 모드를 꺼도 안내가 남던 버그: 마지막으로 보여 준 글자와 비교)
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
    const [fx, fy] = facingTile(), i = fy * W + fx, e = TILES[i];
    if (build.on && myView && build.moving) { // 옮기는 중: 앞 칸에 놓기
      return { kind: 'dropB', x: fx, y: fy, text: `여기에 ${build.moving.kind === 'store' ? '저장소' : '금광'} 놓기 (E) · 취소는 G` };
    }
    if (build.on && myView) { // 우리 저장소·우리 땅 금광 옆이면 옮기기
      for (const [i, nid] of STORE_AT) if (nid === MY_NID && Math.hypot((i % W) + 0.5 - ptx, Math.floor(i / W) + 0.5 - pty) < 1.9) return { kind: 'pickB', what: { kind: 'store' }, text: '저장소 옮기기 (E) → 옮길 자리에서 E' };
      for (const q of nodes) if (ownerOf(q.id) === MY_NID && Math.hypot(q.tx + 0.5 - ptx, q.ty + 0.5 - pty) < 1.6) return { kind: 'pickB', what: { kind: 'mine', terr: q.id }, text: '금광 옮기기 (E) → 옮길 자리에서 E' };
    }
    if (build.on && myView) {
      const B = BUILD_BY[build.id] || BUILD_BY.f_stone, tiles = shapeTiles(), shape = B.cat === 'trap' || B.cat === 'deco' || B.cat === 'fert' ? '1' : build.shape;
      if (B.cat === 'seed' || B.cat === 'fert' || B.cat === 'farm') { // 농사: 내 발밑 기준
        const [mx, my] = shape === '1' ? [Math.floor(player.x / TILE), Math.floor(player.y / TILE)] : [fx, fy], f = TILES[my * W + mx], have = myView.me.items[B.id] || 0, where = shape === '1' ? '발밑에' : '앞에';
        if (ownerOf(terrAt(mx, my)) !== MY_NID) return { kind: 'info', text: '농사는 우리 땅에서만 해요' };
        if (f && f.k === 'farm' && f.n === MY_NID && f.crop && cropStage(f.crop) === 3) return { kind: 'harvest', tiles, text: `${CROPS[f.crop.c].name} 수확하기 (E)` };
        if (B.cat === 'farm') {
          if (f && f.k === 'farm' && f.n === MY_NID && !f.crop) return { kind: 'pickup', tiles, text: `${shape === '1' ? '발밑' : '앞'} 밭 거두기 (E)` };
          if (!have) return { kind: 'info', text: '밭이 없어요 · 하늘 정원 천사에게서 사요' };
          return { kind: 'place', tiles, text: `${where} 밭 ${SHAPE_NAME[shape]} 갈기 · 남은 ${have}개` };
        }
        if (!f || f.k !== 'farm' || f.n !== MY_NID) return { kind: 'info', text: shape === '1' ? `밭 위에 서서 ${B.cat === 'seed' ? '심어요' : '비료를 줘요'} (밭은 농사 탭에서 깔아요)` : '앞에 우리 밭이 있어야 해요' };
        if (!have) return { kind: 'info', text: `${B.name}이(가) 없어요 · 하늘 정원 천사에게서 사요` };
        if (B.cat === 'seed') return f.crop ? { kind: 'info', text: `${CROPS[f.crop.c].name} 자라는 중 · ${fmtLeft(f.crop.d - (Date.now() - f.crop.at))} 남음` } : { kind: 'plant', tiles, text: `${B.name} ${SHAPE_NAME[shape]} 심기 · 남은 ${have}개` };
        return !f.crop ? { kind: 'info', text: '심은 작물이 없어요' } : f.crop.f ? { kind: 'info', text: '이미 비료를 줬어요' } : { kind: 'fert', tiles, text: `비료 주기 · 남은 시간 절반 (${fmtLeft(f.crop.d - (Date.now() - f.crop.at))} → ${fmtLeft((f.crop.d - (Date.now() - f.crop.at)) / 2)})` };
      }
      if (B.cat === 'floor') { // 바닥은 내 발밑 기준
        const [mx, my] = shape === '1' ? [Math.floor(player.x / TILE), Math.floor(player.y / TILE)] : [fx, fy], me2 = TILES[my * W + mx];
        if (ownerOf(terrAt(mx, my)) !== MY_NID) return { kind: 'info', text: '설치 모드 · 우리 땅에서만 깔 수 있어요' };
        if (me2 && me2.n === MY_NID && me2.k === 'floor' && tileItem(me2) === B.id) return { kind: 'pickup', tiles, text: `${shape === '1' ? '발밑' : '앞'} ${SHAPE_NAME[shape]} 거두기 (E)` };
        const have = myView.me.items[B.id] || 0;
        if (!have) return { kind: 'info', text: `${B.name}이(가) 없어요 · 하늘 건축 상점에서 사요` };
        return { kind: 'place', tiles, text: `${shape === '1' ? '발밑에' : '앞에'} ${B.name} ${SHAPE_NAME[shape]} 깔기 · 남은 ${have}개` };
      }
      if ((e && e.n === MY_NID && e.k !== 'floor') || MY_TRAPS.has(i)) return { kind: 'pickup', tiles, text: `${SHAPE_NAME[shape]} 거두기 (E) · 바로 앞: ${e ? (BUILD_BY[tileItem(e)] || {}).name : '덫'}` };
      if (ownerOf(terrAt(fx, fy)) !== MY_NID) return { kind: 'info', text: '설치 모드 · 우리 땅에만 놓을 수 있어요' };
      const have = myView.me.items[B.id] || 0;
      if (!have) return { kind: 'info', text: `${B.name}이(가) 없어요 · 하늘 건축 상점에서 사요` };
      return { kind: 'place', tiles, text: `${B.name} ${SHAPE_NAME[shape]} 놓기 · 남은 ${have}개` };
    }
    if (MY_NID) for (const [id, r] of remotes) { // 우리 땅에 들어온 적 → 체포
      if (r.x == null || !r.nid || r.nid === MY_NID || Math.hypot(r.x - player.x, r.y - player.y) > 52) continue;
      if (ownerOf(terrAt(r.x / TILE | 0, r.y / TILE | 0)) === MY_NID) return { kind: 'arrest', id, text: `${r.name}${r.carry ? ' (도둑!)' : ''} 체포하기` };
    }
    if (MY_NID && myView) for (const b of BATTLES) { // 우리 전투의 전선 진지 근처
      if (!b.f || (b.att !== MY_NID && b.def !== MY_NID)) continue;
      if (!b.f.some((p) => Math.hypot(p[0] + 0.5 - ptx, p[1] + 0.5 - pty) <= MPRules.NUM.frontRange)) continue;
      if (b.att === MY_NID) return { kind: 'reinforce', battle: b.id, text: '전선 진지 · 병력 충원·빼기 (E)' };
      return { kind: 'info', text: '우리가 막는 전선 진지 · 방어 배치는 왕이 전쟁 창(B)에서 정해요' };
    }
    for (const [i, nid] of STORE_AT) if (Math.hypot((i % W) + 0.5 - ptx, Math.floor(i / W) + 0.5 - pty) < 1.9) {
      if (nid === MY_NID) return player.carry ? { kind: 'deposit', text: '훔쳐 온 것 저장소에 넣기' } : { kind: 'store', text: '우리 저장소 열기' };
      if (!MY_NID) return { kind: 'info', text: `${natName(nid)} 저장소` };
      if (player.carry) return { kind: 'info', text: '이미 훔친 걸 들고 있어요 · 우리 저장소로!' };
      return { kind: 'steal', nid, hold: MPRules.NUM.stealSec * 1000, text: `${natName(nid)} 저장소 털기 · E 꾹 ${MPRules.NUM.stealSec}초` };
    }
    if (MY_NID) for (const [hx, hy] of [[Math.floor(ptx), Math.floor(pty)], [fx, fy]]) { // 발밑·앞의 우리 밭: 수확 / 남은 시간
      const f = TILES[hy * W + hx]; if (!f || f.k !== 'farm' || f.n !== MY_NID || !f.crop) continue;
      if (cropStage(f.crop) === 3) return { kind: 'harvest', tiles: [[hx, hy]], text: `${CROPS[f.crop.c].name} 수확하기 (E)` };
      if (hx === Math.floor(ptx) && hy === Math.floor(pty)) return { kind: 'info', text: `${CROPS[f.crop.c].name} 자라는 중 · ${fmtLeft(f.crop.d - (Date.now() - f.crop.at))} 남음${f.crop.w ? ' · 💧수로' : ''}${f.crop.f ? ' · 🌿비료' : ''}` };
    }
    if (treeAt(fx, fy) && MY_NID && ownerOf(terrAt(fx, fy)) === MY_NID) return { kind: 'chop', x: fx, y: fy, hold: MPRules.NUM.chopSec * 1000, text: '나무 베기 · E 꾹 누르기' };
    if (e && e.k === 'wall' && e.n !== MY_NID) return { kind: 'hitB', x: fx, y: fy, text: `${natName(e.n)} ${(BUILD_BY[tileItem(e)] || {}).name || '벽'} 때리기 · E (꾹 = 계속) · 내구도 ${e.hp ?? MPRules.NUM.buildHp}/${MPRules.NUM.buildHp}` };
    return null;
  }
  // 꾹 누르기 (나무 베기 2초, 방벽 부수기 5초)
  const hold = { on: false, t0: 0, ms: 0, kind: '', x: 0, y: 0 };
  let stunUntil = 0, jailUntil = 0;
  let hitTimer = 0;
  function pressE() { if (near && near.kind === 'hitB') { const n = near, go = () => { if (netOn) ws.send(JSON.stringify({ t: 'hitB', x: n.x, y: n.y })); player.atkT = 0.2; }; go(); clearInterval(hitTimer); hitTimer = setInterval(go, 420); return; } if (near && near.hold) startHold(near); else interact(); }
  function releaseE() { clearInterval(hitTimer); if (hold.on) cancelHold(); }
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
  const build = { on: false, id: 'f_stone', tab: 'all', shape: '1' };
  const SHAPE_NAME = { 1: '1칸', h3: '가로 3칸', v3: '세로 3칸', s3: '3×3' };
  // 설치 모양: 바라보는 방향으로는 앞으로 뻗고, 옆 방향은 가운데 맞춤
  function shapeTiles() {
    const cat = (BUILD_BY[build.id] || {}).cat, shape = cat === 'trap' || cat === 'deco' || cat === 'fert' ? '1' : build.shape;
    if ((cat === 'floor' || cat === 'farm' || cat === 'seed' || cat === 'fert') && shape === '1') return [[Math.floor(player.x / TILE), Math.floor(player.y / TILE)]]; // 바닥·밭·씨앗 1칸은 발밑, 여러 칸은 앞으로
    const d = FACE_D[player.face | 0] || [0, 1], [fx, fy] = facingTile();
    const wx = shape === 'h3' || shape === 's3' ? 3 : 1, wy = shape === 'v3' || shape === 's3' ? 3 : 1;
    const xs = wx === 1 ? [fx] : d[0] ? [0, 1, 2].map((k) => fx + k * d[0]) : [fx - 1, fx, fx + 1];
    const ys = wy === 1 ? [fy] : d[1] ? [0, 1, 2].map((k) => fy + k * d[1]) : [fy - 1, fy, fy + 1];
    const out = []; for (const y of ys) for (const x of xs) out.push([x, y]); return out;
  }
  function placeBuildBar() { // 채팅창 오른쪽 ~ 미니맵 왼쪽 사이에 딱 맞게
    const bb = $('buildBar'); if (bb.hidden) return;
    const ch = $('chat'), mi = $('mini'), vwid = innerWidth;
    const L = !ch.hidden && !document.body.classList.contains('chatTuck') ? ch.getBoundingClientRect().right + 10 : 44;
    const R = !mi.hidden ? vwid - mi.getBoundingClientRect().left + 10 : 8;
    if (vwid - L - R < 360) { bb.style.left = '8px'; bb.style.right = '8px'; } else { bb.style.left = L + 'px'; bb.style.right = R + 'px'; }
  }
  addEventListener('resize', placeBuildBar);
  const BB_TABS = [['all', '전체'], ['floor', '바닥'], ['wall', '벽·기둥'], ['deco', '장식'], ['trap', '덫'], ['farm', '🌱 농사']];
  function setBuild(on, id) {
    if (on && !myView) { toast('나라가 있어야 설치할 수 있어요'); return; }
    if (on && player.scene === 'sky') { toast('설치 모드는 땅에서만 쓸 수 있어요'); return; }
    build.on = on; if (id) build.id = id; if (!on) build.moving = null;
    if (on && !id && myView && !(myView.me.items[build.id] > 0)) { const f = MPRules.BUILD.find((x) => x.cat !== 'crop' && myView.me.items[x.id] > 0); if (f) build.id = f.id; } // 켤 때 가진 물건으로
    document.body.classList.toggle('building', on);
    $('buildBar').hidden = !on; if (on) renderBuildTray();
    near = null;
  }
  function renderBuildTray() { // 쿠킹덤식 보관함: 위에 종류 탭, 아래 카드 줄 (그림 + 남은 개수)
    const items = (myView && myView.me.items) || {}, cat = (BUILD_BY[build.id] || {}).cat;
    $('buildBar').dataset.theme = (BUILD_BY[build.id] || {}).theme || 'heaven'; // 보관함 색 = 고른 물건의 테마
    placeBuildBar();
    $('bbTabs').innerHTML = BB_TABS.map(([k, l]) => `<button type="button" data-bt="${k}" aria-pressed="${k === build.tab}">${l}</button>`).join('');
    for (const b of $('bbTabs').querySelectorAll('[data-bt]')) b.onclick = () => { build.tab = b.dataset.bt; const inTab = (x) => x.cat !== 'crop' && (build.tab === 'all' || (build.tab === 'farm' ? FARM_CATS.has(x.cat) : x.cat === build.tab)); const cur = BUILD_BY[build.id]; if (!cur || !inTab(cur)) { const f = MPRules.BUILD.find((x) => inTab(x) && items[x.id] > 0) || MPRules.BUILD.find(inTab); if (f) build.id = f.id; } near = null; renderBuildTray(); }; // 탭을 바꾸면 그 탭의 가진 물건을 자동으로 고름
    const list = MPRules.BUILD.filter((b) => b.cat !== 'crop' && (build.tab === 'all' ? true : build.tab === 'farm' ? FARM_CATS.has(b.cat) : b.cat === build.tab)).sort((a, b) => (items[b.id] > 0) - (items[a.id] > 0));
    $('bbList').innerHTML = list.map((b) => `<button type="button" class="bbCard${items[b.id] ? '' : ' none'}" data-bid="${b.id}" aria-pressed="${b.id === build.id}"><canvas width="64" height="64"></canvas><span>${b.name}</span><i>${items[b.id] || 0}</i><em>${MPRules.THEMES[b.theme]}</em></button>`).join('') || '<p class="bbEmpty">아직 없어요 · 하늘 건축 상점에서 사요</p>';
    for (const c of $('bbList').querySelectorAll('[data-bid]')) { itemIcon(c.querySelector('canvas'), c.dataset.bid); c.onclick = () => { build.id = c.dataset.bid; renderBuildTray(); near = null; }; }
    for (const b of document.querySelectorAll('#buildBar [data-shape]')) { b.setAttribute('aria-pressed', String(b.dataset.shape === build.shape)); b.disabled = cat === 'trap' || cat === 'deco'; }
  }
  for (const b of document.querySelectorAll('#buildBar [data-shape]')) b.addEventListener('click', () => { build.shape = b.dataset.shape; renderBuildTray(); near = null; });
  $('buildOff').addEventListener('click', () => setBuild(false));
  // 우리 저장소 창
  let STORE_TAB = 'all';
  function resIcon(cv, kind) { // 저장소 재료 그림 (직접 그림)
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, cv.width, cv.height); g.save(); g.translate(cv.width / 2, cv.height / 2); g.scale(2, 2);
    if (kind === 'coin') { g.fillStyle = '#2b2340'; pxDisc(g, 0, 0, 10); g.fillStyle = '#b8862b'; pxDisc(g, 0, 0, 8); g.fillStyle = '#ffd84d'; pxDisc(g, -1, -1, 7); g.fillStyle = '#fff6c8'; g.fillRect(-4, -5, 4, 2); g.fillStyle = '#b8862b'; g.fillRect(-1, -4, 2, 8); }
    if (kind === 'army') { g.fillStyle = '#2b2340'; g.fillRect(-2, -12, 4, 18); g.fillStyle = '#e8ecf4'; g.fillRect(-1, -11, 2, 15); g.fillStyle = '#e8c260'; g.fillRect(-6, 4, 12, 3); g.fillStyle = '#8a5a2b'; g.fillRect(-1, 7, 2, 5); g.fillStyle = '#ffd84d'; g.fillRect(-2, 11, 4, 2); }
    if (kind === 'wood') { for (const [x, y] of [[-6, 2], [4, 2], [-1, -6]]) { g.fillStyle = '#2b2340'; g.fillRect(x - 6, y - 4, 12, 9); g.fillStyle = '#9a6a3a'; g.fillRect(x - 5, y - 3, 10, 7); g.fillStyle = '#e0aa6a'; pxDisc(g, x + 3, y, 3); g.fillStyle = '#b07a44'; g.fillRect(x + 2, y - 1, 2, 2); } }
    if (kind === 'vaccine') { g.restore(); g.save(); g.drawImage(ICON.vaccine, 0, 0, 16, 16, cv.width / 2 - 24, cv.height / 2 - 24, 48, 48); }
    g.restore();
  }
  function openStore() { // 우리 저장소: 재료 4개는 크게, 물건은 그림 카드로 (종류 탭)
    const me = myView && myView.me; if (!me) return;
    const sa = $('storeArt'), sg = sa.getContext('2d'); sg.imageSmoothingEnabled = false; const grd = sg.createLinearGradient(0, 0, 0, 120); grd.addColorStop(0, '#bfe6ff'); grd.addColorStop(1, '#e9f7d8'); sg.fillStyle = grd; sg.fillRect(0, 0, 120, 120);
    const key = STORE_ART[(nationsPub[MY_NID] && nationsPub[MY_NID].storeLv) | 0], im = ART['x_' + key]; if (im) { const k = Math.min(100 / im.width, 90 / im.height); sg.drawImage(im, 60 - im.width * k / 2, 110 - im.height * k, im.width * k, im.height * k); }
    $('storeName').textContent = `${natName(MY_NID)} 저장소`;
    $('storeRes').innerHTML = [['coin', '코인', me.coin], ['army', '병력', me.army], ['wood', '목재', me.wood], ['vaccine', '백신', me.vaccine]].map(([k, l, v]) => `<div class="stR"><canvas data-res="${k}" width="56" height="56"></canvas><span>${l}</span><b>${(v || 0).toLocaleString()}</b></div>`).join('');
    for (const c of $('storeRes').querySelectorAll('[data-res]')) resIcon(c, c.dataset.res);
    const TABS = [['all', '전체'], ['build', '🏗 건축'], ['farm', '🌱 농사'], ['crop', '🧺 작물']];
    const inTab = (b) => STORE_TAB === 'all' || (STORE_TAB === 'build' ? ['floor', 'wall', 'deco', 'trap'].includes(b.cat) : STORE_TAB === 'farm' ? FARM_CATS.has(b.cat) : b.cat === 'crop');
    $('storeTabs').innerHTML = TABS.map(([k, l]) => `<button type="button" data-st="${k}" aria-pressed="${k === STORE_TAB}">${l}</button>`).join('');
    for (const b of $('storeTabs').querySelectorAll('[data-st]')) b.onclick = () => { STORE_TAB = b.dataset.st; openStore(); };
    const own = MPRules.BUILD.filter((b) => (me.items[b.id] || 0) > 0 && inTab(b));
    $('storeBody').innerHTML = own.length ? own.map((b) => `<div class="stItem"><canvas data-ico="${b.id}" width="64" height="64"></canvas><span>${b.name}</span><i>${me.items[b.id]}</i></div>`).join('') : `<p class="stEmpty">${STORE_TAB === 'crop' ? '아직 수확한 작물이 없어요 · 밭에서 키워 보세요' : '아직 없어요 · 하늘 천상 상점가에서 사요'}</p>`;
    for (const c of $('storeBody').querySelectorAll('[data-ico]')) itemIcon(c, c.dataset.ico);
    $('storeBox').hidden = false;
  }
  $('storeBuild').addEventListener('click', () => { $('storeBox').hidden = true; setBuild(true); });
  $('storeClose').addEventListener('click', () => { $('storeBox').hidden = true; });
  $('shopClose').addEventListener('click', () => { $('shopBox').hidden = true; });
  const setChatTuck = (on) => { document.body.classList.toggle('chatTuck', on); $('chatTab').hidden = true; if (on) setTimeout(() => { if (document.body.classList.contains('chatTuck')) $('chatTab').hidden = false; }, 270); store('mp2026.chatTuck', on ? 1 : 0); setTimeout(placeBuildBar, 280); }; // 다 들어간 뒤에 꺼내는 버튼
  $('chatHide').addEventListener('click', () => setChatTuck(true)); $('chatTab').addEventListener('click', () => setChatTuck(false));
  if (store('mp2026.chatTuck')) setTimeout(() => setChatTuck(true), 0);
  $('ruleClose').addEventListener('click', () => { $('rulebook').hidden = true; });
  renderRulebook();
  function interact() {
    if (!near) return;
    if (near.kind === 'store') { openStore(); return; }
    if (near.kind === 'shop') { openShop(); return; }
    if (near.kind === 'npc') { openTalk(near.npc); return; }
    if (near.kind === 'bail') { if (netOn) ws.send(JSON.stringify({ t: 'bailList' })); return; }
    if (near.kind === 'hit') { HITFX.set(near.t.id, performance.now() + 120); if (netOn) ws.send(JSON.stringify({ t: 'hit', terr: near.t.id })); return; }
    if (near.kind === 'pickB') { build.moving = near.what; near = null; toast('옮길 자리 바로 앞에서 E를 누르세요 (우리 땅, 다른 건물과 2칸 이상)'); return; }
    if (near.kind === 'dropB') { if (netOn) ws.send(JSON.stringify(Object.assign({ t: 'moveB', x: near.x, y: near.y }, build.moving))); build.moving = null; near = null; return; }
    if (near.kind === 'place' || near.kind === 'pickup') { if (netOn) ws.send(JSON.stringify({ t: near.kind, tiles: near.tiles, id: build.id })); return; }
    if (near.kind === 'plant' || near.kind === 'fert' || near.kind === 'harvest') { if (netOn) ws.send(JSON.stringify({ t: near.kind, tiles: near.tiles, id: build.id })); SND.play(near.kind === 'harvest' ? 'coin' : 'place'); return; }
    if (near.kind === 'info') { toast(near.text); return; }
    if (near.kind === 'reinforce') { openReinforce(near.battle); return; }
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
      else if (ONLINE) toast(RIFT_NEXT ? `[신탁] ${RIFT_NEXT.day}일차 아침, 균열이 ${RIFT_NEXT.terrs.length}곳을 삼킨다. 나라 창(B)에서 백신을 써라.` : '[신탁] 다음 균열을 기다리는 중…');
      else toast(`[신탁] 다음 균열이 다가온다… ${TYPES[DAY % 6]} 지방을 조심하라.`);
    }
  }

  const homePortal = () => MPRules.portalSpot(home, tileAt); // 천도한 수도는 지도에 정해진 포털이 없을 수 있음
  function goHome() {
    if (player.scene === 'sky') { descend(); return; }
    const hp = homePortal();
    player.x = hp[0] * TILE + 16; player.y = (hp[1] + 1) * TILE + 16;
    if (!free(player.x, player.y, null)) teleportTo(hp[0], hp[1] + 1);
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
      const i = y * W + x, t = GCLEAR.has(i) && terrain[i] === T.MOUNTAIN ? T.GRASS : terrain[i], o = terr[i];
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
        else if (RIFT_SET.has(o) && ((x + y) % 4 === 0)) c3 = [150, 60, 220]; // 다음 균열 예고 (보라 빗금)
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
    for (const b of BATTLES) if (b.f) for (const [fx, fy] of b.f) { const bx = (fx + 0.5 - tx + span / 2) * k, by = (fy + 0.5 - ty + span / 2) * k; if (bx > 0 && by > 0 && bx < s && by < s) { mg.fillStyle = '#2b2340'; mg.fillRect(bx - 5, by - 5, 10, 10); mg.fillStyle = '#ff3355'; mg.fillRect(bx - 3, by - 3, 6, 6); } } // 전선
    pix(mg, 'pin', s / 2, s / 2 + 2, 0, 34);
  }
  function teleportTo(tx, ty) {
    for (let r = 0; r < 30; r++) for (let a = 0; a < 16; a++) {
      const x = Math.round(tx + Math.cos(a / 16 * Math.PI * 2) * r), y = Math.round(ty + Math.sin(a / 16 * Math.PI * 2) * r);
      if (!blocked(x, y)) { netTp = true; step.on = false; player.scene = 'ground'; player.room = null; lastTerr = null; player.x = x * TILE + 16; player.y = y * TILE + 16; return true; }
    }
    return false;
  }
  const canTp = () => !ONLINE || testMode || EDIT.on; // 지도 눌러 순간이동: 미리보기·테스트 모드·맵 고치기에서만
  mini.addEventListener('click', (e) => {
    if (!canTp()) return;
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
    const px = player.scene === 'sky' ? MPRules.portalSpot(player.entry || home, tileAt)[0] * TILE : player.x, py = player.scene === "sky" ? MPRules.portalSpot(player.entry || home, tileAt)[1] * TILE : player.y;
    pix(bg, 'pin', px / TILE * k, py / TILE * k + 2, 0, 40);
  }
  function toggleMap(force) {
    const el = $('bigmap');
    el.hidden = force !== undefined ? !force : !el.hidden;
    if (!el.hidden) drawBig();
  }
  big.addEventListener('click', (e) => {
    const r = big.getBoundingClientRect();
    if (canTp() && teleportTo((e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H)) toggleMap(false);
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
    const all = CHARS.names.map((n, j) => ['na', n, j]); // 싸움 모션(걷기 4방향 + 공격)이 있는 캐릭터만
    all.forEach(([kind, name, j]) => { const i = j + USER.chars.length;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'facebtn';
      b.setAttribute('aria-label', name);
      const cv = document.createElement('canvas'); cv.width = 38; cv.height = 38; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
      if (kind === 'u') { const im = userSprite(name, player.look.hue | 0); const sc = Math.min(36 / im.width, 36 / im.height); g.drawImage(im, (38 - im.width * sc) / 2, 38 - im.height * sc, im.width * sc, im.height * sc); }
      else g.drawImage(cleanFace(j), 0, 0, 40, 40, -1, -1, 40, 40);
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
  function closetPreview() { // 고른 캐릭터를 크게: 4방향 걷기 + 공격 동작이 돌아가며
    const cv = $('closetPrev'); if (!cv || $('closet').hidden) return;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, cv.width, cv.height);
    const c = (player.look.char | 0) - USER.chars.length, t = performance.now() / 1000;
    if (c < 0) drawSprite(g, 64, 104, Object.assign({}, player.look, { me: false }), t, true, 0);
    else { const sheet = charSheet(c, player.look.hue | 0), ph = Math.floor(t / 1.2) % 5, dir = [0, 3, 1, 2, 3][ph], row = ph === 4 ? 4 : Math.floor(t * 8) % 4; g.drawImage(sheet, dir * 16, row * 16, 16, 16, 16, 8, 96, 96); }
    requestAnimationFrame(closetPreview);
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
  $('nickBtn').addEventListener('click', () => { // 이름 바꾸기: 여신이 나와서 새 이름을 물어봄
    if (renamesLeft <= 0) { toast('이름은 더 바꿀 수 없어요'); return; }
    $('closet').hidden = true; startOpening('rename');
  });
  $('btnCloset').addEventListener('click', () => { $('nick').value = player.name; $('nickMsg').textContent = ''; renderNameBox(); closetUI(); $('closet').hidden = false; closetPreview(); });
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
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev) => { try { if (typeof ev.data === 'string') onNet(JSON.parse(ev.data)); else onPositions(new DataView(ev.data)); } catch (e) { /* 무시 */ } };
    ws.onclose = () => { netOn = false; remotes.clear(); setNet('연결이 끊겼어요 · 다시 연결하는 중…'); setTimeout(connect, 2000); };
  }
  // 주변 사람 위치 (서버가 이진으로 보냄): [1][접속자 u16] + [id u32][x u16][y u16][방향·걷기·얼굴] × n
  function onPositions(v) {
    if (v.getUint8(0) !== 1) return;
    onlineCount = v.getUint16(1, true);
    for (let q = 3; q + 9 <= v.byteLength; q += 9) {
      const id = v.getUint32(q, true), x = v.getUint16(q + 4, true), y = v.getUint16(q + 6, true), f = v.getUint8(q + 8);
      const r = remotes.get(id); if (!r) continue;
      if (r.x == null || Math.hypot(x - r.x, y - r.y) > 400) { r.x = x; r.y = y; }
      r.tx = x; r.ty = y; r.dir = f & 1 ? -1 : 1; r.moving = !!(f & 2); r.face = (f >> 2) & 3;
    }
    setNet(`접속 중 ${onlineCount}명`);
  }
  function onNet(m) {
    switch (m.t) {
      case 'welcome': {
        myId = m.id; netOn = true; store('mp2026.token', m.token);
        if (m.bgm) { SND.setFiles(m.bgm.files); BGM_CUR = m.bgm.cur && m.bgm.cur.startsWith('f:') ? 'f:/bgm/' + m.bgm.cur.slice(2) : (m.bgm.cur || 'peace'); }
        if (m.name) { player.name = m.name; nameSet = !!m.nameSet; renamesLeft = m.renamesLeft; tagW.clear(); renderNameBox(); }
        player.carry = m.carry || null; player.look.red = m.red | 0; jailUntil = m.jailUntil || 0;
        if (m.roomEdits) for (const [id, e] of Object.entries(m.roomEdits)) applyRoomEdit(id, e);
        if (m.groundEdits) { GFLOOR.clear(); GWALL.clear(); GCLEAR.clear(); GPROPS.clear(); applyGroundEdit({ set: m.groundEdits.floor, walls: m.groundEdits.walls, clear: m.groundEdits.clear, props: m.groundEdits.props }); invalidateChunks(); mapSig = ''; }
        if (m.clock) setClock(m.clock); BATTLES = m.battles || []; applyMines(m.mines || {}); TILES = m.tiles || {}; MY_TRAPS = new Set(m.traps || []); for (const i of m.chopped || []) noTree[i] = 1; if (m.stun) stunUntil = performance.now() + m.stun;
        testMode = !!m.testMode; foundingOpen = m.foundingOpen !== false; applyWorld(m.owners, m.nations, m.view || null); showNotice(m.notice); unseenBattles();
        needFound = !m.view; if (!m.view) { if (titleDone) openFound('who'); } else $('found').hidden = true;
        chatLog = m.chat || []; renderChat();
        wanderList = m.wander || [];
        const p = m.pos;
        if (p && p.scene === 'sky' && ROOMS[p.room]) { player.scene = 'sky'; player.room = ROOMS[p.room]; player.x = p.x; player.y = p.y; player.skyLeft = SKY_LIMIT; }
        else if (p && p.x != null && free(p.x, p.y, null)) { player.scene = 'ground'; player.room = null; player.x = p.x; player.y = p.y; }
        else goHome();
        lastTerr = null; netTp = true;
        requestAnimationFrame(() => requestAnimationFrame(hideLoading)); // 새 자리 화면을 한 번 그린 뒤 로딩 끄기
        break;
      }
      case 'meta': {
        const q = m.p;
        if (q.id === myId) { player.carry = q.carry ? (player.carry || {}) : null; player.look.red = q.red | 0; player.badge = q.badge || ''; break; }
        let r = remotes.get(q.id);
        if (!r) { r = { x: null, y: null, tx: null, ty: null, dir: 1, moving: false, emote: null, emoteT: 0 }; remotes.set(q.id, r); }
        r.name = q.name; r.team = q.team; r.tag = teamColor(q.team);
        r.look = Object.assign({ seed: (q.id * 0.37) % 3 }, q.look, { red: q.red | 0 });
        r.nid = q.nid; r.carry = q.carry; r.jailed = q.jailed; r.badge = q.badge || '';
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
        setNet(`접속 중 ${onlineCount}명`);
        break;
      case 'chat': {
        chatLog.push(m); if (chatLog.length > 80) chatLog.shift(); renderChat();
        { const r = m.from === myId ? player : remotes.get(m.from); if (r) { r.emote = (m.ch === 'team' ? '[팀] ' : '') + (m.text.length > 26 ? m.text.slice(0, 25) + '…' : m.text); r.emoteT = 4.5; } } // 말풍선 (팀 채팅은 서버가 팀원에게만 보내므로 팀원에게만 보임)
        break;
      }
      case 'chatErr': toast(m.text); break;
      case 'warStart': warBanner(`⚔ 영역전 시작 ⚔`); break;
      case 'warCast': WAR = m.war; if (m.live && WAR && !WAR.reports.some((r) => MY_NID && (r.att === MY_NID || r.def === MY_NID))) setTimeout(() => toast(`⚔ 영역전 ${WAR.reports.length}건이 끝났어요 · 위의 [⚔ 영역전]에서 중계를 볼 수 있어요`), 3600); if (!$('warCast').hidden) openWarCast(); break;
      case 'bgm': SND.setFiles(m.files); BGM_CUR = m.cur && m.cur.startsWith('f:') ? 'f:/bgm/' + m.cur.slice(2) : (m.cur || 'peace'); if (titleDone && !TITLE.on && !OP.on) SND.bgm(BGM_CUR); break;
      case 'emote': { const r = m.id === myId ? player : remotes.get(m.id); if (r) { r.emote = m.text; r.emoteT = 3; } break; }
      case 'wander': wanderList = m.list || []; renderWander(); break;
      case 'owners': setErosion(m.erosion); if ('riftNext' in m) { RIFT_NEXT = m.riftNext; RIFT_SET = new Set(RIFT_NEXT ? RIFT_NEXT.terrs : []); } if (m.gone) setGone(m.gone); if (m.battles) BATTLES = m.battles; if (m.mines) applyMines(m.mines); applyWorld(m.owners, m.nations); if (!$('found').hidden && foundSel !== undefined && !document.querySelector('#found [data-step=found]').hidden) drawFoundMap(); break;
      case 'joined': chatLog = m.chat || []; renderChat(); afterFounded(m.founded); break;
      case 'view': applyWorld(null, null, m.view); break;
      case 'night': applyWorld(null, null, m.view); showNight(m.reports || []); break;
      case 'puzzle': showPuzzle(m); break;
      case 'answer': if (curPuzzle && m.id === curPuzzle.id) puzzleResult(m.correct, m.text, m.done); break; // 예전 퍼즐의 늦은 답은 무시
      case 'left': myView = null; MY_NID = null; mapSig = ''; toast(m.text); if (!$('war').hidden) renderWar(); break;
      case 'err': if (!$('puzzle').hidden) puzzleResult(false, m.text); toast(m.text); if (!$('war').hidden) renderWar(); break;
      case 'ok': toast(m.text); break;
      case 'name': {
        if (m.ok) { player.name = m.name; nameSet = true; renamesLeft = m.left; tagW.clear(); store('mp2026.look', Object.assign(store('mp2026.look') || {}, { name: m.name })); $('fMsg').textContent = ''; renderNameBox(); if (nameNext) { const f = nameNext; nameNext = null; f(); } else toast(`이름을 '${m.name}'(으)로 바꿨어요 · 남은 변경 ${m.left}번`); }
        else { nameNext = null; if (!$('found').hidden) $('fMsg').textContent = m.text; else { $('nickMsg').textContent = m.text; toast(m.text); } }
        break;
      }
      case 'redeem': $('couponMsg').textContent = m.text; if (m.ok) $('couponIn').value = ''; break;
      case 'tile': { const prev = TILES[m.i]; if (m.e && prev && m.e.hp != null && m.e.hp < (prev.hp ?? MPRules.NUM.buildHp)) { HPSEEN.set(m.i, performance.now()); SND.play('hit'); } else if (m.e && m.e.n === MY_NID && !prev) SND.play('place'); const wasW = prev && prev.k === 'water', isW = m.e && m.e.k === 'water'; if (m.e) TILES[m.i] = m.e; else delete TILES[m.i]; dirtyTile(m.i); if (wasW || isW) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx || dy) dirtyTile(m.i + dy * W + dx); break; } // 수로가 바뀌면 이웃 밭·수로 다시 그림
      case 'trap': if (m.on) MY_TRAPS.add(m.i); else MY_TRAPS.delete(m.i); break;
      case 'chopped': noTree[m.i] = 1; dirtyTile(m.i); SND.play('chop'); break;
      case 'hitfx': HITFX.set(m.terr, performance.now() + 120); break;
      case 'clock': setClock(m); break;
      case 'roomEdit': if (m.diff) applyRoomDiff(m.id, m.diff); else applyRoomEdit(m.id, m.edit); break;
      case 'groundEdit': applyGroundEdit(m); break;
      case 'rift': toast(m.text); break;
      case 'hitn': HITN.set(m.terr, { n: m.n, at: performance.now() }); near = null; SND.play('hit'); break;
      case 'scout': HITN.delete(m.terr); toast(m.text); SND.play('ok'); break;
      case 'stun': stunUntil = performance.now() + m.ms; step.on = false; toast(m.text); break;
      case 'pos': player.x = m.x; player.y = m.y; step.on = false; netTp = true; if (m.text) toast(m.text); break;
      case 'bailList': {
        $('bailBody').innerHTML = m.list.length ? `<p class="msg">나라 코인 ${m.coin}</p>` + m.list.map((p) => `<div class="row"><span>${esc(p.name)} · 남은 ${p.left}분 · 악명 ${p.bad}</span><button data-bail="${p.idx}">보석금 ${p.bail}</button></div>`).join('') : '<p class="msg">감옥에 있는 우리 팀원이 없어요.</p>';
        for (const b of $('bailBody').querySelectorAll('[data-bail]')) b.onclick = () => { ws.send(JSON.stringify({ t: 'bail', idx: +b.dataset.bail })); $('bailBox').hidden = true; };
        $('bailBox').hidden = false; break;
      }
      case 'mined': mined.add(m.terr); toast(m.text); SND.play('coin'); break;
      case 'warp': { const p = m.pos; if (p.scene === 'sky' && ROOMS[p.room]) { player.scene = 'sky'; player.room = ROOMS[p.room]; if (build.on) setBuild(false); } else { player.scene = 'ground'; player.room = null; } player.x = p.x; player.y = p.y; step.on = false; hold.on = false; fadeT = 0.35; lastTerr = null; break; }
      case 'carry': player.carry = m.carry; toast(m.text); SND.play(m.carry ? 'steal' : 'coin'); break;
      case 'arrested': player.carry = null; jailUntil = m.jailUntil || 0; toast(m.text); SND.play('arrest'); break;
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
      const k = Math.min(1, dt * 7); // 위치는 초당 5번 오므로 그 사이를 부드럽게 이어 그림
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
  const CH_NAME = { team: '팀', near: '주변', sky: '하늘', jail: '감옥' };
  let chatCh = 'auto'; // auto = 땅이면 주변, 하늘이면 하늘
  const curCh = () => (chatCh === 'team' ? 'team' : jailUntil > Date.now() ? 'jail' : player.scene === 'sky' ? 'sky' : 'near');
  function renderChatTabs() {
    for (const b of document.querySelectorAll('#chatTabs [data-ch]')) b.setAttribute('aria-pressed', String((b.dataset.ch === 'team') === (chatCh === 'team')));
    const c = curCh(); const auto = $('chatTabs').querySelector('[data-ch="auto"]'); if (auto) auto.textContent = CH_NAME[c === 'team' ? (player.scene === 'sky' ? 'sky' : 'near') : c];
    $('chatIn').placeholder = `${CH_NAME[c]} 채팅 (Enter · Tab으로 바꾸기)`;
  }
  function renderChat() {
    const box = $('chatLog');
    box.textContent = '';
    for (const m of chatLog.slice(-30)) {
      const line = document.createElement('div'); line.className = 'ch-' + (m.ch && m.ch.startsWith('nation:') ? 'team' : m.ch || 'team');
      const tag = document.createElement('i'); tag.textContent = `[${CH_NAME[m.ch && m.ch.startsWith('nation:') ? 'team' : m.ch] || '팀'}] `; line.appendChild(tag);
      const who = document.createElement('b'); who.textContent = m.name + ' '; line.appendChild(who);
      line.appendChild(document.createTextNode(m.text));
      box.appendChild(line);
    }
    box.scrollTop = box.scrollHeight;
  }
  function sendChat() {
    const el = $('chatIn'); const text = el.value.trim();
    if (!text || !netOn) return;
    ws.send(JSON.stringify({ t: 'chat', text, ch: curCh() === 'jail' ? 'near' : curCh() })); el.value = '';
  }
  for (const b of document.querySelectorAll('#chatTabs [data-ch]')) b.addEventListener('click', () => { chatCh = b.dataset.ch; renderChatTabs(); $('chatIn').focus(); });

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
  function hideLoading() { const L = $('loading'); if (L.hidden) return; L.classList.add('out'); setTimeout(() => { L.hidden = true; L.classList.remove('out'); }, 250); if (!EDIT_MODE) startTitle(); else { titleDone = true; if (needFound) openFound('who'); } }
  function startOnline() {
    $('help').hidden = true; $('chat').hidden = false;
    setNet('서버에 연결하는 중…');
    connect();
  }
  $('chatIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { sendChat(); } if (e.key === 'Escape') e.target.blur(); if (e.key === 'Tab') { e.preventDefault(); chatCh = chatCh === 'team' ? 'auto' : 'team'; renderChatTabs(); } });
  $('chatIn').addEventListener('focus', renderChatTabs);
  $('chatIn').addEventListener('focus', () => keys.clear());
  $('btnChatSend').addEventListener('click', sendChat);

  // ------------------------------------------------------------ 나라 · 영토 · 블로토 전투 (화면)
  // 온라인: 서버가 결과를 정한다 / 오프라인 미리보기: 같은 규칙(rules.js)을 브라우저에서 봇 나라들과 돌린다
  let OFF = null;                  // 오프라인 World
  let owners = {}, nationsPub = {}, myView = null, testMode = true, MY_NID = null, mapSig = ''; // MY_NID: 우리 나라 (지도에서 진하게 표시)
  const ownerOf = (tid) => owners[tid] || null;
  const natColor = (nid) => (nationsPub[nid] && nationsPub[nid].color) || '#888888';
  const natName = (nid) => (nationsPub[nid] && nationsPub[nid].name) || '중립';
  const terrLabel = (tid) => (terrs[tid] ? `${terrs[tid].name}` : `#${tid}`);

  function applyWorld(o, n, v) {
    if (o) owners = o;
    if (n) nationsPub = n;
    if (v !== undefined) myView = v;
    if (v !== undefined && build.on) renderBuildTray(); // 설치 모드: 남은 개수 갱신
    MY_NID = myView ? myView.me.id : null;
    STORE_AT = new Map();
    for (const n of Object.values(nationsPub)) if (!n.dead && terrs[n.capital]) for (const [sx, sy] of (n.stores && n.stores.length ? n.stores : [n.store || MPRules.storageSpot(terrs[n.capital], tileAt)])) { STORE_AT.set(sy * W + sx, n.id); clearTrees(sx, sy, 1); } // 저장소 입구 (여러 개일 수 있음)
    if (myView && terrs[myView.me.capital]) { home = terrs[myView.me.capital]; player.tag = myView.me.color; }
    // 땅 주인·나라 색·우리 나라가 바뀐 경우에만 지도를 다시 그린다 (자원만 바뀌면 그대로)
    const sig = MY_NID + '|' + JSON.stringify(owners) + '|' + (RIFT_NEXT ? RIFT_NEXT.wave + ':' + RIFT_NEXT.terrs.length : '') + '|' + Object.values(nationsPub).map((q) => q.id + q.color + (q.dead ? 'x' : '')).join();
    if (sig !== mapSig) { mapSig = sig; invalidateChunks(); buildMapImage(); }
    lastTerr = null; renderInv();
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
    $('warAlertNote').textContent = myView.me.isKing ? `${nextFight()} 전투 전에 전선마다 방어 병력을 나눠 두세요 (전선마다 최소 20%).` + ' 안 하면 자동으로 나눠져요.' : '왕에게 알려서 방어 배치를 하게 하세요. 그 땅에 서 있으면 지휘관 보너스도 생겨요.';
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
      const total = Math.min(b.army, 30 + ((hash(b.team, OFF.s.night) * 50) | 0)), F = OFF.frontCount(OFF_ME);
      const r = Array.from({ length: F }, (_, i) => 0.5 + hash(b.team, i + 1, OFF.s.night));
      const tr = r.map((v) => Math.floor(total * v / r.reduce((x, y) => x + y, 0)));
      OFF.declare(b.id, tgt, tr, null);
    }
  }

  // 행동 보내기 (온라인: 서버로 / 오프라인: 바로 적용)
  function warAction(t, payload) {
    if (ONLINE) { if (netOn) ws.send(JSON.stringify(Object.assign({ t }, payload))); return; }
    if (t === 'kingTo') { toast('미리보기에선 왕을 넘길 국민이 없어요'); return; }
    if (!OFF_ME && t !== 'resolveNow') { toast('나라가 없어요 · 유랑민 등록소에서 귀화나 건국을 하세요'); return; }
    let r;
    if (t === 'claim') r = OFF.claim(OFF_ME, payload.terr);
    else if (t === 'declare') r = OFF.declare(OFF_ME, payload.terr, payload.troops, null);
    else if (t === 'defend') r = OFF.defend(OFF_ME, payload.battle, payload.troops);
    else if (t === 'reinforce') r = OFF.reinforce(OFF_ME, payload.battle, payload.front, payload.amount);
    else if (t === 'moveCapital') r = OFF.moveCapital(OFF_ME, payload.terr, Date.now());
    else if (t === 'setRace') r = OFF.setRace(OFF_ME, payload.race);
    else if (t === 'defaultDef') r = OFF.setDefault(OFF_ME, payload.ratio);
    else if (t === 'intel') r = OFF.useIntel(OFF_ME, payload.battle);
    else if (t === 'resolveNow') return offNight();
    if (!r.ok) { toast(r.err); return; }
    toast(t === 'claim' ? `${terrLabel(payload.terr)}을(를) 점령했어요` : t === 'declare' ? `선전포고 완료 · ${nextFight()}에 결과가 나와요` : t === 'cancel' ? '선전포고를 취소했어요' : '방어 배치 저장');
    offSync();
  }
  function offNight() {
    const reps = OFF.resolveAll();
    for (const n of OFF.alive()) { n.army += n.id === OFF_ME ? 0 : 30; n.actions = n.id === OFF_ME ? 10 : 99; }
    botsDeclare();
    offSync();
    showNight(reps.filter((r) => r.att === OFF_ME || r.def === OFF_ME));
  }
  function showNight(reps) {
    if (!reps.length) return;
    setTimeout(() => playBattles(reps, () => {
      warTab = 'report'; $('war').hidden = false; renderWar();
      const w = reps.filter((r) => (r.winner === 'att') === (r.att === myView.me.id)).length; toast(`전투 결과: ${reps.length}전 ${w}승`);
    }), ONLINE ? 3200 : 0);
  }
  // 다음 전투 시각 (13시·22시, 한국 시간)
  function nextFight() { if (ONLINE) return SLOT === 'morning' ? '오늘 점심 1시' : SLOT === 'lunch' ? '오늘 밤 10시' : '내일 점심 1시'; const h = new Date(Date.now() + 9 * 3600e3).getUTCHours(); return h < 13 ? '오늘 13시' : h < 22 ? '오늘 22시' : '내일 13시'; }
  // ---- 전투 장면 (한눈에 보이게): 위 = 점수판(두 나라 · 이긴 전선 수 · 몇 곳 이기면 승리),
  // 가운데 = 전선마다 한 줄(병사 · 병력 숫자 · 결과), 한 줄씩 차례로 싸움. 이펙트는 pixelfx. 화면을 누르면 결과로 건너뜀
  const BT = { list: [], i: 0, t0: 0, done: null, raf: 0, fx: [], fired: {}, frame: null, img: null, off: null };
  const RACE_INFO = { human: { name: '인간', weapon: '검', icon: '⚔', ch: 35 }, elf: { name: '엘프', weapon: '활', icon: '🏹', ch: 37 }, dwarf: { name: '드워프', weapon: '도끼', icon: '🪓', ch: 21 } }; // ch = aether.png 캐릭터 번호
  const raceOf = (nid) => (nationsPub[nid] && nationsPub[nid].race) || 'human';
  // pixelfx: 처음 전투를 볼 때 한 번만 불러옴 (assets/pixelfx, MIT)
  let PFX = null, pfxLoading = null;
  function loadPfx() {
    if (PFX || pfxLoading) return pfxLoading;
    const B = 'assets/pixelfx/';
    pfxLoading = Promise.all([import('./' + B + 'core/index.js'), ...['melee/sword-slash', 'melee/heavy-cleave', 'projectiles/arrow', 'impacts/crit-hit', 'impacts/hit-spark', 'ui/confetti', 'spawn/poof'].map((n) => import('./' + B + 'fx/' + n + '.js'))])
      .then(([core, slash, cleave, arrow, crit, spark, confetti, poof]) => { PFX = { core, slash, cleave, arrow, crit, spark, confetti, poof }; }).catch(() => { PFX = null; });
    return pfxLoading;
  }
  let FXS = 2; // 이펙트 도트 크기 (화면 2px = 이펙트 1칸, 전선이 많아 줄이 얇으면 1)
  function addFx(name, x, y, o = {}) { if (!PFX || !PFX[name]) return; BT.fx.push(PFX.core.createFx(PFX[name], Object.assign({ x: x / FXS, y: y / FXS }, o))); }
  function playBattles(reps, done) {
    const seen = new Set(store('mp2026.battleSeen') || []);
    BT.list = reps.slice(); BT.i = 0; BT.done = done; SND.play('war');
    store('mp2026.battleSeen', [...seen, ...reps.map((r) => r.id)].slice(-80));
    $('battle').hidden = false; loadPfx(); startBattle();
  }
  // 접속했을 때 아직 못 본 지난 전투가 있으면 보여 준다
  function unseenBattles() {
    if (!myView || !myView.reports || !myView.reports.length) return;
    const seen = new Set(store('mp2026.battleSeen') || []);
    const last = Math.max(...myView.reports.map((r) => r.night));
    const reps = myView.reports.filter((r) => r.night === last && !seen.has(r.id));
    if (reps.length) setTimeout(() => playBattles(reps, () => {}), 600);
  }
  // 줄마다 싸우는 시각: 0.8초부터 차례로 (전선이 많으면 빨리)
  const btStep = (F) => Math.min(0.55, 3.2 / F), btAt = (F, i) => 0.8 + i * btStep(F), btEnd = (r) => btAt(r.fronts.length, r.fronts.length - 1) + 1.0;
  function startBattle() {
    const r = BT.list[BT.i]; BT.t0 = performance.now(); BT.fx = []; BT.fired = {}; FXS = r.fronts.length > 8 ? 1 : 2; BT.frame = null;
    const F = r.fronts.length, need = Math.floor(F / 2) + 1;
    const me = myView && myView.me ? myView.me.id : null, side = r.att === me ? 'att' : r.def === me ? 'def' : null;
    const ra = RACE_INFO[raceOf(r.att)], rd = RACE_INFO[raceOf(r.def)];
    $('btHead').innerHTML = `
      <div class="team a" style="--c:${natColor(r.att)}"><small>공격</small><b>${esc(r.attName)}</b><i>${ra.icon} ${ra.name}</i></div>
      <div class="score"><div class="sc"><span id="scA">0</span><em>:</em><span id="scD">0</span></div>
        <div class="pips">${r.fronts.map((_, k) => `<i data-pip="${k}"></i>`).join('')}</div>
        <small>${esc(terrLabel(r.target))}${r.capital ? ' (수도)' : ''} · 전선 ${F}곳 중 <b>${need}곳</b>을 먼저 이기면 승리</small></div>
      <div class="team d" style="--c:${natColor(r.def)}"><small>방어 · 병력 ×1.1</small><b>${esc(r.defName)}</b><i>${rd.icon} ${rd.name}</i></div>`;
    const cols = F <= 8 ? 1 : 2;
    $('btRows').style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    $('btRows').style.gridTemplateRows = `repeat(${Math.ceil(F / cols)}, 1fr)`;
    $('btRows').innerHTML = r.fronts.map((w, k) => `<div class="frow" data-row="${k}" style="grid-column:${Math.floor(k / Math.ceil(F / cols)) + 1};grid-row:${k % Math.ceil(F / cols) + 1}">
      <b class="fl">${MPRules.frontName(k)}</b><span class="na">${r.a[k]}</span><span class="vs">VS</span><span class="nd">${r.effD[k]}</span></div>`).join('');
    const lost = (r.lost || []).length, won = side ? r.winner === side : null;
    $('btSum').hidden = true;
    $('btSum').innerHTML = `<div class="big ${r.winner}">${r.winner === 'att' ? '⚔ 공격 승리' : '🛡 방어 승리'}</div>
      <div class="line">${r.winner === 'att' ? `<b>${esc(r.attName)}</b>이(가) 영역 <b>${lost || 1}곳</b>을 차지했어요` : `<b>${esc(r.defName)}</b>이(가) 영역을 지켜 냈어요${r.prisoners ? ` · 포로 ${r.prisoners}명` : ''}`}${r.newCapital ? ' · 수도 함락, 강제 천도' : ''}${r.destroyed ? ' · <b>나라 멸망</b>' : ''}</div>
      <div class="loss">잃은 병력 · ${esc(r.attName)} −${r.lossA} · ${esc(r.defName)} −${r.lossD}</div>${won === null ? '' : `<div class="me ${won ? 'w' : 'l'}">${won ? '우리 나라 승리!' : '우리 나라 패배…'}</div>`}`;
    $('btNext').textContent = BT.i < BT.list.length - 1 ? `다음 전투 (${BT.i + 2}/${BT.list.length})` : '닫기';
    $('btNext').onclick = (e) => { e.stopPropagation(); nextBattle(); };
    cancelAnimationFrame(BT.raf); let prev = performance.now();
    const loop = (now) => { const dt = Math.min(0.05, (now - prev) / 1000); prev = now; drawBattle(r, (now - BT.t0) / 1000, dt); BT.raf = requestAnimationFrame(loop); };
    BT.raf = requestAnimationFrame(loop);
  }
  function nextBattle() {
    if (++BT.i < BT.list.length) return startBattle();
    cancelAnimationFrame(BT.raf); $('battle').hidden = true; if (BT.done) BT.done();
  }
  $('battle').addEventListener('click', (e) => { if (e.target.closest('button')) return; const r = BT.list[BT.i]; if (r && performance.now() - BT.t0 < btEnd(r) * 1000) BT.t0 = performance.now() - btEnd(r) * 1000; });
  // 병사: 게임 캐릭터 시트(16px)에서 종족마다 한 캐릭터. dir 3 = 오른쪽, 2 = 왼쪽. row 0~3 걷기, 4 공격
  function drawUnit(g, k, dir, row, x, y, sc, a) { // AetherAI 캐릭터 (32px). dir 2 = 왼쪽 보기(뒤집기), row 4 = 공격(앞으로 찌르기), 0~3 = 걷기
    if (!ART.aether) return;
    const s2 = sc / 2, w = 32 * s2, bob = row === 4 ? 0 : (row % 2) * s2, lunge = row === 4 ? (Math.floor(performance.now() / 90) % 2) * 2 * s2 : 0;
    g.globalAlpha = a; g.save(); g.translate(Math.round(x + (dir === 2 ? -lunge : lunge)), Math.round(y - bob));
    if (dir === 2) g.scale(-1, 1);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(0, 0, w * 0.3, w * 0.08, 0, 0, 6.3); g.fill();
    g.drawImage(ART.aether, (k % 8) * 32, Math.floor(k / 8) * 32, 32, 32, Math.round(-w / 2), Math.round(-w + 2 * s2), w, w);
    g.restore(); g.globalAlpha = 1;
  }
  function drawBattle(r, t, dt) {
    const F = r.fronts.length, END = btEnd(r), wrap = $('btRows'), cv = $('btFx');
    const W2 = wrap.clientWidth, H2 = wrap.clientHeight;
    if (cv.width !== W2 || cv.height !== H2) { cv.width = W2; cv.height = H2; BT.frame = null; }
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.clearRect(0, 0, W2, H2);
    const box = wrap.getBoundingClientRect();
    let sa = 0, sd = 0;
    for (let k = 0; k < F; k++) {
      const row = wrap.children[k]; if (!row) continue;
      const rb = row.getBoundingClientRect(), x0 = rb.left - box.left, y0 = rb.top - box.top, rw = rb.width, rh = rb.height;
      const at = btAt(F, k), res = at + 0.42, win = r.fronts[k], cx = x0 + rw / 2, gy = y0 + rh * 0.86;
      const sc = Math.max(2, Math.min(4, Math.floor(rh / 22))), sp = Math.min(7 * sc, rw * 0.025); // 병사 간격 (줄이 좁으면 촘촘히)
      // 병사 수: 병력이 클수록 많이 (1~4명)
      const maxT = Math.max(1, r.a[k], r.d[k]);
      const mx = F > 8 ? 3 : 4, nA = Math.max(1, Math.min(mx, Math.round(r.a[k] / maxT * mx))), nD = Math.max(1, Math.min(mx, Math.round(r.d[k] / maxT * mx)));
      const charge = t < at ? 0 : Math.min(1, (t - at) / 0.3), back = t >= res ? Math.min(1, (t - res) / 0.3) : 0;
      const lab = Math.min(rw * 0.09, 44) + 12, baseA = x0 + lab + 9 * sc, baseD = x0 + rw - 9 * sc, reach = rw * 0.05; // 병사는 바깥쪽(안쪽으로 줄 섬), 숫자는 가운데(VS) 옆
      const ax = baseA + charge * reach - (t >= res && win !== 'att' ? back * reach * 0.6 : 0), dx = baseD - charge * reach + (t >= res && win === 'att' ? back * reach * 0.6 : 0);
      const fighting = t >= at + 0.2 && t < res, walk = Math.floor(t * 8) % 4;
      for (let u = 0; u < nA; u++) drawUnit(g, RACE_INFO[raceOf(r.att)].ch, 3, fighting ? 4 : charge > 0 && charge < 1 ? walk : 0, ax + u * sp, gy - (u % 2) * 3 * sc, sc, t >= res && win !== 'att' ? 0.3 : 1);
      for (let u = 0; u < nD; u++) drawUnit(g, RACE_INFO[raceOf(r.def)].ch, 2, fighting ? 4 : charge > 0 && charge < 1 ? walk : 0, dx - u * sp, gy - (u % 2) * 3 * sc, sc, t >= res && win === 'att' ? 0.3 : 1);
      // 이펙트: 싸움 시작 (종족별) → 결과 (이긴 쪽에 크리티컬)
      if (t >= at + 0.15 && !BT.fired['a' + k]) {
        BT.fired['a' + k] = 1;
        const race = raceOf(r.att);
        const fa = ax + (nA - 1) * sp, fd = dx - (nD - 1) * sp; // 맨 앞 병사
        if (race === 'elf') addFx('arrow', fa + 4 * sc, gy - 9 * sc); else addFx(race === 'dwarf' ? 'cleave' : 'slash', fa + 6 * sc, gy);
        const rd2 = raceOf(r.def); if (rd2 === 'elf') addFx('arrow', fd - 4 * sc, gy - 9 * sc, { flip: true }); else addFx(rd2 === 'dwarf' ? 'cleave' : 'slash', fd - 6 * sc, gy, { flip: true });
        SND.play('hit');
      }
      if (t >= res && !BT.fired['r' + k]) {
        BT.fired['r' + k] = 1;
        addFx('spark', cx, gy - 8 * sc); addFx('poof', win === 'att' ? dx - (nD - 1) * sp / 2 : ax + (nA - 1) * sp / 2, gy);
        row.classList.add(win === 'att' ? 'win-a' : 'win-d'); row.querySelector('.vs').textContent = win === 'att' ? '공격 승' : '방어 승';
        const pip = document.querySelector(`[data-pip="${k}"]`); if (pip) pip.className = win;
        SND.play(win === 'att' ? 'coin' : 'place');
      }
      if (t >= at - 0.05 && t < res) row.classList.add('live'); else row.classList.remove('live');
      if (t >= res) { if (win === 'att') sa++; else sd++; }
    }
    if ($('scA')) { $('scA').textContent = sa; $('scD').textContent = sd; }
    // pixelfx 그리기: 낮은 해상도 프레임에 그려서 2배로 키움
    if (PFX && BT.fx.length) {
      const fw = Math.ceil(W2 / FXS), fh = Math.ceil(H2 / FXS);
      if (!BT.frame || BT.frame.w !== fw || BT.frame.h !== fh) { BT.frame = PFX.core.createFrame(fw, fh); BT.img = new ImageData(fw, fh); BT.off = document.createElement('canvas'); BT.off.width = fw; BT.off.height = fh; }
      PFX.core.clearFrame(BT.frame);
      for (const fx of BT.fx) { fx.update(dt); fx.draw(BT.frame); }
      BT.fx = BT.fx.filter((fx) => !fx.done());
      PFX.core.composite(BT.frame, BT.img.data, null);
      BT.off.getContext('2d').putImageData(BT.img, 0, 0);
      g.drawImage(BT.off, 0, 0, fw * FXS, fh * FXS);
    }
    // 끝: 결과 카드
    if (t >= END && $('btSum').hidden) {
      $('btSum').hidden = false; SND.play(r.winner === 'att' ? 'war' : 'ok');
      // 남은 줄을 모두 결과로 (건너뛰기)
      for (let k = 0; k < F; k++) if (!BT.fired['r' + k]) { BT.fired['r' + k] = 1; const row = wrap.children[k], w = r.fronts[k]; if (row) { row.classList.add(w === 'att' ? 'win-a' : 'win-d'); row.querySelector('.vs').textContent = w === 'att' ? '공격 승' : '방어 승'; } const pip = document.querySelector(`[data-pip="${k}"]`); if (pip) pip.className = w; }
      addFx('confetti', W2 / 2, H2 * 0.55);
    }
  }
  // ---- 영역전 시작 배너 (모두에게) + 중계 목록
  let WAR = null;
  function warBanner(text) {
    const el = $('warBanner'); $('warBannerText').textContent = text || '⚔ 영역전 시작 ⚔';
    el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); SND.play('war');
    clearTimeout(warBanner.t); warBanner.t = setTimeout(() => { el.hidden = true; }, 3400);
  }
  function openWarCast() {
    const w = WAR; const box = $('castBody');
    if (!w || !w.reports || !w.reports.length) { box.innerHTML = '<p class="msg">아직 영역전이 없었어요. 매일 점심 1시·밤 10시에 열려요.</p>'; }
    else box.innerHTML = `<p class="msg">${esc(w.label)} · 전투 ${w.reports.length}건 — 누구나 볼 수 있어요</p>` + w.reports.map((r, k) => `<div class="row cast"><span><b style="color:${natColor(r.att)}">${esc(r.attName)}</b> ⚔ <b style="color:${natColor(r.def)}">${esc(r.defName)}</b><small> ${esc(terrLabel(r.target))} · ${r.winner === 'att' ? `공격 승 (영역 ${(r.lost || []).length}곳)` : '방어 승'}</small></span><button data-cast="${k}">보기</button></div>`).join('') + (w.reports.length > 1 ? '<div class="row"><span></span><button id="castAll">전부 보기</button></div>' : '');
    for (const b of box.querySelectorAll('[data-cast]')) b.onclick = () => { $('warCast').hidden = true; playBattles([w.reports[+b.dataset.cast]], () => {}); };
    if ($('castAll')) $('castAll').onclick = () => { $('warCast').hidden = true; playBattles(w.reports, () => {}); };
    $('warCast').hidden = false;
  }
  window.MP_DEBUG = { playBattles: (reps) => { if (testMode || !ONLINE) playBattles(reps, () => {}); }, openStore: () => { if (testMode) openStore(); }, openShop: (k) => { if (testMode) openShop(k); } }; // 테스트 모드에서만 (전선 많은 장면 확인용)
  $('btnCast').addEventListener('click', () => { if (ONLINE && netOn) ws.send(JSON.stringify({ t: 'warCast' })); openWarCast(); });
  $('castClose').addEventListener('click', () => { $('warCast').hidden = true; });

  // ---- 전쟁 창
  let warTab = 'nation', warTarget = null;
  const FN = (i) => MPRules.frontName(i);
  const minPer = (total, F) => MPRules.minPerFront(total, F);
  const frontsOfNation = (nid) => 2 * Object.keys(owners).filter((k) => owners[k] === nid && !gone[k]).length + 1;
  const troopsOf = (id, F) => Array.from({ length: F }, (_, i) => Math.max(0, parseInt(($(id + i) || {}).value, 10) || 0));
  function troopInputs(prefix, vals, disabled) {
    return `<div class="fronts many">${vals.map((v, i) => `<label class="front"><span>${FN(i)}</span><input id="${prefix}${i}" type="number" min="0" max="99999" step="1" inputmode="numeric" value="${v | 0}" ${disabled ? 'disabled' : ''}></label>`).join('')}</div>`;
  }
  // 합계·최소치 확인 (공격·방어 같은 규칙: 모든 전선에 (보낸 병력 ÷ 전선 수)의 20% 이상)
  function troopCheck(prefix, F, max, el, btn) {
    const t = troopsOf(prefix, F), sm = t.reduce((a, b) => a + b, 0), m = minPer(sm, F), lowI = t.findIndex((v) => v < m);
    let msg = `합계 ${sm} / ${max} · 전선마다 최소 ${m}명`, bad = false;
    if (sm > max) { msg = `합계 ${sm} / ${max} · 병력이 모자라요!`; bad = true; }
    else if (sm <= 0) { msg = '병력을 정해 주세요'; bad = true; }
    else if (lowI >= 0) { msg = `${FN(lowI)} 전선이 최소 ${m}명보다 적어요`; bad = true; }
    if (el) { el.textContent = msg; el.style.color = bad ? '#c22f53' : ''; }
    for (let i = 0; i < F; i++) { const inp = $(prefix + i); if (inp) inp.classList.toggle('low', t[i] < m && sm > 0); }
    if (btn) btn.disabled = bad;
    return !bad;
  }
  function spreadEven(prefix, F, total) { const base = Math.floor(total / F); for (let i = 0; i < F; i++) { const inp = $(prefix + i); if (inp) inp.value = base + (i < total - base * F ? 1 : 0); } }
  function renderWar() {
    const v = myView, box = $('warBody');
    if (!v) { $('warHead').textContent = ''; box.innerHTML = '<p class="msg">아직 나라가 없어요. 하늘의 유랑민 등록소에서 귀화하거나, 건국 기간(1~2일차)에는 나라를 세울 수 있어요.</p>'; return; }
    const me = v.me, king = me.isKing;
    $('warHead').innerHTML = `<b style="color:${me.color}">■</b> ${esc(me.name)} · 왕 ${esc(me.kingName || '')}<br><span>병력 <b>${me.army}</b> · 영토 ${me.territories}곳 (전선 ${2 * me.territories + 1}개) · 이번 전투 선전포고 ${me.declaresLeft}/${MPRules.NUM.maxDeclare} · 행동력 ${me.actions}</span>`;
    for (const b of document.querySelectorAll('#warTabs button')) b.setAttribute('aria-pressed', String(b.dataset.tab === warTab));
    let h = '';
    if (warTab === 'nation') {
      h += `<div class="plan"><div class="row"><span>초대 코드</span><b class="code">${esc(me.code || '')}</b></div><p class="msg">팀원에게 이 코드를 알려 주면 [초대 코드로 들어가기]로 우리 나라에 들어와요.</p></div>`;
      h += `<h3>국민 (${me.members}${DAY < 3 ? ` / ${MPRules.NUM.maxMembersEarly}` : ''})</h3>` + (me.memberList || []).map((m) => `<div class="row"><span>${m.king ? '👑 ' : ''}${esc(m.name)}${m.me ? ' (나)' : ''}</span><span>${king && !m.king ? `<button data-king="${m.idx}">왕 넘기기</button> <button data-kick="${m.idx}">내보내기</button>` : ''}</span></div>`).join('');
      h += `<div class="row"><span class="msg">나라를 나가면 유랑민이 되고 24시간 동안 다른 나라에 가입할 수 없어요${king && me.members > 1 ? ' · 왕은 먼저 왕을 넘겨야 해요' : ''}</span><button id="btnLeave">나라 나가기</button></div>`;
      if (DOOM) { // 균열: 영역마다 매일 아침 +10%, 나라 전체 50%면 멸망, 백신은 영역 하나를 0%로
        const mineE = Object.keys(owners).filter((k) => owners[k] === me.id).map(Number).sort((a, b) => (EROSION[b] | 0) - (EROSION[a] | 0));
        const pct = me.erosion || 0;
        h += `<div class="plan"><h3>🌀 균열 침식 · 우리 나라 ${pct}%</h3><div class="ebar"><i style="width:${Math.min(100, pct * 2)}%"></i></div><p class="msg">매일 아침 영역마다 ${MPRules.NUM.erodeStep}%씩 침식돼요 (수도는 안전). 나라 전체가 <b>${MPRules.NUM.erodeFall}%</b>가 되면 나라가 무너져요. 백신 ${me.vaccine}개 · 백신은 영역 하나를 0%로 되돌려요. 다른 나라 땅을 빼앗으면 침식률이 내려가요.</p>` +
          mineE.map((tid) => `<div class="row"><span>${esc(terrLabel(tid))} · ${tid === me.capital ? '수도 (안전)' : `침식 ${EROSION[tid] | 0}%`}</span>${tid !== me.capital && (EROSION[tid] | 0) > 0 ? `<button data-vax="${tid}" ${me.vaccine > 0 ? '' : 'disabled'}>백신 쓰기</button>` : ''}</div>`).join('') + '</div>';
      }
      { const cur = (nationsPub[me.id] && nationsPub[me.id].race) || 'human';
        h += `<div class="plan"><h3>🛡 병력 종족</h3><p class="msg">전투 장면에서 우리 병사의 모습과 무기가 바뀌어요 (지금은 모습만).</p><div class="targets">${Object.entries(RACE_INFO).map(([k, v]) => `<button class="tgt" data-race="${k}" aria-pressed="${k === cur}" ${king ? '' : 'disabled'}>${v.icon} ${v.name}<small>${v.weapon}</small></button>`).join('')}</div>${king ? '' : '<p class="note">종족은 왕만 정할 수 있어요.</p>'}</div>`; }
      h += `<h3>나라 정보</h3><div class="msg">수도 ${esc(terrLabel(me.capital))} · 영토 ${me.territories}곳 · 병력 ${me.army} · 코인 ${me.coin} · 행동력 ${me.actions}</div>`;
      // 천도: 왕이 코인을 내고 우리 영역 중 아무 곳으로 (전투 대기 중 불가, 하루에 한 번)
      const mineT = Object.keys(owners).filter((k) => owners[k] === me.id && +k !== me.capital).map(Number);
      h += `<div class="plan"><h3>🏰 천도</h3><p class="msg">수도를 우리 영역 중 다른 곳으로 옮겨요 · 코인 ${MPRules.NUM.capitalMoveCost} · 선전포고를 받은 동안은 못 하고, 하루에 한 번만 · 영역을 잃을 땐 공격팀과 가까운 곳부터 넘어가니 수도는 멀리 두는 게 안전해요</p>` +
        (mineT.length ? `<div class="targets">${mineT.map((tid) => `<button class="tgt" data-cap="${tid}" ${king ? '' : 'disabled'}>${esc(terrLabel(tid))}</button>`).join('')}</div>` : '<p class="msg">옮길 수 있는 다른 영역이 없어요.</p>') + (king ? '' : '<p class="note">천도는 왕만 할 수 있어요.</p>') + '</div>';
    } else if (warTab === 'attack') {
      const mineSet = new Set(Object.keys(owners).filter((k) => owners[k] === me.id).map(Number));
      const targets = [];
      for (const tid of mineSet) for (const nb of terrs[tid].neighbors) if (owners[nb] && owners[nb] !== me.id && !gone[nb] && !targets.includes(nb)) targets.push(nb);
      if (v.outgoing.length) h += `<h3>우리 공격</h3><p class="msg">지도의 전선 진지(빨간 깃발) 근처에서 E를 누르면 팀원 누구나 충원하거나, 충원했던 병력을 뺄 수 있어요. 충원은 선전포고 병력의 10%까지예요.</p>` + v.outgoing.map((b) => `<div class="plan"><div class="row"><span>⚔ ${esc(terrLabel(b.target))} → <i style="color:${natColor(b.def)}">${esc(natName(b.def))}</i></span><span>${b.slot != null ? slotText(b.slot) : nextFight()}</span></div><div class="msg">전선 ${b.F}곳: ${b.a.map((x, i) => `${FN(i)} ${x}${b.ar[i] ? '+' + b.ar[i] : ''}`).join(' · ')} · 충원 ${b.ar.reduce((x, y) => x + y, 0)}/${b.cap}</div></div>`).join('');
      if (!king) h += '<p class="note">선전포고는 왕만 할 수 있어요. 팀원은 선전포고 뒤에 전선 진지에서 충원할 수 있어요.</p>';
      h += `<h3>공격할 수 있는 적 영토 (${targets.length})</h3>`;
      if (!targets.length) h += '<p class="msg">우리 땅과 붙어 있는 적 영토가 없어요. 주인 없는 땅을 점령해서 적과 국경을 맞대세요 (제단에서 E).</p>';
      h += '<div class="targets">' + targets.map((tid) => `<button class="tgt" data-tgt="${tid}" aria-pressed="${tid === warTarget}"><b style="color:${natColor(owners[tid])}">■</b> ${esc(terrLabel(tid))}<small>${esc(natName(owners[tid]))} · 전선 ${frontsOfNation(owners[tid])}${nationsPub[owners[tid]] && nationsPub[owners[tid]].capital === tid ? ' · 수도' : ''}</small></button>`).join('') + '</div>';
      if (warTarget && targets.includes(warTarget)) {
        const F = frontsOfNation(owners[warTarget]);
        h += `<div class="plan"><h3>${esc(terrLabel(warTarget))} 공격 계획 · 전선 ${F}곳</h3>
          <p class="msg">보낼 병력을 정하고 전선 ${F}곳에 나눠요. 절반 넘게(${Math.floor(F / 2) + 1}곳 이상) 이기면 승리. 방어는 1.1배로 계산되고 같으면 방어 승. 모든 전선에 (보낸 병력 ÷ ${F})의 20% 이상을 꼭 보내야 해요. <b>선전포고 뒤에는 배치를 바꿀 수 없어요.</b></p>
          <div class="row"><span>보낼 병력</span><span><input id="atkTotal" type="number" min="0" max="${me.army}" value="${Math.min(me.army, 10 * F)}" style="width:90px"> <button id="atkEven" type="button">고르게 나누기</button></span></div>
          ${troopInputs('atk', Array(F).fill(0), !king)}
          <div class="row"><span id="atkSum"></span>${king ? '<button id="btnDeclare">선전포고</button>' : ''}</div></div>`;
      }
    } else if (warTab === 'defend') {
      const dd = me.defaultDef || [1];
      h += `<div class="plan"><h3>기본 방어 비율</h3><p class="msg">방어 배치를 못 하고 전투 시각이 되면, 그때 남은 병력을 이 비율로 전선에 나눠요 (전선이 더 많으면 비율을 되풀이). 최소치(20%)는 자동으로 맞춰져요.</p>
        <div class="row"><span>비율 (예: 1 1 1 = 고르게, 3 1 = 앞 전선 많이)</span><input id="ddIn" type="text" value="${esc(dd.join(' '))}" ${king ? '' : 'disabled'} style="width:120px"></div>
        ${king ? '<div class="row"><span>' + (me.defaultDef ? '저장된 비율이 있어요' : '아직 없음 (고르게 나눠요)') + '</span><button id="btnDefault">기본 비율 저장</button></div>' : ''}</div>`;
      h += `<p class="msg">🔍 첩보: 아무 나라용 ${me.intelAny}장${Object.keys(me.intel || {}).filter((k) => me.intel[k] > 0).map((k) => ` · ${esc(natName(k))} 전용 ${me.intel[k]}장`).join('')} — 적 수정을 10번 때리거나 쿠폰으로 얻어요 (방어할 때만 써요)</p>`;
      if (!king) h += '<p class="note">방어 배치는 왕만 할 수 있어요. 여기선 상황만 볼 수 있어요.</p>';
      h += `<h3>우리 땅을 노리는 공격 (${v.incoming.length})</h3>`;
      if (!v.incoming.length) h += '<p class="msg">지금은 공격받는 곳이 없어요.</p>';
      h += v.incoming.map((b) => { const used = b.d ? b.d.reduce((x, y) => x + y, 0) : 0; return `<div class="plan"><div class="row"><span>🛡 ${esc(terrLabel(b.target))} ← <i style="color:${natColor(b.att)}">${esc(natName(b.att))}</i>${me.capital === b.target ? ' · <b>수도!</b>' : ''}</span><span>${b.slot != null ? slotText(b.slot) : nextFight()} · ${b.d ? '배치함' : '<b>배치 안 함 (자동)</b>'}</span></div>
        <p class="msg">전선 ${b.F}곳 · 절반 넘게 지면 영역을 잃어요 · 방어 1.1배, 같으면 방어 승</p>
        ${b.rev && b.rev.length ? `<p class="msg">🔍 알아낸 적 병력: ${b.rev.map((r) => `<b>${FN(r.f)} 전선 ${r.n}명</b>`).join(' · ')}</p>` : ''}
        <div class="row"><span>막을 병력 <input id="defTotal${b.id}" type="number" min="0" value="${used || Math.min(me.army, 10 * b.F)}" style="width:80px" ${king ? '' : 'disabled'}> ${king ? `<button data-even="${b.id}" type="button">고르게</button>` : ''}</span>${b.intel > 0 && (!b.rev || b.rev.length < b.F) ? `<button data-intel="${b.id}">첩보 쓰기 (${b.intel}장)</button>` : ''}</div>
        ${troopInputs('def' + b.id + '_', b.d || Array(b.F).fill(0), !king)}${king ? `<div class="row"><span id="defSum${b.id}" data-max="${me.army + used}"></span><button data-defend="${b.id}" data-f="${b.F}">방어 배치 저장</button></div>` : ''}</div>`; }).join('');
    } else {
      h += `<h3>지난 전투 결과</h3>`;
      if (!v.reports.length) h += '<p class="msg">아직 전투 기록이 없어요.</p>';
      h += v.reports.slice().reverse().map((r) => {
        const weAtt = r.att === me.id, won = (r.winner === 'att') === weAtt, F = r.F || r.fronts.length;
        const lootTxt = r.loot ? Object.entries(r.loot).filter(([, x]) => x > 0).map(([k, x]) => `${({ coin: '코인', wood: '목재', vaccine: '백신' }[k] || (BUILD_BY[k] || {}).name || k)} ${x}`).join(', ') : '';
        return `<div class="report ${won ? 'won' : 'lost'}"><div class="row"><b>${won ? '승리' : '패배'}</b><span>${r.night}번째 전투 · ${esc(terrLabel(r.target))} · 전선 ${r.attWon != null ? r.attWon : r.fronts.filter((x) => x === 'att').length}:${r.defWon != null ? r.defWon : r.fronts.filter((x) => x === 'def').length}</span></div>
          <div class="msg">${esc(r.attName)}(공격) → ${esc(r.defName)}(방어)${r.autoDef ? ' · 방어 자동 배치' : ''}</div>
          <div class="fgrid">${r.fronts.map((w, i) => `<span class="${w}"><b>${FN(i)}</b>${r.effA[i]}<i>vs</i>${r.effD[i]}</span>`).join('')}</div>
          <div class="msg">손실: 공격 −${r.lossA} · 방어 −${r.lossD}${r.prisoners ? ` · 포로 ${r.prisoners}명 (방어팀)` : ''}${r.lost && r.lost.length ? ` · 넘어간 영역 ${r.lost.length}곳: ${r.lost.map((t) => esc(terrLabel(t))).join(', ')}` : ''}${lootTxt ? ` · 가져간 재료: ${lootTxt}` : ''}${r.newCapital ? ` · 수도가 ${esc(terrLabel(r.newCapital))}(으)로 강제 천도` : ''}${r.destroyed ? ' · <b>나라 멸망</b>' : ''}</div></div>`;
      }).join('');
    }
    if (testMode) h += `<div class="row test"><span>테스트용</span><button id="btnResolve">지금 전투 처리</button></div>`;
    box.innerHTML = h;
    // 이벤트
    for (const b of box.querySelectorAll('[data-king]')) b.onclick = () => warAction('kingTo', { idx: +b.dataset.king });
    for (const b of box.querySelectorAll('[data-kick]')) b.onclick = () => { if (confirm('이 팀원을 내보낼까요? 그 사람은 24시간 동안 다른 나라에 가입할 수 없어요.')) warAction('kick', { idx: +b.dataset.kick }); };
    if ($('btnLeave')) $('btnLeave').onclick = () => { if (confirm(me.members <= 1 ? '혼자 남은 나라예요. 나가면 나라가 해체되고 영토는 주인 없는 땅이 돼요. 나갈까요?' : '나라를 나갈까요? 24시간 동안 다른 나라에 가입할 수 없어요.')) warAction('leave', {}); };
    for (const b of box.querySelectorAll('[data-tgt]')) b.onclick = () => { warTarget = +b.dataset.tgt; renderWar(); };
    for (const b of box.querySelectorAll('[data-vax]')) b.onclick = () => warAction('vaccinate', { terr: +b.dataset.vax });
    for (const b of box.querySelectorAll('[data-intel]')) b.onclick = () => warAction('intel', { battle: +b.dataset.intel });
    for (const b of box.querySelectorAll('[data-race]')) b.onclick = () => warAction('setRace', { race: b.dataset.race });
    for (const b of box.querySelectorAll('[data-cap]')) b.onclick = () => { if (confirm(`${terrLabel(+b.dataset.cap)}(으)로 천도할까요? 코인 ${MPRules.NUM.capitalMoveCost}이 들고 하루 동안 다시 못 옮겨요.`)) warAction('moveCapital', { terr: +b.dataset.cap }); };
    if ($('btnDefault')) $('btnDefault').onclick = () => warAction('defaultDef', { ratio: $('ddIn').value.split(/[\s,:]+/).filter(Boolean).map((x) => Math.max(0, parseInt(x, 10) || 0)).slice(0, 30) });
    for (const b of box.querySelectorAll('[data-defend]')) {
      const bid = b.dataset.defend, F = +b.dataset.f, sumEl = $('defSum' + bid), max = +sumEl.dataset.max;
      const check = () => troopCheck('def' + bid + '_', F, max, sumEl, b);
      for (let i = 0; i < F; i++) $('def' + bid + '_' + i).oninput = check;
      const ev = box.querySelector(`[data-even="${bid}"]`); if (ev) ev.onclick = () => { spreadEven('def' + bid + '_', F, Math.min(max, parseInt($('defTotal' + bid).value, 10) || 0)); check(); };
      check();
      b.onclick = () => { if (check()) warAction('defend', { battle: +bid, troops: troopsOf('def' + bid + '_', F) }); };
    }
    if ($('btnDeclare') || $('atk0')) {
      const F = frontsOfNation(owners[warTarget]);
      const upd = () => troopCheck('atk', F, me.army, $('atkSum'), $('btnDeclare'));
      for (let i = 0; i < F; i++) { const el = $('atk' + i); if (el) el.oninput = upd; }
      const even = () => { spreadEven('atk', F, Math.min(me.army, parseInt($('atkTotal').value, 10) || 0)); upd(); };
      $('atkEven').onclick = even; even();
      if ($('btnDeclare')) $('btnDeclare').onclick = () => { if (upd() && confirm('선전포고 뒤에는 배치를 바꿀 수 없고 병력도 뺄 수 없어요. 선전포고할까요?')) warAction('declare', { terr: warTarget, troops: troopsOf('atk', F) }); };
    }
    if ($('btnResolve')) $('btnResolve').onclick = () => warAction('resolveNow', {});
  }
  // 전투 시간 번호 → 글자 (일차×3 + 점심1/밤2)
  function slotText(idx) { const d = Math.floor(idx / 3), when = d === DAY ? '오늘' : d === DAY + 1 ? '내일' : `${d}일차`; return `${when} ${idx % 3 === 1 ? '점심 1시' : '밤 10시'}`; }
  // 전선 진지 충원 창 (공격팀 팀원 누구나): 전선을 고르고 숫자를 적어 충원/빼기
  function openReinforce(bid) {
    const b = myView && myView.outgoing.find((x) => x.id === bid); if (!b) return;
    const used = b.ar.reduce((x, y) => x + y, 0);
    $('reinBody').innerHTML = `<p class="msg">⚔ ${esc(terrLabel(b.target))} → ${esc(natName(b.def))} · 충원 ${used}/${b.cap} (선전포고 병력의 10%) · 나라 병력 ${myView.me.army}</p>
      <div class="fgrid pick">${b.a.map((x, i) => `<button type="button" data-rf="${i}" aria-pressed="${i === 0}"><b>${FN(i)}</b>${x}${b.ar[i] ? `<i>+${b.ar[i]}</i>` : ''}</button>`).join('')}</div>
      <div class="row"><span>숫자</span><input id="reinN" type="number" min="1" value="${Math.max(1, Math.min(10, b.cap - used))}" style="width:90px"></div>
      <p class="msg">선전포고 때 넣은 병력은 뺄 수 없고, 충원했던 병력만 뺄 수 있어요.</p>`;
    let f = 0;
    for (const el of $('reinBody').querySelectorAll('[data-rf]')) el.onclick = () => { f = +el.dataset.rf; for (const x of $('reinBody').querySelectorAll('[data-rf]')) x.setAttribute('aria-pressed', String(x === el)); };
    const go = (sign) => { const n = Math.max(0, parseInt($('reinN').value, 10) || 0); if (!n) return; warAction('reinforce', { battle: bid, front: f, amount: sign * n }); $('reinBox').hidden = true; };
    $('reinAdd').onclick = () => go(1); $('reinSub').onclick = () => go(-1);
    $('reinBox').hidden = false;
  }
  $('reinClose').addEventListener('click', () => { $('reinBox').hidden = true; });
  $('bailClose').addEventListener('click', () => { $('bailBox').hidden = true; });
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

  // ------------------------------------------------------------ 제단 퍼즐 (스도쿠 5분 · 슬라이딩 3분)
  // 온라인: 서버가 판을 주고 답을 확인 / 미리보기: 같은 규칙(rules.js)으로 브라우저에서
  let curPuzzle = null, pzTimer = 0;
  function openPuzzle(t) {
    if (ONLINE) { if (netOn) ws.send(JSON.stringify({ t: 'puzzle', terr: t.id })); return; }
    if (!OFF_ME) { toast('나라가 있어야 퍼즐 보상을 받을 수 있어요'); return; }
    if (!OFF.useAction(OFF_ME)) { toast('오늘 행동력을 다 썼어요'); return; }
    const kind = Math.random() < 0.5 ? 'sudoku' : 'slide';
    showPuzzle({ id: 'local', terr: t.id, kind, board: kind === 'sudoku' ? MPRules.genSudoku() : MPRules.genSlide(), sec: kind === 'sudoku' ? MPRules.NUM.sudokuSec : MPRules.NUM.slideSec, mode: ownerOf(t.id) ? 'army' : 'claim' }, true);
    offSync();
  }
  function showPuzzle(p, local) {
    curPuzzle = Object.assign({}, p, { local, t0: performance.now(), moves: [], cur: p.board.slice(), sel: -1 });
    $('pzTitle').textContent = p.kind === 'sudoku' ? '🔢 스도쿠' : '🧩 슬라이딩 퍼즐';
    $('pzMode').textContent = (p.mode === 'claim' ? `풀면 ${terrLabel(p.terr)}을(를) 점령해요` : `풀면 병력 +${MPRules.NUM.puzzleArmy}`) + ` · 제한 ${Math.round(p.sec / 60)}분 · 행동력 1을 썼어요`;
    $('pzMsg').textContent = p.kind === 'sudoku' ? '칸을 누르고 숫자 키(1~9)를 눌러요. 지우기는 0이나 Backspace. 가로·세로·3×3 칸에 1~9가 한 번씩.' : '빈칸 옆 숫자를 누르거나 방향키로 움직여서 1~8 순서로 맞춰요.'; $('pzMsg').className = 'msg';
    $('pzSend').hidden = p.kind !== 'sudoku';
    renderPuzzle();
    $('puzzle').hidden = false;
    clearInterval(pzTimer); pzTimer = setInterval(tickPuzzle, 250); tickPuzzle();
  }
  function tickPuzzle() {
    if (!curPuzzle) { clearInterval(pzTimer); return; }
    const left = Math.max(0, curPuzzle.sec - (performance.now() - curPuzzle.t0) / 1000);
    $('pzTime').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`; $('pzTime').classList.toggle('warn', left < 30);
    if (left <= 0) { const P = curPuzzle; curPuzzle = null; clearInterval(pzTimer); if (ONLINE && netOn) ws.send(JSON.stringify({ t: 'answer', id: P.id, giveUp: true })); puzzleResult(false, '시간이 다 됐어요. 다시 도전하려면 행동력 1이 들어요', true); }
  }
  function renderPuzzle() {
    const P = curPuzzle, box = $('pzBoard');
    if (P.kind === 'sudoku') {
      box.className = 'sudoku';
      box.innerHTML = P.cur.map((v, i) => `<button type="button" data-i="${i}" class="${P.board[i] ? 'fix' : ''}${i === P.sel ? ' sel' : ''}${Math.floor(i / 9) % 3 === 2 && Math.floor(i / 9) < 8 ? ' bb' : ''}${i % 9 % 3 === 2 && i % 9 < 8 ? ' br' : ''}">${v || ''}</button>`).join('');
      for (const b of box.querySelectorAll('button')) b.onclick = () => { const i = +b.dataset.i; if (!P.board[i]) { P.sel = i; renderPuzzle(); } };
    } else {
      box.className = 'slide';
      box.innerHTML = P.cur.map((v) => `<button type="button" data-v="${v}" class="${v ? '' : 'empty'}">${v || ''}</button>`).join('');
      for (const b of box.querySelectorAll('button')) b.onclick = () => slideMove(+b.dataset.v);
    }
  }
  function slideMove(v) {
    const P = curPuzzle; if (!P || P.kind !== 'slide') return;
    const nb = MPRules.slideNext(P.cur, v); if (!nb) return;
    P.cur = nb; P.moves.push(v); renderPuzzle();
    if (nb.join() === '1,2,3,4,5,6,7,8,0') submitPuzzle();
  }
  addEventListener('keydown', (e) => {
    const P = curPuzzle; if (!P || $('puzzle').hidden) return;
    if (P.kind === 'sudoku' && P.sel >= 0) {
      if (/^[1-9]$/.test(e.key)) { P.cur[P.sel] = +e.key; renderPuzzle(); e.preventDefault(); }
      else if (e.key === '0' || e.key === 'Backspace' || e.key === 'Delete') { P.cur[P.sel] = 0; renderPuzzle(); e.preventDefault(); }
      else if (e.key.startsWith('Arrow')) { const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 }[e.key]; let i = P.sel; do { i += d; } while (i >= 0 && i < 81 && P.board[i]); if (i >= 0 && i < 81) { P.sel = i; renderPuzzle(); } e.preventDefault(); }
      else if (e.key === 'Enter') submitPuzzle();
    } else if (P.kind === 'slide' && e.key.startsWith('Arrow')) { // 방향키: 빈칸 쪽으로 옆 칸을 밀기
      const z = P.cur.indexOf(0), zr = Math.floor(z / 3), zc = z % 3;
      const from = { ArrowUp: [zr + 1, zc], ArrowDown: [zr - 1, zc], ArrowLeft: [zr, zc + 1], ArrowRight: [zr, zc - 1] }[e.key];
      if (from[0] >= 0 && from[0] < 3 && from[1] >= 0 && from[1] < 3) slideMove(P.cur[from[0] * 3 + from[1]]);
      e.preventDefault();
    }
  });
  function submitPuzzle() {
    const P = curPuzzle; if (!P) return;
    if (P.kind === 'sudoku' && P.cur.some((v) => !v)) { $('pzMsg').textContent = '빈칸을 모두 채워 주세요'; $('pzMsg').className = 'msg warn'; return; }
    if (ONLINE) { ws.send(JSON.stringify(P.kind === 'sudoku' ? { t: 'answer', id: P.id, grid: P.cur } : { t: 'answer', id: P.id, moves: P.moves })); return; }
    const right = P.kind === 'sudoku' ? MPRules.checkSudoku(P.board, P.cur) : MPRules.checkSlide(P.board, P.moves);
    if (!right) return puzzleResult(false, '아직 틀린 칸이 있어요');
    const r = OFF.puzzleReward(OFF_ME, P.terr, null, DAY);
    offSync();
    puzzleResult(true, r.kind === 'claim' ? '정답! 영토를 점령했어요' : r.kind === 'army' ? `정답! 병력 +${r.army}` : '정답!', true);
  }
  function puzzleResult(ok, text, done) {
    SND.play(ok ? 'ok' : 'fail');
    $('pzMsg').textContent = text; $('pzMsg').className = 'msg ' + (ok ? 'good' : 'warn');
    if (ok || done) { curPuzzle = null; clearInterval(pzTimer); setTimeout(() => { $('puzzle').hidden = true; }, ok ? 1300 : 2200); toast(text); }
  }

  $('pzSend').addEventListener('click', submitPuzzle);
  $('pzClose').addEventListener('click', () => { // 그만두기: 행동력은 이미 씀
    if (curPuzzle && !confirm('퍼즐을 그만둘까요? 쓴 행동력 1은 돌아오지 않아요.')) return;
    if (curPuzzle && ONLINE && netOn) ws.send(JSON.stringify({ t: 'answer', id: curPuzzle.id, giveUp: true }));
    $('puzzle').hidden = true; curPuzzle = null; clearInterval(pzTimer);
  });

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
    lastDt = Math.min(0.1, Math.max(0.001, (now - (frame.prev || now)) / 1000)); frame.prev = now;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = now / 1000;

    // 플레이어 이동
    stepPlayer(dt); tickHold();
    if (player.scene === 'sky' && !(player.room.id === 'jail' && jailUntil > Date.now()) && !EDIT.on) {
      // 하늘 체류 시간 제한 없음 (나갔다 들어오면 어차피 초기화돼서 없앰)
    }
    for (const b of bots) updateBot(b, dt);
    netTick(dt);
    if (TITLE.on) { TITLE.x += TITLE.vx * dt0(); TITLE.y += TITLE.vy * dt0(); drawGround(t); } else if (player.scene === 'sky') drawSky(t); else drawGround(t);
    if (fadeT > 0) { fadeT -= dt; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = `rgba(255,255,255,${Math.max(0, fadeT / 0.35)})`; ctx.fillRect(0, 0, vw, vh); }

    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.15;
      const sky = player.scene === 'sky';
      $('doom').hidden = !sky && !EDIT.on; // 일차·멸망 D-? 는 하늘에서만
      $('skyTimer').hidden = !(sky && player.room.id === 'jail' && jailUntil > Date.now()) || EDIT.on; // 감옥 남은 시간만
      if (sky && player.room.id === 'jail' && jailUntil > Date.now()) { const l = Math.max(0, Math.ceil((jailUntil - Date.now()) / 1000)); $('skyTimer').firstChild.textContent = '감옥 '; $('skyLeft').textContent = `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; $('skyTimer').classList.remove('warn'); }
      else if (sky) { $('skyTimer').firstChild.textContent = '하늘 체류 '; const l = Math.max(0, Math.ceil(player.skyLeft)); $('skyLeft').textContent = `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; $('skyTimer').classList.toggle('warn', l <= 60); }
      $('miniCap').textContent = canTp() ? (EDIT.on ? '누르면 순간이동 (맵 고치기)' : '누르면 순간이동 (테스트용)') : '미니맵';
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
  // 시작 화면·로딩·건국 창·퍼즐·옷장 같은 창이 열려 있으면 캐릭터가 움직이지 않음
  const BLOCK_MOVE = ['warCast', 'title', 'opening', 'loading', 'found', 'puzzle', 'closet', 'coupon', 'doomPop', 'battle', 'reinBox', 'bailBox'];
  const moveLocked = () => BLOCK_MOVE.some((id) => { const el = $(id); return el && !el.hidden; });
  function wantDir() {
    if (moveLocked()) { queuedDir = null; return null; }
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
    const d = $('talk').hidden ? wantDir() : null; // 대화 중엔 못 움직임
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
      nameTag(ctx, o.x, o.y - 56, (o === player ? player.name : o.name) + (o.badge ? ' ' + o.badge : ''), o === player ? player.tag : o.tag); // 이름 옆 악명 (💀 / 체포왕 👮)
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
    skyCam.x = camX; skyCam.y = camY;
    ctx.drawImage(R.canvas, -SKY_M, -SKY_M);
    if (EDIT.on) { editOverlay(R); propGhost(); if (EDIT.lastScene !== R.id) { EDIT.lastScene = R.id; editUI(); } }
    const list = R.sprites.slice();
    for (const b of others('sky', R)) list.push(b);
    list.push(player);
    drawActors(list, t);
    nightTint(0.5);
  }
  // 시간대 색: 아침은 살짝 따뜻하게, 밤은 어둡고 푸르게
  function nightTint(k = 1) {
    if (!ONLINE) return;
    if (SLOT === 'lunch') return;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (SLOT === 'night') { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = k < 1 ? '#a8aee0' : '#6f78b8'; ctx.fillRect(0, 0, vw, vh); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = `rgba(30,40,110,${0.12 * k})`; ctx.fillRect(0, 0, vw, vh); } // 밤: 어둡고 푸르게
    else { ctx.fillStyle = `rgba(255,190,110,${0.08 * k})`; ctx.fillRect(0, 0, vw, vh); } // 아침: 살짝 따뜻하게
    ctx.restore();
  }

  function drawGround(t) {

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1b1430'; ctx.fillRect(0, 0, vw, vh);
    const camX = (TITLE.on ? TITLE.x : player.x) - vw / 2 / zoom, camY = (TITLE.on ? TITLE.y : player.y) - 40 - vh / 2 / zoom;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -camX * dpr * zoom, -camY * dpr * zoom);
    ctx.imageSmoothingEnabled = false;
    groundCam.x = camX; groundCam.y = camY;

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
      if (e && e.k === 'farm' && e.crop) list.push({ x: tx * TILE + 16, y: ty * TILE + 30, draw: (g, X, Y) => drawCrop(g, X, Y, e.crop.c, cropStage(e.crop), performance.now() / 1000) });
      if (e && (e.k === 'wall' || e.k === 'deco')) list.push({ x: tx * TILE + 16, y: ty * TILE + 30, draw: (g, X, Y) => { drawBuild(g, X, Y, e); drawHpBar(g, X, Y, e, i); } });
      if (MY_TRAPS.has(i)) list.push({ x: tx * TILE + 16, y: ty * TILE + 4, draw: (g, X, Y) => drawTrap(g, X, Y + 24) });
      const pr = GPROPS.get(i); if (pr) list.push({ x: tx * TILE + 16, y: ty * TILE + 30, draw: (g, X, Y) => drawProp(g, pr.r, X, Y) });
    }
    for (const n of nodes) if (!gone[n.id] && n.x > x0 && n.x < x1 && n.y > y0 && n.y < y1 && !(build.moving && build.moving.kind === 'mine' && build.moving.terr === n.id)) list.push({ x: n.x, y: n.y, draw: (g, X, Y) => drawOre(g, X, Y, mined.has(n.id)) });
    for (const [i, nid] of STORE_AT) { if (build.moving && build.moving.kind === 'store' && nid === MY_NID) continue; const X = (i % W) * TILE + 16, Y = Math.floor(i / W) * TILE + 30; if (X > x0 && X < x1 && Y > y0 && Y < y1) list.push({ x: X, y: Y, draw: (g, a, b) => drawStore(g, a, b, nid) }); }
    { // 무너진 땅 위로 피어오르는 보라 기운
      const now2 = performance.now() / 1000;
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) { const q = terrAt(tx, ty); if (!(q > 0 && gone[q])) continue; const hh = hash(tx, ty, 77); if (hh > 0.14) continue; const k = (now2 * (0.3 + hh * 2) + hh * 9) % 1; ctx.globalAlpha = 0.8 * (1 - k); ctx.fillStyle = hh < 0.05 ? '#ff9cff' : '#b45cf0'; ctx.fillRect(tx * TILE + 8 + Math.sin(now2 * 2 + hh * 20) * 6, ty * TILE + 28 - k * 46, 4, 4); }
      ctx.globalAlpha = 1;
    }
    if (RIFT_SET.size) { // 다음 균열 예고 땅: 보라색으로 일렁임
      const a = 0.16 + Math.sin(performance.now() / 300) * 0.06;
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) if (RIFT_SET.has(terrAt(tx, ty))) { ctx.fillStyle = `rgba(150,60,230,${a})`; ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE); if ((tx * 7 + ty * 3) % 11 === 0) { ctx.fillStyle = 'rgba(40,10,80,0.55)'; ctx.fillRect(tx * TILE + 6, ty * TILE + 14, 18, 3); ctx.fillRect(tx * TILE + 14, ty * TILE + 8, 3, 14); } }
    }
    // 전선: 공격받는 영토 국경 중 A·B·C 세 곳을 빨갛게 + 깃발
    for (const b of BATTLES) if (b.f) b.f.forEach(([fx, fy], k) => {
      if (fx * TILE < x0 - 200 || fx * TILE > x1 + 200 || fy * TILE < y0 - 200 || fy * TILE > y1 + 200) return;
      const pulse = 0.6 + Math.sin(performance.now() / 250) * 0.25;
      for (let y = fy - 4; y <= fy + 4; y++) for (let x = fx - 4; x <= fx + 4; x++) {
        if (terrAt(x, y) !== b.target) continue;
        const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]].filter(([dx, dy]) => { const q = terrAt(x + dx, y + dy); return q > 0 && q !== b.target && ownerOf(q) === b.att; });
        if (!sides.length) continue;
        ctx.fillStyle = `rgba(255,30,60,${pulse * 0.35})`; ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        ctx.fillStyle = `rgba(230,20,50,${pulse})`;
        for (const [dx, dy] of sides) ctx.fillRect(x * TILE + (dx > 0 ? TILE - 8 : 0), y * TILE + (dy > 0 ? TILE - 8 : 0), dx ? 8 : TILE, dy ? 8 : TILE);
      }
      list.push({ x: fx * TILE + 16, y: fy * TILE + 30, draw: (g, X, Y) => {
        g.fillStyle = '#5a4630'; g.fillRect(X - 2, Y - 64, 4, 64);
        g.fillStyle = '#e8203e'; g.beginPath(); g.moveTo(X + 2, Y - 64); g.lineTo(X + 34, Y - 54); g.lineTo(X + 2, Y - 44); g.fill();
        g.font = `700 14px ${PFONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText('⚔', X + 13, Y - 54);
        if (b.att === MY_NID) sign(g, X, Y - 84, `전선 진지 · 충원 E (${b.F || 3}전선)`); else if (b.def === MY_NID) sign(g, X, Y - 84, `적 전선 진지 (${b.F || 3}전선)`);
      } });
    });
    if (home && !home.portal && ONLINE) { const hp = homePortal(); if (hp[0] >= tx0 && hp[0] <= tx1 && hp[1] >= ty0 && hp[1] <= ty1) list.push({ x: hp[0] * TILE + 16, y: hp[1] * TILE + 20, draw: (g, X, Y) => drawPortal(g, X, Y, true) }); } // 천도한 수도의 하늘 포털
    if (build.on && player.scene === 'ground') { // 설치 모드: 앞 칸 표시
      for (const [fx, fy] of build.moving ? [facingTile()] : shapeTiles()) { const ok = ownerOf(terrAt(fx, fy)) === MY_NID && !blocked(fx, fy); ctx.fillStyle = ok ? 'rgba(255,211,77,0.35)' : 'rgba(255,60,80,0.3)'; ctx.fillRect(fx * TILE, fy * TILE, TILE, TILE); ctx.strokeStyle = ok ? '#ffd34d' : '#ff3c50'; ctx.lineWidth = 2; ctx.strokeRect(fx * TILE + 1, fy * TILE + 1, TILE - 2, TILE - 2); }
    }
    for (const b of others('ground', null)) if (b.x > x0 && b.x < x1 && b.y > y0 && b.y < y1) list.push(b);
    list.push(player);
    drawActors(list, t);
    if (hold.on) { // 꾹 누르기 게이지
      const k = Math.min(1, (performance.now() - hold.t0) / hold.ms);
      ctx.fillStyle = '#2b2340'; ctx.fillRect(player.x - 26, player.y - 96, 52, 10); ctx.fillStyle = '#ffd34d'; ctx.fillRect(player.x - 24, player.y - 94, 48 * k, 6);
    }
    if (EDIT.on) { groundEditOverlay(tx0, tx1, ty0, ty1); propGhost(); if (EDIT.lastScene !== 'ground') { EDIT.lastScene = 'ground'; editUI(); } }
    nightTint(); // 낮·밤
    if (performance.now() < stunUntil) { ctx.font = `700 13px ${PFONT}`; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd34d'; ctx.fillText('✦ 꼼짝 못 함 ✦', player.x, player.y - 100); }
  }

  // ------------------------------------------------------------ 게임 시계 (서버) · 낮밤 · 멸망 D-day
  const SLOT_NAME = { morning: '아침 9시', lunch: '점심 1시', night: '밤 10시' };
  function setClock(c) {
    if (!c) return;
    const dayChanged = c.day !== DAY;
    DAY = c.day; SLOT = EDIT.on && EDIT.slot ? EDIT.slot : c.slot; DOOM_DAY = c.doomDay || 5; LAST_DAY = c.lastDay || 15; PHASE = phaseOf(DAY);
    DOOM = DAY > DOOM_DAY || (DAY === DOOM_DAY && SLOT !== 'morning'); // 선포일 점심부터
    if ('riftNext' in c) { RIFT_NEXT = c.riftNext; RIFT_SET = new Set(RIFT_NEXT ? RIFT_NEXT.terrs : []); }
    if (c.gone) setGone(c.gone);
    setErosion(c.erosion);
    if (dayChanged) { mined.clear(); }
    setupDoomCard(); drawSunMoon();
    if (DOOM) maybeDoomPopup();
  }
  function setGone(list) {
    const g2 = new Uint8Array(gone.length); for (const t of list) g2[t] = 1;
    let diff = false; for (let i = 0; i < g2.length; i++) if (g2[i] !== gone[i]) { diff = true; break; }
    if (!diff) return;
    gone = g2; mapSig = ''; applyWorld(); // 무너진 땅 다시 그리기
  }
  // 해·달 픽셀 아이콘 (시간대 표시)
  function drawSunMoon() {
    const c = $('sunMoon'); if (!c) return; const g = c.getContext('2d'); g.clearRect(0, 0, 16, 16);
    const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
    if (SLOT === 'night') { // 초승달
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const a = Math.hypot(x - 7.5, y - 7.5), b = Math.hypot(x - 10.5, y - 5.5); if (a < 6.5 && b > 5) px(x, y, a > 5.5 ? '#c9b860' : '#ffe98a'); }
      px(2, 3, '#ffffff'); px(13, 12, '#ffffff');
    } else { // 해 (아침은 주황, 점심은 노랑)
      const core = SLOT === 'morning' ? '#ffb347' : '#ffd84d', rim = SLOT === 'morning' ? '#e07a2a' : '#e8a020';
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const a = Math.hypot(x - 7.5, y - 7.5); if (a < 4.6) px(x, y, a > 3.6 ? rim : core); }
      for (const [x, y] of [[7, 0], [8, 0], [7, 15], [8, 15], [0, 7], [0, 8], [15, 7], [15, 8], [2, 2], [13, 2], [2, 13], [13, 13]]) px(x, y, rim);
    }
  }
  // 세계 멸망 배너: 도트 글씨 + 보라·하늘색 번개 오오라 (작게 그린 뒤 크게 키워서 픽셀 느낌)
  const doomArt = new Map();
  function doomFrames(big) {
    if (doomArt.has(big)) return doomArt.get(big);
    const W2 = 200, H2 = 84, frames = [];
    const mask = (txt, size, oy) => { const c = document.createElement('canvas'); c.width = W2; c.height = H2; const g = c.getContext('2d'); g.font = `700 ${size}px Galmuri11`; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = '#fff'; g.fillText(txt, W2 / 2, oy); const d = g.getImageData(0, 0, W2, H2).data; const m = new Uint8Array(W2 * H2); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 110 ? 1 : 0; return m; };
    let T = mask('세계 멸망', 24, 4), B = mask(big, 36, 28);
    { // 두 줄 글자를 가로·세로 모두 가운데로 (빨간 눈 자리 오프셋 없이)
      let x0 = W2, x1 = 0, y0 = H2, y1 = 0; for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) if (T[y * W2 + x] || B[y * W2 + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const dx = Math.round((W2 - 1 - x1 - x0) / 2), dy = Math.round((H2 - 1 - y1 - y0) / 2);
      const sh = (m) => { const o = new Uint8Array(m.length); for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) if (m[y * W2 + x]) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W2 && Y < H2) o[Y * W2 + X] = 1; } return o; };
      T = sh(T); B = sh(B);
    }
    const M = new Uint8Array(W2 * H2); for (let i = 0; i < M.length; i++) M[i] = T[i] | B[i];
    const dil = (m, r) => { const o = new Uint8Array(m.length); for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { if (!m[y * W2 + x]) continue; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r + 1) continue; const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < W2 && Y < H2) o[Y * W2 + X] = 1; } } return o; };
    const g5 = dil(M, 5), g4 = dil(M, 4), cy = dil(M, 3), bk = dil(M, 2);
    let bx0 = W2, bx1 = 0, by0 = H2, by1 = 0; for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) if (B[y * W2 + x]) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
    for (let f = 0; f < 4; f++) {
      let seed = f * 7919 + 13; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const c = document.createElement('canvas'); c.width = W2; c.height = H2; const g = c.getContext('2d'); const img = g.createImageData(W2, H2), d = img.data;
      const set = (x, y, r, gg, b) => { if (x < 0 || y < 0 || x >= W2 || y >= H2) return; const i = (y * W2 + x) * 4; d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255; };
      for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { // 소용돌이 배경
        const rr = Math.hypot((x - W2 / 2) / 1.6, y - H2 / 2), an = Math.atan2(y - H2 / 2, x - W2 / 2), sw = Math.sin(an * 3 + rr * 0.25 + f) * 0.5 + 0.5, base = Math.max(0, 1 - rr / 90);
        const q = (v) => Math.floor(v / 24) * 24; set(x, y, q(14 + base * 70 * sw + base * 20), q(8 + base * 30 * sw), q(40 + base * 150 * sw + base * 40));
      }
      for (let i = 0; i < M.length; i++) { const x = i % W2, y = (i / W2) | 0, n = rnd(); if (g5[i] && n < 0.45) set(x, y, 90, 30, 200); if (g4[i] && n < 0.8) set(x, y, 140, 60, 255); if (cy[i]) set(x, y, 80, 210, 255); if (bk[i]) set(x, y, 12, 6, 24); if (M[i]) set(x, y, 255, 255, 255); }
      for (let k = 0; k < 10; k++) { let x = bx0 + ((rnd() * (bx1 - bx0)) | 0), y = by0 + ((rnd() * (by1 - by0)) | 0); for (let s = 0; s < 4; s++) { if (B[y * W2 + x]) set(x, y, 120, 110, 170); x += ((rnd() * 3) | 0) - 1; y++; } }
      const bolt = (x, y, an, n) => { for (let s = 0; s < n; s++) { const xi = Math.round(x), yi = Math.round(y); set(xi + 1, yi, 70, 200, 255); set(xi - 1, yi, 70, 200, 255); set(xi, yi + 1, 70, 200, 255); set(xi, yi, 235, 250, 255); an += (rnd() - 0.5) * 1.8; x += Math.cos(an) * 1.6; y += Math.sin(an) * 1.6; if (rnd() < 0.1) bolt(x, y, an + (rnd() - 0.5) * 2.4, n / 3); } };
      for (let k = 0; k < 4; k++) { const left = rnd() < 0.5; bolt(left ? bx0 - 6 : bx1 + 6, by0 + rnd() * (by1 - by0), left ? Math.PI : 0, 14 + rnd() * 10); }
      const ex = Math.max(12, bx0 - 20), ey = ((by0 + by1) / 2) | 0; // 빨간 눈
      for (let dy = -6; dy <= 6; dy++) for (let dx = -10; dx <= 10; dx++) { const e = (dx / 9) ** 2 + (dy / 5) ** 2; if (e <= 1) set(ex + dx, ey + dy, e > 0.55 ? 250 : 215, e > 0.55 ? 240 : 15, e > 0.55 ? 240 : 35); if (e > 0.85 && e <= 1.15) set(ex + dx, ey + dy, 12, 6, 24); }
      for (let dy = -4; dy <= 4; dy++) set(ex, ey + dy, 20, 0, 0); set(ex - 1, ey, 20, 0, 0); set(ex + 1, ey, 20, 0, 0); set(ex + 3, ey - 3, 255, 200, 200);
      for (let x = 0; x < W2; x++) { set(x, 0, 12, 6, 24); set(x, H2 - 1, 12, 6, 24); set(x, 1, 140, 60, 255); set(x, H2 - 2, 140, 60, 255); }
      for (let y = 0; y < H2; y++) { set(0, y, 12, 6, 24); set(W2 - 1, y, 12, 6, 24); set(1, y, 140, 60, 255); set(W2 - 2, y, 140, 60, 255); }
      g.putImageData(img, 0, 0); frames.push(c);
    }
    doomArt.set(big, frames); return frames;
  }
  const doomBig = () => DAY >= LAST_DAY ? 'D-Day' : `D-${LAST_DAY - DAY}`;
  // 남은 시간: 마지막 날(12/28) 0시까지, 실시간으로 줄어듦
  function doomLeft() {
    if (DAY >= LAST_DAY) return '';
    const k = new Date(Date.now() + 9 * 3600e3), secToday = k.getUTCHours() * 3600 + k.getUTCMinutes() * 60 + k.getUTCSeconds();
    const left = (LAST_DAY - DAY - 1) * 86400 + (86400 - secToday);
    const d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
    return `${d}일 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  function drawDoomBanner(g, cx, top, scale) {
    const fr = doomFrames(doomBig()), c = fr[Math.floor(performance.now() / 120) % fr.length];
    const prev = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    g.drawImage(c, Math.round(cx - c.width * scale / 2), Math.round(top), c.width * scale, c.height * scale);
    g.imageSmoothingEnabled = prev;
    const t = doomLeft(); if (!t) return;
    g.font = `700 ${Math.round(9 * scale)}px ${PFONT}`; g.textAlign = 'center'; g.textBaseline = 'top'; g.lineWidth = 4; g.strokeStyle = '#12061f'; g.fillStyle = '#8fe3ff';
    g.strokeText(`멸망까지 ${t}`, cx, top + c.height * scale + 4); g.fillText(`멸망까지 ${t}`, cx, top + c.height * scale + 4);
  }
  // 하루에 한 번 크게 띄우기 (선포일 점심부터). 그 뒤엔 하늘 신전 게시판에 걸려 있음
  function maybeDoomPopup() {
    if (!DOOM || store('mp2026.doomSeen') === DAY || TITLE.on || OP.on || !titleDone) return; // 타이틀·오프닝이 끝난 뒤에
    store('mp2026.doomSeen', DAY);
    $('doomPop').hidden = false;
    const cv = $('doomPopCanvas'), g = cv.getContext('2d');
    const loop = () => { if ($('doomPop').hidden) return; g.clearRect(0, 0, cv.width, cv.height); drawDoomBanner(g, cv.width / 2, 0, 3); requestAnimationFrame(loop); };
    loop();
  }
  $('doomPop').addEventListener('click', () => { $('doomPop').hidden = true; });

  // ------------------------------------------------------------ 관리자 '맵 고치기' (주소 끝 ?edit=1, 관리자 비밀번호 필요)
  // ZEP 처럼: 타일 깔기 / 지우개 / 빨간 장벽 칠하기·지우기, 장벽 보이기 on/off, 기본 소품 숨기기, 시간대 미리보기
  const EDIT = { prop: null, propBlock: true, on: false, key: '', tool: 'paint', brush: 1, sheet: 'town', tile: 0, showWalls: true, slot: null, room: 'temple', dirty: false, timer: 0, painting: false };
  const skyCam = { x: 0, y: 0 }, groundCam = { x: 0, y: 0 };
  const gPending = { set: {}, walls: {}, clear: {}, props: {} };
  function groundEditOverlay(tx0, tx1, ty0, ty1) {
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * W + tx;
      if (GCLEAR.has(i)) { ctx.strokeStyle = 'rgba(80,220,120,0.8)'; ctx.setLineDash([4, 3]); ctx.strokeRect(tx * TILE + 2.5, ty * TILE + 2.5, TILE - 5, TILE - 5); ctx.setLineDash([]); }
      if (EDIT.showWalls) { if (GWALL.has(i)) { ctx.fillStyle = 'rgba(255,30,50,0.5)'; ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE); ctx.strokeStyle = 'rgba(200,0,30,0.8)'; ctx.strokeRect(tx * TILE + 0.5, ty * TILE + 0.5, TILE - 1, TILE - 1); } else if (blocked(tx, ty)) { ctx.fillStyle = 'rgba(255,90,90,0.2)'; ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE); } }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
    for (let x = tx0; x <= tx1; x++) { ctx.beginPath(); ctx.moveTo(x * TILE, ty0 * TILE); ctx.lineTo(x * TILE, (ty1 + 1) * TILE); ctx.stroke(); }
    for (let y = ty0; y <= ty1; y++) { ctx.beginPath(); ctx.moveTo(tx0 * TILE, y * TILE); ctx.lineTo((tx1 + 1) * TILE, y * TILE); ctx.stroke(); }
    if (EDIT.hover) { const [hx, hy] = EDIT.hover, b = EDIT.tool === 'fill' ? 1 : EDIT.brush, o = (b - 1) / 2; ctx.strokeStyle = EDIT.tool.startsWith('wall') || EDIT.tool === 'unwall' ? '#ff3344' : EDIT.tool.endsWith('clear') ? '#50dc78' : '#ffd34d'; ctx.lineWidth = 2; ctx.strokeRect((hx - o) * TILE, (hy - o) * TILE, b * TILE, b * TILE); if (EDIT.tool === 'paint' || EDIT.tool === 'fill') { ctx.globalAlpha = 0.6; for (let dy = -o; dy <= o; dy++) for (let dx = -o; dx <= o; dx++) drawSheetTile(ctx, EDIT.sheet + ':' + EDIT.tile, (hx + dx) * TILE, (hy + dy) * TILE, TILE); ctx.globalAlpha = 1; } }
  }
  // ---- 칸 하나 읽기/바꾸기 (땅 지도 'ground' 또는 하늘 방 id). 모든 변경은 획(stroke)에 기록 → Ctrl+Z
  const undoStack = [], redoStack = []; let stroke = null;
  const rPending = {}; // 하늘 방별로 아직 서버에 안 보낸 칸
  const touched = { ground: false, groundClear: false, rooms: new Set() };
  function cellGet(sc, kind, x, y) {
    if (sc === 'ground') { const i = y * W + x; return kind === 'floor' ? (GFLOOR.get(i) || null) : kind === 'prop' ? (GPROPS.get(i) || null) : kind === 'wall' ? (GWALL.has(i) ? 1 : 0) : (GCLEAR.has(i) ? 1 : 0); }
    const E = ROOM_EDITS[sc] || {}, k = x + ',' + y; return kind === 'floor' ? ((E.floor || {})[k] || null) : kind === 'prop' ? ((E.props || {})[k] || null) : ((E.walls || {})[k] ? 1 : 0);
  }
  function cellSet(sc, kind, x, y, v) {
    const k = x + ',' + y;
    if (sc === 'ground') {
      const i = y * W + x;
      if (kind === 'floor') { if (v) GFLOOR.set(i, v); else GFLOOR.delete(i); gPending.set[k] = v || null; dirtyTile(i); }
      else if (kind === 'prop') { if (v) GPROPS.set(i, v); else GPROPS.delete(i); gPending.props[k] = v || null; }
      else if (kind === 'wall') { if (v) GWALL.add(i); else GWALL.delete(i); gPending.walls[k] = v ? 1 : 0; }
      else { if (v) GCLEAR.add(i); else GCLEAR.delete(i); gPending.clear[k] = v ? 1 : 0; touched.groundClear = true; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) dirtyTile((y + dy) * W + x + dx); }
      touched.ground = true; return;
    }
    const E = ROOM_EDITS[sc] = ROOM_EDITS[sc] || { floor: {}, walls: {}, hideProps: false }; E.floor = E.floor || {}; E.walls = E.walls || {};
    const P = rPending[sc] = rPending[sc] || { set: {}, walls: {}, props: {} }; P.props = P.props || {}; E.props = E.props || {};
    if (kind === 'floor') { if (v) E.floor[k] = v; else delete E.floor[k]; P.set[k] = v || null; } else if (kind === 'prop') { if (v) E.props[k] = v; else delete E.props[k]; P.props[k] = v || null; } else { if (v) E.walls[k] = 1; else delete E.walls[k]; P.walls[k] = v ? 1 : 0; }
    touched.rooms.add(sc);
  }
  function change(sc, kind, x, y, v) { const b = cellGet(sc, kind, x, y); if (b === v || (b && v && typeof v === 'object' && JSON.stringify(b) === JSON.stringify(v))) return false; cellSet(sc, kind, x, y, v); if (stroke) stroke.push([sc, kind, x, y, b, v]); return true; }
  // 바뀐 것 화면에 반영하고 잠시 뒤 저장
  function flushEdits() {
    if (touched.groundClear) { mapSig = ''; applyWorld(); }
    if (touched.ground) { $('edSave').textContent = '저장 대기…'; clearTimeout(EDIT.timer); EDIT.timer = setTimeout(groundSave, 900); }
    for (const id of touched.rooms) { buildRoom(id); if (player.room && player.room.id === id) player.room = ROOMS[id]; $('edSave').textContent = '저장 대기…'; clearTimeout(EDIT.rtimer); EDIT.rtimer = setTimeout(() => editSave(id), 900); }
    touched.ground = touched.groundClear = false; touched.rooms = new Set();
  }
  const scope = () => (player.scene === 'sky' && player.room ? player.room.id : 'ground');
  const scopeSize = (sc) => (sc === 'ground' ? [W, H] : [ROOMS[sc].w, ROOMS[sc].h]);
  function brushApply(tx, ty) {
    const sc = scope(), [SW, SH] = scopeSize(sc), o = (EDIT.brush - 1) / 2, ref = EDIT.sheet + ':' + EDIT.tile;
    for (let dy = -o; dy <= o; dy++) for (let dx = -o; dx <= o; dx++) {
      const x = tx + dx, y = ty + dy; if (x < 0 || y < 0 || x >= SW || y >= SH) continue;
      if (EDIT.tool === 'paint') change(sc, 'floor', x, y, ref);
      else if (EDIT.tool === 'erase') change(sc, 'floor', x, y, null);
      else if (EDIT.tool === 'wall') change(sc, 'wall', x, y, 1);
      else if (EDIT.tool === 'unwall') change(sc, 'wall', x, y, 0);
      else if (EDIT.tool === 'clear' && sc === 'ground' && (treeAt(x, y) || terrain[y * W + x] === T.MOUNTAIN)) change(sc, 'clear', x, y, 1);
      else if (EDIT.tool === 'unclear' && sc === 'ground') change(sc, 'clear', x, y, 0);
      else if (EDIT.tool === 'prop' && EDIT.prop) change(sc, 'prop', x, y, { r: EDIT.prop, b: EDIT.propBlock ? 1 : 0 });
      else if (EDIT.tool === 'unprop') change(sc, 'prop', x, y, null);
    }
    flushEdits();
  }
  // 채우기: 붙어 있는 같은 타일(빈 칸이면 같은 지형)을 고른 타일로 한 번에 바꾸기
  function floodFill(tx, ty) {
    const sc = scope(), [SW, SH] = scopeSize(sc), ref = EDIT.sheet + ':' + EDIT.tile, LIMIT = sc === 'ground' ? 3000 : SW * SH;
    if (tx < 0 || ty < 0 || tx >= SW || ty >= SH) return;
    const want = cellGet(sc, 'floor', tx, ty), base = sc === 'ground' ? tileAt(tx, ty) : 0;
    if (want === ref) return;
    const same = (x, y) => cellGet(sc, 'floor', x, y) === want && (want || sc !== 'ground' || tileAt(x, y) === base);
    const seen = new Set([ty * SW + tx]), q = [[tx, ty]], cells = [];
    while (q.length) {
      const [x, y] = q.pop(); cells.push([x, y]);
      if (cells.length > LIMIT) { $('edSave').textContent = `채우기 취소: ${LIMIT}칸이 넘어요. 테두리를 먼저 칠해서 막아 주세요`; return; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy, k = Y * SW + X; if (X < 0 || Y < 0 || X >= SW || Y >= SH || seen.has(k)) continue; seen.add(k); if (same(X, Y)) q.push([X, Y]); }
    }
    for (const [x, y] of cells) change(sc, 'floor', x, y, ref);
    if (cells.length > 400 && sc === 'ground') invalidateChunks();
    flushEdits(); $('edSave').textContent = `${cells.length}칸 채움 · 저장 대기…`;
  }
  function endStroke() { if (stroke && stroke.length) { undoStack.push(stroke); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; } stroke = null; }
  function undoRedo(redo) {
    const st = (redo ? redoStack : undoStack).pop(); if (!st) { $('edSave').textContent = redo ? '다시 할 게 없어요' : '되돌릴 게 없어요'; return; }
    const list = redo ? st : st.slice().reverse();
    for (const [sc, kind, x, y, b, a] of list) cellSet(sc, kind, x, y, redo ? a : b);
    if (st.length > 400) invalidateChunks();
    (redo ? undoStack : redoStack).push(st); flushEdits();
    $('edSave').textContent = `${redo ? '다시 함' : '되돌림'} (${st.length}칸) · 저장 대기…`;
  }
  async function groundSave(reset) {
    const body = reset ? { reset: true } : { set: gPending.set, walls: gPending.walls, clear: gPending.clear, props: gPending.props };
    gPending.set = {}; gPending.walls = {}; gPending.clear = {}; gPending.props = {};
    try { const r = await fetch('/admin/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ key: EDIT.key, op: 'groundSave' }, body)) }).then((x) => x.json()); $('edSave').textContent = r.ok ? `저장됨 · 땅 타일 ${r.floor} · 장벽 ${r.walls} · 비운 칸 ${r.clear} · 소품 ${r.props}` : '저장 실패: ' + r.err; }
    catch (e) { $('edSave').textContent = '저장 실패 (연결 확인)'; }
  }
  function editOverlay(R) {
    const E = ROOM_EDITS[R.id] || {};
    if (EDIT.showWalls) for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) { const v = R.grid[y * R.w + x]; if (v === 1) { const custom = E.walls && E.walls[x + ',' + y]; ctx.fillStyle = custom ? 'rgba(255,30,50,0.5)' : 'rgba(255,90,90,0.22)'; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); if (custom) { ctx.strokeStyle = 'rgba(200,0,30,0.8)'; ctx.lineWidth = 1; ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1); } } }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; // 칸 선
    for (let x = 0; x <= R.w; x++) { ctx.beginPath(); ctx.moveTo(x * TILE, 0); ctx.lineTo(x * TILE, R.h * TILE); ctx.stroke(); }
    for (let y = 0; y <= R.h; y++) { ctx.beginPath(); ctx.moveTo(0, y * TILE); ctx.lineTo(R.w * TILE, y * TILE); ctx.stroke(); }
    if (EDIT.hover) { const [hx, hy] = EDIT.hover, b = EDIT.tool === 'fill' ? 1 : EDIT.brush, o = (b - 1) / 2; ctx.strokeStyle = EDIT.tool.startsWith('wall') || EDIT.tool === 'unwall' ? '#ff3344' : '#ffd34d'; ctx.lineWidth = 2; ctx.strokeRect((hx - o) * TILE, (hy - o) * TILE, b * TILE, b * TILE); if (EDIT.tool === 'paint' || EDIT.tool === 'fill') { ctx.globalAlpha = 0.6; for (let dy = -o; dy <= o; dy++) for (let dx = -o; dx <= o; dx++) drawSheetTile(ctx, EDIT.sheet + ':' + EDIT.tile, (hx + dx) * TILE, (hy + dy) * TILE, TILE); ctx.globalAlpha = 1; } }
  }
  function propGhost() { if (EDIT.hover && EDIT.tool === 'prop' && EDIT.prop) { const [hx, hy] = EDIT.hover; ctx.globalAlpha = 0.65; drawProp(ctx, EDIT.prop, hx * TILE + 16, (hy + 1) * TILE - 2); ctx.globalAlpha = 1; } }
  function editTileAt(e) { const r = canvas.getBoundingClientRect(), cam = player.scene === 'sky' ? skyCam : groundCam; const wx = (e.clientX - r.left) / zoom + cam.x, wy = (e.clientY - r.top) / zoom + cam.y; return [Math.floor(wx / TILE), Math.floor(wy / TILE)]; }
  async function editSave(id, extra) {
    id = id || player.room.id;
    const P = rPending[id] || { set: {}, walls: {}, props: {} }; delete rPending[id];
    try {
      const r = await fetch('/admin/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ key: EDIT.key, op: 'roomSave', id, set: P.set, walls: P.walls, props: P.props || {} }, extra || {})) }).then((x) => x.json());
      $('edSave').textContent = r.ok ? `저장됨 · 타일 ${r.floor} · 장벽 ${r.walls} · 소품 ${r.props}` : '저장 실패: ' + r.err; EDIT.dirty = !r.ok;
    } catch (e) { $('edSave').textContent = '저장 실패 (연결 확인)'; }
  }
  function editPalette() {
    const S = SHEETS[EDIT.sheet], im = ART[S.key], cv = $('edPal'), k = 2;
    cv.width = im.width * k; cv.height = im.height * k; const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    g.fillStyle = '#2b2340'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
    for (const ref of WATERY) { const [sh, n] = ref.split(':'); if (sh !== EDIT.sheet) continue; const x = (+n % S.cols) * 16 * k, y = Math.floor(+n / S.cols) * 16 * k; g.fillStyle = '#1d4fd8'; g.beginPath(); g.moveTo(x + 32, y); g.lineTo(x + 22, y); g.lineTo(x + 32, y + 10); g.fill(); } // 파란 모서리 = 물(못 지나감)
    const sx = (EDIT.tile % S.cols) * 16 * k, sy = Math.floor(EDIT.tile / S.cols) * 16 * k; g.strokeStyle = '#ffd34d'; g.lineWidth = 3; g.strokeRect(sx + 1.5, sy + 1.5, 16 * k - 3, 16 * k - 3);
    for (const b of document.querySelectorAll('#editor [data-sheet]')) b.setAttribute('aria-pressed', String(b.dataset.sheet === EDIT.sheet));
  }
  function propPalette() {
    const box = $('edPropPal'); if (box.dataset.built) return; box.dataset.built = 1;
    for (const ref of propList()) {
      const b = document.createElement('button'); b.type = 'button'; b.title = ref; b.dataset.prop = ref;
      const c = document.createElement('canvas'); c.width = c.height = 40; const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
      const [t, n] = ref.split(':'), im = t === 'u' ? ART['u_' + n] : ART['x_' + n]; const k = Math.min(36 / im.width, 36 / im.height, 2); g.drawImage(im, (40 - im.width * k) / 2, 40 - im.height * k - 2, im.width * k, im.height * k);
      b.appendChild(c); b.onclick = () => { EDIT.prop = ref; EDIT.tool = 'prop'; editUI(); }; box.appendChild(b);
    }
  }
  function editUI() {
    propPalette();
    $('edPropBox').hidden = !(EDIT.tool === 'prop' || EDIT.tool === 'unprop');
    for (const b of document.querySelectorAll('#edPropPal [data-prop]')) b.setAttribute('aria-pressed', String(b.dataset.prop === EDIT.prop));
    $('edPropBlock').textContent = EDIT.propBlock ? '놓을 소품: 막힘 (못 지나감)' : '놓을 소품: 통과 (지나갈 수 있음)';
    for (const b of document.querySelectorAll('#editor [data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === EDIT.tool));
    for (const b of document.querySelectorAll('#editor [data-brush]')) b.setAttribute('aria-pressed', String(+b.dataset.brush === EDIT.brush));
    for (const b of document.querySelectorAll('#editor [data-slot]')) b.setAttribute('aria-pressed', String(b.dataset.slot === SLOT));
    $('edWalls').textContent = EDIT.showWalls ? '장벽 보기: 켜짐' : '장벽 보기: 꺼짐';
    const E = player.room && ROOM_EDITS[player.room.id]; $('edProps').textContent = E && E.hideProps ? '기본 소품: 숨김' : '기본 소품: 보임';
    $('edRoom').value = player.scene === 'sky' && player.room ? player.room.id : 'ground';
    $('edProps').disabled = player.scene !== 'sky';
    for (const b of document.querySelectorAll('#editor [data-tool="clear"], #editor [data-tool="unclear"]')) b.disabled = player.scene === 'sky';
    $('edClear').textContent = player.scene === 'sky' ? '이 방 되돌리기' : '땅 지도 전부 되돌리기';
  }
  async function startEditor() {
    let key = ''; try { key = sessionStorage.getItem('mpAdminKey') || ''; } catch (e) {}
    if (!key) key = prompt('맵 고치기는 관리자만 할 수 있어요. 관리자 비밀번호:') || '';
    const r = await fetch('/admin/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, op: 'status' }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { alert('관리자 비밀번호가 맞지 않아요'); return; }
    try { sessionStorage.setItem('mpAdminKey', key); } catch (e) {}
    EDIT.on = true; EDIT.key = key; $('editor').hidden = false; $('found').hidden = true; if (build.on) setBuild(false);
    $('edRoom').innerHTML = '<option value="ground">🌍 땅 지도 (720×720)</option>' + Object.entries(ROOMS).filter(([, R]) => !R.hidden || true).map(([id, R]) => `<option value="${id}">☁ ${R.name} (${R.w}×${R.h})</option>`).join('');
    $('edSheets').innerHTML = Object.entries(SHEETS).map(([id, S]) => `<button type="button" data-sheet="${id}">${S.name}</button>`).join('');
    for (const b of document.querySelectorAll('#editor [data-sheet]')) b.onclick = () => { EDIT.sheet = b.dataset.sheet; EDIT.tile = 0; editPalette(); };
    editPalette(); editUI();
  }
  $('edRoom').addEventListener('change', () => { const v = $('edRoom').value; if (v === 'ground') { if (player.scene === 'sky') descend(); } else { enterRoom(v, null); player.skyLeft = 9999; } editUI(); });
  for (const b of document.querySelectorAll('#editor [data-tool]')) b.addEventListener('click', () => { EDIT.tool = b.dataset.tool; editUI(); });
  for (const b of document.querySelectorAll('#editor [data-brush]')) b.addEventListener('click', () => { EDIT.brush = +b.dataset.brush; editUI(); });
  for (const b of document.querySelectorAll('#editor [data-slot]')) b.addEventListener('click', () => { EDIT.slot = b.dataset.slot; SLOT = EDIT.slot; drawSunMoon(); editUI(); });
  $('edWalls').addEventListener('click', () => { EDIT.showWalls = !EDIT.showWalls; editUI(); });
  $('edPropBlock').addEventListener('click', () => { EDIT.propBlock = !EDIT.propBlock; editUI(); });
  $('edProps').addEventListener('click', () => { const R = player.room; const E = ROOM_EDITS[R.id] = ROOM_EDITS[R.id] || { floor: {}, walls: {} }; E.hideProps = !E.hideProps; buildRoom(R.id); player.room = ROOMS[R.id]; editUI(); editSave(R.id, { hideProps: E.hideProps }); });
  $('edClear').addEventListener('click', () => { if (player.scene !== 'sky') { if (confirm('땅 지도에 깐 타일과 장벽을 전부 지울까요? 되돌릴 수 없어요.')) { applyGroundEdit({ reset: true }); groundSave(true); } return; } const R = player.room; if (!confirm(`${R.name}에 깐 타일과 장벽을 모두 지울까요?`)) return; ROOM_EDITS[R.id] = { floor: {}, walls: {}, hideProps: false }; delete rPending[R.id]; buildRoom(R.id); player.room = ROOMS[R.id]; editUI(); editSave(R.id, { reset: true }); });
  $('edExit').addEventListener('click', () => { location.href = '/'; });
  $('edPal').addEventListener('click', (e) => { const S = SHEETS[EDIT.sheet], r = $('edPal').getBoundingClientRect(), k = $('edPal').width / r.width; const tx = Math.floor((e.clientX - r.left) * k / 32), ty = Math.floor((e.clientY - r.top) * k / 32); const n = ty * S.cols + tx; if (tx < S.cols) { EDIT.tile = n; if (EDIT.tool !== 'fill') EDIT.tool = 'paint'; editPalette(); editUI(); } });
  // 스포이드: 지도에서 칸을 누르면 그 칸의 타일(또는 소품)이 있는 탭으로 바꾸고 골라 줌
  function pickAt(x, y) {
    const sc = scope(), f = cellGet(sc, 'floor', x, y), pr = cellGet(sc, 'prop', x, y);
    if (f && SHEETS[f.split(':')[0]]) pickRef(f, false);
    else if (pr) {
      EDIT.prop = pr.r; EDIT.propBlock = !!pr.b; EDIT.tool = 'prop'; editUI();
      const b = document.querySelector(`#edPropPal [data-prop="${pr.r}"]`); if (b) b.scrollIntoView({ block: 'nearest' });
      toast('🎯 소품을 골랐어요');
    } else { const ref = baseRefAt(sc, x, y); if (ref) return pickRef(ref, true); toast('여기는 고를 바닥이 없어요'); }
  }
  function pickRef(f, base) {
    {
      const [sh, n] = f.split(':'); EDIT.sheet = sh; EDIT.tile = +n; EDIT.tool = 'paint'; editPalette(); editUI();
      const S = SHEETS[sh], box = $('edPal').parentElement, cv = $('edPal'), k = cv.getBoundingClientRect().width / cv.width;
      box.scrollTop = Math.max(0, (Math.floor(+n / S.cols) * 32 + 16) * k - box.clientHeight / 2);
      box.scrollLeft = Math.max(0, ((+n % S.cols) * 32 + 16) * k - box.clientWidth / 2);
      box.scrollIntoView({ block: 'nearest' }); // 패널이 길어도 팔레트가 보이게
      toast(`🎯 ${base ? '원래 바닥을 ' : ''}${SHEETS[sh].name} 탭에서 골랐어요`);
    }
  }
  // 기본 지형 칸 → 실제로 그려진 타일 번호 (땅: 닌자 바닥/물가 시트, 그 밖은 '기본 지형' 탭)
  function baseRefAt(sc, x, y) {
    const B = (k) => 'base:' + BASE_PATS.indexOf(k);
    if (sc === 'ground') {
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      const t = tileAt(x, y), h = hash(x, y), nj = (L) => { const [cx, cy] = L[(h * L.length) | 0]; return 'ninja:' + (cy * 22 + cx); };
      if (t === T.GRASS) return nj(TL.grass); if (t === T.FOREST) return nj(TL.forest); if (t === T.SAND) return nj(TL.sand); if (t === T.MOUNTAIN) return nj(TL.rock);
      if (t === T.WATER) { const land = (a, b) => { const q = tileAt(a, b); return q !== T.WATER && q !== T.VOID; }; const N = land(x, y - 1), S = land(x, y + 1), Wd = land(x - 1, y), E = land(x + 1, y);
        const key = N && Wd ? 'nw' : N && E ? 'ne' : S && Wd ? 'sw' : S && E ? 'se' : N ? 'n' : S ? 's' : Wd ? 'w' : E ? 'e' : 'c'; const [cx, cy] = TL.shore[key]; return 'water:' + (cy * SHEETS.water.cols + cx); }
      if (t === T.HOLY) return B(tileAt(x, y - 1) === T.VOID || tileAt(x - 1, y) === T.VOID || tileAt(x + 1, y) === T.VOID || tileAt(x, y + 1) === T.VOID ? 'holy_edge' : 'holy');
      if (t === T.WALL) return B('wall'); return B('void');
    }
    const R = ROOMS[sc]; if (!R || x < 0 || y < 0 || x >= R.w || y >= R.h) return null;
    if (R.wall && y < 2) return B('brick');
    let key = R.floor;
    for (const [cx, cy, cw, ch] of R.carpets || []) if (x >= cx && x < cx + cw && y >= cy && y < cy + ch) key = 'carpet';
    for (const [px, py, pw, ph, k] of R.patches || []) if (x >= px && x < px + pw && y >= py && y < py + ph) key = k;
    if (BASE_PATS.includes(key)) return B(key);
    if (key && key.startsWith('na:')) { const [cx, cy] = key.slice(3).split(',').map(Number); return 'ninja:' + (cy * 22 + cx); }
    return null;
  }
  canvas.addEventListener('mousedown', (e) => { if (!EDIT.on) return; const [x, y] = editTileAt(e); if (EDIT.tool === 'pick' || e.altKey) { e.preventDefault(); pickAt(x, y); return; } stroke = []; if (EDIT.tool === 'fill') { floodFill(x, y); endStroke(); return; } EDIT.painting = true; brushApply(x, y); });
  canvas.addEventListener('mousemove', (e) => { if (!EDIT.on) return; EDIT.hover = editTileAt(e); if (EDIT.painting) brushApply(...EDIT.hover); });
  addEventListener('mouseup', () => { if (EDIT.painting) endStroke(); EDIT.painting = false; });
  addEventListener('keydown', (e) => { // Ctrl+Z 되돌리기, Ctrl+Y / Ctrl+Shift+Z 다시 하기
    if (!EDIT.on || !(e.ctrlKey || e.metaKey) || (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) return;
    const k = e.key.toLowerCase(); if (k === 'z' || k === 'y') { e.preventDefault(); undoRedo(k === 'y' || e.shiftKey); }
  });
  canvas.addEventListener('mouseleave', () => { EDIT.hover = null; });

  // ------------------------------------------------------------ 소리: 효과음 + 배경음악 (파일 없이 WebAudio로 만든 도트 게임 소리)
  // 배경음악은 나중에 받은 음악 파일로 바꿀 수 있게 SND.music(url) 자리를 남겨 둠
  const SND = (() => {
    let ac = null, master = null, sfxBus = null, bgmBus = null, bgmOn = false, bgmTimer = 0, step = 0;
    const vol = (k, d) => { const v = store(k); return (v == null ? d : v) / 100; };
    function init() {
      if (ac) return true;
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return false; }
      master = ac.createGain(); master.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.gain.value = vol('mp2026.sfx', 70) * 0.5; sfxBus.connect(master);
      bgmBus = ac.createGain(); bgmBus.gain.value = vol('mp2026.bgm', 60) * 0.55; bgmBus.connect(master); // 배경음악 크게
      return true;
    }
    function tone(freq, t0, dur, type = 'square', gain = 0.3, bus = sfxBus, slide = 0) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(bus); o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function noise(t0, dur, gain = 0.3, hp = 800, bus = sfxBus) {
      const n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); src.buffer = buf; f.type = 'highpass'; f.frequency.value = hp; g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(bus); src.start(t0);
    }
    const FX = {
      click: (t) => tone(880, t, 0.05, 'square', 0.12),
      chop: (t) => { noise(t, 0.08, 0.35, 400); tone(140, t, 0.12, 'triangle', 0.35, sfxBus, 0.6); },
      coin: (t) => { tone(988, t, 0.08, 'square', 0.18); tone(1319, t + 0.07, 0.18, 'square', 0.18); },
      hit: (t) => { tone(1500, t, 0.07, 'triangle', 0.25, sfxBus, 0.7); noise(t, 0.05, 0.2, 2500); },
      ok: (t) => [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.07, 0.16, 'square', 0.16)),
      fail: (t) => { tone(330, t, 0.15, 'square', 0.16); tone(247, t + 0.13, 0.25, 'square', 0.16); },
      steal: (t) => tone(300, t, 0.25, 'square', 0.14, sfxBus, 3),
      arrest: (t) => { for (let i = 0; i < 4; i++) tone(i % 2 ? 660 : 880, t + i * 0.13, 0.12, 'square', 0.14); },
      place: (t) => { tone(220, t, 0.06, 'square', 0.18); noise(t, 0.04, 0.15, 1200); },
      war: (t) => { // 전쟁 나팔 + 북
        [[196, 0], [196, 0.18], [262, 0.36], [330, 0.62]].forEach(([f, d]) => { tone(f, t + d, d === 0.62 ? 0.9 : 0.22, 'sawtooth', 0.16); tone(f / 2, t + d, d === 0.62 ? 0.9 : 0.22, 'square', 0.08); });
        for (let i = 0; i < 6; i++) { tone(90, t + i * 0.2, 0.14, 'triangle', 0.4, sfxBus, 0.5); noise(t + i * 0.2, 0.06, 0.15, 200); }
      },
      open: (t) => [784, 988, 1175].forEach((f, i) => tone(f, t + i * 0.05, 0.1, 'triangle', 0.14)),
      bell: (t) => { tone(1568, t, 1.2, 'sine', 0.2); tone(2093, t, 0.8, 'sine', 0.08); },
    };
    function play(name) { if (!init() || ac.state === 'suspended') { if (ac) ac.resume(); } if (!ac || !FX[name]) return; try { FX[name](ac.currentTime + 0.01); } catch (e) { /* 무시 */ } }
    // 배경음악 3곡 (8분음표 64칸 = 4마디 × 16): 0 = 쉼표
    const TRACKS = {
      peace: { name: '평화로운 들판', bpm: 96, ch: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], lead: 'square',
        mel: [76, 0, 74, 72, 74, 0, 76, 79, 77, 0, 76, 74, 72, 0, 0, 0, 72, 0, 74, 76, 79, 0, 76, 74, 74, 0, 72, 71, 72, 0, 0, 0,
          69, 0, 72, 76, 77, 0, 76, 72, 72, 0, 74, 76, 74, 0, 72, 71, 72, 74, 76, 79, 81, 0, 79, 76, 74, 0, 72, 74, 76, 0, 0, 0] },
      village: { name: '마을 축제', bpm: 120, ch: [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]], lead: 'square',
        mel: [72, 0, 76, 0, 79, 0, 76, 0, 74, 0, 79, 0, 83, 0, 79, 0, 81, 0, 79, 76, 72, 0, 76, 0, 77, 0, 76, 74, 72, 0, 0, 0,
          72, 74, 76, 0, 79, 0, 81, 79, 74, 76, 79, 0, 83, 0, 81, 79, 81, 0, 84, 0, 81, 79, 76, 0, 77, 76, 74, 0, 72, 0, 0, 0] },
      mystic: { name: '신전의 밤', bpm: 80, ch: [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52]], lead: 'triangle',
        mel: [74, 0, 0, 77, 76, 0, 74, 0, 72, 0, 0, 0, 74, 0, 0, 0, 70, 0, 0, 74, 72, 0, 70, 0, 69, 0, 0, 0, 0, 0, 0, 0,
          72, 0, 0, 76, 74, 0, 72, 0, 74, 0, 77, 0, 81, 0, 0, 0, 79, 0, 77, 0, 76, 0, 74, 0, 73, 0, 0, 0, 0, 0, 0, 0] },
    };
    const mf = (m) => 440 * Math.pow(2, (m - 69) / 12);
    let cur = null, audio = null;
    function bgmTick() {
      if (!bgmOn || !cur) return;
      const T = TRACKS[cur], spb = 60 / T.bpm / 2, t = ac.currentTime + 0.05;
      for (let k = 0; k < 4; k++) {
        const i = (step + k) % 64, c = T.ch[Math.floor(i / 16)], tt = t + k * spb;
        if (i % 4 === 0) tone(mf(c[0] - 12), tt, spb * 3.6, 'triangle', 0.5, bgmBus); // 베이스
        tone(mf(c[i % 3] + 12), tt, spb * 0.9, 'square', 0.07, bgmBus); // 아르페지오
        if (T.mel[i]) tone(mf(T.mel[i]), tt, spb * 1.7, T.lead, T.lead === 'triangle' ? 0.3 : 0.14, bgmBus); // 멜로디
        if (i % 8 === 4) noise(tt, 0.05, 0.12, 5000, bgmBus); // 작은 박자
      }
      step = (step + 4) % 64;
      bgmTimer = setTimeout(bgmTick, spb * 4 * 1000 - 20);
    }
    const bgmVol = () => vol('mp2026.bgm', 60);
    function stopAll() { bgmOn = false; clearTimeout(bgmTimer); if (audio) { audio.pause(); audio = null; } }
    // which: 'peace' | 'village' | 'mystic' | 'off' | 'f:<파일 주소>' | 'random'
    function bgm(which) {
      if (!init()) return; ac.resume();
      if (which === true) which = 'peace'; if (which === false) which = 'off';
      if (which === 'random') { const keys = Object.keys(TRACKS).concat((FILES || []).map((f) => 'f:/bgm/' + f.id)); which = keys[Math.floor(Math.random() * keys.length)]; }
      if (which === playing) return; playing = which; stopAll();
      if (which === 'off' || bgmVol() <= 0) return;
      if (which.startsWith('f:')) { audio = new Audio(which.slice(2)); audio.loop = true; audio.volume = Math.min(1, bgmVol()); audio.play().catch(() => {}); return; }
      if (!TRACKS[which]) return;
      cur = which; bgmOn = true; step = 0; bgmTick();
    }
    let playing = null, FILES = [];
    function setVol(kind, v) { store(kind === 'bgm' ? 'mp2026.bgm' : 'mp2026.sfx', v); if (!ac) return; if (kind === 'bgm') { bgmBus.gain.value = v / 100 * 0.55; if (audio) audio.volume = Math.min(1, v / 100); if (v > 0 && !bgmOn && !audio && playing && playing !== 'off') { const p = playing; playing = null; bgm(p); } } else sfxBus.gain.value = v / 100 * 0.5; }
    function setFiles(f) { FILES = f || []; }
    return { play, bgm, setVol, setFiles, tracks: TRACKS };
  })();
  // 버튼 누를 때 딸깍
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('button')) SND.play('click'); }, true);

  // ------------------------------------------------------------ 타이틀 화면 + 여신 오프닝
  // 들어올 때마다: 로고 + 뒤에 지도 아무 곳이 천천히 흘러감 → Enter 로 시작
  // 처음 온 사람(이름 없음): 여신이 부르고 → 이름 → 세계 설명 → 로고 → 건국 창
  const EDIT_MODE = /[?&]edit=1/.test(location.search);
  let needFound = false, titleDone = false, BGM_CUR = 'peace'; // 관리자가 고른 게임 안 배경음악
  const TITLE = { on: false, x: 0, y: 0, vx: 0, vy: 0 };
  let lastDt = 0.016; const dt0 = () => lastDt;
  // 로고: 작게 그린 글자에 도트 테두리·그림자를 붙인 뒤 크게 키움 (MP + 이세계)
  function makeLogo(cv) {
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'monospace';
    const W2 = 112, H2 = 74; cv.width = W2; cv.height = H2; const g = cv.getContext('2d');
    const layer = (text, px, y, fill, edge, drop) => {
      const m = document.createElement('canvas'); m.width = W2; m.height = H2; const mg = m.getContext('2d');
      mg.font = `${px}px ${font}`; mg.textAlign = 'center'; mg.textBaseline = 'top'; mg.fillStyle = '#fff'; mg.fillText(text, W2 / 2, y);
      const a = mg.getImageData(0, 0, W2, H2).data, on = (x, yy) => x >= 0 && yy >= 0 && x < W2 && yy < H2 && a[(yy * W2 + x) * 4 + 3] > 110;
      const out = g.getImageData(0, 0, W2, H2), d = out.data, put = (x, yy, c) => { if (x < 0 || yy < 0 || x >= W2 || yy >= H2) return; const i = (yy * W2 + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; };
      const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
      const E = hex(edge), D = hex(drop), F = hex(fill), F2 = hex('#ffffff');
      for (let yy = 0; yy < H2; yy++) for (let x = 0; x < W2; x++) if (on(x, yy)) { for (let k = 1; k <= 3; k++) put(x, yy + k + 1, D); } // 아래 그림자
      for (let yy = 0; yy < H2; yy++) for (let x = 0; x < W2; x++) if (on(x, yy)) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(x + dx, yy + dy, E); // 테두리
      for (let yy = 0; yy < H2; yy++) for (let x = 0; x < W2; x++) if (on(x, yy)) put(x, yy, on(x, yy - 1) ? F : F2); // 글자 (윗줄은 밝게)
      g.putImageData(out, 0, 0);
    };
    layer('MP', 38, 2, '#f1ecff', '#2b2340', '#6b4fb3');
    layer('이세계', 17, 50, '#ffd34d', '#2b2340', '#c22f53');
  }
  function startTitle() {
    for (const cv of document.querySelectorAll('canvas.logoCv')) if (!cv.dataset.done) { makeLogo(cv); cv.dataset.done = 1; }
    const cand = terrs.filter((t) => t && !gone[t.id]);
    const t = cand[Math.floor(Math.random() * cand.length)] || home;
    TITLE.x = t.center[0] * TILE; TITLE.y = t.center[1] * TILE; const a = Math.random() * Math.PI * 2; TITLE.vx = Math.cos(a) * 22; TITLE.vy = Math.sin(a) * 14;
    TITLE.on = true; document.body.classList.add('titling'); $('title').hidden = false; $('tSet').hidden = true;
    // 타이틀 음악: 아무 곡이나 (브라우저는 처음 클릭·키를 누른 뒤에만 소리를 냄)
    const startTitleMusic = () => { if (TITLE.on) SND.bgm('random'); removeEventListener('pointerdown', startTitleMusic, true); removeEventListener('keydown', startTitleMusic, true); };
    addEventListener('pointerdown', startTitleMusic, true); addEventListener('keydown', startTitleMusic, true);
    try { $('tBgm').value = store('mp2026.bgm') ?? 60; $('tSfx').value = store('mp2026.sfx') ?? 70; $('tBgmV').textContent = $('tBgm').value + '%'; $('tSfxV').textContent = $('tSfx').value + '%'; } catch (e) { /* 없음 */ }
  }
  function endTitle() {
    if (!TITLE.on) return;
    TITLE.on = false; document.body.classList.remove('titling'); $('title').hidden = true; titleDone = true;
    SND.bgm(BGM_CUR); SND.play('open');
    invalidateChunks(); mapSig = '';
    const firstTime = ONLINE ? !nameSet : !store('mp2026.opened');
    if (firstTime) startOpening(); else { if (needFound) openFound('who'); maybeDoomPopup(); }
  }
  $('tStart').addEventListener('click', endTitle);
  $('title').addEventListener('click', (e) => { if (e.target === $('title') || e.target.classList.contains('tstart')) endTitle(); });
  $('tSettings').addEventListener('click', () => { $('tSet').hidden = !$('tSet').hidden; });
  $('tReplay').addEventListener('click', () => { // 오프닝 다시 보기 (이름은 묻지 않음)
    TITLE.on = false; document.body.classList.remove('titling'); $('title').hidden = true; SND.bgm('mystic'); startOpening('replay');
  });
  $('tBgm').addEventListener('input', () => { SND.setVol('bgm', +$('tBgm').value); $('tBgmV').textContent = $('tBgm').value + '%'; });
  $('tSfx').addEventListener('input', () => { SND.setVol('sfx', +$('tSfx').value); $('tSfxV').textContent = $('tSfx').value + '%'; SND.play('coin'); });
  $('tCoupon').addEventListener('click', () => { $('coupon').hidden = false; $('coupon').style.zIndex = 60; setTimeout(() => $('couponIn').focus(), 50); });

  // 여신 대사: dim = 화면 밝기(처음엔 어둡다가 밝아짐), input = 이름 적기
  const OP = { on: false, i: 0, shown: 0, t0: 0, typing: false, raf: 0, flash: 0 };
  const OP_LINES = [
    { who: '???', text: '……어님', dim: 0.12 },
    { who: '???', text: '……레이어님', dim: 0.35 },
    { who: '???', text: '플레이어님……!', dim: 1, shake: true },
    { who: '여신', text: '아, 드디어 눈을 뜨셨군요. 다행이에요.' },
    { who: '여신', text: '저는 이 세계를 지켜보는 여신이에요.' },
    { who: '여신', text: '당신은 이 세계에 초대되었습니다. 부디 이곳을 함께 꾸려 나가 주세요.' },
    { who: '여신', text: '먼저…… 당신의 이름은 무엇인가요?', input: true },
    { who: '여신', text: () => `${player.name}님…… 좋은 이름이에요.` },
    { who: '여신', text: '이 땅은 227개의 영토로 나뉘어 있어요. 동료들과 나라를 세우고, 제단의 퍼즐을 풀어 땅을 넓혀 주세요.' },
    { who: '여신', text: '3일차부터는 영역전이 시작돼요. 매일 점심 1시와 밤 10시, 전선에 병력을 나눠 싸우게 될 거예요.' },
    { who: '여신', text: '그리고…… 아니에요. 그 이야기는 조금 나중에 할게요.' },
    { who: '여신', text: '자, 이제 당신의 나라를 세우러 가 볼까요?' },
  ];
  // 다시 보기: 이름은 이미 아니까 묻지 않음 / 이름 바꾸기: 여신이 나와서 새 이름을 물어봄
  const OP_REPLAY = OP_LINES.map((L) => (L.input ? { who: '여신', text: () => `당신의 이름은…… '${player.name}'(이)군요.` } : L)).filter((L, i) => i !== 7);
  const OP_RENAME = [
    { who: '여신', text: () => `${player.name}님, 부르셨나요?` },
    { who: '여신', text: () => `이름을 바꾸고 싶으신가요? 새 이름을 다시 알려주세요. (남은 변경 ${renamesLeft}번)`, input: true },
    { who: '여신', text: () => `${player.name}님…… 새 이름이 잘 어울려요.` },
  ];
  let OPL = OP_LINES, opMode = 'first';
  const opText = (L) => (typeof L.text === 'function' ? L.text() : L.text);
  function startOpening(mode = 'first') { opMode = mode; OPL = mode === 'replay' ? OP_REPLAY : mode === 'rename' ? OP_RENAME : OP_LINES; OP.on = true; OP.i = 0; $('opening').hidden = false; showLine(); cancelAnimationFrame(OP.raf); const loop = (n) => { drawOpening(n / 1000); if (OP.on) OP.raf = requestAnimationFrame(loop); }; OP.raf = requestAnimationFrame(loop); }
  function showLine() {
    const L = OPL[OP.i]; OP.t0 = performance.now(); OP.shown = 0; OP.typing = true;
    $('opWho').textContent = L.who; $('opInput').hidden = true; $('opNext').hidden = true;
    if (L.shake) { $('opening').classList.remove('shake'); void $('opening').offsetWidth; $('opening').classList.add('shake'); }
  }
  function tickType() {
    if (!OP.on) return;
    const L = OPL[OP.i]; if (!L) return; const full = opText(L);
    if (OP.typing) { OP.shown = Math.min(full.length, Math.floor((performance.now() - OP.t0) / 45)); if (OP.shown >= full.length) { OP.typing = false; if (L.input) { $('opInput').hidden = false; $('opNick').value = player.name && player.name !== '나' ? player.name : ''; setTimeout(() => $('opNick').focus(), 30); } else $('opNext').hidden = false; } }
    $('opText').textContent = full.slice(0, OP.shown);
  }
  function opAdvance() {
    if (!OP.on || OP.flash) return;
    const L = OPL[OP.i];
    if (OP.typing) { OP.typing = false; OP.shown = opText(L).length; tickType(); if (L.input) { $('opInput').hidden = false; setTimeout(() => $('opNick').focus(), 30); } else $('opNext').hidden = false; return; }
    if (L.input) return; // 이름을 정해야 넘어감
    if (++OP.i < OPL.length) showLine(); else finishOpening();
  }
  function opName() {
    const v = $('opNick').value.trim();
    if (v.length < 1) { toast('이름을 적어 주세요'); return; }
    const go = () => { $('opInput').hidden = true; OP.i++; showLine(); };
    if (opMode === 'rename') { // 이름 바꾸기: 서버가 확인 (겹치면 안내, 남은 횟수 차감)
      if (v === player.name) { toast('지금 이름과 같아요'); return; }
      if (renamesLeft <= 0) { toast('이름은 더 바꿀 수 없어요'); return; }
      if (!netOn) { toast('서버에 연결하는 중이에요'); return; }
      nameNext = go; ws.send(JSON.stringify({ t: 'setName', name: v })); return;
    }
    $('fNick').value = v;
    withName(go);
  }
  function finishOpening() { // 로고가 딱 나오고 → 건국 창 (다시 보기면 타이틀로, 이름 바꾸기면 바로 닫힘)
    if (opMode === 'rename') { OP.on = false; $('opening').hidden = true; toast(`이름을 '${player.name}'(으)로 바꿨어요 · 남은 변경 ${renamesLeft}번`); return; }
    if (opMode === 'replay') { OP.flash = performance.now(); $('opBox').hidden = true; $('opLogo').hidden = false; setTimeout(() => { OP.on = false; OP.flash = 0; $('opening').hidden = true; $('opLogo').hidden = true; $('opBox').hidden = false; startTitle(); }, 2600); return; }
    OP.flash = performance.now(); $('opBox').hidden = true; $('opLogo').hidden = false;
    setTimeout(() => { OP.on = false; OP.flash = 0; $('opening').hidden = true; $('opLogo').hidden = true; $('opBox').hidden = false; store('mp2026.opened', 1); SND.bgm(BGM_CUR); if (needFound || !ONLINE) openFound('who'); else maybeDoomPopup(); }, 2600);
  }
  $('opening').addEventListener('click', (e) => { if (!e.target.closest('#opInput')) opAdvance(); });
  $('opOk').addEventListener('click', opName);
  $('opNick').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); opName(); } });
  addEventListener('keydown', (e) => {
    if (!(TITLE.on || OP.on) || (e.target && e.target.tagName === 'INPUT')) return;
    e.stopImmediatePropagation(); // 타이틀·오프닝 중에는 게임 키(E, 채팅 등)가 안 먹게
    if (TITLE.on && (e.key === 'Enter' || e.key === ' ') && $('coupon').hidden) { e.preventDefault(); endTitle(); return; }
    if (OP.on && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); opAdvance(); }
  }, true);
  // 오프닝 화면: 별이 흐르는 밤하늘 + 빛나는 여신 (후광·날개)
  const opCv = $('opCanvas');
  function drawOpening(t) {
    tickType();
    const W2 = opCv.clientWidth, H2 = opCv.clientHeight; if (opCv.width !== W2 || opCv.height !== H2) { opCv.width = W2; opCv.height = H2; }
    const g = opCv.getContext('2d'); g.imageSmoothingEnabled = false;
    const L = OPL[Math.min(OP.i, OPL.length - 1)], dim = OP.flash ? Math.max(0, 1 - (performance.now() - OP.flash) / 300) : L.dim == null ? 1 : L.dim; // 로고가 나오면 여신은 사라짐
    const grd = g.createLinearGradient(0, 0, 0, H2); grd.addColorStop(0, '#0b0820'); grd.addColorStop(1, '#2a1a4a'); g.fillStyle = grd; g.fillRect(0, 0, W2, H2);
    for (let i = 0; i < 140; i++) { const x = (hash(i, 1, 5) * W2 + t * (6 + hash(i, 2, 5) * 14)) % W2, y = hash(i, 3, 5) * H2 * 0.85, tw = 0.5 + 0.5 * Math.sin(t * 2 + i); g.fillStyle = `rgba(255,${230 + (i % 25)},255,${(0.25 + 0.6 * tw) * Math.max(0.3, dim)})`; g.fillRect(x | 0, y | 0, i % 7 ? 2 : 3, i % 7 ? 2 : 3); }
    const sc = Math.max(4, Math.min(9, Math.floor(H2 / 110))), cx = W2 / 2, cy = H2 * 0.42 + Math.sin(t * 1.6) * 6;
    g.save(); g.globalAlpha = dim;
    // 빛무리
    const glow = g.createRadialGradient(cx, cy, 10, cx, cy, sc * 34); glow.addColorStop(0, 'rgba(255,240,200,0.55)'); glow.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = glow; g.fillRect(cx - sc * 40, cy - sc * 40, sc * 80, sc * 80);
    // 날개 (도트 타원 여러 겹)
    for (const sgn of [-1, 1]) for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? '#e9ecff' : '#ffffff'; const wx = cx + sgn * sc * (8 + k * 3), wy = cy - sc * (4 - k * 1.5); g.fillRect(Math.round(wx - sc * 3), Math.round(wy - sc * 6 + Math.sin(t * 3 + k) * sc * 0.6), sc * 6, sc * (10 - k)); }
    // 후광
    g.strokeStyle = '#ffd34d'; g.lineWidth = sc; g.beginPath(); g.ellipse(cx, cy - sc * 17, sc * 7, sc * 2, 0, 0, Math.PI * 2); g.stroke();
    // 여신 (AetherAI 캐릭터 #20)
    if (ART.aether) { const k = 20, sx = (k % 8) * 32, sy = Math.floor(k / 8) * 32; g.drawImage(ART.aether, sx, sy, 32, 32, Math.round(cx - 16 * sc), Math.round(cy - 18 * sc), 32 * sc, 32 * sc); }
    // 반짝이
    for (let i = 0; i < 10; i++) { const a = t * 0.8 + i * 0.63, r = sc * (22 + 4 * Math.sin(t + i)); g.fillStyle = '#fff6c8'; g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.7), sc, sc); }
    g.restore();
    if (OP.flash) { const k = Math.min(1, (performance.now() - OP.flash) / 400); g.fillStyle = `rgba(255,255,255,${1 - k})`; g.fillRect(0, 0, W2, H2); }
  }

  // ------------------------------------------------------------ 시작
  function setupDoomCard() {
    const date = 13 + DAY;
    if (!DOOM) {
      $('doomL').textContent = '';
      $('doomD').textContent = `${DAY}일차`;
      $('doomR').textContent = `12/${date} · ${ONLINE ? SLOT_NAME[SLOT] : PHASE}`;
      $('doomBar').hidden = true;
    } else {
      $('doomL').textContent = '세계 멸망까지';
      $('doomD').textContent = DAY >= LAST_DAY ? 'D-Day' : `D-${LAST_DAY - DAY}`;
      $('doomR').textContent = `${DAY}일차 · ${SLOT_NAME[SLOT]}`;
      $('doomFill').style.width = `${Math.round((DAY - DOOM_DAY + 1) / (LAST_DAY - DOOM_DAY + 1) * 100)}%`;
      $('doomBar').hidden = false;
    }
  }

  Promise.all([loadWorld(), loadArt()]).then(([data]) => {
    setupWorld(data);
    buildBaseSheet();
    buildRooms();
    buildMapImage();
    spawnBots();
    resize();
    goHome();
    $('toast').hidden = true;
    setupDoomCard();
    renderInv();
    // 온라인: 서버가 내 자리를 알려줄 때까지 로딩 화면을 유지 → 자리로 옮긴 뒤 끔 (수도에 잠깐 보였다가 순간이동하는 것 방지)
    if (ONLINE) { $('loadingText').textContent = '내 자리로 가는 중…'; $('loadingSub').textContent = '서버에 접속하고 있어요'; setTimeout(hideLoading, 12000); startOnline(); }
    else { needFound = true; hideLoading(); }
    if (ONLINE && /[?&]edit=1/.test(location.search)) setTimeout(startEditor, 1200);
    if (DAY === 5) setTimeout(() => toast('신들이 선포했다: 12월 28일, 이 세계는 끝난다.'), 600);
    else if (DOOM) { const n = terrs.filter((t) => t && gone[t.id]).length; if (n) setTimeout(() => toast(`균열이 영토 ${n}곳을 삼켰다`), 600); }
    requestAnimationFrame((n) => { last = n; frame(n); });
  }).catch((err) => {
    $('loadingText').textContent = '지도를 불러오지 못했어요';
    $('loadingSub').textContent = err.message;
  });
})();
