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
* 索引与本体分离：手册为本地积累，不随开源仓分发；SKILL.md 不枚举本地手册，清单唯一落点是 `references/index.md`（随目录 ignore）。

## 意图路由

按应用域路由到对应手册：

1. 读 `references/index.md` —— 列出全部域与手册，附触发词；按任务匹配域后读对应手册执行
2. 无索引时枚举 `references/` 目录，列出现有分册清单后停止

## 红线

* SKILL.md 与入库文件不引用本地手册的具体内容；markdown 链接只指向仓内跟踪文件，本地手册一律用代码跨度提及
* 手册内的凭据、内部系统细节只存在于本地 references/（已 ignore），禁止搬进 SKILL.md 或 CHANGELOG
