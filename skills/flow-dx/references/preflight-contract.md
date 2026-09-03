# 盘点 JSON 契约

`scripts/preflight.mjs` stdout 的固定格式。版本化，字段稳定，新增字段只增不改；消费方应按字段名取值，不依赖输出顺序。

## 用法

```bash
node preflight.mjs                              # 默认 cwd
node preflight.mjs <目标目录>
node preflight.mjs --skip devHub,lintInfra      # 主动跳过切片（ready 收敛为 'skip'）
node preflight.mjs --skip devHub <目标目录>
```

`--skip <csv>`：逗号分隔切片名（`devHub` / `lintInfra` / `pagesDeploy`）。被跳过的切片写入顶层 `skipped` 数组，对应 `ready` 收敛为 `'skip'`（三态），验证阶段不要求收敛——用户主动决策，非缺口。

```json
{
  "version": 1,
  "repoRoot": "<abs path>",
  "git": {
    "branch": "dev",
    "defaultBranch": "main",
    "onDefault": false,
    "remote": { "host": "github.com", "owner": "yetone", "repo": "cumora", "url": "https://github.com/yetone/cumora.git" },
    "identity": { "name": "仿生狮子", "email": "you@example.com" },
    "ownerMatch": false,
    "authorShare": 0.06,
    "owned": false,
    "workBranch": { "name": "dev", "exists": true, "current": true, "behindDefault": false }
  },
  "stack": { "isNuxt": true, "nuxtConfig": "nuxt.config.ts" },
  "agentsMd": {
    "exists": true,
    "fileName": "Agents.md",
    "path": "<abs path>",
    "isSymlink": false,
    "linkTarget": null,
    "gitTracked": true
  },
  "claudeMd": {
    "exists": true,
    "fileName": "Claude.md",
    "path": "<abs path>",
    "isSymlink": true,
    "linkTarget": "Agents.md",
    "gitTracked": false
  },
  "claudeLocalMd": {
    "exists": false,
    "fileName": null,
    "path": null,
    "isSymlink": false,
    "linkTarget": null,
    "gitTracked": false
  },
  "gsdDocs": { "exists": true, "dir": "<abs path>", "files": ["STACK.md"], "ignored": false, "unindexed": [] },
  "productMd": { "exists": false, "path": "<abs path>" },
  "gitignoreDocsAgents": { "docsIgnored": false, "agentsSafe": true },
  "pagesMd": {
    "applicable": true,
    "exists": false,
    "pkgs": [
      { "pkg": ".", "frontend": ["src/views", "src/router"], "cli": [] },
      { "pkg": "packages/cli", "frontend": [], "cli": ["package.json#bin", "src/commands"] }
    ]
  },
  "devHub": {
    "applicable": true,
    "sitePkgs": ["playground"],
    "sitePkg": "playground",
    "devIndex": true,
    "hubTs": true,
    "isolationHook": true,
    "nodeEnvGuard": true,
    "ssrFalse": true,
    "authBypass": true,
    "globalMiddleware": ["playground/app/middleware/auth.global.ts"],
    "ready": true
  },
  "lintInfra": {
    "applicable": true,
    "eslintConfig": "eslint.config.mjs",
    "oldPlugin": false,
    "newPlugin": true,
    "ignoresGaps": [],
    "implicitDeps": {
      "entryPoint": "./src/assets/main.css",
      "bare": ["@my/theme"],
      "missing": []
    },
    "nuxtEslint": { "moduleRegistered": true, "generatedConfigExists": true },
    "workspaceConfigs": { "broken": [], "nuxtEslintMissing": [] },
    "ready": true
  },
  "pagesDeploy": {
    "applicable": true,
    "sitePkgs": ["playground"],
    "sitePkg": "playground",
    "workflow": true,
    "baseUrl": true,
    "buildScript": true,
    "ghPagesEnabled": true,
    "ready": true
  },
  "skills": {
    "gsd-map-codebase": { "available": true, "path": "<abs path>" },
    "flow-docs": { "available": true, "path": "<abs path>" },
    "impeccable": { "available": false, "path": null },
    "setup-matt-pocock-skills": { "available": true, "path": "<abs path>" },
    "learn-codebase": { "available": true, "path": "<abs path>" }
  },
  "skipped": []
}
```

