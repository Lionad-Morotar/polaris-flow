# flow-dev 外部正交审查协议

本文件定义 `flow-dev` 何时、如何发起外部正交交叉审查。外部审查由一个**外部审查工具（external review runner，下称 runner）**承接：runner 是能按本协议契约调起至少一个异族模型、执行审查并返回 JSON 的自建技能或脚本，实现方式不限（多模型 CLI 启动器、API 封装皆可）。

## 何时执行

`flow-dev` 在以下四个检查点可调用 runner：

1. **Step 1 需求树拆解后**（仅 `--dissection` 开启时）：拆解文档落档后、进入下游前，让外部模型审视需求树的覆盖完备性、原子性与可证伪性；
2. **Step 1 之后**：UltraThoughts 输出后，让外部模型审视需求与架构假设；
3. **Step 2 之后**：grill-me 自问自答结束、决策台账写入后，让外部模型审视决策质量；
4. **Step 5 之后**：code-review 之后、修复之前，让外部模型审视代码实现。

执行策略：
- **`--mode light`（默认）**：执行 code-review 检查点；若 `--dissection` 开启，追加需求树拆解检查点；
- **`--mode full`**：追加 UltraThoughts、grill-me 两个检查点（需求树拆解检查点仍由 `--dissection` 触发，与模式无关）；
- **`--skip-review`**：跳过全部检查点。

Slice 轮 code-review 检查点（Step 6）**默认跳过**，满足任一触发判据才执行：

- 触及架构（模块边界/状态机/生命周期）、安全（鉴权/注入面/密钥）、数据契约（DB schema / API 契约 / 类型绑定）、公共接口（导出签名 / 跨包 API）任一；或
- 改动规模较大（软性锚点：增删合计约超 80 行，或波及超 3 个文件）；或
- `--depth=hifi`（质量门含「外部正交审查通过」，恒执行）。

由主代理按改动性质裁量；边界情况倾向跳过——本地 flow-code-review（Step 5）已先行覆盖一轮，跳过代价有限。跳过时无需外部模型过审，只需在 `state.json` 的 `reviews[]` 中记录 `status = skipped`。

文档类检查点（UltraThoughts / grill-me）随 `--mode full` 启用即执行，每个 run 只发生一次，不适用上述规模判据。**需求树拆解检查点恒执行**：`--dissection` 是显式的拆解请求，拆解一旦发生即须过审，结果未经正交检查不得进入下游。

## 调用方式

`flow-dev` 不直接调用具体模型 CLI，而是通过 runner 主动发起外部审查。调用者用 `--task` 描述自己用什么模型做了什么，runner 据此选择正交模型（与 caller 异族）并执行审查。

示例（`external-review` 为 runner 的占位命令名，按实际实现替换）：

```bash
external-review <working-dir>/docs/thoughts/<task-slug>.md \
  --task "<caller-model> 完成 UltraThoughts 需求分析" \
  --slug <task-slug>-ultrathoughts \
  --caller-model <caller-model> \
  --target-model auto \
  --output-dir <working-dir>/docs/reviews
```

调用约定：

- **prompt 用陈述式，不用指令式**：`--task` 与 prompt 正文要**陈述主代理 code-review 已查的维度**（"查了排序 correctness / IR 契约 / 三入口等价性"，只列维度、陈述事实），不要下达"重点关注 X"的审查指令，也不要主动暴露自评盲区。原因：指令式 prompt 用主代理视角把审查方向框死，审查模型顺着主代理指的方向看，大概率复现主代理的盲区，"正交"名存实亡；陈述式暴露覆盖边界，审查模型自主检索 diff 与测试还原主代理真正做了什么，从覆盖之外或验证方式的缺陷切入。
- **多切片任务声明完整切片计划**：中间切片的审查 prompt 须陈述完整切片计划与后续动作（如"S3 将 bump 至 x.y.z 并 prepend CHANGELOG"、"S4 落地 /memory 页面"）。审查模型只能看到当前 diff 与 prompt，不知道后续计划时会把 bump 前的中间态当最终态审查，产出篡改已发布版本历史类的假发现（要求把 schema 迁移补进已发布的旧版 CHANGELOG、把后续切片才落地的路由报成死链）。裁决时区分两类发现：不知计划导致的假发现按「计划内中间态」驳回并记决策台账，计划无关的真发现（如版本引用表述不严谨）照常修复。
- **审查模式默认 light**：此处的 light/deep 指 **runner 的审查深度参数**，与 flow-dev `--mode` 正交——`--mode full` 只决定启用哪些检查点，不改变单次审查深度。不传 `--deep` 即 light，runner 自动注入前言框定为快速正交 sanity check（聚焦高/中严重度发现，不逐行 review、不穷举边界、不搜索所有领域）。仅在任务涉及架构/安全/数据契约等高风险变更、且 caller 判断需要逐领域详查时才传 `--deep`。
- **无发现输出仅一行结论**：light 前言已约束审查模型——无高/中严重度发现时整份输出仅一行「未发现高严重度问题」，不罗列已验证角度、不复述验证过程/成功路径。主代理按结论行判读，无发现即直接推进，不要求审查模型补充验证叙述。
- **超时默认 1800s，不要传 `--timeout 900`**：单模型审查建议内置超时 1800s，复杂审查实测可达 600s+，900s 余量不足曾导致超时降级。调用方一般不传 `--timeout`；如需覆盖，不应低于 1800。
- `--effort` 默认 `normal`（单模型正交审查），需要多模型交叉时按映射表提升到 `max`/`ultra`。
- **code-review 检查点后台并行（仅 Slice 轮）**：触发时以 Bash `run_in_background` 后台发起，发起点提前至 Step 5 本地 code-review 之前——prompt.md 只陈述已查维度、不含本地审查结果，两者无依赖可并行；等待期由主代理对下一 Slice 做只读调研（flow-mem 预搜索、代码与方案阅读，禁止写入），Step 6 用 TaskOutput 阻塞收集 JSON。其余三个文档检查点仍同步调用——其后无 Slice 调研对象，并行无收益。失败与降级处理语义不变。

