# flow-dev 外部审查协议

本文件定义 `flow-dev` 何时、如何发起外部交叉审查。外部审查由一个**外部审查工具（external review runner，下称 runner）**承接：runner 是能按本协议契约调起至少一个异族模型、执行审查并返回 JSON 的自建技能或脚本，实现方式不限（多模型 CLI 启动器、API 封装皆可）。

## 何时执行

`flow-dev` 在以下四个检查点可调用 runner：

1. **Step 1 需求树拆解后**（仅 `--dissection` 开启时）：拆解文档落档后、进入下游前，让外部模型审视需求树的覆盖完备性、原子性与可证伪性；
2. **Step 1 之后**：UltraThoughts 输出后，让外部模型审视需求与架构假设；
3. **Step 2 之后**：grill-me 自问自答结束、决策台账写入后，让外部模型审视决策质量；
4. **Slice 开发完成后（code-review 检查点）**：修复之前，外部异族模型执行 flow-code-review 流程，即 DevLoop 唯一审查（见下文「DevLoop 审查：外部执行 flow-code-review 流程」）。

## 审查风格：验证型（orthogonal）vs 发散型（adversarial）

前三个检查点（需求树拆解 / UltraThoughts / grill-me）审查的是**需求理解类产物**——无客观对错，风险形态是盲区与理解偏差；第四个检查点审查的是**代码 diff**——有客观对错，风险形态是故障。两者适用不同审查风格（runner 的 `--style` 参数）：

- **`adversarial`（对抗发散，前三个检查点用）**：审查任务是证伪与发散，不是复述与确认。对抗——对每项关键主张构造能证伪它的具体场景，验证方式若区分不了"理解对/理解错"本身即缺陷；发散——从产出未覆盖的视角枚举遗漏象限（用户角色、运维部署、安全权限、时间状态演化、极端规模、失败路径等）。输出按「视角/象限 → 遗漏或偏差描述 → 建议证伪或补齐路径」组织成盲区清单。理由：验证型 sanity check 的「只报故障发现 / 无发现一行结论」框定在需求理解对象上大概率产出低信息量阴性结论——需求审查的价值恰恰在发散出的盲区清单；对抗姿态是任务定义（赋予立场），发散透镜是启发集（标注"不限于所列"），都不构成下文陈述式纪律所防的"方向框定"。
- **`orthogonal`（正交验证，code-review 检查点用）**：保持既有 light sanity check 语义——检查已做的对不对，只报真正造成故障的高/中严重度发现。DevLoop 审查按 flow-code-review 流程执行，附 `--no-preamble`。

两风格共用 runner 的模型选择、effort、降级与熔断链路，差异仅在前言框定与输出契约。

执行策略：
- **`--mode light`（默认）**：执行 code-review 检查点；若 `--dissection` 开启，追加需求树拆解检查点；
- **`--mode full`**：追加 UltraThoughts、grill-me 两个检查点（需求树拆解检查点仍由 `--dissection` 触发，与模式无关）；
- **`--skip-review`**：跳过全部检查点（DevLoop 审查随之降级本地执行，维持 DevLoop 审查结构不塌）；
- **`--delegate`**：与委托正交——外部执行仍由主代理发起（后台 Bash / 同步调用），不委托子代理（委托边界见 `references/delegation.md` 分工总表），检查点集沿用伴行模式。

## DevLoop 审查：外部执行 flow-code-review 流程

Slice 轮 code-review 检查点是 DevLoop 的**唯一审查**，单轨执行、每 Slice 恒执行一次：由外部异族模型执行 flow-code-review 流程（正交视角与结构化纪律一遍完成），取代旧版「本地审查恒跑 + 外部审查较大改动才触发」的双轨设计——双轨在同一片 diff 上重复劳动，外部审查的等待时间又常被本地审查填满，时间成本翻倍而覆盖增益有限。

执行与降级规则：

- **默认外部执行**：发起点在 Step 5 顶部、Bash `run_in_background` 后台并行（prompt 与发起时机见「调用方式」）；runner 调用附 `--no-preamble`（light 前言的「快速 sanity check / 一行结论」框定与 flow-code-review 结构化流程冲突），`--effort normal` 锁定
- **降级本地执行**（主代理内联执行 flow-code-review，`--delegate` 时分派审查子代理）：`--mode fix`（恒禁用外部执行）、`--skip-review`，或外部执行运行时失败（runner 未返回 JSON / 全部 target failed/degraded 且产物不可采纳 / 产物无法提取 findings JSON）；降级时外部检查点在 `reviews[]` 记 skipped/failed 与原因，降级原因写入决策台账与最终报告
- **`--depth hifi` 例外**：外部执行运行时失败不降级——hifi 质量门含「DevLoop 审查外部执行通过」，降级会使其失效；记 `external-review-failed` blocker、phase → `blocked`，`--resume` 恢复后重发收集
- flow-code-review 的 effort 档位沿用 flow-dev 运行模式映射（见 `quality-gates.md`），作用于流程本身，与外部/本地执行者无关

