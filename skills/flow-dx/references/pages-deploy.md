# GitHub Pages 部署切片执行手册

由 SKILL.md Workflow 步骤 5 调起。环境盘点与范围确认已在 Workflow 中完成，本手册接收其决策输入，把站点包（根或 workspace 内的 Nuxt 包）部署到 GitHub Pages（actions artifact 模式，无 gh-pages 分支）。

配置工程，无业务逻辑，flow-dx **直接执行**，不委托 flow-dev。产物是项目基建文件，**全部进入 git**。

## 输入（来自 Workflow）

* 盘点 JSON 的 `pagesDeploy` 字段（契约见 `references/preflight-contract.md`）：目标站点包 `sitePkg`、三个就绪信号现状、`ghPagesEnabled` 三态
* 范围确认决策：提交方式

## 目标状态

* 站点包以 `NUXT_APP_BASE_URL=/<repo>/` 构建，asset 路径构建期固化带子路径前缀
* `.github/workflows/deploy-pages.yml`：master push（路径过滤）+ 手动触发，`upload-pages-artifact` → `deploy-pages`
* GitHub 端 Pages 已开启且 `build_type=workflow`，站点在线上 `https://<owner>.github.io/<repo>/` 可达
* CI 首跑全绿（含既有测试 workflow 在干净环境下的首次真实运行）

## 执行步骤

### 1. baseURL 子路径改造（对应 `pagesDeploy.baseUrl`）

GitHub Pages 项目站点托管在 `/<repo>/` 子路径，Nuxt 的 `app.baseURL` 必须构建期固化——运行时再改无效，asset 路径（`_nuxt/*.js`）是构建时拼进 HTML 的。同时 head 里的**绝对路径资源**（`/xxx.js`）不会自动加前缀，子路径下会打到域根 404。

```ts
// nuxt.config.ts
// GitHub Pages 以 /<repo>/ 子路径托管,asset 路径在构建期固化,故从 env 读入并显式回写
const baseURL = process.env.NUXT_APP_BASE_URL ?? '/';

export default defineNuxtConfig({
  app: {
    baseURL,
    head: {
      // src 必须带 baseURL 前缀,绝对路径在子路径部署下会打到域根 404
      script: [{ src: `${baseURL}traceLog.js` }]
    }
  }
});
```

排查站点包内所有以 `/` 开头的静态资源引用（head script/link、public 目录引用、CSS url()），全部拼上前缀。

**Vite 变体**：vite.config 的 `base` 等价于 `app.baseURL`，同样构建期固化：

```ts
// vite.config.ts
// GitHub Pages 以 /<repo>/ 子路径托管,asset 路径构建期固化,故从环境读入(本地开发缺省 '/')
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return { base: env.VITE_APP_BASE_URL ?? '/' };
});
```

index.html 的 `<script src="/main.ts">` 入口由 Vite 构建时按 base 自动重写，无需手改；但**运行时读 `location.pathname` 做页面分发的代码**（无框架路由的手写 SPA 常见）要自己剥离 base 前缀——`import.meta.env.BASE_URL` 构建期静态内联，回退跳转显式拼回前缀（给 `location.pathname` 赋相对值在尾斜杠缺失时会被 URL 解析 pop 掉仓库段）。

### 2. build:pages script（对应 `pagesDeploy.buildScript`）

站点包 `package.json` 加：

```json
"build:pages": "nuxt build --preset github_pages"
```

`github_pages` preset 自动做两件关键事：写 `.nojekyll`（否则 GitHub 的 Jekyll 处理忽略 `_nuxt/` 下划线目录，全站 asset 404）；为 SPA 生成 `404.html` fallback（未知路径返回它，客户端路由借此接管刷新与深链接）。

**Vite 变体**：Vite 无 preset 机制，两件事在 `build:pages` script 里手动补齐（产物默认 `dist`）：

```json
"build:pages": "vite build && cp dist/index.html dist/404.html && touch dist/.nojekyll"
```

