from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import math
OUT='/home/user/mp_2026/client/assets/logo/'
def text_path(fontfile, text, size, cx, base, sp=0, big=None):
    f=TTFont(fontfile); gs=f.getGlyphSet(); cmap=f.getBestCmap(); upm=f['head'].unitsPerEm; hmtx=f['hmtx']
    items=[]; total=0
    for i,ch in enumerate(text):
        s=size*(big.get(i,1) if big else 1)/upm
        if ch==' ': adv=size*0.32; items.append((None,s,adv)); total+=adv+sp; continue
        gn=cmap[ord(ch)]; adv=hmtx[gn][0]*s; items.append((gn,s,adv)); total+=adv+sp
    total-=sp; x=cx-total/2; d=''
    for gn,s,adv in items:
        if gn:
            pen=SVGPathPen(gs); tp=TransformPen(pen,(s,0,0,-s,x,base)); gs[gn].draw(tp); d+=pen.getCommands()
        x+=adv+sp
    return d, total
W,H=1520,560; cx=W/2
main,mw=text_path(__import__('os').path.join(__import__('os').path.dirname(__file__),'cdeco900.ttf'),'MATH WORLD',118,cx,322,sp=5,big={0:1.24,5:1.24})
top,tw=text_path(__import__('os').path.join(__import__('os').path.dirname(__file__),'cinzel700.ttf'),'THE ADVENTURES OF',30,cx,168,sp=9)
sub,sw=text_path(__import__('os').path.join(__import__('os').path.dirname(__file__),'cinzel700.ttf'),'A MATH PUZZLE RPG',28,cx,402,sp=10)
def star(x,y,R,r,n=4,rot=-90):
    pts=[]
    for k in range(n*2):
        a=math.radians(rot+k*180/n); rr=R if k%2==0 else r; pts.append(f'{x+rr*math.cos(a):.1f},{y+rr*math.sin(a):.1f}')
    return 'M'+' L'.join(pts)+'Z'
orn=[]
# 위 나침반 별: 길쭉한 4각 별 + 작은 대각 별 + 고리
orn.append(star(cx,72,58,9)); orn.append(star(cx,72,26,5,4,-45))
orn.append(f'M{cx-1.5},10 L{cx+1.5},10 L{cx+1.5},120 L{cx-1.5},120Z')
ring=f'M{cx+15},72 A15,15 0 1,1 {cx-15},72 A15,15 0 1,1 {cx+15},72Z M{cx+11},72 A11,11 0 1,0 {cx-11},72 A11,11 0 1,0 {cx+11},72Z'

# 위 작은 글자 양옆 가는 선 + 마름모
L1=cx-tw/2-24; R1=cx+tw/2+24
orn.append(f'M{L1-150},157 L{L1},156 L{L1},158 L{L1-150},157Z M{R1},156 L{R1+150},157 L{R1},158Z')
orn.append(star(L1-158,157,7,3,4,0)); orn.append(star(R1+158,157,7,3,4,0))
# 아래 띠: 두 줄 사이에 부제
yb1, yb2 = 360, 420
orn.append(f'M{cx-520},{yb1} L{cx+520},{yb1-1.2} L{cx+520},{yb1+1.2}Z'.replace(f'{cx+520},{yb1+1.2}Z',f'{cx+520},{yb1+1.2} L{cx-520},{yb1}Z'))
orn.append(f'M{cx-520},{yb1} L{cx},{yb1-2.5} L{cx+520},{yb1} L{cx},{yb1+2.5}Z')
L2=cx-sw/2-26; R2=cx+sw/2+26
orn.append(f'M{cx-430},{yb2-10} L{L2},{yb2-11.5} L{L2},{yb2-8.5}Z M{R2},{yb2-11.5} L{cx+430},{yb2-10} L{R2},{yb2-8.5}Z')
orn.append(star(L2-8,yb2-10,9,3,4,0)); orn.append(star(R2+8,yb2-10,9,3,4,0))
# 아래 작은 나침반
orn.append(star(cx,470,34,6)); orn.append(star(cx,470,14,3,4,-45)); orn.append(f'M{cx-1.2},432 L{cx+1.2},432 L{cx+1.2},540 L{cx-1.2},540Z')
# 양옆 뿔 장식 (휘어진 칼날)
lx=cx-mw/2-30; rx=cx+mw/2+30
def blade(x,y,dirx):
    s=dirx*0.78
    return (f'M{x},{y-40} C{x-s*70},{y-70} {x-s*150},{y-30} {x-s*210},{y+10} '
            f'C{x-s*150},{y-8} {x-s*90},{y-20} {x-s*40},{y+5} '
            f'C{x-s*80},{y+10} {x-s*120},{y+40} {x-s*150},{y+70} '
            f'C{x-s*100},{y+30} {x-s*50},{y+20} {x},{y+30} Z')
orn.append(blade(lx,280,1)); orn.append(blade(rx,280,-1))
orn.append(star(lx-182,292,14,3.5)); orn.append(star(rx+182,292,14,3.5))
orn.append(star(lx-120,195,9,2.5)); orn.append(star(rx+120,195,9,2.5)); orn.append(star(lx-90,370,7,2)); orn.append(star(rx+90,370,7,2))
ornd=' '.join(orn)
def svg(fill_main, fill_orn, extra_defs='', filt=''):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<defs>{extra_defs}</defs>
<g {filt}>
<path d="{ornd}" fill="{fill_orn}" fill-rule="evenodd"/>
<circle cx="{cx}" cy="72" r="14" fill="none" stroke="{fill_orn}" stroke-width="3"/>
<path d="{top}" fill="{fill_orn}"/>
<path d="{sub}" fill="{fill_orn}"/>
<path d="{main}" fill="{fill_main}"/>
</g></svg>'''
open(OUT+'logo_black.svg','w').write(svg('#121014','#121014'))
gold='<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4c9"/><stop offset=".45" stop-color="#f2c45a"/><stop offset=".55" stop-color="#c8862a"/><stop offset="1" stop-color="#ffe08a"/></linearGradient><filter id="o" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="dilate" radius="3" result="d"/><feFlood flood-color="#2a1608"/><feComposite in2="d" operator="in" result="ol"/><feOffset in="ol" dy="5" result="sh"/><feMerge><feMergeNode in="sh"/><feMergeNode in="ol"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
open(OUT+'logo_gold.svg','w').write(svg('url(#g)','url(#g)',gold,'filter="url(#o)"'))
glow='<filter id="w" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="8" result="b"/><feFlood flood-color="#b57bff" flood-opacity=".8"/><feComposite in2="b" operator="in" result="gl"/><feMerge><feMergeNode in="gl"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
open(OUT+'logo_white.svg','w').write(svg('#ffffff','#efe6ff',glow,'filter="url(#w)"'))
print('ok', mw)
