---
name: flow-dev
description: 开发流程，将零散的需求任务重新组织成拆解、TDD Dev、Review、验证到维护记忆、更新文档的一整条的成熟工业流程。
argument-hint: <task description> [--mode light|full|quick|dev|fix] [--depth mvp|prod|hifi] [--dissection] [--worktree] [--skip-review] [--interactive] [--dry-run] [--stage] [--delegate] [--stop dissection|thinking|prd|devgoal|slice] [--resume [task-slug]]
metadata:
  version: 0.2.2
---
## 要求

* 本技能输出的**人类可读文档**默认不进入 git；**运行时状态**落到 `~/.flow-dev/runs/<task-slug>/`，同样不进 git。
* 严格按照流程执行，如果碰到以下阻塞按清单解决：
  * 进入了计划模式，生成了计划：你应当自动确认计划（注意，并非不做计划！而是先计划再自动确认）。
  * 有决策需要我确认：优先使用 `grill-me` 自答协议自行给出基于代码库证据的回答；只有 high-risk 决策才写入决策台账，附在最终报告中供我睡醒后 review。
  * **不要暂停**：完成所有阶段，而不是分阶段汇报向我确认，get all shits done。
* **根据阶段要求读取执行对应技能，而不是在初始化任务时一口气读取（这样会严重降低完成质量）。**
* 始终把 flow-dev 当作状态机执行：每完成一个 phase 就更新 `~/.flow-dev/runs/<task-slug>/state.json`，支持 `--resume` 断点续跑。

## 外部依赖入口

> 以下为环境固定事实，每次执行直接使用，无需重新搜索（搜了反而浪费轮次）。Step 0 会做一次 preflight 自检，失败则停止。

- grill-me / tdd — skill（SKILL.md）：读 `~/.claude/skills/<name>/SKILL.md` 后按流程执行
- to-prd — skill（SKILL.md）：仅 `--mode full` 使用：读 `~/.claude/skills/to-prd/SKILL.md` 后按流程执行
- flow-code-review — skill（`~/.claude/skills/flow-code-review/SKILL.md`）：DevLoop 审查流程（多角度 finder → 去重/验证 → findings JSON 契约）。默认由外部异族模型执行（Step 5 顶部后台发起，prompt 陈述本技能路径、effort 档位、`--base <base_ref>` 与 findings JSON 输出契约，Step 6 收集解析）；`--mode fix`、`--skip-review` 或外部执行运行时失败降级为本地以 `--json --effort <档位> --base <base_ref>` 调用；详见 Step 5 / 6
- flow-mem — skill（`~/.claude/skills/flow-mem/SKILL.md`）+ 脚本（`scripts/search.mjs`）：Step 0 `--worktree` 创建 worktree 前检索 git/worktree 环境坑点（--mode h4，只读）；Step 3 DevGoal 前概览现有框架（--mode frameworks，只读）并按任务类型检索 decisions 库既往用户决策（--kb decisions --mode h4，只读）；Step 4 每个 Slice 开发前按 Slice 预搜索坑点（--mode h4，只读）；Step 9 收尾沉淀本次运行产物（--learn，框架坑点归 framework 切片、用户表态过的偏好与决策归 decisions 切片）；未安装时相应步骤跳过并记入决策台账
- flow-agent — skill（`~/.claude/skills/flow-agent/SKILL.md`）+ 脚本（`scripts/run-external-review.py`）：外部审查 runner，按 `references/external-review-protocol.md` 契约调起与 caller 异族的外部模型执行审查，两种风格（`--style`）：需求理解类检查点（需求树拆解 / UltraThoughts / grill-me）用 `adversarial`（对抗发散——证伪关键主张 + 枚举未覆盖象限，产出盲区清单），code-review 检查点用 `orthogonal`（正交验证——检查已做的对不对，产出故障 findings）；在 UltraThoughts、grill-me、code-review（DevLoop 审查）检查点调用，详见 Step 1 / 2 / 5；code-review 检查点在 Step 5 顶部以后台并行方式发起（Bash `run_in_background`，附 `--no-preamble` 跳过 light 前言——前言的「快速 sanity check / 一行结论」框定与 flow-code-review 结构化流程冲突）、Step 6 收集结果，其余检查点同步调用；runner 负责选择并启动外部模型进程（可替换为任意按 protocol 契约实现的技能或脚本，最小实现只需一个能接收 prompt、产出 `review-<model>.md` 并按协议返回 JSON 的脚本）
- Agent 工具 — 运行时能力：仅 `--delegate` 使用，分派开发 / 审查 / 修复子代理，分派与返回契约见 `references/delegation.md`

## 参数与变量

### 参数

一句话记忆：**模式选 mode，质量选 depth，拆解加 dissection，断点 stop/resume，委托执行加 delegate，其余都是微调**。

模式与质量：

- `<task description>`（必填）：任务描述，用于生成 `<task-slug>`
- `--mode <mode>`（默认 `light`）：流程模式四档。`light`（精简）：跳过 `to-prd` 不生成 PRD，外部审查只保留 DevLoop 审查的 code-review 检查点（外部执行 flow-code-review 流程，每 Slice 恒执行一次，运行时失败自动降级本地执行，见 Step 5 / 6），UltraThoughts / 决策台账 / DevGoal / Bugs 终端输出不落档；`full`（完整）：追加 UltraThoughts、grill-me 两个外部审查检查点（code-review 检查点各模式均每 Slice 恒执行，见 Step 5 / 6；需求树拆解检查点由 `--dissection` 触发，与模式无关且恒执行），code-review effort 升为 `medium`（默认 `low`），执行 `to-prd` 生成并落档 PRD，且 UltraThoughts、决策台账、DevGoal、Bugs 也落档；`quick`（轻量直进）：保留 Step 1 UltraThoughts（终端输出不落档，同 light）但跳过 Step 2（grill-me / to-prd / 决策台账），DevGoal 直接从 UltraThoughts 推导（不经决策台账），适用于需求清楚但决策点寥寥、不值得走完整 grill-me 自答协议的场景；不生成 decisions.md（high-risk pending decision 由 UltraThoughts 目标定义性属性承载、最终报告显式列出）；code-review effort 维持 `low`——与 `--dissection`、`--stop dissection|prd` 互斥（`--stop thinking`/`devgoal`/`slice` 可用）；`dev`（开发直进）：跳过 Step 1（UltraThoughts / 需求树拆解）与 Step 2（grill-me / PRD），从会话上下文直接推导 DevGoal 并进入 TDD 开发循环，适用于上下文已充分讨论或已有文档产出的场景，code-review effort 维持 `low`——与 `--dissection`、`--stop dissection|thinking|prd` 互斥；`fix`（修复直进）：链路在 dev 基础上再收敛——DevGoal 直接从任务描述或会话上下文推导（flow-mem 框架概览 / decisions 检索与 tdd 技能读取保留），适用于已有 plan 或需求、知道怎么做的简单修复；DevLoop 审查恒本地执行（外部执行恒禁用，reviews[] 外部检查点记 skipped、不过 `review` phase）；Step 8 跳过最终报告落档，终端输出一行式小结（high-risk pending decision 在小结中列出）；默认 `--depth mvp`（显式 `prod` 可用）；code-review effort 维持 `low`——与 `--dissection`、`--stop dissection|thinking|prd`、`--depth hifi` 互斥（hifi 质量门含 DevLoop 审查外部执行通过，与 fix 恒本地执行冲突，需 hifi 时改用 `--mode dev`）。旧参数已移除：`--full` → `--mode full`，`--dev` → `--mode dev`，传入旧参数时报错并提示新写法
- `--depth`（默认 `prod`；`--mode fix` 时默认 `mvp`）：`mvp` / `prod` / `hifi`，决定 DevGoal 质量门、review effort、修复轮数上限；`hifi` 与 `--mode fix` 互斥（hifi 质量门含外部审查通过，与 fix 恒禁用外部审查冲突）
- `--dissection`（默认 关闭）：打开后 Step 1 执行需求树拆解（拆解纪律见 `references/dissection.md`），产物落档到独立的 `docs/dissections/<task-slug>.md`（不并入 UltraThoughts 文档，也不影响 UltraThoughts 的落档规则）

