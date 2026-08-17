---
name: flow-mem
description: 技术知识库维护与检索入口，两个切片：framework（框架与库技术知识）与 decisions（用户表态过的任务型偏好与决策）。两条分支：(A) --learn [--ask] 从会话或指定内容（文件/目录，如 flow-dev 运行产物）中提取可复用且够门槛的知识（反复调试才定位的坑点、核实验证过的方案、用户纠正的结构约定、用户纠正/否决/拍板/显性验收锚定的偏好与决策），按知识性质定域到对应切片，并对既有知识做增删改查维护（--ask 时先输出规划报告，经用户确认后才落笔）；(B) --search 按 h4 标题或全文检索知识库，结果附知识文件绝对路径。当用户说「沉淀一下」「学到知识库」「记一笔这个坑」「记一下我的偏好」「查知识库」「之前有没有踩过这个坑」「有没有现成知识」「维护知识库」「flow-mem」时触发；flow-dev 开发前预搜索（框架坑点 + 同类任务的既往决策）与收尾沉淀也会加载本技能。当你碰到棘手问题或修了两轮都解决不了的问题时，也可以先用这个技能查一查。
argument-hint: "[--learn [--ask] [<内容来源>...] | --search <关键词>]"
metadata:
  version: 0.1.0-alpha.0
---

# flow-mem：技术知识库入口

## 要求

* 知识库两个切片，按知识性质分库：
  * `references/framework/`：框架与库技术知识，按框架/库分组：目录名 = package.json 的 pkg name；`<pkg>/` 存版本无关的通用知识，`<pkg>@<version>/` 存特定版本知识。
  * `references/decisions/`：用户表态过的任务型偏好与决策，按任务类型分组：`<task-type>/<topic>/{index,<task-context>}.md`；必须有用户在场证据（纠正、否决、拍板、显性验收）锚定，AI 自行推导且未被用户确认的做法不入库。
* 每个框架目录与决策主题目录的 `index.md` 是路由层（h4 = 主题，正文 = 路由目标）；其余 `<topic>.md` / `<task-context>.md` 是知识文件（h4 = 知识点，正文 = 阐述）。
* 知识格式统一：`####` 标题 + 正文 + 空行分隔；正文禁止任何强调符（粗体、斜体均不允许）。
* 有门槛地学：只收花费了中间步骤才获得、且中间产物本身不是目标的知识；先验已知、一步可得（单次验证或单次思考计算）的琐碎知识不入库；显式允许一条不学——零入库是合法结果，不设产出指标，禁止为求产出放宽门槛硬凑。判据见 `references/learn.md`「入库门槛」章；decisions 切片另受「用户在场证据」门槛约束，见同文件「decisions 切片」章。
* 按分支渐进加载 `references/learn.md` 或 `references/search.md`，禁止初始化时一口气全读。
* 与相邻技能的边界：方法论与经验蒸馏归 flow-distill，URL 知识归档归 distill-and-archive，用户级、处处适用的偏好归记忆系统；flow-mem 只收两类——可归属到某个框架/库、跨任务可复用的技术知识（framework），以及特定任务类型下成立、有用户在场证据的偏好与决策（decisions）。自家可维护技能（flow 技能族 `skills/flow-*`）的坑点不入库：宿主文档可直接修改，正确动作是把知识优化进对应技能并提交，存成记忆只会与技能本体形成双真源漂移。

## 意图路由

- `--learn [<内容来源>...]`；无参调用：A 学习与维护；Workflow A；省略内容来源时取当前整个会话
- `--learn --ask [<内容来源>...]`：A 学习与维护（规划确认模式）；Workflow A：Step 3 输出规划报告并询问，确认后才落笔
- `--search <关键词>`：B 知识检索；Workflow B
- 其他 `--*` 模式：不适用；报错并列出合法值（`--learn [--ask]` / `--search`）后停止

## 外部依赖入口

- preflight.mjs — node 脚本：`node ~/.claude/skills/flow-mem/scripts/preflight.mjs --mode <learn|search> [--input <内容来源或关键词>] [--cwd <目录>]`，退出码决定流程生死；JSON 输出含 `kb.frameworks` 与 `kb.decisionTypes` 两个切片的现状清单
- search.mjs — node 脚本：`node ~/.claude/skills/flow-mem/scripts/search.mjs --mode <frameworks|decisions|h4|fulltext> [--kb <framework|decisions>] [--query <关键词>] [--format <json|line>]`；`--mode decisions` 列决策库任务类型，`--kb` 切换 h4/fulltext 的扫描库（默认 framework），结果含知识文件绝对路径与行号；`--format line`（默认 json）输出一行一条紧凑清单，供管道 head 截断审阅标题

