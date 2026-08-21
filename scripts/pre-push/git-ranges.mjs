/**
 * git-ranges:pre-push stdin 协议解析与扫描范围推导。
 *
 * 协议(见 githooks(5)):stdin 每行一个 ref 更新
 *   <local ref> SP <local sha> SP <remote ref> SP <remote sha> LF
 * 本地/远端 sha 全零分别表示「删除远端 ref」与「新建远端 ref」。
 */

import { spawnSync } from "node:child_process";

const ZERO_SHA = "0".repeat(40);

export function parsePrePushStdin(text) {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

/**
 * 推导传给 gitleaks --log-opts / git log 的范围参数:
 * - 删除 ref → null(无需扫描)
 * - 新建 ref → 排除所有远端已有 commit,只扫真正新增的(新分支常从既有主干岔出)
 * - 常规更新 → remote..local(remote 对象须在本地可解析)
 * - remote sha 本地不可解析 → 回退扫 local 可达的全部历史(见下)
 *
 * remote sha 不可解析的典型场景:历史重写(filter-repo 等)后 gc 清掉了旧对象,
 * 此时 force-push 携带的远端旧 sha 在本地不存在,`remote..local` 是非法 revision
 * range——回退为「扫 local 可达且不在任何远端 ref 中的历史」,重写后的全量提交
 * 恰好都在扫描面内。宁可扫多,不可因范围构造失败而 fail-closed 卡死正常推送。
 *
 * 恒带 -m:git log -p 默认不输出 merge commit 的 diff,经 merge 独占引入的内容
 * (如冲突解决时写入的秘钥)会逃逸;-m 让 merge 对每个父各出一份 diff。
 * 代价是 merge 的双父回声与规则重叠命中,由报告层按 (rule,file,line) 去重。
 */
export function logOptsForUpdate(repoDir, update) {
  if (update.localSha === ZERO_SHA) return null;
  if (update.remoteSha === ZERO_SHA) return `-m ${update.localSha} --not --remotes`;
  const probe = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${update.remoteSha}^{commit}`], {
    cwd: repoDir,
    stdio: "ignore",
  });
  if (probe.status !== 0) return `-m ${update.localSha} --not --remotes`;
  return `-m ${update.remoteSha}..${update.localSha}`;
}
