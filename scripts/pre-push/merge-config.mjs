/**
 * merge-config:把仓级基础配置(.githooks/gitleaks.toml)与本机黑名单
 * (configs/secret-scan.local.txt)合并成一份临时 gitleaks 配置。
 *
 * 为什么需要合并:gitleaks 只接受单个 --config;而黑名单含具体敏感词,
 * 不能入库——入库即公开。运行时把字面量转义成正则 alternation 追加成
 * 一条 local-blacklist 规则,喂给 gitleaks 的临时文件随 cleanup 清除。
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LOCAL_BLACKLIST = path.join("configs", "secret-scan.local.txt");
const BASE_CONFIG = path.join(".githooks", "gitleaks.toml");

// 逐行取字面量:裁剪首尾空白,跳过空行与 # 注释
export function loadLocalLiterals(repoRoot) {
  const file = path.join(repoRoot, LOCAL_BLACKLIST);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

// 字面量 → 正则片段:全部特殊字符转义,保证子串语义不被正则元字符改变
function escapeRegex(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildMergedConfig(baseToml, literals) {
  if (literals.length === 0) return baseToml;
  // 合并产物用 TOML 字面串('''...''')承载 alternation;字面量自身含 ''' 会
  // 截断分隔符产出非法 TOML,gitleaks 只报 parse error 不指出原因,须在此拦截
  const offender = literals.find((lit) => lit.includes("'''"));
  if (offender) {
    throw new Error(`secret-scan.local.txt 中的字面量含非法序列 ''': ${JSON.stringify(offender)}`);
  }
  const alternation = literals.map(escapeRegex).join("|");
  // keywords 留空:gitleaks 对所有 fragment 跑该规则,字面量规模小无性能压力
  return `${baseToml}\n# 以下来自 configs/secret-scan.local.txt(本机黑名单,运行时合并,不入库)\n[[rules]]\nid = "local-blacklist"\ndescription = "本机敏感词字面量黑名单"\nregex = '''(?:${alternation})'''\nkeywords = []\n`;
}

// 返回可供 gitleaks --config 使用的配置路径;有黑名单时落临时文件
export function resolveConfigPath(repoRoot) {
  const basePath = path.join(repoRoot, BASE_CONFIG);
  const literals = loadLocalLiterals(repoRoot);
  if (literals.length === 0) {
    return { path: basePath, cleanup: () => {} };
  }
  const merged = buildMergedConfig(readFileSync(basePath, "utf8"), literals);
  const dir = mkdtempSync(path.join(tmpdir(), "gitleaks-config-"));
  const configPath = path.join(dir, "gitleaks.toml");
  writeFileSync(configPath, merged, "utf8");
  return {
    path: configPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
