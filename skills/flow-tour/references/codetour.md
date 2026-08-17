# flow-tour：CodeTour-only 模式工作流

用于只生成 VS Code CodeTour 配置文件（`.vscode/tours/<taskname>.tour`），不构建 Web 教学页面。

## 适用场景

- 项目本身就是学习材料，不需要额外 UI。
- 想直接在 VS Code 里通过 CodeTour 插件浏览代码。
- 项目不是 Nuxt/Vue 生态，无法复用 `pages/dev/*.vue` 模板。

## 产物清单

- `docs/thoughts/<taskname>-tour-thoughts.md`：教学叙事与锚点猜想
- `config/tour/<tour-name>TourSteps.ts`：步骤定义（无 patch/GUI）
- `scripts/tour-marker-resolver.ts`：marker 扫描与 .tour 生成共享模块
- `scripts/resolve-<tour-name>-tour-markers.ts` 或 `scripts/resolve-<project>-tours.ts`：薄 CLI 或多 tour 集中注册
- `scripts/tsconfig.json`：脚本自包含 tsconfig
- `tests/unit/tour/<tour-name>TourMarkers.spec.ts`：marker 新鲜性 + .tour 完整性测试
- `.vscode/tours/<taskname>.tour`：CodeTour 产物
- `docs/reviews/<taskname>-tour-review/*`：外部审查产物
- `docs/reports/<taskname>-tour-report.md`：最终报告

## 步骤定义约定

- `codeLocations` 必须**恰好包含一个** marker id。一个 step 如果需要两个锚点才能讲清楚，说明这个 step 该拆成两个。
- 不需要 `patch` 和 `TourGuiFolders.ts`；可以把 `patch` 留空或从接口中移除。
- marker id 仍建议 `{feature}-{subfeature}-{concept}` 三段式。

## Workflow

0. **初始化上下文**
   - 确认目标特性已由 `flow-dev` 完成。
   - 记录 `<repo-root>`、`<original-branch>`。
   - 创建 Task 1～8。

1. **提炼教学叙事**
   - 读取 PRD / DevGoal / 代码。
   - 确定步骤顺序与每个 step 的“看到什么 + 代码在哪里”。
   - 输出 `docs/thoughts/<taskname>-tour-thoughts.md`。

2. **定义 Tour Steps**
   - 创建 `config/tour/<tour-name>TourSteps.ts`。
   - 每步：`id`、`title`、`description`（100–200 字）、`codeLocations: ["..."]`。
   - 不创建 `TourGuiFolders.ts`。

3. **步骤数据正交审查**
   - 派独立审查代理（全新上下文子代理，或外部审查 runner），**只喂步骤数据，不喂代码位置 / marker**：所有步骤的名称+简介，以及当前步骤的 name / description /（如有）glossary / techniques。
   - 重点：步骤序列是否连贯（有无主题突跳、粒度是否均匀、命名风格是否一致）→ 据此评估当前步骤在全局中是否合理；描述是否可迁移 how-to、一读就懂。
   - CodeTour-only 无参数面板，不审查参数；发现问题（尤其排序/拆分）回 Step 2 调整后重跑。口径详见 SKILL.md「步骤数据正交审查」节。

4. **插入 Marker**
   - 在源码关键行插入 `// flow-tour-marker: <id>`。
   - 锚点应贴近判断、赋值、调用等“真正起作用”的代码，避免函数入口。
   - 一个 marker 只出现一次。
   - 文件类型与注释语法：`.vue` 的 script 用 `//`、template 用 `<!-- flow-tour-marker: <id> -->`
     （放元素开始标签上一行，attribute 内无法插注释）；`.css` 用 `/* flow-tour-marker: <id> */`。
   - marker id 限定 `[\w-]+`（kebab/下划线），与 resolver 各语法分支的接受字符集一致。

5. **编写 Resolver**
   - 创建/复用 `scripts/tour-marker-resolver.ts`。
   - 按扩展名选择 marker 正则：`//`（代码）、`#`（TOML）、JSON 伪 key、`/* */`（CSS）、
     `.vue` 双语法（script 用 `//`、template 用 `<!-- -->`）；id 字符集统一 `[\w-]+`。
   - 重复 marker 直接抛错；`codeLocations.length !== 1` 直接抛错。
   - 单 tour：创建 `scripts/resolve-<tour-name>-tour-markers.ts`。
   - 多 tour：创建 `scripts/resolve-<project>-tours.ts`，用 `TOURS[]` 集中注册。
   - `package.json` 添加 `sync:<project>-tours` 脚本，可接入 `predev` / `prebuild`。

6. **跳过页面构建**
   - CodeTour-only 模式不创建 `pages/dev/<tour-name>-tour.vue`。

7. **守护测试**
   - 每个 marker 都能解析。
   - 已入库 `.tour` 的 step 数等于 `TourSteps` 长度。
   - 已入库 `.tour` 的 `file` / `line` 与实时扫描一致。
   - 示例断言：
     ```ts
     const tourFile = JSON.parse(readFileSync(".vscode/tours/<taskname>.tour", "utf-8"));
     expect(tourFile.steps.length).toBe(<TourName>TourSteps.length);
     ```

8. **外部正交审查（轻量）**
   - 发起外部正交审查（子代理或 runner），重点检查：
     1. 每个 step 是否只对应一个 marker。
     2. `.tour` step 数是否等于定义数。
     3. marker 是否锚在真正体现技术难点的代码行。
     4. 跨 tour 复用 marker 是否导致学习路径重复。

9. **验证与报告**
   - `pnpm test` 通过。
   - `pnpm exec tsc --noEmit` 无类型错误。
   - 人工读取 `.vscode/tours/<taskname>.tour` 确认结构与顺序。
   - 可选：在 VS Code 里安装 CodeTour 插件实际运行一遍。
   - 写 `docs/reports/<taskname>-tour-report.md`。
   - 给出垂直切片提交建议。

## 常见陷阱（CodeTour-only 特供）

- **一个 step 多个 marker**：会导致 `.tour` 出现重复 step。已用 resolver 校验拦截。
- **marker 放在函数入口**：学习者跳过去只看到签名。应锚到具体逻辑行。
- **跨 tour 复用 marker 造成重复讲解**：如果 overview 和 deep tour 都指向同一行，学习顺序上会冗余。
- **产物未入库**：`.vscode/tours/*.tour` 必须加入版本控制。
- **把 patch/GUI 概念带进来**：CodeTour-only 没有参数面板，不需要 `TourGuiFolders.ts`。
