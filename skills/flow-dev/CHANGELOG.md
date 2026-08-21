# Changelog

格式基于 Keep a Changelog；级别约定：几乎始终 patch，minor/major 由维护者显式指定。

## [0.2.1] - 2026-08-21

- DevLoop 审查单轨化：默认由外部异族模型执行 flow-code-review 流程（正交视角与结构化纪律一遍完成），取代「本地审查恒跑 + 外部审查较大改动才触发」的双轨；每 Slice 恒执行一次，删除规模触发判据，发起时附 runner 新增的 `--no-preamble`
- 降级链：`--mode fix`、`--skip-review` 或外部执行运行时失败（产物不可采纳/findings JSON 无法提取）自动降级本地执行 flow-code-review，降级原因入决策台账与最终报告；`--depth hifi` 例外——外部执行失败 blocked 留现场，不降级
- 删除修复后复跑审查：修复轮收敛判据改为「Bugs 逐条关闭（每条有测试佐证）+ 测试与 Slice 验收命令通过」——复跑对修复 diff 产生新 findings，把修复轮次拖入递减收益循环
- base_ref 恒记录（原仅 --delegate），外部执行凭它框定 diff 范围；Bugs 确认与落档从 Step 5 移至 Step 6（findings JSON 机械合并）
- worktree 模式收尾新增 docs 产物接回主仓 checkpoint：产物被 git 忽略、不随 merge 带入，清理 worktree 前复制回 `<repo-root>`，堵上产物随 worktree 删除丢失的缺口

## [0.2.0] - 2026-08-20

- 新增 --delegate 正交执行策略：主代理收敛为编排者（规划/分派/验收/状态），Slice 开发、本地 code-review、Bugs 修复分派子代理执行，委托契约落 references/delegation.md
- state schema 变更：flags.mode 由布尔迁移为枚举（承接 resume 漂移判定的既有约定）、flags 新增 delegate、slices 新增 base_ref 记录 Slice 起点 ref 供审查 diff 基线

## [0.1.0-alpha.0] - 2026-08-17

- 初始开源版本：工业级开发流程：需求树拆解、UltraThoughts、grill-me 决策台账、TDD Slice 循环、code-review、外部正交审查检查点到知识沉淀与文档更新的完整链路；多模式状态机（light/full/quick/dev/fix）、--stop/--resume 断点续跑、worktree 隔离
