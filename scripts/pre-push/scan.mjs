#!/usr/bin/env node
/**
 * pre-push 扫描编排:读 stdin 的 ref 更新,对每个推送范围跑
 * gitleaks(内容形态)、禁止路径检查(路径策略)与 SKILL.md 死链检查
 * (引用策略),聚合报告并按结果退出。
 *
 * 用法:
 *   node scan.mjs [repoDir]          # repoDir 默认 cwd;stdin 协议见 githooks(5)
 *
 * 退出码:
 *   0 干净放行;1 阻断(内容命中或禁止路径);2 运行故障(fail-closed,如 gitleaks 缺失)
 *   均可由 git push --no-verify 显式绕过。
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkDeadLinks } from "./dead-links.mjs";
import { checkForbiddenPaths } from "./forbidden-paths.mjs";
import { logOptsForUpdate, parsePrePushStdin } from "./git-ranges.mjs";
import { resolveConfigPath } from "./merge-config.mjs";

const SCAN_TIMEOUT_MS = 120_000;

// 范围内触及的文件清单;-m 让 merge commit 也报名字(与内容扫描口径一致)
function listTouchedPaths(repoDir, logOpts) {
  const out = execFileSync(
    "git",
    ["log", "--pretty=format:", "--name-only", ...logOpts.split(" ")],
    { cwd: repoDir, encoding: "utf8", timeout: SCAN_TIMEOUT_MS },
  );
  return [...new Set(out.split("\n").map((l) => l.trim()).filter(Boolean))];
}

function runGitleaks(repoDir, logOpts, configPath, gitleaksBin) {
  const dir = mkdtempSync(path.join(tmpdir(), "gitleaks-report-"));
  const reportPath = path.join(dir, "report.json");
  try {
    const r = spawnSync(
      gitleaksBin,
      ["git", "--redact", "-c", configPath, "-f", "json", "-r", reportPath, "--log-opts", logOpts, repoDir],
      { encoding: "utf8", timeout: SCAN_TIMEOUT_MS },
    );
    if (r.error) {
      // ENOENT = 二进制缺失;其余 spawn 故障同类处理
      return { kind: r.error.code === "ENOENT" ? "gitleaks-missing" : "gitleaks-error", findings: [], stderr: String(r.error) };
    }
    if (r.status !== 0 && r.status !== 1) {
      return { kind: "gitleaks-error", findings: [], stderr: (r.stderr || "").slice(-500) };
    }
    const findings = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : [];
    return { kind: "ok", findings };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 对一组 ref 更新执行扫描,返回聚合结果。
 * 同一内容经 merge -m 双父回声与重叠规则会产生重复命中,按 (commit,file,line,rule) 去重。
 */
export function runPrePush({ stdinText, repoDir, gitleaksBin = "gitleaks" }) {
  const updates = parsePrePushStdin(stdinText);
  const findings = [];
  const forbidden = [];
  const deadLinks = [];
  const errors = [];
  const skipped = [];
  const seen = new Set();

  const { path: configPath, cleanup } = resolveConfigPath(repoDir);
  try {
    for (const update of updates) {
      const opts = logOptsForUpdate(repoDir, update);
      if (opts === null) {
        skipped.push(update.localRef);
        continue;
      }
      const scan = runGitleaks(repoDir, opts, configPath, gitleaksBin);
      if (scan.kind !== "ok") {
        errors.push({ ...scan, ref: update.localRef });
        continue;
      }
      for (const f of scan.findings) {
        const key = `${f.Commit}|${f.File}|${f.StartLine}|${f.RuleID}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push(f);
        }
      }
      // git log 故障(如对象损坏)同样 fail-closed;当前调用顺序下 gitleaks 会
      // 先对坏范围报错,本分支是防御未来重排的兜底
      let touched;
      try {
        touched = listTouchedPaths(repoDir, opts);
      } catch (e) {
        errors.push({ kind: "git-error", ref: update.localRef, stderr: String(e.message).slice(-500) });
        continue;
      }
      for (const hit of checkForbiddenPaths(touched)) {
        const key = `${hit.rule}|${hit.path}`;
        if (!seen.has(key)) {
          seen.add(key);
          forbidden.push(hit);
        }
      }
      // 以推送提交的树为准校验 SKILL.md 引用,挡住「对本地文件的引用」
      const skillMds = touched.filter((p) => p.endsWith("SKILL.md"));
      let links;
      try {
        links = checkDeadLinks(repoDir, update.localSha, skillMds);
      } catch (e) {
        errors.push({ kind: "git-error", ref: update.localRef, stderr: String(e.message).slice(-500) });
        continue;
      }
      for (const hit of links) {
        const key = `dead-link|${hit.file}|${hit.target}`;
        if (!seen.has(key)) {
          seen.add(key);
          deadLinks.push(hit);
        }
      }
    }
  } finally {
    cleanup();
  }

  return {
    blocked: findings.length > 0 || forbidden.length > 0 || deadLinks.length > 0 || errors.length > 0,
    findings,
    forbidden,
    deadLinks,
    errors,
    skipped,
  };
}

function printReport(result) {
  for (const f of result.findings) {
    const commit = (f.Commit || "").slice(0, 7);
    console.error(`  [${f.RuleID}] ${f.File}:${f.StartLine} (commit ${commit}) ${f.Match ?? ""}`.trim());
  }
  for (const h of result.forbidden) {
    console.error(`  [forbidden:${h.rule}] ${h.path}`);
  }
  for (const h of result.deadLinks) {
    console.error(`  [dead-link] ${h.file} → ${h.target}(markdown 链接指向未跟踪文件;本地文件请改用代码跨度提及)`);
  }
  for (const e of result.errors) {
    if (e.kind === "gitleaks-missing") {
      console.error("  未找到 gitleaks 二进制。安装:brew install gitleaks;或 git push --no-verify 显式绕过(不推荐)");
    } else {
      console.error(`  gitleaks 运行故障(${e.ref ?? ""}):${e.stderr}`);
    }
  }
}

/**
 * hook 入口:repoDir 由调用方显式给出——git 钩子 argv 携带远端名/URL,
 * 本函数不读 process.argv,避免把远端名误当路径
 */
export function main(repoDir) {
  let stdinText = "";
  try {
    stdinText = readFileSync(0, "utf8");
  } catch {
    stdinText = "";
  }
  const result = runPrePush({ stdinText, repoDir });
  if (result.errors.length > 0) {
    console.error("pre-push 扫描运行故障(fail-closed,push 已阻断):");
    printReport(result);
    process.exit(2);
  }
  if (result.blocked) {
    console.error(
      `pre-push 扫描发现 ${result.findings.length + result.forbidden.length + result.deadLinks.length} 处不应开源的内容,push 已阻断:`,
    );
    printReport(result);
    console.error("确认为误报可调整 .githooks/gitleaks.toml 豁免;紧急绕过用 git push --no-verify");
    process.exit(1);
  }
  process.exit(0);
}

// 直接以 CLI 运行时(.githooks/pre-push 之外的入口):参数为 repoDir,默认 cwd
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(path.resolve(process.argv[2] ?? process.cwd()));
}
