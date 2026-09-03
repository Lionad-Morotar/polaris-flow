---
name: flow-dx
description: 优化项目开发者体验（DX）：幂等初始化工作环境——/dev 动态发现入口与生产隔离、Agents.md/Claude.md AI 上下文基建（含 PAGES.md 页面入口清单）、Tailwind 类排序 lint 基建（better-tailwindcss 迁移与 monorepo/Nuxt 集成修复）、GitHub Pages 部署基建（Nuxt/Vite SPA 子路径托管 + CI 首跑陷阱）；按需匹配 VSCode 编辑器壳色彩（Peacock）；
metadata:
  version: 0.1.0-alpha.0
---

## 要求

* 本技能输出的文档默认不进入 git
* **薄编排技能**：flow-dx 自身只定义"要构建什么"——编码、测试、审查交给 `flow-dev` 跑完整循环；纯文档编排（Agents.md 切片）由 flow-dx 直接执行
* 严格按照流程执行，如果碰到以下阻塞按照清单解决：
  * 进入了计划模式，生成了计划：你应当自动确认计划（注意，并非不做计划！而是先计划再自动确认）
  * 有决策需要我确认：我的回答永远是 "按照文档高标准质量决定"
  * **不要暂停**：完成所有阶段，而不是分阶段汇报向我确认，get all shits done
* **根据阶段要求读取执行对应技能，而不是在初始化任务时一口气读取**

## 外部依赖入口

> 以下为环境固定事实，每次执行直接使用。

- `flow-dev` — skill（SKILL.md）：读 `~/.claude/skills/flow-dev/SKILL.md` 后按其 Workflow 执行；实际开发由 flow-dev 完成；flow-dx 把需求与模板交给它

### 条件依赖（仅 Agents.md 切片，对应技能可用时才启用）

> 可用性判定唯一依据：preflight.mjs 输出的 `skills.<name>.available`。**禁止 Read 技能文件做存在性探测**——脚本已一次性完成廉价检测，重复探测纯耗上下文。为执行而调用另当别论：可 Skill 调用的按名调用；`disable-model-invocation` 的编排技能（如 flow-docs）才需读其 SKILL.md 按 Workflow 执行。

- `gsd-map-codebase` / `flow-docs`：生成/更新 `.planning/codebase/*.md` 设计文档
- `impeccable`（`/impeccable init`）：生成 `PRODUCT.md` 产品上下文
- `setup-matt-pocock-skills`：Domain Docs 挂载到 Agents.md
- `learn-codebase`：全库通读 priming

## 核心概念

以下概念服务于 Workflow 步骤 3（Dev Hub 切片），委托 flow-dev 时随需求一并传达。

### Dev Hub

`/dev` 作为一个**动态发现入口**：构建期用 `import.meta.glob('~/pages/dev/**/*.vue')` 收集所有 dev 页面，渲染为可点击的卡片列表。开发者访问 `/dev` 即可看到并跳转所有 `/dev/*` 页面（如各 flow-tour 教学页、调试页）。

新增 dev 页面无需修改入口代码 —— glob 自动发现。

### 生产隔离

`/dev/**` 整族（含 index 入口）**只在本地开发环境存在**，绝不进入任何构建产物（生产环境、测试环境的编译产物均不含）。

实现方式：在 `nuxt.config.ts` 的 `hooks['pages:extend']` 里，当 `process.env.NODE_ENV !== 'development'` 时移除所有 `/dev` 开头路由。路由不注册 → 组件不被引用 → 被 tree-shaking 移除。

> 用 `NODE_ENV === 'development'` 而非 `import.meta.env.DEV`：前者在 `nuxt build`（无论目标环境）恒为 false，恰好满足"测试环境的编译产物也不含 dev"。

**信号源加固（双层保险）**：仅靠 hook 读 `NODE_ENV` 不够稳健——本地执行 `nuxt build` 时，项目根的 `.env.development` 可能把 `NODE_ENV` 拉回 `development`，使 hook 失效、dev 路由泄漏进产物。务必在 `package.json` 的 build/generate 脚本前置 `NODE_ENV=production` 作为第二道闸：

