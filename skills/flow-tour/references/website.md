# flow-tour：Website 模式工作流

用于构建一个交互式 Web 教学页面，通过 lil-gui 分步调参、实时预览效果，并附带 marker 对应的代码位置说明。

## 适用场景

- 特性有可调参数，想让学习者边改边看效果。
- 项目是 Nuxt/Vue/React 生态，可以复用现有组件做预览。
- 希望有一个集中入口页面（如 `/dev/<tour-name>-tour`）供团队内部演示。

## 产物清单

- `docs/thoughts/<taskname>-tour-thoughts.md`：教学叙事与步骤设计
- `config/tour/<tour-name>TourSteps.ts`：步骤定义 + patch 增量
- `config/tour/<tour-name>TourGuiFolders.ts`：lil-gui 字段元数据
- `config/tour/<tour-name>TechniqueGlossary.ts`：技术标签详解词典
- `config/tour/<tour-name>TermGlossary.ts`：名词释义（扫盲层）词典
- `composables/tour/use<TourName>Tour.ts`：步骤状态与 patch 应用（含调参保留）
- `composables/tour/useTourSound.ts`：Web Audio 合成音效引擎
- `pages/dev/<tour-name>-tour.vue`：教学页面
- `components/tour/TechniqueTag.vue`：技术标签详解气泡组件
- `utils/editor.ts`：编辑器协议跳转（隐藏 iframe 触发）
- `utils/pathLabel.ts`：最短不冲突路径标签
- `scripts/tour-marker-resolver.ts`：marker 扫描共享模块
- `scripts/resolve-<tour-name>-tour-markers.ts`：薄 CLI
- `scripts/tsconfig.json`：脚本自包含 tsconfig
- `assets/tour/<tour-name>-tour-markers.json`：marker 位置产物
- `tests/unit/tour/<tour-name>TourMarkers.spec.ts`：marker 新鲜性测试
- `tests/unit/tour/<tour-name>TourGuiFolders.spec.ts`：GUI 元数据一致性测试
- `tests/unit/tour/<tour-name>TourTechniqueGlossary.spec.ts`：词典双向覆盖 + 文案守护
- `tests/unit/tour/<tour-name>TermGlossary.spec.ts`：名词双向覆盖 + ≥8 标签守护
- `tests/unit/tour/<tour-name>TourProgression.spec.ts`：派生式渐进展示守护（递增 + act 连续 + id 唯一 + desc 上限）
- `docs/reviews/<taskname>-tour-review/*`：外部审查产物
- `docs/reports/<taskname>-tour-report.md`：最终报告

## 步骤定义约定

