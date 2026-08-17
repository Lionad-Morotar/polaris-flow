# Lint 基建切片执行手册

由 SKILL.md Workflow 步骤 3 调起。环境盘点与范围确认已在 Workflow 中完成，本手册接收其决策输入，把项目的 Tailwind 类排序体系迁移到 `eslint-plugin-better-tailwindcss`，并修复盘点发现的 monorepo/Nuxt 集成断裂。

> 适用场景扩展（cx 实战回流）：`lintInfra.applicable=false`（无 Tailwind 或无既有 config）不阻断执行——用户指令明确要求"初始化 lint infra / 共享 config 子包"时，按本手册的通用步骤（依赖与配置 → ignores → 隐性依赖 → 集成修复 → autofix → 验证 → 提交）执行，跳过 Tailwind 专属步骤（entryPoint、better-tailwindcss 规则）。monorepo 共享 config 子包的推荐形态：纯 JS 无构建（lint 是开发链路第一步，不能依赖构建产物）、`createConfig(options)` 工厂 + 默认导出项目预设、插件作 dependencies、eslint 本体作 peerDependencies、TS 消费方存在时配 `index.d.ts`（声明默认导出为 `ESLint.Plugin`）+ `exports['.'].types` 条件——纯 JS 包缺声明文件会让 TS 消费方（如根 `eslint.config.mjs`）报 TS7016。

配置工程，无业务逻辑，flow-dx **直接执行**，不委托 flow-dev。产物是项目基建文件，**全部进入 git**。

## 输入（来自 Workflow）

* 盘点 JSON 的 `lintInfra` 字段（契约见 `references/preflight-contract.md`）
* 范围确认决策：提交方式

## 目标状态

* `eslint-plugin-better-tailwindcss` 替代 `eslint-plugin-tailwindcss`（旧世代：性能差、beta 依赖、无标记类前置能力）
* 类排序：`enforce-consistent-class-order` 开 `order: 'official'`（官方语义序）
* **标记类前置默认启用**：`unknownClassPosition: 'start'` + `unknownClassOrder: 'preserve'`（均为插件默认值）——`layout-`/`page-`/`cmpt-` 等自定义标记类自动排在 class 列表最前且保持原相对顺序，无需任何自研排序插件
* `no-unknown-classes` 默认 **off**（对齐大多数项目的既有容忍度；开启时机见步骤 6）
* 自研规则三件套（可选增强，模板与手册章节一一对应，项目化调整点见各模板头注释）：

- `no-hardcoded-color`：`templates/no-hardcoded-color.rule.template.js`；文末「硬编码颜色规则」；硬编码色值零存在，颜色收口设计 Token；suggestions 经 option 注入
- `no-tracking-marker`：`templates/no-tracking-marker.rule.template.js`；文末「注释追踪标记规则」；注释不夹带任务 ID/阶段号/评审编号等死引用，只解释 Why
- `require-component-name`：`templates/require-component-name.rule.template.js`；文末「组件命名标记类规则」；Option Name 与根 class 统一为路径推导名，fixer 全量收敛；标记类是 better-tailwindcss 未知类前置排序的语义基础

## 执行步骤

### 1. 依赖与配置迁移

- [ ] `pnpm add -D eslint-plugin-better-tailwindcss && pnpm remove eslint-plugin-tailwindcss`
- [ ] eslint flat config 中替换插件注册与规则（映射表见下）；删除自研类排序插件（如 `lib/eslint-plugin-*-order.mjs`）及其引用
- [ ] 配置 `settings['better-tailwindcss'].entryPoint`（Tailwind v4：CSS 入口文件绝对路径）或 `tailwindConfig`（v3：`tailwind.config.js`）

旧规则映射：

- `classnames-order`：`enforce-consistent-class-order`（`order: 'official'`）
- `no-contradicting-classname`：`no-conflicting-classes`
- `enforces-shorthand`：`enforce-shorthand-classes`
- `no-custom-classname`：`no-unknown-classes`（默认保持 off）
- —（新增能力）：`no-duplicate-classes`、`no-unnecessary-whitespace`、`no-deprecated-classes`

