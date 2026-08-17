const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { isSupportedFile } = require('./filter');

/**
 * 检查文件是否被修改
 * @param {string} projectPath - 项目路径
 * @param {string} filePath - 文件路径
 * @param {string} targetBranch - 目标分支
 * @returns {boolean} 是否被修改
 */
function checkFileModified(projectPath, filePath, targetBranch = 'upstream/master') {
  try {
    const relativePath = path.relative(projectPath, filePath);
    const diffOutput = execSync(
      `git diff ${targetBranch} -- "${relativePath}"`,
      { cwd: projectPath, encoding: 'utf-8' }
    );

    return diffOutput.trim().length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * 检测已修改的文件（与目标分支对比）
 * @param {string} projectPath - 项目路径
 * @param {string} targetBranch - 目标分支
 * @returns {Array} 已修改的文件列表
 */
function detectModifiedFiles(projectPath, targetBranch = 'upstream/master') {
  try {
    const { loadConfig } = require('./config');
    const config = loadConfig(projectPath);

    const diffOutput = execSync(
      `git diff --name-only ${targetBranch}`,
      { cwd: projectPath, encoding: 'utf-8' }
    );

    const changedFiles = diffOutput.trim().split('\n').filter(Boolean);
    const modifiedFiles = [];

    for (const file of changedFiles) {
      const filePath = path.join(projectPath, file);
      const filename = path.basename(file);

      if (fs.existsSync(filePath) && isSupportedFile(filename, config)) {
        modifiedFiles.push(filePath);
      }
    }

    return modifiedFiles;
  } catch (error) {
    console.warn(`检测修改文件失败: ${error.message}`);
    return [];
  }
}

/**
 * 恢复文件到上游版本
 * @param {string} projectPath - 项目路径
 * @param {string} filePath - 文件路径
 */
function restoreUpstreamVersion(projectPath, filePath, targetBranch = 'upstream/master') {
  try {
    const relativePath = path.relative(projectPath, filePath);
    const command = `git checkout ${targetBranch} -- "${relativePath}"`;

    execSync(command, { cwd: projectPath, stdio: 'inherit' });
    console.log(`已恢复上游版本: ${filePath}`);
  } catch (error) {
    throw new Error(`恢复上游版本失败: ${error.message}`);
  }
}

/**
 * 获取 Git 仓库根目录
 * @param {string} cwd - 起始目录（可选，默认当前工作目录）
 * @returns {string|null} Git 仓库根目录，如果不是 git 仓库则返回 null
 */
function getGitRoot(cwd = process.cwd()) {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'] // 忽略错误输出
    }).trim();
    return root;
  } catch (error) {
    return null;
  }
}

/**
 * 获取当前翻译基点标签
 *
 * 只认 `v-<hash>` 格式的标签（翻译对齐状态机的基点锚点），排除上游
 * release tag（v0.8.2 等）。原因：仓库里两类 tag 共存，用裸
 * `git describe --tags` 会返回距离 HEAD 最近的任意 tag，可能误取上游
 * release tag，导致把「上游版本」误当「翻译基点」。
 *
 * 「最近」定义：从 HEAD 沿祖先链回溯，第一个遇到的基点 tag。
 *
 * @param {string} projectPath - 项目路径
 * @returns {string|null} 基点标签名（v-<hash>），无则 null
 */
/**
 * 探测可用的 upstream 远端分支名（upstream/main 优先，回退 origin/main）
 * @param {string} projectPath - 项目路径
 * @returns {string|null} upstream 分支全名（如 'upstream/main'），无则 null
 */
function detectUpstreamBranch(projectPath) {
  for (const candidate of ['upstream/main', 'origin/main']) {
    try {
      execSync(`git rev-parse --verify ${candidate}^{commit}`, {
        cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
      });
      return candidate;
    } catch (_) { /* 该远端分支不存在，试下一个 */ }
  }
  return null;
}

