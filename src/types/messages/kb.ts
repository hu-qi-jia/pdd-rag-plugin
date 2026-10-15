// ─── 知识库消息(popup → SW,P4-KB):话术卡 CRUD 与 md 文档上传 ───────────────
// 幂等:标题归一化 hash 已存在则不重复建,返回 exists;
// 标题实质变更才重嵌;enabled 停用切换不重嵌。

export interface CreateKbRequest {
  type: 'CREATE_KB'
  payload: { title: string; content: string }
}

export interface CreateKbResponse {
  type: 'CREATE_KB_RESPONSE'
  payload: { id?: string; exists?: boolean; error?: string }
}

export interface UpdateKbRequest {
  type: 'UPDATE_KB'
  payload: { id: string; title?: string; content?: string; enabled?: number }
}

export interface UpdateKbResponse {
  type: 'UPDATE_KB_RESPONSE'
  payload: { id?: string; reembed?: boolean; error?: string }
}

export interface DeleteKbRequest {
  type: 'DELETE_KB'
  payload: { id: string }
}

export interface DeleteKbResponse {
  type: 'DELETE_KB_RESPONSE'
  payload: { success: boolean; error?: string }
}

// ─── md 文档上传 ──────────────────────────────────────────────────────────────
// md 文本按原项目 chunkText(500 字/75 重叠)分块,每块一条知识条目,
// 锚向量=块正文;同名文档(docId)重复上传整篇替换。

export interface UploadKbDocRequest {
  type: 'UPLOAD_KB_DOC'
  payload: { name: string; content: string }
}

export interface UploadKbDocResponse {
  type: 'UPLOAD_KB_DOC_RESPONSE'
  payload: { docId?: string; chunkCount?: number; replaced?: boolean; error?: string }
}

// ─── 尺码表标记(第五十八轮)─────────────────────────────────────────────────────
//
// 文档级标记,落在 kbDocs.isSizeTable(不随块存 —— 那是会漂移的冗余)。
// 标记后该文档不做向量检索,整篇原文作为尺码生成的 LLM 材料(见 spec §八)。

export interface SetKbSizeTableRequest {
  type: 'SET_KB_SIZE_TABLE'
  payload: { docId: string; on: boolean }
}

export interface SetKbSizeTableResponse {
  type: 'SET_KB_SIZE_TABLE_RESPONSE'
  payload: {
    success: boolean
    error?: string
    /** 标记新尺码表时被顶替掉的旧尺码表 docId(v3.0:同一时刻只有一份) */
    replaced?: string
  }
}
