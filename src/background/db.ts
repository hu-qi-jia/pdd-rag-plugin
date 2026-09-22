/**
 * 拼多多客服快捷回复 · IndexedDB 层(Dexie)
 *
 * 库名 `PddCSDB`(全新库,无旧数据迁移;旧 AIMemoryDB 由 SW 启动时尝试删除)。
 *
 * 表:
 *   qaRecords — 问答记录(保留期内,问题为检索锚)
 *   replies   — 客服回复(候选本体,contentHash 折叠)
 *   goldens   — 金标准(长期,豁免保留期,独立可编辑问答文档)
 *   folders   — 回复文件夹(两层,parentId=null 即根层)
 *   knowledge — 知识库条目(人工维护"标题+正文"话术卡,豁免保留期)
 *   kbDocs    — 知识库文档原文(分块器版本变更时重新分块的事实源,豁免保留期)
 *   metrics   — 使用统计计数器(本地埋点,不参与检索)
 *   errors    — 错误日志
 *
 * hasEmbedding 三态:0=待嵌(启动扫描重试) 1=已嵌 -1=嵌入失败(记录 errors,下次启动扫描重试)
 */
import Dexie, { type Table } from "dexie";
import { SELF_TEST_SESSION_KEY, UNCATEGORIZED_FOLDER_ID, UNCATEGORIZED_FOLDER_NAME } from '../shared/constants';
import { itemMetricKey, parseItemMetricKey } from '../shared/metrics';
import type {
  ErrorLog,
  FolderRecord,
  GoldenRecord,
  KbDocRecord,
  KnowledgeRecord,
  MetricRecord,
  QaRecord,
  ReplyRecord,
} from '../types/memory';

// 检索缓存失效钩子(工程5b):改变"已嵌三源"集合的写路径必须调用。
// 循环依赖安全:本模块只在方法体内(运行时)使用它,模块求值期不触碰。
import { invalidateRetrievalCache } from "./retrievalCache";

export class PddDatabase extends Dexie {
  qaRecords!: Table<QaRecord, string>;
  replies!: Table<ReplyRecord, string>;
  goldens!: Table<GoldenRecord, string>;
  folders!: Table<FolderRecord, string>;
  knowledge!: Table<KnowledgeRecord, string>;
  kbDocs!: Table<KbDocRecord, string>;
  metrics!: Table<MetricRecord, string>;
  errors!: Table<ErrorLog, number>;

  constructor() {
    super("PddCSDB");

    this.version(1).stores({
      qaRecords:
        "id, sessionKey, questionHash, questionTs, hasEmbedding, [sessionKey+questionTs]",
      replies: "id, qaId, contentHash, ts",
      goldens: "id, folderId, questionHash, hasEmbedding",
      folders: "id, parentId",
      errors: "++id, timestamp",
    });

    // P4-KB v1:知识库表(已建库的浏览器走 Dexie 升级,新装直接建 version(3))
    this.version(2).stores({
      knowledge: "id, questionHash, hasEmbedding, enabled",
    });

    // P4-KB 文档上传:knowledge 加 docId 索引(整篇替换/按文档清理)
    this.version(3).stores({
      knowledge: "id, questionHash, hasEmbedding, enabled, docId",
    });

    // msgId 库级幂等(SW 重启后重放防御):qaRecords 首条买家消息锚点 + replies 平台 msg_id 索引
    // (旧 findReplyByMsgId 走全表 filter,此处升为索引查询)
    this.version(4).stores({
      qaRecords:
        "id, sessionKey, questionHash, questionTs, hasEmbedding, [sessionKey+questionTs], msgId",
      replies: "id, qaId, contentHash, ts, msgId",
    });

    // 知识库文档原文:knowledge 只存切好的块,分块规则一变旧块就无法原地修正;
    // 存下原文才能在启动时按新规则重切,用户不必手动重传文档。
    this.version(5).stores({
      kbDocs: "docId, splitterVersion",
    });

    // v0.16 使用统计:本地计数器(检索/未命中、面板打开、按类别填充、逐条用量)。
    // 它不参与检索,故是本文件里唯一一类**不**失效检索缓存的写路径(见 bumpMetrics)。
    this.version(6).stores({
      metrics: "key",
    });

    // 待沉淀清单页在 v0.16 开发期做过又撤掉了(判据用的字面哈希、与检索的语义口径对不上,
    // 满屏"其实答得出来"的问题)。这里显式删表:已经跑过 v6 的库里表还在,
    // 留着就是一张谁都读不到的孤儿表。Dexie 删表就是把值置 null。
    this.version(7).stores({
      backlogIgnores: null,
    });
  }

