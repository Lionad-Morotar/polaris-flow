# Changelog

格式基于 Keep a Changelog；级别约定：几乎始终 patch，minor/major 由维护者显式指定。

## [0.1.0-alpha.0] - 2026-08-17

开源边界版本：历史迭代压缩重写，版本号与仓内技能 tag 格式（`<skill>@<version>`）对齐。

- 技能本体：系统环境维护路由层，按主题分派——`claude-providers`（`~/.cp/*.json` provider 配置 + zshrc 启动器函数 + flow-agent 降级链登记）、`fix-vscode-rg`（VSCode 系编辑器内置 rg 超时包装巡检与修复）、`disk-health`（硬盘写入排查 + SSD 健康检查）
- claude-providers 手册示例账号泛化（占位 `alice`）；本机真实账册抽离至 `configs/providers.local.md`（.gitignore 排除，不随仓分发）
- flow-agent 降级链登记改为单点：`flow-agent/configs/launchers.json`，替代原多处同步点
- rg-wrap-guard.sh 日志目录去掉维护者 home 硬编码 fallback，HOME 缺失时显式报错