### 2. 补齐 ignores（对应 `lintInfra.ignoresGaps`）

- [ ] 把盘点列出的产物目录加入 eslint config 的 ignores：`.nuxt`/`.output`/`.serve`/`.histoire`/`.vite`/`.turbo`/`coverage` 及 `dist*` 变体
- [ ] 产物目录不 ignore 时，lint 会扫描构建产物——数十万条噪音淹没真实问题，且 autofix 可能改写生成物

**治理范围收敛（源码级 ignores，黑名单制）**：产物目录之外，非生产代码同样默认忽略——
留在扫描范围只会让存量数字虚高、治理优先级失真：

- `playground/`、`play/`、`demo/`、`examples/`：开发沙箱；demo 页的颜色/any 是展示内容本身，不属设计治理
- `pages/dev/**`（Dev Hub 切片产物）：演示页；与生产隔离同源：路由不进产物，lint 也不该扫
- `**/*.test.*`、`**/tests/**`：测试；mock/fixture 的 any 与宽松表达式是测试固有形态；vitest/jest 插件层随之一并移除（无文件可扫即成死包）
- `**/zRefs/**`：调试参考区；第三方源码副本与一次性脚本，非项目本体
- `**/temp/**`、`**/tmp/**`：临时区；同上

- [ ] 黑名单写在 eslint config 的 ignores，**不写 lint 脚本路径限定**——IDE 的 ESLint 插件只读 config，脚本限定会让编辑器与 CLI 两个体验面漂移
- [ ] monorepo 收敛到核心包时同法：`packages/<物料包>/**` 整包 ignore，注释注明治理顺序与"放开即删行"
- [ ] 范围收敛后检查契约测试：fixture 路径若落在被 ignore 的包内会全挂——规则/插件的行为测试应与治理范围解耦（工厂版 config + 显式规则层，预设只承担治理决策断言）
- [ ] 收敛验证时"某包零命中"需证伪而非接受：确认是纯文档包/无源码，而非扫描配置漏了

### 3. 修复隐性依赖（对应 `lintInfra.implicitDeps.missing`）

- [ ] 把 entryPoint CSS 中 bare `@import` 的包声明进**运行 lint 的包**的 package.json（通常 `pnpm add -D '<pkg>'`）
- [ ] Why：pnpm 严格 node_modules 布局下，未声明的包不可达；插件编译 entryPoint 时 `@import` 静默失败，主题类（如 `text-muted-foreground`）被误报 unknown——报错位置远离根因
- [ ] workspace 包用 `'<name>@workspace:*'` 引用

### 4. 修复 Nuxt 集成（对应 `lintInfra.nuxtEslint` 与 `workspaceConfigs`）

- [ ] 根为 Nuxt 且 `moduleRegistered: false`：`nuxt.config` 的 `modules` 数组补 `'@nuxt/eslint'`
- [ ] `generatedConfigExists: false`：跑 `nuxt prepare` 生成 `.nuxt/eslint.config.mjs`（模块注册后才会生成）
- [ ] `workspaceConfigs.broken` 非空：修复子包 eslint config 中不可达的相对 import——ESLint 10 起 config 从被 lint 文件位置级联查找，一处不可达会炸掉根 `eslint .`
- [ ] Nuxt 项目接入排序：在 `withNuxt()` 参数中 append 配置块（模板见 `templates/better-tailwindcss.snippet.mjs`），`entryPoint` 指向 app 的 CSS 入口（如 `app/assets/css/main.css`）

### 5. 应用 autofix 并跟进测试

- [ ] 跑 `pnpm exec eslint . --fix`（全量加超时），autofix 应用排序/shorthand/whitespace 修复
- [ ] **预期测试破坏**：`enforce-shorthand-classes` 会把 `h-full w-full` 合并为 `size-full` 等——按旧类名断言的测试（`expect(classes()).toContain('h-full')`）会挂，更新断言跟进合并结果
- [ ] 跑项目测试套件确认功能无损；class 重排属纯样式语义，挂载/交互测试不应受影响

