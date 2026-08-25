"""flow-agent 熔断器行为测试。

通过 CircuitBreaker 公共接口验证跨会话熔断语义：状态文件是唯一的进程间
通信面，测试用注入的 path/now/notifier 隔离环境，不断言内部数据结构。
"""

import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from circuit_breaker import CircuitBreaker

# 2026-08-25 16:45 实证限流样本（run 日志原文，stdout 含 reset 时间，stderr 为无关噪音）
GLM_RATE_LIMIT_OUTPUT = (
    "API Error: Request rejected (429) · [1308][已达到 5 小时的使用上限。"
    "您的限额将在 2026-08-25 18:42 恢复，请稍后再试]\n"
    "[claude-code:unrecognized_model] {\"model\":\"glm-5.3\",\"query_source\":\"sdk\"}"
)

T0 = 1782800000.0  # 任意固定基准时间

# 2026-08-26 实证 Kimi 并发上限样本：403 状态码但属限流语义，无恢复时间；
# 「Please run /login」是 CC 对 403 的通用登录提示噪音，不是凭证失效
KIMI_CONCURRENT_LIMIT_OUTPUT = (
    "Please run /login · API Error: 403 You've reached your concurrent request limit. "
    "Please wait for your ongoing requests to finish and try again."
)


class BreakerTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state_path = Path(self.tmp.name) / "circuit-breaker.json"
        self.now = T0
        self.notifications = []
        self.breaker = CircuitBreaker(
            path=self.state_path,
            now=lambda: self.now,
            notifier=lambda launcher, level, until: self.notifications.append((launcher, level, until)),
        )

    def tearDown(self):
        self.tmp.cleanup()


class TestClosedByDefault(BreakerTestCase):
    def test_allows_any_launcher_without_state_file(self):
        allowed, _ = self.breaker.allow("cgwz", slug="s1")
        self.assertTrue(allowed)

    def test_corrupted_state_file_is_treated_as_empty(self):
        self.state_path.write_text("not json{{{", encoding="utf-8")
        allowed, _ = self.breaker.allow("cgwz", slug="s1")
        self.assertTrue(allowed)


class TestOpenSkipsLauncher(BreakerTestCase):
    def test_failed_launcher_is_skipped_but_others_still_allowed(self):
        self.breaker.record_failure("cgwz", "connection refused", slug="s1")

        allowed, reason = self.breaker.allow("cgwz", slug="s2")
        self.assertFalse(allowed)
        self.assertIn("熔断", reason)

        allowed_other, _ = self.breaker.allow("cg", slug="s2")
        self.assertTrue(allowed_other)

    def test_no_request_is_suggested_during_cooldown(self):
        """熔断期内的 allow 判定不依赖任何外部调用：纯本地状态裁决。"""
        self.breaker.record_failure("cgwz", "boom", slug="s1")
        allowed, reason = self.breaker.allow("cgwz", slug="s2")
        self.assertFalse(allowed)
        self.assertTrue(reason)  # 原因非空，供日志展示


class TestEscalationLadder(BreakerTestCase):
    def test_consecutive_failures_climb_ladder(self):
        ladder = [120, 3600, 14400, 604800, 2073600]
        for expected in ladder:
            self.breaker.record_failure("cgwz", "boom", slug="s1")
            entry = self.breaker.status()["launchers"]["cgwz"]
            self.assertAlmostEqual(entry["cooldown_until"] - self.now, expected, delta=1)
            self.now += 1  # 每次失败时间微移，模拟连续事件

    def test_ladder_stops_at_top(self):
        for _ in range(6):
            self.breaker.record_failure("cgwz", "boom", slug="s1")
            self.now += 1
        entry = self.breaker.status()["launchers"]["cgwz"]
        self.assertAlmostEqual(entry["cooldown_until"] - (self.now - 1), 2073600, delta=60)

    def test_notify_on_7d_and_24d_tiers_only_once_per_tier(self):
        # 升到 level3（7d）与 level4（24d）各通知一次；封顶后重复失败不重复通知
        for _ in range(6):
            self.breaker.record_failure("cgwz", "boom", slug="s1")
            self.now += 1
        levels_notified = [n[1] for n in self.notifications]
        self.assertEqual(levels_notified, [3, 4])


class TestRateLimitFastPath(BreakerTestCase):
    def test_glm_rate_limit_message_uses_server_reset_time(self):
        """真实 GLM 5h 限流样本：cooldown 取服务端恢复时间 + buffer，不消耗累进档。"""
        # now 固定在 reset 时间之前
        self.now = 1782800000.0  # 2026-08-25 某时刻（本地时区，须早于 18:42 当地时间）
        self.breaker.record_failure("cgwz", GLM_RATE_LIMIT_OUTPUT, slug="s1")

        entry = self.breaker.status()["launchers"]["cgwz"]
        self.assertEqual(entry["cooldown_source"], "server_reset")
        # 恢复时间被解析且带 buffer（不依赖本地时区精确值，只验证与累进档不同源且晚于 now）
        self.assertGreater(entry["cooldown_until"], self.now + 120)
        self.assertEqual(entry["escalation_level"], -1)  # 未消耗档位

    def test_rate_limit_without_parseable_time_falls_back_to_escalation(self):
        self.breaker.record_failure("cgwz", "HTTP 429 Too Many Requests", slug="s1")
        entry = self.breaker.status()["launchers"]["cgwz"]
        self.assertEqual(entry["cooldown_source"], "escalation")
        self.assertAlmostEqual(entry["cooldown_until"] - self.now, 120, delta=1)

    def test_kimi_concurrent_limit_counts_as_rate_limit(self):
        """Kimi 403 并发上限：识别为限流信号，无恢复时间可解析走累进首档。"""
        self.breaker.record_failure("cgwz", KIMI_CONCURRENT_LIMIT_OUTPUT, slug="s1")
        entry = self.breaker.status()["launchers"]["cgwz"]
        self.assertEqual(entry["cooldown_source"], "escalation")
        self.assertAlmostEqual(entry["cooldown_until"] - self.now, 120, delta=1)

    def test_past_reset_time_falls_back_to_escalation(self):
        stale = "API Error: Request rejected (429) · 您的限额将在 2020-01-01 08:00 恢复"
        self.breaker.record_failure("cgwz", stale, slug="s1")
        entry = self.breaker.status()["launchers"]["cgwz"]
        self.assertEqual(entry["cooldown_source"], "escalation")


