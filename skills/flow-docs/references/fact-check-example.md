# 完整示例报告（standard 档）

由 flow-docs Workflow B Step 4 调起，需参考核查报告的详略与语气时选读。源自原 deep-fact-check 示例（Gary Marcus「Promises are cheap」，核查于 2026-02-13），判定标记已适配三态 notation，伪量化残留已删除。

# 事实核查报告：「Promises are cheap」by Gary Marcus

## 执行摘要

**元数据**：

- 原文链接：https://garymarcus.substack.com/p/promises-are-cheap
- 原文作者：Gary Marcus（纽约大学心理学与神经科学荣誉教授，AI 评论家）
- 发布时间：2026-02-12；核查时间：2026-02-13

**可信度评级**：🟡 **B 级 — 部分可信，需补充语境**（L1 基本准确，L2 存在选择性呈现）

**核心结论**：
本文在经验事实层面（L1）基本准确，但在解释性框架（L2）和归因层面存在选择性呈现。作者作为知名 AI 怀疑论者，系统性强调 AI 技术的局限性，对行业进步保持沉默。这种偏见并非通过捏造事实实现，而是经由**选择性报道**与**竞争框架忽略**完成。

**发现速览**：

- ✅ 准确属实：数量 5；示例 112→914 幻觉案例增长、特斯拉市盈率约 400 倍
- ⚠️ 无法核实：数量 1；示例 Kevin Scott「blow away PhDs」引语
- 🔴 操控手法命中：数量 2；示例 选择性报道、归因简化

**行动建议**：数据类论断可直接引用；趋势判断需补充作者怀疑立场与被其忽略的正面证据。

## 详细发现

### ✅ CONFIRMED：Hinton 放射科医生预言（引语类论断）

**原文**：
> "A decade ago, Geoff Hinton, then working for Google, said 'We should stop training radiologists now…'"

**证据链**：

- 引语出处：Hinton 2016 年公开演讲，完整表述为 "People should stop training radiologists now. It's just completely obvious that within five years deep learning is going to do better than radiologists" [T1，多个独立来源交叉验证]
- Hinton 当时确在 Google 任职（2013-2023）[T1]
- 放射科现状：2025 年美国诊断放射科住院医师项目提供 1,208 个职位，同比增长 4%；劳工统计局预测 2024-2034 就业增长 5%，高于全职业平均 [T2]
- 时间线更新：Hinton 2025 年向《纽约时报》邮件承认 2016 年言论 "spoken too broadly"——原文未提及这一反思，可能让读者误以为他坚持原观点

### ✅ CONFIRMED：特斯拉市盈率近 400 倍（数字类论断）

**原文**：
> "Tesla trades at nearly 400 times earnings not because they have ever made all that much money, but because Elon is a master of hype."

**证据链**：

- MacroTrends 389.34（2026-02-12）、Public.com 398.02（2026-02-11），多源交叉确认约 400 倍 [T1]
- 历史对比：5 年平均约 185 倍、10 年平均约 176 倍；同期福特约 11-12 倍、通用约 12-24 倍 [T1]
- **L2 标注**：将高市盈率归因于 "master of hype" 是解释性论断——高 PE 同样可能反映自动驾驶/机器人业务预期与市场地位，单一归因属于竞争框架选择

### 其余 CONFIRMED 速览

- 律师 LLM 幻觉案例 112→914：Charlotin 数据库实测 914 例，914÷112≈8.16；时间跨度约 9-10 个月，符合 "less than a year"
- Remote Labor Index 2.5%：CAIS 与 Scale AI 联合发布（2025-12），Manus AI 完成 2.5%；注意：测的是完整项目端到端自动化率而非单任务辅助——原文 "online tasks" 措辞易误导
- Caltech/Stanford LLM 推理研究：arXiv《Large Language Model Reasoning Failures》2026-02-09，第一作者 Peiyang Song（Caltech），"just documented" 准确

### ⚠️ PLAUSIBLE：Kevin Scott "blow away PhDs" 引语（TX 信源）

**原文**：
> "Suleyman's colleague Kevin Scott hinted that GPT-5 would blow away PhDs"

**搜索过程**：遍查 Kevin Scott（Microsoft CTO）公开演讲、博客与采访，**未找到**他直接说 GPT-5 会 "blow away PhDs" 的确切引语。他 2022 年说过 "you don't need to have a PhD in computer science anymore to build an AI application"——那是关于 **AI 开发民主化**，而非 GPT-5 能力描述。

