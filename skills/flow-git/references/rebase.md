# 提交历史整理执行手册（rebase 模式）

由 SKILL.md Workflow Step 2 调起。把指定范围 `<base>..HEAD` 内零散的 commits 重组为 M 个垂直切片逻辑提交：取范围终点的最终 tree，按**修改意图**重新分组后重新提交。

与 commit 模式（新建 commit）、retime 模式（只改时间戳）、push 模式（质量门禁）正交——本模式只改 commit 的数量、边界与 message，**不改最终 tree**（tree 不变式）。

## 适用 / 不适用

**适用**：本地未推送的散 commit 需要按逻辑合并——功能开发产生的碎片提交、自动化批量产出的 commit、提交历史混乱需要重新组织。

**不适用**：

- 范围含 merge commit、已推送 commit 或多 author → 前置检查命中即停（见下）
- 只想刷新时间戳、不动数量与 message → 改用 `--retime`
- 想保留原 commit 边界与 author date 的精确合并 → 本模式做不到（reset 路线的固有代价），需手工 `git rebase -i`

## 核心原理

`git rebase -i` 依赖交互式编辑器，在 Claude Code 环境不可执行。本模式改用 `git reset <base>`（mixed）+ 按分组重新提交来重建历史：

- **零冲突**：不重放历史，直接取范围终点的最终 tree 重新切分，不存在重放冲突
- **与 batch-commit 同构**：mixed reset 把 HEAD 与 index 都移回 `<base>`，范围内全部变更以 **unstaged** 形态留在工作区——恰好是 commit 模式「推理文件 → 看 diff → 按意图聚类」的起点
- **tree 不变式**：重建前后 tree 完全一致，以 tree hash 为权威验证：`git rev-parse backup^{tree}` = `git rev-parse HEAD^{tree}`

`--soft` 与 `--mixed` 的区别仅在 index 落点：`--soft` 把全部变更留在 staged，反而要逐组 unstage 才能重切，与本手册流程反向；仅当 M=1（全部压缩为单个 commit）时退化为 `git reset --soft <base> && git commit` 一步完成。

**代价**：丢失原 commit 边界与 author date（新 commit 全部使用当前身份与 now）。安全红线已限定本模式只处理本地未推送 commit，保留价值低；如需刷新时间为自然分布，整理完接 `--retime`。

## 示例

整理前（5 个散 commit）：

```
b279923 docs: add readme
ed56958 fix: typo
2aa4a3e feat: add login page
a0fd7b2 feat: add login api
e15b958 fix: login bug
```

整理后（2 个逻辑 commit，tree 不变）：

```
ca1036c docs: 添加项目文档
8f336f5 feat: 实现用户登录功能
```

## 执行步骤

### 1. 探查（reset 之前，HEAD 仍在旧 tip）

```bash
git log --oneline <base>..HEAD                                  # 范围全貌
git diff <base>..HEAD --stat                                    # 涉及文件与量级
git log <base>..HEAD --format='%an <%ae>' | sort -u             # author 集合（须单一）
git log <base>..HEAD --merges --oneline                         # merge commit 检测（须为空）
git merge-base --is-ancestor @{u} <base> && echo SAFE           # 有 upstream 时：remote 指针在 base 之前/相等 = 范围纯本地
git status --porcelain                                          # 工作区/索引是否干净
```

### 2. 分组方案 + Ask 确认

- [ ] 结合 commit message 与 `--stat` 文件变更，按**修改意图**聚类为 M 组（类型、目录仅作辅助启发式；分组逻辑遵循 CLAUDE.md 垂直切片：每组可独立运行、可独立测试）
- [ ] **file-level 粒度**：每个文件整体归入一组；同一文件被多个意图涉及时，归入主导意图组（tree 不变式不受影响，只是意图归属近似）
- [ ] 每组拟定 message：`<type>: <高度凝练的 spec>`（规范见 SKILL.md 要求节）
- [ ] 向用户展示方案（M 组 × 文件清单 × message），Ask 确认；用户取消则**不执行 reset**，原样退出

### 3. 备份 + 执行

```bash
git branch backup/pre-rebase-$(date +%Y%m%d-%H%M) HEAD          # 安全网，先于 reset 建立
# 工作区不干净时：git stash push -u -m "rebase-backup: <说明>"（收尾 pop）
git reset <base>                                                # mixed：HEAD 与 index 回 base，变更落工作区
```

逐组重新提交：

```bash
git add -A -- <该组文件...>                                      # -A 统一处理增/改/删
git commit --no-verify -m "<type>: <spec>"                      # --no-verify：内容已提交过，hook 自动修复会破坏 tree 不变式
# ... 重复至 M 组全部提交
# 若 stash 过：git stash pop
```

若 `--dry-run`：只打印分组方案与上述命令序列，不执行 reset 与 commit。

### 4. 验证

```bash
test "$(git rev-parse backup/pre-rebase-<ts>^{tree})" = "$(git rev-parse HEAD^{tree})" \
  && echo "tree 不变式成立" || echo "TREE MISMATCH"              # 权威断言
git diff backup/pre-rebase-<ts> HEAD                            # 可读性复核（应为空）
git log --oneline <base>..HEAD                                  # 新历史
git status --porcelain                                          # 应为空（含 stash 已 pop）
```

## 边界情况

- 工作区/索引不干净：默认停下报告；用户确认保留改动时先 `git stash push -u`，收尾 `pop`（tree 不变式保证 pop 无冲突）
- 同一文件跨多个组：file-level：整体归入主导意图组；确需 hunk 级拆分时用 `git apply --cached <手工 patch>`（进阶，非默认路径；`git add -p` 交互式不可用）
- 范围内有删除文件：`git add -A -- <path>` 对删除同样生效（裸 `git add <path>` 会报错）
- 范围内有重命名：旧路径删除与新路径添加归入**同一组**，git 展示时自动重识别 rename
- 二进制文件：无 hunk 概念，整文件归一组
- 范围内含 submodule 指针 bump：当作普通文件：`git add <submodule-path>` 归入相关组
- M=1（全部压缩为一个）：退化：`git reset --soft <base> && git commit --no-verify -m "<spec>"`
- 用户取消分组方案：未 reset 则原样退出；已 reset 则 `git reset --hard backup/pre-rebase-<ts>`

## 回滚

- reset 是原子操作，无中途态：任意阶段放弃或出错，`git reset --hard backup/pre-rebase-<ts>` 完全恢复原历史
- 验证 OK 后清理：`git branch -D backup/pre-rebase-<ts>`

## 前置检查（踩坑防线，命中即停）

- **已推送 commit**：有 upstream 时 `git merge-base --is-ancestor @{u} <base>` 不成立 → 范围含已推送 commit，改写需 force-push 影响他人 → **停下报告**（安全红线，不自动 force-push）；无 upstream 的新分支视为纯本地，安全
- **merge commit**：范围内有 merge 时 reset 会 flatten 合并语义 → 停下报告
- **多 author**：范围内多个 author 时重提交会把全部统一为当前身份，抹掉他人署名 → 停下报告
- **工作区/索引不干净**：`reset` 没有 `git rebase` 那样的 dirty tree 防护，会静默合并未提交改动 → 停下报告（或走 stash 路径，需用户确认）
- **处于 rebase/merge/cherry-pick 中途态**：`git status` 会提示；先 `--abort` 或完成当前操作再来
- **`<base>` 非 HEAD 祖先**：`git merge-base --is-ancestor <base> HEAD` 不成立 → 范围无效，停下报告
