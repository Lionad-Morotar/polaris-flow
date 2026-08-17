# 重写已提交记录时间戳执行手册（retime 模式）

由 SKILL.md Workflow Step 3 调起。把指定连续范围 `<base>..HEAD` 内 commit 的 author/committer 时间全部刷新为「重新提交那一刻的 now」，保留顺序、内容、message 与作者身份。

与 commit 模式（新建 commit）、rebase 模式（合并 / 改 message）正交，本模式只改时间，不改数量、内容与顺序。

## 适用 / 不适用

**适用**：批量脚本或自动化产出的 commit 共享同一时间戳（如 7 个 commit 都是 09:56）、提交时间异常（凌晨批量、时间倒序），需整体刷新为「正常重新提交」的递增时间。

**不适用**（改用 `--rebase` 模式）：改 commit message、合并 / 拆分 commit、修改 commit 内容。

## 核心原理

普通 `git rebase` 和 `git cherry-pick` 都**保留 author date**，只把 committer date 设为 now——达不到「时间改成现在」。必须用：

```bash
git rebase <base> -x "git commit --amend --reset-author --no-edit --no-verify"
```

- `-x` / `--exec`：每个 commit 重放后追加执行该命令
- `--reset-author`：把 **author + author date + committer date** 全刷新为「当前 config 身份 + 此刻 now」
- `--no-edit`：保留原 message
- `--no-verify`：跳过 pre-commit hook（纯改时间，不让 lint/format 介入改内容）

最终效果：范围内 commit 按拓扑顺序（旧→新）每个递增几秒，全部压在 now 附近。

## 执行步骤

### 1. 探查（直接查，不问用户）

```bash
git log --format='%h | A:%ad | C:%cd | %s' --date=format:'%Y-%m-%d %H:%M' -25   # 时间分布
git status -sb                                                                   # 工作区是否干净
git log --oneline @{u}..HEAD                                                     # 未推送提交（判断是否需 force-push）
git log <base>..HEAD --format='%an <%ae>' | sort -u                             # 范围内 author 身份（须单一）
git log <base>..HEAD --merges --oneline                                          # 范围内有 merge 会卡 rebase
```

### 2. 用 Ask 确认三件事

1. **范围**：base 锚点（不动的那一个）+ 改写的连续范围 `<base>..HEAD`。展示边界 commit（最早 / 最晚 / 锚点）让用户核对。
2. **时间语义**：默认「全部压成 now 递增」；若用户要自定义分布（保留间隔平移 / 指定起始时刻），改用 `git filter-repo` 或 `git filter-branch --env-filter`。
3. **工作区改动**：`git stash push -u` 暂存，rebase 后 pop。

### 3. 执行

```bash
git branch backup/pre-rebase-$(date +%Y%m%d-%H%M) HEAD                          # 安全网
git stash push -u -m "rebase-backup: <说明>"                                     # 暂存工作区
git rebase <base> -x "git commit --amend --reset-author --no-edit --no-verify"  # 核心
git stash pop                                                                    # 恢复工作区
```

若 `--dry-run`：只打印上述计划与探查结果，不执行。

### 4. 验证

```bash
git log --format='%h | A:%ad | C:%cd | %s' --date=format:'%Y-%m-%d %H:%M:%S' -<N>
```

确认四点：时间全部刷新为 now 附近、author = committer、作者身份未变、工作区改动原样恢复。

## 回滚

- rebase 中途卡住：`git rebase --abort`
- rebase 完发现问题：`git reset --hard backup/pre-rebase-<timestamp>`
- 验证 OK 后清理：`git branch -D backup/pre-rebase-<timestamp>`

## 前置检查（踩坑防线）

- **已推送的 commit 改写需 force-push，影响他人**——先确认 `<base>..HEAD` 是否纯本地未推送（`git log @{u}..HEAD`）。已推送的**停下来报告**，让用户决定（遵循安全红线，不自动 force-push）。
- **多 author**：范围内若有多个 author，`--reset-author` 会把全部统一成当前 config 身份，污染他人提交——遇此**停下来报告**。
- **merge commit**：范围内有 merge 时 rebase 默认扁平化，改用 `--rebase-merges` 或换 `git filter-repo`。
- **工作区必须干净**：rebase 前必 stash，否则 git 拒绝。
- **身份一致性**：执行前确认 `git config user.name/email` 与范围内 author 一致，否则 `--reset-author` 会换身份。
