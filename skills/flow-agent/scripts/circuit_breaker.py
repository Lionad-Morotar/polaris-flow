#!/usr/bin/env python3
"""flow-agent 跨会话熔断器（circuit breaker）。

背景：并行 flow-dev 会话对同一已限流 launcher 无记忆地重复 probe（实证：某账号
5 小时限流后，5 次后续审查调用各白赔一次 probe 请求）。本模块把熔断状态落到
`~/.flow-dev/circuit-breaker.json`（env `FLOW_CIRCUIT_BREAKER_PATH` 可覆盖，
供测试隔离），让任意会话的 runner 在发起请求前先本地裁决，熔断期内零请求。

语义：
- CLOSED：无条目即正常，直接放行；
- OPEN：cooldown_until 前一律跳过（probe 也不发）；冷却期取值优先服务端恢复
  时间（限流消息自带，+120s buffer），取不到按 2min/1h/4h/7d/24d 五档累进；
- HALF-OPEN：冷却到期后首个到达的会话经锁内 CAS 获得试探权（10min 未落地结果
  视为试探者死亡，可回收），probe 成功即复位删条目，失败按正常失败路径再熔断。

并发：独立 .lock 文件 flock 互斥 read-modify-write（锁文件永不 rename，避免
rename 换 inode 后 flock 失效）；状态文件 tmp+rename 原子替换，node preflight
等只读方因此无需加锁也读不到半截 JSON。7d/24d 档升档时 osascript 非阻塞通知。
"""

import fcntl
import json
import os
import re
import subprocess
import time
from datetime import datetime
from pathlib import Path

DEFAULT_STATE_PATH = Path.home() / ".flow-dev" / "circuit-breaker.json"
ENV_PATH_OVERRIDE = "FLOW_CIRCUIT_BREAKER_PATH"

# 五档累进：2min / 1h / 4h / 7d / 24d。档位的意义是「服务端没给恢复时间时，
# 本地对再次试探的保守程度」——连续失败越深，越可能是账号级长期不可用。
ESCALATION_LADDER_S = (120, 3600, 14400, 604800, 2073600)
ESCALATION_LABELS = ("2min", "1h", "4h", "7d", "24d")
# 升至 7d/24d 档时提示用户人工介入（账号很可能需要充值/换凭证/解禁）
NOTIFY_MIN_LEVEL = 3
# 服务端恢复时间的宽限：窗口释放是服务端时钟，且限流消息只精确到分
SERVER_RESET_BUFFER_S = 120
# half-open 试探权占用上限：probe 硬上限 20s，10min 已覆盖极端慢链路
HALF_OPEN_TTL_S = 600

RATE_LIMIT_RE = re.compile(
    r"429|rate[\s_-]?limit|too many requests|使用上限|限额|quota|usage[\s_-]?limit",
    re.IGNORECASE,
)
# 限流消息自带的恢复时间（实证形态：「您的限额将在 2026-08-25 18:42」），本地时区解释
RESET_TIME_RE = re.compile(r"(\d{4}-\d{2}-\d{2})[T\s]+(\d{1,2}:\d{2}(?::\d{2})?)")

MAX_ERROR_KEEP = 500


def _default_state() -> dict:
    return {"version": 1, "launchers": {}}


def _fresh_entry() -> dict:
    # escalation_level=-1 表示尚未消耗累进档（server_reset 路径不消耗档位）
    return {
        "state": "open",
        "opened_at": 0.0,
        "cooldown_until": 0.0,
        "cooldown_source": "escalation",
        "escalation_level": -1,
        "last_error": "",
        "last_slug": None,
        "half_open": None,
    }


def _entry_sane(entry) -> bool:
    """entry 字段级类型校验：allow() 的数值比较（now < cooldown_until、
    now - half_open.at）依赖这些类型，任一不符即视为损坏条目丢弃（fail-open）。"""
    if not isinstance(entry, dict):
        return False
    if not isinstance(entry.get("cooldown_until"), (int, float)):
        return False
    if not isinstance(entry.get("opened_at"), (int, float)):
        return False
    ho = entry.get("half_open")
    if ho is not None and not (isinstance(ho, dict) and isinstance(ho.get("at"), (int, float))):
        return False
    return True


def _fmt_ts(ts: float) -> str:
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))


def _fmt_duration(seconds: float) -> str:
    if seconds < 3600:
        return f"{int(seconds // 60)}min"
    if seconds < 86400:
        return f"{seconds / 3600:.1f}h"
    return f"{seconds / 86400:.1f}d"


def _parse_reset_time(text: str, now: float) -> float | None:
    """从限流输出解析服务端恢复时间（本地时区）；解析不到或已过期返回 None。"""
    m = RESET_TIME_RE.search(text)
    if not m:
        return None
    date_s, time_s = m.groups()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            ts = datetime.strptime(f"{date_s} {time_s}", fmt).timestamp()
        except ValueError:
            continue
        return ts if ts > now else None
    return None