  // ─── 初始化/预置 ──────────────────────────────────────────────────────────────

  /**
   * 确保预置"默认文件夹"存在(固定 id,导入/编辑幂等)。
   * 所有新提升的金标准默认入此夹。
   * 第十八轮改名迁移:旧版本预置名「未分类」→「默认文件夹」(该夹 UI 禁止改名,
   * 旧名只可能来自旧版本预置,按固定 id 幂等覆盖安全)。
   */
  async ensurePresetFolders(): Promise<void> {
    const existing = await this.folders.get(UNCATEGORIZED_FOLDER_ID);
    if (!existing) {
      await this.folders.add({
        id: UNCATEGORIZED_FOLDER_ID,
        parentId: null,
        name: UNCATEGORIZED_FOLDER_NAME,
        position: 0,
        createdAt: Date.now(),
      });
      return;
    }
    if (existing.name !== UNCATEGORIZED_FOLDER_NAME) {
      await this.folders.update(UNCATEGORIZED_FOLDER_ID, { name: UNCATEGORIZED_FOLDER_NAME });
    }
  }

  /** 启动时尝试清除旧项目遗留的空库(可选清理,失败静默) */
  async dropLegacyDbIfExists(dbName: string): Promise<boolean> {
    try {
      const names = await Dexie.getDatabaseNames();
      if (names.includes(dbName)) {
        await Dexie.delete(dbName);
        return true;
      }
    } catch {
      /* 静默:库被占用等情况留待用户手动处理 */
    }
    return false;
  }

  // ─── 错误日志 ────────────────────────────────────────────────────────────────

  async logError(message: string, context?: Record<string, unknown>): Promise<void> {
    try {
      await this.errors.add({ timestamp: Date.now(), message, context });
    } catch {
      // 错误日志永不抛错
      console.warn("[PDD CS] Failed to log error:", message);
    }
  }

  async getRecentErrors(limit = 20): Promise<ErrorLog[]> {
    return this.errors.orderBy("timestamp").reverse().limit(limit).toArray();
  }

  // ─── 统计(P0 面板用;排除自检示例数据) ───────────────────────────────────────

  async getStats(): Promise<{
    qaCount: number;
    replyCount: number;
    goldenCount: number;
    folderCount: number;
    knowledgeCount: number;
  }> {
    const selfTestQaCount = await this.qaRecords
      .where("sessionKey")
      .equals(SELF_TEST_SESSION_KEY)
      .count();
    const [qaTotal, replyCount, goldenCount, folderCount, knowledgeCount] =
      await Promise.all([
        this.qaRecords.count(),
        this.replies.count(),
        this.goldens.count(),
        this.folders.count(),
        this.knowledge.count(),
      ]);
    return {
      qaCount: qaTotal - selfTestQaCount,
      replyCount,
      goldenCount,
      folderCount,
      knowledgeCount,
    };
  }

  // ─── 问答记录(qaRecords) ──────────────────────────────────────────────────────

  async addQaRecord(record: QaRecord): Promise<string> {
    await this.qaRecords.add(record);
    return record.id;
  }

  /** 平台 msg_id 查问答(SW 重启后 content 重放防御;msgId 为库级幂等锚) */
  async findQaByMsgId(msgId: string): Promise<QaRecord | undefined> {
    return this.qaRecords.where("msgId").equals(msgId).first();
  }