- 每步包含 `id`、`act`（篇章归属字符串，必填）、`title`、`description`、`glossary`、`techniques`、`codeLocations`、`patch`。
- `act` 从叙事逻辑推导（"这步教什么概念属于哪个主题"），同名 act 的步骤必须连续；progression 测试守护连续性（`TourProgression.spec.ts`）。步骤≥12 时必须分篇章（见 SKILL.md「步骤拆分方法论」）。
- `codeLocations` 仍建议只放一个 marker；若必须多锚点，需拆 step。
- `patch` 描述相对于前一步的增量；所有 step patch 合并后应接近生产默认配置。
- 每个 `patch` 字段都应在 `TourGuiFolders.ts` 中有定义，或显式标记 `hidden: true`。
- **Stage 有序表**：有中间态的维度导出 `STAGE_ORDERS`（`Record<string, readonly string[]>`），progression 测试据此展开阶段布尔序列。无中间态维度不注册。`buildTourConfig` 的浅合并 `Object.assign` 让阶段字段不跨步骤泄漏（patch 只写变化的 key）。
- **派生式 progression 守护**：禁止手工拼布尔数组。用 `Object.entries` 按 typeof 摘 boolean + `STAGE_ORDERS` 展开阶段，自动捕获新增字段。模板见 `templates/TourProgression.spec.ts.template`。
- **名词释义（扫盲层）**：`glossary` 放中文基础名词（对应 `TermGlossary.ts` 词条），解释"这个概念是什么"，与 `techniques` 的"怎么做"互补；页面在「关键技术」上方渲染「名词释义」标签行。**每步 `glossary` + `techniques` 标签总数 ≥ 8**，由 `TermGlossary.spec` 守护（同时守护名词↔词条双向覆盖）。
- **调参跨步骤保留**：`useTour` 用 `modifiedFields` 记录用户改过的字段，切换步骤时保留用户值，未修改字段跟随目标步骤默认值（前进增量引入、回退恢复叙事状态）；reset 清空。页面的 guiParams↔config 双向同步必须有 `Object.is` 同值跳过，否则程序化回填会污染修改记录。
- **文案准则**：`description` 写可迁移的 how-to（读完能用到自己代码里），禁止"原站/参考对象如何如何"式复述——守护测试会拦截含"原站"的标题与描述。逆向得到的技巧（如 matrix 逆推）保留，但写成"怎么做"而不是"原站是什么"。
- **技术标签词典**：每个 `techniques` 标签都要在 `<tour-name>TechniqueGlossary.ts` 有词条（是什么 + 本例作用 + 怎么自己用），词条与标签双向覆盖由 `TourTechniqueGlossary.spec` 守护。
- **渐进展示纪律**：Step 0 只放原子最小画面（单个原语级，如 3D 房间只画地板网格），壳与固定体由后续步骤立起；无独立开关的静态固定体用纯函数 `computeBodyVisible(cfg)` 随首个交互项派生显隐（零配置膨胀、可单测）。用**派生式特征向量**守住"可视元素严格递增"：boolean 字段 `Object.entries` 按 typeof 摘取、阶段字段按 `STAGE_ORDERS` 展开成"已达 rank k"序列，断言每步至少新增一个 true——禁止手工拼布尔数组（扩容时漏字段会静默给假绿）。模板见 `templates/TourProgression.spec.ts.template`。中途插入步骤须整体重编号 id/title/stepId（降序 sed 防链式覆盖）。维度展开、stage 有序表、中间态可超源码、零号态/泥模态、act 篇章分组等完整方法论见 SKILL.md「步骤拆分方法论」。

## Workflow

0. **初始化上下文**
   - 确认目标特性已由 `flow-dev` 完成。
   - 记录 `<repo-root>`、`<original-branch>`。
   - 创建 Task 1～9。

1. **提炼教学叙事**
   - 读取 PRD / DevGoal / 代码。
   - 确定步骤顺序：base → 核心逻辑 → 参数调优 → 边界处理 → 完整形态。
   - 输出 `docs/thoughts/<taskname>-tour-thoughts.md`。

2. **定义 Tour Steps 与 GUI 元数据**
   - 创建 `config/tour/<tour-name>TourSteps.ts`。
   - 创建 `config/tour/<tour-name>TourGuiFolders.ts`。
   - 创建 `config/tour/<tour-name>TechniqueGlossary.ts`，为每个技术标签写 how-to 词条。
   - 创建 `config/tour/<tour-name>TermGlossary.ts`，为每步 `glossary` 名词写扫盲词条；每步 glossary + techniques 标签总数 ≥ 8。
   - Step 0 允许无参数，面板显示"本步骤无参数"（占位行加 `is-note` 类隐藏多余输入框）。

3. **步骤数据正交审查**
   - 派独立审查代理（全新上下文子代理，或外部审查 runner），**只喂步骤数据，不喂代码位置 / marker**：所有步骤的名称+简介，以及当前步骤的 name / description / glossary / techniques / 参数（patch + GUI 元数据）。
   - 重点：步骤序列是否连贯（有无模式/主题突跳、粒度是否均匀、命名风格是否一致）→ 据此评估当前步骤在全局中是否合理；名词是否基础、相关且与 techniques 合计 ≥ 8；参数是否贴合本步叙事、默认值合理。
   - 发现问题（尤其涉及步骤排序、拆分、主题聚散）回 Step 2 调整步骤定义后重跑本审查；每次重排步骤都重跑。
   - 审查口径与清单详见 SKILL.md「步骤数据正交审查」节。

4. **插入 Marker**
   - 在源码关键位置插入 `// flow-tour-marker: <id>`。
   - 锚点贴近赋值、shader 注入、配置对象等关键行。

5. **编写 Resolver**
   - 创建 `scripts/tour-marker-resolver.ts` 与 `scripts/resolve-<tour-name>-tour-markers.ts`。
   - 输出 `assets/tour/<tour-name>-tour-markers.json`。
   - `package.json` 添加同步脚本并接入 `predev` / `prebuild`。

