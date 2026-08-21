---
name: flow-app
description: 应用级操作手册与任务手册集合：按应用域分册（references/<app>/），沉淀系统应用与用户应用（Claude Code、Codex、浏览器等）的自动化操作方法，手册多由用户主动编写；与 flow-mem 互补——flow-mem 记编程场景的框架知识，flow-app 记应用怎么用，flow-mem 允许引用本技能手册。当用户说「应用手册」「操作指南」「跟踪会话状态」「等待会话结束」「flow-app」，或需要按手册操作某个应用（如判断 Claude Code 会话是否在推进）时使用
argument-hint: "[<应用域>] [<任务描述>]"
metadata:
  version: 0.1.0-alpha.0
---

# flow-app：应用级操作手册与任务手册

## 要求

* 手册按应用域分册：`references/<app>/` 一个应用一册，细则与脚本就地存放（scripts/ 置于该应用目录内）。
* 与 flow-mem 分工：flow-mem 记编程场景的框架知识，本技能记应用怎么用；flow-mem 允许引用本技能手册。
* 手册内容由用户主动编写沉淀；新增应用域时沿用「手册 md + 就地 scripts/」结构。

## 意图路由

按应用域路由到对应手册；无匹配域时列出现有分册清单后停止。

- claude-code 域：「跟踪会话状态」「会话还在推进吗」「等待 xxx 会话结束」→ 读 `references/claude-code/track-session-state.md`
- claude-mem 域：「记忆条目脏了」「清洗 claude-mem 条目」「worker 起不来/卡初始化」「claude-mem 升级后重打补丁」→ 读 `references/claude-mem/maintain-observations.md`

## 外部依赖入口

- count-session-lines.mjs（claude-code 域）：`node ~/.claude/skills/flow-app/references/claude-code/scripts/count-session-lines.mjs <sessionId> [--project <子串>] [--pretty] [--wait [--time <秒>]]`；退出码与输出契约见手册

## Workflow A：claude-code 会话状态跟踪

0. 解析任务
   - [ ] sessionId 必填（UUID）；区分任务类型：单次查询推进状态 / 等待会话结束后执行后续任务
   - [ ] 等待任务先与用户确认「结束后要执行什么」，再进入等待
1. 单次查询
   - [ ] 跑脚本采样，按 `references/claude-code/track-session-state.md` 判读规则给结论
2. 等待结束
   - [ ] 用 Bash 后台任务跑 `--wait`（按需 `--time <秒>`，默认 1800 即半小时）
   - [ ] 后台任务完成 = 停更信号；exit 0 才执行布置的后续任务，非零退出报告异常

## 红线与故障恢复

- 等待任务必须走后台：`--wait` 默认粒度半小时，前台执行会卡死会话。
- 「停更」只代表转录不再写入，不断言进程死亡；后续任务需要会话归宿结论时另行查证。
- 等待途中脚本以 1 退出（not-found / vanished）→ 报告异常，不擅自开始后续任务。
- 单次查询的行数口径以脚本为准，同一监控链路禁止混用 wc -l。

## References 地图

- `references/claude-code/track-session-state.md`：行数探针法手册——原理、口径、判读规则、`--wait` 等待模式、脚本输出契约；Workflow A 必读
- `references/claude-code/scripts/count-session-lines.mjs`：行数统计与等待脚本本体
- `references/claude-mem/maintain-observations.md`：观察条目清洗与运维手册——架构与数据流、污染根因、三层修法（bundle 补丁 + modes 提示词 + 存量清洗）、升级重放、worker 排障；脚本本体在 `~/.claude-mem/patches/`