### 6. 验证

- [ ] 重跑 `preflight.mjs`：`lintInfra.ready` 应为 true，未收敛说明有漏步
- [ ] 全量 lint 中 `better-tailwindcss/*` 规则命中应收敛到 0（或仅剩需人工决策的真实冲突，如 `no-conflicting-classes` 报出的高度冲突）

### 7. 提交

- [ ] 按范围确认的提交方式。垂直切片建议：① 基建迁移（config + deps + 删自研插件）② autofix 批量修复 ③ 各子包修复独立成 commit

## no-unknown-classes 开启策略（可选增强）

默认保持 off。项目稳定后可开启作死代码探测器：迁移残留（如从 React 项目带来的 `animate-in` 而未装 `tailwindcss-animate`）、拼错的类名都会被揪出。

开启前评估噪音来源：未安装插件提供的类（动画库）、裸 CSS 类（非 `@layer components`）、测试 fixtures 的示例类。噪音多时用 `ignore: string[]`（正则列表）豁免，而不是直接关规则。

## 注释追踪标记规则（可选增强）

目标：注释不夹带开发追踪标记与外部编号引用（任务系统的任务 ID、规划文档的阶段号、评审发现编号）。编号在注释里无法溯源——任务系统废弃或规划文档删除后即死引用；注释只解释 why，需要溯源时用自己的话重述背景。

**落地**（模板见 `templates/no-tracking-marker.rule.template.js`，项目化调整点见文件头注释）：

- [ ] 复制规则模板进项目自研插件（如 `eslint-plugin-<org>/rules/no-tracking-marker.js`），评估 PATTERNS 形态集是否匹配项目任务系统的编号惯例
- [ ] flat config 中以 error 开启（无 options 即可用；豁免与追加形态经 `allow` / `additionalPatterns` 注入正则源）
- [ ] 接入后存量违规会全量报 error——先跑 `eslint .` 盘点，逐个改写为 why 注释（编号删除、背景重述），或临时 `// eslint-disable-next-line` 抑制后分期清理

**关键设计（勿随意改）**：

- 只扫注释（行/块/.vue 模板 HTML），不扫字符串与代码——日期、版本号、文案里的数字形态天然免疫
- eslint/@ts- 指令注释前缀跳过——否则 disable 本规则的注释会自我举报且永远无法抑制（抑制悖论）
- 中英文阶段语义同族检出且大小写不敏感：中文"阶段 N"（"阶段 1 — 认证"/"知识库阶段 8"）与英文步骤/分段标签（"Step 1:"/"Stage 2"/"Part A:"/"Part B2:"）——规划文档编号在函数内的残留，脱离文档即死引用；语义不因大小写改变性质，唯一豁免通道是 allow（"Part B2X" 数字后跟字母时 \b 无法落在词内，仍免疫）
- 同注释同模式多次命中全量上报（matchAll 预编译 g flag）；被更长匹配包含的命中去重
- 数字区间（`\d{2}-\d{2}`）与行号引用形态同构，命中走 numericRange 专属报错：指引改写为 L 前缀 permalink 形式（如 `62-68` → `L62-L68`，suggestion 自动去前导零），该形式规则天然免疫——裸数字对与迭代编号无法区分，拦截同时给出合法行号引用的逃逸通道
- allow 为部分匹配，精确豁免写锚定形式 `^S3$`；bare-id 字母集收窄为 [DPTSU]（B/F/M 与 Mac M3 等实体名冲突面大）

## 硬编码颜色规则（可选增强）

目标：颜色一律走设计 Token / CSS 变量，硬编码色值（`#hex`、`rgb()`、`hsl()`）在源码中零存在。价值在于设计系统治理的强制收口——没有 lint 拦截时，Token 体系会随业务迭代被散落的色值逐步架空。

**落地**（模板见 `templates/no-hardcoded-color.rule.template.js`，项目化调整点见文件头注释）：

