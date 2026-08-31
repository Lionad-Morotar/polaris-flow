# flow-agent 降级路径与结果校验

本文件定义外部正交审查的执行、清理、校验与降级规则。

## 环境前提

本文件中的脚本使用 `zsh -c 'source ~/.zshrc 2>/dev/null; <launcher> ...'` 执行：先显式 source 用户 zsh profile 以加载各模型的 launcher function（否则报 `command not found`）。launcher 名册与降级顺序见 `configs/launchers.json`（本机配置，不入库）。不使用 `zsh -ic`——交互模式(-i)会触发 powerlevel10k 的 gitstatus 在无 TTY 子进程里初始化失败，产生淹没真实报错的 stderr 噪音。

## 审查精简配置

审查子进程不复用调用方（交互式 CC）的全局重型 settings，在 launcher 之后注入以下 flag/env，把与代码审查无关的负担挡在子进程外：

- **CLI flag**：`--disable-slash-commands`（禁用所有 skills，不把 80+ skills 注入 input）+ `--strict-mcp-config`（不传 `--mcp-config` 即零 MCP server，禁用全部 MCP，省 input 且免启动时连接十几个 server 的握手开销）+ `--allowedTools Read Grep Glob Bash`（审查四件套，禁写入避免误改代码）。
- **env 覆盖**：`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=0`（审查无需多代理协作，避免自发 fan-out）、`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=4`（审查串行为主，降并发资源占用）、`FLOW_REVIEW_PLAIN_STYLE=1`（驱动 zshrc 注入逻辑给 `--settings` JSON 加 `outputStyle: "Default"`——调用方的 user 级 outputStyle 会进入审查 session 的 system prompt，自定义风格会带偏审查输出格式；CC 无专用 env 禁 output style，`SAFE_MODE` 会连坐禁 hooks/CLAUDE.md，只能靠 `--settings` 同名键覆盖）、`CLAUDE_AFK_TIMEOUT_MS=1000`（AFK 自动推进：headless 审查无人应答 `AskUserQuestion` 时，超时后 CC 注入"proceed on best judgment"自动脱困，避免单次发问卡满 1800s watchdog；取 1000ms 极速脱困——审查 prompt 已框定不发问，任何发问都是异常噪声，1 秒后立即 proceed；不设 `CLAUDE_AFK_COUNTDOWN_MS`——headless 无 TTY 倒计时无效，且被 `min(countdown, timeout)` 截断为空 knob）。
- **不覆盖**：`CLAUDE_CODE_EFFORT_LEVEL` / `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 属用户全局偏好，保留原值。

跨模型实证（同 prompt 同 settings、`EFFORT=max`）：input 一致减半 ~51%（skills+MCP 稳占 baseline 一半 input）；duration 上 glm-5.3 −27%、deepseek 中性、kimi-k3 +45%（`max` effort 下禁 skills 会用更深 reasoning 补偿缺失的结构化引导），综合 input 减半对慢 API 的首 token 与传输收益为正。详见 `run-external-review.py` 的 `REVIEW_CLI_FLAGS` / `REVIEW_ENV_OVERRIDES`。

## 执行方式

每个目标模型独立执行，分两步：

1. **probe 探针**：先用最小 prompt（`ping (just reply me pong)`，硬上限 20s，预期 ~10s）调用 launcher，验证 zsh → claude CLI → API 全链路可用。仅 `command -v` 静态检查无法发现运行时故障（binary 损坏、API 认证失败、CLI 内部错误）；probe 不通则直接换备用 launcher，避免在坏链路上空耗一次完整审查周期。
2. **正式审查**：probe 通过后，通过该 launcher 启动外部审查子进程，输出重定向到 `review-<model>.md`。

以下脚本中 `<var>` 均为占位符，实现时需替换为实际路径或值（`run-external-review.py` 为参考实现，以它为准）：

```bash
(
  mkdir -p "$HOME/.flow-dev/runs/<slug>"
  # probe 探针：最小 prompt 验证全链路
  if ! zsh -c 'source ~/.zshrc 2>/dev/null; <launcher> -p "ping (just reply me pong)"' < /dev/null 2>/dev/null | grep -qi pong; then
    exit 3  # probe 失败：换备用 launcher
  fi
  # 正式审查：setsid 独立进程组 + stdin 重定向 /dev/null
  setsid zsh -c 'source ~/.zshrc 2>/dev/null; <launcher> -p "$(cat <prompt-file>)"' < /dev/null > <result-file> 2> <error-file> &
  cli_pid=$!
  echo "$cli_pid" > "$HOME/.flow-dev/runs/<slug>/review-<model>.pid"
  echo "<launcher>" > "$HOME/.flow-dev/runs/<slug>/review-<model>.launcher"
  (
    sleep <timeout-seconds>
    kill -9 -- "-$cli_pid" 2>/dev/null  # kill 整个进程组（pgid == cli_pid）
  ) &
  watchdog_pid=$!
  # 轮询等待 + 定期心跳日志，而非 wait 裸阻塞
  while kill -0 "$cli_pid" 2>/dev/null; do sleep 5; done
  wait "$cli_pid"
  cli_exit=$?
  kill "$watchdog_pid" 2>/dev/null
  wait "$watchdog_pid" 2>/dev/null
  exit $cli_exit
)
```

其中：
- `<slug>`：本次审查的 slug；
- `<launcher>`：模型的 zsh launcher function，取 `configs/launchers.json` 中该模型的 launchers 数组元素；
- `<prompt-file>`：prompt 文件路径；
- `<result-file>`：审查结果输出路径；
- `<error-file>`：stderr 输出路径；
- `<timeout-seconds>`：该模型的超时秒数；
- `review-<model>.pid`：**外部审查进程的真实 PID**（独立进程组组长，pgid == pid）；
- `review-<model>.launcher`：launcher 名，用于 resume 清理时的 PID 校验；
- `review-<model>.log`：运行日志（probe/launch/heartbeat/exit/retry 全过程），同内容回显 stdout。

stdin 必须显式重定向 `< /dev/null`：claude CLI 启动时会探测 stdin 数据，后台环境的 stdin 状态不可控（悬挂 pipe、TTY 继承等），显式置空可跳过该等待。

### 超时

各模型默认超时 1800s，以 `configs/launchers.json` 中该模型的 `timeout` 字段为准；`--timeout` 传入时覆盖，不应低于 1800（复杂审查实测可达 600s+）。

## Watchdog

每个目标模型使用**同会话后台 watchdog**，而不是 Cron：

1. 启动 launcher 子进程（独立进程组，pgid == pid）后，在后台启动一个 `sleep <timeout-seconds>` 的看门狗；
2. sleep 结束后**直接 kill 整个进程组**（`kill -9 -- -<pgid>`），不做"进程是否存活"预检；
3. 主流程感知子进程结束后，立即 `kill` watchdog 防止残留。

kill 整组而非仅父进程的原因：launcher 链为 zsh → claude CLI，父 zsh 先死时 claude 会成孤儿继续持有产物文件 fd 写入，造成"进程死了但产物还在变"的假象；进程组不因组长死亡而消失，killpg 对空组仅报 ESRCH，代价为零。预检用 `ps -p <pid>` 只能看到父 zsh，父死子存时会误判"已结束"而放过孤儿——曾因此泄漏孤儿进程。

watchdog 是主进程死亡场景的最后保险：主进程被杀后轮询与重试全部失效，只有独立看门狗的定时 killpg 能阻止孤儿泄漏。

## 进程组与 PID 有效性

新启动的审查子进程一律 `setsid` 独立进程组，killpg 安全（不会误伤调用方进程组）。

**resume 清理**（见下文）面对的可能旧版遗留进程没有独立进程组，kill 前仍须用 ps 校验命令行包含预期 launcher 名、且仅对进程组组长补 killpg：

```bash
expected_launcher=$(cat "$HOME/.flow-dev/runs/<slug>/review-<model>.launcher" 2>/dev/null)
actual_cmdline=$(ps -o command= -p "$old_pid" 2>/dev/null)
if printf '%s' "$actual_cmdline" | grep -qF "$expected_launcher"; then
  kill -9 "$old_pid" 2>/dev/null
  kill -9 -- "-$old_pid" 2>/dev/null  # 若是进程组组长则整组清理，否则报 ESRCH 跳过
