#!/usr/bin/env python3
"""
flow-agent 外部审查执行模板。

用法：
  python3 run-external-review.py \
    --slug <slug> \
    --review-dir <docs/reviews/YYYY-MM-DD-<slug>> \
    --caller-model <kimi-k3|kimi-k3-full|glm-5.3|glm-5.3-flash|qwen-3.8-max|deepseek-v4-flash|minimax-m3> \
    [--prompt-file <path/to/prompt.md>] \
    [--session-id <session-id> | --session-file <path/to/session.jsonl>] \
    [--effort normal|max|ultra|fable] \
    [--target-model <model>|auto] \
    [--timeout <seconds>]

脚本按 `references/degradation-path.md` 的规则：
- 正式审查前先用最小 prompt 探测（probe）launcher 全链路可用性，不通则直接换备用 launcher，
  避免在坏链路上浪费一次完整审查周期（仅 `command -v` 静态检查无法发现运行时故障）；
- 通过 zsh launcher function 启动外部审查；
- 启动前清理同一 slug 残留的旧审查进程；
- 子进程挂 `start_new_session` 独立进程组，超时/异常时 kill 整个进程组而非仅父进程——
  launcher 链（zsh → claude CLI）中父进程先死会留下孤儿继续写产物文件，造成"假运行"假象；
- `proc.wait()` 裸阻塞改为轮询 `poll()` + 心跳日志：子进程异常死亡时及时感知并推进重试，
  且日志让"审查慢"与"进程已死"可区分（曾发生 python 与 zsh 同时死亡、task 假活 7 分钟的事故）；
- stdin 显式置 DEVNULL：claude CLI 启动时会探测 stdin 数据，后台环境 stdin 状态不可控；
- 校验输出：light 模式只要求非空（无发现的一行阴性结论是合法交付形态），deep 模式要求包含标题/条目；
- 失败后按备用 launcher 重试；
- 多个目标模型并发执行；
- 全过程写运行日志（run-dir 下 review-<model>.log）并回显 stdout，每次调用追加一行
  JSON 摘要到全局日志 ~/.flow-dev/logs/flow-agent.log，供事后排查与调用历史审计；
- 最终向 stdout 打印 JSON 汇总。

注意：所有 launcher 都是 zsh function。脚本通过 `zsh -c 'source ~/.zshrc; <launcher> ...'`
显式加载用户 zsh profile 后调用，不使用 `zsh -ic`：交互模式(-i)会让 powerlevel10k 的 gitstatus
在无 TTY 子进程里初始化失败，stderr 噪音虽不致命，却会淹没 launcher 自身的真实报错、误导排查。
"""

import argparse
import concurrent.futures
import json
import os
import shlex
import signal
import subprocess
import sys
import time
from pathlib import Path

# 同目录脚本直接执行时脚本目录自动入 sys.path，import 安全
from circuit_breaker import CircuitBreaker

# 模型→启动器链是本机配置（launcher 名对应维护者 zsh profile 中的账号级函数），
# 唯一事实源为 configs/launchers.json（.gitignore 排除，不随仓分发）；
# configs/launchers.example.json 是入库模板。文档只描述模型集合与选择规则。
SKILL_DIR = Path(__file__).resolve().parent.parent
LAUNCHERS_CONFIG_PATH = SKILL_DIR / "configs" / "launchers.json"


