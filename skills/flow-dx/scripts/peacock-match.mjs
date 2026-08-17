#!/usr/bin/env node
/**
 * Peacock 壳色彩明度/饱和度校验与批量生成器
 *
 * 用途：
 * - 生成一批与目标色在 HSL 明度（L）和饱和度（S）上相近的候选色
 * - 校验传入颜色列表是否满足 S/L 接近条件
 *
 * 默认目标色为 `#f6ec91`，可覆盖。
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── 颜色转换工具 ───────────────────────────────────────────────

function hexToRgb(hex) {
  const normalized = hex.replace('#', '').trim().toLowerCase()
  if (!/^[0-9a-f]{6}$/.test(normalized)) {
    throw new Error(`非法 hex 颜色: ${hex}`)
  }
  const num = parseInt(normalized, 16)
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  }
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`
}

function rgbToHsl({ r, g, b }) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h /= 6
  }

  return { h: h * 360, s: s * 100, l: l * 100 }
}

function hslToRgb({ h, s, l }) {
  h = (((h % 360) + 360) % 360) / 360
  s /= 100
  l /= 100

  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }

  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  }
}

function formatHsl({ h, s, l }) {
  return `HSL(${Math.round(h)}°, ${Math.round(s)}%, ${Math.round(l)}%)`
}

// ── 候选色生成 / 校验 ──────────────────────────────────────────

function generateCandidates(targetHex, hueStep) {
  const targetHsl = rgbToHsl(hexToRgb(targetHex))
  const candidates = []
  for (let h = 0; h < 360; h += hueStep) {
    const hsl = { h, s: targetHsl.s, l: targetHsl.l }
    candidates.push({
      hex: rgbToHex(hslToRgb(hsl)),
      hsl,
    })
  }
  return candidates
}

function verifyCandidates(inputs, targetHex, satTol, lightTol) {
  const targetHsl = rgbToHsl(hexToRgb(targetHex))
  return inputs.map((hex) => {
    const hsl = rgbToHsl(hexToRgb(hex))
    const ds = Math.abs(hsl.s - targetHsl.s) / 100
    const dl = Math.abs(hsl.l - targetHsl.l) / 100
    return {
      hex,
      hsl,
      ds,
      dl,
      ok: ds <= satTol && dl <= lightTol,
    }
  })
}

// ── HTML 生成 ──────────────────────────────────────────────────

function renderHtml(targetHex, targetHsl, items, mode, satTol, lightTol) {
  const title = mode === 'verify'
    ? `Peacock 颜色校验 · 目标 ${targetHex}`
    : `Peacock 候选色批量生成 · 目标 ${targetHex}`

  const swatch = (hex, label, size = 'large') => `
    <div class="swatch ${size}">
      <div class="chip" style="background:${hex}"></div>
      <div class="meta">
        <code>${hex}</code>
        ${label ? `<span class="label">${label}</span>` : ''}
      </div>
    </div>
  `

  const cards = items
    .map((it) => {
      const label = mode === 'verify'
        ? `${it.ok ? '✓' : '✗'} S±${(it.ds * 100).toFixed(0)}% L±${(it.dl * 100).toFixed(0)}%`
        : formatHsl(it.hsl)
      const statusClass = mode === 'verify' ? (it.ok ? 'ok' : 'fail') : ''
      return `
        <div class="card ${statusClass}">
          <div class="chip" style="background:${it.hex}"></div>
          <div class="meta">
            <code>${it.hex}</code>
            <span class="label">${label}</span>
          </div>
        </div>
      `
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    :root {
      --bg: #0f1115;
      --surface: #1a1d23;
      --text: #e7e7e7;
      --muted: #9aa3b2;
      --ok: #4ade80;
      --fail: #f87171;
      --border: rgba(255,255,255,0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      background: var(--bg);
      color: var(--text);
      padding: 2rem;
    }
    h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
    .subtitle { color: var(--muted); margin-bottom: 2rem; }
    .target { display: flex; gap: 1.5rem; align-items: flex-start; margin-bottom: 2rem; }
    .swatch, .card { display: flex; flex-direction: column; gap: 0.5rem; }
    .chip { border-radius: 0.5rem; box-shadow: inset 0 0 0 1px var(--border); }
    .swatch.large .chip { width: 120px; height: 120px; }
    .card .chip { width: 96px; height: 96px; }
    .meta { display: flex; flex-direction: column; gap: 0.25rem; }
    code { font-size: 0.85rem; color: var(--text); }
    .label { font-size: 0.75rem; color: var(--muted); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 1rem; }
    .card { padding: 0.75rem; background: var(--surface); border-radius: 0.75rem; border: 1px solid var(--border); }
    .card.ok .label { color: var(--ok); }
    .card.fail .label { color: var(--fail); }
    .summary { margin-top: 2rem; color: var(--muted); font-size: 0.85rem; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="subtitle">目标色 ${targetHex} = ${formatHsl(targetHsl)} · S 容差 ${(satTol * 100).toFixed(0)}% · L 容差 ${(lightTol * 100).toFixed(0)}%</p>

  <div class="target">
    ${swatch(targetHex, formatHsl(targetHsl), 'large')}
    <div>
      <p>匹配规则：候选色与目标色的 HSL 饱和度（S）和明度（L）差值均不超过设定容差。</p>
      <p>色相变化不影响判定，便于批量生成同“亮度/鲜艳度”的色系。</p>
    </div>
  </div>

  <div class="grid">
    ${cards}
  </div>

  <p class="summary">共 ${items.length} 个颜色 · 生成时间 ${new Date().toLocaleString('zh-CN')}</p>
</body>
</html>
`
}

// ── CLI ────────────────────────────────────────────────────────

function printHelp() {
  console.log(`用法: node scripts/peacock-match.mjs [选项] [颜色...]

模式：
  --generate          按色相扫描生成候选色（默认）
  --verify            校验传入颜色是否满足 S/L 容差

选项：
  --target <hex>      目标色（默认 #f6ec91）
  --sat-tol <0..1>    饱和度容差（默认 0.10）
  --light-tol <0..1>  明度容差（默认 0.10）
  --hue-step <deg>    色相扫描步长（默认 15，生成 24 色）
  --html <path>       HTML 输出路径（默认 zRefs/peacock-colors.html）
  -h, --help          显示帮助

示例：
  node scripts/peacock-match.mjs
  node scripts/peacock-match.mjs --verify #ff5733 #33ff57 #f6ec91
  node scripts/peacock-match.mjs --target #f6ec91 --sat-tol 0.15 --hue-step 10
`)
}

function parseArgs(argv) {
  const options = {
    target: '#f6ec91',
    mode: 'generate',
    satTol: 0.1,
    lightTol: 0.1,
    hueStep: 15,
    html: 'zRefs/peacock-colors.html',
  }
  const inputs = []

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--generate':
        options.mode = 'generate'
        break
      case '--verify':
        options.mode = 'verify'
        break
      case '--target':
        options.target = argv[++i]
        break
      case '--sat-tol':
        options.satTol = Number(argv[++i])
        break
      case '--light-tol':
        options.lightTol = Number(argv[++i])
        break
      case '--hue-step':
        options.hueStep = Number(argv[++i])
        break
      case '--html':
        options.html = argv[++i]
        break
      case '-h':
      case '--help':
        printHelp()
        process.exit(0)
      default: {
        const hex = arg.startsWith('#') ? arg : `#${arg}`
        inputs.push(hex)
        break
      }
    }
  }

  return { options, inputs }
}

function main() {
  const { options, inputs } = parseArgs(process.argv)
  const targetHsl = rgbToHsl(hexToRgb(options.target))

  let items
  if (options.mode === 'verify') {
    if (inputs.length === 0) {
      console.error('错误：--verify 模式需要传入至少一个颜色')
      process.exit(1)
    }
    items = verifyCandidates(inputs, options.target, options.satTol, options.lightTol)
  } else {
    items = generateCandidates(options.target, options.hueStep)
  }

  const html = renderHtml(
    options.target,
    targetHsl,
    items,
    options.mode,
    options.satTol,
    options.lightTol,
  )

  const outPath = resolve(process.cwd(), options.html)
  writeFileSync(outPath, html, 'utf8')

  console.log(`目标色: ${options.target} = ${formatHsl(targetHsl)}`)
  console.log(`模式: ${options.mode}`)
  console.log(`HTML 已写入: ${outPath}`)
  console.log('')

  if (options.mode === 'verify') {
    const okCount = items.filter((it) => it.ok).length
    console.log(`校验结果: ${okCount}/${items.length} 通过`)
    for (const it of items) {
      const mark = it.ok ? '✓' : '✗'
      console.log(
        `${mark} ${it.hex} ${formatHsl(it.hsl)}  S±${(it.ds * 100).toFixed(1)}% L±${(it.dl * 100).toFixed(1)}%`,
      )
    }
  } else {
    console.log(`生成 ${items.length} 个候选色（hue step ${options.hueStep}°）`)
    for (const it of items) {
      console.log(`  ${it.hex} ${formatHsl(it.hsl)}`)
    }
  }
}

main()