- [ ] 复制规则模板进项目自研插件（如 `eslint-plugin-<org>/rules/no-hardcoded-color.js`）
- [ ] flat config 中以 error 开启，**Token 建议表经 option 注入**（key 为小写 hex）：`'no-hardcoded-color': ['error', { suggestions: { '#ff8400': 'text-primary / bg-primary' } }]`
- [ ] **Token 定义源文件必须豁免**——design-tokens.css / Tailwind `@theme` 入口本身就是 hex 定义处，不豁免则规则对定义源自举。CSS 文件需单独一层配 `@eslint/css` parser：

```js
{
  files: ['**/*.css'],
  ignores: ['app/assets/css/design-tokens.css'], // Token 源文件
  languageOptions: { parser: cssParser },        // @eslint/css
  rules: { '<org>/no-hardcoded-color': 'error' },
},
```

- [ ] 测试 fixture 层关闭（`tests/**` 的颜色是被测组件行为，不属设计治理）
- [ ] 接入后存量违规全量报 error——先 `eslint .` 盘点，逐个迁移到 Token；迁移量过大时按目录分期（先 src 后 legacy）

**关键设计（勿随意改）**：

- Program 节点全文正则扫描，不依赖任何 parser 的 AST 节点——颜色出现位置横跨 JS 字符串、模板属性、`<style>` 块与 CSS 文件，无单一 AST 节点可覆盖；代价是注释中的示例色值也会被报（设计意图：颜色出现即治理）
- `var(...)` 区间预提取后跳过——`var(--x, #fallback)` 的回退色属合法；白名单值（transparent/none/currentColor/inherit）与纯数字通道串（如 `'40 80 80'`）豁免
- Tailwind 任意值 `*-[var(--color-*)]` 经 noArbitraryToken 独立报出，不走 var 豁免——它绕过 `@theme` 注册的同名工具类（`text-text-secondary` 等），主题换肤/重构时工具链追踪不到；变量前缀按项目 token 命名约定调整
- suggestions 经 option 注入而非硬编码规则本体——颜色→Token 映射是项目专属事实，无通用默认

## 组件命名标记类规则（可选增强）
目标：所有 layout、page、组件拥有与文件路径一致的规范名，且同名落在两处——Vue Component Option Name 与根 DOM class。标记类是 better-tailwindcss 未知类前置排序（`unknownClassPosition: 'start'`）的语义基础：有了它，每个组件的根类列表自动以组件名开头，模板可读性与 DOM 溯源能力（DevTools/测试选择器/e2e）显著提升。

**落地**（模板见 `templates/require-component-name.rule.template.js`，项目化调整点见文件头注释）：

- [ ] 复制规则模板进项目自研插件（如 `eslint-plugin-<org>/rules/require-component-name.js`），按需调整路径匹配（默认 Nuxt 的 `app/layouts|pages|components`）
- [ ] flat config 中开启并**显式传 prefix**（规则无默认值，缺配在首个组件文件处抛错——防止漏配项目静默沿用别人的前缀）：`'require-component-name': ['error', { prefix: '<org>' }]`，1~2 字符好输入的组织缩写，CSS class 不能以数字开头；**必须同时关闭 `vue/component-definition-name-casing`**——它强制 PascalCase，会对本规则的 kebab fixer 产物全量报错（若反过来项目统一 PascalCase，则保留 casing 规则、把本规则 fixer 产物改为 PascalCase，二者留一）
- [ ] `eslint app --fix` 全量收敛：缺 name 自动插 `defineOptions`（import 后 / 空 script setup 块内）、缺根 class 自动 prepend、存量 PascalCase 名自动改写
- [ ] **预期测试破坏**：`findComponent({ name })` / `findAllComponents({ name })` 按旧名查找的断言失效——改用规范名或组件引用；vi.mock stub 的 `name` 需与真实组件新名同步
- [ ] fixer 的 unsound 边界：Option Name 可能被 `keep-alive :include/:exclude` 字符串引用，改写前 `rg 'keep-alive|:include'` 确认无引用