Vite 产物目录是 `assets/`（无下划线），`.nojekyll` 非严格必需，但加上防未来引入下划线资源时全站 404。深链接 fallback 依赖 GitHub Pages 的 404.html 语义：不存在路径返回 404 状态码 + 404.html 内容，浏览器照常执行其中 JS——curl 验证深链接时应比对 body 与首页一致，而非期待 200。

### 3. workflow 落地（对应 `pagesDeploy.workflow`）

复制 `templates/deploy-pages.yml.template` 为 `.github/workflows/deploy-pages.yml`，按模板头注释调整三处：paths 过滤清单（影响产物的全部输入路径）、Build 命令的 `--dir`（站点包非根时）、产物 path。

既有 CI workflow 顺带检查：`pnpm/action-setup@v4` 必须显式 `version`——无 `packageManager` 字段时 action 无法解析 pnpm 版本直接报错（新 workflow 首推前修，见坑清单）。

### 4. 本地构建验证

```bash
NUXT_APP_BASE_URL=/<repo>/ pnpm --dir <sitePkg> build:pages   # Nuxt
VITE_APP_BASE_URL=/<repo>/ pnpm --dir <sitePkg> build:pages   # Vite
```

产物检查清单（Nuxt `<sitePkg>/.output/public`；Vite `<sitePkg>/dist`）：

- [ ] `.nojekyll` 存在
- [ ] `404.html`（与 SPA 时的 `200.html`）存在
- [ ] `index.html` 内 asset 引用带 `/<repo>/_nuxt/` 前缀
- [ ] head 注入的静态资源引用带 `/<repo>/` 前缀且文件本体在产物中

子路径 HTTP 模拟（GitHub Pages 把仓库内容挂在 `/<repo>/` 下）：

```bash
mkdir -p /tmp/pages-preview && ln -s "$(pwd)/<sitePkg>/.output/public" /tmp/pages-preview/<repo>
cd /tmp/pages-preview && python3 -m http.server <port>
# curl 验证 /<repo>/、/<repo>/<asset>、深链接 /<repo>/<route>/ 均为 200（目录式路由的 301 加斜杠属正常）
```

### 5. 开启 GitHub 端 Pages（对应 `ghPagesEnabled`）

`actions/deploy-pages` 要求仓库 Pages source 为 "GitHub Actions"，否则首次部署 404：

```bash
# 未开启过（GET 返回 404）：
gh api repos/<owner>/<repo>/pages -X POST -f "build_type=workflow"
# 已开启但 source 是分支模式：POST 改 PATCH
gh api repos/<owner>/<repo>/pages -X PATCH -f "build_type=workflow"
```

盘点 JSON 的 `ghPagesEnabled` 为 `true` 时跳过；为 `null`（查询失败）时先 `gh api repos/<owner>/<repo>/pages` 探明现状再决定 POST/PATCH。

### 6. 推送与首跑盯梢

```bash
git push origin master
gh run watch <run-id> --exit-status
```

**新 workflow 首次推送后必须盯首轮运行**，包括被一同触发的既有 CI——很多项目此时才第一次拥有"诚实的验证环境"（见"首跑验证协议"）。部署 job 成功后 `steps.deployment.outputs.page_url` 即站点 URL。

### 7. 线上验证

- [ ] `/` 与若干路由（含深链接如 `/<repo>/<route>/`）curl 200
- [ ] 首页 HTML 内入口 chunk URL curl 200
- [ ] head 静态资源 curl 200
- [ ] `concurrency: pages` 组下连续 push 不产生并行部署（gh run list 观察）

### 8. 提交

按范围确认的提交方式。垂直切片建议：① baseURL 改造 + build:pages script（站点包）② deploy-pages workflow ③ 既有 CI 修复（pnpm version、依赖声明等）按问题各自独立成 commit。

## 首跑验证协议（本地绿 ≠ CI 绿）

新建/新修 CI workflow 的首轮运行是项目的第一次干净环境验证，本地全绿不能外推 CI 全绿——本地机器可能存在项目未声明的解析兜底：

