import React from 'react';

import {Icon, type IconName} from '../common/Icon';
import {SecretEditor} from '../common/SecretEditor';
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
  mobileEnterKeyBehavior: MobileEnterKeyBehavior;
  setMobileEnterKeyBehavior: (value: MobileEnterKeyBehavior) => void;
  showMonitor: boolean;
  setShowMonitor: (value: boolean) => void;
  promptCompletionNotificationsEnabled: boolean;
  setPromptCompletionNotificationsEnabled: (value: boolean) => void;
  handlePromptCompletionNotificationsChange: (enabled: boolean) => void;
  notificationPermissionState: string;
  serverSettings: ServerSettings;
  serverSettingsBusy: boolean;
  serverSettingsError: string;
  updateServerSetting: (update: ServerSettingsUpdate) => Promise<void>;
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
  icon?: IconName;
};

function renderSettingsSection({id, title, rows, icon}: SettingsSectionOptions) {
  return (
    <section className={`settings-section settings-section-${id}`} aria-label={title}>
      <div className="settings-section-title">
        {icon ? <Icon name={icon} className="settings-section-icon" /> : null}
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
  isWide,
  mobileEnterKeyBehavior,
  setMobileEnterKeyBehavior,
  showMonitor,
  setShowMonitor,
  promptCompletionNotificationsEnabled,
  setPromptCompletionNotificationsEnabled,
  handlePromptCompletionNotificationsChange,
  notificationPermissionState,
  serverSettings,
  serverSettingsBusy,
  serverSettingsError,
  updateServerSetting,
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
        {renderSettingsSection({id: 'appearance', title: 'Appearance', icon: 'palette', rows: (
        <>
          <label className="settings-row sidebar-setting-row">
            <span>
              <Icon name="moon" className="settings-row-icon" />
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
        </>
        )})}
        {renderSettingsSection({id: 'chat', title: 'Chat', icon: 'messageCircle', rows: (
        <>
        {isWide ? (
          <label className="settings-row sidebar-setting-row">
            <span>
              <Icon name="activity" className="settings-row-icon" />
              Show Monitor
            </span>
            <input
              type="checkbox"
              checked={showMonitor}
              onChange={e => setShowMonitor(e.target.checked)}
            />
          </label>
        ) : null}
        {!isWide ? (
          <label className="settings-row sidebar-setting-row">
            <span>
              <Icon name="keyboard" className="settings-row-icon" />
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
              <Icon name="bell" className="settings-row-icon" />
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
        </>
        )})}
        {renderSettingsSection({id: 'server', title: 'Server', icon: 'server', rows: (
        <>
          <div className="voice-input-settings-menu">
            <div className="settings-row sidebar-setting-row">
              <span>
                <Icon name="mic" className="settings-row-icon" />
                Voice Input
              </span>
            </div>
            <SecretEditor
              label="Volcengine ASR Access Token"
              configured={serverSettings.voiceInput.configured}
              updatedAt={serverSettings.voiceInput.updatedAt}
              busy={serverSettingsBusy}
              onSet={value => updateServerSetting({section: 'voiceInput', field: 'key', action: 'set', value})}
              onClear={() => updateServerSetting({section: 'voiceInput', field: 'key', action: 'clear'})}
            />
            <div className="voice-input-settings-nested">
              <label className="settings-row sidebar-setting-row voice-input-settings-child-row">
                <span>
                  <Icon name="bot" className="settings-row-icon" />
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
                <Icon name="volume2" className="settings-row-icon" />
                Text-to-Speech
              </span>
            </div>
            <SecretEditor
              label="MiMo TTS API Key"
              configured={serverSettings.textToSpeech.configured}
              updatedAt={serverSettings.textToSpeech.updatedAt}
              busy={serverSettingsBusy}
              onSet={value => updateServerSetting({section: 'textToSpeech', field: 'key', action: 'set', value})}
              onClear={() => updateServerSetting({section: 'textToSpeech', field: 'key', action: 'clear'})}
            />
            <div className="voice-input-settings-nested">
              <label className="settings-row sidebar-setting-row voice-input-settings-child-row">
                <span>
                  <Icon name="bot" className="settings-row-icon" />
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
                  <Icon name="userRound" className="settings-row-icon" />
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
        {renderSettingsSection({id: 'connection', title: 'Connection', icon: 'radioTower', rows: (
        <>
        <button
          type="button"
          className="settings-row settings-detail-row"
          onClick={() => openSettingsChild('connectionStatus')}
        >
          <span>
            <Icon name="radioTower" className="settings-row-icon" />
            Connection Status
          </span>
          <Icon name="chevronRight" className="settings-row-chevron" />
        </button>
        <button
          type="button"
          className="settings-row settings-detail-row"
          onClick={() => openSettingsChild('deviceSessions')}
        >
          <span>
            <Icon name="laptop" className="settings-row-icon" />
            Devices
          </span>
          <Icon name="chevronRight" className="settings-row-chevron" />
        </button>
        </>
        )})}
        {renderSettingsSection({id: 'code-display', title: 'Code Display', icon: 'code', rows: (
        <>
        <label className="settings-row sidebar-setting-row">
          <span>
            <Icon name="swatchBook" className="settings-row-icon" />
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
            <Icon name="type" className="settings-row-icon" />
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
            <Icon name="aArrowUp" className="settings-row-icon" />
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
            <Icon name="moveVertical" className="settings-row-icon" />
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
            <Icon name="indentIncrease" className="settings-row-icon" />
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
            <Icon name="eye" className="settings-row-icon" />
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
            <Icon name="filter" className="settings-row-icon" />
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
            <Icon name="database" className="settings-row-icon" />
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
            <Icon name="scrollText" className="settings-row-icon" />
            Logs
          </span>
          <Icon name="chevronRight" className="settings-row-chevron" />
        </button>
        <button
          type="button"
          className="settings-row settings-detail-row"
          onClick={() => openSettingsChild('releasePublish')}
        >
          <span>
            <Icon name="uploadCloud" className="settings-row-icon" />
            Release publishing
          </span>
          <Icon name="chevronRight" className="settings-row-chevron" />
        </button>
        <button
          type="button"
          className="settings-row settings-detail-row"
          onClick={() => openSettingsChild('database')}
        >
          <span>
            <Icon name="database" className="settings-row-icon" />
            Database
          </span>
          <Icon name="chevronRight" className="settings-row-chevron" />
        </button>
        <button
          type="button"
          className="settings-row settings-danger-row"
          onClick={requestClearLocalCache}
        >
          <span>
            <Icon name="eraser" className="settings-row-icon" />
            Clear Local Cache
          </span>
          <Icon name="chevronRight" className="settings-row-chevron" />
        </button>
        <button
          type="button"
          className="settings-row settings-danger-row"
          onClick={handleRegistryDebugLogout}
        >
          <span>
            <Icon name="logOut" className="settings-row-icon" />
            Logout
          </span>
          <Icon name="chevronRight" className="settings-row-chevron" />
        </button>
        </>
        )})}
      </div>
    </>
  );
}