**竞争性解释**：

- 框架 A（原文）：Kevin Scott 做出了过度承诺
- 框架 B：引语被断章取义或转述变形，原意是技术门槛降低
- 框架 C：引语来自非公开场合，无法验证

**判定**：PLAUSIBLE（无法独立核实，TX 信源等级）。**升级路径**：若原始场合的录音或文字记录出现，可重新判定。

## 操控手法识别

### 选择性报道（Cherry Picking）

**检测**：原文系统性强调 AI 失败案例（幻觉、推理错误、预测失败），完全忽略 AI 的实际进展。

**沉默的证据**：

- FDA 已批准 **1,041 个** AI 赋能的放射科医疗设备 [T2]
- 放射科医生使用 AI 后阅片时间缩短、处理能力提升 27-98% [T2]
- AI 未取代放射科医生，而是改变了其工作方式（从单纯阅片转向沟通与决策支持）

**认知影响**：利用**确认偏误**（Confirmation Bias），读者倾向接受符合「AI 被过度炒作」预设的信息，不察觉遗漏的正面进展。

### 其余命中速览

- 框架效应 — 全文将 AI 行业框定为 "hype" / "cheap promises"：呈现最悲观框架，忽略同样合理的「预期管理」「投资驱动」框架（L3 观点，非事实错误）
- 归因简化 — 特斯拉高 PE 单一归因 "master of hype"：因果简化（Causal Oversimplification）：忽略自动驾驶/机器人/能源业务的共同作用

## 作者偏见分析

Gary Marcus 是知名 AI 怀疑论者，主张混合架构，历史上多次批评行业过度承诺，本文与既往立场一致性高。系统性强调失败案例/预测错误/财务风险，系统性忽略应用成功/技术突破/社会贡献；负面词汇密度高（"hype"、"cheap"、"collapses"），讽刺语气明显。承认核心事实准确，但选择性呈现，且未透明标注观点属性。

## 证伪条件与更新协议

以下新证据将改变本报告结论：

1. Kevin Scott 确实在公开场合说过 GPT-5 会 "blow away PhDs" → 修正该引语可信度
2. Charlotin 数据库案例数被证实有显著统计误差 → 修正 112→914 增长评估
3. Remote Labor Index 方法论被学界广泛质疑 → 修正 2.5% 数据可靠性

**持续监测指标**：AI 代理真实工作场景自动化率变化、律师幻觉案例增长趋势、放射科就业市场长期趋势。

## 方法论说明

- **核查限制**：无法访问付费墙内容（如 FT 对 Suleyman 的完整采访）；无法验证内部会议或非公开谈话引语；基于 2026-02-13 的公开信息
- **搜索预算**：各论断均在预算内完成，无截断
- **来源分级**：T1 = Charlotin 数据库、arXiv 论文、公司财报、政府统计；T2 = MarketBeat、Reuters、Bloomberg、CNN、NYT；TX = 无法核实引语（Kevin Scott 例）

**伦理声明**：本核查旨在提升信息质量，不构成对原文作者的全面否定。Gary Marcus 的核心关切——AI 行业存在过度承诺、媒体缺乏批判性报道——是合理且值得重视的公共议题。

## 参考来源

[^charlotin]: [Damien Charlotin, *Hallucinations database*](https://damiencharlotin.com/hallucinations): 律师 LLM 幻觉案例实时计数（T1）
[^rli]: [Center for AI Safety, *Remote Labor Index*](https://www.safe.ai/announcing-the-remote-labor-index): AI 端到端项目自动化率测试（T2）
[^hinton-nyt]: [The New York Times, *Hinton 邮件回应*](https://www.nytimes.com/): Hinton 承认 2016 年言论 "spoken too broadly"（T2）
[^tesla-pe]: [MacroTrends, *Tesla PE Ratio*](https://www.macrotrends.net/stocks/charts/TSLA/tesla/pe-ratio): 历史与当前市盈率（T1）
[^llm-reasoning]: [Song et al., *Large Language Model Reasoning Failures*](https://arxiv.org/): Caltech/Stanford，2026-02-09（T1）
[^fda-ai]: [FDA, *AI-Enabled Medical Devices Database*](https://www.fda.gov/medical-devices/software-medical-device-samd/artificial-intelligence-and-machine-learning-aiml-enabled-medical-devices): 获批放射科 AI 设备计数（T2）