  /** 会话内按问题哈希查最近一条问答记录(幂等/追加判断用) */
  async findLatestQaByHash(sessionKey: string, questionHash: string): Promise<QaRecord | undefined> {
    const hits = await this.qaRecords
      .where("[sessionKey+questionTs]")
      .between([sessionKey, Dexie.minKey], [sessionKey, Dexie.maxKey])
      .filter((r) => r.questionHash === questionHash)
      .toArray();
    if (hits.length === 0) return undefined;
    hits.sort((a, b) => b.questionTs - a.questionTs);
    return hits[0];
  }

  async getQaRecord(id: string): Promise<QaRecord | undefined> {
    return this.qaRecords.get(id);
  }

  /**
   * 最近问答分页(面板记忆列表;PM2:按 questionTs 倒序显式翻页)。
   * total 为排除自检数据后的全量数,与头部统计同口径;hasMore 由调用方按
   * offset + rows.length < total 推得。
   */
  async listQaRecordsPage(
    offset: number,
    limit: number,
  ): Promise<{ rows: QaRecord[]; total: number }> {
    const base = this.qaRecords
      .where("questionTs")
      .between(Dexie.minKey, Dexie.maxKey)
      .reverse()
      .filter((r) => r.sessionKey !== SELF_TEST_SESSION_KEY);
    const [rows, total] = await Promise.all([
      base.clone().offset(offset).limit(limit).toArray(),
      base.count(),
    ]);
    return { rows, total };
  }

  /** 会话内最近一条问答(分段机:客服回复在无未结问题段时挂到它下面) */
  async latestQaOfSession(sessionKey: string): Promise<QaRecord | undefined> {
    const rows = await this.qaRecords
      .where("[sessionKey+questionTs]")
      .between([sessionKey, Dexie.minKey], [sessionKey, Dexie.maxKey])
      .sortBy("questionTs");
    return rows.length > 0 ? rows[rows.length - 1] : undefined;
  }

  /** 整条删除:问答记录 + 其下全部回复(记忆列表"删除单条"用) */
  async deleteQaWithReplies(qaId: string): Promise<void> {
    await this.transaction("rw", this.qaRecords, this.replies, async () => {
      await this.replies.where("qaId").equals(qaId).delete();
      await this.qaRecords.delete(qaId);
    });
    invalidateRetrievalCache();
  }

  /** 清空自检示例数据;返回删除的问答条数 */
  async clearSelfTestRecords(): Promise<number> {
    const qaIds = await this.qaRecords
      .where("sessionKey")
      .equals(SELF_TEST_SESSION_KEY)
      .primaryKeys();
    if (qaIds.length === 0) return 0;
    await this.transaction("rw", this.qaRecords, this.replies, async () => {
      await this.replies.where("qaId").anyOf(qaIds).delete();
      await this.qaRecords.bulkDelete(qaIds);
    });
    invalidateRetrievalCache();
    return qaIds.length;
  }

  /**
   * 清空全部问答记忆(PM6a 设置页"清空问答数据";含自检数据)。
   * 金标准/知识库/文件夹为长期资产,不受影响。返回删除的问答条数。
   */
  async clearQaMemory(): Promise<number> {
    const total = await this.qaRecords.count();
    await this.transaction("rw", this.qaRecords, this.replies, async () => {
      await this.replies.clear();
      await this.qaRecords.clear();
    });
    invalidateRetrievalCache();
    return total;
  }

  // ─── 客服回复(replies) ────────────────────────────────────────────────────────

  async addReply(record: ReplyRecord): Promise<string> {
    await this.replies.add(record);
    return record.id;
  }

  /** 平台 msg_id 幂等查重(v4 起走 msgId 索引) */
  async findReplyByMsgId(msgId: string): Promise<ReplyRecord | undefined> {
    return this.replies.where("msgId").equals(msgId).first();
  }

