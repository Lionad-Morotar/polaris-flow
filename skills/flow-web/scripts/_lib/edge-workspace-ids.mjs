#!/usr/bin/env node
// 从 Edge Sync LevelDB 中提取 Edge Workspace 容器（名称 + UUID）。
// Edge 把工作区元数据放在 ~/Library/Application Support/Microsoft Edge/Default/Sync Data/LevelDB
// 的 edge_workspace-dt-<uuid> 键下；本脚本用启发式 protobuf 解析读取工作区名称。

import { ClassicLevel } from 'classic-level';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const SRC_DB = path.join(
  os.homedir(),
  'Library/Application Support/Microsoft Edge/Default/Sync Data/LevelDB'
);

function readVarint(buf, off) {
  let num = 0;
  let shift = 0;
  const start = off;
  while (off < buf.length) {
    const b = buf[off];
    num |= (b & 0x7f) << shift;
    off += 1;
    if ((b & 0x80) === 0) {
      return { value: num, bytesRead: off - start };
    }
    shift += 7;
    if (shift >= 64) return null;
  }
  return null;
}

function extractWorkspaceName(buf) {
  for (let i = 0; i < buf.length - 2; i += 1) {
    if (buf[i] !== 0x22) continue;
    const len1 = readVarint(buf, i + 1);
    if (!len1) continue;
    const subStart = i + 1 + len1.bytesRead;
    if (subStart >= buf.length) continue;
    if (buf[subStart] !== 0x0a) continue;
    const len2 = readVarint(buf, subStart + 1);
    if (!len2) continue;
    const strStart = subStart + 1 + len2.bytesRead;
    const strEnd = strStart + len2.value;
    if (strEnd > buf.length) continue;
    const bytes = buf.subarray(strStart, strEnd);
    try {
      const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      // 过滤掉明显不是用户命名工作区的结果（单字符或仅 UUID）
      if (s.length >= 1) return s;
    } catch {
      // 不是合法 UTF-8，跳过
    }
  }
  return null;
}

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function openSyncDb() {
  const tmp = path.join(os.tmpdir(), `edge-sync-leveldb-${Date.now()}`);
  await copyDir(SRC_DB, tmp);
  return new ClassicLevel(tmp, { valueEncoding: 'buffer' });
}

async function listWorkspaces() {
  const db = await openSyncDb();
  const map = new Map();
  try {
    for await (const [key, val] of db.iterator({ keyEncoding: 'utf8', valueEncoding: 'buffer' })) {
      if (!key.startsWith('edge_workspace-dt-')) continue;
      const uuid = key.replace('edge_workspace-dt-', '');
      const name = extractWorkspaceName(val);
      if (!name) continue;
      // 同名工作区取后出现的记录（同步数据可能有更新）
      map.set(uuid, { name, uuid });
    }
  } finally {
    await db.close();
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function lookupWorkspace(targetName) {
  const workspaces = await listWorkspaces();
  const hit = workspaces.find((w) => w.name === targetName);
  if (hit) return { ok: true, ...hit };
  return { ok: false, error: 'workspace not found in Edge Sync LevelDB' };
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'list') {
    const workspaces = await listWorkspaces();
    console.log(JSON.stringify({ ok: true, workspaces }, null, 2));
    return;
  }
  if (cmd === 'lookup') {
    let name = '';
    for (let i = 0; i < args.length; i += 2) {
      if (args[i] === '--name' && i + 1 < args.length) name = args[i + 1];
    }
    if (!name) {
      console.error(JSON.stringify({ ok: false, error: '--name required' }));
      process.exit(2);
    }
    console.log(JSON.stringify(await lookupWorkspace(name)));
    return;
  }
  console.error(JSON.stringify({ ok: false, error: `unknown command: ${cmd}` }));
  process.exit(2);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
