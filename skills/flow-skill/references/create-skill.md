# 创建技能手册：需求、结构、规范

Workflow A 各阶段的细则依据。Step 1 通读一遍，Step 2–3 起草时回查对应章节，Step 5 按文末 Checklist 逐项验收。

## 需求四问（Step 1）

1. 任务领域：这个技能覆盖什么任务？解决什么痛点？一句话说不清边界的需求先澄清再动手。
2. 用例与触发词：列举 2–4 个具体使用场景；用户触发时通常说什么话？这些话直接成为 description 的「Use when」触发词，不许虚构。
3. 脚本还是纯指令：有没有确定性操作（环境自检、格式校验、批量改名）？有则规划 scripts/，别让模型每次重新生成同样的代码。
4. 参考材料：有没有可并入的现成方法论、模板、清单（旧技能、文档、最佳实践）？并入时在 description 触发词中带上旧名，方便用户用旧称唤起。

## 归属决策树

- 工作流族技能（多阶段流程、状态机、preflight + workflow 范式）：本仓 `skills/<name>/`；符号链接到 `~/.claude/skills/<name>` + 登记本仓 README.md
- 独立领域技能（可单独复用、需独立 git 管理）：单独建仓 `<repo>/skills/<name>/`；符号链接；独立 git 管理
- 轻量个人技能（快速迭代、不进 git）：`~/.claude/skills/<name>/`；直接落位

命名：flow 家族统一 `flow-<domain>`；其他技能用 kebab-case。目录名即技能名，即 frontmatter 的 name。

## 目录结构约定

```
skill-name/
├── SKILL.md           # 主入口（必需）：只放路由 + workflow 骨架
├── CHANGELOG.md       # 版本变更记录（必需）：由 bump.mjs 维护，勿手编
├── references/        # 渐进披露细则手册，按 workflow 阶段按需读取
│   └── xxx.md
└── scripts/           # 确定性脚本（可选）
    └── preflight.mjs  # 预检自检（可选，workflow 式技能推荐）
```

## 版本化约定

每个技能一个独立版本号，三处落点由 `scripts/bump.mjs` 一次完成，禁止手工分头改：

- SKILL.md frontmatter 的 `metadata.version`（机器契约：preflight 吐出版本、state.json 打标、resume 漂移判定都读它）
- CHANGELOG.md 顶部 prepend 新条目（resume 时判断版本间变更的唯一入口，条目要写「变了什么行为」，不写流水账）
- git tag `<skill>@<version>`（需要精确 diff 时的回溯锚点）

版本生命周期：alpha 起步 → 毕业 semver → 保守分级。版本号是稳定性信号而非改动计数器——打磨期改动密集，版本号跟着涨会在技能稳定前就耗尽信号的区分度。

- alpha 起步：新技能在创建流程内以 `bump.mjs <skill> alpha "初始创建"` 基线化；打磨期改动不升版本、不动 CHANGELOG（改动史由 git 承担）
- 毕业：用户显式拍板后 `bump.mjs <skill> 0.1.0 "<条目>"` 切换到 semver；alpha 技能不接受级别自增，bump.mjs 会拒绝并提示毕业写法
- 毕业后分级：小改动 patch；重大功能变动才 minor；永不 major，除非用户明确指定

用法：`node scripts/bump.mjs <skill> [patch|minor|major|x.y.z|alpha] "<条目1>" ["<条目2>"...]`。级别省略按 patch；minor/major 与毕业时机只在维护者显式判断后使用，不定义机械分级规则。

顺序纪律：严格先 feat commit 全部功能改动，再跑 bump——版本提交只许含 SKILL.md 与 CHANGELOG.md 两个文件，技能目录有其他未提交改动时 bump 在落盘前预检拒绝（dirty 检查先于写盘，失败不留"半 bump"工作区）；`--no-commit` 模式跳过该检查，适用于像本仓库这样由维护者自行提交的场景。

## SKILL.md 模板（薄壳范式）

```md
---
name: skill-name
description: <第三人称功能描述>。Use when <触发词/场景枚举>
argument-hint: <参数提示，一行>
disable-model-invocation: true
metadata:
  version: alpha
---

# 技能名：一句话定位

## 要求

## 意图路由          # 多分支技能用路由表；单分支可省
## 外部依赖入口      # 脚本 / MCP / CLI / 依赖技能，列明调用方式
## Workflow A        # 编号步骤 + checkbox；Step 0 固定为 Preflight（有脚本时）
## 红线与故障恢复
## References 地图   # 每个 references 文件的内容与读取时机
```

frontmatter 字段规范：

- name：与目录名一致，kebab-case
- description：≤1024 字符；第三人称；首句写功能，次句以「Use when」起头枚举触发词；中文技能枚举中文话语，并入旧技能时带旧名
- argument-hint：参数提示，展示给用户看，如 `[docs | content] <目标>`
- disable-model-invocation：工作流式技能设 true，只允许 `/name` 手动调用，避免误触发
- metadata.version：`alpha`（打磨期）或 x.y.z 形式 semver（毕业后），由 bump.mjs 维护；该字段是机器契约，不计入「无时效性信息」禁令

