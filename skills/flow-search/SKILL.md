---
name: flow-search
description: 搜索入口。三条分支：(A) 文档溯源——为代码改动/配置项/技术决策查找官方文档依据；(B) 内容溯源——从转载/转述/截图反查一手 canonical 出处；(C) 深度研究——对宽泛主题做系统性多轮调研，三层 Ask 澄清 + 评估器-优化器循环。当用户说「溯源」「找文档出处」「这个配置官方怎么说」「这篇转载自哪里」「反查原文」「找到原始博客」「调研」「深度研究」「系统调查」「验证假设」「技术选型对比」「find-source」「find-original」「search-web」「flow-search」时触发
argument-hint: "[docs | content | research] <目标>"
disable-model-invocation: true
metadata:
  version: 0.1.0-alpha.0
---

# flow-search：搜索入口

## 要求

* **意图路由先行**：先按下表判定分支，再进入对应 Workflow。
* **渐进披露**：按文末「References 地图」在 Workflow 阶段中按需加载，禁止初始化时一口气全读。
* **工具链纪律**：搜索与抓取只用外部依赖表中的工具，**禁用内置 WebSearch / WebFetch**（用户全局偏好）。
* 输出中文；网页 / 媒体链接后必须追加 `(置信度: X)`。

## 意图路由

判别器是**意图动词**，域名仅作 tiebreaker：

- 显式 `docs` / `content` / `research` 前缀：对应分支；去向直达
- 「转载自哪里 / 反查 / 找源头」+ URL；转载平台域（mp.weixin.qq.com / zhihu.com / bilibili.com / douyin.com / 视频号）；截图；转述文字：B 内容溯源；去向 Workflow B
- 「配置依据 / 官方怎么说 / 为什么用这个」+ 配置项 / CLI flag / 代码片段：A 文档溯源；去向 Workflow A
- 「调研 / 深度研究 / 系统调查 / 验证假设 / 对比选型」+ 宽泛主题；无具体溯源目标的主题句：C 深度研究；去向 Workflow C
- 裸 URL 无动词：**问一句确认**；去向不适用
- 无参调用：A：从上下文提取上一轮关键决策/变更；B：索要目标；C：索要主题；去向不适用

裸 URL 必须问一句：错分支代价不对称——B 对一手内容会白跑整条指纹搜索链，A 对转载会做无意义的 Context7 查询。裸主题句（非 URL）无动词时默认 C：C 的误判代价低（澄清阶段第一个问题就会暴露真实意图），而 A/B 都要求输入有具体锚点。

与相邻技能的边界：

- **B 问 provenance（内容从哪来），flow-docs 事实核查看 truth（说法对不对）**——两者都吃 URL、都做全网多源搜索，别混用。
- **C vs A/B**：C 是广域系统调研（无预定结论、多轮迭代求覆盖），A/B 是窄域定向溯源（有明确目标、找到即停）。
- **C vs 内置 `deep-research`**：C 是定制流程——三层 Ask 澄清、外部搜索工具链偏好、手动调用；通用调研需求走内置技能即可。
- **C vs flow-docs 事实核查**：C 无预定结论（探索性调研），核查有待审论断（对抗性审计，证伪优先）。
- `find-skills` 是找技能不是找源头；API 用法问题直查 Context7 即可，不必走 A（A 解决的是"为什么这样配置"的依据问题）。

## 外部依赖入口

- preflight.mjs（A+B+C）— node 脚本：`node ~/.claude/skills/flow-search/scripts/preflight.mjs --mode <docs|content|research> [--input <target>]`，退出码决定流程生死
- Context7（A）— MCP：`resolve-library-id` + `query-docs`，结构化文档检索首选
- A 工具线（A）— MCP：Context7 → zread（`search_doc`/`read_file`）→ glm-web-reader（官方页面）→ open-websearch（社区层）
- B 搜索线（B+C）— CLI + MCP：`deepseek-search` / `open-websearch` / `glm-*` → `flow-web` fallback
- B 抓取线（B+C）— MCP + 技能：reader SSR（`glm-web-reader`）→ `open-websearch` fetch → `flow-web` 兜底
- 搜索/评估子代理（C）— agent：`subagent_type: general-purpose`，搜索代理一条消息并行 2–4 个（结果落盘），评估器每轮 1 个；禁用 TeamCreate 类弃用 API

