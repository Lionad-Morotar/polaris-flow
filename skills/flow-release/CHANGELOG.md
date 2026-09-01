# Changelog

格式基于 Keep a Changelog；级别约定：几乎始终 patch，minor/major 由维护者显式指定。

## [Unreleased]

- 「执行发布」提为显式流程第 7 步（原 Postflight 顺延为第 8 步）：prerelease（dist-tag 非 latest）代理直接 `pnpm release` 直发、stable（latest）止于 commit + tag 交还用户交互输 OTP 的通道分流，从「发布脚本约定」子节迁入主流程执行路径；发布检查清单补通道分流确认项

## [0.1.0-alpha.0] - 2026-08-21

- 初始开源版本：自私有技能 release-project 迁入。项目版本发布流程指导：Preflight 机械检查（发布目标识别、逐包 registry/首发判定）、分支模型分流、monorepo 发版变更矩阵（逐包变更检测、依赖图、bump 建议）、Changelog 维护、版本号升级、Git 标签、首发准备（npm / VSCode 扩展 / Claude skill / skill monorepo / CC 插件）、pnpm release 脚本约定（生命周期门禁链、多包依赖序发布模板）
