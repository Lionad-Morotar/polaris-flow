---
name: flow-skill
description: 技能工程入口。分支 A：--create——从零创建新的 agent 技能：需求 gathering、结构设计（薄 SKILL.md + 渐进披露 references + 确定性 scripts）、起草、部署符号链接、评审验收。分支 B：--lint——校验 SKILL.md frontmatter 规范（移植 VSCode 内置校验规则：字段类型、无引号裸布尔、name 与文件夹一致、正文断链等）。当用户说「创建技能」「写个技能」「新建 skill」「构建 skill」「做个 skill」「write-a-skill」「lint 技能」「校验 skill」「skill 检查」「flow-skill」「--create」「--lint」时触发
argument-hint: <技能名或需求描述> [--create] | --lint <路径...> [--strict] [--json]
disable-model-invocation: true
metadata:
  version: 0.1.0-alpha.0
---

# flow-skill：技能工程入口

## 要求

* 意图路由先行：分支 A（--create）与分支 B（--lint）；其他 `--*` 模式报错并列出合法值后停止。
* 渐进披露：按文末「References 地图」在 Workflow 阶段中按需加载，禁止初始化时一口气全读。
* 薄壳纪律：创建出的技能其 SKILL.md 只放路由 + workflow 骨架，细则一律进 references/。
* 强调纪律：非必要不使用「**」着重号；单个技能的「**」总量应小于（文件数 × 10）。
* 输出中文。

## 意图路由

- 显式 `--create` 前缀；无参调用；「创建 / 新建 / 写个 / 做个」+ 技能需求：A 创建技能；Workflow A
- 显式 `--lint` 前缀；「lint / 校验 / 检查」+ 技能或 SKILL.md：B 规范校验；Workflow B
- `--review`、`--retire` 等其他 `--*` 模式：不适用；报错并列出合法值（`--create`、`--lint`）后停止

与相邻技能的边界：

- flow-skill 解决「从零做出一个技能」；已有技能的代码质量优化走 flow-code-review。
- 老技能退役并入属于手工流程，暂无专用模式；退役前的质量盘点可借用 flow-code-review。
- 与官方 skill-creator 的区别：本技能是定制流程——本地化归属决策、flow 家族薄壳范式、符号链接部署、中文触发词约定。

## 外部依赖入口

- preflight.mjs — node 脚本：`node ~/.claude/skills/flow-skill/scripts/preflight.mjs --mode create [--input <技能名>] [--target <目录>]`，退出码决定流程生死
- lint.mjs — node 脚本：`node ~/.claude/skills/flow-skill/scripts/lint.mjs <路径...> [--strict] [--json]`，退出码 0/1/3 定性校验结果
- 技能创建方法论 — 文档：`references/create-skill.md`

## Workflow A：创建技能

0. 初始化
   - [ ] 解析参数：`--create` 为默认且当前唯一模式；其余 `--*` 模式报错停止；`<技能名或需求描述>` 记为 `<input>`
   - [ ] Preflight：`node ~/.claude/skills/flow-skill/scripts/preflight.mjs --mode create [--input <技能名>]`（`<input>` 是合法 kebab-case 技能名时传入，否则留空由 Step 1 澄清）
   - [ ] 若 preflight 报告同名碰撞（`collisions[]` 非空）→ 问我：并入 / 改进既有技能（终止本流程），还是改名继续创建
1. 需求 gathering（决定技能边界，不可跳过）
   - [ ] 读 `references/create-skill.md` 需求四问：任务领域 / 用例与触发词 / 是否需要脚本 / 可并入的参考材料
   - [ ] 按归属决策树确定落点：flow 子模块（工作流族 `flow-*`）/ 独立技能目录 / 个人技能目录
2. 结构设计
   - [ ] 判定薄厚：SKILL.md 预期超 100 行 → 薄壳 + references 拆分；按确定性判据决定是否要 scripts/
   - [ ] 起草 description：第三人称，首句功能、次句「Use when」触发词（中文话语为主，并入旧技能时带上旧名）
3. 起草
   - [ ] 建目录骨架，按模板写 SKILL.md；需要时写 references/ 与 scripts/（脚本参考 preflight 范式：退出码定性 + JSON 汇总）
   - [ ] 强调自检：全技能 Markdown 文件「**」出现总量 < 文件数 × 10，自检命令见 `references/create-skill.md`
4. 部署与登记
   - [ ] 符号链接到 `~/.claude/skills/<name>`，用 `readlink` 确认链接指向实际目录、无悬空
   - [ ] 落点为 flow 子模块时：在 `flow/README.md` 技能表新增一行
5. 评审验收
   - [ ] 按 `references/create-skill.md` Review Checklist 逐项自检
   - [ ] 冒烟：disable-model-invocation 技能以 `/<name>` 直接调用验证触发；有 preflight 时正常与异常路径各跑一遍
   - [ ] 向我报告：技能路径、部署链接、触发词清单、强调自检结果

## Workflow B：规范校验（--lint）

无 preflight——lint.mjs 自校验输入路径（退出码 3 报用法错误），符合「环境事实归 preflight、输入校验归脚本」的分工。

0. 初始化
   - [ ] 解析参数：`--lint` 后的路径列表记为 `<paths>`；省略时默认校验调用方项目的 `skills/` 目录（不存在则报错停止）
   - [ ] `--strict`、`--json` 透传给 lint.mjs
1. 执行校验
   - [ ] `node ~/.claude/skills/flow-skill/scripts/lint.mjs <paths...> [--strict] [--json]`
   - [ ] 退出码 3（用法错误）→ 停止并报告路径问题，不进入修复
2. 汇总与修复建议
   - [ ] 按 `references/lint-skill.md` 的规则表把每条 finding 映射到修法，按技能分组报告
   - [ ] error 是阻断项（YAML 层面已坏，Claude Code 同样读不出），warning/info 是建议项；修复前先问我，不擅自改技能
3. 复验
   - [ ] 修复后重跑 lint.mjs 确认归零；涉及多技能仓时建议把 lint 接进对方的 test 脚本长期值守

## 红线与故障恢复

- preflight 非零退出 → 停止并报告，禁止强行创建。
- 永不覆盖既有同名技能：碰撞路径必须经我确认，默认动作是改名或并入，不是覆写。
- 触发词不许虚构：description 中的触发话语须来自我的实际表达习惯或约定俗成说法。
- 符号链接悬空或指错 → 立即重做，不留半成品部署。

## References 地图

- `references/create-skill.md`：需求四问、归属决策树、目录结构约定、SKILL.md 模板与 frontmatter 规范、description 规范、脚本与拆分判据、渐进披露与强调纪律、Review Checklist；Workflow A Step 1 必读；Step 2–3、Step 5 回查
- `references/lint-skill.md`：校验规则全表（id / 级别 / 含义 / 修法）、CLI 用法与退出码、移植出处与解析器已知限制；Workflow B Step 2 必读
- `references/consistency-review.md`：技能族一致性审查手册（八维 rubric、机械检查清单、类型流行病学、正面模式）；批量审查技能或单技能大修后自查时读
