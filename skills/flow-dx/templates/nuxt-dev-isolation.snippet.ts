/**
 * /dev/** 生产隔离配置片段。
 *
 * 用法：将下列 `hooks` 字段合并进 nuxt.config.ts 的 defineNuxtConfig({ ... })。
 * 若项目已有 hooks，把 'pages:extend' 合并进去即可。
 *
 * 原理：仅本地 dev server（NODE_ENV === 'development'）保留 /dev/** 路由；
 * 任何 build（生产、测试环境编译）全部移除。路由不注册 → 组件不被引用 →
 * 被 tree-shaking 移除，开发期辅助代码不进入构建产物。
 *
 * 选择 NODE_ENV 而非 import.meta.env.DEV：
 * 后者在 nuxt dev 为 true、nuxt build 为 false，但 build 目标无法区分测试/生产；
 * NODE_ENV === 'development' 精确等于"本地 dev server"，恰好满足需求。
 */
export default {
  hooks: {
    // 粘贴进 nuxt.config.ts 时，pages 参数有 NuxtPage 完整类型；
    // 本片段文件独立存在，这里用结构性类型避免引入 @nuxt/schema 依赖
    "pages:extend"(pages: { path: string }[]) {
      if (process.env.NODE_ENV !== "development") {
        // 反向遍历避免 splice 后索引错位
        for (let i = pages.length - 1; i >= 0; i--) {
          if (pages[i].path.startsWith("/dev")) {
            pages.splice(i, 1);
          }
        }
      }
    },
  },
};
