# Decision Ledger 模板

flow-dev 在 grill-me 自答协议中使用本模板记录决策，最终报告附录中也会引用此格式。

## 表格

- D1 — Question 问题原文；Assumption 基于代码库证据给出的具体回答；Confidence high / medium / low；Verification 如何验证该回答；Evidence 文件路径、行号、函数名、日志等；Risk low / medium / high

## 字段说明

- **ID**：递增编号，如 D1、D2。
- **Question**：grill-me 提出的原问题。
- **Assumption**：agent 给出的具体回答，必须是基于代码库证据的判断，不能是"按文档高标准决定"。
- **Confidence**：`high`（有明确证据）、`medium`（证据间接或需运行时验证）、`low`（推测或缺少证据）。
- **Verification**：验证该回答的方式，如"运行 `npm test`"、"读取 `src/auth.ts:45`"、"检查数据库 schema"。
- **Evidence**：支撑回答的具体代码库证据，包含文件路径和行号。
- **Risk**：该决策若错误会带来的风险等级。

## High-risk pending decisions

当 Confidence 为 `low` 或 Risk 为 `high` 时，把对应条目复制到本节，并在最终报告中作为"需用户 review"区块输出：

- **D2**：...
  - Assumption：...
  - 为什么无法 high confidence：...
  - 建议用户确认/补充：...

## 文件位置

运行时写入：`~/.flow-dev/runs/<task-slug>/decisions.md`

最终报告附录中直接嵌入本表格的 High-risk pending decisions 部分。
