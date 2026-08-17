# Provider 与模型路由（n×n）

flow-image 的图像出图支持两个执行后端：grsapi.xyz 与阿里云百炼（bailian / `bl` CLI）。模型与后端是多对多关系，由 `scripts/resolve_provider.mjs` 解析为单一 (provider, model) 组合。本文件是该路由的人类可读视图；精确合法模型集的权威源是 resolve 脚本，二者须在模型更新时同步。

## 两后端差异

- 鉴权：grsapi 用 `~/.config/flow-image/.env` 的 API_KEY；bailian 用 `bl auth`（控制台或 --api-key）
- 调用：grsapi 手工 `curl -s`；bailian `bl image generate` / `bl image edit`
- 默认模型：grsapi gpt-image-2；bailian qwen-image-2.0
- 响应抽取：grsapi 需 extract_images.py（GPT/Gemini 格式分裂）；bailian 不需：--out-dir 直出 PNG
- 原始响应：grsapi curl 的纯净 JSON；bailian stdout 纯净 JSON（banner 在 stderr）
- 端点路由：grsapi 按速查表"支持端点"列（dall-e-3 / image-generation / gemini generateContent / mj 异步等）；bailian 由 bl 内部处理

## 解析入口

调用 resolve 脚本，用退出码判断成功与否，用 stdout JSON 取结果：

```bash
node <skill>/scripts/resolve_provider.mjs --model <id> --provider <grsapi|bailian>
```

`--model` 与 `--provider` 均可省略，支持 `--model=<id>` 写法。退出码 0 = 解析成功，2 = 解析失败。

输出 schema（成功）：`{ ok:true, provider, model, source, note? }`，`source` ∈ `global-default` | `explicit-provider-default` | `resolved` | `explicit`。

输出 schema（失败）：`{ ok:false, error:{ code, message, suggested_provider? } }`。`code` 三类：

- `INVALID_PROVIDER`：`--provider` 不是 grsapi|bailian。
- `UNSUPPORTED_COMBO`：显式 `--provider` 与该 model 不兼容；若该 model 在另一后端可用，附 `suggested_provider`，否则省略该键。
- `UNKNOWN_MODEL`：model 不在任何已知清单且无法判定族；族偏好可推断时附 `suggested_provider`，否则省略该键。

`suggested_provider` 是可选修复提示：没有时省略键（访问为 `undefined`），消费者用 `if (error.suggested_provider)` 判断即可。

## 默认与推荐映射

零参数（无 `--model` 无 `--provider`）：grsapi + gpt-image-2，保持向后兼容，重构不改变无参默认。

仅 `--provider`：使用该后端默认模型（grsapi→gpt-image-2，bailian→qwen-image-2.0）。

族 → 推荐 provider（用于 tie-break 与报错建议，不单独决定路由）：

- qwen-image、wan：bailian
- gpt-image、gemini、mj_、kling、doubao、flux、grok、vidu、z-image、dall-e：grsapi
- 其它：未知（报错询问）

## 合法模型集

bailian 精确合法集（bl image 仅认这几个 id 串）：`qwen-image-2.0`、`qwen-image-2.0-pro`、`wan2.6-t2i`、`wan2.7-image`。

grsapi 精确合法集：见 `2026-06-11-grsapi-image-models.md` 速查表（46 行）。注意 grsapi 的 qwen/wan id 串带日期后缀或 -pro/-edit（如 `qwen-image-2.0-2026-03-03`、`wan2.7-image-pro`、`qwen-image-max`），与 bl 的 id 串不同，不可混用。

精确集以 `resolve_provider.mjs` 内置集合为准；模型上下线时改脚本，本表与速查表随之同步。

## n×n 解析规则

按优先级：

1. **精确合法集优先**：model 仅在一个后端的合法集中 → 路由到该后端。即便族前缀"偏好"另一端，也以物理可行为准（例如 `qwen-image-2.0-2026-03-03` 走 grsapi 而非 bl）。
2. **单族回退**：qwen/wan 族但 bl 不支持的精确 id（如 `qwen-image-max`）→ 回退 grsapi（grsapi 有端点），不报错。
3. **两集都命中**（极少）：按族偏好，qwen/wan→bl，其余→grsapi。
4. **显式 --provider**：严格校验，不支持即 `UNSUPPORTED_COMBO`，不静默回退（尊重显式意图）。
5. **两集都未命中**：`UNKNOWN_MODEL` 报错询问，避免把未核实 id 静默发往后端。

## 调用参数差异

bailian（`bl image generate` / `edit`）：`--prompt` 必填；`--model`；`--size` 取比例（`1:1`、`16:9`、`3:4`）或像素（`W*H`，如 `2048*2048`）；`--n`（≤6）；`--seed`；`--negative-prompt`；`--watermark true|false`；`--out-dir`；`--out-prefix`；`--output json`。flow-image 的 bl 分支用 sync（不加 `--async`），与"一次返回、不重试"纪律一致。

bl 的 stdout 在 `--output json` 时为纯净 JSON `{ urls, saved, total }`：`saved` 是已落盘的本地绝对路径数组，`urls` 是 OSS 临时链（48h）。元信息行 `[Model: x] [Mode: sync]` 在 stderr，因此 `bl ... --output json > resp.json` 得到的 resp.json 是纯净 JSON，可直接 `json.load` 验证，与 grsapi 的 `curl -s` 同构。

grsapi：size 由端点与模型决定（gpt-image 默认 `1792x1024` 等，见 SKILL.md 的 curl 模板）；其余沿用现状。

## 保存与落盘

落盘根目录：`~/.flow-image/<YYYY-MM-DD>/<provider-seg>/<model>/`。provider-seg：grsapi 沿用 `grsapi.xyz`（不破坏既有产物路径），bailian 用 `bailian`。

grsapi：原始响应存 `<hh-mm-ss.sss>.json` → `extract_images.py` 提取 → `wait_for_file.sh` 等待写入。

bailian：bl 已 `--out-dir` 落盘 PNG；将 bl 的 stdout（`--output json`）存为 `<hh-mm-ss.sss>.json` 作为原始响应；从该 JSON 的 `saved` 数组读产物路径（不需 `extract_images.py`）；`wait_for_file.sh` 可作防御保留。

## 与提示词格式的关系

提示词格式按 model 选择（见 `model-formats.md` 的 model→格式映射），与 provider 路由正交但同受 model 影响：prompt 模式与 gen 增强时，先用 resolve 得到 model，再据 model 选格式（如 `qwen-image*`→Qwen-Image 格式，`gemini*`→Banana，`gpt-image*`/`dall-e*`→DALL-E）。

## 同步约定

精确合法集、族前缀表、解析规则的单一可执行事实源是 `scripts/resolve_provider.mjs`（含单测）。本文件为其人类视图。bl 或 grsapi 模型上下线时：先改 resolve 脚本并跑通 `node --test`，再同步本文件的族表/合法集描述与速查表。