```json
"build": "NODE_ENV=production nuxt build",
"generate": "NODE_ENV=production nuxt generate"
```

hook（过滤已注册路由）与脚本（锁定信号源）各管一环，任一失效另一兜底。

### SSR 模式（dev 页用 ssr:false）

`/dev/**` 页面（尤其是 flow-tour 交互式教学、含 client-only 状态如 localStorage / AudioContext / Web API 的页面）应设 `ssr: false`，避免 hydration mismatch。

hydration mismatch 高发场景：setup 顶层读 `localStorage`/`window`、音效/媒体 composable 在 SSR 与 client 对同一字段求值不同（SSR 用默认 false、client 读真实值），触发 Vue 在 hydration 时移除整棵子树——表现为"SSR HTML 有该元素、客户端渲染后消失"。

两种落地方式：

- **方式 A（推荐，不污染其他页面）**：`routeRules: { '/dev/**': { ssr: false } }`，仅 dev 族 SPA，首页与其他页保持 SSR。
- **方式 B（项目整体是纯客户端交互 demo）**：全局 `ssr: false`。首页也变 SPA——若首页 SSR 有 SEO/首屏价值则别用。

dev 页只本地运行且几乎都是 client-only 交互，ssr:false 一刀切最稳，不必为"SSR 安全默认"硬扛 hydration。

### 认证中间件放行

若项目有全局路由/认证中间件（如 SSO 登录拦截），`/dev/**` 在本地访问时会被重定向到登录门户，而门户常拒绝 `localhost` 回跳地址，导致 Dev Hub 根本打不开。

让认证中间件在开发环境放行 `/dev/**` 是务实的折中——该路由族本就不会进入生产产物：

```ts
// app/middleware/auth.global.ts
if (import.meta.dev && to.path.startsWith("/dev")) return;
```

## 模板

skill 目录 `templates/` 下提供以下参考模板：dev 模板供 `flow-dev` 开发时复制，`agents-md.template` 供 Agents.md 切片直接落地：

- `dev-index.vue.template`：`pages/dev/index.vue`；Dev Hub 入口：glob 收集页面、渲染卡片列表、排除自身、按文件名排序
- `hub.ts.template`：`pages/dev/hub.ts`；Dev Hub 路由推导（`routeOf`）与标题生成（`titleOf`）纯函数，供 index.vue import，可独立单元测试
- `nuxt-dev-isolation.snippet.ts`：粘贴进 `nuxt.config.ts` 的 `hooks` 字段；`pages:extend` 在非 development 移除 `/dev/**` 路由
- `agents-md.template`：`<repo-root>/Agents.md`；Agents.md 切片：项目 AI 上下文入口模板，文件尾附 gsd-docs 与产品上下文的可选表行片段
- `pages-md.template`：`<repo-root>/.planning/codebase/PAGES.md`；Agents.md 切片内建子产物：页面与入口清单骨架（前端路由/CLI 命令双形态表头），仅 `pagesMd.applicable` 项目维护
- `better-tailwindcss.snippet.mjs`：粘贴进 `eslint.config.mjs` 或 `withNuxt()` 参数；Lint 基建切片：official 排序 + 未知标记类前置的规则配置片段
- `require-component-name.rule.template.js`：`<repo-root>/eslint-plugin-<org>/rules/require-component-name.js`；Lint 基建可选增强：组件命名标记类规则（Option Name 与根 class 双校验 + 完整 fixer），头注释标注 prefix/路径匹配/casing 冲突三处项目化调整点
- `no-tracking-marker.rule.template.js`：`<repo-root>/eslint-plugin-<org>/rules/no-tracking-marker.js`；Lint 基建可选增强：注释追踪标记检测（11 类形态、仅扫注释、指令注释跳过、allow 逃逸、数字区间命中给 L 前缀行号改写指引），头注释标注三处项目化调整点
- `no-hardcoded-color.rule.template.js`：`<repo-root>/eslint-plugin-<org>/rules/no-hardcoded-color.js`；Lint 基建可选增强：硬编码颜色拦截（Program 全文扫描、var 区间跳过、白名单），suggestions 经 option 注入，头注释标注 Token 源豁免/测试层关闭/自举边界等六处项目化调整点
- `deploy-pages.yml.template`：`.github/workflows/deploy-pages.yml`；Pages 部署切片：actions artifact 部署 workflow，头注释标注 paths/build 命令/产物路径三处项目化调整点

