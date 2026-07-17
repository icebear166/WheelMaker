import React from 'react';

import {CHAT_FONT_OPTIONS, isChatFontId, type ChatFontId} from '../chat/chatTypography';
import {CHAT_VIEW_WIDTH_OPTIONS, isChatViewWidth, type ChatViewWidth} from '../chat/chatViewWidth';
import {
  SESSION_LIST_DENSITY_OPTIONS,
  isSessionListDensity,
  type SessionListDensity,
} from '../chat/sessionListDensity';
import {
  MOBILE_ENTER_KEY_BEHAVIOR_OPTIONS,
  isMobileEnterKeyBehavior,
  type MobileEnterKeyBehavior,
} from '../chat/mobileEnterKeyBehavior';
import {normalizeAppDiagnosticLogLevel, type AppDiagnosticLogLevel} from '../debug/appDiagnostics';
import {
  SPEECH_MODEL_OPTIONS,
  TTS_MODEL_OPTIONS,
  TTS_VOICE_OPTIONS,
  type ServerSettings,
  type ServerSettingsUpdate,
  type TtsModelId,
  type TtsVoiceId,
} from './serverSettings';
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
  isWide: boolean;
  chatViewWidth: ChatViewWidth;
  setChatViewWidth: (value: ChatViewWidth) => void;
  sessionListDensity: SessionListDensity;
  setSessionListDensity: (value: SessionListDensity) => void;
  mobileEnterKeyBehavior: MobileEnterKeyBehavior;
  setMobileEnterKeyBehavior: (value: MobileEnterKeyBehavior) => void;
  hideToolCalls: boolean;
  setHideToolCalls: (value: boolean) => void;
  promptCompletionNotificationsEnabled: boolean;
  setPromptCompletionNotificationsEnabled: (value: boolean) => void;
  handlePromptCompletionNotificationsChange: (enabled: boolean) => void;
  notificationPermissionState: string;
  serverSettings: ServerSettings;
  serverSettingsBusy: boolean;
  serverSettingsError: string;
  updateServerSetting: (update: ServerSettingsUpdate) => Promise<void>;
  chatFont: ChatFontId;
  setChatFont: (value: ChatFontId) => void;
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

type SettingsSectionId = 'appearance' | 'chat' | 'server' | 'connection' | 'code-display' | 'debug';

type SettingsSectionOptions = {
  id: SettingsSectionId;
  title: string;
  rows: React.ReactNode;
  icon?: string;
};

function renderSettingsSection({id, title, rows, icon}: SettingsSectionOptions) {
  return (
    <section className={`settings-section settings-section-${id}`} aria-label={title}>
      <div className="settings-section-title">
        {icon ? <span className={`codicon codicon-${icon}`} aria-hidden="true" /> : null}
        <span>{title}</span>
      </div>
      <div className="settings-section-rows">{rows}</div>
    </section>
  );
}

