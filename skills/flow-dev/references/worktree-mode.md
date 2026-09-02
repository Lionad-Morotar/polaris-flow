# flow-dev worktree 模式

`--worktree` 启用时，`flow-dev` 在隔离的 git worktree 中执行完整开发流程，保证主仓库工作区始终干净。

## 变量定义

- `<repo-root>`（原项目 git 根目录）：`git rev-parse --show-toplevel`（进入 worktree 前记录）
- `<working-dir>`（当前实际工作目录）：worktree 模式下为 worktree 路径；非 worktree 模式下为 `<repo-root>`
- `<original-branch>`（创建 worktree 前当前分支）：`git branch --show-current`
- `<worktree-branch>`（worktree 内部分支）：`worktree-<task-slug>`（由 `EnterWorktree` 创建）

## 进入 worktree

1. 若当前路径已在 worktree（路径含 `.claude/worktrees/`），直接使用当前 worktree，记录 `<repo-root>` 与 `<original-branch>`。
2. 若未在 worktree，先确认基分支再进入——`EnterWorktree` 默认基 ref 是 `fresh`（从 origin/默认分支，如 origin/master），并非本地当前 HEAD；trunk 开发在非默认分支（如 develop）时，直接 `EnterWorktree` 会让 worktree 基点落后主干数百提交、文件结构完全不同：
   - 优先手动创建：`git worktree add <repo-root>/.claude/worktrees/<task-slug> -b worktree-<task-slug> <base>`（`<base>` 取当前开发分支，如 develop），再以 `EnterWorktree` 的 `path` 参数进入该 worktree。
   - 基分支即默认分支（本地 HEAD 与 origin/默认分支同步）时可直接 `EnterWorktree` 创建。
   - 已误建可就地修复：worktree 内 `git reset --hard <base>`，不必拆除重建。
   - 确保 `<repo-root>/.gitignore` 包含 `.claude/worktrees/`（无则追加，不覆盖已有规则）。
3. 禁止同一分支同时存在多个 worktree。

## 上下文继承

- 将 `<repo-root>` 下的 `.env*`、`.env.local` 等本地环境文件复制或软链接到 `<working-dir>`。
- 子代理、外部命令（ck/cg、npm/pnpm、测试脚本）默认以 `<working-dir>` 为 cwd。

## 退出策略

`flow-dev` 的 worktree 退出行为**与 CLAUDE.md 通用 quit worktree workflow 不同**：

- 默认在最终报告后询问：是否将当前 worktree 的改动合并回 `<original-branch>` 并清理 worktree，以便在原分支 review。
- 若用户同意：
  1. 在 `<working-dir>` 中确保所有改动已提交（逐 Slice 提交后正常路径天然满足；blocked Slice 有未提交残留时停止合并清理，先处置残留）。
  2. **收尾守门（postflight）**：运行 `node ~/.claude/skills/flow-dev/scripts/postflight.mjs <task-slug> --apply`——幂等接回 docs 产物到 `<repo-root>` 并校验（产物一致性 / 切片提交在祖先链 / 工作区无残留），exit 非 0 时停止合并清理、按 failures 清单处置后重跑。产物被 git 忽略、不会随 merge 进入 `<original-branch>`，跳过本步直接清理 worktree 会静默丢失产物（有前科）。
  3. 切回 `<repo-root>` 的 `<original-branch>`。
  4. 执行 `git merge --no-ff <worktree-branch>`（trunk-based 项目按 CLAUDE.md 使用 `--no-ff`）。
  5. 使用 `ExitWorktree` 的 `action: "remove"` 退出并清理 worktree。
- 若用户选择保留：
  1. 使用 `ExitWorktree` 的 `action: "keep"`，仅恢复原始 cwd。
  2. 保留 worktree 目录与分支供手动 review。建议同样跑 postflight `--apply` 接回产物（最终报告等产物以 `<repo-root>` 为单一查看入口）；不接回时收尾决策注明产物仍在 worktree、未来清理会丢失。
- `--stage` 下不执行提交，无已提交改动可合并回 `<original-branch>`：跳过合并询问，强制保留分支（等同用户选择 keep），收尾决策注明后续步骤——手动按逐 Slice 提交计划提交后再执行上述合并流程。

