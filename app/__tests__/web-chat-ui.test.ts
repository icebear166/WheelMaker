import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function cssRuleBlock(stylesCss: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesCss.match(new RegExp(`${escapedSelector} \\{([\\s\\S]*?)\\}`));
  return match?.[1] ?? '';
}

function cssRuleBlockContainingSelector(stylesCss: string, selector: string): string {
  for (const match of stylesCss.matchAll(/([^{}]+)\{([\s\S]*?)\}/g)) {
    const selectors = match[1].split(',').map((item) => item.trim());
    if (selectors.includes(selector)) {
      return match[2];
    }
  }
  return '';
}

function cssRuleBlocksContainingSelector(stylesCss: string, selector: string): string[] {
  const blocks: string[] = [];
  for (const match of stylesCss.matchAll(/([^{}]+)\{([\s\S]*?)\}/g)) {
    const selectors = match[1].split(',').map((item) => item.trim());
    if (selectors.includes(selector)) {
      blocks.push(match[2]);
    }
  }
  return blocks;
}

function cssNumericProperty(stylesCss: string, selector: string, property: string): number {
  const block = cssRuleBlock(stylesCss, selector);
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`${escapedProperty}:\\s*(\\d+)\\s*;`));
  return match ? Number(match[1]) : Number.NaN;
}

