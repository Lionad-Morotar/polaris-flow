/**
 * Lint 基建切片盘点探针（纯函数，只读零副作用）。
 *
 * 检查项对应实战踩过的"静默失效且代价高"的坑：
 * - 旧 eslint-plugin-tailwindcss 仍在用（性能差、无标记类前置能力）
 * - eslint config ignores 未覆盖构建产物目录 → lint 结果被噪音淹没
 * - CSS entryPoint 的 bare @import 未声明依赖 → pnpm 严格布局下插件解析静默失败
 * - monorepo 子包 eslint config 的相对 import 不可达 → ESLint 10 级联查找时炸掉根 lint
 * - Nuxt 项目未注册 @nuxt/eslint 模块 → .nuxt/eslint.config.mjs 永不生成
 *
 * 判定全部为存在性/正则启发式（与 preflight.mjs 同风格），不做 AST 断言。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expandWorkspacePkgs } from "./pages-deploy.mjs";

/** 常见的构建产物/生成物目录名（根级），存在于磁盘但未进 ignores 时会污染 lint 结果 */
const ARTIFACT_DIRS = [
  ".nuxt",
  ".output",
  ".serve",
  ".histoire",
  ".vite",
  ".turbo",
  "coverage",
];

/** ESLint flat config 候选文件名 */
const ESLINT_CONFIG_NAMES = [
  "eslint.config.mjs",
  "eslint.config.js",
  "eslint.config.cjs",
  "eslint.config.ts",
];

