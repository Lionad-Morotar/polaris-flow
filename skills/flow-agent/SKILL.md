---
name: flow-agent
description: 主动发起外部正交审查：调用者描述自己用什么模型做了什么，flow-agent 从正交视角启动一个或多个模型的快速外部检查
argument-hint: <target> --task "<模型与内容描述>" --slug <slug> [--caller-model <model>] [--target-model <model|auto>] [--effort normal|max|ultra|fable] [--deep] [--no-preamble] [--timeout <seconds>] [--output-dir <dir>]
metadata:
  version: 0.1.0-alpha.3
---

## 概念澄清

`flow-agent` 是一个**被主代理调用的调度型 skill**：主代理说明自己用什么模型、做了什么内容，`flow-agent` 按规则选择外部异模型，并通过对应的 zsh launcher function 启动正交审查。主代理只负责发起调用和接收 JSON 汇总，**不执行具体的审查过程**。

审查产物落到 `docs/reviews/<slug>/prompt.md` 与各模型的 `review-<model>.md`。

## 环境前提（必读）

`flow-agent` 依赖的各模型启动器都是 **zsh function**，只在已加载用户 zsh profile 的 shell 中可用。本机模型→启动器链配置在 `configs/launchers.json`（本机私有，不随仓分发；缺失时复制 `configs/launchers.example.json` 填写）。

- **正确检测**：`zsh -c 'source ~/.zshrc 2>/dev/null; command -v <launcher>'`（返回 function 定义路径或 function 名）。不用 `-i`：交互模式在无 TTY 子进程里会触发 powerlevel10k gitstatus 初始化失败，既污染 stderr，又可能致 function 加载不全。
- **错误检测**：在 `bash` 或未加载 profile 的 shell 中执行 `command -v <launcher>` 或 `which cc`，会返回空或 `/usr/bin/cc`（C 编译器），**这不代表环境不可用**，只是当前 shell 没加载 zsh profile。

`flow-agent` 本身在 Claude Code 进程中执行，Claude Code 通常已加载 zsh profile。执行外部审查时必须通过 `zsh -c 'source ~/.zshrc 2>/dev/null; <launcher> ...'` 调用（`run-external-review.py` 已封装此调用），以保证 function 可被解析。

## 何时使用

## 参数

