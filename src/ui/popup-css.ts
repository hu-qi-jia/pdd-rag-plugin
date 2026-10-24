/**
 * popup 全局样式表(v5.1「石墨蓝灰」)。
 *
 * 为什么是一个**独立模块**而不是 `popup/index.tsx` 里的一个常量:
 * v3.0 起状态色全部收进了 CSS(内联样式表达不了 `:hover`),于是"开关选中是强调色"
 * "卡片是一张独立的卡""分隔线缩进到文字左缘"这些**视觉契约**在 React 组件树上一个字
 * 都读不到。埋在 index.tsx 内部,它就成了唯一一份无法被单测断言的规格。
 * 抽成模块后,`tests/unit/ui/popup-css.test.ts` 直接断言这份字符串。
 *
 * 本文件只产出**一份**样式表:主题差异一律走 `--pddcs-*` 自定义属性
 * (由 `popup/index.tsx` 从 `theme.ts` 桥到 `<html>` 上),因此这里不接收任何参数。
 *
 * ── 三条贯穿全表的规矩(v5.0 修订)────────────────────────────────────────
 *  ① **列表是卡片,控件在卡内**。v4.0 是"列表通铺、控件内缩";v5.0 反过来 ——
 *     列表**整段内缩**(`listGap.inset`)且每行一张卡,卡内的内边距由卡自己给。
 *     卡片列表样式挂在 `.pddcs-list > *` 上:**三个页签的列表容器都是 `.pddcs-list`**,
 *     所以一处规则覆盖全部,不必给每个行类型各写一遍。
 *  ② **两种线,各有各的活**:卡**内**的分隔线仍然**从文字左缘起缩进**(`--hair-in`);
 *     卡**与卡**之间**不画线** —— 6px 的间隙就是边界。v4.0 只有前者一种线。
 *  ③ **选中是淡底,不是实心块**。v4.0 的"当前位置用实心 ink"已改走 `accentSoft`
 *     + `accentText` —— 引入强调色之后,"当前项"该由强调色表达,而不是由黑白反转表达。
 *     `ink` 只留给聊天页 toast(见 overlay-css)。
 */
import {
  controlH,
  cornerShape,
  fontFamily,
  fontFamilyMono,
  fontSize,
  fontWeight,
  formGap,
  listGap,
  motion,
  radius,
  size,
  spacing,
} from './design'
import { lightTheme } from './theme'
import { thinScrollbarCss } from './scrollbar'