## 字段语义

通用：

* 致命错误时退出码 1，JSON 仅含 `{ "version": 1, "error": "..." }`
* `fileName` 按真实文件名回报（大小写不敏感匹配 `Agents.md`/`AGENTS.md` 变体，返回磁盘上的实际名字）；文件不存在时 `exists` 为 false，其余字段为 null/false
* `ready` 三态：`true`（就绪）/ `false`（有缺口，待收敛）/ `'skip'`（被 `--skip` 主动跳过，验证阶段不要求收敛）。顶层 `skipped` 数组记录所有被跳过的切片名

项目归属与工作分支（`git`）：

* 目的：识别「clone 的他人项目」（如开源仓库），把本人改动收敛到 dev 工作分支而非默认分支——dev 承载全部个人改动，上游推进后 merge 默认分支进 dev
* `owned` 启发式（任一命中即本人项目）：无 origin remote（纯本地仓库视为本人项目）；origin owner 大小写不敏感命中本地身份（`user.name` / `user.email` / email 本地段——user.name 常是显示名而非登录名，所以 email 本地段必须参与匹配）；近 50 个 first-parent 提交的作者/提交者身份占比 `authorShare` ≥ 0.5（兜底「自己的仓库但显示名与登录名都不匹配」的场景，fresh clone 的他人仓库为 0 或接近 0）。判定不出时宁可视为本人项目——只有 `owned=false` 才会动分支
* `defaultBranch`：origin/HEAD 的实际指向，退回 main/master 本地存在性；`onDefault` = 当前分支即默认分支。 detached HEAD 时 `onDefault` 为 false，Workflow 不动分支
* `workBranch.behindDefault`：dev 存在且是 defaultBranch 的**严格祖先**——可 `git merge --ff-only` 无冲突集成上游；diverged 时为 false，Workflow 不做合并、报告中提示人工处理
* 本探测**只读**：不 checkout、不建分支、不合并——分支动作由 SKILL.md Workflow 步 0 按这些字段执行

Agents.md 切片：

* A/C 互链就绪的判定规则：一者 `isSymlink: false`（真实文件）、另一者 `isSymlink: true` 且 `linkTarget` 指向对方。两者都是真实文件时视为未就绪（内容可能漂移），骨架步骤负责收敛* `claudeLocalMd`：CC 官方本地 memory 层（项目根 `CLAUDE.local.md`，与 CLAUDE.md 一同加载，个人不入库）。`gsdDocs.ignored=true` 时，文档引用应挂这里而非 CLAUDE.md，避免团队共享文件出现死链
* `gsdDocs.exists` 仅在 `.planning/codebase/` 内有 ≥1 个 `.md` 时为 true
* `gsdDocs.ignored`：`git check-ignore` 实测 `.planning/codebase/STACK.md` 是否被项目或全局 ignore 命中。**不预设入库策略**——消费方（agents-md.md）据此选择挂载目标：`ignored=true` → `CLAUDE.local.md`（本地）；`ignored=false` → `CLAUDE.md`（团队共享）。check-ignore 只匹配规则不要求文件存在，盘点期即可判定
* `gsdDocs.unindexed`：`.planning/codebase/` 下实际存在、却未被挂载索引（`ignored=false` → `CLAUDE.md`，否则 `CLAUDE.local.md`）以 `.planning/codebase/<name>.md` 形式引用的文档清单。非空即**索引漂移**——文档在盘但未进索引（手工补登的文档易与索引脱节，如 TESTING.md/IDENTITY.md），Agents.md 切片 Step 4 应逐行补登。目录为空或无索引文件时为 `[]`
* `gitignoreDocsAgents.agentsSafe` 为 false 表示 `docs/agents/domain.md` 被 .gitignore 忽略（常见于项目把 `docs/` 整目录排除，如 flow-dev 运行文档策略），需在提交前把 `docs/` 改写为 `docs/*` 并追加 `!docs/agents/` 例外；`docsIgnored` 为诊断字段，指示 `docs/` 自身是否被规则匹配。git check-ignore 只匹配规则不要求文件存在，盘点期即可判定，把入库隐患前置到范围确认阶段
* `skills.*.available` 覆盖 `~/.claude/skills` 与插件 marketplaces/cache 两处来源。**技能可用性以此字段为唯一判定依据**：`available=false` 的增强项从范围确认（Q2）选项中剔除，消费方不得再 Read 技能文件做存在性确认——探测已由脚本一次完成，重复探测纯耗上下文
* `pagesMd`：PAGES.md 页面入口清单（`.planning/codebase/PAGES.md`），Agents.md 切片的内建子产物。`applicable` = 根或 pnpm-workspace 任一子包有可枚举入口族——前端信号（`pages/`、`app/pages/`、`app/routes/`、`src/pages/`、`src/routes/`、`src/views/`、`src/router/` 或 `src/router.ts`；`app/` 单独不算，Nuxt 4 的 app/ 是源码根而非页面目录）或 CLI 信号（package.json `bin` 字段、`bin/`、`commands/`、`src/commands/`、`src/cli/`）；两族皆空的纯后端项目强行生成只会得到空表，故不适用。`pkgs` 回报每个命中包的信号明细（执行手册据此定提取来源）。`exists` 与 `applicable` 解耦：项目重构后不再适用但文件仍在盘时，消费方能区分「待生成」与「残留待清理」。**无 `ready` 字段、不进 `--skip` 三态机制**——PAGES.md 不是独立切片，就绪收敛由 Agents.md 切片整体判定（`applicable=true` 且 `exists=false` 即缺口）；索引完整性由 `gsdDocs.unindexed` 天然覆盖（PAGES.md 在 `.planning/codebase/` 下，在盘未进索引即被漂移检测捕获），本字段不重复探测

