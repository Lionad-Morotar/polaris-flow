# 质量门禁推送执行手册（push 模式）

由 SKILL.md Workflow Step 4 调起。推送前自动运行项目配置的代码质量检查（lint、format、test、check-types），检测到可自动修复的问题时修复，修复成功后继续推送。遵循「检测 → 修复 → 再检测 → 推送」循环，直到通过或无法自动修复。

由主代理直接执行（原 git-push 委托 general-purpose subagent，flow-git 改为主代理直接操作，流程短且需观察中间结果）。

## 执行步骤

### 1. 检测变更

```bash
git status --porcelain
git diff --name-only --cached
git diff --name-only
```

无变更 → 返回「无变更需要推送」并停止。

### 2. 检测项目配置的检查工具（按优先级）

1. **package.json scripts**（最优先）：`npm run lint`、`npm run format`（或 `format -- --check`）、`npm run test`、`npm run check-types`
2. **配置文件检测**（无 scripts 时）：ESLint（`.eslintrc.*` / `eslint.config.*`）、Prettier（`.prettierrc.*` / `prettier.config.*`）、TypeScript（`tsconfig.json`）、Biome（`biome.json`）、Ruff（`pyproject.toml`，Python）

执行策略：并行执行独立检查（如 lint + check-types），记录每个结果。

### 3. 自动修复（可修复的问题）

- ESLint：`npm run lint -- --fix` 或 `npx eslint --fix`
- Prettier：`npm run format` 或 `npx prettier --write`
- Biome：`npx biome check --write`
- Ruff：`ruff check --fix`

修复后：重新运行检查确认 → `git add -A` 暂存修复结果。**最多 2 轮**（安全红线）。

**不可自动修复**：测试失败（需理解业务）、类型错误（可能需重构）、复杂 lint 错误（未使用变量涉及业务逻辑）→ 停止自动修复，准备报告。

### 4. 推送（检查全部通过）

```bash
git push
```

首次推送新分支：

```bash
git push -u origin <branch-name>
```

若 `--dry-run`：只打印检测与修复计划，不执行 push。

## 异常处理

- 非快进推送（non-fast-forward）：报告需先 pull / rebase
- 分支保护（protected branch）：报告需创建 Pull Request
- 网络错误：重试 1 次，仍失败则报告
- 修复循环：最多 2 轮，超出则报告无法自动修复的问题

## 返回

- **推送成功**：说明推送的分支与 commit
- **需要手动修复**：列出无法自动修复的具体问题与修复建议
- **推送失败**：说明失败原因与解决建议
- **无变更**：说明无变更需要推送
