---
name: flow-image
description: 图像生成与提示词流程:从描述或参考图生成/编辑图片、理想vs现实(anti-render)对比图、将图片或文本转为 AI 绘画提示词、透明背景抠图;支持 grsapi 与阿里云百炼(bl) 双 provider，按模型自动路由或 --provider 手动指定。当需要生成新图片、编辑已有图片、获取绘画提示词,或搜索找不到现成图片素材时使用。
argument-hint: <description | image path> [--mode gen|prompt|edit|anti-render|transparent|batch] [--model <id>] [--provider <grsapi|bailian>] [--no-open]
metadata:
  version: 0.1.0-alpha.0
---

## 要求

* 本技能生成的图片默认落在 `~/.flow-image/<YYYY-MM-DD>/<provider-seg>/<model>/`（grsapi 段为 `grsapi.xyz`，bailian 段为 `bailian`），不进入 git;被项目消费时复制进工作区，禁止让项目引用该目录下的文件。
* 严格按照流程执行，如果碰到以下阻塞按清单解决:
  * 进入了计划模式，生成了计划:你应当自动确认计划（注意，并非不做计划!而是先计划再自动确认）。
  * 有决策需要我确认:仅三类必须询问——**跨家族模型切换**、**复杂主体的透明背景**、**provider/model 解析报错（UNKNOWN_MODEL / UNSUPPORTED_COMBO）**;其余按"高质量图像产出"标准自行决策。
  * **不要暂停**:完成所有阶段，而不是分阶段汇报向我确认，get all shits done。例外:抽卡迭代每轮出图后暂停等评审是预期行为（见 `references/draft-iteration.md`）。
* **按需读取 references**:仅在进入对应模式或需要提示词增强时读取，禁止初始化时一口气全读（详见文末 References 地图）。
* **provider/model 解析一律走脚本**:`scripts/resolve_provider.mjs` 是 n×n 路由的单一事实源，禁止在脑中按散文推断路由（详见 Step 1.5 与 `references/providers.md`）。

## 模式路由

- gen(默认)：`<description>`(未传 `--mode`)；解析 provider/model → 提取/打磨提示词 → 按 provider 生成 → 验证 → 打开汇报；提示词笼统时读 `references/prompting.md`
- prompt：`--mode prompt`；解析(取 model 选格式) → 三层分析输入(图/文) → 输出结构化提示词,**不生图**；`references/analysis-framework.md`、`references/model-formats.md`
- edit：`--mode edit`；解析 provider/model → 声明不变量 → 按 provider 编辑 → 逐项验证；`references/prompting.md` 约束与不变量节
- anti-render：`--mode anti-render` 或触发词("anti-render"/"理想vs现实"/"对比图"/"渲染vs真实",命中等同隐式 `--mode anti-render`)；状态判定 → 领域识别 → 五维对比映射 → 构建提示词 → 落回 edit/带参考 gen；`references/anti-render.md` 必读
- transparent：`--mode transparent`；解析 provider/model → 色键背景生成 → 本地移除 → Alpha 验证；`references/transparent.md`
- batch：`--mode batch`；每资产独立 resolve + 独立调用,**禁止用 `n` 参数替代独立提示词**；同 gen
- draft(抽卡)：触发词("抽卡"/"出几张看看"/"来几版"/"给我选")命中即进入,不占 `--mode`；每轮默认 2 张、每张独立调用，出图后暂停等评审；`references/draft-iteration.md` 必读

旧参数已移除并合并为 `--mode`:`--prompt` → `--mode prompt`、`--edit` → `--mode edit`、`--anti-render` → `--mode anti-render`、`--transparent` → `--mode transparent`、`--batch` → `--mode batch`;传入旧参数时报错并提示新写法。

## 外部依赖入口

> 以下为环境固定事实，Step 0 preflight 自检。grsapi 与 bailian 至少其一可用即视为环境就绪。

