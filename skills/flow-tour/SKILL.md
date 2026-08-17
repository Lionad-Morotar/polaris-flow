---
name: flow-tour
description: 构建交互式分步教学（两种形式：网站或 CodeTour）
argument-hint: <tour-target> [--vscode-tour]
metadata:
  version: 0.1.0-alpha.0
---

## 要求

* 本技能输出的文档默认不进入 git
* **必须前置 `flow-dev`**：本流程假设目标特性已经由 `flow-dev` 开发完成，不重复做需求分析、架构设计、外部正交审查与完整开发循环
  * **fork / 逆向例外**：当特性代码来自 upstream fork 或既有代码库（非本会话 flow-dev 产出）时，upstream / 既有代码即视为 flow-dev 的等价产出，tour 只做教学层，不补做开发循环。在 thoughts 文档开头注明此定位，跳过 flow-dev 的 PRD/审查环节。
* 严格按照流程执行，如果碰到以下阻塞按照清单解决问题：
  * 进入了计划模式，生成了计划：你应当自动确认计划（注意，并非不做计划！而是先计划再自动确认）
  * 有决策需要我确认：我的回答永远是 “按照文档高标准质量决定”
  * **不要暂停**：完成所有阶段，而不是分阶段汇报向我确认，get all shits done
* **根据阶段要求读取执行对应技能**，而不是在初始化任务时一口气读取

## 外部依赖入口

> 以下为环境固定事实，每次执行直接使用。

- `flow-dev` — skill（SKILL.md）：前置已完成；目标特性必须已由 `flow-dev` 产出代码与 PRD
- 外部正交审查 — 派全新上下文的子代理执行（已配置外部审查 runner 时亦可由主代理直接调用）；对 tour 步骤、marker、CodeTour 做一次轻量正交审查
- `flow-code-review` — skill：复用 `flow-dev` 已完成的审查；本流程不再单独做一次完整 code-review
- `kimi-webbridge` — skill（SKILL.md）：读 `~/.claude/skills/kimi-webbridge/SKILL.md` 后执行；浏览器截图与交互验证

## 两种工作模式

本技能支持两种输出形态，选取一种后按对应参考文档执行细节：

- **Website**（默认）：交互式 Web 页面 + lil-gui 分步调参 + marker JSON；[`references/website.md`](./references/website.md)
- **CodeTour-only**：`.vscode/tours/*.tour` 配置文件；[`references/codetour.md`](./references/codetour.md)

传入 `--vscode-tour` 时进入 CodeTour-only 模式：只生成 `.vscode/tours/<taskname>.tour`，不创建 `pages/dev/<tour-name>-tour.vue` 页面。

## 输出模式

无论哪种模式，都会落档三类文档：

- 思考过程：`docs/thoughts/<taskname>-tour-thoughts.md`；步骤划分、锚点猜想、叙事设计
- 外部审查：`docs/reviews/<taskname>-tour-review/{prompt.md, review-<model>.md}`；Step 8 外部正交审查生成
- 最终报告：`docs/reports/<taskname>-tour-report.md`；实现摘要、验证结果、提交计划

Website 模式额外产物：

- 页面：`pages/dev/<tour-name>-tour.vue`
- 步骤数据：`config/tour/<tour-name>TourSteps.ts`
- lil-gui 字段元数据：`config/tour/<tour-name>TourGuiFolders.ts`
- 技术标签词典：`config/tour/<tour-name>TechniqueGlossary.ts`
- 名词释义词典：`config/tour/<tour-name>TermGlossary.ts`
- composable：`composables/tour/use<TourName>Tour.ts`
- 音效引擎：`composables/tour/useTourSound.ts`
- 气泡组件：`components/tour/TechniqueTag.vue`
- 工具：`utils/editor.ts`、`utils/pathLabel.ts`
- marker map：`assets/tour/<tour-name>-tour-markers.json`
- 测试：`tests/unit/tour/<tour-name>TourMarkers.spec.ts`、`tests/unit/tour/<tour-name>TourGuiFolders.spec.ts`、`tests/unit/tour/<tour-name>TourTechniqueGlossary.spec.ts`、`tests/unit/tour/<tour-name>TermGlossary.spec.ts`、`tests/unit/tour/<tour-name>TourProgression.spec.ts`

CodeTour-only 模式额外产物：