describe('web chat integration', () => {
  test('anchors the local chat skin to the composer bottom-right and keeps it out of share surfaces', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const persistenceTs = readSourceText(path.join(projectRoot, 'web', 'src', 'workspace', 'WorkspacePersistence.ts'));
    const settingsRootTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'));
    const settingsSkinTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'ChatSkinSettings.tsx'));
    const shareCaptureTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'share', 'ChatShareCaptureSurface.tsx'));
    const shareDocumentTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'share', 'ChatShareDocument.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("import {ChatSkinLayer} from '../chat/ChatSkinLayer';");
    expect(mainTsx).toContain('<ChatSkinLayer');
    expect(mainTsx).toContain('chatSkinObjectUrl');
    expect(mainTsx).toContain('scale={chatSkinScale}');
    expect(mainTsx).toContain('opacity={chatSkinOpacity}');
    expect(mainTsx).toContain('anchorRight={chatSkinAnchor.right}');
    expect(mainTsx).toContain('anchorBottom={chatSkinAnchor.bottom}');
    expect(mainTsx).toContain('offset={chatSkinOffset}');
    expect(mainTsx).toContain('chatComposerFrameRef');
    expect(mainTsx).toContain('resolveChatSkinAnchor');
    expect(shareCaptureTsx).not.toContain('ChatSkinLayer');
    expect(shareDocumentTsx).not.toContain('ChatSkinLayer');
    expect(shareDocumentTsx).not.toContain('chatSkinObjectUrl');
    expect(settingsRootTsx).toContain("import {ChatSkinSettings} from './ChatSkinSettings';");
    expect(settingsRootTsx).toContain('<ChatSkinSettings');
    expect(mainTsx).toContain('chatSkinPreviewUrl={chatSkinObjectUrl}');
    expect(settingsSkinTsx).toContain('type="range"');
    expect(settingsSkinTsx).toContain('settings-range-row');
    expect(settingsSkinTsx).toContain('onScaleChange');
    expect(settingsSkinTsx).toContain('onOpacityChange');
    expect(settingsSkinTsx).toContain('onOffsetChange');
    expect(settingsSkinTsx).toContain('className="chat-skin-settings-row settings-row"');
    expect(settingsSkinTsx).toContain('className="chat-skin-settings-preview"');
    expect(settingsSkinTsx).toContain('className="chat-skin-settings-remove set-btn set-btn--danger"');
    expect(settingsSkinTsx).toContain('className="chat-skin-settings-adjust"');
    expect(settingsSkinTsx).toContain('hasSkin && controlsOpen');
    expect(settingsRootTsx).toContain('chatSkinOffset');
    expect(settingsRootTsx).toContain('onChatSkinOffsetChange');
    expect(persistenceTs).toContain('chatSkinOffset');
    expect(mainTsx).toContain('wm_global_assets: dump.globalAssets');
    expect(persistenceTs).toContain('globalAssets: Array<{k: string; name: string; mimeType: string; size: number; updatedAt: number}>;');
    expect(persistenceTs).toContain('function globalAssetMetadata');
    expect(mainTsx).toContain('onChatSkinSelect={handleChatSkinSelect}');
    expect(settingsSkinTsx).toContain('accept="image/*"');
    expect(settingsSkinTsx).toContain('onRemove');
    const skinLayerBlock = cssRuleBlock(stylesCss, '.chat-skin-layer');
    expect(skinLayerBlock).toContain('position: absolute;');
    expect(skinLayerBlock).toContain('right: calc(var(--chat-skin-anchor-right, 0px) + var(--chat-skin-offset, 0px));');
    expect(skinLayerBlock).toContain('bottom: var(--chat-skin-anchor-bottom, 0px);');
    expect(skinLayerBlock).toContain('height: var(--chat-skin-scale, 100%);');
    expect(skinLayerBlock).toContain('width: auto;');
    expect(skinLayerBlock).toContain('pointer-events: none;');
    expect(skinLayerBlock).toContain('opacity: var(--chat-skin-opacity, 0.17);');
    expect(skinLayerBlock).not.toContain('transform: scale(var(--chat-skin-scale, 1));');
    expect(skinLayerBlock).not.toContain('object-fit');
    expect(skinLayerBlock).not.toContain('filter:');
    expect(stylesCss).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(stylesCss).toContain('.chat-skin-settings-row');
    expect(stylesCss).toContain('.chat-skin-settings-preview');
  });

  test('keeps the chat skin anchor synced with live chat geometry', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('const chatSkinLayoutObserver = typeof ResizeObserver === \'function\'');
    expect(mainTsx).toContain('chatSkinLayoutObserver.observe(chatMainRef.current);');
    expect(mainTsx).toContain('chatSkinLayoutObserver.observe(chatComposerRef.current);');
    expect(mainTsx).toContain('chatSkinLayoutObserver.observe(chatComposerFrameRef.current);');
    expect(mainTsx).toContain('return () => chatSkinLayoutObserver.disconnect();');
    expect(mainTsx).toContain('}, [chatMainClassName, chatMainStyle, measureChatSkinAnchor]);');
  });

  test('composer text changes do not force desktop layout measurement', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('const shouldMeasureChatComposerLayout = !isWide;');
    expect(mainTsx).toContain('if (shouldMeasureChatComposerLayout) {');
    expect(mainTsx).toContain('}, [resizeChatComposerTextarea, measureChatComposerTop, measureChatSkinAnchor, chatComposerText, selectedChatId, currentChatDraftKey, shouldMeasureChatComposerLayout]);');
  });

  test('composer text changes keep rendered chat turns memoized', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const virtuosoTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'turns', 'ChatVirtuosoTurnList.tsx'));

    expect(mainTsx).toContain('const EMPTY_CHAT_OPTION_REPLIES: ChatOptionReply[] = [];');
    expect(mainTsx).toContain('const renderChatVirtuosoItem = useCallback(');
    expect(mainTsx).toContain('optionReplies={optionReplies.length > 0 ? optionReplies : EMPTY_CHAT_OPTION_REPLIES}');
    expect(mainTsx).toContain('onSelectOptionReply={optionReplies.length > 0 ? handleSelectChatReply : undefined}');
    expect(virtuosoTsx).toContain('const ChatVirtuosoTurnListInner = React.forwardRef');
    expect(virtuosoTsx).toContain('export const ChatVirtuosoTurnList = React.memo(ChatVirtuosoTurnListInner);');
  });

  test('keeps iOS long-press session menus from selecting text or activating the row', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const sessionListTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionListView.tsx'));
    const stylesCss = readWebStyles(projectRoot);
    const nonSelectableSelectors = [
      '.desktop-window-controls',
      '.floating-control-stack',
      '.item',
      '.wide-project-toggle',
      '.wide-session-row',
      '.project-session-menu-btn',
      '.chat-thought-header',
      '.thinking-header',
      '.diff-inline .wm-shiki-diff-gutter',
    ];

    for (const selector of nonSelectableSelectors) {
      const block = cssRuleBlock(stylesCss, selector);
      expect(block).toContain('-webkit-touch-callout: none;');
      expect(block).toContain('-webkit-user-select: none;');
      expect(block).toContain('user-select: none;');
    }

    const selectableMarketplaceUrlBlock = cssRuleBlock(stylesCss, '.settings-skills-marketplace-url');
    expect(selectableMarketplaceUrlBlock).toContain('-webkit-user-select: text;');
    expect(selectableMarketplaceUrlBlock).toContain('user-select: text;');
    expect(selectableMarketplaceUrlBlock).not.toContain('-webkit-touch-callout: none;');

    const sharedTargetBlock = cssRuleBlockContainingSelector(
      stylesCss,
      "[data-context-menu-target='true']",
    );
    expect(sharedTargetBlock).toContain('-webkit-touch-callout: none;');
    expect(sharedTargetBlock).toContain('-webkit-user-select: none;');
    expect(sharedTargetBlock).toContain('user-select: none;');
    expect(sessionListTsx).toContain('bindSessionContextMenu({projectId, sessionId: session.sessionId})');

    const contextMenuStart = mainTsx.indexOf('const openProjectSessionContextMenu = useCallback((');
    const contextMenuEnd = mainTsx.indexOf('}, [closeSidebarTransientMenus, isWide, setProjectSessionActionMenu]);', contextMenuStart);
    expect(contextMenuStart).toBeGreaterThanOrEqual(0);
    expect(contextMenuEnd).toBeGreaterThan(contextMenuStart);
    const contextMenuBody = mainTsx.slice(contextMenuStart, contextMenuEnd);
    expect(contextMenuBody).toContain('position: {x: number; y: number}');
    expect(contextMenuBody).toContain('popover: isWide');
    expect(mainTsx).not.toContain('projectSessionLongPressTargetRef');
  });

  test('defaults app chrome to non-selectable while preserving content text selection', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const shikiRenderer = readSourceText(path.join(projectRoot, 'web', 'src', 'code', 'shikiRenderer.ts'));
    const appSurfaceSelectors = ['.page', '.workspace'];

    for (const selector of appSurfaceSelectors) {
      const block = cssRuleBlocksContainingSelector(stylesCss, selector).find(
        candidate =>
          candidate.includes('-webkit-touch-callout: none;') &&
          candidate.includes('-webkit-user-select: none;') &&
          candidate.includes('user-select: none;'),
      ) ?? '';
      expect(block).toContain('-webkit-touch-callout: none;');
      expect(block).toContain('-webkit-user-select: none;');
      expect(block).toContain('user-select: none;');
    }

    const selectableTextSelectors = [
      'input',
      'textarea',
      "[contenteditable='true']",
      "[contenteditable='true'] *",
      '.chat-main-message',
      '.chat-main-message *',
      '.chat-prompt-user',
      '.chat-prompt-user *',
      '.thinking-content',
      '.thinking-content *',
      '.wm-shiki-line-content',
      '.wm-shiki-line-content *',
      '.settings-skills-marketplace-url',
    ];

    for (const selector of selectableTextSelectors) {
      const block = cssRuleBlockContainingSelector(stylesCss, selector);
      expect(block).toContain('-webkit-user-select: text;');
      expect(block).toContain('user-select: text;');
    }

    const nonContentSelectors = [
      '.chat-prompt-attachment-strip',
      '.diff-inline .wm-shiki-diff-gutter',
    ];

    for (const selector of nonContentSelectors) {
      const block = cssRuleBlockContainingSelector(stylesCss, selector);
      expect(block).not.toContain('-webkit-user-select: text;');
      expect(block).not.toContain('user-select: text;');
    }

    const replyTargetBlock = cssRuleBlock(stylesCss, '.chat-reply-target');
    expect(replyTargetBlock).not.toContain('-webkit-user-select: none;');
    expect(replyTargetBlock).not.toContain('user-select: none;');

    expect(shikiRenderer).toContain("className: ['wm-shiki-line-number']");
    expect(shikiRenderer).toContain('user-select:none');
  });

  test('defines registry session protocol and uses real chat UI instead of placeholder sessions', () => {
    const projectRoot = path.join(__dirname, '..');
    const registryTypes = readSourceText(path.join(projectRoot, 'web', 'src', 'registry', 'registryTypes.ts'));
    const repositoryTs = readSourceText(path.join(projectRoot, 'web', 'src', 'registry', 'RegistryRepository.ts'));
    const workspaceServiceTs = readSourceText(path.join(projectRoot, 'web', 'src', 'registry', 'RegistryWorkspaceService.ts'));
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const chatTurnTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'ChatTurnView.tsx'));
    const markdownExportTs = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'export', 'markdownHtmlExport.ts'));
    const settingsRootTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'));
    const settingsSurfaceTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsSurface.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(registryTypes).toContain('export interface RegistrySessionSummary');
    expect(registryTypes).toContain('export interface RegistrySessionMessage');
    expect(registryTypes).not.toContain('promptIndex: number;');
    expect(registryTypes).toContain('turnIndex: number;');
    expect(registryTypes).toContain('finished: boolean;');
    expect(registryTypes).not.toContain('done?: boolean;');
    expect(registryTypes).not.toContain('export interface RegistrySessionPromptSnapshot');
    expect(registryTypes).not.toContain('updateIndex: number;');
    expect(registryTypes).not.toContain('lastIndex');
    expect(repositoryTs).toContain('RegistryMethods.SessionList');
    expect(repositoryTs).toContain('RegistryMethods.SessionRead');
    expect(repositoryTs).toContain('maxTurns: SESSION_READ_PAGE_MAX_TURNS');
    expect(repositoryTs).toContain('maxBytes: SESSION_READ_PAGE_MAX_BYTES');
    expect(repositoryTs).toContain('{throughTurnIndex: snapshotLatestTurnIndex}');
    expect(repositoryTs).toContain('const hasMore = payload.hasMore === true');
    expect(repositoryTs).toContain('turns?: unknown[];');
    expect(repositoryTs).toContain('normalizeSessionReadPayload(');
    expect(registryTypes).toContain('export interface RegistrySessionTurn');
    expect(registryTypes).toContain('turn: RegistrySessionTurn;');
    expect(repositoryTs).not.toContain('prompts: []');
    expect(registryTypes).toContain('session?: RegistrySessionSummary;');
    expect(repositoryTs).not.toContain('afterIndex');
    expect(repositoryTs).not.toContain('afterSubIndex');
    expect(repositoryTs).toContain('RegistryMethods.SessionCreate');
    expect(registryTypes).toContain('agentType?: string;');
    expect(registryTypes).toContain('createRequestId?: string;');
    expect(registryTypes).toContain('agents?: string[];');
    expect(repositoryTs).toContain('async createSession(');
    expect(repositoryTs).toContain('createRequestId?: string,');
    expect(repositoryTs).toContain('...(normalizedCreateRequestId ? {createRequestId: normalizedCreateRequestId} : {}),');
    expect(repositoryTs).toContain('RegistryMethods.SessionQueue');
    expect(repositoryTs).not.toContain('RegistryMethods.SessionSend');
    expect(repositoryTs).toContain('RegistryMethods.SessionMarkRead');
    expect(repositoryTs).toContain('RegistryMethods.SessionRename');
    expect(repositoryTs).toContain('async renameSession(projectId: string, sessionId: string, title: string)');
    expect(repositoryTs).toContain('RegistryMethods.SessionDelete');
    expect(repositoryTs).toContain('async deleteSession(projectId: string, sessionId: string)');
    expect(repositoryTs).not.toContain('turnId = typeof input.turnId');
    expect(repositoryTs).not.toContain("method: 'chat.permission.respond'");
    expect(workspaceServiceTs).toContain('async listSessions(');
    expect(workspaceServiceTs).toContain('async readSession(');
    expect(workspaceServiceTs).toContain('async createSession(');
    expect(workspaceServiceTs).toContain('async createSession(agentType: string, title?: string, createRequestId?: string)');
    expect(workspaceServiceTs).toContain('async enqueueProjectSessionItem(');
    expect(workspaceServiceTs).toContain('async cancelProjectSessionQueueItem(');
    expect(workspaceServiceTs).toContain('async markSessionRead(');
    expect(workspaceServiceTs).toContain('async markProjectSessionRead(');
    expect(workspaceServiceTs).toContain('async renameProjectSession(projectId: string, sessionId: string, title: string)');
    expect(workspaceServiceTs).toContain('async deleteProjectSession(projectId: string, sessionId: string)');
    expect(workspaceServiceTs).not.toContain('async respondToSessionPermission(');
    expect(workspaceServiceTs).toContain('private eventListeners = new Set');
    expect(workspaceServiceTs).toContain('private closeListeners = new Set');
    expect(registryTypes).not.toContain('turnId: string;');
    expect(registryTypes).not.toContain('turnId?: string;');
    expect(mainTsx).toContain('chatComposerText');
    expect(mainTsx).toContain('chatMessages');
    expect(mainTsx).toContain('session.message');
    expect(mainTsx).toContain('normalizeSessionMessagePayload(payload)');
    expect(mainTsx).toContain('decodeSessionTurnToMessage(normalizedPayload.sessionId, normalizedPayload.turn)');
    expect(mainTsx).not.toContain('updateIndex');
    expect(mainTsx).toContain('service.markProjectSessionRead(activeProjectId, sessionId, cursor)');
    expect(mainTsx).toContain('chatFinishedCursorRef');
    expect(mainTsx).not.toContain('chatSyncIndexRef');
    expect(mainTsx).not.toContain('chatPromptSnapshotVersion');
    expect(mainTsx).toContain('resolveChatListSelection({');
    expect(mainTsx).not.toContain('result.lastIndex < afterIndex');
    expect(mainTsx).toContain('preserveUserSelection');
    expect(mainTsx).toContain('const canApplyLoadedSelection = shouldApplyLoadedChatSelection(');
    expect(mainTsx).toContain('selectionSnapshot');
    expect(mainTsx).toContain('const nextSelectedKey = chatSessionKeyFromParts(activeProjectId, resultSessionId);');
    expect(mainTsx).toContain('applySelectedChatKey(nextSelectedKey);');
    expect(mainTsx).toContain('workspaceStore.rememberSelectedChatSessionKey(nextSelectedKey);');
    expect(mainTsx).toContain('sessionId');
    expect(mainTsx).not.toContain('newChatAgentPickerOpen');
    expect(mainTsx).not.toContain('resumeAgentPickerOpen');
    expect(mainTsx).not.toContain('legacy-chat-session-swipe-row');
    expect(mainTsx).not.toContain('chat-session-reload-action');
    expect(mainTsx).not.toContain('chat-session-delete-action');
    expect(mainTsx).not.toContain('chat-session-item');
    expect(mainTsx).not.toContain("const renderSidebarMain = (showSectionTitle = true) => {\n    if (tab === 'chat') {");
    expect(mainTsx).toContain('const resetChatComposer = () => {');
    expect(mainTsx).toContain("chatComposerTextRef.current = '';");
    expect(mainTsx).toContain('chatAttachmentsRef.current = [];');
    expect(mainTsx).toContain('bumpChatDraftGeneration(currentChatDraftKeyRef.current);');
    expect(mainTsx).not.toContain('const result = await service.createSession(normalizedAgentType, title);');
    expect(mainTsx).toContain("service.createProjectSession(targetProjectId, agentType, ''");
    expect(mainTsx).not.toContain('const completeNewChatFlow = async (agentType: string) => {');
    expect(mainTsx).toContain('buildProjectAgentChoices(projectItem, sessions)');
    expect(mainTsx).toContain('resetChatComposer();');
    expect(mainTsx).toContain('attachments: ChatAttachment[];');
    expect(mainTsx).toContain("const EMPTY_CHAT_COMPOSER_DRAFT: ChatComposerDraft = { text: '', tokens: [], attachments: [] };");
    expect(mainTsx).toContain('const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);');
    expect(mainTsx).toContain("status: 'queued' | 'uploading' | 'failed' | 'completed';");
    expect(mainTsx).toContain('progress: number;');
    expect(mainTsx).toContain('block?: RegistryChatContentBlock;');
    expect(mainTsx).toContain('objectUrl?: string;');
    expect(mainTsx).toContain('const chatAttachmentUploadPending = chatAttachments.some(');
    expect(mainTsx).toContain("const chatConfigOverflowOpen = chatComposerMenu.id === 'config-overflow';");
    expect(mainTsx).toContain("current.id === 'config-overflow'");
    expect(mainTsx).toContain('const chatAttachmentsRef = useRef<ChatAttachment[]>([]);');
    expect(mainTsx).toContain('const chatAutoScrollFollowRef = useRef(true);');
    expect(mainTsx).toContain('const chatPointerScrollingRef = useRef(false);');
    expect(mainTsx).toContain('const chatUserScrollLockUntilRef = useRef(0);');
    expect(mainTsx).toContain('const chatVirtuosoListRef = useRef<ChatVirtuosoTurnListHandle | null>(null);');
    expect(mainTsx).not.toContain('const chatDisplayItemCountRef = useRef(0);');
    expect(mainTsx).not.toContain('const chatProgrammaticScrollRef = useRef(false);');
    expect(mainTsx).toContain('const CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD = 80;');
    expect(mainTsx).not.toContain('function isChatScrolledNearBottom(container: HTMLElement): boolean {');
    expect(mainTsx).not.toContain('const updateChatFollowModeFromScroll = useCallback(');
    expect(mainTsx).toContain('const handleChatAtBottomChange = useCallback((atBottom: boolean) => {');
    expect(mainTsx).toContain('chatAutoScrollFollowRef.current = atBottom;');
    expect(mainTsx).toContain('setChatShowScrollToBottom(!atBottom);');
    expect(mainTsx).toContain('const handleChatScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {');
    expect(mainTsx).toContain('resolveChatScrollNavVisibility({');
    expect(mainTsx).toContain('const scrollChatToBottom = useCallback((force = false) => {');
    expect(mainTsx).toContain('shouldAutoScrollChatToBottom({');
    expect(mainTsx).toContain("chatVirtuosoListRef.current?.scrollToBottom('auto');");
    expect(mainTsx).not.toContain('const autoscrollChatToBottom = useCallback(() => {');
    expect(mainTsx).not.toContain('chatVirtuosoListRef.current?.autoscrollToBottom();');
    expect(mainTsx).not.toContain('container.scrollTop = nextScrollTop;');
    expect(mainTsx).toContain('const forceChatScrollToBottom = useCallback(() => {');
    expect(mainTsx).toContain('chatAutoScrollFollowRef.current = true;');
    expect(mainTsx).toContain('scrollChatToBottom(true);');
    expect(mainTsx).not.toContain('chatScrollBottomButton');
    expect(mainTsx).not.toContain('--chat-scroll-bottom-offset');
    expect(mainTsx).not.toContain('const [chatComposerHeight, setChatComposerHeight] = useState(0);');
    const composerContentStart = mainTsx.indexOf('className="chat-composer-content"');
    expect(composerContentStart).toBeGreaterThan(-1);
    const composerFrameStart = mainTsx.indexOf('chat-composer-frame', composerContentStart);
    expect(composerFrameStart).toBeGreaterThan(composerContentStart);
    const composerHeaderSlice = mainTsx.slice(composerContentStart, composerFrameStart);
    expect(composerHeaderSlice).toContain('className="chat-scroll-nav"');
    expect(composerHeaderSlice).toContain('className="chat-scroll-nav-button"');
    expect(mainTsx).toContain('useLayoutEffect(() => {');
    expect(mainTsx).toContain('resizeChatComposerTextarea();');
    expect(mainTsx).toContain('if (shouldMeasureChatComposerLayout) {');
    expect(mainTsx).toContain('}, [resizeChatComposerTextarea, measureChatComposerTop, measureChatSkinAnchor, chatComposerText, selectedChatId, currentChatDraftKey, shouldMeasureChatComposerLayout]);');
    expect(mainTsx).not.toContain('const chatBottomFollowAction = resolveChatBottomFollowAction({');
    expect(mainTsx).not.toContain("if (chatBottomFollowAction === 'scrollToBottom') {");
    expect(mainTsx).toContain('}, [selectedChatId, chatMessages, chatPendingPromptsByKey, chatLoading, resizeChatComposerTextarea]);');
    expect(mainTsx).not.toContain('chatLoading, chatKeyboardInset, resizeChatComposerTextarea');
    expect(mainTsx).toContain('onScroll={handleChatScroll}');
    expect(mainTsx).toContain('onWheel={event => { if (event.deltaY < 0) { markChatUserScrollIntent(); } }}');
    expect(mainTsx).toContain('<ChatVirtuosoTurnList');
    expect(mainTsx).toContain('ref={chatVirtuosoListRef}');
    expect(mainTsx).toContain('atBottomThreshold={CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD}');
    expect(mainTsx).toContain('onAtBottomChange={handleChatAtBottomChange}');
    expect(mainTsx).toContain('shouldAutoscroll={shouldAutoscrollChat}');
    expect(mainTsx).toContain('onPointerDown={() => { chatPointerScrollingRef.current = true; }}');
    expect(mainTsx).toContain('onPointerUp={() => { chatPointerScrollingRef.current = false; }}');
    expect(mainTsx).toContain('onTouchStart={() => { chatPointerScrollingRef.current = true; }}');
    expect(mainTsx).toContain('onTouchEnd={() => { chatPointerScrollingRef.current = false; }}');
    expect(mainTsx).toContain('const chatDraftGenerationRef = useRef<Record<string, number>>({});');
    expect(mainTsx).toContain('const applyChatAttachments = useCallback(');
    expect(mainTsx).toContain('const next = updater(chatAttachmentsRef.current);');
    expect(mainTsx).toContain('chatAttachmentsRef.current = next;');
    expect(mainTsx).toContain('const appendChatAttachments = useCallback(');
    expect(mainTsx).toContain('draftKey = currentChatDraftKeyRef.current');
    expect(mainTsx).toContain('expectedGeneration = getChatDraftGeneration(draftKey)');
    expect(mainTsx).toContain('if (expectedGeneration !== getChatDraftGeneration(normalizedDraftKey)) {');
    expect(mainTsx).toContain('const removeChatAttachment = useCallback(');
    expect(mainTsx).toContain('const uploadChatAttachmentFile = useCallback(');
    expect(mainTsx).toContain('const uploadChatAttachmentsForSend = useCallback(');
    expect(mainTsx).toContain('const enqueueChatAttachmentFiles = useCallback(');
    expect(mainTsx).toContain('const retryChatAttachment = useCallback(');
    expect(mainTsx).toContain('const supportsChatClipboardFiles = useMemo(');
    expect(mainTsx).toContain('const userAgent = window.navigator.userAgent || \'\';');
    expect(mainTsx).toContain('const platform = window.navigator.platform || \'\';');
    expect(mainTsx).toContain('if (/iPad|iPhone|iPod/i.test(userAgent)) {');
    expect(mainTsx).toContain('/Macintosh/i.test(userAgent) &&');
    expect(mainTsx).toContain('(window.navigator.maxTouchPoints ?? 0) > 1');
    expect(mainTsx).toContain('return true;');
    expect(mainTsx).toContain('return false;');
    expect(mainTsx).toContain('const files = chatFilesFromDataTransferItems(');
    expect(mainTsx).toContain('enqueueChatAttachmentFiles(files, attachmentDraftKey, attachmentDraftGeneration);');
    expect(mainTsx).toContain('service.startProjectSessionAttachment(selectedProjectId, {');
    expect(mainTsx).toContain('service.uploadProjectSessionAttachmentChunk(selectedProjectId, {');
    expect(mainTsx).toContain('service.finishProjectSessionAttachment(selectedProjectId, {');
    expect(mainTsx).toContain('service.cancelProjectSessionAttachment(selectedProjectId, {');
    expect(mainTsx).toContain('service.deleteProjectSessionAttachment(selectedProjectId, {');
    expect(mainTsx).toContain('const attachmentDraftKey = currentChatDraftKeyRef.current;');
    expect(mainTsx).toContain('const attachmentDraftGeneration = getChatDraftGeneration(attachmentDraftKey);');
    expect(mainTsx).toContain('appendChatAttachments(');
    expect(mainTsx).not.toContain('chatAttachmentUploadQueueRef.current = chatAttachmentUploadQueueRef.current');
    expect(mainTsx).toMatch(
      /function isChatAttachmentUploadPending\(attachment: ChatAttachment\): boolean \{\r?\n  return attachment\.status === 'uploading';\r?\n\}/,
    );
    expect(mainTsx).toContain('const sourceAttachments = options.attachmentsOverride ?? chatAttachments;');
    expect(mainTsx).toContain('blocksOverride?: RegistryChatContentBlock[];');
    expect(mainTsx).toContain('const blocks: RegistryChatContentBlock[] = [];');
    expect(mainTsx).toContain('const uploadedAttachments = options.blocksOverride ? sourceAttachments : await uploadChatAttachmentsForSend(');
    expect(mainTsx).toContain('blocks.push(...uploadedAttachments.map(attachment => attachment.block).filter(');
    expect(mainTsx).not.toContain('data: attachment.data');
    expect(mainTsx).not.toContain("setError('Wait for attachments to finish uploading.');");
    expect(mainTsx).toContain('type="file"');
    expect(mainTsx).toContain('multiple');
    expect(mainTsx).toContain('onPaste={event => {');
    expect(mainTsx).toContain('readOnly={selectedChatSubmitPending}');
    expect(mainTsx).toContain('if (selectedChatSubmitPending) {\n      event.target.value = \'\';\n      return;\n    }');
    expect(mainTsx).toContain('if (!supportsChatClipboardFiles) {');
    expect(mainTsx).toContain('onDragOver={event => {');
    expect(mainTsx).toContain('onDrop={event => {');
    expect(mainTsx).toContain('enqueueChatAttachmentFiles(');
    expect(mainTsx).toContain('attachmentDraftKey,');
    expect(mainTsx).toContain('attachmentDraftGeneration);');
    expect(mainTsx).toContain('if (chatSendDisabled) {');
    expect(mainTsx).toContain('disabled={selectedChatSubmitPending}');
    expect(mainTsx).toContain('aria-label="Attach file"');
    expect(mainTsx).not.toContain('respondToChatPermission');
    expect(mainTsx).not.toContain("const [chatSessions] = useState(['General', 'WheelMaker App', 'Go Service']);");
    expect(stylesCss).toContain('.chat-composer');
    expect(stylesCss).not.toContain('.chat-composer::before {');
    expect(stylesCss).not.toContain('--chat-history-bottom-buffer');
    expect(stylesCss).toMatch(
      /\.chat-main \{[\s\S]*display: flex;[\s\S]*flex-direction: column;[\s\S]*gap: 0;[\s\S]*\}/,
    );
    expect(stylesCss).toContain('.chat-virtuoso-footer {');
    expect(stylesCss).toMatch(
      /\.chat-composer \{[\s\S]*position: relative;[\s\S]*z-index: 1;[\s\S]*padding: 0 14px 4px;[\s\S]*background: transparent;/,
    );
    expect(stylesCss).toMatch(
      /@media \(min-width: 901px\) \{[\s\S]*\.chat-composer \{[\s\S]*padding-bottom: 8px;[\s\S]*\}[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /@media \(max-width: 900px\) \{[\s\S]*\.chat-composer \{[\s\S]*background: color-mix\(in srgb, var\(--surface-panel\) 88%, var\(--surface-raised\)\);[\s\S]*\}[\s\S]*\}/,
    );
    expect(stylesCss).not.toContain('--chat-composer-frame-top');
    expect(stylesCss).not.toContain('--chat-composer-fade-distance');
    expect(stylesCss).not.toContain('margin-top: calc(-1 * var(--chat-composer-frame-top));');
    expect(stylesCss).not.toContain('transform: translateY(calc(-100% + 4px));');
    expect(stylesCss).not.toContain('.chat-session-item');
    expect(stylesCss).not.toContain('.chat-session-swipe-row');
    expect(stylesCss).not.toContain('.chat-session-reload-action');
    expect(stylesCss).not.toContain('.chat-session-delete-action');
    expect(stylesCss).not.toContain('.chat-sessions-header');
    expect(stylesCss).toContain('.chat-attachment-preview-list {');
    expect(stylesCss).toContain('.chat-config-overflow-anchor {');
    expect(stylesCss).toContain('.chat-config-overflow-button {');
    expect(stylesCss).toContain('.chat-config-overflow-menu {');
    expect(mainTsx).not.toContain('className="status-bar"');
    expect(mainTsx).not.toContain('gitStatusSummary');
    expect(mainTsx).not.toContain('chat-thought-label');
    expect(mainTsx).toContain("import { buildPromptDoneCopyRange } from '../chat/chatCopyRange';");
    expect(mainTsx).toContain('buildResponseChatShareSnapshot,');
    expect(mainTsx).toContain('buildSessionChatShareSnapshot,');
    expect(mainTsx).toContain('ChatShareCaptureSurface,');
    expect(mainTsx).toContain('outputResponseImage,');
    expect(mainTsx).toContain('reserveResponseImageShare,');
    expect(mainTsx).toContain("} from '../chat/export/responseImageOutput';");
    expect(mainTsx).toContain('const buildFrozenChatShareSnapshot = useCallback');
    expect(mainTsx).toContain('const selectedChatMessageLifecycleSupported = archivedMode');
    expect(mainTsx).toContain('hasMessageLifecycleFeature(archivedPreview?.session, true)');
    expect(mainTsx).toContain('hasMessageLifecycleFeature(selectedChatSession)');
    expect(mainTsx).toContain('includeWorkDetails: action.includeWorkDetails');
    expect(mainTsx).toContain('buildResponseChatShareSnapshot(selectedFullChatMessages, doneTurnIndex, context, contentOptions)');
    expect(mainTsx).toContain('buildSessionChatShareSnapshot(selectedFullChatMessages, context, contentOptions)');
    expect(mainTsx).toContain('shareWorkDetailsAvailable={selectedChatMessageLifecycleSupported}');
    expect(mainTsx).toContain('const [toastMessage, setToastMessage] = useState(\'\');');
    expect(mainTsx).toContain("if (output.status === 'copied') {");
    expect(mainTsx).toContain("setToastMessage('Image copied to clipboard.');");
    expect(mainTsx).toContain('className="app-toast"');
    expect(mainTsx).toContain('const copyRange = message.method === \'prompt_done\'');
    expect(chatTurnTsx).toContain('className="chat-prompt-actions"');
    expect(chatTurnTsx).toContain('className="chat-prompt-action-button"');
    expect(chatTurnTsx).toContain('aria-label="Copy response markdown"');
    expect(chatTurnTsx).toContain('<ChatIcon name="copy" size={13} />');
    expect(chatTurnTsx).toContain('<ChatShareMenu');
    expect(chatTurnTsx).toContain('onSelect={action => onSharePromptDone(message.turnIndex, action)}');
    expect(mainTsx).toContain('handleChatShareActionEvent(doneTurnIndex, action)');
    expect(mainTsx).toContain("sourceType: action.scope === 'response' ? 'chat_response' : 'chat_session'");
    expect(mainTsx).toContain('await reserveResponseImageShare();');
    expect(mainTsx).toContain('await reserveMarkdownHtmlShare();');
    expect(mainTsx).toContain('<ChatShareCaptureSurface');
    expect(mainTsx).not.toContain('<MarkdownImageExportSurface');
    expect(mainTsx).toContain('outputResponseImage({');
    expect(mainTsx).toContain('outputMarkdownHtml({');
    expect(mainTsx).toContain('createChatShareSnapshot({');
    expect(mainTsx).toContain('img: ({ src, alt, ...rest }) => (');
    expect(mainTsx).toContain('crossOrigin="anonymous"');
    expect(stylesCss).toContain('.chat-prompt-actions {');
    expect(stylesCss).toContain('.chat-prompt-action-button {');
    expect(stylesCss).toContain('.chat-share-capture-host {');
    const exportTableBlock = cssRuleBlocksContainingSelector(
      markdownExportTs,
      '.wheelmaker-markdown-export table',
    ).find(block => block.includes('table-layout: fixed;')) ?? '';
    expect(exportTableBlock).toContain('table-layout: fixed;');
    expect(exportTableBlock).toContain('max-width: 100%;');
    const exportTableCellBlock = cssRuleBlockContainingSelector(markdownExportTs, '.wheelmaker-markdown-export th');
    expect(exportTableCellBlock).toContain('overflow-wrap: anywhere;');
    expect(exportTableCellBlock).toContain('word-break: break-word;');
    expect(exportTableCellBlock).toBe(cssRuleBlockContainingSelector(markdownExportTs, '.wheelmaker-markdown-export td'));
    const exportLinkBlock = cssRuleBlockContainingSelector(markdownExportTs, '.wheelmaker-markdown-export a');
    expect(exportLinkBlock).toContain('color: color-mix(in srgb, var(--accent-primary) 82%, var(--text-primary));');
    expect(exportLinkBlock).toBe(cssRuleBlockContainingSelector(markdownExportTs, '.wheelmaker-markdown-export a:visited'));
    expect(stylesCss).toContain('.app-toast {');
    const sendExistingStart = mainTsx.indexOf('const sendChatMessage = async');
    const sendEnd = mainTsx.indexOf('const sendChatMessageEvent = useStableEvent(sendChatMessage);', sendExistingStart);
    const sendBlock = mainTsx.slice(sendExistingStart, sendEnd);
    const sendAwait = mainTsx.indexOf('const result = await service.enqueueProjectSessionItem(selectedProjectId, sessionId, {', sendExistingStart);
    expect(sendExistingStart).toBeGreaterThanOrEqual(0);
    expect(sendEnd).toBeGreaterThan(sendExistingStart);
    expect(sendBlock).toContain("if (trimmedText === '/cancel' && sourceAttachments.length === 0 && !options.blocksOverride) {");
    expect(sendBlock).toContain("setError('Use the stop button to cancel in app.');");
    expect(sendBlock).toContain('rememberPendingChatPrompt(runtimeKey, {');
    expect(sendBlock).toContain("status: 'confirming',");
    expect(sendBlock).toContain('const result = await service.enqueueProjectSessionItem(selectedProjectId, sessionId, {');
    expect(sendBlock).toContain('itemId,');
    expect(mainTsx).toContain('service.steerProjectSessionQueueItem(projectId, key.sessionId, itemId)');
    expect(mainTsx).toContain('queueActions={queuedItemActions}');
    expect(mainTsx).not.toContain('chatQueuedPromptsByKey');
    expect(chatTurnTsx).toContain('aria-label="Steer"');
    expect(chatTurnTsx).toContain('aria-label="Prioritize"');
    expect(chatTurnTsx).toContain('aria-label="Cancel"');
    expect(chatTurnTsx).toContain('chat-prompt-steered-label');
    expect(chatTurnTsx).not.toContain('Send next');
    expect(sendBlock).toContain('if (!result.ok) {');
    expect(sendBlock).toContain('markPendingChatPromptUndelivered(runtimeKey');
    expect(sendBlock).toContain('if (shouldApplySentChatSelection(selectedChatKeyRef.current, sentFromKey)) {');
    const sendSelectionGuard = sendBlock.indexOf('if (shouldApplySentChatSelection(selectedChatKeyRef.current, sentFromKey)) {');
    const sendSelectionApply = sendBlock.indexOf('applySelectedChatKey(nextSelectedKey);', sendSelectionGuard);
    expect(sendSelectionGuard).toBeGreaterThan(sendBlock.indexOf('const nextSelectedKey = chatSessionKeyFromParts(selectedProjectId, sessionId);'));
    expect(sendSelectionApply).toBeGreaterThan(sendSelectionGuard);
    expect(sendBlock).not.toContain('markChatSessionRunning(');
    expect(sendAwait).toBeGreaterThan(sendExistingStart);
    expect(mainTsx).toContain('const [hasPendingProjectUpdates, setHasPendingProjectUpdates] = useState(false);');
    expect(mainTsx).toContain('if (!eventProjectId || reportedProjectId === projectIdRef.current) {');
    expect(mainTsx).toContain('setHasPendingProjectUpdates(true);');
    expect(mainTsx).toContain('if (!silent) {');
    expect(mainTsx).toContain('setHasPendingProjectUpdates(false);');
    expect(mainTsx).not.toContain('setChatPromptSnapshotVersion(version => version + 1);');
    expect(mainTsx).toContain('const nextSessions = mergeChatSessionList(knownSessions, listedSessions);');
    expect(mainTsx).toContain('setChatSessions(prev => mergeChatSessionList(prev, listedSessions));');
    expect(mainTsx).toContain('return mergeChatSession([projectSession], currentProjectSession)[0];');
    expect(mainTsx).toContain("import { chatConfigValueLabel, formatChatContextUsage, splitChatComposerStatusOptions } from '../chat/session/chatComposerStatus';");
    expect(mainTsx).toContain('const chatComposerStatusCompact = !isWide || windowWidth < 980 || (chatPreviewOpen && windowWidth < 1280);');
    expect(mainTsx).toContain('const status = splitChatComposerStatusOptions(selectedChatConfigOptions, chatComposerStatusCompact);');
    expect(mainTsx).not.toContain('FLOATING_CONTROL_SLOT_ORDER');
    expect(mainTsx).not.toContain('nearestFloatingSlot');
    expect(mainTsx).toContain('floatingControlYRatio: globalState.floatingControlYRatio ?? readPortRelayFloatingYRatio() ?? FLOATING_CONTROL_DEFAULT_Y_RATIO');
    expect(mainTsx).toContain('const floatingControlYRatio = workspaceUiState.mobile.floatingControlYRatio;');
    expect(mainTsx).toContain('floatingControlTopFromYRatio(');
    expect(mainTsx).toContain('floatingControlYRatioFromTop(');
    expect(mainTsx).toContain("import { triggerMobileHaptic } from '../shell/layouts/mobile/mobileHaptics';");
    expect(mainTsx).toContain("} from '../shell/layouts/mobile/floatingControls';");
    expect(mainTsx).not.toContain('navigator.vibrate?.(12)');
    expect(mainTsx).not.toContain('className="header-bubble"');
    expect(mainTsx).toContain('setSidebarSettingsOpen(true);');
    expect(mainTsx).toContain('const mobileSidebarMain = !isWide ? renderMobileChatSessionSheet() : null;');
    expect(mainTsx).toContain('const wideSidebarMain = renderWideProjectSessionNav();');
    expect(mainTsx).toContain('renderChatSessionHeader(false)');
    expect(mainTsx).not.toContain('chatSidebarTitleSearchOpen');
    expect(mainTsx).not.toContain('className="desktop-activity-bar"');
    expect(mainTsx).toContain('const desktopSettingsScreen = isWide && settingsScreenVisible ? (');
    expect(mainTsx).toContain('const mobileSettingsScreen = !isWide && settingsScreenVisible ? (');
    expect(mainTsx).toContain('<SettingsScreen');
    expect(mainTsx).toContain('<MobileSettingsScreen');
    expect(mainTsx).toContain('className={`desktop-settings-screen');
    expect(mainTsx).not.toContain('settingsShortcutBar');
    expect(mainTsx).not.toContain('shortcutBar=');
    expect(mainTsx).toContain('onBackdropClick={handleMobileSettingsBackButton}');
    expect(settingsSurfaceTsx).toContain('export function SettingsScreen');
    expect(settingsSurfaceTsx).toContain('onBackdropClick?: () => void;');
    expect(settingsSurfaceTsx).toContain('const handleBackdropClick = React.useCallback');
    expect(settingsSurfaceTsx).toContain('if (event.target !== event.currentTarget || !onBackdropClick) {');
    expect(settingsSurfaceTsx).toContain('onBackdropClick();');
    expect(settingsSurfaceTsx).toContain('className={screenClassName}');
    expect(settingsSurfaceTsx).toContain('onClick={handleBackdropClick}');
    expect(settingsSurfaceTsx).toContain('className="mobile-settings-panel settings-workbench-panel"');
    expect(settingsSurfaceTsx).toContain('aria-modal="true"');
    expect(settingsSurfaceTsx).toContain('className="mobile-settings-nav settings-workbench-nav"');
    expect(settingsSurfaceTsx).toContain('className="mobile-settings-back"');
    expect(settingsSurfaceTsx).toContain('<div className="mobile-settings-title">{title}</div>');
    expect(settingsSurfaceTsx).toContain('className="mobile-settings-group"');
    const chatSettingsStart = settingsRootTsx.indexOf('<SettingsSection id="chat"');
    expect(chatSettingsStart).toBeGreaterThanOrEqual(0);
    expect(settingsRootTsx).not.toContain('Use Latest Prompt Title');
    expect(settingsRootTsx).not.toContain('Hide Tool Calls');
    expect(mainTsx).not.toContain('className="sidebar-footer"');
    expect(mainTsx).toContain('className="floating-control-stack"');
    expect(mainTsx).toContain('<MobileFloatingNav');
    expect(mainTsx).not.toContain('className="gesture-nav-control"');
    expect(mainTsx).not.toContain('className="gesture-nav-pill"');
    expect(mainTsx).not.toContain('className="floating-nav-group"');
    expect(mainTsx).not.toContain('className="drawer-toggle-bubble"');
    expect(mainTsx).toContain('const floatingControlSideRef = useRef(floatingControlSide);');
    expect(mainTsx).toContain('floatingControlSideRef.current = floatingControlSide;');
    expect(mainTsx).toContain("const [floatingSidePulse, setFloatingSidePulse] = useState<PersistedFloatingControlSide | ''>('');");
    expect(mainTsx).toContain('const floatingSidePulseTimerRef = useRef<number | null>(null);');
    expect(mainTsx).toContain('const pulseFloatingControlSide = useCallback(');
    expect(mainTsx).toContain('const closeMobileDrawerCompanionOverlays = useCallback(() => {');
    expect(mainTsx).toContain('closeMobileDrawerCompanionOverlays();');
    expect(mainTsx).toContain('className={`chat-title-project-button${chatTitleProjectMenuOpen ? \' open\' : \'\'}`}');
    expect(mainTsx).not.toContain('const handleFloatingControlButtonPointerDown = useCallback(');
    expect(mainTsx).not.toContain('const beginFloatingPress = useCallback(');
    expect(mainTsx).toContain('event.stopPropagation();');
    expect(mainTsx).toContain('handleFloatingNavSelect');
    expect(mainTsx).not.toContain('handleFloatingChatSelect');
    expect(mainTsx).not.toContain('handleFloatingDrawerToggle');
    expect(mainTsx).toContain('onButtonPointerDown={handleGestureNavigationPillPointerDown}');
    expect(mainTsx).toContain('onCurrentSelect={handleGestureNavigationCurrentSelect}');
    expect(mainTsx).toContain('const floatingControlYRatio = workspaceUiState.mobile.floatingControlYRatio;');
    expect(mainTsx).toContain('const [floatingDragState, setFloatingDragState] = useState<FloatingDragState | null>(null);');
    expect(mainTsx).not.toContain('transient.floatingDragState');
    expect(mainTsx).toContain('const floatingKeyboardOffset = workspaceUiState.transient.floatingKeyboardOffset;');
    const gestureMoveLongPressStart = mainTsx.indexOf('gestureMoveLongPressTimerRef.current = window.setTimeout(() => {');
    const gestureMoveLongPressEnd = mainTsx.indexOf('}, GESTURE_MOVE_LONG_PRESS_MS);', gestureMoveLongPressStart);
    expect(gestureMoveLongPressStart).toBeGreaterThanOrEqual(0);
    expect(gestureMoveLongPressEnd).toBeGreaterThan(gestureMoveLongPressStart);
    const gestureMoveLongPressBlock = mainTsx.slice(gestureMoveLongPressStart, gestureMoveLongPressEnd);
    expect(gestureMoveLongPressBlock).toContain('closeMobileDrawerCompanionOverlays();');
    expect(gestureMoveLongPressBlock).toContain('triggerMobileHaptic();');
    const floatingMoveStart = mainTsx.indexOf('const handleFloatingPointerMove = useCallback(');
    const floatingMoveEnd = mainTsx.indexOf('const finishFloatingDrag = useCallback(', floatingMoveStart);
    expect(floatingMoveStart).toBeGreaterThanOrEqual(0);
    expect(floatingMoveEnd).toBeGreaterThan(floatingMoveStart);
    const floatingMoveBlock = mainTsx.slice(floatingMoveStart, floatingMoveEnd);
    expect(floatingMoveBlock).toContain('resolveFloatingControlDragSide(');
    expect(floatingMoveBlock).toContain('floatingControlSideRef.current');
    expect(floatingMoveBlock).toContain('setFloatingControlSide(nextSide);');
    expect(floatingMoveBlock).not.toContain('window.localStorage.setItem(');
    expect(floatingMoveBlock).toContain('triggerMobileHaptic();');
    expect(floatingMoveBlock).toContain('pulseFloatingControlSide(nextSide);');
    expect(floatingMoveBlock).toContain('closeMobileDrawerCompanionOverlays();');
    const floatingFinishStart = mainTsx.indexOf('const finishFloatingDrag = useCallback(', floatingMoveStart);
    const floatingFinishEnd = mainTsx.indexOf('const cancelFloatingDrag = useCallback(', floatingFinishStart);
    const floatingFinishBlock = mainTsx.slice(floatingFinishStart, floatingFinishEnd);
    expect(floatingFinishBlock).toContain('window.localStorage.setItem(PORT_RELAY_FLOATING_SIDE_STORAGE_KEY, nextSide);');
    expect(floatingFinishBlock).toContain('window.localStorage.setItem(PORT_RELAY_FLOATING_Y_RATIO_STORAGE_KEY, String(nextYRatio));');
    expect(mainTsx).not.toContain('style={narrowContentInsetStyle}');
    expect(mainTsx).toContain('className="breadcrumb-title chat-breadcrumb-title"');
    expect(mainTsx).toContain('className={`chat-title-project-button${chatTitleProjectMenuOpen ? \' open\' : \'\'}`}');
    expect(mainTsx).toContain('No Selected Session');
    expect(mainTsx).toContain('data-side-pulse={floatingSidePulse}');
    expect(mainTsx).toContain('className="floating-control-drag-backdrop"');
    expect(mainTsx).toContain('className="floating-control-dock-rail left"');
    expect(mainTsx).toContain('className="floating-control-dock-rail right"');
    expect(mainTsx).toContain('className="block-title chat-title-bar"');
    expect(mainTsx).toContain('const chatConfigDisplay = useMemo(() => {');
    expect(mainTsx).toContain("className={`chat-config-options-shell${chatComposerStatusCompact ? ' compact' : ''}`}");
    expect(mainTsx).toContain('className="chat-config-options-wrap"');
    expect(mainTsx).toContain('ref={chatConfigOptionsRef}');
    expect(mainTsx).toContain('className="chat-config-options"');
    expect(mainTsx).toContain('chatComposerStatusCompact && chatConfigOverflowOptions.length > 0');
    expect(mainTsx).toContain('className="chat-core-config-footer"');
    expect(mainTsx).toContain('className="chat-core-config-more-button"');
    expect(mainTsx).toContain('className="chat-core-config-more"');
    expect(mainTsx).not.toContain('className="chat-config-overflow-anchor"');
    expect(mainTsx).not.toContain('className="codicon codicon-settings-gear"');
    expect(mainTsx).not.toContain("className={`codicon ${chatConfigOverflowOpen ? 'codicon-chevron-up' : 'codicon-chevron-down'}`}");
    expect(mainTsx).not.toContain('project-menu-state');
    expect(mainTsx).not.toContain("projectItem.online ? 'online' : 'offline'");
    expect(mainTsx).not.toContain('+{chatConfigOverflowOptions.length}');
    expect(mainTsx).not.toContain("data-tooltip={chatConfigOverflowOpen ? 'Hide config options' : 'Show config options'}");
    expect(mainTsx).not.toContain('function chooseChatEntryText(previousText: string, nextText: string): string {');
    expect(mainTsx).not.toContain('text: chooseChatEntryText(previous.text, text),');
    expect(mainTsx).not.toContain('function groupChatMessagesByPrompt(');
    expect(mainTsx).not.toContain("const shouldRefreshCompletedPrompt = message.method === 'prompt_done';");
    expect(mainTsx).not.toContain('const shouldMarkSessionRunning = isChatSessionRunningMessage(message);');
    expect(mainTsx).toContain('const normalizedPayload = normalizeSessionMessagePayload(payload);');
    expect(mainTsx).toContain('const gapReadCursor = shouldReadRepairForIncomingTurn(turnState, incomingTurn);');
    expect(mainTsx).toContain('mergeRealtimeTurn(turnState, incomingTurn);');
    expect(mainTsx).toContain('let merged: RegistryChatMessage[] | null = null;');
    expect(mainTsx).toContain('if (shouldMaterializeRealtimeSessionMessages(isSelectedSession)) {');
    expect(mainTsx).toContain('merged = upsertDecodedSessionTurn(');
    expect(mainTsx).toContain('chatMessageStoreRef.current[runtimeKey] ?? [],');
    expect(mainTsx).toContain('chatReadRepairQueueRef.current.request(runtimeKey, gapReadCursor.turnIndex');
    const normalizedPayload = mainTsx.indexOf('const normalizedPayload = normalizeSessionMessagePayload(payload);');
    const gapReadCursor = mainTsx.indexOf('const gapReadCursor = shouldReadRepairForIncomingTurn(turnState, incomingTurn);', normalizedPayload);
    const realtimeMerge = mainTsx.indexOf('mergeRealtimeTurn(turnState, incomingTurn);', gapReadCursor);
    const materializeGate = mainTsx.indexOf('if (shouldMaterializeRealtimeSessionMessages(isSelectedSession)) {', realtimeMerge);
    const materializeMessages = mainTsx.indexOf('merged = upsertDecodedSessionTurn(', materializeGate);
    const incomingStoreApply = mainTsx.indexOf('chatMessageStoreRef.current[runtimeKey] = merged;', materializeMessages);
    const incomingVisibleApply = mainTsx.indexOf('scheduleVisibleChatMessagesForRuntimeKey(runtimeKey);', incomingStoreApply);
    const promptGapRead = mainTsx.indexOf('chatReadRepairQueueRef.current.request(runtimeKey, gapReadCursor.turnIndex', incomingVisibleApply);
    expect(normalizedPayload).toBeGreaterThanOrEqual(0);
    expect(gapReadCursor).toBeGreaterThan(normalizedPayload);
    expect(realtimeMerge).toBeGreaterThan(gapReadCursor);
    expect(materializeGate).toBeGreaterThan(realtimeMerge);
    expect(materializeMessages).toBeGreaterThan(materializeGate);
    expect(incomingStoreApply).toBeGreaterThan(materializeMessages);
    expect(incomingVisibleApply).toBeGreaterThan(incomingStoreApply);
    expect(promptGapRead).toBeGreaterThan(incomingVisibleApply);
    expect(mainTsx).not.toContain('lastReadTurnIndex: isSelectedSession && completedTurnIndex > 0');
    expect(mainTsx).toContain('workspaceStore.rememberChatSessionTurns(activeProjectId, sessionId, turnState.finished);');
    expect(mainTsx).toContain('needsPromptTurnRefresh(');
    expect(mainTsx).toContain('refreshSessionTurns(');
    expect(mainTsx).not.toContain('if (shouldRefreshCompletedPrompt && isSelectedSession) {\n          loadChatSession(sessionId, projectIdRef.current, {\n            forceFull: true,');
    const eventTurnState = mainTsx.indexOf('const turnState = ensureChatTurnStore(runtimeKey);');
    const eventGapRead = mainTsx.indexOf('const gapReadCursor = shouldReadRepairForIncomingTurn(turnState, incomingTurn);', eventTurnState);
    const eventMerge = mainTsx.indexOf('mergeRealtimeTurn(turnState, incomingTurn);', eventGapRead);
    const eventRepair = mainTsx.indexOf('chatReadRepairQueueRef.current.request(runtimeKey, gapReadCursor.turnIndex', eventMerge);
    expect(eventTurnState).toBeGreaterThanOrEqual(0);
    expect(eventGapRead).toBeGreaterThan(eventTurnState);
    expect(eventMerge).toBeGreaterThan(eventGapRead);
    expect(eventRepair).toBeGreaterThan(eventMerge);
    expect(mainTsx).toContain('const runtimeKey = buildChatRuntimeKey(eventProjectId, payload.session.sessionId);');
    const sessionUpdatedBlockStart = mainTsx.indexOf("if (event.method === 'session.updated') {");
    const sessionMessageBlockStart = mainTsx.indexOf("if (event.method === 'session.message') {");
    const projectReportBlockStart = mainTsx.indexOf('if (event.method === RegistryMethods.RegistryProjectReport) {');
    expect(projectReportBlockStart).toBeGreaterThanOrEqual(0);
    expect(mainTsx).toContain("import {RegistryMethods} from '../registry/registryMethods';");
    expect(mainTsx).not.toContain("event.method === 'project.online'");
    expect(mainTsx).not.toContain("event.method === 'project.offline'");
    const sessionUpdatedBlock = mainTsx.slice(sessionUpdatedBlockStart, sessionMessageBlockStart);
    expect(sessionUpdatedBlock).not.toContain('loadChatSession(');
    expect(sessionUpdatedBlock).toContain('if (payload.session.running === false) {');
    expect(sessionUpdatedBlock).toContain('const mergedSession = mergeKnownChatSessionForProject(eventProjectId, payload.session);');
    expect(sessionUpdatedBlock).toContain('rememberChatSessionSummary(eventProjectId, mergedSession);');
    const sessionMessageBlockEnd = mainTsx.indexOf('const unsubscribeClose = service.onClose', sessionMessageBlockStart);
    const sessionMessageBlock = mainTsx.slice(sessionMessageBlockStart, sessionMessageBlockEnd);
    expect(sessionMessageBlock).not.toContain('applySelectedChatKey(');
    expect(sessionMessageBlock).not.toContain('workspaceStore.rememberSelectedChatSessionKey(');
    expect(sessionMessageBlock).toContain("if (message.method === 'prompt_done' && isSelectedSession) {");
    expect(mainTsx).not.toContain("className={`desktop-activity-button refresh-btn${hasPendingProjectUpdates && !refreshingProject && !reconnecting ? ' has-update-badge' : ''}`}");
    expect(mainTsx).not.toContain('project-presence');
    expect(mainTsx).not.toContain('project-dirty');
    expect(stylesCss).not.toContain('.status-bar {');
    expect(stylesCss).not.toContain('.chat-thought-label {');
    expect(stylesCss).toContain('.refresh-btn.has-update-badge::after {');
    expect(stylesCss).not.toContain('.header-bubble {');
    expect(stylesCss).not.toContain('.drawer-project-header {');
    expect(stylesCss).not.toContain('.drawer-project-pill {');
    expect(stylesCss).toContain('.mobile-settings-screen {');
    expect(stylesCss).toContain('.mobile-settings-nav {');
    expect(stylesCss).toContain('.mobile-settings-back {');
    expect(stylesCss).toContain('.mobile-settings-group {');
    expect(stylesCss).toContain('.mobile-settings-screen .settings-row {');
    expect(stylesCss).toContain('.mobile-settings-screen .settings-danger-row {');
    expect(stylesCss).not.toContain('.mobile-settings-shortcut-label');
    expect(stylesCss).not.toContain('.project-menu-state');
    expect(stylesCss).toMatch(
      /\.project-menu-hub \{[\s\S]*background: color-mix\(in srgb, var\(--accent-primary\) 18%, var\(--surface-raised\)\);/,
    );
    expect(stylesCss).toMatch(
      /\.project-menu-hub \{[\s\S]*border: 1px solid color-mix\(in srgb, var\(--accent-primary\) 42%, transparent\);/,
    );
    expect(stylesCss).toMatch(
      /\.header \.project-btn \{[\s\S]*max-width: none;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.header \.project-name \{[\s\S]*overflow: visible;[\s\S]*text-overflow: clip;[\s\S]*\}/,
    );
    expect(stylesCss).not.toContain('padding: calc(var(--wm-safe-area-top) + 8px) 8px 10px;');
    expect(stylesCss).toContain('.floating-control-stack {');
    expect(stylesCss).toContain('.floating-control-drag-backdrop {');
    expect(stylesCss).toContain('.floating-control-dock-rail {');
    expect(stylesCss).toMatch(
      /\.floating-control-drag-backdrop \{[\s\S]*background: rgba\(0, 0, 0, 0\.13\);[\s\S]*backdrop-filter: blur\(2px\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.floating-control-dock-rail\.left \{[^}]*left: 0;[^}]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.floating-control-dock-rail\.right \{[^}]*right: 0;[^}]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.floating-control-stack-layer\[data-drag-state='dragging'\] \.floating-control-drag-backdrop \{[\s\S]*opacity: 1;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.floating-control-stack\[data-drag-state='dragging'\] \{[\s\S]*transform: scale\(1\.06\);[\s\S]*filter: drop-shadow\(0 14px 30px rgba\(0, 0, 0, 0\.28\)\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.floating-control-stack-layer\[data-side-pulse='left'\] \.floating-control-dock-rail\.left,[\s\S]*\.floating-control-stack-layer\[data-side-pulse='right'\] \.floating-control-dock-rail\.right \{[\s\S]*animation: floatingDockRailPulse var\(--motion-fast\) var\(--ease-out\);[\s\S]*\}/,
    );
    expect(stylesCss).toContain('@keyframes floatingDockRailPulse');
    expect(stylesCss).not.toContain('.floating-nav-group {');
    expect(stylesCss).not.toContain('.floating-nav-indicator {');
    expect(stylesCss).toContain('.floating-nav-button {');
    expect(stylesCss).toContain('.floating-nav-card {');
    expect(stylesCss).toContain('.floating-nav-card-item {');
    expect(stylesCss).not.toContain('.gesture-nav-pill {');
    expect(stylesCss).not.toContain('.gesture-nav-button {');
    expect(stylesCss).not.toContain('.drawer-toggle-bubble {');
    expect(stylesCss).toMatch(
      /\.floating-nav-card-item\[data-active='true'\] \{[\s\S]*background: var\(--accent-soft-bg\);[\s\S]*color: color-mix\(in srgb, var\(--accent-primary\) 88%, var\(--text-primary\)\);/,
    );
    expect(stylesCss).toContain('-webkit-tap-highlight-color: transparent;');
    expect(stylesCss).toContain('.breadcrumb-title {');
    expect(stylesCss).toContain('.breadcrumb-project-name {');
    expect(stylesCss).toContain('.breadcrumb-project-button {');
    expect(stylesCss).toContain('.breadcrumb-project-button:hover {');
    expect(stylesCss).not.toContain('max-width: min(42%, 160px);');
    expect(stylesCss).toMatch(
      /\.breadcrumb-project-name \{[\s\S]*flex: 0 0 auto;[\s\S]*max-width: none;[\s\S]*border: 1px solid color-mix\(in srgb, var\(--accent-primary\) 54%, transparent\);[\s\S]*border-radius: 8px;[\s\S]*background: color-mix\(in srgb, var\(--accent-primary\) 13%, var\(--surface-panel\)\);[\s\S]*color: color-mix\(in srgb, var\(--accent-primary\) 78%, var\(--text-primary\)\);[\s\S]*\}/,
    );
    const breadcrumbProjectBlock = stylesCss.match(/\.breadcrumb-project-name \{[\s\S]*?\n    \}/)?.[0] ?? '';
    expect(breadcrumbProjectBlock).not.toContain('box-shadow: inset 3px 0 0 var(--accent-primary);');
    expect(stylesCss).toMatch(
      /\.breadcrumb-current \{[\s\S]*min-width: 0;[\s\S]*overflow: hidden;[\s\S]*text-overflow: ellipsis;[\s\S]*\}/,
    );
    expect(mainTsx).toContain('chatAttachments.map(attachment => {');
    expect(mainTsx).toContain('setChatAttachmentRemovingId(attachment.id)');
    expect(mainTsx).toContain('removeChatAttachment(attachment.id)');
    expect(mainTsx).toContain('disabled={chatSendDisabled}');
    expect(stylesCss).not.toContain('.project-presence {');
    expect(stylesCss).not.toContain('.project-dirty {');
    expect(stylesCss).not.toContain('.chat-permission-button');
  });

  test('composer attachments render as flat two-line chips with visible upload errors', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    const mapStart = mainTsx.indexOf('chatAttachments.map(attachment => {');
    expect(mapStart).toBeGreaterThanOrEqual(0);
    const inputRowStart = mainTsx.indexOf('chat-composer-input-row', mapStart);
    expect(inputRowStart).toBeGreaterThan(mapStart);
    const block = mainTsx.slice(mapStart, inputRowStart);

    expect(block).toContain('className="chat-attachment-actions"');
    expect(block.indexOf('className="chat-attachment-meta"')).toBeLessThan(block.indexOf('className="chat-attachment-actions"'));
    expect(block.indexOf('className="chat-attachment-actions"')).toBeLessThan(block.indexOf('className="chat-attachment-progress"'));
    expect(block).toContain('data-tooltip={statusTooltip}');
    expect(block).toContain('attachment.error || \'Upload failed\'');
    expect(block).toContain('className="chat-attachment-retry"');
    expect(block).toContain('retryChatAttachment(attachment.id)');
    expect(block).toContain('setChatAttachmentRemovingId(attachment.id)');

    const chipRule = cssRuleBlock(stylesCss, '.chat-attachment-preview');
    expect(chipRule).toContain('align-items: center;');
    expect(chipRule).toContain('height: 44px;');
    expect(chipRule).not.toContain('flex-direction: column;');
    expect(chipRule).not.toContain('width: 88px;');

    const thumbRule = cssRuleBlock(stylesCss, '.chat-attachment-thumb');
    expect(thumbRule).toContain('width: 32px;');
    expect(thumbRule).toContain('height: 32px;');

    const nameRule = cssRuleBlock(stylesCss, '.chat-attachment-name');
    expect(nameRule).toContain('white-space: nowrap;');
    expect(nameRule).toContain('text-overflow: ellipsis;');

    const failedStatusRule = cssRuleBlock(stylesCss, '.chat-attachment-preview.failed .chat-attachment-status');
    expect(failedStatusRule).toContain('var(--state-danger)');

    const progressRule = cssRuleBlock(stylesCss, '.chat-attachment-progress');
    expect(progressRule).toContain('position: absolute;');
    expect(progressRule).toContain('height: 2px;');
    expect(progressRule).toContain('bottom: 2px;');

    expect(cssRuleBlock(stylesCss, '.chat-attachment-actions')).not.toBe('');
    expect(cssRuleBlockContainingSelector(stylesCss, '.chat-attachment-remove')).not.toContain('position: absolute;');
    expect(cssRuleBlockContainingSelector(stylesCss, '.chat-attachment-retry')).not.toContain('position: absolute;');
  });

  test('prompt attachment chips use the flat 32px two-line geometry', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);

    const chipRule = cssRuleBlock(stylesCss, '.chat-prompt-attachment-chip');
    expect(chipRule).toContain('grid-template-columns: 32px minmax(0, 1fr);');
    expect(chipRule).toContain('min-height: 40px;');

    const thumbRule = cssRuleBlock(stylesCss, '.chat-prompt-attachment-thumb');
    expect(thumbRule).toContain('width: 32px;');
    expect(thumbRule).toContain('height: 32px;');

    const iconRule = cssRuleBlock(stylesCss, '.chat-prompt-attachment-icon');
    expect(iconRule).toContain('width: 32px;');
    expect(iconRule).toContain('height: 32px;');
  });

  test('chat breadcrumb title uses the selected session project', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    const chatProjectNameStart = mainTsx.indexOf('const chatBreadcrumbProjectName = useMemo(');
    const chatLabelStart = mainTsx.indexOf('const chatBreadcrumbLabel = useMemo(', chatProjectNameStart);
    expect(chatProjectNameStart).toBeGreaterThanOrEqual(0);
    expect(chatLabelStart).toBeGreaterThan(chatProjectNameStart);

    const chatProjectNameBlock = mainTsx.slice(chatProjectNameStart, chatLabelStart);
    expect(chatProjectNameBlock).toContain('selectedChatKey?.projectId');
    expect(chatProjectNameBlock).toContain('projects.find(item => item.projectId === selectedProjectId)?.name');
    expect(chatProjectNameBlock).toContain('breadcrumbProjectName');
    expect(mainTsx).toContain("import { resolveChatSessionTitle } from '../chat/session/chatSessionTitle';");
    expect(mainTsx).not.toContain('const [useLatestPromptTitle, setUseLatestPromptTitle] = useState(');
    expect(mainTsx).toContain('const selectedChatDisplayTitle = useMemo(');
    expect(mainTsx).toContain("resolveChatSessionTitle(selectedChatSession?.title ?? '')");
    expect(mainTsx).toContain('resolveSessionDisplayTitle(session)');
    expect(mainTsx).not.toContain('session.title || session.sessionId');
    expect(mainTsx).not.toContain('selectedChatSession?.title ||');
    expect(mainTsx).toContain("() => selectedChatDisplayTitle || 'No Selected Session'");
    expect(mainTsx).not.toContain('checked={useLatestPromptTitle}');
    expect(mainTsx).not.toContain('onChange={e => setUseLatestPromptTitle(e.target.checked)}');
    expect(mainTsx).not.toContain('Use Latest Prompt Title');
    expect(mainTsx).not.toContain('className="chat-title-option"');
    expect(mainTsx).toContain('const renderDesktopChatBreadcrumbTitle = () => (');
    expect(mainTsx).toContain('const renderMobileChatBreadcrumbTitle = () => (');
    expect(mainTsx).toContain('const renderChatTitleBar = (mobile: boolean) => (');
    expect(mainTsx).toContain('{mobile ? renderMobileChatBreadcrumbTitle() : renderDesktopChatBreadcrumbTitle()}');
    expect(mainTsx).toContain('className="breadcrumb-title chat-breadcrumb-title"');
    expect(mainTsx).toContain('className={`chat-title-session-button chat-title-session-text title-text breadcrumb-current${chatTitlePromptMenuOpen ? \' open\' : \'\'}`}');
    expect(mainTsx).toContain('onClick={toggleChatTitlePromptMenu}');
    expect(mainTsx).toContain('{activeChatBreadcrumbProjectName}');
  });

  test('chat drawer header keeps tools left and hub browser right', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const hubMenuTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'ChatHubMenu.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const [chatHubMenuOpen, setChatHubMenuOpen, chatHubMenuExiting] = useMenuExitFlag();');
    expect(mainTsx).toContain('const [chatHubColorMenu, setChatHubColorMenu, chatHubColorMenuExiting] = useMenuExitState<{hubId: string}>();');
    expect(mainTsx).toContain("const chatHubColorMenuHubId = chatHubColorMenu?.hubId ?? '';");
    expect(mainTsx).toContain('const chatHubMenuRef = useRef<HTMLDivElement | null>(null);');
    expect(mainTsx).toContain('const renderChatHubSummary = () => {');
    expect(mainTsx).not.toContain('const renderChatHubSummary = useCallback((mobile = false) => {');
    expect(mainTsx).toContain('const hubIds = chatHubTreeItems.map(item => item.hubId);');
    expect(mainTsx).toContain('const hubCount = hubIds.length;');
    expect(mainTsx).not.toContain('const hubCount = registryHubs.length;');
    expect(mainTsx).toContain('const projectCount = projects.length;');
    expect(mainTsx).toContain('if (!chatHubMenuOpen) return;');
    expect(mainTsx).toContain("if (event.key === 'Escape') {");
    expect(mainTsx).toContain('if (sidebarSettingsOpen) {');
    expect(mainTsx).toContain('!chatHubMenuRef.current?.contains(target) &&');
    expect(mainTsx).toContain('!chatHubPopoverRef.current?.contains(target)');
    expect(hubMenuTsx).toContain('ref={popoverRef}\n            className="chat-hub-popover-stack"');
    expect(mainTsx).toContain("!targetElement.closest('.chat-hub-color-palette')");
    expect(mainTsx).toContain("!targetElement.closest('.chat-hub-color-button')");
    expect(mainTsx).toContain("const chatHubSummaryLabel = `${hubCount} ${hubCount === 1 ? 'Hub' : 'Hubs'}`;");
    expect(mainTsx).toContain("const chatHubProjectLabel = `${projectCount} ${projectCount === 1 ? 'Project' : 'Projects'}`;");
    expect(mainTsx).not.toContain('<span className="chat-hub-summary-count">{hubCount}</span>');
    expect(mainTsx).toContain('summaryLabel={chatHubSummaryLabel}');
    expect(mainTsx).toContain('projectLabel={chatHubProjectLabel}');
    expect(mainTsx).toContain('hubIds={hubIds}');
    expect(hubMenuTsx).toContain("aria-label={`Show connected hubs, ${summaryLabel}, ${projectLabel}`}");
    expect(hubMenuTsx).toContain('aria-expanded={open}');
    expect(hubMenuTsx).toContain('<span className="chat-hub-summary-label">{summaryLabel}</span>');
    expect(hubMenuTsx).toContain('<span className="chat-hub-summary-project-label">{projectLabel}</span>');
    expect(hubMenuTsx).toContain('hubIds.length > 0 ? (');
    expect(hubMenuTsx).toContain('hubIds.map(hubId =>');
    expect(hubMenuTsx).toContain('className="chat-hub-color-button"');
    expect(hubMenuTsx).toContain('className="chat-hub-color-dot"');
    expect(hubMenuTsx).toContain('className="chat-hub-expand-button"');
    expect(hubMenuTsx).toContain('name="chevronRight"');
    expect(hubMenuTsx).not.toContain("name={expanded ? 'chevronDown' : 'chevronRight'}");
    expect(hubMenuTsx).toContain("className={`chat-hub-color-palette topbar-menu-surface${inline ? ' inline' : ''}${exiting ? ' sl-menu-exit' : ''}`}");
    expect(hubMenuTsx).toContain('<span className="chat-hub-row-name">{hubId}</span>');
    expect(hubMenuTsx).toContain('<div className="chat-hub-empty">No hubs</div>');
    expect(mainTsx).toContain('const renderChatSessionHeader = (mobile: boolean) => {');
    expect(mainTsx).toContain('const renderWheelMakerAppMenu = (mobile: boolean) => (');
    expect(mainTsx).toContain("'chat-menu-icon-button chat-menu-settings-button chat-menu-product-button'");
    expect(mainTsx).not.toContain('<span className="mobile-chat-drawer-title">Chats</span>');
    expect(mainTsx).toContain('{renderChatSessionHeader(true)}');
    expect(mainTsx).toContain('renderChatSessionHeader(false)');
    expect(mainTsx).not.toContain('<div className="mobile-chat-toolbar" aria-label="Chat tools">');
    expect(mainTsx).not.toContain('renderChatHubSummary(true)');
    expect(mainTsx).not.toContain('renderChatArchiveControls(true)');
    expect(mainTsx).not.toContain('renderChatHeaderSearchControls(true)');
    expect(mainTsx).not.toContain('chat-hub-summary${mobile');
    expect(mainTsx).not.toContain('chat-header-search-wrap${mobile');
    expect(mainTsx).not.toContain('chat-header-archive-control compact${mobile');
    expect(mainTsx).toContain('renderChatHubSummary()');
    const chatSessionHeaderStart = mainTsx.indexOf('const renderChatSessionHeader = (mobile: boolean) => {');
    const chatSessionHeaderEnd = mainTsx.indexOf('const renderMobileChatSessionSheet = () => {', chatSessionHeaderStart);
    const chatSessionHeaderBlock = mainTsx.slice(chatSessionHeaderStart, chatSessionHeaderEnd);
    expect(chatSessionHeaderStart).toBeGreaterThanOrEqual(0);
    expect(chatSessionHeaderEnd).toBeGreaterThan(chatSessionHeaderStart);
    expect(chatSessionHeaderBlock).not.toContain('mobile ? renderWheelMakerAppMenu(true) : (');
    expect(chatSessionHeaderBlock).toContain('{renderWheelMakerAppMenu(false)}');
    expect(chatSessionHeaderBlock).toContain('{renderDesktopChatProjectSelector()}');
    expect(chatSessionHeaderBlock).toContain('<div className="chat-sidebar-title-actions">');
    expect(chatSessionHeaderBlock).toContain('{renderChatHubSummary()}');
    expect(chatSessionHeaderBlock).toContain('{renderChatArchiveControls()}');
    expect(chatSessionHeaderBlock).toContain('{renderChatHeaderSearchControls()}');
    expect(mainTsx).not.toContain('renderChatMenuUsageButton');
    const renderMainStart = mainTsx.indexOf('const renderMain = () => {');
    const chatMainStart = mainTsx.indexOf('return (', renderMainStart);
    const chatMainEnd = mainTsx.indexOf('const renderPreviewFileTreeSearchResults', chatMainStart);
    expect(renderMainStart).toBeGreaterThanOrEqual(0);
    expect(chatMainStart).toBeGreaterThan(renderMainStart);
    expect(chatMainEnd).toBeGreaterThan(chatMainStart);
    const chatMainBlock = mainTsx.slice(chatMainStart, chatMainEnd);
    expect(chatMainBlock).not.toContain('renderChatHubSummary()');
    expect(stylesCss).not.toContain('.mobile-chat-drawer-header');
    expect(stylesCss).not.toContain('.mobile-chat-toolbar');
    expect(stylesCss).not.toContain('.mobile-chat-hub-slot');
    const mobileChatHeaderBlock = stylesCss.match(/\.chat-session-header\.mobile \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileChatHeaderBlock).toContain('height: calc(var(--wm-safe-area-top) + var(--chat-menu-header-height));');
    expect(mobileChatHeaderBlock).toContain('min-height: calc(var(--wm-safe-area-top) + var(--chat-menu-header-height));');
    expect(mobileChatHeaderBlock).toContain('max-height: calc(var(--wm-safe-area-top) + var(--chat-menu-header-height));');
    expect(mobileChatHeaderBlock).toContain('padding: var(--wm-safe-area-top) 8px 0;');
    expect(mobileChatHeaderBlock).not.toContain('+ 58px');
    expect(mobileChatHeaderBlock).not.toContain('+ 62px');
    expect(stylesCss).not.toContain('min-height: calc(var(--wm-safe-area-top) + 66px);');
    expect(stylesCss).not.toContain('.mobile-chat-toolbar-icon {');
    expect(stylesCss).toContain('--chat-menu-header-height: 32px;');
    expect(stylesCss).toContain('--chat-menu-icon-button-size: 30px;');
    expect(stylesCss).toContain('.chat-menu-icon-button {');
    const chatMenuIconButtonBlock = stylesCss.match(/\.chat-menu-icon-button \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(chatMenuIconButtonBlock).toContain('width: var(--chat-menu-icon-button-size);');
    expect(chatMenuIconButtonBlock).toContain('height: var(--chat-menu-icon-button-size);');
    expect(chatMenuIconButtonBlock).toContain('border-radius: var(--chat-menu-icon-button-radius);');
    expect(stylesCss).not.toContain('.wide-sidebar-settings-button {');
    expect(stylesCss).toContain('.sidebar-title-row .chat-hub-summary {');
    expect(stylesCss).toContain('.chat-sidebar-title-actions {');
    expect(stylesCss).toContain('.sidebar-title-row.search-open .chat-sidebar-title-actions {');
    expect(stylesCss).toContain('.chat-hub-summary {');
    expect(stylesCss).toContain('.chat-hub-summary-button {');
    expect(stylesCss).not.toContain('.chat-header-search-wrap.mobile');
    expect(stylesCss).not.toContain('.chat-header-search-control.open.mobile');
    expect(stylesCss).not.toContain('.chat-header-archive-control.compact.mobile');
    const sidebarHubButtonBlock = stylesCss.match(/\.sidebar-title-row \.chat-hub-summary-button \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(sidebarHubButtonBlock).toContain('max-width: min(154px, 48vw);');
    expect(stylesCss).not.toContain('.content > .block-title.with-tools {\n    height: calc(var(--wm-safe-area-top) + 50px);');
    expect(stylesCss).not.toContain('.content > .block-title.with-tools .view-tool {');
    expect(stylesCss).toContain('.chat-hub-summary-copy {');
    expect(stylesCss).toContain('.chat-hub-summary-project-label {');
    expect(stylesCss).not.toContain('.chat-hub-summary-count {');
    expect(stylesCss).toContain('.chat-hub-popover {');
    expect(stylesCss).toMatch(
      /\.chat-hub-summary-button \{[\s\S]*letter-spacing: 0;[\s\S]*text-transform: none;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-hub-popover \{[\s\S]*letter-spacing: 0;[\s\S]*text-transform: none;[\s\S]*\}/,
    );
    expect(stylesCss).toContain('.chat-hub-row-name {');
    expect(stylesCss).toContain('.chat-hub-empty {');
    expect(stylesCss).toContain('.chat-hub-color-button {');
    expect(stylesCss).toContain('.chat-hub-color-dot {');
    expect(stylesCss).toContain('.chat-hub-expand-button {');
    const hubTreeBlock = stylesCss.match(/\.chat-hub-tree \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(hubTreeBlock).not.toContain('border-left:');
    expect(stylesCss).toContain('margin: 0 2px 5px;');
    expect(stylesCss).not.toContain('margin: 1px 0 3px 26px;');
  });

  test('keeps every Hub-owned portal surface inside the Hub dismissal boundary', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('const CHAT_HUB_INTERACTION_SURFACE_SELECTOR = [');
    expect(mainTsx).toContain("'.chat-hub-popover-stack'");
    expect(mainTsx).toContain(`'[data-chat-hub-owned-overlay="true"]'`);
    expect(mainTsx).toContain('function isChatHubInteractionSurface(target: EventTarget | null): boolean {');
    expect(mainTsx).toContain('if (isChatHubInteractionSurface(target)) {');
    expect(mainTsx).toContain('preserveChatHubMenu={chatHubMenuOpen}');
    expect(mainTsx).toContain('preserveChatHubMenu={chatHubMenuOpen && skillRetryNotice.retry.target');
  });

  test('uses one aligned skill-row grid with detail on the name and External inline', () => {
    const projectRoot = path.join(__dirname, '..');
    const skillTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'ChatHubSkillManagement.tsx'));
    const stylesCss = readWebStyles(projectRoot);
    const row = cssRuleBlocksContainingSelector(stylesCss, '.chat-hub-skill-row').join('\n');
    const actions = cssRuleBlock(stylesCss, '.chat-hub-skill-row-actions');
    const sourceHeader = cssRuleBlock(stylesCss, '.chat-hub-skill-source-header');
    const sourceDisclosure = cssRuleBlock(stylesCss, '.chat-hub-skill-source-disclosure');
    const sourceStatusDot = cssRuleBlock(stylesCss, '.chat-hub-skill-source-status-dot');
    const actionSlot = cssRuleBlock(stylesCss, '.chat-hub-skill-action-slot');

    expect(row).toContain('grid-template-columns: minmax(0, 1fr) 52px;');
    expect(actions).toContain('grid-template-columns: repeat(2, 24px);');
    expect(sourceHeader).toContain('flex-wrap: nowrap;');
    expect(sourceDisclosure).toContain('min-width: 0;');
    expect(sourceDisclosure).toContain('overflow: hidden;');
    expect(sourceStatusDot).toContain('width: 6px;');
    expect(actionSlot).toContain('width: 24px;');
    expect(skillTsx).toContain('className="chat-hub-skill-name-cell"');
    expect(skillTsx).toContain('className="chat-hub-skill-name"');
    expect(skillTsx).toContain('aria-label={`View ${skill.name} details`}');
    expect(skillTsx).not.toContain("name={detailPending ? 'loader' : 'info'}");
  });

  test('Hub menu uses one compact row system and a normal-flow footer on every screen size', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const hubRow = cssRuleBlock(stylesCss, '.chat-hub-row');
    const sections = cssRuleBlock(stylesCss, '.chat-hub-sections');
    const line = cssRuleBlock(stylesCss, '.chat-hub-line');
    const actions = cssRuleBlock(stylesCss, '.chat-hub-line-actions');
    const footer = cssRuleBlock(stylesCss, '.chat-hub-footer');
    const versionAction = cssRuleBlock(stylesCss, '.chat-hub-row-actions .chat-hub-version-action');
    const detailToolbar = cssRuleBlock(stylesCss, '.chat-hub-detail-toolbar');
    const detailRows = cssRuleBlocksContainingSelector(stylesCss, '.chat-hub-npm-row')
      .find(block => block.includes('height: 32px;')) ?? '';
    const projectRow = cssRuleBlocksContainingSelector(stylesCss, '.chat-hub-project-row')
      .find(block => block.includes('height: 32px;')) ?? '';
    const sectionHeader = cssRuleBlock(stylesCss, '.chat-hub-section-header');

    expect(hubRow).toContain('height: 40px;');
    expect(hubRow).toContain('grid-template-columns: 24px minmax(0, 1fr) auto 52px 16px;');
    expect(sections).not.toContain('border-left:');
    expect(stylesCss).not.toContain('.chat-hub-sections::before {');
    expect(line).toContain('grid-template-columns: 14px minmax(44px, max-content) minmax(0, 1fr);');
    expect(line).toContain('height: 40px;');
    expect(actions).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(actions).not.toContain('border-radius: 7px;');
    expect(detailToolbar).toContain('height: 36px;');
    expect(detailRows).toContain('height: 32px;');
    expect(projectRow).toContain('height: 32px;');
    expect(sectionHeader).toContain('height: 40px;');
    expect(versionAction).toContain('background: transparent;');
    expect(footer).not.toContain('position: sticky;');
    expect(footer).not.toContain('bottom: 0;');
    expect(cssRuleBlocksContainingSelector(stylesCss, '.chat-hub-row')
      .some(block => block.includes('min-height: 44px'))).toBe(false);
  });

  test('makes the Hub disclosure fill the row and pins its chevron to the end', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const disclosureBlock = stylesCss.match(/\.chat-hub-expand-button \{[\s\S]*?\n\}/)?.[0] ?? '';
    const chevronBlock = stylesCss.match(/\.chat-hub-expand-chevron \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(disclosureBlock).toContain('position: absolute;');
    expect(disclosureBlock).toContain('inset: 0;');
    expect(chevronBlock).toContain('justify-self: end;');
  });

  test('keeps the Project Skills selector readable and update dots out of layout flow', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const selector = cssRuleBlock(stylesCss, '.chat-hub-project-skill-select');
    const trigger = cssRuleBlock(stylesCss, '.chat-hub-project-skill-trigger');
    const menu = cssRuleBlock(stylesCss, '.chat-hub-project-skill-menu');
    const option = cssRuleBlock(stylesCss, '.chat-hub-project-skill-option');
    const disclosure = cssRuleBlock(stylesCss, '.chat-hub-disclosure-action');
    const updateDot = cssRuleBlock(stylesCss, '.chat-hub-update-dot');

    expect(selector).toContain('position: relative;');
    expect(trigger).toContain('width: 100%;');
    expect(trigger).toContain('height: 32px;');
    expect(menu).toContain('max-height: 192px;');
    expect(menu).toContain('overflow-y: auto;');
    expect(option).toContain('height: 32px;');
    expect(stylesCss).not.toContain('.chat-hub-project-skill-picker {');
    expect(disclosure).toContain('position: relative;');
    expect(updateDot).toContain('position: absolute;');
    expect(updateDot).toContain('background: var(--accent-primary);');
    expect(updateDot).toContain('pointer-events: none;');
  });

  test('gives Hub counts and footer actions a clear visual hierarchy', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const countBlock = stylesCss.match(/\.chat-hub-action-info \{[\s\S]*?\n\}/)?.[0] ?? '';
    const footerBlock = stylesCss.match(/\.chat-hub-footer \{[\s\S]*?\n\}/)?.[0] ?? '';
    const versionBlock = stylesCss.match(/\.chat-hub-footer-version-value \{[\s\S]*?\n\}/)?.[0] ?? '';
    const updateBlock = stylesCss.match(/\.chat-hub-footer-update-all \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(countBlock).not.toContain('border-radius:');
    expect(countBlock).not.toContain('background:');
    expect(countBlock).toContain('font-variant-numeric: tabular-nums;');
    expect(footerBlock).toContain('background: transparent;');
    expect(footerBlock).toContain('border-top: 1px solid');
    expect(footerBlock).not.toContain('position: sticky;');
    expect(versionBlock).not.toContain('background:');
    expect(updateBlock).toContain('background: var(--accent-primary);');
    expect(updateBlock).toContain('color: var(--button-primary-text, #fff);');
  });

  test('does not render the retired File/Git drawer project header', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).not.toContain("tab !== 'chat'");
    expect(mainTsx).not.toContain('className="drawer-project-header"');
    expect(stylesCss).not.toContain('.drawer-project-header');
  });

  test('chat composer is a unified command frame with compact custom config pills', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const chatTurnTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'ChatTurnView.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const chatComposerStatusCompact = !isWide || windowWidth < 980 || (chatPreviewOpen && windowWidth < 1280);');
    expect(mainTsx).not.toContain('CHAT_QUICK_REPLY_OPTIONS');
    expect(mainTsx).toContain("const chatPromptMenuOpen = chatComposerMenu.id === 'slash';");
    expect(mainTsx).toContain("const chatAttachmentTrayOpen = chatComposerMenu.id === 'attachment-tray';");
    expect(mainTsx).not.toContain('chatQuickReplyMenuOpen');
    expect(mainTsx).toContain("const chatFileMentionMenuOpen = chatComposerMenu.id === 'file-mention';");
    expect(mainTsx).toContain("const chatConfigMenuOptionId = chatComposerMenu.id === 'config-value' ? chatComposerMenu.optionId : '';");
    expect(mainTsx).toContain('const status = splitChatComposerStatusOptions(selectedChatConfigOptions, chatComposerStatusCompact);');
    expect(mainTsx).toContain('overflow: status.overflowOptions,');
    expect(mainTsx).toContain("className={`chat-composer-frame${chatComposerDragActive ? ' drag-over' : ''}`}");
    expect(mainTsx).toContain('className="chat-composer-input-row"');
    expect(mainTsx).not.toContain('chatComposerStopTriggerClassName');
    expect(mainTsx).toContain('data-tooltip="Commands and skills"');
    expect(mainTsx).toContain('aria-label="Open commands and skills"');
    expect(mainTsx).toContain('className="chat-tool-button chat-slash-button"');
    expect(mainTsx).not.toContain('className="chat-composer-skill-trigger chat-slash-button"');
    expect(mainTsx).toContain('<SessionIcon name="terminal" />');
    expect(mainTsx).not.toContain('className="codicon codicon-terminal" aria-hidden="true"');
    expect(mainTsx).not.toContain('className="chat-composer-quick-trigger"');
    expect(mainTsx).not.toContain('data-tooltip="Quick replies"');
    expect(mainTsx).not.toContain('aria-label="Quick replies"');
    expect(mainTsx).not.toContain('className="chat-quick-reply-menu"');
    expect(mainTsx).not.toContain('className="chat-quick-reply-item"');
    expect(mainTsx).not.toContain('openChatQuickReplyMenu');
    expect(mainTsx).not.toContain('handleChatQuickReplySelect');
    expect(mainTsx).not.toContain('chatComposerText.length === 0 ? (');
    expect(mainTsx).not.toContain('if (chatComposerText.length > 0) {');
    expect(mainTsx).toContain('className="chat-composer-toolbar"');
    expect(mainTsx).toContain('className="chat-composer-action-column"');
    expect(mainTsx).toContain('className="chat-composer-toolbar-actions"');
    expect(mainTsx).not.toContain('className={`chat-cancel-button${selectedChatPromptRunning ? \' active\' : \'\'}`}');
    expect(mainTsx).toContain('<ChatStopStatusPill');
    expect(mainTsx).toContain('cancelling={selectedChatPromptCancelling}');
    expect(mainTsx).toContain('onCancel={() => cancelSelectedChatPrompt().catch(() => undefined)}');
    expect(mainTsx).not.toContain('codicon-stop-circle');
    expect(mainTsx).not.toContain("className=\"codicon codicon-debug-stop\"");
    expect(mainTsx).not.toContain('chat-stop-glyph');
    expect(mainTsx).not.toContain('chat-stop-square');
    expect(mainTsx).toContain('className="chat-composer-tools"');
    expect(mainTsx).toContain('className="chat-tool-button chat-attachment-plus-button"');
    expect(mainTsx).toContain('chat-composer-stop-slot${chatStopPillExiting');
    expect(mainTsx).toContain("aria-label={isWide ? 'Attach files' : 'Attach files or photos'}");
    expect(mainTsx).toContain('aria-haspopup={isWide ? undefined : \'menu\'}');
    expect(mainTsx).toContain('aria-expanded={isWide ? undefined : chatAttachmentTrayOpen}');
    expect(mainTsx).toContain('{!isWide && chatAttachmentTrayOpen ? (');
    expect(mainTsx).toContain('chat-attachment-action-tray${chatComposerMenuExiting');
    expect(mainTsx).toContain('className="chat-tool-button chat-file-mention-trigger-button"');
    expect(mainTsx).toContain('className="chat-attachment-action-button file"');
    expect(mainTsx).toContain('className="chat-attachment-action-button photo"');
    expect(mainTsx).not.toContain('className="chat-attachment-action-button code"');
    expect(mainTsx).not.toContain('<span className="chat-attachment-action-label">Code</span>');
    expect(mainTsx).toContain('<span className="chat-attachment-action-label">File</span>');
    expect(mainTsx).toContain('<span className="chat-attachment-action-label">Photo</span>');
    expect(mainTsx).toContain('<ChatIcon name="command" />');
    expect(mainTsx).toContain('<ChatIcon name="atSign" />');
    expect(mainTsx).not.toContain('chat-composer-tool-glyph');
    expect(mainTsx).not.toContain('chat-slash-symbol');
    expect(mainTsx).not.toContain('chat-at-symbol');
    expect(mainTsx).not.toContain('className="chat-tool-button chat-mention-button"');
    expect(mainTsx).toContain('data-tooltip="Mention files"');
    expect(mainTsx).toContain('aria-label="Mention files"');
    expect(mainTsx).not.toContain('className="chat-mention-symbol"');
    expect(mainTsx).toContain('chat-file-mention-menu${chatComposerMenuExiting');
    expect(mainTsx).toContain('chat-file-mention-menu-body');
    expect(mainTsx).toContain('chat-slash-menu-body');
    expect(mainTsx).toContain('aria-busy={chatFileMentionLoading}');
    expect(mainTsx).toContain('chatFileMentionLoading && chatFileMentionResults.length === 0');
    expect(mainTsx).toContain('chat-file-mention-skeleton');
    expect(mainTsx).toContain('CHAT_FILE_MENTION_SKELETON_ROWS');
    expect(mainTsx).toContain('className="chat-file-mention-empty"');
    expect(mainTsx).toContain('aria-label="File mentions"');
    expect(mainTsx).toContain('Index not built');
    expect(mainTsx).toContain('No files found');
    expect(mainTsx).toContain('const openChatFileMentionShortcut = useCallback(() => {');
    expect(mainTsx).not.toContain('className="chat-tool-button chat-skill-button"');
    expect(mainTsx).not.toContain('codicon-wand');
    expect(mainTsx).not.toContain('codicon-symbol-keyword');
    expect(mainTsx).not.toContain('className="chat-tool-button chat-attach-button"');
    expect(mainTsx).toContain('<ChatIcon name="paperclip" />');
    expect(mainTsx).toContain('<ChatIcon name="paperclip" />');
    expect(mainTsx).toContain('<ChatIcon name="camera" />');
    expect(mainTsx).not.toContain('codicon-cloud-upload');
    expect(mainTsx).not.toContain('codicon-new-file');
    expect(mainTsx).toContain('chatFileInputRef.current?.click();');
    expect(mainTsx).not.toContain('className={`chat-tool-button chat-stop-button${selectedChatPromptRunning ? \' active\' : \'\'}`}');
    expect(mainTsx).toContain('<VoiceInputButton');
    expect(mainTsx).toContain('<VoiceRecordingBar');
    expect(mainTsx).toContain('extractChatOptionReplies(text)');
    expect(mainTsx).toContain('extractChatConfirmationReply(text)');
    expect(chatTurnTsx).not.toContain('normalizeChatOptionMarkdown');
    expect(chatTurnTsx).toContain('const markdownCapabilities = useMarkdownCapabilityPlugins(text);');
    expect(chatTurnTsx).toContain('components={interactiveMarkdownComponents}');
    expect(chatTurnTsx).toContain("'data-chat-reply-value': reply.value");
    expect(chatTurnTsx).toContain("role: 'button'");
    expect(chatTurnTsx).toContain("className: [props.className, 'chat-reply-target']");
    expect(chatTurnTsx).not.toContain('className="chat-option-reply-line"');
    expect(chatTurnTsx).not.toContain('className="chat-option-reply-inline-button"');
    expect(chatTurnTsx).not.toContain('className="chat-option-reply-static"');
    expect(chatTurnTsx).not.toContain('className="chat-confirmation-reply-line"');
    expect(chatTurnTsx).not.toContain('className="chat-confirmation-reply-action"');
    expect(mainTsx).not.toContain('className="chat-option-replies"');
    expect(chatTurnTsx).toContain('onSelectOptionReply?: (label: string) => void;');
    expect(chatTurnTsx).toContain('onSelectConfirmationReply?: (replyText: string) => void;');
    expect(mainTsx).toContain('if (selectedPendingPrompt) {');
    expect(mainTsx).toContain('className="chat-config-pill"');
    expect(mainTsx).toContain('chat-config-value-menu${chatComposerMenuExiting');
    expect(mainTsx).toContain('chat-config-value-option${selected ?');
    expect(mainTsx).toContain('className="chat-config-value-label"');
    expect(mainTsx).toContain('className="chat-config-overflow-group"');
    expect(mainTsx).not.toContain('className="chat-action-menu chat-action-menu-inline');
    expect(mainTsx).not.toContain('Photo Library');
    expect(mainTsx).not.toContain('className="chat-config-select"');
    expect(mainTsx).not.toContain('showChatConfigLabels');
    expect(mainTsx).not.toContain('chatConfigFeedback');
    expect(mainTsx).not.toContain('Applying config');
    expect(mainTsx).toContain("import { ChatRichComposer, type ChatRichComposerHandle } from '../chat/composer/ChatRichComposer';");
    expect(mainTsx).toContain('serializeChatComposerTokens,');
    expect(mainTsx).not.toContain("import { insertChatSlashCommandText } from '../chat/composer/chatSlashInsertion';");

    const stopPillStart = mainTsx.indexOf('<ChatStopStatusPill');
    expect(stopPillStart).toBeGreaterThanOrEqual(0);
    const stopPillEnd = mainTsx.indexOf('/>', stopPillStart);
    expect(stopPillEnd).toBeGreaterThan(stopPillStart);
    const stopPillBlock = mainTsx.slice(stopPillStart, stopPillEnd);
    expect(stopPillBlock).toContain('cancelling={selectedChatPromptCancelling}');
    expect(stopPillBlock).toContain('onCancel={() => cancelSelectedChatPrompt().catch(() => undefined)}');
    expect(stopPillBlock).toContain('armOnTap={!isWide}');

    const stopPillTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'composer', 'ChatStopStatusPill.tsx'));
    expect(stopPillTsx).toContain('disabled={cancelling}');
    expect(stopPillTsx).toContain('aria-busy={cancelling}');
    expect(stopPillTsx).not.toContain('codicon');

    const promptMenuOpenStart = mainTsx.indexOf('const openChatPromptMenu = useCallback(() => {');
    const promptMenuOpenEnd = mainTsx.indexOf('const toggleChatAttachmentTray = useCallback(() => {', promptMenuOpenStart);
    expect(promptMenuOpenStart).toBeGreaterThanOrEqual(0);
    expect(promptMenuOpenEnd).toBeGreaterThan(promptMenuOpenStart);
    const promptMenuOpenBody = mainTsx.slice(promptMenuOpenStart, promptMenuOpenEnd);
    expect(promptMenuOpenBody).toContain('setChatFileMentionMenuOpen(false);');
    expect(promptMenuOpenBody).toContain('setChatAttachmentTrayOpen(false);');
    expect(promptMenuOpenBody).toContain('chatRichComposerRef.current?.focus();');
    expect(promptMenuOpenBody).not.toContain('chatRichComposerRef.current?.blur();');

    const fileMentionShortcutStart = mainTsx.indexOf('const openChatFileMentionShortcut = useCallback(() => {');
    const fileMentionShortcutEnd = mainTsx.indexOf('const applyChatFileMentionResult = useCallback', fileMentionShortcutStart);
    expect(fileMentionShortcutStart).toBeGreaterThanOrEqual(0);
    expect(fileMentionShortcutEnd).toBeGreaterThan(fileMentionShortcutStart);
    const fileMentionShortcutBody = mainTsx.slice(fileMentionShortcutStart, fileMentionShortcutEnd);
    expect(fileMentionShortcutBody).toContain('setChatPromptMenuOpen(false);');
    expect(fileMentionShortcutBody).toContain('setChatAttachmentTrayOpen(false);');
    expect(fileMentionShortcutBody).toContain('setChatConfigMenuOptionId(\'\');');
    expect(fileMentionShortcutBody).toContain('setChatConfigOverflowOpen(false);');
    expect(fileMentionShortcutBody).toContain('resolveChatFileMentionQuery(text, selectionStart)');
    expect(fileMentionShortcutBody).toContain("const prefix = text && !/\\s$/.test(text) ? ' @' : '@';");
    expect(fileMentionShortcutBody).toContain('chatRichComposerRef.current?.insertText(prefix);');
    expect(fileMentionShortcutBody).toContain('scheduleChatFileMentionSearch(nextText, nextText.length);');

    const slashShortcutStart = mainTsx.indexOf('const openChatPromptMenu = useCallback(() => {');
    const slashShortcutEnd = mainTsx.indexOf('const toggleChatAttachmentTray = useCallback', slashShortcutStart);
    expect(slashShortcutStart).toBeGreaterThanOrEqual(0);
    expect(slashShortcutEnd).toBeGreaterThan(slashShortcutStart);
    const slashShortcutBody = mainTsx.slice(slashShortcutStart, slashShortcutEnd);
    expect(slashShortcutBody).toContain("const prefix = text && !/\\s$/.test(text) ? ' /' : '/';");
    expect(slashShortcutBody).toContain('chatRichComposerRef.current?.insertText(prefix);');
    expect(slashShortcutBody).toContain('scheduleChatSlashMenu(nextText, nextText.length);');

    const toolsStart = mainTsx.indexOf('className="chat-composer-tools"');
    const toolsEnd = mainTsx.indexOf('className="chat-config-options-wrap"', toolsStart);
    expect(toolsStart).toBeGreaterThanOrEqual(0);
    expect(toolsEnd).toBeGreaterThan(toolsStart);
    const toolsBlock = mainTsx.slice(toolsStart, toolsEnd);
    expect(toolsBlock).toContain('chat-slash-button');
    expect(toolsBlock).toContain('chat-file-mention-trigger-button');
    expect(toolsBlock).toContain('chat-attachment-plus-button');
    expect(toolsBlock).toContain('chat-composer-stop-slot');
    expect(toolsBlock).toContain('chat-attachment-action-tray');
    expect(toolsBlock).not.toContain('chat-mention-button');
    expect(toolsBlock).not.toContain('chat-attach-button');
    expect(toolsBlock).not.toContain('chat-image-attach-button');
    expect(toolsBlock).not.toContain('chat-stop-button');
    expect(toolsBlock).toContain('<ChatStopStatusPill');

    const configPillStart = mainTsx.indexOf('const renderChatConfigPill = (option: RegistrySessionConfigOption) => {');
    const configPillEnd = mainTsx.indexOf('const renderChatContextUsage = () => {', configPillStart);
    expect(configPillStart).toBeGreaterThanOrEqual(0);
    expect(configPillEnd).toBeGreaterThan(configPillStart);
    const configPillBlock = mainTsx.slice(configPillStart, configPillEnd);
    expect(configPillBlock).not.toContain('codicon-chevron-down');
    expect(configPillBlock).not.toContain('className={`codicon');
    expect(configPillBlock).toContain('className="chat-config-pill-value"');
    expect(mainTsx).not.toContain('function chatConfigIconClass(option: RegistrySessionConfigOption): string {');

    const configChangeStart = mainTsx.indexOf('const handleChatConfigOptionChange = async');
    const configChangeEnd = mainTsx.indexOf('const handleChatFileChange = (', configChangeStart);
    const configChangeBody = mainTsx.slice(configChangeStart, configChangeEnd);
    const setConfigCall = configChangeBody.indexOf('const result = await service.setProjectSessionConfig');
    expect(setConfigCall).toBeGreaterThanOrEqual(0);
    expect(configChangeBody).toContain('selectedKey.projectId');
    expect(configChangeBody.indexOf('applyChatSessionConfigOptions')).toBeGreaterThan(setConfigCall);
    expect(configChangeBody).not.toContain('setChatSessions(prev =>');

    const slashApplyStart = mainTsx.indexOf('const applyChatSlashCommand = useCallback(');
    const slashApplyEnd = mainTsx.indexOf('const openChatPromptMenu = useCallback', slashApplyStart);
    expect(slashApplyStart).toBeGreaterThanOrEqual(0);
    expect(slashApplyEnd).toBeGreaterThan(slashApplyStart);
    const slashApplyBody = mainTsx.slice(slashApplyStart, slashApplyEnd);
    expect(slashApplyBody).toContain('chatRichComposerRef.current?.insertSkill({');
    expect(slashApplyBody).toContain("command.behavior === 'insert-command'");
    expect(slashApplyBody).toContain('replaceActiveSlashQuery(');
    expect(slashApplyBody).toContain('command.insertText');
    expect(slashApplyBody).toContain('command: command.name,');
    expect(slashApplyBody).toContain('label: chatSlashCommandLabel(command.name),');
    expect(slashApplyBody).toContain('chatRichComposerRef.current?.focus();');
    expect(slashApplyBody).toContain('setChatFileMentionMenuOpen(false);');
    expect(slashApplyBody).not.toContain('updateChatComposerText(next);');

    expect(stylesCss).toMatch(
      /button,\s*\[role='button'\],\s*\[role='menuitemradio'\],\s*\[role='option'\]\s*\{[\s\S]*-webkit-tap-highlight-color: transparent;/,
    );
    expect(stylesCss).toMatch(
      /\.chat-composer \{[\s\S]*padding: 0 14px 4px;[\s\S]*background: transparent;/,
    );
    expect(stylesCss).not.toContain('.chat-composer::before {');
    expect(stylesCss).not.toContain('--chat-composer-frame-top');
    expect(stylesCss).not.toContain('--chat-composer-fade-distance');
    expect(stylesCss).toContain('.chat-composer-frame {');
    expect(stylesCss).toMatch(
      /\.chat-composer-frame \{[\s\S]*gap: 8px;[\s\S]*padding: 8px 8px 4px;[\s\S]*\}/,
    );
    expect(stylesCss).toContain('.chat-composer-input-row {');
    expect(stylesCss).toMatch(
      /\.chat-composer-input-row \{[\s\S]*align-items: flex-end;[\s\S]*gap: 6px;[\s\S]*min-height: 32px;[\s\S]*\}/,
    );
    expect(stylesCss).not.toContain('.chat-composer-skill-trigger {');
    expect(stylesCss).toContain('.chat-composer-action-column {');
    expect(stylesCss).toContain('.chat-composer-toolbar-actions {');
    expect(stylesCss).toContain('.chat-stop-pill {');
    const stopPillStyleBlock = stylesCss.match(/\.chat-stop-pill \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(stopPillStyleBlock).not.toContain('position: absolute;');
    expect(stopPillStyleBlock).toContain('height: 24px;');
    expect(stopPillStyleBlock).toContain('border-radius: 999px;');
    expect(stopPillStyleBlock).not.toContain('background: var(--state-danger);');
    expect(stylesCss).toContain('.chat-stop-pill.cancelling {');
    expect(stylesCss).toContain('.chat-stop-pill-stage {');
    expect(stylesCss).toContain('.chat-stop-bike-wheel-anim {');
    expect(stylesCss).toContain('.chat-stop-bike-crank {');
    expect(stylesCss).toContain('@keyframes chat-stop-bike-spin');
    expect(stylesCss).toContain('.chat-stop-bike-wind {');
    expect(stylesCss).toContain('@keyframes chat-stop-bike-wind');
    expect(stylesCss).toContain('.chat-stop-pill.cancelling .chat-stop-bike-wind {');
    expect(stylesCss).toContain('.chat-stop-pill-stop-glyph {');
    expect(stylesCss).toContain('.chat-stop-pill:hover:not(:disabled) .chat-stop-bike,');
    expect(stylesCss).toContain('.chat-stop-pill.armed .chat-stop-bike {');
    expect(stylesCss).toContain('.chat-stop-pill:hover:not(:disabled) .chat-stop-pill-stop-glyph,');
    expect(stylesCss).toContain('.chat-stop-pill.armed .chat-stop-pill-stop-glyph {');
    expect(stylesCss).toContain('.chat-stop-pill.cancelling .chat-stop-bike-wheel-anim,');
    expect(stylesCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.chat-stop-bike-wheel-anim,[\s\S]*\.chat-stop-bike-crank,[\s\S]*\.chat-stop-bike-wind path \{[\s\S]*animation: none;/);
    expect(stylesCss).not.toContain('.chat-stop-pill-label');
    expect(stylesCss).not.toContain('chat-stop-pill-shimmer');
    expect(stylesCss).not.toContain('chat-stop-pill-glyph-breathe');
    expect(stylesCss).not.toContain('.chat-stop-pill-glyph {');
    expect(stylesCss).not.toContain('.chat-stop-pill-dot');
    expect(stylesCss).not.toContain('chat-stop-pill-breathe');
    expect(stylesCss).not.toContain('.chat-stop-status');
    expect(stylesCss).not.toContain('.chat-stop-button');
    expect(stylesCss).not.toContain('.chat-composer-stop-trigger');
    expect(stylesCss).not.toContain('chatStopBreath');
    expect(stylesCss).not.toContain('.chat-stop-glyph {');
    expect(stylesCss).not.toContain('.chat-stop-square {');
    expect(cssRuleBlock(stylesCss, '.chat-context-usage')).toContain('conic-gradient(');
    expect(stylesCss).not.toContain('.chat-composer-quick-trigger {');
    expect(stylesCss).not.toContain('.chat-quick-trigger-label {');
    expect(stylesCss).not.toContain('.chat-quick-reply-menu {');
    expect(stylesCss).not.toContain('.chat-quick-reply-item {');
    expect(stylesCss).toContain('.chat-file-mention-menu {');
    expect(cssRuleBlock(stylesCss, '.chat-file-mention-menu')).toContain('overflow: hidden;');
    expect(cssRuleBlock(stylesCss, '.chat-slash-menu')).toContain('overflow: hidden;');
    expect(cssRuleBlock(stylesCss, '.chat-slash-menu-body,\n.chat-file-mention-menu-body')).toContain('overflow-y: auto;');
    expect(cssRuleBlock(stylesCss, '.chat-menu-footer')).toContain('flex: 0 0 auto;');
    expect(stylesCss).toContain('.chat-file-mention-empty {');
    expect(stylesCss).toContain('.chat-reply-target {');
    const replyTargetBlocks = cssRuleBlocksContainingSelector(stylesCss, '.chat-reply-target');
    expect(replyTargetBlocks.join('\n')).toContain('outline: 1px solid');
    for (const block of replyTargetBlocks) {
      expect(block).not.toMatch(/(?:^|\n)\s*(?:border|padding|margin|min-height|height|font|font-size|font-weight|line-height|letter-spacing|color|display|width)\s*:/);
    }
    expect(stylesCss).toContain('.chat-reply-target:hover {');
    expect(stylesCss).toContain('.chat-reply-target:focus-visible {');
    expect(cssRuleBlock(stylesCss, '.chat-reply-target')).toContain(
      'background: color-mix(in srgb, var(--accent-primary) 5%, transparent);',
    );
    expect(cssRuleBlock(stylesCss, '.chat-reply-target:hover')).toContain(
      'background: color-mix(in srgb, var(--accent-primary) 11%, transparent);',
    );
    expect(cssRuleBlock(stylesCss, '.chat-reply-target:focus-visible')).toContain(
      'background: color-mix(in srgb, var(--accent-primary) 12%, transparent);',
    );
    expect(cssRuleBlock(stylesCss, ".chat-reply-target[aria-disabled='true']")).toContain(
      'background: transparent;',
    );
    expect(cssRuleBlock(stylesCss, '.chat-reply-label')).toContain('color: var(--accent-primary);');
    expect(cssRuleBlock(stylesCss, 'li.chat-reply-target::marker')).toContain(
      'color: var(--accent-primary);',
    );
    expect(stylesCss).not.toContain('.chat-option-reply-line');
    expect(stylesCss).not.toContain('.chat-option-reply-inline-button');
    expect(stylesCss).not.toContain('.chat-option-reply-static');
    expect(stylesCss).not.toContain('.chat-confirmation-reply-line');
    expect(stylesCss).not.toContain('.chat-confirmation-reply-action');
    expect(stylesCss).not.toContain('.chat-confirmation-reply-check');
    expect(stylesCss).not.toContain('.chat-confirmation-reply-text');
    expect(stylesCss).not.toContain('.chat-reply-target,\n.chat-scroll-nav-button {');
    expect(stylesCss).not.toContain('.chat-option-replies {');
    expect(stylesCss).not.toContain('.chat-option-reply-button {');
    expect(stylesCss).toMatch(
      /\.chat-composer-input \{[\s\S]*min-height: 32px;[\s\S]*padding: var\(--chat-composer-input-pad-block\) var\(--chat-composer-input-pad-inline\) 2px;[\s\S]*font-size: 15px;[\s\S]*line-height: 1.4;[\s\S]*scrollbar-width: thin;[\s\S]*scrollbar-gutter: stable;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-composer-input-shell \{[\s\S]*--chat-composer-input-pad-block: 5px;[\s\S]*--chat-composer-input-pad-inline: 8px;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-composer-input::-webkit-scrollbar \{[\s\S]*width: 4px;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-composer-input::-webkit-scrollbar-thumb \{[\s\S]*border-radius: 999px;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-send-button \{[\s\S]*width: 36px;[\s\S]*height: 36px;[\s\S]*border-radius: 10px;[\s\S]*\}/,
    );
    expect(stylesCss).toContain('.chat-composer-action-column {');
    expect(stylesCss).not.toContain('.chat-cancel-button {');
    expect(mainTsx).toContain('<ChatIcon name="send" size={17} />');
    expect(stylesCss).toMatch(
      /\.chat-scroll-nav \{[\s\S]*right: 0;[\s\S]*bottom: calc\(100% \+ 10px\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-scroll-nav-button \{[\s\S]*border-radius: 50%;[\s\S]*backdrop-filter: blur\(12px\) saturate\(1\.5\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(/\.chat-composer-content \{[\s\S]*position: relative;[\s\S]*\}/);
    expect(stylesCss).not.toContain('--chat-scroll-bottom-offset');
    expect(stylesCss).not.toContain('.chat-title-tools {');
    expect(stylesCss).not.toContain('.chat-title-option {');
    expect(stylesCss).toContain('.chat-composer-toolbar {');
    expect(stylesCss).toMatch(
      /\.chat-composer-toolbar \{[\s\S]*position: relative;[\s\S]*gap: 8px;[\s\S]*min-height: 24px;[\s\S]*\}/,
    );
    expect(stylesCss).not.toMatch(/\.chat-composer-toolbar \{[\s\S]*padding-right: 30px;[\s\S]*\}/);
    expect(stylesCss).toContain('.chat-composer-tools {');
    expect(stylesCss).toContain('.chat-tool-button {');
    expect(stylesCss).toMatch(
      /\.chat-tool-button \{[\s\S]*width: 24px;[\s\S]*height: 24px;[\s\S]*\}/,
    );
    const toolButtonBlock = cssRuleBlock(stylesCss, '.chat-tool-button');
    expect(toolButtonBlock).toContain('border: none;');
    expect(toolButtonBlock).toContain('background: transparent;');
    expect(toolButtonBlock).toContain('color: color-mix(in srgb, var(--text-secondary) 86%, var(--text-primary));');
    expect(toolButtonBlock).not.toContain('border: 1px');
    expect(toolButtonBlock).not.toContain('color: color-mix(in srgb, var(--text-primary) 72%, var(--text-secondary));');
    expect(cssRuleBlock(stylesCss, '.chat-tool-button')).toContain('display: inline-grid;');
    expect(cssRuleBlock(stylesCss, '.chat-tool-button')).toContain('place-items: center;');
    expect(cssRuleBlock(stylesCss, '.chat-tool-button:hover,\n.chat-tool-button:focus-visible')).toContain('background: var(--hover);');
    expect(cssRuleBlock(stylesCss, '.chat-tool-button:hover,\n.chat-tool-button:focus-visible')).toContain('color: var(--text-primary);');
    expect(cssRuleBlock(stylesCss, '.chat-tool-button:hover,\n.chat-tool-button:focus-visible')).not.toContain('border-color:');
    expect(stylesCss).not.toContain('.chat-slash-button,\n.chat-file-mention-trigger-button,\n.chat-attachment-plus-button {');
    expect(stylesCss).toMatch(/\.chat-composer-stop-slot \{[\s\S]*display: flex;[\s\S]*align-items: center;[\s\S]*\}/);
    expect(stylesCss).not.toContain('.chat-composer-tool-glyph');
    expect(stylesCss).not.toContain('.chat-slash-symbol');
    expect(stylesCss).not.toContain('.chat-at-symbol');
    expect(stylesCss).toContain('.chat-file-mention-skeleton-row {');
    expect(stylesCss).toContain('.chat-file-mention-menu.refreshing .chat-file-mention-option-row {');
    expect(stylesCss).not.toContain('.chat-attachment-plus-button {');
    expect(stylesCss).toContain('.chat-attachment-action-tray {');
    expect(
      cssRuleBlocksContainingSelector(stylesCss, '.chat-attachment-action-tray')
        .some(block => block.includes('background: color-mix(in srgb, var(--surface-overlay) 98%, var(--surface-panel));')),
    ).toBe(true);
    expect(stylesCss).not.toContain('.chat-attachment-action-tray::after {');
    expect(stylesCss).toContain('.chat-attachment-action-button {');
    expect(stylesCss).toContain('.chat-attachment-action-label {');
    expect(stylesCss).not.toContain('.chat-mention-button {');
    expect(stylesCss).not.toContain('.chat-mention-symbol {');
    expect(stylesCss).not.toContain('.chat-skill-button {');
    expect(stylesCss).toMatch(
      /\.chat-attach-button \{[\s\S]*color: color-mix\(in srgb, var\(--state-info\) 78%, var\(--text-primary\)\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-image-attach-button \{[\s\S]*color: color-mix\(in srgb, var\(--state-warning\) 78%, var\(--text-primary\)\);[\s\S]*\}/,
    );
    expect(stylesCss).toContain('.chat-stop-pill {');
    expect(stylesCss).not.toContain('.chat-stop-button');
    expect(stylesCss).toContain('.chat-config-pill {');
    expect(stylesCss).not.toContain('.chat-config-pill .codicon');
    expect(stylesCss).toContain('.chat-config-value-menu {');
    expect(stylesCss).toMatch(
      /\.chat-config-value-menu \{[\s\S]*width: max-content;[\s\S]*min-width: 100%;[\s\S]*max-width: min\(320px, calc\(100vw - 24px\)\);[\s\S]*\}/,
    );
    expect(cssRuleBlock(stylesCss, '.chat-config-value-menu')).toContain('background: color-mix(in srgb, var(--surface-overlay) 98%, var(--surface-panel));');
    expect(stylesCss).toContain('.chat-config-value-option {');
    expect(stylesCss).toContain('.chat-config-value-menu .chat-config-value-option {');
    expect(stylesCss).toMatch(
      /\.chat-config-value-menu \.chat-config-value-option \{[\s\S]*width: 100%;[\s\S]*height: auto;[\s\S]*align-items: flex-start;[\s\S]*padding: 6px 8px;[\s\S]*line-height: 1.25;/,
    );
    expect(stylesCss).toContain('.chat-config-value-label {');
    expect(stylesCss).toMatch(
      /\.chat-config-value-label \{[\s\S]*overflow-wrap: anywhere;[\s\S]*text-align: left;[\s\S]*\}/,
    );
    expect(stylesCss).toContain('.chat-config-options .chat-config-item:first-child:not(:only-child) .chat-config-value-menu {');
    expect(stylesCss).toContain('.chat-config-options .chat-config-item:only-child .chat-config-value-menu {');
    expect(stylesCss).toContain('.chat-config-overflow-group {');
    expect(cssRuleBlock(stylesCss, '.chat-config-overflow-menu')).toContain('background: color-mix(in srgb, var(--surface-overlay) 98%, var(--surface-panel));');
    expect(cssRuleBlock(stylesCss, '.chat-slash-menu')).not.toContain('background:');
    expect(cssRuleBlock(stylesCss, '.chat-slash-menu')).toContain('border-radius: 8px;');
    expect(stylesCss).not.toContain('.chat-config-select {');
    expect(stylesCss).not.toContain('.chat-config-feedback {');
  });

  test('composer menu boolean setters only close their own menu', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    // Regression: the legacy boolean wrappers used to resolve `false` to
    // setChatComposerMenu(null), closing whatever menu happened to be open.
    // Per-keystroke schedulers then closed each other's menus, so the slash
    // popup vanished on the first typed character and reappeared on the next.
    expect(mainTsx).toContain('const chatComposerMenuRef = useRef(chatComposerMenu);');
    expect(mainTsx).toContain('chatComposerMenuRef.current = chatComposerMenu;');
    const ownMenuGuards = [
      ['setChatPromptMenuOpen', 'slash'],
      ['setChatFileMentionMenuOpen', 'file-mention'],
      ['setChatAttachmentTrayOpen', 'attachment-tray'],
      ['setChatContextUsageOpen', 'context-usage'],
      ['setChatCoreConfigMenuOpen', 'core-config'],
      ['setChatConfigOverflowOpen', 'config-overflow'],
    ] as const;
    for (const [setter, id] of ownMenuGuards) {
      const start = mainTsx.indexOf(`const ${setter} = useCallback(`);
      expect(start).toBeGreaterThanOrEqual(0);
      const body = mainTsx.slice(start, start + 900);
      expect(body).toContain(`{id: '${id}'}`);
      expect(body).toContain(`if (current.id === '${id}') {`);
      expect(body).not.toContain('? {id:');
    }
    const optionIdStart = mainTsx.indexOf('const setChatConfigMenuOptionId = useCallback(');
    expect(optionIdStart).toBeGreaterThanOrEqual(0);
    const optionIdBody = mainTsx.slice(optionIdStart, optionIdStart + 900);
    expect(optionIdBody).toContain("if (current.id === 'config-value') {");
    expect(optionIdBody).not.toContain(': null;');
  });

  test('keeps composer tools in the bottom row while send aligns with larger input text', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    const inputRowStart = mainTsx.indexOf('className="chat-composer-input-row"');
    const inputRowEnd = mainTsx.indexOf('{chatFileMentionMenuOpen ?', inputRowStart);
    expect(inputRowStart).toBeGreaterThanOrEqual(0);
    expect(inputRowEnd).toBeGreaterThan(inputRowStart);
    const inputRow = mainTsx.slice(inputRowStart, inputRowEnd);

    expect(inputRow).not.toContain('className="chat-composer-skill-trigger chat-slash-button"');
    expect(inputRow.indexOf('className="chat-composer-input-shell"')).toBeLessThan(inputRow.indexOf('className="chat-composer-action-column"'));
    expect(inputRow).toContain('className="chat-composer-action-column"');
    expect(inputRow).toContain('className="chat-send-button"');
    expect(inputRow).not.toContain('chat-composer-stop-trigger');
    expect(mainTsx).toContain('const resizeChatComposerTextarea = useCallback((options: {scrollToEnd?: boolean} = {}) => {');
    expect(mainTsx).toContain('chatRichComposerRef.current?.focus();');

    const toolsStart = mainTsx.indexOf('className="chat-composer-tools"');
    const toolsEnd = mainTsx.indexOf('className="chat-config-options-wrap"', toolsStart);
    const toolsBlock = mainTsx.slice(toolsStart, toolsEnd);
    expect(toolsBlock).toContain('className="chat-tool-button chat-slash-button"');
    expect(toolsBlock).toContain('onClick={openChatPromptMenu}');
    expect(toolsBlock).toContain('className="chat-tool-button chat-file-mention-trigger-button"');
    expect(toolsBlock).toContain('onClick={openChatFileMentionShortcut}');
    expect(toolsBlock.indexOf('chat-slash-button')).toBeLessThan(toolsBlock.indexOf('chat-attachment-plus-button'));
    expect(toolsBlock.indexOf('chat-slash-button')).toBeLessThan(toolsBlock.indexOf('chat-file-mention-trigger-button'));
    expect(toolsBlock.indexOf('chat-file-mention-trigger-button')).toBeLessThan(toolsBlock.indexOf('chat-attachment-plus-button'));
    expect(toolsBlock.indexOf('chat-attachment-plus-button')).toBeLessThan(toolsBlock.indexOf('chat-composer-stop-slot'));
    expect(toolsBlock.indexOf('chat-composer-stop-slot')).toBeLessThan(toolsBlock.indexOf('<ChatStopStatusPill'));
    expect(toolsBlock).not.toContain('!selectedChatPromptRunning ? (');

    const toolbarStart = mainTsx.indexOf('className="chat-composer-toolbar"');
    const toolbarToolsStart = mainTsx.indexOf('className="chat-composer-tools"', toolbarStart);
    const toolbarActionsStart = mainTsx.indexOf('className="chat-composer-toolbar-actions"', toolbarStart);
    const toolbarConfigStart = mainTsx.indexOf('className="chat-config-options-wrap"', toolbarActionsStart);
    expect(toolbarToolsStart).toBeGreaterThan(toolbarStart);
    expect(toolbarActionsStart).toBeGreaterThan(toolbarToolsStart);
    expect(toolbarConfigStart).toBeGreaterThan(toolbarActionsStart);

    expect(stylesCss).toMatch(/\.chat-composer-input-row \{[\s\S]*align-items: flex-end;[\s\S]*\}/);
    expect(stylesCss).not.toContain('.chat-composer-skill-trigger {');
    expect(stylesCss).toMatch(/\.chat-tool-button \{[\s\S]*width: 24px;[\s\S]*height: 24px;[\s\S]*\}/);
    expect(stylesCss).toMatch(/\.chat-composer-stop-slot \{[\s\S]*display: flex;[\s\S]*align-items: center;[\s\S]*\}/);
    expect(stylesCss).toContain('.chat-composer-toolbar-actions');
    expect(stylesCss).toMatch(/\.chat-composer-action-column \{[\s\S]*width: 36px;[\s\S]*height: 36px;[\s\S]*align-self: flex-end;[\s\S]*\}/);
    expect(stylesCss).toMatch(/\.chat-composer-toolbar \{[\s\S]*gap: 8px;[\s\S]*\}/);
    const stopPillCssBlock = stylesCss.match(/\.chat-stop-pill \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(stopPillCssBlock).not.toContain('position: absolute;');
    expect(stopPillCssBlock).toContain('height: 24px;');
    expect(stopPillCssBlock).toContain('border: 1px solid var(--border-subtle);');
    expect(stopPillCssBlock).toContain('border-radius: 999px;');
    expect(stopPillCssBlock).not.toContain('background: var(--state-danger);');
    const stopGlyphCssBlock = cssRuleBlock(stylesCss, '.chat-stop-pill-stop-glyph');
    expect(stopGlyphCssBlock).toContain('color: var(--state-danger);');
    expect(stylesCss).toMatch(/\.chat-main \{[\s\S]*gap: 0;[\s\S]*\}/);
  });

  test('keeps the rich composer focused for voice transcript text after max height', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('scrollToEnd?: boolean');
    expect(mainTsx).toContain('chatRichComposerRef.current?.focus();');
    expect(mainTsx).not.toContain('input.scrollTop = input.scrollHeight;');
    expect(mainTsx).toContain('resizeChatComposerTextarea({scrollToEnd: true})');
  });

  test('attaches files directly on desktop and keeps the File/Photo tray on mobile', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const chatImageInputRef = useRef<HTMLInputElement | null>(null);');
    expect(mainTsx).toContain('const chatAttachmentTrayRef = useRef<HTMLDivElement | null>(null);');
    expect(mainTsx).toContain('const chatAttachmentTrayButtonRef = useRef<HTMLButtonElement | null>(null);');
    expect(mainTsx).toContain('const closeChatAttachmentTray = useCallback(() => {');
    expect(mainTsx).toContain('setChatAttachmentTrayOpen(false);');
    expect(mainTsx).toContain('const handleChatImageChange = (');
    expect(mainTsx).toContain('accept="image/*"');
    expect(mainTsx).toContain('ref={chatImageInputRef}');
    expect(mainTsx).toContain('chatImageInputRef.current?.click();');
    expect(mainTsx).toContain('className="chat-attachment-action-button photo"');
    expect(mainTsx).toContain('aria-label="Attach photo"');
    expect(mainTsx).toContain('<ChatIcon name="camera" />');
    expect(mainTsx).toContain('closeChatAttachmentTray();');
    expect(mainTsx).toContain('if (target && chatAttachmentTrayRef.current?.contains(target))');
    expect(mainTsx).toContain('if (target && chatAttachmentTrayButtonRef.current?.contains(target))');
    expect(mainTsx).toContain('setChatAttachmentTrayOpen(false);');

    // Desktop: File and Photo open the same native dialog, so the paperclip
    // goes straight to the file picker and the tray only exists on mobile.
    const attachButtonStart = mainTsx.indexOf('className="chat-tool-button chat-attachment-plus-button"');
    expect(attachButtonStart).toBeGreaterThanOrEqual(0);
    const attachButtonBlock = mainTsx.slice(attachButtonStart, attachButtonStart + 1200);
    expect(attachButtonBlock).toContain('if (isWide) {');
    expect(attachButtonBlock).toContain('chatFileInputRef.current?.click();');
    expect(attachButtonBlock).toContain('toggleChatAttachmentTray();');
    expect(mainTsx).toContain('{!isWide && chatAttachmentTrayOpen ? (');
    expect(attachButtonBlock).not.toContain('if (selectedChatPromptRunning) return;');

    const imageHandlerStart = mainTsx.indexOf('const handleChatImageChange = (');
    const imageHandlerEnd = mainTsx.indexOf('const connect = async', imageHandlerStart);
    const imageHandler = mainTsx.slice(imageHandlerStart, imageHandlerEnd);
    expect(imageHandler).toContain('const files = chatFilesFromFileList(event.target.files);');
    expect(imageHandler).toContain('enqueueChatAttachmentFiles(files, attachmentDraftKey, attachmentDraftGeneration);');
    expect(imageHandler).toContain("event.target.value = '';");

    const toolsStart = mainTsx.indexOf('className="chat-composer-tools"');
    const toolsEnd = mainTsx.indexOf('className="chat-config-options-wrap"', toolsStart);
    const toolsBlock = mainTsx.slice(toolsStart, toolsEnd);
    expect(toolsBlock).toContain('chat-file-mention-trigger-button');
    expect(toolsBlock).toContain('chat-attachment-plus-button');
    expect(toolsBlock).not.toContain('chat-attachment-action-button code');
    expect(toolsBlock).toContain('chat-attachment-action-button file');
    expect(toolsBlock).toContain('chat-attachment-action-button photo');
    expect(toolsBlock).toContain('<ChatIcon name="paperclip" />');
    expect(toolsBlock).toContain('<ChatIcon name="paperclip" />');
    expect(toolsBlock).toContain('<ChatIcon name="camera" />');
    expect(toolsBlock).not.toContain('codicon-cloud-upload');
    expect(toolsBlock).not.toContain('codicon-new-file');

    expect(stylesCss).toMatch(
      /\.chat-attach-button \{[\s\S]*color: color-mix\(in srgb, var\(--state-info\) 78%, var\(--text-primary\)\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-image-attach-button \{[\s\S]*color: color-mix\(in srgb, var\(--state-warning\) 78%, var\(--text-primary\)\);[\s\S]*\}/,
    );
  });

  test('uses mobile Enter as send while keeping modified Enter and IME composition from sending', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain("enterKeyHint={isWide ? undefined : mobileEnterKeyBehavior === 'send' ? 'send' : 'enter'}");
    expect(mainTsx).toContain("const shouldSendChatOnEnter = event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing;");
    expect(mainTsx).toContain("const mobileEnterShouldSend = !isWide && mobileEnterKeyBehavior === 'send';");
    expect(mainTsx).toContain('if (isWide || mobileEnterShouldSend) {');
    expect(mainTsx).toContain('if (!shouldSendChatOnEnter) {');
    expect(mainTsx).toContain('event.preventDefault();');
    expect(mainTsx).toContain('sendChatMessage().catch(() => undefined);');
  });

  test('keeps the mobile drawer wide while preserving floating control clicks and backdrop dismissal', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);

    const backdropLayer = cssNumericProperty(stylesCss, '.drawer-overlay', 'z-index');
    const drawerLayer = cssNumericProperty(stylesCss, '.drawer', 'z-index');
    const floatingLayer = cssNumericProperty(stylesCss, '.floating-control-stack-layer', 'z-index');
    const mobileSettingsLayer = cssNumericProperty(stylesCss, '.mobile-settings-screen', 'z-index');

    expect(backdropLayer).toBeLessThan(floatingLayer);
    expect(drawerLayer).toBeLessThan(floatingLayer);
    expect(mobileSettingsLayer).toBeLessThan(floatingLayer);
    expect(stylesCss).toContain('--mobile-floating-control-lane: 60px;');
    expect(stylesCss).toMatch(
      /\.drawer-overlay \{[\s\S]*inset: 0;[\s\S]*z-index: 43;[\s\S]*\}/,
    );
    expect(stylesCss).not.toMatch(
      /\.drawer-overlay \{[\s\S]*right: var\(--mobile-floating-control-lane\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.drawer \{[\s\S]*position: fixed;[\s\S]*width: min\(440px, calc\(100vw - var\(--mobile-floating-control-lane\) - env\(safe-area-inset-right, 0px\)\)\);[\s\S]*z-index: 50;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.narrow-shell\[data-floating-control-side='left'\] \.drawer \{[\s\S]*inset: 0 0 0 auto;[\s\S]*width: min\(440px, calc\(100vw - var\(--mobile-floating-control-lane\) - env\(safe-area-inset-left, 0px\)\)\);[\s\S]*border-left: 1px solid var\(--border-subtle\);[\s\S]*transform: translateX\(100%\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.narrow-shell\[data-floating-control-side='left'\] \.drawer\.show \{[\s\S]*transform: translateX\(0\);[\s\S]*box-shadow: -8px 0 28px rgba\(0, 0, 0, 0\.38\);[\s\S]*\}/,
    );
    expect(stylesCss).not.toContain(".floating-control-stack-layer[data-side-pulse='left'] ~ .drawer:not(.show)");
  });

  test('keeps the desktop session mark palette compact and aligned with action rows', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const pickerBlock = cssRuleBlock(stylesCss, '.project-session-mark-picker');
    const optionBlock = cssRuleBlock(stylesCss, '.project-session-mark-option');
    const bodyBlock = cssRuleBlock(stylesCss, '.session-menu-body');

    expect(pickerBlock).toContain('justify-content: flex-start;');
    expect(pickerBlock).toContain('min-height: 32px;');
    expect(pickerBlock).toContain('padding: 0 6px 4px 1px;');
    expect(optionBlock).toContain('width: 28px;');
    expect(optionBlock).toContain('height: 28px;');
    expect(bodyBlock).toContain('gap: 0;');
    expect(bodyBlock).toContain('padding-bottom: 2px;');
  });

  test('wires speech input settings and composer voice controls through split modules', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const settingsRootTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("import {VoiceInputButton, type VoiceInputInteractionMode} from '../features/speech/VoiceInputButton';");
    expect(mainTsx).toContain("import {VoiceRecordingBar} from '../features/speech/VoiceRecordingBar';");
    expect(mainTsx).toContain("formatVoiceInputDiagnosticError,");
    expect(mainTsx).toContain("logVoiceInputDiagnostic,");
    expect(mainTsx).toMatch(/import \{[\s\S]*?DEFAULT_SERVER_SETTINGS,[\s\S]*?\} from '\.\.\/settings\/serverSettings';/);
    expect(settingsRootTsx).toContain('SPEECH_MODEL_OPTIONS');
    expect(mainTsx).toContain('const [serverSettings, setServerSettings] = useState<ServerSettings>(DEFAULT_SERVER_SETTINGS);');
    expect(mainTsx).not.toContain('workspaceStore.rememberGlobalState({ speechSettings });');
    const chatStart = settingsRootTsx.indexOf('<SettingsSection id="chat"');
    const codeStart = settingsRootTsx.indexOf('<SettingsSection id="code"', chatStart);
    expect(chatStart).toBeGreaterThanOrEqual(0);
    expect(codeStart).toBeGreaterThan(chatStart);
    const chatSection = settingsRootTsx.slice(chatStart, codeStart);
    expect(chatSection).toContain('settings-subsection-title">Voice Input');
    expect(chatSection).toContain('settings-subsection-title">Speech');
    expect(chatSection.indexOf('settings-subsection-title">Voice Input')).toBeLessThan(
      chatSection.indexOf('settings-subsection-title">Speech'),
    );
    expect(chatSection).toContain('label="Key"');
    expect(chatSection).toContain('label="Model"');
    expect(chatSection).toContain('label="Voice"');
    expect(chatSection).not.toContain('type="password"');
    expect(chatSection).not.toContain('API Key');
    expect(chatSection).not.toContain('Volcengine API Key');
    expect(settingsRootTsx).toContain('SecretEditor');
    const secretEditorTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'common', 'SecretEditor.tsx'));
    expect(secretEditorTsx).toContain('type="password"');
    expect(chatSection).not.toContain("setSettingsDetailView('voiceInput')");
    expect(settingsRootTsx).toContain('Doubao Streaming ASR 2.0');
    expect(settingsRootTsx).not.toContain('speechSettings.enabled ? (');
    expect(mainTsx).toContain('const voiceInputEnabled = serverSettings.voiceInput.configured;');
    expect(mainTsx).toContain('const chatComposerHasSendableContent = chatComposerHasSendableTokens(chatComposerTokens) || chatAttachments.length > 0;');
    expect(mainTsx).toContain('const [voiceCancelIntent, setVoiceCancelIntent] = useState(false);');
    expect(mainTsx).toContain('<VoiceInputButton');
    expect(mainTsx).toContain('recordingMode={voiceInteractionMode}');
    expect(mainTsx).toContain('hasSendableContent={chatComposerHasSendableContent}');
    expect(mainTsx).toContain('onSend={() => sendChatMessage().catch(() => undefined)}');
    expect(mainTsx).toContain('onStart={startVoiceInput}');
    expect(mainTsx).toContain('onFinish={finishVoiceInput}');
    expect(mainTsx).toContain('onCancel={cancelVoiceInputByGesture}');
    expect(mainTsx).toContain('onModeChange={setVoiceInputInteractionMode}');
    expect(mainTsx).toContain('onCancelIntentChange={setVoiceCancelIntent}');
    expect(mainTsx).toContain('onLog={logVoiceInputButtonEvent}');
    expect(mainTsx).toContain("logVoiceInputDiagnostic('debug', 'start_requested'");
    expect(mainTsx).toContain("logVoiceInputDiagnostic('error', 'start_failed'");
    expect(mainTsx).toContain("logVoiceInputDiagnostic('error', 'chunk_send_failed'");
    expect(mainTsx).toContain('readOnly={selectedChatSubmitPending}');
    expect(mainTsx).toContain('if (voiceRecordingRef.current) {');
    expect(mainTsx).toContain('voiceRecording ? (');
    expect(mainTsx).toContain('<VoiceRecordingBar');
    expect(mainTsx).toContain('cancelIntent={voiceCancelIntent}');

    expect(stylesCss).toContain('.voice-input-button');
    expect(stylesCss).toContain('.voice-input-button.send-with-voice');
    expect(stylesCss).toContain('.voice-input-badge');
    expect(stylesCss).toContain('.voice-input-button.locked-recording');
    expect(stylesCss).toContain('.voice-input-button.hold-recording');
    expect(stylesCss).toContain('.voice-input-button.cancel-intent');
    expect(stylesCss).toContain('.voice-recording-bar.cancel-intent');
    expect(stylesCss).toContain('.voice-recording-bar.cancel-intent .voice-recording-dot');
    expect(stylesCss).toContain('.settings-section-rows .secret-compact-row');
    expect(stylesCss).toContain('.voice-recording-bar');
    expect(stylesCss).toContain('@keyframes voiceBarPulse');
  });

  test('keeps the mobile floating control translucent without idle dimming', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).not.toContain('FLOATING_CONTROL_IDLE_DELAY_MS');
    expect(mainTsx).not.toContain('setFloatingControlsIdle');
    expect(mainTsx).not.toContain('floatingControlIdleOpacity');
    expect(mainTsx).not.toContain('floatingControlsIdleBlocked');
    expect(mainTsx).not.toContain('wakeFloatingControls');
    expect(mainTsx).not.toContain('floatingControlsIdle');
    expect(mainTsx).not.toContain('data-idle=');
    expect(mainTsx).not.toContain("'--floating-control-idle-opacity'");
    expect(mainTsx).not.toContain('onPointerDownCapture={wakeFloatingControls}');
    expect(mainTsx).not.toContain('data-backdrop-tone=');
    expect(mainTsx).not.toContain('requestFloatingBackdropToneMeasure');
    expect(mainTsx).not.toContain('FLOATING_BACKDROP_TONE_THROTTLE_MS');
    expect(mainTsx).toContain('const floatingPositionSnapshotRef = useRef');
    expect(mainTsx).toContain('resolveFloatingControlYRatioForBoundsChange({');
    expect(mainTsx).toContain('previousTop: previousFloatingPosition.top');
    expect(mainTsx).not.toContain('hasDefaultComposerTop');
    expect(mainTsx).toContain('const [floatingDefaultComposerTop, setFloatingDefaultComposerTop] = useState<number | null>(null);');
    expect(mainTsx).toContain('resolveFloatingControlDefaultBounds({');
    expect(mainTsx).toContain('resolveFloatingControlAvoidanceBounds({');
    expect(mainTsx).toContain('const floatingBounds = floatingAvoidanceBounds;');
    expect(mainTsx).toContain('floatingBaseBounds.minTop');
    expect(mainTsx).toContain('floatingBaseBounds.maxTop');
    expect(mainTsx).not.toContain('const keyboardShift = Math.min(');
    expect(stylesCss).not.toContain('.floating-nav-group');
    expect(stylesCss).not.toContain('.drawer-toggle-bubble');
    expect(stylesCss).not.toContain('[data-backdrop-tone');
    expect(stylesCss).not.toContain("data-idle='true'");
    expect(stylesCss).toContain('.floating-nav-button');
    expect(stylesCss).not.toContain('.port-relay-floating-bubble');
  });

  test('allows a wider vertical drag range for the mobile floating controls', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(stylesCss).toContain('--wm-safe-area-bottom: env(safe-area-inset-bottom, 0px);');
    expect(mainTsx).toContain('const chatComposerRef = useRef<HTMLDivElement | null>(null);');
    expect(mainTsx).toContain('const [chatComposerTop, setChatComposerTop] = useState<number | null>(null);');
    expect(mainTsx).toContain('const measureChatComposerTop = useCallback(() => {');
    expect(mainTsx).toContain('ref={chatComposerRef}');
    expect(mainTsx).toContain('function readSafeAreaBottomInset(): number {');
    expect(mainTsx).toContain('const [safeAreaBottomInset, setSafeAreaBottomInset] = useState<number>(() => readSafeAreaBottomInset());');
    expect(mainTsx).toContain('setSafeAreaBottomInset(readSafeAreaBottomInset());');
    expect(mainTsx).toContain('defaultComposerTop: floatingDefaultComposerTop');
    expect(mainTsx).toContain('keyboardOffset: floatingKeyboardOffset');
    expect(mainTsx).toContain('composerTop: chatComposerTop');
    expect(mainTsx).toContain('floatingControlSide,');
  });

  test('mobile chat drawer uses a cross-project project session sheet', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const projectSectionTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'ProjectSection.tsx'));
    const listViewTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionListView.tsx'));
    const settingsRootPath = path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx');
    const settingsRootTsx = fs.existsSync(settingsRootPath) ? readSourceText(settingsRootPath) : '';
    const settingsBundlePath = path.join(projectRoot, 'web', 'src', 'settings', 'SettingsBundle.ts');
    const settingsBundleTs = fs.existsSync(settingsBundlePath) ? readSourceText(settingsBundlePath) : '';
    const fileSurfaceTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'file', 'FileExplorerTree.tsx'));
    const sidebarSurfaceSource = `${mainTsx}\n${fileSurfaceTsx}`;
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('type SettingsDetailView = SettingsDetail | null;');
    expect(mainTsx).toContain('const [settingsDetailView, setSettingsDetailView] = useState<SettingsDetailView>(null);');
    expect(mainTsx).toContain('const [mobileProjectActionMenu, setMobileProjectActionMenu, mobileProjectActionMenuExiting] = useMenuExitState<MobileProjectActionMenuState>();');
    expect(mainTsx).toContain('const refreshMobileChatProjectSessions = async () => {');
    expect(mainTsx).toContain('await refreshChatIndex();');
    expect(mainTsx).toContain('chatIndexProjectRefreshTargets(');
    expect(mainTsx).toContain('options?.skipProjectId,');
    expect(mainTsx).toContain('refreshChatProjectSessions(projectId, {force: options?.force === true})');
    expect(mainTsx).toContain('const renderMobileChatSessionSheet = () => {');
    expect(mainTsx).toContain('const renderChatSessionHeader = (mobile: boolean) => {');
    expect(mainTsx).toContain('{renderChatSessionHeader(true)}');
    expect(mainTsx).not.toContain('className={`mobile-chat-drawer-header${sessionSearchHeaderExpanded ? \' search-open\' : \'\'}`}');
    expect(mainTsx).not.toContain('<div className="mobile-chat-toolbar" aria-label="Chat tools">');
    expect(mainTsx).not.toContain('<span className="mobile-chat-drawer-title">Chats</span>');
    expect(mainTsx).toContain('className="mobile-project-session-nav"');
    expect(mainTsx).toContain('mobile-project-sheet${mobileProjectActionMenuExiting');
    expect(projectSectionTsx).toContain('className="mobile-project-session-error"');
    expect(mainTsx).toContain('const mobileSidebarMain = !isWide ? renderMobileChatSessionSheet() : null;');
    expect(mainTsx).not.toContain("if (detail === 'tokenStats') {");
    expect(mainTsx).not.toContain('renderTokenStatsSettingsDetail(options)');
    expect(mainTsx).toContain("const loadSettingsBundle = () => import(/* webpackChunkName: \"settings\" */ '../settings/SettingsBundle')");
    expect(mainTsx).toContain('const SettingsRootContent = React.lazy(() => loadSettingsBundle().then(module => ({');
    expect(mainTsx).toContain('<SettingsRootContent');
    expect(settingsRootTsx).toContain('export function SettingsRootContent');
    expect(settingsBundleTs).toContain("export { SettingsRootContent } from './SettingsRootContent';");
    expect(settingsBundleTs).toContain("export { DatabaseSettingsDetail } from './DatabaseSettingsDetail';");
    expect(settingsBundleTs).not.toContain('UpdateSettingsDetail');
    expect(settingsBundleTs).toContain("export { DebugLogsSettingsDetail } from './DebugLogsSettingsDetail';");
    expect(settingsRootTsx).toContain('function SettingsSection');
    expect(settingsRootTsx).not.toContain("renderSettingsSection({id: 'appearance'");
    expect(settingsRootTsx).not.toContain('Inactive Visibility');
    expect(settingsRootTsx).not.toContain('floatingControlIdleOpacityPercent');
    expect(settingsRootTsx).not.toContain('setFloatingControlIdleOpacity');
    expect(settingsRootTsx).toContain('<SettingsSection id="chat"');
    expect(settingsRootTsx).toContain('<SettingsSection id="code"');
    expect(settingsRootTsx).toContain('<SettingsSection id="state"');
    expect(settingsRootTsx).toContain('<SettingsSection id="debug"');
    expect(settingsRootTsx).not.toContain("renderSettingsSection('More'");
    const chatSettingsIndex = settingsRootTsx.indexOf('<SettingsSection id="chat"');
    const codeDisplaySettingsIndex = settingsRootTsx.indexOf('<SettingsSection id="code"');
    const stateSettingsIndex = settingsRootTsx.indexOf('<SettingsSection id="state"');
    const debugSettingsIndex = settingsRootTsx.indexOf('<SettingsSection id="debug"');
    expect(chatSettingsIndex).toBeLessThan(codeDisplaySettingsIndex);
    expect(codeDisplaySettingsIndex).toBeLessThan(stateSettingsIndex);
    expect(stateSettingsIndex).toBeLessThan(debugSettingsIndex);
    expect(settingsRootTsx).toContain("openSettingsDetail('database')");
    expect(mainTsx).toContain("detail === 'database'");
    expect(mainTsx).toContain('renderDatabaseSettingsDetail()');
    expect(settingsRootTsx).toContain('className="settings-section-title"');
    expect(settingsRootTsx).toContain('settings-detail-row');
    expect(mainTsx).not.toContain('data-tooltip="Token stats"');
    expect(mainTsx).not.toContain('data-tooltip="Agent info"');
    expect(mainTsx).not.toContain('className="chat-session-swipe-row');

    const mobileSheetStart = mainTsx.indexOf('const renderMobileChatSessionSheet = () => {');
    const mobileSheetEnd = mainTsx.indexOf('const renderSidebar = () => {', mobileSheetStart);
    expect(mobileSheetStart).toBeGreaterThanOrEqual(0);
    expect(mobileSheetEnd).toBeGreaterThan(mobileSheetStart);
    const mobileSheet = mainTsx.slice(mobileSheetStart, mobileSheetEnd);
    expect(mobileSheet).not.toContain("openSettingsDetail('portRelay')");
    expect(mobileSheet).not.toContain("openSettingsDetail('update')");
    expect(mobileSheet).not.toContain('className="project-wrap"');
    expect(listViewTsx).toContain('split.visibleSessions.map(session => renderRow(projectId, session, false))');
    expect(mainTsx).toContain('const projectSessionActionMenuOverlay = renderProjectSessionActionMenu();');
    expect(listViewTsx).toContain('gestureHandlers={searchMode ? undefined : bindSessionContextMenu({projectId, sessionId: session.sessionId})}');
    expect(mobileSheet).not.toContain('chat-session-swipe-row');
    expect(mainTsx).toContain("tagVariantClass('wide-project-hub', section.projectHubId || 'local')");
    expect(mainTsx).toContain('<AgentTag agentType={sessionAgent} />');

    expect(stylesCss).toContain('.chat-session-header.mobile {');
    expect(stylesCss).not.toContain('.mobile-chat-drawer-header');
    expect(stylesCss).toContain('.mobile-project-session-nav {');
    expect(stylesCss).toContain('.mobile-project-sheet {');
    expect(stylesCss).toContain('.mobile-project-session-error {');
    expect(stylesCss).not.toContain('.settings-detail-header');
    expect(stylesCss).toContain('.settings-detail-row {');
    expect(stylesCss).toContain('.settings-section-title {');
    expect(stylesCss).toContain('.settings-row {');
    expect(stylesCss).toContain('.settings-range-row {');
    expect(stylesCss).toContain('.settings-range-control {');
    expect(stylesCss).toContain('.settings-range-value {');
    expect(stylesCss).toContain('.settings-danger-row {');
    expect(stylesCss).toContain('.settings-metadata-list {');
    expect(stylesCss).toContain('.settings-database-dump {');
  });

  test('centers the shared mobile sheet grip without relying on a flex parent', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const gripBlock = cssRuleBlock(stylesCss, '.mobile-project-sheet-grip');

    expect(gripBlock).toContain('margin: 2px auto 4px;');
    expect(gripBlock).not.toContain('margin: 2px 0 4px;');
  });

  test('drawer session rails use slim flush scrollbars without reserved right gutter', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const railSelectors = [
      '.workspace-left .sidebar-scroll',
      '.drawer .sidebar-scroll',
      '.wide-project-session-nav',
      '.mobile-project-session-nav',
    ];

    for (const selector of railSelectors) {
      const railBlock = cssRuleBlockContainingSelector(stylesCss, selector);
      expect(railBlock).toContain('scrollbar-gutter: auto;');
      expect(railBlock).toContain('scrollbar-width: thin;');

      const scrollbarBlock = cssRuleBlockContainingSelector(stylesCss, `${selector}::-webkit-scrollbar`);
      expect(scrollbarBlock).toContain('width: 3px;');

      const buttonBlock = cssRuleBlockContainingSelector(stylesCss, `${selector}::-webkit-scrollbar-button`);
      expect(buttonBlock).toContain('display: none;');
      expect(buttonBlock).toContain('width: 0;');
      expect(buttonBlock).toContain('height: 0;');

      const thumbBlock = cssRuleBlockContainingSelector(stylesCss, `${selector}::-webkit-scrollbar-thumb`);
      expect(thumbBlock).toContain('border-left: 1px solid transparent;');
      expect(thumbBlock).toContain('border-right: 0;');
      expect(thumbBlock).not.toContain('border: 2px solid transparent;');

      const trackBlock = cssRuleBlockContainingSelector(stylesCss, `${selector}::-webkit-scrollbar-track`);
      expect(trackBlock).toContain('background: transparent;');
    }
  });

  test('desktop session rows keep context menus without rendering a hover more-action', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('onOpenSessionContextMenu: openProjectSessionContextMenu');
    expect(mainTsx).not.toContain('wide-session-more-btn');
    expect(stylesCss).not.toContain('.wide-session-more-btn');
  });

  test('session pin actions use the shared menu and an independent trailing button', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const sessionMenuTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionMenu.tsx'));
    const sessionRowTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionRow.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("const [chatPinningSessionKey, setChatPinningSessionKey] = useState('');");
    expect(mainTsx).toContain('service.pinProjectSession(targetProjectId, normalizedSessionId, pinned)');
    expect(sessionMenuTsx).toContain("className: 'pin'");
    expect(sessionMenuTsx).toContain("pinned ? 'Unpin' : 'Pin'");
    expect(sessionRowTsx).toContain('className="wide-session-pin-btn"');
    expect(sessionRowTsx).toContain('aria-pressed={true}');
    expect(mainTsx).toContain('handlePinProjectSession(targetProjectId, sessionId, false)');
    expect(mainTsx).toContain("setChatPinningSessionKey(current => current === actionKey ? '' : current)");
    expect(stylesCss).toContain('.wide-session-pin-btn');

    const pinButtonBlock = stylesCss.match(/\.wide-session-pin-btn \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(pinButtonBlock).toContain('color: var(--accent-primary);');
    expect(pinButtonBlock).toContain('place-items: center;');

    const wrapBlock = stylesCss.match(/\.project-session-row-wrap \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wrapBlock).toContain('display: flex;');
    expect(stylesCss).not.toContain('.mobile-session-row + .wide-session-pin-btn');

    const pinHandlerStart = mainTsx.indexOf('const handlePinProjectSession = async (');
    const pinHandlerEnd = mainTsx.indexOf('const handleRenameProjectSession = async', pinHandlerStart);
    const pinHandler = mainTsx.slice(pinHandlerStart, pinHandlerEnd);
    expect(pinHandler).toContain('rememberChatSessionSummary(targetProjectId, result.session);');
    expect(pinHandler).not.toContain('pinned: pinned');
    expect(pinHandler.indexOf('await service.pinProjectSession')).toBeLessThan(
      pinHandler.indexOf('rememberChatSessionSummary'),
    );
  });

  test('session mark actions use a shared palette and a layout-neutral trailing marker', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const sessionMenuTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionMenu.tsx'));
    const sessionListViewTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionListView.tsx'));
    const sessionRowTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionRow.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("const [chatMarkingSessionKey, setChatMarkingSessionKey] = useState('');");
    expect(mainTsx).toContain('service.markProjectSession(targetProjectId, normalizedSessionId, markColor)');
    expect(mainTsx).toContain('markColor={session.markColor}');
    expect(mainTsx).toContain('marking={chatMarkingSessionKey === actionKey}');
    expect(mainTsx).toContain('preferredWidth: 224');
    expect(mainTsx).toContain('preferredMaxHeight: 320');
    expect(sessionMenuTsx).toContain('project-session-mark-picker');
    expect(sessionMenuTsx).toContain('name="eraser"');
    expect(sessionListViewTsx).toContain('markColor={session.markColor}');
    expect(sessionRowTsx).toContain('wide-session-mark');

    const markBlock = stylesCss.match(/\.wide-session-mark \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(markBlock).toContain('position: absolute;');
    expect(markBlock).toContain('right: 1px;');
    expect(markBlock).toContain('pointer-events: none;');
    expect(markBlock).not.toContain('margin:');
    expect(markBlock).not.toContain('padding:');
    expect(markBlock).not.toContain('flex:');
  });

  test('session rows show the state dot in the leading gutter outside the selected frame', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).not.toContain('session-state-unread');
    expect(mainTsx).not.toContain('renderDraftSessionStateMarker');
    expect(mainTsx).not.toContain('session-older-spacer');
    expect(mainTsx).not.toContain('renderSessionTrailing(');
    expect(mainTsx).toContain('renderSessionLeadingState(');
    expect(mainTsx).toContain('session-state-leading');
    expect(mainTsx).toContain('<SessionIcon name="loader" size={12} spin />');
    expect(stylesCss).toContain('.session-state-leading.running {');
    expect(stylesCss).toContain('.session-state-leading.completed-unviewed .session-state-dot');
    expect(stylesCss).toContain('.session-state-leading.failed-unviewed .session-state-dot');
    expect(stylesCss).toContain('@keyframes session-state-breathe');
    expect(stylesCss).not.toContain('.session-state-unread');
    expect(stylesCss).not.toContain('.session-state-trailing');
    expect(stylesCss).not.toContain('.session-older-spacer');
    expect(stylesCss).toContain('.wide-session-row.selected');
  });

  test('project headers expose an explicit pin action alongside new/resume', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const projectSectionTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'ProjectSection.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(projectSectionTsx).toContain('wide-project-action-btn wide-project-pin-btn');
    expect(projectSectionTsx).toContain('aria-pressed={pinned}');
    expect(mainTsx).toContain('onTogglePinnedProject: togglePinnedProject');
    expect(stylesCss).toContain('.wide-project-pin-btn.active');
    expect(stylesCss).toContain('color: var(--accent-primary);');
  });

  test('wide layout uses a project session rail and keeps the project picker in the desktop address segment', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const appDialogsTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'shell', 'AppDialogs.tsx'));
    const projectSectionTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'ProjectSection.tsx'));
    const listViewTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionListView.tsx'));
    const sessionMenuTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'SessionMenu.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).not.toContain('WIDE_PROJECT_SESSION_LIMIT');
    expect(mainTsx).not.toContain('const PROJECT_PIN_LONG_PRESS_MS = 450;');
    expect(mainTsx).toContain('function tagVariantClass(prefix: string, value: string): string {');
    expect(mainTsx).toContain('const sortedProjectItems = useMemo(() => sortProjectsByPin(projects, pinnedProjectIds), [projects, pinnedProjectIds]);');
    expect(mainTsx).toContain('const togglePinnedProject = useCallback(');
    expect(mainTsx).not.toContain('const startProjectPinLongPress = useCallback(');
    expect(mainTsx).toContain('const openProjectContextMenu = useCallback(');
    expect(mainTsx).toContain("kind: 'new' | 'resume' | 'actions';");
    expect(mainTsx).toContain("phase: 'agents' | 'sessions' | 'actions';");
    expect(mainTsx).not.toContain('const consumeProjectPinLongPressClick = useCallback(');
    expect(mainTsx).toContain('const renderWideProjectSessionNav = (options?: { includeRecent?: boolean }) => {');
    expect(mainTsx).toContain('className="wide-project-session-nav"');
    expect(projectSectionTsx).toContain('className="wide-project-title-group"');
    expect(projectSectionTsx).toContain("collapsed ? 'folder' : 'folderOpen'");
    expect(projectSectionTsx).toContain('wide-project-pin-badge');
    expect(listViewTsx).toContain('useContextMenuTargetGesture');
    expect(mainTsx).toContain('onOpenProjectContextMenu: openProjectContextMenu');
    expect(mainTsx).toContain("tagVariantClass('wide-project-hub', hubId)");
    expect(projectSectionTsx).toContain('className="wide-project-hub-dot"');
    expect(projectSectionTsx).toContain('className="wide-project-hub-label"');
    expect(projectSectionTsx).toContain('wide-project-session-list');
    expect(projectSectionTsx).toContain('wide-project-action-btn sl-action-primary');
    expect(mainTsx).toContain('wide-project-action-popover sl-session-list-popover${wideProjectActionMenuExiting');
    expect(mainTsx).toContain("import {resolveWideProjectActionPopoverPlacement");
    expect(mainTsx).toContain('style={actionMenu.popover');
    expect(mainTsx).toContain('className="wide-project-action-title"');
    expect(mainTsx).toContain("actionMenu.kind === 'actions'");
    const wideProjectActionsStart = mainTsx.indexOf("actionMenu.kind === 'actions' ? (");
    const wideProjectActionsEnd = mainTsx.indexOf(") : actionMenu.phase === 'agents' ? (", wideProjectActionsStart);
    expect(wideProjectActionsStart).toBeGreaterThanOrEqual(0);
    expect(wideProjectActionsEnd).toBeGreaterThan(wideProjectActionsStart);
    const wideProjectActionsBlock = mainTsx.slice(wideProjectActionsStart, wideProjectActionsEnd);
    expect(wideProjectActionsBlock).toContain('Resume session');
    expect(wideProjectActionsBlock).toContain('Pin Project');
    expect(wideProjectActionsBlock).not.toContain('New Session');
    expect(listViewTsx).toContain("const agent = (session.agentType || '').trim();");
    expect(mainTsx).toContain('<AgentTag agentType={sessionAgent} />');
    expect(mainTsx).toContain('const [projectSessionActionMenu, setProjectSessionActionMenu, projectSessionActionMenuExiting] = useMenuExitState<ProjectSessionActionMenuState>();');
    expect(mainTsx).toContain('popover?: WideProjectActionPopoverPlacement | null;');
    expect(mainTsx).not.toContain('const PROJECT_SESSION_LONG_PRESS_MS = 450;');
    expect(mainTsx).not.toContain('projectSessionLongPressTimerRef');
    expect(mainTsx).not.toContain('projectPinLongPressTimerRef');
    expect(mainTsx).toContain('onOpenSessionContextMenu: openProjectSessionContextMenu');
    expect(mainTsx).toContain('const handleDeleteProjectSession = async (targetProjectId: string, sessionId: string) => {');
    expect(mainTsx).toContain('const result = await service.deleteProjectSession(targetProjectId, normalizedSessionId);');
    expect(mainTsx).toContain('const handleReloadProjectSession = async (targetProjectId: string, sessionId: string) => {');
    expect(mainTsx).toContain('const result = await service.reloadProjectSession(targetProjectId, normalizedSessionId);');
    expect(mainTsx).toContain("} from '../shell/AppDialogs';");
    expect(appDialogsTsx).toContain('export type ConfirmTarget =');
    expect(appDialogsTsx).toContain('export type RenameSessionTarget =');
    expect(mainTsx).toContain('const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);');
    expect(mainTsx).toContain("const [confirmError, setConfirmError] = useState('');");
    expect(mainTsx).toContain('const handleArchiveProjectSession = async (targetProjectId: string, sessionId: string) => {');
    expect(mainTsx).toContain('const result = await service.archiveProjectSession(targetProjectId, normalizedSessionId);');
    expect(mainTsx).toContain('const handleRenameProjectSession = async (targetProjectId: string, sessionId: string, title: string) => {');
    expect(mainTsx).toContain('const result = await service.renameProjectSession(targetProjectId, normalizedSessionId, normalizedTitle);');
    expect(appDialogsTsx).toContain('className="app-rename-input"');
    expect(appDialogsTsx).toContain('maxLength={200}');
    expect(mainTsx).toContain("event.key !== 'F2'");
    expect(mainTsx).toContain('event.isComposing');
    expect(mainTsx).toContain('if (!isWide || sidebarSettingsOpen || !selectedChatKey || !selectedChatSession || renameTarget || confirmTarget) {');
    expect(mainTsx).toContain('requestRenameProjectSession(selectedChatKey.projectId, selectedChatSession);');
    expect(mainTsx).toContain('const message = err instanceof Error ? err.message : String(err);');
    expect(mainTsx).toContain('setConfirmError(message);');
    expect(mainTsx).not.toContain('const appConfirmDialog = confirmTarget ? (');
    expect(mainTsx).toContain('<AppConfirmDialog');
    expect(mainTsx).toContain('<AppRenameDialog');
    expect(appDialogsTsx).toContain('className="app-confirm-backdrop"');
    expect(appDialogsTsx).toContain('Archived sessions leave the chat list.');
    expect(appDialogsTsx).toContain('This permanently deletes the session data from the Hub.');
    expect(mainTsx).toContain("kind: 'delete'");
    expect(appDialogsTsx).toContain('className="app-confirm-error"');
    expect(mainTsx).not.toContain('Sessions with fewer than 3 turns are permanently removed.');
    const confirmDialogStart = appDialogsTsx.indexOf('export function AppConfirmDialog');
    const confirmDialogEnd = appDialogsTsx.indexOf('export function AppRenameDialog', confirmDialogStart);
    expect(confirmDialogStart).toBeGreaterThanOrEqual(0);
    expect(confirmDialogEnd).toBeGreaterThan(confirmDialogStart);
    const confirmDialog = appDialogsTsx.slice(confirmDialogStart, confirmDialogEnd);
    expect(confirmDialog).not.toContain('{archiveTarget ? (');
    expect(confirmDialog).not.toContain('projectId: archiveTarget.projectId');
    expect(mainTsx).toContain('const renderProjectSessionActionMenu = () => {');
    expect(mainTsx).not.toContain('className="project-session-more-btn"');
    expect(mainTsx).not.toContain('const openProjectSessionActionMenu = (');
    expect(sessionMenuTsx).toContain('project-session-action-menu');
    expect(mainTsx).toContain('popoverStyle={!sheet && projectSessionActionMenu.popover');
    expect(mainTsx).toContain("projectSessionActionMenu.popover.placement === 'above'");
    expect(mainTsx).toContain("'--sl-popover-shift': 'translateY(-100%)'");
    expect(mainTsx).toContain('anchorRect: {');
    expect(mainTsx).toContain('left: position.x,');
    expect(mainTsx).toContain('top: position.y,');
    expect(mainTsx).toContain('bottom: position.y,');
    expect(mainTsx).toContain('right: position.x,');
    expect(mainTsx).toContain("align: 'start',");
    expect(mainTsx).toContain('const sessionActionDisabled = !!session.running ||');
    expect(mainTsx).toContain('const renameActionDisabled = chatRenamingSessionId === sessionId;');
    expect(sessionMenuTsx).toContain("className: 'reload'");
    expect(sessionMenuTsx).toContain("className: 'pin'");
    expect(sessionMenuTsx).toContain("className: 'rename'");
    expect(sessionMenuTsx).toContain("className: 'archive'");
    expect(sessionMenuTsx).toContain("className: 'delete'");
    expect(sessionMenuTsx).toContain("label: 'Reload'");
    expect(sessionMenuTsx).toContain("label: 'Rename'");
    expect(sessionMenuTsx).toContain("label: 'Archive'");
    expect(sessionMenuTsx).toContain("label: 'Delete'");
    const renameMenuIndex = sessionMenuTsx.indexOf("label: 'Rename'");
    const archiveMenuIndex = sessionMenuTsx.indexOf("label: 'Archive'");
    const reloadMenuIndex = sessionMenuTsx.indexOf("label: 'Reload'");
    const deleteMenuIndex = sessionMenuTsx.indexOf("label: 'Delete'");
    expect(renameMenuIndex).toBeGreaterThanOrEqual(0);
    expect(reloadMenuIndex).toBeGreaterThan(renameMenuIndex);
    expect(archiveMenuIndex).toBeGreaterThan(reloadMenuIndex);
    expect(deleteMenuIndex).toBeGreaterThan(archiveMenuIndex);
    expect(mainTsx).toContain("if (target?.closest('.project-session-action-menu')) {");
    expect(mainTsx).toContain('const projectSessionActionMenuOverlay = renderProjectSessionActionMenu();');
    expect(listViewTsx).toContain('gestureHandlers={bindSessionContextMenu({projectId, sessionId: session.sessionId})}');
    expect(listViewTsx).toContain('props.onOpenSessionContextMenu(target.projectId, target.sessionId, position);');
    expect(mainTsx).toContain('const mobileSidebarMain = !isWide ? renderMobileChatSessionSheet() : null;');
    expect(mainTsx).toContain('const wideSidebarMain = renderWideProjectSessionNav();');
    expect(mainTsx).not.toContain('const wideSidebarMain = sidebarSettingsOpen');
    expect(mainTsx).not.toContain("? renderSettingsContent(false, { hideDetailHeader: isSettingsPeerDetail(settingsDetailView) })");
    expect(mainTsx).not.toContain('const wideSidebarTitle = sidebarSettingsOpen');
    expect(mainTsx).toContain('renderChatSessionHeader(false)');
    expect(mainTsx).not.toContain('chatSidebarTitleSearchOpen');
    expect(mainTsx).not.toContain('const handleDesktopActivitySelect = useCallback((nextTab: Tab) => {');
    expect(mainTsx).toContain('const handleDesktopSettingsSelect = useCallback(() => {');
    expect(mainTsx).toContain("from '../shell/WheelMakerAppMenu';");
    expect(mainTsx).toContain("import { DesktopDragRegion, DesktopWindowControls } from '../shell/layouts/desktop/DesktopTitleBar';");
    expect(mainTsx).toContain('const desktopWindowControls = desktopWindowControlsVisible ? (');
    expect(mainTsx).toContain('const desktopWindowControlsVisible = isWide && Boolean(getDesktopWindowBridge());');
    expect(mainTsx).toContain('<DesktopWindowControls />');
    expect(mainTsx).toContain('desktopSettingsScreen={desktopSharesScreen ?? desktopReleasePublishingScreen ?? desktopPortRelayScreen ?? desktopSettingsScreen}');
    expect(mainTsx).toContain('const renderWheelMakerAppMenu = (mobile: boolean) => (');
    expect(mainTsx).toContain("'chat-menu-icon-button chat-menu-settings-button chat-menu-product-button'");
    expect(mainTsx).toContain('onOpenSettings={handleDesktopSettingsSelect}');
    expect(mainTsx).toContain('<DesktopDragRegion className="sidebar-title-row">');
    expect(mainTsx).toContain('<DesktopDragRegion className="block-title chat-title-bar">');
    expect(mainTsx).not.toContain('chat-sidebar-toggle');
    expect(mainTsx).toContain('{!mobile ? renderChatSessionHeader(false) : null}');
    expect(mainTsx).not.toContain('!desktopChatSessionPinned ? renderChatSessionHeader(false)');
    expect(mainTsx).toContain('className={`chat-title-project-button${chatTitleProjectMenuOpen ? \' open\' : \'\'}`}');
    expect(mainTsx).toContain('onPointerDown={event => event.stopPropagation()}');
    expect(mainTsx).toContain('setChatTitleProjectMenuOpen(open => !open);');
    const chatTitleProjectMenuStart = mainTsx.indexOf('const chatTitleProjectMenu = chatTitleProjectMenuOpen ? (');
    const chatTitleProjectMenuEnd = mainTsx.indexOf('const chatTitlePromptMenu =', chatTitleProjectMenuStart);
    expect(chatTitleProjectMenuStart).toBeGreaterThanOrEqual(0);
    expect(chatTitleProjectMenuEnd).toBeGreaterThan(chatTitleProjectMenuStart);
    const chatTitleProjectMenuBlock = mainTsx.slice(chatTitleProjectMenuStart, chatTitleProjectMenuEnd);
    expect(chatTitleProjectMenuBlock).toContain('{visibleProjectItems.map(projectItem => {');
    expect(chatTitleProjectMenuBlock).not.toContain('sortedProjectItems.map(projectItem => {');
    expect(mainTsx).toContain('const handleChatTitleProjectSelect = useCallback(async (targetProjectId: string) => {');
    expect(mainTsx).toContain('const targetSession = resolveChatTitleProjectSession(targetProjectId);');
    expect(mainTsx).toContain('if (targetSession) {');
    expect(mainTsx).toContain('await selectProjectChatSession(targetProjectId, targetSession.sessionId);');
    expect(mainTsx).toContain('workspaceStore.rememberSelectedChatSessionKey(null);');
    expect(mainTsx).toContain('applySelectedChatKey(null);');
    expect(mainTsx).toContain('setVisibleChatMessagesForRuntimeKey(\'\', [], {resetToLatest: true});');
    expect(mainTsx).toContain('className={`chat-title-prompt-icon-button${chatTitlePromptMenuOpen ? \' open\' : \'\'}`}');
    expect(mainTsx).toContain('aria-label="Show prompt history"');
    expect(mainTsx).toContain('<span className="chat-title-session-text title-text breadcrumb-current"');
    const desktopProjectStart = mainTsx.indexOf('const renderDesktopChatProjectSelector = () => (');
    const desktopTitleStart = mainTsx.indexOf('const renderDesktopChatBreadcrumbTitle = () => (', desktopProjectStart);
    const mobileTitleStart = mainTsx.indexOf('const renderMobileChatBreadcrumbTitle = () => (');
    const renderTitleStart = mainTsx.indexOf('const renderChatTitleBar = (mobile: boolean) => (', mobileTitleStart);
    expect(desktopProjectStart).toBeGreaterThanOrEqual(0);
    expect(desktopTitleStart).toBeGreaterThan(desktopProjectStart);
    expect(mobileTitleStart).toBeGreaterThan(desktopTitleStart);
    expect(renderTitleStart).toBeGreaterThan(mobileTitleStart);
    const desktopProjectBlock = mainTsx.slice(desktopProjectStart, desktopTitleStart);
    const desktopTitleBlock = mainTsx.slice(desktopTitleStart, mobileTitleStart);
    const mobileTitleBlock = mainTsx.slice(mobileTitleStart, renderTitleStart);
    expect(desktopProjectBlock).toContain('className={`chat-title-project-button${chatTitleProjectMenuOpen ? \' open\' : \'\'}`}');
    expect(desktopTitleBlock).toContain('className={`chat-title-prompt-icon-button${chatTitlePromptMenuOpen ? \' open\' : \'\'}`}');
    expect(desktopTitleBlock).not.toContain('chat-title-project-button');
    expect(mobileTitleBlock).toContain('className={`chat-title-project-button${chatTitleProjectMenuOpen ? \' open\' : \'\'}`}');
    expect(mobileTitleBlock).toContain('className={`chat-title-session-button chat-title-session-text title-text breadcrumb-current${chatTitlePromptMenuOpen ? \' open\' : \'\'}`}');
    expect(mobileTitleBlock).toContain('ref={chatTitlePromptButtonRef}');
    expect(mobileTitleBlock).toContain('onClick={toggleChatTitlePromptMenu}');
    expect(mobileTitleBlock).not.toContain('chat-title-prompt-icon-button');
    expect(mobileTitleBlock).not.toContain('handleMobileBreadcrumbProjectClick');
    expect(mobileTitleBlock).not.toContain('chat-sidebar-toggle');
    expect(mainTsx).not.toContain('className={`title-text breadcrumb-current chat-title-prompt-button');
    expect(mainTsx).toContain('const beginDesktopSidebarResize = useCallback(');
    expect(mainTsx).toContain('className={`desktop-sidebar-resize-handle${desktopSidebarResizing ?');
    expect(mainTsx).toContain('desktopSidebarWidth={desktopLayoutSidebarWidth}');

    const wideRailStart = mainTsx.indexOf('const renderWideProjectSessionNav = (options?: { includeRecent?: boolean }) => {');
    const wideRailEnd = mainTsx.indexOf('const renderSidebar = () => {', wideRailStart);
    expect(wideRailStart).toBeGreaterThanOrEqual(0);
    expect(wideRailEnd).toBeGreaterThan(wideRailStart);
    const wideRail = mainTsx.slice(wideRailStart, wideRailEnd);
    expect(wideRail).not.toContain('codicon-chevron-right');
    expect(wideRail).not.toContain('codicon-chevron-down');

    expect(mainTsx).not.toContain('const wideHeader = isWide ? (');
    expect(mainTsx).not.toContain('className="header"');

    expect(mainTsx).not.toContain('const desktopActivityBar = isWide ? (');
    expect(mainTsx).not.toContain("onClick={() => handleDesktopActivitySelect('chat')}");
    expect(mainTsx).not.toContain("onClick={() => handleDesktopActivitySelect('file')}");
    expect(mainTsx).not.toContain("onClick={() => handleDesktopActivitySelect('git')}");

    expect(stylesCss).toContain('.wide-project-session-nav {');
    expect(stylesCss).toContain('--desktop-side-surface: var(--desktop-top-surface);');
    expect(stylesCss).toContain('--desktop-top-surface: color-mix(in srgb, var(--surface-sidebar) 62%, var(--surface-panel));');
    expect(stylesCss).toContain('--desktop-window-controls-width: 138px;');
    expect(stylesCss).toContain('.desktop-window-controls {');
    expect(stylesCss).toContain('.desktop-window-source-button {');
    expect(stylesCss).toContain('.desktop-window-source-popover {');
    expect(stylesCss).toContain('.desktop-window-source-panel {');
    expect(stylesCss).toContain('.chat-menu-icon-button {');
    expect(stylesCss).toContain('.desktop-drag-region {');
    expect(stylesCss).not.toContain('.chat-sidebar-toggle');
    expect(stylesCss).toContain('.chat-title-prompt-icon-button,');
    expect(stylesCss).toContain('.chat-preview-toggle {');
    expect(stylesCss).toContain('.chat-title-project-menu {');
    expect(stylesCss).not.toContain('.desktop-activity-bar {');
    expect(stylesCss).not.toContain('.desktop-activity-button {');
    expect(stylesCss).not.toContain('.desktop-activity-button.active::before {');
    expect(stylesCss).toContain('.sidebar-title-row {');
    expect(stylesCss).toMatch(
      /\.workspace-left \{[\s\S]*background: var\(--desktop-side-surface\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.workspace-left \{[\s\S]*width: var\(--desktop-sidebar-width, 380px\);[\s\S]*min-width: 320px;[\s\S]*max-width: min\(560px, 45vw\);[\s\S]*\}/,
    );
    expect(stylesCss).toContain('.desktop-sidebar-resize-handle {');
    expect(stylesCss).toMatch(
      /\.desktop-sidebar-resize-handle \{[\s\S]*cursor: ew-resize;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.sidebar-title-row \{[\s\S]*background: var\(--desktop-top-surface\);[\s\S]*border-bottom: 1px solid var\(--border-subtle\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-title-bar \{[\s\S]*background: var\(--desktop-top-surface\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.desktop-window-controls \{[\s\S]*background: var\(--desktop-top-surface\);[\s\S]*\}/,
    );
    expect(stylesCss).toContain('.wide-project-row {');
    expect(stylesCss).toContain('.wide-project-folder-wrap {');
    expect(stylesCss).toContain('.wide-project-folder-icon {');
    expect(stylesCss).toContain('.wide-project-pin-badge {');
    expect(stylesCss).toContain('.wide-project-title-group {');
    expect(stylesCss).toContain('.wide-project-hub-tag {');
    expect(stylesCss).toContain('.wide-project-hub-dot {');
    expect(stylesCss).toContain('.wide-project-hub-label {');
    expect(stylesCss).toContain('.wide-project-hub-0 {');
    expect(stylesCss).toContain('.wide-project-action-btn {');
    expect(stylesCss).toContain('.wide-project-action-title {');
    expect(stylesCss).toContain('.wide-session-row {');
    expect(stylesCss).toContain('.project-session-row-wrap {');
    expect(stylesCss).not.toContain('.project-session-more-btn');
    expect(stylesCss).toContain('.project-session-action-menu {');
    expect(stylesCss).not.toContain('.project-session-menu-btn.reload {');
    expect(stylesCss).not.toContain('.project-session-menu-btn.rename {');
    expect(stylesCss).not.toContain('.project-session-menu-btn.archive {');
    expect(stylesCss).toContain('.app-confirm-backdrop {');
    expect(stylesCss).toContain('.app-confirm-dialog {');
    expect(stylesCss).toContain('.app-confirm-error {');
    expect(stylesCss).toContain('.project-session-menu-label {');
    expect(stylesCss).toContain('.wide-session-agent-tag {');
    expect(stylesCss).toContain('.wide-session-agent-0 {');
    expect(stylesCss).toContain('.wide-session-time {');
    expect(stylesCss).toContain('.wide-project-action-popover {');
    expect(stylesCss).toMatch(
      /\.wide-project-action-popover \{[\s\S]*position: fixed;[\s\S]*overflow-y: auto;[\s\S]*overscroll-behavior: contain;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(/\.wide-project-row \{[^}]*display: flex;[^}]*\}/);
    const wideProjectSectionBlock = stylesCss.match(/\.wide-project-section \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectSectionBlock).toContain('margin-top: var(--sl-section-gap);');
    expect(wideProjectSectionBlock).not.toContain('border:');
    expect(wideProjectSectionBlock).not.toContain('background:');
    expect(stylesCss).not.toContain('.wide-project-section.active > .wide-project-row::before {');
    expect(stylesCss).not.toContain('.wide-project-section.pinned > .wide-project-row::before {');
    expect(stylesCss).toMatch(/\.wide-project-toggle \{[^}]*padding: 4px 6px;[^}]*\}/);
    expect(stylesCss).toMatch(/\.wide-session-row \{[^}]*font-size: var\(--sl-row-font\);[^}]*\}/);
    const wideSessionRowBlock = stylesCss.match(/\.wide-session-row \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideSessionRowBlock).toContain('display: flex;');
    expect(wideSessionRowBlock).toContain('gap: 4px;');
    expect(wideSessionRowBlock).toContain('padding: var(--sl-row-py) 8px var(--sl-row-py) 6px;');
    const sessionStateMarkerBlock = stylesCss.match(/\.session-state-marker \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(sessionStateMarkerBlock).toContain('min-width: 9px;');
    expect(sessionStateMarkerBlock).toContain('flex: 0 0 auto;');
    expect(sessionStateMarkerBlock).not.toContain('transform: translateX');
    const sessionStateRunningBlock = stylesCss.match(/\.session-state-marker\.running \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(sessionStateRunningBlock).toContain('font-size: 11px;');
    expect(stylesCss).not.toMatch(/\.mobile-session-row \{[^}]*min-height: 30px;[^}]*\}/);
    expect(stylesCss).not.toMatch(/@media \(max-width: 900px\) \{[\s\S]*?\.mobile-session-row \{[\s\S]*?min-height: 40px;[\s\S]*?\}[\s\S]*?\}/);
    expect(stylesCss).toContain('font-size: 10.5px;');
    expect(stylesCss).not.toContain('.wide-project-folder-icon.codicon-folder');
    const folderIconBlock = stylesCss.match(/\.wide-project-folder-icon \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(folderIconBlock).toContain('color: var(--hub-accent, var(--text-tertiary));');
    const selectedSessionRowBlock = stylesCss.match(/\.wide-session-row\.selected \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(selectedSessionRowBlock).not.toContain('margin-left:');
    expect(selectedSessionRowBlock).not.toContain('width: calc(');
    expect(selectedSessionRowBlock).not.toContain('padding-left: 23px;');
    expect(stylesCss).not.toContain('.wide-session-row.selected::before');
    const wideProjectActionBtnBlock = stylesCss.match(/\.wide-project-action-btn \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectActionBtnBlock).toContain('place-items: center;');
    expect(stylesCss).not.toContain('.mobile-project-actions .wide-project-action-btn {');
    const wideProjectSessionListBlock = stylesCss.match(/\.wide-project-session-list \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectSessionListBlock).toContain('margin-top: 2px;');
    expect(stylesCss).toMatch(/\.wide-project-row \{[^}]*padding: 0 4px;[^}]*\}/);
    expect(stylesCss).not.toContain('.wide-session-row::after');
    expect(stylesCss).not.toContain('.project-session-row-wrap.actions-open .wide-session-row {');
    expect(stylesCss).not.toContain('.project-session-action-strip');
    expect(stylesCss).not.toContain('.project-session-row-wrap:hover .project-session-more-btn');
    expect(stylesCss).toMatch(
      /\.project-session-action-menu \{[^}]*min-width: 148px;[^}]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.project-session-menu-btn \{[^}]*gap: 8px;[^}]*padding: 6px 8px;[^}]*font-size: 12px;[^}]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.project-session-menu-btn\.delete:hover:not\(:disabled\) \{[^}]*color: var\(--state-danger\);[^}]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.wide-session-row\.selected \.wide-session-title \{[\s\S]*font-weight: 500;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.wide-project-hub-tag \{[\s\S]*font-size: 10px;[\s\S]*\}/,
    );
    const wideProjectTitleGroupBlock = stylesCss.match(/\.wide-project-title-group \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectTitleGroupBlock).toContain('min-width: 0;');
    const wideProjectNameBlock = stylesCss.match(/\.wide-project-name \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectNameBlock).toContain('font-weight: 600;');
    const wideProjectHubTagBlock = stylesCss.match(/(?:^|\n)\.wide-project-hub-tag \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectHubTagBlock).toContain('display: inline-flex;');
    const wideProjectHubLabelBlock = stylesCss.match(/\.wide-project-hub-label \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectHubLabelBlock).toContain('text-transform: uppercase;');
    expect(stylesCss).toMatch(
      /\.wide-project-pin-badge \{[\s\S]*position: absolute;[\s\S]*right: -4px;[\s\S]*bottom: -3px;[\s\S]*\}/,
    );
  });

  test('chat title bar uses breadcrumb context and exposes preview toggle', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    const chatSurfaceStart = mainTsx.indexOf('const renderMain = () => {');
    const chatSurfaceEnd = mainTsx.indexOf('const renderPreviewFileTreeSearchResults', chatSurfaceStart);
    expect(chatSurfaceStart).toBeGreaterThanOrEqual(0);
    expect(chatSurfaceEnd).toBeGreaterThan(chatSurfaceStart);
    const chatSurface = mainTsx.slice(chatSurfaceStart, chatSurfaceEnd);

    expect(chatSurface).toContain('{!isWide ? renderChatTitleBar(true) : null}');
    expect(chatSurface).not.toContain('renderChatSessionHeader(false)');
    expect(chatSurface).not.toContain('className="breadcrumb-separator"');
    expect(mainTsx).toContain('const selectedChatPromptHistory = useMemo(');
    expect(mainTsx).toContain('buildChatPromptHistory(selectedFullChatMessages)');
    expect(mainTsx).toContain('resolveCurrentChatPromptIndex(activeChatPromptHistory, chatVisibleTurnIndex)');
    expect(mainTsx).toContain('onVisibleTurnChange={setChatVisibleTurnIndex}');
    expect(mainTsx).toContain('focusMenuItemAt(chatTitlePromptMenuRef.current, currentChatPromptIndex)');
    expect(mainTsx).toContain('const jumpToChatPromptTurn = useCallback((turnIndex: number) => {');
    expect(mainTsx).toContain("chatVirtuosoListRef.current?.scrollToTurnIndex(turnIndex, 'smooth');");
    expect(mainTsx).toContain('setChatTitlePromptMenuOpen(false);');
    expect(mainTsx).toContain('const chatTitlePromptButtonRef = useRef<HTMLButtonElement | null>(null);');
    expect(mainTsx).toContain('const chatTitlePromptMenuStyle = useMemo<React.CSSProperties | undefined>(() => {');
    expect(mainTsx).toContain('const chatTitleProjectButtonRef = useRef<HTMLButtonElement | null>(null);');
    expect(mainTsx).toContain('const chatTitleProjectMenuStyle = useMemo<React.CSSProperties | undefined>(() => {');
    expect(mainTsx).toContain('const chatTitleProjectMenu = chatTitleProjectMenuOpen ? (');
    expect(mainTsx).toContain('const chatTitlePromptMenu = chatTitlePromptMenuOpen && chatTitlePromptMenuAvailable ? (');
    expect(mainTsx).toContain('{chatTitleProjectMenu}');
    expect(mainTsx).toContain('{chatTitlePromptMenu}');
    expect(mainTsx).toContain('const renderDesktopChatBreadcrumbTitle = () => (');
    expect(mainTsx).toContain('const renderMobileChatBreadcrumbTitle = () => (');
    expect(mainTsx).toContain('const renderChatTitleBar = (mobile: boolean) => (');
    expect(mainTsx).toContain('{mobile ? renderMobileChatBreadcrumbTitle() : renderDesktopChatBreadcrumbTitle()}');
    expect(mainTsx).toContain('className={`chat-title-project-button${chatTitleProjectMenuOpen ? \' open\' : \'\'}`}');
    expect(mainTsx).toContain('onPointerDown={event => event.stopPropagation()}');
    expect(mainTsx).toContain('setChatTitleProjectMenuOpen(open => !open);');
    expect(mainTsx).toContain('className={`chat-title-prompt-icon-button${chatTitlePromptMenuOpen ? \' open\' : \'\'}`}');
    expect(mainTsx).toContain('className={`chat-title-session-button chat-title-session-text title-text breadcrumb-current${chatTitlePromptMenuOpen ? \' open\' : \'\'}`}');
    expect(mainTsx).toContain('onClick={toggleChatTitlePromptMenu}');
    expect(mainTsx).toContain('<span className="chat-title-session-text title-text breadcrumb-current"');
    expect(mainTsx).not.toContain('className={`title-text breadcrumb-current chat-title-prompt-button');
    expect(mainTsx).toContain('ref={chatTitlePromptButtonRef}');
    expect(mainTsx).toContain('aria-haspopup="menu"');
    expect(mainTsx).toContain('aria-expanded={chatTitlePromptMenuOpen}');
    expect(mainTsx).toContain("className={`chat-title-project-menu topbar-menu-surface${chatTitleProjectMenuExiting ? ' sl-menu-exit' : ''}`}");
    expect(mainTsx).toContain('className={`chat-title-project-menu-item${selected ? \' selected\' : \'\'}`}');
    expect(mainTsx).toContain("className={`chat-title-prompt-menu topbar-menu-surface${chatTitlePromptMenuExiting ? ' sl-menu-exit' : ''}`}");
    expect(mainTsx).toContain("className={`chat-title-prompt-menu-item${index < currentChatPromptIndex ? ' past' : ''}${index === currentChatPromptIndex ? ' current' : ''}`}");
    expect(mainTsx).toContain('className="chat-title-prompt-menu-header"');
    expect(mainTsx).toContain('className="chat-title-prompt-menu-rail"');
    expect(mainTsx).toContain('handleMenuKeyDown(event, chatTitlePromptMenuRef.current)');
    expect(mainTsx).not.toContain('data-tooltip={item.preview}');
    expect(chatSurface).not.toContain('CHAT - ${selectedChatDisplayTitle || \'New Session\'}');
    expect(mainTsx).toContain('className="chat-title-actions"');
    expect(mainTsx).not.toContain('aria-label="Fork current session"');
    expect(mainTsx).not.toContain('className="chat-session-fork-current"');
    expect(mainTsx).toContain('{!mobile ? (\n          <>');
    expect(mainTsx).toContain('className={`chat-preview-toggle${chatPreviewOpen ? \' active\' : \'\'}`}');
    expect(mainTsx).toContain('data-tooltip={chatPreviewOpen ? \'Hide preview\' : \'Show preview\'}');
    expect(mainTsx).toContain('aria-label={chatPreviewOpen ? \'Hide preview\' : \'Show preview\'}');
    expect(mainTsx).toContain('aria-pressed={chatPreviewOpen}');
    expect(mainTsx).toContain('onClick={toggleChatPreviewFromTitle}');
    expect(mainTsx).toContain("onClick={() => togglePreviewDrawerFromTitle('files')}");
    expect(mainTsx).toContain("onClick={() => togglePreviewDrawerFromTitle('git')}");
    expect(mainTsx).toContain('disabled={!previewGitSnapshot.available}');
    expect(mainTsx).toContain('setChatPreviewManualOpen(open => !open)');
    expect(mainTsx).toContain('setChatPreviewManualCollapsed(true)');

    expect(stylesCss).toContain('.chat-title-bar {');
    expect(stylesCss).toContain('.chat-title-actions {');
    expect(stylesCss).toContain('.chat-breadcrumb-title {');
    expect(stylesCss).toContain('.chat-title-session-button {');
    expect(stylesCss).not.toContain('.chat-sidebar-toggle');
    expect(stylesCss).toContain('.chat-title-project-button {');
    expect(stylesCss).toContain('.chat-title-project-menu {');
    expect(stylesCss).toContain('.chat-title-prompt-icon-button,');
    expect(stylesCss).toContain('.chat-title-prompt-menu {');
    expect(stylesCss).toContain('.chat-title-prompt-menu-item {');
    expect(stylesCss).toContain('.chat-preview-toggle {');
    expect(stylesCss).toContain('.chat-drawer-toggle,');
    expect(stylesCss).toContain('.chat-drawer-toggle.active,');
    const projectButtonBlock = cssRuleBlock(stylesCss, '.chat-title-project-button');
    expect(projectButtonBlock).toContain('border: 0;');
    expect(projectButtonBlock).toContain('background: transparent;');
    expect(projectButtonBlock).toContain('overflow: hidden;');
    expect(projectButtonBlock).toContain('max-width: max-content;');
    expect(projectButtonBlock).not.toContain('max-width: min(46%, 280px);');
    expect(projectButtonBlock).toContain('text-align: left;');
    expect(projectButtonBlock).toContain('color: var(--text-primary);');
    const desktopProjectButtonBlock = cssRuleBlock(
      stylesCss,
      '.chat-title-bar > .chat-session-header .chat-title-project-button',
    );
    expect(desktopProjectButtonBlock).toContain('flex: 1 1 0;');
    expect(desktopProjectButtonBlock).toContain('max-width: none;');
    expect(desktopProjectButtonBlock).not.toContain('116px');
    const projectButtonNameBlock = cssRuleBlock(stylesCss, '.chat-title-project-button .breadcrumb-project-name');
    expect(projectButtonNameBlock).toContain('flex: 1 1 auto;');
    expect(projectButtonNameBlock).toContain('max-width: 100%;');
    expect(projectButtonNameBlock).toContain('border: 0;');
    expect(projectButtonNameBlock).toContain('padding: 0;');
    expect(projectButtonNameBlock).toContain('background: transparent;');
    const projectChevronBlock = cssRuleBlock(stylesCss, '.chat-title-project-button .sl-icon');
    expect(projectChevronBlock).toContain('color: var(--text-tertiary);');
    const sessionTitleBlock = cssRuleBlock(stylesCss, '.chat-title-session-text');
    expect(sessionTitleBlock).toContain('flex: 1 1 0;');
    const mobileSessionTitleBlock = cssRuleBlock(stylesCss, '.chat-title-session-button');
    expect(mobileSessionTitleBlock).toContain('border: 0;');
    expect(mobileSessionTitleBlock).toContain('background: transparent;');
    expect(mobileSessionTitleBlock).toContain('cursor: pointer;');
    const promptIconBlock = cssRuleBlockContainingSelector(stylesCss, '.chat-title-prompt-icon-button');
    expect(promptIconBlock).toContain('width: 28px;');
    expect(promptIconBlock).toContain('border: 0;');
    expect(promptIconBlock).toContain('background: transparent;');
    const promptMenuBlock = cssRuleBlock(stylesCss, '.chat-title-prompt-menu');
    expect(promptMenuBlock).toContain('position: fixed;');
    expect(promptMenuBlock).toContain('top: calc(var(--wm-safe-area-top) + var(--chat-menu-header-height));');
    expect(promptMenuBlock).toContain('overflow-y: auto;');
    const previewToggleBlock = cssRuleBlock(stylesCss, '.chat-preview-toggle');
    expect(previewToggleBlock).toContain('width: 28px;');
    expect(previewToggleBlock).toContain('border: 0;');
    expect(previewToggleBlock).toContain('background: transparent;');
    expect(previewToggleBlock).toContain('color: var(--text-tertiary);');
    expect(previewToggleBlock).not.toContain('var(--surface-raised)');
    const previewToggleHoverBlock = cssRuleBlock(stylesCss, '.chat-preview-toggle:hover');
    expect(previewToggleHoverBlock).toContain('background: var(--hover);');
    expect(previewToggleHoverBlock).toContain('color: var(--text-primary);');
    const titleBarActiveBlock = cssRuleBlock(
      stylesCss,
      '.chat-title-prompt-icon-button.open,\n.chat-search-toggle.active,\n.chat-terminal-toggle.active,\n.chat-drawer-toggle.active,\n.chat-preview-toggle.active',
    );
    expect(titleBarActiveBlock).toContain('color: var(--accent-primary);');
    expect(titleBarActiveBlock).toContain('box-shadow: inset 0 2px 0 var(--accent-primary);');
    expect(titleBarActiveBlock).not.toContain('background:');
    const terminalToggleBlock = cssRuleBlockContainingSelector(stylesCss, '.chat-terminal-toggle');
    expect(terminalToggleBlock).toContain('width: 28px;');
    expect(terminalToggleBlock).toContain('color: var(--text-tertiary);');
    expect(stylesCss).not.toContain('.chat-search-toggle {');
    const sessionTitleBlock2 = cssRuleBlock(stylesCss, '.chat-title-session-text');
    expect(sessionTitleBlock2).toContain('color: var(--text-primary);');
    expect(sessionTitleBlock2).toContain('font-weight: 500;');
  });

  test('prompt history menu spans the title bar and tightens rows on desktop pointers', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("closest('.chat-title-bar')");
    expect(mainTsx).toContain('left: anchor.left + 8');
    expect(mainTsx).toContain('width: Math.max(280, anchor.width - 16)');
    const promptMenuBlock = cssRuleBlock(stylesCss, '.chat-title-prompt-menu');
    expect(promptMenuBlock).not.toContain('width:');
    const promptMenuItemBlock = cssRuleBlock(stylesCss, '.chat-title-prompt-menu-item');
    expect(promptMenuItemBlock).toContain('min-height: 40px');
    const densityMediaBlock = stylesCss.match(
      /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.chat-title-prompt-menu-item \{([\s\S]*?)\}\s*\}/,
    )?.[1] ?? '';
    expect(densityMediaBlock).toContain('min-height: 36px');
    expect(densityMediaBlock).toContain('padding: 4px 10px 4px 8px;');
  });

  test('top bar menus share the session glass recipe and menu exit wiring', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const hubMenuTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'ChatHubMenu.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("import {useMenuExitFlag, useMenuExitState} from '../chat/sessionlist/menuExit';");
    expect(mainTsx).toContain('const [chatTitleProjectMenuOpen, setChatTitleProjectMenuOpen, chatTitleProjectMenuExiting] = useMenuExitFlag();');
    expect(mainTsx).toContain('const [chatTitlePromptMenuOpen, setChatTitlePromptMenuOpen, chatTitlePromptMenuExiting] = useMenuExitFlag();');
    expect(mainTsx).toContain("className={`chat-title-project-menu topbar-menu-surface${chatTitleProjectMenuExiting ? ' sl-menu-exit' : ''}`}");
    expect(mainTsx).toContain("className={`chat-title-prompt-menu topbar-menu-surface${chatTitlePromptMenuExiting ? ' sl-menu-exit' : ''}`}");
    expect(mainTsx).toContain('exiting={chatHubMenuExiting}');
    expect(hubMenuTsx).toContain("exiting ? ' sl-menu-exit' : ''");
    expect(hubMenuTsx).toContain('chat-hub-popover topbar-menu-surface');
    const menuRule = cssRuleBlock(stylesCss, '.topbar-menu-surface');
    expect(menuRule).toContain('background: color-mix(in srgb, var(--surface-overlay) 88%, transparent);');
    expect(menuRule).toContain('blur(12px) saturate(1.1)');
    expect(menuRule).toContain('border: 1px solid var(--border-faint);');
    expect(menuRule).toContain('box-shadow: var(--shadow-overlay);');
    expect(menuRule).toContain('padding: 4px;');
    expect(menuRule).toContain('animation: sl-menu-in 140ms var(--ease-out);');
    expect(stylesCss).not.toMatch(/\.chat-title-project-menu,[\s\S]{0,200}workspaceMenuEnter/);
    expect(stylesCss).not.toMatch(/\.chat-title-prompt-menu,[\s\S]{0,200}workspaceMenuEnter/);
    expect(stylesCss).not.toMatch(/\.chat-hub-popover,[\s\S]{0,200}workspaceMenuEnter/);
  });

  test('wide project session rail actions use project-scoped chat flows', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('const selectWideProjectSession = async (targetProjectId: string, sessionId: string) => {');
    expect(mainTsx).toContain('const selectProjectChatSession = async (');
    expect(mainTsx).toContain('workspaceStore.rememberSelectedChatSessionKey(nextSelectedKey);');
    expect(mainTsx).not.toContain("setTab('chat');");
    expect(mainTsx).toContain('loadChatSession(sessionId, targetProjectId, {');
    const selectProjectStart = mainTsx.indexOf('const selectProjectChatSession = async (');
    const selectProjectEnd = mainTsx.indexOf('const selectWideProjectSession = async', selectProjectStart);
    expect(selectProjectStart).toBeGreaterThanOrEqual(0);
    expect(selectProjectEnd).toBeGreaterThan(selectProjectStart);
    const selectProjectBody = mainTsx.slice(selectProjectStart, selectProjectEnd);
    expect(selectProjectBody).not.toContain('switchProject(');
    expect(selectProjectBody).toContain('hydrateChatSessionContentFromCache(sessionId, targetProjectId)');
    expect(selectProjectBody).toContain('selectionSnapshot: runtimeKey');
    expect(mainTsx).toContain('const handleWideProjectCreateSession = async (targetProjectId: string, agentType: string) => {');
    expect(mainTsx).toContain("service.createProjectSession(targetProjectId, agentType, ''");
    expect(mainTsx).toContain('const handleWideProjectResumeAgent = async (targetProjectId: string, agentType: string) => {');
    expect(mainTsx).toContain('const sessions = await service.listProjectResumableSessions(targetProjectId, agentType);');
    expect(mainTsx).toContain('const handleWideProjectResumeImport = async (targetProjectId: string, agentType: string, sessionId: string) => {');
    expect(mainTsx).toContain('const imported = await service.importProjectResumedSession(targetProjectId, agentType, sessionId);');
    expect(mainTsx).toContain('const reloaded = await service.reloadProjectSession(targetProjectId, importedSessionId);');
    expect(mainTsx).toContain('wideProjectActionMenuRef.current?.contains(target)');
  });

  test('does not rewrite removed codexapp agent names in web payloads', () => {
    const projectRoot = path.join(__dirname, '..');
    const repositoryTs = readSourceText(path.join(projectRoot, 'web', 'src', 'registry', 'RegistryRepository.ts'));
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(repositoryTs).toContain('function normalizeAgentType(agentType: unknown): string | undefined');
    expect(repositoryTs).not.toContain("return normalized.toLowerCase() === 'codexapp' ? 'codex' : normalized;");
    expect(repositoryTs).toContain('agentType: normalizeAgentType(input.agentType),');
    expect(repositoryTs).toContain('.map(item => normalizeAgentType(item))');
    expect(mainTsx).not.toContain("return normalized.toLowerCase() === 'codexapp' ? 'codex' : normalized;");
    expect(mainTsx).not.toContain('codexapp: 3');
  });

  test('chat composer supports indexed project file mentions', () => {
    const projectRoot = path.join(__dirname, '..');
    const registryTypes = readSourceText(path.join(projectRoot, 'web', 'src', 'registry', 'registryTypes.ts'));
    const repositoryTs = readSourceText(path.join(projectRoot, 'web', 'src', 'registry', 'RegistryRepository.ts'));
    const workspaceServiceTs = readSourceText(path.join(projectRoot, 'web', 'src', 'registry', 'RegistryWorkspaceService.ts'));
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const composerTokensTs = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'composer', 'chatComposerTokens.ts'));
    const promptAttachmentsTs = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'composer', 'chatPromptAttachments.ts'));
    const stylesCss = readWebStyles(projectRoot);

    expect(registryTypes).toContain('export interface RegistryFileIndexSearchResult');
    expect(registryTypes).toContain('export interface RegistryFileIndexSearchResponse');
    expect(repositoryTs).toContain('RegistryMethods.ProjectFSIndexSearch');
    expect(workspaceServiceTs).toContain('async searchFileIndex(');
    expect(mainTsx).not.toContain('type ChatFileMention = {');
    expect(mainTsx).not.toContain('fileMentions: ChatFileMention[];');
    expect(mainTsx).toContain("const EMPTY_CHAT_COMPOSER_DRAFT: ChatComposerDraft = { text: '', tokens: [], attachments: [] };");
    expect(mainTsx).not.toContain('const [chatFileMentions, setChatFileMentions] = useState<ChatFileMention[]>([]);');
    expect(mainTsx).not.toContain('const chatFileMentionsRef = useRef<ChatFileMention[]>([]);');
    expect(mainTsx).toContain('resolveChatFileMentionQuery(text, selectionStart)');
    expect(mainTsx).toContain('service.searchFileIndex(activeProjectId, {');
    expect(mainTsx).toContain('querySessionId: chatFileMentionQuerySessionIdRef.current');
    expect(mainTsx).toContain('limit: CHAT_FILE_MENTION_SEARCH_LIMIT');
    expect(mainTsx).toContain('chatRichComposerRef.current?.insertFile({');
    expect(mainTsx).not.toContain('removeChatFileMentionTriggerToken(');
    expect(mainTsx).not.toContain('dedupeChatFileMentionsByPath');
    expect(mainTsx).toContain('const serializedComposer = serializeChatComposerTokens(sourceTokens);');
    expect(composerTokensTs).toContain("type: 'resource_link'");
    expect(composerTokensTs).toContain('uri: token.path');
    expect(promptAttachmentsTs).toContain('isProjectFileResourceLinkBlock');
    expect(mainTsx).not.toContain('className="chat-file-mention-chip"');
    expect(mainTsx).toContain('className={`chat-file-mention-option chat-file-mention-option-row${selected ? \' active\' : \'\'}`}');
    expect(mainTsx).toContain('data-tooltip={result.path}');
    expect(mainTsx).toContain('role="option"');
    expect(mainTsx).toContain('aria-selected={index === chatFileMentionActiveIndex}');
    expect(mainTsx).toContain('chatFileMentionActiveIndex');
    expect(mainTsx).toContain("event.key === 'ArrowDown'");
    expect(mainTsx).toContain("event.key === 'Tab'");
    expect(mainTsx).not.toContain('File mentions coming soon');
    expect(stylesCss).toContain('.chat-composer-capsule.file');
    expect(stylesCss).toContain('.chat-file-mention-option');
    expect(stylesCss).toContain('.chat-file-mention-path');
  });

  test('chat composer file mention popup exposes directional preview help', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    const fileMentionKeyStart = mainTsx.indexOf('if (chatFileMentionMenuOpen) {');
    const fileMentionKeyEnd = mainTsx.indexOf('if (chatSlashMenuVisible)', fileMentionKeyStart);
    expect(fileMentionKeyStart).toBeGreaterThanOrEqual(0);
    expect(fileMentionKeyEnd).toBeGreaterThan(fileMentionKeyStart);
    const fileMentionKeyBody = mainTsx.slice(fileMentionKeyStart, fileMentionKeyEnd);

    expect(mainTsx).not.toContain('Up/Down to browse, Right to preview');
    expect(mainTsx).not.toContain('chat-file-mention-shortcut-tip');
    expect(mainTsx).toContain("['→', 'Preview']");
    expect(mainTsx).toContain('chat-file-mention-option-row');
    expect(mainTsx).toContain('className="chat-file-mention-option-main"');
    expect(mainTsx).toContain('className="chat-file-mention-preview-button"');
    expect(mainTsx).toContain('aria-label={`Open ${name} preview`}');
    expect(mainTsx).toContain('onClick={() => openChatFileMentionPreview(result)}');
    expect(mainTsx).toContain('onClick={() => applyChatFileMentionResult(result)}');
    expect(fileMentionKeyBody).toContain("event.key === 'ArrowDown'");
    expect(fileMentionKeyBody).toContain("event.key === 'ArrowUp'");
    expect(fileMentionKeyBody).toContain("event.key === 'ArrowRight'");
    expect(fileMentionKeyBody).toContain('openChatFileMentionPreview(activeResult);');
    expect(fileMentionKeyBody).not.toContain("event.key.toLowerCase() === 'o'");
    expect(fileMentionKeyBody).not.toContain('(event.ctrlKey || event.metaKey)');
    expect(fileMentionKeyBody).not.toContain('onContextMenu={event => {');

    expect(stylesCss).not.toContain('.chat-file-mention-shortcut-tip');
    expect(stylesCss).toContain('.chat-file-mention-option-row');
    expect(stylesCss).toContain('.chat-file-mention-preview-button');
    // Touch has no hover, so the preview eye stays visible instead of being
    // an invisible tap target.
    expect(stylesCss).toMatch(/@media \(hover: none\) \{[\s\S]*\.chat-file-mention-preview-button \{[\s\S]*opacity: 1;/);
    expect(stylesCss).toContain('.chat-menu-footer');
    expect(stylesCss).toMatch(/\.chat-menu-hint kbd \{[\s\S]*border-radius: 4px;/);
  });

  test('chat composer trigger menus show more rows with inline skill descriptions', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    for (const selector of ['.chat-slash-menu', '.chat-file-mention-menu']) {
      const block = cssRuleBlock(stylesCss, selector);
      expect(block).toContain('max-height: min(56dvh, 420px);');
    }
    expect(cssRuleBlock(stylesCss, '.chat-slash-item')).toContain('min-height: 30px;');
    expect(cssRuleBlock(stylesCss, '.chat-file-mention-option')).toContain('min-height: 30px;');
    const nameBlock = cssRuleBlock(stylesCss, '.chat-slash-name');
    expect(nameBlock).toContain('flex: 0 0 auto;');
    expect(nameBlock).toContain('max-width: 50%;');
    expect(nameBlock).not.toContain('flex: 0 1 auto;');
    const descriptionBlock = cssRuleBlock(stylesCss, '.chat-slash-description');
    expect(descriptionBlock).toContain('flex: 1 1 0;');
    expect(descriptionBlock).toContain('color: var(--text-tertiary);');
    expect(descriptionBlock).toContain('text-align: left;');
    expect(descriptionBlock).not.toContain('margin-left: auto;');
    expect(mainTsx).toContain('selectComposerSkills(hubStoreSnapshot, skillProjectId, agent)');
  });

  test('chat composer uses compact file mention pins and running tools-slot cancel', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const openChatFileMentionShortcut = useCallback(() => {');
    expect(mainTsx).toContain('className="chat-tool-button chat-file-mention-trigger-button"');
    expect(mainTsx).toContain('className="chat-tool-button chat-slash-button"');
    expect(mainTsx).toContain('aria-label="Mention files"');
    expect(mainTsx).toContain('<ChatIcon name="atSign" />');
    expect(mainTsx).toContain('className="chat-tool-button chat-attachment-plus-button"');
    expect(mainTsx).toContain('chat-composer-stop-slot${chatStopPillExiting');
    expect(mainTsx).toContain('const [chatStopPillVisible, setChatStopPillVisible, chatStopPillExiting] = useMenuExitFlag();');
    expect(mainTsx).not.toContain('chatComposerStopTriggerClassName');
    expect(mainTsx).not.toContain('disabled={!selectedChatPromptRunning || selectedChatPromptCancelling}');
    expect(mainTsx).toContain('cancelling={selectedChatPromptCancelling}');
    expect(mainTsx).not.toContain('className="chat-file-mention-remove"');
    expect(mainTsx).toContain('<span className="chat-file-mention-name">{name}</span>');
    expect(mainTsx).toContain('<span className="chat-file-mention-path">{result.path}</span>');

    const toolsStart = mainTsx.indexOf('className="chat-composer-tools"');
    const toolsEnd = mainTsx.indexOf('className="chat-config-options-wrap"', toolsStart);
    expect(toolsStart).toBeGreaterThanOrEqual(0);
    expect(toolsEnd).toBeGreaterThan(toolsStart);
    const toolsBlock = mainTsx.slice(toolsStart, toolsEnd);
    expect(toolsBlock.indexOf('chat-slash-button')).toBeLessThan(toolsBlock.indexOf('chat-file-mention-trigger-button'));
    expect(toolsBlock.indexOf('chat-file-mention-trigger-button')).toBeLessThan(toolsBlock.indexOf('chat-attachment-plus-button'));
    expect(toolsBlock.indexOf('chat-attachment-plus-button')).toBeLessThan(toolsBlock.indexOf('chat-composer-stop-slot'));
    expect(toolsBlock).not.toContain('!selectedChatPromptRunning ? (');

    expect(stylesCss).toContain('.chat-tool-button {');
    expect(stylesCss).not.toContain('.chat-at-symbol');
    expect(stylesCss).not.toContain('.chat-slash-symbol');
    expect(stylesCss).toContain('.chat-composer-capsule.file');
    expect(mainTsx).toContain('<ChatIcon name="command" />');
    expect(mainTsx).toContain('<ChatIcon name="atSign" />');
    expect(mainTsx).not.toContain('chat-composer-tool-glyph');
    expect(mainTsx).not.toContain('chat-slash-symbol');
    expect(mainTsx).not.toContain('chat-at-symbol');
    expect(mainTsx).toContain('<ChatIcon name="paperclip" />');
    expect(mainTsx).not.toContain('className="codicon codicon-tools chat-composer-tool-glyph"');
    expect(mainTsx).not.toContain('className="codicon codicon-add chat-composer-tool-glyph"');
    const toolButtonBlock = cssRuleBlock(stylesCss, '.chat-tool-button');
    expect(toolButtonBlock).toContain('border: none;');
    expect(toolButtonBlock).toContain('background: transparent;');
    expect(toolButtonBlock).toContain('color: color-mix(in srgb, var(--text-secondary) 86%, var(--text-primary));');
    expect(toolButtonBlock).not.toContain('border: 1px');
    expect(toolButtonBlock).not.toContain('color: color-mix(in srgb, var(--text-primary) 72%, var(--text-secondary));');
    expect(stylesCss).not.toContain('.chat-slash-button,\n.chat-file-mention-trigger-button,\n.chat-attachment-plus-button {');
    expect(stylesCss).toMatch(/\.chat-file-mention-skeleton-row \{[\s\S]*grid-template-columns: 16px minmax\(0, auto\) minmax\(0, 1fr\);[\s\S]*min-height: 30px;/);
    expect(stylesCss).toMatch(/\.chat-tool-button \{[\s\S]*display: inline-grid;[\s\S]*place-items: center;[\s\S]*\}/);
    expect(stylesCss).not.toContain('.chat-file-mention-trigger-button {\n  color: color-mix(in srgb, #8bd5ff 82%, var(--text-primary));\n}');
    expect(stylesCss).not.toContain('.chat-attachment-action-button.file .codicon');
    expect(stylesCss).not.toContain('.chat-attachment-action-button.photo .codicon');
    expect(stylesCss).toMatch(/\.chat-file-mention-option-main \{[\s\S]*grid-template-columns: 16px minmax\(0, auto\) minmax\(0, 1fr\);/);
    expect(stylesCss).toMatch(/\.chat-composer-capsule,[\s\S]*\.chat-prompt-inline-capsule \{[\s\S]*max-width: min\(260px, 100%\);/);
    expect(stylesCss).toMatch(/\.chat-stop-pill \{[\s\S]*justify-content: center;[\s\S]*height: 24px;[\s\S]*border-radius: 999px;/);
    expect(stylesCss).toMatch(/\.chat-stop-bike-wheel-anim \{[\s\S]*animation: chat-stop-bike-spin 0\.9s linear infinite;/);
  });

  test('keeps running chat editable and queues another send for that chat', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const sendStart = mainTsx.indexOf('const sendChatMessage = async');
    const sendEnd = mainTsx.indexOf('const sendChatMessageEvent = useStableEvent(sendChatMessage);', sendStart);
    const sendBlock = mainTsx.slice(sendStart, sendEnd);

    expect(mainTsx).toContain('const [chatSubmittingByKey, setChatSubmittingByKey] = useState<Record<string, boolean>>({});');
    expect(mainTsx).toContain('const chatSubmittingByKeyRef = useRef<Record<string, boolean>>({});');
    expect(mainTsx).toContain('const [chatSessionQueuesByKey, setChatSessionQueuesByKey] = useState<ChatSessionQueuesByKey>({});');
    expect(mainTsx).toContain('const chatSessionQueuesByKeyRef = useRef<ChatSessionQueuesByKey>({});');
    expect(mainTsx).toContain('const selectedChatSubmitPending = selectedChatEncodedKey');
    expect(mainTsx).toContain('const chatSendDisabled = selectedChatSubmitPending || chatAttachmentUploadPending || !!selectedActivePermission;');
    expect(mainTsx).toContain('service.enqueueProjectSessionItem(selectedProjectId, sessionId, {');
    expect(mainTsx).toContain('cancelProjectSessionQueueItem(projectId, key.sessionId, itemId)');
    expect(mainTsx).toContain('prioritizeProjectSessionQueueItem(projectId, key.sessionId, itemId)');
    expect(mainTsx).not.toContain('drainNextQueuedChatItem');
    expect(mainTsx).toContain('readOnly={selectedChatSubmitPending}');
    expect(mainTsx).toContain('disabled={chatSendDisabled}');
    expect(mainTsx).toContain('if (chatSendDisabled) {');
    expect(sendStart).toBeGreaterThanOrEqual(0);
    expect(sendEnd).toBeGreaterThan(sendStart);
    expect(sendBlock).not.toContain('if (selectedChatPromptRunning) {\n      return;\n    }');
    expect(sendBlock).toContain('setChatSubmittingForRuntimeKey(submittingRuntimeKey, true);');
    expect(sendBlock).toContain('setChatSubmittingForRuntimeKey(submittingRuntimeKey, false);');
    expect(mainTsx).not.toContain('readOnly={chatSending}');
    expect(mainTsx).not.toContain('disabled={chatSending || chatAttachmentUploadPending}');
  });

  test('always submits prompt work through the server queue', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const sendStart = mainTsx.indexOf('const sendChatMessage = async');
    const sendEnd = mainTsx.indexOf('const sendChatMessageEvent = useStableEvent(sendChatMessage);', sendStart);
    const sendBlock = mainTsx.slice(sendStart, sendEnd);

    expect(sendStart).toBeGreaterThanOrEqual(0);
    expect(sendEnd).toBeGreaterThan(sendStart);
    expect(sendBlock).toContain('service.enqueueProjectSessionItem(selectedProjectId, sessionId, {');
    expect(sendBlock).not.toContain('runtimeSessionHasActiveExecution');
    expect(sendBlock).not.toContain('runtimeSessionIsBusy');
  });

  test('keeps sidebar search fixed in the title region and new sessions project-scoped', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const projectSectionTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'sessionlist', 'ProjectSection.tsx'));
    const stylesCss = readWebStyles(projectRoot);
    expect(mainTsx).toContain("const chatSessionHeaderClassName = `sidebar-title-row chat-session-header");
    expect(mainTsx).toContain('{renderChatHeaderSearchControls()}');
    expect(mainTsx).toContain('className="chat-header-search-wrap"');
    expect(projectSectionTsx).toContain('wide-project-action-btn sl-action-primary');
    expect(mainTsx).not.toContain('className="global-new-session"');
    expect(stylesCss).toContain('/* workspace-ui-targeted-evolution: session sidebar */');
  });

  test('keeps assistant content inside the narrow chat viewport', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    expect(stylesCss).toContain('.chat-main-message');
    expect(stylesCss).toContain('max-width: 100%');
    expect(stylesCss).toContain('overflow-wrap: anywhere');
  });

  test('keeps the two-row composer and current control sizes on portrait mobile', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);
    expect(mainTsx).toMatch(/chat-composer-frame[\s\S]*chat-composer-input-row[\s\S]*chat-composer-toolbar/);
    expect(stylesCss).toMatch(/\.chat-composer-action-column\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
    expect(stylesCss).toMatch(/\.chat-send-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
    expect(stylesCss).toMatch(/\.voice-input-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
    expect(stylesCss).toMatch(/\.chat-tool-button\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s);
    expect(stylesCss).toContain('/* workspace-ui-targeted-evolution: composer */');
    expect(stylesCss).toContain('max-width: calc(100vw - 24px)');
    expect(stylesCss).toContain('padding-bottom: max(4px, var(--wm-safe-area-bottom))');
    expect(stylesCss).toMatch(
      /@media \(max-width: 900px\) \{[\s\S]*?\.chat-composer \{[\s\S]*?background: var\(--surface-canvas\);[\s\S]*?\}/,
    );
  });

  test('uses a clear but restrained selection surface and information-state colors for chat chrome', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);

    expect(stylesCss).toMatch(
      /\.wide-session-row\.selected \{[\s\S]*background: var\(--accent-soft-bg\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-composer:focus-within \.chat-composer-frame \{[\s\S]*border-color: color-mix\(in srgb, var\(--accent-primary\) 36%, var\(--border-subtle\)\);[\s\S]*0 0 0 1px color-mix\(in srgb, var\(--accent-primary\) 6%, transparent\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(/\.voice-input-button \{[\s\S]*var\(--state-info\)[\s\S]*\}/);
  });

  test('keeps agent types and user prompts visibly aligned with the chat body palette', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const agentTagBlock = cssRuleBlock(stylesCss, '.wide-session-agent-tag');
    const promptBlocks = cssRuleBlocksContainingSelector(stylesCss, '.chat-prompt-user');
    const promptBlock = promptBlocks[promptBlocks.length - 1] ?? '';

    expect(agentTagBlock).toContain('border: 1px solid color-mix(in srgb, var(--agent-accent, #666) 26%, transparent);');
    expect(agentTagBlock).toContain('background: color-mix(in srgb, var(--agent-accent, #666) 14%, transparent);');
    expect(agentTagBlock).toContain('color: color-mix(in srgb, var(--agent-accent, var(--text-tertiary)) 88%, white);');
    expect(promptBlock).toContain('border: 1px solid color-mix(in srgb, var(--accent-primary) 26%, var(--border-subtle));');
    expect(promptBlock).toContain('background: color-mix(in srgb, var(--accent-primary) 12%, var(--surface-workspace-content));');
  });

  test('tightens relaxed session rows', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const sessionRowBlock = cssRuleBlock(stylesCss, '.wide-session-row');
    const sessionTimeBaseBlock = cssRuleBlock(stylesCss, '.wide-session-time');
    const sessionTimeBlock = cssRuleBlock(stylesCss, '.wide-session-time.compact-age');
    const compactTokens = cssRuleBlock(stylesCss, '[data-session-list-density="compact"]');

    expect(stylesCss).toContain('--sl-row-py: 5px;');
    expect(stylesCss).toContain('--sl-row-font: 12.5px;');
    expect(stylesCss).toContain('[data-session-list-density="compact"]');
    expect(stylesCss).toContain('--sl-row-py: 3px;');
    expect(compactTokens).not.toContain('--sl-row-font:');
    expect(sessionRowBlock).toContain('gap: 4px;');
    expect(sessionTimeBlock).toContain('flex: 0 0 22.5px;');
    expect(sessionTimeBaseBlock).toContain('white-space: nowrap;');
    expect(stylesCss).not.toContain('.recent-project-session-hub.wide-project-hub-tag');
  });

  test('scopes icon-only padding resets without collapsing icon-and-label button spacing', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const baseCss = readSourceText(
      path.join(projectRoot, 'web', 'src', 'styles', 'base.css'),
    );

    expect(baseCss).not.toContain('button:has(> .sl-icon:only-child)');
    for (const selector of [
      '.wide-project-action-btn',
      '.recent-project-divider-create',
      '.session-search-icon-btn',
      '.chat-title-project-menu-create',
      '.chat-session-global-bar-btn',
      '.draft-session-dismiss',
      '.mobile-project-sheet-close',
      '.app-session-status-close',
      '.mobile-settings-back',
    ]) {
      const iconButtonRule =
        cssRuleBlocksContainingSelector(stylesCss, selector).find(block =>
          block.includes('appearance: none;'),
        ) ?? '';
      expect(iconButtonRule).toContain('appearance: none;');
      expect(iconButtonRule).toContain('padding: 0;');
    }
    expect(cssRuleBlock(stylesCss, '.app-confirm-btn')).toContain(
      'padding: 0 12px;',
    );
    expect(cssRuleBlock(stylesCss, '.set-btn')).toContain('padding: 0 12px;');
    expect(cssRuleBlock(stylesCss, '.set-btn--lg')).toContain(
      'padding: 0 14px;',
    );
  });

  test('gives Sessions six more pixels of left inset', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const pinnedHeaderRule = cssRuleBlockContainingSelector(
      stylesCss,
      '.chat-session-panel-pinned .chat-edge-surface-header',
    );

    expect(pinnedHeaderRule).toContain('padding-left: 17px;');
  });
});