  /** 同内容折叠:某问答下已存在同一归一化文本的回复 */
  async hasReplyContent(qaId: string, contentHash: string): Promise<boolean> {
    const count = await this.replies
      .where("qaId")
      .equals(qaId)
      .filter((r) => r.contentHash === contentHash)
      .count();
    return count > 0;
  }

  async getRepliesForQa(qaId: string): Promise<ReplyRecord[]> {
    return this.replies.where("qaId").equals(qaId).sortBy("ts");
  }

  async recountReplyCount(qaId: string): Promise<void> {
    const count = await this.replies.where("qaId").equals(qaId).count();
    await this.qaRecords.update(qaId, {
      replyCount: count,
      updatedAt: Date.now(),
    });
  }

  // ─── 嵌入回填(qaRecords 问题向量 / goldens 问题锚向量) ─────────────────────────

  async updateQaEmbedding(
    id: string,
    embedding: Float32Array,
    model: string,
    version: string,
  ): Promise<void> {
    await this.qaRecords.update(id, {
      embedding,
      embeddingModel: model,
      embeddingVersion: version,
      hasEmbedding: 1,
      updatedAt: Date.now(),
    });
    invalidateRetrievalCache();
  }

  async updateGoldenEmbedding(
    id: string,
    embedding: Float32Array,
    model: string,
    version: string,
  ): Promise<void> {
    // 不 touch updatedAt:它是"最近设置/编辑时间",面板"最近设置靠前"按它排;
    // 回填完成顺序在慢机器上随机,touch 会打乱口径(第三十一轮 CI flake 根因)
    await this.goldens.update(id, {
      qEmbedding: embedding,
      embeddingModel: model,
      embeddingVersion: version,
      hasEmbedding: 1,
    });
    invalidateRetrievalCache();
  }

  async updateKnowledgeEmbedding(
    id: string,
    embedding: Float32Array,
    model: string,
    version: string,
  ): Promise<void> {
    // 同 updateGoldenEmbedding:listKnowledge 按 updatedAt 倒序,回填不得 touch
    await this.knowledge.update(id, {
      qEmbedding: embedding,
      embeddingModel: model,
      embeddingVersion: version,
      hasEmbedding: 1,
    });
    invalidateRetrievalCache();
  }

  async markEmbeddingFailed(
    kind: "qa" | "golden" | "knowledge",
    id: string,
  ): Promise<void> {
    const table =
      kind === "qa" ? this.qaRecords : kind === "golden" ? this.goldens : this.knowledge;
    await table.update(id, { hasEmbedding: -1 });
  }

  /**
   * 待嵌问答(启动扫描/批量补嵌)。
   * 含 hasEmbedding=-1 的失败记录(2026-09-15 修复:旧查询只取 =0,
   * 与"失败下次启动扫描重试"的注释承诺相矛盾,失败记录被永久丢弃);
   * excludeIds 用于在**同一次**补嵌运行内排除刚失败者,防止查到又失败造成死循环。
   */
  async getPendingQaEmbeddings(
    limit = 100,
    excludeIds: ReadonlySet<string> = new Set(),
  ): Promise<QaRecord[]> {
    return this.qaRecords
      .where("hasEmbedding")
      .anyOf([0, -1])
      .filter((r) => !excludeIds.has(r.id))
      .limit(limit)
      .toArray();
  }

  /** 待嵌金标准(含 -1 重试,口径同上) */
  async getPendingGoldenEmbeddings(
    limit = 100,
    excludeIds: ReadonlySet<string> = new Set(),
  ): Promise<GoldenRecord[]> {
    return this.goldens
      .where("hasEmbedding")
      .anyOf([0, -1])
      .filter((r) => !excludeIds.has(r.id))
      .limit(limit)
      .toArray();
  }