- 步骤数据：`config/tour/<tour-name>TourSteps.ts`
- resolver：`scripts/tour-marker-resolver.ts`、`scripts/resolve-<tour-name>-tour-markers.ts`（或集中式 `scripts/resolve-<project>-tours.ts`）
- 测试：`tests/unit/tour/<tour-name>TourMarkers.spec.ts`
- CodeTour 产物：`.vscode/tours/<taskname>.tour`

> 参考模板位于 skill 目录 `templates/`，新建 tour 时可复制并替换 `<tour-name>` / `<TourName>` / `<taskname>` 占位符。

## 核心概念

### Tour

把一项复杂特性拆成一串可点击的步骤叙事，每一步回答两个问题：**现在看到的效果是什么**、**这一步改动了什么参数/代码**。

### Marker 锚点

不用硬编码行号（`components/Foo.vue:368`），而是在源码关键位置插入注释：

```ts
// flow-tour-marker: <marker-id>
```

构建期 resolver 扫描这些注释，生成 marker map（Website 模式写入 `assets/tour/*-tour-markers.json`，CodeTour-only 模式直接生成 `.tour`）。源码重构后行号自动更新，教学不会腐烂。

#### Marker ID 命名约定

建议采用 `{feature}-{subfeature}-{concept}` 三段式，避免不同 tour 之间冲突，也便于从 ID 反推代码位置：

```
react-source-lens-hook-entry
react-source-lens-fiber-traverse
auth-token-refresh
```

- 首段为特性名（如 `react-source-lens`、`auth`、`payment`）。
- 中段为子模块或文件名（如 `fiber`、`token`、`checkout`）。
- 末段为具体概念，使用动词或名词均可，但同一 tour 内保持风格一致。

#### 产物格式

Website 模式的 `assets/tour/<tour-name>-tour-markers.json` 为 flat map：

```json
{
  "react-source-lens-hook-entry": {
    "file": "lib/ReactSourceLens.js",
    "line": 42
  }
}
```

### Step Patch（Website 模式）

每一步只描述相对于前一步的增量（partial patch）。具体字段由 `TourConfig` 决定。

`useTour` 将 patch 合并后写入一个引用稳定的 reactive config，保证字段级 watch 只触发真正变化的更新。

Patch 字段应满足两条规则：

1. **可映射到 GUI**：每个 patch 字段都应能在 `<tour-name>TourGuiFolders.ts` 中找到对应的 lil-gui 字段元数据；如果某字段仅用于展示不可调，也应在元数据中显式标记 `hidden: true`。
2. **可累加成默认配置**：所有 step patch 按顺序合并后，应等于（或非常接近）该特性的生产默认配置；可在测试中写 `verifyTourMatchesDefault()` 断言。

Step 0（base 步骤）用于展示特性最简可用形态，**允许没有任何可调参数**。此时分步调参面板可显示 "本步骤无参数"，不必为了凑参数而硬造字段。

### 渐进展示纪律

Step 0 必须是**原子级最小画面**——新手第一眼看到的应当是"单个原语级的东西"，而不是"已经搭好的壳 / 整张场景"。衡量标准：把 Step 0 截图给没看过这个项目的人，他应当能用一句话说清"这一步画了什么"；如果他说"一个房间 / 一整张图"，跨度就太大了，必须再拆。

落地三件事：

1. **首屏只放一个原语**。例：3D 线框房间的 Step 0 只画地板网格（一张填充面 + 一条边界线环 + 一排网格线），墙与家具全部由后续步骤立起。把"先立壳再挂家具"的直觉改成"先画一片地，再立墙，再放家具"。
2. **无独立开关的静态固定体用派生显隐**。桌体、架体这类没有交互的固定几何，不要塞进 Step 0，也不要为它们各造一个 enabled 开关污染配置；写一个纯函数 `computeBodyVisible(cfg)`，让固定体随"它身上/身旁首个交互项的 enabled"派生出现（桌面随椅子、书架随书柜门）。纯函数可单测，配置零膨胀。
3. **用派生式特征向量守住叙事**。把每步的可视元素集拼成特征向量——boolean 字段用 `Object.entries` 按 typeof 程序化摘取（新增开关自动入网），阶段字段按 `STAGE_ORDERS` 有序表展开成"已达 rank k"序列——断言第 1 步到末步每一步都至少新增一个 true。**禁止手工拼布尔数组**：手工拼的数组在步骤扩容时会静默漏字段，守护写了却给假绿，比没写更危险（清单全对≠整体对，守护本身也要被验证）。模板见 `templates/TourProgression.spec.ts.template`。

