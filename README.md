<p align="center">
  <img src="assets/banner.jpg" alt="flow-skills — 北极星指引下的 flow 技能集合" width="100%">
</p>

# flow-skills

为强长程能力模型设计的开发工作流集合，覆盖开发、图像生成、知识提炼、北极星循环、UI 还原、教学 tour 与开发者体验等工作流，以及 git、文档、应用手册三类入口。

## 安装

```bash
npx skills add -g Lionad-Morotar/flow-skills --all
```

`--all` 用于一次性安装本仓库中的全部 skill。

## 使用

**技能成熟度：`flow-dev` 已成熟稳定；其余技能仍在打磨，其中 `flow-polaris`、`flow-ui-ralph`、`flow-mem` 仍处于试验期。**

- `/flow-dev {你的要求}` — 代码开发流程
- `/flow-image {描述或图片路径}` — 图像生成/编辑、图片转提示词、透明背景抠图
- `/flow-distill {你的要求}` — 知识提炼与归档流程
- `/flow-polaris` — 在 production-ready 项目上配置 cadence 自动驱动开发循环
- `/flow-tour {你的要求}` — 构建交互式分步教学(网站或 CodeTour)
- `/flow-ui-ralph {你的要求}` — UI 还原迭代流程,支持无设计稿时先生成设计再还原
- `/flow-dx {你的要求}` — 优化项目开发者体验(DX)
- `/flow-code [--show [recent]]` — 代码库元架构维护入口:--show 总结近期变动(趋势前置、按任务分组的近况报告)
- `/flow-code-review {你的要求}` — 按 effort 档位对 diff 做多角度审查(finder → dedup/verify → sweep)
- `/flow-git` — git 统一入口:分批提交、整理提交历史、重写时间戳、推送质量门禁
- `/flow-docs [sync|check|map|translate] {主题}` — 四分支文档：GSD 代码库同步 / 对抗性事实核查 / 源码映射深化报告 / 项目翻译（原 translating-project）
- `/flow-search [docs|content|research] {目标}` — 三分支搜索：技术文档依据 / 转载反查一手出处 / 系统性深度调研
- `/flow-skill [--create|--lint] {技能名或需求}` — 技能工程入口：从零创建新技能（薄壳 SKILL.md + 渐进披露 + preflight 预检）；SKILL.md 规范 lint（移植 VSCode 校验规则）
- `/flow-mem [--learn[--ask]|--search] {内容来源或关键词}` — 框架知识库入口：--learn 从会话/运行产物沉淀知识并增删改查维护（--ask 先出规划报告经确认后落笔），--search 按 h4 或全文检索
- `/flow-app [<应用域>] [<任务>]` — 应用级操作手册与任务手册(按应用域分册;claude-code 域含会话状态跟踪:行数探针判推进、--wait 等待会话结束)

如果你的 IDE 不支持 SlashCommand，那么为了获得最可靠的结果，需要提示词前加上前缀，比如：

```plaintext
使用 flow-dev 技能，{你的要求}
```

这会明确触发技能并确保 AI 遵循文档化的模式。如果不加前缀，技能触发可能不一致，具体取决于你的提示词与技能描述关键词的匹配程度。

## 维护

每个技能有独立版本号（frontmatter `metadata.version` + CHANGELOG.md + `<skill>@<version>` tag 三处落点）。改版统一走 `pnpm bump <skill> [patch|minor|major|x.y.z] "<CHANGELOG 条目>"`，禁止手工分头改。规范详见 `skills/flow-skill/references/create-skill.md` 的「版本化约定」。
