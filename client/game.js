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
    return t === T.VOID || t === T.HOLY || t === T.WATER || t === T.MOUNTAIN || t === T.WALL || solid[y * W + x] === 1;
  }
  function speedAt(x, y) { const t = tileAt(x, y); return t === T.FOREST ? 0.7 : t === T.SAND ? 0.85 : 1; }

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
    g.drawImage(altarSheet(t.type), f * 32, 0, 32, 32, x - 32, y - 60, 64, 64);
    g.imageSmoothingEnabled = prev;
  }

  function drawFlag(g, x, y, mine) {
    const f = Math.floor(performance.now() / 160) % 4;
    const prev = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    g.drawImage(ART.flags, f * 16, (mine ? 1 : 0) * 16, 16, 16, x - 20, y - 46, 48, 48);
    g.imageSmoothingEnabled = prev;
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

  // ------------------------------------------------------------ 그림 (Ninja Adventure, CC0)
  const ART = {};
  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('그림 파일을 불러오지 못했어요: ' + src)); i.src = src; }); }
  async function loadArt() {
    const names = { floor: 'ninja/floor.png', village: 'ninja/village.png', chars: 'na/chars.png', faces: 'na/faces.png', towers: 'na/towers.png', flags: 'na/flags.png' };
    const meta = fetch('assets/na/chars.json').then((r) => r.json()).then((j) => { CHARS.cols = j.cols; CHARS.names = j.names; });
    for (const k of EXTRA) names['x_' + k] = 'extra/' + k + '.png';
    for (const k of TEMPLE) names['x_' + k] = 'na/' + k + '.png';
    await Promise.all([meta, ...Object.entries(names).map(async ([k, f]) => { ART[k] = await loadImg('assets/' + f); })]);
  }
  const EXTRA = ['coin', 'cloud', 'burst', 'pin', 'tower', 'marble', 'stonefloor', 'carpet', 'grass', 'dirt', 'pillar', 'candelabra', 'rosewin', 'tomb', 'altar', 'book', 'candles', 'chalice', 'key', 'bishop', 'keeper', 'tent', 'cabin', 'campfire', 'woodpile', 'log', 'boulder', 'boulder_sm', 'flower_r', 'flower_y', 'mushroom', 'fern', 'stump', 'berry'];
  const TEMPLE = ['statue_orb', 'statue_lion', 'pillar_na', 'plant', 'arch', 'pool', 'floor_palace', 'brick', 'banner0', 'banner1', 'banner2', 'banner3', 'banner4', 'banner5', 'banner6'];
  // 픽셀 그림 하나를 '바닥 가운데'에 맞춰 그린다. k: 배율 / fitH: 높이(px)에 맞추기 (큰 그림용)
  function pix(g, key, cx, bottom, k = 2, fitH = 0, alpha = 1) {
    const im = ART['x_' + key]; if (!im) return;
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
    grass: [[11, 12], [11, 12], [11, 12], [11, 12], [11, 12], [11, 12], [11, 12], [11, 12], [11, 12], [12, 12], [13, 12], [14, 12]],
    forest: [[0, 12], [0, 12], [0, 12], [1, 12], [2, 12], [3, 12]],
    sand: [[0, 5], [0, 5], [0, 5], [1, 5], [2, 5], [3, 5]],
    water: [[1, 22]],
    rock: [[13, 16]],
  };
  function tile(g, list, h, px, py) { const [cx, cy] = list[(h * list.length) | 0]; g.drawImage(ART.floor, cx * 16, cy * 16, 16, 16, px, py, TILE, TILE); }
  // 큰 그림 (village.png 잘라 쓰기): [x, y, w, h]
  const SP = { treeA: [0, 96, 64, 48], treeB: [0, 144, 64, 48], midA: [64, 96, 32, 32], midB: [64, 144, 32, 32], stone: [112, 80, 32, 32], bush: [64, 78, 32, 18], house: [192, 97, 64, 79], house2: [256, 96, 64, 70] };
  function spr(g, name, cx, bottom, k = 2) { const [x, y, w, h] = SP[name]; g.drawImage(ART.village, x, y, w, h, Math.round(cx - w * k / 2), Math.round(bottom - h * k), w * k, h * k); }

  // 캐릭터: 16px 칸, 열 = 방향(아래·위·왼쪽·오른쪽), 행 = 걷기 프레임. 팀/꾸미기 색은 색상 회전으로.
  const CHARS = { cols: 10, names: ['NinjaBlue'] };   // assets/na/chars.json
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
    g.fillStyle = 'rgba(0,0,0,0.22)'; ell(g, x, y, 15, 5);
    if (look.me) { g.strokeStyle = '#ffd23f'; g.lineWidth = 2; g.setLineDash([5, 4]); g.beginPath(); g.ellipse(x, y, 20, 7, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
    const sheet = charSheet(look.char | 0, look.hue | 0);
    const row = moving ? (Math.floor(t * 8 + (look.seed || 0)) % 4) : 0;
    const prev = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    g.drawImage(sheet, (face | 0) * 16, row * 16, 16, 16, Math.round(x - 8 * CH_K), Math.round(y - 16 * CH_K + 2), 16 * CH_K, 16 * CH_K);
    g.imageSmoothingEnabled = prev;
  }
  const faceOf = (dx, dy, prev) => (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) ? prev : (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy < 0 ? 1 : 0));

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
            tile(g, TL.water, h, px, py);
            g.fillStyle = '#eaf7ff';
            const land = (a, b) => { const q = tileAt(a, b); return q !== T.WATER && q !== T.VOID; };
            if (land(x, y - 1)) g.fillRect(px, py, TILE, 4);
            if (land(x, y + 1)) g.fillRect(px, py + TILE - 4, TILE, 4);
            if (land(x - 1, y)) g.fillRect(px, py, 4, TILE);
            if (land(x + 1, y)) g.fillRect(px + TILE - 4, py, 4, TILE);
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
        // 영토 색 은은하게 + 국경선
        const o = terrAt(x, y);
        if (o > 0 && t !== T.WATER && t !== T.MOUNTAIN) {
          const [r, gg, b] = TYPE_RGB[terrs[o].type];
          g.fillStyle = `rgba(${r},${gg},${b},0.07)`; g.fillRect(px, py, TILE, TILE);
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
    for (let y = y0 - 1; y < y0 + CHUNK + 4; y++) {
      for (let x = x0 - 3; x < x0 + CHUNK + 3; x++) {
        const t = tileAt(x, y), h = hash(x, y, 7);
        const px = (x - x0) * TILE, py = (y - y0) * TILE;
        const og = terrAt(x, y);
        if (og > 0 && gone[og]) continue;
        if (t === T.FOREST) {
          if (h < 0.07 && (x + y) % 3 === 0) spr(g, h < 0.035 ? 'treeA' : 'treeB', px + 16, py + 30);
          else if (h < 0.26 && (x + 2 * y) % 2 === 0) spr(g, h < 0.17 ? 'midA' : 'midB', px + 16, py + 30);
          else if (h < 0.29) pix(g, h < 0.275 ? 'stump' : 'berry', px + 16, py + 30);
        } else if (t === T.GRASS) {
          if (h < 0.004) spr(g, 'midA', px + 16, py + 30);
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

  // ------------------------------------------------------------ 하늘 (신들의 땅, 중립 지역, 방으로 나뉨)
  // 각 나라 수도의 포털로 올라오고, 내려갈 땐 올라온 포털(=자기 나라 수도)로만 내려간다.
  const ROOMS = {
    temple: {
      name: '하늘 신전', desc: '신들의 공지 · 신탁 제단 · 멸망의 탑', w: 30, h: 18, pos: [1, 1], crowd: 10,
      floor: 'floor_palace', wall: true, carpets: [[13, 2, 4, 16], [2, 7, 26, 3]], trim: '#e2b93b',
      emotes: ['신탁 봤어?', '오늘 공지 뭐임', '!', '?', '내일 어디 무너짐?', '탑이 빛난다'],
      doors: [{ side: 'W', at: 8, to: 'market' }, { side: 'E', at: 8, to: 'council' }, { side: 'N', at: 15, to: 'plaza' }, { side: 'S', at: 15, to: 'ground' }],
      props: [
        { x: 13, y: 3, w: 4, h: 3, draw: (g, x, y) => { pix(g, 'tower', x, y + 8, 0, 230); if (DOOM) pix(g, 'burst', x, y - 150, 0, 60 + Math.sin(performance.now() / 180) * 10, 0.7); sign(g, x, y - 250, DOOM ? (DAY >= 15 ? '결전의 날' : `멸망까지 D-${15 - DAY}`) : '고요한 탑'); } },
        { x: 6, y: 3, w: 3, h: 3, draw: (g, x, y) => pix(g, 'pool', x, y, 2) }, { x: 21, y: 3, w: 3, h: 3, draw: (g, x, y) => pix(g, 'pool', x, y, 2) },
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
        { x: 4, y: 3, w: 4, h: 2, draw: (g, x, y) => stall(g, x, y, 0, 'woodpile', '자원') },
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
        { x: 10, y: 4, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_orb', x, y + 4, 2) }, { x: 23, y: 4, w: 1, h: 1, draw: (g, x, y) => pix(g, 'statue_orb', x, y + 4, 2) },
        { x: 12, y: 8, w: 2, h: 1, draw: (g, x, y) => pix(g, 'log', x, y + 2, 3) }, { x: 20, y: 8, w: 2, h: 1, draw: (g, x, y) => pix(g, 'log', x, y + 2, 3) },
        { x: 12, y: 12, w: 2, h: 1, draw: (g, x, y) => pix(g, 'log', x, y + 2, 3) }, { x: 20, y: 12, w: 2, h: 1, draw: (g, x, y) => pix(g, 'log', x, y + 2, 3) },
        { x: 6, y: 5, w: 1, h: 1, draw: (g, x, y) => pix(g, 'stump', x, y + 2, 3) }, { x: 27, y: 5, w: 1, h: 1, draw: (g, x, y) => pix(g, 'berry', x, y + 2, 3) },
        { x: 6, y: 14, w: 1, h: 1, draw: (g, x, y) => pix(g, 'berry', x, y + 2, 3) }, { x: 27, y: 14, w: 1, h: 1, draw: (g, x, y) => pix(g, 'stump', x, y + 2, 3) },
      ],
    },
    wander: {
      name: '유랑민 등록소', desc: '나라 없는 사람이 귀화·용병·건국을 등록하는 곳', w: 24, h: 14, pos: [1, -1], crowd: 6,
      floor: 'na:0,5', trim: '#3fa37a',
      emotes: ['용병 구합니다', '귀화시켜 주세요', '우리 4명 모이면 건국함', '몸값 얼마?', '어느 나라가 좋음?'],
      doors: [{ side: 'S', at: 12, to: 'plaza' }],
      props: [
        { x: 9, y: 2, w: 6, h: 2, board: true, desk: 'wander', draw: (g, x, y) => { pix(g, 'cabin', x, y + 6, 3); sign(g, x, y - 132, '등록 창구'); } },
        { x: 4, y: 8, w: 1, h: 1, draw: (g, x, y) => pix(g, 'woodpile', x, y + 2, 3) }, { x: 19, y: 8, w: 1, h: 1, draw: bonfire },
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
    [player.x, player.y] = doorInside(R, d);
    player.scene = 'sky'; player.room = R; fadeT = 0.35; lastTerr = null; netTp = true;
  }
  function ascend(portalTerr) {
    player.entry = portalTerr;
    player.skyLeft = SKY_LIMIT;
    enterRoom('temple', 'ground');
    toast('하늘 신전에 올라왔어요 · 여기선 싸울 수 없어요');
  }
  function descend() {
    const t = player.entry || home;
    player.scene = 'ground'; player.room = null; fadeT = 0.35; lastTerr = null; netTp = true;
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
  function renderInv() { $('invCoin').textContent = inv.coin.toLocaleString(); $('invArmy').textContent = inv.army.toLocaleString(); $('invVac').textContent = inv.vaccine; }
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
        face: 0, look: { char: (r() * 3) | 0, hue: (r() * 6) | 0, hair: HAIRS[(r() * 6) | 0], outfit: OUTFITS[(r() * 6) | 0], skin: SKINS[(r() * 3) | 0], accent: TYPE_FILL[TYPES[(r() * 6) | 0]], long: r() < 0.45, seed: r() * 3 },
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
    if (k === 't') goHome();
    if (k === 'e') interact();
    if (k >= '1' && k <= '8') emote(+k - 1);
    if (k === 'enter' && ONLINE) { e.preventDefault(); $('chatIn').focus(); }
    if (k === '[' || k === ']') { location.hash = 'day' + Math.max(1, Math.min(15, DAY + (k === ']' ? 1 : -1))); }
    if (k === 'escape') { $('bigmap').hidden = true; $('closet').hidden = true; $('coupon').hidden = true; $('wanderBox').hidden = true; }
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
      $('whereName').textContent = `하늘 · ${R.name.replace('하늘 ', '')}`;
      $('whereSub').textContent = R.desc;
      chip('중립 · 전투 불가', '#2b2340');
      if (R.id === 'council' || R.id.startsWith('secret')) chip('작전 회의는 나라 채팅에서', null, true);
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
        if (sp.board && Math.hypot(sp.x - player.x, sp.y + 16 - player.y) < 90) best = sp.prop && sp.prop.desk === 'wander' ? { kind: 'desk', text: '등록 창구 이용하기' } : { kind: 'board', text: '게시판 읽기' };
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
    lastTerr = null; netTp = true;
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
    for (const b of others('ground', null)) { const bx = (b.x / TILE - tx + span / 2) * k, by = (b.y / TILE - ty + span / 2) * k; if (bx > 0 && by > 0 && bx < s && by < s) mg.fillRect(bx - 2, by - 2, 4, 4); }
    const vw = canvas.clientWidth / zoom / TILE * k, vh = canvas.clientHeight / zoom / TILE * k;
    mg.strokeStyle = '#ffffff'; mg.lineWidth = 2; mg.strokeRect(s / 2 - vw / 2, s / 2 - vh / 2, vw, vh);
    pix(mg, 'pin', s / 2, s / 2 + 2, 0, 34);
  }
  function teleportTo(tx, ty) {
    for (let r = 0; r < 30; r++) for (let a = 0; a < 16; a++) {
      const x = Math.round(tx + Math.cos(a / 16 * Math.PI * 2) * r), y = Math.round(ty + Math.sin(a / 16 * Math.PI * 2) * r);
      if (!blocked(x, y)) { netTp = true; player.scene = 'ground'; player.room = null; lastTerr = null; player.x = x * TILE + 16; player.y = y * TILE + 16; return true; }
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
    CHARS.names.forEach((name, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'facebtn';
      b.setAttribute('aria-label', name);
      const cv = document.createElement('canvas'); cv.width = 38; cv.height = 38; const g = cv.getContext('2d');
      g.drawImage(ART.faces, (i % CHARS.cols) * 38, Math.floor(i / CHARS.cols) * 38, 38, 38, 0, 0, 38, 38);
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
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: store('mp2026.token'), name: player.name, team: player.team, look: lookPayload() }));
    ws.onmessage = (ev) => { try { onNet(JSON.parse(ev.data)); } catch (e) { /* 무시 */ } };
    ws.onclose = () => { netOn = false; remotes.clear(); setNet('연결이 끊겼어요 · 다시 연결하는 중…'); setTimeout(connect, 2000); };
  }
  function onNet(m) {
    switch (m.t) {
      case 'welcome': {
        myId = m.id; netOn = true; store('mp2026.token', m.token);
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
        const q = m.p; let r = remotes.get(q.id);
        if (!r) { r = { x: null, y: null, tx: null, ty: null, dir: 1, moving: false, emote: null, emoteT: 0 }; remotes.set(q.id, r); }
        r.name = q.name; r.team = q.team; r.tag = teamColor(q.team);
        r.look = Object.assign({ seed: (q.id * 0.37) % 3 }, q.look);
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
    }
  }
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
    $('joinNick').value = player.name; $('joinTeam').value = player.team;
    $('join').hidden = false;
    const go = () => {
      player.name = $('joinNick').value.trim().slice(0, 10) || '나';
      player.team = Math.max(1, Math.min(60, parseInt($('joinTeam').value, 10) || 1));
      player.tag = teamColor(player.team);
      const caps = terrs.filter((t) => t && t.capitalCandidate && !gone[t.id]).sort((a, b) => a.id - b.id);
      home = caps[(player.team - 1) % caps.length];
      saveLook(); store('mp2026.team', player.team);
      $('join').hidden = true;
      setNet('서버에 연결하는 중…');
      connect();
    };
    $('btnJoin').addEventListener('click', go);
    $('joinTeam').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
  $('chatIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') { sendChat(); } if (e.key === 'Escape') e.target.blur(); });
  $('chatIn').addEventListener('focus', () => keys.clear());
  $('btnChatSend').addEventListener('click', sendChat);

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
      player.face = faceOf(mx, my, player.face);
      if (player.scene === 'sky') checkDoor();
    }
    if (player.scene === 'sky') {
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
      else drawSprite(ctx, o.x, o.y, o.look, t, o.moving, o.face);
    }
    for (const o of list) {
      if (o.draw) continue;
      nameTag(ctx, o.x, o.y - 56, o === player ? player.name : o.name, o === player ? player.tag : o.tag);
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
    for (const b of others('ground', null)) if (b.x > x0 && b.x < x1 && b.y > y0 && b.y < y1) list.push(b);
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
    if (ONLINE) startOnline();
    if (DAY === 5) setTimeout(() => toast('신들이 선포했다: 12월 28일, 이 세계는 끝난다.'), 600);
    else if (DOOM) { const n = terrs.filter((t) => t && gone[t.id]).length; if (n) setTimeout(() => toast(`균열이 영토 ${n}곳을 삼켰다`), 600); }
    requestAnimationFrame((n) => { last = n; frame(n); });
  }).catch((err) => {
    $('loading').firstChild.textContent = '지도를 불러오지 못했어요';
    $('loadingSub').textContent = err.message;
  });
})();