中途插入步骤时，**整体重编号所有 id / title / GUI stepId**（降序 sed 防链式覆盖），保持 id 里的序号与 title 的 S 前缀自洽；步骤数变化后同步更新文案里硬编码的步数措辞。

### 步骤拆分方法论（维度展开）

渐进展示纪律管的是"首步原子化"与"每步递增"，但没回答"步骤怎么从特性推导出来"。本节补这个缺口——维度先行、层级累加，步骤总数从特性复杂度自然推导，不人为限制。

#### 维度先行，一特性展开为多阶

先列一张"维度表"：把所有可独立切换的视觉/行为维度列出来（每个 enabled 开关 + 每个"从初态到完整态有中间过程"的特性），每个维度标注它的层级数。层级数即步数贡献——蒸汽天然 5 层（面片/噪声/流动/摆动/修形）、灯光 3 层（逐通道）、屏幕 3 层（黑/海报/开播）、房间 4 层（空舞台/泥模/偏灰/校正），累加即总步数。

**禁止"一开关=一步"的旧模式**：那种做法每步只展示成品形态，跳过所有中间态，学习者看到的是"功能存在"而非"功能怎么从 0 长出来"，首屏与成品之间出现认知断层。正确做法是每个维度用 `STAGE_ORDERS` 有序表定义层级序列（初值→末值），渲染层按 stage 值派生中间形态（shader uniform 门控 / 模块状态分支）。

#### Stage 字段与有序表

每个有中间态的维度在 TourConfig 中加一个**字面量联合字段**（如 `steamStage: 'plane' | 'noise' | 'flow' | 'sway' | 'shaped'`），配套导出 `STAGE_ORDERS` 常量（`{ steamStage: ['plane', 'noise', 'flow', 'sway', 'shaped'], ... }`）。有序表有两重身份：渲染层据此派生 uniform/状态；progression 测试据此把每阶段展开成"已达 rank k"的布尔序列。无中间态的维度（单个开关即完整形态）不进有序表，STAGE_ORDERS 留空对象时模板的 progression 测试不贡献 stage 段，两种 tour 通用。

#### 中间态可超源码

教程型 tour 的用户可授权中间态不存在于源码中（源码可能是成品形态，没有"只有噪声不流动"的开关）。但中间态必须满足三条：① 有真实配置入口（stage 字段）；② 渲染层真实消费（shader uniform 或模块分支，否则步骤切换无视觉变化=纸面步骤）；③ 完整态与成品视觉一致（零回归门，末步截图 ≡ 成品 baseline）。这与"特性枚举"的区别在于：枚举模式下每步 toggle 一个开关、成品即最终态；中间态模式下每步展示一个构造态、末步=成品，由 progression 测试守护。

#### 零号态与泥模态

维度表里要显式包含两个常被漏掉的"前置态"：① **零号态**——载体还没加载时的空间参考（参考网格/空画布锚点，否则首步"什么都没有"无法传达"舞台已搭好"）；② **泥模态**——载体已加载但无效果/无光照/无贴图的中间态（灰色几何体/黑屏/静帧），展示"没有 X 时 Y 长什么样"的认知对照。这两个态各贡献一步，不能合并进相邻步骤。

#### 原子性硬判据

每步（每阶）必须通过三条硬判据，不满足则继续拆：① **可命名**——步骤标题用≤5 词概括一件新事，不含"和"；② **可独立观察**——截图给没看过项目的人，他能一句话说清"这步画/展示了什么"；③ **对应真实开关**——该步的 patch 至少改变一个 stage 值或 enabled 布尔，且渲染层对该值有可区分的视觉响应（progression 测试的"每步新增 true"自动守护此条）。

#### 篇章分组与长列表

步骤≥12 步时**必须**按主题分篇章（act 字段），否则目录是无结构长列表。act 是 TourStep 的必填字符串字段，同名 act 的步骤序号连续（progression 测试守护连续性，断言"同名 act 被打断后重现"为 false）。UI 层用 `groupedSteps` computed 按 act 分组渲染：每组成对输出一个 `<p class="toc-act-title">` 标题行（非 button、pointer-events:none、移动端 display:none）+ 该组 steps 的 button（全局 idx 驱动 active 与跳步）。reveal 延迟改用内联 `--reveal-delay` CSS 变量（`min(base + idx * step, cap)`），取代 nth-child 硬编码，适应任意步数且 hover 解耦。

