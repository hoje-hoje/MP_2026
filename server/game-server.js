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
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, players: online.size })); }
  let file = STATIC[url.pathname];
  if (!file && url.pathname.startsWith('/assets/')) {
    const f = path.normalize(path.join(ASSET_DIR, decodeURIComponent(url.pathname.slice(8))));
    if (f.startsWith(ASSET_DIR + path.sep) && /\.(png|json|woff2)$/.test(f) && fs.existsSync(f)) file = f;
  }
  if (!file) { res.writeHead(404); return res.end('not found'); }
  try {
    const body = url.pathname === '/world.json' ? publicWorld() : fs.readFileSync(file);
    const type = url.pathname === '/admin' ? MIME['.html'] : MIME[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': url.pathname === '/world.json' ? 'public, max-age=300' : 'no-cache' });
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
const { sameAnswer } = require('../client/rules.js');
// 문제 은행: server/puzzles.local.json (저장소에 안 올림) 이 있으면 그것, 없으면 샘플
// Render 의 Secret File 은 /etc/secrets/ 에 들어간다
const PUZZLE_FILE = [process.env.PUZZLES_FILE, '/etc/secrets/puzzles.local.json', path.join(__dirname, 'puzzles.local.json')].find((f) => f && fs.existsSync(f)) || path.join(__dirname, 'puzzles.sample.json');
let PUZZLES = [];
function loadPuzzles() { try { PUZZLES = JSON.parse(fs.readFileSync(PUZZLE_FILE, 'utf8')).puzzles || []; console.log(`문제 ${PUZZLES.length}개 (${path.basename(PUZZLE_FILE)})`); } catch (e) { console.log('문제 파일 오류:', e.message); } }
loadPuzzles();
fs.watchFile(PUZZLE_FILE, { interval: 5000 }, loadPuzzles); // 문제 파일을 고치면 서버 재시작 없이 반영
state.world = world.s;
state.settings = state.settings || {};   // 관리자 설정: testMode(true/false/없음=환경변수), founding('auto'|'open'|'closed')
state.coupons = state.coupons || {};     // 쿠폰 코드 -> { r:{coin|army}, memo, at, used:{name,nation,ts} }
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
function meta(s) { return { id: s.id, name: s.acc.name, team: s.acc.team, look: s.acc.look }; }

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
        t: 'welcome', id: s.id, token, pos: acc.x == null ? null : { x: acc.x, y: acc.y, scene: s.scene, room: s.room },
        chat: nat ? (state.chats['nation:' + nat.id] || []).slice(-30) : [], emotes: EMOTES, wander: state.wander,
        view: nat ? world.view(nat.id, token) : null, owners: world.s.owner, nations: world.publicNations(), testMode: testMode(), foundingOpen: foundingOpen(), notice: state.notice || null,
      });
      if (nat) broadcastOwners();
      return;
    }
    switch (m.t) {
      case 'move': {
        const now = Date.now();
        const x = +m.x, y = +m.y;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const scene = m.scene === 'sky' ? 'sky' : 'ground';
        const room = scene === 'sky' ? clean(m.room, 16) : null;
        const sameArea = scene === s.scene && room === s.room;
        const dt = Math.max(0.05, (now - s.lastMove) / 1000);
        // 같은 장소에서 너무 빨리 움직이면 무시 (순간이동 테스트 기능 m.tp 는 프로토타입 기간에만 허용)
        if (sameArea && s.x != null && !m.tp && Math.hypot(x - s.x, y - s.y) > MAX_SPEED * dt + 64) return;
        if (!sameArea) { for (const id of s.known) send(ws, { t: 'leave', id }); s.known.clear(); }
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
        const pool = PUZZLES.filter((q) => !solved.has(q.id));
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
        const q = PUZZLES.find((x) => x.id === m.id); if (!q) return;
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
  req.on('data', (c) => { body += c; if (body.length > 64e3) req.destroy(); });
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
    foundingLastDay: FOUNDING_LAST_DAY, puzzles: PUZZLES.length, puzzleFile: path.basename(PUZZLE_FILE), notice: state.notice || null, coupons,
    wander: state.wander.length,
  };
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
