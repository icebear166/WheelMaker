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
  test('composer text changes do not force desktop layout measurement', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('const shouldMeasureChatComposerLayout = tab === \'chat\' && !isWide;');
    expect(mainTsx).toContain('if (shouldMeasureChatComposerLayout) {');
    expect(mainTsx).toContain('}, [resizeChatComposerTextarea, measureChatComposerTop, chatComposerText, selectedChatId, currentChatDraftKey, shouldMeasureChatComposerLayout]);');
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
    const stylesCss = readWebStyles(projectRoot);
    const nonSelectableSelectors = [
      '.desktop-window-controls',
      '.floating-control-stack',
      '.registry-debug-panel-header',
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

    const contextMenuStart = mainTsx.indexOf('const openProjectSessionContextMenu = (');
    const contextMenuEnd = mainTsx.indexOf('setProjectSessionActionMenu({', contextMenuStart);
    expect(contextMenuStart).toBeGreaterThanOrEqual(0);
    expect(contextMenuEnd).toBeGreaterThan(contextMenuStart);
    const contextMenuBody = mainTsx.slice(contextMenuStart, contextMenuEnd);
    expect(contextMenuBody).toContain(
      'projectSessionLongPressTargetRef.current = projectSessionActionKey(targetProjectId, normalizedSessionId);',
    );
    expect(contextMenuBody).not.toContain("projectSessionLongPressTargetRef.current = '';");
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
      '.chat-main-message .chat-option-reply-inline-button',
      '.chat-main-message .chat-option-reply-inline-button *',
      '.chat-main-message .chat-option-reply-static',
      '.chat-main-message .chat-option-reply-static *',
      '.chat-main-message .chat-confirmation-reply-action',
      '.chat-main-message .chat-confirmation-reply-action *',
      '.chat-option-reply-inline-button',
      '.chat-confirmation-reply-action',
      '.chat-prompt-attachment-strip',
      '.diff-inline .wm-shiki-diff-gutter',
    ];

    for (const selector of nonContentSelectors) {
      const block = cssRuleBlockContainingSelector(stylesCss, selector);
      expect(block).not.toContain('-webkit-user-select: text;');
      expect(block).not.toContain('user-select: text;');
    }

    const chatReplyChromeSelectors = [
      '.chat-main-message .chat-option-reply-inline-button',
      '.chat-main-message .chat-option-reply-inline-button *',
      '.chat-main-message .chat-option-reply-static',
      '.chat-main-message .chat-option-reply-static *',
      '.chat-main-message .chat-confirmation-reply-action',
      '.chat-main-message .chat-confirmation-reply-action *',
    ];

    for (const selector of chatReplyChromeSelectors) {
      const block = cssRuleBlockContainingSelector(stylesCss, selector);
      expect(block).toContain('-webkit-touch-callout: none;');
      expect(block).toContain('-webkit-user-select: none;');
      expect(block).toContain('user-select: none;');
    }

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
    expect(repositoryTs).toContain('payload: afterTurnIndex > 0 ? {sessionId, afterTurnIndex} : {sessionId}');
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
    expect(repositoryTs).toContain('RegistryMethods.SessionSend');
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
    expect(workspaceServiceTs).toContain('async sendSessionMessage(');
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
    expect(mainTsx).toContain("const result = await service.createProjectSession(targetProjectId, agentType, '');");
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
    expect(mainTsx).toContain('const chatConfigOverflowOpen = workspaceUiState.mobile.chatConfigOverflowOpen;');
    expect(mainTsx).toContain("dispatchWorkspaceUi({ type: 'mobile/setChatConfigOverflowOpen', next });");
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
    expect(mainTsx).toContain('resolveChatScrollToBottomVisibility({');
    expect(mainTsx).toContain('const scrollChatToBottom = useCallback((force = false) => {');
    expect(mainTsx).toContain('shouldAutoScrollChatToBottom({');
    expect(mainTsx).toContain("chatVirtuosoListRef.current?.scrollToBottom('auto');");
    expect(mainTsx).not.toContain('const autoscrollChatToBottom = useCallback(() => {');
    expect(mainTsx).not.toContain('chatVirtuosoListRef.current?.autoscrollToBottom();');
    expect(mainTsx).not.toContain('container.scrollTop = nextScrollTop;');
    expect(mainTsx).toContain('const forceChatScrollToBottom = useCallback(() => {');
    expect(mainTsx).toContain('chatAutoScrollFollowRef.current = true;');
    expect(mainTsx).toContain('scrollChatToBottom(true);');
    expect(mainTsx).toContain("import { resolveChatScrollBottomButtonOffset } from '../chat/layout/chatScrollBottomButton';");
    expect(mainTsx).toContain('const [chatComposerHeight, setChatComposerHeight] = useState(0);');
    expect(mainTsx).toContain('setChatComposerHeight(current => (current === nextHeight ? current : nextHeight));');
    expect(mainTsx).toContain("'--chat-scroll-bottom-offset': `${resolveChatScrollBottomButtonOffset({");
    expect(mainTsx).toContain('composerHeight: chatComposerHeight,');
    expect(mainTsx).toContain('keyboardInset: chatKeyboardInset,');
    expect(mainTsx).toContain('useLayoutEffect(() => {');
    expect(mainTsx).toContain('resizeChatComposerTextarea();');
    expect(mainTsx).toContain('if (shouldMeasureChatComposerLayout) {');
    expect(mainTsx).toContain('}, [resizeChatComposerTextarea, measureChatComposerTop, chatComposerText, selectedChatId, currentChatDraftKey, shouldMeasureChatComposerLayout]);');
    expect(mainTsx).not.toContain('const chatBottomFollowAction = resolveChatBottomFollowAction({');
    expect(mainTsx).not.toContain("if (chatBottomFollowAction === 'scrollToBottom') {");
    expect(mainTsx).toContain('}, [tab, selectedChatId, chatMessages, chatPendingPromptsByKey, chatLoading, resizeChatComposerTextarea]);');
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
    expect(mainTsx).toContain('title="Attach file"');
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
    expect(mainTsx).toContain('resolveMarkdownImageExportWidth,');
    expect(mainTsx).toContain('type MarkdownImageExportMode,');
    expect(mainTsx).toContain('outputResponseImage,');
    expect(mainTsx).toContain('reserveResponseImageShare,');
    expect(mainTsx).toContain("} from '../chat/export/responseImageOutput';");
    expect(mainTsx).toContain('exportMode: MarkdownImageExportMode;');
    expect(mainTsx).toContain('const markdownImageExportWidth = resolveMarkdownImageExportWidth(exportMode);');
    expect(mainTsx).toContain("style={{'--markdown-image-export-width': `${markdownImageExportWidth}px`} as React.CSSProperties}");
    expect(mainTsx).toContain('data-export-mode={exportMode}');
    expect(mainTsx).toContain('const [toastMessage, setToastMessage] = useState(\'\');');
    expect(mainTsx).toContain("if (result.status === 'copied') {");
    expect(mainTsx).toContain("setToastMessage('Response image copied to clipboard.');");
    expect(mainTsx).toContain('className="app-toast"');
    expect(mainTsx).toContain('const copyRange = message.method === \'prompt_done\'');
    expect(chatTurnTsx).toContain('className="chat-prompt-actions"');
    expect(chatTurnTsx).toContain('className="chat-prompt-action-button"');
    expect(chatTurnTsx).toContain('aria-label="Copy response markdown"');
    expect(chatTurnTsx).toContain('codicon codicon-copy');
    expect(chatTurnTsx).toContain('aria-label="Export response markdown image"');
    expect(chatTurnTsx).toContain('codicon codicon-device-camera');
    expect(chatTurnTsx).toContain('onExportPromptDoneImage');
    expect(mainTsx).toContain('exportPromptDoneMarkdownImageEvent(doneTurnIndex)');
    expect(mainTsx).toContain('exportingMarkdownImageTurnIndex');
    expect(chatTurnTsx).toContain('disabled={copyDisabled || exportBusy}');
    expect(chatTurnTsx).toContain('aria-busy={exportBusy}');
    expect(mainTsx).toContain('outputResponseImage({');
    expect(mainTsx).toContain('setError(`Failed to share response image: ${message}`);');
    expect(mainTsx).toContain('img: ({ src, alt, ...rest }) => (');
    expect(mainTsx).toContain('crossOrigin="anonymous"');
    expect(stylesCss).toContain('.chat-prompt-actions {');
    expect(stylesCss).toContain('.chat-prompt-action-button {');
    expect(stylesCss).toContain('.markdown-image-export-host {');
    expect(stylesCss).toContain('.markdown-image-export-surface {');
    expect(cssRuleBlock(stylesCss, '.markdown-image-export-host')).toContain('width: var(--markdown-image-export-width, 760px);');
    expect(cssRuleBlock(stylesCss, '.markdown-image-export-host')).not.toContain('max-width: calc(100vw - 32px);');
    expect(cssRuleBlock(stylesCss, '.markdown-image-export-surface table')).toContain('table-layout: fixed;');
    expect(cssRuleBlock(stylesCss, '.markdown-image-export-surface table')).toContain('max-width: 100%;');
    const exportTableCellBlock = cssRuleBlockContainingSelector(stylesCss, '.markdown-image-export-surface th');
    expect(exportTableCellBlock).toContain('overflow-wrap: anywhere;');
    expect(exportTableCellBlock).toContain('word-break: break-word;');
    expect(exportTableCellBlock).toBe(cssRuleBlockContainingSelector(stylesCss, '.markdown-image-export-surface td'));
    const exportLinkBlock = cssRuleBlockContainingSelector(stylesCss, '.markdown-image-export-surface a');
    expect(exportLinkBlock).toContain('color: color-mix(in srgb, var(--accent-primary) 82%, var(--text-primary));');
    expect(exportLinkBlock).toBe(cssRuleBlockContainingSelector(stylesCss, '.markdown-image-export-surface a:visited'));
    expect(stylesCss).toContain('.app-toast {');
    const sendExistingStart = mainTsx.indexOf('const sendChatMessage = async');
    const sendEnd = mainTsx.indexOf('const sendChatMessageEvent = useStableEvent(sendChatMessage);', sendExistingStart);
    const sendBlock = mainTsx.slice(sendExistingStart, sendEnd);
    const sendAwait = mainTsx.indexOf('const result = await service.sendProjectSessionMessage(selectedProjectId, {', sendExistingStart);
    expect(sendExistingStart).toBeGreaterThanOrEqual(0);
    expect(sendEnd).toBeGreaterThan(sendExistingStart);
    expect(sendBlock).toContain("if (trimmedText === '/cancel' && sourceAttachments.length === 0 && !options.blocksOverride) {");
    expect(sendBlock).toContain("setError('Use the stop button to cancel in app.');");
    expect(sendBlock).toContain('rememberPendingChatPrompt(runtimeKey, {');
    expect(sendBlock).toContain("status: 'confirming',");
    expect(sendBlock).toContain('const result = await service.sendProjectSessionMessage(selectedProjectId, {');
    expect(sendBlock).toContain('if (!result.ok) {');
    expect(sendBlock).toContain('markPendingChatPromptUndelivered(runtimeKey');
    expect(sendBlock).toContain('if (shouldApplySentChatSelection(selectedChatKeyRef.current, sentFromKey)) {');
    const sendSelectionGuard = sendBlock.indexOf('if (shouldApplySentChatSelection(selectedChatKeyRef.current, sentFromKey)) {');
    const sendSelectionApply = sendBlock.indexOf('applySelectedChatKey(nextSelectedKey);', sendSelectionGuard);
    expect(sendSelectionGuard).toBeGreaterThan(sendBlock.indexOf('const nextSelectedKey = chatSessionKeyFromParts(selectedProjectId, nextSessionId);'));
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
    expect(mainTsx).toContain('const mergedSessions = mergeChatSessionList(knownSessions, sortedSessions);');
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
    expect(mainTsx).toContain('className="drawer-project-header"');
    expect(mainTsx).toContain('className="drawer-project-pill"');
    expect(mainTsx).toContain('className="drawer-settings-icon-btn"');
    expect(mainTsx).toMatch(
      /className="drawer-project-header"[\s\S]*?className="drawer-settings-icon-btn"[\s\S]*?className="drawer-project-pill"[\s\S]*?className="project-wrap"/,
    );
    expect(mainTsx).toContain('setSidebarSettingsOpen(true);');
    expect(mainTsx).toContain("tab === 'chat' && !isWide ? renderMobileChatSessionSheet() : renderSidebarMain()");
    expect(mainTsx).toContain("tab === 'chat' ? renderWideProjectSessionNav() : renderSidebarMain(false)");
    expect(mainTsx).toContain('renderChatSessionHeader(false)');
    expect(mainTsx).not.toContain('chatSidebarTitleSearchOpen');
    expect(mainTsx).not.toContain('className="desktop-activity-bar"');
    expect(mainTsx).toContain('const settingsShortcutBar = sidebarSettingsOpen ? (');
    expect(mainTsx).toContain('const desktopSettingsScreen = isWide && sidebarSettingsOpen ? (');
    expect(mainTsx).toContain('const mobileSettingsScreen = !isWide && sidebarSettingsOpen ? (');
    expect(mainTsx).toContain('<SettingsScreen');
    expect(mainTsx).toContain('<MobileSettingsScreen');
    expect(mainTsx).toContain('className="desktop-settings-screen"');
    expect(mainTsx).toContain('shortcutBar={settingsShortcutBar}');
    expect(mainTsx).toContain('onBackdropClick={handleMobileSettingsBackButton}');
    expect(settingsSurfaceTsx).toContain('export function SettingsScreen');
    expect(settingsSurfaceTsx).toContain('onBackdropClick?: () => void;');
    expect(settingsSurfaceTsx).toContain('const handleBackdropClick = React.useCallback');
    expect(settingsSurfaceTsx).toContain('if (event.target !== event.currentTarget || !onBackdropClick) {');
    expect(settingsSurfaceTsx).toContain('onBackdropClick();');
    expect(settingsSurfaceTsx).toContain('className={effectiveScreenClassName}');
    expect(settingsSurfaceTsx).toContain('onClick={handleBackdropClick}');
    expect(settingsSurfaceTsx).toContain('className="mobile-settings-panel settings-workbench-panel"');
    expect(settingsSurfaceTsx).toContain('aria-modal="true"');
    expect(settingsSurfaceTsx).toContain('className="mobile-settings-nav settings-workbench-nav"');
    expect(settingsSurfaceTsx).toContain('className="mobile-settings-back"');
    expect(settingsSurfaceTsx).toContain('<div className="mobile-settings-title">{title}</div>');
    expect(settingsSurfaceTsx).toContain('className="mobile-settings-group"');
    const chatSettingsStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'chat'");
    const hideToolCallsSettingStart = settingsRootTsx.indexOf('Hide Tool Calls', chatSettingsStart);
    expect(chatSettingsStart).toBeGreaterThanOrEqual(0);
    expect(settingsRootTsx).not.toContain('Use Latest Prompt Title');
    expect(hideToolCallsSettingStart).toBeGreaterThan(chatSettingsStart);
    expect(mainTsx).not.toContain('className="sidebar-footer"');
    expect(mainTsx).toContain('className="floating-control-stack"');
    expect(mainTsx).toContain('className="gesture-nav-control"');
    expect(mainTsx).toContain('className="gesture-nav-pill"');
    expect(mainTsx).toContain('className="gesture-nav-button gesture-nav-current-button"');
    expect(mainTsx).not.toContain('className="floating-nav-group"');
    expect(mainTsx).not.toContain('className="floating-nav-button"');
    expect(mainTsx).not.toContain('className="drawer-toggle-bubble"');
    expect(mainTsx).toContain('const floatingControlSideRef = useRef(floatingControlSide);');
    expect(mainTsx).toContain('floatingControlSideRef.current = floatingControlSide;');
    expect(mainTsx).toContain("const [floatingSidePulse, setFloatingSidePulse] = useState<PersistedFloatingControlSide | ''>('');");
    expect(mainTsx).toContain('const floatingSidePulseTimerRef = useRef<number | null>(null);');
    expect(mainTsx).toContain('const pulseFloatingControlSide = useCallback(');
    expect(mainTsx).toContain('const closeMobileDrawerCompanionOverlays = useCallback(() => {');
    expect(mainTsx).toContain('const handleMobileBreadcrumbProjectClick = useCallback(() => {');
    expect(mainTsx).toContain('closeMobileDrawerCompanionOverlays();');
    expect(mainTsx).toContain('setDrawerOpen(open => !open);');
    expect(mainTsx).toContain('className="breadcrumb-project-button breadcrumb-project-name"');
    expect(mainTsx).toContain('onClick={handleMobileBreadcrumbProjectClick}');
    expect(mainTsx).not.toContain('const handleFloatingControlButtonPointerDown = useCallback(');
    expect(mainTsx).not.toContain('const beginFloatingPress = useCallback(');
    expect(mainTsx).toContain('event.stopPropagation();');
    expect(mainTsx).not.toContain('handleFloatingNavSelect');
    expect(mainTsx).not.toContain('handleFloatingChatSelect');
    expect(mainTsx).not.toContain('handleFloatingDrawerToggle');
    expect(mainTsx).toContain('onPointerDown={handleGestureNavigationButtonPointerDown}');
    expect(mainTsx).toContain('onClick={handleGestureNavigationCurrentSelect}');
    expect(mainTsx).toContain('const floatingControlYRatio = workspaceUiState.mobile.floatingControlYRatio;');
    expect(mainTsx).toContain('const floatingDragState = workspaceUiState.transient.floatingDragState as FloatingDragState | null;');
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
    expect(floatingMoveBlock).toContain('window.localStorage.setItem(PORT_RELAY_FLOATING_SIDE_STORAGE_KEY, nextSide);');
    expect(floatingMoveBlock).toContain('triggerMobileHaptic();');
    expect(floatingMoveBlock).toContain('pulseFloatingControlSide(nextSide);');
    expect(floatingMoveBlock).toContain('closeMobileDrawerCompanionOverlays();');
    expect(mainTsx).not.toContain('style={narrowContentInsetStyle}');
    expect(mainTsx).toContain('className="breadcrumb-title"');
    expect(mainTsx).toContain('className="breadcrumb-project-button breadcrumb-project-name"');
    expect(mainTsx).toContain('No Selected Session');
    expect(mainTsx).toContain('No Selected Diff');
    expect(mainTsx).toContain('data-side-pulse={floatingSidePulse}');
    expect(mainTsx).toContain('className="floating-control-drag-backdrop"');
    expect(mainTsx).toContain('className="floating-control-dock-rail left"');
    expect(mainTsx).toContain('className="floating-control-dock-rail right"');
    expect(mainTsx).toContain('className="block-title chat-title-bar"');
    expect(mainTsx).toContain("{selectedFile || 'Select a file'}");
    expect(mainTsx).toContain("{selectedDiff || 'Select a changed file'}");
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
    expect(mainTsx).toContain('className="codicon codicon-settings-gear"');
    expect(mainTsx).not.toContain("className={`codicon ${chatConfigOverflowOpen ? 'codicon-chevron-up' : 'codicon-chevron-down'}`}");
    expect(mainTsx).not.toContain('project-menu-state');
    expect(mainTsx).not.toContain("projectItem.online ? 'online' : 'offline'");
    expect(mainTsx).not.toContain('+{chatConfigOverflowOptions.length}');
    expect(mainTsx).not.toContain("title={chatConfigOverflowOpen ? 'Hide config options' : 'Show config options'}");
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
    expect(mainTsx).toContain('merged = messagesFromTurnStore(runtimeKey, sessionId);');
    expect(mainTsx).toContain('chatReadRepairQueueRef.current.request(runtimeKey, gapReadCursor.turnIndex');
    const normalizedPayload = mainTsx.indexOf('const normalizedPayload = normalizeSessionMessagePayload(payload);');
    const gapReadCursor = mainTsx.indexOf('const gapReadCursor = shouldReadRepairForIncomingTurn(turnState, incomingTurn);', normalizedPayload);
    const realtimeMerge = mainTsx.indexOf('mergeRealtimeTurn(turnState, incomingTurn);', gapReadCursor);
    const materializeGate = mainTsx.indexOf('if (shouldMaterializeRealtimeSessionMessages(isSelectedSession)) {', realtimeMerge);
    const materializeMessages = mainTsx.indexOf('merged = messagesFromTurnStore(runtimeKey, sessionId);', materializeGate);
    const incomingStoreApply = mainTsx.indexOf('chatMessageStoreRef.current[runtimeKey] = merged;', materializeMessages);
    const incomingVisibleApply = mainTsx.indexOf('setVisibleChatMessagesForRuntimeKey(runtimeKey, merged, {', incomingStoreApply);
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
    expect(stylesCss).toContain('.drawer-project-header {');
    expect(stylesCss).toContain('.drawer-project-pill {');
    expect(stylesCss).toContain('.drawer-settings-icon-btn {');
    expect(stylesCss).toContain('.mobile-settings-screen {');
    expect(stylesCss).toContain('.mobile-settings-nav {');
    expect(stylesCss).toContain('.mobile-settings-back {');
    expect(stylesCss).toContain('.mobile-settings-group {');
    expect(stylesCss).toContain('.mobile-settings-screen .settings-row {');
    expect(stylesCss).toContain('.mobile-settings-screen .settings-danger-row {');
    expect(stylesCss).toContain('.mobile-settings-shortcut-label {');
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
    expect(stylesCss).toContain('padding: calc(var(--wm-safe-area-top) + 6px) 7px 6px;');
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
      /\.floating-control-stack-layer\[data-side-pulse='left'\] \.floating-control-dock-rail\.left,[\s\S]*\.floating-control-stack-layer\[data-side-pulse='right'\] \.floating-control-dock-rail\.right \{[\s\S]*animation: floatingDockRailPulse 160ms ease-out;[\s\S]*\}/,
    );
    expect(stylesCss).toContain('@keyframes floatingDockRailPulse');
    expect(stylesCss).not.toContain('.floating-nav-group {');
    expect(stylesCss).not.toContain('.floating-nav-indicator {');
    expect(stylesCss).not.toContain('.floating-nav-button {');
    expect(stylesCss).toContain('.gesture-nav-control {');
    expect(stylesCss).toContain('.gesture-nav-pill {');
    expect(stylesCss).toContain('.gesture-nav-button {');
    expect(stylesCss).toContain('.drawer-toggle-bubble {');
    expect(cssRuleBlock(stylesCss, '.gesture-nav-pill')).toContain('padding: 0;');
    expect(cssRuleBlock(stylesCss, '.gesture-nav-pill')).toContain('grid-template-rows: 48px;');
    expect(stylesCss).toMatch(
      /\.drawer-toggle-bubble\[data-active='true'\] \{[\s\S]*background: transparent;[\s\S]*border-color: color-mix\(in srgb, var\(--accent-primary\) 72%, transparent\);[\s\S]*color: color-mix\(in srgb, var\(--accent-primary\) 88%, var\(--text-primary\)\);/,
    );
    expect(stylesCss).toMatch(
      /\.gesture-nav-control\[data-expanded='false'\] \.gesture-nav-current-button \{[\s\S]*width: 50px;[\s\S]*height: 48px;[\s\S]*\}/,
    );
    const activeGestureButtonBlock = cssRuleBlock(stylesCss, ".gesture-nav-current-button[data-active='true']");
    expect(activeGestureButtonBlock).toContain('border-color: color-mix(in srgb, var(--accent-primary) 54%, var(--border-subtle));');
    expect(activeGestureButtonBlock).toContain('color: color-mix(in srgb, var(--accent-primary) 88%, var(--text-primary));');
    expect(activeGestureButtonBlock).not.toContain('background:');
    expect(activeGestureButtonBlock).not.toContain('box-shadow:');
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
    expect(mainTsx).toContain('onClick={() => removeChatAttachment(attachment.id)}');
    expect(mainTsx).toContain('disabled={chatSendDisabled}');
    expect(stylesCss).not.toContain('.project-presence {');
    expect(stylesCss).not.toContain('.project-dirty {');
    expect(stylesCss).not.toContain('.chat-permission-button');
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
    expect(mainTsx).toContain('const renderChatBreadcrumbTitle = () => (isWide ? renderDesktopChatBreadcrumbTitle() : renderMobileChatBreadcrumbTitle());');
    expect(mainTsx).toContain('className="breadcrumb-title chat-breadcrumb-title"');
    expect(mainTsx).toContain('className={`chat-title-session-button chat-title-session-text title-text breadcrumb-current${chatTitlePromptMenuOpen ? \' open\' : \'\'}`}');
    expect(mainTsx).toContain('onClick={toggleChatTitlePromptMenu}');
    expect(mainTsx).toContain('renderBreadcrumbTitle(breadcrumbProjectName, fileBreadcrumbLabel)');
    expect(mainTsx).toContain('renderBreadcrumbTitle(breadcrumbProjectName, gitBreadcrumbLabel)');
  });

  test('chat drawer header keeps tools left and hub browser right', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const [chatHubMenuOpen, setChatHubMenuOpen] = useState(false);');
    expect(mainTsx).toContain('const chatHubMenuRef = useRef<HTMLDivElement | null>(null);');
    expect(mainTsx).toContain('const renderChatHubSummary = useCallback(() => {');
    expect(mainTsx).not.toContain('const renderChatHubSummary = useCallback((mobile = false) => {');
    expect(mainTsx).toContain('const hubCount = registryHubs.length;');
    expect(mainTsx).toContain('const projectCount = projects.length;');
    expect(mainTsx).toContain('if (!chatHubMenuOpen) return;');
    expect(mainTsx).toContain("if (event.key === 'Escape') {");
    expect(mainTsx).toContain("if (tab !== 'chat' || sidebarSettingsOpen) {");
    expect(mainTsx).toContain('if (!chatHubMenuRef.current.contains(event.target as Node)) {');
    expect(mainTsx).toContain("!targetElement.closest('.chat-hub-color-palette')");
    expect(mainTsx).toContain("!targetElement.closest('.chat-hub-color-square')");
    expect(mainTsx).toContain("aria-label={`Show connected hubs, ${chatHubSummaryLabel}, ${chatHubProjectLabel}`}");
    expect(mainTsx).toContain('aria-expanded={chatHubMenuOpen}');
    expect(mainTsx).toContain("const chatHubSummaryLabel = `${hubCount} ${hubCount === 1 ? 'Hub' : 'Hubs'}`;");
    expect(mainTsx).toContain("const chatHubProjectLabel = `${projectCount} ${projectCount === 1 ? 'Project' : 'Projects'}`;");
    expect(mainTsx).toContain('<span className="chat-hub-summary-label">{chatHubSummaryLabel}</span>');
    expect(mainTsx).toContain('<span className="chat-hub-summary-project-label">{chatHubProjectLabel}</span>');
    expect(mainTsx).not.toContain('<span className="chat-hub-summary-count">{hubCount}</span>');
    expect(mainTsx).toContain('{registryHubs.length > 0 ? (');
    expect(mainTsx).toContain('registryHubs.map(hub => {');
    expect(mainTsx).toContain('<span className="chat-hub-row-name">{hub.hubId}</span>');
    expect(mainTsx).toContain('<div className="chat-hub-empty">No hubs</div>');
    expect(mainTsx).toContain('const renderChatSessionHeader = (mobile: boolean) => {');
    expect(mainTsx).toContain('const renderChatMenuSettingsButton = () => (');
    expect(mainTsx).toContain('className="chat-menu-icon-button chat-menu-settings-button"');
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
    expect(mainTsx).toMatch(
      /const renderChatSessionHeader = \(mobile: boolean\) => \{[\s\S]*?const chatSessionHeaderClassName = `sidebar-title-row chat-session-header\$\{sessionSearchHeaderExpanded \? ' search-open' : ''\}\$\{mobile \? ' mobile' : ''\}`;[\s\S]*?\{!sessionSearchHeaderExpanded \? renderChatMenuSettingsButton\(\) : null\}[\s\S]*?<div className="chat-sidebar-title-actions">[\s\S]*?\{renderChatHubSummary\(\)\}[\s\S]*?\{renderChatArchiveControls\(\)\}[\s\S]*?\{renderChatHeaderSearchControls\(\)\}/,
    );
    const renderMainStart = mainTsx.indexOf('const renderMain = () => {');
    const chatMainStart = mainTsx.indexOf("if (tab === 'chat') {", renderMainStart);
    const chatMainEnd = mainTsx.indexOf('if (tab === ', chatMainStart + 1);
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
  });

  test('mobile file and git drawer project header matches the chat drawer height', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("{!isWide && tab !== 'chat' ? (");
    expect(mainTsx).toContain('className="drawer-project-header"');

    const drawerProjectHeaderBlock = cssRuleBlock(stylesCss, '.drawer-project-header');
    expect(drawerProjectHeaderBlock).toContain('height: calc(var(--wm-safe-area-top) + 50px);');
    expect(drawerProjectHeaderBlock).toContain('min-height: calc(var(--wm-safe-area-top) + 50px);');
    expect(drawerProjectHeaderBlock).toContain('max-height: calc(var(--wm-safe-area-top) + 50px);');
    expect(drawerProjectHeaderBlock).toContain('padding: calc(var(--wm-safe-area-top) + 6px) 7px 6px;');
    expect(drawerProjectHeaderBlock).not.toContain('+ 58px');

    const drawerProjectPillBlock = cssRuleBlock(stylesCss, '.drawer-project-pill');
    expect(drawerProjectPillBlock).toContain('height: 36px;');
    expect(drawerProjectPillBlock).toContain('min-height: 36px;');

    const drawerSettingsButtonBlock = cssRuleBlock(stylesCss, '.drawer-settings-icon-btn');
    expect(drawerSettingsButtonBlock).toContain('width: 36px;');
    expect(drawerSettingsButtonBlock).toContain('height: 36px;');
  });

  test('chat composer is a unified command frame with compact custom config pills', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const chatTurnTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'chat', 'ChatTurnView.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const chatComposerStatusCompact = !isWide || windowWidth < 980 || (chatPreviewOpen && windowWidth < 1280);');
    expect(mainTsx).not.toContain('CHAT_QUICK_REPLY_OPTIONS');
    expect(mainTsx).toContain('const [chatPromptMenuOpen, setChatPromptMenuOpen] = useState(false);');
    expect(mainTsx).toContain('const [chatAttachmentTrayOpen, setChatAttachmentTrayOpen] = useState(false);');
    expect(mainTsx).not.toContain('chatQuickReplyMenuOpen');
    expect(mainTsx).toContain('const [chatFileMentionMenuOpen, setChatFileMentionMenuOpen] = useState(false);');
    expect(mainTsx).toContain("const [chatConfigMenuOptionId, setChatConfigMenuOptionId] = useState('');");
    expect(mainTsx).toContain('const status = splitChatComposerStatusOptions(selectedChatConfigOptions, chatComposerStatusCompact);');
    expect(mainTsx).toContain('overflow: status.overflowOptions,');
    expect(mainTsx).toContain("className={`chat-composer-frame${chatComposerDragActive ? ' drag-over' : ''}`}");
    expect(mainTsx).toContain('className="chat-composer-input-row"');
    expect(mainTsx).toContain("const chatComposerStopTriggerClassName = `chat-tool-button chat-composer-stop-trigger${selectedChatPromptRunning ? ' active' : ''}${selectedChatPromptCancelling ? ' cancelling' : ''}`;");
    expect(mainTsx).toContain('className={chatComposerStopTriggerClassName}');
    expect(mainTsx).toContain('title="Commands and skills"');
    expect(mainTsx).toContain('aria-label="Open commands and skills"');
    expect(mainTsx).toContain('className="chat-tool-button chat-slash-button"');
    expect(mainTsx).not.toContain('className="chat-composer-skill-trigger chat-slash-button"');
    expect(mainTsx).toContain('className="codicon codicon-terminal" aria-hidden="true"');
    expect(mainTsx).not.toContain('className="chat-composer-quick-trigger"');
    expect(mainTsx).not.toContain('title="Quick replies"');
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
    expect(mainTsx).toContain('title={selectedChatPromptCancelling ? \'Cancelling prompt\' : \'Cancel prompt\'}');
    expect(mainTsx).toContain('aria-label="Cancel prompt"');
    expect(mainTsx).toContain("className={`codicon ${selectedChatPromptCancelling ? 'codicon-loading codicon-modifier-spin' : 'codicon-stop-circle'} chat-composer-tool-glyph`}");
    expect(mainTsx).not.toContain("className=\"codicon codicon-debug-stop\"");
    expect(mainTsx).not.toContain('chat-stop-glyph');
    expect(mainTsx).not.toContain('chat-stop-square');
    expect(mainTsx).toContain('className="chat-composer-tools"');
    expect(mainTsx).toContain('className="chat-tool-button chat-attachment-plus-button"');
    expect(mainTsx).toContain('className="chat-composer-stop-slot"');
    expect(mainTsx).toContain('aria-label="Open composer tools"');
    expect(mainTsx).toContain('aria-expanded={!selectedChatPromptRunning && chatAttachmentTrayOpen}');
    expect(mainTsx).toContain('className="chat-attachment-action-tray"');
    expect(mainTsx).toContain('className="chat-tool-button chat-file-mention-trigger-button"');
    expect(mainTsx).toContain('className="chat-attachment-action-button file"');
    expect(mainTsx).toContain('className="chat-attachment-action-button photo"');
    expect(mainTsx).not.toContain('className="chat-attachment-action-button code"');
    expect(mainTsx).not.toContain('<span className="chat-attachment-action-label">Code</span>');
    expect(mainTsx).toContain('<span className="chat-attachment-action-label">File</span>');
    expect(mainTsx).toContain('<span className="chat-attachment-action-label">Photo</span>');
    expect(mainTsx).toContain('className="chat-composer-tool-glyph chat-slash-symbol"');
    expect(mainTsx).toContain('className="chat-composer-tool-glyph chat-at-symbol"');
    expect(mainTsx).not.toContain('codicon-code chat-composer-tool-glyph chat-slash-symbol');
    expect(mainTsx).not.toContain('codicon-file-code chat-composer-tool-glyph chat-at-symbol');
    expect(mainTsx).not.toContain('className="chat-tool-button chat-mention-button"');
    expect(mainTsx).toContain('title="Mention files"');
    expect(mainTsx).toContain('aria-label="Mention files"');
    expect(mainTsx).not.toContain('className="chat-mention-symbol"');
    expect(mainTsx).toContain('className="chat-file-mention-menu"');
    expect(mainTsx).toContain('className="chat-file-mention-empty"');
    expect(mainTsx).toContain('aria-label="File mentions"');
    expect(mainTsx).toContain('Index not built');
    expect(mainTsx).toContain('No files found');
    expect(mainTsx).toContain('const openChatFileMentionShortcut = useCallback(() => {');
    expect(mainTsx).not.toContain('className="chat-tool-button chat-skill-button"');
    expect(mainTsx).not.toContain('codicon-wand');
    expect(mainTsx).not.toContain('codicon-symbol-keyword');
    expect(mainTsx).not.toContain('className="chat-tool-button chat-attach-button"');
    expect(mainTsx).toContain('codicon-attach');
    expect(mainTsx).toContain('className="codicon codicon-file-media chat-composer-tool-glyph"');
    expect(mainTsx).toContain('className="codicon codicon-device-camera"');
    expect(mainTsx).not.toContain('codicon-cloud-upload');
    expect(mainTsx).not.toContain('codicon-new-file');
    expect(mainTsx).toContain('chatFileInputRef.current?.click();');
    expect(mainTsx).not.toContain('className={`chat-tool-button chat-stop-button${selectedChatPromptRunning ? \' active\' : \'\'}`}');
    expect(mainTsx).toContain('<VoiceInputButton');
    expect(mainTsx).toContain('<VoiceRecordingBar');
    expect(mainTsx).toContain('extractChatOptionReplies(text)');
    expect(mainTsx).toContain('extractChatConfirmationReply(text)');
    expect(chatTurnTsx).toContain('splitChatOptionReplyText(text)');
    expect(chatTurnTsx).toContain('splitChatConfirmationReplyText(text)');
    expect(chatTurnTsx).toContain('const optionReplyParts = splitChatOptionReplyText(text);');
    expect(chatTurnTsx).toContain('const confirmationReplyParts = splitChatConfirmationReplyText(text);');
    expect(chatTurnTsx).toContain("const hasOptionReplyParts = optionReplyParts.some(part => part.type === 'option');");
    expect(chatTurnTsx).toContain('const selectableOptionReplies = optionReplies.length > 0;');
    expect(chatTurnTsx).toContain('const selectableConfirmationReply = optionReplies.length === 0 ? confirmationReply : null;');
    expect(chatTurnTsx).toContain('className="chat-option-reply-line"');
    expect(chatTurnTsx).toContain('className="chat-option-reply-inline-button"');
    expect(chatTurnTsx).toContain('className="chat-option-reply-static"');
    expect(chatTurnTsx).toContain('className="chat-confirmation-reply-line"');
    expect(chatTurnTsx).toContain('className="chat-confirmation-reply-action"');
    expect(chatTurnTsx).toContain('className="chat-confirmation-reply-check"');
    expect(chatTurnTsx).toContain('className="chat-confirmation-reply-text"');
    expect(chatTurnTsx).toContain('onClick={() => onSelectConfirmationReply?.(part.reply.replyText)}');
    expect(mainTsx).not.toContain('className="chat-option-replies"');
    expect(chatTurnTsx).toContain('onSelectOptionReply?: (label: string) => void;');
    expect(chatTurnTsx).toContain('onSelectConfirmationReply?: (replyText: string) => void;');
    expect(mainTsx).toContain('if (selectedPendingPrompt) {');
    expect(mainTsx).toContain('className="chat-config-pill"');
    expect(mainTsx).toContain('className="chat-config-value-menu"');
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

    const stopTriggerClassStart = mainTsx.indexOf('className={chatComposerStopTriggerClassName}');
    const stopTriggerStart = mainTsx.lastIndexOf('<button', stopTriggerClassStart);
    const stopTriggerEnd = mainTsx.indexOf('</button>', stopTriggerClassStart);
    expect(stopTriggerStart).toBeGreaterThanOrEqual(0);
    expect(stopTriggerEnd).toBeGreaterThan(stopTriggerStart);
    const stopTriggerBlock = mainTsx.slice(stopTriggerStart, stopTriggerEnd);
    expect(stopTriggerBlock).toContain('onPointerDown={event => event.preventDefault()}');
    expect(stopTriggerBlock).toContain('onClick={() => cancelSelectedChatPrompt().catch(() => undefined)}');
    expect(stopTriggerBlock).toContain('disabled={selectedChatPromptCancelling}');
    expect(stopTriggerBlock).not.toContain('disabled={!selectedChatPromptRunning || selectedChatPromptCancelling}');
    expect(stopTriggerBlock).toContain("className={`codicon ${selectedChatPromptCancelling ? 'codicon-loading codicon-modifier-spin' : 'codicon-stop-circle'} chat-composer-tool-glyph`}");
    expect(stopTriggerBlock).not.toContain('codicon-debug-stop');
    expect(stopTriggerBlock).not.toContain('chat-stop-glyph');
    expect(stopTriggerBlock).not.toContain('chat-stop-square');
    expect(stopTriggerBlock).toContain('aria-busy={selectedChatPromptCancelling}');

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
    expect(toolsBlock).toContain('className={chatComposerStopTriggerClassName}');

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
    expect(stylesCss).toContain('.chat-composer-stop-trigger {');
    const stopTriggerStyleBlock = stylesCss.match(/\.chat-composer-stop-trigger \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(stopTriggerStyleBlock).not.toContain('position: absolute;');
    expect(stopTriggerStyleBlock).not.toContain('width: 24px;');
    expect(stopTriggerStyleBlock).not.toContain('height: 24px;');
    expect(stopTriggerStyleBlock).not.toContain('border-radius: 8px;');
    expect(stylesCss).toContain('.chat-composer-stop-trigger.active {');
    expect(stylesCss).toContain('.chat-composer-stop-trigger.cancelling {');
    expect(stylesCss).toContain('.chat-composer-stop-trigger .codicon {');
    expect(stylesCss).toContain('.chat-composer-stop-trigger.active:not(.cancelling) .codicon {');
    const stopTriggerIconBlock = cssRuleBlock(stylesCss, '.chat-composer-stop-trigger .codicon');
    expect(stopTriggerIconBlock).not.toContain('font-size: 17px;');
    expect(stylesCss).toContain('@keyframes chatStopBreath');
    expect(stylesCss).not.toContain('.chat-stop-glyph {');
    expect(stylesCss).not.toContain('.chat-stop-square {');
    expect(cssRuleBlock(stylesCss, '.chat-context-usage')).toContain('conic-gradient(');
    expect(stylesCss).not.toContain('.chat-composer-quick-trigger {');
    expect(stylesCss).not.toContain('.chat-quick-trigger-label {');
    expect(stylesCss).not.toContain('.chat-quick-reply-menu {');
    expect(stylesCss).not.toContain('.chat-quick-reply-item {');
    expect(stylesCss).toContain('.chat-file-mention-menu {');
    expect(stylesCss).toContain('.chat-file-mention-empty {');
    expect(stylesCss).toContain('.chat-option-reply-line {');
    expect(stylesCss).toContain('.chat-option-reply-inline-button {');
    expect(stylesCss).toContain('.chat-option-reply-static {');
    expect(stylesCss).toContain('.chat-confirmation-reply-line {');
    expect(stylesCss).toContain('.chat-confirmation-reply-action {');
    expect(stylesCss).toContain('.chat-confirmation-reply-check {');
    expect(stylesCss).toContain('.chat-confirmation-reply-text {');
    expect(stylesCss).toMatch(
      /\.chat-confirmation-reply-action \{[\s\S]*border: 1px solid color-mix\(in srgb, var\(--accent-primary\) 22%, var\(--border-subtle\)\);[\s\S]*background: color-mix\(in srgb, var\(--surface-panel\) 88%, var\(--accent-primary\)\);[\s\S]*padding: 4px 8px;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.chat-option-reply-inline-button \{[\s\S]*border-color: color-mix\(in srgb, var\(--accent-primary\) 22%, var\(--border-subtle\)\);[\s\S]*background: color-mix\(in srgb, var\(--surface-panel\) 88%, var\(--accent-primary\)\);/,
    );
    expect(stylesCss).toMatch(
      /\.chat-option-reply-inline-button,\s*\.chat-scroll-bottom-button \{[\s\S]*backdrop-filter: blur\(1px\);[\s\S]*\}/,
    );
    const historicalOptionBlocks = stylesCss.match(/\.chat-option-reply-static \{[\s\S]*?\n\}/g) ?? [];
    const historicalOptionBlock = historicalOptionBlocks[historicalOptionBlocks.length - 1] ?? '';
    expect(historicalOptionBlock).toContain('border-color: var(--border-subtle);');
    expect(historicalOptionBlock).toContain('background: transparent;');
    expect(historicalOptionBlock).not.toContain('background: color-mix');
    expect(stylesCss).toMatch(
      /\.chat-option-reply-static \.chat-option-reply-label \{[\s\S]*color: var\(--text-secondary\);[\s\S]*\}/,
    );
    expect(stylesCss).not.toContain('.chat-option-replies {');
    expect(stylesCss).not.toContain('.chat-option-reply-button {');
    expect(stylesCss).toMatch(
      /\.chat-composer-input \{[\s\S]*min-height: 32px;[\s\S]*padding: 5px 8px 2px;[\s\S]*font-size: 15px;[\s\S]*line-height: 1.4;[\s\S]*scrollbar-width: thin;[\s\S]*scrollbar-gutter: stable;[\s\S]*\}/,
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
    expect(stylesCss).toMatch(
      /\.chat-send-button \.codicon \{[\s\S]*font-size: 17px;[\s\S]*\}/,
    );
    expect(stylesCss).toContain('.chat-scroll-bottom-button {');
    expect(stylesCss).toContain('bottom: var(--chat-scroll-bottom-offset, 92px);');
    expect(stylesCss).not.toContain('bottom: 92px;');
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
    expect(stylesCss).toMatch(/\.chat-composer-stop-slot \{[\s\S]*width: 24px;[\s\S]*height: 24px;[\s\S]*flex: 0 0 24px;[\s\S]*\}/);
    expect(stylesCss).toContain('.chat-composer-tool-glyph {');
    expect(cssRuleBlock(stylesCss, '.chat-composer-tool-glyph')).toContain('display: grid;');
    expect(cssRuleBlock(stylesCss, '.chat-composer-tool-glyph')).toContain('place-items: center;');
    expect(stylesCss).toContain('.chat-slash-symbol,');
    expect(stylesCss).toContain('.chat-at-symbol {');
    expect(stylesCss).not.toContain('.chat-attachment-plus-button {');
    expect(stylesCss).toContain('.chat-attachment-action-tray {');
    expect(cssRuleBlock(stylesCss, '.chat-attachment-action-tray')).toContain('background: color-mix(in srgb, var(--surface-overlay) 98%, var(--surface-panel));');
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
    expect(stylesCss).not.toContain('.chat-stop-button {');
    expect(stylesCss).not.toContain('.chat-stop-button.active {');
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
    expect(cssRuleBlock(stylesCss, '.chat-slash-menu')).toContain('background: color-mix(in srgb, var(--surface-overlay) 98%, var(--surface-panel));');
    expect(stylesCss).not.toContain('.chat-config-select {');
    expect(stylesCss).not.toContain('.chat-config-feedback {');
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
    expect(toolsBlock.indexOf('chat-composer-stop-slot')).toBeLessThan(toolsBlock.indexOf('className={chatComposerStopTriggerClassName}'));
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
    expect(stylesCss).toMatch(/\.chat-composer-stop-slot \{[\s\S]*width: 24px;[\s\S]*height: 24px;[\s\S]*\}/);
    expect(stylesCss).toContain('.chat-composer-toolbar-actions');
    expect(stylesCss).toMatch(/\.chat-composer-action-column \{[\s\S]*width: 36px;[\s\S]*height: 36px;[\s\S]*align-self: flex-end;[\s\S]*\}/);
    expect(stylesCss).toMatch(/\.chat-composer-toolbar \{[\s\S]*gap: 8px;[\s\S]*\}/);
    const stopTriggerCssBlock = stylesCss.match(/\.chat-composer-stop-trigger \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(stopTriggerCssBlock).not.toContain('position: absolute;');
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

  test('keeps file and photo actions behind a tools tray while file mentions use the @ shortcut', () => {
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
    expect(mainTsx).toContain('className="codicon codicon-device-camera"');
    expect(mainTsx).toContain('closeChatAttachmentTray();');
    expect(mainTsx).toContain('if (target && chatAttachmentTrayRef.current?.contains(target))');
    expect(mainTsx).toContain('if (target && chatAttachmentTrayButtonRef.current?.contains(target))');
    expect(mainTsx).toContain('setChatAttachmentTrayOpen(false);');

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
    expect(toolsBlock).toContain('codicon-attach');
    expect(toolsBlock).toContain('codicon-file-media');
    expect(toolsBlock).toContain('codicon-device-camera');
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
    expect(mainTsx).toContain("const shouldSendChatOnEnter = event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing;");
    expect(mainTsx).toContain("const mobileEnterShouldSend = !isWide && mobileEnterKeyBehavior === 'send';");
    expect(mainTsx).toContain('if (mobileEnterShouldSend || isWindowsPlatform) {');
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
    expect(drawerLayer).toBeGreaterThan(floatingLayer);
    expect(mobileSettingsLayer).toBeGreaterThan(drawerLayer);
    expect(stylesCss).toContain('--mobile-floating-control-lane: 56px;');
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
    expect(stylesCss).toMatch(
      /\.floating-control-stack-layer\[data-side-pulse='left'\] ~ \.drawer:not\(\.show\),[\s\S]*\.floating-control-stack-layer\[data-side-pulse='right'\] ~ \.drawer:not\(\.show\) \{[\s\S]*transition: box-shadow 220ms ease;[\s\S]*\}/,
    );
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
    const chatStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'chat'");
    const serverStart = settingsRootTsx.indexOf("renderSettingsSection({id: 'server'", chatStart);
    expect(chatStart).toBeGreaterThanOrEqual(0);
    expect(serverStart).toBeGreaterThan(chatStart);
    const chatSection = settingsRootTsx.slice(chatStart, serverStart);
    expect(chatSection).not.toContain('Voice Input');
    expect(chatSection).not.toContain('type="password"');
    expect(chatSection).not.toContain('API Key');
    expect(chatSection).not.toContain('Volcengine API Key');
    expect(settingsRootTsx).toContain('ServerSecretEditor');
    expect(settingsRootTsx).toContain('type="password"');
    expect(chatSection).not.toContain('Speech Model');
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
    expect(stylesCss).toContain('.voice-input-settings-nested');
    expect(stylesCss).toContain('.voice-recording-bar');
    expect(stylesCss).toContain('@keyframes voiceBarPulse');
  });

  test('keeps the mobile floating controls in a fixed translucent idle state until expanded', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).not.toContain('FLOATING_CONTROL_IDLE_DELAY_MS');
    expect(mainTsx).not.toContain('setFloatingControlsIdle');
    expect(mainTsx).not.toContain('floatingControlIdleOpacity');
    expect(mainTsx).not.toContain('floatingControlsIdleBlocked');
    expect(mainTsx).not.toContain('wakeFloatingControls');
    expect(mainTsx).toContain("const floatingControlsIdle = floatingDragVisualState === 'idle'");
    expect(mainTsx).toContain('data-idle={floatingControlsIdle}');
    expect(mainTsx).not.toContain("'--floating-control-idle-opacity'");
    expect(mainTsx).not.toContain('onPointerDownCapture={wakeFloatingControls}');
    expect(mainTsx).not.toContain('data-backdrop-tone=');
    expect(mainTsx).not.toContain('requestFloatingBackdropToneMeasure');
    expect(mainTsx).not.toContain('FLOATING_BACKDROP_TONE_THROTTLE_MS');
    expect(mainTsx).toContain('const floatingPositionSnapshotRef = useRef');
    expect(mainTsx).toContain('resolveFloatingControlYRatioForBoundsChange({');
    expect(mainTsx).toContain('previousTop: previousFloatingPosition.top');
    expect(mainTsx).toContain('previousHadDefaultComposerTop: previousFloatingPosition.hasDefaultComposerTop');
    expect(mainTsx).toContain('const nextHasDefaultComposerTop = floatingDefaultComposerTop !== null;');
    expect(mainTsx).toContain('nextHasDefaultComposerTop,');
    expect(mainTsx).toContain('const [floatingDefaultComposerTop, setFloatingDefaultComposerTop] = useState<number | null>(null);');
    expect(mainTsx).toContain('resolveFloatingControlDefaultBounds({');
    expect(mainTsx).toContain('resolveFloatingControlAvoidanceBounds({');
    expect(mainTsx).toContain('const floatingBounds = floatingAvoidanceBounds;');
    expect(mainTsx).toContain('floatingBaseBounds.minTop');
    expect(mainTsx).toContain('floatingBaseBounds.maxTop');
    expect(mainTsx).not.toContain('const keyboardShift = Math.min(');
    expect(stylesCss).not.toContain('.floating-nav-group');
    expect(stylesCss).toMatch(
      /\.drawer-toggle-bubble \{[\s\S]*background: transparent;[\s\S]*backdrop-filter: none;[\s\S]*\}/,
    );
    expect(stylesCss).not.toContain('[data-backdrop-tone');
    expect(stylesCss).not.toMatch(
      /\.floating-control-stack\[data-idle='true'\] \{[\s\S]*opacity:/,
    );
    expect(stylesCss).toContain(".floating-control-stack[data-idle='true'] .drawer-toggle-bubble");
    expect(stylesCss).not.toContain('.floating-nav-button');
    expect(stylesCss).toMatch(
      /\.port-relay-floating-bubble\[data-active='true'\] \{[\s\S]*background: transparent;[\s\S]*border-color: color-mix\(in srgb, var\(--accent-primary\) 72%, transparent\);[\s\S]*color: color-mix\(in srgb, var\(--accent-primary\) 88%, var\(--text-primary\)\);[\s\S]*\}/,
    );
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
    const settingsRootPath = path.join(projectRoot, 'web', 'src', 'settings', 'SettingsRootContent.tsx');
    const settingsRootTsx = fs.existsSync(settingsRootPath) ? readSourceText(settingsRootPath) : '';
    const settingsBundlePath = path.join(projectRoot, 'web', 'src', 'settings', 'SettingsBundle.ts');
    const settingsBundleTs = fs.existsSync(settingsBundlePath) ? readSourceText(settingsBundlePath) : '';
    const fileSurfaceTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'file', 'FileExplorerTree.tsx'));
    const gitSurfaceTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'git', 'GitSidebar.tsx'));
    const sidebarSurfaceSource = `${mainTsx}\n${fileSurfaceTsx}\n${gitSurfaceTsx}`;
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('type SettingsDetailView = SettingsDetailId | null;');
    expect(mainTsx).toContain('const [settingsDetailView, setSettingsDetailView] = useState<SettingsDetailView>(null);');
    expect(mainTsx).toContain('const [mobileProjectActionMenu, setMobileProjectActionMenu] = useState<MobileProjectActionMenuState | null>(null);');
    expect(mainTsx).toContain('const refreshMobileChatProjectSessions = async () => {');
    expect(mainTsx).toContain('await refreshChatIndex();');
    expect(mainTsx).toContain('latestProjects.map(projectItem =>');
    expect(mainTsx).toContain('refreshChatProjectSessions(projectItem.projectId, {force: options?.force === true})');
    expect(mainTsx).toContain('const renderMobileChatSessionSheet = () => {');
    expect(mainTsx).toContain('const renderChatSessionHeader = (mobile: boolean) => {');
    expect(mainTsx).toContain('{renderChatSessionHeader(true)}');
    expect(mainTsx).not.toContain('className={`mobile-chat-drawer-header${sessionSearchHeaderExpanded ? \' search-open\' : \'\'}`}');
    expect(mainTsx).not.toContain('<div className="mobile-chat-toolbar" aria-label="Chat tools">');
    expect(mainTsx).not.toContain('<span className="mobile-chat-drawer-title">Chats</span>');
    expect(mainTsx).toContain('className="mobile-project-session-nav"');
    expect(mainTsx).toContain('className="mobile-project-sheet"');
    expect(mainTsx).toContain('className="mobile-project-session-error"');
    expect(sidebarSurfaceSource).toContain('if (!isWide) setDrawerOpen(false);');
    expect(mainTsx).toContain("tab === 'chat' && !isWide ? renderMobileChatSessionSheet() : renderSidebarMain()");
    expect(mainTsx).toContain("if (detail === 'tokenStats') {");
    expect(mainTsx).toContain('renderTokenStatsSettingsDetail(options)');
    expect(mainTsx).toContain("const loadSettingsBundle = () => import(/* webpackChunkName: \"settings\" */ '../settings/SettingsBundle')");
    expect(mainTsx).toContain('const SettingsRootContent = React.lazy(() => loadSettingsBundle().then(module => ({');
    expect(mainTsx).toContain('<SettingsRootContent');
    expect(settingsRootTsx).toContain('export function SettingsRootContent');
    expect(settingsBundleTs).toContain("export { SettingsRootContent } from './SettingsRootContent';");
    expect(settingsBundleTs).toContain("export { DatabaseSettingsDetail } from './DatabaseSettingsDetail';");
    expect(settingsBundleTs).toContain("export { UpdateSettingsDetail } from './UpdateSettingsDetail';");
    expect(settingsBundleTs).toContain("export { DebugLogsSettingsDetail } from './DebugLogsSettingsDetail';");
    expect(settingsRootTsx).toContain('function renderSettingsSection');
    expect(settingsRootTsx).toContain("renderSettingsSection({id: 'appearance'");
    expect(settingsRootTsx).not.toContain('Inactive Visibility');
    expect(settingsRootTsx).not.toContain('floatingControlIdleOpacityPercent');
    expect(settingsRootTsx).not.toContain('setFloatingControlIdleOpacity');
    expect(settingsRootTsx).toContain("renderSettingsSection({id: 'chat'");
    expect(settingsRootTsx).toContain("renderSettingsSection({id: 'code-display'");
    expect(settingsRootTsx).toContain("renderSettingsSection({id: 'debug'");
    expect(settingsRootTsx).not.toContain("renderSettingsSection('More'");
    const appearanceSettingsIndex = settingsRootTsx.indexOf("renderSettingsSection({id: 'appearance'");
    const chatSettingsIndex = settingsRootTsx.indexOf("renderSettingsSection({id: 'chat'");
    const codeDisplaySettingsIndex = settingsRootTsx.indexOf("renderSettingsSection({id: 'code-display'");
    const debugSettingsIndex = settingsRootTsx.indexOf("renderSettingsSection({id: 'debug'");
    expect(appearanceSettingsIndex).toBeLessThan(chatSettingsIndex);
    const appearanceSection = settingsRootTsx.slice(appearanceSettingsIndex, chatSettingsIndex);
    expect(appearanceSection).not.toContain('!isWide ? (');
    expect(appearanceSection).not.toContain('Inactive Visibility');
    expect(chatSettingsIndex).toBeLessThan(codeDisplaySettingsIndex);
    expect(codeDisplaySettingsIndex).toBeLessThan(debugSettingsIndex);
    expect(settingsRootTsx).toContain("openSettingsChild('database')");
    expect(mainTsx).toContain("detail === 'database'");
    expect(mainTsx).toContain('renderDatabaseSettingsDetail(options)');
    expect(settingsRootTsx).toContain('className="settings-section-title"');
    expect(settingsRootTsx).toContain('className="settings-row settings-detail-row"');
    expect(mainTsx).not.toContain('title="Token stats"');
    expect(mainTsx).not.toContain('title="Agent info"');
    expect(mainTsx).not.toContain('className="chat-session-swipe-row');

    const mobileSheetStart = mainTsx.indexOf('const renderMobileChatSessionSheet = () => {');
    const mobileSheetEnd = mainTsx.indexOf('const renderSidebar = () => {', mobileSheetStart);
    expect(mobileSheetStart).toBeGreaterThanOrEqual(0);
    expect(mobileSheetEnd).toBeGreaterThan(mobileSheetStart);
    const mobileSheet = mainTsx.slice(mobileSheetStart, mobileSheetEnd);
    expect(mobileSheet).not.toContain("openSettingsDetail('portRelay')");
    expect(mobileSheet).not.toContain("openSettingsDetail('update')");
    expect(mobileSheet).not.toContain('className="project-wrap"');
    expect(mobileSheet).toContain('renderProjectSessionRowsWithOlderFolding(targetProjectId, projectSessions, true)');
    expect(mainTsx).toContain('renderProjectSessionActionMenu(targetProjectId, session)');
    expect(mainTsx).toContain('onPointerDown={event => startProjectSessionLongPress(targetProjectId, session.sessionId, event)}');
    expect(mobileSheet).not.toContain('chat-session-swipe-row');
    expect(mobileSheet).toContain("tagVariantClass('wide-project-hub', projectItem.hubId || 'local')");
    expect(mainTsx).toContain("tagVariantClass('wide-session-agent', sessionAgent)");

    expect(stylesCss).toContain('.chat-session-header.mobile {');
    expect(stylesCss).not.toContain('.mobile-chat-drawer-header');
    expect(stylesCss).toContain('.mobile-project-session-nav {');
    expect(stylesCss).toContain('.mobile-project-sheet {');
    expect(stylesCss).toContain('.mobile-project-session-error {');
    expect(stylesCss).toContain('.settings-detail-header {');
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

  test('wide layout uses a project session rail instead of the header project picker', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const appDialogsTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'shell', 'AppDialogs.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).not.toContain('WIDE_PROJECT_SESSION_LIMIT');
    expect(mainTsx).toContain('const PROJECT_PIN_LONG_PRESS_MS = 450;');
    expect(mainTsx).toContain('function tagVariantClass(prefix: string, value: string): string {');
    expect(mainTsx).toContain('const sortedProjectItems = useMemo(() => sortProjectsByPin(projects, pinnedProjectIds), [projects, pinnedProjectIds]);');
    expect(mainTsx).toContain('const togglePinnedProject = useCallback(');
    expect(mainTsx).toContain('const startProjectPinLongPress = useCallback(');
    expect(mainTsx).toContain('const consumeProjectPinLongPressClick = useCallback(');
    expect(mainTsx).toContain('const renderWideProjectSessionNav = () => {');
    expect(mainTsx).toContain('className="wide-project-session-nav"');
    expect(mainTsx).toContain('className="wide-project-title-group"');
    expect(mainTsx).toContain("collapsed ? 'codicon-folder' : 'codicon-folder-opened'");
    expect(mainTsx).toContain("className=\"codicon codicon-pinned wide-project-pin-badge\"");
    expect(mainTsx).toContain('onPointerDown={event => startProjectPinLongPress(targetProjectId, event)}');
    expect(mainTsx).toContain('onPointerUp={finishProjectPinLongPress}');
    expect(mainTsx).toContain('onContextMenu={event => event.preventDefault()}');
    expect(mainTsx).toContain("tagVariantClass('wide-project-hub', projectItem.hubId || 'local')");
    expect(mainTsx).toContain('className="wide-project-hub-dot"');
    expect(mainTsx).toContain('className="wide-project-hub-label"');
    expect(mainTsx).toContain('className="wide-project-session-list"');
    expect(mainTsx).toContain('className="wide-project-action-btn"');
    expect(mainTsx).toContain('className="wide-project-action-popover"');
    expect(mainTsx).toContain("import {resolveWideProjectActionPopoverPlacement");
    expect(mainTsx).toContain('style={wideProjectActionMenu.popover');
    expect(mainTsx).toContain('className="wide-project-action-title"');
    expect(mainTsx).toContain("wideProjectActionMenu.kind === 'new' ? 'New Session' : 'Resume Session'");
    expect(mainTsx).toContain("const sessionAgent = (session.agentType || '').trim();");
    expect(mainTsx).toContain("tagVariantClass('wide-session-agent', sessionAgent)");
    expect(mainTsx).toContain('const [projectSessionActionMenu, setProjectSessionActionMenu] = useState<ProjectSessionActionMenuState | null>(null);');
    expect(mainTsx).toContain('popover?: WideProjectActionPopoverPlacement | null;');
    expect(mainTsx).toContain('const PROJECT_SESSION_LONG_PRESS_MS = 450;');
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
    expect(mainTsx).toContain("if (!isWide || tab !== 'chat' || sidebarSettingsOpen || !selectedChatKey || !selectedChatSession || renameTarget || confirmTarget) {");
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
    expect(mainTsx).toContain('const renderProjectSessionActionMenu = (targetProjectId: string, session: RegistrySessionSummary) => {');
    expect(mainTsx).not.toContain('className="project-session-more-btn"');
    expect(mainTsx).not.toContain('const openProjectSessionActionMenu = (');
    expect(mainTsx).toContain('className="project-session-action-menu"');
    expect(mainTsx).toContain('style={projectSessionActionMenu.popover');
    expect(mainTsx).toContain("transform: projectSessionActionMenu.popover.placement === 'above'");
    expect(mainTsx).toContain('anchorRect: {');
    expect(mainTsx).toContain('left: event.clientX,');
    expect(mainTsx).toContain('top: event.clientY,');
    expect(mainTsx).toContain('bottom: event.clientY,');
    expect(mainTsx).toContain('right: event.clientX,');
    expect(mainTsx).toContain("align: 'start',");
    expect(mainTsx).toContain('className="project-session-menu-btn reload"');
    expect(mainTsx).toContain('className="project-session-menu-btn rename"');
    expect(mainTsx).toContain('className="project-session-menu-btn archive"');
    expect(mainTsx).toContain('className="project-session-menu-btn delete"');
    expect(mainTsx).toContain('const sessionActionDisabled = !!session.running ||');
    expect(mainTsx).toContain('const renameActionDisabled = chatRenamingSessionId === sessionId;');
    expect(mainTsx).toContain('className="project-session-menu-label">Reload</span>');
    expect(mainTsx).toContain('className="project-session-menu-label">Rename</span>');
    expect(mainTsx).toContain('className="project-session-menu-label">Archive</span>');
    expect(mainTsx).toContain('className="project-session-menu-label">Delete</span>');
    const sessionActionMenuStart = mainTsx.indexOf('className="project-session-action-menu"');
    const sessionActionMenuEnd = mainTsx.indexOf('const refreshProject = async', sessionActionMenuStart);
    expect(sessionActionMenuStart).toBeGreaterThanOrEqual(0);
    expect(sessionActionMenuEnd).toBeGreaterThan(sessionActionMenuStart);
    const sessionActionMenu = mainTsx.slice(sessionActionMenuStart, sessionActionMenuEnd);
    const renameMenuIndex = sessionActionMenu.indexOf('className="project-session-menu-label">Rename</span>');
    const archiveMenuIndex = sessionActionMenu.indexOf('className="project-session-menu-label">Archive</span>');
    const reloadMenuIndex = sessionActionMenu.indexOf('className="project-session-menu-label">Reload</span>');
    const deleteMenuIndex = sessionActionMenu.indexOf('className="project-session-menu-label">Delete</span>');
    expect(renameMenuIndex).toBeGreaterThanOrEqual(0);
    expect(archiveMenuIndex).toBeGreaterThan(renameMenuIndex);
    expect(reloadMenuIndex).toBeGreaterThan(archiveMenuIndex);
    expect(deleteMenuIndex).toBeGreaterThan(reloadMenuIndex);
    expect(mainTsx).toContain("if (target?.closest('.project-session-action-menu')) {");
    expect(mainTsx).toContain('renderProjectSessionActionMenu(targetProjectId, session)');
    expect(mainTsx).toContain('onPointerDown={event => startProjectSessionLongPress(targetProjectId, session.sessionId, event)}');
    expect(mainTsx).toContain('onContextMenu={event => openProjectSessionContextMenu(targetProjectId, session.sessionId, event)}');
    expect(mainTsx).toContain("tab === 'chat' && !isWide ? renderMobileChatSessionSheet() : renderSidebarMain()");
    expect(mainTsx).toContain("tab === 'chat' ? renderWideProjectSessionNav() : renderSidebarMain(false)");
    expect(mainTsx).toContain("const wideSidebarMain = tab === 'chat' ? renderWideProjectSessionNav() : renderSidebarMain(false);");
    expect(mainTsx).not.toContain('const wideSidebarMain = sidebarSettingsOpen');
    expect(mainTsx).not.toContain("? renderSettingsContent(false, { hideDetailHeader: isSettingsPeerDetail(settingsDetailView) })");
    expect(mainTsx).not.toContain('const wideSidebarTitle = sidebarSettingsOpen');
    expect(mainTsx).toContain('renderChatSessionHeader(false)');
    expect(mainTsx).not.toContain('chatSidebarTitleSearchOpen');
    expect(mainTsx).not.toContain('const handleDesktopActivitySelect = useCallback((nextTab: Tab) => {');
    expect(mainTsx).toContain('const handleDesktopSettingsSelect = useCallback(() => {');
    expect(mainTsx).toContain("import { DesktopDragRegion, DesktopWindowControls } from '../shell/layouts/desktop/DesktopTitleBar';");
    expect(mainTsx).toContain('const desktopWindowControls = desktopWindowControlsVisible ? (');
    expect(mainTsx).toContain('const desktopWindowControlsVisible = isWide && Boolean(getDesktopWindowBridge());');
    expect(mainTsx).toContain('<DesktopWindowControls />');
    expect(mainTsx).toContain('desktopSettingsScreen={desktopSettingsScreen}');
    expect(mainTsx).toContain('const renderChatMenuSettingsButton = () => (');
    expect(mainTsx).toContain('className="chat-menu-icon-button chat-menu-settings-button"');
    expect(mainTsx).toContain('onClick={handleDesktopSettingsSelect}');
    expect(mainTsx).toContain('<DesktopDragRegion className="sidebar-title-row">');
    expect(mainTsx).toContain('<DesktopDragRegion className="block-title chat-title-bar">');
    expect(mainTsx).toContain('className={`chat-sidebar-toggle${sidebarCollapsed ? \' collapsed\' : \'\'}`}');
    expect(mainTsx).toContain('{isWide ? (');
    expect(mainTsx).toContain('onClick={() => setSidebarCollapsed(value => !value)}');
    expect(mainTsx).toContain('title={sidebarCollapsed ? \'Show sidebar\' : \'Hide sidebar\'}');
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
    const desktopTitleStart = mainTsx.indexOf('const renderDesktopChatBreadcrumbTitle = () => (');
    const mobileTitleStart = mainTsx.indexOf('const renderMobileChatBreadcrumbTitle = () => (');
    const renderTitleStart = mainTsx.indexOf('const renderChatBreadcrumbTitle = () => (isWide ?', mobileTitleStart);
    expect(desktopTitleStart).toBeGreaterThanOrEqual(0);
    expect(mobileTitleStart).toBeGreaterThan(desktopTitleStart);
    expect(renderTitleStart).toBeGreaterThan(mobileTitleStart);
    const desktopTitleBlock = mainTsx.slice(desktopTitleStart, mobileTitleStart);
    const mobileTitleBlock = mainTsx.slice(mobileTitleStart, renderTitleStart);
    expect(desktopTitleBlock).toContain('className={`chat-title-prompt-icon-button${chatTitlePromptMenuOpen ? \' open\' : \'\'}`}');
    expect(desktopTitleBlock).toContain('className={`chat-title-project-button${chatTitleProjectMenuOpen ? \' open\' : \'\'}`}');
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
    expect(mainTsx).toContain('desktopSidebarWidth={effectiveDesktopSidebarWidth}');

    const wideRailStart = mainTsx.indexOf('const renderWideProjectSessionNav = () => {');
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
    expect(stylesCss).toContain('--desktop-window-controls-width: 176px;');
    expect(stylesCss).toContain('.desktop-window-controls {');
    expect(stylesCss).toContain('.desktop-window-source-button {');
    expect(stylesCss).toContain('.desktop-window-source-popover {');
    expect(stylesCss).toContain('.desktop-window-source-panel {');
    expect(stylesCss).toContain('.chat-menu-icon-button {');
    expect(stylesCss).toContain('.desktop-drag-region {');
    expect(stylesCss).toContain('.chat-sidebar-toggle,');
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
    expect(stylesCss).toContain('.project-session-menu-btn.reload {');
    expect(stylesCss).toContain('.project-session-menu-btn.rename {');
    expect(stylesCss).toContain('.project-session-menu-btn.archive {');
    expect(stylesCss).toContain('.project-session-menu-btn.delete {');
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
    expect(stylesCss).toMatch(/\.wide-project-row \{[^}]*min-height: 32px;[^}]*\}/);
    const wideProjectSectionBlock = stylesCss.match(/\.wide-project-section \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectSectionBlock).toContain('margin-bottom: 8px;');
    expect(wideProjectSectionBlock).toContain('border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);');
    expect(wideProjectSectionBlock).toContain('background: color-mix(in srgb, var(--surface-panel) 88%, var(--surface-raised));');
    expect(wideProjectSectionBlock).toContain('padding: 3px;');
    const mobileProjectSectionBlock = stylesCss.match(/\.mobile-project-section \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(mobileProjectSectionBlock).toContain('margin-bottom: 4px;');
    expect(stylesCss).not.toContain('.wide-project-section.active > .wide-project-row::before {');
    expect(stylesCss).not.toContain('.wide-project-section.pinned > .wide-project-row::before {');
    expect(stylesCss).toMatch(/\.wide-project-toggle \{[^}]*height: 30px;[^}]*\}/);
    expect(stylesCss).toMatch(/\.wide-session-row \{[^}]*min-height: 24px;[^}]*\}/);
    const wideSessionRowBlock = stylesCss.match(/\.wide-session-row \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideSessionRowBlock).toContain('grid-template-columns: 9px minmax(0, 1fr) auto auto;');
    expect(wideSessionRowBlock).toContain('gap: 4px;');
    expect(wideSessionRowBlock).toContain('padding: 0 5px 0 2px;');
    const sessionStateMarkerBlock = stylesCss.match(/\.session-state-marker \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(sessionStateMarkerBlock).toContain('width: 9px;');
    expect(sessionStateMarkerBlock).toContain('flex: 0 0 9px;');
    expect(sessionStateMarkerBlock).not.toContain('transform: translateX');
    const sessionStateRunningBlock = stylesCss.match(/\.session-state-marker\.running \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(sessionStateRunningBlock).toContain('font-size: 11px;');
    expect(stylesCss).toMatch(/\.mobile-session-row \{[^}]*min-height: 30px;[^}]*\}/);
    expect(stylesCss).not.toMatch(/@media \(max-width: 900px\) \{[\s\S]*?\.mobile-session-row \{[\s\S]*?min-height: 40px;[\s\S]*?\}[\s\S]*?\}/);
    expect(stylesCss).toContain('font-size: 10.5px;');
    expect(stylesCss).toContain('.wide-project-folder-icon.codicon-folder {');
    expect(stylesCss).toContain('.wide-project-folder-icon.codicon-folder-opened {');
    expect(stylesCss).toMatch(
      /\.wide-project-folder-icon\.codicon-folder-opened \{[\s\S]*color: color-mix\(in srgb, var\(--hub-accent\) 82%, var\(--text-primary\)\);[\s\S]*\}/,
    );
    const selectedSessionRowBlock = stylesCss.match(/\.wide-session-row\.selected \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(selectedSessionRowBlock).not.toContain('margin-left:');
    expect(selectedSessionRowBlock).not.toContain('width: calc(');
    expect(selectedSessionRowBlock).not.toContain('padding-left: 23px;');
    const selectedBarBlock = stylesCss.match(/\.wide-session-row\.selected::before \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(selectedBarBlock).toContain('left: 2px;');
    const wideProjectActionBtnBlock = stylesCss.match(/\.wide-project-action-btn \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectActionBtnBlock).toContain('opacity: 0.45;');
    expect(stylesCss).not.toContain('.mobile-project-actions .wide-project-action-btn {');
    const wideProjectSessionListBlock = stylesCss.match(/\.wide-project-session-list \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectSessionListBlock).toContain('margin-top: -2px;');
    expect(stylesCss).not.toContain('.wide-session-row::after');
    expect(stylesCss).not.toContain('.project-session-row-wrap.actions-open .wide-session-row {');
    expect(stylesCss).not.toContain('.project-session-action-strip');
    expect(stylesCss).not.toContain('.project-session-row-wrap:hover .project-session-more-btn');
    expect(stylesCss).toMatch(
      /\.project-session-action-menu \{[^}]*position: fixed;[^}]*left: 0;[^}]*width: min\(156px, calc\(100vw - 16px\)\);[^}]*max-height: min\(190px, calc\(100vh - 16px\)\);[^}]*overflow-y: auto;[^}]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.project-session-menu-btn \{[^}]*height: 30px;[^}]*gap: 8px;[^}]*padding: 0 9px;[^}]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.project-session-menu-btn\.delete \{[^}]*color: #fca5a5;[^}]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.wide-session-title \{[\s\S]*font-weight: 400;[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.wide-project-hub-tag \{[\s\S]*border: none;[\s\S]*background: transparent;[\s\S]*\}/,
    );
    const wideProjectTitleGroupBlock = stylesCss.match(/\.wide-project-title-group \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectTitleGroupBlock).toContain('overflow: hidden;');
    const wideProjectNameBlock = stylesCss.match(/\.wide-project-name \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectNameBlock).toContain('flex: 0 0 auto;');
    expect(wideProjectNameBlock).toContain('max-width: 100%;');
    const wideProjectHubTagBlock = stylesCss.match(/(?:^|\n)\.wide-project-hub-tag \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectHubTagBlock).toContain('flex: 1 1 0;');
    expect(wideProjectHubTagBlock).toContain('min-width: 0;');
    expect(wideProjectHubTagBlock).toContain('max-width: max-content;');
    expect(wideProjectHubTagBlock).toContain('overflow: hidden;');
    const wideProjectHubLabelBlock = stylesCss.match(/\.wide-project-hub-label \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(wideProjectHubLabelBlock).toContain('flex: 1 1 auto;');
    expect(stylesCss).toMatch(
      /\.wide-project-pin-badge \{[\s\S]*position: absolute;[\s\S]*right: -4px;[\s\S]*top: -5px;[\s\S]*\}/,
    );
  });

  test('chat title bar uses breadcrumb context and exposes preview toggle', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    const chatSurfaceStart = mainTsx.indexOf('if (tab === \'chat\') {\n      return (');
    const chatSurfaceEnd = mainTsx.indexOf('if (tab === \'file\') {', chatSurfaceStart);
    expect(chatSurfaceStart).toBeGreaterThanOrEqual(0);
    expect(chatSurfaceEnd).toBeGreaterThan(chatSurfaceStart);
    const chatSurface = mainTsx.slice(chatSurfaceStart, chatSurfaceEnd);

    expect(chatSurface).toContain('className="block-title chat-title-bar"');
    expect(chatSurface).toContain('{renderChatBreadcrumbTitle()}');
    expect(chatSurface).not.toContain('className="breadcrumb-separator"');
    expect(mainTsx).toContain('const selectedChatPromptHistory = useMemo(');
    expect(mainTsx).toContain('.filter(message => isPromptStartMessage(message))');
    expect(mainTsx).toContain('summarizeChatTitlePrompt(msgText(message.method, message.param), fallback)');
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
    expect(mainTsx).toContain('const renderChatBreadcrumbTitle = () => (isWide ? renderDesktopChatBreadcrumbTitle() : renderMobileChatBreadcrumbTitle());');
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
    expect(mainTsx).toContain('className="chat-title-project-menu"');
    expect(mainTsx).toContain('className={`chat-title-project-menu-item${selected ? \' selected\' : \'\'}`}');
    expect(mainTsx).toContain('className="chat-title-prompt-menu"');
    expect(mainTsx).toContain('className="chat-title-prompt-menu-item"');
    expect(chatSurface).not.toContain('className="chat-title-prompt-menu"');
    expect(chatSurface).not.toContain('CHAT - ${selectedChatDisplayTitle || \'New Session\'}');
    expect(chatSurface).toContain('className="chat-title-actions"');
    expect(chatSurface).toContain('className={`chat-preview-toggle${chatPreviewOpen ? \' active\' : \'\'}`}');
    expect(chatSurface).toContain('title={chatPreviewOpen ? \'Hide preview\' : \'Show preview\'}');
    expect(chatSurface).toContain('aria-label={chatPreviewOpen ? \'Hide preview\' : \'Show preview\'}');
    expect(chatSurface).toContain('aria-pressed={chatPreviewOpen}');
    expect(chatSurface).toContain('onClick={toggleChatPreviewFromTitle}');
    expect(mainTsx).toContain('setChatPreviewManualOpen(open => !open)');
    expect(mainTsx).toContain('setChatPreviewManualCollapsed(true)');

    expect(stylesCss).toContain('.chat-title-bar {');
    expect(stylesCss).toContain('.chat-title-actions {');
    expect(stylesCss).toContain('.chat-breadcrumb-title {');
    expect(stylesCss).toContain('.chat-title-session-button {');
    expect(stylesCss).toContain('.chat-sidebar-toggle,');
    expect(stylesCss).toContain('.chat-title-project-button {');
    expect(stylesCss).toContain('.chat-title-project-menu {');
    expect(stylesCss).toContain('.chat-title-prompt-icon-button,');
    expect(stylesCss).toContain('.chat-title-prompt-menu {');
    expect(stylesCss).toContain('.chat-title-prompt-menu-item {');
    expect(stylesCss).toContain('.chat-preview-toggle {');
    const projectButtonBlock = cssRuleBlock(stylesCss, '.chat-title-project-button');
    expect(projectButtonBlock).toContain('border: 0;');
    expect(projectButtonBlock).toContain('background: transparent;');
    expect(projectButtonBlock).toContain('overflow: hidden;');
    expect(projectButtonBlock).toContain('max-width: max-content;');
    expect(projectButtonBlock).not.toContain('max-width: min(46%, 280px);');
    expect(projectButtonBlock).toContain('text-align: left;');
    const projectButtonNameBlock = cssRuleBlock(stylesCss, '.chat-title-project-button .breadcrumb-project-name');
    expect(projectButtonNameBlock).toContain('flex: 1 1 auto;');
    expect(projectButtonNameBlock).toContain('max-width: 100%;');
    expect(projectButtonNameBlock).toContain('border: 0;');
    expect(projectButtonNameBlock).toContain('padding: 0;');
    expect(projectButtonNameBlock).toContain('background: transparent;');
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
    expect(promptMenuBlock).toContain('overflow-y: auto;');
    const previewToggleBlock = cssRuleBlock(stylesCss, '.chat-preview-toggle');
    expect(previewToggleBlock).toContain('border: 0;');
    expect(previewToggleBlock).toContain('background: transparent;');
    expect(previewToggleBlock).toContain('color: color-mix(in srgb, var(--accent-primary) 88%, var(--text-primary));');
    expect(previewToggleBlock).not.toContain('var(--surface-raised)');
    const previewToggleActiveBlock = cssRuleBlock(stylesCss, '.chat-preview-toggle:hover');
    expect(previewToggleActiveBlock).toContain('background: color-mix(in srgb, var(--accent-primary) 13%, transparent);');
    const previewToggleOpenBlock = cssRuleBlock(stylesCss, '.chat-preview-toggle.active');
    expect(previewToggleOpenBlock).not.toContain('border-color:');
  });

  test('wide project session rail actions use project-scoped chat flows', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    expect(mainTsx).toContain('const selectWideProjectSession = async (targetProjectId: string, sessionId: string) => {');
    expect(mainTsx).toContain('const selectProjectChatSession = async (');
    expect(mainTsx).toContain('workspaceStore.rememberSelectedChatSessionKey(nextSelectedKey);');
    expect(mainTsx).toContain("setTab('chat');");
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
    expect(mainTsx).toContain("const result = await service.createProjectSession(targetProjectId, agentType, '');");
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
    expect(mainTsx).toContain('title={result.path}');
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

    expect(mainTsx).toContain('Up/Down to browse, Right to preview');
    expect(mainTsx).toContain('className="chat-file-mention-shortcut-tip"');
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
    expect(mainTsx).not.toContain('onContextMenu={event => {');

    expect(stylesCss).toContain('.chat-file-mention-shortcut-tip');
    expect(stylesCss).toContain('.chat-file-mention-option-row');
    expect(stylesCss).toContain('.chat-file-mention-preview-button');
    expect(stylesCss).toMatch(/\.chat-file-mention-shortcut-tip \{[\s\S]*position: sticky;[\s\S]*top: 0;/);
    expect(stylesCss).toMatch(/@media \(max-width: 900px\) \{[\s\S]*?\.chat-file-mention-shortcut-tip \{[\s\S]*?display: none;/);
  });

  test('chat composer uses compact file mention pins and running tools-slot cancel', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain('const openChatFileMentionShortcut = useCallback(() => {');
    expect(mainTsx).toContain('className="chat-tool-button chat-file-mention-trigger-button"');
    expect(mainTsx).toContain('className="chat-tool-button chat-slash-button"');
    expect(mainTsx).toContain('aria-label="Mention files"');
    expect(mainTsx).toContain('className="chat-composer-tool-glyph chat-at-symbol"');
    expect(mainTsx).toContain('className="chat-tool-button chat-attachment-plus-button"');
    expect(mainTsx).toContain('className="chat-composer-stop-slot"');
    expect(mainTsx).toContain('className={chatComposerStopTriggerClassName}');
    expect(mainTsx).toContain("const chatComposerStopTriggerClassName = `chat-tool-button chat-composer-stop-trigger");
    expect(mainTsx).not.toContain('disabled={!selectedChatPromptRunning || selectedChatPromptCancelling}');
    expect(mainTsx).toContain('disabled={selectedChatPromptCancelling}');
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
    expect(stylesCss).toContain('.chat-at-symbol');
    expect(stylesCss).toContain('.chat-composer-capsule.file');
    expect(mainTsx).toContain('className="chat-composer-tool-glyph chat-slash-symbol"');
    expect(mainTsx).toContain('className="chat-composer-tool-glyph chat-at-symbol"');
    expect(mainTsx).not.toContain('codicon-code chat-composer-tool-glyph chat-slash-symbol');
    expect(mainTsx).not.toContain('codicon-file-code chat-composer-tool-glyph chat-at-symbol');
    expect(mainTsx).toContain('className="codicon codicon-file-media chat-composer-tool-glyph"');
    expect(mainTsx).not.toContain('className="codicon codicon-tools chat-composer-tool-glyph"');
    expect(mainTsx).not.toContain('className="codicon codicon-add chat-composer-tool-glyph"');
    expect(mainTsx).toContain("chat-composer-tool-glyph`}");
    const toolButtonBlock = cssRuleBlock(stylesCss, '.chat-tool-button');
    expect(toolButtonBlock).toContain('border: none;');
    expect(toolButtonBlock).toContain('background: transparent;');
    expect(toolButtonBlock).toContain('color: color-mix(in srgb, var(--text-secondary) 86%, var(--text-primary));');
    expect(toolButtonBlock).not.toContain('border: 1px');
    expect(toolButtonBlock).not.toContain('color: color-mix(in srgb, var(--text-primary) 72%, var(--text-secondary));');
    expect(stylesCss).not.toContain('.chat-slash-button,\n.chat-file-mention-trigger-button,\n.chat-attachment-plus-button {');
    expect(stylesCss).toMatch(/\.chat-composer-tool-glyph \{[\s\S]*width: 16px;[\s\S]*height: 16px;[\s\S]*display: grid;[\s\S]*font-size: 14px;[\s\S]*line-height: 1;[\s\S]*\}/);
    expect(stylesCss).not.toContain('.chat-file-mention-trigger-button {\n  color: color-mix(in srgb, #8bd5ff 82%, var(--text-primary));\n}');
    expect(stylesCss).not.toContain('.chat-attachment-action-button.file .codicon');
    expect(stylesCss).not.toContain('.chat-attachment-action-button.photo .codicon');
    expect(stylesCss).toMatch(/\.chat-file-mention-option-main \{[\s\S]*grid-template-columns: 16px minmax\(0, auto\) minmax\(0, 1fr\);/);
    expect(stylesCss).toMatch(/\.chat-composer-capsule,[\s\S]*\.chat-prompt-inline-capsule \{[\s\S]*max-width: min\(260px, 100%\);/);
    expect(stylesCss).toMatch(/\.chat-composer-stop-trigger \{[\s\S]*color: var\(--state-danger\);[\s\S]*opacity: 1;/);
  });

  test('keeps running chat editable and queues another send for that chat', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const sendStart = mainTsx.indexOf('const sendChatMessage = async');
    const sendEnd = mainTsx.indexOf('const sendChatMessageEvent = useStableEvent(sendChatMessage);', sendStart);
    const sendBlock = mainTsx.slice(sendStart, sendEnd);

    expect(mainTsx).toContain('const [chatSubmittingByKey, setChatSubmittingByKey] = useState<Record<string, boolean>>({});');
    expect(mainTsx).toContain('const chatSubmittingByKeyRef = useRef<Record<string, boolean>>({});');
    expect(mainTsx).toContain('const [chatQueuedPromptsByKey, setChatQueuedPromptsByKey] = useState<QueuedChatPromptsByKey>({});');
    expect(mainTsx).toContain('const chatQueuedPromptsByKeyRef = useRef<QueuedChatPromptsByKey>({});');
    expect(mainTsx).toContain('const selectedChatSubmitPending = selectedChatEncodedKey');
    expect(mainTsx).toContain('const chatSendDisabled = selectedChatSubmitPending || chatAttachmentUploadPending;');
    expect(mainTsx).toContain('enqueueSelectedChatPrompt(');
    expect(mainTsx).toContain('drainNextQueuedChatItem(selectedChatEncodedKey)');
    expect(mainTsx).toContain('cancelQueuedPrompt(selectedChatEncodedKey, queuedPrompt.id)');
    expect(mainTsx).toContain('prioritizeQueuedPrompt(selectedChatEncodedKey, queuedPrompt.id)');
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

  test('does not requeue an idle send because of its own submitting lock', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const sendStart = mainTsx.indexOf('const sendChatMessage = async');
    const sendEnd = mainTsx.indexOf('const sendChatMessageEvent = useStableEvent(sendChatMessage);', sendStart);
    const sendBlock = mainTsx.slice(sendStart, sendEnd);

    expect(sendStart).toBeGreaterThanOrEqual(0);
    expect(sendEnd).toBeGreaterThan(sendStart);
    expect(mainTsx).toContain('const runtimeSessionHasActiveExecution = (');
    expect(sendBlock).toContain('if (runtimeSessionHasActiveExecution(selectedProjectId, sessionId, runtimeKey)) {');
    expect(sendBlock).not.toContain('if (runtimeSessionIsBusy(selectedProjectId, sessionId, runtimeKey)) {');
  });

  test('keeps sidebar search fixed in the title region and new sessions project-scoped', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);
    expect(mainTsx).toContain("const chatSessionHeaderClassName = `sidebar-title-row chat-session-header");
    expect(mainTsx).toContain('{renderChatHeaderSearchControls()}');
    expect(mainTsx).toContain('className="chat-header-search-wrap"');
    expect(mainTsx).toContain('className="wide-project-action-btn"');
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
  });

  test('uses a clear but restrained selection surface and information-state colors for chat chrome', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);

    expect(stylesCss).toMatch(
      /\.wide-session-row\.selected \{[\s\S]*border-color: color-mix\(in srgb, var\(--accent-primary\) 32%, var\(--border-subtle\)\);[\s\S]*background: color-mix\(in srgb, var\(--accent-primary\) 11%, var\(--surface-panel\)\);[\s\S]*\}/,
    );
    expect(stylesCss).toMatch(
      /\.wide-session-row\.selected::before \{[\s\S]*content: ''\;[\s\S]*position: absolute;[\s\S]*width: 2px;[\s\S]*background: var\(--accent-primary\);[\s\S]*\}/,
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

    expect(agentTagBlock).toContain('border: 1px solid color-mix(in srgb, var(--agent-accent) 40%, var(--border-subtle));');
    expect(agentTagBlock).toContain('background: color-mix(in srgb, var(--agent-accent) 14%, transparent);');
    expect(agentTagBlock).toContain('color: color-mix(in srgb, var(--agent-accent) 70%, var(--text-primary));');
    expect(promptBlock).toContain('border: 1px solid color-mix(in srgb, var(--accent-primary) 26%, var(--border-subtle));');
    expect(promptBlock).toContain('background: color-mix(in srgb, var(--accent-primary) 12%, var(--surface-workspace-content));');
  });

  test('tightens relaxed session rows and keeps the recent project watermark typographic', () => {
    const projectRoot = path.join(__dirname, '..');
    const stylesCss = readWebStyles(projectRoot);
    const relaxedRow = cssRuleBlock(
      stylesCss,
      ".wide-project-session-nav[data-session-list-density='relaxed'] .wide-session-row",
    );
    const relaxedTitle = cssRuleBlock(
      stylesCss,
      ".wide-project-session-nav[data-session-list-density='relaxed'] .wide-session-title",
    );
    const recentWatermark = cssRuleBlock(stylesCss, '.recent-project-session-watermark');

    expect(relaxedRow).toContain('min-height: 30px;');
    expect(relaxedTitle).toContain('font-size: 13.5px;');
    expect(relaxedTitle).toContain('line-height: 1.25;');
    expect(recentWatermark).toContain('font-size: 36px;');
    expect(recentWatermark).toContain('font-weight: 800;');
    expect(stylesCss).not.toContain('.recent-project-session-hub.wide-project-hub-tag');
  });
});

