const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 获取默认配置
 * @returns {Object} 默认配置对象
 */
function getDefaultConfig() {
  return {
    targetLanguage: "中文",
    taskTrackingFile: ".todo/tp-tasks.md",
    fileFilters: {
      ignoreGitignore: true,
      supportedExtensions: [
        ".md", ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".cpp", ".c", 
        ".h", ".hpp", ".go", ".rs", ".kt", ".swift", ".rb", ".php", 
        ".scala", ".cs", ".vue"
      ],
      excludeFiles: ["LICENSE", "COPYRIGHT", "COPYING", "LICENSE.md", "LICENSE.txt", "CHANGELOG.md", "CONTRIBUTING.md"],
      excludeDirs: [
        "__pycache__", ".git", ".idea", "node_modules", "venv", "env", 
        "dist", "build", "target", ".vscode"
      ]
    },
    translation: {
      priority: ["README.md", "CONTRIBUTING.md", "CHANGELOG.md", "docs/", "src/", "lib/", "app/"],
      previewLines: 20
    }
  };
}

/**
 * 加载配置（支持多层级）
 * 优先级：项目配置 > 个人配置 > 默认配置
 * 
 * @param {string} projectPath - 项目路径
 * @returns {Object} 配置对象
 */
function loadConfig(projectPath) {
  const defaultConfig = getDefaultConfig();
  
  // 1. 加载个人配置 (~/.tp/config.json)
  const personalConfigPath = path.join(os.homedir(), '.tp', 'config.json');
  let personalConfig = {};
  if (fs.existsSync(personalConfigPath)) {
    try {
      const content = fs.readFileSync(personalConfigPath, 'utf-8');
      personalConfig = JSON.parse(content);
    } catch (error) {
      console.warn(`警告: 无法加载个人配置文件 ${personalConfigPath}: ${error.message}`);
    }
  }
  
  // 2. 加载项目配置 (<project>/.tp/config.json)
  let projectConfig = {};
  if (projectPath) {
    const projectConfigPath = path.join(projectPath, '.tp', 'config.json');
    if (fs.existsSync(projectConfigPath)) {
      try {
        const content = fs.readFileSync(projectConfigPath, 'utf-8');
        projectConfig = JSON.parse(content);
        projectConfig._source = 'project';
      } catch (error) {
        console.warn(`警告: 无法加载项目配置文件 ${projectConfigPath}: ${error.message}`);
      }
    }
  }
  
  // 3. 合并配置（项目 > 个人 > 默认）
  const mergedConfig = deepMerge(defaultConfig, personalConfig, projectConfig);
  
  // 记录配置来源
  if (!mergedConfig._source) {
    if (projectConfig._source) {
      mergedConfig._source = 'project';
    } else if (Object.keys(personalConfig).length > 0) {
      mergedConfig._source = 'personal';
    } else {
      mergedConfig._source = 'default';
    }
  }
  
  return mergedConfig;
}

/**
 * 深度合并多个对象
 * 对象递归合并，数组合并去重
 */
function deepMerge(...objects) {
  const result = {};
  
  for (const obj of objects) {
    for (const key in obj) {
      if (key.startsWith('_')) {
        // 保留内部属性
        result[key] = obj[key];
      } else if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        // 递归合并对象
        result[key] = deepMerge(result[key] || {}, obj[key]);
      } else if (Array.isArray(obj[key])) {
        // 数组合并（去重）
        const existing = Array.isArray(result[key]) ? result[key] : [];
        result[key] = [...new Set([...existing, ...obj[key]])];
      } else {
        // 基本类型直接覆盖
        result[key] = obj[key];
      }
    }
  }
  
  return result;
}

module.exports = {
  loadConfig,
  getDefaultConfig,
  deepMerge
};