- grsapi.xyz API — HTTPS + API_KEY：grsapi provider 通道:gen 默认 `gpt-image-2` 走 `/v1/images/generations`;Gemini 走 `/v1beta/models/<model>:generateContent`
- bailian CLI (`bl`) — 本地 CLI + `bl auth`：bailian provider 通道:`bl image generate` / `bl image edit`，鉴权内置，`--out-dir` 直出 PNG，无需 extract
- API 配置 — `~/.config/flow-image/.env`：含 `API_KEY=sk-...`;仅 grsapi 需要;preflight 会从旧路径 `~/.config/prompt-to-image/.env` 自动迁移
- resolve_provider.mjs — 技能脚本：n×n 路由解析器:输入 model/provider，输出 (provider, model) 或结构化 error;路由的单一事实源
- preflight.mjs — 技能脚本：双后端能力探测:grsapi/bailian 至少其一可用即 ok
- extract_images.py — 技能脚本：从 grsapi 响应提取图片，自动识别 Gemini inlineData 与 GPT url/b64_json 格式;bailian 不需要
- wait_for_file.sh — 技能脚本：文件写入同步检测(存在 → 大小稳定 → sync)
- remove_chroma_key.py — 技能脚本：色键移除为 Alpha，需 pillow(仅 transparent 模式)
- 路由 / 模型清单 — `references/providers.md`、`references/2026-06-11-grsapi-image-models.md`：provider×model 路由规则、合法集、参数差异;grsapi 46 模型端点速查

## Workflow

0. **Preflight 自检与参数解析**
   - [ ] 运行 `node ~/.claude/skills/flow-image/scripts/preflight.mjs`，整体 `ok=false`（两后端都不可用）则停止并报告两侧原因
   - [ ] 解析 `--mode` 与 `--model <id>` / `--provider <grsapi|bailian>`;`--mode` 值必须是 `gen`/`prompt`/`edit`/`anti-render`/`transparent`/`batch` 之一,非法值报错、列出合法值并停止;**旧参数迁移提示**:传入已移除的 `--prompt`/`--edit`/`--anti-render`/`--transparent`/`--batch` 时,不静默忽略——报错并提示新写法(如 `--prompt` → `--mode prompt`)后停止

1. **模式判定与输入角色标注**
   - [ ] 按 `--mode` 路由到模式;未传默认 gen
   - [ ] 若用户提供了图片，按索引显式标注每张图片角色:编辑目标(edit target)/ 风格参考(style reference)/ 合成输入;不要默认用户给的图都是编辑目标
   - [ ] 意图判定:用户希望保留图片部分内容并修改 → edit;图片仅作风格/构图/氛围参考 → 带参考的 gen

1.5. **Provider / Model 解析（n×n）**
   - [ ] 运行 `node ~/.claude/skills/flow-image/scripts/resolve_provider.mjs --model <若有> --provider <若有>`，读 stdout JSON 与退出码
   - [ ] 退出码 0:取 `provider` 与 `model` 作为本次后端与模型，记入后续步骤
   - [ ] 退出码 2(error):按 `error.code` 处理——`UNKNOWN_MODEL` / `UNSUPPORTED_COMBO` 向用户报错并询问（可把 `error.suggested_provider` 作为建议给出）;`INVALID_PROVIDER` 提示仅支持 grsapi|bailian。**不得**自行猜测路由或静默替换模型/provider
   - [ ] 零参数时 resolve 返回 grsapi + gpt-image-2（全局默认，向后兼容）
   - [ ] 解析规则、合法集、参数与落盘差异见 `references/providers.md`

