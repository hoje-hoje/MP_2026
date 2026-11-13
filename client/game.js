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
    const e = TILES[y * W + x]; if (e && e.k === 'wall' && e.n !== MY_NID) return true; // 남의 방벽
    return STORE_AT.has(y * W + x);
  }
  // ---- 영지: 설치물(바닥·방벽), 우리 덫, 저장소 자리
  let TILES = {};                 // 칸 번호 -> { k: 'floor'|'wall', n: 나라 }
  let RIFT_SET = new Set();       // 다음 균열에 무너질 영토 (예고)
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
    for (const t of data.territories) { terrs[t.id] = t; t.name = terrName(t); if (!window.MP_ONLINE && t.rift && WAVE_DAY[t.rift] <= DAY) gone[t.id] = 1; }
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
    const names = { k_winter: 'winter/winter.png', k_town: 'kenney/town.png', k_dungeon: 'kenney/dungeon.png', k_onebit: 'kenney/onebit.png', water: 'na/water.png', floor: 'ninja/floor.png', village: 'ninja/village.png', chars: 'na/chars.png', faces: 'na/faces.png', towers: 'na/towers.png', flags: 'na/flags.png' };
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
        if (og > 0 && gone[og]) { // 균열에 삼켜진 땅: 보라색으로 오염된 바닥 + 빛나는 금 + 독웅덩이
          g.fillStyle = ['#2a1040', '#321450', '#26103c', '#2e1248'][(h * 4) | 0]; g.fillRect(px, py, TILE, TILE);
          for (let k = 0; k < 6; k++) { const hh = hash(x * 7 + k, y * 3, 51); g.fillStyle = hh > 0.5 ? '#3d1860' : '#1e0b30'; g.fillRect(px + ((hh * 16) | 0) * 2, py + ((hash(x, y * 5 + k, 52) * 16) | 0) * 2, 4, 2); }
          if (h < 0.22) { // 갈라진 금 (자홍색으로 빛남)
            let cx = px + 4 + ((h * 97) % 1) * 24 | 0, cy = py + 2; g.fillStyle = '#c040ff';
            for (let k = 0; k < 7; k++) { g.fillRect(cx, cy, 2, 4); cx += ((hash(x, y, 60 + k) * 3) | 0) * 2 - 2; cy += 4; }
            g.fillStyle = 'rgba(255,140,255,0.6)'; g.fillRect(px + 4 + ((h * 97) % 1) * 24 | 0, py + 2, 1, 4);
          } else if (h < 0.32) { g.fillStyle = '#16061f'; g.fillRect(px + 6, py + 12, 20, 10); g.fillRect(px + 9, py + 10, 14, 14); g.fillStyle = '#7a2bb8'; g.fillRect(px + 10, py + 13, 6, 2); } // 독웅덩이
          const alive = (a, b) => { const q = terrAt(a, b); return q >= 0 && !gone[q] && tileAt(a, b) !== T.VOID; };
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
        { const e = TILES[y * W + x]; if (e && e.k === 'floor') g.drawImage(floorArt(e.c | 0), px, py, TILE, TILE); }
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
        { x: 13, y: 6, w: 4, h: 1, walk: true, draw: (g, x, y) => { if (!DOOM) return; g.fillStyle = '#5a4630'; g.fillRect(x - 140, y - 150, 8, 150); g.fillRect(x + 132, y - 150, 8, 150); drawDoomBanner(g, x, y - 176, 1.5); } }, // 멸망 게시판 (기둥 두 개에 걸린 배너)
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
    plaza: { // 넓은 구름 광장: 가운데 분수 광장, 네 귀퉁이 꽃밭, 위쪽 이벤트 무대
      name: '구름 광장', desc: '모여서 노는 곳 · 이벤트가 열리는 곳', w: 56, h: 34, pos: [1, 0], crowd: 24,
      floor: 'lawn', trim: '#4bb3c4',
      patches: [[26, 2, 4, 31, 'cobble', 0], [3, 16, 50, 3, 'cobble', 0], [17, 11, 22, 12, 'floor_palace', 30], [4, 4, 13, 7, 'meadow', 22], [39, 4, 13, 7, 'meadow', 22], [4, 23, 13, 7, 'meadow', 22], [39, 23, 13, 7, 'meadow', 22], [20, 3, 16, 5, 'planks', 6]],
      emotes: ['3팀 모여~', 'ㅋㅋㅋ', '안녕!', '이벤트 언제?', '같이 다닐 사람', '우리 나라 짱', '분수 예쁘다', '무대 올라가 봐'],
      doors: [{ side: 'S', at: 28, to: 'temple' }, { side: 'N', at: 28, to: 'wander' }],
      props: [
        { x: 21, y: 3, w: 14, h: 2, draw: plazaStage },
        { x: 26, y: 15, w: 4, h: 3, draw: (g, x, y) => { pix(g, 'pool', x, y + 8, 3); } },
        { x: 20, y: 13, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_orb', x, y + 4, 2) }, { x: 35, y: 13, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_orb', x, y + 4, 2) },
        { x: 20, y: 20, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_orb', x, y + 4, 2) }, { x: 35, y: 20, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_orb', x, y + 4, 2) },
        ...[[24, 9], [31, 9], [24, 25], [31, 25], [24, 29], [31, 29]].map(([x, y]) => ({ x, y, w: 1, h: 1, draw: (g, X, Y) => pix(g, 'candelabra', X, Y + 2) })),
        { x: 9, y: 16, w: 2, h: 1, draw: bonfire },
        ...[[7, 15], [12, 15], [7, 18], [12, 18]].map(([x, y]) => ({ x, y, w: 1, h: 1, draw: (g, X, Y) => pix(g, 'log', X, Y + 2, 2) })),
        { x: 45, y: 16, w: 2, h: 1, draw: smallTable }, { x: 43, y: 16, w: 1, h: 1, draw: (g, x, y) => pix(g, 'stump', x, y + 2, 3) }, { x: 48, y: 16, w: 1, h: 1, draw: (g, x, y) => pix(g, 'stump', x, y + 2, 3) },
        ...gardenProps(4, 4), ...gardenProps(39, 4), ...gardenProps(4, 23), ...gardenProps(39, 23),
        { x: 8, y: 7, w: 1, h: 1, walk: true, draw: (g, x, y) => pix(g, 'u:chick', x, y + 2, 2) }, { x: 44, y: 8, w: 1, h: 1, walk: true, draw: (g, x, y) => pix(g, 'u:rabbit', x, y + 2, 2) },
        { x: 10, y: 26, w: 1, h: 1, walk: true, draw: (g, x, y) => pix(g, 'u:hen', x, y + 2, 2) }, { x: 46, y: 27, w: 2, h: 1, walk: true, draw: (g, x, y) => pix(g, 'u:pig', x, y + 2, 2) },
        { x: 2, y: 2, w: 1, h: 1, walk: true, draw: (g, x, y) => pix(g, 'cloud', x + 20, y + 20, 0, 60, 0.9) }, { x: 53, y: 2, w: 1, h: 1, walk: true, draw: (g, x, y) => pix(g, 'cloud', x - 10, y + 20, 0, 60, 0.9) },
        { x: 2, y: 31, w: 1, h: 1, walk: true, draw: (g, x, y) => pix(g, 'cloud', x + 20, y + 10, 0, 56, 0.9) }, { x: 53, y: 31, w: 1, h: 1, walk: true, draw: (g, x, y) => pix(g, 'cloud', x - 10, y + 10, 0, 56, 0.9) },
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
    wander: { // 유랑민 캠프: 등록 창구, 모집 게시판, 천막과 모닥불
      name: '유랑민 등록소', desc: '나라 없는 사람이 귀화·용병·건국을 등록하는 곳', w: 32, h: 18, pos: [1, -1], crowd: 8,
      floor: 'lawn', trim: '#3fa37a',
      patches: [[14, 4, 5, 14, 'cobble', 0], [2, 8, 10, 8, 'meadow', 18], [21, 8, 9, 8, 'meadow', 18], [11, 2, 10, 3, 'planks', 6]],
      emotes: ['용병 구합니다', '귀화시켜 주세요', '우리 4명 모이면 건국함', '몸값 얼마?', '어느 나라가 좋음?', '여기 따뜻하다'],
      doors: [{ side: 'S', at: 16, to: 'plaza' }],
      props: [
        { x: 13, y: 2, w: 6, h: 2, board: true, desk: 'wander', draw: (g, x, y) => { pix(g, 'cabin', x, y + 6, 3); sign(g, x, y - 132, '등록 창구'); } },
        { x: 11, y: 4, w: 1, h: 1, draw: (g, x, y) => { pix(g, 'keeper', x, y + 2); nameTag(g, x, y - 58, '등록 담당', '#277a58'); } },
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
  const BASE_PATS = ['holy', 'holy_edge', 'wall', 'void', 'lawn', 'meadow', 'cobble', 'planks', 'stonefloor', 'carpet', 'grass', 'dirt', 'marble', 'floor_palace', 'brick'];
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
  // 물 타일: 시트 그림에서 물빛(파랑) 픽셀이 30% 넘는 칸 → 깔면 못 지나감 (선착장·배·얼음 무늬 없는 칸은 통과)
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
          const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx ? (mx - mn) / mx : 0; if (mx < 0.45 || sat < 0.25 || mx === mn) continue;
          let h = mx === r ? ((gg - b) / (mx - mn)) % 6 : mx === gg ? (b - r) / (mx - mn) + 2 : (r - gg) / (mx - mn) + 4; h = ((h * 60) + 360) % 360 / 360;
          if (h >= 0.47 && h <= 0.6) wet++;
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
    for (const [cx, cy, cw, ch] of R.carpets || []) { g.fillStyle = pat('carpet'); g.fillRect(cx * TILE, cy * TILE, cw * TILE, ch * TILE); }
    for (const [px, py, pw, ph, key, rad] of R.patches || []) { g.fillStyle = pat(key); rr(g, px * TILE, py * TILE, pw * TILE, ph * TILE, rad || 0); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3; g.beginPath(); g.roundRect ? g.roundRect(px * TILE, py * TILE, pw * TILE, ph * TILE, rad || 0) : g.rect(px * TILE, py * TILE, pw * TILE, ph * TILE); g.stroke(); } // 꽃밭·길·광장 바닥
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

  function drawSkyBackground(t) {
    if (ONLINE && SLOT === 'night') { drawStarSky(t); return; }
    const grd = ctx.createLinearGradient(0, 0, 0, vh);
    grd.addColorStop(0, DOOM ? '#cbb6ee' : '#a9dcff'); grd.addColorStop(1, DOOM ? '#ffd2dc' : '#fdf3ff');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, vw, vh);
    for (let i = 0; i < 9; i++) {
      const x = ((i * 337 + t * (8 + i * 2)) % (vw + 400)) - 200, y = (i * 173) % Math.max(1, vh);
      pix(ctx, 'cloud', x, y + 60, 0, 70 + (i % 3) * 30, 0.85);
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
    for (let i = 0; i < 6; i++) { const x = ((i * 337 + t * (5 + i)) % (vw + 400)) - 200, y = (i * 173) % Math.max(1, vh); pix(ctx, 'cloud', x, y + 60, 0, 70 + (i % 3) * 30, 0.25); }
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
    if ((k === '[' || k === ']') && !ONLINE) { location.hash = 'day' + Math.max(1, Math.min(15, DAY + (k === ']' ? 1 : -1))); }
    if (k === 'escape') { $('bigmap').hidden = true; $('closet').hidden = true; $('coupon').hidden = true; $('wanderBox').hidden = true; $('war').hidden = true; $('puzzle').hidden = true; $('storeBox').hidden = true; $('shopBox').hidden = true; if (build.on) setBuild(false); }
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
        let n = null, nd = 52; for (const q of nodes) { const d = Math.hypot(q.x - player.x, q.y - player.y); if (d < nd) { nd = d; n = q; } }
        for (const [i] of STORE_AT) if (n && Math.hypot((i % W) * TILE + 16 - player.x, Math.floor(i / W) * TILE + 16 - player.y) < nd) n = null; // 저장소가 더 가까우면 저장소
        if (t.portal && Math.hypot(t.portal[0] + 0.5 - tx, t.portal[1] + 0.5 - ty) < 1.8) best = { kind: 'portal', t, text: '하늘로 올라가기' };
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
    const [fx, fy] = facingTile(), i = fy * W + fx, e = TILES[i];
    if (build.on && myView && build.moving) { // 옮기는 중: 앞 칸에 놓기
      return { kind: 'dropB', x: fx, y: fy, text: `여기에 ${build.moving.kind === 'store' ? '저장소' : '금광'} 놓기 (E) · 취소는 G` };
    }
    if (build.on && myView) { // 우리 저장소·우리 땅 금광 옆이면 옮기기
      for (const [i, nid] of STORE_AT) if (nid === MY_NID && Math.hypot((i % W) + 0.5 - ptx, Math.floor(i / W) + 0.5 - pty) < 1.9) return { kind: 'pickB', what: { kind: 'store' }, text: '저장소 옮기기 (E) → 옮길 자리에서 E' };
      for (const q of nodes) if (ownerOf(q.id) === MY_NID && Math.hypot(q.tx + 0.5 - ptx, q.ty + 0.5 - pty) < 1.6) return { kind: 'pickB', what: { kind: 'mine', terr: q.id }, text: '금광 옮기기 (E) → 옮길 자리에서 E' };
    }
    if (build.on && myView) {
      const tiles = shapeTiles(), shape = build.k === 'trap' ? '1' : build.shape;
      if ((e && e.n === MY_NID && !(build.k === 'floor' && e.k === 'floor' && (e.c | 0) !== build.c)) || MY_TRAPS.has(i)) return { kind: 'pickup', tiles, text: `${SHAPE_NAME[shape]} 거두기 (E) · 바로 앞: ${ITEM_NAME[e ? e.k : 'trap']}` };
      if (ownerOf(terrAt(fx, fy)) !== MY_NID) return { kind: 'info', text: '설치 모드 · 우리 땅에만 놓을 수 있어요' };
      return { kind: 'place', tiles, text: `${build.k === 'floor' ? FLOOR_COLORS[build.c][0] + ' ' : ''}${ITEM_NAME[build.k]} ${SHAPE_NAME[shape]} 놓기 · 남은 ${myView.me.items[build.k]}개` };
    }
    if (MY_NID) for (const [id, r] of remotes) { // 우리 땅에 들어온 적 → 체포
      if (r.x == null || !r.nid || r.nid === MY_NID || Math.hypot(r.x - player.x, r.y - player.y) > 52) continue;
      if (ownerOf(terrAt(r.x / TILE | 0, r.y / TILE | 0)) === MY_NID) return { kind: 'arrest', id, text: `${r.name}${r.carry ? ' (도둑!)' : ''} 체포하기` };
    }
    if (MY_NID && myView) for (const b of BATTLES) { // 우리 전투의 전선 근처 → 병력 충원
      if (!b.f || (b.att !== MY_NID && b.def !== MY_NID)) continue;
      for (let k = 0; k < 3; k++) {
        if (Math.hypot(b.f[k][0] + 0.5 - ptx, b.f[k][1] + 0.5 - pty) > MPRules.NUM.frontRange) continue;
        const o = myView.outgoing.find((x) => x.id === b.id), inc = myView.incoming.find((x) => x.id === b.id);
        const cur = o ? `지금 ${o.a[k]}` : inc ? (inc.d ? `지금 ${inc.d[k] + inc.rd[k]}` : `자동 배치 + 충원 ${inc.rd[k]}`) : '';
        return { kind: 'reinforce', battle: b.id, front: k, text: `${'ABC'[k]} 전선 ${b.att === MY_NID ? '공격' : '방어'} 병력 충원 +${MPRules.NUM.reinforce} · ${cur}` };
      }
    }
    for (const [i, nid] of STORE_AT) if (Math.hypot((i % W) + 0.5 - ptx, Math.floor(i / W) + 0.5 - pty) < 1.9) {
      if (nid === MY_NID) return player.carry ? { kind: 'deposit', text: '훔쳐 온 것 저장소에 넣기' } : { kind: 'store', text: '우리 저장소 열기' };
      if (!MY_NID) return { kind: 'info', text: `${natName(nid)} 저장소` };
      if (player.carry) return { kind: 'info', text: '이미 훔친 걸 들고 있어요 · 우리 저장소로!' };
      return { kind: 'steal', nid, hold: MPRules.NUM.stealSec * 1000, text: `${natName(nid)} 저장소 털기 · E 꾹 ${MPRules.NUM.stealSec}초` };
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
  const build = { on: false, k: 'floor', shape: '1', c: 0 };
  const SHAPE_NAME = { 1: '1칸', h3: '가로 3칸', v3: '세로 3칸', s3: '3×3' };
  // 설치 모양: 바라보는 방향으로는 앞으로 뻗고, 옆 방향은 가운데 맞춤
  function shapeTiles() {
    const d = FACE_D[player.face | 0] || [0, 1], [fx, fy] = facingTile();
    const shape = build.k === 'trap' ? '1' : build.shape;
    const wx = shape === 'h3' || shape === 's3' ? 3 : 1, wy = shape === 'v3' || shape === 's3' ? 3 : 1;
    const xs = wx === 1 ? [fx] : d[0] ? [0, 1, 2].map((k) => fx + k * d[0]) : [fx - 1, fx, fx + 1];
    const ys = wy === 1 ? [fy] : d[1] ? [0, 1, 2].map((k) => fy + k * d[1]) : [fy - 1, fy, fy + 1];
    const out = []; for (const y of ys) for (const x of xs) out.push([x, y]); return out;
  }
  function setBuild(on, k) {
    if (on && !myView) { toast('나라가 있어야 설치할 수 있어요'); return; }
    if (on && player.scene === 'sky') { toast('설치 모드는 땅에서만 쓸 수 있어요'); return; }
    build.on = on; if (k) build.k = k; if (!on) build.moving = null;
    $('buildBar').hidden = !on;
    for (const b of document.querySelectorAll('#buildBar [data-k]')) { b.setAttribute('aria-pressed', String(b.dataset.k === build.k)); b.querySelector('small').textContent = myView ? myView.me.items[b.dataset.k] : 0; }
    for (const b of document.querySelectorAll('#buildBar [data-shape]')) { b.setAttribute('aria-pressed', String(b.dataset.shape === build.shape)); b.disabled = build.k === 'trap'; }
    for (const b of document.querySelectorAll('#buildBar [data-c]')) b.setAttribute('aria-pressed', String(+b.dataset.c === build.c));
    $('buildColors').hidden = build.k !== 'floor';
    near = null;
  }
  for (const b of document.querySelectorAll('#buildBar [data-shape]')) b.addEventListener('click', () => { build.shape = b.dataset.shape; setBuild(true); });
  $('buildColors').innerHTML = FLOOR_COLORS.map(([name, col], i) => `<button type="button" data-c="${i}" title="${name}" style="background:${col || '#9a958c'}">${name}</button>`).join('');
  for (const b of document.querySelectorAll('#buildBar [data-c]')) b.addEventListener('click', () => { build.c = +b.dataset.c; setBuild(true); });
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
    if (near.kind === 'pickB') { build.moving = near.what; near = null; toast('옮길 자리 바로 앞에서 E를 누르세요 (우리 땅, 다른 건물과 2칸 이상)'); return; }
    if (near.kind === 'dropB') { if (netOn) ws.send(JSON.stringify(Object.assign({ t: 'moveB', x: near.x, y: near.y }, build.moving))); build.moving = null; near = null; return; }
    if (near.kind === 'place' || near.kind === 'pickup') { if (netOn) ws.send(JSON.stringify({ t: near.kind, tiles: near.tiles, k: build.k, c: build.c })); return; }
    if (near.kind === 'info') { toast(near.text); return; }
    if (near.kind === 'reinforce') { if (netOn) ws.send(JSON.stringify({ t: 'reinforce', battle: near.battle, front: near.front })); return; }
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
        if (m.roomEdits) for (const [id, e] of Object.entries(m.roomEdits)) applyRoomEdit(id, e);
        if (m.groundEdits) { GFLOOR.clear(); GWALL.clear(); GCLEAR.clear(); GPROPS.clear(); applyGroundEdit({ set: m.groundEdits.floor, walls: m.groundEdits.walls, clear: m.groundEdits.clear, props: m.groundEdits.props }); invalidateChunks(); mapSig = ''; }
        if (m.clock) setClock(m.clock); BATTLES = m.battles || []; applyMines(m.mines || {}); TILES = m.tiles || {}; MY_TRAPS = new Set(m.traps || []); for (const i of m.chopped || []) noTree[i] = 1; if (m.stun) stunUntil = performance.now() + m.stun;
        testMode = !!m.testMode; foundingOpen = m.foundingOpen !== false; applyWorld(m.owners, m.nations, m.view || null); showNotice(m.notice); unseenBattles();
        if (!m.view) openFound('who'); else $('found').hidden = true;
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
      case 'owners': if ('riftNext' in m) { RIFT_NEXT = m.riftNext; RIFT_SET = new Set(RIFT_NEXT ? RIFT_NEXT.terrs : []); } if (m.gone) setGone(m.gone); if (m.battles) BATTLES = m.battles; if (m.mines) applyMines(m.mines); applyWorld(m.owners, m.nations); if (!$('found').hidden && foundSel !== undefined && !document.querySelector('#found [data-step=found]').hidden) drawFoundMap(); break;
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
      case 'clock': setClock(m); break;
      case 'roomEdit': if (m.diff) applyRoomDiff(m.id, m.diff); else applyRoomEdit(m.id, m.edit); break;
      case 'groundEdit': applyGroundEdit(m); break;
      case 'rift': toast(m.text); break;
      case 'hitn': HITN.set(m.terr, { n: m.n, at: performance.now() }); near = null; break;
      case 'scout': HITN.delete(m.terr); toast(m.text); break;
      case 'stun': stunUntil = performance.now() + m.ms; step.on = false; toast(m.text); break;
      case 'pos': player.x = m.x; player.y = m.y; step.on = false; netTp = true; break;
      case 'mined': mined.add(m.terr); toast(m.text); break;
      case 'warp': { const p = m.pos; if (p.scene === 'sky' && ROOMS[p.room]) { player.scene = 'sky'; player.room = ROOMS[p.room]; if (build.on) setBuild(false); } else { player.scene = 'ground'; player.room = null; } player.x = p.x; player.y = p.y; step.on = false; hold.on = false; fadeT = 0.35; lastTerr = null; break; }
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
  function hideLoading() { const L = $('loading'); if (L.hidden) return; L.classList.add('out'); setTimeout(() => { L.hidden = true; L.classList.remove('out'); }, 250); }
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
  let owners = {}, nationsPub = {}, myView = null, testMode = true, MY_NID = null, mapSig = ''; // MY_NID: 우리 나라 (지도에서 진하게 표시)
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
    for (const n of Object.values(nationsPub)) if (!n.dead && terrs[n.capital]) { const [sx, sy] = n.store || MPRules.storageSpot(terrs[n.capital], tileAt); STORE_AT.set(sy * W + sx, n.id); clearTrees(sx, sy, 1); }
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
    else if (t === 'defaultDef') r = OFF.setDefault(OFF_ME, payload.ratio);
    else if (t === 'intel') r = OFF.useIntel(OFF_ME, payload.battle);
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
  function nextFight() { if (ONLINE) return SLOT === 'morning' ? '오늘 점심 1시' : SLOT === 'lunch' ? '오늘 밤 10시' : '내일 점심 1시'; const h = new Date(Date.now() + 9 * 3600e3).getUTCHours(); return h < 13 ? '오늘 13시' : h < 22 ? '오늘 22시' : '내일 13시'; }
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
      if (RIFT_NEXT) {
        const mineR = RIFT_NEXT.terrs.filter((tid) => owners[tid] === me.id);
        h += `<div class="plan"><h3>🌀 다음 균열 · ${RIFT_NEXT.day}일차 아침 (${RIFT_NEXT.wave}차)</h3><p class="msg">지도에서 보라색으로 일렁이는 땅이 무너져요. 수도는 안전하고, 백신을 쓴 땅도 이번엔 버텨요. 백신 ${me.vaccine}개 (하늘 거래소)</p>` +
          (mineR.length ? mineR.map((tid) => `<div class="row"><span>${esc(terrLabel(tid))}</span>${tid === me.capital ? '<span>수도라 안전</span>' : (me.vaxed || []).includes(tid) ? '<span>💉 백신 맞음</span>' : `<button data-vax="${tid}">백신 쓰기</button>`}</div>`).join('') : '<p class="msg">이번 균열에 무너질 우리 땅은 없어요.</p>') + '</div>';
      }
      h += `<h3>나라 정보</h3><div class="msg">수도 ${esc(terrLabel(me.capital))} · 영토 ${me.territories}곳 · 병력 ${me.army} · 행동력 ${me.actions}</div>`;
    } else if (warTab === 'attack') {
      const mineSet = new Set(Object.keys(owners).filter((k) => owners[k] === me.id).map(Number));
      const targets = [];
      for (const tid of mineSet) for (const nb of terrs[tid].neighbors) if (owners[nb] && owners[nb] !== me.id && !gone[nb] && !targets.includes(nb)) targets.push(nb);
      if (v.outgoing.length) h += `<h3>${nextFight()} 전투 · 우리 공격</h3><p class="msg">지도의 빨간 A·B·C 전선 근처에 가서 E를 누르면 그 전선에 병력이 ${MPRules.NUM.reinforce}씩 더해져요 (국민 누구나)</p>` + v.outgoing.map((b) => `<div class="row"><span>⚔ ${esc(terrLabel(b.target))} <i style="color:${natColor(b.def)}">${esc(natName(b.def))}</i> · ${b.a.join(' / ')}</span>${king ? `<button data-cancel="${b.id}">취소</button>` : ''}</div>`).join('');
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
      const dd = me.defaultDef || [34, 33, 33];
      h += `<div class="plan"><h3>기본 방어 비율</h3><p class="msg">방어 배치를 못 하고 전투 시각이 되면, 그때 병력을 이 비율로 A·B·C에 나눠요.</p>
        <div class="fronts">${['A', 'B', 'C'].map((f, i) => `<label class="front"><span>${f} %</span><input id="dd${i}" type="number" min="0" max="100" value="${dd[i]}" ${king ? '' : 'disabled'}></label>`).join('')}</div>
        ${king ? '<div class="row"><span>' + (me.defaultDef ? '저장된 비율이 있어요' : '아직 없음 (지난 배치나 균등으로 나눠요)') + '</span><button id="btnDefault">기본 비율 저장</button></div>' : ''}</div>`;
      h += `<p class="msg">🔍 첩보: 아무 나라용 ${me.intelAny}장${Object.keys(me.intel || {}).filter((k) => me.intel[k] > 0).map((k) => ` · ${esc(natName(k))} 전용 ${me.intel[k]}장`).join('')} — 적 수정을 10번 때리거나 점심 쿠폰으로 얻어요</p>`;
      h += `<h3>${nextFight()} 전투 · 우리 땅을 노리는 공격 (${v.incoming.length})</h3>`;
      if (!v.incoming.length) h += '<p class="msg">지금은 공격받는 곳이 없어요.</p>';
      h += v.incoming.map((b) => `<div class="plan"><div class="row"><span>🛡 ${esc(terrLabel(b.target))} ← <i style="color:${natColor(b.att)}">${esc(natName(b.att))}</i>${nationsPub[me.id] && me.capital === b.target ? ' · <b>수도!</b>' : ''}</span><span>${b.d ? '배치 완료' : '<b>미배치</b> (안 하면 자동 배치)'}</span></div>
        ${b.rev && b.rev.length ? `<p class="msg">🔍 알아낸 적 병력: ${b.rev.map((r) => `<b>${'ABC'[r.f]} 전선 ${r.n}명</b>`).join(' · ')}</p>` : ''}
        ${b.rd && (b.rd[0] + b.rd[1] + b.rd[2]) ? `<p class="msg">전선에서 충원한 병력: A +${b.rd[0]} · B +${b.rd[1]} · C +${b.rd[2]}</p>` : ''}
        <div class="row"><span>전선 위치는 지도에 빨갛게 · 가까이 가서 E로 충원</span>${b.intel > 0 && (!b.rev || b.rev.length < 3) ? `<button data-intel="${b.id}">첩보 쓰기 (${b.intel}장)</button>` : ''}</div>
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
    for (const b of box.querySelectorAll('[data-vax]')) b.onclick = () => warAction('vaccinate', { terr: +b.dataset.vax });
    for (const b of box.querySelectorAll('[data-intel]')) b.onclick = () => warAction('intel', { battle: +b.dataset.intel });
    if ($('btnDefault')) $('btnDefault').onclick = () => warAction('defaultDef', { ratio: [0, 1, 2].map((i) => Math.max(0, parseInt($('dd' + i).value, 10) || 0)) });
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
    if (player.scene === 'sky' && player.room.id !== 'jail' && !EDIT.on) {
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
      $('skyTimer').hidden = !sky || EDIT.on;
      if (sky && player.room.id === 'jail') { const l = Math.max(0, Math.ceil((jailUntil - Date.now()) / 1000)); $('skyTimer').firstChild.textContent = '감옥 '; $('skyLeft').textContent = `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`; $('skyTimer').classList.remove('warn'); }
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
    const camX = player.x - vw / 2 / zoom, camY = player.y - 40 - vh / 2 / zoom;
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
      if (e && e.k === 'wall') list.push({ x: tx * TILE + 16, y: ty * TILE + 30, draw: (g, X, Y) => drawWall(g, X, Y, e.n) });
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
        g.font = `700 14px ${PFONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText('ABC'[k], X + 13, Y - 54);
        if (b.att === MY_NID || b.def === MY_NID) sign(g, X, Y - 84, `${'ABC'[k]} 전선 · 충원 E`);
      } });
    });
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
    if (!DOOM || store('mp2026.doomSeen') === DAY) return;
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
    else { hideLoading(); openFound('who'); }
    if (ONLINE && /[?&]edit=1/.test(location.search)) setTimeout(startEditor, 1200);
    if (DAY === 5) setTimeout(() => toast('신들이 선포했다: 12월 28일, 이 세계는 끝난다.'), 600);
    else if (DOOM) { const n = terrs.filter((t) => t && gone[t.id]).length; if (n) setTimeout(() => toast(`균열이 영토 ${n}곳을 삼켰다`), 600); }
    requestAnimationFrame((n) => { last = n; frame(n); });
  }).catch((err) => {
    $('loadingText').textContent = '지도를 불러오지 못했어요';
    $('loadingSub').textContent = err.message;
  });
})();
