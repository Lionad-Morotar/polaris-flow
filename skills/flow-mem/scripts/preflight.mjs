#!/usr/bin/env node
/**
 * flow-mem 初始化前的 Preflight 自检，以 --mode 分流两条 Workflow：
 *
 * - learn：学习与维护。核心产出是项目依赖画像：从 package.json 抽取全部依赖
 *   （dependencies + devDependencies），尽力解析实装版本（node_modules/<pkg>/package.json，
 *   缺失不阻断），再与知识库现有框架目录交叉出 known / unknown 清单——后续步骤据此
 *   判断「会话/产物里的知识该归到哪个框架、哪些框架还没有知识覆盖」；同时列出决策
 *   知识库现有任务类型（kb.decisionTypes），供用户偏好与决策类知识定域。
 *   package.json 缺失只告警（仍可从指定内容源学习，只是没有 deps 交叉定域的依据）；
 *   知识库为空或目录不存在也只告警（首次学习是合法路径，目录在首次写入时创建）。
 *   --input 可重复传入多个内容来源：形似路径的校验存在性（不存在即阻断），其余视为纯文本；
 *   不传则默认从当前整个会话学习。
 * - search：知识检索。确认知识库根存在（不存在告警，留给 search.mjs 返回空结果），
 *   --input 是检索关键词，可选，缺失告警不阻断（workflow 阶段可交互澄清）。
 *
 * 两个 mode 不合并预检：learn 的输入是内容来源（路径需存在性校验），search 的输入是关键词
 * （纯文本）；union 校验会把关键词误判为文件路径，也会让路径校验误杀检索调用。
 *
 * 失败时以非零退出码返回，并打印 JSON 汇总供调用方解析。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---- 参数解析 ----

const argv = process.argv.slice(2);
function argValues(flag) {
  const out = [];
  let i = argv.indexOf(flag);
  while (i >= 0 && i + 1 < argv.length) {
    out.push(argv[i + 1]);
    i = argv.indexOf(flag, i + 2);
  }
  return out;
}
const argValue = (flag) => argValues(flag)[0];

const mode = argValue("--mode") ?? "learn";
if (mode !== "learn" && mode !== "search") {
  console.log(
    JSON.stringify({ ok: false, mode, errors: [`未知 --mode: ${mode}（支持 learn | search）`] }, null, 2),
  );
  process.exit(1);
}

function finish(result) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

// 知识库根：脚本位于 <skill>/scripts/，知识库位于 <skill>/references/<framework|decisions>/
// node 默认解析符号链接到真实路径，经 ~/.claude/skills/flow-mem 调用也定位到同一实际目录
const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KB_ROOT = path.join(SKILL_ROOT, "references", "framework");
const DECISIONS_ROOT = path.join(SKILL_ROOT, "references", "decisions");

// 框架目录名 → 基础包名：剥离尾部的 @<semver>（版本目录如 vue-router@5.2.0 → vue-router；
// scoped 包 @nuxt/ui 与 @nuxt/ui@4.1.0 均正确，因为版本段 @ 后必以数字开头）
const stripVersion = (name) => name.replace(/@[0-9][^@]*$/, "");

// 列出现有框架目录：@scope 目录展开为 @scope/name；仅目录，文件（如根 index.md）不计
function listFrameworks(root) {
  const names = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@")) {
      for (const child of readdirSync(path.join(root, entry.name), { withFileTypes: true })) {
        if (child.isDirectory()) names.push(`${entry.name}/${child.name}`);
      }
    } else {
      names.push(entry.name);
    }
  }
  return names.sort();
}

// 列出决策库现有任务类型：decisions 根下一级目录（<task-type>/<topic>/<ctx>.md 三层结构）
function listDecisionTypes(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// 从 startDir 向上找最近的 package.json（monorepo 下取子包自己的依赖；需要根的依赖时
// 调用方对根目录再跑一次 --cwd <root> 合并）
function findPackageJson(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// 尽力解析实装版本：读 node_modules/<pkg>/package.json 的 version，缺失返回 null
function readInstalledVersion(projectDir, name) {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(projectDir, "node_modules", name, "package.json"), "utf-8"),
    );
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

// 内容来源分类：不含空白且（含路径分隔符 / 以 . 开头 / 实际存在）的视为路径，其余视为纯文本。
// 调用方传目录时请使用带路径分隔符的形式（如 <run-dir>/），避免裸目录名被误判为文本
function classifyInputs(inputs) {
  const paths = [];
  const texts = [];
  const errors = [];
  for (const value of inputs) {
    const looksLikePath =
      !/\s/.test(value) && (value.includes("/") || value.startsWith("."));
    if (looksLikePath) {
      const abs = path.resolve(value);
      if (!existsSync(abs)) errors.push(`内容来源不存在: ${abs}`);
      else paths.push(abs);
    } else if (existsSync(value)) {
      paths.push(path.resolve(value));
    } else {
      texts.push(value);
    }
  }
  return { paths, texts, errors };
}

// ---- learn 模式 ----

function runLearn() {
  const result = {
    ok: true,
    mode: "learn",
    versions: {},
    kb: {},
    project: {},
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
  result.versions.node = process.version;

  // 2. 知识库现状：为空或缺目录是首次学习的合法状态，只告警
  result.kb.root = KB_ROOT;
  result.kb.frameworks = existsSync(KB_ROOT) ? listFrameworks(KB_ROOT) : [];
  result.kb.decisionTypes = existsSync(DECISIONS_ROOT) ? listDecisionTypes(DECISIONS_ROOT) : [];
  if (result.kb.frameworks.length === 0) {
    warn("框架知识库为空或目录尚不存在，首次写入时创建框架目录");
  }

  // 3. 项目依赖画像：--learn 的核心输入，供 workflow 判断该从内容中学哪些框架的知识
  const cwd = argValue("--cwd") ?? process.cwd();
  const pkgPath = findPackageJson(cwd);
  if (!pkgPath) {
    warn("未找到 package.json，学习将不按 deps 交叉定域（仍可从指定内容源学习）");
  } else {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    } catch (err) {
      fail(`package.json 解析失败: ${pkgPath}（${err.message}）`);
      pkg = {};
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    result.project.packageJson = pkgPath;
    result.project.deps = deps;

    // 实装版本尽力解析：用于版本目录命名（<pkg>@<version>），缺失不阻断
    const resolved = {};
    const projectDir = path.dirname(pkgPath);
    for (const name of Object.keys(deps)) {
      const version = readInstalledVersion(projectDir, name);
      if (version) resolved[name] = version;
    }
    result.project.resolved = resolved;

    // 与知识库交叉：known = deps 中已有知识覆盖的，unknown = 尚无覆盖的
    const kbBases = new Set(result.kb.frameworks.map(stripVersion));
    const names = Object.keys(deps);
    result.project.known = names.filter((n) => kbBases.has(n));
    result.project.unknown = names.filter((n) => !kbBases.has(n));
  }

  // 4. 内容来源：可多个；路径校验存在性（不存在属事实错误，阻断），缺省取整个会话
  const inputs = argValues("--input");
  if (inputs.length === 0) {
    result.input.kind = "session";
    warn("未收到 --input，将从当前整个会话学习");
  } else {
    const { paths, texts, errors } = classifyInputs(inputs);
    for (const err of errors) fail(err);
    result.input.kind =
      paths.length > 0 && texts.length > 0 ? "mixed" : paths.length > 0 ? "paths" : "texts";
    result.input.paths = paths;
    result.input.texts = texts;
  }

  finish(result);
}

// ---- search 模式 ----

function runSearch() {
  const result = {
    ok: true,
    mode: "search",
    versions: {},
    kb: {},
    input: {},
    warnings: [],
    errors: [],
  };

  const warn = (message) => result.warnings.push(message);

  // 1. node
  result.versions.node = process.version;

  // 2. 知识库根：不存在或为空时检索必然无果，只告警——「无收录」是合法应答而非故障
  result.kb.root = KB_ROOT;
  result.kb.frameworks = existsSync(KB_ROOT) ? listFrameworks(KB_ROOT) : [];
  result.kb.decisionTypes = existsSync(DECISIONS_ROOT) ? listDecisionTypes(DECISIONS_ROOT) : [];
  if (result.kb.frameworks.length === 0) {
    warn("框架知识库为空或目录尚不存在，检索将返回空结果");
  }

  // 3. 检索关键词：可选，workflow 阶段可交互澄清
  const input = argValue("--input");
  if (!input) {
    result.input.kind = "none";
    warn("未收到 --input，将在 workflow 阶段澄清检索关键词");
  } else {
    result.input.kind = "query";
    result.input.value = input;
  }

  finish(result);
}

if (mode === "learn") runLearn();
else runSearch();
