"""生成 Ai Lubricant 品牌图标（对齐 user-frontend/public/ai-lubricant.svg）。

移动端不方便直接用 SVG 当 app 图标/启动图，这里用 Pillow 把同一套品牌图形
（深绿圆角底 + 亮绿油滴 + 镂空 A）渲染成 Expo 需要的各尺寸 PNG。

用法：python scripts/gen-brand-assets.py
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")

# 与 ai-lubricant.svg 完全一致的取色
DARK = (16, 35, 27, 255)      # #10231b 底色 / 字色
GREEN = (124, 242, 156, 255)  # #7cf29c 油滴
WHITE = (255, 255, 255, 255)
SPLASH_DARK_BG = (11, 11, 14, 255)  # #0b0b0e 深色启动图背景


def _s(v: float, k: float) -> float:
    """把 64 基准视口的坐标缩放到目标尺寸。"""
    return v * k / 64.0


def draw_droplet(d: ImageDraw.ImageDraw, k: float, fill) -> None:
    """油滴外形：顶部收尖 + 底部圆弧，对齐 SVG 的 path。"""
    # 底部圆：cx=32 cy=38.2 r=16
    d.ellipse(
        [_s(16, k), _s(22.2, k), _s(48, k), _s(54.2, k)],
        fill=fill,
    )
    # 顶部尖：(32,9) 到底部圆两侧切点
    d.polygon(
        [
            (_s(32, k), _s(9, k)),
            (_s(17.4, k), _s(34, k)),
            (_s(46.6, k), _s(34, k)),
        ],
        fill=fill,
    )


def draw_letter_a(d: ImageDraw.ImageDraw, k: float, fill) -> None:
    """镂空字母 A：两条斜边 + 横杠，对齐 SVG 第三个 path。"""
    lw = max(1, int(_s(3.1, k)))
    apex = (_s(32, k), _s(20, k))
    left = (_s(23, k), _s(43, k))
    right = (_s(41, k), _s(43, k))
    d.line([apex, left], fill=fill, width=lw)
    d.line([apex, right], fill=fill, width=lw)
    # 横杠
    d.line(
        [(_s(26.6, k), _s(35.6, k)), (_s(37.4, k), _s(35.6, k))],
        fill=fill,
        width=lw,
    )


def brand_icon(size: int, *, bg=DARK, rounded: bool = True, margin: float = 0.0) -> Image.Image:
    """完整品牌图标：圆角底 + 油滴 + 镂空 A。margin 为四周留白比例。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    inner = int(size * (1 - margin * 2))
    off = (size - inner) // 2
    layer = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)

    if bg is not None:
        if rounded:
            ld.rounded_rectangle([0, 0, inner - 1, inner - 1], radius=int(inner * 0.25), fill=bg)
        else:
            ld.rectangle([0, 0, inner - 1, inner - 1], fill=bg)

    draw_droplet(ld, inner, GREEN)
    draw_letter_a(ld, inner, DARK if bg is not None else DARK)

    img.paste(layer, (off, off), layer)
    return img


def brand_glyph(size: int, color) -> Image.Image:
    """无底色的纯图形（透明底），用于登录页 / 关于页的 logo。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_droplet(d, size, color)
    # 在纯图形上，A 用背景色镂空效果不成立，改用深色描边保证可读
    draw_letter_a(d, size, DARK)
    return img


def save(img: Image.Image, name: str) -> None:
    path = os.path.normpath(os.path.join(ASSETS, name))
    img.save(path, "PNG", optimize=True)
    print(f"  {name}  {img.size[0]}x{img.size[1]}")


def main() -> None:
    print("生成 Ai Lubricant 品牌图标：")

    # App 图标（iOS light / dark、通用）
    save(brand_icon(1024), "icon.png")
    save(brand_icon(1024, bg=SPLASH_DARK_BG), "icon-dark.png")

    # Android 自适应图标前景：需要四周留白，系统会裁切
    save(brand_icon(1024, bg=None, margin=0.18), "adaptive-icon.png")

    # 网页 favicon
    save(brand_icon(96), "favicon.png")

    # 登录页 / 关于页 logo：透明底纯图形
    save(brand_glyph(512, GREEN), "logo-light.png")
    save(brand_glyph(512, GREEN), "logo-dark.png")

    # 启动图：透明底，由 app.json 的 backgroundColor 兜底
    save(brand_icon(512, bg=None, margin=0.06), "splash.png")
    save(brand_icon(512, bg=None, margin=0.06), "splash-dark.png")

    print("完成。")


if __name__ == "__main__":
    main()