def load_model_config() -> dict:
    """加载 configs/launchers.json 的 models 表；缺失或结构非法时返回 {}。

    返回空而非直接退出：让 argparse --help 在无配置机器上仍可用；
    main() 入口统一检查空配置并给出指向 example 模板的报错。
    """
    try:
        data = json.loads(LAUNCHERS_CONFIG_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    models = data.get("models")
    if not isinstance(models, dict) or not models:
        return {}
    for name, cfg in models.items():
        launchers = cfg.get("launchers")
        if not isinstance(launchers, list) or not launchers or not all(isinstance(x, str) for x in launchers):
            return {}
        if not isinstance(cfg.get("timeout"), int) or cfg["timeout"] <= 0:
            return {}
    return models


MODEL_CONFIG = load_model_config()

# probe 探针：最小 prompt 快速验证 launcher 全链路（zsh → cc → cc-expand → binary → API）。
# 预期 ~10s 返回；PROBE_TIMEOUT 是硬上限，留足 API 慢响应余量，但远小于一次完整审查的试错成本。
PROBE_PROMPT = "ping (just reply me pong)"
PROBE_TIMEOUT = 20

# 探针走 --bare 极简模式：跳过 hooks/skills/plugins/MCP/auto memory/CLAUDE.md 自动发现。
# 探针只需验证链路通断，不需要任何上下文；--bare 后 input 最小、不触发 SessionStart 钩子
# 留痕（记忆类 hook 会把探针 session 当成真实工作记录），启动也更快。
# --no-session-persistence 避免一次性探针 session 落盘污染 ~/.claude/projects。
# 注意 --bare 不读 CLAUDE_CODE_OAUTH_TOKEN，但 launcher 经 --settings 注入
# ANTHROPIC_AUTH_TOKEN，认证不受影响（已经本机 launcher 全链路实测）。
PROBE_CLI_FLAGS = ["--bare", "--no-session-persistence"]

# 审查精简配置：覆盖调用方（如交互式 CC）的全局重型 settings，避免审查子进程背上
# skills/MCP/agent-teams 等与代码审查无关的负担。实证（同 prompt 同 settings）：
#   有 skills+MCP：input 48K，thinking 365，耗时 56s
#   禁 skills+MCP：input 24K（减半），thinking 1158（暴涨），耗时 81s
# 即 EFFORT_LEVEL=max 下，禁 skills 会用更深 reasoning 补偿缺失的结构化引导，单次反而更慢；
# 但 input 减半（成本↓）+ 审查更"独立"（不被本地 code-review skill 带偏，正交性更纯），
# 且 MCP 对审查纯负担（省 input + 免启动时连接十几个 server 的握手开销）。
# 故：MCP 禁用为稳赚，skills 禁用为"省 token 换时间"的取舍——权衡后默认都禁。
# 不覆盖 EFFORT_LEVEL / AUTO_COMPACT_WINDOW（用户全局偏好，保留 max effort 与 1M 窗口）。
REVIEW_ENV_OVERRIDES = {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "0",  # 审查无需多代理协作，避免自发 fan-out
    "CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY": "4",  # 审查串行为主，降并发资源占用
    # 让 launcher 注入 outputStyle=Default：调用方的 user 级 outputStyle 会进入审查
    # session 的 system prompt（-p 模式同样生效），自定义风格会带偏审查输出格式。
    # CC 没有专用 env 禁 output style（SAFE_MODE 会连坐禁 hooks/CLAUDE.md），
    # 只能靠 --settings 同名键覆盖，该变量驱动 zshrc 注入逻辑的开关。
    "FLOW_REVIEW_PLAIN_STYLE": "1",
    # AFK（away from keyboard）自动推进：headless 审查子进程无人应答 AskUserQuestion，
    # 超时后 CC 注入"proceed on best judgment"让模型自行脱困，避免单次发问卡满 1800s
    # watchdog。取 1000ms 极速脱困——审查 prompt 已框定不发问，任何发问都是异常噪声，
    # 1 秒后立即 proceed 几乎零等待（CC 默认 60s 对无人值守审查偏长）；显式 env 同时
    # 防御官方已宣布的 opt-in 改造（计划把 AFK 默认改为关闭），锁定开启。
    # 不设 CLAUDE_AFK_COUNTDOWN_MS：headless -p 无 TTY，倒计时视觉无效，且
    # min(countdown, timeout) 会把它截断为 timeout，显式设是空 knob。
    "CLAUDE_AFK_TIMEOUT_MS": "1000",
}
# 审查 CLI flag：注入到 launcher 之后、-p 之前。
REVIEW_CLI_FLAGS = [
    "--disable-slash-commands",            # 禁用所有 skills：不把 80+ skills 注入 input
    "--strict-mcp-config",                 # 不传 --mcp-config 即零 MCP server，禁用全部 MCP
    "--allowedTools", "Read", "Grep", "Glob", "Bash",  # 审查四件套：读/搜/跑命令，禁写入避免误改代码
]

# light 模式前言：默认注入到调用方 prompt 之前，框定审查范围（快速正交 sanity check，非穷尽审计）。
# 核心是抑制审查模型"逐行 review / 穷举边界 / 搜索所有领域"的倾向——这是单次审查超时的主因之一
# （max effort 下模型会自发深挖）。措辞与 prompt-template.md 的 light 审查边界保持一致，供其他 agent 参考。
# --deep / --no-preamble 均跳过注入：前者自带逐领域详查语义，后者由调用方 prompt 完整定义审查流程。
LIGHT_PREAMBLE = (
    "【审查模式：light 正交审查】\n"
    "这是一次快速正交 sanity check，不是穷尽审计。"
    "只报告会真正造成故障的高/中严重度发现（逻辑错误、安全漏洞、数据损坏或丢失、权限越权、崩溃、资源泄漏）。"
    "跳过风格/命名/可读性，跳过主代理已用单测或 typecheck 覆盖的验证，跳过无具体失败场景的纯理论边界。"
    "不要逐行 review、不要穷举输入边界、不要搜索其他领域。"
    "分钟级完成；没有关键发现就明确回复\"未发现高严重度问题\"。"
    "无高/中严重度发现时，整份输出仅这一行结论——"
    "禁止罗列已验证的角度/路径清单、复述验证过程或成功路径分析、附 Insight/总结/低严重度观察，"
    "验证叙述对调用方无信息量，纯消耗 token。"
    "需要深入审计请用 --deep 重新发起。\n\n"
)


def build_launcher_cmd(launcher: str, prompt: str, flags: list[str] | None = None) -> list[str]:
    """构造 zsh 调用命令：source 加载 launcher function + CLI flag + -p prompt。

    flag 放在 launcher 与 -p 之间：launcher 透传后续参数给底层 claude binary，
    binary 解析这些 flag。-p 必须紧贴 prompt（已被 shlex.quote 包裹）。
    flags 为 None 时用审查精简配置 REVIEW_CLI_FLAGS；探针传 PROBE_CLI_FLAGS。
    """
    flag_str = " ".join(REVIEW_CLI_FLAGS if flags is None else flags)
    return [
        "zsh", "-c",
        f"source ~/.zshrc 2>/dev/null; {launcher} {flag_str} -p {shlex.quote(prompt)}",
    ]


def build_review_env(launcher: str) -> dict:
    """构造审查子进程环境：父环境 + 审查覆盖 + CC_CLAUDE_STARTUP_COMMAND。"""
    env = os.environ.copy()
    env.update(REVIEW_ENV_OVERRIDES)
    env["CC_CLAUDE_STARTUP_COMMAND"] = launcher
    return env


# 轮询监控：POLL_INTERVAL 感知子进程死亡，HEARTBEAT_INTERVAL 输出心跳证明"还活着且在跑"。
POLL_INTERVAL = 5
HEARTBEAT_INTERVAL = 30

# 全局调用日志：每次 flow-agent 审查追加一行 JSON 摘要，跨 slug 审计调用历史。
SUMMARY_LOG = Path.home() / ".flow-dev" / "logs" / "flow-agent.log"


def log_event(log_file: Path, msg: str) -> None:
    """写一条带时间戳的运行日志：append 到 per-model 日志文件，同时 flush 到 stdout。

    stdout 回显让后台 task 的 output 文件实时可见进度（曾发生 stdout 全静默、
    调用方无法区分"审查慢"与"脚本已死"的事故）。
    """
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    with log_file.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def append_summary_log(record: dict) -> None:
    """向全局日志追加一行 JSON 摘要。失败静默：日志故障不应阻断审查主流程。"""
    try:
        SUMMARY_LOG.parent.mkdir(parents=True, exist_ok=True)
        with SUMMARY_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


def probe_launcher(launcher: str) -> tuple[bool, str, str]:
    """用最小 prompt 探测 launcher 全链路可用性，预期 ~10s。

    判定宽松（输出含 pong 即通过）：探针目标是筛掉"链路根本不通"（function 缺失、
    binary 损坏、API 认证失败、限流），而非校验模型回答质量。

    返回 (是否通过, 摘要, 完整输出)。完整输出（截 2000 字符）供熔断器识别限流信号
    与解析服务端恢复时间——摘要只截 80 字符，实证曾恰好截断恢复时间字段。
    """
    cmd = build_launcher_cmd(launcher, PROBE_PROMPT, flags=PROBE_CLI_FLAGS)
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT,
            stdin=subprocess.DEVNULL,
            env=build_review_env(launcher),
        )
    except subprocess.TimeoutExpired as exc:
        # 超时前 launcher 可能已输出部分内容（如挂起型限流：先打印 429 再挂起）——
        # 保留给熔断器识别限流信号；output 可能是 str 或 bytes，统一归一为 str
        def _as_text(chunk) -> str:
            if chunk is None:
                return ""
            return chunk if isinstance(chunk, str) else chunk.decode("utf-8", "replace")

        partial = (_as_text(exc.stdout) + "\n" + _as_text(exc.stderr))[:2000]
        raw = partial if partial.strip() else f"probe timeout after {PROBE_TIMEOUT}s"
        return False, f"probe 超时（>{PROBE_TIMEOUT}s 无响应）", raw
    except Exception as exc:
        return False, f"probe 启动异常: {exc}", f"probe launch exception: {exc}"

    raw = ((proc.stdout or "") + "\n" + (proc.stderr or ""))[:2000]
    out = (proc.stdout or "").strip()
    if "pong" in out.lower():
        return True, f"probe ok: {out[:60]!r}", raw
    detail = out[:80] or "(stdout 空)"
    err = (proc.stderr or "").strip()[:80]
    return False, f"probe 异常: exit={proc.returncode}, stdout={detail!r}, stderr={err!r}", raw


