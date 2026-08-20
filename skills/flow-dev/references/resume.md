# 断点续跑盘点（Resume）—— 空参数形式下定位未完成的任务

`--resume` 不带 `<task-slug>` 时，先执行本文盘点流程，列出所有未完成的 run 供选择；选定后回到 SKILL.md 的标准 `--resume <task-slug>` 流程。带 slug 时不经过盘点流程，但「版本漂移判定」章节的选定后流程对两条路径同样适用。

盘点的数据源只有 `state.json`，它是唯一事实来源。不要凭终端历史、记忆或 docs/ 产物推断"还有什么没做完"——那些可以是线索，但必须能对应到一个含 `state.json` 的 run。

## 盘点流程

1. **扫描** `~/.flow-dev/runs/*/state.json`：
   - 没有 `state.json` 的目录直接跳过。`<slug>-code-review/` 等目录是外部审查的副产物（只有 `review-*.log/.pid`），不是任务 run
   - `state.json` 解析失败：列入清单并标记 `状态文件损坏`，不参与排序，禁止自动选定

2. **判定未完成**：`phase ∉ {done}`。`blocked` / `merge-conflict` 同样属于未完成，且因为携带 blocker 上下文，展示时排在该项目内的最前

3. **提取字段**（对照 `references/state-schema.json`）：
   - `slug`：`state.task_slug`；为空字符串或缺失时，回退到目录名
   - `repo`：`state.repo_root`；用 `test -d` 检查是否仍存在，不存在标记 `项目目录已失踪`
   - `phase`：原值展示，附中文注释（映射见下表）
   - 切片进度：`slices` 中 `status === 'done'` 的数量 / 总数，以及当前 slice 名（`current_slice_index` 指向者；缺失时取第一个非 `done` 的 slice；均为 `done` 则显示 `—`）
   - 阻塞：`blockers` 数量，以及最近一条的 `description`（截断到 60 字符）
   - 停止点：`stop_after` 非空时在备注列标注 `已停止于 <stop_after>`——该 run 是 `--stop` 主动停止（当前阶段已完整产出），区别于崩溃中断
   - 最后活动：`updated_at`；缺失时依次回退 `start_time`、`state.json` 的文件 mtime
   - 技能版本：`skill_versions["flow-dev"]`；缺失（0.1.0 之前的旧 run）时跳过版本漂移判定
   - `flags.worktree` 为 true 的标注 `worktree`，提示续跑前需按故障恢复章节重建 worktree
   - `flags.delegate` 为 true 的标注 `delegate`，提示未完成 Slice 续跑时按委托契约重新分派子代理

4. **排序**：当前 cwd 所在 repo（`git rev-parse --show-toplevel` 与 `repo_root` 相等）的 run 置顶，其余按最后活动时间倒序

5. **输出清单**（格式见下），然后进入"选定"环节

phase 中文映射：

- initialized：已初始化
- thinking：UltraThoughts 中
- grilling：grill-me 中
- prd-written：Step 2 完成（`--mode full` 时 PRD 已落档）
- devgoal：DevGoal 已确定
- slicing：切片中
- developing：开发中
- review：外部审查中
- fixing：修复中
- reporting：报告阶段
- merging：合并中
- blocked：已阻塞
- merge-conflict：合并冲突
- code-review：代码审查中

## 活跃度判定（防误续）

空参数盘点的头号风险是**续跑了一个别的会话正在跑的 run**——两个会话同时写同一个 `state.json`，状态互相覆盖。因此每个 run 必须过活跃度判定：

- **最后活动 < 60 分钟**：标记 `⚡ 疑似活跃`。大概率另一个会话正在执行，**禁止自动选定**；我手动选择时也必须先复述风险并确认
- **最后活动 > 7 天**：标记 `🕸 陈旧`。任务上下文可能已失效（代码已演进、需求已变化），选定前需向我确认任务是否仍然有效
- 介于两者之间：正常可续

## 版本漂移判定（防误续之二）

run 生成时的 flow-dev 版本与当前技能版本可能不同——技能在两次运行之间演进过，旧 `state.json` 的 phase 语义、产物路径约定可能已变化。判定分两层：

- **清单层**（廉价）：提取 `skill_versions["flow-dev"]`，与 `~/.claude/skills/flow-dev/SKILL.md` frontmatter 的 `metadata.version` 比较；不一致时在备注列标注 `⬆ 版本漂移 <旧>→<新>`。`skill_versions` 缺失（0.1.0 之前的旧 run）不标注、不参与本判定
- **选定后**（深入）：被标注漂移的 run 在续跑前，读 `~/.claude/skills/flow-dev/CHANGELOG.md` 中 (旧版本, 新版本] 区间的条目，判断是否存在影响续跑的变更（state schema、phase 状态机、产物路径约定、红线规则）：
  - 无影响：直接按标准流程续跑
  - 有影响：先向我复述变更点及其对当前 run 的影响，给出续跑方案（直接续 / 迁移 state.json 后续 / 放弃该 run）并确认。我未回应时，仅当有影响条目均不涉及当前 phase 及后续阶段的语义才续跑，否则停止并说明原因

