// 设置读写(chrome.storage.local) —— 默认值见 shared/constants.ts DEFAULT_SETTINGS
// 读取时与默认值合并并夹取合法区间,防止旧值/脏数据污染行为。

import {
  DEFAULT_HOTKEY,
  DEFAULT_PANEL_NAV_HOTKEY,
  DEFAULT_SETTINGS,
  JEV_TIMEOUT_MAX_MS,
  JEV_TIMEOUT_MIN_MS,
  LLM_TIMEOUT_MAX_MS,
  LLM_TIMEOUT_MIN_MS,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
  SETTINGS_STORAGE_KEY,
} from '../shared/constants';
import type { HotkeyConfig, PddSettings } from '../types/memory';

/**
 * URL 夹取:只接受 http(s) 绝对地址,其余(空串/相对路径/javascript: 等)归一为 ''。
 * 空串语义 = 未配置,面板据此不渲染 AI 整合行。
 */
function clampUrl(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s.replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

/** 纯文本字段夹取(模型名等):非字符串归一为空串,并限长防脏数据 */
function clampText(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}

/** 快捷键夹取:主键必须是非空短字符串,修饰键只认布尔 */
function clampHotkey(raw: unknown, fallbackKey: string = DEFAULT_HOTKEY.key): HotkeyConfig {
  const base = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<HotkeyConfig>;
  const key =
    typeof base.key === "string" && base.key.trim().length > 0
      ? base.key.trim().slice(0, 32)
      : fallbackKey;
  return { ctrl: !!base.ctrl, alt: !!base.alt, shift: !!base.shift, key };
}
import { loadFromChrome, saveToChrome } from "../shared/chrome-storage";

function clampSettings(raw: Partial<PddSettings>): PddSettings {
  const base = { ...DEFAULT_SETTINGS, ...raw };
  // 阈值非有限数才回退默认(0 是合法值:"全部计入",不能与脏值一样退成默认)
  const probRaw = Number(base.classifyProbThreshold);
  const probThreshold = Number.isFinite(probRaw)
    ? probRaw
    : DEFAULT_SETTINGS.classifyProbThreshold;
  return {
    directFillEnabled: !!base.directFillEnabled,
    simThreshold: Math.min(1, Math.max(0, Number(base.simThreshold) || DEFAULT_SETTINGS.simThreshold)),
    goldenThreshold: Math.min(1, Math.max(0, Number(base.goldenThreshold) || DEFAULT_SETTINGS.goldenThreshold)),
    kbThreshold: Math.min(1, Math.max(0, Number(base.kbThreshold) || DEFAULT_SETTINGS.kbThreshold)),
    retentionDays: Math.min(
      RETENTION_MAX_DAYS,
      Math.max(
        RETENTION_MIN_DAYS,
        Math.round(Number(base.retentionDays) || DEFAULT_SETTINGS.retentionDays),
      ),
    ),
    goldenPriorityEnabled: !!base.goldenPriorityEnabled,
    autoReplyHotkey: clampHotkey(base.autoReplyHotkey),
    panelNavHotkey: clampHotkey(base.panelNavHotkey, DEFAULT_PANEL_NAV_HOTKEY.key),
    aiIntegrateEnabled: !!base.aiIntegrateEnabled,
    llmBaseUrl: clampUrl(base.llmBaseUrl),
    llmApiKey: clampText(base.llmApiKey, 512),
    llmModel: clampText(base.llmModel, 128),
    llmTimeoutMs: Math.min(
      LLM_TIMEOUT_MAX_MS,
      Math.max(LLM_TIMEOUT_MIN_MS, Math.round(Number(base.llmTimeoutMs) || DEFAULT_SETTINGS.llmTimeoutMs)),
    ),
    classifyEnabled: !!base.classifyEnabled,
    jevBaseUrl: clampUrl(base.jevBaseUrl),
    jevApiKey: clampText(base.jevApiKey, 512),
    jevModel: clampText(base.jevModel, 128),
    jevTimeoutMs: Math.min(
      JEV_TIMEOUT_MAX_MS,
      Math.max(JEV_TIMEOUT_MIN_MS, Math.round(Number(base.jevTimeoutMs) || DEFAULT_SETTINGS.jevTimeoutMs)),
    ),
    classifyProbThreshold: Math.min(1, Math.max(0, probThreshold)),
  };
}

function isValidPartial(v: unknown): v is Partial<PddSettings> {
  return typeof v === "object" && v !== null;
}

export async function loadSettings(): Promise<PddSettings> {
  const stored = await loadFromChrome<Partial<PddSettings>>(
    SETTINGS_STORAGE_KEY,
    isValidPartial,
  );
  return clampSettings(stored ?? {});
}

export async function saveSettings(patch: Partial<PddSettings>): Promise<void> {
  const merged = clampSettings({ ...(await loadSettings()), ...patch });
  await saveToChrome(SETTINGS_STORAGE_KEY, merged);
  return Promise.resolve();
}
