# flow-dev 委托模式（--delegate）

`--delegate` 是与 `--mode` 正交的执行策略开关：流程深度、落档规则、外部审查检查点集全部沿用伴行 `--mode` 的既有规则，唯一变化是**谁来执行**——主代理收敛为编排者（Orchestrator），只保留规划、分派、验收与状态维护；一切实质性执行（开发、code-review、修复）交给子代理（Subagent）。目标是把主代理的轮次压缩到「发任务 + 收结果」，降低其上下文累积成本。

## 分工总表

| 阶段 | 主代理 | 子代理 |
|---|---|---|
| Step 0-3（初始化、UltraThoughts、grill-me、DevGoal） | 全部执行 | 不参与 |
| Step 4 Slice 开发 | flow-mem 预搜索、记录 Slice 基 ref、分派、验收、写 state | 开发、测试、提交 |
| Step 5 本地 code-review | 外部审查后台发起（仍走 Bash）；分派审查子代理 | 执行 flow-code-review |
| Step 6 外部正交审查 | 收集与合并（不委托，行为与内联模式一致） | 不参与 |
| Step 7 修复 | 分派、验收、`fix_round` 治理与 blocker 裁决 | 修复 Bugs、复跑测试、提交 |
| Step 8-9（最终报告、flow-mem 沉淀、worktree 收尾） | 全部执行 | 不参与 |

## 红线