act 归属必须从叙事逻辑推导（"这步教的概念属于哪个主题"），不能从截图或步数脑补——脑补会把幕二的步骤塞进幕一、幕五的步骤塞进幕四，progression 连续性测试在修复前会红。

### chrome 主题适配

教学页的 chrome（wordmark / 副标题 / 标签 / 气泡 / 目录）浮在画布之上，而画布背景可能随特性状态翻转（昼夜、热成像、暗色模式）。chrome 文字必须在画布的每一种背景态下都可读，否则就是"暗底暗字看不见"。

- 画布场景把当前背景是否为暗态上抛一个**边沿信号**（如 `stage-dark` 事件，用 watch immediate + 边沿写避免每帧赋值），页面据此给根容器加 `is-night` 类翻转 chrome 颜色令牌。
- **迁移组件的 token 缺口是隐形杀手**：从别处搬来的组件（标签气泡、popover）若用 `var(--某个自定义属性)` 取色，而该属性在当前作用域未定义，CSS 会"computed value 非法 → 回退继承"——继承到暗父级的暗字，肉眼就是消失。迁移后必须在画布每种背景态下截图，逐个文本层确认对比度；popover 正文等悬浮层优先用固定浅色或双态都定义的令牌，不要赌继承。

验证期对画布的每种背景态（强制 night / 热成像等）各拍一张截图，目检 masthead、目录、文章正文、技术标签气泡四类文本层全部可读。

### 调参跨步骤保留

`useTour` 用 `modifiedFields` 记录用户通过面板改过的字段路径：切换步骤时这些字段保留用户值，未修改字段跟随目标步骤的教学默认值（前进时新步骤只"增量引入"自己的参数，回退时未碰过的字段回到该步骤叙事状态）；reset 清空全部修改。成立前提：页面 guiParams↔config 双向同步有 `Object.is` 同值跳过，程序化回填不会触发 `updateField` 污染修改记录。

### 技术标签词典

每个 `techniques` 标签在 `<tour-name>TechniqueGlossary.ts` 中有详解词条（是什么 + 本例作用 + 怎么自己用），页面上悬浮/点击标签展开气泡。词条与标签双向覆盖由 `TourTechniqueGlossary.spec` 守护。

### 名词释义词典（扫盲层）

每个 `glossary` 名词（中文词条）在 `<tour-name>TermGlossary.ts` 中有释义，与技术词典分工：名词释义回答「这个概念**是什么**」（面向没接触过该领域的读者，定义 + 直觉，1–2 句），techniques 回答「这个技巧**怎么做**」（可迁移的 how-to）。页面上「名词释义」标签行渲染在「关键技术」上方，复用同一气泡组件。守护测试（`TermGlossary.spec`）要求词条与名词双向覆盖，且**每步 `glossary` + `techniques` 标签总数 ≥ 8**——这条约束强制每一步既有足够的「是什么」铺垫、又有「怎么做」，避免侧栏信息过稀。

### 文案准则

步骤 `description` 写可迁移的 how-to（读完能用到自己代码里），禁止"原站/参考对象如何如何"式复述；逆向得到的技巧保留，但写成"怎么做"而不是"原站是什么"。守护测试拦截含"原站"的标题与描述。

### 步骤数据正交审查

步骤定义完成后（Step 2 之后）、动 UI/插 marker 之前，做一次「只审内容、不审代码」的正交审查（workflow Step 3）。派一个独立审查代理（全新上下文的子代理，或外部审查 runner），**只喂步骤数据、不喂代码位置与 marker 行号**——避免审查滑向代码审查，也保证审查者从「学习者读到什么」而非「代码长什么样」的视角判断。审查输入与要点：

