import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
const root = path.resolve(__dirname, '..');
const mainTsx = fs.readFileSync(path.join(root, 'web/src/app/WorkspaceApp.tsx'), 'utf8');
const settingsSurfaceTsx = fs.readFileSync(path.join(root, 'web/src/settings/SettingsSurface.tsx'), 'utf8');
const detailPath = path.join(root, 'web/src/settings/PortRelaySettingsDetail.tsx');
const detailTsx = fs.existsSync(detailPath) ? fs.readFileSync(detailPath, 'utf8') : '';
const surfacePath = path.join(root, 'web/src/portRelay/PortRelayFrameSurface.tsx');
const surfaceTsx = fs.existsSync(surfacePath) ? fs.readFileSync(surfacePath, 'utf8') : '';
const previewChromePath = path.join(root, 'web/src/preview/PreviewWorkbenchChrome.tsx');
const previewChromeTsx = fs.existsSync(previewChromePath) ? fs.readFileSync(previewChromePath, 'utf8') : '';
const portRelaySettingsSource = `${mainTsx}\n${detailTsx}`;
const stylesCss = readWebStyles(root);

describe('port relay settings UI source structure', () => {
  test('adds Port Relay as a settings detail and mobile shortcut bar entry', () => {
    expect(mainTsx).toContain('type SettingsDetailView = SettingsDetailId | null;');
    expect(mainTsx).toContain("if (detail === 'portRelay') {");
    expect(mainTsx).toContain('renderPortRelaySettingsDetail(options)');
    expect(mainTsx).toContain("setSettingsDetailView('portRelay')");
    expect(mainTsx).not.toContain("renderSettingsSection('More'");

    expect(mainTsx).toContain('<MobileSettingsShortcutBar');
    expect(mainTsx).toContain('onDetailSelect={openMobileSettingsShortcutDetail}');
    const mobileShortcutsStart = settingsSurfaceTsx.indexOf('export const MOBILE_SETTINGS_SHORTCUTS');
    const mobileShortcutsEnd = settingsSurfaceTsx.indexOf('export function settingsDetailTitle', mobileShortcutsStart);
    expect(mobileShortcutsStart).toBeGreaterThanOrEqual(0);
    expect(mobileShortcutsEnd).toBeGreaterThan(mobileShortcutsStart);
    const mobileShortcuts = settingsSurfaceTsx.slice(mobileShortcutsStart, mobileShortcutsEnd);
    expect(mobileShortcuts.indexOf("detail: 'skills'")).toBeLessThan(mobileShortcuts.indexOf("detail: 'portRelay'"));
    expect(settingsSurfaceTsx).toContain('onClick={() => onDetailSelect(shortcut.detail)}');
  });

  test('renders Port Relay controls and service hooks', () => {
    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ '../settings/SettingsBundle')");
    expect(mainTsx).toContain('const renderPortRelaySettingsDetail = (options?: SettingsDetailShellOptions) =>');
    expect(mainTsx).toContain('<PortRelaySettingsDetail');
    expect(fs.existsSync(detailPath)).toBe(true);
    expect(mainTsx).toContain('refreshPortRelayStatus');
    expect(mainTsx).toContain('service.getPortRelayStatus');
    expect(mainTsx).toContain('service.enablePortRelay');
    expect(mainTsx).toContain('service.disablePortRelay');
    expect(mainTsx).toContain('service.regeneratePortRelayAccessCode');
    expect(mainTsx).toContain('generatePortRelayAccessCode');
    expect(mainTsx).toContain("import { appendPortRelayAutoAuthCode, appendPortRelayOpenPath, parsePortRelayLocalHttpUrl, resolvePortRelayOpenUrl } from '../portRelay/portRelayUrl';");
    expect(mainTsx).toContain('resolvePortRelayOpenUrl({');
    expect(mainTsx).toContain('relayUrl: portRelaySnapshot.relayUrl');
    expect(mainTsx).toContain('const portRelayFrameAccessCode = portRelayAccessCodeUnknown ? \'\' : portRelayAccessCode;');
    expect(mainTsx).toContain('appendPortRelayAutoAuthCode(');
    expect(mainTsx).toContain('buildPortRelayClearSiteDataUrl(');
    expect(mainTsx).toContain('const clearPortRelaySiteData = useCallback(async () => {');
    expect(mainTsx).toContain('getNativeRuntimeBridge()?.clearPortRelaySiteData?.(portRelayFrameUrl)');
    expect(mainTsx).toContain('setPortRelayClearSiteDataUrl(clearUrl);');
    expect(mainTsx).toContain('setPortRelayFrameReloadKey(key => key + 1);');
    expect(mainTsx).not.toContain('preferDirectPortRelayUrl');
    expect(mainTsx).not.toContain('preferSnapshotRelayUrl');
    expect(mainTsx).toContain('const desktopWindowControlsVisible = isWide && Boolean(getDesktopWindowBridge());');
    expect(mainTsx).not.toContain('window.open(openUrl, \'_blank\', \'noopener,noreferrer\')');

    expect(detailTsx).toContain('className="port-relay-stack"');
    expect(detailTsx).toContain('className="set-field"');
    expect(detailTsx).toContain('className="port-relay-code-row"');
    expect(detailTsx).toContain('className={`set-status ${statusVariant}`}');
    expect(detailTsx).toContain('clearPortRelaySiteData');
    expect(detailTsx).toContain('Clear Cache');
    expect(detailTsx).toContain('aria-label="Clear relay cache and service worker data"');
    expect(stylesCss).toContain('.port-relay-stack');
    expect(stylesCss).toContain('.set-field');
    expect(stylesCss).toContain('.port-relay-code-row');
    expect(stylesCss).toContain('.set-status');
    expect(stylesCss).toContain('.port-relay-clear-site-data-frame');
  });

  test('opens every visible Port Relay frame through unified preview tabs', () => {
    expect(mainTsx).toContain("const PORT_RELAY_FLOATING_Y_RATIO_STORAGE_KEY = 'wheelmaker:portRelayFloatingYRatio';");
    expect(mainTsx).toContain("const PORT_RELAY_FLOATING_SLOT_STORAGE_KEY = 'wheelmaker:portRelayFloatingSlot';");
    expect(mainTsx).toContain("const PORT_RELAY_FLOATING_SIDE_STORAGE_KEY = 'wheelmaker:portRelayFloatingSide';");
    expect(mainTsx).toContain('readPortRelayFloatingYRatio()');
    expect(mainTsx).toContain('readPortRelayFloatingSide()');
    expect(mainTsx).toContain('window.localStorage.setItem(PORT_RELAY_FLOATING_Y_RATIO_STORAGE_KEY, String(nextYRatio));');
    expect(mainTsx).toContain('window.localStorage.setItem(PORT_RELAY_FLOATING_SIDE_STORAGE_KEY, nextSide);');
    expect(mainTsx).toContain('const floatingControlSide = workspaceUiState.mobile.floatingControlSide;');
    expect(mainTsx).toContain('data-side={floatingControlSide}');
    expect(mainTsx).toContain('originX: event.clientX,');
    expect(mainTsx).toContain('startSide: floatingControlSide,');
    expect(mainTsx).toContain('currentX: event.clientX,');
    expect(mainTsx).toContain("} from '../shell/layouts/mobile/floatingControls';");
    expect(mainTsx).toContain('resolveFloatingControlDragSide(');
    expect(mainTsx).toContain('floatingControlSideRef.current');
    expect(mainTsx).not.toContain("const nextSide = current.currentX < windowWidth / 2 ? 'left' : 'right';");
    expect(mainTsx).toContain("dispatchWorkspaceUi({ type: 'mobile/setFloatingControlSide', next });");
    expect(mainTsx).toContain('const [portRelayFrameAutoOpenPending, setPortRelayFrameAutoOpenPending] = useState(false);');
    expect(mainTsx).toContain("portRelaySnapshot.enabled && portRelaySnapshot.status === 'Up'");
    expect(mainTsx).toContain('setPortRelayFrameAutoOpenPending(false);');
    expect(mainTsx).toContain('const openPortRelayWorkbenchTab = useCallback(async (');
    expect(mainTsx).toContain("type: 'port-relay'");
    expect(mainTsx).toContain("previewTabId({type: 'port-relay'");
    expect(mainTsx).toContain('const handleDesktopPortRelaySelect = useCallback(() => {');
    expect(mainTsx).not.toContain('onClick={handleDesktopPortRelaySelect}');
    expect(mainTsx).toContain("import { PortRelayFrameSurface } from '../portRelay/PortRelayFrameSurface';");
    expect(mainTsx).toContain('<PortRelayFrameSurface');
    expect(mainTsx).toContain('mode={mode}');
    expect(mainTsx).toContain('chrome={false}');
    expect(mainTsx).toContain('url={portRelayFrameUrl || activePortRelayPreview.url}');
    expect(mainTsx).toContain('key={`workbench:${activePortRelayPreview.id}:${activePortRelayPreview.reloadKey}:${portRelayFrameUrl}`}');
    expect(mainTsx).not.toContain('<PortRelayFloatingButton');
    expect(mainTsx).toContain('resolveFloatingNavRelayState({');
    expect(surfaceTsx).toContain('className={`port-relay-frame-surface ${mode}`}');
    expect(surfaceTsx).toContain('className="chat-preview-title"');
    expect(surfaceTsx).toContain('aria-label="Open relay page in browser"');
    expect(surfaceTsx).toContain('<iframe');
    expect(surfaceTsx).toContain('src={url}');
    expect(surfaceTsx).toContain('className="port-relay-frame"');
    expect(surfaceTsx).not.toContain('codicon');
    expect(mainTsx).not.toContain("type PortRelayFramePlacement = 'main' | 'chatPreview';");
    expect(mainTsx).not.toContain('setPortRelayFramePlacement(');
    expect(mainTsx).not.toContain('const portRelayMobileFrameOverlay = mobilePortRelayFrameOpen');

    expect(stylesCss).toContain('.port-relay-frame-surface');
    expect(stylesCss).toContain('.port-relay-frame-surface.mobile');
    expect(stylesCss).toContain('.port-relay-frame');
    expect(stylesCss).not.toContain('.port-relay-floating-bubble');
    expect(stylesCss).toContain(".floating-control-stack[data-side='left']");
    expect(stylesCss).toContain(".floating-control-stack[data-side='right']");
    expect(stylesCss).not.toContain('.port-relay-target-switch-menu');
  });

  test('loads the relay cleanup page in a hidden iframe before reloading visible relay frames', () => {
    expect(mainTsx).toContain('const [portRelayClearSiteDataUrl, setPortRelayClearSiteDataUrl] = useState(\'\');');
    expect(mainTsx).toContain('const [portRelayFrameReloadKey, setPortRelayFrameReloadKey] = useState(0);');
    expect(mainTsx).toContain('const portRelayClearSiteDataFrame = portRelayClearSiteDataUrl ? (');
    expect(mainTsx).toContain('className="port-relay-clear-site-data-frame"');
    expect(mainTsx).toContain('title="Port Relay site data cleanup"');
    expect(mainTsx).toContain('{portRelayClearSiteDataFrame}');
    expect(mainTsx).toContain('key={`workbench:${activePortRelayPreview.id}:${activePortRelayPreview.reloadKey}:${portRelayFrameUrl}`}');
  });

  test('adds a mobile Port Relay iframe refresh button above the full-screen toggle', () => {
    expect(mainTsx).toContain('const refreshActivePortRelayPreview = () => {');
    expect(mainTsx).toContain('updatePreviewTab(current, tab.projectId, tab.id, item =>');
    expect(mainTsx).toContain("item.type === 'port-relay'");
    expect(mainTsx).toContain('reloadKey: item.reloadKey + 1');
    expect(mainTsx).toContain('onMobilePortRelayRefresh={refreshActivePortRelayPreview}');

    expect(previewChromeTsx).toContain('onMobilePortRelayRefresh?: () => void;');
    expect(previewChromeTsx).toContain("activeTab?.type === 'port-relay' && onMobilePortRelayRefresh ? (");
    expect(previewChromeTsx).toContain('className="preview-workbench-mobile-port-relay-refresh"');
    expect(previewChromeTsx).toContain('aria-label="Refresh relay page"');
    expect(previewChromeTsx).toContain('<Icon name="refreshCw" />');

    expect(stylesCss).toContain('.preview-workbench-mobile-port-relay-refresh');
    const refreshStart = stylesCss.indexOf('.preview-workbench-mobile-port-relay-refresh');
    const fullscreenStart = stylesCss.indexOf('.preview-workbench-mobile-header-toggle', refreshStart);
    expect(refreshStart).toBeGreaterThanOrEqual(0);
    expect(fullscreenStart).toBeGreaterThan(refreshStart);
    const refreshCss = stylesCss.slice(refreshStart, fullscreenStart);
    expect(refreshCss).toContain('bottom: calc(max(14px, var(--wm-safe-area-bottom)) + 44px);');
  });

  test('tracks relay enable status and polls opening status silently', () => {
    expect(mainTsx).toContain('setPortRelayFrameAutoOpenPending((options.openFrame ?? isWide) && snapshot.enabled);');
    expect(mainTsx).toContain("if (!portRelayFrameAutoOpenPending) {");
    expect(mainTsx).toContain("portRelaySnapshot.status !== 'Opening'");
    expect(mainTsx).toContain('refreshPortRelayStatus({silent: true}).catch(() => undefined);');
    expect(mainTsx).toContain("const refreshPortRelayStatus = useCallback(async (options?: {silent?: boolean}) => {");
  });

  test('hides desktop Port Relay shortcut while keeping the settings peer handler', () => {
    expect(mainTsx).toContain('const handleDesktopPortRelaySelect = useCallback(() => {');
    expect(mainTsx).toContain("openSettingsPeer('portRelay');");
    expect(mainTsx).not.toContain('const desktopActivityBar = isWide ? (');
    expect(mainTsx).not.toContain('className="desktop-activity-bar"');
    expect(mainTsx).not.toContain('title="Port Relay"');
    expect(mainTsx).not.toContain('onClick={handleDesktopPortRelaySelect}');
  });

  test('turns chat localhost links into relay iframe actions for the current project hub', () => {
    expect(mainTsx).toContain("import { appendPortRelayAutoAuthCode, appendPortRelayOpenPath, parsePortRelayLocalHttpUrl, resolvePortRelayOpenUrl } from '../portRelay/portRelayUrl';");
    expect(mainTsx).toContain('const [portRelayFramePath, setPortRelayFramePath] = useState(\'\');');
    expect(mainTsx).toContain('appendPortRelayOpenPath(baseUrl, portRelayFramePath)');
    expect(mainTsx).toContain('const openChatPortRelayLink = useCallback(async (localUrl: PortRelayLocalHttpUrl) => {');
    expect(mainTsx).toContain('const hubId = currentProject?.hubId || \'\';');
    expect(mainTsx).toContain('targetPort: localUrl.targetPort');
    expect(mainTsx).toContain("await openPortRelayWorkbenchTab(target, localUrl.path, {source: 'chat'});");
    expect(mainTsx).toContain('const relayLocalUrl = parsePortRelayLocalHttpUrl(linkHref);');
    expect(mainTsx).toContain('openChatPortRelayLink(relayLocalUrl).catch(() => undefined);');
    expect(mainTsx).toContain("isFileLink ? 'chat-file-link' : ''");
    expect(mainTsx).toContain("relayLocalUrl ? 'chat-relay-link' : ''");
    expect(mainTsx).toContain('const renderChatInlineCode = useCallback');
    expect(mainTsx).toContain('const relayLocalUrl = parsePortRelayLocalHttpUrl(codeText);');
    expect(mainTsx).toContain("className=\"chat-relay-link chat-relay-code-link\"");
    expect(mainTsx).toContain('openChatPortRelayLink(relayLocalUrl).catch(() => undefined);');
    expect(mainTsx).toContain('code: renderChatInlineCode,');
  });

  test('keeps the mobile relay iframe locked to the visible viewport', () => {
    const mobileSurfaceStart = stylesCss.indexOf('.port-relay-frame-surface.mobile');
    const mobileSurfaceEnd = stylesCss.indexOf('.port-relay-frame {', mobileSurfaceStart);
    const mobileSurfaceCss = stylesCss.slice(mobileSurfaceStart, mobileSurfaceEnd);

    expect(mobileSurfaceCss).toContain('width: 100dvw;');
    expect(mobileSurfaceCss).toContain('height: 100dvh;');
    expect(mobileSurfaceCss).toContain('max-width: 100dvw;');
    expect(mobileSurfaceCss).toContain('overflow: clip;');
    expect(mobileSurfaceCss).toContain('overscroll-behavior: none;');
    expect(mobileSurfaceCss).toContain('touch-action: pan-y;');

    const iframeStart = stylesCss.indexOf('.port-relay-frame {');
    const iframeEnd = stylesCss.indexOf('.floating-control-stack-layer', iframeStart);
    const iframeCss = stylesCss.slice(iframeStart, iframeEnd);

    expect(iframeCss).toContain('max-width: 100%;');
  });

  test('hides the drawer while the relay iframe is open but keeps the nav draggable', () => {
    expect(mainTsx).toContain('const mobilePortRelayFrameOpen = !isWide && portRelayWorkbenchOpen;');
    expect(mainTsx).toContain('if (!mobilePortRelayFrameOpen) {');
    expect(mainTsx).toContain('setDrawerOpen(false);');
    expect(mainTsx).toContain('setSidebarSettingsOpen(false);');
    expect(mainTsx).toContain('}, [mobilePortRelayFrameOpen, setDrawerOpen, setSidebarSettingsOpen]);');
    expect(mainTsx).not.toContain('{mobilePortRelayFrameOpen ? null : (');
    expect(mainTsx).toContain('drawerOpen={mobilePortRelayFrameOpen ? false : drawerOpen}');
    expect(mainTsx).not.toContain('const portRelayMobileFrameOverlay = mobilePortRelayFrameOpen');
  });

  test('switches relay targets from a mobile bottom sheet in the floating nav', () => {
    expect(mainTsx).toContain('orderPortRelayTargetsForMenu(');
    expect(mainTsx).toContain('useMenuExitState<{open: true}>()');
    expect(mainTsx).toContain('const handleFloatingNavRelayOpen = useCallback(() => {');
    expect(mainTsx).toContain('if (portRelayTargetMenuTargets.length > 1) {');
    expect(mainTsx).toContain('setMobileRelayTargetSheet({open: true});');
    expect(mainTsx).toContain('const handleMobilePortRelayTargetMenuSelect = useCallback(async (target: PortRelayTarget) => {');
    expect(mainTsx).toContain('if (samePortRelayTarget(activePortRelayTarget, target)) {');
    expect(mainTsx).toContain("await openPortRelayWorkbenchTab(target, '', {source: 'floating'});");
    expect(mainTsx).toContain('const handlePortRelayFloatingTargetSelect = useCallback((target: PortRelayTarget) => {');
    expect(mainTsx).toContain('mobileRelayTargetSheetNode');
    expect(mainTsx).toContain('aria-label="Port Relay targets"');
    expect(mainTsx).toContain('className="wide-project-action-menu-item mobile-project-sheet-item"');
    expect(mainTsx).toContain('`${target.hubId}:${target.targetPort}`');
    expect(mainTsx).not.toContain('port-relay-target-switch-menu');

    expect(stylesCss).toContain('.mobile-project-sheet');
    expect(stylesCss).not.toContain('.port-relay-target-switch-menu');
  });

  test('keeps relay settings focused on hub local port mapping', () => {
    expect(mainTsx).toContain("const [portRelayTargets, setPortRelayTargets] = useState<PortRelayTarget[]>(");
    expect(mainTsx).toContain("const [selectedPortRelayTarget, setSelectedPortRelayTarget] = useState<PortRelayTarget | null>(");
    expect(mainTsx).toContain("const [portRelayDraftPort, setPortRelayDraftPort] = useState('80');");
    expect(mainTsx).not.toContain('const [portRelayTargetHost, setPortRelayTargetHost]');
    expect(mainTsx).not.toContain('setPortRelayTargetHost(snapshot.targetHost)');
    expect(mainTsx).toContain("targetHost: '127.0.0.1',");
    expect(detailTsx).toContain("const portRelayTargetDisplay = selectedTarget ? `${selectedTarget.hubId} → 127.0.0.1:${selectedTarget.targetPort}` : 'No target';");
    expect(detailTsx).toContain('port-relay-target-display');
    expect(detailTsx).toContain('{portRelayTargetDisplay}');
    expect(detailTsx).toContain('className="port-relay-target-list"');
    expect(detailTsx).toContain('type="checkbox"');
    expect(detailTsx).toContain('selectPortRelayTarget(target)');
    expect(detailTsx).toContain('deletePortRelayTarget(target)');
    expect(detailTsx).toContain('commitPortRelayDraftTarget();');
    expect(portRelaySettingsSource).not.toContain('<span>Target Host</span>');
    expect(portRelaySettingsSource).not.toContain('onClick={openPortRelay}');
    expect(mainTsx).toContain("if (settingsDetailView !== 'portRelay' || portRelayAccessCode || portRelaySnapshot.enabled) {");
    expect(mainTsx).toContain('setPortRelayAccessCode(generatePortRelayAccessCode());');

    expect(stylesCss).toContain('.port-relay-stack');
    expect(stylesCss).toContain('.port-relay-target-display');
    expect(stylesCss).toContain('.port-relay-target-row');
    expect(stylesCss).toContain('.port-relay-add-form');
  });

  test('adds a copy action beside generated relay access code and polished relay panel styling', () => {
    const codeRowStart = detailTsx.indexOf('className="port-relay-code-row"');
    const codeRowEnd = detailTsx.indexOf('</div>', codeRowStart);
    const codeRow = detailTsx.slice(codeRowStart, codeRowEnd);

    expect(codeRow.indexOf('Generate')).toBeGreaterThan(-1);
    expect(codeRow.indexOf('Copy')).toBeGreaterThan(codeRow.indexOf('Generate'));
    expect(mainTsx).toContain('const [portRelayCodeCopied, setPortRelayCodeCopied] = useState(false);');
    expect(mainTsx).toContain('writeTextToClipboard(portRelayAccessCode);');
    expect(detailTsx).toContain('aria-label="Copy port relay access code"');
    expect(detailTsx).toContain("{portRelayCodeCopied ? 'Copied' : 'Copy'}");

    expect(stylesCss).toContain('.port-relay-stack');
    expect(stylesCss).toContain('.set-card');
    expect(stylesCss).toContain('.set-card-title');
    expect(stylesCss).toContain('.port-relay-code-row');
    expect(stylesCss).toContain('.set-status');
  });

  test('keeps the relay status area to one line without widening the settings panel', () => {
    const statusStart = detailTsx.indexOf('className="set-card set-card--tight port-relay-status"');
    const statusEnd = detailTsx.indexOf('{portRelayError || portRelaySnapshot.error ?', statusStart);
    const statusMarkup = detailTsx.slice(statusStart, statusEnd);

    expect(statusMarkup).toContain('className="set-card-head"');
    expect(statusMarkup).toContain('port-relay-target-display');
    expect(statusMarkup).not.toContain('className="port-relay-target-row"');
    expect(statusMarkup).not.toContain('className="port-relay-url"');

    const statusCssStart = stylesCss.indexOf('.port-relay-target-display');
    const statusCssEnd = stylesCss.indexOf('.port-relay-code-row', statusCssStart);
    const statusCss = stylesCss.slice(statusCssStart, statusCssEnd);

    expect(statusCss).toContain('min-width: 0;');
    expect(statusCss).toContain('overflow: hidden;');
    expect(statusCss).toContain('.port-relay-target-display');
    expect(statusCss).toContain('text-overflow: ellipsis;');
    expect(stylesCss).toContain('.port-relay-code-row {');
    expect(stylesCss).toContain('flex-wrap: wrap;');
  });

  test('does not invent an access code for an already-enabled relay from another device', () => {
    expect(mainTsx).toContain('const [portRelayKnownAccessCodeGeneration, setPortRelayKnownAccessCodeGeneration] = useState<number | null>(null);');
    expect(mainTsx).toContain('const portRelayAccessCodeUnknown = portRelaySnapshot.enabled &&');
    expect(mainTsx).toContain("settingsDetailView !== 'portRelay' || portRelayAccessCode || portRelaySnapshot.enabled");
    expect(mainTsx).toContain('setPortRelayError(\'Access code is unknown on this device. Generate a new code before switching target.\');');
    expect(detailTsx).toContain("placeholder={portRelayAccessCodeUnknown ? 'Unknown' : ''}");
    expect(detailTsx).toContain('disabled={portRelayAccessCodeUnknown || !portRelayAccessCode}');
    expect(detailTsx).toContain("portRelayAccessCodeUnknown ? 'Reset' : 'Generate'");
    expect(mainTsx).toContain("setPortRelayError('Access code is unknown on this device. Generate a new code before copying.');");
    expect(mainTsx).toContain('setPortRelayKnownAccessCodeGeneration(typeof snapshot.accessCodeGeneration === \'number\' ? snapshot.accessCodeGeneration : null);');
  });
});
