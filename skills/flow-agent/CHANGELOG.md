# Changelog

格式基于 Keep a Changelog；级别约定：几乎始终 patch，minor/major 由维护者显式指定。

## [0.1.0-alpha.1] - 2026-08-21

- 新增 `--no-preamble`：跳过 light 前言注入，服务流程驱动审查（调用方 prompt 完整定义审查流程与输出契约，如 flow-dev DevLoop 让外部模型执行 flow-code-review 流程并输出 findings JSON）；校验仍按 light（非空即过）、kimi 视角不升级，返回 JSON 增加 `no_preamble` 字段

## [0.1.0-alpha.0] - 2026-08-17

开源边界版本：历史迭代压缩重写，版本号与仓内技能 tag 格式（`<skill>@<version>`）对齐。

- 技能本体：外部正交审查调度——主代理声明 caller 模型与任务，按 `--effort`（normal/max/ultra/fable）选择异模型集合，经本机 zsh launcher function 启动快速 sanity check（light 默认）或深入审查（`--deep`），产物落 `<output-dir>/<slug>/`
- 执行硬化：probe 探针预检（20s 硬上限）、独立进程组 + watchdog 防孤儿泄漏、轮询心跳日志、降级链逐 launcher 重试、light/deep 分叉的结果校验、resume 旧进程清理、全局调用摘要日志
- 审查精简配置：禁 skills/MCP、限工具四件套、AFK 1s 极速脱困、outputStyle 覆盖，跨模型实证 input 减半
- 本机配置抽离：模型→启动器链（降级顺序与默认超时）移入 `configs/launchers.json`（.gitignore 排除，不随仓分发），`configs/launchers.example.json` 为入库模板；`run-external-review.py` / `preflight.mjs` 运行时读取，缺失拒跑并指向模板；`swap-launcher.mjs` 交换范围随之收敛为配置单点