**命名推导约定**（模板默认）：路径段 kebab 化；page 尾段 `index` 省略、`[id]` 去括号；组件 `basename` 为 `index` 时回退父目录名。

**case 宽容（刻意设计）**：规则只检测"名字的存在与一致"——Option Name 与根 class 各自 kebab 化后与推导名相等即通过，不强制 casing 风格。fixer 统一产出 kebab-case，但后续被团队/工具改成 PascalCase 等其他 case 不报错；只有语义真正不同（词不匹配）才报 mismatch。避免规则变成团队 casing 偏好之争的战场。

## 坑清单（故障现象 → 根因）

- 主题类全部误报 unknown：entryPoint 的 bare `@import` 包未声明依赖，pnpm 下解析静默失败；步骤 3
- 根 `eslint .` 报 `ERR_MODULE_NOT_FOUND` 指向子包：ESLint 10 级联 config 查找，子包 config 引用的生成物（如 `.nuxt/eslint.config.mjs`）不存在；步骤 4
- `nuxt prepare` 后 `.nuxt/eslint.config.mjs` 仍缺失：`@nuxt/eslint` 未注册进 `modules`——生成物由模块产出而非 Nuxt 本体；步骤 4
- lint 输出数十万条问题：构建产物目录未进 ignores；步骤 2
- autofix 后测试挂：shorthand 合并（`h-full w-full` → `size-full`）使旧类名断言失效；步骤 5
- `motion-safe:animate-in` 等大量 unknown：迁移残留死类：写了类名但从未安装对应 Tailwind 插件；步骤 6 可选清理
- `no-conflicting-classes` 成片报 `focus:outline` vs `focus:outline-N`：v3→v4 迁移残留：v3 bare `outline`=2px solid，v4 改为 1px 且 `outline-<number>` 自带 solid——删 bare 保留 `-N`，视觉意图不变（实测 44/46 处冲突都是它，可批量 `perl -pi` 清除）；步骤 5
- 同一元素报两个 `hover:bg-*` 冲突：条件分支类与 base 预设双写（如 danger 分支 `hover:bg-accent-red/10` + base `hover:bg-surface-card`）——base 移除预设，改为各分支互斥书写；步骤 5
- 自研 Vue 规则的 template 校验不触发：新版 vue-eslint-parser 的 parserServices 不再暴露 `templateBody` 属性（仅剩 `defineTemplateBodyVisitor`/`getDocumentFragment`）——经 `getDocumentFragment()` 取 `<template>` VElement 的 children 即页面根节点；组件命名规则
- 自研规则扫不到 .vue 模板的 HTML 注释：`getAllComments()` 与 fragment children 均不含 HTML 注释——它们挂在 `sourceCode.ast.templateBody.comments`；注释追踪标记规则
- 规则测试里 disable 指令不生效：RuleTester 中被测规则以 `rule-to-test/<name>` 别名注册，真实插件 ID 的 eslint-disable 指令无法命中（还会报 rule not found）——抑制语义须用 Linter API 注册真实插件 ID 直测；注释追踪标记规则
- 规则文件被自身规则全量报错（自举）：规则头注释含违规形态示例，而项目 lint 范围扩到了插件所在扩展名——样例写进字符串 fixture 或注明 lint 范围边界；注释追踪标记规则
- fixable error 永远修不完，`--fix` 多轮后原样残留：两条规则的 fixer 互相改写同一文本（Circular fixes）——典型对：本规则改 name 为 kebab，`vue/component-definition-name-casing` 改回 PascalCase。`--fix-dry-run` 看 output 不变 + `ESLintCircularFixesWarning` 即可确诊，解法是关掉对立规则而非修 fixer；组件命名规则
- typescript-eslint 加载即抛 `does not support TS 7.0`：typescript-eslint 8.x 拒绝 TS 7.0（TS 7 支持 tracking typescript-eslint#10940，目标 7.1+）；项目 typecheck 走 tsgo 而 lint 仅需 TS 的 JS API——在**共享 config 子包内** alias 重定向 `"typescript": "npm:typescript@^6"`，影响面封闭在包内，不动全局 overrides、不降仓库 TS 版本；依赖迁移
- `tseslint.config()` 标 deprecated：typescript-eslint 8.65 起弃用自家 config helper，改用 ESLint 官方 `import { defineConfig } from 'eslint/config'`（ESLint 9.18+/10 提供，行为等价）；依赖迁移
- `require-v-for-key` 报"有 key 还报"：eslint-plugin-vue v10 对 `<template v-for>` 缺 key 时**下钻检查子元素**，报文位置落在首个非 custom-component 子元素行而非 v-for 行——顺着报文行往上找缺 key 的 template v-for；存量治理
- 行内 disable 盖不住违规：`vue/no-deprecated-slot-attribute` 等规则报文 loc 在**属性行**；多行写法元素前一行放 `eslint-disable-next-line` 只盖元素首行——改文件级 `<!-- eslint-disable <rule> -->`（template 首行）并注 Why；存量治理
- 存量代码里 `unicorn/*` disable 报 rule not found：oxlint 时代的 unicorn disable 注释在无 eslint-plugin-unicorn 的 ESLint 下是 error——代码在现行规则集无违规时直接删注释；存量治理
- 工作区有大量并行未提交修改：全量 `--fix` 会与并行工作纠缠且无法区分改动归属——只对 git 干净的文件做定点修复，autofix 留待工作区干净后独立切片；存量治理
- 往 ignores 层加 linterOptions 后 vendor 目录"复活"被扫：flat config 全局忽略语义纯净性敏感：只含 `ignores`（+可选 `name`）的层才是全局忽略；混入任何其他键即降级为该层自身的 files 排除——全局 ignores 层必须保持纯净，linterOptions 放独立层；步骤 2
- 过滤规则集跑定点 `--fix` 后 disable 注释成片消失：规则被过滤 ≠ 规则不存在：unused-disable-directives 的 fixer 会把真实预设下仍有效的 disable 当无效指令删除——子集 lint（单规则 fix、CI 分级扫描）必须先关 `linterOptions.reportUnusedDisableDirectives`（ESLint 10 仅 config 层入口，构造选项已移除）；存量治理
- fixer 产物自身违反 vue/attributes-order：插入 class 类属性时尾部追加会落在事件/内容指令之后——插到首个 `@/v-on:` 或 `v-html/v-text` 属性前；fixer 改动后应对产物 relint 验证零新违规；组件命名规则
- 普通 `<script>` 块被误插 defineOptions：`export default defineComponent({...})` 的 declaration 是 CallExpression 而非 ObjectExpression——只捕获后者会让 fixer 把 setup 专属编译器宏插进普通块（运行时 ReferenceError，lint 自身 0 error，靠全量测试暴露）；组件命名规则
- 自研插件包被 TS 消费方 import 时报 TS7016（implicit any）：纯 JS 无构建的共享 config/规则包没有类型声明——补 `index.d.ts`（`import type { ESLint } from 'eslint'` + `declare const plugin: ESLint.Plugin` + 默认导出）并在 `exports['.']` 加 `types` 条件指向；注意项目 typecheck 通常不覆盖根 `eslint.config.mjs`，该诊断只在 IDE 浮现，别把"脚本全绿"误判为无此坑；共享 config 子包

## 产物清单

- eslint flat config 迁移：`<repo-root>/eslint.config.*`；进 git：是
- 依赖变更：`package.json` + lockfile；进 git：是
- 子包 Nuxt 集成：`<pkg>/nuxt.config.ts`、`<pkg>/eslint.config.*`；进 git：是
- 自研规则落地（可选增强）：`<repo-root>/eslint-plugin-<org>/`（或共享 config 子包的 `rules/`）+ flat config 注册层；进 git：是
- autofix 批量修复：各源码文件；进 git：是
- 测试断言跟进：受影响测试文件；进 git：是