def _breaker_call(log_file: Path, note: str, fn, fallback):
    """熔断器调用的 fail-open 兜底：熔断器是保障层，其自身任何异常都不应阻断
    审查主流程——allow 异常按放行兜底（fail-open 漏过一次探测的代价远小于
    整个模型审查崩溃），record 异常按忽略兜底。字段级损坏之外未知的异常形态
    由本层最后拦截（_read_state 已净化已知损坏形态）。
    """
    try:
        return fn()
    except Exception as exc:
        log_event(log_file, f"[breaker] {note} 异常，按兜底继续: {exc}")
        return fallback


def kill_process_group(proc: subprocess.Popen) -> None:
    """kill 子进程所在进程组（配合 start_new_session=True，pgid == proc.pid）。

    必须杀整组而非仅父进程：launcher 链 zsh → claude CLI 中，父 zsh 先死时
    claude 会成孤儿继续持有产物文件 fd 写入，造成"进程死了但产物还在变"的假象。
    """
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def find_session_file(session_id: str) -> Path | None:
    """根据 session id 在 ~/.claude/projects 下查找对应的 jsonl 文件。"""
    projects_dir = Path.home() / ".claude" / "projects"
    if not projects_dir.exists():
        return None

    # 优先从当前 working directory 推断 project 目录
    cwd = Path.cwd()
    inferred_name = "-" + str(cwd).lstrip("/").replace("/", "-")
    inferred_dir = projects_dir / inferred_name
    if inferred_dir.is_dir():
        candidate = inferred_dir / f"{session_id}.jsonl"
        if candidate.exists():
            return candidate

    # 否则全局搜索
    for project_dir in projects_dir.iterdir():
        if not project_dir.is_dir():
            continue
        candidate = project_dir / f"{session_id}.jsonl"
        if candidate.exists():
            return candidate

    return None


