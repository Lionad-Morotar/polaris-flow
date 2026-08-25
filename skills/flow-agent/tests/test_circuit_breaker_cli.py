"""熔断器管理 CLI 行为规格：status / reset 是用户查看与复位熔断状态的手动入口。

CLI 即公共接口——经子进程验证，env FLOW_CIRCUIT_BREAKER_PATH 隔离状态文件。
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CLI = Path(__file__).resolve().parent.parent / "scripts" / "circuit_breaker.py"


class CliTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state_path = Path(self.tmp.name) / "circuit-breaker.json"
        self.env = {**os.environ, "FLOW_CIRCUIT_BREAKER_PATH": str(self.state_path)}

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *args):
        return subprocess.run(
            [sys.executable, str(CLI), *args],
            capture_output=True,
            text=True,
            env=self.env,
            timeout=15,
        )

    def trip(self, launcher="cgwz"):
        self.run_cli("trip", launcher, "simulated failure for fixture")


class TestStatus(CliTestCase):
    def test_empty_state_reports_no_records(self):
        proc = self.run_cli("status")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("无熔断记录", proc.stdout)

    def test_open_entry_shows_launcher_and_recovery(self):
        self.trip()
        proc = self.run_cli("status")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("cgwz", proc.stdout)
        self.assertIn("恢复", proc.stdout)

    def test_status_json_is_machine_readable(self):
        self.trip()
        proc = self.run_cli("status", "--json")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertIn("cgwz", data["launchers"])
        self.assertEqual(data["launchers"]["cgwz"]["state"], "open")


class TestReset(CliTestCase):
    def test_reset_specific_launcher(self):
        self.trip("cgwz")
        self.trip("cg")
        proc = self.run_cli("reset", "cgwz")
        self.assertEqual(proc.returncode, 0, proc.stderr)

        after = self.run_cli("status", "--json")
        launchers = json.loads(after.stdout)["launchers"]
        self.assertNotIn("cgwz", launchers)
        self.assertIn("cg", launchers)

    def test_reset_all_clears_everything(self):
        self.trip("cgwz")
        self.trip("cg")
        proc = self.run_cli("reset", "--all")
        self.assertEqual(proc.returncode, 0, proc.stderr)

        after = self.run_cli("status")
        self.assertIn("无熔断记录", after.stdout)

    def test_reset_unknown_launcher_is_graceful(self):
        proc = self.run_cli("reset", "nonexistent")
        self.assertEqual(proc.returncode, 0, proc.stderr)  # 幂等：不存在的条目视为已复位


class TestTripSemantics(CliTestCase):
    """手动熔断的冷却语义：trip 服务「线下已知账号数小时不可用」（维护期/充值前），
    2min 级冷却会让并行会话立即穿透试探，手动熔断形同虚设。"""

    def test_trip_defaults_to_24h_cooldown(self):
        before = __import__("time").time()
        self.trip()
        after = self.run_cli("status", "--json")
        entry = json.loads(after.stdout)["launchers"]["cgwz"]
        self.assertEqual(entry["cooldown_source"], "manual")
        self.assertGreaterEqual(entry["cooldown_until"], before + 24 * 3600 - 5)
        self.assertLessEqual(entry["cooldown_until"], before + 24 * 3600 + 60)

    def test_trip_for_overrides_cooldown(self):
        before = __import__("time").time()
        self.run_cli("trip", "cgwz", "维护期", "--for", "2")
        after = self.run_cli("status", "--json")
        entry = json.loads(after.stdout)["launchers"]["cgwz"]
        self.assertGreaterEqual(entry["cooldown_until"], before + 2 * 3600 - 5)
        self.assertLessEqual(entry["cooldown_until"], before + 2 * 3600 + 60)

    def test_trip_does_not_consume_escalation_ladder(self):
        self.trip()
        after = self.run_cli("status", "--json")
        entry = json.loads(after.stdout)["launchers"]["cgwz"]
        self.assertEqual(entry["escalation_level"], -1)  # 手动熔断与自动累进互不影响


if __name__ == "__main__":
    unittest.main()
