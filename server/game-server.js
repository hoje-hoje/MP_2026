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
const TICK_MS = 100;               // 위치 방송 주기 (초당 10번)
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
    const body = isWorld ? publicWorld() : fs.readFileSync(file);
    const type = url.pathname === '/admin' ? MIME['.html'] : MIME[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, ETag: etag });
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
const { sameAnswer, NUM, treeKind, storageSpot, T: TT } = require('../client/rules.js');
// ---- 영지: 지형·저장소·설치물
const TERRAIN = Buffer.from(MAP.terrain_b64, 'base64');
const tileAt = (x, y) => (x < 0 || y < 0 || x >= MAP.width || y >= MAP.height) ? TT.VOID : TERRAIN[y * MAP.width + x];
const terrAtTile = (x, y) => terrAtPx(x * 32 + 16, y * 32 + 16);
const walkableTerrain = (k) => k === TT.GRASS || k === TT.FOREST || k === TT.SAND;
const tileIdx = (x, y) => y * MAP.width + x;
function storageOf(n) { return n && world.t[n.capital] ? storageSpot(world.t[n.capital], tileAt) : null; }
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
state.puzzles = state.puzzles || [];     // 관리자 화면에서 넣은 문제 [{ id, type, question, image, answer:[], on, at }]
const testMode = () => typeof state.settings.testMode === 'boolean' ? state.settings.testMode : ENV_TEST_MODE;
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const FOUNDING_LAST_DAY = process.env.FOUNDING_LAST_DAY || '2026-12-15'; // 건국은 D2(12/15)까지
const foundingOpen = () => state.settings.founding === 'open' ? true : state.settings.founding === 'closed' ? false : testMode() || kstDay() <= FOUNDING_LAST_DAY;
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
function filterBad(text) { let t = text; for (const w of BANNED) t = t.split(w).join('♡'.repeat(w.length)); return t; }