如需保留未提交改动，请选择 keep；此时再按 CLAUDE.md 的 quit worktree workflow 处理亦可。

## docs 产物接回主仓（postflight 守门）

flow-dev 的产物（`docs/` 下八个子目录）被 git 忽略，merge 只带入已提交改动——worktree 清理时产物随之丢失。接回与校验统一由 postflight 脚本承载，禁止手工 for 循环复制（叙述步骤曾被跳过导致产物丢失）：

```bash
node ~/.claude/skills/flow-dev/scripts/postflight.mjs <task-slug> --apply
```

`--apply` 先按 `<task-slug>` 前缀幂等复制产物到 `<repo-root>`（reviews 为 `<task-slug>-*` 目录内的单层文件枚举，跨 run 不冲突），再做四项校验：产物内容一致（sha256）、done 切片提交在 HEAD 祖先链、工作区无残留、phase 可收尾。exit 0 才允许进入 merge / 清理；不带 `--apply` 为纯校验（keep 收尾或审计复跑场景——worktree 已删时降级为主仓侧产物存在性自查，能识别「从未接回已丢失」）。`<run-dir>` 在 `~/.flow-dev/` 下，不受 worktree 清理影响，无需接回。

keep 收尾同样建议跑一遍（纯校验即可）：不接回时收尾决策注明产物仍在 worktree、未来清理会丢失。

## 注意事项

- `EnterWorktree` 创建的 worktree 目录默认位于 `.claude/worktrees/<task-slug>/`。
- 合并前不要先调用 `ExitWorktree remove`，否则 `<worktree-branch>` 会被删除，无法完成 merge。
- 非 worktree 模式下，`<working-dir>` 直接等于 `<repo-root>`，文档路径与原先一致。

## 文档 git-ignored 强制机制

flow-dev 的产物默认不进 git。Step 0 必须执行以下检查：

1. 检查 `<working-dir>/docs/` 是否已被忽略：
   ```bash
   git check-ignore -q <working-dir>/docs/thoughts && echo ignored
   ```
2. 若未被全局 `.gitignore` 或 `.git/info/exclude` 忽略，则向当前 git 目录的 `.git/info/exclude` 追加以下模式（路径通过 `git rev-parse --git-path info/exclude` 获取）：
   ```text
   docs/thoughts/
   docs/dissections/
   docs/decisions/
   docs/plans/
   docs/tdd/
   docs/qa/
   docs/reports/
   docs/reviews/
   ```
3. 记录使用的忽略机制到 `state.json` 和最终报告。

该机制同时适用于 `<repo-root>` 和 worktree 的 git 目录。

## 合并冲突处理

用户同意合并 worktree 后：

1. 在 `<repo-root>` 中执行 `git branch --show-current` 重新确认当前分支。
2. 执行 `git merge --no-ff <worktree-branch>`。
3. **若发生冲突**：
   - 立即停止，不要自动解决。
   - 在 `~/.flow-dev/runs/<task-slug>/blocker-report.md` 中写入 `merge-conflict` blocker。
   - 设置 `state.json` 的 `phase` 为 `merge-conflict`。
   - 在最终报告中说明冲突文件与解决建议。
   - 保留 worktree，用户手动解决冲突后可再次调用 `flow-dev --resume <task-slug>`。

## 安全红线

flow-dev 及其 worktree 模式严禁以下操作：

- 永不执行 `git push --force` 或 `git push -f`。
- 永不 checkout 或 push 到 `<original-branch>` / `<worktree-branch>` 之外的分支。
- 永不直接在默认分支（`main`/`master`）上提交改动。
- 永不在 `<repo-root>` 或 worktree 中运行可能删除或覆盖未跟踪产物的命令。

## 外部状态目录说明

运行时状态（`state.json`、决策台账、run journal、外部审查 PID/日志等）统一存放在 `~/.flow-dev/runs/<task-slug>/`，不在 `<working-dir>` 内。

这意味着：

- `ExitWorktree remove` 清理 worktree 时不会删除运行状态，后续仍可用 `--resume <task-slug>` 恢复。
- 运行状态不参与 git，避免污染仓库。
