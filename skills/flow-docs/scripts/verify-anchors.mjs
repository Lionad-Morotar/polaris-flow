#!/usr/bin/env node
/**
 * verify-anchors：批量校验报告中 #LXX-LYY 源码锚点的机械正确性。
 *
 * 只做三件机械检查：目标文件存在、行号不越界（≤ 文件总行数）、起始行 ≤ 结束行。
 * 不校验「该行是否是目标代码」——那是编辑器视觉抽查的职责（CLI 形态为
 * `code-insiders -g <abs>:<line>`，见 references/source-map.md「编辑器视觉抽查」）。
 * 机械校验全绿 ≠ 锚点全部正确，只代表锚点没有硬错误。
 *
 * 用法：
 *   node verify-anchors.mjs <report.md | dir> [<more>...]
 *
 * 目录参数递归其中全部 *.md。锚点路径解析：`/` 开头按 git root（仓库根绝对路径），
 * 否则按报告所在目录相对解析。http(s):// 等外链、代码围栏与行内代码中的锚点跳过——
 * 报告正文可能引用锚点格式本身作为示例，不应当作真实锚点校验。
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// GitHub 风格行号锚点：](path#L10) 或 ](path#L10-L20)（容忍 #L10-20 省略写法）
const ANCHOR_RE = /\]\(([^)\s]+?)#L(\d+)(?:-L?(\d+))?\)/g;

function gitRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 8000,
    }).trim();
  } catch {
    return null;
  }
}

/** 按字节数换行计总行数；末行无换行符也算一行。 */
function countLines(file) {
  const text = readFileSync(file, "utf-8");
  if (text.length === 0) return 0;
  const parts = text.split("\n");
  return parts[parts.length - 1] === "" ? parts.length - 1 : parts.length;
}

/** 收集参数中的全部 .md 报告文件（目录递归）。 */
function collectReports(args) {
  const files = [];
  for (const arg of args) {
    const abs = path.resolve(arg);
    if (!existsSync(abs)) {
      files.push({ missing: arg });
      continue;
    }
    if (statSync(abs).isDirectory()) {
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          // 只递归一层子目录够用；深层嵌套的报告目录极少见，避免扫进 node_modules 式黑洞
          const sub = path.join(abs, entry.name);
          for (const f of readdirSync(sub)) if (f.endsWith(".md")) files.push(path.join(sub, f));
        } else if (entry.name.endsWith(".md")) {
          files.push(path.join(abs, entry.name));
        }
      }
    } else {
      files.push(abs);
    }
  }
  return files;
}

function verifyReport(reportPath, root) {
  const failures = [];
  let total = 0;
  const reportDir = path.dirname(reportPath);
  const text = readFileSync(reportPath, "utf-8");
  const lines = text.split("\n");
  let inFence = false;

  lines.forEach((raw, idx) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const line = raw.replace(/`[^`]*`/g, ""); // 行内代码可能演示锚点格式，跳过
    ANCHOR_RE.lastIndex = 0;
    let m;
    while ((m = ANCHOR_RE.exec(line)) !== null) {
      const [, linkPath, startStr, endStr] = m;
      if (/^https?:\/\//i.test(linkPath)) continue; // 外链不校验
      total += 1;
      const start = Number(startStr);
      const end = endStr ? Number(endStr) : start;
      const anchor = `${linkPath}#L${start}${endStr ? `-L${end}` : ""}`;
      const at = (reason) => failures.push({ report: reportPath, line: idx + 1, link: anchor, reason });

      if (start > end) {
        at(`起始行大于结束行（L${start} > L${end}）`);
        continue;
      }

      let target;
      if (linkPath.startsWith("/")) {
        if (!root) {
          at("仓库根绝对路径无法解析：当前不在 git 仓库内");
          continue;
        }
        target = path.join(root, linkPath);
      } else {
        target = path.resolve(reportDir, linkPath);
      }

      if (!existsSync(target)) {
        at(`文件不存在：${target}`);
        continue;
      }
      const lineCount = countLines(target);
      if (end > lineCount) {
        at(`行号越界：文件共 ${lineCount} 行，锚点指向 L${end}`);
      }
    }
  });

  return { total, failures };
}

// ---- 主流程 ----

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(JSON.stringify({ ok: false, errors: ["用法: node verify-anchors.mjs <report.md | dir> [<more>...]"] }, null, 2));
  process.exit(1);
}

const root = gitRoot();
const reports = collectReports(args);
const missing = reports.filter((r) => r.missing);
const result = {
  ok: missing.length === 0,
  gitRoot: root,
  files: 0,
  total: 0,
  passed: 0,
  failures: [],
  errors: missing.map((m) => `报告文件不存在：${m.missing}`),
};

for (const report of reports) {
  if (report.missing) continue;
  result.files += 1;
  const { total, failures } = verifyReport(report, root);
  result.total += total;
  result.failures.push(...failures);
}
result.passed = result.total - result.failures.length;
if (result.failures.length > 0) result.ok = false;
if (result.total === 0 && result.errors.length === 0) {
  result.note = "未发现任何 #LXX-LYY 锚点——确认报告确实写了源码锚点";
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