## Workflow A：--learn 学习与维护

0. Preflight
   - [ ] 运行 `node ~/.claude/skills/flow-mem/scripts/preflight.mjs --mode learn [--input <内容来源>...]`（flow-dev 等调用方会传入运行产物路径作为内容来源），退出码非零 → 停止并报告
   - [ ] 记录 preflight JSON 的 `project.deps` / `project.resolved`（实装版本）/ `kb.frameworks`（framework 切片现有框架）/ `kb.decisionTypes`（decisions 切片现有任务类型），供 Step 1 定域
1. 定域——读 `references/learn.md`「学习源与范围」章
   - [ ] 解析内容来源（整个会话 / 指定文件或目录 / 文本）
   - [ ] 逐条知识点先判切片归属：框架/库技术知识 → framework（与 deps 交叉定域）；用户表态过的偏好与决策 → decisions（与 decisionTypes 交叉定域，规则见 learn.md「decisions 切片」章）；两者都不可归属的业务细节与方法论不学
2. 先查后判（增删改查一律先搜索）
   - [ ] 每个候选知识点先用 search.mjs 查既有知识（h4 → fulltext 兜底）
   - [ ] 逐条判定动作：未过入库门槛即弃；过门槛后新增 / 补充 / 纠正 / 删除过时 / 跳过已覆盖
3. （仅 --ask）规划确认——报告格式与确认门纪律见 `references/learn.md`「--ask 规划确认」章
   - [ ] 输出规划报告到终端：逐条列出拟定动作、知识文件绝对路径、知识点标题、一句理由
   - [ ] 询问用户是否继续；未获确认即停止，此前禁止任何 KB 写入与路由改动
4. 落笔与路由
   - [ ] 按 `references/learn.md` 格式纪律写入知识（h4 + 正文 + 空行，无强调符）；版本特定行为归 `<pkg>@<version>/`；decisions 条目归 `<task-type>/<topic>/<task-context>.md`
   - [ ] 同步维护对应目录 `index.md` 路由（新建框架目录或决策主题目录时连路由层一起建）
5. 报告
   - [ ] 输出新增 / 修改 / 删除 / 跳过清单，每项附知识文件绝对路径；写入动作为零（仅丢弃与跳过）时如实收尾，不视为流程失败，也无需为「没学到东西」致歉或找补

## Workflow B：--search 知识检索

0. Preflight
   - [ ] 运行 `node ~/.claude/skills/flow-mem/scripts/preflight.mjs --mode search --input <关键词>`
1. 搜索——读 `references/search.md` 取三段式策略
   - [ ] 框架知识：`search.mjs --mode frameworks` 看范围 → `--mode h4` 打标题 → 不足时 `--mode fulltext` 兜底
   - [ ] 偏好与决策：`search.mjs --mode decisions` 看任务类型 → `--kb decisions --mode h4` 打标题 → 不足时 `--kb decisions --mode fulltext` 兜底
2. 作答
   - [ ] 按结果中的绝对路径读取完整条目（h4 至下一个 h4），附知识文件路径作答；未命中直说「知识库暂无收录」，不用模型记忆冒充

## 红线与故障恢复

* preflight 非零退出 → 停止；范围不明时不落笔写库。
* --ask 模式未获用户确认 → 停在规划报告，不落笔写库；--search 全程只读，无 --ask 形态。
* 删除或修改既有知识必须有证据（会话事实或运行产物证明其过时/错误），不做猜测式改动。
* 知识正文不写时效性断言（「目前最新」「截至某年」）；版本适用面由目录名表达，不用文字表达。
* search.mjs 无命中 → 直说无收录；KB 写入只走 --learn，检索链路只读。

## References 地图

- `references/learn.md`：学习源解析、切片归属判定、deps 交叉定域、增删改查决策流、--ask 规划报告与确认门纪律、知识与路由层格式纪律、版本归属规则、decisions 切片专章；Workflow A Step 1 必读
- `references/search.md`：search.mjs 四模式与 --kb 用法、两段式策略（framework / decisions 各自的三段式）、条目阅读约定、跨技能调用约定；Workflow B Step 1 必读；被 flow-dev 调用时参考
- `references/framework/`：框架知识库本体（数据层而非流程手册，不受「references 一层深」纪律约束，亦不在此预读）；仅沿搜索结果读取
- `references/decisions/`：决策知识库本体（同上，数据层）；仅沿搜索结果读取
