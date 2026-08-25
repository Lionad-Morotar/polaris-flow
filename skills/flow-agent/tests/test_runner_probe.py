"""runner probe_launcher 行为规格：超时路径保留部分输出供熔断器识别。

probe_launcher 是 runner 与 launcher 链路的唯一接触面——挂起型限流
（服务端收到请求后不再响应）发生前若已输出限流消息，超时异常里的部分
输出是熔断器识别限流信号的唯一线索，丢弃会把 server_reset 快路径退化
为累进猜测档。
"""

import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))

spec = importlib.util.spec_from_file_location("run_external_review", SCRIPTS / "run-external-review.py")
rer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rer)


class TestProbeTimeoutPreservesOutput(unittest.TestCase):
    def test_timeout_with_partial_rate_limit_output_keeps_signal(self):
        exc = subprocess.TimeoutExpired(
            cmd=["zsh"],
            timeout=20,
            output="API Error: Request rejected (429) · 已达到 5 小时的使用上限",
            stderr="",
        )
        with mock.patch.object(rer.subprocess, "run", side_effect=exc):
            ok, msg, raw = rer.probe_launcher("cgwz")
        self.assertFalse(ok)
        self.assertIn("429", raw)  # 限流信号必须保留在 raw 中供熔断器识别

    def test_timeout_without_output_falls_back_to_synthetic_message(self):
        exc = subprocess.TimeoutExpired(cmd=["zsh"], timeout=20, output=None, stderr=None)
        with mock.patch.object(rer.subprocess, "run", side_effect=exc):
            ok, msg, raw = rer.probe_launcher("cgwz")
        self.assertFalse(ok)
        self.assertTrue(raw)  # 无任何输出时也有非空 raw，调用方日志不断言空

    def test_timeout_with_bytes_output_is_decoded(self):
        exc = subprocess.TimeoutExpired(cmd=["zsh"], timeout=20, output=b"429 rate limit", stderr=b"")
        with mock.patch.object(rer.subprocess, "run", side_effect=exc):
            ok, msg, raw = rer.probe_launcher("cgwz")
        self.assertFalse(ok)
        self.assertIn("429", raw)


if __name__ == "__main__":
    unittest.main()