## description 规范

description 是代理决定加载哪个技能时唯一能看到的东西，与全部已装技能并列出现在系统提示里。目标是让代理知道两件事：这个技能提供什么能力；什么话语/场景下触发。

好例子（中文触发词枚举式，含旧名兼容）：

```
lionad 的搜索入口。三条分支：(A) 文档溯源……(C) 深度研究……。当用户说「溯源」「找文档出处」「反查原文」「调研」「find-source」「search-web」「flow-search」时触发
```

坏例子：

```
Helps with documents.
```

坏例子让代理无从把它和其他文档类技能区分开。

## 脚本判据

满足任一条即加脚本，而不是让模型临场生成代码：

- 操作是确定性的（校验、格式化、环境自检）
- 同样的代码会被反复生成
- 错误需要显式处理（退出码 + 结构化输出）

Preflight 范式（flow 家族统一）：

- 以 `--mode` 分流，一个模式一个 runXxx()，不做 union 校验（避免一个模式的输入启发式误杀另一个模式）
- 退出码定性：0 放行、非零阻断；同时打印 JSON 汇总供调用方解析
- 环境固定事实（工具缺失、目录不可写、输入非法）→ errors + 阻断
- 业务决策（同名碰撞、分支歧义）→ warnings + 移交 workflow 询问用户
- JSON 汇总携带 `skill_version`（解析自身 SKILL.md 的 metadata.version），供调用方给运行状态打标

脚本维护纪律——flag 改名重构的残留扫描：改 flag 名后残留扫描 pattern 至少覆盖三类形态，flag 字面量（`--old\b`）、变量形态（`old_mode`）、属性访问形态（`\.old\b`，如 `args.old`）——argparse/参数解析器的 dest 派生属性名与 flag 字面量形态不同，按字面量搜不到属性访问处的残留（实证：run-external-review.py 的 `--full` 改 `--deep` 时 `args.full` 组装行漏扫，端到端运行才抛 AttributeError）。只审 diff 时未改动行不在视野内，扫描 pattern 又漏形态是双重盲区；合并前再跑一次该脚本的真实端到端路径（不只是 `--help` 与报错分支），端到端是 diff 外残余的最终兜底。

## 拆分判据与渐进披露

满足任一条即拆进 references/：

- SKILL.md 预期超过 100 行
- 内容分属不同领域（如搜索与评估、拆解与台账）
- 高频骨架之外的低频细则

渐进披露纪律：

- SKILL.md 的 Workflow 在对应步骤标注「读 references/xxx.md」，模型按阶段加载，禁止初始化时一口气全读
- references 只允许一层深：references/ 下不再嵌套子目录或二级引用链
- SKILL.md 保持路由 + 骨架职责：读完它应知道「做什么、按什么顺序、去哪查细则」，不该包含细则本身

## 强调纪律

- 非必要不使用「**」着重号；强调依靠选词与语序，而非加粗。
- 单个技能的「**」出现总量应小于（文件数 × 10）。强调是 Markdown 语法，只统计 md 文件；分母仍按全部文件数给预算。
- 自检命令（统计出现次数，不是行数；限定 md 是避开 JSDoc 起始符 `/**` 的误报）：

```bash
rg -o --no-filename -g '*.md' '\*\*' <skill-dir> | wc -l
```

- 超预算时回到文本逐处审问：去掉这对星号，语义是否受损？不受损就删。

## 文档约定

- 禁用 Markdown 表格：参数、字段、依赖、对比、路由、目录一律用列表承载（lint 规则 `no-tables` 强制）
- 参数条目形态（主键为参数名，默认值降为括注）：``- `--mode <mode>`（默认 `light`）：说明文字``
- 代码块内作为示例内容的表格不受此约束

## Review Checklist（Step 5）

- [ ] description 含触发词（「Use when…」），触发词来自真实话语而非虚构
- [ ] SKILL.md 在 100 行以内（薄壳；超出即拆 references）
- [ ] 正文无时效性信息（日期、「目前最新」之类会过期的断言；frontmatter 的 metadata.version 是机器契约，不在此列）
- [ ] 术语全文一致
- [ ] 含具体示例（好/坏对照优于抽象描述）
- [ ] references 只有一层深
- [ ] 全技能 md 文件「**」总量 < 文件数 × 10
- [ ] 正文无代码块外的 Markdown 表格（参数/字段/对比用列表；lint `no-tables`）
- [ ] 符号链接部署有效：`readlink ~/.claude/skills/<name>` 指向实际目录、无悬空
- [ ] 有 preflight 时正常与异常路径各冒烟一遍，退出码语义正确
- [ ] flow 家族技能已登记 flow/README.md
- [ ] 已用 bump.mjs 基线化：frontmatter 含 metadata.version（新技能为 `alpha`）、CHANGELOG.md 存在且顶部条目与之一致
