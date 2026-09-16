import { defineConfig } from "plasmo"

// manifest 统一在 package.json "manifest" 键维护(2026-09-16 工程审查②去重)。
// 原先此处与 package.json 双份逐字段重复、靠人肉约定保持一致;而 Plasmo 实际
// 合并行为是配置文件优先,一旦漂移会静默以本文件为准 —— 只保留一处后风险消除。
export default defineConfig({})