- **所有步骤的名称与简介（title）**——这是评估「当前步骤是否合理」的主要输入：步骤序列是否连贯？有无模式/主题突跳（如前半在搭建 A，突然换成 B，应把同主题的步骤聚拢成章节再展开其余）？粒度是否均匀？命名风格是否一致？
- **当前步骤名称**：准确概括该步，风格与其他步骤一致。
- **description**：可迁移 how-to，无"原站"复述，一读就懂。
- **glossary 名词**：基础、与本步相关、数量足够（与 techniques 合计 ≥ 8）。
- **techniques**：准确、确是「怎么做」（不与名词混淆）。
- **参数**（Website 模式的 patch / GUI 元数据）：贴合本步叙事、真正可调、默认值合理。
- **act 篇章归属**：每步 act 是否确实属于其标注的篇章；篇章边界是否与叙事逻辑分界对齐（不能机械按步数切分——"前 5 步归幕一"这种脑补会把语义不属的步骤塞进错误篇章，破坏分组渲染与审查连贯性）。
- **明确不审查代码位置 / codeLocations**（那是 Step 8 外部审查的职责）。

发现问题（尤其涉及步骤排序、拆分、主题聚散、act 归属）先回 Step 2 调整步骤定义再继续；**每次重排步骤都应重跑本审查**。

### 代码位置跳转

代码位置芯片可点击：经编辑器协议（vscode 系）跳转到 `file:line`，协议 URL 由隐藏 iframe 触发；项目绝对路径与本机编辑器由 `nuxt.config.ts` 在 Node 侧注入 `runtimeConfig`（详见 `references/website.md`「代码位置跳转」）。

## Resolver

`scripts/resolve-<tour-name>-tour-markers.ts` 是薄 CLI，核心扫描与写入逻辑来自同目录的共享模块 `scripts/tour-marker-resolver.ts`。

- 扫描配置的源码目录
- 按扩展名选择 marker 正则：`//`（代码）、`#`（TOML）、JSON 伪 key、`/* */`（CSS）、`.vue` 双语法（script 用 `//`、template 用 `<!-- -->`）；id 字符集统一 `[\w-]+`
- 重复 marker 直接抛错（不是 warn）
- 校验每个 step 的 `codeLocations` 长度**恰好为 1**；否则构建期报错
- 若某 step 引用了不存在的 marker，构建期报错
- 默认从 `<tour-name>TourSteps.ts` 自动推导 `expectedMarkers`，无需手动维护两份列表

### 单 tour 与多 tour

- **单 tour**：每个 tour 一个 `scripts/resolve-<tour-name>-tour-markers.ts`。
- **多 tour / CodeTour-only**：推荐用一个 `scripts/resolve-<project>-tours.ts`，集中注册 `TOURS[]` 数组，统一生成所有 `.tour` 文件。

共享模块导出：

- `resolveMarkers(options)`：扫描并返回 marker map
- `writeMarkerJson(markers, outputPath)`：写入 JSON 产物
- `writeCodeTour(options)`：写入 `.vscode/tours/*.tour`
- `deriveExpectedMarkers(steps)`：从 steps 推导 expected marker id 列表

## 目录结构

```
<repo-root or app-root>
├── pages/dev/<tour-name>-tour.vue          # Website 模式
├── components/<TourName>StepCard.vue       # Website 模式（可选）
├── config/tour/<tour-name>TourSteps.ts     # 两种模式都需要
├── config/tour/<tour-name>TourGuiFolders.ts # Website 模式
├── composables/tour/use<TourName>Tour.ts  # Website 模式
├── scripts/tour-marker-resolver.ts        # 两种模式都需要
├── scripts/resolve-<tour-name>-tour-markers.ts  # 单 tour
├── scripts/resolve-<project>-tours.ts     # 多 tour / CodeTour-only 推荐
├── scripts/tsconfig.json                  # 两种模式都需要
├── assets/tour/<tour-name>-tour-markers.json      # Website 模式
├── tests/unit/tour/<tour-name>TourMarkers.spec.ts # 两种模式都需要
├── tests/unit/tour/<tour-name>TourGuiFolders.spec.ts # Website 模式
└── .vscode/tours/<taskname>.tour          # CodeTour-only 模式
```

## Preflight

运行 `node ~/.claude/skills/flow-tour/scripts/preflight.mjs`，确认依赖技能（kimi-webbridge）与 Dev Hub 基建就绪；失败则停止并报告。

Dev Hub 基建由 `flow-dx` 初始化（dev 页生产隔离的基座），未就绪时先跑 `flow-dx`，不要在未隔离的项目里直接建 `/dev/*` 页面——tour 页会泄漏进生产产物，且含 client-only 状态（localStorage/AudioContext），SSR 会 hydration mismatch。非 Nuxt 项目（CodeTour-only 模式）无此约束，preflight 不判定。