class TestSuccessResets(BreakerTestCase):
    def test_success_clears_entry_and_ladder(self):
        self.breaker.record_failure("cgwz", "boom", slug="s1")
        self.breaker.record_failure("cgwz", "boom", slug="s1")
        self.breaker.record_success("cgwz")

        allowed, _ = self.breaker.allow("cgwz", slug="s2")
        self.assertTrue(allowed)
        self.assertNotIn("cgwz", self.breaker.status()["launchers"])

        # 复位后再失败回到第一档
        self.breaker.record_failure("cgwz", "boom", slug="s2")
        entry = self.breaker.status()["launchers"]["cgwz"]
        self.assertAlmostEqual(entry["cooldown_until"] - self.now, 120, delta=1)


class TestHalfOpen(BreakerTestCase):
    def test_first_session_after_cooldown_gets_probe_right(self):
        self.breaker.record_failure("cgwz", "boom", slug="s1")
        self.now += 121  # 越过 2min 冷却

        allowed, reason = self.breaker.allow("cgwz", slug="s2")
        self.assertTrue(allowed)
        self.assertIn("half-open", reason)

    def test_concurrent_sessions_only_one_gets_probe_right(self):
        self.breaker.record_failure("cgwz", "boom", slug="s1")
        self.now += 121

        grants = []
        def try_acquire(slug):
            allowed, _ = self.breaker.allow("cgwz", slug=slug)
            if allowed:
                grants.append(slug)

        threads = [threading.Thread(target=try_acquire, args=(f"s{i}",)) for i in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(grants), 1)

    def test_half_open_probe_right_is_recycled_after_ttl(self):
        self.breaker.record_failure("cgwz", "boom", slug="s1")
        self.now += 121
        self.breaker.allow("cgwz", slug="s2")  # s2 获得试探权但「死亡」不落地结果

        self.now += 599
        allowed, _ = self.breaker.allow("cgwz", slug="s3")
        self.assertFalse(allowed)  # TTL 内仍被占用

        self.now += 2
        allowed, _ = self.breaker.allow("cgwz", slug="s3")
        self.assertTrue(allowed)  # TTL 过后回收

    def test_failed_half_open_probe_escalates(self):
        self.breaker.record_failure("cgwz", "boom", slug="s1")
        self.now += 121
        self.breaker.allow("cgwz", slug="s2")  # 获得试探
        self.breaker.record_failure("cgwz", "still boom", slug="s2")  # 试探失败

        entry = self.breaker.status()["launchers"]["cgwz"]
        self.assertAlmostEqual(entry["cooldown_until"] - self.now, 3600, delta=1)  # 升到 1h 档

    def test_successful_half_open_probe_closes_circuit(self):
        self.breaker.record_failure("cgwz", "boom", slug="s1")
        self.now += 121
        self.breaker.allow("cgwz", slug="s2")
        self.breaker.record_success("cgwz")

        self.assertNotIn("cgwz", self.breaker.status()["launchers"])
        allowed, _ = self.breaker.allow("cgwz", slug="s3")
        self.assertTrue(allowed)


class TestFieldLevelCorruption(BreakerTestCase):
    """字段级损坏（手工编辑/旧版格式/写坏）不阻断审查——文件级容错之外的第二道兜底。"""

    def test_string_cooldown_until_is_sanitized(self):
        self.state_path.write_text(
            json.dumps({
                "version": 1,
                "launchers": {
                    "cgwz": {
                        "state": "open",
                        "opened_at": 1.0,
                        "cooldown_until": "2026-08-25 18:42",
                        "cooldown_source": "server_reset",
                        "escalation_level": -1,
                        "half_open": None,
                    }
                },
            }),
            encoding="utf-8",
        )
        allowed, _ = self.breaker.allow("cgwz", slug="s1")
        self.assertTrue(allowed)  # 损坏条目被净化，按 CLOSED 放行

    def test_non_dict_entry_is_sanitized(self):
        self.state_path.write_text(
            json.dumps({"version": 1, "launchers": {"cgwz": "bogus"}}),
            encoding="utf-8",
        )
        allowed, _ = self.breaker.allow("cgwz", slug="s1")
        self.assertTrue(allowed)

    def test_corrupt_half_open_is_sanitized(self):
        self.breaker.record_failure("cgwz", "boom", slug="s1")
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        state["launchers"]["cgwz"]["half_open"] = {"by": "x"}  # 缺 at 字段
        self.state_path.write_text(json.dumps(state), encoding="utf-8")
        self.now += 121
        allowed, _ = self.breaker.allow("cgwz", slug="s2")
        self.assertTrue(allowed)  # 到期后可正常进入 half-open，不抛 KeyError


if __name__ == "__main__":
    unittest.main()
