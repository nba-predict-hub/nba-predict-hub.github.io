#!/usr/bin/env python3
"""生成 App 图标和 iOS 启动画面：SVG 用本机 Chrome（Playwright）渲染成 PNG，免费、可重复运行。
用法：python3 tools/make_icons.py   输出到 icons/"""
import asyncio, os
from playwright.async_api import async_playwright
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")

def icon_svg(safe=1.0, round_=True):
    # safe<1：图形缩到中间（maskable 要求主体在 80% 安全区内）；背景始终铺满
    s = safe; t = (1 - s) * 256
    rx = 112 if round_ else 0
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
 <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a2b5c"/><stop offset=".55" stop-color="#0b1330"/><stop offset="1" stop-color="#050814"/></linearGradient>
 <radialGradient id="ball" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#ffb057"/><stop offset=".55" stop-color="#f2711c"/><stop offset="1" stop-color="#a8400a"/></radialGradient>
 <linearGradient id="ln" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2f7bff"/><stop offset="1" stop-color="#33e1ff"/></linearGradient>
 <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
 <radialGradient id="halo" cx=".5" cy=".45" r=".5"><stop offset="0" stop-color="#33e1ff" stop-opacity=".28"/><stop offset="1" stop-color="#33e1ff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="512" height="512" rx="{rx}" fill="url(#bg)"/>
<circle cx="256" cy="236" r="230" fill="url(#halo)"/>
<g transform="translate({t} {t}) scale({s})">
 <g opacity=".14" stroke="#8fb4ff" stroke-width="3"><path d="M60 400H452M60 330H452M60 260H452"/></g>
 <circle cx="236" cy="226" r="126" fill="url(#ball)"/>
 <g fill="none" stroke="#3a1604" stroke-width="9" stroke-linecap="round" opacity=".85">
  <path d="M110 226H362"/><path d="M236 100V352"/>
  <path d="M147 137C196 180 196 272 147 315"/><path d="M325 137C276 180 276 272 325 315"/>
 </g>
 <circle cx="236" cy="226" r="126" fill="none" stroke="#ffd2a1" stroke-opacity=".35" stroke-width="3"/>
 <path d="M86 392L180 318L246 352L352 236L420 176" fill="none" stroke="url(#ln)" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
 <path d="M372 160L438 152L430 218Z" fill="#33e1ff" filter="url(#glow)"/>
 <circle cx="246" cy="352" r="13" fill="#e9fbff"/><circle cx="180" cy="318" r="13" fill="#e9fbff"/>
</g>
</svg>'''

SPLASH = [(430, 932, 3), (393, 852, 3), (428, 926, 3), (390, 844, 3), (375, 812, 3), (414, 896, 3), (414, 896, 2), (375, 667, 2), (440, 956, 3), (402, 874, 3)]
SITE = os.environ.get("SITE", "http://127.0.0.1:8942/")  # 本地静态服务器；启动图直接截首屏（和“点一下进入”首屏同一画面）

async def main():
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, "icon.svg"), "w").write(icon_svg(1.0, True))
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        async def shot(html, w, h, scale, path, transparent=False):
            pg = await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=scale)
            await pg.set_content(html); await pg.wait_for_timeout(150)
            await pg.screenshot(path=path, omit_background=transparent); await pg.close()
        def page(svg, px): return '<html><body style="margin:0;background:transparent">' + svg.replace('width="512" height="512"', 'width="%d" height="%d"' % (px, px)) + '</body></html>'
        await shot(page(icon_svg(1.0, True), 192), 192, 192, 1, os.path.join(OUT, "icon-192.png"), True)
        await shot(page(icon_svg(1.0, True), 512), 512, 512, 1, os.path.join(OUT, "icon-512.png"), True)
        await shot(page(icon_svg(0.8, False), 512), 512, 512, 1, os.path.join(OUT, "maskable-512.png"))
        await shot(page(icon_svg(1.0, False), 180), 180, 180, 1, os.path.join(OUT, "apple-touch-icon.png"))  # iOS 自己切圆角，不留透明
        for w, h, r in SPLASH:
            pg = await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=r)
            await pg.route("**/*.json*", lambda rt: rt.abort())
            await pg.goto(SITE); await pg.evaluate("document.documentElement.classList.add('splash-static')"); await pg.wait_for_timeout(300)
            await pg.screenshot(path=os.path.join(OUT, "splash-%dx%d.png" % (w * r, h * r))); await pg.close()
        await b.close()
    print("ok", sorted(os.listdir(OUT)))

if __name__ == "__main__":
    asyncio.run(main())
