# VSCode 壳色彩执行手册（Peacock）

独立按需参考：不由 SKILL.md Workflow 调起，不参与 preflight 盘点与 Ask 收口。用户要求"为项目匹配/修改 VSCode 编辑器壳色彩"时读本手册直接执行，执行完即结束——本任务不产出 report。

## 前提

已装 Peacock 扩展（`johnpapa.vscode-peacock`）。

## 工作步骤

### 1. 取色相

找项目的 CSS（设计 token、`--color-primary`）、代码或品牌文件（设计规范、logo、README），提取最具辨识度的品牌色相（hue）。只取色相，不带入原色的明度与饱和度。

注意，**优先找品牌标识，而不是技术栈标识**，比如在一个 Vue 测试项目使用 Vue Green 是纯粹的无奈的选择。

### 2. 生成新颜色

以该色相合成新颜色：HSL 饱和度（S）与明度（L）锚定 `#f6ec91`（≈ 54°/85%/77%），各允许 ±10% 误差——容差即生成空间，品牌色 S/L 落在区间内可直接沿用。

```bash
# 生成色相扫描色板（S/L 锚定 #f6ec91，容差默认 ±10%）
node skills/flow-dx/scripts/peacock-match.mjs

# 校验候选色是否落在容差内
node skills/flow-dx/scripts/peacock-match.mjs --verify '#f0d264'
```

### 3. 应用

在 `.vscode/settings.json` 写入 `"peacock.color": "<hex>"` 一处即可。`workbench.colorCustomizations` 整块是 Peacock 由 `peacock.color` 生成的派生：扩展激活时自动补全，手算或预写会在重新生成时被覆盖——不要碰派生块。

### 4. 验证

```bash
jq empty .vscode/settings.json && echo "✓ 合法"
git check-ignore -v .vscode/settings.json   # 命中即被忽略，属预期：编辑器个性化，不入库
```
