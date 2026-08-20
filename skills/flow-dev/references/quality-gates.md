# flow-dev 质量门

本文件定义 `--depth` 与 DevGoal 达成标准、review effort、修复循环上限之间的映射关系。

## 深度 → 质量门矩阵

- `mvp`：DevGoal 达成标准 垂直 slice 可运行；核心行为可演示；无 P0 缺陷；≥1 tracer test；Review Effort `low`；修复循环上限 1 轮；最终报告标准 用户能跑起来
- `prod`（默认）：DevGoal 达成标准 上述 + 完整测试与边界用例；无 P0/P1；通过 code-review；符合 CLAUDE.md / AGENTS.md；Review Effort `low`（--mode light/quick/dev/fix）/ `medium`（--mode full）；修复循环上限 2 轮；最终报告标准 可合并且无已知阻塞
- `hifi`：DevGoal 达成标准 上述 + 外部正交审查通过；性能 / 可访问性 / 打磨验证；UAT 级验证；Review Effort `low`（--mode light/quick/dev）/ `medium`（--mode full）；修复循环上限 3 轮；最终报告标准 生产级 + 打磨，可发布

`--mode fix` 默认 `--depth mvp`（显式 `prod` 可用）；`hifi` 与 fix 互斥——hifi 质量门含外部正交审查通过，而 fix 恒禁用 Step 6 外部审查，语义冲突，Step 0 校验时报错并提示改用 `--mode dev`。

## Review Effort 选择

本地 code-review（flow-code-review）的 effort 只看 flow-dev 运行模式，不看改动行数：

- `--mode light`（默认）/ `--mode quick` / `--mode dev` / `--mode fix`：`low`
- `--mode full`：`medium`

**注意**：

* `high` / `xhigh` 档暂不在 flow-dev 自动流程启用（性价比不划算）；需要更深审查时，人工直接跑 `flow-code-review --effort high|xhigh`
* 该映射只作用于本地 code-review；Step 6 外部正交审查（runner）的 effort 与之解耦，锁定为 `normal`
* `--delegate` 只改变本地 code-review 的执行者（分派审查子代理），不改变本 effort 映射

## 修复循环上限

- `mvp`：1 轮修复后若仍有未关闭的 P0/P1，停止并写 blocker 报告。
- `prod`：2 轮修复后若仍有未关闭的 P0/P1，停止并写 blocker 报告。
- `hifi`：3 轮修复后若仍有未关闭的 P0/P1，停止并写 blocker 报告。

每轮修复后必须重新跑相关测试与 code-review，确认 Bugs 状态变化。

## Blocker 报告模板

当 Slice 或修复循环无法达到质量门时，在 `~/.flow-dev/runs/<task-slug>/blocker-report.md` 写入：

```markdown
# Blocker Report — <task-slug>

## 触发阶段
<phase>

## 描述
<具体说明为什么无法继续：未达成的质量门、剩余 P0/P1、尝试过的修复、失败原因>

## 剩余 Bugs
- <bug 1>
- <bug 2>

## 建议下一步
<用户睡醒后可采取的最小行动>

## 相关路径
- state: `~/.flow-dev/runs/<task-slug>/state.json`
- bugs: `<bugs-path>`
- external review: `<review-path>`
```

## 使用方式

在 `flow-dev` Step 5、Step 7 中按 `--depth` 查本文件，作为客观退出判据。不要凭感觉判断"DevGoal 达成"。