* **stray node_modules 掩盖**：`~/node_modules`、`~/<projects>/node_modules` 等目录的残留安装会被 Node 模块解析的向上查找链静默兜底。自查命令（在目标包目录执行，解析路径落在项目外即是隐患）：

  ```bash
  node --input-type=module -e "console.log(import.meta.resolve('<pkg>'))"
  ```

* 所有被工具链**隐式依赖**的包都应显式写进 manifest：`@types/node`（node: 前缀模块与 process 等全局的类型来源）、`vue-tsc` + `typescript`（`nuxi typecheck` 的 checker）等。
* 主版本兼容线要写死：如 `typescript@7`（Go 原生重写）不再导出 `lib/tsc`，依赖 JS API 的工具（vue-tsc 等）必须钉 `~5.9`。

## 坑清单（故障现象 → 根因）

- 子路径部署后 head 静态资源 404：绝对路径 `/xxx.js` 未拼 baseURL 前缀，请求打到域根；步骤 1
- 全站 asset 404（HTML 正常）：缺 `.nojekyll`，Jekyll 忽略 `_nuxt/` 下划线目录；步骤 2（preset 自动处理）
- SPA 刷新/深链接 404：缺 `404.html` fallback；步骤 2（preset 自动处理）
- Vite 站点子路径部署后 asset 全 404：vite.config 未设 `base`，产物 asset 路径钉在域根；步骤 1 Vite 变体
- Vite 手写 pathname 分发（无框架路由）子路径下匹配不到页面：`location.pathname` 带 base 前缀未剥离；步骤 1 Vite 变体
- Vite 站点 curl 深链接返回 404 状态：预期行为，GitHub Pages 的 404.html 语义就是 404 状态 + 自定义 body，比对 body 而非状态码；步骤 2 Vite 变体
- workspace 站点包以 `workspace:*` 直引库包且其 exports 指向 dist：CI 只 build 站点包会 resolve 失败，须显式先构建库包（如 `pnpm --filter <lib> build`）；步骤 3 Build 命令
- `pnpm/action-setup` 报错：无 version 且无 `packageManager` 字段，action 无法解析 pnpm 版本；步骤 3
- typecheck 本地过 CI 挂（`Cannot find name 'process'` / `node:fs`）：stray `~/node_modules/@types/node` 向上查找兜底，`@types/node` 从未声明；首跑验证协议
- `nuxi typecheck` 报缺 checker：同上，`vue-tsc`/`typescript` 靠 stray 安装兜底；首跑验证协议
- vue-tsc 崩 `ERR_PACKAGE_PATH_NOT_EXPORTED: ./lib/tsc`：`typescript@7` 原生版无 JS API 入口；首跑验证协议（钉 `typescript@~5.9`）
- 像素断言边界抖动（如 2.01px vs 容差 2）：CI 与本地字体渲染差异，非随机 flake（重跑同值）；按引擎分级容差（WebKit 10 / Gecko 5 / Chromium 3）
- CI rollup `Could not resolve "../../..../x.ts"` 但本地构建绿：深层相对导入被 server bundle 重基为逃出仓库的路径，本地 `.nuxt` 缓存掩盖；干净环境才暴露；页面/组件一律用 `~/` 或 `#` 别名导入共享模块；修复后 `rm -rf .nuxt` 本地复现验证

## 产物清单

- base 子路径改造：`<sitePkg>/nuxt.config.ts`（Nuxt）或 `<sitePkg>/vite.config.ts` + 运行时 pathname 分发处（Vite）；进 git：是
- build:pages script：`<sitePkg>/package.json`；进 git：是
- 部署 workflow：`.github/workflows/deploy-pages.yml`；进 git：是
- 既有 CI 修复（pnpm version、依赖声明）：`.github/workflows/*.yml`、`package.json` + lockfile；进 git：是
- GitHub 端 Pages 开关：仓库 Settings（gh api）；进 git：否（平台状态）
