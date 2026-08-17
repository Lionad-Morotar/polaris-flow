const fs = require('fs');
const path = require('path');

const DEFAULT_INNER_DICT_PATH = path.join(__dirname, 'inner.json');
const DEFAULT_TEMP_TXT_PATH = path.join(__dirname, 'temp.txt');

function loadDictTrie(dictPath) {
  const filePath = dictPath || DEFAULT_INNER_DICT_PATH;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function saveDictTrie(dictPath, trie) {
  const filePath = dictPath || DEFAULT_INNER_DICT_PATH;
  const safeTrie = trie && typeof trie === 'object' && !Array.isArray(trie) ? trie : {};

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(safeTrie, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function normalizeWordForDict(word) {
  return String(word || '').trim().toLowerCase();
}

function extractEnglishWordsBySpaces(text) {
  const value = String(text || '');
  const map = new Map();

  const re = /(?:^|\s)([A-Za-z][A-Za-z0-9.+-]*)(?=\s|$)/g;
  for (const match of value.matchAll(re)) {
    const original = match?.[1];
    if (!original) continue;
    const normalized = normalizeWordForDict(original);
    if (!normalized) continue;
    if (normalized.length >= 3) {
      if (!map.has(normalized)) {
        map.set(normalized, original);
      }
    }
  }

  return Array.from(map, ([normalized, original]) => ({ normalized, original }));
}

function insertWordIntoTrie(trie, normalizedWord, originalWord) {
  const word = String(normalizedWord || '').trim().toLowerCase();
  if (!word) return false;

  let node = trie;
  for (const ch of word) {
    const next = node[ch];
    if (!next || typeof next !== 'object' || Array.isArray(next)) node[ch] = {};
    node = node[ch];
  }

  if (typeof node.$ === 'string' && node.$) return false;
  node.$ = String(originalWord || normalizedWord);
  return true;
}

function trieToWordList(trie) {
  const results = [];

  const walk = (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (typeof node.$ === 'string' && node.$) results.push(node.$);

    for (const [key, child] of Object.entries(node)) {
      if (key === '$') continue;
      walk(child);
    }
  };

  walk(trie);
  return Array.from(new Set(results)).sort((a, b) => a.localeCompare(b));
}

function readInnerDictionary(options) {
  const trie = loadDictTrie(options?.dictPath);
  return trieToWordList(trie);
}

function extractAndWriteInnerDictionary(text, options) {
  const words = extractEnglishWordsBySpaces(text);
  if (words.length === 0) return { words: [], added: [] };

  const trie = loadDictTrie(options?.dictPath);
  const added = [];

  for (const { normalized, original } of words) {
    const ok = insertWordIntoTrie(trie, normalized, original);
    if (ok) added.push(original);
  }

  if (added.length > 0) saveDictTrie(options?.dictPath, trie);
  return { words: words.map(w => w.original), added };
}

function extractAndWriteInnerDictionaryFromTempTxt(options) {
  const tempTxtPath = options?.tempTxtPath || DEFAULT_TEMP_TXT_PATH;

  let text = '';
  try {
    text = fs.readFileSync(tempTxtPath, 'utf8');
  } catch (error) {
    return { words: [], added: [], tempTxtPath };
  }

  if (!text || !text.trim()) return { words: [], added: [], tempTxtPath };

  const result = extractAndWriteInnerDictionary(text, { dictPath: options?.dictPath });
  return { ...result, tempTxtPath };
}

module.exports = {
  readInnerDictionary,
  extractAndWriteInnerDictionary,
  extractAndWriteInnerDictionaryFromTempTxt,
};