文档类检查点（UltraThoughts / grill-me）随 `--mode full` 启用即执行，每个 run 只发生一次。**需求树拆解检查点恒执行**：`--dissection` 是显式的拆解请求，拆解一旦发生即须过审，结果未经外部审查不得进入下游。拆解检查点是 Gate，不适用降级规则——失败即 blocked，不退化为主代理自审（自审无正交性：与 caller 同视角，共享同一套隐含假设）。

## 调用方式

`flow-dev` 不直接调用具体模型 CLI，而是通过 runner 主动发起外部审查。调用者先把任务描述（自己用什么模型做了什么）、被审查文件与审查要求写入 `prompt.md`，再以 `--prompt-file` 交给 runner；runner 据此选择正交模型（与 caller 异族）并执行审查，产物落到 `--review-dir` 下。

示例（以 `flow-agent` 技能为 runner；runner 可替换为任意按本协议契约实现的技能或脚本）：

```bash
python3 ~/.claude/skills/flow-agent/scripts/run-external-review.py \
  --slug <task-slug>-ultrathoughts \
  --review-dir <working-dir>/docs/reviews/<task-slug>-ultrathoughts \
  --prompt-file <working-dir>/docs/reviews/<task-slug>-ultrathoughts/prompt.md \
  --caller-model <caller-model> \
  --effort normal \
  --style adversarial
```

调用约定：

- **prompt 用陈述式，不用指令式（两种风格共用纪律）**：任务描述与 prompt 正文只陈述事实，不下达"重点关注 X"的审查指令，也不主动暴露自评盲区。原因：指令式 prompt 用主代理视角把审查方向框死，审查模型顺着主代理指的方向看，大概率复现主代理的盲区——"正交"与"对抗"都会名存实亡；陈述式暴露覆盖边界，审查模型自主检索还原主代理真正做了什么，从覆盖之外或验证方式的缺陷切入。各检查点陈述对象不同：文档类检查点陈述已产出的维度与属性（"查了排序 correctness / IR 契约 / 三入口等价性"）；DevLoop 审查检查点陈述 Slice 目标、验收标准与 diff 基线。**对抗姿态与发散透镜（adversarial 风格的固定部分）与审查方法（flow-code-review 流程）一样，是任务定义而非方向框定**——它们赋予审查立场与广度，不指向特定领域，与"重点关注 X"类焦点指令是两回事。
- **多切片任务声明完整切片计划**：中间切片的审查 prompt 须陈述完整切片计划与后续动作（如"S3 将 bump 至 x.y.z 并 prepend CHANGELOG"、"S4 落地 /memory 页面"）。审查模型只能看到当前 diff 与 prompt，不知道后续计划时会把 bump 前的中间态当最终态审查，产出篡改已发布版本历史类的假发现（要求把 schema 迁移补进已发布的旧版 CHANGELOG、把后续切片才落地的路由报成死链）。裁决时区分两类发现：不知计划导致的假发现按「计划内中间态」驳回并记决策台账，计划无关的真发现（如版本引用表述不严谨）照常修复。
- **审查模式默认 light**：此处的 light/deep 指 **runner 的审查深度参数**，与 flow-dev `--mode` 正交——`--mode full` 只决定启用哪些检查点，不改变单次审查深度。不传 `--deep` 即 light，runner 自动注入前言框定为快速正交 sanity check（聚焦高/中严重度发现，不逐行 review、不穷举边界、不搜索所有领域）。仅在任务涉及架构/安全/数据契约等高风险变更、且 caller 判断需要逐领域详查时才传 `--deep`。
- **无发现输出仅一行结论**：light 前言已约束审查模型——无高/中严重度发现时整份输出仅一行「未发现高严重度问题」，不罗列已验证角度、不复述验证过程/成功路径。主代理按结论行判读，无发现即直接推进，不要求审查模型补充验证叙述。
- **超时默认 1800s，不要传 `--timeout 900`**：单模型审查建议内置超时 1800s，复杂审查实测可达 600s+，900s 余量不足曾导致超时降级。调用方一般不传 `--timeout`；如需覆盖，不应低于 1800。
- `--effort` 默认 `normal`（单个异族模型审查），需要多模型交叉时按映射表提升到 `max`/`ultra`。
- **code-review 检查点后台并行（仅 Slice 轮）**：以 Bash `run_in_background` 后台发起，发起点在 Step 5 顶部；等待期由主代理对下一 Slice 做只读调研（flow-mem 预搜索、代码与方案阅读，禁止写入），Step 6 用 TaskOutput 阻塞收集 JSON——外部执行的时间成本被调研窗口隐藏。其余三个文档检查点仍同步调用——其后无 Slice 调研对象，并行无收益。
- **DevLoop 审查调用附 `--no-preamble`**：runner 的 light 前言（「快速 sanity check / 一行结论」）与 flow-code-review 结构化流程及 findings JSON 契约冲突，DevLoop 审查发起时必须跳过；文档类检查点不传——adversarial 前言（证伪+发散框定）由 runner 按 `--style adversarial` 自动注入，与文档类审查的盲区清单契约一致。