**非 Nuxt 的 Website 模式同样需要 `/dev` 集中入口**：preflight 对 Vite/React 返回 `devHub.applicable=false`，但这只豁免自动探测（五个就绪信号 `devIndex/hubTs/isolationHook/ssrFalse/authBypass` 全是 Nuxt API，无法在 Vite 上探），**不豁免 `/dev` 入口本身**——用户习惯从 `/dev` 进入 tour 等 dev 页，该价值与框架无关。非 Nuxt 的 Website 模式须自建对等 Dev Hub（显式注册表 `hub.ts` + 卡片入口页 + build 隔离），具体移植见 `references/website.md`「React / Vite 适配」与「非 Nuxt 项目的 `/dev` 集中入口」。换言之：preflight 不判定 ≠ 可以跳过 `/dev`，只是没有自动探针替你检查，需人工保证入口存在且已隔离。

## Workflow

两种模式共用以下骨架，具体执行细节请进入对应参考文档：

0. 初始化上下文
1. 分析现有特性，提炼教学叙事
2. 定义 Tour Steps（Website 模式同时定义 GUI 元数据、技术标签词典与名词释义词典）
3. 步骤数据正交审查（只审内容不审代码，见「步骤数据正交审查」节）
4. 在源码中插入 `flow-tour-marker` 注释
5. 编写 Resolver 脚本并接入构建钩子
6. Website 模式构建 Tour UI 页面 / CodeTour-only 模式跳过
7. 编写守护测试
8. 外部正交审查（轻量模式）
9. 验证与报告

Website 模式详细流程：见 [`references/website.md`](./references/website.md)。

CodeTour-only 模式详细流程：见 [`references/codetour.md`](./references/codetour.md)。

## 页面布局规范

Website 模式页面布局规范见 [`references/website.md`](./references/website.md)。

## 常见陷阱

通用陷阱：

* **Marker 位置太宽泛**：放在函数入口会让学习者找不到真正起作用的代码；应贴近赋值、shader 注入、配置对象等关键行。
* **一个 step 多个 marker**：会导致 Website 状态混乱或 CodeTour 重复 step。resolver 已强制校验。
* **产物未入库**：`assets/tour/*-tour-markers.json` 与 `.vscode/tours/*.tour` 都是构建/运行依赖，必须加入版本控制，不能 ignore。
* **resolver 依赖 Nuxt 别名**：`scripts/` 下应有自包含 `tsconfig.json`，避免 CI `--ignore-scripts` 时崩溃。
* **Vue Boolean casting**：声明为 `boolean` 的可选 prop 缺省时被 Vue 转成 `false` 而非 `undefined`，模板里 `prop ?? true` 不会生效——"缺省 true"必须用 `withDefaults`；并回归验证所有缺省传参的既有调用方。
* **入场 reveal 与步骤过渡写在同一元素**：两套 transition 互相覆盖会让切换卡在中间态；用不同元素承载（外层 slot 做 reveal，内层做步骤过渡）。
* **Vue SFC 的 marker 注释位置**：template 的 attribute（如 `:style` 绑定对象）内无法插注释，marker 统一放对应元素开始标签的上一行；script 里用 `//`。resolver 对 `.vue` 同时扫描 `//` 与 `<!-- -->` 两种语法。
* **marker id 字符集不统一**：id 限定 `[\w-]+`（kebab/下划线）。resolver 各注释语法分支必须接受同一字符集——HTML 注释分支若用排除连字符的字符集（如 `[^\s-]+`），含连字符的 id 会在首个 `-` 截断，表现为"marker 明明插了却报未找到"。
* **setup 顶层读 localStorage/window**：SSR 报 `localStorage is not defined`；这类浏览器 API 放 `onMounted` 或 `import.meta.client` 守卫内，ref 先给安全默认值、onMounted 再读覆盖。
* **嵌套目录组件未导入**：`components/tour/X.vue` 的 Nuxt 自动导入名是 `TourX`（目录前缀），模板写 `<X>` 解析失败、整页 500——显式 `import X from '~/components/tour/X.vue'` 或用前缀名。
* **SSR HTML 有元素、client 渲染后消失**：hydration mismatch。第一刀直接 `ssr:false` 二分定位（确认是不是 hydration），别在元素本身或 ref 绑定上打转。常见根源是 composable 在 SSR/client 对同一字段求值不同（如 `enabled` 在 SSR=false、client 读 localStorage=true）。
* **Step 0 倒出整张场景**：把"壳 + 全部固定体"塞进首屏，0→1 跨度太大，新手无从下手。Step 0 只放原子最小画面（单个原语级），其余分步立起；见「渐进展示纪律」。
* **chrome 文字在画布暗态下消失**：浮层文字颜色没跟画布背景翻转，或迁移组件的 `var()` 指向未定义属性而继承到暗字。画布每种背景态都要截图目检，见「chrome 主题适配」。
* **act 归属从截图/步数脑补**：看到目录前 N 项标题就以为它们归同一幕，机械按步数切分——实际某步教的概念属于下一幕。结果幕一/幕二边界错位，progression 连续性测试在修复前会红。act 必须从叙事逻辑（"这步教什么概念"）推导，不能从视觉截图或索引号推断。
* **progression 守护手工拼布尔数组**：每加一个字段就手动往数组里塞一项，33 步扩容时漏一个字段 → 守护静默给绿。改用 `Object.entries` 程序化摘取 boolean + `STAGE_ORDERS` 有序表展开阶段；模板见 `TourProgression.spec.ts.template`。
* **中间态 stage 字段声明了但渲染层不消费**：steps 里写了 `steamStage: 'noise'`，但模块 applyConfig 里没有对应分支，步骤切换画面纹丝不动——学习者看到文案说"噪声给了质感"但画面上什么也没变。stage 字段的每个值必须在渲染层有可区分的视觉响应（shader uniform 门控或模块状态分支），否则就是纸面步骤。

