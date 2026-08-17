#!/usr/bin/env node
/**
 * flow-image 的 provider × model 解析器（n×n 路由的单一可执行事实源）。
 *
 * 为什么用脚本而非散文：grsapi 与 bailian 的图像模型存在族重叠（qwen/wan 在两侧都有
 * 端点）且 model id 串不同，"族偏好 + 双精确合法集 + 回退 + 显式校验"的组合用自然语言
 * 描述易被 agent 误判且不可测。把规则编码为可单测函数，使"无歧义"由执行保证而非阅读保证。
 * 人类可读视图见 references/providers.md，二者须保持同步：精确合法集以本文件为准。
 *
 * 输入：{ model?, provider? }。输出：{ ok, provider?, model?, source?, note?, error? }。
 * CLI 以非零退出码（2）表示解析失败，便于 SKILL.md 用退出码分支。
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

// bailian(bl) 图像模型精确合法集——源自 bl image 命令参考，bl 仅认这几个 id 串。
const BAILIAN_MODELS = new Set([
  "qwen-image-2.0",
  "qwen-image-2.0-pro",
  "wan2.6-t2i",
  "wan2.7-image",
]);

// grsapi.xyz 图像模型精确合法集——源自 2026-06-11 速查表（46 行去重 45 唯一 id）。
// 注意其中 qwen/wan 的 id 串与 bl 不同（带日期后缀 / -pro / -edit），不可与 bl 混用。
const GRSAPI_MODELS = new Set([
  "mj_custom_zoom",
  "mj_reroll",
  "kling-image",
  "doubao-seedream-3-0-t2i-250415",
  "z-image-turbo",
  "mj_pan",
  "gpt-image-1-all",
  "mj_blend",
  "grok-4.2-image",
  "kling-image-recognize",
  "mj_upscale",
  "gpt-image-1-mini",
  "mj_inpaint",
  "gemini-2.5-flash-image",
  "mj_zoom",
  "gpt-image-2",
  "gpt-image-1.5",
  "viduq2",
  "grok-imagine-image",
  "mj_low_variation",
  "qwen-image-max-2025-12-30",
  "doubao-seedream-4-5-251128",
  "qwen-image-2.0-2026-03-03",
  "wan2.7-image-pro",
  "dall-e-3",
  "doubao-seedream-5-0-260128",
  "gemini-3-pro-image-preview",
  "flux.1-kontext-pro",
  "doubao-seedream-4-0-250828",
  "mj_imagine",
  "mj_describe",
  "mj_modal",
  "mj_high_variation",
  "gpt-image-1",
  "grok-4-image",
  "gemini-3.1-flash-image-preview",
  "gpt-image-1.5-all",
  "grok-4.1-image",
  "flux-1.1-pro",
  "grok-imagine-image-pro",
  "mj_variation",
  "qwen-image-edit-2509",
  "kling-omni-image",
  "grok-3-image",
  "qwen-image-max",
]);

// 各 provider 在"未指定 model"时的默认模型；零参全局默认走 grsapi 以保向后兼容。
const DEFAULT_MODEL = { grsapi: "gpt-image-2", bailian: "qwen-image-2.0" };
const PROVIDERS = ["grsapi", "bailian"];

// 族前缀 → 偏好 provider。仅用于"两合法集都命中"的 tie-break 与"都未命中"的报错提示，
// 不单独决定路由（精确合法集优先，避免 id 串错配）。qwen/wan 偏好 bl，其余已知族归 grsapi。
function familyPreference(model) {
  if (/^qwen-image|^wan/.test(model)) return "bailian";
  if (/^(gpt-image|gemini|mj_|kling|doubao|flux|grok|vidu|z-image|dall-e)/.test(model)) {
    return "grsapi";
  }
  return "unknown";
}

function ok(fields) {
  return { ok: true, ...fields };
}

function error(code, message, extra = {}) {
  return { ok: false, error: { code, message, ...extra } };
}

export function resolve({ model, provider } = {}) {
  model = typeof model === "string" && model.trim() ? model.trim() : undefined;
  provider =
    typeof provider === "string" && provider.trim() ? provider.trim() : undefined;

  if (provider && !PROVIDERS.includes(provider)) {
    return error(
      "INVALID_PROVIDER",
      `未知 provider: ${provider}（仅支持 ${PROVIDERS.join("|")}）`,
    );
  }

  // 未指定 model：纯默认路径，不触发任何合法集校验。
  if (!model) {
    const p = provider ?? "grsapi";
    return ok({
      provider: p,
      model: DEFAULT_MODEL[p],
      source: provider ? "explicit-provider-default" : "global-default",
    });
  }

  const inBailian = BAILIAN_MODELS.has(model);
  const inGrsapi = GRSAPI_MODELS.has(model);
  const pref = familyPreference(model);

  // 显式 provider：严格校验该 provider 是否支持此精确 id，不做静默回退——尊重显式意图，
  // 冲突时提示该 model 实际可用的 provider，让用户自行去掉 --provider 或更换 model。
  if (provider) {
    const legal = provider === "bailian" ? inBailian : inGrsapi;
    if (!legal) {
      const suggested =
        provider === "bailian"
          ? inGrsapi
            ? "grsapi"
            : null
          : inBailian
            ? "bailian"
            : null;
      return error(
        "UNSUPPORTED_COMBO",
        `provider ${provider} 不支持模型 ${model}`,
        suggested ? { suggested_provider: suggested } : {},
      );
    }
    return ok({ provider, model, source: "explicit" });
  }

  // 自动解析：精确合法集优先，单一归属直接定 provider。
  if (inBailian && !inGrsapi) return ok({ provider: "bailian", model, source: "resolved" });
  if (inGrsapi && !inBailian) return ok({ provider: "grsapi", model, source: "resolved" });
  if (inBailian && inGrsapi) {
    // 重叠（极少）：按族偏好，qwen/wan 走 bl，其余走 grsapi。
    const p = pref === "bailian" ? "bailian" : "grsapi";
    return ok({
      provider: p,
      model,
      source: "resolved",
      note: "model 同时存在于两个 provider，按族偏好选择",
    });
  }

  // 两合法集都未命中：无论族偏好是否已知，都报错询问——避免把未核实 id 静默发往 provider。
  // 族偏好已知时附建议 provider，方便用户显式确认或推动清单更新。
  if (pref === "unknown") {
    return error(
      "UNKNOWN_MODEL",
      `无法识别模型 ${model}，请用 --provider 显式指定或核对模型 ID`,
    );
  }
  return error(
    "UNKNOWN_MODEL",
    `模型 ${model} 未在已知清单中核实（族偏好 ${pref}），请用 --provider ${pref} 显式确认或更新模型清单`,
    { suggested_provider: pref },
  );
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    let key;
    let val;
    if (eq !== -1) {
      key = a.slice(2, eq);
      val = a.slice(eq + 1);
    } else {
      key = a.slice(2);
      const next = argv[i + 1];
      val = next !== undefined && !next.startsWith("--") ? argv[++i] : true;
    }
    out[key] = val;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = resolve({ model: args.model, provider: args.provider });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.ok ? 0 : 2);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
