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
    if (t === T.WATER && TILES[y * W + x] && TILES[y * W + x].k === 'bridge') return false; // 다리 위는 걸을 수 있음
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
  // ------------------------------------------------------------ 단차 (시험 구역): 산 둘레가 고원(1·2단), 남쪽으로 떨어지는 곳에 돌 절벽, 군데군데 계단
  const PILOT = { x0: 424, y0: 520, x1: 496, y1: 592 };
  let HGT = null;
  function buildHeights() { // 큰 덩어리 잡음(약 14칸)으로 넓은 고원 → 얇은 부분 깎기 → 가운데만 2단. 제단 둘레·구역 가장자리는 평지
    const { x0, y0, x1, y1 } = PILOT, w = x1 - x0, h = y1 - y0;
    const vn = (x, y, s, salt) => { const gx = Math.floor(x / s), gy = Math.floor(y / s), fx = x / s - gx, fy = y / s - gy, sm = (t) => t * t * (3 - 2 * t), u = sm(fx), v = sm(fy), a = hash(gx, gy, salt), b = hash(gx + 1, gy, salt), c = hash(gx, gy + 1, salt), e = hash(gx + 1, gy + 1, salt); return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + e * u * v; };
    const alt = terrs.filter((t) => t && t.altar[0] >= x0 - 6 && t.altar[0] < x1 + 6 && t.altar[1] >= y0 - 6 && t.altar[1] < y1 + 6).map((t) => t.altar);
    const land = (x, y) => { const t = tileAt(x0 + x, y0 + y); return t === T.GRASS || t === T.FOREST || t === T.SAND; };
    const val = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const edge = Math.min(x, y, w - 1 - x, h - 1 - y), nearAlt = alt.some(([ax, ay]) => Math.hypot(x0 + x - ax, y0 + y - ay) < 6);
      val[y * w + x] = land(x, y) && !nearAlt ? vn(x0 + x, y0 + y, 14, 91) * 0.75 + vn(x0 + x, y0 + y, 6, 92) * 0.25 - Math.max(0, 8 - edge) * 0.06 : -1; }
    const level = (th) => { let m = new Uint8Array(w * h); for (let k = 0; k < m.length; k++) m[k] = val[k] > th ? 1 : 0;
      const morph = (src, grow) => { const o = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let any = 0, all = 1; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) ? 0 : src[(y + dy) * w + x + dx]; any |= v; all &= v; } o[y * w + x] = grow ? any : all; } return o; };
      m = morph(morph(m, 0), 0); m = morph(morph(m, 1), 1); /* 두 칸 깎고 두 칸 키우기 → 얇은 곳 없어짐 */ for (let k = 0; k < m.length; k++) if (val[k] < 0) m[k] = 0; return m; };
    const A = level(0.56), B = level(0.68), L = new Uint8Array(w * h);
    for (let k = 0; k < L.length; k++) L[k] = A[k] + (A[k] && B[k] ? 1 : 0);
    HGT = { L, w, h };
  }
  function hgt(x, y) { if (x < PILOT.x0 || y < PILOT.y0 || x >= PILOT.x1 || y >= PILOT.y1) return 0; if (!HGT) buildHeights(); return HGT.L[(y - PILOT.y0) * HGT.w + (x - PILOT.x0)]; }
  const FH = 2; /* 한 단 = 절벽 2칸 높이 */ const wallRow = (x, y) => { const h0 = hgt(x, y); for (let k = 1; k <= FH * 2; k++) { const up = hgt(x, y - k) - h0; if (up >= Math.ceil(k / FH)) { let top = k; while (top < FH * 2 && hgt(x, y - top - 1) - h0 >= Math.ceil((top + 1) / FH)) top++; return k; } } return 0; }; // 몇 번째 줄 벽인지 (1 = 맨 윗줄, 잔디 끝이 걸침)
  const isStair = (x, y) => wallRow(x, y) > 0 && ((x + Math.floor(hash(0, y - wallRow(x, y), 83) * 9)) % 11) < 2; // 절벽 11칸마다 2칸 너비 계단
  function heightBlocked(cx, cy, nx, ny) { if (wallRow(nx, ny) && !isStair(nx, ny)) return true; const a = isStair(cx, cy) ? -1 : hgt(cx, cy) + (wallRow(cx, cy) ? 0 : 0), b = isStair(nx, ny) ? -1 : hgt(nx, ny); if (a === -1 || b === -1) return cx !== nx; /* 계단은 위아래로만 */ return a !== b; }
  function treeAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H || noTree[y * W + x] || GCLEAR.has(y * W + x) || wallRow(x, y) || wallRow(x, y + 1) === 1) return null; // 절벽과 바로 위 칸엔 나무 없음
    const t = tileAt(x, y);
    if (t !== T.FOREST && t !== T.GRASS) return null;
    if (ART.w_wsh && (!isLand(x - 1, y) || !isLand(x + 1, y) || !isLand(x, y - 1) || !isLand(x, y + 1) || !isLand(x - 1, y + 1) || !isLand(x + 1, y + 1))) return null; // 물가 바로 옆엔 나무 없음 (물 위에 선 것처럼 보임)
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
  const DROWN = { t: 0, sent: -1e9, msg: '' };
  let LAKE = null; function isLake(x, y) { if (x < 0 || y < 0 || x >= W || y >= H) return false; if (!LAKE) { // 맵 밖 바다에서 물길로 이어진 물 = 바다, 나머지 물 = 호수
      const sea = new Uint8Array(W * H), q = []; for (let i = 0; i < W * H; i++) { const ix = i % W, iy = (i / W) | 0; if (terrain[i] === T.VOID || ((ix === 0 || iy === 0 || ix === W - 1 || iy === H - 1) && terrain[i] === T.WATER)) { sea[i] = 1; q.push(i); } }
      while (q.length) { const i = q.pop(), ix = i % W, iy = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = ix + dx, b = iy + dy; if (a < 0 || b < 0 || a >= W || b >= H) continue; const j = b * W + a; if (!sea[j] && (terrain[j] === T.WATER || terrain[j] === T.VOID)) { sea[j] = 1; q.push(j); } } }
      LAKE = sea; } const i = y * W + x; return terrain[i] === T.WATER && !LAKE[i]; }
  function swimmable(x, y) { if (x < 0 || y < 0 || x >= W || y >= H || !ART.w_wsh) return false; const t = tileAt(x, y), e = TILES[y * W + x]; return (t === T.VOID || (t === T.WATER && !isLake(x, y) && !narrowWater(x, y))) && !(e && e.k === 'water') && !GWALL.has(y * W + x); } // 바다만 들어갈 수 있음 (호수·강은 다리로)
  const narrowC = new Map(); function narrowWater(x, y) { const k = y * W + x; let v = narrowC.get(k); if (v != null) return v; const landIn = (dx, dy) => { for (let i = 1; i <= 4; i++) if (isLand(x + dx * i, y + dy * i)) return true; return false; };
    v = (landIn(1, 0) && landIn(-1, 0)) || (landIn(0, 1) && landIn(0, -1)); narrowC.set(k, v); return v; } // 양쪽에 땅이 가까운 좁은 물 = 강 // 물에 들어갈 수 있음 (깊으면 잠김)
  function depthAtPx(px, py) { const fx = px / TILE - 0.5, fy = py / TILE - 0.5, x = Math.floor(fx), y = Math.floor(fy), u = fx - x, v = fy - y, dd = (a, b) => (TILES[b * W + a] && TILES[b * W + a].k === 'bridge' ? 0 : waterDepth(a, b));
    return dd(x, y) * (1 - u) * (1 - v) + dd(x + 1, y) * u * (1 - v) + dd(x, y + 1) * (1 - u) * v + dd(x + 1, y + 1) * u * v; }
  const sinkOf = (o) => (player.scene === 'ground' && ART.w_wsh && !isLand(Math.floor(o.x / TILE), Math.floor(o.y / TILE)) ? Math.pow(Math.max(0, Math.min(1, (depthAtPx(o.x, o.y) - 0.75) / 3.75)), 2.4) : 0);
  function sinkSmooth(o) { const g = sinkOf(o), nw = performance.now(), dt = Math.min(0.1, (nw - (o._skT || nw)) / 1000); o._skT = nw; const c = o._sk || 0; o._sk = g > c ? Math.min(g, c + dt * 0.35) : Math.max(g, c - dt * 1.2); return o._sk; } // 천천히 잠기고 나올 땐 빨리 // 모래 위에선 안 잠김, 첫 물칸은 발만 // 0 = 안 잠김, 1 = 머리만
  function speedAt(x, y) { if (swimmable(x, y) && !(TILES[y * W + x] && TILES[y * W + x].k === 'bridge')) return 0.55; const e = TILES[y * W + x]; if (e && (e.k === 'floor' || e.under) && e.n === MY_NID) return MPRules.NUM.floorSpeed; const t = tileAt(x, y); return t === T.FOREST ? 0.7 : t === T.SAND ? 0.85 : 1; }

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
    for (const t of data.territories) if (t.portal) t.portal = MPRules.portalSpot(Object.assign({}, t, { portal: null }), tileAt); // 포털 기본 자리: 비석 옆
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
      // 깃발은 없앰 (영토마다 의미가 없어서). 하늘 포털은 나라마다 옮길 수 있어서 drawGround 에서 그때그때 그림
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
  function drawPortal(g, x, y, mine) { const im = ART.x_portal_blue; if (im) { // 받은 소용돌이 포털 그림 (움직임)
      const n = 9, fw = im.width / n, f = Math.floor(performance.now() / 100) % n, t = performance.now() / 1000, bob = Math.round(Math.sin(t * 1.6) * 1) * 2, k = 2, w = fw * k, h = im.height * k;
      g.fillStyle = 'rgba(80,170,255,0.25)'; ell(g, x, y, 40, 11);
      const pv = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.drawImage(im, f * fw, 0, fw, im.height, Math.round(x - w / 2), Math.round(y - h + bob - 4), w, h); g.imageSmoothingEnabled = pv;
      if (mine) { g.font = `700 15px ${PFONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 4; g.strokeStyle = '#2b2340'; g.strokeText('수도', x, y - h - 14); g.fillStyle = '#fff6c8'; g.fillText('수도', x, y - h - 14); }
      return; }
    drawPortalOld(g, x, y, mine); }
  function drawPortalOld(g, x, y, mine) { // 하늘 포털: 구름 받침 위에 떠 있는 금빛 고리 문 + 안쪽 하늘 소용돌이 + 위로 오르는 빛 알갱이
    const t = performance.now() / 1000, bob = Math.round(Math.sin(t * 1.6) * 2), cy = y - 46 + bob;
    g.fillStyle = 'rgba(255,236,140,0.28)'; ell(g, x, y, 34, 10);
    g.fillStyle = '#dbe7fb'; for (const [dx, r] of [[-22, 9], [-8, 12], [8, 12], [22, 9]]) pxDisc(g, x + dx, y - 6, r); g.fillStyle = '#ffffff'; for (const [dx, r] of [[-22, 7], [-8, 10], [8, 10], [22, 7]]) pxDisc(g, x + dx, y - 9, r);
    const grd = g.createRadialGradient(x, cy, 4, x, cy, 30); grd.addColorStop(0, 'rgba(255,250,210,0.95)'); grd.addColorStop(0.5, 'rgba(150,215,255,0.85)'); grd.addColorStop(1, 'rgba(110,170,240,0.75)');
    g.fillStyle = grd; g.beginPath(); g.ellipse(x, cy, 22, 28, 0, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.ellipse(x, cy, 22, 28, 0, 0, Math.PI * 2); g.clip(); // 소용돌이
    for (let k = 0; k < 3; k++) { g.strokeStyle = `rgba(255,255,255,${0.55 - k * 0.12})`; g.lineWidth = 2; g.beginPath(); for (let a = 0; a < 5.5; a += 0.25) { const r = 3 + a * 3.4, an = a + t * (1.6 + k * 0.4) + k * 2.1; const px = x + Math.cos(an) * r * 0.8, py = cy + Math.sin(an) * r; if (a === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke(); }
    g.restore();
    g.strokeStyle = '#2b2340'; g.lineWidth = 8; g.beginPath(); g.ellipse(x, cy, 25, 31, 0, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#e8c260'; g.lineWidth = 5; g.beginPath(); g.ellipse(x, cy, 25, 31, 0, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#fff0b0'; g.lineWidth = 2; g.beginPath(); g.ellipse(x, cy, 25, 31, 0, Math.PI * 1.1, Math.PI * 1.6); g.stroke();
    for (let k = 0; k < 8; k++) { const an = k / 8 * Math.PI * 2 + t * 0.5, px = x + Math.cos(an) * 25, py = cy + Math.sin(an) * 31; g.fillStyle = k % 2 ? '#7fd0ff' : '#ffffff'; g.fillRect(Math.round(px) - 2, Math.round(py) - 2, 4, 4); } // 고리의 보석
    g.fillStyle = '#ffd84d'; g.fillRect(x - 3, cy - 40, 6, 6); g.fillStyle = '#fff6c8'; g.fillRect(x - 1, cy - 44, 2, 14); g.fillRect(x - 7, cy - 38, 14, 2); // 꼭대기 별
    for (let k = 0; k < 6; k++) { const u = (t * 0.5 + k / 6) % 1; g.globalAlpha = 1 - u; g.fillStyle = k % 2 ? '#fff6c8' : '#bfe9ff'; g.fillRect(Math.round(x + Math.sin(k * 2.3 + t) * 16), Math.round(cy - 10 - u * 70), 3, 3); }
    g.globalAlpha = 1;
    if (mine) { g.font = `700 15px ${PFONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 4; g.strokeStyle = '#2b2340'; g.strokeText('수도', x, cy - 58); g.fillStyle = '#fff6c8'; g.fillText('수도', x, cy - 58); }
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
    const ob = ART.x_obelisk; let top = y - 60, bx = x - 32 + sx, bw = 64, bh = 64;
    if (ob) { const n = 32, fw = ob.width / n, fo = Math.floor(performance.now() / 80 + t.id * 5) % n; bw = fw * 2; bh = ob.height * 2; bx = x - 44 + sx; top = y + 6 - 156; g.drawImage(ob, fo * fw, 0, fw, ob.height, bx, top, bw, bh); } /* 2배로 크게 */ // 수정 대신 룬 비석
    else g.drawImage(altarSheet(t.type), f * 32, 0, 32, 32, x - 32 + sx, y - 60, 64, 64);
    const hn = HITN.get(t.id); // 내가 때린 횟수
    if (hn && performance.now() - hn.at < 60000 && hn.n < MPRules.NUM.scoutHits) { g.font = `700 16px ${PFONT}`; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = '#2b2340'; g.strokeText(`${hn.n}/${MPRules.NUM.scoutHits}`, x, top - 10); g.fillStyle = '#ffd34d'; g.fillText(`${hn.n}/${MPRules.NUM.scoutHits}`, x, top - 10); }
    if (hot) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,40,60,0.55)'; g.fillRect(bx, top, bw, bh); g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(255,60,80,0.35)'; ell(g, x + sx, y - 34, 22, 26); }
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
    const names = { w_wsh: 'world/water_shallow.png', w_wmd: 'world/water_mid.png', w_wdp: 'world/water_deep.png', w_grass: 'world/grass.png', w_forest: 'world/forest.png', ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => ['wt_big' + i, 'world/big' + i + '.png'])), ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ['wt_mid' + i, 'world/mid' + i + '.png'])), aether: 'aether/aether.png', k_winter: 'winter/winter.png', k_town: 'kenney/town.png', k_dungeon: 'kenney/dungeon.png', k_onebit: 'kenney/onebit.png', water: 'na/water.png', floor: 'ninja/floor.png', village: 'ninja/village.png', chars: 'na/chars.png', faces: 'na/faces.png', towers: 'na/towers.png', flags: 'na/flags.png' };
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
  const EXTRA = ['door_isaac', 'door_isaac_down', 'sky_floor', 'obelisk', 'portal_red', 'portal_blue', 'door_gold', 'door_cloud', 'store1', 'store2', 'store3', 'store4', 'coin', 'cloud', 'burst', 'pin', 'tower', 'marble', 'stonefloor', 'carpet', 'grass', 'dirt', 'pillar', 'candelabra', 'rosewin', 'tomb', 'altar', 'book', 'candles', 'chalice', 'key', 'bishop', 'keeper', 'tent', 'cabin', 'campfire', 'woodpile', 'log', 'boulder', 'boulder_sm', 'flower_r', 'flower_y', 'mushroom', 'fern', 'stump', 'berry'];
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
  const SP = { treeA: [0, 96, 64, 48], treeB: [0, 144, 64, 48], midA: [64, 96, 32, 32], midB: [64, 144, 32, 32], stone: [112, 80, 32, 32], bush: [64, 80, 32, 16], house: [192, 97, 64, 79], house2: [256, 96, 64, 70] };
  // 새 나무: 큰 나무(treeA·B) 6종 / 작은 나무(midA·B) 8종 중 칸마다 하나. 그림자는 해 방향으로 눕히고, 잎(위쪽 절반)만 바람에 살랑
  const WT = { big: [], mid: [] };
  function worldTrees() { if (WT.ready || !ART.wt_big0) return WT.ready; for (const kind of ['big', 'mid']) for (let i = 0; ART['wt_' + kind + i]; i++) { const im = ART['wt_' + kind + i], c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const q = c.getContext('2d'); q.drawImage(im, 0, 0); q.globalCompositeOperation = 'source-in'; q.fillStyle = 'rgba(20,30,40,1)'; q.fillRect(0, 0, c.width, c.height); WT[kind].push({ im, sil: c }); } return (WT.ready = true); }
  const SHADOW = { morning: [0.75, 0.5, 0.3], lunch: [0.15, 0.32, 0.32], night: [-0.3, 0.38, 0.16] }; // [기울기, 길이, 진하기]: 아침은 길게, 점심은 짧게, 밤은 달빛으로 옅게
  let sunCache = { t: 0, v: SHADOW.lunch };
  function sunShadow() { // 실제 시각(한국)을 따라 해가 동→서로: 아침엔 그림자가 서쪽으로 길게, 낮엔 짧게, 저녁엔 동쪽으로 길게, 밤엔 옅은 달 그림자
    const now = Date.now(); if (now - sunCache.t < 1000) return sunCache.v; const d = new Date(now + 9 * 3600e3), h = d.getUTCHours() + d.getUTCMinutes() / 60;
    let v; if (h >= 6 && h <= 19) { const a = (h - 6) / 13; v = [(0.5 - a) * 1.8, 0.22 + Math.abs(a - 0.5) * 0.9, 0.3]; } else v = SHADOW.night;
    if (SLOT === 'night' && ONLINE) v = SHADOW.night; sunCache = { t: now, v }; return v; }
  // 캐릭터가 나무 그림자에 들어가면 겹친 부분만 어둡게: 보이는 나무 그림자를 한 장(그림자 지도)에 모아 두고, 캐릭터를 그릴 때 그 지도와 겹치는 곳만 칠함
  const SHADE = { on: false, cv: document.createElement('canvas'), x0: 0, y0: 0, tmp: document.createElement('canvas'), al: 0.3 };
  function buildShadeMask(tx0, tx1, ty0, ty1) {
    SHADE.on = false; if (!worldTrees()) return; const x0 = tx0 * TILE, y0 = ty0 * TILE - 80, w = (tx1 - tx0 + 1) * TILE, h = (ty1 - ty0 + 1) * TILE + 160;
    if (SHADE.cv.width !== w || SHADE.cv.height !== h) { SHADE.cv.width = w; SHADE.cv.height = h; }
    const g = SHADE.cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); const [sk, len, al] = sunShadow(); SHADE.al = al; SHADE.x0 = x0; SHADE.y0 = y0; let any = false;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) { const k = treeAt(tx, ty); if (!k) continue; const set = k === 'treeA' || k === 'treeB' ? WT.big : WT.mid, T2 = set[Math.floor(hash(tx, ty, 13) * set.length)], tw = T2.im.width * 2, th = T2.im.height * 2;
      g.save(); g.translate(tx * TILE + 16 - x0, ty * TILE + 30 - y0); g.transform(1, 0, sk, len, 0, 0); g.scale(1, -1); g.drawImage(T2.sil, -tw / 2, -th, tw, th); g.restore(); any = true; }
    SHADE.on = any;
  }
  function shadeBegin(o) { if (!SHADE.on || SHADE.disabled || player.scene !== 'ground') return null; const T3 = SHADE.tmp, L = Math.round(o.x - 64), Tp = Math.round(o.y - 112); if (T3.width !== 128) { T3.width = 128; T3.height = 128; } const g = T3.getContext('2d'); g.setTransform(1, 0, 0, 1, -L, -Tp); g.clearRect(L, Tp, 128, 128); g.imageSmoothingEnabled = false; return { g, L, Tp }; }
  function shadeEnd(S2) { const g = S2.g; g.save(); g.globalCompositeOperation = 'source-atop'; g.globalAlpha = Math.min(0.6, SHADE.al * 1.25); g.drawImage(SHADE.cv, S2.L - SHADE.x0, S2.Tp - SHADE.y0, 128, 128, S2.L, S2.Tp, 128, 128); g.restore(); const pv = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false; ctx.drawImage(SHADE.tmp, S2.L, S2.Tp); ctx.imageSmoothingEnabled = pv; }
  function drawWorldTree(g, k, tx, ty, X, Y, t) {
    if (!worldTrees()) { spr(g, k, X, Y); return; }
    const set = k === 'treeA' || k === 'treeB' ? WT.big : WT.mid, T2 = set[Math.floor(hash(tx, ty, 13) * set.length)], im = T2.im, w = im.width * 2, h = im.height * 2;
    const [sk, len, al] = sunShadow();
    g.save(); g.globalAlpha = al; g.translate(Math.round(X), Math.round(Y)); g.transform(1, 0, sk, len, 0, 0); g.scale(1, -1); g.drawImage(T2.sil, -w / 2, -h, w, h); g.restore();
    const sw = Math.sin(t * 1.4 + tx * 0.7 + ty * 1.3) * 3, base = Math.round(im.height * 0.6), pv = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    for (let sy = 0; sy < im.height; sy += 2) { const k = sy >= base ? 0 : (base - sy) / base, o = Math.round(sw * k * k) * 2; /* 2칸씩 잘게: 위로 갈수록 조금씩 더 휘어서 이음매 없음, 줄기는 고정 */
      g.drawImage(im, 0, sy, im.width, Math.min(2, im.height - sy), Math.round(X - w / 2) + o, Math.round(Y - h) + sy * 2, w, Math.min(2, im.height - sy) * 2); }
    g.imageSmoothingEnabled = pv;
  }
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
  // 피부색 팔레트 (0 = 원래 색)
  const SKINS_PAL = [null, '#ffe2c8', '#f7c9a2', '#e9a879', '#cf8c5c', '#a86a42', '#7a4a2c', '#9edb86', '#a9d6ff'];
  const SKIN_NAME = ['원래', '밝은', '살구', '복숭아', '구릿빛', '갈색', '진갈색', '연두', '하늘'];
  function charSheet(c, hi, sk = 0) {
    const key = c + ':' + hi + ':' + sk; let cv = sheets.get(key); if (cv) return cv;
    c = Math.max(0, Math.min(CHARS.names.length - 1, c | 0));
    cv = document.createElement('canvas'); cv.width = 64; cv.height = 112;
    const g = cv.getContext('2d'); g.drawImage(ART.chars, (c % CHARS.cols) * 64, Math.floor(c / CHARS.cols) * 112, 64, 112, 0, 0, 64, 112);
    hueShift(g, cv.width, cv.height, HUES[hi] || 0, SKINS_PAL[sk] || null);
    sheets.set(key, cv); return cv;
  }
  function hueShift(g, w, h, deg, skin) { // 옷 색 바꾸기 (피부 픽셀은 빼고) + 피부색 바꾸기
    const sk = skin && [parseInt(skin.slice(1, 3), 16), parseInt(skin.slice(3, 5), 16), parseInt(skin.slice(5, 7), 16)];
    if (deg || sk) {
      const d = g.getImageData(0, 0, w, h), px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        const r = px[i] / 255, gg = px[i + 1] / 255, b = px[i + 2] / 255;
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2, dd = mx - mn;
        if (dd < 0.12) continue; // 회색·검정·흰색(얼굴, 윤곽)은 그대로
        const sat = dd / (1 - Math.abs(2 * l - 1));
        let hh = mx === r ? ((gg - b) / dd) % 6 : mx === gg ? (b - r) / dd + 2 : (r - gg) / dd + 4;
        const h0 = (hh * 60 + 360) % 360, isSkin = h0 >= 12 && h0 <= 42 && sat >= 0.25 && sat <= 0.9 && l >= 0.5 && l <= 0.9; // 살구·주황빛 = 피부
        if (isSkin) { if (sk) { const k = l / 0.72; px[i] = Math.min(255, sk[0] * k); px[i + 1] = Math.min(255, sk[1] * k); px[i + 2] = Math.min(255, sk[2] * k); } continue; }
        if (!deg) continue;
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
  function drawSprite(g, x, y, look, t, moving, face, atk) {
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
      const sheet = charSheet(c - USER.chars.length, look.hue | 0, look.sk | 0);
      const row = atk ? 4 : moving ? (Math.floor(t * 8 + (look.seed || 0)) % 4) : 0; // 4번 줄 = 공격 동작
      g.drawImage(sheet, (face | 0) * 16, row * 16, 16, 16, Math.round(x - 8 * CH_K), Math.round(y - 16 * CH_K + 2), 16 * CH_K, 16 * CH_K);
      if (look.hat) drawHat(g, x, y - 16 * CH_K + 2 + CH_K * 3, look.hat, CH_K, face === 2); // 머리 장식
    }
    g.imageSmoothingEnabled = prev;
  }
  // 머리 장식 (어몽어스처럼 모자를 씀) — 직접 그린 도트, 아래쪽이 머리 꼭대기에 닿게
  const HAT_PAL = { Y: '#ffd84d', O: '#b8862b', R: '#e8423c', B: '#5b9cf0', W: '#ffffff', K: '#2b2340', k: '#4a3f5e', P: '#ff7fb1', p: '#c94a8a', G: '#5fbf6a', g: '#3f9a52', V: '#8a5fd6', v: '#5a3fa0', C: '#3d6fd6', c: '#2a4fa8', S: '#f4f8ff', s: '#cfd8ea', N: '#d6455b', n: '#a8303f', T: '#c98a4a' };
  const HATS = {
    crown: { name: '왕관', px: ['Y...YY...Y', 'YY.YYYY.YY', 'YYYYYYYYYY', 'YRYYBYYRYY', 'OOOOOOOOOO'] },
    party: { name: '파티 모자', px: ['...W...', '...P...', '..PPY..', '..YPP..', '.PPPYP.', '.PYPPP.', 'PPPPYPP', 'OOOOOOO'] },
    tophat: { name: '실크햇', px: ['..KKKKKK..', '..KkKKKK..', '..KkKKKK..', '..NNNNNN..', '..KKKKKK..', 'KKKKKKKKKK'] },
    cap: { name: '야구 모자', flip: true, px: ['..CCCCCC..', '.CCCWWCCC.', '.CCCCCCCC.', 'ccccccccccccc'] },
    beanie: { name: '털모자', px: ['....WW....', '..NNNNNN..', '.NNNNNNNN.', '.NnNnNnNn.', 'WWWWWWWWWW'] },
    flower: { name: '꽃핀', flip: true, px: ['.......PP...', '......PYYP..', '.......PP...', '............'] },
    bow: { name: '리본', px: ['PP.....PP', 'PPP.p.PPP', 'PPPpppPPP', 'PPP.p.PPP', 'PP.....PP'] },
    horns: { name: '악마 뿔', px: ['N..........N', 'NN........NN', '.NN......NN.', '.nN......Nn.'] },
    halo: { name: '천사 고리', lift: 4, px: ['..YYYYYY..', '.Y......Y.', '..YYYYYY..'] },
    wizard: { name: '마법사 모자', px: ['......V...', '.....VV...', '....VVV...', '....VYV...', '...VVVVV..', '...VVVYV..', '..VVVVVVV.', 'vvvvvvvvvv'] },
    sprout: { name: '새싹', px: ['GG.GG', 'GGgGG', '..g..', '..g..'] },
    cat: { name: '고양이 귀', px: ['K..........K', 'KK........KK', 'KPK......KPK', 'KKK......KKK'] },
    chef: { name: '요리사 모자', px: ['.SSSSSSS.', 'SSSsSSsSS', 'SSSSSSSSS', '.SSSSSSS.', '.sSSSSSs.', '.SSSSSSS.'] },
    viking: { name: '바이킹 투구', px: ['S..........S', 'SS..TTTT..SS', '.STTTTTTTTS.', '..TTTTTTTT..', '..OOOOOOOO..'] },
  };
  for (const k in HATS) HATS[k].cv = pxRows(HATS[k].px, HAT_PAL);
  function drawHat(g, x, top, id, k, flip) { const H = HATS[id]; if (!H || !H.cv) return; const w = H.cv.width * k, hh = H.cv.height * k, p = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.save(); g.translate(Math.round(x), Math.round(top + 2 * k - (H.lift || 0) * k)); if (flip && H.flip) g.scale(-1, 1); g.drawImage(H.cv, Math.round(-w / 2), -hh, w, hh); g.restore(); g.imageSmoothingEnabled = p; }
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

  // ------------------------------------------------------------ 새 해변: 해변 그림의 색 (물 5단계 + 거품 2 + 모래 3). 2px 칸 = 도트 1칸
  const BEACH = { foam: [252, 252, 252], foam2: [189, 238, 242], w1: [122, 228, 204], w2: [109, 220, 203], w3: [84, 188, 212], w4: [68, 169, 211], w5: [58, 130, 203], wet: [222, 172, 96], sand: [252, 206, 102], sand2: [246, 192, 93], sand3: [227, 166, 80], line: [28, 113, 107] };
  const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const isLand = (a, b) => { const q = tileAt(a, b); return q !== T.WATER && q !== T.VOID; };
  const depthCache = new Map();
  function waterDepth(x, y) { // 이 칸에서 가장 가까운 땅까지 거리 (칸, 최대 4.5). 땅이면 0
    if (isLand(x, y)) return 0; const k = y * W + x; let v = depthCache.get(k); if (v != null) return v; v = 4.5;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (isLand(x + dx, y + dy)) { const d = Math.hypot(dx, dy); if (d < v) v = d; }
    if (depthCache.size > 200000) depthCache.clear(); depthCache.set(k, v); return v; }
  const isGrassy = (a, b) => { const q = tileAt(a, b); return q === T.GRASS || q === T.FOREST; };
  const texPx = {}; function texPixel(key, wx, wy) { let T2 = texPx[key]; if (!T2) { const im = ART[key], c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const q = c.getContext('2d'); q.drawImage(im, 0, 0); T2 = texPx[key] = { d: q.getImageData(0, 0, im.width, im.height).data, w: im.width, h: im.height }; } const i = (((wy >> 1) % T2.h) * T2.w + ((wx >> 1) % T2.w)) * 4; return [T2.d[i], T2.d[i + 1], T2.d[i + 2]]; }
  const grassPixel = (wx, wy) => texPixel('w_grass', wx, wy);
  const jag = (wx, wy, s = 0) => (hash(wx >> 1, wy >> 1, 71 + s) - 0.5) * 0.3 + (hash(wx >> 3, wy >> 3, 73 + s) - 0.5) * 0.35; // 도트식 들쭉날쭉: 2칸 단위 잡음 + 8칸 단위 덩어리 (매끈한 곡선 대신)
  const isForest = (a, b) => tileAt(a, b) === T.FOREST;
  function grassForestTile(x, y) { // 잔디 ↔ 숲 바닥: 모서리 비율 + 들쭉날쭉 + 체크무늬 디더로 섞기
    const [f00, f10, f01, f11] = cornerVal((a, b) => (isForest(a, b) ? 1 : 0), x, y);
    return tileImage((cx, cy) => { const u = (cx + 1) / TILE, v = (cy + 1) / TILE, wx = x * TILE + cx, wy = y * TILE + cy;
      const fv = f00 * (1 - u) * (1 - v) + f10 * u * (1 - v) + f01 * (1 - u) * v + f11 * u * v + jag(wx, wy, 1) + (BAY[((cy >> 1) & 3) * 4 + ((cx >> 1) & 3)] / 16 - 0.5) * 0.3;
      return fv > 0.5 ? texPixel('w_forest', wx, wy) : grassPixel(wx, wy); }); }
  const wave = (wx, wy) => 0.17 * Math.sin(wx * 0.045 + wy * 0.021) + 0.11 * Math.sin(wy * 0.06 - wx * 0.028) + 0.06 * Math.sin((wx + wy) * 0.13); // 이어지는 물결 (칸 경계에서 끊기지 않게 세계 좌표로)
  function tileImage(fill) { const id = new ImageData(TILE, TILE), d = id.data; for (let cy = 0; cy < TILE; cy += 2) for (let cx = 0; cx < TILE; cx += 2) { const c = fill(cx, cy); for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const i = ((cy + oy) * TILE + cx + ox) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; } } return id; }
  function cornerVal(f, x, y) { return [f(x - 1, y - 1) + f(x, y - 1) + f(x - 1, y) + f(x, y), f(x, y - 1) + f(x + 1, y - 1) + f(x, y) + f(x + 1, y), f(x - 1, y) + f(x, y) + f(x - 1, y + 1) + f(x, y + 1), f(x, y) + f(x + 1, y) + f(x, y + 1) + f(x + 1, y + 1)].map((v) => v / 4); }
  const SEA = [[0.3, [79, 183, 154]], [1.2, [23, 196, 170]], [2.2, [3, 196, 180]], [3.2, [10, 166, 192]], [4.5, [31, 98, 192]]]; // 영상 속 바다: 얕은 초록빛 청록 → 청록 → 파랑 (부드러운 그라데이션)
  function seaPixel(d, wx, wy) { let i = 1; while (i < SEA.length - 1 && d > SEA[i][0]) i++; const [a0, c0] = SEA[i - 1], [a1, c1] = SEA[i], k = Math.max(0, Math.min(1, (d - a0) / (a1 - a0)));
    if (SEA_MASK) { SEAD = d; const a = Math.round(255 * Math.max(0.5, Math.min(1, 1.15 - d * 0.14))); return (SEAHIT = [a, a, a]); } // 높이(깊이) 지도: 얕을수록 빛 그물이 진하게
    return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k)); }
  let SEA_MASK = false, SEAHIT = null, SEAD = 0, SEAREC = null, SHLV = -1, SHREC = null;
  function seaMaskTile(x, y) { SEA_MASK = true; const id = beachWaterTile(x, y); SEA_MASK = false; const d = id.data; for (let i = 0; i < d.length; i += 4) { d[i + 3] = d[i]; d[i] = d[i + 1] = d[i + 2] = 255; } return id; }
  // 움직이는 빛 그물: 물 무늬를 8장으로 조금씩 일렁이게 미리 만들어 두고 돌려 그림 (도트 1칸 단위 유지)
  const WAVE = { frames: null, P: 0 };
  function buildWaveFrames() { const P = ART.w_wsh.width, F = 8, src = []; for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) { const r = texPixel('w_wsh', x * 2, y * 2)[0]; src.push(r > 200 ? 3 : r > 150 ? 2 : r < 10 ? 0 : 1); }
    WAVE.P = P; WAVE.frames = [];
    for (let f = 0; f < F; f++) { const ph = (f / F) * Math.PI * 2, c = document.createElement('canvas'); c.width = c.height = P; const q = c.getContext('2d'), id = q.createImageData(P, P), d = id.data;
      for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) { const sx = (x + Math.round(1.6 * Math.sin(ph + (4 * Math.PI * y) / P)) + P) % P, sy = (y + Math.round(1.6 * Math.sin(ph + (4 * Math.PI * x) / P + 1.3)) + P) % P, v = src[sy * P + sx], i = (y * P + x) * 4;
        if (v >= 2) { d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = v === 3 ? 46 : 22; } else if (v === 0) { d[i + 3] = 16; } }
      q.putImageData(id, 0, 0); const big = document.createElement('canvas'); big.width = big.height = P * 2; const bq = big.getContext('2d'); bq.imageSmoothingEnabled = false; bq.drawImage(c, 0, 0, P * 2, P * 2);
      WAVE.frames.push(ctx.createPattern(big, 'repeat')); } }
  const waveTmp = document.createElement('canvas');
  function drawWaves(ts, chunkList) { if (!ART.w_wsh) return; const t = ts * 1000; /* 초 → ms */ if (!WAVE.frames) buildWaveFrames(); const pat = WAVE.frames[Math.floor(t / 170) % WAVE.frames.length], P2 = WAVE.P * 2, dr = 0; // 제자리에서 일렁임 (방향 흐름 없음)
    for (const [i, j, c] of chunkList) { if (!c || !c.seaMask) continue; const X = i * CPX, Y = j * CPX;
      if (c.seaFull) { pat.setTransform(new DOMMatrix().translate(dr % P2, (dr >> 1) % P2)); ctx.globalAlpha = 0.5; ctx.fillStyle = pat; ctx.fillRect(X, Y, CPX, CPX); ctx.globalAlpha = 1; continue; }
      if (waveTmp.width !== CPX) waveTmp.width = waveTmp.height = CPX; const wg = waveTmp.getContext('2d');
      wg.globalCompositeOperation = 'copy'; pat.setTransform(new DOMMatrix().translate(((dr - X) % P2 + P2) % P2, (((dr >> 1) - Y) % P2 + P2) % P2)); wg.fillStyle = pat; wg.fillRect(0, 0, CPX, CPX);
      wg.globalCompositeOperation = 'destination-in'; wg.drawImage(c.seaMask, 0, 0); wg.globalCompositeOperation = 'source-over'; ctx.drawImage(waveTmp, X, Y);
      if (c.seaD) { if (!c.crest) c.crest = buildCrests(c.seaD, i, j); ctx.drawImage(c.crest[Math.floor(t / 230) % c.crest.length], X, Y, CPX, CPX); }
      if (c.shoreL) { if (!c.swash) c.swash = buildSwash(c.shoreL); ctx.drawImage(c.swash[Math.floor(t / 200) % c.swash.length], X, Y, CPX, CPX); } } }
  function buildSwash(L) { const HN = CPX / 2, F = 18, out = [], W0 = seaPixel(0.4, 0, 0); SEA_MASK = false; // sin파로 파도가 젖은 모래 위를 올라갔다 내려감
    for (let f = 0; f < F; f++) { const s = 0.5 - 0.5 * Math.cos((f / F) * Math.PI * 2), reach = 0.43 + 0.18 * s, c = document.createElement('canvas'); c.width = c.height = HN; const q = c.getContext('2d'), id = q.createImageData(HN, HN), d = id.data;
      for (let k = 0; k < L.length; k++) { const l = L[k]; if (l < 0 || l > reach) continue; const i = k * 4;
        if (l > reach - 0.03) { d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 235; } else { d[i] = W0[0]; d[i + 1] = W0[1]; d[i + 2] = W0[2]; d[i + 3] = Math.round(200 * Math.min(1, (reach - l) / 0.08 + 0.35)); } }
      q.putImageData(id, 0, 0); out.push(c); } return out; }
  function buildCrests(D, ci, cj) { const HN = CPX / 2, F = 12, out = []; // 깊이 등고선 = 해안선과 평행한 줄 → 프레임마다 해안 쪽으로 밀려옴
    for (let f = 0; f < F; f++) { const c = document.createElement('canvas'); c.width = c.height = HN; const q = c.getContext('2d'), id = q.createImageData(HN, HN), d = id.data;
      for (let k = 0; k < D.length; k++) { const z = D[k]; if (z < 0.35 || z > 3.4) continue; const ph = (z * 0.85 + f / F) % 1; if (ph > 0.09) continue; const ax = ci * HN + (k % HN), ay = cj * HN + ((k / HN) | 0); if (hash(ax >> 3, ay >> 2, 97) < 0.22) continue;
        const i = k * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(150 * (1 - z / 3.4)); }
      q.putImageData(id, 0, 0); out.push(c); } return out; }
  const deepCache = {}; function deepTile(x, y) { const P = ART.w_wdp.width, n = P / (P % 16 ? (P % 8 ? 1 : 8) : 16), k = ((x % n) + '_' + (y % n)); /* 무늬 주기마다 반복되는 칸 그림을 한 번만 만들어 둠 */
    if (!deepCache[k]) { const c = document.createElement('canvas'); c.width = c.height = TILE; c.getContext('2d').putImageData(tileImage((cx, cy) => seaPixel(9, x * TILE + cx, y * TILE + cy)), 0, 0); deepCache[k] = c; } return deepCache[k]; }
  function beachWaterTile(x, y, own) {
    if (SEA_MASK) { const f0 = beachWaterFill(x, y); return tileImage((cx, cy) => { SEAHIT = null; SHLV = -1; f0(cx, cy); if (SEAHIT && SEAREC) SEAREC(cx, cy, SEAD); if (SHLV >= 0 && SHREC) SHREC(cx, cy, SHLV); return SEAHIT || [0, 0, 0]; }); }
    return tileImage(beachWaterFill(x, y, own)); }
  function beachWaterFill(x, y, own) {
    const [c00, c10, c01, c11] = cornerVal(waterDepth, x, y), [l00, l10, l01, l11] = cornerVal((a, b) => (isLand(a, b) ? 1 : 0), x, y), shore = l00 + l10 + l01 + l11 > 0;
    const sandy = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].some(([dx, dy]) => tileAt(x + dx, y + dy) === T.SAND);
    return ((cx0, cy0) => { const cx = cx0 & ~1, cy = cy0 & ~1, u = (cx + 1) / TILE, v = (cy + 1) / TILE, wx = x * TILE + cx, wy = y * TILE + cy; // 2px 단위로 계산 → 도트 1칸씩 깔끔하게
      if (shore) { const lv = (l00 * (1 - u) * (1 - v) + l10 * u * (1 - v) + l01 * (1 - u) * v + l11 * u * v) * 1.25 + wave(wx, wy) * 0.4 + (hash(wx >> 3, wy >> 3, 73) - 0.5) * 0.18; /* 잔 점박이 없이 굵은 들쭉날쭉만 */ // 땅이 물 쪽으로 구불구불 튀어나옴 → 해안선이 칸 모양으로 안 보이게
        if (sandy && !SEA_MASK && lv > 0.41 && lv <= 0.6) return BEACH.wet; // 파도가 오르내리는 진한(젖은) 모래 띠
        if (sandy && SEA_MASK && lv > 0.41 && lv <= 0.6) { SHLV = lv; return BEACH.wet; }
        if (lv > 0.6) { if (own) return own(cx, cy); if (sandy) { const hh = hash(wx >> 1, wy >> 1, 61); return hh < 0.05 ? BEACH.sand2 : BEACH.sand; } return grassPixel(wx, wy); }
        if (lv > 0.54) return sandy ? BEACH.wet : BEACH.line; if (lv > 0.47) return BEACH.foam; if (lv > 0.41) return BEACH.foam2; } // 모래 → 젖은 모래 → 흰 거품 → 옅은 거품 → 물
      const d = c00 * (1 - u) * (1 - v) + c10 * u * (1 - v) + c01 * (1 - u) * v + c11 * u * v + wave(wx, wy) + (BAY[((cy >> 1) & 3) * 4 + ((cx >> 1) & 3)] / 16 - 0.5) * 0.14;
      if (ART.w_wsh) return d < 0.3 ? BEACH.foam2 : seaPixel(isLake(x, y) ? 2.3 + d * 1.0 : d, wx, wy); // 호수는 얕은 하늘색 없이 중간 깊이 색부터 // 물 그림의 빛 그물 무늬: 얕은 곳 청록 / 깊은 곳 파랑 (경계는 디더로 섞임)
      return d < 0.3 ? BEACH.foam2 : d < 1.1 ? BEACH.w1 : d < 1.5 ? BEACH.w2 : d < 2.0 ? BEACH.w3 : d < 2.7 ? BEACH.w4 : BEACH.w5; });
  }
  const nearSea = (x, y) => [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].some(([dx, dy]) => !isLand(x + dx, y + dy));
  function beachSandTile(x, y) { return tileImage(beachSandFill(x, y)); }
  function beachSandFill(x, y) { // 모래 + 알갱이 + 잔디가 모래 위로 삐죽 넘어오는 가장자리 (어두운 청록 테두리)
    const [g00, g10, g01, g11] = cornerVal((a, b) => (isGrassy(a, b) ? 1 : 0), x, y), any = g00 + g10 + g01 + g11 > 0;
    return ((cx, cy) => { const wx = x * TILE + cx, wy = y * TILE + cy, hh = hash(wx >> 1, wy >> 1, 61);
      if (any) { const u = (cx + 1) / TILE, v = (cy + 1) / TILE, gv = (g00 * (1 - u) * (1 - v) + g10 * u * (1 - v) + g01 * (1 - u) * v + g11 * u * v) * 1.25 + wave(wx, wy) * 0.4 + jag(wx, wy, 2);
        if (gv > 0.5) return grassPixel(wx, wy); if (gv > 0.42) return BEACH.line; }
      return hh < 0.05 ? BEACH.sand2 : hh < 0.07 ? BEACH.sand3 : BEACH.sand; });
  }
  // 절벽·계단 그림 (해변·잔디 팔레트에 맞춘 청회색 돌, 2px = 도트 1칸)
  const CL = { s1: [120, 140, 146], s2: [98, 117, 125], s3: [76, 93, 103], s4: [54, 68, 80], line: [24, 48, 56], hi: [158, 176, 176] };
  function drawCliff(g, x, y, px, py) {
    const row = wallRow(x, y), h0 = hgt(x, y);
    if (row) { const stair = isStair(x, y);
      g.putImageData(tileImage((cx, cy) => { const wx = x * TILE + cx, wy = y * TILE + cy;
        if (row === 1 && cy < 6 + Math.round((hash(wx >> 1, 0, 84) - 0.5) * 4)) return cy > 3 && hash(wx >> 1, wy >> 1, 85) < 0.5 ? CL.line : grassPixel(wx, wy); // 위 잔디가 절벽 끝에 걸침
        if (stair) { const band = (cy >> 2) & 1, side = cx < 4 || cx >= TILE - 4; return side ? CL.s4 : (cy & 3) === 3 ? CL.line : band ? CL.s1 : CL.hi; } // 계단: 밝은·어두운 디딤판
        const col = Math.floor((wx + Math.floor(hash(0, wy >> 3, 86) * 6)) / 8), shade = hash(col, Math.floor(wy / 24), 87); // 세로 돌기둥 무늬
        if (((wx + Math.floor(hash(0, wy >> 3, 86) * 6)) & 7) === 0) return CL.s4; // 기둥 사이 틈
        if (cy >= TILE - 6 && wallRow(x, y + 1) === 0) return cy >= TILE - 2 ? CL.line : CL.s4; // 절벽 밑동 어둡게
        if (row === 1 && cy < 9) return CL.hi; // 윗단 밝은 모서리
        return shade < 0.3 ? CL.s3 : shade < 0.7 ? CL.s2 : CL.s1; }), px, py);
      return; }
    // 절벽 바로 아래 땅: 그림자 띠
    if (wallRow(x, y - 1) && !isStair(x, y - 1)) { g.fillStyle = 'rgba(20,30,40,0.34)'; g.fillRect(px, py, TILE, 8); g.fillStyle = 'rgba(20,30,40,0.2)'; g.fillRect(px, py + 8, TILE, 6); g.fillStyle = 'rgba(20,30,40,0.1)'; g.fillRect(px, py + 14, TILE, 6); }
    // 고원 옆·뒤 가장자리: 낮은 쪽으로 어두운 테두리
    const side = (sx, w2) => { g.fillStyle = 'rgb(98,117,125)'; g.fillRect(sx, py, w2, TILE); g.fillStyle = 'rgb(158,176,176)'; g.fillRect(sx, py, w2, 2); g.fillStyle = 'rgb(24,48,56)'; g.fillRect(sx === px ? px : px + TILE - 2, py, 2, TILE); }; // 고원 옆: 돌 테두리
    if (hgt(x - 1, y) < h0) side(px, 6); if (hgt(x + 1, y) < h0) side(px + TILE - 6, 6); if (hgt(x, y - 1) < h0 && !wallRow(x, y)) { g.fillStyle = 'rgb(158,176,176)'; g.fillRect(px, py, TILE, 3); g.fillStyle = 'rgb(24,48,56)'; g.fillRect(px, py, TILE, 1); }
    if (h0 > 0) { g.fillStyle = `rgba(255,250,220,${0.08 * h0})`; g.fillRect(px, py, TILE, TILE); } // 높은 곳은 살짝 밝게
  }
  function renderChunk(ci, cj) {
    const c = document.createElement('canvas');
    c.width = c.height = CPX;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const x0 = ci * CHUNK, y0 = cj * CHUNK; let deepN = 0;
    const seaM = () => { if (!c.seaMask) { c.seaMask = document.createElement('canvas'); c.seaMask.width = c.seaMask.height = CPX; } return c.seaMask.getContext('2d'); }; // 움직이는 빛 그물이 그려질 자리 (바다만)
    const HN = CPX / 2, seaRec = (px, py) => { if (!c.seaD) c.seaD = new Float32Array(HN * HN).fill(-1); const D = c.seaD; SEAREC = (cx, cy, d) => { D[((py + cy) >> 1) * HN + ((px + cx) >> 1)] = d; }; SHREC = (cx, cy, l) => { if (!c.shoreL) c.shoreL = new Float32Array(HN * HN).fill(-1); c.shoreL[((py + cy) >> 1) * HN + ((px + cx) >> 1)] = l; }; }; // 해안 근처 깊이 기록 → 해안선 따라 밀려오는 물결
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
            if (ART.w_grass) { if (waterDepth(x, y) >= 4.5 && waterDepth(x - 1, y) >= 4 && waterDepth(x + 1, y) >= 4 && waterDepth(x, y - 1) >= 4 && waterDepth(x, y + 1) >= 4) { if (ART.w_wdp) g.drawImage(deepTile(x, y), px, py); else { g.fillStyle = 'rgb(58,130,203)'; g.fillRect(px, py, TILE, TILE); } const m = seaM(); m.fillStyle = 'rgba(255,255,255,0.5)'; m.fillRect(px, py, TILE, TILE); deepN++; } else { g.putImageData(beachWaterTile(x, y), px, py); seaRec(px, py); seaM().putImageData(seaMaskTile(x, y), px, py); SEAREC = SHREC = null; } break; } // 경북 밖도 바다 → 섬처럼 (먼 바다는 한 색으로 빠르게)
            g.fillStyle = '#1b1430'; g.fillRect(px, py, TILE, TILE);
            if (h < 0.03) { g.fillStyle = h < 0.01 ? '#f3dcff' : '#8d7ab8'; g.fillRect(px + (h * 997 % 28), py + (h * 577 % 28), 2, 2); }
            break;
          case T.GRASS: case T.FOREST: { if (ART.w_wsh && nearSea(x, y)) { const tk = t === T.FOREST && ART.w_forest ? 'w_forest' : 'w_grass'; g.putImageData(beachWaterTile(x, y, (cx, cy) => texPixel(tk, x * TILE + cx, y * TILE + cy)), px, py); seaRec(px, py); seaM().putImageData(seaMaskTile(x, y), px, py); SEAREC = SHREC = null; break; } /* 바다 옆 잔디도 해안선이 파고듦 */ const mixed = ART.w_forest && [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].some(([dx, dy]) => { const q = tileAt(x + dx, y + dy); return (q === T.GRASS || q === T.FOREST) && q !== t; }); if (mixed) { g.putImageData(grassForestTile(x, y), px, py); break; } const im = ART[t === T.FOREST && ART.w_forest ? 'w_forest' : 'w_grass']; /* 숲 바닥은 조금 어둡게 (느려지는 곳이 보이게) */ if (im) g.drawImage(im, (x * 16) % im.width, (y * 16) % im.height, 16, 16, px, py, TILE, TILE); else tile(g, t === T.GRASS ? TL.grass : TL.forest, h, px, py); break; } // 새 잔디: 48칸 무늬를 이어 붙임
          case T.SAND: if (ART.w_grass) { if (nearSea(x, y)) { g.putImageData(beachWaterTile(x, y, beachSandFill(x, y)), px, py); seaRec(px, py); seaM().putImageData(seaMaskTile(x, y), px, py); SEAREC = SHREC = null; } else g.putImageData(beachSandTile(x, y), px, py); } else tile(g, TL.sand, h, px, py); break;
          case T.WATER: {
            if (ART.w_grass) { g.putImageData(beachWaterTile(x, y), px, py); seaRec(px, py); seaM().putImageData(seaMaskTile(x, y), px, py); SEAREC = SHREC = null; break; } // 새 물: 해안까지 거리로 얕은·깊은 색 + 해안선 따라 거품
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
        if (x >= PILOT.x0 && y >= PILOT.y0 && x < PILOT.x1 && y < PILOT.y1) drawCliff(g, x, y, px, py); // 단차
        { const e = TILES[y * W + x]; if (e && (e.k === 'floor' || e.under)) g.drawImage(floorArtId(e.k === 'floor' ? tileItem(e) : e.under), px, py, TILE, TILE); else if (e && e.k === 'farm') g.drawImage(farmArt(nearCanal(x, y)), px, py, TILE, TILE); else if (e && e.k === 'water') g.drawImage(canalArt(canalMask(x, y)), px, py, TILE, TILE); else if (e && e.k === 'bridge') { if (e.canal) g.drawImage(canalArt(canalMask(x, y)), px, py, TILE, TILE); drawBridgeTile(g, x, y, px, py, e.id); } } // 벽·장식 밑의 바닥도 · 밭 · 수로
        // 영토 색 + 국경선: 우리 나라는 진하게, 경계는 우리 나라 색 띠 / 나머지 경계는 흰 선
        const o = terrAt(x, y);
        const own = o > 0 ? ownerOf(o) : null;
        const mine = !!own && own === MY_NID;
        /* 영토 칸을 색으로 덮는 건 뺌 (바닥 그림이 그대로 보이게) → 경계선만 */
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
            g.fillStyle = col; // 우리 나라 경계: 우리 색 선 하나만
            if (N) g.fillRect(px, py, TILE, 4); if (S) g.fillRect(px, py + TILE - 4, TILE, 4);
            if (Wd) g.fillRect(px, py, 4, TILE); if (E) g.fillRect(px + TILE - 4, py, 4, TILE);
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
    c.seaFull = deepN === CHUNK * CHUNK; return c;
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
  let BOARD = [];
  function bigBoard(g, x, y) { // 하늘 신전 자유 게시판: 최근 글 4개가 쪽지로 붙어 보임
    g.fillStyle = '#5a4630'; g.fillRect(x - 128, y - 50, 8, 50); g.fillRect(x + 120, y - 50, 8, 50);
    g.fillStyle = '#2b2340'; g.fillRect(x - 140, y - 150, 280, 108); g.fillStyle = '#8a6a44'; g.fillRect(x - 136, y - 146, 272, 100); g.fillStyle = '#6b5034'; g.fillRect(x - 128, y - 138, 256, 84);
    g.fillStyle = '#e8c260'; g.fillRect(x - 136, y - 146, 272, 4); g.fillRect(x - 136, y - 50, 272, 4);
    const last = BOARD.slice(-4).reverse(), cols = ['#fff6d6', '#ffe3e3', '#e3f6ff', '#e8ffe3'];
    g.font = `700 10px ${PFONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) { const px = x - 122 + i * 62, py = y - 132 + (i % 2) * 6, q = last[i];
      g.fillStyle = q ? cols[i] : 'rgba(255,255,255,0.18)'; g.fillRect(px, py, 54, 64); g.fillStyle = '#c0392b'; g.fillRect(px + 25, py - 2, 4, 4);
      if (q) { g.fillStyle = q.color || '#2b2340'; const t = q.title; for (let L = 0; L < 4; L++) { const seg = t.slice(L * 5, L * 5 + 5); if (!seg) break; g.fillText(seg, px + 27, py + 12 + L * 13); } } }
    plaque(g, x, y - 166, '자유 게시판');
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
    vaccine: { name: '치유 천사 세라', ch: 'Princess', color: '#d64f86', shop: 'vaccine', lines: ['균열이 무서운가요? 백신 하나면 영토 하나를 지킬 수 있어요.', '곡괭이·낚싯대·삽 같은 작업 도구도 여기서 팔아요. 한 번 사면 계속 써요!', '백신은 많이 살수록 비싸져요. 꼭 필요한 만큼만!'] },
    seed: { name: '정원 천사 플로라', ch: 'Villager2', color: '#3fa37a', shop: 'seed', lines: ['어서 와요! 밭·수로·씨앗·비료가 있어요.', '우리 땅에 밭을 갈고(설치 모드 농사 탭) 그 위에 서서 씨앗을 심어요.', '수로 2칸 안은 20% 빨리 자라고, 비료를 주면 남은 시간이 절반!', '다 자라면 E로 수확해서 저한테 팔아요.', '낚시로 잡은 물고기도 사요! 비 오는 날엔 귀한 물고기가 잘 잡힌대요.'] },
    smith: { name: '대장장이 천사 볼트', ch: 'Knight', color: '#c8503c', shop: 'weapon', from: 3, lines: ['날 선 무기 있습니다! 무기는 직접 사야 해요 · 내 코인(개인 지갑)으로.', '산 무기는 바로 들어요. 여기서 언제든 바꿔 들 수 있어요.', '무기가 없으면 맨주먹이에요. J로 공격, 꾹 누르면 차징!'], closed: ['영역전이 시작되는 3일차에 문을 엽니다.', '그때 날 선 무기를 잔뜩 가져올게요!'] },
    stylist: { name: '꾸미기 천사 루나', ch: 'Noble', color: '#b07ae6', shop: 'hat', lines: ['어머, 모자 하나 써 볼래요? 머리 장식은 내 코인(개인 지갑)으로 사요.', '내 코인은 물고기를 팔거나(100%), 작물을 팔면(20%) 모여요.', '산 모자는 꾸미기 창에서 언제든 바꿔 쓸 수 있어요!'] },
    war: { name: '전쟁의 천사 미카', ch: 'KnightGold', color: '#c22f53', rules: true, lines: ['나는 전쟁의 규칙을 지키는 천사.', '3일차부터 영역전이 열린다. 그때 규칙서를 보여 주지.'] },
    clerk: { name: '등록 천사 노엘', ch: 'Villager', color: '#277a58', desk: true, lines: ['나라가 없나요? 여기서 귀화·용병·건국을 등록해요.', '나라가 있다면 나라 이름으로 인재 모집을 올릴 수도 있어요.'] },
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
    const npc = NPCS[TALK.npc], lines = npc.from && DAY < npc.from ? npc.closed : npc.rules && DAY >= 3 ? ['영역전이 열렸다. 규칙을 모르고 싸우면 진다.', '아래 버튼으로 규칙서를 읽어 보아라.'] : npc.lines;
    TALK.lines = lines; const text = lines[Math.min(TALK.i, lines.length - 1)], last = TALK.i >= lines.length - 1;
    $('talkText').textContent = text;
    $('talkMore').textContent = last ? '■ Space 닫기' : `▼ Space (${TALK.i + 1}/${lines.length})`;
    const btn = [];
    if (npc.shop && !(npc.from && DAY < npc.from)) btn.push(['물건 보기', () => { const id = TALK.npc; closeTalk(); openShop(npc.shop, id); }]);
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
    if (!me && tab !== 'hat' && tab !== 'weapon') { toast('나라가 있어야 살 수 있어요 (나라 공용 저장소에서 내요)'); return; } // 모자·무기는 내 코인이라 나라 없어도 됨
    SHOP_KIND = tab; SHOP_TAB = 'all'; SHOP_NPC = npcId || ({ weapon: 'smith', hat: 'stylist' }[tab]) || tab;
    const npc = NPCS[SHOP_NPC]; $('shopWho').textContent = npc.name; facePortrait($('shopFace'), npc);
    $('shopSay').textContent = npc.lines[0];
    renderShop(); $('shopBox').hidden = false;
  }
  function renderShop() {
    const me = (myView && myView.me) || (SHOP_KIND === 'hat' || SHOP_KIND === 'weapon' ? { coin: 0, items: {} } : null); if (!me) return;
    const P = MPRules.NUM.price;
    const tabs = SHOP_KIND === 'build' ? [['heaven', '☁ 천상'], ['forest', '🌲 숲'], ['winter', '❄ 겨울'], ['stone', '🪨 돌'], ['trap', '🪤 덫']] : SHOP_KIND === 'seed' ? [['buy', '🌱 씨앗·밭'], ['sell', '🧺 작물·물고기 팔기']] : SHOP_KIND === 'vaccine' ? [['vaccine', '💉 백신'], ['tools', '🛠 작업 도구']] : [];
    if (SHOP_KIND === 'vaccine' && SHOP_TAB !== 'tools') SHOP_TAB = 'vaccine';
    if (SHOP_KIND === 'seed' && SHOP_TAB !== 'sell') SHOP_TAB = 'buy';
    if (SHOP_KIND === 'build' && !tabs.some(([k]) => k === SHOP_TAB)) SHOP_TAB = 'heaven';
    $('shopTabs').hidden = !tabs.length;
    $('shopTabs').innerHTML = tabs.map(([k, l]) => `<button type="button" data-tab="${k}" aria-pressed="${k === SHOP_TAB}">${l}</button>`).join('');
    for (const b of $('shopTabs').querySelectorAll('[data-tab]')) b.onclick = () => { SHOP_TAB = b.dataset.tab; renderShop(); };
    $('shopCoin').innerHTML = SHOP_KIND === 'hat' || SHOP_KIND === 'weapon' || (SHOP_KIND === 'vaccine' && SHOP_TAB === 'tools') || (SHOP_KIND === 'seed' && SHOP_TAB === 'sell') ? `👛 내 코인 <b>${MY_PCOIN.toLocaleString()}</b> <small>· 개인 지갑 (물고기·작물을 팔아서 모아요)</small>` : `<span class="coinIco"></span> 우리 저장소 <b>${me.coin.toLocaleString()}</b> 코인 <small>· 산 물건은 나라 저장소로 가요</small>`;
    const card = (k, name, desc, price, counts, have) => `<div class="hvCard"><canvas data-ico="${k}" width="64" height="64"></canvas><div class="hvInfo"><b>${name}</b><small>${desc}</small>${have != null ? `<i>가진 것 ${have}개</i>` : ''}</div><div class="hvBuy"><span class="price"><span class="coinIco"></span>${price.toLocaleString()}${counts ? '<small>/개</small>' : ''}</span><div>${(counts || [1]).map((c) => `<button type="button" data-buy="${k}" data-n="${c}" ${me.coin < price * c ? 'disabled' : ''}>${counts ? c + '개' : '사기'}</button>`).join('')}</div></div></div>`;
    let html = '';
    const want = (k) => SHOP_TAB === 'all' || SHOP_TAB === k;
    const CAT_DESC = { floor: '우리 국민이 1.5배 빨라져요', wall: `다른 나라 사람을 막아요 · 내구도 ${MPRules.NUM.buildHp}`, deco: '꾸미기 · 밟고 지나갈 수 있어요', bridge: '물 위에 놓으면 누구나 건널 수 있어요 · 이어 놓을수록 다리가 길고 멋있어져요', trap: '밟은 적이 3초 동안 못 움직여요 · 적에겐 안 보임' };
    const CNT = { floor: [1, 5, 20], wall: [1, 5, 10], deco: [1, 5], trap: [1, 3], bridge: [1, 5, 10] };
    if (SHOP_KIND === 'build') html = MPRules.BUILD.filter((b) => !FARM_CATS.has(b.cat) && b.cat !== 'crop' && (SHOP_TAB === 'trap' ? b.cat === 'trap' : b.theme === SHOP_TAB && b.cat !== 'trap')).map((b) => card(b.id, b.name, CAT_DESC[b.cat], P[b.cat], CNT[b.cat], me.items[b.id] || 0)).join('');
    else if (false) html = (want('floor') ? card('floor', '황금 바닥', '우리 국민이 1.5배 빨라져요', P.floor, [1, 5, 20], me.items.floor) : '') + (want('wall') ? card('wall', '방벽', '다른 나라 사람을 막아요 (5초 맞으면 부서짐)', P.wall, [1, 5, 10], me.items.wall) : '') + (want('trap') ? card('trap', '덫', '밟은 적이 3초 동안 못 움직여요 · 적에겐 안 보임', P.trap, [1, 3], me.items.trap) : '');
    else if (SHOP_KIND === 'weapon') { const bare = myWeapon() === 'fist', wd = (W5) => W5.proj ? `멀리 ${W5.range}px` : `앞 ${W5.reach}px`;
      html = `<div class="hvCard"><canvas data-wpn="fist" width="64" height="64"></canvas><div class="hvInfo"><b>맨주먹</b><small>무기를 안 들면 맨주먹 · 피해 ${MPRules.WEAPONS.fist.dmg.join('~')}</small>${bare ? '<i>✔ 지금 맨주먹</i>' : ''}</div><div class="hvBuy"><span class="price">무료</span><div><button type="button" data-equip="" ${bare ? 'disabled' : ''}>내려놓기</button></div></div></div>`
        + Object.entries(MPRules.WEAPONS).filter(([, W5]) => W5.price).map(([k, W5]) => { const own = MY_WEAPONS[k], on = MY_WEAPON === k && own; return `<div class="hvCard"><canvas data-wpn="${k}" width="64" height="64"></canvas><div class="hvInfo"><b>${W5.name}</b><small>피해 ${W5.dmg.join('~')} · ${wd(W5)} · ${(W5.cd / 1000).toFixed(1)}초마다${W5.boom ? ' · 폭발' : ''}</small>${on ? '<i>✔ 들고 있어요</i>' : own ? '<i>가지고 있어요</i>' : ''}</div><div class="hvBuy"><span class="price">👛 ${W5.price}</span><div>${own ? `<button type="button" data-equip="${k}" ${on ? 'disabled' : ''}>${on ? '듦' : '들기'}</button>` : `<button type="button" data-buywpn="${k}" ${MY_PCOIN < W5.price ? 'disabled' : ''}>사기</button>`}</div></div></div>`; }).join(''); }
    else if (SHOP_KIND === 'hat') html = Object.entries(HATS).map(([k, H]) => { const owned = MY_HATS[k], wearing = player.look.hat === k, price = MPRules.HAT_PRICE[k]; return `<div class="hvCard"><canvas data-hat-ico="${k}" width="64" height="64"></canvas><div class="hvInfo"><b>${H.name}</b><small>머리 위에 써요 · 다른 사람에게도 보여요</small>${owned ? `<i>${wearing ? '✔ 쓰고 있어요' : '✔ 가지고 있어요'}</i>` : ''}</div><div class="hvBuy"><span class="price">👛 ${price}</span><div>${owned ? `<button type="button" data-wear="${wearing ? '' : k}">${wearing ? '벗기' : '쓰기'}</button>` : `<button type="button" data-buyhat="${k}" ${MY_PCOIN < price ? 'disabled' : ''}>사기</button>`}</div></div></div>`; }).join('');
    else if (SHOP_KIND === 'vaccine' && SHOP_TAB === 'tools') html = Object.entries(MPRules.TOOLS).map(([k, tl]) => `<div class="hvCard"><canvas data-tool="${k}" width="64" height="64"></canvas><div class="hvInfo"><b>${tl.name}</b><small>${tl.use}에 꼭 필요해요 · 나만 쓰는 도구 · 내 코인으로 사요 (한 번 사면 계속)</small>${MY_TOOLS[k] ? '<i>✔ 가지고 있어요</i>' : ''}</div><div class="hvBuy"><span class="price">👛 ${tl.price}</span><div><button type="button" data-buy="tool_${k}" data-n="1" ${MY_TOOLS[k] || MY_PCOIN < tl.price ? 'disabled' : ''}>${MY_TOOLS[k] ? '있음' : '사기'}</button></div></div></div>`).join('');
    else if (SHOP_KIND === 'vaccine') html = card('vaccine', '백신', '균열에서 영토 하나를 지켜요 · 살수록 비싸져요', me.vaccinePrice, null, me.vaccine);
    else if (SHOP_TAB === 'buy') html = [['farm', '밭 1칸 · 설치 모드 농사 탭에서 발밑에 갈아요', [1, 5, 20]], ['canal', '수로 1칸 · 2칸 안의 작물이 20% 빨리 자라요 (사람은 못 지나감)', [1, 5]], ['fert', '심은 작물에 주면 남은 시간이 절반!', [1, 5]]].map(([id, d, c]) => card(id, BUILD_BY[id].name, d, BUILD_BY[id].price, c, me.items[id] || 0)).join('')
      + Object.entries(CROPS).map(([k, c]) => card('s_' + k, c.name + ' 씨앗', `${fmtLeft(c.min * 60e3)} · ${c.yield}개 수확 · 1개 ${c.sell}코인에 팔림`, c.seed, [1, 5, 9], me.items['s_' + k] || 0)).join('');
    else { const owned = MPRules.BUILD.filter((b) => b.cat === 'crop' && (b.fish ? MY_BAG[b.id] > 0 : me.items[b.id] > 0)); html = owned.length ? owned.map((b) => { const n2 = b.fish ? MY_BAG[b.id] : me.items[b.id]; return `<div class="hvCard"><canvas data-ico="${b.id}" width="64" height="64"></canvas><div class="hvInfo"><b>${b.name}</b><small>1개 ${b.sell}코인 · ${b.fish ? '내 가방 → <b>100% 내 코인</b>' : '나라 저장소 → 나라 80% · 나 20%'}</small><i>가진 것 ${n2}개</i></div><div class="hvBuy"><span class="price"><span class="coinIco"></span>${(b.sell * n2).toLocaleString()}<small> 전부</small></span><div><button type="button" data-sell="${b.id}" data-n="1">1개</button><button type="button" data-sell="${b.id}" data-n="${n2}">전부</button></div></div></div>`; }).join('') : '<div class="hvSoon"><p><b>팔 작물·물고기가 없어요</b><br>밭에서 키우거나 물가에서 낚시해 보세요!<br><small>작물: 나라 80% · 판 사람 20% · 물고기: 100% 내 코인</small></p></div>'; }
    $('shopBody').innerHTML = html;
    for (const c of $('shopBody').querySelectorAll('[data-hat-ico]')) { const H = HATS[c.dataset.hatIco], g = c.getContext('2d'), k = Math.min(4, Math.floor(56 / H.cv.width), Math.floor(56 / H.cv.height)); g.imageSmoothingEnabled = false; g.drawImage(H.cv, (64 - H.cv.width * k) / 2, (64 - H.cv.height * k) / 2, H.cv.width * k, H.cv.height * k); }
    for (const c of $('shopBody').querySelectorAll('[data-wpn]')) { const S2 = TOOL[WPN_SPR[c.dataset.wpn]], g = c.getContext('2d'); g.imageSmoothingEnabled = false; if (!S2) { g.font = '34px sans-serif'; g.textAlign = 'center'; g.fillText('👊', 32, 44); continue; } const k = Math.max(1, Math.min(56 / S2.cv.width, 56 / S2.cv.height) | 0); g.save(); g.translate(32, 32); g.rotate(S2.noRot ? 0 : 0.6); g.drawImage(S2.cv, -S2.cv.width * k / 2, -S2.cv.height * k / 2, S2.cv.width * k, S2.cv.height * k); g.restore(); }
    for (const b of $('shopBody').querySelectorAll('[data-buywpn]')) b.onclick = () => ws.send(JSON.stringify({ t: 'buyWeapon', w: b.dataset.buywpn }));
    for (const b of $('shopBody').querySelectorAll('[data-equip]')) b.onclick = () => ws.send(JSON.stringify({ t: 'equipWeapon', w: b.dataset.equip }));
    for (const b of $('shopBody').querySelectorAll('[data-buyhat]')) b.onclick = () => ws.send(JSON.stringify({ t: 'buyHat', id: b.dataset.buyhat }));
    for (const b of $('shopBody').querySelectorAll('[data-wear]')) b.onclick = () => { player.look.hat = b.dataset.wear; saveLook(); renderShop(); };
    for (const c of $('shopBody').querySelectorAll('[data-tool]')) { const g = c.getContext('2d'), T2 = TOOL[{ pick: 'pick', rod: 'rod', shovel: 'shovel', axe: 'axe' }[c.dataset.tool]]; g.imageSmoothingEnabled = false; const k = Math.min(56 / T2.cv.width, 56 / T2.cv.height) | 0; g.save(); g.translate(32, 32); g.rotate(0.5); g.drawImage(T2.cv, -T2.cv.width * k / 2, -T2.cv.height * k / 2, T2.cv.width * k, T2.cv.height * k); g.restore(); }
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
    const MX = e.max || BHP, at = HPSEEN.get(i); if (!at || performance.now() - at > 3000 || e.hp == null || e.hp >= MX) return;
    const r = Math.max(0, e.hp / MX), w = 34, L = Math.round(x - w / 2), T = Math.round(y - 76);
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
  function canalMask(x, y) { const w = (dx, dy) => { const e = TILES[(y + dy) * W + x + dx]; return e && (e.k === 'water' || e.canal); }; return (w(0, -1) ? 1 : 0) | (w(1, 0) ? 2 : 0) | (w(0, 1) ? 4 : 0) | (w(-1, 0) ? 8 : 0); }
  function nearCanal(x, y) { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const e = TILES[(y + dy) * W + x + dx]; if (e && (e.k === 'water' || e.canal)) return true; } return false; }
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
  // ------------------------------------------------------------ 다리: 이웃을 보고 저절로 이어짐 (양 끝은 큰 기둥, 가운데는 2칸마다 기둥, 길면 한가운데 등불)
  const isBridge = (x, y) => { const e = TILES[y * W + x]; return !!e && e.k === 'bridge'; };
  function bridgeRun(x, y, dx, dy) { let a = 0, b = 0; while (a < 30 && isBridge(x - dx * (a + 1), y - dy * (a + 1))) a++; while (b < 30 && isBridge(x + dx * (b + 1), y + dy * (b + 1))) b++; return [a, b]; } // 내 앞뒤로 몇 칸 이어졌는지
  function drawBridgeTileIcon(g, first, last, id) { const P = id === 'b_stone' ? ['#a9a6b4', '#bdbac8', '#8c8a96', '#6e6c78', '#cfccd6'] : ['#b07a44', '#c58a50', '#9a6a3a', '#7a4f28', '#e0aa6a']; g.fillStyle = '#2b2340'; g.fillRect(0, 7, 32, 18); for (let k = 0; k < 8; k++) { g.fillStyle = P[k % 3]; g.fillRect(k * 4, 8, 3, 16); } g.fillStyle = P[3]; g.fillRect(0, 4, 32, 3); g.fillRect(0, 25, 32, 3); for (const X of [first ? 0 : -99, last ? 26 : -99]) { if (X < 0) continue; g.fillStyle = '#2b2340'; g.fillRect(X, 0, 6, 8); g.fillRect(X, 23, 6, 8); g.fillStyle = P[2]; g.fillRect(X + 1, 1, 4, 6); g.fillRect(X + 1, 24, 4, 6); g.fillStyle = P[4]; g.fillRect(X + 1, 1, 4, 1); } }
  function drawBridgeTile(g, x, y, px, py, id) {
    const P = id === 'b_stone' ? { deck: ['#a9a6b4', '#bdbac8', '#8c8a96'], rail: '#6e6c78', post: '#8c8a96', cap: '#cfccd6', gap: '#5e5c68' } : { deck: ['#b07a44', '#c58a50', '#9a6a3a'], rail: '#7a4f28', post: '#8a5a2b', cap: '#e0aa6a', gap: '#5a3416' };
    const horiz = isBridge(x - 1, y) || isBridge(x + 1, y) || !(isBridge(x, y - 1) || isBridge(x, y + 1)) && (tileAt(x - 1, y) !== T.WATER || tileAt(x + 1, y) !== T.WATER);
    const [a, b] = horiz ? bridgeRun(x, y, 1, 0) : bridgeRun(x, y, 0, 1), len = a + b + 1, startEnd = a === 0, endEnd = b === 0, mid = len >= 5 && a === Math.floor((len - 1) / 2);
    const R = (X, Y, w, h, c) => { g.fillStyle = c; if (horiz) g.fillRect(px + X, py + Y, w, h); else g.fillRect(px + Y, py + X, h, w); }; // 가로 기준으로 그리고 세로 다리는 돌려서
    R(0, 7, 32, 18, P.gap); for (let k = 0; k < 8; k++) R(k * 4, 8, 3, 16, P.deck[k % 3]); R(0, 8, 32, 2, 'rgba(255,255,255,0.18)');
    R(0, 4, 32, 3, P.rail); R(0, 25, 32, 3, P.rail); R(0, 4, 32, 1, P.cap); R(0, 25, 32, 1, P.cap);
    const post = (X, big) => { const w = big ? 6 : 4, h = big ? 8 : 6; R(X, 3 - (big ? 3 : 1), w, h, '#2b2340'); R(X + 1, 4 - (big ? 3 : 1), w - 2, h - 2, P.post); R(X + 1, 4 - (big ? 3 : 1), w - 2, 1, P.cap); R(X, 23, w, h, '#2b2340'); R(X + 1, 24, w - 2, h - 2, P.post); R(X + 1, 24, w - 2, 1, P.cap); };
    if (startEnd) post(0, true); if (endEnd) post(26, true);
    if (!startEnd && !endEnd && (a % 2 === 0)) post(14, false);
    if (mid) { for (const Y of [0, 26]) { R(13, Y - 2, 6, 6, '#2b2340'); R(14, Y - 1, 4, 4, '#ffd35a'); R(15, Y, 2, 2, '#fff6c8'); } } // 긴 다리 한가운데 등불
    if (startEnd || endEnd) { R(startEnd ? 0 : 28, 7, 4, 18, 'rgba(0,0,0,0.12)'); }
  }
  // ------------------------------------------------------------ 작업 도구 (농사·낚시·건축·광질): 손에 든 도구 도트 + 낚시 + 비
  const TPAL = { W: '#f4f8ff', L: '#9fb4d8', D: '#5d6f96', G: '#f0c23a', g: '#a8761c', B: '#8a5a2b', b: '#5a3416', S: '#c8ced8', K: '#3b3b48', s: '#efe6cc', R: '#e8423c', O: '#ff8a2a', o: '#ffd35a', Y: '#fff2a8' };
  const TOOL = {
    axe: { pv: [4, 12], px: ['....W....', '.SSDWDSS.', 'SWLSbSLWS', 'SWLSbSLWS', 'SWLSbSLWS', 'SLLSbSLLS', '.SS.b.SS.', '....B....', '....b....', '....B....', '....b....', '....B....', '....b....', '....g....'] },
    pick: { pv: [5, 12], px: ['..SSSSSSS..', '.SWLLLLLDS.', 'SD..SbS..DS', 'S...SbS...S', '.....b.....', '.....B.....', '.....b.....', '.....B.....', '.....b.....', '.....B.....', '.....b.....', '.....B.....', '.....b.....', '.....g.....'] },
    rod: { pv: [1, 15], px: ['.W.', '.b.', '.B.', '.b.', '.B.', '.b.', '.B.', '.b.', '.B.', '.b.', '.B.', 'Kb.', 'KKb', '.B.', '.b.', '.b.', '.g.'] },
    shovel: { pv: [2, 12], px: ['.SSS.', 'SWSSS', 'SWSSS', 'SSSSS', '.SSS.', '..K..', '..B..', '..b..', '..B..', '..b..', '..B..', '..b..', '..B..', '.bbb.'] },
    sword: { pv: [2, 11], px: ['..W..', '.WLD.', '.WLD.', '.WLD.', '.WLD.', '.WLD.', '.WLD.', '.WLD.', '.WLD.', 'gGGGg', '..b..', '..b..', '..G..'] },
    spear: { pv: [2, 14], px: ['..W..', '.WLD.', '.WLD.', '.WLD.', '..L..', '.RRR.', '..R..', '..B..', '..b..', '..B..', '..b..', '..B..', '..b..', '..B..', '..b..', '..B..', '..b..', '..g..'] },
    dagger: { pv: [2, 6], px: ['..W..', '.WL..', '.WLD.', '.WLD.', 'gGGGg', '..b..', '..b..', '..G..'] },
    bow: { pv: [3, 6], noRot: true, px: ['sB...', 's.B..', 's..B.', 's...B', 's...B', 's..bB', 's..bB', 's...B', 's...B', 's..B.', 's.B..', 'sB...'] },
    staff: { pv: [2, 12], px: ['.ooo.', 'oYOOo', 'oOOOo', '.oOo.', '..G..', '..B..', '..b..', '..B..', '..b..', '..B..', '..b..', '..B..', '..b..', '..B..', '..g..'] },
    fist: { pv: [3, 3], noRot: true, px: ['.KKKK.', 'KssssK', 'KsWssK', 'KssssK', 'KssssK', '.KKKK.'] },
  };
  for (const k in TOOL) TOOL[k].cv = pxRows(TOOL[k].px, k === 'fist' ? Object.assign({}, TPAL, { s: '#ffd2ae', W: '#fff4e8' }) : TPAL);
  const ACT_TOOL = { chop: 'axe', hit: 'axe', mine: 'pick', dig: 'pick', fish: 'rod', farm: 'shovel' };
  function drawToolOn(g, o, act, t) { // o = 캐릭터 (x, y는 발), 캐릭터 48px(3배) 기준 손 위치
    const k = TOOL[ACT_TOOL[act]]; if (!k) return;
    const face = o.face | 0, side = face === 2 ? -1 : 1, up = face === 1, down = face === 0;
    const hx = o.x + (up ? -15 : down ? 17 : 17 * side), hy = o.y - (down || up ? 8 : 10);
    let ang = 0.4;
    if (act === 'fish') ang = (down || up) ? 0.2 : 1.0 + Math.sin(t * 2) * 0.05; // 낚싯대는 물 쪽으로
    else { const ph = (t * (act === 'mine' ? 2.2 : 2.6)) % 1, sw = ph < 0.7 ? ph / 0.7 : 1 - (ph - 0.7) / 0.3; ang = -1.5 + sw * 3.0; } // 휘두르기
    g.save(); g.translate(Math.round(hx), Math.round(hy)); if (side < 0) g.scale(-1, 1); g.rotate(ang); g.scale(3, 3);
    const p = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.drawImage(k.cv, -k.pv[0], -k.pv[1]); g.imageSmoothingEnabled = p; g.restore();
    return [hx, hy, ang, side];
  }
  function rodTip(o) { const face = o.face | 0, side = face === 2 ? -1 : 1, up = face === 1, down = face === 0; const hx = o.x + (up ? -15 : down ? 17 : 17 * side), hy = o.y - (down || up ? 8 : 10), ang = (down || up) ? 0.2 : 1.0, L = 15 * 3; return [hx + Math.sin(ang) * L * side, hy - Math.cos(ang) * L]; }
  // 물고기 그림 (가게·저장소)
  const FISH_COL = { crucian: ['#8a9a6a', '#b7c48a'], carp: ['#c97a3c', '#f0a860'], trout: ['#6f8fa8', '#a9c6dc'], salmon: ['#e0705a', '#ffa48a'], goldcarp: ['#e8b020', '#fff0a0'], legend: ['#5a7fd6', '#bfe0ff'] };
  function drawFish(g, x, y, kind, k = 3) {
    const [c1, c2] = FISH_COL[kind] || FISH_COL.carp, P = (a, b, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x + a * k), Math.round(y + b * k), w * k, h * k); };
    P(-7, -3, 12, 6, '#2b2340'); P(-6, -2, 10, 4, c1); P(-6, -2, 10, 1, c2); P(4, -2, 2, 4, c1); P(5, -4, 3, 8, '#2b2340'); P(6, -3, 1, 6, c1); P(-5, -1, 1, 1, '#ffffff'); P(-1, 1, 3, 1, c2);
    if (kind === 'goldcarp' || kind === 'legend') { P(-8, -5, 1, 1, '#fff6c8'); P(7, -6, 1, 1, '#fff6c8'); }
  }
  // 낚시 상태: cast(찌 던짐) → wait(입질 기다림) → bite(타이밍 바) → 끝
  const FISHING = { on: false };
  function startFishing(x, y) {
    if (FISHING.on) return; Object.assign(FISHING, { on: true, phase: 'wait', x, y, t0: performance.now(), biteAt: Infinity });
    ws.send(JSON.stringify({ t: 'fishCast', x, y })); SND.play('place');
  }
  function stopFishing(msg) { if (!FISHING.on) return; FISHING.on = false; $('fishBar').hidden = true; if (msg) toast(msg); }
  function fishPress() { // 타이밍 바에서 E
    if (!FISHING.on) return false;
    if (FISHING.phase === 'wait') { stopFishing('너무 일찍 당겼어요! 물고기가 도망갔어요'); ws.send(JSON.stringify({ t: 'fishCatch', grade: 'miss' })); return true; }
    if (FISHING.phase === 'bite') return true; // 문제는 1~4키·클릭으로
    return false;
  }
  function fishMarker() { const u = ((performance.now() - FISHING.bt) / 1000) * FISHING.speed; return Math.abs(((u % 2) + 2) % 2 - 1); } // 0~1 왕복
  function tickFishing() {
    if (!FISHING.on) return;
    if (player.moving) { cancelQuiz(); stopFishing('움직여서 낚시를 그만뒀어요'); ws.send(JSON.stringify({ t: 'fishCatch', grade: 'miss' })); return; }
    const now = performance.now();
    if (FISHING.phase === 'wait' && now >= FISHING.biteAt) { // 입질! 타이밍 바
      const rain = WEATHER === 'rain', g = rain ? 0.17 : 0.13;
      FISHING.phase = 'bite'; FISHING.bt = now; void g;
      showQuiz(rain ? '🎣 입질! (비 오는 날 · 시간 넉넉) 정답을 골라 낚아 올려요' : '🎣 입질! 정답을 골라 낚아 올려요', rain ? 8000 : 6000, (grade) => {
        FISHING.on = false; ws.send(JSON.stringify({ t: 'fishCatch', grade })); if (grade === 'perfect') toast('✨ 완벽! 귀한 물고기가 잘 잡혀요');
      });
    }
  }
  function drawFishLine(g, o, bx, by, bite, t) { // 낚싯줄 + 찌
    const [tx, ty] = rodTip(o), dip = bite ? 4 + Math.sin(t * 30) * 3 : Math.sin(t * 3) * 1.5;
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo((tx + bx) / 2, Math.max(ty, by) + 10, bx, by + dip); g.stroke();
    g.fillStyle = '#2b2340'; g.fillRect(bx - 4, by - 6 + dip, 8, 10); g.fillStyle = '#e8423c'; g.fillRect(bx - 3, by - 5 + dip, 6, 4); g.fillStyle = '#ffffff'; g.fillRect(bx - 3, by - 1 + dip, 6, 4);
    g.strokeStyle = `rgba(255,255,255,${bite ? 0.8 : 0.4})`; g.lineWidth = 1; g.beginPath(); g.ellipse(bx, by + 4, 8 + (t * 10 % 6), 3, 0, 0, Math.PI * 2); g.stroke();
    if (bite) { g.font = `700 22px ${PFONT}`; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = '#2b2340'; g.strokeText('!', o.x, o.y - 70); g.fillStyle = '#ffd84d'; g.fillText('!', o.x, o.y - 70); }
  }
  // 비 (땅에서만): 빗줄기 + 살짝 어둡게 + 물 위 동그라미
  function drawRain(t) { // 빗줄기·물방울을 세상 좌표에 고정 → 내가 움직여도 비가 따라오지 않고 땅에 떨어짐
    const cx = groundCam.x * zoom, cy = groundCam.y * zoom, md = (a, m) => ((a % m) + m) % m;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = 'rgba(40,60,100,0.16)'; ctx.fillRect(0, 0, vw, vh);
    ctx.strokeStyle = 'rgba(200,225,255,0.55)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < 140; i++) { const sp = 700 + (i % 7) * 60, X = md(hash(i, 3, 5) * (vw + 200) - t * 120 - cx, vw + 200) - 100, y = md(hash(i, 4, 5) * (vh + 100) + t * sp - cy, vh + 100) - 50; ctx.moveTo(X, y); ctx.lineTo(X - 4, y + 14); }
    ctx.stroke(); ctx.restore(); ctx.save(); ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -groundCam.x * dpr * zoom, -groundCam.y * dpr * zoom);
    const tx0 = Math.floor(groundCam.x / TILE) - 1, ty0 = Math.floor(groundCam.y / TILE) - 1, tx1 = tx0 + Math.ceil(vw / zoom / TILE) + 2, ty1 = ty0 + Math.ceil(vh / zoom / TILE) + 2;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) { if (hash(tx, ty, 21) > 0.07) continue; // 물방울 튀기 (땅 위 정해진 자리에서)
      const sp = 0.8 + hash(tx, ty, 22), u = t * sp + hash(tx, ty, 23) * 5, cyc = Math.floor(u), k = u - cyc; if (hash(tx, ty, cyc) > 0.6) continue;
      const x = tx * TILE + hash(tx, cyc, 11) * TILE, y = ty * TILE + hash(ty, cyc, 13) * TILE;
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = 'rgba(225,240,255,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y, 3 + k * 9, 1 + k * 3, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(235,245,255,0.95)'; const hgt = Math.sin(k * Math.PI) * 9; ctx.fillRect(x - 5 - k * 5, y - hgt, 2, 2); ctx.fillRect(x + 4 + k * 5, y - hgt, 2, 2); ctx.fillRect(x - 1, y - hgt * 1.4, 2, 2); }
    ctx.globalAlpha = 1; ctx.restore();
  }


  // ------------------------------------------------------------ 실시간 전투 (땅 어디서나): J 누르면 공격, 꾹 눌렀다 떼면 차징
  const WPN_SPR = { sword: 'sword', dagger: 'dagger', axe: 'axe', spear: 'spear', bow: 'bow', magic: 'staff', fist: 'fist' };
  const WPN_FX = { sword: ['sword-slash', 'spin-slash'], axe: ['heavy-cleave', 'hammer-smash'], spear: ['thrust', 'thrust'], dagger: ['dagger-flurry', 'double-slash'], fist: ['blunt-hit', 'cartoon-pow'] };
  let MY_WEAPONS = {}, MY_WEAPON = null;
  const myWeapon = () => (MY_WEAPON && MY_WEAPONS[MY_WEAPON] ? MY_WEAPON : 'fist'); // 무기는 상점에서 직접 사야 함
  const remWeapon = (r) => r.weapon || 'fist';
  const PV = { hp: 100, deadUntil: 0, invUntil: 0, lastAtk: 0, flash: 0 }; // 내 전투 상태
  const ATK = { down: false, t0: 0 };
  const HPMAX = MPRules.NUM.pvp.hp, FXK = 1.5; // 이펙트 1칸 = 월드 1.5px (캐릭터 도트 3px의 절반)
  const WFX = []; // { f, x, y, vx, vy, life }
  let PFXW = null, pfxwLoading = null;
  function loadPfxW() {
    if (PFXW || pfxwLoading) return pfxwLoading;
    const names = ['melee/sword-slash', 'melee/spin-slash', 'melee/heavy-cleave', 'melee/hammer-smash', 'melee/thrust', 'melee/dagger-flurry', 'melee/double-slash', 'projectiles/arrow', 'fire/fireball', 'impacts/hit-spark', 'impacts/crit-hit', 'impacts/blunt-hit', 'ui/damage-number', 'ui/crit-number', 'spawn/shatter-death', 'spawn/respawn-beam', 'explosions/small-explosion', 'explosions/cartoon-pow', 'arcane/spell-charge', 'spawn/poof'];
    pfxwLoading = Promise.all([import('./assets/pixelfx/core/index.js'), ...names.map((n) => import('./assets/pixelfx/fx/' + n + '.js'))])
      .then(([core, ...mods]) => { const fx = {}; names.forEach((n, i) => { fx[n.split('/')[1]] = mods[i]; }); PFXW = { core, fx, frame: null, img: null, off: null }; }).catch(() => { PFXW = null; });
    return pfxwLoading;
  }
  function wfx(name, x, y, o = {}, mv = null) { // 월드 좌표에 이펙트
    if (!PFXW || !PFXW.fx[name]) return null; const f = PFXW.core.createFx(PFXW.fx[name], Object.assign({ x: 0, y: 0 }, o));
    const e = Object.assign({ f, x, y, vx: 0, vy: 0, life: Infinity }, mv || {}); WFX.push(e); return e;
  }
  function drawWfx(dt, camX, camY) { // 화면 크기 프레임 하나에 모아서 그림
    if (!PFXW || !WFX.length) return;
    const fw = Math.ceil(vw / zoom / FXK) + 2, fh = Math.ceil(vh / zoom / FXK) + 2, P = PFXW;
    if (!P.frame || P.frame.w !== fw || P.frame.h !== fh) { P.frame = P.core.createFrame(fw, fh); P.img = new ImageData(fw, fh); P.off = document.createElement('canvas'); P.off.width = fw; P.off.height = fh; }
    const ox = Math.floor(camX / FXK) * FXK, oy = Math.floor(camY / FXK) * FXK;
    P.core.clearFrame(P.frame);
    for (let i = WFX.length - 1; i >= 0; i--) {
      const e = WFX[i]; e.x += e.vx * dt; e.y += e.vy * dt; e.life -= dt; if (e.follow) { e.x = e.follow.x + (e.fdx || 0); e.y = e.follow.y + (e.fdy || 0); }
      if (e.life <= 0 && !e.stopped) { e.f.stop(); e.stopped = true; if (e.onEnd) e.onEnd(e); }
      e.f.update(dt); if (e.f.done()) { WFX.splice(i, 1); continue; }
      e.f.options.x = Math.round((e.x - ox) / FXK); e.f.options.y = Math.round((e.y - oy) / FXK); e.f.draw(P.frame);
    }
    P.img.data.fill(0); P.core.composite(P.frame, P.img.data, null); P.off.getContext('2d').putImageData(P.img, 0, 0);
    const pv = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = false; ctx.drawImage(P.off, ox, oy, fw * FXK, fh * FXK); ctx.imageSmoothingEnabled = pv;
  }
  const amDead = () => performance.now() < PV.deadUntil;
  function canAttack() { return ONLINE && netOn && player.scene === 'ground' && !amDead() && !(jailUntil > Date.now()) && !build.on && $('talk').hidden && !FISHING.on && !document.querySelector('.modalbox:not([hidden]), #closet:not([hidden])'); }
  let LAST_WEAPON = null;
  function swapWeapon() { // 주먹 ↔ 무기 (여러 개면 차례로)
    if (!ONLINE || !netOn) return; const owned = Object.keys(MY_WEAPONS || {}); if (!owned.length) { toast(`가진 무기가 없어요 · ${MPRules.NUM.weaponDay}일차부터 하늘 상점가 무기 상점에서 사요`); return; }
    const cur = myWeapon(); let next;
    if (cur === 'fist') next = LAST_WEAPON && MY_WEAPONS[LAST_WEAPON] ? LAST_WEAPON : owned[0];
    else { LAST_WEAPON = cur; const i = owned.indexOf(cur); next = i >= 0 && i < owned.length - 1 && owned.length > 1 ? owned[i + 1] : ''; }
    ws.send(JSON.stringify({ t: 'equipWeapon', w: next })); SND.play('place');
  }
  function swapIcon() { const cv = $('swapCv'); if (!cv) return; const g = cv.getContext('2d'), w = myWeapon(), S2 = TOOL[WPN_SPR[w]]; g.clearRect(0, 0, cv.width, cv.height); g.imageSmoothingEnabled = false; if (!S2) return; const k = w === 'fist' ? 5 : Math.max(1, Math.min(30 / S2.cv.width, 30 / S2.cv.height) | 0); g.save(); g.translate(cv.width / 2, cv.height / 2); g.rotate(S2.noRot ? 0 : 0.6); g.drawImage(S2.cv, -S2.cv.width * k / 2, -S2.cv.height * k / 2, S2.cv.width * k, S2.cv.height * k); g.restore(); }
  function atkDown() { if (ATK.down || !canAttack()) return; loadPfxW(); ATK.down = true; ATK.t0 = performance.now(); }
  function atkUp() {
    if (!ATK.down) return; ATK.down = false; if (ATK.chFx) { ATK.chFx.f.stop(); ATK.chFx.stopped = true; ATK.chFx = null; }
    if (!canAttack()) return; const W2 = MPRules.WEAPONS[myWeapon()], lv = performance.now() - ATK.t0 >= 550 ? 1 : 0, now = performance.now();
    if (now - PV.lastAtk < W2.cd * (lv ? 1.5 : 1)) return; PV.lastAtk = now;
    ws.send(JSON.stringify({ t: 'atk', dir: player.face | 0, lv }));
  }
  const atkCharge = () => ATK.down ? Math.min(1, (performance.now() - ATK.t0) / 550) : -1;
  // 무기 그리기 (공격 순간 휘두름 · 차징 중엔 뒤로 젖힘)
  function drawWeaponOn(g, o, w, t) {
    const S = TOOL[WPN_SPR[w]]; if (!S || player.scene !== 'ground') return;
    const face = o.face | 0, side = face === 2 ? -1 : 1, up = face === 1, down = face === 0;
    const swing = o.swing ? (performance.now() - o.swing) / 1000 : 9, chg = o === player ? atkCharge() : -1;
    if (w === 'fist') { // 맨주먹: 평소엔 안 보이고, 칠 때 주먹이 앞으로 쭉 (차징이면 더 크게)
      if (swing >= 0.25 && chg < 0) return; const D = FACE_D[face] || [0, 1], k = chg >= 0 ? -0.3 * chg : Math.sin(Math.min(1, swing / 0.25) * Math.PI), big = o.swingLv && swing < 0.25 ? 4 : 3;
      const fx = o.x + D[0] * (14 + k * 18) + (D[1] ? 10 : 0), fy = o.y - 22 + D[1] * (6 + k * 14);
      const pv = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.drawImage(S.cv, Math.round(fx - 3 * big), Math.round(fy - 3 * big), 6 * big, 6 * big); g.imageSmoothingEnabled = pv;
      if (k > 0.5) { g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(fx - D[0] * 10 + D[1] * i * 5, fy - D[1] * 10 + D[0] * i * 5); g.lineTo(fx - D[0] * 22 + D[1] * i * 5, fy - D[1] * 22 + D[0] * i * 5); g.stroke(); } } // 속도선
      return;
    }
    let hx = o.x + (up ? -15 : down ? 17 : 17 * side), hy = o.y - (down || up ? 8 : 10), ang = 0.35, push = 0;
    if (w === 'bow') { ang = 0; hx = o.x + (up ? -14 : down ? 16 : 13 * side); }
    if (chg >= 0) { ang = w === 'spear' ? 1.57 : w === 'bow' ? 0 : -0.9; push = w === 'bow' ? -chg * 5 : 0; }
    if (swing < 0.4) {
      if (w === 'spear') { ang = 1.57; push = Math.sin(Math.min(1, swing / 0.25) * Math.PI) * 14; }
      else if (w === 'bow' || w === 'magic') { push = Math.sin(Math.min(1, swing / 0.2) * Math.PI) * (w === 'bow' ? -3 : 4); ang = w === 'magic' ? 0.35 + Math.sin(Math.min(1, swing / 0.25) * Math.PI) * 0.9 : 0; }
      else if (o.swingLv && w === 'sword') ang = swing * 26;
      else { const k = Math.min(1, swing / 0.18), [s0, s1] = w === 'axe' ? [-2, 2.4] : w === 'dagger' ? [-1, 1.8] : [-1.4, 2.2]; ang = s0 + (s1 - s0) * (1 - Math.pow(1 - k, 3)); }
    } // 평소엔 손에 들고 다님 (관리자 전투 실험실처럼)
    g.save(); g.translate(Math.round(hx), Math.round(hy)); if (side < 0) g.scale(-1, 1); g.rotate(S.noRot ? 0 : ang); g.translate(w === 'spear' || S.noRot ? push : 0, 0);
    if (chg >= 0.99) { g.shadowColor = '#fff2a8'; g.shadowBlur = 8; }
    g.scale(3, 3); const p = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.drawImage(S.cv, -S.pv[0], -S.pv[1]); g.imageSmoothingEnabled = p; g.restore();
  }
  function drawHpBar2(g, x, y, hp) { const k = Math.max(0, hp) / HPMAX; g.fillStyle = '#2b2340'; g.fillRect(x - 22, y, 44, 7); g.fillStyle = '#5a1a2a'; g.fillRect(x - 21, y + 1, 42, 5); g.fillStyle = k > 0.5 ? '#5fd36a' : k > 0.25 ? '#f0c23a' : '#e8423c'; g.fillRect(x - 21, y + 1, Math.round(42 * k), 5); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x - 21, y + 1, Math.round(42 * k), 1); }
  // 서버가 알려 준 공격 → 휘두름 + 이펙트 + 맞은 사람 숫자
  function onFx(m) {
    loadPfxW();
    const isMe = m.a === myId, a = isMe ? player : remotes.get(m.a); const D = FACE_D[m.dir] || [0, 1];
    const ax = a && a.x != null ? a.x : m.x, ay = a && a.y != null ? a.y : m.y;
    if (a) { a.swing = performance.now(); a.swingLv = m.lv; a.face = m.dir; if (!isMe) a.dir = m.dir; }
    const W2 = MPRules.WEAPONS[m.w] || MPRules.WEAPONS.fist, flip = D[0] < 0, ang = D[1] ? (D[1] > 0 ? Math.PI / 2 : -Math.PI / 2) : 0, cy = ay - 20;
    const tgt = (h) => (h.id === myId ? player : remotes.get(h.id));
    const vol = isMe ? 1 : Math.max(0.12, Math.min(0.85, 1 - Math.hypot(ax - player.x, ay - player.y) / 700)); // 멀수록 작게
    SND.play({ sword: m.lv ? 'swingSpin' : 'swingSword', axe: m.lv ? 'slam' : 'swingHeavy', spear: 'stab', dagger: 'swingDagger', bow: 'bow', magic: 'fire', fist: m.lv ? 'pow' : 'punch' }[m.w] || 'punch', vol);
    const showHit = (h, delay) => setTimeout(() => {
      const o = tgt(h); if (!o) return; o.hpShow = performance.now(); o.hp = h.hp;
      { const dx = o.x - ax, dy = o.y - ay, L = Math.hypot(dx, dy) || 1; o.hitAt = performance.now(); o.hitDx = dx / L; o.hitDy = dy / L; if (m.a === myId) shakeT = Math.max(shakeT || 0, m.lv ? 0.16 : 0.08); }
      if (h.id === myId) { PV.hp = h.hp; PV.flash = performance.now(); shakeT = Math.max(shakeT || 0, h.crit ? 0.3 : 0.18); }
      wfx(h.crit ? 'crit-hit' : m.w === 'axe' || m.w === 'fist' ? 'blunt-hit' : 'hit-spark', o.x, o.y - 24, { flip: o.x < ax });
      wfx(h.crit ? 'crit-number' : 'damage-number', o.x, o.y - 66, { text: h.crit ? h.dmg + '!' : '-' + h.dmg, seed: (Math.random() * 99) | 0 });
      if (h.dead) { o.downUntil = performance.now() + MPRules.NUM.pvp.respawnSec * 1000; wfx('shatter-death', o.x, o.y); }
      SND.play(h.dead ? 'ko' : h.crit || m.lv ? 'smackHeavy' : 'smack', h.id === myId || isMe ? 1 : vol);
    }, delay);
    if (!W2.proj) {
      const fxn = (WPN_FX[m.w] || WPN_FX.fist)[m.lv ? 1 : 0];
      if (m.w === 'fist') { if (m.lv) wfx('cartoon-pow', ax + D[0] * 34, cy + D[1] * 26, {}); else wfx('hit-spark', ax + D[0] * 30, cy + D[1] * 22, { flip, angle: ang }); } // 주먹: 퍽 / 차징이면 POW!
      else wfx(fxn, ax + D[0] * 3, ay - (D[1] ? 20 : 0), { flip, angle: ang });
      (m.hits || []).forEach((h) => showHit(h, 110));
    } else {
      const rays = m.w === 'bow' && m.lv ? [-0.22, 0, 0.22] : [0], sp = m.w === 'bow' ? 520 : 300, range = W2.range * (m.lv ? 1.3 : 1);
      const hits = (m.hits || []).slice();
      rays.forEach((ra) => {
        const base = Math.atan2(D[1], D[0]) + ra; let dist = range, hit = null;
        if (m.w === 'bow') { // 이 줄에 맞은 사람 찾기
          for (const h of hits) { const o = tgt(h); if (!o) continue; const dx = o.x - ax, dy = o.y - 20 - cy, along = dx * Math.cos(base) + dy * Math.sin(base); if (along > 0 && Math.abs(dx * Math.sin(base) - dy * Math.cos(base)) < 24 && along < dist + 1) { dist = along; hit = h; } }
          if (hit) hits.splice(hits.indexOf(hit), 1);
        } else if (hits.length) { const o = tgt(hits[0]); if (o) dist = Math.max(10, Math.hypot(o.x - ax, o.y - 20 - cy)); }
        const T = dist / sp, vx = Math.cos(base) * sp, vy = Math.sin(base) * sp;
        wfx(m.w === 'bow' ? 'arrow' : 'fireball', ax + Math.cos(base) * 14, cy + Math.sin(base) * 14, { angle: base, light: m.lv ? 1.6 : 1 }, { vx, vy, life: T, onEnd: (e) => {
          if (m.w === 'magic') { SND.play('boom', vol); wfx('small-explosion', e.x, e.y + 14); if (m.lv) wfx('crit-hit', e.x, e.y + 8); (m.hits || []).forEach((h) => showHit(h, 0)); }
          else if (hit) showHit(hit, 0); else wfx('poof', e.x, e.y + 8);
        } });
      });
    }
  }
  function onDead(m) {
    PV.deadUntil = performance.now() + m.sec * 1000; PV.hp = 0; player.downUntil = PV.deadUntil; step.on = false; hold.on = false; stopFishing(); ATK.down = false;
    $('deadBy').textContent = m.by; $('deadWho').textContent = [m.byNation, m.byJob].filter(Boolean).join(' · '); $('deadHow').textContent = `${m.how} · 마지막 한 방 ${m.dmg}`; $('deadDrops').innerHTML = m.drops && m.drops.length ? '떨어뜨린 물고기: ' + m.drops.map((d) => `${esc((BUILD_BY[d.k] || {}).name || d.k)} ${d.n}`).join(', ') + ' (누구나 주울 수 있어요)' : '가방에 물고기가 없어서 떨어뜨린 건 없어요';
    $('dead').hidden = false; SND.play('war');
    const tot = m.sec * 1000, tick = () => { const ms = PV.deadUntil - performance.now(), left = Math.ceil(ms / 1000); if (left <= 0 || $('dead').hidden) return; $('deadSec').textContent = left; $('deadFill').style.width = `${Math.round((1 - ms / tot) * 100)}%`; requestAnimationFrame(tick); }; tick();
  }
  function onKo(m) { // 누가 누구를 기절시켰는지 (주변 사람에게)
    const v = m.v === myId ? player : remotes.get(m.v); if (v) v.downUntil = performance.now() + m.sec * 1000;
    if (m.a === myId) toast(`💫 ${m.who}을(를) 기절시켰어요! (${m.how})`); else if (m.v !== myId) toast(`💫 ${m.by} → ${m.who} 기절 (${m.how})`);
  }
  function onHp(m) {
    if (m.id === myId) { PV.hp = m.hp; player.hp = m.hp; if (m.respawn) { PV.deadUntil = 0; player.downUntil = 0; PV.invUntil = performance.now() + MPRules.NUM.pvp.invMs; player.invUntil = PV.invUntil; $('dead').hidden = true; loadPfxW().then(() => wfx('respawn-beam', player.x, player.y)); toast('수도에서 다시 일어났어요 · 3초 동안 무적'); } return; }
    const r = remotes.get(m.id); if (!r) return; r.hp = m.hp; if (m.hp >= HPMAX) { if (r.downUntil) wfx('respawn-beam', r.x, r.y); r.downUntil = 0; }
  }
  // 떨어진 물고기
  const LOOTS = new Map(); const lootAsked = new Map();
  function drawLoots(g, t) {
    for (const L of LOOTS.values()) {
      const bob = Math.sin(t * 3 + L.id) * 3; g.fillStyle = 'rgba(0,0,0,0.25)'; ell(g, L.x, L.y + 4, 12, 4);
      const B = BUILD_BY[L.k]; if (B && B.fish) drawFish(g, L.x, L.y - 8 + bob, B.fish, 2);
      if (L.n > 1) { g.font = `700 11px ${PFONT}`; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = '#2b2340'; g.strokeText('×' + L.n, L.x + 14, L.y - 14 + bob); g.fillStyle = '#fff'; g.fillText('×' + L.n, L.x + 14, L.y - 14 + bob); }
      if (Math.sin(t * 5 + L.id) > 0.7) { g.fillStyle = '#fff6c8'; g.fillRect(L.x - 12, L.y - 20 + bob, 2, 2); }
      if (player.scene === 'ground' && !amDead() && Math.hypot(L.x - player.x, L.y - player.y) < 40 && (performance.now() - (lootAsked.get(L.id) || 0)) > 1200) { lootAsked.set(L.id, performance.now()); ws.send(JSON.stringify({ t: 'pickLoot', id: L.id })); }
    }
  }
  let shakeT = 0;

  // ------------------------------------------------------------ 스토리: 멸망 조각 · 여신의 고백 · 13일차 편 고르기
  let FRAGS = [], MY_FRAGS = new Set(), MY_SIDE = null, sideAsked = false;
  const FRAG_N = MPRules.STORY.frags.length, SIDE_DAY = MPRules.STORY.sideDay;
  const SIDE_ICON = { angel: '😇', devil: '😈' };
  function setFrags(list) {
    const before = new Set(FRAGS.map((f) => f.i)); FRAGS = list || [];
    const fresh = FRAGS.filter((f) => !before.has(f.i) && !MY_FRAGS.has(f.i) && f.day === DAY);
    if (before.size && fresh.length && !TITLE.on) toast(`✨ 오늘의 멸망 조각이 ${((terrs[f0(fresh).tid] || {}).name || "어딘가")} 근처에 떨어졌어요 · 지도(M)에 보라색 ◆`);
  }
  const f0 = (a) => a[0];
  function drawFrag(g, X, Y, t, i) { // 빛기둥 + 떠다니는 보랏빛 조각
    const bob = Math.sin(t * 2 + i) * 4, a = 0.5 + 0.25 * Math.sin(t * 3 + i);
    const gr = g.createLinearGradient(0, Y - 240, 0, Y); gr.addColorStop(0, 'rgba(190,140,255,0)'); gr.addColorStop(1, `rgba(200,160,255,${a * 0.55})`);
    g.fillStyle = gr; g.fillRect(X - 10, Y - 240, 20, 240); g.fillStyle = `rgba(255,255,255,${a * 0.35})`; g.fillRect(X - 3, Y - 240, 6, 240);
    g.fillStyle = 'rgba(120,60,200,0.3)'; ell(g, X, Y, 16, 5);
    const P = (dx, dy, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(X + dx * 3), Math.round(Y - 34 + bob + dy * 3), w * 3, h * 3); };
    P(-1, -6, 2, 1, '#2b2340'); P(-2, -5, 4, 1, '#2b2340'); P(-3, -4, 6, 7, '#2b2340'); P(-2, 3, 4, 1, '#2b2340'); P(-1, 4, 2, 1, '#2b2340');
    P(-1, -5, 2, 1, '#e9d8ff'); P(-2, -4, 4, 1, '#c9a8ff'); P(-2, -3, 4, 5, '#9a6aff'); P(-2, -3, 2, 5, '#c9a8ff'); P(-1, 2, 2, 1, '#6a3ad0'); P(-1, -2, 1, 2, '#ffffff');
    for (let k = 0; k < 4; k++) { const u = (t * 0.6 + k / 4 + i * 0.13) % 1; g.fillStyle = `rgba(233,216,255,${1 - u})`; g.fillRect(Math.round(X + Math.sin(k * 2.1 + t) * 14), Math.round(Y - 20 - u * 60), 3, 3); }
  }
  function fragNearby() { if (!ONLINE || player.scene !== 'ground') return null; for (const f of FRAGS) if (!MY_FRAGS.has(f.i) && Math.hypot(f.x - player.x, f.y - player.y) < 64) return { kind: 'frag', i: f.i, text: '✨ 멸망 조각 줍기' }; return null; }
  function onFrag(m) {
    MY_FRAGS = new Set(m.have); SND.play('war');
    STORY_LINES.frag = [{ who: `멸망 조각 ${m.have.length}/${FRAG_N}`, text: MPRules.STORY.frags[m.i], memory: true },
      { who: '', text: m.all ? '……마지막 조각이다. 조각들이 하나로 이어지며 빛나기 시작한다.' : `조각 ${m.have.length}/${FRAG_N} · 남은 조각을 모으면 진실을 알 수 있을 것 같다.`, memory: true }];
    fragAll = !!m.all; startOpening('frag');
  }
  let fragAll = false;
  const STORY_LINES = {
    confess: [
      { who: '여신', text: '……플레이어님, 잠깐 시간 괜찮으세요?', dim: 0.5 },
      { who: '여신', text: '처음 만났을 때 "나중에 하겠다"던 이야기…… 기억하세요?' },
      { who: '여신', text: '이제는 말해야 할 것 같아요.' },
      { who: '여신', text: '이 세계는…… 곧 멸망해요.', shake: true, dark: true },
      { who: '여신', text: () => `${LAST_DAY}일차, 12월 ${13 + LAST_DAY}일. 하늘이 갈라지고, 땅이 모두 무너질 거예요.`, dark: true },
      { who: '여신', text: '벌써 균열이 땅을 갉아먹기 시작했어요. 무너지는 땅을 막으려면 백신이 필요해요.' },
      { who: '여신', text: '왜 이런 일이 생기는지는…… 저도 몰라요. 정말이에요.' },
      { who: '여신', text: '다만 세계 곳곳에 보랏빛 조각이 떨어지기 시작했어요. 무언가를 기억하고 있는 조각이에요.' },
      { who: '여신', text: '하루에 하나씩 떨어질 거예요. 조각을 모으면 진실을 알 수 있을지도 몰라요.' },
      { who: '여신', text: '……미안해요. 초대해 놓고, 이런 이야기를 해서.' },
    ],
    reveal: [
      { who: '여신', text: '……기억났어요. 전부 다.', dim: 0.6 },
      { who: '여신', text: '제 곁에 늘 있던 그 친구…… 그 아이가 하늘을 긁고 있었어요.' },
      { who: '???', text: '크크크…… 이제야 알아챘어?', devil: true, dark: true, shake: true },
      { who: '악마', text: '맞아. 이 세계를 무너뜨리는 건 나야. 너무 밝은 세계는 재미없거든.', devil: true, dark: true },
      { who: '여신', text: '이 세계가 무너지고 있었던 건…… 악마 때문이었어요.' },
      { who: '여신', text: () => `${SIDE_DAY}일차가 되면, 모두에게 물어볼 거예요. 끝까지 이 세계를 지켜 줄 건지…… 아니면.` },
    ],
    side: [
      { who: '여신', text: '오늘은 꼭 물어봐야 할 게 있어요.' },
      { who: '???', text: '크크…… 여신 혼자 떠들게 둘 순 없지.', devil: true, dark: true, shake: true },
      { who: '악마', text: '내 편에 서. 무너지는 세계에서도, 내 편은 살아남게 해 주지.', devil: true, dark: true },
      { who: '여신', text: '저와 함께 이 세계를 끝까지 지켜 주세요. 세계를 무너뜨린 건 악마예요.' },
      { who: '여신', text: '선택은…… 당신의 몫이에요.', choice: true },
    ],
  };
  // 악마 그림 (직접 찍은 도트)
  const DEVIL = pxRows([
    '..H..........H..', '..HH........HH..', '...HH.KKKK.HH...', '....HKKKKKKH....', '...KKKKKKKKKK...', '...KKRKKKKRKK...', '...KKKKKKKKKK...', '...KKKWKKWKKK...', '....KKKKKKKK....', '.....KKKKKK.....',
    '...KKKKKKKKKK...', '..KKKPKKKKPKKK..', '..KK.KPPPPK.KK..', '..KK.KKKKKK.KK..', '.....KKKKKK.....', '.....KK..KK.....', '.....KK..KK.....', '....KKK..KKK....'], { H: '#e8dccb', K: '#2a1430', R: '#ff3048', W: '#ffffff', P: '#5a2a6a' });
  function drawDevil(g, cx, cy, sc, t) {
    const glow = g.createRadialGradient(cx, cy, 10, cx, cy, sc * 36); glow.addColorStop(0, 'rgba(255,40,70,0.45)'); glow.addColorStop(1, 'rgba(255,40,70,0)'); g.fillStyle = glow; g.fillRect(cx - sc * 40, cy - sc * 40, sc * 80, sc * 80);
    for (const sgn of [-1, 1]) { g.fillStyle = '#3a1438'; g.beginPath(); const f = Math.sin(t * 4) * sc; g.moveTo(cx + sgn * sc * 4, cy - sc * 6); g.lineTo(cx + sgn * sc * 26, cy - sc * 16 + f); g.lineTo(cx + sgn * sc * 22, cy - sc * 2 + f); g.lineTo(cx + sgn * sc * 18, cy + sc * 2 + f); g.lineTo(cx + sgn * sc * 12, cy - sc * 1); g.lineTo(cx + sgn * sc * 4, cy + sc * 4); g.fill(); g.strokeStyle = '#7a2a5a'; g.lineWidth = sc * 0.8; g.stroke(); }
    g.drawImage(DEVIL, Math.round(cx - 8 * sc * 1.6), Math.round(cy - 12 * sc * 1.6), 16 * sc * 1.6, 18 * sc * 1.6);
  }
  function openFragBook() {
    const rows = []; for (let i = 0; i < FRAG_N; i++) { const f = FRAGS.find((q) => q.i === i), have = MY_FRAGS.has(i), day = DOOM_DAY + i;
      rows.push(`<div class="fbRow ${have ? 'have' : ''}"><b>${i + 1}</b><div><small>${day}일차 조각</small><p>${have ? esc(MPRules.STORY.frags[i]) : f ? `아직 못 주웠어요 · <u>${esc((terrs[f.tid] || {}).name || "어딘가")}</u> 근처에 떨어져 있어요 (지도에 ◆)` : '아직 떨어지지 않았어요'}</p></div></div>`); }
    $('fbCount').textContent = `${MY_FRAGS.size} / ${FRAG_N}`; $('fbBody').innerHTML = rows.join('');
    $('fbSide').hidden = !(ONLINE && DAY >= SIDE_DAY && !MY_SIDE); $('fbMine').textContent = MY_SIDE ? `내 편: ${SIDE_ICON[MY_SIDE]} ${MY_SIDE === 'angel' ? '천사 편' : '악마 편'}` : '';
    $('fragBook').hidden = false;
  }
  function pickSide(side) {
    if (netOn) ws.send(JSON.stringify({ t: 'side', side })); $('opChoice').hidden = true;
    OPL.push(side === 'angel' ? { who: '여신', text: '고마워요…… 끝까지, 함께해요.' } : { who: '악마', text: '크크, 현명한 선택이야. 무너지는 걸 같이 구경하자고.', devil: true, dark: true });
    OP.i++; showLine();
  }
  // ------------------------------------------------------------ 자유 게시판 (가까이 가면 위에 작게 뜸 · 움직일 수 있음)
  const BP = { view: 'list', sel: null, closed: false, open: false };
  const fmtMD = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; };
  function nearBigBoard() { if (player.scene !== 'sky' || !player.room) return false; for (const sp of player.room.sprites) if (sp.prop && sp.prop.bigBoard && Math.abs(sp.x - player.x) < 220 && player.y - sp.y < 170) return true; return false; }
  function tickWelcome() { // 처음 세상에 들어오면 환영 인사 (한 번만)
    if (!ONLINE || !netOn || !titleDone || TITLE.on || OP.on || store('mp2026.welcomed')) return;
    if (document.querySelector('.modalbox:not([hidden]), #found:not([hidden]), #doomPop:not([hidden]), #closet:not([hidden]), #loading:not([hidden])')) return;
    store('mp2026.welcomed', 1); const el = $('welcome'), lines = ['환영합니다!', '영토를 확장하고 키워 나가 보세요!', '원하는 대로 행동하시면 됩니다!'];
    el.hidden = false; SND.play('war'); let i = 0;
    const next = () => { if (i >= lines.length) { el.classList.add('out'); setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 600); return; } $('wcText').textContent = lines[i]; $('wcText').classList.remove('pop'); void $('wcText').offsetWidth; $('wcText').classList.add('pop'); i++; setTimeout(next, i === 1 ? 1600 : 2400); };
    next();
  }
  function tickWar3() { // 3일차 처음 들어오면: "영역전 개막!" 쾅 + 무기 상점 열림 (한 번만)
    if (!ONLINE || !netOn || !titleDone || TITLE.on || OP.on || DAY < MPRules.NUM.weaponDay || store('mp2026.war3')) return;
    if (!$('welcome').hidden || document.querySelector('.modalbox:not([hidden]), #found:not([hidden]), #doomPop:not([hidden]), #closet:not([hidden]), #loading:not([hidden])')) return;
    store('mp2026.war3', 1); const el = $('war3'); el.hidden = false; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); SND.play('war'); shakeT = 0.6;
    setTimeout(() => SND.play('war'), 450); setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.hidden = true; el.classList.remove('out', 'go'); }, 700); }, 4200);
  }
  function tickBoard() {
    const nb = nearBigBoard(); if (!nb) BP.closed = false;
    const show = nb && !BP.closed && ONLINE; if (show !== BP.open) { BP.open = show; $('boardPanel').hidden = !show; if (show) { BP.view = 'list'; renderBoard(); } }
  }
  function renderBoard() {
    if (!BP.open) return; const list = BOARD.slice().reverse(), me = player.name;
    $('bpList').hidden = BP.view !== 'list'; $('bpView').hidden = BP.view !== 'view'; $('bpForm').hidden = BP.view !== 'new';
    if (BP.view === 'list') $('bpList').innerHTML = list.length ? list.map((q) => `<button type="button" class="bpRow ${BP.sel === q.id ? 'on' : ''}" data-id="${q.id}"><span class="n">${q.name === me ? '★' : q.id}</span><span class="a" style="${q.color ? `color:${esc(q.color)}` : ''}">${esc(q.nation || q.name)}</span><span class="d">${fmtMD(q.ts)}</span><span class="t">${esc(q.title)}</span></button>`).join('') : '<p class="bpEmpty">아직 글이 없어요 · 새 글로 인재 모집, 동맹 구함 같은 걸 올려 보세요</p>';
    if (BP.view === 'view') { const q = BOARD.find((x) => x.id === BP.sel); if (!q) { BP.view = 'list'; return renderBoard(); } $('bpView').innerHTML = `<h3>${esc(q.title)}</h3><small>${q.nation ? `<b style="color:${esc(q.color)}">■ ${esc(q.nation)}</b> · ` : ''}${esc(q.name)} · ${fmtMD(q.ts)}</small><p>${esc(q.body || '(내용 없음)')}</p>`; }
    if (BP.view === 'new') { $('bpAsNat').parentElement.hidden = !MY_NID; if (MY_NID) $('bpNatName').textContent = natName(MY_NID); }
    const sel = BOARD.find((x) => x.id === BP.sel); $('bpDel').disabled = !(sel && sel.name === me) || BP.view === 'new'; $('bpViewBtn').textContent = BP.view === 'list' ? '보기' : '목록';
    for (const b of $('bpList').querySelectorAll('[data-id]')) { b.onclick = () => { BP.sel = +b.dataset.id; renderBoard(); }; b.ondblclick = () => { BP.sel = +b.dataset.id; BP.view = 'view'; renderBoard(); }; }
  }
  // ------------------------------------------------------------ MP 수학 문제 (낚시 입질 · 금광 곡괭이질): 4지선다, 1~4키나 클릭, 빨리 맞히면 '완벽'
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  function mathQ() {
    const R = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const K = [
      () => { const a = R(12, 29), b = R(3, 9); return [`${a} × ${b}`, a * b]; },
      () => { const a = R(11, 25); return [`${a}²`, a * a]; },
      () => { const k = R(5, 12); return [`2의 ${k}제곱`, 2 ** k]; },
      () => { const x = R(2, 15), a = R(2, 9), b = R(1, 20); return [`${a}x + ${b} = ${a * x + b}  →  x = ?`, x]; },
      () => { const g = R(2, 12), a = g * R(2, 9), b = g * R(2, 9); return [`gcd(${a}, ${b})`, gcd(a, b)]; },
      () => { const n = R(6, 20); return [`1 + 2 + … + ${n}`, n * (n + 1) / 2]; },
      () => { const a = R(30, 99), b = R(4, 9); return [`${a}을 ${b}로 나눈 나머지`, a % b]; },
      () => { const n = R(5, 12); return [`${n}C2 (${n}개 중 2개 고르기)`, n * (n - 1) / 2]; },
      () => { const a = R(3, 9), b = R(3, 9); return [`${a * b} ÷ ${a} + ${b}²`, b + b * b]; },
      () => { const a = R(2, 9); return [`${a}³`, a * a * a]; },
    ];
    const [q, ans] = K[Math.floor(Math.random() * K.length)](); const opts = new Set([ans]);
    const near = [1, -1, 2, -2, 10, -10, 3, ans > 20 ? 5 : 4];
    while (opts.size < 4) { const d = near[Math.floor(Math.random() * near.length)] * (Math.random() < 0.2 ? 2 : 1), v = ans + d; if (v >= 0) opts.add(v); }
    return { q, ans, opts: [...opts].sort(() => Math.random() - 0.5) };
  }
  const MQ = { on: false };
  function showQuiz(title, limit, done) {
    const Q = mathQ(); Object.assign(MQ, { on: true, Q, t0: performance.now(), limit, done });
    $('mqTitle').textContent = title; $('mqQ').textContent = Q.q;
    $('mqOpts').innerHTML = Q.opts.map((v, i) => `<button type="button" data-mq="${i}"><kbd>${i + 1}</kbd>${v}</button>`).join('');
    for (const b of $('mqOpts').querySelectorAll('[data-mq]')) b.onclick = () => answerQuiz(+b.dataset.mq);
    $('mathQuiz').hidden = false; SND.play('hit');
  }
  function answerQuiz(i) {
    if (!MQ.on) return; const t = performance.now() - MQ.t0, ok = i >= 0 && MQ.Q.opts[i] === MQ.Q.ans;
    const grade = ok ? (t <= MQ.limit * 0.45 ? 'perfect' : 'good') : 'miss'; MQ.on = false;
    for (const b of $('mqOpts').querySelectorAll('[data-mq]')) { const v = MQ.Q.opts[+b.dataset.mq]; b.classList.toggle('right', v === MQ.Q.ans); b.classList.toggle('wrong', +b.dataset.mq === i && !ok); b.disabled = true; }
    $('mqTitle').textContent = ok ? (grade === 'perfect' ? '✨ 완벽! 빠르고 정확해요' : '⭕ 정답!') : i < 0 ? `⏰ 시간 끝! 정답은 ${MQ.Q.ans}` : `❌ 아쉬워요! 정답은 ${MQ.Q.ans}`;
    setTimeout(() => { if (!MQ.on) $('mathQuiz').hidden = true; }, ok ? 700 : 1500);
    const d = MQ.done; MQ.done = null; if (d) d(grade);
  }
  function cancelQuiz() { if (!MQ.on) return; MQ.on = false; MQ.done = null; $('mathQuiz').hidden = true; }
  function tickQuiz() { if (!MQ.on) return; const k = 1 - (performance.now() - MQ.t0) / MQ.limit; $('mqTime').style.width = `${Math.max(0, k) * 100}%`; if (k <= 0) answerQuiz(-1); }
  function startMine(n) { // 금광: 곡괭이질 하는 동안 문제 하나 → 맞히면 캐짐 (최소 곡괭이질 시간은 서버가 확인)
    if (MQ.on) return; Object.assign(hold, { on: true, t0: performance.now(), ms: 1e9, kind: 'mine', terr: n.terr, nx: n.nx, ny: n.ny, x: n.x, y: n.y });
    ws.send(JSON.stringify({ t: 'mineStart', terr: n.terr })); const t0 = performance.now();
    showQuiz('⛏ 곡괭이질! 정답을 맞히면 금이 나와요', 8000, (grade) => {
      if (grade === 'miss') { hold.on = false; toast('곡괭이가 빗나갔어요… 다시 E'); return; }
      const wait = Math.max(0, MPRules.NUM.mineHoldMs - (performance.now() - t0) + 80);
      setTimeout(() => { hold.on = false; if (netOn) ws.send(JSON.stringify({ t: 'mine', terr: n.terr, grade })); }, wait);
    });
  }
  // ------------------------------------------------------------ 동물: 집 자리 둘레를 일정한 속도로 왔다 갔다 (모두 같은 시간 공식이라 다른 사람 화면과 비슷)
  const ANIMAL_SPD = { chick: 26, hen: 22, pig: 18, rabbit: 40, cow: 14, slime: 16, slime2: 16, mushroom: 12, cactus: 0, rat: 34, dog: 36 };
  function animalPos(name, hx, hy, seed, okAt) {
    const sp = ANIMAL_SPD[name] ?? 20; if (!sp) return [hx, hy, 1];
    const L = 44, walk = L / sp, pause = 1.6 + hash(seed, 3, 9) * 2.4, P = walk + pause, t = performance.now() / 1000 + hash(seed, 5, 9) * 50;
    const leg = Math.floor(t / P), u = (t - leg * P) / walk, k = Math.min(1, u), pair = Math.floor(leg / 2);
    let a = hash(seed, pair, 11) * Math.PI * 2, ex = hx + Math.cos(a) * L, ey = hy + Math.sin(a) * L * 0.7;
    if (okAt && !okAt(ex, ey)) { a += Math.PI; ex = hx + Math.cos(a) * L; ey = hy + Math.sin(a) * L * 0.7; if (!okAt(ex, ey)) return [hx, hy, 1]; }
    const out = leg % 2 === 0, fx = out ? hx : ex, fy = out ? hy : ey, tx2 = out ? ex : hx, ty2 = out ? ey : hy;
    return [fx + (tx2 - fx) * k, fy + (ty2 - fy) * k, tx2 < fx ? -1 : 1, u < 1];
  }
  function drawAnimal(g, name, hx, hy, seed, okAt) {
    const [x, y, dir, moving] = animalPos(name, hx, hy, seed, okAt), im = ART['u_' + name]; if (!im) return;
    const bob = moving ? (Math.floor(performance.now() / 140 + seed) % 2) : 0, w = im.width * 2, h = im.height * 2;
    g.fillStyle = 'rgba(0,0,0,0.18)'; ell(g, x, y, w * 0.32, 3);
    const pv = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; g.save(); g.translate(Math.round(x), Math.round(y - bob)); if (dir > 0) g.scale(-1, 1); g.drawImage(im, -Math.round(w / 2), -h, w, h); g.restore(); g.imageSmoothingEnabled = pv; // 동물 그림은 왼쪽을 보고 있어서 오른쪽으로 갈 때 뒤집음
  }
  let WEATHER = 'clear', lastAct = null, FISHPOP = null, MY_TOOLS = {}, MY_PCOIN = 0, MY_HATS = {}, MY_JOB = null;
  const jobIcon = (j) => (j && MPRules.JOBS[j] ? MPRules.JOBS[j].icon + ' ' : '');
  const TOOL_HINT = (k) => `${MPRules.TOOLS[k].name}이(가) 있어야 해요 · 하늘 천상 상점가 '치유의 샘'에서 사요`;
  // ------------------------------------------------------------ 동맹 계약서 (두 왕이 만나서 서명)
  const CONTRACT = { cid: null, me: null, signed: {}, drawing: false, dirty: false };
  const CONTRACT_ARTICLES = [
    ['제1조 (동맹)', '두 나라는 이 계약서에 두 왕이 서명한 때부터 동맹이 된다. 동맹은 최대 3나라까지다.'],
    ['제2조 (불가침)', '동맹국끼리는 서로 선전포고할 수 없다.'],
    ['제3조 (참전)', '동맹국이 싸우면 왕은 병력을 정해 전선에 직접 보낼 수 있다. 한 전투에 한 번만, 보낸 병력은 뺄 수 없다.'],
    ['제4조 (보상)', '함께 이기면 빼앗은 재료를 낸 병력 비율로 나눈다. 살아남은 참전 병력은 참전한 나라로 돌아간다.'],
    ['제5조 (탈퇴)', '어느 나라든 언제든지 동맹에서 나갈 수 있다. 나가면 다시 서로 공격할 수 있다.'],
  ];
  function openContract(m) {
    Object.assign(CONTRACT, { cid: m.cid, me: m.me, signed: {}, dirty: false });
    $('ctParties').innerHTML = ['a', 'b'].map((k) => `<div class="ctParty"><span>${k === 'a' ? '갑' : '을'}</span><b style="color:${m[k].color}">■ ${esc(m[k].nation)}</b><small>왕 ${esc(m[k].king)}</small></div>`).join('<i>🤝</i>');
    $('ctBody').innerHTML = CONTRACT_ARTICLES.map(([h, t]) => `<p><b>${h}</b> ${t}</p>`).join('');
    for (const k of ['a', 'b']) { const cv = $('ctSig_' + k), g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); cv.classList.toggle('mine', k === m.me); $('ctName_' + k).textContent = `${k === 'a' ? '갑' : '을'} · ${m[k].nation} 왕 ${m[k].king}`; $('ctState_' + k).textContent = k === m.me ? '여기에 서명하세요' : '상대 왕의 서명을 기다리는 중…'; }
    $('ctSeal').hidden = true; $('ctSign').disabled = false; $('contract').hidden = false; SND.play('ok');
  }
  function contractPad() { // 내 서명 칸에 마우스·손가락으로 그리기
    const pos = (cv, e) => { const r = cv.getBoundingClientRect(), p = e.touches ? e.touches[0] : e; return [(p.clientX - r.left) * cv.width / r.width, (p.clientY - r.top) * cv.height / r.height]; };
    for (const k of ['a', 'b']) {
      const cv = $('ctSig_' + k), g = cv.getContext('2d');
      const down = (e) => { if (CONTRACT.me !== k || CONTRACT.signed[k]) return; e.preventDefault(); CONTRACT.drawing = true; const [x, y] = pos(cv, e); g.strokeStyle = '#2b2340'; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(x, y); };
      const move = (e) => { if (!CONTRACT.drawing || CONTRACT.me !== k) return; e.preventDefault(); const [x, y] = pos(cv, e); g.lineTo(x, y); g.stroke(); CONTRACT.dirty = true; };
      const up = () => { CONTRACT.drawing = false; };
      cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); addEventListener('pointerup', up);
    }
    $('ctClear').onclick = () => { const k = CONTRACT.me; if (!k || CONTRACT.signed[k]) return; $('ctSig_' + k).getContext('2d').clearRect(0, 0, 260, 90); CONTRACT.dirty = false; };
    $('ctSign').onclick = () => { const k = CONTRACT.me; if (!k || CONTRACT.signed[k]) return; if (!CONTRACT.dirty) { toast('서명 칸에 이름을 써 주세요'); return; } ws.send(JSON.stringify({ t: 'contractSign', cid: CONTRACT.cid, sig: $('ctSig_' + k).toDataURL('image/png') })); $('ctSign').disabled = true; };
    $('ctTear').onclick = () => { if (CONTRACT.cid) ws.send(JSON.stringify({ t: 'contractCancel', cid: CONTRACT.cid })); $('contract').hidden = true; CONTRACT.cid = null; };
  }
  function contractSig(m) {
    if (m.cid !== CONTRACT.cid) return; CONTRACT.signed[m.side] = true;
    const cv = $('ctSig_' + m.side), g = cv.getContext('2d'), im = new Image(); im.onload = () => { g.clearRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height); }; im.src = m.sig;
    $('ctState_' + m.side).textContent = '✒ 서명 완료'; SND.play('place');
  }
  function contractDone(m) { if (m.cid !== CONTRACT.cid) return; $('ctSeal').hidden = false; SND.play('war'); setTimeout(() => { $('contract').hidden = true; CONTRACT.cid = null; }, 2600); }
  function contractEnd(m) { if (m.cid !== CONTRACT.cid) return; $('contract').hidden = true; CONTRACT.cid = null; toast(m.text); }
  // 내가 왕이고, 바로 옆에 다른 나라 왕이 있으면 → 동맹 계약 제안
  function kingNearby() {
    if (!ONLINE || !myView || !myView.me.isKing) return null;
    const allies = new Set((myView.allies || []).map((a) => a.id));
    for (const [id, r] of remotes) if (r.x != null && r.king && r.nid && r.nid !== MY_NID && !allies.has(r.nid) && Math.hypot(r.x - player.x, r.y - player.y) < MPRules.NUM.allyMeetTiles * TILE) return { kind: 'allyMeet', id, text: `🤝 ${natName(r.nid)}의 왕 ${r.name}에게 동맹 계약서 내밀기` };
    return null;
  }
  // ------------------------------------------------------------ 병영: 종족별 병력 (인간·엘프·드워프)
  const RACE_DESC = { human: ['균형 잡힌 기사단', '반짝이는 검으로 적을 베어요.', '검 베기'], elf: ['숲의 궁수대', '멀리서 화살을 쏘아요.', '화살 쏘기'], dwarf: ['산의 도끼 전사', '무거운 도끼로 내려찍어요.', '도끼 내려찍기'] };
  let BARRACK_SEL = null, barrackRaf = 0;
  function openBarracks() {
    if (!myView) return; BARRACK_SEL = (nationsPub[MY_NID] && nationsPub[MY_NID].race) || 'human';
    renderBarracks(); $('barracks').hidden = false; cancelAnimationFrame(barrackRaf); barrackLoop();
  }
  function renderBarracks() {
    const cur = (nationsPub[MY_NID] && nationsPub[MY_NID].race) || 'human', king = myView.me.isKing;
    $('bkArmy').innerHTML = `우리 병력 <b>${myView.me.army.toLocaleString()}</b>명`;
    $('bkCards').innerHTML = Object.entries(RACE_INFO).map(([k, v]) => `<button type="button" class="bkCard${k === BARRACK_SEL ? ' sel' : ''}" data-bk="${k}"><canvas width="96" height="96"></canvas><b>${v.icon} ${v.name}</b><small>${RACE_DESC[k][0]}</small><span class="bkW">무기 · ${v.weapon}</span>${k === cur ? '<i>지금 우리 병력</i>' : ''}</button>`).join('');
    for (const c of $('bkCards').querySelectorAll('[data-bk]')) { const g = c.querySelector('canvas').getContext('2d'); g.imageSmoothingEnabled = false; const ch = RACE_INFO[c.dataset.bk].ch; if (ART.aether) g.drawImage(ART.aether, (ch % 8) * 32, Math.floor(ch / 8) * 32, 32, 32, 8, 8, 80, 80); c.onclick = () => { BARRACK_SEL = c.dataset.bk; renderBarracks(); }; }
    const sel = RACE_INFO[BARRACK_SEL];
    $('bkName').textContent = `${sel.icon} ${sel.name} · ${RACE_DESC[BARRACK_SEL][0]}`;
    $('bkDesc').textContent = `${RACE_DESC[BARRACK_SEL][1]} 영역전 화면에서 우리 병사가 이 모습으로 ${RACE_DESC[BARRACK_SEL][2]}를 해요. (지금은 모습만 달라요 · 능력치는 같아요)`;
    $('bkPick').disabled = !king || BARRACK_SEL === cur; $('bkPick').textContent = BARRACK_SEL === cur ? '✔ 지금 우리 병력' : king ? `${sel.name}(으)로 바꾸기` : '종족은 왕만 바꿀 수 있어요';
  }
  function barrackLoop() { // 미리보기: 고른 종족 병사 5명이 줄 맞춰 제자리 걸음
    if ($('barracks').hidden) return; const cv = $('bkPrev'), g = cv.getContext('2d'), t = performance.now() / 1000; g.imageSmoothingEnabled = false;
    const grd = g.createLinearGradient(0, 0, 0, cv.height); grd.addColorStop(0, '#bfe6ff'); grd.addColorStop(0.62, '#e9f7d8'); grd.addColorStop(0.62, '#8fcf6a'); grd.addColorStop(1, '#6fb052'); g.fillStyle = grd; g.fillRect(0, 0, cv.width, cv.height);
    const ch = RACE_INFO[BARRACK_SEL].ch;
    for (let i = 0; i < 5; i++) { const x = 30 + i * 56 + (i % 2) * 14, y = 150 + (i % 2) * 22, bob = Math.round(Math.sin(t * 6 + i) * 2); g.fillStyle = 'rgba(0,0,0,0.2)'; g.beginPath(); g.ellipse(x + 32, y + 62, 20, 5, 0, 0, 7); g.fill(); if (ART.aether) g.drawImage(ART.aether, (ch % 8) * 32, Math.floor(ch / 8) * 32, 32, 32, x, y - bob, 64, 64); }
    barrackRaf = requestAnimationFrame(barrackLoop);
  }
  // ------------------------------------------------------------ 내 가방 · 거래 (메이플식)
  let MY_BAG = {};
  function persIcon(cv, k) { // 개인 물건 그림: 물고기 · 모자 · 도구
    const g = cv.getContext('2d'), W2 = cv.width, H2 = cv.height; g.clearRect(0, 0, W2, H2); g.imageSmoothingEnabled = false;
    if (k.startsWith('hat:')) { const H = HATS[k.slice(4)]; if (H) { const s2 = Math.min(4, Math.floor((W2 - 6) / H.cv.width), Math.floor((H2 - 6) / H.cv.height)); g.drawImage(H.cv, (W2 - H.cv.width * s2) / 2, (H2 - H.cv.height * s2) / 2, H.cv.width * s2, H.cv.height * s2); } return; }
    if (k.startsWith('tool:')) { const T2 = TOOL[k.slice(5)]; if (T2) { const s2 = Math.max(1, Math.floor((H2 - 6) / T2.cv.height)); g.save(); g.translate(W2 / 2, H2 / 2); g.rotate(0.5); g.drawImage(T2.cv, -T2.cv.width * s2 / 2, -T2.cv.height * s2 / 2, T2.cv.width * s2, T2.cv.height * s2); g.restore(); } return; }
    const B = BUILD_BY[k]; if (B && B.fish) drawFish(g, W2 / 2, H2 / 2, B.fish, Math.max(2, Math.floor(W2 / 22)));
  }
  const persName = (k) => k.startsWith('hat:') ? (HATS[k.slice(4)] || {}).name || k : k.startsWith('tool:') ? (MPRules.TOOLS[k.slice(5)] || {}).name || k : (BUILD_BY[k] || {}).name || k;
  function myTradables() { const out = []; for (const [k, v] of Object.entries(MY_BAG)) if (v > 0) out.push({ k, n: v }); for (const k of Object.keys(MY_HATS)) out.push({ k: 'hat:' + k, n: 1 }); for (const k of Object.keys(MY_TOOLS)) out.push({ k: 'tool:' + k, n: 1 }); return out; }
  function openBag() {
    const list = myTradables();
    $('bagCoin').innerHTML = `${MY_JOB ? `<span class="bagJob">${jobIcon(MY_JOB)}${MPRules.JOBS[MY_JOB].name} · ${MPRules.JOBS[MY_JOB].perk}</span>` : '<span class="bagJob">직업 없음 (오프라인 점심 전직)</span>'} 👛 내 코인 <b>${MY_PCOIN.toLocaleString()}</b>`;
    $('bagBody').innerHTML = list.length ? list.map((q) => `<div class="stItem"><canvas data-pk="${q.k}" width="56" height="56"></canvas><span>${esc(persName(q.k))}</span>${q.n > 1 || !q.k.includes(':') ? `<i>${q.n}</i>` : ''}</div>`).join('') : '<p class="stEmpty">가방이 비었어요 · 낚시로 물고기를 잡거나, 상점에서 도구·모자를 사요</p>';
    for (const c of $('bagBody').querySelectorAll('[data-pk]')) persIcon(c, c.dataset.pk);
    $('bagDonate').hidden = !MY_NID; $('bagFrag').textContent = `📜 멸망 조각 ${MY_FRAGS.size}/${FRAG_N}${ONLINE && DAY >= SIDE_DAY && !MY_SIDE ? ' · ⚖ 편 고르기' : ''}`; $('bagFrag').hidden = !DOOM; $('bagBox').hidden = false;
  }
  // 거래
  const TRADE = { tid: null, me: null, offer: null, ready: {}, go: {}, other: null };
  function openTrade(m) {
    Object.assign(TRADE, { tid: m.tid, me: m.me, other: m.other, offer: { a: { coin: 0, items: [] }, b: { coin: 0, items: [] } }, ready: {}, go: {} });
    $('trOtherName').textContent = m.other.name; $('trMeName').textContent = player.name;
    const av = (cv, look) => { const g = cv.getContext('2d'); g.clearRect(0, 0, cv.width, cv.height); g.imageSmoothingEnabled = false; drawSprite(g, cv.width / 2, cv.height - 6, Object.assign({}, look, { me: false }), 0, false, 0); };
    av($('trMeAv'), player.look); av($('trOtherAv'), m.other.look || {});
    $('trCoinIn').value = 0; $('trade').hidden = false; renderTrade(); SND.play('ok');
  }
  function sendOffer() { const o = TRADE.offer[TRADE.me]; ws.send(JSON.stringify({ t: 'tradeSet', tid: TRADE.tid, coin: Math.max(0, Math.min(MY_PCOIN, parseInt($('trCoinIn').value, 10) || 0)), items: o.items })); }
  function renderTrade() {
    if (!TRADE.tid) return; const me = TRADE.me, ot = me === 'a' ? 'b' : 'a';
    const slots = (box, items, mine) => { box.innerHTML = Array.from({ length: MPRules.NUM.tradeSlots }, (_, i) => { const q = items[i]; return `<button type="button" class="trSlot" ${mine && q ? `data-rm="${i}"` : ''}>${q ? `<canvas data-pk="${q.k}" width="44" height="44"></canvas>${q.n > 1 ? `<i>${q.n}</i>` : ''}` : ''}</button>`; }).join(''); for (const c of box.querySelectorAll('[data-pk]')) persIcon(c, c.dataset.pk); };
    slots($('trMeSlots'), TRADE.offer[me].items, true); slots($('trOtherSlots'), TRADE.offer[ot].items, false);
    $('trOtherCoin').textContent = TRADE.offer[ot].coin.toLocaleString();
    $('trMeState').textContent = TRADE.go[me] ? '교환 누름 ✔' : TRADE.ready[me] ? '준비 완료 ✔' : ''; $('trOtherState').textContent = TRADE.go[ot] ? '교환 누름 ✔' : TRADE.ready[ot] ? '준비 완료 ✔' : '고르는 중…';
    $('trReady').textContent = TRADE.ready[me] ? '준비 풀기' : '준비'; $('trGo').disabled = !(TRADE.ready.a && TRADE.ready.b) || TRADE.go[me];
    const locked = !!TRADE.ready[me]; $('trCoinIn').disabled = locked;
    // 내 물건 고르기 (누르면 칸에 하나씩 올라감)
    const used = {}; for (const q of TRADE.offer[me].items) used[q.k] = (used[q.k] || 0) + q.n;
    $('trInv').innerHTML = myTradables().map((q) => { const left = q.n - (used[q.k] || 0); return `<button type="button" class="trPick" data-add="${q.k}" ${left <= 0 || locked ? 'disabled' : ''} title="${esc(persName(q.k))}"><canvas data-pk="${q.k}" width="36" height="36"></canvas><small>${esc(persName(q.k))}${q.n > 1 || !q.k.includes(':') ? ` ${left}` : ''}</small></button>`; }).join('') || '<p class="msg">올릴 물건이 없어요 (물고기·모자·도구)</p>';
    for (const c of $('trInv').querySelectorAll('[data-pk]')) persIcon(c, c.dataset.pk);
    for (const b of $('trInv').querySelectorAll('[data-add]')) b.onclick = () => { const items = TRADE.offer[me].items, k = b.dataset.add, ex = items.find((q) => q.k === k && !k.includes(':')); if (ex) ex.n++; else if (items.length < MPRules.NUM.tradeSlots) items.push({ k, n: 1 }); sendOffer(); };
    for (const b of $('trMeSlots').querySelectorAll('[data-rm]')) b.onclick = () => { if (locked) return; const items = TRADE.offer[me].items, q = items[+b.dataset.rm]; if (q.n > 1) q.n--; else items.splice(+b.dataset.rm, 1); sendOffer(); };
  }
  function tradeNearby() { // 바로 옆 사람에게 거래 신청
    if (!ONLINE || !netOn) return null;
    for (const [id, r] of remotes) if (r.x != null && Math.hypot(r.x - player.x, r.y - player.y) < MPRules.NUM.tradeTiles * TILE) return { kind: 'tradeAsk', id, text: `🤝 ${r.name}에게 거래 신청` };
    return null;
  }
  const FARM_CATS = new Set(['farm', 'water', 'seed', 'fert']);
  const fmtLeft = (ms) => { const m = Math.ceil(ms / 60e3); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60 ? (m % 60) + '분' : ''}` : `${m}분`; };
  function itemIcon(cv, id) { // 상점·설치 카드 그림
    const g = cv.getContext('2d'), W2 = cv.width, H2 = cv.height; g.clearRect(0, 0, W2, H2); g.imageSmoothingEnabled = false;
    const B = BUILD_BY[id]; if (!B) return;
    if (B.fish) { drawFish(g, W2 / 2, H2 / 2, B.fish, 3); return; }
    if (FARM_CATS.has(B.cat) || B.cat === 'crop') { farmIcon(g, id, W2, H2); return; }
    if (B.cat === 'bridge') { g.fillStyle = '#5fb6e6'; g.fillRect(4, H2 / 2 - 16, W2 - 8, 32); for (let k = 0; k < 2; k++) { g.save(); g.translate(W2 / 2 - 28 + k * 28, H2 / 2 - 14); g.scale(28 / 32, 28 / 32); drawBridgeTileIcon(g, k === 0, k === 1, id); g.restore(); } return; }
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
      doors: [{ side: 'W', at: 8, to: 'market' }, { side: 'E', at: 8, to: 'council' }, { side: 'N', at: 24, to: 'plaza' }, { side: 'S', at: 15, to: 'ground' }],
      props: [
        banner(4, 'blue'), banner(10, 'white'), banner(19, 'white'), banner(25, 'blue'),
        P1(4, 4, column), P1(4, 12, column), P1(25, 4, column), P1(25, 12, column), P1(10, 4, column), P1(20, 4, column),
        P1(2, 3, urn), P1(27, 3, urn), P1(2, 15, urn), P1(27, 15, urn),
        P1(12, 12, lantern), P1(18, 12, lantern),
        { x: 11, y: 3, w: 8, h: 1, bigBoard: true, draw: bigBoard },
        { x: 5, y: 11, w: 3, h: 1, board: true, draw: (g, x, y) => { holyAltar(g, x, y, 40, 'book'); plaque(g, x, y - 92, '신탁 제단'); } },
        npcProp('priest', 9, 12),
        P1(11, 15, (g, x, y) => { g.fillStyle = '#d9d0c0'; g.fillRect(x - 18, y - 14, 36, 14); g.fillStyle = '#fffdf8'; g.fillRect(x - 16, y - 18, 32, 6); drawAngel(g, 'Princess', x, y - 16, true); }),
        P1(19, 15, (g, x, y) => { g.fillStyle = '#d9d0c0'; g.fillRect(x - 18, y - 14, 36, 14); g.fillStyle = '#fffdf8'; g.fillRect(x - 16, y - 18, 32, 6); drawAngel(g, 'Knight', x, y - 16, true); }),
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
        { x: 13, y: 4, w: 4, h: 2, npc: 'vaccine', draw: (g, x, y) => pavilion(g, x, y, '#ff9fc4', '치유의 샘 · 백신·도구', NPCS.vaccine.ch) },
        { x: 23, y: 4, w: 4, h: 2, npc: 'seed', draw: (g, x, y) => pavilion(g, x, y, '#8fe0a8', '정원 상점 · 씨앗', NPCS.seed.ch) },
        { x: 13, y: 13, w: 4, h: 2, draw: lightFountain },
        { x: 23, y: 12, w: 4, h: 2, npc: 'smith', draw: (g, x, y) => { pavilion(g, x, y, DAY >= MPRules.NUM.weaponDay ? '#ff8a5a' : '#b8b0c0', DAY >= MPRules.NUM.weaponDay ? '⚔ 무기 상점' : '무기 상점 · 3일차부터', NPCS.smith.ch); if (DAY < MPRules.NUM.weaponDay) sign(g, x, y - 40, '준비 중'); } },
        { x: 3, y: 12, w: 4, h: 2, npc: 'stylist', draw: (g, x, y) => pavilion(g, x, y, '#c9a7ff', '꾸미기 상점 · 모자', NPCS.stylist.ch) },
        P1(8, 13, cloudBench, { w: 2 }), P1(21, 13, cloudBench, { w: 2 }),
        P1(27, 12, urn), P1(2, 16, urn), P1(27, 16, urn),
        P1(9, 8, lantern), P1(20, 8, lantern), P1(9, 15, lantern), P1(20, 15, lantern),
      ],
    },
    council: {
      name: '회담장', desc: '나라끼리 조약을 맺는 곳 · 전쟁의 천사 · 유랑민 등록 창구', w: 26, h: 16, pos: [2, 1], crowd: 7,
      floor: 'marble_w', wall: true, carpets: [[8, 4, 10, 8], [0, 7, 8, 3]], trim: '#5b7fd6',
      emotes: ['불가침 조약 ㄱ?', '동맹 맺자', '조건이 뭔데', '배신하면 알지?', '왕끼리 얘기하자', '규칙서 읽어 봤어?'],
      doors: [{ side: 'W', at: 8, to: 'temple' }, { side: 'E', at: 4, to: 'secret1' }, { side: 'E', at: 12, to: 'secret2' }, { side: 'S', at: 13, to: 'jail' }],
      props: [
        banner(5, 'red'), banner(13, 'white'), banner(20, 'red'),
        { x: 11, y: 6, w: 4, h: 2, draw: (g, x, y) => { holyAltar(g, x - 22, y, 34, 'book'); holyAltar(g, x + 40, y, 22, 'cup'); plaque(g, x, y - 96, '조약 제단'); } },
        npcProp('war', 17, 7),
        { x: 5, y: 3, w: 4, h: 1, board: true, desk: 'wander', draw: (g, x, y) => { holyAltar(g, x, y, 36, 'book'); plaque(g, x, y - 92, '유랑민 등록 창구'); } },
        npcProp('clerk', 3, 3),
        P1(9, 5, lantern), P1(16, 5, lantern), P1(9, 11, lantern), P1(16, 11, lantern),
        P1(3, 12, column), P1(22, 12, column), P1(22, 3, urn),
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
        { x: 8, y: 7, w: 1, h: 1, walk: true, draw: (g, x, y) => drawAnimal(g, 'chick', x, y + 2, 101) }, { x: 44, y: 8, w: 1, h: 1, walk: true, draw: (g, x, y) => drawAnimal(g, 'rabbit', x, y + 2, 102) },
        { x: 10, y: 26, w: 1, h: 1, walk: true, draw: (g, x, y) => drawAnimal(g, 'hen', x, y + 2, 103) }, { x: 46, y: 27, w: 2, h: 1, walk: true, draw: (g, x, y) => drawAnimal(g, 'pig', x, y + 2, 104) },
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
        { x: 21, y: 15, w: 2, h: 1, walk: true, draw: (g, x, y) => drawAnimal(g, 'cow', x, y + 2, 105) }, { x: 10, y: 15, w: 1, h: 1, walk: true, draw: (g, x, y) => drawAnimal(g, 'rabbit', x, y + 2, 106) },
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
      if ((key === 'marble_w' || key === 'cloud') && ART.x_sky_floor) key = 'sky_floor'; // 하늘 바닥: 받은 돌 타일을 하얗게
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
    player.scene = 'ground'; player.room = null; fadeT = 0.35; lastTerr = null; netTp = true; step.on = false; setTimeout(maybeDoomPopup, 600); // 하늘에 있는 동안 못 본 오늘의 멸망 알림
    const tp = portalOf(t) || MPRules.portalSpot(t, tileAt);
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
  // 아이작식 문: 벽에 박힌 돌 아치 + 어두운 문 구멍 (땅으로 가는 문은 안쪽이 금빛) — 위쪽 벽 기준으로 그린 뒤 벽 방향대로 돌림
  const DOORC = {};
  function isaacDoor(down) { const key = down ? 'd' : 'n'; if (DOORC[key]) return DOORC[key];
    return (DOORC[key] = artCanvas(96, 76, (g) => { const R = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
      R('rgba(40,50,80,0.25)', 6, 70, 84, 6); // 바닥에 드리운 그림자
      g.fillStyle = '#5d6684'; pxDisc(g, 48, 34, 34); R('#5d6684', 14, 34, 68, 40); // 바깥 테두리
      g.fillStyle = '#c9d1e4'; pxDisc(g, 48, 34, 32); R('#c9d1e4', 16, 34, 64, 40); // 돌 아치
      g.fillStyle = '#eef1f8'; pxDisc(g, 48, 32, 30); R('#eef1f8', 18, 32, 60, 38);
      for (const [bx, by, bw, bh] of [[18, 40, 12, 10], [18, 54, 12, 14], [66, 40, 12, 10], [66, 54, 12, 14], [26, 14, 12, 10], [58, 14, 12, 10], [40, 6, 16, 10]]) { R('#c9d1e4', bx, by + bh - 2, bw, 2); R('#c9d1e4', bx + bw - 2, by, 2, bh); } // 돌 이음매
      R('#ffd34d', 44, 4, 8, 6); R('#fff2b0', 46, 4, 4, 2); // 꼭대기 쐐기돌 (금)
      g.fillStyle = '#3b3550'; pxDisc(g, 48, 40, 18); R('#3b3550', 30, 40, 36, 36); // 문 구멍 테두리
      if (down) { g.fillStyle = '#ffe9a0'; pxDisc(g, 48, 40, 16); R('#ffe9a0', 32, 40, 32, 36); g.fillStyle = '#fff8dc'; pxDisc(g, 48, 44, 10); R('#fff8dc', 38, 44, 20, 32); }
      else { g.fillStyle = '#120c1c'; pxDisc(g, 48, 40, 16); R('#120c1c', 32, 40, 32, 36); R('#2a2140', 32, 66, 32, 10); }
      R('#9aa3bd', 24, 70, 10, 6); R('#9aa3bd', 62, 70, 10, 6); // 문턱 받침돌
    })); }
  function arch(g, x, y, side, label, down) {
    const im = ART[down ? 'x_door_isaac_down' : 'x_door_isaac'] || isaacDoor(down), pv = g.imageSmoothingEnabled, dw = im.width === 48 ? 96 : im.width, dh = im.width === 48 ? 80 : im.height; g.imageSmoothingEnabled = false; g.save();
    if (side === 'N') { g.translate(x, y + TILE); }
    else if (side === 'S') { g.translate(x, y - TILE); g.rotate(Math.PI); }
    else if (side === 'W') { g.translate(x + TILE, y - 16); g.rotate(-Math.PI / 2); }
    else { g.translate(x - TILE, y - 16); g.rotate(Math.PI / 2); }
    g.drawImage(im, -dw / 2, -dh + 6, dw, dh); g.restore(); g.imageSmoothingEnabled = pv;
    if (side === 'W' || side === 'E') sign(g, x + (side === 'W' ? 90 : -90), y - 2 * TILE - 20, (side === 'W' ? '← ' : '') + label + (side === 'E' ? ' →' : ''));
    else sign(g, x, side === 'N' ? y - TILE - 26 : y - 2 * TILE - 30, (side === 'N' ? '↑ ' : '↓ ') + label);
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
  function renderInv() { if ($('invP')) $('invP').textContent = MY_PCOIN.toLocaleString(); if ($('bagBox') && !$('bagBox').hidden) openBag(); $('invCoin').textContent = (myView ? myView.me.coin : inv.coin).toLocaleString(); $('invArmy').textContent = (myView ? myView.me.army : inv.army).toLocaleString(); $('invVac').textContent = myView ? myView.me.vaccine : inv.vaccine; $('invWood').textContent = myView ? myView.me.wood : 0; if (build.on) setBuild(true); }
  const player = {
    x: 0, y: 0, dir: 1, moving: false, scene: 'ground', room: null, entry: null,
    name: saved.name || '나', tag: '#277a58', team: store('mp2026.team') || 3,
    face: 0,
    look: { char: saved.char | 0, hue: saved.hue | 0, hair: saved.hair || '#8a5a3c', outfit: saved.outfit || '#3fa37a', skin: '#ffe1cc', accent: '#ff5d7a', long: saved.long !== false, me: true, seed: 0, sk: saved.sk | 0, hat: saved.hat || '' },
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
    if (k === 'i' && !TITLE.on) { if ($('bagBox').hidden) openBag(); else $('bagBox').hidden = true; }
    if (k === 'b') toggleWar();
    if (k === 't') { if (player.carry) toast('훔친 걸 들고 있으면 순간이동할 수 없어요'); else goHome(); }
    if ((k === 'e' || k === ' ') && !$('talk').hidden) { e.preventDefault(); if (!e.repeat) talkNext(); return; }
    if ((k === 'e' || k === ' ') && FISHING.on) { e.preventDefault(); if (!e.repeat) fishPress(); return; } // 낚시 중: E(스페이스)로 당기기
    if (k === 'e' && !e.repeat && !document.querySelector('.modalbox:not([hidden]), #closet:not([hidden])')) pressE(); // 창이 열려 있으면 E 무시 (상점 연 뒤 대화창이 또 뜨던 버그)
    if (MQ.on && k >= '1' && k <= '4') { if (!e.repeat) answerQuiz(+k - 1); return; }
    if (k === 'j' && !e.repeat) atkDown();
    if (k === 'q' && !e.repeat && player.scene === 'ground' && !document.querySelector('.modalbox:not([hidden])')) swapWeapon();
    if (k === 'g' && ONLINE) setBuild(!build.on);
    if (k >= '1' && k <= '8') emote(+k - 1);
    if (k === 'enter' && ONLINE) { e.preventDefault(); $('chatIn').focus(); }
    if ((k === '[' || k === ']') && !ONLINE) { location.hash = 'day' + Math.max(1, Math.min(15, DAY + (k === ']' ? 1 : -1))); }
    if (k === 'escape') { if (BP.open) { BP.closed = true; BP.open = false; $('boardPanel').hidden = true; } $('fragBook').hidden = true; $('pmenu').hidden = true; $('barracks').hidden = true; $('bagBox').hidden = true; closeTalk(); $('rulebook').hidden = true; $('bigmap').hidden = true; $('closet').hidden = true; $('coupon').hidden = true; $('wanderBox').hidden = true; $('war').hidden = true; $('puzzle').hidden = true; $('reinBox').hidden = true; $('bailBox').hidden = true; $('warCast').hidden = true; $('storeBox').hidden = true; $('shopBox').hidden = true; if (build.on) setBuild(false); }
  });
  addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'e') releaseE(); if (k === 'j') atkUp(); });
  $('atkBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); atkDown(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) $('atkBtn').addEventListener(ev, atkUp);
  $('swapBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); swapWeapon(); });
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
    if (WEATHER === 'rain') chip('🌧 비 · 낚시 보너스', '#3d6fb8');
    if (o > 0) {
      const t = terrs[o];
      $('whereName').textContent = t.name;
      $('whereSub').textContent = `영토 #${t.id} · ${t.type} 지방 · ${RING[t.ring]} · 넓이 ${t.area.toLocaleString()}칸`;
      chip(`${t.type} 문제`, TYPE_TAG[t.type]);
      const own = ownerOf(t.id);
      if (own && myView && (myView.allies || []).some((a) => a.id === own)) chip('🤝 동맹', '#277a58');
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
        const tp = portalOf(t);
        if (tp && Math.hypot(tp[0] + 0.5 - tx, tp[1] + 0.5 - ty) < 1.8) best = { kind: 'portal', t, text: '하늘로 올라가기' };
        else if (n && !build.on) best = mined.has(n.id) ? { kind: 'info', text: '오늘은 다 캤어요 (내일 다시)' } : ONLINE && !MY_TOOLS.pick ? { kind: 'info', text: '⛏ 금광 · ' + TOOL_HINT('pick') } : ONLINE ? { kind: 'mine', n, terr: n.id, nx: n.x, ny: n.y, text: '⛏ 금광 캐기 · E (수학 문제를 맞히면 캐져요)' } : { kind: 'node', n, text: '금광 캐기 · 코인' };
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
    { const fr = fragNearby(); if (fr) best = fr; } // 멸망 조각이 제일 먼저
    if (!best || best.kind === 'info') { const kn = kingNearby(); if (kn) best = kn; } // 다른 나라 왕 옆: 동맹 계약 (거래는 사람을 클릭해서)
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
      return { kind: 'dropB', x: fx, y: fy, text: `여기에 ${build.moving.kind === 'store' ? '저장소' : build.moving.kind === 'portal' ? '하늘 포털' : '금광'} 놓기 (E) · 취소는 G` };
    }
    if (build.on && myView) { // 우리 저장소·우리 땅 금광 옆이면 옮기기
      for (const [i, nid] of STORE_AT) if (nid === MY_NID && Math.hypot((i % W) + 0.5 - ptx, Math.floor(i / W) + 0.5 - pty) < 1.9) return { kind: 'pickB', what: { kind: 'store' }, text: '저장소 옮기기 (E) → 옮길 자리에서 E' };
      for (const q of nodes) if (ownerOf(q.id) === MY_NID && Math.hypot(q.tx + 0.5 - ptx, q.ty + 0.5 - pty) < 1.6) return { kind: 'pickB', what: { kind: 'mine', terr: q.id }, text: '금광 옮기기 (E) → 옮길 자리에서 E' };
      { const hp = homePortal(); if (hp && Math.hypot(hp[0] + 0.5 - ptx, hp[1] + 0.5 - pty) < 1.6) return myView.me.isKing ? { kind: 'pickB', what: { kind: 'portal' }, text: '하늘 포털 옮기기 (왕) (E) → 수도 안 옮길 자리에서 E' } : { kind: 'info', text: '하늘 포털은 왕만 옮길 수 있어요' }; }
    }
    if (build.on && myView) {
      const B = BUILD_BY[build.id] || BUILD_BY.f_stone, tiles = shapeTiles(), shape = B.cat === 'trap' || B.cat === 'deco' || B.cat === 'fert' ? '1' : build.shape;
      if (B.cat === 'seed' || B.cat === 'fert' || B.cat === 'farm') { // 농사: 내 발밑 기준
        const [mx, my] = shape === '1' ? [Math.floor(player.x / TILE), Math.floor(player.y / TILE)] : [fx, fy], f = TILES[my * W + mx], have = myView.me.items[B.id] || 0, where = shape === '1' ? '발밑에' : '앞에';
        if (ownerOf(terrAt(mx, my)) !== MY_NID) return { kind: 'info', text: '농사는 우리 땅에서만 해요' };
        if (B.cat !== 'farm' && !MY_TOOLS.shovel) return { kind: 'info', text: TOOL_HINT('shovel') };
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
      if (B.cat === 'bridge') { const have = myView.me.items[B.id] || 0, f2 = TILES[fy * W + fx]; if (!(tileAt(fx, fy) === T.WATER && !f2) && !(f2 && f2.k === 'water' && f2.n === MY_NID)) return { kind: 'info', text: '다리는 물(강·호수·우리 수로) 위에 놓아요 · 물을 바라보고 E' }; if (!have) return { kind: 'info', text: `${B.name}가 없어요 · 하늘 건축 상점에서 사요` }; return { kind: 'place', tiles, text: `${B.name} ${SHAPE_NAME[shape]} 놓기 · 남은 ${have}개 (우리 땅·다리에 이어서)` }; }
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
      if (cropStage(f.crop) === 3) return MY_TOOLS.shovel ? { kind: 'harvest', tiles: [[hx, hy]], text: `${CROPS[f.crop.c].name} 수확하기 (E)` } : { kind: 'info', text: `${CROPS[f.crop.c].name} 다 자람 · ${TOOL_HINT('shovel')}` };
      if (hx === Math.floor(ptx) && hy === Math.floor(pty)) return { kind: 'info', text: `${CROPS[f.crop.c].name} 자라는 중 · ${fmtLeft(f.crop.d - (Date.now() - f.crop.at))} 남음${f.crop.w ? ' · 💧수로' : ''}${f.crop.f ? ' · 🌿비료' : ''}` };
    }
    { const fe = TILES[fy * W + fx], wet = (tileAt(fx, fy) === T.WATER && !(fe && fe.k === 'bridge')) || (fe && fe.k === 'water') || (GFLOOR.size && isWater(GFLOOR.get(fy * W + fx))); if (wet && MY_NID && !build.on) return !MY_TOOLS.rod ? { kind: 'info', text: '🎣 물 · ' + TOOL_HINT('rod') } : { kind: 'fish', x: fx, y: fy, text: `낚시하기 (E)${WEATHER === 'rain' ? ' · 🌧 비 보너스' : ''}` }; } // 물을 바라보면 낚시
    if (treeAt(fx, fy) && MY_NID && ownerOf(terrAt(fx, fy)) === MY_NID) return ONLINE && !MY_TOOLS.axe ? { kind: 'info', text: '🌲 나무 · ' + TOOL_HINT('axe') } : { kind: 'chop', x: fx, y: fy, hold: MPRules.NUM.chopSec * 1000, text: '🪓 나무 베기 · E 꾹 누르기' };
    if (tileAt(fx, fy) === T.MOUNTAIN && MY_NID && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ownerOf(terrAt(fx + dx, fy + dy)) === MY_NID) && ONLINE && !build.on) return !MY_TOOLS.pick ? { kind: 'info', text: '⛰ 산 · ' + TOOL_HINT('pick') } : { kind: 'dig', x: fx, y: fy, hold: MPRules.NUM.chopSec * 1000, text: '⛏ 산 캐기 · E 꾹 누르기 (길이 열려요)' };
    if (e && e.k === 'wall' && e.n === MY_NID && MY_JOB === 'mechanic' && (e.hp ?? (e.max || MPRules.NUM.buildHp)) < (e.max || MPRules.NUM.buildHp)) return { kind: 'repairB', x: fx, y: fy, text: `🔧 ${(BUILD_BY[tileItem(e)] || {}).name || '벽'} 고치기 · E (꾹 = 계속) · 내구도 ${e.hp}/${e.max || MPRules.NUM.buildHp}` };
    if (e && e.k === 'wall' && e.n !== MY_NID) return { kind: 'hitB', x: fx, y: fy, text: `${natName(e.n)} ${(BUILD_BY[tileItem(e)] || {}).name || '벽'} 때리기 · E (꾹 = 계속) · 내구도 ${e.hp ?? MPRules.NUM.buildHp}/${MPRules.NUM.buildHp}` };
    return null;
  }
  // 꾹 누르기 (나무 베기 2초, 방벽 부수기 5초)
  const hold = { on: false, t0: 0, ms: 0, kind: '', x: 0, y: 0 };
  let stunUntil = 0, jailUntil = 0;
  let hitTimer = 0, hitOn = false;
  let farmFlash = 0;
  function curAct() { return performance.now() < farmFlash ? 'farm' : FISHING.on ? 'fish' : hitOn ? 'hit' : hold.on ? ({ chop: 'chop', mine: 'mine', dig: 'dig' }[hold.kind] || null) : null; }
  function pressE() { if (near && near.kind === 'mine') { startMine(near); return; } if (near && (near.kind === 'hitB' || near.kind === 'repairB')) { const n = near, go = () => { if (netOn) ws.send(JSON.stringify({ t: n.kind, x: n.x, y: n.y })); player.atkT = 0.2; }; go(); clearInterval(hitTimer); hitTimer = setInterval(go, 420); hitOn = true; return; } if (near && near.hold) startHold(near); else interact(); }
  function releaseE() { clearInterval(hitTimer); hitOn = false; if (hold.on && hold.kind !== 'mine') cancelHold(); }
  function startHold(n) {
    Object.assign(hold, { on: true, t0: performance.now(), ms: n.hold, kind: n.kind, x: n.x, y: n.y });
    hold.nid = n.nid; hold.terr = n.terr; hold.nx = n.nx; hold.ny = n.ny;
    if (n.kind === 'mine') ws.send(JSON.stringify({ t: 'mineStart', terr: n.terr }));
    if (n.kind === 'break') ws.send(JSON.stringify({ t: 'breakStart', x: n.x, y: n.y }));
    if (n.kind === 'steal') ws.send(JSON.stringify({ t: 'stealStart', nid: n.nid }));
  }
  function cancelHold() { hold.on = false; }
  function tickHold() {
    if (!hold.on || performance.now() - hold.t0 < hold.ms) return;
    hold.on = false;
    if (netOn) ws.send(JSON.stringify(hold.kind === 'mine' ? { t: 'mine', terr: hold.terr } : hold.kind === 'steal' ? { t: 'steal', nid: hold.nid } : { t: hold.kind === 'chop' ? 'chop' : hold.kind === 'dig' ? 'dig' : 'breakWall', x: hold.x, y: hold.y }));
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
  const BB_TABS = [['all', '전체'], ['floor', '바닥'], ['wall', '벽·기둥'], ['deco', '장식'], ['trap', '덫'], ['bridge', '🌉 다리'], ['farm', '🌱 농사']];
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
    const TABS = [['all', '전체'], ['build', '🏗 건축'], ['farm', '🌱 농사'], ['crop', '🧺 작물·물고기']];
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
  contractPad();
  $('btnBag').addEventListener('click', () => openBag()); $('bagClose').addEventListener('click', () => { $('bagBox').hidden = true; });
  $('bagGive').addEventListener('click', () => { const n = parseInt($('bagGiveN').value, 10) || 0; if (n > 0 && confirm(`내 코인 ${n}을(를) 나라에 기부할까요? (돌려받을 수 없어요)`)) ws.send(JSON.stringify({ t: 'donate', n })); });
  $('trqYes').addEventListener('click', () => { ws.send(JSON.stringify({ t: 'tradeAnswer', from: +$('tradeReq').dataset.from, yes: true })); $('tradeReq').hidden = true; });
  $('trqNo').addEventListener('click', () => { ws.send(JSON.stringify({ t: 'tradeAnswer', from: +$('tradeReq').dataset.from, yes: false })); $('tradeReq').hidden = true; });
  $('trReady').addEventListener('click', () => { if (TRADE.tid) { sendOffer(); setTimeout(() => ws.send(JSON.stringify({ t: 'tradeReady', tid: TRADE.tid })), 80); } });
  $('trGo').addEventListener('click', () => { if (TRADE.tid) ws.send(JSON.stringify({ t: 'tradeGo', tid: TRADE.tid })); });
  $('trExit').addEventListener('click', () => { if (TRADE.tid) ws.send(JSON.stringify({ t: 'tradeCancel', tid: TRADE.tid })); $('trade').hidden = true; TRADE.tid = null; });
  $('trCoinIn').addEventListener('change', () => { if (TRADE.tid) sendOffer(); });
  $('bkClose').addEventListener('click', () => { $('barracks').hidden = true; });
  $('bkPick').addEventListener('click', () => { warAction('setRace', { race: BARRACK_SEL }); setTimeout(() => { if (!$('barracks').hidden) renderBarracks(); }, 600); });
  renderRulebook();
  function interact() {
    if (!near) return;
    if (near.kind === 'store') { openStore(); return; }
    if (near.kind === 'shop') { openShop(); return; }
    if (near.kind === 'npc') { openTalk(near.npc); return; }
    if (near.kind === 'fish') { startFishing(near.x, near.y); return; }
    if (near.kind === 'frag') { ws.send(JSON.stringify({ t: 'frag', i: near.i })); return; }
    if (near.kind === 'tradeAsk') { ws.send(JSON.stringify({ t: 'tradeAsk', id: near.id })); return; }
    if (near.kind === 'allyMeet') { ws.send(JSON.stringify({ t: 'allyMeet', id: near.id })); toast('동맹 계약서를 펼쳤어요 · 두 왕 모두 서명해 주세요'); return; }
    if (near.kind === 'bail') { if (netOn) ws.send(JSON.stringify({ t: 'bailList' })); return; }
    if (near.kind === 'hit') { HITFX.set(near.t.id, performance.now() + 120); if (netOn) ws.send(JSON.stringify({ t: 'hit', terr: near.t.id })); return; }
    if (near.kind === 'pickB') { build.moving = near.what; near = null; toast('옮길 자리 바로 앞에서 E를 누르세요 (우리 땅, 다른 건물과 2칸 이상)'); return; }
    if (near.kind === 'dropB') { if (netOn) ws.send(JSON.stringify(Object.assign({ t: 'moveB', x: near.x, y: near.y }, build.moving))); build.moving = null; near = null; return; }
    if (near.kind === 'place' || near.kind === 'pickup') { if (netOn) ws.send(JSON.stringify({ t: near.kind, tiles: near.tiles, id: build.id })); return; }
    if (near.kind === 'plant' || near.kind === 'fert' || near.kind === 'harvest') { farmFlash = performance.now() + 700; if (netOn) ws.send(JSON.stringify({ t: near.kind, tiles: near.tiles, id: build.id })); SND.play(near.kind === 'harvest' ? 'coin' : 'place'); return; }
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

  function portalOf(t) { // 하늘 포털 자리: 나라 수도면 왕이 옮긴 자리(없으면 기본), 주인 없는 수도 후보면 기본 자리
    if (!t) return null; const nid = ownerOf(t.id), n = nid && nationsPub[nid];
    if (n && n.capital === t.id) return n.portal || MPRules.portalSpot(t, tileAt);
    return !nid && t.capitalCandidate ? t.portal : null;
  }
  const homePortal = () => portalOf(home) || MPRules.portalSpot(home, tileAt);
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
    const base = { [T.VOID]: [31, 98, 192], [T.WATER]: [3, 196, 180], [T.SAND]: [252, 206, 102], [T.MOUNTAIN]: [138, 129, 151], [T.HOLY]: [250, 238, 200] };
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
    mg.fillStyle = '#1f62c0'; mg.fillRect(0, 0, s, s); // 지도 밖도 바다
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
    for (const t of terrs) { const q = t && !gone[t.id] && portalOf(t); if (q) { bg.fillStyle = '#ffec8c'; bg.beginPath(); bg.arc(q[0] * k, q[1] * k, 3, 0, Math.PI * 2); bg.fill(); } }
    for (const f of FRAGS) if (!MY_FRAGS.has(f.i)) { const X = f.x / TILE * k, Y = f.y / TILE * k, pu = 5 + Math.sin(performance.now() / 200) * 1.5; bg.fillStyle = '#2b2340'; bg.beginPath(); bg.moveTo(X, Y - pu - 2); bg.lineTo(X + pu + 2, Y); bg.lineTo(X, Y + pu + 2); bg.lineTo(X - pu - 2, Y); bg.fill(); bg.fillStyle = '#b48aff'; bg.beginPath(); bg.moveTo(X, Y - pu); bg.lineTo(X + pu, Y); bg.lineTo(X, Y + pu); bg.lineTo(X - pu, Y); bg.fill(); } // 멸망 조각
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
    const own = (k) => !k || !ONLINE || MY_HATS[k];
    $('hatSw').innerHTML = [['', '없음'], ...Object.entries(HATS).map(([k, h]) => [k, h.name])].map(([k, nm]) => `<button type="button" class="hatbtn${own(k) ? '' : ' lock'}" data-hat="${k}" aria-pressed="${(player.look.hat || '') === k}" title="${nm}"><canvas width="40" height="34"></canvas><small>${own(k) ? nm : '🔒 ' + MPRules.HAT_PRICE[k]}</small></button>`).join('');
    for (const b of $('hatSw').querySelectorAll('[data-hat]')) { const H = HATS[b.dataset.hat], g = b.querySelector('canvas').getContext('2d'); g.imageSmoothingEnabled = false; if (H) { const k = Math.min(3, Math.floor(38 / H.cv.width), Math.floor(30 / H.cv.height)); g.drawImage(H.cv, (40 - H.cv.width * k) / 2, (34 - H.cv.height * k) / 2, H.cv.width * k, H.cv.height * k); } else { g.strokeStyle = '#c9b79a'; g.lineWidth = 3; g.beginPath(); g.arc(20, 17, 10, 0, 7); g.moveTo(13, 10); g.lineTo(27, 24); g.stroke(); } b.onclick = () => { if (!own(b.dataset.hat)) { toast(`${HATS[b.dataset.hat].name}은(는) 하늘 천상 상점가 '꾸미기 상점'에서 내 코인으로 사요`); return; } player.look.hat = b.dataset.hat; closetUI(); saveLook(); }; }
    $('skinSw').innerHTML = SKINS_PAL.map((c, i) => `<button type="button" class="sw" data-sk="${i}" title="${SKIN_NAME[i]}" aria-pressed="${(player.look.sk | 0) === i}" style="background:${c || 'conic-gradient(#ffe2c8, #e9a879, #7a4a2c, #ffe2c8)'}"></button>`).join('');
    for (const b of $('skinSw').querySelectorAll('[data-sk]')) b.onclick = () => { player.look.sk = +b.dataset.sk; closetUI(); saveLook(); };
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
    else { const sheet = charSheet(c, player.look.hue | 0, player.look.sk | 0), ph = Math.floor(t / 1.2) % 5, dir = [0, 3, 1, 2, 3][ph], row = ph === 4 ? 4 : Math.floor(t * 8) % 4; g.drawImage(sheet, dir * 16, row * 16, 16, 16, 16, 8, 96, 96); }
    if (c >= 0 && player.look.hat) { const ph = Math.floor(t / 1.2) % 5, dir = [0, 3, 1, 2, 3][ph]; drawHat(g, 64, 8 + 6 * 3, player.look.hat, 6, dir === 2); }
    requestAnimationFrame(closetPreview);
  }
  function saveLook() {
    store('mp2026.look', { name: player.name, char: player.look.char | 0, hue: player.look.hue | 0, hair: player.look.hair, outfit: player.look.outfit, long: player.look.long, sk: player.look.sk | 0, hat: player.look.hat || '' });
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
  $('btnClosetDone').addEventListener('click', () => { $('closet').hidden = true; if (OP.closetWait) { OP.closetWait = false; OP.closetDone = true; $('closet').style.zIndex = ''; $('btnClosetDone').textContent = '✕'; $('btnClosetDone').classList.remove('wide'); saveLook(); opAdvance(); } });

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

  function lookPayload() { const l = player.look; return { char: l.char | 0, hue: l.hue | 0, hair: l.hair, outfit: l.outfit, skin: l.skin, accent: l.accent, long: l.long, sk: l.sk | 0, hat: l.hat || '' }; }
  function setNet(text) { $('netText').textContent = text; }
  function connect() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: store('mp2026.token'), lv: store('mp2026.lv') | 0, name: player.name, team: 0, look: lookPayload() }));
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (ev) => { try { if (typeof ev.data === 'string') onNet(JSON.parse(ev.data)); else onPositions(new DataView(ev.data)); } catch (e) { /* 무시 */ } };
    ws.onclose = (ev) => { netOn = false; remotes.clear(); if (ev && ev.code === 4002) { setNet('학교 계정으로 로그인해 주세요'); return; } setNet('연결이 끊겼어요 · 다시 연결하는 중…'); setTimeout(connect, 2000); };
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
        player.carry = m.carry || null; player.look.red = m.red | 0; jailUntil = m.jailUntil || 0; MY_TOOLS = m.tools || {}; MY_JOB = m.job || null; PV.hp = m.hp ?? HPMAX; player.hp = PV.hp; loadPfxW(); // 전투 이펙트 미리 불러 둠 (첫 공격부터 보이게) MY_FRAGS = new Set(m.myFrags || []); MY_SIDE = m.side || null; FRAGS = m.frags || []; LOOTS.clear(); for (const L of m.loot || []) LOOTS.set(L.id, L); MY_PCOIN = m.pcoin | 0; MY_HATS = m.hats || {}; MY_BAG = m.bag || {}; if (player.look.hat && !MY_HATS[player.look.hat]) player.look.hat = ''; renderInv();
        if (m.roomEdits) for (const [id, e] of Object.entries(m.roomEdits)) applyRoomEdit(id, e);
        if (m.groundEdits) { GFLOOR.clear(); GWALL.clear(); GCLEAR.clear(); GPROPS.clear(); applyGroundEdit({ set: m.groundEdits.floor, walls: m.groundEdits.walls, clear: m.groundEdits.clear, props: m.groundEdits.props }); invalidateChunks(); mapSig = ''; }
        if (m.clock) setClock(m.clock); BATTLES = m.battles || []; applyMines(m.mines || {}); TILES = m.tiles || {}; MY_TRAPS = new Set(m.traps || []); for (const i of m.chopped || []) noTree[i] = 1; for (const i of m.dug || []) GCLEAR.add(i); MY_WEAPONS = m.weapons || {}; MY_WEAPON = m.weapon || null; if ((m.dug || []).length) invalidateChunks(); if (m.stun) stunUntil = performance.now() + m.stun;
        testMode = !!m.testMode; foundingOpen = m.foundingOpen !== false; applyWorld(m.owners, m.nations, m.view || null); showNotice(m.notice); unseenBattles();
        needFound = !m.view; if (!m.view) { if (titleDone) openFound('who'); } else $('found').hidden = true;
        chatLog = m.chat || []; renderChat();
        wanderList = m.wander || []; BOARD = m.board || [];
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
        if (q.id === myId) { player.teacher = !!q.teacher; player.carry = q.carry ? (player.carry || {}) : null; player.look.red = q.red | 0; player.badge = q.badge || ''; break; }
        let r = remotes.get(q.id);
        if (!r) { r = { x: null, y: null, tx: null, ty: null, dir: 1, moving: false, emote: null, emoteT: 0 }; remotes.set(q.id, r); }
        r.name = q.name; r.team = q.team; r.tag = teamColor(q.team);
        r.look = Object.assign({ seed: (q.id * 0.37) % 3 }, q.look, { red: q.red | 0 });
        r.nid = q.nid; r.carry = q.carry; r.jailed = q.jailed; r.badge = q.badge || ''; r.king = !!q.king; r.job = q.job || null; r.weapon = q.weapon || null; r.side = q.side || null; r.teacher = !!q.teacher;
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
      case 'err': if (FISHING.on && FISHING.biteAt === Infinity) stopFishing(); if (!$('puzzle').hidden) puzzleResult(false, m.text); toast(m.text); if (!$('war').hidden) renderWar(); break;
      case 'ok': toast(m.text); break;
      case 'name': {
        if (m.ok) { player.name = m.name; nameSet = true; renamesLeft = m.left; tagW.clear(); store('mp2026.look', Object.assign(store('mp2026.look') || {}, { name: m.name })); $('fMsg').textContent = ''; renderNameBox(); if (nameNext) { const f = nameNext; nameNext = null; f(); } else toast(`이름을 '${m.name}'(으)로 바꿨어요 · 남은 변경 ${m.left}번`); }
        else { nameNext = null; if (!$('found').hidden) $('fMsg').textContent = m.text; else { $('nickMsg').textContent = m.text; toast(m.text); } }
        break;
      }
      case 'redeem': $('couponMsg').textContent = m.text; if (m.ok) $('couponIn').value = ''; break;
      case 'tile': { const prev = TILES[m.i]; if (m.e && prev && m.e.hp != null && m.e.hp !== (prev.hp ?? (prev.max || MPRules.NUM.buildHp))) { HPSEEN.set(m.i, performance.now()); SND.play(m.e.hp < (prev.hp ?? 1e9) ? 'hit' : 'place'); } else if (m.e && m.e.n === MY_NID && !prev) SND.play('place'); const wasW = prev && (prev.k === 'water' || prev.k === 'bridge'), isW = m.e && (m.e.k === 'water' || m.e.k === 'bridge'); if (m.e) TILES[m.i] = m.e; else delete TILES[m.i]; dirtyTile(m.i); if (wasW || isW) { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx || dy) dirtyTile(m.i + dy * W + dx); if ((m.e || prev).k === 'bridge') for (let k = 3; k <= 16; k++) { dirtyTile(m.i + k); dirtyTile(m.i - k); dirtyTile(m.i + k * W); dirtyTile(m.i - k * W); } } break; } // 수로가 바뀌면 이웃 밭·수로 다시 그림
      case 'trap': if (m.on) MY_TRAPS.add(m.i); else MY_TRAPS.delete(m.i); break;
      case 'chopped': noTree[m.i] = 1; dirtyTile(m.i); SND.play('chop'); break;
      case 'dug': GCLEAR.add(m.i); invalidateChunks(); mapSig = ''; SND.play('chop'); break;
      case 'weapons': MY_WEAPONS = m.weapons || {}; MY_WEAPON = m.weapon || null; swapIcon.w = null; if (m.pcoin != null) { MY_PCOIN = m.pcoin; renderInv(); } if (m.text) toast(m.text); SND.play('coin'); if (!$('shopBox').hidden) renderShop(); break;
      case 'hitfx': HITFX.set(m.terr, performance.now() + 120); break;
      case 'clock': setClock(m); if (m.frags) setFrags(m.frags); break;
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
      case 'pcoin': MY_PCOIN = m.v | 0; renderInv(); toast(`👛 내 코인 +${m.add} (${m.why})`); break;
      case 'hats': MY_HATS = m.hats || {}; MY_PCOIN = m.pcoin | 0; renderInv(); player.look.hat = m.id; saveLook(); toast(`🎩 ${HATS[m.id].name}을(를) 샀어요! 바로 썼어요 (꾸미기에서 바꿀 수 있어요)`); SND.play('coin'); if (!$('shopBox').hidden) renderShop(); break;
      case 'bag': MY_BAG = m.bag || {}; if (!$('bagBox').hidden) openBag(); if (!$('shopBox').hidden) renderShop(); break;
      case 'tradeReq': $('trqText').textContent = `${m.name}님이 거래를 신청했어요`; $('tradeReq').hidden = false; $('tradeReq').dataset.from = m.from; SND.play('ok'); clearTimeout(window.__trq); window.__trq = setTimeout(() => { $('tradeReq').hidden = true; }, 25000); break;
      case 'tradeOpen': $('tradeReq').hidden = true; openTrade(m); break;
      case 'tradeState': if (m.tid === TRADE.tid) { TRADE.offer = m.offer; TRADE.ready = m.ready; TRADE.go = m.go; renderTrade(); } break;
      case 'tradeDone': if (m.tid === TRADE.tid) { MY_PCOIN = m.pcoin | 0; MY_BAG = m.bag || {}; MY_HATS = m.hats || {}; MY_TOOLS = m.tools || {}; if (player.look.hat && !MY_HATS[player.look.hat]) { player.look.hat = ''; saveLook(); } renderInv(); $('trade').hidden = true; TRADE.tid = null; toast('🤝 거래 완료!'); SND.play('coin'); } break;
      case 'tradeEnd': if (m.tid === TRADE.tid) { $('trade').hidden = true; TRADE.tid = null; toast(m.text); } break;
      case 'job': MY_JOB = m.job || null; toast(m.text); SND.play('war'); break;
      case 'contract': openContract(m); break;
      case 'contractSig': contractSig(m); break;
      case 'contractDone': contractDone(m); break;
      case 'contractEnd': contractEnd(m); break;
      case 'tools': if (m.pcoin != null) { MY_PCOIN = m.pcoin; renderInv(); } MY_TOOLS = m.tools || {}; toast(m.text); SND.play('coin'); if (!$('shopBox').hidden) renderShop(); break;
      case 'fishBite': if (FISHING.on) FISHING.biteAt = performance.now() + m.wait; break;
      case 'fished': stopFishing(); toast(m.text); if (m.fish) { FISHPOP = { kind: m.fish, t0: performance.now() }; SND.play('coin'); } break;
      case 'needLogin': try { localStorage.removeItem('mp2026.token'); localStorage.removeItem('mp2026.lv'); } catch (e) { /* 막힘 */ } if (m.mode === 'roster') showRoster(m.banned ? '이 계정은 쓸 수 없어요. 선생님께 말해 주세요' : m.text || ''); else showLogin(); break;
      case 'board': BOARD = m.posts || []; renderBoard(); break;
      case 'frag': onFrag(m); break;
      case 'ko': onKo(m); break;
      case 'wiped': { // 관리자 초기화: 본 장면·전투 기록 지우고 새로고침 (계정까지 지웠으면 처음부터)
        const keep = m.full ? ['mp2026.bgm', 'mp2026.sfx', 'mp2026.chatTuck'] : ['mp2026.bgm', 'mp2026.sfx', 'mp2026.chatTuck', 'mp2026.token', 'mp2026.look', 'mp2026.team', 'mp2026.opened'];
        try { for (const k of Object.keys(localStorage)) if (k.startsWith('mp2026.') && !keep.includes(k)) localStorage.removeItem(k); } catch (e) { /* 저장소 막힘 */ }
        toast('관리자가 게임을 초기화했어요 · 새로 시작해요'); setTimeout(() => location.reload(), 900); break;
      }
      case 'side': MY_SIDE = m.side; if (!$('fragBook').hidden) openFragBook(); break;
      case 'fx': onFx(m); break;
      case 'dead': onDead(m); break;
      case 'hp': onHp(m); break;
      case 'loot': LOOTS.set(m.l.id, m.l); break;
      case 'lootGone': LOOTS.delete(m.id); break;
      case 'act': { const r = remotes.get(m.id); if (r) { r.act = m.a; r.fx = m.fx; r.fy = m.fy; } break; }
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
  const WANDER_KIND = { naturalize: '귀화 신청', mercenary: '용병 등록', found: '건국 대기', recruit: '인재 모집' };
  function renderWander() {
    const box = $('wanderList'); box.textContent = '';
    const hasNat = ONLINE && !!MY_NID; $('wanderSolo').hidden = hasNat; $('wanderNat').hidden = !hasNat;
    if (hasNat) $('wanderNatName').textContent = natName(MY_NID);
    const sel = $('wanderTarget'), cur = sel.value; sel.innerHTML = '<option value="">나라 고르기</option>' + Object.values(nationsPub || {}).filter((n) => n && !n.dead).map((n) => `<option>${esc(n.name)}</option>`).join(''); sel.value = cur;
    if (!wanderList.length) { box.textContent = '아직 등록한 사람이 없어요.'; return; }
    for (const w of wanderList.slice().sort((a, b) => (a.kind === 'recruit' ? 0 : 1) - (b.kind === 'recruit' ? 0 : 1))) {
      const d = document.createElement('div'); d.className = 'wrow ' + w.kind;
      d.innerHTML = w.kind === 'recruit' ? `<b style="color:${esc(w.color || '#2b2340')}">■ ${esc(w.nation)}</b> 인재 모집 · ${esc(w.target || '누구나 환영')} <small>(${esc(w.name)})</small>` : `${WANDER_KIND[w.kind]} · ${esc(w.name)}${w.target ? ` → ${esc(w.target)}` : ''}`;
      box.appendChild(d);
    }
  }
  function wanderRegister(kind, cancel) {
    const target = kind === 'recruit' ? $('wanderRecruit').value.trim() : $('wanderTarget').value.trim();
    if (kind === 'naturalize' && !cancel && !target) { $('wanderMsg').textContent = '귀화할 나라를 골라 주세요.'; return; }
    if (ONLINE) { if (netOn) ws.send(JSON.stringify({ t: 'wander', kind, target, cancel: !!cancel })); }
    else {
      wanderList = wanderList.filter((w) => w.name !== player.name);
      if (!cancel) wanderList.push({ name: player.name, kind, target });
      renderWander();
    }
    $('wanderMsg').textContent = cancel ? '등록을 취소했어요.' : kind === 'recruit' ? '인재 모집을 올렸어요! 유랑민들이 이 목록을 보고 찾아와요.' : `${WANDER_KIND[kind]} 완료! 왕들이 이 목록을 보고 연락해요.`;
  }
  $('btnNat').addEventListener('click', () => wanderRegister('naturalize'));
  $('btnMerc').addEventListener('click', () => wanderRegister('mercenary'));
  $('btnFound').addEventListener('click', () => wanderRegister('found'));
  $('btnWanderCancel').addEventListener('click', () => wanderRegister(MY_NID ? 'recruit' : 'mercenary', true));
  $('btnRecruit').addEventListener('click', () => wanderRegister('recruit'));
  $('bpViewBtn').addEventListener('click', () => { if (BP.view !== 'list') BP.view = 'list'; else if (BP.sel) BP.view = 'view'; else return toast('읽을 글을 먼저 골라 주세요'); renderBoard(); });
  $('bpNew').addEventListener('click', () => { BP.view = BP.view === 'new' ? 'list' : 'new'; renderBoard(); if (BP.view === 'new') setTimeout(() => $('bpTitle').focus(), 30); });
  $('bpDel').addEventListener('click', () => { if (BP.sel && confirm('이 글을 지울까요?')) { ws.send(JSON.stringify({ t: 'boardDel', id: BP.sel })); BP.sel = null; } });
  $('bpQuit').addEventListener('click', () => { BP.closed = true; BP.open = false; $('boardPanel').hidden = true; });
  $('bpSend').addEventListener('click', () => { const title = $('bpTitle').value.trim(); if (!title) return toast('제목을 적어 주세요'); ws.send(JSON.stringify({ t: 'boardPost', title, body: $('bpBody').value.trim(), asNation: $('bpAsNat').checked })); $('bpTitle').value = ''; $('bpBody').value = ''; BP.view = 'list'; renderBoard(); });
  for (const id of ['bpTitle', 'bpBody']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (id === 'bpTitle') $('bpBody').focus(); else $('bpSend').click(); } if (e.key === 'Escape') e.target.blur(); });
  $('btnWanderClose').addEventListener('click', () => { $('wanderBox').hidden = true; });

  // 접속 화면
  function hideLoading() { const L = $('loading'); if (L.hidden) return; L.classList.add('out'); setTimeout(() => { L.hidden = true; L.classList.remove('out'); }, 250); if (!EDIT_MODE) startTitle(); else { titleDone = true; if (needFound) openFound('who'); } }
  function startOnline() {
    $('help').hidden = true; $('chat').hidden = false;
    setNet('서버에 연결하는 중…');
    if (window.MP_ROSTER && !store('mp2026.token')) { showRoster(); return; } // 학번·이름 → 메일 입장 코드
    if (window.MP_GOOGLE && !store('mp2026.token')) { showLogin(); return; } // 학교 계정 로그인 먼저
    connect();
  }
  // 학교 구글 계정 로그인 (서버에 GOOGLE_CLIENT_ID 가 있을 때만)
  let loginShown = false;
  function showLogin(msg) {
    const G = window.MP_GOOGLE; if (!G) return; $('gLogin').hidden = false; $('gDomain').textContent = '@' + G.domain; $('gErr').textContent = msg || '';
    if (loginShown) return; loginShown = true;
    const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true;
    sc.onload = () => { google.accounts.id.initialize({ client_id: G.client, hd: G.domain, callback: onGoogle, ux_mode: 'popup' }); google.accounts.id.renderButton($('gBtn'), { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'rectangular', width: 280 }); };
    sc.onerror = () => { $('gErr').textContent = '구글 로그인 창을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.'; };
    document.head.appendChild(sc);
  }
  // 학생 명단 로그인: 학번 + 이름 → 학교 메일로 온 6자리 코드
  const RL = { sid: '', name: '', role: 'student', email: '' };
  function setRole(role) { RL.role = role; for (const b of document.querySelectorAll('[data-role]')) b.setAttribute('aria-pressed', String(b.dataset.role === role)); $('rStu').hidden = role !== 'student'; $('rTea').hidden = role !== 'teacher'; $('rWhat').innerHTML = role === 'student' ? '학번과 이름을 넣으면<br>학교 메일로 <b class="hl">입장 코드</b>를 보내 드려요.' : '학교 메일을 넣으면<br>그 메일로 <b class="hl">입장 코드</b>를 보내 드려요.'; $('rErr').textContent = ''; setTimeout(() => (role === 'student' ? $('rSid') : $('rMail')).focus(), 30); }
  for (const b of document.querySelectorAll('[data-role]')) b.addEventListener('click', () => setRole(b.dataset.role));
  function showRoster(msg) {
    $('rLogin').hidden = false; $('rStep1').hidden = false; $('rStep2').hidden = true; setRole(RL.role); $('rErr').textContent = msg || '';
  }
  async function rPost(path, body) { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); }
  function rStep2(note) { $('rStep1').hidden = true; $('rStep2').hidden = false; $('rNote').innerHTML = note; $('rCode').value = ''; setTimeout(() => $('rCode').focus(), 50); }
  async function rStart(skipMail) {
    RL.sid = $('rSid').value.trim(); RL.name = $('rName').value.trim(); RL.email = $('rMail').value.trim();
    if (RL.role === 'student' && (!RL.sid || !RL.name)) { $('rErr').textContent = '학번과 이름을 적어 주세요'; return; }
    if (RL.role === 'teacher' && !/@/.test(RL.email)) { $('rErr').textContent = '학교 메일을 적어 주세요'; return; }
    if (skipMail) { $('rErr').textContent = ''; rStep2('선생님께 받은 <b>6자리 입장 코드</b>를 넣어 주세요.'); return; }
    $('rErr').textContent = '확인하는 중…'; $('rSend').disabled = true;
    try { const j = await rPost('/auth/start', { role: RL.role, sid: RL.sid, name: RL.name, email: RL.email }); $('rSend').disabled = false;
      if (!j.ok) { $('rErr').textContent = j.err || '확인하지 못했어요'; return; } $('rErr').textContent = '';
      rStep2(j.noMail ? '지금은 메일을 보낼 수 없어요. <b>선생님께 입장 코드</b>를 받아 넣어 주세요.' : `<b>${esc(j.masked)}</b> 로 6자리 입장 코드를 보냈어요.<br><small>10분 동안 쓸 수 있어요 · 안 보이면 스팸함도 확인해 주세요</small>`);
    } catch (e) { $('rSend').disabled = false; $('rErr').textContent = '서버에 연결하지 못했어요. 다시 해 주세요'; }
  }
  async function rVerify() {
    const code = $('rCode').value.replace(/\D/g, ''); if (code.length !== 6) { $('rErr2').textContent = '6자리 숫자를 넣어 주세요'; return; }
    $('rErr2').textContent = '확인하는 중…';
    try { const j = await rPost('/auth/verify', { role: RL.role, sid: RL.sid, name: RL.name, email: RL.email, code });
      if (!j.ok) { $('rErr2').textContent = j.err || '코드가 맞지 않아요'; return; }
      store('mp2026.token', j.token); store('mp2026.lv', j.lv); $('rLogin').hidden = true; $('rErr2').textContent = ''; if (!netOn) { try { ws && ws.close(); } catch (e) { /* 없음 */ } connect(); }
    } catch (e) { $('rErr2').textContent = '서버에 연결하지 못했어요. 다시 해 주세요'; }
  }
  $('rSend').addEventListener('click', () => rStart(false));
  $('rHave').addEventListener('click', () => rStart(true));
  $('rOk').addEventListener('click', rVerify);
  $('rBack').addEventListener('click', () => showRoster());
  $('rResend').addEventListener('click', () => { showRoster(); rStart(false); });
  for (const id of ['rSid', 'rName']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (id === 'rSid') $('rName').focus(); else rStart(false); } });
  $('rMail').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); rStart(false); } });
  $('rCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); rVerify(); } });
  async function onGoogle(resp) {
    $('gErr').textContent = '확인하는 중…';
    try {
      const r = await fetch('/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: resp.credential }) }), j = await r.json();
      if (!j.ok) { $('gErr').textContent = j.err || '로그인하지 못했어요'; return; }
      store('mp2026.token', j.token); $('gLogin').hidden = true; $('gErr').textContent = ''; if (!netOn) { try { ws && ws.close(); } catch (e) { /* 없음 */ } connect(); }
    } catch (e) { $('gErr').textContent = '서버에 연결하지 못했어요. 다시 해 주세요.'; }
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
  window.MP_DEBUG = { playBattles: (reps) => { if (testMode || !ONLINE) playBattles(reps, () => {}); }, openStore: () => { if (testMode) openStore(); }, openShop: (k) => { if (testMode) openShop(k); }, pos: () => (testMode ? [player.x, player.y, player.scene] : null), story: () => (testMode ? { FRAGS, have: [...MY_FRAGS], side: MY_SIDE } : null), tp: (x, y) => testMode && teleportTo(x, y), scene: (k) => testMode && startOpening(k), sfx: (n, v) => testMode && SND.play(n, v), room: (id) => testMode && enterRoom(id, 'ground'), shadeAt: (x, y) => { if (!testMode || !SHADE.cv.width) return -1; const d = SHADE.cv.getContext('2d').getImageData(Math.round(x - SHADE.x0), Math.round(y - SHADE.y0), 1, 1).data; return d[3]; }, noShade: (v) => { if (testMode) SHADE.disabled = !!v; }, cliffSpots: () => { if (!testMode) return null; const out = { l1: 0, l2: 0, walls: 0, stairs: 0, sample: null }; for (let y = PILOT.y0; y < PILOT.y1; y++) for (let x = PILOT.x0; x < PILOT.x1; x++) { const h0 = hgt(x, y); if (h0 === 1) out.l1++; if (h0 === 2) out.l2++; if (wallRow(x, y)) { out.walls++; if (isStair(x, y)) out.stairs++; else if (!out.sample && wallRow(x, y) === 1 && wallRow(x - 1, y) && wallRow(x + 1, y) && !isStair(x - 1, y) && !isStair(x + 1, y)) out.sample = [x, y]; } if (isStair(x, y) && wallRow(x, y) === 1 && !out.stair) out.stair = [x, y]; } out.list = out.list || []; return out; }, quiz: () => testMode && showQuiz('🎣 입질! 정답을 골라 낚아 올려요', 6000, (g) => console.log('grade', g)) }; // 테스트 모드에서만 (전선 많은 장면 확인용)
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
        h += me.raceOpen ? `<div class="plan"><h3>🛡 병영 · 병력 종족</h3><div class="row"><span>지금 우리 병력: <b>${RACE_INFO[cur].icon} ${RACE_INFO[cur].name}</b> (${RACE_INFO[cur].weapon}) · ${me.army}명</span><button id="btnBarracks" type="button">🛡 병영 열기</button></div></div>` : `<div class="plan locked"><h3>🔒 병영 (잠김)</h3><p class="msg">영역전에서 <b>처음 이기면</b> 병영이 열려요 (공격·방어·동맹 참전 승리 모두). 병영에서는 우리 병력의 종족을 고를 수 있어요.</p></div>`; }
      h += `<h3>나라 정보</h3><div class="msg">수도 ${esc(terrLabel(me.capital))} · 영토 ${me.territories}곳 · 병력 ${me.army} · 코인 ${me.coin} · 행동력 ${me.actions}</div>`;
      // 천도: 왕이 코인을 내고 우리 영역 중 아무 곳으로 (전투 대기 중 불가, 하루에 한 번)
      const mineT = Object.keys(owners).filter((k) => owners[k] === me.id && +k !== me.capital).map(Number);
      h += `<div class="plan"><h3>🏰 천도</h3><p class="msg">수도를 우리 영역 중 다른 곳으로 옮겨요 · 코인 ${MPRules.NUM.capitalMoveCost} · 선전포고를 받은 동안은 못 하고, 하루에 한 번만 · 영역을 잃을 땐 공격팀과 가까운 곳부터 넘어가니 수도는 멀리 두는 게 안전해요</p>` +
        (mineT.length ? `<div class="targets">${mineT.map((tid) => `<button class="tgt" data-cap="${tid}" ${king ? '' : 'disabled'}>${esc(terrLabel(tid))}</button>`).join('')}</div>` : '<p class="msg">옮길 수 있는 다른 영역이 없어요.</p>') + (king ? '' : '<p class="note">천도는 왕만 할 수 있어요.</p>') + '</div>';
    } else if (warTab === 'ally') { // 🤝 동맹: 왕끼리 합의, 최대 3나라, 동맹끼리 공격 불가, 동맹 전투에 한 번 참전
      const allies = v.allies || [], inReq = v.allyIn || [], out = new Set(v.allyOut || []);
      h += `<div class="plan"><h3>🤝 우리 동맹 (${allies.length + 1}/${MPRules.NUM.maxAlly}나라)</h3>${allies.length ? allies.map((a) => `<div class="row"><span><b style="color:${a.color}">■</b> ${esc(a.name)}</span></div>`).join('') + (king ? '<div class="row"><span class="msg">동맹에서 나가면 다시 서로 공격할 수 있어요</span><button id="btnAllyLeave">동맹 나가기</button></div>' : '') : '<p class="msg">아직 동맹이 없어요. 아래에서 다른 나라에 동맹을 제안해 보세요.</p>'}
        <p class="msg">동맹끼리는 선전포고할 수 없어요. 동맹이 싸우면 참전해서 병력을 보낼 수 있어요 (한 번만, 뺄 수 없음). 살아남은 참전 병력은 도와준 나라의 병력이 되고, 이기면 재료를 낸 병력 비율로 나눠요.</p></div>`;
      h += `<div class="plan"><h3>📜 동맹 맺는 법</h3><p class="msg">동맹은 <b>왕끼리 직접 만나야</b> 맺을 수 있어요. 상대 나라 왕 바로 옆(3칸 안)에서 E → 동맹 계약서가 두 왕에게 펼쳐지고, <b>둘 다 서명</b>하면 동맹이 돼요. 하늘 회담장에서 만나는 걸 추천해요.</p>${king ? '' : '<p class="note">동맹 계약은 왕만 할 수 있어요.</p>'}</div>`;
      const ab = v.allyBattles || [];
      h += `<h3>⚔ 동맹의 전투 (${ab.length})</h3>` + (ab.length ? '' : '<p class="msg">지금 동맹국이 싸우는 전투가 없어요.</p>');
      h += ab.map((b) => `<div class="plan"><div class="row"><span>${esc(terrLabel(b.target))} · <b style="color:${natColor(b.att)}">${esc(natName(b.att))}</b> → <b style="color:${natColor(b.def)}">${esc(natName(b.def))}</b></span><span>${slotText(b.slot)} · 전선 ${b.F}곳</span></div>
        <p class="msg">우리는 <b>${b.side === 'att' ? '공격' : '방어'}</b> 편 (${esc(natName(b.side === 'att' ? b.att : b.def))} 돕기)${b.helpers.length ? ` · 참전한 동맹 ${b.helpers.length}나라` : ''}</p>
        ${b.joined ? `<div class="fgrid">${b.joined.map((x, i) => `<span class="${b.side}"><b>${FN(i)}</b>${x}</span>`).join('')}</div><p class="msg">참전 완료 · 병력은 뺄 수 없어요</p>` : king ? `<div class="row"><span>보낼 병력 <input id="ajTotal${b.id}" type="number" min="0" value="${Math.min(me.army, 5 * b.F)}" style="width:80px"> <button data-aj-even="${b.id}">고르게</button></span></div>${troopInputs('aj' + b.id + '_', Array(b.F).fill(0), false)}<div class="row"><span id="ajSum${b.id}"></span><button data-ally-join="${b.id}" data-f="${b.F}">참전하기</button></div>` : '<p class="note">참전은 왕만 정할 수 있어요.</p>'}</div>`).join('');
      void inReq; void out;
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
          <div class="msg">${esc(r.attName)}(공격) → ${esc(r.defName)}(방어)${r.autoDef ? ' · 방어 자동 배치' : ''}${(r.helpers || []).length ? ' · 🤝 참전: ' + r.helpers.map((x) => `${esc(x.name)}(${x.side === 'att' ? '공격' : '방어'} ${x.sent}명)`).join(', ') : ''}</div>
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
    if ($('btnBarracks')) $('btnBarracks').onclick = () => openBarracks();
    for (const b of box.querySelectorAll('[data-ally-ask]')) b.onclick = () => warAction('allyPropose', { nid: b.dataset.allyAsk });
    for (const b of box.querySelectorAll('[data-ally-yes]')) b.onclick = () => warAction('allyAnswer', { nid: b.dataset.allyYes, yes: true });
    for (const b of box.querySelectorAll('[data-ally-no]')) b.onclick = () => warAction('allyAnswer', { nid: b.dataset.allyNo, yes: false });
    if ($('btnAllyLeave')) $('btnAllyLeave').onclick = () => { if (confirm('동맹에서 나갈까요? 나가면 서로 공격할 수 있어요.')) warAction('allyLeave', {}); };
    for (const b of box.querySelectorAll('[data-ally-join]')) {
      const bid = b.dataset.allyJoin, F = +b.dataset.f, sumEl = $('ajSum' + bid), pre = 'aj' + bid + '_';
      const check = () => { const t = troopsOf(pre, F), sm = t.reduce((a, c) => a + c, 0), bad = sm <= 0 || sm > me.army; sumEl.textContent = sm > me.army ? `합계 ${sm} / ${me.army} · 병력이 모자라요!` : `합계 ${sm} / ${me.army}`; sumEl.style.color = bad ? '#c22f53' : ''; b.disabled = bad; return !bad; };
      for (let i = 0; i < F; i++) $(pre + i).oninput = check;
      box.querySelector(`[data-aj-even="${bid}"]`).onclick = () => { spreadEven(pre, F, Math.min(me.army, parseInt($('ajTotal' + bid).value, 10) || 0)); check(); };
      check();
      b.onclick = () => { if (check() && confirm('참전하면 병력을 뺄 수 없어요. 보낼까요?')) warAction('allyJoin', { battle: +bid, troops: troopsOf(pre, F) }); };
    }
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
  let foundingOpen = true, foundSel = null, foundColor = null;
  function renderFoundColors() { // 건국할 때 나라 색 고르기 (다른 나라가 쓰는 색은 못 고름)
    const used = new Set(Object.values(nationsPub).filter((n) => !n.dead).map((n) => n.color));
    if (!foundColor || used.has(foundColor)) foundColor = MPRules.COLORS.find((c) => !used.has(c)) || MPRules.COLORS[0];
    $('fColors').innerHTML = MPRules.COLORS.map((c) => `<button type="button" class="sw" data-fc="${c}" style="background:${c}" aria-pressed="${c === foundColor}" ${used.has(c) ? 'disabled title="다른 나라가 쓰는 색"' : ''}></button>`).join('');
    for (const b of $('fColors').querySelectorAll('[data-fc]')) b.onclick = () => { foundColor = b.dataset.fc; renderFoundColors(); };
  }
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
    if (step === 'found') { foundSel = null; drawFoundMap(); showFoundInfo(); renderFoundColors(); $('fName').focus(); }
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
    fg.fillStyle = '#3a82cb'; fg.fillRect(0, 0, S, S);
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
    if (ONLINE) { netAfterLook(); ws.send(JSON.stringify({ t: 'found', name, capital: foundSel, color: foundColor })); }
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
    stepPlayer(dt); tickHold(); tickFishing();
    DROWN.msg = ''; if (player.scene === 'ground' && !TITLE.on && ART.w_wsh && !amDead()) { const dp = depthAtPx(player.x, player.y), deep = dp >= 4.2 && (player._sk || 0) > 0.8; DROWN.t = deep ? DROWN.t + dt : 0; // 얕은 바다는 괜찮음, 아주 깊은 곳에서만 3초 경고 뒤 기절
      if (deep) DROWN.msg = `⚠ ${Math.max(0, Math.ceil(3 - DROWN.t))}초 뒤 기절!`; else if (dp >= 3.4 && !isLand(Math.floor(player.x / TILE), Math.floor(player.y / TILE))) DROWN.msg = '🌊 깊어요';
      if (DROWN.t > 3 && performance.now() - DROWN.sent > 4000) { DROWN.sent = performance.now(); if (netOn) ws.send(JSON.stringify({ t: 'drown' })); } }
    tickBoard(); tickQuiz(); tickWelcome(); tickWar3();
    { const show = ONLINE && player.scene === 'ground' && (matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0) && !TITLE.on; if ($('atkBtn').hidden === show) { $('atkBtn').hidden = !show; $('swapBtn').hidden = !show; } if (show && swapIcon.w !== myWeapon()) { swapIcon.w = myWeapon(); swapIcon(); } } // 패드·폰: 동그라미 공격·무기 교체 버튼
    { const a = curAct(); if (a !== lastAct) { lastAct = a; if (netOn) ws.send(JSON.stringify({ t: 'act', a, fx: FISHING.x | 0, fy: FISHING.y | 0 })); } } // 도구를 주변에 알림
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
    if (moveLocked() || amDead()) { queuedDir = null; return null; }
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
    if (room ? roomBlocked(room, nx, ny) : ((blocked(nx, ny) && !swimmable(nx, ny)) || heightBlocked(cx, cy, nx, ny))) { player.x = cx * TILE + 16; player.y = cy * TILE + 16; player.moving = false; return; }
    step.on = true; step.t = 0;
    step.fx = player.x; step.fy = player.y; step.tx = nx * TILE + 16; step.ty = ny * TILE + 16;
    step.dur = (keys.has('shift') ? 0.04 : STEP) / (room ? 1 : speedAt(nx, ny)) * (player.carry ? 1.25 : 1); // 훔친 걸 들면 느려짐
    player.moving = true;
  }

  const WAKES = [];
  function drawWakes() { const nw = performance.now(); ctx.lineWidth = 2; // 퍼지면서 사라지는 물결 (도트 굵기 2px)
    for (let i = WAKES.length - 1; i >= 0; i--) { const w = WAKES[i], k = (nw - w.t0) / (w.mv ? 900 : 1600); if (k >= 1) { WAKES.splice(i, 1); continue; }
      const r = 6 + k * (w.mv ? 22 : 16), a = Math.atan2(-w.dy, -w.dx); ctx.strokeStyle = `rgba(235,250,255,${(1 - k) * 0.7})`; ctx.beginPath();
      if (w.mv) ctx.ellipse(w.x, w.y, r, r * 0.4, 0, a - 1.1, a + 1.1); else ctx.ellipse(w.x, w.y, r, r * 0.4, 0, 0, Math.PI * 2); ctx.stroke(); } }
  function drawActors(list, t) {
    list.sort((a, b) => a.y - b.y); if (player.scene === 'ground') drawWakes();
    ctx.imageSmoothingEnabled = true;
    for (const o of list) {
      if (o.draw) o.draw(ctx, o.x, o.y);
      else {
        const down = (o.downUntil || 0) > performance.now(), inv = (o.invUntil || 0) > performance.now();
        if (down) ctx.globalAlpha = 0.35; else if (inv && Math.floor(performance.now() / 90) % 2) ctx.globalAlpha = 0.5;
        const wpn = o === player ? myWeapon() : remWeapon(o), act = o === player ? curAct() : o.act, nowT = performance.now();
        const hk = o.hitAt ? Math.max(0, 1 - (nowT - o.hitAt) / 200) : 0, ox = o.x, oy = o.y; if (hk > 0) { o.x += o.hitDx * 9 * hk; o.y += o.hitDy * 6 * hk; } // 맞으면 뒤로 밀림
        const atkPose = o.swing && nowT - o.swing < 260;
        const sk = sinkSmooth(o), wl = o.y - 2 - sk * 34, body = () => { // 물에 잠긴 부분은 반투명 → 깊을수록 흐려져 안 보임
        const S2 = shadeBegin(o), G = S2 ? S2.g : ctx; // 나무 그림자 속이면 임시 판에 그린 뒤 겹친 부분만 어둡게
        if ((o.face | 0) === 1 && !down && !act) drawWeaponOn(G, o, wpn, t);
        if (hk > 0.55) G.filter = 'brightness(3.2)'; /* 맞은 순간 하얗게 번쩍 */
        drawSprite(G, o.x, o.y, o.look, t, o.moving && !atkPose, o.face, atkPose); G.filter = 'none'; if (act && !down) drawToolOn(G, o, act, t); /* 작업 중이면 손에 도구 */
        if ((o.face | 0) !== 1 && !down && !act) drawWeaponOn(G, o, wpn, t);
        if (S2) shadeEnd(S2); };
        if (sk > 0.02) { const a0 = ctx.globalAlpha; ctx.save(); ctx.beginPath(); ctx.rect(o.x - 80, o.y - 200, 160, 200 - (o.y - wl)); ctx.clip(); body(); ctx.restore();
          ctx.save(); ctx.beginPath(); ctx.rect(o.x - 80, wl, 160, 120); ctx.clip(); ctx.globalAlpha = a0 * Math.max(0, 0.55 * (1 - sk)); if (ctx.globalAlpha > 0.01) body(); ctx.restore(); ctx.globalAlpha = a0; } else body();
        if (sk > 0.02) { const nw = performance.now(), mv = Math.hypot(o.x - (o._wx ?? o.x), o.y - (o._wy ?? o.y)) > 0.3; // 물결파: 움직이면 뒤로 퍼지는 물결, 서 있으면 가끔 잔잔한 물결
          if (nw - (o._wk || 0) > (mv ? 130 : 1300)) { o._wk = nw; WAKES.push({ x: o.x, y: wl, t0: nw, dx: o.x - (o._wx ?? o.x), dy: o.y - (o._wy ?? o.y), mv }); if (WAKES.length > 120) WAKES.shift(); } }
        o._wx = o.x; o._wy = o.y;
        o.x = ox; o.y = oy; ctx.globalAlpha = 1;
      }
    }
    for (const o of list) {
      if (o.draw) continue;
      { const hp = o === player ? PV.hp : o.hp, dl = (o.downUntil || 0) - performance.now(); if (player.scene === 'ground' && hp != null && hp < HPMAX && dl <= 0) drawHpBar2(ctx, o.x, o.y - 76, hp);
        if (dl > 0) { const txt = `💫 기절 · 부활 중 ${Math.ceil(dl / 1000)}`; ctx.font = `700 13px ${PFONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const w = ctx.measureText(txt).width + 14; ctx.fillStyle = 'rgba(43,35,64,0.85)'; ctx.fillRect(o.x - w / 2, o.y - 92, w, 20); ctx.fillStyle = '#ffd84d'; ctx.fillText(txt, o.x, o.y - 82);
          const k = 1 - dl / (MPRules.NUM.pvp.respawnSec * 1000); ctx.fillStyle = '#5a1a2a'; ctx.fillRect(o.x - w / 2, o.y - 72, w, 4); ctx.fillStyle = '#9fd3ff'; ctx.fillRect(o.x - w / 2, o.y - 72, w * Math.max(0, Math.min(1, k)), 4); } }
      if (o === player && DROWN.msg) { const deep = DROWN.msg[0] === '⚠'; ctx.font = `800 14px ${PFONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const w = ctx.measureText(DROWN.msg).width + 18, yy = o.y - 84 + (deep ? Math.sin(performance.now() / 80) * 1.5 : 0); ctx.fillStyle = deep ? 'rgba(170,20,40,0.92)' : 'rgba(20,60,110,0.85)'; ctx.fillRect(o.x - w / 2, yy - 12, w, 24); ctx.fillStyle = '#fff'; ctx.fillText(DROWN.msg, o.x, yy + 1); } // 익사 경고
      nameTag(ctx, o.x, o.y - 56, (SIDE_ICON[o === player ? MY_SIDE : o.side] || '') + jobIcon(o === player ? MY_JOB : o.job) + (o === player ? player.name : o.name) + ((o === player ? player.teacher : o.teacher) ? ' 선생님' : '') + (o.badge ? ' ' + o.badge : ''), o === player ? player.tag : o.tag); // 이름 옆 악명 (💀 / 체포왕 👮)
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
    ctx.fillStyle = '#1f62c0'; ctx.fillRect(0, 0, vw, vh); // 맵 밖도 바다
    if (shakeT > 0) shakeT = Math.max(0, shakeT - lastDt); const shk = shakeT > 0 ? 4 * shakeT / 0.3 : 0; // 맞으면 화면 흔들림
    const camX = (TITLE.on ? TITLE.x : player.x) - vw / 2 / zoom + (Math.random() - 0.5) * shk, camY = (TITLE.on ? TITLE.y : player.y) - 40 - vh / 2 / zoom + (Math.random() - 0.5) * shk;
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -camX * dpr * zoom, -camY * dpr * zoom);
    ctx.imageSmoothingEnabled = false;
    groundCam.x = camX; groundCam.y = camY;

    chunkBudget = 3;
    const ci0 = Math.floor(camX / CPX), cj0 = Math.floor(camY / CPX);
    const ci1 = Math.floor((camX + vw / zoom) / CPX), cj1 = Math.floor((camY + vh / zoom) / CPX);
    const order = [];
    for (let j = cj0; j <= cj1; j++) for (let i = ci0; i <= ci1; i++) order.push([i, j, Math.hypot(i * CPX + CPX / 2 - player.x, j * CPX + CPX / 2 - player.y)]);
    order.sort((a, b) => a[2] - b[2]);
    const drawn = [];
    for (const [i, j] of order) {
      const c = getChunk(i, j); drawn.push([i, j, c]);
      if (c) ctx.drawImage(c, i * CPX, j * CPX);
      else { ctx.fillStyle = '#9fd88a'; ctx.fillRect(i * CPX, j * CPX, CPX, CPX); }
    }
    drawWaves(t, drawn);

    if (ART.w_wsh) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; const sx0 = Math.floor(camX / TILE), sx1 = Math.ceil((camX + vw / zoom) / TILE), sy0 = Math.floor(camY / TILE), sy1 = Math.ceil((camY + vh / zoom) / TILE), tt = t; // 물 위 반짝임 (흰 점이 잠깐씩 깜빡)
      for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) { const h = hash(x, y, 91); if (h > 0.18 || isLand(x, y) || waterDepth(x, y) < 1) continue; const ph = (tt * 0.35 + hash(x, y, 92) * 7) % 1; if (ph > 0.22) continue;
        const ox = (hash(x, y, 93) * 15 | 0) * 2, oy = (hash(x, y, 94) * 15 | 0) * 2; ctx.fillRect(x * TILE + ox, y * TILE + oy, 2, 2); if (ph > 0.06 && ph < 0.16) { ctx.fillRect(x * TILE + ox - 2, y * TILE + oy, 6, 2); } } }
    // 깊이 정렬: 큰 물체 + 캐릭터
    const x0 = camX - 300, x1 = camX + vw / zoom + 300, y0 = camY - 100, y1 = camY + vh / zoom + 350;
    const list = [];
    for (const s of sprites) if (s.x > x0 && s.x < x1 && s.y > y0 && s.y < y1) list.push(s);
    const tx0 = Math.floor(x0 / TILE), tx1 = Math.ceil(x1 / TILE), ty0 = Math.floor(y0 / TILE), ty1 = Math.ceil(y1 / TILE);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const k = treeAt(tx, ty);
      if (k) list.push({ x: tx * TILE + 16, y: ty * TILE + 30, draw: (g, X, Y) => drawWorldTree(g, k, tx, ty, X, Y, t) });
      else if (USER.animals.length && tileAt(tx, ty) === T.GRASS && !noTree[ty * W + tx]) {
        const ha = hash(tx, ty, 21);
        if (ha < 0.0025) { const a = USER.animals[(ha * 1e6 | 0) % 6], hx = tx * TILE + 16, hy = ty * TILE + 28, sd = tx * 7 + ty * 13, okAt = (x, y) => !blocked(Math.floor(x / TILE), Math.floor(y / TILE)), pos = animalPos(a, hx, hy, sd, okAt); list.push({ x: pos[0], y: pos[1], draw: (g) => drawAnimal(g, a, hx, hy, sd, okAt) }); }
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
    for (const t of terrs) { if (!t || gone[t.id] || !(t.capitalCandidate || ownerOf(t.id))) continue; const q = portalOf(t); if (!q || q[0] < tx0 || q[0] > tx1 || q[1] < ty0 || q[1] > ty1) continue; if (build.moving && build.moving.kind === 'portal' && t === home) continue; list.push({ x: q[0] * TILE + 16, y: q[1] * TILE + 20, draw: (g, X, Y) => drawPortal(g, X, Y, t === home && !!MY_NID) }); } // 하늘 포털 (나라 수도 · 주인 없는 수도 후보)
    if (build.on && player.scene === 'ground') { // 설치 모드: 앞 칸 표시
      for (const [fx, fy] of build.moving ? [facingTile()] : shapeTiles()) { const ok = ownerOf(terrAt(fx, fy)) === MY_NID && !blocked(fx, fy); ctx.fillStyle = ok ? 'rgba(255,211,77,0.35)' : 'rgba(255,60,80,0.3)'; ctx.fillRect(fx * TILE, fy * TILE, TILE, TILE); ctx.strokeStyle = ok ? '#ffd34d' : '#ff3c50'; ctx.lineWidth = 2; ctx.strokeRect(fx * TILE + 1, fy * TILE + 1, TILE - 2, TILE - 2); }
    }
    for (const b of others('ground', null)) if (b.x > x0 && b.x < x1 && b.y > y0 && b.y < y1) list.push(b);
    for (const f of FRAGS) if (!MY_FRAGS.has(f.i) && f.x > x0 && f.x < x1 && f.y > y0 && f.y < y1) list.push({ x: f.x, y: f.y, draw: (g, X, Y) => drawFrag(g, X, Y, t, f.i) });
    list.push(player);
    drawLoots(ctx, t);
    buildShadeMask(tx0, tx1, ty0, ty1);
    drawActors(list, t);
    SHADE.on = false;
    { const c = atkCharge(); if (c >= 0.25 && !ATK.chFx && PFXW) { ATK.chFx = wfx('spell-charge', player.x, player.y, {}, { follow: player }); SND.play('charge'); ATK.full = false; } if (c >= 1 && !ATK.full) { ATK.full = true; SND.play('chargeFull'); } if (c >= 0) { ctx.strokeStyle = c >= 1 ? '#fff2a8' : 'rgba(159,211,255,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(player.x, player.y - 24, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c); ctx.stroke(); if (c >= 1) { ctx.font = `700 12px ${PFONT}`; ctx.textAlign = 'center'; ctx.fillStyle = '#fff2a8'; ctx.fillText('차징!', player.x, player.y - 100); } } }
    drawWfx(Math.min(0.05, lastDt || 0.016), groundCam.x, groundCam.y);
    if (hold.on) { // 꾹 누르기 게이지
      const k = Math.min(1, (performance.now() - hold.t0) / hold.ms);
      ctx.fillStyle = '#2b2340'; ctx.fillRect(player.x - 26, player.y - 96, 52, 10); ctx.fillStyle = '#ffd34d'; ctx.fillRect(player.x - 24, player.y - 94, 48 * k, 6);
    }
    if (FISHING.on) { const d = FACE_D[player.face | 0] || [0, 1], far = (tileAt(FISHING.x + d[0], FISHING.y + d[1]) === T.WATER) ? 1 : 0.4; drawFishLine(ctx, player, (FISHING.x + d[0] * far) * TILE + 16, (FISHING.y + d[1] * far) * TILE + 18, FISHING.phase === 'bite', t); } // 찌는 물 쪽으로 조금 더 멀리
    for (const r of remotes.values()) if (r.act === 'fish' && r.x != null && r.fx) drawFishLine(ctx, r, r.fx * TILE + 16, r.fy * TILE + 18, false, t);
    if (FISHPOP && performance.now() - FISHPOP.t0 < 1600) { const k = (performance.now() - FISHPOP.t0) / 1600; ctx.globalAlpha = 1 - Math.max(0, k - 0.7) / 0.3; drawFish(ctx, player.x, player.y - 80 - k * 30, FISHPOP.kind, 3); ctx.globalAlpha = 1; }
    if (hold.on && hold.kind === 'mine' && hold.nx != null) for (let i = 0; i < 5; i++) { const u = ((performance.now() / 400) + i / 5) % 1; ctx.fillStyle = i % 2 ? '#8c8a96' : '#ffd84d'; ctx.fillRect(Math.round(hold.nx + Math.cos(i * 1.7) * u * 26), Math.round(hold.ny - 20 - Math.sin(u * Math.PI) * 22), 4, 4); } // 곡괭이 돌 부스러기
    if (EDIT.on) { groundEditOverlay(tx0, tx1, ty0, ty1); propGhost(); if (EDIT.lastScene !== 'ground') { EDIT.lastScene = 'ground'; editUI(); } }
    nightTint(); // 낮·밤
    if (WEATHER === 'rain' && ONLINE) drawRain(t); // 비
    { const k = 1 - (performance.now() - PV.flash) / 300; if (k > 0) { ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); const gr = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.3, vw / 2, vh / 2, Math.max(vw, vh) * 0.7); gr.addColorStop(0, 'rgba(232,40,60,0)'); gr.addColorStop(1, `rgba(232,40,60,${0.45 * k})`); ctx.fillStyle = gr; ctx.fillRect(0, 0, vw, vh); ctx.restore(); } } // 맞으면 화면 가장자리 빨갛게
    if (performance.now() < stunUntil) { ctx.font = `700 13px ${PFONT}`; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd34d'; ctx.fillText('✦ 꼼짝 못 함 ✦', player.x, player.y - 100); }
  }

  // ------------------------------------------------------------ 게임 시계 (서버) · 낮밤 · 멸망 D-day
  const SLOT_NAME = { morning: '아침 9시', lunch: '점심 1시', night: '밤 10시' };
  function setClock(c) {
    if (!c) return;
    const dayChanged = c.day !== DAY;
    if (c.weather && c.weather !== WEATHER) { WEATHER = c.weather; whereDirty = true; if (WEATHER === 'rain' && !TITLE.on) toast('🌧 비가 내리기 시작했어요 (30분쯤) · 물고기 입질이 빨라지고 귀한 물고기가 잘 잡혀요'); }
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
    if (!DOOM || TITLE.on || OP.on || !titleDone || player.scene === 'sky') return; // 타이틀·오프닝이 끝난 뒤에 · 하늘에선 안 띄움
    if (!store('mp2026.confess')) { store('mp2026.confess', 1); startOpening('confess'); return; } // 선포일: 여신의 고백 먼저
    if (ONLINE && netOn && DAY >= SIDE_DAY && !MY_SIDE && !sideAsked) { sideAsked = true; startOpening('side'); return; } // 13일차: 편 고르기
    if (store('mp2026.doomSeen') === DAY) return;
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
  // 사람을 클릭하면 작은 메뉴: 거래 신청 (바로 옆 2칸 안이어야 함)
  canvas.addEventListener('click', (e) => {
    if (EDIT.on || !ONLINE || !netOn || TITLE.on) return;
    const r = canvas.getBoundingClientRect(), cam = player.scene === 'sky' ? skyCam : groundCam, wx = (e.clientX - r.left) / zoom + cam.x, wy = (e.clientY - r.top) / zoom + cam.y;
    let hit = null, hd = 30; for (const [id, o] of remotes) { if (o.x == null) continue; const d = Math.hypot(o.x - wx, o.y - 24 - wy); if (d < hd) { hd = d; hit = [id, o]; } }
    const pm = $('pmenu'); if (!hit) { pm.hidden = true; return; }
    const [id, o] = hit, far = Math.hypot(o.x - player.x, o.y - player.y) > MPRules.NUM.tradeTiles * TILE;
    $('pmName').innerHTML = `${esc(o.name || '?')}${o.nid ? ` <small style="color:${natColor(o.nid)}">■ ${esc(natName(o.nid))}</small>` : ''}`;
    $('pmTrade').disabled = far; $('pmTrade').textContent = far ? '🤝 거래 (더 가까이 가요)' : '🤝 거래 신청';
    $('pmTrade').onclick = () => { ws.send(JSON.stringify({ t: 'tradeAsk', id })); pm.hidden = true; };
    pm.style.left = Math.min(innerWidth - 190, e.clientX + 8) + 'px'; pm.style.top = Math.min(innerHeight - 90, e.clientY + 8) + 'px'; pm.hidden = false;
  });
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
    let ac = null, master = null, sfxBus = null, bgmBus = null, bgmOn = false, bgmTimer = 0, step = 0, OUT = null; // OUT: 이번 소리만 작게 (멀리서 난 소리)
    const vol = (k, d) => { const v = store(k); return (v == null ? d : v) / 100; };
    function init() {
      if (ac) return true;
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return false; }
      master = ac.createGain(); master.connect(ac.destination);
      sfxBus = ac.createGain(); sfxBus.gain.value = vol('mp2026.sfx', 70) * 0.5; sfxBus.connect(master);
      bgmBus = ac.createGain(); bgmBus.gain.value = vol('mp2026.bgm', 60) * 0.55; bgmBus.connect(master); // 배경음악 크게
      return true;
    }
    function tone(freq, t0, dur, type = 'square', gain = 0.3, bus = OUT || sfxBus, slide = 0) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(bus); o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function sweep(t0, dur, f0, f1, gain = 0.3, q = 1.4) { // 휙: 띠 거르개를 훑는 바람 소리
      const n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / n);
      const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); src.buffer = buf; f.type = 'bandpass'; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(OUT || sfxBus); src.start(t0);
    }
    function noise(t0, dur, gain = 0.3, hp = 800, bus = OUT || sfxBus) {
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
      // ---- 전투 (무기마다 휘두르는 소리 · 맞는 소리 · 차징)
      swingSword: (t) => { sweep(t, 0.16, 700, 3200, 0.55); tone(2600, t + 0.05, 0.08, 'triangle', 0.05); },
      swingSpin: (t) => { sweep(t, 0.35, 500, 2600, 0.5, 1); sweep(t + 0.12, 0.3, 900, 3600, 0.4, 1); tone(2900, t + 0.1, 0.2, 'triangle', 0.05, OUT || sfxBus, 0.8); },
      swingHeavy: (t) => { sweep(t, 0.28, 220, 1100, 0.65, 0.9); tone(95, t + 0.18, 0.16, 'triangle', 0.35, OUT || sfxBus, 0.6); },
      slam: (t) => { sweep(t, 0.22, 200, 900, 0.6, 0.9); tone(70, t + 0.2, 0.35, 'triangle', 0.55, OUT || sfxBus, 0.4); noise(t + 0.2, 0.25, 0.35, 90); },
      stab: (t) => { sweep(t, 0.1, 1400, 4200, 0.5, 2); tone(520, t, 0.08, 'triangle', 0.12, OUT || sfxBus, 1.8); },
      swingDagger: (t) => { sweep(t, 0.08, 1500, 4500, 0.45, 1.6); sweep(t + 0.09, 0.08, 1500, 4800, 0.4, 1.6); },
      bow: (t) => { tone(330, t, 0.2, 'sawtooth', 0.12, OUT || sfxBus, 0.7); tone(660, t, 0.12, 'sine', 0.1); sweep(t + 0.02, 0.18, 2500, 6000, 0.3, 2); },
      fire: (t) => { sweep(t, 0.4, 260, 1100, 0.5, 0.8); tone(160, t, 0.35, 'sawtooth', 0.06, OUT || sfxBus, 2.2); },
      boom: (t) => { tone(70, t, 0.4, 'triangle', 0.55, OUT || sfxBus, 0.35); noise(t, 0.4, 0.45, 60); sweep(t, 0.3, 1800, 300, 0.25, 0.7); },
      punch: (t) => { sweep(t, 0.07, 600, 1800, 0.35, 1.2); tone(120, t + 0.04, 0.09, 'triangle', 0.3, OUT || sfxBus, 0.5); },
      pow: (t) => { sweep(t, 0.1, 400, 1600, 0.45, 1); tone(90, t + 0.06, 0.16, 'triangle', 0.5, OUT || sfxBus, 0.45); noise(t + 0.06, 0.12, 0.3, 150); tone(480, t + 0.12, 0.18, 'square', 0.08, OUT || sfxBus, 1.6); },
      smack: (t) => { noise(t, 0.06, 0.4, 900); tone(180, t, 0.08, 'triangle', 0.3, OUT || sfxBus, 0.6); },
      smackHeavy: (t) => { noise(t, 0.1, 0.5, 400); tone(110, t, 0.18, 'triangle', 0.5, OUT || sfxBus, 0.5); tone(1800, t, 0.12, 'triangle', 0.1, OUT || sfxBus, 0.6); },
      charge: (t) => { tone(260, t, 0.55, 'sine', 0.14, OUT || sfxBus, 3); tone(390, t + 0.05, 0.5, 'triangle', 0.05, OUT || sfxBus, 3); },
      chargeFull: (t) => { tone(1320, t, 0.18, 'square', 0.1); tone(1760, t + 0.06, 0.25, 'sine', 0.12); },
      ko: (t) => { tone(440, t, 0.18, 'square', 0.14, OUT || sfxBus, 0.5); tone(220, t + 0.16, 0.4, 'square', 0.12, OUT || sfxBus, 0.5); noise(t, 0.3, 0.25, 300); },
    };
    function play(name, v = 1) { if (!init() || ac.state === 'suspended') { if (ac) ac.resume(); } if (!ac || !FX[name]) return; try { if (v < 0.99) { OUT = ac.createGain(); OUT.gain.value = Math.max(0.05, v); OUT.connect(sfxBus); } FX[name](ac.currentTime + 0.01); } catch (e) { console.warn('효과음 오류', name, e.message); } OUT = null; }
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
  // 로고: MP 모노그램 (M의 오른쪽 기둥 = P의 기둥, 가운데 가로줄). 매끈한 글자 + 파스텔 그라데이션 + 두꺼운 남색 테두리 + 흰 안쪽 테두리 + 광택 + 반짝이
  // 로고: 작게 그린 글자에 도트 테두리·그림자를 붙인 뒤 크게 키움 (MP)
  function makeLogo(cv) {
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'monospace';
    const W2 = 112, H2 = 50; cv.width = W2; cv.height = H2; const g = cv.getContext('2d');
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
    { who: '여신', text: '그럼 이 세계에서 지낼 모습도 골라 볼까요? 마음에 드는 모습을 골라 주세요.', closet: true },
    { who: '여신', text: '이 땅은 227개의 영토로 나뉘어 있어요. 동료들과 나라를 세우고, 제단의 퍼즐을 풀어 땅을 넓혀 주세요.' },
    { who: '여신', text: '3일차부터는 영역전이 시작돼요. 매일 점심 1시와 밤 10시, 전선에 병력을 나눠 싸우게 될 거예요.' },
    { who: '여신', text: '그리고…… 아니에요. 그 이야기는 조금 나중에 할게요.' },
    { who: '여신', text: '자, 이제 당신의 나라를 세우러 가 볼까요?' },
  ];
  // 다시 보기: 이름은 이미 아니까 묻지 않음 / 이름 바꾸기: 여신이 나와서 새 이름을 물어봄
  const OP_REPLAY = OP_LINES.map((L) => (L.input ? { who: '여신', text: () => `당신의 이름은…… '${player.name}'(이)군요.` } : L)).filter((L, i) => i !== 7 && !L.closet);
  const OP_RENAME = [
    { who: '여신', text: () => `${player.name}님, 부르셨나요?` },
    { who: '여신', text: () => `이름을 바꾸고 싶으신가요? 새 이름을 다시 알려주세요. (남은 변경 ${renamesLeft}번)`, input: true },
    { who: '여신', text: () => `${player.name}님…… 새 이름이 잘 어울려요.` },
  ];
  let OPL = OP_LINES, opMode = 'first';
  const opText = (L) => (typeof L.text === 'function' ? L.text() : L.text);
  function startOpening(mode = 'first') { opMode = mode; OPL = STORY_LINES[mode] ? STORY_LINES[mode].slice() : mode === 'replay' ? OP_REPLAY : mode === 'rename' ? OP_RENAME : OP_LINES; $('opChoice').hidden = true; OP.on = true; OP.i = 0; $('opening').hidden = false; showLine(); cancelAnimationFrame(OP.raf); const loop = (n) => { drawOpening(n / 1000); if (OP.on) OP.raf = requestAnimationFrame(loop); }; OP.raf = requestAnimationFrame(loop); }
  function showLine() {
    const L = OPL[OP.i]; OP.t0 = performance.now(); OP.shown = 0; OP.typing = true;
    $('opWho').textContent = L.who; $('opWho').hidden = !L.who; $('opInput').hidden = true; $('opChoice').hidden = true; $('opNext').hidden = true; $('opening').classList.toggle('devil', !!L.devil);
    if (L.shake) { $('opening').classList.remove('shake'); void $('opening').offsetWidth; $('opening').classList.add('shake'); }
  }
  function tickType() {
    if (!OP.on) return;
    const L = OPL[OP.i]; if (!L) return; const full = opText(L);
    if (OP.typing) { OP.shown = Math.min(full.length, Math.floor((performance.now() - OP.t0) / 45)); if (OP.shown >= full.length) { OP.typing = false; if (L.choice) $('opChoice').hidden = false; else if (L.input) { $('opInput').hidden = false; $('opNick').value = player.name && player.name !== '나' ? player.name : ''; setTimeout(() => $('opNick').focus(), 30); } else $('opNext').hidden = false; } }
    $('opText').textContent = full.slice(0, OP.shown);
  }
  function opAdvance() {
    if (!OP.on || OP.flash) return;
    const L = OPL[OP.i];
    if (OP.typing) { OP.typing = false; OP.shown = opText(L).length; tickType(); if (L.choice) { $('opChoice').hidden = false; return; } if (L.input) { $('opInput').hidden = false; setTimeout(() => $('opNick').focus(), 30); } else $('opNext').hidden = false; return; }
    if (L.input || L.choice) return; // 이름을 정해야 / 편을 골라야 넘어감
    if (L.closet && !OP.closetDone) { OP.closetWait = true; $('nick').value = player.name; $('nickMsg').textContent = ''; renderNameBox(); closetUI(); $('closet').style.zIndex = 70; $('closet').hidden = false; $('btnClosetDone').textContent = '이걸로 할게요 ✓'; $('btnClosetDone').classList.add('wide'); closetPreview(); return; } // 오프닝에서 생김새 고르기
    OP.closetDone = false;
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
    if (STORY_LINES[opMode]) { // 스토리 장면: 그냥 닫고 다음 일
      OP.on = false; $('opening').hidden = true; $('opening').classList.remove('devil'); SND.bgm(BGM_CUR);
      if (opMode === 'frag' && fragAll) { fragAll = false; setTimeout(() => startOpening('reveal'), 500); return; }
      if (opMode === 'reveal') toast(DAY >= SIDE_DAY ? '📜 진실을 알았어요' : `📜 진실을 알았어요 · ${SIDE_DAY}일차에 천사 편과 악마 편 중 하나를 고르게 돼요`);
      setTimeout(maybeDoomPopup, 300); // 밀린 장면(13일차 편 고르기 등)이 있으면 이어서
      return;
    }
    if (opMode === 'rename') { OP.on = false; $('opening').hidden = true; toast(`이름을 '${player.name}'(으)로 바꿨어요 · 남은 변경 ${renamesLeft}번`); return; }
    if (opMode === 'replay') { OP.flash = performance.now(); $('opBox').hidden = true; $('opLogo').hidden = false; setTimeout(() => { OP.on = false; OP.flash = 0; $('opening').hidden = true; $('opLogo').hidden = true; $('opBox').hidden = false; startTitle(); }, 2600); return; }
    OP.flash = performance.now(); $('opBox').hidden = true; $('opLogo').hidden = false;
    setTimeout(() => { OP.on = false; OP.flash = 0; $('opening').hidden = true; $('opLogo').hidden = true; $('opBox').hidden = false; store('mp2026.opened', 1); SND.bgm(BGM_CUR); if (needFound || !ONLINE) openFound('who'); else maybeDoomPopup(); }, 2600);
  }
  $('opening').addEventListener('click', (e) => { if (!e.target.closest('#opInput, #opChoice')) opAdvance(); });
  $('opOk').addEventListener('click', opName);
  $('opAngel').addEventListener('click', (e) => { e.stopPropagation(); pickSide('angel'); });
  $('opDevil').addEventListener('click', (e) => { e.stopPropagation(); pickSide('devil'); });
  $('opLater').addEventListener('click', (e) => { e.stopPropagation(); $('opChoice').hidden = true; finishOpening(); toast('편은 가방(I) → 멸망 조각에서 나중에 고를 수 있어요'); });
  $('bagFrag').addEventListener('click', () => { $('bagBox').hidden = true; openFragBook(); });
  $('fbClose').addEventListener('click', () => { $('fragBook').hidden = true; });
  $('fbSide').addEventListener('click', () => { $('fragBook').hidden = true; startOpening('side'); });
  $('fbConfess').addEventListener('click', () => { $('fragBook').hidden = true; startOpening('confess'); });
  $('opNick').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); opName(); } });
  addEventListener('keydown', (e) => {
    if (!$('gLogin').hidden || !$('rLogin').hidden) { if (!(e.target && e.target.tagName === 'INPUT')) e.stopImmediatePropagation(); return; } // 로그인 창이 떠 있으면 게임 키는 안 먹게
    if (!(TITLE.on || OP.on) || (e.target && e.target.tagName === 'INPUT')) return;
    e.stopImmediatePropagation(); // 타이틀·오프닝 중에는 게임 키(E, 채팅 등)가 안 먹게
    if (TITLE.on && (e.key === 'Enter' || e.key === ' ') && $('coupon').hidden) { e.preventDefault(); endTitle(); return; }
    if (OP.on && OP.closetWait) return; // 생김새 고르는 중
    if (OP.on && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); opAdvance(); }
  }, true);
  // 오프닝 화면: 별이 흐르는 밤하늘 + 빛나는 여신 (후광·날개)
  const opCv = $('opCanvas');
  function drawOpening(t) {
    tickType();
    const W2 = opCv.clientWidth, H2 = opCv.clientHeight; if (opCv.width !== W2 || opCv.height !== H2) { opCv.width = W2; opCv.height = H2; }
    const g = opCv.getContext('2d'); g.imageSmoothingEnabled = false;
    const L = OPL[Math.min(OP.i, OPL.length - 1)], dim = OP.flash ? Math.max(0, 1 - (performance.now() - OP.flash) / 300) : L.dim == null ? 1 : L.dim; // 로고가 나오면 여신은 사라짐
    const grd = g.createLinearGradient(0, 0, 0, H2); grd.addColorStop(0, L.dark ? '#1a0410' : L.memory ? '#100a24' : '#0b0820'); grd.addColorStop(1, L.dark ? '#4a0a1e' : L.memory ? '#3a2266' : '#2a1a4a'); g.fillStyle = grd; g.fillRect(0, 0, W2, H2);
    for (let i = 0; i < 140; i++) { const x = (hash(i, 1, 5) * W2 + t * (6 + hash(i, 2, 5) * 14)) % W2, y = hash(i, 3, 5) * H2 * 0.85, tw = 0.5 + 0.5 * Math.sin(t * 2 + i); g.fillStyle = `rgba(255,${230 + (i % 25)},255,${(0.25 + 0.6 * tw) * Math.max(0.3, dim)})`; g.fillRect(x | 0, y | 0, i % 7 ? 2 : 3, i % 7 ? 2 : 3); }
    const sc = Math.max(4, Math.min(9, Math.floor(H2 / 110))), cx = W2 / 2, cy = H2 * 0.42 + Math.sin(t * 1.6) * 6;
    if (L.devil) { g.save(); g.globalAlpha = dim; drawDevil(g, cx, cy, sc, t); g.restore(); if (OP.flash) { const k = Math.min(1, (performance.now() - OP.flash) / 400); g.fillStyle = `rgba(255,255,255,${1 - k})`; g.fillRect(0, 0, W2, H2); } return; }
    if (L.memory) { const sh = sc * 2.2; g.save(); g.globalAlpha = dim; g.translate(cx, cy); g.rotate(Math.sin(t) * 0.08); const glow2 = g.createRadialGradient(0, 0, 4, 0, 0, sc * 30); glow2.addColorStop(0, 'rgba(200,160,255,0.6)'); glow2.addColorStop(1, 'rgba(200,160,255,0)'); g.fillStyle = glow2; g.fillRect(-sc * 32, -sc * 32, sc * 64, sc * 64); g.fillStyle = '#2b2340'; g.beginPath(); g.moveTo(0, -sh * 7); g.lineTo(sh * 3.5, -sh * 1); g.lineTo(0, sh * 6); g.lineTo(-sh * 3.5, -sh * 1); g.fill(); g.fillStyle = '#9a6aff'; g.beginPath(); g.moveTo(0, -sh * 6); g.lineTo(sh * 2.7, -sh * 1); g.lineTo(0, sh * 5); g.lineTo(-sh * 2.7, -sh * 1); g.fill(); g.fillStyle = '#c9a8ff'; g.beginPath(); g.moveTo(0, -sh * 6); g.lineTo(-sh * 2.7, -sh * 1); g.lineTo(0, sh * 5); g.fill(); g.fillStyle = '#fff'; g.fillRect(-sh * 1.2, -sh * 3, sh * 0.6, sh * 2); g.restore(); return; }
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
      $('doomL').textContent = '';
      $('doomD').innerHTML = `${DAY}일차 <small class="doomTag">☄ 멸망 ${DAY >= LAST_DAY ? 'D-Day' : `D-${LAST_DAY - DAY}`}</small>`; // 선포 뒤엔 일차 옆에 작게만
      $('doomR').textContent = `12/${date} · ${SLOT_NAME[SLOT]}`;
      $('doomFill').style.width = `${Math.round((DAY - DOOM_DAY + 1) / (LAST_DAY - DOOM_DAY + 1) * 100)}%`;
      $('doomBar').hidden = true;
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
