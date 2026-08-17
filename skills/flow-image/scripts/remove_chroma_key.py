#!/usr/bin/env python3
"""移除图像中的纯色色键背景。

该辅助脚本支撑 imagegen 技能的内置优先透明工作流：
先在纯色色键上生成图像，然后将该色键颜色转换为 Alpha 通道。
"""

from __future__ import annotations

import argparse
from io import BytesIO
from pathlib import Path
import re
from statistics import median
import sys
from typing import Tuple


Color = Tuple[int, int, int]
KEY_DOMINANCE_THRESHOLD = 16.0
ALPHA_NOISE_FLOOR = 8


def _die(message: str, code: int = 1) -> None:
    print(f"错误：{message}", file=sys.stderr)
    raise SystemExit(code)


def _dependency_hint(package: str) -> str:
    return (
        "请先激活仓库选定的环境，然后使用 "
        f"`uv pip install {package}` 安装。如果该仓库使用本地虚拟环境，先执行 "
        "`source .venv/bin/activate`；否则使用本仓库配置的共享降级环境。"
    )


def _load_pillow():
    try:
        from PIL import Image, ImageFilter
    except ImportError:
        _die(f"色键移除需要 Pillow。{_dependency_hint('pillow')}")
    return Image, ImageFilter


def _parse_key_color(raw: str) -> Color:
    value = raw.strip()
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", value)
    if not match:
        _die("色键颜色必须是十六进制 RGB 值，例如 #00ff00。")
    hex_value = match.group(1)
    return (
        int(hex_value[0:2], 16),
        int(hex_value[2:4], 16),
        int(hex_value[4:6], 16),
    )


def _validate_args(args: argparse.Namespace) -> None:
    if args.tolerance < 0 or args.tolerance > 255:
        _die("--tolerance 必须在 0 到 255 之间。")
    if args.transparent_threshold < 0 or args.transparent_threshold > 255:
        _die("--transparent-threshold 必须在 0 到 255 之间。")
    if args.opaque_threshold < 0 or args.opaque_threshold > 255:
        _die("--opaque-threshold 必须在 0 到 255 之间。")
    if args.soft_matte and args.transparent_threshold >= args.opaque_threshold:
        _die("--transparent-threshold 必须小于 --opaque-threshold。")
    if args.edge_feather < 0 or args.edge_feather > 64:
        _die("--edge-feather 必须在 0 到 64 之间。")
    if args.edge_contract < 0 or args.edge_contract > 16:
        _die("--edge-contract 必须在 0 到 16 之间。")

    src = Path(args.input)
    if not src.exists():
        _die(f"未找到输入图像：{src}")

    out = Path(args.out)
    if out.exists() and not args.force:
        _die(f"输出已存在：{out}（使用 --force 覆盖）")

    if out.suffix.lower() not in {".png", ".webp"}:
        _die("--out 必须以 .png 或 .webp 结尾，以保留 Alpha 通道。")


def _channel_distance(a: Color, b: Color) -> int:
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]))


def _clamp_channel(value: float) -> int:
    return max(0, min(255, int(round(value))))


def _smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def _soft_alpha(distance: int, transparent_threshold: float, opaque_threshold: float) -> int:
    if distance <= transparent_threshold:
        return 0
    if distance >= opaque_threshold:
        return 255
    ratio = (float(distance) - transparent_threshold) / (
        opaque_threshold - transparent_threshold
    )
    return _clamp_channel(255.0 * _smoothstep(ratio))


def _dominance_alpha(rgb: Color, key: Color) -> int:
    spill_channels = _spill_channels(key)
    if not spill_channels:
        return 255

    channels = [float(value) for value in rgb]
    non_spill = [idx for idx in range(3) if idx not in spill_channels]
    key_strength = (
        min(channels[idx] for idx in spill_channels)
        if len(spill_channels) > 1
        else channels[spill_channels[0]]
    )
    non_key_strength = max((channels[idx] for idx in non_spill), default=0.0)
    dominance = key_strength - non_key_strength
    if dominance <= 0:
        return 255

    denominator = max(1.0, float(max(key)) - non_key_strength)
    alpha = 1.0 - min(1.0, dominance / denominator)
    return _clamp_channel(alpha * 255.0)


def _spill_channels(key: Color) -> list[int]:
    key_max = max(key)
    if key_max < 128:
        return []
    return [idx for idx, value in enumerate(key) if value >= key_max - 16 and value >= 128]


