---
name: flow-code-review
description: lionad 的代码审查流程：按 effort 档位对 diff 做多角度审查（finder → dedup/verify → sweep），默认零子代理
argument-hint: "[target] [--effort low|medium|high|xhigh] [--base <ref>] [--json]"
metadata:
  version: 0.1.0-alpha.0
---

## 要求

* 本技能只做**发现与报告**：输出 findings，不修代码（correctness 修复归 flow-dev 的 tdd 循环，cleanup 修复归 /simplify）
* 严格按照流程执行，碰到以下阻塞按清单解决：
  * 进入了计划模式，生成了计划：你应当自动确认计划（注意，并非不做计划！而是先计划再自动确认）
  * 有决策需要我确认：按「审查覆盖完整性优先」自行决定
  * **不要暂停**：完成所有阶段，而不是分阶段汇报向我确认
* **按阶段读取对应 references，而不是初始化时一口气全读**（渐进披露，省上下文）

## 外部依赖入口

> 以下为环境固定事实，每次执行直接使用。Step 0 会做一次 preflight 自检，失败则停止。

- git — CLI：Phase 0 取 diff
- gh — CLI（可选）：target 为 PR 号时取 PR diff；缺失仅 PR 目标不可用，preflight 告警不阻断
- Agent 工具 — 运行时能力：仅 high/xhigh 的 verify 阶段使用；low/medium 零子代理

## 参数

- `[target]`（默认 当前改动）：PR 号、分支名或文件路径；缺省审 `@{upstream}...HEAD` 与工作区改动
- `--effort`（默认 `medium`）：`low` / `medium` / `high` / `xhigh`，见档位路由表
- `--base <ref>`（默认 无）：直接指定 diff 基（如 `origin/main`），跳过自动探测
- `--json`（默认 关闭）：输出 findings JSON 数组（程序化调用契约，flow-dev Step 5 用此模式）

## 档位路由

- `low`（快速）：finder 单次通读 diff；Phase 2 无；Phase 3 无；findings 上限 8；0 子代理
- `medium`（默认，precision）：finder 8 angles inline × ≤6 候选；Phase 2 dedup + self-check；Phase 3 无；findings 上限 8；0 子代理
- `high`（recall）：finder 8 angles inline × ≤6 候选；Phase 2 dedup + recall-biased verify；Phase 3 无；findings 上限 10；每候选 1 verifier
- `xhigh`（deep recall）：finder 10 angles inline × ≤8 候选；Phase 2 dedup + 3-state verify（recall 注解）；Phase 3 sweep ≤8 新候选；findings 上限 15；每候选 1 verifier

* **省 token 设计**：finder 一律 inline（在当前上下文顺序执行，不 spawn 子代理）；verify 是唯一使用子代理的阶段，仅 high/xhigh 启用
* 角度子集：8 angles = A 逐行扫描 / B 移除行为审计 / C 跨文件追踪 + Reuse / Simplification / Efficiency + Altitude / Conventions；10 angles 额外加 D 语言陷阱 / E 包装正确性

## Workflow

0. 初始化上下文
   - [ ] 解析参数 `[target]`、`--effort`、`--base`、`--json`
   - [ ] **Preflight 自检**：运行 `node ~/.claude/skills/flow-code-review/scripts/preflight.mjs`；失败则停止并报告
   - [ ] 按档位路由表确定本次的 finder 子集、verify 方式、是否 sweep、findings 上限

1. **Phase 0 — 取 diff**
   - [ ] `--base` 提供时：`git diff <base>...HEAD`
   - [ ] target 为 PR 号：`gh pr diff <n>`；分支名：`git diff <branch>...HEAD`；路径：限定该路径的 diff
   - [ ] 缺省：`git diff @{upstream}...HEAD`（无 upstream 用 `git diff main...HEAD` 或 `git diff HEAD~1`）
   - [ ] 范围 diff 为空或存在未提交改动时，追加 `git diff HEAD` 把工作区改动纳入审查范围（审查常发生在提交前）
   - [ ] diff 为空且无工作区改动：报告「无改动可审」并停止

2. **Phase 1 — 找候选**
   - [ ] 读取 `references/angles.md`
   - [ ] 按档位在当前上下文顺序执行 finder 角度（不 spawn 子代理）：`low` 单次通读；`medium`/`high` 8 angles；`xhigh` 10 angles
   - [ ] 每角度产出 ≤6（xhigh ≤8）候选，各含 `file`、`line`、一行 `summary`、具体 `failure_scenario`
   - [ ] **候选通过纪律**：凡能命名 failure_scenario 的候选一律放行——finder 默默丢弃半信半疑的候选是漏检主因

3. **Phase 2 — 去重与验证**
   - [ ] 读取 `references/verify.md`
   - [ ] dedup 近重复（同缺陷、同位置、同原因 → 保留 failure_scenario 最具体的一条），按严重度排序
   - [ ] `low`：跳过验证，直接进输出
   - [ ] `medium`：self-check——对照 diff 逐条复检候选，复检不过则丢弃
   - [ ] `high`：recall-biased verify——每候选 spawn 1 个 verifier 子代理（Agent 工具），返回 CONFIRMED / PLAUSIBLE / REFUTED，保留 C+P
   - [ ] `xhigh`：3-state verify + recall 注解——单个非 REFUTED 票即保留，不确定不丢

4. **Phase 3 — 补漏（仅 xhigh）**
   - [ ] 读取 `references/sweep.md`
   - [ ] 以持已有清单的新审查者视角重读 diff 与外围函数，只找清单外缺陷，≤8 新候选；无新发现则空跑，禁止凑数

5. **输出**
   - [ ] 读取 `references/output.md`
   - [ ] `--json`：输出 findings JSON 数组（即使 ReportFindings 工具可用也不调用）
   - [ ] 非 `--json` 且 ReportFindings 工具可用：单次调用 ReportFindings（含 `category`、`verdict`、`short_summary`）
   - [ ] 否则终端结构化文本：`file:line — 问题与具体失败`，最严重在前
   - [ ] 遵循档位 findings 上限与 minimum findings target（见 output.md）

## 与其他技能的关系

* `flow-dev` Step 5 以 `--json --effort <映射档位>` 调用本技能；外部正交审查在 Step 6 另行编排，本技能不集成
* cleanup 类发现（reuse/simplification/efficiency/altitude）的应用修复归 `/simplify`；correctness 修复归 flow-dev 的 tdd 循环
