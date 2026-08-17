#!/usr/bin/env python3
"""把图片压缩为指定体积上限内的 JPEG：quality 从起始值递减，直到达标或触下限。

为什么按体积而非固定 quality：社交分享图等场景有硬性 KB 上限（如仓库 README 图 ≤500KB），
固定 quality 对暗色夜景与明亮复杂场景的产出体积差异极大，只有按结果反馈递减才可靠。
progressive + optimize 对网页加载与压缩率都更优，恒开。
"""
import argparse
import os
import sys

from PIL import Image


def main():
    p = argparse.ArgumentParser(description="压缩 JPEG 至 --max-kb 以内")
    p.add_argument("--input", required=True, help="源图片路径")
    p.add_argument("--out", required=True, help="输出 .jpg 路径")
    p.add_argument("--max-kb", type=int, default=500, help="体积上限 KB（默认 500）")
    p.add_argument("--quality-start", type=int, default=88, help="起始 quality（默认 88）")
    p.add_argument("--quality-min", type=int, default=40, help="quality 下限（默认 40）")
    p.add_argument("--step", type=int, default=5, help="每轮递减步长（默认 5）")
    args = p.parse_args()

    img = Image.open(args.input).convert("RGB")
    limit = args.max_kb * 1024

    q = args.quality_start
    while q >= args.quality_min:
        img.save(args.out, "JPEG", quality=q, progressive=True, optimize=True)
        size = os.path.getsize(args.out)
        if size <= limit:
            print(f"{args.out}: {img.size} q={q} {size / 1024:.0f}KB")
            return
        q -= args.step

    print(
        f"WARN {args.out}: 降至 quality 下限 {args.quality_min} 仍为 "
        f"{os.path.getsize(args.out) / 1024:.0f}KB > {args.max_kb}KB，"
        "需缩小尺寸或改用更低上限",
        file=sys.stderr,
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