6. **构建 Tour UI 页面**
   - 以 `templates/tour-page.vue.template` 为骨架：全屏标本画布 + 半透明 blur 浮动面板（报头/目录/文章区）。
   - lil-gui 必须挂载到模板内容器，不能挂到 `document.body`。
   - 步骤切换时 `gui.destroy()` 后重建。
   - 交互基线：键盘 ← → 导航；目录滚动跟随；画布平移（鼠标拖/移动双指拖、三指点按开面板、双击复位，切步骤保留平移）；文章区上边缘/目录右缘拖拽调尺寸并按 desktop/mobile 分键持久化；移动端参数抽屉锚文章区上沿、点击外部收起。
   - 音效：`useTourSound`（Web Audio 合成）——步骤切换 tick、布尔/抽屉 toggle、重置 reset、滑杆松手 scrub；`onChange` 是单回调赋值，多个副作用合并进同一个 handler。
   - 代码位置芯片点击跳转编辑器，见下文「代码位置跳转」。

7. **守护测试**
   - 每个 marker 都能解析。
   - 已入库 JSON 与实时扫描结果深相等。
   - 每个 patch 字段在 GUI 元数据中有定义。
   - 每个 GUI 字段的 `stepId` 都能在 steps 中找到。
   - 技术标签与 glossary 词条双向覆盖；步骤标题/描述不含"原站"。
   - 名词与 TermGlossary 词条双向覆盖；每步 glossary + techniques 标签总数 ≥ 8。
   - composable 语义：修改字段后切步骤保留、未修改字段跟随默认、reset 清空。
   - 派生式渐进展示（`TourProgression.spec`）：每步至少新增一个可视 true；act 同名连续不被打断；id 非空唯一；description ≤ 220 字符。boolean 用 `Object.entries` 按 typeof 摘取、阶段字段用 `STAGE_ORDERS` 展开成"已达 rank k"序列——禁手工拼布尔数组（扩容漏字段会静默给假绿）。

8. **外部正交审查（轻量）**
   - 发起外部正交审查（子代理或 runner），重点检查：
     1. step 与 marker 一致性。
     2. CodeTour / UI 布局完整性。
     3. patch 与 GUI 元数据一致性。
     4. 教学叙事清晰度（是否 how-to 而非复述参考对象）。

9. **验证与报告**
   - `pnpm test` 通过。
   - `pnpm exec tsc --noEmit` 无类型错误。
   - `pnpm generate` 静态生成成功。
   - 使用 `kimi-webbridge` 截图验证页面布局、步骤切换、分步调参面板。
   - **警惕 Edge 睡眠标签**：后台 tab 被彻底冻结（`document.hidden: true`，rAF/定时器停摆），Vue Transition、smooth scroll、boot 动画会"卡住"——这是环境假象不是 bug。处置：连拍截图泵帧（`captureScreenshot` 强制 BeginFrame），断言终态不断言时序；先查 `document.hidden` 再怀疑代码。
   - **移动视口验证**：webbridge 无设备模拟，用同源 iframe 嵌套（iframe 内媒体查询按 iframe 尺寸求值）：wrapper HTML 临时放被测项目 `public/` 下（data:/file: 协议均被拦截；跨端口跨域无法 evaluate 内部 DOM），验证完删除。
   - 输入框截断用 `scrollWidth > clientWidth` 断言，不要目测。
   - 写 `docs/reports/<taskname>-tour-report.md`。
   - 给出垂直切片提交建议。

## 常见陷阱（Website 模式特供）

