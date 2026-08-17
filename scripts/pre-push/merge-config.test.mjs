/**
 * merge-config 行为规格:基础 gitleaks 配置与本地黑名单的合并。
 * 本地黑名单(configs/secret-scan.local.txt)按行取字面量,
 * 合并为临时 TOML 追加一条 local-blacklist 规则。
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildMergedConfig,
  loadLocalLiterals,
  resolveConfigPath,
} from "./merge-config.mjs";

function fakeRepo(t, files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "mc-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content, "utf8");
  }
  return dir;
}

test("loadLocalLiterals 跳过空行与注释,行首尾空白裁剪", (t) => {
  const root = fakeRepo(t, {
    "configs/secret-scan.local.txt":
      "# 注释\n\n  topsecret-local-001  \ninternal.example.com\n   \n# 又一条注释\n",
  });
  assert.deepEqual(loadLocalLiterals(root), ["topsecret-local-001", "internal.example.com"]);
});

test("loadLocalLiterals 文件缺失返回空数组", (t) => {
  const root = fakeRepo(t);
  assert.deepEqual(loadLocalLiterals(root), []);
});

test("buildMergedConfig 无字面量时原样返回基础配置", () => {
  const base = "[extend]\nuseDefault = true\n";
  assert.equal(buildMergedConfig(base, []), base);
});

test("buildMergedConfig 追加 local-blacklist 规则且正则特殊字符被转义", () => {
  const base = "[extend]\nuseDefault = true\n";
  const merged = buildMergedConfig(base, ["topsecret-local-001", "a.b*c(d)"]);
  assert.ok(merged.startsWith(base));
  assert.ok(merged.includes('id = "local-blacklist"'));
  // 字面量按子串语义进正则,特殊字符必须转义,否则 a.b 会误配 aXb
  assert.ok(merged.includes(String.raw`a\.b\*c\(d\)`));
  assert.ok(merged.includes("topsecret-local-001"));
});

test("buildMergedConfig 字面量含 TOML 分隔符 ''' 时抛出可读错误", () => {
  // 静默生成非法 TOML 会让 hook 在 push 时吐出晦涩的 gitleaks parse error,
  // 必须在合并期就指认出肇事字面量
  assert.throws(() => buildMergedConfig("[extend]\nuseDefault = true\n", ["ab'''cd"]), /'''/);
});

test("resolveConfigPath 无本地黑名单时直接用基础配置,无副作用", (t) => {
  const root = fakeRepo(t, { ".githooks/gitleaks.toml": "[extend]\nuseDefault = true\n" });
  const { path: configPath, cleanup } = resolveConfigPath(root);
  assert.equal(configPath, path.join(root, ".githooks", "gitleaks.toml"));
  cleanup();
});

test("resolveConfigPath 有本地黑名单时产出合并临时文件,cleanup 可清除", (t) => {
  const root = fakeRepo(t, {
    ".githooks/gitleaks.toml": "[extend]\nuseDefault = true\n",
    "configs/secret-scan.local.txt": "topsecret-local-001\n",
  });
  const { path: configPath, cleanup } = resolveConfigPath(root);
  assert.notEqual(configPath, path.join(root, ".githooks", "gitleaks.toml"));
  const content = readFileSync(configPath, "utf8");
  assert.ok(content.includes("useDefault = true"));
  assert.ok(content.includes("topsecret-local-001"));
  cleanup();
  assert.equal(existsSync(configPath), false);
});
