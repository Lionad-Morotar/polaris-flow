---
name: flow-distill
description: 知识提炼与归档流程
metadata:
  version: 0.1.0-alpha.0
---

## 要求

* 本技能输出的文档默认不进入 git
* 严格按照流程执行，如果碰到以下阻塞按照清单解决问题：
  * 进入了计划模式，生成了计划：你应当自动确认计划（注意，并非不做计划！而是先计划然后自动确认）
  * 有决策需要我确认：我的回答永远是 “按照文档高标准质量决定”
  * **不要暂停**：完成所有阶段，而不是分阶段汇报向我确认，get all shits done
* **务必按照要求读取执行对应技能**：即 `~/.claude/skills/<skill-name>/SKILL.md`

## Workflow

0. 使用 Task 工具创建并跟踪整个流程

   先运行 `node ~/.claude/skills/flow-distill/scripts/preflight.mjs` 自检（依赖技能 get-secrets、distill-and-archive 与 node 可用），失败则停止并报告。

   再创建以下任务（description 应包含对应步骤的核心目标和检查项）：

   - `flow-distill: 捕获 RawContent`
   - `flow-distill: 执行 get-secrets`
   - `flow-distill: 质量审核`
   - `flow-distill: 执行 distill-and-archive`
   - `flow-distill: 输出归档计划`
   - `flow-distill: 写入与提交`
   - `flow-distill: 输出归档报告`

   执行规则：
   - 每步开始前，用 `TaskUpdate` 将对应任务标记为 `in_progress`
   - 每步完成后，用 `TaskUpdate` 将对应任务标记为 `completed`
   - 若某步失败或被阻塞，创建新任务描述阻塞点，并立即按本 SKILL.md「要求」节的规则解决（自动确认计划、自动决策、不要暂停）
   - 全部完成后，所有任务应处于 `completed` 状态

   注意：`Skill` 工具调用某些 skill 时可能只加载上下文而不真正进入后台执行。若发现 `get-secrets` 或 `distill-and-archive` 调用后没有创建后台任务、没有返回实质结果，不要等待，立即手动执行对应 SKILL.md 中描述的工作流。

1. 从用户输入或上下文，捕获我想提炼的原始内容 RawContent
  - [ ] 已明确原始内容的来源（文件路径 / URL / 会话上下文）
  - [ ] 已读取对应片段或内容

2. 针对 RawContent 执行 `get-secrets` 技能，提炼出 **1-4 条**真正的 Secrets
  - [ ] 已读取 `~/.cs/get-secrets/SKILL.md`
  - [ ] `get-secrets` 已通过 2-3 轮搜索补充与用户内容相关的机制、版本差异、踩坑与 trade-off
  - [ ] 已输出 1-4 条标准格式的进阶知识；若材料过浅则输出 0 条并停止
  - [ ] 每条知识都经过极简验证，且不是对用户原文或文档的直接转述

2.5. **质量审核（Quality Gate）**
  - [ ] 追问 1：这条知识官方文档会直接告诉你吗？如果是，丢弃或降级；例外：文档有但容易被忽略、且与具体失败场景结合的，可以保留
  - [ ] 追问 2：这条知识有具体的失败场景或反直觉机制吗？如果没有，丢弃
  - [ ] 合并核心观点重复或近似的知识
  - [ ] 如果审核后剩余 0 条，停止流程并提示用户补充具体参数、踩坑经历、版本差异或反直觉机制

3. 将通过审核的 1-4 条知识作为 `distill-and-archive` 的输入，执行 `distill-and-archive` 技能
  - [ ] 已读取 `~/.cs/distill-and-archive/SKILL.md`
  - [ ] 已调研笔记系统结构并确定 Topic 文件
  - [ ] 已为每个知识点确定插入锚点
  - [ ] 已明确每个 `####` 四级标题对应一个原子知识点，归档后只保留一个 `见：` 来源

4. 输出完整归档计划
  - [ ] 包含四层定位表格（Domain → Subdomain → Topic → 四级标题）
  - [ ] 包含每个知识点的正文草稿
  - [ ] 包含文件变更清单
  - [ ] 包含引用来源说明
  - [ ] 已校验不放入入口/索引文件、不切断引用边界

5. 自动确认归档计划并执行写入与提交
  - [ ] 已完整展示归档计划
  - [ ] 已模拟“用户确认”并继续执行
  - [ ] 已按归档计划写入文件
  - [ ] 已更新子领域索引文件（若新建 Topic 文件，如 `content/6.maps/_ai/ai.md`）
  - [ ] 已执行语法检查（重点校验引号方向与配对：中文左双引号 `“` / 右双引号 `”`、英文引号、ASCII 直双引号混用等）
  - [ ] 已校验每个 `####` 知识点只有一个 `见：` 来源，且放在知识点末尾、独立成行
  - [ ] 已使用 lint 针对修改的文件执行检查（非全量）：`node <blog-repo>/scripts/lint-md.mjs`（默认检查 git 工作区中新增或修改的 Markdown 文件；`<blog-repo>` 为笔记站的 Markdown lint 脚本路径，按环境替换）
  - [ ] 已执行 git commit

6. 在终端直接输出归档报告（不写入文件）
  - [ ] 包含原始内容来源
  - [ ] 包含实际归档的 N 条知识标题
  - [ ] 包含归档位置
  - [ ] 包含 git commit message

## 归档报告输出模板

终端直接输出以下结构，不写入文件：

```
## 归档报告

**原始内容来源**：[文章标题](文章 URL)（作者 / 机构，日期）

**N 条归档知识**：

1. <知识标题 1>
2. <知识标题 2>
...
N. <知识标题 N>

**归档位置**：
- Topic 文件：<文件路径>
- 索引更新：<索引文件路径>（如适用）

**git commit message**：`<完整 commit message>`
```

7. 任务结束，清空 Tasks

   归档报告输出后，检查所有任务是否已标记为 `completed`。若仍有任务处于 `in_progress`，立即用 `TaskUpdate` 将其更新为 `completed`。确保流程结束时任务列表中无未完成的 flow-distill 相关任务。
