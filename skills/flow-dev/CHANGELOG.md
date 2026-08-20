# Changelog

格式基于 Keep a Changelog；级别约定：几乎始终 patch，minor/major 由维护者显式指定。

## [0.2.0] - 2026-08-20

- 新增 --delegate 正交执行策略：主代理收敛为编排者（规划/分派/验收/状态），Slice 开发、本地 code-review、Bugs 修复分派子代理执行，委托契约落 references/delegation.md
- state schema 变更：flags.mode 由布尔迁移为枚举（承接 resume 漂移判定的既有约定）、flags 新增 delegate、slices 新增 base_ref 记录 Slice 起点 ref 供审查 diff 基线

## [0.1.0-alpha.0] - 2026-08-17

- 初始开源版本：工业级开发流程：需求树拆解、UltraThoughts、grill-me 决策台账、TDD Slice 循环、code-review、外部正交审查检查点到知识沉淀与文档更新的完整链路；多模式状态机（light/full/quick/dev/fix）、--stop/--resume 断点续跑、worktree 隔离
