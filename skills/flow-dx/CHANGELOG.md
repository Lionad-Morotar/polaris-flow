# Changelog

格式基于 Keep a Changelog；级别约定：几乎始终 patch，minor/major 由维护者显式指定。

## [Unreleased]

- Agents.md 切片：模板 gsd-docs 表行片段补 `IDENTITY.md`（身份与授权、角色权限模型）
- preflight：`gsdDocs` 新增 `unindexed` 字段——索引漂移检测，`.planning/codebase/` 在盘文档未被挂载索引（`ignored=false` → CLAUDE.md，否则 CLAUDE.local.md）以 `.planning/codebase/<name>.md` 形式引用时列出，堵住手工补登文档与索引脱节的盲区（某内部项目的 TESTING.md/IDENTITY.md 曾因此漂移）；契约文档、agents-md.md Step 3 对账指引、SKILL.md 缺口枚举与验证收敛同步接线

## [0.1.0-alpha.0] - 2026-08-17

- 初始开源版本：开发者体验优化：/dev 动态发现入口与生产隔离、Agents.md/Claude.md AI 上下文基建、Tailwind 类排序 lint 基建（better-tailwindcss）、GitHub Pages 部署基建（Nuxt/Vite SPA 子路径托管）、VSCode 编辑器壳色彩匹配
