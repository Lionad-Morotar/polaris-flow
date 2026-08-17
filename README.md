<div align="center">
  <img src="assets/share-3x4.jpg" alt="polaris-flow — 为强长程能力模型设计的开发工作流集合" width="60%" />
  <h1>polaris-flow</h1>
  <p><strong>✨ 为强长程能力模型设计的开发工作流集合 ✨</strong></p>
  <p>
    <a href="https://github.com/Lionad-Morotar/polaris-flow/tags"><img src="https://img.shields.io/badge/version-0.1.0--alpha.0-blue" alt="version" /></a>
  </p>
</div>

为强长程能力模型设计的开发工作流集合，覆盖开发、图像生成、知识提炼、北极星循环、UI 还原、教学 tour 与开发者体验等工作流，以及 git、文档、应用手册三类入口。

## 安装

```bash
npx skills add -g Lionad-Morotar/polaris-flow --all
```

`--all` 用于一次性安装本仓库中的全部 skill。

## 使用

1. **技能成熟度：`flow-dev` 已成熟稳定；其余技能仍在打磨，其中 `flow-polaris`、`flow-ui-ralph`、`flow-mem` 仍处于试验期。**
2. 目前不附带帮助手册，你可以使用 “help flow-xxx” 的形式让 Agent 教你如何使用某项技能。
3. 暂未开放：`flow-agent`（外部模型正交审查启动器）与 `flow-os`（系统环境维护）为本机私有技能，含账号配置与内部环境细节，不随开源仓分发；`flow-web` 技能本体已随仓分发，其站点 playbook 为本地积累，不随仓分发。

**开发流程**

- `/flow-dev {要求}` — 开发主流程：需求拆解 → TDD Dev → Review → 验证，收尾维护记忆与文档
- `/flow-polaris` — 北极星循环：在 production-ready 项目上配置 cadence，自动驱动「目标分解 → slice 产出 → 合并累积 → 验收发版」
- `/flow-ui-ralph {要求}` — UI 还原迭代：视觉分析 + 浏览器验证，还原度收敛至 99%+；无设计稿时先生成设计再还原
- `/flow-code-review {要求}` — 基于 CC CodeReview 按 effort 档位对 diff 做多角度审查（finder → dedup/verify → sweep）
- `/flow-dx {要求}` — 优化项目开发者体验（DX）：幂等初始化工作环境与工程基建

**生成与教学**

- `/flow-image {描述或图片路径}` — 图像生成/编辑、图片转提示词、透明背景抠图；双 provider 自动路由
- `/flow-tour {要求}` — 构建交互式分步教学（网站或 CodeTour）

**知识与检索**

- `/flow-distill {要求}` — 知识提炼与归档
- `/flow-search [docs|content|research] {目标}` — 搜索三分支：技术文档溯源 / 转载反查一手出处 / 系统性深度调研
- `/flow-mem [--learn[--ask]|--search] {来源或关键词}` — 技术知识库维护与检索：--learn 沉淀知识（--ask 先出规划报告再落笔）/ --search 按 h4 标题或全文检索

**仓库维护**

- `/flow-git` — git 统一入口：默认分批提交 / --rebase 重组历史 / --retime 重写时间戳 / --push 推送质量门禁 / --init 安装 git hooks
- `/flow-docs [sync|check|map|translate] {主题}` — 文档四分支：GSD 代码库同步 / 对抗性事实核查 / 源码映射报告 / 项目翻译
- `/flow-code [--show|--scan]` — 代码库元架构维护：--show 近期变动报告（趋势前置、按任务分组）/ --scan 全仓坏味道扫描
- `/flow-skill [--create|--lint] {技能名或需求}` — 技能工程：从零创建新技能（薄壳 SKILL.md + 渐进披露 + preflight 预检）/ SKILL.md 规范 lint

**应用手册**

- `/flow-app [应用域] [任务]` — 应用级操作手册与任务手册，按应用域分册（含 Claude Code 会话状态跟踪与 --wait 等待）
- `/flow-web` — 浏览器自动化：Kimi WebBridge 封装，操控真实浏览器（站点 playbook 为本地积累，不随仓分发）

如果你的 IDE 不支持 SlashCommand，那么为了获得最可靠的结果，需要提示词前加上前缀，比如：

```plaintext
使用 flow-dev 技能，{你的要求}
```

这会明确触发技能并确保 AI 遵循文档化的模式。如果不加前缀，技能触发可能不一致，具体取决于你的提示词与技能描述关键词的匹配程度。

## 注意

- 本技能专为强长程能力和强指令遵循能力的模型设计，以减少对 Dynamic Graph 和 Teams 的依赖。在小体量的模型如 deepseek-v4-flash 可能无法获得预期效果。

## 维护

每个技能有独立版本号（frontmatter `metadata.version` + CHANGELOG.md + `<skill>@<version>` tag 三处落点）。改版统一走 `pnpm bump <skill> [patch|minor|major|x.y.z] "<CHANGELOG 条目>"`，禁止手工分头改。规范详见 `skills/flow-skill/references/create-skill.md` 的「版本化约定」。
