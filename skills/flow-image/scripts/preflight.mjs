#!/usr/bin/env node
/**
 * flow-image 初始化前的 Preflight 自检（双后端能力探测）。
 *
 * 引入 bailian(bl) 作为可选图像后端后，"环境完整"不再是单一标准：纯 grsapi 用户没装 bl
 * 是正常的，反之亦然。因此预检改为报告每个后端的可用位，整体 ok 仅在"两后端都不可用"时
 * 阻断——把预检语义从"检查环境是否完美"改为"检查本次任务是否可执行"。
 *
 * 后端可用条件：
 *   grsapi.ok  = API 配置含 KEY 且 curl 可用 且 python3 可用（extract_images 依赖 python3）
 *   bailian.ok = bl 二进制在 PATH 且 `bl auth status` 已登录
 * 技能脚本完整性降为 warning（纯 bl 生成不需要 extract/remove_chroma，缺失不应阻断）。
 * pillow 仅 transparent 模式色键移除需要，沿用 warning。输出目录不可建仍为硬性 fail。
 * 失败时以非零退出码返回，并打印 JSON 汇总供调用方解析。
 */

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_PATH = path.join(HOME, ".config", "flow-image", ".env");
const LEGACY_CONFIG_PATH = path.join(HOME, ".config", "prompt-to-image", ".env");
const OUTPUT_DIR = path.join(HOME, ".flow-image");

const REQUIRED_SCRIPTS = [
  "extract_images.py",
  "wait_for_file.sh",
  "remove_chroma_key.py",
];

const result = {
  ok: true,
  backends: { grsapi: null, bailian: null },
  scripts: {},
  capabilities: { python3: false, curl: false, pillow: false, bl: false },
  outputDir: null,
  warnings: [],
  errors: [],
};

function fail(message) {
  result.ok = false;
  result.errors.push(message);
}

function warn(message) {
  result.warnings.push(message);
}

// 运行命令取首行输出；失败返回 null。stderr 被丢弃以保证探测纯净。
function probeFirstLine(cmd, timeout = 8000) {
  try {
    return execSync(cmd, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout,
    })
      .trim()
      .split("\n")[0];
  } catch {
    return null;
  }
}

// 从 .env 文件中解析 API_KEY（容忍空白与引号）。
function loadApiKey(configPath) {
  try {
    const content = readFileSync(configPath, "utf-8");
    const match = content.match(/^\s*API_KEY\s*=\s*["']?([^"'\s]+)["']?\s*$/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// grsapi 后端：API 配置（含旧路径自动迁移）+ curl + python3 三者齐备才可用。
function probeGrsapi() {
  const reasons = [];
  let config = { path: CONFIG_PATH, migrated: false, apiKeyPresent: false };

  if (existsSync(CONFIG_PATH)) {
    const key = loadApiKey(CONFIG_PATH);
    config = { path: CONFIG_PATH, migrated: false, apiKeyPresent: Boolean(key) };
    if (!key) reasons.push(`配置文件缺少 API_KEY: ${CONFIG_PATH}`);
  } else if (existsSync(LEGACY_CONFIG_PATH)) {
    mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    copyFileSync(LEGACY_CONFIG_PATH, CONFIG_PATH);
    const key = loadApiKey(CONFIG_PATH);
    config = { path: CONFIG_PATH, migrated: true, apiKeyPresent: Boolean(key) };
    if (!key) reasons.push(`迁移后的配置文件缺少 API_KEY: ${CONFIG_PATH}`);
  } else {
    reasons.push(`缺失 API 配置: ${CONFIG_PATH}（创建文件并写入 API_KEY=sk-...）`);
  }

  const curl = probeFirstLine("curl --version");
  if (!curl) reasons.push("curl 不可用（grsapi 调用需要）");

  const python = probeFirstLine("python3 --version");
  if (!python) reasons.push("python3 不可用（extract_images / 色键移除需要）");

  return { ok: reasons.length === 0, config, curl, python, reasons };
}

// bailian 后端：bl 二进制在 PATH 且已登录。退出码非零不代表 bl 损坏——未登录时 CLI 常以
// 非零码返回，故 catch 分支仍尝试解析 stdout 的结构化 authenticated 字段。
function probeBailian() {
  const version = probeFirstLine("bl --version");
  if (!version) {
    return { ok: false, version: null, authenticated: false, reason: "bl 未安装或不在 PATH" };
  }

  let stdout = "";
  try {
    stdout = execSync("bl auth status --output json", {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 20000,
    });
  } catch (e) {
    stdout = (e && e.stdout ? e.stdout : "").toString();
  }

  let authenticated = false;
  let reason = null;
  try {
    const json = JSON.parse(stdout);
    authenticated = json.authenticated === true;
    if (!authenticated) reason = "bl 未鉴权（运行 bl auth login --console --console-site domestic 或 --api-key）";
  } catch {
    reason = "bl auth status 输出无法解析为 JSON";
  }

  return { ok: authenticated, version, authenticated, reason };
}

// 1. 双后端探测。
const grsapi = probeGrsapi();
const bailian = probeBailian();
result.backends = { grsapi, bailian };
result.capabilities.curl = Boolean(grsapi.curl);
result.capabilities.python3 = Boolean(grsapi.python);
result.capabilities.bl = Boolean(bailian.version);

// 2. 整体可用 = 至少一个后端可用；都不可用才阻断，并把两侧原因一并报出便于排障。
result.ok = grsapi.ok || bailian.ok;
if (!result.ok) {
  fail(
    `无可用图像后端 —— grsapi: [${grsapi.reasons.join("; ") || "ok"}]; bailian: [${bailian.reason || "ok"}]`,
  );
}

// 3. 技能脚本完整性：降为 warning，并标注缺失影响哪个模式/后端，不阻断纯 bl 生成。
for (const script of REQUIRED_SCRIPTS) {
  const scriptPath = path.join(SCRIPTS_DIR, script);
  const present = existsSync(scriptPath);
  result.scripts[script] = present;
  if (!present) {
    const scope =
      script === "remove_chroma_key.py"
        ? "transparent 模式色键移除"
        : script === "extract_images.py"
          ? "grsapi 响应提取"
          : "文件写入同步";
    warn(`缺失技能脚本: ${scriptPath}（影响 ${scope}）`);
  }
}

// 4. pillow：仅 transparent 模式色键移除需要，降级为警告。
try {
  execSync('python3 -c "import PIL"', {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000,
  });
  result.capabilities.pillow = true;
} catch {
  result.capabilities.pillow = false;
  warn(
    "pillow 不可用: transparent 模式的色键移除将失败（安装: pip3 install pillow 或 uv pip install pillow）",
  );
}

// 5. 输出目录可创建（两后端都要落盘，硬性）。
try {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  result.outputDir = OUTPUT_DIR;
} catch {
  fail(`输出目录不可创建: ${OUTPUT_DIR}`);
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
