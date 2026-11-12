#!/usr/bin/env python3
"""MP 2026 세계 지도 생성기.

타일 격자(기본 720x720) 위에 지형, 영토(약 240개), 수도 후보와 하늘 포털,
균열 웨이브(D6~D14, 5회), 속성을 만들고 maps/ 아래에 JSON과 미리보기 PNG를 저장한다.

사용법:  python3 tools/mapgen/gen_map.py --seed 2026
"""
import argparse
import base64
import json
import math
import os
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------- 설정
TILE_PX = 32               # 게임 안 타일 한 칸의 픽셀 크기
SCREEN_TILES = (40, 22)    # 1280x720 화면에 보이는 타일 수
WALK_TPS = 5               # 걷기 속도 (타일/초)

T_VOID, T_GRASS, T_FOREST, T_SAND, T_WATER, T_MOUNTAIN, T_HOLY, T_WALL = range(8)
PASSABLE = {T_GRASS, T_FOREST, T_SAND, T_HOLY}
TERRAIN_NAMES = ["void", "grass", "forest", "sand", "water", "mountain", "holy", "wall"]

TYPES = ["기하", "대수", "확통", "미적분", "수열", "논리"]
TYPE_COLORS = [(143, 176, 236), (240, 161, 151), (143, 209, 173),
               (202, 165, 236), (242, 207, 138), (147, 211, 220)]

HOLY_R = 42       # 성지 반경 (타일)
WALL_W = 3        # 성벽 두께
GATE_HALF = 3     # 성문 반폭


def value_noise(w, h, scale, rng):
    gw, gh = w // scale + 3, h // scale + 3
    grid = rng.random((gh, gw))
    ys = np.arange(h) / scale
    xs = np.arange(w) / scale
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    fy = ys - y0
    fx = xs - x0
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = grid[np.ix_(y0, x0)]
    b = grid[np.ix_(y0, x0 + 1)]
    c = grid[np.ix_(y0 + 1, x0)]
    d = grid[np.ix_(y0 + 1, x0 + 1)]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def fbm(w, h, base, octaves, rng):
    total = np.zeros((h, w))
    amp, norm, scale = 1.0, 0.0, base
    for _ in range(octaves):
        total += amp * value_noise(w, h, max(2, int(scale)), rng)
        norm += amp
        amp *= 0.5
        scale /= 2
    return total / norm


NEIGH4 = ((1, 0), (-1, 0), (0, 1), (0, -1))