四个检查点分别使用不同的任务描述（写入 prompt.md）、`--slug` 与审查风格：

- 需求树拆解后：任务描述示例 `"<caller-model> 完成需求树拆解"`；`--slug` 示例 `<task-slug>-dissection`；`--style adversarial`，prompt 按对抗发散框架拟写（见 `flow-agent/references/prompt-template.md`），陈述需求树规模与覆盖边界
- UltraThoughts 后：任务描述示例 `"<caller-model> 完成 UltraThoughts 需求分析"`；`--slug` 示例 `<task-slug>-ultrathoughts`；`--style adversarial`，同上框架，陈述目标定义性属性与可证伪验证
- grill-me 后：任务描述示例 `"<caller-model> 完成 grill-me 自问自答"`；`--slug` 示例 `<task-slug>-grill-me`；`--style adversarial`，同上框架，陈述决策清单与已权衡维度
- DevLoop 审查（code-review 检查点）：任务描述示例 `"<caller-model> 完成 Slice 开发"`；`--slug` 示例 `<task-slug>-code-review`；风格 orthogonal（默认，不传 `--style`），prompt 模板见下节

## DevLoop 审查 prompt

code-review 检查点的 prompt.md 模板（占位符按实际填充）：

````markdown
# DevLoop 审查（外部执行 flow-code-review 流程）— <task-slug>-code-review

## 上下文
- 任务：<caller-model> 完成 Slice 开发（<Slice 名>：<一句话目标>）
- 审查仓库：<working-dir>（执行 git 命令前先 cd 到该目录）
- diff 基线：<base_ref>；本 Slice 改动 = git diff <base_ref>...HEAD + 工作区未提交改动（git diff HEAD）
- 本次审查模型：<target-model>

## 审查方法
读取 ~/.claude/skills/flow-code-review/SKILL.md 及其按档位要求读取的 references，
按其流程执行一次代码审查，调用语义等价于：
flow-code-review --json --effort <档位> --base <base_ref>
（Slice 目标：<目标>；验收标准：<逐条列出>——事实陈述，供判断行为正确性，不构成焦点指令）
<多切片任务：陈述完整切片计划与后续动作，见「调用方式」的多切片声明条款>

## 输出契约
只输出 flow-code-review「--json 契约」的 findings JSON 数组，以 ```json 代码块包裹；
最严重在前，无问题输出 []。不输出审查过程叙述、角度清单或总结。
````

外部模型的 stdout 即产物 `review-<model>.md`；Step 6 从产物提取 findings JSON（提取失败按运行时失败降级规则处置）。

## `<caller-model>` 推断

`flow-dev` 在运行时根据当前 Claude Code 实际使用的模型标识推断 caller 所属模型族。合法枚举以 runner 的 `--caller-model` 合法值为唯一真源（下方规则是快照）：模型退役/新增时两处会漂移，传入旧名 runner 应拒发并列出合法枚举——按报错枚举修正 `state.json` 的 `caller_model` 后重发，并同步本表与下文 effort 规则，避免每次运行都踩一遍。拒发 + stderr 枚举清单 = 枚举漂移，区别于参数错误与 runner 层产物故障。

推断规则按标识子串匹配所属族（如标识包含 `kimi` → kimi 族、包含 `glm` → glm 族），未识别时取 runner 配置的默认族。

## 产物目录

所有外部审查产物统一落到：

```
<working-dir>/docs/reviews/
  ├── <task-slug>-dissection/
  │   ├── prompt.md
  │   ├── review-<model-1>.md
  │   └── ...
  ├── <task-slug>-ultrathoughts/
  │   ├── prompt.md
  │   ├── review-<model-1>.md
  │   └── ...
  ├── <task-slug>-grill-me/
  │   ├── prompt.md
  │   ├── review-<model-1>.md
  │   └── ...
  └── <task-slug>-code-review/
      ├── prompt.md
      ├── review-<model-1>.md
      └── ...
