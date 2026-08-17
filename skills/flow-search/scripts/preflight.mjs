#!/usr/bin/env node
/**
 * flow-search 初始化前的 Preflight 自检，以 --mode 分流三条 Workflow：
 *
 * - docs：文档溯源。确认 node 可用；git 仓库上下文缺失仅告警不阻断
 *   （项目内约定只是三层查找的第一层，溯源常在非仓库目录发起，如「这个 Nuxt 配置官方依据」）。
 * - content：内容溯源。确认 node、搜索工具 CLI、输入合法性（URL 格式 / 截图文件存在）。
 *   不探测 Context7 / open-websearch / glm-*：它们是 MCP 工具，脚本层不可见，只能运行时降级；
 *   「工具链全线失败 → 停止」是 Workflow 运行时红线，不是 preflight 职责。
 *   deepseek-search 缺失只进 warnings 不阻断：搜索通道有多路备份
 *   （deepseek-search / open-websearch / glm-* / flow-web），单一 CLI 缺席不等于全线不可用。
 * - research：深度研究。确认 node、搜索工具 CLI（缺失告警理由同 content）。
 *   输入是可选的研究主题句或参考 URL；无输入不阻断——brief 澄清阶段会交互式确定主题，
 *   且 URL 在此分支只是调研起点参考，不做内容溯源式的存在性强校验。
 *
 * 三个 mode 不合并为单一预检：输入语义不同——docs 的 input 是查询目标（可选、无则上下文提取），
 * content 的 input 是 URL / 截图文件 / 转述文字（含文件存在性校验），research 的 input 是主题句
 * （可选、无文件校验）。union 校验会让 content 的「文件不存在」错误误杀 docs 调用，
 * 也会让 research 的主题句被 content 的路径启发式误判为文件。
 *
 * 失败时以非零退出码返回，并打印 JSON 汇总供调用方解析。
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// ---- 参数解析 ----

const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const mode = argValue("--mode") ?? "docs";
if (mode !== "docs" && mode !== "content" && mode !== "research") {
  console.log(
    JSON.stringify({ ok: false, mode, errors: [`未知 --mode: ${mode}（支持 docs | content | research）`] }, null, 2),
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

// ---- docs 模式 ----

function runDocs() {
  const result = {
    ok: true,
    mode: "docs",
    versions: {},
    git: {},
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

  // 2. git 仓库上下文（warn-only：项目约定层只是三层之一，非溯源前置）
  const gitRoot = tryExec("git rev-parse --show-toplevel");
  result.git.root = gitRoot;
  if (!gitRoot) {
    warn("当前不在 git 仓库内，跳过项目内约定层（第一层查找），直接进入官方文档层");
  }

  // 3. 输入（可选，无则从会话上下文提取上一轮关键决策或变更）
  const input = argValue("--input");
  if (!input) {
    result.input.kind = "none";
    warn("未收到 --input，将从会话上下文提取溯源目标");
  } else {
    result.input.kind = "target";
    result.input.value = input;
  }

  finish(result);
}

// ---- content 模式 ----

function runContent() {
  const result = {
    ok: true,
    mode: "content",
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

  // 3. 输入合法性：URL 校验格式（不发请求），截图/文档路径校验存在性，其余视为转述文字
  //    图片扩展名必须在文件判定分支内，否则截图路径会被误判为转述纯文本
  const input = argValue("--input");
  if (!input) {
    result.input.kind = "none";
    warn("未收到 --input，将从会话上下文解析转载内容");
  } else if (/^https?:\/\//i.test(input)) {
    try {
      result.input.kind = "url";
      result.input.url = new URL(input).href;
    } catch {
      fail(`URL 无法解析: ${input}`);
    }
  } else if (
    !/\s/.test(input) &&
    (input.includes("/") || /\.(md|txt|html?|png|jpe?g|webp|gif)$/i.test(input))
  ) {
    const abs = path.resolve(input);
    result.input.kind = "file";
    result.input.path = abs;
    if (!existsSync(abs)) fail(`文件不存在: ${abs}`);
  } else {
    result.input.kind = "text";
  }

  finish(result);
}

// ---- research 模式 ----

function runResearch() {
  const result = {
    ok: true,
    mode: "research",
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

  // 2. 搜索工具 CLI（缺失仅告警，搜索通道有多路备份，理由同 content 模式）
  const deepseekSearch = tryExec("command -v deepseek-search");
  result.tools.deepseekSearch = Boolean(deepseekSearch);
  if (!deepseekSearch) {
    warn("deepseek-search CLI 不可用，将回退 open-websearch / glm-* / flow-web 通道");
  }

  // 3. 输入：无则 brief 阶段交互式澄清；URL 仅校验格式（调研起点参考）；其余文本视为主题句
  const input = argValue("--input");
  if (!input) {
    result.input.kind = "none";
    warn("未收到 --input，将在 brief 澄清阶段交互式确定研究主题");
  } else if (/^https?:\/\//i.test(input)) {
    try {
      result.input.kind = "url";
      result.input.url = new URL(input).href;
    } catch {
      fail(`URL 无法解析: ${input}`);
    }
  } else {
    result.input.kind = "topic";
    result.input.value = input;
  }

  finish(result);
}

if (mode === "docs") runDocs();
else if (mode === "content") runContent();
else runResearch();
