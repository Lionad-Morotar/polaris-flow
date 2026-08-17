<div align="center">
  <img src="assets/share-3x4.jpg" alt="polaris-flow — 为强长程能力模型设计的开发工作流集合" width="60%" />
  <h1>polaris-flow</h1>
  <p><strong>✨ 为强长程能力模型设计的开发工作流集合 ✨</strong></p>
  <p>
    <a href="https://github.com/Lionad-Morotar/polaris-flow/tags"><img src="https://img.shields.io/badge/version-0.1.0--alpha.0-blue" alt="version" /></a>
  </p>
</div>

为强长程能力模型设计的开发工作流集合，覆盖开发、图像生成、知识提炼、北极星循环、UI 还原、教学 tour 与开发者体验等工作流，以及 git、文档、应用手册三类入口。

## 前置条件

- Node.js 18+（安装走 `npx`）
- 一个支持 Agent Skills 的编码代理，如 Claude Code、Codex；安装由 [skills](https://skills.sh) CLI 完成，它会负责把技能接入你的客户端
- 强长程能力与强指令遵循的模型。本套技能的设计取向是让单个强模型独立跑完长流程，减少对多代理编排的依赖；小体量模型（如 deepseek-v4-flash）可能无法获得预期效果

## 安装

```bash
npx skills add -g Lionad-Morotar/polaris-flow --all
```

- `-g` 安装到用户级，所有项目可用；去掉则只装进当前项目
- `--all` 一次性安装全部技能；去掉后进入交互式挑选

验证安装：

```bash
npx skills ls
```

列表中出现 `flow-dev` 等技能即为成功。

## 快速上手

装完后先尝试浅浅尝试一下技能触发：

```plaintext
/flow-tour 在 /tmp/firewood 给 https://github.com/shapiro500/screentoys/blob/main/firewood/index.html 制作 web tour
```

不确定某个技能怎么用，直接问 Agent：`help flow-dev`。本仓库不附带独立帮助手册，每个技能的用法都写在技能本体里，Agent 会读给你听。

## 我该用哪个技能

| 我想… | 用这个 |
| --- | --- |
| 开发功能、修 bug，走完整工业流程 | `/flow-dev` |
| 审查手头这坨 diff | `/flow-code-review` |
| 叫另一个模型来做正交审查 | `/flow-agent` |
| 把设计稿还原成页面 | `/flow-ui-ralph` |
| 让项目按节奏自动推进 | `/flow-polaris` |
| 生成、编辑图片，或转绘画提示词 | `/flow-image` |
| 沉淀踩坑知识、查以前的解法 | `/flow-mem` |
| 整理 git 提交、推送前质量门禁 | `/flow-git` |

## 技能清单

成熟度：无标记为打磨中，其余见行内标注。

**开发流程**

- `/flow-dev {要求}`（稳定）— 开发主流程：需求拆解 → TDD Dev → Review → 验证，收尾维护记忆与文档
- `/flow-polaris`（试验）— 北极星循环：在 production-ready 项目上配置 cadence，自动驱动「目标分解 → slice 产出 → 合并累积 → 验收发版」
- `/flow-ui-ralph {要求}`（试验）— UI 还原迭代：视觉分析 + 浏览器验证，还原度收敛至 99%+；无设计稿时先生成设计再还原
- `/flow-code-review {要求}` — 基于 CC CodeReview 按 effort 档位对 diff 做多角度审查（finder → dedup/verify → sweep）
- `/flow-agent <target> --task "<模型与内容描述>"` — 外部正交审查：按 effort 启动一个或多个异模型做快速外部检查（启动器链为本机配置）
- `/flow-dx {要求}` — 优化项目开发者体验（DX）：幂等初始化工作环境与工程基建

**生成与教学**

- `/flow-image {描述或图片路径}` — 图像生成/编辑、图片转提示词、透明背景抠图；双 provider 自动路由
- `/flow-tour {要求}`（稳定） — 构建交互式分步教学（网站或 CodeTour）

**知识与检索**

- `/flow-distill {要求}` — 知识提炼与归档
- `/flow-search [docs|content|research] {目标}` — 搜索三分支：技术文档溯源 / 转载反查一手出处 / 系统性深度调研
- `/flow-mem [--learn[--ask]|--search] {来源或关键词}`（试验）— 技术知识库维护与检索：--learn 沉淀知识（--ask 先出规划报告再落笔）/ --search 按 h4 标题或全文检索

**仓库维护**

- `/flow-git` — git 统一入口：默认分批提交 / --rebase 重组历史 / --retime 重写时间戳 / --push 推送质量门禁 / --init 安装 git hooks
- `/flow-docs [sync|check|map|translate] {主题}` — 文档四分支：GSD 代码库同步 / 对抗性事实核查 / 源码映射报告 / 项目翻译
- `/flow-code [--show|--scan]` — 代码库元架构维护：--show 近期变动报告（趋势前置、按任务分组）/ --scan 全仓坏味道扫描
- `/flow-skill [--create|--lint] {技能名或需求}` — 技能工程：从零创建新技能（薄壳 SKILL.md + 渐进披露 + preflight 预检）/ SKILL.md 规范 lint

**应用与系统**

- `/flow-app [应用域] [任务]` — 应用级操作手册与任务手册，按应用域分册（含 Claude Code 会话状态跟踪与 --wait 等待）
- `/flow-os <topic>` — 系统环境维护路由：claude-providers 多账号配置 / fix-vscode-rg 搜索防卡死 / disk-health 硬盘健康（本机账册不随仓分发）
- `/flow-web` — 浏览器自动化：Kimi WebBridge 封装，操控真实浏览器（站点 playbook 为本地积累，不随仓分发）

## 常见问题

IDE 不支持 SlashCommand 怎么办？

在提示词前加上技能前缀即可：

```plaintext
使用 flow-dev 技能，{你的要求}
```

这会明确触发技能并让 AI 遵循技能内文档化的模式。不加前缀时触发是否稳定，取决于你的提示词与技能描述关键词的匹配程度。

为什么有些配置装完是缺的？

本机配置不随仓分发：`flow-agent` 的启动器链（`configs/launchers.json`）与 `flow-os` 的 provider 账册（`configs/providers.local.md`）为本机私有配置，gitignore 排除，克隆后按 `configs/launchers.example.json` 模板与手册自建；`flow-web` 的站点 playbook 同为本地积累。

## 注意

- 强依赖 mattpocock/skills 以及参考了部分 Claude Code 的系统提示。
- 没有经过充分测试，但显然仍有相当大的优化空间。

## 维护

每个技能有独立版本号（frontmatter `metadata.version` + CHANGELOG.md + `<skill>@<version>` tag 三处落点）。改版统一走 `pnpm bump <skill> [patch|minor|major|x.y.z] "<CHANGELOG 条目>"`，禁止手工分头改。规范详见 `skills/flow-skill/references/create-skill.md` 的「版本化约定」。

## 反馈与许可

问题与建议请提 [Issue](https://github.com/Lionad-Morotar/polaris-flow/issues)。本项目以 [MIT](./LICENSE) 协议开源。