其他技能（外部审查 runner 等）的版本仅作记录，不参与漂移判定——它们不拥有 state.json 的语义。

漂移判定通过后，将 `state.json` 的 `skill_versions` 更新为当前版本：判定是一次性的，不更新会让后续每次 resume 重复触发深入检查。

## 展示格式

```markdown
## 未完成的 flow-dev 任务（N 个）

| # | slug | 项目 | phase | 切片进度 | 当前 slice | 阻塞 | 最后活动 | 备注 |
|---|------|------|-------|---------|-----------|------|---------|------|
| 1 | 260726-cx-standalone-monorepo | cx-standalone（当前项目） | developing（开发中） | 7/8 | S8 收尾 | 0 | 07-19 10:02 | ⚡ 疑似活跃 |
| 2 | verify-dev-login-3286 | internal-app | reporting（报告阶段） | 1/3 | S2 xxx | 2 | 07-16 22:41 | 最近阻塞：验证码校验… |
```

- 项目列显示 `repo_root` 的末段目录名；属于当前项目的标注 `（当前项目）`
- 没有未完成 run 时，明确输出"没有未完成的 flow-dev 任务"并停止——盘点到此为止，禁止硬找一个任务来续

## 选定与兜底

列出清单后暂停，等我指定编号或 slug。**例外**：当前项目恰好只有一个未完成 run、且不携带 `⚡ 疑似活跃` / `状态文件损坏` 标记时，可直接选定它并在输出中声明，不再询问。

若我未回应选择，按以下优先级自行决策：当前项目中最后活动最近的正常 run → 全局最后活动最近的正常 run → 无正常 run 则停止并说明原因。`⚡ 疑似活跃` 与 `状态文件损坏` 的 run 永远不在自动决策范围内。

## 选定之后

按 SKILL.md 的 `--resume <task-slug>` 标准流程执行：读取该 run 的 `state.json`，恢复 `<repo-root>`、`<working-dir>`、`<original-branch>`、`<task-slug>` 与当前 phase，跳到对应 phase 继续。若 `flags.worktree` 为 true 而 worktree 已不存在，按 SKILL.md 故障恢复章节的规则重建。

若 `state.json` 的 `stop_after` 非空（`--stop` 触发的主动停止），当前阶段已完整产出：清除 `stop_after`，按 SKILL.md「停止点」章节的 resume 落点表进入**下一阶段**，禁止重做已完成阶段；`flags.stop` 为 `slice` 时保留该 flag（下一个 Slice 边界仍会停止），其余停止点已在触发时一次性消费。

## 边界情况清单

- run 目录无 `state.json`：跳过，不列入清单
- `state.json` 解析失败：列入清单，标记 `状态文件损坏`，禁止自动选定
- `task_slug` 为空：以目录名展示与续跑
- `repo_root` 目录已不存在：标记 `项目目录已失踪`，列入但不参与自动决策
- `phase` 为 `blocked` / `merge-conflict`：项目内置顶展示，附带最近一条 blocker 描述
- `slices` 为空或全 `pending`：进度显示 `0/0`，当前 slice 显示 `—`
- `skill_versions` 缺失：0.1.0 之前的旧 run，跳过版本漂移判定，其余照常
- `flags.delegate` 缺失：按 `false` 恢复（内联模式），旧 run 无此字段不视为错误
- `flags.delegate` 为 true 且当前 Slice 处于 `developing` / `reviewing` / `fixing`：子代理不参与续跑，按 `references/delegation.md`「中断与续跑」重新分派对应子代理（重派前先盘点工作区残留）
- `flags.mode` 缺失：0.1.x 旧 run（flags 仅有 `full` 布尔）：preflight mode 按 `flags.full === true` → `full`、否则 `light` 恢复；原 `--dev` run 无法从 flags 识别，由版本漂移判定承接（含 skill_versions 打标的旧 run 升至 v0.2.0 时必触发；v0.2.0 CHANGELOG 记录本 schema 变更，供漂移流程判读）
- `skill_versions["flow-dev"]` ≠ 当前版本：备注标注 `⬆ 版本漂移`，选定后按「版本漂移判定」深入一层
- 全部 run 均为 `done`：输出"没有未完成的 flow-dev 任务"并停止
- slug 带 `<YYMMDD>-` 前缀：新格式（2026-07-27 起），前缀为创建日期，字典序即创建时间序；与无前缀的旧 slug 同等处理，均可正常续跑
