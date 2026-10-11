/**
 * 问题类型 CRUD(P3,第五十七轮 Task 7)—— popup「标准回答」页的类型新建 / 改名 / 删除。
 *
 * 表与 DAO 仍在 db.ts(categories 的种子/读取见 db#listCategories / ensurePresetCategories);
 * 本文件只做**校验 + 编排**,不重复已存在的 DAO 逻辑。
 *
 * 四条硬约束(每条对应一个真实失败模式):
 *  ① 类型名唯一(trim 后比较,含与预置重名)。重名会让 jev 的 idByName 互相覆盖 ——
 *    静默错分,且没有任何报错。这是硬拦截。
 *  ② 新建时 criteria 必填且非空白。它是要发给 jev 的选项描述;空描述会让这个类型变成
 *    分类时的噪声选项,把**全部**类型的判断质量一起拉低(spec §6.1:filterable ⇒ criteria 非空)。
 *  ③ 预置与未分类不可改名、不可删(spec D3)。删掉预置类型会让已按它分类的条目再也搜不到
 *    —— 它不在检索池里了。改名同理(条目会挂着一个不存在的名字)。
 *  ④ 删除自定义类型时,其中的标答与**历史问答**在一个事务里落回未分类,
 *    **categorySource 保持原值**(手动摆过的仍标 manual;机器永不许覆盖用户手工摆放
 *    的口径不因删除而失守)。历史问答漏搬会留下悬空 categoryId —— 既进不了补分类候选,
 *    又会在将来按类型过滤的检索里被静默排除。
 */
import { db } from "./db";
import { invalidateRetrievalCache } from "./retrievalCache";
import { PRESET_CATEGORIES, UNCATEGORIZED_CATEGORY_ID } from "../shared/constants";
import type {
  CreateCategoryRequest,
  DeleteCategoryRequest,
  RenameCategoryRequest,
} from "../types/messages";

/** 与 panel.ts#newId 同款:时间戳 + 随机尾,避免连续创建撞 id */
const newId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const DUPLICATE_HINT = "重名会让分类结果互相覆盖(静默错分),请换一个名字";

/**
 * 新建自定义问题类型。
 *
 * `filterable` 恒为 true(新建的类型就是要参与 jev 分类),因此 `criteria` 必填;
 * `route` 恒为 'retrieve' —— 自定义类型没有尺码路由的个体参数依赖。
 */
export async function createCategory(
  message: CreateCategoryRequest,
): Promise<{ id?: string; error?: string }> {
  const name = (message.payload?.name ?? "").trim();
  const criteria = (message.payload?.criteria ?? "").trim();
  if (!name) return { error: "类型名不能为空" };
  if (!criteria) {
    return {
      error:
        "判定说明不能为空:它是发给分类模型的选项描述,空描述会让这个类型变成分类噪声,拉低全部类型的判断质量",
    };
  }

  const all = await db.listCategories();
  // trim 后比较:带空格的重名同样是重名,且预置名也在拦截范围内
  if (all.some((c) => c.name.trim() === name)) {
    return { error: `类型名「${name}」已存在:${DUPLICATE_HINT}` };
  }

  // 排在预置(position 0..N-1)之后、未分类(9999)之前:取当前自定义段最大值 + 1
  const customPositions = all.filter((c) => c.kind === "custom").map((c) => c.position);
  const position =
    customPositions.length > 0 ? Math.max(...customPositions) + 1 : PRESET_CATEGORIES.length;

  const now = Date.now();
  const id = newId("cat");
  await db.categories.add({
    id,
    name,
    criteria,
    kind: "custom",
    route: "retrieve",
    filterable: true,
    position,
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

/**
 * 改名(仅自定义类型)。
 *
 * **不要求重填 criteria** —— 改名不碰判定说明,只换显示名(唯一性约束与新建同款)。
 */
export async function renameCategory(
  message: RenameCategoryRequest,
): Promise<{ success: boolean; error?: string }> {
  const name = (message.payload?.name ?? "").trim();
  if (!name) return { success: false, error: "类型名不能为空" };

  const cat = await db.categories.get(message.payload.id);
  if (!cat) return { success: false, error: "类型不存在" };
  if (cat.kind !== "custom") {
    return { success: false, error: "预置类型与「未分类」不可改名" };
  }

  const all = await db.listCategories();
  if (all.some((c) => c.id !== cat.id && c.name.trim() === name)) {
    return { success: false, error: `类型名「${name}」已存在:${DUPLICATE_HINT}` };
  }

  await db.categories.update(cat.id, { name, updatedAt: Date.now() });
  return { success: true };
}

/**
 * 删除自定义类型:把该类型下的标答与**历史问答**都落回未分类,再删类型本身 —— **一个事务**。
 *
 * 只改 `categoryId`,`categorySource` 原样保留:手动摆过的仍是 'manual',
 * 补分类候选取舍的口径不因这次删除而改变。删类型绝不能把条目一起带走。
 *
 * 历史问答也要搬(修复轮 1/5):qaRecords 同样会被分类进自定义类型(捕获时的 jev 判定
 * 可以返回任何可分类类型),漏掉它们会留下指向已删类型的**悬空 categoryId** ——
 * 那些行既进不了补分类候选、又会在将来按类型过滤的检索里两边都不在(静默召回退化)。
 */
export async function deleteCategory(
  message: DeleteCategoryRequest,
): Promise<{ success: boolean; movedGoldens?: number; error?: string }> {
  const cat = await db.categories.get(message.payload?.id);
  if (!cat) return { success: false, error: "类型不存在" };
  if (cat.kind !== "custom") {
    return {
      success: false,
      error: "预置类型与「未分类」不可删除:删掉后已按它分类的条目会再也搜不到",
    };
  }

  let movedGoldens = 0;
  await db.transaction("rw", db.goldens, db.qaRecords, db.categories, async () => {
    movedGoldens = await db.goldens
      .filter((g) => g.categoryId === cat.id)
      .modify({ categoryId: UNCATEGORIZED_CATEGORY_ID });
    // 历史问答同搬,同样只动 categoryId(来源保持原值)
    await db.qaRecords
      .filter((q) => q.categoryId === cat.id)
      .modify({ categoryId: UNCATEGORIZED_CATEGORY_ID });
    await db.categories.delete(cat.id);
  });
  // 分类已进检索:这次一次搬动该类型下**全部**标答与历史,走整体失效而非逐条定点更新
  // (批量场景下逐条定位反而更绕,而重建只发生在删除后的第一次检索)。
  invalidateRetrievalCache();
  return { success: true, movedGoldens };
}