def bfs_reach(passable, start):
    h, w = passable.shape
    seen = np.zeros_like(passable, dtype=bool)
    q = deque([start])
    seen[start[1], start[0]] = True
    while q:
        x, y = q.popleft()
        for dx, dy in NEIGH4:
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and passable[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((nx, ny))
    return seen


def flood_territories(passable, owner, seeds):
    """seeds: [(x, y)] -> owner 격자에 1..N 번호를 지형을 따라 퍼뜨린다."""
    h, w = passable.shape
    q = deque()
    for i, (x, y) in enumerate(seeds, start=1):
        if owner[y, x] == 0:
            owner[y, x] = i
            q.append((x, y))
    while q:
        x, y = q.popleft()
        o = owner[y, x]
        for dx, dy in NEIGH4:
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and passable[ny, nx] and owner[ny, nx] == 0:
                owner[ny, nx] = o
                q.append((nx, ny))
    return owner


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--size", type=int, default=720)
    ap.add_argument("--territories", type=int, default=240)
    ap.add_argument("--capitals", type=int, default=48)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "maps"))
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    W = H = args.size
    cx, cy = W // 2, H // 2
    yy, xx = np.mgrid[0:H, 0:W]
    dist = np.hypot(xx - cx, yy - cy)
    land_r = W / 2 * 0.95

    # ---------------------------------------------------- 지형
    shape_noise = fbm(W, H, 96, 4, rng)
    elev = fbm(W, H, 64, 5, rng)
    moist = fbm(W, H, 80, 4, rng)

    land = dist / land_r + (shape_noise - 0.5) * 0.18 < 1.0
    terrain = np.full((H, W), T_VOID, dtype=np.uint8)
    terrain[land] = T_GRASS

    # 중립 지역은 땅 위가 아니라 하늘(별도 맵)에 있다. 땅은 전부 영토.
    holy_zone = np.zeros((H, W), dtype=bool)
    e_land = elev[land & ~holy_zone]
    w_th = np.quantile(e_land, 0.07)
    m_th = np.quantile(e_land, 0.91)
    f_th = np.quantile(moist[land], 0.62)
    s_th = np.quantile(moist[land], 0.12)

    sel = land & ~holy_zone
    terrain[sel & (moist > f_th)] = T_FOREST
    terrain[sel & (moist < s_th)] = T_SAND
    terrain[sel & (elev < w_th)] = T_WATER
    terrain[sel & (elev > m_th)] = T_MOUNTAIN

    passable = np.isin(terrain, list(PASSABLE))
    ys_p, xs_p = np.nonzero(passable)
    k0 = int(np.argmin((xs_p - cx) ** 2 + (ys_p - cy) ** 2))
    reach = bfs_reach(passable, (int(xs_p[k0]), int(ys_p[k0])))
    terrain[passable & ~reach] = T_MOUNTAIN
    passable = passable & reach

    # ---------------------------------------------------- 영토 씨앗
    holy_mask = np.zeros((H, W), dtype=bool)
    cand = passable & ~holy_zone
    area = int(cand.sum())
    r_min = math.sqrt(area / args.territories) * 0.92
    cell = r_min / math.sqrt(2)
    ys_c, xs_c = np.nonzero(cand)
    order = rng.permutation(len(xs_c))
    grid = {}
    seeds = []
    for idx in order:
        x, y = int(xs_c[idx]), int(ys_c[idx])
        gx, gy = int(x / cell), int(y / cell)
        ok = True
        for ox in range(-2, 3):
            for oy in range(-2, 3):
                p = grid.get((gx + ox, gy + oy))
                if p and (p[0] - x) ** 2 + (p[1] - y) ** 2 < r_min * r_min:
                    ok = False
                    break
            if not ok:
                break
        if ok:
            grid[(gx, gy)] = (x, y)
            seeds.append((x, y))

    warp_x = (fbm(W, H, 48, 3, rng) - 0.5) * 36
    warp_y = (fbm(W, H, 48, 3, rng) - 0.5) * 36
    wx = xx + warp_x
    wy = yy + warp_y

    def assign(seeds_):
        S = np.array(seeds_, dtype=np.float32)
        owner = np.zeros((H, W), dtype=np.int32)
        for r0 in range(0, H, 32):
            px = wx[r0:r0 + 32].reshape(-1, 1)
            py = wy[r0:r0 + 32].reshape(-1, 1)
            d2 = (px - S[None, :, 0]) ** 2 + (py - S[None, :, 1]) ** 2
            owner[r0:r0 + 32] = (np.argmin(d2, axis=1) + 1).reshape(-1, W)
        owner[~passable] = 0
        owner[holy_mask & passable] = -1
        # 산/호수로 끊긴 조각은 가장 큰 덩어리만 남기고 이웃에 붙인다
        comp = np.zeros((H, W), dtype=np.int32)
        best = {}
        sizes_ = [0]
        cid = 0
        for y0 in range(H):
            for x0 in range(W):
                o = owner[y0, x0]
                if o <= 0 or comp[y0, x0]:
                    continue
                cid += 1
                comp[y0, x0] = cid
                q = deque([(x0, y0)])
                cnt = 0
                while q:
                    x, y = q.popleft()
                    cnt += 1
                    for dx, dy in NEIGH4:
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < W and 0 <= ny < H and owner[ny, nx] == o and not comp[ny, nx]:
                            comp[ny, nx] = cid
                            q.append((nx, ny))
                sizes_.append(cnt)
                if o not in best or cnt > sizes_[best[o]]:
                    best[o] = cid
        keep = np.zeros(cid + 1, dtype=bool)
        for c in best.values():
            keep[c] = True
        stray = (owner > 0) & ~keep[comp]
        owner[stray] = 0
        q = deque()
        hh, ww = np.nonzero(owner > 0)
        for y, x in zip(hh.tolist(), ww.tolist()):
            q.append((x, y))
        while q:
            x, y = q.popleft()
            o = owner[y, x]
            for dx, dy in NEIGH4:
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and passable[ny, nx] and owner[ny, nx] == 0:
                    owner[ny, nx] = o
                    q.append((nx, ny))
        return owner

    # Lloyd 완화 2회 (원래 좌표 기준 무게중심)
    for _ in range(2):
        owner = assign(seeds)
        m = owner > 0
        o = owner[m]
        cnt = np.bincount(o, minlength=len(seeds) + 1)
        sx = np.bincount(o, weights=xx[m], minlength=len(seeds) + 1)
        sy = np.bincount(o, weights=yy[m], minlength=len(seeds) + 1)
        seeds = [(sx[i] / cnt[i], sy[i] / cnt[i]) for i in range(1, len(seeds) + 1) if cnt[i] > 0]
    owner = assign(seeds)

    # 너무 작은 영토는 이웃에 흡수
    n = len(seeds)
    sizes = np.bincount(owner[owner > 0].ravel(), minlength=n + 1)
    # ---------------------------------------------------- 인접 그래프
    def adjacency(own):
        pairs = set()
        a, b = own[:, :-1], own[:, 1:]
        m = (a != b) & (a != 0) & (b != 0)
        pairs |= set(zip(a[m].tolist(), b[m].tolist()))
        a, b = own[:-1, :], own[1:, :]
        m = (a != b) & (a != 0) & (b != 0)
        pairs |= set(zip(a[m].tolist(), b[m].tolist()))
        adj = {}
        for p, q in pairs:
            adj.setdefault(p, set()).add(q)
            adj.setdefault(q, set()).add(p)
        return adj

    small = [i for i in range(1, n + 1) if 0 < sizes[i] < (area / args.territories) * 0.35]
    adj = adjacency(owner)
    for i in small:
        nb = [j for j in adj.get(i, ()) if j > 0 and j not in small]
        if nb:
            owner[owner == i] = max(nb, key=lambda j: sizes[j])

    # 번호 다시 매기기 (1..N), 성지는 0
    ids = sorted(set(np.unique(owner).tolist()) - {0, -1})
    remap = np.zeros(owner.max() + 2, dtype=np.int32)
    for new_id, old in enumerate(ids, start=1):
        remap[old] = new_id
    terr = np.where(owner > 0, remap[np.clip(owner, 0, None)], 0)
    terr = np.where(owner == -1, 0, terr).astype(np.int32)
    terr_full = np.where(passable, terr, -1)  # -1: 이동 불가 / 공허
    N = len(ids)

    adj = adjacency(np.where(terr_full >= 0, terr_full + 1, 0))
    adj = {k - 1: {v - 1 for v in vs} for k, vs in adj.items()}

    # ---------------------------------------------------- 영토 속성
    angle_noise = fbm(W, H, 128, 3, rng)
    terrs = []
    for t in range(1, N + 1):
        ys_t, xs_t = np.nonzero(terr_full == t)
        mx, my = float(xs_t.mean()), float(ys_t.mean())
        k = int(np.argmin((xs_t - mx) ** 2 + (ys_t - my) ** 2))
        ax, ay = int(xs_t[k]), int(ys_t[k])
        dc = math.hypot(mx - cx, my - cy) / land_r
        ang = math.atan2(my - cy, mx - cx) + (angle_noise[ay, ax] - 0.5) * 1.2
        ring_name = "inner" if dc < 0.36 else ("middle" if dc < 0.74 else "frontier")
        terrs.append({
            "id": t,
            "center": [round(mx, 1), round(my, 1)],
            "altar": [ax, ay],
            "area": int(len(xs_t)),
            "ang": (ang + math.pi) % (2 * math.pi),
            "ring": ring_name,
            "dc": round(dc, 3),
            "neighbors": sorted(int(v) for v in adj.get(t, ()) if v != t),
        })

    # 속성: 각도 순으로 정렬해 6등분 (지역별로 뭉치고 개수는 비슷하게)
    by_ang = sorted(range(N), key=lambda i: terrs[i]["ang"])
    for pos, i in enumerate(by_ang):
        terrs[i]["type"] = TYPES[pos * 6 // N]
        del terrs[i]["ang"]

    # 균열: D5 멸망 선포 후 D6·D8·D10·D12·D14 다섯 번에 걸쳐 영토가 무너진다.
    # 바깥에서만 오지 않도록 지도 곳곳의 진원지에서 퍼지게 한다 (위치 유불리 제거).
    # 땅 위에 안전지대는 없다. 안전한 곳은 하늘(중립)뿐.
    pool = list(terrs)
    epic = [pool[int(i)] for i in rng.choice(len(pool), size=7, replace=False)]
    maxd = W * 0.5
    def danger(tr):
        near = min(math.dist(tr["center"], e["center"]) for e in epic)
        return 0.35 * tr["dc"] + 0.65 * (1 - min(1.0, near / (maxd * 0.45))) + rng.normal(0, 0.05)
    scored = sorted(pool, key=danger, reverse=True)
    waves = [0.09, 0.09, 0.09, 0.09, 0.09]   # 웨이브당 전체의 약 9%
    for tr in terrs:
        tr["rift"] = 0
    pos = 0
    for k, frac in enumerate(waves, start=1):
        n_k = int(round(N * frac))
        for tr in scored[pos:pos + n_k]:
            tr["rift"] = k
        pos += n_k
    for e in epic:
        e["riftEpicenter"] = True

    # 수도 후보: 균열 3단계 전까지 안전하고(0 또는 3), 서로 인접하지 않게 고르게 퍼뜨린다
    cands = [tr for tr in terrs if 0.2 <= tr["dc"]]
    order_c = sorted(cands, key=lambda _: rng.random())
    factor = 1.0
    while True:
        picked = []
        min_d = math.sqrt(area / args.capitals) * factor
        for tr in order_c:
            if len(picked) >= args.capitals:
                break
            if any(tr["id"] in p["neighbors"] for p in picked):
                continue
            if any(math.dist(tr["center"], p["center"]) < min_d for p in picked):
                continue
            picked.append(tr)
        if len(picked) >= args.capitals or factor < 0.3:
            break
        factor -= 0.05
    for tr in terrs:
        tr["capitalCandidate"] = tr in picked

    # 하늘로 가는 포털: 수도 후보마다 하나 (제단 근처). 주인 없는 포털은 누구나(유랑민 포함) 사용.
    for tr in picked:
        ax, ay = tr["altar"]
        best = None
        for r in range(3, 9):
            for dx in range(-r, r + 1):
                for dy in (-r, r):
                    for (px_, py_) in ((ax + dx, ay + dy), (ax + dy, ay + dx)):
                        if 0 <= px_ < W and 0 <= py_ < H and passable[py_, px_] and terr_full[py_, px_] == tr["id"]:
                            d_ = abs(px_ - ax) + abs(py_ - ay - 3)
                            if best is None or d_ < best[0]:
                                best = (d_, px_, py_)
            if best:
                break
        tr["portal"] = [best[1], best[2]] if best else [ax, ay + 1]

    # ---------------------------------------------------- 저장
    os.makedirs(args.out, exist_ok=True)
    terr_u16 = np.where(terr_full < 0, 65535, terr_full).astype("<u2")
    data = {
        "version": 1,
        "seed": args.seed,
        "width": W,
        "height": H,
        "tilePx": TILE_PX,
        "terrainNames": TERRAIN_NAMES,
        "passable": [TERRAIN_NAMES[t] for t in sorted(PASSABLE)],
        "sky": "중립 지역은 하늘(별도 맵, 방으로 구성). 각 수도의 포털로 오르내린다.",
        "riftAnnounce": "D5 (12/18)",
        "riftSchedule": {"1": "D6 (12/19)", "2": "D8 (12/21)", "3": "D10 (12/23)", "4": "D12 (12/25)", "5": "D14 (12/27)"},
        "riftNote": "운영진 전용 데이터. 실제 서버는 rift 필드를 참가자에게 보내지 않는다.",
        "territories": terrs,
        "terrain_b64": base64.b64encode(terrain.tobytes()).decode(),
        "territory_u16le_b64": base64.b64encode(terr_u16.tobytes()).decode(),
    }
    with open(os.path.join(args.out, "world.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    render_overview(terrain, terr_full, terrs, picked, (cx, cy), os.path.join(args.out, "world_preview.png"))
    render_rift(terrain, terr_full, terrs, (cx, cy), os.path.join(args.out, "world_rift.png"))
    render_closeup(terrain, terr_full, (cx, cy), os.path.join(args.out, "world_closeup.png"))

    areas = [t["area"] for t in terrs]
    print(json.dumps({
        "size": [W, H],
        "territories": N,
        "capitalCandidates": len(picked),
        "areaMean": round(float(np.mean(areas))),
        "areaMin": int(min(areas)),
        "areaMax": int(max(areas)),
        "passableTiles": int(passable.sum()),
        "crossSeconds": round(2 * land_r / WALK_TPS),
        "rift": {k: sum(1 for t in terrs if t["rift"] == k) for k in (1, 2, 3, 4, 5)},
        "types": {ty: sum(1 for t in terrs if t["type"] == ty) for ty in TYPES},
    }, ensure_ascii=False))


# ---------------------------------------------------------------- 렌더링
BASE = {
    T_VOID: (30, 23, 51), T_WATER: (111, 183, 232), T_MOUNTAIN: (138, 129, 151),
    T_HOLY: (247, 241, 227), T_WALL: (107, 79, 179),
}


def territory_rgb(terrain, terr, terrs, light_jitter=True):
    h, w = terrain.shape
    img = np.zeros((h, w, 3), dtype=np.float32)
    lut = np.zeros((len(terrs) + 2, 3), dtype=np.float32)
    for tr in terrs:
        base = np.array(TYPE_COLORS[TYPES.index(tr["type"])], dtype=np.float32)
        j = ((tr["id"] * 2654435761) % 1000) / 1000.0 - 0.5
        lut[tr["id"]] = np.clip(base * (1 + j * 0.16), 0, 255) if light_jitter else base
    t = np.clip(terr, 0, None)
    img[:] = lut[t]
    tex = terrain == T_FOREST
    img[tex] *= 0.86
    img[terrain == T_SAND] = img[terrain == T_SAND] * 0.8 + np.array([240, 226, 180]) * 0.2
    for k, col in BASE.items():
        img[terrain == k] = col
    # 국경선
    border = np.zeros((h, w), dtype=bool)
    border[:, 1:] |= (terr[:, 1:] != terr[:, :-1]) & (terr[:, 1:] > 0) & (terr[:, :-1] > 0)
    border[1:, :] |= (terr[1:, :] != terr[:-1, :]) & (terr[1:, :] > 0) & (terr[:-1, :] > 0)
    img[border] = (43, 35, 64)
    return img


def font(size):
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", size)
    except OSError:
        return ImageFont.load_default()


def render_overview(terrain, terr, terrs, picked, center, path, scale=2):
    img = territory_rgb(terrain, terr, terrs)
    im = Image.fromarray(img.astype(np.uint8)).resize(
        (terrain.shape[1] * scale, terrain.shape[0] * scale), Image.NEAREST)
    d = ImageDraw.Draw(im)
    for tr in picked:
        x, y = tr["altar"][0] * scale, tr["altar"][1] * scale
        d.polygon([(x, y - 9), (x + 8, y + 6), (x - 8, y + 6)], fill=(229, 72, 106), outline=(255, 255, 255))
        px_, py_ = tr["portal"][0] * scale, tr["portal"][1] * scale
        d.ellipse([px_ - 5, py_ - 5, px_ + 5, py_ + 5], fill=(255, 236, 140), outline=(43, 35, 64))
    # 한 화면 크기 표시
    sw, sh = SCREEN_TILES[0] * scale, SCREEN_TILES[1] * scale
    x0, y0 = 30, im.height - 30 - sh
    d.rectangle([x0, y0, x0 + sw, y0 + sh], outline=(255, 255, 255), width=3)
    d.text((x0 + sw + 10, y0 + sh // 2), "= 게임 화면 1장", fill=(255, 255, 255), anchor="lm", font=font(20))
    im.save(path)


def render_rift(terrain, terr, terrs, center, path, scale=1):
    h, w = terrain.shape
    img = np.zeros((h, w, 3), dtype=np.float32)
    cols = {0: (159, 216, 138), 1: (60, 20, 100), 2: (100, 45, 160), 3: (145, 85, 205), 4: (185, 135, 230), 5: (220, 190, 245)}
    lut = np.zeros((len(terrs) + 2, 3), dtype=np.float32)
    for tr in terrs:
        lut[tr["id"]] = cols[tr["rift"]]
    img[:] = lut[np.clip(terr, 0, None)]
    for k, col in BASE.items():
        img[terrain == k] = col
    border = np.zeros((h, w), dtype=bool)
    border[:, 1:] |= (terr[:, 1:] != terr[:, :-1]) & (terr[:, 1:] > 0) & (terr[:, :-1] > 0)
    border[1:, :] |= (terr[1:, :] != terr[:-1, :]) & (terr[1:, :] > 0) & (terr[:-1, :] > 0)
    img[border] = (43, 35, 64)
    Image.fromarray(img.astype(np.uint8)).save(path)


def render_closeup(terrain, terr, center, path, tile=16):
    """지도 가운데 근처 80x45 타일을 확대해 실제 게임 스케일을 보여준다."""
    cx, cy = center
    x0, y0 = cx - 40, cy + 20
    sub_t = terrain[y0:y0 + 45, x0:x0 + 80]
    sub_o = terr[y0:y0 + 45, x0:x0 + 80]
    pal = {T_GRASS: (159, 216, 138), T_FOREST: (95, 170, 100), T_SAND: (236, 220, 180),
           T_WATER: (111, 183, 232), T_MOUNTAIN: (138, 129, 151), T_HOLY: (239, 232, 218),
           T_WALL: (107, 79, 179), T_VOID: (30, 23, 51)}
    im = Image.new("RGB", (80 * tile, 45 * tile))
    d = ImageDraw.Draw(im)
    for yy in range(sub_t.shape[0]):
        for xx in range(sub_t.shape[1]):
            d.rectangle([xx * tile, yy * tile, xx * tile + tile - 1, yy * tile + tile - 1],
                        fill=pal[int(sub_t[yy, xx])])
    for yy in range(sub_o.shape[0]):
        for xx in range(sub_o.shape[1]):
            o = sub_o[yy, xx]
            if xx + 1 < sub_o.shape[1] and o > 0 and sub_o[yy, xx + 1] > 0 and sub_o[yy, xx + 1] != o:
                d.line([(xx + 1) * tile, yy * tile, (xx + 1) * tile, (yy + 1) * tile], fill=(43, 35, 64), width=3)
            if yy + 1 < sub_o.shape[0] and o > 0 and sub_o[yy + 1, xx] > 0 and sub_o[yy + 1, xx] != o:
                d.line([xx * tile, (yy + 1) * tile, (xx + 1) * tile, (yy + 1) * tile], fill=(43, 35, 64), width=3)
    # 캐릭터 크기(1 x 1.5 타일) 예시
    rng = np.random.default_rng(1)
    for _ in range(9):
        px, py = int(rng.integers(5, 75)), int(rng.integers(3, 40))
        if sub_t[py, px] in PASSABLE:
            d.ellipse([px * tile, py * tile, px * tile + tile, py * tile + int(tile * 1.5)],
                      fill=(255, 255, 255), outline=(43, 35, 64), width=2)
    sw, sh = SCREEN_TILES[0] * tile, SCREEN_TILES[1] * tile
    d.rectangle([20 * tile, 11 * tile, 20 * tile + sw, 11 * tile + sh], outline=(229, 72, 106), width=4)
    d.text((20 * tile + 8, 11 * tile + 6), "게임 화면 1장 (40×22칸)", fill=(229, 72, 106), font=font(22))
    im.save(path)


if __name__ == "__main__":
    main()
