const fs = require('fs');
const path = require('path');

/**
 * 验证 CSV 文件格式
 * @param {string} filePath - 文件路径
 * @returns {boolean} 是否验证通过
 * @throws {Error} 验证失败时抛出详细错误信息
 */
function validateCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');

  if (lines.length < 2) {
    throw new Error(`CSV 文件 ${filePath} 格式错误：文件至少需要包含表头和一行数据`);
  }

  const header = lines[0];
  const requiredColumns = ['term', 'action', 'translation'];
  const columns = header.split(',').map(col => col.trim());

  for (const requiredCol of requiredColumns) {
    if (!columns.includes(requiredCol)) {
      throw new Error(`CSV 文件 ${filePath} 表头错误：缺少必需的列 "${requiredCol}"，当前列为 ${columns.join(', ')}`);
    }
  }

  if (!columns.includes('reason')) {
    console.warn(`提示：CSV 文件 ${filePath} 表头建议包含 "reason" 列用于记录翻译说明`);
  }

  const expectedColumnOrder = ['term', 'action', 'translation', 'reason'];
  const columnOrderMatches = expectedColumnOrder.every((col, index) => 
    !columns[index] || columns[index] === col
  );

  if (!columnOrderMatches) {
    console.warn(`提示：CSV 文件 ${filePath} 建议使用列顺序：${expectedColumnOrder.join(', ')}`);
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(',');
    if (parts.length < 3) {
      throw new Error(`CSV 文件 ${filePath} 第 ${i + 1} 行格式错误：至少需要 3 列数据，当前只有 ${parts.length} 列`);
    }

    const term = parts[0].trim();
    const action = parts[1].trim();
    const translation = parts[2] ? parts[2].trim() : '';

    if (!term) {
      throw new Error(`CSV 文件 ${filePath} 第 ${i + 1} 行错误："term" 字段不能为空`);
    }

    if (!action) {
      throw new Error(`CSV 文件 ${filePath} 第 ${i + 1} 行错误："action" 字段不能为空`);
    }

    if (!['keep', 'translate'].includes(action)) {
      throw new Error(`CSV 文件 ${filePath} 第 ${i + 1} 行错误："action" 字段值必须是 "keep" 或 "translate"，当前值为 "${action}"`);
    }

    if (action === 'translate' && !translation) {
      throw new Error(`CSV 文件 ${filePath} 第 ${i + 1} 行错误：当 action 为 "translate" 时，"translation" 字段不能为空`);
    }
  }

  return true;
}

/**
 * 验证 TOML 文件格式
 * @param {string} filePath - 文件路径
 * @returns {boolean} 是否验证通过
 * @throws {Error} 验证失败时抛出详细错误信息
 */
function validateTOML(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');

  if (!content.includes('domain = ')) {
    throw new Error(`TOML 文件 ${filePath} 格式错误：缺少必需的 "domain" 字段`);
  }

  if (!content.includes('[[rules]]')) {
    throw new Error(`TOML 文件 ${filePath} 格式错误：缺少必需的 [[rules]] 数组定义`);
  }

  const ruleMatches = content.matchAll(/\[\[rules\]\][\s\S]*?(?=\[\[rules\]\]|$)/g);
  let ruleIndex = 0;

  for (const match of ruleMatches) {
    const ruleText = match[0];
    
    const trimmedRuleText = ruleText.replace(/\[\[rules\]\]/, '').trim();
    
    if (!trimmedRuleText || trimmedRuleText.length === 0) {
      continue;
    }
    
    ruleIndex++;
    
    const termMatch = ruleText.match(/term\s*=\s*"([^"]+)"/);
    const actionMatch = ruleText.match(/action\s*=\s*"([^"]+)"/);
    const translationMatch = ruleText.match(/translation\s*=\s*"([^"]+)"/);
    const reasonMatch = ruleText.match(/reason\s*=\s*"([^"]+)"/);

    if (!termMatch) {
      throw new Error(`TOML 文件 ${filePath} 第 ${ruleIndex} 条规则错误：缺少必需的 "term" 字段`);
    }

    if (!actionMatch) {
      throw new Error(`TOML 文件 ${filePath} 第 ${ruleIndex} 条规则错误：缺少必需的 "action" 字段`);
    }

    const action = actionMatch[1];
    if (!['keep', 'translate'].includes(action)) {
      throw new Error(`TOML 文件 ${filePath} 第 ${ruleIndex} 条规则错误："action" 字段值必须是 "keep" 或 "translate"，当前值为 "${action}"`);
    }

    if (action === 'translate') {
      if (!translationMatch) {
        throw new Error(`TOML 文件 ${filePath} 第 ${ruleIndex} 条规则错误：当 action 为 "translate" 时，"translation" 字段不能为空`);
      }
      if (!translationMatch[1]) {
        throw new Error(`TOML 文件 ${filePath} 第 ${ruleIndex} 条规则错误："translation" 字段不能为空字符串`);
      }
    }

    if (!reasonMatch) {
      console.warn(`提示：TOML 文件 ${filePath} 第 ${ruleIndex} 条规则建议添加 "reason" 字段用于记录翻译说明`);
    }
  }

  if (ruleIndex === 0) {
    throw new Error(`TOML 文件 ${filePath} 格式错误：[[rules]] 数组中没有任何规则定义`);
  }

  return true;
}

/**
 * 验证术语表文件
 * @param {string} filePath - 文件路径
 * @returns {boolean} 是否验证通过
 * @throws {Error} 验证失败时抛出详细错误信息
 */
function validateGlossaryFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`术语表文件不存在：${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv') {
    return validateCSV(filePath);
  } else if (ext === '.toml') {
    return validateTOML(filePath);
  } else {
    throw new Error(`术语表文件格式不支持：${filePath}，仅支持 .csv 和 .toml 格式`);
  }
}

module.exports = {
  validateCSV,
  validateTOML,
  validateGlossaryFile
};
