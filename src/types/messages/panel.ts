// ─── 面板消息(popup → SW,P3):记忆列表 / 金标准 / 文件夹 ────────────────────
// 面板线类型:剥离向量字段,减小消息体积(向量只活在 SW/IndexedDB 内)。

// ─── 记忆列表 ─────────────────────────────────────────────────────────────────

export interface MemoryReplyItem {
  id: string
  text: string
  ts: number
  /** 该回复已被提升为标准回答时的金标准 id(goldens.sourceReplyId 反查,2026-09-15 PM1) */
  goldenId?: string
}

export interface MemoryListItem {
  id: string
  question: string
  questionTs: number
  replyCount: number
  replies: MemoryReplyItem[]
  /**
   * 问题类型 id。**已归一**:库里缺省或为 null 的记录在这里一律是 'uncategorized'。
   * 面板据此分桶,不需要再做 null/undefined 判断。
   */
  categoryId: string
  /**
   * 谁打的标。**刻意不归一** —— `undefined` 是"从没打过标"(旧数据),
   * 与 `'jev'` 的语义不同(后者是"机器判的,可能判错")。面板靠它决定
   * 要不要给这条挂「低置信」标。
   */
  categorySource?: 'jev' | 'inherit' | 'manual'
  /** 机器打标时的概率(0~1)。只有 jev 路径会写;复核线见 constants.LOW_CONFIDENCE_LINE */
  categoryConfidence?: number
}

export interface GetMemoryListRequest {
  type: 'GET_MEMORY_LIST'
  /** 分页(PM2):offset 起始条数(缺省 0);limit 单页条数(缺省 100) */
  payload?: { offset?: number; limit?: number }
}

export interface GetMemoryListResponse {
  type: 'GET_MEMORY_LIST_RESPONSE'
  payload: {
    items: MemoryListItem[]
    /** 排除自检数据后的问答总数(与头部统计同口径) */
    total: number
    /** 是否还有更早记录 */
    hasMore: boolean
    error?: string
  }
}

export interface DeleteQaRequest {
  type: 'DELETE_QA'
  payload: { id: string }
}

export interface DeleteQaResponse {
  type: 'DELETE_QA_RESPONSE'
  payload: { success: boolean; error?: string }
}

/** 清空问答记忆(PM6a:qa+replies;金标准/知识库/文件夹保留) */
export interface ClearMemoryDataRequest {
  type: 'CLEAR_MEMORY_DATA'
}

export interface ClearMemoryDataResponse {
  type: 'CLEAR_MEMORY_DATA_RESPONSE'
  payload: { success: boolean; deletedQa: number; error?: string }
}

// ─── 金标准 / 文件夹 ──────────────────────────────────────────────────────────

export interface PanelFolder {
  id: string
  parentId: string | null
  name: string
  position: number
}

export interface PanelGolden {
  id: string
  folderId: string | null
  question: string
  answer: string
  hasEmbedding: number
  updatedAt: number
  /** 问题类型 id;**已归一**(缺省 → 'uncategorized') */
  categoryId: string
  /** 谁打的标。'manual' = 你手工摆的,补分类会跳过;缺省 = 机器没跑过 */
  categorySource?: string
  /**
   * 机器打标时的概率(0~1)。只有 jev 路径会写(继承与人工都不写)。
   * 标准回答卡据此标「低置信」—— 低于复核线的判定值得人工看一眼
   * (复核线见 constants.LOW_CONFIDENCE_LINE)。
   */
  categoryConfidence?: number
}

/** 面板用的类型条目。**不带 criteria** —— 那是喂给 jev 的,面板用不上,也不该跟着 DTO 到处传 */
export interface PanelCategory {
  id: string
  name: string
  kind: 'preset' | 'custom' | 'uncategorized'
  /** true = 参与类型过滤(与"是 jev 的选项"是同一个集合) */
  filterable: boolean
  /**
   * 类型的作用域(与 `filterable` 分工不同,别混用):
   *  - `filterable` 管「是不是 jev 的选项」——决定进不进分类选项集;
   *  - `route` 管「记录级可见 + 查询时怎么走」——`'retrieve'` 走类型检索,
   *    历史与标准回答可复用;`'size'` 是查询级专用(答案依赖买家个体参数),
   *    记录级永不会有这个标签,也不走检索池。
   * 面板据此把 `route === 'size'` 的类型从「历史问答 / 标准回答」两页隐藏掉。
   */
  route: 'retrieve' | 'size'
  position: number
}

/** 知识库条目面板线类型(剥向量) */
export interface PanelKnowledge {
  id: string
  title: string
  content: string
  hasEmbedding: number
  enabled: number
  /** manual=手工;doc=md 文档分块(只读) */
  source?: 'manual' | 'doc'
  /** 所属文档名(去扩展名);手工条目缺省。分块 id 形态 `${docId}-c${序号}` */
  docId?: string
  /**
   * 该文档被标记为尺码表(文档级,**由 kbDocs 现算**,不随块存)。
   * 面板据此在文档第一块上渲染开关;缺省/手工条目一律无此字段。
   */
  isSizeTable?: boolean
  updatedAt: number
}