## Workflow A：文档溯源

0. 初始化
   - [ ] **Preflight**：`preflight.mjs --mode docs`；git 仓库缺失仅告警（项目约定层非前置）
1. 提取并分类
   - [ ] 读 `references/docs-trace.md` 分类表，判定目标类型（配置项 / 依赖库 / 项目约定 / 语言特性）
2. 三层查找（从内到外，找到即停）
   - [ ] 项目内约定（CLAUDE.md / docs/ / commit）→ 官方文档（按 A 工具线优先级）→ 社区实践
3. 输出
   - [ ] 按 `references/docs-trace.md` 输出格式与置信度规则呈现

## Workflow B：内容溯源

0. 初始化
   - [ ] **Preflight**：`preflight.mjs --mode content`；解析输入（URL / 截图 / 转述文字）
1. 二手判别（路由误判的安全阀）
   - [ ] 读 `references/content-trace.md` 信号表；**一手信号命中 → 判定为一手，停止溯源并直接输出**
2. 指纹提取 + 语言还原
   - [ ] 提取三类指纹（硬数字 > 专名 > 独特短语），专名反推回目标语言表达
3. 搜索
   - [ ] 按 B 搜索线执行指纹组合搜索（**禁标题直搜**，多引擎并行）
4. 抓取全文
   - [ ] 按 B 抓取线 fallback 序抓候选原文
5. 核验 + 二次创作层
   - [ ] 四件套逐条比对（canonical URL / 作者 / 时间 / 关键数据）；识别价值嫁接，原文事实与转载解读分开标注
6. 输出
   - [ ] 按 `references/content-trace.md` 输出传播链 + 置信度

## Workflow C：深度研究

0. 初始化
   - [ ] **Preflight**：`preflight.mjs --mode research [--input <主题>]`
1. 需求澄清（决定搜索质量上限，不可跳过）
   - [ ] 读 `references/research-brief.md`：三层 Ask 框架（项目重述 → 目标分类 → 模式专用提问），含智能跳过与逃生舱口
   - [ ] 产出 `brief.yaml` 到 `/tmp/flow-search/{date}/{task}/`
2. 查询集群 + 并行分发
   - [ ] 读 `references/eval-loop.md`：按 $mode 起 2–4 个搜索子代理（一条消息并行），各写 `turn-{n}/agent-*.md`，父代理只收路径+摘要
3. 评估循环
   - [ ] 每轮起评估器子代理读 `turn-{n}/agent-*.md`、写 `eval-{n}.md`（五维打分，破坏性基调）
   - [ ] 按 $mode 分级阈值判定：达标或撞轮次上限退出；否则父代理 inline 据改进建议构建下轮集群（不设独立 optimizer）
4. 交付
   - [ ] 生成 `report.md`（执行摘要 + 关键发现置信度表 + 五维质量评估 + 局限性 + 来源），向用户呈现摘要并询问深入方向

## 红线与故障恢复

- 搜索/抓取链全线不可用 → 停止并报告，绝不凭先验知识编造出处。
- 核验不可省：定位到候选不算完成，四件套逐条比对才能确认。
- canonical 定位不到 → 输出可追溯的最远一环 + 低置信标注，不硬凑"找到了"。
- 原文事实与中文解读 / 价值投射必须分开标注，不混为一谈。

## References 地图

- `references/docs-trace.md` — 目标分类表、三层查找细则与工具链、输出格式、置信度 rubric；何时读取 Workflow A Step 1 与 Step 3
- `references/content-trace.md` — 二手/一手信号表、指纹提取、语言还原、搜索与抓取工具链、四件套核验、二次创作层、传播链输出、实战锚点；何时读取 Workflow B Step 1 必读；Step 5–6 回查
- `references/research-brief.md` — Ask 调用约定、三层澄清框架、模式专用提问库、智能跳过、追问矩阵、逃生舱口、brief.yaml 规格；何时读取 Workflow C Step 1 必读
- `references/eval-loop.md` — $mode 判定、查询集群构建、并行分发与 master-log 协议、评估器五维 rubric 与校准表、分级退出标准、循环驱动、report.md 格式；何时读取 Workflow C Step 2 必读；Step 3–4 回查