function readText(absPath) {
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * 从 eslint config 文本判断是否忽略了某目录。
 * 启发式：匹配引号包裹、可带 glob 前后缀的目录名（如 .nuxt、coverage）。
 */
function isIgnored(configText, dirName) {
  if (!configText) return false;
  const escaped = dirName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["'\`](?:\\*\\*/)?${escaped}(?:/\\*\\*)?["'\`]`).test(configText);
}

/** 提取 CSS 文本中的 bare @import 包名（跳过相对路径与 URL） */
function extractBareImports(cssText) {
  const names = new Set();
  for (const m of cssText.matchAll(/@import\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("http")) continue;
    // 裸标识符归一到包名：@scope/pkg/sub → @scope/pkg；pkg/sub → pkg
    const parts = spec.split("/");
    names.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
  }
  return [...names];
}

/** 提取 eslint config 中的 better-tailwindcss entryPoint 相对路径（容忍 resolve() 包裹） */
function extractEntryPoint(configText) {
  const m = configText.match(/entryPoint:[^}\n]*?["'`]([^"'`]+\.css)["'`]/);
  return m?.[1] ?? null;
}

/** 提取 eslint config 文本中所有相对路径 import/require 目标 */
function extractRelativeImports(configText) {
  const targets = new Set();
  for (const m of configText.matchAll(
    /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'`](\.{1,2}\/[^"'`]+)["'`]/g,
  )) {
    targets.add(m[1]);
  }
  return [...targets];
}

/**
 * 盘点单个 eslint config 文件的相对 import 可达性。
 * 返回不可达目标列表（ESLint 10 起从被 lint 文件位置级联查找 config，不可达即根 lint 崩点）。
 */
function findBrokenImports(configAbsPath) {
  const text = readText(configAbsPath);
  if (!text) return [];
  const dir = path.dirname(configAbsPath);
  return extractRelativeImports(text).filter(
    (rel) => !existsSync(path.resolve(dir, rel)),
  );
}

/**
 * 主入口：产出 lintInfra 盘点字段。
 * @param {object} ctx - { repoRoot, deps, isNuxt, nuxtConfigName, rootEntries }
 */
export function probeLintInfra({ repoRoot, deps, isNuxt, nuxtConfigName, rootEntries }) {
  const hasTailwind = "tailwindcss" in deps;
  const configName = ESLINT_CONFIG_NAMES.find((n) => rootEntries.includes(n)) ?? null;

  // 无 Tailwind 或无 eslint flat config：切片不适用
  if (!hasTailwind || !configName) {
    return { applicable: false };
  }

  const configText = readText(path.join(repoRoot, configName)) ?? "";

  // ── 插件世代 ──────────────────────────────────────────────────────────────
  const oldPlugin = "eslint-plugin-tailwindcss" in deps;
  const newPlugin = "eslint-plugin-better-tailwindcss" in deps;

  // ── ignores 缺口：磁盘上存在但 config 未提及的产物目录 ─────────────────────
  const artifactOnDisk = [
    ...ARTIFACT_DIRS,
    ...rootEntries.filter((e) => e.startsWith("dist") && e !== "dist"),
  ].filter((d) => {
    try {
      return readdirSync(path.join(repoRoot, d)).length >= 0;
    } catch {
      return false; // 不是目录或无权限
    }
  });
  const ignoresGaps = artifactOnDisk.filter((d) => !isIgnored(configText, d));

  // ── 隐性依赖：entryPoint CSS 的 bare @import 未在 package.json 声明 ────────
  // pnpm 严格 node_modules 布局下，未声明的包对 lint 插件不可达，
  // @import 静默失败 → 主题类被误判 unknown（报错位置远离根因）
  const entryPointRel = extractEntryPoint(configText);
  let implicitDeps = null;
  if (entryPointRel) {
    const cssText = readText(path.resolve(repoRoot, entryPointRel));
    if (cssText) {
      const bare = extractBareImports(cssText).filter(
        (name) => name !== "tailwindcss" && !name.startsWith("tailwindcss/"),
      );
      const missing = bare.filter((name) => !(name in deps));
      implicitDeps = { entryPoint: entryPointRel, bare, missing };
    }
  }

  // ── Nuxt ESLint 集成（根为 Nuxt 时）──────────────────────────────────────
  let nuxtEslint = null;
  if (isNuxt && nuxtConfigName) {
    const nuxtConfigText = readText(path.join(repoRoot, nuxtConfigName)) ?? "";
    nuxtEslint = {
      moduleRegistered: /@nuxt\/eslint/.test(nuxtConfigText),
      generatedConfigExists: existsSync(
        path.join(repoRoot, ".nuxt", "eslint.config.mjs"),
      ),
    };
  }

  // ── monorepo 子包 config 可达性 ───────────────────────────────────────────
  // 与 pagesDeploy 共享 expandWorkspacePkgs：同时支持单包条目（'playground'）
  // 与单星 glob（'packages/*'）——旧实现只认后者，库的 playground 子包会整包漏检
  const workspacePkgs = expandWorkspacePkgs(repoRoot);
  let workspaceConfigs = null;
  if (workspacePkgs.length > 0) {
    const broken = [];
    const nuxtEslintMissing = [];
    for (const rel of workspacePkgs) {
      const subRoot = path.join(repoRoot, rel);
      const subConfig = ESLINT_CONFIG_NAMES.map((n) => path.join(subRoot, n)).find(
        (p) => existsSync(p),
      );
      if (subConfig) {
        for (const missing of findBrokenImports(subConfig)) {
          broken.push({ config: path.relative(repoRoot, subConfig), missing });
        }
      }
      // 子包是 Nuxt（有自己的 nuxt.config）但未注册 @nuxt/eslint
      const subNuxtConfig = ["nuxt.config.ts", "nuxt.config.js", "nuxt.config.mjs"]
        .map((n) => path.join(subRoot, n))
        .find((p) => existsSync(p));
      if (subNuxtConfig) {
        const text = readText(subNuxtConfig) ?? "";
        if (!/@nuxt\/eslint/.test(text)) {
          nuxtEslintMissing.push(rel);
        }
      }
    }
    workspaceConfigs = { broken, nuxtEslintMissing };
  }

  const ready =
    !oldPlugin &&
    newPlugin &&
    ignoresGaps.length === 0 &&
    (implicitDeps === null || implicitDeps.missing.length === 0) &&
    (nuxtEslint === null ||
      (nuxtEslint.moduleRegistered && nuxtEslint.generatedConfigExists)) &&
    (workspaceConfigs === null ||
      (workspaceConfigs.broken.length === 0 &&
        workspaceConfigs.nuxtEslintMissing.length === 0));

  return {
    applicable: true,
    eslintConfig: configName,
    oldPlugin,
    newPlugin,
    ignoresGaps,
    implicitDeps,
    nuxtEslint,
    workspaceConfigs,
    ready,
  };
}