  /** 待嵌知识库条目(含 -1 重试,口径同上) */
  async getPendingKnowledgeEmbeddings(
    limit = 100,
    excludeIds: ReadonlySet<string> = new Set(),
  ): Promise<KnowledgeRecord[]> {
    return this.knowledge
      .where("hasEmbedding")
      .anyOf([0, -1])
      .filter((r) => !excludeIds.has(r.id))
      .limit(limit)
      .toArray();
  }

  /** 已嵌问答记录(检索源 B;TTL 保证都在保留期内) */
  async getEmbeddedQaRecords(): Promise<QaRecord[]> {
    return this.qaRecords.where("hasEmbedding").equals(1).toArray();
  }

  /** 已嵌金标准(检索源 A) */
  async getEmbeddedGoldens(): Promise<GoldenRecord[]> {
    return this.goldens.where("hasEmbedding").equals(1).toArray();
  }

  /** 已嵌且启用中的知识库条目(检索源 C;停用条目不参与检索) */
  async getEmbeddedKnowledge(): Promise<KnowledgeRecord[]> {
    return this.knowledge
      .where("hasEmbedding")
      .equals(1)
      .filter((k) => k.enabled === 1)
      .toArray();
  }

  /** 批量取回复(检索候选展开) */
  async getRepliesByQaIds(qaIds: string[]): Promise<ReplyRecord[]> {
    if (qaIds.length === 0) return [];
    return this.replies.where("qaId").anyOf(qaIds).toArray();
  }

  // ─── 金标准(goldens) ──────────────────────────────────────────────────────────

  async addGolden(record: GoldenRecord): Promise<string> {
    await this.goldens.add(record);
    return record.id;
  }

  async getGolden(id: string): Promise<GoldenRecord | undefined> {
    return this.goldens.get(id);
  }

  /** 按问题哈希查重(导入/提升幂等) */
  async findGoldenByQuestionHash(questionHash: string): Promise<GoldenRecord | undefined> {
    return this.goldens.where("questionHash").equals(questionHash).first();
  }

  /**
   * 同一问题的全部标准回答 —— 一个问题可挂多条(上限见 goldens.ts)。
   * 按 createdAt 倒序返回:最近设置的靠前(候选排序与面板展示共用该口径)。
   */
  async getGoldensByQuestionHash(questionHash: string): Promise<GoldenRecord[]> {
    const list = await this.goldens.where("questionHash").equals(questionHash).toArray();
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  async updateGolden(id: string, patch: Partial<GoldenRecord>): Promise<void> {
    await this.goldens.update(id, { ...patch, updatedAt: Date.now() });
    // 问题实质编辑会作废旧向量待重嵌,缓存里的旧锚必须立即失效(与 updateKnowledge 同契约)
    invalidateRetrievalCache();
  }

  async deleteGolden(id: string): Promise<void> {
    await this.transaction("rw", this.goldens, this.metrics, async () => {
      await this.goldens.delete(id);
      // 逐条用量键跟着条目走:留着就是查不到主人的孤儿计数
      await this.dropItemMetrics("golden", [id]);
    });
    invalidateRetrievalCache();
  }

  // ─── 知识库(knowledge) ────────────────────────────────────────────────────────

  async addKnowledge(record: KnowledgeRecord): Promise<string> {
    await this.knowledge.add(record);
    return record.id;
  }

  async getKnowledge(id: string): Promise<KnowledgeRecord | undefined> {
    return this.knowledge.get(id);
  }

  /** 按归一化标题哈希查重(创建/导入幂等) */
  async findKnowledgeByTitleHash(questionHash: string): Promise<KnowledgeRecord | undefined> {
    return this.knowledge.where("questionHash").equals(questionHash).first();
  }

  async listKnowledge(limit = 200): Promise<KnowledgeRecord[]> {
    return this.knowledge
      .toArray()
      .then((rows) => rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit));
  }

  async updateKnowledge(id: string, patch: Partial<KnowledgeRecord>): Promise<void> {
    await this.knowledge.update(id, { ...patch, updatedAt: Date.now() });
    // enabled 开关改变"已嵌且启用"集合,必须失效(工程5b)
    invalidateRetrievalCache();
  }