断点控制：

- `--stop <point>`（默认 空（不停））：在指定停止点完成产物后结束本轮执行、等待我操作，之后用 `--resume` 续跑；枚举与触发时机见「停止点」章节：`dissection`（需求树拆解后，隐式启用 `--dissection`）、`thinking`（UltraThoughts 后）、`prd`（PRD 落档后，隐式启用 `--mode full`）、`devgoal`（DevGoal 确定后）、`slice`（每个 Slice 修复完成后，重复生效）；非法值报错并列出合法值后停止
- `--resume [task-slug]`（默认 无）：从 `~/.flow-dev/runs/<task-slug>/state.json` 的 phase 断点续跑；省略 slug（空参数）时按 `references/resume.md` 盘点所有未完成 run，列出进度供选择

执行环境：

- `--worktree`（默认 关闭）：在隔离 worktree 中执行，读取 `references/worktree-mode.md`

行为微调：

- `--skip-review`（默认 关闭）：跳过全部外部审查检查点（含 Step 1 需求树拆解检查点与 Step 6 外部正交审查）
- `--interactive`（默认 关闭）：打开后 grill-me 等步骤可向我提问（默认自答）
- `--dry-run`（默认 关闭）：只打印执行计划，不动手
- `--stage`（默认 关闭）：提交策略开关。关闭时为 auto-commit：提交发生在每个 Slice 的 DevLoop 内（Slice 内子任务节点可提交、Step 7 修复收敛后提交收口，见 Step 4 / Step 7）；打开后 Loop 中不执行任何提交，改动逐 Slice 累积，每个 Slice 收尾仅记录提交计划（建议 message + 文件清单），Step 8 落档最终报告、Step 9 输出手动提交指引（计划回顾 + 执行顺序）由我按计划自行执行。与 `--worktree` 组合时 `--stage` 强制 keep 收尾（无已提交改动可合并回原分支）
- `--delegate`（默认 关闭）：执行策略开关，与 `--mode` 正交（任意模式可叠加，流程深度、落档规则、外部审查检查点集全部沿用伴行模式）。打开后主代理收敛为编排者：规划（Step 0-3）、分派与验收、DevLoop 审查外部执行发起、状态维护、最终报告与知识沉淀留在主代理；Slice 开发、DevLoop 审查降级本地执行时的审查、Bugs 修复等实质执行按 `references/delegation.md` 分派子代理。连带强化两条纪律：DevGoal 每个 Slice 的验收标准必须是可执行命令；验收一律实际执行不信任子代理报告，验收失败的修复重新分派而非主代理自己动手

### 变量

- `<repo-root>`（原项目 git 根目录）：`git rev-parse --show-toplevel`
- `<working-dir>`（当前实际工作目录）：非 worktree 时等于 `<repo-root>`；worktree 时为 worktree 路径
- `<original-branch>`（创建 worktree 前当前分支）：`git branch --show-current`
- `<worktree-branch>`（worktree 内部分支）：`worktree-<task-slug>`（由 `EnterWorktree` 创建）
- `<task-slug>`（任务标识）：形如 `<YYMMDD>-<body>`：`<YYMMDD>` 为创建日期（`date +%y%m%d`），`<body>` 从任务描述提取 kebab-case，ASCII-only，最大 40 字符；产物文件直接以 `<task-slug>` 命名（日期已含在 slug 中，字典序即创建时间序，便于索引）；`--resume` 续跑沿用原 slug，不按当天日期重新生成
- `<caller-model>`（当前主代理模型）：根据 Claude Code 实际使用的模型标识推断：`kimi` → `kimi-k3`；`glm` → `glm-5.3`；`qwen` → `qwen-3.8-max`；`deepseek` → `deepseek-v4-flash`；`minimax` → `minimax-m3`；默认 `glm-5.3`。合法枚举以 runner 的 `--caller-model` choices 为唯一真源（本表是快照），漂移时按其 exit 2 报错的合法枚举修正并同步本表
- `<run-dir>`（运行时状态目录）：`~/.flow-dev/runs/<task-slug>/`

## 输出模式

产物路径均相对 `<working-dir>`，`<slug>` = `<task-slug>`：

- 恒落档：DevLoop 审查·外部执行产物（外部执行发起时产生，含发起后运行时失败降级的情形；`--mode fix`/`--skip-review` 未发起则无此目录）`docs/reviews/<slug>-code-review/{prompt.md, review-<model>.md}`、最终报告 `docs/reports/<slug>.md`
- light / quick 终端输出、full 落档：UltraThoughts `docs/thoughts/<slug>.md`、DevGoal `docs/tdd/<slug>.md`、Bugs `docs/qa/<slug>.md`
- light 跳过、full 落档：外部审查·UltraThoughts/grill-me `docs/reviews/<slug>-{ultrathoughts, grill-me}/`、PRD `docs/plans/<slug>.md`
- 仅 `--dissection` 生成（与模式无关）：需求树拆解 `docs/dissections/<slug>.md` 及其外部审查 `docs/reviews/<slug>-dissection/`
- 决策台账：`--mode light` 恒写运行时 `<run-dir>/decisions.md`（外部审查输入），仅 full 落档 `docs/decisions/<slug>.md`；`--mode quick`/`dev`/`fix` 不生成 decisions.md，全文「记入决策台账」「写入决策台账」的指令退化为记入最终报告的 pending 备注（high-risk pending decision 段落；`--mode fix` 无最终报告，退化到终端小结列出），Step 9 flow-mem `--learn` 跳过该 input
- `--mode quick`：Step 1 UltraThoughts 终端输出（不落档），Step 2 全部跳过（不生成 decisions.md / PRD），DevGoal 从 UltraThoughts 推导、终端输出；其余产物规则同 light
- `--mode dev`：跳过 Step 1/2 全部产物，对应路径保持 `null`；Step 3 以会话上下文推导 DevGoal
- `--mode fix`：跳过 Step 1/2 全部产物（同 dev）；额外跳过最终报告落档，`outputs.report_path` 保持 `null`，终端输出一行式小结；其余产物规则同 dev
- 不生成 `docs/adr/`
- `--delegate` 不改变输出模式：产物集与落档规则沿用伴行模式，且全部产物仍由主代理产出（子代理只回传报告，不写任何文档——分派契约的红线）

light 终端输出需包含足够上下文，使我能直接继续下一阶段而不必回读文件。

## Worktree 模式

默认不在 worktree 中执行，`<working-dir>` 直接等于 `<repo-root>`。传入 `--worktree` 时，先读取 `references/worktree-mode.md`，再按其中规则进入隔离 worktree 并将 `<working-dir>` 指向 worktree 路径。

## 状态机

flow-dev 是一个状态机。每个 phase 转换必须更新 `<run-dir>/state.json`（schema 见 `references/state-schema.json`）。phase 列表：

```
initialized → thinking → grilling → prd-written → devgoal → slicing → developing →
code-review → review → fixing → reporting → merging → done/blocked/merge-conflict
```

提交不新增独立 phase：Slice 内的子任务提交与收尾提交挂在 `developing` / `fixing` 阶段内执行；提交收口完成是 Slice `done` 的前置条件（`--stage` 时为提交计划记录完成），保证 resume 语义——`done` 的 Slice 必然已固化在 git 历史（或已有落档计划）中。

`--mode dev` 从 `initialized` 直接跃迁到 `devgoal`，跳过 `thinking`、`grilling`、`prd-written`；`--mode quick` 跃迁 `initialized → thinking → devgoal`，保留 UltraThoughts（thinking）但跳过 `grilling`、`prd-written`；`--mode fix` 跃迁路径同 dev，且 Step 6 外部审查恒禁用不过 `review` phase、Step 8 不落档仅过 `reporting` phase 更新状态。

`--delegate` 不改变 phase 序列与跃迁规则：状态机描述「进行到哪个阶段」而非「谁在执行」，Slice 的开发 / 审查 / 修复仍映射 `developing` / `reviewing` / `fixing`。更新时机收敛为两处——分派子代理前置状态，验收通过后置结果；子代理执行期间不更新。

所有时间字段（`start_time`、`updated_at`、`end_time`、`blockers[].timestamp`）统一使用 `YYYY-MM-DD HH:mm:ss` 格式，并通过本地时区生成：

