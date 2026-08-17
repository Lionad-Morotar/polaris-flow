#!/usr/bin/env node
/**
 * swap-launcher.mjs — 原子交换同族两个启动器在 configs/launchers.json 中的优先级顺序。
 *
 * Why：启动器链唯一事实源是 configs/launchers.json（本机配置，.gitignore 排除）；
 * 数组顺序即降级优先级，脚本（run-external-review.py / preflight.mjs）运行时读取，
 * 文档只保留模型集合与规则、不含具体启动器名——数组内交换即全技能生效，无多处同步。
 * 交换按数组元素整体进行（非字符串替换），JSON 结构由解析器保证合法。
 *
 * 用法：node swap-launcher.mjs <A> <B> [--dry]
 * guard：A 与 B 须在同一模型的 launchers 数组同现（同族），否则拒绝交换，防跨族误操作。
 * 版本号与 CHANGELOG 需人工维护。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(SKILL_ROOT, 'configs', 'launchers.json');

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const [A, B] = argv.filter((x) => x !== '--dry');
if (!A || !B || A === B) fail('用法：node swap-launcher.mjs <A> <B> [--dry]');
if (!/^[a-z0-9-]+$/.test(A) || !/^[a-z0-9-]+$/.test(B)) fail(`启动器名形态异常：${A} / ${B}`);

let data;
try {
  data = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  fail(`无法读取 ${CONFIG_PATH}：${e.message}（本机配置缺失时复制 configs/launchers.example.json 填写）`);
}
const models = data?.models;
if (!models || typeof models !== 'object') fail(`${CONFIG_PATH} 缺少 models 表`);

// 同族 guard：A、B 须在同一模型的 launchers 数组同现
const entry = Object.entries(models).find(([, cfg]) => {
  const ls = cfg?.launchers;
  return Array.isArray(ls) && ls.includes(A) && ls.includes(B);
});
if (!entry) fail(`${A} 与 ${B} 未在同一模型的 launchers 数组同现，拒绝跨族交换`);
const [model, cfg] = entry;

const chain = cfg.launchers;
const ia = chain.indexOf(A);
const ib = chain.indexOf(B);
console.log(`${dry ? '[dry] ' : ''}swap ${A} ↔ ${B}（${model}）`);
console.log(`  交换前链: [${chain.join(', ')}]`);

[chain[ia], chain[ib]] = [chain[ib], chain[ia]];
console.log(`  交换后链: [${chain.join(', ')}]`);

if (dry) {
  console.log('\ndry-run 完成，未落盘；去掉 --dry 执行');
} else {
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log('\n完成。版本号与 CHANGELOG 需人工维护，确认 diff 后提交（configs/ 不入库，diff 需本地核对）。');
}