2. **提示词获取**
   - [ ] gen/edit/transparent 模式:从用户当前输入截取提示词(不是重写);当前输入无有效视觉描述时，回溯对话上下文最近生成的完整提示词(格式优先级:中文优化版(夹杂英文术语)> 纯英文版 > 纯中文版)
   - [ ] **提示词原样使用，严禁改写、简化、提取关键元素或用模板包裹**(如 "Generate an image of...");仅允许 JSON 特殊字符转义:`tr '\n' ' '` 换行转空格、双引号转义为 `\"`
   - [ ] prompt 模式(`--mode prompt`):
     - [ ] 读取 `references/analysis-framework.md`，按三层框架(核心视觉层 / 风格与技法层 / 认知与叙事层)分析输入;路径/URL 图片用视觉工具提取信息，对话中粘贴的图片用模型原生视觉直接分析
     - [ ] 读取 `references/model-formats.md`，按 Step 1.5 的 model 选格式（model→格式自动选择映射;未指定 model 时默认 Banana、中文版本、专业术语后标注英文，总长 ≤2000 字）
     - [ ] 直接以 ` ```plaintext ` 块输出提示词，流程结束(不生图)

3. **提示词增强判定**(gen/edit/transparent)
   - [ ] 提示词已具体详细 → 仅规范化为清晰规格，不添加创意要求
   - [ ] 提示词笼统 → 读取 `references/prompting.md`，仅在能实质性提升输出质量时有品味增强(构图取景、预期用途、布局指导);禁止添加未暗示的角色、品牌、标语、调色板
   - [ ] edit 模式显式列出不变量(`仅修改 X;保持 Y 不变`)，每次迭代重复以减少漂移
   - [ ] 格式口径:bl 的 qwen-image 模型用 Qwen-Image 格式，其余按 model-formats 的 model→格式映射

4. **API 调用（按 provider 分叉）**
   - [ ] **grsapi**:
     - [ ] **密钥加载与 curl 必须在同一 shell 脚本块中**:`set -a; source "${HOME}/.config/flow-image/.env"; set +a`，脚本内始终用 `${HOME}` 而非 `~`
     - [ ] 默认模型 `gpt-image-2`:`POST https://grsapi.xyz/v1/images/generations`(dall-e-3 格式)，`{"size":"1792x1024","prompt":"...","model":"gpt-image-2","n":1}`
     - [ ] Gemini 系列:`POST https://grsapi.xyz/v1beta/models/<model>:generateContent`，`generationConfig.responseModalities: ["TEXT","IMAGE"]`
     - [ ] edit 模式:默认路由 `gemini-3-pro-image-preview`，图片 base64 后作为 `inlineData` part 与 text part 一起放入 `contents`(payload 较大时先写临时 JSON 文件再 `curl --data @file`);用户明确要求 gpt-image-2 编辑时改用 `/v1/images/edits`(注意:gpt-image-2 直连曾反复出现 60 秒连接中断，失败即报告，不重试)
     - [ ] grsapi 内部端点按 `references/2026-06-11-grsapi-image-models.md` 的"支持端点"列选;**跨家族模型切换必须经用户确认**;同家族兼容替代可直接进行
     - [ ] curl 加 `-s` 保证纯净 JSON;仅调用一次，任何错误(配额耗尽、渠道不可用、模型不存在)立即停止并报告，不重试不切换
   - [ ] **bailian**:
     - [ ] 用 `bl`，鉴权内置，**无需 source .env**
     - [ ] gen:`bl image generate --model <model> --prompt <prompt> --size <size> --watermark false --out-dir <out> --output json`（默认 sync，**不加 --async**；水印 CLI 默认 true，须显式关闭）
     - [ ] edit:`bl image edit --model <model> --image <path> [--image <path2>] --prompt <prompt> --watermark false --out-dir <out> --output json`;本地路径直传，bl 自动上传到临时存储
     - [ ] size 取比例(1:1 / 16:9 / 3:4)或像素(W*H，如 2048*2048);transparent 的色键图也走本 provider 的 gen 命令
     - [ ] bl 调用失败(非零退出 / 鉴权失效 / 内容过滤 / 模型不可用)立即停止并报告，**不静默回退 grsapi**（跨 provider 不静默切换，与"不重试不切模型"同纪律）

5. **保存与提取（按 provider 分叉）**
   - [ ] 落盘目录 `~/.flow-image/<YYYY-MM-DD>/<provider-seg>/<model>/`;provider-seg:grsapi → `grsapi.xyz`，bailian → `bailian`
   - [ ] **grsapi**:
     - [ ] 完整响应保存到 `<hh-mm-ss.sss>.json`
     - [ ] 用 `python3 -c "import json; json.load(open('<response>.json'))"` 验证 JSON 有效性，失败则报告文件内容，不重新调用
     - [ ] `python3 ~/.claude/skills/flow-image/scripts/extract_images.py <response.json> <output_dir>` 提取图片
     - [ ] `~/.claude/skills/flow-image/scripts/wait_for_file.sh <图片路径> 10` 等待文件完全写入
   - [ ] **bailian**:
     - [ ] bl 的 stdout（`--output json` 为纯净 JSON，`[Model][Mode]` 元信息在 stderr）保存为 `<hh-mm-ss.sss>.json`
     - [ ] 同样 json.load 验证有效性
     - [ ] 从该 JSON 的 `saved` 数组读产物本地路径（**不需 extract_images.py**，bl 已 `--out-dir` 落盘）
     - [ ] 可选 `wait_for_file.sh` 作防御

