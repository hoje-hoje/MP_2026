/* MP 2026 실시간 서버
 *  - 정적 파일: client/ 와 maps/world.json
 *  - WebSocket(/ws): 접속, 위치 동기화(주변 사람만), 나라 채팅, 감정표현, 유랑민 등록
 *  - 상태는 data/state.json 에 주기적으로 저장 (재시작해도 이어짐)
 *
 *  실행:  cd server && npm install && npm start   →  http://localhost:8080
 *  환경변수: PORT(기본 8080), DATA_DIR(기본 ./data), ADMIN_KEY(신의 콘솔용, 추후)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 8080;
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const TICK_MS = 100;               // 위치 방송 주기 (초당 10번)
const AOI_X = 44 * 32, AOI_Y = 30 * 32; // 땅에서 '주변'으로 보는 범위 (px)
const MAX_SPEED = 5 * 32 * 3.4;    // 허용 최대 속도 (빨리 걷기 테스트 포함, px/s)
const CHAT_MAX = 120, CHAT_KEEP = 60;
const EMOTES = ['안녕!', '거래 구함!', '동맹 할래?', 'ㅋㅋㅋ', '!', '?', '도와줘!', '고마워'];
const BANNED = ['시발', '씨발', 'ㅅㅂ', '병신', 'ㅂㅅ', '좆', '개새', '미친놈', '꺼져'];
const TEAM_MAX = 60;

// ------------------------------------------------------------ 정적 파일
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const STATIC = {
  '/': path.join(ROOT, 'client', 'index.html'),
  '/index.html': path.join(ROOT, 'client', 'index.html'),
  '/game.js': path.join(ROOT, 'client', 'game.js'),
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
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, players: online.size })); }
  let file = STATIC[url.pathname];
  if (!file && url.pathname.startsWith('/assets/')) {
    const f = path.normalize(path.join(ASSET_DIR, decodeURIComponent(url.pathname.slice(8))));
    if (f.startsWith(ASSET_DIR + path.sep) && /\.(png|json)$/.test(f) && fs.existsSync(f)) file = f;
  }
  if (!file) { res.writeHead(404); return res.end('not found'); }
  try {
    const body = url.pathname === '/world.json' ? publicWorld() : fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': url.pathname === '/world.json' ? 'public, max-age=300' : 'no-cache' });
    res.end(body);
  } catch (e) { res.writeHead(500); res.end('error'); }
});

// ------------------------------------------------------------ 상태
// accounts: 토큰별 영구 기록 / online: 지금 접속한 소켓
const state = loadState();
const online = new Map(); // id -> session
let nextId = 1;

function loadState() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'state.json'), 'utf8')); }
  catch (e) { return { accounts: {}, chats: {}, wander: [] }; }
}
let dirty = false;
function saveState() {
  if (!dirty) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, 'state.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, path.join(DATA_DIR, 'state.json'));
  dirty = false;
}
setInterval(saveState, 10000);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { dirty = true; saveState(); process.exit(0); });

const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const HEX = /^#[0-9a-f]{6}$/i;
function cleanLook(l) {
  l = l || {};
  return { char: Math.max(0, Math.min(2, l.char | 0)), hue: Math.max(0, Math.min(5, l.hue | 0)), hair: HEX.test(l.hair) ? l.hair : '#4a3428', outfit: HEX.test(l.outfit) ? l.outfit : '#5b7fd6', skin: HEX.test(l.skin) ? l.skin : '#ffe1cc', accent: HEX.test(l.accent) ? l.accent : '#ff5d7a', long: !!l.long };
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
      send(ws, {
        t: 'welcome', id: s.id, token, pos: acc.x == null ? null : { x: acc.x, y: acc.y, scene: s.scene, room: s.room },
        chat: (state.chats['team:' + team] || []).slice(-30), emotes: EMOTES, wander: state.wander,
      });
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
        const ch = 'team:' + s.acc.team; // 지금은 나라(팀) 채팅만. 제국 채팅은 병합 기능과 함께.
        const msg = { t: 'chat', ch, from: s.id, name: s.acc.name, text, ts: Date.now() };
        const list = state.chats[ch] || (state.chats[ch] = []);
        list.push(msg); if (list.length > CHAT_KEEP) list.splice(0, list.length - CHAT_KEEP);
        dirty = true;
        for (const o of online.values()) if (o.acc.team === s.acc.team) send(o.ws, msg);
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

server.listen(PORT, () => console.log(`MP 2026 서버: http://localhost:${PORT}  (데이터: ${DATA_DIR})`));
