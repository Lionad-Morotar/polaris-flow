# 检索纪律：三段式策略与调用约定

Workflow B 的细则依据，同时是 flow-dev 等技能调用 flow-mem 检索能力的参考手册。

## search.mjs 四模式与 --kb

统一经 `node ~/.claude/skills/flow-mem/scripts/search.mjs` 调用。脚本按 --mode 锚定或按 --kb 切换知识库根（`references/framework/` 或 `references/decisions/`）：

- frameworks：`--mode frameworks`；框架库现有框架目录名（含 `@version` 后缀），human 字段为名称以「、」连接的字符串；bases 字段为去掉版本后缀去重后的基础包名
- decisions：`--mode decisions`；决策库现有任务类型目录名（decisions 根下一级目录），供按任务类型定范围
- h4：`--mode h4 --query <关键词> [--kb <framework|decisions>]`；h4 标题命中，results[] 含知识文件绝对路径 file、行号 line、标题 heading；--kb 默认 framework
- fulltext：`--mode fulltext --query <关键词> [--kb <framework|decisions>]`；正文逐行命中，results[] 含 file、line、匹配行片段 text（≤160 字符）；--kb 默认 framework

h4 与 fulltext 缺 `--query` 报错退出；代码围栏内的行不参与匹配，避免代码里的 `####` 与关键词误命中。

输出形态 `--format <json|line>`（默认 json）：json 为 pretty JSON 汇总，结果每条约 7 行；line 为一行一条紧凑清单（首行汇总 ok/mode/root/query/hits=count/total 与 truncated，随后逐项 `<file>:<line>\t<heading|text>`）。管道 head 截断审阅一律用 line 形态：pretty JSON 下 head -100 仅见十余条，line 形态同量行数可见近百条标题，截断代价从「看不见」降为「看不全」。

多词 query 自动按空白分词做 OR 匹配（调用方堆词时整串匹配必然零命中的护栏）：结果按命中词数降序、同词数整串命中（exact: true）在前，词边界匹配（npm 不命中 pnpm）；results 项附 matched（命中词数）与 exact，顶层附 terms（分词结果）。单词 query 行为与排序不变。

## 三段式搜索策略

框架知识（默认库）：

1. 定范围：先 `--mode frameworks`。目标框架不在列表中 → 直接答「知识库暂未收录该框架」并停止，不必跑全文（bases 匹配注意去版本后缀：`vue-router@5.2.0` 的基础包名是 `vue-router`）
2. 打标题：`--mode h4 --query <关键词>`。h4 标题按纪律含包名、API 名、报错名（见 learn.md），标题检索信噪比最高，是首选
3. 全文兜底：h4 命中不足时 `--mode fulltext --query <关键词>`

偏好与决策（决策库，全部加 `--kb decisions`）：

1. 定范围：先 `--mode decisions` 看任务类型清单。当前任务类型不在列表中 → 直接答「决策库暂无该任务类型的收录」并停止
2. 打标题：`--kb decisions --mode h4 --query <关键词>`；决策条目标题含任务类型与决策词（如「复刻」「验收」）
3. 全文兜底：h4 命中不足时 `--kb decisions --mode fulltext --query <关键词>`

关键词选择：用包名、API 名、报错名、现象词，多轮递进收窄。精选短关键词信噪比最高；多词长句虽有分词兜底，matched 低的命中多为弱相关，须读条目内容判断相关性，不凭标题猜。

## 条目阅读与作答约定

- 完整条目 = 命中 h4 起至下一个 h4（或文件结尾）；正文自成一体（framework 条目：现象 → 成因 → 做法；decisions 条目：任务背景 → 用户表态 → 决策 → 适用范围），读完整条目再作答，不凭标题猜内容
- 作答时附知识文件相对路径（相对 flow-mem 目录，如 `references/framework/vue/reactivity.md`、`references/decisions/demo-replica/asset-strategy/<ctx>.md`）便于溯源与后续维护
- 多版本同时命中（如 `vue-router` 与 `vue-router@5.2.0`）：版本目录知识优先适用于对应版本，通用层知识适用所有版本；作答时说明适用面
- decisions 条目作答时必须连带「适用范围」复述：决策只在记录的任务类型下成立，跨界套用前要核对边界
- 未命中 → 直说「知识库暂无收录」，不用模型自身记忆冒充知识库结论

## 跨技能调用约定

flow-dev 预搜索（DevGoal 前与 Slice 开发前）或其他技能借用检索时：

- 检索是只读操作，可直接调脚本，无需走 preflight（脚本自检 root 与参数并报错）
- 结果清单审阅：`--format line ... 2>&1 | head -100`（约百行可见近百条标题）；首行 hits=count/total 或 truncated 表明 total 超过所见条数时，加大 head 行数翻完剩余标题——只见头部几条时不得下「无相关命中」结论
- DevGoal 前的预搜索关键词构成：任务类型词跑一次 `--kb decisions --mode h4`（同类任务的既往用户决策是 DevGoal 质量轴的约束输入）；Slice 开发前的预搜索关键词构成：任务关键词 + 项目 deps 包名，各跑一次 h4（framework 库）；命中的已知坑点、版本行为与既往决策应进入开发计划的约束项，用于开发阶段规避
- 写入知识库必须走 --learn，检索链路不得顺带修改知识文件