function ServerSecretEditor({
  label,
  section,
  configured,
  updatedAt,
  busy,
  onUpdate,
}: {
  label: string;
  section: ServerSettingsUpdate['section'];
  configured: boolean;
  updatedAt?: string;
  busy: boolean;
  onUpdate: (update: ServerSettingsUpdate) => Promise<void>;
}) {
  const [draft, setDraft] = React.useState('');
  const submit = async () => {
    const value = draft.trim();
    if (!value) return;
    try {
      await onUpdate({section, field: 'key', action: 'set', value});
      setDraft('');
    } catch {
      // Parent exposes the failure while keeping this draft available for retry.
    }
  };
  return (
    <div className="voice-input-settings-nested">
      <div className="settings-row sidebar-setting-row voice-input-settings-child-row">
        <span>
          <span className="codicon codicon-key settings-row-icon" aria-hidden="true" />
          {label}
          <span className="settings-metadata-line">
            {configured ? 'Configured' : 'Not configured'}
            {updatedAt ? ` · ${new Date(updatedAt).toLocaleString()}` : ''}
          </span>
        </span>
      </div>
      <div className="settings-row sidebar-setting-row voice-input-settings-child-row">
        <input
          type="password"
          autoComplete="new-password"
          placeholder="Enter a new secret"
          value={draft}
          disabled={busy}
          onChange={event => setDraft(event.target.value)}
        />
        <button type="button" disabled={busy || !draft.trim()} onClick={() => void submit()}>
          {configured ? 'Replace' : 'Set'}
        </button>
        {configured ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onUpdate({section, field: 'key', action: 'clear'}).catch(() => undefined)}
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsRootContent({
  showSectionTitle,
  themeMode,
  setThemeMode,
  isWide,
  chatViewWidth,
  setChatViewWidth,
  sessionListDensity,
  setSessionListDensity,
  mobileEnterKeyBehavior,
  setMobileEnterKeyBehavior,
  hideToolCalls,
  setHideToolCalls,
  promptCompletionNotificationsEnabled,
  setPromptCompletionNotificationsEnabled,
  handlePromptCompletionNotificationsChange,
  notificationPermissionState,
  serverSettings,
  serverSettingsBusy,
  serverSettingsError,
  updateServerSetting,
  chatFont,
  setChatFont,
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
        {renderSettingsSection({id: 'appearance', title: 'Appearance', icon: 'paintcan', rows: (
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
          {isWide ? (
            <label className="settings-row sidebar-setting-row">
              <span>
                <span className="codicon codicon-layout settings-row-icon" aria-hidden="true" />
                Chat View Width
              </span>
              <select
                className="sidebar-setting-select"
                value={chatViewWidth}
                onChange={event => {
                  const next = event.target.value;
                  if (isChatViewWidth(next)) setChatViewWidth(next);
                }}
              >
                {CHAT_VIEW_WIDTH_OPTIONS.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </>
        )})}
        {renderSettingsSection({id: 'chat', title: 'Chat', icon: 'comment-discussion', rows: (
        <>
        {isWide ? (
          <label className="settings-row sidebar-setting-row">
            <span>
              <span className="codicon codicon-list-flat settings-row-icon" aria-hidden="true" />
              Session List Density
            </span>
            <select
              className="sidebar-setting-select"
              value={sessionListDensity}
              onChange={event => {
                const next = event.target.value;
                if (isSessionListDensity(next)) setSessionListDensity(next);
              }}
            >
              {SESSION_LIST_DENSITY_OPTIONS.map(item => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
        {!isWide ? (
          <label className="settings-row sidebar-setting-row">
            <span>
              <span className="codicon codicon-keyboard settings-row-icon" aria-hidden="true" />
              Mobile Enter Key
            </span>
            <select
              className="sidebar-setting-select"
              value={mobileEnterKeyBehavior}
              onChange={event => {
                const next = event.target.value;
                if (isMobileEnterKeyBehavior(next)) setMobileEnterKeyBehavior(next);
              }}
            >
              {MOBILE_ENTER_KEY_BEHAVIOR_OPTIONS.map(item => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
        )})}
        {renderSettingsSection({id: 'server', title: 'Server', icon: 'server', rows: (
        <>
          <div className="voice-input-settings-menu">
            <div className="settings-row sidebar-setting-row">
              <span>
                <span className="codicon codicon-mic settings-row-icon" aria-hidden="true" />
                Voice Input
              </span>
            </div>
            <ServerSecretEditor
              label="Volcengine ASR Access Token"
              section="voiceInput"
              configured={serverSettings.voiceInput.configured}
              updatedAt={serverSettings.voiceInput.updatedAt}
              busy={serverSettingsBusy}
              onUpdate={updateServerSetting}
            />
            <div className="voice-input-settings-nested">
              <label className="settings-row sidebar-setting-row voice-input-settings-child-row">
                <span>
                  <span className="codicon codicon-symbol-misc settings-row-icon" aria-hidden="true" />
                  Model
                </span>
                <select
                  className="sidebar-setting-select"
                  title="Doubao Streaming ASR 2.0"
                  value={serverSettings.voiceInput.model}
                  disabled={serverSettingsBusy}
                  onChange={event => void updateServerSetting({
                    section: 'voiceInput',
                    field: 'model',
                    action: 'set',
                    value: event.target.value,
                  }).catch(() => undefined)}
                >
                  {SPEECH_MODEL_OPTIONS.map(item => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="voice-input-settings-menu">
            <div className="settings-row sidebar-setting-row">
              <span>
                <span className="codicon codicon-unmute settings-row-icon" aria-hidden="true" />
                Text-to-Speech
              </span>
            </div>
            <ServerSecretEditor
              label="MiMo TTS API Key"
              section="textToSpeech"
              configured={serverSettings.textToSpeech.configured}
              updatedAt={serverSettings.textToSpeech.updatedAt}
              busy={serverSettingsBusy}
              onUpdate={updateServerSetting}
            />
            <div className="voice-input-settings-nested">
              <label className="settings-row sidebar-setting-row voice-input-settings-child-row">
                <span>
                  <span className="codicon codicon-symbol-misc settings-row-icon" aria-hidden="true" />
                  Model
                </span>
                <select
                  className="sidebar-setting-select"
                  value={serverSettings.textToSpeech.model}
                  disabled={serverSettingsBusy}
                  onChange={event => void updateServerSetting({
                    section: 'textToSpeech',
                    field: 'model',
                    action: 'set',
                    value: event.target.value as TtsModelId,
                  }).catch(() => undefined)}
                >
                  {TTS_MODEL_OPTIONS.map(item => (
                    <option key={item.id} value={item.id}>{item.label}</option>
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
                  value={serverSettings.textToSpeech.voice}
                  disabled={serverSettingsBusy}
                  onChange={event => void updateServerSetting({
                    section: 'textToSpeech',
                    field: 'voice',
                    action: 'set',
                    value: event.target.value as TtsVoiceId,
                  }).catch(() => undefined)}
                >
                  {TTS_VOICE_OPTIONS.map(item => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {serverSettingsError ? (
            <div className="voice-input-settings-nested">
              <div className="settings-metadata-line">{serverSettingsError}</div>
            </div>
          ) : null}
        </>
        )})}
        {renderSettingsSection({id: 'connection', title: 'Connection', icon: 'radio-tower', rows: (
        <>
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
        <button
          type="button"
          className="settings-row settings-detail-row"
          onClick={() => openSettingsChild('deviceSessions')}
        >
          <span>
            <span className="codicon codicon-devices settings-row-icon" aria-hidden="true" />
            Devices
          </span>
          <span className="codicon codicon-chevron-right" aria-hidden="true" />
        </button>
        </>
        )})}
        {renderSettingsSection({id: 'code-display', title: 'Code Display', icon: 'code', rows: (
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
        )})}
        {renderSettingsSection({id: 'debug', title: 'Debug', icon: 'bug', rows: (
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
        )})}
      </div>
    </>
  );
}
