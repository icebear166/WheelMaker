import React, {useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import ReactMarkdown, { type Components } from 'react-markdown';
import {resolveSessionsShortcutAction} from './workspaceShortcuts';
import {
  normalizeFlickerBridgeStatus,
} from './flickerBridgeState';
import {
  ChatHubMenu,
  toggleChatHubDetailSections,
  type ChatHubDetailId,
  type ChatHubNpmPackageView,
  type ChatHubOpsView,
} from './ChatHubMenu';
import type {ChatHubSkillSurface} from './ChatHubSkillCompanion';

declare global {
  interface Window {
    WheelMakerAndroidBack?: {
      handleBack: () => boolean;
    };
  }
}

type UsageHistoryDialogTarget = {
  provider: UsageProviderView;
  account: UsageViewAccount;
  triggerElement: HTMLElement;
};

type UsageHistoryDialogView = {
  target: UsageHistoryDialogTarget;
  state: UsageHistoryDialogState;
};

type DeepSeekUsageDialogTarget = {
  provider: UsageProviderView;
  account: UsageViewAccount;
  triggerElement: HTMLElement;
};

type DeepSeekUsageDialogView = {
  target: DeepSeekUsageDialogTarget;
  month: {year: number; month: number};
  state: DeepSeekUsageDialogState;
};

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
  portRelayTargetKey,
  removePortRelayTarget,
  reconcilePortRelayTargetSelection,
  samePortRelayTarget,
  samePortRelayTargets,
  upsertPortRelayTarget,
  type PortRelayTarget,
} from '../portRelay/portRelayTargets';
import { PortRelayFrameSurface } from '../portRelay/PortRelayFrameSurface';
import { writeTextToClipboard } from '../platform/clipboard';
import { initializePWAFoundation } from '../platform/pwa';
import {cleanupNativeWebViewPWA} from '../platform/pwa/nativePwaGuard';
import {startReconnectWatchdog} from '../platform/pwa/connection';
import { DesktopDragRegion, DesktopWindowControls } from '../shell/layouts/desktop/DesktopTitleBar';
import {
  WheelMakerAppMenu,
  type ClientUpdateController,
} from '../shell/WheelMakerAppMenu';
import {LocalDevModePanel} from '../shell/layouts/desktop/LocalDevModePanel';
import {
  canCopyDesktopFile,
  canInvokeDesktopFileAction,
  copyDesktopFile,
  getDesktopWindowBridge,
  invokeDesktopFileAction,
  type DesktopProjectFileAction,
} from '../platform/desktop/desktopRuntime';
import {checkDesktopUpdate} from '../platform/desktop/desktopUpdate';
import {getNativeRuntimeBridge, isNativeShellHost, isNativeWebViewHost} from '../platform/native/nativeRuntime';
import {
  AppConfirmDialog,
  AppGoalEditDialog,
  AppHtmlExportNameDialog,
  AppRenameDialog,
  AppSessionStatusDialog,
  type ConfirmTarget,
  type RenameSessionTarget,
} from '../shell/AppDialogs';
import {AppLaunchScreen, resolveAppLaunchView} from '../shell/AppLaunchScreen';
import { installDesktopZoomGuard } from '../shell/desktopZoomGuard';
import { installPageRefreshGuard } from '../shell/pageRefreshGuard';
import { ResponsiveShell } from '../shell/ResponsiveShell';
import {applyDocumentTheme} from '../theme/documentTheme';
import {
  getLatestSessionReadCursor,
  isFinishedChatMessage,
  needsPromptTurnRefresh,
  shouldMaterializeRealtimeSessionMessages,
} from '../chat/turns/chatSync';
import {
  hasMessageLifecycleFeature,
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
  buildQueuePromptMessage,
  fullQueueSnapshot,
  makeSessionQueueItemID,
  mergeChatSessionQueueProjection,
  queueDisplayItems,
  queueTranscriptItemIDs,
  type ChatSessionQueuesByKey,
} from '../chat/session/chatSessionQueue';
import {
  buildChatSessionActionOptions,
  chatSlashOptionDisplayName,
  filterChatSessionActionOptions,
  groupChatSlashMenuOptions,
  replaceActiveSlashQuery,
  removeActiveSlashQuery,
  resolveChatSkillProjectId,
  resolveStandaloneSessionAction,
  type ChatSessionActionKind,
  type ChatSessionSlashOption,
} from '../chat/session/chatSessionActions';
import {
  buildRecentChatSessionProjectSections,
  hasCompletedUnreadChatSession,
  type RecentChatSessionProjectSection,
} from '../chat/mobileChatQuickSwitch';
import { ChatSessionNav } from '../chat/ChatSessionNav';
import { ChatSurface } from '../chat/ChatSurface';
import {ChatQueueCompactView, ChatTurnView, type ChatQueueActions} from '../chat/ChatTurnView';
import type {ChatShareAction} from '../chat/share/ChatShareMenu';
import {ChatPermissionDialog} from '../chat/permission/ChatPermissionDialog';
import {
  deriveChatPermissionState,
  permissionRequestView,
} from '../chat/permission/chatPermissionState';
import {useChatPermissionDialogHeight} from '../chat/permission/useChatPermissionDialogHeight';
import {
  ChatPermissionReadGate,
  type ChatPermissionReadToken,
} from '../chat/permission/chatPermissionReadGate';
import {ChatToolCallGroup} from '../chat/ChatToolCallGroup';
import {ChatWorkGroup} from '../chat/ChatWorkGroup';
import {ChatPlanSurface} from '../chat/ChatPlanSurface';
import {ChatGoalSurface} from '../chat/ChatGoalSurface';
import {ChatRecentSessionsSurface} from '../chat/ChatRecentSessionsSurface';
import {ChatFileLinkContextMenu, type ChatFileLinkMenuAction} from '../chat/ChatFileLinkContextMenu';
import {ChatSessionGlobalBar} from '../chat/ChatSessionGlobalBar';
import {ChatSessionPanel} from '../chat/ChatSessionPanel';
import {AgentChoiceMenu} from '../chat/AgentChoiceMenu';
import {SessionIcon, type SessionIconName} from '../chat/sessionlist/SessionIcon';
import {SessionSearchProjectPicker} from '../chat/session/SessionSearchProjectPicker';
import {MENU_EXIT_MS, useMenuExitFlag, useMenuExitState} from '../chat/sessionlist/menuExit';
import {focusFirstMenuItem, handleMenuKeyDown} from '../common/menuKeyboardNavigation';
import {ChatStopStatusPill} from '../chat/composer/ChatStopStatusPill';
import {useChatComposerMenu} from '../chat/composer/useChatComposerMenu';
import {ChatIcon} from '../chat/ChatIcon';
import {AgentTag} from '../chat/AgentTag';
import {Icon} from '../common/Icon';
import {contextMenuSurfaceProps, useContextMenuTargetGesture} from '../common/useContextMenuGesture';
import {ContextMenu, ContextMenuItems} from '../common/ContextMenu';
import {RetryToast} from '../common/RetryToast';
import {createSkillRetryNotice, type SkillRetryNotice} from './skillRetryNotice';
import {ChatMenuKeyHints} from '../chat/composer/ChatMenuKeyHints';
import {SessionMenu} from '../chat/sessionlist/SessionMenu';
import {SessionListView} from '../chat/sessionlist/SessionListView';
import {agentTagVariantClass} from '../chat/agentTagVariant';
import {
  createSessionNavSlideOutAutoClose,
  createSessionNavSlideOutState,
  isSessionNavSlideOutCloseSuppressed,
  sessionNavSlideOutReducer,
  syncSessionNavSlideOutAutoClose,
} from '../chat/session/sessionNavSlideOutState';
import {extractLatestChatPlan} from '../chat/chatPlan';
import { resolveChatSessionTitle } from '../chat/session/chatSessionTitle';
import { agentDisplayLabel, buildProjectAgentChoices } from '../chat/projectAgents';
import { chatConfigValueLabel, formatChatContextUsage, splitChatComposerStatusOptions } from '../chat/session/chatComposerStatus';
import {
  decodeSessionTurnToMessage,
  normalizeSessionMessagePayload,
  upsertDecodedSessionTurn,
} from '../chat/chatWire';
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
import {
  buildChatDisplayIndex,
  chatDisplayItemContainsTurn,
  combineAssistantGroupMessages,
  resolveActiveToolGroupKey,
  type ChatDisplayIndexItem,
} from '../chat/turns/chatDisplayIndex';
import {
  createChatRealtimeFlushScheduler,
  type ChatRealtimeFlushScheduler,
} from '../chat/turns/chatRealtimeFlush';
import {
  buildSessionSearchFilter,
  mergeSessionSearchResultsByProject,
  resolveSessionSearchPollDelay,
  resolveSessionSearchProjects,
  type SessionSearchResultsByProjectId,
} from '../chat/session/sessionSearchState';
import {chatSearchMessageKey} from '../chat/search/chatSearchState';
import {useChatSearchController} from '../chat/search/useChatSearchController';
import {
  applyChatSearchActiveMatch,
  applyChatSearchCodeHighlights,
  clearChatSearchGeneratedMarks,
} from '../chat/search/chatSearchDomHighlighter';
import {
  resolveSessionSearchExpansion,
  resolveWorkspaceSearchTarget,
} from '../chat/search/searchRouting';
import {
  mergeChatSession,
  mergeChatSessionList,
  sortProjectChatSessions,
} from '../chat/session/chatSessionOrdering';
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
  DESKTOP_SESSION_LIST_DENSITY,
  MOBILE_SESSION_LIST_DENSITY,
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
} from '../chat/export/chatMarkdownImageExport';
import {
  outputResponseImage,
  reserveResponseImageShare,
} from '../chat/export/responseImageOutput';
import {
  MarkdownHtmlExportSurface,
  type MarkdownHtmlExportSurfaceRequest,
  type MarkdownHtmlImageResolver,
  type MarkdownHtmlImageResolution,
} from '../chat/export/MarkdownHtmlExportDocument';
import {
  ChatShareCaptureSurface,
  type ChatShareCaptureRequest,
  type ChatShareCaptureResult,
} from '../chat/share/ChatShareCaptureSurface';
import {
  buildResponseChatShareSnapshot,
  buildSessionChatShareSnapshot,
  type ChatShareSnapshot,
} from '../chat/share/chatShareSnapshot';
import {
  isShareManagerProjectSource,
  ShareManager,
  type ShareManagerChatSource,
  type ShareManagerSource,
} from '../shares/ShareManager';
import {
  createChatShareSnapshot,
  createHtmlShareSnapshot,
  createMarkdownShareSnapshot,
  shareKindForExternalPath,
  shareKindForPath,
  type ShareSnapshot,
} from '../shares/shareSnapshot';
import {
  buildMarkdownHtmlFileNameFromStem,
  buildMarkdownHtmlFileName,
  buildPromptMarkdownHtmlFileStem,
  resolveExternalMarkdownImagePath,
  resolveProjectMarkdownImagePath,
  validateMarkdownHtmlFileStem,
} from '../chat/export/markdownHtmlExport';
import {
  outputMarkdownHtml,
  reserveMarkdownHtmlShare,
} from '../chat/export/markdownHtmlOutput';
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
import {
  buildPromptTurnStatusIndex,
  findPromptStartForDone,
  type ChatPromptStatus,
} from '../chat/turns/chatPromptStatus';
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
  checkAndroidApkUpdate,
  createAndroidApkUpdateBridge,
  subscribeAndroidApkUpdateEvents,
  type AndroidApkLatestRelease,
} from '../platform/android/androidApkUpdate';
import {
  createStandalonePageHistoryState,
  isStandalonePageHistoryState,
} from '../shell/mobileStandalonePageHistory';
import {
  chatIndexProjectRefreshTargets,
  reconnectSessionRuntimeKeys,
  runChatIndexProjectRefreshes,
  shouldUpdateCurrentProjectSessions,
} from '../chat/session/chatIndexState';
import {
  resolveChatListSelection,
  resolveSelectedChatVisibilityRecovery,
  selectedChatReadRetryDelay,
  shouldApplyLoadedChatSelection,
  shouldApplyPreservedChatLoad,
  shouldApplySentChatSelection,
} from '../chat/chatSelectionGuard';
import { RegistryWorkspaceService } from '../registry/RegistryWorkspaceService';
import type {RegistrySessionReadOptions} from '../registry/RegistryRepository';
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
  findNextVisibleProject,
  resolveHubColor,
  resolveHubColorVariantIndex,
  splitProjectsByVisibility,
  toggleProjectVisibility,
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
import {MobileFloatingNav} from '../shell/layouts/mobile/MobileFloatingNav';
import {
  FLOATING_NAV_BUTTON_SIZE_PX,
  FLOATING_NAV_EXPANDED_OVERFLOW_PX,
  resolveFloatingNavCurrent,
  resolveFloatingNavReservedBottomInset,
  resolveFloatingNavRelayState,
  shouldOpenDrawerWithFloatingNav,
  type FloatingNavDestination,
} from '../shell/layouts/mobile/mobileFloatingNavModel';
import {
  createMobileSettingsHistoryState,
  isMobileSettingsHistoryState,
  mobileSettingsHistoryKey,
  resolveMobileSettingsHistoryWriteAction,
  resolveMobileSettingsPopAction,
  type MobileSettingsHistoryDetail,
} from '../shell/layouts/mobile/mobileSettingsHistory';
import {
  settingsPageKind,
  type SettingsDetail,
} from '../settings/settingsNavigation';
import {
  MobileSettingsScreen,
  SettingsDesktopSplit,
  SettingsDetailShell,
  SettingsScreen,
  SettingsSurface,
  settingsDetailTitle,
} from '../settings/SettingsSurface';
import {
  formatShortcutTooltip,
  resolveEffectiveShortcutBindings,
  resolveShortcutPlatform,
  resolveWorkspaceShortcutDispatch,
  type ShortcutActionId,
  type ShortcutOverrides,
} from '../shortcuts/keyboardShortcuts';
import { installMobileViewportZoomGuard } from '../shell/layouts/mobile/mobileViewportZoomGuard';
import { resolveLayoutMode } from '../shell/state/responsiveLayout';
import {MobileUsageDialog} from '../usage/MobileUsageDialog';
import {MonitorSurface} from '../usage/MonitorSurface';
import {GitHistoryPanel} from '../git/GitHistoryPanel';
import {GitStatusSurface} from '../git/GitStatusSurface';
import {GitBrowserStore} from '../git/gitBrowserStore';
import {UsageHistoryDialog, type UsageHistoryDialogState} from '../usage/UsageHistoryDialog';
import {loadUsageHistoryFromSources} from '../usage/usageHistory';
import {DeepSeekUsageDialog, type DeepSeekUsageDialogState} from '../usage/DeepSeekUsageDialog';
import {normalizeDeepSeekUsage} from '../usage/deepSeekUsage';
import {UsageStore} from '../usage/usageStore';
import {HubRefreshTriggers} from '../hubState/hubRefreshTriggers';
import {
  selectComposerDiagnostic,
  selectComposerSkills,
  type RegistrySkillsStateSnapshot,
} from '../hubState/hubSelectors';
import type {HubStoreSnapshot} from '../hubState/hubStore';
import type {UsageProviderView, UsageViewAccount, UsageViewSnapshot} from '../usage/usageTypes';
import {
  MODEL_EFFICIENCY_REFRESH_INTERVAL_MS,
  ModelEfficiencyStore,
} from '../modelEfficiency/modelEfficiencyStore';
import type {ModelEfficiencySnapshot} from '../modelEfficiency/modelEfficiencyTypes';
import {
  agentPackageWriteOperationRunning,
  deriveNpmPackageUpdateTargets,
  deriveNpmUpdatableTargets,
  deriveGatewayHubStatus,
  deriveOperationalHubIds,
  deriveRegistryHubIds,
  deriveWheelMakerHubStatus,
  fetchWheelMakerPublicMetadata,
  npmPackageUpdateSummary,
  packageStatusLabel,
  resolveWheelMakerRestartPending,
  shouldShowWheelMakerUpdateAction,
  shouldShowGatewayUpdateAction,
  WHEELMAKER_RESTART_RECONNECT_TIMEOUT_MS,
  wheelMakerUpdateErrorLabel,
  wheelMakerUpdateJobActive,
  gatewayUpdateJobActive,
  wheelMakerUpdateStatusLabel,
  wheelMakerVersionCopy,
  type NpmPackageUpdateTarget,
  type WheelMakerPublicMetadata,
} from '../settings/agentPackageUpdateView';
import {
  parseSkillSourceInput,
  sameSkillScopeTarget,
  skillActionPendingKey,
  skillDetailCacheKey,
  type SkillDetailTarget,
  type SkillInstallTarget,
  type SkillScopeTarget,
  type SkillSourceSkillTarget,
  type SkillSourceTarget,
  type SkillUninstallTarget,
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
import {ShikiCodeBlock, preloadShikiRenderer} from '../code/ShikiCodeBlock';
import {detectCodeLanguage} from '../code/codeLanguage';
import {
  MarkdownPreview,
  markdownCodeRenderer,
  markdownPreRenderer,
  useMarkdownCapabilityPlugins,
} from '../code/markdownPreview';
import {HtmlPreview} from '../preview/HtmlPreview';
import {UnifiedDiffPreview} from '../preview/UnifiedDiffPreview';
import {
  isHtmlPreviewAttachment,
  isHtmlPreviewPath,
  type HtmlPreviewSource,
} from '../preview/htmlPreviewSource';
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
  notifyAndroidLaunchReady,
} from '../platform/android/androidNativeMessageBridge';
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
import { FileExplorerTree } from '../file/FileExplorerTree';
import {splitFileMatchHighlight} from '../file/fileMatchHighlight';
import {
  fileDownloadFailureMessage,
  fileDownloadSourceForLink,
  sessionAttachmentDownloadSource,
  startManagedFileDownload,
} from '../file/fileDownload';
import {
  buildContextMenuModel,
  type FileMenuFileTarget,
  type FileMenuPlatform,
} from '../file/fileMenuModel';
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
  resolvePreviewDesktopFilePath,
  resolvePromptDiffActiveFilePath,
  selectPreviewProject,
  selectPreviewTab,
  updatePreviewTab,
  updatePreviewTabAfterLoad,
  type AttachmentPreviewTab,
  type FilePreviewTab,
  type GitDiffFileMeta,
  type GitDiffSource,
  type PreviewWorkbenchDrawerMode,
  type PreviewWorkbenchTab,
  type PreviewSearchMatch,
  type PromptDiffPreviewFile,
  type PromptDiffPreviewTab,
} from '../preview/previewWorkbenchState';
import {PreviewWorkbenchChrome} from '../preview/PreviewWorkbenchChrome';
import {PreviewTabContextMenu} from '../preview/PreviewTabContextMenu';
import {
  fetchPreviewDirectoryEntries,
  togglePreviewDirectoryExpansion,
} from '../preview/previewDirectoryLoader';
import {
  jumpToPreviewLineNow,
  schedulePreviewLineJump,
} from '../preview/previewLineNavigation';
import {
  isAbsolutePreviewFilePath,
  resolvePreviewFileLink,
  type PreviewFileLink,
} from '../preview/previewFileLink';
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
  RegistrySessionMarkColor,
  RegistrySessionGoal,
  RegistrySessionGoalPatch,
  RegistrySessionSummary,
  RegistrySessionStatusResult,
  RegistrySessionUsage,
  RegistrySessionTurn,
  RegistryFsEntry,
  RegistryNpmHubSnapshot,
  RegistryNpmCommandResponse,
  RegistryNpmOperation,
  RegistryNpmPackage,
  RegistryHub,
  RegistryProject,
  RegistryPortRelaySnapshot,
  RegistrySkillCommandResponse,
  RegistrySkillDetail,
  RegistrySkillScope,
  RegistrySkillSourcePreview,
  RegistryWheelMakerUpdateResponse,
  RegistryGatewayUpdateResponse,
  RegistrySpeechTranscriptEvent,
  RegistryFileIndexSearchResult,
  RegistryFileIndexStatus,
  RegistryFileIndexStatusResponse,
  RegistryFlickerBridgeStatus,
  RegistryHubConfig,
  RegistryHubConfigUpdatePayload,
  RegistryTerminal,
  RegistryTerminalChangedEvent,
  RegistryTerminalOutputEvent,
  RegistryDeviceSession,
  RegistryGitCommitDiff,
  RegistryWorkingTreeFileDiff,
  RegistryFileDownloadSource,
} from '../registry/registryTypes';

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
const DatabaseSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.DatabaseSettingsDetail,
})));
const PortRelaySettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.PortRelaySettingsDetail,
})));
const ReleasePublishSettings = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.ReleasePublishSettings,
})));
const SettingsRootContent = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.SettingsRootContent,
})));
const KeyboardShortcutsSettingsDetail = React.lazy(() => loadSettingsBundle().then(module => ({
  default: module.KeyboardShortcutsSettingsDetail,
})));

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
  kind: 'new' | 'resume' | 'actions';
  phase: 'agents' | 'sessions' | 'actions';
  agentType: string;
  popover?: WideProjectActionPopoverPlacement | null;
};
type MobileProjectActionMenuState = WideProjectActionMenuState;
type ProjectSessionActionMenuState = {
  projectId: string;
  sessionId: string;
  popover?: WideProjectActionPopoverPlacement | null;
};
type SettingsDetailView = SettingsDetail | null;
type WheelMakerUpdateHubView = {
  hubId: string;
  loading: boolean;
  error: string;
  data: RegistryWheelMakerUpdateResponse | null;
};
type GatewayUpdateHubView = {
  hubId: string;
  loading: boolean;
  error: string;
  data: RegistryGatewayUpdateResponse | null;
};
type WheelMakerMaintenancePending = {
  hubId: string;
  action: 'update' | 'restart';
  previousInstanceId: string;
  startedAtMs: number;
};
type GatewayMaintenancePending = {
  hubId: string;
  startedAtMs: number;
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

function deriveHubOperationalViews(snapshot: HubStoreSnapshot): {
  wheelmaker: Record<string, WheelMakerUpdateHubView>;
  gateway: Record<string, GatewayUpdateHubView>;
  packages: Record<string, AgentPackageHubView>;
  indexes: Record<string, RegistryFileIndexStatusResponse>;
  skills: Record<string, SkillHubView>;
  flicker: Record<string, RegistryFlickerBridgeStatus>;
} {
  const wheelmaker: Record<string, WheelMakerUpdateHubView> = {};
  const gateway: Record<string, GatewayUpdateHubView> = {};
  const packages: Record<string, AgentPackageHubView> = {};
  const indexes: Record<string, RegistryFileIndexStatusResponse> = {};
  const skills: Record<string, SkillHubView> = {};
  const flicker: Record<string, RegistryFlickerBridgeStatus> = {};
  for (const [hubId, hub] of Object.entries(snapshot.hubs)) {
    const wheelSection = hub.sections.wheelmakerUpdate;
    if (wheelSection?.data) {
      wheelmaker[hubId] = {
        hubId,
        loading: wheelSection.updateStatus !== 'idle',
        error: wheelSection.lastError ?? '',
        data: wheelSection.data as RegistryWheelMakerUpdateResponse,
      };
    }
    const gatewaySection = hub.sections.gatewayUpdate;
    if (gatewaySection?.data) {
      gateway[hubId] = {
        hubId,
        loading: gatewaySection.updateStatus !== 'idle',
        error: gatewaySection.lastError ?? '',
        data: gatewaySection.data as RegistryGatewayUpdateResponse,
      };
    }
    const packageSection = hub.sections.agentPackages;
    if (packageSection?.data) {
      const data = packageSection.data as RegistryNpmCommandResponse;
      packages[hubId] = {
        hubId,
        loading: packageSection.updateStatus !== 'idle',
        error: packageSection.lastError ?? '',
        updatedAt: data.updatedAt ?? '',
        hub: data.hub ?? null,
        operation: data.operation ?? null,
      };
    }
    const indexSection = hub.sections.fileIndex;
    if (indexSection?.data) {
      indexes[hubId] = indexSection.data as RegistryFileIndexStatusResponse;
    }
    const skillSection = hub.sections.skills;
    if (skillSection?.data) {
      const data = skillSection.data as RegistrySkillsStateSnapshot;
      const toItems = (inventory: Record<string, {
        name: string;
        managed?: boolean;
        agents?: string[];
        locations?: Record<string, {path?: string; resolvedPath?: string; fingerprint?: string}>;
        sync?: {status?: 'aligned' | 'contentMismatch' | 'unknown'};
      }>) => Object.values(inventory).map(item => ({
        name: item.name,
        path: Object.values(item.locations ?? {})[0]?.path,
        category: item.managed ? 'Managed' : 'Local',
        categoryKey: item.managed ? 'managed' : 'local',
        managed: item.managed,
        agents: item.agents,
        locations: item.locations,
        sync: item.sync,
      }));
      skills[hubId] = {
        hubId,
        loading: skillSection.updateStatus !== 'idle',
        error: skillSection.lastError ?? '',
        data: {
          ok: true,
          hubId,
          hubSkills: {scope: 'hub', skills: toItems(data.hubInventory ?? {})},
          projects: Object.entries(data.projectLocalInventories ?? {}).map(([projectId, inventory]) => ({
            projectId,
            projectName: projectId.includes(':') ? projectId.slice(projectId.indexOf(':') + 1) : projectId,
            skills: toItems(inventory),
          })),
          hubSources: data.hubSources,
          projectSources: data.projectSources,
          operation: data.operation ?? null,
        },
      };
    }
    const flickerSection = hub.sections.flickerBridge;
    if (flickerSection?.data) {
      flicker[hubId] = normalizeFlickerBridgeStatus(flickerSection.data);
    }
  }
  return {wheelmaker, gateway, packages, indexes, skills, flicker};
}
type SkillDetailCacheEntry = {
  loading: boolean;
  error: string;
  detail: RegistrySkillDetail | null;
};
type SkillConfirmedTarget = Extract<
  ConfirmTarget,
  {kind: 'skillPreview' | 'skillUninstall'}
>;
type ChatComposerDraft = {
  text: string;
  tokens: ChatComposerToken[];
  attachments: ChatAttachment[];
};
type PendingChatPrompt = {
  itemId: string;
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
type GoalEditTarget = {
  projectId: string;
  sessionId: string;
  goal: RegistrySessionGoal;
};
type FloatingDragState = {
  pointerId: number;
  originY: number;
  startSide: PersistedFloatingControlSide;
  startTop: number;
  currentTop: number;
};
type GestureNavigationState =
  | {
      phase: 'pressing' | 'neutral';
      pointerId: number;
      originX: number;
      originY: number;
      currentX: number;
      currentY: number;
      startedAt: number;
    }
  | {phase: 'expanded'};
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
type ChatFileLinkMenuState = {
  x: number;
  y: number;
  projectId: string;
  projectRoot: string;
  targetKind: FileMenuFileTarget['kind'];
  link: PreviewFileLink | null;
  fileAvailable: boolean;
  downloadSource: RegistryFileDownloadSource | null;
  attachment: {
    block: RegistrySessionContentBlock;
    message: RegistryChatMessage;
  } | null;
};

type ManagedFileMenuTarget = Omit<ChatFileLinkMenuState, 'x' | 'y'>;

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
        <ChatIcon name="sparkles" className="thinking-icon" />
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
          <ChatIcon
            name={expanded ? 'chevronUp' : 'chevronDown'}
            className="thinking-chevron"
          />
        )}
      </button>
      <div
        className={`thinking-body${expanded ? ' expanded' : ''}`}
      >
        <div className="thinking-content">
          {content}
        </div>
      </div>
    </div>
  );
}

const pwaFoundation = initializePWAFoundation();
const isIOSPlatform = pwaFoundation.capabilities.platform === 'ios';
const nativeShellHost = isNativeShellHost();
if (nativeShellHost) {
  cleanupNativeWebViewPWA().catch(() => undefined);
}
const registryClientName = isAndroidNativeSpeechHost()
  ? 'wheelmaker-android'
  : getDesktopWindowBridge()
    ? 'wheelmaker-desktop'
    : 'wheelmaker-web';
if (getDesktopWindowBridge()) {
  // Marker class for the frameless exe host so CSS can scope window-chrome
  // affordances (edge ring) to the desktop shell.
  document.documentElement.classList.add('wm-desktop-host');
}
const service = new RegistryWorkspaceService({clientName: registryClientName});
const gitBrowserStore = new GitBrowserStore({
  getRev: projectId => service.getProjectGitRev(projectId),
  getRefs: projectId => service.listProjectGitBranches(projectId),
  getLog: (projectId, options) => service.listProjectGitCommits(projectId, options),
  getCommitFiles: (projectId, sha) => service.listProjectGitCommitFiles(projectId, sha),
  getStatus: projectId => service.getProjectGitStatus(projectId),
});
scrubLegacyBrowserCredentials();
const workspaceStore = new WorkspaceStore();
const workspaceController = new WorkspaceController(service, workspaceStore);

const wipeBrowserStorage = async (): Promise<void> => {
  try {
    window.localStorage.clear();
  } catch {
    // ignore storage access failures
  }
  try {
    window.sessionStorage.clear();
  } catch {
    // ignore storage access failures
  }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
  } catch {
    // ignore cache access failures
  }
  try {
    document.cookie.split(';').forEach(cookie => {
      const name = cookie.split('=')[0]?.trim();
      if (name) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
    });
  } catch {
    // ignore cookie access failures
  }
};
const MAX_AUTO_RENDER_DIFF_CHARS = 200000;
const RECONNECT_RETRY_DELAY_MS = 1000;
const CHAT_NEW_DRAFT_SESSION_KEY = '__new__';
const CHAT_DRAFT_KEY_PROJECT_FALLBACK = '__no_project__';
const RECENT_SESSIONS_VIRTUAL_PROJECT_ID = '__recent_sessions__';
const CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD = 80;
// Extra scroll space below the last turn while the floating permission dialog
// is open: its 10px float offset above the composer plus breathing room.
const CHAT_PERMISSION_DIALOG_SCROLL_GAP = 16;
const CHAT_KEYBOARD_INSET_SETTLE_DELAY_MS = 120;
const CHAT_PENDING_CONFIRM_TIMEOUT_MS = 5000;
const CHAT_ATTACHMENT_CHUNK_SIZE = 1024 * 1024;
const HUB_TREE_EMPTY_EXPANDED_SENTINEL = '__hub_tree_empty__';
const CHAT_HUB_INTERACTION_SURFACE_SELECTOR = [
  '.chat-hub-popover-stack',
  '.chat-hub-page',
  '[data-chat-hub-owned-overlay="true"]',
].join(', ');

function isChatHubInteractionSurface(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(CHAT_HUB_INTERACTION_SURFACE_SELECTOR));
}

function estimateSessionReadPayloadBytes(result: RegistrySessionReadResponse): number {
  try {
    return new TextEncoder().encode(JSON.stringify(result)).length;
  } catch {
    return 0;
  }
}

const fileMemoryCacheKey = (activeProjectId: string, path: string) => `${activeProjectId}\n${path}`;
const SIDEBAR_TRANSIENT_MENU_SELECTOR = [
  '.wide-project-action-popover',
  '.project-session-action-menu',
  '.mobile-project-sheet',
  '.session-archive-menu',
  CHAT_HUB_INTERACTION_SURFACE_SELECTOR,
  '.chat-title-project-menu',
  '.chat-title-prompt-menu',
  '.app-confirm-dialog',
].join(', ');
const GESTURE_NAV_PRESERVED_SURFACE_SELECTOR = [
  '.drawer',
  '.drawer-overlay',
  SIDEBAR_TRANSIENT_MENU_SELECTOR,
  '.app-menu-surface',
  '.topbar-menu-surface',
  '.sl-sheet-overlay',
].join(', ');
const DESKTOP_SIDEBAR_VIEWPORT_MAX_RATIO = 0.45;
const CHAT_SESSION_PANEL_WIDTH = 360;
const CHAT_FILE_PEEK_WIDTH_DEFAULT = 520;
const CHAT_FILE_PEEK_WIDTH_MIN = 360;
const CHAT_FILE_PEEK_WIDTH_MAX = 1520;
const CHAT_FILE_PEEK_VIEWPORT_MAX_RATIO = 0.8;
const CHAT_FILE_PEEK_MAIN_MIN_WIDTH = 420;
const CHAT_FILE_PEEK_HISTORY_KIND = 'wheelmaker:chat-file-peek';
const GESTURE_NAV_CANCELLED_CLICK_SUPPRESS_MS = 160;
const PORT_RELAY_FLOATING_Y_RATIO_STORAGE_KEY = 'wheelmaker:portRelayFloatingYRatio';
const PORT_RELAY_FLOATING_SLOT_STORAGE_KEY = 'wheelmaker:portRelayFloatingSlot';
const PORT_RELAY_FLOATING_SIDE_STORAGE_KEY = 'wheelmaker:portRelayFloatingSide';
const PORT_RELAY_CLEAR_SITE_DATA_MESSAGE = 'wheelmaker:portRelaySiteDataCleared';
const PORT_RELAY_CLEAR_SITE_DATA_TIMEOUT_MS = 1200;
const PROJECT_INDEX_SCAN_CONCURRENCY = 2;
const CHAT_FILE_MENTION_SEARCH_LIMIT = 20;
const CHAT_FILE_MENTION_DEBOUNCE_MS = 140;
const CHAT_FILE_MENTION_SKELETON_ROWS = [0, 1, 2, 3, 4] as const;
const EMPTY_CHAT_COMPOSER_DRAFT: ChatComposerDraft = { text: '', tokens: [], attachments: [] };
const EMPTY_CHAT_OPTION_REPLIES: ChatOptionReply[] = [];
const EMPTY_PREVIEW_WORKBENCH_TABS: FilePreviewTab[] = [];
const EMPTY_HIGHLIGHTED_LINES = new Set<number>();
const DEFAULT_PORT_RELAY_SNAPSHOT: RegistryPortRelaySnapshot = {ok: true, enabled: false, status: 'Disabled'};

function effectivePortRelayListenPort(snapshot: RegistryPortRelaySnapshot, clientPort: string): number {
  if (snapshot.listenPortManaged === true) {
    return typeof snapshot.listenPort === 'number' ? snapshot.listenPort : 0;
  }
  if (typeof snapshot.listenPort === 'number' && Number.isInteger(snapshot.listenPort) && snapshot.listenPort > 0) {
    return snapshot.listenPort;
  }
  const parsed = Number(clientPort);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

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

function renderQuickFileMatchText(text: string, query: string, keyPrefix: string): React.ReactNode {
  const segments = splitFileMatchHighlight(text, query);
  if (!segments.some(segment => segment.match)) {
    return text;
  }
  return segments.map((segment, index) => (
    <span
      key={`${keyPrefix}:${index}`}
      className={segment.match ? 'quick-file-search-match' : undefined}
    >
      {segment.text}
    </span>
  ));
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
    if (item.type === 'skill' || item.type === 'goal') {
      return other.type === item.type &&
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

function attachmentHTMLPreviewSource(tab: AttachmentPreviewTab): HtmlPreviewSource | null {
  if (!isHtmlPreviewAttachment(tab.title, tab.mimeType)) {
    return null;
  }
  const payload = attachmentPreviewReadPayloadFromKey(tab);
  if (!payload) {
    return null;
  }
  if (payload.attachmentId) {
    return {
      source: 'session-attachment',
      projectId: tab.projectId,
      sessionId: payload.sessionId,
      attachmentId: payload.attachmentId,
    };
  }
  if (payload.uri) {
    return {
      source: 'session-attachment',
      projectId: tab.projectId,
      sessionId: payload.sessionId,
      uri: payload.uri,
    };
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

function agentPackageActionLabel(action: 'install' | 'update' | 'uninstall' | 'reinstall'): string {
  switch (action) {
    case 'update':
      return 'Update';
    case 'uninstall':
      return 'Uninstall';
    case 'reinstall':
      return 'Reinstall';
    default:
      return 'Install';
  }
}

function skillCommandErrorMessage(result: RegistrySkillCommandResponse): string {
  return result.errorSummary || result.message || 'Skill operation failed.';
}

function shortDigest(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 7 ? trimmed.slice(0, 7) : trimmed || '-';
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

function clampFloatingTop(top: number, minTop: number, maxTop: number): number {
  return Math.min(maxTop, Math.max(minTop, top));
}

function applyFloatingDragFriction(top: number, minTop: number, maxTop: number): number {
  const OVERSHOOT_DAMPING = 0.35;
  if (top < minTop) {
    return minTop - (minTop - top) * OVERSHOOT_DAMPING;
  }
  if (top > maxTop) {
    return maxTop + (top - maxTop) * OVERSHOOT_DAMPING;
  }
  return top;
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

function normalizeAgentTypeName(value?: string | null): string {
  return (value || '').trim();
}

function tagVariantClass(prefix: string, value: string): string {
  const normalized = normalizeAgentTypeName(value).toLowerCase();
  if (prefix === 'wide-project-hub') {
    return `${prefix}-${resolveHubColorVariantIndex(normalized)}`;
  }
  if (prefix === 'wide-session-agent') {
    return agentTagVariantClass(value);
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
  return chatConfigValueLabel(option, currentOption ?? {
    value: currentValue || option.name || option.id,
  });
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

function shouldRenderChatTurn(
  message: RegistryChatMessage,
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
    return !!text;
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

function resolveFileMenuPlatform(desktopBridge: unknown): FileMenuPlatform {
  if (desktopBridge) return 'desktop';
  return isNativeWebViewHost() ? 'android' : 'browser';
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
  if (deltaMonth < 12) return `${deltaMonth}M`;
  const deltaYear = Math.floor(deltaMonth / 12);
  return `${Math.min(deltaYear, 99)}y`;
}

type MarkdownHtmlExportRequest = MarkdownHtmlExportSurfaceRequest & {
  fileName: string;
  userActionToken?: string;
};

type MarkdownShareCaptureRequest = MarkdownHtmlExportSurfaceRequest;

type MarkdownShareCapturePending = {
  source: ShareManagerSource;
  resolve: (snapshot: ShareSnapshot) => void;
  reject: (error: Error) => void;
};

type ChatShareCaptureTask = ChatShareCaptureRequest & {
  action: ChatShareAction;
  purpose: 'local' | 'public';
  fileName?: string;
  userActionToken?: string;
};

type ChatShareCapturePending = {
  source: ShareManagerChatSource;
  resolve: (snapshot: ShareSnapshot) => void;
  reject: (error: Error) => void;
};

type StartMarkdownHtmlExportInput = {
  content: string;
  title: string;
  fileName: string;
  projectId: string;
  sourcePath: string;
  external?: boolean;
  key: string;
};

type PromptMarkdownHtmlExportDraft = {
  snapshot: ChatShareSnapshot;
  action: ChatShareAction;
  fileNameStem: string;
};

function buildSessionChatShareFileStem(snapshot: ChatShareSnapshot): string {
  const title = snapshot.title
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 100) || 'wheelmaker-session';
  const parsed = new Date(snapshot.capturedAt);
  const timestamp = (Number.isNaN(parsed.getTime()) ? new Date() : parsed)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[:T]/g, '-')
    .replace(/Z$/, '');
  return `${title}-${timestamp}`;
}

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

function splitPathForDisplay(path: string): {fileName: string; parentPath: string} {
  const normalized = path.replaceAll('\\', '/');
  const separator = normalized.lastIndexOf('/');
  if (separator < 0) {
    return {fileName: normalized, parentPath: ''};
  }
  return {
    fileName: normalized.slice(separator + 1),
    parentPath: normalized.slice(0, separator),
  };
}

type HTMLPreviewConnectionProps = {
  htmlPreviewEndpoint: string;
  htmlPreviewCSRFToken: string;
};

type ChatFilePeekViewerProps = HTMLPreviewConnectionProps & {
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
  onTabSelect,
  onTabClose,
  onToggleTree,
  treeContent,
  scrollRef,
  htmlPreviewEndpoint,
  htmlPreviewCSRFToken,
}: ChatFilePeekViewerProps) {
  let body: React.ReactNode;
  if (!peek) {
    body = (
      <div className="chat-file-workbench-empty">
        <ChatIcon name="files" />
        <span>No file selected</span>
      </div>
    );
  } else if (peek.loading) {
    body = <div className="muted block">Loading file...</div>;
  } else if (peek.error) {
    body = (
      <div className="chat-file-peek-error" role="alert">
        <ChatIcon name="circleX" />
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
  } else if (isHtmlPreviewPath(peek.path)) {
    body = (
      <HtmlPreview
        endpoint={htmlPreviewEndpoint}
        csrfToken={htmlPreviewCSRFToken}
        source={{
          source: isAbsolutePreviewFilePath(peek.path) ? 'external-file' : 'project-file',
          projectId: peek.projectId,
          path: peek.path,
        }}
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
    p?.projectId === n?.projectId &&
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
    prev.highlightedLines === next.highlightedLines &&
    prev.htmlPreviewEndpoint === next.htmlPreviewEndpoint &&
    prev.htmlPreviewCSRFToken === next.htmlPreviewCSRFToken
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
          aria-label={mode === 'mobile' ? 'Back' : 'Close preview'}
        >
          <ChatIcon name={mode === 'mobile' ? 'arrowLeft' : 'x'} />
        </button>
        <div className="chat-preview-title">Preview</div>
      </div>
      <div className="chat-empty-preview-body">
        <ChatIcon name="appWindow" size={16} />
        <span className="chat-empty-preview-copy">No preview selected</span>
      </div>
    </div>
  );
});

type ChatAttachmentPreviewViewerProps = HTMLPreviewConnectionProps & {
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
  htmlPreviewEndpoint,
  htmlPreviewCSRFToken,
}: ChatAttachmentPreviewViewerProps) {
  const htmlSource = attachmentHTMLPreviewSource(preview);
  let body: React.ReactNode;
  if (preview.loading) {
    body = <div className="muted block">Loading attachment...</div>;
  } else if (preview.error) {
    body = (
      <div className="chat-file-peek-error" role="alert">
        <ChatIcon name="circleX" />
        <span>{preview.error}</span>
      </div>
    );
  } else if (htmlSource) {
    body = (
      <HtmlPreview
        endpoint={htmlPreviewEndpoint}
        csrfToken={htmlPreviewCSRFToken}
        source={htmlSource}
      />
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
        <ChatIcon name="circleX" />
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
        <ChatIcon name="file" />
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
  prev.highlightedLines === next.highlightedLines &&
  prev.htmlPreviewEndpoint === next.htmlPreviewEndpoint &&
  prev.htmlPreviewCSRFToken === next.htmlPreviewCSRFToken
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
  const activeFilePath = resolvePromptDiffActiveFilePath(preview.files, preview.activeFilePath);
  return (
    <UnifiedDiffPreview
      files={preview.files}
      activeFilePath={activeFilePath}
      loading={preview.loading}
      error={preview.error}
      overviewLabel={promptArtifactPreviewCountLabel(preview.files.length)}
      onToggleFile={onToggleFile}
      themeMode={themeMode}
      codeTheme={codeTheme}
      codeFont={codeFont}
      codeFontFamily={codeFontFamily}
      codeFontSize={codeFontSize}
      codeLineHeight={codeLineHeight}
      codeTabSize={codeTabSize}
    />
  );
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
  const permissionReadGateRef = useRef(new ChatPermissionReadGate());
  const [permissionReadRevision, setPermissionReadRevision] = useState(0);
  const [permissionSubmission, setPermissionSubmission] = useState({
    runtimeKey: '',
    permissionId: '',
    optionId: '',
    error: '',
  });
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
  useLayoutEffect(() => applyDocumentTheme(document.documentElement, themeMode), [themeMode]);
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
  const [mobileEnterKeyBehavior, setMobileEnterKeyBehavior] = useState<MobileEnterKeyBehavior>(
    normalizeMobileEnterKeyBehavior(persistedGlobal.mobileEnterKeyBehavior),
  );
  const [wrapLines, setWrapLines] = useState(!!persistedGlobal.wrapLines);
  const [showLineNumbers, setShowLineNumbers] = useState(
    typeof persistedGlobal.showLineNumbers === 'boolean'
      ? persistedGlobal.showLineNumbers
      : true,
  );
  const [showMonitor, setShowMonitor] = useState(
    typeof persistedGlobal.showMonitor === 'boolean'
      ? persistedGlobal.showMonitor
      : true,
  );
  const [logLevel, setLogLevel] = useState(
    normalizeAppDiagnosticLogLevel(persistedGlobal.logLevel),
  );
  const [promptCompletionNotificationsEnabled, setPromptCompletionNotificationsEnabled] = useState(
    typeof persistedGlobal.promptCompletionNotificationsEnabled === 'boolean'
      ? persistedGlobal.promptCompletionNotificationsEnabled
      : true,
  );
  const [keyboardShortcutOverrides, setKeyboardShortcutOverrides] = useState<ShortcutOverrides>(
    () => persistedGlobal.keyboardShortcutOverrides,
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
  // The Android host keeps its native splash up until the web app has painted
  // its first meaningful frame; double rAF approximates "after first paint".
  const launchReadyNotifiedRef = useRef(false);
  useEffect(() => {
    if (launchReadyNotifiedRef.current) return;
    launchReadyNotifiedRef.current = true;
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) notifyAndroidLaunchReady();
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [ttsState, setTtsState] = useState<TtsPlaybackState>('idle');
  const ttsActiveTurnIndexRef = useRef<number | null>(null);
  const codeFontFamily = useMemo(
    () => resolveCodeFontFamily(codeFont),
    [codeFont],
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
  const shortcutPlatform = useMemo(
    () => resolveShortcutPlatform({
      platform: window.navigator.platform,
      userAgent: window.navigator.userAgent,
    }),
    [],
  );
  const effectiveShortcutBindings = useMemo(
    () => resolveEffectiveShortcutBindings(keyboardShortcutOverrides),
    [keyboardShortcutOverrides],
  );
  const shortcutTooltip = useCallback((label: string, actionId: ShortcutActionId) => {
    return formatShortcutTooltip(label, effectiveShortcutBindings[actionId], shortcutPlatform);
  }, [effectiveShortcutBindings, shortcutPlatform]);

  const [workspaceUiState, dispatchWorkspaceUi] = useReducer(
    workspaceUiReducer,
    persistedGlobal,
    globalState =>
      createWorkspaceUiState({
        collapsedProjectIds: globalState.collapsedProjectIds ?? globalState.desktopCollapsedProjectIds ?? [],
        desktopSidebarWidth: globalState.desktopSidebarWidth,
        chatColumnWidth: globalState.chatColumnWidth,
        sessionPanelPinned: globalState.sessionPanelPinned,
        pinnedProjectIds: globalState.pinnedProjectIds ?? [],
        hiddenProjectIds: globalState.hiddenProjectIds ?? [],
        expandedHubIds: globalState.expandedHubIds ?? [],
        hubColors: globalState.hubColors ?? {},
        floatingControlYRatio: globalState.floatingControlYRatio ?? readPortRelayFloatingYRatio() ?? FLOATING_CONTROL_DEFAULT_Y_RATIO,
        floatingControlSide: globalState.floatingControlSide ?? readPortRelayFloatingSide() ?? 'right',
      }),
  );
  const [fileIconResources, setFileIconResources] = useState<FileIconResources | null>(null);

  // Composer popups share one state: at most one menu is open at a time, and
  // every close path plays the exit animation before unmounting. The legacy
  // boolean setters below are thin wrappers so call sites stay unchanged.
  // Each wrapper only closes its OWN menu: resolving `false` against an
  // unrelated open menu must be a no-op, otherwise per-keystroke schedulers
  // (scheduleChatSlashMenu/scheduleChatFileMentionSearch) would keep closing
  // each other's menus and the popup would flap on every keypress.
  const [chatComposerMenu, setChatComposerMenu, chatComposerMenuExiting] = useChatComposerMenu();
  const chatComposerMenuRef = useRef(chatComposerMenu);
  chatComposerMenuRef.current = chatComposerMenu;
  const chatPromptMenuOpen = chatComposerMenu.id === 'slash';
  const chatFileMentionMenuOpen = chatComposerMenu.id === 'file-mention';
  const chatAttachmentTrayOpen = chatComposerMenu.id === 'attachment-tray';
  const chatContextUsageOpen = chatComposerMenu.id === 'context-usage';
  const chatCoreConfigMenuOpen = chatComposerMenu.id === 'core-config';
  const chatConfigOverflowOpen = chatComposerMenu.id === 'config-overflow';
  const chatCoreConfigPanelOpen = chatComposerMenu.id === 'core-config' || chatComposerMenu.id === 'config-overflow';
  const chatConfigMenuOptionId = chatComposerMenu.id === 'config-value' ? chatComposerMenu.optionId : '';
  const setChatPromptMenuOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    const current = chatComposerMenuRef.current;
    const resolved = typeof next === 'function' ? next(current.id === 'slash') : next;
    if (resolved) {
      setChatComposerMenu({id: 'slash'});
      return;
    }
    if (current.id === 'slash') {
      setChatComposerMenu(null);
    }
  }, [setChatComposerMenu]);
  const setChatFileMentionMenuOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    const current = chatComposerMenuRef.current;
    const resolved = typeof next === 'function' ? next(current.id === 'file-mention') : next;
    if (resolved) {
      setChatComposerMenu({id: 'file-mention'});
      return;
    }
    if (current.id === 'file-mention') {
      setChatComposerMenu(null);
    }
  }, [setChatComposerMenu]);
  const setChatAttachmentTrayOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    const current = chatComposerMenuRef.current;
    const resolved = typeof next === 'function' ? next(current.id === 'attachment-tray') : next;
    if (resolved) {
      setChatComposerMenu({id: 'attachment-tray'});
      return;
    }
    if (current.id === 'attachment-tray') {
      setChatComposerMenu(null);
    }
  }, [setChatComposerMenu]);
  const setChatContextUsageOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    const current = chatComposerMenuRef.current;
    const resolved = typeof next === 'function' ? next(current.id === 'context-usage') : next;
    if (resolved) {
      setChatComposerMenu({id: 'context-usage'});
      return;
    }
    if (current.id === 'context-usage') {
      setChatComposerMenu(null);
    }
  }, [setChatComposerMenu]);
  const setChatCoreConfigMenuOpen = useCallback((next: boolean | ((open: boolean) => boolean)) => {
    const current = chatComposerMenuRef.current;
    const resolved = typeof next === 'function' ? next(current.id === 'core-config') : next;
    if (resolved) {
      setChatComposerMenu({id: 'core-config'});
      return;
    }
    if (current.id === 'core-config') {
      setChatComposerMenu(null);
    }
  }, [setChatComposerMenu]);
  const setChatConfigMenuOptionId = useCallback((next: string | ((id: string) => string)) => {
    const current = chatComposerMenuRef.current;
    const previous = current.id === 'config-value' ? current.optionId : '';
    const resolved = typeof next === 'function' ? next(previous) : next;
    if (resolved) {
      setChatComposerMenu({id: 'config-value', optionId: resolved});
      return;
    }
    if (current.id === 'config-value') {
      setChatComposerMenu(null);
    }
  }, [setChatComposerMenu]);
  const closeChatCoreConfigMenu = useCallback((restoreFocus = false) => {
    setChatComposerMenu(null);
    if (restoreFocus) {
      chatCoreConfigTriggerRef.current?.focus();
    }
  }, [setChatComposerMenu]);

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
  const floatingKeyboardOffset = workspaceUiState.transient.floatingKeyboardOffset;
  const sidebarCollapsed = workspaceUiState.desktop.sidebarCollapsed;
  const [sessionPanelShortcutUnpinned, setSessionPanelShortcutUnpinned] = useState(false);
  const chatSidebarCollapsed = sidebarCollapsed || sessionPanelShortcutUnpinned;
  const [sessionNavSlideOut, dispatchSessionNavSlideOut] = useReducer(
    sessionNavSlideOutReducer,
    undefined,
    createSessionNavSlideOutState,
  );
  const sessionNavSlideOutPanelRef = useRef<HTMLElement | null>(null);
  const sessionNavSlideOutScrollRef = useRef<HTMLDivElement | null>(null);
  const sessionNavSlideOutPointerDownRef = useRef(false);
  const sessionNavSlideOutAutoClose = useMemo(
    () => createSessionNavSlideOutAutoClose(() => {
      dispatchSessionNavSlideOut({ type: 'requestClose', suppressed: false });
    }),
    [],
  );
  useEffect(() => () => sessionNavSlideOutAutoClose.dispose(), [sessionNavSlideOutAutoClose]);
  useEffect(() => {
    if (sessionNavSlideOut.open && sessionNavSlideOutScrollRef.current) {
      sessionNavSlideOutScrollRef.current.scrollTop = sessionNavSlideOut.scrollTop;
    }
    // Restore once per open transition only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionNavSlideOut.open]);
  useEffect(() => {
    if (!sidebarCollapsed) {
      sessionNavSlideOutAutoClose.cancel();
      dispatchSessionNavSlideOut({ type: 'forceReset' });
    }
  }, [sessionNavSlideOutAutoClose, sidebarCollapsed]);
  const desktopSidebarWidth = workspaceUiState.desktop.sidebarWidth;
  const chatColumnWidth = workspaceUiState.desktop.chatColumnWidth;
  const collapsedProjectIds = workspaceUiState.shared.collapsedProjectIds;
  const pinnedProjectIds = workspaceUiState.shared.pinnedProjectIds;
  const hiddenProjectIds = workspaceUiState.shared.hiddenProjectIds;
  const expandedHubIds = workspaceUiState.shared.expandedHubIds;
  const hubColors = workspaceUiState.shared.hubColors;
  const drawerOpen = workspaceUiState.mobile.drawerOpen;
  const sidebarSettingsOpen = workspaceUiState.shared.settingsOpen;
  const [settingsScreenMounted, setSettingsScreenMounted, settingsScreenExiting] =
    useMenuExitFlag(sidebarSettingsOpen);
  useEffect(() => {
    setSettingsScreenMounted(sidebarSettingsOpen);
  }, [setSettingsScreenMounted, sidebarSettingsOpen]);
  useEffect(() => {
    if (sidebarSettingsOpen) {
      setSessionPanelShortcutUnpinned(false);
      sessionNavSlideOutAutoClose.cancel();
      dispatchSessionNavSlideOut({ type: 'forceReset' });
    }
  }, [sessionNavSlideOutAutoClose, sidebarSettingsOpen]);
  const chatKeyboardInset = workspaceUiState.transient.chatKeyboardInset;
  const chatKeyboardInsetRef = useRef(chatKeyboardInset);
  const chatKeyboardInsetSettleTimerRef = useRef<number | null>(null);
  const mobileKeyboardLayoutViewportHeightRef = useRef(0);
  const [floatingDragState, setFloatingDragState] = useState<FloatingDragState | null>(null);
  const floatingDragStateRef = useRef<FloatingDragState | null>(null);
  const [gestureNavState, setGestureNavState] = useState<GestureNavigationState | null>(null);
  const gestureNavStateRef = useRef<GestureNavigationState | null>(null);
  const gestureMoveLongPressTimerRef = useRef<number | null>(null);
  const gestureNavigationSuppressClickUntilRef = useRef(0);
  const [floatingControlStackHeight, setFloatingControlStackHeight] = useState(FLOATING_NAV_BUTTON_SIZE_PX);
  const chatComposerRef = useRef<HTMLDivElement | null>(null);
  const [chatComposerTop, setChatComposerTop] = useState<number | null>(null);
  const [floatingDefaultComposerTop, setFloatingDefaultComposerTop] = useState<number | null>(null);
  const floatingClickCooldownUntilRef = useRef(0);
  const floatingIgnoreLostCaptureRef = useRef(false);
  const floatingControlStackRef = useRef<HTMLDivElement | null>(null);
  const floatingPositionSnapshotRef = useRef<{minTop: number; maxTop: number; top: number} | null>(null);
  const [floatingSidePulse, setFloatingSidePulse] = useState<PersistedFloatingControlSide | ''>('');
  const floatingControlSideRef = useRef(floatingControlSide);
  const floatingSidePulseTimerRef = useRef<number | null>(null);
  const desktopSidebarResizeRef = useRef<DesktopSidebarResizeState | null>(null);
  const layoutModeRef = useRef(layoutMode);
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
  const setFloatingKeyboardOffset = useCallback((next: WorkspaceUiStateValue<number>) => {
    dispatchWorkspaceUi({ type: 'transient/setFloatingKeyboardOffset', next });
  }, []);
  const setSidebarCollapsed = useCallback((next: WorkspaceUiStateValue<boolean>) => {
    dispatchWorkspaceUi({ type: 'desktop/setSidebarCollapsed', next });
  }, []);
  const pinChatSessionPanel = useCallback(() => {
    setSessionPanelShortcutUnpinned(false);
    setSidebarCollapsed(false);
  }, [setSidebarCollapsed]);
  const unpinChatSessionPanel = useCallback(() => {
    setSessionPanelShortcutUnpinned(false);
    setSidebarCollapsed(true);
  }, [setSidebarCollapsed]);
  const setDesktopSidebarWidth = useCallback((next: WorkspaceUiStateValue<number>) => {
    dispatchWorkspaceUi({ type: 'desktop/setSidebarWidth', next });
  }, []);
  const setChatColumnWidth = useCallback((value: number) => {
    dispatchWorkspaceUi({ type: 'desktop/setChatColumnWidth', next: value });
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
    const current = chatComposerMenuRef.current;
    const resolved = typeof next === 'function' ? next(current.id === 'config-overflow') : next;
    if (resolved) {
      setChatComposerMenu({id: 'config-overflow'});
      return;
    }
    if (current.id === 'config-overflow') {
      setChatComposerMenu(null);
    }
  }, [setChatComposerMenu]);
  const setChatKeyboardInset = useCallback((next: WorkspaceUiStateValue<number>) => {
    dispatchWorkspaceUi({ type: 'transient/setChatKeyboardInset', next });
  }, []);
  const [databasePanelOpen, setDatabasePanelOpen] = useState(false);
  const [databaseLoading, setDatabaseLoading] = useState(false);
  const [databaseError, setDatabaseError] = useState('');
  const [databaseDumpText, setDatabaseDumpText] = useState('');
  const [databaseStorageStats, setDatabaseStorageStats] = useState<WorkspaceDatabaseStorageStats | null>(null);
  const [clearDatabasePending, setClearDatabasePending] = useState(false);
  const clearDatabasePendingRef = useRef(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const logoutPendingRef = useRef(false);
  const [settingsDetailView, setSettingsDetailView] = useState<SettingsDetailView>(null);
  const [releasePublishingOpen, setReleasePublishingOpen] = useState(false);
  const [portRelayScreenOpen, setPortRelayScreenOpen] = useState(false);
  const [sharesScreenOpen, setSharesScreenOpen] = useState(false);
  const [shareSource, setShareSource] = useState<ShareManagerSource | null>(null);
  const mobileSettingsHistoryKeyRef = useRef<string | null>(null);
  const mobileReleasePublishingHistoryRef = useRef(false);
  const mobilePortRelayHistoryRef = useRef(false);
  const mobileSharesHistoryRef = useRef(false);
  const sidebarSettingsOpenRef = useRef(sidebarSettingsOpen);
  const settingsDetailViewRef = useRef<SettingsDetailView>(settingsDetailView);
  const [settingsDetailPaneExit, setSettingsDetailPaneExit] = useState<SettingsDetail | null>(null);
  const settingsDetailPaneExitTimerRef = useRef<number | null>(null);
  const settingsDetailPrevRef = useRef<SettingsDetail | null>(settingsDetailView);
  useEffect(() => {
    const prev = settingsDetailPrevRef.current;
    settingsDetailPrevRef.current = settingsDetailView;
    if (!isWide) {
      return;
    }
    if (prev !== null && settingsDetailView === null) {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setSettingsDetailPaneExit(null);
        return;
      }
      setSettingsDetailPaneExit(prev);
      if (settingsDetailPaneExitTimerRef.current !== null) {
        window.clearTimeout(settingsDetailPaneExitTimerRef.current);
      }
      settingsDetailPaneExitTimerRef.current = window.setTimeout(() => {
        settingsDetailPaneExitTimerRef.current = null;
        setSettingsDetailPaneExit(null);
      }, MENU_EXIT_MS);
      return;
    }
    if (settingsDetailView !== null && settingsDetailPaneExitTimerRef.current !== null) {
      window.clearTimeout(settingsDetailPaneExitTimerRef.current);
      settingsDetailPaneExitTimerRef.current = null;
      setSettingsDetailPaneExit(null);
    }
  }, [isWide, settingsDetailView]);
  useEffect(() => () => {
    if (settingsDetailPaneExitTimerRef.current !== null) {
      window.clearTimeout(settingsDetailPaneExitTimerRef.current);
    }
  }, []);
  const releasePublishingOpenRef = useRef(releasePublishingOpen);
  const portRelayScreenOpenRef = useRef(portRelayScreenOpen);
  const sharesScreenOpenRef = useRef(sharesScreenOpen);
  const [desktopSidebarResizing, setDesktopSidebarResizing] = useState(false);
  const [desktopSidebarDraftWidth, setDesktopSidebarDraftWidth] = useState<number | null>(null);
  const [wheelMakerPublicMetadata, setWheelMakerPublicMetadata] = useState<WheelMakerPublicMetadata | null>(null);
  const [wheelMakerMaintenancePending, setWheelMakerMaintenancePending] = useState<WheelMakerMaintenancePending | null>(null);
  const [gatewayMaintenancePending, setGatewayMaintenancePending] = useState<GatewayMaintenancePending | null>(null);
  const [wheelMakerUpdateAllPending, setWheelMakerUpdateAllPending] = useState(false);
  const androidApkUpdateBridge = useMemo(() => createAndroidApkUpdateBridge(), []);
  const latestAndroidReleaseRef = useRef<AndroidApkLatestRelease | null>(null);
  const desktopUpdateBridge = getDesktopWindowBridge();
  const desktopUpdateController = useMemo<ClientUpdateController | null>(() => {
    if (
      !desktopUpdateBridge?.getDesktopUpdateInfo
      || !desktopUpdateBridge.requestDesktopUpdate
      || desktopUpdateBridge.localDev
    ) {
      return null;
    }
    return {
      check: () => checkDesktopUpdate(desktopUpdateBridge),
      start: async () => {
        await desktopUpdateBridge.requestDesktopUpdate?.();
      },
    };
  }, [desktopUpdateBridge]);
  const androidUpdateController = useMemo<ClientUpdateController | null>(() => {
    if (!androidApkUpdateBridge.isSupported()) return null;
    return {
      check: async () => {
        const result = await checkAndroidApkUpdate(androidApkUpdateBridge);
        latestAndroidReleaseRef.current = result.latest;
        return result.state;
      },
      start: async () => {
        const latest = latestAndroidReleaseRef.current;
        if (!latest) throw new Error('Android release is unavailable.');
        const result = await androidApkUpdateBridge.installLatest({
          downloadUrl: latest.apk.downloadUrl,
          expectedSha256: latest.apk.sha256,
          expectedSize: latest.apk.size,
          tagName: latest.tagName,
        });
        if (!result.ok) throw new Error(result.error || result.status);
      },
      subscribe: listener => subscribeAndroidApkUpdateEvents(listener),
    };
  }, [androidApkUpdateBridge]);
  const clientUpdateController = desktopUpdateController ?? androidUpdateController;
  const [agentPackageActionPendingKey, setAgentPackageActionPendingKey] = useState('');
  const [agentPackageHubUpdatePendingId, setAgentPackageHubUpdatePendingId] = useState('');
  const [projectIndexScanPendingByProjectId, setProjectIndexScanPendingByProjectId] = useState<Record<string, boolean>>({});
  const [projectIndexScanAllPendingByHubId, setProjectIndexScanAllPendingByHubId] = useState<Record<string, boolean>>({});
  const [skillsPendingKey, setSkillsPendingKey] = useState('');
  const [skillRetryNotice, setSkillRetryNotice] =
    useState<SkillRetryNotice<SkillConfirmedTarget> | null>(null);
  const skillActionByHubIdRef = useRef(new Map<string, SkillConfirmedTarget>());
  const seenSkillOperationRef = useRef(new Map<string, string>());
  const [skillInstallTarget, setSkillInstallTarget] = useState<SkillInstallTarget | null>(null);
  const [skillSourceInput, setSkillSourceInput] = useState('');
  const [skillSourcePreview, setSkillSourcePreview] = useState<RegistrySkillSourcePreview | null>(null);
  const [skillSourceRequestedNames, setSkillSourceRequestedNames] = useState<string[]>([]);
  const [skillSourceLoading, setSkillSourceLoading] = useState(false);
  const [skillSourceError, setSkillSourceError] = useState('');
  const [skillDetailTarget, setSkillDetailTarget] = useState<SkillDetailTarget | null>(null);
  const [skillDetailCache, setSkillDetailCache] = useState<Record<string, SkillDetailCacheEntry>>({});
  const chatHubSkillSurface = useMemo<ChatHubSkillSurface | null>(() => {
    if (skillInstallTarget) {
      return {kind: 'install', target: skillInstallTarget};
    }
    if (skillDetailTarget) {
      return {kind: 'detail', target: skillDetailTarget};
    }
    return null;
  }, [skillDetailTarget, skillInstallTarget]);
  const [chatHubSkillSurfaceVisible, setChatHubSkillSurfaceVisible, chatHubSkillSurfaceExiting] =
    useMenuExitState<ChatHubSkillSurface>();
  useEffect(() => {
    setChatHubSkillSurfaceVisible(chatHubSkillSurface);
  }, [chatHubSkillSurface, setChatHubSkillSurfaceVisible]);
  const chatHubSkillSurfaceForMenu = chatHubSkillSurface ?? chatHubSkillSurfaceVisible;
  const chatHubSkillSurfaceOpen = chatHubSkillSurface !== null;
  const closeChatHubSkillSurface = useCallback(() => {
    setSkillInstallTarget(null);
    setSkillDetailTarget(null);
  }, []);
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
  const [portRelayMenuSwitchingTarget, setPortRelayMenuSwitchingTarget] = useState<PortRelayTarget | null>(null);
  const [previewWorkbench, setPreviewWorkbench] = useState(() =>
    previewWorkbenchStateFromSnapshot(persistedGlobal.previewWorkbenchSnapshot),
  );
  const [chatPreviewManualOpen, setChatPreviewManualOpen] = useState(false);
  // Default to collapsed so preview tabs restored from the snapshot do not
  // auto-open the pane on launch; in-session opens reset this to expand again.
  const [chatPreviewManualCollapsed, setChatPreviewManualCollapsed] = useState(true);
  const [mobileUsageOpen, setMobileUsageOpen] = useState(false);
  const [mobileUsageMounted, setMobileUsageMounted, mobileUsageExiting] = useMenuExitFlag(mobileUsageOpen);
  useEffect(() => {
    setMobileUsageMounted(mobileUsageOpen);
  }, [mobileUsageOpen, setMobileUsageMounted]);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);
  const [terminalSync, setTerminalSync] = useState<TerminalSyncState>(() => createTerminalSyncState());
  const terminalSyncRef = useRef(terminalSync);
  const [activeTerminalKey, setActiveTerminalKey] = useState('');
  const activeTerminalKeyRef = useRef('');
  const terminalViewRef = useRef<TerminalViewHandle | null>(null);
  const terminalResizeTokensRef = useRef(new Map<string, string>());
  const terminalResizeClaimsRef = useRef(new Set<string>());
  const terminalRefreshInFlightRef = useRef(new Set<string>());
  const terminalListRefreshInFlightRef = useRef(new Set<string>());
  const terminalRefreshRef = useRef<(key: string) => Promise<void>>(async () => undefined);
  const [terminalPanelHeight, setTerminalPanelHeight] = useState(280);
  const terminalPanelResizeRef = useRef<{pointerId: number; originY: number; startHeight: number} | null>(null);
  const [previewWorkbenchActionsMenuOpen, setPreviewWorkbenchActionsMenuOpen] = useState(false);
  const [previewTabMenu, setPreviewTabMenu, previewTabMenuExiting] = useMenuExitState<{tabId: string; x: number; y: number}>();
  const [previewWorkbenchFullscreen, setPreviewWorkbenchFullscreen] = useState(false);
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
  const [previewDrawerHost, setPreviewDrawerHost] = useState<HTMLDivElement | null>(null);
  const [previewDrawerPinned, setPreviewDrawerPinned] = useState(false);
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
  const quickFileResultsRef = useRef<HTMLDivElement | null>(null);
  const quickFileSearchTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const quickFileSearchGenerationRef = useRef(0);
  const quickFileQueryIdRef = useRef(0);
  const quickFileQuerySessionIdRef = useRef(`quick-file-${Date.now()}`);
  const [previewSelectionMenu, setPreviewSelectionMenu, previewSelectionMenuExiting] = useMenuExitState<PreviewSelectionMenuState>();
  const [chatFileLinkMenu, setChatFileLinkMenu, chatFileLinkMenuExiting] = useMenuExitState<ChatFileLinkMenuState>();
  const previewContextSelectionRef = useRef<PreviewSelectionSnapshot | null>(null);
  const portRelayCodeCopyTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const portRelayClearSiteDataTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
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
    activeWorkbenchTab &&
    (
      (activeWorkbenchTab.type === 'file' && isHtmlPreviewPath(activeWorkbenchTab.path)) ||
      (activeWorkbenchTab.type !== 'file'
        && activeWorkbenchTab.type !== 'prompt-diff'
        && activeWorkbenchTab.type !== 'git-diff')
    )
      ? 'Search is not available for this preview.'
      : '';
  const previewWorkbenchRef = useRef(previewWorkbench);
  const chatPreviewHasContent = previewWorkbenchHasTabs;
  const chatPreviewOpen = chatPreviewManualOpen || (chatPreviewHasContent && !chatPreviewManualCollapsed);
  const portRelayWorkbenchOpen = !!activePortRelayPreview && chatPreviewOpen;
  // Closing the drawer always clears its pin so a reopened drawer auto-dismisses again.
  const updatePreviewDrawerMode = useCallback((mode: PreviewWorkbenchDrawerMode) => {
    if (mode === 'closed') {
      setPreviewDrawerPinned(false);
    }
    setPreviewWorkbench(current => ({...current, drawerMode: mode}));
  }, []);

  useEffect(() => {
    setPreviewWorkbenchActionsMenuOpen(false);
  }, [activeWorkbenchTab?.id, chatPreviewOpen]);

  useEffect(() => {
    if (!isWide && chatPreviewHasContent && !chatPreviewManualCollapsed) {
      setChatPreviewManualCollapsed(true);
    }
  }, []);
  const mobilePortRelayFrameOpen = !isWide && portRelayWorkbenchOpen;
  const fileIconResourcesNeeded = quickFileOpen ||
    (chatPreviewOpen && previewWorkbench.drawerMode === 'files');

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
    const listenPort = effectivePortRelayListenPort(portRelaySnapshot, portRelayListenPort);
    if (!portRelayReady || listenPort < 1) {
      return '';
    }
    const baseUrl = resolvePortRelayOpenUrl({
      relayUrl: portRelaySnapshot.relayUrl,
      registryAddress,
      listenPort,
    });
    return appendPortRelayAutoAuthCode(
      appendPortRelayOpenPath(baseUrl, portRelayFramePath),
      portRelayFrameAccessCode,
    );
  }, [portRelayListenPort, registryAddress, portRelayFrameAccessCode, portRelayFramePath, portRelayReady, portRelaySnapshot.listenPort, portRelaySnapshot.listenPortManaged, portRelaySnapshot.relayUrl]);
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

  useEffect(() => {
    if (!mobilePortRelayFrameOpen) {
      setPortRelayMenuSwitchingTarget(null);
    }
  }, [mobilePortRelayFrameOpen]);

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
  const registryHubIdsKey = JSON.stringify(deriveOperationalHubIds(registryHubs, projects));
  const registryHubIds = useMemo<string[]>(() => JSON.parse(registryHubIdsKey), [registryHubIdsKey]);
  const usageStore = useMemo(() => new UsageStore(), []);
  const [hubStoreSnapshot, setHubStoreSnapshot] = useState<HubStoreSnapshot>({hubs: {}});
  useEffect(() => {
    if (wheelMakerMaintenancePending?.action !== 'restart') {
      return;
    }
    const nowMs = Date.now();
    const resolution = resolveWheelMakerRestartPending({
      previousInstanceId: wheelMakerMaintenancePending.previousInstanceId,
      currentInstanceId: hubStoreSnapshot.hubs[wheelMakerMaintenancePending.hubId]?.instanceId || '',
      startedAtMs: wheelMakerMaintenancePending.startedAtMs,
      nowMs,
    });
    if (resolution === 'reconnected') {
      setWheelMakerMaintenancePending(null);
      return;
    }
    const expire = () => {
      setWheelMakerMaintenancePending(null);
      setError(`Restart did not reconnect within ${WHEELMAKER_RESTART_RECONNECT_TIMEOUT_MS / 1000} seconds.`);
    };
    if (resolution === 'timed_out') {
      expire();
      return;
    }
    const timeoutId = window.setTimeout(
      expire,
      wheelMakerMaintenancePending.startedAtMs + WHEELMAKER_RESTART_RECONNECT_TIMEOUT_MS - nowMs,
    );
    return () => window.clearTimeout(timeoutId);
  }, [hubStoreSnapshot, wheelMakerMaintenancePending]);
  const hubOperationalViews = useMemo(
    () => deriveHubOperationalViews(hubStoreSnapshot),
    [hubStoreSnapshot],
  );
  const wheelMakerUpdateHubs = hubOperationalViews.wheelmaker;
  const gatewayUpdateHubs = hubOperationalViews.gateway;
  const agentPackageHubs = hubOperationalViews.packages;
  const projectIndexByHubId = hubOperationalViews.indexes;
  const skillHubs = hubOperationalViews.skills;
  const chatHubFlickerBridgeStatuses = hubOperationalViews.flicker;
  useEffect(() => {
    setProjectIndexScanPendingByProjectId(current => {
      let changed = false;
      const next = {...current};
      for (const [projectId, pending] of Object.entries(current)) {
        if (!pending) continue;
        const status = Object.values(projectIndexByHubId)
          .flatMap(snapshot => snapshot.projects ?? [])
          .find(project => project.projectId === projectId);
        if (status && status.running !== true && status.status !== 'scanning') {
          next[projectId] = false;
          changed = true;
        }
      }
      return changed ? next : current;
    });
    setProjectIndexScanAllPendingByHubId(current => {
      let changed = false;
      const next = {...current};
      for (const [hubId, pending] of Object.entries(current)) {
        if (!pending) continue;
        const projects = projectIndexByHubId[hubId]?.projects;
        if (projects && projects.every(project => project.running !== true && project.status !== 'scanning')) {
          next[hubId] = false;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [projectIndexByHubId]);
  const hubRefreshTriggers = useMemo(
    () => new HubRefreshTriggers((hubId, sections, force) =>
      service.hubStore.refresh(hubId, sections, force)),
    [],
  );
  const [usageSnapshot, setUsageSnapshot] = useState<UsageViewSnapshot>({refreshing: false, providers: []});
  const visibleUsageSnapshot = usageSnapshot;
  const usageHistoryRequestSeqRef = useRef(0);
  const [usageHistoryDialogView, setUsageHistoryDialogView, usageHistoryDialogExiting] =
    useMenuExitState<UsageHistoryDialogView>();
  const deepSeekUsageRequestSeqRef = useRef(0);
  const [deepSeekUsageDialogView, setDeepSeekUsageDialogView, deepSeekUsageDialogExiting] =
    useMenuExitState<DeepSeekUsageDialogView>();
  const modelEfficiencyStore = useMemo(
    () => new ModelEfficiencyStore(() => service.getCodexRadarEfficiency()),
    [],
  );
  const [modelEfficiencySnapshot, setModelEfficiencySnapshot] = useState<ModelEfficiencySnapshot>(
    () => modelEfficiencyStore.snapshot(),
  );
  const [projectId, setProjectId] = useState('');
  const projectIdRef = useRef('');
  const projectsRef = useRef<RegistryProject[]>([]);
  const [loadingProject, setLoadingProject] = useState(false);
  const [refreshingProject, setRefreshingProject] = useState(false);
  const [hasPendingProjectUpdates, setHasPendingProjectUpdates] = useState(false);

  // The launch layer covers every pre-session state; when the workspace
  // connects it fades out over the already-rendered workspace instead of
  // unmounting abruptly. launchJustExited is derived during render so the
  // exit overlay is present in the very same commit as the workspace swap -
  // an effect-driven flag would let the workspace paint uncovered for one
  // frame and read as a flash. Silent reconnects never bring the layer back.
  const launchLayerVisible = !connected && !(reconnecting && (projects.length > 0 || !!projectId));
  const prevLaunchLayerVisibleRef = useRef(launchLayerVisible);
  const launchJustExited = prevLaunchLayerVisibleRef.current && !launchLayerVisible;
  const [launchExitDone, setLaunchExitDone] = useState(false);
  useEffect(() => {
    const justExited = prevLaunchLayerVisibleRef.current && !launchLayerVisible;
    prevLaunchLayerVisibleRef.current = launchLayerVisible;
    if (launchLayerVisible) {
      setLaunchExitDone(false);
      return;
    }
    if (justExited) {
      const timer = window.setTimeout(() => setLaunchExitDone(true), 300);
      return () => window.clearTimeout(timer);
    }
  }, [launchLayerVisible]);

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
  const gitDiffReadSeqRef = useRef(0);
  const chatFilePeekHistoryActiveRef = useRef(false);
  const chatFilePeekResizeRef = useRef<DesktopSidebarResizeState | null>(null);
  const [chatFilePeekWidth, setChatFilePeekWidth] = useState(CHAT_FILE_PEEK_WIDTH_DEFAULT);
  const [chatFilePeekWidthResized, setChatFilePeekWidthResized] = useState(false);
  const [chatFilePeekDraftWidth, setChatFilePeekDraftWidth] = useState<number | null>(null);
  const [chatFilePeekResizing, setChatFilePeekResizing] = useState(false);
  const [chatPeekSelectedLines, setChatPeekSelectedLines] = useState<Set<number>>(new Set());
  const previewSearchHighlightedLines = useMemo(
    () => new Set(previewSearchMatches.map(match => match.line)),
    [previewSearchMatches],
  );
  const chatPeekAnchorRef = useRef<number | null>(null);
  const liveRefreshTimerRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const connectInFlightRef = useRef(false);
  const dirHashRef = useRef<Record<string, string>>({});
  const previewFileLoadControllersRef = useRef<Map<string, AbortController>>(new Map());
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
  const chatCoreConfigTriggerRef = useRef<HTMLButtonElement | null>(null);
  const wideProjectActionMenuRef = useRef<HTMLDivElement | null>(null);
  const chatSelectedIdRef = useRef('');
  const selectedChatKeyRef = useRef<ChatSessionKey | null>(null);
  const chatVisibleRuntimeKeyRef = useRef('');
  const chatSelectedLoadAttemptRuntimeKeyRef = useRef('');
  const chatSelectedLoadFailureCountRef = useRef<Record<string, number>>({});
  const chatSelectedLoadRetryTimerRef = useRef<number | null>(null);
  const [chatSelectedLoadRetryTick, setChatSelectedLoadRetryTick] = useState(0);
  const chatFinishedCursorRef = useRef<Record<string, number>>({});
  const chatMessageStoreRef = useRef<Record<string, RegistryChatMessage[]>>({});
  const chatRealtimeFlushSchedulerRef = useRef<ChatRealtimeFlushScheduler | null>(null);
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
  const projectSessionsByProjectIdRef = useRef<Record<string, RegistryChatSession[]>>({});
  const [draftSessionsByProjectId, setDraftSessionsByProjectId] = useState<Record<string, DraftChatSession[]>>({});
  const draftSessionsByProjectIdRef = useRef<Record<string, DraftChatSession[]>>({});
  const draftSessionCreatePromisesRef = useRef<Record<string, Promise<RegistryChatSession>>>({});
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchInput, setSessionSearchInput] = useState('');
  const [sessionSearchProjectScope, setSessionSearchProjectScope] = useState('');
  const sessionSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [activeSessionSearchId, setActiveSessionSearchId] = useState('');
  const activeSessionSearchIdRef = useRef('');
  const [sessionSearchQuery, setSessionSearchQuery] = useState('');
  const [sessionSearchProjectItems, setSessionSearchProjectItems] = useState<RegistryProject[]>([]);
  const activeSessionSearchProjectItemsRef = useRef<RegistryProject[]>([]);
  const [pendingSessionSearchHandoff, setPendingSessionSearchHandoff] = useState<{
    projectId: string;
    sessionId: string;
    query: string;
    generation: number;
    ready: boolean;
  } | null>(null);
  const sessionSearchHandoffGenerationRef = useRef(0);
  const [searchResultsByProjectId, setSearchResultsByProjectId] = useState<SessionSearchResultsByProjectId>({});
  const [sessionSearchDoneByProjectId, setSessionSearchDoneByProjectId] = useState<Record<string, boolean>>({});
  const sessionSearchDoneByProjectIdRef = useRef<Record<string, boolean>>({});
  const [sessionSearchErrorsByProjectId, setSessionSearchErrorsByProjectId] = useState<Record<string, string>>({});
  const [olderSessionsExpandedByProjectId, setOlderSessionsExpandedByProjectId] = useState<Record<string, boolean>>(
    () => readOlderSessionsExpanded(typeof window !== 'undefined' ? window.sessionStorage : null),
  );
  const [sessionArchiveMenuOpen, setSessionArchiveMenuOpen, sessionArchiveMenuExiting] = useMenuExitFlag();
  const sessionArchiveMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (sessionArchiveMenuOpen) {
      focusFirstMenuItem(sessionArchiveMenuRef.current);
    }
  }, [sessionArchiveMenuOpen]);
  const [archiveBatchProgress, setArchiveBatchProgress] = useState<ArchiveBatchProgress | null>(null);
  const [archiveBatchSummary, setArchiveBatchSummary] = useState('');
  const [archivedMode, setArchivedMode] = useState(false);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedError, setArchivedError] = useState('');
  const [archivedByProjectId, setArchivedByProjectId] = useState<Record<string, RegistryArchivedSessionSummary[]>>({});
  const [selectedArchivedKey, setSelectedArchivedKey] = useState<ChatSessionKey | null>(null);
  const [archivedPreview, setArchivedPreview] = useState<RegistrySessionArchiveReadResponse | null>(null);
  const [archivedRestoringSessionId, setArchivedRestoringSessionId] = useState('');
  const scrollToChatSearchMatch = useCallback((match: {turnIndex: number}) => {
    chatVirtuosoListRef.current?.scrollToTurnIndex(match.turnIndex, 'smooth');
  }, []);
  const sessionSearchUnchangedPollsRef = useRef(0);
  const sessionSearchPollTimerRef = useRef<number | null>(null);
  const sessionSearchIdCounterRef = useRef(0);
  const [chatPromptHistoryTargetTurn, setChatPromptHistoryTargetTurn] = useState<{
    runtimeKey: string;
    turnIndex: number;
    generation: number;
  } | null>(null);
  const chatPromptHistoryHighlightTimerRef = useRef<number | null>(null);
  const [wideProjectActionMenu, setWideProjectActionMenu, wideProjectActionMenuExiting] = useMenuExitState<WideProjectActionMenuState>();
  const [mobileProjectActionMenu, setMobileProjectActionMenu, mobileProjectActionMenuExiting] = useMenuExitState<MobileProjectActionMenuState>();
  const [mobileRelayTargetSheet, setMobileRelayTargetSheet, mobileRelayTargetSheetExiting] =
    useMenuExitState<{open: true}>();
  const [projectSessionActionMenu, setProjectSessionActionMenu, projectSessionActionMenuExiting] = useMenuExitState<ProjectSessionActionMenuState>();
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
  const [chatPinningSessionKey, setChatPinningSessionKey] = useState('');
  const [chatMarkingSessionKey, setChatMarkingSessionKey] = useState('');
  const [renameTarget, setRenameTarget] = useState<RenameSessionTarget | null>(null);
  const [renameTitleDraft, setRenameTitleDraft] = useState('');
  const [renameError, setRenameError] = useState('');
  const [goalEditTarget, setGoalEditTarget] = useState<GoalEditTarget | null>(null);
  const [goalEditError, setGoalEditError] = useState('');
  const [goalControlPendingKey, setGoalControlPendingKey] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [confirmError, setConfirmError] = useState('');
  const [sessionStatusDialog, setSessionStatusDialog] = useState<SessionStatusDialogState | null>(null);
  const [chatConfigUpdatingKeys, setChatConfigUpdatingKeys] = useState<Set<string>>(() => new Set());
  const [chatComposerText, setChatComposerText] = useState('');
  const [chatComposerTokens, setChatComposerTokens] = useState<ChatComposerToken[]>([]);
  const [chatComposerSelectionRestore, setChatComposerSelectionRestore] = useState<ChatRichComposerSelectionRestore | null>(null);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [chatAttachmentRemovingId, setChatAttachmentRemovingId] = useState('');
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
  const [chatSessionQueuesByKey, setChatSessionQueuesByKey] = useState<ChatSessionQueuesByKey>({});
  const [chatCompactingByKey, setChatCompactingByKey] = useState<Record<string, boolean>>({});
  const [chatCancellingRuntimeKey, setChatCancellingRuntimeKey] = useState('');
  const [markdownHtmlExportRequest, setMarkdownHtmlExportRequest] = useState<MarkdownHtmlExportRequest | null>(null);
  const [markdownShareCaptureRequest, setMarkdownShareCaptureRequest] = useState<MarkdownShareCaptureRequest | null>(null);
  const [promptMarkdownHtmlExportDraft, setPromptMarkdownHtmlExportDraft] = useState<PromptMarkdownHtmlExportDraft | null>(null);
  const [chatShareCaptureTask, setChatShareCaptureTask] = useState<ChatShareCaptureTask | null>(null);
  const [exportingMarkdownHtmlKey, setExportingMarkdownHtmlKey] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const markdownHtmlExportIdRef = useRef(0);
  const markdownShareCaptureIdRef = useRef(0);
  const chatShareCaptureIdRef = useRef(0);
  const chatShareReservationPendingRef = useRef(false);
  const markdownShareCapturePendingRef = useRef<MarkdownShareCapturePending | null>(null);
  const chatShareCapturePendingRef = useRef<ChatShareCapturePending | null>(null);
  const chatComposerTextRef = useRef('');
  const chatComposerTextCursorRef = useRef(0);
  const chatComposerTokensRef = useRef<ChatComposerToken[]>([]);
  const chatAttachmentsRef = useRef<ChatAttachment[]>([]);
  const chatComposerDraftsRef = useRef<Record<string, ChatComposerDraft>>({});
  const chatPendingPromptsByKeyRef = useRef<Record<string, PendingChatPrompt>>({});
  const chatSessionQueuesByKeyRef = useRef<ChatSessionQueuesByKey>({});
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
  const [chatFileMentionResults, setChatFileMentionResults] = useState<RegistryFileIndexSearchResult[]>([]);
  const [chatFileMentionQuery, setChatFileMentionQuery] = useState('');
  const [chatFileMentionLoading, setChatFileMentionLoading] = useState(false);
  const [chatFileMentionError, setChatFileMentionError] = useState('');
  const [chatFileMentionIndexed, setChatFileMentionIndexed] = useState(true);
  const [chatFileMentionActiveIndex, setChatFileMentionActiveIndex] = useState(0);
  const [chatContextUsagePopoverStyle, setChatContextUsagePopoverStyle] = useState<React.CSSProperties>({});
  const [chatHubMenuOpen, setChatHubMenuOpen, chatHubMenuExiting] = useMenuExitFlag();
  const [chatHubColorMenu, setChatHubColorMenu, chatHubColorMenuExiting] = useMenuExitState<{hubId: string}>();
  const chatHubColorMenuHubId = chatHubColorMenu?.hubId ?? '';
  const chatHubMenuRef = useRef<HTMLDivElement | null>(null);
  const chatHubPopoverRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!chatHubMenuOpen && chatHubSkillSurfaceOpen) {
      closeChatHubSkillSurface();
    }
  }, [chatHubMenuOpen, chatHubSkillSurfaceOpen, closeChatHubSkillSurface]);
  const [chatHubFlickerBridgeActionHubId, setChatHubFlickerBridgeActionHubId] = useState('');
  const [chatHubExpandedSections, setChatHubExpandedSections] = useState<Record<string, ChatHubDetailId[]>>({});
  const [chatHubConfigByHubId, setChatHubConfigByHubId] = useState<Record<string, {
    loading: boolean;
    error: string;
    data: RegistryHubConfig | null;
    busyField: string;
  }>>({});
  const [chatTitleProjectMenuOpen, setChatTitleProjectMenuOpen, chatTitleProjectMenuExiting] = useMenuExitFlag();
  const chatTitleProjectButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatTitleProjectMenuRef = useRef<HTMLDivElement | null>(null);
  const [chatTitlePromptMenuOpen, setChatTitlePromptMenuOpen, chatTitlePromptMenuExiting] = useMenuExitFlag();
  const chatTitlePromptButtonRef = useRef<HTMLButtonElement | null>(null);
  const chatTitlePromptMenuRef = useRef<HTMLDivElement | null>(null);

  const [chatSlashQuery, setChatSlashQuery] = useState<string | null>(null);
  const [chatSlashActiveIndex, setChatSlashActiveIndex] = useState(0);
  const chatFileMentionQuerySessionIdRef = useRef(`file-query-${Date.now()}`);
  const chatFileMentionQueryIdRef = useRef(0);
  const chatFileMentionSearchTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const chatFileMentionSearchGenerationRef = useRef(0);
  const [resumeSessions, setResumeSessions] = useState<RegistryResumableSession[]>([]);
  const [resumeLoading, setResumeLoading] = useState(false);

  const runChatHubFlickerBridgeAction = useCallback(async (
    hubId: string,
    action: 'start' | 'stop' | 'restart' | 'switchMode',
    params: Record<string, unknown> = {},
  ): Promise<void> => {
    setChatHubFlickerBridgeActionHubId(hubId);
    try {
      await service.runHubStateAction(hubId, 'flickerBridge', action, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
    } finally {
      setChatHubFlickerBridgeActionHubId(current => current === hubId ? '' : current);
    }
  }, []);

  const refreshChatHubConfig = useCallback(async (hubId: string): Promise<void> => {
    setChatHubConfigByHubId(current => ({
      ...current,
      [hubId]: {
        loading: true,
        error: '',
        data: current[hubId]?.data ?? null,
        busyField: current[hubId]?.busyField ?? '',
      },
    }));
    try {
      const result = await service.getHubConfig(hubId);
      setChatHubConfigByHubId(current => ({
        ...current,
        [hubId]: {loading: false, error: '', data: result.config, busyField: current[hubId]?.busyField ?? ''},
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const friendly = /unknown|unsupported|not found|method/i.test(message)
        ? 'This hub does not support hub configuration yet.'
        : message;
      setChatHubConfigByHubId(current => ({
        ...current,
        [hubId]: {loading: false, error: friendly, data: current[hubId]?.data ?? null, busyField: ''},
      }));
    }
  }, [service]);

  const updateChatHubConfig = useCallback(async (
    hubId: string,
    update: RegistryHubConfigUpdatePayload,
  ): Promise<void> => {
    const busyField = `${update.section}:${update.field}`;
    setChatHubConfigByHubId(current => ({
      ...current,
      [hubId]: {
        loading: false,
        error: '',
        data: current[hubId]?.data ?? null,
        busyField,
      },
    }));
    try {
      const result = await service.updateHubConfig(hubId, update);
      setChatHubConfigByHubId(current => ({
        ...current,
        [hubId]: {loading: false, error: '', data: result.config, busyField: ''},
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChatHubConfigByHubId(current => ({
        ...current,
        [hubId]: {loading: false, error: message, data: current[hubId]?.data ?? null, busyField: ''},
      }));
      throw error;
    }
  }, [service]);

  useEffect(() => {
    if (!chatHubMenuOpen || !connected || registryHubIds.length === 0) {
      return;
    }
    for (const hubId of registryHubIds) {
      refreshChatHubConfig(hubId).catch(() => undefined);
    }
  }, [chatHubMenuOpen, connected, refreshChatHubConfig, registryHubIdsKey]);

  useEffect(() => {
    if (!chatHubMenuOpen) {
      setChatHubExpandedSections({});
    }
  }, [chatHubMenuOpen]);

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
  const consumeSessionSearchHandoff = useCallback((generation: number) => {
    setPendingSessionSearchHandoff(current =>
      current?.generation === generation ? null : current,
    );
  }, []);
  const {
    open: chatSearchOpen,
    query: chatSearchQuery,
    setQuery: setChatSearchQuery,
    activeIndex: chatSearchActiveIndex,
    matches: chatSearchMatches,
    activeMatch: chatSearchActiveMatch,
    activeTurnIndex: chatSearchActiveTurnIndex,
    inputRef: chatSearchInputRef,
    openSearch: openChatSearch,
    closeSearch: closeChatSearch,
    navigate: navigateChatSearchMatch,
    handleInputKeyDown: handleChatSearchInputKeyDown,
  } = useChatSearchController({
    sourceKey: archivedMode
      ? `archive:${encodeChatSessionKey(selectedArchivedKey)}`
      : `live:${selectedChatEncodedKey}`,
    liveMessages: chatMessages,
    archivedMessages: archivedPreview?.messages ?? [],
    archivedMode,
    scrollToMatch: scrollToChatSearchMatch,
    openRequest: pendingSessionSearchHandoff?.ready ? {
      sourceKey: `live:${encodeChatSessionKey(chatSessionKeyFromParts(
        pendingSessionSearchHandoff.projectId,
        pendingSessionSearchHandoff.sessionId,
      ))}`,
      query: pendingSessionSearchHandoff.query,
      generation: pendingSessionSearchHandoff.generation,
    } : null,
    onOpenRequestConsumed: consumeSessionSearchHandoff,
  });
  const chatSearchMatchIdsByMessageKey = useMemo(
    () => {
      const result = new Map<string, string[]>();
      for (const match of chatSearchMatches) {
        const matchId = `${match.messageKey}:${match.occurrenceIndex}`;
        const ids = result.get(match.messageKey) ?? [];
        ids.push(matchId);
        result.set(match.messageKey, ids);
      }
      return result;
    },
    [chatSearchMatches],
  );
  useEffect(() => {
    const scrollRoot = chatScrollRef.current;
    if (!scrollRoot || !chatSearchOpen || !chatSearchQuery.trim()) {
      return;
    }

    let lastScrolledMatchToken = '';
    const refreshVisibleChatSearchHighlights = () => {
      const roots = Array.from(
        scrollRoot.querySelectorAll<HTMLElement>('[data-chat-search-match-root="true"]'),
      );
      for (const root of roots) {
        applyChatSearchCodeHighlights(root, chatSearchQuery);
        let matchIds: string[] = [];
        try {
          const parsed = JSON.parse(root.dataset.chatSearchMatchIds ?? '[]');
          if (Array.isArray(parsed)) {
            matchIds = parsed.filter((value): value is string => typeof value === 'string');
          }
        } catch {
          matchIds = [];
        }
        const activeMatchId = chatSearchActiveMatch
          ? `${chatSearchActiveMatch.messageKey}:${chatSearchActiveMatch.occurrenceIndex}`
          : '';
        const occurrenceIndex = activeMatchId ? matchIds.indexOf(activeMatchId) : -1;
        applyChatSearchActiveMatch(root, occurrenceIndex);
        if (occurrenceIndex < 0 || !activeMatchId) {
          continue;
        }
        const activeMark = root.querySelectorAll<HTMLElement>('mark.chat-search-match')[occurrenceIndex];
        const matchToken = activeMatchId;
        if (
          activeMark &&
          typeof activeMark.scrollIntoView === 'function' &&
          matchToken !== lastScrolledMatchToken
        ) {
          lastScrolledMatchToken = matchToken;
          activeMark.scrollIntoView({block: 'center', behavior: 'smooth'});
        }
      }
    };

    refreshVisibleChatSearchHighlights();
    const observer = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(refreshVisibleChatSearchHighlights);
    observer?.observe(scrollRoot, {childList: true, subtree: true});
    return () => {
      observer?.disconnect();
      const roots = Array.from(
        scrollRoot.querySelectorAll<HTMLElement>('[data-chat-message-key]'),
      );
      for (const root of roots) {
        clearChatSearchGeneratedMarks(root);
        applyChatSearchActiveMatch(root, -1);
      }
    };
  }, [chatSearchActiveMatch, chatSearchMatches, chatSearchOpen, chatSearchQuery]);
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
  const selectedGoal = selectedChatSession?.sessionActions?.goal?.supported === true
    ? selectedChatSession.goal ?? null
    : null;

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

  const selectedFullChatMessages = archivedMode
    ? archivedPreview?.messages ?? []
    : selectedChatEncodedKey && chatVisibleRuntimeKeyRef.current === selectedChatEncodedKey
      ? chatMessages
      : [];
  const selectedPermissionState = useMemo(
    () => deriveChatPermissionState(selectedFullChatMessages),
    [selectedFullChatMessages],
  );
  const archivedPermissionState = useMemo(
    () => deriveChatPermissionState(archivedPreview?.messages ?? []),
    [archivedPreview?.messages],
  );
  const selectedActivePermission = useMemo(() => {
    void permissionReadRevision;
    if (
      !connected ||
      archivedMode ||
      !selectedChatEncodedKey ||
      !permissionReadGateRef.current.isReady(selectedChatEncodedKey)
    ) {
      return null;
    }
    return selectedPermissionState.active;
  }, [archivedMode, connected, permissionReadRevision, selectedChatEncodedKey, selectedPermissionState]);
  const {dialogRef: chatPermissionDialogRef, height: chatPermissionDialogHeight} = useChatPermissionDialogHeight();
  const selectedActivePermissionView = useMemo(
    () => selectedActivePermission ? permissionRequestView(selectedActivePermission.request) : null,
    [selectedActivePermission],
  );
  const selectedPromptTurnStatusIndex = useMemo(
    () => buildPromptTurnStatusIndex(selectedFullChatMessages),
    [selectedFullChatMessages],
  );
  const selectedChatPlan = useMemo(
    () => !archivedMode
      ? extractLatestChatPlan(selectedFullChatMessages)
      : null,
    [archivedMode, selectedFullChatMessages],
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
  const activeChatPromptHistory = !archivedMode ? selectedChatPromptHistory : [];
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
      width: menuWidth,
    };
  }, [chatTitlePromptMenuAvailable, chatTitlePromptMenuOpen, isWide]);
  const chatHubPopoverStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!chatHubMenuOpen || typeof window === 'undefined') {
      return undefined;
    }
    const anchor = chatHubMenuRef.current?.getBoundingClientRect();
    if (!anchor) {
      return undefined;
    }
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const menuWidth = Math.min(340, Math.max(0, viewportWidth - 24));
    const companionWidth = Math.min(520, Math.max(380, viewportWidth * 0.4));
    const stackWidth = menuWidth + (chatHubSkillSurfaceForMenu ? companionWidth + 8 : 0);
    const baseLeft = Math.max(12, Math.min(anchor.right - menuWidth, viewportWidth - menuWidth - 12));
    const shiftedLeft = Math.max(12, Math.min(anchor.right - menuWidth, viewportWidth - stackWidth - 12));
    return {
      left: baseLeft,
      top: Math.max(12, anchor.bottom + 6),
      '--chat-hub-stack-shift': `${shiftedLeft - baseLeft}px`,
    } as React.CSSProperties;
  }, [chatHubMenuOpen, chatHubSkillSurfaceForMenu, isWide]);

  const selectedPendingPrompt = selectedChatEncodedKey
    ? chatPendingPromptsByKey[selectedChatEncodedKey]
    : undefined;
  const selectedSessionQueue = selectedChatEncodedKey
    ? chatSessionQueuesByKey[selectedChatEncodedKey]
    : undefined;
  const selectedTranscriptQueueItemIDs = useMemo(
    () => queueTranscriptItemIDs(selectedFullChatMessages),
    [selectedFullChatMessages],
  );
  const selectedQueueItems = useMemo(
    () => queueDisplayItems(selectedSessionQueue, selectedTranscriptQueueItemIDs),
    [selectedSessionQueue, selectedTranscriptQueueItemIDs],
  );
  const queuedPromptTurnIndex = useCallback(
    (index: number) => nextPromptTurnIndex(selectedFullChatMessages) + index + 1,
    [selectedFullChatMessages],
  );
  const selectedChatSubmitPending = selectedChatEncodedKey
    ? chatSubmittingByKey[selectedChatEncodedKey] === true
    : false;

  const chatDisplayIndex = useMemo(() => buildChatDisplayIndex(chatMessages, {
    collapseCompletedWork: hasMessageLifecycleFeature(selectedChatSession),
    layoutMetrics: chatLayoutMetrics,
    permissionState: selectedPermissionState,
    promptStatus: selectedPromptTurnStatusIndex.statusFor,
    shouldRender: (message, promptStatus) => {
      const resolvedPromptStatus = isPromptStartMessage(message)
        ? promptStatus
        : null;
      return shouldRenderChatTurn(message, resolvedPromptStatus);
    },
    pendingKey: selectedPendingPrompt
      ? `${selectedChatEncodedKey}:pending:${selectedPendingPrompt.createdAt}`
      : undefined,
    pendingEstimatedHeight: 120,
    queuedKeys: selectedQueueItems.map(item => `${selectedChatEncodedKey}:queued:${item.itemId}`),
    queuedEstimatedHeight: 128,
  }), [
    chatMessages,
    chatLayoutMetrics,
    selectedChatEncodedKey,
    selectedPromptTurnStatusIndex,
    selectedPendingPrompt,
    selectedQueueItems,
    selectedPermissionState,
    selectedChatSession?.agentType,
    selectedChatSession?.sessionFeatures,
  ]);
  const archivedChatDisplayIndex = useMemo(() => buildChatDisplayIndex(archivedPreview?.messages ?? [], {
    collapseCompletedWork: hasMessageLifecycleFeature(archivedPreview?.session, true),
    layoutMetrics: chatLayoutMetrics,
    permissionState: archivedPermissionState,
    promptStatus: () => null,
    shouldRender: (message, promptStatus) => shouldRenderChatTurn(message, promptStatus),
  }), [archivedPreview?.messages, archivedPreview?.session, archivedPermissionState, chatLayoutMetrics]);

  const openSessionSearch = () => {
    closeChatSearch();
    if (
      resolveSessionSearchExpansion({
        sessionPanelPinned: desktopChatSessionPinned,
        slideOutOpen: sessionNavSlideOut.open,
      }) === 'open-slideout'
    ) {
      dispatchSessionNavSlideOut({ type: 'open' });
    }
    setSessionSearchOpen(true);
    window.requestAnimationFrame(() => {
      sessionSearchInputRef.current?.focus();
      sessionSearchInputRef.current?.select();
    });
  };


  useEffect(() => {
    if (
      !chatPromptHistoryTargetTurn ||
      chatPromptHistoryTargetTurn.runtimeKey !== selectedChatEncodedKey ||
      chatDisplayIndex.items.length === 0
    ) {
      return;
    }
    const searchTargetTurnIsVisible = chatDisplayIndex.items.some(
      item => chatDisplayItemContainsTurn(item, chatPromptHistoryTargetTurn.turnIndex),
    );
    if (!searchTargetTurnIsVisible) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      chatVirtuosoListRef.current?.scrollToTurnIndex(chatPromptHistoryTargetTurn.turnIndex, 'smooth');
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [chatDisplayIndex, selectedChatEncodedKey, chatPromptHistoryTargetTurn]);

  const chatComposerStatusCompact = !isWide || windowWidth < 980 || (chatPreviewOpen && windowWidth < 1280);

  const chatConfigDisplay = useMemo(() => {
    const status = splitChatComposerStatusOptions(selectedChatConfigOptions, chatComposerStatusCompact);
    return {
      status,
      visible: status.secondaryOptions,
      overflow: status.overflowOptions,
    };
  }, [chatComposerStatusCompact, selectedChatConfigOptions]);

  const skillProjectId = useMemo(
    () => resolveChatSkillProjectId(
      projects,
      selectedChatKey?.projectId,
      projectId,
    ),
    [projects, projectId, selectedChatKey?.projectId],
  );
  const skillHubId = useMemo(() => {
    const skillProject = projects.find(item => item.projectId === skillProjectId);
    return skillProject ? projectHubId(skillProject) : '';
  }, [projects, skillProjectId]);
  const chatSlashSkillsRequested = chatSlashQuery !== null;
  useEffect(() => {
    if (
      !chatSlashSkillsRequested
      || !skillHubId
      || service.hubStore.getSection(skillHubId, 'skills')
    ) {
      return;
    }
    void service.hubStore.refresh(skillHubId, ['skills'], false).catch(() => undefined);
  }, [chatSlashSkillsRequested, skillHubId]);

  const chatSlashSkills = useMemo(() => {
    const currentProject = projects.find(item => item.projectId === skillProjectId);
    const agent = (selectedChatSession?.agentType || currentProject?.agent || '').trim();
    return selectComposerSkills(hubStoreSnapshot, skillProjectId, agent);
  }, [hubStoreSnapshot, projects, skillProjectId, selectedChatSession?.agentType]);

  const chatSlashDiagnostic = useMemo(
    () => selectComposerDiagnostic(hubStoreSnapshot, skillProjectId),
    [hubStoreSnapshot, skillProjectId],
  );

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

  const chatSlashMenuVisible = chatPromptMenuOpen && chatSlashMenuOptions.length > 0;


  const currentChatDraftKey = useMemo(
    () => buildChatDraftKey(selectedChatKey?.projectId ?? projectId, selectedChatId),
    [projectId, selectedChatId, selectedChatKey?.projectId],
  );

  const buildChatRuntimeKey = (
    activeProjectId: string,
    sessionId: string,
  ): string => encodeChatSessionKey(chatSessionKeyFromParts(activeProjectId, sessionId));

  const markPermissionReadPending = (runtimeKey: string): ChatPermissionReadToken => {
    const wasReady = permissionReadGateRef.current.isReady(runtimeKey);
    const token = permissionReadGateRef.current.begin(runtimeKey);
    if (wasReady) setPermissionReadRevision(revision => revision + 1);
    return token;
  };

  const markPermissionReadReady = (runtimeKey: string, token: ChatPermissionReadToken) => {
    if (permissionReadGateRef.current.complete(runtimeKey, token)) {
      setPermissionReadRevision(revision => revision + 1);
    }
  };

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

  useEffect(() => {
    const scheduler = createChatRealtimeFlushScheduler({
      requestFrame: callback => window.requestAnimationFrame(callback),
      cancelFrame: handle => window.cancelAnimationFrame(handle),
      flush: runtimeKeys => {
        runtimeKeys.forEach(runtimeKey => {
          setVisibleChatMessagesForRuntimeKey(
            runtimeKey,
            chatMessageStoreRef.current[runtimeKey] ?? [],
            {followLatest: chatAutoScrollFollowRef.current},
          );
        });
      },
    });
    chatRealtimeFlushSchedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      if (chatRealtimeFlushSchedulerRef.current === scheduler) {
        chatRealtimeFlushSchedulerRef.current = null;
      }
    };
  }, [setVisibleChatMessagesForRuntimeKey]);

  const scheduleVisibleChatMessagesForRuntimeKey = useCallback((runtimeKey: string) => {
    const scheduler = chatRealtimeFlushSchedulerRef.current;
    if (scheduler) {
      scheduler.schedule(runtimeKey);
      return;
    }
    setVisibleChatMessagesForRuntimeKey(
      runtimeKey,
      chatMessageStoreRef.current[runtimeKey] ?? [],
      {followLatest: chatAutoScrollFollowRef.current},
    );
  }, [setVisibleChatMessagesForRuntimeKey]);

  const applySelectedChatKey = (key: ChatSessionKey | null) => {
    chatRealtimeFlushSchedulerRef.current?.flushNow();
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
  }, []);

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
      ...(chatKeyboardInset > 0 ? { paddingBottom: `${chatKeyboardInset}px` } : {}),
      '--chat-view-column-width': `${chatColumnWidth}px`,
    }) as React.CSSProperties,
    [chatKeyboardInset, chatColumnWidth],
  );
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
      if (command.behavior === 'insert-command') {
        const next = replaceActiveSlashQuery(
          chatComposerTextRef.current,
          chatComposerTextCursorRef.current,
          command.insertText || command.name,
        );
        updateChatComposerText(next.text, next.cursor);
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

  const [openingPromptArtifactKey, setOpeningPromptArtifactKey] = useState('');
  const [promptArtifactErrors, setPromptArtifactErrors] = useState<Record<string, string>>({});
  const [forkingPromptDoneKey, setForkingPromptDoneKey] = useState('');
  const forkingPromptDoneKeyRef = useRef('');
  const [forkingCurrentSessionKey, setForkingCurrentSessionKey] = useState('');
  const forkingCurrentSessionKeyRef = useRef('');
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
  const chatPreviewProjectId = selectedChatKey?.projectId || projectId || projectIdRef.current;
  const gitBrowserSnapshot = useSyncExternalStore(
    gitBrowserStore.subscribe,
    gitBrowserStore.snapshot,
    gitBrowserStore.snapshot,
  );
  const previewGitSnapshot = gitBrowserSnapshot[previewWorkbench.activeProjectId]
    ?? gitBrowserStore.project(previewWorkbench.activeProjectId);
  const desktopGitSnapshot = gitBrowserSnapshot[chatPreviewProjectId]
    ?? gitBrowserStore.project(chatPreviewProjectId);

  useEffect(() => {
    void gitBrowserStore.syncProjects(projects);
  }, [projects]);

  useEffect(() => {
    if (
      previewWorkbench.drawerMode !== 'git'
      || !previewGitSnapshot.available
      || !previewGitSnapshot.online
    ) return;
    void gitBrowserStore.ensureHistory(previewGitSnapshot.projectId);
    void gitBrowserStore.ensureStatus(previewGitSnapshot.projectId);
  }, [
    previewWorkbench.drawerMode,
    previewGitSnapshot.projectId,
    previewGitSnapshot.available,
    previewGitSnapshot.online,
  ]);

  useEffect(() => {
    if (!isWide || archivedMode || !desktopGitSnapshot.available || !desktopGitSnapshot.online) return;
    void gitBrowserStore.ensureStatus(desktopGitSnapshot.projectId);
  }, [
    isWide,
    archivedMode,
    desktopGitSnapshot.projectId,
    desktopGitSnapshot.available,
    desktopGitSnapshot.online,
  ]);
  const hiddenProjectItems = visibility.hiddenProjects;
  const hiddenProjectIdSet = useMemo(() => new Set(hiddenProjectIds), [hiddenProjectIds]);
  useLayoutEffect(() => {
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
    return hubIds.map(hubId => {
      const descriptor = registryHubs.find(hub => hub.hubId === hubId);
      return {
        hubId,
        projects: sortedProjectItems.filter(projectItem => projectHubId(projectItem) === hubId),
        connectionMode: descriptor?.connectionMode,
      };
    });
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
  useEffect(() => {
    void hubRefreshTriggers
      .setMenuOpen(chatHubMenuOpen && connected, registryHubIds, effectiveExpandedHubIds)
      .catch(() => undefined);
  }, [
    chatHubMenuOpen,
    connected,
    effectiveExpandedHubIds,
    hubRefreshTriggers,
    registryHubIds,
  ]);
  useEffect(() => {
    if (!chatHubMenuOpen || !connected) return;
    let active = true;
    fetchWheelMakerPublicMetadata()
      .then(metadata => {
        if (active) setWheelMakerPublicMetadata(metadata);
      })
      .catch(() => {
        if (active) setWheelMakerPublicMetadata(null);
      });
    return () => {
      active = false;
    };
  }, [chatHubMenuOpen, connected]);
  const hubAccentStyle = useCallback((hubId: string): React.CSSProperties => {
    const color = resolveHubColor(hubColors, hubId);
    return {'--hub-accent': color, '--pill-accent': color} as React.CSSProperties;
  }, [hubColors]);
  const sessionSearchFilter = useMemo(
    () => buildSessionSearchFilter({
      projects: sessionSearchProjectItems,
      sessionsByProjectId: projectSessionsByProjectId,
      resultsByProjectId: searchResultsByProjectId,
    }),
    [projectSessionsByProjectId, searchResultsByProjectId, sessionSearchProjectItems],
  );
  const archivedSessionSections = useMemo(
    () => buildArchivedSessionSections({
      projects: sortedProjectItems,
      archivedByProjectId,
    }),
    [archivedByProjectId, sortedProjectItems],
  );
  const sessionSearchActive = !!activeSessionSearchId;
  const sessionSearchHeaderExpanded = sessionSearchOpen || sessionSearchActive;
  useEffect(() => {
    if (!sessionNavSlideOut.open) {
      syncSessionNavSlideOutAutoClose(sessionNavSlideOutAutoClose, {
        open: false,
        pointerInside: false,
        suppressed: false,
      });
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      syncSessionNavSlideOutAutoClose(sessionNavSlideOutAutoClose, {
        open: true,
        pointerInside: sessionNavSlideOutPanelRef.current?.matches(':hover') ?? false,
        suppressed: isSessionNavSlideOutCloseSuppressed({
          searchActive: sessionSearchActive || sessionSearchHeaderExpanded,
          menuOpen: sessionArchiveMenuOpen || !!wideProjectActionMenu || !!projectSessionActionMenu,
          pointerDownInList: sessionNavSlideOutPointerDownRef.current,
          archivedOpen: archivedMode,
        }),
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [
    archivedMode,
    projectSessionActionMenu,
    sessionArchiveMenuOpen,
    sessionNavSlideOut.open,
    sessionNavSlideOutAutoClose,
    sessionSearchActive,
    sessionSearchHeaderExpanded,
    wideProjectActionMenu,
  ]);
  const sessionSearchErrorCount = useMemo(
    () => Object.values(sessionSearchErrorsByProjectId).filter(message => message.trim()).length,
    [sessionSearchErrorsByProjectId],
  );
  const sessionSearchAllDone = useMemo(() => {
    if (!activeSessionSearchId || sessionSearchProjectItems.length === 0) {
      return false;
    }
    return sessionSearchProjectItems.every(item => sessionSearchDoneByProjectId[item.projectId] === true);
  }, [activeSessionSearchId, sessionSearchDoneByProjectId, sessionSearchProjectItems]);
  const sessionSearchStatus = useMemo(() => {
    if (!sessionSearchActive) {
      return '';
    }
    if (!sessionSearchAllDone) {
      return 'Searching...';
    }
    if (sessionSearchErrorCount > 0) {
      return 'Some sessions couldn’t be searched';
    }
    if (sessionSearchFilter.projects.length === 0) {
      return 'No matching sessions';
    }
    return '';
  }, [
    sessionSearchActive,
    sessionSearchAllDone,
    sessionSearchErrorCount,
    sessionSearchFilter.projects.length,
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
  const showFloatingSessionPanel = isWide && chatSidebarCollapsed && !archivedMode && !sessionSearchActive;
  const showChatEdgeSurfaces = isWide && !archivedMode && (showFloatingSessionPanel || !!selectedChatPlan || desktopGitSnapshot.available || showMonitor);
  const chatMainClassName = isWide
    ? `chat-main chat-view-width-fixed-800${showChatEdgeSurfaces ? ' chat-view-width-fixed-800-edge-surfaces' : ''}`
    : 'chat-main';
  const desktopChatFixedPreview = isWide && chatPreviewOpen;
  const closeSidebarTransientMenus = useCallback((keepOpen: 'hub' | 'project' | 'prompt' | null = null) => {
    setProjectMenuOpen(false);
    setWorkspaceProjectMenuOpen(false);
    setWideProjectActionMenu(null);
    setMobileProjectActionMenu(null);
    setProjectSessionActionMenu(null);
    setSessionArchiveMenuOpen(false);
    if (keepOpen !== 'hub') {
      setChatHubMenuOpen(false);
    }
    setChatHubColorMenu(null);
    if (keepOpen !== 'project') {
      setChatTitleProjectMenuOpen(false);
    }
    if (keepOpen !== 'prompt') {
      setChatTitlePromptMenuOpen(false);
    }
  }, []);
  const closeSidebarTransientMenusOnScroll = useCallback((event: Event) => {
    const target = event.target;
    if (target === chatScrollRef.current) {
      return;
    }
    if (isChatHubInteractionSurface(target)) {
      return;
    }
    if (target instanceof Element && target.closest(SIDEBAR_TRANSIENT_MENU_SELECTOR)) {
      return;
    }
    closeSidebarTransientMenus();
  }, [closeSidebarTransientMenus]);
  useEffect(() => {
    window.addEventListener('scroll', closeSidebarTransientMenusOnScroll, true);
    return () => window.removeEventListener('scroll', closeSidebarTransientMenusOnScroll, true);
  }, [closeSidebarTransientMenusOnScroll]);
  useEffect(() => {
    const closeSidebarMenusOnOtherButton = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (isChatHubInteractionSurface(target)) {
        return;
      }
      if (target?.closest(SIDEBAR_TRANSIENT_MENU_SELECTOR)) {
        return;
      }
      if (target?.closest('button, [role="button"]')) {
        const keepOpen = target?.closest('.chat-hub-summary-button')
          ? 'hub'
          : target?.closest('.chat-title-project-button')
            ? 'project'
            : target?.closest('.chat-title-prompt-icon-button, .chat-title-session-button')
              ? 'prompt'
              : null;
        closeSidebarTransientMenus(keepOpen);
      }
    };
    window.addEventListener('pointerdown', closeSidebarMenusOnOtherButton, true);
    return () => window.removeEventListener('pointerdown', closeSidebarMenusOnOtherButton, true);
  }, [closeSidebarTransientMenus]);

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
      if (chatPromptHistoryHighlightTimerRef.current !== null) {
        window.clearTimeout(chatPromptHistoryHighlightTimerRef.current);
        chatPromptHistoryHighlightTimerRef.current = null;
      }
    };
  }, []);
  const cancelSessionSearch = useCallback(async (
    searchId = activeSessionSearchIdRef.current,
    projectItems = activeSessionSearchProjectItemsRef.current,
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
  }, []);

  const querySessionSearch = useCallback(async (
    searchId = activeSessionSearchIdRef.current,
  ): Promise<boolean> => {
    const normalizedSearchId = searchId.trim();
    if (!normalizedSearchId) {
      return false;
    }
    const doneSnapshot = sessionSearchDoneByProjectIdRef.current;
    const projectItems = activeSessionSearchProjectItemsRef.current;
    const pendingProjects = projectItems.filter(projectItem =>
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
  }, []);

  const clearSessionSearchState = useCallback(() => {
    activeSessionSearchIdRef.current = '';
    activeSessionSearchProjectItemsRef.current = [];
    setActiveSessionSearchId('');
    setSessionSearchQuery('');
    setSessionSearchProjectItems([]);
    setSearchResultsByProjectId({});
    setSessionSearchDoneByProjectId({});
    setSessionSearchErrorsByProjectId({});
    setPendingSessionSearchHandoff(null);
    sessionSearchUnchangedPollsRef.current = 0;
    if (sessionSearchPollTimerRef.current !== null) {
      window.clearTimeout(sessionSearchPollTimerRef.current);
      sessionSearchPollTimerRef.current = null;
    }
  }, []);

  const exitSessionSearch = useCallback(async () => {
    const searchId = activeSessionSearchIdRef.current;
    const projectItems = activeSessionSearchProjectItemsRef.current;
    clearSessionSearchState();
    setSessionSearchOpen(false);
    await cancelSessionSearch(searchId, projectItems);
  }, [cancelSessionSearch, clearSessionSearchState]);

  const startSessionSearch = useCallback(async () => {
    const query = sessionSearchInput.trim();
    if (!query) {
      return;
    }
    const previousSearchId = activeSessionSearchIdRef.current;
    const previousProjectItems = activeSessionSearchProjectItemsRef.current;
    const projectItems = resolveSessionSearchProjects(visibleProjectItems, sessionSearchProjectScope);
    if (projectItems.length === 0) {
      return;
    }
    sessionSearchIdCounterRef.current += 1;
    const searchId = `session-search-${Date.now()}-${sessionSearchIdCounterRef.current}`;
    activeSessionSearchIdRef.current = searchId;
    activeSessionSearchProjectItemsRef.current = projectItems;
    setActiveSessionSearchId(searchId);
    setSessionSearchQuery(query);
    setSessionSearchProjectItems(projectItems);
    setSearchResultsByProjectId({});
    setSessionSearchErrorsByProjectId({});
    setSessionSearchDoneByProjectId(
      Object.fromEntries(projectItems.map(projectItem => [projectItem.projectId, false])),
    );
    setPendingSessionSearchHandoff(null);
    sessionSearchUnchangedPollsRef.current = 0;
    setSessionSearchOpen(true);
    if (previousSearchId) {
      cancelSessionSearch(previousSearchId, previousProjectItems).catch(() => undefined);
    }

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
  }, [
    cancelSessionSearch,
    querySessionSearch,
    sessionSearchInput,
    sessionSearchProjectScope,
    visibleProjectItems,
  ]);

  useEffect(() => {
    if (!activeSessionSearchId) {
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
      const projectItems = activeSessionSearchProjectItemsRef.current;
      const allDone = projectItems.length > 0 &&
        projectItems.every(projectItem => doneSnapshot[projectItem.projectId] === true);
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
  }, [activeSessionSearchId, querySessionSearch]);
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
    releasePublishingOpenRef.current = releasePublishingOpen;
  }, [releasePublishingOpen]);
  useEffect(() => {
    portRelayScreenOpenRef.current = portRelayScreenOpen;
  }, [portRelayScreenOpen]);
  useEffect(() => {
    sharesScreenOpenRef.current = sharesScreenOpen;
  }, [sharesScreenOpen]);
  useEffect(() => {
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
  }, [connected, projectId]);

  useEffect(() => {
    const shouldHydrateProjectSessionIndex = isWide || (!isWide && drawerOpen);
    if (!shouldHydrateProjectSessionIndex || projects.length === 0) return;
    setProjectSessionsByProjectId(prev => {
      const next = {...prev};
      for (const projectItem of projects) {
        const cachedSessions = workspaceStore
          .hydrateChatSessions(projectItem.projectId)
          .map(entry => entry.session);
        const sortedCachedSessions = sortProjectChatSessions(cachedSessions);
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
  }, [isWide, drawerOpen, projectIdListKey]);

  useEffect(() => {
    if (!wideProjectActionMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (
        wideProjectActionMenuRef.current?.contains(target) ||
        chatTitleProjectMenuRef.current?.contains(target)
      )) {
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
    setChatComposerTop(rect ? Math.round(rect.top) : null);
  }, []);
  const shouldMeasureChatComposerLayout = !isWide;

  useLayoutEffect(() => {
    resizeChatComposerTextarea();
    if (shouldMeasureChatComposerLayout) {
      measureChatComposerTop();
    }
  }, [resizeChatComposerTextarea, measureChatComposerTop, chatComposerText, selectedChatId, currentChatDraftKey, shouldMeasureChatComposerLayout]);

  useEffect(() => {
    if (!shouldMeasureChatComposerLayout) {
      setChatComposerTop(null);
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
    forceChatScrollToBottom();
  }, [selectedChatId, forceChatScrollToBottom]);

  useEffect(() => {
    resizeChatComposerTextarea();
  }, [selectedChatId, chatMessages, chatPendingPromptsByKey, chatLoading, resizeChatComposerTextarea]);

  useEffect(() => {
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
  }, [chatKeyboardInset, scrollChatToBottom]);

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
    const nextFloatingHeight = floatingControlStackRef.current?.offsetHeight ?? FLOATING_NAV_BUTTON_SIZE_PX;
    setFloatingControlStackHeight(prev => (prev === nextFloatingHeight ? prev : nextFloatingHeight));
  }, [
    isWide,
    windowWidth,
    projectId,
    projects.length,
  ]);

  useEffect(() => {
    if (isWide) {
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
        visualViewportHeight: viewport.height,
        visualViewportOffsetTop: viewport.offsetTop,
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
  }, [isWide]);

  useLayoutEffect(() => {
    if (isWide || floatingKeyboardOffset > 0 || chatComposerTop === null) {
      return;
    }
    setFloatingDefaultComposerTop(current =>
      current === null || chatComposerTop > current
        ? chatComposerTop
        : current,
    );
  }, [chatComposerTop, floatingKeyboardOffset, isWide]);

  useEffect(() => {
    if (!isWide) {
      return;
    }
    if (gestureMoveLongPressTimerRef.current !== null) {
      window.clearTimeout(gestureMoveLongPressTimerRef.current);
      gestureMoveLongPressTimerRef.current = null;
    }
    floatingIgnoreLostCaptureRef.current = false;
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
      floatingIgnoreLostCaptureRef.current = false;
    },
    [],
  );

  useEffect(() => {
    const onPointer = () => {
      setProjectMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, []);

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
          chatTitleProjectButtonRef.current?.contains(target) ||
          wideProjectActionMenuRef.current?.contains(target))
      ) {
        return;
      }
      // While the agent popover is open, outside clicks are handled by the
      // popover's own dismiss; keep the dropdown mounted underneath.
      if (wideProjectActionMenuRef.current) {
        return;
      }
      setChatTitleProjectMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (wideProjectActionMenuRef.current) {
          setWideProjectActionMenu(null);
        } else {
          setChatTitleProjectMenuOpen(false);
        }
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
    if (!chatCoreConfigPanelOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && chatConfigOptionsRef.current?.contains(target)) return;
      closeChatCoreConfigMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeChatCoreConfigMenu(true);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [chatCoreConfigPanelOpen, closeChatCoreConfigMenu]);

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
    if (!chatHubMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const inHubInteractionSurface = isChatHubInteractionSurface(event.target);
      if (
        !chatHubMenuRef.current?.contains(target) &&
        !chatHubPopoverRef.current?.contains(target) &&
        !inHubInteractionSurface
      ) {
        setChatHubMenuOpen(false);
        setChatHubColorMenu(null);

        return;
      }
      if (!chatHubMenuRef.current?.contains(target) && !chatHubPopoverRef.current?.contains(target)) {
        return;
      }
      const targetElement = event.target instanceof Element ? event.target : null;
      if (
        chatHubColorMenuHubId &&
        targetElement &&
        !targetElement.closest('.chat-hub-color-palette') &&
        !targetElement.closest('.chat-hub-color-button')
      ) {
        setChatHubColorMenu(null);

      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setChatHubMenuOpen(false);
        setChatHubColorMenu(null);

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
    if (sidebarSettingsOpen) {
      setChatHubMenuOpen(false);
      setChatHubColorMenu(null);
    }
  }, [sidebarSettingsOpen]);

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
    setChatCoreConfigMenuOpen(false);
    setChatConfigOverflowOpen(false);
  }, [selectedChatEncodedKey, setChatConfigOverflowOpen]);

  useEffect(() => {
    if (chatConfigDisplay.status.coreOptions.length === 0) {
      setChatCoreConfigMenuOpen(false);
    }
  }, [chatConfigDisplay.status.coreOptions.length]);

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
      mobileEnterKeyBehavior,
      wrapLines,
      showLineNumbers,
      showMonitor,
      logLevel,
      promptCompletionNotificationsEnabled,
      keyboardShortcutOverrides,
      selectedProjectId: projectId,
      floatingControlYRatio,
      floatingControlSide,
      desktopSidebarWidth,
      chatColumnWidth,
      sessionPanelPinned: !sidebarCollapsed,
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
    mobileEnterKeyBehavior,
    wrapLines,
    showLineNumbers,
    showMonitor,
    logLevel,
    promptCompletionNotificationsEnabled,
    keyboardShortcutOverrides,
    projectId,
    floatingControlYRatio,
    floatingControlSide,
    desktopSidebarWidth,
    chatColumnWidth,
    sidebarCollapsed,
    collapsedProjectIds,
    pinnedProjectIds,
    hiddenProjectIds,
    expandedHubIds,
    hubColors,
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
  const closeMobileDrawerCompanionOverlays = useCallback(() => {
    setChatPromptMenuOpen(false);
    setChatFileMentionMenuOpen(false);
    setChatAttachmentTrayOpen(false);
    setChatConfigMenuOptionId('');
    setChatConfigOverflowOpen(false);
    setChatHubMenuOpen(false);
    setChatHubColorMenu(null);
    setChatTitleProjectMenuOpen(false);
    setChatTitlePromptMenuOpen(false);
  }, [setChatConfigOverflowOpen]);
  const renderChatHubSummary = () => {
    const hubIds = chatHubTreeItems.map(item => item.hubId);
    const hubCount = hubIds.length;
    const projectCount = projects.length;
    const chatHubSummaryLabel = `${hubCount} ${hubCount === 1 ? 'Hub' : 'Hubs'}`;
    const chatHubProjectLabel = `${projectCount} ${projectCount === 1 ? 'Project' : 'Projects'}`;
    return (
      <ChatHubMenu
        mobile={!isWide}
        open={chatHubMenuOpen}
        exiting={chatHubMenuExiting}
        summaryLabel={chatHubSummaryLabel}
        projectLabel={chatHubProjectLabel}
        activeProjectId={selectedChatKey?.projectId || projectId}
        hubIds={hubIds}
        treeItems={chatHubTreeItems}
        popoverStyle={chatHubPopoverStyle}
        menuRef={chatHubMenuRef}
        popoverRef={chatHubPopoverRef}
        onToggle={() => {
          setChatPromptMenuOpen(false);
          setChatFileMentionMenuOpen(false);
          setChatConfigMenuOptionId('');
          setChatConfigOverflowOpen(false);
          setChatHubColorMenu(null);
          setChatHubMenuOpen(open => !open);
        }}
        onClose={() => {
          setChatHubMenuOpen(false);
          setChatHubColorMenu(null);
        }}
        expandedHubIds={effectiveExpandedHubIds}
        onToggleHub={hubId => {
          const expanded = effectiveExpandedHubIds.includes(hubId);
          void hubRefreshTriggers.setHubExpanded(hubId, !expanded).catch(() => undefined);
          const next = expanded
            ? effectiveExpandedHubIds.filter(id => id !== hubId)
            : [...effectiveExpandedHubIds, hubId];
          setExpandedHubIds(next.length > 0 ? next : [HUB_TREE_EMPTY_EXPANDED_SENTINEL]);
        }}
        expandedSections={chatHubExpandedSections}
        onToggleSection={(hubId, section) => {
          setChatHubExpandedSections(current => ({
            ...current,
            [hubId]: toggleChatHubDetailSections(current[hubId] ?? [], section),
          }));
        }}
        hubColors={hubColors}
        setHubColors={setHubColors}
        hubAccentStyle={hubAccentStyle}
        colorMenuHubId={chatHubColorMenuHubId || null}
        colorMenuExiting={chatHubColorMenuExiting}
        onToggleColorMenu={hubId => setChatHubColorMenu(hubId ? {hubId} : null)}
        flickerStatuses={chatHubFlickerBridgeStatuses}
        flickerActionHubId={chatHubFlickerBridgeActionHubId}
        onFlickerSwitchMode={(hubId, mode) => void runChatHubFlickerBridgeAction(hubId, 'switchMode', {mode})}
        hubConfigByHubId={chatHubConfigByHubId}
        onUpdateHubConfig={updateChatHubConfig}
        opsByHubId={chatHubOpsByHubId}
        onRequestWheelMakerUpdate={handleChatHubWheelMakerUpdate}
        onRequestWheelMakerRestart={handleChatHubWheelMakerRestart}
        onRequestGatewayUpdate={handleChatHubGatewayUpdate}
        onRequestNpmUpdate={handleChatHubNpmUpdate}
        onPackageAction={handleChatHubPackageAction}
        onRequestSkillInstall={requestSkillInstall}
        onRequestSkillDetail={requestSkillDetail}
        onRefreshSkillSource={requestSkillSourceRefresh}
        onDeleteSkillSource={requestSkillSourceDelete}
        onInstallSourceSkill={requestSourceSkillInstall}
        onUpdateSourceSkill={requestSourceSkillUpdate}
        onUpdateSkillSources={requestSkillSourcesUpdate}
        onRequestSkillUninstall={requestSkillUninstall}
        onRetrySkills={hubId => {
          service.hubStore.refresh(hubId, ['skills'], true).catch(() => undefined);
        }}
        skillSurface={chatHubSkillSurfaceForMenu}
        skillSurfaceExiting={chatHubSkillSurfaceExiting}
        skillInstall={{
          sourceInput: skillSourceInput,
          onSourceInputChange: changeSkillSourceInput,
          sourceLoading: skillSourceLoading,
          sourceError: skillSourceError,
          preview: skillSourcePreview,
          requestedSkillNames: skillSourceRequestedNames,
          onPreview: previewSkillSourceInstall,
          onApply: requestSkillSourceApply,
        }}
        skillDetail={{
          entries: skillDetailCache,
          pendingKey: skillsPendingKey,
          onUninstall: requestSkillUninstall,
        }}
        onCloseSkillSurface={closeChatHubSkillSurface}
        onScanAllIndexes={handleChatHubScanAllIndexes}
        onScanProject={handleChatHubScanProject}
        hiddenProjectIdSet={hiddenProjectIdSet}
        onToggleProject={(projectId, visible) => {
          setHiddenProjectIds(current => toggleProjectVisibility(current, projectId, visible));
        }}
        latestVersion={wheelMakerPublicMetadata?.stable.version || '-'}
        updateAllAvailableCount={chatHubUpdateAllHubIds.length}
        updateAllPending={wheelMakerUpdateAllPending}
        onUpdateAllHubs={handleChatHubUpdateAllHubs}
      />
    );
  };
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
                    <SessionIcon
                      name="folder"
                      className={`wide-project-folder-icon chat-hidden-project-folder ${projectHubVariant}`}
                      style={hubAccentStyle(hubId)}
                    />
                  </span>
                  <span className="wide-project-title-group">
                    <span className="wide-project-name" data-tooltip={projectItem.name}>
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
                <div className="wide-project-actions">
                  <button
                    type="button"
                    className="wide-project-action-btn chat-hidden-project-restore-btn"
                    data-tooltip={`Show ${projectItem.name}`}
                    aria-label={`Show hidden project ${projectItem.name}`}
                    onClick={() => {
                      setHiddenProjectIds(current =>
                        toggleProjectVisibility(current, projectItem.projectId, true),
                      );
                    }}
                  >
                    <SessionIcon name="eye" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };
  const floatingNavCurrent = resolveFloatingNavCurrent({
    relayFrameOpen: mobilePortRelayFrameOpen,
    settingsOpen: sidebarSettingsOpen || releasePublishingOpen || portRelayScreenOpen || sharesScreenOpen,
    usageOpen: mobileUsageOpen,
    terminalOpen,
    previewOpen: chatPreviewOpen && !mobilePortRelayFrameOpen,
  });
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
      // The keyboard shrinks the dockable range; reserving expansion headroom
      // then would collapse it and shove the control downward.
      expandedOverflowPx: floatingKeyboardOffset > 0 ? 0 : FLOATING_NAV_EXPANDED_OVERFLOW_PX,
    });
  }, [
    floatingControlStackHeight,
    floatingDefaultComposerTop,
    floatingKeyboardOffset,
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
      reservedBottomInset: floatingControlSide === 'right'
        ? resolveFloatingNavReservedBottomInset(floatingNavCurrent, safeAreaBottomInset)
        : 0,
    });
  }, [
    chatComposerTop,
    floatingBaseBounds.maxTop,
    floatingBaseBounds.minTop,
    floatingControlStackHeight,
    floatingControlSide,
    floatingKeyboardOffset,
    floatingNavCurrent,
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
    if (floatingDragState) {
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
    if (isWide || floatingDragState) {
      floatingPositionSnapshotRef.current = null;
      return;
    }
    const previousFloatingPosition = floatingPositionSnapshotRef.current;
    const boundsChanged =
      previousFloatingPosition !== null &&
      (previousFloatingPosition.minTop !== floatingBaseBounds.minTop ||
        previousFloatingPosition.maxTop !== floatingBaseBounds.maxTop);
    if (boundsChanged && previousFloatingPosition) {
      const nextYRatio = resolveFloatingControlYRatioForBoundsChange({
        previousTop: previousFloatingPosition.top,
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
    };
  }, [
    floatingBaseBounds.maxTop,
    floatingBaseBounds.minTop,
    floatingDefaultComposerTop,
    floatingRestTop,
    floatingControlYRatio,
    floatingDragState,
    isWide,
    setFloatingControlYRatio,
  ]);
  const effectiveFloatingControlTop = floatingControlTop;
  const effectiveFloatingControlStackStyle = useMemo(
    () =>
      !isWide
        ? ({
            top: `${floatingDragState ? floatingDragState.startTop : effectiveFloatingControlTop}px`,
            transform: floatingDragState
              ? `translateY(${floatingDragState.currentTop - floatingDragState.startTop}px)`
              : undefined,
            scale: floatingDragState ? '1.06' : undefined,
          } as React.CSSProperties)
        : undefined,
    [effectiveFloatingControlTop, floatingDragState, isWide],
  );
  const floatingDragVisualState =
    floatingDragState !== null
      ? 'dragging'
      : gestureNavigationExpanded
        ? 'nav-open'
        : 'idle';
  const clearGestureMoveLongPressTimer = useCallback(() => {
    if (gestureMoveLongPressTimerRef.current !== null) {
      window.clearTimeout(gestureMoveLongPressTimerRef.current);
      gestureMoveLongPressTimerRef.current = null;
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
  const handleFloatingPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const current = floatingDragStateRef.current;
      if (!current || current.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      const deltaY = event.clientY - current.originY;
      const currentSide = floatingControlSideRef.current;
      const nextSide = resolveFloatingControlDragSide(
        currentSide,
        event.clientX,
        windowWidth,
      );
      if (nextSide !== currentSide) {
        floatingControlSideRef.current = nextSide;
        setFloatingControlSide(nextSide);
        closeMobileDrawerCompanionOverlays();
        triggerMobileHaptic();
        pulseFloatingControlSide(nextSide);
      }
      setFloatingDragState({
        ...current,
        currentTop: applyFloatingDragFriction(
          current.startTop + deltaY,
          floatingBounds.minTop,
          floatingBounds.maxTop,
        ),
      });
    },
    [
      closeMobileDrawerCompanionOverlays,
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
      floatingClickCooldownUntilRef.current = Date.now() + 120;
      setFloatingControlYRatio(nextYRatio);
      setFloatingControlSide(nextSide);
      workspaceStore.rememberGlobalState({ floatingControlYRatio: nextYRatio, floatingControlSide: nextSide });
      try {
        window.localStorage.setItem(PORT_RELAY_FLOATING_Y_RATIO_STORAGE_KEY, String(nextYRatio));
        window.localStorage.setItem(PORT_RELAY_FLOATING_SIDE_STORAGE_KEY, nextSide);
      } catch {
        // Ignore local storage failures in private or restricted contexts.
      }
      setFloatingDragState(null);
    },
    [
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
      floatingClickCooldownUntilRef.current = Date.now() + 120;
      setFloatingDragState(null);
    },
    [],
  );
  const openGestureNavigationActions = useCallback((openDrawer: boolean) => {
    clearGestureMoveLongPressTimer();
    const nextState: GestureNavigationState = {phase: 'expanded'};
    gestureNavStateRef.current = nextState;
    setGestureNavState(nextState);
    setDrawerOpen(openDrawer);
  }, [
    clearGestureMoveLongPressTimer,
    setDrawerOpen,
  ]);
  const handleGestureNavigationCurrentSelect = useCallback(() => {
    const shouldSuppressSyntheticClick =
      Date.now() <= gestureNavigationSuppressClickUntilRef.current;
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
    openGestureNavigationActions(shouldOpenDrawerWithFloatingNav(floatingNavCurrent));
  }, [
    clearGestureMoveLongPressTimer,
    gestureNavigationExpanded,
    floatingNavCurrent,
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
        if (!current || current.phase === 'expanded' || current.pointerId !== event.pointerId) {
          return;
        }
        if (!shouldStartGestureMove({
          elapsedMs: Date.now() - current.startedAt,
        })) {
          return;
        }
        gestureNavigationSuppressClickUntilRef.current = 0;
        gestureNavStateRef.current = null;
        setGestureNavState(null);
        closeMobileDrawerCompanionOverlays();
        setDrawerOpen(false);
        triggerMobileHaptic();
        setFloatingDragState({
          pointerId: current.pointerId,
          originY: current.currentY,
          startSide: floatingControlSide,
          startTop: floatingControlTop,
          currentTop: floatingControlTop,
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
    ],
  );
  const handleGestureNavigationPillPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
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
      if (!current || current.phase === 'expanded' || current.pointerId !== event.pointerId) {
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
      if (shouldCancelGestureClick({distancePx}) && current.phase !== 'neutral') {
        clearGestureMoveLongPressTimer();
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
    },
    [
      clearGestureMoveLongPressTimer,
      handleFloatingPointerMove,
    ],
  );
  const finishGestureNavigation = useCallback(
    (pointerId: number) => {
      const current = gestureNavStateRef.current;
      if (!current || current.phase === 'expanded' || current.pointerId !== pointerId) {
        return;
      }
      clearGestureMoveLongPressTimer();
      if (isIOSPlatform && current.phase === 'pressing') {
        // Commit a tap on pointerup instead of waiting for click. Mobile Safari
        // can omit the click that follows a captured pointer sequence, notably
        // while a long chat scroller is settling, which made the first tap only
        // stop scrolling. Ignore a click if the browser does emit one.
        gestureNavigationSuppressClickUntilRef.current =
          Date.now() + GESTURE_NAV_CANCELLED_CLICK_SUPPRESS_MS;
        openGestureNavigationActions(shouldOpenDrawerWithFloatingNav(floatingNavCurrent));
        return;
      }
      gestureNavStateRef.current = null;
      setGestureNavState(null);
    },
    [
      clearGestureMoveLongPressTimer,
      floatingNavCurrent,
      openGestureNavigationActions,
    ],
  );
  const cancelGestureNavigation = useCallback(
    (pointerId?: number) => {
      const current = gestureNavStateRef.current;
      if (typeof pointerId === 'number' && current && current.phase !== 'expanded' && current.pointerId !== pointerId) {
        return;
      }
      if (!current && gestureMoveLongPressTimerRef.current === null) {
        return;
      }
      clearGestureMoveLongPressTimer();
      gestureNavStateRef.current = null;
      gestureNavigationSuppressClickUntilRef.current = 0;
      setGestureNavState(null);
      floatingClickCooldownUntilRef.current = Date.now() + 120;
    },
    [clearGestureMoveLongPressTimer],
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
      if (
        target instanceof Element &&
        (
          floatingControlStackRef.current?.contains(target) ||
          target.closest(GESTURE_NAV_PRESERVED_SURFACE_SELECTOR)
        )
      ) {
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
    if (gestureNavigationExpanded && shouldOpenDrawerWithFloatingNav(floatingNavCurrent) && !drawerOpen) {
      cancelGestureNavigation();
    }
  }, [cancelGestureNavigation, drawerOpen, floatingNavCurrent, gestureNavigationExpanded]);
  const closeSettingsPanel = useCallback(() => {
    setSettingsDetailView(null);
    setSidebarSettingsOpen(false);
  }, [setSidebarSettingsOpen]);
  const openSettingsRoot = useCallback(() => {
    setReleasePublishingOpen(false);
    mobilePortRelayHistoryRef.current = false;
    setPortRelayScreenOpen(false);
    mobileSharesHistoryRef.current = false;
    setSharesScreenOpen(false);
    setShareSource(null);
    setSettingsDetailView(null);
    setSidebarSettingsOpen(true);
  }, [setSidebarSettingsOpen]);
  const openReleasePublishing = useCallback(() => {
    closeSettingsPanel();
    setDrawerOpen(false);
    mobilePortRelayHistoryRef.current = false;
    setPortRelayScreenOpen(false);
    mobileSharesHistoryRef.current = false;
    setSharesScreenOpen(false);
    setShareSource(null);
    setReleasePublishingOpen(true);
    if (!isWide && !mobileReleasePublishingHistoryRef.current) {
      window.history.pushState(
        createStandalonePageHistoryState('release-publish'),
        '',
        window.location.href,
      );
      mobileReleasePublishingHistoryRef.current = true;
    }
  }, [closeSettingsPanel, isWide, setDrawerOpen]);
  const closeReleasePublishing = useCallback(() => {
    if (!isWide && mobileReleasePublishingHistoryRef.current) {
      window.history.back();
      return;
    }
    mobileReleasePublishingHistoryRef.current = false;
    setReleasePublishingOpen(false);
  }, [isWide]);
  const openPortRelayScreen = useCallback(() => {
    closeSettingsPanel();
    setDrawerOpen(false);
    mobileReleasePublishingHistoryRef.current = false;
    setReleasePublishingOpen(false);
    mobileSharesHistoryRef.current = false;
    setSharesScreenOpen(false);
    setShareSource(null);
    setPortRelayError('');
    setPortRelayScreenOpen(true);
    if (!isWide && !mobilePortRelayHistoryRef.current) {
      window.history.pushState(
        createStandalonePageHistoryState('port-relay'),
        '',
        window.location.href,
      );
      mobilePortRelayHistoryRef.current = true;
    }
  }, [closeSettingsPanel, isWide, setDrawerOpen]);
  const closePortRelayScreen = useCallback(() => {
    if (!isWide && mobilePortRelayHistoryRef.current) {
      window.history.back();
      return;
    }
    mobilePortRelayHistoryRef.current = false;
    setPortRelayScreenOpen(false);
  }, [isWide]);
  const openShares = useCallback(() => {
    closeSettingsPanel();
    setDrawerOpen(false);
    mobileReleasePublishingHistoryRef.current = false;
    setReleasePublishingOpen(false);
    mobilePortRelayHistoryRef.current = false;
    setPortRelayScreenOpen(false);
    setSharesScreenOpen(true);
    if (!isWide && !mobileSharesHistoryRef.current) {
      window.history.pushState(
        createStandalonePageHistoryState('shares'),
        '',
        window.location.href,
      );
      mobileSharesHistoryRef.current = true;
    }
  }, [closeSettingsPanel, isWide, setDrawerOpen]);
  const openShareCreate = useCallback((nextSource: ShareManagerSource) => {
    closeSettingsPanel();
    setDrawerOpen(false);
    setShareSource(nextSource);
  }, [closeSettingsPanel, setDrawerOpen]);
  const closeShares = useCallback(() => {
    if (!isWide && mobileSharesHistoryRef.current) {
      window.history.back();
      return;
    }
    mobileSharesHistoryRef.current = false;
    setSharesScreenOpen(false);
  }, [isWide]);
  const openSettingsChild = useCallback((detail: SettingsDetail) => {
    setSidebarSettingsOpen(true);
    setSettingsDetailView(detail);
  }, [setSidebarSettingsOpen]);
  const handleDesktopSettingsSelect = useCallback(() => {
    if (sidebarSettingsOpen && settingsDetailView === null) {
      closeSettingsPanel();
      return;
    }
    openSettingsRoot();
  }, [closeSettingsPanel, openSettingsRoot, sidebarSettingsOpen, settingsDetailView]);
  useEffect(() => {
    if (!isWide && settingsDetailView === 'keyboardShortcuts') {
      setSettingsDetailView(null);
    }
  }, [isWide, settingsDetailView]);
  useEffect(() => {
    if (isWide || !sidebarSettingsOpen) {
      mobileSettingsHistoryKeyRef.current = null;
      return;
    }
    const nextKey = mobileSettingsHistoryKey(settingsDetailView as MobileSettingsHistoryDetail | null);
    const historyWriteAction = resolveMobileSettingsHistoryWriteAction({
      currentKey: mobileSettingsHistoryKeyRef.current,
      nextDetail: settingsDetailView as MobileSettingsHistoryDetail | null,
    });
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
  useEffect(() => {
    const handleReleasePublishingPopState = (event: PopStateEvent) => {
      if (
        !releasePublishingOpenRef.current
        || isStandalonePageHistoryState(event.state, 'release-publish')
      ) {
        return;
      }
      mobileReleasePublishingHistoryRef.current = false;
      setReleasePublishingOpen(false);
    };
    window.addEventListener('popstate', handleReleasePublishingPopState);
    return () => window.removeEventListener('popstate', handleReleasePublishingPopState);
  }, []);
  useEffect(() => {
    const handlePortRelayScreenPopState = (event: PopStateEvent) => {
      if (
        !portRelayScreenOpenRef.current
        || isStandalonePageHistoryState(event.state, 'port-relay')
      ) {
        return;
      }
      mobilePortRelayHistoryRef.current = false;
      setPortRelayScreenOpen(false);
    };
    window.addEventListener('popstate', handlePortRelayScreenPopState);
    return () => window.removeEventListener('popstate', handlePortRelayScreenPopState);
  }, []);
  useEffect(() => {
    const handleSharesPopState = (event: PopStateEvent) => {
      if (
        !sharesScreenOpenRef.current
        || isStandalonePageHistoryState(event.state, 'shares')
      ) {
        return;
      }
      mobileSharesHistoryRef.current = false;
      setSharesScreenOpen(false);
      setShareSource(null);
    };
    window.addEventListener('popstate', handleSharesPopState);
    return () => window.removeEventListener('popstate', handleSharesPopState);
  }, []);
  const handleMobileSettingsBackButton = useCallback(() => {
    if (!isWide && sidebarSettingsOpen && mobileSettingsHistoryKeyRef.current !== null) {
      window.history.back();
      return;
    }
    if (settingsPageKind(settingsDetailView) === 'detail') {
      setSettingsDetailView(null);
      return;
    }
    closeSettingsPanel();
  }, [closeSettingsPanel, isWide, sidebarSettingsOpen, settingsDetailView]);
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
  const hideChatPreviewSurface = useCallback(() => {
    setChatPreviewManualOpen(false);
    setChatPreviewManualCollapsed(true);
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
    if (shareSource) {
      setShareSource(null);
      return true;
    }
    if (!isWide && mobileUsageOpen) {
      setMobileUsageOpen(false);
      return true;
    }
    if (!isWide && terminalOpen) {
      setTerminalOpen(false);
      return true;
    }
    if (!isWide && chatPreviewOpen) {
      chatFilePeekHistoryActiveRef.current = false;
      closeChatPreview();
      return true;
    }
    if (!isWide && chatHubMenuOpen && chatHubSkillSurfaceOpen) {
      closeChatHubSkillSurface();
      return true;
    }
    if (!isWide && chatHubMenuOpen) {
      setChatHubMenuOpen(false);
      setChatHubColorMenu(null);
      return true;
    }
    if (!isWide && releasePublishingOpenRef.current) {
      closeReleasePublishing();
      return true;
    }
    if (!isWide && portRelayScreenOpenRef.current) {
      closePortRelayScreen();
      return true;
    }
    if (!isWide && sharesScreenOpenRef.current) {
      closeShares();
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
    setSettingsDetailView(null);
    if (currentKind !== 'detail') {
      setSidebarSettingsOpen(false);
    }
    return true;
  }, [chatHubMenuOpen, chatHubSkillSurfaceOpen, chatPreviewOpen, closeChatHubSkillSurface, closeChatPreview, closePortRelayScreen, closeReleasePublishing, closeShares, isWide, mobileUsageOpen, setSidebarSettingsOpen, shareSource, terminalOpen]);
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
  const desktopChatSessionPinned = isWide && !sidebarSettingsOpen && !chatSidebarCollapsed;
  const desktopLayoutSidebarWidth = desktopChatSessionPinned
    ? CHAT_SESSION_PANEL_WIDTH
    : effectiveDesktopSidebarWidth;
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
    const occupiedWidth = chatSidebarCollapsed ? 48 : desktopLayoutSidebarWidth + 48;
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
  }, [chatSidebarCollapsed, desktopLayoutSidebarWidth, windowWidth]);
  const fixedChatPreviewDefaultWidth = useMemo(() => {
    const occupiedWidth = chatSidebarCollapsed ? 48 : desktopLayoutSidebarWidth + 48;
    const availableWidth = windowWidth > 0
      ? windowWidth - occupiedWidth
      : chatColumnWidth + CHAT_FILE_PEEK_WIDTH_DEFAULT;
    return clampChatFilePeekWidthForViewport(
      availableWidth - chatColumnWidth,
      true,
    );
  }, [chatColumnWidth, chatSidebarCollapsed, clampChatFilePeekWidthForViewport, desktopLayoutSidebarWidth, windowWidth]);
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
    (projectItem: RegistryProject, sessions: RegistryChatSession[]): string[] =>
      buildProjectAgentChoices(projectItem, sessions),
    [],
  );
  const toggleWideProjectCollapsed = useCallback(
    (targetProjectId: string) => {
      closeSidebarTransientMenus();
      setCollapsedProjectIds(current =>
        current.includes(targetProjectId)
          ? current.filter(item => item !== targetProjectId)
          : [...current, targetProjectId],
      );
    },
    [closeSidebarTransientMenus, setCollapsedProjectIds],
  );
  const togglePinnedProject = useCallback(
    (targetProjectId: string) => {
      setPinnedProjectIds(current => togglePinnedProjectId(current, targetProjectId));
    },
    [setPinnedProjectIds],
  );
  const resetProjectResumeState = useCallback(() => {
    setResumeSessions([]);
    setResumeLoading(false);
  }, []);
  const openMobileProjectActionMenu = useCallback((
    targetProjectId: string,
    kind: 'new' | 'resume' | 'actions',
  ) => {
    closeSidebarTransientMenus();
    resetProjectResumeState();
    setMobileProjectActionMenu(current => {
      if (current?.projectId === targetProjectId && current.kind === kind) {
        return null;
      }
      if (kind === 'actions') {
        return {
          projectId: targetProjectId,
          kind: 'actions',
          phase: 'actions',
          agentType: '',
          popover: null,
        };
      }
      return {
        projectId: targetProjectId,
        kind,
        phase: 'agents',
        agentType: '',
        popover: null,
      };
    });
  }, [closeSidebarTransientMenus, resetProjectResumeState]);
  const projectSessionActionKey = (targetProjectId: string, sessionId: string) =>
    `${targetProjectId}:${sessionId}`;
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
  const openProjectSessionContextMenu = useCallback((
    targetProjectId: string,
    sessionId: string,
    position: {x: number; y: number},
  ) => {
    closeSidebarTransientMenus();
    const normalizedSessionId = sessionId.trim();
    if (!targetProjectId || !normalizedSessionId) {
      return;
    }
    setProjectSessionActionMenu({
      projectId: targetProjectId,
      sessionId: normalizedSessionId,
      popover: isWide
        ? resolveWideProjectActionPopoverPlacement({
            anchorRect: {
              left: position.x,
              top: position.y,
              bottom: position.y,
              right: position.x,
            },
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            preferredWidth: 224,
            preferredMaxHeight: 320,
            align: 'start',
          })
        : null,
    });
  }, [closeSidebarTransientMenus, isWide, setProjectSessionActionMenu]);
  projectsRef.current = projects;
  terminalSyncRef.current = terminalSync;
  activeTerminalKeyRef.current = activeTerminalKey;
  previewWorkbenchRef.current = previewWorkbench;
  chatFilePeekRef.current = chatFilePeek;

  useEffect(() => {
    workspaceStore.rememberGlobalState({previewWorkbenchSnapshot: previewWorkbenchSnapshotFromState(previewWorkbench)});
  }, [previewWorkbench]);

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

  useEffect(() => {
    setPreviewFileTreeSearchActiveIndex(current =>
      previewFileTreeSearchVisibleResults.length === 0
        ? 0
        : Math.min(current, previewFileTreeSearchVisibleResults.length - 1),
    );
  }, [previewFileTreeSearchVisibleResults.length]);

  const applyHydratedProjectState = (
    hydrated: {projectId: string},
    options?: {keepMobileDrawerOpen?: boolean},
  ) => {
    projectIdRef.current = hydrated.projectId;
    setProjectId(hydrated.projectId);
    setProjectMenuOpen(false);
    setWorkspaceProjectMenuOpen(false);
    setSidebarSettingsOpen(false);
    if (!isWide && options?.keepMobileDrawerOpen !== true) setDrawerOpen(false);
  };

  useEffect(
    () => () => {
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

  useEffect(() => {
    if (!chatFilePeek || chatFilePeek.loading || chatFilePeek.error || !chatFilePeek.targetLine) return;
    const targetLine = chatFilePeek.targetLine;
    const targetPath = chatFilePeek.path;
    const targetContent = chatFilePeek.content;
    const isHtmlPreview = isHtmlPreviewPath(targetPath);
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


  const loadPreviewDirectory = async (projectId: string, path: string) => {
    const targetProjectId = projectId;
    if (!targetProjectId) return;
    const loadKey = fileMemoryCacheKey(targetProjectId, path);
    if (previewDirectoryLoadKeysRef.current.has(loadKey)) return;
    previewDirectoryLoadKeysRef.current.add(loadKey);
    setChatFilePreviewDirErrorsByProject(prev => ({
      ...prev,
      [targetProjectId]: {...(prev[targetProjectId] ?? {}), [path]: ''},
    }));
    setChatFilePreviewLoadingDirsByProject(prev => ({
      ...prev,
      [targetProjectId]: {...(prev[targetProjectId] ?? {}), [path]: true},
    }));
    try {
      const persistedCache = workspaceStore.getCachedDirectory(targetProjectId, path);
      const cachedEntries = persistedCache?.entries;
      const knownHash = cachedEntries
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
      if (nextHash) {
        dirHashRef.current[loadKey] = nextHash;
      }
      workspaceStore.cacheDirectory(targetProjectId, path, nextHash, entries);
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
    if (previewWorkbench.drawerMode !== 'files') return;
    const targetProjectId = previewWorkbench.activeProjectId;
    if (!targetProjectId) return;
    if (chatFilePreviewDirEntriesByProject[targetProjectId]?.['.']) return;
    loadPreviewDirectory(targetProjectId, '.').catch(() => undefined);
  }, [
    previewWorkbench.activeProjectId,
    previewWorkbench.drawerMode,
    chatFilePreviewDirEntriesByProject,
  ]);

  const retryPreviewRootDirectory = () => {
    const targetProjectId = previewWorkbench.activeProjectId;
    if (!targetProjectId) return;
    loadPreviewDirectory(targetProjectId, '.').catch(() => undefined);
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
      const external = isAbsolutePreviewFilePath(path);
      const info = external
        ? await service.getExternalFileInfo(targetProjectId, path, {signal: controller.signal})
        : await service.getProjectFileInfo(targetProjectId, path, {signal: controller.signal});
      if (isHtmlPreviewPath(path)) {
        setPreviewWorkbench(current =>
          updatePreviewTabAfterLoad(
            current,
            targetProjectId,
            tabId,
            requestSeq,
            tab =>
              tab.type === 'file'
                ? {...tab, info, content: '', loading: false, error: '', targetLine: null}
                : tab,
          ),
        );
        return;
      }
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
      const result = external
        ? await service.readExternalFile(targetProjectId, path, {signal: controller.signal})
        : await service.readProjectFile(path, targetProjectId, {signal: controller.signal});
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

  const openGitDiffPreview = useCallback((
    targetProjectId: string,
    source: GitDiffSource,
    file: GitDiffFileMeta,
  ) => {
    if (!targetProjectId) return;
    setChatPreviewManualOpen(false);
    setChatPreviewManualCollapsed(false);
    const tabId = previewTabId({type: 'git-diff', source});
    const snapshot = gitBrowserStore.snapshot()[targetProjectId] ?? gitBrowserStore.project(targetProjectId);
    const commitFiles = source.kind === 'commit'
      ? snapshot.commitFilesBySha[source.sha] ?? []
      : [];
    const files: GitDiffFileMeta[] = source.kind === 'commit' && commitFiles.length > 0
      ? commitFiles.map(item => ({
          path: item.path,
          status: item.status,
          additions: item.additions,
          deletions: item.deletions,
        }))
      : [{path: file.path, status: file.status, additions: file.additions, deletions: file.deletions}];
    const title = source.kind === 'commit'
      ? snapshot.commits.find(commit => commit.sha === source.sha)?.title || source.sha.slice(0, 8)
      : file.path.split('/').pop() || file.path;
    setPreviewWorkbench(current => {
      const opened = openPreviewTab(current, {
        type: 'git-diff',
        projectId: targetProjectId,
        title,
        source,
        files,
        activeFilePath: source.path,
      });
      return updatePreviewTab(opened, targetProjectId, tabId, tab =>
        tab.type === 'git-diff' && tab.error
          ? {...tab, error: '', requestId: 0}
          : tab,
      );
    });
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
        const external = isAbsolutePreviewFilePath(tab.path);
        const info = external
          ? await service.getExternalFileInfo(tab.projectId, tab.path, {signal: controller.signal})
          : await service.getProjectFileInfo(tab.projectId, tab.path, {signal: controller.signal});
        if (isHtmlPreviewPath(tab.path)) {
          setPreviewWorkbench(current =>
            updatePreviewTabAfterLoad(
              current,
              tab.projectId,
              tab.id,
              requestSeq,
              currentTab =>
                currentTab.type === 'file'
                  ? {
                      ...currentTab,
                      info,
                      content: '',
                      loading: false,
                      error: '',
                      targetLine: null,
                    }
                  : currentTab,
            ),
          );
          return;
        }
        const result = external
          ? await service.readExternalFile(tab.projectId, tab.path, {signal: controller.signal})
          : await service.readProjectFile(tab.path, tab.projectId, {signal: controller.signal});
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
    if (tab.type === 'git-diff') {
      const projectGitSnapshot = gitBrowserStore.project(tab.projectId);
      if (!projectGitSnapshot.available || !projectGitSnapshot.online || tab.loading) {
        return;
      }
      if (
        tab.requestId > 0
        && !tab.error
        && (
          tab.source.kind === 'commit'
          || tab.loadedWorktreeRev === projectGitSnapshot.worktreeRev
        )
      ) {
        return;
      }
      if (tab.error && tab.requestId > 0) {
        return;
      }
      const requestSeq = gitDiffReadSeqRef.current + 1;
      gitDiffReadSeqRef.current = requestSeq;
      setPreviewWorkbench(current => beginPreviewTabLoad(current, tab.projectId, tab.id, requestSeq));
      try {
        const result = tab.source.kind === 'commit'
          ? await service.readProjectGitCommitDiff(tab.projectId, tab.source.sha)
          : await service.readProjectWorkingTreeFileDiff(
            tab.projectId,
            tab.source.path,
            tab.source.scope,
          );
        if (tab.source.kind === 'commit') {
          const commitResult = result as RegistryGitCommitDiff;
          const diffByPath = new Map(
            splitUnifiedDiffFileBlocks(commitResult.diff).map(block => [block.path, block.diff]),
          );
          setPreviewWorkbench(current =>
            updatePreviewTabAfterLoad(current, tab.projectId, tab.id, requestSeq, currentTab =>
              currentTab.type === 'git-diff'
                ? {
                  ...currentTab,
                  files: currentTab.files.map(file => {
                    const fileDiff = diffByPath.get(file.path) ?? '';
                    return {
                      ...file,
                      diff: fileDiff,
                      expanded: file.expanded,
                      isBinary: fileDiff.includes('Binary files'),
                      truncated: false,
                    };
                  }),
                  loading: false,
                  error: '',
                }
                : currentTab,
            ),
          );
        } else {
          const worktreeResult = result as RegistryWorkingTreeFileDiff;
          setPreviewWorkbench(current =>
            updatePreviewTabAfterLoad(current, tab.projectId, tab.id, requestSeq, currentTab =>
              currentTab.type === 'git-diff'
                ? {
                  ...currentTab,
                  files: currentTab.files.map(file =>
                    file.path === worktreeResult.path
                      ? {
                        ...file,
                        diff: worktreeResult.diff,
                        expanded: true,
                        isBinary: worktreeResult.isBinary,
                        truncated: worktreeResult.truncated,
                      }
                      : file,
                  ),
                  loadedWorktreeRev: projectGitSnapshot.worktreeRev,
                  loading: false,
                  error: '',
                }
                : currentTab,
            ),
          );
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        setPreviewWorkbench(current =>
          failPreviewTabLoad(
            current,
            tab.projectId,
            tab.id,
            requestSeq,
            `Failed to load Git diff: ${reason}`,
          ),
        );
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
                  activeFilePath: resolvePromptDiffActiveFilePath(files, currentTab.activeFilePath),
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
      if (attachmentHTMLPreviewSource(tab)) {
        return;
      }
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
    if (!restoredActiveTab || restoredActiveTab.type === 'git-diff') {
      return;
    }
    loadRestoredPreviewTab(restoredActiveTab).catch(() => undefined);
  }, [connected, loadRestoredPreviewTab, previewWorkbench]);

  useEffect(() => {
    const activeTab = activePreviewTab(previewWorkbench);
    if (!connected || activeTab?.type !== 'git-diff') return;
    const gitDiffNeedsLoad = activeTab.source.kind === 'commit'
      ? activeTab.requestId === 0
      : activeTab.source.kind === 'worktree'
        && activeTab.loadedWorktreeRev !== previewGitSnapshot.worktreeRev;
    if (!gitDiffNeedsLoad || activeTab.loading || activeTab.error) return;
    void loadRestoredPreviewTab(activeTab);
  }, [
    connected,
    loadRestoredPreviewTab,
    previewGitSnapshot.worktreeRev,
    previewWorkbench,
  ]);

  useEffect(() => {
    const activeTab = activePreviewTab(previewWorkbench);
    if (activeTab?.type !== 'git-diff' || activeTab.source.kind !== 'commit' || activeTab.loading) {
      return;
    }
    const container = chatFilePeekScrollRef.current;
    if (!container) {
      return;
    }
    const section = Array.from(
      container.querySelectorAll<HTMLElement>('[data-preview-diff-path]'),
    ).find(node => node.dataset.previewDiffPath === activeTab.activeFilePath);
    section?.scrollIntoView({block: 'start'});
  }, [previewWorkbench]);

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
    const htmlAttachment = isHtmlPreviewAttachment(title, block.mimeType || '');
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
      if (!chatFilePeekHistoryActiveRef.current) {
        window.history.pushState(createChatFilePeekHistoryState(), '', window.location.href);
        chatFilePeekHistoryActiveRef.current = true;
      }
    }
    if (initialSrc) {
      return;
    }
    if (htmlAttachment) {
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
        updatePreviewDrawerMode('closed');
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
    if (isWide && previewWorkbench.drawerMode === 'files') {
      focusPreviewFileTreeSearch();
    } else {
      resetPreviewFileTreeSearchSession();
    }
  }, [focusPreviewFileTreeSearch, isWide, previewWorkbench.drawerMode, resetPreviewFileTreeSearchSession]);

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
      sortProjectChatSessions(sessionRows),
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
      <span className={`session-state-marker ${state}`} data-tooltip={title}>
        {state === 'running' || state === 'completed-unviewed' || state === 'failed-unviewed' ? (
          <span className="session-state-dot" />
        ) : null}
      </span>
    );
  };

  const renderSessionLeadingState = (session: RegistryChatSession, targetProjectId: string) => {
    const pendingPermissionCount = Math.max(0, Math.trunc(session.pendingPermissionCount ?? 0));
    if (pendingPermissionCount > 0) {
      return (
        <span
          className="session-state-leading permission-pending"
          data-tooltip={`${pendingPermissionCount} decision${pendingPermissionCount === 1 ? '' : 's'} waiting`}
          aria-label={`${pendingPermissionCount} decision${pendingPermissionCount === 1 ? '' : 's'} waiting`}
        >
          <SessionIcon name="help" />
          {pendingPermissionCount > 1 ? (
            <span className="session-permission-count" aria-hidden="true">
              {pendingPermissionCount > 9 ? '9+' : pendingPermissionCount}
            </span>
          ) : null}
        </span>
      );
    }
    const state = resolveSessionVisualState(session, targetProjectId);
    if (state !== 'running' && state !== 'completed-unviewed' && state !== 'failed-unviewed') {
      return null;
    }
    const title =
      state === 'running'
        ? 'In progress'
        : state === 'failed-unviewed'
          ? 'Failed, click to view'
          : 'Completed, click to view';
    return (
      <span className={`session-state-leading ${state}`} data-tooltip={title}>
        {state === 'running' ? (
          <SessionIcon name="loader" size={12} spin />
        ) : (
          <span className="session-state-dot" />
        )}
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
    readOptions: RegistrySessionReadOptions = {},
    onCacheReset?: () => void,
  ): Promise<{result: Awaited<ReturnType<typeof service.readProjectSession>>; appliedAfterTurnIndex: number}> => {
    const checkpoint = Math.max(0, Math.trunc(afterTurnIndex));
    const result = await service.readProjectSession(activeProjectId, sessionId, checkpoint, readOptions);
    if (!isStaleSessionReadResult(checkpoint, result.latestTurnIndex)) {
      return {result, appliedAfterTurnIndex: checkpoint};
    }
    const {onPage, ...repairReadOptions} = readOptions;
    const repairedResult = await service.readProjectSession(activeProjectId, sessionId, 0, repairReadOptions);
    clearProjectSessionCache(activeProjectId, sessionId);
    onCacheReset?.();
    const throughTurnIndex = repairedResult.turns.reduce(
      (latest, turn) => Math.max(latest, turn.turnIndex),
      0,
    );
    if (throughTurnIndex > 0) {
      await onPage?.({
        ...repairedResult,
        afterTurnIndex: 0,
        throughTurnIndex,
      });
    }
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
    // Draft sessions are frontend-only placeholders; the backend has no
    // session data for them until session.create resolves a real id.
    if (isDraftChatSessionId(sessionId)) return false;
    const runtimeKey = buildChatRuntimeKey(activeProjectId, sessionId);
    const permissionReadEpoch = markPermissionReadPending(runtimeKey);
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
      let turnsAtReadStart = buildMergedRawTurns(turnState);
      const selectionSnapshot = options?.selectionSnapshot ?? '';
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
          {
            onPage: page => {
              const pageSessionId = page.sessionId || page.session?.sessionId || sessionId;
              const pageRuntimeKey = buildChatRuntimeKey(activeProjectId, pageSessionId);
              const pageTurnState = ensureChatTurnStore(pageRuntimeKey);
              applySessionReadResult(
                pageTurnState,
                page.afterTurnIndex,
                page.turns,
                page.throughTurnIndex,
                turnsAtReadStart,
              );
              const pageMessages = messagesFromTurnStore(pageRuntimeKey, pageSessionId);
              chatMessageStoreRef.current[pageRuntimeKey] = pageMessages;
              chatFinishedCursorRef.current[pageRuntimeKey] = pageTurnState.cursor.turnIndex;
              markChatSessionTurnsDirty(pageRuntimeKey);
              if (encodeChatSessionKey(selectedChatKeyRef.current) === pageRuntimeKey) {
                setVisibleChatMessagesForRuntimeKey(
                  pageRuntimeKey,
                  pageMessages,
                  resolveChatSessionReadWindowUpdate({
                    useIncremental: page.afterTurnIndex > 0,
                    followsLatest: chatAutoScrollFollowRef.current,
                    revealTurnIndex,
                  }),
                );
              }
            },
          },
          () => {
            turnsAtReadStart = [];
          },
        );
      } catch (err) {
        await chatDurablePersistQueueRef.current.flush(runtimeKey);
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
      if (
        options?.preserveUserSelection &&
        !shouldApplyPreservedChatLoad(selectedChatKeyRef.current, selectionSnapshot)
      ) {
        return false;
      }
      const resultSessionId = result.sessionId || result.session?.sessionId || sessionId;
      const resultRuntimeKey = buildChatRuntimeKey(activeProjectId, resultSessionId);
      const resultTurnState = ensureChatTurnStore(resultRuntimeKey);
      const nextMessages = messagesFromTurnStore(resultRuntimeKey, resultSessionId);
      forgetPendingPromptIfResolved(resultRuntimeKey, nextMessages);

      chatMessageStoreRef.current[resultRuntimeKey] = nextMessages;
      const latestSyncCursor = resultTurnState.cursor;
      chatFinishedCursorRef.current[resultRuntimeKey] = latestSyncCursor.turnIndex;
      const resultSession = result.session;
      if (resultSession) {
        applySessionQueueProjection(activeProjectId, resultSession);
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
      markPermissionReadReady(resultRuntimeKey, permissionReadEpoch);
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
    const permissionReadEpoch = markPermissionReadPending(runtimeKey);
    try {
      const turnState = ensureChatTurnStore(runtimeKey);
      const checkpointTurnIndex = turnState.cursor.turnIndex;
      let turnsAtReadStart = buildMergedRawTurns(turnState);
      const {result} = await readProjectSessionWithStaleCacheRepair(
        activeProjectId,
        sessionId,
        checkpointTurnIndex,
        {
          onPage: page => {
            const pageSessionId = page.sessionId || page.session?.sessionId || sessionId;
            const pageRuntimeKey = buildChatRuntimeKey(activeProjectId, pageSessionId);
            const pageTurnState = ensureChatTurnStore(pageRuntimeKey);
            applySessionReadResult(
              pageTurnState,
              page.afterTurnIndex,
              page.turns,
              page.throughTurnIndex,
              turnsAtReadStart,
            );
            const pageMessages = messagesFromTurnStore(pageRuntimeKey, pageSessionId);
            chatMessageStoreRef.current[pageRuntimeKey] = pageMessages;
            chatFinishedCursorRef.current[pageRuntimeKey] = pageTurnState.cursor.turnIndex;
            markChatSessionTurnsDirty(pageRuntimeKey);
            if (encodeChatSessionKey(selectedChatKeyRef.current) === pageRuntimeKey) {
              setVisibleChatMessagesForRuntimeKey(pageRuntimeKey, pageMessages);
            }
          },
        },
        () => {
          turnsAtReadStart = [];
        },
      );
      if (!shouldApplyPreservedChatLoad(selectedChatKeyRef.current, selectionSnapshot)) {
        return false;
      }
      const resultSessionId = result.sessionId || result.session?.sessionId || sessionId;
      const resultRuntimeKey = buildChatRuntimeKey(activeProjectId, resultSessionId);
      const resultTurnState = ensureChatTurnStore(resultRuntimeKey);
      const nextMessages = messagesFromTurnStore(resultRuntimeKey, resultSessionId);
      forgetPendingPromptIfResolved(resultRuntimeKey, nextMessages);

      chatMessageStoreRef.current[resultRuntimeKey] = nextMessages;
      const latestSyncCursor = resultTurnState.cursor;
      chatFinishedCursorRef.current[resultRuntimeKey] = latestSyncCursor.turnIndex;
      const resultSession = result.session;
      if (resultSession) {
        applySessionQueueProjection(activeProjectId, resultSession);
        setProjectSessionsByProjectId(prev => mergeProjectSessionMap(prev, activeProjectId, resultSession));
        if (activeProjectId === projectIdRef.current) {
          setChatSessions(prev => mergeChatSession(prev, resultSession));
        }
      }
      if (encodeChatSessionKey(selectedChatKeyRef.current) === resultRuntimeKey) {
        setVisibleChatMessagesForRuntimeKey(resultRuntimeKey, nextMessages);
      }
      markPermissionReadReady(resultRuntimeKey, permissionReadEpoch);
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
    const runtimeKeys = reconnectSessionRuntimeKeys(selectedRuntimeKey);

    await Promise.all(runtimeKeys.map(runtimeKey => {
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
      const listedSessions = sortProjectChatSessions(await service.listProjectSessions(activeProjectId));
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

  const resetSelectedChatLoadRetry = (runtimeKey: string) => {
    delete chatSelectedLoadFailureCountRef.current[runtimeKey];
    if (chatSelectedLoadRetryTimerRef.current !== null) {
      window.clearTimeout(chatSelectedLoadRetryTimerRef.current);
      chatSelectedLoadRetryTimerRef.current = null;
    }
    // Intentionally do NOT clear chatSelectedLoadAttemptRuntimeKeyRef here.
    // A successful read must keep the marker so that an empty session (zero
    // messages, zero cache) still resolves to the 'none' recovery branch via
    // `attemptedRuntimeKey === selectedRuntimeKey`. Clearing it here made the
    // recovery effect re-issue read-session on every chatLoading flip, which
    // looped forever for empty sessions and flickered the panel. The
    // failure-retry path (scheduleSelectedChatLoadRetry) still clears it.
  };

  const scheduleSelectedChatLoadRetry = (runtimeKey: string) => {
    const failureCount = (chatSelectedLoadFailureCountRef.current[runtimeKey] ?? 0) + 1;
    chatSelectedLoadFailureCountRef.current[runtimeKey] = failureCount;
    if (chatSelectedLoadRetryTimerRef.current !== null) {
      window.clearTimeout(chatSelectedLoadRetryTimerRef.current);
    }
    chatSelectedLoadRetryTimerRef.current = window.setTimeout(() => {
      chatSelectedLoadRetryTimerRef.current = null;
      if (chatSelectedLoadAttemptRuntimeKeyRef.current === runtimeKey) {
        chatSelectedLoadAttemptRuntimeKeyRef.current = '';
      }
      setChatSelectedLoadRetryTick(value => value + 1);
    }, selectedChatReadRetryDelay(failureCount));
  };

  useEffect(() => () => {
    if (chatSelectedLoadRetryTimerRef.current !== null) {
      window.clearTimeout(chatSelectedLoadRetryTimerRef.current);
      chatSelectedLoadRetryTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const selectedKey = selectedChatKeyRef.current;
    const runtimeKey = encodeChatSessionKey(selectedKey);
    if (!selectedKey || !runtimeKey) {
      return;
    }
    if (!connected || chatLoading) {
      return;
    }
    const shouldInspectCache =
      chatVisibleRuntimeKeyRef.current !== runtimeKey ||
      chatMessagesRef.current.length === 0;
    const cachedMessages = shouldInspectCache
      ? hydrateChatSessionContentFromCache(selectedKey.sessionId, selectedKey.projectId)
      : [];
    if (
      chatVisibleRuntimeKeyRef.current === runtimeKey &&
      chatMessagesRef.current.length > 0
    ) {
      resetSelectedChatLoadRetry(runtimeKey);
    }
    const selectedVisibilityRecovery = resolveSelectedChatVisibilityRecovery({
      tab: 'chat',
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
        if (loaded) {
          resetSelectedChatLoadRetry(runtimeKey);
        } else {
          scheduleSelectedChatLoadRetry(runtimeKey);
        }
      }).catch(() => {
        scheduleSelectedChatLoadRetry(runtimeKey);
      });
    }
  }, [
    connected,
    selectedChatEncodedKey,
    chatMessages.length,
    chatLoading,
    chatSelectedLoadRetryTick,
    setVisibleChatMessagesForRuntimeKey,
  ]);
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

  const applySessionQueueProjection = useCallback((
    targetProjectId: string,
    session: RegistrySessionSummary | undefined,
  ) => {
    if (!session?.sessionId) return;
    const incoming = fullQueueSnapshot(session.queue);
    if (!incoming) return;
    const runtimeKey = buildChatRuntimeKey(targetProjectId, session.sessionId);
    setChatSessionQueuesByKey(current => {
      const merged = mergeChatSessionQueueProjection(current[runtimeKey], incoming);
      if (!merged || merged === current[runtimeKey]) return current;
      const next = {...current, [runtimeKey]: merged};
      chatSessionQueuesByKeyRef.current = next;
      return next;
    });
    const pending = chatPendingPromptsByKeyRef.current[runtimeKey];
    const acceptedIds = new Set([
      incoming.activeItem?.itemId,
      ...(incoming.waitingItems ?? []).map(item => item.itemId),
    ].filter((itemId): itemId is string => !!itemId));
    if (pending && acceptedIds.has(pending.itemId)) {
      forgetPendingChatPrompt(runtimeKey);
    }
  }, []);

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

  const requestSessionCompaction = async (
    targetProjectId: string,
    sessionId: string,
  ) => {
    try {
      const result = await service.enqueueProjectSessionItem(targetProjectId, sessionId, {
        itemId: makeSessionQueueItemID(),
        kind: 'compact',
        createdAt: new Date().toISOString(),
      });
      if (!result.ok) {
        throw new Error('session.queue enqueue returned ok=false');
      }
      applySessionQueueProjection(targetProjectId, result.session);
    } catch (errorValue) {
      const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
      setToastMessage(`Context compaction failed: ${message}`);
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
    setChatSubmittingForRuntimeKey(runtimeKey, true);
    try {
      await requestSessionCompaction(selectedKey.projectId, selectedKey.sessionId);
      setToastMessage('Context compaction queued.');
    } finally {
      setChatSubmittingForRuntimeKey(runtimeKey, false);
    }
  }

  const mutateQueuedPrompt = useCallback(async (
    projectId: string,
    runtimeKey: string,
    itemId: string,
    action: 'cancel' | 'prioritize' | 'steer',
  ) => {
    const key = decodeChatSessionKey(runtimeKey);
    if (!key?.sessionId) return;
    try {
      const result = action === 'cancel'
        ? await service.cancelProjectSessionQueueItem(projectId, key.sessionId, itemId)
        : action === 'prioritize'
          ? await service.prioritizeProjectSessionQueueItem(projectId, key.sessionId, itemId)
          : await service.steerProjectSessionQueueItem(projectId, key.sessionId, itemId);
      if (!result.ok) {
        throw new Error(`session.queue ${action} returned ok=false`);
      }
      applySessionQueueProjection(projectId, result.session);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
    }
  }, [applySessionQueueProjection, service]);

  const cancelQueuedPrompt = useCallback((projectId: string, runtimeKey: string, itemId: string) => {
    mutateQueuedPrompt(projectId, runtimeKey, itemId, 'cancel').catch(() => undefined);
  }, [mutateQueuedPrompt]);

  const prioritizeQueuedPrompt = useCallback((projectId: string, runtimeKey: string, itemId: string) => {
    mutateQueuedPrompt(projectId, runtimeKey, itemId, 'prioritize').catch(() => undefined);
  }, [mutateQueuedPrompt]);

  const steerQueuedPrompt = useCallback((projectId: string, runtimeKey: string, itemId: string) => {
    mutateQueuedPrompt(projectId, runtimeKey, itemId, 'steer').catch(() => undefined);
  }, [mutateQueuedPrompt]);

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

  const openWideProjectActionMenu = (
    targetProjectId: string,
    kind: 'new' | 'resume',
    anchor: HTMLElement | null,
  ) => {
    closeSidebarTransientMenus();
    resetProjectResumeState();
    setWideProjectActionMenu({
      projectId: targetProjectId,
      kind,
      phase: 'agents',
      agentType: '',
      popover: resolveWideProjectActionPopoverPlacement({
        anchorRect: anchor?.getBoundingClientRect() ?? null,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        // Room for three agent-pill columns so grouped menus stay scroll-free.
        preferredWidth: 300,
        preferredMaxHeight: 320,
      }),
    });
  };

  const openProjectContextMenu = useCallback((
    targetProjectId: string,
    position: {x: number; y: number},
  ) => {
    if (!targetProjectId) {
      return;
    }
    closeSidebarTransientMenus();
    resetProjectResumeState();
    if (!isWide) {
      setMobileProjectActionMenu({
        projectId: targetProjectId,
        kind: 'actions',
        phase: 'actions',
        agentType: '',
        popover: null,
      });
      return;
    }
    setWideProjectActionMenu({
      projectId: targetProjectId,
      kind: 'actions',
      phase: 'actions',
      agentType: '',
      popover: resolveWideProjectActionPopoverPlacement({
        anchorRect: {
          left: position.x,
          top: position.y,
          bottom: position.y,
          right: position.x,
        },
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        preferredWidth: 224,
        preferredMaxHeight: 240,
        align: 'start',
      }),
    });
  }, [
    closeSidebarTransientMenus,
    isWide,
    resetProjectResumeState,
    setMobileProjectActionMenu,
    setWideProjectActionMenu,
  ]);

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
    const nextQueues = {...chatSessionQueuesByKeyRef.current};
    delete nextQueues[runtimeKey];
    chatSessionQueuesByKeyRef.current = nextQueues;
    setChatSessionQueuesByKey(nextQueues);
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

  const handlePinProjectSession = async (
    targetProjectId: string,
    sessionId: string,
    pinned: boolean,
  ) => {
    const normalizedSessionId = sessionId.trim();
    const actionKey = projectSessionActionKey(targetProjectId, normalizedSessionId);
    if (!targetProjectId || !normalizedSessionId || chatPinningSessionKey === actionKey) {
      return;
    }
    setError('');
    setChatPinningSessionKey(actionKey);
    try {
      const result = await service.pinProjectSession(targetProjectId, normalizedSessionId, pinned);
      if (!result.ok) {
        throw new Error('session.pin returned ok=false');
      }
      rememberChatSessionSummary(targetProjectId, result.session);
      const runtimeKey = buildChatRuntimeKey(targetProjectId, result.session.sessionId);
      workspaceStore.rememberChatSession(
        targetProjectId,
        mergeKnownChatSessionForProject(targetProjectId, result.session),
        {turnIndex: chatFinishedCursorRef.current[runtimeKey] ?? 0},
      );
      setProjectSessionActionMenu(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatPinningSessionKey(current => current === actionKey ? '' : current);
    }
  };

  const handleMarkProjectSession = async (
    targetProjectId: string,
    sessionId: string,
    markColor: RegistrySessionMarkColor | '',
  ) => {
    const normalizedSessionId = sessionId.trim();
    const actionKey = projectSessionActionKey(targetProjectId, normalizedSessionId);
    if (!targetProjectId || !normalizedSessionId || chatMarkingSessionKey === actionKey) {
      return;
    }
    setError('');
    // Optimistic: marking is low-risk, so apply the color and close the menu
    // immediately instead of freezing the picker for a server round trip.
    const previousSession = knownChatSessionsForProject(targetProjectId)
      .find(item => item.sessionId === normalizedSessionId);
    setProjectSessionActionMenu(null);
    rememberChatSessionSummary(targetProjectId, {
      sessionId: normalizedSessionId,
      markColor: markColor || undefined,
    });
    setChatMarkingSessionKey(actionKey);
    try {
      const result = await service.markProjectSession(targetProjectId, normalizedSessionId, markColor);
      if (!result.ok) {
        throw new Error('session.mark returned ok=false');
      }
      rememberChatSessionSummary(targetProjectId, result.session);
      const runtimeKey = buildChatRuntimeKey(targetProjectId, result.session.sessionId);
      workspaceStore.rememberChatSession(
        targetProjectId,
        mergeKnownChatSessionForProject(targetProjectId, result.session),
        {turnIndex: chatFinishedCursorRef.current[runtimeKey] ?? 0},
      );
    } catch (err) {
      if (previousSession) {
        rememberChatSessionSummary(targetProjectId, {
          sessionId: normalizedSessionId,
          markColor: previousSession.markColor,
        });
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatMarkingSessionKey(current => current === actionKey ? '' : current);
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
    if (!isWide || sidebarSettingsOpen || !selectedChatKey || !selectedChatSession || renameTarget || confirmTarget) {
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
    itemIdOverride?: string;
    createdAtOverride?: string;
  } = {}) => {
    if (voiceAwaitingFinalRef.current) {
      return;
    }
    if (selectedActivePermission) {
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
        if (nativeAction.kind === 'goal') {
          const result = await service.createProjectSessionGoal(
            selectedProjectId,
            sessionId,
            nativeAction.objective,
          );
          if (!result.ok || !result.goal) {
            throw new Error('session.goal.create returned no Goal');
          }
          rememberChatSessionSummary(selectedProjectId, {sessionId, goal: result.goal});
        } else {
          await invokeChatSessionAction(nativeAction.kind);
        }
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
      const createdAt = options.createdAtOverride ?? new Date().toISOString();
      const itemId = options.itemIdOverride ?? makeSessionQueueItemID();
      rememberPendingChatPrompt(runtimeKey, {
        itemId,
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
      const result = await service.enqueueProjectSessionItem(selectedProjectId, sessionId, {
        itemId,
        kind: 'prompt',
        createdAt,
        blocks,
      });
      if (!result.ok) {
        throw new Error('session.queue enqueue returned ok=false');
      }
      applySessionQueueProjection(selectedProjectId, result.session);
      forgetPendingChatPrompt(runtimeKey);
      const nextSelectedKey = chatSessionKeyFromParts(selectedProjectId, sessionId);
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
  const retryFailedChatPrompt = useCallback((promptRequest: RegistryChatMessage) => {
    if (promptRequest.method !== 'prompt_request') return;
    const blocks = msgBlocks(promptRequest.method, promptRequest.param).map(block => ({...block}));
    if (blocks.length === 0) return;
    sendChatMessageEvent({
      attachmentsOverride: [],
      blocksOverride: blocks,
      preserveComposer: true,
    }).catch(() => undefined);
  }, [sendChatMessageEvent]);
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
      itemIdOverride: pending.itemId,
      createdAtOverride: pending.createdAt,
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

  const applyChatSessionGoal = (
    activeProjectId: string,
    sessionId: string,
    goal: RegistrySessionGoal | undefined,
  ) => {
    rememberChatSessionSummary(activeProjectId, {sessionId, goal});
  };

  const handlePauseGoal = async () => {
    const selectedKey = selectedChatKeyRef.current;
    if (!selectedKey || !selectedGoal || goalControlPendingKey) return;
    const pendingKey = `${encodeChatSessionKey(selectedKey)}:pause`;
    setGoalControlPendingKey(pendingKey);
    setError('');
    try {
      const result = await service.updateProjectSessionGoal(selectedKey.projectId, selectedKey.sessionId, {
        status: 'paused',
      });
      if (!result.ok || !result.goal) {
        throw new Error('session.goal.update returned no Goal');
      }
      applyChatSessionGoal(selectedKey.projectId, selectedKey.sessionId, result.goal);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGoalControlPendingKey(current => current === pendingKey ? '' : current);
    }
  };

  const handleResumeGoal = async () => {
    const selectedKey = selectedChatKeyRef.current;
    if (!selectedKey || !selectedGoal || goalControlPendingKey) return;
    const pendingKey = `${encodeChatSessionKey(selectedKey)}:resume`;
    setGoalControlPendingKey(pendingKey);
    setError('');
    try {
      const result = await service.updateProjectSessionGoal(selectedKey.projectId, selectedKey.sessionId, {
        status: 'active',
      });
      if (!result.ok || !result.goal) {
        throw new Error('session.goal.update returned no Goal');
      }
      applyChatSessionGoal(selectedKey.projectId, selectedKey.sessionId, result.goal);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGoalControlPendingKey(current => current === pendingKey ? '' : current);
    }
  };

  const openGoalEdit = () => {
    const selectedKey = selectedChatKeyRef.current;
    if (!selectedKey || !selectedGoal) return;
    setGoalEditError('');
    setGoalEditTarget({
      projectId: selectedKey.projectId,
      sessionId: selectedKey.sessionId,
      goal: selectedGoal,
    });
  };

  const submitGoalEdit = async (patch: RegistrySessionGoalPatch) => {
    const target = goalEditTarget;
    if (!target || goalControlPendingKey) return;
    const pendingKey = `${buildChatRuntimeKey(target.projectId, target.sessionId)}:edit`;
    setGoalControlPendingKey(pendingKey);
    setGoalEditError('');
    try {
      const result = await service.updateProjectSessionGoal(target.projectId, target.sessionId, patch);
      if (!result.ok || !result.goal) {
        throw new Error('session.goal.update returned no Goal');
      }
      applyChatSessionGoal(target.projectId, target.sessionId, result.goal);
      setGoalEditTarget(null);
    } catch (err) {
      setGoalEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setGoalControlPendingKey(current => current === pendingKey ? '' : current);
    }
  };

  const requestClearGoal = () => {
    const selectedKey = selectedChatKeyRef.current;
    if (!selectedKey || !selectedGoal) return;
    setConfirmError('');
    setConfirmTarget({
      kind: 'goalClear',
      projectId: selectedKey.projectId,
      sessionId: selectedKey.sessionId,
      objective: selectedGoal.objective,
    });
  };

  const clearGoal = async (
    target: Extract<ConfirmTarget, {kind: 'goalClear'}>,
  ) => {
    const pendingKey = `${buildChatRuntimeKey(target.projectId, target.sessionId)}:clear`;
    if (goalControlPendingKey) return;
    setGoalControlPendingKey(pendingKey);
    setConfirmError('');
    try {
      const result = await service.clearProjectSessionGoal(target.projectId, target.sessionId);
      if (!result.ok || !result.cleared) {
        throw new Error('session.goal.clear returned ok=false');
      }
      applyChatSessionGoal(target.projectId, target.sessionId, undefined);
      setConfirmTarget(null);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : String(err));
    } finally {
      setGoalControlPendingKey(current => current === pendingKey ? '' : current);
    }
  };

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
      if (selectedGoal?.status === 'active' && selectedChatSession?.running === true) {
        const result = await service.stopProjectSessionGoal(selectedKey.projectId, selectedKey.sessionId);
        if (!result.ok) {
          throw new Error('session.goal.stop returned ok=false');
        }
        if (result.goal) {
          applyChatSessionGoal(selectedKey.projectId, selectedKey.sessionId, result.goal);
        }
      } else {
        const activeItemId = chatSessionQueuesByKeyRef.current[runtimeKey]?.activeItem?.itemId;
        if (!activeItemId) {
          return;
        }
        const result = await service.cancelProjectSessionQueueItem(
          selectedKey.projectId,
          selectedKey.sessionId,
          activeItemId,
        );
        if (!result.ok) {
          throw new Error('session.queue cancel returned ok=false');
        }
        applySessionQueueProjection(selectedKey.projectId, result.session);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatCancellingRuntimeKey(current => (current === runtimeKey ? '' : current));
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
    setChatConfigUpdatingKeys(current => {
      const next = new Set(current);
      next.add(updatingKey);
      return next;
    });

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
      setChatConfigUpdatingKeys(current => {
        const next = new Set(current);
        next.delete(updatingKey);
        return next;
      });
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

  const schedulePostConnectProjectRefresh = (activeProjectId: string) => {
    window.setTimeout(() => {
      refreshChatIndex({force: true, skipProjectId: activeProjectId}).catch(() => undefined);
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
      setReconnecting(false);
    }
    try {
      await registryAuthController.requireSession();
      const result = await workspaceController.connect(registryEndpoints.wsURL);
      connectedProjectId = result.hydrated.projectId;
      const persistedSelectedChatKey = workspaceStore.migrateSelectedChatSessionKey(result.hydrated.projectId);
      const preferredSelectedChatKey =
        previousSelectedChatKey ||
        persistedSelectedChatKey ||
        chatSessionKeyFromParts(
          result.hydrated.projectId,
          workspaceStore.getSelectedChatSessionId(result.hydrated.projectId),
        );
      setProjects(result.projects);
      setRegistryHubs(result.hubs);
      setHasPendingProjectUpdates(false);
      dirHashRef.current = {};
      applyHydratedProjectState(result.hydrated);
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
      }
      schedulePostConnectProjectRefresh(preferredSelectedChatKey?.projectId ?? connectedProjectId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      connectError = message;
      if (silentReconnect) {
        setError('');
        setReconnecting(true);
        reconnectScheduled = true;
        scheduleReconnectAttempt();
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
    clearReconnectTimer();
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

  const requestLogout = () => {
    setConfirmError('');
    setConfirmTarget({kind: 'logout'});
  };

  const handleRegistryLogout = async () => {
    if (logoutPendingRef.current) {
      return;
    }
    logoutPendingRef.current = true;
    setLogoutPending(true);
    setConfirmError('');
    try {
      clearReconnectTimer();
      setError('');
      setAutoConnecting(false);
      setReconnecting(false);
      setConnected(false);
      clearChatRuntimeState();
      service.close();
      await androidSpeechRuntimeRef.current?.clearCredential();
      await registryAuthController.logout();
      await workspaceStore.resetDatabase();
      await wipeBrowserStorage();
      window.location.reload();
    } catch (logoutError) {
      const message = logoutError instanceof Error ? logoutError.message : String(logoutError);
      setConfirmError(message);
    } finally {
      logoutPendingRef.current = false;
      setLogoutPending(false);
    }
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
      activeTab: 'chat',
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
    // Resume signals (visibilitychange/online) are unreliable on some Android
    // WebViews; the frame-driven watchdog is the last-resort reconnect trigger
    // while the page is actually rendering.
    const stopReconnectWatchdog = startReconnectWatchdog({
      shouldReconnect: () =>
        !connectedRef.current &&
        !connectInFlightRef.current &&
        !!projectIdRef.current &&
        registryAuthController.snapshot().state === 'authenticated',
      reconnect: () => {
        void connect({silentReconnect: true});
      },
    });
    return () => {
      supervisor.stop();
      stopReconnectWatchdog();
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

  useEffect(() => usageStore.subscribe(setUsageSnapshot), [usageStore]);
  useEffect(() => service.hubStore.subscribe(setHubStoreSnapshot), []);
  useEffect(() => usageStore.bindHubStore(service.hubStore), [usageStore]);

  useEffect(
    () => modelEfficiencyStore.subscribe(setModelEfficiencySnapshot),
    [modelEfficiencyStore],
  );

  useEffect(() => {
    if (!connected) return;
    void modelEfficiencyStore.refresh();
    const timer = window.setInterval(() => {
      void modelEfficiencyStore.refresh();
    }, MODEL_EFFICIENCY_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [connected, modelEfficiencyStore]);

  const refreshUsageAcrossHubs = useCallback(() => {
    return Promise.allSettled(registryHubs.map(hub =>
      service.hubStore.refresh(hub.hubId, ['tokenStats'], true),
    ));
  }, [registryHubs]);

  const loadUsageHistoryDialog = useCallback(async (target: UsageHistoryDialogTarget) => {
    const requestSeq = ++usageHistoryRequestSeqRef.current;
    const providerName = target.provider.name || target.provider.id;
    const accountLabel = target.account.identity.label
      || target.account.identity.value
      || target.account.localId;
    setUsageHistoryDialogView({
      target,
      state: {status: 'loading', providerName, accountLabel},
    });
    const result = await loadUsageHistoryFromSources({
      providerId: target.provider.id,
      sources: target.account.sources,
      nowMillis: Date.now(),
      request: source => service.getUsageHistory(
        source.hubId,
        target.provider.id,
        source.accountLocalId,
      ),
    });
    if (usageHistoryRequestSeqRef.current !== requestSeq) return;
    const state: UsageHistoryDialogState = result.status === 'ready'
      ? {
          status: 'ready',
          providerName,
          accountLabel,
          limit: result.limit,
          forecast: result.forecast,
        }
      : result.status === 'empty'
        ? {status: 'empty', providerName, accountLabel}
        : {
            status: 'error',
            providerName,
            accountLabel,
            message: 'History could not be read from any online Hub.',
          };
    setUsageHistoryDialogView({target, state});
  }, []);

  const openUsageHistory = useCallback((
    provider: UsageProviderView,
    account: UsageViewAccount,
    triggerElement: HTMLElement,
  ) => {
    void loadUsageHistoryDialog({provider, account, triggerElement});
  }, [loadUsageHistoryDialog]);

  const closeUsageHistory = useCallback(() => {
    usageHistoryRequestSeqRef.current += 1;
    setUsageHistoryDialogView(null);
  }, []);

  const loadDeepSeekUsage = useCallback(async (
    target: DeepSeekUsageDialogTarget,
    month: {year: number; month: number},
    force = false,
  ) => {
    const requestSeq = ++deepSeekUsageRequestSeqRef.current;
    setDeepSeekUsageDialogView({target, month, state: {status: 'loading', month}});
    const source = target.account.sources[0];
    if (!source) {
      setDeepSeekUsageDialogView({
        target,
        month,
        state: {status: 'error', message: 'No online Hub for this account', month},
      });
      return;
    }
    try {
      const result = await service.getDeepSeekUsage(source.hubId, month.year, month.month, force);
      if (deepSeekUsageRequestSeqRef.current !== requestSeq) return;
      const view = normalizeDeepSeekUsage(result);
      if (view.balance.length === 0 && target.account.balance?.items?.length) {
        view.balance = target.account.balance.items;
      }
      const state: DeepSeekUsageDialogState = view.status === 'ok'
        ? {status: 'ready', view}
        : view.status === 'expired'
          ? {status: 'expired', month, view}
          : view.status === 'error'
            ? {status: 'error', message: view.message ?? 'Failed to load DeepSeek usage', month, view}
            : {status: 'notConnected', month};
      setDeepSeekUsageDialogView({target, month, state});
    } catch (err) {
      if (deepSeekUsageRequestSeqRef.current !== requestSeq) return;
      setDeepSeekUsageDialogView({
        target,
        month,
        state: {status: 'error', message: err instanceof Error ? err.message : 'Failed to load DeepSeek usage', month},
      });
    }
  }, [service]);

  const openDeepSeekUsage = useCallback((
    provider: UsageProviderView,
    account: UsageViewAccount,
    triggerElement: HTMLElement,
  ) => {
    const month = {year: new Date().getFullYear(), month: new Date().getMonth() + 1};
    void loadDeepSeekUsage({provider, account, triggerElement}, month);
  }, [loadDeepSeekUsage]);

  const closeDeepSeekUsage = useCallback(() => {
    deepSeekUsageRequestSeqRef.current += 1;
    setDeepSeekUsageDialogView(null);
  }, []);

  const saveDeepSeekToken = useCallback(async (token: string) => {
    const view = deepSeekUsageDialogView;
    const source = view?.target.account.sources[0];
    if (!view || !source) throw new Error('No active DeepSeek account');
    await service.updateHubConfig(source.hubId, {
      section: 'deepSeekPlatform',
      field: 'token',
      action: 'set',
      value: token,
    });
    await loadDeepSeekUsage(view.target, view.month);
  }, [deepSeekUsageDialogView, loadDeepSeekUsage, service]);

  const clearDeepSeekToken = useCallback(async () => {
    const view = deepSeekUsageDialogView;
    const source = view?.target.account.sources[0];
    if (!view || !source) return;
    await service.updateHubConfig(source.hubId, {
      section: 'deepSeekPlatform',
      field: 'token',
      action: 'clear',
    });
    await loadDeepSeekUsage(view.target, view.month);
  }, [deepSeekUsageDialogView, loadDeepSeekUsage, service]);

  const changeDeepSeekMonth = useCallback((year: number, month: number) => {
    const view = deepSeekUsageDialogView;
    if (!view) return;
    void loadDeepSeekUsage(view.target, {year, month});
  }, [deepSeekUsageDialogView, loadDeepSeekUsage]);

  const handleUsageRowActivate = useCallback((
    provider: UsageProviderView,
    account: UsageViewAccount,
    triggerElement: HTMLElement,
  ) => {
    if (provider.id === 'deepseek') {
      openDeepSeekUsage(provider, account, triggerElement);
    } else {
      openUsageHistory(provider, account, triggerElement);
    }
  }, [openDeepSeekUsage, openUsageHistory]);

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
    if (typeof snapshot.listenPort === 'number' && snapshot.listenPort > 0) {
      setPortRelayListenPort(String(snapshot.listenPort));
      if (snapshot.listenPortManaged !== true) {
        persistPortRelaySettings({listenPort: snapshot.listenPort});
      }
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
    if (!portRelayScreenOpen) {
      return;
    }
    refreshPortRelayStatus().catch(() => undefined);
  }, [portRelayScreenOpen]);

  useEffect(() => {
    if (!portRelayScreenOpen || portRelayAccessCode || portRelaySnapshot.enabled) {
      return;
    }
    setPortRelayAccessCode(generatePortRelayAccessCode());
  }, [portRelayAccessCode, portRelayScreenOpen, portRelaySnapshot.enabled]);

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
    options: {framePath?: string; openFrame?: boolean} = {},
  ): Promise<RegistryPortRelaySnapshot | null> => {
    const normalizedTarget = normalizePortRelayTarget(target);
    const listenPort = effectivePortRelayListenPort(portRelaySnapshot, portRelayListenPort);
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
      setPortRelayError('Relay server port is not configured.');
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
  }, [applyPortRelaySnapshot, isWide, persistPortRelaySettings, portRelayAccessCode, portRelayAccessCodeUnknown, portRelayListenPort, portRelaySnapshot.listenPort, portRelaySnapshot.listenPortManaged, portRelayTargets]);

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
      openPortRelayScreen();
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
    const listenPort = effectivePortRelayListenPort(portRelaySnapshot, portRelayListenPort);
    if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
      setPortRelayError('Relay server port is not configured.');
      openPortRelayScreen();
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
      await enablePortRelayForTarget(normalizedTarget, {
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
    openPortRelayScreen,
    portRelayAccessCodeUnknown,
    portRelayFrameReloadKey,
    portRelayFrameUrl,
    portRelayListenPort,
    portRelaySnapshot.enabled,
    portRelaySnapshot.hubId,
    portRelaySnapshot.listenPort,
    portRelaySnapshot.listenPortManaged,
    portRelaySnapshot.status,
    portRelaySnapshot.targetPort,
    setDrawerOpen,
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
    await enablePortRelayForTarget(target, {framePath: ''});
  }, [
    enablePortRelayForTarget,
    persistPortRelaySettings,
    portRelaySnapshot.enabled,
    portRelaySnapshot.listenPort,
    selectedPortRelayTarget,
  ]);

  const handleMobilePortRelayTargetMenuSelect = useCallback(async (target: PortRelayTarget) => {
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
    });
    await openPortRelayWorkbenchTab(target, localUrl.path, {source: 'chat'});
  }, [
    currentProject?.hubId,
    openPortRelayWorkbenchTab,
    persistPortRelaySettings,
    portRelayTargets,
  ]);

  const updateHubCards = useMemo(() => {
    const hubIds = new Set<string>([
      ...deriveRegistryHubIds(registryHubs),
      ...Object.keys(wheelMakerUpdateHubs),
      ...Object.keys(gatewayUpdateHubs),
      ...Object.keys(agentPackageHubs),
      ...Object.keys(projectIndexByHubId),
      ...Object.keys(skillHubs),
    ]);
    const registryHubById = new Map(registryHubs.map(hub => [hub.hubId, hub]));
    return Array.from(hubIds).sort((left, right) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    }).map(hubId => ({
      hubId,
      connectionMode: registryHubById.get(hubId)?.connectionMode,
      wheelMaker: wheelMakerUpdateHubs[hubId] ?? null,
      gateway: gatewayUpdateHubs[hubId] ?? null,
      agentPackage: agentPackageHubs[hubId] ?? null,
      projectIndex: projectIndexByHubId[hubId] ?? null,
    }));
  }, [agentPackageHubs, gatewayUpdateHubs, projectIndexByHubId, registryHubs, skillHubs, wheelMakerUpdateHubs]);

  const agentPackageHubCards = useMemo(() => {
    return Object.values(agentPackageHubs).sort((left, right) => {
      if (left.hubId < right.hubId) return -1;
      if (left.hubId > right.hubId) return 1;
      return 0;
    });
  }, [agentPackageHubs]);

  const chatHubProjectIndexTargets = useCallback((hubId: string): RegistryFileIndexStatus[] => {
    const card = updateHubCards.find(item => item.hubId === hubId);
    if (card?.projectIndex?.projects?.length) {
      return card.projectIndex.projects;
    }
    return projects
      .filter(project => (project.hubId || '').trim() === hubId)
      .map(project => ({
        projectId: project.projectId,
        name: project.name,
        path: project.path,
        status: 'missing',
        fileCount: 0,
      }));
  }, [projects, updateHubCards]);

  const chatHubOpsByHubId = useMemo((): Record<string, ChatHubOpsView> => {
    const stableRelease = wheelMakerPublicMetadata?.stable ?? null;
    const views: Record<string, ChatHubOpsView> = {};
    for (const card of updateHubCards) {
      const wheelMakerData = card.wheelMaker?.data ?? null;
      const status = deriveWheelMakerHubStatus(wheelMakerData?.installed, stableRelease, wheelMakerData?.job);
      const jobActive = wheelMakerUpdateJobActive(wheelMakerData?.job);
      const localPendingAction = wheelMakerMaintenancePending?.hubId === card.hubId
        ? wheelMakerMaintenancePending.action
        : null;
      const pendingAction = localPendingAction || (wheelMakerUpdateAllPending || jobActive ? 'update' : null);
      const pending = pendingAction !== null;
      const viewData = wheelMakerData ? {
        ...wheelMakerData,
        status,
        canRequestUpdate: wheelMakerData.canRequestUpdate === true &&
          (status === 'update_available' || status === 'up_to_date' || status === 'local_newer'),
      } : null;
      const gatewayData = card.gateway?.data ?? null;
      const gatewayStatus = deriveGatewayHubStatus(
        gatewayData?.installed,
        stableRelease?.gateway ?? null,
        gatewayData?.job,
      );
      const gatewayJobActive = gatewayUpdateJobActive(gatewayData?.job);
      const gatewayPending = gatewayMaintenancePending?.hubId === card.hubId || gatewayJobActive;
      const gatewayViewData = gatewayData ? {
        ...gatewayData,
        status: gatewayStatus,
        canRequestUpdate: gatewayData.canRequestUpdate === true && Boolean(gatewayData.installed?.version) &&
          (gatewayStatus === 'update_available' || gatewayStatus === 'up_to_date' || gatewayStatus === 'local_newer'),
      } : null;
      const npmUpdatable = deriveNpmUpdatableTargets(card.agentPackage?.hub?.packages ?? []);
      const hubPackages = card.agentPackage?.hub?.packages ?? [];
      const indexTargets = chatHubProjectIndexTargets(card.hubId);
      const indexRunning = indexTargets.some(
        project => project.running === true || project.status === 'scanning',
      );
      const skillHub = skillHubs[card.hubId];
      const hubSkills = skillHub?.data?.hubSkills?.skills ?? [];
      const skillProjects = skillHub?.data?.projects ?? [];
      const legacySourceScope = (items: typeof hubSkills) => ({
        sources: [],
        unmanagedSkills: items.map(skill => ({
          name: skill.name,
          status: 'unmanaged',
          installed: true,
          managed: false,
          conflict: false,
          canInstall: false,
          canUpdate: false,
          canUninstall: false,
        })),
      });
      const projectSourceScopes = skillHub?.data?.projectSources
        ?? Object.fromEntries(skillProjects.map(project => [
          project.projectId || project.projectName,
          legacySourceScope(project.skills),
        ]));
      const updateVisible = shouldShowWheelMakerUpdateAction({
        data: viewData,
        loading: card.wheelMaker?.loading === true,
        pending: pending || wheelMakerUpdateAllPending || jobActive,
      });
      const gatewayUpdateVisible = shouldShowGatewayUpdateAction({
        data: gatewayViewData,
        loading: card.gateway?.loading === true,
        pending: gatewayPending,
      });
      const restartVisible = card.connectionMode !== 'update_only'
        && card.wheelMaker?.loading !== true
        && Boolean(wheelMakerData?.installed?.version);
      views[card.hubId] = {
        wheelMaker: {
          loading: card.wheelMaker?.loading === true,
          pending: pending || wheelMakerUpdateAllPending || jobActive,
          pendingAction,
          currentVersion: wheelMakerVersionCopy(wheelMakerData, stableRelease).current,
          updateVisible,
          restartVisible,
          updateAvailable: status === 'update_available',
        },
        gateway: {
          loading: card.gateway?.loading === true,
          pending: gatewayPending,
          pendingAction: gatewayPending ? 'update' : null,
          currentVersion: gatewayData?.installed?.version || '-',
          updateVisible: gatewayUpdateVisible,
          updateAvailable: gatewayStatus === 'update_available',
        },
        npm: {
          loading: card.agentPackage?.loading === true,
          pending: agentPackageHubUpdatePendingId === card.hubId
            || agentPackageWriteOperationRunning(card.agentPackage?.operation),
          outdatedCount: npmUpdatable.length,
          myFlickerAvailable: card.agentPackage?.hub?.capabilities?.myFlicker === true,
          packages: hubPackages.map(pkg => ({
            packageName: pkg.packageName,
            displayName: pkg.displayName,
            agentTypes: pkg.agentTypes ?? [],
            installedVersion: pkg.installedVersion,
            latestVersion: pkg.latestVersion,
            action: pkg.canUpdate ? 'update' as const : pkg.canInstall ? 'install' as const : null,
            canUninstall: pkg.canUninstall === true,
            pending: agentPackageActionPendingKey === agentPackageActionKey(card.hubId, pkg.packageName),
          })),
        },
        skills: {
          loading: skillHub?.loading === true,
          operationRunning: skillHub?.data?.operation?.running === true,
          operation: skillHub?.data?.operation ?? null,
          error: skillHub?.error || '',
          pendingKey: skillsPendingKey,
          hubItems: hubSkills,
          projects: skillProjects,
          hubSources: skillHub?.data?.hubSources ?? legacySourceScope(hubSkills),
          projectSources: projectSourceScopes,
        },
        index: {
          pending: projectIndexScanAllPendingByHubId[card.hubId] === true || indexRunning,
          indexedCount: indexTargets.filter(project => project.status === 'indexed').length,
          totalCount: indexTargets.length,
          projects: indexTargets.map(project => ({
            projectId: project.projectId,
            name: project.name,
            status: project.status,
            pending: projectIndexScanPendingByProjectId[project.projectId] === true
              || project.running === true
              || project.status === 'scanning',
          })),
        },
      };
    }
    return views;
  }, [
    agentPackageActionKey,
    agentPackageActionPendingKey,
    agentPackageHubUpdatePendingId,
    chatHubProjectIndexTargets,
    gatewayMaintenancePending,
    projectIndexScanAllPendingByHubId,
    projectIndexScanPendingByProjectId,
    skillHubs,
    skillsPendingKey,
    updateHubCards,
    wheelMakerPublicMetadata,
    wheelMakerUpdateAllPending,
    wheelMakerMaintenancePending,
  ]);

  const observeSkillOperation = useCallback((
    hubId: string,
    operation: RegistrySkillCommandResponse['operation'],
  ) => {
    if (!operation || operation.running) {
      return;
    }
    const operationKey = [
      operation.action || '',
      operation.startedAt || '',
      operation.finishedAt || '',
      operation.status || '',
    ].join(':');
    if (seenSkillOperationRef.current.get(hubId) === operationKey) {
      return;
    }
    seenSkillOperationRef.current.set(hubId, operationKey);
    setSkillsPendingKey('');
    if (operation.status === 'succeeded') {
      skillActionByHubIdRef.current.delete(hubId);
      setSkillRetryNotice(current => {
        if (!current) return null;
        const noticeHubId = current.retry.target.hubId;
        return noticeHubId === hubId ? null : current;
      });
      setToastMessage('Skill operation completed.');
      return;
    }
    if (operation.status === 'failed' || operation.status === 'partial') {
      const target = skillActionByHubIdRef.current.get(hubId);
      skillActionByHubIdRef.current.delete(hubId);
      const failedSkills = (operation.results ?? [])
        .filter(result => result.status === 'failed')
        .map(result => result.skill);
      const retryTarget = target?.kind === 'skillPreview' && failedSkills.length > 0
        ? {...target, skills: failedSkills}
        : target;
      const notice = createSkillRetryNotice(
        failedSkills.length > 0
          ? `${operation.errorSummary || 'Skill operation was incomplete.'} Failed: ${failedSkills.join(', ')}.`
          : operation.errorSummary || operation.message || 'Skill operation failed.',
        retryTarget,
      );
      if (notice) {
        setSkillRetryNotice(notice);
      }
    }
  }, []);

  useEffect(() => {
    for (const [hubId, skillHub] of Object.entries(skillHubs)) {
      observeSkillOperation(hubId, skillHub.data?.operation);
    }
  }, [observeSkillOperation, skillHubs]);

  const requestSkillInstall = useCallback((target: SkillInstallTarget) => {
    const sameTarget = sameSkillScopeTarget(skillInstallTarget, target);
    setSkillDetailTarget(null);
    setSkillInstallTarget(target);
    if (!sameTarget) {
      setSkillSourceError('');
      setSkillSourcePreview(null);
      setSkillSourceRequestedNames([]);
      setSkillSourceInput('');
    }
  }, [skillInstallTarget]);

  const changeSkillSourceInput = useCallback((value: string) => {
    setSkillSourceInput(value);
    setSkillSourcePreview(null);
    setSkillSourceRequestedNames([]);
    setSkillSourceError('');
  }, []);

  const skillPreviewConfirmTarget = useCallback((
    preview: RegistrySkillSourcePreview,
    action: Extract<ConfirmTarget, {kind: 'skillPreview'}>['action'],
  ): Extract<ConfirmTarget, {kind: 'skillPreview'}> => ({
    kind: 'skillPreview',
    action,
    hubId: action === 'saveSource' || action === 'install'
      ? skillInstallTarget?.hubId || ''
      : '',
    scope: preview.scope,
    projectName: preview.projectName,
    previewId: preview.id,
    source: preview.source,
    sourceKey: preview.sourceKey,
    resolvedCommit: preview.resolvedCommit,
    skills: preview.skills?.length
      ? preview.skills
      : action === 'saveSource'
        ? preview.skillList.map(skill => skill.name)
        : [],
    overwritesLocal: preview.overwritesLocal,
  }), [skillInstallTarget?.hubId]);

  const previewSkillSourceInstall = useCallback(async () => {
    const target = skillInstallTarget;
    const parsed = parseSkillSourceInput(skillSourceInput);
    const source = parsed.source;
    if (parsed.error) {
      setSkillSourceError(parsed.error);
      return;
    }
    if (!target || !source) {
      setSkillSourceError('Source is required.');
      return;
    }
    setSkillSourceLoading(true);
    setSkillSourceError('');
    try {
      const payload = {
        ...target,
        source,
        skills: parsed.skillNames,
      };
      const result = parsed.skillNames.length > 0
        ? await service.previewSkillInstall(payload)
        : await service.previewSkillSource(payload);
      if (!result.ok || !result.preview) {
        throw new Error(skillCommandErrorMessage(result));
      }
      setSkillSourcePreview(result.preview);
      setSkillSourceRequestedNames(parsed.skillNames);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSkillSourceError(message);
    } finally {
      setSkillSourceLoading(false);
    }
  }, [skillInstallTarget, skillSourceInput]);

  const requestSkillSourceApply = useCallback((previewId: string) => {
    const preview = skillSourcePreview;
    if (!preview || preview.id !== previewId) {
      setSkillSourceError('Preview expired. Preview the source again.');
      return;
    }
    setConfirmError('');
    setConfirmTarget(skillPreviewConfirmTarget(
      preview,
      preview.kind === 'previewInstall' ? 'install' : 'saveSource',
    ));
  }, [skillPreviewConfirmTarget, skillSourcePreview]);

  const previewSkillLedgerAction = useCallback(async (
    action: Extract<ConfirmTarget, {kind: 'skillPreview'}>['action'],
    target: SkillScopeTarget | SkillSourceTarget,
    skills: string[] = [],
  ) => {
    const hasSource = 'source' in target;
    const pendingKey = skillActionPendingKey({...target, action: `skillPreview:${action}`});
    setSkillsPendingKey(pendingKey);
    setConfirmError('');
    try {
      const payload = {
        hubId: target.hubId,
        scope: target.scope,
        projectName: target.projectName,
        source: hasSource ? target.source : '',
        skills,
      };
      const result = action === 'install'
        ? await service.previewSkillInstall(payload)
        : action === 'update'
          ? await service.previewSkillUpdate(payload)
          : action === 'deleteSource'
            ? await service.previewSkillDeleteSource(payload)
            : await service.previewSkillSource(payload);
      if (!result.ok || !result.preview) {
        throw new Error(skillCommandErrorMessage(result));
      }
      const confirm = skillPreviewConfirmTarget(result.preview, action);
      confirm.hubId = target.hubId;
      setConfirmTarget(confirm);
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSkillsPendingKey('');
    }
  }, [skillPreviewConfirmTarget]);

  const requestSkillSourceRefresh = useCallback((target: SkillSourceTarget) => {
    void previewSkillLedgerAction('refresh', target);
  }, [previewSkillLedgerAction]);

  const requestSkillSourceDelete = useCallback((target: SkillSourceTarget) => {
    void previewSkillLedgerAction('deleteSource', target);
  }, [previewSkillLedgerAction]);

  const requestSourceSkillInstall = useCallback((target: SkillSourceSkillTarget) => {
    void previewSkillLedgerAction('install', target, [target.skillName]);
  }, [previewSkillLedgerAction]);

  const requestSourceSkillUpdate = useCallback((target: SkillSourceSkillTarget) => {
    void previewSkillLedgerAction('update', target, [target.skillName]);
  }, [previewSkillLedgerAction]);

  const requestSkillSourcesUpdate = useCallback((target: SkillScopeTarget | SkillSourceTarget) => {
    void previewSkillLedgerAction('update', target);
  }, [previewSkillLedgerAction]);

  const requestSkillUninstall = useCallback((target: SkillUninstallTarget) => {
    setConfirmError('');
    setConfirmTarget({kind: 'skillUninstall', ...target});
  }, []);

  const loadSkillDetail = useCallback(async (
    target: SkillDetailTarget,
    cacheKey: string,
  ) => {
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
  }, []);

  const requestSkillDetail = useCallback(async (target: SkillDetailTarget) => {
    const cacheKey = skillDetailCacheKey(target);
    setSkillInstallTarget(null);
    setSkillDetailTarget(target);
    const cached = skillDetailCache[cacheKey];
    if (cached?.detail || cached?.loading) {
      return;
    }
    await loadSkillDetail(target, cacheKey);
  }, [loadSkillDetail, skillDetailCache]);

  const handleSkillConfirmedAction = useCallback(async (
    target: SkillConfirmedTarget,
  ) => {
    const pendingKey = skillActionPendingKey({
      hubId: target.hubId,
      scope: target.scope,
      projectName: target.projectName,
      skillName: target.kind === 'skillUninstall'
        ? target.skillName
        : target.skills.length === 1
          ? target.skills[0]
          : undefined,
      action: target.kind,
    });
    skillActionByHubIdRef.current.set(target.hubId, target);
    setSkillRetryNotice(null);
    setConfirmError('');
    setSkillsPendingKey(pendingKey);
    let operationPending = false;
    try {
      let results: RegistrySkillCommandResponse[] = [];
      if (target.kind === 'skillUninstall') {
        results = [await service.uninstallSkills({
          hubId: target.hubId,
          scope: target.scope,
          projectName: target.projectName,
          skills: [target.skillName],
        })];
      } else {
        results = [await service.applySkillPreview(target.hubId, target.previewId)];
      }
      const failed = results.find(result => !result.ok);
      if (failed) {
        throw new Error(skillCommandErrorMessage(failed));
      }
      const terminalOperation = results
        .map(result => result.operation)
        .find(operation => operation && !operation.running);
      const completedImmediately = results.every(
        result => result.accepted !== true && result.operation?.running !== true,
      );
      operationPending = !completedImmediately;
      setConfirmTarget(null);
      setConfirmError('');
      if (target.kind === 'skillPreview' && (target.action === 'install' || target.action === 'saveSource')) {
        setSkillInstallTarget(null);
        setSkillSourcePreview(null);
        setSkillSourceRequestedNames([]);
        setSkillSourceInput('');
      }
      if (terminalOperation) {
        observeSkillOperation(target.hubId, terminalOperation);
      } else if (completedImmediately) {
        skillActionByHubIdRef.current.delete(target.hubId);
        setToastMessage('Skill operation completed.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmTarget(null);
      setConfirmError('');
      setSkillRetryNotice(createSkillRetryNotice(message, target));
    } finally {
      if (!operationPending) {
        setSkillsPendingKey('');
      }
    }
  }, [observeSkillOperation]);

  const retrySkillNotice = useCallback(() => {
    const retry = skillRetryNotice?.retry;
    if (!retry) {
      return;
    }
    setSkillRetryNotice(null);
    if (retry.target.kind === 'skillPreview') {
      const sourceTarget = {
        hubId: retry.target.hubId,
        scope: retry.target.scope,
        projectName: retry.target.projectName,
        source: retry.target.source,
        sourceKey: retry.target.sourceKey || '',
      };
      void previewSkillLedgerAction(retry.target.action, sourceTarget, retry.target.skills);
      return;
    }
    handleSkillConfirmedAction(retry.target).catch(() => undefined);
  }, [handleSkillConfirmedAction, previewSkillLedgerAction, skillRetryNotice]);

  const dismissSkillRetryNotice = useCallback(() => {
    const retry = skillRetryNotice?.retry;
    if (retry) {
      skillActionByHubIdRef.current.delete(retry.target.hubId);
    }
    setSkillRetryNotice(null);
  }, [skillRetryNotice]);

  const requestAgentPackageAction = useCallback((
    action: 'install' | 'update' | 'uninstall' | 'reinstall',
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

  const requestWheelMakerAction = useCallback((
    action: 'update' | 'restart',
    hubId: string,
    data: RegistryWheelMakerUpdateResponse | null,
  ) => {
    setConfirmError('');
    setConfirmTarget({
      kind: 'wheelMakerUpdate',
      action,
      hubId,
      currentVersion: data?.installed?.version || '',
      latestVersion: wheelMakerPublicMetadata?.stable.version || '',
    });
  }, [wheelMakerPublicMetadata?.stable.version]);

  const requestWheelMakerUpdate = useCallback((hubId: string, data: RegistryWheelMakerUpdateResponse | null) => {
    requestWheelMakerAction('update', hubId, data);
  }, [requestWheelMakerAction]);

  const requestWheelMakerRestart = useCallback((hubId: string, data: RegistryWheelMakerUpdateResponse | null) => {
    requestWheelMakerAction('restart', hubId, data);
  }, [requestWheelMakerAction]);

  const requestGatewayUpdate = useCallback((hubId: string, data: RegistryGatewayUpdateResponse | null) => {
    setConfirmError('');
    setConfirmTarget({
      kind: 'gatewayUpdate',
      hubId,
      currentVersion: data?.installed?.version || '',
      latestVersion: wheelMakerPublicMetadata?.stable.gateway?.version || '',
    });
  }, [wheelMakerPublicMetadata?.stable.gateway?.version]);

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

  const startReleasePublish = useCallback((hubId: string, input: Record<string, unknown>) => (
    service.startReleasePublish(hubId, input)
  ), []);

  const queryReleasePublish = useCallback((hubId: string, jobId: string) => (
    service.queryReleasePublish(hubId, jobId)
  ), []);

  const queryReleaseStorage = useCallback((hubId: string, sourcePath: string) => (
    service.queryReleaseStorage(hubId, sourcePath)
  ), []);

  const pruneReleaseStorage = useCallback((hubId: string, sourcePath: string) => (
    service.pruneReleaseStorage(hubId, sourcePath)
  ), []);

  const handleScanProjectIndex = useCallback(async (hubId: string, projectId: string) => {
    if (!hubId || !projectId || projectIndexScanPendingByProjectId[projectId]) {
      return;
    }
    setProjectIndexScanPendingByProjectId(prev => ({...prev, [projectId]: true}));
    let scanRunning = false;
    try {
      const result = await service.rebuildFileIndex(projectId);
      if (!result.ok) {
        throw new Error(result.error || 'Project index scan failed.');
      }
      scanRunning = result.running === true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      if (!scanRunning) {
        setProjectIndexScanPendingByProjectId(prev => ({...prev, [projectId]: false}));
      }
    }
  }, [projectIndexScanPendingByProjectId]);

  const handleScanAllProjectIndexes = useCallback(async (hubId: string, projectIndexProjects: RegistryFileIndexStatus[]) => {
    const targets = projectIndexProjects.filter(project => project.projectId);
    if (!hubId || targets.length === 0 || projectIndexScanAllPendingByHubId[hubId]) {
      return;
    }
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setProjectIndexScanAllPendingByHubId(prev => ({...prev, [hubId]: false}));
      setProjectIndexScanPendingByProjectId(prev => ({
        ...prev,
        ...Object.fromEntries(targets.map(project => [project.projectId, false])),
      }));
    }
  }, [projectIndexScanAllPendingByHubId]);

  const handleChatHubWheelMakerUpdate = useCallback((hubId: string) => {
    requestWheelMakerUpdate(hubId, wheelMakerUpdateHubs[hubId]?.data ?? null);
  }, [requestWheelMakerUpdate, wheelMakerUpdateHubs]);

  const handleChatHubWheelMakerRestart = useCallback((hubId: string) => {
    requestWheelMakerRestart(hubId, wheelMakerUpdateHubs[hubId]?.data ?? null);
  }, [requestWheelMakerRestart, wheelMakerUpdateHubs]);

  const handleChatHubGatewayUpdate = useCallback((hubId: string) => {
    requestGatewayUpdate(hubId, gatewayUpdateHubs[hubId]?.data ?? null);
  }, [gatewayUpdateHubs, requestGatewayUpdate]);

  const handleChatHubNpmUpdate = useCallback((hubId: string) => {
    const card = updateHubCards.find(item => item.hubId === hubId);
    const targets = deriveNpmUpdatableTargets(card?.agentPackage?.hub?.packages ?? []);
    requestAgentPackageHubUpdate(hubId, targets);
  }, [requestAgentPackageHubUpdate, updateHubCards]);

  const handleChatHubScanAllIndexes = useCallback((hubId: string) => {
    void handleScanAllProjectIndexes(hubId, chatHubProjectIndexTargets(hubId));
  }, [chatHubProjectIndexTargets, handleScanAllProjectIndexes]);

  const handleChatHubPackageAction = useCallback((
    hubId: string,
    action: 'install' | 'update' | 'uninstall',
    pkg: ChatHubNpmPackageView,
  ) => {
    const fullPackage = updateHubCards
      .find(card => card.hubId === hubId)
      ?.agentPackage?.hub?.packages.find(item => item.packageName === pkg.packageName);
    if (fullPackage) {
      requestAgentPackageAction(action, hubId, fullPackage);
    }
  }, [requestAgentPackageAction, updateHubCards]);

  const handleChatHubScanProject = useCallback((hubId: string, projectId: string) => {
    void handleScanProjectIndex(hubId, projectId);
  }, [handleScanProjectIndex]);

  const chatHubUpdateAllHubIds = useMemo(() => {
    const stableRelease = wheelMakerPublicMetadata?.stable ?? null;
    return updateHubCards
      .filter(card => deriveWheelMakerHubStatus(
        card.wheelMaker?.data?.installed,
        stableRelease,
        card.wheelMaker?.data?.job,
      ) === 'update_available')
      .map(card => card.hubId);
  }, [updateHubCards, wheelMakerPublicMetadata]);

  const handleChatHubUpdateAllHubs = useCallback(() => {
    requestWheelMakerUpdateAll(chatHubUpdateAllHubIds);
  }, [chatHubUpdateAllHubIds, requestWheelMakerUpdateAll]);

  const handleWheelMakerUpdateConfirmedAction = useCallback(async (target: Extract<ConfirmTarget, {kind: 'wheelMakerUpdate'}>) => {
    setConfirmError('');
    const restart = target.action === 'restart';
    setWheelMakerMaintenancePending({
      hubId: target.hubId,
      action: target.action,
      previousInstanceId: restart ? hubStoreSnapshot.hubs[target.hubId]?.instanceId || '' : '',
      startedAtMs: Date.now(),
    });
    try {
      const result = restart
        ? await service.requestWheelMakerRestart(target.hubId)
        : await service.requestWheelMakerUpdate(target.hubId);
      if (!result.ok) {
        const errorLabel = restart
          ? (result.errorCode ? `Restart error: ${result.errorCode}` : 'Restart request failed.')
          : wheelMakerUpdateErrorLabel(result.errorCode) || 'Update request failed.';
        throw new Error(errorLabel);
      }
      setConfirmTarget(null);
      setConfirmError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmError(message);
      setError(message);
      setWheelMakerMaintenancePending(null);
    } finally {
      if (!restart) {
        setWheelMakerMaintenancePending(null);
      }
    }
  }, [hubStoreSnapshot]);

  const handleGatewayUpdateConfirmedAction = useCallback(async (target: Extract<ConfirmTarget, {kind: 'gatewayUpdate'}>) => {
    setConfirmError('');
    setGatewayMaintenancePending({hubId: target.hubId, startedAtMs: Date.now()});
    try {
      const result = await service.requestGatewayUpdate(target.hubId);
      if (!result.ok) {
        throw new Error(result.errorCode ? `Gateway update error: ${result.errorCode}` : 'Gateway update request failed.');
      }
      setConfirmTarget(null);
      setConfirmError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmError(message);
      setError(message);
    } finally {
      setGatewayMaintenancePending(null);
    }
  }, []);

  const handleWheelMakerUpdateAllConfirmedAction = useCallback(async (target: Extract<ConfirmTarget, {kind: 'wheelMakerUpdateAll'}>) => {
    if (target.hubIds.length === 0) {
      setConfirmTarget(null);
      return;
    }
    setConfirmError('');
    setWheelMakerUpdateAllPending(true);
    setWheelMakerMaintenancePending(null);
    try {
      const responses = await Promise.all(target.hubIds.map(async hubId => {
        try {
          const result = await service.requestWheelMakerUpdate(hubId);
          return {
            hubId,
            error: result.ok
              ? ''
              : wheelMakerUpdateErrorLabel(result.errorCode) || 'Update request failed.',
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {hubId, error: message};
        }
      }));
      setConfirmTarget(null);
      setConfirmError('');
      const failedUpdates = responses.filter(entry => entry.error);
      if (failedUpdates.length > 0) {
        const message = `Failed to update ${failedUpdates.length} of ${target.hubIds.length} hubs: ${failedUpdates.map(entry => entry.hubId).join(', ')}`;
        setError(message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmTarget(null);
      setConfirmError('');
      setError(message);
    } finally {
      setWheelMakerUpdateAllPending(false);
    }
  }, []);

  const handleAgentPackageConfirmedAction = useCallback(async (target: Extract<ConfirmTarget, {kind: 'npmPackage'}>) => {
    const pendingKey = agentPackageActionKey(target.hubId, target.packageName);
    setConfirmError('');
    setAgentPackageActionPendingKey(pendingKey);
    try {
      const result = target.action === 'reinstall'
        ? await service.reinstallNpmPackage(target.hubId, target.packageName)
        : target.action === 'uninstall'
          ? await service.uninstallNpmPackage(target.hubId, target.packageName)
          : await service.installNpmPackage(target.hubId, target.packageName, 'latest');
      if (!result.ok) {
        throw new Error(result.operation?.errorSummary || result.operation?.message || 'Package operation failed.');
      }
      setConfirmTarget(null);
      setConfirmError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmError(message);
      setError(message);
    } finally {
      setAgentPackageActionPendingKey('');
    }
  }, [agentPackageActionKey]);

  const handleAgentPackageHubUpdateConfirmedAction = useCallback(async (target: Extract<ConfirmTarget, {kind: 'npmPackageHubUpdate'}>) => {
    if (target.packages.length === 0) {
      setConfirmTarget(null);
      return;
    }
    setConfirmError('');
    setAgentPackageHubUpdatePendingId(target.hubId);
    try {
      const result = await service.installNpmPackages(target.hubId, target.packages.map(pkg => pkg.packageName), 'latest');
      setConfirmTarget(null);
      setConfirmError('');
      if (!result.ok) {
        const message = result.operation?.errorSummary || result.operation?.message || 'Update request failed.';
        setError(message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setConfirmTarget(null);
      setConfirmError('');
      setError(message);
    } finally {
      setAgentPackageHubUpdatePendingId('');
    }
  }, []);

  const formatDatabaseDump = (dump: Awaited<ReturnType<typeof workspaceStore.dumpDatabase>>): string => {
    return JSON.stringify(
      {
        wm_global_kv: dump.global,
        wm_project_state: dump.projects,
        wm_chat_session_index: dump.chatSessionIndex,
        wm_chat_session_content: dump.chatSessionContent,
        wm_file_cache: dump.fileCache,
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

  const requestClearDatabase = () => {
    setConfirmError('');
    setConfirmTarget({kind: 'clearDatabase'});
  };

  const clearDatabase = async () => {
    if (clearDatabasePendingRef.current) {
      return;
    }
    clearDatabasePendingRef.current = true;
    setClearDatabasePending(true);
    setConfirmError('');
    try {
      await androidSpeechRuntimeRef.current?.clearCredential();
      await registryAuthController.logout();
      await workspaceStore.resetDatabase();
      window.location.reload();
    } catch (clearError) {
      const message = clearError instanceof Error ? clearError.message : String(clearError);
      setConfirmError(message);
    } finally {
      clearDatabasePendingRef.current = false;
      setClearDatabasePending(false);
    }
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
      tab: 'chat',
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

    try {
      const result = await workspaceController.switchProjectLightweight(nextProjectId);
      projectsRef.current = result.projects;
      setProjects(result.projects);
      setRegistryHubs(result.hubs);
      setHasPendingProjectUpdates(false);
      workspaceStore.rememberGlobalState({
        selectedProjectId: nextProjectId,
      });
      applyHydratedProjectState(result.hydrated, {
        keepMobileDrawerOpen: options?.keepMobileDrawerOpen,
      });
      setWorkspaceProjectMenuOpen(false);
      setError('');

      finishSyncDiagnostic({ok: true, loadedSurface: 'none'});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (options?.reason !== 'chat') {
        setError(message);
      }
      setWorkspaceProjectMenuOpen(false);
      finishSyncDiagnostic({ok: false, error: message}, 'error');
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
  }, [setDrawerOpen, setVisibleChatMessagesForRuntimeKey, syncWorkspaceProject]);

  const selectProjectChatSession = async (
    targetProjectId: string,
    sessionId: string,
    options?: {closeMobileDrawer?: boolean; targetTurnIndex?: number},
  ): Promise<boolean> => {
    if (!targetProjectId || !sessionId) return false;
    const nextSelectedKey = chatSessionKeyFromParts(targetProjectId, sessionId);
    if (!nextSelectedKey) return false;
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
    return selected;
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
    setSidebarSettingsOpen(false);
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
    setVisibleChatMessagesForRuntimeKey,
    syncWorkspaceProject,
  ]);

  const selectWideProjectSession = async (targetProjectId: string, sessionId: string) => {
    await selectProjectChatSession(targetProjectId, sessionId);
  };

  useEffect(() => {
    const selectedProjectId = selectedChatKey?.projectId ?? '';
    if (!selectedProjectId || !hiddenProjectIdSet.has(selectedProjectId)) {
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
  }, [chatHubMenuOpen, connected, hiddenProjectIdSet, hiddenProjectIds, selectedChatKey?.projectId, sortedProjectItems]);

  const handleSessionSearchResultClick = async (
    targetProjectId: string,
    sessionId: string,
    options?: {closeMobileDrawer?: boolean},
  ) => {
    const query = sessionSearchQuery.trim();
    if (!query) {
      return;
    }
    sessionSearchHandoffGenerationRef.current += 1;
    const generation = sessionSearchHandoffGenerationRef.current;
    setPendingSessionSearchHandoff({
      projectId: targetProjectId,
      sessionId,
      query: sessionSearchQuery,
      generation,
      ready: false,
    });
    try {
      const selected = await selectProjectChatSession(targetProjectId, sessionId, options);
      const currentSelection = selectedChatKeyRef.current;
      if (
        !selected ||
        currentSelection?.projectId !== targetProjectId ||
        currentSelection.sessionId !== sessionId
      ) {
        consumeSessionSearchHandoff(generation);
        return;
      }
      setPendingSessionSearchHandoff(current =>
        current?.generation === generation ? {...current, ready: true} : current,
      );
    } catch (error) {
      consumeSessionSearchHandoff(generation);
      throw error;
    }
  };

  const handleSessionSearchInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (sessionSearchActive) {
        exitSessionSearch().catch(() => undefined);
      } else {
        setSessionSearchOpen(false);
        setSessionSearchInput('');
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      startSessionSearch().catch(() => undefined);
    }
  };

  const jumpToChatPromptTurn = useCallback((turnIndex: number) => {
    if (!selectedChatEncodedKey || turnIndex <= 0) {
      return;
    }
    setChatTitlePromptMenuOpen(false);
    const generation = Date.now();
    setChatPromptHistoryTargetTurn({
      runtimeKey: selectedChatEncodedKey,
      turnIndex,
      generation,
    });
    chatVirtuosoListRef.current?.scrollToTurnIndex(turnIndex, 'smooth');
    if (chatPromptHistoryHighlightTimerRef.current !== null) {
      window.clearTimeout(chatPromptHistoryHighlightTimerRef.current);
    }
    chatPromptHistoryHighlightTimerRef.current = window.setTimeout(() => {
      setChatPromptHistoryTargetTurn(current =>
        current?.generation === generation ? null : current,
      );
    }, 2000);
  }, [selectedChatEncodedKey]);

  const renderSessionSearchStatusLine = () => {
    if (!sessionSearchStatus) {
      return null;
    }
    return (
      <div className="chat-header-search-status">
        {sessionSearchStatus}
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
            data-tooltip={shortcutTooltip('Search sessions', 'searchSessions')}
            aria-label="Search sessions"
          >
            <SessionIcon name="search" />
          </button>
        </div>
      );
    }
    return (
      <div className="chat-header-search-wrap">
        <div
          className={`chat-header-search-control open${hasActiveSearch ? ' active' : ''}`}
        >
          <SessionIcon name="search" className="session-search-leading-icon" />
          <input
            ref={sessionSearchInputRef}
            className="session-search-input"
            value={sessionSearchInput}
            onChange={event => setSessionSearchInput(event.target.value)}
            onKeyDown={handleSessionSearchInputKeyDown}
            placeholder="Search sessions"
            aria-label="Search sessions"
          />
          <SessionSearchProjectPicker
            projects={visibleProjectItems}
            value={sessionSearchProjectScope}
            onChange={setSessionSearchProjectScope}
          />
          <button
            type="button"
            className="session-search-icon-btn session-search-submit-btn"
            aria-label="Run session search"
            disabled={!sessionSearchInput.trim()}
            onClick={() => startSessionSearch().catch(() => undefined)}
          >
            <SessionIcon name="search" />
          </button>
          <button
            type="button"
            className="session-search-icon-btn"
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
            <SessionIcon name="x" />
          </button>
        </div>
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
          data-tooltip="Archive"
          aria-label="Archive"
          aria-haspopup="menu"
          aria-expanded={sessionArchiveMenuOpen}
        >
          <SessionIcon name="archive" />
        </button>
        {sessionArchiveMenuOpen ? (
          <>
            <div
              className={`sl-sheet-overlay${sessionArchiveMenuExiting ? ' sl-menu-exit' : ''}`}
              aria-hidden="true"
              onPointerDown={() => setSessionArchiveMenuOpen(false)}
            />
            <div
              ref={sessionArchiveMenuRef}
              className={`session-archive-menu sl-session-list-popover${sessionArchiveMenuExiting ? ' sl-menu-exit' : ''}`}
              role="menu"
              aria-label="Archive sessions"
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setSessionArchiveMenuOpen(false);
                  return;
                }
                handleMenuKeyDown(event, sessionArchiveMenuRef.current);
              }}
            >
            <div className="mobile-project-sheet-grip session-archive-menu-grip" aria-hidden="true" />
            <div className="session-archive-menu-title">Archive</div>
            <button
              type="button"
              className="session-archive-menu-item"
              onClick={() => requestArchiveOlderSessions(7)}
              role="menuitem"
            >
              <span className="session-archive-menu-item-icon" aria-hidden="true">
                <SessionIcon name="archive" />
              </span>
              <span className="session-archive-menu-item-text">
                <span className="session-archive-menu-item-label">Archive &gt; 7 days</span>
                <span className="session-archive-menu-item-description">Sessions idle for a week or more</span>
              </span>
            </button>
            <button
              type="button"
              className="session-archive-menu-item"
              onClick={() => requestArchiveOlderSessions(14)}
              role="menuitem"
            >
              <span className="session-archive-menu-item-icon" aria-hidden="true">
                <SessionIcon name="archive" />
              </span>
              <span className="session-archive-menu-item-text">
                <span className="session-archive-menu-item-label">Archive &gt; 14 days</span>
                <span className="session-archive-menu-item-description">Sessions idle for two weeks or more</span>
              </span>
            </button>
            <div className="session-archive-menu-separator" role="separator" />
            <button
              type="button"
              className="session-archive-menu-item"
              onClick={() => enterArchivedMode().catch(() => undefined)}
              role="menuitem"
            >
              <span className="session-archive-menu-item-icon" aria-hidden="true">
                <SessionIcon name="archiveRestore" />
              </span>
              <span className="session-archive-menu-item-text">
                <span className="session-archive-menu-item-label">Recover...</span>
                <span className="session-archive-menu-item-description">Browse and restore archived sessions</span>
              </span>
            </button>
            </div>
          </>
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
    const hubIds = deriveRegistryHubIds(hubs).filter(hubId => {
      if (terminalListRefreshInFlightRef.current.has(hubId)) return false;
      terminalListRefreshInFlightRef.current.add(hubId);
      return true;
    });
    if (hubIds.length === 0) return;
    try {
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
    } finally {
      for (const hubId of hubIds) {
        terminalListRefreshInFlightRef.current.delete(hubId);
      }
    }
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
  const handleTerminalCopy = () => setToastMessage('Copied to clipboard.');

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
            disabled={archiveBatchRunning}
            onClick={clearArchiveBatchStatus}
          >
            <SessionIcon name="x" />
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
            <SessionIcon name="archive" />
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
            <SessionIcon name="loader" spin />
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
                    <SessionIcon
                      name="archive"
                      className={`wide-project-folder-icon ${projectHubVariant}`}
                      style={hubAccentStyle(projectHub)}
                    />
                  </span>
                  <span className="wide-project-title-group">
                    <span className="wide-project-name" data-tooltip={section.project.name}>
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
                        data-tooltip={resolveSessionDisplayTitle(session) || session.sessionId}
                        onClick={() => {
                          loadArchivedSessionPreview(
                            section.project.projectId,
                            session.sessionId,
                          ).catch(() => undefined);
                        }}
                      >
                        <span className="session-state-marker archived">
                          <SessionIcon name="archive" />
                        </span>
                        <span className="wide-session-title">
                          {resolveSessionDisplayTitle(session) || session.sessionId}
                        </span>
                        <AgentTag agentType={sessionAgent} />
                        <span className="wide-session-time" data-tooltip={session.archivedAt || session.updatedAt || ''}>
                          {formatCompactRelativeAge(session.archivedAt || session.updatedAt)}
                        </span>
                      </button>
                      {selected ? (
                        <div className="archived-session-restore-popover sl-session-list-popover">
                          <button
                            type="button"
                            className="project-session-menu-btn restore"
                            disabled={restoring}
                            onClick={() => requestRestoreArchivedSession(section.project.projectId, session)}
                          >
                            <SessionIcon name={restoring ? 'loader' : 'archiveRestore'} spin={restoring} />
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
    // Universal draft flow: every agent gets an instant draft placeholder while
    // session.create resolves, replacing the old Codex-only / blocking paths.
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
  };

  const handleWideProjectCreateSession = async (targetProjectId: string, agentType: string) => {
    await handleProjectCreateSession(targetProjectId, agentType);
  };

  const handleMobileProjectCreateSession = async (targetProjectId: string, agentType: string) => {
    await handleProjectCreateSession(targetProjectId, agentType, {closeMobileDrawer: true});
  };

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

  const renderProjectSessionActionMenu = () => {
    if (!projectSessionActionMenu) {
      return null;
    }
    const targetProjectId = projectSessionActionMenu.projectId;
    const session = knownChatSessionsForProject(targetProjectId)
      .find(item => item.sessionId === projectSessionActionMenu.sessionId);
    if (!session) {
      return null;
    }
    const sessionId = session.sessionId;
    const sessionActionDisabled = !!session.running ||
      chatReloadingSessionId === sessionId ||
      chatArchivingSessionId === sessionId ||
      chatDeletingSessionId === sessionId;
    const renameActionDisabled = chatRenamingSessionId === sessionId;
    const pinActionDisabled = chatPinningSessionKey === projectSessionActionKey(targetProjectId, sessionId);
    const actionKey = projectSessionActionKey(targetProjectId, sessionId);
    const sheet = !isWide;
    const menu = (
      <SessionMenu
        pinned={session.pinned === true}
        pinning={pinActionDisabled}
        markColor={session.markColor}
        sessionTitle={resolveSessionDisplayTitle(session) || sessionId}
        marking={chatMarkingSessionKey === actionKey}
        renaming={renameActionDisabled}
        actionDisabled={sessionActionDisabled}
        archiving={chatArchivingSessionId === sessionId}
        reloading={chatReloadingSessionId === sessionId}
        deleting={chatDeletingSessionId === sessionId}
        onTogglePin={() => handlePinProjectSession(targetProjectId, sessionId, session.pinned !== true).catch(() => undefined)}
        onSetMark={markColor => handleMarkProjectSession(targetProjectId, sessionId, markColor).catch(() => undefined)}
        onRename={() => requestRenameProjectSession(targetProjectId, session)}
        onArchive={() => requestArchiveProjectSession(targetProjectId, session)}
        onReload={() => handleReloadProjectSession(targetProjectId, sessionId).catch(() => undefined)}
        onDelete={() => requestDeleteProjectSession(targetProjectId, session)}
        onClose={() => setProjectSessionActionMenu(null)}
        exiting={projectSessionActionMenuExiting}
        sheet={sheet}
        popoverStyle={!sheet && projectSessionActionMenu.popover
          ? {
              top: `${projectSessionActionMenu.popover.top}px`,
              left: `${projectSessionActionMenu.popover.left}px`,
              width: `${projectSessionActionMenu.popover.width}px`,
              maxHeight: `${projectSessionActionMenu.popover.maxHeight}px`,
              ...({
                '--sl-popover-origin': projectSessionActionMenu.popover.placement === 'above'
                  ? 'bottom center'
                  : 'top center',
              } as React.CSSProperties),
              ...(projectSessionActionMenu.popover.placement === 'above'
                ? {'--sl-popover-shift': 'translateY(-100%)'} as React.CSSProperties
                : {}),
            }
          : undefined}
      />
    );
    if (!sheet) {
      return menu;
    }
    return (
      <>
        <div
          className={`sl-sheet-overlay${projectSessionActionMenuExiting ? ' sl-menu-exit' : ''}`}
          aria-hidden="true"
          onPointerDown={() => setProjectSessionActionMenu(null)}
        />
        {menu}
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
    refreshInFlightRef.current = true;
    const silent = !!options?.silent;
    if (!silent) {
      setRefreshingProject(true);
    }
    try {
      setProjects(await service.listProjects());
      dirHashRef.current = {};
      if (previewWorkbenchRef.current.activeProjectId === activeProjectId) {
        await loadPreviewDirectory(activeProjectId, '.');
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
        loadedSurface: 'preview',
        ...(refreshProjectError ? {error: refreshProjectError} : {}),
      }, refreshProjectError ? 'error' : 'info');
    }
  };

  const rememberProjectSessionList = (
    targetProjectId: string,
    sessions: RegistryChatSession[],
  ) => {
    const listedSessions = sortProjectChatSessions(sessions);
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

  const refreshChatIndex = async (options?: {force?: boolean; skipProjectId?: string}) => {
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
        const offlineProjectIds = new Set(
          latestProjects
            .filter(projectItem => projectItem.online === false)
            .map(projectItem => projectItem.projectId),
        );
        if (offlineProjectIds.size > 0) {
          setMobileProjectSessionErrors(prev => {
            const next = {...prev};
            let changed = false;
            for (const projectId of offlineProjectIds) {
              if (!next[projectId]) continue;
              delete next[projectId];
              changed = true;
            }
            return changed ? next : prev;
          });
        }
        const refreshProjectIds = chatIndexProjectRefreshTargets(
          latestProjects,
          options?.skipProjectId,
        );
        await runChatIndexProjectRefreshes(
          refreshProjectIds,
          projectId =>
            refreshChatProjectSessions(projectId, {force: options?.force === true}),
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
        if (
          nextProject.online &&
          reportedHubId &&
          terminalSyncRef.current.unavailableHubIds[reportedHubId]
        ) {
          refreshTerminalLists([{hubId: reportedHubId}]).catch(() => undefined);
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
          applySessionQueueProjection(eventProjectId, payload.session);
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
          merged = upsertDecodedSessionTurn(
            chatMessageStoreRef.current[runtimeKey] ?? [],
            sessionId,
            incomingTurn,
          );
          chatMessageStoreRef.current[runtimeKey] = merged;
          scheduleVisibleChatMessagesForRuntimeKey(runtimeKey);
          if (message.method === 'prompt_done') {
            chatRealtimeFlushSchedulerRef.current?.flushNow();
          }
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
      chatRealtimeFlushSchedulerRef.current?.flushNow();
      connectedRef.current = false;
      permissionReadGateRef.current.disconnect();
      setPermissionReadRevision(revision => revision + 1);
      setPermissionSubmission({runtimeKey: '', permissionId: '', optionId: '', error: ''});
      setConnected(false);
      chatCompactingByKeyRef.current = {};
      setChatCompactingByKey({});
      terminalCompactionOperationIdsRef.current.clear();
      const terminalHubIds = Array.from(new Set(Object.values(terminalSyncRef.current.terminals).map(item => item.hubId)));
      commitTerminalSync(markTerminalsUnavailable(terminalSyncRef.current, terminalHubIds));
      if (isVoiceInputActive()) {
        handleVoiceRegistryClosedDuringInput('close');
      }
      const canSilentReconnect =
        !!projectIdRef.current;
      if (!canSilentReconnect) {
        setReconnecting(false);
        setError(
          'Registry connection closed. Reconnect to resume live updates.',
        );
        return;
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

  const renderSettingsDetailActions = (detail: SettingsDetail): React.ReactNode => {
    return null;
  };

  const portRelayRefreshAction = (
    <button
      type="button"
      className="settings-detail-refresh"
      onClick={() => refreshPortRelayStatus().catch(() => undefined)}
      disabled={portRelayLoading}
    >
      {portRelayLoading ? 'Refreshing...' : 'Refresh'}
    </button>
  );

  const renderSettingsDetailShell = (content: React.ReactNode) => (
    <SettingsDetailShell>{content}</SettingsDetailShell>
  );

  const renderKeyboardShortcutsSettingsDetail = () =>
    renderSettingsDetailShell(
      <React.Suspense fallback={null}>
        <KeyboardShortcutsSettingsDetail
          platform={shortcutPlatform}
          overrides={keyboardShortcutOverrides}
          onChange={setKeyboardShortcutOverrides}
        />
      </React.Suspense>,
    );

  const renderDatabaseSettingsDetail = () =>
    renderSettingsDetailShell(
      <React.Suspense fallback={null}>
        <DatabaseSettingsDetail
          loading={databaseLoading}
          error={databaseError}
          dumpText={databaseDumpText}
          storageStats={databaseStorageStats}
          onShow={openDatabasePanel}
          onExport={exportDatabaseDump}
          onClearDatabase={requestClearDatabase}
        />
      </React.Suspense>,
    );

  const renderPortRelayScreenContent = () => {
    const hubIds = deriveRegistryHubIds(registryHubs);
    return renderSettingsDetailShell(
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
    );
  };

  const renderDebugLogsSettingsDetail = () =>
    renderSettingsDetailShell(
      <React.Suspense fallback={null}>
        <DebugLogsSettingsDetail
          logLevel={logLevel}
          uploadDebugLog={payload => service.uploadDebugLog(payload)}
        />
      </React.Suspense>,
    );

  const renderReleasePublishContent = () => (
    <React.Suspense fallback={null}>
      <ReleasePublishSettings
        hubIds={updateHubCards.map(card => card.hubId)}
        start={startReleasePublish}
        query={queryReleasePublish}
        subscribe={listener => service.releasePublishStore.subscribe(listener)}
        queryStorage={queryReleaseStorage}
        pruneStorage={pruneReleaseStorage}
      />
    </React.Suspense>
  );

  const renderConnectionStatusSettingsDetail = () =>
    renderSettingsDetailShell(
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
    );

  const renderDeviceSessionsSettingsDetail = () =>
    renderSettingsDetailShell(
      <React.Suspense fallback={null}>
        <DeviceSessionsSettingsDetail
          sessions={deviceSessions}
          loading={deviceSessionsLoading}
          error={deviceSessionsError}
          onRevoke={revokeDeviceSession}
          onRevokeAll={revokeAllDeviceSessions}
          onCurrentRevoked={returnToRegistryLogin}
          onRefresh={refreshDeviceSessions}
        />
      </React.Suspense>,
    );

  const renderSettingsDetailContent = (detail: SettingsDetail) => {
    if (detail === 'keyboardShortcuts') {
      return renderKeyboardShortcutsSettingsDetail();
    }
    if (detail === 'database') {
      return renderDatabaseSettingsDetail();
    }
    if (detail === 'connectionStatus') {
      return renderConnectionStatusSettingsDetail();
    }
    if (detail === 'deviceSessions') {
      return renderDeviceSessionsSettingsDetail();
    }
    if (detail === 'debugLogs') {
      return renderDebugLogsSettingsDetail();
    }
    return null;
  };

  const renderSettingsRootContent = () => (
    <React.Suspense fallback={null}>
      <SettingsRootContent
        isWide={isWide}
        chatColumnWidth={chatColumnWidth}
        setChatColumnWidth={setChatColumnWidth}
        mobileEnterKeyBehavior={mobileEnterKeyBehavior}
        setMobileEnterKeyBehavior={setMobileEnterKeyBehavior}
        showMonitor={showMonitor}
        setShowMonitor={setShowMonitor}
        promptCompletionNotificationsEnabled={promptCompletionNotificationsEnabled}
        setPromptCompletionNotificationsEnabled={setPromptCompletionNotificationsEnabled}
        handlePromptCompletionNotificationsChange={handlePromptCompletionNotificationsChange}
        notificationPermissionState={notificationPermissionState}
        serverSettings={serverSettings}
        serverSettingsBusy={serverSettingsBusy}
        serverSettingsError={serverSettingsError}
        updateServerSetting={updateServerSetting}
        openSettingsDetail={openSettingsChild}
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
        logLevel={logLevel}
        setLogLevel={setLogLevel}
        requestLogout={requestLogout}
      />
    </React.Suspense>
  );

  const renderDesktopSettingsContent = () => (
    <SettingsDesktopSplit
      detail={desktopSettingsDetailPane}
      detailExiting={desktopSettingsDetailExiting}
      renderRoot={renderSettingsRootContent}
      renderDetail={renderSettingsDetailContent}
      onCloseDetail={handleMobileSettingsBackButton}
    />
  );

  const renderSettingsContent = () => (
    <SettingsSurface
      detailView={settingsDetailView}
      renderRoot={renderSettingsRootContent}
      renderDetail={renderSettingsDetailContent}
    />
  );

  const renderWheelMakerAppMenu = (mobile: boolean) => (
    <WheelMakerAppMenu
      themeMode={themeMode}
      setThemeMode={setThemeMode}
      onOpenSettings={handleDesktopSettingsSelect}
      onOpenPortRelay={openPortRelayScreen}
      onOpenShares={openShares}
      onOpenReleasePublishing={openReleasePublishing}
      updateController={clientUpdateController}
      triggerClassName={mobile
        ? 'chat-menu-icon-button chat-menu-settings-button chat-menu-product-button'
        : ''}
    />
  );

  const renderChatSessionHeader = (mobile: boolean) => {
    const searchHeaderExpanded = mobile && sessionSearchHeaderExpanded;
    const chatSessionHeaderClassName = `sidebar-title-row chat-session-header${searchHeaderExpanded ? ' search-open' : ''}${mobile ? ' mobile' : ''}`;
    const chatSessionHeaderContent = (
      <>
        {!searchHeaderExpanded ? (
          mobile ? renderWheelMakerAppMenu(true) : (
            <>
              {renderWheelMakerAppMenu(false)}
              {renderDesktopChatProjectSelector()}
            </>
          )
        ) : null}
        <div className="chat-sidebar-title-actions">
          {!searchHeaderExpanded ? renderChatHubSummary() : null}
          {mobile ? (
            <>
              {renderChatArchiveControls()}
              {renderChatHeaderSearchControls()}
            </>
          ) : null}
        </div>
      </>
    );
    return <div className={chatSessionHeaderClassName}>{chatSessionHeaderContent}</div>;
  };

  const renderMobileChatSessionSheet = () => {
    const viewProps = buildSessionListViewProps(true, true);
    return (
      <>
        {renderChatSessionHeader(true)}
        {renderArchiveBatchStatus()}
        {archivedMode ? (
          <SessionListView {...viewProps} />
        ) : (
          <ChatSessionNav
            className="mobile-project-session-nav"
            dataSessionListDensity={MOBILE_SESSION_LIST_DENSITY}
          >
            <SessionListView {...viewProps} />
          </ChatSessionNav>
        )}
      </>
    );
  };

  // Rendered at the top level (not inside the sidebar/drawer) so the sheet can
  // open from any entry point — e.g. the title-bar project dropdown's per-row
  // create button — even when the mobile drawer is closed.
  const renderMobileProjectActionSheet = () => {
    if (!mobileProjectActionMenu) {
      return null;
    }
    const sheetMenu = mobileProjectActionMenu;
    const sheetProject = sortedProjectItems.find(p => p.projectId === sheetMenu.projectId);
    if (!sheetProject) {
      return null;
    }
    const sheetProjectSessions = projectSessionsByProjectId[sheetMenu.projectId] ?? [];
    const sheetAgents = getWideProjectAgents(sheetProject, sheetProjectSessions);
    const sheetIsActions = sheetMenu.kind === 'actions';
    const sheetTitle = sheetIsActions
      ? 'Project Actions'
      : sheetMenu.kind === 'new'
        ? 'New Session'
        : 'Resume Session';
    const sheetIcon: SessionIconName = sheetIsActions
      ? 'list'
      : sheetMenu.kind === 'new'
        ? 'plus'
        : 'import';
    return (
      <>
        <div
          className={`sl-sheet-overlay${mobileProjectActionMenuExiting ? ' sl-menu-exit' : ''}`}
          onClick={() => setMobileProjectActionMenu(null)}
          aria-hidden="true"
        />
        <div
          className={`mobile-project-sheet${mobileProjectActionMenuExiting ? ' sl-menu-exit' : ''}`}
          {...contextMenuSurfaceProps}
          role="dialog"
          aria-modal="true"
          aria-label={sheetIsActions ? 'Project actions' : sheetMenu.kind === 'new' ? 'New session' : 'Resume session'}
        >
          <div className="mobile-project-sheet-grip" aria-hidden="true" />
          <div className="mobile-project-sheet-header">
            <SessionIcon name={sheetIcon} className="mobile-project-sheet-icon" />
            <span className="mobile-project-sheet-title-copy">
              <span className="mobile-project-sheet-title">
                {sheetTitle}
              </span>
              <span className="mobile-project-sheet-subtitle">{sheetProject.name}</span>
            </span>
            <button
              type="button"
              className="mobile-project-sheet-close"
              onClick={() => setMobileProjectActionMenu(null)}
              aria-label="Close"
            >
              <SessionIcon name="x" />
            </button>
          </div>
          <div className="mobile-project-sheet-body">
            {sheetMenu.kind === 'actions' ? (
              <>
                <button
                  type="button"
                  className="wide-project-action-menu-item mobile-project-sheet-item"
                  onClick={() => {
                    openMobileProjectActionMenu(sheetMenu.projectId, 'resume');
                  }}
                >
                  <SessionIcon name="import" />
                  <span className="mobile-project-sheet-item-label">Resume session</span>
                </button>
                <button
                  type="button"
                  className="wide-project-action-menu-item mobile-project-sheet-item"
                  onClick={() => {
                    togglePinnedProject(sheetMenu.projectId);
                    setMobileProjectActionMenu(null);
                  }}
                >
                  <SessionIcon name="pin" />
                  <span className="mobile-project-sheet-item-label">
                    {pinnedProjectIds.includes(sheetMenu.projectId) ? 'Unpin Project' : 'Pin Project'}
                  </span>
                </button>
              </>
            ) : sheetMenu.phase === 'agents' ? (
              <>
                <AgentChoiceMenu
                  key={`${sheetMenu.projectId}:sheet:${sheetMenu.kind}:agents`}
                  agents={sheetAgents}
                  variant="mobile"
                  defaultAgent={sheetProject.agent}
                  onSelect={agentType => {
                    if (sheetMenu.kind === 'new') {
                      handleMobileProjectCreateSession(sheetMenu.projectId, agentType).catch(() => undefined);
                    } else {
                      handleMobileProjectResumeAgent(sheetMenu.projectId, agentType).catch(() => undefined);
                    }
                  }}
                  onClose={() => setMobileProjectActionMenu(null)}
                />
                {sheetAgents.length === 0 ? (
                  <div className="wide-project-action-empty">
                    <SessionIcon name="ban" />
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
                  <SessionIcon name="arrowLeft" />
                  <span className="mobile-project-sheet-item-label">{agentDisplayLabel(sheetMenu.agentType)}</span>
                </button>
                {resumeLoading ? (
                  <div className="wide-project-action-empty">
                    <SessionIcon name="loader" spin />
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
                        <SessionIcon name="import" />
                        <span className="mobile-project-sheet-item-label">
                          {resolveSessionDisplayTitle(session) || session.sessionId}
                        </span>
                      </button>
                    ))
                  : null}
                {!resumeLoading && resumeSessions.length === 0 ? (
                  <div className="wide-project-action-empty">
                    <SessionIcon name="inbox" />
                    <span>No resumable sessions.</span>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </>
    );
  };

  const renderWideProjectActionMenu = (
    projectItem?: RegistryProject,
    projectSessions?: RegistryChatSession[],
    projectAgents?: string[],
  ) => {
    const actionMenu = wideProjectActionMenu;
    if (!actionMenu) return null;
    const actionProject = projectItem ?? sortedProjectItems.find(
      item => item.projectId === actionMenu.projectId,
    );
    if (!actionProject) return null;
    const targetProjectId = actionProject.projectId;
    const agents = projectAgents ?? getWideProjectAgents(
      actionProject,
      projectSessions ?? projectSessionsByProjectId[targetProjectId] ?? [],
    );
    return (
      <div
        ref={wideProjectActionMenuRef}
        className={`wide-project-action-popover sl-session-list-popover${wideProjectActionMenuExiting ? ' sl-menu-exit' : ''}`}
        {...contextMenuSurfaceProps}
        style={actionMenu.popover
          ? {
              top: `${actionMenu.popover.top}px`,
              left: `${actionMenu.popover.left}px`,
              width: `${actionMenu.popover.width}px`,
              maxHeight: `${actionMenu.popover.maxHeight}px`,
              ...({
                '--sl-popover-origin': actionMenu.popover.placement === 'above'
                  ? 'bottom center'
                  : 'top center',
              } as React.CSSProperties),
              ...(actionMenu.popover.placement === 'above'
                ? {'--sl-popover-shift': 'translateY(-100%)'} as React.CSSProperties
                : {}),
            }
          : undefined}
      >
        <div className="wide-project-action-title">
          <SessionIcon name={actionMenu.kind === 'actions' ? 'list' : actionMenu.kind === 'new' ? 'plus' : 'import'} />
          <span className="wide-project-action-title-copy">
            <span className="wide-project-action-title-main">
              {actionMenu.kind === 'actions'
                ? 'Project Actions'
                : actionMenu.kind === 'new'
                  ? 'New Session'
                  : 'Resume Session'}
            </span>
            <span className="wide-project-action-title-sub">{actionProject.name}</span>
          </span>
        </div>
        {actionMenu.kind === 'actions' ? (
          <>
            <button
              type="button"
              className="wide-project-action-menu-item"
              onClick={() => {
                resetProjectResumeState();
                setWideProjectActionMenu({
                  ...actionMenu,
                  kind: 'resume',
                  phase: 'agents',
                  agentType: '',
                });
              }}
            >
              <SessionIcon name="import" />
              <span>Resume session</span>
            </button>
            <button
              type="button"
              className="wide-project-action-menu-item"
              onClick={() => {
                togglePinnedProject(targetProjectId);
                setWideProjectActionMenu(null);
              }}
            >
              <SessionIcon name="pin" />
              <span>{pinnedProjectIds.includes(targetProjectId) ? 'Unpin Project' : 'Pin Project'}</span>
            </button>
          </>
        ) : actionMenu.phase === 'agents' ? (
          <>
            <AgentChoiceMenu
              key={`${targetProjectId}:${actionMenu.kind}:agents`}
              agents={agents}
              variant="wide"
              defaultAgent={actionProject.agent}
              onSelect={agentType => {
                if (actionMenu.kind === 'new') {
                  handleWideProjectCreateSession(targetProjectId, agentType).catch(() => undefined);
                } else {
                  handleWideProjectResumeAgent(targetProjectId, agentType).catch(() => undefined);
                }
              }}
              onClose={() => setWideProjectActionMenu(null)}
            />
            {agents.length === 0 ? (
              <div className="wide-project-action-empty">
                <SessionIcon name="ban" />
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
                setWideProjectActionMenu({...actionMenu, phase: 'agents', agentType: ''});
              }}
            >
              <SessionIcon name="arrowLeft" />
              <span>{agentDisplayLabel(actionMenu.agentType)}</span>
            </button>
            {resumeLoading ? (
              <div className="wide-project-action-empty">
                <SessionIcon name="loader" spin />
                <span>Loading sessions...</span>
              </div>
            ) : null}
            {!resumeLoading ? resumeSessions.map(session => (
              <button
                key={`${targetProjectId}:resume:${session.sessionId}`}
                type="button"
                className="wide-project-action-menu-item"
                onClick={() => {
                  handleWideProjectResumeImport(
                    targetProjectId,
                    actionMenu.agentType,
                    session.sessionId,
                  ).catch(() => undefined);
                }}
              >
                <SessionIcon name="import" />
                <span>{resolveSessionDisplayTitle(session) || session.sessionId}</span>
              </button>
            )) : null}
            {!resumeLoading && resumeSessions.length === 0 ? (
              <div className="wide-project-action-empty">
                <SessionIcon name="inbox" />
                <span>No resumable sessions.</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  };

  const sessionListMode = archivedMode ? 'archived' : sessionSearchActive ? 'search' : 'normal';

  const buildSessionListViewProps = (mobile: boolean, showRecentHeading: boolean) => ({
    mobile,
    mode: sessionListMode as 'normal' | 'archived' | 'search',
    hasProjects: projects.length > 0,
    recentGroups: recentSessionSections.map(section => ({
      projectId: section.projectId,
      projectName: section.projectName || section.projectId,
      hubLabel: section.projectHubId || 'local',
      hubVariantClass: tagVariantClass('wide-project-hub', section.projectHubId || 'local'),
      hubAccentStyle: hubAccentStyle(section.projectHubId || 'local'),
      sessions: section.sessions.map(snapshot =>
        projectSessionsByProjectId[section.projectId]?.find(item => item.sessionId === snapshot.sessionId) ?? snapshot,
      ),
    })),
    recentCollapsed: collapsedProjectIds.includes(RECENT_SESSIONS_VIRTUAL_PROJECT_ID),
    showRecentHeading,
    onToggleRecent: () => toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID),
    projectItems: sessionSearchActive ? sessionSearchFilter.projects : visibleProjectItems,
    activeProjectId: projectId,
    collapsedProjectIds,
    pinnedProjectIds,
    sessionsByProjectId: sessionSearchActive ? sessionSearchFilter.sessionsByProjectId : projectSessionsByProjectId,
    draftSessionsByProjectId,
    olderExpandedByProjectId: olderSessionsExpandedByProjectId,
    selectedChatEncodedKey,
    pinningSessionKey: chatPinningSessionKey,
    mobileSessionErrors: mobileProjectSessionErrors,
    onRetryMobileSessions: () => refreshMobileChatProjectSessions().catch(() => undefined),
    resolveTitle: (session: {sessionId: string; title?: string}) => resolveSessionDisplayTitle(session as RegistrySessionSummary),
    projectHubClass: (hubId: string) => tagVariantClass('wide-project-hub', hubId),
    hubAccentStyle,
    formatAge: formatCompactRelativeAge,
    runtimeKey: buildChatRuntimeKey,
    sessionActionKey: projectSessionActionKey,
    renderLeadingState: (session: {sessionId: string}, targetProjectId: string) =>
      renderSessionLeadingState(session as RegistryChatSession, targetProjectId),
    splitOlder: (targetProjectId: string, sessions: Array<{sessionId: string; updatedAt?: string}>) => {
      const expanded = olderSessionsExpandedByProjectId[targetProjectId] === true;
      const split = splitOlderProjectSessions({sessions: sessions as RegistryChatSession[], nowMs: Date.now(), olderThanDays: OLDER_SESSION_DAYS, expanded});
      return {visibleSessions: split.visibleSessions as Array<{sessionId: string; updatedAt?: string}>, showToggle: split.showToggle, hiddenOlderCount: split.hiddenOlderCount};
    },
    onSelectSession: (targetProjectId: string, sessionId: string) => {
      if (sessionSearchActive) {
        handleSessionSearchResultClick(targetProjectId, sessionId, {
          closeMobileDrawer: mobile,
        }).catch(() => undefined);
        return;
      }
      if (mobile) {
        selectProjectChatSession(targetProjectId, sessionId, {closeMobileDrawer: true}).catch(() => undefined);
      } else {
        selectWideProjectSession(targetProjectId, sessionId).catch(() => undefined);
      }
    },
    onSelectDraft: (targetProjectId: string, draftId: string) =>
      selectDraftChatSession(targetProjectId, draftId, {closeMobileDrawer: mobile}),
    onDismissDraft: (targetProjectId: string, draftId: string) => dismissDraftChatSession(targetProjectId, draftId),
    onUnpinSession: (targetProjectId: string, sessionId: string) =>
      handlePinProjectSession(targetProjectId, sessionId, false).catch(() => undefined),
    onToggleProjectCollapsed: toggleWideProjectCollapsed,
    onTogglePinnedProject: togglePinnedProject,
    onToggleOlder: toggleOlderSessionsExpanded,
    onOpenProjectMenu: (targetProjectId: string, kind: 'new' | 'resume', anchor: HTMLElement | null) => {
      if (mobile) {
        openMobileProjectActionMenu(targetProjectId, kind);
      } else {
        openWideProjectActionMenu(targetProjectId, kind, anchor);
      }
    },
    onOpenSessionContextMenu: openProjectSessionContextMenu,
    onOpenProjectContextMenu: openProjectContextMenu,
    emptyProjectsHint: mobile ? (
      <div className="chat-empty-hint chat-empty-state">
        <SessionIcon name="inbox" size={28} />
        <span>No projects available.</span>
      </div>
    ) : (
      <div className="chat-empty-hint">No projects available.</div>
    ),
    hiddenProjectRows: renderHiddenProjectRows(mobile),
    archivedRows: renderArchivedSessionRows(mobile),
    searchStatus: sessionSearchFilter.projects.length === 0 ? (
      <div className="wide-project-empty session-search-empty">
        {sessionSearchStatus}
      </div>
    ) : null,
  });

  const renderWideProjectSessionNav = (options?: { includeRecent?: boolean }) => {
    const includeRecent = options?.includeRecent !== false;
    const viewProps = buildSessionListViewProps(false, includeRecent);
    return (
      <ChatSessionNav
        className="wide-project-session-nav"
        dataSessionListDensity={DESKTOP_SESSION_LIST_DENSITY}
      >
        {renderArchiveBatchStatus()}
        <SessionListView
          {...viewProps}
          recentGroups={archivedMode || !includeRecent ? [] : viewProps.recentGroups}
        />
      </ChatSessionNav>
    );
  };

  const renderSidebar = () => {
    const mobileSidebarMain = !isWide ? renderMobileChatSessionSheet() : null;
    const showPinnedChatSessionPanel = desktopChatSessionPinned;
    const wideSidebarMain = renderWideProjectSessionNav();

    return (
      <>
        {showPinnedChatSessionPanel ? (
          <ChatSessionPanel
            mode="pinned"
            title="Sessions"
            className="chat-pinned-session-panel"
            header={
              <ChatSessionGlobalBar
                pinActive
                onTogglePin={unpinChatSessionPanel}
                leading={
                  <>
                    {renderChatArchiveControls()}
                    {renderChatHeaderSearchControls()}
                  </>
                }
              />
            }
          >
            {wideSidebarMain}
          </ChatSessionPanel>
        ) : isWide ? (
          (
            <DesktopDragRegion className="sidebar-title-row">
              <span className="sidebar-title-text">CHAT</span>
            </DesktopDragRegion>
          )
        ) : null}
        {showPinnedChatSessionPanel ? null : (
          <div className="sidebar-scroll">
            {isWide ? wideSidebarMain : mobileSidebarMain}
          </div>
        )}
        {isWide && !showPinnedChatSessionPanel ? (
          <button
            type="button"
            className={`desktop-sidebar-resize-handle${desktopSidebarResizing ? ' resizing' : ''}`}
            aria-label="Resize sidebar"
            data-tooltip="Resize sidebar"
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


  const resolveChatFileLink = (
    href: string,
    projectRoot = currentProject?.path ?? '',
  ): PreviewFileLink | null =>
    resolvePreviewFileLink(href, projectRoot);
  const openManagedFileContextMenu = useCallback((
    target: ManagedFileMenuTarget,
    position: {x: number; y: number},
  ) => {
    setChatFileLinkMenu({
      ...target,
      x: Math.min(position.x, Math.max(8, window.innerWidth - 228)),
      y: Math.min(position.y, Math.max(8, window.innerHeight - 280)),
    });
  }, [setChatFileLinkMenu]);
  const bindManagedFileContextMenu = useContextMenuTargetGesture<ManagedFileMenuTarget>(
    openManagedFileContextMenu,
  );
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
            data-tooltip="Open through Port Relay"
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
        framed: true,
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
        const fileMenuTarget: ManagedFileMenuTarget | null = targetFile ? {
          projectId: linkProjectId,
          projectRoot: linkProjectRoot,
          targetKind: targetFile.relativePath === null ? 'external-file' : 'project-file',
          link: targetFile,
          fileAvailable: true,
          downloadSource: fileDownloadSourceForLink(targetFile),
          attachment: null,
        } : null;

        return (
          <a
            {...rest}
            {...(fileMenuTarget ? bindManagedFileContextMenu(fileMenuTarget) : {})}
            className={[
              rest.className,
              isFileLink ? 'chat-file-link' : '',
              relayLocalUrl ? 'chat-relay-link' : '',
            ].filter(Boolean).join(' ') || undefined}
            href={fallbackHref}
            target={isFileLink || relayLocalUrl ? undefined : '_blank'}
            rel={isFileLink || relayLocalUrl ? undefined : 'noreferrer'}
            data-tooltip={
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
              {isFileLink ? (
                <ChatIcon name="file" className="chat-file-link-icon" />
              ) : null}
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
      bindManagedFileContextMenu,
      openChatFilePeek,
      openChatPortRelayLink,
      projects,
      renderChatInlineCode,
      resolveChatFilePreviewProjectId,
    ],
  );

  const findPromptRequestForDone = useCallback((doneTurnIndex: number): RegistryChatMessage | undefined => {
    return findPromptStartForDone(selectedFullChatMessages, doneTurnIndex);
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

  const createMarkdownImageResolver = useCallback((
    exportProjectId: string,
    sourcePath: string,
    external = false,
  ): MarkdownHtmlImageResolver => async source => {
    if (/^data:image\//i.test(source)) {
      return {src: source};
    }
    const projectImagePath = external
      ? resolveExternalMarkdownImagePath(sourcePath, source)
      : resolveProjectMarkdownImagePath(sourcePath, source);
    if (projectImagePath !== null) {
      if (!exportProjectId) {
        return {
          src: '',
          fatal: true,
          warning: `Unable to embed project image: ${source}`,
        };
      }
      try {
        const image = external
          ? await service.readExternalFile(exportProjectId, projectImagePath)
          : await service.readProjectFile(projectImagePath, exportProjectId);
        const mimeType = image.mimeType || '';
        if (
          !image.isBinary ||
          image.encoding !== 'base64' ||
          !image.content ||
          !mimeType.toLowerCase().startsWith('image/')
        ) {
          return {
            src: '',
            fatal: true,
            warning: `Unable to embed project image: ${source}`,
          };
        }
        return {src: `data:${mimeType};base64,${image.content}`};
      } catch (error) {
        return {
          src: '',
          fatal: true,
          warning: `Unable to embed project image: ${source} (${error instanceof Error ? error.message : String(error)})`,
        };
      }
    }
    if (/^https?:\/\//i.test(source)) {
      try {
        const response = await fetch(source);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        const mimeType = (blob.type || response.headers.get('content-type') || '')
          .split(';', 1)[0]
          .trim();
        if (!mimeType.toLowerCase().startsWith('image/')) {
          throw new Error('response is not an image');
        }
        return {
          src: `data:${mimeType};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`,
        };
      } catch (error) {
        return {
          src: source,
          warning: `Remote image remains linked: ${source} (${error instanceof Error ? error.message : String(error)})`,
        };
      }
    }
    return {
      src: source,
      warning: `Image remains linked: ${source}`,
    };
  }, [service]);

  const startMarkdownHtmlExport = async ({
    content,
    title,
    fileName,
    projectId: exportProjectId,
    sourcePath,
    external = false,
    key,
  }: StartMarkdownHtmlExportInput) => {
    if (exportingMarkdownHtmlKey) {
      return;
    }
    setError('');
    setExportingMarkdownHtmlKey(key);
    let userActionToken: string | undefined;
    try {
      userActionToken = await reserveMarkdownHtmlShare();
    } catch (error) {
      setExportingMarkdownHtmlKey('');
      setError(`Failed to share HTML: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const imageResolver = createMarkdownImageResolver(exportProjectId, sourcePath, external);

    markdownHtmlExportIdRef.current += 1;
    setMarkdownHtmlExportRequest({
      id: markdownHtmlExportIdRef.current,
      content,
      title,
      fileName,
      imageResolver,
      themeMode,
      codeTheme,
      codeFont,
      codeFontSize,
      codeLineHeight,
      codeTabSize,
      userActionToken,
    });
  };

  const selectedChatMessageLifecycleSupported = archivedMode
    ? hasMessageLifecycleFeature(archivedPreview?.session, true)
    : hasMessageLifecycleFeature(selectedChatSession);

  const buildFrozenChatShareSnapshot = useCallback((
    action: Pick<ChatShareAction, 'scope' | 'includeWorkDetails'>,
    doneTurnIndex: number,
  ): ChatShareSnapshot | null => {
    const sessionKey = archivedMode ? selectedArchivedKey : selectedChatKey;
    if (!sessionKey) return null;
    const title = archivedMode
      ? resolveSessionDisplayTitle(archivedPreview?.session) || archivedPreview?.sessionId || sessionKey.sessionId
      : selectedChatDisplayTitle || sessionKey.sessionId;
    const context = {
      projectId: sessionKey.projectId,
      sessionId: sessionKey.sessionId,
      title,
      capturedAt: new Date().toISOString(),
      presentation: {
        themeMode,
        codeTheme,
        codeFont,
        codeFontSize,
        codeLineHeight,
        codeTabSize,
      },
    };
    const contentOptions = {
      messageLifecycleSupported: selectedChatMessageLifecycleSupported,
      includeWorkDetails: action.includeWorkDetails,
    };
    return action.scope === 'response'
      ? buildResponseChatShareSnapshot(selectedFullChatMessages, doneTurnIndex, context, contentOptions)
      : buildSessionChatShareSnapshot(selectedFullChatMessages, context, contentOptions);
  }, [
    archivedMode,
    archivedPreview?.session,
    archivedPreview?.sessionId,
    codeFont,
    codeFontSize,
    codeLineHeight,
    codeTabSize,
    codeTheme,
    resolveSessionDisplayTitle,
    selectedArchivedKey,
    selectedChatDisplayTitle,
    selectedChatKey,
    selectedChatMessageLifecycleSupported,
    selectedFullChatMessages,
    themeMode,
  ]);

  const sessionChatShareAvailable = useMemo(
    () => buildFrozenChatShareSnapshot({scope: 'session', includeWorkDetails: false}, 0) !== null,
    [buildFrozenChatShareSnapshot],
  );

  const handleChatShareAction = async (doneTurnIndex: number, action: ChatShareAction) => {
    if (chatShareCaptureTask) return;
    const snapshot = buildFrozenChatShareSnapshot(action, doneTurnIndex);
    if (!snapshot) return;
    setError('');

    if (action.format === 'public_url') {
      openShareCreate({
        sourceType: action.scope === 'response' ? 'chat_response' : 'chat_session',
        projectId: snapshot.projectId,
        sessionId: snapshot.sessionId,
        ...(action.scope === 'response' ? {turnIndex: snapshot.terminalTurnIndex ?? doneTurnIndex} : {}),
        sessionTitle: snapshot.title,
        title: snapshot.title,
        snapshot,
      } as ShareManagerChatSource);
      return;
    }

    if (action.format === 'html') {
      setPromptMarkdownHtmlExportDraft({
        snapshot,
        action,
        fileNameStem: action.scope === 'session'
          ? buildSessionChatShareFileStem(snapshot)
          : buildPromptMarkdownHtmlFileStem(),
      });
      return;
    }

    if (chatShareReservationPendingRef.current) return;
    chatShareReservationPendingRef.current = true;
    let userActionToken: string | undefined;
    try {
      userActionToken = await reserveResponseImageShare();
    } catch (error) {
      setError(`Failed to share image: ${error instanceof Error ? error.message : String(error)}`);
      return;
    } finally {
      chatShareReservationPendingRef.current = false;
    }
    chatShareCaptureIdRef.current += 1;
    setChatShareCaptureTask({
      id: chatShareCaptureIdRef.current,
      mode: 'image',
      snapshot,
      widthMode: isWide ? 'desktop' : 'mobile',
      imageResolver: createMarkdownImageResolver(snapshot.projectId, ''),
      action,
      purpose: 'local',
      fileName: action.scope === 'response'
        ? buildPromptMarkdownImageFileName(doneTurnIndex)
        : `${buildSessionChatShareFileStem(snapshot)}.png`,
      userActionToken,
    });
  };
  const copyPromptDoneMarkdownEvent = useStableEvent(copyPromptDoneMarkdown);
  const readAloudPromptDoneEvent = useStableEvent(readAloudPromptDone);
  const handleChatShareActionEvent = useStableEvent(handleChatShareAction);

  const completeChatShareCapture = useCallback(async (result: ChatShareCaptureResult) => {
    const task = chatShareCaptureTask;
    if (!task || task.mode !== result.mode) return;
    if (task.purpose === 'public') {
      const pending = chatShareCapturePendingRef.current;
      chatShareCapturePendingRef.current = null;
      setChatShareCaptureTask(null);
      if (pending) {
        pending.resolve(createChatShareSnapshot({
          title: pending.source.title,
          html: result.mode === 'html' ? result.html : '',
          warnings: result.unresolvedImageUrls.map(source => ({
            source,
            message: `Image remains linked: ${source}`,
          })),
        }));
      }
      return;
    }

    try {
      if (result.mode === 'image') {
        const output = await outputResponseImage({
          blob: result.blob,
          fileName: task.fileName || 'wheelmaker-chat.png',
          userActionToken: task.userActionToken,
        });
        if (!output.ok) throw new Error(output.error || output.status);
        if (output.status === 'copied') {
          setToastMessage('Image copied to clipboard.');
        } else if (output.status === 'shared') {
          setToastMessage('Image shared.');
        } else {
          setToastMessage('Image downloaded.');
        }
      } else {
        const output = await outputMarkdownHtml({
          html: result.html,
          fileName: task.fileName || 'wheelmaker-chat.html',
          userActionToken: task.userActionToken,
        });
        if (!output.ok) throw new Error(output.error || output.status);
        const delivery = output.status === 'copied'
          ? 'HTML file copied to clipboard.'
          : output.status === 'shared'
            ? 'HTML file shared.'
            : 'HTML file downloaded.';
        setToastMessage(result.unresolvedImageUrls.length > 0
          ? `${delivery} ${result.unresolvedImageUrls.length} image link(s) remain remote.`
          : delivery);
      }
      setChatShareCaptureTask(null);
    } catch (error) {
      setChatShareCaptureTask(null);
      setError(`Failed to share ${result.mode}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [chatShareCaptureTask]);

  const failChatShareCapture = useCallback((message: string) => {
    const task = chatShareCaptureTask;
    if (!task) return;
    if (task.purpose === 'public') {
      const pending = chatShareCapturePendingRef.current;
      chatShareCapturePendingRef.current = null;
      pending?.reject(new Error(message));
    } else {
      setError(`Failed to share ${task.mode}: ${message}`);
    }
    setChatShareCaptureTask(null);
  }, [chatShareCaptureTask]);

  const completeMarkdownHtmlExport = useCallback(async (
    result: {html: string; unresolvedImageUrls: string[]},
  ) => {
    const request = markdownHtmlExportRequest;
    if (!request) return;
    try {
      const output = await outputMarkdownHtml({
        html: result.html,
        fileName: request.fileName,
        userActionToken: request.userActionToken,
      });
      if (!output.ok) {
        throw new Error(output.error || output.status);
      }
      const delivery = output.status === 'copied'
        ? 'HTML file copied to clipboard.'
        : output.status === 'shared'
          ? 'HTML file shared.'
          : 'HTML file downloaded.';
      setToastMessage(result.unresolvedImageUrls.length > 0
        ? `${delivery} ${result.unresolvedImageUrls.length} image link(s) remain remote.`
        : delivery);
      setMarkdownHtmlExportRequest(null);
      setExportingMarkdownHtmlKey('');
    } catch (error) {
      setMarkdownHtmlExportRequest(null);
      setExportingMarkdownHtmlKey('');
      setError(`Failed to export HTML: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [markdownHtmlExportRequest]);

  const failMarkdownHtmlExport = useCallback((message: string) => {
    setMarkdownHtmlExportRequest(null);
    setExportingMarkdownHtmlKey('');
    setError(`Failed to export HTML: ${message}`);
  }, []);

  const completeMarkdownShareCapture = useCallback((
    result: {html: string; unresolvedImageUrls: string[]},
  ) => {
    const pending = markdownShareCapturePendingRef.current;
    if (!pending) return;
    markdownShareCapturePendingRef.current = null;
    setMarkdownShareCaptureRequest(null);
    pending.resolve(createMarkdownShareSnapshot({
      title: pending.source.title,
      html: result.html,
      warnings: result.unresolvedImageUrls.map(source => ({
        source,
        message: `Image remains linked: ${source}`,
      })),
    }));
  }, []);

  const failMarkdownShareCapture = useCallback((message: string) => {
    const pending = markdownShareCapturePendingRef.current;
    if (!pending) return;
    markdownShareCapturePendingRef.current = null;
    setMarkdownShareCaptureRequest(null);
    pending.reject(new Error(message));
  }, []);

  const captureShareSource = useCallback(async (source: ShareManagerSource): Promise<ShareSnapshot> => {
    if (!isShareManagerProjectSource(source)) {
      if (chatShareCaptureTask) {
        throw new Error('Another chat share capture is already in progress.');
      }
      return new Promise<ShareSnapshot>((resolve, reject) => {
        const previous = chatShareCapturePendingRef.current;
        if (previous) {
          previous.reject(new Error('Another chat share capture is already in progress.'));
        }
        chatShareCapturePendingRef.current = {source, resolve, reject};
        chatShareCaptureIdRef.current += 1;
        setChatShareCaptureTask({
          id: chatShareCaptureIdRef.current,
          mode: 'html',
          snapshot: source.snapshot,
          widthMode: isWide ? 'desktop' : 'mobile',
          imageResolver: createMarkdownImageResolver(source.projectId, ''),
          action: {scope: source.snapshot.scope, format: 'public_url', includeWorkDetails: false},
          purpose: 'public',
        });
      });
    }
    if (source.kind === 'html') {
      const file = source.content !== undefined
        ? {content: source.content, isBinary: false}
        : source.external
          ? await service.readExternalFile(source.projectId, source.path)
          : await service.readProjectFile(source.path, source.projectId);
      if (file.isBinary) {
        throw new Error('HTML file content is unavailable.');
      }
      return createHtmlShareSnapshot({title: source.title, source: file.content});
    }

    const file = source.content !== undefined
      ? {content: source.content, isBinary: false}
      : source.external
        ? await service.readExternalFile(source.projectId, source.path)
        : await service.readProjectFile(source.path, source.projectId);
    if (file.isBinary) {
      throw new Error('Markdown file content is unavailable.');
    }

    const imageResolver = async (imageSource: string): Promise<MarkdownHtmlImageResolution> => {
      if (/^data:image\//i.test(imageSource)) {
        return {src: imageSource};
      }
      const projectImagePath = source.external
        ? resolveExternalMarkdownImagePath(source.path, imageSource)
        : resolveProjectMarkdownImagePath(source.path, imageSource);
      if (projectImagePath !== null) {
        try {
          const image = source.external
            ? await service.readExternalFile(source.projectId, projectImagePath)
            : await service.readProjectFile(projectImagePath, source.projectId);
          const mimeType = image.mimeType || '';
          if (
            !image.isBinary ||
            image.encoding !== 'base64' ||
            !image.content ||
            !mimeType.toLowerCase().startsWith('image/')
          ) {
            return {
              src: '',
              fatal: true,
              warning: `Unable to embed project image: ${imageSource}`,
            };
          }
          return {src: `data:${mimeType};base64,${image.content}`};
        } catch (error) {
          return {
            src: '',
            fatal: true,
            warning: `Unable to embed project image: ${imageSource} (${error instanceof Error ? error.message : String(error)})`,
          };
        }
      }
      if (/^https?:\/\//i.test(imageSource)) {
        try {
          const response = await fetch(imageSource);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          const mimeType = (blob.type || response.headers.get('content-type') || '')
            .split(';', 1)[0]
            .trim();
          if (!mimeType.toLowerCase().startsWith('image/')) {
            throw new Error('response is not an image');
          }
          return {
            src: `data:${mimeType};base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`,
          };
        } catch (error) {
          return {
            src: imageSource,
            warning: `Remote image remains linked: ${imageSource} (${error instanceof Error ? error.message : String(error)})`,
          };
        }
      }
      return {src: imageSource, warning: `Image remains linked: ${imageSource}`};
    };

    return new Promise<ShareSnapshot>((resolve, reject) => {
      const previous = markdownShareCapturePendingRef.current;
      if (previous) {
        previous.reject(new Error('Another share capture is already in progress.'));
      }
      markdownShareCapturePendingRef.current = {source, resolve, reject};
      markdownShareCaptureIdRef.current += 1;
      setMarkdownShareCaptureRequest({
        id: markdownShareCaptureIdRef.current,
        content: file.content,
        title: source.title,
        imageResolver,
        themeMode,
        codeTheme,
        codeFont,
        codeFontSize,
        codeLineHeight,
        codeTabSize,
      });
    });
  }, [
    chatShareCaptureTask,
    codeFont,
    codeFontSize,
    codeLineHeight,
    codeTabSize,
    codeTheme,
    createMarkdownImageResolver,
    isWide,
    service,
    themeMode,
  ]);

  const promptMarkdownHtmlExportNameError = promptMarkdownHtmlExportDraft
    ? validateMarkdownHtmlFileStem(promptMarkdownHtmlExportDraft.fileNameStem)
    : '';
  const submitPromptMarkdownHtmlExport = async () => {
    const draft = promptMarkdownHtmlExportDraft;
    if (!draft || promptMarkdownHtmlExportNameError || chatShareCaptureTask) {
      return;
    }
    if (chatShareReservationPendingRef.current) return;
    chatShareReservationPendingRef.current = true;
    let userActionToken: string | undefined;
    try {
      userActionToken = await reserveMarkdownHtmlShare();
    } catch (error) {
      setPromptMarkdownHtmlExportDraft(null);
      setError(`Failed to share HTML: ${error instanceof Error ? error.message : String(error)}`);
      return;
    } finally {
      chatShareReservationPendingRef.current = false;
    }
    const {fileNameStem, snapshot, action} = draft;
    setPromptMarkdownHtmlExportDraft(null);
    chatShareCaptureIdRef.current += 1;
    setChatShareCaptureTask({
      id: chatShareCaptureIdRef.current,
      mode: 'html',
      snapshot,
      widthMode: isWide ? 'desktop' : 'mobile',
      imageResolver: createMarkdownImageResolver(snapshot.projectId, ''),
      action,
      purpose: 'local',
      fileName: buildMarkdownHtmlFileNameFromStem(fileNameStem),
      userActionToken,
    });
  };

  const openPromptArtifactFileContextMenu = useCallback((
    _artifact: RegistrySessionPromptArtifact,
    _message: RegistryChatMessage,
    file: RegistrySessionPromptArtifactFile,
    position: {x: number; y: number},
  ) => {
    const targetProjectId =
      selectedArchivedKey?.projectId ||
      selectedChatKey?.projectId ||
      projectId;
    const targetProject = projects.find(project => project.projectId === targetProjectId);
    const targetFile = targetProject
      ? resolvePreviewFileLink(file.path, targetProject.path)
      : null;
    if (!targetProjectId || !targetProject || !targetFile) {
      return;
    }
    openManagedFileContextMenu({
      projectId: targetProjectId,
      projectRoot: targetProject.path,
      targetKind: targetFile.relativePath === null ? 'external-file' : 'changed-file',
      link: targetFile,
      fileAvailable: file.status.toUpperCase() !== 'D',
      downloadSource: file.status.toUpperCase() !== 'D'
        ? fileDownloadSourceForLink(targetFile)
        : null,
      attachment: null,
    }, position);
  }, [
    openManagedFileContextMenu,
    projectId,
    projects,
    selectedArchivedKey?.projectId,
    selectedChatKey?.projectId,
  ]);

  const openPromptAttachmentContextMenu = useCallback((
    block: RegistrySessionContentBlock,
    message: RegistryChatMessage,
    position: {x: number; y: number},
  ) => {
    const targetProjectId =
      selectedArchivedKey?.projectId ||
      selectedChatKey?.projectId ||
      projectId;
    const targetProject = projects.find(project => project.projectId === targetProjectId);
    const source = sessionAttachmentDownloadSource({
      sessionId: message.sessionId || '',
      attachmentId: attachmentIdFromBlock(block) || undefined,
      uri: block.uri,
    });
    if (!targetProjectId || !targetProject || !source) {
      return;
    }
    openManagedFileContextMenu({
      projectId: targetProjectId,
      projectRoot: targetProject.path,
      targetKind: 'attachment',
      link: null,
      fileAvailable: true,
      downloadSource: source,
      attachment: {block, message},
    }, position);
  }, [
    openManagedFileContextMenu,
    projectId,
    projects,
    selectedArchivedKey?.projectId,
    selectedChatKey?.projectId,
  ]);

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
      findPromptStartForDone(promptMessages, message.turnIndex ?? 0) ||
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
          activeFilePath: initialPath || initialFiles[0]?.path || '',
        }),
        artifactProjectId,
        tabId,
        requestSeq,
      ),
    );
    if (!isWide) {
      setDrawerOpen(false);
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
                activeFilePath: files.some(file => file.path === tab.activeFilePath)
                  ? tab.activeFilePath
                  : resolvePromptDiffActiveFilePath(
                      files,
                      initialPath || initialFiles[0]?.path || '',
                    ),
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
              activeFilePath: path,
              files: item.files.map(file =>
                file.path === path ? {...file, expanded: !file.expanded} : file,
              ),
            }
          : item,
      ),
    );
  }, []);
  const toggleGitDiffPreviewFile = useCallback((path: string) => {
    const tab = activePreviewTab(previewWorkbenchRef.current);
    if (!tab || tab.type !== 'git-diff') {
      return;
    }
    setPreviewWorkbench(current =>
      updatePreviewTab(current, tab.projectId, tab.id, item =>
        item.type === 'git-diff'
          ? {
              ...item,
              activeFilePath: path,
              files: item.files.map(file =>
                file.path === path ? {...file, expanded: !file.expanded} : file,
              ),
            }
          : item,
      ),
    );
  }, []);

  const selectedChatHasOpenPromptTurn = selectedPromptTurnStatusIndex.hasOpenPrompt;
  const selectedChatCompactionRunning = useMemo(() => {
    if (
      selectedSessionQueue?.activeItem?.kind === 'compact' &&
      selectedSessionQueue.activeItem.status === 'running'
    ) {
      return true;
    }
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
  }, [chatCompactingByKey, selectedChatEncodedKey, selectedFullChatMessages, selectedSessionQueue]);
  const selectedQueueActivePrompt = selectedSessionQueue?.activeItem?.kind === 'prompt'
    ? selectedSessionQueue.activeItem
    : undefined;
  const selectedChatPromptRunning =
    !!selectedChatEncodedKey &&
    !selectedPendingPrompt &&
    (
      selectedQueueActivePrompt?.status === 'running' ||
      selectedQueueActivePrompt?.status === 'cancelling' ||
      (selectedGoal?.status === 'active' && selectedChatSession?.running === true) ||
      selectedChatHasOpenPromptTurn
    );
  const selectedActiveToolGroupKey = useMemo(
    () => resolveActiveToolGroupKey(chatDisplayIndex, selectedChatPromptRunning),
    [chatDisplayIndex, selectedChatPromptRunning],
  );
  const selectedChatExecutionRunning = selectedChatPromptRunning || selectedChatCompactionRunning;
  const queuedPromptCanSteer =
    selectedChatSession?.sessionActions?.steer?.supported === true &&
    selectedQueueActivePrompt?.status === 'running';
  const chatSendDisabled = selectedChatSubmitPending || chatAttachmentUploadPending || !!selectedActivePermission;
  const submitChatPermission = useCallback(async (optionId: string) => {
    const activePermission = selectedActivePermission;
    const selectedKey = selectedChatKey;
    if (
      !connected ||
      !activePermission ||
      !selectedKey ||
      permissionSubmission.optionId
    ) {
      return;
    }
    const runtimeKey = encodeChatSessionKey(selectedKey);
    setPermissionSubmission({
      runtimeKey,
      permissionId: activePermission.permissionId,
      optionId,
      error: '',
    });
    try {
      await service.respondProjectSessionPermission(
        selectedKey.projectId,
        selectedKey.sessionId,
        activePermission.permissionId,
        optionId,
      );
      await refreshSessionTurns(selectedKey.sessionId, selectedKey.projectId, runtimeKey);
    } catch (err) {
      const responseError = err instanceof Error ? err.message : String(err);
      await refreshSessionTurns(selectedKey.sessionId, selectedKey.projectId, runtimeKey);
      setPermissionSubmission(current => (
        current.runtimeKey === runtimeKey && current.permissionId === activePermission.permissionId
          ? {...current, optionId: '', error: responseError}
          : current
      ));
    }
  }, [
    connected,
    permissionSubmission.optionId,
    selectedActivePermission,
    selectedChatKey,
  ]);

  useEffect(() => {
    const runtimeKey = selectedChatKey ? encodeChatSessionKey(selectedChatKey) : '';
    if (
      !selectedActivePermission ||
      permissionSubmission.runtimeKey !== runtimeKey ||
      permissionSubmission.permissionId !== selectedActivePermission.permissionId
    ) {
      if (permissionSubmission.runtimeKey || permissionSubmission.permissionId || permissionSubmission.optionId || permissionSubmission.error) {
        setPermissionSubmission({runtimeKey: '', permissionId: '', optionId: '', error: ''});
      }
    }
  }, [permissionSubmission, selectedActivePermission, selectedChatKey]);
  const selectedChatPromptCancelling =
    selectedQueueActivePrompt?.status === 'cancelling' ||
    (!!selectedChatEncodedKey && chatCancellingRuntimeKey === selectedChatEncodedKey);
  const [chatStopPillVisible, setChatStopPillVisible, chatStopPillExiting] = useMenuExitFlag();
  useEffect(() => {
    setChatStopPillVisible(selectedChatPromptRunning);
  }, [selectedChatPromptRunning, setChatStopPillVisible]);

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

  const forkPromptDoneEvent = async (doneTurnIndex: number) => {
    const selected = selectedChatKeyRef.current;
    const normalizedTurnIndex = Number.isFinite(doneTurnIndex)
      ? Math.max(0, Math.trunc(doneTurnIndex))
      : 0;
    if (
      !selected ||
      normalizedTurnIndex <= 0 ||
      forkingPromptDoneKeyRef.current ||
      forkingCurrentSessionKeyRef.current
    ) {
      return;
    }
    const busyKey = `${encodeChatSessionKey(selected)}:${normalizedTurnIndex}`;
    forkingPromptDoneKeyRef.current = busyKey;
    setForkingPromptDoneKey(busyKey);
    try {
      const result = await service.forkProjectSession(
        selected.projectId,
        selected.sessionId,
        normalizedTurnIndex,
      );
      const targetSessionId = result.session.sessionId.trim();
      if (!result.ok || !targetSessionId) {
        throw new Error('fork did not return a session');
      }
      rememberChatSessionSummary(selected.projectId, result.session);
      await refreshChatProjectSessions(selected.projectId, {force: true});
      await selectProjectChatSession(selected.projectId, targetSessionId);
      setToastMessage('Session forked.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToastMessage(
        message.includes('registry request timed out') && message.includes(RegistryMethods.SessionFork)
          ? 'Session branch request timed out; creation may still complete in the background. Check the session list before retrying.'
          : `Session fork failed: ${message || 'unknown error'}`,
      );
    } finally {
      if (forkingPromptDoneKeyRef.current === busyKey) {
        forkingPromptDoneKeyRef.current = '';
        setForkingPromptDoneKey('');
      }
    }
  };

  const forkCurrentSessionEvent = async (doneTurnIndex: number) => {
    const selected = selectedChatKeyRef.current;
    const normalizedTurnIndex = Number.isFinite(doneTurnIndex)
      ? Math.max(0, Math.trunc(doneTurnIndex))
      : 0;
    if (
      !selected ||
      normalizedTurnIndex <= 0 ||
      normalizedTurnIndex !== (selectedChatSession?.lastDoneTurnIndex ?? 0) ||
      archivedMode ||
      chatReadOnlyPreview ||
      selectedChatSession?.sessionActions?.fork?.supported !== true ||
      selectedChatSession?.sessionActions?.fork?.currentSession !== true ||
      selectedChatExecutionRunning ||
      forkingPromptDoneKeyRef.current ||
      forkingCurrentSessionKeyRef.current
    ) {
      return;
    }
    const busyKey = encodeChatSessionKey(selected);
    forkingCurrentSessionKeyRef.current = busyKey;
    setForkingCurrentSessionKey(busyKey);
    try {
      const result = await service.forkProjectSession(selected.projectId, selected.sessionId);
      const targetSessionId = result.session.sessionId.trim();
      if (!result.ok || !targetSessionId) {
        throw new Error('fork did not return a session');
      }
      rememberChatSessionSummary(selected.projectId, result.session);
      await refreshChatProjectSessions(selected.projectId, {force: true});
      await selectProjectChatSession(selected.projectId, targetSessionId);
      setToastMessage('Session forked.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToastMessage(
        message.includes('registry request timed out') && message.includes(RegistryMethods.SessionFork)
          ? 'Session branch request timed out; creation may still complete in the background. Check the session list before retrying.'
          : `Session fork failed: ${message || 'unknown error'}`,
      );
    } finally {
      if (forkingCurrentSessionKeyRef.current === busyKey) {
        forkingCurrentSessionKeyRef.current = '';
        setForkingCurrentSessionKey('');
      }
    }
  };

  const renderChatMessageTurn = useCallback((
    message: RegistryChatMessage,
    searchSourceMessages: RegistryChatMessage[],
    searchSourceIndexes: number[],
  ) => {
    const doneTurnIndex = message.turnIndex ?? 0;
    const forkKey = `${selectedChatEncodedKey}:${doneTurnIndex}`;
    const currentSessionForkSupported = message.method === 'prompt_done' &&
      doneTurnIndex > 0 &&
      doneTurnIndex === (selectedChatSession?.lastDoneTurnIndex ?? 0) &&
      selectedChatSession?.sessionActions?.fork?.supported === true &&
      selectedChatSession?.sessionActions?.fork?.currentSession === true;
    const permissionRecord = message.method === 'permission_request'
      ? selectedPermissionState.byRequestTurnIndex.get(doneTurnIndex)
      : undefined;
    const copyRange = message.method === 'prompt_done'
      ? buildPromptDoneCopyRange(selectedFullChatMessages, doneTurnIndex)
      : null;
    const promptStatus = selectedPromptTurnStatusIndex.statusFor(message);
    const promptRequest = message.method === 'prompt_done'
      ? findPromptRequestForDone(doneTurnIndex)
      : undefined;
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
    if (!permissionRecord && !shouldRenderChatTurn(message, promptStatus)) {
      return null;
    }
    const searchMatchIds = searchSourceIndexes.flatMap(sourceIndex => {
      const sourceMessage = searchSourceMessages[sourceIndex];
      if (!sourceMessage) {
        return [];
      }
      return chatSearchMatchIdsByMessageKey.get(chatSearchMessageKey(sourceMessage, sourceIndex)) ?? [];
    });
    const activeSearchMatchId = chatSearchActiveMatch
      ? `${chatSearchActiveMatch.messageKey}:${chatSearchActiveMatch.occurrenceIndex}`
      : '';
    const chatSearchMatchRoot = chatSearchOpen && searchMatchIds.length > 0;
    const turnIsChatSearchActive =
      chatSearchOpen && (
        chatSearchActiveTurnIndex === (message.turnIndex ?? 0) ||
        searchMatchIds.includes(activeSearchMatchId)
      );
    const searchHighlighted =
      (chatPromptHistoryTargetTurn?.runtimeKey === selectedChatEncodedKey &&
        chatPromptHistoryTargetTurn.turnIndex === (message.turnIndex ?? 0)) ||
      turnIsChatSearchActive;
    return (
      <div
        key={`${selectedChatEncodedKey}:${message.turnIndex}:${message.method}`}
        data-chat-message-key={chatMessageDomKey(message)}
        data-chat-search-match-root={chatSearchMatchRoot ? 'true' : undefined}
        data-chat-search-match-ids={chatSearchMatchRoot ? JSON.stringify(searchMatchIds) : undefined}
        className={[
          'chat-view-content',
          searchHighlighted ? 'chat-turn-search-highlight' : '',
          turnIsChatSearchActive ? 'chat-turn-search-highlight-active' : '',
        ].filter(Boolean).join(' ')}
      >
        <ChatTurnView
          message={message}
          permissionRecord={permissionRecord}
          promptRequest={promptRequest}
          promptStatus={promptStatus}
          markdownComponents={chatMarkdownComponents}
          markdownUrlTransform={chatMarkdownUrlTransform}
          copyDisabled={copyRange ? !copyRange.ok : true}
          shareMenuMode={isWide ? 'popover' : 'sheet'}
          shareResponseDisabled={
            (copyRange ? !copyRange.ok : true) ||
            chatShareCaptureTask !== null ||
            promptMarkdownHtmlExportDraft?.action.scope === 'response'
          }
          shareSessionDisabled={
            !sessionChatShareAvailable ||
            chatShareCaptureTask !== null ||
            promptMarkdownHtmlExportDraft?.action.scope === 'session'
          }
          shareWorkDetailsAvailable={selectedChatMessageLifecycleSupported}
          shareBusyAction={chatShareCaptureTask?.action ?? promptMarkdownHtmlExportDraft?.action ?? null}
          forkSupported={
            selectedChatSession?.sessionActions?.fork?.supported === true &&
            selectedChatSession?.sessionActions?.fork?.historicalTurn === true
          }
          forkCurrentSessionSupported={currentSessionForkSupported}
          forkBusy={message.method === 'prompt_done' && (
            forkingPromptDoneKey === forkKey ||
            (currentSessionForkSupported && forkingCurrentSessionKey === selectedChatEncodedKey)
          )}
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
          onSharePromptDone={
            message.method === 'prompt_done'
              ? (_terminalTurnIndex, action) => handleChatShareActionEvent(doneTurnIndex, action)
              : undefined
          }
          onForkPromptDone={
            message.method === 'prompt_done'
              ? mode => (mode === 'current'
                ? forkCurrentSessionEvent(doneTurnIndex)
                : forkPromptDoneEvent(doneTurnIndex)
              ).catch(() => undefined)
              : undefined
          }
          onRetryFailedPrompt={
            message.method === 'prompt_done' && promptRequest
              ? () => retryFailedChatPrompt(promptRequest)
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
          onOpenPromptAttachmentContextMenu={openPromptAttachmentContextMenu}
          resolvePromptAttachmentThumbnail={resolvePromptAttachmentThumbnail}
          onLoadPromptAttachmentThumbnail={loadPromptAttachmentThumbnail}
          onOpenPromptArtifact={
            message.method === 'prompt_done'
              ? openPromptArtifactDiff
              : undefined
          }
          onOpenPromptArtifactFileContextMenu={
            message.method === 'prompt_done'
              ? openPromptArtifactFileContextMenu
              : undefined
          }
          openingPromptArtifactKey={openingPromptArtifactKey}
          promptArtifactErrors={promptArtifactErrors}
          highlightQuery={chatSearchMatchRoot
            ? chatSearchQuery
            : undefined}
        />
      </div>
    );
  }, [
    chatMarkdownComponents,
    chatMarkdownUrlTransform,
    chatSearchActiveMatch,
    chatSearchActiveTurnIndex,
    chatSearchOpen,
    chatSearchQuery,
    chatSearchMatchIdsByMessageKey,
    chatSendDisabled,
    copyPromptDoneMarkdownEvent,
    chatShareCaptureTask,
    findPromptRequestForDone,
    forkingCurrentSessionKey,
    forkingPromptDoneKey,
    handleSelectChatReply,
    handleChatShareActionEvent,
    latestSelectableAssistantReply,
    latestSelectableOptionReplyMessageKey,
    loadPromptAttachmentThumbnail,
    openChatAttachmentPreview,
    openPromptAttachmentContextMenu,
    openPromptArtifactFileContextMenu,
    openPromptArtifactDiff,
    openingPromptArtifactKey,
    promptArtifactErrors,
    promptMarkdownHtmlExportDraft?.action,
    readAloudPromptDoneEvent,
    retryFailedChatPrompt,
    resolvePromptAttachmentThumbnail,
    selectedChatEncodedKey,
    selectedChatSession?.sessionActions?.fork?.supported,
    selectedChatSession?.sessionActions?.fork?.currentSession,
    selectedChatSession?.sessionActions?.fork?.historicalTurn,
    selectedChatSession?.lastDoneTurnIndex,
    selectedFullChatMessages,
    selectedPermissionState,
    selectedPromptTurnStatusIndex,
    sessionChatShareAvailable,
    chatPromptHistoryTargetTurn,
    ttsState,
  ]);
  const renderArchivedChatMessageTurn = useCallback((
    message: RegistryChatMessage,
    searchSourceMessages: RegistryChatMessage[],
    searchSourceIndexes: number[],
  ) => {
    const turnIndex = message.turnIndex ?? 0;
    const copyRange = message.method === 'prompt_done'
      ? buildPromptDoneCopyRange(searchSourceMessages, turnIndex)
      : null;
    const permissionRecord = message.method === 'permission_request'
      ? archivedPermissionState.byRequestTurnIndex.get(turnIndex)
      : undefined;
    if (!permissionRecord && !shouldRenderChatTurn(message, null)) {
      return null;
    }
    const runtimeKey = selectedArchivedKey
      ? buildChatRuntimeKey(selectedArchivedKey.projectId, selectedArchivedKey.sessionId)
      : 'archived-session';
    const searchMatchIds = searchSourceIndexes.flatMap(sourceIndex => {
      const sourceMessage = searchSourceMessages[sourceIndex];
      if (!sourceMessage) {
        return [];
      }
      return chatSearchMatchIdsByMessageKey.get(chatSearchMessageKey(sourceMessage, sourceIndex)) ?? [];
    });
    const chatSearchMatchRoot = chatSearchOpen && searchMatchIds.length > 0;
    const turnIsChatSearchActive =
      chatSearchOpen && (
        chatSearchActiveTurnIndex === turnIndex ||
        searchMatchIds.includes(
          chatSearchActiveMatch
            ? `${chatSearchActiveMatch.messageKey}:${chatSearchActiveMatch.occurrenceIndex}`
            : '',
        )
      );
    const searchHighlighted =
      turnIsChatSearchActive;
    return (
      <div
        key={`${runtimeKey}:${message.turnIndex}:${message.method}`}
        data-chat-message-key={chatMessageDomKey(message)}
        data-chat-search-match-root={chatSearchMatchRoot ? 'true' : undefined}
        data-chat-search-match-ids={chatSearchMatchRoot ? JSON.stringify(searchMatchIds) : undefined}
        className={[
          'chat-view-content',
          searchHighlighted ? 'chat-turn-search-highlight' : '',
          turnIsChatSearchActive ? 'chat-turn-search-highlight-active' : '',
        ].filter(Boolean).join(' ')}
      >
        <ChatTurnView
          message={message}
          permissionRecord={permissionRecord}
          promptStatus={null}
          markdownComponents={chatMarkdownComponents}
          markdownUrlTransform={chatMarkdownUrlTransform}
          copyDisabled={copyRange ? !copyRange.ok : true}
          shareMenuMode={isWide ? 'popover' : 'sheet'}
          shareResponseDisabled={
            (copyRange ? !copyRange.ok : true) ||
            chatShareCaptureTask !== null ||
            promptMarkdownHtmlExportDraft?.action.scope === 'response'
          }
          shareSessionDisabled={
            !sessionChatShareAvailable ||
            chatShareCaptureTask !== null ||
            promptMarkdownHtmlExportDraft?.action.scope === 'session'
          }
          shareWorkDetailsAvailable={selectedChatMessageLifecycleSupported}
          shareBusyAction={chatShareCaptureTask?.action ?? promptMarkdownHtmlExportDraft?.action ?? null}
          onCopyPromptDone={message.method === 'prompt_done'
            ? () => copyPromptDoneMarkdownEvent(turnIndex).catch(() => undefined)
            : undefined}
          onSharePromptDone={message.method === 'prompt_done'
            ? (_terminalTurnIndex, action) => handleChatShareActionEvent(turnIndex, action)
            : undefined}
          onOpenPromptAttachment={openChatAttachmentPreview}
          onOpenPromptAttachmentContextMenu={openPromptAttachmentContextMenu}
          resolvePromptAttachmentThumbnail={resolvePromptAttachmentThumbnail}
          onLoadPromptAttachmentThumbnail={loadPromptAttachmentThumbnail}
          onOpenPromptArtifact={message.method === 'prompt_done' ? openPromptArtifactDiff : undefined}
          onOpenPromptArtifactFileContextMenu={
            message.method === 'prompt_done'
              ? openPromptArtifactFileContextMenu
              : undefined
          }
          openingPromptArtifactKey={openingPromptArtifactKey}
          promptArtifactErrors={promptArtifactErrors}
          highlightQuery={chatSearchMatchRoot ? chatSearchQuery : undefined}
        />
      </div>
    );
  }, [
    archivedPermissionState,
    chatShareCaptureTask,
    chatMarkdownComponents,
    chatMarkdownUrlTransform,
    chatSearchActiveMatch,
    chatSearchActiveTurnIndex,
    chatSearchMatchIdsByMessageKey,
    chatSearchOpen,
    chatSearchQuery,
    copyPromptDoneMarkdownEvent,
    handleChatShareActionEvent,
    isWide,
    loadPromptAttachmentThumbnail,
    openChatAttachmentPreview,
    openPromptAttachmentContextMenu,
    openPromptArtifactFileContextMenu,
    openPromptArtifactDiff,
    openingPromptArtifactKey,
    promptArtifactErrors,
    promptMarkdownHtmlExportDraft?.action,
    resolvePromptAttachmentThumbnail,
    selectedArchivedKey,
    sessionChatShareAvailable,
  ]);
  const renderChatVirtuosoItem = useCallback((rootDisplayItem: ChatDisplayIndexItem) => {
    const chatReadOnlyPreview = archivedMode && archivedPreview !== null;
    const sourceMessages = chatReadOnlyPreview ? archivedPreview.messages : chatMessages;
    const renderDisplayItem = (displayItem: ChatDisplayIndexItem): React.ReactNode => {
      const sourceAssistantMessages = displayItem.kind === 'assistant-group'
        ? displayItem.sourceIndexes
          .map(sourceIndex => sourceMessages[sourceIndex])
          .filter((message): message is RegistryChatMessage => !!message && message.method === 'agent_message_chunk')
        : [];
      const sourceMessage = displayItem.kind === 'turn'
        ? sourceMessages[displayItem.sourceIndex]
        : displayItem.kind === 'assistant-group'
          ? combineAssistantGroupMessages(sourceAssistantMessages)
          : undefined;
      const sourceToolMessages = displayItem.kind === 'tool-group'
        ? displayItem.sourceIndexes
          .map(sourceIndex => sourceMessages[sourceIndex])
          .filter((message): message is RegistryChatMessage => !!message && message.method === 'tool_call')
        : [];
      const queuedItemIndex = displayItem.kind === 'queued'
        ? selectedQueueItems.findIndex(item => `${selectedChatEncodedKey}:queued:${item.itemId}` === displayItem.key)
        : -1;
      const queuedItem = queuedItemIndex >= 0 ? selectedQueueItems[queuedItemIndex] : null;
      const queuedItemActions = queuedItem ? {
        ...(queuedItem.cancelSupported && queuedItem.status !== 'cancelling' && queuedItem.status !== 'running'
          ? {cancel: () => cancelQueuedPrompt(
              selectedChatKeyRef.current?.projectId ?? '',
              selectedChatEncodedKey,
              queuedItem.itemId,
            )}
          : {}),
        ...(queuedItem.status === 'queued'
          ? {prioritize: () => prioritizeQueuedPrompt(
              selectedChatKeyRef.current?.projectId ?? '',
              selectedChatEncodedKey,
              queuedItem.itemId,
            )}
          : {}),
        ...(queuedItem.kind === 'prompt' && queuedItem.status === 'queued' && queuedPromptCanSteer
          ? {steer: () => steerQueuedPrompt(
              selectedChatKeyRef.current?.projectId ?? '',
              selectedChatEncodedKey,
              queuedItem.itemId,
            )}
          : {}),
      } satisfies ChatQueueActions : {};
      const displayItemSearchHighlighted =
        chatPromptHistoryTargetTurn?.runtimeKey === selectedChatEncodedKey &&
        chatDisplayItemContainsTurn(displayItem, chatPromptHistoryTargetTurn.turnIndex);
      const displayItemSearchExpanded = displayItem.kind === 'work-group' &&
        !!chatSearchActiveMatch &&
        displayItem.sourceIndexes.some(sourceIndex => {
          const sourceMessage = sourceMessages[sourceIndex];
          return !!sourceMessage &&
            chatSearchMessageKey(sourceMessage, sourceIndex) === chatSearchActiveMatch.messageKey;
        });
      const toolGroupActive =
        !chatReadOnlyPreview &&
        displayItem.kind === 'tool-group' &&
        displayItem.key === selectedActiveToolGroupKey;

      if (displayItem.kind === 'work-group') {
        return (
          <ChatWorkGroup
            status={displayItem.workStatus ?? 'worked'}
            durationMs={displayItem.durationMs ?? 0}
            highlighted={displayItemSearchHighlighted}
            searchOpen={chatSearchOpen}
            searchExpanded={displayItemSearchExpanded}
          >
            {(displayItem.childItems ?? []).map(childItem => (
              <div
                key={childItem.key}
                className={`chat-work-group-child${childItem.compact ? ' compact' : ''}`}
              >
                {renderDisplayItem(childItem)}
              </div>
            ))}
          </ChatWorkGroup>
        );
      }
      if (displayItem.kind === 'tool-group' && sourceToolMessages.length > 0) {
        return (
          <div
            className={[
              'chat-view-content',
              displayItemSearchHighlighted ? 'chat-turn-search-highlight' : '',
            ].filter(Boolean).join(' ')}
          >
            <ChatToolCallGroup messages={sourceToolMessages} active={toolGroupActive} />
          </div>
        );
      }
      if (displayItem.kind === 'queued' && queuedItem?.kind === 'prompt' && !chatReadOnlyPreview) {
        return (
          <div className="chat-view-content">
            <ChatTurnView
              message={buildQueuePromptMessage(
                selectedChatKeyRef.current?.sessionId ?? '',
                queuedItem,
                queuedPromptTurnIndex(queuedItemIndex),
              )}
              queueItemStatus={queuedItem.status}
              queueActions={queuedItemActions}
              markdownComponents={chatMarkdownComponents}
              markdownUrlTransform={chatMarkdownUrlTransform}
              onOpenPromptAttachment={openChatAttachmentPreview}
              onOpenPromptAttachmentContextMenu={openPromptAttachmentContextMenu}
              resolvePromptAttachmentThumbnail={resolvePromptAttachmentThumbnail}
              onLoadPromptAttachmentThumbnail={loadPromptAttachmentThumbnail}
            />
          </div>
        );
      }
      if (displayItem.kind === 'queued' && queuedItem?.kind === 'compact' && !chatReadOnlyPreview) {
        return (
          <div className="chat-view-content">
            <ChatQueueCompactView item={queuedItem} actions={queuedItemActions} />
          </div>
        );
      }
      if (displayItem.kind === 'pending' && selectedPendingPrompt && !chatReadOnlyPreview) {
        return (
          <div className="chat-view-content">
            <ChatTurnView
              message={buildPendingPromptMessage(selectedPendingPrompt)}
              promptStatus={selectedPendingPrompt.status}
              markdownComponents={chatMarkdownComponents}
              markdownUrlTransform={chatMarkdownUrlTransform}
              onOpenPromptAttachment={openChatAttachmentPreview}
              onOpenPromptAttachmentContextMenu={openPromptAttachmentContextMenu}
              resolvePromptAttachmentThumbnail={resolvePromptAttachmentThumbnail}
              onLoadPromptAttachmentThumbnail={loadPromptAttachmentThumbnail}
              onRetryPendingPrompt={() => retryPendingChatPrompt(selectedChatEncodedKey)}
              onEditPendingPrompt={() => editPendingChatPrompt(selectedChatEncodedKey)}
            />
          </div>
        );
      }
      if (sourceMessage && chatReadOnlyPreview) {
        return renderArchivedChatMessageTurn(sourceMessage, sourceMessages, displayItem.sourceIndexes);
      }
      return sourceMessage
        ? renderChatMessageTurn(sourceMessage, sourceMessages, displayItem.sourceIndexes)
        : null;
    };
    return renderDisplayItem(rootDisplayItem);
  }, [
    archivedMode,
    archivedPreview,
    cancelQueuedPrompt,
    chatSearchActiveMatch,
    chatSearchOpen,
    chatMarkdownComponents,
    chatMarkdownUrlTransform,
    chatMessages,
    editPendingChatPrompt,
    loadPromptAttachmentThumbnail,
    openChatAttachmentPreview,
    openPromptAttachmentContextMenu,
    prioritizeQueuedPrompt,
    queuedPromptTurnIndex,
    queuedPromptCanSteer,
    renderArchivedChatMessageTurn,
    renderChatMessageTurn,
    resolvePromptAttachmentThumbnail,
    retryPendingChatPrompt,
    selectedChatEncodedKey,
    selectedActiveToolGroupKey,
    selectedPendingPrompt,
    selectedQueueItems,
    chatPromptHistoryTargetTurn,
    steerQueuedPrompt,
    mutateQueuedPrompt,
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
    if (!isWide) {
      setMobileUsageOpen(false);
      setTerminalOpen(false);
      setSidebarSettingsOpen(false);
    }
    if (chatPreviewOpen) {
      setChatPreviewManualOpen(false);
      setChatPreviewManualCollapsed(true);
      return;
    }
    setChatPreviewManualCollapsed(false);
    setChatPreviewManualOpen(open => !open);
  }, [chatPreviewOpen, isWide, setSidebarSettingsOpen]);
  const togglePreviewDrawerFromTitle = useCallback((mode: Exclude<PreviewWorkbenchDrawerMode, 'closed'>) => {
    if (!chatPreviewOpen) {
      setChatPreviewManualCollapsed(false);
      setChatPreviewManualOpen(true);
      updatePreviewDrawerMode(mode);
      return;
    }
    updatePreviewDrawerMode(previewWorkbenchRef.current.drawerMode === mode ? 'closed' : mode);
  }, [chatPreviewOpen, updatePreviewDrawerMode]);
  const floatingNavRelayState = resolveFloatingNavRelayState({
    ready: portRelayReady,
    frameUrl: portRelayFrameUrl,
    hasTarget: (activePortRelayTarget ?? selectedPortRelayTarget) !== null,
    frameOpen: mobilePortRelayFrameOpen,
  });
  const handleFloatingNavRelayOpen = useCallback(() => {
    if (mobilePortRelayFrameOpen) {
      closePortRelayFrameFromChrome();
      return;
    }
    const target = activePortRelayTarget ?? selectedPortRelayTarget;
    if (!portRelayReady || !portRelayFrameUrl || !target) {
      openPortRelayScreen();
      return;
    }
    if (portRelayTargetMenuTargets.length > 1) {
      setMobileRelayTargetSheet({open: true});
      return;
    }
    openPortRelayWorkbenchTab(target, portRelayFramePath, {source: 'floating'}).catch(() => undefined);
  }, [
    activePortRelayTarget,
    mobilePortRelayFrameOpen,
    closePortRelayFrameFromChrome,
    openPortRelayScreen,
    openPortRelayWorkbenchTab,
    portRelayFramePath,
    portRelayFrameUrl,
    portRelayReady,
    portRelayTargetMenuTargets.length,
    selectedPortRelayTarget,
    setMobileRelayTargetSheet,
  ]);
  const handleFloatingNavSelect = useCallback(
    (destination: FloatingNavDestination) => {
      cancelGestureNavigation();
      setDrawerOpen(false);
      setMobileRelayTargetSheet(null);
      setPreviewWorkbenchActionsMenuOpen(false);
      setPreviewSelectionMenu(null);
      closeMobileDrawerCompanionOverlays();
      mobileReleasePublishingHistoryRef.current = false;
      mobilePortRelayHistoryRef.current = false;
      setReleasePublishingOpen(false);
      setPortRelayScreenOpen(false);
      setMobileUsageOpen(false);
      setSidebarSettingsOpen(false);
      setTerminalOpen(false);
      if (destination === 'preview') {
        setPreviewWorkbench(current => {
          const activeProjectId = current.activeProjectId;
          const tabs = current.tabsByProjectId[activeProjectId] ?? [];
          const currentActiveId = current.activeTabIdByProjectId[activeProjectId] ?? '';
          const activeTab = tabs.find(tab => tab.id === currentActiveId);
          if (activeTab?.type !== 'port-relay') return current;
          const nextTab = [...tabs].reverse().find(tab => tab.type !== 'port-relay');
          return {
            ...current,
            activeTabIdByProjectId: {
              ...current.activeTabIdByProjectId,
              [activeProjectId]: nextTab?.id ?? '',
            },
          };
        });
        setChatPreviewManualCollapsed(false);
        setChatPreviewManualOpen(true);
        return;
      }
      hideChatPreviewSurface();
      if (destination === 'relay') {
        handleFloatingNavRelayOpen();
        return;
      }
      if (destination === 'terminal') {
        setTerminalOpen(true);
      } else if (destination === 'monitor') {
        setMobileUsageOpen(true);
      } else if (destination === 'settings') {
        openSettingsRoot();
      }
      // 'chat' falls through: every overlay above is closed.
    },
    [
      cancelGestureNavigation,
      closeMobileDrawerCompanionOverlays,
      handleFloatingNavRelayOpen,
      hideChatPreviewSurface,
      openSettingsRoot,
      setSidebarSettingsOpen,
    ],
  );
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
    setChatTitleProjectMenuOpen(false);
    setChatTitlePromptMenuOpen(open => !open);
  };
  const renderDesktopChatProjectSelector = () => (
    <button
      ref={chatTitleProjectButtonRef}
      type="button"
      className={`chat-title-project-button${chatTitleProjectMenuOpen ? ' open' : ''}`}
      onPointerDown={event => event.stopPropagation()}
      onClick={() => {
        setChatTitlePromptMenuOpen(false);
        setChatTitleProjectMenuOpen(open => !open);
      }}
      data-tooltip="Switch project"
      aria-label="Switch project"
      aria-haspopup="menu"
      aria-expanded={chatTitleProjectMenuOpen}
    >
      <span className="breadcrumb-project-name" data-tooltip={activeChatBreadcrumbProjectName}>
        {activeChatBreadcrumbProjectName}
      </span>
      <SessionIcon name="chevronDown" />
    </button>
  );
  const renderDesktopChatBreadcrumbTitle = () => (
    <div className="breadcrumb-title chat-breadcrumb-title">
      <button
        ref={chatTitlePromptButtonRef}
        type="button"
        className={`chat-title-prompt-icon-button${chatTitlePromptMenuOpen ? ' open' : ''}`}
        data-tooltip={chatTitlePromptMenuAvailable ? 'Show prompt history' : activeChatBreadcrumbLabel}
        aria-label="Show prompt history"
        aria-haspopup="menu"
        aria-expanded={chatTitlePromptMenuOpen}
        disabled={!chatTitlePromptMenuAvailable}
        onClick={toggleChatTitlePromptMenu}
      >
        <SessionIcon name="history" />
      </button>
      <span className="chat-title-session-text title-text breadcrumb-current" data-tooltip={activeChatBreadcrumbLabel}>
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
          setChatTitleProjectMenuOpen(open => !open);
        }}
        data-tooltip="Switch project"
        aria-label="Switch project"
        aria-haspopup="menu"
        aria-expanded={chatTitleProjectMenuOpen}
      >
        <span className="breadcrumb-project-name" data-tooltip={activeChatBreadcrumbProjectName}>
          {activeChatBreadcrumbProjectName}
        </span>
        <SessionIcon name="chevronDown" />
      </button>
      <button
        ref={chatTitlePromptButtonRef}
        type="button"
        className={`chat-title-session-button chat-title-session-text title-text breadcrumb-current${chatTitlePromptMenuOpen ? ' open' : ''}`}
        data-tooltip={chatTitlePromptMenuAvailable ? 'Show prompt history' : activeChatBreadcrumbLabel}
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
  const renderChatTitleBar = (mobile: boolean) => (
    <DesktopDragRegion className="block-title chat-title-bar">
      {!mobile ? renderChatSessionHeader(false) : null}
      <div className="chat-title-context">
        {mobile ? renderMobileChatBreadcrumbTitle() : renderDesktopChatBreadcrumbTitle()}
      </div>
      <div className="chat-title-actions">
        <button
          type="button"
          className={`chat-search-toggle${chatSearchOpen ? ' active' : ''}`}
          onClick={() => (chatSearchOpen ? closeChatSearch() : openChatSearch())}
          data-tooltip={shortcutTooltip('Search current session', 'searchCurrentContext')}
          aria-label="Search current session"
          aria-pressed={chatSearchOpen}
        >
          <SessionIcon name="search" />
        </button>
        {!mobile ? (
          <>
            <button
              type="button"
              className={`chat-terminal-toggle${terminalOpen ? ' active' : ''}`}
              onClick={toggleTerminalFromTitle}
              data-tooltip={terminalOpen ? 'Hide terminal' : 'Show terminal'}
              aria-label={terminalOpen ? 'Hide terminal' : 'Show terminal'}
              aria-pressed={terminalOpen}
            >
              <SessionIcon name="terminal" />
            </button>
            <button
              type="button"
              className={`chat-drawer-toggle${chatPreviewOpen && previewWorkbench.drawerMode === 'files' ? ' active' : ''}`}
              onClick={() => togglePreviewDrawerFromTitle('files')}
              data-tooltip="Toggle files"
              aria-label="Toggle files"
              aria-pressed={chatPreviewOpen && previewWorkbench.drawerMode === 'files'}
            >
              <SessionIcon name="files" />
            </button>
            <button
              type="button"
              className={`chat-drawer-toggle${chatPreviewOpen && previewWorkbench.drawerMode === 'git' ? ' active' : ''}`}
              onClick={() => togglePreviewDrawerFromTitle('git')}
              disabled={!previewGitSnapshot.available}
              data-tooltip={previewGitSnapshot.available ? 'Toggle Git history' : 'Git is not available for this project'}
              aria-label="Toggle Git history"
              aria-pressed={chatPreviewOpen && previewWorkbench.drawerMode === 'git'}
            >
              <SessionIcon name="gitBranch" />
            </button>
            <button
              type="button"
              className={`chat-preview-toggle${chatPreviewOpen ? ' active' : ''}`}
              onClick={toggleChatPreviewFromTitle}
              data-tooltip={chatPreviewOpen ? 'Hide preview' : 'Show preview'}
              aria-label={chatPreviewOpen ? 'Hide preview' : 'Show preview'}
              aria-pressed={chatPreviewOpen}
            >
              <SessionIcon name="appWindow" />
              {!chatPreviewOpen && previewTabCount > 0 ? (
                <span className="chat-preview-badge" aria-label={`${previewTabCount} preview tabs`}>{previewTabCount}</span>
              ) : null}
            </button>
          </>
        ) : null}
      </div>
    </DesktopDragRegion>
  );
  const renderMain = () => {
    const chatConfigStatus = chatConfigDisplay.status;
    const chatConfigOptions = chatConfigStatus.secondaryOptions;
    const chatConfigOverflowOptions = chatConfigStatus.overflowOptions;
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
        <div className={`chat-config-value-menu${chatComposerMenuExiting ? ' sl-menu-exit' : ''}`} role="menu">
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
                <span className="chat-config-value-label">{chatConfigValueLabel(option, item)}</span>
                {selected ? (
                  <ChatIcon name="check" />
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
      const updating = chatConfigUpdatingKeys.has(`${selectedChatEncodedKey}:${option.id}`);
      const open = chatConfigMenuOptionId === option.id;
      return (
        <div key={option.id} className="chat-config-item">
          <button
            type="button"
            className="chat-config-pill"
            disabled={updating || optionValues.length === 0}
            data-tooltip={optionLabel}
            aria-label={optionLabel}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => {
              setChatPromptMenuOpen(false);
              setChatFileMentionMenuOpen(false);
              setChatCoreConfigMenuOpen(false);
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
              setChatCoreConfigMenuOpen(false);
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
    const renderChatCoreConfigSelector = () => {
      const coreOptions = chatConfigStatus.coreOptions;
      if (coreOptions.length === 0) {
        return null;
      }
      const modelOption = chatConfigStatus.modelOption;
      const effortOption = chatConfigStatus.reasoningOption;
      const fastOption = chatConfigStatus.fastOption;
      const modelLabel = modelOption ? chatConfigCurrentLabel(modelOption) : '';
      const effortLabel = effortOption ? chatConfigCurrentLabel(effortOption) : '';
      const fastEnabled = fastOption?.currentValue === 'on';
      const title = [
        modelOption ? `Model: ${modelLabel}` : '',
        effortOption ? `Effort: ${effortLabel}` : '',
        fastOption ? `Fast: ${fastEnabled ? 'On' : 'Off'}` : '',
      ].filter(Boolean).join(', ');
      return (
        <div className="chat-core-config">
          <button
            ref={chatCoreConfigTriggerRef}
            type="button"
            className="chat-core-config-trigger"
            data-tooltip={title}
            aria-label={title}
            aria-haspopup="menu"
            aria-expanded={chatCoreConfigPanelOpen}
            onClick={() => {
              setChatPromptMenuOpen(false);
              setChatFileMentionMenuOpen(false);
              setChatContextUsageOpen(false);
              setChatConfigMenuOptionId('');
              if (chatCoreConfigPanelOpen) {
                closeChatCoreConfigMenu();
              } else {
                setChatConfigOverflowOpen(false);
                setChatCoreConfigMenuOpen(true);
              }
            }}
          >
            {modelOption ? <span className="chat-core-config-model">{modelLabel}</span> : null}
            {modelOption && effortOption ? (
              <span className="chat-core-config-separator" aria-hidden="true">/</span>
            ) : null}
            {effortOption ? <span className="chat-core-config-effort">{effortLabel}</span> : null}
            {!modelOption && !effortOption && fastOption ? (
              <span className="chat-core-config-fast-label">Fast</span>
            ) : null}
            {fastEnabled ? (
              <ChatIcon name="zap" className="chat-core-config-fast" />
            ) : null}
          </button>
          {chatCoreConfigPanelOpen ? (
            <div
              className={`chat-core-config-menu${chatComposerMenuExiting ? ' sl-menu-exit' : ''}`}
              role="menu"
              aria-label={chatConfigOverflowOpen ? 'More options' : 'Model, effort, and Fast'}
            >
              {chatConfigOverflowOpen ? (
                <div className="chat-core-config-more">
                  <div className="chat-core-config-more-heading">More Options</div>
                  <div className="chat-core-config-more-groups">
                    {chatConfigOverflowOptions.map(option => {
                      const optionValues = option.options ?? [];
                      const currentValue = chatConfigCurrentValue(option);
                      const updating = chatConfigUpdatingKeys.has(`${selectedChatEncodedKey}:${option.id}`);
                      const optionLabel = option.name || option.id;
                      return (
                        <div key={`more:${option.id}`} className="chat-config-overflow-group">
                          <div className="chat-config-item-label" data-tooltip={optionLabel}>
                            {optionLabel}
                          </div>
                          <div className="chat-config-overflow-values">
                            {optionValues.map(item => {
                              const selected = item.value === currentValue;
                              return (
                                <button
                                  key={`more:${option.id}:${item.value}`}
                                  type="button"
                                  className={`chat-config-value-option${selected ? ' selected' : ''}`}
                                  role="menuitemradio"
                                  aria-checked={selected}
                                  disabled={updating}
                                  onClick={() => {
                                    closeChatCoreConfigMenu(true);
                                    handleChatConfigOptionChange(option, item.value).catch(() => undefined);
                                  }}
                                >
                                  <span className="chat-config-value-label">{chatConfigValueLabel(option, item)}</span>
                                  {selected ? (
                                    <ChatIcon name="check" />
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <>
                  <div className="chat-core-config-columns">
                    {coreOptions.map(item => {
                      const values = item.option.options ?? [];
                      const currentValue = chatConfigCurrentValue(item.option);
                      const updating = chatConfigUpdatingKeys.has(`${selectedChatEncodedKey}:${item.option.id}`);
                      const heading = item.kind === 'model' ? 'Model' : item.kind === 'effort' ? 'Effort' : 'Fast';
                      return (
                        <div
                          key={`core:${item.option.id}`}
                          className={`chat-core-config-column ${item.kind}`}
                          aria-busy={updating}
                        >
                          <div className="chat-core-config-heading">{heading}</div>
                          <div className="chat-core-config-values">
                            {values.length > 0 ? values.map(value => {
                              const selected = value.value === currentValue;
                              return (
                                <button
                                  key={`core:${item.option.id}:${value.value}`}
                                  type="button"
                                  className={`chat-core-config-option${selected ? ' selected' : ''}`}
                                  role="menuitemradio"
                                  aria-checked={selected}
                                  disabled={updating}
                                  onClick={() => {
                                    closeChatCoreConfigMenu(true);
                                    handleChatConfigOptionChange(item.option, value.value).catch(() => undefined);
                                  }}
                                >
                                  <span className="chat-core-config-option-label">
                                    {chatConfigValueLabel(item.option, value)}
                                  </span>
                                  <ChatIcon
                                    name="check"
                                    size={12}
                                    className={`chat-core-config-check${selected ? ' visible' : ''}`}
                                  />
                                </button>
                              );
                            }) : (
                              <span className="chat-core-config-empty">No options</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {chatComposerStatusCompact && chatConfigOverflowOptions.length > 0 ? (
                    <div className="chat-core-config-footer">
                      <button
                        type="button"
                        className="chat-core-config-more-button"
                        role="menuitem"
                        onClick={() => {
                          setChatConfigOverflowOpen(true);
                        }}
                      >
                        <span>More Options</span>
                        <ChatIcon name="chevronRight" />
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>
      );
    };
    return (
        <ChatSurface>
          {!isWide ? renderChatTitleBar(true) : null}
          <div
            className={chatMainClassName}
            data-chat-search-open={chatSearchOpen ? 'true' : undefined}
            style={chatMainStyle}
          >
            {chatSearchBar}
            <div
              ref={chatScrollRef}
              className="scroll-panel chat-block"
              onScroll={handleChatScroll}
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
                  bottomBuffer={chatPermissionDialogHeight > 0 ? chatPermissionDialogHeight + CHAT_PERMISSION_DIALOG_SCROLL_GAP : 0}
                  onAtBottomChange={handleChatAtBottomChange}
                  shouldAutoscroll={shouldAutoscrollChat}
                  renderItem={renderChatVirtuosoItem}
                />
              ) : null}
            </div>
          {isWide && !archivedMode ? (
            <div className={`chat-edge-surface-stack${!chatSidebarCollapsed ? ' beside-pinned-session-panel' : ''}${sessionNavSlideOut.open ? ' covered-by-session-panel' : ''}`}>
              {showFloatingSessionPanel ? (
                <ChatRecentSessionsSurface
                  collapsed={collapsedProjectIds.includes(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}
                  onToggleCollapsed={() => toggleWideProjectCollapsed(RECENT_SESSIONS_VIRTUAL_PROJECT_ID)}
                  header={
                    <ChatSessionGlobalBar
                      slideOutOpen={sessionNavSlideOut.open}
                      onToggleSlideOut={() =>
                        sessionNavSlideOut.open
                          ? sessionNavSlideOutAutoClose.closeNow()
                          : dispatchSessionNavSlideOut({ type: 'open' })
                      }
                      pinActive={false}
                      onTogglePin={pinChatSessionPanel}
                    />
                  }
                >
                  {(() => {
                    const floatingViewProps = buildSessionListViewProps(false, false);
                    return (
                      <SessionListView
                        {...floatingViewProps}
                        mode="normal"
                        recentGroups={sessionSearchActive ? [] : floatingViewProps.recentGroups}
                        projectItems={[]}
                        hiddenProjectRows={null}
                        emptyProjectsHint={null}
                      />
                    );
                  })()}
                </ChatRecentSessionsSurface>
              ) : null}
              {selectedGoal ? (
                <ChatGoalSurface
                  mode="desktop"
                  goal={selectedGoal}
                  onPause={() => { void handlePauseGoal(); }}
                  onResume={() => { void handleResumeGoal(); }}
                  onEdit={openGoalEdit}
                  onClear={requestClearGoal}
                />
              ) : null}
              <ChatPlanSurface
                mode="desktop"
                plan={selectedChatPlan}
              />
              {desktopGitSnapshot.available ? (
                <GitStatusSurface
                  snapshot={desktopGitSnapshot}
                  onRefresh={() => { void gitBrowserStore.refresh(desktopGitSnapshot.projectId); }}
                  onRetry={() => { void gitBrowserStore.refresh(desktopGitSnapshot.projectId); }}
                  onFileOpen={(source, file) => openGitDiffPreview(desktopGitSnapshot.projectId, source, file)}
                />
              ) : null}
              {showMonitor ? (
                <MonitorSurface
                  usageSnapshot={visibleUsageSnapshot}
                  efficiencySnapshot={modelEfficiencySnapshot}
                  onRefreshLimits={() => { void refreshUsageAcrossHubs(); }}
                  onRefreshIq={() => { void modelEfficiencyStore.refresh(); }}
                  onRequestHide={() => setConfirmTarget({kind: 'hideMonitor'})}
                  onOpenHistory={handleUsageRowActivate}
                />
              ) : null}
            </div>
          ) : null}
          {isWide && chatSidebarCollapsed && !sidebarSettingsOpen ? (
            <ChatSessionPanel
              mode="slideout"
              title="Sessions"
              ref={sessionNavSlideOutPanelRef}
              className={`chat-session-nav-slideout${sessionNavSlideOut.open ? ' open' : ''}`}
              onPointerEnter={() => sessionNavSlideOutAutoClose.cancel()}
              onPointerLeave={() => {
                sessionNavSlideOutAutoClose.schedule(
                  isSessionNavSlideOutCloseSuppressed({
                    searchActive: sessionSearchActive || sessionSearchHeaderExpanded,
                    menuOpen: sessionArchiveMenuOpen || !!wideProjectActionMenu || !!projectSessionActionMenu,
                    pointerDownInList: sessionNavSlideOutPointerDownRef.current,
                    archivedOpen: archivedMode,
                  }),
                );
              }}
              header={
                <ChatSessionGlobalBar
                  slideOutOpen
                  onToggleSlideOut={() => sessionNavSlideOutAutoClose.closeNow()}
                  pinActive={false}
                  onTogglePin={() => {
                    sessionNavSlideOutAutoClose.closeNow();
                    pinChatSessionPanel();
                  }}
                  leading={
                    <>
                      {renderChatArchiveControls()}
                      {renderChatHeaderSearchControls()}
                    </>
                  }
                />
              }
              scrollRef={sessionNavSlideOutScrollRef}
              onScroll={event => {
                dispatchSessionNavSlideOut({ type: 'scroll', scrollTop: event.currentTarget.scrollTop });
              }}
              scrollProps={{
                onPointerDown: () => { sessionNavSlideOutPointerDownRef.current = true; },
                onPointerUp: () => { sessionNavSlideOutPointerDownRef.current = false; },
                onPointerCancel: () => { sessionNavSlideOutPointerDownRef.current = false; },
              }}
            >
              {renderWideProjectSessionNav()}
            </ChatSessionPanel>
          ) : null}
          {isWide ? renderWideProjectActionMenu() : null}
          {!isWide ? (
            <>
              {selectedGoal ? (
                <ChatGoalSurface
                  mode="mobile"
                  goal={selectedGoal}
                  onPause={() => { void handlePauseGoal(); }}
                  onResume={() => { void handleResumeGoal(); }}
                  onEdit={openGoalEdit}
                  onClear={requestClearGoal}
                />
              ) : null}
              <ChatPlanSurface
                mode="mobile"
                plan={selectedChatPlan}
              />
            </>
          ) : null}
          <div
            ref={chatComposerRef}
            className={`chat-composer${selectedActivePermission ? ' permission-open' : ''}${chatComposerMenu.id !== 'none' ? ' menu-open' : ''}`}
            hidden={archivedMode}
          >
            <div className="chat-composer-content">
            {selectedActivePermission && selectedActivePermissionView ? (
              <ChatPermissionDialog
                rootRef={chatPermissionDialogRef}
                title={selectedActivePermissionView.title}
                detailsText={selectedActivePermissionView.detailsText}
                options={selectedActivePermissionView.options}
                submittingOptionId={
                  permissionSubmission.permissionId === selectedActivePermission.permissionId
                    ? permissionSubmission.optionId
                    : ''
                }
                error={
                  permissionSubmission.permissionId === selectedActivePermission.permissionId
                    ? permissionSubmission.error
                    : ''
                }
                onSelect={optionId => { void submitChatPermission(optionId); }}
              />
            ) : null}
            {!archivedMode && chatShowScrollToBottom ? (
              <button
                type="button"
                className="chat-scroll-bottom-button"
                onClick={forceChatScrollToBottom}
                data-tooltip="Scroll to bottom"
                aria-label="Scroll to bottom"
              >
                <span className="chat-scroll-bottom-glyph" aria-hidden="true">
                  <ChatIcon name="arrowDown" size={15} />
                </span>
              </button>
            ) : null}
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
              {chatComposerDragActive ? (
                <div className="chat-composer-drop-hint" aria-hidden="true">
                  <ChatIcon name="paperclip" size={14} />
                  <span>Drop files to attach</span>
                </div>
              ) : null}
              {chatAttachments.length > 0 ? (
                <div className="chat-attachment-preview-list">
                  {chatAttachments.map(attachment => {
                    const previewSrc = chatAttachmentPreviewSrc(attachment);
                    const pending = isChatAttachmentUploadPending(attachment);
                    const failed = attachment.status === 'failed';
                    const statusText = failed
                      ? (attachment.error || 'Upload failed')
                      : attachment.status === 'completed'
                        ? formatChatAttachmentSize(attachment.size)
                        : attachment.status === 'queued'
                          ? 'Ready'
                          : `${attachment.progress}%`;
                    const statusTooltip = failed ? attachment.error || 'Upload failed' : undefined;
                    return (
                      <div key={attachment.id} className={`chat-attachment-preview ${attachment.status}${chatAttachmentRemovingId === attachment.id ? ' removing' : ''}`}>
                        {previewSrc ? (
                          <img
                            className="chat-attachment-thumb"
                            src={previewSrc}
                            alt={attachment.name || 'attachment preview'}
                          />
                        ) : (
                          <div className="chat-attachment-thumb file" aria-hidden="true">
                            <ChatIcon name="file" size={16} />
                          </div>
                        )}
                        <div className="chat-attachment-meta">
                          <div className="chat-attachment-name">{attachment.name}</div>
                          <div className="chat-attachment-status" data-tooltip={statusTooltip}>
                            {statusText}
                          </div>
                        </div>
                        <div className="chat-attachment-actions">
                          {failed ? (
                            <button
                              type="button"
                              className="chat-attachment-retry"
                              onClick={() => retryChatAttachment(attachment.id)}
                              data-tooltip="Queue retry"
                              aria-label="Queue retry"
                            >
                              <ChatIcon name="refreshCw" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="chat-attachment-remove"
                            onClick={() => {
                              setChatAttachmentRemovingId(attachment.id);
                              window.setTimeout(() => {
                                removeChatAttachment(attachment.id);
                                setChatAttachmentRemovingId('');
                              }, 140);
                            }}
                            disabled={pending}
                            data-tooltip={pending ? 'Uploading' : 'Remove attachment'}
                            aria-label={pending ? 'Uploading' : 'Remove attachment'}
                          >
                            <ChatIcon name="x" />
                          </button>
                        </div>
                        {pending ? (
                          <div className="chat-attachment-progress" aria-hidden="true">
                            <span style={{width: `${Math.max(4, attachment.progress)}%`}} />
                          </div>
                        ) : null}
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
                    slashCommands={chatSlashCommands.filter(option => option.kind === 'skill' || option.name === '/goal').map(command => ({
                      command: command.name,
                      label: chatSlashCommandLabel(command.name),
                      kind: command.name === '/goal' ? 'goal' : 'skill',
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
                      const shouldSendChatOnEnter = event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing;
                      if (!shouldSendChatOnEnter) {
                        return;
                      }
                      const mobileEnterShouldSend = !isWide && mobileEnterKeyBehavior === 'send';
                      if (isWide || mobileEnterShouldSend) {
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
                      aria-label="Send message"
                    >
                      <ChatIcon name="send" size={17} />
                    </button>
                  )}
                </div>
              </div>
              {chatFileMentionMenuOpen ? (
                <div
                  ref={chatFileMentionMenuRef}
                  className={`chat-file-mention-menu${chatComposerMenuExiting ? ' sl-menu-exit' : ''}${chatFileMentionLoading && chatFileMentionResults.length > 0 ? ' refreshing' : ''}`}
                  role="listbox"
                  aria-label="File mentions"
                  aria-busy={chatFileMentionLoading}
                >
                  <div className="chat-file-mention-menu-body">
                  {chatFileMentionLoading && chatFileMentionResults.length === 0 ? (
                    <div className="chat-file-mention-skeleton" aria-hidden="true">
                      {CHAT_FILE_MENTION_SKELETON_ROWS.map(row => (
                        <div key={row} className="chat-file-mention-skeleton-row">
                          <span className="chat-file-mention-skeleton-icon" />
                          <span className="chat-file-mention-skeleton-name" />
                          <span className="chat-file-mention-skeleton-path" />
                        </div>
                      ))}
                    </div>
                  ) : chatFileMentionResults.length > 0 ? (
                    chatFileMentionResults.map((result, index) => {
                      const selected = index === chatFileMentionActiveIndex;
                      const name = result.name || chatFileMentionName(result.path);
                      return (
                        <div
                          key={result.path}
                          className={`chat-file-mention-option chat-file-mention-option-row${selected ? ' active' : ''}`}
                          role="option"
                          aria-selected={index === chatFileMentionActiveIndex}
                          data-tooltip={result.path}
                          onMouseEnter={() => setChatFileMentionActiveIndex(index)}
                        >
                          <button
                            type="button"
                            className="chat-file-mention-option-main"
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => applyChatFileMentionResult(result)}
                          >
                            <ChatIcon name="fileCode" />
                            <span className="chat-file-mention-name">{name}</span>
                            <span className="chat-file-mention-path">{result.path}</span>
                          </button>
                          <button
                            type="button"
                            className="chat-file-mention-preview-button"
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => openChatFileMentionPreview(result)}
                            data-tooltip={`Open ${name} preview`}
                            aria-label={`Open ${name} preview`}
                          >
                            <ChatIcon name="eye" />
                          </button>
                        </div>
                      );
                    })
                  ) : chatFileMentionError ? (
                    <div className="chat-file-mention-empty">File search failed</div>
                  ) : !chatFileMentionIndexed ? (
                    <div className="chat-file-mention-empty">Index not built</div>
                  ) : (
                    <div className="chat-file-mention-empty">{chatFileMentionQuery ? 'No files found' : 'No indexed files'}</div>
                  )}
                  </div>
                  {isWide ? <ChatMenuKeyHints hints={[['↑↓', 'Select'], ['→', 'Preview'], ['↵', 'Insert'], ['esc', 'Close']]} /> : null}
                </div>
              ) : null}
              {chatSlashMenuVisible ? (
                <div ref={chatSlashMenuRef} className={`chat-slash-menu${chatComposerMenuExiting ? ' sl-menu-exit' : ''}`} role="listbox" aria-label="Available commands and skills">
                  <div className="chat-slash-menu-body">
                  {(() => {
                    let flatIndex = -1;
                    return groupChatSlashMenuOptions(chatSlashMenuOptions).map(section => (
                      <div key={section.id} className="chat-slash-section" role="group" aria-label={section.title}>
                        <div className="chat-slash-section-header">{section.title}</div>
                        {section.options.map(option => {
                          flatIndex += 1;
                          const index = flatIndex;
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
                              data-tooltip={option.enabled ? option.description : option.disabledReason}
                              onMouseEnter={() => setChatSlashActiveIndex(index)}
                              onMouseDown={event => event.preventDefault()}
                              onClick={() => applyChatSlashCommand(option)}
                            >
                              <ChatIcon name={option.icon} size={16} className="chat-slash-icon" />
                              <span className="chat-slash-name">{chatSlashOptionDisplayName(option.name)}</span>
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
                    ));
                  })()}
                  </div>
                  {chatSlashDiagnostic ? (
                    <div className="chat-slash-diagnostic" role="status">
                      <ChatIcon name="help" size={13} />
                      <span>{chatSlashDiagnostic}</span>
                    </div>
                  ) : null}
                  {isWide ? <ChatMenuKeyHints hints={[['↑↓', 'Select'], ['↵', 'Apply'], ['esc', 'Close']]} /> : null}
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
                    data-tooltip="Commands and skills"
                    aria-label="Open commands and skills"
                    aria-haspopup="listbox"
                    aria-expanded={chatPromptMenuOpen}
                  >
                    <ChatIcon name="command" />
                  </button>
                  <button
                    type="button"
                    ref={chatFileMentionButtonRef}
                    className="chat-tool-button chat-file-mention-trigger-button"
                    onPointerDown={event => event.preventDefault()}
                    onClick={openChatFileMentionShortcut}
                    data-tooltip="Mention files"
                    aria-label="Mention files"
                    aria-haspopup="listbox"
                    aria-expanded={chatFileMentionMenuOpen}
                  >
                    <ChatIcon name="atSign" />
                  </button>
                  <button
                    type="button"
                    ref={chatAttachmentTrayButtonRef}
                    className="chat-tool-button chat-attachment-plus-button"
                    onPointerDown={event => event.preventDefault()}
                    onClick={() => {
                      // Desktop: File and Photo both open the same native file
                      // dialog (the accept filter is switchable there), so the
                      // tray is skipped and the picker opens directly. Mobile
                      // keeps the tray because accept="image/*" routes to the
                      // photo library instead of the file manager.
                      if (isWide) {
                        chatFileInputRef.current?.click();
                        return;
                      }
                      toggleChatAttachmentTray();
                    }}
                    aria-label={isWide ? 'Attach files' : 'Attach files or photos'}
                    aria-haspopup={isWide ? undefined : 'menu'}
                    aria-expanded={isWide ? undefined : chatAttachmentTrayOpen}
                  >
                    <ChatIcon name="paperclip" />
                  </button>
                  {chatStopPillVisible ? (
                    <div className={`chat-composer-stop-slot${chatStopPillExiting ? ' sl-menu-exit' : ''}`}>
                      <ChatStopStatusPill
                        cancelling={selectedChatPromptCancelling}
                        onCancel={() => cancelSelectedChatPrompt().catch(() => undefined)}
                        armOnTap={!isWide}
                      />
                    </div>
                  ) : null}
                  {!isWide && chatAttachmentTrayOpen ? (
                    <div
                      ref={chatAttachmentTrayRef}
                      className={`chat-attachment-action-tray${chatComposerMenuExiting ? ' sl-menu-exit' : ''}`}
                      role="menu"
                      aria-label="Attachments"
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
                        aria-label="Attach file"
                        role="menuitem"
                      >
                        <ChatIcon name="paperclip" />
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
                        aria-label="Attach photo"
                        role="menuitem"
                      >
                        <ChatIcon name="camera" />
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
                        {renderChatCoreConfigSelector()}
                        {chatConfigOptions.length > 0 ? (
                          <div className="chat-config-options">
                            {chatConfigOptions.map(option => renderChatConfigPill(option))}
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
                  onCloseSurface={() => setTerminalOpen(false)}
                >
                  {activeTerminal ? (
                    <TerminalView
                      key={activeTerminalKey}
                      ref={terminalViewRef}
                      themeMode={themeMode}
                      active
                      resizeEnabled={terminalResizeTokensRef.current.has(activeTerminalKey)}
                      cols={activeTerminal.cols}
                      rows={activeTerminal.rows}
                      shell={activeTerminal.shell}
                      initialCwd={activeTerminal.initialCwd}
                      onInput={handleTerminalInput}
                      onResize={handleTerminalResize}
                      onAutoResize={handleAutoClaimTerminalResize}
                      onCopy={handleTerminalCopy}
                    />
                  ) : null}
                </TerminalWorkbench>
              </section>
            </>
          ) : null}
        </ChatSurface>
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

  const openPreviewSearch = () => {
    setPreviewSearchOpen(true);
    setPreviewSearchActiveIndex(0);
    setPreviewSelectionMenu(null);
    window.requestAnimationFrame(() => {
      previewSearchInputRef.current?.focus();
      previewSearchInputRef.current?.select();
    });
  };

  useEffect(() => {
    const container = chatFilePeekScrollRef.current;
    if (
      !container ||
      !previewSearchOpen ||
      !previewSearchQuery ||
      activeWorkbenchTab?.type !== 'file'
    ) {
      return;
    }
    const applyPreviewSearchLineClasses = () => {
      const activeLine = previewSearchMatches[previewSearchActiveIndex]?.line ?? null;
      container.querySelectorAll<HTMLElement>('[data-line-number]').forEach(line => {
        const lineNumber = Number(line.dataset.lineNumber);
        line.classList.toggle('preview-search-match', previewSearchHighlightedLines.has(lineNumber));
        line.classList.toggle('preview-search-match-active', lineNumber === activeLine);
      });
    };
    applyPreviewSearchLineClasses();
    const observer = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(applyPreviewSearchLineClasses);
    observer?.observe(container, {childList: true, subtree: true});
    return () => {
      observer?.disconnect();
      container.querySelectorAll<HTMLElement>('[data-line-number]').forEach(line => {
        line.classList.remove('preview-search-match', 'preview-search-match-active');
      });
    };
  }, [
    activeWorkbenchTab?.id,
    activeWorkbenchTab?.type,
    previewSearchActiveIndex,
    previewSearchHighlightedLines,
    previewSearchMatches,
    previewSearchOpen,
    previewSearchQuery,
  ]);

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
    if (!quickFileOpen) {
      return;
    }
    const list = quickFileResultsRef.current;
    const activeItem = list?.querySelector<HTMLElement>('.quick-file-search-option.selected');
    activeItem?.scrollIntoView({block: 'nearest'});
  }, [quickFileOpen, quickFileActiveIndex, quickFileResults]);

  useEffect(() => {
    const handleWorkspaceShortcutKeyDown = (event: KeyboardEvent) => {
      const previewTabsUnavailable = !chatPreviewOpen || previewWorkbenchTabs.length === 0;
      const decision = resolveWorkspaceShortcutDispatch(event, effectiveShortcutBindings, {
        platform: shortcutPlatform,
        isWide,
        paused: document.querySelector('[aria-modal="true"]') !== null,
        availability: {
          quickOpen: resolveQuickFileProjectId() ? null : 'Open a project to use Quick Open.',
          nextPreviewTab: previewTabsUnavailable ? 'Open Preview and a tab to switch Preview tabs.' : null,
          previousPreviewTab: previewTabsUnavailable ? 'Open Preview and a tab to switch Preview tabs.' : null,
        },
      });
      if (decision.kind === 'ignore') return;
      event.preventDefault();
      if (decision.kind === 'unavailable') {
        setToastMessage(decision.reason);
        return;
      }

      switch (decision.actionId) {
        case 'toggleSessions':
          switch (resolveSessionsShortcutAction({
            sessionPanelPinned: !sidebarCollapsed,
            temporarilyUnpinned: sessionPanelShortcutUnpinned,
            slideOutOpen: sessionNavSlideOut.open,
          })) {
            case 'open-slideout':
              dispatchSessionNavSlideOut({type: 'open'});
              break;
            case 'close-slideout':
              sessionNavSlideOutAutoClose.closeNow();
              break;
            case 'temporarily-unpin':
              sessionNavSlideOutAutoClose.closeNow();
              setSessionPanelShortcutUnpinned(true);
              break;
            case 'restore-pin':
              sessionNavSlideOutAutoClose.closeNow();
              setSessionPanelShortcutUnpinned(false);
              break;
          }
          return;
        case 'togglePreview':
          toggleChatPreviewFromTitle();
          return;
        case 'toggleTerminal':
          toggleTerminalFromTitle();
          return;
        case 'quickOpen':
          openQuickFileSearch();
          return;
        case 'nextPreviewTab':
        case 'previousPreviewTab': {
          const direction = decision.actionId === 'previousPreviewTab' ? -1 : 1;
          const nextTabId = cyclePreviewTabId(
            previewWorkbenchTabs,
            activeWorkbenchTab?.id ?? '',
            direction,
          );
          if (nextTabId) {
            const targetProjectId = activeWorkbenchTab?.projectId ?? chatPreviewProjectId;
            setPreviewWorkbench(current => selectPreviewTab(current, targetProjectId, nextTabId));
          }
          return;
        }
        case 'searchCurrentContext': {
          const previewFocused = event.target instanceof Element
            && event.target.closest('.preview-workbench-surface') !== null;
          const target = resolveWorkspaceSearchTarget({
            previewFocused,
            previewSearchable: !!activeWorkbenchTab && !previewSearchUnavailableMessage,
          });
          if (target === 'preview') {
            openPreviewSearch();
          } else {
            openChatSearch();
          }
          return;
        }
        case 'searchSessions':
          openSessionSearch();
          return;
      }
    };
    window.addEventListener('keydown', handleWorkspaceShortcutKeyDown);
    return () => window.removeEventListener('keydown', handleWorkspaceShortcutKeyDown);
  }, [
    activeWorkbenchTab,
    chatPreviewOpen,
    chatPreviewProjectId,
    effectiveShortcutBindings,
    isWide,
    openChatSearch,
    openPreviewSearch,
    openQuickFileSearch,
    openSessionSearch,
    previewSearchUnavailableMessage,
    previewWorkbenchTabs,
    resolveQuickFileProjectId,
    sessionNavSlideOut.open,
    sessionNavSlideOutAutoClose,
    sessionPanelShortcutUnpinned,
    shortcutPlatform,
    sidebarCollapsed,
    toggleChatPreviewFromTitle,
    toggleTerminalFromTitle,
  ]);

  const hasCachedWorkspace = projects.length > 0 || !!projectId;
  const keepWorkspaceVisible =
    reconnecting && hasCachedWorkspace;

  if (!connected && !keepWorkspaceVisible) {
    const launchView = resolveAppLaunchView(registryAuth.state, !!error);
    const hasDesktopTitlebar = !!getDesktopWindowBridge();
    return (
      <div className={`page theme-${themeMode}${hasDesktopTitlebar ? ' has-connect-titlebar' : ''}`}>
        {setiFontCss ? <style>{setiFontCss}</style> : null}
        {hasDesktopTitlebar ? (
          <div className="connect-titlebar">
            <span>WheelMaker</span>
            <DesktopWindowControls />
          </div>
        ) : null}
        <AppLaunchScreen status={launchView.status}>
          {launchView.content === 'login' ? (
            <form
              className="app-launch-form"
              onSubmit={event => {
                event.preventDefault();
                if (!launchView.formDisabled && loginToken.trim()) {
                  handleRegistryLogin().catch(() => undefined);
                }
              }}
            >
              <input
                className="app-launch-input"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={loginToken}
                onChange={event => setLoginToken(event.target.value)}
                placeholder="Registry token"
                disabled={launchView.formDisabled}
              />
              <button
                className="app-launch-button"
                type="submit"
                disabled={launchView.formDisabled || !loginToken.trim()}
              >
                Log in
              </button>
              {registryAuth.state === 'error' ? (
                <button
                  className="app-launch-button"
                  type="button"
                  onClick={() => void registryAuthController.check()}
                >
                  Retry
                </button>
              ) : null}
              {registryAuth.error ? (
                <div className="app-launch-error" role="alert">{registryAuth.error}</div>
              ) : null}
            </form>
          ) : null}
          {launchView.content === 'connect-retry' ? (
            <div className="app-launch-form">
              <button
                className="app-launch-button"
                disabled={autoConnecting}
                onClick={() => connect().catch(() => undefined)}
              >
                {autoConnecting ? 'Connecting...' : 'Connect'}
              </button>
              {error ? <div className="app-launch-error" role="alert">{error}</div> : null}
            </div>
          ) : null}
        </AppLaunchScreen>
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
              data-tooltip={projectItem.path || ''}
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
    <Icon name="loader" spin />
  ) : (
    <Icon name="refreshCw" />
  );

  const projectSessionActionMenuOverlay = renderProjectSessionActionMenu();
  const chatTitleProjectMenu = chatTitleProjectMenuOpen ? (
    <div
      ref={chatTitleProjectMenuRef}
      className={`chat-title-project-menu topbar-menu-surface${chatTitleProjectMenuExiting ? ' sl-menu-exit' : ''}`}
      role="menu"
      aria-label="Switch project"
      style={chatTitleProjectMenuStyle}
      onPointerDown={event => event.stopPropagation()}
    >
      {visibleProjectItems.map(projectItem => {
        const selectedProjectId = selectedChatKey?.projectId || projectId;
        const selected = projectItem.projectId === selectedProjectId;
        return (
          <div
            key={`chat-title-project:${projectItem.projectId}`}
            className={`chat-title-project-menu-item${selected ? ' selected' : ''}`}
            data-tooltip={projectItem.path || projectItem.projectId}
          >
            <button
              type="button"
              className="chat-title-project-menu-select"
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => {
                setWideProjectActionMenu(null);
                handleChatTitleProjectSelect(projectItem.projectId).catch(() => undefined);
              }}
            >
              <span className="chat-title-project-menu-name">{projectItem.name}</span>
              <span className="chat-title-project-menu-path">
                {projectItem.path || projectItem.hubId || projectItem.projectId}
              </span>
            </button>
            <button
              type="button"
              className="chat-title-project-menu-create"
              role="menuitem"
              aria-label={`New session in ${projectItem.name}`}
              data-tooltip="New session"
              onPointerDown={event => event.stopPropagation()}
              onClick={event => {
                event.stopPropagation();
                if (isWide) {
                  openWideProjectActionMenu(projectItem.projectId, 'new', event.currentTarget);
                  setChatTitleProjectMenuOpen(true);
                } else {
                  openMobileProjectActionMenu(projectItem.projectId, 'new');
                }
              }}
            >
              <SessionIcon name="plus" />
            </button>
          </div>
        );
      })}
    </div>
  ) : null;
  const chatTitlePromptMenu = chatTitlePromptMenuOpen && chatTitlePromptMenuAvailable ? (
    <div
      ref={chatTitlePromptMenuRef}
      className={`chat-title-prompt-menu topbar-menu-surface${chatTitlePromptMenuExiting ? ' sl-menu-exit' : ''}`}
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
          data-tooltip={item.preview}
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
        <MobileFloatingNav
          expanded={gestureNavigationExpanded}
          current={floatingNavCurrent}
          previewTabCount={previewTabCount}
          chatUnread={hasCompletedUnreadChatSessionIndicator}
          relay={floatingNavRelayState}
          onSelect={handleFloatingNavSelect}
          onCurrentSelect={handleGestureNavigationCurrentSelect}
          onButtonPointerDown={handleGestureNavigationPillPointerDown}
        />
      </div>
    </div>
  ) : null;

  const mobileRelayTargetSheetNode = !isWide && mobileRelayTargetSheet ? (
    <>
      <div
        className={`sl-sheet-overlay${mobileRelayTargetSheetExiting ? ' sl-menu-exit' : ''}`}
        onClick={() => setMobileRelayTargetSheet(null)}
        aria-hidden="true"
      />
      <div
        className={`mobile-project-sheet${mobileRelayTargetSheetExiting ? ' sl-menu-exit' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Port Relay targets"
      >
        <div className="mobile-project-sheet-grip" aria-hidden="true" />
        <div className="mobile-project-sheet-header">
          <SessionIcon name="radioTower" className="mobile-project-sheet-icon" />
          <span className="mobile-project-sheet-title-copy">
            <span className="mobile-project-sheet-title">Relay target</span>
            <span className="mobile-project-sheet-subtitle">
              {activePortRelayTarget
                ? `${activePortRelayTarget.hubId}:${activePortRelayTarget.targetPort}`
                : 'Select a target'}
            </span>
          </span>
          <button
            type="button"
            className="mobile-project-sheet-close"
            onClick={() => setMobileRelayTargetSheet(null)}
            aria-label="Close"
          >
            <SessionIcon name="x" />
          </button>
        </div>
        <div className="mobile-project-sheet-body">
          {portRelayTargetMenuTargets.map(target => {
            const selected = samePortRelayTarget(activePortRelayTarget, target);
            const switching = samePortRelayTarget(portRelayMenuSwitchingTarget, target);
            return (
              <button
                key={portRelayTargetKey(target)}
                type="button"
                className="wide-project-action-menu-item mobile-project-sheet-item"
                onClick={() => {
                  setMobileRelayTargetSheet(null);
                  handlePortRelayFloatingTargetSelect(target);
                }}
              >
                <SessionIcon name={switching ? 'loader' : selected ? 'check' : 'radioTower'} spin={switching} />
                <span className="mobile-project-sheet-item-label">
                  {`${target.hubId}:${target.targetPort}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  ) : null;

  const mobileSettingsTitle = settingsDetailView
    ? settingsDetailTitle(settingsDetailView)
    : 'Settings';
  const mobileSettingsActions = settingsDetailView
    ? renderSettingsDetailActions(settingsDetailView)
    : <span className="mobile-settings-action-spacer" aria-hidden="true" />;
  const settingsScreenVisible = sidebarSettingsOpen || settingsScreenMounted;
  const settingsMotionClass = settingsDetailView ? ' settings-detail-screen' : '';
  const settingsExitClass = settingsScreenExiting ? ' settings-screen-exiting' : '';
  const desktopSettingsDetailPane = settingsDetailView ?? settingsDetailPaneExit;
  const desktopSettingsDetailExiting = settingsDetailView === null && settingsDetailPaneExit !== null;

  const desktopSettingsScreen = isWide && settingsScreenVisible ? (
    <SettingsScreen
      className={`desktop-settings-screen settings-main-screen${desktopSettingsDetailPane ? ' has-detail' : ''}${settingsExitClass}`}
      title="Settings"
      actions={<span className="mobile-settings-action-spacer" aria-hidden="true" />}
      backAriaLabel={settingsDetailView ? 'Back to settings' : 'Close settings'}
      onBack={handleMobileSettingsBackButton}
      onBackdropClick={handleMobileSettingsBackButton}
    >
      {renderDesktopSettingsContent()}
    </SettingsScreen>
  ) : null;

  const mobileSettingsScreen = !isWide && settingsScreenVisible ? (
    <MobileSettingsScreen
      className={`${settingsMotionClass}${settingsExitClass}`.trim() || undefined}
      title={mobileSettingsTitle}
      actions={mobileSettingsActions}
      backAriaLabel={settingsDetailView ? 'Back to settings' : 'Back to drawer'}
      onBack={handleMobileSettingsBackButton}
    >
      {renderSettingsContent()}
    </MobileSettingsScreen>
  ) : null;
  const desktopReleasePublishingScreen = isWide && releasePublishingOpen ? (
    <SettingsScreen
      className="desktop-settings-screen release-publishing-screen"
      title="Release publishing"
      actions={null}
      backAriaLabel="Close release publishing"
      onBack={closeReleasePublishing}
      onBackdropClick={closeReleasePublishing}
    >
      {renderReleasePublishContent()}
    </SettingsScreen>
  ) : null;
  const mobileReleasePublishingScreen = !isWide && releasePublishingOpen ? (
    <MobileSettingsScreen
      title="Release publishing"
      actions={null}
      backAriaLabel="Back to chat"
      onBack={closeReleasePublishing}
    >
      {renderReleasePublishContent()}
    </MobileSettingsScreen>
  ) : null;
  const desktopPortRelayScreen = isWide && portRelayScreenOpen ? (
    <SettingsScreen
      className="desktop-settings-screen port-relay-screen"
      title="Port Relay"
      actions={portRelayRefreshAction}
      backAriaLabel="Close Port Relay"
      onBack={closePortRelayScreen}
      onBackdropClick={closePortRelayScreen}
    >
      {renderPortRelayScreenContent()}
    </SettingsScreen>
  ) : null;
  const mobilePortRelayScreen = !isWide && portRelayScreenOpen ? (
    <MobileSettingsScreen
      title="Port Relay"
      actions={portRelayRefreshAction}
      backAriaLabel="Back to chat"
      onBack={closePortRelayScreen}
    >
      {renderPortRelayScreenContent()}
    </MobileSettingsScreen>
  ) : null;
  const renderShareManager = () => (
    <ShareManager
      service={service}
      initialSource={null}
      captureSnapshot={captureShareSource}
      onBack={closeShares}
    />
  );
  const desktopSharesScreen = isWide && sharesScreenOpen ? (
    <SettingsScreen
      className="desktop-settings-screen share-manager-screen"
      title="Public shares"
      actions={null}
      backAriaLabel="Close public shares"
      onBack={closeShares}
      onBackdropClick={closeShares}
    >
      {renderShareManager()}
    </SettingsScreen>
  ) : null;
  const mobileSharesScreen = !isWide && sharesScreenOpen ? (
    <MobileSettingsScreen
      title="Public shares"
      actions={null}
      backAriaLabel="Back to chat"
      onBack={closeShares}
    >
      {renderShareManager()}
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
  const previewFileTreeDepthIndent = 14;
  const scrollLocatedPreviewFileIntoView = () => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const selected = document.querySelector('.preview-workbench-drawer-panel .preview-workbench-file-tree-content .item.selected');
        if (selected instanceof HTMLElement) {
          selected.scrollIntoView({block: 'center'});
        }
      });
    });
  };
  const locateActivePreviewFileInTree = () => {
    if (!chatFilePeek?.path) return;
    if (isAbsolutePreviewFilePath(chatFilePeek.path)) return;
    const targetPath = chatFilePeek.path;
    const targetProjectId = previewWorkbench.activeProjectId;
    if (!targetProjectId) {
      return;
    }
    const ancestors = previewFileAncestorDirs(targetPath);
    setPreviewWorkbench(current => ({...current, drawerMode: 'files'}));
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
  const managedProjectFileMenuTarget = (
    targetProjectId: string,
    path: string,
  ): ManagedFileMenuTarget | null => {
    const targetProject = projects.find(project => project.projectId === targetProjectId);
    const link = targetProject ? resolvePreviewFileLink(path, targetProject.path) : null;
    if (!targetProject || !link) {
      return null;
    }
    return {
      projectId: targetProjectId,
      projectRoot: targetProject.path,
      targetKind: link.relativePath === null ? 'external-file' : 'project-file',
      link,
      fileAvailable: true,
      downloadSource: fileDownloadSourceForLink(link),
      attachment: null,
    };
  };
  const renderPreviewFileTreeSearchResults = (
    nodes: FileSearchResultTreeNode[],
    depth = 0,
  ): React.ReactNode =>
    nodes.map(node => {
      if (node.kind === 'dir') {
        const collapsed = previewFileTreeSearchCollapsedDirs.includes(node.path);
        return (
          <div key={`preview-file-search-dir:${node.path}`}>
            <button
              type="button"
              className="preview-workbench-file-search-node dir"
              onClick={() => togglePreviewFileTreeSearchDirectory(node.path)}
              data-tooltip={node.path}
              aria-expanded={!collapsed}
            >
              <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} className="caret" />
              <Icon name={collapsed ? 'folder' : 'folderOpen'} className="node-icon" />
              <span className="label">{node.name}</span>
            </button>
            {collapsed ? null : (
              <div
                className="preview-workbench-file-search-children"
                style={{marginLeft: previewFileTreeDepthIndent}}
              >
                {renderPreviewFileTreeSearchResults(node.children, depth + 1)}
              </div>
            )}
          </div>
        );
      }

      const fileIcon = resolveFileIcon(node.name);
      const resultIndex = previewFileTreeSearchVisibleResults.findIndex(item => item.path === node.path);
      const selected = node.path === previewFileTreeSearchActivePath;
      const fileMenuTarget = managedProjectFileMenuTarget(
        previewWorkbench.activeProjectId,
        node.path,
      );
      return (
        <button
          key={`preview-file-search-file:${node.path}`}
          type="button"
          className={`preview-workbench-file-search-node file${selected ? ' selected' : ''}`}
          {...(fileMenuTarget ? bindManagedFileContextMenu(fileMenuTarget) : {})}
          onMouseEnter={() => {
            if (resultIndex >= 0) {
              setPreviewFileTreeSearchActiveIndex(resultIndex);
            }
          }}
          onClick={() => openPreviewFileTreeSearchResult(node.result)}
          data-tooltip={node.path}
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
          showSectionTitle={false}
          dirEntries={chatFilePreviewDirEntries}
          loadingDirs={chatFilePreviewLoadingDirs}
          selectedFile={chatFilePeek?.path ?? ''}
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
          onFileContextMenu={(path, position) => {
            const target = managedProjectFileMenuTarget(
              previewWorkbench.activeProjectId,
              path,
            );
            if (target) {
              openManagedFileContextMenu(target, position);
            }
          }}
        />
      )}
    </div>
  );
  const toggleChatFilePreviewTree = () => {
    updatePreviewDrawerMode(previewWorkbenchRef.current.drawerMode === 'files' ? 'closed' : 'files');
  };
  const selectWorkbenchTab = (projectId: string, tabId: string) => {
    setPreviewWorkbench(current => selectPreviewTab(current, projectId, tabId));
  };
  const closeWorkbenchTab = (projectId: string, tabId: string) => {
    const loadKey = fileMemoryCacheKey(projectId, tabId);
    previewFileLoadControllersRef.current.get(loadKey)?.abort();
    previewFileLoadControllersRef.current.delete(loadKey);
    const projectTabs = previewWorkbench.tabsByProjectId[projectId] ?? [];
    const closingLastTab = projectTabs.length === 1 &&
      projectTabs[0]?.id === tabId;
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
    if (previewWorkbench.drawerMode !== 'files' || event.defaultPrevented) {
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
  const downloadManagedFile = (
    targetProjectId: string,
    source: RegistryFileDownloadSource,
  ) => {
    const csrfToken = registryAuth.status?.csrfToken || '';
    if (!csrfToken) {
      setToastMessage('File download is unavailable.');
      return;
    }
    startManagedFileDownload({
      projectId: targetProjectId,
      csrfToken,
      source,
      prepare: (projectId, targetCSRFToken, targetSource) =>
        service.prepareFileDownload(projectId, targetCSRFToken, targetSource),
    }).catch(error => {
      setToastMessage(fileDownloadFailureMessage(error));
    });
  };
  const handleChatFileLinkMenuAction = (action: ChatFileLinkMenuAction) => {
    if (!chatFileLinkMenu) return;
    const menuState = chatFileLinkMenu;
    const link = menuState.link;
    const target = link ? {
      absolutePath: link.absolutePath,
      projectRoot: menuState.projectRoot,
      relativePath: link.relativePath,
    } : null;
    const relativePath = link?.relativePath ?? null;
    const absolutePath = link?.absolutePath ?? '';
    const menuProjectId = chatFileLinkMenu.projectId;
    const menuFilePath = link?.path ?? '';
    const menuLine = link?.line ?? null;
    setChatFileLinkMenu(null);

    if (action === 'preview') {
      if (menuState.attachment) {
        openChatAttachmentPreview(
          menuState.attachment.block,
          menuState.attachment.message,
        );
      } else if (link) {
        openChatFilePeek(menuFilePath, menuLine, menuProjectId);
      }
      return;
    }
    if (action === 'download') {
      if (!menuState.fileAvailable || !menuState.downloadSource) {
        setToastMessage('File download is unavailable.');
        return;
      }
      downloadManagedFile(menuProjectId, menuState.downloadSource);
      return;
    }
    if (action === 'copy-relative') {
      if (!link || relativePath === null) return;
      writeTextToClipboard(relativePath)
        .then(() => setToastMessage('Copied relative path.'))
        .catch(err => {
          const reason = err instanceof Error ? err.message : String(err);
          setToastMessage(`Failed to copy relative path: ${reason}`);
        });
      return;
    }
    if (action === 'copy-absolute') {
      if (!link) return;
      writeTextToClipboard(absolutePath)
        .then(() => setToastMessage('Copied absolute path.'))
        .catch(err => {
          const reason = err instanceof Error ? err.message : String(err);
          setToastMessage(`Failed to copy absolute path: ${reason}`);
        });
      return;
    }
    if (action === 'copy-file') {
      const desktopBridge = getDesktopWindowBridge();
      if (!link || !desktopBridge || !absolutePath) return;
      copyDesktopFile(desktopBridge, absolutePath)
        .then(() => setToastMessage('Copied file.'))
        .catch(err => {
          const reason = err instanceof Error ? err.message : String(err);
          setToastMessage(`Failed to copy file: ${reason}`);
        });
      return;
    }
    if (action === 'share') {
      const external = menuState.targetKind === 'external-file';
      const sharePath = external ? absolutePath : relativePath;
      if (!sharePath) return;
      const kind = external ? shareKindForExternalPath(sharePath) : shareKindForPath(sharePath);
      if (!kind) return;
      openShareCreate({
        projectId: menuProjectId,
        path: sharePath,
        kind,
        title: sharePath.replaceAll('\\', '/').split('/').pop() || sharePath,
        ...(external ? {external: true} : {}),
      });
      return;
    }
    if (action === 'export-html') {
      if (!link) return;
      const external = menuState.targetKind === 'external-file';
      const exportPath = external ? absolutePath : relativePath;
      if (!exportPath || !isMarkdownPath(exportPath)) return;
      (external
        ? service.readExternalFile(menuProjectId, exportPath)
        : service.readProjectFile(exportPath, menuProjectId)
      )
        .then(file => {
          if (file.isBinary) {
            throw new Error('Markdown file content is unavailable.');
          }
          return startMarkdownHtmlExport({
            content: file.content,
            title: exportPath.replaceAll('\\', '/').split('/').pop() || exportPath,
            fileName: buildMarkdownHtmlFileName(exportPath),
            projectId: menuProjectId,
            sourcePath: exportPath,
            external,
            key: `file:${menuProjectId}:${exportPath}`,
          });
        })
        .catch(error => {
          setError(`Failed to export HTML: ${error instanceof Error ? error.message : String(error)}`);
        });
      return;
    }

    if (action !== 'vscode' && action !== 'folder') {
      return;
    }
    const desktopBridge = getDesktopWindowBridge();
    if (!link || !desktopBridge || !target) return;
    const failurePrefix = action === 'vscode'
      ? 'Failed to open file in VS Code'
      : 'Failed to show file in File Explorer';
    invokeDesktopFileAction(desktopBridge, action, target).catch(err => {
      const reason = err instanceof Error ? err.message : String(err);
      setToastMessage(`${failurePrefix}: ${reason}`);
    });
  };
  const copyChatFilePreviewPath = () => {
    if (!chatFilePeek) return;
    const previewProject = projects.find(item => item.projectId === previewWorkbench.activeProjectId);
    const projectRoot = previewProject?.path ?? currentProject?.path ?? '';
    const confirmedPath = resolvePreviewDesktopFilePath(chatFilePeek);
    if (!confirmedPath) return;
    const fileTarget = resolvePreviewFileLink(confirmedPath, projectRoot);
    if (!fileTarget?.absolutePath) return;
    writeTextToClipboard(fileTarget.absolutePath).catch(() => undefined);
  };
  const copyPreviewWorkbenchTabPath = (tab: PreviewWorkbenchTab) => {
    const projectRoot = projects.find(item => item.projectId === tab.projectId)?.path ?? '';
    const confirmedPath = resolvePreviewDesktopFilePath(tab);
    if (!confirmedPath) return;
    const fileTarget = resolvePreviewFileLink(confirmedPath, projectRoot);
    if (!fileTarget?.absolutePath) return;
    writeTextToClipboard(fileTarget.absolutePath).catch(() => undefined);
  };
  const openPreviewWorkbenchTabRelayInBrowser = (tab: PreviewWorkbenchTab) => {
    const url = tab.type === 'port-relay' ? tab.url || portRelayFrameUrl : '';
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
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
  const getPreviewTabMenuContext = (tab: PreviewWorkbenchTab) => {
    const projectRoot = projects.find(project => project.projectId === tab.projectId)?.path ?? '';
    const confirmedPath = resolvePreviewDesktopFilePath(tab);
    const fileTarget = confirmedPath
      ? resolvePreviewFileLink(confirmedPath, projectRoot)
      : null;
    const desktopTarget = fileTarget
      ? {
          absolutePath: fileTarget.absolutePath,
          projectRoot,
          relativePath: fileTarget.relativePath,
        }
      : null;
    const desktopBridge = getDesktopWindowBridge();
    const canOpenProjectFileInVSCode = desktopTarget
      ? canInvokeDesktopFileAction(desktopBridge, 'vscode', desktopTarget)
      : false;
    const canShowProjectFileInFolder = desktopTarget
      ? canInvokeDesktopFileAction(desktopBridge, 'folder', desktopTarget)
      : false;
    const attachmentDownloadPayload = tab.type === 'attachment'
      ? attachmentPreviewReadPayloadFromKey(tab)
      : null;
    const downloadSource: RegistryFileDownloadSource | null = fileTarget
      ? fileDownloadSourceForLink(fileTarget)
      : attachmentDownloadPayload
        ? {kind: 'session-attachment', ...attachmentDownloadPayload}
        : null;
    const previewTabTarget = tab.type === 'file'
      ? {
          kind: fileTarget && fileTarget.relativePath === null
            ? 'preview-external-file' as const
            : 'preview-file' as const,
          path: fileTarget?.relativePath ?? fileTarget?.absolutePath ?? fileTarget?.path,
          available: !tab.loading && !tab.error && !!fileTarget,
          downloadAvailable: !!downloadSource,
          refreshAvailable: true,
          refreshDisabled: tab.loading,
        }
      : tab.type === 'attachment'
        ? {
            kind: 'preview-attachment' as const,
            available: !tab.loading && !tab.error,
            downloadAvailable: !!downloadSource,
          }
        : tab.type === 'port-relay'
          ? {kind: 'relay' as const}
          : tab.type === 'prompt-diff'
            ? {kind: 'prompt-diff' as const}
            : {kind: 'git-diff' as const};
    return {
      projectRoot,
      fileTarget,
      desktopTarget,
      desktopBridge,
      downloadSource,
      model: buildContextMenuModel({
        surface: 'preview-tab',
        platform: resolveFileMenuPlatform(desktopBridge),
        target: previewTabTarget,
        capabilities: {
          canOpenInVSCode: canOpenProjectFileInVSCode,
          canShowInExplorer: canShowProjectFileInFolder,
          canCopyFile: fileTarget
            ? canCopyDesktopFile(desktopBridge, fileTarget.absolutePath)
            : false,
        },
      }),
    };
  };
  const handlePreviewTabMenuAction = (
    tab: PreviewWorkbenchTab,
    action: ChatFileLinkMenuAction,
    closeMenu: () => void,
  ) => {
    const context = getPreviewTabMenuContext(tab);
    const {
      fileTarget,
      desktopTarget,
      desktopBridge,
      downloadSource,
    } = context;
    if (action === 'download') {
      closeMenu();
      if (downloadSource) downloadManagedFile(tab.projectId, downloadSource);
      return;
    }
    if (action === 'vscode' || action === 'folder') {
      closeMenu();
      setToastMessage('');
      if (!desktopBridge || !desktopTarget) return;
      const failurePrefix = action === 'vscode'
        ? 'Failed to open file in VS Code'
        : 'Failed to show file in File Explorer';
      Promise.resolve()
        .then(() => invokeDesktopFileAction(desktopBridge, action, desktopTarget))
        .catch(err => {
          const reason = err instanceof Error ? err.message : String(err);
          setToastMessage(`${failurePrefix}: ${reason}`);
        });
      return;
    }
    if (action === 'copy-file') {
      closeMenu();
      if (!desktopBridge || !fileTarget?.absolutePath) return;
      copyDesktopFile(desktopBridge, fileTarget.absolutePath)
        .then(() => setToastMessage('Copied file.'))
        .catch(err => {
          const reason = err instanceof Error ? err.message : String(err);
          setToastMessage(`Failed to copy file: ${reason}`);
        });
      return;
    }
    if (action === 'copy-relative') {
      closeMenu();
      const relativePath = fileTarget?.relativePath;
      if (relativePath === null || relativePath === undefined) return;
      writeTextToClipboard(relativePath)
        .then(() => setToastMessage('Copied relative path.'))
        .catch(err => {
          const reason = err instanceof Error ? err.message : String(err);
          setToastMessage(`Failed to copy relative path: ${reason}`);
        });
      return;
    }
    if (action === 'copy-absolute') {
      copyPreviewWorkbenchTabPath(tab);
      closeMenu();
      return;
    }
    if (action === 'share') {
      closeMenu();
      if (tab.type !== 'file' || !fileTarget) return;
      const external = fileTarget.relativePath === null;
      const sharePath = external ? fileTarget.absolutePath : fileTarget.relativePath;
      if (!sharePath) return;
      const kind = external ? shareKindForExternalPath(sharePath) : shareKindForPath(sharePath);
      if (!kind) return;
      openShareCreate({
        projectId: tab.projectId,
        path: sharePath,
        kind,
        title: tab.title || sharePath.replaceAll('\\', '/').split('/').pop() || 'Document',
        content: tab.content,
        ...(external ? {external: true} : {}),
      });
      return;
    }
    if (action === 'export-html') {
      closeMenu();
      if (tab.type !== 'file' || !fileTarget || tab.info?.isBinary) return;
      const external = fileTarget.relativePath === null;
      const exportPath = external ? fileTarget.absolutePath : fileTarget.relativePath;
      if (!exportPath || !isMarkdownPath(exportPath)) return;
      startMarkdownHtmlExport({
        content: tab.content,
        title: tab.title || exportPath.replaceAll('\\', '/').split('/').pop() || 'Markdown document',
        fileName: buildMarkdownHtmlFileName(exportPath),
        projectId: tab.projectId,
        sourcePath: exportPath,
        external,
        key: `file:${tab.projectId}:${exportPath}`,
      }).catch(() => undefined);
      return;
    }
    if (action === 'refresh') {
      closeMenu();
      if (tab.type === 'file') {
        readChatFilePeek(tab.path, null, tab.projectId).catch(() => undefined);
      }
      return;
    }
    if (action === 'open-relay') {
      if (tab.type === 'port-relay') openPreviewWorkbenchTabRelayInBrowser(tab);
      closeMenu();
    }
  };
  const renderPreviewTabActions = (tab: PreviewWorkbenchTab, closeMenu: () => void) => {
    const {model} = getPreviewTabMenuContext(tab);
    return (
      <ContextMenuItems
        model={model}
        onAction={action => handlePreviewTabMenuAction(tab, action, closeMenu)}
        itemClassName="preview-workbench-action-menu-item"
        separatorClassName="preview-workbench-action-menu-separator"
      />
    );
  };
  const renderPreviewWorkbenchTabBody = (tab: PreviewWorkbenchTab, mode: 'desktop' | 'mobile', active: boolean) => {
    const fileHighlightedLines = active && tab.type === 'file' && previewSearchOpen
      ? new Set([...chatPeekSelectedLines, ...previewSearchHighlightedLines])
      : chatPeekSelectedLines;
    if (tab.type === 'file') {
      return (
        <ChatFilePeekViewer
          peek={tab}
          mode={mode}
          tabs={EMPTY_PREVIEW_WORKBENCH_TABS}
          treeOpen={previewWorkbench.drawerMode === 'files'}
          themeMode={themeMode}
          codeTheme={codeTheme}
          codeFont={codeFont}
          codeFontSize={codeFontSize}
          codeLineHeight={codeLineHeight}
          codeTabSize={codeTabSize}
          wrapLines={wrapLines}
          showLineNumbers={showLineNumbers}
          highlightedLines={active ? fileHighlightedLines : EMPTY_HIGHLIGHTED_LINES}
          onLineClick={active ? handlePeekLineClick : undefined}
          onClose={closeChatFilePeekFromChrome}
          onCopyPath={copyChatFilePreviewPath}
          onTabSelect={() => undefined}
          onTabClose={() => undefined}
          onToggleTree={toggleChatFilePreviewTree}
          treeContent={null}
          scrollRef={chatFilePeekScrollRef}
          htmlPreviewEndpoint={registryEndpoints.previewURL.toString()}
          htmlPreviewCSRFToken={registryAuth.status?.csrfToken || ''}
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
    if (tab.type === 'git-diff') {
      return (
        <UnifiedDiffPreview
          files={tab.files}
          activeFilePath={tab.activeFilePath}
          loading={tab.loading}
          error={tab.error}
          overviewLabel={tab.source.kind === 'commit'
            ? `${tab.source.sha.slice(0, 7)} · ${tab.files.length} files`
            : `${tab.source.scope} · ${tab.activeFilePath}`}
          onToggleFile={toggleGitDiffPreviewFile}
          themeMode={themeMode}
          codeTheme={codeTheme}
          codeFont={codeFont}
          codeFontFamily={codeFontFamily}
          codeFontSize={codeFontSize}
          codeLineHeight={codeLineHeight}
          codeTabSize={codeTabSize}
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
          htmlPreviewEndpoint={registryEndpoints.previewURL.toString()}
          htmlPreviewCSRFToken={registryAuth.status?.csrfToken || ''}
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
          <ChatIcon name="appWindow" size={16} />
          <span>No preview selected</span>
          <button
            type="button"
            className="chat-file-workbench-empty-action"
            onClick={toggleChatFilePreviewTree}
          >
            <ChatIcon name="folderOpen" size={14} />
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
    <div className="preview-workbench-search-hud">
      <div className="preview-workbench-search-bar">
        <Icon name="search" />
        <input
          ref={previewSearchInputRef}
          className="preview-workbench-search-input"
          value={previewSearchQuery}
          onChange={event => setPreviewSearchQuery(event.target.value)}
          onKeyDown={handlePreviewSearchInputKeyDown}
          placeholder="Search"
          aria-label="Search current preview"
        />
        <span
          className={`preview-workbench-search-status${previewSearchQuery && previewSearchMatches.length === 0 ? ' no-results' : ''}`}
        >
          {previewSearchStatus}
        </span>
        <button
          type="button"
          className="chat-preview-icon-button"
          onClick={() => navigatePreviewSearchMatch(-1)}
          disabled={previewSearchMatches.length === 0}
          data-tooltip="Previous match"
          aria-label="Previous match"
        >
          <Icon name="chevronUp" />
        </button>
        <button
          type="button"
          className="chat-preview-icon-button"
          onClick={() => navigatePreviewSearchMatch(1)}
          disabled={previewSearchMatches.length === 0}
          data-tooltip="Next match"
          aria-label="Next match"
        >
          <Icon name="chevronDown" />
        </button>
        <button
          type="button"
          className="chat-preview-icon-button"
          onClick={closePreviewSearch}
          aria-label="Close search"
        >
          <Icon name="x" />
        </button>
      </div>
    </div>
  ) : null;
  const chatSearchStatus = chatSearchQuery
    ? chatSearchMatches.length > 0
      ? `${chatSearchActiveIndex + 1}/${chatSearchMatches.length}`
      : 'No results'
    : 'Search current session';
  const chatSearchBar = chatSearchOpen ? (
    <div className="chat-search-bar chat-search-hud">
      <Icon name="search" />
      <input
        ref={chatSearchInputRef}
        className="chat-search-input"
        value={chatSearchQuery}
        onChange={event => setChatSearchQuery(event.target.value)}
        onKeyDown={handleChatSearchInputKeyDown}
        placeholder="Search"
        aria-label="Search current session"
      />
      <span className={`chat-search-status${chatSearchQuery && chatSearchMatches.length === 0 ? ' no-results' : ''}`}>
        {chatSearchStatus}
      </span>
      <button
        type="button"
        className="chat-search-icon-button"
        onClick={() => navigateChatSearchMatch(-1)}
        disabled={chatSearchMatches.length === 0}
        data-tooltip="Previous match"
        aria-label="Previous match"
      >
        <Icon name="chevronUp" />
      </button>
      <button
        type="button"
        className="chat-search-icon-button"
        onClick={() => navigateChatSearchMatch(1)}
        disabled={chatSearchMatches.length === 0}
        data-tooltip="Next match"
        aria-label="Next match"
      >
        <Icon name="chevronDown" />
      </button>
      <button
        type="button"
        className="chat-search-icon-button"
        onClick={closeChatSearch}
        aria-label="Close search"
      >
        <Icon name="x" />
      </button>
    </div>
  ) : null;
  const previewFileTreeSearch = (
    <>
      <Icon name="search" className="preview-workbench-tree-search-icon" />
      <input
        ref={previewFileTreeSearchInputRef}
        className="preview-workbench-tree-search-input preview-workbench-drawer-primary-control"
        value={previewFileTreeSearchQuery}
        onChange={event => updatePreviewFileTreeSearchQuery(event.target.value)}
        onKeyDown={handlePreviewFileTreeSearchInputKeyDown}
        placeholder="Search files"
        aria-label="Search files"
      />
      <button
        type="button"
        className="preview-workbench-tree-tool-button preview-workbench-drawer-icon-button"
        onClick={locateActivePreviewFileInTree}
        disabled={!chatFilePeek?.path || isAbsolutePreviewFilePath(chatFilePeek.path)}
        data-tooltip={chatFilePeek?.path ? 'Locate current file' : 'No current file to locate'}
        aria-label="Locate current file"
      >
        <Icon name="locateFixed" />
      </button>
      <button
        type="button"
        className={`preview-workbench-tree-tool-button preview-workbench-drawer-icon-button${previewDrawerPinned ? ' active' : ''}`}
        onClick={() => setPreviewDrawerPinned(pinned => !pinned)}
        data-tooltip={previewDrawerPinned ? 'Unpin drawer' : 'Pin drawer open'}
        aria-label={previewDrawerPinned ? 'Unpin drawer' : 'Pin drawer open'}
        aria-pressed={previewDrawerPinned}
      >
        <Icon name="pin" />
      </button>
    </>
  );
  const previewGitHistoryDrawer = previewGitSnapshot.available ? (
    <GitHistoryPanel
      snapshot={previewGitSnapshot}
      onSelectedRefsChange={refs => { void gitBrowserStore.setSelectedRefs(previewGitSnapshot.projectId, refs); }}
      onToggleCommit={sha => { void gitBrowserStore.toggleCommit(previewGitSnapshot.projectId, sha); }}
      onFileOpen={(source, file) => openGitDiffPreview(previewGitSnapshot.projectId, source, file)}
      onRefresh={() => { void gitBrowserStore.refresh(previewGitSnapshot.projectId); }}
      onLoadMore={() => { void gitBrowserStore.loadMore(previewGitSnapshot.projectId); }}
      onRetry={() => { void gitBrowserStore.refresh(previewGitSnapshot.projectId); }}
      onCopyCommitSha={sha => { writeTextToClipboard(sha).catch(() => undefined); }}
      resolveFileIcon={resolveFileIcon}
      drawerPinned={previewDrawerPinned}
      onToggleDrawerPin={() => setPreviewDrawerPinned(pinned => !pinned)}
    />
  ) : null;
  const renderPreviewWorkbenchSurface = (mode: 'desktop' | 'mobile') => (
    <PreviewWorkbenchChrome
      mode={mode}
      activeTab={previewWorkbenchActiveTab}
      tabs={previewWorkbenchTabs}
      drawerMode={previewWorkbench.drawerMode}
      drawerPinned={previewDrawerPinned}
      drawerPortalTarget={mode === 'desktop' ? previewDrawerHost : null}
      fileDrawer={chatFilePreviewTreeContent}
      fileDrawerSearch={previewFileTreeSearch}
      gitDrawer={previewGitHistoryDrawer}
      actions={activeWorkbenchTab
        ? renderPreviewTabActions(activeWorkbenchTab, () => setPreviewWorkbenchActionsMenuOpen(false))
        : null}
      actionsMenuOpen={previewWorkbenchActionsMenuOpen}
      onClose={closeChatFilePeekFromChrome}
      onTabSelect={selectWorkbenchTab}
      onTabClose={closeWorkbenchTab}
      onTabContextMenu={(tabId, position) => setPreviewTabMenu({tabId, ...position})}
      onDrawerModeChange={updatePreviewDrawerMode}
      onActionsMenuToggle={() => setPreviewWorkbenchActionsMenuOpen(open => !open)}
      onActionsMenuClose={() => setPreviewWorkbenchActionsMenuOpen(false)}
      searchActive={previewSearchOpen}
      searchDisabled={!activeWorkbenchTab || !!previewSearchUnavailableMessage}
      onSearch={() => openPreviewSearch()}
      onWorkbenchKeyDown={handlePreviewWorkbenchKeyDown}
      onMobilePortRelayRefresh={refreshActivePortRelayPreview}
      mobileFullscreen={mode === 'mobile' && previewWorkbenchFullscreen}
      onMobileFullscreenChange={setPreviewWorkbenchFullscreen}
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
    <>
      <aside
        className="chat-preview-pane"
        style={{ '--chat-file-peek-width': `${effectiveChatFilePeekWidth}px` } as React.CSSProperties}
      >
        <button
          type="button"
          className={`chat-file-peek-resize-handle${chatFilePeekResizing ? ' resizing' : ''}`}
          aria-label="Resize preview"
          data-tooltip="Resize preview"
          onPointerDown={beginChatFilePeekResize}
          onPointerMove={moveChatFilePeekResize}
          onPointerUp={finishChatFilePeekResize}
          onPointerCancel={finishChatFilePeekResize}
          onLostPointerCapture={commitChatFilePeekResize}
        />
        {renderPreviewWorkbenchSurface('desktop')}
      </aside>
      <div
        ref={setPreviewDrawerHost}
        className="chat-preview-drawer-host"
        style={{right: `${effectiveChatFilePeekWidth}px`}}
      />
    </>
  ) : null;
  const previewTabMenuTab = previewTabMenu
    ? previewWorkbenchTabs.find(tab => tab.id === previewTabMenu.tabId) ?? null
    : null;
  const previewTabContextMenuModel = previewTabMenuTab
    ? getPreviewTabMenuContext(previewTabMenuTab).model
    : null;
  const previewTabContextMenuOverlay = previewTabMenu && previewTabMenuTab && previewTabContextMenuModel ? (
    <PreviewTabContextMenu
      x={previewTabMenu.x}
      y={previewTabMenu.y}
      model={previewTabContextMenuModel}
      onAction={action => handlePreviewTabMenuAction(
        previewTabMenuTab,
        action,
        () => setPreviewTabMenu(null),
      )}
      onClose={() => setPreviewTabMenu(null)}
      exiting={previewTabMenuExiting}
    />
  ) : null;
  const chatPreviewMobileOverlay = !isWide ? (
    <div
      className="chat-preview-mobile-overlay"
      hidden={!chatPreviewOpen}
      aria-hidden={chatPreviewOpen ? undefined : true}
      role="dialog"
      aria-label="Chat preview"
    >
      {renderPreviewWorkbenchSurface('mobile')}
    </div>
  ) : null;
  const usageHistoryOverlay = usageHistoryDialogView ? (
    <UsageHistoryDialog
      state={usageHistoryDialogView.state}
      triggerElement={usageHistoryDialogView.target.triggerElement}
      onClose={closeUsageHistory}
      onRetry={() => { void loadUsageHistoryDialog(usageHistoryDialogView.target); }}
      exiting={usageHistoryDialogExiting}
    />
  ) : null;
  const deepSeekUsageOverlay = deepSeekUsageDialogView ? (
    <DeepSeekUsageDialog
      state={deepSeekUsageDialogView.state}
      triggerElement={deepSeekUsageDialogView.target.triggerElement}
      onClose={closeDeepSeekUsage}
      onRetry={() => { void loadDeepSeekUsage(deepSeekUsageDialogView.target, deepSeekUsageDialogView.month, true); }}
      onMonthChange={changeDeepSeekMonth}
      onSaveToken={saveDeepSeekToken}
      onClearToken={clearDeepSeekToken}
      exiting={deepSeekUsageDialogExiting}
    />
  ) : null;
  const mobileUsageOverlay = !isWide && (mobileUsageOpen || mobileUsageMounted) ? (
    <MobileUsageDialog
      snapshot={visibleUsageSnapshot}
      efficiencySnapshot={modelEfficiencySnapshot}
      onRefresh={() => { void refreshUsageAcrossHubs(); }}
      onRefreshEfficiency={() => void modelEfficiencyStore.refresh()}
      onClose={() => setMobileUsageOpen(false)}
      onOpenHistory={handleUsageRowActivate}
      exiting={mobileUsageExiting}
    />
  ) : null;
  const terminalMobileOverlay = !isWide ? (
    <div
      className="terminal-mobile-overlay"
      hidden={!terminalOpen}
      aria-hidden={terminalOpen ? undefined : true}
      role="dialog"
      aria-label="Terminal"
    >
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
        mobileFullscreen={terminalFullscreen}
        onMobileFullscreenChange={setTerminalFullscreen}
      >
        {activeTerminal ? (
          <TerminalView
            key={`mobile:${activeTerminalKey}`}
            ref={terminalViewRef}
            themeMode={themeMode}
            active={terminalOpen}
            resizeEnabled={terminalOpen && terminalResizeTokensRef.current.has(activeTerminalKey)}
            cols={activeTerminal.cols}
            rows={activeTerminal.rows}
            shell={activeTerminal.shell}
            initialCwd={activeTerminal.initialCwd}
            onInput={handleTerminalInput}
            onResize={handleTerminalResize}
            onAutoResize={handleAutoClaimTerminalResize}
            onCopy={handleTerminalCopy}
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
        <div className="quick-file-search-input-row">
          {quickFileLoading ? <Icon name="loader" spin /> : <Icon name="search" />}
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
            role="combobox"
            aria-expanded="true"
            aria-controls="quick-file-search-results"
            aria-activedescendant={
              quickFileResults.length > 0 ? `quick-file-option-${quickFileActiveIndex}` : undefined
            }
          />
          <span className="quick-file-search-project" data-tooltip={quickFileProjectName}>
            {quickFileProjectName}
          </span>
        </div>
        <div
          ref={quickFileResultsRef}
          id="quick-file-search-results"
          className={`quick-file-search-results${quickFileLoading && quickFileResults.length > 0 ? ' refreshing' : ''}`}
          role="listbox"
          aria-label="Files"
          aria-busy={quickFileLoading}
        >
          {quickFileResults.length > 0 ? (
            quickFileResults.map((result, index) => {
              const selected = index === quickFileActiveIndex;
              const name = result.name || chatFileMentionName(result.path);
              const fileIcon = fileIconResources ? resolveFileIcon(name) : null;
              const fileMenuTarget = managedProjectFileMenuTarget(
                quickFileProjectId,
                result.path,
              );
              return (
                <button
                  key={`quick-file:${result.path}`}
                  id={`quick-file-option-${index}`}
                  type="button"
                  className={`quick-file-search-option${selected ? ' selected' : ''}`}
                  {...(fileMenuTarget ? bindManagedFileContextMenu(fileMenuTarget) : {})}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setQuickFileActiveIndex(index)}
                  onClick={() => openQuickFileResult(result)}
                  data-tooltip={result.path}
                >
                  {fileIcon ? (
                    <span className="node-icon seti-icon" style={{color: fileIcon.color}}>
                      <span className="seti-glyph">{fileIcon.glyph}</span>
                    </span>
                  ) : (
                    <Icon name="file" />
                  )}
                  <span className="quick-file-search-name">
                    {renderQuickFileMatchText(name, quickFileQuery, `quick-file-name:${result.path}`)}
                  </span>
                  <span className="quick-file-search-path">{result.path}</span>
                </button>
              );
            })
          ) : quickFileLoading ? (
            <div className="quick-file-search-skeleton" aria-hidden="true">
              {CHAT_FILE_MENTION_SKELETON_ROWS.map(row => (
                <div key={row} className="chat-file-mention-skeleton-row">
                  <span className="chat-file-mention-skeleton-icon" />
                  <span className="chat-file-mention-skeleton-name" />
                  <span className="chat-file-mention-skeleton-path" />
                </div>
              ))}
            </div>
          ) : quickFileError ? (
            <div className="quick-file-search-empty">{quickFileError}</div>
          ) : !quickFileIndexed ? (
            <div className="quick-file-search-empty">
              File index is not ready.
              <span className="quick-file-search-empty-hint">Wait a moment and try again.</span>
            </div>
          ) : (
            <div className="quick-file-search-empty">
              {quickFileQuery ? `No files matching “${quickFileQuery}”` : 'No indexed files'}
              {quickFileQuery ? (
                <span className="quick-file-search-empty-hint">Try a different file name or path.</span>
              ) : null}
            </div>
          )}
        </div>
        <ChatMenuKeyHints hints={[['↑↓', 'Select'], ['↵', 'Open'], ['esc', 'Close']]} />
      </div>
    </div>
  ) : null;
  const previewSelectionContextMenuModel = previewSelectionMenu
    ? buildContextMenuModel({
        surface: 'selection',
        platform: resolveFileMenuPlatform(getDesktopWindowBridge()),
        target: {kind: 'selection'},
      })
    : null;
  const previewSelectionContextMenu = previewSelectionMenu && previewSelectionContextMenuModel ? (
    <ContextMenu
      x={previewSelectionMenu.x}
      y={previewSelectionMenu.y}
      model={previewSelectionContextMenuModel}
      onAction={action => {
        if (action === 'copy-selection') copyPreviewSelection();
      }}
      onClose={() => setPreviewSelectionMenu(null)}
      className="preview-selection-context-menu"
      exiting={previewSelectionMenuExiting}
      ariaLabel="Selection actions"
    />
  ) : null;
  const chatFileLinkDesktopBridge = getDesktopWindowBridge();
  const chatFileLinkDesktopTarget = chatFileLinkMenu?.link ? {
    absolutePath: chatFileLinkMenu.link.absolutePath,
    projectRoot: chatFileLinkMenu.projectRoot,
    relativePath: chatFileLinkMenu.link.relativePath,
  } : null;
  const chatFileLinkMenuPath = chatFileLinkMenu?.link
    ? chatFileLinkMenu.targetKind === 'external-file'
      ? chatFileLinkMenu.link.absolutePath || chatFileLinkMenu.link.path
      : chatFileLinkMenu.link.relativePath ?? chatFileLinkMenu.link.path
    : undefined;
  const chatFileLinkContextMenuModel = chatFileLinkMenu
    ? buildContextMenuModel({
        surface: 'file',
        platform: resolveFileMenuPlatform(chatFileLinkDesktopBridge),
        target: {
          kind: chatFileLinkMenu.targetKind,
          path: chatFileLinkMenuPath,
          available: chatFileLinkMenu.fileAvailable,
          downloadAvailable: !!chatFileLinkMenu.downloadSource,
        },
        capabilities: {
          canOpenInVSCode: chatFileLinkDesktopTarget
            ? canInvokeDesktopFileAction(
                chatFileLinkDesktopBridge,
                'vscode',
                chatFileLinkDesktopTarget,
              )
            : false,
          canShowInExplorer: chatFileLinkDesktopTarget
            ? canInvokeDesktopFileAction(
                chatFileLinkDesktopBridge,
                'folder',
                chatFileLinkDesktopTarget,
              )
            : false,
          canCopyFile: !!chatFileLinkMenu.link && canCopyDesktopFile(
            chatFileLinkDesktopBridge,
            chatFileLinkMenu.link.absolutePath,
          ),
        },
      })
    : null;
  const chatFileLinkContextMenu = chatFileLinkMenu && chatFileLinkContextMenuModel ? (
    <ChatFileLinkContextMenu
      x={chatFileLinkMenu.x}
      y={chatFileLinkMenu.y}
      model={chatFileLinkContextMenuModel}
      exiting={chatFileLinkMenuExiting}
      onAction={handleChatFileLinkMenuAction}
      onClose={() => setChatFileLinkMenu(null)}
    />
  ) : null;

  const archiveTarget = confirmTarget?.kind === 'archive' ? confirmTarget : null;
  const archiveBatchTarget = confirmTarget?.kind === 'archiveBatch' ? confirmTarget : null;
  const restoreArchivedTarget = confirmTarget?.kind === 'restoreArchived' ? confirmTarget : null;
  const deleteTarget = confirmTarget?.kind === 'delete' ? confirmTarget : null;
  const goalClearTarget = confirmTarget?.kind === 'goalClear' ? confirmTarget : null;
  const npmPackageTarget = confirmTarget?.kind === 'npmPackage' ? confirmTarget : null;
  const npmPackageHubUpdateTarget = confirmTarget?.kind === 'npmPackageHubUpdate' ? confirmTarget : null;
  const wheelMakerUpdateTarget = confirmTarget?.kind === 'wheelMakerUpdate' ? confirmTarget : null;
  const gatewayUpdateTarget = confirmTarget?.kind === 'gatewayUpdate' ? confirmTarget : null;
  const wheelMakerUpdateAllTarget = confirmTarget?.kind === 'wheelMakerUpdateAll' ? confirmTarget : null;
  const activeSkillPreviewConfirmTarget = confirmTarget?.kind === 'skillPreview' ? confirmTarget : null;
  const skillUninstallConfirmTarget = confirmTarget?.kind === 'skillUninstall' ? confirmTarget : null;
  const skillConfirmTarget = activeSkillPreviewConfirmTarget ?? skillUninstallConfirmTarget;
  const npmPackageConfirmPendingKey = npmPackageTarget
    ? agentPackageActionKey(npmPackageTarget.hubId, npmPackageTarget.packageName)
    : '';
  const skillConfirmPendingKey = skillConfirmTarget
    ? skillActionPendingKey({
        hubId: skillConfirmTarget.hubId,
        scope: skillConfirmTarget.scope,
        projectName: skillConfirmTarget.projectName,
        skillName: skillUninstallConfirmTarget?.skillName ??
          (activeSkillPreviewConfirmTarget?.skills.length === 1 ? activeSkillPreviewConfirmTarget.skills[0] : undefined),
        action: skillConfirmTarget.kind,
      })
    : '';
  const confirmBusy = confirmTarget?.kind === 'logout'
    ? logoutPending
    : confirmTarget?.kind === 'clearDatabase'
      ? clearDatabasePending
      : archiveTarget
        ? chatArchivingSessionId === archiveTarget.sessionId
      : archiveBatchTarget
      ? !!archiveBatchProgress && archiveBatchProgress.completed < archiveBatchProgress.total
      : restoreArchivedTarget
        ? archivedRestoringSessionId === buildChatRuntimeKey(restoreArchivedTarget.projectId, restoreArchivedTarget.sessionId)
        : deleteTarget
          ? chatDeletingSessionId === deleteTarget.sessionId
          : goalClearTarget
            ? goalControlPendingKey === `${buildChatRuntimeKey(goalClearTarget.projectId, goalClearTarget.sessionId)}:clear`
            : npmPackageTarget
            ? agentPackageActionPendingKey === npmPackageConfirmPendingKey
            : npmPackageHubUpdateTarget
              ? agentPackageHubUpdatePendingId === npmPackageHubUpdateTarget.hubId
              : wheelMakerUpdateTarget
                ? wheelMakerMaintenancePending?.hubId === wheelMakerUpdateTarget.hubId
                : gatewayUpdateTarget
                  ? gatewayMaintenancePending?.hubId === gatewayUpdateTarget.hubId
                : wheelMakerUpdateAllTarget
                  ? wheelMakerUpdateAllPending
                  : skillConfirmTarget
                    ? skillsPendingKey === skillConfirmPendingKey
                    : false;
  const handleConfirmPrimary = () => {
    if (!confirmTarget) {
      return;
    }
    if (confirmTarget.kind === 'hideMonitor') {
      setShowMonitor(false);
      setConfirmTarget(null);
      setConfirmError('');
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
        if (confirmTarget.kind === 'clearDatabase') {
          void clearDatabase();
          return;
        }
        if (confirmTarget.kind === 'logout') {
          void handleRegistryLogout();
          return;
        }
    if (confirmTarget.kind === 'delete') {
      handleDeleteProjectSession(
        confirmTarget.projectId,
        confirmTarget.sessionId,
      ).catch(() => undefined);
      return;
    }
    if (confirmTarget.kind === 'goalClear') {
      clearGoal(confirmTarget).catch(() => undefined);
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
    if (confirmTarget.kind === 'gatewayUpdate') {
      handleGatewayUpdateConfirmedAction(confirmTarget).catch(() => undefined);
      return;
    }
    if (confirmTarget.kind === 'wheelMakerUpdateAll') {
      handleWheelMakerUpdateAllConfirmedAction(confirmTarget).catch(() => undefined);
      return;
    }
    if (
      confirmTarget.kind === 'skillPreview' ||
      confirmTarget.kind === 'skillUninstall'
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
      preserveChatHubMenu={chatHubMenuOpen}
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
  const appHtmlExportNameDialog = (
    <AppHtmlExportNameDialog
      open={promptMarkdownHtmlExportDraft !== null}
      nameStem={promptMarkdownHtmlExportDraft?.fileNameStem ?? ''}
      error={promptMarkdownHtmlExportNameError}
      onNameStemChange={fileNameStem => {
        setPromptMarkdownHtmlExportDraft(current => current ? {...current, fileNameStem} : current);
      }}
      onCancel={() => setPromptMarkdownHtmlExportDraft(null)}
      onSubmit={submitPromptMarkdownHtmlExport}
    />
  );
  const appGoalEditDialog = (
    <AppGoalEditDialog
      goal={goalEditTarget?.goal ?? null}
      busy={goalControlPendingKey.endsWith(':edit')}
      error={goalEditError}
      onCancel={() => {
        if (goalControlPendingKey.endsWith(':edit')) return;
        setGoalEditError('');
        setGoalEditTarget(null);
      }}
      onSubmit={patch => {
        submitGoalEdit(patch).catch(() => undefined);
      }}
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
      onCopied={() => setToastMessage('Session ID copied to clipboard.')}
      onRefresh={() => {
        if (sessionStatusDialog) {
          refreshSessionStatusDialog(sessionStatusDialog.projectId, sessionStatusDialog.sessionId)
            .catch(() => undefined);
        }
      }}
    />
  );
  const desktopWindowControlsVisible = isWide && Boolean(getDesktopWindowBridge());
  const desktopWindowControls = desktopWindowControlsVisible ? (
    <DesktopWindowControls />
  ) : null;
  const desktopTopBar = isWide ? renderChatTitleBar(false) : null;
  return (
    <>
      <ResponsiveShell
        mode={layoutMode}
        themeMode={themeMode}
        setiFontCss={setiFontCss}
        desktopTopBar={desktopTopBar}
        desktopWindowControls={desktopWindowControls}
        desktopWindowControlsVisible={desktopWindowControlsVisible}
        desktopSettingsScreen={desktopSharesScreen ?? desktopReleasePublishingScreen ?? desktopPortRelayScreen ?? desktopSettingsScreen}
        desktopPeek={chatPreviewDesktopPane}
        desktopChatFixedPreview={desktopChatFixedPreview}
        desktopChatPreviewOpen={isWide && chatPreviewOpen}
        desktopSidebarWidth={desktopLayoutSidebarWidth}
        floatingControlStack={floatingControlStack}
        floatingControlSide={floatingControlSide}
        mobileSettingsScreen={mobileSharesScreen ?? mobileReleasePublishingScreen ?? mobilePortRelayScreen ?? mobileSettingsScreen}
        mobileOverlay={(
          <>
            {mobileUsageOverlay}
            {terminalMobileOverlay}
            {chatPreviewMobileOverlay}
          </>
        )}
        sidebar={renderSidebar()}
        main={renderMain()}
        sidebarCollapsed={chatSidebarCollapsed}
        drawerOpen={mobilePortRelayFrameOpen ? false : drawerOpen}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
      {previewTabContextMenuOverlay}
      {usageHistoryOverlay}
      {deepSeekUsageOverlay}
      <LocalDevModePanel />
      {quickFileSearchOverlay}
      {previewSelectionContextMenu}
      {chatFileLinkContextMenu}
      {projectSessionActionMenuOverlay}
      {chatTitleProjectMenu}
      {renderMobileProjectActionSheet()}
      {mobileRelayTargetSheetNode}
      {chatTitlePromptMenu}
      {portRelayClearSiteDataFrame}
      {shareSource ? (
        <ShareManager
          service={service}
          initialSource={shareSource}
          captureSnapshot={captureShareSource}
          keyboardInset={chatKeyboardInset}
          onBack={() => setShareSource(null)}
        />
      ) : null}
      {markdownHtmlExportRequest ? (
        <MarkdownHtmlExportSurface
          key={markdownHtmlExportRequest.id}
          request={markdownHtmlExportRequest}
          onComplete={completeMarkdownHtmlExport}
          onError={failMarkdownHtmlExport}
        />
      ) : null}
      {markdownShareCaptureRequest ? (
        <MarkdownHtmlExportSurface
          key={markdownShareCaptureRequest.id}
          request={markdownShareCaptureRequest}
          onComplete={completeMarkdownShareCapture}
          onError={failMarkdownShareCapture}
        />
      ) : null}
      {chatShareCaptureTask ? (
        <ChatShareCaptureSurface
          key={chatShareCaptureTask.id}
          request={chatShareCaptureTask}
          onComplete={completeChatShareCapture}
          onError={failChatShareCapture}
        />
      ) : null}
      {skillRetryNotice ? (
        <RetryToast
          message={skillRetryNotice.message}
          preserveChatHubMenu={chatHubMenuOpen && skillRetryNotice.retry.target.hubId !== ''}
          onRetry={retrySkillNotice}
          onDismiss={dismissSkillRetryNotice}
        />
      ) : null}
      {toastMessage ? (
        <div className="app-toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      ) : null}
      {appHtmlExportNameDialog}
      {appRenameDialog}
      {appGoalEditDialog}
      {appConfirmDialog}
      {appSessionStatusDialog}
      {launchJustExited && !launchExitDone ? <AppLaunchScreen status="" exiting /> : null}
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
