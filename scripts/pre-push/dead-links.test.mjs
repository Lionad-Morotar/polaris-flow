/**
 * dead-links 行为规格:SKILL.md 的 markdown 链接必须指向仓内跟踪文件。
 * 与 forbidden-paths 互补:后者挡文件入库,本检查挡「对本地文件的引用」。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { checkDeadLinks } from "./dead-links.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

// 夹具:一个提交,skills/demo/ 下含跟踪的 SKILL.md 与 references/tracked.md
function setupFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "dead-links-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q", ".");
  git(root, "config", "user.email", "t@t.t");
  git(root, "config", "user.name", "t");
  mkdirSync(path.join(root, "skills/demo/references"), { recursive: true });
  writeFileSync(path.join(root, "skills/demo/references/tracked.md"), "# tracked\n");
  return root;
}

function commit(root, skillMd) {
  mkdirSync(path.join(root, "skills/demo"), { recursive: true });
  writeFileSync(path.join(root, "skills/demo/SKILL.md"), skillMd);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  return git(root, "rev-parse", "HEAD").trim();
}

test("指向跟踪文件的链接放行", (t) => {
  const root = setupFixture(t);
  const sha = commit(root, "# demo\n\n见 [手册](references/tracked.md) 与 [锚点](references/tracked.md#一节)。\n");
  assert.deepEqual(checkDeadLinks(root, sha, ["skills/demo/SKILL.md"]), []);
});

test("指向未跟踪(被 ignore 的本地积累)文件的链接阻断", (t) => {
  const root = setupFixture(t);
  const sha = commit(root, "# demo\n\n见 [本地手册](references/local-only/secret.md)。\n");
  // 提交后才出现、从不入库的文件——模拟 references/ 被 ignore 的本地积累
  mkdirSync(path.join(root, "skills/demo/references/local-only"), { recursive: true });
  writeFileSync(path.join(root, "skills/demo/references/local-only/secret.md"), "# local\n");
  const hits = checkDeadLinks(root, sha, ["skills/demo/SKILL.md"]);
  assert.deepEqual(hits, [{ file: "skills/demo/SKILL.md", target: "references/local-only/secret.md" }]);
});

test("通配链接校验目录部分:目录存在放行,不存在阻断", (t) => {
  const root = setupFixture(t);
  mkdirSync(path.join(root, "skills/demo/references/tracked-dir"), { recursive: true });
  writeFileSync(path.join(root, "skills/demo/references/tracked-dir/one.md"), "# one\n");
  const sha = commit(root, "# demo\n\n[有目录](references/tracked-dir/*.md) [无目录](references/ghost/*.md)\n");
  const hits = checkDeadLinks(root, sha, ["skills/demo/SKILL.md"]);
  assert.deepEqual(hits, [{ file: "skills/demo/SKILL.md", target: "references/ghost/*.md" }]);
});

test("references/ 之外的链接不在本策略范围", (t) => {
  const root = setupFixture(t);
  const sha = commit(root, "# demo\n\n[外链](https://example.com) [仓内其他](assets/missing.png)\n");
  assert.deepEqual(checkDeadLinks(root, sha, ["skills/demo/SKILL.md"]), []);
});

test("SKILL.md 在该提交被删除时跳过不报错", (t) => {
  const root = setupFixture(t);
  commit(root, "# demo\n");
  git(root, "rm", "-q", "skills/demo/SKILL.md");
  git(root, "commit", "-q", "-m", "remove");
  const sha = git(root, "rev-parse", "HEAD").trim();
  assert.deepEqual(checkDeadLinks(root, sha, ["skills/demo/SKILL.md"]), []);
});