```bash
node -e "console.log(new Date().toLocaleString('sv-SE'))"
```

需求树拆解（`--dissection` 时）、UltraThoughts、grill-me、Slice 开发完成（code-review 检查点）后各有一个外部审查检查点，由外部审查 runner 执行；这些检查点不新增独立 phase，但会在 `state.json` 的 `reviews[]` 中分别记录。前三个检查点（需求理解类产物）用对抗发散审查（runner `--style adversarial`，见 `references/external-review-protocol.md`「审查风格」），code-review 检查点用正交验证（风格默认）。`--mode light`（默认）只保留 code-review 检查点与需求树拆解检查点（若 `--dissection` 开启）；`--mode full` 追加 UltraThoughts、grill-me 两个检查点（启用即执行）。code-review 检查点是 DevLoop 唯一审查、单轨执行：默认外部执行 flow-code-review 流程（外部异族模型按该技能流程审查并产出 findings JSON），每 Slice 恒执行一次；发起动作在 Step 5 顶部后台执行，与下一 Slice 只读调研并行，Step 6 收集 findings 并入 Bugs；`--mode fix`、`--skip-review` 或外部执行运行时失败降级为本地执行 flow-code-review（外部检查点记 `reviews[]` skipped/failed、不过 `review` phase，降级原因入决策台账与最终报告）。需求树拆解检查点是 Gate（恒执行，不适用跳过与降级规则）：审查失败或全部降级时 phase → `blocked`，拆解结果未经外部审查不得进入 Step 2。

## 停止点（--stop）

`--stop <point>` 把全自动流程切成两段：在指定阶段的产物完成、`state.json` 更新后执行**停止序列**，结束本轮执行并把控制权交还给我；review 产物后用 `flow-dev --resume <task-slug>` 从停止点继续。

- `dissection`：触发时机 Step 1 需求树拆解完成、拆解文档落档且外部审查 Gate 通过后；resume 落点 Step 1 剩余部分（目标定义性属性起），不重做拆解与拆解审查
- `thinking`：触发时机 Step 1 全部完成（含 `--mode full` 时的外部审查）后；resume 落点 Step 2（grill-me）
- `prd`：触发时机 Step 2 完成、PRD 落档后（隐式启用 `--mode full`）；resume 落点 Step 3（DevGoal）
- `devgoal`：触发时机 Step 3 完成、DevGoal 确定后；resume 落点 Step 4（首个 Slice）
- `slice`：触发时机 每个 Slice 的修复循环与提交收口完成（Step 7 末）、且仍有后续 Slice 时；resume 落点 Step 4（下一个 Slice）；重复生效直至无更多 Slice

`--mode dev` 下 `dissection`、`thinking`、`prd` 三个停止点不可用（对应阶段已跳过），Step 0 校验时报错并停止；仅 `devgoal`、`slice` 有效。`--mode quick` 下 `dissection`（与 quick 互斥）、`prd`（无 PRD 阶段）不可用；`thinking`、`devgoal`、`slice` 有效。`--mode fix` 同 dev：`dissection`、`thinking`、`prd` 不可用；`devgoal`、`slice` 有效。`--delegate` 不改变停止点可用性，沿用伴行模式；`slice` 停止点的触发时机为子代理返回且主代理验收、提交收口完成之后。

停止序列（各 Step 中写作「执行停止序列」时，均指以下五步）：

1. 若该阶段有文档产物且按输出模式表尚未落档，强制落档到对应路径并回填 `outputs.*_path`（`slice` 停止点无文档产物，产物即代码改动，终端输出 Slice 小结即可）
2. 更新 `state.json`：`stop_after` → 停止点名；除 `slice` 外将 `flags.stop` 置 `null`（一次性消费，`slice` 保留以在每个 Slice 边界重复停止）；刷新 `updated_at`
3. 清理 Task 列表中未开始的后续步骤
4. 输出停止报告：停止点、已完成内容摘要、产物路径、`<task-slug>`、续跑命令 `flow-dev --resume <task-slug>`
5. 结束执行，不进入后续阶段

`stop_after` 与 `phase` 的语义分工：`phase` 只表示"进行到哪个阶段"，无法区分该阶段是做完了还是中断了；`stop_after` 非空即显式标记"当前阶段已完整产出、为主动停止"。resume 时若 `stop_after` 非空，按上表落点进入下一阶段并清除 `stop_after`，禁止重做已完成阶段；为空时（崩溃中断）按原逻辑从 `phase` 续跑。

## Workflow

0. 初始化上下文

   - [ ] 解析参数 `--mode`、`--depth`、`--dissection`、`--worktree`、`--skip-review`、`--interactive`、`--dry-run`、`--stage`、`--delegate`、`--stop`、`--resume`；`--mode` 值必须是 `light`/`full`/`quick`/`dev`/`fix` 之一，非法值报错、列出合法值并停止；`--delegate` 与所有参数正交（无互斥项），读取 `references/delegation.md` 后生效；**旧参数迁移提示**：传入已移除的 `--full` 或 `--dev` 时，不静默忽略——报错并提示新写法（`--full` → `--mode full`，`--dev` → `--mode dev`）后停止；`--stop` 值必须是 `dissection`/`thinking`/`prd`/`devgoal`/`slice` 之一，非法值报错、列出合法值并停止；`--stop dissection` 隐式启用 `--dissection`（拆解是停止的前提，输出中声明该隐式启用）；`--stop prd` 隐式启用 `--mode full`（PRD 落档是该停止点的前提，输出中声明该隐式启用）
   - [ ] **`--mode dev` 互斥校验**：`--mode dev` 与 `--dissection`、`--stop dissection`、`--stop thinking`、`--stop prd` 互斥——同时传入时报错（列出冲突参数）并停止，不进入后续流程
   - [ ] **`--mode quick` 互斥校验**：`--mode quick` 与 `--dissection`、`--stop dissection`、`--stop prd` 互斥——同时传入时报错（列出冲突参数）并停止，不进入后续流程（`--stop thinking` 对 quick 有效：UltraThoughts 后停止）
   - [ ] **`--mode fix` 互斥校验**：`--mode fix` 与 `--dissection`、`--stop dissection`、`--stop thinking`、`--stop prd` 互斥（同 dev），另与 `--depth hifi` 互斥（hifi 质量门含外部审查通过，与 fix 恒禁用外部审查冲突）——同时传入时报错（列出冲突参数；hifi 冲突时提示改用 `--mode dev`）并停止，不进入后续流程
   - [ ] **若 `--resume` 带 slug**：读取 `<run-dir>/state.json`，恢复 `<repo-root>`、`<working-dir>`、`<original-branch>`、`<task-slug>`、当前 phase；`skill_versions["flow-dev"]` 与当前 SKILL.md frontmatter 的 `metadata.version` 不一致时，先按 `references/resume.md`「版本漂移判定」的选定后流程处理再续跑；一致或未版本化时直接跳到对应 phase 继续执行
   - [ ] **若 `--resume` 空参数**（后面紧跟其他 flag 或参数结束）：读取 `references/resume.md` 并执行盘点流程，选定 slug 后再按上一项恢复
   - [ ] **Preflight 自检**：运行 `node ~/.claude/skills/flow-dev/scripts/preflight.mjs --mode <full|light|quick|dev|fix>`（取 `--mode` 实参值；`--stop prd` 隐式启用时为 `full`；`--resume` 路径下从恢复的 `flags` 取值），确认所需 skill、外部审查启动器及 node/python3/git 环境；任一失败则停止并报告
   - [ ] 生成 `<task-slug>`，创建 `<run-dir>/`
   - [ ] 初始化 `state.json`（version=1，phase=`initialized`，depth，flags，start_time，以及 `skill_versions`——取自 Preflight JSON 的 `skill_versions` 字段，作为后续 resume 版本漂移判定的基准）
   - [ ] 确认项目环境、任务类型、任务深度
   - [ ] **初始化 git 上下文**：
     - [ ] 记录 `<repo-root>` = `git rev-parse --show-toplevel`
     - [ ] 记录 `<original-branch>` = `git branch --show-current`
     - [ ] 默认设置 `<working-dir>` = `<repo-root>`
   - [ ] **若传入 `--worktree`，读取 `references/worktree-mode.md` 并进入 worktree**：
     - [ ] 读取 `references/worktree-mode.md`
     - [ ] 检测当前是否已在 worktree 中
     - [ ] 检索 flow-mem 知识库 worktree 环境坑点（必须在创建 worktree 之前完成；若 `~/.claude/skills/flow-mem` 不存在则跳过本项并在决策台账记一笔）：运行 `node ~/.claude/skills/flow-mem/scripts/search.mjs --mode h4 --format line --query "git worktree EnterWorktree 基 ref 环境"`，按命中条目的预防写法执行
     - [ ] 若未在 worktree，按 `references/worktree-mode.md`「进入 worktree」的基分支纪律进入：`EnterWorktree` 默认 fresh 从 origin/默认分支取基 ref，trunk 非默认分支时须手动 `git worktree add` 指定基分支再以 path 进入
     - [ ] 设置 `<working-dir>` 为当前 worktree 根目录，并继承 `.env*` 等本地环境文件
   - [ ] **确保 docs 被 git 忽略**：
     - [ ] 检查 `git check-ignore -q <working-dir>/docs/plans`
     - [ ] 若未忽略，通过 `git rev-parse --git-path info/exclude` 获取 exclude 文件路径，追加 `docs/plans/`、`docs/dissections/`、`docs/decisions/`、`docs/tdd/`、`docs/qa/`、`docs/reports/`、`docs/reviews/`
     - [ ] **若 `--mode full` 或 `--stop thinking`**：额外检查并追加 `docs/thoughts/` 到 exclude（停止点落档规则见「停止点」章节）
     - [ ] 记录忽略机制到 `state.json`
   - [ ] 输出任务上下文到终端（含 `<repo-root>`、`<working-dir>`、`<original-branch>`、`<task-slug>`、`<run-dir>`、`<depth>`）
   - [ ] 若 `--dry-run`：打印执行计划（含 `--stop` 停止点位置）并停止
   - [ ] 更新 `state.json` phase → `initialized`
   - [ ] **使用 Task 工具创建任务列表**，模板（列表顺序即执行顺序）：
     - `Step 1: UltraThoughts 需求分析`、`Step 2: grill-me 自答 + 决策台账`（`--mode dev`/`fix` 不建这两条；`--mode quick` 不建 Step 2、保留 Step 1）
     - `Step 3: 规划 DevGoal 及 TDD 拆分 Slices`
     - `Step 4-7 S<i>: <Slice 名> DevLoop(开发→审查→修复→提交)`——每个 Slice 一条，按 DevGoal 的有序 Slice 列表展开；Slice 名凝练自该 Slice 目标并带关键对象（如 `Step 4-7 S1: 泄漏修复（mount/visibleOnHover）DevLoop(开发→审查→修复→提交)`）；`--delegate` 时条目改为 `DevLoop(分派→验收)`（提交由子代理在分派内完成）
     - `Step 8: 最终报告（及提交计划）`（`--mode fix` 改为 `Step 8: 终端小结（及提交计划）`）、`Step 9: 任务收尾`
     - Slice 条目随 Slice 边界同步状态（开始 → in_progress，完成 → completed）