- `<target>`（必填*）：被审查内容。可以是**文件路径**或一段摘要。目录作为 `<target>` 时，实现侧必须递归收集文本文件（如 `.md`、`.ts`、`.vue`、`.js`、`.json`）并按可阅读格式拼接；或明确拒绝目录并提示调用方指定文件。`$(cat <目录>)` 会报错，禁止直接对目录使用 `cat`。
- `--session-id`（默认 无）：替代 `<target>` 的方式之一：Claude Code session 的 UUID。脚本会自动从 `~/.claude/projects/<project>/<session-id>.jsonl` 提取主代理（assistant）的文本内容作为被审查对象。
- `--session-file`（默认 无）：替代 `<target>` 的方式之一：显式指定 session history jsonl 文件路径。
- `--task`（必填）：调用者描述：使用什么模型做了什么内容。例如 `"glm-5.3 完成 UltraThoughts 需求分析"`
- `--slug`（必填）：产物标识，用于 run 目录（`~/.flow-dev/runs/<slug>/`）、产物目录（`<output-dir>/<slug>/`）与 PID/错误日志命名。日期前缀由调用方负责：flow-dev 传入的 slug 形如 `260727-xxx-code-review`（`<YYMMDD>-` 创建日前缀），flow-agent 不自行添加
- `--caller-model`（默认 从 `--task` 解析）：主代理使用的模型名：`kimi-k3` / `kimi-k3-full` / `glm-5.3` / `glm-5.3-flash` / `qwen-3.8-max` / `deepseek-v4-flash` / `minimax-m3`
- `--target-model`（默认 `auto`）：目标审查模型名或 `auto`。`auto` 时由 `--effort` 和 `--caller-model` 决定启动哪些模型
- `--effort`（默认 `normal`）：审查强度：`normal`（启动一个与 caller 不同的模型，按映射表选择）/ `max`（normal + deepseek）/ `ultra`（所有非 caller 模型）/ `fable`（所有模型，包括 caller 模型，用于获得最大正交覆盖）
- `--deep`（默认 关闭（light））：审查模式。默认 **light**：注入前言框定为快速正交 sanity check（聚焦会真正造成故障的高/中严重度发现，不逐行 review、不穷举边界、不搜索所有领域；无高/中严重度发现时整份输出仅一行结论，禁止罗列已验证角度或复述验证过程/成功路径；见 `references/prompt-template.md`）。`--deep` 切换为深入审查，保留调用方原始 prompt 不注入前言，并把 kimi 视角升级为 `kimi-k3-full`（全量 k3·1M 上下文）；light 模式 kimi 视角用 `kimi-k3`（k3-256k，强度等同、消耗更低）。旧名 `--full` 已移除：与 flow-dev `--mode full` 同名异义区隔，传入时报错并提示新写法
- `--no-preamble`（默认 关闭）：跳过 light 前言注入，但不改变其余 light 行为（校验仍非空即过、kimi 视角不升级）。用于**流程驱动审查**：调用方 prompt 已完整定义审查流程与输出契约时（如 flow-dev DevLoop 让外部模型按 flow-code-review 流程执行并输出 findings JSON），前言的「快速 sanity check / 一行结论」框定与之冲突
- `--timeout`（默认 `1800`）：单模型审查超时秒数。一般无需覆盖；如需覆盖不应低于 1800（复杂审查实测可达 600s+）
- `--output-dir`（必填）：产物根目录，例如 `<working-dir>/docs/reviews`

*`<target>`、`--session-id`、`--session-file` 三者至少提供一个。

## 支持模型与启动器

- `kimi-k3`（light 默认档位，k3-256k）、`kimi-k3-full`（`--deep` 档，全量 k3·1M）
- `glm-5.3`、`glm-5.3-flash`、`qwen-3.8-max`、`deepseek-v4-flash`、`minimax-m3`

每个模型的 zsh 启动器链（数组顺序即降级优先级）与默认超时（1800s）配置在 `configs/launchers.json`——该文件是本机私有配置，不入库；脚本运行时读取，缺失或非法会拒跑并指向 `configs/launchers.example.json` 模板。

详见 `references/model-mapping.md`。

## `--effort` 选择规则（`--target-model auto` 时）

- `normal`：caller 为 glm-5.3 `kimi-k3`；caller 为 glm-5.3-flash `kimi-k3`；caller 为 kimi-k3 `glm-5.3`；caller 为 qwen-3.8-max `glm-5.3`；caller 为 deepseek-v4-flash `glm-5.3`；caller 为 minimax-m3 `glm-5.3`
- `max`：caller 为 glm-5.3 `kimi-k3` + `deepseek-v4-flash`；caller 为 glm-5.3-flash `kimi-k3` + `deepseek-v4-flash`；caller 为 kimi-k3 `glm-5.3` + `deepseek-v4-flash`；caller 为 qwen-3.8-max `glm-5.3` + `deepseek-v4-flash`；caller 为 deepseek-v4-flash `glm-5.3` + `kimi-k3`；caller 为 minimax-m3 `glm-5.3` + `kimi-k3`
- `ultra`：除 caller 族外的其余各族各一员（kimi 与 GLM 两族按下述规则选档）
- `fable`：全部 5 族各一员（含 caller 所在档位，同族另一档不重复计入）
- kimi 与 GLM 两族按审查模式选档：light 用低消耗档（`kimi-k3` / `glm-5.3-flash`），`--deep` 用强档（`kimi-k3-full` / `glm-5.3`）；caller 自身的同族自审条目保持发起档位不升级

## 工作流程

