"""runner apply_preamble 行为规格：前言按审查风格分叉，deep / no-preamble 恒不注入。

前言是对抗发散审查风格的落地锚点——需求理解类产物（需求树拆解 / UltraThoughts /
决策台账）的风险形态是盲区与理解偏差，light sanity check 框定会把审查压成
低信息量阴性结论；分叉注入错档等于风格名存实亡。
"""

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

spec = importlib.util.spec_from_file_location("run_external_review", SCRIPTS / "run-external-review.py")
rer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rer)


class TestApplyPreambleByStyle(unittest.TestCase):
    def test_orthogonal_default_injects_light_preamble(self):
        out = rer.apply_preamble("PROMPT", "orthogonal", deep=False, no_preamble=False)
        self.assertTrue(out.startswith("【审查模式：light 正交审查】"))
        self.assertTrue(out.endswith("PROMPT"))

    def test_adversarial_injects_adversarial_preamble(self):
        out = rer.apply_preamble("PROMPT", "adversarial", deep=False, no_preamble=False)
        self.assertTrue(out.startswith("【审查模式：对抗发散审查】"))
        self.assertIn("证伪", out)
        self.assertIn("发散", out)
        self.assertTrue(out.endswith("PROMPT"))

    def test_deep_skips_preamble_regardless_of_style(self):
        for style in ("orthogonal", "adversarial"):
            self.assertEqual(
                rer.apply_preamble("PROMPT", style, deep=True, no_preamble=False),
                "PROMPT",
            )

    def test_no_preamble_skips_injection_keeps_style_flag_only(self):
        # 流程驱动审查跳过注入：--style adversarial 此时仅作 JSON 记录的风格标记，
        # 不改写 prompt（调用方 prompt 自带风格定义）。
        self.assertEqual(
            rer.apply_preamble("PROMPT", "adversarial", deep=False, no_preamble=True),
            "PROMPT",
        )

    def test_adversarial_preamble_carries_negative_contract(self):
        # 阴性契约（无发现一行结论）必须保留：对抗审查最大的失败模式是假阳性泛滥，
        # 缺少该契约会诱导模型编造盲区凑产出。
        self.assertIn("未发现盲区或偏差", rer.ADVERSARIAL_PREAMBLE)


if __name__ == "__main__":
    unittest.main()