1. 从用户输入或上下文，捕获我想构建的内容的原始想法，对原始想法进行**极其细致**的分析，扩充成 UltraThoughts

   - [ ] **若 `--mode dev` 或 `--mode fix`：跳过本步骤**（含需求树拆解与外部审查检查点），不产出 UltraThoughts / dissection 文档，`outputs.ultrathoughts_path` 与 `outputs.dissection_path` 保持 `null`
   - [ ] 已明确原始想法的来源（用户输入 / 会话上下文 / 文件路径）
   - [ ] **实现侧分析**：已从各角度（需求范围、架构、数据、模块、测试、工程）极其细致地分析
   - [ ] **若 `--dissection`**：执行需求树拆解（完整纪律见 `references/dissection.md`），拆解产物落档到独立文档（不并入 UltraThoughts）：
     - [ ] 从原始想法递归拆解为需求树；节点数量从需求本身推导，无固定层数与上限
     - [ ] 每个叶节点通过两条终止测试：**可独立验证**（能指出用什么实验 / 截图 / 测试 / 数据证伪，无需等待其他节点）、**原子性**（≤5 词命名且不含"和"，否则继续拆）
     - [ ] 每个节点含：名称、Why、验收标准（可观察 / 原子 / 可证伪 / 与命令或证据绑定）、显式依赖（节点编号，无则 none）
     - [ ] 已运行自我批评三问：可证伪性、原子性、覆盖完备性（叶节点并集 = 原始想法全部实质，不多不少）；发现的问题已就地重写
     - [ ] 需求树叶节点已标注为下游 grill-me 问题清单与 DevGoal Slice 划分的原料
     - [ ] 拆解文档（含自我批评三问的发现或 `clean` 裁决）写入 `<working-dir>/docs/dissections/<task-slug>.md`，设置 `outputs.dissection_path`
     - [ ] **外部审查检查点（需求树拆解，Gate，对抗发散）**：若未传 `--skip-review`，对拆解结果做对抗发散审查，未经检查不得进入下游（审查纪律见 `references/dissection.md`「外部对抗审查」；审查 prompt 按对抗发散框架（`flow-agent/references/prompt-template.md`）：陈述需求树的规模与覆盖边界——中间节点数、叶节点数、自我批评三问的裁决结果，对抗姿态与发散透镜由框架固定部分承载；不下达"重点关注 X"的审查指令）：
       - [ ] 在 `state.json` 的 `reviews[]` 中追加 `{ slug: '<task-slug>-dissection', task: '...', caller_model: '<caller-model>', effort: 'normal', style: 'adversarial', start_time: '<node -e "console.log(new Date().toLocaleString(\'sv-SE\')")>', end_time: null, reviews: [] }`
       - [ ] 生成 prompt.md 到 `<working-dir>/docs/reviews/<task-slug>-dissection/prompt.md`，内容含任务描述（`<caller-model> 完成需求树拆解`）、被审查文件（`docs/dissections/<task-slug>.md`）与对抗发散审查要求；随后同步调用 `python3 ~/.claude/skills/flow-agent/scripts/run-external-review.py --slug <task-slug>-dissection --review-dir <working-dir>/docs/reviews/<task-slug>-dissection --prompt-file <working-dir>/docs/reviews/<task-slug>-dissection/prompt.md --caller-model <caller-model> --effort normal --style adversarial`
       - [ ] 将返回的 JSON 回填到该 review 条目的 `reviews[]`，并设置 `end_time = node -e "console.log(new Date().toLocaleString('sv-SE'))"`
       - [ ] **若 runner 未返回 JSON，或全部 target_model 的 status 为 `failed`/`degraded`，禁止进入后续阶段**：记录 `external-review-failed` blocker，phase → `blocked`，在最终报告中显式标注；degraded 处置前先按鉴别锚点 Read 产物核实（单行阴性结论=校验器误判按通过记，空产物=真实失败，见 references/external-review-protocol.md「结果处理」）
       - [ ] 若任一模型 `status=degraded`（非全部），把降级原因写入决策台账
       - [ ] **Gate 裁决（一轮，不循环再审）**：逐条裁决审查发现——接受 → 就地重写拆解文档对应节点（波及父子关系时同步调整树结构）；驳回 → 决策台账记录驳回理由与代码库证据；裁决摘要（审查模型、发现条数、接受 / 驳回分布）追加到拆解文档末尾
     - [ ] **若 `--stop dissection`**：按「停止点」章节执行停止序列
   - [ ] **目标定义性属性（任务级成功契约，区别于 Step 3 的 Slice 级验收标准）**: 已识别"做对的标志"（而非"目标由什么组成"），并为每个属性给出可证伪验证——用什么实验 / 截图 / 测试 / 数据能证伪"我理解错了"。沿用 decision-ledger 的 Verification / Confidence 语义。示例：动效"暂停单帧不可读"→暂停截图验证；Bug 修复"输入 X 不再抛 Y"→复现用例由红转绿；性能"P95 从 A 降 B"→基准测试达标
   - [ ] **理解门禁（禁止自我放行）**: 清单（"目标由什么组成"）≠ 定义性属性（"做错的标志"），禁止凭特征 / 元素 / 结构清单或先验宣告"理解"。任一定义性属性置信度非 high 者，进入 Step 2 前必须通过实际取证（操作目标 / 读第三方原理解析 / 跑实验）提升，否则标记 high-risk pending decision 并在最终报告显式标注
   - [ ] 默认终端输出 UltraThoughts，不写文件，`outputs.ultrathoughts_path` 保持 `null`
   - [ ] `--mode full` 时输出到 `<working-dir>/docs/thoughts/<task-slug>.md` 并设置 `outputs.ultrathoughts_path`（`--dissection` 只影响拆解文档，不再强制 UltraThoughts 落档）
   - [ ] 更新 `state.json`：phase → `thinking`
   - [ ] **外部审查检查点（UltraThoughts，对抗发散）**：若 `--mode full` 且未传 `--skip-review`（审查 prompt 按对抗发散框架（`flow-agent/references/prompt-template.md`）：陈述 UltraThoughts 已产出的目标定义性属性与可证伪验证，审查模型对每项属性构造证伪场景、从属性未覆盖的视角枚举遗漏象限；不下达"重点关注 X"的审查指令）：
     - [ ] 在 `state.json` 的 `reviews[]` 中追加 `{ slug: '<task-slug>-ultrathoughts', task: '...', caller_model: '<caller-model>', effort: 'normal', style: 'adversarial', start_time: '<node -e "console.log(new Date().toLocaleString(\'sv-SE\')")>', end_time: null, reviews: [] }`
     - [ ] 生成 prompt.md 到 `<working-dir>/docs/reviews/<task-slug>-ultrathoughts/prompt.md`，内容含任务描述（`<caller-model> 完成 UltraThoughts 需求分析`）、被审查文件（`docs/thoughts/<task-slug>.md`）与对抗发散审查要求；随后同步调用 `python3 ~/.claude/skills/flow-agent/scripts/run-external-review.py --slug <task-slug>-ultrathoughts --review-dir <working-dir>/docs/reviews/<task-slug>-ultrathoughts --prompt-file <working-dir>/docs/reviews/<task-slug>-ultrathoughts/prompt.md --caller-model <caller-model> --effort normal --style adversarial`
     - [ ] 将返回的 JSON 回填到该 review 条目的 `reviews[]`，并设置 `end_time = node -e "console.log(new Date().toLocaleString('sv-SE'))"`
     - [ ] 若任一模型 `status=degraded`，把降级原因写入决策台账
   - [ ] **若 `--stop thinking`**：按「停止点」章节执行停止序列
