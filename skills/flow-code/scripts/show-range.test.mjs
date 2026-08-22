#!/usr/bin/env node
/**
 * show-range.mjs 形态探测测试：ahead / behind / diverged / 无变动退化 / 超窗无变动
 * 夹具：临时 git 仓库，feature 分支以本地 main 为 upstream
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'show-range.mjs')

const git = (repo, args, env = {}) =>
  execSync(`git -c user.name=t -c user.email=t@t.c -c commit.gpgsign=false ${args}`, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  }).trim()

function commitFile(repo, path, content, message, date) {
  mkdirSync(dirname(join(repo, path)), { recursive: true })
  writeFileSync(join(repo, path), content)
  git(repo, `add ${JSON.stringify(path)}`)
  const env = date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}
  git(repo, `commit -q --no-verify -m ${JSON.stringify(message)}`, env)
}

function mkRepo(t) {
  const repo = mkdtempSync(join(tmpdir(), 'show-range-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  git(repo, 'init -q -b main')
  return repo
}

/** feature 分支以 main 为 upstream 并切到 feature */
function trackFeature(repo) {
  git(repo, 'checkout -q -b feature')
  git(repo, 'branch -u main')
}

function runScript(repo) {
  const raw = execSync(`node ${JSON.stringify(SCRIPT)}`, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  return JSON.parse(raw)
}

test('ahead：本地领先 upstream，direction=ahead，range 指向 HEAD', (t) => {
  const repo = mkRepo(t)
  commitFile(repo, 'base.txt', 'base', 'init')
  trackFeature(repo)
  commitFile(repo, 'ours.txt', 'x', 'ours')
  const r = runScript(repo)
  assert.equal(r.strategy, 'upstream')
  assert.equal(r.direction, 'ahead')
  assert.equal(r.commits, 1)
  assert.equal(r.range, 'main...HEAD')
  assert.equal(r.incomingCommits, undefined)
})

test('behind：纯落后，direction=behind，range 翻转为 HEAD...upstream', (t) => {
  const repo = mkRepo(t)
  commitFile(repo, 'base.txt', 'base', 'init')
  trackFeature(repo)
  git(repo, 'checkout -q main')
  commitFile(repo, 'theirs.txt', 'y', 'theirs')
  git(repo, 'checkout -q feature')
  const r = runScript(repo)
  assert.equal(r.strategy, 'upstream')
  assert.equal(r.direction, 'behind')
  assert.equal(r.commits, 1)
  assert.equal(r.range, 'HEAD...main')
})

test('diverged：双边分叉，附 incomingRange/incomingCommits 描述远端待合入面', (t) => {
  const repo = mkRepo(t)
  commitFile(repo, 'base.txt', 'base', 'init')
  trackFeature(repo)
  commitFile(repo, 'ours.txt', 'x', 'ours')
  git(repo, 'checkout -q main')
  commitFile(repo, 'theirs.txt', 'y', 'theirs')
  git(repo, 'checkout -q feature')
  const r = runScript(repo)
  assert.equal(r.direction, 'diverged')
  assert.equal(r.commits, 1)
  assert.equal(r.incomingCommits, 1)
  assert.equal(r.range, 'main...HEAD')
  assert.equal(r.incomingRange, 'HEAD...main')
})

test('无分叉无落后：退化链落到时间窗（本地 main 即 upstream，L2 排除自比）', (t) => {
  const repo = mkRepo(t)
  commitFile(repo, 'base.txt', 'base', 'init')
  trackFeature(repo)
  const r = runScript(repo)
  assert.equal(r.strategy, 'month')
  assert.equal(r.direction, 'ahead')
  assert.ok(r.fallbacks.length >= 2)
})

test('超窗无变动：退出码 1', (t) => {
  const repo = mkRepo(t)
  commitFile(repo, 'base.txt', 'base', 'old init', '2026-01-01T00:00:00+08:00')
  trackFeature(repo)
  let err = null
  try {
    runScript(repo)
  } catch (e) {
    err = e
  }
  assert.ok(err, '应当非零退出')
  assert.equal(err.status, 1)
  assert.equal(JSON.parse(err.stdout).ok, false)
})