def extract_assistant_text(session_file: Path) -> str:
    """从 session history 中提取 assistant 的 text 内容。"""
    texts = []
    with session_file.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue

            if record.get("type") != "assistant":
                continue

            message = record.get("message", {})
            for content in message.get("content", []):
                if content.get("type") == "text" and "text" in content:
                    texts.append(content["text"])

    return "\n\n".join(texts)


# 同族（不构成正交视角）的模型组：
# - kimi-k3 / kimi-k3-full：k3 的 256k 与 1M 两个上下文档位，强度等同；
# - glm-5.3 / glm-5.3-flash：同厂同系的全量与轻量档，训练数据和对齐高度同源。
KIMI_FAMILY = {"kimi-k3", "kimi-k3-full"}
GLM_FAMILY = {"glm-5.3", "glm-5.3-flash"}
MODEL_FAMILIES = [KIMI_FAMILY, GLM_FAMILY]


def _same_family(a: str, b: str) -> bool:
    """同族模型不构成正交视角——审查集合内同族只保留一个档位，
    与 caller 配对的同族成员同样视为自审。
    """
    return any(a in family and b in family for family in MODEL_FAMILIES)


def select_targets(caller_model: str, effort: str, target_model: str | None, deep_mode: bool = False) -> list[str]:
    """根据 caller 模型、effort 和显式 target-model 选择目标审查模型集合。

    kimi 视角默认用 kimi-k3（k3-256k，强度等同全量 k3、消耗更低）；
    deep_mode（--deep 深入审查）将其升级为 kimi-k3-full（全量 k3·1M 上下文）。
    """
    if target_model and target_model != "auto":
        if target_model not in MODEL_CONFIG:
            raise ValueError(f"不支持的 target-model: {target_model}")
        if target_model == caller_model or _same_family(target_model, caller_model):
            raise ValueError(f"target-model cannot equal caller-model: {target_model}")
        return [target_model]

    if effort == "normal":
        # GLM 族（glm-5.3 / glm-5.3-flash）caller 反选 kimi-k3：glm-5.3 与族内另一成员同厂不构成正交
        targets = ["kimi-k3"] if caller_model in GLM_FAMILY else ["glm-5.3"]
    elif effort == "max":
        base = ["kimi-k3"] if caller_model in GLM_FAMILY else ["glm-5.3"]
        # max 固定补一个 deepseek 视角；caller 已是 deepseek-v4-flash 时同厂视角不构成正交，改补 kimi-k3
        if caller_model != "deepseek-v4-flash":
            base.append("deepseek-v4-flash")
        elif "kimi-k3" not in base:
            base.append("kimi-k3")
        targets = base
    elif effort == "fable":
        # 所有模型，包括 caller 本身；caller 同族的另一档位不重复计入
        targets = sorted(m for m in MODEL_CONFIG if m == caller_model or not _same_family(m, caller_model))
    else:
        # ultra：所有非 caller 模型，caller 同族的另一档位同样排除
        targets = sorted(m for m in MODEL_CONFIG if m != caller_model and not _same_family(m, caller_model))

    # kimi 与 GLM 两族在集合中各占一个视角，按审查模式选档：
    # light 用低消耗档（kimi-k3 / glm-5.3-flash），--deep 用强档（kimi-k3-full / glm-5.3）。
    # 先去重再升级——升级把 light 档替换为 deep 档，若 deep 档已在集合会产生重复条目
    # （重复模型会被并发启动两次、写同一个结果文件互相覆盖）。
    # 升级不触碰 caller 的同族自审条目（fable 含 caller 本身）——caller 用什么档位发起，自审就用什么档位。
    tier_pairs = ((KIMI_FAMILY, "kimi-k3", "kimi-k3-full"), (GLM_FAMILY, "glm-5.3-flash", "glm-5.3"))
    for family, light_tier, deep_tier in tier_pairs:
        if light_tier in targets and deep_tier in targets:
            drop = light_tier if deep_mode else deep_tier
            targets = [m for m in targets if m != drop]
        if deep_mode and caller_model not in family and light_tier in targets:
            targets = [deep_tier if m == light_tier else m for m in targets]
    return targets