2. 针对 UltraThoughts 执行 `grill-me` 技能；**仅 `--mode full`** 时在问询结束后使用 `to-prd` 技能把 PRD 文档沉淀到 `<working-dir>/docs/plans/<task-slug>.md`（`--mode light` 跳过 `to-prd`，不生成 PRD）

   - [ ] **若 `--mode dev` 或 `--mode quick` 或 `--mode fix`：跳过本步骤**（含 grill-me 自答、决策台账、to-prd 与外部审查检查点），`outputs.decisions_path` 与 `outputs.prd_path` 保持 `null`
   - [ ] 已读取 `~/.claude/skills/grill-me/SKILL.md`
   - [ ] 若 `--interactive`：按 grill-me 原流程逐题向我提问；否则执行**自答协议**：
     - [ ] 对每道问题基于代码库证据给出具体回答
     - [ ] 按 `references/decision-ledger-template.md` 记录：`假设 | 置信度 (high/medium/low) | 验证方式 | 代码库证据`
     - [ ] 置信度非 high 或风险为 high 的决策，标记为 `pending-high-risk-decision`
   - [ ] 已输出决策表格（含方案对比与最终选择）
   - [ ] 把决策台账写入 `<run-dir>/decisions.md`（运行时状态，恒写入；`--mode full` 时作外部审查检查点输入）
   - [ ] **仅 `--mode full`**：决策台账落档到 `<working-dir>/docs/decisions/<task-slug>.md`，设置 `outputs.decisions_path`
   - [ ] **外部审查检查点（grill-me，对抗发散）**：若 `--mode full` 且未传 `--skip-review`（审查 prompt 按对抗发散框架：陈述决策清单与已权衡维度，审查模型挑战选项空间是否枚举充分、被否决方案是否被 strawman、构造证伪所选决策的场景）：
     - [ ] 在 `state.json` 的 `reviews[]` 中追加 `{ slug: '<task-slug>-grill-me', task: '...', caller_model: '<caller-model>', effort: 'normal', style: 'adversarial', start_time: '<node -e "console.log(new Date().toLocaleString(\'sv-SE\')")>', end_time: null, reviews: [] }`
     - [ ] 生成 prompt.md 到 `<working-dir>/docs/reviews/<task-slug>-grill-me/prompt.md`，内容含任务描述（`<caller-model> 完成 grill-me 自问自答`）、被审查文件（`<run-dir>/decisions.md`）与对抗发散审查要求；随后同步调用 `python3 ~/.claude/skills/flow-agent/scripts/run-external-review.py --slug <task-slug>-grill-me --review-dir <working-dir>/docs/reviews/<task-slug>-grill-me --prompt-file <working-dir>/docs/reviews/<task-slug>-grill-me/prompt.md --caller-model <caller-model> --effort normal --style adversarial`
     - [ ] 将返回的 JSON 回填到该 review 条目的 `reviews[]`，并设置 `end_time = node -e "console.log(new Date().toLocaleString('sv-SE'))"`
     - [ ] 若任一模型 `status=degraded`，把降级原因写入决策台账
   - [ ] **仅 `--mode full`**：已读取 `~/.claude/skills/to-prd/SKILL.md`，并使用 `to-prd` 技能将 PRD 文档沉淀到 `<working-dir>/docs/plans/<task-slug>.md`；`--mode light` 跳过本项，`outputs.prd_path` 保持 `null`
   - [ ] 更新 `state.json`：phase → `grilling` → `prd-written`，`outputs.prd_path`（仅 `--mode full` 设置），`decisions[]`
   - [ ] **若 `--stop prd`**（已隐式启用 `--mode full`）：按「停止点」章节执行停止序列
3. 针对 PRD 文档（`--mode full`）或 UltraThoughts + 决策台账（`--mode light`）或 UltraThoughts（`--mode quick`：不经决策台账，high-risk 决策由目标定义性属性承载、最终报告显式列出）或任务描述 / 会话上下文（`--mode dev`/`fix`）执行 `tdd` 技能，并确定开发计划为 DevGoal

   - [ ] 概览 flow-mem 知识库现有框架（必须在读取 tdd 之前完成；若 `~/.claude/skills/flow-mem` 不存在则跳过本项并在决策台账记一笔）：运行 `node ~/.claude/skills/flow-mem/scripts/search.mjs --mode frameworks`，框架覆盖情况作为 DevGoal 拆分 Slice 边界的输入；Slice 级坑点检索在 Step 4 按 Slice 执行，不在本步进行
   - [ ] 检索 decisions 库既往用户决策（同上时机与跳过纪律）：先 `node ~/.claude/skills/flow-mem/scripts/search.mjs --mode decisions` 看任务类型清单，当前任务形态命中某类型（或语义相近）时以该任务类型词跑一次 `node ~/.claude/skills/flow-mem/scripts/search.mjs --kb decisions --mode h4 --format line --query <任务类型词>`（命中不足回退 `--kb decisions --mode fulltext --format line`），按绝对路径读取完整条目；命中的既往偏好与决策（验收标准、资产策略、形态取舍）作为 DevGoal 质量轴与验收标准的约束输入，条目的「适用范围」与当前任务不符时不套用；无命中是合法结果，不阻塞流程
   - [ ] 已读取 `~/.claude/skills/tdd/SKILL.md`
   - [ ] 已针对 PRD 文档（`--mode full`）或 UltraThoughts + 决策台账（`--mode light`）或 UltraThoughts（`--mode quick`：不经决策台账，high-risk 决策由目标定义性属性承载、最终报告显式列出）或任务描述 / 会话上下文（`--mode dev`/`fix`：从当前对话中已讨论的需求、约束与已有文档直接推导，不生成也不依赖 thought / dissection / plan 文档；`fix` 下 high-risk pending decision 由终端小结列出）确定开发计划 DevGoal
   - [ ] DevGoal 必须包含**有序 Slice 列表** `[S1, S2, ...]`，每个 Slice 有明确目标与验收标准；**dissection 的需求树不是 Slice**（`--dissection` 时）：叶节点仅为拆分原料，Slice 根据 DevGoal 与需求树以 TDD 手段拆分——可聚合多个关联叶节点为一个可测试的垂直切片，禁止按叶节点一一对应
   - [ ] **若 `--delegate`**：每个 Slice 的验收标准必须是**可执行命令**（不是描述性文字）——它是子代理的交付目标与主代理验收清单的同一份依据，描述性标准在委托链路上不可裁决（见 `references/delegation.md`「对上游的强化要求」）
   - [ ] 默认终端输出 DevGoal；`--mode full` 时写入 `<working-dir>/docs/tdd/<task-slug>.md`
   - [ ] 更新 `state.json`：phase → `devgoal`，`outputs.devgoal_path`，`slices[]`（初始状态均为 `pending`，`start_time` / `end_time` 初始为 `null`）
   - [ ] **若 `--stop devgoal`**：按「停止点」章节执行停止序列
