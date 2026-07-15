import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import {resolveWindowsWorkspaceShortcut} from './workspaceShortcuts';

declare global {
  interface Window {
    WheelMakerAndroidBack?: {
      handleBack: () => boolean;
    };
  }
}

import {deriveRegistryEndpoints} from '../registry/registryBaseUrl';
import {RegistryWebAuthClient} from '../registry/RegistryWebAuthClient';
import {RegistryAuthController, type RegistryAuthSnapshot} from '../registry/RegistryAuthController';
import {resolveLoginDeviceName} from '../registry/deviceName';
import { appendPortRelayAutoAuthCode, appendPortRelayOpenPath, parsePortRelayLocalHttpUrl, resolvePortRelayOpenUrl } from '../portRelay/portRelayUrl';
import { buildPortRelayClearSiteDataUrl } from '../portRelay/portRelayUrl';
import type { PortRelayLocalHttpUrl } from '../portRelay/portRelayUrl';
import {
  normalizePortRelayListenPort,
  normalizePortRelayTarget,
  normalizePortRelayTargets,
  orderPortRelayTargetsForMenu,
  removePortRelayTarget,
  reconcilePortRelayTargetSelection,
  samePortRelayTarget,
  samePortRelayTargets,
  upsertPortRelayTarget,
  type PortRelayTarget,
} from '../portRelay/portRelayTargets';
import { PortRelayFloatingButton, PortRelayFrameSurface } from '../portRelay/PortRelayFrameSurface';
import { initializePWAFoundation } from '../platform/pwa';
import {cleanupNativeWebViewPWA} from '../platform/pwa/nativePwaGuard';
import { DesktopDragRegion, DesktopWindowControls } from '../shell/layouts/desktop/DesktopTitleBar';
import {resolveDesktopChatQuickSwitchContextMenu} from '../shell/layouts/desktop/chatQuickSwitchContextMenu';
import {getDesktopWindowBridge} from '../platform/desktop/desktopRuntime';
import {getNativeRuntimeBridge, isNativeShellHost} from '../platform/native/nativeRuntime';
import {
  AppConfirmDialog,
  AppRenameDialog,
  AppSessionStatusDialog,
  type ConfirmTarget,
  type RenameSessionTarget,
} from '../shell/AppDialogs';
import { installDesktopZoomGuard } from '../shell/desktopZoomGuard';
import { installPageRefreshGuard } from '../shell/pageRefreshGuard';
import { ResponsiveShell } from '../shell/ResponsiveShell';
import {
  getLatestSessionReadCursor,
  isFinishedChatMessage,
  needsPromptTurnRefresh,
  shouldMaterializeRealtimeSessionMessages,
} from '../chat/turns/chatSync';
import { compareUpdatedAtDesc } from '../workspace/sessionTime';
import {
  resolveChatSessionVisualState as resolveChatSessionVisualStateValue,
  type ChatSessionVisualState,
} from '../chat/session/chatSessionState';
import {
  canStartDraftChatSessionCreate,
  createDraftChatSession,
  findDraftChatSessionForCreatedSession,
  isDraftChatSessionId,
  markDraftChatSessionFailed,
  markDraftChatSessionSending,
  removeDraftChatSession,
  resolveDraftReplacementSelection,
  type DraftChatSession,
} from '../chat/session/chatDraftSessions';
import {
  chatSessionKeyFromParts,
  decodeChatSessionKey,
  encodeChatSessionKey,
  type ChatSessionKey,
} from '../chat/session/chatSessionKey';
import {
  buildQueuedPromptMessage,
  cancelQueuedChatPrompt,
  enqueueChatCompact,
  enqueueChatItemToFront,
  enqueueChatPrompt,
  moveQueuedChatPromptToFront,
  moveQueuedChatPrompts,
  queuedChatPrompts,
  shiftNextQueuedChatItem,
  type QueuedChatCompact,
  type QueuedChatPrompt,
  type QueuedChatPromptsByKey,
} from '../chat/session/chatPromptQueue';
import {
  buildChatSessionActionOptions,
  filterChatSessionActionOptions,
  removeActiveSlashQuery,
  resolveStandaloneSessionAction,
  type ChatSessionActionKind,
  type ChatSessionSlashOption,
} from '../chat/session/chatSessionActions';
import {
  buildMobileChatQuickSwitchSections,
  buildRecentChatSessionProjectSections,
  hasCompletedUnreadChatSession,
  type RecentChatSessionProjectSection,
} from '../chat/mobileChatQuickSwitch';
import {ChatQuickSwitchMenu} from '../chat/ChatQuickSwitchMenu';
import { ChatSessionNav } from '../chat/ChatSessionNav';
import { ChatSurface } from '../chat/ChatSurface';
import { ChatTurnView } from '../chat/ChatTurnView';
import {ChatPlanSurface} from '../chat/ChatPlanSurface';
import {ChatRecentSessionsSurface} from '../chat/ChatRecentSessionsSurface';
import {extractLatestChatPlan} from '../chat/chatPlan';
import { resolveChatSessionTitle } from '../chat/session/chatSessionTitle';
import { formatChatContextUsage, splitChatComposerStatusOptions } from '../chat/session/chatComposerStatus';
import {decodeSessionTurnToMessage, normalizeSessionMessagePayload} from '../chat/chatWire';
import {
  applySessionReadResult,
  buildMergedRawTurns,
  createEmptyChatTurnStore,
  isStaleSessionReadResult,
  mergeCachedTurnPrefix,
  mergeRealtimeTurn,
  shouldReadRepairForIncomingTurn,
  type ChatTurnStoreState,
} from '../chat/turns/chatTurnStores';
import {createChatDurablePersistQueue} from '../chat/turns/chatDurablePersist';
import {createChatReadRepairQueue} from '../chat/turns/chatReadRepair';
import {buildChatDisplayIndex, type ChatDisplayIndexItem} from '../chat/turns/chatDisplayIndex';
import {
  buildSessionSearchSections,
  mergeSessionSearchResultsByProject,
  resolveSessionSearchPollDelay,
  splitSessionSearchTitleHighlight,
  type SessionSearchResultsByProjectId,
  type SessionSearchSectionRow,
} from '../chat/session/sessionSearchState';
import {
  OLDER_SESSION_DAYS,
  buildArchivedSessionSections,
  collectArchiveCandidates,
  nextArchiveBatchProgress,
  readOlderSessionsExpanded,
  splitOlderProjectSessions,
  writeOlderSessionsExpanded,
  type ArchiveBatchProgress,
  type ArchiveCandidate,
} from '../chat/session/sessionArchiveState';
import {useChatLayoutMetrics} from '../chat/layout/chatLayoutMetrics';
import {resolveWideProjectActionPopoverPlacement, type WideProjectActionPopoverPlacement} from '../chat/layout/wideProjectActionPopover';
import {ChatVirtuosoTurnList, type ChatVirtuosoTurnListHandle} from '../chat/turns/ChatVirtuosoTurnList';
import {
  DEFAULT_CHAT_FONT,
  isChatFontId,
  resolveChatFontFamily,
  type ChatFontId,
} from '../chat/chatTypography';
import {
  normalizeChatViewWidth,
  type ChatViewWidth,
} from '../chat/chatViewWidth';
import {
  normalizeSessionListDensity,
  type SessionListDensity,
} from '../chat/sessionListDensity';
import {
  normalizeMobileEnterKeyBehavior,
  type MobileEnterKeyBehavior,
} from '../chat/mobileEnterKeyBehavior';
import { buildPromptDoneCopyRange } from '../chat/chatCopyRange';
import {
  chatPromptAttachmentLabel,
  chatPromptAttachmentMeta,
  isPromptImageAttachmentContentBlock,
  isPromptAttachmentContentBlock,
} from '../chat/composer/chatPromptAttachments';
import { ChatRichComposer, type ChatRichComposerHandle } from '../chat/composer/ChatRichComposer';
import type {ChatRichComposerSelectionRestore} from '../chat/composer/ChatRichComposer';
import {
  chatComposerHasSendableTokens,
  normalizeChatComposerTokens,
  serializeChatComposerTokens,
  type ChatComposerToken,
} from '../chat/composer/chatComposerTokens';
import {
  resolveChatFileMentionQuery,
  resolveChatSlashQuery,
} from '../chat/composer/chatComposerTriggerQueries';
import {
  buildPromptMarkdownImageFileName,
  renderMarkdownElementToPngBlob,
  resolveMarkdownImageExportWidth,
  type MarkdownImageExportMode,
} from '../chat/export/chatMarkdownImageExport';
import {
  outputResponseImage,
  reserveResponseImageShare,
  type ResponseImageOutputResult,
} from '../chat/export/responseImageOutput';
import {createRegistryDebugStore} from '../debug/registryDebug';
import type {RegistryDebugRecord} from '../debug/registryDebug';
import {
  extractChatConfirmationReply,
  extractChatOptionReplies,
  type ChatConfirmationReply,
  type ChatOptionReply,
} from '../chat/chatOptionReplies';
import {
  isChatUserScrollLocked,
  nextChatUserScrollLockUntil,
  resolveChatKeyboardInset,
  resolveChatKeyboardLayoutViewportHeight,
  resolveChatKeyboardInsetScrollAction,
  resolveChatSessionReadWindowUpdate,
  resolveChatScrollToBottomVisibility,
  shouldAutoScrollChatToBottom,
} from '../chat/layout/chatScrollIntent';
import { resolveChatScrollBottomButtonOffset } from '../chat/layout/chatScrollBottomButton';
import { resolvePromptTurnStatus, type ChatPromptStatus } from '../chat/turns/chatPromptStatus';
import {
  buildPromptCompletionNotification,
  promptCompletionNotificationKey,
  shouldNotifyPromptCompletion,
} from '../chat/notifications/promptCompletionNotification';
import {
  createNotificationProvider,
  type WheelMakerNotificationPermissionState,
} from '../notifications/NotificationProvider';
import {
  GITHUB_ANDROID_LATEST_RELEASE_API,
  createAndroidApkUpdateBridge,
  parseAndroidLatestRelease,
  resolveAndroidApkUpdateStatus,
  type AndroidApkInstallResult,
  type AndroidApkLatestRelease,
  type AndroidApkLocalRelease,
  type AndroidApkUpdateStatus,
} from '../platform/android/androidApkUpdate';
import { mergeChatSessionList, shouldUpdateCurrentProjectSessions } from '../chat/session/chatIndexState';
import {
  resolveChatListSelection,
  resolveSelectedChatVisibilityRecovery,
  shouldApplyLoadedChatSelection,
  shouldApplyPreservedChatLoad,
  shouldApplySentChatSelection,
} from '../chat/chatSelectionGuard';
import { RegistryWorkspaceService } from '../registry/RegistryWorkspaceService';
import {RegistryMethods} from '../registry/registryMethods';
import {TerminalView, type TerminalViewHandle} from '../terminal/TerminalView';
import {TerminalWorkbench} from '../terminal/TerminalWorkbench';
import {bytesToBase64} from '../terminal/terminalEncoding';
import {
  applyTerminalChanged,
  applyTerminalSnapshot,
  beginTerminalSnapshot,
  canSendTerminalInput,
  createTerminalSyncState,
  markTerminalsUnavailable,
  mergeTerminalLists,
  receiveTerminalOutput,
  type TerminalEffect,
  type TerminalSyncState,
} from '../terminal/terminalSync';
import { sortProjectsByPin, togglePinnedProjectId } from '../workspace/projectNavigation';
import {
  HUB_COLOR_PRESETS,
  findNextVisibleProject,
  hubColorToHsv,
  hubHsvToColor,
  resolveDefaultHubColor,
  resolveHubColor,
  resolveHubColorVariantIndex,
  setHubColorPreference,
  splitProjectsByVisibility,
  toggleProjectVisibility,
  type HubColorHsv,
} from '../workspace/hubProjectPreferences';
import { triggerMobileHaptic } from '../shell/layouts/mobile/mobileHaptics';
import {
  FLOATING_CONTROL_DEFAULT_Y_RATIO,
  floatingControlTopFromYRatio,
  floatingControlYRatioFromLegacySlot,
  floatingControlYRatioFromTop,
  resolveFloatingControlAvoidanceBounds,
  resolveFloatingControlDefaultBounds,
  resolveFloatingControlYRatioForBoundsChange,
  resolveFloatingControlDragSide,
  sanitizeFloatingControlYRatio,
} from '../shell/layouts/mobile/floatingControls';
import {
  GESTURE_MOVE_LONG_PRESS_MS,
  shouldCancelGestureClick,
  shouldStartGestureMove,
} from '../shell/layouts/mobile/gestureNavigation';
import {
  createMobileSettingsHistoryState,
  isMobileSettingsHistoryState,
  mobileSettingsHistoryKey,
  resolveMobileSettingsHistoryWriteAction,
  resolveMobileSettingsPopAction,
  type MobileSettingsHistoryDetail,
} from '../shell/layouts/mobile/mobileSettingsHistory';
import {
  isSettingsPeerDetail,
  mobileSettingsShortcutIndex,
  settingsPageKind,
  type SettingsChildDetail,
  type SettingsDetailId,
  type SettingsPeerDetail,
} from '../settings/settingsNavigation';
import {
  MobileSettingsScreen,
  MobileSettingsShortcutBar,
  SettingsDetailShell,
  SettingsScreen,
  SettingsSurface,
  settingsDetailTitle,
  type SettingsDetailShellOptions,
} from '../settings/SettingsSurface';
import { installMobileViewportZoomGuard } from '../shell/layouts/mobile/mobileViewportZoomGuard';
import { resolveLayoutMode } from '../shell/state/responsiveLayout';
import {
  scanTokenStatsAcrossHubs,
  tokenStatsFailureSummary,
  type TokenProviderSectionView,
} from '../settings/tokenStatsView';
import {
  AGENT_PACKAGE_SCAN_TIMEOUT_MS,
  deriveNpmPackageUpdateTargets,
  deriveRegistryHubIds,
  npmPackageUpdateSummary,
  packageStatusLabel,
  shouldShowWheelMakerUpdateAction,
  wheelMakerUpdateStatusLabel,
  withAgentPackageTimeout,
  type NpmPackageUpdateTarget,
} from '../settings/agentPackageUpdateView';
import {
  deriveSkillHubIds,
  groupSkillsByCategory,
  isSkillActionPendingForHub,
  parseSkillSourceInput,
  skillDetailCacheKey,
  skillOperationStatusLabel,
  skillScopeLabel,
  sortSkillProjects,
} from '../settings/skillManagementView';
import {
  DEFAULT_CODE_FONT,
  DEFAULT_CODE_FONT_SIZE,
  DEFAULT_CODE_LINE_HEIGHT,
  DEFAULT_CODE_TAB_SIZE,
  DEFAULT_CODE_THEME,
  isCodeFontId,
  isCodeThemeId,
  resolveCodeFontFamily,
  type CodeFontId,
  type CodeThemeId,
} from '../code/shikiSettings';
import { ShikiCodeBlock, ShikiDiffPane, preloadShikiRenderer } from '../code/ShikiCodeBlock';
import {
  HtmlPreview,
  MarkdownPreview,
  markdownCodeRenderer,
  markdownPreRenderer,
  useMarkdownCapabilityPlugins,
} from '../code/markdownPreview';
import {createVoiceInputSession, type VoiceInputSession} from '../features/speech/useVoiceInputController';
import {
  VOICE_LONG_TIMEOUT_MS,
  VOICE_SHORT_TIMEOUT_MS,
  type VoiceRecordingStatus,
} from '../features/speech/voiceInputConstants';
import {
  createDefaultVoiceInputBuffer,
  createDefaultVoiceInputSendQueue,
  startVoiceInputMicrophoneStream,
  type MicrophonePCMStream,
  type VoiceInputBuffer,
  type VoiceInputSendQueue,
} from '../features/speech/voiceInputRuntime';
import {
  createAndroidNativeSpeechRuntime,
  getAndroidNativeSpeechBridge,
  isAndroidNativeSpeechAuthenticationError,
  isAndroidNativeSpeechHost,
  resolveAndroidSpeechCredentialStartMode,
  synchronizeAndroidSpeechCredential,
  type AndroidNativeSpeechEvent,
  type AndroidNativeSpeechRuntime,
} from '../platform/android/androidNativeSpeechRuntime';
import {
  isVoiceGenerationActive as isVoiceGenerationActiveSnapshot,
  isVoiceInputActive as isVoiceInputSnapshotActive,
  isVoiceInputContextCurrent as isVoiceInputSnapshotContextCurrent,
  isVoiceInputStartRetryableError,
  isVoiceInputStreamRetryableError,
  resolveVoiceCaptureReadyStatus,
  type VoiceInputRuntimeSnapshot,
} from '../features/speech/voiceInputFlow';
import {isSpeechErrorEvent, isSpeechTranscriptEvent} from '../features/speech/registrySpeechClient';
import {
  DEFAULT_SERVER_SETTINGS,
  normalizeServerSettings,
  type ServerSettings,
  type ServerSettingsUpdate,
} from '../settings/serverSettings';
import {prepareTextForTTS} from '../features/tts/prepareTextForTTS';
import {segmentText, ttsPlayer} from '../features/tts/ttsPlayback';
import type {TtsPlaybackState} from '../features/tts/ttsPlayback';
import {
  appDiagnosticStore,
  normalizeAppDiagnosticLogLevel,
} from '../debug/appDiagnostics';
import {drainNativeWebDiagnosticsToAppLog, setNativeDiagnosticLogLevel} from '../debug/nativeWebDiagnostics';
import {startWorkspaceDiagnosticSpan} from '../debug/workspaceDiagnostics';
import {
  formatVoiceInputDiagnosticError,
  logVoiceInputDiagnostic,
  type VoiceInputDiagnosticEntry,
  type VoiceInputDiagnosticLevel,
} from '../features/speech/voiceInputDiagnostics';
import {VoiceInputButton, type VoiceInputInteractionMode} from '../features/speech/VoiceInputButton';
import {VoiceRecordingBar} from '../features/speech/VoiceRecordingBar';
import { FileExplorerTree, WorkspaceProjectSelector } from '../file/FileExplorerTree';
import {
  buildFileSearchResultTree,
  flattenFileSearchResultTree,
  type FileSearchResultTreeNode,
} from '../file/fileSearchResultTree';
import {
  activePreviewTab,
  beginPreviewTabLoad,
  buildPreviewSearchMatches,
  closePreviewTab,
  cyclePreviewTabId,
  failPreviewTabLoad,
  isAttachmentPreviewTab,
  isFilePreviewTab,
  isPortRelayPreviewTab,
  isPromptDiffPreviewTab,
  openPreviewTab,
  previewRenderedTabs,
  previewSearchDocumentKey,
  previewWorkbenchSnapshotFromState,
  previewWorkbenchStateFromSnapshot,
  previewTabId,
  selectPreviewProject,
  selectPreviewTab,
  updatePreviewTab,
  updatePreviewTabAfterLoad,
  type AttachmentPreviewTab,
  type FilePreviewTab,
  type PreviewWorkbenchTab,
  type PreviewSearchMatch,
  type PromptDiffPreviewFile,
  type PromptDiffPreviewTab,
} from '../preview/previewWorkbenchState';
import {PreviewWorkbenchChrome} from '../preview/PreviewWorkbenchChrome';
import {
  fetchPreviewDirectoryEntries,
  togglePreviewDirectoryExpansion,
} from '../preview/previewDirectoryLoader';
import {
  jumpToPreviewLineNow,
  schedulePreviewLineJump,
} from '../preview/previewLineNavigation';
import {resolvePreviewFileLink} from '../preview/previewFileLink';
import { FilePreviewPane } from '../file/FilePreviewPane';
import { FileSurface } from '../file/FileSurface';
import { GitSurface } from '../git/GitSurface';
import { GitSidebar } from '../git/GitSidebar';
import {shouldLoadGitForRev} from '../git/gitRefreshPolicy';
import {
  buildWorkingTreeFiles,
  isHeavyGeneratedDiffPath,
  normalizeGitBranches,
  pickGitSelectedBranches,
  pickPreferredPath,
  splitPathForDisplay,
  type GitCommitPopoverState,
  type GitDiffSource,
  type WorkingTreeFileEntry,
} from '../git/gitView';
import {splitUnifiedDiffFileBlocks} from '../git/unifiedDiffFiles';
import { WorkspaceController } from '../workspace/WorkspaceController';
import { WorkspaceStore } from '../workspace/WorkspaceStore';
import {
  DESKTOP_SIDEBAR_WIDTH_DEFAULT,
  DESKTOP_SIDEBAR_WIDTH_MAX,
  DESKTOP_SIDEBAR_WIDTH_MIN,
  createWorkspaceUiState,
  sanitizeDesktopSidebarWidth,
  workspaceUiReducer,
  type WorkspaceUiStateValue,
} from '../shell/state/workspaceUiState';
import type {
  PersistedFloatingControlSide,
  WorkspaceDatabaseStorageStats,
} from '../workspace/WorkspacePersistence';
import {scrubLegacyBrowserCredentials} from '../compatibility/browserCredentialCleanup';
import type {
  RegistryChatContentBlock,
  RegistryChatMessage,
  RegistryChatMessageEventPayload,
  RegistryChatSession,
  RegistryArchivedSessionSummary,
  RegistrySessionArchiveReadResponse,
  RegistryResumableSession,
  RegistrySpeechCancelPayload,
  RegistrySpeechErrorEvent,
  RegistrySessionContentBlock,
  RegistrySessionConfigOption,
  RegistrySessionReadResponse,
  RegistrySessionPromptArtifact,
  RegistrySessionPromptArtifactFile,
  RegistrySessionSummary,
  RegistrySessionStatusResult,
  RegistrySessionUsage,
  RegistrySessionTurn,
  RegistryFsEntry,
  RegistryFsInfo,
  RegistryGitCommit,
  RegistryGitCommitFile,
  RegistryNpmHubSnapshot,
  RegistryNpmOperation,
  RegistryNpmPackage,
  RegistryHub,
  RegistryProject,
  RegistryPortRelaySnapshot,
  RegistrySkillCommandResponse,
  RegistrySkillDetail,
  RegistrySkillScope,
  RegistrySkillSourceCandidate,
  RegistryTokenScanResult,
  RegistryWheelMakerUpdateResponse,
  RegistrySpeechTranscriptEvent,
  RegistryFileIndexSearchResult,
  RegistryFileIndexStatus,
  RegistryFileIndexStatusResponse,
  RegistryTerminal,
  RegistryTerminalChangedEvent,
  RegistryTerminalOutputEvent,
  RegistryDeviceSession,
} from '../registry/registryTypes';

const RegistryDebugPanel = React.lazy(() => import('../debug/RegistryDebugPanel').then(module => ({
  default: module.RegistryDebugPanel,
})));
const loadSettingsBundle = () => import(/* webpackChunkName: "settings" */ '../settings/SettingsBundle');
const DebugLogsSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.DebugLogsSettingsDetail,
})));
const ConnectionStatusSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.ConnectionStatusSettingsDetail,
})));
const DeviceSessionsSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.DeviceSessionsSettingsDetail,
})));
const TokenStatsSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.TokenStatsSettingsDetail,
})));
const DatabaseSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.DatabaseSettingsDetail,
})));
const PortRelaySettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.PortRelaySettingsDetail,
})));
const UpdateSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.UpdateSettingsDetail,
})));
const SkillsSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.SkillsSettingsDetail,
})));
const SkillDetailPanel = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.SkillDetailPanel,
})));
const SettingsRootContent = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.SettingsRootContent,
})));

type Tab = 'chat' | 'file' | 'git';
type ThemeMode = 'dark' | 'light';
type FileResolvedIcon = {
  glyph: string;
  color: string;
};
type FileIconResources = {
  resolveSetiIcon: (name: string, mode: ThemeMode) => FileResolvedIcon;
  setiFontCss: () => string;
};
const FALLBACK_FILE_ICON: FileResolvedIcon = {glyph: '?', color: '#d4d7d6'};
let fileIconResourcesPromise: Promise<FileIconResources> | null = null;
const loadFileIconResources = () => {
  if (!fileIconResourcesPromise) {
    fileIconResourcesPromise = import(/* webpackChunkName: "file-icons" */ '../file/fileIcons').then(module => ({
      resolveSetiIcon: module.resolveSetiIcon,
      setiFontCss: module.setiFontFaceCss,
    }));
  }
  return fileIconResourcesPromise;
};
type DirEntries = Record<string, RegistryFsEntry[]>;
const EMPTY_DIR_ENTRIES: DirEntries = {'.': []};
type VoiceTransportMode = 'registry' | 'android-native';
type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: 'queued' | 'uploading' | 'failed' | 'completed';
  progress: number;
  file?: File;
  objectUrl?: string;
  block?: RegistryChatContentBlock;
  uploadId?: string;
  attachmentId?: string;
  error?: string;
};
type WideProjectActionMenuState = {
  projectId: string;
  kind: 'new' | 'resume';
  phase: 'agents' | 'sessions';
  agentType: string;
  popover?: WideProjectActionPopoverPlacement | null;
};
type MobileProjectActionMenuState = WideProjectActionMenuState;
type ProjectSessionActionMenuState = {
  projectId: string;
  sessionId: string;
  popover?: WideProjectActionPopoverPlacement | null;
};
type ChatQuickSwitchMenuPlacement =
  | {kind: 'mobile'}
  | {kind: 'desktop'; style: React.CSSProperties};
type SettingsDetailView = SettingsDetailId | null;
const WHEELMAKER_UPDATE_REMOTE_POLL_DELAY_MS = 1500;
type WheelMakerUpdateHubView = {
  hubId: string;
  loading: boolean;
  error: string;
  data: RegistryWheelMakerUpdateResponse | null;
};
type AgentPackageHubView = {
  hubId: string;
  loading: boolean;
  error: string;
  updatedAt: string;
  hub: RegistryNpmHubSnapshot | null;
  operation: RegistryNpmOperation | null;
};
type SkillHubView = {
  hubId: string;
  loading: boolean;
  error: string;
  data: RegistrySkillCommandResponse | null;
};
type SkillInstallTarget = {
  hubId: string;
  scope: RegistrySkillScope;
  projectName?: string;
};
type SkillDetailTarget = SkillInstallTarget & {
  skillName: string;
};
type SkillDetailCacheEntry = {
  loading: boolean;
  error: string;
  detail: RegistrySkillDetail | null;
};
type ChatComposerDraft = {
  text: string;
  tokens: ChatComposerToken[];
  attachments: ChatAttachment[];
};
type PendingChatPrompt = {
  sessionId: string;
  blocks: RegistryChatContentBlock[];
  createdAt: string;
  turnIndex: number;
  status: 'confirming' | 'undelivered';
  errorMessage?: string;
};
type SessionStatusDialogState = {
  projectId: string;
  sessionId: string;
  cachedUsage?: RegistrySessionUsage;
  status: RegistrySessionStatusResult | null;
  loading: boolean;
  error: string;
};
type FloatingDragState = {
  active: boolean;
  pressing: boolean;
  pointerId: number;
  originX: number;
  originY: number;
  startSide: PersistedFloatingControlSide;
  currentX: number;
  startTop: number;
  currentTop: number;
  cooldownUntil: number;
};
type PortRelayTargetMenuPressState = {
  pointerId: number;
  originX: number;
  originY: number;
  longPressed: boolean;
};
type GestureNavigationState = {
  phase: 'pressing' | 'neutral' | 'expanded';
  pointerId: number;
  originX: number;
  originY: number;
  currentX: number;
  currentY: number;
  startedAt: number;
};
type DesktopSidebarResizeState = {
  pointerId: number;
  originX: number;
  startWidth: number;
  currentWidth: number;
};
type ChatAttachmentThumbnailState = {
  src: string;
  loading: boolean;
  error: string;
};
type PreviewSelectionMenuState = {
  x: number;
  y: number;
  text: string;
};
type PreviewSelectionSnapshot = PreviewSelectionMenuState & {
  range: Range | null;
};

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as {name?: unknown}).name === 'AbortError'
  );
}

const LARGE_FILE_CONFIRM_BYTES = 2 * 1024 * 1024;
const ATTACHMENT_PREVIEW_MAX_SIZE = 20 * 1024 * 1024; // 20MB

type ThinkingBlockProps = {
  content: string;
  isStreaming: boolean;
};

function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [content, expanded]);

  // Auto-collapse when streaming finishes
  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setExpanded(false);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const summaryText = useMemo(() => {
    if (isStreaming) return '';
    const firstLine = content.split('\n').find(l => l.trim().length > 0) || '';
    return firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine;
  }, [content, isStreaming]);

  return (
    <div
      className={`thinking-block ${isStreaming ? 'streaming' : 'done'} ${
        expanded ? 'expanded' : ''
      }`}
    >
      <button
        className="thinking-header"
        onClick={() => !isStreaming && setExpanded(v => !v)}
        disabled={isStreaming}
        aria-expanded={expanded}
      >
        <span className="thinking-icon codicon codicon-sparkle" />
        {isStreaming ? (
          <span className="thinking-title streaming-text">
            Thinking
            <span className="thinking-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </span>
        ) : (
          <span className="thinking-title summary-text">{summaryText}</span>
        )}
        {!isStreaming && (
          <span
            className={`thinking-chevron codicon ${
              expanded ? 'codicon-chevron-up' : 'codicon-chevron-down'
            }`}
          />
        )}
      </button>
      <div
        className="thinking-body"
        style={{ maxHeight: expanded ? contentHeight + 16 : 0 }}
      >
        <div className="thinking-content" ref={contentRef}>
          {content}
        </div>
      </div>
    </div>
  );
}

const pwaFoundation = initializePWAFoundation();
const nativeShellHost = isNativeShellHost();
if (nativeShellHost) {
  cleanupNativeWebViewPWA().catch(() => undefined);
}
const registryDebugStore = createRegistryDebugStore();
const registryClientName = isAndroidNativeSpeechHost()
  ? 'wheelmaker-android'
  : getDesktopWindowBridge()
    ? 'wheelmaker-desktop'
    : 'wheelmaker-web';
const service = new RegistryWorkspaceService(registryDebugStore.recordCaptureEvent, {clientName: registryClientName});
scrubLegacyBrowserCredentials();
const workspaceStore = new WorkspaceStore();
const workspaceController = new WorkspaceController(service, workspaceStore);
const MAX_AUTO_RENDER_DIFF_CHARS = 200000;
const RECONNECT_RETRY_DELAY_MS = 1000;
const RECONNECT_GRACE_PERIOD_MS = 30_000;
const CHAT_NEW_DRAFT_SESSION_KEY = '__new__';
const CHAT_DRAFT_KEY_PROJECT_FALLBACK = '__no_project__';
const RECENT_SESSIONS_VIRTUAL_PROJECT_ID = '__recent_sessions__';
const CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD = 80;
const CHAT_KEYBOARD_INSET_SETTLE_DELAY_MS = 120;
const CHAT_PENDING_CONFIRM_TIMEOUT_MS = 5000;
const CHAT_ATTACHMENT_CHUNK_SIZE = 1024 * 1024;
const HUB_TREE_EMPTY_EXPANDED_SENTINEL = '__hub_tree_empty__';
function estimateSessionReadPayloadBytes(result: RegistrySessionReadResponse): number {
  try {
    return new TextEncoder().encode(JSON.stringify(result)).length;
  } catch {
    return 0;
  }
}

const fileMemoryCacheKey = (activeProjectId: string, path: string) => `${activeProjectId}\n${path}`;
const PROJECT_PIN_LONG_PRESS_MS = 450;
const PROJECT_SESSION_LONG_PRESS_MS = 450;
const DESKTOP_SIDEBAR_VIEWPORT_MAX_RATIO = 0.45;
const CHAT_FIXED_VIEW_WIDTH = 800;
const CHAT_FILE_PEEK_WIDTH_DEFAULT = 520;
const CHAT_FILE_PEEK_WIDTH_MIN = 360;
const CHAT_FILE_PEEK_WIDTH_MAX = 1520;
const CHAT_FILE_PEEK_VIEWPORT_MAX_RATIO = 0.8;
const CHAT_FILE_PEEK_MAIN_MIN_WIDTH = 420;
const CHAT_FILE_PEEK_HISTORY_KIND = 'wheelmaker:chat-file-peek';
const GESTURE_NAV_CANCELLED_CLICK_SUPPRESS_MS = 160;
const PORT_RELAY_TARGET_MENU_LONG_PRESS_MS = 200;
const PORT_RELAY_FLOATING_Y_RATIO_STORAGE_KEY = 'wheelmaker:portRelayFloatingYRatio';
const PORT_RELAY_FLOATING_SLOT_STORAGE_KEY = 'wheelmaker:portRelayFloatingSlot';
const PORT_RELAY_FLOATING_SIDE_STORAGE_KEY = 'wheelmaker:portRelayFloatingSide';
const PORT_RELAY_CLEAR_SITE_DATA_MESSAGE = 'wheelmaker:portRelaySiteDataCleared';
const PORT_RELAY_CLEAR_SITE_DATA_TIMEOUT_MS = 1200;
const PROJECT_INDEX_SCAN_CONCURRENCY = 2;
const CHAT_FILE_MENTION_SEARCH_LIMIT = 20;
const CHAT_FILE_MENTION_DEBOUNCE_MS = 140;
const EMPTY_CHAT_COMPOSER_DRAFT: ChatComposerDraft = { text: '', tokens: [], attachments: [] };
const EMPTY_CHAT_OPTION_REPLIES: ChatOptionReply[] = [];
const EMPTY_PREVIEW_WORKBENCH_TABS: FilePreviewTab[] = [];
const EMPTY_HIGHLIGHTED_LINES = new Set<number>();
const DEFAULT_PORT_RELAY_SNAPSHOT: RegistryPortRelaySnapshot = {ok: true, enabled: false, status: 'Disabled'};

function useStableEvent<T extends (...args: any[]) => any>(handler: T): T {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  return useCallback(((...args: Parameters<T>): ReturnType<T> => handlerRef.current(...args)) as T, []);
}

function relayOriginFromUrl(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function waitForPortRelaySiteDataClear(relayUrl: string): Promise<void> {
  const expectedOrigin = relayOriginFromUrl(relayUrl);
  return new Promise(resolve => {
    let finished = false;
    let timer: ReturnType<typeof window.setTimeout> | null = null;
    function finish() {
      if (finished) {
        return;
      }
      finished = true;
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
      window.removeEventListener('message', handleMessage);
      resolve();
    }
    function handleMessage(event: MessageEvent) {
      if (!expectedOrigin || event.origin !== expectedOrigin) {
        return;
      }
      const data = event.data as {type?: unknown} | null;
      if (!data || data.type !== PORT_RELAY_CLEAR_SITE_DATA_MESSAGE) {
        return;
      }
      finish();
    }
    window.addEventListener('message', handleMessage);
    timer = window.setTimeout(finish, PORT_RELAY_CLEAR_SITE_DATA_TIMEOUT_MS);
  });
}

function isRegistryChatContentBlock(block: RegistryChatContentBlock | undefined): block is RegistryChatContentBlock {
  return !!block && typeof block.type === 'string' && block.type.length > 0;
}

function isChatAttachmentUploadPending(attachment: ChatAttachment): boolean {
  return attachment.status === 'uploading';
}

function chatFileMentionName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized || 'file';
}

function isArrowNavigationKey(key: string): boolean {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
}

function chatComposerTokensEqual(left: ChatComposerToken[], right: ChatComposerToken[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => {
    const other = right[index];
    if (!other || item.type !== other.type) {
      return false;
    }
    if (item.type === 'text') {
      return other.type === 'text' && item.text === other.text;
    }
    if (item.type === 'skill') {
      return other.type === 'skill' &&
        item.command === other.command &&
        item.label === other.label;
    }
    return other.type === 'file' &&
      item.path === other.path &&
      item.name === other.name &&
      item.label === other.label;
  });
}

function chatComposerTokensFromText(text: string): ChatComposerToken[] {
  return text ? [{type: 'text', text}] : [];
}

function chatSlashCommandLabel(name: string): string {
  return name
    .replace(/^\//, '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function registryResourceLinkHasScheme(uri: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri.trim());
}

function isProjectFileMentionBlock(block: RegistryChatContentBlock): boolean {
  return block.type === 'resource_link' &&
    typeof block.uri === 'string' &&
    block.uri.trim().length > 0 &&
    !registryResourceLinkHasScheme(block.uri);
}

function projectFileIndexStatusLabel(status: string): string {
  switch (status) {
    case 'indexed':
      return 'Indexed';
    case 'scanning':
      return 'Scanning';
    case 'error':
      return 'Error';
    default:
      return 'Not indexed';
  }
}

function chatAttachmentPreviewSrc(attachment: ChatAttachment): string {
  if (attachment.objectUrl) {
    return attachment.objectUrl;
  }
  const data = attachment.block?.data;
  if (attachment.block?.type === 'image' && data) {
    return `data:${attachment.mimeType || 'image/png'};base64,${data}`;
  }
  return '';
}

function attachmentIdFromBlock(block: RegistryChatContentBlock | undefined): string {
  const uri = block?.uri || '';
  if (!uri) {
    return '';
  }
  const last = uri.split(/[\\/]/).pop() || '';
  const withoutQuery = last.split(/[?#]/)[0] || '';
  const withoutExtension = withoutQuery.replace(/\.[^.]+$/, '');
  return withoutExtension.startsWith('sha256-') ? withoutExtension : '';
}

function chatAttachmentBlockCacheKey(projectId: string, sessionId: string, block: RegistrySessionContentBlock): string {
  const attachmentId = attachmentIdFromBlock(block);
  const identity = attachmentId || block.uri || block.name || block.mimeType || 'attachment';
  return `${projectId}\u001f${sessionId}\u001f${identity}`;
}

function attachmentPreviewReadPayloadFromKey(tab: AttachmentPreviewTab): {sessionId: string; uri?: string; attachmentId?: string} | null {
  const identity = tab.attachmentKey.split('\u001f').pop() || '';
  if (!identity || identity === 'attachment') {
    return null;
  }
  if (identity.startsWith('sha256-')) {
    return {sessionId: tab.sessionId, attachmentId: identity};
  }
  if (identity.includes('/') || identity.includes('\\') || identity.includes(':')) {
    return {sessionId: tab.sessionId, uri: identity};
  }
  return null;
}

function attachmentBase64DataUrl(content: string, mimeType?: string): string {
  const normalizedMime = (mimeType || '').trim() || 'application/octet-stream';
  return content ? `data:${normalizedMime};base64,${content}` : '';
}

function revokeChatAttachmentObjectUrl(attachment: ChatAttachment): void {
  if (attachment.objectUrl) {
    URL.revokeObjectURL(attachment.objectUrl);
  }
}

function chatFilesFromDataTransferItems(items: DataTransferItemList | DataTransferItem[] | undefined | null): File[] {
  return Array.from(items ?? [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => !!file);
}

function chatFilesFromFileList(files: FileList | File[] | undefined | null): File[] {
  return Array.from(files ?? []).filter((file): file is File => !!file);
}

function chatFallbackAttachmentName(index: number): string {
  return `attachment-${index + 1}`;
}

function formatChatAttachmentSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B';
  }
  if (size < 1024) {
    return `${Math.round(size)} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read attachment chunk'));
    reader.readAsDataURL(blob);
  });
  return dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}

function buildChatDraftKey(activeProjectId: string, sessionId: string): string {
  const projectKey = activeProjectId.trim() || CHAT_DRAFT_KEY_PROJECT_FALLBACK;
  const sessionKey = sessionId.trim() || CHAT_NEW_DRAFT_SESSION_KEY;
  return `${projectKey}:${sessionKey}`;
}

function generatePortRelayAccessCode(): string {
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const value = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
    return String(value % 1_000_000).padStart(6, '0');
  }
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

function agentPackageActionForPackage(pkg: RegistryNpmPackage): 'install' | 'update' | 'uninstall' | null {
  if (pkg.canInstall) return 'install';
  if (pkg.canUpdate) return 'update';
  if (pkg.canUninstall) return 'uninstall';
  return null;
}

function agentPackageActionLabel(action: 'install' | 'update' | 'uninstall'): string {
  switch (action) {
    case 'update':
      return 'Update';
    case 'uninstall':
      return 'Uninstall';
    default:
      return 'Install';
  }
}

function skillActionPendingKey(input: {hubId: string; scope: RegistrySkillScope; projectName?: string; skillName?: string; action: string}): string {
  return [
    input.hubId,
    input.scope,
    input.projectName || '',
    input.skillName || '',
    input.action,
  ].join(':');
}

function sameSkillInstallTarget(left: SkillInstallTarget | null, right: SkillInstallTarget): boolean {
  return !!left &&
    left.hubId === right.hubId &&
    left.scope === right.scope &&
    (left.projectName || '') === (right.projectName || '');
}

function skillCommandErrorMessage(result: RegistrySkillCommandResponse): string {
  return result.errorSummary || result.message || 'Skill operation failed.';
}

function shortGitSha(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 7 ? trimmed.slice(0, 7) : trimmed || '-';
}

function wheelMakerBehindCopy(data: RegistryWheelMakerUpdateResponse | null): string {
  if (!data?.release) return 'Unknown';
  const behind = data.git?.behindCount ?? 0;
  if (behind <= 0) return 'Up to date';
  return `${behind} ${behind === 1 ? 'commit' : 'commits'} behind`;
}

function wheelMakerReleaseRef(data: RegistryWheelMakerUpdateResponse | null): string {
  const remote = data?.release?.remote || data?.git?.remote || 'origin';
  const branch = data?.release?.branch || data?.git?.branch || '';
  return branch ? `${remote}/${branch}` : remote;
}

function formatWheelMakerDateTime(value: string): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function androidApkUpdateStatusLabel(status: AndroidApkUpdateStatus): string {
  switch (status) {
    case 'up_to_date':
      return 'Up to date';
    case 'update_available':
      return 'Update available';
    default:
      return 'Unknown';
  }
}

function androidApkInstallStatusLabel(status: string): string {
  switch (status) {
    case 'permission_required':
      return 'Install permission required';
    case 'downloading':
      return 'Downloading APK';
    case 'downloaded':
      return 'APK downloaded';
    case 'installing':
      return 'Opening installer';
    case 'failed':
      return 'Install failed';
    default:
      return status;
  }
}

function clampFloatingTop(top: number, minTop: number, maxTop: number): number {
  return Math.min(maxTop, Math.max(minTop, top));
}

function isFloatingControlSide(value: unknown): value is PersistedFloatingControlSide {
  return value === 'left' || value === 'right';
}

function readPortRelayFloatingYRatio(): number | null {
  try {
    const value = window.localStorage.getItem(PORT_RELAY_FLOATING_Y_RATIO_STORAGE_KEY);
    if (value !== null) {
      return sanitizeFloatingControlYRatio(Number.parseFloat(value));
    }
  } catch {
    return null;
  }
  try {
    const value = window.localStorage.getItem(PORT_RELAY_FLOATING_SLOT_STORAGE_KEY);
    return floatingControlYRatioFromLegacySlot(value);
  } catch {
    return null;
  }
}

function readPortRelayFloatingSide(): PersistedFloatingControlSide | null {
  try {
    const value = window.localStorage.getItem(PORT_RELAY_FLOATING_SIDE_STORAGE_KEY);
    return isFloatingControlSide(value) ? value : null;
  } catch {
    return null;
  }
}

function readPromptCompletionNotificationTarget(): ChatSessionKey | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const url = new URL(window.location.href);
  const searchParams = url.searchParams;
  const projectId = searchParams.get('wmProjectId')?.trim() ?? '';
  const sessionId = searchParams.get('wmSessionId')?.trim() ?? '';
  return chatSessionKeyFromParts(projectId, sessionId);
}

function clearPromptCompletionNotificationTargetFromUrl(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  const searchParams = url.searchParams;
  if (!searchParams.has('wmProjectId') && !searchParams.has('wmSessionId')) {
    return;
  }
  searchParams.delete('wmProjectId');
  searchParams.delete('wmSessionId');
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

const AGENT_TAG_VARIANT_INDEX: Record<string, number> = {
  codex: 0,
  copilot: 1,
  claude: 2,
  opencode: 3,
  codebuddy: 4,
  mimo: 5,
  flicker: 8,
};

function normalizeAgentTypeName(value?: string | null): string {
  return (value || '').trim();
}

function tagVariantClass(prefix: string, value: string): string {
  const normalized = normalizeAgentTypeName(value).toLowerCase();
  if (prefix === 'wide-project-hub' || prefix === 'token-stats-pill-hub') {
    return `${prefix}-${resolveHubColorVariantIndex(normalized)}`;
  }
  if (prefix === 'wide-session-agent' || prefix === 'token-stats-pill-agent') {
    const explicitIndex = AGENT_TAG_VARIANT_INDEX[normalized];
    if (typeof explicitIndex === 'number') {
      return `${prefix}-${explicitIndex}`;
    }
  }

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return `${prefix}-${hash % 8}`;
}

function projectHubId(project: Pick<RegistryProject, 'hubId'>): string {
  return project.hubId || 'local';
}

function sortChatSessions(items: RegistryChatSession[]): RegistryChatSession[] {
  return [...items].sort((a, b) => compareUpdatedAtDesc(a.updatedAt || '', b.updatedAt || ''));
}

function mergeChatSession(
  list: RegistryChatSession[],
  next: Partial<RegistryChatSession> & {sessionId: string},
): RegistryChatSession[] {
  const existing = list.find(item => item.sessionId === next.sessionId);
  const merged: RegistryChatSession = {
    sessionId: next.sessionId,
    title: next.title ?? existing?.title ?? '',
    preview: next.preview ?? existing?.preview ?? '',
    updatedAt: next.updatedAt ?? existing?.updatedAt ?? '',
    messageCount: next.messageCount ?? existing?.messageCount ?? 0,
    unreadCount: next.unreadCount ?? existing?.unreadCount,
    agentType: next.agentType ?? existing?.agentType,
    latestTurnIndex: next.latestTurnIndex ?? existing?.latestTurnIndex,
    running: next.running ?? existing?.running,
    lastDoneTurnIndex: next.lastDoneTurnIndex ?? existing?.lastDoneTurnIndex,
    lastDoneSuccess: next.lastDoneSuccess ?? existing?.lastDoneSuccess,
    lastReadTurnIndex: next.lastReadTurnIndex ?? existing?.lastReadTurnIndex,
    configOptions:
      next.configOptions ??
      (existing?.configOptions
        ? [...existing.configOptions]
        : undefined),
    commands:
      next.commands ??
      (existing?.commands
        ? [...existing.commands]
        : undefined),
    usage:
      next.usage ??
      (existing?.usage ? { ...existing.usage } : undefined),
    sessionActions:
      next.sessionActions ??
      existing?.sessionActions,
  };
  const filtered = list.filter(item => item.sessionId !== next.sessionId);
  return sortChatSessions([merged, ...filtered]);
}

function mergeProjectSessionMap(
  map: Record<string, RegistryChatSession[]>,
  projectId: string,
  session: Partial<RegistryChatSession> & {sessionId: string},
): Record<string, RegistryChatSession[]> {
  if (!projectId || !session.sessionId) {
    return map;
  }
  return {
    ...map,
    [projectId]: mergeChatSession(map[projectId] ?? [], session),
  };
}

function mergeKnownChatSessions(
  left: RegistryChatSession[],
  right: RegistryChatSession[],
): RegistryChatSession[] {
  let merged = left;
  for (const session of right) {
    merged = mergeChatSession(merged, session);
  }
  return merged;
}


function chatMessageDomKey(message: Pick<RegistryChatMessage, 'sessionId' | 'turnIndex'>): string {
  return `${message.sessionId}:${message.turnIndex}`;
}

function nextPromptTurnIndex(messages: RegistryChatMessage[]): number {
  return Math.max(
    0,
    ...messages.map(message => Math.max(0, Math.trunc(message.turnIndex ?? 0))),
  ) + 1;
}

function buildPendingPromptMessage(prompt: PendingChatPrompt): RegistryChatMessage {
  return {
    sessionId: prompt.sessionId,
    turnIndex: prompt.turnIndex,
    method: 'prompt_request',
    param: {
      contentBlocks: prompt.blocks,
      createdAt: prompt.createdAt,
      pendingStatus: prompt.status,
      message: prompt.errorMessage,
    },
    finished: false,
  };
}

function isPromptStartMessage(message: RegistryChatMessage): boolean {
  return message.method === 'prompt_request' || message.method === 'user_message_chunk';
}

// -- Message accessor helpers (all derived from method + param) --

function msgRole(method: string): string {
  switch (method) {
    case 'prompt_request':
    case 'user_message_chunk':
      return 'user';
    case 'prompt_done':
    case 'tool_call':
    case 'system':
      return 'system';
    default:
      return 'assistant';
  }
}

function msgKind(method: string): string {
  switch (method) {
    case 'prompt_done':
      return 'prompt_result';
    case 'agent_thought_chunk':
      return 'thought';
    case 'tool_call':
      return 'tool';
    default:
      return 'message';
  }
}

function extractTextFromACPContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const chunks: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.text === 'string' && entry.text.trim()) {
      chunks.push(entry.text.trim());
    }
  }
  return chunks.join('\n').trim();
}

function extractTextFromSessionTurnParam(param: unknown): string {
  if (typeof param === 'string') {
    return param.trim();
  }
  if (Array.isArray(param)) {
    const chunks = param
      .map(item => {
        if (!item || typeof item !== 'object') return '';
        const entry = item as Record<string, unknown>;
        return typeof entry.content === 'string' ? entry.content.trim() : '';
      })
      .filter(Boolean);
    return chunks.join('\n').trim();
  }
  if (!param || typeof param !== 'object') {
    return '';
  }
  const input = param as Record<string, unknown>;
  if (typeof input.text === 'string') {
    return input.text.trim();
  }
  if (typeof input.output === 'string') {
    return input.output.trim();
  }
  if (typeof input.cmd === 'string') {
    return input.cmd.trim();
  }
  if (Array.isArray(input.contentBlocks)) {
    return extractTextFromACPContent(input.contentBlocks);
  }
  return '';
}

function msgText(method: string, param: Record<string, unknown>): string {
  if (method === 'prompt_request') {
    const blocks = Array.isArray(param.contentBlocks) ? param.contentBlocks : [];
    return extractTextFromACPContent(blocks);
  }
  if (method === 'prompt_done') {
    return typeof param.stopReason === 'string' ? param.stopReason : '';
  }
  return extractTextFromSessionTurnParam(param);
}

function summarizeChatTitlePrompt(text: string, fallback: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > 96 ? `${normalized.slice(0, 95)}...` : normalized;
}

function msgBlocks(
  method: string,
  param: Record<string, unknown>,
): RegistrySessionContentBlock[] {
  if (Array.isArray(param.contentBlocks)) {
    return param.contentBlocks as RegistrySessionContentBlock[];
  }
  if (method === 'prompt_request') {
    return [];
  }
  return [];
}

function chatConfigCurrentValue(option: RegistrySessionConfigOption): string {
  const optionValues = option.options ?? [];
  return option.currentValue || optionValues[0]?.value || '';
}

function chatConfigCurrentLabel(option: RegistrySessionConfigOption): string {
  const currentValue = chatConfigCurrentValue(option);
  const optionValues = option.options ?? [];
  const currentOption = optionValues.find(item => item.value === currentValue);
  return currentOption?.name || currentValue || option.name || option.id;
}

function decodeSessionMessageFromEventPayload(
  payload: RegistryChatMessageEventPayload,
): RegistryChatMessage | null {
  const normalized = normalizeSessionMessagePayload(payload);
  if (!normalized) return null;
  return decodeSessionTurnToMessage(normalized.sessionId, normalized.turn);
}

function groupImageBlocks(msgs: RegistryChatMessage[]): RegistrySessionContentBlock[] {
  const blocks: RegistrySessionContentBlock[] = [];
  for (const m of msgs) {
    for (const b of msgBlocks(m.method, m.param)) {
      if (b.type === 'image' && b.data) {
        blocks.push(b);
      }
    }
  }
  return blocks;
}

function groupPromptAttachmentBlocks(msgs: RegistryChatMessage[]): RegistrySessionContentBlock[] {
  const blocks: RegistrySessionContentBlock[] = [];
  for (const m of msgs) {
    for (const b of msgBlocks(m.method, m.param)) {
      if (isPromptAttachmentContentBlock(b)) {
        blocks.push(b);
      }
    }
  }
  return blocks;
}

async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

function shouldRenderChatTurn(
  message: RegistryChatMessage,
  hideToolCalls: boolean,
  promptStatus: ChatPromptStatus,
): boolean {
  const text = msgText(message.method, message.param).trim();
  if (message.method === 'prompt_request' || message.method === 'user_message_chunk') {
    return !!text ||
      !!promptStatus ||
      groupImageBlocks([message]).length > 0 ||
      groupPromptAttachmentBlocks([message]).length > 0;
  }
  if (message.method === 'prompt_done') {
    return true;
  }
  if (message.method === 'session_operation') {
    return true;
  }
  if (message.method === 'agent_plan') {
    return false;
  }
  const kind = msgKind(message.method);
  if (kind === 'tool') {
    return !hideToolCalls && !!text;
  }
  if (kind === 'thought') {
    return !!text;
  }
  return !!text;
}

function formatChatTimestamp(value: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function clampCodeFontSize(value: number): number {
  return Math.min(
    20,
    Math.max(11, Number.isFinite(value) ? value : DEFAULT_CODE_FONT_SIZE),
  );
}

function clampCodeLineHeight(value: number): number {
  return Math.min(
    2,
    Math.max(1.2, Number.isFinite(value) ? value : DEFAULT_CODE_LINE_HEIGHT),
  );
}

function clampCodeTabSize(value: number): number {
  return Math.min(
    8,
    Math.max(1, Number.isFinite(value) ? value : DEFAULT_CODE_TAB_SIZE),
  );
}

function sortEntries(entries: RegistryFsEntry[]): RegistryFsEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') return -1;
    if (a.kind !== 'dir' && b.kind === 'dir') return 1;
    return a.name.localeCompare(b.name);
  });
}

function previewFileAncestorDirs(path: string): string[] {
  const parts = path.replace(/\\/g, '/').replace(/^\.?\//, '').split('/').filter(Boolean);
  const dirs: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    dirs.push(parts.slice(0, index).join('/'));
  }
  return dirs;
}

function getFileExtension(path: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match ? match[1].toLowerCase() : '';
}

function isMarkdownPath(path: string): boolean {
  const ext = getFileExtension(path);
  return ext === 'md' || ext === 'markdown';
}

function isHtmlPath(path: string): boolean {
  const ext = getFileExtension(path);
  return ext === 'html' || ext === 'htm';
}

function detectCodeLanguage(path: string): string {
  const ext = getFileExtension(path);
  switch (ext) {
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'tsx';
    case 'js':
    case 'cjs':
    case 'mjs':
      return 'javascript';
    case 'jsx':
      return 'jsx';
    case 'json':
      return 'json';
    case 'go':
      return 'go';
    case 'c':
      return 'c';
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'h':
    case 'hh':
    case 'hpp':
      return 'cpp';
    case 'rs':
      return 'rust';
    case 'sh':
    case 'bash':
      return 'shellscript';
    case 'ps1':
    case 'psm1':
      return 'powershell';
    case 'py':
      return 'python';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'diff':
    case 'patch':
      return 'diff';
    case 'html':
      return 'markup';
    default:
      return 'clike';
  }
}

function inferImageMimeType(path: string): string {
  const ext = getFileExtension(path);
  switch (ext) {
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'ico':
      return 'image/x-icon';
    case 'avif':
      return 'image/avif';
    default:
      return '';
  }
}

function isImageFile(path: string, mimeType?: string): boolean {
  const normalizedMime = (mimeType || '').trim().toLowerCase();
  if (normalizedMime.startsWith('image/')) {
    return true;
  }
  return inferImageMimeType(path) !== '';
}

function createChatFilePeekHistoryState(): {kind: typeof CHAT_FILE_PEEK_HISTORY_KIND} {
  return {kind: CHAT_FILE_PEEK_HISTORY_KIND};
}

function isChatFilePeekHistoryState(value: unknown): value is {kind: typeof CHAT_FILE_PEEK_HISTORY_KIND} {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as {kind?: unknown}).kind === CHAT_FILE_PEEK_HISTORY_KIND
  );
}

function encodeUtf8ToBase64(value: string): string {
  try {
    if (typeof TextEncoder !== 'undefined') {
      const bytes = new TextEncoder().encode(value);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
  } catch {
    // fallback below
  }
  return btoa(unescape(encodeURIComponent(value)));
}

function buildImageDataUrl(params: {
  content: string;
  path: string;
  mimeType?: string;
  isBinary?: boolean;
}): string {
  const { content, path, mimeType, isBinary } = params;
  if (!content) {
    return '';
  }
  const inferredMime = inferImageMimeType(path);
  const normalizedMime = inferredMime || (mimeType || '').trim() || 'image/png';
  if (isBinary) {
    return `data:${normalizedMime};base64,${content}`;
  }
  return `data:${normalizedMime};base64,${encodeUtf8ToBase64(content)}`;
}
function parseTrailingLineNumber(value: string): number | null {
  const input = value.trim();
  if (!input) return null;
  const hashMatch = /#L(\d+)(?:C\d+)?$/i.exec(input);
  if (hashMatch) {
    const line = Number.parseInt(hashMatch[1], 10);
    return Number.isFinite(line) && line > 0 ? line : null;
  }
  const suffixMatch = /:(\d+)(?::\d+)?$/.exec(input);
  if (suffixMatch) {
    const line = Number.parseInt(suffixMatch[1], 10);
    return Number.isFinite(line) && line > 0 ? line : null;
  }
  return null;
}

function collectReactText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(item => collectReactText(item)).join('');
  }
  if (React.isValidElement(node)) {
    return collectReactText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}
function readSafeAreaTopInset(): number {
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue('--wm-safe-area-top');
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readSafeAreaBottomInset(): number {
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue('--wm-safe-area-bottom');
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCompactRelativeAge(value: string): string {
  if (!value) return '0m';
  const parsed = new Date(value);
  const ts = parsed.getTime();
  if (Number.isNaN(ts)) return '0m';
  const deltaMs = Math.max(0, Date.now() - ts);
  const deltaMin = Math.floor(deltaMs / 60000);
  if (deltaMin < 60) return `${Math.max(0, deltaMin)}m`;
  const deltaHour = Math.floor(deltaMin / 60);
  if (deltaHour < 24) return `${deltaHour}h`;
  const deltaDay = Math.floor(deltaHour / 24);
  if (deltaDay < 30) return `${deltaDay}d`;
  const deltaMonth = Math.floor(deltaDay / 30);
  if (deltaMonth < 12) return `${deltaMonth}mo`;
  const deltaYear = Math.floor(deltaMonth / 12);
  return `${deltaYear}y`;
}

type MarkdownImageExportRequest = {
  id: number;
  content: string;
  fileName: string;
  userActionToken?: string;
};

type MarkdownImageExportSurfaceProps = {
  request: MarkdownImageExportRequest;
  exportMode: MarkdownImageExportMode;
  markdownComponents: Components;
  markdownUrlTransform: (value: string) => string;
  onComplete: (result: ResponseImageOutputResult) => void;
  onRenderError: (message: string) => void;
  onShareError: (message: string) => void;
};

const MarkdownImageExportSurface = React.memo(function MarkdownImageExportSurface({
  request,
  exportMode,
  markdownComponents,
  markdownUrlTransform,
  onComplete,
  onRenderError,
  onShareError,
}: MarkdownImageExportSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const markdownCapabilities = useMarkdownCapabilityPlugins(request.content);
  const markdownImageExportWidth = resolveMarkdownImageExportWidth(exportMode);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const surface = surfaceRef.current;
      if (!surface) {
        return;
      }
      let blob: Blob;
      try {
        const backgroundColor = getComputedStyle(surface).backgroundColor || '#ffffff';
        blob = await renderMarkdownElementToPngBlob(surface, {
          backgroundColor,
        });
      } catch (err) {
        if (!cancelled) {
          onRenderError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (cancelled) {
        return;
      }
      try {
        const result = await outputResponseImage({
          blob,
          fileName: request.fileName,
          userActionToken: request.userActionToken,
        });
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          onShareError(result.error || result.status);
          return;
        }
        onComplete(result);
      } catch (err) {
        if (!cancelled) {
          onShareError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    request.id,
    request.fileName,
    exportMode,
    markdownComponents,
    markdownUrlTransform,
    onComplete,
    onRenderError,
    onShareError,
  ]);

  return (
    <div
      className="markdown-image-export-host"
      data-export-mode={exportMode}
      style={{'--markdown-image-export-width': `${markdownImageExportWidth}px`} as React.CSSProperties}
      aria-hidden="true"
    >
      <div
        ref={surfaceRef}
        className="markdown-image-export-surface markdown-preview"
        data-markdown-export-pending={markdownCapabilities.pending ? 'true' : undefined}
      >
        <ReactMarkdown
          remarkPlugins={markdownCapabilities.remarkPlugins}
          urlTransform={markdownUrlTransform}
          rehypePlugins={markdownCapabilities.rehypePlugins}
          components={markdownComponents}
        >
          {request.content}
        </ReactMarkdown>
      </div>
    </div>
  );
});

function promptArtifactPreviewTitle(fileCount: number): string {
  return `Diff · ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
}

function promptArtifactPromptSummary(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > 48 ? `${normalized.slice(0, 45)}...` : normalized;
}

function normalizePromptArtifactPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function buildPromptArtifactPreviewFiles(
  artifact: RegistrySessionPromptArtifact,
  content: string,
  initialExpandedPath: string | null,
): PromptDiffPreviewFile[] {
  const blocks = splitUnifiedDiffFileBlocks(content);
  const blocksByPath = new Map(
    blocks.map(block => [normalizePromptArtifactPath(block.path), block]),
  );
  const metadataFiles = artifact.files && artifact.files.length > 0
    ? artifact.files
    : blocks.map(block => ({
        path: block.path,
        status: 'M',
        additions: 0,
        deletions: 0,
      }));
  const initialPath = initialExpandedPath
    ? normalizePromptArtifactPath(initialExpandedPath)
    : '';
  const files = metadataFiles.map((file, index) => {
    const normalizedPath = normalizePromptArtifactPath(file.path);
    const block = blocksByPath.get(normalizedPath) ?? blocks[index] ?? null;
    return {
      ...file,
      diff: block?.diff ?? '',
      expanded: initialPath ? normalizedPath === initialPath : index === 0,
    };
  });
  if (files.length === 0 && content.trim()) {
    return [{
      path: 'Prompt diff',
      status: 'M',
      additions: 0,
      deletions: 0,
      diff: content,
      expanded: true,
    }];
  }
  if (files.length > 0 && !files.some(file => file.expanded)) {
    files[0] = {...files[0], expanded: true};
  }
  return files;
}

function promptArtifactPreviewCountLabel(fileCount: number): string {
  return `${fileCount} changed ${fileCount === 1 ? 'file' : 'files'}`;
}

type ChatFilePeekViewerProps = {
  peek: FilePreviewTab | null;
  mode: 'desktop' | 'mobile';
  tabs: FilePreviewTab[];
  treeOpen: boolean;
  themeMode: 'dark' | 'light';
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  wrapLines: boolean;
  showLineNumbers: boolean;
  highlightedLines: Set<number>;
  onLineClick?: (line: number, event: MouseEvent) => void;
  onClose: () => void;
  onCopyPath: () => void;
  onOpenInFileTab: () => void;
  onTabSelect: (path: string) => void;
  onTabClose: (path: string) => void;
  onToggleTree: () => void;
  treeContent: React.ReactNode;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

const ChatFilePeekViewer = React.memo(function ChatFilePeekViewer({
  peek,
  mode,
  tabs,
  treeOpen,
  themeMode,
  codeTheme,
  codeFont,
  codeFontSize,
  codeLineHeight,
  codeTabSize,
  wrapLines,
  showLineNumbers,
  highlightedLines,
  onLineClick,
  onClose,
  onCopyPath,
  onOpenInFileTab,
  onTabSelect,
  onTabClose,
  onToggleTree,
  treeContent,
  scrollRef,
}: ChatFilePeekViewerProps) {
  let body: React.ReactNode;
  if (!peek) {
    body = (
      <div className="chat-file-workbench-empty">
        <span className="codicon codicon-files" aria-hidden="true" />
        <span>No file selected</span>
      </div>
    );
  } else if (peek.loading) {
    body = <div className="muted block">Loading file...</div>;
  } else if (peek.error) {
    body = (
      <div className="chat-file-peek-error" role="alert">
        <span className="codicon codicon-error" />
        <span>{peek.error || 'Failed to load file'}</span>
      </div>
    );
  } else if (isImageFile(peek.path, peek.info?.mimeType)) {
    const imageSrc = buildImageDataUrl({
      content: peek.content,
      path: peek.path,
      mimeType: peek.info?.mimeType,
      isBinary: peek.info?.isBinary,
    });
    body = imageSrc ? (
      <div className="file-image-preview-wrap chat-file-peek-image-wrap">
        <img
          className="file-image-preview"
          src={imageSrc}
          alt={peek.path.split('/').pop() || 'image preview'}
        />
      </div>
    ) : (
      <div className="muted block">Image content is unavailable.</div>
    );
  } else if (isMarkdownPath(peek.path)) {
    body = (
      <MarkdownPreview
        content={peek.content}
        themeMode={themeMode}
        codeTheme={codeTheme}
        codeFont={codeFont}
        codeFontSize={codeFontSize}
        codeLineHeight={codeLineHeight}
        codeTabSize={codeTabSize}
        wrap={wrapLines}
        lineNumbers={showLineNumbers}
        targetLine={peek.targetLine}
      />
    );
  } else if (isHtmlPath(peek.path)) {
    body = (
      <HtmlPreview
        content={peek.content}
        targetLine={peek.targetLine}
      />
    );
  } else {
    body = (
      <ShikiCodeBlock
        content={peek.content}
        language={detectCodeLanguage(peek.path)}
        wrap={false}
        lineNumbers={true}
        themeMode={themeMode}
        codeTheme={codeTheme}
        codeFont={codeFont}
        codeFontSize={codeFontSize}
        codeLineHeight={codeLineHeight}
        codeTabSize={codeTabSize}
        highlightedLines={highlightedLines}
        onLineClick={onLineClick}
      />
    );
  }

  return <>{body}</>;
}, (prev, next) => {
  const p = prev.peek;
  const n = next.peek;
  return (
    p?.path === n?.path &&
    p?.targetLine === n?.targetLine &&
    p?.content === n?.content &&
    p?.loading === n?.loading &&
    p?.error === n?.error &&
    prev.mode === next.mode &&
    prev.tabs === next.tabs &&
    prev.treeOpen === next.treeOpen &&
    prev.themeMode === next.themeMode &&
    prev.codeTheme === next.codeTheme &&
    prev.codeFont === next.codeFont &&
    prev.codeFontSize === next.codeFontSize &&
    prev.codeLineHeight === next.codeLineHeight &&
    prev.codeTabSize === next.codeTabSize &&
    prev.wrapLines === next.wrapLines &&
    prev.showLineNumbers === next.showLineNumbers &&
    prev.highlightedLines === next.highlightedLines
  );
});

const ChatEmptyPreviewViewer = React.memo(function ChatEmptyPreviewViewer({
  mode,
  onClose,
}: {
  mode: 'desktop' | 'mobile';
  onClose: () => void;
}) {
  return (
    <div className={`chat-file-peek-surface chat-empty-preview-surface ${mode}`} aria-label="Chat preview">
      <div className="chat-preview-toolbar">
        <button
          type="button"
          className="chat-preview-icon-button"
          onClick={onClose}
          title={mode === 'mobile' ? 'Back' : 'Close preview'}
          aria-label={mode === 'mobile' ? 'Back' : 'Close preview'}
        >
          <span className={`codicon ${mode === 'mobile' ? 'codicon-arrow-left' : 'codicon-close'}`} />
        </button>
        <div className="chat-preview-title" title="Preview">Preview</div>
      </div>
      <div className="chat-empty-preview-body">
        <span className="codicon codicon-layout-sidebar-right" aria-hidden="true" />
        <span className="chat-empty-preview-copy">No preview selected</span>
      </div>
    </div>
  );
});

type ChatAttachmentPreviewViewerProps = {
  preview: AttachmentPreviewTab;
  mode: 'desktop' | 'mobile';
  onClose: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  themeMode: 'dark' | 'light';
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  wrapLines: boolean;
  showLineNumbers: boolean;
  highlightedLines: Set<number>;
  onLineClick?: (line: number, event: MouseEvent) => void;
};

const ChatAttachmentPreviewViewer = React.memo(function ChatAttachmentPreviewViewer({
  preview,
  mode,
  onClose,
  scrollRef,
  themeMode,
  codeTheme,
  codeFont,
  codeFontSize,
  codeLineHeight,
  codeTabSize,
  wrapLines,
  showLineNumbers,
  highlightedLines,
  onLineClick,
}: ChatAttachmentPreviewViewerProps) {
  let body: React.ReactNode;
  if (preview.loading) {
    body = <div className="muted block">Loading attachment...</div>;
  } else if (preview.error) {
    body = (
      <div className="chat-file-peek-error" role="alert">
        <span className="codicon codicon-error" />
        <span>{preview.error}</span>
      </div>
    );
  } else if (preview.kind === 'image' && preview.src) {
    body = (
      <div className="chat-attachment-original-wrap">
        <img
          className="chat-attachment-original-image"
          src={preview.src}
          alt={preview.title}
        />
      </div>
    );
  } else if (preview.content === undefined && preview.isBinary === false) {
    body = (
      <div className="chat-file-peek-error" role="alert">
        <span className="codicon codicon-error" />
        <span>Failed to decode file content (UTF-8 expected).</span>
      </div>
    );
  } else if (preview.content !== undefined) {
    const fileName = preview.title || 'attachment';
    if (isMarkdownPath(fileName)) {
      body = (
        <MarkdownPreview
          content={preview.content}
          themeMode={themeMode}
          codeTheme={codeTheme}
          codeFont={codeFont}
          codeFontSize={codeFontSize}
          codeLineHeight={codeLineHeight}
          codeTabSize={codeTabSize}
          wrap={wrapLines}
          lineNumbers={showLineNumbers}
        />
      );
    } else if (isHtmlPath(fileName)) {
      body = (
        <HtmlPreview
          content={preview.content}
        />
      );
    } else {
      body = (
        <ShikiCodeBlock
          content={preview.content}
          language={detectCodeLanguage(fileName)}
          wrap={false}
          lineNumbers={true}
          themeMode={themeMode}
          codeTheme={codeTheme}
          codeFont={codeFont}
          codeFontSize={codeFontSize}
          codeLineHeight={codeLineHeight}
          codeTabSize={codeTabSize}
          highlightedLines={highlightedLines}
          onLineClick={onLineClick}
        />
      );
    }
  } else {
    body = (
      <div className="chat-attachment-preview-placeholder">
        <span className="codicon codicon-file" aria-hidden="true" />
        <div className="chat-attachment-preview-placeholder-main">
          <div className="chat-attachment-preview-placeholder-title">{preview.title}</div>
          {preview.meta ? (
            <div className="chat-attachment-preview-placeholder-meta">{preview.meta}</div>
          ) : null}
          <div className="chat-attachment-preview-placeholder-status">Preview is being implemented.</div>
        </div>
      </div>
    );
  }

  return <>{body}</>;
}, (prev, next) => (
  prev.preview === next.preview &&
  prev.mode === next.mode &&
  prev.themeMode === next.themeMode &&
  prev.codeTheme === next.codeTheme &&
  prev.codeFont === next.codeFont &&
  prev.codeFontSize === next.codeFontSize &&
  prev.codeLineHeight === next.codeLineHeight &&
  prev.codeTabSize === next.codeTabSize &&
  prev.wrapLines === next.wrapLines &&
  prev.showLineNumbers === next.showLineNumbers &&
  prev.highlightedLines === next.highlightedLines
));

type ChatPromptArtifactPreviewViewerProps = {
  preview: PromptDiffPreviewTab;
  mode: 'desktop' | 'mobile';
  themeMode: 'dark' | 'light';
  codeTheme: CodeThemeId;
  codeFont: CodeFontId;
  codeFontFamily: string;
  codeFontSize: number;
  codeLineHeight: number;
  codeTabSize: number;
  onClose: () => void;
  onToggleFile: (path: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

const ChatPromptArtifactPreviewViewer = React.memo(function ChatPromptArtifactPreviewViewer({
  preview,
  mode,
  themeMode,
  codeTheme,
  codeFont,
  codeFontFamily,
  codeFontSize,
  codeLineHeight,
  codeTabSize,
  onClose,
  onToggleFile,
  scrollRef,
}: ChatPromptArtifactPreviewViewerProps) {
  let body: React.ReactNode;
  if (preview.loading) {
    body = <div className="muted block">Loading diff...</div>;
  } else if (preview.error) {
    body = (
      <div className="chat-file-peek-error" role="alert">
        <span className="codicon codicon-error" />
        <span>{preview.error}</span>
      </div>
    );
  } else if (preview.files.length === 0) {
    body = <div className="muted block">No diff available</div>;
  } else {
    body = (
      <div className="chat-prompt-diff-preview">
        <div className="chat-prompt-diff-overview">
          <span className="codicon codicon-diff" aria-hidden="true" />
          <span>{promptArtifactPreviewCountLabel(preview.files.length)}</span>
        </div>
        {preview.files.map(file => {
          const {fileName, parentPath} = splitPathForDisplay(file.path);
          return (
            <section
              key={file.path}
              className={`chat-prompt-diff-file${file.expanded ? ' expanded' : ''}`}
              data-preview-diff-path={file.path}
            >
              <button
                type="button"
                className="chat-prompt-diff-file-header"
                onClick={() => onToggleFile(file.path)}
                aria-expanded={file.expanded}
                title={file.path}
              >
                <span className={`codicon ${file.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" />
                <span className={`chat-prompt-artifact-file-status status-${file.status.toLowerCase()}`}>
                  {file.status}
                </span>
                <span className="chat-prompt-diff-file-title">
                  <span className="chat-prompt-diff-file-name">{fileName || file.path}</span>
                  {parentPath ? <span className="chat-prompt-diff-file-path">{parentPath}</span> : null}
                </span>
                <span className="chat-prompt-diff-file-counts">
                  {file.additions > 0 ? <span className="additions">+{file.additions}</span> : null}
                  {file.deletions > 0 ? <span className="deletions">-{file.deletions}</span> : null}
                </span>
              </button>
              {file.expanded ? (
                <div className="chat-prompt-diff-file-body">
                  {file.diff ? (
                    <ShikiDiffPane
                      content={file.diff}
                      language={detectCodeLanguage(file.path)}
                      wrap={false}
                      lineNumbers={true}
                      themeMode={themeMode}
                      codeTheme={codeTheme}
                      codeFont={codeFont}
                      codeFontFamily={codeFontFamily}
                      codeFontSize={codeFontSize}
                      codeLineHeight={codeLineHeight}
                      codeTabSize={codeTabSize}
                    />
                  ) : (
                    <div className="muted block">File diff unavailable</div>
                  )}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    );
  }

  return <>{body}</>;
}, (prev, next) => (
  prev.preview === next.preview &&
  prev.mode === next.mode &&
  prev.themeMode === next.themeMode &&
  prev.codeTheme === next.codeTheme &&
  prev.codeFont === next.codeFont &&
  prev.codeFontFamily === next.codeFontFamily &&
  prev.codeFontSize === next.codeFontSize &&
  prev.codeLineHeight === next.codeLineHeight &&
  prev.codeTabSize === next.codeTabSize
));

export function App() {
  const persistedGlobal = useMemo(() => workspaceStore.getGlobalState(), []);
  const registryEndpoints = useMemo(() => deriveRegistryEndpoints(document.baseURI, {
    allowInsecureLoopback: window.location.protocol === 'http:',
  }), []);
  const registryAddress = registryEndpoints.wsURL;
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const registryAuthController = useMemo(() => {
    const endpoints = deriveRegistryEndpoints(document.baseURI, {
      allowInsecureLoopback: window.location.protocol === 'http:',
    });
    return new RegistryAuthController(new RegistryWebAuthClient(endpoints.authURL));
  }, []);
  const [registryAuth, setRegistryAuth] = useState<RegistryAuthSnapshot>(() => registryAuthController.snapshot());
  const [loginToken, setLoginToken] = useState('');
  const [autoConnecting, setAutoConnecting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const autoConnectTriedRef = useRef(false);

  const [themeMode, setThemeMode] = useState<ThemeMode>(
    persistedGlobal.themeMode === 'light' ? 'light' : 'dark',
  );
  const [codeTheme, setCodeTheme] = useState<CodeThemeId>(
    typeof persistedGlobal.codeTheme === 'string' &&
      isCodeThemeId(persistedGlobal.codeTheme)
      ? persistedGlobal.codeTheme
      : DEFAULT_CODE_THEME,
  );
  const [codeFont, setCodeFont] = useState<CodeFontId>(
    typeof persistedGlobal.codeFont === 'string' &&
      isCodeFontId(persistedGlobal.codeFont)
      ? persistedGlobal.codeFont
      : DEFAULT_CODE_FONT,
  );
  const [codeFontSize, setCodeFontSize] = useState<number>(
    clampCodeFontSize(Number(persistedGlobal.codeFontSize)),
  );
  const [codeLineHeight, setCodeLineHeight] = useState<number>(
    clampCodeLineHeight(Number(persistedGlobal.codeLineHeight)),
  );
  const [codeTabSize, setCodeTabSize] = useState<number>(
    clampCodeTabSize(Number(persistedGlobal.codeTabSize)),
  );
  const [chatFont, setChatFont] = useState<ChatFontId>(
    typeof persistedGlobal.chatFont === 'string' &&
      isChatFontId(persistedGlobal.chatFont)
      ? persistedGlobal.chatFont
      : DEFAULT_CHAT_FONT,
  );
  const [chatViewWidth, setChatViewWidth] = useState<ChatViewWidth>(
    normalizeChatViewWidth(persistedGlobal.chatViewWidth),
  );
  const [sessionListDensity, setSessionListDensity] = useState<SessionListDensity>(
    normalizeSessionListDensity(persistedGlobal.sessionListDensity),
  );
  const [mobileEnterKeyBehavior, setMobileEnterKeyBehavior] = useState<MobileEnterKeyBehavior>(
    normalizeMobileEnterKeyBehavior(persistedGlobal.mobileEnterKeyBehavior),
  );
  const [wrapLines, setWrapLines] = useState(!!persistedGlobal.wrapLines);
  const [showLineNumbers, setShowLineNumbers] = useState(
    typeof persistedGlobal.showLineNumbers === 'boolean'
      ? persistedGlobal.showLineNumbers
      : true,
  );
  const [hideToolCalls, setHideToolCalls] = useState(
    typeof persistedGlobal.hideToolCalls === 'boolean'
      ? persistedGlobal.hideToolCalls
      : true,
  );
  const [messageViewerEnabled, setMessageViewerEnabled] = useState(
    typeof persistedGlobal.messageViewerEnabled === 'boolean'
      ? persistedGlobal.messageViewerEnabled
      : false,
  );
  const [logLevel, setLogLevel] = useState(
    normalizeAppDiagnosticLogLevel(persistedGlobal.logLevel),
  );
  const [disableFileCache, setDisableFileCache] = useState(
    typeof persistedGlobal.disableFileCache === 'boolean'
      ? persistedGlobal.disableFileCache
      : false,
  );
  const [promptCompletionNotificationsEnabled, setPromptCompletionNotificationsEnabled] = useState(
    typeof persistedGlobal.promptCompletionNotificationsEnabled === 'boolean'
      ? persistedGlobal.promptCompletionNotificationsEnabled
      : true,
  );
  const notificationProvider = useMemo(() => createNotificationProvider(), []);
  const [notificationPermissionState, setNotificationPermissionState] =
    useState<WheelMakerNotificationPermissionState>('unsupported');
  const [serverSettings, setServerSettings] = useState<ServerSettings>(DEFAULT_SERVER_SETTINGS);
  const [serverSettingsBusy, setServerSettingsBusy] = useState(false);
  const [serverSettingsError, setServerSettingsError] = useState('');
  const voiceInputEnabled = serverSettings.voiceInput.configured;
  const ttsEnabled = serverSettings.textToSpeech.configured;
  const [deviceSessions, setDeviceSessions] = useState<RegistryDeviceSession[]>([]);
  const [deviceSessionsLoading, setDeviceSessionsLoading] = useState(false);
  const [deviceSessionsError, setDeviceSessionsError] = useState('');
  useEffect(() => {
    const unsubscribe = registryAuthController.subscribe(setRegistryAuth);
    void registryAuthController.check();
    return unsubscribe;
  }, [registryAuthController]);
  const [ttsState, setTtsState] = useState<TtsPlaybackState>('idle');
  const ttsActiveTurnIndexRef = useRef<number | null>(null);
  const [registryDebugRecords, setRegistryDebugRecords] = useState(registryDebugStore.getRecords());
  const [selectedRegistryDebugRecordId, setSelectedRegistryDebugRecordId] = useState<number | null>(null);
  const [selectedRegistryDebugScope, setSelectedRegistryDebugScope] = useState('All');
  const [selectedRegistryDebugSessionId, setSelectedRegistryDebugSessionId] = useState('All');
  const [registryDebugIncludeMultiSessionRecords, setRegistryDebugIncludeMultiSessionRecords] = useState(false);
  const codeFontFamily = useMemo(
    () => resolveCodeFontFamily(codeFont),
    [codeFont],
  );
  const chatFontFamily = useMemo(
    () => resolveChatFontFamily(chatFont),
    [chatFont],
  );

  const [windowWidth, setWindowWidth] = useState<number>(window.innerWidth);
  const [windowHeight, setWindowHeight] = useState<number>(window.innerHeight);
  const [safeAreaTopInset, setSafeAreaTopInset] = useState<number>(() => readSafeAreaTopInset());
  const [safeAreaBottomInset, setSafeAreaBottomInset] = useState<number>(() => readSafeAreaBottomInset());
  const layoutMode = resolveLayoutMode(windowWidth);
  const isWide = layoutMode === 'desktop';
  const supportsChatClipboardFiles = useMemo(() => {
    const userAgent = window.navigator.userAgent || '';
    const platform = window.navigator.platform || '';
    if (/iPad|iPhone|iPod/i.test(userAgent)) {
      return false;
    }
    if (
      /Macintosh/i.test(userAgent) &&
      (window.navigator.maxTouchPoints ?? 0) > 1
    ) {
      return false;
    }
    if (/Win/i.test(platform) || /Windows NT/i.test(userAgent)) {
      return true;
    }
    if (/Mac/i.test(platform) || /Macintosh/i.test(userAgent)) {
      return true;
    }
    if (/Linux/i.test(platform) || /X11|Linux x86_64|Linux i686/i.test(userAgent)) {
      return true;
    }
    return false;
  }, []);
  const isWindowsPlatform = useMemo(
    () => /windows/i.test(window.navigator.userAgent),
    [],
  );

  const [workspaceUiState, dispatchWorkspaceUi] = useReducer(
    workspaceUiReducer,
    persistedGlobal,
    globalState =>
      createWorkspaceUiState({
        tab: globalState.tab ?? 'chat',
        collapsedProjectIds: globalState.collapsedProjectIds ?? globalState.desktopCollapsedProjectIds ?? [],
        desktopSidebarWidth: globalState.desktopSidebarWidth,
        pinnedProjectIds: globalState.pinnedProjectIds ?? [],
        hiddenProjectIds: globalState.hiddenProjectIds ?? [],
        expandedHubIds: globalState.expandedHubIds ?? [],
        hubColors: globalState.hubColors ?? {},
        floatingControlYRatio: globalState.floatingControlYRatio ?? readPortRelayFloatingYRatio() ?? FLOATING_CONTROL_DEFAULT_Y_RATIO,
        floatingControlSide: globalState.floatingControlSide ?? readPortRelayFloatingSide() ?? 'right',
      }),
  );
  const tab = workspaceUiState.shared.tab as Tab;
  const [fileIconResources, setFileIconResources] = useState<FileIconResources | null>(null);

  const setiFontCss = useMemo(
    () => fileIconResources?.setiFontCss() ?? '',
    [fileIconResources],
  );
  const resolveFileIcon = useCallback(
    (name: string) => fileIconResources?.resolveSetiIcon(name, themeMode) ?? FALLBACK_FILE_ICON,
    [fileIconResources, themeMode],
  );
  const floatingControlYRatio = workspaceUiState.mobile.floatingControlYRatio;
  const floatingControlSide = workspaceUiState.mobile.floatingControlSide;
  const floatingDragState = workspaceUiState.transient.floatingDragState as FloatingDragState | null;
  const floatingKeyboardOffset = workspaceUiState.transient.floatingKeyboardOffset;
  const sidebarCollapsed = workspaceUiState.desktop.sidebarCollapsed;
  const desktopSidebarWidth = workspaceUiState.desktop.sidebarWidth;
  const collapsedProjectIds = workspaceUiState.shared.collapsedProjectIds;
  const pinnedProjectIds = workspaceUiState.shared.pinnedProjectIds;
  const hiddenProjectIds = workspaceUiState.shared.hiddenProjectIds;
  const expandedHubIds = workspaceUiState.shared.expandedHubIds;
  const hubColors = workspaceUiState.shared.hubColors;
  const drawerOpen = workspaceUiState.mobile.drawerOpen;
  const sidebarSettingsOpen = workspaceUiState.shared.settingsOpen;
  const chatConfigOverflowOpen = workspaceUiState.mobile.chatConfigOverflowOpen;
  const chatKeyboardInset = workspaceUiState.transient.chatKeyboardInset;
  const chatKeyboardInsetRef = useRef(chatKeyboardInset);
  const chatKeyboardInsetSettleTimerRef = useRef<number | null>(null);
  const mobileKeyboardLayoutViewportHeightRef = useRef(0);
  const tabRef = useRef<Tab>(tab);
  const floatingDragStateRef = useRef<FloatingDragState | null>(null);
  const [gestureNavState, setGestureNavState] = useState<GestureNavigationState | null>(null);
  const gestureNavStateRef = useRef<GestureNavigationState | null>(null);
  const gestureMoveLongPressTimerRef = useRef<number | null>(null);
  const gestureNavigationSuppressClickRef = useRef(false);
  const gestureNavigationSuppressClickUntilRef = useRef(0);
  const [floatingControlStackHeight, setFloatingControlStackHeight] = useState(184);
  const chatComposerRef = useRef<HTMLDivElement | null>(null);
  const [chatComposerTop, setChatComposerTop] = useState<number | null>(null);
  const [chatComposerHeight, setChatComposerHeight] = useState(0);
  const [floatingDefaultComposerTop, setFloatingDefaultComposerTop] = useState<number | null>(null);
  const floatingCooldownTimerRef = useRef<number | null>(null);
  const floatingClickCooldownUntilRef = useRef(0);
  const floatingIgnoreLostCaptureRef = useRef(false);
  const floatingControlStackRef = useRef<HTMLDivElement | null>(null);
  const floatingPositionSnapshotRef = useRef<{minTop: number; maxTop: number; top: number; hasDefaultComposerTop: boolean} | null>(null);
  const [floatingSidePulse, setFloatingSidePulse] = useState<PersistedFloatingControlSide | ''>('');
  const floatingControlSideRef = useRef(floatingControlSide);
  const floatingSidePulseTimerRef = useRef<number | null>(null);
  const desktopSidebarResizeRef = useRef<DesktopSidebarResizeState | null>(null);
  const projectPinLongPressTimerRef = useRef<number | null>(null);
  const projectPinLongPressTargetRef = useRef('');
  const projectSessionLongPressTimerRef = useRef<number | null>(null);
  const projectSessionLongPressTargetRef = useRef('');
  const layoutModeRef = useRef(layoutMode);
  const setTab = useCallback((next: WorkspaceUiStateValue<Tab>) => {
    dispatchWorkspaceUi({ type: 'shared/setTab', next });
  }, []);
  const setFloatingControlYRatio = useCallback(
    (next: WorkspaceUiStateValue<number>) => {
      dispatchWorkspaceUi({ type: 'mobile/setFloatingControlYRatio', next });
    },
    [],
  );
  const setFloatingControlSide = useCallback(
    (next: WorkspaceUiStateValue<PersistedFloatingControlSide>) => {
      dispatchWorkspaceUi({ type: 'mobile/setFloatingControlSide', next });
    },
    [],
  );
  const setFloatingDragState = useCallback(
    (next: WorkspaceUiStateValue<FloatingDragState | null>) => {
      dispatchWorkspaceUi({ type: 'transient/setFloatingDragState', next });
    },
    [],
  );
  const setFloatingKeyboardOffset = useCallback((next: WorkspaceUiStateValue<number>) => {
    dispatchWorkspaceUi({ type: 'transient/setFloatingKeyboardOffset', next });
  }, []);
  const setSidebarCollapsed = useCallback((next: WorkspaceUiStateValue<boolean>) => {
    dispatchWorkspaceUi({ type: 'desktop/setSidebarCollapsed', next });
  }, []);
  const setDesktopSidebarWidth = useCallback((next: WorkspaceUiStateValue<number>) => {
    dispatchWorkspaceUi({ type: 'desktop/setSidebarWidth', next });
  }, []);
  const setCollapsedProjectIds = useCallback((next: WorkspaceUiStateValue<string[]>) => {
    dispatchWorkspaceUi({ type: 'shared/setCollapsedProjectIds', next });
  }, []);
  const setPinnedProjectIds = useCallback((next: WorkspaceUiStateValue<string[]>) => {
    dispatchWorkspaceUi({ type: 'shared/setPinnedProjectIds', next });
  }, []);
  const setHiddenProjectIds = useCallback((next: WorkspaceUiStateValue<string[]>) => {
    dispatchWorkspaceUi({ type: 'shared/setHiddenProjectIds', next });
  }, []);
  const setExpandedHubIds = useCallback((next: WorkspaceUiStateValue<string[]>) => {
    dispatchWorkspaceUi({ type: 'shared/setExpandedHubIds', next });
  }, []);
  const setHubColors = useCallback((next: WorkspaceUiStateValue<Record<string, string>>) => {
    dispatchWorkspaceUi({ type: 'shared/setHubColors', next });
  }, []);
  const setDrawerOpen = useCallback((next: WorkspaceUiStateValue<boolean>) => {
    dispatchWorkspaceUi({ type: 'mobile/setDrawerOpen', next });
  }, []);
  const setSidebarSettingsOpen = useCallback((next: WorkspaceUiStateValue<boolean>) => {
    dispatchWorkspaceUi({ type: 'shared/setSettingsOpen', next });
  }, []);
  const setChatConfigOverflowOpen = useCallback((next: WorkspaceUiStateValue<boolean>) => {
    dispatchWorkspaceUi({ type: 'mobile/setChatConfigOverflowOpen', next });
  }, []);
  const setChatKeyboardInset = useCallback((next: WorkspaceUiStateValue<number>) => {
    dispatchWorkspaceUi({ type: 'transient/setChatKeyboardInset', next });
  }, []);
  const [databasePanelOpen, setDatabasePanelOpen] = useState(false);
  const [databaseLoading, setDatabaseLoading] = useState(false);
  const [databaseError, setDatabaseError] = useState('');
  const [databaseDumpText, setDatabaseDumpText] = useState('');
  const [databaseStorageStats, setDatabaseStorageStats] = useState<WorkspaceDatabaseStorageStats | null>(null);
  const [settingsDetailView, setSettingsDetailView] = useState<SettingsDetailView>(null);
  const mobileSettingsHistoryKeyRef = useRef<string | null>(null);
  const mobileSettingsReplaceRootHistoryRef = useRef(false);
  const sidebarSettingsOpenRef = useRef(sidebarSettingsOpen);
  const settingsDetailViewRef = useRef<SettingsDetailView>(settingsDetailView);
  const [desktopSidebarResizing, setDesktopSidebarResizing] = useState(false);
  const [desktopSidebarDraftWidth, setDesktopSidebarDraftWidth] = useState<number | null>(null);
  const [tokenStatsLoading, setTokenStatsLoading] = useState(false);
  const [tokenStatsError, setTokenStatsError] = useState('');
  const [tokenStatsUpdatedAt, setTokenStatsUpdatedAt] = useState('');
  const [tokenStatsProviders, setTokenStatsProviders] = useState<TokenProviderSectionView[]>([]);
  const [wheelMakerUpdateHubs, setWheelMakerUpdateHubs] = useState<Record<string, WheelMakerUpdateHubView>>({});
  const [wheelMakerUpdatesLoading, setWheelMakerUpdatesLoading] = useState(false);
  const [wheelMakerUpdatesError, setWheelMakerUpdatesError] = useState('');
  const [wheelMakerUpdatePendingHubId, setWheelMakerUpdatePendingHubId] = useState('');
  const [wheelMakerUpdateAllPending, setWheelMakerUpdateAllPending] = useState(false);
  const androidApkUpdateBridge = useMemo(() => createAndroidApkUpdateBridge(), []);
  const [androidApkUpdateSupported, setAndroidApkUpdateSupported] = useState(false);
  const [androidApkLocalRelease, setAndroidApkLocalRelease] = useState<AndroidApkLocalRelease | null>(null);
  const [androidApkLatestRelease, setAndroidApkLatestRelease] = useState<AndroidApkLatestRelease | null>(null);
  const [androidApkUpdateLoading, setAndroidApkUpdateLoading] = useState(false);
  const [androidApkUpdateError, setAndroidApkUpdateError] = useState('');
  const [androidApkInstallStatus, setAndroidApkInstallStatus] = useState('');
  const [androidApkInstallPending, setAndroidApkInstallPending] = useState(false);
  const wheelMakerUpdatePollTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const wheelMakerUpdatePollHubIdsRef = useRef<Set<string>>(new Set());
  const refreshWheelMakerUpdateHubRef = useRef<((hubId: string, options?: {force?: boolean; silent?: boolean}) => Promise<void>) | null>(null);
  const refreshWheelMakerUpdatesRef = useRef<((options?: {force?: boolean}) => Promise<void>) | null>(null);
  const refreshAgentPackagesRef = useRef<((options?: {silent?: boolean}) => Promise<void>) | null>(null);
  const refreshProjectFileIndexesRef = useRef<((hubIds: string | string[], options?: {silent?: boolean}) => Promise<void>) | null>(null);
  const refreshAndroidApkUpdateRef = useRef<(() => Promise<void>) | null>(null);
  const [agentPackageHubs, setAgentPackageHubs] = useState<Record<string, AgentPackageHubView>>({});
  const [agentPackagesLoading, setAgentPackagesLoading] = useState(false);
  const [agentPackagesError, setAgentPackagesError] = useState('');
  const [agentPackageActionPendingKey, setAgentPackageActionPendingKey] = useState('');
  const [agentPackageHubUpdatePendingId, setAgentPackageHubUpdatePendingId] = useState('');
  const [expandedNpmUpdateHubIds, setExpandedNpmUpdateHubIds] = useState<Record<string, boolean>>({});
  const [expandedProjectIndexHubIds, setExpandedProjectIndexHubIds] = useState<Record<string, boolean>>({});
  const [projectIndexByHubId, setProjectIndexByHubId] = useState<Record<string, RegistryFileIndexStatusResponse>>({});
  const [projectIndexLoading, setProjectIndexLoading] = useState(false);
  const [projectIndexError, setProjectIndexError] = useState('');
  const [projectIndexErrorByProjectId, setProjectIndexErrorByProjectId] = useState<Record<string, string>>({});
  const [projectIndexScanPendingByProjectId, setProjectIndexScanPendingByProjectId] = useState<Record<string, boolean>>({});
  const [projectIndexScanAllPendingByHubId, setProjectIndexScanAllPendingByHubId] = useState<Record<string, boolean>>({});
  const agentPackageScanPollTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const projectIndexPollTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [skillHubs, setSkillHubs] = useState<Record<string, SkillHubView>>({});
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState('');
  const [skillsPendingKey, setSkillsPendingKey] = useState('');
  const skillOperationPollTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const skillOperationPollHubIdsRef = useRef<Set<string>>(new Set());
  const refreshSkillManagementHubRef = useRef<((hubId: string) => Promise<void>) | null>(null);
  const [skillInstallTarget, setSkillInstallTarget] = useState<SkillInstallTarget | null>(null);
  const [skillSourceInput, setSkillSourceInput] = useState('');
  const [skillSourceCandidates, setSkillSourceCandidates] = useState<RegistrySkillSourceCandidate[]>([]);
  const [skillSourceSelectedNames, setSkillSourceSelectedNames] = useState<string[]>([]);
  const [skillSourceLoading, setSkillSourceLoading] = useState(false);
  const [skillSourceError, setSkillSourceError] = useState('');
  const [skillDetailTarget, setSkillDetailTarget] = useState<SkillDetailTarget | null>(null);
  const [skillDetailCache, setSkillDetailCache] = useState<Record<string, SkillDetailCacheEntry>>({});
  const [portRelaySnapshot, setPortRelaySnapshot] = useState<RegistryPortRelaySnapshot>(DEFAULT_PORT_RELAY_SNAPSHOT);
  const [portRelayLoading, setPortRelayLoading] = useState(false);
  const [portRelayError, setPortRelayError] = useState('');
  const [portRelayListenPort, setPortRelayListenPort] = useState(String(persistedGlobal.portRelayListenPort || 28810));
  const [portRelayTargets, setPortRelayTargets] = useState<PortRelayTarget[]>(
    normalizePortRelayTargets(persistedGlobal.portRelayTargets),
  );
  const [selectedPortRelayTarget, setSelectedPortRelayTarget] = useState<PortRelayTarget | null>(
    normalizePortRelayTarget(persistedGlobal.selectedPortRelayTarget),
  );
  const [portRelayDraftHubId, setPortRelayDraftHubId] = useState('');
  const [portRelayDraftPort, setPortRelayDraftPort] = useState('80');
  const [portRelayAccessCode, setPortRelayAccessCode] = useState('');
  const [portRelayKnownAccessCodeGeneration, setPortRelayKnownAccessCodeGeneration] = useState<number | null>(null);
  const [portRelayCodeCopied, setPortRelayCodeCopied] = useState(false);
  const [portRelayFramePath, setPortRelayFramePath] = useState('');
  const [portRelayClearSiteDataUrl, setPortRelayClearSiteDataUrl] = useState('');
  const [portRelayFrameReloadKey, setPortRelayFrameReloadKey] = useState(0);
  const [portRelayFrameAutoOpenPending, setPortRelayFrameAutoOpenPending] = useState(false);
  const [portRelayTargetMenuOpen, setPortRelayTargetMenuOpen] = useState(false);
  const [portRelayMenuSwitchingTarget, setPortRelayMenuSwitchingTarget] = useState<PortRelayTarget | null>(null);
  const [previewWorkbench, setPreviewWorkbench] = useState(() =>
    previewWorkbenchStateFromSnapshot(persistedGlobal.previewWorkbenchSnapshot),
  );
  const [chatPreviewManualOpen, setChatPreviewManualOpen] = useState(false);
  const [chatPreviewManualCollapsed, setChatPreviewManualCollapsed] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalSync, setTerminalSync] = useState<TerminalSyncState>(() => createTerminalSyncState());
  const terminalSyncRef = useRef(terminalSync);
  const [activeTerminalKey, setActiveTerminalKey] = useState('');
  const activeTerminalKeyRef = useRef('');
  const terminalViewRef = useRef<TerminalViewHandle | null>(null);
  const terminalResizeTokensRef = useRef(new Map<string, string>());
  const terminalResizeClaimsRef = useRef(new Set<string>());
  const terminalRefreshInFlightRef = useRef(new Set<string>());
  const terminalRefreshRef = useRef<(key: string) => Promise<void>>(async () => undefined);
  const [terminalPanelHeight, setTerminalPanelHeight] = useState(280);
  const terminalPanelResizeRef = useRef<{pointerId: number; originY: number; startHeight: number} | null>(null);
  const [previewWorkbenchActionsMenuOpen, setPreviewWorkbenchActionsMenuOpen] = useState(false);
  const [previewSearchOpen, setPreviewSearchOpen] = useState(false);
  const [previewSearchQuery, setPreviewSearchQuery] = useState('');
  const [previewSearchActiveIndex, setPreviewSearchActiveIndex] = useState(0);
  const previewSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [previewFileTreeSearchQuery, setPreviewFileTreeSearchQuery] = useState('');
  const [previewFileTreeSearchResults, setPreviewFileTreeSearchResults] = useState<RegistryFileIndexSearchResult[]>([]);
  const [previewFileTreeSearchLoading, setPreviewFileTreeSearchLoading] = useState(false);
  const [previewFileTreeSearchError, setPreviewFileTreeSearchError] = useState('');
  const [previewFileTreeSearchIndexed, setPreviewFileTreeSearchIndexed] = useState(true);
  const [previewFileTreeSearchActiveIndex, setPreviewFileTreeSearchActiveIndex] = useState(0);
  const [previewFileTreeSearchCollapsedDirs, setPreviewFileTreeSearchCollapsedDirs] = useState<string[]>([]);
  const previewFileTreeSearchInputRef = useRef<HTMLInputElement | null>(null);
  const previewFileTreeSearchTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const previewFileTreeSearchGenerationRef = useRef(0);
  const previewFileTreeSearchQueryIdRef = useRef(0);
  const previewFileTreeSearchSessionIdRef = useRef(`preview-file-tree-${Date.now()}`);
  const [quickFileOpen, setQuickFileOpen] = useState(false);
  const [quickFileProjectId, setQuickFileProjectId] = useState('');
  const [quickFileQuery, setQuickFileQuery] = useState('');
  const [quickFileResults, setQuickFileResults] = useState<RegistryFileIndexSearchResult[]>([]);
  const [quickFileLoading, setQuickFileLoading] = useState(false);
  const [quickFileError, setQuickFileError] = useState('');
  const [quickFileIndexed, setQuickFileIndexed] = useState(true);
  const [quickFileActiveIndex, setQuickFileActiveIndex] = useState(0);
  const quickFileInputRef = useRef<HTMLInputElement | null>(null);
  const quickFileSearchTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const quickFileSearchGenerationRef = useRef(0);
  const quickFileQueryIdRef = useRef(0);
  const quickFileQuerySessionIdRef = useRef(`quick-file-${Date.now()}`);
  const [previewSelectionMenu, setPreviewSelectionMenu] = useState<PreviewSelectionMenuState | null>(null);
  const previewSelectionMenuRef = useRef<HTMLDivElement | null>(null);
  const previewContextSelectionRef = useRef<PreviewSelectionSnapshot | null>(null);
  const portRelayCodeCopyTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const portRelayClearSiteDataTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const portRelayTargetMenuTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const portRelayTargetMenuPressRef = useRef<PortRelayTargetMenuPressState | null>(null);
  const portRelayTargetMenuRef = useRef<HTMLDivElement | null>(null);
  const activeWorkbenchTab = activePreviewTab(previewWorkbench);
  const previewWorkbenchTabs =
    previewWorkbench.tabsByProjectId[previewWorkbench.activeProjectId] ?? [];
  const previewWorkbenchRenderedTabs = previewRenderedTabs(previewWorkbench);
  const previewWorkbenchHasTabs = Object.values(previewWorkbench.tabsByProjectId)
    .some(tabs => tabs.length > 0);
  const previewTabCount = (previewWorkbench.tabsByProjectId[previewWorkbench.activeProjectId] ?? []).length;
  const chatFilePeek = isFilePreviewTab(activeWorkbenchTab) ? activeWorkbenchTab : null;
  const activePromptDiffPreview = isPromptDiffPreviewTab(activeWorkbenchTab) ? activeWorkbenchTab : null;
  const activeAttachmentPreview = isAttachmentPreviewTab(activeWorkbenchTab) ? activeWorkbenchTab : null;
  const activePortRelayPreview = isPortRelayPreviewTab(activeWorkbenchTab) ? activeWorkbenchTab : null;
  const previewSearchMatches = useMemo(
    () => buildPreviewSearchMatches(activeWorkbenchTab, previewSearchQuery),
    [activeWorkbenchTab, previewSearchQuery],
  );
  const previewSearchDocument = previewSearchDocumentKey(activeWorkbenchTab);
  const previewSearchUnavailableMessage =
    activeWorkbenchTab && activeWorkbenchTab.type !== 'file' && activeWorkbenchTab.type !== 'prompt-diff'
      ? 'Search is not available for this preview.'
      : '';
  const previewWorkbenchRef = useRef(previewWorkbench);
  const chatPreviewHasContent = previewWorkbenchHasTabs;
  const chatPreviewOpen = chatPreviewManualOpen || (chatPreviewHasContent && !chatPreviewManualCollapsed);
  const portRelayWorkbenchOpen = !!activePortRelayPreview && chatPreviewOpen;

  useEffect(() => {
    setPreviewWorkbenchActionsMenuOpen(false);
  }, [activeWorkbenchTab?.id, chatPreviewOpen]);

  useEffect(() => {
    if (!isWide && chatPreviewHasContent && !chatPreviewManualCollapsed) {
      setChatPreviewManualCollapsed(true);
    }
  }, []);
  const mobilePortRelayFrameOpen = !isWide && portRelayWorkbenchOpen;
  const fileIconResourcesNeeded = tab === 'file' ||
    (
      chatPreviewOpen &&
      previewWorkbench.treeOpen &&
      (!activeWorkbenchTab || activeWorkbenchTab.type === 'file')
    );

  useEffect(() => {
    if (!fileIconResourcesNeeded || fileIconResources) {
      return;
    }
    let cancelled = false;
    loadFileIconResources()
      .then(resources => {
        if (!cancelled) {
          setFileIconResources(resources);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fileIconResources, fileIconResourcesNeeded]);
  const portRelayReady = portRelaySnapshot.enabled && portRelaySnapshot.status === 'Up';
  const portRelayAccessCodeUnknown = portRelaySnapshot.enabled && (
    !portRelayAccessCode ||
    (
      typeof portRelaySnapshot.accessCodeGeneration === 'number' &&
      portRelayKnownAccessCodeGeneration !== portRelaySnapshot.accessCodeGeneration
    )
  );
  const portRelayFrameAccessCode = portRelayAccessCodeUnknown ? '' : portRelayAccessCode;
  const portRelayFrameUrl = useMemo(() => {
    if (!portRelayReady) {
      return '';
    }
    const baseUrl = resolvePortRelayOpenUrl({
      relayUrl: portRelaySnapshot.relayUrl,
      registryAddress,
      listenPort: portRelaySnapshot.listenPort || portRelayListenPort,
    });
    return appendPortRelayAutoAuthCode(
      appendPortRelayOpenPath(baseUrl, portRelayFramePath),
      portRelayFrameAccessCode,
    );
  }, [registryAddress, portRelayFrameAccessCode, portRelayFramePath, portRelayListenPort, portRelayReady, portRelaySnapshot.listenPort, portRelaySnapshot.relayUrl]);
  const snapshotPortRelayTarget = useMemo(() => normalizePortRelayTarget({
    hubId: portRelaySnapshot.hubId,
    targetPort: portRelaySnapshot.targetPort,
  }), [portRelaySnapshot.hubId, portRelaySnapshot.targetPort]);
  const activePortRelayTarget = portRelaySnapshot.enabled
    ? snapshotPortRelayTarget ?? selectedPortRelayTarget
    : selectedPortRelayTarget ?? snapshotPortRelayTarget;
  const portRelayTargetMenuTargets = useMemo(
    () => orderPortRelayTargetsForMenu(portRelayTargets, activePortRelayTarget),
    [activePortRelayTarget, portRelayTargets],
  );

  useEffect(() => {
    if (!portRelayFrameAutoOpenPending) {
      return;
    }
    if (portRelayReady && portRelayFrameUrl) {
      setPortRelayFrameAutoOpenPending(false);
      return;
    }
    if (!portRelaySnapshot.enabled || portRelaySnapshot.status === 'Error') {
      setPortRelayFrameAutoOpenPending(false);
    }
  }, [
    portRelayFrameAutoOpenPending,
    portRelayFrameUrl,
    portRelayReady,
    portRelaySnapshot.enabled,
    portRelaySnapshot.status,
  ]);

  useEffect(() => {
    if (!mobilePortRelayFrameOpen) {
      return;
    }
    setDrawerOpen(false);
    setSidebarSettingsOpen(false);
  }, [mobilePortRelayFrameOpen, setDrawerOpen, setSidebarSettingsOpen]);

  const clearPortRelayTargetMenuTimer = useCallback(() => {
    if (portRelayTargetMenuTimerRef.current) {
      window.clearTimeout(portRelayTargetMenuTimerRef.current);
      portRelayTargetMenuTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearPortRelayTargetMenuTimer();
  }, [clearPortRelayTargetMenuTimer]);

  useEffect(() => {
    if (!mobilePortRelayFrameOpen) {
      setPortRelayTargetMenuOpen(false);
      setPortRelayMenuSwitchingTarget(null);
    }
  }, [mobilePortRelayFrameOpen]);

  useEffect(() => {
    if (!portRelayTargetMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && portRelayTargetMenuRef.current?.contains(target)) {
        return;
      }
      setPortRelayTargetMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPortRelayTargetMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [portRelayTargetMenuOpen]);

  useEffect(() => () => {
    if (portRelayCodeCopyTimerRef.current) {
      window.clearTimeout(portRelayCodeCopyTimerRef.current);
    }
    if (portRelayClearSiteDataTimerRef.current) {
      window.clearTimeout(portRelayClearSiteDataTimerRef.current);
    }
  }, []);

  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [workspaceProjectMenuOpen, setWorkspaceProjectMenuOpen] = useState(false);

  const [projects, setProjects] = useState<RegistryProject[]>([]);
  const [registryHubs, setRegistryHubs] = useState<RegistryHub[]>([]);
  const [projectId, setProjectId] = useState('');
  const projectIdRef = useRef('');
  const projectsRef = useRef<RegistryProject[]>([]);
  const currentProjectRef = useRef<RegistryProject | null>(null);
  const knownGitRevRef = useRef('');
  const knownWorktreeRevRef = useRef('');
  const gitRevCheckInFlightRef = useRef(false);
  const failedGitRevLoadKeyRef = useRef('');
  const [loadingProject, setLoadingProject] = useState(false);
  const [refreshingProject, setRefreshingProject] = useState(false);
  const [hasPendingProjectUpdates, setHasPendingProjectUpdates] = useState(false);

  const [dirEntries, setDirEntries] = useState<DirEntries>({ '.': [] });
  const [expandedDirs, setExpandedDirs] = useState<string[]>(['.']);
  const expandedDirsRef = useRef<string[]>(['.']);
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});
  const [selectedFile, setSelectedFile] = useState('');
  const selectedFileRef = useRef('');
  const [pinnedFiles, setPinnedFiles] = useState<string[]>([]);
  const [fileContent, setFileContent] = useState('');
  const [fileInfo, setFileInfo] = useState<RegistryFsInfo | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [gotoLineInput, setGotoLineInput] = useState('');
  const [pendingFileJump, setPendingFileJump] = useState<{
    path: string;
    line: number;
  } | null>(null);
  const [fileTabSelectedLines, setFileTabSelectedLines] = useState<Set<number>>(new Set());
  const fileTabAnchorRef = useRef<number | null>(null);
  const [searchToolsOpen, setSearchToolsOpen] = useState(false);
  const [gotoToolsOpen, setGotoToolsOpen] = useState(false);
  const [markdownPreviewEnabled, setMarkdownPreviewEnabled] = useState(false);
  const [htmlPreviewEnabled, setHtmlPreviewEnabled] = useState(false);
  const fileScrollRef = useRef<HTMLDivElement | null>(null);
  const [chatFilePreviewDirEntriesByProject, setChatFilePreviewDirEntriesByProject] =
    useState<Record<string, DirEntries>>({});
  const [chatFilePreviewLoadingDirsByProject, setChatFilePreviewLoadingDirsByProject] =
    useState<Record<string, Record<string, boolean>>>({});
  const [chatFilePreviewDirErrorsByProject, setChatFilePreviewDirErrorsByProject] =
    useState<Record<string, Record<string, string>>>({});
  const [chatFilePreviewExpandedDirsByProject, setChatFilePreviewExpandedDirsByProject] =
    useState<Record<string, string[]>>({});
  const previewDirectoryLoadKeysRef = useRef<Set<string>>(new Set());
  const previewSearchJumpCancelRef = useRef<(() => void) | null>(null);
  const [chatAttachmentThumbnails, setChatAttachmentThumbnails] = useState<Record<string, ChatAttachmentThumbnailState>>({});
  const chatFilePeekRef = useRef<FilePreviewTab | null>(null);
  const chatFilePeekScrollRef = useRef<HTMLDivElement | null>(null);
  const chatFilePeekReadSeqRef = useRef(0);
  const chatAttachmentReadSeqRef = useRef(0);
  const chatPromptArtifactReadSeqRef = useRef(0);
  const chatFilePeekHistoryActiveRef = useRef(false);
  const chatFilePeekResizeRef = useRef<DesktopSidebarResizeState | null>(null);
  const [chatFilePeekWidth, setChatFilePeekWidth] = useState(CHAT_FILE_PEEK_WIDTH_DEFAULT);
  const [chatFilePeekWidthResized, setChatFilePeekWidthResized] = useState(false);
  const [chatFilePeekDraftWidth, setChatFilePeekDraftWidth] = useState<number | null>(null);
  const [chatFilePeekResizing, setChatFilePeekResizing] = useState(false);
  const [chatPeekSelectedLines, setChatPeekSelectedLines] = useState<Set<number>>(new Set());
  const chatPeekAnchorRef = useRef<number | null>(null);
  const liveRefreshTimerRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectStartedAtRef = useRef<number | null>(null);
  const connectInFlightRef = useRef(false);
  const supervisorManagedCloseRef = useRef(false);
  const dirHashRef = useRef<Record<string, string>>({});
  const fileHashRef = useRef<Record<string, string>>({});
  const fileCacheRef = useRef<Record<string, string>>({});
  const fileReadSeqRef = useRef(0);
  const fileReadAbortControllerRef = useRef<AbortController | null>(null);
  const previewFileLoadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const fileScrollTopByPathRef = useRef<Record<string, number>>({});
  const skipNextSelectedFileAutoReadRef = useRef(false);
  const fileSideActionsRef = useRef<HTMLDivElement | null>(null);
  const commitPopoverRef = useRef<HTMLDivElement | null>(null);
  const gitBranchMenuRef = useRef<HTMLDivElement | null>(null);
  const gitSelectedBranchesRef = useRef<string[]>([]);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const chatImageInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatVirtuosoListRef = useRef<ChatVirtuosoTurnListHandle | null>(null);
  const chatLayoutMetrics = useChatLayoutMetrics(chatScrollRef);
  const chatAutoScrollFollowRef = useRef(true);
  const chatPointerScrollingRef = useRef(false);
  const chatUserScrollLockUntilRef = useRef(0);
  const chatRichComposerRef = useRef<ChatRichComposerHandle | null>(null);
  const chatPromptButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatFileMentionButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatAttachmentTrayRef = useRef<HTMLDivElement | null>(null);
  const chatAttachmentTrayButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatFileMentionMenuRef = useRef<HTMLDivElement | null>(null);
  const chatSlashMenuRef = useRef<HTMLDivElement | null>(null);
  const chatContextUsageRef = useRef<HTMLDivElement | null>(null);
  const chatConfigOptionsRef = useRef<HTMLDivElement | null>(null);
  const chatConfigOverflowRef = useRef<HTMLDivElement | null>(null);
  const wideProjectActionMenuRef = useRef<HTMLDivElement | null>(null);
  const chatSelectedIdRef = useRef('');
  const selectedChatKeyRef = useRef<ChatSessionKey | null>(null);
  const chatVisibleRuntimeKeyRef = useRef('');
  const chatSelectedLoadAttemptRuntimeKeyRef = useRef('');
  const chatFinishedCursorRef = useRef<Record<string, number>>({});
  const chatMessageStoreRef = useRef<Record<string, RegistryChatMessage[]>>({});
  const chatTurnStoreRef = useRef<Record<string, ChatTurnStoreState>>({});
  const chatReadRepairQueueRef = useRef(createChatReadRepairQueue());
  const chatDurablePersistQueueRef = useRef(createChatDurablePersistQueue(runtimeKey => {
    const key = decodeChatSessionKey(runtimeKey);
    if (!key) return;
    const state = chatTurnStoreRef.current[runtimeKey];
    workspaceStore.rememberChatSessionTurns(key.projectId, key.sessionId, state?.finished ?? []);
  }, 5000));
  const chatMessagesRef = useRef<RegistryChatMessage[]>([]);
  const notifiedPromptCompletionIdsRef = useRef<Set<string>>(new Set());
  const promptCompletionNotificationsEnabledRef = useRef(promptCompletionNotificationsEnabled);
  const pendingNotificationTargetRef = useRef<ChatSessionKey | null>(
    readPromptCompletionNotificationTarget(),
  );
  const chatIndexFullRefreshInFlightRef = useRef(false);
  const chatIndexFullRefreshDirtyRef = useRef(false);
  const chatProjectRefreshInFlightRef = useRef<Record<string, boolean>>({});
  const chatProjectRefreshDirtyRef = useRef<Record<string, boolean>>({});
  const [chatSessions, setChatSessions] = useState<RegistryChatSession[]>([]);
  const chatSessionsRef = useRef<RegistryChatSession[]>([]);
  const [projectSessionsByProjectId, setProjectSessionsByProjectId] = useState<Record<string, RegistryChatSession[]>>({});
  const [recentSessionSections, setRecentSessionSections] = useState<RecentChatSessionProjectSection[]>([]);
  const [recentSessionsTick, setRecentSessionsTick] = useState(0);
  const [recentSessionsPinned, setRecentSessionsPinned] = useState(false);
  const projectSessionsByProjectIdRef = useRef<Record<string, RegistryChatSession[]>>({});
  const [draftSessionsByProjectId, setDraftSessionsByProjectId] = useState<Record<string, DraftChatSession[]>>({});
  const draftSessionsByProjectIdRef = useRef<Record<string, DraftChatSession[]>>({});
  const draftSessionCreatePromisesRef = useRef<Record<string, Promise<RegistryChatSession>>>({});
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchInput, setSessionSearchInput] = useState('');
  const sessionSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [activeSessionSearchId, setActiveSessionSearchId] = useState('');
  const activeSessionSearchIdRef = useRef('');
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [searchResultsByProjectId, setSearchResultsByProjectId] = useState<SessionSearchResultsByProjectId>({});
  const [sessionSearchDoneByProjectId, setSessionSearchDoneByProjectId] = useState<Record<string, boolean>>({});
  const sessionSearchDoneByProjectIdRef = useRef<Record<string, boolean>>({});
  const [sessionSearchErrorsByProjectId, setSessionSearchErrorsByProjectId] = useState<Record<string, string>>({});
  const [olderSessionsExpandedByProjectId, setOlderSessionsExpandedByProjectId] = useState<Record<string, boolean>>(
    () => readOlderSessionsExpanded(typeof window !== 'undefined' ? window.sessionStorage : null),
  );
  const [sessionArchiveMenuOpen, setSessionArchiveMenuOpen] = useState(false);
  const [archiveBatchProgress, setArchiveBatchProgress] = useState<ArchiveBatchProgress | null>(null);
  const [archiveBatchSummary, setArchiveBatchSummary] = useState('');
  const [archivedMode, setArchivedMode] = useState(false);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState('');
  const [archivedByProjectId, setArchivedByProjectId] = useState<Record<string, RegistryArchivedSessionSummary[]>>({});
  const [selectedArchivedKey, setSelectedArchivedKey] = useState<ChatSessionKey | null>(null);
  const [archivedPreview, setArchivedPreview] = useState<RegistrySessionArchiveReadResponse | null>(null);
  const [archivedRestoringSessionId, setArchivedRestoringSessionId] = useState('');
  const sessionSearchUnchangedPollsRef = useRef(0);
  const sessionSearchPollTimerRef = useRef<number | null>(null);
  const sessionSearchIdCounterRef = useRef(0);
  const [sessionSearchTargetTurn, setSessionSearchTargetTurn] = useState<{
    runtimeKey: string;
    turnIndex: number;
    generation: number;
  } | null>(null);
  const sessionSearchHighlightTimerRef = useRef<number | null>(null);
  const registryDebugSessionLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const projectItem of projects) {
      const projectName = projectItem.name || projectItem.projectId;
      const projectSessions = projectSessionsByProjectId[projectItem.projectId] ?? [];
      for (const session of projectSessions) {
        const sessionTitle = resolveChatSessionTitle(session.title ?? '') || session.sessionId;
        labels[session.sessionId] = `${projectName} / ${sessionTitle}`;
      }
    }
    return labels;
  }, [projectSessionsByProjectId, projects]);
  const [wideProjectActionMenu, setWideProjectActionMenu] = useState<WideProjectActionMenuState | null>(null);
  const [mobileProjectActionMenu, setMobileProjectActionMenu] = useState<MobileProjectActionMenuState | null>(null);
  const [projectSessionActionMenu, setProjectSessionActionMenu] = useState<ProjectSessionActionMenuState | null>(null);
  const [mobileProjectSessionErrors, setMobileProjectSessionErrors] = useState<Record<string, string>>({});
  const [mobileProjectSessionsRefreshing, setMobileProjectSessionsRefreshing] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState('');
  const [selectedChatKey, setSelectedChatKey] = useState<ChatSessionKey | null>(null);
  const [chatMessages, setChatMessages] = useState<RegistryChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSubmittingByKey, setChatSubmittingByKey] = useState<Record<string, boolean>>({});
  const [chatShowScrollToBottom, setChatShowScrollToBottom] = useState(false);
  const [chatReloadingSessionId, setChatReloadingSessionId] = useState('');
  const [chatArchivingSessionId, setChatArchivingSessionId] = useState('');
  const [chatDeletingSessionId, setChatDeletingSessionId] = useState('');
  const [chatRenamingSessionId, setChatRenamingSessionId] = useState('');
  const [renameTarget, setRenameTarget] = useState<RenameSessionTarget | null>(null);
  const [renameTitleDraft, setRenameTitleDraft] = useState('');
  const [renameError, setRenameError] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [confirmError, setConfirmError] = useState('');
  const [sessionStatusDialog, setSessionStatusDialog] = useState<SessionStatusDialogState | null>(null);
  const [chatConfigUpdatingKey, setChatConfigUpdatingKey] = useState('');
  const [chatComposerText, setChatComposerText] = useState('');
  const [chatComposerTokens, setChatComposerTokens] = useState<ChatComposerToken[]>([]);
  const [chatComposerSelectionRestore, setChatComposerSelectionRestore] = useState<ChatRichComposerSelectionRestore | null>(null);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const chatAttachmentUploadPending = chatAttachments.some(isChatAttachmentUploadPending);
  const chatComposerHasSendableContent = chatComposerHasSendableTokens(chatComposerTokens) || chatAttachments.length > 0;
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceRecordingStatus, setVoiceRecordingStatus] = useState<VoiceRecordingStatus>('recording');
  const [voiceCancelIntent, setVoiceCancelIntent] = useState(false);
  const [voiceInteractionMode, setVoiceInteractionMode] = useState<VoiceInputInteractionMode | null>(null);
  const [voiceElapsedMs, setVoiceElapsedMs] = useState(0);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [chatComposerDragActive, setChatComposerDragActive] = useState(false);
  const [chatComposerDrafts, setChatComposerDrafts] = useState<Record<string, ChatComposerDraft>>({});
  const [chatPendingPromptsByKey, setChatPendingPromptsByKey] = useState<Record<string, PendingChatPrompt>>({});
  const [chatQueuedPromptsByKey, setChatQueuedPromptsByKey] = useState<QueuedChatPromptsByKey>({});
  const [chatCompactingByKey, setChatCompactingByKey] = useState<Record<string, boolean>>({});
  const [chatCancellingRuntimeKey, setChatCancellingRuntimeKey] = useState('');
  const [markdownImageExportRequest, setMarkdownImageExportRequest] = useState<MarkdownImageExportRequest | null>(null);
  const [exportingMarkdownImageTurnIndex, setExportingMarkdownImageTurnIndex] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const markdownImageExportIdRef = useRef(0);
  const chatComposerTextRef = useRef('');
  const chatComposerTextCursorRef = useRef(0);
  const chatComposerTokensRef = useRef<ChatComposerToken[]>([]);
  const chatAttachmentsRef = useRef<ChatAttachment[]>([]);
  const chatComposerDraftsRef = useRef<Record<string, ChatComposerDraft>>({});
  const chatPendingPromptsByKeyRef = useRef<Record<string, PendingChatPrompt>>({});
  const chatQueuedPromptsByKeyRef = useRef<QueuedChatPromptsByKey>({});
  const chatCompactingByKeyRef = useRef<Record<string, boolean>>({});
  const terminalCompactionOperationIdsRef = useRef<Set<string>>(new Set());
  const chatSubmittingByKeyRef = useRef<Record<string, boolean>>({});
  const chatPendingPromptTimersRef = useRef<Record<string, number>>({});
  const chatDraftGenerationRef = useRef<Record<string, number>>({});
  const currentChatDraftKeyRef = useRef('');
  const chatAttachmentIdRef = useRef(0);
  const chatComposerSelectionRestoreRevisionRef = useRef(0);
  const chatAttachmentCancelIdsRef = useRef<Set<string>>(new Set());
  const connectedRef = useRef(false);
  const voiceRecordingRef = useRef(false);
  const voiceStreamIdRef = useRef('');
  const voiceSeqRef = useRef(0);
  const voiceSessionRef = useRef<VoiceInputSession | null>(null);
  const voiceCaptureRef = useRef<MicrophonePCMStream | null>(null);
  const voiceInputBufferRef = useRef<VoiceInputBuffer | null>(null);
  const voiceSendQueueRef = useRef<VoiceInputSendQueue | null>(null);
  const voiceStartGenerationRef = useRef(0);
  const voicePendingFinishRef = useRef(false);
  const voiceAwaitingFinalRef = useRef(false);
  const voiceInteractionModeRef = useRef<VoiceInputInteractionMode | null>(null);
  const voiceFinalTimerRef = useRef<number | null>(null);
  const voiceReconnectBufferingRef = useRef(false);
  const voiceCaptureGenerationRef = useRef(0);
  const voiceRemoteStartRequestedRef = useRef(false);
  const voiceActiveSettingsRef = useRef<ServerSettings['voiceInput'] | null>(null);
  const voiceRuntimeKeyRef = useRef('');
  const voiceStartedAtRef = useRef(0);
  const voiceTransportModeRef = useRef<VoiceTransportMode>('registry');
  const androidSpeechRuntimeRef = useRef<AndroidNativeSpeechRuntime | null>(null);
  const [chatPromptMenuOpen, setChatPromptMenuOpen] = useState(false);
  const [chatFileMentionMenuOpen, setChatFileMentionMenuOpen] = useState(false);
  const [chatFileMentionResults, setChatFileMentionResults] = useState<RegistryFileIndexSearchResult[]>([]);
  const [chatFileMentionQuery, setChatFileMentionQuery] = useState('');
  const [chatFileMentionLoading, setChatFileMentionLoading] = useState(false);
  const [chatFileMentionError, setChatFileMentionError] = useState('');
  const [chatFileMentionIndexed, setChatFileMentionIndexed] = useState(true);
  const [chatFileMentionActiveIndex, setChatFileMentionActiveIndex] = useState(0);
  const [chatAttachmentTrayOpen, setChatAttachmentTrayOpen] = useState(false);
  const [chatContextUsageOpen, setChatContextUsageOpen] = useState(false);
  const [chatContextUsagePopoverStyle, setChatContextUsagePopoverStyle] = useState<React.CSSProperties>({});
  const [chatConfigMenuOptionId, setChatConfigMenuOptionId] = useState('');
  const [chatHubMenuOpen, setChatHubMenuOpen] = useState(false);
  const [chatHubColorMenuHubId, setChatHubColorMenuHubId] = useState('');
  const chatHubMenuRef = useRef<HTMLDivElement | null>(null);
  const [chatTitleProjectMenuOpen, setChatTitleProjectMenuOpen] = useState(false);
  const chatTitleProjectButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatTitleProjectMenuRef = useRef<HTMLDivElement | null>(null);
  const [chatTitlePromptMenuOpen, setChatTitlePromptMenuOpen] = useState(false);
  const chatTitlePromptButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatTitlePromptMenuRef = useRef<HTMLDivElement | null>(null);
  const [chatQuickSwitchMenuOpen, setChatQuickSwitchMenuOpen] = useState(false);
  const [chatQuickSwitchMenuPlacement, setChatQuickSwitchMenuPlacement] = useState<ChatQuickSwitchMenuPlacement>({kind: 'mobile'});
  const [chatQuickSwitchCreateProjectId, setChatQuickSwitchCreateProjectId] = useState('');
  const [chatQuickSwitchCreatePendingKey, setChatQuickSwitchCreatePendingKey] = useState('');
  const chatQuickSwitchMenuRef = useRef<HTMLDivElement | null>(null);
  const [chatSlashQuery, setChatSlashQuery] = useState<string | null>(null);
  const [chatSlashActiveIndex, setChatSlashActiveIndex] = useState(0);
  const chatFileMentionQuerySessionIdRef = useRef(`file-query-${Date.now()}`);
  const chatFileMentionQueryIdRef = useRef(0);
  const chatFileMentionSearchTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const chatFileMentionSearchGenerationRef = useRef(0);
  const [resumeSessions, setResumeSessions] = useState<RegistryResumableSession[]>([]);
  const [resumeLoading, setResumeLoading] = useState(false);

  function knownChatSessionsForProject(targetProjectId: string): RegistryChatSession[] {
    const projectSessions = projectSessionsByProjectIdRef.current[targetProjectId] ?? [];
    if (!shouldUpdateCurrentProjectSessions(targetProjectId, projectIdRef.current)) {
      return projectSessions;
    }
    return mergeKnownChatSessions(projectSessions, chatSessionsRef.current);
  }

  function mergeKnownChatSessionForProject(
    targetProjectId: string,
    session: RegistryChatSession,
  ): RegistryChatSession {
    return mergeChatSession(knownChatSessionsForProject(targetProjectId), session)
      .find(item => item.sessionId === session.sessionId) ?? session;
  }

  const selectedChatEncodedKey = useMemo(
    () => encodeChatSessionKey(selectedChatKey),
    [selectedChatKey],
  );

  const selectedChatSession = useMemo(
    () => {
      if (!selectedChatKey) {
        return undefined;
      }
      const projectSession = projectSessionsByProjectId[selectedChatKey.projectId]
        ?.find(item => item.sessionId === selectedChatKey.sessionId);
      const currentProjectSession =
        selectedChatKey.projectId === projectId
          ? chatSessions.find(item => item.sessionId === selectedChatKey.sessionId)
          : undefined;
      if (projectSession && currentProjectSession) {
        return mergeChatSession([projectSession], currentProjectSession)[0];
      }
      return projectSession ?? currentProjectSession;
    },
    [chatSessions, projectId, projectSessionsByProjectId, selectedChatKey],
  );

  const selectedDraftChatSession = useMemo(
    () => {
      if (!selectedChatKey || !isDraftChatSessionId(selectedChatKey.sessionId)) {
        return undefined;
      }
      return draftSessionsByProjectId[selectedChatKey.projectId]
        ?.find(item => item.draftId === selectedChatKey.sessionId);
    },
    [draftSessionsByProjectId, selectedChatKey],
  );

  const selectedChatConfigOptions = useMemo(() => {
    return selectedChatSession?.configOptions ?? [];
  }, [selectedChatSession]);

  const selectedFastModeOption = useMemo(
    () => selectedChatConfigOptions.find(option => option.id === 'fast_mode'),
    [selectedChatConfigOptions],
  );

  const chatContextUsage = useMemo(
    () => selectedChatSession ? formatChatContextUsage(selectedChatSession.usage) : null,
    [selectedChatSession],
  );

  const updateChatContextUsagePopoverPosition = useCallback(() => {
    const anchor = chatContextUsageRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const right = Math.max(12, window.innerWidth - rect.right - 8);
    const bottom = Math.max(12, window.innerHeight - rect.top + 10);
    setChatContextUsagePopoverStyle({
      '--chat-context-usage-popover-right': `${right}px`,
      '--chat-context-usage-popover-bottom': `${bottom}px`,
    } as React.CSSProperties);
  }, []);

  const selectedFullChatMessages =
    selectedChatEncodedKey
      ? chatMessageStoreRef.current[selectedChatEncodedKey] ?? []
      : [];
  const selectedChatPlan = useMemo(
    () => tab === 'chat' && !archivedMode
      ? extractLatestChatPlan(selectedFullChatMessages)
      : null,
    [archivedMode, selectedFullChatMessages, tab],
  );
  const selectedChatPromptHistory = useMemo(
    () =>
      [...selectedFullChatMessages]
        .filter(message => isPromptStartMessage(message))
        .sort((left, right) => (left.turnIndex ?? 0) - (right.turnIndex ?? 0))
        .map((message, index) => {
          const turnIndex = Math.max(0, Math.trunc(message.turnIndex ?? 0));
          const fallback = `Prompt ${index + 1}`;
          return {
            key: `${message.sessionId}:${turnIndex}:${message.method}`,
            label: fallback,
            preview: summarizeChatTitlePrompt(msgText(message.method, message.param), fallback),
            turnIndex,
          };
        })
        .filter(item => item.turnIndex > 0),
    [selectedFullChatMessages],
  );
  const activeChatPromptHistory = tab === 'chat' && !archivedMode ? selectedChatPromptHistory : [];
  const chatTitlePromptMenuAvailable = activeChatPromptHistory.length > 0;
  const chatTitleProjectMenuStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!chatTitleProjectMenuOpen || typeof window === 'undefined') {
      return undefined;
    }
    const anchor = chatTitleProjectButtonRef.current?.getBoundingClientRect();
    if (!anchor) {
      return undefined;
    }
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const menuWidth = Math.min(360, Math.max(260, viewportWidth - 24));
    const left = Math.max(12, Math.min(anchor.left, viewportWidth - menuWidth - 12));
    return {
      left,
      top: Math.max(12, anchor.bottom + 7),
      width: menuWidth,
    };
  }, [chatTitleProjectMenuOpen, isWide]);
  const chatTitlePromptMenuStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!chatTitlePromptMenuOpen || !chatTitlePromptMenuAvailable || typeof window === 'undefined') {
      return undefined;
    }
    const anchor = chatTitlePromptButtonRef.current?.getBoundingClientRect();
    if (!anchor) {
      return undefined;
    }
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const menuWidth = Math.min(430, Math.max(280, viewportWidth - 24));
    const left = Math.max(12, Math.min(anchor.left, viewportWidth - menuWidth - 12));
    return {
      left,
      top: Math.max(12, anchor.bottom + 7),
      width: menuWidth,
    };
  }, [chatTitlePromptMenuAvailable, chatTitlePromptMenuOpen, isWide]);

  const selectedPendingPrompt = selectedChatEncodedKey
    ? chatPendingPromptsByKey[selectedChatEncodedKey]
    : undefined;
  const selectedQueuedPrompts = useMemo(
    () => selectedChatEncodedKey
      ? queuedChatPrompts(chatQueuedPromptsByKey, selectedChatEncodedKey)
      : [],
    [chatQueuedPromptsByKey, selectedChatEncodedKey],
  );
  const queuedPromptTurnIndex = useCallback(
    (index: number) => nextPromptTurnIndex(selectedFullChatMessages) + index + 1,
    [selectedFullChatMessages],
  );
  const selectedChatSubmitPending = selectedChatEncodedKey
    ? chatSubmittingByKey[selectedChatEncodedKey] === true
    : false;

  const chatDisplayIndex = useMemo(() => buildChatDisplayIndex(chatMessages, {
    hideToolCalls,
    layoutMetrics: chatLayoutMetrics,
    promptStatus: message => isPromptStartMessage(message)
      ? resolvePromptTurnStatus(selectedFullChatMessages, message)
      : null,
    shouldRender: (message, promptStatus) => {
      const resolvedPromptStatus = isPromptStartMessage(message)
        ? promptStatus
        : null;
      return shouldRenderChatTurn(message, hideToolCalls, resolvedPromptStatus);
    },
    pendingKey: selectedPendingPrompt
      ? `${selectedChatEncodedKey}:pending:${selectedPendingPrompt.createdAt}`
      : undefined,
    pendingEstimatedHeight: 120,
    queuedKeys: selectedQueuedPrompts.map(prompt => `${selectedChatEncodedKey}:queued:${prompt.id}`),
    queuedEstimatedHeight: 128,
  }), [
    chatMessages,
    chatLayoutMetrics,
    hideToolCalls,
    selectedChatEncodedKey,
    selectedFullChatMessages,
    selectedPendingPrompt,
    selectedQueuedPrompts,
  ]);
  const archivedChatDisplayIndex = useMemo(() => buildChatDisplayIndex(archivedPreview?.messages ?? [], {
    hideToolCalls,
    layoutMetrics: chatLayoutMetrics,
    promptStatus: () => null,
    shouldRender: (message, promptStatus) => shouldRenderChatTurn(message, hideToolCalls, promptStatus),
  }), [archivedPreview?.messages, chatLayoutMetrics, hideToolCalls]);

  useEffect(() => {
    if (
      !sessionSearchTargetTurn ||
      sessionSearchTargetTurn.runtimeKey !== selectedChatEncodedKey ||
      chatDisplayIndex.items.length === 0
    ) {
      return;
    }
    const searchTargetTurnIsVisible = chatDisplayIndex.items.some(
      item => item.turnIndex === sessionSearchTargetTurn.turnIndex,
    );
    if (!searchTargetTurnIsVisible) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      chatVirtuosoListRef.current?.scrollToTurnIndex(sessionSearchTargetTurn.turnIndex, 'smooth');
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [chatDisplayIndex, selectedChatEncodedKey, sessionSearchTargetTurn]);

  const chatComposerStatusCompact = !isWide || windowWidth < 980 || (chatPreviewOpen && windowWidth < 1280);

  const chatConfigDisplay = useMemo(() => {
    const status = splitChatComposerStatusOptions(selectedChatConfigOptions, chatComposerStatusCompact);
    return {
      status,
      visible: [
        ...(status.modelOption ? [status.modelOption] : []),
        ...(status.reasoningOption ? [status.reasoningOption] : []),
        ...status.secondaryOptions,
      ],
      overflow: status.overflowOptions,
    };
  }, [chatComposerStatusCompact, selectedChatConfigOptions]);

  const chatSlashSkills = useMemo(() => {
    const currentProject = projects.find(item => item.projectId === projectId);
    const deduped = new Map<string, string>();
    for (const profile of currentProject?.agentProfiles ?? []) {
      for (const skill of profile.skills ?? []) {
        const normalized = (skill || '').trim();
        if (!normalized) {
          continue;
        }
        const key = normalized.toLowerCase();
        if (!deduped.has(key)) {
          deduped.set(key, normalized);
        }
      }
    }
    return Array.from(deduped.values()).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  }, [projects, projectId]);

  const chatSlashCommands = useMemo(
    () => buildChatSessionActionOptions(
      chatSlashSkills,
      selectedChatSession?.sessionActions,
      selectedChatConfigOptions,
    ),
    [chatSlashSkills, selectedChatConfigOptions, selectedChatSession?.sessionActions],
  );

  const chatSlashCommandOptions = useMemo(
    () => filterChatSessionActionOptions(chatSlashCommands, chatSlashQuery),
    [chatSlashCommands, chatSlashQuery],
  );

  const chatSlashMenuOptions = useMemo(
    () => chatSlashCommandOptions,
    [chatSlashCommandOptions],
  );

  const chatSlashMenuVisible = chatPromptMenuOpen && !chatFileMentionMenuOpen && !chatAttachmentTrayOpen && chatSlashMenuOptions.length > 0;


  const currentChatDraftKey = useMemo(
    () => buildChatDraftKey(selectedChatKey?.projectId ?? projectId, selectedChatId),
    [projectId, selectedChatId, selectedChatKey?.projectId],
  );

  const buildChatRuntimeKey = (
    activeProjectId: string,
    sessionId: string,
  ): string => encodeChatSessionKey(chatSessionKeyFromParts(activeProjectId, sessionId));

  const commitDraftSessionsByProjectId = (next: Record<string, DraftChatSession[]>) => {
    draftSessionsByProjectIdRef.current = next;
    setDraftSessionsByProjectId(next);
  };

  const updateProjectDraftSessions = (
    targetProjectId: string,
    updater: (drafts: DraftChatSession[]) => DraftChatSession[],
  ) => {
    if (!targetProjectId) {
      return;
    }
    const currentMap = draftSessionsByProjectIdRef.current;
    const currentDrafts = currentMap[targetProjectId] ?? [];
    const nextDrafts = updater(currentDrafts);
    if (nextDrafts === currentDrafts) {
      return;
    }
    const nextMap = {...currentMap};
    if (nextDrafts.length > 0) {
      nextMap[targetProjectId] = nextDrafts;
    } else {
      delete nextMap[targetProjectId];
    }
    commitDraftSessionsByProjectId(nextMap);
  };

  const updateDraftChatSession = (
    targetProjectId: string,
    draftId: string,
    updater: (draft: DraftChatSession) => DraftChatSession,
  ) => {
    updateProjectDraftSessions(targetProjectId, drafts => {
      let changed = false;
      const next = drafts.map(draft => {
        if (draft.draftId !== draftId) {
          return draft;
        }
        changed = true;
        return updater(draft);
      });
      return changed ? next : drafts;
    });
  };

  const findDraftChatSession = (
    targetProjectId: string,
    draftId: string,
  ): DraftChatSession | undefined => (
    draftSessionsByProjectIdRef.current[targetProjectId]
      ?.find(item => item.draftId === draftId)
  );

  const registerCreatedProjectSession = (
    targetProjectId: string,
    session: RegistryChatSession,
  ) => {
    workspaceStore.rememberChatSession(targetProjectId, session, {turnIndex: 0});
    setProjectSessionsByProjectId(prev => ({
      ...prev,
      [targetProjectId]: mergeChatSession(prev[targetProjectId] ?? [], session),
    }));
    const runtimeKey = buildChatRuntimeKey(targetProjectId, session.sessionId);
    chatMessageStoreRef.current[runtimeKey] = chatMessageStoreRef.current[runtimeKey] ?? [];
    chatTurnStoreRef.current[runtimeKey] = chatTurnStoreRef.current[runtimeKey] ?? createEmptyChatTurnStore();
    chatFinishedCursorRef.current[runtimeKey] = chatFinishedCursorRef.current[runtimeKey] ?? 0;
    if (targetProjectId === projectIdRef.current) {
      setChatSessions(prev => mergeChatSession(prev, session));
    }
  };

  const moveChatRuntimeState = (
    fromRuntimeKey: string,
    toRuntimeKey: string,
    sessionId: string,
  ) => {
    if (!fromRuntimeKey || !toRuntimeKey || fromRuntimeKey === toRuntimeKey) {
      return;
    }
    if (chatMessageStoreRef.current[fromRuntimeKey] && !chatMessageStoreRef.current[toRuntimeKey]) {
      chatMessageStoreRef.current[toRuntimeKey] = chatMessageStoreRef.current[fromRuntimeKey];
    }
    if (chatTurnStoreRef.current[fromRuntimeKey] && !chatTurnStoreRef.current[toRuntimeKey]) {
      chatTurnStoreRef.current[toRuntimeKey] = chatTurnStoreRef.current[fromRuntimeKey];
    }
    if (
      chatFinishedCursorRef.current[fromRuntimeKey] !== undefined &&
      chatFinishedCursorRef.current[toRuntimeKey] === undefined
    ) {
      chatFinishedCursorRef.current[toRuntimeKey] = chatFinishedCursorRef.current[fromRuntimeKey];
    }
    movePendingChatPrompt(fromRuntimeKey, toRuntimeKey, sessionId);
    setQueuedPrompts(current => moveQueuedChatPrompts(current, fromRuntimeKey, toRuntimeKey, sessionId));
  };

  const moveChatComposerDraft = (fromDraftKey: string, toDraftKey: string) => {
    if (!fromDraftKey || !toDraftKey || fromDraftKey === toDraftKey) {
      return;
    }
    const sourceDraft = chatComposerDraftsRef.current[fromDraftKey];
    if (sourceDraft) {
      const nextDrafts = {...chatComposerDraftsRef.current};
      if (!nextDrafts[toDraftKey]) {
        nextDrafts[toDraftKey] = sourceDraft;
      }
      delete nextDrafts[fromDraftKey];
      chatComposerDraftsRef.current = nextDrafts;
      setChatComposerDrafts(nextDrafts);
    }
    const sourceGeneration = chatDraftGenerationRef.current[fromDraftKey];
    if (sourceGeneration !== undefined && chatDraftGenerationRef.current[toDraftKey] === undefined) {
      chatDraftGenerationRef.current[toDraftKey] = sourceGeneration;
    }
    delete chatDraftGenerationRef.current[fromDraftKey];
    if (currentChatDraftKeyRef.current === fromDraftKey) {
      currentChatDraftKeyRef.current = toDraftKey;
    }
  };

  const applyDraftSessionCreateSuccess = (
    targetProjectId: string,
    draft: DraftChatSession,
    session: RegistryChatSession,
  ) => {
    registerCreatedProjectSession(targetProjectId, session);
    const draftRuntimeKey = buildChatRuntimeKey(targetProjectId, draft.draftId);
    const realRuntimeKey = buildChatRuntimeKey(targetProjectId, session.sessionId);
    moveChatRuntimeState(draftRuntimeKey, realRuntimeKey, session.sessionId);
    moveChatComposerDraft(
      buildChatDraftKey(targetProjectId, draft.draftId),
      buildChatDraftKey(targetProjectId, session.sessionId),
    );
    updateProjectDraftSessions(
      targetProjectId,
      drafts => removeDraftChatSession(drafts, draft.draftId),
    );
    const currentSelection = selectedChatKeyRef.current;
    const nextSelection = resolveDraftReplacementSelection({
      currentSelectedKey: currentSelection,
      draft,
      realSessionId: session.sessionId,
    });
    if (encodeChatSessionKey(nextSelection) !== encodeChatSessionKey(currentSelection)) {
      applySelectedChatKey(nextSelection);
      workspaceStore.rememberSelectedChatSessionKey(nextSelection);
      setVisibleChatMessagesForRuntimeKey(
        realRuntimeKey,
        chatMessageStoreRef.current[realRuntimeKey] ?? [],
        {resetToLatest: true},
      );
    }
  };

  const reconcileCreatedDraftSessions = (
    targetProjectId: string,
    sessions: RegistryChatSession[],
  ) => {
    for (const session of sessions) {
      const draft = findDraftChatSessionForCreatedSession(
        draftSessionsByProjectIdRef.current[targetProjectId] ?? [],
        session,
      );
      if (!draft) {
        continue;
      }
      applyDraftSessionCreateSuccess(targetProjectId, draft, session);
      if (draft.errorMessage) {
        setError(current => current === draft.errorMessage ? '' : current);
      }
    }
  };

  const startDraftSessionCreate = (
    targetProjectId: string,
    agentType: string,
    draftId: string,
  ): Promise<RegistryChatSession> => {
    const createKey = buildChatRuntimeKey(targetProjectId, draftId);
    const existing = draftSessionCreatePromisesRef.current[createKey];
    if (existing) {
      return existing;
    }
    const draft = findDraftChatSession(targetProjectId, draftId);
    if (!draft) {
      return Promise.reject(new Error('Draft session is no longer available.'));
    }
    if (!canStartDraftChatSessionCreate(draft)) {
      return Promise.reject(new Error(draft.errorMessage || 'Session create failed.'));
    }
    const promise = service.createProjectSession(targetProjectId, agentType, '', draft.draftId)
      .then(result => {
        if (!result.ok || !result.session.sessionId) {
          throw new Error('project session.create returned ok=false');
        }
        const latestDraft = findDraftChatSession(targetProjectId, draftId) ?? draft;
        applyDraftSessionCreateSuccess(targetProjectId, latestDraft, result.session);
        return result.session;
      })
      .catch(err => {
        const message = err instanceof Error ? err.message : String(err);
        updateDraftChatSession(
          targetProjectId,
          draftId,
          current => markDraftChatSessionFailed(current, message),
        );
        throw err;
      })
      .finally(() => {
        const next = {...draftSessionCreatePromisesRef.current};
        delete next[createKey];
        draftSessionCreatePromisesRef.current = next;
      });
    draftSessionCreatePromisesRef.current = {
      ...draftSessionCreatePromisesRef.current,
      [createKey]: promise,
    };
    return promise;
  };

  const runtimeKeysFromChatStores = (): string[] =>
    Array.from(new Set([
      ...Object.keys(chatTurnStoreRef.current),
      ...Object.keys(chatMessageStoreRef.current),
      ...Object.keys(chatFinishedCursorRef.current),
    ])).filter(runtimeKey => {
      const key = decodeChatSessionKey(runtimeKey);
      return !key || !isDraftChatSessionId(key.sessionId);
    });

  const ensureChatTurnStore = (runtimeKey: string): ChatTurnStoreState => {
    const existing = chatTurnStoreRef.current[runtimeKey];
    if (existing) return existing;
    const created = createEmptyChatTurnStore();
    chatTurnStoreRef.current[runtimeKey] = created;
    return created;
  };

  const decodeRawTurnsForSession = (
    sessionId: string,
    turns: RegistrySessionTurn[],
  ): RegistryChatMessage[] => turns
    .map(turn => decodeSessionTurnToMessage(sessionId, turn))
    .filter((item): item is RegistryChatMessage => !!item);

  const messagesFromTurnStore = (
    runtimeKey: string,
    sessionId: string,
  ): RegistryChatMessage[] => {
    const state = chatTurnStoreRef.current[runtimeKey];
    if (!state) return [];
    return decodeRawTurnsForSession(sessionId, buildMergedRawTurns(state));
  };

  const markChatSessionTurnsDirty = (runtimeKey: string): void => {
    chatDurablePersistQueueRef.current.markDirty(runtimeKey);
  };

  const setVisibleChatMessagesForRuntimeKey = useCallback((
    runtimeKey: string,
    fullMessages: RegistryChatMessage[],
    options?: { resetToLatest?: boolean; followLatest?: boolean; revealTurnIndex?: number },
  ) => {
    if (!runtimeKey) {
      chatVisibleRuntimeKeyRef.current = '';
      chatMessagesRef.current = [];
      setChatMessages([]);
      return;
    }
    const resettingToLatest = options?.resetToLatest === true;
    if (resettingToLatest && encodeChatSessionKey(selectedChatKeyRef.current) === runtimeKey) {
      chatAutoScrollFollowRef.current = true;
      chatUserScrollLockUntilRef.current = 0;
      chatPointerScrollingRef.current = false;
      setChatShowScrollToBottom(false);
    }
    const revealingTurn = Number.isFinite(options?.revealTurnIndex)
      ? Math.max(0, Math.trunc(options?.revealTurnIndex ?? 0))
      : 0;
    if (revealingTurn > 0 && encodeChatSessionKey(selectedChatKeyRef.current) === runtimeKey) {
      chatAutoScrollFollowRef.current = false;
      chatUserScrollLockUntilRef.current = 0;
      chatPointerScrollingRef.current = false;
      setChatShowScrollToBottom(true);
    }
    if (encodeChatSessionKey(selectedChatKeyRef.current) === runtimeKey) {
      chatVisibleRuntimeKeyRef.current = runtimeKey;
      chatMessagesRef.current = fullMessages;
      setChatMessages(fullMessages);
    }
  }, []);

  const applySelectedChatKey = (key: ChatSessionKey | null) => {
    selectedChatKeyRef.current = key;
    setSelectedChatKey(key);
    const sessionId = key?.sessionId ?? '';
    chatSelectedIdRef.current = sessionId;
    setSelectedChatId(sessionId);
  };

  const resizeChatComposerTextarea = useCallback((options: {scrollToEnd?: boolean} = {}) => {
    if (options.scrollToEnd) {
      chatRichComposerRef.current?.focus();
    }
  }, []);

  const markChatUserScrollIntent = useCallback(() => {
    chatUserScrollLockUntilRef.current = nextChatUserScrollLockUntil();
  }, []);

  const shouldAutoscrollChat = useCallback((force = false) => (
    shouldAutoScrollChatToBottom({
      force,
      followsLatest: chatAutoScrollFollowRef.current,
      pointerScrolling: chatPointerScrollingRef.current,
      userScrollLocked: isChatUserScrollLocked(chatUserScrollLockUntilRef.current),
    })
  ), []);

  const handleChatAtBottomChange = useCallback((atBottom: boolean) => {
    chatAutoScrollFollowRef.current = atBottom;
    setChatShowScrollToBottom(!atBottom);
  }, []);

  const handleChatScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const visibility = resolveChatScrollToBottomVisibility({
      scrollTop: event.currentTarget.scrollTop,
      scrollHeight: event.currentTarget.scrollHeight,
      clientHeight: event.currentTarget.clientHeight,
      threshold: CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD,
    });
    chatAutoScrollFollowRef.current = visibility.atBottom;
    setChatShowScrollToBottom(visibility.showScrollToBottom);
    if (chatQuickSwitchMenuPlacement.kind === 'desktop') {
      setChatQuickSwitchMenuOpen(false);
    }
  }, [chatQuickSwitchMenuPlacement.kind]);

  const scrollChatToBottom = useCallback((force = false) => {
    if (!shouldAutoscrollChat(force)) {
      return;
    }
    window.requestAnimationFrame(() => {
      if (!shouldAutoscrollChat(force)) {
        return;
      }
      chatVirtuosoListRef.current?.scrollToBottom('auto');
      chatAutoScrollFollowRef.current = true;
      setChatShowScrollToBottom(false);
    });
  }, [shouldAutoscrollChat]);

  useEffect(() => {
    if (chatQuickSwitchMenuOpen) {
      return;
    }
    setChatQuickSwitchCreateProjectId('');
    setChatQuickSwitchCreatePendingKey('');
  }, [chatQuickSwitchMenuOpen]);

  const forceChatScrollToBottom = useCallback(() => {
    const runtimeKey = encodeChatSessionKey(selectedChatKeyRef.current);
    if (runtimeKey) {
      setVisibleChatMessagesForRuntimeKey(
        runtimeKey,
        chatMessageStoreRef.current[runtimeKey] ?? [],
        {resetToLatest: true},
      );
    }
    chatAutoScrollFollowRef.current = true;
    setChatShowScrollToBottom(false);
    scrollChatToBottom(true);
  }, [scrollChatToBottom, setVisibleChatMessagesForRuntimeKey]);

  const chatMainStyle = useMemo(
    () => ({
      '--chat-message-font-family': chatFontFamily,
      '--chat-scroll-bottom-offset': `${resolveChatScrollBottomButtonOffset({
        composerHeight: chatComposerHeight,
        keyboardInset: chatKeyboardInset,
      })}px`,
      ...(chatKeyboardInset > 0 ? { paddingBottom: `${chatKeyboardInset}px` } : {}),
    }) as React.CSSProperties,
    [chatComposerHeight, chatFontFamily, chatKeyboardInset],
  );
  const chatMainClassName = isWide
    ? (chatViewWidth === 'fixed-800' ? 'chat-main chat-view-width-fixed-800' : 'chat-main')
    : 'chat-main';
  const desktopChatFixedPreview = isWide && chatPreviewOpen && chatViewWidth === 'fixed-800';

  useEffect(() => {
    if (!toastMessage) return undefined;
    const timer = window.setTimeout(() => setToastMessage(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => workspaceStore.subscribeStorageErrors(storageError => {
    setToastMessage(storageError.quotaExceeded
      ? 'Local storage is full. Cache was cleared, but settings could not be saved.'
      : 'Local settings could not be saved. Export the database from Settings for diagnostics.');
  }), []);

  useEffect(() => {
    if (!chatSlashMenuVisible) {
      setChatSlashActiveIndex(0);
      return;
    }
    setChatSlashActiveIndex(prev => Math.max(0, Math.min(prev, chatSlashMenuOptions.length - 1)));
  }, [chatSlashMenuVisible, chatSlashMenuOptions]);

  useEffect(() => {
    if (!chatSlashMenuVisible) {
      return;
    }
    const menu = chatSlashMenuRef.current;
    if (!menu) {
      return;
    }
    const activeItem = menu.querySelector<HTMLElement>('.chat-slash-item.active');
    if (!activeItem) {
      return;
    }
    activeItem.scrollIntoView({ block: 'nearest' });
  }, [chatSlashMenuVisible, chatSlashActiveIndex, chatSlashMenuOptions]);

  useEffect(() => {
    if (!chatFileMentionMenuOpen) {
      setChatFileMentionActiveIndex(0);
      return;
    }
    setChatFileMentionActiveIndex(prev => Math.max(0, Math.min(prev, chatFileMentionResults.length - 1)));
  }, [chatFileMentionMenuOpen, chatFileMentionResults]);

  useEffect(() => {
    if (!chatFileMentionMenuOpen) {
      return;
    }
    const menu = chatFileMentionMenuRef.current;
    if (!menu) {
      return;
    }
    const activeItem = menu.querySelector<HTMLElement>('.chat-file-mention-option.active');
    if (!activeItem) {
      return;
    }
    activeItem.scrollIntoView({ block: 'nearest' });
  }, [chatFileMentionMenuOpen, chatFileMentionActiveIndex, chatFileMentionResults]);

  const saveChatComposerDraft = useCallback(
    (
      draftKey: string,
      text: string,
      attachments: ChatAttachment[],
      tokens: ChatComposerToken[] = chatComposerTokensRef.current,
    ) => {
      const normalizedKey = draftKey.trim();
      if (!normalizedKey) {
        return;
      }
      const prev = chatComposerDraftsRef.current;
      const existing = prev[normalizedKey] ?? EMPTY_CHAT_COMPOSER_DRAFT;
      const normalizedTokens = normalizeChatComposerTokens(tokens);
      const hasContent = text.length > 0 || attachments.length > 0 || normalizedTokens.length > 0;
      if (!hasContent) {
        if (!(normalizedKey in prev)) {
          return;
        }
        const next = { ...prev };
        delete next[normalizedKey];
        chatComposerDraftsRef.current = next;
        setChatComposerDrafts(next);
        return;
      }
      if (
        existing.text === text &&
        existing.attachments === attachments &&
        chatComposerTokensEqual(existing.tokens, normalizedTokens)
      ) {
        return;
      }
      const next = {
        ...prev,
        [normalizedKey]: {
          text,
          tokens: normalizedTokens,
          attachments,
        },
      };
      chatComposerDraftsRef.current = next;
      setChatComposerDrafts(next);
    },
    [],
  );

  const requestChatComposerSelectionRestore = useCallback((cursor: number) => {
    const safeCursor = Math.max(0, Math.floor(cursor));
    chatComposerTextCursorRef.current = safeCursor;
    chatComposerSelectionRestoreRevisionRef.current += 1;
    setChatComposerSelectionRestore({
      revision: chatComposerSelectionRestoreRevisionRef.current,
      cursor: safeCursor,
    });
  }, []);

  const updateChatComposerTokens = useCallback(
    (nextTokens: ChatComposerToken[]) => {
      const normalizedTokens = normalizeChatComposerTokens(nextTokens);
      const serialized = serializeChatComposerTokens(normalizedTokens);
      chatComposerTokensRef.current = normalizedTokens;
      chatComposerTextRef.current = serialized.text;
      chatComposerTextCursorRef.current = serialized.text.length;
      setChatComposerTokens(normalizedTokens);
      setChatComposerText(serialized.text);
      saveChatComposerDraft(
        currentChatDraftKeyRef.current,
        serialized.text,
        chatAttachmentsRef.current,
        normalizedTokens,
      );
    },
    [saveChatComposerDraft],
  );

  const updateChatComposerText = useCallback(
    (nextText: string, cursor?: number) => {
      const nextTokens = chatComposerTokensFromText(nextText);
      const nextCursor = typeof cursor === 'number'
        ? Math.max(0, Math.min(nextText.length, Math.floor(cursor)))
        : nextText.length;
      chatComposerTokensRef.current = nextTokens;
      setChatComposerTokens(nextTokens);
      chatComposerTextRef.current = nextText;
      chatComposerTextCursorRef.current = nextCursor;
      setChatComposerText(nextText);
      if (typeof cursor === 'number') {
        requestChatComposerSelectionRestore(nextCursor);
      }
      saveChatComposerDraft(
        currentChatDraftKeyRef.current,
        nextText,
        chatAttachmentsRef.current,
        nextTokens,
      );
    },
    [requestChatComposerSelectionRestore, saveChatComposerDraft],
  );

  const closeChatAttachmentTray = useCallback(() => {
    setChatAttachmentTrayOpen(false);
  }, []);

  const scheduleChatSlashMenu = useCallback((text: string, cursor: number) => {
    const slashQuery = resolveChatSlashQuery(text, cursor);
    if (!slashQuery) {
      setChatPromptMenuOpen(false);
      setChatSlashQuery(null);
      setChatSlashActiveIndex(0);
      return;
    }
    setChatFileMentionMenuOpen(false);
    setChatAttachmentTrayOpen(false);
    setChatPromptMenuOpen(true);
    setChatSlashQuery(slashQuery.query.toLowerCase());
    setChatSlashActiveIndex(0);
  }, []);

  const applyChatSlashCommand = useCallback(
    (command: ChatSessionSlashOption) => {
      setChatPromptMenuOpen(false);
      setChatFileMentionMenuOpen(false);
      setChatAttachmentTrayOpen(false);
      setChatConfigMenuOptionId('');
      setChatConfigOverflowOpen(false);
      if (command.behavior === 'invoke') {
        if (!command.enabled || !command.action) {
          setError(command.disabledReason || 'This action is unavailable.');
          return;
        }
        const next = removeActiveSlashQuery(
          chatComposerTextRef.current,
          chatComposerTextCursorRef.current,
        );
        updateChatComposerText(next.text, next.cursor);
        invokeChatSessionAction(command.action).catch(err => {
          setError(err instanceof Error ? err.message : String(err));
        });
        window.requestAnimationFrame(() => {
          chatRichComposerRef.current?.focus();
        });
        return;
      }
      chatRichComposerRef.current?.insertSkill({
        command: command.name,
        label: chatSlashCommandLabel(command.name),
      });
      window.requestAnimationFrame(() => {
        chatRichComposerRef.current?.focus();
      });
    },
    [setChatConfigOverflowOpen, updateChatComposerText],
  );

  const openChatPromptMenu = useCallback(() => {
    const text = chatComposerTextRef.current;
    const selectionStart = text.length;
    const existingQuery = resolveChatSlashQuery(text, selectionStart);

    setChatFileMentionMenuOpen(false);
    setChatAttachmentTrayOpen(false);
    setChatConfigMenuOptionId('');
    setChatConfigOverflowOpen(false);

    if (existingQuery) {
      scheduleChatSlashMenu(text, selectionStart);
      window.requestAnimationFrame(() => {
        chatRichComposerRef.current?.focus();
      });
      return;
    }

    const prefix = text && !/\s$/.test(text) ? ' /' : '/';
    chatRichComposerRef.current?.insertText(prefix);
    const nextText = `${text}${prefix}`;
    scheduleChatSlashMenu(nextText, nextText.length);
    window.requestAnimationFrame(() => {
      chatRichComposerRef.current?.focus();
    });
  }, [scheduleChatSlashMenu, setChatConfigOverflowOpen]);

  const toggleChatAttachmentTray = useCallback(() => {
    setChatPromptMenuOpen(false);
    setChatFileMentionMenuOpen(false);
    setChatConfigMenuOptionId('');
    setChatConfigOverflowOpen(false);
    setChatAttachmentTrayOpen(value => !value);
    window.requestAnimationFrame(() => {
      chatRichComposerRef.current?.focus();
    });
  }, [setChatConfigOverflowOpen]);

  const getChatDraftGeneration = useCallback((draftKey: string) => {
    const normalizedDraftKey = draftKey.trim();
    if (!normalizedDraftKey) {
      return 0;
    }
    return chatDraftGenerationRef.current[normalizedDraftKey] ?? 0;
  }, []);

  const bumpChatDraftGeneration = useCallback(
    (draftKey: string) => {
      const normalizedDraftKey = draftKey.trim();
      if (!normalizedDraftKey) {
        return 0;
      }
      const nextGeneration = getChatDraftGeneration(normalizedDraftKey) + 1;
      chatDraftGenerationRef.current[normalizedDraftKey] = nextGeneration;
      return nextGeneration;
    },
    [getChatDraftGeneration],
  );

  const applyChatAttachments = useCallback(
    (
      updater: (current: ChatAttachment[]) => ChatAttachment[],
      draftKey = currentChatDraftKeyRef.current,
      expectedGeneration = getChatDraftGeneration(draftKey),
    ) => {
      const normalizedDraftKey = draftKey.trim();
      if (!normalizedDraftKey) {
        return;
      }
      if (expectedGeneration !== getChatDraftGeneration(normalizedDraftKey)) {
        return;
      }
      if (normalizedDraftKey === currentChatDraftKeyRef.current) {
        const next = updater(chatAttachmentsRef.current);
        if (next === chatAttachmentsRef.current) {
          return;
        }
        chatAttachmentsRef.current = next;
        setChatAttachments(next);
        saveChatComposerDraft(
          normalizedDraftKey,
          chatComposerTextRef.current,
          next,
        );
        if (next.length === 0 && chatFileInputRef.current) {
          chatFileInputRef.current.value = '';
        }
        return;
      }
      const currentDraft =
        chatComposerDraftsRef.current[normalizedDraftKey] ??
        EMPTY_CHAT_COMPOSER_DRAFT;
      const next = updater(currentDraft.attachments);
      if (next === currentDraft.attachments) {
        return;
      }
      saveChatComposerDraft(normalizedDraftKey, currentDraft.text, next, currentDraft.tokens);
    },
    [getChatDraftGeneration, saveChatComposerDraft],
  );

  const clearChatFileMentionSearchTimer = useCallback(() => {
    if (chatFileMentionSearchTimerRef.current !== null) {
      window.clearTimeout(chatFileMentionSearchTimerRef.current);
      chatFileMentionSearchTimerRef.current = null;
    }
  }, []);

  const resetChatFileMentionSearchSession = useCallback(() => {
    clearChatFileMentionSearchTimer();
    chatFileMentionQuerySessionIdRef.current = `file-query-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    chatFileMentionQueryIdRef.current = 0;
    chatFileMentionSearchGenerationRef.current += 1;
    setChatFileMentionQuery('');
    setChatFileMentionResults([]);
    setChatFileMentionLoading(false);
    setChatFileMentionError('');
    setChatFileMentionIndexed(true);
    setChatFileMentionActiveIndex(0);
  }, [clearChatFileMentionSearchTimer]);

  const runChatFileMentionSearch = useCallback(
    async (query: string, generation: number) => {
      const activeProjectId = selectedChatKeyRef.current?.projectId || projectIdRef.current;
      if (!activeProjectId) {
        setChatFileMentionError('Select a chat session first.');
        setChatFileMentionLoading(false);
        return;
      }
      const queryId = chatFileMentionQueryIdRef.current + 1;
      chatFileMentionQueryIdRef.current = queryId;
      setChatFileMentionLoading(true);
      setChatFileMentionError('');
      try {
        const response = await service.searchFileIndex(activeProjectId, {
          query,
          querySessionId: chatFileMentionQuerySessionIdRef.current,
          queryId,
          limit: CHAT_FILE_MENTION_SEARCH_LIMIT,
        });
        if (generation !== chatFileMentionSearchGenerationRef.current) {
          return;
        }
        setChatFileMentionIndexed(response.indexed);
        setChatFileMentionResults(response.results ?? []);
        setChatFileMentionActiveIndex(0);
        setChatFileMentionError(response.error || '');
      } catch (err) {
        if (generation !== chatFileMentionSearchGenerationRef.current) {
          return;
        }
        setChatFileMentionResults([]);
        setChatFileMentionIndexed(true);
        setChatFileMentionError(err instanceof Error ? err.message : String(err));
      } finally {
        if (generation === chatFileMentionSearchGenerationRef.current) {
          setChatFileMentionLoading(false);
        }
      }
    },
    [],
  );

  const scheduleChatFileMentionSearch = useCallback(
    (text: string, cursor: number) => {
      const mentionQuery = resolveChatFileMentionQuery(text, cursor);
      clearChatFileMentionSearchTimer();
      if (!mentionQuery) {
        setChatFileMentionMenuOpen(false);
        resetChatFileMentionSearchSession();
        return;
      }
      setChatPromptMenuOpen(false);
      setChatAttachmentTrayOpen(false);
      setChatFileMentionMenuOpen(true);
      setChatFileMentionQuery(mentionQuery.query);
      setChatFileMentionLoading(true);
      const generation = chatFileMentionSearchGenerationRef.current + 1;
      chatFileMentionSearchGenerationRef.current = generation;
      chatFileMentionSearchTimerRef.current = window.setTimeout(() => {
        chatFileMentionSearchTimerRef.current = null;
        runChatFileMentionSearch(mentionQuery.query, generation).catch(() => undefined);
      }, CHAT_FILE_MENTION_DEBOUNCE_MS);
    },
    [clearChatFileMentionSearchTimer, resetChatFileMentionSearchSession, runChatFileMentionSearch],
  );

  const openChatFileMentionShortcut = useCallback(() => {
    const text = chatComposerTextRef.current;
    const selectionStart = text.length;
    const existingQuery = resolveChatFileMentionQuery(text, selectionStart);

    setChatPromptMenuOpen(false);
    setChatAttachmentTrayOpen(false);
    setChatConfigMenuOptionId('');
    setChatConfigOverflowOpen(false);

    if (existingQuery) {
      scheduleChatFileMentionSearch(text, selectionStart);
      window.requestAnimationFrame(() => {
        chatRichComposerRef.current?.focus();
      });
      return;
    }

    const prefix = text && !/\s$/.test(text) ? ' @' : '@';
    chatRichComposerRef.current?.insertText(prefix);
    const nextText = `${text}${prefix}`;
    scheduleChatFileMentionSearch(nextText, nextText.length);
    window.requestAnimationFrame(() => {
      chatRichComposerRef.current?.focus();
    });
  }, [scheduleChatFileMentionSearch, setChatConfigOverflowOpen]);

  const applyChatFileMentionResult = useCallback(
    (result: RegistryFileIndexSearchResult) => {
      const path = result.path.trim();
      if (!path) {
        return;
      }
      chatRichComposerRef.current?.insertFile({
        path,
        name: result.name?.trim() || chatFileMentionName(path),
      });
      setChatFileMentionMenuOpen(false);
      resetChatFileMentionSearchSession();
      window.requestAnimationFrame(() => {
        chatRichComposerRef.current?.focus();
      });
    },
    [resetChatFileMentionSearchSession],
  );

  const appendChatAttachments = useCallback(
    (
      nextAttachments: ChatAttachment[],
      draftKey = currentChatDraftKeyRef.current,
      expectedGeneration = getChatDraftGeneration(draftKey),
    ) => {
      if (nextAttachments.length === 0) {
        return;
      }
      applyChatAttachments(
        current => [...current, ...nextAttachments],
        draftKey,
        expectedGeneration,
      );
    },
    [applyChatAttachments, getChatDraftGeneration],
  );

  const updateChatAttachment = useCallback(
    (
      attachmentId: string,
      updater: (attachment: ChatAttachment) => ChatAttachment,
      draftKey = currentChatDraftKeyRef.current,
      expectedGeneration = getChatDraftGeneration(draftKey),
    ) => {
      applyChatAttachments(
        current => current.map(attachment => (
          attachment.id === attachmentId ? updater(attachment) : attachment
        )),
        draftKey,
        expectedGeneration,
      );
    },
    [applyChatAttachments, getChatDraftGeneration],
  );

  const removeChatAttachment = useCallback(
    (attachmentId: string) => {
      if (!attachmentId) {
        return;
      }
      const attachment = chatAttachmentsRef.current.find(item => item.id === attachmentId);
      if (!attachment) {
        return;
      }
      revokeChatAttachmentObjectUrl(attachment);
      const selectedKey = selectedChatKeyRef.current;
      if (selectedKey?.sessionId) {
        const selectedProjectId = selectedKey.projectId;
        if (attachment.uploadId && isChatAttachmentUploadPending(attachment)) {
          chatAttachmentCancelIdsRef.current.add(attachment.id);
          service.cancelProjectSessionAttachment(selectedProjectId, {
            sessionId: selectedKey.sessionId,
            uploadId: attachment.uploadId,
          }).catch(() => undefined);
        } else if (attachment.attachmentId && attachment.status === 'completed') {
          service.deleteProjectSessionAttachment(selectedProjectId, {
            sessionId: selectedKey.sessionId,
            attachmentId: attachment.attachmentId,
          }).catch(err => setError(err instanceof Error ? err.message : String(err)));
        }
      }
      applyChatAttachments(current => {
        const filtered = current.filter(attachment => attachment.id !== attachmentId);
        return filtered.length === current.length ? current : filtered;
      });
    },
    [applyChatAttachments],
  );

  const uploadChatAttachmentFile = useCallback(
    async (
      file: File,
      fallbackName: string,
      selectedProjectId: string,
      sessionId: string,
      attachmentId: string,
      draftKey: string,
      expectedGeneration: number,
    ): Promise<ChatAttachment> => {
      const attachmentName = file.name || fallbackName;
      let uploadId = '';
      try {
        updateChatAttachment(
          attachmentId,
          attachment => ({...attachment, status: 'uploading', progress: 1, error: '', uploadId: undefined}),
          draftKey,
          expectedGeneration,
        );
        const start = await service.startProjectSessionAttachment(selectedProjectId, {
          sessionId,
          name: attachmentName,
          mimeType: file.type || '',
          size: file.size,
        });
        if (!start.ok || !start.uploadId) {
          throw new Error('session.attachment.start returned ok=false');
        }
        uploadId = start.uploadId;
        updateChatAttachment(
          attachmentId,
          attachment => ({...attachment, uploadId, progress: Math.max(2, attachment.progress)}),
          draftKey,
          expectedGeneration,
        );
        const chunkSize = Math.max(1, start.chunkSize || CHAT_ATTACHMENT_CHUNK_SIZE);
        let offset = 0;
        while (offset < file.size) {
          if (chatAttachmentCancelIdsRef.current.has(attachmentId)) {
            throw new Error('Attachment upload cancelled');
          }
          const nextOffset = Math.min(file.size, offset + chunkSize);
          const data = await blobToBase64(file.slice(offset, nextOffset));
          const chunk = await service.uploadProjectSessionAttachmentChunk(selectedProjectId, {
            sessionId,
            uploadId,
            offset,
            data,
          });
          if (!chunk.ok) {
            throw new Error('session.attachment.chunk returned ok=false');
          }
          offset = nextOffset;
          const progress = file.size > 0 ? Math.max(3, Math.min(95, Math.round((offset / file.size) * 95))) : 95;
          updateChatAttachment(
            attachmentId,
            attachment => ({...attachment, progress}),
            draftKey,
            expectedGeneration,
          );
        }
        const sha256 = await sha256Hex(file);
        const finished = await service.finishProjectSessionAttachment(selectedProjectId, {
          sessionId,
          uploadId,
          sha256,
        });
        if (!finished.ok || !finished.block) {
          throw new Error('session.attachment.finish returned ok=false');
        }
        const completedPatch = {
          status: 'completed' as const,
          progress: 100,
          block: finished.block,
          attachmentId: finished.attachment?.id || attachmentIdFromBlock(finished.block),
          error: '',
        };
        let uploadedAttachment: ChatAttachment = {
          id: attachmentId,
          name: attachmentName,
          mimeType: file.type || '',
          size: file.size,
          status: completedPatch.status,
          progress: completedPatch.progress,
          file,
          block: completedPatch.block,
          attachmentId: completedPatch.attachmentId,
          error: completedPatch.error,
        };
        updateChatAttachment(
          attachmentId,
          attachment => {
            uploadedAttachment = {...attachment, ...completedPatch};
            return uploadedAttachment;
          },
          draftKey,
          expectedGeneration,
        );
        return uploadedAttachment;
      } catch (err) {
        if (uploadId && !chatAttachmentCancelIdsRef.current.has(attachmentId)) {
          service.cancelProjectSessionAttachment(selectedProjectId, {sessionId, uploadId}).catch(() => undefined);
        }
        if (!chatAttachmentCancelIdsRef.current.has(attachmentId)) {
          const message = err instanceof Error ? err.message : String(err);
          updateChatAttachment(
            attachmentId,
            attachment => ({...attachment, status: 'failed', error: message}),
            draftKey,
            expectedGeneration,
          );
          setError(message);
        }
        throw err;
      } finally {
        chatAttachmentCancelIdsRef.current.delete(attachmentId);
      }
    },
    [updateChatAttachment],
  );

  const uploadChatAttachmentsForSend = useCallback(
    async (
      attachments: ChatAttachment[],
      selectedProjectId: string,
      sessionId: string,
      draftKey: string,
      expectedGeneration: number,
    ): Promise<ChatAttachment[]> => {
      const uploadedAttachments: ChatAttachment[] = [];
      for (const attachment of attachments) {
        if (attachment.status === 'completed' && attachment.block) {
          uploadedAttachments.push(attachment);
          continue;
        }
        if (!attachment.file) {
          throw new Error('Attachment can only be uploaded before the page is refreshed.');
        }
        uploadedAttachments.push(await uploadChatAttachmentFile(
          attachment.file,
          attachment.name,
          selectedProjectId,
          sessionId,
          attachment.id,
          draftKey,
          expectedGeneration,
        ));
      }
      return uploadedAttachments;
    },
    [uploadChatAttachmentFile],
  );

  const enqueueChatAttachmentFiles = useCallback(
    (
      files: File[],
      draftKey = currentChatDraftKeyRef.current,
      expectedGeneration = getChatDraftGeneration(draftKey),
    ) => {
      if (files.length === 0) {
        return;
      }
      const attachments = files.map((file, index): ChatAttachment => {
        chatAttachmentIdRef.current += 1;
        const name = file.name || chatFallbackAttachmentName(index);
        return {
          id: `chat-attachment-${chatAttachmentIdRef.current}`,
          name,
          mimeType: file.type || '',
          size: file.size,
          status: 'queued',
          progress: 0,
          file,
          objectUrl: (file.type || '').toLowerCase().startsWith('image/') ? URL.createObjectURL(file) : undefined,
        };
      });
      appendChatAttachments(attachments, draftKey, expectedGeneration);
    },
    [appendChatAttachments, getChatDraftGeneration],
  );

  const retryChatAttachment = useCallback(
    (attachmentId: string) => {
      const attachment = chatAttachmentsRef.current.find(item => item.id === attachmentId);
      if (!attachment?.file) {
        setError('Attachment can only be retried before the page is refreshed.');
        return;
      }
      updateChatAttachment(
        attachmentId,
        current => ({...current, status: 'queued', progress: 0, error: '', uploadId: undefined, block: undefined, attachmentId: undefined}),
      );
    },
    [updateChatAttachment],
  );

  useEffect(() => {
    currentChatDraftKeyRef.current = currentChatDraftKey;
  }, [currentChatDraftKey]);

  useEffect(() => {
    chatComposerTextRef.current = chatComposerText;
  }, [chatComposerText]);

  useEffect(() => {
    chatComposerTokensRef.current = chatComposerTokens;
  }, [chatComposerTokens]);

  useEffect(() => {
    chatAttachmentsRef.current = chatAttachments;
  }, [chatAttachments]);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    voiceRecordingRef.current = voiceRecording;
  }, [voiceRecording]);

  useEffect(() => {
    if (!voiceRecording) {
      setVoiceElapsedMs(0);
      return;
    }
    const tick = () => {
      setVoiceElapsedMs(Date.now() - voiceStartedAtRef.current);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [voiceRecording]);

  useEffect(() => {
    chatComposerDraftsRef.current = chatComposerDrafts;
  }, [chatComposerDrafts]);

  useEffect(() => {
    chatPendingPromptsByKeyRef.current = chatPendingPromptsByKey;
  }, [chatPendingPromptsByKey]);

  useEffect(() => {
    chatSubmittingByKeyRef.current = chatSubmittingByKey;
  }, [chatSubmittingByKey]);

  useEffect(() => {
    return () => {
      for (const timerId of Object.values(chatPendingPromptTimersRef.current)) {
        window.clearTimeout(timerId);
      }
      chatPendingPromptTimersRef.current = {};
      clearChatFileMentionSearchTimer();
    };
  }, [clearChatFileMentionSearchTimer]);

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  useEffect(() => {
    const draft =
      chatComposerDraftsRef.current[currentChatDraftKey] ??
      EMPTY_CHAT_COMPOSER_DRAFT;
    if (chatComposerTextRef.current !== draft.text) {
      chatComposerTextRef.current = draft.text;
      chatComposerTextCursorRef.current = draft.text.length;
      setChatComposerText(draft.text);
    }
    const draftTokens = draft.tokens ?? chatComposerTokensFromText(draft.text);
    if (!chatComposerTokensEqual(chatComposerTokensRef.current, draftTokens)) {
      chatComposerTokensRef.current = draftTokens;
      setChatComposerTokens(draftTokens);
    }
    if (chatAttachmentsRef.current !== draft.attachments) {
      chatAttachmentsRef.current = draft.attachments;
      setChatAttachments(draft.attachments);
    }
    if (draft.attachments.length === 0 && chatFileInputRef.current) {
      chatFileInputRef.current.value = '';
    }
  }, [currentChatDraftKey]);

  const [gitLoading, setGitLoading] = useState(false);
  const [gitError, setGitError] = useState('');
  const [gitCurrentBranch, setGitCurrentBranch] = useState('');
  const [gitBranches, setGitBranches] = useState<string[]>([]);
  const [gitSelectedBranches, setGitSelectedBranches] = useState<string[]>([]);
  const [gitBranchPickerOpen, setGitBranchPickerOpen] = useState(false);
  const [gitLoadedProjectId, setGitLoadedProjectId] = useState('');
  const [commits, setCommits] = useState<RegistryGitCommit[]>([]);
  const [selectedCommit, setSelectedCommit] = useState('');
  const [expandedCommitShas, setExpandedCommitShas] = useState<string[]>([]);
  const [commitFilesBySha, setCommitFilesBySha] = useState<
    Record<string, RegistryGitCommitFile[]>
  >({});
  const [workingTreeFiles, setWorkingTreeFiles] = useState<
    WorkingTreeFileEntry[]
  >([]);
  const [worktreeExpanded, setWorktreeExpanded] = useState(true);
  const [commitPopover, setCommitPopover] =
    useState<GitCommitPopoverState | null>(null);
  const [selectedDiffSource, setSelectedDiffSource] =
    useState<GitDiffSource>('commit');
  const [selectedDiffScope, setSelectedDiffScope] = useState<
    'staged' | 'unstaged' | 'untracked'
  >('unstaged');
  const [selectedDiff, setSelectedDiff] = useState('');
  const [allowHeavyDiffLoad, setAllowHeavyDiffLoad] = useState(false);
  const [allowLargeDiffRender, setAllowLargeDiffRender] = useState(false);
  const [diffText, setDiffText] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [openingPromptArtifactKey, setOpeningPromptArtifactKey] = useState('');
  const [promptArtifactErrors, setPromptArtifactErrors] = useState<Record<string, string>>({});
  const setGitSelectedDiff = useCallback<React.Dispatch<React.SetStateAction<string>>>((next) => {
    setSelectedDiff(next);
  }, []);
  const setGitSelectedDiffSource = useCallback<React.Dispatch<React.SetStateAction<GitDiffSource>>>((next) => {
    setSelectedDiffSource(next);
  }, []);
  const setGitSelectedDiffScope = useCallback<React.Dispatch<React.SetStateAction<'staged' | 'unstaged' | 'untracked'>>>((next) => {
    setSelectedDiffScope(next);
  }, []);
  const setGitSelectedCommit = useCallback<React.Dispatch<React.SetStateAction<string>>>((next) => {
    setSelectedCommit(next);
  }, []);
  const projectIdListKey = useMemo(
    () => projects.map(item => item.projectId).join('|'),
    [projects],
  );
  const sortedProjectItems = useMemo(() => sortProjectsByPin(projects, pinnedProjectIds), [projects, pinnedProjectIds]);
  const visibility = useMemo(
    () => splitProjectsByVisibility(sortedProjectItems, hiddenProjectIds),
    [hiddenProjectIds, sortedProjectItems],
  );
  const visibleProjectItems = visibility.visibleProjects;
  const chatFilePreviewProjects = visibleProjectItems;
  const chatPreviewProjectId = selectedChatKey?.projectId || projectId || projectIdRef.current;
  const hiddenProjectItems = visibility.hiddenProjects;
  const hiddenProjectIdSet = useMemo(() => new Set(hiddenProjectIds), [hiddenProjectIds]);
  useEffect(() => {
    if (!chatPreviewProjectId || previewWorkbench.activeProjectId === chatPreviewProjectId) {
      return;
    }
    previewFileTreeSearchGenerationRef.current += 1;
    previewFileTreeSearchQueryIdRef.current = 0;
    setPreviewFileTreeSearchQuery('');
    setPreviewFileTreeSearchResults([]);
    setPreviewFileTreeSearchLoading(false);
    setPreviewFileTreeSearchError('');
    setPreviewFileTreeSearchIndexed(true);
    setPreviewFileTreeSearchActiveIndex(0);
    setPreviewFileTreeSearchCollapsedDirs([]);
    setPreviewWorkbench(current => selectPreviewProject(current, chatPreviewProjectId));
  }, [chatPreviewProjectId, previewWorkbench.activeProjectId]);
  const chatHubTreeItems = useMemo(() => {
    const hubIds: string[] = [];
    const addHubId = (hubId: string) => {
      if (hubId && !hubIds.includes(hubId)) {
        hubIds.push(hubId);
      }
    };
    registryHubs.forEach(hub => addHubId(hub.hubId));
    sortedProjectItems.forEach(projectItem => addHubId(projectHubId(projectItem)));
    return hubIds.map(hubId => ({
      hubId,
      projects: sortedProjectItems.filter(projectItem => projectHubId(projectItem) === hubId),
    }));
  }, [registryHubs, sortedProjectItems]);
  const defaultExpandedHubIds = useMemo(() => {
    const next = new Set<string>();
    const selectedProject = selectedChatKey?.projectId
      ? sortedProjectItems.find(projectItem => projectItem.projectId === selectedChatKey.projectId)
      : null;
    if (selectedProject) {
      next.add(projectHubId(selectedProject));
    }
    hiddenProjectItems.forEach(projectItem => next.add(projectHubId(projectItem)));
    return Array.from(next);
  }, [hiddenProjectItems, selectedChatKey?.projectId, sortedProjectItems]);
  const savedExpandedHubIds = useMemo(
    () => expandedHubIds.filter(hubId => hubId !== HUB_TREE_EMPTY_EXPANDED_SENTINEL),
    [expandedHubIds],
  );
  const effectiveExpandedHubIds = expandedHubIds.length > 0 ? savedExpandedHubIds : defaultExpandedHubIds;
  const hubAccentStyle = useCallback((hubId: string): React.CSSProperties => {
    const color = resolveHubColor(hubColors, hubId);
    return {'--hub-accent': color, '--pill-accent': color} as React.CSSProperties;
  }, [hubColors]);
  const applyHubColorSvPointer = useCallback((
    hubId: string,
    hsv: HubColorHsv,
    event: React.PointerEvent<HTMLElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may fail for synthetic or already-ended pointer events.
    }
    const saturation = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const brightness = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const nextColor = hubHsvToColor({h: hsv.h, s: saturation, v: brightness});
    setHubColors(current => setHubColorPreference(current, hubId, nextColor));
  }, [setHubColors]);
  const applyHubColorHuePointer = useCallback((
    hubId: string,
    hsv: HubColorHsv,
    event: React.PointerEvent<HTMLElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may fail for synthetic or already-ended pointer events.
    }
    const hueRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const nextColor = hubHsvToColor({h: hueRatio * 360, s: hsv.s || 1, v: hsv.v || 1});
    setHubColors(current => setHubColorPreference(current, hubId, nextColor));
  }, [setHubColors]);
  const sessionSearchSections = useMemo(
    () => buildSessionSearchSections({
      projects: visibleProjectItems,
      sessionsByProjectId: projectSessionsByProjectId,
      resultsByProjectId: searchResultsByProjectId,
    }),
    [projectSessionsByProjectId, searchResultsByProjectId, visibleProjectItems],
  );
  const archivedSessionSections = useMemo(
    () => buildArchivedSessionSections({
      projects: sortedProjectItems,
      archivedByProjectId,
    }),
    [archivedByProjectId, sortedProjectItems],
  );
  const sessionSearchResultCount = useMemo(
    () => sessionSearchSections.reduce((sum, section) => sum + section.rows.length, 0),
    [sessionSearchSections],
  );
  const sessionSearchActive = !!activeSessionSearchId;
  const sessionSearchHeaderExpanded = sessionSearchOpen || sessionSearchActive;
  const sessionSearchProjectDoneCount = useMemo(() => {
    if (!activeSessionSearchId) {
      return 0;
    }
    return visibleProjectItems.reduce(
      (sum, item) => sum + (sessionSearchDoneByProjectId[item.projectId] === true ? 1 : 0),
      0,
    );
  }, [activeSessionSearchId, sessionSearchDoneByProjectId, visibleProjectItems]);
  const sessionSearchErrorCount = useMemo(
    () => Object.values(sessionSearchErrorsByProjectId).filter(message => message.trim()).length,
    [sessionSearchErrorsByProjectId],
  );
  const sessionSearchAllDone = useMemo(() => {
    if (!activeSessionSearchId || visibleProjectItems.length === 0) {
      return false;
    }
    return visibleProjectItems.every(item => sessionSearchDoneByProjectId[item.projectId] === true);
  }, [activeSessionSearchId, sessionSearchDoneByProjectId, visibleProjectItems]);
  const sessionSearchStatusParts = useMemo(() => {
    if (!sessionSearchActive) {
      return [];
    }
    const resultLabel = `${sessionSearchResultCount} result${sessionSearchResultCount === 1 ? '' : 's'}`;
    const parts = sessionSearchAllDone
      ? [resultLabel]
      : [
          `Searching ${sessionSearchProjectDoneCount}/${visibleProjectItems.length} projects`,
          resultLabel,
        ];
    if (sessionSearchErrorCount > 0) {
      parts.push(`${sessionSearchErrorCount} error${sessionSearchErrorCount === 1 ? '' : 's'}`);
    }
    return parts;
  }, [
    sessionSearchActive,
    sessionSearchAllDone,
    sessionSearchErrorCount,
    sessionSearchProjectDoneCount,
    sessionSearchResultCount,
    visibleProjectItems.length,
  ]);
  useEffect(() => {
    if (!sessionSearchHeaderExpanded) {
      return;
    }
    const input = sessionSearchInputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    const cursor = input.value.length;
    input.setSelectionRange(cursor, cursor);
  }, [sessionSearchHeaderExpanded]);
  useEffect(() => {
    writeOlderSessionsExpanded(
      typeof window !== 'undefined' ? window.sessionStorage : null,
      olderSessionsExpandedByProjectId,
    );
  }, [olderSessionsExpandedByProjectId]);
  const mobileChatQuickSwitchSections = useMemo(
    () => buildMobileChatQuickSwitchSections({
      projects: visibleProjectItems,
      sessionsByProjectId: projectSessionsByProjectId,
      limit: 6,
    }),
    [projectSessionsByProjectId, visibleProjectItems],
  );
  const hasCompletedUnreadChatSessionIndicator = useMemo(
    () => hasCompletedUnreadChatSession({
      projects: visibleProjectItems,
      sessionsByProjectId: projectSessionsByProjectId,
    }),
    [projectSessionsByProjectId, visibleProjectItems],
  );
  // Recent Sessions should only be computed once the session data for every
  // visible project has loaded. Otherwise, on first paint projectSessionsByProjectId
  // is still empty/partial and the list collapses to whatever single project
  // happened to load first. A visible project counts as loaded once it has an
  // entry in projectSessionsByProjectId (even an empty list).
  const allVisibleProjectsLoaded = visibleProjectItems.length > 0 &&
    visibleProjectItems.every(project => project.projectId in projectSessionsByProjectId);

  const recomputeRecentSessions = useCallback(() => {
    if (!allVisibleProjectsLoaded) {
      return;
    }
    setRecentSessionSections(
      buildRecentChatSessionProjectSections({
        projects: visibleProjectItems,
        sessionsByProjectId: projectSessionsByProjectId,
        limit: 8,
      }),
    );
  }, [allVisibleProjectsLoaded, projectSessionsByProjectId, visibleProjectItems]);
  useEffect(() => {
    recomputeRecentSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentSessionsTick, allVisibleProjectsLoaded]);
  useEffect(() => {
    // Recompute once the visible projects finish loading (or whenever the
    // session map grows), even if recentSessions was already seeded.
    if (allVisibleProjectsLoaded) {
      setRecentSessionsTick(t => t + 1);
    }
  }, [allVisibleProjectsLoaded, projectSessionsByProjectId]);
  const showPinnedRecentSessionsSurface = isWide && sidebarCollapsed && recentSessionsPinned && !archivedMode && !sessionSearchActive && recentSessionSections.length > 0;

  const mobileChatQuickSwitchMenuStyle = useMemo<React.CSSProperties>(() => ({
    top: portRelayReady && portRelayFrameUrl ? 56 : 0,
  }), [portRelayFrameUrl, portRelayReady]);
  const chatQuickSwitchMenuStyle = chatQuickSwitchMenuPlacement.kind === 'desktop'
    ? chatQuickSwitchMenuPlacement.style
    : mobileChatQuickSwitchMenuStyle;

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    chatSelectedIdRef.current = selectedChatId;
  }, [selectedChatId]);
  useEffect(() => {
    selectedChatKeyRef.current = selectedChatKey;
  }, [selectedChatKey]);
  useEffect(() => {
    chatSessionsRef.current = chatSessions;
  }, [chatSessions]);
  useEffect(() => {
    projectSessionsByProjectIdRef.current = projectSessionsByProjectId;
  }, [projectSessionsByProjectId]);
  useEffect(() => {
    draftSessionsByProjectIdRef.current = draftSessionsByProjectId;
  }, [draftSessionsByProjectId]);
  useEffect(() => {
    activeSessionSearchIdRef.current = activeSessionSearchId;
  }, [activeSessionSearchId]);
  useEffect(() => {
    sessionSearchDoneByProjectIdRef.current = sessionSearchDoneByProjectId;
  }, [sessionSearchDoneByProjectId]);
  useEffect(() => {
    return () => {
      if (sessionSearchPollTimerRef.current !== null) {
        window.clearTimeout(sessionSearchPollTimerRef.current);
        sessionSearchPollTimerRef.current = null;
      }
      if (sessionSearchHighlightTimerRef.current !== null) {
        window.clearTimeout(sessionSearchHighlightTimerRef.current);
        sessionSearchHighlightTimerRef.current = null;
      }
    };
  }, []);
  const cancelSessionSearch = useCallback(async (
    searchId = activeSessionSearchIdRef.current,
    projectItems = visibleProjectItems,
  ) => {
    const normalizedSearchId = searchId.trim();
    if (!normalizedSearchId) {
      return;
    }
    await Promise.allSettled(
      projectItems.map(projectItem =>
        service.cancelProjectSessionSearch(projectItem.projectId, normalizedSearchId),
      ),
    );
  }, [visibleProjectItems]);

  const querySessionSearch = useCallback(async (
    searchId = activeSessionSearchIdRef.current,
  ): Promise<boolean> => {
    const normalizedSearchId = searchId.trim();
    if (!normalizedSearchId) {
      return false;
    }
    const doneSnapshot = sessionSearchDoneByProjectIdRef.current;
    const pendingProjects = visibleProjectItems.filter(projectItem =>
      doneSnapshot[projectItem.projectId] !== true,
    );
    if (pendingProjects.length === 0) {
      return false;
    }
    let anyChanged = false;
    await Promise.all(
      pendingProjects.map(async projectItem => {
        try {
          const response = await service.queryProjectSessionSearch(projectItem.projectId, normalizedSearchId);
          if (activeSessionSearchIdRef.current !== normalizedSearchId) {
            return;
          }
          setSearchResultsByProjectId(prev => {
            const merged = mergeSessionSearchResultsByProject(prev, projectItem.projectId, response.results);
            anyChanged = anyChanged || merged.changed;
            return merged.resultsByProjectId;
          });
          setSessionSearchDoneByProjectId(prev => ({
            ...prev,
            [projectItem.projectId]: response.done,
          }));
          setSessionSearchErrorsByProjectId(prev => ({
            ...prev,
            [projectItem.projectId]: response.errors.map(item => item.message).join('\n'),
          }));
        } catch (err) {
          if (activeSessionSearchIdRef.current !== normalizedSearchId) {
            return;
          }
          anyChanged = true;
          setSessionSearchDoneByProjectId(prev => ({
            ...prev,
            [projectItem.projectId]: true,
          }));
          setSessionSearchErrorsByProjectId(prev => ({
            ...prev,
            [projectItem.projectId]: err instanceof Error ? err.message : String(err),
          }));
        }
      }),
    );
    sessionSearchUnchangedPollsRef.current = anyChanged
      ? 0
      : sessionSearchUnchangedPollsRef.current + 1;
    return anyChanged;
  }, [visibleProjectItems]);

  const clearSessionSearchState = useCallback(() => {
    activeSessionSearchIdRef.current = '';
    setActiveSessionSearchId('');
    setSessionSearchQuery('');
    setSearchResultsByProjectId({});
    setSessionSearchDoneByProjectId({});
    setSessionSearchErrorsByProjectId({});
    sessionSearchUnchangedPollsRef.current = 0;
    if (sessionSearchPollTimerRef.current !== null) {
      window.clearTimeout(sessionSearchPollTimerRef.current);
      sessionSearchPollTimerRef.current = null;
    }
  }, []);

  const exitSessionSearch = useCallback(async () => {
    const searchId = activeSessionSearchIdRef.current;
    const projectItems = visibleProjectItems;
    clearSessionSearchState();
    setSessionSearchOpen(false);
    await cancelSessionSearch(searchId, projectItems);
  }, [cancelSessionSearch, clearSessionSearchState, visibleProjectItems]);

  const startSessionSearch = useCallback(async () => {
    const query = sessionSearchInput.trim();
    if (!query) {
      await exitSessionSearch();
      return;
    }
    const previousSearchId = activeSessionSearchIdRef.current;
    const projectItems = visibleProjectItems;
    if (previousSearchId) {
      await cancelSessionSearch(previousSearchId, projectItems);
    }
    sessionSearchIdCounterRef.current += 1;
    const searchId = `session-search-${Date.now()}-${sessionSearchIdCounterRef.current}`;
    activeSessionSearchIdRef.current = searchId;
    setActiveSessionSearchId(searchId);
    setSessionSearchQuery(query);
    setSearchResultsByProjectId({});
    setSessionSearchErrorsByProjectId({});
    setSessionSearchDoneByProjectId(
      Object.fromEntries(projectItems.map(projectItem => [projectItem.projectId, false])),
    );
    sessionSearchUnchangedPollsRef.current = 0;
    setSessionSearchOpen(true);

    await Promise.all(
      projectItems.map(async projectItem => {
        try {
          await service.startProjectSessionSearch(projectItem.projectId, searchId, query);
        } catch (err) {
          if (activeSessionSearchIdRef.current !== searchId) {
            return;
          }
          setSessionSearchDoneByProjectId(prev => ({
            ...prev,
            [projectItem.projectId]: true,
          }));
          setSessionSearchErrorsByProjectId(prev => ({
            ...prev,
            [projectItem.projectId]: err instanceof Error ? err.message : String(err),
          }));
        }
      }),
    );
    if (activeSessionSearchIdRef.current === searchId) {
      querySessionSearch(searchId).catch(() => undefined);
    }
  }, [cancelSessionSearch, exitSessionSearch, querySessionSearch, sessionSearchInput, visibleProjectItems]);

  useEffect(() => {
    if (!activeSessionSearchId || tab !== 'chat') {
      if (sessionSearchPollTimerRef.current !== null) {
        window.clearTimeout(sessionSearchPollTimerRef.current);
        sessionSearchPollTimerRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const searchId = activeSessionSearchIdRef.current;
      if (!searchId) {
        return;
      }
      const changed = await querySessionSearch(searchId);
      if (cancelled || activeSessionSearchIdRef.current !== searchId) {
        return;
      }
      const doneSnapshot = sessionSearchDoneByProjectIdRef.current;
      const allDone = visibleProjectItems.length > 0 &&
        visibleProjectItems.every(projectItem => doneSnapshot[projectItem.projectId] === true);
      if (allDone) {
        return;
      }
      const delay = resolveSessionSearchPollDelay({
        changed,
        unchangedPolls: sessionSearchUnchangedPollsRef.current,
      });
      sessionSearchPollTimerRef.current = window.setTimeout(() => {
        poll().catch(() => undefined);
      }, delay);
    };
    poll().catch(() => undefined);
    return () => {
      cancelled = true;
      if (sessionSearchPollTimerRef.current !== null) {
        window.clearTimeout(sessionSearchPollTimerRef.current);
        sessionSearchPollTimerRef.current = null;
      }
    };
  }, [activeSessionSearchId, querySessionSearch, visibleProjectItems, tab]);
  useEffect(() => {
    floatingDragStateRef.current = floatingDragState;
  }, [floatingDragState]);
  useEffect(() => {
    floatingControlSideRef.current = floatingControlSide;
  }, [floatingControlSide]);
  useEffect(() => {
    gestureNavStateRef.current = gestureNavState;
  }, [gestureNavState]);
  useEffect(() => {
    sidebarSettingsOpenRef.current = sidebarSettingsOpen;
  }, [sidebarSettingsOpen]);
  useEffect(() => {
    settingsDetailViewRef.current = settingsDetailView;
  }, [settingsDetailView]);
  useEffect(() => {
    tabRef.current = tab;
    if (tab !== 'chat') {
      return;
    }
    const activeProjectId = projectId || projectIdRef.current;
    if (!connected || !activeProjectId) {
      return;
    }
    const preferredChatKey =
      selectedChatKeyRef.current ||
      workspaceStore.migrateSelectedChatSessionKey(activeProjectId);
    if (preferredChatKey && !selectedChatKeyRef.current) {
      applySelectedChatKey(preferredChatKey);
      hydrateChatSessionsFromCache(preferredChatKey.projectId, preferredChatKey.sessionId);
    }
    loadChatSessions(
      preferredChatKey?.projectId ?? activeProjectId,
      preferredChatKey?.sessionId ?? '',
    ).catch(() => undefined);
  }, [tab, connected, projectId]);

  useEffect(() => {
    const shouldHydrateProjectSessionIndex =
      isWide || (!isWide && tab === 'chat' && drawerOpen);
    if (!shouldHydrateProjectSessionIndex || projects.length === 0) return;
    setProjectSessionsByProjectId(prev => {
      const next = {...prev};
      for (const projectItem of projects) {
        const cachedSessions = workspaceStore
          .hydrateChatSessions(projectItem.projectId)
          .map(entry => entry.session);
        const sortedCachedSessions = sortChatSessions(cachedSessions);
        if (sortedCachedSessions.length > 0) {
          next[projectItem.projectId] = mergeChatSessionList(
            next[projectItem.projectId] ?? [],
            sortedCachedSessions,
          );
        } else if (!next[projectItem.projectId]) {
          next[projectItem.projectId] = [];
        }
      }
      return next;
    });
  }, [isWide, tab, drawerOpen, projectIdListKey]);

  useEffect(() => {
    if (!connected || !isWide || projects.length === 0) return;
    let cancelled = false;
    for (const projectItem of projects) {
      service
        .listProjectSessions(projectItem.projectId)
        .then(sessions => {
          if (cancelled) return;
          const sortedSessions = sortChatSessions(sessions);
          const knownSessions = knownChatSessionsForProject(projectItem.projectId);
          const mergedSessions = mergeChatSessionList(knownSessions, sortedSessions);
          setProjectSessionsByProjectId(prev => ({
            ...prev,
            [projectItem.projectId]: mergeChatSessionList(
              prev[projectItem.projectId] ?? knownSessions,
              sortedSessions,
            ),
          }));
          const cached = workspaceStore.hydrateChatSessions(projectItem.projectId);
          const cursorBySessionId: Record<string, {turnIndex: number}> = {};
          for (const entry of cached) {
            cursorBySessionId[entry.session.sessionId] = entry.cursor;
          }
          workspaceStore.replaceChatSessions(
            projectItem.projectId,
            mergedSessions,
            cursorBySessionId,
          );
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [connected, isWide, projectIdListKey]);

  useEffect(() => {
    if (!wideProjectActionMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && wideProjectActionMenuRef.current?.contains(target)) {
        return;
      }
      setWideProjectActionMenu(null);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [wideProjectActionMenu]);

  const measureChatComposerTop = useCallback(() => {
    const rect = chatComposerRef.current?.getBoundingClientRect();
    const nextHeight = rect ? Math.round(rect.height) : 0;
    setChatComposerTop(rect ? Math.round(rect.top) : null);
    setChatComposerHeight(current => (current === nextHeight ? current : nextHeight));
  }, []);
  const shouldMeasureChatComposerLayout = tab === 'chat' && !isWide;

  useLayoutEffect(() => {
    resizeChatComposerTextarea();
    if (shouldMeasureChatComposerLayout) {
      measureChatComposerTop();
    }
  }, [resizeChatComposerTextarea, measureChatComposerTop, chatComposerText, selectedChatId, currentChatDraftKey, shouldMeasureChatComposerLayout]);

  useEffect(() => {
    if (!shouldMeasureChatComposerLayout) {
      setChatComposerTop(null);
      setChatComposerHeight(0);
      return;
    }
    const measure = () => measureChatComposerTop();
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [
    shouldMeasureChatComposerLayout,
        measureChatComposerTop,
        chatComposerText,
        chatAttachments.length,
        voiceRecording,
        chatKeyboardInset,
        windowHeight,
  ]);

  useEffect(() => {
    if (tab !== 'chat') {
      return;
    }
    forceChatScrollToBottom();
  }, [tab, selectedChatId, forceChatScrollToBottom]);

  useEffect(() => {
    if (tab !== 'chat') {
      return;
    }
    resizeChatComposerTextarea();
  }, [tab, selectedChatId, chatMessages, chatPendingPromptsByKey, chatLoading, resizeChatComposerTextarea]);

  useEffect(() => {
    if (tab !== 'chat') {
      chatKeyboardInsetRef.current = chatKeyboardInset;
      if (chatKeyboardInsetSettleTimerRef.current !== null) {
        window.clearTimeout(chatKeyboardInsetSettleTimerRef.current);
        chatKeyboardInsetSettleTimerRef.current = null;
      }
      return;
    }
    const keyboardInsetScrollAction = resolveChatKeyboardInsetScrollAction({
      previousInset: chatKeyboardInsetRef.current,
      nextInset: chatKeyboardInset,
    });
    chatKeyboardInsetRef.current = chatKeyboardInset;
    if (chatKeyboardInsetSettleTimerRef.current !== null) {
      window.clearTimeout(chatKeyboardInsetSettleTimerRef.current);
      chatKeyboardInsetSettleTimerRef.current = null;
    }
    if (keyboardInsetScrollAction === 'immediate') {
      scrollChatToBottom();
      return;
    }
    if (keyboardInsetScrollAction === 'deferred') {
      chatKeyboardInsetSettleTimerRef.current = window.setTimeout(() => {
        chatKeyboardInsetSettleTimerRef.current = null;
        scrollChatToBottom();
      }, CHAT_KEYBOARD_INSET_SETTLE_DELAY_MS);
    }
    return () => {
      if (chatKeyboardInsetSettleTimerRef.current !== null) {
        window.clearTimeout(chatKeyboardInsetSettleTimerRef.current);
        chatKeyboardInsetSettleTimerRef.current = null;
      }
    };
  }, [tab, chatKeyboardInset, scrollChatToBottom]);

  useEffect(() => {
    gitSelectedBranchesRef.current = gitSelectedBranches;
  }, [gitSelectedBranches]);

  useEffect(() => {
    setMarkdownPreviewEnabled(isMarkdownPath(selectedFile));
    setHtmlPreviewEnabled(isHtmlPath(selectedFile));
  }, [selectedFile]);
  useEffect(() => {
    setAllowHeavyDiffLoad(false);
    setAllowLargeDiffRender(false);
  }, [selectedDiff, selectedCommit, selectedDiffSource, selectedDiffScope]);

  useEffect(() => {
    const onResize = () => {
      setWindowWidth(window.innerWidth);
      setWindowHeight(window.innerHeight);
      setSafeAreaTopInset(readSafeAreaTopInset());
      setSafeAreaBottomInset(readSafeAreaBottomInset());
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (layoutModeRef.current === layoutMode) {
      return;
    }
    dispatchWorkspaceUi({
      type: 'layout/modeChanged',
      from: layoutModeRef.current,
      to: layoutMode,
    });
    layoutModeRef.current = layoutMode;
  }, [layoutMode]);

  const gestureNavigationExpanded = gestureNavState?.phase === 'expanded';

  useLayoutEffect(() => {
    if (isWide) {
      return;
    }
    const nextFloatingHeight = floatingControlStackRef.current?.offsetHeight ?? 184;
    setFloatingControlStackHeight(prev => (prev === nextFloatingHeight ? prev : nextFloatingHeight));
  }, [
    isWide,
    windowWidth,
    gestureNavigationExpanded,
    projectId,
    projects.length,
    tab,
  ]);

  useEffect(() => {
    if (isWide || tab !== 'chat') {
      mobileKeyboardLayoutViewportHeightRef.current = 0;
      setChatKeyboardInset(0);
      setFloatingKeyboardOffset(0);
      return;
    }
    const viewport = window.visualViewport;
    if (!viewport) {
      mobileKeyboardLayoutViewportHeightRef.current = 0;
      setChatKeyboardInset(0);
      setFloatingKeyboardOffset(0);
      return;
    }
    let raf = 0;
    let lastWindowWidth = window.innerWidth;
    const readLayoutViewportHeight = () => Math.max(
      window.innerHeight || 0,
      document.documentElement.clientHeight || 0,
    );
    const resetLayoutViewportHeight = () => {
      mobileKeyboardLayoutViewportHeightRef.current = readLayoutViewportHeight();
    };
    const updateInset = () => {
      const layoutViewportHeight = resolveChatKeyboardLayoutViewportHeight({
        currentLayoutViewportHeight: readLayoutViewportHeight(),
        previousLayoutViewportHeight: mobileKeyboardLayoutViewportHeightRef.current,
      });
      const nextInset = resolveChatKeyboardInset({
        windowInnerHeight: window.innerHeight,
        layoutViewportHeight,
        visualViewportHeight: viewport.height,
        visualViewportOffsetTop: viewport.offsetTop,
      });
      mobileKeyboardLayoutViewportHeightRef.current = layoutViewportHeight;
      setChatKeyboardInset(prev => (prev === nextInset ? prev : nextInset));
      setFloatingKeyboardOffset(prev => (prev === nextInset ? prev : nextInset));
    };
    const scheduleUpdate = () => {
      if (raf) {
        window.cancelAnimationFrame(raf);
      }
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        updateInset();
      });
    };
    const handleWindowResize = () => {
      const nextWindowWidth = window.innerWidth;
      if (Math.abs(nextWindowWidth - lastWindowWidth) > 24) {
        lastWindowWidth = nextWindowWidth;
        resetLayoutViewportHeight();
      }
      scheduleUpdate();
    };
    const handleOrientationChange = () => {
      resetLayoutViewportHeight();
      scheduleUpdate();
    };
    resetLayoutViewportHeight();
    updateInset();
    viewport.addEventListener('resize', scheduleUpdate);
    viewport.addEventListener('scroll', scheduleUpdate);
    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('scroll', scheduleUpdate, {passive: true});
    window.addEventListener('orientationchange', handleOrientationChange);
    return () => {
      if (raf) {
        window.cancelAnimationFrame(raf);
      }
      viewport.removeEventListener('resize', scheduleUpdate);
      viewport.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, [isWide, tab]);

  useLayoutEffect(() => {
    if (isWide || tab !== 'chat' || floatingKeyboardOffset > 0 || chatComposerTop === null) {
      return;
    }
    setFloatingDefaultComposerTop(current =>
      current === null || chatComposerTop > current
        ? chatComposerTop
        : current,
    );
  }, [chatComposerTop, floatingKeyboardOffset, isWide, tab]);

  useEffect(() => {
    if (!isWide) {
      return;
    }
    if (gestureMoveLongPressTimerRef.current !== null) {
      window.clearTimeout(gestureMoveLongPressTimerRef.current);
      gestureMoveLongPressTimerRef.current = null;
    }
    if (floatingCooldownTimerRef.current !== null) {
      window.clearTimeout(floatingCooldownTimerRef.current);
      floatingCooldownTimerRef.current = null;
    }
    floatingIgnoreLostCaptureRef.current = false;
    gestureNavigationSuppressClickRef.current = false;
    gestureNavigationSuppressClickUntilRef.current = 0;
    setFloatingDragState(null);
    gestureNavStateRef.current = null;
    setGestureNavState(null);
    setFloatingKeyboardOffset(0);
  }, [isWide]);

  useEffect(
    () => () => {
      if (gestureMoveLongPressTimerRef.current !== null) {
        window.clearTimeout(gestureMoveLongPressTimerRef.current);
        gestureMoveLongPressTimerRef.current = null;
      }
      if (floatingCooldownTimerRef.current !== null) {
        window.clearTimeout(floatingCooldownTimerRef.current);
        floatingCooldownTimerRef.current = null;
      }
      floatingIgnoreLostCaptureRef.current = false;
    },
    [],
  );

  useEffect(() => {
    const onPointer = () => {
      setProjectMenuOpen(false);
      setChatTitleProjectMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!searchToolsOpen && !gotoToolsOpen) return;
      const container = fileSideActionsRef.current;
      if (!container) return;
      const target = event.target as Node | null;
      if (target && container.contains(target)) return;
      setSearchToolsOpen(false);
      setGotoToolsOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [searchToolsOpen, gotoToolsOpen]);
  useEffect(() => {
    if (!commitPopover) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && commitPopoverRef.current?.contains(target)) return;
      setCommitPopover(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [commitPopover]);

  useEffect(() => {
    if (!gitBranchPickerOpen || !isWide) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && gitBranchMenuRef.current?.contains(target)) return;
      setGitBranchPickerOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [gitBranchPickerOpen, isWide]);

  useEffect(() => {
    if (!chatPromptMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (chatSlashMenuRef.current?.contains(target) ||
          chatPromptButtonRef.current?.contains(target))
      ) {
        return;
      }
      setChatPromptMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [chatPromptMenuOpen]);

  useEffect(() => {
    if (!chatTitleProjectMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (chatTitleProjectMenuRef.current?.contains(target) ||
          chatTitleProjectButtonRef.current?.contains(target))
      ) {
        return;
      }
      setChatTitleProjectMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChatTitleProjectMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [chatTitleProjectMenuOpen]);

  useEffect(() => {
    if (!chatTitlePromptMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (chatTitlePromptMenuRef.current?.contains(target) ||
          chatTitlePromptButtonRef.current?.contains(target))
      ) {
        return;
      }
      setChatTitlePromptMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChatTitlePromptMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [chatTitlePromptMenuOpen]);

  useEffect(() => {
    if (!chatFileMentionMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (chatFileMentionMenuRef.current?.contains(target) ||
          chatFileMentionButtonRef.current?.contains(target))
      ) {
        return;
      }
      setChatFileMentionMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [chatFileMentionMenuOpen]);

  useEffect(() => {
    if (!chatAttachmentTrayOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && chatAttachmentTrayRef.current?.contains(target)) {
        return;
      }
      if (target && chatAttachmentTrayButtonRef.current?.contains(target)) {
        return;
      }
      setChatAttachmentTrayOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [chatAttachmentTrayOpen]);

  useEffect(() => {
    if (!chatConfigMenuOptionId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && chatConfigOptionsRef.current?.contains(target)) return;
      setChatConfigMenuOptionId('');
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [chatConfigMenuOptionId]);

  useEffect(() => {
    if (!chatContextUsageOpen) return;
    updateChatContextUsagePopoverPosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && chatContextUsageRef.current?.contains(target)) return;
      setChatContextUsageOpen(false);
    };
    const onReposition = () => updateChatContextUsagePopoverPosition();
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [chatContextUsageOpen, updateChatContextUsagePopoverPosition]);

  useEffect(() => {
    if (!chatConfigOverflowOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && chatConfigOverflowRef.current?.contains(target)) return;
      setChatConfigOverflowOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [chatConfigOverflowOpen, setChatConfigOverflowOpen]);

  useEffect(() => {
    if (!chatHubMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!chatHubMenuRef.current) return;
      if (!chatHubMenuRef.current.contains(event.target as Node)) {
        setChatHubMenuOpen(false);
        setChatHubColorMenuHubId('');

        return;
      }
      const targetElement = event.target instanceof Element ? event.target : null;
      if (
        chatHubColorMenuHubId &&
        targetElement &&
        !targetElement.closest('.chat-hub-color-palette') &&
        !targetElement.closest('.chat-hub-color-square')
      ) {
        setChatHubColorMenuHubId('');

      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChatHubMenuOpen(false);
        setChatHubColorMenuHubId('');

      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [chatHubColorMenuHubId, chatHubMenuOpen]);

  useEffect(() => {
    if (tab !== 'chat' || sidebarSettingsOpen) {
      setChatHubMenuOpen(false);
      setChatHubColorMenuHubId('');
    }
  }, [sidebarSettingsOpen, tab]);

  useEffect(() => {
    if (chatConfigDisplay.overflow.length === 0) {
      setChatConfigOverflowOpen(false);
    }
  }, [chatConfigDisplay.overflow.length, selectedChatId, setChatConfigOverflowOpen]);

  useEffect(() => {
    if (!chatConfigMenuOptionId) return;
    if (!chatConfigDisplay.visible.some(option => option.id === chatConfigMenuOptionId)) {
      setChatConfigMenuOptionId('');
    }
  }, [chatConfigMenuOptionId, chatConfigDisplay.visible]);

  useEffect(() => {
    return registryDebugStore.subscribe((records: RegistryDebugRecord[]) => {
      setRegistryDebugRecords(records);
      setSelectedRegistryDebugRecordId(current =>
        current !== null && records.some(record => record.id === current)
          ? current
          : records[records.length - 1]?.id ?? null,
      );
    });
  }, []);

  useEffect(() => {
    appDiagnosticStore.setLogLevel(logLevel);
    void setNativeDiagnosticLogLevel(logLevel);
  }, [logLevel]);

  useEffect(() => {
    if (!isNativeShellHost()) {
      return undefined;
    }
    let cancelled = false;
    const drain = () => {
      if (!cancelled) {
        void drainNativeWebDiagnosticsToAppLog();
      }
    };
    drain();
    const interval = window.setInterval(drain, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [logLevel]);

  useEffect(() => {
    registryDebugStore.setEnabled(messageViewerEnabled);
    if (!messageViewerEnabled) {
      setSelectedRegistryDebugRecordId(null);
      setSelectedRegistryDebugScope('All');
      setSelectedRegistryDebugSessionId('All');
      setRegistryDebugIncludeMultiSessionRecords(false);
    }
  }, [messageViewerEnabled]);

  useEffect(() => {
    workspaceStore.setDisableFileCache(disableFileCache);
    if (disableFileCache) {
      workspaceStore.clearFileCache();
      dirHashRef.current = {};
      fileHashRef.current = {};
      fileCacheRef.current = {};
    }
  }, [disableFileCache]);

  useEffect(() => {
    promptCompletionNotificationsEnabledRef.current = promptCompletionNotificationsEnabled;
  }, [promptCompletionNotificationsEnabled]);

  useEffect(() => {
    let cancelled = false;
    notificationProvider.getPermissionState().then(state => {
      if (!cancelled) {
        setNotificationPermissionState(state);
      }
    }).catch(() => {
      if (!cancelled) {
        setNotificationPermissionState('unsupported');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [notificationProvider]);

  const handlePromptCompletionNotificationsChange = (enabled: boolean) => {
    if (!enabled) {
      setPromptCompletionNotificationsEnabled(false);
      return;
    }
    notificationProvider.requestPermission().then(state => {
      setNotificationPermissionState(state);
      setPromptCompletionNotificationsEnabled(state === 'granted');
    }).catch(() => {
      setNotificationPermissionState('unsupported');
      setPromptCompletionNotificationsEnabled(false);
    });
  };

  useEffect(() => {
    workspaceStore.rememberGlobalState({
      themeMode,
      codeTheme,
      codeFont,
      codeFontSize,
      codeLineHeight,
      codeTabSize,
      chatFont,
      chatViewWidth,
      sessionListDensity,
      mobileEnterKeyBehavior,
      wrapLines,
      showLineNumbers,
      hideToolCalls,
      messageViewerEnabled,
      logLevel,
      promptCompletionNotificationsEnabled,
      tab,
      selectedProjectId: projectId,
      floatingControlYRatio,
      floatingControlSide,
      desktopSidebarWidth,
      collapsedProjectIds,
      pinnedProjectIds,
      hiddenProjectIds,
      expandedHubIds,
      hubColors,
    });
  }, [
    themeMode,
    codeTheme,
    codeFont,
    codeFontSize,
    codeLineHeight,
    codeTabSize,
    chatFont,
    chatViewWidth,
    sessionListDensity,
    mobileEnterKeyBehavior,
    wrapLines,
    showLineNumbers,
    hideToolCalls,
    messageViewerEnabled,
    logLevel,
    promptCompletionNotificationsEnabled,
    tab,
    projectId,
    floatingControlYRatio,
    floatingControlSide,
    desktopSidebarWidth,
    collapsedProjectIds,
    pinnedProjectIds,
    hiddenProjectIds,
    expandedHubIds,
    hubColors,
  ]);

  useEffect(() => {
    if (!projectId) return;
    workspaceStore.rememberProjectSnapshot(projectId, {
      expandedDirs,
      selectedFile,
      pinnedFiles,
      gitCurrentBranch,
      commits,
      selectedCommit,
      commitFilesBySha,
      selectedDiff,
    });
  }, [
    projectId,
    expandedDirs,
    selectedFile,
    pinnedFiles,
    gitCurrentBranch,
    commits,
    selectedCommit,
    commitFilesBySha,
    selectedDiff,
  ]);

  const currentProjectName = useMemo(
    () =>
      projects.find(item => item.projectId === projectId)?.name ?? 'Project',
    [projectId, projects],
  );
  const currentProject = useMemo(
    () => projects.find(item => item.projectId === projectId) ?? null,
    [projectId, projects],
  );
  const currentProjectTitle = useMemo(
    () => (currentProject?.name || '').trim(),
    [currentProject],
  );
  useEffect(() => {
    const baseTitle = 'WheelMaker';
    const projectTitle = currentProjectTitle;
    document.title = projectTitle ? `${baseTitle} - ${projectTitle}` : baseTitle;
  }, [currentProjectTitle]);
  useEffect(() => {
    const startPreload = () => {
      preloadShikiRenderer();
    };
    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(startPreload, {timeout: 2500});
      return () => {
        window.cancelIdleCallback?.(idleId);
      };
    }
    const timer = window.setTimeout(startPreload, 800);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);
  const project = currentProject;
  const breadcrumbProjectName = useMemo(
    () => (currentProjectName || '').trim() || 'Project',
    [currentProjectName],
  );
  const chatBreadcrumbProjectName = useMemo(
    () => {
      const selectedProjectId = selectedChatKey?.projectId;
      if (!selectedProjectId || selectedProjectId === projectId) {
        return breadcrumbProjectName;
      }
      const selectedProjectName = projects.find(item => item.projectId === selectedProjectId)?.name;
      return selectedProjectName || 'Project';
    },
    [breadcrumbProjectName, projectId, projects, selectedChatKey?.projectId],
  );
  const fileBreadcrumbLabel = useMemo(
    () => splitPathForDisplay(selectedFile).fileName || 'No Selected File',
    [selectedFile],
  );
  const resolveSessionDisplayTitle = useCallback(
    (session?: Pick<RegistrySessionSummary, 'sessionId' | 'title'> | null) =>
      resolveChatSessionTitle(session?.title ?? '') ||
      session?.sessionId ||
      '',
    [],
  );
  const selectedChatDisplayTitle = useMemo(
    () =>
      selectedDraftChatSession?.title ||
      resolveChatSessionTitle(selectedChatSession?.title ?? '') ||
      selectedChatSession?.sessionId ||
      '',
    [selectedChatSession, selectedDraftChatSession?.title],
  );
  const chatBreadcrumbLabel = useMemo(
    () => selectedChatDisplayTitle || 'No Selected Session',
    [selectedChatDisplayTitle],
  );
  const gitBreadcrumbLabel = useMemo(
    () => splitPathForDisplay(selectedDiff).fileName || 'No Selected Diff',
    [selectedDiff],
  );
  const closeMobileDrawerCompanionOverlays = useCallback(() => {
    setChatQuickSwitchMenuOpen(false);
    setPortRelayTargetMenuOpen(false);
    setChatPromptMenuOpen(false);
    setChatFileMentionMenuOpen(false);
    setChatAttachmentTrayOpen(false);
    setChatConfigMenuOptionId('');
    setChatConfigOverflowOpen(false);
    setChatHubMenuOpen(false);
    setChatHubColorMenuHubId('');
    setChatTitleProjectMenuOpen(false);
    setChatTitlePromptMenuOpen(false);
  }, [setChatConfigOverflowOpen]);
  const handleMobileBreadcrumbProjectClick = useCallback(() => {
    closeMobileDrawerCompanionOverlays();
    setDrawerOpen(open => !open);
  }, [closeMobileDrawerCompanionOverlays, setDrawerOpen]);
  const renderBreadcrumbTitle = useCallback(
    (projectName: string, label: string) => (
      <div className="breadcrumb-title">
        <button
          type="button"
          className="breadcrumb-project-button breadcrumb-project-name"
          onClick={handleMobileBreadcrumbProjectClick}
          title="Toggle workspace drawer"
          aria-label="Toggle workspace drawer"
        >
          {projectName}
        </button>
        <span className="breadcrumb-separator" aria-hidden="true">
          &gt;
        </span>
        <span className="title-text breadcrumb-current" title={label}>
          {label}
        </span>
      </div>
    ),
    [handleMobileBreadcrumbProjectClick],
  );
  const renderChatHubSummary = useCallback(() => {
    const hubCount = registryHubs.length;
    const projectCount = projects.length;
    const chatHubSummaryLabel = `${hubCount} ${hubCount === 1 ? 'Hub' : 'Hubs'}`;
    const chatHubProjectLabel = `${projectCount} ${projectCount === 1 ? 'Project' : 'Projects'}`;
    return (
      <div ref={chatHubMenuRef} className="chat-hub-summary">
        <button
          type="button"
          className="chat-hub-summary-button"
          aria-label={`Show connected hubs, ${chatHubSummaryLabel}, ${chatHubProjectLabel}`}
          aria-haspopup="menu"
          aria-expanded={chatHubMenuOpen}
          onClick={() => {
            setChatPromptMenuOpen(false);
            setChatFileMentionMenuOpen(false);
            setChatConfigMenuOptionId('');
            setChatConfigOverflowOpen(false);
            setChatHubColorMenuHubId('');
    
            setChatHubMenuOpen(open => !open);
          }}
        >
          <span className="chat-hub-summary-copy">
            <span className="chat-hub-summary-label">{chatHubSummaryLabel}</span>
            <span className="chat-hub-summary-project-label">{chatHubProjectLabel}</span>
          </span>
          <span className="codicon codicon-chevron-down" aria-hidden="true" />
        </button>
        {chatHubMenuOpen ? (
          <div className={`chat-hub-popover${chatHubColorMenuHubId ? ' no-overflow' : ''}`} role="dialog" aria-label="Hub and project display preferences">
            {registryHubs.length > 0 ? (
              registryHubs.map(hub => {
                const treeItem = chatHubTreeItems.find(item => item.hubId === hub.hubId) ?? {hubId: hub.hubId, projects: []};
                const expanded = effectiveExpandedHubIds.includes(hub.hubId);
                const colorMenuOpen = chatHubColorMenuHubId === hub.hubId;
                const currentHubColor = resolveHubColor(hubColors, hub.hubId);
                const defaultHubColor = resolveDefaultHubColor(hub.hubId);
                const currentHubHsv = hubColorToHsv(currentHubColor);
                const currentHubHueColor = hubHsvToColor({h: currentHubHsv.h, s: 1, v: 1});
                const customHubColorStyle = {
                  ...hubAccentStyle(hub.hubId),
                  '--hub-custom-hue': currentHubHueColor,
                  '--hub-custom-s': `${currentHubHsv.s * 100}%`,
                  '--hub-custom-v': `${(1 - currentHubHsv.v) * 100}%`,
                  '--hub-custom-h': `${(currentHubHsv.h / 360) * 100}%`,
                } as React.CSSProperties;
                    return (
                      <div key={hub.hubId} className={`chat-hub-tree${expanded ? ' expanded' : ''}${colorMenuOpen ? ' color-open' : ''}`}>
                    <div className="chat-hub-row" style={hubAccentStyle(hub.hubId)}
                      onClick={() => {
                        const next = expanded
                          ? effectiveExpandedHubIds.filter(hubId => hubId !== hub.hubId)
                          : [...effectiveExpandedHubIds, hub.hubId];
                        setExpandedHubIds(next.length > 0 ? next : [HUB_TREE_EMPTY_EXPANDED_SENTINEL]);
                      }}
                    >
                      <span className="chat-hub-row-name">{hub.hubId}</span>
                      <button
                        type="button"
                        className="chat-hub-color-square"
                        aria-label={`Set color for ${hub.hubId}`}
                        aria-expanded={colorMenuOpen}
                        style={hubAccentStyle(hub.hubId)}
                        onClick={event => {
                          event.stopPropagation();
                          setChatHubColorMenuHubId(current => (current === hub.hubId ? '' : hub.hubId));
                        }}
                      >
                        <span className="chat-hub-color-square-fill" aria-hidden="true" />
                      </button>
                    </div>
                    {colorMenuOpen ? (
                      <div className="chat-hub-color-palette" aria-label={`Color options for ${hub.hubId}`}>
                        <div className="chat-hub-color-grid">
                          {HUB_COLOR_PRESETS.map(color => {
                            const defaultSwatch = color === defaultHubColor;
                            return (
                              <button
                                key={`${hub.hubId}:${color}`}
                                type="button"
                                className={`chat-hub-color-swatch${currentHubColor === color ? ' selected' : ''}${defaultSwatch ? ' default' : ''}`}
                                style={{'--swatch-color': color} as React.CSSProperties}
                                aria-label={defaultSwatch ? `Restore default color for ${hub.hubId}` : `Set ${hub.hubId} color to ${color}`}
                                onClick={() => setHubColors(current =>
                                  setHubColorPreference(current, hub.hubId, defaultSwatch ? '' : color)
                                )}
                              >
                                {defaultSwatch ? <span className="chat-hub-color-default-badge" aria-hidden="true">D</span> : null}
                              </button>
                            );
                          })}
                        </div>
                        <div className="chat-hub-color-custom" style={customHubColorStyle}>
                          <div className="chat-hub-color-custom-header">
                            <span className="chat-hub-color-custom-label">Custom</span>
                            <span className="chat-hub-color-custom-preview" aria-hidden="true" />
                          </div>
                          <div
                            className="chat-hub-color-sv"
                            role="slider"
                            tabIndex={0}
                            aria-label={`Set saturation and brightness for ${hub.hubId}`}
                            aria-valuetext={`${Math.round(currentHubHsv.s * 100)}% saturation, ${Math.round(currentHubHsv.v * 100)}% brightness`}
                            onPointerDown={event => applyHubColorSvPointer(hub.hubId, currentHubHsv, event)}
                            onPointerMove={event => {
                              if (event.pointerType === 'mouse' && event.buttons === 0) {
                                return;
                              }
                              applyHubColorSvPointer(hub.hubId, currentHubHsv, event);
                            }}
                          >
                            <span className="chat-hub-color-sv-thumb" aria-hidden="true" />
                          </div>
                          <div
                            className="chat-hub-color-hue"
                            role="slider"
                            tabIndex={0}
                            aria-label={`Set hue for ${hub.hubId}`}
                            aria-valuemin={0}
                            aria-valuemax={360}
                            aria-valuenow={currentHubHsv.h}
                            onPointerDown={event => applyHubColorHuePointer(hub.hubId, currentHubHsv, event)}
                            onPointerMove={event => {
                              if (event.pointerType === 'mouse' && event.buttons === 0) {
                                return;
                              }
                              applyHubColorHuePointer(hub.hubId, currentHubHsv, event);
                            }}
                          >
                            <span className="chat-hub-color-hue-thumb" aria-hidden="true" />
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {expanded ? (
                      <div className="chat-hub-project-list">
                        {treeItem.projects.map(projectItem => {
                          const visible = !hiddenProjectIdSet.has(projectItem.projectId);
                          return (
                            <button
                              key={`${hub.hubId}:project:${projectItem.projectId}`}
                              type="button"
                              className={`chat-hub-project-row${visible ? '' : ' hidden'}`}
                              role="checkbox"
                              aria-checked={visible}
                              onClick={event => {
                                event.stopPropagation();
                                setHiddenProjectIds(current =>
                                  toggleProjectVisibility(current, projectItem.projectId, !visible),
                                );
                              }}
                              title={projectItem.path || projectItem.projectId}
                            >
                              <span className="chat-hub-project-check" aria-hidden="true">
                                {visible ? <span className="codicon codicon-check" /> : null}
                              </span>
                              <span className="chat-hub-project-name">{projectItem.name}</span>
                            </button>
                          );
                        })}
                        {treeItem.projects.length === 0 ? (
                          <div className="chat-hub-project-empty">No projects</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="chat-hub-empty">No hubs</div>
            )}
          </div>
        ) : null}
      </div>
    );
  }, [
    applyHubColorHuePointer,
    applyHubColorSvPointer,
    chatHubColorMenuHubId,
    chatHubMenuOpen,
    chatHubTreeItems,
    effectiveExpandedHubIds,
    hiddenProjectIdSet,
    hubAccentStyle,
    hubColors,
    projects.length,
    registryHubs,
    setChatConfigOverflowOpen,
    setExpandedHubIds,
    setHiddenProjectIds,
    setHubColors,
  ]);
  const renderHiddenProjectRows = (mobile = false) => {
    if (hiddenProjectItems.length === 0) {
      return null;
    }
    return (
      <div className={`chat-hidden-project-list${mobile ? ' mobile' : ''}`}>
        {hiddenProjectItems.map(projectItem => {
          const hubId = projectHubId(projectItem);
          const projectHubVariant = tagVariantClass('wide-project-hub', hubId);
          return (
            <div key={`hidden-project:${projectItem.projectId}`} className="chat-hidden-project-row">
              <div className={`wide-project-row${mobile ? ' mobile-project-row' : ''}`}>
                <div className={`wide-project-toggle chat-hidden-project-toggle${mobile ? ' mobile-project-toggle' : ''}`}>
                  <span className="wide-project-folder-wrap chat-hidden-project-folder-wrap">
                    <span
                      className={`codicon codicon-folder wide-project-folder-icon chat-hidden-project-folder ${projectHubVariant}`}
                      style={hubAccentStyle(hubId)}
                    />
                  </span>
                  <span className="wide-project-title-group">
                    <span className="wide-project-name" title={projectItem.name}>
                      {projectItem.name}
                    </span>
                    <span
                      className={`wide-project-hub-tag ${projectHubVariant}`}
                      style={hubAccentStyle(hubId)}
                    >
                      <span className="wide-project-hub-dot" aria-hidden="true" />
                      <span className="wide-project-hub-label">{hubId}</span>
                    </span>
                  </span>
                </div>
                <div className={`wide-project-actions${mobile ? ' mobile-project-actions' : ''}`}>
                  <button
                    type="button"
                    className="wide-project-action-btn chat-hidden-project-restore-btn"
                    title={`Show ${projectItem.name}`}
                    aria-label={`Show hidden project ${projectItem.name}`}
                    onClick={() => {
                      setHiddenProjectIds(current =>
                        toggleProjectVisibility(current, projectItem.projectId, true),
                      );
                    }}
                  >
                    <span className="codicon codicon-eye" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };
  const floatingBaseBounds = useMemo(() => {
    if (isWide) {
      return { minTop: 0, maxTop: 0 };
    }
    return resolveFloatingControlDefaultBounds({
      viewportHeight: windowHeight,
      stackHeight: floatingControlStackHeight,
      safeAreaTopInset,
      safeAreaBottomInset,
      defaultComposerTop: floatingDefaultComposerTop,
    });
  }, [
    floatingControlStackHeight,
    floatingDefaultComposerTop,
    isWide,
    safeAreaBottomInset,
    safeAreaTopInset,
    windowHeight,
  ]);
  const floatingAvoidanceBounds = useMemo(() => {
    if (isWide) {
      return { minTop: 0, maxTop: 0 };
    }
    return resolveFloatingControlAvoidanceBounds({
      defaultBounds: floatingBaseBounds,
      viewportHeight: windowHeight,
      keyboardOffset: floatingKeyboardOffset,
      stackHeight: floatingControlStackHeight,
      safeAreaBottomInset,
      composerTop: chatComposerTop,
    });
  }, [
    chatComposerTop,
    floatingBaseBounds.maxTop,
    floatingBaseBounds.minTop,
    floatingControlStackHeight,
    floatingKeyboardOffset,
    isWide,
    safeAreaBottomInset,
    windowHeight,
  ]);
  const floatingBounds = floatingAvoidanceBounds;
  const floatingRestTop = useMemo(
    () => floatingControlTopFromYRatio(
      floatingControlYRatio,
      floatingBaseBounds.minTop,
      floatingBaseBounds.maxTop,
    ),
    [floatingBaseBounds.maxTop, floatingBaseBounds.minTop, floatingControlYRatio],
  );
  const floatingControlTop = useMemo(() => {
    if (floatingDragState?.active) {
      return clampFloatingTop(
        floatingDragState.currentTop,
        floatingBounds.minTop,
        floatingBounds.maxTop,
      );
    }
    return clampFloatingTop(
      floatingRestTop,
      floatingBounds.minTop,
      floatingBounds.maxTop,
    );
  }, [
    floatingBounds.maxTop,
    floatingBounds.minTop,
    floatingDragState,
    floatingRestTop,
  ]);
  useLayoutEffect(() => {
    if (isWide || floatingDragState?.active) {
      floatingPositionSnapshotRef.current = null;
      return;
    }
    const previousFloatingPosition = floatingPositionSnapshotRef.current;
    const boundsChanged =
      previousFloatingPosition !== null &&
      (previousFloatingPosition.minTop !== floatingBaseBounds.minTop ||
        previousFloatingPosition.maxTop !== floatingBaseBounds.maxTop);
    if (boundsChanged && previousFloatingPosition) {
      const nextHasDefaultComposerTop = floatingDefaultComposerTop !== null;
      const nextYRatio = resolveFloatingControlYRatioForBoundsChange({
        previousTop: previousFloatingPosition.top,
        previousHadDefaultComposerTop: previousFloatingPosition.hasDefaultComposerTop,
        nextHasDefaultComposerTop,
        minTop: floatingBaseBounds.minTop,
        maxTop: floatingBaseBounds.maxTop,
        fallbackRatio: floatingControlYRatio,
      });
      const nextTop = floatingControlTopFromYRatio(
        nextYRatio,
        floatingBaseBounds.minTop,
        floatingBaseBounds.maxTop,
      );
      floatingPositionSnapshotRef.current = {
        minTop: floatingBaseBounds.minTop,
        maxTop: floatingBaseBounds.maxTop,
        top: nextTop,
        hasDefaultComposerTop: nextHasDefaultComposerTop,
      };
      if (Math.abs(nextYRatio - floatingControlYRatio) > 0.001) {
        setFloatingControlYRatio(nextYRatio);
        return;
      }
    }
    floatingPositionSnapshotRef.current = {
      minTop: floatingBaseBounds.minTop,
      maxTop: floatingBaseBounds.maxTop,
      top: floatingRestTop,
      hasDefaultComposerTop: floatingDefaultComposerTop !== null,
    };
  }, [
    floatingBaseBounds.maxTop,
    floatingBaseBounds.minTop,
    floatingDefaultComposerTop,
    floatingRestTop,
    floatingControlYRatio,
    floatingDragState?.active,
    isWide,
    setFloatingControlYRatio,
  ]);
  const effectiveFloatingControlTop = floatingControlTop;
  const effectiveFloatingControlStackStyle = useMemo(
    () =>
      !isWide
        ? ({
            top: `${effectiveFloatingControlTop}px`,
          } as React.CSSProperties)
        : undefined,
    [effectiveFloatingControlTop, isWide],
  );
  const floatingDragVisualState =
    floatingDragState?.active
      ? 'dragging'
      : gestureNavigationExpanded
        ? 'gesture-open'
        : gestureNavState?.phase === 'pressing'
          ? 'drag-ready'
          : 'idle';
  const floatingControlsIdle = floatingDragVisualState === 'idle'
    && !drawerOpen
    && !portRelayTargetMenuOpen
    && !chatQuickSwitchMenuOpen
    && !mobilePortRelayFrameOpen;
  const clearGestureMoveLongPressTimer = useCallback(() => {
    if (gestureMoveLongPressTimerRef.current !== null) {
      window.clearTimeout(gestureMoveLongPressTimerRef.current);
      gestureMoveLongPressTimerRef.current = null;
    }
  }, []);
  const clearFloatingCooldownTimer = useCallback(() => {
    if (floatingCooldownTimerRef.current !== null) {
      window.clearTimeout(floatingCooldownTimerRef.current);
      floatingCooldownTimerRef.current = null;
    }
  }, []);
  const clearFloatingSidePulseTimer = useCallback(() => {
    if (floatingSidePulseTimerRef.current !== null) {
      window.clearTimeout(floatingSidePulseTimerRef.current);
      floatingSidePulseTimerRef.current = null;
    }
  }, []);
  const pulseFloatingControlSide = useCallback(
    (side: PersistedFloatingControlSide) => {
      clearFloatingSidePulseTimer();
      setFloatingSidePulse(side);
      floatingSidePulseTimerRef.current = window.setTimeout(() => {
        setFloatingSidePulse('');
        floatingSidePulseTimerRef.current = null;
      }, 160);
    },
    [clearFloatingSidePulseTimer],
  );
  useEffect(() => clearFloatingSidePulseTimer, [clearFloatingSidePulseTimer]);
  const clearFloatingCooldownState = useCallback((cooldownUntil: number) => {
    clearFloatingCooldownTimer();
    const remaining = cooldownUntil - Date.now();
    if (remaining <= 0) {
      setFloatingDragState(prev =>
        prev && !prev.active && !prev.pressing && prev.cooldownUntil <= Date.now()
          ? null
          : prev,
      );
      return;
    }
    floatingCooldownTimerRef.current = window.setTimeout(() => {
      setFloatingDragState(prev =>
        prev && !prev.active && !prev.pressing && prev.cooldownUntil <= Date.now()
          ? null
          : prev,
      );
      floatingCooldownTimerRef.current = null;
    }, remaining);
  }, [clearFloatingCooldownTimer]);
  useEffect(() => {
    if (mobilePortRelayFrameOpen) {
      setChatQuickSwitchMenuOpen(false);
    }
  }, [mobilePortRelayFrameOpen]);
  useEffect(() => {
    if (tab !== 'chat' || sidebarSettingsOpen) {
      setChatQuickSwitchMenuOpen(false);
    }
  }, [sidebarSettingsOpen, tab]);
  useEffect(() => {
    if (!chatQuickSwitchMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && chatQuickSwitchMenuRef.current?.contains(target)) {
        return;
      }
      setChatQuickSwitchMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChatQuickSwitchMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [chatQuickSwitchMenuOpen]);
  const handleFloatingPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const current = floatingDragStateRef.current;
      if (!current || current.pointerId !== event.pointerId) {
        return;
      }
      const deltaY = event.clientY - current.originY;
      if (!current.active) {
        if (Math.abs(deltaY) >= 10) {
          const cooldownUntil = Date.now() + 120;
          floatingClickCooldownUntilRef.current = cooldownUntil;
          setFloatingDragState({
            ...current,
            active: false,
            pressing: false,
            currentX: event.clientX,
            cooldownUntil,
          });
          clearFloatingCooldownState(cooldownUntil);
        }
        return;
      }
      event.preventDefault();
      const currentSide = floatingControlSideRef.current;
      const nextSide = resolveFloatingControlDragSide(
        currentSide,
        event.clientX,
        windowWidth,
      );
      if (nextSide !== currentSide) {
        floatingControlSideRef.current = nextSide;
        setFloatingControlSide(nextSide);
        workspaceStore.rememberGlobalState({ floatingControlSide: nextSide });
        try {
          window.localStorage.setItem(PORT_RELAY_FLOATING_SIDE_STORAGE_KEY, nextSide);
        } catch {
          // Ignore local storage failures in private or restricted contexts.
        }
        closeMobileDrawerCompanionOverlays();
        triggerMobileHaptic();
        pulseFloatingControlSide(nextSide);
      }
      setFloatingDragState({
        ...current,
        currentX: event.clientX,
        currentTop: clampFloatingTop(
          current.startTop + deltaY,
          floatingBounds.minTop,
          floatingBounds.maxTop,
        ),
      });
    },
    [
      closeMobileDrawerCompanionOverlays,
      clearFloatingCooldownState,
      floatingBounds.maxTop,
      floatingBounds.minTop,
      pulseFloatingControlSide,
      setFloatingControlSide,
      windowWidth,
    ],
  );
  const finishFloatingDrag = useCallback(
    (pointerId: number) => {
      const current = floatingDragStateRef.current;
      if (!current || current.pointerId !== pointerId) {
        return;
      }
      if (!current.active) {
        setFloatingDragState(null);
        return;
      }
      const snappedTop = clampFloatingTop(
        current.currentTop,
        floatingBounds.minTop,
        floatingBounds.maxTop,
      );
      const nextYRatio = floatingControlYRatioFromTop(
        snappedTop,
        floatingBaseBounds.minTop,
        floatingBaseBounds.maxTop,
      );
      const nextSide = floatingControlSideRef.current;
      const cooldownUntil = Date.now() + 120;
      floatingClickCooldownUntilRef.current = cooldownUntil;
      setFloatingControlYRatio(nextYRatio);
      setFloatingControlSide(nextSide);
      workspaceStore.rememberGlobalState({ floatingControlYRatio: nextYRatio, floatingControlSide: nextSide });
      try {
        window.localStorage.setItem(PORT_RELAY_FLOATING_Y_RATIO_STORAGE_KEY, String(nextYRatio));
        window.localStorage.setItem(PORT_RELAY_FLOATING_SIDE_STORAGE_KEY, nextSide);
      } catch {
        // Ignore local storage failures in private or restricted contexts.
      }
      setFloatingDragState({
        ...current,
        active: false,
        pressing: false,
        currentTop: snappedTop,
        cooldownUntil,
      });
      clearFloatingCooldownState(cooldownUntil);
    },
    [
      clearFloatingCooldownState,
      floatingBounds.maxTop,
      floatingBounds.minTop,
      floatingBaseBounds.maxTop,
      floatingBaseBounds.minTop,
      setFloatingControlSide,
      setFloatingControlYRatio,
    ],
  );
  const cancelFloatingDrag = useCallback(
    (pointerId: number) => {
      const current = floatingDragStateRef.current;
      if (!current || current.pointerId !== pointerId) {
        return;
      }
      if (!current.active) {
        setFloatingDragState(null);
        return;
      }
      const cooldownUntil = Date.now() + 120;
      floatingClickCooldownUntilRef.current = cooldownUntil;
      setFloatingDragState({
        ...current,
        active: false,
        pressing: false,
        cooldownUntil,
      });
      clearFloatingCooldownState(cooldownUntil);
    },
    [clearFloatingCooldownState],
  );
  const openGestureNavigationActions = useCallback(() => {
    clearGestureMoveLongPressTimer();
    const startedAt = Date.now();
    const nextState: GestureNavigationState = {
      phase: 'expanded',
      pointerId: -1,
      originX: 0,
      originY: 0,
      currentX: 0,
      currentY: 0,
      startedAt,
    };
    gestureNavStateRef.current = nextState;
    setGestureNavState(nextState);
    setDrawerOpen(true);
  }, [
    clearGestureMoveLongPressTimer,
    setDrawerOpen,
  ]);
  const handleGestureNavigationCurrentSelect = useCallback(() => {
    const shouldSuppressSyntheticClick =
      gestureNavigationSuppressClickRef.current &&
      Date.now() <= gestureNavigationSuppressClickUntilRef.current;
    gestureNavigationSuppressClickRef.current = false;
    gestureNavigationSuppressClickUntilRef.current = 0;
    if (shouldSuppressSyntheticClick) {
      return;
    }
    if (gestureNavigationExpanded || gestureNavStateRef.current?.phase === 'expanded') {
      clearGestureMoveLongPressTimer();
      gestureNavStateRef.current = null;
      setGestureNavState(null);
      setDrawerOpen(false);
      return;
    }
    if (floatingClickCooldownUntilRef.current > Date.now()) {
      return;
    }
    openGestureNavigationActions();
  }, [
    clearGestureMoveLongPressTimer,
    gestureNavigationExpanded,
    openGestureNavigationActions,
    setDrawerOpen,
  ]);
  const beginGestureNavigationPress = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (isWide || event.button !== 0) {
        return;
      }
      if (floatingClickCooldownUntilRef.current > Date.now()) {
        return;
      }
      clearGestureMoveLongPressTimer();
      gestureNavigationSuppressClickRef.current = false;
      gestureNavigationSuppressClickUntilRef.current = 0;
      floatingIgnoreLostCaptureRef.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
      const startedAt = Date.now();
      const nextState: GestureNavigationState = {
        phase: 'pressing',
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        startedAt,
      };
      gestureNavStateRef.current = nextState;
      setGestureNavState(nextState);
      gestureMoveLongPressTimerRef.current = window.setTimeout(() => {
        const current = gestureNavStateRef.current;
        gestureMoveLongPressTimerRef.current = null;
        if (!current || current.pointerId !== event.pointerId) {
          return;
        }
        if (!shouldStartGestureMove({
          elapsedMs: Date.now() - current.startedAt,
        })) {
          return;
        }
        gestureNavigationSuppressClickRef.current = false;
        gestureNavigationSuppressClickUntilRef.current = 0;
        gestureNavStateRef.current = null;
        setGestureNavState(null);
        closeMobileDrawerCompanionOverlays();
        setDrawerOpen(false);
        triggerMobileHaptic();
        setFloatingDragState({
          active: true,
          pressing: false,
          pointerId: current.pointerId,
          originX: current.currentX,
          originY: current.currentY,
          startSide: floatingControlSide,
          currentX: current.currentX,
          startTop: floatingControlTop,
          currentTop: floatingControlTop,
          cooldownUntil: 0,
        });
      }, GESTURE_MOVE_LONG_PRESS_MS);
    },
    [
      clearGestureMoveLongPressTimer,
      closeMobileDrawerCompanionOverlays,
      floatingControlSide,
      floatingControlTop,
      isWide,
      setDrawerOpen,
      setFloatingDragState,
    ],
  );
  const handleGestureNavigationButtonPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (gestureNavStateRef.current?.phase !== 'expanded') {
        beginGestureNavigationPress(event);
      }
      event.stopPropagation();
    },
    [beginGestureNavigationPress],
  );
  const handleGestureNavigationPillPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      beginGestureNavigationPress(event);
      event.stopPropagation();
    },
    [beginGestureNavigationPress],
  );
  const handleGestureNavigationPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = floatingDragStateRef.current;
      if (dragState?.pointerId === event.pointerId) {
        handleFloatingPointerMove(event);
        return;
      }
      const current = gestureNavStateRef.current;
      if (!current || current.pointerId !== event.pointerId) {
        return;
      }
      const deltaX = event.clientX - current.originX;
      const deltaY = event.clientY - current.originY;
      const distancePx = Math.hypot(deltaX, deltaY);
      const nextCurrent = {
        ...current,
        currentX: event.clientX,
        currentY: event.clientY,
      };
      if (current.phase !== 'expanded') {
        if (shouldCancelGestureClick({distancePx}) && current.phase !== 'neutral') {
          gestureNavigationSuppressClickRef.current = true;
          gestureNavigationSuppressClickUntilRef.current =
            Date.now() + GESTURE_NAV_CANCELLED_CLICK_SUPPRESS_MS;
          const nextState = {...nextCurrent, phase: 'neutral' as const};
          gestureNavStateRef.current = nextState;
          setGestureNavState(nextState);
          return;
        }
        if (current.currentX !== event.clientX || current.currentY !== event.clientY) {
          gestureNavStateRef.current = nextCurrent;
          setGestureNavState(nextCurrent);
        }
      }
    },
    [
      handleFloatingPointerMove,
    ],
  );
  const finishGestureNavigation = useCallback(
    (pointerId: number) => {
      const current = gestureNavStateRef.current;
      if (!current || current.pointerId !== pointerId) {
        return;
      }
      clearGestureMoveLongPressTimer();
      if (current.phase === 'expanded') {
        return;
      }
      gestureNavStateRef.current = null;
      setGestureNavState(null);
    },
    [
      clearGestureMoveLongPressTimer,
    ],
  );
  const cancelGestureNavigation = useCallback(
    (pointerId?: number) => {
      const current = gestureNavStateRef.current;
      if (typeof pointerId === 'number' && current && current.pointerId !== pointerId) {
        return;
      }
      if (!current && gestureMoveLongPressTimerRef.current === null) {
        return;
      }
      clearGestureMoveLongPressTimer();
      gestureNavStateRef.current = null;
      gestureNavigationSuppressClickRef.current = false;
      gestureNavigationSuppressClickUntilRef.current = 0;
      setGestureNavState(null);
      const cooldownUntil = Date.now() + 120;
      floatingClickCooldownUntilRef.current = cooldownUntil;
      clearFloatingCooldownState(cooldownUntil);
    },
    [clearFloatingCooldownState, clearGestureMoveLongPressTimer],
  );
  useEffect(() => {
    if (!gestureNavigationExpanded) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelGestureNavigation();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && floatingControlStackRef.current?.contains(target)) {
        return;
      }
      if (target && (target as Element).closest?.('.drawer, .drawer-overlay')) {
        return;
      }
      cancelGestureNavigation();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [cancelGestureNavigation, gestureNavigationExpanded]);
  useEffect(() => {
    if (gestureNavigationExpanded && !drawerOpen) {
      cancelGestureNavigation();
    }
  }, [cancelGestureNavigation, drawerOpen, gestureNavigationExpanded]);
  const closeSettingsPanel = useCallback(() => {
    setSettingsDetailView(null);
    setSidebarSettingsOpen(false);
  }, [setSidebarSettingsOpen]);
  const openSettingsRoot = useCallback(() => {
    setSettingsDetailView(null);
    setSidebarSettingsOpen(true);
  }, [setSidebarSettingsOpen]);
  const openSettingsPeer = useCallback((detail: SettingsPeerDetail) => {
    if (isWide && sidebarSettingsOpen && settingsDetailView === detail) {
      closeSettingsPanel();
      return;
    }
    setSidebarSettingsOpen(true);
    if (detail === 'skills') {
      setSkillsError('');
    }
    if (detail === 'tokenStats') {
      setTokenStatsError('');
    }
    if (detail === 'portRelay') {
      setPortRelayError('');
    }
    setSettingsDetailView(detail);
  }, [closeSettingsPanel, isWide, setSidebarSettingsOpen, settingsDetailView, sidebarSettingsOpen]);
  const openSettingsChild = useCallback((detail: SettingsChildDetail) => {
    setSidebarSettingsOpen(true);
    if (detail === 'database') {
      openDatabasePanel();
    }
    setSettingsDetailView(detail);
  }, [setSidebarSettingsOpen]);
  const openSettingsDetail = useCallback((detail: SettingsDetailId) => {
    if (isSettingsPeerDetail(detail)) {
      openSettingsPeer(detail);
      return;
    }
    openSettingsChild(detail);
  }, [openSettingsChild, openSettingsPeer]);
  const handleDesktopSettingsSelect = useCallback(() => {
    if (sidebarSettingsOpen && settingsDetailView === null) {
      closeSettingsPanel();
      return;
    }
    openSettingsRoot();
  }, [closeSettingsPanel, openSettingsRoot, sidebarSettingsOpen, settingsDetailView]);
  useEffect(() => {
    if (!isWide || tab === 'chat') {
      return;
    }
    setTab('chat');
    setSidebarCollapsed(false);
  }, [isWide, setSidebarCollapsed, setTab, tab]);
  const handlePortRelayFloatingPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (isWide || event.button !== 0) {
        return;
      }
      if (floatingClickCooldownUntilRef.current > Date.now()) {
        return;
      }
      if (!mobilePortRelayFrameOpen) {
        return;
      }
      clearPortRelayTargetMenuTimer();
      event.currentTarget.setPointerCapture(event.pointerId);
      portRelayTargetMenuPressRef.current = {
        pointerId: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        longPressed: false,
      };
      portRelayTargetMenuTimerRef.current = window.setTimeout(() => {
        const current = portRelayTargetMenuPressRef.current;
        if (!current || current.pointerId !== event.pointerId) {
          return;
        }
        portRelayTargetMenuPressRef.current = {
          ...current,
          longPressed: true,
        };
        portRelayTargetMenuTimerRef.current = null;
        floatingClickCooldownUntilRef.current = Date.now() + 180;
        setPortRelayTargetMenuOpen(true);
      }, PORT_RELAY_TARGET_MENU_LONG_PRESS_MS);
    },
    [clearPortRelayTargetMenuTimer, isWide, mobilePortRelayFrameOpen],
  );
  const handlePortRelayFloatingPointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const current = portRelayTargetMenuPressRef.current;
      if (!current || current.pointerId !== event.pointerId || current.longPressed) {
        return;
      }
      const distancePx = Math.hypot(event.clientX - current.originX, event.clientY - current.originY);
      if (distancePx < 10) {
        return;
      }
      clearPortRelayTargetMenuTimer();
      portRelayTargetMenuPressRef.current = null;
    },
    [clearPortRelayTargetMenuTimer],
  );
  const finishPortRelayFloatingPress = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const current = portRelayTargetMenuPressRef.current;
      if (!current || current.pointerId !== event.pointerId) {
        return;
      }
      clearPortRelayTargetMenuTimer();
      portRelayTargetMenuPressRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture can already be released by the browser on some mobile WebViews.
      }
      if (!current.longPressed) {
        return;
      }
      event.preventDefault();
      floatingClickCooldownUntilRef.current = Date.now() + 180;
    },
    [clearPortRelayTargetMenuTimer],
  );
  useEffect(() => {
    if (isWide || !sidebarSettingsOpen) {
      mobileSettingsHistoryKeyRef.current = null;
      mobileSettingsReplaceRootHistoryRef.current = false;
      return;
    }
    const nextKey = mobileSettingsHistoryKey(settingsDetailView as MobileSettingsHistoryDetail | null);
    const historyWriteAction = resolveMobileSettingsHistoryWriteAction({
      currentKey: mobileSettingsHistoryKeyRef.current,
      nextDetail: settingsDetailView as MobileSettingsHistoryDetail | null,
      replaceRootWithDetail: mobileSettingsReplaceRootHistoryRef.current,
    });
    mobileSettingsReplaceRootHistoryRef.current = false;
    if (historyWriteAction === 'none') {
      return;
    }
    if (historyWriteAction === 'replace') {
      window.history.replaceState(createMobileSettingsHistoryState(settingsDetailView as MobileSettingsHistoryDetail | null), '', window.location.href);
    } else {
      window.history.pushState(createMobileSettingsHistoryState(settingsDetailView as MobileSettingsHistoryDetail | null), '', window.location.href);
    }
    mobileSettingsHistoryKeyRef.current = nextKey;
  }, [isWide, sidebarSettingsOpen, settingsDetailView]);
  useEffect(() => {
    const handleMobileSettingsPopState = (event: PopStateEvent) => {
      const nextState = event.state;
      const nextIsMobileSettingsHistory = isMobileSettingsHistoryState(nextState);
      const hadMobileSettingsHistory = mobileSettingsHistoryKeyRef.current !== null;
      if (!nextIsMobileSettingsHistory && !hadMobileSettingsHistory) {
        return;
      }
      mobileSettingsHistoryKeyRef.current = nextIsMobileSettingsHistory
        ? mobileSettingsHistoryKey(nextState.detail)
        : null;
      const action = resolveMobileSettingsPopAction({
        nextState,
        settingsOpen: sidebarSettingsOpenRef.current,
        settingsDetailView: settingsDetailViewRef.current as MobileSettingsHistoryDetail | null,
      });
      if (action === 'back-to-root') {
        setSettingsDetailView(nextIsMobileSettingsHistory ? nextState.detail : null);
        return;
      }
      if (action === 'close-settings') {
        setSettingsDetailView(null);
        setSidebarSettingsOpen(false);
      }
    };
    window.addEventListener('popstate', handleMobileSettingsPopState);
    return () => window.removeEventListener('popstate', handleMobileSettingsPopState);
  }, [setSidebarSettingsOpen]);
  const handleSettingsDetailBack = useCallback(() => {
    const currentKind = settingsPageKind(settingsDetailView);
    if (!isWide && sidebarSettingsOpen && currentKind === 'child' && mobileSettingsHistoryKeyRef.current !== null) {
      window.history.back();
      return;
    }
    if (currentKind === 'child') {
      openSettingsRoot();
      return;
    }
    closeSettingsPanel();
  }, [closeSettingsPanel, isWide, openSettingsRoot, sidebarSettingsOpen, settingsDetailView]);
  const handleMobileSettingsBackButton = useCallback(() => {
    if (!isWide && sidebarSettingsOpen && mobileSettingsHistoryKeyRef.current !== null) {
      window.history.back();
      return;
    }
    if (settingsPageKind(settingsDetailView) === 'child') {
      setSettingsDetailView(null);
      return;
    }
    closeSettingsPanel();
  }, [closeSettingsPanel, isWide, sidebarSettingsOpen, settingsDetailView]);
  const handleMobileSettingsRootShortcut = useCallback(() => {
    const currentKind = settingsPageKind(settingsDetailView);
    if (currentKind === 'root') {
      return;
    }
    if (!isWide && sidebarSettingsOpen && currentKind === 'child' && mobileSettingsHistoryKeyRef.current !== null) {
      window.history.back();
      return;
    }
    setSettingsDetailView(null);
  }, [isWide, settingsDetailView, sidebarSettingsOpen]);
  const closeChatFilePeek = useCallback(() => {
    setChatPeekSelectedLines(new Set());
    chatPeekAnchorRef.current = null;
  }, []);
  const closeChatAttachmentPreview = useCallback(() => {
    const tab = activePreviewTab(previewWorkbenchRef.current);
    if (!tab || tab.type !== 'attachment') {
      return;
    }
    chatAttachmentReadSeqRef.current += 1;
    setPreviewWorkbench(current => closePreviewTab(current, tab.projectId, tab.id));
  }, []);
  const closeChatPromptArtifactPreview = useCallback(() => {
    const tab = activePreviewTab(previewWorkbenchRef.current);
    if (!tab || tab.type !== 'prompt-diff') {
      return;
    }
    chatPromptArtifactReadSeqRef.current += 1;
    setPreviewWorkbench(current => closePreviewTab(current, tab.projectId, tab.id));
  }, []);
  const closeChatPortRelayPreview = useCallback(() => {
    const tab = activePreviewTab(previewWorkbenchRef.current);
    if (!tab || tab.type !== 'port-relay') {
      return;
    }
    setPreviewWorkbench(current => closePreviewTab(current, tab.projectId, tab.id));
  }, []);
  const closeChatPreview = useCallback(() => {
    setChatPreviewManualOpen(false);
    setChatPreviewManualCollapsed(true);
    closeChatFilePeek();
    closeChatAttachmentPreview();
    closeChatPromptArtifactPreview();
    closeChatPortRelayPreview();
  }, [closeChatAttachmentPreview, closeChatFilePeek, closeChatPortRelayPreview, closeChatPromptArtifactPreview]);
  const handleAndroidNativeBack = useCallback(() => {
    if (!isWide && terminalOpen) {
      setTerminalOpen(false);
      return true;
    }
    if (!isWide && chatPreviewOpen) {
      chatFilePeekHistoryActiveRef.current = false;
      closeChatPreview();
      return true;
    }
    if (!isWide && sidebarSettingsOpenRef.current && mobileSettingsHistoryKeyRef.current !== null) {
      window.history.back();
      return true;
    }
    if (isWide || !sidebarSettingsOpenRef.current) {
      return false;
    }
    const currentKind = settingsPageKind(settingsDetailViewRef.current);
    mobileSettingsHistoryKeyRef.current = null;
    mobileSettingsReplaceRootHistoryRef.current = false;
    setSettingsDetailView(null);
    if (currentKind !== 'child') {
      setSidebarSettingsOpen(false);
    }
    return true;
  }, [chatPreviewOpen, closeChatPreview, isWide, setSidebarSettingsOpen, terminalOpen]);
  useEffect(() => {
    window.WheelMakerAndroidBack = {
      handleBack: handleAndroidNativeBack,
    };
    return () => {
      if (window.WheelMakerAndroidBack?.handleBack === handleAndroidNativeBack) {
        delete window.WheelMakerAndroidBack;
      }
    };
  }, [handleAndroidNativeBack]);
  const openMobileSettingsShortcutDetail = useCallback((detail: SettingsPeerDetail) => {
    if (settingsDetailView === detail) {
      return;
    }
    if (!isWide && sidebarSettingsOpen) {
      mobileSettingsReplaceRootHistoryRef.current = true;
    }
    openSettingsPeer(detail);
  }, [isWide, openSettingsPeer, settingsDetailView, sidebarSettingsOpen]);
  const clampDesktopSidebarWidthForViewport = useCallback((width: number) => {
    const viewportMax = windowWidth > 0
      ? Math.floor(windowWidth * DESKTOP_SIDEBAR_VIEWPORT_MAX_RATIO)
      : DESKTOP_SIDEBAR_WIDTH_MAX;
    const maxWidth = Math.max(
      DESKTOP_SIDEBAR_WIDTH_MIN,
      Math.min(DESKTOP_SIDEBAR_WIDTH_MAX, viewportMax),
    );
    return Math.min(
      maxWidth,
      Math.max(DESKTOP_SIDEBAR_WIDTH_MIN, Math.round(width)),
    );
  }, [windowWidth]);
  const effectiveDesktopSidebarWidth = useMemo(
    () => clampDesktopSidebarWidthForViewport(
      desktopSidebarDraftWidth ?? desktopSidebarWidth,
    ),
    [clampDesktopSidebarWidthForViewport, desktopSidebarDraftWidth, desktopSidebarWidth],
  );
  const commitDesktopSidebarResize = useCallback(() => {
    const resizeState = desktopSidebarResizeRef.current;
    if (resizeState) {
      setDesktopSidebarWidth(resizeState.currentWidth);
    }
    desktopSidebarResizeRef.current = null;
    setDesktopSidebarDraftWidth(null);
    setDesktopSidebarResizing(false);
  }, [setDesktopSidebarWidth]);
  const beginDesktopSidebarResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isWide) return;
    event.preventDefault();
    event.stopPropagation();
    desktopSidebarResizeRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      startWidth: effectiveDesktopSidebarWidth,
      currentWidth: effectiveDesktopSidebarWidth,
    };
    setDesktopSidebarDraftWidth(effectiveDesktopSidebarWidth);
    setDesktopSidebarResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [effectiveDesktopSidebarWidth, isWide]);
  const moveDesktopSidebarResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const resizeState = desktopSidebarResizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const nextWidth = resizeState.startWidth + event.clientX - resizeState.originX;
    const clampedWidth = clampDesktopSidebarWidthForViewport(nextWidth);
    desktopSidebarResizeRef.current = {
      ...resizeState,
      currentWidth: clampedWidth,
    };
    setDesktopSidebarDraftWidth(clampedWidth);
  }, [clampDesktopSidebarWidthForViewport]);
  const finishDesktopSidebarResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const resizeState = desktopSidebarResizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    commitDesktopSidebarResize();
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already be released by the browser.
    }
  }, [commitDesktopSidebarResize]);
  const resetDesktopSidebarWidth = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    desktopSidebarResizeRef.current = null;
    setDesktopSidebarDraftWidth(null);
    setDesktopSidebarResizing(false);
    setDesktopSidebarWidth(
      sanitizeDesktopSidebarWidth(
        clampDesktopSidebarWidthForViewport(DESKTOP_SIDEBAR_WIDTH_DEFAULT),
      ),
    );
  }, [clampDesktopSidebarWidthForViewport, setDesktopSidebarWidth]);
  const clampChatFilePeekWidthForViewport = useCallback((width: number, allowFullPreviewWidth = false) => {
    const viewportMax = windowWidth > 0
      ? Math.floor(windowWidth * CHAT_FILE_PEEK_VIEWPORT_MAX_RATIO)
      : CHAT_FILE_PEEK_WIDTH_MAX;
    const occupiedWidth = sidebarCollapsed ? 48 : effectiveDesktopSidebarWidth + 48;
    const middlePreservingMax = windowWidth > 0
      ? windowWidth - occupiedWidth - CHAT_FILE_PEEK_MAIN_MIN_WIDTH
      : CHAT_FILE_PEEK_WIDTH_MAX;
    const boundedMax = allowFullPreviewWidth
      ? middlePreservingMax
      : Math.min(CHAT_FILE_PEEK_WIDTH_MAX, viewportMax, middlePreservingMax);
    const maxWidth = Math.max(
      CHAT_FILE_PEEK_WIDTH_MIN,
      boundedMax,
    );
    return Math.min(
      maxWidth,
      Math.max(CHAT_FILE_PEEK_WIDTH_MIN, Math.round(width)),
    );
  }, [effectiveDesktopSidebarWidth, sidebarCollapsed, windowWidth]);
  const fixedChatPreviewDefaultWidth = useMemo(() => {
    const occupiedWidth = sidebarCollapsed ? 48 : effectiveDesktopSidebarWidth + 48;
    const availableWidth = windowWidth > 0
      ? windowWidth - occupiedWidth
      : CHAT_FIXED_VIEW_WIDTH + CHAT_FILE_PEEK_WIDTH_DEFAULT;
    return clampChatFilePeekWidthForViewport(
      availableWidth - CHAT_FIXED_VIEW_WIDTH,
      true,
    );
  }, [clampChatFilePeekWidthForViewport, effectiveDesktopSidebarWidth, sidebarCollapsed, windowWidth]);
  const effectiveChatFilePeekWidth = useMemo(
    () => {
      const committedWidth = desktopChatFixedPreview && !chatFilePeekWidthResized
        ? fixedChatPreviewDefaultWidth
        : chatFilePeekWidth;
      return clampChatFilePeekWidthForViewport(
        chatFilePeekDraftWidth ?? committedWidth,
        desktopChatFixedPreview,
      );
    },
    [
      chatFilePeekDraftWidth,
      chatFilePeekWidth,
      chatFilePeekWidthResized,
      clampChatFilePeekWidthForViewport,
      desktopChatFixedPreview,
      fixedChatPreviewDefaultWidth,
    ],
  );
  const commitChatFilePeekResize = useCallback(() => {
    const resizeState = chatFilePeekResizeRef.current;
    if (resizeState) {
      setChatFilePeekWidth(resizeState.currentWidth);
      setChatFilePeekWidthResized(true);
    }
    chatFilePeekResizeRef.current = null;
    setChatFilePeekDraftWidth(null);
    setChatFilePeekResizing(false);
  }, []);
  const beginChatFilePeekResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isWide || !chatPreviewOpen) return;
    event.preventDefault();
    event.stopPropagation();
    chatFilePeekResizeRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      startWidth: effectiveChatFilePeekWidth,
      currentWidth: effectiveChatFilePeekWidth,
    };
    setChatFilePeekDraftWidth(effectiveChatFilePeekWidth);
    setChatFilePeekResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [chatPreviewOpen, effectiveChatFilePeekWidth, isWide]);
  const moveChatFilePeekResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const resizeState = chatFilePeekResizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const nextWidth = resizeState.startWidth + resizeState.originX - event.clientX;
    const clampedWidth = clampChatFilePeekWidthForViewport(nextWidth, desktopChatFixedPreview);
    chatFilePeekResizeRef.current = {
      ...resizeState,
      currentWidth: clampedWidth,
    };
    setChatFilePeekDraftWidth(clampedWidth);
  }, [clampChatFilePeekWidthForViewport, desktopChatFixedPreview]);
  const finishChatFilePeekResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const resizeState = chatFilePeekResizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    commitChatFilePeekResize();
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may already be released by the browser.
    }
  }, [commitChatFilePeekResize]);
  const getWideProjectAgents = useCallback(
    (projectItem: RegistryProject, sessions: RegistryChatSession[]): string[] => {
      const seen = new Set<string>();
      const agents: string[] = [];
      const append = (value?: string) => {
        const normalized = normalizeAgentTypeName(value);
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        agents.push(normalized);
      };
      for (const item of projectItem.agents ?? []) {
        append(item);
      }
      append(projectItem.agent);
      for (const session of sessions) {
        append(session.agentType);
      }
      return agents;
    },
    [],
  );
  const toggleWideProjectCollapsed = useCallback(
    (targetProjectId: string) => {
      setWideProjectActionMenu(current =>
        current?.projectId === targetProjectId ? null : current,
      );
      setMobileProjectActionMenu(current =>
        current?.projectId === targetProjectId ? null : current,
      );
      setCollapsedProjectIds(current =>
        current.includes(targetProjectId)
          ? current.filter(item => item !== targetProjectId)
          : [...current, targetProjectId],
      );
    },
    [setCollapsedProjectIds],
  );
  const clearProjectPinLongPress = useCallback(() => {
    if (projectPinLongPressTimerRef.current !== null) {
      window.clearTimeout(projectPinLongPressTimerRef.current);
      projectPinLongPressTimerRef.current = null;
    }
  }, []);
  const togglePinnedProject = useCallback(
    (targetProjectId: string) => {
      setPinnedProjectIds(current => togglePinnedProjectId(current, targetProjectId));
    },
    [setPinnedProjectIds],
  );
  const startProjectPinLongPress = useCallback(
    (targetProjectId: string, event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      clearProjectPinLongPress();
      projectPinLongPressTargetRef.current = '';
      const target = event.currentTarget;
      if (target.setPointerCapture) {
        try {
          target.setPointerCapture(event.pointerId);
        } catch {
          // Pointer capture is best-effort; the timer still covers normal press flows.
        }
      }
      projectPinLongPressTimerRef.current = window.setTimeout(() => {
        projectPinLongPressTimerRef.current = null;
        projectPinLongPressTargetRef.current = targetProjectId;
        triggerMobileHaptic();
        togglePinnedProject(targetProjectId);
      }, PROJECT_PIN_LONG_PRESS_MS);
    },
    [clearProjectPinLongPress, togglePinnedProject],
  );
  const finishProjectPinLongPress = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      clearProjectPinLongPress();
      const target = event.currentTarget;
      if (target.hasPointerCapture?.(event.pointerId)) {
        try {
          target.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }
    },
    [clearProjectPinLongPress],
  );
  const consumeProjectPinLongPressClick = useCallback(
    (targetProjectId: string, event: React.MouseEvent<HTMLButtonElement>): boolean => {
      if (projectPinLongPressTargetRef.current !== targetProjectId) {
        return false;
      }
      projectPinLongPressTargetRef.current = '';
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
    [],
  );
  useEffect(() => clearProjectPinLongPress, [clearProjectPinLongPress]);
  const clearProjectSessionLongPress = useCallback(() => {
    if (projectSessionLongPressTimerRef.current !== null) {
      window.clearTimeout(projectSessionLongPressTimerRef.current);
      projectSessionLongPressTimerRef.current = null;
    }
  }, []);
  const projectSessionActionKey = (targetProjectId: string, sessionId: string) =>
    `${targetProjectId}:${sessionId}`;
  const startProjectSessionLongPress = useCallback(
    (
      targetProjectId: string,
      sessionId: string,
      event: React.PointerEvent<HTMLButtonElement>,
    ) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      clearProjectSessionLongPress();
      projectSessionLongPressTargetRef.current = '';
      const target = event.currentTarget;
      const pressX = event.clientX;
      const pressY = event.clientY;
      if (target.setPointerCapture) {
        try {
          target.setPointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }
      projectSessionLongPressTimerRef.current = window.setTimeout(() => {
        projectSessionLongPressTimerRef.current = null;
        projectSessionLongPressTargetRef.current = projectSessionActionKey(
          targetProjectId,
          sessionId,
        );
        triggerMobileHaptic();
        setProjectSessionActionMenu({
          projectId: targetProjectId,
          sessionId,
          popover: resolveWideProjectActionPopoverPlacement({
            anchorRect: {
              left: pressX,
              top: pressY,
              right: pressX,
              bottom: pressY,
            },
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            preferredWidth: 156,
            preferredMaxHeight: 190,
            align: 'start',
          }),
        });
      }, PROJECT_SESSION_LONG_PRESS_MS);
    },
    [clearProjectSessionLongPress],
  );
  const finishProjectSessionLongPress = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      clearProjectSessionLongPress();
      const target = event.currentTarget;
      if (target.hasPointerCapture?.(event.pointerId)) {
        try {
          target.releasePointerCapture(event.pointerId);
        } catch {
          // ignore
        }
      }
    },
    [clearProjectSessionLongPress],
  );
  const consumeProjectSessionLongPressClick = useCallback(
    (
      targetProjectId: string,
      sessionId: string,
      event: React.MouseEvent<HTMLButtonElement>,
    ): boolean => {
      if (
        projectSessionLongPressTargetRef.current !==
        projectSessionActionKey(targetProjectId, sessionId)
      ) {
        return false;
      }
      projectSessionLongPressTargetRef.current = '';
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
    [],
  );
  useEffect(() => clearProjectSessionLongPress, [clearProjectSessionLongPress]);
  useEffect(() => {
    if (!projectSessionActionMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.project-session-action-menu')) {
        return;
      }
      setProjectSessionActionMenu(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [projectSessionActionMenu]);
  const openProjectSessionContextMenu = (
    targetProjectId: string,
    sessionId: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    clearProjectSessionLongPress();
    const normalizedSessionId = sessionId.trim();
    if (!targetProjectId || !normalizedSessionId) {
      return;
    }
    projectSessionLongPressTargetRef.current = projectSessionActionKey(targetProjectId, normalizedSessionId);
    setProjectSessionActionMenu({
      projectId: targetProjectId,
      sessionId: normalizedSessionId,
      popover: resolveWideProjectActionPopoverPlacement({
        anchorRect: {
          left: event.clientX,
          top: event.clientY,
          bottom: event.clientY,
          right: event.clientX,
        },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        preferredWidth: 156,
        preferredMaxHeight: 190,
        align: 'start',
      }),
    });
  };
  currentProjectRef.current = currentProject;
  projectsRef.current = projects;
  terminalSyncRef.current = terminalSync;
  activeTerminalKeyRef.current = activeTerminalKey;
  expandedDirsRef.current = expandedDirs;
  selectedFileRef.current = selectedFile;
  previewWorkbenchRef.current = previewWorkbench;
  chatFilePeekRef.current = chatFilePeek;

  useEffect(() => {
    workspaceStore.rememberGlobalState({previewWorkbenchSnapshot: previewWorkbenchSnapshotFromState(previewWorkbench)});
  }, [previewWorkbench]);

  useEffect(() => {
    setFileTabSelectedLines(new Set());
    fileTabAnchorRef.current = null;
  }, [selectedFile]);

  const worktreeActive = selectedDiffSource === 'worktree';

  const isExpanded = (path: string) => expandedDirs.includes(path);
  const selectedFileIsMarkdown = isMarkdownPath(selectedFile);
  const selectedFileIsHtml = isHtmlPath(selectedFile);
  const isSelectedFilePinned = selectedFile
    ? pinnedFiles.includes(selectedFile)
    : false;
  const hasPinnedFiles = pinnedFiles.length > 0;
  const fileLines = useMemo(() => fileContent.split('\n'), [fileContent]);
  const activePreviewProjectId = previewWorkbench.activeProjectId;
  const activePreviewProjectDirEntries =
    chatFilePreviewDirEntriesByProject[activePreviewProjectId];
  const chatFilePreviewRootLoaded = !!activePreviewProjectDirEntries &&
    Object.prototype.hasOwnProperty.call(activePreviewProjectDirEntries, '.');
  const chatFilePreviewDirEntries = activePreviewProjectDirEntries ?? EMPTY_DIR_ENTRIES;
  const chatFilePreviewLoadingDirs =
    chatFilePreviewLoadingDirsByProject[activePreviewProjectId] ?? {};
  const chatFilePreviewDirErrors =
    chatFilePreviewDirErrorsByProject[activePreviewProjectId] ?? {};
  const chatFilePreviewExpandedDirs =
    chatFilePreviewExpandedDirsByProject[activePreviewProjectId] ?? ['.'];
  const chatFilePreviewRootState: 'ready' | 'loading' | 'error' | 'empty' =
    !chatFilePreviewRootLoaded
      ? chatFilePreviewDirErrors['.']
        ? 'error'
        : 'loading'
      : chatFilePreviewDirEntries['.'].length > 0
        ? 'ready'
        : 'empty';
  const isPreviewDirectoryExpanded = (path: string) =>
    chatFilePreviewExpandedDirs.includes(path);
  const previewFileTreeSearchTree = useMemo(
    () => buildFileSearchResultTree(previewFileTreeSearchResults, {
      dirEntries: chatFilePreviewDirEntries,
    }),
    [chatFilePreviewDirEntries, previewFileTreeSearchResults],
  );
  const previewFileTreeSearchVisibleResults = useMemo(
    () => flattenFileSearchResultTree(previewFileTreeSearchTree, {
      collapsedDirPaths: previewFileTreeSearchCollapsedDirs,
    }),
    [previewFileTreeSearchCollapsedDirs, previewFileTreeSearchTree],
  );
  const previewFileTreeSearchActivePath =
    previewFileTreeSearchVisibleResults[previewFileTreeSearchActiveIndex]?.path ?? '';
  const fileSearchMatches = useMemo(() => {
    const query = fileSearchQuery.trim().toLocaleLowerCase();
    if (!query) return [] as number[];
    const matches: number[] = [];
    for (let i = 0; i < fileLines.length; i += 1) {
      if (fileLines[i].toLocaleLowerCase().includes(query)) {
        matches.push(i + 1);
      }
    }
    return matches;
  }, [fileContent, fileLines, fileSearchQuery]);

  useEffect(() => {
    setPreviewFileTreeSearchActiveIndex(current =>
      previewFileTreeSearchVisibleResults.length === 0
        ? 0
        : Math.min(current, previewFileTreeSearchVisibleResults.length - 1),
    );
  }, [previewFileTreeSearchVisibleResults.length]);

  const applyHydratedProjectState = (
    hydrated: {
      projectId: string;
      dirEntries: Record<string, RegistryFsEntry[]>;
      expandedDirs: string[];
      selectedFile: string;
      pinnedFiles: string[];
      gitCurrentBranch: string;
      commits: RegistryGitCommit[];
      selectedCommit: string;
      commitFilesBySha: Record<string, RegistryGitCommitFile[]>;
      selectedDiff: string;
      cachedDiffText: string;
    },
    options?: {preserveFileView?: boolean; keepMobileDrawerOpen?: boolean},
  ) => {
    const preserveFileView =
      options?.preserveFileView === true &&
      hydrated.projectId === projectIdRef.current &&
      hydrated.selectedFile === selectedFileRef.current &&
      !!hydrated.selectedFile;

    if (!preserveFileView) {
      fileReadSeqRef.current += 1;
      dirHashRef.current = {};
      fileHashRef.current = {};
      fileCacheRef.current = {};
    }
    const previousProjectId = projectIdRef.current;
    if (hydrated.projectId !== previousProjectId) {
      knownGitRevRef.current = '';
      knownWorktreeRevRef.current = '';
      failedGitRevLoadKeyRef.current = '';
      setGitError('');
    }
    expandedDirsRef.current = hydrated.expandedDirs;
    selectedFileRef.current = hydrated.selectedFile;
    projectIdRef.current = hydrated.projectId;
    setProjectId(hydrated.projectId);
    setDirEntries(hydrated.dirEntries);
    setExpandedDirs(hydrated.expandedDirs);
    setSelectedFile(hydrated.selectedFile);
    setPinnedFiles([]);
    setPinnedFiles(hydrated.pinnedFiles);
    if (!preserveFileView) {
      setFileContent('');
      setFileInfo(null);
    }
    setGitCurrentBranch(hydrated.gitCurrentBranch);
    setGitBranches([]);
    setGitSelectedBranches([]);
    gitSelectedBranchesRef.current = [];
    setGitBranchPickerOpen(false);
    setCommits(hydrated.commits);
    setSelectedCommit(hydrated.selectedCommit);
    setExpandedCommitShas(hydrated.selectedCommit ? [hydrated.selectedCommit] : []);
    setCommitFilesBySha(hydrated.commitFilesBySha);
    setWorktreeExpanded(true);
    setCommitPopover(null);
    setSelectedDiff(hydrated.selectedDiff);
    setDiffText(hydrated.cachedDiffText);
    setWorkingTreeFiles([]);
    setGitLoadedProjectId('');
    setProjectMenuOpen(false);
    setWorkspaceProjectMenuOpen(false);
    setSidebarSettingsOpen(false);
    if (!isWide && options?.keepMobileDrawerOpen !== true) setDrawerOpen(false);
  };

  const togglePinSelectedFile = () => {
    if (!selectedFile) return;
    setPinnedFiles(prev =>
      prev.includes(selectedFile)
        ? prev.filter(path => path !== selectedFile)
        : [...prev, selectedFile],
    );
  };

  useEffect(() => {
    if (fileSearchMatches.length === 0) {
      setCurrentMatchIndex(0);
      return;
    }
    setCurrentMatchIndex(prev => Math.min(prev, fileSearchMatches.length - 1));
  }, [fileSearchMatches.length]);

  useEffect(() => {
    if (!searchToolsOpen) return;
    const query = fileSearchQuery.trim();
    if (!query || fileSearchMatches.length === 0) return;
    setCurrentMatchIndex(0);
    window.requestAnimationFrame(() => {
      scrollToFileLine(fileSearchMatches[0]);
    });
  }, [fileSearchMatches, fileSearchQuery, searchToolsOpen]);

  useEffect(
    () => () => {
      fileReadAbortControllerRef.current?.abort();
      for (const controller of previewFileLoadControllersRef.current.values()) {
        controller.abort();
      }
      previewFileLoadControllersRef.current.clear();
      previewSearchJumpCancelRef.current?.();
      previewSearchJumpCancelRef.current = null;
      if (liveRefreshTimerRef.current !== null) {
        window.clearTimeout(liveRefreshTimerRef.current);
      }
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
    },
    [],
  );

  const captureSelectedFileScrollPosition = () => {
    const path = selectedFileRef.current;
    const container = fileScrollRef.current;
    if (!path || !container) return;
    fileScrollTopByPathRef.current[path] = container.scrollTop;
  };

  const scheduleRestoreSelectedFileScroll = (path: string) => {
    const savedTop = fileScrollTopByPathRef.current[path];
    if (!Number.isFinite(savedTop)) return;

    const restoreOnNextFrame = (attempt: number) => {
      const container = fileScrollRef.current;
      if (!container) return;
      if (selectedFileRef.current !== path) return;

      const maxScrollTop = Math.max(
        0,
        container.scrollHeight - container.clientHeight,
      );
      if (maxScrollTop <= 0 && attempt < 8) {
        window.requestAnimationFrame(() => restoreOnNextFrame(attempt + 1));
        return;
      }
      container.scrollTop = Math.min(savedTop, maxScrollTop);
    };

    window.requestAnimationFrame(() => restoreOnNextFrame(0));
  };

  const jumpToFileLineNow = (
    container: HTMLElement,
    line: number,
    options?: {content?: string},
  ) => {
    jumpToPreviewLineNow({
      container,
      line,
      content: options?.content ?? '',
      mode: 'code',
      lineHeight: Math.max(12, codeFontSize * codeLineHeight),
    });
  };

  const scrollToFileLine = (line: number) => {
    const container = fileScrollRef.current;
    if (!container) return;
    jumpToFileLineNow(container, line, {content: fileContent});
  };

  useEffect(() => {
    if (!pendingFileJump) return;
    if (tab !== 'file') return;
    if (selectedFileRef.current !== pendingFileJump.path) return;
    if (fileLoading) return;

    const targetPath = pendingFileJump.path;
    const targetLine = pendingFileJump.line;
    return schedulePreviewLineJump({
      getContainer: () => fileScrollRef.current,
      isCurrent: () => tab === 'file' && selectedFileRef.current === targetPath,
      line: targetLine,
      content: fileContent,
      mode: 'code',
      lineHeight: Math.max(12, codeFontSize * codeLineHeight),
      onFinish: () => {
        if (selectedFileRef.current !== targetPath) return;
        fileTabAnchorRef.current = targetLine;
        setFileTabSelectedLines(new Set([targetLine]));
        setPendingFileJump(current =>
          current && current.path === targetPath && current.line === targetLine
            ? null
            : current,
        );
      },
    });
  }, [
    pendingFileJump,
    tab,
    fileLoading,
    selectedFile,
    fileContent,
    codeFontSize,
    codeLineHeight,
  ]);

  useEffect(() => {
    if (!chatFilePeek || chatFilePeek.loading || chatFilePeek.error || !chatFilePeek.targetLine) return;
    const targetLine = chatFilePeek.targetLine;
    const targetPath = chatFilePeek.path;
    const targetContent = chatFilePeek.content;
    const isHtmlPreview = isHtmlPath(targetPath);
    const isImagePreview = isImageFile(targetPath, chatFilePeek.info?.mimeType);
    if (isHtmlPreview || isImagePreview) return;
    return schedulePreviewLineJump({
      getContainer: () => chatFilePeekScrollRef.current,
      isCurrent: () => chatFilePeekRef.current?.path === targetPath,
      line: targetLine,
      content: targetContent,
      mode: isMarkdownPath(targetPath) ? 'markdown' : 'code',
      lineHeight: Math.max(12, codeFontSize * codeLineHeight),
    });
  }, [
    chatFilePeek?.path,
    chatFilePeek?.targetLine,
    chatFilePeek?.content,
    chatFilePeek?.loading,
    chatFilePeek?.error,
    chatFilePeek?.info?.mimeType,
    codeFontSize,
    codeLineHeight,
  ]);

  const navigateSearchMatch = (delta: 1 | -1) => {
    if (fileSearchMatches.length === 0) return;
    const next =
      (currentMatchIndex + delta + fileSearchMatches.length) %
      fileSearchMatches.length;
    setCurrentMatchIndex(next);
    scrollToFileLine(fileSearchMatches[next]);
  };

  const triggerGoToLine = () => {
    if (!selectedFile || fileLoading || !fileLines.length) return;
    const raw = gotoLineInput.trim();
    if (!raw) return;
    if (!/^\d+$/.test(raw)) {
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return;
    }
    const line = Math.max(1, Math.min(fileLines.length, parsed));
    setGotoLineInput(String(line));
    window.requestAnimationFrame(() => {
      scrollToFileLine(line);
    });
  };

  const loadDirectory = async (path: string, options?: {projectId?: string}) => {
    if (loadingDirs[path]) return;
    const targetProjectId = options?.projectId || projectIdRef.current || projectId;
    const fileCacheDisabled = disableFileCache === true;
    setLoadingDirs(prev => ({ ...prev, [path]: true }));
    try {
      const persistedCache = !fileCacheDisabled && targetProjectId
        ? workspaceStore.getCachedDirectory(targetProjectId, path)
        : null;
      const knownHash = fileCacheDisabled ? '' :
        dirHashRef.current[path] || persistedCache?.hash || '';
      const result = await service.listDirectory(
        path,
        fileCacheDisabled ? undefined : knownHash || undefined,
      );

      if (result.notModified) {
        const cachedEntries = persistedCache?.entries;
        if (Array.isArray(cachedEntries)) {
          setDirEntries(prev => ({ ...prev, [path]: sortEntries(cachedEntries) }));
        }
        if (result.hash) {
          if (!fileCacheDisabled) {
            dirHashRef.current[path] = result.hash;
          }
          if (!fileCacheDisabled && targetProjectId && Array.isArray(cachedEntries)) {
            workspaceStore.cacheDirectory(targetProjectId, path, result.hash, cachedEntries);
          }
        }
        return;
      }

      const entries = sortEntries(result.entries);
      setDirEntries(prev => ({ ...prev, [path]: entries }));
      const nextHash = result.hash || persistedCache?.hash || '';
      if (!fileCacheDisabled && nextHash) {
        dirHashRef.current[path] = nextHash;
      }
      if (!fileCacheDisabled && targetProjectId) {
        workspaceStore.cacheDirectory(targetProjectId, path, nextHash, entries);
      }
    } finally {
      setLoadingDirs(prev => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    }
  };

  const toggleDirectory = async (path: string) => {
    if (isExpanded(path)) {
      setExpandedDirs(prev => prev.filter(item => item !== path));
      return;
    }
    setExpandedDirs(prev => [...prev, path]);
    if (!dirEntries[path]) {
      try {
        await loadDirectory(path);
      } catch (err) {
        setExpandedDirs(prev => prev.filter(item => item !== path));
        const reason = err instanceof Error ? err.message : String(err);
        setError(`Failed to load directory "${path}": ${reason}`);
      }
    }
  };

  const loadPreviewDirectory = async (projectId: string, path: string) => {
    const targetProjectId = projectId;
    if (!targetProjectId) return;
    const loadKey = fileMemoryCacheKey(targetProjectId, path);
    if (previewDirectoryLoadKeysRef.current.has(loadKey)) return;
    previewDirectoryLoadKeysRef.current.add(loadKey);
    const fileCacheDisabled = disableFileCache === true;
    setChatFilePreviewDirErrorsByProject(prev => ({
      ...prev,
      [targetProjectId]: {...(prev[targetProjectId] ?? {}), [path]: ''},
    }));
    setChatFilePreviewLoadingDirsByProject(prev => ({
      ...prev,
      [targetProjectId]: {...(prev[targetProjectId] ?? {}), [path]: true},
    }));
    try {
      const persistedCache = !fileCacheDisabled
        ? workspaceStore.getCachedDirectory(targetProjectId, path)
        : null;
      const cachedEntries = persistedCache?.entries;
      const knownHash = !fileCacheDisabled && cachedEntries
        ? dirHashRef.current[loadKey] || persistedCache?.hash || ''
        : '';
      const result = await fetchPreviewDirectoryEntries({
        cachedEntries,
        knownHash,
        request: requestHash => service.listProjectDirectory(
          targetProjectId,
          path,
          requestHash,
        ),
      });
      const entries = sortEntries(result.entries);
      setChatFilePreviewDirEntriesByProject(prev => ({
        ...prev,
        [targetProjectId]: {
          ...(prev[targetProjectId] ?? {}),
          [path]: entries,
        },
      }));
      const nextHash = result.hash || persistedCache?.hash || '';
      if (!fileCacheDisabled && nextHash) {
        dirHashRef.current[loadKey] = nextHash;
      }
      if (!fileCacheDisabled) {
        workspaceStore.cacheDirectory(targetProjectId, path, nextHash, entries);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setChatFilePreviewDirErrorsByProject(prev => ({
        ...prev,
        [targetProjectId]: {...(prev[targetProjectId] ?? {}), [path]: reason},
      }));
      throw err;
    } finally {
      previewDirectoryLoadKeysRef.current.delete(loadKey);
      setChatFilePreviewLoadingDirsByProject(prev => {
        const projectLoading = {...(prev[targetProjectId] ?? {})};
        delete projectLoading[path];
        return {
          ...prev,
          [targetProjectId]: projectLoading,
        };
      });
    }
  };

  const togglePreviewDirectory = async (path: string) => {
    const targetProjectId = previewWorkbench.activeProjectId;
    if (!targetProjectId) return;
    const expanded = chatFilePreviewExpandedDirsByProject[targetProjectId] ?? ['.'];
    setChatFilePreviewExpandedDirsByProject(prev =>
      togglePreviewDirectoryExpansion(prev, targetProjectId, path),
    );
    if (expanded.includes(path)) {
      return;
    }
    const projectEntries = chatFilePreviewDirEntriesByProject[targetProjectId] ?? {};
    if (!projectEntries[path]) {
      try {
        await loadPreviewDirectory(targetProjectId, path);
      } catch (err) {
        setChatFilePreviewExpandedDirsByProject(prev => ({
          ...prev,
          [targetProjectId]: (prev[targetProjectId] ?? ['.']).filter(item => item !== path),
        }));
        const reason = err instanceof Error ? err.message : String(err);
        setError(`Failed to load directory "${path}": ${reason}`);
      }
    }
  };

  useEffect(() => {
    if (!previewWorkbench.treeOpen) return;
    const targetProjectId = previewWorkbench.activeProjectId;
    if (!targetProjectId) return;
    if (chatFilePreviewDirEntriesByProject[targetProjectId]?.['.']) return;
    loadPreviewDirectory(targetProjectId, '.').catch(() => undefined);
  }, [
    previewWorkbench.activeProjectId,
    previewWorkbench.treeOpen,
    chatFilePreviewDirEntriesByProject,
  ]);

  const retryPreviewRootDirectory = () => {
    const targetProjectId = previewWorkbench.activeProjectId;
    if (!targetProjectId) return;
    loadPreviewDirectory(targetProjectId, '.').catch(() => undefined);
  };

  const readSelectedFile = async (path: string, options?: {restoreScroll?: boolean; silent?: boolean}) => {
    if (!path) return;
    const targetProjectId = projectIdRef.current || projectId;
    if (!targetProjectId) return;
    fileReadAbortControllerRef.current?.abort();
    const controller = new AbortController();
    fileReadAbortControllerRef.current = controller;
    const requestSeq = fileReadSeqRef.current + 1;
    fileReadSeqRef.current = requestSeq;
    const silentRead = options?.silent === true;
    if (!silentRead) {
      setFileLoading(true);
    }
    const shouldRestoreScroll = options?.restoreScroll === true;
    try {
      const info = await service.getProjectFileInfo(targetProjectId, path, {signal: controller.signal});
      if (requestSeq !== fileReadSeqRef.current || projectIdRef.current !== targetProjectId) return;
      setFileInfo(info);
      const cacheKey = fileMemoryCacheKey(targetProjectId, path);
      const fileCacheDisabled = disableFileCache === true;
      const persistedFile = fileCacheDisabled ? null : workspaceStore.getCachedFile(targetProjectId, path);
      if (
        !fileCacheDisabled &&
        typeof persistedFile?.content === 'string' &&
        fileCacheRef.current[cacheKey] === undefined
      ) {
        fileCacheRef.current[cacheKey] = persistedFile.content;
      }
      if (!fileCacheDisabled && persistedFile?.hash && !fileHashRef.current[cacheKey]) {
        fileHashRef.current[cacheKey] = persistedFile.hash;
      }
      const cachedContent = fileCacheDisabled ? undefined : fileCacheRef.current[cacheKey] ?? persistedFile?.content;
      const knownHash = !fileCacheDisabled && typeof cachedContent === 'string'
        ? fileHashRef.current[cacheKey] || persistedFile?.hash || ''
        : '';
      const isFirstLoad = !knownHash;
      if ((info.size ?? 0) > LARGE_FILE_CONFIRM_BYTES && isFirstLoad) {
        const sizeMB = ((info.size ?? 0) / (1024 * 1024)).toFixed(1);
        const confirmed = window.confirm(
          `This file is ${sizeMB} MB. Load full content now?`,
        );
        if (!confirmed) {
          setFileContent('');
          return;
        }
      }
      const result = await service.readProjectFile(path, targetProjectId, {
        knownHash: fileCacheDisabled ? undefined : knownHash || undefined,
        signal: controller.signal,
      });
      if (requestSeq !== fileReadSeqRef.current || projectIdRef.current !== targetProjectId) return;
      if (result.notModified && fileCacheDisabled) {
        const freshResult = await service.readProjectFile(path, targetProjectId, {signal: controller.signal});
        if (requestSeq !== fileReadSeqRef.current || projectIdRef.current !== targetProjectId) return;
        setFileContent(freshResult.content);
        if (shouldRestoreScroll) {
          scheduleRestoreSelectedFileScroll(path);
        }
        return;
      }
      if (result.notModified) {
        if (typeof cachedContent !== 'string') {
          const freshResult = await service.readProjectFile(path, targetProjectId, {signal: controller.signal});
          if (requestSeq !== fileReadSeqRef.current || projectIdRef.current !== targetProjectId) return;
          setFileContent(freshResult.content);
          if (!fileCacheDisabled) {
            fileCacheRef.current[cacheKey] = freshResult.content;
          }
          const freshHash = freshResult.hash || knownHash;
          if (!fileCacheDisabled && freshHash) {
            fileHashRef.current[cacheKey] = freshHash;
          }
          if (!fileCacheDisabled) {
            workspaceStore.cacheFile(targetProjectId, path, freshHash, freshResult.content);
          }
          if (shouldRestoreScroll) {
            scheduleRestoreSelectedFileScroll(path);
          }
          return;
        }
        setFileContent(cachedContent);
        const nextHash = result.hash || knownHash;
        if (!fileCacheDisabled && nextHash) {
          fileHashRef.current[cacheKey] = nextHash;
          workspaceStore.cacheFile(targetProjectId, path, nextHash, cachedContent);
        }
        if (shouldRestoreScroll) {
          scheduleRestoreSelectedFileScroll(path);
        }
        return;
      }
      setFileContent(result.content);
      if (!fileCacheDisabled) {
        fileCacheRef.current[cacheKey] = result.content;
      }
      const nextHash = result.hash || knownHash;
      if (!fileCacheDisabled && nextHash) {
        fileHashRef.current[cacheKey] = nextHash;
      }
      if (!fileCacheDisabled) {
        workspaceStore.cacheFile(targetProjectId, path, nextHash, result.content);
      }
      if (shouldRestoreScroll) {
        scheduleRestoreSelectedFileScroll(path);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      if (requestSeq !== fileReadSeqRef.current || projectIdRef.current !== targetProjectId) return;
      if (!silentRead) {
        setFileInfo(null);
        setFileContent('');
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fileReadAbortControllerRef.current === controller) {
        fileReadAbortControllerRef.current = null;
      }
      if (
        requestSeq === fileReadSeqRef.current &&
        projectIdRef.current === targetProjectId &&
        !silentRead
      ) {
        setFileLoading(false);
      }
    }
  };

  const readChatFilePeek = useCallback(async (path: string, targetLine: number | null, targetProjectId: string) => {
    if (!path || !targetProjectId) return;
    setChatPreviewManualOpen(false);
    setChatPreviewManualCollapsed(false);
    const requestSeq = chatFilePeekReadSeqRef.current + 1;
    chatFilePeekReadSeqRef.current = requestSeq;
    const tabId = previewTabId({type: 'file', path});
    const loadKey = fileMemoryCacheKey(targetProjectId, tabId);
    previewFileLoadControllersRef.current.get(loadKey)?.abort();
    const controller = new AbortController();
    previewFileLoadControllersRef.current.set(loadKey, controller);
    setPreviewWorkbench(current =>
      beginPreviewTabLoad(
        openPreviewTab(current, {
          type: 'file',
          projectId: targetProjectId,
          path,
          targetLine,
          title: path.split('/').pop() || path,
        }),
        targetProjectId,
        tabId,
        requestSeq,
      ),
      );
    try {
      const info = await service.getProjectFileInfo(targetProjectId, path, {signal: controller.signal});
      if ((info.size ?? 0) > LARGE_FILE_CONFIRM_BYTES) {
        const sizeMB = ((info.size ?? 0) / (1024 * 1024)).toFixed(1);
        const confirmed = window.confirm(
          `This file is ${sizeMB} MB. Load full content now?`,
        );
        if (!confirmed) {
          setPreviewWorkbench(current =>
            failPreviewTabLoad(
              current,
              targetProjectId,
              tabId,
              requestSeq,
              'File load cancelled.',
            ),
          );
          return;
        }
      }
      const result = await service.readProjectFile(path, targetProjectId, {signal: controller.signal});
      setPreviewWorkbench(current =>
        updatePreviewTabAfterLoad(
          current,
          targetProjectId,
          tabId,
          requestSeq,
          tab =>
            tab.type === 'file'
              ? {...tab, info, content: result.content, loading: false, error: ''}
              : tab,
        ),
      );
    } catch (err) {
      if (isAbortError(err)) return;
      const reason = err instanceof Error ? err.message : String(err);
      setPreviewWorkbench(current =>
        failPreviewTabLoad(
          updatePreviewTabAfterLoad(
            current,
            targetProjectId,
            tabId,
            requestSeq,
            tab =>
              tab.type === 'file'
                ? {...tab, content: '', info: null}
                : tab,
          ),
          targetProjectId,
          tabId,
          requestSeq,
          `Failed to load file: ${reason}`,
        ),
      );
    } finally {
      if (previewFileLoadControllersRef.current.get(loadKey) === controller) {
        previewFileLoadControllersRef.current.delete(loadKey);
      }
    }
  }, []);

  const loadRestoredPreviewTab = useCallback(async (tab: PreviewWorkbenchTab) => {
    if (!connectedRef.current) {
      return;
    }
    if (tab.type === 'file') {
      if (tab.loading || tab.content || tab.requestId > 0) {
        return;
      }
      const requestSeq = chatFilePeekReadSeqRef.current + 1;
      chatFilePeekReadSeqRef.current = requestSeq;
      const loadKey = fileMemoryCacheKey(tab.projectId, tab.id);
      previewFileLoadControllersRef.current.get(loadKey)?.abort();
      const controller = new AbortController();
      previewFileLoadControllersRef.current.set(loadKey, controller);
      setPreviewWorkbench(current => beginPreviewTabLoad(current, tab.projectId, tab.id, requestSeq));
      try {
        const info = await service.getProjectFileInfo(tab.projectId, tab.path, {signal: controller.signal});
        const result = await service.readProjectFile(tab.path, tab.projectId, {signal: controller.signal});
        setPreviewWorkbench(current =>
          updatePreviewTabAfterLoad(current, tab.projectId, tab.id, requestSeq, currentTab =>
            currentTab.type === 'file'
              ? {...currentTab, info, content: result.content, loading: false, error: ''}
              : currentTab,
          ),
        );
      } catch (err) {
        if (isAbortError(err)) return;
        const reason = err instanceof Error ? err.message : String(err);
        setPreviewWorkbench(current =>
          failPreviewTabLoad(current, tab.projectId, tab.id, requestSeq, `Failed to load file: ${reason}`),
        );
      } finally {
        if (previewFileLoadControllersRef.current.get(loadKey) === controller) {
          previewFileLoadControllersRef.current.delete(loadKey);
        }
      }
      return;
    }
    if (tab.type === 'prompt-diff') {
      if (tab.loading || tab.requestId > 0 || tab.files.some(file => file.diff)) {
        return;
      }
      const requestSeq = chatPromptArtifactReadSeqRef.current + 1;
      chatPromptArtifactReadSeqRef.current = requestSeq;
      setPreviewWorkbench(current => beginPreviewTabLoad(current, tab.projectId, tab.id, requestSeq));
      try {
        const result = await service.readSessionArtifact(tab.projectId, tab.sessionId, tab.artifactId);
        const expandedByPath = new Map(
          tab.files.map(file => [normalizePromptArtifactPath(file.path), file.expanded]),
        );
        const files = buildPromptArtifactPreviewFiles({
          artifactId: tab.artifactId,
          type: 'diff',
          format: 'unified-diff',
          fileCount: tab.files.length,
          files: tab.files.map(file => ({
            path: file.path,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
          })),
        }, result.content, null).map(file => ({
          ...file,
          expanded: expandedByPath.get(normalizePromptArtifactPath(file.path)) ?? file.expanded,
        }));
        setPreviewWorkbench(current =>
          updatePreviewTabAfterLoad(current, tab.projectId, tab.id, requestSeq, currentTab =>
            currentTab.type === 'prompt-diff'
              ? {
                  ...currentTab,
                  title: promptArtifactPreviewTitle(files.length),
                  files,
                  loading: false,
                  error: '',
                }
              : currentTab,
          ),
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        setPreviewWorkbench(current =>
          failPreviewTabLoad(current, tab.projectId, tab.id, requestSeq, reason),
        );
      }
      return;
    }
    if (tab.type === 'attachment') {
      if (tab.loading || tab.src || tab.content !== undefined || tab.requestId > 0) {
        return;
      }
      const requestSeq = chatAttachmentReadSeqRef.current + 1;
      chatAttachmentReadSeqRef.current = requestSeq;
      const payload = attachmentPreviewReadPayloadFromKey(tab);
      if (!payload) {
        setPreviewWorkbench(current =>
          failPreviewTabLoad(
            beginPreviewTabLoad(current, tab.projectId, tab.id, requestSeq),
            tab.projectId,
            tab.id,
            requestSeq,
            'Attachment preview cannot be restored from this source.',
          ),
        );
        return;
      }
      setPreviewWorkbench(current => beginPreviewTabLoad(current, tab.projectId, tab.id, requestSeq));
      try {
        const result = await service.readProjectSessionAttachment(tab.projectId, payload);
        // Check file size limit for text preview
        if (result.size && result.size > ATTACHMENT_PREVIEW_MAX_SIZE) {
          setPreviewWorkbench(current =>
            failPreviewTabLoad(current, tab.projectId, tab.id, requestSeq, 'File too large to preview (max 20MB).'),
          );
          return;
        }
        setPreviewWorkbench(current =>
          updatePreviewTabAfterLoad(current, tab.projectId, tab.id, requestSeq, currentTab =>
            currentTab.type === 'attachment'
              ? {
                  ...currentTab,
                  mimeType: result.mimeType || currentTab.mimeType,
                  src: result.isBinary ? attachmentBase64DataUrl(result.content, result.mimeType || currentTab.mimeType || 'image/png') : '',
                  content: result.isBinary ? undefined : result.content,
                  isBinary: result.isBinary,
                  loading: false,
                  error: '',
                }
              : currentTab,
          ),
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        setPreviewWorkbench(current =>
          failPreviewTabLoad(current, tab.projectId, tab.id, requestSeq, `Failed to load attachment: ${reason}`),
        );
      }
    }
  }, []);

  useEffect(() => {
    if (!connected) {
      return;
    }
    const restoredActiveTab = activePreviewTab(previewWorkbench);
    if (!restoredActiveTab) {
      return;
    }
    loadRestoredPreviewTab(restoredActiveTab).catch(() => undefined);
  }, [connected, loadRestoredPreviewTab, previewWorkbench]);

  const resolvePromptAttachmentThumbnail = useCallback((
    block: RegistrySessionContentBlock,
    message: RegistryChatMessage,
  ): string => {
    if (!isPromptImageAttachmentContentBlock(block)) {
      return '';
    }
    if (block.type === 'image' && block.data) {
      return attachmentBase64DataUrl(block.data, block.mimeType || 'image/png');
    }
    const selectedKey = selectedChatKeyRef.current;
    const targetProjectId = selectedKey?.projectId || projectIdRef.current;
    const sessionId = message.sessionId || selectedKey?.sessionId || '';
    if (!targetProjectId || !sessionId) {
      return '';
    }
    const cacheKey = chatAttachmentBlockCacheKey(targetProjectId, sessionId, block);
    return chatAttachmentThumbnails[cacheKey]?.src || '';
  }, [chatAttachmentThumbnails]);

  const loadPromptAttachmentThumbnail = useCallback((
    block: RegistrySessionContentBlock,
    message: RegistryChatMessage,
  ) => {
    if (!isPromptImageAttachmentContentBlock(block) || (block.type === 'image' && block.data)) {
      return;
    }
    const selectedKey = selectedChatKeyRef.current;
    const targetProjectId = selectedKey?.projectId || projectIdRef.current;
    const sessionId = message.sessionId || selectedKey?.sessionId || '';
    if (!targetProjectId || !sessionId) {
      return;
    }
    const cacheKey = chatAttachmentBlockCacheKey(targetProjectId, sessionId, block);
    const existing = chatAttachmentThumbnails[cacheKey];
    if (existing?.src || existing?.loading || existing?.error) {
      return;
    }
    setChatAttachmentThumbnails(current => ({
      ...current,
      [cacheKey]: {src: '', loading: true, error: ''},
    }));
    service.readProjectSessionAttachmentThumbnail(targetProjectId, {
      sessionId,
      uri: block.uri,
      attachmentId: attachmentIdFromBlock(block) || undefined,
    }).then(result => {
      const src = attachmentBase64DataUrl(result.content, result.mimeType || 'image/jpeg');
      setChatAttachmentThumbnails(current => ({
        ...current,
        [cacheKey]: {src, loading: false, error: ''},
      }));
    }).catch(err => {
      const reason = err instanceof Error ? err.message : String(err);
      setChatAttachmentThumbnails(current => ({
        ...current,
        [cacheKey]: {src: '', loading: false, error: reason},
      }));
    });
  }, [chatAttachmentThumbnails]);

  const openChatAttachmentPreview = useCallback((block: RegistrySessionContentBlock, message: RegistryChatMessage) => {
    const selectedKey = selectedChatKeyRef.current;
    const targetProjectId = selectedArchivedKey?.projectId || selectedKey?.projectId || projectIdRef.current;
    const sessionId = message.sessionId || selectedKey?.sessionId || '';
    if (!targetProjectId || !sessionId) {
      setError('Attachment preview requires an active chat session.');
      return;
    }
    const imageAttachment = isPromptImageAttachmentContentBlock(block);
    const attachmentKey = chatAttachmentBlockCacheKey(targetProjectId, sessionId, block);
    const tabId = previewTabId({type: 'attachment', sessionId, attachmentKey});
    const title = chatPromptAttachmentLabel(block, 0);
    const meta = chatPromptAttachmentMeta(block);
    const initialSrc = block.type === 'image' && block.data
      ? attachmentBase64DataUrl(block.data, block.mimeType || 'image/png')
      : '';
    const requestSeq = chatAttachmentReadSeqRef.current + 1;
    chatAttachmentReadSeqRef.current = requestSeq;
    setError('');
    setChatPreviewManualOpen(false);
    setChatPreviewManualCollapsed(false);
    setPreviewWorkbench(current => {
      const opened = openPreviewTab(current, {
        type: 'attachment',
        projectId: targetProjectId,
        sessionId,
        attachmentKey,
        title,
        meta,
        mimeType: block.mimeType || '',
        kind: imageAttachment ? 'image' : 'file',
        src: initialSrc,
      });
      return imageAttachment && !initialSrc
        ? beginPreviewTabLoad(opened, targetProjectId, tabId, requestSeq)
        : opened;
    });
    if (!isWide) {
      setDrawerOpen(false);
      setChatQuickSwitchMenuOpen(false);
      if (!chatFilePeekHistoryActiveRef.current) {
        window.history.pushState(createChatFilePeekHistoryState(), '', window.location.href);
        chatFilePeekHistoryActiveRef.current = true;
      }
    }
    if (initialSrc) {
      return;
    }
    service.readProjectSessionAttachment(targetProjectId, {
      sessionId,
      uri: block.uri,
      attachmentId: attachmentIdFromBlock(block) || undefined,
    }).then(result => {
      // Check file size limit for text preview
      if (result.size && result.size > ATTACHMENT_PREVIEW_MAX_SIZE) {
        setPreviewWorkbench(current =>
          failPreviewTabLoad(
            current,
            targetProjectId,
            tabId,
            requestSeq,
            'File too large to preview (max 20MB).',
          ),
        );
        return;
      }
      setPreviewWorkbench(current =>
        updatePreviewTabAfterLoad(current, targetProjectId, tabId, requestSeq, tab =>
          tab.type === 'attachment'
            ? {
                ...tab,
                mimeType: result.mimeType || tab.mimeType,
                src: result.isBinary ? attachmentBase64DataUrl(result.content, result.mimeType || tab.mimeType || 'image/png') : '',
                content: result.isBinary ? undefined : result.content,
                isBinary: result.isBinary,
                loading: false,
                error: '',
              }
            : tab,
        ),
      );
    }).catch(err => {
      const reason = err instanceof Error ? err.message : String(err);
      setPreviewWorkbench(current =>
        failPreviewTabLoad(
          current,
          targetProjectId,
          tabId,
          requestSeq,
          `Failed to load attachment: ${reason}`,
        ),
      );
    });
  }, [isWide, selectedArchivedKey?.projectId, setDrawerOpen]);

  const buildLineRange = (anchor: number, target: number): Set<number> => {
    const start = Math.min(anchor, target);
    const end = Math.max(anchor, target);
    const result = new Set<number>();
    for (let i = start; i <= end; i++) result.add(i);
    return result;
  };

  const handlePeekLineClick = useCallback(
    (line: number, event: MouseEvent) => {
      if (event.shiftKey && chatPeekAnchorRef.current != null) {
        setChatPeekSelectedLines(buildLineRange(chatPeekAnchorRef.current, line));
      } else if (event.ctrlKey || event.metaKey) {
        setChatPeekSelectedLines(prev => {
          const next = new Set(prev);
          if (next.has(line)) next.delete(line);
          else next.add(line);
          return next;
        });
      } else {
        chatPeekAnchorRef.current = line;
        setChatPeekSelectedLines(new Set([line]));
      }
    },
    [],
  );

  const handleFileTabLineClick = useCallback(
    (line: number, event: MouseEvent) => {
      if (event.shiftKey && fileTabAnchorRef.current != null) {
        setFileTabSelectedLines(buildLineRange(fileTabAnchorRef.current, line));
      } else if (event.ctrlKey || event.metaKey) {
        setFileTabSelectedLines(prev => {
          const next = new Set(prev);
          if (next.has(line)) next.delete(line);
          else next.add(line);
          return next;
        });
      } else {
        fileTabAnchorRef.current = line;
        setFileTabSelectedLines(new Set([line]));
      }
    },
    [],
  );

  const resolveChatFilePreviewProjectId = useCallback(
    (explicitProjectId = '') =>
      explicitProjectId ||
      selectedChatKeyRef.current?.projectId ||
      previewWorkbench.activeProjectId ||
      projectIdRef.current,
    [previewWorkbench.activeProjectId],
  );

  const openChatFilePeek = useCallback((path: string, line: number | null, targetProjectId: string) => {
    const normalizedLine =
      typeof line === 'number' && Number.isFinite(line) && line > 0
        ? Math.trunc(line)
        : null;
    if (!targetProjectId) {
      setError('Select a project before opening a file preview.');
      return;
    }
    setError('');
    if (!isWide) {
      setDrawerOpen(false);
      setChatQuickSwitchMenuOpen(false);
      if (!chatFilePeekHistoryActiveRef.current) {
        window.history.pushState(createChatFilePeekHistoryState(), '', window.location.href);
        chatFilePeekHistoryActiveRef.current = true;
      }
    }
    readChatFilePeek(path, normalizedLine, targetProjectId).catch(() => undefined);
    chatPeekAnchorRef.current = normalizedLine;
    setChatPeekSelectedLines(normalizedLine != null ? new Set([normalizedLine]) : new Set());
  }, [isWide, readChatFilePeek, setDrawerOpen]);

  const clearPreviewFileTreeSearchTimer = useCallback(() => {
    if (previewFileTreeSearchTimerRef.current !== null) {
      window.clearTimeout(previewFileTreeSearchTimerRef.current);
      previewFileTreeSearchTimerRef.current = null;
    }
  }, []);

  const resetPreviewFileTreeSearchSession = useCallback(() => {
    clearPreviewFileTreeSearchTimer();
    previewFileTreeSearchSessionIdRef.current = `preview-file-tree-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    previewFileTreeSearchQueryIdRef.current = 0;
    previewFileTreeSearchGenerationRef.current += 1;
    setPreviewFileTreeSearchQuery('');
    setPreviewFileTreeSearchResults([]);
    setPreviewFileTreeSearchLoading(false);
    setPreviewFileTreeSearchError('');
    setPreviewFileTreeSearchIndexed(true);
    setPreviewFileTreeSearchActiveIndex(0);
    setPreviewFileTreeSearchCollapsedDirs([]);
  }, [clearPreviewFileTreeSearchTimer]);

  const focusPreviewFileTreeSearch = useCallback(() => {
    window.requestAnimationFrame(() => {
      previewFileTreeSearchInputRef.current?.focus();
      previewFileTreeSearchInputRef.current?.select();
    });
  }, []);

  const runPreviewFileTreeSearch = useCallback(
    async (targetProjectId: string, query: string, generation: number) => {
      if (!targetProjectId) {
        setPreviewFileTreeSearchError('Select a project first.');
        setPreviewFileTreeSearchLoading(false);
        return;
      }
      const queryId = previewFileTreeSearchQueryIdRef.current + 1;
      previewFileTreeSearchQueryIdRef.current = queryId;
      setPreviewFileTreeSearchLoading(true);
      setPreviewFileTreeSearchError('');
      try {
        const response = await service.searchFileIndex(targetProjectId, {
          query,
          querySessionId: previewFileTreeSearchSessionIdRef.current,
          queryId,
          limit: CHAT_FILE_MENTION_SEARCH_LIMIT,
        });
        if (generation !== previewFileTreeSearchGenerationRef.current) {
          return;
        }
        setPreviewFileTreeSearchIndexed(response.indexed);
        setPreviewFileTreeSearchResults(response.results ?? []);
        setPreviewFileTreeSearchActiveIndex(0);
        setPreviewFileTreeSearchError(response.error || '');
      } catch (err) {
        if (generation !== previewFileTreeSearchGenerationRef.current) {
          return;
        }
        setPreviewFileTreeSearchResults([]);
        setPreviewFileTreeSearchIndexed(true);
        setPreviewFileTreeSearchError(err instanceof Error ? err.message : String(err));
      } finally {
        if (generation === previewFileTreeSearchGenerationRef.current) {
          setPreviewFileTreeSearchLoading(false);
        }
      }
    },
    [],
  );

  const schedulePreviewFileTreeSearch = useCallback(
    (targetProjectId: string, query: string) => {
      clearPreviewFileTreeSearchTimer();
      setPreviewFileTreeSearchQuery(query);
      if (!query) {
        previewFileTreeSearchGenerationRef.current += 1;
        setPreviewFileTreeSearchResults([]);
        setPreviewFileTreeSearchLoading(false);
        setPreviewFileTreeSearchError('');
        setPreviewFileTreeSearchIndexed(true);
        setPreviewFileTreeSearchActiveIndex(0);
        setPreviewFileTreeSearchCollapsedDirs([]);
        return;
      }
      if (!targetProjectId) {
        setPreviewFileTreeSearchResults([]);
        setPreviewFileTreeSearchLoading(false);
        setPreviewFileTreeSearchError('Select a project first.');
        setPreviewFileTreeSearchIndexed(true);
        setPreviewFileTreeSearchActiveIndex(0);
        setPreviewFileTreeSearchCollapsedDirs([]);
        return;
      }
      setPreviewFileTreeSearchCollapsedDirs([]);
      setPreviewFileTreeSearchLoading(true);
      const generation = previewFileTreeSearchGenerationRef.current + 1;
      previewFileTreeSearchGenerationRef.current = generation;
      previewFileTreeSearchTimerRef.current = window.setTimeout(() => {
        previewFileTreeSearchTimerRef.current = null;
        runPreviewFileTreeSearch(targetProjectId, query, generation).catch(() => undefined);
      }, CHAT_FILE_MENTION_DEBOUNCE_MS);
    },
    [clearPreviewFileTreeSearchTimer, runPreviewFileTreeSearch],
  );

  const updatePreviewFileTreeSearchQuery = useCallback(
    (query: string) => {
      schedulePreviewFileTreeSearch(previewWorkbenchRef.current.activeProjectId, query);
    },
    [schedulePreviewFileTreeSearch],
  );

  const openPreviewFileTreeSearchResult = useCallback(
    (result: RegistryFileIndexSearchResult) => {
      const path = result.path;
      const targetProjectId = previewWorkbenchRef.current.activeProjectId;
      if (!path || !targetProjectId) {
        return;
      }
      openChatFilePeek(path, null, targetProjectId);
    },
    [openChatFilePeek],
  );

  const startPreviewFileTreeSearchFromKey = useCallback(
    (key: string) => {
      if (key.length !== 1 && key !== 'Backspace') {
        focusPreviewFileTreeSearch();
        return;
      }
      const nextQuery =
        key === 'Backspace'
          ? previewFileTreeSearchQuery.slice(0, -1)
          : `${previewFileTreeSearchQuery}${key}`;
      updatePreviewFileTreeSearchQuery(nextQuery);
      focusPreviewFileTreeSearch();
    },
    [focusPreviewFileTreeSearch, previewFileTreeSearchQuery, updatePreviewFileTreeSearchQuery],
  );

  const handlePreviewFileTreeSearchInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (previewFileTreeSearchQuery) {
        updatePreviewFileTreeSearchQuery('');
      } else {
        setPreviewWorkbench(current => ({...current, treeOpen: false}));
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPreviewFileTreeSearchActiveIndex(current =>
        previewFileTreeSearchVisibleResults.length === 0 ? 0 : (current + 1) % previewFileTreeSearchVisibleResults.length,
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPreviewFileTreeSearchActiveIndex(current =>
        previewFileTreeSearchVisibleResults.length === 0
          ? 0
          : (current - 1 + previewFileTreeSearchVisibleResults.length) % previewFileTreeSearchVisibleResults.length,
      );
      return;
    }
    if (event.key === 'Enter') {
      const result = previewFileTreeSearchVisibleResults[previewFileTreeSearchActiveIndex];
      if (result) {
        event.preventDefault();
        openPreviewFileTreeSearchResult(result);
      }
    }
  };

  useEffect(() => {
    return () => {
      clearPreviewFileTreeSearchTimer();
    };
  }, [clearPreviewFileTreeSearchTimer]);

  useEffect(() => {
    if (previewWorkbench.treeOpen) {
      focusPreviewFileTreeSearch();
    } else {
      resetPreviewFileTreeSearchSession();
    }
  }, [focusPreviewFileTreeSearch, previewWorkbench.treeOpen, resetPreviewFileTreeSearchSession]);

  const clearQuickFileSearchTimer = useCallback(() => {
    if (quickFileSearchTimerRef.current !== null) {
      window.clearTimeout(quickFileSearchTimerRef.current);
      quickFileSearchTimerRef.current = null;
    }
  }, []);

  const resetQuickFileSearchSession = useCallback(() => {
    clearQuickFileSearchTimer();
    quickFileQuerySessionIdRef.current = `quick-file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    quickFileQueryIdRef.current = 0;
    quickFileSearchGenerationRef.current += 1;
    setQuickFileQuery('');
    setQuickFileResults([]);
    setQuickFileLoading(false);
    setQuickFileError('');
    setQuickFileIndexed(true);
    setQuickFileActiveIndex(0);
  }, [clearQuickFileSearchTimer]);

  const resolveQuickFileProjectId = useCallback(
    () =>
      selectedChatKeyRef.current?.projectId ||
      previewWorkbenchRef.current.activeProjectId ||
      projectIdRef.current,
    [],
  );

  const runQuickFileSearch = useCallback(
    async (targetProjectId: string, query: string, generation: number) => {
      if (!targetProjectId) {
        setQuickFileError('Select a project first.');
        setQuickFileLoading(false);
        return;
      }
      const queryId = quickFileQueryIdRef.current + 1;
      quickFileQueryIdRef.current = queryId;
      setQuickFileLoading(true);
      setQuickFileError('');
      try {
        const response = await service.searchFileIndex(targetProjectId, {
          query,
          querySessionId: quickFileQuerySessionIdRef.current,
          queryId,
          limit: CHAT_FILE_MENTION_SEARCH_LIMIT,
        });
        if (generation !== quickFileSearchGenerationRef.current) {
          return;
        }
        setQuickFileIndexed(response.indexed);
        setQuickFileResults(response.results ?? []);
        setQuickFileActiveIndex(0);
        setQuickFileError(response.error || '');
      } catch (err) {
        if (generation !== quickFileSearchGenerationRef.current) {
          return;
        }
        setQuickFileResults([]);
        setQuickFileIndexed(true);
        setQuickFileError(err instanceof Error ? err.message : String(err));
      } finally {
        if (generation === quickFileSearchGenerationRef.current) {
          setQuickFileLoading(false);
        }
      }
    },
    [],
  );

  const scheduleQuickFileSearch = useCallback(
    (targetProjectId: string, query: string) => {
      clearQuickFileSearchTimer();
      setQuickFileQuery(query);
      setQuickFileLoading(true);
      const generation = quickFileSearchGenerationRef.current + 1;
      quickFileSearchGenerationRef.current = generation;
      quickFileSearchTimerRef.current = window.setTimeout(() => {
        quickFileSearchTimerRef.current = null;
        runQuickFileSearch(targetProjectId, query, generation).catch(() => undefined);
      }, CHAT_FILE_MENTION_DEBOUNCE_MS);
    },
    [clearQuickFileSearchTimer, runQuickFileSearch],
  );

  const openQuickFileSearch = useCallback(() => {
    const targetProjectId = resolveQuickFileProjectId();
    resetQuickFileSearchSession();
    setQuickFileProjectId(targetProjectId);
    setQuickFileOpen(true);
    setChatPromptMenuOpen(false);
    setChatFileMentionMenuOpen(false);
    setChatAttachmentTrayOpen(false);
    if (targetProjectId) {
      scheduleQuickFileSearch(targetProjectId, '');
    } else {
      setQuickFileError('Select a project first.');
    }
    window.requestAnimationFrame(() => {
      quickFileInputRef.current?.focus();
      quickFileInputRef.current?.select();
    });
  }, [resetQuickFileSearchSession, resolveQuickFileProjectId, scheduleQuickFileSearch]);

  const closeQuickFileSearch = useCallback(() => {
    setQuickFileOpen(false);
    resetQuickFileSearchSession();
  }, [resetQuickFileSearchSession]);

  const openQuickFileResult = useCallback(
    (result: RegistryFileIndexSearchResult) => {
      const path = result.path.trim();
      if (!path || !quickFileProjectId) {
        return;
      }
      openChatFilePeek(result.path, null, quickFileProjectId);
      closeQuickFileSearch();
    },
    [closeQuickFileSearch, openChatFilePeek, quickFileProjectId],
  );

  useEffect(() => {
    return () => {
      clearQuickFileSearchTimer();
    };
  }, [clearQuickFileSearchTimer]);

  const openChatFileMentionPreview = useCallback(
    (result: RegistryFileIndexSearchResult) => {
      const path = result.path.trim();
      if (!path) {
        return;
      }
      openChatFilePeek(path, null, resolveChatFilePreviewProjectId());
      window.requestAnimationFrame(() => {
        chatRichComposerRef.current?.focus();
      });
    },
    [openChatFilePeek, resolveChatFilePreviewProjectId],
  );

  const closeChatFilePeekFromChrome = useCallback(() => {
    if (!isWide && chatFilePeekHistoryActiveRef.current) {
      window.history.back();
      return;
    }
    const activeTab = activePreviewTab(previewWorkbenchRef.current);
    if (activeTab?.type === 'prompt-diff') {
      closeChatPromptArtifactPreview();
      setChatPreviewManualOpen(false);
      setChatPreviewManualCollapsed(false);
      return;
    }
    if (activeTab?.type === 'attachment') {
      closeChatAttachmentPreview();
      setChatPreviewManualOpen(false);
      setChatPreviewManualCollapsed(false);
      return;
    }
    if (activeTab?.type === 'port-relay') {
      closeChatPortRelayPreview();
      setChatPreviewManualOpen(false);
      setChatPreviewManualCollapsed(false);
      return;
    }
    closeChatPreview();
  }, [
    closeChatAttachmentPreview,
    closeChatPortRelayPreview,
    closeChatPreview,
    closeChatPromptArtifactPreview,
    isWide,
  ]);

  const openPeekFileInFullFileTab = useCallback(() => {
    if (!chatFilePeek) return;
    const transferLine = chatFilePeek.targetLine;
    const transferPath = chatFilePeek.path;
    closeChatFilePeek();
    chatFilePeekHistoryActiveRef.current = false;
    setTab('file');
    setSelectedFile(transferPath);
    if (transferLine) {
      setPendingFileJump({ path: transferPath, line: transferLine });
    } else {
      setPendingFileJump(null);
    }
  }, [chatFilePeek, closeChatFilePeek, setTab]);

  useEffect(() => {
    const handleChatFilePeekPopState = (event: PopStateEvent) => {
      if (!chatFilePeekHistoryActiveRef.current) return;
      if (isChatFilePeekHistoryState(event.state)) return;
      chatFilePeekHistoryActiveRef.current = false;
      closeChatPreview();
    };
    window.addEventListener('popstate', handleChatFilePeekPopState);
    return () => window.removeEventListener('popstate', handleChatFilePeekPopState);
  }, [closeChatPreview]);

  useEffect(() => {
    if (isWide) {
      chatFilePeekHistoryActiveRef.current = false;
    }
  }, [isWide]);

  useEffect(() => {
    if (!selectedFile) {
      fileReadAbortControllerRef.current?.abort();
      fileReadAbortControllerRef.current = null;
      fileReadSeqRef.current += 1;
      setFileLoading(false);
      setFileInfo(null);
      setFileContent('');
      return;
    }
    if (skipNextSelectedFileAutoReadRef.current) {
      skipNextSelectedFileAutoReadRef.current = false;
      return;
    }
    readSelectedFile(selectedFile).catch(() => undefined);
  }, [projectId, selectedFile]);

  const loadGit = async (preferredRefs?: string[]): Promise<boolean> => {
    const targetProjectId = projectIdRef.current || projectId;
    if (!targetProjectId) return false;
    setGitLoading(true);
    setGitError('');
    failedGitRevLoadKeyRef.current = '';
    try {
      const [branchData, statusData] = await Promise.all([
        service.listGitBranches(),
        service.getGitStatus(),
      ]);
      const currentBranch = branchData.current || '';
      const availableBranches = normalizeGitBranches(
        branchData.branches ?? [],
        currentBranch,
      );
      const selectedBranches = pickGitSelectedBranches(
        preferredRefs ?? gitSelectedBranchesRef.current,
        availableBranches,
        currentBranch,
      );
      const commitData = await service.listGitCommits('HEAD', selectedBranches);

      setGitCurrentBranch(currentBranch);
      setGitBranches(availableBranches);
      setGitSelectedBranches(selectedBranches);
      gitSelectedBranchesRef.current = selectedBranches;
      const working = buildWorkingTreeFiles(statusData);
      setWorkingTreeFiles(working);
      knownWorktreeRevRef.current = statusData.worktreeRev ?? '';
      const loadedProject = currentProjectRef.current;
      if (loadedProject?.projectId === targetProjectId && loadedProject.git?.gitRev) {
        knownGitRevRef.current = loadedProject.git.gitRev;
      }
      setCommits(commitData);
      setGitLoadedProjectId(targetProjectId);
      const firstCommit = commitData[0]?.sha ?? '';
      setSelectedCommit(prev => {
        if (prev && commitData.some(item => item.sha === prev)) {
          return prev;
        }
        return firstCommit;
      });
      setExpandedCommitShas(prev => {
        const expanded = prev.find(sha => commitData.some(item => item.sha === sha));
        if (expanded) return [expanded];
        return firstCommit ? [firstCommit] : [];
      });
      setWorktreeExpanded(working.length > 0);
      setCommitPopover(null);
      if (!selectedDiff) {
        if (working[0]) {
          const preferredPath = pickPreferredPath(working);
          const preferredFile =
            working.find(item => item.path === preferredPath) ?? working[0];
          setSelectedDiff(preferredFile.path);
          setSelectedDiffSource('worktree');
          setSelectedDiffScope(preferredFile.scope);
        } else if (firstCommit) {
          setSelectedDiffSource('commit');
        }
      }
      return true;
    } catch (err) {
      setGitError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setGitLoading(false);
    }
  };

  const toggleGitBranchSelection = (branch: string) => {
    const normalizedBranch = branch.trim();
    if (!normalizedBranch) return;
    const currentSelection = gitSelectedBranchesRef.current;
    const nextSelection = currentSelection.includes(normalizedBranch)
      ? currentSelection.filter(item => item !== normalizedBranch)
      : [...currentSelection, normalizedBranch];
    const fallbackBranch = gitCurrentBranch.trim() || normalizedBranch;
    const effectiveSelection =
      nextSelection.length > 0 ? nextSelection : [fallbackBranch];
    setGitSelectedBranches(effectiveSelection);
    gitSelectedBranchesRef.current = effectiveSelection;
    setGitLoadedProjectId('');
    loadGit(effectiveSelection).catch(err =>
      setGitError(err instanceof Error ? err.message : String(err)),
    );
  };

  const loadGitIfRevChanged = async (): Promise<boolean> => {
    const targetProjectId = projectIdRef.current || projectId;
    if (!connected || !targetProjectId || gitLoading) return false;
    if (gitRevCheckInFlightRef.current) return false;
    gitRevCheckInFlightRef.current = true;
    try {
      const nextRev = await service.getGitRev();
      const revKey = `${targetProjectId}\n${nextRev.gitRev ?? ''}\n${nextRev.worktreeRev ?? ''}`;
      if (gitError && failedGitRevLoadKeyRef.current === revKey) {
        return false;
      }
      const currentRev = {
        gitRev: knownGitRevRef.current,
        worktreeRev: knownWorktreeRevRef.current,
      };
      const shouldLoad = shouldLoadGitForRev({
        projectId: targetProjectId,
        loadedProjectId: gitLoadedProjectId,
        currentRev,
        nextRev,
        hasGitError: !!gitError,
      });
      if (!shouldLoad) {
        knownGitRevRef.current = nextRev.gitRev ?? '';
        knownWorktreeRevRef.current = nextRev.worktreeRev ?? '';
        return false;
      }
      setGitLoadedProjectId('');
      const loaded = await loadGit();
      if (loaded) {
        failedGitRevLoadKeyRef.current = '';
        knownGitRevRef.current = nextRev.gitRev ?? '';
        knownWorktreeRevRef.current = nextRev.worktreeRev ?? '';
      } else {
        failedGitRevLoadKeyRef.current = revKey;
      }
      return loaded;
    } catch (err) {
      setGitError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      gitRevCheckInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!connected || tab !== 'git') return;
    if (!projectId) return;
    if (gitLoading) return;
    loadGitIfRevChanged().catch(() => undefined);
  }, [connected, tab, projectId, gitError, gitLoading, gitLoadedProjectId]);

  useEffect(() => {
    const run = async () => {
      if (!selectedCommit) return;
      if (commitFilesBySha[selectedCommit]) return;
      const files = await service.listGitCommitFiles(selectedCommit);
      setCommitFilesBySha(prev => ({ ...prev, [selectedCommit]: files }));
      if (!selectedDiff && files[0]) {
        setSelectedDiff(pickPreferredPath(files));
        setSelectedDiffSource('commit');
      }
    };
    run().catch(err =>
      setGitError(err instanceof Error ? err.message : String(err)),
    );
  }, [selectedCommit, commitFilesBySha, selectedDiff]);

  useEffect(() => {
    const run = async () => {
      if (!projectId || !selectedDiff) return;
      if (isHeavyGeneratedDiffPath(selectedDiff) && !allowHeavyDiffLoad) {
        setDiffText('');
        return;
      }
      const cacheScope =
        selectedDiffSource === 'worktree'
          ? `WORKTREE:${selectedDiffScope}`
          : selectedCommit;
      if (!cacheScope) return;
      const cachedDiff = workspaceStore.getCachedDiff(
        projectId,
        cacheScope,
        selectedDiff,
      );
      if (cachedDiff !== null) {
        setDiffText(cachedDiff);
        return;
      }
      setDiffLoading(true);
      try {
        const diff =
          selectedDiffSource === 'worktree'
            ? await service.readWorkingTreeFileDiff(
                selectedDiff,
                selectedDiffScope,
              )
            : await service.readGitFileDiff(selectedCommit, selectedDiff);
        setDiffText(diff.diff || '');
        workspaceStore.cacheDiff(
          projectId,
          cacheScope,
          selectedDiff,
          diff.diff || '',
          !!diff.isBinary,
          !!diff.truncated,
        );
      } catch (err) {
        setGitError(err instanceof Error ? err.message : String(err));
      } finally {
        setDiffLoading(false);
      }
    };
    run().catch(() => undefined);
  }, [
    projectId,
    selectedCommit,
    selectedDiff,
    selectedDiffSource,
    selectedDiffScope,
    allowHeavyDiffLoad,
  ]);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const scheduleReconnectAttempt = () => {
    clearReconnectTimer();
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      setAutoConnecting(true);
      connect({ silentReconnect: true }).catch(() => undefined);
    }, RECONNECT_RETRY_DELAY_MS);
  };

  const clearChatRuntimeState = (preferredSelection = '') => {
    setChatMessages([]);
    setChatSessions([]);
    applySelectedChatKey(
      preferredSelection
        ? chatSessionKeyFromParts(projectIdRef.current, preferredSelection)
        : null,
    );
    chatVisibleRuntimeKeyRef.current = '';
    chatSelectedLoadAttemptRuntimeKeyRef.current = '';
    chatFinishedCursorRef.current = {};
    chatMessageStoreRef.current = {};
    chatTurnStoreRef.current = {};
  };

  const hydrateChatSessionContentFromCache = (
    sessionId: string,
    activeProjectId = projectIdRef.current,
  ): RegistryChatMessage[] => {
    if (!activeProjectId || !sessionId) return [];
    const runtimeKey = buildChatRuntimeKey(activeProjectId, sessionId);
    const cached = workspaceStore.getCachedChatSessionContent(activeProjectId, sessionId);
    if (!cached) {
      const turnState = chatTurnStoreRef.current[runtimeKey];
      const storeMessages = messagesFromTurnStore(runtimeKey, sessionId);
      const inMemoryMessages = storeMessages.length > 0
        ? storeMessages
        : (chatMessageStoreRef.current[runtimeKey] ?? []);
      if (storeMessages.length > 0) {
        chatMessageStoreRef.current[runtimeKey] = storeMessages;
      }
      if (inMemoryMessages.length === 0) {
        chatFinishedCursorRef.current[runtimeKey] = 0;
      } else if (turnState && storeMessages.length > 0) {
        chatFinishedCursorRef.current[runtimeKey] = turnState.cursor.turnIndex;
      } else {
        const cursor = getLatestSessionReadCursor(inMemoryMessages);
        chatFinishedCursorRef.current[runtimeKey] = cursor.turnIndex;
      }
      return inMemoryMessages;
    }

    const turnState = ensureChatTurnStore(runtimeKey);
    mergeCachedTurnPrefix(turnState, cached.turns);
    const storeMessages = messagesFromTurnStore(runtimeKey, sessionId);
    const nextMessages = storeMessages.length > 0
      ? storeMessages
      : [...cached.messages];
    chatMessageStoreRef.current[runtimeKey] = nextMessages;

    chatFinishedCursorRef.current[runtimeKey] = turnState.cursor.turnIndex;
    return nextMessages;
  };

  const hydrateChatSessionsFromCache = (
    activeProjectId = projectIdRef.current,
    preferredSelection = '',
  ) => {
    if (!activeProjectId) return;
    const cachedSessions = workspaceStore.hydrateChatSessions(activeProjectId);
    if (cachedSessions.length === 0) {
      return;
    }

    const sessionRows = cachedSessions.map(item => item.session);
    const sortedSessionRows = mergeChatSessionList(
      knownChatSessionsForProject(activeProjectId),
      sortChatSessions(sessionRows),
    );
    if (shouldUpdateCurrentProjectSessions(activeProjectId, projectIdRef.current)) {
      setChatSessions(prev => mergeChatSessionList(prev, sortedSessionRows));
    }
    setProjectSessionsByProjectId(prev => ({
      ...prev,
      [activeProjectId]: mergeChatSessionList(
        prev[activeProjectId] ?? knownChatSessionsForProject(activeProjectId),
        sortedSessionRows,
      ),
    }));

    for (const cached of cachedSessions) {
      const sessionId = cached.session.sessionId;
      if (!sessionId) continue;
      const content = workspaceStore.getCachedChatSessionContent(activeProjectId, sessionId);
      const runtimeKey = buildChatRuntimeKey(activeProjectId, sessionId);
      if (content) {
        mergeCachedTurnPrefix(ensureChatTurnStore(runtimeKey), content.turns);
      }
      const cursor = chatTurnStoreRef.current[runtimeKey]?.cursor ?? cached.cursor;
      chatFinishedCursorRef.current[runtimeKey] = cursor.turnIndex;
    }

    const persistedSelection = workspaceStore.migrateSelectedChatSessionKey(activeProjectId);
    const selectionResolution = resolveChatListSelection({
      activeProjectId,
      allowMissingSelection: true,
      availableSessionIds: sessionRows.map(session => session.sessionId),
      currentKey: selectedChatKeyRef.current,
      legacySelectionId: workspaceStore.getSelectedChatSessionId(activeProjectId),
      persistedKey: persistedSelection,
      preferredSelection,
    });
    if (!selectionResolution.canMutateSelection) {
      return;
    }
    const currentSelection = selectionResolution.sessionId;
    if (!currentSelection) {
      setChatMessages([]);
      return;
    }
    applySelectedChatKey(chatSessionKeyFromParts(activeProjectId, currentSelection));
    const runtimeKey = buildChatRuntimeKey(activeProjectId, currentSelection);
    if (sessionRows.some(item => item.sessionId === currentSelection)) {
      const cachedMessages = hydrateChatSessionContentFromCache(currentSelection, activeProjectId);
      setVisibleChatMessagesForRuntimeKey(runtimeKey, cachedMessages, {resetToLatest: true});
      return;
    }
    const retainedMessages = hydrateChatSessionContentFromCache(currentSelection, activeProjectId);
    if (retainedMessages.length > 0) {
      setVisibleChatMessagesForRuntimeKey(runtimeKey, retainedMessages, {resetToLatest: true});
    }
  };

  const persistChatSessionContent = (
    sessionId: string,
    activeProjectId = projectIdRef.current,
    session?: RegistryChatSession,
  ) => {
    if (!activeProjectId || !sessionId) return;
    const runtimeKey = buildChatRuntimeKey(activeProjectId, sessionId);
    const messages = chatMessageStoreRef.current[runtimeKey] ?? [];
    const turnState = chatTurnStoreRef.current[runtimeKey];
    const cursor = {
      turnIndex: turnState?.cursor.turnIndex ?? chatFinishedCursorRef.current[runtimeKey] ?? 0,
    };
    if (turnState) {
      workspaceStore.rememberChatSessionTurns(activeProjectId, sessionId, turnState.finished);
    } else {
      const cacheableMessages = messages.filter(isFinishedChatMessage);
      workspaceStore.rememberChatSessionContent(activeProjectId, sessionId, cacheableMessages);
    }
    const knownSession =
      projectSessionsByProjectId[activeProjectId]?.find(item => item.sessionId === sessionId) ??
      (shouldUpdateCurrentProjectSessions(activeProjectId, projectIdRef.current)
        ? chatSessions.find(item => item.sessionId === sessionId)
        : undefined);
    const targetSession = session
      ? mergeKnownChatSessionForProject(activeProjectId, session)
      : knownSession;
    if (targetSession) {
      workspaceStore.rememberChatSession(activeProjectId, targetSession, cursor);
    }
  };

  const rememberChatSessionSummary = (
    activeProjectId: string,
    session: Partial<RegistryChatSession> & {sessionId: string},
  ) => {
    if (!activeProjectId || !session.sessionId) return;
    setProjectSessionsByProjectId(prev => mergeProjectSessionMap(prev, activeProjectId, session));
    if (activeProjectId === projectIdRef.current) {
      setChatSessions(prev => mergeChatSession(prev, session));
    }
  };

  const markChatSessionRead = async (
    activeProjectId: string,
    sessionId: string,
    lastReadTurnIndex: number,
  ) => {
    const cursor = Math.max(0, Math.trunc(lastReadTurnIndex));
    if (!activeProjectId || !sessionId || cursor <= 0) return;
    try {
      const result = await service.markProjectSessionRead(activeProjectId, sessionId, cursor);
      if (!result.ok) return;
      const sessionPatch = result.session ?? {sessionId, lastReadTurnIndex: cursor};
      rememberChatSessionSummary(activeProjectId, sessionPatch);
      const runtimeKey = buildChatRuntimeKey(activeProjectId, sessionId);
      if (result.session) {
        workspaceStore.rememberChatSession(
          activeProjectId,
          mergeKnownChatSessionForProject(activeProjectId, result.session),
          { turnIndex: chatFinishedCursorRef.current[runtimeKey] ?? 0 },
        );
      }
    } catch {
      // The next session.list/session.updated response will reconcile read state.
    }
  };

  const resolveSessionVisualState = (session: RegistryChatSession, activeProjectId = projectIdRef.current): ChatSessionVisualState => {
    void activeProjectId;
    return resolveChatSessionVisualStateValue(session);
  };

  const renderSessionStateMarker = (session: RegistryChatSession, activeProjectId = projectIdRef.current) => {
    const state = resolveSessionVisualState(session, activeProjectId);
    const title =
      state === 'running'
        ? 'In progress'
        : state === 'failed-unviewed'
          ? 'Failed, click to view'
          : state === 'completed-unviewed'
            ? 'Completed, click to view'
            : undefined;
    return (
      <span className={`session-state-marker ${state}`} title={title}>
        {state === 'running' ? (
          <span className="codicon codicon-loading codicon-modifier-spin" />
        ) : state === 'completed-unviewed' || state === 'failed-unviewed' ? (
          <span className="session-state-dot" />
        ) : null}
      </span>
    );
  };

  const clearProjectSessionCache = (
    targetProjectId: string,
    sessionId: string,
  ) => {
    const runtimeKey = buildChatRuntimeKey(targetProjectId, sessionId);
    chatFinishedCursorRef.current[runtimeKey] = 0;
    chatMessageStoreRef.current[runtimeKey] = [];
    chatTurnStoreRef.current[runtimeKey] = createEmptyChatTurnStore();
    workspaceStore.rememberChatSessionTurns(targetProjectId, sessionId, []);
    const targetSession =
      projectSessionsByProjectId[targetProjectId]?.find(item => item.sessionId === sessionId) ??
      (targetProjectId === projectIdRef.current
        ? chatSessions.find(item => item.sessionId === sessionId)
        : undefined);
    if (targetSession) {
      workspaceStore.rememberChatSession(targetProjectId, targetSession, {turnIndex: 0});
    }
  };

  const readProjectSessionWithStaleCacheRepair = async (
    activeProjectId: string,
    sessionId: string,
    afterTurnIndex: number,
  ): Promise<{result: Awaited<ReturnType<typeof service.readProjectSession>>; appliedAfterTurnIndex: number}> => {
    const checkpoint = Math.max(0, Math.trunc(afterTurnIndex));
    const result = await service.readProjectSession(activeProjectId, sessionId, checkpoint);
    if (!isStaleSessionReadResult(checkpoint, result.latestTurnIndex)) {
      return {result, appliedAfterTurnIndex: checkpoint};
    }
    clearProjectSessionCache(activeProjectId, sessionId);
    const repairedResult = await service.readProjectSession(activeProjectId, sessionId, 0);
    return {result: repairedResult, appliedAfterTurnIndex: 0};
  };

  const loadChatSession = async (
    sessionId: string,
    activeProjectId = projectIdRef.current,
    options?: {
      incremental?: boolean;
      preserveUserSelection?: boolean;
      selectionSnapshot?: string;
      forceFull?: boolean;
      revealTurnIndex?: number;
    },
  ) => {
    if (!activeProjectId || !sessionId) return false;
    const runtimeKey = buildChatRuntimeKey(activeProjectId, sessionId);
    const finishLoadDiagnostic = startWorkspaceDiagnosticSpan('load_chat_session', {
      projectId: activeProjectId,
      sessionId,
      incremental: options?.incremental ?? true,
      forceFull: options?.forceFull === true,
    });
    let loaded = false;
    let loadError = '';
    setChatLoading(true);
    try {
      const requestedIncremental = options?.forceFull
        ? false
        : (options?.incremental ?? true);
      const revealTurnIndex = Number.isFinite(options?.revealTurnIndex)
        ? Math.max(0, Math.trunc(options?.revealTurnIndex ?? 0))
        : 0;
      // Snapshot existing messages BEFORE the await so the base is
      // consistent with the cursor. Live session.message events may
      // mutate chatMessageStoreRef during the network round-trip.
      const turnState = ensureChatTurnStore(runtimeKey);
      const existingStoreMessages = messagesFromTurnStore(runtimeKey, sessionId);
      const existingMessages = existingStoreMessages.length > 0
        ? existingStoreMessages
        : chatMessageStoreRef.current[runtimeKey] ?? [];
      const checkpointTurnIndex = requestedIncremental
        ? turnState.cursor.turnIndex
        : 0;
      const fallbackToFullRead =
        requestedIncremental &&
        existingMessages.length === 0 &&
        checkpointTurnIndex > 0;
      const useIncremental = requestedIncremental && !fallbackToFullRead;
      const requestedAfterTurnIndex = useIncremental ? checkpointTurnIndex : 0;
      const finishSessionReadDiagnostic = startWorkspaceDiagnosticSpan('session_read', {
        projectId: activeProjectId,
        sessionId,
        requestedAfterTurnIndex: requestedAfterTurnIndex,
        cacheHit: existingMessages.length > 0,
        fallbackToFullRead,
      });
      let readResult: Awaited<ReturnType<typeof readProjectSessionWithStaleCacheRepair>>;
      try {
        readResult = await readProjectSessionWithStaleCacheRepair(
          activeProjectId,
          sessionId,
          requestedAfterTurnIndex,
        );
      } catch (err) {
        const readError = err instanceof Error ? err.message : String(err);
        finishSessionReadDiagnostic({ok: false, error: readError}, 'error');
        throw err;
      }
      const {result, appliedAfterTurnIndex} = readResult;
      finishSessionReadDiagnostic({
        ok: true,
        appliedAfterTurnIndex,
        latestTurnIndex: result.latestTurnIndex,
        turnCount: result.turns.length,
        messageCount: result.messages.length,
        payloadBytes: estimateSessionReadPayloadBytes(result),
      });
      const selectionSnapshot = options?.selectionSnapshot ?? '';
      if (
        options?.preserveUserSelection &&
        !shouldApplyPreservedChatLoad(selectedChatKeyRef.current, selectionSnapshot)
      ) {
        return false;
      }
      const resultSessionId = result.sessionId || result.session?.sessionId || sessionId;
      const resultRuntimeKey = buildChatRuntimeKey(activeProjectId, resultSessionId);
      const resultTurnState = ensureChatTurnStore(resultRuntimeKey);
      applySessionReadResult(
        resultTurnState,
        appliedAfterTurnIndex,
        result.turns,
        result.latestTurnIndex,
      );
      const nextMessages = messagesFromTurnStore(resultRuntimeKey, resultSessionId);
      forgetPendingPromptIfResolved(resultRuntimeKey, nextMessages);

      chatMessageStoreRef.current[resultRuntimeKey] = nextMessages;
      const latestSyncCursor = resultTurnState.cursor;
      chatFinishedCursorRef.current[resultRuntimeKey] = latestSyncCursor.turnIndex;
      const resultSession = result.session;
      if (resultSession) {
        setProjectSessionsByProjectId(prev => mergeProjectSessionMap(prev, activeProjectId, resultSession));
        if (activeProjectId === projectIdRef.current) {
          setChatSessions(prev => mergeChatSession(prev, resultSession));
        }
      }
      const nextSelectedKey = chatSessionKeyFromParts(activeProjectId, resultSessionId);
      const canApplyLoadedSelection = shouldApplyLoadedChatSelection(
        selectedChatKeyRef.current,
        nextSelectedKey,
      );
      if (canApplyLoadedSelection) {
        applySelectedChatKey(nextSelectedKey);
        workspaceStore.rememberSelectedChatSessionKey(nextSelectedKey);
        setVisibleChatMessagesForRuntimeKey(
          resultRuntimeKey,
          nextMessages,
          resolveChatSessionReadWindowUpdate({
            useIncremental: appliedAfterTurnIndex > 0,
            followsLatest: chatAutoScrollFollowRef.current,
            revealTurnIndex,
          }),
        );
      }
      persistChatSessionContent(resultSessionId, activeProjectId, result.session);
      const knownSession =
        resultSession ??
        projectSessionsByProjectId[activeProjectId]?.find(item => item.sessionId === resultSessionId) ??
        (shouldUpdateCurrentProjectSessions(activeProjectId, projectIdRef.current)
          ? chatSessions.find(item => item.sessionId === resultSessionId)
          : undefined);
      if (
        canApplyLoadedSelection &&
        (knownSession?.lastDoneTurnIndex ?? 0) > (knownSession?.lastReadTurnIndex ?? 0)
      ) {
        markChatSessionRead(
          activeProjectId,
          resultSessionId,
          knownSession?.lastDoneTurnIndex ?? 0,
        ).catch(() => undefined);
      }
      loaded = canApplyLoadedSelection;
      return canApplyLoadedSelection;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
      setError(loadError);
      return false;
    } finally {
      finishLoadDiagnostic({
        ok: loaded,
        ...(loadError ? {error: loadError} : {}),
      }, loadError ? 'error' : 'info');
      setChatLoading(false);
    }
  };

  const refreshSessionTurns = async (
    sessionId: string,
    activeProjectId = projectIdRef.current,
    selectionSnapshot = '',
  ) => {
    if (!activeProjectId || !sessionId) return false;
    const runtimeKey = buildChatRuntimeKey(activeProjectId, sessionId);
    try {
      const turnState = ensureChatTurnStore(runtimeKey);
      const checkpointTurnIndex = turnState.cursor.turnIndex;
      const {result, appliedAfterTurnIndex} = await readProjectSessionWithStaleCacheRepair(
        activeProjectId,
        sessionId,
        checkpointTurnIndex,
      );
      if (!shouldApplyPreservedChatLoad(selectedChatKeyRef.current, selectionSnapshot)) {
        return false;
      }
      const resultSessionId = result.sessionId || result.session?.sessionId || sessionId;
      const resultRuntimeKey = buildChatRuntimeKey(activeProjectId, resultSessionId);
      const resultTurnState = ensureChatTurnStore(resultRuntimeKey);
      applySessionReadResult(
        resultTurnState,
        appliedAfterTurnIndex,
        result.turns,
        result.latestTurnIndex,
      );
      const nextMessages = messagesFromTurnStore(resultRuntimeKey, resultSessionId);
      forgetPendingPromptIfResolved(resultRuntimeKey, nextMessages);

      chatMessageStoreRef.current[resultRuntimeKey] = nextMessages;
      const latestSyncCursor = resultTurnState.cursor;
      chatFinishedCursorRef.current[resultRuntimeKey] = latestSyncCursor.turnIndex;
      const resultSession = result.session;
      if (resultSession) {
        setProjectSessionsByProjectId(prev => mergeProjectSessionMap(prev, activeProjectId, resultSession));
        if (activeProjectId === projectIdRef.current) {
          setChatSessions(prev => mergeChatSession(prev, resultSession));
        }
      }
      if (encodeChatSessionKey(selectedChatKeyRef.current) === resultRuntimeKey) {
        setVisibleChatMessagesForRuntimeKey(resultRuntimeKey, nextMessages);
      }
      persistChatSessionContent(resultSessionId, activeProjectId, result.session);
      if (
        encodeChatSessionKey(selectedChatKeyRef.current) === resultRuntimeKey &&
        resultSession &&
        (resultSession.lastDoneTurnIndex ?? 0) > (resultSession.lastReadTurnIndex ?? 0)
      ) {
        markChatSessionRead(
          activeProjectId,
          resultSessionId,
          resultSession.lastDoneTurnIndex ?? 0,
        ).catch(() => undefined);
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const syncChatSessionsAfterReconnect = async (
    preferredSelectedChatKey: ChatSessionKey | null | undefined,
  ) => {
    const selectedRuntimeKey =
      encodeChatSessionKey(preferredSelectedChatKey) ||
      encodeChatSessionKey(selectedChatKeyRef.current);
    const runtimeKeys = new Set(runtimeKeysFromChatStores());
    if (selectedRuntimeKey) {
      runtimeKeys.add(selectedRuntimeKey);
    }

    await Promise.all(Array.from(runtimeKeys).map(runtimeKey => {
      const key = decodeChatSessionKey(runtimeKey);
      if (!key) {
        return Promise.resolve();
      }
      if (isDraftChatSessionId(key.sessionId)) {
        return Promise.resolve();
      }
      const cursor = ensureChatTurnStore(runtimeKey).cursor.turnIndex;
      const selectionSnapshot = runtimeKey === selectedRuntimeKey ? runtimeKey : '';
      return chatReadRepairQueueRef.current.request(runtimeKey, cursor, async () => {
        await refreshSessionTurns(key.sessionId, key.projectId, selectionSnapshot);
      });
    }));
  };

  const loadChatSessions = async (
    activeProjectId = projectIdRef.current,
    preferredSelection = '',
  ) => {
    if (!activeProjectId) return;
    const finishLoadListDiagnostic = startWorkspaceDiagnosticSpan('load_chat_sessions', {
      projectId: activeProjectId,
      preferredSelection,
    });
    let sessionCount = 0;
    let loadListError = '';
    try {
      const listedSessions = sortChatSessions(await service.listProjectSessions(activeProjectId));
      sessionCount = listedSessions.length;
      const knownSessions = knownChatSessionsForProject(activeProjectId);
      const nextSessions = mergeChatSessionList(knownSessions, listedSessions);
      setProjectSessionsByProjectId(prev => ({
        ...prev,
        [activeProjectId]: mergeChatSessionList(
          prev[activeProjectId] ?? knownSessions,
          listedSessions,
        ),
      }));
      if (shouldUpdateCurrentProjectSessions(activeProjectId, projectIdRef.current)) {
        setChatSessions(prev => mergeChatSessionList(prev, listedSessions));
      }

      const cursorBySessionId: Record<string, {turnIndex: number}> = {};
      for (const session of nextSessions) {
        const sessionId = session.sessionId;
        if (!sessionId) continue;
        const runtimeKey = buildChatRuntimeKey(activeProjectId, sessionId);
        cursorBySessionId[sessionId] = {
          turnIndex: chatFinishedCursorRef.current[runtimeKey] ?? 0,
        };
      }
      workspaceStore.replaceChatSessions(activeProjectId, nextSessions, cursorBySessionId);

      const persistedSelection = workspaceStore.migrateSelectedChatSessionKey(activeProjectId);
      const selectionResolution = resolveChatListSelection({
        activeProjectId,
        availableSessionIds: nextSessions.map(session => session.sessionId),
        currentKey: selectedChatKeyRef.current,
        legacySelectionId: workspaceStore.getSelectedChatSessionId(activeProjectId),
        persistedKey: persistedSelection,
        preferredSelection,
      });
      if (!selectionResolution.canMutateSelection) {
        return;
      }
      const currentSelection = selectionResolution.sessionId;
      if (!currentSelection) {
        applySelectedChatKey(null);
        setChatMessages([]);
        return;
      }
      const nextSelectedKey = chatSessionKeyFromParts(activeProjectId, currentSelection);
      applySelectedChatKey(nextSelectedKey);
      workspaceStore.rememberSelectedChatSessionKey(nextSelectedKey);
      const cachedSelection = hydrateChatSessionContentFromCache(currentSelection, activeProjectId);
      const runtimeKey = buildChatRuntimeKey(activeProjectId, currentSelection);
      setVisibleChatMessagesForRuntimeKey(
        runtimeKey,
        cachedSelection.length > 0
          ? cachedSelection
          : (chatMessageStoreRef.current[runtimeKey] ?? []),
        {resetToLatest: true},
      );
      loadChatSession(currentSelection, activeProjectId, {
        incremental: true,
        preserveUserSelection: true,
        selectionSnapshot: runtimeKey,
      }).catch(() => undefined);
    } catch (err) {
      loadListError = err instanceof Error ? err.message : String(err);
      setError(loadListError);
    } finally {
      finishLoadListDiagnostic({
        ok: !loadListError,
        sessionCount,
        ...(loadListError ? {error: loadListError} : {}),
      }, loadListError ? 'error' : 'info');
    }
  };

  useEffect(() => {
    const selectedKey = selectedChatKeyRef.current;
    const runtimeKey = encodeChatSessionKey(selectedKey);
    if (!selectedKey || !runtimeKey) {
      return;
    }
    if (tab !== 'chat' || !connected || chatLoading) {
      return;
    }
    const shouldInspectCache =
      chatVisibleRuntimeKeyRef.current !== runtimeKey ||
      chatMessagesRef.current.length === 0;
    const cachedMessages = shouldInspectCache
      ? hydrateChatSessionContentFromCache(selectedKey.sessionId, selectedKey.projectId)
      : [];
    const selectedVisibilityRecovery = resolveSelectedChatVisibilityRecovery({
      tab,
      connected,
      chatLoading,
      selectedRuntimeKey: runtimeKey,
      selectedIsDraft: isDraftChatSessionId(selectedKey.sessionId),
      visibleRuntimeKey: chatVisibleRuntimeKeyRef.current,
      visibleMessageCount: chatMessagesRef.current.length,
      cachedMessageCount: cachedMessages.length,
      attemptedRuntimeKey: chatSelectedLoadAttemptRuntimeKeyRef.current,
    });

    if (selectedVisibilityRecovery === 'restore-cache') {
      setVisibleChatMessagesForRuntimeKey(runtimeKey, cachedMessages, {resetToLatest: true});
      return;
    }

    if (selectedVisibilityRecovery === 'read-session') {
      chatSelectedLoadAttemptRuntimeKeyRef.current = runtimeKey;
      if (chatVisibleRuntimeKeyRef.current !== runtimeKey) {
        setVisibleChatMessagesForRuntimeKey(runtimeKey, [], {resetToLatest: true});
      }
      loadChatSession(selectedKey.sessionId, selectedKey.projectId, {
        incremental: true,
        preserveUserSelection: true,
        selectionSnapshot: runtimeKey,
      }).then(loaded => {
        if (!loaded && chatSelectedLoadAttemptRuntimeKeyRef.current === runtimeKey) {
          chatSelectedLoadAttemptRuntimeKeyRef.current = '';
        }
      }).catch(() => {
        if (chatSelectedLoadAttemptRuntimeKeyRef.current === runtimeKey) {
          chatSelectedLoadAttemptRuntimeKeyRef.current = '';
        }
      });
    }
  }, [tab, connected, selectedChatEncodedKey, chatMessages.length, chatLoading, setVisibleChatMessagesForRuntimeKey]);
  const resetChatComposer = () => {
    chatAttachmentsRef.current.forEach(revokeChatAttachmentObjectUrl);
    chatComposerTextRef.current = '';
    chatComposerTextCursorRef.current = 0;
    chatComposerTokensRef.current = [];
    chatAttachmentsRef.current = [];
    bumpChatDraftGeneration(currentChatDraftKeyRef.current);
    setChatComposerText('');
    setChatComposerTokens([]);
    setChatAttachments([]);
    setChatPromptMenuOpen(false);
    setChatSlashQuery(null);
    setChatSlashActiveIndex(0);
    setChatFileMentionMenuOpen(false);
    saveChatComposerDraft(currentChatDraftKeyRef.current, '', [], []);
    if (chatFileInputRef.current) {
      chatFileInputRef.current.value = '';
    }
  };

  const resetChatComposerDraft = (draftKey: string) => {
    const normalizedDraftKey = draftKey.trim();
    if (!normalizedDraftKey) {
      return;
    }
    if (normalizedDraftKey === currentChatDraftKeyRef.current) {
      resetChatComposer();
      return;
    }
    const draft = chatComposerDraftsRef.current[normalizedDraftKey];
    draft?.attachments.forEach(revokeChatAttachmentObjectUrl);
    bumpChatDraftGeneration(normalizedDraftKey);
    saveChatComposerDraft(normalizedDraftKey, '', [], []);
  };

  const setChatSubmittingForRuntimeKey = (runtimeKey: string, submitting: boolean) => {
    if (!runtimeKey) return;
    const current = chatSubmittingByKeyRef.current;
    const isSubmitting = current[runtimeKey] === true;
    if (submitting === isSubmitting) return;
    const next = {...current};
    if (submitting) {
      next[runtimeKey] = true;
    } else {
      delete next[runtimeKey];
    }
    chatSubmittingByKeyRef.current = next;
    setChatSubmittingByKey(next);
  };

  const moveChatSubmittingRuntimeKey = (fromRuntimeKey: string, toRuntimeKey: string) => {
    if (!fromRuntimeKey || !toRuntimeKey || fromRuntimeKey === toRuntimeKey) return;
    if (chatSubmittingByKeyRef.current[fromRuntimeKey] !== true) return;
    const next = {...chatSubmittingByKeyRef.current};
    delete next[fromRuntimeKey];
    next[toRuntimeKey] = true;
    chatSubmittingByKeyRef.current = next;
    setChatSubmittingByKey(next);
  };

  const makeQueuedPromptId = () => `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const makeQueuedCompactId = () => `compact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const setQueuedPrompts = useCallback((updater: (current: QueuedChatPromptsByKey) => QueuedChatPromptsByKey) => {
    setChatQueuedPromptsByKey(current => {
      const next = updater(current);
      chatQueuedPromptsByKeyRef.current = next;
      return next;
    });
  }, []);

  const enqueueSelectedChatPrompt = useCallback((runtimeKey: string, prompt: QueuedChatPrompt) => {
    setQueuedPrompts(current => enqueueChatPrompt(current, runtimeKey, prompt));
  }, [setQueuedPrompts]);

  const enqueueSelectedChatCompact = (runtimeKey: string, sessionId: string) => {
    const compact: QueuedChatCompact = {
      kind: 'compact',
      id: makeQueuedCompactId(),
      sessionId,
      createdAt: new Date().toISOString(),
    };
    setQueuedPrompts(current => enqueueChatCompact(current, runtimeKey, compact));
  };

  const setRuntimeCompacting = (runtimeKey: string, compacting: boolean) => {
    const next = {...chatCompactingByKeyRef.current};
    if (compacting) {
      next[runtimeKey] = true;
    } else {
      delete next[runtimeKey];
    }
    chatCompactingByKeyRef.current = next;
    setChatCompactingByKey(next);
  };

  const sessionActionCapability = (
    targetProjectId: string,
    sessionId: string,
    action: Exclude<ChatSessionActionKind, 'fast'>,
  ) => knownChatSessionsForProject(targetProjectId)
    .find(session => session.sessionId === sessionId)
    ?.sessionActions?.[action];

  const runtimeSessionHasActiveExecution = (targetProjectId: string, sessionId: string, runtimeKey: string) =>
    chatCompactingByKeyRef.current[runtimeKey] === true ||
    knownChatSessionsForProject(targetProjectId).some(session =>
      session.sessionId === sessionId && session.running === true,
    );

  const runtimeSessionIsBusy = (targetProjectId: string, sessionId: string, runtimeKey: string) =>
    chatSubmittingByKeyRef.current[runtimeKey] === true ||
    runtimeSessionHasActiveExecution(targetProjectId, sessionId, runtimeKey);

  const isSessionBusyError = (errorValue: unknown) => {
    const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
    const normalized = message.toLowerCase();
    return normalized.includes('busy') || normalized.includes('running');
  };

  const requestSessionCompaction = async (
    targetProjectId: string,
    sessionId: string,
    runtimeKey: string,
  ) => {
    try {
      const result = await service.compactProjectSession(targetProjectId, sessionId);
      if (!result.ok || !result.accepted || !result.operationId) {
        throw new Error('session.compact returned accepted=false');
      }
      if (!terminalCompactionOperationIdsRef.current.delete(result.operationId)) {
        setRuntimeCompacting(runtimeKey, true);
      }
    } catch (errorValue) {
      if (!isSessionBusyError(errorValue)) {
        const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
        setToastMessage(`Context compaction failed: ${message}`);
      }
      throw errorValue;
    }
  };

  const refreshSessionStatusDialog = async (targetProjectId: string, sessionId: string) => {
    setSessionStatusDialog(current => current?.projectId === targetProjectId && current.sessionId === sessionId
      ? {...current, loading: true, error: ''}
      : current);
    try {
      const status = await service.statusProjectSession(targetProjectId, sessionId);
      setSessionStatusDialog(current => current?.projectId === targetProjectId && current.sessionId === sessionId
        ? {...current, status, loading: false, error: ''}
        : current);
    } catch (errorValue) {
      const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
      setSessionStatusDialog(current => current?.projectId === targetProjectId && current.sessionId === sessionId
        ? {...current, loading: false, error: message}
        : current);
    }
  };

  async function invokeChatSessionAction(action: ChatSessionActionKind): Promise<void> {
    const selectedKey = selectedChatKeyRef.current;
    if (!selectedKey || !selectedKey.sessionId || isDraftChatSessionId(selectedKey.sessionId)) {
      setError('Select a created chat session first.');
      return;
    }
    if (action === 'fast') {
      const option = knownChatSessionsForProject(selectedKey.projectId)
        .find(session => session.sessionId === selectedKey.sessionId)
        ?.configOptions?.find(configOption => configOption.id === 'fast_mode');
      if (!option) {
        setError('Current Agent does not support Fast mode.');
        return;
      }
      await handleChatConfigOptionChange(option, option.currentValue === 'on' ? 'off' : 'on');
      return;
    }
    const capability = sessionActionCapability(selectedKey.projectId, selectedKey.sessionId, action);
    if (!capability?.supported) {
      setError(capability?.reason || 'Current Agent does not support this action.');
      return;
    }
    const runtimeKey = buildChatRuntimeKey(selectedKey.projectId, selectedKey.sessionId);
    if (action === 'status') {
      const session = knownChatSessionsForProject(selectedKey.projectId)
        .find(item => item.sessionId === selectedKey.sessionId);
      setSessionStatusDialog({
        projectId: selectedKey.projectId,
        sessionId: selectedKey.sessionId,
        cachedUsage: session?.usage,
        status: null,
        loading: true,
        error: '',
      });
      await refreshSessionStatusDialog(selectedKey.projectId, selectedKey.sessionId);
      return;
    }
    if (
      runtimeSessionIsBusy(selectedKey.projectId, selectedKey.sessionId, runtimeKey) ||
      (chatQueuedPromptsByKeyRef.current[runtimeKey] ?? []).length > 0
    ) {
      enqueueSelectedChatCompact(runtimeKey, selectedKey.sessionId);
      setToastMessage('Context compaction queued.');
      return;
    }
    setChatSubmittingForRuntimeKey(runtimeKey, true);
    try {
      await requestSessionCompaction(selectedKey.projectId, selectedKey.sessionId, runtimeKey);
    } catch (errorValue) {
      if (isSessionBusyError(errorValue)) {
        enqueueSelectedChatCompact(runtimeKey, selectedKey.sessionId);
        setToastMessage('Context compaction queued.');
        return;
      }
      throw errorValue;
    } finally {
      setChatSubmittingForRuntimeKey(runtimeKey, false);
    }
  }

  const cancelQueuedPrompt = useCallback((runtimeKey: string, promptId: string) => {
    setQueuedPrompts(current => cancelQueuedChatPrompt(current, runtimeKey, promptId));
  }, [setQueuedPrompts]);

  const prioritizeQueuedPrompt = useCallback((runtimeKey: string, promptId: string) => {
    setQueuedPrompts(current => moveQueuedChatPromptToFront(current, runtimeKey, promptId));
  }, [setQueuedPrompts]);

  const clearPendingChatPromptTimer = (runtimeKey: string) => {
    const timerId = chatPendingPromptTimersRef.current[runtimeKey];
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      const nextTimers = {...chatPendingPromptTimersRef.current};
      delete nextTimers[runtimeKey];
      chatPendingPromptTimersRef.current = nextTimers;
    }
  };

  const markPendingChatPromptUndelivered = (runtimeKey: string, errorMessage = 'Server did not confirm receipt.') => {
    const pending = chatPendingPromptsByKeyRef.current[runtimeKey];
    if (!pending || pending.status === 'undelivered') {
      setChatSubmittingForRuntimeKey(runtimeKey, false);
      return;
    }
    clearPendingChatPromptTimer(runtimeKey);
    const next = {
      ...chatPendingPromptsByKeyRef.current,
      [runtimeKey]: {
        ...pending,
        status: 'undelivered' as const,
        errorMessage,
      },
    };
    chatPendingPromptsByKeyRef.current = next;
    setChatPendingPromptsByKey(next);
    setChatSubmittingForRuntimeKey(runtimeKey, false);
  };

  const rememberPendingChatPrompt = (runtimeKey: string, prompt: PendingChatPrompt) => {
    if (!runtimeKey) return;
    clearPendingChatPromptTimer(runtimeKey);
    const next = {
      ...chatPendingPromptsByKeyRef.current,
      [runtimeKey]: prompt,
    };
    chatPendingPromptsByKeyRef.current = next;
    setChatPendingPromptsByKey(next);
    if (prompt.status === 'confirming') {
      const timerId = window.setTimeout(() => {
        markPendingChatPromptUndelivered(runtimeKey);
      }, CHAT_PENDING_CONFIRM_TIMEOUT_MS);
      chatPendingPromptTimersRef.current = {
        ...chatPendingPromptTimersRef.current,
        [runtimeKey]: timerId,
      };
    }
  };

  const forgetPendingChatPrompt = (runtimeKey: string) => {
    if (!runtimeKey || !chatPendingPromptsByKeyRef.current[runtimeKey]) return;
    clearPendingChatPromptTimer(runtimeKey);
    const next = {
      ...chatPendingPromptsByKeyRef.current,
    };
    delete next[runtimeKey];
    chatPendingPromptsByKeyRef.current = next;
    setChatPendingPromptsByKey(next);
    setChatSubmittingForRuntimeKey(runtimeKey, false);
  };

  const movePendingChatPrompt = (
    fromRuntimeKey: string,
    toRuntimeKey: string,
    sessionId: string,
  ) => {
    if (!fromRuntimeKey || !toRuntimeKey || fromRuntimeKey === toRuntimeKey) return;
    const prompt = chatPendingPromptsByKeyRef.current[fromRuntimeKey];
    if (!prompt) return;
    clearPendingChatPromptTimer(fromRuntimeKey);
    const next = {
      ...chatPendingPromptsByKeyRef.current,
      [toRuntimeKey]: {
        ...prompt,
        sessionId,
      },
    };
    delete next[fromRuntimeKey];
    chatPendingPromptsByKeyRef.current = next;
    setChatPendingPromptsByKey(next);
    moveChatSubmittingRuntimeKey(fromRuntimeKey, toRuntimeKey);
    if (prompt.status === 'confirming') {
      const timerId = window.setTimeout(() => {
        markPendingChatPromptUndelivered(toRuntimeKey);
      }, CHAT_PENDING_CONFIRM_TIMEOUT_MS);
      chatPendingPromptTimersRef.current = {
        ...chatPendingPromptTimersRef.current,
        [toRuntimeKey]: timerId,
      };
    }
  };

  const forgetPendingPromptIfResolved = (
    runtimeKey: string,
    messages: RegistryChatMessage[],
  ) => {
    const pendingPrompt = chatPendingPromptsByKeyRef.current[runtimeKey];
    if (!pendingPrompt) return;
    const resolved = messages.some(message =>
      message.sessionId === pendingPrompt.sessionId &&
      isPromptStartMessage(message) &&
      (message.turnIndex ?? 0) >= pendingPrompt.turnIndex,
    );
    if (resolved) {
      forgetPendingChatPrompt(runtimeKey);
    }
  };

  const resetProjectResumeState = () => {
    setResumeSessions([]);
    setResumeLoading(false);
  };

  const openWideProjectActionMenu = (
    targetProjectId: string,
    kind: 'new' | 'resume',
    anchor: HTMLElement | null,
  ) => {
    resetProjectResumeState();
    setMobileProjectActionMenu(null);
    setWideProjectActionMenu({
      projectId: targetProjectId,
      kind,
      phase: 'agents',
      agentType: '',
      popover: resolveWideProjectActionPopoverPlacement({
        anchorRect: anchor?.getBoundingClientRect() ?? null,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    });
  };

  const openMobileProjectActionMenu = (
    targetProjectId: string,
    kind: 'new' | 'resume',
  ) => {
    resetProjectResumeState();
    setWideProjectActionMenu(null);
    setMobileProjectActionMenu(current =>
      current?.projectId === targetProjectId && current.kind === kind
        ? null
        : {
            projectId: targetProjectId,
            kind,
            phase: 'agents',
            agentType: '',
            popover: null,
          },
    );
  };

  const removeProjectChatSessionFromState = (
    targetProjectId: string,
    sessionId: string,
  ) => {
    if (!targetProjectId || !sessionId) return;
    setProjectSessionsByProjectId(prev => ({
      ...prev,
      [targetProjectId]: (prev[targetProjectId] ?? []).filter(
        item => item.sessionId !== sessionId,
      ),
    }));
    if (targetProjectId === projectIdRef.current) {
      setChatSessions(prev => prev.filter(item => item.sessionId !== sessionId));
    }
    const runtimeKey = buildChatRuntimeKey(targetProjectId, sessionId);
    if (encodeChatSessionKey(selectedChatKeyRef.current) === runtimeKey) {
        applySelectedChatKey(null);
        setChatMessages([]);
        workspaceStore.rememberSelectedChatSessionKey(null);
    }
      const nextMessageStore = {...chatMessageStoreRef.current};
      const nextFinishedCursor = {...chatFinishedCursorRef.current};
      delete nextMessageStore[runtimeKey];
      delete nextFinishedCursor[runtimeKey];
      chatMessageStoreRef.current = nextMessageStore;
      chatFinishedCursorRef.current = nextFinishedCursor;
    workspaceStore.deleteChatSession(targetProjectId, sessionId);
  };

  const handleArchiveProjectSession = async (targetProjectId: string, sessionId: string) => {
    const normalizedSessionId = sessionId.trim();
    if (!targetProjectId || !normalizedSessionId || chatArchivingSessionId) {
      return;
    }
    setConfirmError('');
    setChatArchivingSessionId(normalizedSessionId);
    try {
      const result = await service.archiveProjectSession(targetProjectId, normalizedSessionId);
      if (!result.ok) {
        throw new Error('session.archive returned ok=false');
      }
      removeProjectChatSessionFromState(
        targetProjectId,
        result.sessionId || normalizedSessionId,
      );
      setProjectSessionActionMenu(null);
      setConfirmTarget(null);
      setConfirmError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmError(message);
      setError(message);
    } finally {
      setChatArchivingSessionId('');
    }
  };

  const requestArchiveOlderSessions = (days: number) => {
    setSessionArchiveMenuOpen(false);
    setArchiveBatchSummary('');
    const candidates = collectArchiveCandidates({
      projects: sortedProjectItems,
      sessionsByProjectId: projectSessionsByProjectIdRef.current,
      nowMs: Date.now(),
      olderThanDays: days,
    });
    if (candidates.length === 0) {
      setArchiveBatchProgress(null);
      setArchiveBatchSummary(`No sessions older than ${days} days`);
      return;
    }
    setConfirmError('');
    setConfirmTarget({kind: 'archiveBatch', days, candidates});
  };

  const clearArchiveBatchStatus = () => {
    setArchiveBatchProgress(null);
    setArchiveBatchSummary('');
  };

  const handleArchiveBatch = async (days: number, candidates: ArchiveCandidate[]) => {
    if (archiveBatchProgress && archiveBatchProgress.completed < archiveBatchProgress.total) {
      return;
    }
    setConfirmError('');
    setConfirmTarget(null);
    setArchiveBatchSummary('');
    let progress: ArchiveBatchProgress = {
      total: candidates.length,
      completed: 0,
      archived: 0,
      failed: 0,
      failures: [],
    };
    setArchiveBatchProgress(progress);
    for (const candidate of candidates) {
      const currentLabel = resolveSessionDisplayTitle(candidate.session) || candidate.session.sessionId;
      setArchiveBatchProgress(current => current ? {...current, currentLabel} : current);
      try {
        const result = await service.archiveProjectSession(
          candidate.project.projectId,
          candidate.session.sessionId,
        );
        if (!result.ok) {
          throw new Error('session.archive returned ok=false');
        }
        removeProjectChatSessionFromState(
          candidate.project.projectId,
          result.sessionId || candidate.session.sessionId,
        );
        progress = nextArchiveBatchProgress(progress, {candidate, ok: true});
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        progress = nextArchiveBatchProgress(progress, {
          candidate,
          ok: false,
          error: message,
        });
      }
      setArchiveBatchProgress(progress);
    }
    setArchiveBatchSummary(`Archived ${progress.archived}, failed ${progress.failed}`);
    if (progress.failed > 0) {
      setError(`Archive > ${days} days finished with ${progress.failed} failure${progress.failed === 1 ? '' : 's'}`);
    }
  };

  const exitArchivedMode = () => {
    setArchivedMode(false);
    setArchivedByProjectId({});
    setSelectedArchivedKey(null);
    setArchivedPreview(null);
    setArchivedError('');
    setArchivedLoading(false);
  };

  const enterArchivedMode = async () => {
    setSessionArchiveMenuOpen(false);
    setArchivedMode(true);
    setArchivedLoading(true);
    setArchivedError('');
    setArchivedByProjectId({});
    setSelectedArchivedKey(null);
    setArchivedPreview(null);
    if (sessionSearchOpen || sessionSearchActive) {
      await exitSessionSearch();
    }
    for (const projectItem of sortedProjectItems) {
      try {
        const sessions = await service.listProjectArchivedSessions(projectItem.projectId);
        setArchivedByProjectId(current => ({
          ...current,
          [projectItem.projectId]: sessions,
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setArchivedError(current => current || `${projectItem.name}: ${message}`);
      }
    }
    setArchivedLoading(false);
  };

  const loadArchivedSessionPreview = async (targetProjectId: string, sessionId: string) => {
    const normalizedSessionId = sessionId.trim();
    if (!targetProjectId || !normalizedSessionId) {
      return;
    }
    setArchivedError('');
    setSelectedArchivedKey({projectId: targetProjectId, sessionId: normalizedSessionId});
    try {
      const preview = await service.readProjectArchivedSession(targetProjectId, normalizedSessionId);
      setArchivedPreview(preview);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setArchivedError(message);
      setError(message);
    }
  };

  const requestRestoreArchivedSession = (targetProjectId: string, session: RegistryArchivedSessionSummary) => {
    setConfirmError('');
    setConfirmTarget({
      kind: 'restoreArchived',
      projectId: targetProjectId,
      sessionId: session.sessionId,
      title: resolveSessionDisplayTitle(session) || session.sessionId,
    });
  };

  const handleRestoreArchivedSession = async (targetProjectId: string, sessionId: string) => {
    const normalizedSessionId = sessionId.trim();
    if (!targetProjectId || !normalizedSessionId || archivedRestoringSessionId) {
      return;
    }
    const restoringKey = buildChatRuntimeKey(targetProjectId, normalizedSessionId);
    setConfirmError('');
    setArchivedRestoringSessionId(restoringKey);
    try {
      const result = await service.restoreProjectArchivedSession(targetProjectId, normalizedSessionId);
      if (!result.ok) {
        throw new Error('session.archive.restore returned ok=false');
      }
      setArchivedByProjectId(current => ({
        ...current,
        [targetProjectId]: (current[targetProjectId] ?? []).filter(item => item.sessionId !== normalizedSessionId),
      }));
      setConfirmTarget(null);
      setConfirmError('');
      exitArchivedMode();
      await refreshChatProjectSessions(targetProjectId, {force: true});
      await selectProjectChatSession(targetProjectId, result.session.sessionId || normalizedSessionId);
      if (result.warning) {
        setError(result.warning);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmError(message);
      setArchivedError(message);
      setError(message);
    } finally {
      setArchivedRestoringSessionId('');
    }
  };

  const handleDeleteProjectSession = async (targetProjectId: string, sessionId: string) => {
    const normalizedSessionId = sessionId.trim();
    if (!targetProjectId || !normalizedSessionId || chatDeletingSessionId) {
      return;
    }
    setConfirmError('');
    setChatDeletingSessionId(normalizedSessionId);
    try {
      const result = await service.deleteProjectSession(targetProjectId, normalizedSessionId);
      if (!result.ok) {
        throw new Error('session.delete returned ok=false');
      }
      removeProjectChatSessionFromState(
        targetProjectId,
        result.sessionId || normalizedSessionId,
      );
      setProjectSessionActionMenu(null);
      setConfirmTarget(null);
      setConfirmError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmError(message);
      setError(message);
    } finally {
      setChatDeletingSessionId('');
    }
  };

  const handleRenameProjectSession = async (targetProjectId: string, sessionId: string, title: string) => {
    const normalizedSessionId = sessionId.trim();
    const normalizedTitle = Array.from(title.replace(/\r\n|\r|\n/g, ' ').trim()).slice(0, 200).join('');
    if (!targetProjectId || !normalizedSessionId || chatRenamingSessionId) {
      return;
    }
    setRenameError('');
    setChatRenamingSessionId(normalizedSessionId);
    try {
      const result = await service.renameProjectSession(targetProjectId, normalizedSessionId, normalizedTitle);
      if (!result.ok) {
        throw new Error('session.rename returned ok=false');
      }
      const session = result.session ?? {sessionId: result.sessionId || normalizedSessionId, title: normalizedTitle};
      rememberChatSessionSummary(targetProjectId, session);
      const runtimeKey = buildChatRuntimeKey(targetProjectId, session.sessionId);
      workspaceStore.rememberChatSession(
        targetProjectId,
        mergeKnownChatSessionForProject(targetProjectId, session),
        {turnIndex: chatFinishedCursorRef.current[runtimeKey] ?? 0},
      );
      setProjectSessionActionMenu(null);
      setRenameTarget(null);
      setRenameTitleDraft('');
      setRenameError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRenameError(message);
      setError(message);
    } finally {
      setChatRenamingSessionId('');
    }
  };

  const requestRenameProjectSession = (targetProjectId: string, session: RegistrySessionSummary) => {
    const normalizedSessionId = session.sessionId.trim();
    if (!targetProjectId || !normalizedSessionId || chatRenamingSessionId) {
      return;
    }
    const title = resolveSessionDisplayTitle(session);
    setProjectSessionActionMenu(null);
    setRenameError('');
    setRenameTitleDraft(title);
    setRenameTarget({
      projectId: targetProjectId,
      sessionId: normalizedSessionId,
      title,
    });
  };

  useEffect(() => {
    if (!isWide || tab !== 'chat' || sidebarSettingsOpen || !selectedChatKey || !selectedChatSession || renameTarget || confirmTarget) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== 'F2' ||
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      requestRenameProjectSession(selectedChatKey.projectId, selectedChatSession);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    confirmTarget,
    isWide,
    renameTarget,
    requestRenameProjectSession,
    sidebarSettingsOpen,
    selectedChatKey,
    selectedChatSession,
    tab,
  ]);

  const requestArchiveProjectSession = (targetProjectId: string, session: RegistrySessionSummary) => {
    const normalizedSessionId = session.sessionId.trim();
    if (!targetProjectId || !normalizedSessionId || session.running || chatArchivingSessionId) {
      return;
    }
    setProjectSessionActionMenu(null);
    setConfirmError('');
    setConfirmTarget({
      kind: 'archive',
      projectId: targetProjectId,
      sessionId: normalizedSessionId,
      title: resolveSessionDisplayTitle(session),
    });
  };

  const requestDeleteProjectSession = (targetProjectId: string, session: RegistrySessionSummary) => {
    const normalizedSessionId = session.sessionId.trim();
    if (!targetProjectId || !normalizedSessionId || session.running || chatDeletingSessionId) {
      return;
    }
    setProjectSessionActionMenu(null);
    setConfirmError('');
    setConfirmTarget({
      kind: 'delete',
      projectId: targetProjectId,
      sessionId: normalizedSessionId,
      title: resolveSessionDisplayTitle(session),
    });
  };

  const handleReloadProjectSession = async (targetProjectId: string, sessionId: string) => {
    const normalizedSessionId = sessionId.trim();
    if (!targetProjectId || !normalizedSessionId || chatReloadingSessionId) {
      return;
    }
    setChatReloadingSessionId(normalizedSessionId);
    try {
      const result = await service.reloadProjectSession(targetProjectId, normalizedSessionId);
      if (!result.ok) {
        throw new Error('session.reload returned ok=false');
      }
      clearProjectSessionCache(targetProjectId, normalizedSessionId);
      const runtimeKey = buildChatRuntimeKey(targetProjectId, normalizedSessionId);
      if (
        encodeChatSessionKey(selectedChatKeyRef.current) === runtimeKey
      ) {
        setChatMessages([]);
        await loadChatSession(normalizedSessionId, targetProjectId, { forceFull: true });
      }
      setProjectSessionActionMenu(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatReloadingSessionId('');
    }
  };

  const resolveSelectedDraftSessionForSend = async (
    selectedProjectId: string,
    sessionId: string,
    draftKey: string,
  ): Promise<{
    sessionId: string;
    runtimeKey: string;
    draftKey: string;
    draftGeneration: number;
    sentFromKey: ChatSessionKey;
  }> => {
    const existingKey = chatSessionKeyFromParts(selectedProjectId, sessionId);
    if (!existingKey) {
      throw new Error('Select or create a chat session first.');
    }
    const draft = findDraftChatSession(selectedProjectId, sessionId);
    if (!draft) {
      return {
        sessionId,
        runtimeKey: buildChatRuntimeKey(selectedProjectId, sessionId),
        draftKey,
        draftGeneration: getChatDraftGeneration(draftKey),
        sentFromKey: existingKey,
      };
    }
    if (!canStartDraftChatSessionCreate(draft)) {
      const message = draft.errorMessage || 'Session create failed.';
      setError(message);
      throw new Error(message);
    }

    updateDraftChatSession(
      selectedProjectId,
      draft.draftId,
      current => markDraftChatSessionSending(current),
    );
    try {
      const session = await startDraftSessionCreate(selectedProjectId, draft.agentType, draft.draftId);
      const realSessionId = session.sessionId;
      const realDraftKey = buildChatDraftKey(selectedProjectId, realSessionId);
      return {
        sessionId: realSessionId,
        runtimeKey: buildChatRuntimeKey(selectedProjectId, realSessionId),
        draftKey: realDraftKey,
        draftGeneration: getChatDraftGeneration(realDraftKey),
        sentFromKey: chatSessionKeyFromParts(selectedProjectId, realSessionId) ?? existingKey,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    }
  };

  const sendChatMessage = async (options: {
    textOverride?: string;
    attachmentsOverride?: ChatAttachment[];
    blocksOverride?: RegistryChatContentBlock[];
    preserveComposer?: boolean;
  } = {}) => {
    if (voiceAwaitingFinalRef.current) {
      return;
    }
    const sourceAttachments = options.attachmentsOverride ?? chatAttachments;
    const sourceTokens = options.textOverride !== undefined
      ? chatComposerTokensFromText(options.textOverride)
      : chatComposerTokensRef.current;
    const serializedComposer = serializeChatComposerTokens(sourceTokens);
    const composerText = options.blocksOverride ? (options.textOverride ?? '') : serializedComposer.text;
    const trimmedText = composerText.trim();
    if (trimmedText === '/cancel' && sourceAttachments.length === 0 && !options.blocksOverride) {
      setError('Use the stop button to cancel in app.');
      return;
    }
    if (!options.blocksOverride && !trimmedText && sourceAttachments.length === 0) {
      return;
    }
    if (options.blocksOverride && options.blocksOverride.length === 0) {
      return;
    }
    const selectedKey = selectedChatKeyRef.current;
    if (!selectedKey) {
      setError('Select or create a chat session first.');
      return;
    }
    const selectedProjectId = selectedKey.projectId;
    let sessionId = selectedKey.sessionId;
    if (!sessionId) {
      setError('Select or create a chat session first.');
      return;
    }
    if (!options.blocksOverride) {
      const nativeAction = resolveStandaloneSessionAction(trimmedText, sourceAttachments.length);
      if (nativeAction?.kind === 'invalid') {
        setError(`${nativeAction.command} must be used without arguments or attachments.`);
        return;
      }
      if (nativeAction) {
        if (!options.preserveComposer) {
          resetChatComposerDraft(currentChatDraftKeyRef.current);
        }
        await invokeChatSessionAction(nativeAction.kind);
        return;
      }
    }
    let runtimeKey = buildChatRuntimeKey(selectedProjectId, sessionId);
    if (chatSubmittingByKeyRef.current[runtimeKey] === true) {
      return;
    }
    let draftKey = currentChatDraftKeyRef.current;
    let draftGeneration = getChatDraftGeneration(draftKey);
    let sentFromKey = selectedKey;
    let submittingRuntimeKey = runtimeKey;
    let pendingRemembered = false;
    setChatSubmittingForRuntimeKey(submittingRuntimeKey, true);
    try {
      const resolvedDraftSession = await resolveSelectedDraftSessionForSend(
        selectedProjectId,
        sessionId,
        draftKey,
      );
      if (resolvedDraftSession.runtimeKey !== runtimeKey) {
        moveChatSubmittingRuntimeKey(submittingRuntimeKey, resolvedDraftSession.runtimeKey);
        submittingRuntimeKey = resolvedDraftSession.runtimeKey;
      }
      sessionId = resolvedDraftSession.sessionId;
      runtimeKey = resolvedDraftSession.runtimeKey;
      draftKey = resolvedDraftSession.draftKey;
      draftGeneration = resolvedDraftSession.draftGeneration;
      sentFromKey = resolvedDraftSession.sentFromKey;
      const uploadedAttachments = options.blocksOverride ? sourceAttachments : await uploadChatAttachmentsForSend(
        sourceAttachments,
        selectedProjectId,
        sessionId,
        draftKey,
        draftGeneration,
      );
      const blocks: RegistryChatContentBlock[] = [];
      if (options.blocksOverride) {
        blocks.push(...options.blocksOverride.map(block => ({...block})));
      } else {
        blocks.push(...serializedComposer.blocks.map(block => ({...block})));
        blocks.push(...uploadedAttachments.map(attachment => attachment.block).filter(isRegistryChatContentBlock));
      }
      if (blocks.length === 0) {
        setChatSubmittingForRuntimeKey(submittingRuntimeKey, false);
        return;
      }
      if (runtimeSessionHasActiveExecution(selectedProjectId, sessionId, runtimeKey)) {
        const queuedPrompt: QueuedChatPrompt = {
          kind: 'prompt',
          id: makeQueuedPromptId(),
          sessionId,
          blocks: blocks.map(block => ({...block})),
          createdAt: new Date().toISOString(),
          text: trimmedText || msgText('prompt_request', {contentBlocks: blocks}).trim(),
        };
        enqueueSelectedChatPrompt(runtimeKey, queuedPrompt);
        if (!options.preserveComposer) {
          resetChatComposerDraft(draftKey);
        }
        setChatSubmittingForRuntimeKey(submittingRuntimeKey, false);
        forceChatScrollToBottom();
        return;
      }
      const firstAttachmentName = uploadedAttachments[0]?.name || '';
      const previewText = trimmedText || firstAttachmentName || msgText('prompt_request', {contentBlocks: blocks}).trim();
      const createdAt = new Date().toISOString();
      rememberPendingChatPrompt(runtimeKey, {
        sessionId,
        blocks: blocks.map(block => ({...block})),
        createdAt,
        turnIndex: nextPromptTurnIndex(chatMessageStoreRef.current[runtimeKey] ?? []),
        status: 'confirming',
      });
      pendingRemembered = true;

      if (!options.preserveComposer) {
        resetChatComposerDraft(draftKey);
      }
      forceChatScrollToBottom();
      const result = await service.sendProjectSessionMessage(selectedProjectId, {
        sessionId,
        text: trimmedText || previewText,
        blocks,
      });
      if (!result.ok) {
        throw new Error('session.send returned ok=false');
      }
      const nextSessionId = result.sessionId || sessionId;
      if (nextSessionId !== sessionId) {
        movePendingChatPrompt(runtimeKey, buildChatRuntimeKey(selectedProjectId, nextSessionId), nextSessionId);
      }
      const nextSelectedKey = chatSessionKeyFromParts(selectedProjectId, nextSessionId);
      if (shouldApplySentChatSelection(selectedChatKeyRef.current, sentFromKey)) {
        applySelectedChatKey(nextSelectedKey);
        workspaceStore.rememberSelectedChatSessionKey(nextSelectedKey);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (pendingRemembered && chatPendingPromptsByKeyRef.current[runtimeKey]) {
        markPendingChatPromptUndelivered(runtimeKey, message);
        setError(message);
      } else if (!pendingRemembered) {
        setChatSubmittingForRuntimeKey(submittingRuntimeKey, false);
        setError(message);
      }
    } finally {
      if (!pendingRemembered) {
        setChatSubmittingForRuntimeKey(submittingRuntimeKey, false);
      }
    }
  };

  const sendChatMessageEvent = useStableEvent(sendChatMessage);
  const sendDirectChatText = useCallback(async (text: string) => {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }
    setChatFileMentionMenuOpen(false);
    setChatPromptMenuOpen(false);
    setChatConfigMenuOptionId('');
    setChatConfigOverflowOpen(false);
    await sendChatMessage({
      textOverride: normalizedText,
      attachmentsOverride: [],
      preserveComposer: true,
    });
  }, [sendChatMessageEvent]);
  const handleSelectChatReply = useCallback((replyText: string) => {
    sendDirectChatText(replyText).catch(() => undefined);
  }, [sendDirectChatText]);

  const drainNextQueuedChatItem = (runtimeKey: string) => {
    const selectedKey = selectedChatKeyRef.current;
    if (!selectedKey) return;
    if (buildChatRuntimeKey(selectedKey.projectId, selectedKey.sessionId) !== runtimeKey) return;
    if (runtimeSessionIsBusy(selectedKey.projectId, selectedKey.sessionId, runtimeKey)) return;
    const result = shiftNextQueuedChatItem(chatQueuedPromptsByKeyRef.current, runtimeKey);
    if (!result.item) return;
    if (result.item.kind === 'compact') {
      const compact = result.item;
      setChatSubmittingForRuntimeKey(runtimeKey, true);
      setQueuedPrompts(() => result.state);
      requestSessionCompaction(selectedKey.projectId, compact.sessionId, runtimeKey)
        .catch(errorValue => {
          if (isSessionBusyError(errorValue)) {
            setQueuedPrompts(current => enqueueChatItemToFront(current, runtimeKey, compact));
            return;
          }
          setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
        })
        .finally(() => setChatSubmittingForRuntimeKey(runtimeKey, false));
      return;
    }
    const prompt = result.item;
    setQueuedPrompts(() => result.state);
    sendChatMessage({
      textOverride: prompt.text,
      blocksOverride: prompt.blocks,
      attachmentsOverride: [],
      preserveComposer: true,
    }).catch(err => setError(err instanceof Error ? err.message : String(err)));
  };

  const stopVoiceCapture = (options: {flush?: boolean} = {}) => {
    voiceCaptureRef.current?.stop(options);
    voiceCaptureRef.current = null;
    voiceCaptureGenerationRef.current = 0;
  };

  const resetVoiceRecordingUi = () => {
    voiceRecordingRef.current = false;
    voiceInteractionModeRef.current = null;
    setVoiceRecording(false);
    setVoiceInteractionMode(null);
    setVoiceRecordingStatus('recording');
    setVoiceCancelIntent(false);
    setVoiceLevel(0);
  };

  const clearVoiceInputState = () => {
    voiceStartGenerationRef.current += 1;
    if (voiceFinalTimerRef.current !== null) {
      window.clearTimeout(voiceFinalTimerRef.current);
      voiceFinalTimerRef.current = null;
    }
    voiceInputBufferRef.current?.clear();
    voiceInputBufferRef.current = null;
    voiceSendQueueRef.current?.cancel();
    voiceSendQueueRef.current = null;
    voicePendingFinishRef.current = false;
    voiceAwaitingFinalRef.current = false;
    voiceReconnectBufferingRef.current = false;
    voiceRemoteStartRequestedRef.current = false;
    voiceActiveSettingsRef.current = null;
    voiceRuntimeKeyRef.current = '';
    voiceTransportModeRef.current = 'registry';
    resetVoiceRecordingUi();
    voiceStreamIdRef.current = '';
    voiceSeqRef.current = 0;
    voiceSessionRef.current = null;
  };

  const logVoiceInputState = (
    level: VoiceInputDiagnosticLevel,
    event: string,
    details: Record<string, unknown> = {},
  ) => {
    logVoiceInputDiagnostic(level, event, {
      connected,
      recording: voiceRecordingRef.current,
      hasStream: !!voiceStreamIdRef.current,
      transportMode: voiceTransportModeRef.current,
      seq: voiceSeqRef.current,
      ...details,
    });
  };

  const logVoiceInputButtonEvent = (entry: VoiceInputDiagnosticEntry) => {
    logVoiceInputState(entry.level, `button_${entry.event}`, entry.details);
  };

  const setVoiceInputInteractionMode = (mode: VoiceInputInteractionMode) => {
    voiceInteractionModeRef.current = mode;
    setVoiceInteractionMode(mode);
  };

  const voiceInputReconnectAvailable = () => (
    !!projectIdRef.current
  );

  const currentVoiceInputRuntimeKey = () => (
    encodeChatSessionKey(selectedChatKeyRef.current) || projectIdRef.current
  );

  const voiceInputRuntimeSnapshot = (): VoiceInputRuntimeSnapshot => ({
    generation: voiceStartGenerationRef.current,
    expectedRuntimeKey: voiceRuntimeKeyRef.current,
    currentRuntimeKey: currentVoiceInputRuntimeKey(),
    recording: voiceRecordingRef.current,
    streamId: voiceStreamIdRef.current,
    awaitingFinal: voiceAwaitingFinalRef.current,
  });

  const isVoiceInputContextCurrent = () => {
    return isVoiceInputSnapshotContextCurrent(voiceInputRuntimeSnapshot());
  };

  const isVoiceGenerationActive = (generation: number) => (
    isVoiceGenerationActiveSnapshot(voiceInputRuntimeSnapshot(), generation)
  );

  const waitForVoiceInputRetry = (ms: number) => new Promise<void>(resolve => {
    window.setTimeout(resolve, ms);
  });

  const cancelVoiceInput = async (
    reason: RegistrySpeechCancelPayload['reason'] = 'user',
    options: {restoreComposer?: boolean; message?: string} = {},
  ) => {
    const streamId = voiceStreamIdRef.current;
    const session = voiceSessionRef.current;
    const transportMode = voiceTransportModeRef.current;
    const androidSpeechRuntime = androidSpeechRuntimeRef.current;
    logVoiceInputState('debug', 'cancel_requested', {
      reason,
      hasSession: !!session,
      streamIdPresent: !!streamId,
    });
    stopVoiceCapture();
    if (session && options.restoreComposer !== false) {
      const restoredText = session.cancel();
      updateChatComposerText(restoredText, session.currentCursor());
      window.setTimeout(resizeChatComposerTextarea, 0);
    }
    clearVoiceInputState();
    if (options.message) {
      setError(options.message);
    }
    if (!streamId) {
      logVoiceInputState('warn', 'cancel_without_stream', {reason});
      return;
    }
    try {
      if (transportMode === 'android-native') {
        await androidSpeechRuntime?.cancel(streamId, reason);
      } else {
        await service.cancelSpeech({streamId, reason});
      }
      logVoiceInputState('debug', 'cancel_completed', {reason});
    } catch (err) {
      logVoiceInputState('error', 'cancel_failed', {
        reason,
        error: formatVoiceInputDiagnosticError(err),
      });
      if (reason !== 'disconnect') {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const cancelVoiceInputByGesture = () => {
    void cancelVoiceInput('gesture');
  };

  const commitVoiceInputTranscript = () => {
    const session = voiceSessionRef.current;
    if (!session) {
      return '';
    }
    const nextText = session.commitLiveTranscript();
    updateChatComposerText(nextText, session.currentCursor());
    window.setTimeout(() => resizeChatComposerTextarea({scrollToEnd: true}), 0);
    return nextText;
  };

  const finishVoiceInputPreservingTranscript = (
    message?: string,
    options: {cancelStream?: boolean} = {},
  ) => {
    const streamId = voiceStreamIdRef.current;
    const transportMode = voiceTransportModeRef.current;
    const androidSpeechRuntime = androidSpeechRuntimeRef.current;
    stopVoiceCapture();
    commitVoiceInputTranscript();
    clearVoiceInputState();
    if (message) {
      setError(message);
    }
    if (streamId && options.cancelStream !== false && (transportMode === 'android-native' || connectedRef.current)) {
      const cancelPromise = transportMode === 'android-native'
        ? androidSpeechRuntime?.cancel(streamId, 'error')
        : service.cancelSpeech({streamId, reason: 'error'});
      cancelPromise?.catch(err => {
        logVoiceInputDiagnostic('error', 'preserve_cancel_failed', {
          connected: connectedRef.current,
          transportMode,
          streamId,
          error: formatVoiceInputDiagnosticError(err),
        });
      });
    }
  };

  const clearVoiceStreamStateForReconnect = () => {
    voiceSendQueueRef.current?.cancel();
    voiceSendQueueRef.current = null;
    voiceStreamIdRef.current = '';
    voiceSeqRef.current = 0;
    voiceRemoteStartRequestedRef.current = false;
  };

  const completeVoiceInputFinalizing = (generation: number) => {
    if (voiceStartGenerationRef.current !== generation) {
      return;
    }
    commitVoiceInputTranscript();
    clearVoiceInputState();
  };

  const scheduleVoiceFinalTimeout = (generation: number) => {
    if (voiceFinalTimerRef.current !== null) {
      window.clearTimeout(voiceFinalTimerRef.current);
    }
    voiceFinalTimerRef.current = window.setTimeout(() => {
      voiceFinalTimerRef.current = null;
      completeVoiceInputFinalizing(generation);
    }, VOICE_LONG_TIMEOUT_MS);
  };

  const isVoiceInputActive = () => (
    isVoiceInputSnapshotActive(voiceInputRuntimeSnapshot())
  );

  const handleVoiceRegistryClosedDuringInput = (source: 'close' | 'chunk' | 'speech_error', err?: unknown) => {
    if (voiceTransportModeRef.current !== 'registry') {
      return false;
    }
    if (!isVoiceInputActive()) {
      return false;
    }
    const generation = voiceStartGenerationRef.current;
    const queueStats = voiceSendQueueRef.current?.stats();
    const bufferStats = voiceInputBufferRef.current?.stats();
    logVoiceInputDiagnostic('warn', 'registry_closed_during_voice', {
      connected: connectedRef.current,
      recording: voiceRecordingRef.current,
      pendingFinish: voicePendingFinishRef.current,
      awaitingFinal: voiceAwaitingFinalRef.current,
      hasStream: !!voiceStreamIdRef.current,
      source,
      error: err ? formatVoiceInputDiagnosticError(err) : undefined,
      queuedBytes: queueStats?.queuedBytes ?? 0,
      bufferedDurationMs: bufferStats?.durationMs ?? 0,
    });
    commitVoiceInputTranscript();
    clearVoiceStreamStateForReconnect();
    if (!voiceRecordingRef.current || voicePendingFinishRef.current || voiceAwaitingFinalRef.current) {
      return true;
    }
    if (!voiceInputBufferRef.current) {
      voiceInputBufferRef.current = createDefaultVoiceInputBuffer();
    }
    voiceReconnectBufferingRef.current = true;
    setVoiceRecordingStatus('buffering');
    logVoiceInputDiagnostic('warn', 'voice_reconnect_buffering', {
      connected: connectedRef.current,
      bufferedDurationMs: voiceInputBufferRef.current.stats().durationMs,
      maxBytes: voiceInputBufferRef.current.stats().maxBytes,
    });
    const settings = voiceActiveSettingsRef.current;
    if (settings) {
      void runVoiceStartLoop(generation, settings);
    }
    return true;
  };

  const handleVoiceChunkSendFailure = (generation: number, err: unknown) => {
    if (!isVoiceGenerationActive(generation)) {
      return;
    }
    if (!voicePendingFinishRef.current && isVoiceInputStreamRetryableError(err)) {
      handleVoiceRegistryClosedDuringInput('chunk', err);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    logVoiceInputDiagnostic('error', 'chunk_send_failed', {
      connected: connectedRef.current,
      hasStream: !!voiceStreamIdRef.current,
      seq: voiceSeqRef.current,
      error: formatVoiceInputDiagnosticError(err),
      queuedBytes: voiceSendQueueRef.current?.stats().queuedBytes ?? 0,
      bufferedDurationMs: voiceInputBufferRef.current?.stats().durationMs ?? 0,
    });
    void cancelVoiceInput('error', {
      message,
    });
  };

  const flushVoiceInputBufferToQueue = (generation: number) => {
    const queue = voiceSendQueueRef.current;
    const buffer = voiceInputBufferRef.current;
    if (!queue || !buffer || !isVoiceGenerationActive(generation)) {
      return;
    }
    const chunks = buffer.drain();
    for (const bytes of chunks) {
      queue.enqueue(bytes).catch(err => handleVoiceChunkSendFailure(generation, err));
    }
  };

  const startVoiceRegistryStream = async (
    generation: number,
    settings: ServerSettings['voiceInput'],
  ) => {
    if (voiceStreamIdRef.current || !isVoiceGenerationActive(generation)) {
      return true;
    }
    const response = await service.startSpeech({
      provider: 'volcengine',
      audio: {
        format: 'pcm',
        codec: 'raw',
        rate: 16000,
        bits: 16,
        channel: 1,
      },
    });
    if (!response.streamId) {
      throw new Error('speech.start returned no streamId');
    }
    if (!isVoiceGenerationActive(generation)) {
      await service.cancelSpeech({streamId: response.streamId, reason: 'gesture'});
      return false;
    }
    voiceStreamIdRef.current = response.streamId;
    voiceRemoteStartRequestedRef.current = true;
    voiceSendQueueRef.current = createDefaultVoiceInputSendQueue({
      streamId: response.streamId,
      sendChunk: async payload => {
        voiceSeqRef.current = payload.seq;
        await service.sendSpeechChunk(payload);
      },
    });
    setVoiceRecordingStatus(voicePendingFinishRef.current ? 'finishing' : 'recording');
    if (voiceReconnectBufferingRef.current) {
      logVoiceInputDiagnostic('warn', 'voice_reconnect_stream_started', {
        connected: connectedRef.current,
        streamId: response.streamId,
        bufferedDurationMs: voiceInputBufferRef.current?.stats().durationMs ?? 0,
      });
      voiceReconnectBufferingRef.current = false;
    }
    flushVoiceInputBufferToQueue(generation);
    return true;
  };

  const runVoiceStartLoop = async (
    generation: number,
    settings: ServerSettings['voiceInput'],
  ) => {
    while (isVoiceGenerationActive(generation) && !voiceStreamIdRef.current) {
      if (!connectedRef.current) {
        if (!voiceInputReconnectAvailable()) {
          logVoiceInputState('warn', 'start_buffering_without_reconnect_context');
          await cancelVoiceInput('error', {
            message: 'Connect Registry before using voice input.',
          });
          return;
        }
        try {
          await connect({silentReconnect: true});
        } catch {
          await waitForVoiceInputRetry(VOICE_SHORT_TIMEOUT_MS);
          continue;
        }
      }
      try {
        const started = await startVoiceRegistryStream(generation, settings);
        if (started) {
          return;
        }
      } catch (err) {
        if (isVoiceInputStartRetryableError(err)) {
          await waitForVoiceInputRetry(VOICE_SHORT_TIMEOUT_MS);
          continue;
        }
        if (!isVoiceGenerationActive(generation)) {
          return;
        }
        logVoiceInputDiagnostic('error', 'start_failed', {
          connected: connectedRef.current,
          model: settings.model,
          error: formatVoiceInputDiagnosticError(err),
        });
        await cancelVoiceInput('error', {
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
    }
  };

  const waitForVoiceStreamReady = async (generation: number, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (isVoiceGenerationActive(generation)) {
      if (voiceStreamIdRef.current && voiceSendQueueRef.current) {
        return true;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return false;
      }
      await waitForVoiceInputRetry(Math.min(VOICE_SHORT_TIMEOUT_MS, remaining));
    }
    return false;
  };

  const handleVoicePCMChunk = (generation: number, chunk: {bytes: Uint8Array<ArrayBufferLike>}) => {
    if (!isVoiceGenerationActive(generation) || voicePendingFinishRef.current) {
      return;
    }
    if (voiceSendQueueRef.current) {
      voiceSendQueueRef.current.enqueue(chunk.bytes).catch(err => handleVoiceChunkSendFailure(generation, err));
      return;
    }
    const result = voiceInputBufferRef.current?.append(chunk.bytes);
    if (result?.overflow) {
      const overflowDetails = {
        connected: connectedRef.current,
        byteCount: result.stats.byteCount,
        bufferedDurationMs: result.stats.durationMs,
        maxBytes: result.stats.maxBytes,
      };
      if (voiceReconnectBufferingRef.current) {
        logVoiceInputDiagnostic('warn', 'voice_reconnect_buffer_overflow', overflowDetails);
      } else {
        logVoiceInputDiagnostic('warn', 'buffer_overflow', overflowDetails);
      }
      finishVoiceInputPreservingTranscript('Registry connection is too slow for voice input. Recognized text was kept.');
    }
  };

  const createVoiceMicrophoneCapture = () => startVoiceInputMicrophoneStream({
    onReady: () => {
      const generation = voiceCaptureGenerationRef.current;
      if (generation <= 0 || !isVoiceGenerationActive(generation)) {
        return;
      }
      setVoiceRecordingStatus(resolveVoiceCaptureReadyStatus({
        hasStream: !!voiceStreamIdRef.current,
        pendingFinish: voicePendingFinishRef.current,
      }));
      if (voiceRemoteStartRequestedRef.current) {
        return;
      }
      const settings = voiceActiveSettingsRef.current;
      if (!settings) {
        return;
      }
      voiceRemoteStartRequestedRef.current = true;
      void runVoiceStartLoop(generation, settings);
    },
    onLevel: level => {
      if (voiceCaptureGenerationRef.current > 0) {
        setVoiceLevel(level);
      }
    },
    onChunk: chunk => {
      const generation = voiceCaptureGenerationRef.current;
      if (generation > 0) {
        handleVoicePCMChunk(generation, chunk);
      }
    },
    onEnded: reason => {
      if (voiceRecordingRef.current || voiceStreamIdRef.current) {
        logVoiceInputDiagnostic('error', 'mic_capture_ended_unexpectedly', {
          connected: connectedRef.current,
          reason,
          hasStream: !!voiceStreamIdRef.current,
          recording: voiceRecordingRef.current,
        });
        finishVoiceInputPreservingTranscript('Microphone capture ended. Recognized text was kept.');
      }
    },
  });

  const startVoiceCaptureForGeneration = async (generation: number) => {
    voiceCaptureGenerationRef.current = generation;
    return createVoiceMicrophoneCapture();
  };

  const finishVoiceInput = async () => {
    const generation = voiceStartGenerationRef.current;
    const streamId = voiceStreamIdRef.current;
    logVoiceInputState('debug', 'finish_requested', {streamIdPresent: !!streamId});
    if (voiceTransportModeRef.current === 'android-native') {
      voicePendingFinishRef.current = true;
      setVoiceRecordingStatus('finishing');
      if (!streamId) {
        logVoiceInputState('warn', 'finish_without_native_stream');
        await cancelVoiceInput('error', {
          message: 'Android native speech did not return a stream.',
        });
        return;
      }
      try {
        const androidSpeechRuntime = androidSpeechRuntimeRef.current;
        if (!androidSpeechRuntime) {
          throw new Error('Android native speech is unavailable.');
        }
        await androidSpeechRuntime.finish(streamId);
        if (!isVoiceGenerationActive(generation)) {
          return;
        }
		logVoiceInputState('debug', 'native_capture_finish_requested');
      } catch (err) {
        if (!isVoiceGenerationActive(generation)) {
          return;
        }
        logVoiceInputState('error', 'native_finish_failed', {
          error: formatVoiceInputDiagnosticError(err),
        });
        finishVoiceInputPreservingTranscript(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    stopVoiceCapture({flush: true});
    voicePendingFinishRef.current = true;
    setVoiceRecordingStatus('finishing');
    if (!streamId) {
      const ready = await waitForVoiceStreamReady(generation, VOICE_LONG_TIMEOUT_MS);
      if (!ready) {
        logVoiceInputState('warn', 'finish_without_stream');
        await cancelVoiceInput('error', {
          message: 'Registry reconnect timed out before voice input could finish.',
        });
        return;
      }
    }
    try {
      const queue = voiceSendQueueRef.current;
      if (queue) {
        await queue.drain();
      }
      const activeStreamId = voiceStreamIdRef.current;
      if (!activeStreamId || !isVoiceGenerationActive(generation)) {
        return;
      }
      await service.finishSpeech({streamId: activeStreamId});
      voiceAwaitingFinalRef.current = true;
      voiceRecordingRef.current = false;
      voiceInteractionModeRef.current = null;
      setVoiceInteractionMode(null);
      setVoiceRecording(true);
      setVoiceRecordingStatus('recognizing');
      setVoiceCancelIntent(false);
      setVoiceLevel(0);
      scheduleVoiceFinalTimeout(generation);
      logVoiceInputState('debug', 'finish_completed');
    } catch (err) {
      if (!isVoiceGenerationActive(generation)) {
        return;
      }
      logVoiceInputState('error', 'finish_failed', {
        error: formatVoiceInputDiagnosticError(err),
      });
      finishVoiceInputPreservingTranscript(err instanceof Error ? err.message : String(err));
    }
  };

  const handleVoiceSpeechTranscriptEvent = (payload: RegistrySpeechTranscriptEvent) => {
    if (!payload || payload.streamId !== voiceStreamIdRef.current || !voiceSessionRef.current) {
      return;
    }
    if (!isVoiceInputContextCurrent()) {
      void cancelVoiceInput('gesture', {restoreComposer: false});
      return;
    }
    if (payload.text !== '') {
      const session = voiceSessionRef.current;
      const nextText = session.applyTranscript(payload.text);
      updateChatComposerText(nextText, session.currentCursor());
      window.setTimeout(() => resizeChatComposerTextarea({scrollToEnd: true}), 0);
    }
    if (payload.final) {
      stopVoiceCapture();
      completeVoiceInputFinalizing(voiceStartGenerationRef.current);
    }
  };

  const handleVoiceSpeechErrorEvent = (payload: RegistrySpeechErrorEvent) => {
    logVoiceInputDiagnostic('error', 'speech_error_event', {
      connected: connectedRef.current,
      code: payload.code,
      message: payload.message,
      retryable: payload.retryable,
      hasStream: !!voiceStreamIdRef.current,
      recording: voiceRecordingRef.current,
      pendingFinish: voicePendingFinishRef.current,
    });
    if (
      voiceTransportModeRef.current === 'registry' &&
      payload.retryable &&
      voiceRecordingRef.current &&
      !voicePendingFinishRef.current
    ) {
      handleVoiceRegistryClosedDuringInput('speech_error', new Error(payload.message));
      return;
    }
    finishVoiceInputPreservingTranscript(payload.message, {cancelStream: false});
  };

  const handleAndroidNativeSpeechEvent = (event: AndroidNativeSpeechEvent) => {
    if (event.type === 'error') {
      if (event.streamId && event.streamId !== voiceStreamIdRef.current) {
        return;
      }
      if (isAndroidNativeSpeechAuthenticationError(event.code)) {
        void androidSpeechRuntimeRef.current?.clearCredential().catch(() => undefined);
      }
      handleVoiceSpeechErrorEvent({
        streamId: event.streamId,
        code: event.code,
        message: event.message,
        retryable: event.retryable,
      });
      return;
    }
    if (event.streamId !== voiceStreamIdRef.current) {
      return;
    }
    if (event.type === 'level') {
      setVoiceLevel(event.level);
      return;
    }
    if (event.type === 'status') {
      if (event.status === 'permission') {
        setVoiceRecordingStatus('permission');
      } else if (event.status === 'connecting') {
        setVoiceRecordingStatus('buffering');
      } else if (
        event.status === 'recording' ||
        event.status === 'finishing' ||
        event.status === 'recognizing'
      ) {
        setVoiceRecordingStatus(event.status);
      }
      return;
    }
    if (event.type === 'transcript') {
      handleVoiceSpeechTranscriptEvent({
        streamId: event.streamId,
        text: event.text,
        final: event.final,
      });
      return;
    }
    if (event.type === 'closed' && event.reason !== 'finished') {
      finishVoiceInputPreservingTranscript();
    }
  };

  const startVoiceInput = async (interactionMode: VoiceInputInteractionMode = 'locked') => {
    if (voiceRecordingRef.current || voiceStreamIdRef.current || voiceAwaitingFinalRef.current) {
      logVoiceInputState('warn', 'start_ignored_active_session');
      return;
    }
    const settings = serverSettings.voiceInput;
    if (!voiceInputEnabled) {
      logVoiceInputState('warn', 'start_ignored_disabled');
      return;
    }
    const nativeSpeechHost = isAndroidNativeSpeechHost();
    const androidSpeechRuntime = nativeSpeechHost ? createAndroidNativeSpeechRuntime() : null;
    if (nativeSpeechHost) {
      androidSpeechRuntimeRef.current = androidSpeechRuntime;
      if (!androidSpeechRuntime) {
        logVoiceInputState('warn', 'start_ignored_native_unavailable');
        setError('Android native speech is unavailable.');
        return;
      }
    }
	if (!connected && !voiceInputReconnectAvailable()) {
      logVoiceInputState('warn', 'start_ignored_disconnected');
      setError('Connect Registry before using voice input.');
      return;
    }
    const composerSelection = chatRichComposerRef.current?.getPlainTextSelection();
    const baseText = composerSelection?.text ?? chatComposerTextRef.current;
    const insertStart = composerSelection?.start ?? baseText.length;
    const insertEnd = composerSelection?.end ?? insertStart;
    logVoiceInputDiagnostic('debug', 'start_requested', {
      connected,
      model: settings.model,
      baseTextLength: baseText.length,
      insertStart,
      insertEnd,
      interactionMode,
      transportMode: nativeSpeechHost ? 'android-native' : 'registry',
    });
	if (!connected) {
      logVoiceInputState('warn', 'start_buffering_disconnected', {
        reconnectAvailable: voiceInputReconnectAvailable(),
      });
    }
    const generation = voiceStartGenerationRef.current + 1;
    voiceStartGenerationRef.current = generation;
    voiceSessionRef.current = createVoiceInputSession(baseText, insertStart, insertEnd);
    voiceInputBufferRef.current = nativeSpeechHost ? null : createDefaultVoiceInputBuffer();
    voiceSendQueueRef.current = null;
    voicePendingFinishRef.current = false;
    voiceAwaitingFinalRef.current = false;
    voiceReconnectBufferingRef.current = false;
    voiceRemoteStartRequestedRef.current = false;
    voiceActiveSettingsRef.current = settings;
    voiceRuntimeKeyRef.current = currentVoiceInputRuntimeKey();
    voiceTransportModeRef.current = nativeSpeechHost ? 'android-native' : 'registry';
    voiceStartedAtRef.current = Date.now();
    voiceSeqRef.current = 0;
    voiceCaptureGenerationRef.current = nativeSpeechHost ? 0 : generation;
    voiceInteractionModeRef.current = interactionMode;
    voiceRecordingRef.current = true;
    setVoiceInteractionMode(interactionMode);
    setVoiceRecording(true);
    setVoiceRecordingStatus('permission');
    setVoiceCancelIntent(false);
    setVoiceElapsedMs(0);
    setVoiceLevel(0);
    setError('');
    setChatPromptMenuOpen(false);
    setChatAttachmentTrayOpen(false);
    setChatFileMentionMenuOpen(false);
    setChatConfigMenuOptionId('');
    setChatConfigOverflowOpen(false);

    try {
      if (nativeSpeechHost) {
        if (!androidSpeechRuntime) {
          throw new Error('Android native speech is unavailable.');
        }
        const nativeSpeechStartToken = await androidSpeechRuntime.reserveStart();
        const credentialState = await androidSpeechRuntime.credentialState();
        const credentialStartMode = resolveAndroidSpeechCredentialStartMode({
          credentialState,
          snapshot: serverSettings,
          connected: connectedRef.current,
        });
        if (credentialStartMode === 'blocked') {
          throw new Error('Voice input is not configured.');
        }
        if (credentialStartMode === 'sync') {
          if (!connectedRef.current) await connect({silentReconnect: true});
          await synchronizeAndroidSpeechCredential(
            androidSpeechRuntime,
            serverSettings,
            () => service.getAndroidSpeechCredential(),
          );
        }
        logVoiceInputState('debug', 'native_start_requested');
        const response = await androidSpeechRuntime.start({
          provider: 'volcengine',
          model: settings.model,
          audio: {
            format: 'pcm',
            codec: 'raw',
            rate: 16000,
            bits: 16,
            channel: 1,
          },
        }, nativeSpeechStartToken);
        if (!isVoiceGenerationActive(generation)) {
          await androidSpeechRuntime.cancel(response.streamId, 'gesture');
          return;
        }
        voiceStreamIdRef.current = response.streamId;
        voiceRemoteStartRequestedRef.current = true;
        setVoiceRecordingStatus('buffering');
        logVoiceInputState('debug', 'native_started', {streamIdPresent: true});
        return;
      }
      logVoiceInputState('debug', 'microphone_start_requested');
      const capture = await startVoiceCaptureForGeneration(generation);
      logVoiceInputState('debug', 'microphone_started');
      if (
        voiceCaptureGenerationRef.current !== generation ||
        !isVoiceGenerationActive(generation)
      ) {
        logVoiceInputState('warn', 'microphone_started_after_cancel');
        capture.stop();
        return;
      }
      voiceCaptureRef.current = capture;
      setVoiceRecordingStatus('starting');
    } catch (err) {
		const activeStreamId = voiceStreamIdRef.current;
      stopVoiceCapture();
      clearVoiceInputState();
      if (activeStreamId) {
        if (nativeSpeechHost) {
          androidSpeechRuntime?.cancel(activeStreamId, 'error').catch(() => undefined);
        } else {
          service.cancelSpeech({streamId: activeStreamId, reason: 'error'}).catch(() => undefined);
        }
      }
      logVoiceInputDiagnostic('error', 'start_failed', {
        connected,
        model: settings.model,
        error: formatVoiceInputDiagnosticError(err),
      });
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    const runtime = createAndroidNativeSpeechRuntime();
    androidSpeechRuntimeRef.current = runtime;
    if (!runtime) {
      return undefined;
    }
    return runtime.onEvent(handleAndroidNativeSpeechEvent);
  }, []);

  useEffect(() => {
    if (!voiceRecordingRef.current && !voiceStreamIdRef.current) {
      return;
    }
    if (isVoiceInputContextCurrent()) {
      return;
    }
    void cancelVoiceInput('gesture', {restoreComposer: false});
  }, [selectedChatKey, projectId]);

  const buildChatAttachmentsFromBlocks = (blocks: RegistryChatContentBlock[]): ChatAttachment[] => {
    const attachments: ChatAttachment[] = [];
    for (const [index, block] of blocks.entries()) {
      const blockType = typeof block.type === 'string' ? block.type.trim().toLowerCase() : '';
      if (blockType !== 'image' && blockType !== 'resource_link') {
        continue;
      }
      if (isProjectFileMentionBlock(block)) {
        continue;
      }
      if (!block.uri && !block.data) {
        continue;
      }
      chatAttachmentIdRef.current += 1;
      attachments.push({
        id: `chat-attachment-${chatAttachmentIdRef.current}`,
        name: block.name || `undelivered-attachment-${index + 1}`,
        mimeType: typeof block.mimeType === 'string' ? block.mimeType : '',
        size: typeof block.size === 'number' ? block.size : 0,
        status: 'completed',
        progress: 100,
        block: {...block},
        attachmentId: attachmentIdFromBlock(block),
      });
    }
    return attachments;
  };

  const retryPendingChatPrompt = useCallback((runtimeKey: string) => {
    const pending = chatPendingPromptsByKeyRef.current[runtimeKey];
    if (!pending) return;
    sendChatMessageEvent({
      textOverride: '',
      attachmentsOverride: [],
      blocksOverride: pending.blocks,
      preserveComposer: true,
    }).catch(() => undefined);
  }, [sendChatMessageEvent]);

  const editPendingChatPrompt = useCallback((runtimeKey: string) => {
    const pending = chatPendingPromptsByKeyRef.current[runtimeKey];
    if (!pending) return;
    if (
      (chatComposerTextRef.current.trim() || chatAttachmentsRef.current.length > 0 || chatComposerTokensRef.current.length > 0) &&
      !window.confirm('Replace the current draft with this undelivered message?')
    ) {
      return;
    }
    const text = extractTextFromACPContent(pending.blocks);
    const attachments = buildChatAttachmentsFromBlocks(pending.blocks);
    const tokens = chatComposerTokensFromText(text);
    chatComposerTextRef.current = text;
    chatComposerTextCursorRef.current = text.length;
    chatComposerTokensRef.current = tokens;
    chatAttachmentsRef.current = attachments;
    bumpChatDraftGeneration(currentChatDraftKeyRef.current);
    setChatComposerText(text);
    setChatComposerTokens(tokens);
    setChatAttachments(attachments);
    saveChatComposerDraft(currentChatDraftKeyRef.current, text, attachments, tokens);
    forgetPendingChatPrompt(runtimeKey);
  }, [saveChatComposerDraft]);

  const cancelSelectedChatPrompt = async () => {
    const selectedKey = selectedChatKeyRef.current;
    if (!selectedKey?.sessionId) {
      return;
    }
    const runtimeKey = encodeChatSessionKey(selectedKey);
    if (!runtimeKey || chatCancellingRuntimeKey === runtimeKey) {
      return;
    }
    setChatCancellingRuntimeKey(runtimeKey);
    setError('');
    try {
      const result = await service.cancelProjectSession(selectedKey.projectId, selectedKey.sessionId);
      if (!result.ok) {
        throw new Error('session.cancel returned ok=false');
      }
    } catch (err) {
      setChatCancellingRuntimeKey(current => (current === runtimeKey ? '' : current));
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const applyChatSessionConfigOptions = (
    activeProjectId: string,
    sessionId: string,
    configOptions: RegistrySessionConfigOption[],
  ) => {
    if (!activeProjectId || !sessionId) return;
    setProjectSessionsByProjectId(prev => {
      const existing = prev[activeProjectId]?.find(item => item.sessionId === sessionId);
      return mergeProjectSessionMap(prev, activeProjectId, {
        ...(existing ?? {sessionId}),
        configOptions,
      });
    });
    if (activeProjectId === projectIdRef.current) {
      setChatSessions(prev => {
        const existing = prev.find(item => item.sessionId === sessionId);
        if (!existing) return prev;
        return mergeChatSession(prev, {
          ...existing,
          configOptions,
        });
      });
    }
  };

  const handleChatConfigOptionChange = async (
    option: RegistrySessionConfigOption,
    value: string,
  ) => {
    const selectedKey = selectedChatKeyRef.current;
    const sessionId = selectedKey?.sessionId.trim() ?? '';
    const configId = option.id.trim();
    const nextValue = value;
    if (!selectedKey || !sessionId || !configId || !nextValue || nextValue === option.currentValue) {
      return;
    }
    const updatingKey = `${encodeChatSessionKey(selectedKey)}:${configId}`;
    setChatConfigUpdatingKey(updatingKey);

    try {
      const result = await service.setProjectSessionConfig(selectedKey.projectId, {
        sessionId,
        configId,
        value: nextValue,
      });
      if (!result.ok) {
        throw new Error('session.setConfig returned ok=false');
      }
      if (result.configOptions.length > 0) {
        applyChatSessionConfigOptions(selectedKey.projectId, result.sessionId || sessionId, result.configOptions);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setChatConfigUpdatingKey(prev => (prev === updatingKey ? '' : prev));
    }
  };

  const handleChatFileChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (selectedChatSubmitPending) {
      event.target.value = '';
      return;
    }
    const files = chatFilesFromFileList(event.target.files);
    if (files.length === 0) {
      return;
    }
    const attachmentDraftKey = currentChatDraftKeyRef.current;
    const attachmentDraftGeneration = getChatDraftGeneration(attachmentDraftKey);
    enqueueChatAttachmentFiles(files, attachmentDraftKey, attachmentDraftGeneration);
    event.target.value = '';
  };

  const handleChatImageChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (selectedChatSubmitPending) {
      event.target.value = '';
      return;
    }
    const files = chatFilesFromFileList(event.target.files);
    if (files.length === 0) {
      return;
    }
    const attachmentDraftKey = currentChatDraftKeyRef.current;
    const attachmentDraftGeneration = getChatDraftGeneration(attachmentDraftKey);
    enqueueChatAttachmentFiles(files, attachmentDraftKey, attachmentDraftGeneration);
    event.target.value = '';
  };

  const schedulePostConnectProjectRefresh = () => {
    window.setTimeout(() => {
      refreshChatIndex({force: true}).catch(() => undefined);
    }, 0);
  };

  const synchronizeAndroidSpeechCredentialSnapshot = async (snapshot: ServerSettings) => {
    if (!isAndroidNativeSpeechHost()) return;
    const runtime = androidSpeechRuntimeRef.current ?? createAndroidNativeSpeechRuntime();
    if (!runtime) return;
    androidSpeechRuntimeRef.current = runtime;
    await synchronizeAndroidSpeechCredential(
      runtime,
      snapshot,
      () => service.getAndroidSpeechCredential(),
    );
  };

  const synchronizeServerSettings = async () => {
    setServerSettingsBusy(true);
    setServerSettingsError('');
    try {
      const snapshot = normalizeServerSettings(await service.getServerSettings());
      setServerSettings(snapshot);
      await synchronizeAndroidSpeechCredentialSnapshot(snapshot);
    } catch (settingsError) {
      setServerSettingsError(settingsError instanceof Error ? settingsError.message : String(settingsError));
    } finally {
      setServerSettingsBusy(false);
    }
  };

  const updateServerSetting = async (update: ServerSettingsUpdate) => {
    setServerSettingsBusy(true);
    setServerSettingsError('');
    try {
      const snapshot = normalizeServerSettings(await service.updateServerSettings(update));
      setServerSettings(snapshot);
      await synchronizeAndroidSpeechCredentialSnapshot(snapshot);
    } catch (settingsError) {
      setServerSettingsError(settingsError instanceof Error ? settingsError.message : String(settingsError));
      throw settingsError;
    } finally {
      setServerSettingsBusy(false);
    }
  };

  const connect = async ({
    silentReconnect = false,
  }: { silentReconnect?: boolean } = {}) => {
    if (connectInFlightRef.current) {
      return;
    }
    const finishConnectDiagnostic = startWorkspaceDiagnosticSpan('connect_registry', {
      silentReconnect,
    });
    let connectError = '';
    let reconnectScheduled = false;
    let connectedProjectId = '';
    connectInFlightRef.current = true;
    const previousSelectedChatKey = selectedChatKeyRef.current;
    setError('');
    clearReconnectTimer();
    if (!silentReconnect) {
      reconnectStartedAtRef.current = null;
      setReconnecting(false);
    }
    try {
      await registryAuthController.requireSession();
      const result = await workspaceController.connect(registryEndpoints.wsURL, {disableFileCache});
      connectedProjectId = result.hydrated.projectId;
      const persistedSelectedChatKey = workspaceStore.migrateSelectedChatSessionKey(result.hydrated.projectId);
      const preferredSelectedChatKey =
        previousSelectedChatKey ||
        persistedSelectedChatKey ||
        chatSessionKeyFromParts(
          result.hydrated.projectId,
          workspaceStore.getSelectedChatSessionId(result.hydrated.projectId),
        );
      const preferredSelectedChatId = preferredSelectedChatKey?.sessionId ?? '';
      setProjects(result.projects);
      setRegistryHubs(result.hubs);
      setHasPendingProjectUpdates(false);
      captureSelectedFileScrollPosition();
      dirHashRef.current = {};
      if (!silentReconnect) {
        fileHashRef.current = {};
        fileCacheRef.current = {};
      }
      applyHydratedProjectState(result.hydrated, {
        preserveFileView: silentReconnect,
      });
      const selectedFileToReload =
        result.hydrated.selectedFile || selectedFileRef.current;
      if (selectedFileToReload) {
        skipNextSelectedFileAutoReadRef.current = true;
        readSelectedFile(selectedFileToReload, { restoreScroll: true, silent: silentReconnect }).catch(() => undefined);
      }
      reconnectStartedAtRef.current = null;
      setReconnecting(false);
      setConnected(true);
      void synchronizeServerSettings();
      refreshTerminalLists(result.hubs).catch(() => undefined);
      if (!silentReconnect) {
        clearChatRuntimeState();
        if (preferredSelectedChatKey) {
          applySelectedChatKey(preferredSelectedChatKey);
          hydrateChatSessionsFromCache(preferredSelectedChatKey.projectId, preferredSelectedChatKey.sessionId);
        } else {
          hydrateChatSessionsFromCache(result.hydrated.projectId, '');
        }
      }
      if (silentReconnect) {
        syncChatSessionsAfterReconnect(preferredSelectedChatKey).catch(() => undefined);
      } else if (tabRef.current === 'chat') {
        loadChatSessions(
          preferredSelectedChatKey?.projectId ?? result.hydrated.projectId,
          preferredSelectedChatId,
        ).catch(() => undefined);
      }
      schedulePostConnectProjectRefresh();
      workspaceController
        .validateExpandedDirectories(
          result.hydrated.projectId,
          result.rootEntries,
          result.hydrated.expandedDirs,
          {disableFileCache},
        )
        .then(validated => {
          if (projectIdRef.current !== result.hydrated.projectId) return;
          setDirEntries(validated.dirEntries);
          setExpandedDirs(validated.expandedDirs);
        })
        .catch(() => undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      connectError = message;
      if (silentReconnect) {
        const reconnectStartedAt = reconnectStartedAtRef.current ?? Date.now();
        reconnectStartedAtRef.current = reconnectStartedAt;
        const elapsed = Date.now() - reconnectStartedAt;
        if (elapsed < RECONNECT_GRACE_PERIOD_MS) {
          setError('');
          setReconnecting(true);
          reconnectScheduled = true;
          scheduleReconnectAttempt();
          return;
        }
        reconnectStartedAtRef.current = null;
        setReconnecting(false);
        setError(
          `Registry reconnect failed for ${Math.floor(
            RECONNECT_GRACE_PERIOD_MS / 15000,
          )}s. Please reconnect manually.`,
        );
        return;
      }
      setError(message);
    } finally {
      finishConnectDiagnostic({
        ok: !connectError,
        reconnectScheduled,
        projectId: connectedProjectId,
        ...(connectError ? {error: connectError} : {}),
      }, connectError && !reconnectScheduled ? 'error' : 'info');
      connectInFlightRef.current = false;
      setAutoConnecting(false);
    }
  };

  const handleRegistryLogin = async () => {
    const deviceName = await resolveLoginDeviceName();
    const snapshot = await registryAuthController.login(loginToken, deviceName);
    if (snapshot.state !== 'authenticated') return;
    setLoginToken('');
    await connect();
  };

  const refreshDeviceSessions = async () => {
    setDeviceSessionsLoading(true);
    setDeviceSessionsError('');
    try {
      setDeviceSessions(await service.listDeviceSessions());
    } catch (deviceError) {
      setDeviceSessionsError(deviceError instanceof Error ? deviceError.message : String(deviceError));
    } finally {
      setDeviceSessionsLoading(false);
    }
  };

  const revokeDeviceSession = async (deviceId: string) => {
    await service.revokeDeviceSession(deviceId);
    await refreshDeviceSessions();
  };

  const revokeAllDeviceSessions = async () => {
    await service.revokeAllDeviceSessions();
    setDeviceSessions([]);
  };

  const returnToRegistryLogin = () => {
    void androidSpeechRuntimeRef.current?.clearCredential().catch(() => undefined);
    supervisorManagedCloseRef.current = true;
    service.close();
    setConnected(false);
    setReconnecting(false);
    void registryAuthController.check();
  };

  useEffect(() => {
    if (connected && settingsDetailView === 'deviceSessions') {
      void refreshDeviceSessions();
    }
  }, [connected, settingsDetailView]);

  const disconnectForSupervisor = (
    reason: 'background' | 'offline' | 'stop',
  ) => {
    supervisorManagedCloseRef.current = true;
    clearReconnectTimer();
    reconnectStartedAtRef.current = null;
    const shouldKeepWorkspaceVisible =
      reason !== 'stop' && !!projectIdRef.current;
    setReconnecting(shouldKeepWorkspaceVisible);
    setAutoConnecting(false);
    setConnected(false);
    if (reason !== 'stop') {
      setError('');
    }
    service.close();
  };

  const handleRegistryDebugLogout = () => {
    void androidSpeechRuntimeRef.current?.clearCredential().catch(() => undefined);
    supervisorManagedCloseRef.current = true;
    clearReconnectTimer();
    reconnectStartedAtRef.current = null;
    setError('');
    setAutoConnecting(false);
    setReconnecting(false);
    setMessageViewerEnabled(false);
    setConnected(false);
    clearChatRuntimeState();
    service.close();
    void registryAuthController.logout();
  };

  const maybeNotifyPromptCompletion = (
    message: RegistryChatMessage,
    session?: RegistryChatSession,
    activeProjectId = '',
  ) => {
    if (message.method !== 'prompt_done') {
      return;
    }
    const notificationKey = promptCompletionNotificationKey(activeProjectId, message);
    if (notifiedPromptCompletionIdsRef.current.has(notificationKey)) {
      return;
    }
    const documentVisibility =
      typeof document !== 'undefined' ? document.visibilityState : 'hidden';
    if (!shouldNotifyPromptCompletion({
      enabled: promptCompletionNotificationsEnabledRef.current,
      message,
      projectId: activeProjectId,
      selectedRuntimeKey: encodeChatSessionKey(selectedChatKeyRef.current),
      documentVisibility,
      activeTab: tabRef.current,
    })) {
      return;
    }

    notifiedPromptCompletionIdsRef.current.add(notificationKey);
    if (notifiedPromptCompletionIdsRef.current.size > 500) {
      const first = notifiedPromptCompletionIdsRef.current.values().next().value;
      if (first) {
        notifiedPromptCompletionIdsRef.current.delete(first);
      }
    }

    const payload = buildPromptCompletionNotification({
      projectId: activeProjectId,
      message,
      session,
    });
    notificationProvider.show(payload)
      .catch(() => undefined);
  };

  useEffect(() => {
    const supervisor = pwaFoundation.createConnectionSupervisor(
      {
        connect: async () => {
          const canSilentReconnect =
            !!projectIdRef.current;
          if (!canSilentReconnect) {
            return;
          }
          await connect({ silentReconnect: true });
        },
        disconnect: reason => {
          disconnectForSupervisor(reason);
        },
      },
      {
        shouldDisconnectOnBackground: () => !isVoiceInputActive(),
      },
    );
    supervisor.start();
    return () => {
      supervisor.stop();
    };
  }, []);

  useEffect(() => {
    if (connected || autoConnecting) return;
    if (autoConnectTriedRef.current) return;
    if (registryAuth.state !== 'authenticated') return;
    autoConnectTriedRef.current = true;
    setAutoConnecting(true);
    connect().catch(() => {
      setAutoConnecting(false);
    });
  }, [registryAuth.state, autoConnecting, connected]);

  const mergeTokenProviders = useCallback(
    (entries: Array<{hubId: string; projectId?: string; result: RegistryTokenScanResult}>): TokenProviderSectionView[] => {
      const sections = new Map<string, TokenProviderSectionView>();
      for (const entry of entries) {
        const providers = Array.isArray(entry.result.providers) ? entry.result.providers : [];
        for (const provider of providers) {
          const providerId = (provider.id || provider.name || 'unknown').trim().toLowerCase();
          if (!providerId) continue;
          const section = sections.get(providerId) ?? {
            id: providerId,
            name: provider.name || provider.id || providerId,
            accounts: [],
          };
          const accounts = Array.isArray(provider.accounts) ? provider.accounts : [];
          for (const account of accounts) {
            section.accounts.push({
              ...account,
              id: account.id || account.alias || account.displayName || 'account',
              hubId: entry.hubId,
              projectId: entry.projectId ?? '',
              providerId: section.id,
              providerName: section.name,
            });
          }
          sections.set(providerId, section);
        }
      }
      const merged = Array.from(sections.values());
      merged.forEach(section => {
        section.accounts.sort((left, right) => {
          const hubDiff = left.hubId.localeCompare(right.hubId);
          if (hubDiff !== 0) return hubDiff;
          return (left.alias || left.displayName || '').localeCompare(right.alias || right.displayName || '');
        });
      });
      merged.sort((left, right) => left.name.localeCompare(right.name));
      return merged;
    },
    [],
  );

  const tokenTagVariantClass = useCallback((scope: 'agent' | 'hub', value: string): string => {
    return scope === 'agent'
      ? tagVariantClass('token-stats-pill-agent', value)
      : tagVariantClass('token-stats-pill-hub', value);
  }, []);

  const refreshTokenStats = useCallback(async () => {
    setTokenStatsLoading(true);
    setTokenStatsError('');
    try {
      const snapshot = await service.listProjectSnapshot();
      if (snapshot.projects.length > 0) {
        setProjects(snapshot.projects);
      }
      setRegistryHubs(snapshot.hubs);
      const hubIds = deriveRegistryHubIds(snapshot.hubs);
      if (hubIds.length === 0) {
        setTokenStatsProviders([]);
        setTokenStatsUpdatedAt('');
        setTokenStatsError('No hubs available.');
        return;
      }
      const applyTokenStatsResponses = (responses: Array<{hubId: string; projectId?: string; result: RegistryTokenScanResult}>) => {
        setTokenStatsProviders(mergeTokenProviders(responses));
        const latestUpdatedAt = responses
          .map(item => item.result.updatedAt || '')
          .sort((left, right) => right.localeCompare(left))[0] || '';
        setTokenStatsUpdatedAt(latestUpdatedAt);
      };
      const scanResult = await scanTokenStatsAcrossHubs(
        hubIds,
        hubId => service.scanTokenStats(hubId),
        {
          onSuccess: applyTokenStatsResponses,
          onFailure: failures => {
            setTokenStatsError(tokenStatsFailureSummary(failures));
          },
        },
      );
      applyTokenStatsResponses(scanResult.responses);
      setTokenStatsError(tokenStatsFailureSummary(scanResult.failures));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTokenStatsError(message);
    } finally {
      setTokenStatsLoading(false);
    }
  }, [mergeTokenProviders]);

  useEffect(() => {
    if (settingsDetailView !== 'tokenStats') {
      return;
    }
    refreshTokenStats().catch(() => undefined);
  }, [settingsDetailView, refreshTokenStats]);

  const agentPackageActionKey = useCallback((hubId: string, packageName: string): string => {
    return `${hubId}:${packageName}`;
  }, []);

  const refreshProjectHubSnapshot = useCallback(async (): Promise<string[]> => {
    const snapshot = await service.listProjectSnapshot();
    if (snapshot.projects.length > 0) {
      setProjects(snapshot.projects);
    }
    setRegistryHubs(snapshot.hubs);
    return deriveRegistryHubIds(snapshot.hubs);
  }, []);

  const persistPortRelaySettings = useCallback((patch: {
    targets?: PortRelayTarget[];
    selectedTarget?: PortRelayTarget | null;
    listenPort?: string | number;
  }) => {
    const nextListenPort = normalizePortRelayListenPort(
      patch.listenPort ?? portRelayListenPort,
      normalizePortRelayListenPort(portRelayListenPort),
    );
    workspaceStore.rememberGlobalState({
      portRelayTargets: patch.targets ?? portRelayTargets,
      selectedPortRelayTarget: patch.selectedTarget !== undefined ? patch.selectedTarget : selectedPortRelayTarget,
      portRelayListenPort: nextListenPort,
    });
  }, [portRelayListenPort, portRelayTargets, selectedPortRelayTarget]);

  const applyPortRelaySnapshot = useCallback((snapshot: RegistryPortRelaySnapshot) => {
    setPortRelaySnapshot(snapshot);
    if (typeof snapshot.listenPort === 'number') {
      setPortRelayListenPort(String(snapshot.listenPort));
      persistPortRelaySettings({listenPort: snapshot.listenPort});
    }
    if (!snapshot.enabled) {
      return;
    }
    const reconciled = reconcilePortRelayTargetSelection({
      targets: portRelayTargets,
      selectedTarget: selectedPortRelayTarget,
      snapshot,
    });
    if (!samePortRelayTargets(portRelayTargets, reconciled.targets)) {
      setPortRelayTargets(reconciled.targets);
    }
    if (!samePortRelayTarget(selectedPortRelayTarget, reconciled.selectedTarget)) {
      setSelectedPortRelayTarget(reconciled.selectedTarget);
    }
    persistPortRelaySettings({
      targets: reconciled.targets,
      selectedTarget: reconciled.selectedTarget,
      listenPort: snapshot.listenPort,
    });
  }, [persistPortRelaySettings, portRelayTargets, selectedPortRelayTarget]);

  const refreshPortRelayStatus = useCallback(async (options?: {silent?: boolean}) => {
    const silent = options?.silent === true;
    if (!silent) {
      setPortRelayLoading(true);
      setPortRelayError('');
    }
    try {
      const snapshot = await service.getPortRelayStatus();
      applyPortRelaySnapshot(snapshot);
    } catch (err) {
      if (!silent) {
        setPortRelayError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!silent) {
        setPortRelayLoading(false);
      }
    }
  }, [applyPortRelaySnapshot]);

  useEffect(() => {
    if (!connected || !portRelaySnapshot.enabled || portRelaySnapshot.status !== 'Opening') {
      return;
    }
    const timer = window.setInterval(() => {
      refreshPortRelayStatus({silent: true}).catch(() => undefined);
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [connected, portRelaySnapshot.enabled, portRelaySnapshot.status, refreshPortRelayStatus]);

  useEffect(() => {
    if (selectedPortRelayTarget || portRelayTargets.length === 0) {
      return;
    }
    const nextTarget = portRelayTargets[0];
    setSelectedPortRelayTarget(nextTarget);
    persistPortRelaySettings({selectedTarget: nextTarget});
  }, [persistPortRelaySettings, portRelayTargets, selectedPortRelayTarget]);

  useEffect(() => {
    if (settingsDetailView !== 'portRelay') {
      return;
    }
    refreshPortRelayStatus().catch(() => undefined);
  }, [settingsDetailView]);

  useEffect(() => {
    if (settingsDetailView !== 'portRelay' || portRelayAccessCode || portRelaySnapshot.enabled) {
      return;
    }
    setPortRelayAccessCode(generatePortRelayAccessCode());
  }, [portRelayAccessCode, portRelaySnapshot.enabled, settingsDetailView]);

  const commitPortRelayDraftTarget = useCallback((): PortRelayTarget | null => {
    const target = normalizePortRelayTarget({
      hubId: portRelayDraftHubId,
      targetPort: portRelayDraftPort,
    });
    if (!target) {
      return null;
    }
    const nextTargets = upsertPortRelayTarget(portRelayTargets, target);
    setPortRelayTargets(nextTargets);
    setSelectedPortRelayTarget(target);
    setPortRelayDraftHubId('');
    setPortRelayDraftPort('80');
    persistPortRelaySettings({
      targets: nextTargets,
      selectedTarget: target,
    });
    return target;
  }, [persistPortRelaySettings, portRelayDraftHubId, portRelayDraftPort, portRelayTargets]);

  const enablePortRelayForTarget = useCallback(async (
    target: PortRelayTarget | null,
    listenPortValue = portRelayListenPort,
    options: {framePath?: string; openFrame?: boolean} = {},
  ): Promise<RegistryPortRelaySnapshot | null> => {
    const normalizedTarget = normalizePortRelayTarget(target);
    const listenPort = Number(listenPortValue);
    if (portRelayAccessCodeUnknown) {
      setPortRelayError('Access code is unknown on this device. Generate a new code before switching target.');
      return null;
    }
    if (options.framePath !== undefined) {
      setPortRelayFramePath(options.framePath);
    }
    const accessCode = portRelayAccessCode || generatePortRelayAccessCode();
    setPortRelayAccessCode(accessCode);
    if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
      setPortRelayError('Listen port must be in 1..65535.');
      return null;
    }
    if (!normalizedTarget) {
      setPortRelayError('Target is required.');
      return null;
    }
    const nextTargets = upsertPortRelayTarget(portRelayTargets, normalizedTarget);
    setPortRelayTargets(nextTargets);
    setSelectedPortRelayTarget(normalizedTarget);
    persistPortRelaySettings({
      targets: nextTargets,
      selectedTarget: normalizedTarget,
      listenPort,
    });
    setPortRelayLoading(true);
    setPortRelayError('');
    try {
      const snapshot = await service.enablePortRelay({
        listenPort,
        hubId: normalizedTarget.hubId,
        targetHost: '127.0.0.1',
        targetPort: normalizedTarget.targetPort,
        accessCode,
      });
      setPortRelayKnownAccessCodeGeneration(typeof snapshot.accessCodeGeneration === 'number' ? snapshot.accessCodeGeneration : null);
      setPortRelayFrameAutoOpenPending((options.openFrame ?? isWide) && snapshot.enabled);
      applyPortRelaySnapshot(snapshot);
      return snapshot;
    } catch (err) {
      setPortRelayError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setPortRelayLoading(false);
    }
  }, [applyPortRelaySnapshot, isWide, persistPortRelaySettings, portRelayAccessCode, portRelayAccessCodeUnknown, portRelayListenPort, portRelayTargets]);

  const openPortRelayWorkbenchTab = useCallback(async (
    target: PortRelayTarget | null,
    framePath = '',
    _options: {source?: 'chat' | 'settings' | 'floating'} = {},
  ) => {
    const normalizedTarget = normalizePortRelayTarget(target);
    if (!normalizedTarget) {
      setPortRelayError('Target is required.');
      return;
    }
    if (portRelayAccessCodeUnknown) {
      setPortRelayError('Access code is unknown on this device. Generate a new code before opening relay pages.');
      setSidebarSettingsOpen(true);
      setSidebarCollapsed(false);
      setSettingsDetailView('portRelay');
      return;
    }
    const targetProjectId =
      selectedChatKeyRef.current?.projectId ||
      previewWorkbenchRef.current.activeProjectId ||
      projectIdRef.current;
    if (!targetProjectId) {
      setPortRelayError('Project is required to open Port Relay.');
      return;
    }
    const listenPort = Number(portRelayListenPort);
    if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
      setPortRelayError('Listen port must be in 1..65535.');
      setSidebarSettingsOpen(true);
      setSidebarCollapsed(false);
      setSettingsDetailView('portRelay');
      return;
    }
    const tabId = previewTabId({type: 'port-relay', hubId: normalizedTarget.hubId, targetPort: normalizedTarget.targetPort, framePath});
    const tabTitle = `${normalizedTarget.hubId}:${normalizedTarget.targetPort}${framePath || ''}`;
    setPreviewWorkbench(current =>
      openPreviewTab(current, {
        type: 'port-relay',
        projectId: targetProjectId,
        hubId: normalizedTarget.hubId,
        targetPort: normalizedTarget.targetPort,
        framePath,
        title: tabTitle,
        url: portRelayFrameUrl,
        reloadKey: portRelayFrameReloadKey,
      }),
    );
    setChatPreviewManualOpen(false);
    setChatPreviewManualCollapsed(false);
    setPortRelayFramePath(framePath);
    if (!isWide) {
      setDrawerOpen(false);
      setSidebarSettingsOpen(false);
      setChatQuickSwitchMenuOpen(false);
      if (!chatFilePeekHistoryActiveRef.current) {
        window.history.pushState(createChatFilePeekHistoryState(), '', window.location.href);
        chatFilePeekHistoryActiveRef.current = true;
      }
    }
    const activeTarget = normalizePortRelayTarget({
      hubId: portRelaySnapshot.hubId,
      targetPort: portRelaySnapshot.targetPort,
    });
    const activeRelayMatches =
      portRelaySnapshot.enabled &&
      portRelaySnapshot.status !== 'Error' &&
      portRelaySnapshot.listenPort === listenPort &&
      samePortRelayTarget(activeTarget, normalizedTarget);
    if (!activeRelayMatches) {
      await enablePortRelayForTarget(normalizedTarget, portRelayListenPort, {
        framePath,
        openFrame: true,
      });
    }
    setPreviewWorkbench(current =>
      updatePreviewTab(current, targetProjectId, tabId, tab =>
        tab.type === 'port-relay'
          ? {...tab, url: portRelayFrameUrl || tab.url, reloadKey: portRelayFrameReloadKey}
          : tab,
      ),
    );
  }, [
    enablePortRelayForTarget,
    isWide,
    portRelayAccessCodeUnknown,
    portRelayFrameReloadKey,
    portRelayFrameUrl,
    portRelayListenPort,
    portRelaySnapshot.enabled,
    portRelaySnapshot.hubId,
    portRelaySnapshot.listenPort,
    portRelaySnapshot.status,
    portRelaySnapshot.targetPort,
    setDrawerOpen,
    setSidebarCollapsed,
    setSidebarSettingsOpen,
  ]);

  useEffect(() => {
    const tab = activePreviewTab(previewWorkbenchRef.current);
    if (!tab || tab.type !== 'port-relay' || !portRelayFrameUrl) {
      return;
    }
    setPreviewWorkbench(current =>
      updatePreviewTab(current, tab.projectId, tab.id, item =>
        item.type === 'port-relay'
          ? {...item, url: portRelayFrameUrl, reloadKey: portRelayFrameReloadKey}
          : item,
      ),
    );
  }, [portRelayFrameReloadKey, portRelayFrameUrl]);

  const enablePortRelay = useCallback(async () => {
    const target = selectedPortRelayTarget ?? commitPortRelayDraftTarget();
    await openPortRelayWorkbenchTab(target, '', {source: 'settings'});
  }, [commitPortRelayDraftTarget, openPortRelayWorkbenchTab, selectedPortRelayTarget]);

  const disablePortRelay = useCallback(async () => {
    setPortRelayLoading(true);
    setPortRelayError('');
    try {
      const snapshot = await service.disablePortRelay();
      setPortRelayFramePath('');
      applyPortRelaySnapshot(snapshot);
    } catch (err) {
      setPortRelayError(err instanceof Error ? err.message : String(err));
    } finally {
      setPortRelayLoading(false);
    }
  }, [applyPortRelaySnapshot]);

  const regeneratePortRelayAccessCode = useCallback(async () => {
    const accessCode = generatePortRelayAccessCode();
    setPortRelayAccessCode(accessCode);
    setPortRelayCodeCopied(false);
    if (!portRelaySnapshot.enabled) {
      return;
    }
    setPortRelayLoading(true);
    setPortRelayError('');
    try {
      const snapshot = await service.regeneratePortRelayAccessCode(accessCode);
      setPortRelayKnownAccessCodeGeneration(typeof snapshot.accessCodeGeneration === 'number' ? snapshot.accessCodeGeneration : null);
      applyPortRelaySnapshot(snapshot);
    } catch (err) {
      setPortRelayError(err instanceof Error ? err.message : String(err));
    } finally {
      setPortRelayLoading(false);
    }
  }, [applyPortRelaySnapshot, portRelaySnapshot.enabled]);

  const copyPortRelayAccessCode = useCallback(async () => {
    setPortRelayError('');
    try {
      if (portRelayAccessCodeUnknown) {
        setPortRelayCodeCopied(false);
        setPortRelayError('Access code is unknown on this device. Generate a new code before copying.');
        return;
      }
      if (!portRelayAccessCode) {
        const accessCode = generatePortRelayAccessCode();
        setPortRelayAccessCode(accessCode);
        await writeTextToClipboard(accessCode);
      } else {
        await writeTextToClipboard(portRelayAccessCode);
      }
      setPortRelayCodeCopied(true);
      if (portRelayCodeCopyTimerRef.current) {
        window.clearTimeout(portRelayCodeCopyTimerRef.current);
      }
      portRelayCodeCopyTimerRef.current = window.setTimeout(() => {
        setPortRelayCodeCopied(false);
        portRelayCodeCopyTimerRef.current = null;
      }, 1400);
    } catch (err) {
      setPortRelayCodeCopied(false);
      setPortRelayError(err instanceof Error ? err.message : String(err));
    }
  }, [portRelayAccessCode, portRelayAccessCodeUnknown]);

  const clearPortRelaySiteData = useCallback(async () => {
    setPortRelayError('');
    if (!portRelayFrameUrl) {
      setPortRelayError('Relay page is not ready.');
      return;
    }
    if (portRelayAccessCodeUnknown) {
      setPortRelayError('Access code is unknown on this device. Generate a new code before clearing relay cache.');
      return;
    }
    const clearUrl = buildPortRelayClearSiteDataUrl(portRelayFrameUrl, portRelayFrameAccessCode);
    setPortRelayLoading(true);
    try {
      if (portRelayClearSiteDataTimerRef.current) {
        window.clearTimeout(portRelayClearSiteDataTimerRef.current);
        portRelayClearSiteDataTimerRef.current = null;
      }
      setPortRelayClearSiteDataUrl('');
      const nativeResult = await Promise.resolve(getNativeRuntimeBridge()?.clearPortRelaySiteData?.(portRelayFrameUrl));
      if (nativeResult?.ok === false) {
        throw new Error(nativeResult.error || 'Failed to clear relay site data.');
      }
      setPortRelayClearSiteDataUrl(clearUrl);
      await waitForPortRelaySiteDataClear(portRelayFrameUrl);
      setPortRelayFrameReloadKey(key => key + 1);
      const target = activePortRelayTarget ?? selectedPortRelayTarget;
      if (target) {
        openPortRelayWorkbenchTab(target, portRelayFramePath, {source: 'settings'}).catch(() => undefined);
      }
      portRelayClearSiteDataTimerRef.current = window.setTimeout(() => {
        setPortRelayClearSiteDataUrl(current => (current === clearUrl ? '' : current));
        portRelayClearSiteDataTimerRef.current = null;
      }, 5000);
    } catch (err) {
      setPortRelayError(err instanceof Error ? err.message : String(err));
    } finally {
      setPortRelayLoading(false);
    }
  }, [
    activePortRelayTarget,
    openPortRelayWorkbenchTab,
    portRelayAccessCodeUnknown,
    portRelayFrameAccessCode,
    portRelayFramePath,
    portRelayFrameUrl,
    selectedPortRelayTarget,
  ]);

  const selectPortRelayTarget = useCallback(async (target: PortRelayTarget) => {
    setSelectedPortRelayTarget(target);
    persistPortRelaySettings({selectedTarget: target});
    if (!portRelaySnapshot.enabled || samePortRelayTarget(selectedPortRelayTarget, target)) {
      return;
    }
    await enablePortRelayForTarget(target, String(portRelaySnapshot.listenPort || portRelayListenPort), {framePath: ''});
  }, [
    enablePortRelayForTarget,
    persistPortRelaySettings,
    portRelayListenPort,
    portRelaySnapshot.enabled,
    portRelaySnapshot.listenPort,
    selectedPortRelayTarget,
  ]);

  const handleMobilePortRelayTargetMenuSelect = useCallback(async (target: PortRelayTarget) => {
    setPortRelayTargetMenuOpen(false);
    if (samePortRelayTarget(activePortRelayTarget, target)) {
      return;
    }
    setPortRelayMenuSwitchingTarget(target);
    try {
      await openPortRelayWorkbenchTab(target, '', {source: 'floating'});
    } finally {
      setPortRelayMenuSwitchingTarget(null);
    }
  }, [
    activePortRelayTarget,
    openPortRelayWorkbenchTab,
  ]);
  const handlePortRelayFloatingTargetSelect = useCallback((target: PortRelayTarget) => {
    handleMobilePortRelayTargetMenuSelect(target).catch(() => undefined);
  }, [handleMobilePortRelayTargetMenuSelect]);

  const deletePortRelayTarget = useCallback(async (target: PortRelayTarget) => {
    const nextTargets = removePortRelayTarget(portRelayTargets, target);
    const deletingSelected = samePortRelayTarget(selectedPortRelayTarget, target);
    const nextSelectedTarget = deletingSelected ? nextTargets[0] ?? null : selectedPortRelayTarget;
    setPortRelayTargets(nextTargets);
    setSelectedPortRelayTarget(nextSelectedTarget);
    persistPortRelaySettings({
      targets: nextTargets,
      selectedTarget: nextSelectedTarget,
    });
    if (!deletingSelected || !portRelaySnapshot.enabled) {
      return;
    }
    setPortRelayLoading(true);
    setPortRelayError('');
    try {
      const snapshot = await service.disablePortRelay();
      setPortRelayFramePath('');
      setPortRelayFrameAutoOpenPending(false);
      applyPortRelaySnapshot(snapshot);
    } catch (err) {
      setPortRelayError(err instanceof Error ? err.message : String(err));
    } finally {
      setPortRelayLoading(false);
    }
  }, [applyPortRelaySnapshot, persistPortRelaySettings, portRelaySnapshot.enabled, portRelayTargets, selectedPortRelayTarget]);

  const openChatPortRelayLink = useCallback(async (localUrl: PortRelayLocalHttpUrl) => {
    const hubId = currentProject?.hubId || '';
    if (!hubId) {
      setError('Current project has no hub for Port Relay.');
      return;
    }
    const target: PortRelayTarget = {
      hubId,
      targetPort: localUrl.targetPort,
    };
    const nextTargets = upsertPortRelayTarget(portRelayTargets, target);
    setPortRelayTargets(nextTargets);
    setSelectedPortRelayTarget(target);
    persistPortRelaySettings({
      targets: nextTargets,
      selectedTarget: target,
      listenPort: Number(portRelayListenPort),
    });
    await openPortRelayWorkbenchTab(target, localUrl.path, {source: 'chat'});
  }, [
    currentProject?.hubId,
    openPortRelayWorkbenchTab,
    persistPortRelaySettings,
    portRelayListenPort,
    portRelayTargets,
  ]);

  const handleDesktopPortRelaySelect = useCallback(() => {
    if (sidebarSettingsOpen && settingsDetailView === 'portRelay') {
      closeSettingsPanel();
      return;
    }
    openSettingsPeer('portRelay');
    const target = activePortRelayTarget ?? selectedPortRelayTarget;
    if (target) {
      openPortRelayWorkbenchTab(target, portRelayFramePath, {source: 'settings'}).catch(() => undefined);
    }
  }, [
    activePortRelayTarget,
    closeSettingsPanel,
    openPortRelayWorkbenchTab,
    openSettingsPeer,
    portRelayFramePath,
    selectedPortRelayTarget,
    settingsDetailView,
    sidebarSettingsOpen,
  ]);

  const handlePortRelayFloatingToggle = useCallback(() => {
    if (floatingClickCooldownUntilRef.current > Date.now()) {
      return;
    }
    setPortRelayTargetMenuOpen(false);
    const target = activePortRelayTarget ?? selectedPortRelayTarget;
    if (!target) {
      openSettingsDetail('portRelay');
      return;
    }
    openPortRelayWorkbenchTab(target, portRelayFramePath, {source: 'floating'}).catch(() => undefined);
  }, [
    activePortRelayTarget,
    openPortRelayWorkbenchTab,
    openSettingsDetail,
    portRelayFramePath,
    selectedPortRelayTarget,
  ]);

  const updateHubCards = useMemo(() => {
    const hubIds = new Set<string>([
      ...deriveRegistryHubIds(registryHubs),
      ...Object.keys(wheelMakerUpdateHubs),
      ...Object.keys(agentPackageHubs),
      ...Object.keys(projectIndexByHubId),
    ]);
    return Array.from(hubIds).sort((left, right) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    }).map(hubId => ({
      hubId,
      wheelMaker: wheelMakerUpdateHubs[hubId] ?? null,
      agentPackage: agentPackageHubs[hubId] ?? null,
      projectIndex: projectIndexByHubId[hubId] ?? null,
    }));
  }, [agentPackageHubs, projectIndexByHubId, registryHubs, wheelMakerUpdateHubs]);

  const agentPackageHubCards = useMemo(() => {
    return Object.values(agentPackageHubs).sort((left, right) => {
      if (left.hubId < right.hubId) return -1;
      if (left.hubId > right.hubId) return 1;
      return 0;
    });
  }, [agentPackageHubs]);

  const clearWheelMakerUpdatePollTimer = useCallback(() => {
    if (wheelMakerUpdatePollTimerRef.current) {
      window.clearTimeout(wheelMakerUpdatePollTimerRef.current);
      wheelMakerUpdatePollTimerRef.current = null;
    }
    wheelMakerUpdatePollHubIdsRef.current.clear();
  }, []);

  const clearAgentPackageScanPollTimer = useCallback(() => {
    if (agentPackageScanPollTimerRef.current) {
      window.clearTimeout(agentPackageScanPollTimerRef.current);
      agentPackageScanPollTimerRef.current = null;
    }
  }, []);

  const clearProjectIndexPollTimer = useCallback(() => {
    if (projectIndexPollTimerRef.current) {
      window.clearTimeout(projectIndexPollTimerRef.current);
      projectIndexPollTimerRef.current = null;
    }
  }, []);

  const scheduleProjectIndexPoll = useCallback((hubIds: string | string[]) => {
    const ids = (Array.isArray(hubIds) ? hubIds : [hubIds])
      .map(hubId => hubId.trim())
      .filter(Boolean);
    if (ids.length === 0 || projectIndexPollTimerRef.current) {
      return;
    }
    projectIndexPollTimerRef.current = window.setTimeout(() => {
      projectIndexPollTimerRef.current = null;
      refreshProjectFileIndexesRef.current?.(ids, {silent: true}).catch(() => undefined);
    }, 1000);
  }, []);

  const scheduleWheelMakerUpdatePoll = useCallback((hubIds: string | string[]) => {
    const ids = Array.isArray(hubIds) ? hubIds : [hubIds];
    ids
      .map(hubId => hubId.trim())
      .filter(Boolean)
      .forEach(hubId => wheelMakerUpdatePollHubIdsRef.current.add(hubId));
    if (wheelMakerUpdatePollTimerRef.current) {
      return;
    }
    wheelMakerUpdatePollTimerRef.current = window.setTimeout(() => {
      wheelMakerUpdatePollTimerRef.current = null;
      const pendingHubIds = Array.from(wheelMakerUpdatePollHubIdsRef.current);
      wheelMakerUpdatePollHubIdsRef.current.clear();
      if (settingsDetailViewRef.current !== 'update') {
        return;
      }
      Promise.all(pendingHubIds.map(hubId => refreshWheelMakerUpdateHubRef.current?.(hubId, {silent: true}))).catch(() => undefined);
    }, WHEELMAKER_UPDATE_REMOTE_POLL_DELAY_MS);
  }, []);

  const refreshWheelMakerUpdateHub = useCallback(async (hubId: string, options: {force?: boolean; silent?: boolean} = {}) => {
    if (!options.silent) {
      setWheelMakerUpdateHubs(prev => ({
        ...prev,
        [hubId]: {
          ...(prev[hubId] ?? {hubId, loading: false, error: '', data: null}),
          loading: true,
          error: '',
        },
      }));
    }
    try {
      const result = await service.queryWheelMakerUpdate(hubId, options);
      setWheelMakerUpdateHubs(prev => ({
        ...prev,
        [hubId]: {
          hubId,
          loading: false,
          error: result.ok ? '' : result.error || 'Update check failed.',
          data: result,
        },
      }));
      if (!options.force && result.remoteRefreshRunning) {
        scheduleWheelMakerUpdatePoll(hubId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setWheelMakerUpdateHubs(prev => ({
        ...prev,
        [hubId]: {
          ...(prev[hubId] ?? {hubId, loading: false, error: '', data: null}),
          loading: false,
          error: message,
        },
      }));
    }
  }, [scheduleWheelMakerUpdatePoll]);

  const refreshWheelMakerUpdates = useCallback(async (options: {force?: boolean} = {}) => {
    if (options.force) {
      clearWheelMakerUpdatePollTimer();
    }
    setWheelMakerUpdatesLoading(true);
    setWheelMakerUpdatesError('');
    try {
      const hubIds = await refreshProjectHubSnapshot();
      if (hubIds.length === 0) {
        setWheelMakerUpdateHubs({});
        setWheelMakerUpdatesError('No hubs available.');
        return;
      }
      setWheelMakerUpdateHubs(prev => {
        const next: Record<string, WheelMakerUpdateHubView> = {};
        hubIds.forEach(hubId => {
          next[hubId] = {
            hubId,
            loading: true,
            error: '',
            data: prev[hubId]?.data ?? null,
          };
        });
        return next;
      });
      await Promise.all(hubIds.map(async hubId => {
        try {
          const result = await service.queryWheelMakerUpdate(hubId, options);
          setWheelMakerUpdateHubs(prev => ({
            ...prev,
            [hubId]: {
              hubId,
              loading: false,
              error: result.ok ? '' : result.error || 'Update check failed.',
              data: result,
            },
          }));
          if (!options.force && result.remoteRefreshRunning) {
            scheduleWheelMakerUpdatePoll(hubId);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setWheelMakerUpdateHubs(prev => ({
            ...prev,
            [hubId]: {
              ...(prev[hubId] ?? {hubId, loading: false, error: '', data: null}),
              loading: false,
              error: message,
            },
          }));
        }
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setWheelMakerUpdatesError(message);
    } finally {
      setWheelMakerUpdatesLoading(false);
    }
  }, [clearWheelMakerUpdatePollTimer, refreshProjectHubSnapshot, scheduleWheelMakerUpdatePoll]);

  const refreshAndroidApkUpdate = useCallback(async () => {
    const supported = androidApkUpdateBridge.isSupported();
    setAndroidApkUpdateSupported(supported);
    if (!supported) {
      setAndroidApkLocalRelease(null);
      setAndroidApkLatestRelease(null);
      setAndroidApkUpdateError('');
      setAndroidApkInstallStatus('');
      return;
    }
    setAndroidApkUpdateLoading(true);
    setAndroidApkUpdateError('');
    try {
      const local = await androidApkUpdateBridge.getLocalRelease();
      setAndroidApkLocalRelease(local);
      const response = await fetch(GITHUB_ANDROID_LATEST_RELEASE_API, {
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
        },
      });
      if (!response.ok) {
        throw new Error(`GitHub release check failed (${response.status})`);
      }
      const latest = parseAndroidLatestRelease(await response.json());
      if (!latest) {
        throw new Error('Latest Android APK release asset not found.');
      }
      setAndroidApkLatestRelease(latest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAndroidApkUpdateError(message);
    } finally {
      setAndroidApkUpdateLoading(false);
    }
  }, [androidApkUpdateBridge]);

  const requestAndroidApkInstall = useCallback(async () => {
    if (!androidApkLatestRelease?.apk.downloadUrl) {
      setAndroidApkUpdateError('Latest Android APK release asset not found.');
      return;
    }
    setAndroidApkInstallPending(true);
    setAndroidApkInstallStatus('');
    setAndroidApkUpdateError('');
    try {
      const result: AndroidApkInstallResult = await androidApkUpdateBridge.installLatest({
        downloadUrl: androidApkLatestRelease.apk.downloadUrl,
        expectedSha256: androidApkLatestRelease.apk.sha256,
        expectedSize: androidApkLatestRelease.apk.size,
        tagName: androidApkLatestRelease.tagName,
      });
      setAndroidApkInstallStatus(result.status || '');
      if (!result.ok) {
        throw new Error(result.error || 'APK install request failed.');
      }
      if (result.status === 'permission_required') {
        setAndroidApkInstallPending(false);
        setAndroidApkUpdateError('Install permission required. Enable Install unknown apps, then retry.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAndroidApkInstallPending(false);
      setAndroidApkUpdateError(message);
    }
  }, [androidApkLatestRelease, androidApkUpdateBridge]);

  useEffect(() => {
    refreshWheelMakerUpdateHubRef.current = refreshWheelMakerUpdateHub;
  }, [refreshWheelMakerUpdateHub]);

  const refreshAgentPackages = useCallback(async (options: {silent?: boolean} = {}) => {
    clearAgentPackageScanPollTimer();
    if (!options.silent) {
      setAgentPackagesLoading(true);
      setAgentPackagesError('');
    }
    try {
      const hubIds = await refreshProjectHubSnapshot();
      if (hubIds.length === 0) {
        setAgentPackageHubs({});
        setAgentPackagesError('No hubs available.');
        return;
      }
      setAgentPackageHubs(prev => {
        const next: Record<string, AgentPackageHubView> = {};
        hubIds.forEach(hubId => {
          next[hubId] = {
            hubId,
            loading: !options.silent,
            error: '',
            updatedAt: prev[hubId]?.updatedAt || '',
            hub: prev[hubId]?.hub ?? null,
            operation: prev[hubId]?.operation ?? null,
          };
        });
        return next;
      });
      const runningHubIds = new Set<string>();
      await Promise.all(hubIds.map(async hubId => {
        try {
          const result = await withAgentPackageTimeout(
            service.scanNpmPackages(hubId),
            AGENT_PACKAGE_SCAN_TIMEOUT_MS,
            `${hubId} npm package scan timed out`,
          );
          const hub = result.hub ?? {
            hubId,
            nodeVersion: '',
            npmVersion: '',
            npmPrefix: '',
            warning: '',
            error: '',
            packages: [],
          };
          setAgentPackageHubs(prev => ({
            ...prev,
            [hubId]: {
              hubId,
              loading: false,
              error: result.ok ? '' : hub.error || 'Scan failed.',
              updatedAt: result.updatedAt || '',
              hub,
              operation: result.operation ?? prev[hubId]?.operation ?? null,
            },
          }));
          if (result.operation?.running) {
            runningHubIds.add(hubId);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setAgentPackageHubs(prev => ({
            ...prev,
            [hubId]: {
              hubId,
              loading: false,
              error: message,
              updatedAt: prev[hubId]?.updatedAt || '',
              hub: prev[hubId]?.hub ?? null,
              operation: prev[hubId]?.operation ?? null,
            },
          }));
        }
      }));
      if (runningHubIds.size > 0) {
        agentPackageScanPollTimerRef.current = window.setTimeout(() => {
          agentPackageScanPollTimerRef.current = null;
          if (settingsDetailViewRef.current !== 'update') {
            return;
          }
          refreshAgentPackagesRef.current?.({silent: true}).catch(() => undefined);
        }, 1000);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAgentPackagesError(message);
    } finally {
      if (!options.silent) {
        setAgentPackagesLoading(false);
      }
    }
  }, [clearAgentPackageScanPollTimer, refreshProjectHubSnapshot]);

  const refreshProjectFileIndexes = useCallback(async (hubIds: string | string[], options: {silent?: boolean} = {}) => {
    const ids = (Array.isArray(hubIds) ? hubIds : [hubIds])
      .map(hubId => hubId.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      setProjectIndexByHubId({});
      return;
    }
    clearProjectIndexPollTimer();
    if (!options.silent) {
      setProjectIndexLoading(true);
      setProjectIndexError('');
    }
    try {
      const errorsByHubId: Record<string, string> = {};
      const runningHubIds = new Set<string>();
      await Promise.all(ids.map(async hubId => {
        try {
          const result = await service.getFileIndexStatus(hubId);
          setProjectIndexByHubId(prev => ({
            ...prev,
            [hubId]: {
              hubId: result.hubId ?? hubId,
              projects: result.projects ?? [],
            },
          }));
          const completedProjectIds = (result.projects ?? [])
            .filter(project => project.projectId && project.running !== true && project.status !== 'scanning')
            .map(project => project.projectId);
          if (completedProjectIds.length > 0) {
            setProjectIndexScanPendingByProjectId(prev => {
              let changed = false;
              const next = {...prev};
              completedProjectIds.forEach(projectId => {
                if (next[projectId]) {
                  next[projectId] = false;
                  changed = true;
                }
              });
              return changed ? next : prev;
            });
          }
          if ((result.projects ?? []).some(project => project.running === true || project.status === 'scanning')) {
            runningHubIds.add(hubId);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errorsByHubId[hubId] = message;
          setProjectIndexByHubId(prev => ({
            ...prev,
            [hubId]: prev[hubId] ?? {hubId, projects: []},
          }));
        }
      }));
      setProjectIndexError(ids.map(hubId => errorsByHubId[hubId]).find(Boolean) || '');
      if (runningHubIds.size > 0) {
        scheduleProjectIndexPoll(Array.from(runningHubIds));
      }
    } finally {
      if (!options.silent) {
        setProjectIndexLoading(false);
      }
    }
  }, [clearProjectIndexPollTimer, scheduleProjectIndexPoll]);

  useEffect(() => {
    refreshWheelMakerUpdatesRef.current = refreshWheelMakerUpdates;
  }, [refreshWheelMakerUpdates]);

  useEffect(() => {
    refreshAgentPackagesRef.current = refreshAgentPackages;
  }, [refreshAgentPackages]);

  useEffect(() => {
    refreshProjectFileIndexesRef.current = refreshProjectFileIndexes;
  }, [refreshProjectFileIndexes]);

  useEffect(() => {
    refreshAndroidApkUpdateRef.current = refreshAndroidApkUpdate;
  }, [refreshAndroidApkUpdate]);

  useEffect(() => {
    if (settingsDetailView !== 'update') {
      clearWheelMakerUpdatePollTimer();
      clearAgentPackageScanPollTimer();
      clearProjectIndexPollTimer();
      return;
    }
    refreshWheelMakerUpdatesRef.current?.().catch(() => undefined);
    refreshAgentPackagesRef.current?.().catch(() => undefined);
    refreshProjectHubSnapshot()
      .then(hubIds => refreshProjectFileIndexesRef.current?.(hubIds))
      .catch(() => undefined);
    refreshAndroidApkUpdateRef.current?.().catch(() => undefined);
    return () => {
      clearWheelMakerUpdatePollTimer();
      clearAgentPackageScanPollTimer();
      clearProjectIndexPollTimer();
    };
  }, [clearAgentPackageScanPollTimer, clearProjectIndexPollTimer, clearWheelMakerUpdatePollTimer, refreshProjectHubSnapshot, settingsDetailView]);

  useEffect(() => {
    if (!androidApkUpdateSupported) {
      return undefined;
    }
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{status?: string; error?: string}>).detail ?? {};
      const status = detail.status || '';
      if (status) {
        setAndroidApkInstallStatus(status);
      }
      if (status === 'failed') {
        setAndroidApkInstallPending(false);
        setAndroidApkUpdateError(detail.error || 'APK install failed.');
      } else if (status === 'permission_required') {
        setAndroidApkInstallPending(false);
        setAndroidApkUpdateError('Install permission required. Enable Install unknown apps, then retry.');
      } else if (status === 'installing') {
        setAndroidApkInstallPending(false);
      }
    };
    window.addEventListener('wheelmaker:android-apk-update', listener);
    return () => window.removeEventListener('wheelmaker:android-apk-update', listener);
  }, [androidApkUpdateSupported]);

  const clearSkillOperationPollTimer = useCallback(() => {
    if (skillOperationPollTimerRef.current) {
      window.clearTimeout(skillOperationPollTimerRef.current);
      skillOperationPollTimerRef.current = null;
    }
    skillOperationPollHubIdsRef.current.clear();
  }, []);

  const scheduleSkillOperationPoll = useCallback((hubIds: string | string[]) => {
    const ids = Array.isArray(hubIds) ? hubIds : [hubIds];
    ids
      .map(hubId => hubId.trim())
      .filter(Boolean)
      .forEach(hubId => skillOperationPollHubIdsRef.current.add(hubId));
    if (skillOperationPollTimerRef.current) {
      return;
    }
    skillOperationPollTimerRef.current = window.setTimeout(() => {
      skillOperationPollTimerRef.current = null;
      const pendingHubIds = Array.from(skillOperationPollHubIdsRef.current);
      skillOperationPollHubIdsRef.current.clear();
      Promise.all(pendingHubIds.map(hubId => refreshSkillManagementHubRef.current?.(hubId))).catch(() => undefined);
    }, 1000);
  }, []);

  const refreshSkillManagementHub = useCallback(async (hubId: string) => {
    setSkillHubs(prev => ({
      ...prev,
      [hubId]: {
        ...(prev[hubId] ?? {hubId, loading: false, error: '', data: null}),
        loading: true,
        error: '',
      },
    }));
    try {
      const result = await service.scanSkills(hubId);
      setSkillHubs(prev => ({
        ...prev,
        [hubId]: {
          hubId,
          loading: false,
          data: result,
          error: result.ok ? '' : skillCommandErrorMessage(result),
        },
      }));
      if (result.operation?.running) {
        scheduleSkillOperationPoll(hubId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSkillHubs(prev => ({
        ...prev,
        [hubId]: {
          ...(prev[hubId] ?? {hubId, loading: false, error: '', data: null}),
          loading: false,
          error: message,
        },
      }));
    }
  }, [scheduleSkillOperationPoll]);

  const refreshSkillManagement = useCallback(async () => {
    clearSkillOperationPollTimer();
    setSkillsLoading(true);
    setSkillsError('');
    try {
      const snapshot = await service.listProjectSnapshot();
      if (snapshot.projects.length > 0) {
        setProjects(snapshot.projects);
      }
      setRegistryHubs(snapshot.hubs);
      const hubIds = deriveSkillHubIds(snapshot.hubs);
      if (hubIds.length === 0) {
        setSkillHubs({});
        setSkillsError('No hubs available.');
        return;
      }
      setSkillHubs(prev => {
        const next: Record<string, SkillHubView> = {};
        hubIds.forEach(hubId => {
          next[hubId] = {
            hubId,
            loading: true,
            error: '',
            data: prev[hubId]?.data ?? null,
          };
        });
        return next;
      });
      const runningHubIds = new Set<string>();
      await Promise.all(hubIds.map(async hubId => {
        try {
          const result = await service.scanSkills(hubId);
          setSkillHubs(prev => ({
            ...prev,
            [hubId]: {
              hubId,
              loading: false,
              error: result.ok ? '' : skillCommandErrorMessage(result),
              data: result,
            },
          }));
          if (result.operation?.running) {
            runningHubIds.add(hubId);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setSkillHubs(prev => ({
            ...prev,
            [hubId]: {
              hubId,
              loading: false,
              error: message || 'Skills scan failed.',
              data: prev[hubId]?.data ?? null,
            },
          }));
        }
      }));
      if (runningHubIds.size > 0) {
        scheduleSkillOperationPoll(Array.from(runningHubIds));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSkillsError(message);
    } finally {
      setSkillsLoading(false);
    }
  }, [clearSkillOperationPollTimer, scheduleSkillOperationPoll]);

  refreshSkillManagementHubRef.current = refreshSkillManagementHub;

  useEffect(() => () => {
    clearSkillOperationPollTimer();
  }, [clearSkillOperationPollTimer]);

  useEffect(() => {
    if (settingsDetailView !== 'skills') {
      return;
    }
    refreshSkillManagement().catch(() => undefined);
  }, [settingsDetailView, refreshSkillManagement]);

  const requestSkillInstall = useCallback((target: SkillInstallTarget) => {
    const sameTarget = sameSkillInstallTarget(skillInstallTarget, target);
    setSkillInstallTarget(target);
    if (!sameTarget) {
      setSkillSourceError('');
      setSkillSourceCandidates([]);
      setSkillSourceSelectedNames([]);
    }
  }, [skillInstallTarget]);

  const closeSkillInstallPanel = useCallback(() => {
    setSkillInstallTarget(null);
    setSkillSourceError('');
    setSkillSourceCandidates([]);
    setSkillSourceSelectedNames([]);
  }, []);

  const toggleSkillSourceCandidate = useCallback((name: string) => {
    setSkillSourceSelectedNames(prev => (
      prev.includes(name)
        ? prev.filter(item => item !== name)
        : [...prev, name]
    ));
  }, []);

  const toggleAllSkillSourceCandidates = useCallback(() => {
    const candidateNames = Array.from(new Set(skillSourceCandidates
      .map(candidate => candidate.name)
      .filter(Boolean)));
    setSkillSourceSelectedNames(prev => {
      const selected = new Set(prev);
      const allSelected = candidateNames.length > 0 && candidateNames.every(name => selected.has(name));
      return allSelected ? [] : candidateNames;
    });
  }, [skillSourceCandidates]);

  const listSkillSource = useCallback(async () => {
    const target = skillInstallTarget;
    const sourceInput = parseSkillSourceInput(skillSourceInput);
    const source = sourceInput.source;
    if (!target || !source) {
      setSkillSourceError('Source is required.');
      return;
    }
    setSkillSourceLoading(true);
    setSkillSourceError('');
    try {
      const result = await service.listSkillsSource(target.hubId, source);
      if (!result.ok) {
        throw new Error(skillCommandErrorMessage(result));
      }
      const candidates = result.candidates ?? [];
      if (sourceInput.skillNames.length === 0) {
        setSkillSourceCandidates(candidates);
        setSkillSourceSelectedNames([]);
        return;
      }
      const candidateByName = new Map(candidates.map(candidate => [candidate.name, candidate]));
      const filteredCandidates = sourceInput.skillNames
        .map(name => candidateByName.get(name))
        .filter((candidate): candidate is RegistrySkillSourceCandidate => !!candidate);
      const foundNames = new Set(filteredCandidates.map(candidate => candidate.name));
      const missingNames = sourceInput.skillNames.filter(name => !foundNames.has(name));
      setSkillSourceCandidates(filteredCandidates);
      setSkillSourceSelectedNames(filteredCandidates.map(candidate => candidate.name));
      if (missingNames.length > 0) {
        setSkillSourceError(`Skill not found in source: ${missingNames.join(', ')}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSkillSourceError(message);
    } finally {
      setSkillSourceLoading(false);
    }
  }, [skillInstallTarget, skillSourceInput]);

  const requestSkillInstallConfirm = useCallback(() => {
    const target = skillInstallTarget;
    const source = parseSkillSourceInput(skillSourceInput).source;
    const skills = skillSourceSelectedNames;
    if (!target || !source) {
      setSkillSourceError('Source is required.');
      return;
    }
    if (skills.length === 0) {
      setSkillSourceError('Select at least one skill.');
      return;
    }
    setConfirmError('');
    setConfirmTarget({
      kind: 'skillInstall',
      hubId: target.hubId,
      scope: target.scope,
      projectName: target.projectName,
      source,
      skills,
    });
  }, [skillInstallTarget, skillSourceInput, skillSourceSelectedNames]);

  const requestSkillUninstall = useCallback((target: {hubId: string; scope: RegistrySkillScope; projectName?: string; skillName: string}) => {
    setConfirmError('');
    setConfirmTarget({kind: 'skillUninstall', ...target});
  }, []);

  const requestSkillBatchUninstall = useCallback((target: {hubId: string; scope: RegistrySkillScope; projectName?: string; skillNames: string[]}) => {
    if (target.skillNames.length === 0) {
      return;
    }
    setConfirmError('');
    setConfirmTarget({kind: 'skillBatchUninstall', ...target});
  }, []);

  const closeSkillDetail = useCallback(() => {
    setSkillDetailTarget(null);
    if (!isWide && settingsDetailViewRef.current === 'skillDetail') {
      setSettingsDetailView('skills');
    }
  }, [isWide]);

  const requestSkillDetail = useCallback(async (target: SkillDetailTarget) => {
    const cacheKey = skillDetailCacheKey(target);
    setSkillDetailTarget(target);
    if (!isWide) {
      setSidebarSettingsOpen(true);
      setSettingsDetailView('skillDetail');
    }
    const cached = skillDetailCache[cacheKey];
    if (cached?.detail || cached?.loading) {
      return;
    }
    setSkillDetailCache(prev => ({
      ...prev,
      [cacheKey]: {
        loading: true,
        error: '',
        detail: prev[cacheKey]?.detail ?? null,
      },
    }));
    try {
      const result = await service.getSkillDetail(target);
      if (!result.ok || !result.detail) {
        throw new Error(skillCommandErrorMessage(result));
      }
      setSkillDetailCache(prev => ({
        ...prev,
        [cacheKey]: {
          loading: false,
          error: '',
          detail: result.detail ?? null,
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSkillDetailCache(prev => ({
        ...prev,
        [cacheKey]: {
          loading: false,
          error: message,
          detail: prev[cacheKey]?.detail ?? null,
        },
      }));
    }
  }, [isWide, setSidebarSettingsOpen, skillDetailCache]);

  const requestSkillUpdate = useCallback((target: {hubId: string; scope: RegistrySkillScope; projectName?: string; includeProjects?: boolean}) => {
    setConfirmError('');
    setConfirmTarget({kind: 'skillUpdate', ...target});
  }, []);

  const handleSkillConfirmedAction = useCallback(async (
    target: Extract<ConfirmTarget, {kind: 'skillInstall' | 'skillUninstall' | 'skillBatchUninstall' | 'skillUpdate'}>,
  ) => {
    const pendingKey = skillActionPendingKey({
      hubId: target.hubId,
      scope: target.scope,
      projectName: target.projectName,
      skillName: target.kind === 'skillUninstall' ? target.skillName : undefined,
      action: target.kind,
    });
    setConfirmError('');
    setSkillsPendingKey(pendingKey);
    try {
      let results: RegistrySkillCommandResponse[] = [];
      if (target.kind === 'skillInstall') {
        results = [await service.installSkills({
          hubId: target.hubId,
          scope: target.scope,
          projectName: target.projectName,
          source: target.source,
          skills: target.skills,
        })];
      } else if (target.kind === 'skillUninstall') {
        results = [await service.uninstallSkills({
          hubId: target.hubId,
          scope: target.scope,
          projectName: target.projectName,
          skills: [target.skillName],
        })];
      } else if (target.kind === 'skillBatchUninstall') {
        results = [await service.uninstallSkills({
          hubId: target.hubId,
          scope: target.scope,
          projectName: target.projectName,
          skills: target.skillNames,
        })];
      } else {
        results = [await service.updateSkills({
          hubId: target.hubId,
          scope: target.scope,
          projectName: target.projectName,
          includeProjects: target.includeProjects,
        })];
      }
      const failed = results.find(result => !result.ok);
      if (failed) {
        throw new Error(skillCommandErrorMessage(failed));
      }
      setConfirmTarget(null);
      setConfirmError('');
      if (target.kind === 'skillInstall') {
        setSkillInstallTarget(null);
        setSkillSourceCandidates([]);
        setSkillSourceSelectedNames([]);
      }
      await refreshSkillManagementHub(target.hubId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmError(message);
      setSkillsError(message);
      setError(message);
    } finally {
      setSkillsPendingKey('');
    }
  }, [refreshSkillManagementHub]);

  const requestAgentPackageAction = useCallback((
    action: 'install' | 'update' | 'uninstall',
    hubId: string,
    pkg: RegistryNpmPackage,
  ) => {
    setConfirmError('');
    setConfirmTarget({
      kind: 'npmPackage',
      action,
      hubId,
      packageName: pkg.packageName,
      displayName: pkg.displayName,
      installedVersion: pkg.installedVersion,
      latestVersion: pkg.latestVersion,
    });
  }, []);

  const requestAgentPackageHubUpdate = useCallback((hubId: string, packages: NpmPackageUpdateTarget[]) => {
    if (packages.length === 0) {
      return;
    }
    setConfirmError('');
    setConfirmTarget({
      kind: 'npmPackageHubUpdate',
      hubId,
      packages,
    });
  }, []);

  const requestWheelMakerUpdatePublish = useCallback((hubId: string, data: RegistryWheelMakerUpdateResponse | null) => {
    setConfirmError('');
    setConfirmTarget({
      kind: 'wheelMakerUpdate',
      hubId,
      currentSha: data?.release?.sha || data?.git?.currentSha || '',
      latestSha: data?.git?.latestSha || '',
      behindCount: data?.git?.behindCount ?? 0,
    });
  }, []);

  const requestWheelMakerUpdateAll = useCallback((hubIds: string[]) => {
    const uniqueHubIds = Array.from(new Set(hubIds.filter(Boolean))).sort();
    if (uniqueHubIds.length === 0) {
      return;
    }
    setConfirmError('');
    setConfirmTarget({
      kind: 'wheelMakerUpdateAll',
      hubIds: uniqueHubIds,
    });
  }, []);

  const handleScanProjectIndex = useCallback(async (hubId: string, projectId: string) => {
    if (!hubId || !projectId || projectIndexScanPendingByProjectId[projectId]) {
      return;
    }
    setProjectIndexError('');
    setProjectIndexErrorByProjectId(prev => ({...prev, [projectId]: ''}));
    setProjectIndexScanPendingByProjectId(prev => ({...prev, [projectId]: true}));
    let scanRunning = false;
    try {
      const result = await service.rebuildFileIndex(projectId);
      if (!result.ok) {
        throw new Error(result.error || 'Project index scan failed.');
      }
      scanRunning = result.running === true;
      await refreshProjectFileIndexes(hubId, {silent: true});
      if (scanRunning) {
        scheduleProjectIndexPoll(hubId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setProjectIndexError(message);
      setProjectIndexErrorByProjectId(prev => ({...prev, [projectId]: message}));
      setError(message);
    } finally {
      if (!scanRunning) {
        setProjectIndexScanPendingByProjectId(prev => ({...prev, [projectId]: false}));
      }
    }
  }, [projectIndexScanPendingByProjectId, refreshProjectFileIndexes, scheduleProjectIndexPoll]);

  const handlePreviewProjectIndexRebuild = useCallback(async (projectId: string) => {
    const project = projects.find(item => item.projectId === projectId);
    const hubId = project?.hubId || projectId.split(':', 1)[0] || 'local';
    await handleScanProjectIndex(hubId, projectId);
  }, [handleScanProjectIndex, projects]);

  const handleScanAllProjectIndexes = useCallback(async (hubId: string, projectIndexProjects: RegistryFileIndexStatus[]) => {
    const targets = projectIndexProjects.filter(project => project.projectId);
    if (!hubId || targets.length === 0 || projectIndexScanAllPendingByHubId[hubId]) {
      return;
    }
    setProjectIndexError('');
    setProjectIndexScanAllPendingByHubId(prev => ({...prev, [hubId]: true}));
    setProjectIndexScanPendingByProjectId(prev => ({
      ...prev,
      ...Object.fromEntries(targets.map(project => [project.projectId, true])),
    }));
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const project = targets[cursor];
        cursor += 1;
        try {
          await service.rebuildFileIndex(project.projectId);
        } finally {
          setProjectIndexScanPendingByProjectId(prev => ({...prev, [project.projectId]: false}));
        }
      }
    };
    try {
      await Promise.all(
        Array.from({length: Math.min(PROJECT_INDEX_SCAN_CONCURRENCY, targets.length)}, () => worker()),
      );
      await refreshProjectFileIndexes(hubId, {silent: true});
      scheduleProjectIndexPoll(hubId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setProjectIndexError(message);
      setError(message);
    } finally {
      setProjectIndexScanAllPendingByHubId(prev => ({...prev, [hubId]: false}));
      setProjectIndexScanPendingByProjectId(prev => ({
        ...prev,
        ...Object.fromEntries(targets.map(project => [project.projectId, false])),
      }));
    }
  }, [projectIndexScanAllPendingByHubId, refreshProjectFileIndexes, scheduleProjectIndexPoll]);

  const handleWheelMakerUpdateConfirmedAction = useCallback(async (target: Extract<ConfirmTarget, {kind: 'wheelMakerUpdate'}>) => {
    setConfirmError('');
    setWheelMakerUpdatePendingHubId(target.hubId);
    try {
      const result = await service.requestWheelMakerUpdatePublish(target.hubId);
      setWheelMakerUpdateHubs(prev => ({
        ...prev,
        [target.hubId]: {
          hubId: target.hubId,
          loading: false,
          error: result.ok ? '' : result.error || 'Update request failed.',
          data: result,
        },
      }));
      setConfirmTarget(null);
      setConfirmError('');
      await refreshWheelMakerUpdateHub(target.hubId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmError(message);
      setWheelMakerUpdatesError(message);
      setError(message);
    } finally {
      setWheelMakerUpdatePendingHubId('');
    }
  }, [refreshWheelMakerUpdateHub]);

  const handleWheelMakerUpdateAllConfirmedAction = useCallback(async (target: Extract<ConfirmTarget, {kind: 'wheelMakerUpdateAll'}>) => {
    if (target.hubIds.length === 0) {
      setConfirmTarget(null);
      return;
    }
    setConfirmError('');
    setWheelMakerUpdatesError('');
    setWheelMakerUpdateAllPending(true);
    setWheelMakerUpdatePendingHubId('');
    try {
      const responses = await Promise.all(target.hubIds.map(async hubId => {
        try {
          const result = await service.requestWheelMakerUpdatePublish(hubId);
          return {
            hubId,
            result,
            error: result.ok ? '' : result.error || 'Update request failed.',
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {hubId, error: message};
        }
      }));
      setWheelMakerUpdateHubs(prev => {
        const next = {...prev};
        responses.forEach(entry => {
          next[entry.hubId] = {
            ...(prev[entry.hubId] ?? {hubId: entry.hubId, loading: false, error: '', data: null}),
            hubId: entry.hubId,
            loading: false,
            error: entry.error || '',
            data: 'result' in entry && entry.result ? entry.result : prev[entry.hubId]?.data ?? null,
          };
        });
        return next;
      });
      setConfirmTarget(null);
      setConfirmError('');
      await refreshWheelMakerUpdates();
      const failedUpdates = responses.filter(entry => entry.error);
      if (failedUpdates.length > 0) {
        const message = `Failed to update ${failedUpdates.length} of ${target.hubIds.length} hubs: ${failedUpdates.map(entry => entry.hubId).join(', ')}`;
        setWheelMakerUpdatesError(message);
        setWheelMakerUpdateHubs(prev => {
          const next = {...prev};
          failedUpdates.forEach(entry => {
            next[entry.hubId] = {
              ...(prev[entry.hubId] ?? {hubId: entry.hubId, loading: false, error: '', data: null}),
              hubId: entry.hubId,
              loading: false,
              error: entry.error || 'Update request failed.',
            };
          });
          return next;
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmTarget(null);
      setConfirmError('');
      setWheelMakerUpdatesError(message);
      setError(message);
    } finally {
      setWheelMakerUpdateAllPending(false);
    }
  }, [refreshWheelMakerUpdates]);

  const handleAgentPackageConfirmedAction = useCallback(async (target: Extract<ConfirmTarget, {kind: 'npmPackage'}>) => {
    const pendingKey = agentPackageActionKey(target.hubId, target.packageName);
    setConfirmError('');
    setAgentPackageActionPendingKey(pendingKey);
    try {
      const result = target.action === 'uninstall'
        ? await service.uninstallNpmPackage(target.hubId, target.packageName)
        : await service.installNpmPackage(target.hubId, target.packageName, 'latest');
      setAgentPackageHubs(prev => ({
        ...prev,
        [target.hubId]: {
          ...(prev[target.hubId] ?? {hubId: target.hubId, loading: false, error: '', updatedAt: '', hub: null, operation: null}),
          operation: result.operation ?? null,
        },
      }));
      setConfirmTarget(null);
      setConfirmError('');
      await refreshAgentPackages();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmError(message);
      setAgentPackagesError(message);
      setError(message);
    } finally {
      setAgentPackageActionPendingKey('');
    }
  }, [agentPackageActionKey, refreshAgentPackages]);

  const handleAgentPackageHubUpdateConfirmedAction = useCallback(async (target: Extract<ConfirmTarget, {kind: 'npmPackageHubUpdate'}>) => {
    if (target.packages.length === 0) {
      setConfirmTarget(null);
      return;
    }
    setConfirmError('');
    setAgentPackagesError('');
    setAgentPackageHubUpdatePendingId(target.hubId);
    try {
      const result = await service.installNpmPackages(target.hubId, target.packages.map(pkg => pkg.packageName), 'latest');
      setAgentPackageHubs(prev => ({
        ...prev,
        [target.hubId]: {
          ...(prev[target.hubId] ?? {hubId: target.hubId, loading: false, error: '', updatedAt: '', hub: null, operation: null}),
          operation: result.operation ?? null,
        },
      }));
      setConfirmTarget(null);
      setConfirmError('');
      await refreshAgentPackages();
      if (!result.ok) {
        const message = result.operation?.errorSummary || result.operation?.message || 'Update request failed.';
        setAgentPackagesError(message);
        setAgentPackageHubs(prev => ({
          ...prev,
          [target.hubId]: {
            ...(prev[target.hubId] ?? {hubId: target.hubId, loading: false, error: '', updatedAt: '', hub: null, operation: null}),
            error: message,
          },
        }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmTarget(null);
      setConfirmError('');
      setAgentPackagesError(message);
      setError(message);
    } finally {
      setAgentPackageHubUpdatePendingId('');
    }
  }, [refreshAgentPackages]);

  const formatDatabaseDump = (dump: Awaited<ReturnType<typeof workspaceStore.dumpDatabase>>): string => {
    return JSON.stringify(
      {
        wm_global_kv: dump.global,
        wm_project_state: dump.projects,
        wm_project_commits: dump.projectCommits,
        wm_chat_session_index: dump.chatSessionIndex,
        wm_chat_session_content: dump.chatSessionContent,
        wm_file_cache: dump.fileCache,
        wm_diff_cache: dump.diffCache,
        wm_meta: dump.meta,
        storage: dump.storage,
      },
      null,
      2,
    );
  };

  const openDatabasePanel = () => {
    setDatabasePanelOpen(true);
    setDatabaseLoading(true);
    setDatabaseError('');
    setDatabaseStorageStats(null);
    workspaceStore
      .dumpDatabase()
      .then(dump => {
        setDatabaseStorageStats(dump.storage);
        setDatabaseDumpText(formatDatabaseDump(dump));
      })
      .catch(err => {
        const message = err instanceof Error ? err.message : String(err);
        setDatabaseError(message);
      })
      .finally(() => {
        setDatabaseLoading(false);
      });
  };

  const exportDatabaseDump = () => {
    if (!databaseDumpText || databaseLoading || databaseError) {
      return;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `wheelmaker-local-db-${timestamp}.json`;
    const blob = new Blob([databaseDumpText], {
      type: 'application/json;charset=utf-8',
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(objectUrl);
  };

  const requestClearLocalCache = () => {
    setConfirmError('');
    setConfirmTarget({kind: 'clearCache'});
  };

  const clearLocalCache = () => {
    workspaceStore.clearLocalCache();
    window.location.reload();
  };

  const syncWorkspaceProject = async (
    nextProjectId: string,
    options?: {reason?: 'chat' | 'manual'; keepMobileDrawerOpen?: boolean},
  ) => {
    const syncReason = options?.reason ?? 'manual';
    const finishSyncDiagnostic = startWorkspaceDiagnosticSpan('sync_workspace_project', {
      reason: syncReason,
      fromProjectId: projectIdRef.current,
      projectId: nextProjectId,
      tab: tabRef.current,
    });
    if (!nextProjectId || nextProjectId === projectIdRef.current) {
      setWorkspaceProjectMenuOpen(false);
      finishSyncDiagnostic({skipped: true, skipReason: nextProjectId ? 'same_project' : 'missing_project'});
      return;
    }
    if (!projectsRef.current.some(item => item.projectId === nextProjectId)) {
      if (options?.reason !== 'chat') {
        setError('Project is no longer available');
      }
      setWorkspaceProjectMenuOpen(false);
      finishSyncDiagnostic({ok: false, error: 'Project is no longer available'}, 'error');
      return;
    }

    captureSelectedFileScrollPosition();
    const previousProjectId = projectIdRef.current;
    if (previousProjectId) {
      workspaceStore.rememberProjectSnapshot(previousProjectId, {
        expandedDirs: expandedDirsRef.current,
        selectedFile: selectedFileRef.current,
        pinnedFiles,
        gitCurrentBranch,
        commits,
        selectedCommit,
        commitFilesBySha,
        selectedDiff,
      });
    }

    try {
      const result = await workspaceController.switchProjectLightweight(nextProjectId, {disableFileCache});
      projectsRef.current = result.projects;
      setProjects(result.projects);
      setRegistryHubs(result.hubs);
      setHasPendingProjectUpdates(false);
      workspaceStore.rememberGlobalState({
        selectedProjectId: nextProjectId,
      });
      skipNextSelectedFileAutoReadRef.current =
        tabRef.current !== 'file' && !!result.hydrated.selectedFile;
      applyHydratedProjectState(result.hydrated, {
        keepMobileDrawerOpen: options?.keepMobileDrawerOpen,
      });
      setWorkspaceProjectMenuOpen(false);
      setError('');

      if (options?.reason !== 'chat') {
        if (tabRef.current === 'file') {
          loadDirectory('.', {projectId: nextProjectId}).catch(err =>
            setError(err instanceof Error ? err.message : String(err)),
          );
        } else if (tabRef.current === 'git') {
          loadGitIfRevChanged().catch(err =>
            setGitError(err instanceof Error ? err.message : String(err)),
          );
        }
      }
      finishSyncDiagnostic({ok: true, loadedSurface: options?.reason === 'chat' ? 'none' : tabRef.current});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (options?.reason !== 'chat') {
        setError(message);
      }
      setWorkspaceProjectMenuOpen(false);
      finishSyncDiagnostic({ok: false, error: message}, 'error');
    }
  };

  const switchProject = async (nextProjectId: string) => {
    setLoadingProject(true);
    try {
      const result = await workspaceController.switchProject(nextProjectId, {disableFileCache});
      setProjects(result.projects);
      setHasPendingProjectUpdates(false);
      applyHydratedProjectState(result.hydrated);
      workspaceController
        .validateExpandedDirectories(
          result.hydrated.projectId,
          result.rootEntries,
          result.hydrated.expandedDirs,
          {disableFileCache},
        )
        .then(validated => {
          if (projectIdRef.current !== result.hydrated.projectId) return;
          setDirEntries(validated.dirEntries);
          setExpandedDirs(validated.expandedDirs);
        })
        .catch(() => undefined);
    } finally {
      setLoadingProject(false);
    }
  };

  const selectDraftChatSession = useCallback((
    targetProjectId: string,
    draftId: string,
    options?: {closeMobileDrawer?: boolean},
  ): boolean => {
    if (!targetProjectId || !draftId || !findDraftChatSession(targetProjectId, draftId)) {
      return false;
    }
    const nextSelectedKey = chatSessionKeyFromParts(targetProjectId, draftId);
    if (!nextSelectedKey) {
      return false;
    }
    syncWorkspaceProject(targetProjectId, {reason: 'chat'}).catch(() => undefined);
    setWideProjectActionMenu(null);
    setMobileProjectActionMenu(null);
    setProjectSessionActionMenu(null);
    if (options?.closeMobileDrawer) {
      setDrawerOpen(false);
    }
    setTab('chat');
    applySelectedChatKey(nextSelectedKey);
    const runtimeKey = encodeChatSessionKey(nextSelectedKey);
    chatMessageStoreRef.current[runtimeKey] = chatMessageStoreRef.current[runtimeKey] ?? [];
    chatTurnStoreRef.current[runtimeKey] = chatTurnStoreRef.current[runtimeKey] ?? createEmptyChatTurnStore();
    chatFinishedCursorRef.current[runtimeKey] = chatFinishedCursorRef.current[runtimeKey] ?? 0;
    setVisibleChatMessagesForRuntimeKey(
      runtimeKey,
      chatMessageStoreRef.current[runtimeKey] ?? [],
      {resetToLatest: true},
    );
    return true;
  }, [setDrawerOpen, setTab, setVisibleChatMessagesForRuntimeKey, syncWorkspaceProject]);

  const selectProjectChatSession = async (
    targetProjectId: string,
    sessionId: string,
    options?: {closeMobileDrawer?: boolean; targetTurnIndex?: number},
  ) => {
    if (!targetProjectId || !sessionId) return;
    const nextSelectedKey = chatSessionKeyFromParts(targetProjectId, sessionId);
    if (!nextSelectedKey) return;
    const finishSelectDiagnostic = startWorkspaceDiagnosticSpan('select_session', {
      projectId: targetProjectId,
      sessionId,
      currentProjectId: projectIdRef.current,
    });
    let selected = false;
    let selectError = '';
    const targetTurnIndex = Number.isFinite(options?.targetTurnIndex)
      ? Math.max(0, Math.trunc(options?.targetTurnIndex ?? 0))
      : 0;
    try {
      const hasTargetTurnIndex = targetTurnIndex > 0;
      workspaceStore.rememberSelectedChatSessionKey(nextSelectedKey);
      syncWorkspaceProject(targetProjectId, {reason: 'chat'}).catch(() => undefined);
      setWideProjectActionMenu(null);
      setMobileProjectActionMenu(null);
      if (options?.closeMobileDrawer) {
        setDrawerOpen(false);
      }
      setTab('chat');
      applySelectedChatKey(nextSelectedKey);
      const runtimeKey = encodeChatSessionKey(nextSelectedKey);
      setVisibleChatMessagesForRuntimeKey(
        runtimeKey,
        hydrateChatSessionContentFromCache(sessionId, targetProjectId),
        hasTargetTurnIndex ? {revealTurnIndex: targetTurnIndex} : {resetToLatest: true},
      );
      selected = await loadChatSession(sessionId, targetProjectId, {
        incremental: !hasTargetTurnIndex,
        forceFull: hasTargetTurnIndex,
        preserveUserSelection: true,
        selectionSnapshot: runtimeKey,
        revealTurnIndex: targetTurnIndex,
      });
    } catch (err) {
      selectError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      finishSelectDiagnostic({
        ok: selected,
        targetTurnIndex,
        ...(selectError ? {error: selectError} : {}),
      }, selectError ? 'error' : 'info');
    }
  };

  const resolveChatTitleProjectSession = useCallback((targetProjectId: string): RegistryChatSession | null => {
    if (!targetProjectId) {
      return null;
    }
    const knownSessions = mergeChatSessionList(
      projectSessionsByProjectIdRef.current[targetProjectId] ?? [],
      targetProjectId === projectIdRef.current ? chatSessionsRef.current : [],
    );
    const currentKey = selectedChatKeyRef.current;
    if (currentKey?.projectId === targetProjectId) {
      const currentSession = knownSessions.find(session => session.sessionId === currentKey.sessionId);
      if (currentSession) {
        return currentSession;
      }
    }
    const persistedKey = workspaceStore.migrateSelectedChatSessionKey(targetProjectId);
    if (persistedKey?.projectId === targetProjectId) {
      const persistedSession = knownSessions.find(session => session.sessionId === persistedKey.sessionId);
      if (persistedSession) {
        return persistedSession;
      }
    }
    return knownSessions[0] ?? null;
  }, []);

  const handleChatTitleProjectSelect = useCallback(async (targetProjectId: string) => {
    if (!targetProjectId) {
      return;
    }
    setChatTitleProjectMenuOpen(false);
    setChatTitlePromptMenuOpen(false);
    setChatQuickSwitchMenuOpen(false);
    setSidebarSettingsOpen(false);
    setTab('chat');
    const targetSession = resolveChatTitleProjectSession(targetProjectId);
    if (targetSession) {
      await selectProjectChatSession(targetProjectId, targetSession.sessionId);
      return;
    }
    workspaceStore.rememberSelectedChatSessionKey(null);
    applySelectedChatKey(null);
    setChatMessages([]);
    setVisibleChatMessagesForRuntimeKey('', [], {resetToLatest: true});
    await syncWorkspaceProject(targetProjectId, {reason: 'chat'});
    if (connected) {
      loadChatSessions(targetProjectId, '').catch(() => undefined);
    }
  }, [
    connected,
    loadChatSessions,
    resolveChatTitleProjectSession,
    selectProjectChatSession,
    setSidebarSettingsOpen,
    setTab,
    setVisibleChatMessagesForRuntimeKey,
    syncWorkspaceProject,
  ]);

  const selectWideProjectSession = async (targetProjectId: string, sessionId: string) => {
    await selectProjectChatSession(targetProjectId, sessionId);
  };

  useEffect(() => {
    const selectedProjectId = selectedChatKey?.projectId ?? '';
    if (tab !== 'chat' || !selectedProjectId || !hiddenProjectIdSet.has(selectedProjectId)) {
      return;
    }
    const nextProject = findNextVisibleProject(sortedProjectItems, hiddenProjectIds, selectedProjectId);
    workspaceStore.rememberSelectedChatSessionKey(null);
    applySelectedChatKey(null);
    setChatMessages([]);
    setVisibleChatMessagesForRuntimeKey('', [], {resetToLatest: true});
    if (!nextProject) {
      return;
    }
    syncWorkspaceProject(nextProject.projectId, {reason: 'chat', keepMobileDrawerOpen: chatHubMenuOpen}).catch(() => undefined);
    if (connected) {
      loadChatSessions(nextProject.projectId, '').catch(() => undefined);
    }
  }, [chatHubMenuOpen, connected, hiddenProjectIdSet, hiddenProjectIds, selectedChatKey?.projectId, sortedProjectItems, tab]);

  const handleSessionSearchResultClick = async (
    targetProjectId: string,
    row: SessionSearchSectionRow,
    options?: {closeMobileDrawer?: boolean},
  ) => {
    const promptTargetTurnIndex = row.result.source === 'prompt'
      ? row.result.turnIndex
      : undefined;
    await selectProjectChatSession(targetProjectId, row.session.sessionId, {
      ...options,
      targetTurnIndex: promptTargetTurnIndex,
    });
    if (row.result.source !== 'prompt' || !row.result.turnIndex) {
      return;
    }
    const runtimeKey = buildChatRuntimeKey(targetProjectId, row.session.sessionId);
    const generation = Date.now();
    setSessionSearchTargetTurn({
      runtimeKey,
      turnIndex: row.result.turnIndex,
      generation,
    });
    if (sessionSearchHighlightTimerRef.current !== null) {
      window.clearTimeout(sessionSearchHighlightTimerRef.current);
    }
    sessionSearchHighlightTimerRef.current = window.setTimeout(() => {
      setSessionSearchTargetTurn(current =>
        current?.generation === generation ? null : current,
      );
    }, 2000);
  };

  const jumpToChatPromptTurn = useCallback((turnIndex: number) => {
    if (!selectedChatEncodedKey || turnIndex <= 0) {
      return;
    }
    setChatTitlePromptMenuOpen(false);
    const generation = Date.now();
    setSessionSearchTargetTurn({
      runtimeKey: selectedChatEncodedKey,
      turnIndex,
      generation,
    });
    chatVirtuosoListRef.current?.scrollToTurnIndex(turnIndex, 'smooth');
    if (sessionSearchHighlightTimerRef.current !== null) {
      window.clearTimeout(sessionSearchHighlightTimerRef.current);
    }
    sessionSearchHighlightTimerRef.current = window.setTimeout(() => {
      setSessionSearchTargetTurn(current =>
        current?.generation === generation ? null : current,
      );
    }, 2000);
  }, [selectedChatEncodedKey]);

  const renderSessionSearchHighlightedTitle = (
    title: string,
    row: SessionSearchSectionRow,
  ) => {
    const segments = splitSessionSearchTitleHighlight(title, sessionSearchQuery);
    if (segments.length === 0) {
      return title;
    }
    return segments.map((segment, index) => (
      <span
        key={`${row.session.sessionId}:title-highlight:${index}`}
        className={segment.match ? 'session-search-title-highlight' : undefined}
      >
        {segment.text}
      </span>
    ));
  };

  const renderSessionSearchStatusLine = () => {
    if (!sessionSearchActive || sessionSearchStatusParts.length === 0) {
      return null;
    }
    return (
      <div className="chat-header-search-status">
        {sessionSearchStatusParts.join(' · ')}
      </div>
    );
  };

  const renderChatHeaderSearchControls = () => {
    const hasActiveSearch = !!activeSessionSearchId;
    if (!sessionSearchOpen && !hasActiveSearch) {
      return (
        <div className="chat-header-search-control compact">
          <button
            type="button"
            className="session-search-icon-btn chat-menu-icon-button"
            onClick={() => setSessionSearchOpen(true)}
            title="Search sessions"
            aria-label="Search sessions"
          >
            <span className="codicon codicon-search" />
          </button>
        </div>
      );
    }
    return (
      <div className="chat-header-search-wrap">
        <form
          className={`chat-header-search-control open${hasActiveSearch ? ' active' : ''}`}
          onSubmit={event => {
            event.preventDefault();
            startSessionSearch().catch(() => undefined);
          }}
        >
          <span className="codicon codicon-search session-search-leading-icon" aria-hidden="true" />
          <input
            ref={sessionSearchInputRef}
            className="session-search-input"
            value={sessionSearchInput}
            onChange={event => setSessionSearchInput(event.target.value)}
            placeholder="Search sessions"
            aria-label="Search sessions"
          />
          <button
            type="submit"
            className="session-search-icon-btn"
            title="Start search"
            aria-label="Start search"
          >
            <span className="codicon codicon-check" />
          </button>
          <button
            type="button"
            className="session-search-icon-btn"
            title="Close search"
            aria-label="Close search"
            onClick={() => {
              if (hasActiveSearch) {
                exitSessionSearch().catch(() => undefined);
              } else {
                setSessionSearchOpen(false);
                setSessionSearchInput('');
              }
            }}
          >
            <span className="codicon codicon-close" />
          </button>
        </form>
        {renderSessionSearchStatusLine()}
      </div>
    );
  };

  const renderChatArchiveControls = () => {
    if (sessionSearchHeaderExpanded) {
      return null;
    }
    return (
      <div className="chat-header-archive-control compact">
        <button
          type="button"
          className="session-search-icon-btn chat-menu-icon-button"
          onClick={() => setSessionArchiveMenuOpen(value => !value)}
          title="Archive"
          aria-label="Archive"
          aria-haspopup="menu"
          aria-expanded={sessionArchiveMenuOpen}
        >
          <span className="codicon codicon-archive" />
        </button>
        {sessionArchiveMenuOpen ? (
          <div className="session-archive-menu" role="menu" aria-label="Archive sessions">
            <button
              type="button"
              className="wide-project-action-menu-item"
              onClick={() => requestArchiveOlderSessions(7)}
              role="menuitem"
            >
              <span className="codicon codicon-archive" />
              <span>Archive &gt; 7 days</span>
            </button>
            <button
              type="button"
              className="wide-project-action-menu-item"
              onClick={() => requestArchiveOlderSessions(14)}
              role="menuitem"
            >
              <span className="codicon codicon-archive" />
              <span>Archive &gt; 14 days</span>
            </button>
            <button
              type="button"
              className="wide-project-action-menu-item"
              onClick={() => enterArchivedMode().catch(() => undefined)}
              role="menuitem"
            >
              <span className="codicon codicon-history" />
              <span>Recover...</span>
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const toggleOlderSessionsExpanded = (targetProjectId: string) => {
    setOlderSessionsExpandedByProjectId(current => ({
      ...current,
      [targetProjectId]: current[targetProjectId] !== true,
    }));
  };

  const dismissDraftChatSession = (targetProjectId: string, draftId: string) => {
    if (!targetProjectId || !draftId) {
      return;
    }
    const runtimeKey = buildChatRuntimeKey(targetProjectId, draftId);
    const draftKey = buildChatDraftKey(targetProjectId, draftId);
    resetChatComposerDraft(draftKey);
    updateProjectDraftSessions(
      targetProjectId,
      drafts => removeDraftChatSession(drafts, draftId),
    );
    const nextPromises = {...draftSessionCreatePromisesRef.current};
    delete nextPromises[runtimeKey];
    draftSessionCreatePromisesRef.current = nextPromises;
    if (encodeChatSessionKey(selectedChatKeyRef.current) === runtimeKey) {
      applySelectedChatKey(null);
      setVisibleChatMessagesForRuntimeKey('', [], {resetToLatest: true});
    }
  };

  const renderDraftSessionStateMarker = (draft: DraftChatSession) => {
    const failed = draft.status === 'failed';
    const title =
      draft.status === 'sendingFirstPrompt'
        ? 'Creating session and sending first prompt'
        : failed
          ? draft.errorMessage || 'Create failed'
          : 'Creating session';
    return (
      <span className={`session-state-marker draft ${draft.status}`} title={title}>
        <span className={`codicon ${
          failed
            ? 'codicon-error'
            : 'codicon-loading codicon-modifier-spin'
        }`} />
      </span>
    );
  };

  const renderDraftSessionRow = (
    targetProjectId: string,
    draft: DraftChatSession,
    mobile: boolean,
  ) => {
    const selected = selectedChatEncodedKey === buildChatRuntimeKey(targetProjectId, draft.draftId);
    const failed = draft.status === 'failed';
    const displaySessionAgent = normalizeAgentTypeName(draft.agentType);
    const statusLabel =
      draft.status === 'sendingFirstPrompt'
        ? 'Sending...'
        : failed
          ? 'Failed'
          : 'Creating...';
    return (
      <div
        key={`${targetProjectId}:${mobile ? 'mobile-draft' : 'wide-draft'}:${draft.draftId}`}
        className={`project-session-row-wrap draft-session-row-wrap${failed ? ' failed has-dismiss' : ''}`}
      >
        <button
          type="button"
          className={`wide-session-row draft-session-row ${draft.status}${mobile ? ' mobile-session-row' : ''}${selected ? ' selected' : ''}`}
          title={failed ? draft.errorMessage : draft.title}
          onClick={() => {
            selectDraftChatSession(targetProjectId, draft.draftId, {
              closeMobileDrawer: mobile,
            });
          }}
        >
          {renderDraftSessionStateMarker(draft)}
          <span className="wide-session-title">
            {draft.title}
          </span>
          {displaySessionAgent ? (
            <span className={`wide-session-agent-tag ${tagVariantClass('wide-session-agent', draft.agentType)}`}>
              {displaySessionAgent}
            </span>
          ) : null}
          <span className="wide-session-time" title={failed ? draft.errorMessage : draft.createdAt}>
            {statusLabel}
          </span>
        </button>
        {failed ? (
          <button
            type="button"
            className="draft-session-dismiss"
            title="Dismiss"
            aria-label="Dismiss draft session"
            onClick={() => dismissDraftChatSession(targetProjectId, draft.draftId)}
          >
            <span className="codicon codicon-close" />
          </button>
        ) : null}
      </div>
    );
  };

  const renderProjectSessionRow = (
    targetProjectId: string,
    session: RegistryChatSession,
    mobile: boolean,
  ) => {
    const sessionAgent = (session.agentType || '').trim();
    const displaySessionAgent = normalizeAgentTypeName(sessionAgent);
    const sessionActionsOpen =
      projectSessionActionMenu?.projectId === targetProjectId &&
      projectSessionActionMenu.sessionId === session.sessionId;
    return (
      <div
        key={`${targetProjectId}:${mobile ? 'mobile-session' : 'wide-session'}:${session.sessionId}`}
        className={`project-session-row-wrap${sessionActionsOpen ? ' actions-open' : ''}`}
      >
        <button
          type="button"
          className={`wide-session-row${mobile ? ' mobile-session-row' : ''}${
            selectedChatEncodedKey === buildChatRuntimeKey(targetProjectId, session.sessionId)
              ? ' selected'
              : ''
          }`}
          onPointerDown={event => startProjectSessionLongPress(targetProjectId, session.sessionId, event)}
          onPointerUp={finishProjectSessionLongPress}
          onPointerCancel={finishProjectSessionLongPress}
          onPointerLeave={finishProjectSessionLongPress}
          onContextMenu={event => openProjectSessionContextMenu(targetProjectId, session.sessionId, event)}
          onClick={event => {
            if (consumeProjectSessionLongPressClick(targetProjectId, session.sessionId, event)) {
              return;
            }
            if (mobile) {
              selectProjectChatSession(
                targetProjectId,
                session.sessionId,
                {closeMobileDrawer: true},
              ).catch(() => undefined);
              return;
            }
            selectWideProjectSession(
              targetProjectId,
              session.sessionId,
            ).catch(() => undefined);
          }}
        >
          {renderSessionStateMarker(session, targetProjectId)}
          <span className="wide-session-title">
            {resolveSessionDisplayTitle(session) || session.sessionId}
          </span>
          {displaySessionAgent ? (
            <span className={`wide-session-agent-tag ${tagVariantClass('wide-session-agent', sessionAgent)}`}>
              {displaySessionAgent}
            </span>
          ) : null}
          <span className="wide-session-time" title={session.updatedAt || ''}>
            {formatCompactRelativeAge(session.updatedAt)}
          </span>
        </button>
        {renderProjectSessionActionMenu(targetProjectId, session)}
      </div>
    );
  };

  const renderRecentSessionRow = (
    targetProjectId: string,
    session: RegistryChatSession,
    mobile: boolean,
    showProjectCreateAction: boolean,
    projectName: string,
  ) => {
    // Resolve the live session from the store so the state marker stays in
    // sync with the project list (the recent session snapshot can lag until the
    // next prompt event). Fall back to the captured snapshot if not found.
    const liveSession =
      projectSessionsByProjectId[targetProjectId]?.find(
        item => item.sessionId === session.sessionId,
      ) ?? session;
    const sessionAgent = (liveSession.agentType || '').trim();
    const displaySessionAgent = normalizeAgentTypeName(sessionAgent);
    const selected = selectedChatEncodedKey === buildChatRuntimeKey(targetProjectId, liveSession.sessionId);
    const sessionActionsOpen =
      projectSessionActionMenu?.projectId === targetProjectId &&
      projectSessionActionMenu.sessionId === liveSession.sessionId;
    return (
      <div
        key={`recent:${targetProjectId}:${session.sessionId}`}
        className={`project-session-row-wrap recent-session-row-wrap${sessionActionsOpen ? ' actions-open' : ''}`}
      >
        <button
          type="button"
          className={`wide-session-row recent-session-row${mobile ? ' mobile-session-row' : ''}${selected ? ' selected' : ''}`}
          title={resolveSessionDisplayTitle(liveSession) || liveSession.sessionId}
          onPointerDown={event => startProjectSessionLongPress(targetProjectId, session.sessionId, event)}
          onPointerUp={finishProjectSessionLongPress}
          onPointerCancel={finishProjectSessionLongPress}
          onPointerLeave={finishProjectSessionLongPress}
          onContextMenu={event => openProjectSessionContextMenu(targetProjectId, session.sessionId, event)}
          onClick={event => {
            if (consumeProjectSessionLongPressClick(targetProjectId, session.sessionId, event)) {
              return;
            }
            if (mobile) {
              selectProjectChatSession(targetProjectId, session.sessionId, {closeMobileDrawer: true}).catch(() => undefined);
            } else {
              selectWideProjectSession(targetProjectId, session.sessionId).catch(() => undefined);
            }
          }}
        >
          {renderSessionStateMarker(liveSession, targetProjectId)}
          <span className="wide-session-title">
            {resolveSessionDisplayTitle(liveSession) || liveSession.sessionId}
          </span>
          {displaySessionAgent ? (
            <span className={`wide-session-agent-tag ${tagVariantClass('wide-session-agent', sessionAgent)}`}>
              {displaySessionAgent}
            </span>
          ) : null}
          <span className="wide-session-time" title={liveSession.updatedAt || ''}>
            {formatCompactRelativeAge(liveSession.updatedAt)}
          </span>
        </button>
        {showProjectCreateAction ? (
          <button
            type="button"
            className="recent-project-session-create"
            title={`New session in ${projectName}`}
            aria-label={`New session in ${projectName}`}
            onClick={event => {
              if (mobile) {
                openMobileProjectActionMenu(targetProjectId, 'new');
                return;
              }
              openWideProjectActionMenu(targetProjectId, 'new', event.currentTarget);
            }}
          >
            <span className="codicon codicon-add" aria-hidden="true" />
          </button>
        ) : null}
        {renderProjectSessionActionMenu(targetProjectId, liveSession)}
      </div>
    );
  };

  const commitTerminalSync = useCallback((next: TerminalSyncState) => {
    terminalSyncRef.current = next;
    setTerminalSync(next);
  }, []);

  const runTerminalEffects = useCallback(async (effects: TerminalEffect[]) => {
    for (const effect of effects) {
      if (effect.kind === 'refresh') {
        await terminalRefreshRef.current(effect.terminalKey);
        continue;
      }
      if (activeTerminalKeyRef.current !== effect.terminalKey) continue;
      if (effect.kind === 'reset') {
        await terminalViewRef.current?.resetAndWrite(effect.data);
      } else {
        terminalViewRef.current?.write(effect.data);
      }
    }
  }, []);

  const refreshTerminal = useCallback(async (key: string) => {
    if (!key || terminalRefreshInFlightRef.current.has(key)) return;
    const terminal = terminalSyncRef.current.terminals[key];
    if (!terminal) return;
    terminalRefreshInFlightRef.current.add(key);
    let retrySnapshot = false;
    commitTerminalSync(beginTerminalSnapshot(terminalSyncRef.current, terminal.hubId, terminal.terminalId));
    try {
      const snapshot = await service.getTerminal(terminal.hubId, terminal.terminalId);
      const result = applyTerminalSnapshot(terminalSyncRef.current, terminal.hubId, snapshot);
      commitTerminalSync(result.state);
      retrySnapshot = result.effects.some(effect => effect.kind === 'refresh');
      await runTerminalEffects(result.effects.filter(effect => effect.kind !== 'refresh'));
    } catch {
      commitTerminalSync(markTerminalsUnavailable(terminalSyncRef.current, [terminal.hubId]));
    } finally {
      terminalRefreshInFlightRef.current.delete(key);
    }
    if (retrySnapshot) await terminalRefreshRef.current(key);
  }, [commitTerminalSync, runTerminalEffects]);
  terminalRefreshRef.current = refreshTerminal;

  const refreshTerminalLists = useCallback(async (hubs: RegistryHub[]) => {
    const hubIds = deriveRegistryHubIds(hubs);
    const results = await Promise.allSettled(hubIds.map(hubId => service.listTerminals(hubId)));
    const successful = results.flatMap((result, index) => result.status === 'fulfilled'
      ? [{hubId: hubIds[index], terminals: result.value.terminals}]
      : []);
    const failedHubIds = results.flatMap((result, index) => result.status === 'rejected' ? [hubIds[index]] : []);
    let next = mergeTerminalLists(terminalSyncRef.current, successful);
    if (failedHubIds.length > 0) next = markTerminalsUnavailable(next, failedHubIds);
    commitTerminalSync(next);
    const currentKey = activeTerminalKeyRef.current;
    const selectedKey = currentKey && next.terminals[currentKey]
      ? currentKey
      : Object.keys(next.terminals)[0] ?? '';
    activeTerminalKeyRef.current = selectedKey;
    setActiveTerminalKey(selectedKey);
  }, [commitTerminalSync]);

  useEffect(() => {
    if (!terminalOpen || !activeTerminalKey || !connected) return;
    const frame = window.requestAnimationFrame(() => {
      terminalRefreshRef.current(activeTerminalKey).catch(() => undefined);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTerminalKey, connected, terminalOpen]);

  const handleCreateTerminal = useCallback(async () => {
    const currentProjectId = projectIdRef.current;
    if (!currentProjectId || !connectedRef.current) return;
    const size = terminalViewRef.current?.fit() ?? {cols: 80, rows: 24};
    const created = await service.createTerminal(currentProjectId, size.cols, size.rows);
    const key = `${created.terminal.hubId}:${created.terminal.terminalId}`;
    terminalResizeTokensRef.current.set(key, created.resizeToken);
    const next = applyTerminalChanged(terminalSyncRef.current, created.terminal.hubId, {
      change: 'created', terminalId: created.terminal.terminalId, terminal: created.terminal,
    });
    commitTerminalSync(next);
    activeTerminalKeyRef.current = key;
    setActiveTerminalKey(key);
    setTerminalOpen(true);
    if (!isWide) {
      setChatPreviewManualOpen(false);
      setChatPreviewManualCollapsed(true);
    }
  }, [commitTerminalSync, isWide]);

  const handleTerminalInput = useCallback((data: Uint8Array) => {
    const key = activeTerminalKeyRef.current;
    const state = terminalSyncRef.current;
    const terminal = state.terminals[key];
    if (!terminal || !canSendTerminalInput(state, key, connectedRef.current)) return;
    try {
      service.sendTerminalInput(terminal.hubId, {
        terminalId: terminal.terminalId,
        runId: terminal.runId,
        data: bytesToBase64(data),
      });
    } catch {
      commitTerminalSync(markTerminalsUnavailable(state, [terminal.hubId]));
    }
  }, [commitTerminalSync]);

  const claimTerminalResize = useCallback((key: string, cols: number, rows: number) => {
    if (terminalResizeClaimsRef.current.has(key)) return;
    const terminal = terminalSyncRef.current.terminals[key];
    if (!terminal || !connectedRef.current || cols <= 0 || rows <= 0) return;
    terminalResizeClaimsRef.current.add(key);
    service.resizeTerminal(terminal.hubId, {
      terminalId: terminal.terminalId, cols, rows, claim: true,
    }).then(result => {
      if (result.resizeToken) terminalResizeTokensRef.current.set(key, result.resizeToken);
      commitTerminalSync(applyTerminalChanged(terminalSyncRef.current, terminal.hubId, {
        change: 'resized', terminalId: terminal.terminalId, terminal: result.terminal,
      }));
    }).catch(() => undefined).finally(() => {
      terminalResizeClaimsRef.current.delete(key);
    });
  }, [commitTerminalSync]);

  const handleAutoClaimTerminalResize = useCallback((cols: number, rows: number) => {
    const key = activeTerminalKeyRef.current;
    const terminal = terminalSyncRef.current.terminals[key];
    if (!terminal || (terminal.cols === cols && terminal.rows === rows)) return;
    claimTerminalResize(key, cols, rows);
  }, [claimTerminalResize]);

  const handleTerminalResize = useCallback((cols: number, rows: number) => {
    const key = activeTerminalKeyRef.current;
    const terminal = terminalSyncRef.current.terminals[key];
    const resizeToken = terminalResizeTokensRef.current.get(key);
    if (!terminal || !connectedRef.current) return;
    if (!resizeToken) {
      claimTerminalResize(key, cols, rows);
      return;
    }
    service.resizeTerminal(terminal.hubId, {terminalId: terminal.terminalId, cols, rows, resizeToken})
      .then(result => commitTerminalSync(applyTerminalChanged(terminalSyncRef.current, terminal.hubId, {
        change: 'resized', terminalId: terminal.terminalId, terminal: result.terminal,
      })))
      .catch(() => {
        terminalResizeTokensRef.current.delete(key);
        claimTerminalResize(key, cols, rows);
      });
  }, [claimTerminalResize, commitTerminalSync]);

  const handleClaimTerminalResize = useCallback(() => {
    const key = activeTerminalKeyRef.current;
    const terminal = terminalSyncRef.current.terminals[key];
    const size = terminalViewRef.current?.fit();
    if (!terminal || !size || !connectedRef.current) return;
    claimTerminalResize(key, size.cols, size.rows);
  }, [claimTerminalResize]);

  const handleCloseTerminal = useCallback(async (terminal: RegistryTerminal) => {
    await service.closeTerminal(terminal.hubId, terminal.terminalId);
    const key = `${terminal.hubId}:${terminal.terminalId}`;
    terminalResizeTokensRef.current.delete(key);
    const next = applyTerminalChanged(terminalSyncRef.current, terminal.hubId, {
      change: 'closed', terminalId: terminal.terminalId,
    });
    commitTerminalSync(next);
    if (activeTerminalKeyRef.current === key) {
      const nextKey = Object.keys(next.terminals)[0] ?? '';
      activeTerminalKeyRef.current = nextKey;
      setActiveTerminalKey(nextKey);
    }
  }, [commitTerminalSync]);

  const handleRestartTerminal = useCallback(async (terminal: RegistryTerminal) => {
    const restarted = await service.restartTerminal(terminal.hubId, terminal.terminalId);
    const key = `${terminal.hubId}:${terminal.terminalId}`;
    terminalResizeTokensRef.current.set(key, restarted.resizeToken);
    commitTerminalSync(applyTerminalChanged(terminalSyncRef.current, terminal.hubId, {
      change: 'restarted', terminalId: terminal.terminalId, terminal: restarted.terminal,
    }));
    activeTerminalKeyRef.current = key;
    setActiveTerminalKey(key);
    terminalRefreshRef.current(key).catch(() => undefined);
  }, [commitTerminalSync]);

  const handleSelectTerminal = useCallback((key: string) => {
    activeTerminalKeyRef.current = key;
    setActiveTerminalKey(key);
    setTerminalOpen(true);
  }, []);

  const handleRequestCloseTerminal = useCallback((terminal: RegistryTerminal) => {
    if (terminal.status === 'running') {
      setConfirmError('');
      setConfirmTarget({
        kind: 'terminalClose', hubId: terminal.hubId, terminalId: terminal.terminalId,
        label: `${terminal.projectName || terminal.terminalId} · ${terminal.hubId}`,
      });
      return;
    }
    handleCloseTerminal(terminal).catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [handleCloseTerminal]);

  const renderRecentProjectSessionSection = (
    section: RecentChatSessionProjectSection,
    mobile: boolean,
  ) => {
    const targetProjectId = section.projectId;
    const projectName = section.projectName || targetProjectId;
    const projectAccentVariant = tagVariantClass('recent-project-accent', targetProjectId);
    return (
      <div
        key={`recent-project:${targetProjectId}`}
        className={`recent-project-session-group ${projectAccentVariant}`}
        role="group"
        aria-label={`${projectName} recent sessions`}
      >
        <div className="recent-project-session-watermark" aria-hidden="true">
          <span className="recent-project-session-watermark-name">{projectName.toUpperCase()}</span>
        </div>
        <div className="recent-project-session-list">
          {section.sessions.map((session, sessionIndex) => renderRecentSessionRow(
            targetProjectId,
            session,
            mobile,
            sessionIndex === 0,
            projectName,
          ))}
        </div>
      </div>
    );
  };

  const renderRecentSessionsSection = (mobile: boolean) => {
    if (archivedMode || sessionSearchActive) {
      return null;
    }
    if (recentSessionSections.length === 0) {
      return null;
    }
    const recentCollapsed = collapsedProjectIds.includes(RECENT_SESSIONS_VIRTUAL_PROJECT_ID);
    return (
      <div
        className={`wide-project-section recent-sessions-section${mobile ? ' mobile-project-section' : ''}${
          recentCollapsed ? ' collapsed' : ''
        }${recentSessionsPinned ? ' pinned' : ''}`}
      >
        <div className="wide-project-row">
          <button
            type="button"
            className="wide-project-toggle"
            onClick={() => toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}
            title={recentCollapsed ? 'Expand Recent Sessions' : 'Collapse Recent Sessions'}
            aria-expanded={!recentCollapsed}
          >
            <span className="wide-project-folder-wrap">
              <span className="codicon codicon-history recent-sessions-icon" aria-hidden="true" />
            </span>
            <span className="wide-project-title-group">
              <span className="wide-project-name">Recent Sessions</span>
            </span>
          </button>
          <button
            type="button"
            className={`recent-sessions-pin-btn${recentSessionsPinned ? ' active' : ''}`}
            onClick={() => setRecentSessionsPinned(p => !p)}
            title={recentSessionsPinned ? 'Unpin Recent Sessions' : 'Pin Recent Sessions to top'}
            aria-pressed={recentSessionsPinned}
          >
            <span className="codicon codicon-pinned" aria-hidden="true" />
          </button>
        </div>
        {!recentCollapsed ? (
          <div className={`wide-project-session-list recent-sessions-list${mobile ? ' mobile-project-session-list' : ''}`}>
            {recentSessionSections.map(section => renderRecentProjectSessionSection(section, mobile))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderProjectSessionRowsWithOlderFolding = (
    targetProjectId: string,
    projectSessions: RegistryChatSession[],
    mobile: boolean,
  ) => {
    const projectDraftSessions = draftSessionsByProjectId[targetProjectId] ?? [];
    const split = splitOlderProjectSessions({
      sessions: projectSessions,
      nowMs: Date.now(),
      olderThanDays: OLDER_SESSION_DAYS,
      expanded: olderSessionsExpandedByProjectId[targetProjectId] === true,
    });
    const hiddenOlderCount = split.hiddenOlderCount;
    return (
      <>
        {projectDraftSessions.map(draft => renderDraftSessionRow(targetProjectId, draft, mobile))}
        {split.visibleSessions.map(session => renderProjectSessionRow(targetProjectId, session, mobile))}
        {split.showToggle ? (
          <button
            type="button"
            className={`wide-session-row session-older-toggle${mobile ? ' mobile-session-row' : ''}`}
            onClick={() => toggleOlderSessionsExpanded(targetProjectId)}
          >
            <span className="session-older-spacer" aria-hidden="true" />
            <span className="wide-session-title">
              {split.expanded ? 'Show less' : `Show ${hiddenOlderCount} old sessions...`}
            </span>
          </button>
        ) : null}
      </>
    );
  };

  const renderSessionSearchRow = (
    targetProjectId: string,
    row: SessionSearchSectionRow,
    mobile: boolean,
  ) => {
    const sessionAgent = (row.session.agentType || '').trim();
    const displaySessionAgent = normalizeAgentTypeName(sessionAgent);
    const title = resolveSessionDisplayTitle(row.session) || row.session.sessionId;
    const selected =
      selectedChatEncodedKey === buildChatRuntimeKey(targetProjectId, row.session.sessionId);
    return (
      <div
        key={`${targetProjectId}:search:${row.session.sessionId}`}
        className="project-session-row-wrap session-search-row-wrap"
      >
        <button
          type="button"
          className={`wide-session-row session-search-row${mobile ? ' mobile-session-row' : ''}${selected ? ' selected' : ''}`}
          title={title}
          onClick={() => {
            handleSessionSearchResultClick(targetProjectId, row, {
              closeMobileDrawer: mobile,
            }).catch(() => undefined);
          }}
        >
          {renderSessionStateMarker(row.session, targetProjectId)}
          <span className="wide-session-title session-search-title">
            {renderSessionSearchHighlightedTitle(title, row)}
          </span>
          {displaySessionAgent ? (
            <span className={`wide-session-agent-tag ${tagVariantClass('wide-session-agent', sessionAgent)}`}>
              {displaySessionAgent}
            </span>
          ) : null}
          <span className="wide-session-time" title={row.session.updatedAt || ''}>
            {formatCompactRelativeAge(row.session.updatedAt)}
          </span>
        </button>
      </div>
    );
  };

  const renderSessionSearchResults = (mobile: boolean) => {
    const errorMessages = Object.entries(sessionSearchErrorsByProjectId)
      .map(([entryProjectId, message]) => {
        const text = message.trim();
        if (!text) {
          return null;
        }
        const projectName = projects.find(item => item.projectId === entryProjectId)?.name || entryProjectId;
        return `${projectName}: ${text}`;
      })
      .filter((item): item is string => item !== null);
    const body = (
      <>
        {sessionSearchSections.map(section => {
          const projectHub = projectHubId(section.project);
          const projectHubVariant = tagVariantClass('wide-project-hub', projectHub);
          return (
            <div
              key={`session-search-project:${section.project.projectId}`}
              className={`wide-project-section session-search-project-section${section.project.projectId === projectId ? ' active' : ''}`}
            >
              <div className={`wide-project-row session-search-project-row${mobile ? ' mobile-project-row' : ''}`}>
                <div className="wide-project-toggle session-search-project-label">
                  <span className="wide-project-folder-wrap">
                    <span
                      className={`codicon codicon-search wide-project-folder-icon ${projectHubVariant}`}
                      style={hubAccentStyle(projectHub)}
                    />
                  </span>
                  <span className="wide-project-title-group">
                    <span className="wide-project-name" title={section.project.name}>
                      {section.project.name}
                    </span>
                    <span className={`wide-project-hub-tag ${projectHubVariant}`} style={hubAccentStyle(projectHub)}>
                      <span className="wide-project-hub-dot" aria-hidden="true" />
                      <span className="wide-project-hub-label">{projectHub}</span>
                    </span>
                  </span>
                </div>
              </div>
              <div className={`wide-project-session-list session-search-result-list${mobile ? ' mobile-project-session-list' : ''}`}>
                {section.rows.map(row => renderSessionSearchRow(section.project.projectId, row, mobile))}
              </div>
            </div>
          );
        })}
        {sessionSearchSections.length === 0 ? (
          <div className="wide-project-empty session-search-empty">
            {sessionSearchAllDone ? 'No matching sessions' : 'Searching... 0 results'}
          </div>
        ) : null}
        {errorMessages.length > 0 ? (
          <div className="session-search-error-list">
            {errorMessages.map(message => (
              <div key={message} className="session-search-error">
                {message}
              </div>
            ))}
          </div>
        ) : null}
      </>
    );
    if (mobile) {
      return (
        <div className="mobile-project-session-nav session-search-nav">
          {body}
        </div>
      );
    }
    return body;
  };

  const renderArchiveBatchStatus = () => {
    if (!archiveBatchProgress && !archiveBatchSummary) {
      return null;
    }
    const archiveBatchRunning = !!archiveBatchProgress && archiveBatchProgress.completed < archiveBatchProgress.total;
    const progressPercent = archiveBatchProgress && archiveBatchProgress.total > 0
      ? Math.round((archiveBatchProgress.completed / archiveBatchProgress.total) * 100)
      : 0;
    return (
      <div className="session-archive-progress" role="status" aria-live="polite">
        <div className="session-archive-progress-top">
          <span className="session-archive-progress-label">
            Archive status
          </span>
          <button
            type="button"
            className="session-archive-progress-dismiss"
            aria-label="Close archive status"
            title="Close archive status"
            disabled={archiveBatchRunning}
            onClick={clearArchiveBatchStatus}
          >
            <span className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>
        {archiveBatchProgress ? (
          <>
            <div className="session-archive-progress-head">
              <span>
                Archive {archiveBatchProgress.completed}/{archiveBatchProgress.total}
              </span>
              <span>
                {archiveBatchProgress.archived} ok · {archiveBatchProgress.failed} failed
              </span>
            </div>
            <div className="session-archive-progress-track" aria-hidden="true">
              <span style={{width: `${progressPercent}%`}} />
            </div>
            {archiveBatchProgress.currentLabel ? (
              <div className="session-archive-progress-current">
                {archiveBatchProgress.currentLabel}
              </div>
            ) : null}
          </>
        ) : null}
        {archiveBatchSummary ? (
          <div className="session-archive-summary">{archiveBatchSummary}</div>
        ) : null}
      </div>
    );
  };

  const renderArchivedSessionRows = (mobile: boolean) => {
    const body = (
      <>
        <div className={`archived-session-header${mobile ? ' mobile' : ''}`}>
          <div className="archived-session-title">
            <span className="codicon codicon-archive" aria-hidden="true" />
            <span>Archived</span>
          </div>
          <button
            type="button"
            className="archived-session-cancel"
            onClick={exitArchivedMode}
          >
            Cancel
          </button>
        </div>
        {archivedLoading ? (
          <div className="wide-project-empty archived-session-empty">
            <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
            <span>Loading archived sessions...</span>
          </div>
        ) : null}
        {archivedError ? (
          <div className="session-search-error-list archived-session-error-list">
            <div className="session-search-error">{archivedError}</div>
          </div>
        ) : null}
        {archivedSessionSections.map(section => {
          const projectHub = projectHubId(section.project);
          const projectHubVariant = tagVariantClass('wide-project-hub', projectHub);
          return (
            <div
              key={`archived-project:${section.project.projectId}`}
              className={`wide-project-section archived-session-project-section${section.project.projectId === projectId ? ' active' : ''}`}
            >
              <div className={`wide-project-row archived-session-project-row${mobile ? ' mobile-project-row' : ''}`}>
                <div className="wide-project-toggle session-search-project-label">
                  <span className="wide-project-folder-wrap">
                    <span
                      className={`codicon codicon-archive wide-project-folder-icon ${projectHubVariant}`}
                      style={hubAccentStyle(projectHub)}
                    />
                  </span>
                  <span className="wide-project-title-group">
                    <span className="wide-project-name" title={section.project.name}>
                      {section.project.name}
                    </span>
                    <span className={`wide-project-hub-tag ${projectHubVariant}`} style={hubAccentStyle(projectHub)}>
                      <span className="wide-project-hub-dot" aria-hidden="true" />
                      <span className="wide-project-hub-label">{projectHub}</span>
                    </span>
                  </span>
                </div>
              </div>
              <div className={`wide-project-session-list archived-session-result-list${mobile ? ' mobile-project-session-list' : ''}`}>
                {section.rows.map(row => {
                  const session = row.session;
                  const sessionAgent = (session.agentType || '').trim();
                  const displaySessionAgent = normalizeAgentTypeName(sessionAgent);
                  const selected =
                    selectedArchivedKey?.projectId === section.project.projectId &&
                    selectedArchivedKey.sessionId === session.sessionId;
                  const restoreKey = buildChatRuntimeKey(section.project.projectId, session.sessionId);
                  const restoring = archivedRestoringSessionId === restoreKey;
                  return (
                    <div
                      key={`${section.project.projectId}:archived:${session.sessionId}`}
                      className={`project-session-row-wrap archived-session-row-wrap${selected ? ' selected' : ''}`}
                    >
                      <button
                        type="button"
                        className={`wide-session-row archived-session-row${mobile ? ' mobile-session-row' : ''}${selected ? ' selected' : ''}`}
                        title={resolveSessionDisplayTitle(session) || session.sessionId}
                        onClick={() => {
                          loadArchivedSessionPreview(
                            section.project.projectId,
                            session.sessionId,
                          ).catch(() => undefined);
                        }}
                      >
                        <span className="session-state-marker archived">
                          <span className="codicon codicon-archive" aria-hidden="true" />
                        </span>
                        <span className="wide-session-title">
                          {resolveSessionDisplayTitle(session) || session.sessionId}
                        </span>
                        {displaySessionAgent ? (
                          <span className={`wide-session-agent-tag ${tagVariantClass('wide-session-agent', sessionAgent)}`}>
                            {displaySessionAgent}
                          </span>
                        ) : null}
                        <span className="wide-session-time" title={session.archivedAt || session.updatedAt || ''}>
                          {formatCompactRelativeAge(session.archivedAt || session.updatedAt)}
                        </span>
                      </button>
                      {selected ? (
                        <div className="archived-session-restore-popover">
                          <button
                            type="button"
                            className="project-session-menu-btn restore"
                            disabled={restoring}
                            onClick={() => requestRestoreArchivedSession(section.project.projectId, session)}
                          >
                            <span className={`codicon ${restoring ? 'codicon-loading codicon-modifier-spin' : 'codicon-debug-restart'}`} />
                            <span className="project-session-menu-label">Restore</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!archivedLoading && archivedSessionSections.length === 0 ? (
          <div className="wide-project-empty archived-session-empty">No archived sessions.</div>
        ) : null}
      </>
    );
    if (mobile) {
      return (
        <div className="mobile-project-session-nav archived-session-nav">
          {body}
        </div>
      );
    }
    return body;
  };

  const handleMobileChatQuickSwitchSelect = useCallback(async (targetProjectId: string, session: RegistryChatSession) => {
    setChatQuickSwitchMenuOpen(false);
    setPortRelayTargetMenuOpen(false);
    setSidebarSettingsOpen(false);
    setDrawerOpen(false);
    setTab('chat');
    const currentKey = selectedChatKeyRef.current;
    if (currentKey?.projectId === targetProjectId && currentKey.sessionId === session.sessionId) {
      return;
    }
    await selectProjectChatSession(targetProjectId, session.sessionId, {closeMobileDrawer: true});
  }, [selectProjectChatSession, setDrawerOpen, setSidebarSettingsOpen, setTab]);

  const handleChatQuickSwitchContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const result = resolveDesktopChatQuickSwitchContextMenu({
      desktopLayout: isWide,
      target: event.target,
      selectedText: window.getSelection()?.toString() ?? '',
      clientX: event.clientX,
      clientY: event.clientY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    if (!result.open) {
      return;
    }
    event.preventDefault();
    setPortRelayTargetMenuOpen(false);
    setChatQuickSwitchMenuPlacement({kind: 'desktop', style: result.style});
    setChatQuickSwitchMenuOpen(true);
  }, [isWide]);

  const handleProjectCreateSession = async (
    targetProjectId: string,
    agentType: string,
    options?: {closeMobileDrawer?: boolean},
  ): Promise<boolean> => {
    agentType = normalizeAgentTypeName(agentType);
    if (!targetProjectId || !agentType) {
      setError('No agent selected for new session');
      return false;
    }
    if (agentType.toLowerCase() === 'codex') {
      const draft = createDraftChatSession({
        projectId: targetProjectId,
        agentType,
      });
      updateProjectDraftSessions(targetProjectId, drafts => [draft, ...drafts]);
      const runtimeKey = buildChatRuntimeKey(targetProjectId, draft.draftId);
      chatMessageStoreRef.current[runtimeKey] = [];
      chatTurnStoreRef.current[runtimeKey] = createEmptyChatTurnStore();
      chatFinishedCursorRef.current[runtimeKey] = 0;
      selectDraftChatSession(targetProjectId, draft.draftId, options);
      startDraftSessionCreate(targetProjectId, agentType, draft.draftId)
        .catch(err => setError(err instanceof Error ? err.message : String(err)));
      return true;
    }
    try {
      const result = await service.createProjectSession(targetProjectId, agentType, '');
      if (!result.ok || !result.session.sessionId) {
        throw new Error('project session.create returned ok=false');
      }
      const session = result.session;
      registerCreatedProjectSession(targetProjectId, session);
      await selectProjectChatSession(targetProjectId, session.sessionId, options);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const handleWideProjectCreateSession = async (targetProjectId: string, agentType: string) => {
    await handleProjectCreateSession(targetProjectId, agentType);
  };

  const handleMobileProjectCreateSession = async (targetProjectId: string, agentType: string) => {
    await handleProjectCreateSession(targetProjectId, agentType, {closeMobileDrawer: true});
  };

  const getQuickSwitchProjectAgents = useCallback((targetProjectId: string): string[] => {
    const projectItem = visibleProjectItems.find(item => item.projectId === targetProjectId);
    if (!projectItem) {
      return [];
    }
    return getWideProjectAgents(projectItem, projectSessionsByProjectId[targetProjectId] ?? []);
  }, [getWideProjectAgents, projectSessionsByProjectId, visibleProjectItems]);

  const handleQuickSwitchToggleCreateProject = useCallback((targetProjectId: string) => {
    setChatQuickSwitchCreateProjectId(current => current === targetProjectId ? '' : targetProjectId);
  }, []);

  const handleQuickSwitchCreateSession = useCallback(async (targetProjectId: string, agentType: string) => {
    const pendingKey = `${targetProjectId}:${agentType}`;
    if (chatQuickSwitchCreatePendingKey) {
      return;
    }
    setChatQuickSwitchCreatePendingKey(pendingKey);
    const created = await handleProjectCreateSession(targetProjectId, agentType, {closeMobileDrawer: true});
    if (created) {
      setChatQuickSwitchMenuOpen(false);
      setChatQuickSwitchCreateProjectId('');
    }
    setChatQuickSwitchCreatePendingKey(current => current === pendingKey ? '' : current);
  }, [chatQuickSwitchCreatePendingKey, handleProjectCreateSession]);

  const handleWideProjectResumeAgent = async (targetProjectId: string, agentType: string) => {
    agentType = normalizeAgentTypeName(agentType);
    if (!targetProjectId || !agentType) {
      setError('No agent selected for resume');
      return;
    }
    setWideProjectActionMenu(current => ({
      projectId: targetProjectId,
      kind: 'resume',
      phase: 'sessions',
      agentType,
      popover: current?.projectId === targetProjectId && current.kind === 'resume'
        ? current.popover
        : null,
    }));
    setResumeLoading(true);
    setResumeSessions([]);
    try {
      const sessions = await service.listProjectResumableSessions(targetProjectId, agentType);
      setResumeSessions(sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setWideProjectActionMenu(null);
    } finally {
      setResumeLoading(false);
    }
  };

  const handleWideProjectResumeImport = async (targetProjectId: string, agentType: string, sessionId: string) => {
    agentType = normalizeAgentTypeName(agentType);
    if (!targetProjectId || !agentType || !sessionId) return;
    setResumeLoading(true);
    let importedSessionId = '';
    try {
      const imported = await service.importProjectResumedSession(targetProjectId, agentType, sessionId);
      if (!imported.ok || !imported.session.sessionId) {
        throw new Error('project session.resume.import returned ok=false');
      }
      importedSessionId = imported.session.sessionId;
      const session = imported.session;
      workspaceStore.rememberChatSession(targetProjectId, session, {turnIndex: 0});
      const selectedKey = chatSessionKeyFromParts(targetProjectId, importedSessionId);
      workspaceStore.rememberSelectedChatSessionKey(selectedKey);
      setResumeSessions(prev => prev.filter(item => item.sessionId !== sessionId));
      setProjectSessionsByProjectId(prev => ({
        ...prev,
        [targetProjectId]: mergeChatSession(prev[targetProjectId] ?? [], session),
      }));
      if (targetProjectId === projectIdRef.current) {
        setChatSessions(prev => mergeChatSession(prev, session));
      }
      const reloaded = await service.reloadProjectSession(targetProjectId, importedSessionId);
      if (!reloaded.ok) {
        throw new Error('project session.reload returned ok=false');
      }
      const runtimeKey = buildChatRuntimeKey(targetProjectId, importedSessionId);
      chatMessageStoreRef.current[runtimeKey] = [];
      chatTurnStoreRef.current[runtimeKey] = createEmptyChatTurnStore();
      chatFinishedCursorRef.current[runtimeKey] = 0;
      setTab('chat');
      applySelectedChatKey(selectedKey);
      setChatMessages([]);
      const loaded = await loadChatSession(importedSessionId, targetProjectId, { forceFull: true });
      if (!loaded) {
        throw new Error('Failed to load resumed session history');
      }
      setWideProjectActionMenu(null);
    } catch (err) {
      if (importedSessionId) {
        setWideProjectActionMenu(null);
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResumeLoading(false);
    }
  };

  const handleMobileProjectResumeAgent = async (targetProjectId: string, agentType: string) => {
    agentType = normalizeAgentTypeName(agentType);
    if (!targetProjectId || !agentType) {
      setError('No agent selected for resume');
      return;
    }
    setMobileProjectActionMenu({
      projectId: targetProjectId,
      kind: 'resume',
      phase: 'sessions',
      agentType,
    });
    setResumeLoading(true);
    setResumeSessions([]);
    try {
      const sessions = await service.listProjectResumableSessions(targetProjectId, agentType);
      setResumeSessions(sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMobileProjectActionMenu(null);
    } finally {
      setResumeLoading(false);
    }
  };

  const handleMobileProjectResumeImport = async (targetProjectId: string, agentType: string, sessionId: string) => {
    agentType = normalizeAgentTypeName(agentType);
    if (!targetProjectId || !agentType || !sessionId) return;
    setResumeLoading(true);
    let importedSessionId = '';
    try {
      const imported = await service.importProjectResumedSession(targetProjectId, agentType, sessionId);
      if (!imported.ok || !imported.session.sessionId) {
        throw new Error('project session.resume.import returned ok=false');
      }
      importedSessionId = imported.session.sessionId;
      const session = imported.session;
      workspaceStore.rememberChatSession(targetProjectId, session, {turnIndex: 0});
      workspaceStore.rememberSelectedChatSessionKey(chatSessionKeyFromParts(targetProjectId, importedSessionId));
      setResumeSessions(prev => prev.filter(item => item.sessionId !== sessionId));
      setProjectSessionsByProjectId(prev => ({
        ...prev,
        [targetProjectId]: mergeChatSession(prev[targetProjectId] ?? [], session),
      }));
      if (targetProjectId === projectIdRef.current) {
        setChatSessions(prev => mergeChatSession(prev, session));
      }
      const reloaded = await service.reloadProjectSession(targetProjectId, importedSessionId);
      if (!reloaded.ok) {
        throw new Error('project session.reload returned ok=false');
      }
      const runtimeKey = buildChatRuntimeKey(targetProjectId, importedSessionId);
      chatMessageStoreRef.current[runtimeKey] = [];
      chatTurnStoreRef.current[runtimeKey] = createEmptyChatTurnStore();
      chatFinishedCursorRef.current[runtimeKey] = 0;
      await selectProjectChatSession(targetProjectId, importedSessionId, {closeMobileDrawer: true});
    } catch (err) {
      if (importedSessionId) {
        setMobileProjectActionMenu(null);
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResumeLoading(false);
    }
  };

  const renderProjectSessionActionMenu = (targetProjectId: string, session: RegistrySessionSummary) => {
    const sessionId = session.sessionId;
    const sessionActionDisabled = !!session.running ||
      chatReloadingSessionId === sessionId ||
      chatArchivingSessionId === sessionId ||
      chatDeletingSessionId === sessionId;
    const renameActionDisabled = chatRenamingSessionId === sessionId;
    const actionsOpen = projectSessionActionMenu?.projectId === targetProjectId &&
      projectSessionActionMenu.sessionId === sessionId;
    return (
      <>
        {actionsOpen ? (
          <div
            className="project-session-action-menu"
            role="menu"
            style={projectSessionActionMenu.popover
              ? {
                  top: `${projectSessionActionMenu.popover.top}px`,
                  left: `${projectSessionActionMenu.popover.left}px`,
                  width: `${projectSessionActionMenu.popover.width}px`,
                  maxHeight: `${projectSessionActionMenu.popover.maxHeight}px`,
                  transform: projectSessionActionMenu.popover.placement === 'above'
                    ? 'translateY(-100%)'
                    : undefined,
                }
              : undefined}
          >
            <button
              type="button"
              className="project-session-menu-btn rename"
              role="menuitem"
              disabled={renameActionDisabled}
              onClick={event => {
                event.stopPropagation();
                requestRenameProjectSession(targetProjectId, session);
              }}
            >
              <span
                className={`codicon ${
                  chatRenamingSessionId === sessionId
                    ? 'codicon-loading codicon-modifier-spin'
                    : 'codicon-edit'
                }`}
              />
              <span className="project-session-menu-label">Rename</span>
            </button>
            <button
              type="button"
              className="project-session-menu-btn archive"
              role="menuitem"
              disabled={sessionActionDisabled}
              onClick={event => {
                event.stopPropagation();
                requestArchiveProjectSession(targetProjectId, session);
              }}
            >
              <span
                className={`codicon ${
                  chatArchivingSessionId === sessionId
                    ? 'codicon-loading codicon-modifier-spin'
                    : 'codicon-archive'
                }`}
              />
              <span className="project-session-menu-label">Archive</span>
            </button>
            <div className="project-session-menu-separator" aria-hidden="true" />
            <button
              type="button"
              className="project-session-menu-btn reload"
              role="menuitem"
              disabled={sessionActionDisabled}
              onClick={event => {
                event.stopPropagation();
                handleReloadProjectSession(targetProjectId, sessionId).catch(() => undefined);
              }}
            >
              <span
                className={`codicon ${
                  chatReloadingSessionId === sessionId
                    ? 'codicon-loading codicon-modifier-spin'
                    : 'codicon-refresh'
                }`}
              />
              <span className="project-session-menu-label">Reload</span>
            </button>
            <button
              type="button"
              className="project-session-menu-btn delete"
              role="menuitem"
              disabled={sessionActionDisabled}
              onClick={event => {
                event.stopPropagation();
                requestDeleteProjectSession(targetProjectId, session);
              }}
            >
              <span
                className={`codicon ${
                  chatDeletingSessionId === sessionId
                    ? 'codicon-loading codicon-modifier-spin'
                    : 'codicon-trash'
                }`}
              />
              <span className="project-session-menu-label">Delete</span>
            </button>
          </div>
        ) : null}
      </>
    );
  };

  const refreshProject = async (options?: {silent?: boolean}) => {
    const activeProjectId = projectIdRef.current || projectId;
    if (!connected || !activeProjectId) return;
    if (refreshInFlightRef.current) return;
    const finishRefreshProjectDiagnostic = startWorkspaceDiagnosticSpan('refresh_project', {
      projectId: activeProjectId,
      silent: options?.silent === true,
    });
    let refreshProjectError = '';
    let loadedSurface = 'file';
    refreshInFlightRef.current = true;
    const silent = !!options?.silent;
    const latestExpandedDirs = expandedDirsRef.current;
    const latestSelectedFile = selectedFileRef.current;
    if (!silent) {
      setRefreshingProject(true);
    }
    try {
      setProjects(await service.listProjects());
      const validated = await workspaceController.refreshProject(activeProjectId, [
        ...latestExpandedDirs,
      ], {disableFileCache});
      setDirEntries(validated.dirEntries);
      setExpandedDirs(validated.expandedDirs);
      dirHashRef.current = {};
      if (latestSelectedFile) {
        await readSelectedFile(latestSelectedFile);
      }
      if (tabRef.current === 'git') {
        const gitLoaded = await loadGitIfRevChanged();
        loadedSurface = gitLoaded ? 'git' : 'file';
      }
      if (!silent) {
        setHasPendingProjectUpdates(false);
      }
    } catch (err) {
      refreshProjectError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      refreshInFlightRef.current = false;
      if (!silent) {
        setRefreshingProject(false);
      }
      finishRefreshProjectDiagnostic({
        ok: !refreshProjectError,
        loadedSurface,
        ...(refreshProjectError ? {error: refreshProjectError} : {}),
      }, refreshProjectError ? 'error' : 'info');
    }
  };

  const rememberProjectSessionList = (
    targetProjectId: string,
    sessions: RegistryChatSession[],
  ) => {
    const listedSessions = sortChatSessions(sessions);
    reconcileCreatedDraftSessions(targetProjectId, listedSessions);
    const knownSessions = knownChatSessionsForProject(targetProjectId);
    const nextSessions = mergeChatSessionList(knownSessions, listedSessions);
    setProjectSessionsByProjectId(prev => ({
      ...prev,
      [targetProjectId]: mergeChatSessionList(
        prev[targetProjectId] ?? knownSessions,
        listedSessions,
      ),
    }));
    if (shouldUpdateCurrentProjectSessions(targetProjectId, projectIdRef.current)) {
      setChatSessions(prev => mergeChatSessionList(prev, listedSessions));
    }
    const cached = workspaceStore.hydrateChatSessions(targetProjectId);
    const cursorBySessionId: Record<string, {turnIndex: number}> = {};
    for (const entry of cached) {
      const sessionId = entry.session.sessionId;
      if (!sessionId) continue;
      const runtimeKey = buildChatRuntimeKey(targetProjectId, sessionId);
      cursorBySessionId[sessionId] = {
        turnIndex: chatFinishedCursorRef.current[runtimeKey] ?? entry.cursor.turnIndex,
      };
    }
    for (const session of nextSessions) {
      const sessionId = session.sessionId;
      if (!sessionId || cursorBySessionId[sessionId]) continue;
      const runtimeKey = buildChatRuntimeKey(targetProjectId, sessionId);
      cursorBySessionId[sessionId] = {
        turnIndex: chatFinishedCursorRef.current[runtimeKey] ?? 0,
      };
    }
    workspaceStore.replaceChatSessions(targetProjectId, nextSessions, cursorBySessionId);
  };

  const refreshChatProjectSessions = async (targetProjectId: string, options?: {force?: boolean}) => {
    if ((!options?.force && !connected && !connectInFlightRef.current) || !targetProjectId) return;
    if (chatProjectRefreshInFlightRef.current[targetProjectId]) {
      chatProjectRefreshDirtyRef.current[targetProjectId] = true;
      return;
    }
    chatProjectRefreshInFlightRef.current[targetProjectId] = true;
    try {
      do {
        chatProjectRefreshDirtyRef.current[targetProjectId] = false;
        try {
          const sessions = await service.listProjectSessions(targetProjectId);
          rememberProjectSessionList(targetProjectId, sessions);
          setMobileProjectSessionErrors(prev => {
            if (!prev[targetProjectId]) return prev;
            const next = {...prev};
            delete next[targetProjectId];
            return next;
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setMobileProjectSessionErrors(prev => ({
            ...prev,
            [targetProjectId]: message || 'Failed to refresh sessions',
          }));
        }
      } while (chatProjectRefreshDirtyRef.current[targetProjectId]);
    } finally {
      chatProjectRefreshInFlightRef.current[targetProjectId] = false;
    }
  };

  const refreshChatIndex = async (options?: {force?: boolean}) => {
    if (!options?.force && !connected && !connectInFlightRef.current) return;
    if (chatIndexFullRefreshInFlightRef.current) {
      chatIndexFullRefreshDirtyRef.current = true;
      return;
    }
    const finishRefreshDiagnostic = startWorkspaceDiagnosticSpan('refresh_chat_index', {
      force: options?.force === true,
    });
    let projectCount = 0;
    let refreshError = '';
    chatIndexFullRefreshInFlightRef.current = true;
    setMobileProjectSessionsRefreshing(true);
    try {
      do {
        chatIndexFullRefreshDirtyRef.current = false;
        const latestProjects = await service.listProjects();
        projectCount = latestProjects.length;
        setProjects(latestProjects);
        setHasPendingProjectUpdates(false);
        await Promise.all(
          latestProjects.map(projectItem =>
            refreshChatProjectSessions(projectItem.projectId, {force: options?.force === true}),
          ),
        );
      } while (chatIndexFullRefreshDirtyRef.current);
    } catch (err) {
      refreshError = err instanceof Error ? err.message : String(err);
      setError(refreshError);
    } finally {
      chatIndexFullRefreshInFlightRef.current = false;
      setMobileProjectSessionsRefreshing(false);
      finishRefreshDiagnostic({
        ok: !refreshError,
        projectCount,
        ...(refreshError ? {error: refreshError} : {}),
      }, refreshError ? 'error' : 'info');
    }
  };

  const applyPendingNotificationTarget = async () => {
    const target = pendingNotificationTargetRef.current;
    if (!target || !connected) {
      return;
    }
    if (!projectsRef.current.some(item => item.projectId === target.projectId)) {
      await refreshChatIndex({force: true});
      if (!projectsRef.current.some(item => item.projectId === target.projectId)) {
        return;
      }
    }
    pendingNotificationTargetRef.current = null;
    clearPromptCompletionNotificationTargetFromUrl();
    await refreshChatProjectSessions(target.projectId, {force: true});
    await selectProjectChatSession(target.projectId, target.sessionId);
  };

  useEffect(() => {
    applyPendingNotificationTarget().catch(() => undefined);
  }, [connected, projectIdListKey]);

  const refreshMobileChatProjectSessions = async () => {
    await refreshChatIndex();
  };

  useEffect(() => {
    const unsubscribeEvent = service.onEvent(event => {
      if (event.method === RegistryMethods.TerminalOutput && event.hubId) {
        const result = receiveTerminalOutput(
          terminalSyncRef.current,
          event.hubId,
          event.payload as RegistryTerminalOutputEvent,
        );
        commitTerminalSync(result.state);
        runTerminalEffects(result.effects).catch(() => undefined);
        return;
      }
      if (event.method === RegistryMethods.TerminalChanged && event.hubId) {
        const payload = event.payload as RegistryTerminalChangedEvent;
        const next = applyTerminalChanged(terminalSyncRef.current, event.hubId, payload);
        commitTerminalSync(next);
        if (payload.change === 'closed') {
          const closedKey = `${event.hubId}:${payload.terminalId}`;
          terminalResizeTokensRef.current.delete(closedKey);
          if (activeTerminalKeyRef.current === closedKey) {
            const nextKey = Object.keys(next.terminals)[0] ?? '';
            activeTerminalKeyRef.current = nextKey;
            setActiveTerminalKey(nextKey);
          }
        } else if (
          activeTerminalKeyRef.current === `${event.hubId}:${payload.terminalId}` &&
          payload.terminal?.runId !== terminalSyncRef.current.attached[activeTerminalKeyRef.current]?.runId
        ) {
          terminalRefreshRef.current(activeTerminalKeyRef.current).catch(() => undefined);
        }
        return;
      }
      if (isSpeechTranscriptEvent(event)) {
        const payload = event.payload;
        if (payload) {
          handleVoiceSpeechTranscriptEvent(payload);
        }
        return;
      }
      if (isSpeechErrorEvent(event)) {
        const payload = event.payload;
        if (!payload || (payload.streamId && payload.streamId !== voiceStreamIdRef.current)) {
          return;
        }
        handleVoiceSpeechErrorEvent(payload);
        return;
      }
      const eventProjectId = event.projectId ?? '';
      if (event.method === RegistryMethods.RegistryProjectReport) {
        const payload = (event.payload ?? {}) as {
          hubId?: string;
          projectId?: string;
          project?: Partial<RegistryProject>;
        };
        const reportedProjectId = typeof payload.projectId === 'string' && payload.projectId
          ? payload.projectId
          : eventProjectId;
        const reportedProject = payload.project;
        if (!reportedProjectId || !reportedProject || typeof reportedProject.name !== 'string' || !reportedProject.name) {
          return;
        }
        const reportedHubId = typeof payload.hubId === 'string' && payload.hubId
          ? payload.hubId
          : reportedProject.hubId;
        const nextProject: RegistryProject = {
          ...reportedProject,
          projectId: reportedProjectId,
          name: reportedProject.name,
          online: reportedProject.online === true,
          path: typeof reportedProject.path === 'string' ? reportedProject.path : '',
          ...(reportedHubId ? {hubId: reportedHubId} : {}),
        };
        setProjects(prev => {
          let updated = false;
          const next = prev.map(item => {
            if (item.projectId !== reportedProjectId) {
              return item;
            }
            updated = true;
            return {...item, ...nextProject};
          });
          return updated ? next : [...next, nextProject];
        });
        if (!eventProjectId || reportedProjectId === projectIdRef.current) {
          setHasPendingProjectUpdates(true);
        }
        return;
      }
      if (event.method === 'session.updated') {
        if (!eventProjectId) {
          return;
        }
        if (!projectsRef.current.some(item => item.projectId === eventProjectId)) {
          refreshChatIndex().catch(() => undefined);
          return;
        }
        const payload = (event.payload ?? {}) as {
          session?: RegistryChatSession;
        };
        if (payload.session?.sessionId) {
          reconcileCreatedDraftSessions(eventProjectId, [payload.session]);
          const runtimeKey = buildChatRuntimeKey(eventProjectId, payload.session.sessionId);
          if (payload.session.running === false) {
            setChatCancellingRuntimeKey(current => (current === runtimeKey ? '' : current));
          }
          const mergedSession = mergeKnownChatSessionForProject(eventProjectId, payload.session);
          rememberChatSessionSummary(eventProjectId, mergedSession);
          workspaceStore.rememberChatSession(eventProjectId, mergedSession, {
            turnIndex: chatFinishedCursorRef.current[runtimeKey] ?? 0,
          });
        }
        return;
      }
      if (event.method === 'session.message') {
        if (!eventProjectId) {
          return;
        }
        if (!projectsRef.current.some(item => item.projectId === eventProjectId)) {
          refreshChatIndex().catch(() => undefined);
          return;
        }
        const payload = (event.payload ?? {}) as RegistryChatMessageEventPayload;
        const normalizedPayload = normalizeSessionMessagePayload(payload);
        const message = normalizedPayload
          ? decodeSessionTurnToMessage(normalizedPayload.sessionId, normalizedPayload.turn)
          : decodeSessionMessageFromEventPayload(payload);
        if (!message) {
          return;
        }
        const sessionId = message.sessionId;
        const runtimeKey = buildChatRuntimeKey(eventProjectId, sessionId);
        if (message.method === 'session_operation') {
          const operationId = typeof message.param.operationId === 'string' ? message.param.operationId : '';
          const operationType = typeof message.param.type === 'string' ? message.param.type : '';
          const operationStatus = typeof message.param.status === 'string' ? message.param.status : '';
          if (operationType === 'compact' && operationId) {
            if (operationStatus === 'queued' || operationStatus === 'started') {
              setRuntimeCompacting(runtimeKey, true);
            } else if (operationStatus === 'completed' || operationStatus === 'failed') {
              terminalCompactionOperationIdsRef.current.add(operationId);
              setRuntimeCompacting(runtimeKey, false);
            }
          }
        }
        const isSelectedSession = encodeChatSessionKey(selectedChatKeyRef.current) === runtimeKey;
        const knownProjectSessions = projectSessionsByProjectIdRef.current[eventProjectId] ?? [];
        const knownSession = knownProjectSessions.some(session => session.sessionId === sessionId);
        if (!knownSession && !isSelectedSession) {
          refreshChatProjectSessions(eventProjectId).catch(() => undefined);
        }
        const existingSession = knownProjectSessions.find(item => item.sessionId === sessionId);
        maybeNotifyPromptCompletion(message, existingSession, eventProjectId);

        const turnState = ensureChatTurnStore(runtimeKey);
        const incomingTurn = normalizedPayload?.turn ?? {
          turnIndex: message.turnIndex ?? 0,
          content: JSON.stringify({method: message.method, param: message.param}),
          finished: message.finished === true,
        };
        const gapReadCursor = shouldReadRepairForIncomingTurn(turnState, incomingTurn);
        mergeRealtimeTurn(turnState, incomingTurn);
        const latestSyncCursor = turnState.cursor;
        chatFinishedCursorRef.current[runtimeKey] = latestSyncCursor.turnIndex;
        if (incomingTurn.finished) {
          markChatSessionTurnsDirty(runtimeKey);
        }

        let merged: RegistryChatMessage[] | null = null;
        if (shouldMaterializeRealtimeSessionMessages(isSelectedSession)) {
          merged = messagesFromTurnStore(runtimeKey, sessionId);
          chatMessageStoreRef.current[runtimeKey] = merged;
          setVisibleChatMessagesForRuntimeKey(runtimeKey, merged, {
            followLatest: chatAutoScrollFollowRef.current,
          });
        }
        if (gapReadCursor) {
          chatReadRepairQueueRef.current.request(runtimeKey, gapReadCursor.turnIndex, async cursor => {
            chatFinishedCursorRef.current[runtimeKey] = cursor;
            await refreshSessionTurns(sessionId, eventProjectId);
          }).catch(() => undefined);
        }
        if (message.method === 'prompt_request') {
          forgetPendingChatPrompt(runtimeKey);
        }
        if (message.method === 'prompt_done' && isSelectedSession) {
          setChatCancellingRuntimeKey(current => (current === runtimeKey ? '' : current));
          markChatSessionRead(
            eventProjectId,
            sessionId,
            message.turnIndex ?? 0,
          ).catch(() => undefined);
        }
        if (
          message.method === 'prompt_done' &&
          isSelectedSession &&
          merged &&
          needsPromptTurnRefresh(merged, message)
        ) {
          refreshSessionTurns(
            sessionId,
            eventProjectId,
            runtimeKey,
          ).catch(() => undefined);
        }
        if (message.method === 'prompt_request' || message.method === 'prompt_done') {
          setRecentSessionsTick(t => t + 1);
        }
      }
    });
    const unsubscribeClose = service.onClose(() => {
      connectedRef.current = false;
      setConnected(false);
      chatQueuedPromptsByKeyRef.current = {};
      setChatQueuedPromptsByKey({});
      chatCompactingByKeyRef.current = {};
      setChatCompactingByKey({});
      terminalCompactionOperationIdsRef.current.clear();
      const terminalHubIds = Array.from(new Set(Object.values(terminalSyncRef.current.terminals).map(item => item.hubId)));
      commitTerminalSync(markTerminalsUnavailable(terminalSyncRef.current, terminalHubIds));
      if (isVoiceInputActive()) {
        handleVoiceRegistryClosedDuringInput('close');
      }
      if (supervisorManagedCloseRef.current) {
        supervisorManagedCloseRef.current = false;
        return;
      }
      const canSilentReconnect =
        !!projectIdRef.current;
      if (!canSilentReconnect) {
        reconnectStartedAtRef.current = null;
        setReconnecting(false);
        setError(
          'Registry connection closed. Reconnect to resume live updates.',
        );
        return;
      }
      if (reconnectStartedAtRef.current === null) {
        reconnectStartedAtRef.current = Date.now();
      }
      setError('');
      setReconnecting(true);
      scheduleReconnectAttempt();
    });

    return () => {
      unsubscribeEvent();
      unsubscribeClose();
    };
  }, []);

  const renderSidebarMain = (showSectionTitle = true) => {
    if (tab === 'file') {
      return (
        <FileExplorerTree
          isWide={isWide}
          showSectionTitle={showSectionTitle}
          projects={projects}
          projectId={projectId}
          currentProjectName={currentProjectName}
          sortedProjectItems={sortedProjectItems}
          workspaceProjectMenuOpen={workspaceProjectMenuOpen}
          setWorkspaceProjectMenuOpen={setWorkspaceProjectMenuOpen}
          syncWorkspaceProject={syncWorkspaceProject}
          dirEntries={dirEntries}
          loadingDirs={loadingDirs}
          selectedFile={selectedFile}
          setSelectedFile={setSelectedFile}
          setDrawerOpen={setDrawerOpen}
          isExpanded={isExpanded}
          toggleDirectory={toggleDirectory}
          resolveFileIcon={resolveFileIcon}
        />
      );
    }
    if (tab !== 'git') {
      return null;
    }

    return (
      <GitSidebar
        isWide={isWide}
        projects={projects}
        projectId={projectId}
        currentProjectName={currentProjectName}
        sortedProjectItems={sortedProjectItems}
        workspaceProjectMenuOpen={workspaceProjectMenuOpen}
        setWorkspaceProjectMenuOpen={setWorkspaceProjectMenuOpen}
        syncWorkspaceProject={syncWorkspaceProject}
        gitBranchMenuRef={gitBranchMenuRef}
        gitBranchPickerOpen={gitBranchPickerOpen}
        setGitBranchPickerOpen={setGitBranchPickerOpen}
        gitBranches={gitBranches}
        gitCurrentBranch={gitCurrentBranch}
        gitSelectedBranches={gitSelectedBranches}
        toggleGitBranchSelection={toggleGitBranchSelection}
        loadGit={loadGit}
        gitLoading={gitLoading}
        gitError={gitError}
        workingTreeFiles={workingTreeFiles}
        worktreeExpanded={worktreeExpanded}
        setWorktreeExpanded={setWorktreeExpanded}
        selectedDiff={selectedDiff}
        selectedDiffScope={selectedDiffScope}
        selectedDiffSource={selectedDiffSource}
        setSelectedDiff={setGitSelectedDiff}
        setSelectedDiffScope={setGitSelectedDiffScope}
        setSelectedDiffSource={setGitSelectedDiffSource}
        setDrawerOpen={setDrawerOpen}
        commits={commits}
        selectedCommit={selectedCommit}
        setSelectedCommit={setGitSelectedCommit}
        expandedCommitShas={expandedCommitShas}
        setExpandedCommitShas={setExpandedCommitShas}
        commitFilesBySha={commitFilesBySha}
        commitPopover={commitPopover}
        setCommitPopover={setCommitPopover}
        commitPopoverRef={commitPopoverRef}
      />
    );
  };
  const renderSettingsDetailActions = (detail: SettingsDetailId): React.ReactNode => {
    if (detail === 'skills') {
      return (
        <button
          type="button"
          className="token-stats-refresh-btn token-stats-refresh-inline"
          onClick={() => refreshSkillManagement().catch(() => undefined)}
          disabled={skillsLoading}
        >
          {skillsLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      );
    }
    if (detail === 'update') {
      return (
        <button
          type="button"
          className="token-stats-refresh-btn token-stats-refresh-inline"
          onClick={() => {
            refreshWheelMakerUpdates({force: true}).catch(() => undefined);
            refreshAgentPackages().catch(() => undefined);
          }}
          disabled={wheelMakerUpdatesLoading || agentPackagesLoading}
        >
          {wheelMakerUpdatesLoading || agentPackagesLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      );
    }
    if (detail === 'tokenStats') {
      return (
        <button
          type="button"
          className="token-stats-refresh-btn token-stats-refresh-inline"
          onClick={() => {
            refreshTokenStats().catch(() => undefined);
          }}
          disabled={tokenStatsLoading}
        >
          {tokenStatsLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      );
    }
    if (detail === 'database') {
      return (
        <button
          type="button"
          className="git-section-btn"
          onClick={exportDatabaseDump}
          disabled={databaseLoading || !!databaseError || !databaseDumpText}
          title="Export current database dump"
        >
          Export
        </button>
      );
    }
    if (detail === 'portRelay') {
      return (
        <button
          type="button"
          className="token-stats-refresh-btn token-stats-refresh-inline"
          onClick={() => refreshPortRelayStatus().catch(() => undefined)}
          disabled={portRelayLoading}
        >
          {portRelayLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      );
    }
    return null;
  };

  const renderSettingsDetailShell = (
    title: string,
    content: React.ReactNode,
    actions?: React.ReactNode,
    options: SettingsDetailShellOptions = {},
  ) => (
    <SettingsDetailShell
      title={title}
      actions={actions}
      hideDetailHeader={options.hideDetailHeader}
      onBack={handleSettingsDetailBack}
    >
      {content}
    </SettingsDetailShell>
  );

  const renderSkillsSettingsDetail = (options?: SettingsDetailShellOptions) =>
    renderSettingsDetailShell(
      'Skills',
      <React.Suspense fallback={null}>
        <SkillsSettingsDetail
          skillHubs={skillHubs}
          skillsLoading={skillsLoading}
          skillsError={skillsError}
          skillsPendingKey={skillsPendingKey}
          skillInstallTarget={skillInstallTarget}
          sameSkillInstallTarget={sameSkillInstallTarget}
          skillSourceInput={skillSourceInput}
          setSkillSourceInput={setSkillSourceInput}
          skillSourceLoading={skillSourceLoading}
          skillSourceError={skillSourceError}
          skillSourceCandidates={skillSourceCandidates}
          skillSourceSelectedNames={skillSourceSelectedNames}
          closeSkillInstallPanel={closeSkillInstallPanel}
          listSkillSource={listSkillSource}
          toggleAllSkillSourceCandidates={toggleAllSkillSourceCandidates}
          toggleSkillSourceCandidate={toggleSkillSourceCandidate}
          requestSkillInstallConfirm={requestSkillInstallConfirm}
          requestSkillInstall={requestSkillInstall}
          requestSkillUpdate={requestSkillUpdate}
          requestSkillUninstall={requestSkillUninstall}
          requestSkillBatchUninstall={requestSkillBatchUninstall}
          requestSkillDetail={requestSkillDetail}
          skillDetailTarget={skillDetailTarget}
          skillActionPendingKey={skillActionPendingKey}
        />
      </React.Suspense>,
      renderSettingsDetailActions('skills'),
      options,
    );

  const renderSkillDetailPanel = () => (
    <React.Suspense fallback={null}>
      <SkillDetailPanel
        skillDetailTarget={skillDetailTarget}
        skillDetailCache={skillDetailCache}
        skillsPendingKey={skillsPendingKey}
        closeSkillDetail={closeSkillDetail}
        requestSkillUninstall={requestSkillUninstall}
        skillActionPendingKey={skillActionPendingKey}
      />
    </React.Suspense>
  );

  const renderSkillDetailSettingsDetail = (options?: SettingsDetailShellOptions) =>
    renderSettingsDetailShell(
      skillDetailTarget?.skillName || 'Skill Detail',
      renderSkillDetailPanel(),
      undefined,
      options,
    );

  const renderUpdateSettingsDetail = (options?: SettingsDetailShellOptions) =>
    renderSettingsDetailShell(
      'Update',
      <React.Suspense fallback={null}>
        <UpdateSettingsDetail
          androidApkUpdateSupported={androidApkUpdateSupported}
          androidApkLocalRelease={androidApkLocalRelease}
          androidApkLatestRelease={androidApkLatestRelease}
          androidApkUpdateLoading={androidApkUpdateLoading}
          androidApkUpdateError={androidApkUpdateError}
          androidApkInstallStatus={androidApkInstallStatus}
          androidApkInstallPending={androidApkInstallPending}
          refreshAndroidApkUpdate={refreshAndroidApkUpdate}
          requestAndroidApkInstall={requestAndroidApkInstall}
          updateHubCards={updateHubCards}
          projectIndexByHubId={projectIndexByHubId}
          projects={projects}
          wheelMakerUpdatesLoading={wheelMakerUpdatesLoading}
          wheelMakerUpdatesError={wheelMakerUpdatesError}
          wheelMakerUpdatePendingHubId={wheelMakerUpdatePendingHubId}
          wheelMakerUpdateAllPending={wheelMakerUpdateAllPending}
          requestWheelMakerUpdatePublish={requestWheelMakerUpdatePublish}
          requestWheelMakerUpdateAll={requestWheelMakerUpdateAll}
          agentPackagesLoading={agentPackagesLoading}
          agentPackagesError={agentPackagesError}
          agentPackageActionPendingKey={agentPackageActionPendingKey}
          agentPackageHubUpdatePendingId={agentPackageHubUpdatePendingId}
          expandedNpmUpdateHubIds={expandedNpmUpdateHubIds}
          setExpandedNpmUpdateHubIds={setExpandedNpmUpdateHubIds}
          requestAgentPackageAction={requestAgentPackageAction}
          requestAgentPackageHubUpdate={requestAgentPackageHubUpdate}
          projectIndexLoading={projectIndexLoading}
          projectIndexError={projectIndexError}
          projectIndexScanPendingByProjectId={projectIndexScanPendingByProjectId}
          projectIndexScanAllPendingByHubId={projectIndexScanAllPendingByHubId}
          expandedProjectIndexHubIds={expandedProjectIndexHubIds}
          setExpandedProjectIndexHubIds={setExpandedProjectIndexHubIds}
          handleScanProjectIndex={handleScanProjectIndex}
          handleScanAllProjectIndexes={handleScanAllProjectIndexes}
          tagVariantClass={tagVariantClass}
          hubAccentStyle={hubAccentStyle}
          shortGitSha={shortGitSha}
          wheelMakerBehindCopy={wheelMakerBehindCopy}
          wheelMakerReleaseRef={wheelMakerReleaseRef}
          formatWheelMakerDateTime={formatWheelMakerDateTime}
          formatChatAttachmentSize={formatChatAttachmentSize}
          androidApkUpdateStatusLabel={androidApkUpdateStatusLabel}
          androidApkInstallStatusLabel={androidApkInstallStatusLabel}
          agentPackageActionForPackage={agentPackageActionForPackage}
          agentPackageActionKey={agentPackageActionKey}
          agentPackageActionLabel={agentPackageActionLabel}
          projectFileIndexStatusLabel={projectFileIndexStatusLabel}
        />
      </React.Suspense>,
      renderSettingsDetailActions('update'),
      options,
    );

  const renderTokenStatsSettingsDetail = (options?: SettingsDetailShellOptions) =>
    renderSettingsDetailShell(
      'Token Stats',
      <React.Suspense fallback={null}>
        <TokenStatsSettingsDetail
          providers={tokenStatsProviders}
          updatedAt={tokenStatsUpdatedAt}
          loading={tokenStatsLoading}
          error={tokenStatsError}
          tagVariantClass={tokenTagVariantClass}
          hubAccentStyle={hubAccentStyle}
        />
      </React.Suspense>,
      renderSettingsDetailActions('tokenStats'),
      options,
    );

  const renderDatabaseSettingsDetail = (options?: SettingsDetailShellOptions) =>
    renderSettingsDetailShell(
      'Database',
      <React.Suspense fallback={null}>
        <DatabaseSettingsDetail
          loading={databaseLoading}
          error={databaseError}
          dumpText={databaseDumpText}
          storageStats={databaseStorageStats}
        />
      </React.Suspense>,
      renderSettingsDetailActions('database'),
      options,
    );

  const renderPortRelaySettingsDetail = (options?: SettingsDetailShellOptions) => {
    const hubIds = deriveRegistryHubIds(registryHubs);
    return renderSettingsDetailShell(
      'Port Relay',
      <React.Suspense fallback={null}>
        <PortRelaySettingsDetail
          hubIds={hubIds}
          portRelaySnapshot={portRelaySnapshot}
          portRelayError={portRelayError}
          portRelayLoading={portRelayLoading}
          portRelayListenPort={portRelayListenPort}
          setPortRelayListenPort={setPortRelayListenPort}
          persistPortRelaySettings={persistPortRelaySettings}
          portRelayAccessCodeUnknown={portRelayAccessCodeUnknown}
          portRelayAccessCode={portRelayAccessCode}
          regeneratePortRelayAccessCode={regeneratePortRelayAccessCode}
          copyPortRelayAccessCode={copyPortRelayAccessCode}
          clearPortRelaySiteData={clearPortRelaySiteData}
          portRelayCodeCopied={portRelayCodeCopied}
          portRelayTargets={portRelayTargets}
          selectedPortRelayTarget={selectedPortRelayTarget}
          selectPortRelayTarget={selectPortRelayTarget}
          deletePortRelayTarget={deletePortRelayTarget}
          portRelayDraftHubId={portRelayDraftHubId}
          setPortRelayDraftHubId={setPortRelayDraftHubId}
          portRelayDraftPort={portRelayDraftPort}
          setPortRelayDraftPort={setPortRelayDraftPort}
          commitPortRelayDraftTarget={commitPortRelayDraftTarget}
          enablePortRelay={enablePortRelay}
          disablePortRelay={disablePortRelay}
        />
      </React.Suspense>,
      renderSettingsDetailActions('portRelay'),
      options,
    );
  };

  const renderDebugLogsSettingsDetail = (options?: SettingsDetailShellOptions) =>
    renderSettingsDetailShell(
      'Logs',
      <React.Suspense fallback={null}>
        <DebugLogsSettingsDetail
          logLevel={logLevel}
          uploadDebugLog={payload => service.uploadDebugLog(payload)}
        />
      </React.Suspense>,
      undefined,
      options,
    );

  const renderConnectionStatusSettingsDetail = (options?: SettingsDetailShellOptions) =>
    renderSettingsDetailShell(
      'Connection Status',
      <React.Suspense fallback={null}>
        <ConnectionStatusSettingsDetail
          connected={connected}
          reconnecting={reconnecting}
          autoConnecting={autoConnecting}
          baseURL={document.baseURI}
          speechEnabled={voiceInputEnabled}
          androidNativeHost={isAndroidNativeSpeechHost()}
          androidNativeAvailable={!!getAndroidNativeSpeechBridge()}
        />
      </React.Suspense>,
      undefined,
      options,
    );

  const renderDeviceSessionsSettingsDetail = (options?: SettingsDetailShellOptions) =>
    renderSettingsDetailShell(
      'Devices',
      <React.Suspense fallback={null}>
        <DeviceSessionsSettingsDetail
          sessions={deviceSessions}
          loading={deviceSessionsLoading}
          error={deviceSessionsError}
          onRevoke={revokeDeviceSession}
          onRevokeAll={revokeAllDeviceSessions}
          onCurrentRevoked={returnToRegistryLogin}
        />
      </React.Suspense>,
      undefined,
      options,
    );

  const renderSettingsDetailContent = (
    detail: SettingsDetailId,
    options: SettingsDetailShellOptions = {},
  ) => {
    if (detail === 'update') {
      return renderUpdateSettingsDetail(options);
    }
    if (detail === 'skills') {
      return renderSkillsSettingsDetail(options);
    }
    if (detail === 'skillDetail') {
      return renderSkillDetailSettingsDetail(options);
    }
    if (detail === 'tokenStats') {
      return renderTokenStatsSettingsDetail(options);
    }
    if (detail === 'database') {
      return renderDatabaseSettingsDetail(options);
    }
    if (detail === 'portRelay') {
      return renderPortRelaySettingsDetail(options);
    }
    if (detail === 'connectionStatus') {
      return renderConnectionStatusSettingsDetail(options);
    }
    if (detail === 'deviceSessions') {
      return renderDeviceSessionsSettingsDetail(options);
    }
    if (detail === 'debugLogs') {
      return renderDebugLogsSettingsDetail(options);
    }
    return null;
  };

  const renderSettingsRootContent = (showSectionTitle: boolean) => (
    <React.Suspense fallback={null}>
      <SettingsRootContent
        showSectionTitle={showSectionTitle}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        isWide={isWide}
        chatViewWidth={chatViewWidth}
        setChatViewWidth={setChatViewWidth}
        sessionListDensity={sessionListDensity}
        setSessionListDensity={setSessionListDensity}
        mobileEnterKeyBehavior={mobileEnterKeyBehavior}
        setMobileEnterKeyBehavior={setMobileEnterKeyBehavior}
        hideToolCalls={hideToolCalls}
        setHideToolCalls={setHideToolCalls}
        promptCompletionNotificationsEnabled={promptCompletionNotificationsEnabled}
        setPromptCompletionNotificationsEnabled={setPromptCompletionNotificationsEnabled}
        handlePromptCompletionNotificationsChange={handlePromptCompletionNotificationsChange}
        notificationPermissionState={notificationPermissionState}
        serverSettings={serverSettings}
        serverSettingsBusy={serverSettingsBusy}
        serverSettingsError={serverSettingsError}
        updateServerSetting={updateServerSetting}
        chatFont={chatFont}
        setChatFont={setChatFont}
        openSettingsChild={openSettingsChild}
        codeTheme={codeTheme}
        setCodeTheme={setCodeTheme}
        codeFont={codeFont}
        setCodeFont={setCodeFont}
        codeFontSize={codeFontSize}
        setCodeFontSize={setCodeFontSize}
        clampCodeFontSize={clampCodeFontSize}
        codeLineHeight={codeLineHeight}
        setCodeLineHeight={setCodeLineHeight}
        clampCodeLineHeight={clampCodeLineHeight}
        codeTabSize={codeTabSize}
        setCodeTabSize={setCodeTabSize}
        clampCodeTabSize={clampCodeTabSize}
        messageViewerEnabled={messageViewerEnabled}
        setMessageViewerEnabled={setMessageViewerEnabled}
        logLevel={logLevel}
        setLogLevel={setLogLevel}
        disableFileCache={disableFileCache}
        setDisableFileCache={setDisableFileCache}
        requestClearLocalCache={requestClearLocalCache}
        handleRegistryDebugLogout={handleRegistryDebugLogout}
      />
    </React.Suspense>
  );

  const renderSettingsContent = (
    showSectionTitle: boolean,
    options: SettingsDetailShellOptions = {},
  ) => (
    <SettingsSurface
      detailView={settingsDetailView}
      options={options}
      renderRoot={() => renderSettingsRootContent(showSectionTitle)}
      renderDetail={renderSettingsDetailContent}
    />
  );

  const renderChatMenuSettingsButton = () => (
    <button
      type="button"
      className="chat-menu-icon-button chat-menu-settings-button"
      onClick={handleDesktopSettingsSelect}
      title="Open settings"
      aria-label="Open settings"
    >
      <span className="codicon codicon-settings-gear" aria-hidden="true" />
    </button>
  );

  const renderChatSessionHeader = (mobile: boolean) => {
    const chatSessionHeaderClassName = `sidebar-title-row chat-session-header${sessionSearchHeaderExpanded ? ' search-open' : ''}${mobile ? ' mobile' : ''}`;
    const chatSessionHeaderContent = (
      <>
        {!sessionSearchHeaderExpanded ? renderChatMenuSettingsButton() : null}
        <div className="chat-sidebar-title-actions">
          {renderChatHubSummary()}
          {renderChatArchiveControls()}
          {renderChatHeaderSearchControls()}
        </div>
      </>
    );
    if (mobile) {
      return <div className={chatSessionHeaderClassName}>{chatSessionHeaderContent}</div>;
    }
    return (
      <DesktopDragRegion className={chatSessionHeaderClassName}>
        {chatSessionHeaderContent}
      </DesktopDragRegion>
    );
  };

  const renderMobileChatSessionSheet = () => {
    return (
      <>
        {renderChatSessionHeader(true)}
        {renderArchiveBatchStatus()}
        {archivedMode ? renderArchivedSessionRows(true) : sessionSearchActive ? renderSessionSearchResults(true) : (
        <ChatSessionNav className="mobile-project-session-nav">
          {projects.length === 0 ? (
            <div className="chat-empty-hint chat-empty-state">
              <span className="codicon codicon-inbox" aria-hidden="true" />
              <span>No projects available.</span>
            </div>
          ) : null}
          {renderRecentSessionsSection(true)}
          {visibleProjectItems.map(projectItem => {
            const targetProjectId = projectItem.projectId;
            const projectSessions = projectSessionsByProjectId[targetProjectId] ?? [];
            const collapsed = collapsedProjectIds.includes(targetProjectId);
            const pinnedProject = pinnedProjectIds.includes(targetProjectId);
            const projectHub = projectItem.hubId || 'local';
            const projectHubVariant = tagVariantClass('wide-project-hub', projectItem.hubId || 'local');
            const sessionError = mobileProjectSessionErrors[targetProjectId] ?? '';
            return (
              <div
                key={`mobile-project:${targetProjectId}`}
                  className={`wide-project-section mobile-project-section${targetProjectId === projectId ? ' active' : ''}${pinnedProject ? ' pinned' : ''}${
                  collapsed ? ' collapsed' : ''
                }`}
              >
                <div className="wide-project-row mobile-project-row">
                  <button
                    type="button"
                    className="wide-project-toggle mobile-project-toggle"
                    onPointerDown={event => startProjectPinLongPress(targetProjectId, event)}
                    onPointerUp={finishProjectPinLongPress}
                    onPointerCancel={finishProjectPinLongPress}
                    onPointerLeave={finishProjectPinLongPress}
                    onContextMenu={event => event.preventDefault()}
                    onClick={event => {
                      if (consumeProjectPinLongPressClick(targetProjectId, event)) {
                        return;
                      }
                      toggleWideProjectCollapsed(targetProjectId);
                    }}
                    title={collapsed ? 'Expand project' : 'Collapse project'}
                    aria-expanded={!collapsed}
                  >
                    <span className="wide-project-folder-wrap">
                      <span
                        className={`codicon ${collapsed ? 'codicon-folder' : 'codicon-folder-opened'} wide-project-folder-icon ${projectHubVariant}`}
                        style={hubAccentStyle(projectHub)}
                      />
                      {pinnedProject ? (
                        <span className="codicon codicon-pinned wide-project-pin-badge" aria-hidden="true" />
                      ) : null}
                    </span>
                    <span className="wide-project-title-group">
                      <span className="wide-project-name" title={projectItem.name}>
                        {projectItem.name}
                      </span>
                      <span
                        className={`wide-project-hub-tag ${projectHubVariant}`}
                        style={hubAccentStyle(projectHub)}
                      >
                        <span className="wide-project-hub-dot" aria-hidden="true" />
                        <span className="wide-project-hub-label">{projectHub}</span>
                      </span>
                    </span>
                  </button>
                  <div className="wide-project-actions mobile-project-actions">
                    <button
                      type="button"
                      className="wide-project-action-btn"
                      title="New session"
                      aria-label={`New session in ${projectItem.name}`}
                      onPointerDown={event => event.stopPropagation()}
                      onClick={event => {
                        event.stopPropagation();
                        openMobileProjectActionMenu(targetProjectId, 'new');
                      }}
                    >
                      <span className="codicon codicon-add" />
                    </button>
                    <button
                      type="button"
                      className="wide-project-action-btn"
                      title="Resume session"
                      aria-label={`Resume session in ${projectItem.name}`}
                      onPointerDown={event => event.stopPropagation()}
                      onClick={event => {
                        event.stopPropagation();
                        openMobileProjectActionMenu(targetProjectId, 'resume');
                      }}
                    >
                      <span className="codicon codicon-history" />
                    </button>
                  </div>
                </div>
                {sessionError ? (
                  <div className="mobile-project-session-error">
                    <span>Session refresh failed.</span>
                    <button
                      type="button"
                      onClick={() => refreshMobileChatProjectSessions().catch(() => undefined)}
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
                {!collapsed ? (
                  <div className="wide-project-session-list mobile-project-session-list">
                    {renderProjectSessionRowsWithOlderFolding(targetProjectId, projectSessions, true)}
                    {projectSessions.length === 0 ? (
                      <div className="wide-project-empty">No sessions yet.</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {renderHiddenProjectRows(true)}
        </ChatSessionNav>
        )}
        {(() => {
          if (!mobileProjectActionMenu) return null;
          const sheetMenu = mobileProjectActionMenu;
          const sheetProject = sortedProjectItems.find(p => p.projectId === sheetMenu.projectId);
          if (!sheetProject) return null;
          const sheetProjectSessions = projectSessionsByProjectId[sheetMenu.projectId] ?? [];
          const sheetAgents = getWideProjectAgents(sheetProject, sheetProjectSessions);
          return (
            <>
              <div
                className="mobile-project-sheet-overlay"
                onClick={() => setMobileProjectActionMenu(null)}
                aria-hidden="true"
              />
              <div
                className="mobile-project-sheet"
                role="dialog"
                aria-modal="true"
                aria-label={sheetMenu.kind === 'new' ? 'New session' : 'Resume session'}
              >
                <div className="mobile-project-sheet-grip" aria-hidden="true" />
                <div className="mobile-project-sheet-header">
                  <span
                    className={`codicon ${sheetMenu.kind === 'new' ? 'codicon-add' : 'codicon-history'} mobile-project-sheet-icon`}
                    aria-hidden="true"
                  />
                  <span className="mobile-project-sheet-title-copy">
                    <span className="mobile-project-sheet-title">
                      {sheetMenu.kind === 'new' ? 'New Session' : 'Resume Session'}
                    </span>
                    <span className="mobile-project-sheet-subtitle">{sheetProject.name}</span>
                  </span>
                  <button
                    type="button"
                    className="mobile-project-sheet-close"
                    onClick={() => setMobileProjectActionMenu(null)}
                    aria-label="Close"
                    title="Close"
                  >
                    <span className="codicon codicon-close" />
                  </button>
                </div>
                <div className="mobile-project-sheet-body">
                  {sheetMenu.phase === 'agents' ? (
                    <>
                      {sheetAgents.map(agentType => (
                        <button
                          key={`${sheetMenu.projectId}:sheet:${sheetMenu.kind}:${agentType}`}
                          type="button"
                          className="wide-project-action-menu-item mobile-project-sheet-item"
                          onClick={() => {
                            if (sheetMenu.kind === 'new') {
                              handleMobileProjectCreateSession(
                                sheetMenu.projectId,
                                agentType,
                              ).catch(() => undefined);
                            } else {
                              handleMobileProjectResumeAgent(
                                sheetMenu.projectId,
                                agentType,
                              ).catch(() => undefined);
                            }
                          }}
                        >
                          <span className="codicon codicon-sparkle" />
                          <span className="mobile-project-sheet-item-label">{agentType}</span>
                        </button>
                      ))}
                      {sheetAgents.length === 0 ? (
                        <div className="wide-project-action-empty">
                          <span className="codicon codicon-circle-slash" aria-hidden="true" />
                          <span>No agents available.</span>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="wide-project-action-back mobile-project-sheet-back"
                        onClick={() => {
                          setResumeSessions([]);
                          setResumeLoading(false);
                          setMobileProjectActionMenu({
                            ...sheetMenu,
                            phase: 'agents',
                            agentType: '',
                          });
                        }}
                      >
                        <span className="codicon codicon-arrow-left" />
                        <span className="mobile-project-sheet-item-label">{sheetMenu.agentType}</span>
                      </button>
                      {resumeLoading ? (
                        <div className="wide-project-action-empty">
                          <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
                          <span>Loading sessions...</span>
                        </div>
                      ) : null}
                      {!resumeLoading
                        ? resumeSessions.map(session => (
                            <button
                              key={`${sheetMenu.projectId}:sheet-resume:${session.sessionId}`}
                              type="button"
                              className="wide-project-action-menu-item mobile-project-sheet-item"
                              onClick={() => {
                                handleMobileProjectResumeImport(
                                  sheetMenu.projectId,
                                  sheetMenu.agentType,
                                  session.sessionId,
                                ).catch(() => undefined);
                              }}
                            >
                              <span className="codicon codicon-history" />
                              <span className="mobile-project-sheet-item-label">
                                {resolveSessionDisplayTitle(session) || session.sessionId}
                              </span>
                            </button>
                          ))
                        : null}
                      {!resumeLoading && resumeSessions.length === 0 ? (
                        <div className="wide-project-action-empty">
                          <span className="codicon codicon-history" aria-hidden="true" />
                          <span>No resumable sessions.</span>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </>
          );
        })()}
      </>
    );
  };

  const renderWideProjectSessionNav = () => {
    return (
      <ChatSessionNav
        className="wide-project-session-nav"
        dataSessionListDensity={sessionListDensity}
      >
        {renderArchiveBatchStatus()}
        {projects.length === 0 ? (
          <div className="chat-empty-hint">No projects available.</div>
        ) : null}
        {renderRecentSessionsSection(false)}
        {archivedMode ? renderArchivedSessionRows(false) : sessionSearchActive ? renderSessionSearchResults(false) : visibleProjectItems.map(projectItem => {
          const targetProjectId = projectItem.projectId;
          const projectSessions = projectSessionsByProjectId[targetProjectId] ?? [];
          const collapsed = collapsedProjectIds.includes(targetProjectId);
          const pinnedProject = pinnedProjectIds.includes(targetProjectId);
          const agents = getWideProjectAgents(projectItem, projectSessions);
          const actionMenuOpen = wideProjectActionMenu?.projectId === targetProjectId;
          const projectHub = projectItem.hubId || 'local';
          const projectHubVariant = tagVariantClass('wide-project-hub', projectItem.hubId || 'local');
          return (
            <div
              key={`wide-project:${targetProjectId}`}
              className={`wide-project-section${targetProjectId === projectId ? ' active' : ''}${pinnedProject ? ' pinned' : ''}${
                collapsed ? ' collapsed' : ''
              }`}
            >
              <div className="wide-project-row">
                <button
                  type="button"
                  className="wide-project-toggle"
                  onPointerDown={event => startProjectPinLongPress(targetProjectId, event)}
                  onPointerUp={finishProjectPinLongPress}
                  onPointerCancel={finishProjectPinLongPress}
                  onPointerLeave={finishProjectPinLongPress}
                  onContextMenu={event => event.preventDefault()}
                  onClick={event => {
                    if (consumeProjectPinLongPressClick(targetProjectId, event)) {
                      return;
                    }
                    toggleWideProjectCollapsed(targetProjectId);
                  }}
                  title={collapsed ? 'Expand project' : 'Collapse project'}
                  aria-expanded={!collapsed}
                >
                  <span className="wide-project-folder-wrap">
                    <span
                      className={`codicon ${collapsed ? 'codicon-folder' : 'codicon-folder-opened'} wide-project-folder-icon ${projectHubVariant}`}
                      style={hubAccentStyle(projectHub)}
                    />
                    {pinnedProject ? (
                      <span className="codicon codicon-pinned wide-project-pin-badge" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span className="wide-project-title-group">
                    <span className="wide-project-name" title={projectItem.name}>
                      {projectItem.name}
                    </span>
                    <span
                      className={`wide-project-hub-tag ${projectHubVariant}`}
                      style={hubAccentStyle(projectHub)}
                    >
                      <span className="wide-project-hub-dot" aria-hidden="true" />
                      <span className="wide-project-hub-label">{projectHub}</span>
                    </span>
                  </span>
                </button>
                <div className="wide-project-actions">
                  <button
                    type="button"
                    className="wide-project-action-btn"
                    title="New session"
                    aria-label={`New session in ${projectItem.name}`}
                    onPointerDown={event => event.stopPropagation()}
                    onClick={event => {
                      event.stopPropagation();
                      openWideProjectActionMenu(targetProjectId, 'new', event.currentTarget);
                    }}
                  >
                    <span className="codicon codicon-add" />
                  </button>
                  <button
                    type="button"
                    className="wide-project-action-btn"
                    title="Resume session"
                    aria-label={`Resume session in ${projectItem.name}`}
                    onPointerDown={event => event.stopPropagation()}
                    onClick={event => {
                      event.stopPropagation();
                      openWideProjectActionMenu(targetProjectId, 'resume', event.currentTarget);
                    }}
                  >
                    <span className="codicon codicon-history" />
                  </button>
                </div>
                {actionMenuOpen ? (
                  <div
                    ref={wideProjectActionMenuRef}
                    className="wide-project-action-popover"
                    style={wideProjectActionMenu.popover
                      ? {
                          top: `${wideProjectActionMenu.popover.top}px`,
                          left: `${wideProjectActionMenu.popover.left}px`,
                          width: `${wideProjectActionMenu.popover.width}px`,
                          maxHeight: `${wideProjectActionMenu.popover.maxHeight}px`,
                          transform: wideProjectActionMenu.popover.placement === 'above'
                            ? 'translateY(-100%)'
                            : undefined,
                        }
                      : undefined}
                  >
                    <div className="wide-project-action-title">
                      <span
                        className={`codicon ${
                          wideProjectActionMenu.kind === 'new'
                            ? 'codicon-add'
                            : 'codicon-history'
                        }`}
                      />
                      <span className="wide-project-action-title-copy">
                        <span className="wide-project-action-title-main">
                          {wideProjectActionMenu.kind === 'new' ? 'New Session' : 'Resume Session'}
                        </span>
                        <span className="wide-project-action-title-sub">
                          {projectItem.name}
                        </span>
                      </span>
                    </div>
                    {wideProjectActionMenu.phase === 'agents' ? (
                      <>
                        {agents.map(agentType => (
                          <button
                            key={`${targetProjectId}:${wideProjectActionMenu.kind}:${agentType}`}
                            type="button"
                            className="wide-project-action-menu-item"
                            onClick={() => {
                              if (wideProjectActionMenu.kind === 'new') {
                                handleWideProjectCreateSession(
                                  targetProjectId,
                                  agentType,
                                ).catch(() => undefined);
                              } else {
                                handleWideProjectResumeAgent(
                                  targetProjectId,
                                  agentType,
                                ).catch(() => undefined);
                              }
                            }}
                          >
                            <span className="codicon codicon-sparkle" />
                            <span>{agentType}</span>
                          </button>
                        ))}
                        {agents.length === 0 ? (
                          <div className="wide-project-action-empty">
                            <span className="codicon codicon-circle-slash" aria-hidden="true" />
                            <span>No agents available.</span>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="wide-project-action-back"
                          onClick={() => {
                            setResumeSessions([]);
                            setResumeLoading(false);
                            setWideProjectActionMenu({
                              ...wideProjectActionMenu,
                              phase: 'agents',
                              agentType: '',
                            });
                          }}
                        >
                          <span className="codicon codicon-arrow-left" />
                          <span>{wideProjectActionMenu.agentType}</span>
                        </button>
                        {resumeLoading ? (
                          <div className="wide-project-action-empty">
                            <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
                            <span>Loading sessions...</span>
                          </div>
                        ) : null}
                        {!resumeLoading
                          ? resumeSessions.map(session => (
                              <button
                                key={`${targetProjectId}:resume:${session.sessionId}`}
                                type="button"
                                className="wide-project-action-menu-item"
                                onClick={() => {
                                  handleWideProjectResumeImport(
                                    targetProjectId,
                                    wideProjectActionMenu.agentType,
                                    session.sessionId,
                                  ).catch(() => undefined);
                                }}
                              >
                                <span className="codicon codicon-history" />
                                <span>{resolveSessionDisplayTitle(session) || session.sessionId}</span>
                              </button>
                            ))
                          : null}
                        {!resumeLoading && resumeSessions.length === 0 ? (
                          <div className="wide-project-action-empty">
                            <span className="codicon codicon-history" aria-hidden="true" />
                            <span>No resumable sessions.</span>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
              {!collapsed ? (
                <div className="wide-project-session-list">
                  {renderProjectSessionRowsWithOlderFolding(targetProjectId, projectSessions, false)}
                  {projectSessions.length === 0 ? (
                    <div className="wide-project-empty">No sessions yet.</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {!archivedMode && !sessionSearchActive ? renderHiddenProjectRows(false) : null}
      </ChatSessionNav>
    );
  };

  const renderSidebar = () => {
    const mobileSidebarMain = !isWide
      ? tab === 'chat' && !isWide ? renderMobileChatSessionSheet() : renderSidebarMain()
      : null;
    const wideSidebarTitle = tab === 'chat'
      ? 'CHAT'
      : tab === 'file'
      ? 'EXPLORER'
      : 'SOURCE CONTROL';
    const wideSidebarMain = tab === 'chat' ? renderWideProjectSessionNav() : renderSidebarMain(false);

    return (
      <>
        {!isWide && tab !== 'chat' ? (
          <div className="drawer-project-header">
            <button
              type="button"
              className="drawer-settings-icon-btn"
              onClick={() => {
                setProjectMenuOpen(false);
                setSettingsDetailView(null);
                setSidebarSettingsOpen(true);
              }}
              title="Open settings"
              aria-label="Open settings"
            >
              <span className="codicon codicon-settings-gear" />
            </button>
            <div className="drawer-project-pill">
              <div
                className="project-wrap"
                onPointerDown={event => event.stopPropagation()}
              >
                <button
                  className="project-btn drawer-project-button"
                  onClick={() => setProjectMenuOpen(value => !value)}
                >
                  <span className="project-arrow codicon codicon-chevron-down" />
                  <span className="project-name" title={currentProjectName}>
                    {currentProjectName}
                  </span>
                  {loadingProject || refreshingProject || reconnecting ? (
                    <span className="muted">...</span>
                  ) : null}
                </button>
                {projectMenu}
              </div>
              <button
                className={`header-btn refresh-btn drawer-project-refresh${hasPendingProjectUpdates && !refreshingProject && !reconnecting ? ' has-update-badge' : ''}`}
                onClick={() => refreshProject().catch(() => undefined)}
                title={reconnecting ? 'Reconnecting...' : 'Refresh project'}
                disabled={refreshingProject || reconnecting}
              >
                {refreshButtonContent}
              </button>
            </div>
          </div>
        ) : null}
        {isWide ? (
          tab === 'chat' && !sidebarSettingsOpen ? (
            renderChatSessionHeader(false)
          ) : (
            <DesktopDragRegion className="sidebar-title-row">
              <span className="sidebar-title-text">{wideSidebarTitle}</span>
            </DesktopDragRegion>
          )
        ) : null}
        <div className="sidebar-scroll">
          {isWide ? wideSidebarMain : mobileSidebarMain}
        </div>
        {isWide ? (
          <button
            type="button"
            className={`desktop-sidebar-resize-handle${desktopSidebarResizing ? ' resizing' : ''}`}
            aria-label="Resize sidebar"
            title="Resize sidebar"
            onPointerDown={beginDesktopSidebarResize}
            onPointerMove={moveDesktopSidebarResize}
            onPointerUp={finishDesktopSidebarResize}
            onPointerCancel={finishDesktopSidebarResize}
            onLostPointerCapture={commitDesktopSidebarResize}
            onDoubleClick={resetDesktopSidebarWidth}
          />
        ) : null}
      </>
    );
  };

  const renderCodePane = (
    content: string,
    forceLineNumbers = false,
    languageHint = '',
    options?: {
      highlightedLines?: Set<number>;
      onLineClick?: (line: number, event: MouseEvent) => void;
      forceNoWrap?: boolean;
    },
  ) => {
    const numbersOn = forceLineNumbers || showLineNumbers;
    const language = languageHint || detectCodeLanguage(selectedFile);
    return (
      <ShikiCodeBlock
        content={content}
        language={language}
        wrap={options?.forceNoWrap ? false : wrapLines}
        lineNumbers={numbersOn}
        themeMode={themeMode}
        codeTheme={codeTheme}
        codeFont={codeFont}
        codeFontSize={codeFontSize}
        codeLineHeight={codeLineHeight}
        codeTabSize={codeTabSize}
        highlightedLines={options?.highlightedLines}
        onLineClick={options?.onLineClick}
      />
    );
  };

  const renderViewTools = () => (
    <>
      {selectedFileIsMarkdown ? (
        <button
          type="button"
          className={`view-tool markdown-preview-toggle ${
            markdownPreviewEnabled ? 'active' : ''
          }`}
          onClick={() => setMarkdownPreviewEnabled(value => !value)}
          title={
            markdownPreviewEnabled
              ? 'Switch to source mode'
              : 'Switch to markdown preview'
          }
          aria-label="Toggle markdown preview"
        >
          <span className="markdown-preview-toggle-text">MD</span>
        </button>
      ) : null}
      {selectedFileIsHtml ? (
        <button
          type="button"
          className={`view-tool html-preview-toggle ${
            htmlPreviewEnabled ? 'active' : ''
          }`}
          onClick={() => setHtmlPreviewEnabled(value => !value)}
          title={
            htmlPreviewEnabled
              ? 'Switch to source mode'
              : 'Switch to HTML preview'
          }
          aria-label="Toggle HTML preview"
        >
          <span className="html-preview-toggle-text">HTML</span>
        </button>
      ) : null}
      <button
        type="button"
        className={`view-tool ${wrapLines ? 'active' : ''}`}
        onClick={() => setWrapLines(value => !value)}
        title="Toggle wrap line"
        aria-label="Toggle wrap line"
      >
        <span className="codicon codicon-word-wrap view-tool-icon" />
      </button>
      <button
        type="button"
        className={`view-tool ${showLineNumbers ? 'active' : ''}`}
        onClick={() => setShowLineNumbers(value => !value)}
        title="Toggle line number"
        aria-label="Toggle line number"
      >
        <span className="codicon codicon-list-ordered view-tool-icon" />
      </button>
    </>
  );

  const renderDiffPane = (content: string, diffPath = selectedDiff || selectedFile) => {
    if (!content) return <div className="muted block">No diff available</div>;
    const shouldDelayLargeRender =
      !allowLargeDiffRender &&
      isHeavyGeneratedDiffPath(diffPath || '') &&
      content.length > MAX_AUTO_RENDER_DIFF_CHARS;
    if (shouldDelayLargeRender) {
      return (
        <div className="muted block">
          Large generated diff detected ({(content.length / 1024).toFixed(0)}{' '}
          KB). Click to render when needed.
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              className="button"
              onClick={() => setAllowLargeDiffRender(true)}
            >
              Render Diff
            </button>
          </div>
        </div>
      );
    }

    const language = detectCodeLanguage(diffPath);
    return (
      <ShikiDiffPane
        content={content}
        language={language}
        wrap={wrapLines}
        lineNumbers={showLineNumbers}
        themeMode={themeMode}
        codeTheme={codeTheme}
        codeFont={codeFont}
        codeFontFamily={codeFontFamily}
        codeFontSize={codeFontSize}
        codeLineHeight={codeLineHeight}
        codeTabSize={codeTabSize}
      />
    );
  };

  const resolveChatFileLink = (
    href: string,
    projectRoot = currentProject?.path ?? '',
  ): { path: string; line: number | null } | null =>
    resolvePreviewFileLink(href, projectRoot);
  const chatMarkdownUrlTransform = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^(javascript|vbscript):/i.test(trimmed)) {
      return '';
    }
    return value;
  }, []);
  const renderChatInlineCode = useCallback(
    ({ className, children }: { className?: string; children?: React.ReactNode }) => {
      const languageMatch = /language-([\w-]+)/.exec(className || '');
      const codeText = String(children ?? '').replace(/\n$/, '');
      const relayLocalUrl = parsePortRelayLocalHttpUrl(codeText);
      if (!languageMatch && !codeText.includes('\n') && relayLocalUrl) {
        return (
          <a
            className="chat-relay-link chat-relay-code-link"
            href={codeText.trim()}
            title="Open through Port Relay"
            onClick={event => {
              event.preventDefault();
              openChatPortRelayLink(relayLocalUrl).catch(() => undefined);
            }}
          >
            <code className={className}>{children}</code>
          </a>
        );
      }

      return markdownCodeRenderer({
        className,
        children,
        themeMode,
        codeTheme,
        codeFont,
        codeFontSize,
        codeLineHeight,
        codeTabSize,
        wrap: true,
        lineNumbers: false,
      });
    },
    [
      themeMode,
      codeTheme,
      codeFont,
      codeFontSize,
      codeLineHeight,
      codeTabSize,
      openChatPortRelayLink,
    ],
  );

  const chatMarkdownComponents = useMemo<Components>(
    () => ({
      pre: markdownPreRenderer,
      code: renderChatInlineCode,
      img: ({ src, alt, ...rest }) => (
        <img
          {...rest}
          src={typeof src === 'string' ? src : undefined}
          alt={alt || ''}
          crossOrigin="anonymous"
        />
      ),
      a: ({ href, children, ...rest }) => {
        const linkHref = typeof href === 'string' ? href : '';
        const linkProjectId = resolveChatFilePreviewProjectId();
        const linkProjectRoot = projects.find(
          project => project.projectId === linkProjectId,
        )?.path ?? currentProject?.path ?? '';
        const targetFile = linkHref
          ? resolveChatFileLink(linkHref, linkProjectRoot)
          : null;
        const relayLocalUrl = parsePortRelayLocalHttpUrl(linkHref);
        const isFileLink = !!targetFile;
        const isWindowsLocalPath = /^\/?[a-zA-Z]:/.test(linkHref.trim());
        const linkText = collectReactText(children);
        const textLine = parseTrailingLineNumber(linkText);
        const jumpLine = targetFile?.line ?? textLine;
        const fallbackHref = linkHref || '#';

        return (
          <a
            {...rest}
            className={[rest.className, relayLocalUrl ? 'chat-relay-link' : ''].filter(Boolean).join(' ') || undefined}
            href={fallbackHref}
            target={isFileLink || relayLocalUrl ? undefined : '_blank'}
            rel={isFileLink || relayLocalUrl ? undefined : 'noreferrer'}
            title={
              isFileLink && jumpLine
                ? `${targetFile.path}:${jumpLine}`
                : relayLocalUrl
                  ? 'Open through Port Relay'
                : rest.title
            }
            onClick={event => {
              if (relayLocalUrl) {
                event.preventDefault();
                openChatPortRelayLink(relayLocalUrl).catch(() => undefined);
                return;
              }
              if (!targetFile) {
                if (isWindowsLocalPath) {
                  event.preventDefault();
                  setError(`Invalid file link: ${linkHref}`);
                }
                return;
              }
              event.preventDefault();
              openChatFilePeek(targetFile.path, jumpLine ?? null, linkProjectId);
            }}
          >
            <>
              {children}
              {isFileLink && jumpLine && !textLine ? (
                <span className="chat-file-link-line">:{jumpLine}</span>
              ) : null}
            </>
          </a>
        );
      },
    }),
    [
      currentProject?.path,
      openChatFilePeek,
      openChatPortRelayLink,
      projects,
      renderChatInlineCode,
      resolveChatFilePreviewProjectId,
    ],
  );

  const findPromptRequestForDoneInMessages = (
    messages: RegistryChatMessage[],
    doneTurnIndex: number,
  ): RegistryChatMessage | undefined => {
    const ordered = [...messages].sort((left, right) => (left.turnIndex ?? 0) - (right.turnIndex ?? 0));
    const doneIndex = ordered.findIndex(message => message.method === 'prompt_done' && (message.turnIndex ?? 0) === doneTurnIndex);
    if (doneIndex < 0) {
      return undefined;
    }
    for (let index = doneIndex - 1; index >= 0; index -= 1) {
      if (isPromptStartMessage(ordered[index])) {
        return ordered[index];
      }
    }
    return undefined;
  };

  const findPromptRequestForDone = useCallback((doneTurnIndex: number): RegistryChatMessage | undefined => {
    return findPromptRequestForDoneInMessages(selectedFullChatMessages, doneTurnIndex);
  }, [selectedFullChatMessages]);

  const copyPromptDoneMarkdown = async (doneTurnIndex: number) => {
    const result = buildPromptDoneCopyRange(selectedFullChatMessages, doneTurnIndex);
    if (!result.ok) {
      return;
    }
    await writeTextToClipboard(result.markdown);
  };

  // Subscribe to TTS player state changes
  useEffect(() => {
    const unsubscribe = ttsPlayer.subscribe((state) => {
      setTtsState(state);
      if (state === 'idle') {
        ttsActiveTurnIndexRef.current = null;
      }
    });
    return unsubscribe;
  }, []);

  const readAloudPromptDone = async (doneTurnIndex: number) => {
    // If clicking on the same turn that's currently playing, stop it
    if (ttsPlayer.currentState === 'playing' && ttsActiveTurnIndexRef.current === doneTurnIndex) {
      ttsPlayer.stop();
      return;
    }

    // If something else is playing, stop it first
    if (ttsPlayer.currentState !== 'idle') {
      ttsPlayer.stop();
    }
    if (!ttsEnabled) {
      setError('Configure a Text-to-Speech key in Server settings first.');
      return;
    }

    const result = buildPromptDoneCopyRange(selectedFullChatMessages, doneTurnIndex);
    if (!result.ok) {
      return;
    }

    const cleanedText = prepareTextForTTS(result.markdown);
    if (!cleanedText.trim()) {
      setError('No readable text in response');
      return;
    }

    const segments = segmentText(cleanedText);
    if (segments.length === 0) {
      setError('No readable text in response');
      return;
    }

    ttsActiveTurnIndexRef.current = doneTurnIndex;
	ttsPlayer.play(segments, serverSettings.textToSpeech, {
		synthesizeTTS: payload => service.synthesizeTTS(payload),
	}).catch(() => undefined);
  };

  const exportPromptDoneMarkdownImage = async (doneTurnIndex: number) => {
    if (exportingMarkdownImageTurnIndex !== null) {
      return;
    }
    const result = buildPromptDoneCopyRange(selectedFullChatMessages, doneTurnIndex);
    if (!result.ok) {
      return;
    }
    setError('');
    setExportingMarkdownImageTurnIndex(doneTurnIndex);
    let userActionToken: string | undefined;
    try {
      userActionToken = await reserveResponseImageShare();
    } catch (error) {
      setExportingMarkdownImageTurnIndex(null);
      setError(`Failed to share response image: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    markdownImageExportIdRef.current += 1;
    setMarkdownImageExportRequest({
      id: markdownImageExportIdRef.current,
      content: result.markdown,
      fileName: buildPromptMarkdownImageFileName(doneTurnIndex),
      userActionToken,
    });
  };
  const copyPromptDoneMarkdownEvent = useStableEvent(copyPromptDoneMarkdown);
  const readAloudPromptDoneEvent = useStableEvent(readAloudPromptDone);
  const exportPromptDoneMarkdownImageEvent = useStableEvent(exportPromptDoneMarkdownImage);

  const completeMarkdownImageExport = useCallback((result: ResponseImageOutputResult) => {
    setMarkdownImageExportRequest(null);
    setExportingMarkdownImageTurnIndex(null);
    if (result.status === 'copied') {
      setToastMessage('Response image copied to clipboard.');
    }
  }, []);

  const failMarkdownImageExport = useCallback((message: string) => {
    setMarkdownImageExportRequest(null);
    setExportingMarkdownImageTurnIndex(null);
    setError(`Failed to export response image: ${message}`);
  }, []);

  const failMarkdownImageShare = useCallback((message: string) => {
    setMarkdownImageExportRequest(null);
    setExportingMarkdownImageTurnIndex(null);
    setError(`Failed to share response image: ${message}`);
  }, []);

  const openPromptArtifactDiff = useCallback(async (
    artifact: RegistrySessionPromptArtifact,
    message: RegistryChatMessage,
    initialFilePath?: string,
  ) => {
    const artifactId = artifact.artifactId;
    if (!artifactId) {
      return;
    }
    const artifactKey = `${message.sessionId}:${artifactId}`;
    const artifactProjectId =
      selectedArchivedKey?.projectId ||
      selectedChatKey?.projectId ||
      projectId;
    const sessionId = message.sessionId;
    if (!artifactProjectId || !sessionId) {
      setPromptArtifactErrors(prev => ({
        ...prev,
        [artifactKey]: 'Unable to resolve artifact session.',
      }));
      return;
    }
    const promptMessages = selectedArchivedKey
      ? archivedPreview?.messages ?? []
      : selectedFullChatMessages;
    const promptRequest =
      findPromptRequestForDoneInMessages(promptMessages, message.turnIndex ?? 0) ||
      findPromptRequestForDone(message.turnIndex ?? 0);
    const promptText = promptRequest ? msgText(promptRequest.method, promptRequest.param).trim() : '';
    const promptSummary = promptArtifactPromptSummary(promptText);
    const initialPath = initialFilePath || null;
    const initialFiles = buildPromptArtifactPreviewFiles(artifact, '', initialPath);
    const initialFileCount = artifact.fileCount || artifact.files?.length || initialFiles.length;
    const requestSeq = chatPromptArtifactReadSeqRef.current + 1;
    chatPromptArtifactReadSeqRef.current = requestSeq;
    const tabId = previewTabId({type: 'prompt-diff', sessionId, artifactId});
    setChatPeekSelectedLines(new Set());
    chatPeekAnchorRef.current = null;
    setChatPreviewManualOpen(false);
    setChatPreviewManualCollapsed(false);
    setPreviewWorkbench(current =>
      beginPreviewTabLoad(
        openPreviewTab(current, {
          type: 'prompt-diff',
          projectId: artifactProjectId,
          sessionId,
          artifactId,
          title: promptArtifactPreviewTitle(initialFileCount),
          promptText,
          promptSummary,
          files: initialFiles,
        }),
        artifactProjectId,
        tabId,
        requestSeq,
      ),
    );
    if (!isWide) {
      setDrawerOpen(false);
      setChatQuickSwitchMenuOpen(false);
      if (!chatFilePeekHistoryActiveRef.current) {
        window.history.pushState(createChatFilePeekHistoryState(), '', window.location.href);
        chatFilePeekHistoryActiveRef.current = true;
      }
    }
    setOpeningPromptArtifactKey(artifactKey);
    setPromptArtifactErrors(prev => {
      if (!prev[artifactKey]) return prev;
      const next = {...prev};
      delete next[artifactKey];
      return next;
    });
    try {
      const result = await service.readSessionArtifact(artifactProjectId, sessionId, artifactId);
      const files = buildPromptArtifactPreviewFiles(artifact, result.content, initialPath);
      const fileCount = files.length || artifact.fileCount || artifact.files?.length || 0;
      setPreviewWorkbench(current =>
        updatePreviewTabAfterLoad(current, artifactProjectId, tabId, requestSeq, tab =>
          tab.type === 'prompt-diff'
            ? {
                ...tab,
                title: promptArtifactPreviewTitle(fileCount),
                promptText,
                promptSummary,
                files,
                loading: false,
                error: '',
              }
            : tab,
        ),
      );
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      setPreviewWorkbench(current =>
        failPreviewTabLoad(
          current,
          artifactProjectId,
          tabId,
          requestSeq,
          messageText,
        ),
      );
      setPromptArtifactErrors(prev => ({
        ...prev,
        [artifactKey]: messageText,
      }));
    } finally {
      setOpeningPromptArtifactKey(current => (current === artifactKey ? '' : current));
    }
  }, [
    archivedPreview?.messages,
    findPromptRequestForDone,
    isWide,
    projectId,
    selectedArchivedKey?.projectId,
    selectedChatKey?.projectId,
    selectedFullChatMessages,
    service,
    setDrawerOpen,
  ]);

  const togglePromptArtifactPreviewFile = useCallback((path: string) => {
    const tab = activePreviewTab(previewWorkbenchRef.current);
    if (!tab || tab.type !== 'prompt-diff') {
      return;
    }
    setPreviewWorkbench(current =>
      updatePreviewTab(current, tab.projectId, tab.id, item =>
        item.type === 'prompt-diff'
          ? {
              ...item,
              files: item.files.map(file =>
                file.path === path ? {...file, expanded: !file.expanded} : file,
              ),
            }
          : item,
      ),
    );
  }, []);

  const selectedChatHasOpenPromptTurn = selectedFullChatMessages.some(message =>
    isPromptStartMessage(message) &&
    resolvePromptTurnStatus(selectedFullChatMessages, message) === 'responding',
  );
  const selectedChatCompactionRunning = useMemo(() => {
    if (selectedChatEncodedKey && chatCompactingByKey[selectedChatEncodedKey] === true) {
      return true;
    }
    const operationStates = new Map<string, string>();
    for (const message of selectedFullChatMessages) {
      if (message.method !== 'session_operation') continue;
      const operationId = typeof message.param.operationId === 'string' ? message.param.operationId : '';
      const operationType = typeof message.param.type === 'string' ? message.param.type : '';
      const status = typeof message.param.status === 'string' ? message.param.status : '';
      if (operationId && operationType === 'compact') {
        operationStates.set(operationId, status);
      }
    }
    return Array.from(operationStates.values()).some(status => status === 'queued' || status === 'started');
  }, [chatCompactingByKey, selectedChatEncodedKey, selectedFullChatMessages]);
  const selectedChatPromptRunning =
    !!selectedChatEncodedKey &&
    !selectedPendingPrompt &&
    (
      (selectedChatSession?.running === true && !selectedChatCompactionRunning) ||
      selectedChatHasOpenPromptTurn
    );
  const selectedChatExecutionRunning = selectedChatPromptRunning || selectedChatCompactionRunning;
  const chatSendDisabled = selectedChatSubmitPending || chatAttachmentUploadPending;
  const selectedChatPromptCancelling =
    !!selectedChatEncodedKey && chatCancellingRuntimeKey === selectedChatEncodedKey;
  const chatComposerStopTriggerClassName = `chat-tool-button chat-composer-stop-trigger${selectedChatPromptRunning ? ' active' : ''}${selectedChatPromptCancelling ? ' cancelling' : ''}`;

  useEffect(() => {
    if (selectedChatExecutionRunning) {
      setChatAttachmentTrayOpen(false);
    }
  }, [selectedChatExecutionRunning]);

  useEffect(() => {
    if (!selectedChatEncodedKey || selectedChatExecutionRunning || selectedChatSubmitPending) {
      return;
    }
    if ((chatQueuedPromptsByKeyRef.current[selectedChatEncodedKey] ?? []).length === 0) {
      return;
    }
    drainNextQueuedChatItem(selectedChatEncodedKey);
  }, [selectedChatEncodedKey, selectedChatExecutionRunning, selectedChatSubmitPending, chatMessages.length, chatQueuedPromptsByKey]);

  const latestSelectableAssistantReply = useMemo(() => {
    if (selectedPendingPrompt) {
      return {
        messageKey: '',
        hasOptionReplies: false,
        confirmationReply: null as ChatConfirmationReply | null,
      };
    }
    const ordered = [...selectedFullChatMessages].sort((left, right) => (left.turnIndex ?? 0) - (right.turnIndex ?? 0));
    const latestUserTurnIndex = Math.max(
      0,
      ...ordered
        .filter(message => isPromptStartMessage(message))
        .map(message => Math.max(0, Math.trunc(message.turnIndex ?? 0))),
    );
    const latestAssistantMessage = [...ordered]
      .reverse()
      .find(message =>
        message.method === 'agent_message_chunk' &&
        Math.max(0, Math.trunc(message.turnIndex ?? 0)) > latestUserTurnIndex,
      );
    if (!latestAssistantMessage) {
      return {
        messageKey: '',
        hasOptionReplies: false,
        confirmationReply: null as ChatConfirmationReply | null,
      };
    }
    const text = msgText(latestAssistantMessage.method, latestAssistantMessage.param).trim();
    const latestOptionReplies = extractChatOptionReplies(text);
    return {
      messageKey: chatMessageDomKey(latestAssistantMessage),
      hasOptionReplies: latestOptionReplies.length > 0,
      confirmationReply: latestOptionReplies.length === 0 ? extractChatConfirmationReply(text) : null,
    };
  }, [selectedFullChatMessages, selectedPendingPrompt]);
  const latestSelectableOptionReplyMessageKey = latestSelectableAssistantReply.hasOptionReplies
    ? latestSelectableAssistantReply.messageKey
    : '';

  const renderChatMessageTurn = useCallback((message: RegistryChatMessage) => {
    const doneTurnIndex = message.turnIndex ?? 0;
    const copyRange = message.method === 'prompt_done'
      ? buildPromptDoneCopyRange(selectedFullChatMessages, doneTurnIndex)
      : null;
    const promptStatus = isPromptStartMessage(message)
      ? resolvePromptTurnStatus(selectedFullChatMessages, message)
      : null;
    const text = msgText(message.method, message.param).trim();
    const optionReplies =
      message.method === 'agent_message_chunk' &&
      chatMessageDomKey(message) === latestSelectableOptionReplyMessageKey
        ? extractChatOptionReplies(text)
        : [];
    const confirmationReply =
      message.method === 'agent_message_chunk' &&
      chatMessageDomKey(message) === latestSelectableAssistantReply.messageKey &&
      optionReplies.length === 0
        ? latestSelectableAssistantReply.confirmationReply
        : null;
    if (!shouldRenderChatTurn(message, hideToolCalls, promptStatus)) {
      return null;
    }
    const searchHighlighted =
      sessionSearchTargetTurn?.runtimeKey === selectedChatEncodedKey &&
      sessionSearchTargetTurn.turnIndex === (message.turnIndex ?? 0);
    return (
      <div
        key={`${selectedChatEncodedKey}:${message.turnIndex}:${message.method}`}
        data-chat-message-key={chatMessageDomKey(message)}
        className={[
          'chat-view-content',
          searchHighlighted ? 'chat-turn-search-highlight' : '',
        ].filter(Boolean).join(' ')}
      >
        <ChatTurnView
          message={message}
          promptRequest={message.method === 'prompt_done' ? findPromptRequestForDone(doneTurnIndex) : undefined}
          promptStatus={promptStatus}
          hideToolCalls={hideToolCalls}
          markdownComponents={chatMarkdownComponents}
          markdownUrlTransform={chatMarkdownUrlTransform}
          copyDisabled={copyRange ? !copyRange.ok : true}
          exportBusy={message.method === 'prompt_done' && exportingMarkdownImageTurnIndex !== null}
          optionReplies={optionReplies.length > 0 ? optionReplies : EMPTY_CHAT_OPTION_REPLIES}
          optionRepliesDisabled={chatSendDisabled}
          confirmationReply={confirmationReply}
          onSelectOptionReply={optionReplies.length > 0 ? handleSelectChatReply : undefined}
          onSelectConfirmationReply={confirmationReply ? handleSelectChatReply : undefined}
          onCopyPromptDone={
            message.method === 'prompt_done'
              ? () => copyPromptDoneMarkdownEvent(doneTurnIndex).catch(() => undefined)
              : undefined
          }
          onExportPromptDoneImage={
            message.method === 'prompt_done'
              ? () => exportPromptDoneMarkdownImageEvent(doneTurnIndex).catch(() => undefined)
              : undefined
          }
          ttsState={message.method === 'prompt_done' && ttsActiveTurnIndexRef.current === doneTurnIndex ? ttsState : 'idle'}
          readAloudEnabled={ttsEnabled}
          onReadAloud={
            message.method === 'prompt_done'
              ? () => readAloudPromptDoneEvent(doneTurnIndex).catch(() => undefined)
              : undefined
          }
          onOpenPromptAttachment={openChatAttachmentPreview}
          resolvePromptAttachmentThumbnail={resolvePromptAttachmentThumbnail}
          onLoadPromptAttachmentThumbnail={loadPromptAttachmentThumbnail}
          onOpenPromptArtifact={
            message.method === 'prompt_done'
              ? openPromptArtifactDiff
              : undefined
          }
          openingPromptArtifactKey={openingPromptArtifactKey}
          promptArtifactErrors={promptArtifactErrors}
        />
      </div>
    );
  }, [
    chatMarkdownComponents,
    chatMarkdownUrlTransform,
    chatSendDisabled,
    copyPromptDoneMarkdownEvent,
    exportPromptDoneMarkdownImageEvent,
    exportingMarkdownImageTurnIndex,
    findPromptRequestForDone,
    handleSelectChatReply,
    hideToolCalls,
    latestSelectableAssistantReply,
    latestSelectableOptionReplyMessageKey,
    loadPromptAttachmentThumbnail,
    openChatAttachmentPreview,
    openPromptArtifactDiff,
    openingPromptArtifactKey,
    promptArtifactErrors,
    readAloudPromptDoneEvent,
    resolvePromptAttachmentThumbnail,
    selectedChatEncodedKey,
    selectedFullChatMessages,
    sessionSearchTargetTurn,
    ttsState,
  ]);
  const renderArchivedChatMessageTurn = useCallback((message: RegistryChatMessage) => {
    if (!shouldRenderChatTurn(message, hideToolCalls, null)) {
      return null;
    }
    const runtimeKey = selectedArchivedKey
      ? buildChatRuntimeKey(selectedArchivedKey.projectId, selectedArchivedKey.sessionId)
      : 'archived-session';
    return (
      <div
        key={`${runtimeKey}:${message.turnIndex}:${message.method}`}
        className="chat-view-content"
      >
        <ChatTurnView
          message={message}
          promptStatus={null}
          hideToolCalls={hideToolCalls}
          markdownComponents={chatMarkdownComponents}
          markdownUrlTransform={chatMarkdownUrlTransform}
          onOpenPromptAttachment={openChatAttachmentPreview}
          resolvePromptAttachmentThumbnail={resolvePromptAttachmentThumbnail}
          onLoadPromptAttachmentThumbnail={loadPromptAttachmentThumbnail}
          onOpenPromptArtifact={message.method === 'prompt_done' ? openPromptArtifactDiff : undefined}
          openingPromptArtifactKey={openingPromptArtifactKey}
          promptArtifactErrors={promptArtifactErrors}
        />
      </div>
    );
  }, [
    chatMarkdownComponents,
    chatMarkdownUrlTransform,
    hideToolCalls,
    loadPromptAttachmentThumbnail,
    openChatAttachmentPreview,
    openPromptArtifactDiff,
    openingPromptArtifactKey,
    promptArtifactErrors,
    resolvePromptAttachmentThumbnail,
    selectedArchivedKey,
  ]);
  const renderChatVirtuosoItem = useCallback((displayItem: ChatDisplayIndexItem) => {
    const chatReadOnlyPreview = archivedMode && archivedPreview !== null;
    const sourceMessages = chatReadOnlyPreview ? archivedPreview.messages : chatMessages;
    const sourceMessage = displayItem.kind === 'turn'
      ? sourceMessages[displayItem.sourceIndex]
      : undefined;
    const queuedPromptIndex = displayItem.kind === 'queued'
      ? selectedQueuedPrompts.findIndex(queuedPrompt => `${selectedChatEncodedKey}:queued:${queuedPrompt.id}` === displayItem.key)
      : -1;
    const queuedPrompt = queuedPromptIndex >= 0 ? selectedQueuedPrompts[queuedPromptIndex] : null;
    const content = displayItem.kind === 'queued' && queuedPrompt && !chatReadOnlyPreview ? (
      <div className="chat-view-content">
        <ChatTurnView
          message={buildQueuedPromptMessage(queuedPrompt, queuedPromptTurnIndex(queuedPromptIndex))}
          promptStatus="queued"
          hideToolCalls={hideToolCalls}
          markdownComponents={chatMarkdownComponents}
          markdownUrlTransform={chatMarkdownUrlTransform}
          onCancelQueuedPrompt={() => cancelQueuedPrompt(selectedChatEncodedKey, queuedPrompt.id)}
          onPrioritizeQueuedPrompt={() => prioritizeQueuedPrompt(selectedChatEncodedKey, queuedPrompt.id)}
          onOpenPromptAttachment={openChatAttachmentPreview}
          resolvePromptAttachmentThumbnail={resolvePromptAttachmentThumbnail}
          onLoadPromptAttachmentThumbnail={loadPromptAttachmentThumbnail}
        />
      </div>
    ) : displayItem.kind === 'pending' && selectedPendingPrompt && !chatReadOnlyPreview ? (
      <div className="chat-view-content">
        <ChatTurnView
          message={buildPendingPromptMessage(selectedPendingPrompt)}
          promptStatus={selectedPendingPrompt.status}
          hideToolCalls={hideToolCalls}
          markdownComponents={chatMarkdownComponents}
          markdownUrlTransform={chatMarkdownUrlTransform}
          onOpenPromptAttachment={openChatAttachmentPreview}
          resolvePromptAttachmentThumbnail={resolvePromptAttachmentThumbnail}
          onLoadPromptAttachmentThumbnail={loadPromptAttachmentThumbnail}
          onRetryPendingPrompt={() => retryPendingChatPrompt(selectedChatEncodedKey)}
          onEditPendingPrompt={() => editPendingChatPrompt(selectedChatEncodedKey)}
        />
      </div>
    ) : sourceMessage && chatReadOnlyPreview ? (
      renderArchivedChatMessageTurn(sourceMessage)
    ) : sourceMessage ? (
      renderChatMessageTurn(sourceMessage)
    ) : null;
    return content;
  }, [
    archivedMode,
    archivedPreview,
    cancelQueuedPrompt,
    chatMarkdownComponents,
    chatMarkdownUrlTransform,
    chatMessages,
    editPendingChatPrompt,
    hideToolCalls,
    loadPromptAttachmentThumbnail,
    openChatAttachmentPreview,
    prioritizeQueuedPrompt,
    queuedPromptTurnIndex,
    renderArchivedChatMessageTurn,
    renderChatMessageTurn,
    resolvePromptAttachmentThumbnail,
    retryPendingChatPrompt,
    selectedChatEncodedKey,
    selectedPendingPrompt,
    selectedQueuedPrompts,
  ]);
  const closePortRelayFrameFromChrome = useCallback(() => {
    const tab = activePreviewTab(previewWorkbenchRef.current);
    if (!tab || tab.type !== 'port-relay') {
      return;
    }
    if (!isWide && chatFilePeekHistoryActiveRef.current) {
      window.history.back();
      return;
    }
    setPreviewWorkbench(current => closePreviewTab(current, tab.projectId, tab.id));
  }, [isWide]);
  const openPortRelayPreviewInBrowser = useCallback(() => {
    const tab = activePreviewTab(previewWorkbenchRef.current);
    const url = tab?.type === 'port-relay' ? portRelayFrameUrl || tab.url : portRelayFrameUrl;
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [portRelayFrameUrl]);
  const terminalItems = useMemo(
    () => Object.values(terminalSync.terminals).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [terminalSync.terminals],
  );
  const activeTerminal = activeTerminalKey ? terminalSync.terminals[activeTerminalKey] : undefined;
  const toggleChatPreviewFromTitle = useCallback(() => {
    if (!isWide) setTerminalOpen(false);
    if (chatPreviewOpen) {
      setChatPreviewManualOpen(false);
      setChatPreviewManualCollapsed(true);
      return;
    }
    setChatPreviewManualCollapsed(false);
    setChatPreviewManualOpen(open => !open);
  }, [chatPreviewOpen, isWide]);
  const toggleTerminalFromTitle = useCallback(() => {
    setTerminalOpen(open => {
      const next = !open;
      if (next && !isWide) {
        setChatPreviewManualOpen(false);
        setChatPreviewManualCollapsed(true);
      }
      return next;
    });
  }, [isWide]);
  const beginTerminalPanelResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isWide) return;
    event.preventDefault();
    terminalPanelResizeRef.current = {
      pointerId: event.pointerId,
      originY: event.clientY,
      startHeight: terminalPanelHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [isWide, terminalPanelHeight]);
  const moveTerminalPanelResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const resize = terminalPanelResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const maxHeight = Math.max(160, Math.floor(window.innerHeight * 0.7));
    setTerminalPanelHeight(Math.max(160, Math.min(maxHeight, resize.startHeight + resize.originY - event.clientY)));
  }, []);
  const finishTerminalPanelResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const resize = terminalPanelResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    terminalPanelResizeRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {}
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = resolveWindowsWorkspaceShortcut(event, {isWindows: isWindowsPlatform, isWide});
      if (!shortcut) return;
      event.preventDefault();
      switch (shortcut) {
        case 'sessions':
          setSidebarCollapsed(value => !value);
          return;
        case 'preview':
          toggleChatPreviewFromTitle();
          return;
        case 'terminal':
          toggleTerminalFromTitle();
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isWide, isWindowsPlatform, setSidebarCollapsed, toggleChatPreviewFromTitle, toggleTerminalFromTitle]);
  const renderMain = () => {
    const heavyDiffDeferred =
      !!selectedDiff &&
      isHeavyGeneratedDiffPath(selectedDiff) &&
      !allowHeavyDiffLoad;
    const chatConfigStatus = chatConfigDisplay.status;
    const chatConfigOptions = chatConfigStatus.secondaryOptions;
    const chatConfigOverflowOptions = chatConfigStatus.overflowOptions;
    const selectedFileIsImage = isImageFile(
      selectedFile,
      fileInfo?.mimeType,
    );
    const selectedFileImageSrc = selectedFileIsImage
      ? buildImageDataUrl({
          content: fileContent,
          path: selectedFile,
          mimeType: fileInfo?.mimeType,
          isBinary: fileInfo?.isBinary,
        })
      : '';
    const activeChatSlashCommand = chatSlashMenuVisible
      ? chatSlashMenuOptions[Math.max(0, Math.min(chatSlashActiveIndex, chatSlashMenuOptions.length - 1))]
      : null;
    const renderChatConfigValueMenu = (option: RegistrySessionConfigOption) => {
      const optionValues = option.options ?? [];
      const currentValue = chatConfigCurrentValue(option);
      if (optionValues.length === 0) {
        return null;
      }
      return (
        <div className="chat-config-value-menu" role="menu">
          {optionValues.map(item => {
            const selected = item.value === currentValue;
            return (
              <button
                key={`${option.id}:${item.value}`}
                type="button"
                className={`chat-config-value-option${selected ? ' selected' : ''}`}
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setChatConfigMenuOptionId('');
                  setChatConfigOverflowOpen(false);
                  handleChatConfigOptionChange(option, item.value).catch(() => undefined);
                }}
              >
                <span className="chat-config-value-label">{item.name || item.value}</span>
                {selected ? (
                  <span className="codicon codicon-check" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      );
    };
    const renderChatConfigPill = (option: RegistrySessionConfigOption) => {
      const optionValues = option.options ?? [];
      const optionLabel = option.name || option.id;
      const currentLabel = chatConfigCurrentLabel(option);
      const updating =
        chatConfigUpdatingKey ===
        `${selectedChatSession?.sessionId ?? ''}:${option.id}`;
      const open = chatConfigMenuOptionId === option.id;
      return (
        <div key={option.id} className="chat-config-item">
          <button
            type="button"
            className="chat-config-pill"
            disabled={updating || optionValues.length === 0}
            title={optionLabel}
            aria-label={optionLabel}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => {
              setChatPromptMenuOpen(false);
              setChatFileMentionMenuOpen(false);
              setChatConfigOverflowOpen(false);
              setChatConfigMenuOptionId(current => (current === option.id ? '' : option.id));
            }}
          >
            <span className="chat-config-pill-value">{currentLabel}</span>
          </button>
          {open ? renderChatConfigValueMenu(option) : null}
        </div>
      );
    };
    const renderChatContextUsage = () => {
      if (!chatContextUsage) {
        return null;
      }
      return (
        <div
          ref={chatContextUsageRef}
          className={`chat-context-usage-anchor${chatContextUsageOpen ? ' open' : ''}`}
          onPointerEnter={updateChatContextUsagePopoverPosition}
        >
          <span id="chat-context-usage-label" className="chat-context-usage-a11y-label">
            {chatContextUsage.title}
          </span>
          <button
            type="button"
            className="chat-context-usage"
            style={{ '--chat-context-used': `${chatContextUsage.percent}%` } as React.CSSProperties}
            aria-labelledby="chat-context-usage-label"
            aria-describedby="chat-context-usage-popover"
            aria-expanded={chatContextUsageOpen}
            onFocus={updateChatContextUsagePopoverPosition}
            onClick={() => {
              updateChatContextUsagePopoverPosition();
              setChatPromptMenuOpen(false);
              setChatFileMentionMenuOpen(false);
              setChatConfigMenuOptionId('');
              setChatConfigOverflowOpen(false);
              setChatContextUsageOpen(open => !open);
            }}
          />
          <div
            id="chat-context-usage-popover"
            className="chat-context-usage-popover"
            role="tooltip"
            style={chatContextUsagePopoverStyle}
          >
            <span className="chat-context-usage-popover-kicker">Context window</span>
            <span className="chat-context-usage-popover-value">{chatContextUsage.summaryText}</span>
          </div>
        </div>
      );
    };
    const renderChatFastModeIndicator = () => {
      if (!selectedFastModeOption) {
        return null;
      }
      const enabled = selectedFastModeOption.currentValue === 'on';
      return (
        <span
          className={`codicon codicon-zap chat-fast-mode-indicator${enabled ? ' enabled' : ''}`}
          role="img"
          aria-label={`Fast mode ${enabled ? 'on' : 'off'}`}
          title={`Fast mode ${enabled ? 'on' : 'off'}`}
        />
      );
    };
    const renderChatStatusModel = (option?: RegistrySessionConfigOption) => {
      if (!option) {
        return null;
      }
      const optionValues = option.options ?? [];
      const label = chatConfigCurrentLabel(option);
      const updating =
        chatConfigUpdatingKey ===
        `${selectedChatSession?.sessionId ?? ''}:${option.id}`;
      const open = chatConfigMenuOptionId === option.id;
      return (
        <div key={`status:${option.id}`} className="chat-status-control chat-status-model-control">
          <button
            type="button"
            className="chat-status-model-button"
            disabled={updating || optionValues.length === 0}
            title={`Model: ${label}`}
            aria-label={`Model: ${label}`}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => {
              setChatPromptMenuOpen(false);
              setChatFileMentionMenuOpen(false);
              setChatConfigOverflowOpen(false);
              setChatConfigMenuOptionId(current => (current === option.id ? '' : option.id));
            }}
          >
            <span className="chat-status-model-label">{label}</span>
          </button>
          {open ? renderChatConfigValueMenu(option) : null}
        </div>
      );
    };
    const renderChatStatusEffort = (option?: RegistrySessionConfigOption) => {
      if (!option) {
        return null;
      }
      const label = chatConfigCurrentLabel(option);
      const optionValues = option.options ?? [];
      const updating =
        chatConfigUpdatingKey ===
        `${selectedChatSession?.sessionId ?? ''}:${option.id}`;
      const open = chatConfigMenuOptionId === option.id;
      return (
        <div key={`status:${option.id}`} className="chat-status-control chat-status-effort-control">
          <button
            type="button"
            className="chat-status-effort-button"
            disabled={updating || optionValues.length === 0}
            title={`Reasoning: ${label}`}
            aria-label={`Reasoning: ${label}`}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => {
              setChatPromptMenuOpen(false);
              setChatFileMentionMenuOpen(false);
              setChatConfigOverflowOpen(false);
              setChatConfigMenuOptionId(current => (current === option.id ? '' : option.id));
            }}
          >
            <span className="chat-status-effort-label">{label}</span>
          </button>
          {open ? renderChatConfigValueMenu(option) : null}
        </div>
      );
    };
    const chatReadOnlyPreview = archivedMode && archivedPreview !== null;
    const activeChatMessages = chatReadOnlyPreview ? archivedPreview.messages : chatMessages;
    const activeChatDisplayIndex = chatReadOnlyPreview ? archivedChatDisplayIndex : chatDisplayIndex;
    const activeChatRuntimeKey = chatReadOnlyPreview && selectedArchivedKey
      ? buildChatRuntimeKey(selectedArchivedKey.projectId, selectedArchivedKey.sessionId)
      : selectedChatEncodedKey;
    const activeChatDisplayTitle = chatReadOnlyPreview
      ? resolveSessionDisplayTitle(archivedPreview.session) || archivedPreview.sessionId
      : selectedChatDisplayTitle;
    const archivedPreviewProjectName = selectedArchivedKey
      ? projects.find(item => item.projectId === selectedArchivedKey.projectId)?.name ||
        archivedPreview?.session.projectName ||
        'Project'
      : 'Project';
    const activeChatBreadcrumbProjectName = chatReadOnlyPreview
      ? archivedPreviewProjectName
      : chatBreadcrumbProjectName;
    const activeChatBreadcrumbLabel = chatReadOnlyPreview
      ? `Archived - ${activeChatDisplayTitle || 'Session'}`
      : chatBreadcrumbLabel;
    const toggleChatTitlePromptMenu = () => {
      if (!chatTitlePromptMenuAvailable) return;
      setChatPromptMenuOpen(false);
      setChatFileMentionMenuOpen(false);
      setChatAttachmentTrayOpen(false);
      setChatConfigMenuOptionId('');
      setChatConfigOverflowOpen(false);
      setChatHubMenuOpen(false);
      setChatQuickSwitchMenuOpen(false);
      setChatTitleProjectMenuOpen(false);
      setChatTitlePromptMenuOpen(open => !open);
    };
    const renderDesktopChatBreadcrumbTitle = () => (
      <div className="breadcrumb-title chat-breadcrumb-title">
        <button
          ref={chatTitleProjectButtonRef}
          type="button"
          className={`chat-title-project-button${chatTitleProjectMenuOpen ? ' open' : ''}`}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => {
            setChatTitlePromptMenuOpen(false);
            setChatQuickSwitchMenuOpen(false);
            setChatTitleProjectMenuOpen(open => !open);
          }}
          title="Switch project"
          aria-label="Switch project"
          aria-haspopup="menu"
          aria-expanded={chatTitleProjectMenuOpen}
        >
          <span className="breadcrumb-project-name" title={activeChatBreadcrumbProjectName}>
            {activeChatBreadcrumbProjectName}
          </span>
          <span className="codicon codicon-chevron-down" aria-hidden="true" />
        </button>
        <button
          ref={chatTitlePromptButtonRef}
          type="button"
          className={`chat-title-prompt-icon-button${chatTitlePromptMenuOpen ? ' open' : ''}`}
          title={chatTitlePromptMenuAvailable ? 'Show prompt history' : activeChatBreadcrumbLabel}
          aria-label="Show prompt history"
          aria-haspopup="menu"
          aria-expanded={chatTitlePromptMenuOpen}
          disabled={!chatTitlePromptMenuAvailable}
          onClick={toggleChatTitlePromptMenu}
        >
          <span className="codicon codicon-history" aria-hidden="true" />
        </button>
        <span className="chat-title-session-text title-text breadcrumb-current" title={activeChatBreadcrumbLabel}>
          {activeChatBreadcrumbLabel}
        </span>
      </div>
    );
    const renderMobileChatBreadcrumbTitle = () => (
      <div className="breadcrumb-title chat-breadcrumb-title">
        <button
          ref={chatTitleProjectButtonRef}
          type="button"
          className={`chat-title-project-button${chatTitleProjectMenuOpen ? ' open' : ''}`}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => {
            setChatTitlePromptMenuOpen(false);
            setChatQuickSwitchMenuOpen(false);
            setChatTitleProjectMenuOpen(open => !open);
          }}
          title="Switch project"
          aria-label="Switch project"
          aria-haspopup="menu"
          aria-expanded={chatTitleProjectMenuOpen}
        >
          <span className="breadcrumb-project-name" title={activeChatBreadcrumbProjectName}>
            {activeChatBreadcrumbProjectName}
          </span>
          <span className="codicon codicon-chevron-down" aria-hidden="true" />
        </button>
        <button
          ref={chatTitlePromptButtonRef}
          type="button"
          className={`chat-title-session-button chat-title-session-text title-text breadcrumb-current${chatTitlePromptMenuOpen ? ' open' : ''}`}
          title={chatTitlePromptMenuAvailable ? 'Show prompt history' : activeChatBreadcrumbLabel}
          aria-label="Show prompt history"
          aria-haspopup="menu"
          aria-expanded={chatTitlePromptMenuOpen}
          aria-disabled={!chatTitlePromptMenuAvailable}
          onClick={toggleChatTitlePromptMenu}
        >
          {activeChatBreadcrumbLabel}
        </button>
      </div>
    );
    const renderChatBreadcrumbTitle = () => (isWide ? renderDesktopChatBreadcrumbTitle() : renderMobileChatBreadcrumbTitle());

    if (tab === 'chat') {
      return (
        <ChatSurface>
          <DesktopDragRegion className="block-title chat-title-bar">
            {isWide ? (
              <button
                type="button"
                className={`chat-sidebar-toggle${sidebarCollapsed ? ' collapsed' : ''}`}
                onClick={() => setSidebarCollapsed(value => !value)}
                title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
                aria-pressed={sidebarCollapsed}
              >
                <span className="codicon codicon-layout-sidebar-left" aria-hidden="true" />
              </button>
            ) : null}
            <div className="chat-title-context">
              {renderChatBreadcrumbTitle()}
            </div>
            <div className="chat-title-actions">
              <button
                type="button"
                className={`chat-terminal-toggle${terminalOpen ? ' active' : ''}`}
                onClick={toggleTerminalFromTitle}
                title={terminalOpen ? 'Hide terminal' : 'Show terminal'}
                aria-label={terminalOpen ? 'Hide terminal' : 'Show terminal'}
                aria-pressed={terminalOpen}
              >
                <span className="codicon codicon-terminal" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`chat-preview-toggle${chatPreviewOpen ? ' active' : ''}`}
                onClick={toggleChatPreviewFromTitle}
                title={chatPreviewOpen ? 'Hide preview' : 'Show preview'}
                aria-label={chatPreviewOpen ? 'Hide preview' : 'Show preview'}
                aria-pressed={chatPreviewOpen}
              >
                <span className="codicon codicon-layout-sidebar-right" aria-hidden="true" />
                {!chatPreviewOpen && previewTabCount > 0 ? (
                  <span className="chat-preview-badge" aria-label={`${previewTabCount} preview tabs`}>{previewTabCount}</span>
                ) : null}
              </button>
            </div>
          </DesktopDragRegion>
          <div
            className={chatMainClassName}
            style={chatMainStyle}
          >
            <div
              ref={chatScrollRef}
              className="scroll-panel chat-block"
              onScroll={handleChatScroll}
              onContextMenu={handleChatQuickSwitchContextMenu}
              onWheel={event => { if (event.deltaY < 0) { markChatUserScrollIntent(); } }}
              onPointerDown={() => { chatPointerScrollingRef.current = true; }}
              onPointerUp={() => { chatPointerScrollingRef.current = false; }}
              onPointerCancel={() => { chatPointerScrollingRef.current = false; }}
              onTouchStart={() => { chatPointerScrollingRef.current = true; }}
              onTouchEnd={() => { chatPointerScrollingRef.current = false; }}
              onTouchCancel={() => { chatPointerScrollingRef.current = false; }}
            >
              {!chatReadOnlyPreview && chatLoading ? (
                <div className="chat-loading-state" role="status" aria-label="Loading chat">
                  <span className="chat-loading-line" />
                  <span className="chat-loading-line" />
                  <span className="chat-loading-line" />
                </div>
              ) : null}
              {archivedMode && !archivedPreview ? (
                <div className="chat-view-content chat-empty-state-content">
                  <div className="empty-card">
                    <div className="empty-title">Select an archived session</div>
                    <div className="empty-subtitle">
                      The archived preview opens here in read-only mode.
                    </div>
                  </div>
                </div>
              ) : null}
              {chatReadOnlyPreview && activeChatMessages.length === 0 ? (
                <div className="chat-view-content chat-empty-state-content">
                  <div className="empty-card">
                    <div className="empty-title">No messages</div>
                    <div className="empty-subtitle">
                      This archive does not include rendered chat messages.
                    </div>
                  </div>
                </div>
              ) : null}
              {!archivedMode && !chatLoading && chatMessages.length === 0 && !selectedPendingPrompt ? (
                <div className="chat-view-content chat-empty-state-content">
                  <div className="empty-card">
                    <div className="empty-title">Start chatting</div>
                    <div className="empty-subtitle">
                      Messages stream here for the selected session.
                    </div>
                  </div>
                </div>
              ) : null}
              {activeChatDisplayIndex.items.length > 0 ? (
                <ChatVirtuosoTurnList
                  ref={chatVirtuosoListRef}
                  scrollRef={chatScrollRef}
                  displayIndex={activeChatDisplayIndex}
                  runtimeKey={activeChatRuntimeKey}
                  atBottomThreshold={CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD}
                  onAtBottomChange={handleChatAtBottomChange}
                  shouldAutoscroll={shouldAutoscrollChat}
                  renderItem={renderChatVirtuosoItem}
                />
              ) : null}
            </div>
            {!archivedMode && chatShowScrollToBottom ? (
            <button
              type="button"
              className="chat-scroll-bottom-button"
              onClick={forceChatScrollToBottom}
              title="Scroll to bottom"
              aria-label="Scroll to bottom"
            >
              <span className="chat-scroll-bottom-glyph" aria-hidden="true">
                <span className="codicon codicon-arrow-down" />
              </span>
            </button>
          ) : null}
          {isWide && (showPinnedRecentSessionsSurface || selectedChatPlan) ? (
            <div className="chat-edge-surface-stack">
              {showPinnedRecentSessionsSurface ? (
                <ChatRecentSessionsSurface
                  onUnpin={() => setRecentSessionsPinned(false)}
                  sessionListDensity={sessionListDensity}
                >
                  <div className="wide-project-session-list recent-sessions-list chat-recent-sessions-rows">
                    {recentSessionSections.map(section => renderRecentProjectSessionSection(section, false))}
                  </div>
                </ChatRecentSessionsSurface>
              ) : null}
              <ChatPlanSurface
                mode="desktop"
                plan={selectedChatPlan}
              />
            </div>
          ) : null}
          {!isWide ? (
            <ChatPlanSurface
              mode="mobile"
              plan={selectedChatPlan}
            />
          ) : null}
          <div
            ref={chatComposerRef}
            className={`chat-composer${chatConfigMenuOptionId || chatConfigOverflowOpen || chatContextUsageOpen ? ' config-menu-open' : ''}${chatSlashMenuVisible || chatFileMentionMenuOpen ? ' trigger-menu-open' : ''}`}
            hidden={archivedMode}
          >
            <div className="chat-composer-content">
            <input
              ref={chatFileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleChatFileChange}
            />
            <input
              ref={chatImageInputRef}
              type="file"
              multiple
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleChatImageChange}
            />
            <div
              className={`chat-composer-frame${chatComposerDragActive ? ' drag-over' : ''}`}
              onDragOver={event => {
                if (selectedChatSubmitPending) {
                  return;
                }
                if (event.dataTransfer.types.includes('Files')) {
                  event.preventDefault();
                  setChatComposerDragActive(true);
                }
              }}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setChatComposerDragActive(false);
                }
              }}
              onDrop={event => {
                if (selectedChatSubmitPending) {
                  setChatComposerDragActive(false);
                  return;
                }
                const files = chatFilesFromFileList(event.dataTransfer.files);
                if (files.length === 0) {
                  setChatComposerDragActive(false);
                  return;
                }
                event.preventDefault();
                setChatComposerDragActive(false);
                const attachmentDraftKey = currentChatDraftKeyRef.current;
                const attachmentDraftGeneration = getChatDraftGeneration(attachmentDraftKey);
                enqueueChatAttachmentFiles(files, attachmentDraftKey, attachmentDraftGeneration);
              }}
            >
              {chatAttachments.length > 0 ? (
                <div className="chat-attachment-preview-list">
                  {chatAttachments.map(attachment => {
                    const previewSrc = chatAttachmentPreviewSrc(attachment);
                    const pending = isChatAttachmentUploadPending(attachment);
                    return (
                      <div key={attachment.id} className={`chat-attachment-preview ${attachment.status}`}>
                        {previewSrc ? (
                          <img
                            className="chat-attachment-thumb"
                            src={previewSrc}
                            alt={attachment.name || 'attachment preview'}
                          />
                        ) : (
                          <div className="chat-attachment-thumb file" aria-hidden="true">
                            <span className="codicon codicon-file" />
                          </div>
                        )}
                        <div className="chat-attachment-meta">
                          <div className="chat-attachment-name">{attachment.name}</div>
                          <div className="chat-attachment-status">
                            {attachment.status === 'failed'
                              ? (attachment.error || 'Upload failed')
                              : attachment.status === 'completed'
                                ? formatChatAttachmentSize(attachment.size)
                                : attachment.status === 'queued'
                                  ? 'Ready'
                                  : `${attachment.progress}%`}
                          </div>
                          {pending ? (
                            <div className="chat-attachment-progress" aria-hidden="true">
                              <span style={{width: `${Math.max(4, attachment.progress)}%`}} />
                            </div>
                          ) : null}
                        </div>
                        {attachment.status === 'failed' ? (
                          <button
                            type="button"
                            className="chat-attachment-retry"
                            onClick={() => retryChatAttachment(attachment.id)}
                            title="Queue retry"
                            aria-label="Queue retry"
                          >
                            <span className="codicon codicon-refresh" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="chat-attachment-remove"
                          onClick={() => removeChatAttachment(attachment.id)}
                          disabled={pending}
                          title={pending ? 'Uploading' : 'Remove attachment'}
                          aria-label={pending ? 'Uploading' : 'Remove attachment'}
                        >
                          <span className="codicon codicon-close" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div className="chat-composer-input-row">
                <div className="chat-composer-input-shell">
                  <ChatRichComposer
                    ref={chatRichComposerRef}
                    className="chat-composer-input"
                    tokens={chatComposerTokens}
                    onTokensChange={updateChatComposerTokens}
                    readOnly={selectedChatSubmitPending}
                    enterKeyHint={isWide ? undefined : mobileEnterKeyBehavior === 'send' ? 'send' : 'enter'}
                    slashCommands={chatSlashCommands.filter(option => option.kind === 'skill').map(command => ({
                      command: command.name,
                      label: chatSlashCommandLabel(command.name),
                    }))}
                    selectionRestore={chatComposerSelectionRestore}
                    onPlainTextChange={(text, cursor) => {
                      chatComposerTextCursorRef.current = cursor;
                      if (voiceRecordingRef.current || voiceAwaitingFinalRef.current) {
                        return;
                      }
                      closeChatAttachmentTray();
                      scheduleChatSlashMenu(text, cursor);
                      scheduleChatFileMentionSearch(text, cursor);
                    }}
                    onPaste={event => {
                      if (voiceRecordingRef.current) {
                        event.preventDefault();
                        return;
                      }
                      if (voiceAwaitingFinalRef.current) {
                        event.preventDefault();
                        return;
                      }
                      if (selectedChatSubmitPending) {
                        return;
                      }
                      if (!supportsChatClipboardFiles) {
                        return;
                      }
                      const attachmentDraftKey = currentChatDraftKeyRef.current;
                      const attachmentDraftGeneration = getChatDraftGeneration(attachmentDraftKey);
                      const files = chatFilesFromDataTransferItems(event.clipboardData?.items);
                      if (files.length === 0) {
                        return;
                      }
                      event.preventDefault();
                      enqueueChatAttachmentFiles(files, attachmentDraftKey, attachmentDraftGeneration);
                    }}
                    onKeyDown={event => {
                      if (voiceRecordingRef.current) {
                        event.preventDefault();
                        return;
                      }
                      if (voiceAwaitingFinalRef.current) {
                        event.preventDefault();
                        return;
                      }
                      if (chatFileMentionMenuOpen) {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          event.stopPropagation();
                          setChatFileMentionActiveIndex(prev => {
                            if (chatFileMentionResults.length === 0) {
                              return 0;
                            }
                            return (prev + 1) % chatFileMentionResults.length;
                          });
                          return;
                        }
                        if (event.key === 'ArrowUp') {
                          event.preventDefault();
                          event.stopPropagation();
                          setChatFileMentionActiveIndex(prev => {
                            if (chatFileMentionResults.length === 0) {
                              return 0;
                            }
                            return (prev - 1 + chatFileMentionResults.length) % chatFileMentionResults.length;
                          });
                          return;
                        }
                        if (event.key === 'ArrowRight') {
                          event.preventDefault();
                          event.stopPropagation();
                          const activeResult = chatFileMentionResults[chatFileMentionActiveIndex];
                          if (activeResult) {
                            openChatFileMentionPreview(activeResult);
                          }
                          return;
                        }
                        if ((event.key === 'Enter' || event.key === 'Tab') && !event.altKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          event.stopPropagation();
                          const activeResult = chatFileMentionResults[chatFileMentionActiveIndex];
                          if (!activeResult) {
                            return;
                          }
                          applyChatFileMentionResult(activeResult);
                          return;
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          event.stopPropagation();
                          setChatFileMentionMenuOpen(false);
                          resetChatFileMentionSearchSession();
                          return;
                        }
                      }
                      if (chatSlashMenuVisible) {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          event.stopPropagation();
                          setChatSlashActiveIndex(prev => {
                            if (chatSlashMenuOptions.length === 0) {
                              return 0;
                            }
                            return (prev + 1) % chatSlashMenuOptions.length;
                          });
                          return;
                        }
                        if (event.key === 'ArrowUp') {
                          event.preventDefault();
                          event.stopPropagation();
                          setChatSlashActiveIndex(prev => {
                            if (chatSlashMenuOptions.length === 0) {
                              return 0;
                            }
                            return (prev - 1 + chatSlashMenuOptions.length) % chatSlashMenuOptions.length;
                          });
                          return;
                        }
                        if ((event.key === 'Enter' || event.key === 'Tab') && !event.altKey && !event.nativeEvent.isComposing) {
                          event.preventDefault();
                          event.stopPropagation();
                          if (!activeChatSlashCommand) {
                            return;
                          }
                          applyChatSlashCommand(activeChatSlashCommand);
                          return;
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          event.stopPropagation();
                          setChatPromptMenuOpen(false);
                          setChatSlashQuery(null);
                          setChatSlashActiveIndex(0);
                          return;
                        }
                      }
                      const shouldSendChatOnEnter = event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing;
                      if (!shouldSendChatOnEnter) {
                        return;
                      }
                      const mobileEnterShouldSend = !isWide && mobileEnterKeyBehavior === 'send';
                      if (mobileEnterShouldSend || isWindowsPlatform) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (chatSendDisabled) {
                          return;
                        }
                        sendChatMessage().catch(() => undefined);
                      }
                    }}
                  />
                </div>
                <div className="chat-composer-action-column">
                  {voiceInputEnabled ? (
                    <VoiceInputButton
                      recording={voiceRecording}
                      recordingMode={voiceInteractionMode}
                      hasSendableContent={chatComposerHasSendableContent}
                      disabled={chatAttachmentUploadPending || voiceRecordingStatus === 'recognizing'}
                      readOnly={selectedChatSubmitPending}
                      onSend={() => sendChatMessage().catch(() => undefined)}
                      onStart={startVoiceInput}
                      onFinish={finishVoiceInput}
                      onCancel={cancelVoiceInputByGesture}
                      onModeChange={setVoiceInputInteractionMode}
                      onCancelIntentChange={setVoiceCancelIntent}
                      onLog={logVoiceInputButtonEvent}
                    />
                  ) : (
                    <button
                      type="button"
                      className="chat-send-button"
                      onClick={() => sendChatMessage().catch(() => undefined)}
                      disabled={chatSendDisabled}
                      title="Send"
                      aria-label="Send message"
                    >
                      <span className="codicon codicon-send" />
                    </button>
                  )}
                </div>
              </div>
              {chatFileMentionMenuOpen ? (
                <div ref={chatFileMentionMenuRef} className="chat-file-mention-menu" role="listbox" aria-label="File mentions">
                  <div className="chat-file-mention-shortcut-tip">Up/Down to browse, Right to preview</div>
                  {chatFileMentionLoading ? (
                    <div className="chat-file-mention-empty">Searching...</div>
                  ) : chatFileMentionError ? (
                    <div className="chat-file-mention-empty">File search failed</div>
                  ) : !chatFileMentionIndexed ? (
                    <div className="chat-file-mention-empty">Index not built</div>
                  ) : chatFileMentionResults.length === 0 ? (
                    <div className="chat-file-mention-empty">{chatFileMentionQuery ? 'No files found' : 'No indexed files'}</div>
                  ) : (
                    chatFileMentionResults.map((result, index) => {
                      const selected = index === chatFileMentionActiveIndex;
                      const name = result.name || chatFileMentionName(result.path);
                      return (
                        <div
                          key={result.path}
                          className={`chat-file-mention-option chat-file-mention-option-row${selected ? ' active' : ''}`}
                          role="option"
                          aria-selected={index === chatFileMentionActiveIndex}
                          title={result.path}
                          onMouseEnter={() => setChatFileMentionActiveIndex(index)}
                        >
                          <button
                            type="button"
                            className="chat-file-mention-option-main"
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => applyChatFileMentionResult(result)}
                          >
                            <span className="codicon codicon-file-code" aria-hidden="true" />
                            <span className="chat-file-mention-name">{name}</span>
                            <span className="chat-file-mention-path">{result.path}</span>
                          </button>
                          <button
                            type="button"
                            className="chat-file-mention-preview-button"
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => openChatFileMentionPreview(result)}
                            title={`Open ${name} preview`}
                            aria-label={`Open ${name} preview`}
                          >
                            <span className="codicon codicon-open-preview" aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : null}
              {chatSlashMenuVisible ? (
                <div ref={chatSlashMenuRef} className="chat-slash-menu" role="listbox" aria-label="Available commands and skills">
                  {chatSlashMenuOptions.map((option, index) => {
                    const selected = index === chatSlashActiveIndex;
                    return (
                      <button
                        key={option.name}
                        type="button"
                        className={`chat-slash-item ${option.kind}${selected ? ' active' : ''}${option.enabled ? '' : ' disabled'}`}
                        role="option"
                        aria-selected={selected}
                        aria-disabled={!option.enabled}
                        disabled={!option.enabled}
                        title={option.enabled ? option.description : option.disabledReason}
                        onMouseEnter={() => setChatSlashActiveIndex(index)}
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => applyChatSlashCommand(option)}
                      >
                        <span className={`codicon ${option.icon} chat-slash-icon`} aria-hidden="true" />
                        <span className="chat-slash-name">{option.name}</span>
                        {option.description || option.disabledReason ? (
                          <span className="chat-slash-description">{option.enabled ? option.description : option.disabledReason}</span>
                        ) : null}
                        {option.checked !== undefined ? (
                          <span className={`chat-slash-switch${option.checked ? ' checked' : ''}`} aria-hidden="true">
                            <span className="chat-slash-switch-knob" />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {voiceRecording ? (
                <VoiceRecordingBar
                  status={voiceRecordingStatus}
                  cancelIntent={voiceCancelIntent}
                  elapsedMs={voiceElapsedMs}
                  level={voiceLevel}
                />
              ) : (
              <div className="chat-composer-toolbar">
                <div className="chat-composer-tools">
                  <button
                    type="button"
                    ref={chatPromptButtonRef}
                    className="chat-tool-button chat-slash-button"
                    onPointerDown={event => event.preventDefault()}
                    onClick={openChatPromptMenu}
                    title="Commands and skills"
                    aria-label="Open commands and skills"
                    aria-haspopup="listbox"
                    aria-expanded={chatPromptMenuOpen}
                  >
                    <span className="chat-composer-tool-glyph chat-slash-symbol" aria-hidden="true">/</span>
                  </button>
                  <button
                    type="button"
                    ref={chatFileMentionButtonRef}
                    className="chat-tool-button chat-file-mention-trigger-button"
                    onPointerDown={event => event.preventDefault()}
                    onClick={openChatFileMentionShortcut}
                    title="Mention files"
                    aria-label="Mention files"
                    aria-haspopup="listbox"
                    aria-expanded={chatFileMentionMenuOpen}
                  >
                    <span className="chat-composer-tool-glyph chat-at-symbol" aria-hidden="true">@</span>
                  </button>
                  <button
                    type="button"
                    ref={chatAttachmentTrayButtonRef}
                    className="chat-tool-button chat-attachment-plus-button"
                    onPointerDown={event => event.preventDefault()}
                    onClick={() => {
                      if (selectedChatPromptRunning) return;
                      toggleChatAttachmentTray();
                    }}
                    title="Tools"
                    aria-label="Open composer tools"
                    aria-haspopup="menu"
                    aria-expanded={!selectedChatPromptRunning && chatAttachmentTrayOpen}
                  >
                    <span className="codicon codicon-file-media chat-composer-tool-glyph" aria-hidden="true" />
                  </button>
                  <div className="chat-composer-stop-slot">
                    {selectedChatPromptRunning ? (
                      <button
                        type="button"
                        className={chatComposerStopTriggerClassName}
                        onPointerDown={event => event.preventDefault()}
                        onClick={() => cancelSelectedChatPrompt().catch(() => undefined)}
                        disabled={selectedChatPromptCancelling}
                        title={selectedChatPromptCancelling ? 'Cancelling prompt' : 'Cancel prompt'}
                        aria-label="Cancel prompt"
                        aria-busy={selectedChatPromptCancelling}
                      >
                        <span className={`codicon ${selectedChatPromptCancelling ? 'codicon-loading codicon-modifier-spin' : 'codicon-stop-circle'} chat-composer-tool-glyph`} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  {!selectedChatPromptRunning && chatAttachmentTrayOpen ? (
                    <div
                      ref={chatAttachmentTrayRef}
                      className="chat-attachment-action-tray"
                      role="menu"
                      aria-label="Composer tools"
                    >
                      <button
                        type="button"
                        className="chat-attachment-action-button file"
                        onClick={() => {
                          closeChatAttachmentTray();
                          setChatPromptMenuOpen(false);
                          setChatFileMentionMenuOpen(false);
                          setChatConfigMenuOptionId('');
                          setChatConfigOverflowOpen(false);
                          chatFileInputRef.current?.click();
                        }}
                        disabled={selectedChatSubmitPending}
                        title="Attach file"
                        aria-label="Attach file"
                        role="menuitem"
                      >
                        <span className="codicon codicon-attach" aria-hidden="true" />
                        <span className="chat-attachment-action-label">File</span>
                      </button>
                      <button
                        type="button"
                        className="chat-attachment-action-button photo"
                        onClick={() => {
                          closeChatAttachmentTray();
                          setChatPromptMenuOpen(false);
                          setChatFileMentionMenuOpen(false);
                          setChatConfigMenuOptionId('');
                          setChatConfigOverflowOpen(false);
                          chatImageInputRef.current?.click();
                        }}
                        disabled={selectedChatSubmitPending}
                        title="Attach photo"
                        aria-label="Attach photo"
                        role="menuitem"
                      >
                        <span className="codicon codicon-device-camera" aria-hidden="true" />
                        <span className="chat-attachment-action-label">Photo</span>
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="chat-composer-toolbar-actions">
                  {chatContextUsage || selectedChatConfigOptions.length > 0 ? (
                    <div className="chat-config-options-wrap">
                      <div
                        ref={chatConfigOptionsRef}
                        className={`chat-config-options-shell${chatComposerStatusCompact ? ' compact' : ''}`}
                      >
                        {renderChatContextUsage()}
                        {renderChatStatusModel(chatConfigStatus.modelOption)}
                        {renderChatFastModeIndicator()}
                        {renderChatStatusEffort(chatConfigStatus.reasoningOption)}
                        {chatConfigOptions.length > 0 ? (
                          <div className="chat-config-options">
                            {chatConfigOptions.map(option => renderChatConfigPill(option))}
                          </div>
                        ) : null}
                        {chatConfigStatus.showOverflowToggle ? (
                          <div ref={chatConfigOverflowRef} className="chat-config-overflow-anchor">
                            <button
                              type="button"
                              className="chat-config-overflow-button chat-config-expand-button"
                              aria-label={chatConfigOverflowOpen ? 'Hide config options' : `Show ${chatConfigOverflowOptions.length} config options`}
                              aria-expanded={chatConfigOverflowOpen}
                              title={chatConfigOverflowOpen ? 'Hide config options' : 'Show config options'}
                              onClick={() => {
                                setChatPromptMenuOpen(false);
                                setChatFileMentionMenuOpen(false);
                                setChatConfigMenuOptionId('');
                                setChatConfigOverflowOpen(prev => !prev);
                              }}
                            >
                              <span
                                className={`codicon ${chatConfigOverflowOpen ? 'codicon-chevron-up' : 'codicon-chevron-down'}`}
                                aria-hidden="true"
                              />
                            </button>
                            {chatConfigOverflowOpen ? (
                              <div className="chat-config-overflow-menu" aria-label="Config options">
                                {chatConfigOverflowOptions.map(option => {
                                  const optionValues = option.options ?? [];
                                  const currentValue = chatConfigCurrentValue(option);
                                  const updating =
                                    chatConfigUpdatingKey ===
                                    `${selectedChatSession?.sessionId ?? ''}:${option.id}`;
                                  const optionLabel = option.name || option.id;
                                  return (
                                    <div key={`overflow:${option.id}`} className="chat-config-overflow-group">
                                      <div className="chat-config-item-label" title={optionLabel}>
                                        {optionLabel}
                                      </div>
                                      <div className="chat-config-overflow-values">
                                        {optionValues.map(item => {
                                          const selected = item.value === currentValue;
                                          return (
                                            <button
                                              key={`overflow:${option.id}:${item.value}`}
                                              type="button"
                                              className={`chat-config-value-option${selected ? ' selected' : ''}`}
                                              disabled={updating}
                                              aria-pressed={selected}
                                              onClick={() => {
                                                setChatConfigOverflowOpen(false);
                                                handleChatConfigOptionChange(
                                                  option,
                                                  item.value,
                                                ).catch(() => undefined);
                                              }}
                                            >
                                              <span className="chat-config-value-label">{item.name || item.value}</span>
                                              {selected ? (
                                                <span className="codicon codicon-check" aria-hidden="true" />
                                              ) : null}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              )}
            </div>
          </div>
          </div>
          </div>
          {isWide && terminalOpen ? (
            <>
              <div
                className="terminal-splitter"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize terminal panel"
                onPointerDown={beginTerminalPanelResize}
                onPointerMove={moveTerminalPanelResize}
                onPointerUp={finishTerminalPanelResize}
                onPointerCancel={finishTerminalPanelResize}
              />
              <section className="terminal-desktop-panel" style={{height: terminalPanelHeight}}>
                <TerminalWorkbench mode="desktop"
                  terminals={terminalItems}
                  activeKey={activeTerminalKey}
                  unavailableHubIds={terminalSync.unavailableHubIds}
                  onSelect={handleSelectTerminal}
                  onCreate={() => { handleCreateTerminal().catch(err => setError(err instanceof Error ? err.message : String(err))); }}
                  onRequestClose={handleRequestCloseTerminal}
                  onRestart={item => { handleRestartTerminal(item).catch(err => setError(err instanceof Error ? err.message : String(err))); }}
                  onClaimResize={handleClaimTerminalResize}
                  onSendBytes={handleTerminalInput}
                >
                  {activeTerminal ? (
                    <TerminalView
                      key={activeTerminalKey}
                      ref={terminalViewRef}
                      active
                      resizeEnabled={terminalResizeTokensRef.current.has(activeTerminalKey)}
                      cols={activeTerminal.cols}
                      rows={activeTerminal.rows}
                      shell={activeTerminal.shell}
                      initialCwd={activeTerminal.initialCwd}
                      onInput={handleTerminalInput}
                      onResize={handleTerminalResize}
                      onAutoResize={handleAutoClaimTerminalResize}
                    />
                  ) : null}
                </TerminalWorkbench>
              </section>
            </>
          ) : null}
        </ChatSurface>
      );
    }
    if (tab === 'file') {
      return (
        <FileSurface>
          <div className="block-title with-tools file-title-bar">
            {isWide ? (
              <span className="title-text">
                {selectedFile || 'Select a file'}
              </span>
            ) : (
              renderBreadcrumbTitle(breadcrumbProjectName, fileBreadcrumbLabel)
            )}
            <div className="view-tools">{renderViewTools()}</div>
          </div>
          <div className="file-pane">
            <div className="file-main-col">
              {hasPinnedFiles ? (
                <div className="pinned-strip">
                  <span className="pinned-label">Pinned</span>
                  {pinnedFiles.map(path => (
                    <div
                      key={path}
                      className={`pinned-entry ${
                        selectedFile === path ? 'active' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="pinned-open"
                        onClick={() => setSelectedFile(path)}
                        title={path}
                      >
                        {path.split('/').pop() || path}
                      </button>
                      <button
                        type="button"
                        className="pinned-close"
                        onClick={() =>
                          setPinnedFiles(prev =>
                            prev.filter(item => item !== path),
                          )
                        }
                        aria-label={`Unpin ${path}`}
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="file-code-area">
                <div ref={fileSideActionsRef} className="file-side-actions">
                  <button
                    type="button"
                    className={`pinned-pin-toggle file-pin-floating ${
                      isSelectedFilePinned ? 'active' : ''
                    }`}
                    onClick={togglePinSelectedFile}
                    disabled={!selectedFile}
                    title={
                      isSelectedFilePinned
                        ? 'Unpin current file'
                        : 'Pin current file'
                    }
                    aria-label={
                      isSelectedFilePinned
                        ? 'Unpin current file'
                        : 'Pin current file'
                    }
                  >
                    <span className="codicon codicon-pinned view-tool-icon" />
                  </button>
                  <div className="file-action-group side-action-group">
                    <button
                      type="button"
                      className={`view-tool ${gotoToolsOpen ? 'active' : ''}`}
                      onClick={() => {
                        setGotoToolsOpen(value => {
                          const next = !value;
                          if (next) setSearchToolsOpen(false);
                          return next;
                        });
                      }}
                      title="Toggle go to line"
                      aria-label="Toggle go to line"
                    >
                      <span className="codicon codicon-symbol-number view-tool-icon" />
                    </button>
                    <div
                      className={`file-action-panel side-action-panel ${
                        gotoToolsOpen ? 'open' : ''
                      }`}
                    >
                      <input
                        className="goto-input"
                        value={gotoLineInput}
                        onChange={event => setGotoLineInput(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            triggerGoToLine();
                          }
                        }}
                        inputMode="numeric"
                        placeholder="Line"
                      />
                      <button
                        type="button"
                        className="view-tool goto-trigger"
                        title="Go to line"
                        onClick={triggerGoToLine}
                      >
                        <span className="codicon codicon-arrow-right view-tool-icon" />
                      </button>
                    </div>
                  </div>
                  <div className="file-action-group side-action-group">
                    <button
                      type="button"
                      className={`view-tool ${searchToolsOpen ? 'active' : ''}`}
                      onClick={() => {
                        setSearchToolsOpen(value => {
                          const next = !value;
                          if (next) setGotoToolsOpen(false);
                          return next;
                        });
                      }}
                      title="Toggle search"
                      aria-label="Toggle search"
                    >
                      <span className="codicon codicon-search view-tool-icon" />
                    </button>
                    <div
                      className={`file-action-panel side-action-panel ${
                        searchToolsOpen ? 'open' : ''
                      }`}
                    >
                      <input
                        className="search-input"
                        value={fileSearchQuery}
                        onChange={event =>
                          setFileSearchQuery(event.target.value)
                        }
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            navigateSearchMatch(1);
                          }
                        }}
                        placeholder="Find in file"
                      />
                      <button
                        type="button"
                        className="view-tool search-nav"
                        title="Previous match"
                        onClick={() => navigateSearchMatch(-1)}
                      >
                        <span className="codicon codicon-chevron-up view-tool-icon" />
                      </button>
                      <button
                        type="button"
                        className="view-tool search-nav"
                        title="Next match"
                        onClick={() => navigateSearchMatch(1)}
                      >
                        <span className="codicon codicon-chevron-down view-tool-icon" />
                      </button>
                      <span className="search-count">
                        {fileSearchMatches.length === 0
                          ? '0/0'
                          : `${currentMatchIndex + 1}/${
                              fileSearchMatches.length
                            }`}
                      </span>
                    </div>
                  </div>
                </div>
                <FilePreviewPane
                  scrollRef={fileScrollRef}
                  onScroll={event => {
                    const path = selectedFileRef.current;
                    if (!path) return;
                    fileScrollTopByPathRef.current[path] = event.currentTarget.scrollTop;
                  }}
                >
                  {fileLoading ? (
                    <div className="muted block">Loading file...</div>
                  ) : selectedFileIsImage ? (
                    selectedFileImageSrc ? (
                      <div className="file-image-preview-wrap">
                        <img
                          className="file-image-preview"
                          src={selectedFileImageSrc}
                          alt={selectedFile.split('/').pop() || 'image preview'}
                        />
                      </div>
                    ) : (
                      <div className="muted block">Image content is unavailable.</div>
                    )
                  ) : selectedFileIsMarkdown && markdownPreviewEnabled ? (
                    <MarkdownPreview
                      content={fileContent}
                      themeMode={themeMode}
                      codeTheme={codeTheme}
                      codeFont={codeFont}
                      codeFontSize={codeFontSize}
                      codeLineHeight={codeLineHeight}
                      codeTabSize={codeTabSize}
                      wrap={wrapLines}
                      lineNumbers={showLineNumbers}
                    />
                  ) : selectedFileIsHtml && htmlPreviewEnabled ? (
                    <HtmlPreview
                      key={selectedFile}
                      content={fileContent}
                    />
                  ) : (
                    renderCodePane(
                      fileContent,
                      false,
                      detectCodeLanguage(selectedFile),
                      {
                        highlightedLines: fileTabSelectedLines,
                        onLineClick: handleFileTabLineClick,
                      },
                    )
                  )}
                </FilePreviewPane>
              </div>
            </div>
          </div>
        </FileSurface>
      );
    }

    return (
      <GitSurface>
        <div className="block-title with-tools">
          {isWide ? (
            <span className="title-text">
              {selectedDiff || 'Select a changed file'}
            </span>
          ) : (
            renderBreadcrumbTitle(breadcrumbProjectName, gitBreadcrumbLabel)
          )}
          <div className="view-tools">{renderViewTools()}</div>
        </div>
        <div className="scroll-panel">
          {heavyDiffDeferred ? (
            <div className="muted block">
              Heavy generated file selected. Diff loading is paused to keep UI
              responsive.
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="button"
                  onClick={() => setAllowHeavyDiffLoad(true)}
                >
                  Load Diff
                </button>
              </div>
            </div>
          ) : diffLoading ? (
            <div className="muted block">Loading diff...</div>
          ) : (
            renderDiffPane(diffText, selectedDiff)
          )}
        </div>
      </GitSurface>
    );
  };

  const scrollToPreviewSearchMatch = (match: PreviewSearchMatch) => {
    const tab = activePreviewTab(previewWorkbenchRef.current);
    if (!tab) {
      return;
    }
    previewSearchJumpCancelRef.current?.();
    previewSearchJumpCancelRef.current = null;
    if (match.kind === 'file') {
      if (tab.type !== 'file') {
        return;
      }
      if (isHtmlPath(tab.path)) {
        setPreviewWorkbench(current =>
          updatePreviewTab(current, tab.projectId, tab.id, item =>
            item.type === 'file' ? {...item, targetLine: match.line} : item,
          ),
        );
        chatPeekAnchorRef.current = match.line;
        return;
      }
      previewSearchJumpCancelRef.current = schedulePreviewLineJump({
        getContainer: () => chatFilePeekScrollRef.current,
        isCurrent: () => activePreviewTab(previewWorkbenchRef.current)?.id === tab.id,
        line: match.line,
        content: tab.content,
        mode: isMarkdownPath(tab.path) ? 'markdown' : 'code',
        lineHeight: Math.max(12, codeFontSize * codeLineHeight),
      });
      chatPeekAnchorRef.current = match.line;
      setChatPeekSelectedLines(new Set([match.line]));
      return;
    }
    if (tab.type !== 'prompt-diff') {
      return;
    }
    setPreviewWorkbench(current =>
      updatePreviewTab(current, tab.projectId, tab.id, item =>
        item.type === 'prompt-diff'
          ? {
              ...item,
              files: item.files.map(file =>
                file.path === match.path ? {...file, expanded: true} : file,
              ),
            }
          : item,
      ),
    );
    previewSearchJumpCancelRef.current = schedulePreviewLineJump({
      getContainer: () => chatFilePeekScrollRef.current,
      isCurrent: () => activePreviewTab(previewWorkbenchRef.current)?.id === tab.id,
      line: match.line,
      content: '',
      mode: 'code',
      lineHeight: Math.max(12, codeFontSize * codeLineHeight),
      approximate: false,
      resolveTarget: rawContainer => {
        const currentContainer = rawContainer as HTMLElement;
        const fileNode = Array.from(
          currentContainer.querySelectorAll<HTMLElement>('.chat-prompt-diff-file'),
        ).find(node => node.dataset.previewDiffPath === match.path);
        return fileNode?.querySelector<HTMLElement>(
          `.code-wrap [data-line-number="${match.line}"]`,
        ) ?? null;
      },
      onMiss: rawContainer => {
        const currentContainer = rawContainer as HTMLElement;
        const fileNode = Array.from(
          currentContainer.querySelectorAll<HTMLElement>('.chat-prompt-diff-file'),
        ).find(node => node.dataset.previewDiffPath === match.path);
        if (!fileNode) return;
        const codeNode = fileNode.querySelector<HTMLElement>('.code-wrap') ?? fileNode;
        const containerRect = currentContainer.getBoundingClientRect();
        const codeRect = codeNode.getBoundingClientRect();
        const renderedLineHeight = Math.max(12, codeFontSize * codeLineHeight);
        const targetTop =
          currentContainer.scrollTop +
          codeRect.top -
          containerRect.top +
          (match.line - 1) * renderedLineHeight -
          currentContainer.clientHeight / 2;
        const maxScrollTop = Math.max(
          0,
          currentContainer.scrollHeight - currentContainer.clientHeight,
        );
        currentContainer.scrollTop = Math.min(maxScrollTop, Math.max(0, targetTop));
      },
    });
  };

  useEffect(() => {
    setPreviewSearchActiveIndex(current =>
      Math.min(current, Math.max(0, previewSearchMatches.length - 1)),
    );
  }, [previewSearchMatches.length]);

  useEffect(() => {
    if (!previewSearchOpen || previewSearchMatches.length === 0) {
      return;
    }
    setPreviewSearchActiveIndex(0);
    window.requestAnimationFrame(() => {
      scrollToPreviewSearchMatch(previewSearchMatches[0]);
    });
  }, [
    previewSearchOpen,
    previewSearchQuery,
    previewSearchDocument,
    activeWorkbenchTab?.id,
  ]);

  useEffect(() => {
    if (!quickFileOpen) {
      return;
    }
    setQuickFileActiveIndex(current =>
      Math.min(current, Math.max(0, quickFileResults.length - 1)),
    );
  }, [quickFileOpen, quickFileResults.length]);

  useEffect(() => {
    const handleGlobalPreviewKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key.toLowerCase() === 'p' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        if (quickFileOpen) {
          quickFileInputRef.current?.focus();
          return;
        }
        openQuickFileSearch();
        return;
      }
      if (!chatPreviewOpen) {
        return;
      }
      if (quickFileOpen) {
        return;
      }
      if (event.key === 'Tab' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        const nextTabId = cyclePreviewTabId(previewWorkbenchTabs, activeWorkbenchTab?.id ?? '', event.shiftKey ? -1 : 1);
        if (nextTabId) {
          setPreviewWorkbench(current => {
            const projectId = current.activeProjectId;
            const tab = (current.tabsByProjectId[projectId] ?? []).find(item => item.id === nextTabId);
            if (!tab) {
              return current;
            }
            return {
              ...current,
              activeTabIdByProjectId: {
                ...current.activeTabIdByProjectId,
                [projectId]: nextTabId,
              },
            };
          });
        }
        return;
      }
      if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setPreviewSearchOpen(true);
        setPreviewSearchActiveIndex(0);
        setPreviewSelectionMenu(null);
        window.requestAnimationFrame(() => {
          previewSearchInputRef.current?.focus();
          previewSearchInputRef.current?.select();
        });
        return;
      }
    };
    window.addEventListener('keydown', handleGlobalPreviewKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalPreviewKeyDown, true);
  }, [
    activeWorkbenchTab?.id,
    chatPreviewOpen,
    openQuickFileSearch,
    previewWorkbenchTabs,
    quickFileOpen,
  ]);

  useEffect(() => {
    if (!previewSelectionMenu) {
      return undefined;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (previewSelectionMenuRef.current?.contains(target)) {
        return;
      }
      setPreviewSelectionMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewSelectionMenu(null);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [previewSelectionMenu]);

  const hasCachedWorkspace = projects.length > 0 || !!projectId;
  const keepWorkspaceVisible =
    reconnecting && hasCachedWorkspace;

  if (!connected && !keepWorkspaceVisible) {
    return (
      <div className={`page theme-${themeMode}`}>
        {setiFontCss ? <style>{setiFontCss}</style> : null}
        {getDesktopWindowBridge() ? (
          <div className="connect-titlebar">
            <span>WheelMaker</span>
            <DesktopWindowControls />
          </div>
        ) : null}
        <div className="connect" aria-busy={autoConnecting}>
          <h3>WheelMaker Registry</h3>
          {registryAuth.state === 'checking' ? <div>Checking login...</div> : null}
          {registryAuth.state === 'authenticated' ? (
            <button className="button" disabled={autoConnecting} onClick={() => connect().catch(() => undefined)}>
              {autoConnecting ? 'Connecting...' : 'Connect'}
            </button>
          ) : null}
          {registryAuth.state === 'unauthenticated' || registryAuth.state === 'logging-in' || registryAuth.state === 'error' ? (
            <>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={loginToken}
                onChange={event => setLoginToken(event.target.value)}
                placeholder="Registry token"
              />
              <button
                className="button"
                disabled={registryAuth.state === 'logging-in' || !loginToken.trim()}
                onClick={() => handleRegistryLogin().catch(() => undefined)}
              >
                {registryAuth.state === 'logging-in' ? 'Logging in...' : 'Log in'}
              </button>
              {registryAuth.state === 'error' ? (
                <button className="button" onClick={() => void registryAuthController.check()}>Retry</button>
              ) : null}
              {registryAuth.error ? <div className="error" role="alert">{registryAuth.error}</div> : null}
            </>
          ) : null}
          {error ? <div className="error" role="alert">{error}</div> : null}
        </div>
      </div>
    );
  }

  const projectMenu = projectMenuOpen ? (
    <div className="project-menu">
      {projects.map(projectItem => (
        <div
          key={projectItem.projectId}
          className={`item project-menu-item ${
            projectItem.projectId === projectId ? 'selected' : ''
          }`}
          onClick={() =>
            syncWorkspaceProject(projectItem.projectId, {reason: 'manual'}).catch(() => undefined)
          }
        >
          <div className="project-menu-main">
            <span className="project-menu-name">{projectItem.name}</span>
            <span
              className="project-menu-path"
              title={projectItem.path || ''}
            >
              {projectItem.path || '-'}
            </span>
          </div>
          <span className="project-menu-hub">
            {projectItem.hubId || 'local-hub'}
          </span>
        </div>
      ))}
    </div>
  ) : null;

  const refreshButtonContent = refreshingProject ? (
    '...'
  ) : reconnecting ? (
    <span className="codicon codicon-loading codicon-modifier-spin" />
  ) : (
    <span className="codicon codicon-refresh" />
  );

  const chatQuickSwitchMenuBlockedByPreview = chatPreviewOpen && (chatQuickSwitchMenuPlacement.kind !== 'desktop' || !isWide);
  const chatQuickSwitchMenu = chatQuickSwitchMenuOpen && tab === 'chat' && !sidebarSettingsOpen && !mobilePortRelayFrameOpen && !chatQuickSwitchMenuBlockedByPreview ? (
    <ChatQuickSwitchMenu
      ref={chatQuickSwitchMenuRef}
      sections={mobileChatQuickSwitchSections}
      placement={chatQuickSwitchMenuPlacement.kind}
      style={chatQuickSwitchMenuStyle}
      createProjectId={chatQuickSwitchCreateProjectId}
      createPendingKey={chatQuickSwitchCreatePendingKey}
      isSessionSelected={(targetProjectId, session) =>
        selectedChatEncodedKey === buildChatRuntimeKey(targetProjectId, session.sessionId)
      }
      renderSessionStateMarker={renderSessionStateMarker}
      resolveSessionTitle={resolveSessionDisplayTitle}
      formatSessionAge={formatCompactRelativeAge}
      getProjectAgents={getQuickSwitchProjectAgents}
      resolveProjectHubStyle={hubAccentStyle}
      onToggleCreateProject={handleQuickSwitchToggleCreateProject}
      onCreateSession={handleQuickSwitchCreateSession}
      onSelectSession={handleMobileChatQuickSwitchSelect}
    />
  ) : null;
  const chatTitleProjectMenu = chatTitleProjectMenuOpen ? (
    <div
      ref={chatTitleProjectMenuRef}
      className="chat-title-project-menu"
      role="menu"
      aria-label="Switch project"
      style={chatTitleProjectMenuStyle}
      onPointerDown={event => event.stopPropagation()}
    >
      {visibleProjectItems.map(projectItem => {
        const selectedProjectId = selectedChatKey?.projectId || projectId;
        const selected = projectItem.projectId === selectedProjectId;
        return (
          <button
            key={`chat-title-project:${projectItem.projectId}`}
            type="button"
            className={`chat-title-project-menu-item${selected ? ' selected' : ''}`}
            role="menuitemradio"
            aria-checked={selected}
            title={projectItem.path || projectItem.projectId}
            onClick={() => handleChatTitleProjectSelect(projectItem.projectId).catch(() => undefined)}
          >
            <span className="chat-title-project-menu-name">{projectItem.name}</span>
            <span className="chat-title-project-menu-path">
              {projectItem.path || projectItem.hubId || projectItem.projectId}
            </span>
          </button>
        );
      })}
    </div>
  ) : null;
  const chatTitlePromptMenu = chatTitlePromptMenuOpen && chatTitlePromptMenuAvailable ? (
    <div
      ref={chatTitlePromptMenuRef}
      className="chat-title-prompt-menu"
      role="menu"
      aria-label="Prompt history"
      style={chatTitlePromptMenuStyle}
    >
      {activeChatPromptHistory.map(item => (
        <button
          key={item.key}
          type="button"
          className="chat-title-prompt-menu-item"
          role="menuitem"
          title={item.preview}
          onClick={() => jumpToChatPromptTurn(item.turnIndex)}
        >
          <span className="chat-title-prompt-menu-label">{item.label}</span>
          <span className="chat-title-prompt-menu-preview">{item.preview}</span>
        </button>
      ))}
    </div>
  ) : null;

  const floatingControlStack = !isWide ? (
    <div
      className="floating-control-stack-layer"
      data-drag-state={floatingDragVisualState}
      data-side={floatingControlSide}
      data-side-pulse={floatingSidePulse}
    >
      <div className="floating-control-drag-backdrop" aria-hidden="true" />
      <div className="floating-control-dock-rail left" aria-hidden="true" />
      <div className="floating-control-dock-rail right" aria-hidden="true" />
      <div
        ref={floatingControlStackRef}
        className="floating-control-stack"
        data-drag-state={floatingDragVisualState}
        data-idle={floatingControlsIdle}
        data-side={floatingControlSide}
        style={effectiveFloatingControlStackStyle}
        onPointerMove={handleGestureNavigationPointerMove}
        onPointerUp={event => {
          floatingIgnoreLostCaptureRef.current = true;
          if (floatingDragStateRef.current?.pointerId === event.pointerId) {
            finishFloatingDrag(event.pointerId);
            return;
          }
          finishGestureNavigation(event.pointerId);
        }}
        onPointerCancel={event => {
          floatingIgnoreLostCaptureRef.current = true;
          if (floatingDragStateRef.current?.pointerId === event.pointerId) {
            cancelFloatingDrag(event.pointerId);
            return;
          }
          cancelGestureNavigation(event.pointerId);
        }}
        onLostPointerCapture={event => {
          if (floatingIgnoreLostCaptureRef.current) {
            floatingIgnoreLostCaptureRef.current = false;
            return;
          }
          if (floatingDragStateRef.current?.pointerId === event.pointerId) {
            cancelFloatingDrag(event.pointerId);
            return;
          }
          cancelGestureNavigation(event.pointerId);
        }}
      >
        <PortRelayFloatingButton
          ready={portRelayReady}
          frameUrl={portRelayFrameUrl}
          frameOpen={portRelayWorkbenchOpen}
          mobileFrameOpen={mobilePortRelayFrameOpen}
          targetMenuOpen={portRelayTargetMenuOpen}
          targetMenuRef={portRelayTargetMenuRef}
          targets={portRelayTargetMenuTargets}
          activeTarget={activePortRelayTarget}
          switchingTarget={portRelayMenuSwitchingTarget}
          onTargetSelect={handlePortRelayFloatingTargetSelect}
          onPointerDown={handlePortRelayFloatingPointerDown}
          onPointerMove={handlePortRelayFloatingPointerMove}
          onPointerUp={finishPortRelayFloatingPress}
          onPointerCancel={finishPortRelayFloatingPress}
          onToggle={handlePortRelayFloatingToggle}
        />
        {mobilePortRelayFrameOpen ? null : (
          <div
            className="gesture-nav-control"
            data-expanded={gestureNavigationExpanded ? 'true' : 'false'}
            aria-label="Gesture navigation"
          >
            <div
              className="gesture-nav-pill"
              onPointerDown={handleGestureNavigationPillPointerDown}
            >
              {gestureNavigationExpanded ? (
                <button
                  key="preview"
                  type="button"
                  className="gesture-nav-button gesture-nav-capsule"
                  data-active={chatPreviewOpen}
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => { cancelGestureNavigation(); toggleChatPreviewFromTitle(); }}
                  title={chatPreviewOpen ? 'Hide preview' : 'Show preview'}
                  aria-label={chatPreviewOpen ? 'Hide preview' : 'Show preview'}
                  aria-pressed={chatPreviewOpen}
                >
                  <span className="codicon codicon-layout-sidebar-right" aria-hidden="true" />
                </button>
              ) : null}
              <button
                key="chat"
                type="button"
                className="gesture-nav-button gesture-nav-current-button"
                data-active="true"
                onPointerDown={handleGestureNavigationButtonPointerDown}
                onClick={handleGestureNavigationCurrentSelect}
                title={gestureNavigationExpanded ? 'Close drawer' : 'Chat'}
                aria-label={gestureNavigationExpanded ? 'Close drawer' : 'Chat'}
              >
                <span className="codicon codicon-comment-discussion" aria-hidden="true" />
                {hasCompletedUnreadChatSessionIndicator ? (
                  <span className="floating-nav-unread-dot" aria-hidden="true" />
                ) : null}
              </button>
              {gestureNavigationExpanded ? (
                <button
                  key="settings"
                  type="button"
                  className="gesture-nav-button gesture-nav-capsule"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={() => { cancelGestureNavigation(); openSettingsRoot(); }}
                  title="Settings"
                  aria-label="Settings"
                >
                  <span className="codicon codicon-settings-gear" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  ) : null;

  const mobileSettingsTitle = settingsDetailView
    ? settingsDetailView === 'skillDetail' && skillDetailTarget
      ? skillDetailTarget.skillName
      : settingsDetailTitle(settingsDetailView)
    : 'Settings';
  const mobileSettingsActions = settingsDetailView
    ? renderSettingsDetailActions(settingsDetailView)
    : <span className="mobile-settings-action-spacer" aria-hidden="true" />;
  const mobileSettingsShortcutActiveIndex = mobileSettingsShortcutIndex(settingsDetailView);
  const mobileSettingsRootShortcutActive = mobileSettingsShortcutActiveIndex === 0;
  const settingsShortcutBar = sidebarSettingsOpen ? (
    <MobileSettingsShortcutBar
      activeDetail={settingsDetailView}
      activeIndex={mobileSettingsShortcutActiveIndex}
      rootActive={mobileSettingsRootShortcutActive}
      onRootSelect={handleMobileSettingsRootShortcut}
      onDetailSelect={openMobileSettingsShortcutDetail}
    />
  ) : null;

  const desktopSkillDetailPanel = isWide && sidebarSettingsOpen && settingsDetailView === 'skills' && skillDetailTarget ? (
    renderSkillDetailPanel()
  ) : null;

  const desktopSettingsScreen = isWide && sidebarSettingsOpen ? (
    <SettingsScreen
      className="desktop-settings-screen"
      title={mobileSettingsTitle}
      actions={mobileSettingsActions}
      backAriaLabel={settingsDetailView ? 'Back to settings' : 'Close settings'}
      shortcutBar={settingsShortcutBar}
      onBack={handleMobileSettingsBackButton}
      onBackdropClick={handleMobileSettingsBackButton}
      sidePanel={desktopSkillDetailPanel}
    >
      {renderSettingsContent(false, { hideDetailHeader: true })}
    </SettingsScreen>
  ) : null;

  const mobileSettingsScreen = !isWide && sidebarSettingsOpen ? (
    <MobileSettingsScreen
      title={mobileSettingsTitle}
      actions={mobileSettingsActions}
      backAriaLabel={settingsDetailView ? 'Back to settings' : 'Back to drawer'}
      shortcutBar={settingsShortcutBar}
      onBack={handleMobileSettingsBackButton}
    >
      {renderSettingsContent(false, { hideDetailHeader: true })}
    </MobileSettingsScreen>
  ) : null;
  const portRelayClearSiteDataFrame = portRelayClearSiteDataUrl ? (
    <iframe
      title="Port Relay site data cleanup"
      src={portRelayClearSiteDataUrl}
      className="port-relay-clear-site-data-frame"
      aria-hidden="true"
    />
  ) : null;
  const renderPortRelayWorkbenchSurface = (mode: 'desktop' | 'mobile') =>
    activePortRelayPreview ? (
      <PortRelayFrameSurface
        key={`workbench:${activePortRelayPreview.id}:${activePortRelayPreview.reloadKey}:${portRelayFrameUrl}`}
        mode={mode}
        url={portRelayFrameUrl || activePortRelayPreview.url}
        chrome={false}
        onCloseChrome={closePortRelayFrameFromChrome}
        onOpenInBrowser={openPortRelayPreviewInBrowser}
      />
  ) : null;
  const previewWorkbenchActiveTab = activeWorkbenchTab;
  const previewFileTreeDepthIndent = 8;
  const scrollLocatedPreviewFileIntoView = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const selected = document.querySelector('.preview-workbench-tree-panel .preview-workbench-file-tree-content .item.selected');
        if (selected instanceof HTMLElement) {
          selected.scrollIntoView({block: 'center'});
        }
      });
    });
  };
  const locateActivePreviewFileInTree = () => {
    const targetPath = chatFilePeek?.path ?? '';
    const targetProjectId = previewWorkbench.activeProjectId;
    if (!targetPath || !targetProjectId) {
      return;
    }
    const ancestors = previewFileAncestorDirs(targetPath);
    setPreviewWorkbench(current => ({...current, treeOpen: true}));
    updatePreviewFileTreeSearchQuery('');
    setChatFilePreviewExpandedDirsByProject(current => {
      const next = [...(current[targetProjectId] ?? ['.'])];
      ancestors.forEach(path => {
        if (!next.includes(path)) {
          next.push(path);
        }
      });
      return {...current, [targetProjectId]: next};
    });
    const projectEntries = chatFilePreviewDirEntriesByProject[targetProjectId] ?? {};
    const missingAncestors = ancestors.filter(path => !projectEntries[path]);
    Promise.all(missingAncestors.map(path => loadPreviewDirectory(targetProjectId, path)))
      .catch(err => {
        const reason = err instanceof Error ? err.message : String(err);
        setError(`Failed to locate file "${targetPath}": ${reason}`);
      })
      .finally(scrollLocatedPreviewFileIntoView);
  };
  const togglePreviewFileTreeSearchDirectory = (path: string) => {
    setPreviewFileTreeSearchCollapsedDirs(current =>
      current.includes(path)
        ? current.filter(item => item !== path)
        : [...current, path],
    );
  };
  const renderPreviewFileTreeSearchResults = (
    nodes: FileSearchResultTreeNode[],
    depth = 0,
  ): React.ReactNode =>
    nodes.map(node => {
      const paddingLeft = 10 + depth * previewFileTreeDepthIndent;
      if (node.kind === 'dir') {
        const collapsed = previewFileTreeSearchCollapsedDirs.includes(node.path);
        return (
          <div key={`preview-file-search-dir:${node.path}`}>
            <button
              type="button"
              className="preview-workbench-file-search-node dir"
              style={{paddingLeft}}
              onClick={() => togglePreviewFileTreeSearchDirectory(node.path)}
              title={node.path}
              aria-expanded={!collapsed}
            >
              <span className={`caret codicon ${collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`} />
              <span className={`node-icon codicon ${collapsed ? 'codicon-folder' : 'codicon-folder-opened'}`} />
              <span className="label">{node.name}</span>
            </button>
            {collapsed ? null : renderPreviewFileTreeSearchResults(node.children, depth + 1)}
          </div>
        );
      }

      const fileIcon = resolveFileIcon(node.name);
      const resultIndex = previewFileTreeSearchVisibleResults.findIndex(item => item.path === node.path);
      const selected = node.path === previewFileTreeSearchActivePath;
      return (
        <button
          key={`preview-file-search-file:${node.path}`}
          type="button"
          className={`preview-workbench-file-search-node file${selected ? ' selected' : ''}`}
          style={{paddingLeft}}
          onMouseEnter={() => {
            if (resultIndex >= 0) {
              setPreviewFileTreeSearchActiveIndex(resultIndex);
            }
          }}
          onClick={() => openPreviewFileTreeSearchResult(node.result)}
          title={node.path}
        >
          <span className="caret placeholder" aria-hidden="true" />
          <span
            className="node-icon seti-icon"
            style={{color: fileIcon.color}}
          >
            <span className="seti-glyph">{fileIcon.glyph}</span>
          </span>
          <span className="label">{node.name}</span>
        </button>
      );
    });
  const chatFilePreviewTreeContent = (
    <div className="preview-workbench-file-tree-content">
      {previewFileTreeSearchQuery ? (
        previewFileTreeSearchLoading ? (
          <div className="preview-workbench-file-search-empty">Loading...</div>
        ) : previewFileTreeSearchError ? (
          <div className="preview-workbench-file-search-empty">{previewFileTreeSearchError}</div>
        ) : !previewFileTreeSearchIndexed ? (
          <div className="preview-workbench-file-search-empty">File index is not ready.</div>
        ) : previewFileTreeSearchTree.length === 0 ? (
          <div className="preview-workbench-file-search-empty">No files found</div>
        ) : (
          <div className="preview-workbench-file-search-tree" role="tree" aria-label="Search results">
            {renderPreviewFileTreeSearchResults(previewFileTreeSearchTree)}
          </div>
        )
      ) : (
        <FileExplorerTree
          isWide={false}
          showSectionTitle={false}
          projects={projects}
          projectId={previewWorkbench.activeProjectId}
          currentProjectName={
            projects.find(item => item.projectId === previewWorkbench.activeProjectId)?.name ??
            currentProjectName
          }
          sortedProjectItems={chatFilePreviewProjects}
          workspaceProjectMenuOpen={false}
          setWorkspaceProjectMenuOpen={setWorkspaceProjectMenuOpen}
          syncWorkspaceProject={syncWorkspaceProject}
          dirEntries={chatFilePreviewDirEntries}
          loadingDirs={chatFilePreviewLoadingDirs}
          selectedFile={chatFilePeek?.path ?? ''}
          setSelectedFile={setSelectedFile}
          setDrawerOpen={() => undefined}
          isExpanded={isPreviewDirectoryExpanded}
          toggleDirectory={path => {
            togglePreviewDirectory(path).catch(() => undefined);
          }}
          resolveFileIcon={resolveFileIcon}
          depthIndent={previewFileTreeDepthIndent}
          rootState={chatFilePreviewRootState}
          rootError={chatFilePreviewDirErrors['.']}
          onRetryRoot={retryPreviewRootDirectory}
          onFileSelect={path => {
            openChatFilePeek(path, null, previewWorkbench.activeProjectId);
          }}
        />
      )}
    </div>
  );
  const toggleChatFilePreviewTree = () => {
    setPreviewWorkbench(current => ({...current, treeOpen: !current.treeOpen}));
  };
  const selectWorkbenchTab = (tabId: string) => {
    setPreviewWorkbench(current => {
      const projectId = current.activeProjectId;
      return selectPreviewTab(current, projectId, tabId);
    });
  };
  const closeWorkbenchTab = (tabId: string) => {
    const projectId = previewWorkbench.activeProjectId;
    const loadKey = fileMemoryCacheKey(projectId, tabId);
    previewFileLoadControllersRef.current.get(loadKey)?.abort();
    previewFileLoadControllersRef.current.delete(loadKey);
    const closingLastTab = previewWorkbenchTabs.length === 1 &&
      previewWorkbenchTabs[0]?.id === tabId;
    setPreviewWorkbench(current =>
      closePreviewTab(current, projectId, tabId),
    );
    if (closingLastTab) {
      setChatPreviewManualOpen(true);
      setChatPreviewManualCollapsed(false);
    }
  };
  const activatePreviewSearchMatch = (index: number) => {
    if (previewSearchMatches.length === 0) {
      return;
    }
    const nextIndex =
      (index + previewSearchMatches.length) % previewSearchMatches.length;
    setPreviewSearchActiveIndex(nextIndex);
    scrollToPreviewSearchMatch(previewSearchMatches[nextIndex]);
  };
  const navigatePreviewSearchMatch = (delta: 1 | -1) => {
    activatePreviewSearchMatch(previewSearchActiveIndex + delta);
  };
  const openPreviewSearch = () => {
    setPreviewSearchOpen(true);
    setPreviewSearchActiveIndex(0);
    setPreviewSelectionMenu(null);
    window.requestAnimationFrame(() => {
      previewSearchInputRef.current?.focus();
      previewSearchInputRef.current?.select();
    });
  };
  const closePreviewSearch = () => {
    previewSearchJumpCancelRef.current?.();
    previewSearchJumpCancelRef.current = null;
    setPreviewSearchOpen(false);
    setPreviewSearchQuery('');
    setPreviewSearchActiveIndex(0);
  };
  const handlePreviewSearchInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePreviewSearch();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      navigatePreviewSearchMatch(event.shiftKey ? -1 : 1);
    }
  };
  const handlePreviewFileTreeKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!previewWorkbench.treeOpen || event.defaultPrevented) {
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.isContentEditable ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.key === 'Tab' ||
      event.key === 'Escape' ||
      event.key === 'Enter' ||
      isArrowNavigationKey(event.key)
    ) {
      return;
    }
    if (event.key.length !== 1 && event.key !== 'Backspace') {
      return;
    }
    event.preventDefault();
    startPreviewFileTreeSearchFromKey(event.key);
  };
  const handlePreviewWorkbenchKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Tab' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      const nextTabId = cyclePreviewTabId(previewWorkbenchTabs, activeWorkbenchTab?.id ?? '', event.shiftKey ? -1 : 1);
      if (nextTabId) {
        selectWorkbenchTab(nextTabId);
      }
      return;
    }
    if (event.key.toLowerCase() === 'f' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      openPreviewSearch();
      return;
    }
    if (event.key.toLowerCase() === 'p' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      openQuickFileSearch();
      return;
    }
    handlePreviewFileTreeKeyDown(event);
  };
  const handleQuickFileKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeQuickFileSearch();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setQuickFileActiveIndex(current =>
        quickFileResults.length === 0 ? 0 : (current + 1) % quickFileResults.length,
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setQuickFileActiveIndex(current =>
        quickFileResults.length === 0
          ? 0
          : (current - 1 + quickFileResults.length) % quickFileResults.length,
      );
      return;
    }
    if (event.key === 'Enter') {
      const result = quickFileResults[quickFileActiveIndex];
      if (result) {
        event.preventDefault();
        openQuickFileResult(result);
      }
    }
  };
  const capturePreviewSelectionContext = (event: React.PointerEvent<HTMLDivElement>) => {
    previewContextSelectionRef.current = null;
    if (event.button !== 2) {
      return;
    }
    if (!activeWorkbenchTab || (activeWorkbenchTab.type !== 'file' && activeWorkbenchTab.type !== 'prompt-diff')) {
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target?.closest('.code-wrap')) {
      return;
    }
    const selection = window.getSelection();
    const text = selection?.toString() ?? '';
    if (!selection || !text.trim() || selection.rangeCount === 0) {
      return;
    }
    const anchorNode = selection.anchorNode ?? null;
    const focusNode = selection.focusNode ?? null;
    const container = chatFilePeekScrollRef.current;
    if (
      !container ||
      (anchorNode && !container.contains(anchorNode)) ||
      (focusNode && !container.contains(focusNode))
    ) {
      return;
    }
    previewContextSelectionRef.current = {
      x: Math.min(event.clientX, Math.max(8, window.innerWidth - 132)),
      y: Math.min(event.clientY, Math.max(8, window.innerHeight - 48)),
      text,
      range: selection.getRangeAt(0).cloneRange(),
    };
  };
  const handlePreviewSelectionContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!activeWorkbenchTab || (activeWorkbenchTab.type !== 'file' && activeWorkbenchTab.type !== 'prompt-diff')) {
      return;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target?.closest('.code-wrap')) {
      return;
    }
    const preservedSelection = previewContextSelectionRef.current;
    const selection = window.getSelection();
    const text = selection?.toString() || preservedSelection?.text || '';
    if (!text.trim()) {
      return;
    }
    const anchorNode = selection?.anchorNode ?? null;
    const focusNode = selection?.focusNode ?? null;
    const container = chatFilePeekScrollRef.current;
    if (
      !container ||
      (anchorNode && !container.contains(anchorNode)) ||
      (focusNode && !container.contains(focusNode))
    ) {
      return;
    }
    event.preventDefault();
    if (preservedSelection?.range) {
      selection?.removeAllRanges();
      selection?.addRange(preservedSelection.range);
    }
    setPreviewSelectionMenu({
      x: preservedSelection?.x ?? Math.min(event.clientX, Math.max(8, window.innerWidth - 132)),
      y: preservedSelection?.y ?? Math.min(event.clientY, Math.max(8, window.innerHeight - 48)),
      text,
    });
    previewContextSelectionRef.current = null;
  };
  const copyPreviewSelection = () => {
    if (!previewSelectionMenu) {
      return;
    }
    navigator.clipboard.writeText(previewSelectionMenu.text).catch(() => undefined);
    setPreviewSelectionMenu(null);
  };
  const copyChatFilePreviewPath = () => {
    if (!chatFilePeek) return;
    const previewProject = projects.find(item => item.projectId === previewWorkbench.activeProjectId);
    const projectRoot = (previewProject?.path ?? currentProject?.path ?? '').replace(/[\\/]+$/, '');
    const relativePath = chatFilePeek.path.replace(/^\.?[\\/]+/, '');
    const absolutePath = projectRoot && relativePath ? `${projectRoot}/${relativePath}`.replace(/\\/g, '/') : chatFilePeek.path;
    navigator.clipboard.writeText(absolutePath).catch(() => undefined);
  };
  const refreshActivePortRelayPreview = () => {
    const tab = activePortRelayPreview;
    if (!tab) return;
    setPreviewWorkbench(current =>
      updatePreviewTab(current, tab.projectId, tab.id, item =>
        item.type === 'port-relay'
          ? {...item, reloadKey: item.reloadKey + 1}
          : item,
      ),
    );
  };
  const renderPreviewWorkbenchActions = () => {
    const tab = activeWorkbenchTab;
    if (!tab) {
      return null;
    }
    const closeActionsMenu = () => setPreviewWorkbenchActionsMenuOpen(false);
    const indexPending = projectIndexScanPendingByProjectId[tab.projectId] === true;
    const indexError = projectIndexErrorByProjectId[tab.projectId] || '';
    return (
      <>
        {tab.type === 'file' ? (
          <>
            <button
              type="button"
              role="menuitem"
              className="preview-workbench-action-menu-item"
              onClick={() => {
                copyChatFilePreviewPath();
                closeActionsMenu();
              }}
            >
              <span className="codicon codicon-clippy" aria-hidden="true" />
              <span>Copy absolute path</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="preview-workbench-action-menu-item"
              onClick={() => {
                openPeekFileInFullFileTab();
                closeActionsMenu();
              }}
            >
              <span className="codicon codicon-go-to-file" aria-hidden="true" />
              <span>Open in File tab</span>
            </button>
          </>
        ) : null}
        {tab.type === 'port-relay' ? (
          <button
            type="button"
            role="menuitem"
            className="preview-workbench-action-menu-item"
            onClick={() => {
              openPortRelayPreviewInBrowser();
              closeActionsMenu();
            }}
          >
            <span className="codicon codicon-link-external" aria-hidden="true" />
            <span>Open relay page in browser</span>
          </button>
        ) : null}
        <div className="preview-workbench-action-menu-separator" role="separator" />
        <button
          type="button"
          role="menuitem"
          className="preview-workbench-action-menu-item"
          onClick={() => handlePreviewProjectIndexRebuild(tab.projectId).catch(() => undefined)}
          disabled={indexPending}
        >
          <span className={`codicon ${indexPending ? 'codicon-sync' : 'codicon-refresh'}`} aria-hidden="true" />
          <span>{projectIndexScanPendingByProjectId[tab.projectId] ? 'Indexing...' : 'Rebuild file index'}</span>
        </button>
        {indexError ? <div className="preview-workbench-action-menu-error" role="alert">{indexError}</div> : null}
      </>
    );
  };
  const renderPreviewWorkbenchTabBody = (tab: PreviewWorkbenchTab, mode: 'desktop' | 'mobile', active: boolean) => {
    if (tab.type === 'file') {
      return (
        <ChatFilePeekViewer
          peek={tab}
          mode={mode}
          tabs={EMPTY_PREVIEW_WORKBENCH_TABS}
          treeOpen={previewWorkbench.treeOpen}
          themeMode={themeMode}
          codeTheme={codeTheme}
          codeFont={codeFont}
          codeFontSize={codeFontSize}
          codeLineHeight={codeLineHeight}
          codeTabSize={codeTabSize}
          wrapLines={wrapLines}
          showLineNumbers={showLineNumbers}
          highlightedLines={active ? chatPeekSelectedLines : EMPTY_HIGHLIGHTED_LINES}
          onLineClick={active ? handlePeekLineClick : undefined}
          onClose={closeChatFilePeekFromChrome}
          onCopyPath={copyChatFilePreviewPath}
          onOpenInFileTab={openPeekFileInFullFileTab}
          onTabSelect={() => undefined}
          onTabClose={() => undefined}
          onToggleTree={toggleChatFilePreviewTree}
          treeContent={null}
          scrollRef={chatFilePeekScrollRef}
        />
      );
    }
    if (tab.type === 'prompt-diff') {
      return (
        <ChatPromptArtifactPreviewViewer
          preview={tab}
          mode={mode}
          themeMode={themeMode}
          codeTheme={codeTheme}
          codeFont={codeFont}
          codeFontFamily={codeFontFamily}
          codeFontSize={codeFontSize}
          codeLineHeight={codeLineHeight}
          codeTabSize={codeTabSize}
          onClose={closeChatFilePeekFromChrome}
          onToggleFile={togglePromptArtifactPreviewFile}
          scrollRef={chatFilePeekScrollRef}
        />
      );
    }
    if (tab.type === 'attachment') {
      return (
        <ChatAttachmentPreviewViewer
          preview={tab}
          mode={mode}
          onClose={closeChatFilePeekFromChrome}
          scrollRef={chatFilePeekScrollRef}
          themeMode={themeMode}
          codeTheme={codeTheme}
          codeFont={codeFont}
          codeFontSize={codeFontSize}
          codeLineHeight={codeLineHeight}
          codeTabSize={codeTabSize}
          wrapLines={wrapLines}
          showLineNumbers={showLineNumbers}
          highlightedLines={active ? chatPeekSelectedLines : EMPTY_HIGHLIGHTED_LINES}
          onLineClick={active ? handlePeekLineClick : undefined}
        />
      );
    }
    return renderPortRelayWorkbenchSurface(mode);
  };
  const renderPreviewWorkbenchBody = (mode: 'desktop' | 'mobile') => {
    const activeTab = activeWorkbenchTab;
    if (!activeTab) {
      return (
        <div className="chat-file-workbench-empty">
          <span className="codicon codicon-layout-sidebar-right" aria-hidden="true" />
          <span>No preview selected</span>
          <button
            type="button"
            className="chat-file-workbench-empty-action"
            onClick={toggleChatFilePreviewTree}
          >
            <span className="codicon codicon-files" aria-hidden="true" />
            <span>Open files</span>
          </button>
        </div>
      );
    }
    const renderedTabs = previewWorkbenchRenderedTabs.filter(tab =>
      tab.type !== 'port-relay' || tab.id === activeTab.id,
    );
    return (
      <div className="preview-workbench-render-cache">
        {renderedTabs.map(tab => {
          const active = tab.id === activeTab.id;
          return (
            <div
              key={`${tab.projectId}:${tab.id}`}
              className={`preview-workbench-rendered-tab${active ? ' active' : ''}`}
              hidden={!active}
              aria-hidden={active ? undefined : true}
            >
              {renderPreviewWorkbenchTabBody(tab, mode, active)}
            </div>
          );
        })}
      </div>
    );
  };
  const previewSearchStatus = previewSearchUnavailableMessage
    ? previewSearchUnavailableMessage
    : previewSearchQuery
      ? previewSearchMatches.length > 0
        ? `${previewSearchActiveIndex + 1}/${previewSearchMatches.length}`
        : 'No results'
      : 'Search current preview';
  const previewSearchBar = previewSearchOpen ? (
    <div className="preview-workbench-search-bar">
      <span className="codicon codicon-search" aria-hidden="true" />
      <input
        ref={previewSearchInputRef}
        className="preview-workbench-search-input"
        value={previewSearchQuery}
        onChange={event => setPreviewSearchQuery(event.target.value)}
        onKeyDown={handlePreviewSearchInputKeyDown}
        placeholder="Search"
        aria-label="Search current preview"
      />
      <span className="preview-workbench-search-status">{previewSearchStatus}</span>
      <button
        type="button"
        className="chat-preview-icon-button"
        onClick={() => navigatePreviewSearchMatch(-1)}
        disabled={previewSearchMatches.length === 0}
        title="Previous match"
        aria-label="Previous match"
      >
        <span className="codicon codicon-chevron-up" />
      </button>
      <button
        type="button"
        className="chat-preview-icon-button"
        onClick={() => navigatePreviewSearchMatch(1)}
        disabled={previewSearchMatches.length === 0}
        title="Next match"
        aria-label="Next match"
      >
        <span className="codicon codicon-chevron-down" />
      </button>
      <button
        type="button"
        className="chat-preview-icon-button"
        onClick={closePreviewSearch}
        title="Close search"
        aria-label="Close search"
      >
        <span className="codicon codicon-close" />
      </button>
    </div>
  ) : null;
  const previewFileTreeSearch = (
    <>
      <span className="codicon codicon-search preview-workbench-tree-search-icon" aria-hidden="true" />
      <input
        ref={previewFileTreeSearchInputRef}
        className="preview-workbench-tree-search-input"
        value={previewFileTreeSearchQuery}
        onChange={event => updatePreviewFileTreeSearchQuery(event.target.value)}
        onKeyDown={handlePreviewFileTreeSearchInputKeyDown}
        placeholder="Search files"
        aria-label="Search files"
      />
      <button
        type="button"
        className="preview-workbench-tree-tool-button"
        onClick={locateActivePreviewFileInTree}
        disabled={!chatFilePeek?.path}
        title={chatFilePeek?.path ? 'Locate current file' : 'No current file to locate'}
        aria-label="Locate current file"
      >
        <span className="codicon codicon-location" aria-hidden="true" />
      </button>
    </>
  );
  const previewWorkbenchFileTreeContent = !activeWorkbenchTab || activeWorkbenchTab.type === 'file' ? chatFilePreviewTreeContent : null;
  const renderPreviewWorkbenchSurface = (mode: 'desktop' | 'mobile') => (
    <PreviewWorkbenchChrome
      mode={mode}
      activeTab={previewWorkbenchActiveTab}
      tabs={previewWorkbenchTabs}
      fileTreeOpen={previewWorkbench.treeOpen}
      fileTree={previewWorkbenchFileTreeContent}
      fileTreeSearch={previewFileTreeSearch}
      actions={renderPreviewWorkbenchActions()}
      actionsMenuOpen={previewWorkbenchActionsMenuOpen}
      onClose={closeChatFilePeekFromChrome}
      onTabSelect={selectWorkbenchTab}
      onTabClose={closeWorkbenchTab}
      onFileTreeToggle={toggleChatFilePreviewTree}
      onFileTreeClose={() => setPreviewWorkbench(current => ({...current, treeOpen: false}))}
      onActionsMenuToggle={() => setPreviewWorkbenchActionsMenuOpen(open => !open)}
      onActionsMenuClose={() => setPreviewWorkbenchActionsMenuOpen(false)}
      onWorkbenchKeyDown={handlePreviewWorkbenchKeyDown}
      onMobilePortRelayRefresh={refreshActivePortRelayPreview}
    >
      {previewSearchBar}
      <div
        ref={chatFilePeekScrollRef}
        className="chat-file-peek-scroll"
        onPointerDownCapture={capturePreviewSelectionContext}
        onContextMenu={handlePreviewSelectionContextMenu}
      >
        {renderPreviewWorkbenchBody(mode)}
      </div>
    </PreviewWorkbenchChrome>
  );
  const chatPreviewDesktopPane = isWide && chatPreviewOpen ? (
    <aside
      className="chat-preview-pane"
      style={{ '--chat-file-peek-width': `${effectiveChatFilePeekWidth}px` } as React.CSSProperties}
    >
      <button
        type="button"
        className={`chat-file-peek-resize-handle${chatFilePeekResizing ? ' resizing' : ''}`}
        aria-label="Resize preview"
        title="Resize preview"
        onPointerDown={beginChatFilePeekResize}
        onPointerMove={moveChatFilePeekResize}
        onPointerUp={finishChatFilePeekResize}
        onPointerCancel={finishChatFilePeekResize}
        onLostPointerCapture={commitChatFilePeekResize}
      />
      {renderPreviewWorkbenchSurface('desktop')}
    </aside>
  ) : null;
  const chatPreviewMobileOverlay = !isWide && chatPreviewOpen ? (
    <div
      className="chat-preview-mobile-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Chat preview"
    >
      {renderPreviewWorkbenchSurface('mobile')}
    </div>
  ) : null;
  const terminalMobileOverlay = !isWide && terminalOpen ? (
    <div className="terminal-mobile-overlay" role="dialog" aria-modal="true" aria-label="Terminal">
      <TerminalWorkbench mode="mobile"
        terminals={terminalItems}
        activeKey={activeTerminalKey}
        unavailableHubIds={terminalSync.unavailableHubIds}
        onSelect={handleSelectTerminal}
        onCreate={() => { handleCreateTerminal().catch(err => setError(err instanceof Error ? err.message : String(err))); }}
        onRequestClose={handleRequestCloseTerminal}
        onRestart={item => { handleRestartTerminal(item).catch(err => setError(err instanceof Error ? err.message : String(err))); }}
        onClaimResize={handleClaimTerminalResize}
        onSendBytes={handleTerminalInput}
        onCloseSurface={() => setTerminalOpen(false)}
      >
        {activeTerminal ? (
          <TerminalView
            key={`mobile:${activeTerminalKey}`}
            ref={terminalViewRef}
            active
            resizeEnabled={terminalResizeTokensRef.current.has(activeTerminalKey)}
            cols={activeTerminal.cols}
            rows={activeTerminal.rows}
            shell={activeTerminal.shell}
            initialCwd={activeTerminal.initialCwd}
            onInput={handleTerminalInput}
            onResize={handleTerminalResize}
            onAutoResize={handleAutoClaimTerminalResize}
          />
        ) : null}
      </TerminalWorkbench>
    </div>
  ) : null;
  const quickFileProjectName =
    projects.find(project => project.projectId === quickFileProjectId)?.name ||
    quickFileProjectId ||
    'Project';
  const quickFileSearchOverlay = quickFileOpen ? (
    <div
      className="quick-file-search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Quick file search"
      onPointerDown={closeQuickFileSearch}
    >
      <div className="quick-file-search-panel" onPointerDown={event => event.stopPropagation()}>
        <div className="quick-file-search-header">
          <span className="codicon codicon-go-to-file" aria-hidden="true" />
          <span className="quick-file-search-project" title={quickFileProjectName}>
            {quickFileProjectName}
          </span>
        </div>
        <input
          ref={quickFileInputRef}
          className="quick-file-search-input"
          value={quickFileQuery}
          onChange={event => {
            const query = event.target.value;
            if (!quickFileProjectId) {
              setQuickFileQuery(query);
              setQuickFileError('Select a project first.');
              return;
            }
            scheduleQuickFileSearch(quickFileProjectId, query);
          }}
          onKeyDown={handleQuickFileKeyDown}
          placeholder="Open file"
          aria-label="Open file"
        />
        <div className="quick-file-search-results" role="listbox" aria-label="Files">
          {quickFileLoading ? (
            <div className="quick-file-search-empty">Loading...</div>
          ) : quickFileError ? (
            <div className="quick-file-search-empty">{quickFileError}</div>
          ) : !quickFileIndexed ? (
            <div className="quick-file-search-empty">File index is not ready.</div>
          ) : quickFileResults.length === 0 ? (
            <div className="quick-file-search-empty">{quickFileQuery ? 'No files found' : 'No indexed files'}</div>
          ) : (
            quickFileResults.map((result, index) => {
              const selected = index === quickFileActiveIndex;
              const name = result.name || chatFileMentionName(result.path);
              return (
                <button
                  key={`quick-file:${result.path}`}
                  type="button"
                  className={`quick-file-search-option${selected ? ' selected' : ''}`}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setQuickFileActiveIndex(index)}
                  onClick={() => openQuickFileResult(result)}
                  title={result.path}
                >
                  <span className="codicon codicon-file-code" aria-hidden="true" />
                  <span className="quick-file-search-name">{name}</span>
                  <span className="quick-file-search-path">{result.path}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  ) : null;
  const previewSelectionContextMenu = previewSelectionMenu ? (
    <div
      ref={previewSelectionMenuRef}
      className="preview-selection-context-menu"
      style={{left: previewSelectionMenu.x, top: previewSelectionMenu.y}}
      role="menu"
    >
      <button type="button" role="menuitem" onClick={copyPreviewSelection}>
        <span className="codicon codicon-copy" aria-hidden="true" />
        <span>Copy</span>
      </button>
    </div>
  ) : null;

  const archiveTarget = confirmTarget?.kind === 'archive' ? confirmTarget : null;
  const archiveBatchTarget = confirmTarget?.kind === 'archiveBatch' ? confirmTarget : null;
  const restoreArchivedTarget = confirmTarget?.kind === 'restoreArchived' ? confirmTarget : null;
  const deleteTarget = confirmTarget?.kind === 'delete' ? confirmTarget : null;
  const npmPackageTarget = confirmTarget?.kind === 'npmPackage' ? confirmTarget : null;
  const npmPackageHubUpdateTarget = confirmTarget?.kind === 'npmPackageHubUpdate' ? confirmTarget : null;
  const wheelMakerUpdateTarget = confirmTarget?.kind === 'wheelMakerUpdate' ? confirmTarget : null;
  const wheelMakerUpdateAllTarget = confirmTarget?.kind === 'wheelMakerUpdateAll' ? confirmTarget : null;
  const skillInstallConfirmTarget = confirmTarget?.kind === 'skillInstall' ? confirmTarget : null;
  const skillUninstallConfirmTarget = confirmTarget?.kind === 'skillUninstall' ? confirmTarget : null;
  const skillBatchUninstallConfirmTarget = confirmTarget?.kind === 'skillBatchUninstall' ? confirmTarget : null;
  const skillUpdateConfirmTarget = confirmTarget?.kind === 'skillUpdate' ? confirmTarget : null;
  const skillConfirmTarget = skillInstallConfirmTarget ?? skillUninstallConfirmTarget ?? skillBatchUninstallConfirmTarget ?? skillUpdateConfirmTarget;
  const npmPackageConfirmPendingKey = npmPackageTarget
    ? agentPackageActionKey(npmPackageTarget.hubId, npmPackageTarget.packageName)
    : '';
  const skillConfirmPendingKey = skillConfirmTarget
    ? skillActionPendingKey({
        hubId: skillConfirmTarget.hubId,
        scope: skillConfirmTarget.scope,
        projectName: skillConfirmTarget.projectName,
        skillName: skillUninstallConfirmTarget?.skillName,
        action: skillConfirmTarget.kind,
      })
    : '';
  const confirmBusy = archiveTarget
    ? chatArchivingSessionId === archiveTarget.sessionId
    : archiveBatchTarget
      ? !!archiveBatchProgress && archiveBatchProgress.completed < archiveBatchProgress.total
      : restoreArchivedTarget
        ? archivedRestoringSessionId === buildChatRuntimeKey(restoreArchivedTarget.projectId, restoreArchivedTarget.sessionId)
        : deleteTarget
          ? chatDeletingSessionId === deleteTarget.sessionId
          : npmPackageTarget
            ? agentPackageActionPendingKey === npmPackageConfirmPendingKey
            : npmPackageHubUpdateTarget
              ? agentPackageHubUpdatePendingId === npmPackageHubUpdateTarget.hubId
              : wheelMakerUpdateTarget
                ? wheelMakerUpdatePendingHubId === wheelMakerUpdateTarget.hubId
                : wheelMakerUpdateAllTarget
                  ? wheelMakerUpdateAllPending
                  : skillConfirmTarget
                    ? skillsPendingKey === skillConfirmPendingKey
                    : false;
  const handleConfirmPrimary = () => {
    if (!confirmTarget) {
      return;
    }
    if (confirmTarget.kind === 'terminalClose') {
      const key = `${confirmTarget.hubId}:${confirmTarget.terminalId}`;
      const terminal = terminalSyncRef.current.terminals[key];
      if (!terminal) {
        setConfirmTarget(null);
        return;
      }
      handleCloseTerminal(terminal)
        .then(() => { setConfirmTarget(null); setConfirmError(''); })
        .catch(err => setConfirmError(err instanceof Error ? err.message : String(err)));
      return;
    }
    if (confirmTarget.kind === 'clearCache') {
      clearLocalCache();
      return;
    }
    if (confirmTarget.kind === 'delete') {
      handleDeleteProjectSession(
        confirmTarget.projectId,
        confirmTarget.sessionId,
      ).catch(() => undefined);
      return;
    }
    if (confirmTarget.kind === 'archiveBatch') {
      handleArchiveBatch(confirmTarget.days, confirmTarget.candidates).catch(() => undefined);
      return;
    }
    if (confirmTarget.kind === 'restoreArchived') {
      handleRestoreArchivedSession(
        confirmTarget.projectId,
        confirmTarget.sessionId,
      ).catch(() => undefined);
      return;
    }
    if (confirmTarget.kind === 'npmPackage') {
      handleAgentPackageConfirmedAction(confirmTarget).catch(() => undefined);
      return;
    }
    if (confirmTarget.kind === 'npmPackageHubUpdate') {
      handleAgentPackageHubUpdateConfirmedAction(confirmTarget).catch(() => undefined);
      return;
    }
    if (confirmTarget.kind === 'wheelMakerUpdate') {
      handleWheelMakerUpdateConfirmedAction(confirmTarget).catch(() => undefined);
      return;
    }
    if (confirmTarget.kind === 'wheelMakerUpdateAll') {
      handleWheelMakerUpdateAllConfirmedAction(confirmTarget).catch(() => undefined);
      return;
    }
    if (
      confirmTarget.kind === 'skillInstall' ||
      confirmTarget.kind === 'skillUninstall' ||
      confirmTarget.kind === 'skillBatchUninstall' ||
      confirmTarget.kind === 'skillUpdate'
    ) {
      handleSkillConfirmedAction(confirmTarget).catch(() => undefined);
      return;
    }
    if (confirmTarget.kind === 'archive') {
      handleArchiveProjectSession(
        confirmTarget.projectId,
        confirmTarget.sessionId,
      ).catch(() => undefined);
    }
  };
  const renameBusy = !!renameTarget && chatRenamingSessionId === renameTarget.sessionId;
  const submitRenameTarget = () => {
    if (!renameTarget || renameBusy) {
      return;
    }
    handleRenameProjectSession(
      renameTarget.projectId,
      renameTarget.sessionId,
      renameTitleDraft,
    ).catch(() => undefined);
  };
  const appConfirmDialog = (
    <AppConfirmDialog
      target={confirmTarget}
      busy={confirmBusy}
      error={confirmError}
      onCancel={() => {
        setConfirmError('');
        setConfirmTarget(null);
      }}
      onPrimary={handleConfirmPrimary}
    />
  );
  const appRenameDialog = (
    <AppRenameDialog
      target={renameTarget}
      titleDraft={renameTitleDraft}
      error={renameError}
      busy={renameBusy}
      onTitleDraftChange={setRenameTitleDraft}
      onCancel={() => {
        setRenameError('');
        setRenameTarget(null);
        setRenameTitleDraft('');
      }}
      onSubmit={submitRenameTarget}
    />
  );
  const appSessionStatusDialog = (
    <AppSessionStatusDialog
      sessionId={sessionStatusDialog?.sessionId ?? ''}
      cachedUsage={sessionStatusDialog?.cachedUsage}
      status={sessionStatusDialog?.status ?? null}
      loading={sessionStatusDialog?.loading === true}
      error={sessionStatusDialog?.error ?? ''}
      onClose={() => setSessionStatusDialog(null)}
      onRefresh={() => {
        if (sessionStatusDialog) {
          refreshSessionStatusDialog(sessionStatusDialog.projectId, sessionStatusDialog.sessionId)
            .catch(() => undefined);
        }
      }}
    />
  );
  const registryDebugPanel = isWide && messageViewerEnabled ? (
    <React.Suspense fallback={null}>
      <RegistryDebugPanel
        records={registryDebugRecords}
        selectedRecordId={selectedRegistryDebugRecordId}
        onSelectedRecordIdChange={setSelectedRegistryDebugRecordId}
        selectedScope={selectedRegistryDebugScope}
        onSelectedScopeChange={setSelectedRegistryDebugScope}
        selectedSessionId={selectedRegistryDebugSessionId}
        onSelectedSessionIdChange={setSelectedRegistryDebugSessionId}
        sessionLabels={registryDebugSessionLabels}
        includeMultiSessionRecords={registryDebugIncludeMultiSessionRecords}
        onIncludeMultiSessionRecordsChange={setRegistryDebugIncludeMultiSessionRecords}
        onClear={() => registryDebugStore.clear()}
        onClose={() => setMessageViewerEnabled(false)}
      />
    </React.Suspense>
  ) : null;
  const desktopWindowControlsVisible = isWide && Boolean(getDesktopWindowBridge());
  const desktopWindowControls = desktopWindowControlsVisible ? (
    <DesktopWindowControls />
  ) : null;

  return (
    <>
      <ResponsiveShell
        mode={layoutMode}
        themeMode={themeMode}
        setiFontCss={setiFontCss}
        desktopWindowControls={desktopWindowControls}
        desktopWindowControlsVisible={desktopWindowControlsVisible}
        desktopSettingsScreen={desktopSettingsScreen}
        desktopPeek={chatPreviewDesktopPane}
        desktopChatFixedPreview={desktopChatFixedPreview}
        desktopChatPreviewOpen={isWide && chatPreviewOpen}
        desktopSidebarWidth={effectiveDesktopSidebarWidth}
        floatingControlStack={floatingControlStack}
        floatingControlSide={floatingControlSide}
        mobileSettingsScreen={mobileSettingsScreen}
        mobileOverlay={terminalMobileOverlay ?? chatPreviewMobileOverlay}
        sidebar={renderSidebar()}
        main={renderMain()}
        sidebarCollapsed={sidebarCollapsed}
        drawerOpen={mobilePortRelayFrameOpen ? false : drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
      {quickFileSearchOverlay}
      {previewSelectionContextMenu}
      {chatQuickSwitchMenuPlacement.kind === 'desktop' ? chatQuickSwitchMenu : null}
      {chatTitleProjectMenu}
      {chatTitlePromptMenu}
      {portRelayClearSiteDataFrame}
      {registryDebugPanel}
      {markdownImageExportRequest ? (
        <MarkdownImageExportSurface
          key={markdownImageExportRequest.id}
          request={markdownImageExportRequest}
          exportMode={isWide ? 'desktop' : 'mobile'}
          markdownComponents={chatMarkdownComponents}
          markdownUrlTransform={chatMarkdownUrlTransform}
          onComplete={completeMarkdownImageExport}
          onRenderError={failMarkdownImageExport}
          onShareError={failMarkdownImageShare}
        />
      ) : null}
      {toastMessage ? (
        <div className="app-toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      ) : null}
      {appRenameDialog}
      {appConfirmDialog}
      {appSessionStatusDialog}
    </>
  );
}

if (!nativeShellHost && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    let reloading = false;
    // Reload when a new service worker takes control (after skipWaiting).
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register('/service-worker.js')
      .then(registration => {
        // Periodic update check (every 5 minutes).
        const checkUpdate = () => {
          registration.update().catch(() => undefined);
        };
        window.setTimeout(checkUpdate, 1500);
        window.setInterval(checkUpdate, 5 * 60 * 1000);

        if (registration.waiting) {
          registration.waiting.postMessage('SKIP_WAITING');
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (
              installing.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              registration.waiting?.postMessage('SKIP_WAITING');
            }
          });
        });
      })
      .catch(() => undefined);
  });
}

installDesktopZoomGuard(window);
installPageRefreshGuard(window);
installMobileViewportZoomGuard(document);

export const workspaceAppReady = workspaceStore.ready();
