/**
 * forbidden-paths:禁止进入推送历史的文件路径策略。
 *
 * 与 .gitignore 是两层防线:ignore 防「无意纳入」,本策略防「git add -f 强塞」
 * 或 ignore 规则漂移。仓级私有区条目与 .gitignore 有重复是刻意的——
 * 本清单同时充当「哪些路径绝不公开」的策略文档。
 */

const RULES = [
  {
    name: "dotenv",
    // .env / .env.* 一律拦截;只有 example/sample 模板允许入库
    test: (p) => {
      const base = p.split("/").pop();
      return /^\.env(\..+)?$/.test(base) && !/^\.env\.(example|sample)$/.test(base);
    },
  },
  {
    name: "key-material",
    // PEM/DER 密钥与证书包;.pub 公钥与 .keyword 等扩展名近似词不在其列
    test: (p) => /\.(pem|key|p12|pfx)$/.test(p) || /(^|\/)id_(rsa|ed25519|ecdsa|dsa)$/.test(p),
  },
  {
    name: "repo-local-configs",
    // 仓级本机黑名单;仅 example 模板可入库
    test: (p) => /^configs\//.test(p) && p !== "configs/secret-scan.example.txt",
  },
  {
    name: "skill-local-configs",
    // 各技能的本机配置区;launchers.example.json 是入库模板
    test: (p) =>
      (/^skills\/flow-agent\/configs\//.test(p) && p !== "skills/flow-agent/configs/launchers.example.json") ||
      /^skills\/flow-os\/configs\//.test(p) ||
      /^skills\/flow-web\/configs\/workspace-(bindings|uuids)\.json$/.test(p),
  },
  {
    name: "skill-local-accumulation",
    // 本地积累区:知识库与站点 playbook 随使用增长且含内部操作细节,不随仓分发
    test: (p) =>
      /^skills\/flow-mem\/references\/(framework|decisions)\//.test(p) ||
      /^skills\/flow-web\/references\//.test(p),
  },
];

export function checkForbiddenPaths(paths) {
  const hits = [];
  for (const p of paths) {
    for (const rule of RULES) {
      if (rule.test(p)) {
        hits.push({ rule: rule.name, path: p });
        break;
      }
    }
  }
  return hits;
}