4. 自动确认 DevGoal，按顺序进入每个 Slice 的 开发 → 审查 → 修复 循环

   - [ ] 已自动确认 DevGoal
   - [ ] **并行窗口（可选）**：无依赖且文件互不重叠的 Slice，可用子代理并行开发（分派 prompt 写清目标、文件范围与验收命令）。内联模式（未传 `--delegate`）子代理不执行 git 操作——并行 Slice 的提交统一由主代理在各 Slice 收口时按各自文件清单串行执行；`--delegate` 时提交归子代理，并行提交的锁竞争处置见 `references/delegation.md`「git 纪律」
   - [ ] 对每个 Slice 执行以下子流程：
     - [ ] 声明当前 Slice 名称与目标
     - [ ] 更新 `state.json`：`current_slice_index`，该 Slice `status → developing`、`start_time → node -e "console.log(new Date().toLocaleString('sv-SE'))"`，phase → `slicing` → `developing`
     - [ ] 预搜索 flow-mem 知识库（必须在进入该 Slice 开发之前完成；若 `~/.claude/skills/flow-mem` 不存在则跳过本项并在决策台账记一笔）：以三类查询词各跑一次 `node ~/.claude/skills/flow-mem/scripts/search.mjs --mode h4 --format line`（命中不足回退 `--mode fulltext --format line`；结果清单 `| head -100` 截断审阅，首行 hits=count/total 或 truncated 表明 total 超过所见条数时加大行数翻完，只见头部几条不得下「无相关命中」结论）——Slice 目标关键词、涉及的依赖包名、本 Slice 计划使用的工具与环境名（如浏览器驱动、测试 runner、构建部署链路；知识库高频收录工具类坑点，漏查工具词会在工具卡顿时重复踩已被记录的弯路），按命中结果的绝对路径读取完整条目，前序 Slice 已读取过的条目直接复用不重复读取；上一 Slice Step 5 并行调研窗口已完成本 Slice 三类检索与条目读取的，本项整体视为已完成、直接复用不重复检索；命中的已知坑点与版本特定行为作为当前 Slice 的开发约束，在本 Slice 开发中主动规避（约定见 `~/.claude/skills/flow-mem/references/search.md`，检索只读不改知识库）
     - [ ] 记录 Slice 基 ref：`git rev-parse HEAD`，写入 `state.json` 该 Slice 的 `base_ref`——DevLoop 审查凭它框定本 Slice 的 diff 范围（外部执行在 prompt 中陈述，本地执行以 `--base` 传入），resume 后跨 Slice 续跑也凭它恢复 diff 基线
     - [ ] **若 `--delegate`**：主代理不亲自开发——按 `references/delegation.md` 开发模板分派开发子代理（预搜索命中的坑点要点注入分派 prompt）；子代理返回后逐项执行验收清单并回填 `state.json`；验收失败的缺口转 Bug 输入，按 Step 7 规则重新分派修复（计入 `fix_round`）。以下内联开发项不适用
     - [ ] 内联模式（未传 `--delegate`）：进入开发，直到该 Slice 的 DevGoal 达成；**开发中允许子任务提交**（`--stage` 时除外）：完成一个内聚子任务即可提交（仅 `git add` 该子任务涉及的文件），提交纪律同 Step 7 收口项；子任务提交非必须，Slice 收尾统一收口见 Step 7
5. 当前 Slice 的 DevGoal 达成时，发起 DevLoop 审查（默认外部执行 flow-code-review 流程；完整约定见 `references/external-review-protocol.md`）

   - [ ] 已确认当前 Slice 的 DevGoal 达成（按 `--depth` 查 `references/quality-gates.md`）
   - [ ] 若未达成：记录 `slice-blocked` blocker，写 blocker 报告，phase → `blocked`，停止
   - [ ] **DevLoop 审查·外部执行（默认路径）**（传入 `--mode fix` 或 `--skip-review` 时跳过本项，走本地执行分支）：外部异族模型执行 flow-code-review 流程——正交视角与结构化纪律一遍完成，是 DevLoop 唯一审查，每 Slice 恒执行一次
     - [ ] 由主代理直接调用 runner，禁止通过 `Agent` 工具 spawn 子代理执行（后台指 Bash `run_in_background`，仍是主代理本人发起，与该约束不冲突）
     - [ ] 在 `state.json` 的 `reviews[]` 中追加 `{ slug: '<task-slug>-code-review', task: '<caller-model> 完成 Slice 开发', caller_model: '<caller-model>', effort: 'normal', start_time: '<node -e "console.log(new Date().toLocaleString(\'sv-SE\')")>', end_time: null, reviews: [] }`
     - [ ] 生成 prompt.md 到 `<working-dir>/docs/reviews/<task-slug>-code-review/prompt.md`，内容：任务描述（Slice 名与目标）、审查仓库 `<working-dir>`（外部模型执行 git 命令前先 cd 到该目录）、diff 基线 `base_ref`（本 Slice 改动 = `git diff <base_ref>...HEAD` + 工作区未提交改动）、审查方法（读取 `~/.claude/skills/flow-code-review/SKILL.md` 及其 references 并按其流程执行，调用语义等价于 `--json --effort <档位> --base <base_ref>`）、Slice 验收标准（只陈述事实、不下达关注指令）、输出契约（仅输出 flow-code-review `--json` 契约的 findings JSON 数组，以 JSON 代码围栏包裹，无问题输出 `[]`）；prompt 模板见 `references/external-review-protocol.md`「DevLoop 审查 prompt」
     - [ ] 后台调用 runner（Bash `run_in_background: true`；发起后不等待结果，继续本步骤后续项，结果在 Step 6 收集）：
       ```bash
       python3 ~/.claude/skills/flow-agent/scripts/run-external-review.py \
         --slug <task-slug>-code-review \
         --review-dir <working-dir>/docs/reviews/<task-slug>-code-review \
         --prompt-file <working-dir>/docs/reviews/<task-slug>-code-review/prompt.md \
         --caller-model <caller-model> \
         --effort normal \
         --no-preamble \
         --timeout 1800
       ```
       `--no-preamble` 必传——light 前言的「快速 sanity check / 一行结论」框定与 flow-code-review 结构化流程及 findings JSON 契约冲突。注意两层 effort 勿混：runner `--effort`（normal|max|ultra|fable，选模型集合）恒 normal 不随 mode 漂移；flow-code-review 档位（low|medium，审查强度）只进 prompt 语义与本地降级调用——把档位值传进 runner 会 exit 2（invalid choice）
   - [ ] **DevLoop 审查·本地执行（降级路径）**（仅 `--mode fix` 或 `--skip-review` 传入时执行；外部执行运行时失败由 Step 6 回溯降级到本分支）：内联模式加载 flow-code-review 技能（`~/.claude/skills/flow-code-review/SKILL.md`），以 `--json --effort <档位> --base <base_ref>` 调用；**若 `--delegate`** 按 `references/delegation.md` 审查模板分派审查子代理（`--effort` 同档位，`--base` 必传该 Slice 的 `base_ref`），子代理最终文本即 findings JSON
   - [ ] review effort 按运行模式选择（详见 `references/quality-gates.md`）：
     - [ ] `--mode light`（默认）/ `--mode quick` / `--mode dev` / `--mode fix` → `low`
     - [ ] `--mode full` → `medium`
     - [ ] `high` / `xhigh` 不在自动流程启用；需要更深审查时人工直接跑 `flow-code-review`
   - [ ] 该 effort 作用于 flow-code-review 流程本身（无论外部执行还是本地执行）；runner 的 `--effort`（模型数量）锁定 `normal`，与之解耦
   - [ ] 更新 `state.json`：phase → `code-review`，当前 Slice `status → reviewing`
   - [ ] **下一 Slice 并行调研窗口**（仅当外部执行已后台在跑且仍有后续 Slice 时执行；否则跳过本项）：利用外部执行等待期，在主代理上下文内对下一个 Slice 做只读调研（不 spawn 子代理，保持可随时收尾进入 Step 6）
     - [ ] flow-mem 预搜索：查询词与检索纪律同 Step 4 预搜索项（三类查询词、`--format line`、`head -100` 审阅）；窗口已完成三类检索与条目读取的，后续 Slice 的 Step 4 预搜索项视为已完成，直接复用不重复检索
     - [ ] 代码与方案调研：阅读下一 Slice 计划触及的代码与相关依赖文档（Context7 / 搜索技能等只读来源），形成实现思路草稿
     - [ ] **禁止任何写入**：不改代码、不写文档、不更新 Slice 状态、不执行 git 操作与 flow-mem --learn；调研结果以终端小结输出、不落档
     - [ ] 会合纪律：调研完成而外部审查未结束，进入 Step 6 用 TaskOutput 阻塞等待；外部审查完成通知先到，收尾当前调研动作即进入 Step 6