fi
```

**禁止**使用宽泛模式匹配进程命令行，避免误杀用户其他 Claude 会话。

## 结果校验

每个模型审查完成后必须检查：

- [ ] 结果文件 `<output-dir>/<slug>/review-<model>.md` 存在；
- [ ] 文件大小 > 0 字节；
- [ ] 结构检查按模式分叉：light 模式只要求正文非空——light 前言契约规定无高/中严重度发现时整份输出仅一行阴性结论（如「未发现高严重度问题。」），这是合法交付形态，要求标题/条目会把它误判为 degraded（曾跨任务 9+ 轮复现，每轮触发同族 launcher 全链重试、空耗 20-30 分钟）；deep 模式要求内容至少包含一个标题或发现条目（例如 `# `、`## `、`- `、`1. `）；
- [ ] 内容不含大量 ANSI 控制字符（如 `[`）。实现侧应在写入前用 `sed 's/\x1b\[[0-9;]*m//g'` 或等效方式清洗，或在校验失败时清洗后重试校验。

任一检查失败即视为该模型本次启动失败：

1. 记录失败原因（exit code、stderr 摘要、结果文件状态）；
2. 按该模型的启动器优先级切换到下一个 launcher 重试；
3. 重试仍失败则该模型 `status = degraded`，记录错误原因。

若命令返回非零 exit code 但结果文件通过上述校验，按 `degraded` 处理并记录错误日志。