- `state.json` 仅主代理可写：并行子代理写同一文件必然冲突，子代理一律不碰 `<run-dir>`
- 主代理不做实质开发：验收失败需要改动代码时，必须重新分派修复子代理，不得自己动手 Edit（编排者亲自下场会重新引入本模式要消除的上下文累积）
- 子代理不发起外部审查、不执行 flow-mem `--learn`、不写任何流程文档（docs/* 产物归主代理）
- 子代理的最终文本是唯一回传通道：主代理不读子代理中间过程，报告之外的一切视为不存在

## 分派契约

三类分派都使用 Agent 工具；无依赖且文件范围互不重叠的 Slice 可在同一条消息内并行分派多个开发子代理，串行 Slice 逐个分派。分派 prompt 按以下模板填充，禁止夹带与 Slice 无关的会话历史。

### 开发子代理

```
你是 flow-dev 委托模式下的开发子代理，负责一个垂直 Slice 的完整交付。

# 目标
<Slice 目标，来自 DevGoal>

# 文件范围
<该 Slice 允许触碰的文件/目录清单；清单外的文件禁止修改>

# 已知坑点
<主代理 flow-mem 预搜索命中的条目要点；无命中则写「无」>

# 纪律
- TDD：先写失败测试再实现（遵循 ~/.claude/skills/tdd/SKILL.md）
- 验收命令必须全部跑通：<验收命令清单，逐条列出>
- 提交：仅 git add 本 Slice 文件清单内的文件，禁止 git add -A / git add .；
  message 遵循项目 git log 既有风格，不夹带流程编号
- 提交失败（hook 拦截、lint 报错）时把失败输出当作新 Bug 继续修，直到提交成功
- 不执行 git push；不碰 .env；不修改本清单外的任何文件
- <若 --stage：不执行任何 git 提交，改动留在工作区，按返回契约输出提交计划>

# 返回格式（最终文本即返回值，严格遵守，全文 ≤30 行）
STATUS: done | blocked
COMMITS: 每行一条 「- <hash> <message>」；blocked 且无提交时写 none；--stage 时替换为 COMMIT_PLAN: 「- <建议 message> | <文件清单>」
VERIFY: 逐条验收命令 「- <命令> → pass|fail」
RESIDUAL: none | 逐条列出未解决问题
```

### 审查子代理

```
你是 flow-dev 委托模式下的审查子代理。读取 ~/.claude/skills/flow-code-review/SKILL.md
并按其流程执行一次本地 code-review：

flow-code-review --json --effort <档位> --base <Slice 基 ref>

--base 必填：本 Slice 改动已由开发子代理提交，缺省 target 会把前序 Slice 一并审进。
执行完成后，最终文本只输出 --json 契约的 findings JSON 数组本身，
无 findings 时输出空数组 []，不附加任何解释文字。
```

### 修复子代理

```
你是 flow-dev 委托模式下的修复子代理。以下是本轮待修复的 Bugs（含本地审查与外部审查合并结果）：

<bugs JSON 或逐条列表，含 file:line、问题描述、failure_scenario>

# 纪律
- 逐条修复，每条修复有对应测试佐证（遵循 ~/.claude/skills/tdd/SKILL.md）
- 修复后跑通：<验收命令清单>
- 提交纪律同开发子代理（仅 add 相关文件、遵循项目 message 风格、失败输出当新 Bug 继续修）
- 不执行 git push；<若 --stage：不提交，输出提交计划>

# 返回格式（同开发子代理，全文 ≤30 行）
```

## 返回契约

子代理报告采用固定字段行格式而非 JSON：子代理最终文本是自由生成物，强推 JSON 易被解释性文字污染，固定前缀行的容错性更好。主代理逐字段解析，`STATUS` / `COMMITS` / `VERIFY` / `RESIDUAL` 四个前缀外的内容一律忽略。

报告全文上限 30 行。分派模板已声明该上限；回传仍超限时，主代理只采信 `STATUS` 与 `COMMITS` 字段，`VERIFY` 缺口由验收清单的实际执行补齐。

## 验收清单（主代理，每个子代理返回后逐项执行）

报告是子代理的自述，不是证据——验收全部实际执行，不信任报告内容：

1. 跑 Slice 验收命令（DevGoal 里的那组，主代理亲自执行）
2. 核对提交：`COMMITS` 中每个 hash 存在，且 `git show --stat <hash>` 的文件不超出该 Slice 文件范围
3. `git status --porcelain`：工作区干净（`--stage` 时允许本 Slice 计划内改动残留，其余同样视为异常）
4. 回填 `state.json`：Slice `status`、`commits[]`（或 `commit_plan[]`）、`end_time`

任一验收失败：缺口转成 Bug 输入，重新分派修复子代理，计入 `fix_round`（上限仍按 `--depth` 查 `quality-gates.md`）。

## git 纪律

- 提交责任在子代理，安全责任在主代理：提交边界（仅本 Slice 文件）、message 风格、失败回炉写入分派模板；主代理通过验收清单第 2、3 项事后核对
- 并行 Slice 的提交竞争：两个子代理同时提交会竞争 `.git/index.lock`，持锁窗口很短——遇锁失败的一方等待重试，连续 3 次失败才以 `blocked` 返回
- Slice 基 ref：主代理在分派开发子代理前记录 `git rev-parse HEAD`，写入 `state.json` 该 Slice 的 `base_ref`，供审查子代理 `--base` 使用；resume 后跨 Slice 续跑也凭它恢复 diff 基线

## 中断与续跑

子代理没有 resume：分派后中断（崩溃、压缩、token 耗尽），主代理 `--resume` 时不寻找子代理残骸，按 `state.json` 的 Slice 状态重新分派——

- Slice `status` 为 `developing`/`reviewing`/`fixing`：重新分派对应子代理
- 重新分派前先盘点工作区：`git status --porcelain` + `git diff --stat`，把未提交残留清单写进新分派 prompt 的「已知坑点」段，由新子代理决定接续利用还是 `git checkout -- <file>` 回滚；主代理不替它做这个决定
- `status` 为 `done` 的 Slice 必然已完成验收与提交收口，直接跳过

## 对上游的强化要求

`--delegate` 使两项既有要求从「应当」升级为「必须」：

- DevGoal 每个 Slice 的验收标准必须是**可执行命令**（不是描述性文字）——它是子代理的交付目标与主代理的验收依据，同一份命令两端共用；描述性标准在委托链路上不可裁决
- Step 4 的 flow-mem 预搜索由主代理执行（属编排职责），命中条目要点必须注入分派 prompt——子代理不再自行检索知识库，避免每个子代理重复支付检索轮次