6. **DevLoop 审查结果收集，确认待修复问题 Bugs**（外部执行的发起点在 Step 5 顶部、后台并行；本步收集 findings 并入 Bugs，位于修复之前；本地执行直接使用 Step 5 所得 findings JSON）

   - [ ] **外部执行路径**（Step 5 已后台发起）：
     - [ ] 用 TaskOutput 阻塞收取 Step 5 后台任务的输出，取得 runner 返回的 JSON
     - [ ] 将返回的 JSON 回填到该 review 条目的 `reviews[]`，并设置 `end_time = node -e "console.log(new Date().toLocaleString('sv-SE'))"`
     - [ ] **degraded 鉴别锚点**：任一模型 `status=degraded` 时先 Read 其 `result_path` 产物核实内容——产物含可提取的 findings JSON（含 `[]`）按实质通过记；产物为空或缺实质内容 = 真实失败（见 references/external-review-protocol.md「结果处理」）
     - [ ] **运行时失败降级本地执行**（runner 未返回 JSON，或全部 target_model 的 status 为 `failed`/`degraded` 且产物不可采纳，或产物无法提取出 findings JSON）：`--depth hifi` 时不降级——记录 `external-review-failed` blocker，phase → `blocked`（hifi 质量门含外部执行通过，降级会使其失效；恢复后 `--resume` 可重发收集，blocked 现场保留）；否则不阻塞——回溯执行 Step 5 本地执行分支，把外部检查点 failed/degraded 记录与降级原因记入 `reviews[]`，降级原因写入决策台账与最终报告，随后以本地执行的 findings 继续确认 Bugs
     - [ ] 读取各审查产物 `review-<model>.md`，提取 findings JSON 数组合入 Bugs（去重；逐条按 failure_scenario 具体性裁决严重度纳入 P0/P1）
     - [ ] 更新 `state.json`：phase → `review`
   - [ ] **本地执行路径**（`--mode fix`/`--skip-review`，或外部执行运行时失败降级而来）：将 Step 5 所得（或降级执行所得）findings JSON 合入 Bugs（去重、严重度裁决）；不过 `review` phase
     - [ ] Step 5 未发起外部执行时（`--mode fix`/`--skip-review`）：在 `state.json` 的 `reviews[]` 中追加一条 code-review 检查点记录（slug `<task-slug>-code-review`，`start_time` = `end_time` = 当前时间，`reviews: [{ status: 'skipped', error: '<跳过原因>' }]`——跳过原因按实际填 `fix 模式禁用外部执行` 或 `--skip-review 禁用外部审查`）
   - [ ] 已确认待修复问题 Bugs
   - [ ] 默认终端输出 Bugs；`--mode full` 时写入 `<working-dir>/docs/qa/<task-slug>.md`
   - [ ] 更新 `state.json`：`outputs.bugs_path`
7. 针对 Bugs（含外部审查发现）执行 `tdd` 技能，自动推进修复，但有轮数上限

   - [ ] 已读取 `~/.claude/skills/tdd/SKILL.md`
   - [ ] 当前 Slice 进入 `status → fixing`，phase → `fixing`，`fix_round` 自增
   - [ ] 自动推进全部 Bugs 修复：内联模式主代理直接执行；**若 `--delegate`** 按 `references/delegation.md` 修复模板分派修复子代理（附 Bugs 清单与验收命令），返回后逐项执行验收清单（同 Step 4）；主代理不亲自修代码
   - [ ] 修复后复跑相关测试与 Slice 验收命令确认收敛——**不复跑审查**：审查每 Slice 只发生一次（Step 5/6），复跑会对修复 diff 产生新 findings，把修复轮次拖入递减收益循环；收敛判据 = Bugs 逐条关闭（每条修复有测试佐证）且测试与验收命令通过。`--delegate` 时收敛 = 主代理实际执行验收清单逐项通过（见 `references/delegation.md`），不重新分派审查子代理
   - [ ] **提交收口**（Bugs 全部关闭后执行；Slice `done` 的前置条件；worktree 模式下在 `<working-dir>` 中提交；`--delegate` 时提交已由修复子代理按分派纪律完成，本项退化为验收清单的提交核对与工作区校验，并把 `commits[]` 回填 `state.json`）：
     - [ ] 提交边界：仅 `git add` 归属当前 Slice 的文件清单，禁止 `git add -A` / `git add .`（避免卷入非本 Slice 改动或来源不明的残留）；`docs/*` 产物与 `<run-dir>` 已被忽略、不进提交。多会话并行同仓时 add 与 commit 之间仍存在竞态窗口（他人暂存会被裹挟）：提交后立即 `git show HEAD --stat` 核对文件清单仅含本 Slice 文件；发现裹挟且分叉点上无他人新提交时 `git reset --mixed HEAD~1` 卸出全部（工作区零丢失）再原子化 add+commit，他人已叠交时按 flow-mem `git/commit-index-scope.md` 的 reflog 流程重建归属
     - [ ] **若 `--stage`**：不执行提交，把本 Slice 提交计划（建议 message + 文件清单；Slice 内多 commit 时逐条列出）记入 `state.json` 该 Slice 的 `commit_plan[]`，跳过本项其余子项
     - [ ] 执行提交：message 遵循项目 `git log` 既有风格（`feat:`/`fix:` 等前缀与项目一致、垂直切片语义），不夹带流程编号（Slice 序号、Step、审查轮次等）；Slice 内多个内聚子任务可分多个 commit；每个 commit 成功后把 `{ hash, message }` 记入 `state.json` 该 Slice 的 `commits[]`
     - [ ] **提交失败回炉**（不记 blocker、不停止）：失败输出（pre-commit hook 拦截、lint 报错等）视为新 Bug 输入，回到本步骤开头继续下一轮（`fix_round` 自增），直至提交成功；未提交干净不得离开本 Slice
   - [ ] 若仍有未关闭 P0/P1（含提交收口未成功）且未达 `--depth` 对应上限（见 `references/quality-gates.md`），回到本步骤开头继续下一轮
   - [ ] 若达到上限仍有未关闭 P0/P1（含提交收口未成功）：
     - [ ] 写 `~/.flow-dev/runs/<task-slug>/blocker-report.md`
     - [ ] 当前 Slice `status → blocked`，phase → `blocked`
     - [ ] 停止并进入最终报告
   - [ ] 若当前 Slice 完成（修复收敛且提交收口完成），Slice `status → done`、`end_time → node -e "console.log(new Date().toLocaleString('sv-SE'))"`；**若 `--stop slice` 且仍有后续 Slice**：按「停止点」章节执行停止序列（resume 后进入下一个 Slice）；否则进入下一个 Slice（回到 Step 4）；若无更多 Slice，进入 Step 8
