"""runner select_targets 行为规格：GLM 族与 kimi 族的正交规则对称。

覆盖四条规则：normal/max 反选避让同厂；显式 target 与 caller 同族拒绝；
ultra/fable 每族只留一档（light 低耗档、deep 强档）；
caller 自身的同族自审条目保持发起档位不升级。
"""

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

spec = importlib.util.spec_from_file_location("run_external_review", SCRIPTS / "run-external-review.py")
rer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rer)

# 固定模型集合，不依赖本机 configs/launchers.json（缺失机器上 MODEL_CONFIG 为空，
# ultra/fable 的数据驱动分支会拿不到成员）
ALL_MODELS = [
    "kimi-k3", "kimi-k3-full", "glm-5.3", "glm-5.3-flash",
    "qwen-3.8-max", "deepseek-v4-flash", "minimax-m3",
]


class SelectTargetsTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(rer, "MODEL_CONFIG", {m: {} for m in ALL_MODELS})
        patcher.start()
        self.addCleanup(patcher.stop)

    def assert_models(self, targets, expected):
        self.assertEqual(sorted(targets), sorted(expected))


class NormalEffortTest(SelectTargetsTest):
    def test_glm_family_callers_reverse_pick_kimi(self):
        # GLM 族任一成员做 caller 时反选 kimi-k3：glm-5.3 与族内另一成员同厂不构成正交
        self.assert_models(rer.select_targets("glm-5.3", "normal", None), ["kimi-k3"])
        self.assert_models(rer.select_targets("glm-5.3-flash", "normal", None), ["kimi-k3"])

    def test_non_glm_callers_reverse_pick_glm(self):
        for caller in ["kimi-k3", "qwen-3.8-max", "deepseek-v4-flash", "minimax-m3"]:
            self.assert_models(rer.select_targets(caller, "normal", None), ["glm-5.3"])


class MaxEffortTest(SelectTargetsTest):
    def test_glm_family_callers_get_kimi_plus_deepseek(self):
        self.assert_models(
            rer.select_targets("glm-5.3", "max", None), ["kimi-k3", "deepseek-v4-flash"]
        )
        self.assert_models(
            rer.select_targets("glm-5.3-flash", "max", None), ["kimi-k3", "deepseek-v4-flash"]
        )

    def test_deepseek_caller_swaps_in_kimi(self):
        self.assert_models(
            rer.select_targets("deepseek-v4-flash", "max", None), ["glm-5.3", "kimi-k3"]
        )


class TierSelectionTest(SelectTargetsTest):
    """ultra/fable 每族一档 + light/deep 档位切换。"""

    def test_ultra_light_keeps_low_cost_tiers(self):
        # caller 为第三方：两族同现时 light 各留低耗档（kimi-k3 / glm-5.3-flash）
        targets = rer.select_targets("qwen-3.8-max", "ultra", None, deep_mode=False)
        self.assert_models(
            targets, ["kimi-k3", "glm-5.3-flash", "deepseek-v4-flash", "minimax-m3"]
        )
        # 无重复条目（升级/去重顺序缺陷会让同一模型出现两次）
        self.assertEqual(len(targets), len(set(targets)))

    def test_ultra_deep_upgrades_both_families(self):
        targets = rer.select_targets("qwen-3.8-max", "ultra", None, deep_mode=True)
        self.assert_models(
            targets, ["kimi-k3-full", "glm-5.3", "deepseek-v4-flash", "minimax-m3"]
        )
        self.assertEqual(len(targets), len(set(targets)))

    def test_ultra_excludes_caller_family(self):
        # caller 为 GLM 族成员：同族另一档（含 glm-5.3 全量）不进集合
        for caller in ["glm-5.3", "glm-5.3-flash"]:
            targets = rer.select_targets(caller, "ultra", None)
            self.assertNotIn("glm-5.3", targets)
            self.assertNotIn("glm-5.3-flash", targets)
            self.assert_models(
                targets, ["kimi-k3", "qwen-3.8-max", "deepseek-v4-flash", "minimax-m3"]
            )

    def test_fable_includes_caller_own_tier_only(self):
        # fable 含 caller 本身，但同族另一档不重复计入
        targets = rer.select_targets("glm-5.3", "fable", None)
        self.assertIn("glm-5.3", targets)
        self.assertNotIn("glm-5.3-flash", targets)
        self.assert_models(
            targets, ["glm-5.3", "kimi-k3", "qwen-3.8-max", "deepseek-v4-flash", "minimax-m3"]
        )

    def test_fable_deep_keeps_caller_tier_but_upgrades_others(self):
        # caller 的同族自审条目保持发起档位；其余族的低耗档整体升级强档
        targets = rer.select_targets("kimi-k3", "fable", None, deep_mode=True)
        self.assertIn("kimi-k3", targets)
        self.assertNotIn("kimi-k3-full", targets)
        self.assertIn("glm-5.3", targets)
        self.assertNotIn("glm-5.3-flash", targets)
        self.assertEqual(len(targets), len(set(targets)))


class ExplicitTargetTest(SelectTargetsTest):
    def test_same_family_target_is_rejected(self):
        # 同族视为自审：GLM 两档互为同族，显式指定族内另一档与指定自身同样拒绝
        with self.assertRaises(ValueError):
            rer.select_targets("glm-5.3", "normal", "glm-5.3-flash")
        with self.assertRaises(ValueError):
            rer.select_targets("glm-5.3-flash", "normal", "glm-5.3")
        with self.assertRaises(ValueError):
            rer.select_targets("kimi-k3", "normal", "kimi-k3-full")

    def test_cross_family_target_returns_singleton(self):
        self.assert_models(
            rer.select_targets("kimi-k3", "normal", "glm-5.3-flash"), ["glm-5.3-flash"]
        )

    def test_unknown_target_is_rejected(self):
        with self.assertRaises(ValueError):
            rer.select_targets("kimi-k3", "normal", "glm-4.7")


if __name__ == "__main__":
    unittest.main()
