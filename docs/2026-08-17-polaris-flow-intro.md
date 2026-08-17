# 别再每个会话重新教 AI 干活了：我把开发流程固化成了 18 个技能

> polaris-flow 开源推广文，面向掘金/公众号等中文技术社区。正文即稿件，发布时配 `assets/share-7x5.jpg` 作封面。

用 AI 写代码超过三个月的人，大抵都攒过一份"个人提示词"：告诉它怎么拆需求、先写测试再实现、提交前跑哪些检查、commit message 用什么格式。

这份提示词通常躺在笔记软件里，越攒越长。每次开新会话，复制、粘贴、祈祷它这次能遵守到最后。上下文一断，流程就散；模型一换，从头再来。

问题不在模型记性差，在于我们把"流程"存错了地方。流程不该是会话里的一次性消耗品，它应该是可复用的资产。

## 把流程写成技能

Agent Skills 是 Claude Code、Codex 等编码代理都支持的一种扩展机制：一个技能就是一个带触发描述的 markdown 包，agent 识别到匹配场景时自动加载，按文档化的模式执行。

于是那份越攒越长的提示词有了正经去处——拆成一个个技能，各管一段流程，需要时才加载。

polaris-flow 就是我给自己攒的一整套技能集合，最近整理开源了：

```bash
npx skills add -g Lionad-Morotar/polaris-flow --all
```

一条命令装完全部 18 个技能，覆盖开发、审查、图像、知识管理、仓库维护五个域。

## 设计取向：让强模型跑长流程

市面上的多代理框架（multi-agent orchestration）热衷把任务拆给一堆代理并行跑，再用调度器拼装结果。polaris-flow 走了另一个方向：为强长程能力（long-horizon）和强指令遵循的模型设计，让单个强模型按文档化流程独立跑完长任务，减少对动态编排的依赖。

道理很朴素：编排层每多一跳，信息就衰减一层。如果模型本身能记住流程、遵守纪律，最可靠的编排就是把流程写清楚。

代价也诚实：小体量模型跑不动这套技能，比如 deepseek-v4-flash 这个档位就很难获得预期效果。这是一个面向强模型的工作流集合，不是通用方案。

## 三个主打技能

### flow-dev：一条命令走完工业流程

```plaintext
/flow-dev 给用户系统加登录限流
```

它会走完一条完整链路：需求拆解（grill 式追问把模糊需求问清楚）→ PRD → TDD 垂直切片开发（每个切片都是完整可运行的功能）→ 多角度代码审查 → 验证收尾，最后顺手维护知识库和文档。

零散需求进来，工业制品出来。中间每一步都有落盘文档，随时可以中断恢复。

### flow-polaris：北极星循环，项目自动驾驶

这是最有实验性的一个。在项目上配置一个 cadence（比如每小时），它会自动循环：读北极星目标 → 分解 epic → 调度开发技能产出功能切片 → 合并累积 → 攒够一个 minor 版本就停下来等你验收发版。

挂着它，项目会自己往前拱。你负责定目标和验收，它负责中间的脏活。

### flow-mem：踩过的坑不再踩第二次

```plaintext
/flow-mem --learn    # 从这次会话沉淀知识
/flow-mem --search rg 参数陷阱   # 查以前怎么解决的
```

技术知识库的维护与检索入口。反复调试才定位的坑、核实验证过的方案、被纠正过的偏好，都会按域归档。flow-dev 开工前会自动预搜索知识库，收尾时自动沉淀——知识在生产闭环里自然积累，不靠自觉。

## 全景速览

| 域 | 技能 |
| --- | --- |
| 开发流程 | flow-dev（稳定）、flow-polaris、flow-ui-ralph、flow-code-review、flow-agent、flow-dx |
| 生成与教学 | flow-image、flow-tour |
| 知识与检索 | flow-distill、flow-search、flow-mem |
| 仓库维护 | flow-git、flow-docs、flow-code、flow-skill |
| 应用与系统 | flow-app、flow-os、flow-web |

几个值得一提的边角：flow-agent 会拉一个异模型来做正交审查，专治"自己查自己查不出"；flow-ui-ralph 把设计稿还原度迭代收敛到 99% 以上；flow-git 把分批提交、历史重组、推送门禁收拢成一个入口。

成熟度实话实说：flow-dev 已经稳定，其余多在打磨中，flow-polaris、flow-ui-ralph、flow-mem 还在试验期。这不是一个打磨完美的产品，是一套正在每天使用的工具。

## 上手

前置条件只有三样：Node.js 18+、一个支持 Agent Skills 的编码代理（Claude Code、Codex 均可）、一个够强的模型。

```bash
# 安装（-g 用户级，--all 全部技能）
npx skills add -g Lionad-Morotar/polaris-flow --all

# 验证
npx skills ls
```

装完拿零副作用的技能试触发：`/flow-mem --search 任意关键词`。不确定某个技能怎么用，直接问 agent：`help flow-dev`，它会读技能本体给你听。

如果你的 IDE 不支持 SlashCommand，在提示词前加一句"使用 flow-dev 技能，{你的要求}"即可明确触发。

## 最后

这套技能强依赖 mattpocock/skills 开创的生态，也参考了 Claude Code 的部分系统提示设计。没有经过充分测试，显然还有相当大的优化空间——但每个技能都在真实项目上跑着，迭代很快。

如果你也受够了每个会话重复教 AI 干活，欢迎试试。Issue 区敞开，觉得有用就点个 Star。

GitHub: https://github.com/Lionad-Morotar/polaris-flow