调用方裁决锚点：`status=degraded` 不直接等于真实失败——先 Read 产物核实，非空产物（含单行阴性结论）按实质通过采纳并记录降级原因，空产物才是真实失败。校验器层面的 light 单行结论误判已修复（light 不再要求标题/条目），该锚点仍适用于其他降级成因（launcher 层故障、非零 exit 等）。

## 降级路径

单个模型失败后，按 `configs/launchers.json` 中该模型的 launchers 数组顺序依次重试（每个 launcher 先试 probe 再正式跑，probe 失败直接跳过），数组穷尽则该模型 degraded。链的具体内容为本机配置，本文不列举。

跨模型不重试：`--effort` 已经决定了要审查的模型集合，一个模型失败不影响其他模型继续执行。

故障形态鉴别（避免把瞬时故障当环境损坏排查）：

- launcher 报 `_claude_run_with_version not found` 且产物 0 字节：launcher 版本分发逻辑的瞬时故障，不是 zsh function 环境损坏——删掉 0 字节产物后用原 launcher 直接重试即恢复（实证 91s 成功）；同族内一个备用被 kill、另一个报函数错先后出现也不代表整族不可用，同族备用逐一尝试即可。
- 单 launcher 静默空产物形态（exit=0 无任何报错但产物 0 字节）：脚本产物校验失败后会自动 fallback 同族备用 launcher（实证 565s 备用成功），无需手工删文件干预，让脚本走完自动降级链。
- 多族并发同症（第二族仍空产物或 probe 超时）是基础设施面故障（额度耗尽、服务侧波动），不是逐族串行重试能解决的——脚本自动降级链照走，调用方（flow-dev）按外部审查协议记 blocker 转 blocked 留现场，勿逐族空耗。
- 非空产物但内容是 API 错误文本（如 `Failed to authenticate. API Error: 403 You've reached your concurrent request limit`）：模型进程把限流报错当最终输出写出，exit=0、产物校验通过、runner 报 success——是假成功，不是通过。调用方收集产物时先扫首行/API Error 关键词，命中即按真实失败处置：状态记 failed 附错误文本，等待或换时段重试（实证间隔约 3 分钟后重试成功）。

该模型所有启动器都失败：
- 该模型 `status = degraded`；
- 在错误信息中记录失败原因；
- 调用方（如 `flow-dev`）将降级本身作为一个风险条目写入决策台账；
- **不阻塞**其他模型或后续流程，但需在最终报告中显式标注。

## 运行日志与调用审计

每次审查产生两级日志：

1. **运行日志** `~/.flow-dev/runs/<slug>/review-<model>.log`：带时间戳的全过程事件（`[start]`/`[probe]`/`[launch]`/`[heartbeat]`/`[exit]`/`[retry]`/`[success]`/`[degraded]`），同内容 flush 到 stdout，让后台 task 的 output 实时可见进度。无日志时"审查慢"与"进程已死"无法区分——曾发生 stdout 全静默 7 分钟、调用方只能靠考古排查的事故。
2. **全局摘要日志** `~/.flow-dev/logs/flow-agent.log`：每次调用追加一行 JSON（`ts`/`slug`/`model`/`launcher`/`status`/`elapsed_s`/`error`），跨 slug 审计调用历史与 launcher 健康度（如某 launcher 连续 probe 失败即可定位系统性故障）。日志写入失败静默跳过，不阻断审查主流程。

## Resume 与旧进程清理

`flow-dev` 支持 `--resume <task-slug>` 复跑同一任务。若同一 slug 再次发起外部审查，执行前必须清理该 slug 下旧的外部审查进程：

1. 遍历 `~/.flow-dev/runs/<slug>/review-<model>.*` 文件；
2. 若存在旧 `review-<model>.pid`，读取旧 PID；
3. 用 `ps -o command= -p <old-pid>` 校验命令行是否仍包含对应 launcher 名；
4. 若校验通过，执行 `kill -9 <old-pid>`；
5. 删除旧的 `pid`/`launcher`/`err` 文件，避免后续 watchdog 误判。

该步骤在启动新审查前完成，防止 resume 场景下孤儿审查进程泄漏。

## 与调用方协作

`flow-agent` 不直接操作 `state.json`。它只返回结构化结果：

```json
{
  "slug": "<slug>",
  "task": "<task-description>",
  "caller_model": "glm-5.3|kimi-k3|qwen-3.8-max|deepseek-v4-flash|minimax-m3",
  "effort": "normal|max|ultra",
  "reviews": [
    {
      "target_model": "kimi-k3",
      "launcher": "<launcher>",
      "status": "success|degraded|failed|skipped",
      "prompt_path": "<path>",
      "result_path": "<path>",
      "error": "<string|null>"
    }
  ]
}
```

调用方负责把该记录追加到 `state.json` 的 `reviews` 数组。