/**
 * 校验基点 tag 指针是否指向上游 commit，偏离则 warn
 *
 * 基点 tag 的语义：名字 `v-<hash>` 记录上游 commit hash，指针也应指向同一上游
 * commit。若收尾打标时漏了 commit 参数（`git tag <name>` 默认指向 HEAD），指针
 * 会错指向翻译分支提交——名字对、指针错。getSourceCommit 从名字取 hash 仍能算
 * 对基点，但此 warn 提醒用户下次收尾打标把指针修正。
 *
 * 静默跳过条件：upstream 不可探测（无远端）、或 commit 恰好在上游历史里（正常）。
 *
 * @param {string} projectPath - 项目路径
 * @param {string} tagName - 基点 tag 名
 * @param {string} tagCommit - tag 指针解引用后的 commit hash
 */
function warnIfTagPointerOffUpstream(projectPath, tagName, tagCommit) {
  const upstream = detectUpstreamBranch(projectPath);
  if (!upstream) return; // 探测不到 upstream，无法校验，静默跳过
  try {
    // tag 指针指向的 commit 是否是 upstream 的祖先（含 upstream HEAD 本身）
    execSync(`git merge-base --is-ancestor ${tagCommit} ${upstream}^{commit}`, {
      cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
    });
    // 是祖先 → 指针正确指向上游 commit，无需 warn
  } catch (_) {
    // 不是祖先 → 指针偏离上游（典型：指向翻译分支提交）
    console.warn(
      `⚠ 基点 tag ${tagName} 的指针指向 ${tagCommit.slice(0, 7)}，不在 ${upstream} 历史里。\n` +
      `  典型原因：收尾打标用了 \`git tag ${tagName}\`（漏了 commit 参数，默认指向 HEAD/翻译分支）。\n` +
      `  getSourceCommit 仍能从 tag 名字取 hash 算对基点，但建议修正指针：\n` +
      `  \`git tag -d ${tagName} && git tag ${tagName} '${upstream}^{commit}'\``
    );
  }
}