describe('Android deferred native action ordering', () => {
  test('reserves image sharing before render state and reuses cached speech credential before forcing reconnect', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));

    const imageHandlerIndex = mainTsx.indexOf('const exportPromptDoneMarkdownImage = async');
    const imageReserveIndex = mainTsx.indexOf('await reserveResponseImageShare()', imageHandlerIndex);
    const imageRenderStateIndex = mainTsx.indexOf('setMarkdownImageExportRequest({', imageHandlerIndex);
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
    expect(mainTsx).toContain('service.compactProjectSession(');
    expect(mainTsx).toContain('shiftNextQueuedChatItem(');
    expect(mainTsx).toContain('<AppSessionStatusDialog');
    expect(mainTsx).not.toContain("agentType === 'codex'");
  });

  test('intercepts typed actions before attachment upload and clears queue on disconnect', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const sendStart = mainTsx.indexOf('const sendChatMessage = async');
    const parseIndex = mainTsx.indexOf('resolveStandaloneSessionAction(', sendStart);
    const uploadIndex = mainTsx.indexOf('uploadChatAttachmentsForSend(', sendStart);

    expect(parseIndex).toBeGreaterThan(sendStart);
    expect(parseIndex).toBeLessThan(uploadIndex);
    expect(mainTsx).toContain('chatQueuedPromptsByKeyRef.current = {};');
    expect(mainTsx).toContain('setChatQueuedPromptsByKey({});');
  });

  test('surfaces compact request failures in the active workspace', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const requestStart = mainTsx.indexOf('const requestSessionCompaction = async');
    const requestEnd = mainTsx.indexOf('const refreshSessionStatusDialog = async', requestStart);
    const requestBody = mainTsx.slice(requestStart, requestEnd);

    expect(requestStart).toBeGreaterThanOrEqual(0);
    expect(requestEnd).toBeGreaterThan(requestStart);
    expect(requestBody).toContain('if (!isSessionBusyError(errorValue)) {');
    expect(requestBody).toContain('setToastMessage(`Context compaction failed: ${message}`);');
    expect(requestBody).toContain('throw errorValue;');
  });
});
