import React from 'react';

import {CHAT_FONT_OPTIONS, isChatFontId, type ChatFontId} from '../chat/chatTypography';
import {normalizeAppDiagnosticLogLevel, type AppDiagnosticLogLevel} from '../debug/appDiagnostics';
import {SPEECH_MODEL_OPTIONS, normalizeSpeechSettings, type SpeechSettings} from '../features/speech/speechSettings';
import {TTS_MODEL_OPTIONS, TTS_VOICE_OPTIONS, normalizeTtsSettings, type TtsSettings, type TtsModelId, type TtsVoiceId} from '../features/tts/ttsSettings';
import {
  CODE_FONT_OPTIONS,
  CODE_THEME_OPTIONS,
  CODE_THEME_OPTION_GROUPS,
  isCodeFontId,
  isCodeThemeId,
  type CodeFontId,
  type CodeThemeId,
} from '../code/shikiSettings';
import type {SettingsChildDetail} from './settingsNavigation';

const CODE_FONT_SIZE_OPTIONS = [12, 13, 14, 15, 16] as const;
const CODE_LINE_HEIGHT_OPTIONS = [1.35, 1.45, 1.5, 1.6, 1.7] as const;
const CODE_TAB_SIZE_OPTIONS = [2, 4, 8] as const;

type ThemeMode = 'dark' | 'light';

type SettingsRootContentProps = {
  showSectionTitle: boolean;
  themeMode: ThemeMode;
  setThemeMode: (value: ThemeMode) => void;
  gestureNavigation: boolean;
  setGestureNavigation: (value: boolean) => void;
  isWide: boolean;
  floatingControlIdleOpacityPercent: number;
  setFloatingControlIdleOpacity: (value: number) => void;
  hideToolCalls: boolean;
  setHideToolCalls: (value: boolean) => void;
  promptCompletionNotificationsEnabled: boolean;
  setPromptCompletionNotificationsEnabled: (value: boolean) => void;
  handlePromptCompletionNotificationsChange: (enabled: boolean) => void;
  notificationPermissionState: string;
  speechSettings: SpeechSettings;
  setSpeechSettings: React.Dispatch<React.SetStateAction<SpeechSettings>>;
  ttsSettings: TtsSettings;
  setTtsSettings: React.Dispatch<React.SetStateAction<TtsSettings>>;
  chatFont: ChatFontId;
  setChatFont: (value: ChatFontId) => void;
  localHubReadEnabled: boolean;
  setLocalHubReadEnabled: (value: boolean) => void;
  openSettingsChild: (detail: SettingsChildDetail) => void;
  codeTheme: CodeThemeId;
  setCodeTheme: (value: CodeThemeId) => void;
  codeFont: CodeFontId;
  setCodeFont: (value: CodeFontId) => void;
  codeFontSize: number;
  setCodeFontSize: (value: number) => void;
  clampCodeFontSize: (value: number) => number;
  codeLineHeight: number;
  setCodeLineHeight: (value: number) => void;
  clampCodeLineHeight: (value: number) => number;
  codeTabSize: number;
  setCodeTabSize: (value: number) => void;
  clampCodeTabSize: (value: number) => number;
  messageViewerEnabled: boolean;
  setMessageViewerEnabled: (value: boolean) => void;
  logLevel: AppDiagnosticLogLevel;
  setLogLevel: (value: AppDiagnosticLogLevel) => void;
  disableFileCache: boolean;
  setDisableFileCache: (value: boolean) => void;
  requestClearLocalCache: () => void;
  handleRegistryDebugLogout: () => void;
};

function renderSettingsSection(title: string, rows: React.ReactNode, icon?: string) {
  return (
    <section className="settings-section" aria-label={title}>
      <div className="settings-section-title">
        {icon ? <span className={`codicon codicon-${icon}`} aria-hidden="true" /> : null}
        <span>{title}</span>
      </div>
      <div className="settings-section-rows">{rows}</div>
    </section>
  );
}