1. **解析参数与环境预检**
   - [ ] 确认 `<target>`、`--session-id`、`--session-file` 三者至少提供一个；若提供 `--session-id` 或 `--session-file`，自动提取 assistant 文本作为 `<target>`；
   - [ ] 确认 `--task`、`--slug`、`--output-dir` 已提供；
   - [ ] 若 `--caller-model` 未提供，从 `--task` 文本中识别模型名；
   - [ ] 确认 `--effort` 属于 `normal|max|ultra|fable`；
   - [ ] 确认 `--target-model` 为 `auto` 或支持的模型名；
   - [ ] 确认 `--output-dir` 目录存在，不存在则创建；
   - [ ] 若 `--target-model` 显式指定且等于 `--caller-model`（或与 caller 同族：`kimi-k3`/`kimi-k3-full` 互为同族，`glm-5.3`/`glm-5.3-flash` 互为同族），拒绝执行并返回错误；
   - [ ] 创建 `~/.flow-dev/runs/<slug>/` 目录（用于 PID、settings、错误日志）；
   - [ ] **环境预检**：运行 `node ~/.claude/skills/flow-agent/scripts/preflight.mjs`（按族检查启动器 + node/python3）。本次目标模型所属族 `ok` 为 false 时立即停止并报告环境错误；`active` 字段给出该族当前首选可用启动器

2. **确定产物目录**
   - [ ] 产物目录为 `<output-dir>/<slug>/`；
   - [ ] 若目录不存在则创建。

3. **选择目标审查模型集合**
   - [ ] 若 `--target-model` 为具体模型名：集合 = `{该模型}`，并校验该模型不等于 `--caller-model` 且不与 caller 同族（`kimi-k3`/`kimi-k3-full` 互为同族，`glm-5.3`/`glm-5.3-flash` 互为同族）；
   - [ ] 若 `--target-model` 为 `auto`：读取 `references/model-mapping.md`，根据 `--caller-model` 和 `--effort` 计算模型集合；`--deep` 时把集合中的 `kimi-k3` 升级为 `kimi-k3-full`（caller 自身的同族条目不升级）；
   - [ ] **`fable` 特殊规则**：仅在 `--target-model` 为 `auto` 时生效，集合包含 caller 模型本身；此时 caller 模型不计入"显式 target-model 等于 caller-model"的拒绝逻辑；caller 同族的另一档位不重复计入（caller 为 `kimi-k3` 时集合含 `kimi-k3` 本身、不含 `kimi-k3-full`）；
   - [ ] 记录每个模型的 `target_model` 与首选 `launcher`。

4. **准备 prompt**
   - [ ] 读取 `references/prompt-template.md` 通用框架；
   - [ ] 注入 `--task` 描述与 `<target>` 内容；
   - [ ] 把 prompt 写入 `<output-dir>/<slug>/prompt.md`（所有模型共用同一份 prompt）；
   - [ ] **调用每个目标模型前，将 prompt 中的 `<target-model>` 占位符替换为该模型的实际名称**（例如 `glm-5.3`、`deepseek-v4-flash`），避免模型自行推断。

5. **执行外部审查**
   - [ ] 对每个目标模型，按 `references/degradation-path.md` 通过其 zsh launcher function 启动子进程；
   - [ ] 启动前检查 `~/.flow-dev/runs/<slug>/review-<model>.*` 残留，若存在旧 PID 且命令行匹配当前 slug，先 `kill -9` 清理旧进程；
   - [ ] PID 写入 `~/.flow-dev/runs/<slug>/review-<model>.pid`；
   - [ ] 用同会话 Bash 后台 `sleep` 作为 watchdog，超时后校验并 kill 外部审查进程；
   - [ ] 多个模型可并发执行；
   - [ ] 正常返回后立即清理 PID/settings 文件并 kill watchdog。

