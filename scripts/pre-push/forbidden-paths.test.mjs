/**
 * forbidden-paths 行为规格:禁止进入推送历史的文件路径策略。
 * 与 .gitignore 是两层防线:ignore 防「无意纳入」,本策略防「git add -f 强塞」。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkForbiddenPaths } from "./forbidden-paths.mjs";

test("环境文件:.env 与 .env.* 拦截,.env.example 放行", () => {
  const hits = checkForbiddenPaths([".env", ".env.local", "app/.env.production", ".env.example", ".env.sample"]);
  const blocked = hits.map((h) => h.path);
  assert.ok(blocked.includes(".env"));
  assert.ok(blocked.includes(".env.local"));
  assert.ok(blocked.includes("app/.env.production"));
  assert.ok(!blocked.includes(".env.example"));
  assert.ok(!blocked.includes(".env.sample"));
});

test("密钥材料文件:pem/key/p12/pfx 与 ssh 私钥名拦截", () => {
  const hits = checkForbiddenPaths(["certs/server.pem", "a.key", "b.p12", "c.pfx", ".ssh/id_rsa", "id_ed25519", "public.pem.pub", "x.keyword"]);
  const blocked = hits.map((h) => h.path);
  assert.deepEqual(blocked.sort(), [".ssh/id_rsa", "a.key", "b.p12", "c.pfx", "certs/server.pem", "id_ed25519"].sort());
});

test("仓级本机配置:configs/ 下仅 example 模板放行", () => {
  const hits = checkForbiddenPaths(["configs/secret-scan.local.txt", "configs/secret-scan.example.txt"]);
  assert.deepEqual(hits.map((h) => h.path), ["configs/secret-scan.local.txt"]);
});

test("技能本机配置:flow-agent/flow-os 的 configs 除入库模板外拦截", () => {
  const hits = checkForbiddenPaths([
    "skills/flow-agent/configs/launchers.json",
    "skills/flow-agent/configs/launchers.example.json",
    "skills/flow-os/configs/providers.local.md",
  ]);
  assert.deepEqual(
    hits.map((h) => h.path).sort(),
    ["skills/flow-agent/configs/launchers.json", "skills/flow-os/configs/providers.local.md"].sort(),
  );
});

test("本地积累目录:flow-mem 知识库、flow-web playbook 与 flow-app 应用手册/绑定缓存拦截", () => {
  const hits = checkForbiddenPaths([
    "skills/flow-mem/references/framework/git/diff.md",
    "skills/flow-mem/references/decisions/dev-tooling/index.md",
    "skills/flow-web/references/example.com/page.md",
    "skills/flow-app/references/claude-code/track-session-state.md",
    "skills/flow-web/configs/workspace-bindings.json",
    "skills/flow-web/configs/workspace-uuids.json",
  ]);
  assert.equal(hits.length, 6);
});

test("正常源码与文档放行", () => {
  const hits = checkForbiddenPaths(["skills/flow-dev/SKILL.md", "README.md", "scripts/pre-push/scan.mjs"]);
  assert.equal(hits.length, 0);
});
