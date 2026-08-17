const fs = require('fs');
const path = require('path');
const { readInnerDictionary } = require('./dict');

let francPromise;

function normalizeLanguageTag(language) {
  if (!language) return '';
  const value = String(language).trim().toLowerCase();
  if (!value) return '';

  const normalized = value.replace(/_/g, '-');
  const base = normalized.split('-')[0];
  return base;
}

function normalizeTargetLanguage(targetLanguage) {
  if (!targetLanguage) return '';
  const value = String(targetLanguage).trim().toLowerCase();
  if (!value) return '';

  if (value === '中文' || value === '汉语' || value === '简体中文' || value === '繁體中文' || value === '繁体中文') {
    return 'zh';
  }
  if (value === '英文' || value === '英语' || value === 'english') return 'en';
  if (value === '日文' || value === '日语' || value === 'japanese') return 'ja';
  if (value === '韩文' || value === '韩语' || value === 'korean') return 'ko';
  if (value === '俄文' || value === '俄语' || value === 'russian') return 'ru';

  const base = normalizeLanguageTag(value);
  if (base === 'zh' || base === 'en' || base === 'ja' || base === 'ko' || base === 'ru') return base;
  return base || value;
}

function loadFranc() {
  if (!francPromise) {
    francPromise = import('franc').then(m => ({ franc: m.franc, francAll: m.francAll }));
  }
  return francPromise;
}

function getTargetFrancCodes(targetLanguage) {
  const target = normalizeTargetLanguage(targetLanguage);

  if (target === 'zh') return new Set(['cmn', 'zho', 'yue', 'wuu']);
  if (target === 'en') return new Set(['eng']);
  if (target === 'ja') return new Set(['jpn']);
  if (target === 'ko') return new Set(['kor']);
  if (target === 'ru') return new Set(['rus']);

  return new Set();
}

function getDefaultFrancOnlyList() {
  return [
    'cmn',
    'zho',
    'yue',
    'wuu',
    'eng',
    'jpn',
    'kor',
    'rus'
  ];
}

function getFrancOnlyListFromConfig(config) {
  const defaultOnly = getDefaultFrancOnlyList();
  const defaultOnlySet = new Set(defaultOnly);

  const configOnly = Array.isArray(config?.translation?.langdetectOnly) ? config.translation.langdetectOnly : [];
  const filtered = configOnly
    .map(item => String(item || '').trim().toLowerCase())
    .filter(item => defaultOnlySet.has(item));

  return filtered.length > 0 ? filtered : defaultOnly;
}

function isMarkdownFile(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return ext === '.md' || ext === '.mdx' || ext === '.markdown';
}

