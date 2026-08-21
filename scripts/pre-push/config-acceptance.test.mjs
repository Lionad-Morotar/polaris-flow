/**
 * gitleaks 配置验收测试:以真实 gitleaks 二进制 + 真实仓级配置
 * (.githooks/gitleaks.toml)在临时 git 仓上验证「脏形态被拦、干净形态放行」。
 *
 * 这里验收的是配置本身(规则覆盖与豁免),不是 gitleaks 引擎。
 * 无 gitleaks 二进制的机器上整组 skip——hook 运行时是 fail-closed,
 * 测试层对只做文档的贡献者保持友好。
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { resolveConfigPath } from "./merge-config.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hasGitleaks = spawnSync("gitleaks", ["version"]).status === 0;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

// 搭一个带真实配置的脏 fixture 仓:leak.txt 集中全部脏形态,clean.txt 集中应放行形态
function setupFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "gl-acc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, ".githooks"), { recursive: true });
  mkdirSync(path.join(root, "configs"), { recursive: true });
  copyFileSync(
    path.join(REPO_ROOT, ".githooks", "gitleaks.toml"),
    path.join(root, ".githooks", "gitleaks.toml"),
  );
  writeFileSync(path.join(root, "configs", "secret-scan.local.txt"), "internal-example-corp.com\n");

  // 脏形态必须用密码学随机素材:默认配置全局 allowlist 以 stopword 抑制
  // 顺序字符类占位符(abcdefghijklmnopqrstuvwxyz 命中即整条约束跳过)
  const urlsafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const rand = (n) => Array.from(randomBytes(n)).map((b) => urlsafe[b % urlsafe.length]).join("");

  const work = path.join(root, "work");
  mkdirSync(work);
  git(work, ["init", "-q", "."]);
  git(work, ["config", "user.email", "t@t.t"]);
  git(work, ["config", "user.name", "t"]);
  writeFileSync(
    path.join(work, "leak.txt"),
    [
      `sk-ant-api03-${rand(68)}`,
      // 验收夹具必须携带逼真脏形态(合成号,命中号段规则即可),gitleaks:allow 豁免本行(仅本行)不被自家 hook 拦截
      "tel 18500000001", // gitleaks:allow
      "deploy at /Users/realname/projects/x", // gitleaks:allow
      "site: internal-example-corp.com",
    ].join("\n"),
  );
  writeFileSync(
    path.join(work, "clean.txt"),
    [
      "doc path /Users/alice/projects/x",
      "/home/your-username 见文档占位",
      'local workspace="" sourceKey="" viaAncestor="false"',
      "timestamp 1755000000000",
      "sk-short 不是 key",
    ].join("\n"),
  );
  git(work, ["add", "."]);
  git(work, ["commit", "-qm", "fixture"]);
  return { root, work };
}

function scan(root, work) {
  const { path: configPath, cleanup } = resolveConfigPath(root);
  try {
    const reportPath = path.join(root, "report.json");
    spawnSync(
      "gitleaks",
      ["git", "--redact", "-c", configPath, "-f", "json", "-r", reportPath, work],
      { encoding: "utf8" },
    );
    return JSON.parse(readFileSync(reportPath, "utf8"));
  } finally {
    cleanup();
  }
}

test("gitleaks 配置验收:脏形态全拦、干净形态放行", { skip: !hasGitleaks && "gitleaks 未安装" }, (t) => {
  const { root, work } = setupFixture(t);
  const findings = scan(root, work);
  const rules = new Set(findings.map((f) => f.RuleID));

  // 脏形态:AI key、手机号、真实 home 路径、本地黑名单字面量
  assert.ok(rules.has("anthropic-api-key"), "应命中 anthropic-api-key");
  assert.ok(rules.has("cn-mobile"), "应命中 cn-mobile");
  assert.ok(rules.has("home-path-leak"), "应命中 home-path-leak");
  assert.ok(rules.has("local-blacklist"), "应命中 local-blacklist");

  // 干净形态:任何命中都不应落在 clean.txt
  const cleanHits = findings.filter((f) => f.File === "clean.txt");
  assert.deepEqual(
    cleanHits.map((f) => `${f.RuleID}@${f.StartLine}`),
    [],
    "clean.txt 不应有任何命中",
  );
});