8. 输出最终报告（我会在睡醒后查看），以及汇总提交记录（`--stage` 时为逐 Slice 提交计划）

   - [ ] **`--mode fix` 分支：跳过最终报告落档**（`outputs.report_path` 保持 `null`，本步骤「最终报告必须包含」清单不适用），改为终端输出一行式小结：`<task-slug>`、逐 Slice 完成状态与 `commits[]` 的 hash + message（`--stage` 时为提交计划、blocked Slice 残留显式标注）、high-risk pending decision（如有）、blocker 报告链接（如有）；随后直接执行本步骤的 state 更新项
   - [ ] 已输出最终报告到 `<working-dir>/docs/reports/<task-slug>.md`
   - [ ] 最终报告必须包含：
     - [ ] `<task-slug>` 与 `<run-dir>`
     - [ ] 决策台账（`--mode light`/`full` 时含；`--mode quick`/`dev`/`fix` 不生成 decisions.md，改为列出 high-risk pending decision 备注）
     - [ ] 每个 Slice 的完成状态（含 `start_time`、`end_time`）
     - [ ] 各外部审查检查点状态（各检查点 slug、caller_model、effort、`start_time`、`end_time`、reviews[] 中每个 target_model 的 status，含 degraded 情况；DevLoop 审查降级本地执行的，附降级原因）
     - [ ] blocker 报告链接（如有）
     - [ ] 提交记录：逐 Slice 列出 `commits[]` 的 hash 与 message；blocked Slice 的残留未提交改动显式标注。`--stage` 时替换为逐 Slice 提交计划（各 Slice `commit_plan[]` 的建议 message 与文件清单，执行顺序即 Slice 顺序）
   - [ ] 已经输出提交记录（`--stage` 时为提交计划）到终端
   - [ ] 更新 `state.json`：phase → `reporting`，`outputs.report_path`（`--mode fix` 保持 `null`）
9. 任务结束与 worktree 收尾

   - [ ] 清空 Tasks
   - [ ] 主动触发 flow-mem 知识沉淀（若 `~/.claude/skills/flow-mem` 不存在则跳过）：读取 `~/.claude/skills/flow-mem/SKILL.md`，执行其 --learn 分支（沉淀固定在收尾执行、不随 Slice 循环进行：开发中途的结论未经完整验证，过早沉淀会写入假知识），内容来源为本次 flow-dev 运行产物而非整个会话——`<run-dir>/decisions.md`（`--mode quick`/`dev`/`fix` 不生成，跳过该 input）、`<run-dir>/blocker-report.md`（如有）、最终报告（`outputs.report_path`；`--mode fix` 不落档，跳过该 input）、`<working-dir>/docs/reviews/` 下本次运行的外部审查发现（`--mode fix` 恒禁用外部审查，无此 input），以多个 `--input <路径>` 传入；`--mode fix` 下输入通常仅剩 blocker-report.md（如有），无输入时按入库门槛（顺利实现不沉淀）跳过 --learn 并终端一行说明；按 flow-mem 的入库门槛沉淀——框架与库的技术知识（调试弯路、候选核实、版本行为）归 framework 切片；任务中有我明确表态（纠正、否决、拍板、显性验收）锚定的偏好与决策归 decisions 切片；没有弯路的顺利实现与任务业务细节不沉淀；知识库为本地积累目录（不入版本控制），沉淀产物不进本项目提交
   - [ ] 更新项目相关文档（如有）
   - [ ] **提交动作（按 `--stage` 分支）**：
     - [ ] 默认（auto-commit）：所有已完成 Slice 已在各自 DevLoop 中提交收口，本步无剩余提交动作；`git status --porcelain` 校验工作区——若有残留（blocked Slice 未提交改动或来源不明的异常残留），不自动提交，终端显式标注交由我处理
     - [ ] `--stage`：不执行提交，终端输出手动提交指引——逐 Slice 提交计划回顾（完整计划已落档最终报告 `outputs.report_path`）、声明本轮未提交改动、由我按计划自行执行
   - [ ] 若本次使用了 `--worktree`：
     - [ ] 在最终报告末尾追加 worktree 收尾决策
     - [ ] **若 `--stage`**：无已提交改动即无可合并内容——跳过合并询问，强制 keep 分支；收尾决策写明原因与后续步骤（手动提交后把 `<worktree-branch>` 合并回 `<original-branch>` 再清理，流程见 `references/worktree-mode.md`）
     - [ ] 用户回复 yes（合并并清理）：
       - [ ] **收尾守门（postflight）**：运行 `node ~/.claude/skills/flow-dev/scripts/postflight.mjs <task-slug> --apply`——幂等接回 docs 产物到 `<repo-root>` 并校验（产物一致性 / 切片提交在祖先链 / 工作区无残留）。exit 非 0 时停止合并流程、保留 worktree，按 failures 清单处置后重跑（工作区残留时禁止使用 `ExitWorktree` remove 丢失残留；产物被 git 忽略不随 merge 走，跳过接回直接清理会随 worktree 删除丢失）
       - [ ] 切回 `<repo-root>` 的 `<original-branch>`，用 `git branch --show-current` 重新确认
       - [ ] 执行 `git merge --no-ff <worktree-branch>`
       - [ ] **若冲突**：停止、不自动解决、写 `merge-conflict` blocker、phase → `merge-conflict`、保留 worktree（产物仍在 worktree 内，冲突解决后可重走接回与清理）
       - [ ] 若合并成功，使用 `ExitWorktree` 的 `action: "remove"` 退出并清理 worktree
     - [ ] 用户回复 keep 或未回复：
       - [ ] 使用 `ExitWorktree` 的 `action: "keep"`，仅恢复原始 cwd
       - [ ] 保留 worktree 目录与分支供手动 review；建议同样跑 postflight `--apply` 接回产物（最终报告等以 `<repo-root>` 为单一查看入口），不接回时收尾决策注明产物仍在 worktree、未来清理会丢失
   - [ ] 更新 `state.json`：phase → `done`/`merge-conflict`/`blocked`，`end_time`

## BAN

- ban 向我解释"为何停在 SX 而非继续做 SX–SX"，**没有任何理由，你应当按照计划完成所有 Step**

## 安全红线

- 永不执行 `git push --force`。
- 永不 checkout 或 push 到 `<original-branch>` / `<worktree-branch>` 之外的分支。
- 永不直接在默认分支上提交改动；提交只发生在 Slice 的 DevLoop 内（子任务节点与 Slice 收尾收口），且每次提交只含当前 Slice 的文件
- 永不在 `<repo-root>` 或 worktree 中运行可能删除或覆盖未跟踪产物的命令。

## 故障恢复

- 会话崩溃、context 压缩或 token 耗尽后，使用 `flow-dev --resume <task-slug>`。
- 记不清 slug 时，使用 `flow-dev --resume`（空参数）按 `references/resume.md` 盘点所有未完成 run，列出项目与进度后选定。
- `<task-slug>` 可在最终报告、终端输出或 `~/.flow-dev/runs/` 目录中找到。
- `--resume` 会读取 `<run-dir>/state.json` 并从最后记录的 phase 继续。
- `--stop` 触发的主动停止同样可用 `--resume` 续跑：`state.json` 的 `stop_after` 非空表示当前阶段已完整产出，按「停止点」章节表格的落点进入下一阶段（禁止重做），并清除 `stop_after`。
- 若 worktree 已被清理但状态仍在，可按 `state.json` 中的 `repo_root` 重新进入或创建 worktree。
- `--delegate` 下子代理不参与续跑：分派后中断的 Slice 按 `state.json` 状态重新分派对应子代理，重派前的工作区残留盘点与交接见 `references/delegation.md`「中断与续跑」。