6. **transparent 模式后处理**(`--mode transparent` 时)
   - [ ] 读取 `references/transparent.md`，按色键工作流执行（生成阶段的出图后端已由 Step 1.5 解析）
   - [ ] 生成阶段的提示词要求纯平纯色色键背景:默认 `#00ff00`，绿色主体用 `#ff00ff`;禁止阴影/渐变/反射/纹理/光照变化，主体不得含色键色
   - [ ] 运行 `python3 ~/.claude/skills/flow-image/scripts/remove_chroma_key.py --input <source> --out <final.png> --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill`
   - [ ] 验证 Alpha 通道、边角透明、主体覆盖合理、无色键边缘残留;细边残留用 `--edge-contract 1` 重试一次
   - [ ] 复杂主体(毛发/玻璃/烟雾/液体/半透明材质/反光物体/柔和阴影)先询问用户是否继续

7. **打开与汇报**
   - [ ] 单张生成且未传 `--no-open` 且 `--mode` 非 batch:优先 `code <图片路径>`，否则 `open <图片所在目录>`
   - [ ] `--mode batch` / `--no-open`:不自动打开
   - [ ] 项目消费的图片复制进工作区(可按需压缩裁剪)，并更新消费代码的引用
   - [ ] 汇报:图片 Markdown 链接、**provider**、model、最终提示词、文件大小;batch 模式列出全部产物路径

## 错误处理

- preflight 两后端都不可用:停止并报告 grsapi 与 bailian 各自的原因（配置/curl/python3 或 bl 未装/未鉴权）
- 配置文件缺失(仅 grsapi 需要):提示创建 `~/.config/flow-image/.env` 并写入 `API_KEY=sk-...`
- resolve 报错:`UNKNOWN_MODEL` / `UNSUPPORTED_COMBO` 向用户报错并询问（附 `suggested_provider` 若有）;`INVALID_PROVIDER` 提示仅支持 grsapi|bailian;不得自行猜测路由
- 密钥无效 / API 调用失败 / bl 调用失败:立即停止并报告，**不切换模型、不跨 provider 静默回退、不重试**;grsapi 报"无效的令牌"类错误时提示更新 `~/.config/flow-image/.env` 的 API_KEY
- JSON 验证失败:报告错误并检查文件内容，不重新调用
- 响应无图片 / bl 的 saved 为空:提示响应中未包含图片
- 无法打开图片:报告图片路径，用户可手动打开

## References 地图

- `references/providers.md`：provider×model 路由规则、族→推荐映射、合法集、bl/grsapi 参数与落盘差异、resolve 输出 schema；需理解/排障路由时;模型上下线同步时
- `references/prompting.md`：提示词原则:结构、具体性策略、增强边界、文字渲染、参考图、迭代、不变量；提示词笼统需增强时;edit 模式
- `references/draft-iteration.md`：抽卡迭代工作流:每轮默认 2 张独立调用、变体命名、多参考图角色标注、约束累积块、定稿改比例以选定稿重抽；抽卡触发词命中时必读
- `references/sample-prompts.md`：按用例分类(产品样机/UI 样机/信息图/广告等)的完整提示词配方；需要参考完整配方时
- `references/analysis-framework.md`：三层视觉分析框架(核心视觉/风格技法/认知叙事)+ 风格定义、镜头参数、负面提示词、权重、画幅技巧；prompt 模式必读
- `references/model-formats.md`：Banana/Qwen-Image/Midjourney/SD/FLUX/DALL-E 格式适配 + model→格式自动选择映射；prompt 模式必读;按 model 选格式时
- `references/prompt-banana.md`、`references/prompt-qwen-image.md`：完整格式示例；按目标 model 选读
- `references/transparent.md`：透明背景色键工作流、提示词模板、验证清单、复杂主体判断（含 provider 路由指向）；transparent 模式必读
- `references/anti-render.md`：理想vs现实对比子工作流:状态判定、9 领域识别、五维(光影/材质/色彩/氛围/构图)对比框架、对比图排列与分割线规范；anti-render 模式或对比图触发词命中时必读
- `references/2026-06-11-grsapi-image-models.md`：grsapi 46 个图像模型的端点速查表；grsapi 内部端点选择/切换时
- `references/2026-06-11-grsapi-models.json`：493 个模型原始清单；速查表未覆盖时