- **patch 字段缺少 GUI 元数据**：面板不会显示该字段。
- **lil-gui 默认挂到 body**：scoped CSS 和 z-index 会失效。
- **z-index 未创建 stacking context**：预览/地图容器也要 `position: relative + z-index`。
- **步骤切换未重建 lil-gui**：旧控制器引用残留，显示上一步字段。
- **Step 0 硬凑参数**：base 步骤允许无参数。
- **产物未入库**：`assets/tour/*-tour-markers.json` 必须加入版本控制。
- **运行时新依赖未预打包**：lil-gui 等页面运行时 import 的包必须进 `vite.optimizeDeps.include`（Nuxt 项目配在 `nuxt.config.ts` 的 `vite.optimizeDeps`）。否则 vite 运行时发现新依赖会反复 full reload——症状是"click 无反应、面板清空、console 无报错"这类诡异交互失效，dev server 日志里有 `Pre-bundle them ... to avoid page reloads` 提示。
- **步骤切换时 guiParams 缺初值**：watch 默认 `flush: 'pre'` 按注册顺序执行，rebuildGui 先于 "config→guiParams" 同步 watch 执行；缺初值的字段会让 `lil-gui add()` 无法推断控制器类型（返回 undefined，链式 `.name()` 抛 TypeError），面板清空且当次渲染停滞。模板 rebuildGui 已内置字段同步，自定义页面时不得省略。
- **双向 watch 无同值判断**：lil-gui 拖动是 mousemove 级高频，guiParams↔config 双向 deep watch 回调里应加 `Object.is` 同值跳过，避免镜像冗余写入；同值跳过也是 modifiedFields 不被程序化回填污染的前提。
- **Vue Boolean casting**：声明为 `boolean` 的可选 prop 缺省时被转成 `false` 而非 `undefined`，模板里 `prop ?? true` 不会生效——给组件加"演示用开关"prop 必须用 `withDefaults(defineProps, { flag: true })`，并回归验证所有缺省传参的既有调用方。
- **lil-gui 类名版本漂移**：0.19+ 根类名是 `lil-root` 不是 `root`，控制器类是 `lil-controller`/`lil-number`/`lil-boolean`/`lil-color`，禁用类是 `lil-disabled`；`.lil-gui.root` 是无效选择器，宽度等定制会静默失效。写第三方样式覆盖后用 `offsetWidth`/`getComputedStyle` 断言实际生效值。展开/收起状态用 `[aria-expanded]` 属性选择器。
- **lil-gui `onChange` 单回调覆盖**：`onChange(cb)` 是赋值不是订阅，第二次调用覆盖第一次；多个副作用（如发声 + 联动禁用）必须合并在同一个 handler。连续控件发声用 `onFinishChange`（松手才触发），`onChange` 在拖动途中高频触发。
- **入场 reveal 与步骤过渡写在同一元素**：两套 transition 按源码序互相覆盖，步骤切换的 enter/leave 类会卡在元素上。入场 reveal 与步骤过渡必须用不同元素承载（模板用 `.article-slot` 外套 + `.article` 内套分离）。
- **grid/flex 子项默认 `min-width:auto`**：内容 min-content（如横滑 chips 总宽）会把一列容器顶破到超宽，根容器设了 `100vw` 也拦不住。容器直接子项一律 `min-width: 0`。
- **拖拽尺寸缺少指针捕获与 touch-action**：把手必须 `setPointerCapture`（拖出把手不断线）+ `touch-action: none`（触屏不被滚动劫持）；合成指针事件没有活动 pointerId，捕获调用要 try/catch 防自动化验证炸掉。
- **移动端抽屉关闭态没算邻居高度**：底部抽屉锚在另一面板上方（`bottom: 邻居高度`）时，关闭态 `translateY(100%)` 只下移自身高度，仍停留在邻居上方可见。关闭态位移要把邻居高度计入（`translateY(calc(100% + 邻居高度 + 边距))`）。
- **协议跳转在浏览器里探测不到本机编辑器**：`process.env.EDITOR` 系探测只对 CLI 有效且浏览器不可用。Node 侧探测（nuxt.config `fs.existsSync('/Applications/<Editor>.app')`）注入 `runtimeConfig.public` 才是正解。
- **Step 0 倒出整张场景**：首屏塞满壳与固定体，0→1 跨度过大。Step 0 只放原子最小画面，固定体用 `computeBodyVisible` 派生，用"可视元素严格递增"测试守叙事。
- **迁移组件 `var()` 继承陷阱**：popover/气泡正文用未定义的自定义属性取色，computed 非法回退继承到暗字而消失。悬浮层用固定浅色或双态令牌，迁移后在画布每种背景态截图目检。

## 页面架构（图鉴风）

模板页面是全屏画布 + 浮动面板结构：

