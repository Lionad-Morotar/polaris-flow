# Changelog

格式基于 Keep a Changelog；级别约定：几乎始终 patch，minor/major 由维护者显式指定。

## [0.2.0-alpha.0] - 2026-08-22

- --show 报告结构演化：关键趋势段改白话概述、任务分组改需求树（按功能域分枝、带规模与行内事实），diverged/behind 形态追加合并前确认点条件段
- show-range.mjs 新增 direction 探测：ahead（原行为）/ behind（range 翻转总结远端待合入面）/ diverged（附 incomingRange/incomingCommits 双面），含 node --test 测试五例
- 新增 scripts/pre-merge-check.mjs：overlap 文本冲突候选预测 + drizzle 迁移 journal 条件核对（游离迁移、编号撞车），含测试三例
- 新增 references/pre-merge.md：确认点段方法（冲突预测定性、迁移核对解读、hooks/CI 杂物提示、merge commit 决策审查）与「报行动项前先核实机制覆盖」判定纪律

## [0.1.0-alpha.0] - 2026-08-17

- 初始开源版本：代码库元架构维护入口：--show 总结近期变动（趋势前置、按任务分组的终端报告），--scan 全仓坏味道扫描（backup/兜底模式 + 坏味道测试，判定三问与分轴输出规范）
