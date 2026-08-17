# SKILL.md 规范校验手册（--lint）

lint.mjs 的规则主体逐条移植自 VSCode 内置校验器 `promptValidator.ts`（chat/common/promptSyntax，仓库 `zRefs/vscode` 有稀疏检出可溯源），剔除依赖 GitHub Copilot 设置的「context: fork 需开 skillTool」一条；另含一条本仓文档约定规则 `no-tables`（非移植）。级别语义：error 阻断（退出码 1，YAML 层面已坏，Claude Code 的解析器同样读不出）；warning 建议（`--strict` 时阻断）；info 仅记录，永不阻断。

## CLI

```bash
node ~/.claude/skills/flow-skill/scripts/lint.mjs <路径...> [--strict] [--json]
```

路径形态：SKILL.md 文件 / 含 SKILL.md 的技能目录 / 不含 SKILL.md 的父目录（扫描一级子目录）。退出码：0 通过；1 有 error；3 用法错误（路径缺失、无技能可校验）。

## 规则全表

- `frontmatter-structure` — error：frontmatter 缺失或未闭合；补回 `---` 围栏；注意 VSCode 对此静默跳过，本 linter 显式报错（唯一管线不能再静默）
- `name-missing` — warning：缺少 name 字段；补 `name: <kebab-case>`
- `name-not-string` — error：name 不是字符串；值改为标量，不要写成集合
- `name-empty` — error：name 为空；填名字
- `name-invalid-chars` — error：name 含小写字母/数字/连字符之外的字符；改为 kebab-case
- `name-folder-mismatch` — warning：name 与所在文件夹名不一致；二者取一改正；触发与文件定位都按文件夹名走，不一致会埋困惑
- `description-missing` — warning：缺少 description 字段；补 description（触发机制本体）
- `description-not-string` — error：description 不是字符串；值改为标量
- `description-empty` — error：description 为空；填描述
- `user-invocable-requires-description` — error：声明仅用户调用却没有 description；补 description，或重新考虑声明
- `model-invocation-requires-description` — error：显式启用模型调用却没有 description；补 description
- `argument-hint-not-string` — error：argument-hint 不是字符串——值以 `[` 或 `{` 开头被 YAML 解析成集合；给整值加双引号；不要在值前塞占位词逼它成字符串（治标不治本）
- `argument-hint-empty` — warning：argument-hint 为空；填占位提示或删掉该字段
- `user-invocable-not-boolean` — error：值不是无引号裸 `true`/`false`；去引号；带引号的 `"true"` 是字符串，运行时会得到 truthy 字符串而非布尔
- `disable-model-invocation-not-boolean` — error：同上；同上
- `metadata-version-invalid` — error：metadata.version 不是 `alpha` 或 x.y.z semver；改为两种合法形态之一（alpha 是打磨期形态，毕业走 bump.mjs）；该字段是 state.json 打标与 resume 漂移判定的机器契约，手写畸形版本会让版本比较静默失效
- `unknown-attribute` — info：字段不在 skill 标准白名单；通常无需处理：跨 runtime 共享技能时白名单外字段（如 allowed-tools）是常态
- `broken-body-link` — warning：正文 Markdown 相对链接指向的文件不存在；修链接或补文件；渐进披露的文件没被引用等于死引用（通配目录指代如 `references/x.com/*.md` 与模板占位不做静态判定）
- `no-tables` — warning：正文代码围栏外出现 Markdown 表格；改用列表承载参数/字段/对比；本仓文档约定规则，非 VSCode 移植

## 解析器的已知限制

lint 用自写行级解析器（`scripts/lint/frontmatter.mjs`）而非全量 YAML 库，换取零依赖。已知边界：

* 不支持锚点（`&`/`*`）与多行流式集合，遇到时按保守分类处理，一般由规则层报错暴露
* 顶层键必须顶格书写；错位顶格行会被跳过，表现为「字段缺失」类告警
* 行尾注释剥离要求 `#` 前有空格（YAML 语义如此，`C#` 不会被误伤）

## 接入长期值守

技能仓的 `package.json` 加一行即可让 lint 变成该仓的 test：

```json
{ "scripts": { "test": "node <path-to>/lint.mjs skills" } }
```

flow 仓自身即如此接线（自引用），可作为接线样板。