- `.stage` 全屏打底（z-0），masthead/toc/article-slot 为半透明 + `backdrop-filter: blur` 浮动面板（z 20/30），展品光晕可透入面板。
- 面板尺寸挂 CSS 变量（`--article-h`/`--toc-w`），拖拽只改一个值，toc 底边、图注、移动端抽屉全部声明式联动——不要在 JS 里逐个同步布局元素。
- 画布平移挂 `--pan-x/--pan-y` 于 `.stage-canvas`；暗角等氛围层挂在不动的 `.stage` 上。
- 移动端抽屉与文章区同色系时，用明度与不透明度双轴差异分层（更亮 + 更不透明 + 强描边 + 阴影），比换色相克制。
- 展示级字号：基准 18px、最小 14px、展示标题与 wordmark 统一 38px（移动端 30px 兜底）。

### chrome 主题适配

画布背景若随特性状态翻转（昼夜 / 热成像 / 暗色），浮在其上的 chrome 文字必须随之适配，否则暗底暗字不可见：

- 画布场景用 watch immediate + 边沿写把"当前背景是否为暗态"上抛一个事件（如 `@stage-dark`），页面据此给根容器加 `is-night` 类翻转 chrome 令牌；不要每帧赋值。
- 从别处搬来的组件（标签气泡、popover）若用 `var(--x)` 取色而 `--x` 未在当前作用域定义，computed value 非法会**回退继承**到暗父级的暗字，肉眼即消失。迁移后逐个文本层在画布每种背景态下确认对比度；悬浮层优先用固定浅色或双态都定义的令牌。
- 验证期对画布每种背景态各截一张图，目检 masthead / 目录 / 文章正文 / 技术标签气泡四类文本层。

## 代码位置跳转

marker JSON 的 `file:line` 从纯展示升级为可点击跳转：

- 触发手法：临时隐藏 iframe 加载 `vscode://file<绝对路径>:<行号>`（参考 vue-source-lens），协议未注册时页面不受扰。
- 绝对路径：`nuxt.config.ts` 注入 `runtimeConfig.public.projectRoot = process.cwd()`。
- 编辑器选择：同文件 `fs.existsSync` 按 Insiders → Cursor → Windsurf → VS Code 探测 `/Applications`，注入 `runtimeConfig.public.tourEditor`；`localStorage['<tour-name>-tour-editor']` 可手动覆盖。
- 芯片只显示最短不冲突标签（`pathLabel.ts` 的 `shortestUniquePathLabels`：文件名优先，冲突逐级向上补目录），完整路径留在 `title`。

## 音效

`useTourSound`：全部音色 Web Audio 实时合成（零音频资源）。音色参数集中在 `SCORE` 表（波形/频率/滑音/衰减/增益），可直接调参。AudioContext 懒创建 + 挂起时 resume（自动播放策略）；开关持久化 localStorage，报头有喇叭切换。

## 字体

字族在 `nuxt.config.ts` 的 `app.head.link` 注入（单条 css2 请求）：

```ts
{
  rel: 'stylesheet',
  href: 'https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..700;1,6..96,400..700&family=Fragment+Mono:ital@0;1&family=Inter+Tight:wght@400;500;600;700&family=Noto+Serif+SC:wght@600;700&display=swap'
}
```

Bodoni Moda 展示衬线（Didone 高对比）/ Noto Serif SC 中文标题 / Fragment Mono 标本标签 / Inter Tight 正文。wordmark 的油墨纹理用灰度噪点 + 纯色墨层 `background-clip: text`（刻意不用彩色渐变文字）。

## React / Vite 适配

模板与上方陷阱清单默认 Nuxt/Vue 视角。React + Vite（尤其 Vite MPA 演示站）需做以下对等移植；产物目录同名但后缀/机制不同。

### 产物映射

- `pages/dev/<tour-name>-tour.vue`：演示站 MPA 新增一个 html 入口（如 `demo/tour.html` + 同目录 React 组件）
- `composables/tour/use<TourName>Tour.ts`：同名 React hook；merge/modifiedFields 核心抽纯函数 `tourConfigEngine.ts` 便于单测
- `useTourSound.ts`（Vue ref）：Web Audio 核心与框架无关，移植为 React hook；`enabled` 与 popover 单例用 `useSyncExternalStore` 模块级 store，避免多实例状态漂移
- `TechniqueTag.vue` 的 `Teleport`：`createPortal`；portal 目标查询改为挂载时 `useState`+`useEffect` 缓存一次，勿在 render 阶段每次 `querySelector`
- `nuxt.config` 的 `runtimeConfig.public.projectRoot/tourEditor`：vite `define` 注入 `__TOUR_PROJECT_ROOT__`/`__TOUR_EDITOR__`（`vite.config` 内 `fs.existsSync('/Applications/<Editor>.app')` 探测，与 Nuxt 方案同构）
- scoped `:deep(.lil-*)`：普通 CSS 后代选择器 `.tour-gui .lil-*`；所有样式限定在 tour 根类名下

