---
name: flow-os
description: 系统环境维护入口，按主题路由：claude-providers（~/.cp/*.json provider 配置 + zshrc 启动器函数 + flow-agent 降级链登记）/ fix-vscode-rg（VSCode 系编辑器内置 rg 超时包装防搜索卡死吃 CPU）/ disk-health（硬盘写入排查 + SSD 健康检查）。当用户说「新增 provider」「claude 启动器」「~/.cp」「ckk 系列函数」「VSCode 搜索卡死」「rg 占满 CPU」「rg 超时包装」「kernel_task 写入」「硬盘写入」「SSD 健康」「smartctl」「磁盘写入排查」时触发
argument-hint: <topic>
disable-model-invocation: true
metadata:
  version: 0.1.0-alpha.0
---

# flow-os：系统环境维护路由层

## 要求

* 本技能是**路由层**：只做主题识别与分派，维护细则全部在 references——进入主题时才读取对应手册（渐进披露）。
* 维护对象多无版本兜底（home 目录的 `~/.cp/`、`~/.zshrc`，`/Applications` 下 app bundle 内的 rg 二进制）：改动即改即验，每步操作前先备份原文件（或确认工具自带备份，如 `rg_backup`）。
* token 等凭证禁止打印到终端或日志；验证时只检查长度/前缀。

## 主题路由

- `claude-providers`：`~/.cp/*.json` provider 配置、`~/.zshrc` 启动器函数、flow-agent 降级链登记；`node ~/.claude/skills/flow-os/scripts/preflight.mjs`；`references/claude-providers.md`
- `fix-vscode-rg`：VSCode 系编辑器（含 Qoder / Cursor / Trae）内置 rg 超时包装：批量 on/off/kill/查状态；macOS「应用管理」权限（手册内自检）；`references/fix-vscode-rg.md`
- `disk-health`：硬盘写入排查（免 sudo 体检 → fs_usage 定位写入源）+ SSD 健康检查（smartctl）；第二层起需 sudo（手册含 `!` 前缀方案）；`references/disk-health.md`

## Workflow

0. 识别维护主题 `<topic>`
   - [ ] `<topic>` 不在路由表中则停下报告，不猜做
   - [ ] **按路由表「前置条件」列执行对应检查**：`claude-providers` 运行 preflight 确认 `~/.cp/`、`~/.zshrc` wrapper 就绪；`fix-vscode-rg` 的权限自检在手册「前置条件」节。失败则停止并报告
1. 读取主题对应手册并按其规则执行