describe('chat share orchestration', () => {
  test('freezes response or full-session models and routes all formats through shared outputs', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('const buildFrozenChatShareSnapshot = useCallback');
    expect(mainTsx).toContain('const selectedChatMessageLifecycleSupported = archivedMode');
    expect(mainTsx).toContain('includeWorkDetails: action.includeWorkDetails');
    expect(mainTsx).toContain('buildResponseChatShareSnapshot(selectedFullChatMessages, doneTurnIndex, context, contentOptions)');
    expect(mainTsx).toContain('buildSessionChatShareSnapshot(selectedFullChatMessages, context, contentOptions)');
    expect(mainTsx).toContain('shareWorkDetailsAvailable={selectedChatMessageLifecycleSupported}');
    expect(mainTsx).toContain("const selectedFullChatMessages = archivedMode");
    expect(mainTsx).toContain("sourceType: action.scope === 'response' ? 'chat_response' : 'chat_session'");
    expect(mainTsx).toContain("mode: 'image'");
    expect(mainTsx).toContain("mode: 'html'");
    expect(mainTsx).toContain('outputResponseImage({');
    expect(mainTsx).toContain('outputMarkdownHtml({');
    expect(mainTsx).toContain('createChatShareSnapshot({');
    expect(mainTsx).toContain('<ChatShareCaptureSurface');
    expect(mainTsx).not.toContain('<MarkdownImageExportSurface');
    expect(mainTsx).toContain('if (chatShareReservationPendingRef.current) return;');
    expect(mainTsx).toContain('chatShareReservationPendingRef.current = true;');
  });
});