### 关键差异

- **lil-gui 同步单向化**：Vue 模板用 `guiParams↔config` 双向 deep watch + `Object.is` 同值跳过，是为了"不重建 gui 也能回填面板"。React 版直接每步 `gui.destroy()` + `new GUI()`，重建时一次性从 config 读初值，于是 config→面板回填天然发生在重建那一刻，`onChange` 单向写回即可——同值跳过、`modifiedFields` 防污染整套机制随之消失，无需移植。`onChange` 单回调覆盖、`onFinishChange` 松手发声两条约束不变。
- **渲染循环读 ref**：rAF 循环放单个 `useEffect([])` 启动，循环体从 `configRef.current` 读最新 config（另用 `useEffect([config])` 同步 ref），避免把 config 塞进循环依赖导致循环重启；cleanup `cancelAnimationFrame` 兼容 StrictMode 双挂载。
- **reveal 与步骤过渡分元素**：与 Vue 同——入场 reveal 挂外层容器，步骤过渡挂内层 `key={step.id}` 元素，二者不可同元素。

### Vite MPA 专属陷阱

- **`appType:'spa'` 的 historyApiFallback 吞无后缀路由**：vite 默认 SPA，会把 `/dev` 这类"不像文件"的请求回退到 root `index.html`，表现为"建了页面却渲染了首页"。多入口演示站第一行就该 `appType:'mpa'`。
- **服务端 rewrite 不改浏览器 URL，相对资源按浏览器 URL 解析**：用中间件把 `/dev` 内部 rewrite 到 `/dev/index.html` 时，浏览器地址栏仍是 `/dev`，于是 html 内 `<script src="./main.tsx">` 被解析成 `/main.tsx`（错的入口）。三选一：① 301 真重定向改浏览器 URL；② html 内 script 用绝对路径 `/dev/main.tsx`；③ 文档加 `<base href="/dev/">`。JS 的 `import './x'` 不受此害（按模块自身 URL 解析，与文档 URL 解耦）。
- **目录入口无尾斜杠 404**：mpa 模式下 `/dev`（无尾斜杠）不触发目录 index 索引，仅 `/dev/` 命中。若坚持 `/dev` 可用，加 `configureServer` 中间件对"无扩展名且 root 下确有 `<dir>/index.html`"的路径 rewrite，并配合上一条的绝对路径 script。
- **生产隔离**：`build` 的 `rollupOptions.input` 白名单只列生产页，dev/tour 入口不登记即不进部署产物（对等 Nuxt 的 `pages:extend` 移除 `/dev`）；dev server 按需编译不依赖 input，故开发期仍可访问。

### 非 Nuxt 项目的 `/dev` 集中入口

`preflight` 的 `devHub.applicable = stack.isNuxt`，对 Vite 项目返回 `applicable:false`——这只豁免**自动探测**（五个就绪信号全是 Nuxt API，无法在 Vite 上探），**不豁免 `/dev` 入口本身**。flow-dx 的 `/dev` 集中入口价值与框架无关，Vite 项目应自建对等物：显式注册表 `hub.ts`（抽 `titleOf` 等纯函数以便单测，对等 Nuxt 的 `import.meta.glob` 发现）+ 与 tour 页统一观感的卡片入口页。当 flow-dx 日后给出 Vite 版 Dev Hub 约定（如固定 `demo/dev/index.html` + `hub.ts` + build 隔离三件套），preflight 可加 Vite 探测分支，让非 Nuxt 项目也被盘点守护，而非一律 `applicable:false` 静默放过。

### 验证期临时文件的提交纪律

移动视口验证用的同源 iframe wrapper（临时放 `public/`）是验证期产物，**不得进 commit**：提交用精确路径 `git add <文件>` 或先写入 `.gitignore`，切勿 `git add -A` 把 wrapper 一锅端进功能 commit，制造"加→删"的历史尸斑。