  async deleteKnowledge(id: string): Promise<void> {
    await this.transaction("rw", this.knowledge, this.metrics, async () => {
      await this.knowledge.delete(id);
      await this.dropItemMetrics("knowledge", [id]);
    });
    invalidateRetrievalCache();
  }

  /** 某文档的全部块(整篇替换/展示计数) */
  async listKnowledgeByDoc(docId: string): Promise<KnowledgeRecord[]> {
    return this.knowledge.where("docId").equals(docId).toArray();
  }

  /** 整篇删除文档块;返回删除的块数 */
  async deleteKnowledgeByDoc(docId: string): Promise<number> {
    const ids = await this.knowledge.where("docId").equals(docId).primaryKeys();
    if (ids.length === 0) return 0;
    await this.transaction("rw", this.knowledge, this.metrics, async () => {
      await this.knowledge.bulkDelete(ids);
      await this.dropItemMetrics("knowledge", ids);
    });
    invalidateRetrievalCache();
    return ids.length;
  }

  // ─── 知识库文档原文(kbDocs) ────────────────────────────────────────────────────

  async putKbDoc(record: KbDocRecord): Promise<void> {
    await this.kbDocs.put(record);
  }

  async getKbDoc(docId: string): Promise<KbDocRecord | undefined> {
    return this.kbDocs.get(docId);
  }

  async deleteKbDoc(docId: string): Promise<void> {
    await this.kbDocs.delete(docId);
  }

  /** 分块器版本失配的文档(SW 启动时按新规则重切) */
  async getStaleKbDocs(version: string): Promise<KbDocRecord[]> {
    return this.kbDocs.filter((d) => d.splitterVersion !== version).toArray();
  }

  /**
   * 升级前上传的文档:knowledge 里有块,但 kbDocs 里没有原文。
   *
   * 自动重切够不着它们(kbDocs 是本轮新增的表,存量文档没有行),而它们的块
   * 恰恰是旧规则切的 —— 整篇一块,向量被多主题平均稀释,检索会**静默**命中
   * 不到。查出来是为了在知识库页提示重新上传,而不是假装无事发生。
   *
   * 只取索引里的 docId(不把整张表的正文与向量读进内存);手工条目没有 docId,
   * 不在 docId 索引里,自然不参与。
   */
  async getLegacyDocIds(): Promise<string[]> {
    const [docIds, known] = await Promise.all([
      this.knowledge.orderBy("docId").uniqueKeys(),
      this.kbDocs.toCollection().primaryKeys(),
    ]);
    const have = new Set(known.map(String));
    return docIds.map(String).filter((id) => !have.has(id));
  }

  // ─── 使用统计(metrics,v0.16) ──────────────────────────────────────────────────

  /**
   * 计数器自增(键不存在则建)。**即发即忘调用** —— 统计不该给检索加延迟。
   *
   * 刻意**不调用 invalidateRetrievalCache()**:全库唯一一类不改变"已嵌三源"集合的
   * 写路径。若跟着失效,每次检索都会清掉 SW 内存里的锚点缓存,下次检索得重读全表 ——
   * 埋点反过来把检索拖慢,这笔账不划算。
   *
   * 读改写包在事务里(IndexedDB 同表事务串行),并发自增不会互相覆盖;
   * 失败静默:统计丢几个数不致命,但绝不能把调用方(检索/填充)带崩。
   */
  async bumpMetrics(keys: readonly string[], delta = 1): Promise<void> {
    if (keys.length === 0) return;
    try {
      const now = Date.now();
      await this.transaction("rw", this.metrics, async () => {
        for (const key of keys) {
          const cur = await this.metrics.get(key);
          await this.metrics.put({
            key,
            count: (cur?.count ?? 0) + delta,
            updatedAt: now,
          });
        }
      });
    } catch (err) {
      console.warn("[PDD CS] bumpMetrics failed:", keys, err);
    }
  }

