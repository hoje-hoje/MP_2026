#!/usr/bin/env python3
"""MP 2026 1회용 쿠폰 코드 생성기 (운영진 전용).

점심시간 오프라인 활동(신의 시험, 보물찾기 등)에서 나눠 줄 코드를 만든다.
코드는 한 번 쓰면 모두에게 사라진다(서버가 확인).

  python3 tools/coupons/gen_coupons.py --count 40 --reward coin:1000 --tag D2-시험

결과 (tools/coupons/out/, git에 올라가지 않음):
  <tag>.csv        코드 목록 (서버에 넣을 원본)
  <tag>_cards.html 인쇄용 카드 (브라우저에서 열어 인쇄)

⚠ 저장소가 공개이므로 진짜 코드는 절대 커밋하지 않는다.
"""
import argparse
import csv
import html
import os
import secrets

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # 헷갈리는 0/O, 1/I/L 제외
REWARD_NAMES = {"coin": "코인", "army": "병력", "vaccine": "백신"}


def make_code():
    body = "".join(secrets.choice(ALPHABET) for _ in range(8))
    return f"MP-{body[:4]}-{body[4:]}"


def parse_reward(s):
    out = {}
    for part in s.split(","):
        k, v = part.split(":")
        if k not in REWARD_NAMES:
            raise SystemExit(f"알 수 없는 보상: {k} (coin, army, vaccine 중 하나)")
        out[k] = int(v)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=30)
    ap.add_argument("--reward", default="coin:1000", help="예: coin:1000 또는 army:30,coin:500")
    ap.add_argument("--tag", default="batch", help="묶음 이름 (예: D2-시험, D3-보물찾기)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "out"))
    args = ap.parse_args()

    reward = parse_reward(args.reward)
    os.makedirs(args.out, exist_ok=True)
    codes = set()
    while len(codes) < args.count:
        codes.add(make_code())
    codes = sorted(codes)

    with open(os.path.join(args.out, f"{args.tag}.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["code", "tag"] + list(REWARD_NAMES))
        for c in codes:
            w.writerow([c, args.tag] + [reward.get(k, 0) for k in REWARD_NAMES])

    label = " · ".join(f"{REWARD_NAMES[k]} +{v}" for k, v in reward.items())
    cards = "\n".join(
        f'<div class="c"><div class="t">MP 2026 · 신의 선물</div><div class="k">{html.escape(c)}</div>'
        f'<div class="r">{html.escape(label)}</div><div class="n">게임에서 [쿠폰]을 눌러 입력 · 한 번만 사용 가능</div></div>'
        for c in codes
    )
    page = f"""<!doctype html><html lang="ko"><meta charset="utf-8"><title>{html.escape(args.tag)} 쿠폰</title>
<style>
body{{margin:12mm;font-family:'Noto Sans KR',sans-serif;color:#2b2340}}
.g{{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}}
.c{{border:2px dashed #2b2340;border-radius:4mm;padding:4mm;text-align:center;break-inside:avoid}}
.t{{font-size:9pt;font-weight:700;color:#6b4fb3}}
.k{{font-size:17pt;font-weight:700;letter-spacing:1.5px;margin:2mm 0;font-family:monospace}}
.r{{font-size:11pt;font-weight:700}}
.n{{font-size:7.5pt;color:#5f5877;margin-top:1mm}}
</style><div class="g">{cards}</div></html>"""
    with open(os.path.join(args.out, f"{args.tag}_cards.html"), "w", encoding="utf-8") as f:
        f.write(page)
    print(f"{len(codes)}개 생성 → {args.out}/{args.tag}.csv, {args.tag}_cards.html ({label})")


if __name__ == "__main__":
    main()