6. **校验与降级**
   - [ ] 对每个模型，检查 `<output-dir>/<slug>/review-<model>.md` 存在、大小 > 0、不含大量 ANSI 控制字符；结构检查按模式分叉——light 只要求正文非空（无发现的一行阴性结论是前言契约内的合法交付形态，要求标题/条目会误判 degraded），deep 要求包含标题/条目；
   - [ ] 写入前或校验失败时用 `sed 's/\x1b\[[0-9;]*m//g'` 等工具清洗 ANSI；
   - [ ] 若某模型失败（含 0 字节或空内容），按该模型的备用启动器重试；
   - [ ] 该模型所有启动器均失败则标记 `status=degraded`，记录错误原因。

7. **返回结果**
   - [ ] 向调用方返回 JSON：
     ```json
     {
       "slug": "<slug>",
       "task": "<task-description>",
       "caller_model": "glm-5.3|glm-5.3-flash|kimi-k3|qwen-3.8-max|deepseek-v4-flash|minimax-m3",
       "effort": "normal|max|ultra|fable",
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

## 产物路径

```
<output-dir>/
  └── <slug>/
      ├── prompt.md
      ├── review-<model-1>.md
      ├── review-<model-2>.md
      └── ...
```

例如 `max` effort、caller 为 glm-5.3 时：

```
docs/reviews/<slug>/
  ├── prompt.md
  ├── review-kimi-k3.md
  └── review-deepseek-v4-flash.md
```

## 参考实现

`scripts/run-external-review.py` 提供了一个可直接运行的 Python 模板，封装了：

- 按 `--caller-model` / `--effort` 选择目标模型集合；
- probe 探针预检：每个 launcher 正式跑之前先用最小 prompt（`ping (just reply me pong)`，预期 ~10s）验证全链路可用，不通直接换备用 launcher；探针走 `--bare --no-session-persistence` 极简模式——跳过 hooks/skills/MCP/CLAUDE.md 自动发现，input 最小、不触发 SessionStart 钩子留痕、session 不落盘；
- 通过 zsh launcher function 启动外部审查（独立进程组 + stdin 置 DEVNULL）；
- 审查精简配置：注入 `--disable-slash-commands`（禁 skills）+ `--strict-mcp-config`（禁 MCP）+ `--allowedTools Read/Grep/Glob/Bash`，并 env 覆盖 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=0`、`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=4`（不碰 `EFFORT_LEVEL` / `AUTO_COMPACT_WINDOW` 这类用户全局偏好）。跨模型实证 input 一致减半 ~51%，对慢 API 的首 token 与传输有实打实收益；
- 轮询监控 + 心跳日志、超时 kill 进程组、校验输出、降级重试；
- 运行日志（run-dir 下 `review-<model>.log`）+ 全局摘要日志（`~/.flow-dev/logs/flow-agent.log`）；
- 返回与 `flow-agent` 技能一致的 JSON 结构。

用法示例：

```bash
python3 skills/flow-agent/scripts/run-external-review.py \
  --slug 260727-my-task-code-review \
  --review-dir docs/reviews/260727-my-task-code-review \
  --caller-model glm-5.3 \
  --effort max
```

用法注意（踩坑锚点）：

- `--review-dir` 一律传绝对路径——脚本按发起 shell 的 cwd 解析相对路径，在子仓内发起、docs 落主仓根的仓库结构下，相对路径会把 prompt.md 定位到子仓而报「文件不存在」exit=1；不确定 cwd 时先 pwd 再拼路径。
- 入口是 `python3` 不是 node——用 `node` 跑 `.py` 报 `ERR_UNKNOWN_FILE_EXTENSION`。
- `--caller-model` 在脚本入口按枚举硬校验，模型退役/新增后传旧名会 exit 2 拒发并列出合法枚举——按报错枚举修正即可，与 launcher 链路无关。

维护工具：`scripts/swap-launcher.mjs <A> <B> [--dry]` 原子交换同族两个启动器在 `configs/launchers.json` 中的优先级顺序——启动器链唯一事实源是该配置文件（本机私有，不入库），数组顺序即降级优先级，交换即全技能生效；A/B 须同族（guard 以同一模型的 launchers 数组同现为准）。

