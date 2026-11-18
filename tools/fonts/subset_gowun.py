#!/usr/bin/env python3
"""고운 바탕(Gowun Batang, OFL) 을 자주 쓰는 한글 2,350자 + 영문으로 줄여 woff2 로 (프로필 책 글꼴).

  python3 tools/fonts/subset_gowun.py   # 원본 ttf 는 client/assets/fonts/ 에 잠깐 두고 돌린 뒤 지움
"""
import os
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONTS = os.path.join(ROOT, 'client', 'assets', 'fonts')
chars = set(chr(c) for c in range(0x20, 0x7F))
for hi in range(0xB0, 0xC9):
    for lo in range(0xA1, 0xFF):
        try: chars.add(bytes([hi, lo]).decode('euc-kr'))
        except UnicodeDecodeError: pass
chars.update('·…‘’“”「」『』《》〈〉←→↑↓★☆♡♥※○●◇◆□■△▲▽▼~—–°±×÷ⅠⅡⅢ')
text = ''.join(sorted(chars))
for name in ('GowunBatang-Regular', 'GowunBatang-Bold'):
    src, out = os.path.join(FONTS, name + '.ttf'), os.path.join(FONTS, name + '.sub.woff2')
    opts = subset.Options(); opts.flavor = 'woff2'; opts.layout_features = ['*']; opts.notdef_outline = True
    font = subset.load_font(src, opts); sub = subset.Subsetter(opts); sub.populate(text=text); sub.subset(font); subset.save_font(font, out, opts)
    print(name, os.path.getsize(out) // 1024, 'KB')
