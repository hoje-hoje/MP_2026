/* MP 2026 실시간 서버
 *  - 정적 파일: client/ 와 maps/world.json
 *  - WebSocket(/ws): 접속, 위치 동기화(주변 사람만), 나라 채팅, 감정표현, 유랑민 등록
 *  - 상태는 data/state.json 에 주기적으로 저장 (재시작해도 이어짐)
 *
 *  실행:  cd server && npm install && npm start   →  http://localhost:8080
 *  환경변수: PORT(기본 8080), DATA_DIR(기본 ./data), ADMIN_KEY(관리자 화면 /admin 비밀번호. 없으면 관리자 화면 꺼짐)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { World } = require('../client/rules.js');

const PORT = +process.env.PORT || 8080;
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const TICK_MS = 200;               // 위치 방송 주기 (초당 5번 · 화면은 부드럽게 이어 그림)
const VIEW_CAP = 60;               // 한 사람에게 보내는 주변 사람 최대 수 (가까운 순) — 150명이 하늘에 모여도 전송량 제한
const AOI_X = 44 * 32, AOI_Y = 30 * 32; // 땅에서 '주변'으로 보는 범위 (px)
const MAX_SPEED = 32 / 0.04 * 1.2;  // 칸 이동(빨리 걷기 테스트 포함) 기준 최대 속도    // 허용 최대 속도 (빨리 걷기 테스트 포함, px/s)
const CHAT_MAX = 120, CHAT_KEEP = 60;
const EMOTES = ['안녕!', '거래 구함!', '동맹 할래?', 'ㅋㅋㅋ', '!', '?', '도와줘!', '고마워'];
const BANNED = ['시발', '씨발', 'ㅅㅂ', '병신', 'ㅂㅅ', '좆', '개새', '미친놈', '꺼져'];
const TEAM_MAX = 60;
const ENV_TEST_MODE = process.env.TEST_MODE !== '0'; // 기본값. 관리자 화면에서 바꾸면 그 값이 우선
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const BOOT_AT = Date.now();

// ------------------------------------------------------------ 정적 파일
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const STATIC = {
  '/': path.join(ROOT, 'client', 'index.html'),
  '/index.html': path.join(ROOT, 'client', 'index.html'),
  '/game.js': path.join(ROOT, 'client', 'game.js'),
  '/rules.js': path.join(ROOT, 'client', 'rules.js'),
  '/admin': path.join(ROOT, 'client', 'admin.html'),
  '/favicon.ico': path.join(ROOT, 'client', 'favicon.ico'),
  '/world.json': path.join(ROOT, 'maps', 'world.json'),
};
const ASSET_DIR = path.join(ROOT, 'client', 'assets');
let worldPublic = null; // 균열 정보(rift)를 뺀 지도: 참가자에게는 이것만 보낸다
const zlib = require('zlib');
const gzCache = new Map(); // 압축해 둔 파일 (ETag별)
function publicWorld() {
  if (worldPublic) return worldPublic;
  const w = JSON.parse(fs.readFileSync(STATIC['/world.json'], 'utf8'));
  for (const t of w.territories) { delete t.rift; delete t.riftEpicenter; }
  delete w.riftSchedule; delete w.riftNote;
  worldPublic = Buffer.from(JSON.stringify(w));
  return worldPublic;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
    return res.end('window.MP_ONLINE = true;');
  }
  if (url.pathname === '/admin/api') return adminHttp(req, res);
  if (url.pathname.startsWith('/puzzle-img/')) return puzzleImage(url.pathname.slice(12), res);
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, players: online.size })); }
  let file = STATIC[url.pathname];
  if (!file && url.pathname.startsWith('/assets/')) {
    const f = path.normalize(path.join(ASSET_DIR, decodeURIComponent(url.pathname.slice(8))));
    if (f.startsWith(ASSET_DIR + path.sep) && /\.(png|json|woff2)$/.test(f) && fs.existsSync(f)) file = f;
  }
  if (!file) { res.writeHead(404); return res.end('not found'); }
  try {
    // 브라우저 캐시: 그림·글꼴은 받아 둔 것을 바로 쓰고 뒤에서 몰래 확인, 나머지는 바뀌었는지만 물어본다(304)
    const st = fs.statSync(file);
    const isWorld = url.pathname === '/world.json', isAsset = url.pathname.startsWith('/assets/');
    const etag = `"${isWorld ? 'w' : ''}${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const cache = isAsset ? 'public, max-age=600, stale-while-revalidate=604800' : 'no-cache';
    if (String(req.headers['if-none-match'] || '').replace(/^W\//, '') === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': cache }); return res.end(); }
    let body = isWorld ? publicWorld() : fs.readFileSync(file);
    const type = url.pathname === '/admin' ? MIME['.html'] : MIME[path.extname(file)] || 'application/octet-stream';
    const head = { 'Content-Type': type, 'Cache-Control': cache, ETag: etag, Vary: 'Accept-Encoding' };
    // 글자 파일(지도·코드·화면)은 gzip으로 줄여 보냄 (그림·글꼴은 이미 압축돼 있음)
    if (/json|javascript|html|css|svg/.test(type) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      let z = gzCache.get(etag + file); if (!z) { z = zlib.gzipSync(body, { level: 9 }); gzCache.set(etag + file, z); }
      body = z; head['Content-Encoding'] = 'gzip';
    }
    res.writeHead(200, head);
    res.end(body);
  } catch (e) { res.writeHead(500); res.end('error'); }
});

// ------------------------------------------------------------ 상태
// accounts: 토큰별 영구 기록 / online: 지금 접속한 소켓
const { store } = global.__MP_BOOT || {};
const state = (global.__MP_BOOT && global.__MP_BOOT.initial) || { accounts: {}, chats: {}, wander: [] };
// ------------------------------------------------------------ 게임 세계 (나라·영토·전투)
const MAP = JSON.parse(fs.readFileSync(STATIC['/world.json'], 'utf8'));
const TERR = new Uint16Array(Buffer.from(MAP.territory_u16le_b64, 'base64').buffer.slice(0));
const terrAtPx = (x, y) => { const tx = Math.floor(x / 32), ty = Math.floor(y / 32); if (tx < 0 || ty < 0 || tx >= MAP.width || ty >= MAP.height) return -1; const v = TERR[ty * MAP.width + tx]; return v === 65535 ? -1 : v; };
const world = new World(MAP, state.world || null);
const MPRules = require('../client/rules.js');
const { sameAnswer, NUM, treeKind, storageSpot, mineSpot, T: TT } = MPRules;
const MPRulesPortal = (t) => MPRules.portalSpot(t, tileAt);
for (const t of MAP.territories) world.t[t.id].name = MPRules.terrName(t); // 알림에 쓰는 영토 이름
world.tileTerr = (i) => terrAtTile(i % MAP.width, Math.floor(i / MAP.width)); // 영역이 넘어갈 때 그 땅의 설치물도 같이
// ---- 영지: 지형·저장소·설치물
const TERRAIN = Buffer.from(MAP.terrain_b64, 'base64');
// 관리자가 '나무·산 없애기'로 비운 칸 (산 → 풀밭, 나무 없음)
let CLEAR_SET = new Set();
function rebuildClear() { CLEAR_SET = new Set(Object.keys((state.groundEdits || {}).clear || {}).map((k) => { const [x, y] = k.split(',').map(Number); return y * MAP.width + x; })); }
const tileAt = (x, y) => { if (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) return TT.VOID; const i = y * MAP.width + x, t = TERRAIN[i]; return t === TT.MOUNTAIN && CLEAR_SET.has(i) ? TT.GRASS : t; };
const treeHere = (x, y) => !CLEAR_SET.has(y * MAP.width + x) && treeKind(tileAt(x, y), x, y);
const terrAtTile = (x, y) => terrAtPx(x * 32 + 16, y * 32 + 16);
const walkableTerrain = (k) => k === TT.GRASS || k === TT.FOREST || k === TT.SAND;
const tileIdx = (x, y) => y * MAP.width + x;
// 전선 자리: 공격받는 영토 안에서 공격 나라 땅과 맞닿은 국경 칸들 중, 서로 떨어진 3곳
let TERR_TILES = null;
function frontsFor(attNid, tid) {
  if (!TERR_TILES) { TERR_TILES = new Map(); for (let i = 0; i < TERR.length; i++) { const v = TERR[i]; if (v === 65535) continue; let a = TERR_TILES.get(v); if (!a) TERR_TILES.set(v, a = []); a.push(i); } }
  const W = MAP.width, border = [];
  for (const i of TERR_TILES.get(tid) || []) {
    const x = i % W, y = (i / W) | 0; if (!walkableTerrain(tileAt(x, y))) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const q = terrAtTile(x + dx, y + dy); return q > 0 && q !== tid && world.ownerOf(q) === attNid; })) border.push([x, y]);
  }
  const t = world.t[tid];
  if (!border.length) return [t.altar, t.altar, t.altar].map((p) => [p[0], p[1]]);
  const xs = border.map((p) => p[0]), ys = border.map((p) => p[1]);
  const horiz = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  border.sort((a, b) => horiz ? a[0] - b[0] || a[1] - b[1] : a[1] - b[1] || a[0] - b[0]);
  return [1 / 6, 1 / 2, 5 / 6].map((k) => border[Math.min(border.length - 1, Math.floor(border.length * k))]);
}
function storageOf(n) { return n && world.t[n.capital] ? (n.storePos || storageSpot(world.t[n.capital], tileAt)) : null; }
// 저장소 입구 전부 (수도 옆 본 저장소 + 빼앗은 땅·옛 수도에 남은 입구). 재료는 하나로 통합
function storesOf(n) { if (!n || n.dead) return []; const main = storageOf(n); return (main ? [main] : []).concat((n.extraStores || []).filter((p) => world.ownerOf(terrAtTile(p[0], p[1])) === n.id)); }
const pubNations = () => { const o = world.publicNations(); for (const n of world.alive()) if (o[n.id]) o[n.id].stores = storesOf(n); return o; };
const nearStore = (s, n, r = 2) => storesOf(n).some((p) => nextTo(s, p[0], p[1], r));
// 금광 위치: 옮겼으면 그 자리, 아니면 기본 자리
const MINE_DEF = {};
function mineOf(tid) { if (world.s.mines[tid]) return world.s.mines[tid]; if (!(tid in MINE_DEF)) MINE_DEF[tid] = world.t[tid] ? mineSpot(world.t[tid], tileAt, terrAtTile) : null; return MINE_DEF[tid]; }
// 건물(저장소·금광) 자리 사이 거리 확인: 다른 건물과 2칸 이상 떨어져야 함 (E가 헷갈리지 않게)
function buildingNear(x, y, skip) {
  for (const n of world.alive()) { if (skip === 'store:' + n.id) continue; const p = storageOf(n); if (p && Math.max(Math.abs(p[0] - x), Math.abs(p[1] - y)) <= 2) return true; }
  for (const tid of Object.keys(world.t)) { if (skip === 'mine:' + tid) continue; const p = mineOf(+tid); if (p && Math.max(Math.abs(p[0] - x), Math.abs(p[1] - y)) <= 2) return true; }
  return false;
}
// 플레이어가 그 칸 바로 옆(가로·세로·대각선 1칸 정도)에 있는지
function nextTo(s, x, y, r = 1.6) { return s.scene === 'ground' && s.x != null && Math.hypot(s.x / 32 - (x + 0.5), s.y / 32 - (y + 0.5)) <= r; }
// 설치 금지: 제단·포털·저장소 둘레 1칸
function reservedTile(x, y) {
  const t = world.t[terrAtTile(x, y)]; if (!t) return true;
  const near = (p) => p && Math.abs(p[0] - x) <= 1 && Math.abs(p[1] - y) <= 1;
  if (near(t.altar) || near(t.portal)) return true;
  if (t.capitalCandidate && near(storageSpot(t, tileAt))) return true;
  return false;
}
function sendTile(i) { const e = world.s.tiles[i] || null; const msg = JSON.stringify({ t: 'tile', i, e }); for (const o of online.values()) if (o.ws.readyState === 1) o.ws.send(msg); }
function sendTrap(nid, i, on) { const n = world.nation(nid); if (!n) return; for (const o of online.values()) if (n.members.includes(o.token)) send(o.ws, { t: 'trap', i, on }); }
function trapsOf(nid) { return Object.keys(world.s.traps).filter((i) => world.s.traps[i] === nid).map(Number); }
// 문제 은행: server/puzzles.local.json (저장소에 안 올림) 이 있으면 그것, 없으면 샘플
// Render 의 Secret File 은 /etc/secrets/ 에 들어간다
const PUZZLE_FILE = [process.env.PUZZLES_FILE, '/etc/secrets/puzzles.local.json', path.join(__dirname, 'puzzles.local.json')].find((f) => f && fs.existsSync(f)) || path.join(__dirname, 'puzzles.sample.json');
let FILE_PUZZLES = [];
function loadPuzzles() { try { FILE_PUZZLES = JSON.parse(fs.readFileSync(PUZZLE_FILE, 'utf8')).puzzles || []; console.log(`문제 파일 ${FILE_PUZZLES.length}개 (${path.basename(PUZZLE_FILE)})`); } catch (e) { console.log('문제 파일 오류:', e.message); } }
const SAMPLE_FILE = PUZZLE_FILE.endsWith('puzzles.sample.json');
// 실제로 내는 문제: 관리자 화면에서 넣은 문제(켜진 것) + 문제 파일. 관리자 문제가 하나라도 있으면 샘플 파일은 뺀다
function bank() {
  const mine = (state.puzzles || []).filter((q) => q.on);
  return SAMPLE_FILE && (state.puzzles || []).length ? mine : mine.concat(FILE_PUZZLES);
}
const findPuzzle = (id) => (state.puzzles || []).find((q) => q.id === id) || FILE_PUZZLES.find((q) => q.id === id);
loadPuzzles();
fs.watchFile(PUZZLE_FILE, { interval: 5000 }, loadPuzzles); // 문제 파일을 고치면 서버 재시작 없이 반영
state.world = world.s;
state.settings = state.settings || {};   // 관리자 설정: testMode(true/false/없음=환경변수), founding('auto'|'open'|'closed')
state.coupons = state.coupons || {};     // 쿠폰 코드 -> { r:{coin|army}, memo, at, used:{name,nation,ts} }
state.groundEdits = state.groundEdits || { floor: {}, walls: {} }; state.groundEdits.clear = state.groundEdits.clear || {}; rebuildClear(); // 관리자 '맵 고치기': 땅 지도 { floor: {'x,y': '시트:번호'}, walls: {'x,y': 1} }
state.roomEdits = state.roomEdits || {}; // 관리자 '맵 고치기': 하늘 방별 { floor: {'x,y': '시트:번호'}, walls: {'x,y': 1}, hideProps }
state.puzzles = state.puzzles || [];     // 관리자 화면에서 넣은 문제 [{ id, type, question, image, answer:[], on, at }]
const testMode = () => typeof state.settings.testMode === 'boolean' ? state.settings.testMode : ENV_TEST_MODE;
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
// ---- 게임 시계: 1일차(12/14) ~ 15일차(12/28), 하루 3시간대 (아침 9시 · 점심 1시 · 밤 10시)
// 기본은 실제 한국 시간. 관리자 화면에서 '수동'으로 날짜·시간대를 바꿀 수 있다
const EVENT_START = process.env.EVENT_START || '2026-12-14', LAST_DAY = 15;
const SLOTS = ['morning', 'lunch', 'night'], SLOT_LABEL = { morning: '아침 9시', lunch: '점심 1시', night: '밤 10시' };
function realClock() {
  const k = new Date(Date.now() + 9 * 3600e3); let h = k.getUTCHours(), slot = h < 9 ? 'night' : h < 13 ? 'morning' : h < 22 ? 'lunch' : 'night';
  if (h < 9) k.setUTCDate(k.getUTCDate() - 1); // 새벽은 전날 밤
  const day = Math.floor((Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - Date.parse(EVENT_START + 'T00:00:00Z')) / 86400e3) + 1;
  if (day < 1) return { day: 1, slot: 'morning', before: true };
  if (day > LAST_DAY) return { day: LAST_DAY, slot: 'night', after: true };
  return { day, slot };
}
function gameClock() { const c = state.clock || {}; return c.mode === 'manual' ? { day: c.day, slot: c.slot, manual: true } : realClock(); }
const clockKey = (c) => (c.day - 1) * 3 + SLOTS.indexOf(c.slot);
const fromKey = (k) => ({ day: Math.floor(k / 3) + 1, slot: SLOTS[k % 3] });
const gameDayKey = () => 'D' + gameClock().day; // 하루 단위(행동력·금광·체포)는 게임 날짜 기준
// 전투 시간 번호: 일차×3 + (아침0·점심1·밤2). 선전포고는 다음 전투 시간에 들어가는데,
// 실제 시계일 때 그 전투 30분 전이 지났으면 그다음 전투 시간으로 넘어감
const slotIdx = (day, slot) => day * 3 + SLOTS.indexOf(slot);
function battleSlotFor() {
  const c = gameClock();
  let idx = c.slot === 'morning' ? slotIdx(c.day, 'lunch') : c.slot === 'lunch' ? slotIdx(c.day, 'night') : slotIdx(c.day + 1, 'lunch');
  if (!c.manual) {
    const k = new Date(Date.now() + 9 * 3600e3), mins = k.getUTCHours() * 60 + k.getUTCMinutes();
    const at = SLOTS[idx % 3] === 'lunch' ? 13 * 60 : 22 * 60;
    const left = (at - mins + 1440) % 1440;
    if (left < 30) idx = SLOTS[idx % 3] === 'lunch' ? idx + 1 : idx + 2;
  }
  return idx;
}
function slotLabel(idx) { const d = Math.floor(idx / 3), c = gameClock(); const when = d === c.day ? '오늘' : d === c.day + 1 ? '내일' : `${d}일차`; return `${when} ${SLOTS[idx % 3] === 'lunch' ? '점심 1시' : '밤 10시'}`; }
function nextSlotLabel() { const c = gameClock(); return c.slot === 'morning' ? '오늘 점심 1시' : c.slot === 'lunch' ? '오늘 밤 10시' : '내일 점심 1시'; }
const FOUNDING_LAST_DAY = process.env.FOUNDING_LAST_DAY || '2026-12-15'; // 건국은 D2(12/15)까지
const foundingOpen = () => state.settings.founding === 'open' ? true : state.settings.founding === 'closed' ? false : testMode() || gameClock().day <= 2;
const online = new Map(); // id -> session
let nextId = 1;

let dirty = false, saving = false;
async function saveState() {
  if (!dirty || saving || !store) return;
  saving = true; dirty = false;
  try { await store.save(state); }
  catch (e) { dirty = true; console.error('저장 실패 (다음에 다시 시도):', e.message); }
  finally { saving = false; }
}
setInterval(saveState, 10000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { dirty = true; saving = false; await saveState(); if (store) await store.close(); process.exit(0); });

const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const HEX = /^#[0-9a-f]{6}$/i;
function cleanLook(l) {
  l = l || {};
  return { char: Math.max(0, Math.min(127, l.char | 0)), hue: Math.max(0, Math.min(5, l.hue | 0)), hair: HEX.test(l.hair) ? l.hair : '#4a3428', outfit: HEX.test(l.outfit) ? l.outfit : '#5b7fd6', skin: HEX.test(l.skin) ? l.skin : '#ffe1cc', accent: HEX.test(l.accent) ? l.accent : '#ff5d7a', long: !!l.long };
}
// ---- 이름 (동명이인 금지, 바꾸기 3번)
const NAME_CHANGES = 3;
const normName = (n) => String(n || '').replace(/\s/g, '').toLowerCase();
function nameTaken(name, token) { const k = normName(name); return Object.entries(state.accounts).some(([t, a]) => t !== token && a.nameSet && normName(a.name) === k); }
function uniqueName(base, token) { base = base.slice(0, 8); if (!nameTaken(base, token)) return base; for (let i = 2; ; i++) if (!nameTaken(base + i, token)) return base + i; }
function filterBad(text) { let t = text; for (const w of BANNED) t = t.split(w).join('♡'.repeat(w.length)); return t; }

// ------------------------------------------------------------ WebSocket
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function meta(s) {
  const n = world.nationOfPlayer(s.token);
  return { id: s.id, name: s.acc.name, team: s.acc.team, look: s.acc.look, nid: n ? n.id : null, carry: !!s.acc.carry, red: arrestsToday(s.acc), jailed: jailed(s.acc) };
}
// 체포 횟수 (하루 단위), 감옥
function arrestsToday(acc) { return acc.arrests && acc.arrests.day === gameDayKey() ? acc.arrests.n : 0; }
const jailed = (acc) => (acc.jailUntil || 0) > Date.now();
function sendMeta(s) { const mm = { t: 'meta', p: meta(s) }; for (const o of online.values()) if (o === s || o.known.has(s.id)) send(o.ws, mm); }
function capitalPos(acc, token) { // 그 사람 나라 수도 포털 앞 (나라 없으면 null)
  const n = world.nationOfPlayer(token); const t = n && world.t[n.capital];
  const pt = t && MPRulesPortal(t);
  return t ? { x: pt[0] * 32 + 16, y: (pt[1] + 1) * 32 + 16, scene: 'ground', room: null } : null;
}
const JAIL_POS = { x: 7 * 32 + 16, y: 5 * 32 + 16, scene: 'sky', room: 'jail' };
function placeAt(s, pos) { if (!pos) return; Object.assign(s, { x: pos.x, y: pos.y, scene: pos.scene, room: pos.room, moved: true }); Object.assign(s.acc, pos); dirty = true; send(s.ws, { t: 'warp', pos }); }

wss.on('connection', (ws) => {
  let s = null;
  let msgBudget = 40; // 초당 메시지 제한
  const refill = setInterval(() => { msgBudget = 40; }, 1000);

  ws.on('message', (raw) => {
    if (--msgBudget < 0) return;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!s) {
      if (m.t !== 'hello') return;
      const team = Math.max(1, Math.min(TEAM_MAX, parseInt(m.team, 10) || 1));
      let token = typeof m.token === 'string' && state.accounts[m.token] ? m.token : null;
      if (!token) { token = crypto.randomBytes(12).toString('hex'); state.accounts[token] = { x: null, y: null, scene: 'ground', room: null }; }
      const acc = state.accounts[token];
      // 이름: 중복 금지. 이미 정한 이름은 그대로, 새 계정은 겹치지 않는 임시 이름
      if (!acc.nameSet) {
        if (acc.name && !nameTaken(acc.name, token)) acc.nameSet = true; // 예전 계정
        else acc.name = uniqueName(clean(m.name, 10) || '손님', token);
      }
      acc.team = team;
      acc.look = cleanLook(m.look);
      dirty = true;
      // 같은 계정으로 이미 접속 중이면 이전 접속을 끊는다
      for (const o of online.values()) if (o.token === token) o.ws.close(4000, 'replaced');
      s = { id: nextId++, ws, token, acc, x: acc.x, y: acc.y, dir: 1, moving: 0, scene: acc.scene || 'ground', room: acc.room || null, lastMove: Date.now(), known: new Set() };
      online.set(s.id, s);
      const nat = world.nationOfPlayer(token); // 나라는 건국 화면에서 세우거나 초대 코드로 들어간다
      if (nat) { world.refreshActions(nat, gameDayKey()); if (nat.memberNames) nat.memberNames[token] = acc.name; }
      send(ws, {
        t: 'welcome', id: s.id, token, name: acc.name, nameSet: !!acc.nameSet, renamesLeft: NAME_CHANGES - (acc.renames || 0), pos: jailed(acc) ? JAIL_POS : acc.x == null ? null : { x: acc.x, y: acc.y, scene: s.scene, room: s.room }, carry: acc.carry || null, red: arrestsToday(acc), jailUntil: jailed(acc) ? acc.jailUntil : 0,
        chat: nat ? (state.chats['nation:' + nat.id] || []).slice(-30) : [], emotes: EMOTES, wander: state.wander,
        view: nat ? world.view(nat.id, token) : null, owners: world.s.owner, nations: pubNations(), testMode: testMode(), foundingOpen: foundingOpen(), notice: state.notice || null,
        roomEdits: state.roomEdits, groundEdits: state.groundEdits, clock: clockMsg(), battles: world.publicBattles(), mines: world.s.mines, tiles: world.s.tiles, chopped: Object.keys(world.s.chopped).map(Number), traps: nat ? trapsOf(nat.id) : [], stun: Math.max(0, (acc.stunUntil || 0) - Date.now()),
      });
      if (nat && nat.king === token && nat.kingName !== acc.name) { nat.kingName = acc.name; broadcastOwners(); } // 접속할 때마다 모두에게 나라 정보를 다시 보내지 않음 (전송량 절약)
      return;
    }
    switch (m.t) {
      case 'move': {
        const now = Date.now();
        const x = +m.x, y = +m.y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (jailed(s.acc) && (m.scene !== 'sky' || m.room !== 'jail')) { send(ws, { t: 'warp', pos: JAIL_POS }); return; }
        const scene = m.scene === 'sky' ? 'sky' : 'ground';
        const room = scene === 'sky' ? clean(m.room, 16) : null;
        const sameArea = scene === s.scene && room === s.room;
        const dt = Math.max(0.05, (now - s.lastMove) / 1000);
        // 같은 장소에서 너무 빨리 움직이면 무시 (순간이동 테스트 기능 m.tp 는 프로토타입 기간에만 허용)
        if (sameArea && s.x != null && !m.tp && Math.hypot(x - s.x, y - s.y) > MAX_SPEED * dt + 64) return;
        if (!sameArea) { for (const id of s.known) send(ws, { t: 'leave', id }); s.known.clear(); }
        if (scene === 'ground') {
          const tx = Math.floor(x / 32), ty = Math.floor(y / 32), i = tileIdx(tx, ty), e = world.s.tiles[i];
          const myN = world.nationOfPlayer(s.token);
          // 남의 나라 방벽은 못 지나감 → 원래 자리로
          if (e && e.k === 'wall' && (!myN || myN.id !== e.n)) { send(ws, { t: 'pos', x: s.x, y: s.y }); return; }
          if (Date.now() < (s.acc.stunUntil || 0) && s.x != null && sameArea && Math.hypot(x - s.x, y - s.y) > 40) { send(ws, { t: 'pos', x: s.x, y: s.y }); return; }
          const trapN = world.s.traps[i];
          if (trapN && (!myN || myN.id !== trapN)) { // 덫: 3초 동안 못 움직임
            delete world.s.traps[i]; s.acc.stunUntil = Date.now() + 3000; dirty = true;
            sendTrap(trapN, i, false); send(ws, { t: 'stun', ms: 3000, text: '덫에 걸렸어요! 3초 동안 못 움직여요' });
            notifyNation(trapN, `🪤 덫에 ${myN ? myN.name + '의 ' : ''}${s.acc.name}이(가) 걸렸어요! (${world.t[terrAtTile(tx, ty)] ? world.t[terrAtTile(tx, ty)].name : ''})`);
          }
        }
        { const nd = m.dir < 0 ? -1 : 1, nf = Math.max(0, Math.min(3, m.f | 0)), nm = m.moving ? 1 : 0; if (s.x !== x || s.y !== y || s.dir !== nd || s.face !== nf || s.moving !== nm || s.scene !== scene || s.room !== room) s.moved = true;
        s.x = x; s.y = y; s.dir = nd; s.face = nf; s.moving = nm; s.scene = scene; s.room = room; s.lastMove = now; }
        Object.assign(s.acc, { x, y, scene, room }); dirty = true;
        break;
      }
      case 'chat': {
        const text = filterBad(clean(m.text, CHAT_MAX));
        if (!text || now() - (s.lastChat || 0) < 800) return;
        s.lastChat = now();
        const myNat = world.nationOfPlayer(s.token);
        if (!myNat) return;
        const ch = 'nation:' + myNat.id; // 나라 채팅 (병합되면 자동으로 제국 채팅이 된다)
        const msg = { t: 'chat', ch, from: s.id, name: s.acc.name, text, ts: Date.now() };
        const list = state.chats[ch] || (state.chats[ch] = []);
        list.push(msg); if (list.length > CHAT_KEEP) list.splice(0, list.length - CHAT_KEEP);
        dirty = true;
        for (const o of online.values()) if (myNat.members.includes(o.token)) send(o.ws, msg);
        break;
      }
      case 'emote': {
        const text = EMOTES[m.i | 0];
        if (!text || now() - (s.lastEmote || 0) < 1500) return;
        s.lastEmote = now();
        for (const o of online.values()) if (o !== s && near(o, s)) send(o.ws, { t: 'emote', id: s.id, text });
        send(ws, { t: 'emote', id: s.id, text });
        break;
      }
      case 'look': {
        s.acc.look = cleanLook(m.look); dirty = true; // 이름은 setName 으로만 바꾼다
        const mm = { t: 'meta', p: meta(s) };
        for (const o of online.values()) if (o.known.has(s.id) || o === s) send(o.ws, mm);
        break;
      }
      case 'found': case 'join': {
        if (m.t === 'found' && !foundingOpen()) return send(ws, { t: 'err', text: '건국 기간(12/14~12/15)이 끝났어요. 유랑민으로 시작해 주세요' });
        const r = m.t === 'found' ? world.foundNation(s.token, s.acc.name, m.name, m.capital | 0) : world.joinNation(s.token, s.acc.name, m.code);
        if (!r.ok) return send(ws, { t: 'err', text: r.err });
        world.refreshActions(r.nation, gameDayKey());
        dirty = true; broadcastOwners(); sendViews([r.nation.id]);
        send(ws, { t: 'joined', founded: m.t === 'found', chat: (state.chats['nation:' + r.nation.id] || []).slice(-30) });
        sendMeta(s);
        if (m.t === 'join') notifyNation(r.nation.id, `${s.acc.name}님이 우리 나라에 들어왔어요`);
        break;
      }
      case 'puzzle': {
        const t = world.t[m.terr | 0]; const n = world.nationOfPlayer(s.token);
        if (!t) return;
        if (s.scene !== 'ground' || s.x == null || Math.hypot(s.x / 32 - t.altar[0] - 0.5, s.y / 32 - t.altar[1] - 0.5) > 3) return send(ws, { t: 'err', text: '제단 가까이에서만 풀 수 있어요' });
        if (!n) return send(ws, { t: 'err', text: '나라가 있어야 퍼즐 보상을 받을 수 있어요' });
        const own = world.ownerOf(t.id);
        if (own && own !== n.id) return send(ws, { t: 'err', text: '다른 나라의 제단이에요' });
        if (!own && !world.touches(n.id, t.id)) return send(ws, { t: 'err', text: '우리 땅과 붙어 있어야 점령할 수 있어요' });
        const solved = new Set(s.acc.solved || []);
        const pool = bank().filter((q) => !solved.has(q.id));
        if (!pool.length) return send(ws, { t: 'err', text: '지금 풀 수 있는 문제가 없어요 (문제가 곧 추가돼요)' });
        const same = pool.filter((q) => q.type === t.type);
        const q = (same.length ? same : pool)[Math.floor(Math.random() * (same.length || pool.length))];
        s.pending = { id: q.id, terr: t.id };
        send(ws, { t: 'puzzle', id: q.id, terr: t.id, type: q.type, question: q.question, image: q.image || null, mode: own ? 'army' : 'claim' });
        break;
      }
      case 'answer': {
        const n = world.nationOfPlayer(s.token);
        if (!n || !s.pending || s.pending.id !== m.id) return;
        const q = findPuzzle(m.id); if (!q) return;
        if (!world.useAction(n.id, gameDayKey())) return send(ws, { t: 'answer', correct: false, text: '오늘 행동력을 다 썼어요 (자정에 다시 10)' });
        if (!sameAnswer(m.answer, q.answer)) { dirty = true; sendViews([n.id]); return send(ws, { t: 'answer', correct: false, text: '틀렸어요. 다시 도전하려면 행동력 1이 들어요' }); }
        (s.acc.solved = s.acc.solved || []).push(q.id);
        const r = world.puzzleReward(n.id, s.pending.terr, gameDayKey());
        s.pending = null; dirty = true;
        if (r.kind === 'claim') broadcastOwners();
        sendViews([n.id]);
        send(ws, { t: 'answer', correct: true, text: r.kind === 'claim' ? '정답! 영토를 점령했어요' : r.kind === 'army' ? `정답! 병력 +${r.army}` : '정답!' });
        break;
      }
      case 'kingTo': {
        const n = world.nationOfPlayer(s.token); if (!n) return;
        const r = world.transferKing(n.id, s.token, m.idx | 0);
        if (!r.ok) return send(ws, { t: 'err', text: r.err });
        dirty = true; broadcastOwners(); sendViews([n.id]); notifyNation(n.id, `새 왕: ${n.kingName}`);
        break;
      }
      case 'war': { const n = world.nationOfPlayer(s.token); if (n) send(ws, { t: 'view', view: world.view(n.id, s.token) }); break; }
      case 'claim': {
        const n = world.nationOfPlayer(s.token); const t = world.t[m.terr | 0];
        if (!n || !t) return;
        // 그 영토 제단 근처에 서 있어야 한다
        if (s.scene !== 'ground' || s.x == null || Math.hypot(s.x / 32 - t.altar[0] - 0.5, s.y / 32 - t.altar[1] - 0.5) > 3) return send(ws, { t: 'err', text: '제단 가까이에서만 점령할 수 있어요' });
        const r = world.claim(n.id, t.id, gameDayKey());
        if (!r.ok) return send(ws, { t: 'err', text: r.err });
        dirty = true; broadcastOwners(); sendViews([n.id]);
        send(ws, { t: 'ok', text: `${t.name}을(를) 점령했어요` });
        break;
      }
      case 'declare': case 'defend': {
        const n = world.nationOfPlayer(s.token);
        if (!n) return;
        if (n.king !== s.token) return send(ws, { t: 'err', text: m.t === 'declare' ? '선전포고는 왕만 할 수 있어요' : '방어 배치는 왕만 할 수 있어요' });
        const slot = world.s.curSlot = battleSlotFor();
        const r = m.t === 'declare' ? world.declare(n.id, m.terr | 0, m.troops, slot) : world.defend(n.id, m.battle | 0, m.troops);
        if (!r.ok) return send(ws, { t: 'err', text: r.err });
        dirty = true;
        if (m.t === 'declare') {
          r.battle.f = frontsFor(n.id, r.battle.target); // 지도의 전선 진지 3곳
          const D = world.nation(r.battle.def), when = slotLabel(r.battle.slot);
          sendViews([n.id, r.battle.def]); broadcastOwners();
          notifyNation(r.battle.def, `⚔ ${n.name}이(가) ${world.t[r.battle.target].name}에 선전포고했어요! ${when} 전투 · 전선 ${r.battle.F}곳 · 왕은 방어 배치를 정해 주세요`);
          notifyNation(n.id, `⚔ ${D ? D.name : ''}에 선전포고했어요 · ${when} 전투 · 팀원은 전선 진지에서 충원할 수 있어요`);
          return send(ws, { t: 'ok', text: `선전포고 완료 · ${when}에 결과가 나와요` });
        }
        sendViews([n.id]);
        send(ws, { t: 'ok', text: '방어 배치 저장' });
        break;
      }
      case 'moveCapital': { // 천도 (왕)
        const n = world.nationOfPlayer(s.token); if (!n) return;
        if (n.king !== s.token) return send(ws, { t: 'err', text: '천도는 왕만 할 수 있어요' });
        const before = storageOf(n), old = n.capital;
        const r = world.moveCapital(n.id, m.terr | 0, Date.now()); if (!r.ok) return send(ws, { t: 'err', text: r.err });
        if (before) { n.extraStores = (n.extraStores || []).concat([before]); delete n.storePos; } // 옛 저장소 건물은 입구로 남고, 본 저장소는 새 수도로
        dirty = true; broadcastOwners(); sendViews([n.id]);
        notifyNation(n.id, `🏰 천도! 수도가 ${world.t[old].name || old}에서 ${world.t[n.capital].name || n.capital}(으)로 옮겨졌어요`);
        break;
      }
      case 'resolveNow': { if (testMode()) resolveNight('test'); break; }
      case 'vaccinate': { // 백신 쓰기
        const n = world.nationOfPlayer(s.token); if (!n) return;
        const r = world.vaccinate(n.id, m.terr | 0); if (!r.ok) return send(ws, { t: 'err', text: r.err });
        dirty = true; sendViews([n.id]); broadcastOwners(); notifyNation(n.id, `💉 ${s.acc.name}님이 ${(world.t[m.terr | 0] || {}).name}에 백신을 썼어요 (이번 균열에서 안전)`);
        break;
      }
      case 'defaultDef': { // 기본 방어 비율 (왕)
        const n = world.nationOfPlayer(s.token); if (!n) return;
        if (n.king !== s.token) return send(ws, { t: 'err', text: '기본 방어는 왕만 정할 수 있어요' });
        const r = world.setDefault(n.id, m.ratio); if (!r.ok) return send(ws, { t: 'err', text: r.err });
        dirty = true; sendViews([n.id]); send(ws, { t: 'ok', text: `기본 방어 비율 저장: ${n.defaultDef.join(' : ')}` });
        break;
      }
      case 'intel': { // 첩보 쓰기: 공격해 온 나라 전선 하나 보기
        const n = world.nationOfPlayer(s.token); if (!n) return;
        const r = world.useIntel(n.id, m.battle | 0); if (!r.ok) return send(ws, { t: 'err', text: r.err });
        dirty = true; sendViews([n.id]); notifyNation(n.id, `🔍 첩보: ${MPRules.frontName(r.front)} 전선에 적 병력 ${r.troops}명 (${s.acc.name}님이 알아냄)`);
        break;
      }
      case 'reinforce': { // 공격팀 충원·빼기 (팀원 누구나, 전선 진지 근처에서 숫자 입력)
        const n = world.nationOfPlayer(s.token); const b = world.s.battles.find((x) => x.id === (m.battle | 0));
        if (!n || !b || !b.f) return;
        if (!b.f.some((p) => nextTo(s, p[0], p[1], NUM.frontRange + 0.5))) return send(ws, { t: 'err', text: '전선 진지 가까이 가야 충원할 수 있어요' });
        if (now() - (s.lastReinforce || 0) < 800) return;
        s.lastReinforce = now();
        const r = world.reinforce(n.id, b.id, m.front | 0, m.amount); if (!r.ok) return send(ws, { t: 'err', text: r.err });
        dirty = true; sendViews([n.id]);
        send(ws, { t: 'ok', text: `${MPRules.frontName(m.front | 0)} 전선 ${r.amount > 0 ? '충원 +' + r.amount : '빼기 ' + r.amount} (지금 ${r.now}) · 충원 ${r.used}/${r.cap}` });
        if (r.amount > 0) notifyNation(n.id, `🪖 ${s.acc.name}님이 ${MPRules.frontName(m.front | 0)} 전선에 병력 ${r.amount}명 충원 (${r.used}/${r.cap})`);
        break;
      }
      case 'redeem': { // 쿠폰: 한 번 쓰면 모두에게 사라진다
        if (now() - (s.lastRedeem || 0) < 1500) return send(ws, { t: 'redeem', ok: false, text: '잠시 후 다시 입력해 주세요' });
        s.lastRedeem = now();
        const raw = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const code = /^MP[A-Z0-9]{8}$/.test(raw) ? `MP-${raw.slice(2, 6)}-${raw.slice(6)}` : '';
        const c = code && state.coupons[code];
        if (!c) return send(ws, { t: 'redeem', ok: false, text: '없는 코드예요. 다시 확인해 주세요' });
        if (c.used) return send(ws, { t: 'redeem', ok: false, text: '이미 사용된 코드예요' });
        const n = world.nationOfPlayer(s.token);
        if (!n) return send(ws, { t: 'redeem', ok: false, text: '나라에 들어간 뒤에 쓸 수 있어요' });
        for (const [k, v] of Object.entries(c.r)) { if (k === 'coin' || k === 'army') n[k] += v; else if (k === 'intel') n.intelAny = (n.intelAny || 0) + v; }
        c.used = { name: s.acc.name, nation: n.name, ts: Date.now() }; dirty = true;
        sendViews([n.id]);
        send(ws, { t: 'redeem', ok: true, text: `받았어요: ${Object.entries(c.r).map(([k, v]) => `${{ coin: '코인', army: '병력', intel: '첩보(아무 나라용)' }[k]} +${v}`).join(', ')} (우리 나라에 들어갔어요)` });
        break;
      }
      case 'setName': { // 이름 정하기 (처음은 무료) / 바꾸기 (3번까지)
        const name = clean(m.name, 10);
        if (name.replace(/\s/g, '').length < 2) return send(ws, { t: 'name', ok: false, text: '이름은 2글자 이상이에요' });
        if (filterBad(name) !== name) return send(ws, { t: 'name', ok: false, text: '쓸 수 없는 말이 들어 있어요' });
        if (s.acc.nameSet && normName(name) === normName(s.acc.name)) { s.acc.name = name; dirty = true; return send(ws, { t: 'name', ok: true, name, left: NAME_CHANGES - (s.acc.renames || 0) }); }
        if (nameTaken(name, s.token)) return send(ws, { t: 'name', ok: false, text: `'${name}'은(는) 이미 누가 쓰고 있어요` });
        if (s.acc.nameSet) { if ((s.acc.renames || 0) >= NAME_CHANGES) return send(ws, { t: 'name', ok: false, text: `이름은 ${NAME_CHANGES}번까지만 바꿀 수 있어요` }); s.acc.renames = (s.acc.renames || 0) + 1; }
        s.acc.name = name; s.acc.nameSet = true; dirty = true;
        const n = world.nationOfPlayer(s.token); if (n) { if (n.memberNames) n.memberNames[s.token] = name; if (n.king === s.token) n.kingName = name; sendViews([n.id]); broadcastOwners(); }
        sendMeta(s);
        send(ws, { t: 'name', ok: true, name, left: NAME_CHANGES - (s.acc.renames || 0) });
        break;
      }
      case 'chop': { // 나무 베기 (화면에서 2초 게이지가 찬 뒤 보냄)
        const x = m.x | 0, y = m.y | 0, i = tileIdx(x, y);
        if (now() - (s.lastChop || 0) < NUM.chopSec * 900) return;
        if (!nextTo(s, x, y) || !treeHere(x, y) || world.s.chopped[i]) return send(ws, { t: 'err', text: '벨 수 있는 나무가 없어요' });
        const n = world.nationOfPlayer(s.token);
        if (!n || world.ownerOf(terrAtTile(x, y)) !== n.id) return send(ws, { t: 'err', text: '우리 나라 땅의 나무만 벨 수 있어요' });
        s.lastChop = now(); world.s.chopped[i] = 1; dirty = true;
        n.wood = (n.wood || 0) + NUM.woodPerTree; sendViews([n.id]);
        const msg = JSON.stringify({ t: 'chopped', i }); for (const o of online.values()) if (o.ws.readyState === 1) o.ws.send(msg);
        send(ws, { t: 'ok', text: `🪵 목재 +${NUM.woodPerTree} (우리 저장소)` });
        break;
      }
      case 'mine': { // 금광: 영토마다 하루 1번, 사람마다
        const n = world.nationOfPlayer(s.token); const tid = m.terr | 0;
        if (!n) return send(ws, { t: 'err', text: '나라가 있어야 캔 코인을 모을 수 있어요' });
        const mp = mineOf(tid); if (!mp || !nextTo(s, mp[0], mp[1], 2.2)) return send(ws, { t: 'err', text: '금광 바로 옆에서 캐요' });
        const day = gameDayKey(); s.acc.mined = s.acc.mined && s.acc.mined.day === day ? s.acc.mined : { day, ids: [] };
        if (s.acc.mined.ids.includes(tid)) return send(ws, { t: 'err', text: '이 금광은 오늘 이미 캤어요' });
        const got = 300 + Math.floor(Math.random() * 31) * 10;
        s.acc.mined.ids.push(tid); n.coin += got; dirty = true; sendViews([n.id]);
        send(ws, { t: 'mined', terr: tid, text: `금광에서 코인 ${got}을 캤어요 (우리 저장소)` });
        break;
      }
      case 'buy': { // 하늘 거래소
        const n = world.nationOfPlayer(s.token);
        if (!n) return send(ws, { t: 'err', text: '나라가 있어야 살 수 있어요 (나라 공용 저장소에서 내요)' });
        if (s.scene !== 'sky' || s.room !== 'market') return;
        const item = String(m.item), cnt = Math.max(1, Math.min(50, m.n | 0));
        let cost, label;
        if (item === 'vaccine') { cost = NUM.vaccineBase + NUM.vaccineStep * (n.vaccBought || 0); label = '백신 1개'; }
        else if (NUM.price[item]) { cost = NUM.price[item] * cnt; label = `${{ floor: '바닥', wall: '방벽', trap: '덫' }[item]} ${cnt}개`; }
        else return;
        if (n.coin < cost) return send(ws, { t: 'err', text: `우리 저장소 코인이 ${cost - n.coin} 모자라요` });
        n.coin -= cost;
        if (item === 'vaccine') { n.vaccine = (n.vaccine || 0) + 1; n.vaccBought = (n.vaccBought || 0) + 1; }
        else { n.items = n.items || {}; n.items[item] = (n.items[item] || 0) + cnt; }
        dirty = true; sendViews([n.id]);
        notifyNation(n.id, `🛒 ${s.acc.name}님이 ${label} 구매 (코인 −${cost})`);
        break;
      }
      case 'place': case 'pickup': { // 우리 땅에 바닥·방벽·덫 놓기 / 거두기. 바닥·방벽은 한 번에 최대 9칸 (1칸·가로3·세로3·3×3)
        const n = world.nationOfPlayer(s.token); if (!n) return send(ws, { t: 'err', text: '나라가 있어야 설치할 수 있어요' });
        const k = ['floor', 'wall', 'trap'].includes(m.k) ? m.k : null;
        let list = Array.isArray(m.tiles) ? m.tiles.slice(0, 9) : [[m.x, m.y]];
        if (k === 'trap' && m.t === 'place') list = list.slice(0, 1);
        list = list.map((p) => [p[0] | 0, p[1] | 0]);
        n.items = n.items || {};
        let done = 0, why = '';
        for (const [x, y] of list) {
          const i = tileIdx(x, y);
          if (!nextTo(s, x, y, 3.6)) { why = '너무 멀어요'; continue; }
          if (world.ownerOf(terrAtTile(x, y)) !== n.id) { why = '우리 나라 땅에만 놓을 수 있어요'; continue; }
          if (m.t === 'pickup') {
            const e = world.s.tiles[i];
            if (e && e.n === n.id) { delete world.s.tiles[i]; n.items[e.k] = (n.items[e.k] || 0) + 1; sendTile(i); done++; }
            else if (world.s.traps[i] === n.id) { delete world.s.traps[i]; n.items.trap = (n.items.trap || 0) + 1; sendTrap(n.id, i, false); done++; }
            continue;
          }
          if (!k) return;
          if (!(n.items[k] > 0)) { why = '저장소에 남은 게 없어요 (하늘 거래소에서 사요)'; break; }
          if (!walkableTerrain(tileAt(x, y)) || treeHere(x, y) && !world.s.chopped[i]) { why = '놓을 수 없는 칸이 있어요'; continue; }
          if (reservedTile(x, y)) { why = '제단·포털·저장소 바로 옆엔 못 놓아요'; continue; }
          const cur = world.s.tiles[i];
          if (world.s.traps[i] || (cur && !(k === 'floor' && cur.k === 'floor' && cur.n === n.id))) { why = '이미 뭔가 놓인 칸이 있어요'; continue; }
          if (k === 'wall' && Object.values(world.s.tiles).filter((e) => e.n === n.id && e.k === 'wall').length >= NUM.maxWalls) { why = `방벽은 나라당 ${NUM.maxWalls}개까지예요`; break; }
          if (k === 'trap' && trapsOf(n.id).length >= NUM.maxTraps) { why = `덫은 나라당 ${NUM.maxTraps}개까지예요`; break; }
          if (k === 'wall' && [...online.values()].some((o) => o.scene === 'ground' && o.x != null && Math.floor(o.x / 32) === x && Math.floor(o.y / 32) === y)) { why = '사람이 서 있는 칸은 빼고 놓았어요'; continue; }
          if (cur) { cur.c = Math.max(0, Math.min(5, m.c | 0)); sendTile(i); continue; } // 우리 바닥 위에 바닥: 색만 바꿈 (무료)
          n.items[k]--; done++;
          if (k === 'trap') { world.s.traps[i] = n.id; sendTrap(n.id, i, true); }
          else { world.s.tiles[i] = k === 'floor' ? { k, n: n.id, c: Math.max(0, Math.min(5, m.c | 0)) } : { k, n: n.id }; sendTile(i); }
        }
        if (done || m.t === 'place') { dirty = true; sendViews([n.id]); }
        if (!done && why) send(ws, { t: 'err', text: why });
        else if (done && why && list.length > 1) send(ws, { t: 'ok', text: `${done}칸 ${m.t === 'pickup' ? '거둠' : '놓음'} · ${why}` });
        break;
      }
      case 'moveB': { // 설치 모드: 우리 저장소·우리 땅 금광 옮기기
        const n = world.nationOfPlayer(s.token); if (!n) return;
        const x = m.x | 0, y = m.y | 0, i = tileIdx(x, y), kind = m.kind === 'mine' ? 'mine' : 'store', tid = m.terr | 0;
        if (kind === 'mine' && world.ownerOf(tid) !== n.id) return send(ws, { t: 'err', text: '우리 땅의 금광만 옮길 수 있어요' });
        if (!nextTo(s, x, y, 2.2)) return send(ws, { t: 'err', text: '바로 앞 칸에 놓아요' });
        if (world.ownerOf(terrAtTile(x, y)) !== n.id) return send(ws, { t: 'err', text: '우리 나라 땅에만 놓을 수 있어요' });
        if (!walkableTerrain(tileAt(x, y)) || (treeHere(x, y) && !world.s.chopped[i]) || world.s.tiles[i] && world.s.tiles[i].k === 'wall' || world.s.traps[i]) return send(ws, { t: 'err', text: '여기엔 놓을 수 없어요 (나무·방벽·덫이 있거나 걸을 수 없는 칸)' });
        if (reservedTile(x, y)) return send(ws, { t: 'err', text: '제단·포털 바로 옆엔 못 놓아요' });
        if (buildingNear(x, y, kind === 'mine' ? 'mine:' + tid : 'store:' + n.id)) return send(ws, { t: 'err', text: '다른 저장소·금광과 2칸 넘게 떨어져야 해요' });
        if (kind === 'store') n.storePos = [x, y]; else world.s.mines[tid] = [x, y];
        dirty = true; broadcastOwners();
        send(ws, { t: 'ok', text: kind === 'store' ? '저장소를 옮겼어요' : '금광을 옮겼어요' });
        break;
      }
      case 'breakStart': case 'breakWall': { // 남의 방벽 부수기: 5초 동안 붙어 있어야 함
        const x = m.x | 0, y = m.y | 0, i = tileIdx(x, y), e = world.s.tiles[i];
        const n = world.nationOfPlayer(s.token);
        if (!e || e.k !== 'wall' || (n && n.id === e.n) || !nextTo(s, x, y)) return;
        if (m.t === 'breakStart') {
          s.breaking = { i, at: now() };
          if (now() - (s.lastBreakAlert || 0) > 15000) { s.lastBreakAlert = now(); notifyNation(e.n, `🧱 방벽이 공격받고 있어요! (${(world.t[terrAtTile(x, y)] || {}).name} · ${n ? n.name + '의 ' : ''}${s.acc.name})`); }
          return;
        }
        if (!s.breaking || s.breaking.i !== i || now() - s.breaking.at < NUM.wallBreakSec * 1000 - 300) return;
        s.breaking = null; delete world.s.tiles[i]; dirty = true; sendTile(i);
        notifyNation(e.n, `🧱 ${(world.t[terrAtTile(x, y)] || {}).name}의 방벽이 부서졌어요!`);
        send(ws, { t: 'ok', text: '방벽을 부쉈어요' });
        break;
      }
      case 'stealStart': case 'steal': { // 적 저장소 털기: 3초 꾹 → 들 수 있는 만큼
        const n = world.nationOfPlayer(s.token), V = world.nation(String(m.nid || ''));
        if (!n || !V || V.dead || V.id === n.id) return;
        if (!nearStore(s, V)) return send(ws, { t: 'err', text: '저장소 입구 바로 옆에서만 털 수 있어요' });
        if (s.acc.carry) return send(ws, { t: 'err', text: '이미 훔친 걸 들고 있어요. 우리 저장소에 먼저 넣으세요' });
        s.acc.stoleAt = s.acc.stoleAt || {};
        const wait = (s.acc.stoleAt[V.id] || 0) + 30 * 60e3 - Date.now();
        if (wait > 0) return send(ws, { t: 'err', text: `이 나라 저장소는 ${Math.ceil(wait / 60e3)}분 뒤에 다시 털 수 있어요` });
        if (m.t === 'stealStart') {
          s.stealing = { nid: V.id, at: now() };
          if (now() - (s.lastStealAlert || 0) > 15000) { s.lastStealAlert = now(); notifyNation(V.id, `🚨 ${n.name}의 ${s.acc.name}이(가) 우리 저장소를 털고 있어요! 수도로!`); }
          return;
        }
        if (!s.stealing || s.stealing.nid !== V.id || now() - s.stealing.at < NUM.stealSec * 1000 - 300) return;
        s.stealing = null;
        const coin = Math.min(NUM.carry.coin, V.coin), wood = Math.min(NUM.carry.wood, V.wood || 0);
        if (!coin && !wood) return send(ws, { t: 'err', text: '저장소가 텅 비었어요' });
        V.coin -= coin; V.wood = (V.wood || 0) - wood; s.acc.carry = { coin, wood, from: V.id }; s.acc.stoleAt[V.id] = Date.now(); dirty = true;
        sendViews([V.id]); sendMeta(s);
        notifyNation(V.id, `💰 저장소를 털렸어요! 코인 −${coin}${wood ? `, 목재 −${wood}` : ''} · ${s.acc.name}을(를) 우리 땅에서 잡으면 돌려받아요`);
        send(ws, { t: 'carry', carry: s.acc.carry, text: `훔쳤어요! 코인 ${coin}${wood ? ` · 목재 ${wood}` : ''} · 우리 저장소까지 가져가세요 (잡히면 다 뺏겨요)` });
        break;
      }
      case 'deposit': { // 훔친 것 우리 저장소에 넣기
        const n = world.nationOfPlayer(s.token), c = s.acc.carry; if (!n || !c) return;
        if (!nearStore(s, n)) return;
        n.coin += c.coin; n.wood = (n.wood || 0) + c.wood; s.acc.carry = null; dirty = true;
        sendViews([n.id]); sendMeta(s); send(ws, { t: 'carry', carry: null, text: `우리 저장소에 넣었어요: 코인 +${c.coin}${c.wood ? `, 목재 +${c.wood}` : ''}` });
        notifyNation(n.id, `💰 ${s.acc.name}님이 훔쳐 온 코인 ${c.coin}${c.wood ? `, 목재 ${c.wood}` : ''}을(를) 저장소에 넣었어요`);
        break;
      }
      case 'arrest': { // 우리 땅에 들어온 적 체포
        const n = world.nationOfPlayer(s.token); const o = online.get(m.id | 0);
        if (!n || !o || o === s || now() - (s.lastArrest || 0) < 5000) return;
        const on = world.nationOfPlayer(o.token);
        if (!on || on.id === n.id) return send(ws, { t: 'err', text: '다른 나라 사람만 체포할 수 있어요' });
        if (s.scene !== 'ground' || o.scene !== 'ground' || o.x == null || Math.hypot(o.x - s.x, o.y - s.y) > 56) return send(ws, { t: 'err', text: '더 가까이 가야 해요' });
        if (world.ownerOf(terrAtPx(o.x, o.y)) !== n.id) return send(ws, { t: 'err', text: '우리 땅 안에 있는 사람만 체포할 수 있어요' });
        s.lastArrest = now();
        const c = o.acc.carry; let back = '';
        if (c) { const V = world.nation(c.from); const to = V && !V.dead ? V : n; to.coin += c.coin; to.wood = (to.wood || 0) + c.wood; o.acc.carry = null; back = ` · 훔친 코인 ${c.coin}${c.wood ? `, 목재 ${c.wood}` : ''}을(를) ${to === n ? '되찾았어요' : to.name + '에 돌려줬어요'}`; sendViews([to.id]); }
        const day = gameDayKey(); o.acc.arrests = o.acc.arrests && o.acc.arrests.day === day ? o.acc.arrests : { day, n: 0 }; o.acc.arrests.n++;
        let jail = false;
        if (o.acc.arrests.n >= NUM.arrestJail) { jail = true; o.acc.jailUntil = Date.now() + NUM.jailMin * 60e3; o.acc.arrests.n = 0; }
        dirty = true;
        placeAt(o, jail ? JAIL_POS : capitalPos(o.acc, o.token));
        send(o.ws, { t: 'arrested', jailUntil: jail ? o.acc.jailUntil : 0, carry: null, text: jail ? `⛓ ${n.name}에게 오늘 ${NUM.arrestJail}번째로 잡혔어요. 감옥 ${NUM.jailMin}분!` : `🚨 ${n.name}의 ${s.acc.name}에게 잡혀서 수도로 쫓겨났어요 (오늘 ${o.acc.arrests.n}번 · ${NUM.arrestJail}번이면 감옥)` });
        sendMeta(o);
        notifyNation(n.id, `🚔 ${s.acc.name}님이 ${on.name}의 ${o.acc.name}을(를) 체포했어요${jail ? ' · 감옥행!' : ''}${back}`);
        notifyNation(on.id, `🚔 ${o.acc.name}님이 ${n.name}에게 잡혔어요${jail ? ' · 감옥 ' + NUM.jailMin + '분' : ''}`);
        break;
      }
      case 'hit': { // 적 수정 때리기 → 10번이면 그 나라 병력이 보임
        const t = world.t[m.terr | 0]; if (!t) return;
        const own = world.ownerOf(t.id), n = world.nationOfPlayer(s.token);
        if (!own || (n && n.id === own) || !nextTo(s, t.altar[0], t.altar[1], 2.6) || now() - (s.lastHit || 0) < 250) return;
        s.lastHit = now();
        // 개인별로 센다 (1분 안에 10번). 주변 사람에게는 보내지 않음 (사람이 많아도 가볍게)
        s.hits = s.hits && s.hits.terr === t.id && now() - s.hits.at < 60000 ? s.hits : { terr: t.id, n: 0 };
        s.hits.n++; s.hits.at = now();
        send(ws, { t: 'hitn', terr: t.id, n: s.hits.n, need: NUM.scoutHits });
        if (s.hits.n >= NUM.scoutHits) {
          s.hits = null; const D = world.nation(own);
          // 첩보 카드: 이 나라가 우리를 공격할 때 전선 하나를 볼 수 있음 (사람마다 이 나라에서 2시간에 1장)
          s.acc.scoutAt = s.acc.scoutAt || {}; let card = '';
          if (n && Date.now() - (s.acc.scoutAt[D.id] || 0) > 2 * 3600e3) { s.acc.scoutAt[D.id] = Date.now(); n.intel = n.intel || {}; n.intel[D.id] = (n.intel[D.id] || 0) + 1; dirty = true; sendViews([n.id]); card = ` · ${D.name} 전용 첩보 +1장`; }
          send(ws, { t: 'scout', terr: t.id, text: `🔍 ${D.name}의 병력: ${D.army}명 (영토 ${world.territoriesOf(D.id).length}곳)${card}` });
        }
        break;
      }
      case 'wander': { // 유랑민 등록소: 귀화 신청 / 용병 등록 / 건국 대기
        if (s.scene !== 'sky' || s.room !== 'wander') return;
        const kind = ['naturalize', 'mercenary', 'found'].includes(m.kind) ? m.kind : null;
        if (!kind) return;
        state.wander = state.wander.filter((w) => w.token !== s.token);
        if (!m.cancel) state.wander.push({ token: s.token, id: s.id, name: s.acc.name, kind, target: clean(m.target, 12), ts: Date.now() });
        dirty = true;
        const pub = state.wander.map(({ token, ...rest }) => rest);
        for (const o of online.values()) if (o.scene === 'sky' && o.room === 'wander') send(o.ws, { t: 'wander', list: pub });
        send(ws, { t: 'wander', list: pub });
        break;
      }
    }
  });

  ws.on('close', () => {
    clearInterval(refill);
    if (!s) return;
    online.delete(s.id);
    for (const o of online.values()) if (o.known.has(s.id)) { o.known.delete(s.id); send(o.ws, { t: 'leave', id: s.id }); }
  });
});

const now = () => Date.now();
function near(a, b) {
  if (a.x == null || b.x == null || a.scene !== b.scene) return false;
  if (a.scene === 'sky') return a.room === b.room;
  return Math.abs(a.x - b.x) < AOI_X && Math.abs(a.y - b.y) < AOI_Y;
}

// 주변 사람 위치만 묶어서 보낸다 (전송량 절약)
//  - 움직인 사람(또는 새로 보이게 된 사람)만 보냄
//  - 이진 형식: [1][접속자 수 u16] + 사람마다 [id u32][x u16][y u16][방향·걷기·얼굴 1바이트] = 9바이트
//  - 너무 많으면 가까운 VIEW_CAP명만
let lastCountSent = 0, countAt = 0;
setInterval(() => {
  const n = online.size, sendCount = n !== lastCountSent || Date.now() - countAt > 5000;
  if (sendCount) { lastCountSent = n; countAt = Date.now(); }
  for (const viewer of online.values()) {
    if (viewer.x == null || viewer.ws.readyState !== 1) continue;
    let list = [];
    for (const o of online.values()) if (o !== viewer && near(viewer, o)) list.push(o);
    if (list.length > VIEW_CAP) { // 이미 보이던 사람은 그대로 두고, 남는 자리만 가까운 새 사람으로 채움 (들락날락 메시지 방지)
      const keep = list.filter((o) => viewer.known.has(o.id)).slice(0, VIEW_CAP);
      if (keep.length < VIEW_CAP) { const d = (o) => (o.x - viewer.x) ** 2 + (o.y - viewer.y) ** 2; const fresh = list.filter((o) => !viewer.known.has(o.id)).sort((a, b) => d(a) - d(b)); list = keep.concat(fresh.slice(0, VIEW_CAP - keep.length)); }
      else list = keep;
    }
    const seen = new Set(), out = [];
    for (const o of list) {
      seen.add(o.id);
      const fresh = !viewer.known.has(o.id);
      if (fresh) { viewer.known.add(o.id); send(viewer.ws, { t: 'meta', p: meta(o) }); }
      if (fresh || o.moved) out.push(o);
    }
    for (const id of viewer.known) if (!seen.has(id)) { viewer.known.delete(id); send(viewer.ws, { t: 'leave', id }); }
    if (!out.length && !sendCount) continue;
    const b = Buffer.allocUnsafe(3 + out.length * 9); b[0] = 1; b.writeUInt16LE(Math.min(n, 65535), 1);
    out.forEach((o, i) => { const q = 3 + i * 9; b.writeUInt32LE(o.id >>> 0, q); b.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(o.x))), q + 4); b.writeUInt16LE(Math.max(0, Math.min(65535, Math.round(o.y))), q + 6); b[q + 8] = (o.dir < 0 ? 1 : 0) | (o.moving ? 2 : 0) | ((o.face & 3) << 2); });
    viewer.ws.send(b);
  }
  for (const o of online.values()) o.moved = false;
}, TICK_MS);

// ------------------------------------------------------------ 나라·전투 방송
function broadcastOwners() {
  const msg = JSON.stringify({ t: 'owners', owners: world.s.owner, nations: pubNations(), battles: world.publicBattles(), mines: world.s.mines, gone: Object.keys(world.s.gone).map(Number), riftNext: world.s.riftNext });
  for (const o of online.values()) if (o.ws.readyState === 1) o.ws.send(msg);
}
function sendViews(nids) {
  // 목재가 늘어 저장소 모습 단계가 바뀌면 모두에게 알림
  let lv = false; for (const id of nids) { const n = world.nation(id); if (!n) continue; const v = (n.wood || 0) >= 1000 ? 2 : (n.wood || 0) >= 500 ? 1 : 0; if (n._lv !== v) { n._lv = v; lv = true; } }
  if (lv) broadcastOwners();
  for (const o of online.values()) {
    const n = world.nationOfPlayer(o.token);
    if (n && nids.includes(n.id)) send(o.ws, { t: 'view', view: world.view(n.id, o.token) });
  }
}
function notifyNation(nid, text) {
  const n = world.nation(nid); if (!n) return;
  for (const o of online.values()) if (n.members.includes(o.token)) send(o.ws, { t: 'ok', text });
}
function resolveNight(why, slot) {
  const before = Object.assign({}, world.s.owner);
  const reports = world.resolveAll(slot);
  for (const r of reports) {
    if (!r.lost.length) continue;
    const A = world.nation(r.att), D = world.nation(r.def), lostSet = new Set(r.lost);
    // 빼앗은 땅에 있던 저장소 입구는 공격팀의 입구가 됨
    const take = (p) => p && lostSet.has(terrAtTile(p[0], p[1]));
    if (D) {
      const moved = [];
      if (D.storePos && take(D.storePos)) { moved.push(D.storePos); delete D.storePos; }
      D.extraStores = (D.extraStores || []).filter((p) => (take(p) ? (moved.push(p), false) : true));
      if (A) A.extraStores = (A.extraStores || []).concat(moved);
    }
    // 멸망: 팀원은 유랑민
    if (r.destroyed && r.members) for (const key of r.members) { const o = [...online.values()].find((x) => x.token === key); if (o) { send(o.ws, { t: 'ok', text: `💀 ${r.defName}이(가) 멸망했어요. 이제 유랑민이에요 — 하늘 유랑민 등록소에서 다른 나라로 귀화할 수 있어요` }); sendMeta(o); } }
  }
  for (const tid of Object.keys(world.s.mines)) if (world.s.owner[tid] !== before[tid]) delete world.s.mines[tid]; // 주인이 바뀐 영토의 금광은 기본 자리로
  for (const n of world.alive()) if (n.storePos && world.ownerOf(terrAtTile(n.storePos[0], n.storePos[1])) !== n.id) delete n.storePos; // 저장소 자리를 빼앗기면 수도 옆으로
  state.lastResolved = `${gameClock().day}일차 ${SLOT_LABEL[gameClock().slot]}`; dirty = true; saveState();
  console.log(`[전투] ${why}: ${reports.length}건 처리`);
  broadcastOwners();
  for (const o of online.values()) {
    const n = world.nationOfPlayer(o.token);
    send(o.ws, { t: 'night', reports: n ? reports.filter((r) => r.att === n.id || r.def === n.id || n.members.length && (world.nation(r.att) || {}).id === n.id) : [], view: n ? world.view(n.id, o.token) : null });
  }
}
// 감옥에서 풀어 주기
setInterval(() => {
  for (const o of online.values()) if (o.acc.jailUntil && !jailed(o.acc)) { o.acc.jailUntil = 0; dirty = true; placeAt(o, capitalPos(o.acc, o.token)); send(o.ws, { t: 'released', text: '감옥에서 풀려났어요. 수도로 돌아왔어요' }); sendMeta(o); }
}, 5000);
// 시계가 다음 시간대로 넘어갈 때: 점심·밤 → 전투 처리, 아침 → 멸망 선포·균열 예고·균열 웨이브
const doomDay = () => state.doomDay || 5;
const waveDay = (k) => doomDay() + 2 * k - 1; // 선포 다음 날부터 이틀마다 (기본 6·8·10·12·14일차)
function clockMsg() { const c = gameClock(); return { t: 'clock', day: c.day, slot: c.slot, doomDay: doomDay(), lastDay: LAST_DAY, riftNext: world.s.riftNext, gone: Object.keys(world.s.gone).map(Number) }; }
function onEnter(c) {
  if (c.slot === 'lunch' || c.slot === 'night') resolveNight(`${c.day}일차 ${SLOT_LABEL[c.slot]}`, slotIdx(c.day, c.slot));
  // 멸망 선포: 선포일 점심. 첫 균열 예고도 그때
  if (c.slot === 'lunch' && c.day === doomDay()) { broadcastNotice(`⚡ 신들이 선포했다: ${LAST_DAY}일차(12/28), 이 세계는 멸망한다. 내일부터 균열이 땅을 삼킨다.`); forecast(1); }
  if (c.slot !== 'morning') return;
  for (let k = 1; k <= 5; k++) {
    if (c.day === waveDay(k)) doWave(k);
    if (k >= 2 && c.day === waveDay(k) - 1) forecast(k); // 하루 전 아침에 예고
  }
}
function forecast(k) {
  const terrs = MAP.territories.filter((t) => t.rift === k && !world.s.gone[t.id]).map((t) => t.id);
  world.s.riftNext = { wave: k, day: waveDay(k), terrs }; dirty = true;
  const regions = [...new Set(terrs.map((tid) => world.t[tid].region).filter(Boolean))].slice(0, 4).join('·');
  for (const o of online.values()) send(o.ws, { t: 'ok', text: `🔮 신탁: 내일(${waveDay(k)}일차) 균열이 ${terrs.length}곳을 삼킨다${regions ? ` (${regions} 쪽)` : ''}. 백신으로 땅을 지켜라!` });
}
function doWave(k) {
  const terrs = world.s.riftNext && world.s.riftNext.wave === k ? world.s.riftNext.terrs : MAP.territories.filter((t) => t.rift === k).map((t) => t.id);
  const r = world.riftWave(k, terrs);
  const fellIds = new Set(r.fell.map((f) => f.tid));
  for (const i of Object.keys(world.s.tiles)) if (fellIds.has(terrAtTile(i % MAP.width, Math.floor(i / MAP.width)))) delete world.s.tiles[i];
  for (const i of Object.keys(world.s.traps)) if (fellIds.has(terrAtTile(i % MAP.width, Math.floor(i / MAP.width)))) delete world.s.traps[i];
  for (const tid of fellIds) delete world.s.mines[tid];
  for (const n of world.alive()) if (n.storePos && fellIds.has(terrAtTile(n.storePos[0], n.storePos[1]))) delete n.storePos;
  for (const o of online.values()) if (o.scene === 'ground' && o.x != null && fellIds.has(terrAtPx(o.x, o.y))) placeAt(o, capitalPos(o.acc, o.token) || { x: o.x, y: o.y, scene: 'sky', room: 'temple' });
  dirty = true; broadcastOwners();
  for (const o of online.values()) { const n = world.nationOfPlayer(o.token); const mine = n ? r.fell.filter((f) => f.owner === n.id).length : 0; send(o.ws, { t: 'rift', wave: k, fell: [...fellIds], text: `🌀 균열 ${k}차: 땅 ${fellIds.size}곳이 사라졌다${mine ? ` · 우리 땅 ${mine}곳을 잃었어요` : ''}${r.saved.length ? ` · ${r.saved.length}곳은 백신·수도라 버텼어요` : ''}` }); }
  console.log(`[균열] ${k}차: ${fellIds.size}곳 무너짐, ${r.saved.length}곳 버팀`);
}
function broadcastNotice(text) { state.notice = { text, ts: Date.now() }; dirty = true; const msg = JSON.stringify({ t: 'notice', notice: state.notice }); for (const o of online.values()) if (o.ws.readyState === 1) o.ws.send(msg); }
function tickClock() {
  world.s.curSlot = battleSlotFor();
  const cur = clockKey(gameClock());
  if (state.lastClockKey == null) state.lastClockKey = cur; // 처음 켤 때는 지난 일을 다시 하지 않음
  if (cur < state.lastClockKey) state.lastClockKey = cur; // 관리자가 되돌리면 그냥 맞춤
  let steps = 0;
  while (state.lastClockKey < cur && steps++ < 60) { state.lastClockKey++; onEnter(fromKey(state.lastClockKey)); }
  if (steps || clockSig !== cur) { clockSig = cur; dirty = true; const msg = JSON.stringify(clockMsg()); for (const o of online.values()) if (o.ws.readyState === 1) o.ws.send(msg); }
}
let clockSig = null;
setInterval(tickClock, 10000);

// ------------------------------------------------------------ 관리자(신) 화면 API: POST /admin/api
// 비밀번호는 Render 환경변수 ADMIN_KEY. 없으면 관리자 기능 전체가 꺼진다.
const adminFails = new Map(); // ip -> { n, until }
function keyOk(k) {
  if (!ADMIN_KEY || typeof k !== 'string') return false;
  const a = crypto.createHash('sha256').update(k).digest(), b = crypto.createHash('sha256').update(ADMIN_KEY).digest();
  return crypto.timingSafeEqual(a, b);
}
function adminHttp(req, res) {
  const out = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST') return out(405, { ok: false, err: 'POST only' });
  if (!ADMIN_KEY) return out(503, { ok: false, err: '서버에 ADMIN_KEY가 설정되지 않았어요 (Render → Environment)' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const f = adminFails.get(ip);
  if (f && f.until > Date.now()) return out(429, { ok: false, err: '비밀번호를 여러 번 틀렸어요. 30초 뒤에 다시 해 주세요' });
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 4e6) req.destroy(); }); // 문제 그림 때문에 넉넉하게
  req.on('end', async () => {
    let m; try { m = JSON.parse(body); } catch (e) { return out(400, { ok: false, err: '잘못된 요청' }); }
    if (!keyOk(m.key)) {
      const g = adminFails.get(ip) || { n: 0, until: 0 }; g.n++; if (g.n >= 10) { g.n = 0; g.until = Date.now() + 30e3; } adminFails.set(ip, g); // 같은 학교 와이파이로 여럿이 들어와도 덜 막히게
      return out(401, { ok: false, err: '비밀번호가 달라요' });
    }
    adminFails.delete(ip);
    try { out(200, await adminOp(m)); } catch (e) { console.error('[관리자] 오류:', e); out(500, { ok: false, err: '서버 오류: ' + e.message }); }
  });
}
const COUPON_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O, 1/I/L 제외
function newCouponCode() {
  for (;;) {
    const b = Array.from(crypto.randomBytes(8), (x) => COUPON_CHARS[x % COUPON_CHARS.length]).join('');
    const code = `MP-${b.slice(0, 4)}-${b.slice(4)}`;
    if (!state.coupons[code]) return code;
  }
}
function adminStatus() {
  const nations = Object.values(world.s.nations).map((n) => ({
    id: n.id, name: n.name, color: n.color, king: n.kingName, dead: !!n.dead, mergedInto: n.mergedInto || null,
    wood: n.wood || 0, members: n.members.map((k) => (n.memberNames || {})[k] || '?'), online: n.members.filter((k) => [...online.values()].some((o) => o.token === k)).length,
    territories: world.territoriesOf(n.id).length, army: n.army, coin: n.coin, code: n.code,
  })).sort((a, b) => a.dead - b.dead || b.territories - a.territories);
  const coupons = Object.entries(state.coupons).map(([code, c]) => ({ code, r: c.r, memo: c.memo || '', at: c.at, used: c.used || null }));
  return {
    ok: true, now: Date.now(), kstDay: kstDay(), clock: gameClock(), clockMode: (state.clock || {}).mode || 'auto', doomDay: doomDay(), riftNext: world.s.riftNext, goneCount: Object.keys(world.s.gone).length, waveDays: [1, 2, 3, 4, 5].map(waveDay), uptimeSec: Math.round((Date.now() - BOOT_AT) / 1000), storage: store ? store.kind : '없음',
    online: online.size, accounts: Object.keys(state.accounts).length, nations, battles: world.s.battles.length, night: world.s.night,
    lastResolved: state.lastResolved || null, testMode: testMode(), envTestMode: ENV_TEST_MODE, settings: state.settings, foundingOpen: foundingOpen(),
    foundingLastDay: FOUNDING_LAST_DAY, puzzles: bank().length, puzzleFile: path.basename(PUZZLE_FILE), samplePuzzlesOnly: SAMPLE_FILE && !state.puzzles.length, notice: state.notice || null, coupons,
    wander: state.wander.length,
  };
}
// ---- 맵 고치기 소품: { r: 'x:그림이름' | 'u:동물이름', b: 1(막힘)|0 }
function cleanProp(v) { if (!v || typeof v !== 'object') return null; const r = String(v.r || ''); if (!/^[xu]:[a-z0-9_]{1,24}$/.test(r)) return null; return { r, b: v.b ? 1 : 0 }; }
// ---- 문제 관리
const PUZZLE_TYPES = ['기하', '대수', '확통', '미적분', '수열', '논리'];
function newPuzzleId() { for (;;) { const id = 'q' + crypto.randomBytes(4).toString('hex'); if (!findPuzzle(id)) return id; } }
function cleanPuzzle(m) {
  const type = PUZZLE_TYPES.includes(String(m.type || '').trim()) ? String(m.type).trim() : null;
  if (!type) return { err: `유형은 ${PUZZLE_TYPES.join(', ')} 중 하나여야 해요` };
  const question = String(m.question || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, 1000);
  const raw = Array.isArray(m.answer) ? m.answer : String(m.answer || '').split(/[\n|]/);
  const answer = [...new Set(raw.map((a) => String(a).trim().slice(0, 50)).filter(Boolean))].slice(0, 10);
  if (!answer.length) return { err: '정답을 적어 주세요' };
  return { type, question, answer };
}
const IMG_TYPES = { 'image/png': [0x89, 0x50], 'image/jpeg': [0xff, 0xd8], 'image/webp': [0x52, 0x49], 'image/gif': [0x47, 0x49] };
function parseImage(dataUrl) {
  const mm = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!mm) return { err: '그림은 png, jpg, webp, gif 만 돼요' };
  const buf = Buffer.from(mm[2], 'base64');
  if (buf.length > 2.5e6) return { err: '그림이 너무 커요 (2.5MB 이하)' };
  const sig = IMG_TYPES[mm[1]]; if (buf[0] !== sig[0] || buf[1] !== sig[1]) return { err: '그림 파일이 깨졌어요' };
  return { buf, mime: mm[1] };
}
const imgCache = new Map();
async function savePuzzleImage(img) {
  const id = 'img' + crypto.randomBytes(8).toString('hex');
  if (store && store.putImage) await store.putImage(id, img.buf, img.mime);
  imgCache.set(id, img); return '/puzzle-img/' + id;
}
async function delPuzzleImage(url) { const id = String(url).split('/').pop(); imgCache.delete(id); if (store && store.delImage && /^img[0-9a-f]{16}$/.test(id)) await store.delImage(id); }
async function puzzleImage(id, res) {
  if (!/^img[0-9a-f]{16}$/.test(id)) { res.writeHead(404); return res.end(); }
  let img = imgCache.get(id);
  if (!img && store && store.getImage) { img = await store.getImage(id).catch(() => null); if (img) imgCache.set(id, img); }
  if (!img) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=86400, immutable' }); res.end(img.buf);
}
async function adminOp(m) {
  switch (m.op) {
    case 'status': return adminStatus();
    case 'notice': { // 전체 공지 (빈 글이면 공지 내리기)
      const text = clean(m.text, 200);
      state.notice = text ? { text, ts: Date.now() } : null; dirty = true;
      const msg = JSON.stringify({ t: 'notice', notice: state.notice });
      for (const o of online.values()) if (o.ws.readyState === 1) o.ws.send(msg);
      console.log(`[관리자] 공지 ${text ? '올림: ' + text : '내림'}`);
      return { ok: true, sent: online.size };
    }
    case 'resolve': resolveNight('관리자'); return { ok: true };
    case 'groundSave': { // 맵 고치기: 땅 지도. 바뀐 칸만 받는다 (set: 칸→타일 또는 null, walls: 칸→1 또는 0, reset: 전부 지우기)
      const G = state.groundEdits, okKey = (k) => /^\d{1,3},\d{1,3}$/.test(k) && k.split(',').every((v) => +v < 720);
      if (m.reset) { state.groundEdits = { floor: {}, walls: {}, clear: {}, props: {} }; rebuildClear(); dirty = true; const msg = JSON.stringify({ t: 'groundEdit', reset: true }); for (const o of online.values()) if (o.ws.readyState === 1) o.ws.send(msg); return { ok: true, floor: 0, walls: 0 }; }
      const set = {}, walls = {}, clear = {}, props = {}; G.clear = G.clear || {}; G.props = G.props || {};
      for (const [k, v] of Object.entries(m.props || {}).slice(0, 3000)) { if (!okKey(k)) continue; const pv = cleanProp(v); if (pv) G.props[k] = pv; else delete G.props[k]; props[k] = pv; }
      for (const [k, v] of Object.entries(m.clear || {}).slice(0, 5000)) { if (!okKey(k)) continue; if (v) { G.clear[k] = 1; clear[k] = 1; } else { delete G.clear[k]; clear[k] = 0; } }
      if (Object.keys(clear).length) rebuildClear();
      for (const [k, v] of Object.entries(m.set || {}).slice(0, 5000)) { if (!okKey(k)) continue; if (v === null) { delete G.floor[k]; set[k] = null; } else if (/^(town|dungeon|onebit|ninja|winter|water|base):\d{1,4}$/.test(String(v))) { G.floor[k] = String(v); set[k] = String(v); } }
      for (const [k, v] of Object.entries(m.walls || {}).slice(0, 5000)) { if (!okKey(k)) continue; if (v) { G.walls[k] = 1; walls[k] = 1; } else { delete G.walls[k]; walls[k] = 0; } }
      if (Object.keys(G.floor).length + Object.keys(G.walls).length > 80000) return { ok: false, err: '땅 지도에 너무 많이 칠했어요' };
      dirty = true;
      const msg = JSON.stringify({ t: 'groundEdit', set, walls, clear, props }); for (const o of online.values()) if (o.ws.readyState === 1) o.ws.send(msg);
      return { ok: true, floor: Object.keys(G.floor).length, walls: Object.keys(G.walls).length, clear: Object.keys(G.clear).length, props: Object.keys(G.props).length };
    }
    case 'roomSave': { // 맵 고치기: 하늘 방 하나의 바닥 타일·장벽 저장 → 모두에게 바로 반영
      const id = String(m.id || ''); if (!/^[a-z0-9]{2,16}$/.test(id)) return { ok: false, err: '방 이름이 이상해요' };
      // 관리자 여러 명이 같이 고쳐도 덮어쓰지 않게: 바뀐 칸만 받아서 합친다 (set: 칸→타일|null, walls: 칸→1|0, hideProps, reset)
      const okKey = (k) => /^\d{1,3},\d{1,3}$/.test(k), okRef = (v) => /^(town|dungeon|onebit|ninja|winter|water|base):\d{1,4}$/.test(String(v));
      if (m.reset) state.roomEdits[id] = { floor: {}, walls: {}, props: {}, hideProps: false };
      const R = state.roomEdits[id] = state.roomEdits[id] || { floor: {}, walls: {}, hideProps: false }; R.floor = R.floor || {}; R.walls = R.walls || {};
      const set = {}, walls = {}, props = {}; R.props = R.props || {};
      for (const [k, v] of Object.entries(m.props || {}).slice(0, 3000)) { if (!okKey(k)) continue; const pv = cleanProp(v); if (pv) R.props[k] = pv; else delete R.props[k]; props[k] = pv; }
      for (const [k, v] of Object.entries(m.set || {}).slice(0, 5000)) { if (!okKey(k)) continue; if (v === null) { delete R.floor[k]; set[k] = null; } else if (okRef(v)) { R.floor[k] = String(v); set[k] = String(v); } }
      for (const [k, v] of Object.entries(m.walls || {}).slice(0, 5000)) { if (!okKey(k)) continue; if (v) R.walls[k] = 1; else delete R.walls[k]; walls[k] = v ? 1 : 0; }
      if ('hideProps' in m) R.hideProps = !!m.hideProps;
      if (Object.keys(R.floor).length + Object.keys(R.walls).length > 12000) return { ok: false, err: '너무 많아요' };
      dirty = true;
      const msg = JSON.stringify({ t: 'roomEdit', id, diff: { set, walls, props, hideProps: R.hideProps, reset: !!m.reset } }); for (const o of online.values()) if (o.ws.readyState === 1) o.ws.send(msg);
      return { ok: true, floor: Object.keys(R.floor).length, walls: Object.keys(R.walls).length, props: Object.keys(R.props).length };
    }
    case 'clock': { // 게임 시계: auto(실제 시간) / manual(일차·시간대). 앞으로 가면 그 사이 전투·균열이 차례로 일어남
      if (m.mode === 'auto') state.clock = { mode: 'auto' };
      else { const day = Math.max(1, Math.min(LAST_DAY, m.day | 0)); const slot = SLOTS.includes(m.slot) ? m.slot : 'morning'; state.clock = { mode: 'manual', day, slot }; }
      dirty = true; tickClock(); console.log('[관리자] 시계:', JSON.stringify(state.clock));
      return adminStatus();
    }
    case 'doomDay': { state.doomDay = Math.max(1, Math.min(LAST_DAY - 1, m.day | 0)); dirty = true; tickClock(); return adminStatus(); }
    case 'nationAdjust': { // 나라 병력·코인 더하기/빼기
      const n = world.nation(String(m.nid || '')); if (!n || n.dead) return { ok: false, err: '없는 나라예요' };
      const da = Math.trunc(+m.army || 0), dc = Math.trunc(+m.coin || 0), dw = Math.trunc(+m.wood || 0);
      if (Math.abs(da) > 100000 || Math.abs(dc) > 10000000 || Math.abs(dw) > 100000) return { ok: false, err: '숫자가 너무 커요' };
      n.army = Math.max(0, n.army + da); n.coin = Math.max(0, n.coin + dc); n.wood = Math.max(0, (n.wood || 0) + dw); dirty = true;
      sendViews([n.id]);
      const sg = (v) => (v > 0 ? '+' : '') + v;
      if (m.say !== false && (da || dc || dw)) notifyNation(n.id, `✨ 신의 선물: ${[da && `병력 ${sg(da)}`, dc && `코인 ${sg(dc)}`, dw && `목재 ${sg(dw)}`].filter(Boolean).join(', ')}`);
      console.log(`[관리자] ${n.name}: 병력 ${da}, 코인 ${dc}, 목재 ${dw}`);
      return { ok: true, army: n.army, coin: n.coin, wood: n.wood };
    }
    case 'couponCreate': {
      const count = Math.max(1, Math.min(300, m.count | 0));
      const kind = ['army', 'intel'].includes(m.kind) ? m.kind : 'coin';
      const amount = Math.max(1, Math.min(kind === 'army' ? 1000 : kind === 'intel' ? 5 : 100000, m.amount | 0));
      const memo = clean(m.memo, 30);
      const codes = [];
      for (let i = 0; i < count; i++) { const c = newCouponCode(); state.coupons[c] = { r: { [kind]: amount }, memo, at: Date.now(), used: null }; codes.push(c); }
      dirty = true; console.log(`[관리자] 쿠폰 ${count}장 (${kind} ${amount}, ${memo || '메모 없음'})`);
      return { ok: true, codes };
    }
    case 'couponDelete': { // 아직 안 쓴 코드만 지운다
      let n = 0;
      for (const c of Array.isArray(m.codes) ? m.codes : []) if (state.coupons[c] && !state.coupons[c].used) { delete state.coupons[c]; n++; }
      dirty = true; return { ok: true, deleted: n };
    }
    case 'settings': {
      if ('testMode' in m) state.settings.testMode = m.testMode === null ? undefined : !!m.testMode;
      if ('founding' in m) state.settings.founding = ['open', 'closed'].includes(m.founding) ? m.founding : 'auto';
      dirty = true;
      const msg = JSON.stringify({ t: 'settings', testMode: testMode(), foundingOpen: foundingOpen() });
      for (const o of online.values()) if (o.ws.readyState === 1) o.ws.send(msg);
      console.log(`[관리자] 설정: 테스트 모드 ${testMode()}, 건국 ${foundingOpen() ? '가능' : '마감'}`);
      return adminStatus();
    }
    case 'puzzleList': {
      const solvedBy = {};
      for (const a of Object.values(state.accounts)) for (const id of a.solved || []) solvedBy[id] = (solvedBy[id] || 0) + 1;
      return { ok: true, puzzles: state.puzzles.map((q) => Object.assign({}, q, { solved: solvedBy[q.id] || 0 })), types: PUZZLE_TYPES, sampleFile: SAMPLE_FILE ? FILE_PUZZLES.length : 0 };
    }
    case 'puzzleSave': {
      const q = cleanPuzzle(m);
      if (q.err) return { ok: false, err: q.err };
      let old = m.id ? state.puzzles.find((x) => x.id === m.id) : null;
      if (m.id && !old) return { ok: false, err: '없는 문제예요' };
      let image = old ? old.image : null;
      if (m.image === null && image) { await delPuzzleImage(image); image = null; }
      else if (typeof m.image === 'string' && m.image.startsWith('data:')) {
        const img = parseImage(m.image); if (img.err) return { ok: false, err: img.err };
        if (image) await delPuzzleImage(image);
        image = await savePuzzleImage(img);
      }
      if (!q.question && !image) return { ok: false, err: '문제 글이나 그림 중 하나는 있어야 해요' };
      if (old) Object.assign(old, q, { image });
      else { old = Object.assign({ id: newPuzzleId(), at: Date.now(), on: true }, q, { image }); state.puzzles.push(old); }
      dirty = true; console.log(`[관리자] 문제 저장 ${old.id} (${old.type})`);
      return { ok: true, id: old.id };
    }
    case 'puzzleBulk': { // 구글 시트에서 복사한 [유형, 문제, 정답] 줄들
      const rows = Array.isArray(m.rows) ? m.rows.slice(0, 500) : [];
      const added = [], errors = [];
      rows.forEach((r, i) => { const q = cleanPuzzle(r); if (q.err || !q.question) errors.push(`${i + 1}번째 줄: ${q.err || '문제 글이 비었어요'}`); else { const x = Object.assign({ id: newPuzzleId(), at: Date.now(), on: true, image: null }, q); state.puzzles.push(x); added.push(x.id); } });
      if (added.length) dirty = true;
      console.log(`[관리자] 문제 한꺼번에 ${added.length}개 추가`);
      return { ok: true, added: added.length, errors };
    }
    case 'puzzleToggle': { const q = state.puzzles.find((x) => x.id === m.id); if (!q) return { ok: false, err: '없는 문제예요' }; q.on = !!m.on; dirty = true; return { ok: true }; }
    case 'puzzleDelete': {
      const i = state.puzzles.findIndex((x) => x.id === m.id); if (i < 0) return { ok: false, err: '없는 문제예요' };
      const [q] = state.puzzles.splice(i, 1); if (q.image) await delPuzzleImage(q.image);
      dirty = true; console.log(`[관리자] 문제 삭제 ${q.id}`); return { ok: true };
    }
    case 'reset': { // 행사 시작 전 테스트 기록 지우기
      if (m.confirm !== '초기화') return { ok: false, err: "확인 칸에 '초기화'라고 써 주세요" };
      if (store && store.backup) await store.backup(state, 'before-reset-' + new Date().toISOString().replace(/[:.]/g, '-'));
      world.s = require('../client/rules.js').emptyState(); state.world = world.s;
      state.chats = {}; state.wander = []; state.lastResolved = null; state.notice = null; state.lastClockKey = null;
      if (m.coupons) state.coupons = {};
      for (const a of Object.values(state.accounts)) { a.solved = []; a.carry = null; a.arrests = null; a.jailUntil = 0; a.stunUntil = 0; a.mined = null; a.stoleAt = null; if (m.positions) { a.x = null; a.y = null; a.scene = 'ground'; a.room = null; } }
      if (m.accounts) { for (const k of Object.keys(state.accounts)) delete state.accounts[k]; }
      dirty = true; await saveState();
      console.log(`[관리자] 초기화 (계정 ${m.accounts ? '삭제' : '유지'}, 쿠폰 ${m.coupons ? '삭제' : '유지'})`);
      for (const o of online.values()) o.ws.close(4001, 'reset'); // 모두 다시 접속하게
      return { ok: true };
    }
  }
  return { ok: false, err: '모르는 명령: ' + m.op };
}

server.listen(PORT, () => console.log(`MP 2026 서버: http://localhost:${PORT}  (저장: ${store ? store.kind : '없음'})`));
