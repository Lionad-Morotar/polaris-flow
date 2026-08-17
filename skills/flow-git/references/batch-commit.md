# 分批提交执行手册（commit 模式）

由 SKILL.md Workflow Step 1 调起。把待提交文件按**修改意图**整理为垂直切片 commit 计划，确认后逐批提交，收尾恢复原始 staged 状态。

## 输入

* `$files`：待提交文件路径列表（从用户输入或上下文推理，可能多个）
* `<repo-root>`：当前 git 根目录
* `$original_staged_files`：本模式开始前已 staged 的文件

## 执行步骤

### 1. 推理 `$files` 与定位仓库

- [ ] 从用户输入（如「帮我提交本次修改」）或上下文推理 `$files` 的具体路径
- [ ] 对每个文件确认所在 git 仓库：`git -C <file-dir> rev-parse --show-toplevel`
  - [ ] 若文件在 submodule 内（toplevel ≠ `<repo-root>`），记录 `<target-submodule>`，后续在该 submodule 内提交
  - [ ] submodule 提交后，需在主仓 bump submodule 指针（见边界）

### 2. 记录原始 staged 状态

- [ ] 记录 `$original_staged_files` = `git -C <repo-root> diff --name-only --cached`

### 3. 按修改意图分批

- [ ] 对 `$files` 中每个文件查看 diff：`git -C <repo-root> diff -- <file>`（unstaged）或 `git -C <repo-root> diff --cached -- <file>`（已 staged）
- [ ] 按**修改意图**（而非按文件类型）聚类为多个批次，每批是一个可独立运行的垂直切片
- [ ] 每批拟定 commit message：`<type>: <高度凝练的 spec>`（type 如 feat/fix/refactor/chore/docs）

### 4. 确认与提交

- [ ] 向用户展示分批计划（批次顺序、每批文件、每批 message）
- [ ] 使用 Ask 确认；确认后逐批：
  - [ ] `git add <该批文件>`
  - [ ] `git commit -m "<message>"`（多行 spec 用多个 `-m` 或 heredoc）
- [ ] 若 `--dry-run`：只打印计划，不执行 `git add` / `git commit`

### 5. 恢复原始 staged 状态

- [ ] 提交完成后，恢复 `$original_staged_files` 中未被本流程消费的部分（重新 `git add`）
- [ ] 若涉及 submodule：在主仓 `git add <submodule-path>` bump 指针，作为独立 commit 或并入收尾

## 边界情况

- `$files` 为空 / 无法推理：Ask 向用户确认要提交的文件
- 某文件 diff 为空：跳过该文件，不单独成批
- 用户取消提交计划：停止，恢复 staged 状态后退出
- 文件分布在多个 submodule：每个 submodule 独立分批提交，主仓分别 bump
- 当前在默认分支：遵循 CLAUDE.md，提示用户确认是否在默认分支提交（通常应先切工作分支）

## 产物

- 多个垂直切片 commit：按修改意图分批，每个可独立运行
- submodule 指针 bump（如涉及）：主仓记录 submodule 新 commit