def _osascript_notify(launcher: str, level: int, until: float) -> None:
    """7d/24d 升档的系统通知。headless 无 GUI session 时 osascript 会失败——静默，
    通知只是人工介入的提醒，失败不该影响熔断主流程；display notification 非阻塞，
    不用 dialog（会挂起等待点击，headless 审查进程会被卡死）。"""
    msg = (
        f"launcher「{launcher}」熔断升至 {ESCALATION_LABELS[level]} 冷却档"
        f"（预计 {_fmt_ts(until)} 恢复），请人工检查账号配额/凭证"
    )
    try:
        subprocess.Popen(
            [
                "osascript",
                "-e",
                f'display notification {json.dumps(msg, ensure_ascii=False)}'
                ' with title "flow-agent 熔断器" sound name "Funk"',
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
        )
    except Exception:
        pass


class CircuitBreaker:
    """launcher 粒度熔断器。now / notifier 可注入，测试据此隔离时间与系统副作用。"""

    def __init__(self, path: Path | str | None = None, now=None, notifier=None):
        env_override = os.environ.get(ENV_PATH_OVERRIDE)
        self.path = Path(path or env_override or DEFAULT_STATE_PATH)
        # 锁文件独立：flock 锁定的是 inode，状态文件靠 tmp+rename 原子替换会换
        # inode，若直接 flock 状态文件，rename 后新进程 open 到新 inode 锁即失效
        self._lock_path = self.path.with_name(self.path.name + ".lock")
        self._now = now or time.time
        self._notifier = notifier or _osascript_notify

    def allow(self, launcher: str, slug: str) -> tuple[bool, str]:
        """裁决是否放行。返回 (是否放行, 原因)；放行含 closed 与 half-open 两种形态。"""

        def fn(state):
            entry = state["launchers"].get(launcher)
            if not entry:
                return (True, "closed"), False
            now = self._now()
            if now < entry["cooldown_until"]:
                remain = _fmt_duration(entry["cooldown_until"] - now)
                hint = f"熔断中，预计 {_fmt_ts(entry['cooldown_until'])} 恢复（剩余 {remain}）"
                return (False, hint), False
            ho = entry.get("half_open")
            if ho and now - ho["at"] < HALF_OPEN_TTL_S:
                return (False, f"熔断恢复试探中（by {ho['by']}）"), False
            entry["half_open"] = {"by": slug, "at": now}
            return (True, "half-open"), True

        return self._transact(fn)

    def record_success(self, launcher: str) -> None:
        """链路恢复的证据（probe 成功）：复位删条目，累进档随之清零。"""

        def fn(state):
            if launcher in state["launchers"]:
                del state["launchers"][launcher]
                return None, True
            return None, False

        self._transact(fn)

    def record_failure(self, launcher: str, output: str, slug: str) -> dict:
        """记录一次失败并熔断。限流且带未来恢复时间 → 用服务端时间，不耗累进档；
        其余（限流无时间/非限流故障）→ 累进升档。升至 7d/24d 档时通知用户。
        通知在锁外触发，避免 flock 被外部进程 spawn 占用。"""
        notify_jobs = []

        def fn(state):
            entry = state["launchers"].get(launcher) or _fresh_entry()
            now = self._now()
            text = output or ""
            reset_ts = _parse_reset_time(text, now) if RATE_LIMIT_RE.search(text) else None
            prev_level = entry["escalation_level"]
            if reset_ts is not None:
                entry["cooldown_until"] = reset_ts + SERVER_RESET_BUFFER_S
                entry["cooldown_source"] = "server_reset"
            else:
                entry["escalation_level"] = min(prev_level + 1, len(ESCALATION_LADDER_S) - 1)
                lvl = entry["escalation_level"]
                entry["cooldown_until"] = now + ESCALATION_LADDER_S[lvl]
                entry["cooldown_source"] = "escalation"
                if lvl >= NOTIFY_MIN_LEVEL and prev_level < lvl:
                    notify_jobs.append((launcher, lvl, entry["cooldown_until"]))
            entry.update(
                state="open",
                opened_at=now,
                half_open=None,
                last_error=text[:MAX_ERROR_KEEP],
                last_slug=slug,
            )
            state["launchers"][launcher] = entry
            return entry, True

        entry = self._transact(fn)
        for launcher_, lvl, until in notify_jobs:
            self._safe_notify(launcher_, lvl, until)
        return entry

    def status(self) -> dict:
        """只读全表：tmp+rename 原子替换保证读不到半截，无需加锁。"""
        return self._read_state()

    def reset(self, launcher: str | None = None) -> None:
        """手动复位：指定 launcher 或全部（None）。"""

        def fn(state):
            if launcher is None:
                state["launchers"] = {}
                return None, True
            if launcher in state["launchers"]:
                del state["launchers"][launcher]
                return None, True
            return None, False

        self._transact(fn)

    def _read_state(self) -> dict:
        """读状态文件；缺失/损坏视为空状态——熔断器是保障层，自身故障不该阻断审查。
        容错覆盖两层：文件级（JSON 非法）与字段级（entry 类型非法，如手工编辑把
        cooldown_until 写成字符串）——后者会丢单条目而非整表，保住其余 launcher
        的熔断记忆。"""
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("launchers"), dict):
                data["launchers"] = {
                    name: entry
                    for name, entry in data["launchers"].items()
                    if _entry_sane(entry)
                }
                return data
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            pass
        return _default_state()

    def _transact(self, fn):
        """flock 互斥内 read-modify-write。fn(state) 返回 (result, mutated)，
        仅 mutated 时 tmp+rename 原子写回——只读判定不落盘，避免无意义写抖动。"""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self._lock_path, os.O_RDWR | os.O_CREAT, 0o644)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            state = self._read_state()
            result, mutated = fn(state)
            if mutated:
                tmp = self.path.with_name(f"{self.path.name}.tmp.{os.getpid()}")
                tmp.write_text(
                    json.dumps(state, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                os.replace(tmp, self.path)
            return result
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    def _safe_notify(self, launcher: str, level: int, until: float) -> None:
        try:
            self._notifier(launcher, level, until)
        except Exception:
            pass