describe('Android deferred native action ordering', () => {
  test('reserves image sharing before render state and reuses cached speech credential before forcing reconnect', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    const imageHandlerIndex = mainTsx.indexOf('const handleChatShareAction = async');
    const imageReserveIndex = mainTsx.indexOf('await reserveResponseImageShare()', imageHandlerIndex);
    const imageRenderStateIndex = mainTsx.indexOf('setChatShareCaptureTask({', imageHandlerIndex);
    expect(imageReserveIndex).toBeGreaterThan(imageHandlerIndex);
    expect(imageReserveIndex).toBeLessThan(imageRenderStateIndex);

    const nativeSpeechBranchIndex = mainTsx.indexOf('if (nativeSpeechHost) {');
    const nativeSpeechBranchEnd = mainTsx.indexOf("logVoiceInputState('debug', 'microphone_start_requested')", nativeSpeechBranchIndex);
    const nativeSpeechBranch = mainTsx.slice(nativeSpeechBranchIndex, nativeSpeechBranchEnd);
    const speechReserveIndex = mainTsx.indexOf('await androidSpeechRuntime.reserveStart()', nativeSpeechBranchIndex);
    const credentialStateIndex = mainTsx.indexOf('await androidSpeechRuntime.credentialState()', nativeSpeechBranchIndex);
    const startModeIndex = mainTsx.indexOf('resolveAndroidSpeechCredentialStartMode({', nativeSpeechBranchIndex);
    const speechStartIndex = mainTsx.indexOf('await androidSpeechRuntime.start(', nativeSpeechBranchIndex);
    expect(speechReserveIndex).toBeGreaterThan(nativeSpeechBranchIndex);
    expect(speechReserveIndex).toBeLessThan(credentialStateIndex);
    expect(credentialStateIndex).toBeLessThan(startModeIndex);
    expect(startModeIndex).toBeLessThan(speechStartIndex);
    expect(nativeSpeechBranch).toContain("if (credentialStartMode === 'sync') {");
    expect(nativeSpeechBranch).toContain("if (!connectedRef.current) await connect({silentReconnect: true});");
  });
});

