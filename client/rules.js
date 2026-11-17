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
  // 건축물 목록: 종류(cat)마다 효과가 같고, 테마는 모양만 다름. 바닥 = 우리 국민 1.5배 빠름 · 벽/기둥 = 다른 나라 사람 막음(내구도) · 장식 = 밟고 지나감 · 덫
  const THEMES = { heaven: '천상', forest: '숲', winter: '겨울', stone: '돌' };
  const BUILD = [
    ['f_gold', 'floor', 'heaven', '황금 대리석'], ['f_cloud', 'floor', 'heaven', '구름 바닥'], ['f_sky', 'floor', 'heaven', '하늘 융단'], ['f_amethyst', 'floor', 'heaven', '자수정 타일'],
    ['f_wood', 'floor', 'forest', '나무 판자'], ['f_moss', 'floor', 'forest', '이끼 돌길'],
    ['f_ice', 'floor', 'winter', '얼음 바닥'], ['f_snow', 'floor', 'winter', '눈 벽돌'],
    ['f_stone', 'floor', 'stone', '돌 바닥'], ['f_brick', 'floor', 'stone', '붉은 벽돌'], ['f_sand', 'floor', 'stone', '모래 타일'],
    ['w_marble', 'wall', 'heaven', '대리석 벽'], ['p_marble', 'wall', 'heaven', '황금 기둥'],
    ['w_fence', 'wall', 'forest', '나무 울타리'], ['p_wood', 'wall', 'forest', '통나무 기둥'],
    ['w_ice', 'wall', 'winter', '얼음 벽'], ['p_ice', 'wall', 'winter', '얼음 기둥'],
    ['w_brick', 'wall', 'stone', '벽돌 방벽'], ['p_stone', 'wall', 'stone', '돌 기둥'],
    ['d_lantern', 'deco', 'heaven', '빛 수정 등불'], ['d_urn', 'deco', 'heaven', '꽃 화분'],
    ['d_flower', 'deco', 'forest', '꽃밭'], ['d_mush', 'deco', 'forest', '버섯'],
    ['d_snowman', 'deco', 'winter', '눈사람'], ['d_crystal', 'deco', 'winter', '얼음 수정'],
    ['d_torch', 'deco', 'stone', '횃불'],
    ['trap', 'trap', 'stone', '덫'],
  ].map(([id, cat, theme, name]) => ({ id, cat, theme, name }));
  // 농사: 작물 (실제 시간으로 자람 · 수로 2칸 안이면 20% 빨리 · 비료 주면 남은 시간 절반)
  const CROPS = {
    wheat: { name: '밀', seed: 10, min: 20, yield: 2, sell: 15 },
    carrot: { name: '당근', seed: 20, min: 40, yield: 2, sell: 25 },
    potato: { name: '감자', seed: 30, min: 60, yield: 3, sell: 20 },
    berry: { name: '딸기', seed: 50, min: 120, yield: 3, sell: 40 },
    pumpkin: { name: '호박', seed: 80, min: 240, yield: 1, sell: 250 },
  };
  // 낚시: 물고기 (w = 잡힐 무게, 비 오면 귀한 것(rare)이 1.5배)
  const FISH = {
    crucian: { name: '붕어', w: 40, sell: 3 }, carp: { name: '잉어', w: 26, sell: 6 }, trout: { name: '송어', w: 16, sell: 10 },
    salmon: { name: '연어', w: 10, sell: 15, rare: 1 }, goldcarp: { name: '황금 잉어', w: 3, sell: 60, rare: 1 }, legend: { name: '전설의 하늘고래', w: 0.6, sell: 150, rare: 1 },
  };
  const TOOLS = { pick: { name: '곡괭이', price: 300, use: '금광·산 캐기' }, axe: { name: '나무도끼', price: 150, use: '나무 베기' }, rod: { name: '낚싯대', price: 200, use: '낚시' }, shovel: { name: '삽', price: 150, use: '씨앗 심기·수확' } }; // 작업 도구: 사람마다 하나씩 (내 코인 = 개인 지갑으로 삼)
  for (const [k, f] of Object.entries(FISH)) BUILD.push({ id: 'fi_' + k, cat: 'crop', theme: 'stone', name: f.name, sell: f.sell, fish: k });
  BUILD.push({ id: 'b_wood', cat: 'bridge', theme: 'forest', name: '나무 다리', price: 25 }, { id: 'b_stone', cat: 'bridge', theme: 'stone', name: '돌 다리', price: 25 });
  BUILD.push({ id: 'farm', cat: 'farm', theme: 'forest', name: '밭', price: 10 }, { id: 'canal', cat: 'water', theme: 'stone', name: '수로', price: 15 }, { id: 'fert', cat: 'fert', theme: 'forest', name: '비료', price: 40 });
  for (const [k, c] of Object.entries(CROPS)) BUILD.push({ id: 's_' + k, cat: 'seed', theme: 'forest', name: c.name + ' 씨앗', price: c.seed, crop: k }, { id: 'p_' + k, cat: 'crop', theme: 'forest', name: c.name, sell: c.sell, crop: k });
  const BUILD_BY = Object.fromEntries(BUILD.map((b) => [b.id, b]));
  const LEGACY_FLOOR = ['f_stone', 'f_wood', 'f_brick', 'f_sand', 'f_sky', 'f_amethyst']; // 예전 바닥 색 번호 → 디자인
  function normItems(items) { const o = {}; for (const [k, v] of Object.entries(items || {})) { const id = k === 'floor' ? 'f_stone' : k === 'wall' ? 'w_brick' : k; if (BUILD_BY[id] && v > 0) o[id] = (o[id] || 0) + v; } return o; }
  function tileItem(e) { return !e ? null : e.id || (e.k === 'floor' ? LEGACY_FLOOR[e.c | 0] || 'f_stone' : e.k === 'wall' ? 'w_brick' : null); }
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
    puzzleArmy: 10,                // 우리 영토 제단 퍼즐 1문제 병력 (숫자는 나중에)
    maxMembersEarly: 6,            // 1~2일차 나라 인원 (3일차부터 제한 없음)
    claimPerDay: 5, claimFreeDay: 5, claimStartDay: 2, // 주인 없는 땅: 2일차부터, 하루 5곳, 5일차부터 제한 없음
    joinBanH: 24,                  // 나가거나 내보내진 사람은 24시간 동안 가입 불가
    sudokuSec: 300, slideSec: 180, sudokuGivens: 46, // 퍼즐 시간 제한(초), 스도쿠 쉬운 난이도(처음 보이는 칸 수)
    // 영지 (나라 공용 저장소)
    woodPerTree: 2,                // 나무 1그루 목재
    price: { floor: 20, wall: 60, deco: 30, trap: 150 }, // 건축 상점 가격 (코인, 1개 · 종류별로 같음, 테마는 모양만 다름)
    cropSellMe: 0.2, // 작물 판 값: 나라 80% · 판 사람 20% (내 코인). 물고기는 내 가방 → 100% 내 코인
    tradeSlots: 6, tradeTiles: 2,
    pvp: { hp: 100, respawnSec: 10, invMs: 3000, regenAfterMs: 6000, regen: 3, dropPct: 0.3, lootMin: 3, crit: 0.1 },
    weaponDay: 3, digCoin: 15, digPerDay: 40,
    maxAlly: 3, rainChance: 0.18, allyMeetTiles: 3,
    fishPerDay: 40, fishBite: [2.5, 6.5], fishRainK: 0.6, mineHoldMs: 2400,
    canalBoost: 0.8, canalRange: 2, maxFarms: 120, maxCanals: 60,
    buildHp: 100, hitDmg: 10, hitCdMs: 380, maxDeco: 80, // 벽·기둥 내구도: 한 번 때리면 −10 (E 꾹 = 0.4초마다)
    vaccineBase: 3000, vaccineStep: 500,       // 백신: 나라가 살 때마다 비싸짐 (쓰면 영역 하나 침식 0%)
    erodeStep: 10, erodeFall: 50,  // 균열: 멸망 선포 다음 날부터 매일 아침 영역마다 침식 +10%, 나라 전체 침식 50% 이상이면 멸망 (수도는 침식 안 됨)
    maxWalls: 60, maxTraps: 12,    // 나라당 설치 한도
    floorSpeed: 1.5,               // 우리 나라 바닥 위에서 빨라지는 배수
    wallBreakSec: 5, chopSec: 2,   // 방벽 부수기·나무 베기 시간
    scoutHits: 10,                 // 적 수정을 이만큼 때리면 그 나라 병력이 보임
    scoutResetMin: 10,             // 10분 동안 다시 안 때리면 횟수 처음부터
    stealPct: 0.03, stealMax: { coin: 300, wood: 30 }, // 털기: 저장소 각 재료의 3%, 최대치 (숫자는 영지에서 다시)
    // 악명: 수정 1번 +10 (10번 = +100), 털기 +50, 체포하면 −20, 체포당하면 75%로
    notoriety: { hit: 10, steal: 50, arrest: -20, arrestedMul: 0.75 },
    // 악명 단계: 감옥 시간(분)·보석금·체포 보상금 (임시, 나중에 다시)
    notorietyTiers: [{ min: -1e9, jailMin: 60, bail: 500, bounty: 0 }, { min: 200, jailMin: 90, bail: 1000, bounty: 200 }, { min: 500, jailMin: 120, bail: 2000, bounty: 500 }],
    stealSec: 3, arrestJail: 3, jailMin: 60, // 훔치기 시간, 체포 스택 몇이면 감옥, 기본 감옥 시간(분)
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
  const RACES = ['human', 'elf', 'dwarf']; // 병력 종족 (지금은 모습만: 인간=검, 엘프=활, 드워프=도끼)
  const FRONTS = ['A', 'B', 'C']; // 예전 3전선 (지금은 전선 수가 2k+1로 바뀜)
  const frontName = (i) => (i < 26 ? String.fromCharCode(65 + i) : 'Z' + (i - 25));

  function emptyState() { return { nations: {}, owner: {}, battles: [], reports: [], night: 1, nextBattle: 1, nextTeam: 1, tiles: {}, traps: {}, chopped: {}, dug: {}, mines: {}, gone: {}, vax: {}, erosion: {}, riftNext: null }; }
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
      for (const k of ['tiles', 'traps', 'chopped', 'dug', 'mines', 'gone', 'vax', 'erosion']) this.s[k] = this.s[k] || {}; // 예전 저장 상태 호환 (mines: 옮긴 금광 위치)
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
    foundNation(key, playerName, nationName, capitalId, color) {
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
      if (COLORS.includes(color) && !this.alive().some((x) => x !== n && x.color === color)) n.color = color; // 건국할 때 고른 나라 색 (겹치면 기본 색)
      return { ok: true, nation: n };
    }
    joinNation(key, playerName, code, maxMembers) {
      if (this.nationOfPlayer(key)) return { ok: false, err: '이미 나라에 속해 있어요' };
      const n = this.alive().find((x) => x.code === String(code || '').toUpperCase().trim());
      if (!n) return { ok: false, err: '그런 초대 코드가 없어요' };
      const cap = maxMembers == null ? NUM.maxMembersEarly : maxMembers;
      if (n.members.length >= cap) return { ok: false, err: `그 나라는 ${cap}명이 다 찼어요 (3일차부터 인원 제한 없음)` };
      n.members.push(key); n.memberNames = n.memberNames || {}; n.memberNames[key] = playerName;
      return { ok: true, nation: n };
    }
    // 나라 나가기: 왕은 왕을 넘긴 뒤에만. 혼자 남은 왕이 나가면 나라 해체 (영토는 주인 없는 땅)
    leaveNation(key) {
      const n = this.nationOfPlayer(key); if (!n) return { ok: false, err: '나라에 속해 있지 않아요' };
      if (n.king === key && n.members.length > 1) return { ok: false, err: '왕은 다른 팀원에게 왕을 넘긴 뒤에 나갈 수 있어요' };
      n.members = n.members.filter((k) => k !== key);
      if (!n.members.length) { for (const t of this.territoriesOf(n.id)) delete this.s.owner[t]; this.destroy(n); return { ok: true, nation: n, disbanded: true }; }
      return { ok: true, nation: n };
    }
    // 왕이 팀원 내보내기 (idx: 국민 순번)
    kick(nid, kingKey, idx) {
      const n = this.nation(nid); const key = n ? n.members[idx | 0] : null;
      if (!n || n.king !== kingKey) return { ok: false, err: '왕만 내보낼 수 있어요' };
      if (!key || key === kingKey) return { ok: false, err: '그 사람은 내보낼 수 없어요' };
      n.members = n.members.filter((k) => k !== key);
      return { ok: true, nation: n, key };
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
    // 하루 점령 제한 확인 (day: 게임 일차). 2일차부터, 5일차부터 제한 없음
    claimBlock(n, day, dayKey) {
      if (day != null && day < NUM.claimStartDay) return `주인 없는 땅 점령은 ${NUM.claimStartDay}일차부터예요`;
      if (day != null && day >= NUM.claimFreeDay) return null;
      const c = n.claims && n.claims.day === dayKey ? n.claims.n : 0;
      if (c >= NUM.claimPerDay) return `오늘은 주인 없는 땅을 ${NUM.claimPerDay}곳까지 점령했어요 (${NUM.claimFreeDay}일차부터 제한 없음)`;
      return null;
    }
    claim(nid, tid, dayKey, free, day) {
      const n = this.nation(nid), t = this.t[tid];
      if (!n || n.dead || !t) return { ok: false, err: '나라나 영토가 없어요' };
      this.refreshActions(n, dayKey);
      const blk = this.claimBlock(n, day, dayKey); if (blk) return { ok: false, err: blk };
      if (this.s.gone[tid]) return { ok: false, err: '균열에 삼켜진 땅이에요' };
      if (this.s.owner[tid]) return { ok: false, err: '이미 주인이 있는 땅이에요' };
      if (!this.touches(nid, tid)) return { ok: false, err: '우리 땅과 붙어 있는 곳만 점령할 수 있어요' };
      if (!free && n.actions <= 0) return { ok: false, err: '오늘 행동력을 다 썼어요' };
      if (!free) n.actions -= 1;
      this.s.owner[tid] = nid;
      n.claims = n.claims && n.claims.day === dayKey ? n.claims : { day: dayKey, n: 0 }; n.claims.n++;
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
    puzzleReward(nid, tid, dayKey, day) {
      const n = this.nation(nid); if (!n) return { kind: 'none' };
      const own = this.s.owner[tid];
      if (!own && this.touches(nid, tid)) { const r = this.claim(nid, tid, dayKey, true, day); return r.ok ? { kind: 'claim' } : { kind: 'none', err: r.err }; }
      if (own === nid) {
        const army = NUM.puzzleArmy;
        n.army += army; return { kind: 'army', army };
      }
      return { kind: 'none' };
    }

    // ---------------------------------------------------------- 전투 (블로토)
    tonight(nid) { return this.s.battles.filter((b) => b.att === nid || b.def === nid); }
    // slot: 전투 시간 번호 (서버가 정함: 일차·점심/밤). 같은 전투 시간 안에서만 횟수를 셈
    declaresLeft(nid, slot) { return NUM.maxDeclare - this.s.battles.filter((b) => b.att === nid && (slot == null || b.slot === slot)).length; }

    // ---- 동맹: 왕끼리 합의, 최대 3나라, 동맹끼리 선전포고 불가, 동맹 전투에 한 번 참전 (병력 정해 직접 배치, 못 뺌)
    allyGroup(nid) { const n = this.nation(nid); const a = n && n.ally && (this.s.alliances || {})[n.ally]; return a ? a.members.filter((x) => { const m = this.nation(x); return m && !m.dead; }) : [nid]; }
    allyOf(nid) { return this.allyGroup(nid).filter((x) => x !== nid); }
    fighting(groupA, groupB) { return this.s.battles.some((b) => (groupA.includes(b.att) && groupB.includes(b.def)) || (groupB.includes(b.att) && groupA.includes(b.def))); }
    allyPropose(from, to) {
      const A = this.nation(from), B = this.nation(to);
      if (!A || !B || A.dead || B.dead || from === to) return { ok: false, err: '잘못된 요청이에요' };
      if (this.allyOf(from).includes(to)) return { ok: false, err: '이미 동맹이에요' };
      const ga = this.allyGroup(from), gb = this.allyGroup(to);
      if (ga.length + gb.length > NUM.maxAlly) return { ok: false, err: `동맹은 최대 ${NUM.maxAlly}나라까지예요` };
      if (this.fighting(ga, gb)) return { ok: false, err: '서로 싸우는 중인 나라와는 동맹을 맺을 수 없어요' };
      this.s.allyReq = (this.s.allyReq || []).filter((r) => !(r.from === from && r.to === to));
      this.s.allyReq.push({ from, to, at: Date.now() });
      return { ok: true };
    }
    allyCheck(a, b) { // 동맹을 맺을 수 있는지
      const A = this.nation(a), B = this.nation(b);
      if (!A || !B || A.dead || B.dead || a === b) return '잘못된 요청이에요';
      if (this.allyOf(a).includes(b)) return '이미 동맹이에요';
      const ga = this.allyGroup(a), gb = this.allyGroup(b);
      if (ga.length + gb.length > NUM.maxAlly) return `동맹은 최대 ${NUM.maxAlly}나라까지예요`;
      if (this.fighting(ga, gb)) return '서로 싸우는 중인 나라와는 동맹을 맺을 수 없어요';
      return null;
    }
    allyForm(a, b) { // 계약서에 두 왕이 서명하면 동맹 결성
      const err = this.allyCheck(a, b); if (err) return { ok: false, err };
      this.s.allyReq = (this.s.allyReq || []).concat([{ from: a, to: b, at: Date.now() }]);
      return this.allyAnswer(b, a, true);
    }
    allyAnswer(nid, from, yes) {
      const req = (this.s.allyReq || []).find((r) => r.from === from && r.to === nid);
      if (!req) return { ok: false, err: '그 동맹 제안이 없어요' };
      this.s.allyReq = this.s.allyReq.filter((r) => r !== req);
      if (!yes) return { ok: true, declined: true };
      const ga = this.allyGroup(from), gb = this.allyGroup(nid);
      if (ga.length + gb.length > NUM.maxAlly) return { ok: false, err: `동맹은 최대 ${NUM.maxAlly}나라까지예요` };
      if (this.fighting(ga, gb)) return { ok: false, err: '서로 싸우는 중이라 동맹을 맺을 수 없어요' };
      this.s.alliances = this.s.alliances || {};
      const A = this.nation(from), B = this.nation(nid);
      const id = A.ally && this.s.alliances[A.ally] ? A.ally : B.ally && this.s.alliances[B.ally] ? B.ally : 'al' + (this.s.nextAlly = (this.s.nextAlly || 0) + 1);
      for (const old of [A.ally, B.ally]) if (old && old !== id) delete this.s.alliances[old];
      const members = [...new Set([...ga, ...gb])];
      this.s.alliances[id] = { id, members, since: Date.now() };
      for (const m of members) this.nation(m).ally = id;
      this.s.allyReq = this.s.allyReq.filter((r) => !(members.includes(r.from) && members.includes(r.to)));
      return { ok: true, members };
    }
    allyLeave(nid) {
      const n = this.nation(nid), a = n && n.ally && (this.s.alliances || {})[n.ally];
      if (!a) return { ok: false, err: '동맹이 없어요' };
      a.members = a.members.filter((x) => x !== nid); delete n.ally;
      if (a.members.length <= 1) { for (const m of a.members) { const x = this.nation(m); if (x) delete x.ally; } delete this.s.alliances[a.id]; }
      return { ok: true, left: a.members };
    }
    allyJoin(nid, battleId, troops) { // 동맹 전투 참전 (한 번만, 못 뺌) — 동맹국 편으로
      const n = this.nation(nid), b = this.s.battles.find((x) => x.id === battleId);
      if (!n || !b) return { ok: false, err: '그 전투가 없어요' };
      if (b.att === nid || b.def === nid) return { ok: false, err: '우리 나라 전투예요' };
      const allies = this.allyOf(nid), side = allies.includes(b.att) ? 'att' : allies.includes(b.def) ? 'def' : null;
      if (!side) return { ok: false, err: '동맹국의 전투에만 참전할 수 있어요' };
      if ((b.help || []).some((h) => h.nid === nid)) return { ok: false, err: '이 전투엔 이미 참전했어요 (한 번만)' };
      troops = clampTroops(troops, b.F);
      if (!troops || sum(troops) <= 0) return { ok: false, err: '보낼 병력을 정해 주세요' };
      if (sum(troops) > n.army) return { ok: false, err: `병력이 모자라요 (보유 ${n.army})` };
      n.army -= sum(troops); b.help = b.help || []; b.help.push({ nid, side, t: troops });
      return { ok: true, side, battle: b };
    }
    declare(nid, tid, troops, slot) {
      const n = this.nation(nid), t = this.t[tid];
      if (!n || n.dead || !t) return { ok: false, err: '잘못된 요청이에요' };
      const def = this.s.owner[tid];
      if (!def) return { ok: false, err: '주인 없는 땅은 전투가 아니라 점령으로 가져와요' };
      if (def === nid) return { ok: false, err: '우리 땅이에요' };
      if (this.s.gone[tid]) return { ok: false, err: '균열에 삼켜진 땅이에요' };
      if (!this.touches(nid, tid)) return { ok: false, err: '우리 땅과 경계선이 붙은 적 영토만 공격할 수 있어요' };
      if (this.allyOf(nid).includes(def)) return { ok: false, err: '동맹국은 공격할 수 없어요' };
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
    // 균열: 백신 쓰기 → 우리 영역 하나의 침식을 0%로
    vaccinate(nid, tid) {
      const n = this.nation(nid);
      if (!n) return { ok: false, err: '나라가 없어요' };
      if (this.s.owner[tid] !== nid) return { ok: false, err: '우리 땅에만 쓸 수 있어요' };
      if (!(this.s.erosion[tid] > 0)) return { ok: false, err: '침식되지 않은 땅이에요' };
      if (!(n.vaccine > 0)) return { ok: false, err: '백신이 없어요 (하늘 거래소)' };
      n.vaccine--; this.s.erosion[tid] = 0; return { ok: true };
    }
    // 나라 전체 침식률 (영역 넓이로 가중 평균, 수도 포함 → 수도만 있는 나라는 0%)
    nationErosion(nid) {
      let a = 0, e = 0;
      const cap = (this.nation(nid) || {}).capital;
      for (const t of this.territoriesOf(nid)) { const ar = this.t[t].area || 1; a += ar; e += ar * (t === cap ? 0 : (this.s.erosion[t] || 0)); } // 수도는 침식 안 됨 (0%로 셈)
      return a ? Math.round(e / a * 10) / 10 : 0;
    }
    // 매일 아침 균열: 수도가 아닌 모든 영역 침식 +step%. 나라 전체 침식이 50% 이상이면 멸망 (영역은 주인 없는 땅)
    erode(step = NUM.erodeStep) {
      const caps = new Set(this.alive().map((n) => n.capital));
      for (const t of Object.values(this.t)) { if (this.s.gone[t.id] || caps.has(t.id)) continue; this.s.erosion[t.id] = Math.min(100, (this.s.erosion[t.id] || 0) + step); }
      const fallen = [];
      for (const n of this.alive()) {
        const pct = this.nationErosion(n.id);
        if (pct >= NUM.erodeFall) { const members = n.members.slice(); for (const t of this.territoriesOf(n.id)) delete this.s.owner[t]; this.destroy(n); fallen.push({ id: n.id, name: n.name, pct, members }); }
      }
      return { fallen };
    }
    refund(b) { const A = this.nation(b.att), D = this.nation(b.def); if (A && !A.dead) A.army += sum(b.a) + sum(b.ar); if (D && !D.dead && b.d) D.army += sum(b.d); for (const h of b.help || []) { const H = this.nation(h.nid); if (H && !H.dead) H.army += sum(h.t); } }
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
        const F = b.F, ar = b.ar || b.a.map(() => 0), aMain = b.a.map((v, i) => v + ar[i]);
        let d0 = b.d, auto = false;
        if (!d0) { d0 = this.autoDefense(D, b, pending); auto = true; }
        const help = (b.help || []).filter((h) => { const H = this.nation(h.nid); return H && !H.dead; });
        const hA = help.filter((h) => h.side === 'att'), hD = help.filter((h) => h.side === 'def');
        const aT = aMain.map((v, i) => v + hA.reduce((x, h) => x + (h.t[i] || 0), 0)), d = d0.map((v, i) => v + hD.reduce((x, h) => x + (h.t[i] || 0), 0)); // 동맹 병력 합침
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
        // 살아남은 병력: 낸 병력 비율로 나눔. 동맹 참전 병력은 살아남으면 참전한 나라로 돌아감
        const helpers = help.map((h) => { const H = this.nation(h.nid), tot = sum(h.side === 'att' ? aT : d) || 1, sent = sum(h.t), surv = Math.floor((h.side === 'att' ? survA : survD) * sent / tot); return { nid: h.nid, name: H.name, side: h.side, sent, surv, share: sent / tot }; });
        for (const h of helpers) this.nation(h.nid).army += h.surv;
        A.army += survA - helpers.filter((h) => h.side === 'att').reduce((x, h) => x + h.surv, 0); D.army += survD - helpers.filter((h) => h.side === 'def').reduce((x, h) => x + h.surv, 0);
        const rep = {
          id: b.id, night: b.night, slot: b.slot, target: b.target, att: b.att, def: b.def, attName: A.name, defName: D.name, F,
          a: aT, d, autoDef: auto, effA: aT, effD, fronts, attWon, defWon, winner: attWins ? 'att' : 'def', lossA, lossD,
          capital: b.target === D.capital, lost: [], loot: null, prisoners: 0, destroyed: false, newCapital: null, members: null, helpers,
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
          // 동맹과 함께 이기면 낸 병력 비율로 나눔
          const winners = [{ N: A, share: 1 - helpers.filter((h) => h.side === 'att').reduce((x, h) => x + h.share, 0) }, ...helpers.filter((h) => h.side === 'att').map((h) => ({ N: this.nation(h.nid), share: h.share }))];
          const give = (key, g, items) => { let left = g; winners.forEach((w, wi) => { const part = wi === winners.length - 1 ? left : Math.floor(g * w.share); left -= part; if (items) { w.N.items = normItems(w.N.items); w.N.items[key] = (w.N.items[key] || 0) + part; } else w.N[key] = (w.N[key] || 0) + part; }); };
          for (const key of ['coin', 'wood', 'vaccine']) { const v = take(D, key); const g = Math.floor(v * NUM.lootPct); give(key, g, false); loot[key] = g; }
          D.items = normItems(D.items); A.items = normItems(A.items);
          for (const key of Object.keys(D.items)) { const v = take(D.items, key); const g = Math.floor(v * NUM.lootPct); give(key, g, true); loot[key] = g; }
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
        // 병영 열기: 영역전에서 처음 이긴 나라 (공격·방어·동맹 참전 모두)
        const winSide = attWins ? 'att' : 'def', wins = [attWins ? A : D, ...helpers.filter((h) => h.side === winSide).map((h) => this.nation(h.nid))];
        rep.unlocked = wins.filter((x) => x && !x.dead && !x.raceOpen).map((x) => { x.raceOpen = true; return x.id; });
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
    setRace(nid, race) { const n = this.nation(nid); if (!n || !RACES.includes(race)) return { ok: false, err: '그런 종족이 없어요' }; if (!n.raceOpen) return { ok: false, err: '병영은 영역전에서 처음 이기면 열려요' }; n.race = race; return { ok: true }; }
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
      for (const n of Object.values(this.s.nations)) out[n.id] = { id: n.id, name: n.name, team: n.team, color: n.color, capital: n.capital, dead: n.dead, kingName: n.kingName, provinces: n.provinces, members: n.members.length, store: n.storePos || null, portal: n.portalPos || null, ally: n.ally || null, storeLv: storeLevel(n), race: n.raceOpen ? (n.race || RACES[(n.team | 0) % 3]) : 'human', raceOpen: !!n.raceOpen };
      return out;
    }
    view(nid, key) {
      const n = this.nation(nid);
      if (!n) return null;
      return {
        me: {
          id: n.id, name: n.name, team: n.team, color: n.color, capital: n.capital, army: n.army, coin: n.coin, actions: n.actions,
          vaxed: this.s.riftNext ? Object.keys(this.s.vax).filter((t) => this.s.vax[t] === this.s.riftNext.wave && this.s.owner[t] === n.id).map(Number) : [],
          erosion: this.nationErosion(n.id),
          defaultDef: n.defaultDef || null, intelAny: n.intelAny || 0, intel: n.intel || {},
          wood: n.wood || 0, vaccine: n.vaccine || 0, items: normItems(n.items), vaccinePrice: NUM.vaccineBase + NUM.vaccineStep * (n.vaccBought || 0),
          raceOpen: !!n.raceOpen, isKing: n.king === key, kingName: n.kingName, members: n.members.length, territories: this.territoriesOf(n.id).length,
          declaresLeft: this.declaresLeft(n.id, this.s.curSlot), provinces: n.provinces, code: n.code,
          // 접속 열쇠(토큰)는 절대 내보내지 않는다: 순번만
          memberList: n.members.map((k, i) => ({ idx: i, name: (n.memberNames || {})[k] || '?', king: k === n.king, me: k === key })),
        },
        night: this.s.night,
        outgoing: this.s.battles.filter((b) => b.att === n.id).map((b) => ({ id: b.id, target: b.target, def: b.def, a: b.a, ar: b.ar || b.a.map(() => 0), F: b.F, cap: Math.floor(NUM.reinforcePct * sum(b.a)), f: b.f || null, slot: b.slot })),
        // 공격 병력은 숨김 (첩보로 알아낸 전선만 보임)
        incoming: this.s.battles.filter((b) => b.def === n.id).map((b) => ({ id: b.id, target: b.target, att: b.att, d: b.d, F: b.F, f: b.f || null, slot: b.slot, rev: (b.rev || []).map((f) => ({ f, n: b.a[f] + ((b.ar || [])[f] || 0) })), intel: ((n.intel || {})[b.att] || 0) + (n.intelAny || 0) })),
        reports: this.s.reports.filter((r) => r.att === n.id || r.def === n.id || (r.helpers || []).some((h) => h.nid === n.id)).slice(-12),
        allies: this.allyOf(n.id).map((x) => ({ id: x, name: this.nation(x).name, color: this.nation(x).color })),
        allyIn: (this.s.allyReq || []).filter((r) => r.to === n.id && this.nation(r.from) && !this.nation(r.from).dead).map((r) => ({ from: r.from, name: this.nation(r.from).name, color: this.nation(r.from).color })),
        allyOut: (this.s.allyReq || []).filter((r) => r.from === n.id).map((r) => r.to),
        allyBattles: this.s.battles.filter((b) => b.att !== n.id && b.def !== n.id && (this.allyOf(n.id).includes(b.att) || this.allyOf(n.id).includes(b.def))).map((b) => { const mine = (b.help || []).find((h) => h.nid === n.id); return { id: b.id, target: b.target, att: b.att, def: b.def, F: b.F, slot: b.slot, side: this.allyOf(n.id).includes(b.att) ? 'att' : 'def', joined: mine ? mine.t : null, helpers: (b.help || []).map((h) => ({ nid: h.nid, side: h.side })) }; }),
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
  // 지도 전체 이름 정하기: 같은 이름이 나오면 뒤에 동·서·남·북·2… 를 붙여 모두 다르게 (번호 순서라 화면·서버 같음)
  function nameAll(territories) {
    const used = new Set(), out = {};
    for (const t of territories.slice().sort((x, y) => x.id - y.id)) {
      const base = terrName(t); let nm = base;
      for (let k = 0; used.has(nm); k++) nm = base + ([' 동', ' 서', ' 남', ' 북'][k] || ' ' + (k - 2));
      used.add(nm); out[t.id] = nm;
    }
    return out;
  }
  // 하늘 포털 자리: 수도 후보 영토는 지도에 정해진 자리, 그 밖의 영토(천도한 수도 등)는 제단 위쪽의 걸을 수 있는 칸
  const PORTAL_OFFS = [[4, 1], [-4, 1], [4, 3], [-4, 3], [5, 0], [-5, 0], [3, 4], [-3, 4], [0, 5], [0, -5]]; // 비석이 커져서 포털은 옆으로
  function portalSpot(t, tileAt) {
    if (t.portal) return t.portal;
    for (const [dx, dy] of PORTAL_OFFS) { const x = t.altar[0] + dx, y = t.altar[1] + dy, k = tileAt(x, y); if ((k === T.GRASS || k === T.FOREST || k === T.SAND) && !treeKind(k, x, y) && (tileAt(x, y + 1) === T.GRASS || tileAt(x, y + 1) === T.SAND || tileAt(x, y + 1) === T.FOREST)) return [x, y]; }
    return [t.altar[0], t.altar[1] - 2];
  }
  // ------------------------------------------------------------ 제단 퍼즐: 스도쿠 · 슬라이딩
  const shuffle = (a, rnd = Math.random) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // 스도쿠 9×9: 꽉 찬 판을 만들고 givens 칸만 남김. 답은 '규칙에 맞고 처음 칸과 같으면' 정답 (답이 여럿이어도 됨)
  function genSudoku(givens = NUM.sudokuGivens, rnd = Math.random) {
    const g = new Array(81).fill(0);
    const ok = (i, v) => { const r = Math.floor(i / 9), c = i % 9, br = r - r % 3, bc = c - c % 3; for (let k = 0; k < 9; k++) { if (g[r * 9 + k] === v || g[k * 9 + c] === v || g[(br + Math.floor(k / 3)) * 9 + bc + k % 3] === v) return false; } return true; };
    const fill = (i) => { if (i === 81) return true; for (const v of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rnd)) if (ok(i, v)) { g[i] = v; if (fill(i + 1)) return true; g[i] = 0; } return false; };
    fill(0);
    const keep = new Set(shuffle([...Array(81).keys()], rnd).slice(0, givens));
    return g.map((v, i) => (keep.has(i) ? v : 0));
  }
  function checkSudoku(puzzle, ans) {
    if (!Array.isArray(ans) || ans.length !== 81) return false;
    const a = ans.map((v) => v | 0);
    if (a.some((v, i) => v < 1 || v > 9 || (puzzle[i] && puzzle[i] !== v))) return false;
    for (let k = 0; k < 9; k++) {
      const row = new Set(), col = new Set(), box = new Set();
      for (let j = 0; j < 9; j++) { row.add(a[k * 9 + j]); col.add(a[j * 9 + k]); box.add(a[(Math.floor(k / 3) * 3 + Math.floor(j / 3)) * 9 + (k % 3) * 3 + j % 3]); }
      if (row.size !== 9 || col.size !== 9 || box.size !== 9) return false;
    }
    return true;
  }
  // 슬라이딩 퍼즐 3×3 (0 = 빈칸): 맞춘 상태에서 무작위로 움직여 섞음 → 항상 풀 수 있음
  const SLIDE_DONE = [1, 2, 3, 4, 5, 6, 7, 8, 0];
  const slideNext = (b, tile) => { const z = b.indexOf(0), i = b.indexOf(tile); if (i < 0 || tile === 0) return null; const zr = Math.floor(z / 3), zc = z % 3, r = Math.floor(i / 3), c = i % 3; if (Math.abs(zr - r) + Math.abs(zc - c) !== 1) return null; const nb = b.slice(); nb[z] = tile; nb[i] = 0; return nb; };
  function genSlide(steps = 60, rnd = Math.random) {
    let b = SLIDE_DONE.slice(), last = -1;
    for (let k = 0; k < steps; k++) { const z = b.indexOf(0), zr = Math.floor(z / 3), zc = z % 3; const opts = [[zr - 1, zc], [zr + 1, zc], [zr, zc - 1], [zr, zc + 1]].filter(([r, c]) => r >= 0 && r < 3 && c >= 0 && c < 3).map(([r, c]) => b[r * 3 + c]).filter((t) => t !== last); const t = opts[Math.floor(rnd() * opts.length)]; b = slideNext(b, t); last = t; }
    if (b.join() === SLIDE_DONE.join()) return genSlide(steps + 1, rnd);
    return b;
  }
  // moves: 움직인 숫자 칸들 (빈칸 옆 칸만 움직일 수 있음)
  function checkSlide(start, moves) {
    if (!Array.isArray(moves) || moves.length > 2000) return false;
    let b = start.slice();
    for (const t of moves) { const nb = slideNext(b, t | 0); if (!nb) return false; b = nb; }
    return b.join() === SLIDE_DONE.join();
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
  const notorietyTier = (v) => { const T2 = NUM.notorietyTiers; let k = 0; for (let i = 0; i < T2.length; i++) if ((v || 0) >= T2[i].min) k = i; return k; };
  // 이름 옆 표시: 마이너스 = 체포왕 👮, 1~199 💀, 200~499 💀💀, 500 이상 💀💀💀
  const notorietyBadge = (v) => (v < 0 ? '👮' : v <= 0 ? '' : v < 200 ? '💀' : v < 500 ? '💀💀' : '💀💀💀');
  // 날씨: 일차·시간대마다 정해짐 (약 30% 비). 비 오면 낚시 입질이 빠르고 귀한 물고기가 잘 잡힘
  function weatherOf(ms = Date.now()) { const blk = Math.floor(ms / 1800e3); return hash(blk, 991, 17) < NUM.rainChance ? 'rain' : 'clear'; } // 가끔 30분씩 비 (30분 칸마다 정함)
  // 머리 장식 가격 (개인 지갑으로 삼)
  // 직업 (오프라인 점심 전직 → 관리자가 정해 줌). w = 실시간 전투 무기
  const JOBS = {
    knight: { name: '기사', icon: '⚔', w: 'sword', perk: '적 수정을 5번만 때려도 첩보 (보통 10번)' },
    rogue: { name: '도적', icon: '🗡', w: 'dagger', perk: '저장소를 털면 2배' },
    mage: { name: '마법사', icon: '🔥', w: 'magic', perk: '벽·기둥을 2배 빨리 부숨' },
    mechanic: { name: '정비공', icon: '🔧', w: 'axe', perk: '우리 벽·기둥 고치기 (터렛은 나중에)' },
    farmer: { name: '농사꾼', icon: '🌾', w: 'spear', perk: '심은 작물이 2배 빨리 자람' },
    fisher: { name: '어부', icon: '🎣', w: 'bow', perk: '입질 2배 빠름 · 하루 2배 낚음' },
    builder: { name: '건축업자', icon: '🧱', w: 'axe', perk: '놓는 벽·기둥 내구도 2배' },
  };
  // 실시간 전투 무기 (월드 픽셀, 캐릭터 키 48px). 꾹 눌렀다 떼면 차징(×1.8, 범위 ×1.3, 재사용 ×1.5)
  const WEAPONS = {
    fist: { name: '맨주먹', reach: 30, wide: 30, dmg: [4, 6], cd: 500 }, // price: 3일차부터 대장장이에게 내 코인으로 직접 사야 함 (안 사면 맨주먹)
    sword: { name: '검', price: 400, reach: 46, wide: 44, dmg: [9, 12], cd: 450 },
    dagger: { name: '단검', price: 300, reach: 34, wide: 36, dmg: [6, 8], cd: 300 },
    axe: { name: '망치', price: 450, reach: 52, wide: 58, dmg: [15, 19], cd: 1000 },
    spear: { name: '쇠스랑', price: 350, reach: 82, wide: 20, dmg: [10, 13], cd: 600 },
    bow: { name: '작살', price: 400, proj: 1, range: 300, dmg: [7, 9], cd: 700 },
    magic: { name: '불마법', price: 500, proj: 1, range: 260, dmg: [12, 15], cd: 1200, boom: 40 },
  };
  // 스토리: 멸망 조각 8개 (선포일부터 하루 하나씩 땅 어딘가에 떨어짐). 다 모으면 진실 → 13일차 천사/악마 선택
  const STORY = {
    frags: [
      '……처음 이 세계를 만들 때, 여신은 혼자가 아니었다.',
      '여신 곁에는 늘 그림자처럼 붙어 다니는 누군가가 있었다. 여신은 그를 "친구"라고 불렀다.',
      '친구는 사람들이 웃는 걸 싫어했다. 나라가 하나 세워질 때마다, 그는 말없이 땅 끝을 바라보았다.',
      '"이 세계는 너무 밝아." 그가 말했다. 여신은 그냥 웃어넘겼다.',
      '어느 밤, 하늘에 첫 번째 금이 갔다. 그 아래에서 검은 날개가 펄럭였다.',
      '균열은 저절로 생기지 않는다. 누군가 손톱으로 하늘을 긁고 있었다.',
      '여신은 그날의 기억을 잃었다. 누군가 그 기억을 산산조각 내어 땅에 흩뿌렸으니까.',
      '마지막 조각에 비친 얼굴. 뿔 달린 그림자가 웃고 있었다. "열흘이면 충분해."',
    ],
    sideDay: 13,
  };
  const HAT_PRICE = { crown: 500, halo: 400, wizard: 300, horns: 300, viking: 300, tophat: 250, chef: 200, cat: 200, party: 150, cap: 120, beanie: 120, bow: 100, flower: 80, sprout: 80 };
  return { STORY, WEAPONS, JOBS, HAT_PRICE, TOOLS, weatherOf, FISH, COLORS, CROPS, BUILD, BUILD_BY, THEMES, normItems, tileItem, World, NUM, RACES, FRONTS, notorietyTier, notorietyBadge, frontName, terrName, nameAll, genSudoku, checkSudoku, genSlide, checkSlide, slideNext, minPerFront, okMin, portalSpot, teamColor, emptyState, sameAnswer, hash, treeKind, storageSpot, mineSpot, T };
});
