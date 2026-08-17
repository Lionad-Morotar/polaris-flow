/**
 * 翻译状态跟踪模块
 *
 * 使用 JSONL 文件记录每个文件的翻译状态，供主代理轮询子代理完成情况。
 * 文件路径: {projectPath}/.tp/.translation-status.jsonl
 */

const fs = require('fs');
const path = require('path');

const STATUS_FILE = '.translation-status.jsonl';

function getStatusFilePath(projectPath) {
  return path.join(projectPath, '.tp', STATUS_FILE);
}

function ensureStatusFile(projectPath) {
  const statusPath = getStatusFilePath(projectPath);
  const statusDir = path.dirname(statusPath);

  if (!fs.existsSync(statusDir)) {
    fs.mkdirSync(statusDir, { recursive: true });
  }

  if (!fs.existsSync(statusPath)) {
    fs.writeFileSync(statusPath, '', 'utf-8');
  }

  return statusPath;
}

function readStatusFile(projectPath) {
  const statusPath = getStatusFilePath(projectPath);
  if (!fs.existsSync(statusPath)) {
    return [];
  }

  const content = fs.readFileSync(statusPath, 'utf-8').trim();
  if (!content) return [];

  const records = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch (error) {
      // 忽略损坏的行
    }
  }

  return records;
}

function recordStatus(projectPath, id, status, type = 'file', meta = {}) {
  const statusPath = ensureStatusFile(projectPath);

  const record = {
    id,
    type, // 'file' | 'commit'
    status, // 'completed' | 'failed'
    timestamp: Date.now(),
    ...meta
  };

  // 兼容旧版本：同时保留 filePath 字段
  if (type === 'file') {
    record.filePath = id;
  } else if (type === 'commit') {
    record.commitId = id;
  }

  fs.appendFileSync(statusPath, JSON.stringify(record) + '\n', 'utf-8');
}

function getLatestStatusMap(projectPath, type = null) {
  const records = readStatusFile(projectPath);
  const map = new Map();

  for (const record of records) {
    if (!record || !record.status) continue;
    const recordId = record.id || record.filePath || record.commitId;
    if (!recordId) continue;
    if (type && record.type !== type) continue;
    map.set(recordId, record);
  }

  return map;
}

function getCompletedIds(projectPath, type = null) {
  const map = getLatestStatusMap(projectPath, type);
  return Array.from(map.entries())
    .filter(([, record]) => record.status === 'completed')
    .map(([id]) => id);
}

function getFailedIds(projectPath, type = null) {
  const map = getLatestStatusMap(projectPath, type);
  return Array.from(map.entries())
    .filter(([, record]) => record.status === 'failed')
    .map(([id]) => id);
}

// 保持向后兼容的别名
function getCompletedFiles(projectPath) {
  return getCompletedIds(projectPath, 'file');
}

function getFailedFiles(projectPath) {
  return getFailedIds(projectPath, 'file');
}

function clearStatusFile(projectPath) {
  const statusPath = getStatusFilePath(projectPath);
  if (fs.existsSync(statusPath)) {
    fs.unlinkSync(statusPath);
  }

  // 如果 .tp 目录为空，也一并删除
  const statusDir = path.dirname(statusPath);
  if (fs.existsSync(statusDir)) {
    try {
      const files = fs.readdirSync(statusDir);
      if (files.length === 0) {
        fs.rmdirSync(statusDir);
      }
    } catch (error) {
      // 忽略删除目录失败的情况
    }
  }
}

module.exports = {
  getStatusFilePath,
  ensureStatusFile,
  recordStatus,
  getLatestStatusMap,
  getCompletedIds,
  getFailedIds,
  getCompletedFiles,
  getFailedFiles,
  clearStatusFile
};