实现侧可在此基础上扩展（例如并发、更复杂的 prompt 注入、resume 清理等），但应保持 "通过 zsh launcher function 启动" 这一核心抽象。

## 跨会话熔断（circuit breaker）

runner 内置 launcher 级熔断器（`scripts/circuit_breaker.py`），状态落 `~/.flow-dev/circuit-breaker.json` 跨会话共享。解决场景：某账号限流（如 5 小时窗口）后，并行运行的多个 flow-dev 会话不再各自重复 probe 已限流的 launcher。

行为语义：

- **OPEN（熔断）**：熔断期内 runner 对该 launcher 零请求（probe 也不发），日志记 `[skip]`，直接顺延备用 launcher；一族全部熔断时该模型 `degraded` 且 error 注明。
- **冷却期取值**：限流信号（`429`/`使用上限`/`rate limit`/`quota`/`concurrent request limit` 等）立即熔断——含 403 形态的并发上限（Kimi），靠 `concurrent…limit` 特征词识别而非裸 403（403 也常意味凭证失效）；优先解析限流消息自带的服务端恢复时间（+120s buffer）；解析不到按 2min/1h/4h/7d/24d 五档累进（连续失败逐级加深，成功复位清零）。升至 7d/24d 档时 osascript 通知人工介入（headless 失败静默）。
- **HALF-OPEN（恢复试探）**：冷却到期后首个到达的会话经 flock 内 CAS 获得试探权（10min 未落地视为死亡可回收，其余会话继续跳过），probe 成功即复位，失败按上述规则再熔断。
- **超时豁免**：审查慢导致的超时不计入熔断（慢≠链路故障，实证存在 1700s+ 健康审查）。
- **fail-open 容错**：状态文件损坏（文件级/字段级）与熔断器自身异常都不阻断审查——净化损坏条目、集成点兜底放行，熔断器是保障层不是故障源。

preflight 集成：`preflight.mjs` 读取同一状态文件，OPEN 未到期 launcher 不担任族 `active`，`families[model].circuit` 输出熔断详情（cooldown 到期视为可试探，互斥归 runner）。

手动管理（CLI）：

```bash
python3 scripts/circuit_breaker.py status [--json]   # 查看熔断状态
python3 scripts/circuit_breaker.py reset <launcher>  # 复位（账号已恢复时）
python3 scripts/circuit_breaker.py reset --all       # 复位全部
python3 scripts/circuit_breaker.py trip <launcher> [原因] [--for <小时>]   # 手动熔断（默认 24h，线下已知账号不可用时；恢复用 reset）
```

## 错误处理

- 参数缺失或模型名不支持：直接返回错误，不执行审查；
- 单个模型调用失败：先在该模型备用启动器内重试，仍失败则该模型 `status=degraded`；
- 其他模型不受影响，继续执行；
- 调用方负责决定是否阻塞后续流程。

## 外部依赖

**所有 launcher 都是 zsh function，必须在已加载用户 zsh profile 的 shell 中执行。**

- 各模型（`kimi-k3` / `kimi-k3-full` / `glm-5.3` / `qwen-3.8-max` / `deepseek-v4-flash` / `minimax-m3`）的 launcher function 名册与降级顺序定义于 `configs/launchers.json`（本机配置，不入库）；
- launcher 经 `--settings` 注入 provider 配置（token 等凭证），函数定义通常在本机 `~/.zshrc` 中维护；
- `ps`、`kill`、`sleep`：用于 PID 校验与 Bash 后台 watchdog。

在 `bash` 或未加载 profile 的 shell 中，这些 function 会报 `command not found`，因此执行外部审查时必须使用 `zsh -c 'source ~/.zshrc 2>/dev/null; ...'` 或等价的 zsh 环境（不用 `-i`，原因见"环境前提"）。
