/* MP 2026 게임 규칙 (나라 · 영토 · 블로토 전투)
 * 서버(Node)와 브라우저(오프라인 미리보기)가 같은 코드를 쓴다.
 *   Node:    const { World } = require('../client/rules.js')
 *   브라우저: window.MPRules.World
 * 상태(state)는 JSON 그대로 저장할 수 있는 순수 데이터다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MPRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 기본 수치 (docs/GAME_DESIGN.md 10장)
  const NUM = {
    startArmy: 50, startCoin: 1000,
    maxDeclare: 2,                 // 하룻밤 선전포고 최대
    maxMembers: 6,                 // 나라 인원 최대
    supplyPer: 0.05, supplyMax: 0.4, // 보급선: 수도에서 영토 1개 건널 때마다 -5%, 최대 -40%
    cmdPer: 0.10, cmdMax: 0.30,    // 지휘관 보너스: 그 영토에 서 있는 국민 1명당 +10%, 최대 +30%
    lossLose: 0.5, lossWin: 0.25,  // 전투 손실
    actionsPerDay: 10,             // 하루 행동력 (점령·퍼즐)
    puzzleArmy: 10,                // 퍼즐 1문제 병력
    // 영지 (나라 공용 저장소)
    woodPerTree: 2,                // 나무 1그루 목재
    price: { floor: 20, wall: 60, trap: 150 }, // 하늘 거래소 가격 (코인, 1개)
    vaccineBase: 3000, vaccineStep: 500,       // 백신: 나라가 살 때마다 비싸짐
    maxWalls: 60, maxTraps: 12,    // 나라당 설치 한도
    floorSpeed: 1.5,               // 우리 나라 바닥 위에서 빨라지는 배수
    wallBreakSec: 5, chopSec: 2,   // 방벽 부수기·나무 베기 시간
    scoutHits: 10,                 // 적 수정을 이만큼 때리면 그 나라 병력이 보임
    carry: { coin: 150, wood: 10 }, // 한 번에 훔쳐 들 수 있는 양
    stealSec: 3, arrestJail: 3, jailMin: 60, // 훔치기 시간, 체포 몇 번이면 감옥, 감옥 시간(분)
    reinforce: 10, frontRange: 3.5, // 전선 근처(칸)에서 E 한 번에 충원하는 병력
  };
  const T = { VOID: 0, GRASS: 1, FOREST: 2, SAND: 3, WATER: 4, MOUNTAIN: 5, HOLY: 6, WALL: 7 };
  function hash(x, y, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  // 나무가 있는 칸인지 (지형 값만 보고 정해짐 → 서버와 화면이 같은 결과)
  function treeKind(t, x, y) {
    if (t !== T.FOREST && t !== T.GRASS) return null;
    const h = hash(x, y, 7);
    if (t === T.FOREST) {
      if (h < 0.07 && (x + y) % 3 === 0) return h < 0.035 ? 'treeA' : 'treeB';
      if (h < 0.26 && (x + 2 * y) % 2 === 0) return h < 0.17 ? 'midA' : 'midB';
      return null;
    }
    return h < 0.004 ? 'midA' : null;
  }
  // 수도 저장소 위치: 제단 둘레에서 걸을 수 있는 첫 칸 (깃발 자리 ±2,0 과 포털은 피함)
  const STORE_OFFS = [[-3, 1], [3, 1], [-3, -1], [3, -1], [-2, -2], [2, -2], [0, -3], [-3, 2], [3, 2], [-4, 0], [4, 0]];
  function storageSpot(t, tileAt) {
    for (const [dx, dy] of STORE_OFFS) {
      const x = t.altar[0] + dx, y = t.altar[1] + dy, k = tileAt(x, y);
      if (t.portal && Math.abs(t.portal[0] - x) <= 1 && Math.abs(t.portal[1] - y) <= 1) continue; // 포털 길 막지 않게
      if (k === T.GRASS || k === T.FOREST || k === T.SAND) return [x, y];
    }
    return [t.altar[0] - 3, t.altar[1]];
  }
  const COLORS = ['#3d5fb8', '#c94a3c', '#277a58', '#8a4fc0', '#9a5f10', '#1f7f8f', '#b03a78', '#4f6b1f', '#5a4fc0', '#a0522d', '#2b6f9e', '#7a3fa0'];
  const teamColor = (n) => COLORS[((n | 0) - 1 + COLORS.length * 10) % COLORS.length];
  const FRONTS = ['A', 'B', 'C'];

  function emptyState() { return { nations: {}, owner: {}, battles: [], reports: [], night: 1, nextBattle: 1, nextTeam: 1, tiles: {}, traps: {}, chopped: {}, mines: {} }; }
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const randCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const clampTroops = (arr) => (Array.isArray(arr) && arr.length === 3) ? arr.map((v) => Math.max(0, Math.floor(+v || 0))) : null;
  const sum = (a) => a[0] + a[1] + a[2];

  class World {
    constructor(map, state) {
      this.t = {};
      for (const t of map.territories) this.t[t.id] = t;
      this.caps = map.territories.filter((t) => t.capitalCandidate).sort((a, b) => a.id - b.id);
      this.s = state || emptyState();
      for (const k of ['tiles', 'traps', 'chopped', 'mines']) this.s[k] = this.s[k] || {}; // 예전 저장 상태 호환 (mines: 옮긴 금광 위치)
      this._dist = {};
    }

    // ---------------------------------------------------------- 조회
    nation(id) { return this.s.nations[id] || null; }
    alive() { return Object.values(this.s.nations).filter((n) => !n.dead); }
    ownerOf(tid) { return this.s.owner[tid] || null; }
    territoriesOf(nid) { return Object.keys(this.s.owner).filter((k) => this.s.owner[k] === nid).map(Number); }
    nationOfPlayer(key) { return this.alive().find((n) => n.members.includes(key)) || null; }
    touches(nid, tid) { const t = this.t[tid]; return !!t && t.neighbors.some((nb) => this.s.owner[nb] === nid); }

    distance(from, to) {
      if (from === to) return 0;
      let d = this._dist[from];
      if (!d) {
        d = this._dist[from] = { [from]: 0 };
        const q = [from];
        while (q.length) {
          const c = q.shift();
          for (const nb of this.t[c].neighbors) if (d[nb] == null) { d[nb] = d[c] + 1; q.push(nb); }
        }
      }
      return d[to] == null ? 99 : d[to];
    }
    supply(nid, tid) { const n = this.nation(nid); return Math.min(NUM.supplyMax, NUM.supplyPer * Math.max(0, this.distance(n.capital, tid) - 1)); }

    // ---------------------------------------------------------- 나라
    capitalForTeam(team) {
      for (let k = 0; k < this.caps.length; k++) {
        const c = this.caps[(team - 1 + k) % this.caps.length];
        if (!this.s.owner[c.id] && !this.caps.some((o) => this.s.owner[o.id] && c.neighbors.includes(o.id))) return c;
      }
      return null;
    }
    ensureNation(team, key, name, capitalId) {
      const mine = this.nationOfPlayer(key);
      if (mine) return mine;
      let n = this.alive().find((x) => x.provinces.includes(team));
      if (!n) {
        const cap = capitalId && !this.s.owner[capitalId] ? this.t[capitalId] : this.capitalForTeam(team);
        if (!cap) return null;
        const id = 'n' + team;
        n = this.s.nations[id] = {
          id, team, name: `${team}팀`, king: key, kingName: name, members: [], capital: cap.id,
          army: NUM.startArmy, coin: NUM.startCoin, color: teamColor(team), actions: NUM.actionsPerDay, actionDay: '',
          provinces: [team], dead: false, lastDef: [1, 1, 1], code: this.newCode(), memberNames: {},
        };
        this.s.owner[cap.id] = id;
      }
      if (!n.members.includes(key)) n.members.push(key);
      n.memberNames = n.memberNames || {}; n.memberNames[key] = name;
      return n;
    }

    // ---------------------------------------------------------- 건국 화면
    newCode() { let c; do { c = randCode(); } while (Object.values(this.s.nations).some((n) => n.code === c)); return c; }
    // 수도 후보 상태: free(고를 수 있음) / taken(이미 수도) / near(다른 수도 바로 옆이라 불가) / gone(무너짐)
    capitalOptions(goneSet) {
      const capOwner = {};
      for (const n of this.alive()) capOwner[n.capital] = n.id;
      return this.caps.map((c) => {
        let status = 'free';
        if (goneSet && goneSet.has(c.id)) status = 'gone';
        else if (capOwner[c.id]) status = 'taken';
        else if (this.s.owner[c.id]) status = 'owned';
        else if (c.neighbors.some((nb) => capOwner[nb])) status = 'near';
        return { id: c.id, status, nation: capOwner[c.id] || this.s.owner[c.id] || null };
      });
    }
    foundNation(key, playerName, nationName, capitalId) {
      if (this.nationOfPlayer(key)) return { ok: false, err: '이미 나라에 속해 있어요' };
      const name = String(nationName || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 10);
      if (name.length < 2) return { ok: false, err: '나라 이름은 2글자 이상이에요' };
      if (this.alive().some((n) => n.name === name)) return { ok: false, err: '같은 이름의 나라가 있어요' };
      const opt = this.capitalOptions().find((o) => o.id === capitalId);
      if (!opt) return { ok: false, err: '수도 후보가 아니에요' };
      if (opt.status !== 'free') return { ok: false, err: opt.status === 'near' ? '다른 나라 수도 바로 옆에는 세울 수 없어요' : '이미 다른 나라 땅이에요' };
      const team = this.s.nextTeam = Math.max(this.s.nextTeam || 1, ...Object.values(this.s.nations).map((n) => n.team + 1));
      this.s.nextTeam = team + 1;
      const n = this.ensureNation(team, key, playerName, capitalId);
      if (!n) return { ok: false, err: '건국에 실패했어요' };
      n.name = name;
      return { ok: true, nation: n };
    }
    joinNation(key, playerName, code) {
      if (this.nationOfPlayer(key)) return { ok: false, err: '이미 나라에 속해 있어요' };
      const n = this.alive().find((x) => x.code === String(code || '').toUpperCase().trim());
      if (!n) return { ok: false, err: '그런 초대 코드가 없어요' };
      if (n.members.length >= NUM.maxMembers) return { ok: false, err: `그 나라는 ${NUM.maxMembers}명이 다 찼어요` };
      n.members.push(key); n.memberNames = n.memberNames || {}; n.memberNames[key] = playerName;
      return { ok: true, nation: n };
    }
    transferKing(nid, fromKey, toIdx) {
      const n = this.nation(nid);
      const toKey = n ? n.members[toIdx | 0] : null;
      if (!n || n.king !== fromKey) return { ok: false, err: '왕만 넘길 수 있어요' };
      if (!n.members.includes(toKey) || toKey === fromKey) return { ok: false, err: '우리 나라 국민에게만 넘길 수 있어요' };
      n.king = toKey; n.kingName = (n.memberNames || {})[toKey] || n.kingName;
      return { ok: true };
    }
    refreshActions(n, dayKey) { if (dayKey && n.actionDay !== dayKey) { n.actionDay = dayKey; n.actions = NUM.actionsPerDay; } }

    // 중립 영토 점령 (나중에 수학 퍼즐을 맞혀야 호출)
    claim(nid, tid, dayKey, free) {
      const n = this.nation(nid), t = this.t[tid];
      if (!n || n.dead || !t) return { ok: false, err: '나라나 영토가 없어요' };
      this.refreshActions(n, dayKey);
      if (this.s.owner[tid]) return { ok: false, err: '이미 주인이 있는 땅이에요' };
      if (!this.touches(nid, tid)) return { ok: false, err: '우리 땅과 붙어 있는 곳만 점령할 수 있어요' };
      if (!free && n.actions <= 0) return { ok: false, err: '오늘 행동력을 다 썼어요' };
      if (!free) n.actions -= 1;
      this.s.owner[tid] = nid;
      return { ok: true };
    }

    // ---------------------------------------------------------- 제단 퍼즐
    // 시도할 때마다 행동력 1. 맞히면: 붙어 있는 중립 영토면 점령, 우리 영토면 병력 +퍼즐보상
    useAction(nid, dayKey) {
      const n = this.nation(nid); if (!n) return false;
      this.refreshActions(n, dayKey);
      if (n.actions <= 0) return false;
      n.actions -= 1; return true;
    }
    puzzleReward(nid, tid, dayKey) {
      const n = this.nation(nid); if (!n) return { kind: 'none' };
      const own = this.s.owner[tid];
      if (!own && this.touches(nid, tid)) { this.claim(nid, tid, dayKey, true); return { kind: 'claim' }; }
      if (own === nid) {
        const extra = n.members.length > 4 ? 0.5 : 1; // 5·6번째 국민이 있으면 보상 절반 (단순화: 나라 전체)
        const army = Math.round(NUM.puzzleArmy * extra);
        n.army += army; return { kind: 'army', army };
      }
      return { kind: 'none' };
    }

    // ---------------------------------------------------------- 전투 (블로토)
    tonight(nid) { return this.s.battles.filter((b) => b.att === nid || b.def === nid); }
    declaresLeft(nid) { return NUM.maxDeclare - this.s.battles.filter((b) => b.att === nid).length; }

    declare(nid, tid, troops) {
      const n = this.nation(nid), t = this.t[tid];
      troops = clampTroops(troops);
      if (!n || n.dead || !t || !troops) return { ok: false, err: '잘못된 요청이에요' };
      const def = this.s.owner[tid];
      if (!def) return { ok: false, err: '주인 없는 땅은 전투가 아니라 점령으로 가져와요' };
      if (def === nid) return { ok: false, err: '우리 땅이에요' };
      if (!this.touches(nid, tid)) return { ok: false, err: '우리 땅과 붙어 있는 적 영토만 공격할 수 있어요' };
      if (this.declaresLeft(nid) <= 0) return { ok: false, err: `이번 전투 선전포고는 ${NUM.maxDeclare}곳까지예요` };
      if (this.s.battles.some((b) => b.target === tid)) return { ok: false, err: '그 땅은 이번 전투에 이미 다른 나라가 공격해요' };
      const total = sum(troops);
      if (total <= 0) return { ok: false, err: '병력을 1명 이상 보내야 해요' };
      if (total > n.army) return { ok: false, err: `병력이 모자라요 (보유 ${n.army})` };
      n.army -= total;
      const b = { id: this.s.nextBattle++, night: this.s.night, att: nid, def, target: tid, a: troops, d: null };
      this.s.battles.push(b);
      return { ok: true, battle: b };
    }
    cancel(nid, battleId) {
      const i = this.s.battles.findIndex((b) => b.id === battleId && b.att === nid);
      if (i < 0) return { ok: false, err: '취소할 선전포고가 없어요' };
      this.nation(nid).army += sum(this.s.battles[i].a);
      const D = this.nation(this.s.battles[i].def); if (D && this.s.battles[i].rd) D.army += sum(this.s.battles[i].rd); // 방어 충원은 돌려줌
      this.s.battles.splice(i, 1);
      return { ok: true };
    }
    // 기본 방어 비율: 방어 배치를 못 했을 때 이 비율로 자동 배치 (A·B·C 퍼센트)
    setDefault(nid, ratio) {
      const n = this.nation(nid); const r = clampTroops(ratio);
      if (!n || !r || sum(r) <= 0) return { ok: false, err: 'A·B·C 중 하나는 0보다 커야 해요' };
      n.defaultDef = r; return { ok: true };
    }
    // 전선 근처에서 병력 충원 (공격·방어 둘 다)
    reinforce(nid, battleId, front) {
      const n = this.nation(nid), b = this.s.battles.find((x) => x.id === battleId);
      if (!n || !b || front < 0 || front > 2) return { ok: false, err: '충원할 전투가 없어요' };
      if (b.att !== nid && b.def !== nid) return { ok: false, err: '우리 나라 전투가 아니에요' };
      const amt = Math.min(NUM.reinforce, n.army);
      if (amt <= 0) return { ok: false, err: '저장소에 남은 병력이 없어요' };
      n.army -= amt;
      if (b.att === nid) b.a[front] += amt; else { b.rd = b.rd || [0, 0, 0]; b.rd[front] += amt; }
      return { ok: true, amt, side: b.att === nid ? 'att' : 'def', now: b.att === nid ? b.a[front] : (b.d ? b.d[front] : 0) + b.rd[front] };
    }
    // 첩보: 공격해 온 나라의 전선 하나 병력 보기. 그 나라 전용 첩보 → 없으면 아무 나라용 첩보
    useIntel(nid, battleId) {
      const n = this.nation(nid), b = this.s.battles.find((x) => x.id === battleId && x.def === nid);
      if (!n || !b) return { ok: false, err: '공격받는 전투에만 쓸 수 있어요' };
      b.rev = b.rev || [];
      const left = [0, 1, 2].filter((f) => !b.rev.includes(f));
      if (!left.length) return { ok: false, err: '세 전선을 다 알아냈어요' };
      n.intel = n.intel || {};
      if ((n.intel[b.att] || 0) > 0) n.intel[b.att]--; else if ((n.intelAny || 0) > 0) n.intelAny--; else return { ok: false, err: '쓸 수 있는 첩보가 없어요' };
      const f = left[Math.floor(Math.random() * left.length)]; b.rev.push(f);
      return { ok: true, front: f, troops: b.a[f] };
    }
    publicBattles() { return this.s.battles.map((b) => ({ id: b.id, target: b.target, att: b.att, def: b.def, f: b.f || null })); }
    defend(nid, tid, troops) {
      const n = this.nation(nid);
      troops = clampTroops(troops);
      const b = this.s.battles.find((x) => x.def === nid && x.target === tid);
      if (!n || !b || !troops) return { ok: false, err: '방어할 전투가 없어요' };
      const prev = b.d ? sum(b.d) : 0;
      if (sum(troops) > n.army + prev) return { ok: false, err: `병력이 모자라요 (보유 ${n.army + prev})` };
      n.army += prev - sum(troops);
      b.d = troops; n.lastDef = troops.slice();
      return { ok: true };
    }

    // 13시·22시: 모든 전투를 한 번에 처리. cmdCount(nid, tid) = 그 영토에 서 있는 그 나라 국민 수
    resolveAll(cmdCount) {
      const reports = [];
      const pending = this.s.battles.slice();
      this.s.battles = [];
      for (const b of pending) {
        const A = this.nation(b.att), D = this.nation(b.def);
        if (!A || A.dead || !D || D.dead || this.s.owner[b.target] !== b.def) { if (A && !A.dead) A.army += sum(b.a); if (D && !D.dead) D.army += (b.d ? sum(b.d) : 0) + (b.rd ? sum(b.rd) : 0); continue; }
        let d = b.d, auto = false;
        if (!d) {
          // 방어 배치를 안 냈으면: 남은 병력을 이번 전투에 공격받는 수만큼 나눠, 지난 배치 비율(없으면 균등)로
          const left = pending.filter((x) => x.def === b.def && !x.d && !x._done).length || 1;
          const pool = Math.floor(D.army / left);
          const r = D.defaultDef && sum(D.defaultDef) > 0 ? D.defaultDef : D.lastDef && sum(D.lastDef) > 0 ? D.lastDef : [1, 1, 1]; // 기본 방어 비율 > 지난 배치 > 균등
          d = r.map((v) => Math.floor(pool * v / sum(r)));
          d[0] += pool - sum(d);
          D.army -= sum(d); auto = true;
        }
        if (b.rd) d = d.map((v, k) => v + b.rd[k]); // 전선 근처에서 충원한 방어 병력
        b._done = true;
        const cA = Math.min(NUM.cmdMax, NUM.cmdPer * (cmdCount ? cmdCount(b.att, b.target) : 0));
        const cD = Math.min(NUM.cmdMax, NUM.cmdPer * (cmdCount ? cmdCount(b.def, b.target) : 0));
        const mA = 1 + cA - this.supply(b.att, b.target);
        const mD = 1 + cD - this.supply(b.def, b.target);
        const effA = b.a.map((v) => Math.round(v * mA * 10) / 10);
        const effD = d.map((v) => Math.round(v * mD * 10) / 10);
        const fronts = effA.map((v, i) => (v > effD[i] ? 'att' : 'def')); // 같으면 방어 승
        const attWins = fronts.filter((f) => f === 'att').length >= 2;
        const lossA = Math.ceil(sum(b.a) * (attWins ? NUM.lossWin : NUM.lossLose));
        const lossD = Math.ceil(sum(d) * (attWins ? NUM.lossLose : NUM.lossWin));
        A.army += sum(b.a) - lossA; D.army += sum(d) - lossD;
        let merged = false;
        if (attWins) {
          this.s.owner[b.target] = b.att;
          if (b.target === D.capital) { this.merge(A, D); merged = true; }
        }
        const rep = {
          id: b.id, night: b.night, target: b.target, att: b.att, def: b.def, attName: A.name, defName: D.name,
          a: b.a, d, autoDef: auto, effA, effD, mA: Math.round(mA * 100) / 100, mD: Math.round(mD * 100) / 100,
          fronts, winner: attWins ? 'att' : 'def', lossA, lossD, merged, capital: b.target === D.capital,
        };
        reports.push(rep);
      }
      this.s.reports = this.s.reports.concat(reports).slice(-300);
      this.s.night += 1;
      return reports;
    }

    // 수도 함락 → 나라 전체 병합
    merge(A, D) {
      for (const k of Object.keys(this.s.owner)) if (this.s.owner[k] === D.id) this.s.owner[k] = A.id;
      for (const m of D.members) if (!A.members.includes(m)) A.members.push(m);
      A.provinces = A.provinces.concat(D.provinces.filter((p) => !A.provinces.includes(p)));
      A.army += D.army; A.coin += D.coin; A.wood = (A.wood || 0) + (D.wood || 0); A.vaccine = (A.vaccine || 0) + (D.vaccine || 0);
      for (const k of ['floor', 'wall', 'trap']) { A.items = A.items || {}; A.items[k] = (A.items[k] || 0) + ((D.items || {})[k] || 0); }
      for (const [i, e] of Object.entries(this.s.tiles || {})) if (e.n === D.id) e.n = A.id;
      for (const [i, nid] of Object.entries(this.s.traps || {})) if (nid === D.id) this.s.traps[i] = A.id;
      D.army = 0; D.coin = 0; D.dead = true; D.mergedInto = A.id;
      for (const b of this.s.battles) if (b.def === D.id) b.def = A.id;
    }

    // ---------------------------------------------------------- 참가자에게 보낼 화면 정보
    publicNations() {
      const out = {};
      for (const n of Object.values(this.s.nations)) out[n.id] = { id: n.id, name: n.name, team: n.team, color: n.color, capital: n.capital, dead: n.dead, kingName: n.kingName, provinces: n.provinces, members: n.members.length, store: n.storePos || null };
      return out;
    }
    view(nid, key) {
      const n = this.nation(nid);
      if (!n) return null;
      return {
        me: {
          id: n.id, name: n.name, team: n.team, color: n.color, capital: n.capital, army: n.army, coin: n.coin, actions: n.actions,
          defaultDef: n.defaultDef || null, intelAny: n.intelAny || 0, intel: n.intel || {},
          wood: n.wood || 0, vaccine: n.vaccine || 0, items: Object.assign({ floor: 0, wall: 0, trap: 0 }, n.items), vaccinePrice: NUM.vaccineBase + NUM.vaccineStep * (n.vaccBought || 0),
          isKing: n.king === key, kingName: n.kingName, members: n.members.length, territories: this.territoriesOf(n.id).length,
          declaresLeft: this.declaresLeft(n.id), provinces: n.provinces, code: n.code,
          // 접속 열쇠(토큰)는 절대 내보내지 않는다: 순번만
          memberList: n.members.map((k, i) => ({ idx: i, name: (n.memberNames || {})[k] || '?', king: k === n.king, me: k === key })),
        },
        night: this.s.night,
        outgoing: this.s.battles.filter((b) => b.att === n.id).map((b) => ({ id: b.id, target: b.target, def: b.def, a: b.a, f: b.f || null })),
        // 공격 병력은 숨김 (첩보로 알아낸 전선만 보임)
        incoming: this.s.battles.filter((b) => b.def === n.id).map((b) => ({ id: b.id, target: b.target, att: b.att, d: b.d, rd: b.rd || [0, 0, 0], f: b.f || null, rev: (b.rev || []).map((f) => ({ f, n: b.a[f] })), intel: ((n.intel || {})[b.att] || 0) + (n.intelAny || 0) })),
        reports: this.s.reports.filter((r) => r.att === n.id || r.def === n.id).slice(-12),
      };
    }
  }

  // 답 비교: 공백 무시, 숫자면 값으로 (7 = 7.0 = 07), 분수 a/b 도 값으로
  function sameAnswer(given, accepts) {
    const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, '').replace(/[,]/g, '').toLowerCase();
    const num = (v) => { const m = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(v); if (m) return +m[1] / +m[2]; return /^-?\d+(\.\d+)?$/.test(v) ? +v : NaN; };
    const g = norm(given);
    if (!g) return false;
    return (accepts || []).some((a) => { const x = norm(a); if (x === g) return true; const nx = num(x), ng = num(g); return !isNaN(nx) && !isNaN(ng) && Math.abs(nx - ng) < 1e-9; });
  }

  // 금광 기본 위치: 영토마다 1곳. 제단에서 4칸 이상, 저장소 자리에서 3칸 이상 떨어진 걸을 수 있는 칸
  function mineSpot(t, tileAt, terrAt) {
    const st = t.capitalCandidate ? storageSpot(t, tileAt) : null;
    for (let k = 0; k < 60; k++) {
      const x = t.altar[0] + Math.round((hash(t.id, k, 11) - 0.5) * 18), y = t.altar[1] + Math.round((hash(t.id, k, 12) - 0.5) * 18), g = tileAt(x, y);
      if (Math.abs(x - t.altar[0]) + Math.abs(y - t.altar[1]) < 4 || terrAt(x, y) !== t.id) continue;
      if (!(g === T.GRASS || g === T.FOREST || g === T.SAND) || treeKind(g, x, y)) continue;
      if (st && Math.max(Math.abs(st[0] - x), Math.abs(st[1] - y)) < 3) continue;
      if (t.portal && Math.max(Math.abs(t.portal[0] - x), Math.abs(t.portal[1] - y)) < 2) continue;
      return [x, y];
    }
    return null;
  }
  return { World, NUM, FRONTS, teamColor, emptyState, sameAnswer, hash, treeKind, storageSpot, mineSpot, T };
});