## 按需参考（独立于初始化流程）

> 不由下方 Workflow 调起，不参与 preflight 盘点与 Ask 收口。用户明确提出对应任务时读取并直接执行；产物不强制进 git（见各参考内说明）。

- `references/vscode-chrome-theming.md`：为项目匹配/修改 VSCode 编辑器壳色彩（需已装 Peacock 扩展）

## Workflow

幂等初始化工作环境：盘点现状 → 确认缺口 → 只补缺口。已就绪的切片自动跳过，重复执行安全，无需记忆"有哪些模式"——缺口清单由盘点脚本算出。

0. 环境盘点（脚本一次完成，不询问）
   - [ ] 运行 `node ~/.claude/skills/flow-dx/scripts/preflight.mjs`，解析 stdout JSON（契约见 `references/preflight-contract.md`）。支持 `--skip devHub,lintInfra` 主动跳过切片——被跳过的写入 `skipped` 数组、`ready` 收敛为 `'skip'`（三态），下游不作为缺口
   - [ ] 若返回 `error` 字段（目标不在 git 仓库内）：向用户报告并终止——产物必须进 git，无仓库不执行
   - [ ] 得出缺口清单：
     * Agents.md 切片缺口：`agentsMd`/`claudeMd` 缺失或互链不正确、`gsdDocs.exists` 为 false、`productMd.exists` 为 false、`gitignoreDocsAgents.agentsSafe` 为 false（`docs/agents/` 被 .gitignore 忽略，需补例外）、`gsdDocs.unindexed` 非空（`.planning/codebase/` 有文档在盘但未进索引）、`pagesMd.applicable` 为 true 且 `pagesMd.exists` 为 false（项目有前端入口或 CLI 子路径，缺页面入口清单；纯后端项目 `applicable` 为 false 自动不适用）
     * 增强项可用性：`skills.<name>.available` 为 true 才可列为 Q2 候选，false 直接剔除——此字段是可用性唯一判定依据，不得另行探测
     * Dev Hub 切片缺口：`devHub.applicable` 为 true 且 `devHub.ready` 为 false（根与 workspace 子包均无 Nuxt 站点包时自动不适用）
     * Lint 基建切片缺口：`lintInfra.applicable` 为 true 且 `lintInfra.ready` 为 false（无 Tailwind + flat config 自动不适用）
     * Pages 部署切片缺口：`pagesDeploy.applicable` 为 true 且 `pagesDeploy.ready` 为 false（非 GitHub 仓库或无 Nuxt 包自动不适用）
   - [ ] 工作分支归一化（先于一切提交动作；缺口清单为空则跳过，不动分支）。`git.owned=false` 即他人项目（如 clone 的开源仓库），本人改动一律落 dev 工作分支：`git.onDefault` 为 true 时——`workBranch.exists` 为 true 则 `git checkout dev`（`behindDefault` 为 true 先 `git merge --ff-only <defaultBranch>` 集成上游，diverged 则不合并、报告提示人工处理）；exists 为 false 则 `git checkout -b dev`。`owned=true`（本人项目）或已不在默认分支（用户自选的分支，予以尊重）时不动。dev 的定位：承载本人全部改动的集成分支，上游推进后由用户 merge 默认分支进 dev；后续所有切片的提交自然落 dev，勿再单独切分支