export function SettingsRootContent({
  showSectionTitle,
  themeMode,
  setThemeMode,
  gestureNavigation,
  setGestureNavigation,
  isWide,
  floatingControlIdleOpacityPercent,
  setFloatingControlIdleOpacity,
  hideToolCalls,
  setHideToolCalls,
  promptCompletionNotificationsEnabled,
  setPromptCompletionNotificationsEnabled,
  handlePromptCompletionNotificationsChange,
  notificationPermissionState,
  speechSettings,
  setSpeechSettings,
  ttsSettings,
  setTtsSettings,
  chatFont,
  setChatFont,
  localHubReadEnabled,
  setLocalHubReadEnabled,
  openSettingsChild,
  codeTheme,
  setCodeTheme,
  codeFont,
  setCodeFont,
  codeFontSize,
  setCodeFontSize,
  clampCodeFontSize,
  codeLineHeight,
  setCodeLineHeight,
  clampCodeLineHeight,
  codeTabSize,
  setCodeTabSize,
  clampCodeTabSize,
  messageViewerEnabled,
  setMessageViewerEnabled,
  logLevel,
  setLogLevel,
  disableFileCache,
  setDisableFileCache,
  requestClearLocalCache,
  handleRegistryDebugLogout,
}: SettingsRootContentProps) {
  return (
    <>
      {showSectionTitle ? <div className="section-title">SETTINGS</div> : null}
      <div className="settings-list">
        {renderSettingsSection('Appearance', (
        <>
          <label className="settings-row sidebar-setting-row">
            <span>
              <span className="codicon codicon-color-mode settings-row-icon" aria-hidden="true" />
              Dark Mode
            </span>
            <input
              type="checkbox"
              checked={themeMode === 'dark'}
              onChange={e =>
                setThemeMode(e.target.checked ? 'dark' : 'light')
              }
            />
          </label>
          <label className="settings-row sidebar-setting-row">
            <span>
              <span className="codicon codicon-move settings-row-icon" aria-hidden="true" />
              Gesture Navigation
            </span>
            <input
              type="checkbox"
              checked={gestureNavigation}
              onChange={e => setGestureNavigation(e.target.checked)}
            />
          </label>
          {!isWide ? (
            <label className="settings-row sidebar-setting-row settings-range-row">
              <span>
                <span className="codicon codicon-eye settings-row-icon" aria-hidden="true" />
                Inactive Visibility
              </span>
              <span className="settings-range-control">
                <input
                  type="range"
                  min={10}
                  max={80}
                  step={5}
                  value={floatingControlIdleOpacityPercent}
                  onChange={event => setFloatingControlIdleOpacity(Number(event.target.value) / 100)}
                  aria-label="Inactive visibility"
                />
                <span className="settings-range-value">{floatingControlIdleOpacityPercent}%</span>
              </span>
            </label>
          ) : null}
        </>
        ), 'paintcan')}
        {renderSettingsSection('Chat', (
        <>
        <label className="settings-row sidebar-setting-row">
          <span>
            <span className="codicon codicon-tools settings-row-icon" aria-hidden="true" />
            Hide Tool Calls
          </span>
          <input
            type="checkbox"
            checked={hideToolCalls}
            onChange={e => setHideToolCalls(e.target.checked)}
          />
        </label>
        <div className="voice-input-settings-menu">
          <label className="settings-row sidebar-setting-row">
            <span>
              <span className="codicon codicon-bell settings-row-icon" aria-hidden="true" />
              Notifications
            </span>
            <input
              type="checkbox"
              checked={promptCompletionNotificationsEnabled}
              onChange={event => {
                if (!event.target.checked) {
                  setPromptCompletionNotificationsEnabled(false);
                  return;
                }
                handlePromptCompletionNotificationsChange(true);
              }}
            />
          </label>
          {notificationPermissionState === 'denied' ? (
            <div className="voice-input-settings-nested">
              <div className="settings-metadata-line">Blocked by system permission</div>
            </div>
          ) : null}
        </div>
        <div className="voice-input-settings-menu">
          <label className="settings-row sidebar-setting-row">
            <span>
              <span className="codicon codicon-mic settings-row-icon" aria-hidden="true" />
              Voice Input
            </span>
            <input
              type="checkbox"
              checked={speechSettings.enabled}
              onChange={event => setSpeechSettings(current =>
                normalizeSpeechSettings({...current, enabled: event.target.checked}),
              )}
            />
          </label>
          {speechSettings.enabled ? (
            <div className="voice-input-settings-nested">
              <label className="settings-row sidebar-setting-row voice-input-settings-child-row">
                <span>
                  <span className="codicon codicon-key settings-row-icon" aria-hidden="true" />
                  API Key
                </span>
                <input
                  className="sidebar-setting-input"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={speechSettings.volcengineApiKey}
                  onChange={event => setSpeechSettings(current =>
                    normalizeSpeechSettings({...current, volcengineApiKey: event.target.value}),
                  )}
                />
              </label>
              <label className="settings-row sidebar-setting-row voice-input-settings-child-row">
                <span>
                  <span className="codicon codicon-symbol-misc settings-row-icon" aria-hidden="true" />
                  Model
                </span>
                <select
                  className="sidebar-setting-select"
                  title="Doubao Streaming ASR 2.0"
                  value={speechSettings.model}
                  onChange={event => setSpeechSettings(current =>
                    normalizeSpeechSettings({...current, model: event.target.value}),
                  )}
                >
                  {SPEECH_MODEL_OPTIONS.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
        <div className="voice-input-settings-menu">
          <label className="settings-row sidebar-setting-row">
            <span>
              <span className="codicon codicon-unmute settings-row-icon" aria-hidden="true" />
              Text-to-Speech
            </span>
            <input
              type="checkbox"
              checked={ttsSettings.enabled}
              onChange={event => setTtsSettings(current =>
                normalizeTtsSettings({...current, enabled: event.target.checked}),
              )}
            />
          </label>
          {ttsSettings.enabled ? (
            <div className="voice-input-settings-nested">
              <label className="settings-row sidebar-setting-row voice-input-settings-child-row">
                <span>
                  <span className="codicon codicon-key settings-row-icon" aria-hidden="true" />
                  API Key
                </span>
                <input
                  className="sidebar-setting-input"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={ttsSettings.apiKey}
                  onChange={event => setTtsSettings(current =>
                    normalizeTtsSettings({...current, apiKey: event.target.value}),
                  )}
                />
              </label>
              <label className="settings-row sidebar-setting-row voice-input-settings-child-row">
                <span>
                  <span className="codicon codicon-symbol-misc settings-row-icon" aria-hidden="true" />
                  Model
                </span>
                <select
                  className="sidebar-setting-select"
                  value={ttsSettings.model}
                  onChange={event => setTtsSettings(current =>
                    normalizeTtsSettings({...current, model: event.target.value as TtsModelId}),
                  )}
                >
                  {TTS_MODEL_OPTIONS.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="settings-row sidebar-setting-row voice-input-settings-child-row">
                <span>
                  <span className="codicon codicon-person settings-row-icon" aria-hidden="true" />
                  Voice
                </span>
                <select
                  className="sidebar-setting-select"
                  value={ttsSettings.voice}
                  onChange={event => setTtsSettings(current =>
                    normalizeTtsSettings({...current, voice: event.target.value as TtsVoiceId}),
                  )}
                >
                  {TTS_VOICE_OPTIONS.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
        <label className="settings-row sidebar-setting-row">
          <span>
            <span className="codicon codicon-text-size settings-row-icon" aria-hidden="true" />
            Chat Font
          </span>
          <select
            className="sidebar-setting-select"
            value={chatFont}
            onChange={event => {
              const next = event.target.value;
              if (isChatFontId(next)) setChatFont(next);
            }}
          >
            {CHAT_FONT_OPTIONS.map(item => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        </>
        ), 'comment-discussion')}
        {renderSettingsSection('Connection', (
        <>
        <label className="settings-row sidebar-setting-row">
          <span>
            <span className="codicon codicon-cloud-download settings-row-icon" aria-hidden="true" />
            Local Hub Read
          </span>
          <input
            type="checkbox"
            checked={localHubReadEnabled}
            onChange={event => setLocalHubReadEnabled(event.target.checked)}
          />
        </label>
        <button
          type="button"
          className="settings-row settings-detail-row"
          onClick={() => openSettingsChild('connectionStatus')}
        >
          <span>
            <span className="codicon codicon-radio-tower settings-row-icon" aria-hidden="true" />
            Connection Status
          </span>
          <span className="codicon codicon-chevron-right" aria-hidden="true" />
        </button>
        </>
        ), 'radio-tower')}
        {renderSettingsSection('Code Display', (
        <>
        <label className="settings-row sidebar-setting-row">
          <span>
            <span className="codicon codicon-symbol-color settings-row-icon" aria-hidden="true" />
            Code Theme
          </span>
          <select
            className="sidebar-setting-select"
            value={codeTheme}
            onChange={event => {
              const next = event.target.value;
              if (isCodeThemeId(next)) setCodeTheme(next);
            }}
          >
            <option
              key={CODE_THEME_OPTIONS[0].id}
              value={CODE_THEME_OPTIONS[0].id}
            >
              {CODE_THEME_OPTIONS[0].label}
            </option>
            {CODE_THEME_OPTION_GROUPS.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="settings-row sidebar-setting-row">
          <span>
            <span className="codicon codicon-symbol-string settings-row-icon" aria-hidden="true" />
            Code Font
          </span>
          <select
            className="sidebar-setting-select"
            value={codeFont}
            onChange={event => {
              const next = event.target.value;
              if (isCodeFontId(next)) setCodeFont(next);
            }}
          >
            {CODE_FONT_OPTIONS.map(item => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-row sidebar-setting-row">
          <span>
            <span className="codicon codicon-text-size settings-row-icon" aria-hidden="true" />
            Font Size
          </span>
          <select
            className="sidebar-setting-select"
            value={String(codeFontSize)}
            onChange={event => {
              setCodeFontSize(
                clampCodeFontSize(Number(event.target.value)),
              );
            }}
          >
            {CODE_FONT_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </label>
        <label className="settings-row sidebar-setting-row">
          <span>
            <span className="codicon codicon-list-flat settings-row-icon" aria-hidden="true" />
            Line Height
          </span>
          <select
            className="sidebar-setting-select"
            value={String(codeLineHeight)}
            onChange={event => {
              setCodeLineHeight(
                clampCodeLineHeight(Number(event.target.value)),
              );
            }}
          >
            {CODE_LINE_HEIGHT_OPTIONS.map(v => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-row sidebar-setting-row">
          <span>
            <span className="codicon codicon-indent settings-row-icon" aria-hidden="true" />
            Tab Size
          </span>
          <select
            className="sidebar-setting-select"
            value={String(codeTabSize)}
            onChange={event => {
              setCodeTabSize(
                clampCodeTabSize(Number(event.target.value)),
              );
            }}
          >
            {CODE_TAB_SIZE_OPTIONS.map(v => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        </>
        ), 'code')}
        {renderSettingsSection('Debug', (
        <>
        <label className="settings-row sidebar-setting-row">
          <span>
            <span className="codicon codicon-eye settings-row-icon" aria-hidden="true" />
            Message Viewer
          </span>
          <input
            type="checkbox"
            checked={messageViewerEnabled}
            onChange={event => setMessageViewerEnabled(event.target.checked)}
          />
        </label>
        <label className="settings-row sidebar-setting-row">
          <span>
            <span className="codicon codicon-list-filter settings-row-icon" aria-hidden="true" />
            Log Level
          </span>
          <select
            className="sidebar-setting-select"
            value={logLevel}
            onChange={event => setLogLevel(normalizeAppDiagnosticLogLevel(event.target.value))}
          >
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </label>
        <label className="settings-row sidebar-setting-row">
          <span>
            <span className="codicon codicon-files settings-row-icon" aria-hidden="true" />
            Disable File Cache
          </span>
          <input
            type="checkbox"
            checked={disableFileCache}
            onChange={event => setDisableFileCache(event.target.checked)}
          />
        </label>
        <button
          type="button"
          className="settings-row settings-detail-row"
          onClick={() => openSettingsChild('debugLogs')}
        >
          <span>
            <span className="codicon codicon-output settings-row-icon" aria-hidden="true" />
            Logs
          </span>
          <span className="codicon codicon-chevron-right" />
        </button>
        <button
          type="button"
          className="settings-row settings-detail-row"
          onClick={() => openSettingsChild('database')}
        >
          <span>
            <span className="codicon codicon-database settings-row-icon" aria-hidden="true" />
            Database
          </span>
          <span className="codicon codicon-chevron-right" />
        </button>
        <button
          type="button"
          className="settings-row settings-danger-row"
          onClick={requestClearLocalCache}
        >
          <span>
            <span className="codicon codicon-trash settings-row-icon" aria-hidden="true" />
            Clear Local Cache
          </span>
          <span className="codicon codicon-chevron-right" />
        </button>
        <button
          type="button"
          className="settings-row settings-danger-row"
          onClick={handleRegistryDebugLogout}
        >
          <span>
            <span className="codicon codicon-sign-out settings-row-icon" aria-hidden="true" />
            Logout
          </span>
          <span className="codicon codicon-chevron-right" />
        </button>
        </>
        ), 'bug')}
      </div>
    </>
  );
}