describe('workspace session actions', () => {
  test('wires a unified command and skill menu with native action dispatch', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain("from '../chat/session/chatSessionActions';");
    expect(mainTsx).toContain('buildChatSessionActionOptions(');
    expect(mainTsx).toContain('selectedChatSession?.sessionActions,');
    expect(mainTsx).toContain('selectedChatConfigOptions,');
    expect(mainTsx).toContain("command.behavior === 'invoke'");
    expect(mainTsx).toContain('option.kind === \'skill\'');
    expect(mainTsx).toContain('option.icon');
    expect(mainTsx).toContain('option.disabledReason');
    expect(mainTsx).toContain('service.statusProjectSession(');
    expect(mainTsx).toContain('service.enqueueProjectSessionItem(targetProjectId, sessionId, {');
    expect(mainTsx).not.toContain('shiftNextQueuedChatItem(');
    expect(mainTsx).toContain('<AppSessionStatusDialog');
    expect(mainTsx).not.toContain("agentType === 'codex'");
  });

  test('intercepts typed actions before attachment upload and retains server queue projection on disconnect', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const sendStart = mainTsx.indexOf('const sendChatMessage = async');
    const parseIndex = mainTsx.indexOf('resolveStandaloneSessionAction(', sendStart);
    const uploadIndex = mainTsx.indexOf('uploadChatAttachmentsForSend(', sendStart);

    expect(parseIndex).toBeGreaterThan(sendStart);
    expect(parseIndex).toBeLessThan(uploadIndex);
    expect(mainTsx).not.toContain('chatSessionQueuesByKeyRef.current = {};');
    expect(mainTsx).not.toContain('setChatSessionQueuesByKey({});');
  });

  test('surfaces compact request failures in the active workspace', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const requestStart = mainTsx.indexOf('const requestSessionCompaction = async');
    const requestEnd = mainTsx.indexOf('const refreshSessionStatusDialog = async', requestStart);
    const requestBody = mainTsx.slice(requestStart, requestEnd);

    expect(requestStart).toBeGreaterThanOrEqual(0);
    expect(requestEnd).toBeGreaterThan(requestStart);
    expect(requestBody).toContain('service.enqueueProjectSessionItem(targetProjectId, sessionId, {');
    expect(requestBody).toContain('setToastMessage(`Context compaction failed: ${message}`);');
    expect(requestBody).toContain('throw errorValue;');
  });
});