四个检查点分别使用不同的 `--task` 描述与 `--slug`：

- 需求树拆解后：`--task` 示例 `"<caller-model> 完成需求树拆解"`；`--slug` 示例 `<task-slug>-dissection`
- UltraThoughts 后：`--task` 示例 `"<caller-model> 完成 UltraThoughts 需求分析"`；`--slug` 示例 `<task-slug>-ultrathoughts`
- grill-me 后：`--task` 示例 `"<caller-model> 完成 grill-me 自问自答"`；`--slug` 示例 `<task-slug>-grill-me`
- code-review 后：`--task` 示例 `"<caller-model> 完成 code-review"`；`--slug` 示例 `<task-slug>-code-review`

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

- `normal`：单模型正交审查（一个与 caller 异族的模型）
- `max`：双模型交叉（caller 的首选异族 + 一个第三方族）
- `ultra`：全部可用异族模型各审一份

caller↔target 的具体映射由 runner 配置维护，本文件不复制快照。

## 结果处理

1. runner 返回 JSON，包含 `slug`、`task`、`caller_model`、`effort` 与 `reviews[]`（每项含 `target_model`、`launcher`、`status`、`prompt_path`、`result_path`、`error`）；
2. `flow-dev` 把该记录追加到 `state.json` 的 `reviews[]`；
3. **需求树拆解检查点**：逐条裁决审查发现——接受则就地重写拆解文档对应节点，驳回则把理由与代码库证据写入决策台账；一轮修订后放行，不循环再审；裁决摘要（审查模型、发现条数、接受 / 驳回分布）追加到拆解文档末尾；runner 未返回 JSON 或全部模型 `failed` / `degraded` 时不放行，记录 `external-review-failed` blocker，phase → `blocked`；
4. 仅 code-review 检查点的外部审查结果需要合并到 Bugs（去重）并纳入修复；
5. 任一模型 `status=degraded` 时，把降级原因写入决策台账，并在最终报告中显式标注；
6. **degraded 鉴别锚点**（多次复现）：`status=degraded` 不直接等于真实失败——先 Read `result_path` 产物核实内容：产物为非空的单行阴性结论（如「未发现高严重度问题。」）可能是 light 校验器对合法轻量产物的误判，按实质通过裁决，不返工；产物为空或缺实质内容 = 真实失败，按「全部 `failed`/`degraded`」处置。一刀切的 blocked 只针对核实后仍无法采纳的情形。
7. **审查发现按证据逐条裁决，警惕无证据假设放大**：审查发现不整体接受也不整体驳回，逐条拆「证据支持的内核」与「假设驱动的放大」分别裁决。鉴别锚点：发现里的失败场景若依赖「某行为方存在」（外部服务直写、用户操作、运行时序），先 rg 全仓取证该行为方的存在性再谈严重度——无法取证存在性的场景按假设处理，不据此宣称切片失效。内核接受并修正；放大驳回并在决策台账写明驳回理由与代码库证据；裁决中暴露的切片边界外缺口（如未来写入入口的加密契约）显式登记为技术债，不让它停留在隐含假设里。
8. **全模型族集中不可用时 blocked 留现场**：多族并发同症（第一族空产物/probe 超时后，第二族仍同形态）即判基础设施面故障（额度耗尽、服务侧波动），不是单族瞬时故障——记 `external-review-failed` blocker（含降级链全记录与未提交文件清单），phase 转 blocked 并保留工作区现场，勿逐族串行空耗重试（四族烧 20 分钟才确认是基础设施面的教训）。审查 prompt 已落档 `docs/reviews/<slug>/` 可直接复用，`--resume` 从 review phase 重发收集。恢复窗口可短至 1 小时：blocked 后值得同晚原地重试（手动复刻同一 runner 调用数分钟内成功产出的实证），不必直接等隔天额度重置；脚本轮的空产物早退不等于该族当晚死刑，重试间隔以十分钟级为宜。

## 跳过机制

- `--skip-review`：跳过全部检查点；
- 非 `--mode full` 时，UltraThoughts 和 grill-me 检查点默认跳过，但需在 `reviews[]` 中补 `status=skipped` 记录；
- 未传 `--dissection` 时需求树拆解检查点不发生（拆解本身未执行），无需补 skipped 记录；
- Slice 轮 code-review 检查点未达触发判据（默认路径）时，需在 `reviews[]` 中补 `status=skipped` 记录（需求树拆解检查点不适用，见「何时执行」）。
