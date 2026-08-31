#!/usr/bin/env node
/**
 * quiz-shuffle.mjs —— --quiz 出题打乱流水线（防「正确项位置/长度泄漏」）。
 *
 * 输入：题库 JSON（stdin 或 --in 参数）。起草纪律：每题正确项固定放
 * options[0]，本脚本负责 Fisher-Yates 打乱并落盘答案键——呈现前出题者
 * 不接触顺序，判分时按答案键的 correctLabel 核对。
 *
 * 输出两文件（同目录、同前缀）：
 * - <prefix>-shuffled.json  呈现用题面（无答案标记，可安全输出到终端）
 * - <prefix>-key.json       答案键（correctLabel + 完整题库，仅判分时读）
 *
 * 用法：
 *   node quiz-shuffle.mjs --in questions.json --out /tmp/quiz
 *   cat questions.json | node quiz-shuffle.mjs --out /tmp/quiz
 *
 * 题库格式：
 *   [{ "id": "Q1", "question": "题面", "options": [{"label","description"},…],
 *      "answer": 0 }]   // answer 恒为 0（起草纪律），也兼容 1-3 修正入参
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

function parseArgs(argv) {
  const args = { in: undefined, out: './quiz' }
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--in') args.in = argv[++i]
    else if (argv[i] === '--out') args.out = argv[++i]
  }
  return args
}

/** Fisher-Yates 均匀打乱索引数组 */
function shuffledIndices(n) {
  const idx = [...Array(n).keys()]
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
}

const args = parseArgs(process.argv)
const raw = args.in ? readFileSync(args.in, 'utf8') : readFileSync(0, 'utf8')
const questions = JSON.parse(raw)

if (!Array.isArray(questions) || questions.length === 0) {
  console.error('题库须为非空数组')
  process.exit(1)
}
for (const q of questions) {
  if (!q.id || !q.question || !Array.isArray(q.options) || q.options.length < 2) {
    console.error(`题目 ${q.id ?? '?'} 缺 id/question/options 或选项不足`)
    process.exit(1)
  }
  if (q.answer === undefined) q.answer = 0 // 起草纪律缺省：正确项在首位
}

const shuffled = questions.map((q) => {
  const idx = shuffledIndices(q.options.length)
  const correctLabel = q.options[q.answer].label
  return { id: q.id, question: q.question, options: idx.map((i) => q.options[i]), correctLabel }
})

const key = questions.map((q, i) => ({
  id: q.id,
  question: q.question,
  answer: q.options[q.answer],
  presented: shuffled[i],
}))

const dir = dirname(args.out)
if (dir && dir !== '.') mkdirSync(dir, { recursive: true })
writeFileSync(`${args.out}-shuffled.json`, JSON.stringify(shuffled, null, 2))
writeFileSync(`${args.out}-key.json`, JSON.stringify(key, null, 2))
console.log(`已打乱 ${shuffled.length} 题：\n  呈现用 ${args.out}-shuffled.json（判分前勿读其中顺序）\n  答案键 ${args.out}-key.json（判分时核对 correctLabel）`)
