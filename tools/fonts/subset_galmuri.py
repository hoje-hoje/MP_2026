#!/usr/bin/env python3
"""갈무리 글꼴을 자주 쓰는 글자만 남겨 가볍게 만든다 (첫 접속 속도용).

남기는 글자: 영문·숫자·기호, 자주 쓰는 한글 2,350자(KS X 1001), 한글 자모, 게임 화면(client/)에 실제로 나오는 모든 글자.
드문 글자는 원본 글꼴이 자동으로 이어받는다 (index.html 의 unicode-range).

  pip install fonttools brotli
  python3 tools/fonts/subset_galmuri.py
"""
import glob
import os
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONTS = os.path.join(ROOT, 'client', 'assets', 'fonts')

chars = set(chr(c) for c in range(0x20, 0x7F))
for hi in range(0xB0, 0xC9):           # KS X 1001 한글 2,350자
    for lo in range(0xA1, 0xFF):
        try:
            chars.add(bytes([hi, lo]).decode('euc-kr'))
        except UnicodeDecodeError:
            pass
chars.update(chr(c) for c in range(0x3131, 0x318F))  # 한글 자모 ㄱ~ㅣ
chars.update('·…‘’“”「」『』《》〈〉【】←→↑↓↔★☆♡♥※○●◎◇◆□■△▲▽▼~—–°±×÷≤≥≠∞√π∑∫')
for f in glob.glob(os.path.join(ROOT, 'client', '*.*')) + glob.glob(os.path.join(ROOT, 'server', 'puzzles.sample.json')):
    if f.endswith(('.html', '.js', '.json')):
        chars.update(open(f, encoding='utf-8').read())
text = ''.join(sorted(c for c in chars if c.isprintable()))

for name in ('Galmuri11', 'Galmuri11-Bold'):
    src, out = os.path.join(FONTS, name + '.woff2'), os.path.join(FONTS, name + '.sub.woff2')
    opts = subset.Options(); opts.flavor = 'woff2'; opts.layout_features = ['*']; opts.name_IDs = ['*']; opts.notdef_outline = True
    font = subset.load_font(src, opts)
    sub = subset.Subsetter(opts); sub.populate(text=text); sub.subset(font)
    subset.save_font(font, out, opts)
    print(f'{name}: {os.path.getsize(src)//1024}KB -> {os.path.getsize(out)//1024}KB')
