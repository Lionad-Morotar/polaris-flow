# Changelog

格式基于 Keep a Changelog；级别约定：几乎始终 patch，minor/major 由维护者显式指定。

## [Unreleased]

- no-tracking-marker 模板：新增 spec/§ 规格章节引用两类形态（"spec §4.4"/"spec(§4.4)"/"spec 4.4"/裸 "§2.3"——设计稿/规格文档章节号无法溯源，§ 符号本身即章节引用信号；协议版本表述如 "OpenAPI spec 3.0" 属已知误伤，经 allow 豁免）；补齐 .vue `<style>` 块 CSS 注释扫描——style 非 JS 代码不进 parser AST，对源文本按 `<style>` 区间切出 `/* */` 以伪节点（range/loc 经 `getLocFromIndex` 定位）走同一扫描，坑清单同步收录该盲区
- preflight：新增 `pagesMd` 探测——PAGES.md 页面入口清单适用性（前端入口族 `pages/`、`app/pages/`、`src/views/` 等 8 项信号与 CLI 命令族 package.json `bin`、`commands/` 等 5 项信号，根与 pnpm-workspace 子包同查）与在盘存在性；无 `ready`、不进 `--skip` 三态，就绪收敛归 Agents.md 切片整体判定，索引完整性由 `gsdDocs.unindexed` 天然覆盖；纯后端项目两族信号皆空自动不适用
- Agents.md 切片：create/update 流程新增 PAGES.md 页面入口清单维护——`pagesMd.applicable` 项目生成或全文刷新 `.planning/codebase/PAGES.md`（refreshed 时间戳 + 数据来源口径 + 总览/明细表结构），新增 `templates/pages-md.template`（前端路由/CLI 命令双形态表头）与 agents-md.template 索引表行片段；agents-md.md 手册插入 Step 3（原挂载/提交顺移为 Step 4/5），SKILL.md 缺口清单与验证收敛、契约文档级联引用同步接线
- Agents.md 切片：模板 gsd-docs 表行片段补 `IDENTITY.md`（身份与授权、角色权限模型）
- preflight：`gsdDocs` 新增 `unindexed` 字段——索引漂移检测，`.planning/codebase/` 在盘文档未被挂载索引（`ignored=false` → CLAUDE.md，否则 CLAUDE.local.md）以 `.planning/codebase/<name>.md` 形式引用时列出，堵住手工补登文档与索引脱节的盲区（某内部项目的 TESTING.md/IDENTITY.md 曾因此漂移）；契约文档、agents-md.md Step 3 对账指引、SKILL.md 缺口枚举与验证收敛同步接线

## [0.1.0-alpha.0] - 2026-08-17

- 初始开源版本：开发者体验优化：/dev 动态发现入口与生产隔离、Agents.md/Claude.md AI 上下文基建、Tailwind 类排序 lint 基建（better-tailwindcss）、GitHub Pages 部署基建（Nuxt/Vite SPA 子路径托管）、VSCode 编辑器壳色彩匹配