Dev Hub 切片：

* `applicable` = 根或 pnpm-workspace 任一子包为 Nuxt 站点包（与 pagesDeploy 同一套 `isNuxtPkg` 判定：nuxt.config 存在或 deps 含 nuxt，且剔除 `@nuxt/module-builder` 标记的 Nuxt 模块包——模块库 deps 含 nuxt 只是构建期同伴，旧版按 `stack.isNuxt` 根判定会把模块库误报为 applicable、把 playground 型 monorepo 漏报为不适用）；为 false 时 devHub 仅含此字段，其余信号不探测
* `sitePkgs` 为全部 Nuxt 站点包（相对路径，根记为 `"."`）；`sitePkg` 取首个作为探测基准——后续所有就绪信号都以站点包根（而非仓库根）为基准探测；多站点场景由范围确认时人工改判
* 五个就绪信号：`devIndex`（站点包 `pages/dev/index.vue` 或 `app/pages/dev/index.vue`）、`hubTs`、`isolationHook`（站点包 nuxt.config 含 `pages:extend` 且提及 `/dev`）、`nodeEnvGuard`（站点包所有已存在的 build/generate 脚本均前置 `NODE_ENV=production`——闸在站点包 scripts 上，monorepo 根脚本只是递归转发）、`ssrFalse`（routeRules 中 `/dev/**` 或全局 `ssr: false`）
* `authBypass` 三态：站点包无全局中间件为 `null`（N/A，不影响 ready）；有中间件且至少一个同时命中 dev 检测 + `/dev` 路由放行为 `true`；否则为 `false`（缺口）。dev 检测覆盖多种写法：`import.meta.dev` / `import.meta.env.DEV` / `isDev()` 等封装函数 / `process.env.NODE_ENV`——只认 `import.meta.dev` 会漏判项目封装的 dev 工具函数（如 `~/utils/env` 的 `isDev()`）。`globalMiddleware` 以仓库根相对路径回报
* 内容类检查（isolationHook/ssrFalse/authBypass）是正则启发式，只判断"提到过"，不做 AST 级断言；`ready` 为 true 但运行时异常时，以运行时为准并回流修复脚本

Lint 基建切片：

