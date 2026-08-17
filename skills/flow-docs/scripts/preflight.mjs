#!/usr/bin/env node
/**
 * flow-docs 初始化前的 Preflight 自检，以 --mode 分流三条 Workflow：
 *
 * - gsd（默认，向后兼容）：确认当前是 GSD 项目（.planning/meta.yaml 存在）、
 *   gsd-codebase-mapper agent 可用、gsd-sdk 命令可注入 agent-skills、git 仓库上下文。
 * - factcheck：确认 node、搜索工具 CLI、输入合法性（URL 格式 / 文件存在）。
 * - sourcemap：确认 node、git 仓库（源码锚点按 git root 解析）、大纲文件存在；
 *   探测 VS Code 系编辑器 CLI（优先序与 flow-tour「代码位置跳转」一致：
 *   Insiders → Cursor → Windsurf → VS Code），缺失仅告警——视觉抽查可降级
 *   sed -n 文本抽查，不阻断流程。
 * - translate：确认 node、tp CLI 与 franc 依赖就位（缺失给出 pnpm install 恢复
 *   命令）、--input 项目路径存在。git 上下文按子模式分级：非 git 项目仅告警
 *   （T-1 可用，仅跳过分支/提交/打标）；--sub update 时 upstream remote 与
 *   translation/cn 分支是硬条件，缺失即失败。目标项目按 --input 解析（git -C），
 *   不要求等于 cwd。
 *   不探测 open-websearch / glm-*：它们是 MCP 工具，脚本层不可见，只能运行时降级；
 *   「工具链全线失败 → 停止」是 Workflow 运行时红线，不是 preflight 职责。
 *   deepseek-search 缺失只进 warnings 不阻断：搜索通道有多路备份
 *   （deepseek-search / open-websearch / glm-* / flow-web），单一 CLI 缺席不等于全线不可用。
 *
 * 失败时以非零退出码返回，并打印 JSON 汇总供调用方解析。
 *
 * gsd-sdk 通常是 zsh function，须经 `zsh -c 'source ~/.zshrc 2>/dev/null; ...'` 加载
 * profile 后检测；在 bash 或未加载 zsh profile 的 shell 中 `command -v gsd-sdk` 会返回空，
 * 不代表环境缺失。不用 `zsh -ic`——交互模式在无 TTY 子进程里触发 powerlevel10k
 * gitstatus 初始化失败（实测报 can't change option: monitor），stderr 噪音之外
 * 还可能致 function 加载不全、误报缺失。
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const HOME = homedir();

// ---- 参数解析 ----

const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const mode = argValue("--mode") ?? "gsd";
if (mode !== "gsd" && mode !== "factcheck" && mode !== "sourcemap" && mode !== "translate") {
  console.log(
    JSON.stringify({ ok: false, mode, errors: [`未知 --mode: ${mode}（支持 gsd | factcheck | sourcemap | translate）`] }, null, 2),
  );
  process.exit(1);
}

function tryExec(cmd) {
  try {
    return execSync(cmd, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 8000,
    }).trim();
  } catch {
    return null;
  }
}

function finish(result) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

// ---- gsd 模式：结构与旧版完全一致 ----

function runGsd() {
  const result = {
    ok: true,
    versions: {},
    git: {},
    gsd: {},
    errors: [],
  };

  function fail(message) {
    result.ok = false;
    result.errors.push(message);
  }

  // 1. node
  const nodeVersion = tryExec("node --version");
  result.versions.node = nodeVersion;
  if (!nodeVersion) fail("环境检查失败: node");

  // 2. git 仓库
  const gitRoot = tryExec("git rev-parse --show-toplevel");
  result.git.root = gitRoot;
  if (!gitRoot) fail("当前不在 git 仓库内");

  // 3. GSD 项目结构：.planning/meta.yaml
  if (gitRoot) {
    const metaPath = path.join(gitRoot, ".planning", "meta.yaml");
    const metaExists = existsSync(metaPath);
    result.gsd.metaPath = metaPath;
    result.gsd.metaExists = metaExists;
    if (!metaExists) {
      fail("非 GSD 项目：缺失 .planning/meta.yaml，首次生成请走 gsd-map-codebase 或 flow-dx");
    }
  }

  // 4. gsd-codebase-mapper agent
  const mapperPath = path.join(HOME, ".claude", "agents", "gsd-codebase-mapper.md");
  result.gsd.mapperPath = mapperPath;
  result.gsd.mapperExists = existsSync(mapperPath);
  if (!result.gsd.mapperExists) {
    fail("缺失 agent: gsd-codebase-mapper");
  }

  // 5. gsd-sdk 命令（zsh function / binary）
  const gsdSdk = tryExec("zsh -c 'source ~/.zshrc 2>/dev/null; command -v gsd-sdk'");
  result.gsd.gsdSdk = Boolean(gsdSdk);
  if (!gsdSdk) {
    fail("缺失命令: gsd-sdk（用于注入 agent-skills 到 mapper prompt）");
  }

  finish(result);
}

// ---- factcheck 模式 ----

function runFactcheck() {
  const result = {
    ok: true,
    mode: "factcheck",
    versions: {},
    tools: {},
    input: {},
    warnings: [],
    errors: [],
  };

  const fail = (message) => {
    result.ok = false;
    result.errors.push(message);
  };
  const warn = (message) => result.warnings.push(message);

  // 1. node
  result.versions.node = tryExec("node --version");
  if (!result.versions.node) fail("环境检查失败: node");

  // 2. 搜索工具 CLI（缺失仅告警，理由见文件头注释）
  const deepseekSearch = tryExec("command -v deepseek-search");
  result.tools.deepseekSearch = Boolean(deepseekSearch);
  if (!deepseekSearch) {
    warn("deepseek-search CLI 不可用，将回退 open-websearch / glm-* / flow-web 通道");
  }

  // 3. 输入合法性：URL 校验格式（不发请求），疑似路径校验存在性，其余视为论断句
  const input = argValue("--input");
  if (!input) {
    result.input.kind = "none";
    warn("未收到 --input，将从会话上下文解析核查对象");
  } else if (/^https?:\/\//i.test(input)) {
    try {
      result.input.kind = "url";
      result.input.url = new URL(input).href;
    } catch {
      fail(`URL 无法解析: ${input}`);
    }
  } else if (!/\s/.test(input) && (input.includes("/") || /\.(md|txt|html?)$/i.test(input))) {
    const abs = path.resolve(input);
    result.input.kind = "file";
    result.input.path = abs;
    if (!existsSync(abs)) fail(`文件不存在: ${abs}`);
  } else {
    result.input.kind = "claim";
  }

  finish(result);
}

// ---- sourcemap 模式 ----

function runSourcemap() {
  const result = {
    ok: true,
    mode: "sourcemap",
    versions: {},
    git: {},
    input: {},
    editor: {},
    warnings: [],
    errors: [],
  };

  const fail = (message) => {
    result.ok = false;
    result.errors.push(message);
  };
  const warn = (message) => result.warnings.push(message);

  // 1. node
  result.versions.node = tryExec("node --version");
  if (!result.versions.node) fail("环境检查失败: node");

  // 2. git 仓库：源码锚点（/src/... 式仓库根绝对路径）由 verify-anchors.mjs 按 git root 解析
  const gitRoot = tryExec("git rev-parse --show-toplevel");
  result.git.root = gitRoot;
  if (!gitRoot) fail("当前不在 git 仓库内（源码锚点按 git root 解析，非 git 目录无法校验）");

  // 3. 大纲文件
  const input = argValue("--input");
  if (!input) {
    result.input.kind = "none";
    warn("未收到 --input，将从会话上下文解析大纲文件");
  } else {
    const abs = path.resolve(input);
    result.input.kind = "outline";
    result.input.path = abs;
    if (!existsSync(abs)) fail(`大纲文件不存在: ${abs}`);
  }

  // 4. 编辑器 CLI 探测：优先序与 flow-tour references/website.md「代码位置跳转」一致
  //    （Insiders → Cursor → Windsurf → VS Code）；缺失仅告警，视觉抽查降级 sed -n 文本抽查
  const candidates = ["code-insiders", "cursor", "windsurf", "code"];
  result.editor.candidates = candidates;
  result.editor.cli = candidates.find((cli) => tryExec(`command -v ${cli}`)) ?? null;
  if (!result.editor.cli) {
    warn("未检测到 VS Code 系编辑器 CLI，锚点视觉抽查将降级为 sed -n 文本抽查");
  }

  finish(result);
}

// ---- translate 模式 ----

function runTranslate() {
  const result = {
    ok: true,
    mode: "translate",
    versions: {},
    tp: {},
    project: {},
    warnings: [],
    errors: [],
  };

  const fail = (message) => {
    result.ok = false;
    result.errors.push(message);
  };
  const warn = (message) => result.warnings.push(message);

  // 1. node
  result.versions.node = tryExec("node --version");
  if (!result.versions.node) fail("环境检查失败: node");

  // 2. tp CLI 与 franc 依赖（flow-docs 内部脚本，按技能部署位置解析）
  const tpRoot = path.join(HOME, ".claude", "skills", "flow-docs", "scripts", "tp");
  const tpCli = path.join(tpRoot, "tp.js");
  result.tp.cli = tpCli;
  result.tp.cliExists = existsSync(tpCli);
  if (!result.tp.cliExists) fail(`缺失 tp CLI: ${tpCli}`);

  const francDir = path.join(tpRoot, "node_modules", "franc");
  result.tp.franc = existsSync(francDir);
  if (!result.tp.franc) {
    fail("franc 语言检测依赖缺失，恢复命令: cd ~/.claude/skills/flow-docs/scripts/tp && pnpm install");
  }

  // 3. 目标项目：--input 缺省回退 cwd；git 上下文用 git -C 探测，不要求等于 cwd
  const input = argValue("--input");
  const proj = path.resolve(input ?? process.cwd());
  result.project.path = proj;
  if (!existsSync(proj)) {
    fail(`项目路径不存在: ${proj}`);
    finish(result);
  }

  const gitRoot = tryExec(`git -C "${proj}" rev-parse --show-toplevel`);
  result.project.gitRoot = gitRoot;
  if (!gitRoot) {
    warn("目标不是 git 仓库：T-1 可用，但将跳过分支/提交/打标；T-2 不可用");
  }

  // 4. update 子模式硬条件：upstream remote + translation/cn 分支
  const sub = argValue("--sub") ?? "translate";
  result.project.sub = sub;
  if (sub === "update") {
    if (!gitRoot) {
      fail("T-2 上游对齐要求目标是 git 仓库");
    } else {
      const remotes = tryExec(`git -C "${proj}" remote`) ?? "";
      result.project.hasUpstream = remotes.split("\n").includes("upstream");
      if (!result.project.hasUpstream) fail("T-2 要求配置 upstream remote");

      const branch = tryExec(`git -C "${proj}" branch --show-current`);
      result.project.branch = branch;
      if (branch !== "translation/cn") fail(`T-2 要求当前分支为 translation/cn（当前: ${branch || "(detached)"}）`);
    }
  } else if (sub !== "translate") {
    fail(`未知 --sub: ${sub}（支持 translate | update）`);
  }

  finish(result);
}

if (mode === "gsd") runGsd();
else if (mode === "factcheck") runFactcheck();
else if (mode === "sourcemap") runSourcemap();
else runTranslate();
