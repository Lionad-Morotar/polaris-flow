# 目标模型提示词格式(prompt 模式)

按目标 AI 绘画工具适配提示词格式与输出要求。

## 输出要求

- 每个请求默认只输出**中文版本**,专业术语后标注英文(如:赛博朋克(Cyberpunk)、景深(Depth of field))。仅在用户明确要求英文版本时才输出英文版本
- 直接输出提示词(```plaintext\n<提示词>\n```)即可
- 中文版本的**专业术语后标注英文**,如:
  - 艺术风格(如:赛博朋克(Cyberpunk)、巴洛克(Baroque))
  - 技术术语(如:景深(Depth of field)、三分法(Rule of thirds))
  - 材质/纹理(如:厚涂(Impasto)、丝网印刷(Screen printing))
- 总的来说,提示词不应超过 2000 字

## 各模型格式

- **Banana(默认)**:不写负面提示词;提示词总数在 1000 字左右,参考 `prompt-banana.md`
- **Qwen-Image**:提示词在 500 字左右,参考 `prompt-qwen-image.md`
- **Midjourney**:添加 `--ar [比例]`、`--stylize [值]`、`--v 6` 等参数
- **SD/FLUX**:添加负面提示词(negative prompt)
- **DALL-E**:描述更加自然语言化

## model → 格式自动选择

当指定了 model（经 `resolve_provider.mjs` 解析）时，提示词格式按 model 族自动选择，覆盖上面的"默认 Banana"。该选择与 provider 路由正交，但同受 model 驱动；prompt 模式与 gen/edit 的提示词增强均适用。

- qwen-image：Qwen-Image（约 500 字，参考 `prompt-qwen-image.md`）
- gemini：Banana（约 1000 字，参考 `prompt-banana.md`）
- gpt-image、dall-e：DALL-E（描述更自然语言化）
- mj_：Midjourney（带 `--ar` / `--stylize` / `--v` 等参数）
- flux、sd：SD/FLUX（带负面提示词）
- 其它 / 未指定：Banana（默认）

未指定 model 时沿用默认 Banana。bl 后端的 qwen-image 模型务必使用 Qwen-Image 格式，以获得最佳的文字渲染与结构化描述响应。
