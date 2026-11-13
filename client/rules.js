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
    // 영역전 (블로토) — 규칙서 16장
    minFrontPct: 0.2,              // 모든 전선에 (보낸 병력 ÷ 전선 수)의 20% 이상
    defBonus: 1.1,                 // 방어 병력 1.1배, 같으면 방어 승
    loserSurvive: 0.2,             // 진 전선은 20%만 살아 돌아옴 (이긴 쪽은 란체스터 √(이긴² − 진²))
    lootPct: 0.1,                  // 걸린 재료 중 공격팀이 가져가는 몫 (나머지는 버려짐)
    prisonerPct: 0.1,              // 방어 승리: 공격팀이 잃은 병력의 10%를 포로로
    reinforcePct: 0.1,             // 공격팀 충원: 선전포고 병력의 10%까지 (모든 전선 합쳐)
    maxAttackers: 2,               // 한 전투 시간에 한 나라에 선전포고할 수 있는 나라 수
    capitalMoveCost: 1000, capitalMoveCooldownH: 24, // 천도
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
  // 저장소 모습 단계: 목재 500개 이상 → 2단계, 1000개 이상 → 3단계
  const storeLevel = (n) => ((n.wood || 0) >= 1000 ? 2 : (n.wood || 0) >= 500 ? 1 : 0);
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
  const FRONTS = ['A', 'B', 'C']; // 예전 3전선 (지금은 전선 수가 2k+1로 바뀜)
  const frontName = (i) => (i < 26 ? String.fromCharCode(65 + i) : 'Z' + (i - 25));

  function emptyState() { return { nations: {}, owner: {}, battles: [], reports: [], night: 1, nextBattle: 1, nextTeam: 1, tiles: {}, traps: {}, chopped: {}, mines: {}, gone: {}, vax: {}, riftNext: null }; }
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const randCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const clampTroops = (arr, n = 3) => (Array.isArray(arr) && arr.length === n && n > 0 && n <= 99) ? arr.map((v) => Math.max(0, Math.min(1e7, Math.floor(+v || 0)))) : null;
  const sum = (a) => (a || []).reduce((x, y) => x + (y || 0), 0);
  // 전선마다 꼭 넣어야 하는 최소 병력 = (보낸 병력 ÷ 전선 수)의 20% (올림)
  const minPerFront = (total, F) => (total > 0 ? Math.ceil(NUM.minFrontPct * total / F) : 0);
  const okMin = (arr) => { const m = minPerFront(sum(arr), arr.length); return arr.every((v) => v >= m); };

  class World {
    constructor(map, state) {
      this.t = {};
      for (const t of map.territories) this.t[t.id] = t;
      this.caps = map.territories.filter((t) => t.capitalCandidate).sort((a, b) => a.id - b.id);
      this.s = state || emptyState();
      for (const k of ['tiles', 'traps', 'chopped', 'mines', 'gone', 'vax']) this.s[k] = this.s[k] || {}; // 예전 저장 상태 호환 (mines: 옮긴 금광 위치)
      this._dist = {};
      for (const b of this.s.battles || []) { if (!b.F) b.F = b.a.length; if (!b.ar) b.ar = b.a.map(() => 0); if (b.rd) { const D = this.s.nations[b.def]; if (D) D.army += sum(b.rd); delete b.rd; } } // 예전 3전선 전투 호환
    }

    // ---------------------------------------------------------- 조회
    nation(id) { return this.s.nations[id] || null; }
    alive() { return Object.values(this.s.nations).filter((n) => !n.dead); }
    ownerOf(tid) { return this.s.owner[tid] || null; }
    territoriesOf(nid) { return Object.keys(this.s.owner).filter((k) => this.s.owner[k] === nid).map(Number); }
    nationOfPlayer(key) { return this.alive().find((n) => n.members.includes(key)) || null; }
    touches(nid, tid) { const t = this.t[tid]; return !!t && !this.s.gone[tid] && t.neighbors.some((nb) => this.s.owner[nb] === nid); }
    isGone(tid) { return !!this.s.gone[tid]; }

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
    // 여러 출발점에서 영역을 몇 번 건너야 닿는지 (공격팀 땅 → 방어팀 영역 순서 정하기)
    distFrom(srcSet) {
      const d = {}; const q = [];
      for (const s0 of srcSet) { d[s0] = 0; q.push(s0); }
      while (q.length) { const c = q.shift(); for (const nb of (this.t[c] ? this.t[c].neighbors : [])) if (d[nb] == null) { d[nb] = d[c] + 1; q.push(nb); } }
      return d;
    }
    frontCount(nid) { return 2 * this.territoriesOf(nid).length + 1; } // 전선 수 = 영역 수 k → 2k+1

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
      if (this.s.gone[tid]) return { ok: false, err: '균열에 삼켜진 땅이에요' };
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
    // slot: 전투 시간 번호 (서버가 정함: 일차·점심/밤). 같은 전투 시간 안에서만 횟수를 셈
    declaresLeft(nid, slot) { return NUM.maxDeclare - this.s.battles.filter((b) => b.att === nid && (slot == null || b.slot === slot)).length; }

    declare(nid, tid, troops, slot) {
      const n = this.nation(nid), t = this.t[tid];
      if (!n || n.dead || !t) return { ok: false, err: '잘못된 요청이에요' };
      const def = this.s.owner[tid];
      if (!def) return { ok: false, err: '주인 없는 땅은 전투가 아니라 점령으로 가져와요' };
      if (def === nid) return { ok: false, err: '우리 땅이에요' };
      if (this.s.gone[tid]) return { ok: false, err: '균열에 삼켜진 땅이에요' };
      if (!this.touches(nid, tid)) return { ok: false, err: '우리 땅과 경계선이 붙은 적 영토만 공격할 수 있어요' };
      const F = this.frontCount(def);
      troops = clampTroops(troops, F);
      if (!troops) return { ok: false, err: `전선 ${F}곳에 모두 병력을 정해 주세요` };
      if (this.declaresLeft(nid, slot) <= 0) return { ok: false, err: `한 전투 시간에 선전포고는 ${NUM.maxDeclare}번까지예요` };
      if (this.s.battles.some((b) => b.target === tid && b.slot === slot)) return { ok: false, err: '그 땅은 이번 전투에 이미 다른 나라가 공격해요' };
      const atks = new Set(this.s.battles.filter((b) => b.def === def && b.slot === slot).map((b) => b.att));
      if (!atks.has(nid) && atks.size >= NUM.maxAttackers) return { ok: false, err: `전쟁의 신의 가호: 그 나라는 이번 전투에 이미 ${NUM.maxAttackers}나라와 싸워요` };
      const total = sum(troops);
      if (total <= 0) return { ok: false, err: '병력을 1명 이상 보내야 해요' };
      if (total > n.army) return { ok: false, err: `병력이 모자라요 (보유 ${n.army})` };
      if (!okMin(troops)) return { ok: false, err: `모든 전선에 최소 ${minPerFront(total, F)}명은 보내야 해요 (보낸 병력 ÷ 전선 수의 20%)` };
      n.army -= total;
      const b = { id: this.s.nextBattle++, night: this.s.night, slot, att: nid, def, target: tid, F, a: troops, ar: troops.map(() => 0), d: null };
      this.s.battles.push(b);
      return { ok: true, battle: b };
    }
    // 기본 방어 비율: 방어 배치를 못 했을 때 이 비율로 자동 배치 (전선 수가 다르면 비율을 되풀이해서 씀)
    setDefault(nid, ratio) {
      const n = this.nation(nid); const r = Array.isArray(ratio) && ratio.length >= 1 && ratio.length <= 99 ? ratio.map((v) => Math.max(0, Math.floor(+v || 0))) : null;
      if (!n || !r || sum(r) <= 0) return { ok: false, err: '비율 중 하나는 0보다 커야 해요' };
      n.defaultDef = r; return { ok: true };
    }
    // 공격팀 충원·빼기 (팀원 누구나, 전선 근처에서): 선전포고 병력의 10%까지, 선전포고 때 병력은 못 뺌
    reinforce(nid, battleId, front, amount) {
      const n = this.nation(nid), b = this.s.battles.find((x) => x.id === battleId);
      if (!n || !b || b.att !== nid) return { ok: false, err: '우리가 공격하는 전투에만 충원할 수 있어요' };
      if (!(front >= 0 && front < b.F)) return { ok: false, err: '그런 전선이 없어요' };
      amount = Math.trunc(+amount || 0); if (!amount) return { ok: false, err: '숫자를 적어 주세요' };
      b.ar = b.ar || b.a.map(() => 0);
      const cap = Math.floor(NUM.reinforcePct * sum(b.a)), used = sum(b.ar);
      if (amount > 0) {
        if (used + amount > cap) return { ok: false, err: `충원은 모든 전선 합쳐 ${cap}명까지예요 (남은 ${cap - used}명)` };
        if (amount > n.army) return { ok: false, err: `나라 병력이 모자라요 (남은 ${n.army})` };
      } else if (-amount > b.ar[front]) return { ok: false, err: `이 전선에서 뺄 수 있는 충원 병력은 ${b.ar[front]}명이에요 (선전포고 때 병력은 못 빼요)` };
      n.army -= amount; b.ar[front] += amount;
      return { ok: true, amount, now: b.a[front] + b.ar[front], used: sum(b.ar), cap };
    }
    // 첩보: 공격해 온 나라의 전선 하나 병력 보기 (방어할 때만). 그 나라 전용 첩보 → 없으면 아무 나라용 첩보
    useIntel(nid, battleId) {
      const n = this.nation(nid), b = this.s.battles.find((x) => x.id === battleId && x.def === nid);
      if (!n || !b) return { ok: false, err: '공격받는 전투에만 쓸 수 있어요' };
      b.rev = b.rev || [];
      const left = b.a.map((_, f) => f).filter((f) => !b.rev.includes(f));
      if (!left.length) return { ok: false, err: '모든 전선을 다 알아냈어요' };
      n.intel = n.intel || {};
      if ((n.intel[b.att] || 0) > 0) n.intel[b.att]--; else if ((n.intelAny || 0) > 0) n.intelAny--; else return { ok: false, err: '쓸 수 있는 첩보가 없어요' };
      const f = left[Math.floor(Math.random() * left.length)]; b.rev.push(f);
      return { ok: true, front: f, troops: b.a[f] + ((b.ar || [])[f] || 0) };
    }
    // 균열: 백신 쓰기 (다음 웨이브 예고에 든 우리 영토 하나를 그 웨이브에서 지킴)
    vaccinate(nid, tid) {
      const n = this.nation(nid), rn = this.s.riftNext;
      if (!n || !rn) return { ok: false, err: '아직 예고된 균열이 없어요' };
      if (!rn.terrs.includes(tid)) return { ok: false, err: '다음 균열에 무너질 땅이 아니에요' };
      if (this.s.owner[tid] !== nid) return { ok: false, err: '우리 땅에만 쓸 수 있어요' };
      if (this.s.vax[tid] === rn.wave) return { ok: false, err: '이미 백신을 썼어요' };
      if (!(n.vaccine > 0)) return { ok: false, err: '백신이 없어요 (하늘 거래소)' };
      n.vaccine--; this.s.vax[tid] = rn.wave; return { ok: true };
    }
    refund(b) { const A = this.nation(b.att), D = this.nation(b.def); if (A && !A.dead) A.army += sum(b.a) + sum(b.ar); if (D && !D.dead && b.d) D.army += sum(b.d); }
    // 균열 웨이브: 예고된 땅이 무너진다. 나라 수도와 백신 맞은 땅은 안전
    riftWave(wave, terrs) {
      const caps = new Set(this.alive().map((n) => n.capital)), fell = [], saved = [];
      for (const tid of terrs) {
        if (this.s.gone[tid]) continue;
        if (caps.has(tid) || this.s.vax[tid] === wave) { saved.push(tid); continue; }
        this.s.gone[tid] = 1; fell.push({ tid, owner: this.s.owner[tid] || null }); delete this.s.owner[tid];
      }
      this.s.battles = this.s.battles.filter((b) => { if (!this.s.gone[b.target]) return true; this.refund(b); return false; });
      this.s.riftNext = null;
      return { fell, saved };
    }
    publicBattles() { return this.s.battles.map((b) => ({ id: b.id, target: b.target, att: b.att, def: b.def, f: b.f || null, F: b.F, slot: b.slot })); }
    // 방어 배치 (왕만 — 서버에서 확인): 막을 병력 수와 배치는 전투 전까지 몇 번이든 바꿀 수 있음
    defend(nid, battleId, troops) {
      const n = this.nation(nid);
      const b = this.s.battles.find((x) => x.def === nid && x.id === battleId);
      if (!n || !b) return { ok: false, err: '방어할 전투가 없어요' };
      troops = clampTroops(troops, b.F);
      if (!troops) return { ok: false, err: `전선 ${b.F}곳에 모두 병력을 정해 주세요` };
      const prev = b.d ? sum(b.d) : 0;
      if (sum(troops) > n.army + prev) return { ok: false, err: `병력이 모자라요 (쓸 수 있는 병력 ${n.army + prev})` };
      if (!okMin(troops)) return { ok: false, err: `모든 전선에 최소 ${minPerFront(sum(troops), b.F)}명은 배치해야 해요 (막을 병력 ÷ 전선 수의 20%)` };
      n.army += prev - sum(troops);
      b.d = troops; n.lastDef = troops.slice();
      return { ok: true };
    }
    // 자동 방어: 남은 병력을 아직 배치 안 한 전투 수로 나누고, 기본 비율로 전선에 나눈 뒤 최소치를 맞춤
    autoDefense(D, b, pending) {
      const left = pending.filter((x) => x.def === b.def && !x.d && !x._done).length || 1;
      const pool = Math.floor(D.army / left), F = b.F;
      const r0 = D.defaultDef && sum(D.defaultDef) > 0 ? D.defaultDef : [1];
      const w = Array.from({ length: F }, (_, i) => r0[i % r0.length]);
      let d = w.map((v) => Math.floor(pool * v / (sum(w) || 1)));
      d[0] += pool - sum(d);
      const m = minPerFront(pool, F);
      for (let i = 0; i < F; i++) if (d[i] < m) { let need = m - d[i]; d[i] = m; while (need > 0) { let j = d.indexOf(Math.max(...d)); if (d[j] <= m) break; const k = Math.min(need, d[j] - m); d[j] -= k; need -= k; } }
      D.army -= sum(d);
      return d;
    }

    // 13시·22시: 그 전투 시간의 전투를 한 번에 처리. slot 이 없으면 전부 처리 (테스트용)
    resolveAll(slot) {
      const reports = [];
      const pending = this.s.battles.filter((b) => slot == null || b.slot == null || b.slot <= slot).sort((x, y) => x.id - y.id);
      this.s.battles = this.s.battles.filter((b) => !pending.includes(b));
      for (const b of pending) {
        const A = this.nation(b.att), D = this.nation(b.def);
        if (!A || A.dead || !D || D.dead || this.s.owner[b.target] !== b.def) { this.refund(b); continue; }
        const F = b.F, ar = b.ar || b.a.map(() => 0), aT = b.a.map((v, i) => v + ar[i]);
        let d = b.d, auto = false;
        if (!d) { d = this.autoDefense(D, b, pending); auto = true; }
        b._done = true;
        const effD = d.map((v) => Math.round(v * NUM.defBonus * 10) / 10);
        const fronts = aT.map((v, i) => (v > effD[i] ? 'att' : 'def')); // 같으면 방어 승
        const attWon = fronts.filter((f) => f === 'att').length, defWon = F - attWon;
        const attWins = attWon * 2 > F;
        // 병력 손실 (전선마다, 란체스터 제곱 법칙): 이긴 쪽 남는 병력 = √(이긴² − 진²), 진 쪽은 20%만 살아 돌아옴
        let survA = 0, survD = 0;
        for (let i = 0; i < F; i++) {
          if (fronts[i] === 'att') { survA += Math.floor(Math.sqrt(Math.max(0, aT[i] ** 2 - effD[i] ** 2))); survD += Math.floor(d[i] * NUM.loserSurvive); }
          else { survD += Math.min(d[i], Math.floor(Math.sqrt(Math.max(0, effD[i] ** 2 - aT[i] ** 2)) / NUM.defBonus)); survA += Math.floor(aT[i] * NUM.loserSurvive); }
        }
        const lossA = sum(aT) - survA, lossD = sum(d) - survD;
        A.army += survA; D.army += survD;
        const rep = {
          id: b.id, night: b.night, slot: b.slot, target: b.target, att: b.att, def: b.def, attName: A.name, defName: D.name, F,
          a: aT, d, autoDef: auto, effA: aT, effD, fronts, attWon, defWon, winner: attWins ? 'att' : 'def', lossA, lossD,
          capital: b.target === D.capital, lost: [], loot: null, prisoners: 0, destroyed: false, newCapital: null, members: null,
        };
        if (attWins) {
          // 잃는 영역 수 = ⌈방어팀 영역 수 × (공격이 이긴 전선 − 방어가 이긴 전선) ÷ 전선 수⌉
          const mine = this.territoriesOf(D.id), k = mine.length;
          const L = Math.min(k, Math.max(1, Math.ceil(k * (attWon - defWon) / F)));
          // 순서: 선전포고한 영역 → 공격팀 땅(빼앗은 땅 포함)에서 가까운 영역 → 같으면 수도가 아닌 곳 먼저
          const lost = [b.target]; this.s.owner[b.target] = A.id;
          while (lost.length < L) {
            const dist = this.distFrom(this.territoriesOf(A.id));
            const cand = this.territoriesOf(D.id).sort((x, y) => (dist[x] ?? 99) - (dist[y] ?? 99) || (x === D.capital) - (y === D.capital) || x - y);
            if (!cand.length) break; lost.push(cand[0]); this.s.owner[cand[0]] = A.id;
          }
          rep.lost = lost;
          // 재료: 잃은 영역 비율만큼 걸리고, 그중 10%가 공격팀으로, 나머지는 버려짐
          const share = lost.length / k, loot = {};
          const take = (obj, key) => { const v = Math.floor((obj[key] || 0) * share); obj[key] = (obj[key] || 0) - v; return v; };
          for (const key of ['coin', 'wood', 'vaccine']) { const v = take(D, key); const g = Math.floor(v * NUM.lootPct); A[key] = (A[key] || 0) + g; loot[key] = g; }
          D.items = D.items || {}; A.items = A.items || {};
          for (const key of ['floor', 'wall', 'trap']) { const v = take(D.items, key); const g = Math.floor(v * NUM.lootPct); A.items[key] = (A.items[key] || 0) + g; loot[key] = g; }
          rep.loot = loot;
          // 빼앗은 영역의 저장소 입구·설치물은 공격팀 것
          for (const [ti, e] of Object.entries(this.s.tiles || {})) if (e.n === D.id && lost.includes(this.tileTerr ? this.tileTerr(+ti) : -1)) e.n = A.id;
          if (this.territoriesOf(D.id).length === 0) { rep.destroyed = true; rep.members = D.members.slice(); this.destroy(D); }
          else if (lost.includes(D.capital)) {
            // 강제 천도: 남은 영역 중 공격팀에게서 가장 먼 곳
            const dist = this.distFrom(this.territoriesOf(A.id));
            const far = this.territoriesOf(D.id).sort((x, y) => (dist[y] ?? 99) - (dist[x] ?? 99) || x - y)[0];
            D.capital = far; D.capitalMovedAt = 0; rep.newCapital = far;
          }
        } else {
          const pr = Math.floor(lossA * NUM.prisonerPct); D.army += pr; rep.prisoners = pr; // 방어 보상: 포로
        }
        reports.push(rep);
      }
      this.s.reports = this.s.reports.concat(reports).slice(-300);
      this.s.night += 1;
      return reports;
    }
    // 모든 영역을 잃은 나라: 멸망 → 팀원은 유랑민
    destroy(D) {
      D.dead = true; D.army = 0; D.coin = 0; D.wood = 0; D.vaccine = 0; D.items = {}; D.members = []; D.destroyedAt = Date.now();
      for (const b of this.s.battles.filter((x) => x.att === D.id || x.def === D.id)) this.refund(b);
      this.s.battles = this.s.battles.filter((x) => x.att !== D.id && x.def !== D.id);
    }
    // 천도 (왕만 — 서버에서 확인): 비용, 우리 영역, 전투 대기 중 불가, 하루에 한 번
    moveCapital(nid, tid, now) {
      const n = this.nation(nid);
      if (!n || n.dead) return { ok: false, err: '나라가 없어요' };
      if (this.s.owner[tid] !== nid) return { ok: false, err: '우리 영역으로만 천도할 수 있어요' };
      if (tid === n.capital) return { ok: false, err: '이미 수도예요' };
      if (this.s.battles.some((b) => b.def === nid)) return { ok: false, err: '선전포고를 받은 동안은 천도할 수 없어요' };
      const wait = (n.capitalMovedAt || 0) + NUM.capitalMoveCooldownH * 3600e3 - now;
      if (wait > 0) return { ok: false, err: `천도는 하루에 한 번이에요 (${Math.ceil(wait / 3600e3)}시간 뒤)` };
      if ((n.coin || 0) < NUM.capitalMoveCost) return { ok: false, err: `코인이 모자라요 (천도 ${NUM.capitalMoveCost})` };
      n.coin -= NUM.capitalMoveCost; n.oldCapitals = (n.oldCapitals || []).concat(n.capital).slice(-20); n.capital = tid; n.capitalMovedAt = now;
      return { ok: true };
    }

    // ---------------------------------------------------------- 참가자에게 보낼 화면 정보
    publicNations() {
      const out = {};
      for (const n of Object.values(this.s.nations)) out[n.id] = { id: n.id, name: n.name, team: n.team, color: n.color, capital: n.capital, dead: n.dead, kingName: n.kingName, provinces: n.provinces, members: n.members.length, store: n.storePos || null, storeLv: storeLevel(n) };
      return out;
    }
    view(nid, key) {
      const n = this.nation(nid);
      if (!n) return null;
      return {
        me: {
          id: n.id, name: n.name, team: n.team, color: n.color, capital: n.capital, army: n.army, coin: n.coin, actions: n.actions,
          vaxed: this.s.riftNext ? Object.keys(this.s.vax).filter((t) => this.s.vax[t] === this.s.riftNext.wave && this.s.owner[t] === n.id).map(Number) : [],
          defaultDef: n.defaultDef || null, intelAny: n.intelAny || 0, intel: n.intel || {},
          wood: n.wood || 0, vaccine: n.vaccine || 0, items: Object.assign({ floor: 0, wall: 0, trap: 0 }, n.items), vaccinePrice: NUM.vaccineBase + NUM.vaccineStep * (n.vaccBought || 0),
          isKing: n.king === key, kingName: n.kingName, members: n.members.length, territories: this.territoriesOf(n.id).length,
          declaresLeft: this.declaresLeft(n.id, this.s.curSlot), provinces: n.provinces, code: n.code,
          // 접속 열쇠(토큰)는 절대 내보내지 않는다: 순번만
          memberList: n.members.map((k, i) => ({ idx: i, name: (n.memberNames || {})[k] || '?', king: k === n.king, me: k === key })),
        },
        night: this.s.night,
        outgoing: this.s.battles.filter((b) => b.att === n.id).map((b) => ({ id: b.id, target: b.target, def: b.def, a: b.a, ar: b.ar || b.a.map(() => 0), F: b.F, cap: Math.floor(NUM.reinforcePct * sum(b.a)), f: b.f || null, slot: b.slot })),
        // 공격 병력은 숨김 (첩보로 알아낸 전선만 보임)
        incoming: this.s.battles.filter((b) => b.def === n.id).map((b) => ({ id: b.id, target: b.target, att: b.att, d: b.d, F: b.F, f: b.f || null, slot: b.slot, rev: (b.rev || []).map((f) => ({ f, n: b.a[f] + ((b.ar || [])[f] || 0) })), intel: ((n.intel || {})[b.att] || 0) + (n.intelAny || 0) })),
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

  // 영토 이름 (번호로 고정 — 화면과 서버 알림이 같은 이름을 씀)
  const SYL = ['라온', '솔빛', '미르', '벼리', '가람', '누리', '다온', '초롱', '하람', '윤슬', '아라', '한결', '새벽', '별하', '온새', '나린', '해솔', '그루', '여울', '도담', '마루', '보람', '시나', '이든'];
  const SUFFIX = { inner: '령', middle: '주', frontier: ' 변경' };
  function terrName(t) {
    const a = SYL[(t.id * 7) % SYL.length];
    if (t.region) return `${t.region} ${a}`;
    const b = ['', '', '동', '서', '남', '북'][(t.id * 13) % 6]; return a + b + SUFFIX[t.ring];
  }
  // 하늘 포털 자리: 수도 후보 영토는 지도에 정해진 자리, 그 밖의 영토(천도한 수도 등)는 제단 위쪽의 걸을 수 있는 칸
  const PORTAL_OFFS = [[0, -3], [0, 3], [-3, -2], [3, -2], [-3, 2], [3, 2], [0, -4], [0, 4], [-4, 0], [4, 0]];
  function portalSpot(t, tileAt) {
    if (t.portal) return t.portal;
    for (const [dx, dy] of PORTAL_OFFS) { const x = t.altar[0] + dx, y = t.altar[1] + dy, k = tileAt(x, y); if ((k === T.GRASS || k === T.FOREST || k === T.SAND) && !treeKind(k, x, y) && (tileAt(x, y + 1) === T.GRASS || tileAt(x, y + 1) === T.SAND || tileAt(x, y + 1) === T.FOREST)) return [x, y]; }
    return [t.altar[0], t.altar[1] - 2];
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
  return { World, NUM, FRONTS, frontName, terrName, minPerFront, okMin, portalSpot, teamColor, emptyState, sameAnswer, hash, treeKind, storageSpot, mineSpot, T };
});
