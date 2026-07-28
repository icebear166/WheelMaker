import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
import {buildChatDisplayIndex} from '../web/src/chat/turns/chatDisplayIndex';
import type {RegistryChatMessage} from '../web/src/registry/registryTypes';
function readMain(): string {
  const projectRoot = path.join(__dirname, '..');
  return fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
}

function readVirtualList(): string {
  const projectRoot = path.join(__dirname, '..');
  return fs.readFileSync(
    path.join(projectRoot, 'web', 'src', 'chat', 'turns', 'ChatVirtuosoTurnList.tsx'),
    'utf8',
  );
}

function readChatTurnView(): string {
  const projectRoot = path.join(__dirname, '..');
  return fs.readFileSync(
    path.join(projectRoot, 'web', 'src', 'chat', 'ChatTurnView.tsx'),
    'utf8',
  );
}

function readChatToolCallGroup(): string {
  const projectRoot = path.join(__dirname, '..');
  return fs.readFileSync(
    path.join(projectRoot, 'web', 'src', 'chat', 'ChatToolCallGroup.tsx'),
    'utf8',
  );
}

function readDisplayIndex(): string {
  const projectRoot = path.join(__dirname, '..');
  return fs.readFileSync(
    path.join(projectRoot, 'web', 'src', 'chat', 'turns', 'chatDisplayIndex.ts'),
    'utf8',
  );
}

function readStyles(): string {
  const projectRoot = path.join(__dirname, '..');
  return readWebStyles(projectRoot);
}

