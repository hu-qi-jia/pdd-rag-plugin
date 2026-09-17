// 设置读写(chrome.storage.local) —— 默认值见 shared/constants.ts DEFAULT_SETTINGS
// 读取时与默认值合并并夹取合法区间,防止旧值/脏数据污染行为。

import {
  DEFAULT_HOTKEY,
  DEFAULT_PANEL_NAV_HOTKEY,
  DEFAULT_SETTINGS,
  LLM_TIMEOUT_MAX_MS,
  LLM_TIMEOUT_MIN_MS,
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
  return {
    directFillEnabled: !!base.directFillEnabled,
    simThreshold: Math.min(1, Math.max(0, Number(base.simThreshold) || DEFAULT_SETTINGS.simThreshold)),
    goldenThreshold: Math.min(1, Math.max(0, Number(base.goldenThreshold) || DEFAULT_SETTINGS.goldenThreshold)),
    kbThreshold: Math.min(1, Math.max(0, Number(base.kbThreshold) || DEFAULT_SETTINGS.kbThreshold)),
    retentionDays: Math.min(365, Math.max(30, Math.round(Number(base.retentionDays) || DEFAULT_SETTINGS.retentionDays))),
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
