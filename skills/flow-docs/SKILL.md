---
name: flow-docs
description: lionad 与文档打交道的入口。四条分支：(1) GSD 代码库文档同步——检测 .planning/codebase/*.md 是否落后于代码，落后时调用 gsd-codebase-mapper 子代理增量更新；(2) 事实核查——对论断/文章/URL 做对抗性核查（分诊 → 多源三角测量 → 三态判定 → 报告）；(3) 源码映射——将文档大纲逐页深化为精确映射源码实现的单文件技术报告，全文 #LXX-LYY 源码锚点，脚本越界校验 + 编辑器视觉抽查双验证；(4) 项目翻译——批量就地翻译项目文档与代码为中文（scan → 分批并行子代理翻译 → 状态轮询 → 用户确认后提交打标），支持 upstream 分批 merge 对齐（tag 优先，主代理 inline 语义合并冲突）与三层术语表。当用户说「同步文档」「更新 gsd 文档」「文档过期了」「事实核查」「核查这个说法」「deep fact check」「源码映射」「doc map」「深化大纲」「翻译项目」「翻译这个仓库」「同步上游翻译」「translate project」「translating-project」「flow-docs」时触发
argument-hint: <your commands> [sync <topics> | check <claim-or-URL> | map <outline> | translate <path>] [--force] [--check-only] [--dry-run] [--tier quick|standard|deep]
disable-model-invocation: true
metadata:
  version: 0.1.0-alpha.0
---

# flow-docs：与文档打交道的入口

## 要求

* **意图路由先行**：先按下表判定分支，再进入对应 Workflow。
* **渐进披露**：按文末「References 地图」在 Workflow 阶段中按需加载，禁止初始化时一口气全读。
* **GSD 同步极端克制**——无必要不更新。mapper 子代理只补充或修复因代码变更而过期的内容，不重写未变部分。
* **事实核查是对抗性审计，不是探索性调研**：证伪优先，三态判定（CONFIRMED / PLAUSIBLE / REFUTED）。禁止输出任何置信度百分比——伪贝叶斯算术恰是本技能所批判的虚假精确。
* **源码映射锚点零容忍**：每个 `#LXX-LYY` 锚点必须过 `verify-anchors.mjs` 越界校验（失败不交付），重要锚点的视觉正确性由撰写者自己负责（填充即验证 + 抽查），不设独立审校角色。
* 文档语言统一中文；**不执行 git commit**（入库由 flow-git 收尾）。
* GSD 分支不首次生成：项目尚无 `.planning/` 时提示走 `gsd-map-codebase` / `flow-dx`，本技能停止。
* 文档索引完整性：创建或更新 `.planning/codebase/` 任一文档后，`docs/` 下每个 markdown（排除 `adr/`、`agents/domain.md`、gitignored）都必须在 `.planning/codebase/` 或 `CLAUDE.md` 被引用；过 `verify-docs-index.mjs` 双校验，失败零容忍。
* 禁止引用 gitignored 文档：索引源中指向仓库内 markdown 的链接，目标不得被 gitignore（`git check-ignore` 判定）。

## 意图路由

- 含「同步 / 更新 gsd / 文档过期」，或处于 GSD 项目文档语境：分支 A GSD 同步；去向 Workflow A
- 含「核查 / 核实 / deep fact check / 这个说法对吗」，或输入为论断句 / URL / 长文：分支 B 事实核查；去向 Workflow B
- 含「源码映射 / doc map / 深化大纲 / 源码报告」，或输入为文档大纲文件（site-directory 形态）：分支 C 源码映射；去向 Workflow C
- 含「翻译项目 / 翻译这个仓库 / 同步上游翻译 / translate project / translating-project」，或输入为项目路径 + 翻译意图：分支 D 项目翻译；去向 Workflow D
- 无分支词且形态不明：问一句确认；去向不适用

与 `deep-research` 的边界：本技能核查分支是对抗性审计（有具体待审判断、证伪优先）；deep-research 是探索性调研（无预定结论、广度综合）。

## 外部依赖入口

- preflight.mjs — 分支 A+B+C+D，node 脚本：`node ~/.claude/skills/flow-docs/scripts/preflight.mjs --mode <gsd|factcheck|sourcemap|translate>`，退出码决定流程生死
- gsd-codebase-mapper — 分支 A，agent：`subagent_type: "gsd-codebase-mapper"`，4 个 focus 并行 spawn
- gsd-sdk — 分支 A，zsh function / binary：`gsd-sdk query agent-skills` 注入 mapper prompt 尾部（以 `zsh -c` source profile 方式探测，实证原因见 preflight.mjs 注释）
- 搜索工具链 — 分支 B，CLI + MCP：`deepseek-search` / `open-websearch` / `glm-*` → `flow-web` fallback；禁用内置 WebSearch/WebFetch。详见 `references/fact-check-sources.md`
- verify-anchors.mjs — 分支 C，node 脚本：`node ~/.claude/skills/flow-docs/scripts/verify-anchors.mjs <report|dir>`；越界校验失败零容忍，退出码 1 必须修正重跑
- verify-docs-index.mjs — 分支 A，node 脚本：`node ~/.claude/skills/flow-docs/scripts/verify-docs-index.mjs`；docs 索引完整性（无孤儿文档）+ 索引目标非 gitignore 双校验，退出码 1 必须修正重跑
- 编辑器 CLI — 分支 C，CLI（可选）：`code-insiders -g <abs>:<line>` 视觉抽查锚点；优先序与 flow-tour「代码位置跳转」一致（Insiders → Cursor → Windsurf → VS Code），缺失降级 `sed -n`
- doc-coauthoring — 分支 C，skill（可选）：需要结构化共写时调用
- tp CLI — 分支 D，node CLI：`node ~/.claude/skills/flow-docs/scripts/tp/tp.js <subcmd>`（scan / batch / todo / status / diff / glossary / config），子命令契约见 `references/translate-project.md`

## 参数与变量

- `--force`（分支 A，默认关闭）：无视 `$isOld`，强制触发同步
- `--check-only`（分支 A，默认关闭）：只判定 `$isOld` 并输出结果，不更新（旧名 `--check` 已移除：与 `check <claim-or-URL>` 子命令一词两义；传入时报错并提示新写法）
- `--dry-run`（分支 A，默认关闭）：只打印将更新的 focus 与 diff 概要，不调用 mapper
- `--tier quick|standard|deep`（分支 B，默认 `standard`）：核查档位，见 Workflow B 路由表
- `--input <outline>`（分支 C，默认无（从上下文解析））：文档大纲文件路径，preflight 校验存在性

GSD 变量：`$doc_hash`（`.planning/codebase/*.md` 内容指纹）、`$isOld`（与 `meta.yaml.codebase.hash` 不一致或缺失）、`<from>`（`meta.yaml.codebase.from`）。hash 协议见 `references/gsd-sync.md`。

## Workflow A：GSD 文档同步

0. 初始化
   - [ ] 解析参数；**Preflight**：`preflight.mjs --mode gsd`（GSD 项目 / mapper agent / gsd-sdk），任一失败则停止并报告
1. 判定是否过期
   - [ ] 读 `references/gsd-sync.md` hash 协议，计算 `$doc_hash` 并对比 `meta.yaml.codebase.hash` → `$isOld`
   - [ ] `--check-only`：输出判定结果（`$isOld`、双 hash、`<from>`、`git diff <from>...HEAD --stat` 概要）并停止
2. 增量同步（`$isOld` 或 `--force`）
   - [ ] 读 `<from>`，采集 `git diff <from>...HEAD --stat` 语义（不把整 diff 贴进 prompt）
   - [ ] 按 `references/gsd-sync.md` 契约构造 prompt，并行 spawn 4 个 mapper 子代理（tech / arch / quality / concerns）；`--dry-run` 只打印将更新的 focus 与 diff 概要，不 spawn
3. 刷新 meta.yaml
   - [ ] 重算 `$doc_hash`，写回 `meta.yaml`（hash / from / updated_at），向用户汇报更新概要
4. docs 索引完整性校验
   - [ ] `verify-docs-index.mjs`：unindexed（docs 孤儿文档）+ gitignoredRefs（引用 gitignore 目标）双校验，失败零容忍——孤儿补索引、gitignore 引用换目标或删除，修正后重跑至全绿

## Workflow B：事实核查

**档位路由**（默认 `standard`，一行钉死全部参数）：

- `quick`（快查）：论断提取 top-3 高影响论断（L1 优先）；查询矩阵 每论断 1 证伪查询；判定 自验 + 三态；报告深度 摘要（执行摘要 + 速览表）；0 子代理
- `standard`（默认，对抗审计）：论断提取 全部 L1 + 显要 L2；查询矩阵 证实/证伪/竞争框架 3 类；判定 三态 + 操控预扫描；报告深度 完整报告；0 子代理
- `deep`（深审）：论断提取 全层原子化；查询矩阵 4 类全矩阵 + 时间线重建；判定 三态 + 四维对比矩阵 + 竞争假设 ≥3/论断；报告深度 完整报告 + 作者偏见分析；0 子代理

零子代理：核查瓶颈是搜索 IO 与判定连贯性，inline 执行让证据链与操控识别留在同一上下文，verifier 子代理反而会丢语境。
论断上限 quick ≤3 / standard ≤8 / deep ≤12，超限按高影响筛选（高影响 = 涉财务/健康/安全/重大决策，或强情绪修辞）。

0. 初始化
   - [ ] **Preflight**：`preflight.mjs --mode factcheck`；解析输入（论断句 / URL / 文件路径）与 `--tier`
1. 分诊与提取
   - [ ] 读 `references/fact-check.md` 执行：范围界定 → 论断原子化（L1/L2/L3 分层标记）→ 浅材料熔断（无可核查论断 → 输出 0 条并停止）
2. 多源三角测量
   - [ ] 读 `references/fact-check-sources.md`，按档位执行查询矩阵（证伪优先），受搜索预算约束
3. 三态判定 + 操控识别
   - [ ] 重读 `fact-check.md` 的「认知偏差自检」节，再逐论断判定
   - [ ] 预扫描命中疑似操控点时，读 `references/fact-check-manipulation.md` 做机制解构
4. 报告
   - [ ] 按 `references/fact-check-report.md`（三态 rubric + 固定骨架）撰写报告；需参考详略与语气时选读 `references/fact-check-example.md`

## Workflow C：源码映射深化

0. 初始化
   - [ ] 解析参数与变量（大纲文件 / 已有报告 / 输出目录 / 源码根目录 / 核心模块），变量定义见 `references/source-map.md`；**Preflight**：`preflight.mjs --mode sourcemap --input <outline>`（node / git 仓库 / 大纲存在 / 编辑器 CLI 探测），失败则停止并报告
1. 大纲解析与基准建立
   - [ ] 读 `references/source-map.md` 执行：解析大纲 → 页面任务列表，跳过已有报告的页面
   - [ ] 存在已有报告时先读取建立质量基准（深度 / 语气 / 格式）；无则首篇开写前与用户确认深度预期
2. 逐页深化（主代理 inline，不设撰写/审校角色分工）
   - [ ] 单页源码调研面大可扇出 3~4 个研究子代理（`Explore`），各负责一个核心模块
   - [ ] 按单页契约撰写：单文件 + 严格原文 ToC + 源码锚点格式；**填充即验证**——填每个锚点前用编辑器 CLI 打开对应行确认是目标代码
   - [ ] 每篇完成过双验证：`verify-anchors.mjs <report>` 越界校验（失败零容忍，修正 → 重跑至全绿）+ 视觉抽查 ≥4 个关键锚点 + 撰写者自检清单逐项过
3. 收尾汇报
   - [ ] 向用户汇报页面完成数、锚点验证概要（总数 / 通过 / 修正数）、质量基准对齐情况

## Workflow D：项目翻译

0. 初始化
   - [ ] 解析子模式（`translate` 全量翻译 / `update` 上游对齐）与 `$PROJ`（待翻译项目根目录，绝对路径）；**Preflight**：`preflight.mjs --mode translate --input <$PROJ>`（node / tp CLI 与 franc 依赖 / git 仓库上下文 / update 模式的 upstream 与分支），失败则停止并报告
1. 执行子流程
   - [ ] 读 `references/translate-project.md`，按子模式执行：
     - **T-1（全量翻译）**：scan 建清单 → 分批并行 spawn translator 子代理 → 轮询状态文件 → 每批只报一句话进度
     - **T-2（上游对齐）**：diff init 建批次清单（tag 优先，无 tag 回退逐 commit）→ 逐批次 `git merge --no-ff` → 主代理 inline 按语义合并决策规则解决冲突 → typecheck 收尾（可选）→ 每批次只报一句话进度
2. 收尾
   - [ ] 清理清单与状态文件、commit、打标——必须经用户明确确认后执行；完成后向用户汇报翻译文件数、失败条目与 tag 基点

## 安全红线

- 不执行 `git commit`（GSD 文档入库由 flow-git 收尾）；mapper 子代理严禁自行 commit。例外：翻译分支（D）收尾的 commit/tag 是翻译进度状态机的内在步骤——tag 记录翻译对应的上游基点，T-2 依赖它计算差异——仅限 `translation/cn` 分支且必须经用户明确确认。
- GSD：不首次生成；mapper 不得重写未受代码变更影响的文档段落。`.planning/codebase/` 更新后必须过 `verify-docs-index.mjs`——docs 孤儿文档（未被 `.planning/codebase/` 或 CLAUDE.md 引用）与 gitignore 目标引用零容忍。
- 核查：REFUTED 必须 quote 实际反证；不得凭先验知识编造证据；搜索工具链全线不可用 → 停止并报告，不硬凑。
- 核查伦理：区分事实修正与观点压制——L2/L3 层呈现多元框架，不判「错误」。
- 映射：`verify-anchors.mjs` 校验失败零容忍，不交付含失败锚点的报告；锚点只指向本仓库文件；禁止凭记忆或搜索结果片段猜行号。
- 翻译：严格禁止用脚本做批量机器翻译替换，翻译动作只允许子代理逐文件完成；就地翻译（同路径覆盖），不产平行文件。

## 故障恢复

- mapper 子代理失败：记录失败 focus，保留已完成部分；meta.yaml 不刷新 hash（保持 `$isOld=true`，下次重试）。
- meta.yaml 解析失败：报告并停止，不覆盖损坏文件。
- `gsd-sdk` 无输出：mapper prompt 缺尾部注入，报告并询问是否继续。
- 单论断搜索预算超限：终止该论断并返回当前结果，在报告方法论说明中如实标注。
- 映射锚点越界校验失败：按 failures 的行号与原因逐条修正后重跑至全绿；若大面积漂移（源码已更新），对该模块锚点整体重新调研。
- 映射编辑器 CLI 缺失：视觉抽查降级 `sed -n` 文本抽查，不得减少抽查数量。
- 翻译子代理失败：状态文件已记 failed，主代理如实报告失败条目，由用户决定重试或人工处理，不静默跳过。
- franc 依赖缺失（tp/node_modules 未安装）：preflight 拦截并给出恢复命令，不强行启动翻译循环。
- docs 索引校验失败：unindexed 按 doc 主题归入对应 codebase 文档（或 CLAUDE.md「项目相关文档」段）补 inline 链接；gitignoredRefs 换为非 gitignore 目标或删除引用；修正后重跑至全绿。

## References 地图

- `references/gsd-sync.md` — GSD 同步执行手册（hash 协议、mapper 契约、冷却设计背景、docs 索引完整性校验）；何时读取：Workflow A Step 1-2、Step 4
- `references/fact-check.md` — 核查核心方法论（分诊、L1/L2/L3、SIFT、竞争假设、查询矩阵、偏差自检、证伪条件）；何时读取：Workflow B Step 1 必读；Step 3 判定前重读自检节
- `references/fact-check-sources.md` — 搜索工具链与 fallback、搜索预算、T1-TX 信源分层、循环引用检测；何时读取：Workflow B Step 2
- `references/fact-check-manipulation.md` — 七种操控手法识别表 + 四维对比矩阵；何时读取：Workflow B Step 3，仅预扫描命中疑似操控点时
- `references/fact-check-report.md` — 三态判定 rubric、认知边界标签、报告固定骨架；何时读取：Workflow B Step 4
- `references/fact-check-example.md` — 完整示例报告（standard 档）；何时读取：Workflow B Step 4，需参考详略与语气时选读
- `references/source-map.md` — 源码映射执行手册（变量抽取、单页契约、锚点格式、双验证协议、自检清单）；何时读取：Workflow C Step 1-2 必读
- `references/translate-project.md` — 项目翻译执行手册（tp CLI 契约、T-1/T-2 子流程、translator 子代理契约、T-2 主代理语义合并规则、术语表与配置三层机制）；何时读取：Workflow D Step 1 必读