Website 模式专属陷阱：见 [`references/website.md`](./references/website.md)。

CodeTour-only 模式专属陷阱：见 [`references/codetour.md`](./references/codetour.md)。

## 模板索引

skill 目录 `templates/` 下提供以下参考模板，新建 tour 时可复制到项目并替换占位符：

- `TourSteps.ts.template`：`config/tour/<tour-name>TourSteps.ts`；步骤定义、patch 合并函数
- `TourGuiFolders.ts.template`：`config/tour/<tour-name>TourGuiFolders.ts`；lil-gui 字段元数据
- `tourTechniqueGlossary.ts.template`：`config/tour/<tour-name>TechniqueGlossary.ts`；技术标签详解词典
- `tourTermGlossary.ts.template`：`config/tour/<tour-name>TermGlossary.ts`；名词释义（扫盲层）词典
- `useTourNameTour.ts.template`：`composables/tour/use<TourName>Tour.ts`；步骤状态与 patch 应用（含调参保留）
- `useTourSound.ts.template`：`composables/tour/useTourSound.ts`；Web Audio 合成音效引擎
- `tour-page.vue.template`：`pages/dev/<tour-name>-tour.vue`；教学页：全屏画布 + 浮动面板 + 手势/音效/持久化
- `TechniqueTag.vue.template`：`components/tour/TechniqueTag.vue`；技术标签详解气泡
- `editor.ts.template`：`utils/editor.ts`；编辑器协议跳转
- `pathLabel.ts.template`：`utils/pathLabel.ts`；最短不冲突路径标签
- `tour-marker-resolver.ts.template`：`scripts/tour-marker-resolver.ts`；marker 扫描与产物写入共享模块
- `resolve-tour-markers.ts.template`：`scripts/resolve-<tour-name>-tour-markers.ts`；薄 CLI，调用共享模块
- `TourMarkers.spec.ts.template`：`tests/unit/tour/<tour-name>TourMarkers.spec.ts`；marker 新鲜性测试
- `TourGuiFolders.spec.ts.template`：`tests/unit/tour/<tour-name>TourGuiFolders.spec.ts`；GUI 元数据一致性测试
- `TourTechniqueGlossary.spec.ts.template`：`tests/unit/tour/<tour-name>TourTechniqueGlossary.spec.ts`；词典覆盖 + 文案守护
- `TourTermGlossary.spec.ts.template`：`tests/unit/tour/<tour-name>TermGlossary.spec.ts`；名词双向覆盖 + ≥8 标签守护
- `TourProgression.spec.ts.template`：`tests/unit/tour/<tour-name>TourProgression.spec.ts`；派生式渐进展示守护（递增 + act 连续 + id 唯一 + desc 上限）
- `tsconfig.json.template`：`scripts/tsconfig.json`；脚本自包含 tsconfig
