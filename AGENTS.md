# AGENTS.md

本仓是 polaris-flow 技能体系（Claude Code skills 集合），每个技能独立版本化，不使用 submodule。

## 版本约定

- 级别：几乎始终 patch;minor/major 由维护者显式指定（如 breaking 参数移除）
- 三处落点须一致：SKILL.md frontmatter `metadata.version`、技能内 CHANGELOG.md、git tag `<skill>@<version>`
- 单入口：`node skills/flow-skill/scripts/bump.mjs <skill> [patch|minor|major|x.y.z] "<条目1>" ["<条目2>"...]`，自动完成改版 + prepend CHANGELOG + commit + tag
- 顺序纪律：先 feat commit 全部功能改动，再跑 bump;bump 预写版本文件后才做 dirty 检查，失败不回滚

## 提交约定

- commit message 描述做了什么（参考近期提交），禁止夹带开发追踪编号
- 垂直切片：每个 commit 是完整可运行的组成部分；任务途中仅 commit，不 push
- 提交精确 `git add` 路径：可能有并行 agent 的无关改动同在工作区，禁止全量 add

## 文档约定

- 禁用 Markdown 表格（table）：参数、变量、字段、依赖、对比、路由、目录一律用列表（list）承载，按主键分组、多层嵌套
- 参数条目形态：- `--mode <mode>`（默认 `light`）：说明文字
- 代码块内作为示例内容的表格不受此约束

## 校验

- lint:`node skills/flow-skill/scripts/lint.mjs skills/<name>`，提交前 0 error / 0 warning