function cssRuleBlock(stylesCss: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return stylesCss.match(new RegExp(`${escaped} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '';
}

describe('web chat turn rendering', () => {
  test('folds operation lifecycle events into one row at the latest turn', () => {
    const messages: RegistryChatMessage[] = [
      {sessionId: 's1', turnIndex: 3, method: 'session_operation', param: {operationId: 'op-1', type: 'compact', status: 'started'}},
      {sessionId: 's1', turnIndex: 4, method: 'session_operation', param: {operationId: 'op-1', type: 'compact', status: 'completed'}},
      {sessionId: 's1', turnIndex: 5, method: 'session_operation', param: {operationId: 'op-2', type: 'compact', status: 'failed'}},
    ];

    const display = buildChatDisplayIndex(messages, {shouldRender: () => false});

    expect(display.items.map(item => item.turnIndex)).toEqual([4, 5]);
    expect(display.items.every(item => item.estimatedHeight >= 40 && item.estimatedHeight <= 56)).toBe(true);
  });

  test('renders chat turns through the virtual display index instead of prompt groups', () => {
    const main = readMain();
    const chatTurn = readChatTurnView();

    expect(main).toContain("import { ChatTurnView } from '../chat/ChatTurnView';");
    expect(chatTurn).toContain('export const ChatTurnView = React.memo');
    expect(main).toContain('const chatDisplayIndex = useMemo(() => buildChatDisplayIndex(chatMessages');
    expect(main).toContain('<ChatVirtuosoTurnList');
    expect(main).not.toContain('const chatPromptGroups = useMemo');
    expect(main).not.toContain('const renderedChatPromptGroups = useMemo');
    expect(main).not.toContain('{renderedChatPromptGroups}');
  });

  test('uses virtualized display metadata and full-store prompt copy', () => {
    const main = readMain();
    const virtualList = readVirtualList();

    expect(virtualList).toContain("import {Virtuoso, type Components, type VirtuosoHandle} from 'react-virtuoso';");
    expect(virtualList).toContain('export type ChatVirtuosoTurnListHandle = {');
    expect(virtualList).toContain('React.useImperativeHandle(ref, () => ({');
    expect(virtualList).toContain('const scrollToLastDisplayItem = React.useCallback(');
    expect(virtualList).toContain("index: 'LAST',");
    expect(virtualList).toContain("align: 'end',");
    expect(virtualList).not.toContain('offset: virtuosoContext.bottomBuffer,');
    expect(virtualList).toContain('virtuosoRef.current?.autoscrollToBottom();');
    expect(virtualList).toContain('components={ChatVirtuosoComponents}');
    expect(virtualList).toContain('context={virtuosoContext}');
    expect(virtualList).toContain('itemContent={(index, displayItem) => {');
    expect(virtualList).toContain('runtimeKey: string;');
    expect(virtualList).toContain('key={runtimeKey}');
    expect(virtualList).toContain('customScrollParent={scrollParent}');
    expect(virtualList).toContain('computeItemKey={(index, item) => item.key}');
    expect(virtualList).toContain('const initialTopMostItemIndex = React.useMemo(');
    expect(virtualList).toContain('initialTopMostItemIndex={initialTopMostItemIndex}');
    expect(virtualList).toContain('increaseViewportBy={{top: viewportIncrease, bottom: viewportIncrease}}');
    expect(virtualList).toContain('atBottomStateChange={handleAtBottomStateChange}');
    expect(virtualList).toContain("followOutput={() => (shouldAutoscrollNow() ? 'auto' : false)}");
    expect(virtualList).toContain('totalListHeightChanged={handleTotalListHeightChanged}');
    expect(virtualList).toContain('className="chat-virtuoso-footer"');
    expect(virtualList).not.toContain('@tanstack/react-virtual');
    expect(virtualList).not.toContain('chatVirtualMeasurements');
    expect(virtualList).not.toContain('shouldAdjustChatVirtualItemSizeChange');
    expect(main).toContain('buildChatDisplayIndex,');
    expect(main).toContain('chatDisplayItemContainsTurn,');
    expect(main).toContain('type ChatDisplayIndexItem,');
    expect(main).toContain("} from '../chat/turns/chatDisplayIndex';");
    expect(main).toContain("import {ChatVirtuosoTurnList, type ChatVirtuosoTurnListHandle} from '../chat/turns/ChatVirtuosoTurnList';");
    expect(main).toContain('const chatVirtuosoListRef = useRef<ChatVirtuosoTurnListHandle | null>(null);');
    expect(main).toContain("chatVirtuosoListRef.current?.scrollToBottom('auto');");
    expect(main).not.toContain('chatVirtuosoListRef.current?.autoscrollToBottom();');
    expect(main).toContain('const handleChatAtBottomChange = useCallback((atBottom: boolean) => {');
    expect(main).toContain('setChatShowScrollToBottom(!atBottom);');
    expect(main).toContain('ref={chatVirtuosoListRef}');
    expect(main).toContain('atBottomThreshold={CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD}');
    expect(main).toContain('onAtBottomChange={handleChatAtBottomChange}');
    expect(main).toContain('shouldAutoscroll={shouldAutoscrollChat}');
    expect(main).toContain('runtimeKey={activeChatRuntimeKey}');
    expect(main).not.toContain('container.scrollTop = nextScrollTop;');
    expect(main).not.toContain('resolveChatBottomScrollTop');
    expect(main).not.toContain("from '../chat/chatTurnWindow'");
    expect(main).toContain('buildPromptDoneCopyRange(selectedFullChatMessages, doneTurnIndex)');
    expect(main).toContain('copyDisabled={copyRange ? !copyRange.ok : true}');
  });

  test('matches virtual row gap to the normal markdown paragraph gap', () => {
    const virtualList = readVirtualList();
    const styles = readStyles();
    const paragraphMargin = styles.match(/\.chat-main-message p,[\s\S]*?margin: 0 0 (\d+)px 0;/)?.[1] ?? '';

    expect(paragraphMargin).toBe('10');
    expect(virtualList).toContain('rowGap = 10,');
    expect(virtualList).not.toContain('overscan = 12');
  });

  test('renders prompt responding status and delivery states for pending prompts', () => {
    const main = readMain();
    const chatTurn = readChatTurnView();

    expect(main).toContain('buildPromptTurnStatusIndex,');
    expect(main).toContain('findPromptStartForDone,');
    expect(main).toContain("} from '../chat/turns/chatPromptStatus';");
    expect(main).toContain('selectedChatEncodedKey && chatVisibleRuntimeKeyRef.current === selectedChatEncodedKey');
    expect(main).toContain('? chatMessages');
    expect(main).toContain('const selectedPromptTurnStatusIndex = useMemo(');
    expect(main).toContain('promptStatus: selectedPromptTurnStatusIndex.statusFor,');
    expect(main).toContain('const selectedChatHasOpenPromptTurn = selectedPromptTurnStatusIndex.hasOpenPrompt;');
    expect(main).not.toContain('resolvePromptTurnStatus(selectedFullChatMessages, message)');
    expect(chatTurn).toContain("import { resolvePromptDoneStatus, type ChatPromptStatus } from './turns/chatPromptStatus';");
    expect(chatTurn).toContain('promptStatus?: ChatPromptStatus;');
    expect(chatTurn).toContain("promptStatus === 'responding'");
    expect(chatTurn).toContain("promptStatus === 'confirming'");
    expect(chatTurn).toContain("promptStatus === 'undelivered'");
    expect(chatTurn).toContain('className="chat-prompt-status-dots"');
    expect(chatTurn).toContain('className="chat-prompt-delivery-line"');
    expect(chatTurn).toContain('onRetryPendingPrompt?: () => void;');
    expect(chatTurn).toContain('onEditPendingPrompt?: () => void;');
    expect(main).toContain('const [chatPendingPromptsByKey, setChatPendingPromptsByKey] = useState');
    expect(main).toContain('const chatPendingPromptTimersRef = useRef<Record<string, number>>({});');
    expect(main).toContain('rememberPendingChatPrompt(runtimeKey, {');
    expect(main).toContain("status: 'confirming',");
    expect(main).toContain('markPendingChatPromptUndelivered(runtimeKey');
    expect(main).toContain('forgetPendingChatPrompt(runtimeKey);');
    expect(main).toContain('chatMessages.length === 0 && !selectedPendingPrompt');

    const pendingIndex = main.indexOf('rememberPendingChatPrompt(runtimeKey, {');
    const sendIndex = main.indexOf('const result = await service.sendProjectSessionMessage(selectedProjectId, {');
    expect(pendingIndex).toBeGreaterThanOrEqual(0);
    expect(sendIndex).toBeGreaterThan(pendingIndex);
  });

  test('renders queued prompts in the chat stream with queue actions', () => {
    const main = readMain();
    const chatTurn = readChatTurnView();
    const displayIndex = readDisplayIndex();
    const styles = readStyles();

    expect(displayIndex).toContain("kind: 'turn' | 'tool-group' | 'pending' | 'queued';");
    expect(displayIndex).toContain('queuedKeys?: string[];');
    expect(displayIndex).toContain("kind: 'queued'");
    expect(chatTurn).toContain("'queued'");
    expect(chatTurn).toContain('onCancelQueuedPrompt?: () => void;');
    expect(chatTurn).toContain('onPrioritizeQueuedPrompt?: () => void;');
    expect(chatTurn).toContain('onSteerQueuedPrompt?: () => void;');
    expect(chatTurn).toContain('queuedPromptSteering?: boolean;');
    expect(main).toContain('service.steerProjectSession(');
    expect(main).toContain('setQueuedChatPromptSteering(current, runtimeKey, prompt.id, true)');
    expect(main).toContain("message.method === 'user_message_chunk'");
    expect(main).toContain("message.param.steered === true");
    expect(main).toContain('hasSteeringChatPrompt(chatQueuedPromptsByKeyRef.current, runtimeKey)');
    expect(main).toContain('(chatQueuedPromptsByKeyRef.current[runtimeKey] ?? []).some(');
    expect(main).not.toContain('chatAcceptedSteerIdsByKeyRef');
    expect(main).toContain('reconcileSteeredChatPrompts(current, selectedChatEncodedKey, selectedFullChatMessages)');
    const steerStart = main.indexOf('const steerQueuedPrompt = useCallback((');
    const steerEnd = main.indexOf('const clearPendingChatPromptTimer =', steerStart);
    const steerBlock = main.slice(steerStart, steerEnd);
    expect(steerStart).toBeGreaterThanOrEqual(0);
    expect(steerEnd).toBeGreaterThan(steerStart);
    expect(steerBlock).toContain("if (result.outcome === 'sent') {");
    expect(chatTurn).toContain('chat-prompt-status-queued');
    expect(chatTurn).toContain('Queued');
    expect(chatTurn).toContain('title="Steer"');
    expect(chatTurn).toContain('aria-label="Steer"');
    expect(chatTurn).toContain('<ChatIcon name="cornerDownLeft"');
    expect(chatTurn).toContain('title="Next"');
    expect(chatTurn).toContain('<ChatIcon name="arrowUpToLine"');
    expect(chatTurn).toContain('title="Cancel"');
    expect(chatTurn).not.toContain('Send next');
    expect(chatTurn).toContain('chat-prompt-steered-label');
    expect(styles).toContain('.chat-prompt-status-queued');
    expect(styles).toContain('.chat-prompt-queue-actions');
  });

  test('renders persisted prompt attachments as user-visible chips', () => {
    const main = readMain();
    const chatTurn = readChatTurnView();
    const styles = readStyles();

    expect(chatTurn).toContain("} from './composer/chatPromptAttachments';");
    expect(chatTurn).toContain('const attachmentBlocks = groupPromptAttachmentBlocks([message]);');
    expect(chatTurn).toContain('className="chat-prompt-attachment-strip"');
    expect(chatTurn).toContain('className={`chat-prompt-attachment-chip ${isPromptImageAttachmentContentBlock(block) ? \'image\' : \'file\'}`}');
    expect(chatTurn).toContain('const label = chatPromptAttachmentLabel(block, index);');
    expect(chatTurn).toContain('const meta = chatPromptAttachmentMeta(block);');
    expect(chatTurn).toContain('onOpenPromptAttachment?: (block: RegistrySessionContentBlock, message: RegistryChatMessage) => void;');
    expect(chatTurn).toContain('onClick={() => onOpenPromptAttachment?.(block, message)}');
    expect(chatTurn).toContain('const thumbnailSrc = resolvePromptAttachmentThumbnail?.(block, message) ?? \'\';');
    expect(chatTurn).toContain('className="chat-prompt-attachment-thumb"');
    expect(main).toContain('groupPromptAttachmentBlocks([message]).length > 0');
    expect(main).toContain('onOpenPromptAttachment={openChatAttachmentPreview}');
    expect(styles).toContain('.chat-prompt-attachment-strip {');
    expect(styles).toContain('.chat-prompt-attachment-chip {');
    expect(styles).toContain('.chat-prompt-attachment-thumb {');
    expect(styles).toContain('.chat-prompt-attachment-name {');
  });

  test('renders prompt inline capsules for new prompt file mentions', () => {
    const chatTurn = readChatTurnView();
    const styles = readStyles();

    expect(chatTurn).toContain("from './composer/chatPromptInlineParts'");
    expect(chatTurn).toContain('buildChatPromptInlineParts(');
    expect(chatTurn).toContain('className={`chat-prompt-inline-capsule ${part.type}`}');
    expect(styles).toContain('.chat-prompt-inline-capsule');
  });

  test('renders prompt done stop reason labels without disabling copied partial output', () => {
    const main = readMain();
    const chatTurn = readChatTurnView();

    expect(chatTurn).toContain('const doneStatus = resolvePromptDoneStatus(message.param);');
    expect(chatTurn).toContain('className={`chat-prompt-stop-reason ${doneStatus.kind}`}');
    expect(chatTurn).toContain('className={`chat-prompt-result-line ${doneStatus.kind}`}');
    expect(main).toContain('copyDisabled={copyRange ? !copyRange.ok : true}');
    expect(main).not.toContain("copyDisabled={failed ? true :");
  });

  test('renders a composer cancel button in a reserved slot after upload while a prompt is running', () => {
    const main = readMain();

    expect(main).toContain('const selectedChatPromptRunning =');
    expect(main).toContain('selectedChatSession?.running === true');
    expect(main).not.toContain('chatRunningSessionFlags[selectedChatEncodedKey] === true');
    expect(main).toContain('const [chatCancellingRuntimeKey, setChatCancellingRuntimeKey] = useState');
    expect(main).toContain('const cancelSelectedChatPrompt = async () => {');
    expect(main).toContain('service.cancelProjectSession(selectedKey.projectId, selectedKey.sessionId)');
    expect(main).toContain('className="chat-composer-input-row"');
    expect(main).toContain('className="chat-tool-button chat-attachment-plus-button"');
    expect(main).toContain('chat-composer-stop-slot${chatStopPillExiting');
    expect(main).toContain('<ChatStopStatusPill');
    expect(main.indexOf('className="chat-tool-button chat-attachment-plus-button"')).toBeLessThan(main.indexOf('chat-composer-stop-slot${chatStopPillExiting'));
    expect(main).toContain('cancelling={selectedChatPromptCancelling}');
    expect(main).not.toContain('disabled={!selectedChatPromptRunning || selectedChatPromptCancelling}');
    expect(main).not.toContain('No prompt running');
    expect(main).not.toContain('codicon-stop-circle');
  });

  test('shows a scroll-to-bottom button when the user is away from the bottom', () => {
    const main = readMain();

    expect(main).toContain('const [chatShowScrollToBottom, setChatShowScrollToBottom] = useState(false);');
    expect(main).toContain('setChatShowScrollToBottom(!atBottom);');
    expect(main).toContain('className="chat-scroll-bottom-button"');
    expect(main).toContain('className="chat-scroll-bottom-glyph"');
    expect(main).not.toContain('updateSelectedChatWindowFromScroll(event.currentTarget, direction);');
  });

  test('renders plan updates through a dedicated desktop and mobile surface outside the chat stream', () => {
    const main = readMain();
    const chatTurn = readChatTurnView();
    const displayIndex = readDisplayIndex();
    const styles = readStyles();

    expect(main).toContain("import {ChatPlanSurface} from '../chat/ChatPlanSurface';");
    expect(main).toContain("import {extractLatestChatPlan} from '../chat/chatPlan';");
    expect(main).toContain('const selectedChatPlan = useMemo(');
    expect(main).toContain('extractLatestChatPlan(selectedFullChatMessages)');
    expect(main).toContain('<ChatPlanSurface');
    expect(main).toContain('mode="desktop"');
    expect(main).toContain('mode="mobile"');
    expect(main).toContain('plan={selectedChatPlan}');
    expect(chatTurn).not.toContain("case 'agent_plan':");
    expect(chatTurn).not.toContain("kind === 'plan'");
    expect(displayIndex).toContain("if (message.method === 'agent_plan') {");
    expect(displayIndex).toContain('return clampHeight(0);');
    expect(styles).toContain('.chat-plan-surface.desktop');
    expect(styles).toContain('.chat-plan-surface.mobile');
    expect(styles).toContain('.chat-plan-compact-trigger');
    expect(styles).toContain('.chat-plan-surface.mobile.expanded');
  });

  test('anchors the desktop surface stack to the left edge of the chat area', () => {
    const styles = readStyles();
    const stackBlock = cssRuleBlock(styles, '.chat-edge-surface-stack');
    const fixedBlock = cssRuleBlock(styles, '.chat-view-width-fixed-800 .chat-edge-surface-stack');
    const itemBlock = cssRuleBlock(
      styles,
      '.chat-edge-surface-stack > .chat-recent-sessions-surface.desktop,\n.chat-edge-surface-stack > .chat-goal-surface.desktop,\n.chat-edge-surface-stack > .chat-plan-surface.desktop,\n.chat-edge-surface-stack > .chat-function-surface.desktop',
    );

    expect(styles).toContain('--chat-edge-surface-width: var(--chat-session-panel-width);');
    expect(stackBlock).toContain('--chat-edge-surface-stack-width: var(--chat-edge-surface-width);');
    expect(stackBlock).toContain('width: var(--chat-edge-surface-stack-resolved-width);');
    expect(fixedBlock).toContain('left: 0;');
    expect(fixedBlock).not.toContain('(100% - 800px) / 2');
    expect(itemBlock).toContain('left: auto;');
    expect(itemBlock).toContain('right: auto;');
    expect(itemBlock).toContain('bottom: auto;');
    expect(itemBlock).toContain('width: 100%;');
  });

  test('settles chat bottom after the mobile keyboard inset changes without fighting keyboard close animation', () => {
    const main = readMain();

    expect(main).toContain('const keyboardInsetScrollAction = resolveChatKeyboardInsetScrollAction({');
    expect(main).toContain("if (keyboardInsetScrollAction === 'immediate') {");
    expect(main).toContain("if (keyboardInsetScrollAction === 'deferred') {");
    expect(main).toContain('chatKeyboardInsetSettleTimerRef.current = window.setTimeout(() => {');
    expect(main).toContain('}, CHAT_KEYBOARD_INSET_SETTLE_DELAY_MS);');
  });

  test('resets follow-bottom intent only for explicit latest-window resets', () => {
    const main = readMain();

    expect(main).toContain('resolveChatSessionReadWindowUpdate({');
    expect(main).toContain('useIncremental: appliedAfterTurnIndex > 0,');
    expect(main).toContain('followsLatest: chatAutoScrollFollowRef.current,');
    expect(main).toContain('const resettingToLatest = options?.resetToLatest === true;');
    expect(main).toContain('if (resettingToLatest && encodeChatSessionKey(selectedChatKeyRef.current) === runtimeKey) {');
    expect(main).toContain('chatAutoScrollFollowRef.current = true;');
    expect(main).toContain('chatUserScrollLockUntilRef.current = 0;');
  });

  test('keeps collapsed tool groups fixed-height and plan updates outside message content', () => {
    const chatTurn = readChatTurnView();
    const toolGroup = readChatToolCallGroup();
    const styles = readStyles();
    expect(chatTurn).not.toContain('chat-tool-line');
    expect(toolGroup).toContain('className="chat-tool-group-header"');
    expect(toolGroup).toContain('className="chat-tool-group-count"');
    expect(toolGroup).toContain('className="chat-tool-group-latest"');
    expect(chatTurn).toContain("if (message.method === 'agent_plan') {");
    expect(chatTurn).toMatch(/if \(message\.method === 'agent_plan'\) \{\s*return null;/);
    expect(styles).toContain('/* workspace-ui-targeted-evolution: chat reading */');
    expect(styles).toMatch(/\.chat-tool-group-header\s*\{[^}]*height:\s*28px;/s);
    expect(styles).toMatch(/\.chat-tool-group-latest,[\s\S]*?white-space:\s*nowrap;/s);
  });

  test('disables new message entry motion when reduced motion is requested', () => {
    const styles = readStyles();
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.chat-turn-entry[\s\S]*?animation:\s*none;/);
  });
});
