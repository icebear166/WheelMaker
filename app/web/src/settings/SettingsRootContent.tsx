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
import type {SettingsDetail} from './settingsNavigation';

const CODE_FONT_SIZE_OPTIONS = [12, 13, 14, 15, 16] as const;
const CODE_LINE_HEIGHT_OPTIONS = [1.35, 1.45, 1.5, 1.6, 1.7] as const;
const CODE_TAB_SIZE_OPTIONS = [2, 4, 8] as const;

type SettingsRootContentProps = {
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
  openSettingsDetail: (detail: SettingsDetail) => void;
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
  logLevel: AppDiagnosticLogLevel;
  setLogLevel: (value: AppDiagnosticLogLevel) => void;
  handleRegistryDebugLogout: () => void;
};

type SettingsSectionId = 'chat' | 'code' | 'state' | 'debug';

type SettingsSectionOptions = {
  id: SettingsSectionId;
  title: string;
  rows: React.ReactNode;
  icon?: IconName;
};

function SettingsSection({id, title, rows, icon}: SettingsSectionOptions) {
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

type SettingsRowProps = {
  icon: IconName;
  label: string;
  control: React.ReactNode;
};

function SettingsControlRow({icon, label, control}: SettingsRowProps) {
  return (
    <label className="settings-row sidebar-setting-row">
      <span>
        <Icon name={icon} className="settings-row-icon" />
        {label}
      </span>
      {control}
    </label>
  );
}

type SettingsNavRowProps = {
  icon: IconName;
  label: string;
  danger?: boolean;
  onClick: () => void;
};

function SettingsNavRow({icon, label, danger = false, onClick}: SettingsNavRowProps) {
  return (
    <button
      type="button"
      className={`settings-row ${danger ? 'settings-danger-row' : 'settings-detail-row'}`}
      onClick={onClick}
    >
      <span>
        <Icon name={icon} className="settings-row-icon" />
        {label}
      </span>
      {danger ? null : <Icon name="chevronRight" className="settings-row-chevron" />}
    </button>
  );
}

export function SettingsRootContent({
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
  openSettingsDetail,
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
  logLevel,
  setLogLevel,
  handleRegistryDebugLogout,
}: SettingsRootContentProps) {
  return (
    <div className="settings-list">
      <SettingsSection id="chat" title="Chat" icon="messageCircle" rows={(
        <>
          {isWide ? (
            <SettingsControlRow
              icon="activity"
              label="Show Monitor"
              control={(
                <input
                  type="checkbox"
                  className="settings-switch"
                  checked={showMonitor}
                  onChange={e => setShowMonitor(e.target.checked)}
                />
              )}
            />
          ) : null}
          {!isWide ? (
            <SettingsControlRow
              icon="keyboard"
              label="Mobile Enter Key"
              control={(
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
              )}
            />
          ) : null}
          <SettingsControlRow
            icon="bell"
            label="Notifications"
            control={(
              <input
                type="checkbox"
                className="settings-switch"
                checked={promptCompletionNotificationsEnabled}
                onChange={event => {
                  if (!event.target.checked) {
                    setPromptCompletionNotificationsEnabled(false);
                    return;
                  }
                  handlePromptCompletionNotificationsChange(true);
                }}
              />
            )}
          />
          {notificationPermissionState === 'denied' ? (
            <div className="settings-row-note">Blocked by system permission</div>
          ) : null}
          <div className="settings-subsection">
            <div className="settings-subsection-title">Voice Input</div>
            <div className="settings-subsection-rows">
              <SecretEditor
                compact
                label="Key"
                configured={serverSettings.voiceInput.configured}
                updatedAt={serverSettings.voiceInput.updatedAt}
                busy={serverSettingsBusy}
                onSet={value => updateServerSetting({section: 'voiceInput', field: 'key', action: 'set', value})}
                onClear={() => updateServerSetting({section: 'voiceInput', field: 'key', action: 'clear'})}
              />
              <SettingsControlRow
                icon="bot"
                label="Model"
                control={(
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
                )}
              />
            </div>
          </div>
          <div className="settings-subsection">
            <div className="settings-subsection-title">Speech</div>
            <div className="settings-subsection-rows">
              <SecretEditor
                compact
                label="Key"
                configured={serverSettings.textToSpeech.configured}
                updatedAt={serverSettings.textToSpeech.updatedAt}
                busy={serverSettingsBusy}
                onSet={value => updateServerSetting({section: 'textToSpeech', field: 'key', action: 'set', value})}
                onClear={() => updateServerSetting({section: 'textToSpeech', field: 'key', action: 'clear'})}
              />
              <SettingsControlRow
                icon="bot"
                label="Model"
                control={(
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
                )}
              />
              <SettingsControlRow
                icon="userRound"
                label="Voice"
                control={(
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
                )}
              />
            </div>
          </div>
          {serverSettingsError ? (
            <div className="settings-row-note settings-row-note-error">{serverSettingsError}</div>
          ) : null}
        </>
      )} />
      <SettingsSection id="code" title="Code" icon="code" rows={(
        <>
          <SettingsControlRow
            icon="swatchBook"
            label="Code Theme"
            control={(
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
            )}
          />
          <SettingsControlRow
            icon="type"
            label="Code Font"
            control={(
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
            )}
          />
          <SettingsControlRow
            icon="aArrowUp"
            label="Font Size"
            control={(
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
            )}
          />
          <SettingsControlRow
            icon="moveVertical"
            label="Line Height"
            control={(
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
            )}
          />
          <SettingsControlRow
            icon="indentIncrease"
            label="Tab Size"
            control={(
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
            )}
          />
        </>
      )} />
      <SettingsSection id="state" title="State" icon="activity" rows={(
        <>
          <SettingsNavRow
            icon="radioTower"
            label="Connection Status"
            onClick={() => openSettingsDetail('connectionStatus')}
          />
          <SettingsNavRow
            icon="laptop"
            label="Devices"
            onClick={() => openSettingsDetail('deviceSessions')}
          />
          <SettingsNavRow
            icon="database"
            label="Database"
            onClick={() => openSettingsDetail('database')}
          />
          <SettingsNavRow
            icon="logOut"
            label="Logout"
            danger
            onClick={handleRegistryDebugLogout}
          />
        </>
      )} />
      <SettingsSection id="debug" title="Debug" icon="bug" rows={(
        <>
          <div className="settings-row settings-log-level-row">
            <span>
              <Icon name="filter" className="settings-row-icon" />
              Log Level
            </span>
            <div className="settings-log-level-controls">
              <select
                className="sidebar-setting-select"
                aria-label="Log level"
                value={logLevel}
                onChange={event => setLogLevel(normalizeAppDiagnosticLogLevel(event.target.value))}
              >
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
              </select>
              <button
                type="button"
                className="settings-row-nav-btn"
                aria-label="Open logs"
                title="Open logs"
                onClick={() => openSettingsDetail('debugLogs')}
              >
                <Icon name="chevronRight" />
              </button>
            </div>
          </div>
        </>
      )} />
    </div>
  );
}
