# 设计规范(Design System)

> 版本 2.2 · 2026-09-15 · 对齐 Figma 编辑器工具界面(与 pddddd 控制台同一设计语言;v2.0 的 Figma 营销官网风整体替换)
> v2.2 增补:控件等高铁律与 `controlH` 令牌、`Notice` 吸附顶部、聊天页按钮与气泡的真实外缘锚定
> 代码真源:`src/ui/design.ts`(几何与字型)+ `src/ui/theme.ts`(配色)
> 组件资产:`src/ui/components.tsx`(popup 复用);聊天页覆盖层 CSS 由 `pdd-ai-button.ts` 从同一令牌导入插值

---

## 一、设计原则

1. **白面板 + 细边框**:层级靠 1px #E5E5E5 边框与明度差(#FFF / #FAFAFA / #EFEFEF),不用重描边、不堆卡片。
2. **黑白主色**:主操作黑底白字(#161616);Figma 蓝(#0D99FF)只用于焦点、品牌标与滑杆等状态,不做大色块。
3. **小圆角**:控件一律 4/6/8px,靠近桌面工具软件质感;圆形仅保留给开关、圆点与计数徽标。
4. **行悬浮操作**:列表行的次级操作(编辑/删除/迁移等)默认隐藏,悬浮或键盘聚焦时显现——静止界面只保留主路径。
5. **层级靠字重与字号**:13px 级正文 + 加粗标题 + 灰色辅助,小字号高密度。
6. **禁令**:页面代码不得硬编码字号 / 圆角 / 间距 / 颜色 / 字体,一律引用设计令牌
   (popup 走 ThemeTokens/React 内联;聊天页覆盖层在 CSS 模板里插值同一批令牌)。

## 二、配色(ThemeTokens,`ui/theme.ts`)

| 令牌 | 浅色 | 深色 | 用途 |
|------|------|------|------|
| `bg` | `#FFFFFF` | `#1E1F21` | 画布(popup 即白面板) |
| `bgSecondary` | `#FAFAFA` | `#1A1B1D` | 导航栏、行悬浮底色 |
| `bgCard` | `#FFFFFF` | `#2C2C2C` | 卡片底(靠边框成形) |
| `text` | `#161616` | `#E6E6E6` | 主文本 / 主按钮底 |
| `textMuted` | `#5C5C5C` | `#9B9DA2` | 次级文本 |
| `textTertiary` | `#8C8C8C` | `#6F7175` | 辅助/时间戳/图标默认色 |
| `border` / `borderLight` | `#E5E5E5` / `#EFEFEF` | `#3B3D40` / rgba(255,255,255,.06) | 分隔 |
| `accent` | `#0D99FF` | `#4CB3FF` | 焦点/品牌(Figma 蓝) |
| `btnPrimaryBg` | `#161616`(白字) | `#E6E6E6`(黑字) | 主按钮(黑白反转) |
| `successText` | `#14AE5C` | `#0ACF83` | 成功提示 |
| `errorText` | `#F24822` | `#FF7262` | 错误/危险 |

语义色(与主题无关,`design.ts#semantic`):标准回答徽标 amber(`#B8860B` on `#FDF6E3`)、知识库徽标绿(`#14AE5C` on `rgba(20,174,92,.09)`)。

## 三、字型

| 令牌 | 值 | 用途 |
|------|-----|------|
| `fontSize.caption` | 10.5 | 时间戳、来源、脚注、mini 钮 |
| `fontSize.secondary` | 11.5 | 回复正文、描述 |
| `fontSize.body` | 12.5 | 问题/条目标题、按钮(默认) |
| `fontSize.title` | 13.5 | 弹窗标题 |
| `fontSize.heading` | 15 | 页面标题 |
| `fontWeight` | 400 / 500 / 600 / 650 | 常规 / 中等 / 半粗 / 仅页面标题 |

字体栈(`design.ts#fontFamily`,工具软件同款):`"Segoe UI", "Microsoft YaHei", -apple-system, "PingFang SC", sans-serif`。
不联网加载字体;数字统一 `tabular-nums`。

## 四、几何

| 令牌 | 值 | 用途 |
|------|-----|------|
| `radius.sm / md / lg / xl` | **4 / 6 / 8 / 8** | 徽标与图标钮 / 按钮输入框 / 卡片 / popup 外框与浮层 |
| `radius.pill` | 9999 | 仅开关、圆点、圆形计数徽标 |
| `spacing.xs→xxl` | 4 / 6 / 8 / 10 / 12 / 16 | 4 的倍数栅格 |
| `size.popupWidth / popupHeight` | 400 / 560 | popup 固定外框(内容区滚动) |
| `size.railWidth / railBtn` | 52 / 36 | 图标导航栏 / 导航按钮 |
| `controlH.inline / form` | **24 / 26** | 行内小控件 / 表单与工具栏控件(见下) |
| `motion.fast / normal` | 0.12s / 0.15s ease | 悬停 / 开关过渡 |

**控件等高铁律**(2026-09-15 补):同一行内的输入框与按钮必须取同一档高度,
且用**显式 `height`** 而不是靠 `padding + line-height` 撑 —— 后者会随字号/行高漂移,
出现几像素的高低位错(实测:新建子文件夹输入框 35px vs「创建/取消」28px)。
- `controlH.inline = 24`:行悬浮图标钮、行内小按钮(填充/确认/取消)、迁移下拉。
- `controlH.form = 26`:`.pddcs-btn`、工具栏按钮、内联表单(新建/重命名)的输入框与按钮。
- 与按钮同排的输入框走 `components.tsx#controlStyle(tk, controlH.form)`。
- 聊天页覆盖层不享 popup 的全局 `box-sizing: border-box` 重置,注入样式须自带。


## 五、组件资产(`ui/components.tsx`)

| 组件 | 说明 |
|------|------|
| `Btn` | 直角按钮(6px),4 种 variant:default / primary(黑底白字) / danger / ghost |
| `Card` | 卡片容器(白底 + 1px #E5E5E5 边框 + 8px 圆角),可选标题 |
| `Badge` | 徽标,3 种 tone:golden / knowledge / neutral;4px 小方标 |
| `Notice` | 结果提示条(成功绿 / 错误红);**吸附在滚动区顶部**(`position: sticky; top: 0` + `bg` 底板),长列表下操作反馈不会被顶出视口 |
| `EmptyState` | 空状态(居中、两行文案) |
| `SearchInput` | 带放大镜的搜索输入框 |
| `Toggle` | 拨杆开关(选中态黑色,pddddd 同款) |
| `Slider` | 数值滑杆(accent 色、tabular-nums 数值) |
| `SectionLabel` | 小节标签 |
| `inputStyle` | 表单元素统一样式原语(独立成行的输入框/文本域) |
| `controlStyle` | 与按钮同排的输入框样式原语(显式高度,保证等高) |
| `.pddcs-row-ops` | 行悬浮操作容器(全局 CSS):默认透明,`:hover` / `:focus-within` 显现 |

图标:统一走 `ui/icons.tsx`(lucide-react 封装,24px 画布 / 2px 描边 / 圆角线帽);禁止使用 emoji 充当图标。
例外:聊天页「AI回复」按钮为纯文字小控件,不带图标(2026-09-15 用户要求)。

## 六、聊天页覆盖层(`contents/pdd-ai-button.ts`)

CSS 为模板字符串,**颜色/字体/圆角/字号全部从 `ui/design` + `ui/theme`(lightTheme)插值导入**,
与 popup 同源;固定浅色(宿主页面不可控,浅色最稳)。

- `.pddcs-ai-btn`:AI回复按钮 —— 与 popup 的 `.pddcs-btn` **同档工具风控件**
  (26px 高 / 6px 圆角 / 12.5px 字号 / 白底细描边 / 悬浮浅灰;纯文字无图标,2026-09-15 用户定)。
  `box-sizing: border-box` 显式声明;位置为气泡真实右缘外 12px。
- `.pddcs-popup`:候选弹窗(8px 圆角 + 浮层阴影 + 4px 方徽标/迷你按钮)。
- `.pddcs-toast`:近黑(#161616 @ .92)轻提示,6px 圆角。

**气泡锚点算法**(2026-09-15 修复「按钮压住气泡」):真机结构
`li.onemsg > .buyer-item > div[currentuid] > .msg-content > p.msg-content-box`,
气泡底色与内边距在上层容器上,`<p>` 的 rect 右缘短掉气泡 padding(实测约 10px)——
按 `<p>` 右缘 +12px 定位,视觉间距只剩约 1px。
现自文本块向上吸收「有不透明背景色 且 宽度贴近文本块(容差 48px)」的最外层祖先作锚,
宽度守卫排除整行容器的底色;兜底取文本块直属容器。算法落在
`src/utils/pddBubbleAnchor.ts`(含单测),内容脚本只做 WeakMap 缓存。

## 七、文件夹模块布局(2026-09-15 重构)

工具风单栏分区树,参照 pddddd 知识库 doc-list 与导航折叠模式:

- **工具栏**:右上角「新建根文件夹」直角小钮;新建时原位变内联表单(Enter 提交 / Esc 取消)。
- **根文件夹分区**:可折叠分区头(chevron 旋转 + 文件夹图标 + 名称 + 圆形计数徽标),分区间以细线分隔;「未分类」置底且不可改名/删除。
- **子文件夹**:左侧 1px 引导线缩进,头部字重降为 medium。
- **标准回答行**:分隔线行(非卡片)。问题加粗单行、回复灰色两行、向量状态为行内小字;
  操作分两层——「填充」黑色主钮常驻,复制/编辑/迁移/删除为悬浮显现的 24px 图标钮(删除悬浮红)。
- **内联交互**:重命名在分区头原位表单化;删除走内联确认行(常驻可见,不依赖悬浮)。
  内联表单的输入框与「创建/保存/取消」严格等高(`controlH.form = 26`)。

## 八、文案规范

- 概念命名(2026-09-15 起):「金标准」一律称 **标准回答**;提升操作按钮为 **设置标准回答**。
- 操作按钮:两字优先(填充 / 复制 / 编辑 / 删除 / 确认 / 取消 / 创建 / 保存 / 启用 / 停用);
  例外:设置标准回答(用户指定全称)、新建根文件夹(入口钮)。
- 空状态:「暂无 ××」+ 一句引导。
- 结果提示:动宾结构直述结果;固定表述「发送由人工完成」「后台将自动向量化」。
- 技术细节放 tooltip / title,不挤占界面文案。

## 九、popup 全局样式(注入于 `popup/index.tsx`)

- `.pddcs-btn`:直角基础样式(6px 圆角、边框、过渡);**高度固定 `controlH.form`(26px)**,
  保证与同排输入框/工具栏按钮等高。
- `.pddcs-input`:输入框基础样式(6px 圆角,focus 由内联 border 提亮)。
- `.pddcs-scroll`:悬浮才出现的细滚动条。
- `.pddcs-rail-btn`:导航图标按钮(6px 圆角悬浮灰块);导航栏顶部**不放品牌标**(2026-09-15 用户要求删除)。
- `.pddcs-row(-ops)`:行悬浮操作显现规则(见 §五)。
- 外框:`overflow:hidden; border-radius:8px`,body 背景透明。
- `* { box-sizing: border-box }`:popup 全局重置,表单控件显式高度才能生效。