def _key_channel_dominance(rgb: Color, key: Color) -> float:
    spill_channels = _spill_channels(key)
    if not spill_channels:
        return 0.0

    channels = [float(value) for value in rgb]
    non_spill = [idx for idx in range(3) if idx not in spill_channels]
    key_strength = (
        min(channels[idx] for idx in spill_channels)
        if len(spill_channels) > 1
        else channels[spill_channels[0]]
    )
    non_key_strength = max((channels[idx] for idx in non_spill), default=0.0)
    return key_strength - non_key_strength


def _looks_key_colored(rgb: Color, key: Color, distance: int) -> bool:
    if distance <= 32:
        return True

    spill_channels = _spill_channels(key)
    if not spill_channels:
        return True

    return _key_channel_dominance(rgb, key) >= KEY_DOMINANCE_THRESHOLD


def _cleanup_spill(rgb: Color, key: Color, alpha: int = 255) -> Color:
    if alpha >= 252:
        return rgb

    spill_channels = _spill_channels(key)
    if not spill_channels:
        return rgb

    channels = [float(value) for value in rgb]
    non_spill = [idx for idx in range(3) if idx not in spill_channels]
    if non_spill:
        anchor = max(channels[idx] for idx in non_spill)
        cap = max(0.0, anchor - 1.0)
        for idx in spill_channels:
            if channels[idx] > cap:
                channels[idx] = cap

    return (
        _clamp_channel(channels[0]),
        _clamp_channel(channels[1]),
        _clamp_channel(channels[2]),
    )


def _apply_alpha_to_image(
    image,
    *,
    key: Color,
    tolerance: int,
    spill_cleanup: bool,
    soft_matte: bool,
    transparent_threshold: float,
    opaque_threshold: float,
) -> int:
    pixels = image.load()
    width, height = image.size
    transparent = 0

    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            rgb = (red, green, blue)
            distance = _channel_distance(rgb, key)
            key_like = _looks_key_colored(rgb, key, distance)
            output_alpha = (
                min(
                    _soft_alpha(distance, transparent_threshold, opaque_threshold),
                    _dominance_alpha(rgb, key),
                )
                if soft_matte and key_like
                else (0 if distance <= tolerance else 255)
            )
            output_alpha = int(round(output_alpha * (alpha / 255.0)))
            if 0 < output_alpha <= ALPHA_NOISE_FLOOR:
                output_alpha = 0

            if output_alpha == 0:
                pixels[x, y] = (0, 0, 0, 0)
                transparent += 1
                continue

            if spill_cleanup and key_like:
                red, green, blue = _cleanup_spill(rgb, key, output_alpha)
            pixels[x, y] = (red, green, blue, output_alpha)

    return transparent


def _contract_alpha(image, pixels: int):
    if pixels == 0:
        return image

    _, ImageFilter = _load_pillow()
    alpha = image.getchannel("A")
    for _ in range(pixels):
        alpha = alpha.filter(ImageFilter.MinFilter(3))
    image.putalpha(alpha)
    return image


def _apply_edge_feather(image, radius: float):
    if radius == 0:
        return image

    _, ImageFilter = _load_pillow()
    alpha = image.getchannel("A")
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=radius))
    image.putalpha(alpha)
    return image


def _encode_image(image, output_format: str) -> bytes:
    out = BytesIO()
    image.save(out, format=output_format.upper())
    return out.getvalue()


def _alpha_counts(image) -> tuple[int, int, int]:
    pixels = image.load()
    width, height = image.size
    total = 0
    transparent = 0
    partial = 0

    for y in range(height):
        for x in range(width):
            alpha = pixels[x, y][3]
            total += 1
            if alpha == 0:
                transparent += 1
            elif alpha < 255:
                partial += 1

    return total, transparent, partial


