---
name: flow-git
description: lionad 与 git 打交道的统一入口。默认分批提交（按修改意图把 diff 整理为垂直切片 commit），--rebase 把范围内零散 commit 按修改意图重组为逻辑提交（tree 不变），--retime 重写已提交记录的时间戳为 now，--push 推送前质量门禁（lint/format/test 自动修复后推送），--init 为项目安装 git hooks（commit 阶段：受保护分支禁止直提 + commitlint；push 阶段：pre-push 质量门禁 lint/test/typecheck）。当用户说「提交」「commit」「分批提交」「整理提交计划」「整理提交历史」「rebase」「合并散 commit」「历史太散」「重写 commit 时间」「提交时间挤在一起」「推送」「push」「安装 hooks」「git hooks」「init hooks」「pre-push」「质量门」「push 拦截」时触发
argument-hint: <files...> [--rebase <base>] [--retime <base>] [--push] [--init [all|hooks|push]] [--dry-run]
disable-model-invocation: true
metadata:
  version: 0.1.0-alpha.0
---

# flow-git：与 git 打交道的统一入口

## 要求

* 由主代理直接执行，不委托 subagent。git 操作需要交互确认且流程短，主代理直接操作更可控。
* commit message 格式遵循 CLAUDE.md：`<type>: <高度凝练的 spec>`，垂直切片（每个 commit 可独立运行、可独立测试），无需描述测试状态。
* 严格按模式分派执行对应 references——**进入该模式时才读取对应 references**（渐进披露，避免一次性加载全部细节）。
* 永不在默认分支（main/master）直接提交改动——遵循 CLAUDE.md「只在任务收尾时提交」。

## 参数与变量

### 参数

- `<files...>`（默认 commit 模式从上下文推理）：待提交文件路径，可能多个；可定位到 submodule
- `--rebase <base>`（默认 关闭）：rebase 模式：把 `<base>..HEAD` 范围内散 commit 按修改意图重组为 M 个垂直切片逻辑提交；`<base>` 为不动的那一个锚点（commit-ish）；reset 重建路线，tree 不变但丢失原 commit 边界与 author date
- `--retime <base>`（默认 关闭）：retime 模式：把 `<base>..HEAD` 范围内 commit 的 author/committer 时间刷新为 now；`<base>` 为不动的那一个锚点（commit-ish）
- `--push`（默认 关闭）：push 模式：质量门禁（lint/format/test）通过后推送
- `--init [all|hooks|push]`（默认 关闭）：init 模式：为当前项目安装 git hooks；`hooks` = commit 阶段一套（pre-commit 分支保护 + commit-msg commitlint），`push` = push 阶段一套（pre-push 质量门禁 + .gitattributes LF 保护），`all` = 两阶段全装，省略参数同 `all`
- `--dry-run`（默认 关闭）：只打印执行计划，不动手

**模式分派**（互斥）：`--init` → init 模式；`--push` → push 模式；`--retime` → retime 模式；`--rebase` → rebase 模式；否则 → commit 模式（默认）。

### 变量

- `<repo-root>`：当前 git 根目录；`git rev-parse --show-toplevel`
- `<current-branch>`：当前分支；`git branch --show-current`
- `<target-submodule>`：待提交文件所在子模块（若有）；文件路径解析；非 submodule 时为空
- `$original_staged_files`：commit 模式开始前已 staged 的文件；`git diff --name-only --cached`（commit 模式记录，收尾恢复）

## Workflow

0. 初始化上下文
   - [ ] 解析参数 `<files>`、`--rebase`、`--retime`、`--push`、`--init`、`--dry-run`
   - [ ] **Preflight 自检**：运行 `node ~/.claude/skills/flow-git/scripts/preflight.mjs`，确认在 git 仓库内且 node 可用；失败则停止并报告
   - [ ] 记录 `<repo-root>`、`<current-branch>`
   - [ ] 模式分派：
     - [ ] `--init` → Step 5
     - [ ] `--push` → Step 4
     - [ ] `--retime` → Step 3
     - [ ] `--rebase` → Step 2
     - [ ] 否则 → Step 1

1. commit 模式（默认）：分批提交
   - [ ] 读取 `references/batch-commit.md` 并按其中规则执行

2. rebase 模式：整理已提交的零散 commit
   - [ ] 读取 `references/rebase.md` 并按其中规则执行

3. retime 模式：重写已提交记录时间戳
   - [ ] 读取 `references/retime.md` 并按其中规则执行

4. push 模式：质量门禁推送
   - [ ] 读取 `references/push-gates.md` 并按其中规则执行

5. init 模式：安装 git hooks
   - [ ] 读取 `references/init-hooks.md` 并按其中规则执行

## 安全红线

- 永不执行 `git push --force`（retime/rebase 改写已推送 commit 时，停下报告，不自动 force-push）。
- retime/rebase（改写历史模式）遇以下任一情况**停下报告**：范围含已推送 commit、范围内多 author、范围内含 merge commit。
- rebase 模式额外：工作区/索引不干净、处于 rebase/merge/cherry-pick 中途态 → **停下报告**（`reset` 没有 dirty tree 防护）。
- 永不在默认分支直接提交改动。
- push 自动修复最多 2 轮，避免无限循环。

## 故障恢复

- commit 模式恢复 staged 状态失败：用记录的 `$original_staged_files` 手动 `git add` 恢复。
- retime 中途卡住（内部 `git rebase -x` 进行中）：`git rebase --abort` 回到起点；完成后发现错误：`git reset --hard backup/pre-rebase-<timestamp>`。
- rebase 模式（reset 路线，无中途态）：任意阶段放弃或出错：`git reset --hard backup/pre-rebase-<timestamp>`（backup 分支先于 reset 建立，兜底）。