```

具体生成哪些 `review-<model>.md` 由 `--effort` 与 `--caller-model` 决定，选择原则固定：**审查模型必须与 caller 异族**（正交性是本协议的存在理由），同族模型的审查会共享 caller 的隐含假设。典型布局：

- `normal`：单异族模型审查（一个与 caller 异族的模型，风格 orthogonal 或 adversarial 均适用）
- `max`：双模型交叉（caller 的首选异族 + 一个第三方族）
- `ultra`：全部可用异族模型各审一份

caller↔target 的具体映射由 runner 配置维护，本文件不复制快照。

## 结果处理

1. runner 返回 JSON，包含 `slug`、`task`、`caller_model`、`effort` 与 `reviews[]`（每项含 `target_model`、`launcher`、`status`、`prompt_path`、`result_path`、`error`）；
2. `flow-dev` 把该记录追加到 `state.json` 的 `reviews[]`；
3. **需求树拆解检查点**：逐条裁决审查发现——接受则就地重写拆解文档对应节点，驳回则把理由与代码库证据写入决策台账；一轮修订后放行，不循环再审；裁决摘要（审查模型、发现条数、接受 / 驳回分布）追加到拆解文档末尾；runner 未返回 JSON 或全部模型 `failed` / `degraded` 时不放行，记录 `external-review-failed` blocker，phase → `blocked`；
4. DevLoop 审查（code-review 检查点）：从审查产物提取 findings JSON 数组，机械合并入 Bugs（去重、逐条按 failure_scenario 具体性裁决严重度）并纳入修复；提取失败按「DevLoop 审查：外部执行 flow-code-review 流程」的运行时失败降级规则处置；
5. 任一模型 `status=degraded` 时，把降级原因写入决策台账，并在最终报告中显式标注；
6. **degraded 鉴别锚点**（多次复现）：`status=degraded` 不直接等于真实失败——先 Read `result_path` 产物核实内容：产物含可提取的 findings JSON（含 `[]`），或非空单行阴性结论（light 校验器对合法轻量产物的误判），按实质通过裁决，不返工；产物为空或缺实质内容 = 真实失败，按运行时失败降级规则处置。
7. **审查发现按证据逐条裁决，警惕无证据假设放大**：审查发现不整体接受也不整体驳回，逐条拆「证据支持的内核」与「假设驱动的放大」分别裁决。鉴别锚点：发现里的失败场景若依赖「某行为方存在」（外部服务直写、用户操作、运行时序），先 rg 全仓取证该行为方的存在性再谈严重度——无法取证存在性的场景按假设处理，不据此宣称切片失效。内核接受并修正；放大驳回并在决策台账写明驳回理由与代码库证据；裁决中暴露的切片边界外缺口（如未来写入入口的加密契约）显式登记为技术债，不让它停留在隐含假设里。
8. **全模型族集中不可用**：多族并发同症（第一族空产物/probe 超时后，第二族仍同形态）即判基础设施面故障（额度耗尽、服务侧波动），不是单族瞬时故障——勿逐族串行空耗重试（四族烧 20 分钟才确认是基础设施面的教训）。DevLoop 审查检查点：直接降级本地执行继续（`--depth hifi` 除外，见 blocked 路径），降级原因连同降级链全记录写入决策台账；拆解 Gate 等 blocked 路径：记 `external-review-failed` blocker（含降级链全记录与未提交文件清单），phase 转 blocked 并保留工作区现场。审查 prompt 已落档 `docs/reviews/<slug>/` 可直接复用，`--resume` 从 review phase 重发收集（仅 blocked 场景需要）。恢复窗口可短至 1 小时：blocked 后值得同晚原地重试（手动复刻同一 runner 调用数分钟内成功产出的实证），不必直接等隔天额度重置；脚本轮的空产物早退不等于该族当晚死刑，重试间隔以十分钟级为宜。

## 跳过机制

- `--skip-review`：跳过全部检查点（DevLoop 审查随之降级本地执行）；
- 非 `--mode full` 时，UltraThoughts 和 grill-me 检查点默认跳过，但需在 `reviews[]` 中补 `status=skipped` 记录；
- 未传 `--dissection` 时需求树拆解检查点不发生（拆解本身未执行），无需补 skipped 记录；
- code-review 检查点降级本地执行时（`--mode fix`/`--skip-review` 未发起外部执行），需在 `reviews[]` 中补 `status=skipped` 记录与跳过原因；外部执行发起后运行时失败的，按实际回填 `failed`/`degraded` 与降级原因，不再补 skipped。
