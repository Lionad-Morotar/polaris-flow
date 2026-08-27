# Changelog

格式基于 Keep a Changelog；级别约定：几乎始终 patch，minor/major 由维护者显式指定。

## [0.2.2] - 2026-08-27

- 三个文档类检查点（需求树拆解 / UltraThoughts / grill-me）审查风格切换为对抗发散（runner `--style adversarial`，依赖 flow-agent 0.1.0-alpha.4）：需求理解类产物无客观对错、风险形态是盲区与理解偏差，验证型 sanity check 会把审查压成低信息量阴性结论——对抗（证伪关键主张）+ 发散（枚举未覆盖象限）产出盲区清单，输出契约改为「视角/象限 → 遗漏或偏差描述 → 建议证伪或补齐路径」
- 陈述式纪律保留并明确其适用边界：对抗姿态与发散透镜是框架固定部分的任务定义（赋予立场与广度），不构成方向框定；DevLoop 审查（code-review 检查点）维持 orthogonal 正交验证 + `--no-preamble` 不变
- 对抗审查假阳性鉴别锚点入 dissection Gate 裁决：发现依赖"某行为方存在"时先取证再谈接受；`reviews[]` 检查点记录新增 `style` 字段
- 协议文档更名「外部正交审查协议」→「外部审查协议」并新增「审查风格」章节（验证型 vs 发散型选型锚点：审查对象的对错能否客观判定）

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
