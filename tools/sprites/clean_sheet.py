#!/usr/bin/env python3
"""흐릿한(JPG·확대된) 픽셀 아트 시트를 원래 픽셀 크기로 되돌리고 배경을 지운다.

  python3 tools/sprites/clean_sheet.py <입력이미지> <출력폴더> [--debug]

1) 배경색과 다른 부분을 덩어리(스프라이트)로 나눈다 (흰 배경 위 흰 몸통은 윤곽선 안을 채워서).
2) 덩어리마다 '픽셀 한 칸이 몇 px로 확대됐는지'를 찾아(격자 추정) 칸 가운데 색만 뽑는다.
3) 색을 몇 개로 줄이고(JPG 얼룩 제거), 바깥 배경 칸은 투명하게 만든다.
"""
import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image


def components(mask, min_area=60):
    H, W = mask.shape
    lab = np.zeros((H, W), np.int32)
    out = []
    n = 0
    for y in range(H):
        for x in range(W):
            if mask[y, x] and not lab[y, x]:
                n += 1
                q = deque([(x, y)])
                lab[y, x] = n
                xs = [x]; ys = [y]
                while q:
                    cx, cy = q.popleft()
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            nx, ny = cx + dx, cy + dy
                            if 0 <= nx < W and 0 <= ny < H and mask[ny, nx] and not lab[ny, nx]:
                                lab[ny, nx] = n
                                q.append((nx, ny)); xs.append(nx); ys.append(ny)
                if len(xs) >= min_area:
                    out.append((min(xs), min(ys), max(xs) + 1, max(ys) + 1, len(xs)))
    return out


def grid_fit(crop):
    """칸 크기 s 와 시작점(ox, oy)을 찾는다: 칸 안 색 분산이 가장 작은 것."""
    a = crop.astype(np.float32)
    H, W = a.shape[:2]
    best = None
    for s in np.arange(2.6, 8.01, 0.05):
        for ox in np.arange(0, s, s / 6):
            for oy in np.arange(0, s, s / 6):
                xs = np.arange(ox, W, s); ys = np.arange(oy, H, s)
                if len(xs) < 4 or len(ys) < 4:
                    continue
                # 칸 가운데 근처 3x3 표본의 분산
                cx = np.clip((xs + s / 2).astype(int), 0, W - 1)
                cy = np.clip((ys + s / 2).astype(int), 0, H - 1)
                c = a[np.ix_(cy, cx)]
                err = 0.0
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    d = a[np.ix_(np.clip(cy + int(dy * s * 0.3), 0, H - 1), np.clip(cx + int(dx * s * 0.3), 0, W - 1))]
                    err += np.abs(d - c).mean()
                # 칸 경계는 색이 바뀌어야 좋다 (너무 작은 s 방지)
                bx = np.clip((xs).astype(int), 0, W - 1)
                edge = np.abs(a[np.ix_(cy, np.clip(bx - 1, 0, W - 1))] - a[np.ix_(cy, np.clip(bx + 1, 0, W - 1))]).mean()
                score = err - 0.15 * edge + 0.5 / s
                if best is None or score < best[0]:
                    best = (score, s, ox, oy)
    return best[1:] if best else None


def regrid(crop, s, ox, oy):
    H, W = crop.shape[:2]
    xs = np.arange(ox, W - s / 2, s); ys = np.arange(oy, H - s / 2, s)
    out = np.zeros((len(ys), len(xs), 3), np.float32)
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            y0, y1 = int(y + s * 0.3), max(int(y + s * 0.3) + 1, int(y + s * 0.7))
            x0, x1 = int(x + s * 0.3), max(int(x + s * 0.3) + 1, int(x + s * 0.7))
            out[j, i] = np.median(crop[y0:y1, x0:x1].reshape(-1, 3), axis=0)
    return out


def quantize(px, k=7):
    flat = px.reshape(-1, 3)
    # 간단한 k-means
    rng = np.random.default_rng(0)
    cent = flat[rng.choice(len(flat), size=min(k, len(flat)), replace=False)]
    for _ in range(12):
        d = ((flat[:, None, :] - cent[None, :, :]) ** 2).sum(-1)
        lab = d.argmin(1)
        for c in range(len(cent)):
            if (lab == c).any():
                cent[c] = flat[lab == c].mean(0)
    # 거의 같은 색 합치기
    return cent[lab].reshape(px.shape), cent


def clean(img_path, out_dir, debug=False):
    im = np.array(Image.open(img_path).convert('RGB')).astype(np.int32)
    H, W = im.shape[:2]
    os.makedirs(out_dir, exist_ok=True)
    # 배경 판정: 위쪽은 회색, 아래쪽은 흰색
    gray_bg = np.median(im[5:20, 5:20].reshape(-1, 3), axis=0)
    white_bg = np.array([255, 255, 255])
    split = None
    for y in range(H):
        if np.abs(im[y, :, :] - white_bg).sum(1).mean() < 25 and np.abs(im[y, 5] - gray_bg).sum() > 60:
            split = y
            break
    results = []
    for name, (y0, y1, bg) in {'top': (0, split or H, gray_bg), 'bottom': (split or H, H, white_bg)}.items():
        part = im[y0:y1]
        dist = np.abs(part - bg).sum(2)
        mask = dist > 70
        for (bx0, by0, bx1, by1, area) in components(mask):
            pad = 3
            cx0, cy0 = max(0, bx0 - pad), max(0, by0 - pad)
            cx1, cy1 = min(W, bx1 + pad), min(part.shape[0], by1 + pad)
            crop = part[cy0:cy1, cx0:cx1].astype(np.float32)
            if bx1 - bx0 < 14 or by1 - by0 < 12:
                continue
            fit = grid_fit(crop)
            if not fit:
                continue
            s, ox, oy = fit
            px = regrid(crop, s, ox, oy)
            q, cent = quantize(px, 8)
            # 배경 칸: 배경색과 가까운 칸 중 가장자리에서 이어진 것만 투명
            near_bg = np.abs(q - bg).sum(2) < 60
            h, w = near_bg.shape
            alpha = np.ones((h, w), np.uint8) * 255
            dq = deque([(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)])
            seen = np.zeros((h, w), bool)
            while dq:
                x, y = dq.popleft()
                if not (0 <= x < w and 0 <= y < h) or seen[y, x] or not near_bg[y, x]:
                    continue
                seen[y, x] = True
                alpha[y, x] = 0
                dq.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
            rgba = np.dstack([np.clip(q, 0, 255).astype(np.uint8), alpha])
            # 투명 여백 자르기
            ys_, xs_ = np.nonzero(alpha)
            if len(xs_) == 0:
                continue
            rgba = rgba[ys_.min():ys_.max() + 1, xs_.min():xs_.max() + 1]
            idx = len(results)
            fn = f'{name}_{idx:02d}.png'
            Image.fromarray(rgba, 'RGBA').save(os.path.join(out_dir, fn))
            results.append({'file': fn, 'part': name, 'box': [int(bx0), int(by0 + y0), int(bx1), int(by1 + y0)], 'scale': round(float(s), 2), 'size': [int(rgba.shape[1]), int(rgba.shape[0])]})
    with open(os.path.join(out_dir, 'index.json'), 'w') as f:
        json.dump(results, f, indent=1)
    return results


if __name__ == '__main__':
    r = clean(sys.argv[1], sys.argv[2], '--debug' in sys.argv)
    for x in r:
        print(x)