def validate_result(path: Path, light_mode: bool = False) -> tuple[bool, str | None]:
    """校验审查结果文件是否可用。

    light 前言契约：无高/中严重度发现时整份输出仅一行阴性结论——非空正文即
    合法交付形态，要求标题/条目会把这批产物误判为 degraded（曾跨任务 9+ 轮
    复现，每轮触发同族 launcher 全链重试、空耗 20-30 分钟），故结构检查按
    模式分叉：light 只要求非空，deep 保留标题/条目要求。空产物在两种模式下
    都拦（真实失败的主形态）；ANSI 检查两模式都保留。
    """
    if not path.exists():
        return False, "结果文件不存在"
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return False, "结果文件为空"
    if not light_mode and not any(line.startswith(("# ", "## ", "- ", "1. ")) for line in text.splitlines()):
        return False, "结果文件缺少标题或条目"
    if "\x1b[" in text:
        return False, "结果文件含 ANSI 控制字符"
    return True, None


def start_watchdog(pid: int, launcher: str, timeout: int) -> subprocess.Popen:
    """启动一个独立 watchdog 进程，超时后 kill 目标进程组。

    到点直接 killpg 而不做"进程是否存活"预检：预检用 `ps -p <pid>` 只能看到父 zsh，
    父死子存（claude 孤儿）时会误判为"已结束"而放过孤儿；进程组不因组长死亡而消失，
    killpg 对空组仅抛 ProcessLookupError，代价为零。

    该 watchdog 是 python 主进程死亡场景的最后保险（主流程正常时会主动 kill 它）：
    主进程被杀后，轮询与重试全部失效，只有独立进程的定时 killpg 能阻止孤儿泄漏。
    """
    script = f"""
import os, signal, sys, time
pgid = int(sys.argv[1])
timeout = int(sys.argv[3])
time.sleep(timeout)
try:
    os.killpg(pgid, signal.SIGKILL)
except Exception:
    pass
"""
    return subprocess.Popen(
        [sys.executable, "-c", script, str(pid), launcher, str(timeout)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )


def cleanup_old_process(run_dir: Path, model: str) -> None:
    """清理同一 slug 下该模型残留的旧审查进程。"""
    pid_file = run_dir / f"review-{model}.pid"
    launcher_file = run_dir / f"review-{model}.launcher"

    if not pid_file.exists() or not launcher_file.exists():
        return

    try:
        old_pid = int(pid_file.read_text(encoding="utf-8").strip())
        expected_launcher = launcher_file.read_text(encoding="utf-8").strip()
        actual = subprocess.run(
            ["ps", "-o", "command=", "-p", str(old_pid)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if actual.returncode == 0 and expected_launcher in actual.stdout:
            os.kill(old_pid, signal.SIGKILL)
            # 新版脚本的子进程是独立进程组组长：组长已杀后组员（claude 等）可能仍存活，
            # 补杀整组防孤儿；旧版遗留进程不是组长时 killpg 抛 ProcessLookupError，静默跳过。
            try:
                os.killpg(old_pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
    except Exception:
        pass
    finally:
        # 删除旧状态文件，避免后续 watchdog 误判
        for suffix in ("pid", "launcher", "err"):
            f = run_dir / f"review-{model}.{suffix}"
            if f.exists():
                f.unlink(missing_ok=True)


def run_one_model(
    slug: str,
    review_dir: Path,
    run_dir: Path,
    model: str,
    prompt: str,
    timeout: int,
    deep_mode: bool = False,
) -> dict:
    """为单个模型执行审查：launcher 按序先 probe 再正式跑，失败时换备用 launcher。"""
    config = MODEL_CONFIG[model]
    launchers = config["launchers"]
    default_timeout = config["timeout"]
    effective_timeout = timeout if timeout is not None else default_timeout

    result_file = review_dir / f"review-{model}.md"
    err_file = run_dir / f"review-{model}.err"
    pid_file = run_dir / f"review-{model}.pid"
    launcher_file = run_dir / f"review-{model}.launcher"
    log_file = run_dir / f"review-{model}.log"

    # 新一轮运行重置日志，避免历史轮次残留混淆排查
    log_file.write_text("", encoding="utf-8")
    t_model0 = time.time()
    log_event(log_file, f"[start] slug={slug} model={model} launchers={launchers} timeout={effective_timeout}s")

    # resume 场景：先清理旧进程
    cleanup_old_process(run_dir, model)

    # 替换 prompt 中的占位符为当前模型名
    model_prompt = prompt.replace("<target-model>", model)

    last_error = "未尝试任何 launcher"
    last_launcher = launchers[-1]
    breaker = CircuitBreaker()
    skipped_open = 0

    for launcher in launchers:
        last_launcher = launcher

        # 跨会话熔断裁决：熔断期内零请求（含 probe）——并行 flow-dev 会话共享状态，
        # 已限流的 launcher 不再被每个会话重复探测（实证：5h 限流后 5 次调用各白赔一次 probe）
        allowed, breaker_reason = _breaker_call(
            log_file, f"allow({launcher})", lambda: breaker.allow(launcher, slug), (True, "熔断器异常放行")
        )
        if not allowed:
            skipped_open += 1
            last_error = f"熔断跳过: {breaker_reason}"
            log_event(log_file, f"[skip] {launcher} {breaker_reason}")
            continue

        result_file.write_text("")
        err_file.write_text("")
        launcher_file.write_text(launcher)

        # probe 探针：先用最小 prompt 验证全链路可用，不通直接换下一个 launcher，
        # 避免在坏链路上空耗一次完整审查周期（坏链路失败可能数分钟后才暴露）。
        log_event(log_file, f"[probe] {launcher} 探测中（{PROBE_PROMPT!r}，上限 {PROBE_TIMEOUT}s）...")
        t_probe0 = time.time()
        probe_ok, probe_msg, probe_raw = probe_launcher(launcher)
        log_event(log_file, f"[probe] {launcher} {'通过' if probe_ok else '失败'}（{time.time() - t_probe0:.1f}s）: {probe_msg}")
        if not probe_ok:
            _breaker_call(log_file, "record_failure", lambda: breaker.record_failure(launcher, probe_raw or probe_msg, slug), None)
            last_error = f"probe 失败: {probe_msg}"
            continue
        # probe 通过即链路恢复证据：复位熔断（含 half-open 试探成功场景）
        _breaker_call(log_file, "record_success", lambda: breaker.record_success(launcher), None)

        # 审查精简配置见 build_launcher_cmd / build_review_env：禁 skills/MCP、限 allowedTools、
        # 覆盖 agent teams/并发 env，把与代码审查无关的全局重型 settings 挡在子进程外
        # （跨模型实证 input 减半、对慢 API 的首 token 与传输有实打实收益）。
        env = build_review_env(launcher)
        cmd = build_launcher_cmd(launcher, model_prompt)
        out_fd = open(result_file, "w", encoding="utf-8")
        err_fd = open(err_file, "w", encoding="utf-8")

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=out_fd,
                stderr=err_fd,
                env=env,
                stdin=subprocess.DEVNULL,
                start_new_session=True,
            )
            pid_file.write_text(str(proc.pid))
            t0 = time.time()
            log_event(log_file, f"[launch] {launcher} 已启动 pid={proc.pid}（独立进程组）")

            wd_proc = start_watchdog(proc.pid, launcher, effective_timeout)
            timed_out = False
            try:
                last_heartbeat = t0
                while True:
                    rc = proc.poll()
                    if rc is not None:
                        exit_code = rc
                        break
                    elapsed = time.time() - t0
                    if elapsed > effective_timeout:
                        timed_out = True
                        log_event(log_file, f"[timeout] {launcher} 超 {effective_timeout}s，kill 进程组")
                        kill_process_group(proc)
                        exit_code = proc.wait()
                        break
                    time.sleep(POLL_INTERVAL)
                    if time.time() - last_heartbeat >= HEARTBEAT_INTERVAL:
                        size = result_file.stat().st_size if result_file.exists() else 0
                        log_event(log_file, f"[heartbeat] {launcher} 运行中 {int(elapsed)}s，产物 {size}B")
                        last_heartbeat = time.time()
            finally:
                wd_proc.kill()
                try:
                    wd_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    wd_proc.terminate()

            elapsed = time.time() - t0
            log_event(log_file, f"[exit] {launcher} 结束 exit={exit_code} 耗时 {elapsed:.1f}s{'（超时强杀）' if timed_out else ''}")

            ok, reason = validate_result(result_file, light_mode=not deep_mode)
            if ok:
                log_event(log_file, f"[success] {model} 经 {launcher} 审查成功")
                result = {
                    "target_model": model,
                    "launcher": launcher,
                    "status": "success",
                    "prompt_path": str(review_dir / "prompt.md"),
                    "result_path": str(result_file),
                    "error": None,
                    "elapsed_s": round(time.time() - t_model0, 1),
                }
                append_summary_log({
                    "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "slug": slug, "model": model, "launcher": launcher,
                    "status": "success", "elapsed_s": result["elapsed_s"], "error": None,
                })
                return result
            last_error = f"exit={exit_code}; {reason or '校验失败'}"
            if not timed_out:
                # 超时强杀不计入熔断：审查慢不等于链路故障（实证存在 1700s+ 健康审查），
                # 计入会把慢但健康的链路误熔断；其余失败喂完整输出供限流信号识别
                fail_output = ""
                try:
                    fail_output = (
                        err_file.read_text(encoding="utf-8", errors="replace")[:1000]
                        + "\n"
                        + result_file.read_text(encoding="utf-8", errors="replace")[:1000]
                    )
                except OSError:
                    pass
                _breaker_call(log_file, "record_failure", lambda: breaker.record_failure(launcher, fail_output or last_error, slug), None)
            log_event(log_file, f"[retry] {launcher} 产物校验失败，换备用 launcher: {last_error}")

        except Exception as exc:
            _breaker_call(log_file, "record_failure", lambda: breaker.record_failure(launcher, f"启动异常: {exc}", slug), None)
            last_error = f"启动异常: {exc}"
            log_event(log_file, f"[error] {launcher} {last_error}")
        finally:
            out_fd.close()
            err_fd.close()

    total_elapsed = round(time.time() - t_model0, 1)
    if skipped_open == len(launchers):
        last_error = f"全部 {len(launchers)} 个 launcher 熔断中（最后状态: {last_error}）"
    log_event(log_file, f"[degraded] {model} 全部 launcher 均失败: {last_error}")
    append_summary_log({
        "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
        "slug": slug, "model": model, "launcher": last_launcher,
        "status": "degraded", "elapsed_s": total_elapsed, "error": last_error[:200],
    })
    return {
        "target_model": model,
        "launcher": last_launcher,
        "status": "degraded",
        "prompt_path": str(review_dir / "prompt.md"),
        "result_path": str(result_file) if result_file.exists() else None,
        "error": last_error,
        "elapsed_s": total_elapsed,
    }


def main():
    parser = argparse.ArgumentParser(description="flow-agent 外部审查执行模板")
    parser.add_argument("--slug", required=True, help="审查 slug")
    parser.add_argument("--review-dir", required=True, type=Path, help="产物目录，需包含 prompt.md 或由 --prompt-file 指定")
    parser.add_argument(
        "--prompt-file",
        type=Path,
        default=None,
        help="prompt.md 路径，默认使用 <review-dir>/prompt.md",
    )
    session_group = parser.add_mutually_exclusive_group()
    session_group.add_argument(
        "--session-id",
        default=None,
        help="Claude Code session id；脚本会自动从 ~/.claude/projects 下查找对应 jsonl 并提取 assistant 文本写入 <review-dir>/target.md",
    )
    session_group.add_argument(
        "--session-file",
        type=Path,
        default=None,
        help="显式指定 session history jsonl 文件路径；提取 assistant 文本写入 <review-dir>/target.md",
    )
    parser.add_argument(
        "--caller-model",
        required=True,
        choices=list(MODEL_CONFIG.keys()) or None,
        help="主代理模型名",
    )
    parser.add_argument("--effort", default="normal", choices=["normal", "max", "ultra", "fable"], help="审查强度")
    parser.add_argument(
        "--target-model",
        default=None,
        help="强制指定目标模型（如 kimi-k3）或 auto；auto 时由 --effort 决定",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=None,
        help="覆盖默认超时秒数（默认 1800s）",
    )
    parser.add_argument(
        "--deep",
        action="store_true",
        default=False,
        help="深入审查模式（逐领域详查），kimi 视角升级为 kimi-k3-full（全量 k3）；默认 light 模式，注入前言框定为快速正交 sanity check",
    )
    parser.add_argument(
        "--no-preamble",
        action="store_true",
        default=False,
        help="跳过 light 前言注入（流程驱动审查用：调用方 prompt 完整定义审查流程与输出契约时，前言的"
        "「快速 sanity check / 一行结论」框定与之冲突）；校验仍按 light（非空即过），kimi 视角不升级",
    )
    # 旧 flag 迁移提示:--full 已改名 --deep(与 flow-dev --mode full 同名异义区隔),传入即报错
    if "--full" in sys.argv:
        print("错误: --full 已移除,请改用 --deep(深入审查模式)", file=sys.stderr)
        sys.exit(2)
    args = parser.parse_args()

    if not MODEL_CONFIG:
        print(
            f"错误: 缺少本机启动器配置 {LAUNCHERS_CONFIG_PATH}（或内容非法）\n"
            "  启动器链为本机私有配置，不随仓分发；请复制 configs/launchers.example.json\n"
            "  为 configs/launchers.json，并按本机 zsh profile 中的 launcher function 填写。",
            file=sys.stderr,
        )
        sys.exit(2)

    review_dir = args.review_dir.resolve()
    review_dir.mkdir(parents=True, exist_ok=True)

    # 处理 session id / session file：提取 assistant 文本作为被审查内容
    if args.session_id:
        session_file = find_session_file(args.session_id)
        if session_file is None:
            print(f"错误: 找不到 session id 对应的文件: {args.session_id}", file=sys.stderr)
            sys.exit(4)
    elif args.session_file:
        session_file = args.session_file.resolve()
        if not session_file.exists():
            print(f"错误: session 文件不存在: {session_file}", file=sys.stderr)
            sys.exit(4)
    else:
        session_file = None

    if session_file:
        target_file = review_dir / "target.md"
        target_text = extract_assistant_text(session_file)
        if not target_text.strip():
            print(f"错误: 从 {session_file} 中未提取到 assistant 文本", file=sys.stderr)
            sys.exit(4)
        target_file.write_text(target_text, encoding="utf-8")
        print(f"已从 session 提取 target.md: {target_file}", file=sys.stderr)

    prompt_file = (args.prompt_file or review_dir / "prompt.md").resolve()
    if not prompt_file.exists():
        print(f"错误: prompt 文件不存在: {prompt_file}", file=sys.stderr)
        sys.exit(1)

    run_dir = Path.home() / ".flow-dev" / "runs" / args.slug
    run_dir.mkdir(parents=True, exist_ok=True)

    prompt = prompt_file.read_text(encoding="utf-8")

    # light 模式（默认）注入前言框定审查范围；--deep 与 --no-preamble 保留调用方原始 prompt 不注入。
    # 写在调用方 prompt 之前，让审查模型先建立"快速 sanity check"的预期，抑制逐行深挖。
    # --no-preamble 服务流程驱动审查（如 flow-dev DevLoop 让外部模型执行 flow-code-review 流程）：
    # 调用方 prompt 自带流程与输出契约，前言的"一行结论"框定会与之冲突。
    if not args.deep and not args.no_preamble:
        prompt = LIGHT_PREAMBLE + prompt

    try:
        targets = select_targets(args.caller_model, args.effort, args.target_model, args.deep)
    except ValueError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        sys.exit(2)

    reviews = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(targets)) as executor:
        future_to_model = {
            executor.submit(
                run_one_model,
                args.slug,
                review_dir,
                run_dir,
                model,
                prompt,
                args.timeout,
                args.deep,
            ): model
            for model in targets
        }
        for future in concurrent.futures.as_completed(future_to_model):
            model = future_to_model[future]
            try:
                review = future.result()
            except Exception as exc:
                review = {
                    "target_model": model,
                    "launcher": "unknown",
                    "status": "failed",
                    "prompt_path": str(review_dir / "prompt.md"),
                    "result_path": None,
                    "error": f"执行异常: {exc}",
                    "elapsed_s": 0,
                }
                append_summary_log({
                    "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "slug": args.slug, "model": model, "launcher": "unknown",
                    "status": "failed", "elapsed_s": 0, "error": str(exc)[:200],
                })
            reviews.append(review)
            print(f"{model} 状态: {review['status']}", file=sys.stderr)

    result = {
        "slug": args.slug,
        "task": f"{args.caller_model} 完成外部审查",
        "caller_model": args.caller_model,
        "effort": args.effort,
        "mode": "deep" if args.deep else "light",
        "no_preamble": args.no_preamble,
        "reviews": reviews,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # 若全部模型 failed/degraded，返回非 0 退出码
    if all(r["status"] in ("failed", "degraded") for r in reviews):
        sys.exit(3)


if __name__ == "__main__":
    main()