function getCurrentTag(projectPath) {
  try {
    // 列出所有 v-<hex> 基点 tag 及其指向的 commit
    const output = execSync("git for-each-ref --format='%(refname:short) %(objectname)' refs/tags", {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    if (!output) return null;

    const baseTags = [];
    for (const line of output.split('\n')) {
      const idx = line.lastIndexOf(' ');
      if (idx === -1) continue;
      const name = line.slice(0, idx);
      const objHash = line.slice(idx + 1);
      if (!/^v-[a-f0-9]+$/i.test(name)) continue;
      // 解引用到 commit（lightweight tag 直接是 commit，annotated 需 ^{commit}）
      let commit = objHash;
      try {
        commit = execSync(`git rev-parse ${name}^{commit}`, {
          cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
      } catch (_) { continue; }
      baseTags.push({ name, commit });
    }
    if (baseTags.length === 0) return null;

    // 从 HEAD 沿祖先链回溯，找第一个遇到的基点 tag commit
    const commitsToNames = new Map(baseTags.map(t => [t.commit, t.name]));
    const revList = execSync('git rev-list HEAD', {
      cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
    }).trim().split('\n');
    for (const c of revList) {
      if (commitsToNames.has(c)) {
        // 指针校验：tag 名字记录的是上游 commit hash，指针也应指向上游 commit。
        // 若指针指向的 commit 不在上游历史里（典型症状：指针指向翻译分支提交，
        // 即收尾打标时漏了 commit 参数），warn 提醒。不改变返回值——getSourceCommit
        // 从 tag 名字取 hash 仍能算对基点，但提醒用户下次收尾打标修正指针。
        warnIfTagPointerOffUpstream(projectPath, commitsToNames.get(c), c);
        return commitsToNames.get(c);
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * 从 v-<hash> 格式标签中解析 source commit
 * @param {string} tag - 标签名
 * @returns {string|null} commit hash
 */
function getTagSourceCommit(tag) {
  if (!tag || typeof tag !== 'string') return null;
  const match = tag.match(/^v-([a-f0-9]+)$/i);
  return match ? match[1] : null;
}

/**
 * 获取 commit 范围列表（仅用于回退：无 tag 区间按 commit 切批）
 * @param {string} projectPath - 项目路径
 * @param {string} sourceCommit - source commit
 * @param {string} targetCommit - target commit
 * @returns {Array<{hash: string, subject: string}>} commit 列表
 */
function getCommitRange(projectPath, sourceCommit, targetCommit) {
  try {
    const output = execSync(
      `git log ${sourceCommit}..${targetCommit} --reverse --pretty=format:"%h %s"`,
      { cwd: projectPath, encoding: 'utf-8' }
    );

    return output.trim().split('\n').filter(Boolean).map(line => {
      const spaceIndex = line.indexOf(' ');
      if (spaceIndex === -1) {
        return { hash: line, subject: '' };
      }
      return {
        hash: line.slice(0, spaceIndex),
        subject: line.slice(spaceIndex + 1)
      };
    });
  } catch (error) {
    console.warn(`获取 commit 范围失败: ${error.message}`);
    return [];
  }
}

/**
 * 收集 base..target 范围内、指向真实 commit 的语义化 tag，按版本升序
 *
 * 只收 release tag（如 v0.8.2、0.8.2），跳过翻译基点 tag（v-<hash>）。
 * annotated tag 用 %{} 解引用到 commit 后再做范围判断——直接用 tag 名
 * 传给 git log 会因 tag 对象 hash 与 commit hash 不同而误判。
 *
 * @param {string} projectPath - 项目路径
 * @param {string} baseCommit - 基点 commit（不含）
 * @param {string} targetCommit - 目标 commit（含）
 * @returns {Array<{name: string, commit: string}>} tag 列表（commit 为解引用后的真实 commit hash）
 */
function getReleaseTagsBetween(projectPath, baseCommit, targetCommit) {
  try {
    // 列出 target 可达的所有 tag，%{objectname} 取指向的 commit
    const output = execSync(
      `git for-each-ref --sort=version:refname --format="%(refname:short) %(objectname)" refs/tags`,
      { cwd: projectPath, encoding: 'utf-8' }
    );

    const tags = [];
    for (const line of output.trim().split('\n')) {
      if (!line) continue;
      const spaceIndex = line.lastIndexOf(' ');
      if (spaceIndex === -1) continue;
      const name = line.slice(0, spaceIndex);
      const objHash = line.slice(spaceIndex + 1);

      // 跳过翻译基点 tag（v-<hex>）与非语义化 tag
      if (/^v-[a-f0-9]+$/i.test(name)) continue;
      if (!/^[vV]?\d+\.\d+/.test(name)) continue;

      // for-each-ref 的 objectname 对 annotated tag 是 tag 对象 hash，
      // 需解引用到 commit；对 lightweight tag 直接就是 commit
      let commit = objHash;
      try {
        commit = execSync(`git rev-parse ${name}^{commit}`, {
          cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
      } catch (_) { /* 解引用失败则跳过该 tag */ continue; }

      // 仅保留严格在 base..target 区间内（不含 base、含 target）的 tag。
      // 拆成两次 merge-base 调用，比 shell 管道可靠：base 是 commit 的祖先
      // （保证 commit 在 base 之后），且 commit 是 target 的祖先（保证不超前）。
      const isAfterBase = (() => {
        try {
          execSync(`git merge-base --is-ancestor ${baseCommit} ${commit}`, {
            cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
          });
          return true;
        } catch (_) { return false; }
      })();
      const isBeforeOrAtTarget = (() => {
        try {
          execSync(`git merge-base --is-ancestor ${commit} ${targetCommit}`, {
            cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
          });
          return true;
        } catch (_) { return false; }
      })();

      if (isAfterBase && isBeforeOrAtTarget) {
        tags.push({ name, commit });
      }
    }
    return tags;
  } catch (error) {
    console.warn(`收集 release tag 失败: ${error.message}`);
    return [];
  }
}

/**
 * 把 base..target 区间切成对齐批次
 *
 * 优先以 release tag 为批次边界（每批 merge 到一个 tag）；tag 之间的
 * 散 commit 由该区间 merge 自动带入，不单独成批。若整个区间无任何
 * release tag，回退为逐 commit 批次（每个 commit 一批）。
 *
 * @param {string} projectPath - 项目路径
 * @param {string} baseCommit - 基点 commit（不含）
 * @param {string} targetCommit - 目标 commit（含，总是最后一批）
 * @returns {Array<{ref: string, subject: string}>} 批次列表，按对齐顺序
 */
function getMergeBatches(projectPath, baseCommit, targetCommit) {
  const tags = getReleaseTagsBetween(projectPath, baseCommit, targetCommit);

  if (tags.length === 0) {
    // 无 release tag：回退逐 commit
    const commits = getCommitRange(projectPath, baseCommit, targetCommit);
    return commits.map(c => ({ ref: c.hash, subject: c.subject }));
  }

  // 有 release tag：以 tag 为批次边界。
  // 若最后一个 tag 不等于 target，补一个 target 作为末批（追上 HEAD）。
  const batches = tags.map(t => ({
    ref: t.name,
    subject: `align to ${t.name}`
  }));

  const lastTagCommit = tags[tags.length - 1].commit;
  const targetFullHash = execSync(`git rev-parse ${targetCommit}^{commit}`, {
    cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
  }).trim();
  if (lastTagCommit !== targetFullHash) {
    const headShort = execSync(`git rev-parse --short=7 ${targetCommit}`, {
      cwd: projectPath, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    batches.push({ ref: headShort, subject: 'align to HEAD' });
  }

  return batches;
}

/**
 * 获取某个 commit 修改的文件列表
 * @param {string} projectPath - 项目路径
 * @param {string} commitId - commit id
 * @returns {Array<{path: string, status: string}>} 文件变更列表
 */
function getCommitDiffFiles(projectPath, commitId) {
  try {
    const output = execSync(
      `git show --name-status --format="" ${commitId}`,
      { cwd: projectPath, encoding: 'utf-8' }
    );

    const files = [];
    for (const line of output.trim().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) continue;

      const status = parts[0].toUpperCase();
      const filePath = parts[parts.length - 1];

      files.push({
        path: filePath,
        status: status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified'
      });
    }

    return files;
  } catch (error) {
    console.warn(`获取 commit 文件列表失败: ${error.message}`);
    return [];
  }
}

/**
 * 获取某个 commit 的完整 diff
 * @param {string} projectPath - 项目路径
 * @param {string} commitId - commit id
 * @returns {string} diff 文本
 */
function getCommitDiff(projectPath, commitId) {
  try {
    return execSync(
      `git show ${commitId}`,
      { cwd: projectPath, encoding: 'utf-8' }
    );
  } catch (error) {
    console.warn(`获取 commit diff 失败: ${error.message}`);
    return '';
  }
}

/**
 * 判断 commit 的修改规模
 * @param {Array<{path: string, status: string}>} diffFiles - 文件变更列表
 * @returns {string} 'added' | 'deleted' | 'minor' | 'major'
 */
function classifyCommitChange(diffFiles) {
  if (!Array.isArray(diffFiles) || diffFiles.length === 0) {
    return 'minor';
  }

  const statuses = new Set(diffFiles.map(f => f.status));

  if (statuses.size === 1 && statuses.has('added')) {
    return 'added';
  }

  if (statuses.size === 1 && statuses.has('deleted')) {
    return 'deleted';
  }

  // 如果涉及大量文件或既有新增又有删除，视为大量修改
  if (diffFiles.length > 3 || statuses.has('added') || statuses.has('deleted')) {
    return 'major';
  }

  return 'minor';
}

module.exports = {
  checkFileModified,
  detectModifiedFiles,
  restoreUpstreamVersion,
  getGitRoot,
  getCurrentTag,
  getTagSourceCommit,
  getCommitRange,
  getReleaseTagsBetween,
  getMergeBatches,
  getCommitDiffFiles,
  getCommitDiff,
  classifyCommitChange
};