1. 入口范围确认（全程唯一一次 Ask）
   - [ ] 若 ARGUMENTS 含明确任务指令（如指定切片/增强/目标文件）：视为 Q1/Q2 预设回答，跳过 Ask 直接执行；仅当 ARGUMENTS 模糊或 preflight 缺口超出 ARGUMENTS 范围时才发起 Ask
   - [ ] 若无任何缺口：报告"环境已就绪"并结束，不发起 Ask
   - [ ] 否则用一次 AskUserQuestion 收口所有决策，之后连续执行不再暂停：
     * Q1（multiSelect）：本次补齐的切片，仅列有缺口的（Agents.md 初始化 / Dev Hub 建设 / Lint 基建迁移 / Pages 部署）
     * Q2（multiSelect，Q1 含 Agents.md 切片时生效，否则忽略答案）：增强步骤，仅列 `skills.<name>.available` 为 true 且未就绪的项（gsd-docs 生成或更新 / 产品上下文 / Domain Docs / 全库通读）
     * Q3（单选，A 或 C 已存在且骨架需要改动时生效）：确认覆盖重写
     * Q4（单选）：完成后自动垂直切片提交（message 遵循 `~/GL/flow-skills/skills/flow-git/references/commit-message.md`），还是只输出提交计划
   - [ ] 若 Ask 未被回应：按"文档高标准质量决定"——切片与增强全选、确认重写、自动提交

2. Agents.md 基建（flow-dx 直接执行）
   - [ ] 仅当 Q1 勾选时执行：读 `references/agents-md.md`，按其执行手册完成骨架 → 增强 → PAGES.md → 表格 → 提交

3. Lint 基建切片（flow-dx 直接执行）
   - [ ] 仅当 Q1 勾选且 `lintInfra.applicable` 且非 `ready` 时执行
   - [ ] 读 `references/lint-infra.md`，按其执行手册完成：插件迁移 → ignores 补齐 → 隐性依赖修复 → Nuxt/monorepo 集成修复 → autofix 与测试跟进 → 验证 → 提交

4. Dev Hub 切片（委托 flow-dev）
   - [ ] 仅当 Q1 勾选且 `devHub.applicable` 且非 `ready` 时执行
   - [ ] 读取 `~/.claude/skills/flow-dev/SKILL.md`
   - [ ] 把 `devHub` 中为 false 的字段作为缺口需求，连同本技能的 3 个 dev 模板，交给 flow-dev 跑完整开发循环（grill-me → PRD → TDD → code-review → 外部审查）
   - [ ] 等待 flow-dev 完成

5. Pages 部署切片（flow-dx 直接执行）
   - [ ] 仅当 Q1 勾选且 `pagesDeploy.applicable` 且非 `ready` 时执行
   - [ ] 读 `references/pages-deploy.md`，按其执行手册完成：baseURL 子路径改造 → build:pages script → workflow 落地 → 本地构建验证 → gh 开 Pages → 推送与首跑盯梢 → 线上验证 → 提交
   - [ ] 多站点包（`sitePkgs` 长度 > 1）时先与用户确认部署目标，不默认取首个

6. 验证（preflight 重跑作裁判）
   - [ ] 重跑 `preflight.mjs`（带本次 `--skip` 列表以复现 skip 态）：执行过的切片对应字段应收敛为就绪——`ready` 为 `true`（就绪）或 `'skip'`（主动跳过，不要求收敛）均算通过；`false` 才是未收敛（A/C 互链正确、`gsdDocs` 就绪且 `unindexed` 为空、`productMd` 就绪、`gitignoreDocsAgents.agentsSafe` 为 true、`pagesMd` 不适用或 `exists` 为 true）。未收敛说明执行有漏，修复后再判
   - [ ] Dev Hub 切片后补充运行时验证：`nuxt dev` 访问 `/dev` 看到动态列表；生产 build 后产物无 `/dev` 路由
   - [ ] Lint 基建切片后补充运行时验证：全量 `eslint . --fix` 不炸（ESLint 10 级联查找无 `ERR_MODULE_NOT_FOUND`），`better-tailwindcss/*` 命中收敛到 0 或仅剩人工决策项
   - [ ] Pages 部署切片后补充运行时验证：部署 workflow 首轮运行绿；线上 `https://<owner>.github.io/<repo>/` 首页与深链接 curl 200

7. 报告
   - [ ] 写 `docs/reports/<taskname>-dx-report.md`（注意：该路径可能被用户全局 `~/.gitignore_global` 忽略，属正常——报告是本地流程记录，不入库）
   - [ ] 给出垂直切片提交建议（按 `references/agents-md.md` Step 5 的入库策略分支）
   - [ ] 把本次实战中发现的、可复用的问题与修复回流到 flow-dx 技能（如模板 bug、preflight 误判、新暴露的 DX 陷阱）——避免下个项目重踩