def _sample_border_key(image, mode: str) -> Color:
    width, height = image.size
    pixels = image.load()
    samples: list[Color] = []

    if mode == "corners":
        patch = max(1, min(width, height, 12))
        boxes = [
            (0, 0, patch, patch),
            (width - patch, 0, width, patch),
            (0, height - patch, patch, height),
            (width - patch, height - patch, width, height),
        ]
        for left, top, right, bottom in boxes:
            for y in range(top, bottom):
                for x in range(left, right):
                    red, green, blue = pixels[x, y][:3]
                    samples.append((red, green, blue))
    else:
        band = max(1, min(width, height, 6))
        step = max(1, min(width, height) // 256)
        for x in range(0, width, step):
            for y in range(band):
                red, green, blue = pixels[x, y][:3]
                samples.append((red, green, blue))
                red, green, blue = pixels[x, height - 1 - y][:3]
                samples.append((red, green, blue))
        for y in range(0, height, step):
            for x in range(band):
                red, green, blue = pixels[x, y][:3]
                samples.append((red, green, blue))
                red, green, blue = pixels[width - 1 - x, y][:3]
                samples.append((red, green, blue))

    if not samples:
        _die("无法从图像边缘采样背景色键颜色。")

    return (
        int(round(median(sample[0] for sample in samples))),
        int(round(median(sample[1] for sample in samples))),
        int(round(median(sample[2] for sample in samples))),
    )


def _remove_chroma_key(args: argparse.Namespace) -> None:
    Image, _ = _load_pillow()
    src = Path(args.input)
    out = Path(args.out)

    with Image.open(src) as image:
        rgba = image.convert("RGBA")
    key = (
        _sample_border_key(rgba, args.auto_key)
        if args.auto_key != "none"
        else _parse_key_color(args.key_color)
    )

    transparent = _apply_alpha_to_image(
        rgba,
        key=key,
        tolerance=args.tolerance,
        spill_cleanup=args.spill_cleanup,
        soft_matte=args.soft_matte,
        transparent_threshold=args.transparent_threshold,
        opaque_threshold=args.opaque_threshold,
    )
    rgba = _contract_alpha(rgba, args.edge_contract)
    rgba = _apply_edge_feather(rgba, args.edge_feather)

    total, transparent_after, partial_after = _alpha_counts(rgba)

    out.parent.mkdir(parents=True, exist_ok=True)
    output_format = "PNG" if out.suffix.lower() == ".png" else "WEBP"
    out.write_bytes(_encode_image(rgba, output_format))

    print(f"已写入 {out}")
    print(f"色键颜色：#{key[0]:02x}{key[1]:02x}{key[2]:02x}")
    print(f"透明像素：{transparent_after}/{total}")
    print(f"半透明像素：{partial_after}/{total}")
    if transparent == 0:
        print("警告：羽化前没有像素匹配色键颜色。", file=sys.stderr)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="移除纯色色键背景并写入带 Alpha 通道的图像。"
    )
    parser.add_argument("--input", required=True, help="输入图像路径。")
    parser.add_argument("--out", required=True, help="输出 .png 或 .webp 路径。")
    parser.add_argument(
        "--key-color",
        default="#00ff00",
        help="要移除的十六进制 RGB 色键颜色，例如 #00ff00。",
    )
    parser.add_argument(
        "--tolerance",
        type=int,
        default=12,
        help="硬色键逐通道容差，0-255。",
    )
    parser.add_argument(
        "--auto-key",
        choices=["none", "corners", "border"],
        default="none",
        help="从图像角落或边缘采样色键颜色，而不是使用 --key-color。",
    )
    parser.add_argument(
        "--soft-matte",
        action="store_true",
        help="在透明与不透明阈值之间使用平滑 Alpha 渐变。",
    )
    parser.add_argument(
        "--transparent-threshold",
        type=float,
        default=12.0,
        help="软遮罩距离低于等于该值时像素完全透明。",
    )
    parser.add_argument(
        "--opaque-threshold",
        type=float,
        default=96.0,
        help="软遮罩距离高于等于该值时像素完全不透明。",
    )
    parser.add_argument(
        "--edge-feather",
        type=float,
        default=0.0,
        help="可选的 Alpha 模糊半径，用于柔化边缘，0-64。",
    )
    parser.add_argument(
        "--edge-contract",
        type=int,
        default=0,
        help="在羽化前按指定像素数收缩可见 Alpha 遮罩。",
    )
    parser.add_argument(
        "--spill-cleanup",
        dest="spill_cleanup",
        action="store_true",
        help="减少不透明像素上明显的色键溢色。",
    )
    parser.add_argument(
        "--despill",
        dest="spill_cleanup",
        action="store_true",
        help="--spill-cleanup 的别名；去除边缘色键溢色。",
    )
    parser.add_argument("--force", action="store_true", help="覆盖已存在的输出文件。")
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    _validate_args(args)
    _remove_chroma_key(args)


if __name__ == "__main__":
    main()