export const POPUP_CSS = `
html, body { margin: 0; padding: 0; background: var(--pddcs-bg, ${lightTheme.bg});
  font-family: ${fontFamily}; }
/* 原生控件不继承字体,单独接上 —— 否则输入框/按钮会退回 Times,与周围字体打架 */
button, input, textarea, select { font-family: inherit; }
* { box-sizing: border-box; }

/* ── 连续圆角(iOS squircle)─────────────────────────────────────────────────
   全局一条:半径决定"拐多大弯",平滑度决定"怎么拐" —— 正圆弧在切点处曲率突变,
   连续圆角让曲率从直边渐变到顶。取值 60% 与换算单点在 design.ts#cornerSmoothing,
   这里不写数字;不支持的浏览器会忽略这条声明,自动退回普通圆角。

   用 * 而不是逐个类名:圆角散在三十多条规则与若干内联样式里,枚举一定漏。
   胶囊与正圆在各自规则里**明确回到 round**(见开关 / 滑杆 / 分类 pill)。 */
* { corner-shape: ${cornerShape}; }

/* 焦点环 —— 唯一允许"环套控件"的地方。走强调色:v5.0 起 accent 与两种主题的
   面都反相(浅色 4.88:1 / 深色 6.20:1),而 ink 在深色下是近白、压在卡片上会糊 */
:focus-visible { outline: 2px solid var(--pddcs-accent); outline-offset: 2px; }

/* ── 数字:等宽 + 表格数字。中文正文不用等宽(见 design.ts 文件头) ───────── */
.pddcs-num { font-family: ${fontFamilyMono}; font-variant-numeric: tabular-nums; }

/* ─────────────────────────────────────────────────────────────────────────
   按钮
   ───────────────────────────────────────────────────────────────────────── */
.pddcs-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: ${controlH.form}px; padding: 0 ${spacing.xxl}px;
  border-radius: ${radius.control}px; border: 1px solid transparent;
  font-family: inherit; font-size: ${fontSize.sub}px; font-weight: 500; line-height: 1;
  cursor: pointer; white-space: nowrap;
  transition: background-color .18s cubic-bezier(.32,.72,0,1), color .18s,
              border-color .18s, transform .1s, opacity .18s;
}
.pddcs-btn:active:not(:disabled) { transform: scale(.97); }
.pddcs-btn:disabled { opacity: .4; cursor: not-allowed; }
/* 主钮 = 强调色底。一页只有一个(标准回答页的「新建类型」、知识库页的「新建条目」)
   ⚠️ 用 onAccent 而不是 onInk:两个令牌在浅色下取值相同、深色下**不同**
   (onAccent #10151C / onInk #16181B)。混用会在深色主题下留下说不清的色差 */
.pddcs-btn[data-variant='primary'] {
  background: var(--pddcs-accent); color: var(--pddcs-on-accent);
}
.pddcs-btn[data-variant='primary']:not(:disabled):hover { opacity: .88; }
/* 默认 = 填充式控件(iOS 的做法:用底色而不是描边说"我能点")。
   ⚠️ 必须带描边:设置页的分区卡片本身就是 fill 底,只靠底色填充的按钮落在卡里
   等于隐形(旧版「导入 JSON」「重置统计」就是这样,读起来像两段文字) */
.pddcs-btn[data-variant='default'] {
  background: var(--pddcs-fill); color: var(--pddcs-text);
  border-color: var(--pddcs-border);
}
.pddcs-btn[data-variant='default']:not(:disabled):hover {
  background: var(--pddcs-selection);
}
/* 危险:唯一保留的语义色 */
.pddcs-btn[data-variant='danger'] {
  background: var(--pddcs-danger-soft); color: var(--pddcs-danger);
}
.pddcs-btn[data-variant='danger']:not(:disabled):hover {
  background: var(--pddcs-danger); color: var(--pddcs-on-ink);
}
/* 幽灵:无底无框,只在悬浮时给浅底 */
.pddcs-btn[data-variant='ghost'] {
  background: transparent; color: var(--pddcs-text-secondary);
}
.pddcs-btn[data-variant='ghost']:not(:disabled):hover {
  background: var(--pddcs-fill); color: var(--pddcs-text);
}
.pddcs-btn-sm { height: ${controlH.inline}px; padding: 0 ${spacing.xl}px; font-size: ${fontSize.cap}px; }

/* 次级文字链：模板下载这类"给个起点"的动作,不占一个按钮的高度与重量 */
.pddcs-linkbtn {
  display: inline-flex; align-items: center; gap: 4px; padding: 0;
  border: 0; background: none; font: inherit;
  font-size: ${fontSize.cap}px; line-height: 1.4;
  color: var(--pddcs-text-secondary); cursor: pointer;
  transition: color .18s;
}
.pddcs-linkbtn:hover { color: var(--pddcs-accent-text); text-decoration: underline; }

/* 文字档位：整组是一条控件（轨道 + 滑块），不给每个按钮各长一张卡片。
   轨道**必须描边**：白卡上 fill 与 surface 只差 1.09:1，不描边就散成一排裸字。 */
.pddcs-choice {
  display: inline-flex; align-items: center; gap: 2px; padding: 2px; flex-shrink: 0;
  border-radius: ${radius.control}px;
  background: var(--pddcs-fill);
  box-shadow: inset 0 0 0 1px var(--pddcs-border),
              inset 0 1px 2px color-mix(in srgb, var(--pddcs-text) 6%, transparent);
}
.pddcs-choice > button {
  min-width: 36px; height: ${controlH.inline}px; padding: 0 ${spacing.lg}px;
  border: 0; border-radius: ${radius.control}px;
  background: transparent; color: var(--pddcs-text-secondary);
  font: inherit; font-size: ${fontSize.cap}px; cursor: pointer;
  transition: background-color .18s cubic-bezier(.32,.72,0,1), color .18s, box-shadow .18s;
}
.pddcs-choice > button:hover { color: var(--pddcs-text); background: var(--pddcs-selection); }
.pddcs-choice > button[data-active='true'] {
  /* 选中走 accentSoft + accentText（设计规范第③条：选中是淡底，不是实心块）。
     对比度 5.92:1，两种主题共用同一对令牌。 */
  background: var(--pddcs-accent-soft);
  color: var(--pddcs-accent-text); font-weight: ${fontWeight.medium};
  box-shadow: 0 1px 2px color-mix(in srgb, var(--pddcs-ink) 10%, transparent);
}

/* ── 图标钮:28×28,图标 16 居中 → 盒内左右各留 6px ─────────────────────────
   那个 6px 是有用的:操作行要"图标对齐正文竖线"时,margin-left:-6px 正好抵消它 */
.pddcs-iconbtn {
  width: ${controlH.icon}px; height: ${controlH.icon}px; flex: 0 0 auto; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: ${radius.control}px; background: transparent;
  color: var(--pddcs-text-tertiary); cursor: pointer;
  transition: background-color .18s cubic-bezier(.32,.72,0,1), color .18s, transform .1s;
}
.pddcs-iconbtn:not(:disabled):hover { background: var(--pddcs-selection); color: var(--pddcs-text); }
.pddcs-iconbtn:not(:disabled):active { transform: scale(.94); }
.pddcs-iconbtn:disabled { opacity: .35; cursor: default; }
/* 危险图标钮:悬浮转语义红 —— 破坏性操作不该和普通操作长得一样 */
.pddcs-iconbtn-danger:not(:disabled):hover {
  background: var(--pddcs-danger-soft); color: var(--pddcs-danger);
}
/* 已设标准(实心星)= 强调色。v5.0 起**靠颜色区分**,不再只靠"实心 vs 描边" ——
   实心/描边那点差别在一行 28px 的图标里太小,有色可用时就该用色 */
.pddcs-iconbtn[data-on='true'] { color: var(--pddcs-accent); }
/* 请求在途:图标原地转圈 */
.pddcs-iconbtn-busy svg { animation: pddcs-spin .7s linear infinite; }
@keyframes pddcs-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .pddcs-iconbtn-busy svg { animation: none; }
  .pddcs-btn:active:not(:disabled), .pddcs-iconbtn:not(:disabled):active { transform: none; }
}

/* ── 方括号灰标 ──────────────────────────────────────────────────────────────
   括号走透明度而非另开一个色 —— 括号是标点不是信息,不该有自己的一套配色 */
.pddcs-tag { display: inline-flex; align-items: baseline; font-size: ${fontSize.cap}px;
  line-height: 1.4; color: var(--pddcs-text-tertiary); white-space: nowrap;
  font-family: ${fontFamilyMono}; font-variant-numeric: tabular-nums; }
.pddcs-tag[data-tone='strong'] { color: var(--pddcs-text); font-weight: 600; }
.pddcs-tag[data-tone='danger'] { color: var(--pddcs-danger); }
/* 值得留意一眼(「低置信」)。刻意不共用 danger —— 需要复核 ≠ 出错了 */
.pddcs-tag[data-tone='accent'] { color: var(--pddcs-accent-text); font-weight: 600; }
.pddcs-tag::before { content: "["; opacity: .5; }
.pddcs-tag::after { content: "]"; opacity: .5; }

/* ─────────────────────────────────────────────────────────────────────────
   状态条:页面名 + 本页计数。**下缘不画线**(v5.0 改)。
   它现在落在主面板这张卡里,而卡片之间靠间隙分界、卡内靠缩进线分界 ——
   标题下面直接跟内容,再插一条通栏线就成了第三种边界。
   ───────────────────────────────────────────────────────────────────────── */
.pddcs-statusbar { display: flex; align-items: baseline; gap: ${spacing.lg}px; flex: 0 0 auto;
  padding: ${spacing.xxl}px ${spacing.xxl}px ${spacing.xl}px; }
.pddcs-statusbar .pg { font-size: ${fontSize.title}px; font-weight: 600;
  color: var(--pddcs-text); letter-spacing: -0.01em; }
.pddcs-statusbar .ct { margin-left: auto; font-family: ${fontFamilyMono};
  font-size: ${fontSize.cap}px; color: var(--pddcs-text-tertiary);
  font-variant-numeric: tabular-nums; }

/* ── 搜索栏:iOS 搜索框 —— 填充底、无描边、圆角 10 ────────────────────────── */
.pddcs-search { display: flex; align-items: center; gap: 9px;
  height: ${controlH.form}px; padding: 0 ${spacing.xl + 1}px;
  background: var(--pddcs-fill); border-radius: ${radius.control}px; }
.pddcs-search svg { color: var(--pddcs-text-tertiary); flex-shrink: 0; }
.pddcs-search input { flex: 1; min-width: 0; border: none; outline: none; background: none;
  font-family: inherit; font-size: ${fontSize.body}px; color: var(--pddcs-text); }
.pddcs-search input::placeholder { color: var(--pddcs-text-tertiary); }

/* ── 输入框 / 文本域 ──────────────────────────────────────────────────────── */
.pddcs-input {
  width: 100%; padding: 8px ${spacing.xl}px;
  border-radius: ${radius.control}px; border: 1px solid var(--pddcs-border);
  background: var(--pddcs-bg); color: var(--pddcs-text);
  font-family: inherit; font-size: ${fontSize.body}px; line-height: 1.5; outline: none;
  transition: border-color .18s cubic-bezier(.32,.72,0,1);
}
.pddcs-input::placeholder { color: var(--pddcs-text-tertiary); }
.pddcs-input:focus { border-color: var(--pddcs-text-tertiary); }

/* ── 分类导航:横向 pill。选中 = 墨底白字(小面积实心,不是整行黑块)──────── */
.pddcs-catnav-wrap { display: flex; align-items: center; gap: ${spacing.md}px; min-width: 0; }
.pddcs-catnav { display: flex; flex-wrap: nowrap; align-items: center; gap: 7px;
  flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.pddcs-catnav::-webkit-scrollbar { display: none; }
.pddcs-catnav button {
  flex-shrink: 0; height: ${size.navItemH}px; padding: 0 13px;
  display: inline-flex; align-items: center; gap: 6px;
  border: none; border-radius: ${radius.pill}px; cursor: pointer; font-family: inherit;
  corner-shape: round; /* 胶囊:全圆端,不进连续圆角(见文件头) */
  font-size: ${fontSize.sub}px; background: var(--pddcs-fill); color: var(--pddcs-text-secondary);
  transition: background-color .18s cubic-bezier(.32,.72,0,1), color .18s;
}
.pddcs-catnav button:hover { background: var(--pddcs-selection); color: var(--pddcs-text); }
/* 选中 = 强调色软底 + 强调色文字(v4.0 是墨底白字)。
   小面积实心块会让一排 chip 里"被点走的那个"最重,扫读时视线先被它拽住 ——
   软底把重量让给文字本身,而文字仍是强调色的,该看见的照样一眼看见。 */
.pddcs-catnav button[aria-current='true'] {
  background: var(--pddcs-accent-soft); color: var(--pddcs-accent-text); font-weight: 600;
}
/* 计数:比标签**小一档 + 走等宽**就已经够"退后"了,不再叠 opacity。
   上一版是 11px + opacity .6 —— 落在未选中的填充 pill 上,有效对比度只有
   2.3:1(6 成透明把已经偏灰的文字又洗淡一遍),数字实际上读不出来。
   现在取三级文字色:填充底上 4.2:1,且仍在四档字号阶梯内(12)。 */
.pddcs-catnav .n { font-family: ${fontFamilyMono}; font-size: ${fontSize.cap}px;
  color: var(--pddcs-text-tertiary); font-variant-numeric: tabular-nums; }
/* 选中的 pill 是墨底:计数跟着走 on-ink,而不是继续用"浅面上的三级灰" */
.pddcs-catnav button[aria-current='true'] .n { color: inherit; }

/* ─────────────────────────────────────────────────────────────────────────
   列表与卡片
   ───────────────────────────────────────────────────────────────────────── */

/**
 * 列表容器:v5.0 起**整段内缩**,并且行与行之间**留间隙**。
 *
 * 内缩量必须 ≥ radius.card(16),否则卡片的圆角会被容器边缘视觉上切平 ——
 * 读起来是"直角色块",卡片结构就不成立了。
 */
.pddcs-list { display: flex; flex-direction: column;
  gap: ${listGap.card}px; padding: ${listGap.inset}px; }

/**
 * **卡片 = 列表的直接子元素**。
 *
 * 挂在 "> *"(直接子元素)而不是逐个行类型上,因为三个页签的"卡片壳"不是同一个东西:
 *   记忆页   → 匿名的 <div class="pddcs-hair">(里面装问题行 + 展开区)
 *   标准回答 → 直接就是 .pddcs-gcard
 *   知识库   → 同上
 * 挂在容器上,一处规则覆盖全部,也给将来新增的行类型留好了默认长相。
 */
.pddcs-list > * {
  background: var(--pddcs-fill);
  border: 1px solid transparent;
  border-radius: ${radius.card}px;
  overflow: hidden;
  transition: background-color .18s cubic-bezier(.32,.72,0,1), border-color .18s;
}
.pddcs-list > *:hover { background: var(--pddcs-selection); }
/**
 * 展开中的卡:翻成**卡面底色** + 描边。
 * 用 :has() 而不是给行加类,是因为展开态已经由 aria-expanded 表达了一次 ——
 * 再同步一个类名就多出一份可能不同步的状态。
 * 特异性:.pddcs-list(0,1,0) + :has(参数 0,2,0) = (0,3,0),**盖得住**上面的 :hover(0,2,0)
 */
.pddcs-list > *:has(.pddcs-qrow[aria-expanded='true']) {
  background: var(--pddcs-surface);
  border-color: var(--pddcs-border);
}

/**
 * 缩进发丝线。挂在行上,不是通栏。
 * 缩进量由每一种行通过 --hair-in 自定义属性各自指定(缩进到该行**文字**的左缘)。
 *
 * ⚠️ 在卡片列表里**不画** —— 卡之间已经有 6px 间隙,"线 + 间隙"是把两套边界语言
 * 叠在一起,读起来比只有其中一套更乱。它现在只服务于设置页(卡**内**的行)
 * 与尺码表状态条。
 */
.pddcs-hair { position: relative; }
.pddcs-hair::after {
  content: ""; position: absolute; left: var(--hair-in, ${spacing.xxl}px); right: 0; bottom: 0;
  height: 1px; background: var(--pddcs-separator); pointer-events: none;
}
.pddcs-list .pddcs-hair::after { display: none; }
/* 一段的最后一行不画线 —— 收口交给它下面那块空白 */
.pddcs-section > *:last-child.pddcs-hair::after { display: none; }

/* ── 折叠问题行:两行(问题 / 时间·回复数),**整体靠左**(无序号列)────────
   卡片底色由 .pddcs-list > * 给,行自己**不再有底色** ——
   两层底色会让悬浮时出现"卡变了、行没变"或反过来的色差,读起来像错位 */
.pddcs-qrow {
  display: flex; flex-direction: column; gap: 5px; width: 100%;
  padding: ${spacing.xl + 2}px ${spacing.xxl}px;
  border: none; background: transparent; cursor: pointer; text-align: left;
  font-family: inherit; color: var(--pddcs-text);
}
.pddcs-qrow .line1 { display: flex; align-items: center; gap: ${spacing.md}px; }
.pddcs-qrow .line2 { display: flex; align-items: center; gap: ${spacing.md}px; }
.pddcs-qrow .q { flex: 1; min-width: 0; font-size: ${fontSize.body}px; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pddcs-qrow .meta { font-family: ${fontFamilyMono}; font-size: ${fontSize.cap}px;
  color: var(--pddcs-text-tertiary); font-variant-numeric: tabular-nums; }
/* 已设标准 = 强调色实心星(v4.0 是主文本色 —— 那时没有强调色可用)。
   它是"这条被沉淀过"的标记,该和主按钮说同一种语言 */
.pddcs-qrow .star { flex-shrink: 0; display: inline-flex; color: var(--pddcs-accent); }
/* 折叠指示:展开时翻过来。它是"这一行能点开"的唯一提示,常驻可见 */
.pddcs-qrow .chev { flex-shrink: 0; display: inline-flex; color: var(--pddcs-text-tertiary);
  transition: transform .18s cubic-bezier(.32,.72,0,1); }
.pddcs-qrow[aria-expanded='true'] .chev { transform: rotate(180deg); }
@media (prefers-reduced-motion: reduce) { .pddcs-qrow .chev { transition: none; } }
/* 行尾的操作钮与折叠指示之间不需要那么大间距 —— 它们是一组 */
.pddcs-qrow .line1 > .pddcs-iconbtn { margin: 0 -4px 0 0; }

/* ── 展开区:回复列表。落在卡**内**,所以每条回复是更浅的一层小底 ───────────
   展开时整张卡翻成卡面色(见 .pddcs-list > * 的 :has 规则),回复再用 fill 压一层,
   于是"卡 → 展开区 → 单条回复"三层读得出来,而全程没有一条线参与 */
.pddcs-qopen { padding: 0 ${spacing.xxl}px ${spacing.xl}px; }
.pddcs-reply { display: flex; align-items: flex-start; gap: ${spacing.md}px;
  padding: 9px ${spacing.lg}px; border-radius: ${radius.control}px;
  background: var(--pddcs-fill);
  transition: background-color .18s cubic-bezier(.32,.72,0,1); }
.pddcs-reply:hover { background: var(--pddcs-selection); }
.pddcs-reply + .pddcs-reply { margin-top: ${spacing.sm}px; }
.pddcs-reply .rt { flex: 1; min-width: 0; font-size: ${fontSize.sub}px; line-height: 1.7;
  color: var(--pddcs-text-secondary); white-space: pre-wrap; word-break: break-word; }
.pddcs-reply .ric { display: flex; gap: 2px; flex-shrink: 0; }
/* 回复里的图片附件:44px 方形缩略图,尺寸取"一行文字高度"上下,不把行撑高。
   圆角用 control 档(13)—— 卡片内的小方块再往上走就成胶囊了 */
.pddcs-reply-imgs { display: flex; gap: ${spacing.xs}px; flex-shrink: 0; }
.pddcs-reply-img { display: block; width: 44px; height: 44px; overflow: hidden;
  border-radius: ${radius.control}px; border: 1px solid var(--pddcs-border);
  background: var(--pddcs-surface); }
.pddcs-reply-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* 标准回答卡/编辑态里的图片附件:与回复行同一档尺寸(44)。
   外层只做定位(overflow 必须可见,移除钮要压出角外),裁切交给内层链接 */
/* 只在**卡片展示态**给上间距(它是 .pddcs-gcard 的直接子元素);
   编辑态里这条是 flex 列的一员,间距由 formGap.field 统一给,再加就是 22px 的双份 */
.pddcs-gimgs { display: flex; flex-wrap: wrap; gap: ${spacing.sm}px; }
.pddcs-gcard > .pddcs-gimgs { margin-top: ${spacing.lg}px; }
.pddcs-gimg { position: relative; display: block; width: 44px; height: 44px; }
.pddcs-gimg-a { display: block; width: 100%; height: 100%; overflow: hidden;
  border-radius: ${radius.control}px; border: 1px solid var(--pddcs-border);
  background: var(--pddcs-surface); }
.pddcs-gimg-a img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pddcs-gimg-x { position: absolute; top: -6px; right: -6px; box-sizing: border-box;
  width: 18px; height: 18px; padding: 0; border-radius: ${radius.pill}px;
  corner-shape: round; /* 18px 上的 pill = 正圆,不进连续圆角 */
  border: 1px solid var(--pddcs-border); background: var(--pddcs-surface);
  color: var(--pddcs-text-secondary); font-size: ${fontSize.cap}px; line-height: 1;
  cursor: pointer; display: flex; align-items: center; justify-content: center; }
.pddcs-gimg-x:hover { color: var(--pddcs-text); }
.pddcs-qopen-foot { display: flex; justify-content: flex-start; margin-top: ${spacing.md}px; }

/* ── 标准回答卡 / 知识库卡 ──────────────────────────────────────────────────
   这两个类**只管卡内的排版**:卡面底色、圆角、悬浮、展开态一律由
   .pddcs-list 的直接子元素规则接管(它们本身就是列表的直接子元素) */
.pddcs-gcard { padding: ${spacing.xl + 3}px ${spacing.xxl}px ${spacing.xl}px; }
.pddcs-qa-line { display: flex; align-items: flex-start; gap: ${spacing.md}px; }
.pddcs-qa { flex-shrink: 0; width: 13px; padding-top: 2px; font-family: ${fontFamilyMono};
  font-size: ${fontSize.cap}px; font-weight: 600; color: var(--pddcs-text-tertiary); }
.pddcs-qa-line .txt { flex: 1; min-width: 0; }
.pddcs-gcard .q { font-size: ${fontSize.body}px; font-weight: 600;
  color: var(--pddcs-text); line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.pddcs-gcard .a { font-size: ${fontSize.sub}px; color: var(--pddcs-text-secondary);
  line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.pddcs-gmeta { margin: ${spacing.xs}px 0 0 21px; display: flex; align-items: baseline;
  gap: ${spacing.md}px; flex-wrap: wrap; }
.pddcs-gmeta-flush { margin-left: 0; }
/* 灰标行压在卡片**顶部**(知识库卡:标 → 标题 → 正文,标是卡的第一行)。
   它是 .pddcs-gmeta 的一种朝向,不是一次性的内联 margin 覆盖 ——
   几何留在样式表里,才可能被单测断言 */
.pddcs-gmeta-top { margin-top: 0; margin-bottom: ${spacing.xs}px; }

/**
 * 操作行**左对齐**,与 Q/A 正文同一条竖线。
 * margin-left:21px = 字母槽位 13 + 间距 8,把按钮**盒**推到正文左缘;
 * 首枚图标钮再减 6px(=(28−16)/2,盒内图标留白),让**图标本身**落在竖线上 ——
 * 否则图标会比上方文字多缩进 6px,整行读下来是歪的。
 */
.pddcs-gops { margin-top: ${spacing.lg}px; margin-left: 21px;
  display: flex; justify-content: flex-start; align-items: center; gap: 2px; flex-wrap: wrap; }
/* 知识库卡没有 Q/A 字母槽,正文就从 16px 内边距起 —— 操作行不补那 21px */
.pddcs-gops-flush { margin-left: 0; }
/* 首枚图标钮减 6px(=(28−16)/2,盒内图标留白),让**图标本身**落在正文竖线上 */
.pddcs-gops > .pddcs-iconbtn:first-child { margin-left: -6px; }

/* 空类型说明行 */
.pddcs-gempty { padding: ${spacing.xl}px ${spacing.xxl}px ${spacing.xxl}px;
  font-size: ${fontSize.sub}px; color: var(--pddcs-text-tertiary); line-height: 1.7; }

/* ── 知识库卡:标题 + 正文(3 行截断)+ 灰标 + 操作行 ─────────────────────── */
.pddcs-kb-title { font-size: ${fontSize.body}px; font-weight: 600;
  color: var(--pddcs-text); line-height: 1.45; word-break: break-word; }
.pddcs-kb-body { margin-top: ${spacing.xs}px; font-size: ${fontSize.sub}px;
  color: var(--pddcs-text-secondary); line-height: 1.6; white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

/* ── 尺码表状态条:v5.0 起是一条**强调色软底横幅** ─────────────────────────
   v4.0 它是"一行文字 + 发丝线"。改横幅不是装饰:尺码表改变了检索行为
   (整篇原文走生成、不进向量检索),它是这一页唯一一条"当前生效的全局设置",
   值得有个形状。软底而非实心 —— 它是状态,不是动作 */
.pddcs-sizeline {
  display: flex; align-items: center; gap: ${spacing.lg}px; flex-wrap: wrap;
  margin: 0 ${listGap.inset}px ${spacing.lg}px;
  padding: ${spacing.lg}px ${spacing.xl}px;
  background: var(--pddcs-accent-soft); border-radius: ${radius.control}px;
  font-size: ${fontSize.sub}px; color: var(--pddcs-text-secondary); }
/* 它已经是一条横幅,不需要再画线(标记里仍带着 pddcs-hair,在此抵消) */
.pddcs-sizeline.pddcs-hair::after { display: none; }
.pddcs-sizeline .nm { font-weight: 600; color: var(--pddcs-accent-text); }
.pddcs-sizeline .ct { font-family: ${fontFamilyMono}; font-size: ${fontSize.cap}px;
  color: var(--pddcs-text-tertiary); font-variant-numeric: tabular-nums; }
.pddcs-sizeline .sp { flex: 1; }

/* ── 设置页:分区头**在卡外**,行**在卡内** ─────────────────────────────────
   v4.0 的分区不是盒子(标题 + 行都落在同一片面上)。v5.0 改成"标题在卡外、
   行收进一张卡"—— 设置页一行一件事,分组才读得出来;
   分区标题留在卡外,是为了让"这一组叫什么"和"这一组有多少行"一眼分得开。

   分区**不设 gap**:行自带 12px 上下内边距与下缘发丝线,再插一层 gap 会把
   发丝线从行底"浮"起来(线下面是空档,看着像分隔了别的东西) */
.pddcs-section { display: flex; flex-direction: column; }
/* 分区标题直接落在页面上(iOS plain 列表的分区头),不是卡片里的一行。
   左对齐量取 listGap.inset —— 必须与下方卡片的左缘同一条竖线 */
.pddcs-section-title { font-size: ${fontSize.cap}px; font-weight: 600;
  color: var(--pddcs-text-tertiary); letter-spacing: .03em;
  padding: 26px ${listGap.inset}px 8px; }
.pddcs-section:first-of-type .pddcs-section-title { padding-top: ${spacing.sm}px; }

/**
 * 分区主体 = 一张卡。行落在里面,分隔仍然用行自己的发丝线(卡**内**的线,
 * 与卡**间**的间隙是两套边界语言里的第一套)。
 */
.pddcs-section-body {
  margin: 0 ${listGap.inset}px;
  background: var(--pddcs-fill);
  border-radius: ${radius.card}px;
  overflow: hidden;
}

/* 设置页的分页导航复用 .pddcs-catnav:七个固定项一屏排下,chip 内边距收窄一档 */
.pddcs-settings-nav .pddcs-catnav > button { padding: 0 ${spacing.lg}px; gap: 4px; }

/* ── 设置页 v2:分区头(图标 + 标题 + 概要) ──────────────────────────────────
   旧版是一行 12px 小灰字,分组标题与行标签的层级几乎一样 —— 一屏扫下去
   分不出"这是第几组"。新版标题回到 15px/600,前面一枚强调色图标,右侧一句
   概要说明这组能干什么。 */
.pddcs-section { scroll-margin-top: ${controlH.form + spacing.md}px; }
.pddcs-sect-head {
  display: flex; align-items: center; gap: ${spacing.md}px;
  padding: ${spacing.xxl + 6}px ${listGap.inset}px ${spacing.md}px;
}
/* 导航 → 首个分区:导航不再加下边距,由这里给满一档 16(与列表页同一节奏) */
.pddcs-section:first-of-type .pddcs-sect-head { padding-top: ${spacing.xxl}px; }
.pddcs-sect-head .ic {
  width: ${controlH.inline}px; height: ${controlH.inline}px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: ${radius.control}px;
  background: var(--pddcs-accent-soft); color: var(--pddcs-accent-text);
}
.pddcs-sect-head .t { font-size: ${fontSize.body}px; font-weight: 600; color: var(--pddcs-text); }
.pddcs-sect-head .s {
  margin-left: auto; font-size: ${fontSize.cap}px; color: var(--pddcs-text-tertiary);
  text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* 卡内的子分组标题(相似度阈值 / 数据保留) */
.pddcs-subgroup {
  padding: ${spacing.xl}px ${spacing.xxl}px ${spacing.xs}px;
  font-size: ${fontSize.cap}px; font-weight: 600;
  color: var(--pddcs-text-tertiary); letter-spacing: .02em;
}

/* 堆叠式字段:标签一行,控件下一行占满宽度 */
.pddcs-field-stack {
  display: flex; align-items: center; gap: ${spacing.md}px;
  margin-top: ${formGap.labelControl}px;
}

/* ── 设置页 v2:操作条 ──────────────────────────────────────────────────────
   一条规则贯穿全页:**说明/结论贴左,按钮贴右,主按钮在最右**。
   按钮组用 margin-left:auto 钉住,结论再长也推不动它 —— 位置稳定,手就不用重新找。 */
.pddcs-actionbar {
  display: flex; align-items: center; gap: ${spacing.xl}px;
  padding: ${spacing.xl}px ${spacing.xxl}px; min-height: 58px;
}
.pddcs-actionbar .status {
  flex: 1; min-width: 0;
  font-size: ${fontSize.cap}px; line-height: 1.6; color: var(--pddcs-text-tertiary);
}
.pddcs-actionbar .status > span { display: block; }
.pddcs-actionbar .status > span + span { margin-top: 3px; }
.pddcs-actionbar .btns {
  margin-left: auto; flex-shrink: 0;
  display: flex; align-items: center; gap: ${spacing.md}px;
}

/* 整行说明:颜色由 tone 决定,不再每处内联一套 */
.pddcs-srow[data-tone='danger'] { color: var(--pddcs-danger); }
.pddcs-srow[data-tone='danger'] .n,
.pddcs-srow[data-tone='danger'] .d { color: var(--pddcs-danger); }
.pddcs-srow[data-tone='muted'] { color: var(--pddcs-text-tertiary); }

/* ── 设置页 v2:指标瓦片(使用统计) ────────────────────────────────────────
   五六个"数字 + 名字"逐行排会吃掉半屏;两列瓦片一眼扫完。
   瓦片之间用 1px 缝 + 卡片底色画出格线,不额外描边。 */
.pddcs-metrics {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 1px; background: var(--pddcs-separator);
}
.pddcs-metric { background: var(--pddcs-fill); padding: ${spacing.xl}px ${spacing.xxl}px; }
.pddcs-metric[data-wide='true'] { grid-column: 1 / -1; }
.pddcs-metric .k { font-size: ${fontSize.cap}px; color: var(--pddcs-text-tertiary); }
.pddcs-metric .v {
  margin-top: 3px;
  font-family: ${fontFamilyMono}; font-variant-numeric: tabular-nums;
  font-size: ${fontSize.body}px; font-weight: 600; color: var(--pddcs-text);
}

/* 设置行:标签在左、控件在右;也用来装"只有内容"的行(提示句、按钮组、说明段) */
.pddcs-srow { --hair-in: ${spacing.xxl}px;
  display: flex; align-items: center; gap: ${spacing.xl}px;
  min-height: 52px; padding: ${spacing.xl}px ${spacing.xxl}px; }
/* 内容自己纵向排(说明段 / 按钮组 / 自查提示)—— 内边距与发丝线照旧 */
.pddcs-srow.pddcs-srow-blk { display: block; }
/**
 * 块式行里的**每一行说明各占一行**。
 *
 * 这不是锦上添花:block 布局下几个裸 span 是 inline 的,会首尾相接读成
 * 一个长句 —— 「关于」卡那三句("一行一件事")本来是排版成分句的,不写这条
 * 就会挤成一段;间距取 formGap.labelDesc,与标签→说明同一档。
 */
.pddcs-srow-blk > span { display: block; }
.pddcs-srow-blk > span + span { margin-top: ${formGap.labelDesc}px; }
/* 按钮组 + 就地结论:一行装不下可以折行(折行后仍在同一套内边距与发丝线里) */
.pddcs-srow-wrap { flex-wrap: wrap; }
.pddcs-srow-label { flex: 1; min-width: 0; }
/* ── 悬浮说明(ⓘ)──────────────────────────────────────────────────────────
   气泡向上展开:这一块通常在卡片最后一行,向下会被卡片的 overflow:hidden 裁掉。
   宽 252 是量出来的 —— 卡片正文宽 343,气泡左对齐在标题后面时不会越出右缘。 */
.pddcs-hint {
  position: relative; display: inline-flex; align-items: center;
  margin-left: 6px; color: var(--pddcs-text-tertiary); cursor: help;
  vertical-align: -2px;
}
.pddcs-hint:hover, .pddcs-hint:focus-visible { color: var(--pddcs-text); }
.pddcs-hint .bubble {
  position: absolute; left: -8px; bottom: calc(100% + 8px); z-index: 4;
  width: 252px; padding: ${spacing.md}px ${spacing.lg}px;
  border-radius: ${radius.control}px;
  background: var(--pddcs-surface); color: var(--pddcs-text-secondary);
  border: 1px solid var(--pddcs-border);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--pddcs-ink) 18%, transparent);
  font-size: ${fontSize.cap}px; line-height: 1.55; font-weight: 400;
  opacity: 0; visibility: hidden; transform: translateY(2px);
  transition: opacity .16s, transform .16s, visibility .16s;
  pointer-events: none;
}
.pddcs-hint:hover .bubble,
.pddcs-hint:focus-visible .bubble {
  opacity: 1; visibility: visible; transform: none;
}

/* 块式行的"标题 + 行内动作"顶栏:标题占满、按钮贴右;下面的说明因此能占满整行 */
.pddcs-srow-lead {
  display: flex; align-items: center; gap: ${spacing.xl}px;
  margin-bottom: ${formGap.labelControl}px;
}
.pddcs-srow-lead .n { flex: 1; min-width: 0; }
.pddcs-srow-label .n { display: block; font-size: ${fontSize.body}px; color: var(--pddcs-text); }
/* 标签 → 说明的间距取 formGap.labelDesc(4),不是凭手感写的 2 ——
   同一件事的两个值会让「统一的设置页行距」从内部裂开 */
.pddcs-srow-label .d { display: block; font-size: ${fontSize.cap}px;
  color: var(--pddcs-text-tertiary); margin-top: ${formGap.labelDesc}px; line-height: 1.5; }
.pddcs-srow-value { font-family: ${fontFamilyMono}; font-size: ${fontSize.cap}px;
  color: var(--pddcs-text-tertiary); font-variant-numeric: tabular-nums; }

/* ── 拨杆开关:iOS 胶囊轨 + 圆柄。选中 = 墨色轨(无彩主题下不用 iOS 绿)────── */
.pddcs-switch { position: relative; display: inline-block; flex-shrink: 0; cursor: pointer;
  width: 48px; height: 28px; border-radius: ${radius.pill}px;
  corner-shape: round; /* 胶囊轨:全圆端不进连续圆角 */
  background: var(--pddcs-border);
  transition: background-color ${motion.emphasized}; }
/* 选中 = 强调色轨(v4.0 是墨色轨 —— 那时没有强调色可用)。
   开关是"当前状态"最强的一次表达,理应占用强调色 */
.pddcs-switch[aria-checked='true'] { background: var(--pddcs-accent); }
.pddcs-switch-knob {
  position: absolute; top: 2px; left: 2px;
  width: 24px; height: 24px; border-radius: 50%;
  corner-shape: round; /* 圆柄:正圆 */
  background: #FFFFFF; box-shadow: 0 1px 3px rgba(0,0,0,.22);
  /* 位移是开关本身的语义,不是悬浮特效 */
  transition: left ${motion.emphasized}, background-color .18s;
}
.pddcs-switch[aria-checked='true'] .pddcs-switch-knob {
  left: 22px; background: var(--pddcs-on-accent);
}
@media (prefers-reduced-motion: reduce) {
  .pddcs-switch-knob { transition: none; }
}

/* ── 滑杆:iOS 轨道 + 圆拇指 ──────────────────────────────────────────────── */
.pddcs-slider {
  -webkit-appearance: none; appearance: none; display: block;
  width: 100%; height: 4px; margin: ${spacing.lg}px 0 0;
  border-radius: ${radius.pill}px; background: var(--pddcs-border); outline: none; cursor: pointer;
  corner-shape: round; /* 轨道是胶囊,不是圆角矩形 */
}
.pddcs-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 20px; height: 20px; border-radius: 50%;
  corner-shape: round; /* 圆拇指 */
  background: #FFFFFF; border: 1px solid var(--pddcs-border);
  box-shadow: 0 1px 3px rgba(0,0,0,.2); cursor: pointer;
}
.pddcs-slider::-moz-range-thumb {
  width: 20px; height: 20px; border-radius: 50%;
  corner-shape: round; /* 圆拇指 */
  background: #FFFFFF; border: 1px solid var(--pddcs-border);
  box-shadow: 0 1px 3px rgba(0,0,0,.2); cursor: pointer;
}
.pddcs-slider::-moz-range-track { height: 4px; border-radius: ${radius.pill}px; background: transparent;
  corner-shape: round; }

/* ── 提示条:浮起的小卡片 ───────────────────────────────────────────────────
   旧版是一条通栏底色 + 贴边文字,读起来像"页面多了一段"。改成居中浮起的一块:
   宽度跟着文字走、有阴影与描边,滚动时压在内容上方 —— 它本来就该像 tooltip,
   而不是像正文。ok 用 info(本调色板里唯一的正向语义色),失败用 danger。

   **height: 0 是重点**:提示条不能占版面 —— 否则它一出现就把下面的分区整体下推,
   读起来像"窗口被挤了一下"。零高度 + align-items:flex-start + overflow:visible,
   sticky 仍然生效,但它在文档流里不占任何空间。 */
.pddcs-notice { position: sticky; top: 0; height: 0; z-index: 3;
  display: flex; align-items: flex-start; justify-content: center;
  overflow: visible; pointer-events: none; }
.pddcs-notice-body {
  pointer-events: auto; max-width: 100%; text-align: left;
  margin-top: ${spacing.md}px;
  padding: ${spacing.sm}px ${spacing.xl}px;
  border-radius: ${radius.control}px; border: 1px solid transparent;
  font-size: ${fontSize.sub}px; line-height: 1.5; font-weight: ${fontWeight.medium};
  word-break: break-word;
  box-shadow: 0 6px 16px color-mix(in srgb, var(--pddcs-ink) 16%, transparent);
  animation: pddcs-notice-in ${motion.fast};
}
@keyframes pddcs-notice-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) { .pddcs-notice-body { animation: none; } }
.pddcs-notice-body[data-ok='true'] {
  background: var(--pddcs-info-soft); color: var(--pddcs-info-text);
  border-color: color-mix(in srgb, var(--pddcs-info-text) 24%, transparent);
}
.pddcs-notice-body[data-ok='false'] {
  background: var(--pddcs-danger-soft); color: var(--pddcs-danger);
  border-color: color-mix(in srgb, var(--pddcs-danger) 24%, transparent);
}

/* ── 左侧图标栏:选中 = 强调色软底 + 强调色图标 ─────────────────────────────
   v4.0 是"墨底白字"的反转块。改走软底的理由与分类 chip 同一条:
   图标栏只有 38px 宽,一块实心黑压在那儿,视线每次扫过都会被它拽一下;
   而软底 + 彩色图标在"一眼看出在哪一页"这件事上并不更差 */
.pddcs-rail-btn {
  width: ${size.railBtn}px; height: ${size.railBtn}px; padding: 0;
  border: none; border-radius: ${radius.control}px; background: transparent;
  color: var(--pddcs-text-tertiary);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background-color .18s cubic-bezier(.32,.72,0,1), color .18s;
}
.pddcs-rail-btn:hover { background: var(--pddcs-fill); color: var(--pddcs-text); }
.pddcs-rail-btn[aria-current='true'] {
  background: var(--pddcs-accent-soft); color: var(--pddcs-accent-text);
}

/* ── 滚动条:细、悬浮才显现 ──────────────────────────────────────────────────
   容器上必须配 scrollbar-gutter: stable(见 .pddcs-scroll)—— 滚动条显隐不能
   改变任何一行的宽度,否则展开一条问答时会看到整列文字横向抖一下 */
${thinScrollbarCss('.pddcs-scroll', 'var(--pddcs-scroll-thumb)')}
.pddcs-scroll { scrollbar-gutter: stable; }
`
