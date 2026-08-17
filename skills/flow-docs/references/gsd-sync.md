# GSD 文档同步执行手册

由 SKILL.md Workflow Step 1–3 调起。定义 gsd-codebase-mapper 调用契约、`.planning/meta.yaml` schema、文档指纹计算协议，以及原 update-gsd 常驻冷却机制的设计背景。

## gsd-codebase-mapper 调用契约

- **subagent_type**：字符串字面量 `gsd-codebase-mapper`（不要用 `Explore` 或 `general-purpose`）
- **工具权限**：Read / Bash / Grep / Glob / Write（无 Edit，但 Write 足够新建 / 覆盖）
- **并行**：4 个 focus 同时 spawn（`run_in_background: true`）

### Prompt 硬性格式

```
Focus: {tech|arch|quality|concerns}
Today's date: {YYYY-MM-DD}

[参考代码变更的语义描述：git diff <from>...HEAD 的 stat 概要 + 主要变更点，不贴整 diff]

根据参考代码变更，使用中文，极端克制地补充或修复对应 .planning/codebase/*.md。
只改因代码变更而过期的内容，不重写未变部分。Write documents directly. Return confirmation only.
{gsd-sdk query agent-skills 的输出}
```

- 第 1 行必须是 `Focus: <area>`（四选一）
- 第 2 行必须是 `Today's date: <YYYY-MM-DD>`（agent 不自行推断日期）
- 尾部追加 `gsd-sdk query agent-skills` 的输出

### focus → 文档映射

- `tech`：`.planning/codebase/STACK.md`、`INTEGRATIONS.md`
- `arch`：`.planning/codebase/ARCHITECTURE.md`、`STRUCTURE.md`
- `quality`：`.planning/codebase/CONVENTIONS.md`、`TESTING.md`
- `concerns`：`.planning/codebase/CONCERNS.md`

### 子代理返回

agent 直接 `Write` 到对应 `.md`，返回给主代理**≤10 行确认块**（严禁回贴文档内容）：

```
## Mapping Complete
**Focus:** {focus}
**Documents written:**
- `.planning/codebase/{DOC1}.md` ({N} lines)
Ready for orchestrator summary.
```

agent **严禁自行 git commit**。

## `.planning/meta.yaml` schema

```yaml
codebase:
  hash: <32 或 64 hex>     # 文档内容指纹（见下方计算协议），不是 git short-hash
  from: <7-char hex>       # git commit short-hash（git rev-parse --short HEAD）
  updated_at: <ISO 8601>   # 本次同步时间
```

`.planning/codebase/` 固定 7 文件：`ARCHITECTURE.md`、`CONCERNS.md`、`CONVENTIONS.md`、`INTEGRATIONS.md`、`STACK.md`、`STRUCTURE.md`、`TESTING.md`。

> **字段语义修正**：原 `update-gsd` 技能把「更新 hash 为 HEAD short-hash」写反了——`hash` 始终存文档内容指纹，`from` 才存 commit short-hash。本技能已修正：同步后 `hash` ← 新文档指纹，`from` ← HEAD short-hash。
>
> 另：原技能全文把目录名拼成 `.panning`，正确为 `.planning`。

## 文档指纹计算协议

`$doc_hash` = `.planning/codebase/*.md` 按**固定字母序**拼接内容后的 sha256：

```bash
cat .planning/codebase/ARCHITECTURE.md .planning/codebase/CONCERNS.md .planning/codebase/CONVENTIONS.md .planning/codebase/INTEGRATIONS.md .planning/codebase/STACK.md .planning/codebase/STRUCTURE.md .planning/codebase/TESTING.md 2>/dev/null | shasum -a 256 | awk '{print $1}'
```

缺失的文件按空串参与拼接（`2>/dev/null` 容错，不报错）。`$doc_hash` 与 `meta.yaml.codebase.hash` 不一致 → 文档过期。

## 常驻冷却机制（设计背景）

原 `update-gsd` 是常驻监听：启动时设 60±10 分钟定时器，每次 git commit / rebase / cherry-pick 重置定时器，到期后若 `$isOld` 才触发更新。flow-docs 作为**按需调用**的 skill，退化为「检查 → 过期则更新」的即时语义，不再维护常驻定时器。如需常驻场景，由调用方（如 flow-polaris 或 hook）周期性触发 flow-docs。

## docs 索引完整性校验

`.planning/codebase/` 文档更新后（Workflow A Step 4），跑 `verify-docs-index.mjs` 强制两条不变量：

1. 无孤儿文档：`docs/` 下每个 markdown（排除 `adr/`、`agents/domain.md`、gitignored）都必须在 `.planning/codebase/*.md` 或 `CLAUDE.md` 中被 inline 链接引用。
2. 禁引 gitignore 目标：索引源中指向仓库内 `.md`/`.markdown`/`.mdx` 的链接，目标不得被 gitignore。

排除依据：

- `adr/`：决策记录自编号索引（`0001-...`），独立成体系，不纳入结构化文档。
- `agents/domain.md`：技能领域文档，自足。
- gitignored：`plans/`、`reports/`、`reviews/`、`dissections/`、`research/`、`thoughts/`、`ui/` 等 flow-dev / flow-code-review 切片产物，按日期命名自索引、不入版本控制。用 `git check-ignore` 实时判定，不硬编码目录名——gitignore 变更自动生效。

CLAUDE.md 角色：CLAUDE.md 是合法索引承载源（在 CLAUDE.md 引用算合规），但脚本不单独要求其覆盖率——「不禁止但不必保证」。

脚本契约：`node ~/.claude/skills/flow-docs/scripts/verify-docs-index.mjs [--root <path>] [--docs <rel>] [--codebase <rel>] [--claude <rel>]`，JSON 输出，`ok=false` 或退出码 1 即有违规。`unindexed[]` 列孤儿文档路径；`gitignoredRefs[]` 列违规引用（含 source 文件 + 行号 + target，便于定位）。只校验 inline 链接 `[label](target)`，跳过代码围栏 / 行内代码 / 外链 / 纯锚点。

## 边界情况

- `<from>` 为空（meta.yaml 无 codebase.from）：参考代码不限定锚点，mapper 全量审视；但通常意味着首次同步未完成，提示走 gsd-map-codebase
- `.planning/codebase/*.md` 全缺失：非 GSD 项目或未初始化，preflight 已拦截
- mapper 某个 focus 失败：保留成功的 focus 更新，失败 focus 记录；不刷新 meta.yaml.hash（保持 isOld，下次重试）
- `git diff <from>...HEAD` 为空（无代码变更）：`$isOld` 应为 false（文档未变），除非文档被手动改过；`--force` 可强制重跑