describe('provider-aware session labels', () => {
  test('uses the shared agent tag for session badges while preserving request normalization', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain("from '../chat/projectAgents'");
    expect(mainTsx).toContain("from '../chat/AgentTag'");
    expect((mainTsx.match(/agentDisplayLabel\(/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(mainTsx).not.toContain('normalizeAgentTypeName(draft.agentType)');
    expect(mainTsx).not.toContain('normalizeAgentTypeName(sessionAgent)');
    expect(mainTsx).toContain('{agentDisplayLabel(sheetMenu.agentType)}');
    expect(mainTsx).toContain('{agentDisplayLabel(actionMenu.agentType)}');
    expect(mainTsx).toContain('agentType = normalizeAgentTypeName(agentType);');
  });
});

describe('Agent choice menu', () => {
  test('shares one grouped pill menu across mobile and wide new/resume entry points', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain("from '../chat/AgentChoiceMenu';");
    expect(mainTsx).toContain('<AgentChoiceMenu');
    expect(mainTsx).toContain('variant="mobile"');
    expect(mainTsx).toContain('variant="wide"');
    expect(mainTsx).toContain('handleMobileProjectCreateSession(');
    expect(mainTsx).toContain('handleMobileProjectResumeAgent(');
    expect(mainTsx).toContain('handleWideProjectCreateSession(');
    expect(mainTsx).toContain('handleWideProjectResumeAgent(');
    expect(mainTsx).not.toContain('sheetAgents.map(agentType => (');
    expect(mainTsx).not.toContain('agents.map(agentType => (');

    const stylesCss = readSourceText(path.join(projectRoot, 'web', 'src', 'styles', 'sessionlist.css'));
    expect(stylesCss).toContain('.agent-choice-pill');
    expect(stylesCss).toContain('.agent-choice-pill-dot');
    expect(stylesCss).toContain('border-radius: 999px;');

    const choiceMenuBlock = cssRuleBlock(stylesCss, '.agent-choice-menu');
    expect(choiceMenuBlock).toContain('flex-direction: column;');
    const groupPillsBlock = cssRuleBlock(stylesCss, '.agent-choice-group-pills');
    expect(groupPillsBlock).toContain('display: grid;');

    // Mobile pills share the desktop specs (no separate mobile override).
    expect(stylesCss).not.toContain('.agent-choice-menu.mobile .agent-choice-pill');
  });
});

describe('top bar action entry points', () => {
  test('uses the product mark for the shared mobile App Menu trigger', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain("'chat-menu-icon-button chat-menu-settings-button chat-menu-product-button'");
    expect(mainTsx).toContain('<WheelMakerAppMenu');
    expect(mainTsx).toContain('onOpenSettings={handleDesktopSettingsSelect}');
    expect(mainTsx).toContain('onOpenReleasePublishing={openReleasePublishing}');
  });

  test('leaves title project dismissal to its dedicated outside-click handler', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const globalPointerStart = mainTsx.indexOf('useEffect(() => {\n    const onPointer = () => {');
    const globalPointerEnd = mainTsx.indexOf('  }, []);', globalPointerStart);
    const globalPointerEffect = mainTsx.slice(globalPointerStart, globalPointerEnd);

    expect(globalPointerStart).toBeGreaterThanOrEqual(0);
    expect(globalPointerEffect).toContain('setProjectMenuOpen(false);');
    expect(globalPointerEffect).not.toContain('setChatTitleProjectMenuOpen(false);');
  });

  test('keeps a title-bar menu open until its own toggle handles the click', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const captureEffectStart = mainTsx.indexOf('const closeSidebarMenusOnOtherButton = (event: PointerEvent) => {');
    const captureEffectEnd = mainTsx.indexOf("window.addEventListener('pointerdown', closeSidebarMenusOnOtherButton, true);", captureEffectStart);
    const captureEffect = mainTsx.slice(captureEffectStart, captureEffectEnd);

    expect(captureEffectStart).toBeGreaterThanOrEqual(0);
    expect(captureEffectEnd).toBeGreaterThan(captureEffectStart);
    expect(captureEffect).toContain("target?.closest('.chat-hub-summary-button')");
    expect(captureEffect).toContain("target?.closest('.chat-title-project-button')");
    expect(captureEffect).toContain("target?.closest('.chat-title-prompt-icon-button, .chat-title-session-button')");
    expect(captureEffect).toContain('closeSidebarTransientMenus(keepOpen);');
  });

  test('keeps the Hub menu open while using confirmation dialog buttons', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const selectorStart = mainTsx.indexOf('const SIDEBAR_TRANSIENT_MENU_SELECTOR = [');
    const selectorEnd = mainTsx.indexOf("].join(', ');", selectorStart);
    const selectorBlock = mainTsx.slice(selectorStart, selectorEnd);

    expect(selectorStart).toBeGreaterThanOrEqual(0);
    expect(selectorEnd).toBeGreaterThan(selectorStart);
    expect(selectorBlock).toContain("'.app-confirm-dialog'");
  });
});

describe('mobile project action sheet resume entry', () => {
  test('offers resume from the actions phase reusing the existing resume flow', () => {
    const main = readSourceText(path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const actionsStart = main.indexOf("sheetMenu.kind === 'actions' ? (");
    const actionsEnd = main.indexOf("sheetMenu.phase === 'agents'", actionsStart);
    const actionsBody = main.slice(actionsStart, actionsEnd);

    expect(actionsBody).toContain('>Resume session<');
    expect(actionsBody).toContain('SessionIcon name="import"');
    expect(actionsBody).toContain("openMobileProjectActionMenu(sheetMenu.projectId, 'resume')");
  });
});
