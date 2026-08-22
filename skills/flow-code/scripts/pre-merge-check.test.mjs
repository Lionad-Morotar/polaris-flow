#!/usr/bin/env node
/**
 * pre-merge-check.mjs 确认点探测测试：overlap 交集 / 迁移 journal 核对 / 无 journal 结构
 * 夹具：临时 git 仓库，HEAD=feature，theirs=main（main 模拟待合入面）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'pre-merge-check.mjs')

const git = (repo, args) =>
  execSync(`git -c user.name=t -c user.email=t@t.c -c commit.gpgsign=false ${args}`, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()

function commitFile(repo, path, content, message) {
  mkdirSync(dirname(join(repo, path)), { recursive: true })
  writeFileSync(join(repo, path), content)
  git(repo, `add ${JSON.stringify(path)}`)
  git(repo, `commit -q --no-verify -m ${JSON.stringify(message)}`)
}

function mkRepo(t) {
  const repo = mkdtempSync(join(tmpdir(), 'pre-merge-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  git(repo, 'init -q -b main')
  return repo
}

function runScript(repo, theirs) {
  const raw = execSync(`node ${JSON.stringify(SCRIPT)} ${theirs}`, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  return JSON.parse(raw)
}

const journalWith = (tags) =>
  JSON.stringify({ version: '7', dialect: 'postgresql', entries: tags.map((tag, idx) => ({ idx, version: '7', when: 1, tag, breakpoints: true })) })

test('overlap：仅双边同改文件进入交集，单边改动不进', (t) => {
  const repo = mkRepo(t)
  commitFile(repo, 'a.txt', 'base', 'init a')
  commitFile(repo, 'b.txt', 'base', 'init b')
  git(repo, 'checkout -q -b feature')
  commitFile(repo, 'a.txt', 'ours', 'ours touches a')
  git(repo, 'checkout -q main')
  commitFile(repo, 'a.txt', 'theirs', 'theirs touches a')
  commitFile(repo, 'b.txt', 'theirs', 'theirs touches b')
  commitFile(repo, 'c.txt', 'theirs', 'theirs adds c')
  git(repo, 'checkout -q feature')

  const r = runScript(repo, 'main')
  assert.equal(r.ok, true)
  assert.deepEqual(r.overlap, ['a.txt'])
  assert.equal(r.migrations, null)
})

test('migrations：journal 未登记的迁移进 unregistered，同数字前缀进 numberCollisions', (t) => {
  const repo = mkRepo(t)
  commitFile(repo, 'server/db/migrations/0001_init.sql', 'SELECT 1', 'mig 0001')
  commitFile(repo, 'server/db/migrations/meta/_journal.json', journalWith(['0001_init']), 'journal 0001')
  git(repo, 'checkout -q -b feature')
  commitFile(repo, 'unrelated.txt', 'ours', 'ours')
  git(repo, 'checkout -q main')
  // theirs 侧：0002 未登记；0003_b 登记 + 0003_c 未登记（编号撞车组）
  commitFile(repo, 'server/db/migrations/0002_a.sql', 'SELECT 2', 'mig 0002 未登记')
  commitFile(repo, 'server/db/migrations/0003_b.sql', 'SELECT 3', 'mig 0003_b')
  commitFile(repo, 'server/db/migrations/0003_c.sql', 'SELECT 3', 'mig 0003_c 未登记')
  commitFile(repo, 'server/db/migrations/meta/_journal.json', journalWith(['0001_init', '0003_b']), 'journal 登记 0003_b')
  git(repo, 'checkout -q feature')

  const r = runScript(repo, 'main')
  assert.equal(r.migrations.length, 1)
  const m = r.migrations[0]
  assert.deepEqual(m.unregistered, ['0002_a.sql', '0003_c.sql'])
  assert.deepEqual(m.numberCollisions, [['0003_b.sql', '0003_c.sql']])
})

test('migrations：meta 目录嵌套文件不计入迁移清单', (t) => {
  const repo = mkRepo(t)
  commitFile(repo, 'db/migrations/0001_init.sql', 'SELECT 1', 'mig')
  commitFile(repo, 'db/migrations/meta/_journal.json', journalWith(['0001_init']), 'journal')
  git(repo, 'checkout -q -b feature')
  commitFile(repo, 'x.txt', 'x', 'x')
  git(repo, 'checkout -q main')
  commitFile(repo, 'db/migrations/meta/0001_snapshot.json', '{}', 'snapshot 是 meta 下文件不是迁移')
  git(repo, 'checkout -q feature')

  const r = runScript(repo, 'main')
  assert.deepEqual(r.migrations[0].unregistered, [])
  assert.deepEqual(r.migrations[0].numberCollisions, [])
})
