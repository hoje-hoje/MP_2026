/* 위에서 내려다보는 화면용 마법 연출 (코드로 그림) · 게임과 관리자 실험실이 같이 씀
 * 마법은 쓴 자리에서 나가고 따라다니지 않아요. 모양은 rules.js 의 MAGIC_COMBAT 를 따름.
 * const fx = MPMagicFX.create({ scale, targets: () => [{x, y, r, ref}], onHit(t, info), onSelf(info), onBlink(x, y), canGo(x, y), onMark(key, x, y) })
 * fx.cast(key, { x, y, dir: [dx, dy] })  ·  fx.update(dt)  ·  fx.drawGround(g)  ·  fx.drawTop(g)  ·  fx.shake()  ·  fx.lights()
 */
(function (root) {
  'use strict';
  const R = root.MPRules;
  const TAU = Math.PI * 2, rnd = (a, b) => a + Math.random() * (b - a);
  function create(opt) {
    opt = opt || {};
    const S = opt.scale || 1, P = Math.max(2, Math.round(2 * S)); // 도트 한 칸 크기
    const E = [], PT = [], LT = [];
    let shakeT = 0, shakeA = 0, tint = null;
    const pal = (key) => R.MAGIC_PAL[R.MAGIC[key] ? R.MAGIC[key].el : 'root'] || R.MAGIC_PAL.root;
    const targets = () => (opt.targets ? opt.targets() : []);
    const q = (v) => Math.round(v / P) * P;
    const shake = (a, t) => { shakeA = Math.max(shakeA * (shakeT > 0 ? 1 : 0), a * S); shakeT = Math.max(shakeT, t); };
    const mark = (key, x, y) => { if (opt.onMark) opt.onMark(key, x, y); };
    function part(o) { PT.push(Object.assign({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, life: 0.5, t: 0, c: '#fff', s: P, drag: 0, fade: 1 }, o)); }
    function burst(x, y, z, n, c, sp, o) { for (let i = 0; i < n; i++) { const a = rnd(0, TAU), v = rnd(sp * 0.3, sp) * S; part(Object.assign({ x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, vz: rnd(20, 90) * S, g: 260 * S, life: rnd(0.3, 0.7), c: c[(Math.random() * c.length) | 0], s: P * (Math.random() < 0.3 ? 2 : 1) }, o || {})); } }
    // 맞히기: 발밑 기준 타원 거리
    function inR(t, x, y, r) { const dx = t.x - x, dy = (t.y - y) * 1.35, rr = r + (t.r || 9 * S); return dx * dx + dy * dy <= rr * rr; }
    function hit(t, e, extra) { if (!opt.onHit) return; const sp = e.spec; opt.onHit(t, Object.assign({ key: e.key, dmg: sp.dmg || 0, st: sp.st || null, knock: sp.knock || 0, fx: e.x, fy: e.y }, extra || {})); }
    function hitArea(e, x, y, r, once, extra) { for (const t of targets()) { if (once && e.hitSet.has(t.ref || t)) continue; if (!inR(t, x, y, r)) continue; if (once) e.hitSet.add(t.ref || t); hit(t, e, Object.assign({ fx: x, fy: y }, extra || {})); } }
    function impact(e, x, y, r, big) { // 착탄: 번쩍 + 땅 고리 + 파편 + 흔들림
      const c = e.pal; E.push({ type: 'flash', x, y, r: r * 1.1, t: 0, dur: 0.18, pal: c }); E.push({ type: 'ring', x, y, r: r * 1.4, t: 0, dur: 0.35, pal: c });
      burst(x, y, 6 * S, big ? 26 : 12, [c[0], c[1], c[2], c[3]], big ? 150 : 90); LT.push({ x, y, r: r * 4, c: c[2], t: 0, dur: 0.4, a: 1 });
      if (e.spec.shake) shake(e.spec.shake, 0.25); else if (big) shake(2, 0.15); mark(e.key, x, y);
    }
    // ---------------------------------------------------------------- 마법 쓰기
    function cast(key, c) {
      const spec = R.MAGIC_COMBAT[key]; if (!spec) return; const d = c.dir || [0, 1], L = Math.hypot(d[0], d[1]) || 1, dx = d[0] / L, dy = d[1] / L;
      const e = { key, spec, pal: pal(key), x: c.x, y: c.y, dx, dy, t: 0, hitSet: new Set(), type: spec.shape, tick: 0 };
      const sp = spec, s = S;
      if (sp.shape === 'orb') Object.assign(e, { ox: c.x + dx * 12 * s, oy: c.y + dy * 6 * s, d: 0, range: sp.range * s, z: sp.roll ? 0 : 14 * s });
      if (sp.shape === 'orb') { e.x = e.ox; e.y = e.oy; }
      if (sp.shape === 'zone') { e.x = c.x + dx * sp.at * s; e.y = c.y + dy * sp.at * s * 0.8; e.strikeT = 0; e.struck = 0; }
      if (sp.shape === 'chain') chainCast(e);
      if (sp.shape === 'self') selfCast(e);
      if (sp.shape === 'blink') { blinkCast(e); return; }
      if (sp.shape === 'line') e.n = 0;
      if (sp.shape === 'wave') e.d = 0;
      E.push(e);
      // 쓰는 순간: 발밑에 작은 마법진 + 반짝
      E.push({ type: 'cast', x: c.x, y: c.y, t: 0, dur: 0.35, pal: e.pal });
    }
    function chainCast(e) {
      const sp = e.spec, s = S, pts = [], used = new Set(); let cx = e.x, cy = e.y - 14 * s;
      const cand = targets().filter((t) => { const vx = t.x - e.x, vy = t.y - e.y, along = vx * e.dx + vy * e.dy; return along > 0 && Math.hypot(vx, vy) <= sp.range * s; }).sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y));
      let cur = cand[0];
      for (let j = 0; cur && j <= (sp.jumps || 0); j++) { used.add(cur); pts.push([cur.x, cur.y - 12 * s, cur]); const nx = targets().filter((t) => !used.has(t) && Math.hypot(t.x - cur.x, t.y - cur.y) < 90 * s).sort((a, b) => Math.hypot(a.x - cur.x, a.y - cur.y) - Math.hypot(b.x - cur.x, b.y - cur.y)); cur = nx[0]; }
      if (!pts.length) pts.push([e.x + e.dx * sp.range * s * 0.8, e.y + e.dy * sp.range * s * 0.6 - 4 * s, null]);
      e.pts = [[cx, cy]].concat(pts.map((p) => [p[0], p[1]])); e.dur = sp.look === 'drain' ? 0.6 : 0.35;
      pts.forEach((p, i) => { setTimeout(() => { E.push({ type: 'flash', x: p[0], y: p[1] + 12 * s, r: 14 * s, t: 0, dur: 0.15, pal: e.pal }); burst(p[0], p[1] + 12 * s, 10 * s, 8, e.pal.slice(0, 3), 80); if (p[2]) { hit(p[2], e, { fx: e.x, fy: e.y }); if (sp.st && sp.st.drain && opt.onSelf) opt.onSelf({ key: e.key, heal: sp.dmg }); } }, i * 60); });
      shake(2, 0.12);
    }
    function selfCast(e) {
      const sp = e.spec; e.dur = sp.aura === 'shield' ? 0.9 : sp.aura === 'pillar' ? 1.4 : 0.9;
      if (opt.onSelf) opt.onSelf({ key: e.key, heal: sp.heal || 0, shield: sp.shield || 0, sec: sp.sec || 0, haste: sp.haste || 0 });
      if (sp.dmg) hitArea(e, e.x, e.y, sp.r * S, true);
      if (sp.aura === 'burst') shake(1.5, 0.15); if (sp.aura === 'pillar') shake(3, 0.4);
    }
    function blinkCast(e) {
      const s = S, dist = e.spec.dist * s; let bx = e.x, by = e.y;
      for (let k = 1; k <= 16; k++) { const nx = e.x + e.dx * dist * k / 16, ny = e.y + e.dy * dist * k / 16 * 0.8; if (opt.canGo && !opt.canGo(nx, ny)) break; bx = nx; by = ny; }
      E.push({ type: 'puff', x: e.x, y: e.y, t: 0, dur: 0.5, pal: e.pal }); E.push({ type: 'puff', x: bx, y: by, t: 0, dur: 0.5, pal: e.pal }); E.push({ type: 'streak', x: e.x, y: e.y, x2: bx, y2: by, t: 0, dur: 0.3, pal: e.pal });
      burst(e.x, e.y, 10 * s, 12, e.pal.slice(0, 3), 70); burst(bx, by, 10 * s, 12, e.pal.slice(0, 3), 70); if (opt.onBlink) opt.onBlink(bx, by);
    }
    // ---------------------------------------------------------------- 매 프레임
    function update(dt) {
      if (shakeT > 0) shakeT -= dt;
      for (let i = E.length - 1; i >= 0; i--) { const e = E[i]; e.t += dt; if (step(e, dt) === false || (e.dur != null && e.t >= e.dur)) E.splice(i, 1); }
      for (let i = PT.length - 1; i >= 0; i--) { const p = PT[i]; p.t += dt; if (p.t >= p.life) { PT.splice(i, 1); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= p.g * dt; if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.6; p.vy *= 0.6; } if (p.drag) { const k = Math.pow(p.drag, dt); p.vx *= k; p.vy *= k; } }
      for (let i = LT.length - 1; i >= 0; i--) { LT[i].t += dt; if (LT[i].t >= LT[i].dur) LT.splice(i, 1); }
    }
    function step(e, dt) {
      const sp = e.spec, s = S;
      switch (e.type) {
        case 'orb': {
          const v = sp.speed * s * dt; e.x += e.dx * v; e.y += e.dy * v * 0.85; e.d += v; const u = e.d / e.range;
          if (sp.lob) e.z = 10 * s + Math.sin(Math.min(1, u) * Math.PI) * 46 * s;
          if (Math.random() < 0.9) part({ x: e.x + rnd(-2, 2) * s, y: e.y + rnd(-1, 1) * s, z: e.z + rnd(-2, 2) * s, vx: -e.dx * 20 * s, vy: -e.dy * 20 * s, life: sp.roll ? 0.5 : 0.3, c: e.pal[(1 + Math.random() * 3) | 0], s: P, fade: 1 });
          if (sp.look === 'tornado' || sp.look === 'boulder') { if (Math.random() < 0.5) part({ x: e.x + rnd(-sp.r, sp.r) * s, y: e.y, z: 0, vx: rnd(-30, 30) * s, vy: rnd(-10, 10) * s, vz: rnd(20, 60) * s, g: 200 * s, life: 0.4, c: '#8a7a60' }); }
          LT.length < 40 && (e.lt = true);
          if (sp.tick) { e.tick -= dt; if (e.tick <= 0) { e.tick = sp.tick; for (const t of targets()) if (inR(t, e.x, e.y, (sp.tickR || 30) * s)) { hit(t, e, { fx: e.x, fy: e.y, pull: sp.pull ? sp.pull : 0 }); if (sp.look === 'ballz') E.push({ type: 'zap', x: e.x, y: e.y - 14 * s, x2: t.x, y2: t.y - 12 * s, t: 0, dur: 0.12, pal: e.pal }); } } }
          else if (!sp.lob) { for (const t of targets()) { if (e.hitSet.has(t.ref || t) || !inR(t, e.x, e.y, sp.r * s)) continue; e.hitSet.add(t.ref || t); if (sp.boom) { impact(e, e.x, e.y, sp.boom * s, true); hitArea(e, e.x, e.y, sp.boom * s, false); return false; } hit(t, e, { fx: e.x - e.dx * 10, fy: e.y - e.dy * 10 }); impact(e, t.x, t.y - 4 * s, 12 * s, false); if (!sp.pierce) return false; } }
          if (u >= 1) { if (sp.boom) { impact(e, e.x, e.y, sp.boom * s, true); hitArea(e, e.x, e.y, sp.boom * s, false); } else { E.push({ type: 'puff', x: e.x, y: e.y, t: 0, dur: 0.35, pal: e.pal }); burst(e.x, e.y, e.z, 8, e.pal.slice(1, 4), 60); } return false; }
          return true;
        }
        case 'chain': return e.t < e.dur;
        case 'beam': {
          if (e.t >= sp.dur) return false;
          const hitNow = sp.tick ? ((e.tick -= dt) <= 0 && (e.tick = sp.tick, true)) : e.t > 0.05 && !e.done;
          for (let k = 0; k < (sp.look === 'ray' ? 2 : 4); k++) { const a = rnd(-1, 1), sp2 = rnd(200, 320) * s; part({ x: e.x + e.dx * 12 * s, y: e.y + e.dy * 8 * s - 2 * s, z: 12 * s, vx: (e.dx + -e.dy * a * sp.w / sp.len * 0.9) * sp2, vy: (e.dy + e.dx * a * sp.w / sp.len * 0.9) * sp2 * 0.85, life: sp.len * s / sp2, c: e.pal[(Math.random() * 3) | 0], s: P * (sp.look === 'gust' ? 1 : 1.5) }); }
          if (hitNow) { e.done = true; for (const t of targets()) { const vx = t.x - e.x, vy = (t.y - e.y) / 0.85, al = vx * e.dx + vy * e.dy, pe = Math.abs(-vx * e.dy + vy * e.dx); if (al < 0 || al > sp.len * s) continue; if (pe > (sp.w * s / 2) * (0.35 + 0.65 * al / (sp.len * s)) + 8 * s) continue; if (!sp.tick && e.hitSet.has(t.ref || t)) continue; e.hitSet.add(t.ref || t); hit(t, e, { fx: e.x, fy: e.y, dirx: e.dx, diry: e.dy }); burst(t.x, t.y, 12 * s, 5, e.pal.slice(0, 3), 70); } if (sp.shake) shake(sp.shake, 0.2); }
          return true;
        }
        case 'nova': {
          if (e.t >= sp.dur) return false; const rr = sp.r * s * Math.min(1, e.t / (sp.dur * 0.55));
          if (sp.tick) { e.tick -= dt; if (e.tick <= 0) { e.tick = sp.tick; hitArea(e, e.x, e.y, sp.r * s, false); } }
          else for (const t of targets()) { if (e.hitSet.has(t.ref || t) || !inR(t, e.x, e.y, rr)) continue; e.hitSet.add(t.ref || t); hit(t, e, {}); burst(t.x, t.y, 10 * s, 6, e.pal.slice(0, 3), 70); }
          if (sp.heal && !e.healed) { e.healed = true; if (opt.onSelf) opt.onSelf({ key: e.key, heal: sp.heal }); }
          if (sp.look === 'quake') { if (Math.floor(e.t * 8) !== Math.floor((e.t - dt) * 8)) { shake(sp.shake || 4, 0.15); burst(e.x + rnd(-rr, rr), e.y + rnd(-rr, rr) * 0.6, 0, 6, ['#8a7a60', '#6a5a44', '#b0a080'], 70); } }
          else if (e.t < 0.05 && sp.shake) shake(sp.shake, 0.3);
          if (sp.look === 'timestop' && e.t < 0.05) tint = { c: 'rgba(150,180,255,0.28)', t: 0, dur: 0.9 };
          return true;
        }
        case 'zone': {
          const life = sp.delay + (sp.linger || 0.5);
          if (e.t < sp.delay) { if (sp.look === 'meteor' && Math.random() < 0.8) part({ x: e.x - 70 * s * (1 - e.t / sp.delay) + rnd(-3, 3) * s, y: e.y, z: 160 * s * (1 - e.t / sp.delay), vx: 0, vy: 0, life: 0.3, c: e.pal[(1 + Math.random() * 3) | 0], s: P * 1.5 }); return true; }
          if (!e.landed) { e.landed = true;
            if (!sp.strikes && !sp.linger) { impact(e, e.x, e.y, sp.r * s, sp.look === 'meteor'); hitArea(e, e.x, e.y, sp.r * s, true); if (sp.look === 'strike') E.push({ type: 'skybolt', x: e.x, y: e.y, t: 0, dur: 0.18, pal: e.pal }); if (sp.look === 'roots') burst(e.x, e.y, 0, 14, ['#5a3a1e', '#2f7a34', '#4cbf4a'], 60); return true; }
            if (sp.linger && !sp.strikes) { E.push({ type: 'ring', x: e.x, y: e.y, r: sp.r * s, t: 0, dur: 0.4, pal: e.pal }); if (sp.shake) shake(sp.shake * 0.5, 0.2); } }
          if (sp.strikes) { e.strikeT -= dt; if (e.strikeT <= 0 && e.struck < sp.strikes) { e.strikeT = (sp.linger || 1) / sp.strikes; e.struck++; const a = rnd(0, TAU), r0 = Math.sqrt(Math.random()) * sp.r * s, x = e.x + Math.cos(a) * r0, y = e.y + Math.sin(a) * r0 * 0.6;
            E.push({ type: sp.look === 'stars' ? 'star' : 'skybolt', x, y, t: 0, dur: sp.look === 'stars' ? 0.3 : 0.16, pal: e.pal }); setTimeout(() => { impact({ key: e.key, spec: { shake: sp.shake }, pal: e.pal }, x, y, 16 * s, false); for (const t of targets()) if (inR(t, x, y, 20 * s)) hit(t, e, { fx: x, fy: y }); }, sp.look === 'stars' ? 260 : 20); } }
          else if (sp.linger) {
            e.tick -= dt; if (e.tick <= 0) { e.tick = sp.tick || 0.5; hitArea(e, e.x, e.y, sp.r * s, false, sp.pull ? { pull: sp.pull, knock: 0 } : {}); }
            if (sp.pull) for (let k = 0; k < 2; k++) { const a = rnd(0, TAU), r0 = sp.r * s * rnd(0.7, 1.2); part({ x: e.x + Math.cos(a) * r0, y: e.y + Math.sin(a) * r0 * 0.6, z: rnd(0, 10) * s, vx: -Math.cos(a) * r0 * 1.6, vy: -Math.sin(a) * r0 * 1.0, life: 0.55, c: e.pal[(Math.random() * 3) | 0], drag: 0.6 }); }
            else if (Math.random() < 0.8) { const a = rnd(0, TAU), r0 = Math.sqrt(Math.random()) * sp.r * s; part({ x: e.x + Math.cos(a) * r0, y: e.y + Math.sin(a) * r0 * 0.6, z: sp.look === 'blizzard' ? rnd(30, 60) * s : 2 * s, vx: sp.look === 'blizzard' ? 60 * s : 0, vy: 0, vz: sp.look === 'blizzard' ? -50 * s : rnd(8, 20) * s, life: rnd(0.5, 0.9), c: e.pal[(Math.random() * 4) | 0], s: P * (sp.look === 'cloud' || sp.look === 'swamp' ? 2 : 1) }); }
            if (sp.end && e.t >= life - dt && !e.ended) { e.ended = true; impact(e, e.x, e.y, sp.r * s * 0.7, true); hitArea(e, e.x, e.y, sp.r * s, false, { dmg: sp.end, pull: 0, knock: 180 }); }
          }
          return e.t < life;
        }
        case 'line': {
          const want = Math.min(Math.floor(sp.len / sp.step), Math.floor(e.t / 0.045) + 1);
          while (e.n < want) { e.n++; const x = e.x + e.dx * sp.step * e.n * s, y = e.y + e.dy * sp.step * e.n * s * 0.85; E.push({ type: 'spike', x, y, t: 0, dur: 0.7, pal: e.pal }); burst(x, y, 0, 3, e.pal.slice(1, 4), 50); hitArea(e, x, y, 12 * s, true); if (e.n === 1) shake(1.5, 0.2); }
          return e.t < sp.len / sp.step * 0.045 + 0.1;
        }
        case 'wave': {
          const v = sp.speed * s * dt; e.d += v; const cx = e.x + e.dx * e.d, cy = e.y + e.dy * e.d * 0.85;
          for (const t of targets()) { if (e.hitSet.has(t.ref || t)) continue; const vx = t.x - cx, vy = (t.y - cy) / 0.85, al = vx * e.dx + vy * e.dy, pe = Math.abs(-vx * e.dy + vy * e.dx); if (Math.abs(al) < 14 * s && pe < sp.w * s / 2) { e.hitSet.add(t.ref || t); hit(t, e, { fx: cx - e.dx * 30, fy: cy - e.dy * 30, dirx: e.dx, diry: e.dy }); shake(3, 0.15); } }
          for (let k = 0; k < 3; k++) { const o = rnd(-0.5, 0.5) * sp.w * s; part({ x: cx + -e.dy * o, y: cy + e.dx * o * 0.85, z: rnd(4, 16) * s, vx: e.dx * sp.speed * s * 0.6, vy: e.dy * sp.speed * s * 0.5, vz: rnd(20, 60) * s, g: 300 * s, life: 0.4, c: e.pal[(Math.random() * 3) | 0] }); }
          return e.d < sp.range * s;
        }
        case 'self': return e.t < e.dur;
        default: return true;
      }
    }
    // ---------------------------------------------------------------- 그리기
    function disc(g, x, y, r, c) { g.fillStyle = c; const rr = Math.max(P / 2, r); for (let yy = -rr; yy <= rr; yy += P) { const w = Math.sqrt(Math.max(0, rr * rr - yy * yy)); g.fillRect(q(x - w), q(y + yy), Math.max(P, q(w * 2)), P); } }
    function oval(g, x, y, rx, ry, c, th) { g.fillStyle = c; const n = Math.max(16, Math.round(rx / P * 3)); for (let i = 0; i < n; i++) { const a = i / n * TAU; g.fillRect(q(x + Math.cos(a) * rx), q(y + Math.sin(a) * ry), th || P, th || P); } }
    function glow(g, x, y, r, c, a) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, hexA(c, a)); gr.addColorStop(1, hexA(c, 0)); const o = g.globalCompositeOperation; g.globalCompositeOperation = 'lighter'; g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); g.globalCompositeOperation = o; }
    function hexA(c, a) { const n = parseInt(c.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
    function jag(g, pts, c, w, amp) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); for (let i = 0; i < pts.length - 1; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[i + 1]; if (i === 0) g.moveTo(x1, y1); const n = 5; for (let k = 1; k <= n; k++) { const u = k / n, j = k === n ? 0 : rnd(-amp, amp); g.lineTo(x1 + (x2 - x1) * u + (-(y2 - y1)) / (Math.hypot(x2 - x1, y2 - y1) || 1) * j, y1 + (y2 - y1) * u + (x2 - x1) / (Math.hypot(x2 - x1, y2 - y1) || 1) * j); } } g.stroke(); }
    function drawGround(g) { // 땅에 붙는 것: 그림자·마법진·고리·장판
      const pv = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
      for (const e of E) {
        const c = e.pal, s = S, sp = e.spec || {};
        if (e.type === 'cast') { const u = e.t / e.dur; g.globalAlpha = 1 - u; oval(g, e.x, e.y, (10 + u * 10) * s, (4 + u * 4) * s, c[2]); g.globalAlpha = 1; }
        else if (e.type === 'ring') { const u = e.t / e.dur; g.globalAlpha = (1 - u) * 0.9; oval(g, e.x, e.y, e.r * (0.3 + u * 0.9), e.r * (0.3 + u * 0.9) * 0.55, c[1], P); oval(g, e.x, e.y, e.r * (0.2 + u * 0.8), e.r * (0.2 + u * 0.8) * 0.55, c[3]); g.globalAlpha = 1; }
        else if (e.type === 'orb' && e.z > 1) { g.globalAlpha = 0.3; g.fillStyle = '#000'; g.beginPath(); g.ellipse(e.x, e.y, sp.r * s * 1.1, sp.r * s * 0.45, 0, 0, TAU); g.fill(); g.globalAlpha = 1; }
        else if (e.type === 'nova') { const u = Math.min(1, e.t / (sp.dur * 0.55)), rr = sp.r * s * u, fade = 1 - Math.max(0, (e.t - sp.dur * 0.55) / (sp.dur * 0.45));
          g.globalAlpha = fade; if (sp.look === 'circle' || sp.look === 'timestop') { runes(g, e.x, e.y, sp.r * s * (0.6 + u * 0.4), c, e.t); } else { oval(g, e.x, e.y, rr, rr * 0.55, c[1], P * (sp.look === 'quake' ? 2 : 1)); oval(g, e.x, e.y, rr * 0.92, rr * 0.5, c[3]); }
          if (sp.look === 'quake') { g.fillStyle = '#4a3a2a'; for (let k = 0; k < 8; k++) { const a = k / 8 * TAU + 0.3; for (let r0 = 8 * s; r0 < rr; r0 += P * 2) g.fillRect(q(e.x + Math.cos(a + Math.sin(r0) * 0.15) * r0), q(e.y + Math.sin(a + Math.sin(r0) * 0.15) * r0 * 0.55), P, P); } }
          g.globalAlpha = 1; }
        else if (e.type === 'zone') { const tele = e.t < sp.delay, u = tele ? e.t / sp.delay : 1, life = sp.delay + (sp.linger || 0.5), fade = Math.min(1, (life - e.t) / 0.3);
          g.globalAlpha = (tele ? 0.5 + 0.5 * Math.sin(e.t * 20) * 0.5 : 0.75) * fade;
          if (tele || !sp.linger) { oval(g, e.x, e.y, sp.r * s * (tele ? 0.4 + 0.6 * u : 1), sp.r * s * 0.55 * (tele ? 0.4 + 0.6 * u : 1), c[2]); if (sp.look === 'meteor' && tele) { g.globalAlpha = 0.35 * u; g.fillStyle = '#000'; g.beginPath(); g.ellipse(e.x, e.y, sp.r * s * 0.6 * u, sp.r * s * 0.3 * u, 0, 0, TAU); g.fill(); } }
          else { const fill = sp.look === 'hole' ? '#0a0418' : sp.look === 'swamp' ? c[3] : sp.look === 'blizzard' ? c[1] : c[2]; g.globalAlpha = (sp.look === 'hole' ? 0.75 : 0.35) * fade; g.fillStyle = fill; g.beginPath(); g.ellipse(e.x, e.y, sp.r * s * (sp.look === 'hole' ? 0.45 + Math.sin(e.t * 9) * 0.04 : 1), sp.r * s * 0.55 * (sp.look === 'hole' ? 0.45 : 1), 0, 0, TAU); g.fill(); g.globalAlpha = 0.8 * fade; oval(g, e.x, e.y, sp.r * s, sp.r * s * 0.55, c[sp.look === 'hole' ? 1 : 3]); if (sp.look === 'hole') { runes(g, e.x, e.y, sp.r * s * 0.7, c, -e.t * 2); } }
          g.globalAlpha = 1; }
        else if (e.type === 'self') { const u = e.t / e.dur; g.globalAlpha = 1 - u;
          if (e.spec.aura === 'burst') { oval(g, e.x, e.y, sp.r * s * (0.3 + u), sp.r * s * 0.55 * (0.3 + u), c[2], P); runes(g, e.x, e.y, sp.r * s * 0.6, c, e.t * 3); }
          else if (e.spec.aura === 'bloom' || e.spec.aura === 'heal' || e.spec.aura === 'pillar') { oval(g, e.x, e.y, sp.r * s * (0.5 + u * 0.5), sp.r * s * 0.3 * (1 + u), c[2], P); }
          else if (e.spec.aura === 'flame') { oval(g, e.x, e.y, sp.r * s * (0.4 + u * 0.6), sp.r * s * 0.55 * (0.4 + u * 0.6), c[2], P); }
          else if (e.spec.aura === 'haste') { oval(g, e.x, e.y, sp.r * s, sp.r * s * 0.4, c[2]); }
          g.globalAlpha = 1; }
        else if (e.type === 'beam' && e.spec.look === 'ray') { g.globalAlpha = 0.35; g.fillStyle = c[3]; g.beginPath(); g.ellipse(e.x + e.dx * sp.len * s / 2, e.y + e.dy * sp.len * s / 2 * 0.85, Math.max(6, Math.abs(e.dx) * sp.len * s / 2), Math.max(4, Math.abs(e.dy) * sp.len * s / 2 * 0.85), 0, 0, TAU); g.fill(); g.globalAlpha = 1; }
        else if (e.type === 'wave') { const cx = e.x + e.dx * e.d, cy = e.y + e.dy * e.d * 0.85; g.globalAlpha = 0.25; g.fillStyle = '#000'; g.beginPath(); g.ellipse(cx, cy + 4 * s, Math.max(10 * s, Math.abs(e.dy) * sp.w * s / 2 + 10 * s), Math.max(6 * s, Math.abs(e.dx) * sp.w * s / 2 * 0.85 + 6 * s), 0, 0, TAU); g.fill(); g.globalAlpha = 1; }
      }
      for (const p of PT) if (p.z > 6 * S && p.shadow !== false && p.s > P) { g.globalAlpha = 0.18; g.fillStyle = '#000'; g.fillRect(q(p.x), q(p.y), p.s, P); g.globalAlpha = 1; }
      g.imageSmoothingEnabled = pv;
    }
    function runes(g, x, y, r, c, t) { oval(g, x, y, r, r * 0.55, c[2]); oval(g, x, y, r * 0.72, r * 0.4, c[3]); g.fillStyle = c[1]; for (let k = 0; k < 6; k++) { const a = t + k / 6 * TAU; g.fillRect(q(x + Math.cos(a) * r * 0.86 - P), q(y + Math.sin(a) * r * 0.86 * 0.55 - P), P * 2, P * 2); } }
    function drawTop(g) { // 공중에 뜬 것: 구슬·번개·기둥·파편
      const pv = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false; const now = performance.now() / 1000;
      for (const p of PT) { const u = p.t / p.life; g.globalAlpha = p.fade ? Math.min(1, (1 - u) * 1.6) : 1; g.fillStyle = p.c; g.fillRect(q(p.x), q(p.y - p.z), p.s, p.s); }
      g.globalAlpha = 1;
      for (const e of E) {
        const c = e.pal, s = S, sp = e.spec || {};
        if (e.type === 'orb') { const x = e.x, y = e.y - e.z, r = sp.r * s;
          if (sp.look === 'boulder') { disc(g, x, y - r, r, '#4a3a2a'); disc(g, x - P, y - r - P, r - P, '#8a7a60'); g.fillStyle = '#b0a080'; const a = e.d / (r || 1); g.fillRect(q(x + Math.cos(a) * r * 0.5), q(y - r + Math.sin(a) * r * 0.5), P * 2, P); continue; }
          if (sp.look === 'tornado') { for (let k = 0; k < 7; k++) { const yy = y - k * 6 * s, rx = (6 + k * 3.2) * s, off = Math.sin(now * 12 + k) * 3 * s; g.globalAlpha = 0.85; oval(g, x + off, yy, rx, rx * 0.3, k % 2 ? c[2] : c[1]); } g.globalAlpha = 1; continue; }
          if (sp.look === 'lance') { g.fillStyle = c[3]; for (let k = -4; k <= 4; k++) g.fillRect(q(x + e.dx * k * P * 1.5 - P), q(y + e.dy * k * P * 1.2 - P), P * (k > -3 && k < 3 ? 2 : 1), P * 2); g.fillStyle = c[0]; for (let k = 0; k <= 4; k++) g.fillRect(q(x + e.dx * k * P * 1.5), q(y + e.dy * k * P * 1.2), P, P); glow(g, x, y, 14 * s, c[2], 0.5); continue; }
          glow(g, x, y, r * 3, c[2], 0.55); disc(g, x, y, r + P, c[3]); disc(g, x, y, r, c[2]); disc(g, x - P / 2, y - P / 2, r * 0.6, c[1]); disc(g, x - P, y - P, Math.max(P, r * 0.25), c[0]);
          if (sp.look === 'ballz') { for (let k = 0; k < 3; k++) { const a = now * 9 + k * 2.1; jag(g, [[x, y], [x + Math.cos(a) * r * 2.4, y + Math.sin(a) * r * 2.4]], c[1], Math.max(1, s), 3 * s); } }
          if (sp.look === 'shade') { g.globalAlpha = 0.6; disc(g, x - e.dx * r, y - e.dy * r, r * 0.8, c[2]); g.globalAlpha = 1; } }
        else if (e.type === 'chain') { const u = e.t / e.dur; g.globalAlpha = 1 - u * 0.6; if (e.spec.look === 'drain') { g.strokeStyle = c[2]; g.lineWidth = 3 * s; g.beginPath(); g.moveTo(e.pts[0][0], e.pts[0][1]); for (const p of e.pts.slice(1)) g.quadraticCurveTo((e.pts[0][0] + p[0]) / 2, (e.pts[0][1] + p[1]) / 2 - 20 * s * Math.sin(now * 10), p[0], p[1]); g.stroke(); const p = e.pts[e.pts.length - 1]; for (let k = 0; k < 4; k++) { const v = (u * 1.4 + k * 0.25) % 1; disc(g, p[0] + (e.pts[0][0] - p[0]) * v, p[1] + (e.pts[0][1] - p[1]) * v, 2 * s, c[1]); } }
          else { jag(g, e.pts, c[3], 4 * s, 7 * s); jag(g, e.pts, c[1], 2 * s, 5 * s); jag(g, e.pts, c[0], Math.max(1, s), 3 * s); } g.globalAlpha = 1; }
        else if (e.type === 'zap') { jag(g, [[e.x, e.y], [e.x2, e.y2]], c[1], 2 * s, 4 * s); }
        else if (e.type === 'skybolt') { const u = e.t / e.dur; g.globalAlpha = 1 - u * 0.5; jag(g, [[e.x + rnd(-10, 10) * s, e.y - 150 * s], [e.x, e.y]], c[3], 5 * s, 9 * s); jag(g, [[e.x, e.y - 150 * s], [e.x, e.y]], c[0], 2 * s, 6 * s); glow(g, e.x, e.y, 40 * s, c[1], 0.6); g.globalAlpha = 1; }
        else if (e.type === 'star') { const u = e.t / e.dur, x = e.x - 60 * s * (1 - u), y = e.y - 120 * s * (1 - u); disc(g, x, y, 4 * s, c[0]); glow(g, x, y, 18 * s, c[2], 0.7); g.fillStyle = c[2]; for (let k = 1; k < 6; k++) g.fillRect(q(x - k * 5 * s), q(y - k * 10 * s), P, P); }
        else if (e.type === 'flash') { const u = e.t / e.dur; g.globalAlpha = 1 - u; disc(g, e.x, e.y - 6 * S, e.r * (0.5 + u * 0.5), c[0]); glow(g, e.x, e.y - 6 * S, e.r * 2.2, c[1], 0.8); g.globalAlpha = 1; }
        else if (e.type === 'puff') { const u = e.t / e.dur; g.globalAlpha = 1 - u; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; disc(g, e.x + Math.cos(a) * u * 16 * s, e.y - 12 * s + Math.sin(a) * u * 10 * s - u * 8 * s, (5 - u * 3) * s, k % 2 ? c[1] : c[2]); } g.globalAlpha = 1; }
        else if (e.type === 'streak') { const u = e.t / e.dur; g.globalAlpha = 0.7 * (1 - u); g.strokeStyle = c[1]; g.lineWidth = 6 * s * (1 - u); g.beginPath(); g.moveTo(e.x, e.y - 14 * s); g.lineTo(e.x2, e.y2 - 14 * s); g.stroke(); g.globalAlpha = 1; }
        else if (e.type === 'spike') { const u = e.t / e.dur, h = (u < 0.15 ? u / 0.15 : 1) * 22 * s, fade = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1; g.globalAlpha = fade; for (let k = 0; k < 3; k++) { const ox = (k - 1) * 6 * s, hh = h * (k === 1 ? 1 : 0.65); for (let yy = 0; yy < hh; yy += P) { const w = Math.max(P, (1 - yy / hh) * 6 * s); g.fillStyle = yy > hh * 0.6 ? c[0] : k === 1 ? c[2] : c[3]; g.fillRect(q(e.x + ox - w / 2), q(e.y - yy), q(w) || P, P); } } g.globalAlpha = 1; }
        else if (e.type === 'beam') { const u = e.t / sp.dur, fade = u > 0.8 ? (1 - u) / 0.2 : 1; if (sp.look === 'ray') { g.globalAlpha = fade; const x0 = e.x + e.dx * 10 * s, y0 = e.y - 14 * s + e.dy * 6 * s, x1 = x0 + e.dx * sp.len * s, y1 = y0 + e.dy * sp.len * s * 0.85; g.lineCap = 'butt'; g.strokeStyle = c[3]; g.lineWidth = sp.w * s; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.strokeStyle = c[1]; g.lineWidth = sp.w * s * 0.5 * (0.8 + Math.random() * 0.4); g.stroke(); g.strokeStyle = c[0]; g.lineWidth = Math.max(1, sp.w * s * 0.15); g.stroke(); glow(g, x1, y1, 26 * s, c[1], 0.6); g.globalAlpha = 1; } }
        else if (e.type === 'wave') { const cx = e.x + e.dx * e.d, cy = e.y + e.dy * e.d * 0.85, n = Math.round(sp.w * s / P); for (let k = 0; k < n; k++) { const o = (k / n - 0.5) * sp.w * s, wx = cx + -e.dy * o, wy = cy + e.dx * o * 0.85, h = (16 + Math.sin(k * 0.7 + now * 10) * 4) * s * (1 - Math.abs(k / n - 0.5) * 1.2); for (let yy = 0; yy < h; yy += P) { g.fillStyle = yy > h - P * 2 ? c[0] : yy > h * 0.5 ? c[2] : c[3]; g.fillRect(q(wx), q(wy - yy), P, P); } } }
        else if (e.type === 'self') { const u = e.t / e.dur, a = e.spec.aura;
          if (a === 'shield') { g.globalAlpha = 0.6 * (1 - u); oval(g, e.x, e.y - 14 * s, 18 * s * (0.8 + u * 0.3), 20 * s * (0.8 + u * 0.3), c[1], P); glow(g, e.x, e.y - 14 * s, 26 * s, c[2], 0.35 * (1 - u)); g.globalAlpha = 1; }
          else if (a === 'pillar') { g.globalAlpha = 1 - u; const w = 14 * s * (1 - u * 0.5); g.fillStyle = c[1]; g.fillRect(q(e.x - w / 2), q(e.y - 180 * s), q(w), q(180 * s)); g.fillStyle = c[0]; g.fillRect(q(e.x - w / 6), q(e.y - 180 * s), Math.max(P, q(w / 3)), q(180 * s)); glow(g, e.x, e.y - 20 * s, 60 * s, c[2], 0.6); g.globalAlpha = 1; if (Math.random() < 0.6) part({ x: e.x + rnd(-14, 14) * s, y: e.y, z: 0, vz: rnd(60, 140) * s, life: 0.7, c: c[(Math.random() * 3) | 0] }); }
          else if (a === 'heal' || a === 'bloom') { if (Math.random() < 0.5) { const px = e.x + rnd(-14, 14) * s; part({ x: px, y: e.y, z: rnd(0, 6) * s, vz: rnd(30, 60) * s, life: 0.7, c: a === 'heal' ? c[1] : ['#ff9ec4', '#ffe066', c[1]][(Math.random() * 3) | 0], s: P }); } if (a === 'heal' && e.t < 0.05) for (let k = 0; k < 4; k++) E.push({ type: 'plus', x: e.x + rnd(-12, 12) * s, y: e.y - rnd(10, 26) * s, t: -k * 0.12, dur: 0.6, pal: c }); }
          else if (a === 'flame') { if (Math.random() < 0.9) { const ang = rnd(0, TAU), r0 = sp.r * s * (0.4 + u * 0.6); part({ x: e.x + Math.cos(ang) * r0, y: e.y + Math.sin(ang) * r0 * 0.55, z: 2 * s, vz: rnd(30, 70) * s, life: 0.4, c: c[(Math.random() * 4) | 0] }); } }
          else if (a === 'haste') { if (Math.random() < 0.8) part({ x: e.x + rnd(-10, 10) * s, y: e.y - rnd(4, 28) * s, z: 0, vx: rnd(-90, -50) * s, life: 0.3, c: c[(Math.random() * 3) | 0], s: P }); }
          else if (a === 'burst') { if (e.t < 0.05) burst(e.x, e.y, 14 * s, 18, c.slice(0, 4), 110); glow(g, e.x, e.y - 14 * s, sp.r * s * 1.6 * (1 - u), c[2], 0.5 * (1 - u)); } }
        else if (e.type === 'plus') { if (e.t < 0) continue; const u = e.t / e.dur; g.globalAlpha = 1 - u; g.fillStyle = c[1]; const x = e.x, y = e.y - u * 14 * S; g.fillRect(q(x - P * 1.5), q(y - P / 2), P * 3, P); g.fillRect(q(x - P / 2), q(y - P * 1.5), P, P * 3); g.globalAlpha = 1; }
        else if (e.type === 'zone' && e.spec.look === 'meteor' && e.t < e.spec.delay) { const u = e.t / e.spec.delay, x = e.x - 70 * s * (1 - u), y = e.y - 160 * s * (1 - u), r = (6 + u * 8) * s; glow(g, x, y, r * 3, c[2], 0.7); disc(g, x, y, r, c[3]); disc(g, x - P, y - P, r * 0.7, c[2]); disc(g, x - P * 2, y - P * 2, r * 0.35, c[0]); }
      }
      if (tint) { tint.t += 1 / 60; const u = tint.t / tint.dur; if (u >= 1) tint = null; else { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1 - u; g.fillStyle = tint.c; g.fillRect(0, 0, g.canvas.width, g.canvas.height); g.restore(); } }
      g.imageSmoothingEnabled = pv;
    }
    function lights() { // 날아가는 구슬·번쩍임 → 빛 (밤)
      const out = [];
      for (const e of E) { if (e.type === 'orb' && !(e.spec.look === 'boulder' || e.spec.look === 'tornado')) out.push({ x: e.x, y: e.y - e.z, r: 110 * S, c: e.pal[2], a: 0.9 });
        else if (e.type === 'zone' && e.landed && (e.spec.look === 'storm' || e.spec.look === 'stars' || e.spec.look === 'hole')) out.push({ x: e.x, y: e.y, r: e.spec.r * S * 2, c: e.pal[2], a: 0.6 });
        else if (e.type === 'beam' || e.type === 'nova') out.push({ x: e.x + (e.dx || 0) * 40 * S, y: e.y, r: 120 * S, c: e.pal[2], a: 0.7 }); }
      for (const l of LT) out.push({ x: l.x, y: l.y, r: l.r, c: l.c, a: (1 - l.t / l.dur) * l.a });
      return out;
    }
    return { cast, update, drawGround, drawTop, lights, shake: () => (shakeT > 0 ? { x: rnd(-1, 1) * shakeA, y: rnd(-1, 1) * shakeA } : { x: 0, y: 0 }), busy: () => E.length + PT.length, clear: () => { E.length = 0; PT.length = 0; LT.length = 0; } };
  }
  root.MPMagicFX = { create };
})(typeof window !== 'undefined' ? window : globalThis);
