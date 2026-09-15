# 设计规范(Design System)

> 版本 2.0 · 2026-09-15 · 参照 Figma 官网(figma.com)设计语言(v1.0 为 ChatGPT/Codex 风,已整体替换)
> 代码真源:`src/ui/design.ts`(几何与字型)+ `src/ui/theme.ts`(配色)
> 组件资产:`src/ui/components.tsx`(popup 复用);聊天页覆盖层 CSS 由 `pdd-ai-button.ts` 从同一令牌导入插值

---

## 一、设计原则

1. **白画布 + 浅灰表面**:层级靠明度差(#FFF → #F5F5F5)与细边框(#E6E6E6),不用重描边。
2. **唯一强调色**:Figma 蓝(#0D99FF)只出现在主操作、焦点、品牌标与开关/滑杆;其余近单色。
3. **胶囊化控件**:按钮、徽标、开关、toast 一律胶囊形(rounded-full);卡片大圆角。
4. **层级靠字重与字号**:不依赖容器与描边制造层级。
5. **禁令**:页面代码不得硬编码字号 / 圆角 / 间距 / 颜色 / 字体,一律引用设计令牌
   (popup 走 ThemeTokens/React 内联;聊天页覆盖层在 CSS 模板里插值同一批令牌)。

## 二、配色(ThemeTokens,`ui/theme.ts`)

| 令牌 | 浅色 | 深色 | 用途 |
|------|------|------|------|
| `bg` | `#FFFFFF` | `#1E1F21` | 画布 |
| `bgSecondary` | `#F5F5F5` | `#1A1B1D` | 导航栏等次级表面 |
| `bgCard` | `#F5F5F5` | `#2C2C2C` | 卡片、输入底 |
| `text` | `#1E1F21` | `#E6E6E6` | 主文本(Figma 近黑) |
| `textMuted` | `#575B66` | `#9B9DA2` | 次级文本 |
| `textTertiary` | `#8A8D91` | `#6F7175` | 辅助/时间戳 |
| `border` / `borderLight` | `#E6E6E6` / `#F0F0F0` | `#3B3D40` / `rgba(255,255,255,.06)` | 分隔 |
| `accent` | `#0D99FF` | `#4CB3FF` | 强调(Figma 蓝,深色提亮) |
| `btnPrimaryBg` | `#0D99FF`(白字) | `#0D99FF`(白字) | 主按钮 |
| `successText` | `#0E8A50` | `#0ACF83` | 成功提示 |
| `errorText` | `#D93511` | `#FF7262` | 错误/危险 |

语义色(与主题无关,`design.ts#semantic`):标准回答徽标 amber(`#B45309` on `rgba(245,158,11,.15)`)、知识库徽标 Figma 绿(`#0E8A50` on `rgba(20,174,92,.12)`)。

## 三、字型

| 令牌 | 值 | 用途 |
|------|-----|------|
| `fontSize.caption` | 10.5 | 时间戳、来源、脚注 |
| `fontSize.secondary` | 11.5 | 回复正文、描述 |
| `fontSize.body` | 12.5 | 问题/条目标题、按钮(默认) |
| `fontSize.title` | 13.5 | 弹窗标题 |
| `fontSize.heading` | 15 | 页面标题 |
| `fontWeight` | 400 / 500 / 600 / 650 | 常规 / 中等 / 半粗 / 仅页面标题 |

字体栈(`design.ts#fontFamily`,Figma 官网同款 Inter 优先):
`"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif`。
**不联网加载字体**(本工具离线优先):设备装有 Inter 时生效,否则回退系统字体,中文始终走雅黑。
数字统一 `tabular-nums`。

## 四、几何

| 令牌 | 值 | 用途 |
|------|-----|------|
| `radius.sm / md / lg / xl / pill` | 8 / 12 / 14 / 16 / 9999 | 微元素 / 输入框 / 卡片 / popup 外框与浮层 / 胶囊 |
| `spacing.xs→xxl` | 4 / 6 / 8 / 10 / 12 / 16 | 4 的倍数栅格 |
| `size.popupWidth / popupHeight` | 400 / 560 | popup 固定外框(内容区滚动) |
| `size.railWidth / railBtn` | 52 / 36 | 图标导航栏 / 导航按钮 |
| `motion.fast / normal` | 0.12s / 0.15s ease | 悬停 / 开关过渡 |

## 五、组件资产(`ui/components.tsx`)

| 组件 | 说明 |
|------|------|
| `Btn` | 胶囊按钮,4 种 variant:default / primary(Figma 蓝底白字) / danger / ghost |
| `Card` | 卡片容器(lg 圆角 + 明度分层),可选标题 |
| `Badge` | 徽标,3 种 tone:golden / knowledge / neutral |
| `Notice` | 结果提示条(成功绿 / 错误红,md 圆角) |
| `EmptyState` | 空状态(居中、两行文案) |
| `SearchInput` | 带放大镜的搜索输入框 |
| `Toggle` | 胶囊拨杆开关(accent 色) |
| `Slider` | 数值滑杆(accent 色、tabular-nums 数值) |
| `SectionLabel` | 小节标签 |
| `inputStyle` | 表单元素统一样式原语 |

图标:统一走 `ui/icons.tsx`(lucide-react 封装,24px 画布 / 2px 描边 / 圆角线帽);禁止使用 emoji 充当图标。
例外:聊天页「AI回复」按钮为纯文字胶囊,不带图标(2026-09-15 用户要求)。

## 六、聊天页覆盖层(`contents/pdd-ai-button.ts`)

CSS 为模板字符串,**颜色/字体/圆角/字号全部从 `ui/design` + `ui/theme`(lightTheme)插值导入**,
与 popup 同源;仅阴影按浮层场景加强。固定浅色(不随深色主题切换——宿主页面不可控,浅色最稳)。

- `.pddcs-ai-btn`:AI回复胶囊(20px 高、纯文字、距买家气泡 12px)。
- `.pddcs-popup`:候选弹窗(xl 圆角 + 浮层阴影 + 胶囊徽标/迷你按钮)。
- `.pddcs-toast`:近黑(#1E1F21 @ .92)胶囊轻提示。

## 七、文案规范

- 概念命名(2026-09-15 起):「金标准」一律称 **标准回答**;提升操作按钮为 **设置标准回答**。
- 操作按钮:两字优先(填充 / 复制 / 编辑 / 删除 / 确认 / 取消 / 创建 / 保存 / 启用 / 停用);
  例外:设置标准回答(用户指定全称)。
- 空状态:「暂无 ××」+ 一句引导。
- 结果提示:动宾结构直述结果;固定表述「发送由人工完成」「后台将自动向量化」。
- 技术细节放 tooltip / title,不挤占界面文案。

## 八、popup 全局样式(注入于 `popup/index.tsx`)

- `.pddcs-btn`:胶囊基础样式(边框、圆角、过渡)。
- `.pddcs-input`:输入框基础样式(focus 由内联 border 提亮)。
- `.pddcs-scroll`:悬浮才出现的细滚动条。
- `.pddcs-rail-btn`:导航图标按钮(悬浮灰块)。
- 外框:`overflow:hidden; border-radius:16px`,body 背景透明。