  async bumpMetric(key: string, delta = 1): Promise<void> {
    await this.bumpMetrics([key], delta);
  }

  /** 全部计数器(设置页展示 + 逐条用量映射);按主键升序,读侧自行分组 */
  async listMetrics(): Promise<MetricRecord[]> {
    return this.metrics.toArray();
  }

  /** 逐条用量映射:`条目id → 次数`(面板/知识库页展示"被用 N 次") */
  async listItemUsage(): Promise<Record<string, number>> {
    const rows = await this.metrics.toArray();
    const out: Record<string, number> = {};
    for (const r of rows) {
      const golden = parseItemMetricKey(r.key, "golden");
      const kb = parseItemMetricKey(r.key, "knowledge");
      const id = golden ?? kb;
      if (id && r.count > 0) out[id] = r.count;
    }
    return out;
  }

  /** 重置全部统计(设置页"清空统计";不动任何业务数据) */
  async clearMetrics(): Promise<number> {
    const total = await this.metrics.count();
    await this.metrics.clear();
    return total;
  }

  /** 条目删除时一并清掉它的用量键(避免库里攒孤儿计数器) */
  private async dropItemMetrics(kind: "golden" | "knowledge", ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.metrics.bulkDelete(ids.map((id) => itemMetricKey(kind, id)));
  }

  // ─── 回复文件夹(folders) ──────────────────────────────────────────────────────

  async listFolders(): Promise<FolderRecord[]> {
    return this.folders.toArray();
  }

  async addFolder(record: FolderRecord): Promise<string> {
    await this.folders.add(record);
    return record.id;
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await this.folders.update(id, { name });
  }

  async deleteFolder(id: string): Promise<void> {
    await this.transaction("rw", this.folders, this.goldens, async () => {
      await this.goldens.where("folderId").equals(id).modify({ folderId: null });
      await this.folders.delete(id);
    });
  }

  /**
   * 遗留子文件夹一键拍平(PM7;UI 已只建一级文件夹,存量子夹给出清入口):
   * 子夹内金标准上移到父根夹(父夹失联则归「默认文件夹」),随后删除子夹。返回拍平数。
   * folderId 不参与检索缓存,无需失效。
   */
  async flattenSubfolders(): Promise<number> {
    const all = await this.folders.toArray();
    const known = new Set(all.map((f) => f.id));
    const subs = all.filter((f) => f.parentId !== null);
    if (subs.length === 0) return 0;
    await this.transaction("rw", this.folders, this.goldens, async () => {
      for (const sub of subs) {
        const target = sub.parentId !== null && known.has(sub.parentId) ? sub.parentId : null;
        await this.goldens.where("folderId").equals(sub.id).modify({ folderId: target });
        await this.folders.delete(sub.id);
      }
    });
    return subs.length;
  }

  // ─── 保留期清理(TTL) ───────────────────────────────────────────────────────────

  /**
   * 删除 questionTs 早于 now−retentionDays 的问答记录及其回复。
   * 金标准/文件夹独立于问答记录,不受影响。
   * 返回删除的问答记录条数。
   */
  async purgeExpired(now: number, retentionDays: number): Promise<number> {
    const cutoff = now - retentionDays * 86_400_000;
    const expiredIds = await this.qaRecords
      .where("questionTs")
      .below(cutoff)
      .primaryKeys();
    if (expiredIds.length === 0) return 0;

    await this.transaction("rw", this.qaRecords, this.replies, async () => {
      await this.replies.where("qaId").anyOf(expiredIds).delete();
      await this.qaRecords.bulkDelete(expiredIds);
    });
    invalidateRetrievalCache();
    return expiredIds.length;
  }
}

// 单例 —— 全 SW 共享
export const db = new PddDatabase();

// 开发态挂到 globalThis 便于 SW 控制台自检(与原项目习惯一致)
if (process.env.NODE_ENV === "development") {
  (globalThis as unknown as { pddDb?: PddDatabase }).pddDb = db;
}