function stripMarkdownTables(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];

  const isSeparatorLine = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  const looksLikeTableRow = (line) => {
    const pipeCount = (String(line).match(/\|/g) || []).length;
    return pipeCount >= 2;
  };

  let inTable = false;

  for (const line of lines) {
    if (isSeparatorLine(line)) {
      if (output.length > 0 && looksLikeTableRow(output[output.length - 1])) output.pop();
      inTable = true;
      continue;
    }

    if (inTable) {
      if (!line.trim()) continue;
      if (looksLikeTableRow(line)) continue;
      inTable = false;
    }

    output.push(line);
  }

  return output.join('\n');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripDictionaryWords(text, config) {
  const dict = readInnerDictionary({ dictPath: config?.translation?.dictPath });
  if (!Array.isArray(dict) || dict.length === 0) return text;

  const tokenChars = 'A-Za-z0-9.+-';
  const words = dict
    .map(w => String(w || '').trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  let value = String(text || '');
  for (const word of words) {
    const escaped = escapeRegExp(word);
    const re = new RegExp(`(^|[^${tokenChars}])(${escaped})(?=$|[^${tokenChars}])`, 'gi');
    value = value.replace(re, '$1');
  }

  return value;
}

function cleanMarkdownForLangdetect(markdown, config) {
  let value = String(markdown || '');

  value = value.replace(/^\uFEFF/, '');
  value = value.replace(/^---[\s\S]*?\n---\s*/m, '');
  value = value.replace(/```\w+\r?\n[\s\S]*?\r?\n```/g, ' ');
  value = value.replace(/~~~[\s\S]*?~~~/g, ' ');
  value = value.replace(/\*\*[\s\S]*?\*\*/g, ' ');
  value = value.replace(/<!--[\s\S]*?-->/g, ' ');
  value = value.replace(/!\[[^\]]*]\([^)]*\)/g, ' ');
  value = value.replace(/\[([^\]]+)]\([^)]*\)/g, '$1');
  value = value.replace(/^\[[^\]]+]:\s*\S+.*$/gm, ' ');
  value = value.replace(/`[^`]*`/g, ' ');
  value = value.replace(/<[^>]+>/g, ' ');
  value = value.replace(/^#{1,6}\s+/gm, '');
  value = value.replace(/^\s*>\s+/gm, '');
  value = value.replace(/^\s*[-*+]\s+/gm, '');
  value = value.replace(/^\s*\d+\.\s+/gm, '');

  // "1.2、1.1.2"
  value = value.replace(/\d+(?:\.\d)+\.?/g, ' ');

  // url
  value = value.replace(/https?:\/\/\S+/g, ' ');

  // table
  value = stripMarkdownTables(value);
  value = stripDictionaryWords(value, config);

  // "[] task"
  value = value.replace(/\[[xX\s]\]/g, '');

  // collapse multiple space
  value = value.replace(/\s+/g, ' ').trim();

  return value;
}

async function detectLanguageFromText(text, config) {
  if (!text) return 'unknown';
  const value = String(text);
  if (!value.trim()) return 'unknown';

  const { francAll } = await loadFranc();
  const minLengthFromConfig = Number(config?.translation?.langdetectMinLength);
  const minLength = Number.isFinite(minLengthFromConfig) && minLengthFromConfig > 0 ? minLengthFromConfig : 3;

  const minScoreFromConfig = Number(config?.translation?.langdetectMinScore);
  const minScore = Number.isFinite(minScoreFromConfig) && minScoreFromConfig >= 0 && minScoreFromConfig <= 1 ? minScoreFromConfig : 0.7;

  const only = getFrancOnlyListFromConfig(config);

  const results = francAll(value, { minLength, only });
  if (!Array.isArray(results) || results.length === 0) return 'unknown';

  const [topLang, topScore] = results[0];
  if (!topLang || topLang === 'und') return 'unknown';
  if (typeof topScore === 'number' && topScore < minScore) return 'unknown';

  return String(topLang).trim().toLowerCase();
}

function readFileHead(filePath, maxBytes) {
  const bytes = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 65536;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function detectLanguageFromFile(filePath, config) {
  const maxBytesFromConfig = Number(config?.translation?.langdetectMaxBytes);
  const sample = readFileHead(filePath, Number.isFinite(maxBytesFromConfig) && maxBytesFromConfig > 0 ? maxBytesFromConfig : 65536);
  const cleaned = isMarkdownFile(filePath) ? cleanMarkdownForLangdetect(sample, config) : sample;

  // console.log('[info] cleaned', cleaned)
  return detectLanguageFromText(cleaned, config);
}

function isTranslatableByLanguage(filePath, config) {
  return isFileTranslated(filePath, config).then(translated => !translated);
}

async function isFileTranslated(filePath, config) {
  const target = normalizeTargetLanguage(config?.targetLanguage || '中文');
  if (!target) return false;

  const maxBytesFromConfig = Number(config?.translation?.langdetectMaxBytes);
  const maxBytes = Number.isFinite(maxBytesFromConfig) && maxBytesFromConfig > 0 ? maxBytesFromConfig : 65536;

  let sample = '';
  try {
    sample = readFileHead(filePath, maxBytes);
  } catch (error) {
    return false;
  }

  if (isMarkdownFile(filePath)) {
    sample = cleanMarkdownForLangdetect(sample, config);
  }

  const allowed = getTargetFrancCodes(target);
  if (allowed.size === 0) return false;

  const { francAll } = await loadFranc();
  const minLengthFromConfig = Number(config?.translation?.langdetectMinLength);
  const minLength = Number.isFinite(minLengthFromConfig) && minLengthFromConfig > 0 ? minLengthFromConfig : 3;

  const only = getFrancOnlyListFromConfig(config);

  const results = francAll(sample, { minLength, only });
  if (!Array.isArray(results) || results.length === 0) return false;
  // console.log('[info] results', results)

  const topNFromConfig = Number(config?.translation?.langdetectTopN);
  const topN = Number.isFinite(topNFromConfig) && topNFromConfig > 0 ? Math.floor(topNFromConfig) : 3;

  const minScoreFromConfig = Number(config?.translation?.langdetectTopMinScore);
  const minScore = Number.isFinite(minScoreFromConfig) && minScoreFromConfig >= 0 && minScoreFromConfig <= 1 ? minScoreFromConfig : 0.9;

  const topResults = results.slice(0, topN);
  for (const [lang, score] of topResults) {
    const normalizedLang = String(lang || '').trim().toLowerCase();
    if (!allowed.has(normalizedLang)) continue;
    if (typeof score === 'number' && score >= minScore) return true;
  }

  return false;
}

module.exports = {
  normalizeLanguageTag,
  normalizeTargetLanguage,
  detectLanguageFromText,
  detectLanguageFromFile,
  isFileTranslated,
  isTranslatableByLanguage
};