export interface GetPanelDataRequest {
  type: 'GET_PANEL_DATA'
}

export interface GetPanelDataResponse {
  type: 'GET_PANEL_DATA_RESPONSE'
  payload: {
    folders: PanelFolder[]
    goldens: PanelGolden[]
    knowledge: PanelKnowledge[]
    /** 全部问题类型,按 position 升序(未分类恒最后);面板据此渲染类型表/分桶 */
    categories: PanelCategory[]
    /** 升级前上传、无原文可重切的文档名(知识库页提示重新上传;缺省=无) */
    legacyDocs?: string[]
    /**
     * 逐条用量(v0.16):条目 id → 被填充次数。**只含 >0 的条目** ——
     * 新装的库是空对象,行上不会平白多出一排「被用 0 次」。
     * 金标准与知识库共用一张表,key 不会撞(uuid 互不重叠)。
     */
    itemUsage?: Record<string, number>
    error?: string
  }
}

/** 编辑保存即重嵌(问题实质变更时);folderId 兼作"迁移文件夹" */
export interface UpdateGoldenRequest {
  type: 'UPDATE_GOLDEN'
  payload: {
    id: string
    question?: string
    answer?: string
    folderId?: string | null
  }
}

export interface UpdateGoldenResponse {
  type: 'UPDATE_GOLDEN_RESPONSE'
  payload: { id?: string; reembed?: boolean; error?: string }
}

/**
 * 手动把一条标准回答移到另一个问题类型。
 *
 * 与 UPDATE_GOLDEN 分开是**故意**的:那条走编辑/重嵌管线(会作废检索缓存),
 * 而移动类型既不碰问题向量也不进检索 —— 合在一起会让一次纯摆放动到重嵌逻辑。
 * 落库时 categorySource 置 'manual'(用户手工摆放,补分类永不许覆盖)。
 */
export interface UpdateGoldenCategoryRequest {
  type: 'UPDATE_GOLDEN_CATEGORY'
  payload: { id: string; categoryId: string }
}

export interface UpdateGoldenCategoryResponse {
  type: 'UPDATE_GOLDEN_CATEGORY_RESPONSE'
  payload: { success: boolean; error?: string }
}

export interface DeleteGoldenRequest {
  type: 'DELETE_GOLDEN'
  payload: { id: string }
}

export interface DeleteGoldenResponse {
  type: 'DELETE_GOLDEN_RESPONSE'
  payload: { success: boolean; error?: string }
}

export interface CreateFolderRequest {
  type: 'CREATE_FOLDER'
  payload: { name: string; parentId: string | null }
}

export interface CreateFolderResponse {
  type: 'CREATE_FOLDER_RESPONSE'
  payload: { id?: string; error?: string }
}

export interface RenameFolderRequest {
  type: 'RENAME_FOLDER'
  payload: { id: string; name: string }
}

export interface RenameFolderResponse {
  type: 'RENAME_FOLDER_RESPONSE'
  payload: { success: boolean; error?: string }
}

export interface DeleteFolderRequest {
  type: 'DELETE_FOLDER'
  payload: { id: string }
}

export interface DeleteFolderResponse {
  type: 'DELETE_FOLDER_RESPONSE'
  payload: { success: boolean; error?: string }
}

/** 遗留子文件夹一键拍平(PM7):金标准上移父夹,删除子夹 */
export interface FlattenFoldersRequest {
  type: 'FLATTEN_FOLDERS'
}

export interface FlattenFoldersResponse {
  type: 'FLATTEN_FOLDERS_RESPONSE'
  payload: { success: boolean; flattened: number; error?: string }
}

// ─── 问题类型的 CRUD(第五十七轮 Task 7)───────────────────────────────────────
//
// 预置类型与未分类不可改名/删(设计 D3);新建恒 filterable=true、恒要求 criteria 非空。

/** 新建自定义问题类型。criteria 是发给 jev 的选项描述,必填且非空白 */
export interface CreateCategoryRequest {
  type: 'CREATE_CATEGORY'
  payload: { name: string; criteria: string }
}

export interface CreateCategoryResponse {
  type: 'CREATE_CATEGORY_RESPONSE'
  payload: { id?: string; error?: string }
}

/** 改名(仅自定义类型;判定说明不在此列,改名不要求重填 criteria) */
export interface RenameCategoryRequest {
  type: 'RENAME_CATEGORY'
  payload: { id: string; name: string }
}

export interface RenameCategoryResponse {
  type: 'RENAME_CATEGORY_RESPONSE'
  payload: { success: boolean; error?: string }
}

/** 删除自定义类型;其中的标答落回未分类(不跟着消失),movedGoldens 为落回条数 */
export interface DeleteCategoryRequest {
  type: 'DELETE_CATEGORY'
  payload: { id: string }
}

export interface DeleteCategoryResponse {
  type: 'DELETE_CATEGORY_RESPONSE'
  payload: { success: boolean; movedGoldens?: number; error?: string }
}