// ------------------------------------------------------------ WebSocket
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function meta(s) {
  const n = world.nationOfPlayer(s.token);
  return { id: s.id, name: s.acc.name, team: s.acc.team, look: s.acc.look, nid: n ? n.id : null, carry: !!s.acc.carry, red: arrestsToday(s.acc), jailed: jailed(s.acc) };
}
// 체포 횟수 (하루 단위), 감옥
function arrestsToday(acc) { return acc.arrests && acc.arrests.day === kstDay() ? acc.arrests.n : 0; }
const jailed = (acc) => (acc.jailUntil || 0) > Date.now();
function sendMeta(s) { const mm = { t: 'meta', p: meta(s) }; for (const o of online.values()) if (o === s || o.known.has(s.id)) send(o.ws, mm); }
function capitalPos(acc, token) { // 그 사람 나라 수도 포털 앞 (나라 없으면 null)
  const n = world.nationOfPlayer(token); const t = n && world.t[n.capital];
  return t ? { x: t.portal[0] * 32 + 16, y: (t.portal[1] + 1) * 32 + 16, scene: 'ground', room: null } : null;
}
const JAIL_POS = { x: 7 * 32 + 16, y: 5 * 32 + 16, scene: 'sky', room: 'jail' };
function placeAt(s, pos) { if (!pos) return; Object.assign(s, { x: pos.x, y: pos.y, scene: pos.scene, room: pos.room }); Object.assign(s.acc, pos); dirty = true; send(s.ws, { t: 'warp', pos }); }

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
      acc.name = clean(m.name, 10) || '이름없음';
      acc.team = team;
      acc.look = cleanLook(m.look);
      dirty = true;
      // 같은 계정으로 이미 접속 중이면 이전 접속을 끊는다
      for (const o of online.values()) if (o.token === token) o.ws.close(4000, 'replaced');
      s = { id: nextId++, ws, token, acc, x: acc.x, y: acc.y, dir: 1, moving: 0, scene: acc.scene || 'ground', room: acc.room || null, lastMove: Date.now(), known: new Set() };
      online.set(s.id, s);
      const nat = world.nationOfPlayer(token); // 나라는 건국 화면에서 세우거나 초대 코드로 들어간다
      if (nat) { world.refreshActions(nat, kstDay()); if (nat.memberNames) nat.memberNames[token] = acc.name; }
      send(ws, {
        t: 'welcome', id: s.id, token, pos: jailed(acc) ? JAIL_POS : acc.x == null ? null : { x: acc.x, y: acc.y, scene: s.scene, room: s.room }, carry: acc.carry || null, red: arrestsToday(acc), jailUntil: jailed(acc) ? acc.jailUntil : 0,
        chat: nat ? (state.chats['nation:' + nat.id] || []).slice(-30) : [], emotes: EMOTES, wander: state.wander,
        view: nat ? world.view(nat.id, token) : null, owners: world.s.owner, nations: world.publicNations(), testMode: testMode(), foundingOpen: foundingOpen(), notice: state.notice || null,
        tiles: world.s.tiles, chopped: Object.keys(world.s.chopped).map(Number), traps: nat ? trapsOf(nat.id) : [], stun: Math.max(0, (acc.stunUntil || 0) - Date.now()),
      });
      if (nat) broadcastOwners();
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
            notifyNation(trapN, `🪤 덫에 ${myN ? myN.name + '의 ' : ''}${s.acc.name}이(가) 걸렸어요! (${world.t[terrAtTile(tx, ty)] ? terrAtTile(tx, ty) + '번 영토' : ''})`);
          }
        }
        s.x = x; s.y = y; s.dir = m.dir < 0 ? -1 : 1; s.face = Math.max(0, Math.min(3, m.f | 0)); s.moving = m.moving ? 1 : 0; s.scene = scene; s.room = room; s.lastMove = now;
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
        s.acc.look = cleanLook(m.look); s.acc.name = clean(m.name, 10) || s.acc.name; dirty = true;
        const mm = { t: 'meta', p: meta(s) };
        for (const o of online.values()) if (o.known.has(s.id) || o === s) send(o.ws, mm);
        break;
      }
      case 'found': case 'join': {
        if (m.t === 'found' && !foundingOpen()) return send(ws, { t: 'err', text: '건국 기간(12/14~12/15)이 끝났어요. 유랑민으로 시작해 주세요' });
        const r = m.t === 'found' ? world.foundNation(s.token, s.acc.name, m.name, m.capital | 0) : world.joinNation(s.token, s.acc.name, m.code);
        if (!r.ok) return send(ws, { t: 'err', text: r.err });
        world.refreshActions(r.nation, kstDay());
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
        if (!world.useAction(n.id, kstDay())) return send(ws, { t: 'answer', correct: false, text: '오늘 행동력을 다 썼어요 (자정에 다시 10)' });
        if (!sameAnswer(m.answer, q.answer)) { dirty = true; sendViews([n.id]); return send(ws, { t: 'answer', correct: false, text: '틀렸어요. 다시 도전하려면 행동력 1이 들어요' }); }
        (s.acc.solved = s.acc.solved || []).push(q.id);
        const r = world.puzzleReward(n.id, s.pending.terr, kstDay());
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
        const r = world.claim(n.id, t.id, kstDay());
        if (!r.ok) return send(ws, { t: 'err', text: r.err });
        dirty = true; broadcastOwners(); sendViews([n.id]);
        send(ws, { t: 'ok', text: `${t.id}번 영토를 점령했어요` });
        break;
      }
      case 'declare': case 'cancel': case 'defend': {
        const n = world.nationOfPlayer(s.token);
        if (!n) return;
        if (n.king !== s.token) return send(ws, { t: 'err', text: '전쟁 결정은 왕만 할 수 있어요' });
        const r = m.t === 'declare' ? world.declare(n.id, m.terr | 0, m.troops) : m.t === 'cancel' ? world.cancel(n.id, m.battle | 0) : world.defend(n.id, m.terr | 0, m.troops);
        if (!r.ok) return send(ws, { t: 'err', text: r.err });
        dirty = true;
        const other = m.t === 'declare' ? r.battle.def : null;
        sendViews(other ? [n.id, other] : [n.id]);
        if (m.t === 'declare') notifyNation(other, `⚔ ${n.name}이(가) ${m.terr | 0}번 영토에 선전포고했어요! 오늘 밤 10시 전투`);
        send(ws, { t: 'ok', text: m.t === 'declare' ? '선전포고 완료 · 밤 10시에 결과가 나와요' : m.t === 'cancel' ? '선전포고를 취소했어요' : '방어 배치 저장' });
        break;
      }
      case 'resolveNow': { if (testMode()) resolveNight('test'); break; }
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
        for (const [k, v] of Object.entries(c.r)) if (k === 'coin' || k === 'army') n[k] += v;
        c.used = { name: s.acc.name, nation: n.name, ts: Date.now() }; dirty = true;
        sendViews([n.id]);
        send(ws, { t: 'redeem', ok: true, text: `받았어요: ${Object.entries(c.r).map(([k, v]) => `${k === 'coin' ? '코인' : '병력'} +${v}`).join(', ')} (우리 나라에 들어갔어요)` });
        break;
      }
      case 'chop': { // 나무 베기 (화면에서 2초 게이지가 찬 뒤 보냄)
        const x = m.x | 0, y = m.y | 0, i = tileIdx(x, y);
        if (now() - (s.lastChop || 0) < NUM.chopSec * 900) return;
        if (!nextTo(s, x, y) || !treeKind(tileAt(x, y), x, y) || world.s.chopped[i]) return send(ws, { t: 'err', text: '벨 수 있는 나무가 없어요' });
        s.lastChop = now(); world.s.chopped[i] = 1; dirty = true;
        const n = world.nationOfPlayer(s.token);
        if (n) { n.wood = (n.wood || 0) + NUM.woodPerTree; sendViews([n.id]); }
        const msg = JSON.stringify({ t: 'chopped', i }); for (const o of online.values()) if (o.ws.readyState === 1) o.ws.send(msg);
        send(ws, { t: 'ok', text: n ? `🪵 목재 +${NUM.woodPerTree} (우리 저장소)` : '나무를 벴어요 (나라가 없어서 목재는 못 모아요)' });
        break;
      }
      case 'mine': { // 금광: 영토마다 하루 1번, 사람마다
        const n = world.nationOfPlayer(s.token); const tid = m.terr | 0;
        if (!n) return send(ws, { t: 'err', text: '나라가 있어야 캔 코인을 모을 수 있어요' });
        if (s.scene !== 'ground' || terrAtPx(s.x, s.y) !== tid) return;
        const day = kstDay(); s.acc.mined = s.acc.mined && s.acc.mined.day === day ? s.acc.mined : { day, ids: [] };
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
      case 'place': case 'pickup': { // 우리 땅에 바닥·방벽·덫 놓기 / 거두기
        const n = world.nationOfPlayer(s.token); if (!n) return send(ws, { t: 'err', text: '나라가 있어야 설치할 수 있어요' });
        const x = m.x | 0, y = m.y | 0, i = tileIdx(x, y);
        if (!nextTo(s, x, y)) return send(ws, { t: 'err', text: '바로 앞 칸에만 놓을 수 있어요' });
        if (world.ownerOf(terrAtTile(x, y)) !== n.id) return send(ws, { t: 'err', text: '우리 나라 땅에만 놓을 수 있어요' });
        n.items = n.items || {};
        if (m.t === 'pickup') {
          const e = world.s.tiles[i];
          if (e && e.n === n.id) { delete world.s.tiles[i]; n.items[e.k] = (n.items[e.k] || 0) + 1; sendTile(i); }
          else if (world.s.traps[i] === n.id) { delete world.s.traps[i]; n.items.trap = (n.items.trap || 0) + 1; sendTrap(n.id, i, false); }
          else return send(ws, { t: 'err', text: '거둘 게 없어요' });
          dirty = true; sendViews([n.id]); return;
        }
        const k = ['floor', 'wall', 'trap'].includes(m.k) ? m.k : null; if (!k) return;
        if (!(n.items[k] > 0)) return send(ws, { t: 'err', text: '저장소에 남은 게 없어요 (하늘 거래소에서 사요)' });
        if (!walkableTerrain(tileAt(x, y)) || treeKind(tileAt(x, y), x, y) && !world.s.chopped[i]) return send(ws, { t: 'err', text: '여기엔 놓을 수 없어요' });
        if (reservedTile(x, y)) return send(ws, { t: 'err', text: '제단·포털·저장소 바로 옆엔 놓을 수 없어요' });
        if (world.s.tiles[i] || world.s.traps[i]) return send(ws, { t: 'err', text: '이미 뭔가 놓여 있어요' });
        if (k === 'wall' && Object.values(world.s.tiles).filter((e) => e.n === n.id && e.k === 'wall').length >= NUM.maxWalls) return send(ws, { t: 'err', text: `방벽은 나라당 ${NUM.maxWalls}개까지예요` });
        if (k === 'trap' && trapsOf(n.id).length >= NUM.maxTraps) return send(ws, { t: 'err', text: `덫은 나라당 ${NUM.maxTraps}개까지예요` });
        if (k === 'wall') for (const o of online.values()) if (o.scene === 'ground' && o.x != null && Math.floor(o.x / 32) === x && Math.floor(o.y / 32) === y) return send(ws, { t: 'err', text: '사람이 서 있는 칸이에요' });
        n.items[k]--; dirty = true;
        if (k === 'trap') { world.s.traps[i] = n.id; sendTrap(n.id, i, true); } else { world.s.tiles[i] = { k, n: n.id }; sendTile(i); }
        sendViews([n.id]);
        break;
      }
      case 'breakStart': case 'breakWall': { // 남의 방벽 부수기: 5초 동안 붙어 있어야 함
        const x = m.x | 0, y = m.y | 0, i = tileIdx(x, y), e = world.s.tiles[i];
        const n = world.nationOfPlayer(s.token);
        if (!e || e.k !== 'wall' || (n && n.id === e.n) || !nextTo(s, x, y)) return;
        if (m.t === 'breakStart') {
          s.breaking = { i, at: now() };
          if (now() - (s.lastBreakAlert || 0) > 15000) { s.lastBreakAlert = now(); notifyNation(e.n, `🧱 방벽이 공격받고 있어요! (${terrAtTile(x, y)}번 영토 · ${n ? n.name + '의 ' : ''}${s.acc.name})`); }
          return;
        }
        if (!s.breaking || s.breaking.i !== i || now() - s.breaking.at < NUM.wallBreakSec * 1000 - 300) return;
        s.breaking = null; delete world.s.tiles[i]; dirty = true; sendTile(i);
        notifyNation(e.n, `🧱 ${terrAtTile(x, y)}번 영토의 방벽이 부서졌어요!`);
        send(ws, { t: 'ok', text: '방벽을 부쉈어요' });
        break;
      }
      case 'stealStart': case 'steal': { // 적 저장소 털기: 3초 꾹 → 들 수 있는 만큼
        const n = world.nationOfPlayer(s.token), V = world.nation(String(m.nid || ''));
        if (!n || !V || V.dead || V.id === n.id) return;
        const spot = storageOf(V); if (!spot || !nextTo(s, spot[0], spot[1], 2)) return send(ws, { t: 'err', text: '저장소 바로 옆에서만 털 수 있어요' });
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
        const spot = storageOf(n); if (!spot || !nextTo(s, spot[0], spot[1], 2)) return;
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
        const day = kstDay(); o.acc.arrests = o.acc.arrests && o.acc.arrests.day === day ? o.acc.arrests : { day, n: 0 }; o.acc.arrests.n++;
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
        for (const o of online.values()) if (o.scene === 'ground' && near(o, s)) send(o.ws, { t: 'hitfx', terr: t.id });
        s.hits = s.hits && s.hits.terr === t.id && now() - s.hits.at < 60000 ? s.hits : { terr: t.id, n: 0 };
        s.hits.n++; s.hits.at = now();
        if (s.hits.n >= NUM.scoutHits) {
          s.hits = null; const D = world.nation(own);
          send(ws, { t: 'scout', terr: t.id, text: `🔍 ${D.name}의 병력: ${D.army}명 (영토 ${world.territoriesOf(D.id).length}곳)` });
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

// 주변 사람 위치만 묶어서 보낸다: [id, x, y, dir, moving]
setInterval(() => {
  for (const viewer of online.values()) {
    if (viewer.x == null) continue;
    const p = [];
    const seen = new Set();
    for (const o of online.values()) {
      if (o === viewer || !near(viewer, o)) continue;
      seen.add(o.id);
      if (!viewer.known.has(o.id)) { viewer.known.add(o.id); send(viewer.ws, { t: 'meta', p: meta(o) }); }
      p.push([o.id, Math.round(o.x), Math.round(o.y), o.dir, o.moving, o.face | 0]);
    }
    for (const id of viewer.known) if (!seen.has(id)) { viewer.known.delete(id); send(viewer.ws, { t: 'leave', id }); }
    send(viewer.ws, { t: 'state', p, n: online.size });
  }
}, TICK_MS);

// ------------------------------------------------------------ 나라·전투 방송
function broadcastOwners() {
  const msg = JSON.stringify({ t: 'owners', owners: world.s.owner, nations: world.publicNations() });
  for (const o of online.values()) if (o.ws.readyState === 1) o.ws.send(msg);
}
function sendViews(nids) {
  for (const o of online.values()) {
    const n = world.nationOfPlayer(o.token);
    if (n && nids.includes(n.id)) send(o.ws, { t: 'view', view: world.view(n.id, o.token) });
  }
}
function notifyNation(nid, text) {
  const n = world.nation(nid); if (!n) return;
  for (const o of online.values()) if (n.members.includes(o.token)) send(o.ws, { t: 'ok', text });
}
// 지휘관 수: 그 영토(땅 위)에 마지막으로 서 있던 그 나라 국민
function cmdCount(nid, tid) {
  const n = world.nation(nid); if (!n) return 0;
  let c = 0;
  for (const key of n.members) { const a = state.accounts[key]; if (a && a.scene === 'ground' && a.x != null && terrAtPx(a.x, a.y) === tid) c++; }
  return c;
}
function resolveNight(why) {
  const reports = world.resolveAll(cmdCount);
  state.lastResolved = kstDay(); dirty = true; saveState();
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
// 매일 밤 10시(한국 시간)에 전투 처리
setInterval(() => {
  const k = new Date(Date.now() + 9 * 3600e3);
  if (k.getUTCHours() === 22 && state.lastResolved !== kstDay()) resolveNight('22:00');
}, 30000);

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
  if (f && f.until > Date.now()) return out(429, { ok: false, err: '비밀번호를 여러 번 틀렸어요. 1분 뒤에 다시 해 주세요' });
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 4e6) req.destroy(); }); // 문제 그림 때문에 넉넉하게
  req.on('end', async () => {
    let m; try { m = JSON.parse(body); } catch (e) { return out(400, { ok: false, err: '잘못된 요청' }); }
    if (!keyOk(m.key)) {
      const g = adminFails.get(ip) || { n: 0, until: 0 }; g.n++; if (g.n >= 5) { g.n = 0; g.until = Date.now() + 60e3; } adminFails.set(ip, g);
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
    members: n.members.map((k) => (n.memberNames || {})[k] || '?'), online: n.members.filter((k) => [...online.values()].some((o) => o.token === k)).length,
    territories: world.territoriesOf(n.id).length, army: n.army, coin: n.coin, code: n.code,
  })).sort((a, b) => a.dead - b.dead || b.territories - a.territories);
  const coupons = Object.entries(state.coupons).map(([code, c]) => ({ code, r: c.r, memo: c.memo || '', at: c.at, used: c.used || null }));
  return {
    ok: true, now: Date.now(), kstDay: kstDay(), uptimeSec: Math.round((Date.now() - BOOT_AT) / 1000), storage: store ? store.kind : '없음',
    online: online.size, accounts: Object.keys(state.accounts).length, nations, battles: world.s.battles.length, night: world.s.night,
    lastResolved: state.lastResolved || null, testMode: testMode(), envTestMode: ENV_TEST_MODE, settings: state.settings, foundingOpen: foundingOpen(),
    foundingLastDay: FOUNDING_LAST_DAY, puzzles: bank().length, puzzleFile: path.basename(PUZZLE_FILE), samplePuzzlesOnly: SAMPLE_FILE && !state.puzzles.length, notice: state.notice || null, coupons,
    wander: state.wander.length,
  };
}
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
    case 'nationAdjust': { // 나라 병력·코인 더하기/빼기
      const n = world.nation(String(m.nid || '')); if (!n || n.dead) return { ok: false, err: '없는 나라예요' };
      const da = Math.trunc(+m.army || 0), dc = Math.trunc(+m.coin || 0);
      if (Math.abs(da) > 100000 || Math.abs(dc) > 10000000) return { ok: false, err: '숫자가 너무 커요' };
      n.army = Math.max(0, n.army + da); n.coin = Math.max(0, n.coin + dc); dirty = true;
      sendViews([n.id]);
      if (m.say !== false && (da || dc)) notifyNation(n.id, `✨ 신의 선물: ${[da && `병력 ${da > 0 ? '+' : ''}${da}`, dc && `코인 ${dc > 0 ? '+' : ''}${dc}`].filter(Boolean).join(', ')}`);
      console.log(`[관리자] ${n.name}: 병력 ${da}, 코인 ${dc}`);
      return { ok: true, army: n.army, coin: n.coin };
    }
    case 'couponCreate': {
      const count = Math.max(1, Math.min(300, m.count | 0));
      const kind = m.kind === 'army' ? 'army' : 'coin';
      const amount = Math.max(1, Math.min(kind === 'army' ? 1000 : 100000, m.amount | 0));
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
      state.chats = {}; state.wander = []; state.lastResolved = null; state.notice = null;
      if (m.coupons) state.coupons = {};
      for (const a of Object.values(state.accounts)) { a.solved = []; if (m.positions) { a.x = null; a.y = null; a.scene = 'ground'; a.room = null; } }
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