* `applicable` = deps 含 `tailwindcss` 且根级存在 eslint flat config；两者缺一仅返回 `{ applicable: false }`
* `oldPlugin`/`newPlugin` 分别探测 devDeps 中的 `eslint-plugin-tailwindcss`（旧世代）与 `eslint-plugin-better-tailwindcss`（目标世代）
* `ignoresGaps`：根级实际存在的产物目录（`.nuxt`/`.output`/`.serve`/`.histoire`/`.vite`/`.turbo`/`coverage` 及所有 `dist*` 变体）中，未被 eslint config 文本以引号包裹形式提及的目录——不 ignore 会让 lint 结果被构建产物噪音淹没
* `implicitDeps` 仅在 config 含 `entryPoint`（better-tailwindcss 的 Tailwind v4 CSS 入口）时探测：提取 CSS 中 bare `@import` 包名，未在根 package.json 声明的列入 `missing`。pnpm 严格 node_modules 布局下未声明的包对 lint 插件不可达，`@import` 静默失败会把主题类误报为 unknown——报错位置远离根因，此检查就是为捕捉它；`entryPoint` 提取不到（非 CSS 入口项目）时为 `null`
* `nuxtEslint` 仅根为 Nuxt 时存在：`moduleRegistered`（nuxt.config 提及 `@nuxt/eslint`）与 `generatedConfigExists`（`.nuxt/eslint.config.mjs`，由模块在 prepare/dev 时生成）——缺一即 site 型项目 lint 断裂
* `workspaceConfigs` 在 pnpm-workspace.yaml 声明了包时存在（与 pagesDeploy 共享 `expandWorkspacePkgs`，同时支持单包条目 `'playground'` 与单星 glob `'packages/*'`）：`broken` 列出子包 eslint config 中不可达的相对 import（ESLint 10 起 config 从被 lint 文件位置级联查找，一处不可达会炸掉根 `eslint .`）；`nuxtEslintMissing` 列出有 nuxt.config 但未注册 `@nuxt/eslint` 的子包
* `ready` = 无旧插件 + 新插件已装 + ignores 无缺口 + 无隐性依赖缺失 + Nuxt ESLint 集成完整 + workspace config 全部可达

GitHub Pages 部署切片：

* `applicable` = origin remote 为 github.com 且（根或 pnpm-workspace 任一子包为站点包）；workspace 展开同时支持单包条目（`'playground'`）与单星 glob（`'packages/*'`）。站点包两种形态：**Nuxt**（nuxt.config 存在或 deps 含 nuxt）与 **Vite SPA**（vite.config 与 index.html 双存在——以 Vite 为构建工具的库包有 vite.config 但无 index.html，双存在恰好排除）。Nuxt **模块包**（devDeps 含 `@nuxt/module-builder` 或 scripts 含 `nuxt-module-build`）不算站点——其 deps 含 nuxt 只是 module-builder 的构建期同伴，不剔除会抢占 sitePkgs 首位、把 baseUrl/buildScript 检查打到模块包上
* `sitePkgs` 为全部站点候选包（相对路径，根记为 `"."`）；`sitePkg` 取首个作为部署目标——多站点场景由范围确认时人工改判
* 三个就绪信号：`workflow`（`.github/workflows/` 任一 yml 引用 `actions/deploy-pages`）、`baseUrl`（sitePkg 的 nuxt.config 提及 `NUXT_APP_BASE_URL`/`baseURL`，或 vite.config 提及 `VITE_APP_BASE_URL`/`base:`——`/<repo>/` 子路径托管的必需改造）、`buildScript`（sitePkg scripts 含 `github_pages` preset，或存在 `build:pages` script——Vite 无 preset 机制的约定名）
* `ghPagesEnabled` 三态：GitHub 端 Pages 开关。`gh api` 查询失败（离线/未登录/仓库不可达）为 `null`；已开启且 `build_type=workflow` 为 `true`；否则 `false`。**网络态不进 `ready`**——盘点是本地只读，离线重跑不应误判未就绪；为 `false` 时由执行手册的"开启 Pages"步骤补齐
* `ready` = 三就绪信号全真
