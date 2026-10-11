// ─── 运行时消息集 · 聚合出口 ──────────────────────────────────────────────────
// 按域拆分(2026-09-16 工程审查③-V8):system 诊断 / capture 捕获 / retrieval 检索 /
// panel 面板 / kb 知识库 / settings 设置 / transfer 导入导出 / fill 填充 / metrics 统计。
// 目录 index 出口 —— 现有 `types/messages` 导入路径不变;
// ExtensionMessage 恰为 33 个请求类型,响应用 `${K}_RESPONSE` 命名约定。

export * from './system'
export * from './capture'
export * from './retrieval'
export * from './panel'
export * from './kb'
export * from './settings'
export * from './transfer'
export * from './fill'
export * from './metrics'
// 问题自动分类(补存量):GET/START/STOP_BACKFILL 三对消息
export * from './classify'
// ai 走 Port 长连接(流式),不进 ExtensionMessage 并集 —— 单独出口
export * from './ai'

// ─── 并集 ──────────────────────────────────────────────────────────────────────

import type {
  PingEmbedRequest,
  GetStatsRequest,
  SelfTestWriteRequest,
} from './system'
import type { PddIngestRequest } from './capture'
import type { GetSuggestionsRequest, AddGoldenRequest } from './retrieval'
import type {
  GetMemoryListRequest,
  DeleteQaRequest,
  ClearMemoryDataRequest,
  GetPanelDataRequest,
  UpdateGoldenRequest,
  UpdateGoldenCategoryRequest,
  DeleteGoldenRequest,
  CreateFolderRequest,
  RenameFolderRequest,
  DeleteFolderRequest,
  FlattenFoldersRequest,
  CreateCategoryRequest,
  RenameCategoryRequest,
  DeleteCategoryRequest,
} from './panel'
import type { CreateKbRequest, UpdateKbRequest, DeleteKbRequest, UploadKbDocRequest } from './kb'
import type { UpdateSettingsRequest, TestLlmRequest, TestJevRequest } from './settings'
import type { ExportDataRequest, ImportDataRequest } from './transfer'
import type { FillInputRequest } from './fill'
import type { TrackEventRequest, ClearMetricsRequest } from './metrics'
import type {
  GetBackfillStateRequest,
  StartBackfillRequest,
  StopBackfillRequest,
} from './classify'

export type ExtensionMessage =
  | PingEmbedRequest
  | GetStatsRequest
  | SelfTestWriteRequest
  | PddIngestRequest
  | GetSuggestionsRequest
  | AddGoldenRequest
  | GetMemoryListRequest
  | DeleteQaRequest
  | ClearMemoryDataRequest
  | GetPanelDataRequest
  | UpdateGoldenRequest
  | UpdateGoldenCategoryRequest
  | DeleteGoldenRequest
  | CreateFolderRequest
  | RenameFolderRequest
  | DeleteFolderRequest
  | FlattenFoldersRequest
  | CreateCategoryRequest
  | RenameCategoryRequest
  | DeleteCategoryRequest
  | CreateKbRequest
  | UpdateKbRequest
  | DeleteKbRequest
  | UploadKbDocRequest
  | UpdateSettingsRequest
  | TestLlmRequest
  | TestJevRequest
  | ExportDataRequest
  | ImportDataRequest
  | FillInputRequest
  | TrackEventRequest
  | ClearMetricsRequest
  | GetBackfillStateRequest
  | StartBackfillRequest
  | StopBackfillRequest

import type {
  PingEmbedResponse,
  GetStatsResponse,
  SelfTestWriteResponse,
} from './system'
import type { PddIngestResponse } from './capture'
import type { GetSuggestionsResponse, AddGoldenResponse } from './retrieval'
import type {
  GetMemoryListResponse,
  DeleteQaResponse,
  ClearMemoryDataResponse,
  GetPanelDataResponse,
  UpdateGoldenResponse,
  UpdateGoldenCategoryResponse,
  DeleteGoldenResponse,
  CreateFolderResponse,
  RenameFolderResponse,
  DeleteFolderResponse,
  FlattenFoldersResponse,
  CreateCategoryResponse,
  RenameCategoryResponse,
  DeleteCategoryResponse,
} from './panel'
import type {
  CreateKbResponse,
  UpdateKbResponse,
  DeleteKbResponse,
  UploadKbDocResponse,
} from './kb'
import type { UpdateSettingsResponse, TestLlmResponse, TestJevResponse } from './settings'
import type { ExportDataResponse, ImportDataResponse } from './transfer'
import type { FillInputResponse } from './fill'
import type { TrackEventResponse, ClearMetricsResponse } from './metrics'
import type {
  GetBackfillStateResponse,
  StartBackfillResponse,
  StopBackfillResponse,
} from './classify'

export type ExtensionMessageResponse =
  | PingEmbedResponse
  | GetStatsResponse
  | SelfTestWriteResponse
  | PddIngestResponse
  | GetSuggestionsResponse
  | AddGoldenResponse
  | GetMemoryListResponse
  | DeleteQaResponse
  | ClearMemoryDataResponse
  | GetPanelDataResponse
  | UpdateGoldenResponse
  | UpdateGoldenCategoryResponse
  | DeleteGoldenResponse
  | CreateFolderResponse
  | RenameFolderResponse
  | DeleteFolderResponse
  | FlattenFoldersResponse
  | CreateCategoryResponse
  | RenameCategoryResponse
  | DeleteCategoryResponse
  | CreateKbResponse
  | UpdateKbResponse
  | DeleteKbResponse
  | UploadKbDocResponse
  | UpdateSettingsResponse
  | TestLlmResponse
  | TestJevResponse
  | ExportDataResponse
  | ImportDataResponse
  | FillInputResponse
  | TrackEventResponse
  | ClearMetricsResponse
  | GetBackfillStateResponse
  | StartBackfillResponse
  | StopBackfillResponse
