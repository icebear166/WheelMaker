import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const mainTsx = fs.readFileSync(path.join(root, 'web/src/main.tsx'), 'utf8');
const detailPath = path.join(root, 'web/src/settings/PortRelaySettingsDetail.tsx');
const detailTsx = fs.existsSync(detailPath) ? fs.readFileSync(detailPath, 'utf8') : '';
const surfacePath = path.join(root, 'web/src/portRelay/PortRelayFrameSurface.tsx');
const surfaceTsx = fs.existsSync(surfacePath) ? fs.readFileSync(surfacePath, 'utf8') : '';
const portRelaySettingsSource = `${mainTsx}\n${detailTsx}`;
const stylesCss = fs.readFileSync(path.join(root, 'web/src/styles.css'), 'utf8');

describe('port relay settings UI source structure', () => {
  test('adds Port Relay as a settings detail and mobile shortcut bar entry', () => {
    expect(mainTsx).toContain('type SettingsDetailView = SettingsDetailId | null;');
    expect(mainTsx).toContain("settingsDetailView === 'portRelay'");
    expect(mainTsx).toContain('renderPortRelaySettingsDetail(options)');
    expect(mainTsx).toContain("setSettingsDetailView('portRelay')");
    expect(mainTsx).not.toContain("renderSettingsSection('More'");

    const mobileBarStart = mainTsx.indexOf('const mobileSettingsShortcutBar = !isWide && sidebarSettingsOpen ? (');
    const mobileBarEnd = mainTsx.indexOf('const mobileSettingsScreen = !isWide && sidebarSettingsOpen ? (', mobileBarStart);
    const mobileBar = mainTsx.slice(mobileBarStart, mobileBarEnd);
    expect(mobileBar.indexOf('title="Skills"')).toBeLessThan(mobileBar.indexOf('title="Port Relay"'));
    expect(mobileBar.indexOf('title="Port Relay"')).toBeLessThan(mobileBar.indexOf('title="Token Stats"'));
    expect(mobileBar).toContain("openMobileSettingsShortcutDetail('portRelay')");
  });

  test('renders Port Relay controls and service hooks', () => {
    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ './settings/SettingsBundle')");
    expect(mainTsx).toContain('const renderPortRelaySettingsDetail = (options?: SettingsDetailShellOptions) =>');
    expect(mainTsx).toContain('<PortRelaySettingsDetail');
    expect(fs.existsSync(detailPath)).toBe(true);
    expect(mainTsx).toContain('refreshPortRelayStatus');
    expect(mainTsx).toContain('service.getPortRelayStatus');
    expect(mainTsx).toContain('service.enablePortRelay');
    expect(mainTsx).toContain('service.disablePortRelay');
    expect(mainTsx).toContain('service.regeneratePortRelayAccessCode');
    expect(mainTsx).toContain('generatePortRelayAccessCode');
    expect(mainTsx).toContain("import { appendPortRelayAutoAuthCode, appendPortRelayOpenPath, parsePortRelayLocalHttpUrl, resolvePortRelayOpenUrl } from './portRelay/portRelayUrl';");
    expect(mainTsx).toContain('resolvePortRelayOpenUrl({');
    expect(mainTsx).toContain('relayUrl: portRelaySnapshot.relayUrl');
    expect(mainTsx).toContain('const portRelayFrameAccessCode = portRelayAccessCodeUnknown ? \'\' : portRelayAccessCode;');
    expect(mainTsx).toContain('appendPortRelayAutoAuthCode(');
    expect(mainTsx).not.toContain('preferDirectPortRelayUrl');
    expect(mainTsx).not.toContain('preferSnapshotRelayUrl');
    expect(mainTsx).not.toContain('getDesktopWindowBridge');
    expect(mainTsx).not.toContain('window.open(openUrl, \'_blank\', \'noopener,noreferrer\')');

    expect(detailTsx).toContain('className="port-relay-panel port-relay-panel-shell"');
    expect(detailTsx).toContain('className="port-relay-form-grid"');
    expect(detailTsx).toContain('className="port-relay-code-row"');
    expect(detailTsx).toContain('className={`port-relay-status-pill ${statusClass}`}');
    expect(stylesCss).toContain('.port-relay-panel');
    expect(stylesCss).toContain('.port-relay-form-grid');
    expect(stylesCss).toContain('.port-relay-code-row');
    expect(stylesCss).toContain('.port-relay-status-pill');
  });

  test('embeds relay pages through desktop main pane, chat preview, and mobile floating overlay', () => {
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
    expect(mainTsx).toContain("} from './shell/layouts/mobile/floatingControls';");
    expect(mainTsx).toContain('resolveFloatingControlDragSide(');
    expect(mainTsx).toContain('floatingControlSideRef.current');
    expect(mainTsx).not.toContain("const nextSide = current.currentX < windowWidth / 2 ? 'left' : 'right';");
    expect(mainTsx).toContain("dispatchWorkspaceUi({ type: 'mobile/setFloatingControlSide', next });");
    expect(mainTsx).toContain('const [portRelayFrameOpen, setPortRelayFrameOpen] = useState(false);');
    expect(mainTsx).toContain("type PortRelayFramePlacement = 'main' | 'chatPreview';");
    expect(mainTsx).toContain("const [portRelayFramePlacement, setPortRelayFramePlacement] = useState<PortRelayFramePlacement>('main');");
    expect(mainTsx).toContain('const [portRelayFrameAutoOpenPending, setPortRelayFrameAutoOpenPending] = useState(false);');
    expect(mainTsx).toContain("portRelaySnapshot.enabled && portRelaySnapshot.status === 'Up'");
    expect(mainTsx).toContain('setPortRelayFrameOpen(false);');
    expect(mainTsx).toContain('setPortRelayFrameAutoOpenPending(false);');
    expect(mainTsx).toContain('const handleDesktopPortRelaySelect = useCallback(() => {');
    expect(mainTsx).toContain('setPortRelayFrameOpen(open => !open);');
    expect(mainTsx).toContain('onClick={handleDesktopPortRelaySelect}');
    expect(mainTsx).toContain("import { PortRelayFloatingButton, PortRelayFrameSurface } from './portRelay/PortRelayFrameSurface';");
    expect(mainTsx).toContain('<PortRelayFrameSurface');
    expect(mainTsx).toContain('mode="desktop"');
    expect(mainTsx).toContain('mode="mobile"');
    expect(mainTsx).toContain('chrome={true}');
    expect(mainTsx).toContain('url={portRelayFrameUrl}');
    expect(mainTsx).toContain('<PortRelayFloatingButton');
    expect(surfaceTsx).toContain('className={`port-relay-frame-surface ${mode}`}');
    expect(surfaceTsx).toContain('className="chat-preview-title"');
    expect(surfaceTsx).toContain('aria-label="Open relay page in browser"');
    expect(surfaceTsx).toContain('<iframe');
    expect(surfaceTsx).toContain('src={url}');
    expect(surfaceTsx).toContain('className="port-relay-frame"');
    expect(surfaceTsx).toContain('className="drawer-toggle-bubble port-relay-floating-bubble"');
    expect(surfaceTsx).toContain("title={frameOpen ? 'Close relay page' : 'Open relay page'}");

    const renderMainStart = mainTsx.indexOf('const renderMain = () => {');
    const chatBranchStart = mainTsx.indexOf("if (tab === 'chat')", renderMainStart);
    const renderMainPrologue = mainTsx.slice(renderMainStart, chatBranchStart);
    expect(renderMainPrologue).toContain('isWide && portRelayFrameOpen && portRelayFramePlacement === \'main\' && portRelayFrameUrl');
    expect(renderMainPrologue).toContain('<PortRelayFrameSurface');

    expect(stylesCss).toContain('.port-relay-frame-surface');
    expect(stylesCss).toContain('.port-relay-frame-surface.mobile');
    expect(stylesCss).toContain('.port-relay-frame');
    expect(stylesCss).toContain('.port-relay-floating-bubble');
    expect(stylesCss).toContain(".floating-control-stack[data-side='left']");
    expect(stylesCss).toContain(".floating-control-stack[data-side='right']");
    expect(stylesCss).toContain(".floating-control-stack[data-side='left'] .port-relay-target-switch-menu");
  });

  test('auto-opens the desktop relay frame after enable and polls opening status silently', () => {
    expect(mainTsx).toContain('setPortRelayFrameAutoOpenPending((options.openFrame ?? isWide) && snapshot.enabled);');
    expect(mainTsx).toContain("if (!portRelayFrameAutoOpenPending) {");
    expect(mainTsx).toContain('setPortRelayFrameOpen(true);');
    expect(mainTsx).toContain("portRelaySnapshot.status !== 'Opening'");
    expect(mainTsx).toContain('refreshPortRelayStatus({silent: true}).catch(() => undefined);');
    expect(mainTsx).toContain("const refreshPortRelayStatus = useCallback(async (options?: {silent?: boolean}) => {");
  });

  test('places desktop Port Relay shortcut with settings peers after Skills', () => {
    const activityBarStart = mainTsx.indexOf('const desktopActivityBar = isWide ? (');
    const activityBarEnd = mainTsx.indexOf('const floatingControlStack = !isWide ? (', activityBarStart);
    const activityBar = mainTsx.slice(activityBarStart, activityBarEnd);
    const primaryStart = activityBar.indexOf('className="desktop-activity-primary"');
    const secondaryStart = activityBar.indexOf('className="desktop-activity-secondary"');
    const primary = activityBar.slice(primaryStart, secondaryStart);
    const secondary = activityBar.slice(secondaryStart);

    expect(primary).not.toContain('title="Port Relay"');
    expect(secondary.indexOf('title="Skills"')).toBeLessThan(secondary.indexOf('title="Port Relay"'));
    expect(secondary.indexOf('title="Port Relay"')).toBeLessThan(secondary.indexOf('title="Token Stats"'));
    expect(secondary).toContain('onClick={handleDesktopPortRelaySelect}');
  });

  test('turns chat localhost links into relay iframe actions for the current project hub', () => {
    expect(mainTsx).toContain("import { appendPortRelayAutoAuthCode, appendPortRelayOpenPath, parsePortRelayLocalHttpUrl, resolvePortRelayOpenUrl } from './portRelay/portRelayUrl';");
    expect(mainTsx).toContain('const [portRelayFramePath, setPortRelayFramePath] = useState(\'\');');
    expect(mainTsx).toContain('appendPortRelayOpenPath(baseUrl, portRelayFramePath)');
    expect(mainTsx).toContain('const openChatPortRelayLink = useCallback(async (localUrl: PortRelayLocalHttpUrl) => {');
    expect(mainTsx).toContain("setPortRelayFramePlacement('chatPreview');");
    expect(mainTsx).toContain('setChatFilePeek(null);');
    expect(mainTsx).toContain('const hubId = currentProject?.hubId || \'\';');
    expect(mainTsx).toContain('targetPort: localUrl.targetPort');
    expect(mainTsx).toContain('framePath: localUrl.path');
    expect(mainTsx).toContain('openFrame: true');
    expect(mainTsx).toContain('const relayLocalUrl = parsePortRelayLocalHttpUrl(linkHref);');
    expect(mainTsx).toContain('openChatPortRelayLink(relayLocalUrl).catch(() => undefined);');
    expect(mainTsx).toContain('className={[rest.className, relayLocalUrl ? \'chat-relay-link\' : \'\'].filter(Boolean).join(\' \') || undefined}');
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

  test('hides mobile navigation and drawer while the relay iframe is open', () => {
    expect(mainTsx).toContain("const mobilePortRelayFrameOpen = !isWide && portRelayFrameOpen && portRelayFramePlacement === 'main' && !!portRelayFrameUrl;");
    expect(mainTsx).toContain('if (!mobilePortRelayFrameOpen) {');
    expect(mainTsx).toContain('setDrawerOpen(false);');
    expect(mainTsx).toContain('setSidebarSettingsOpen(false);');
    expect(mainTsx).toContain('}, [mobilePortRelayFrameOpen, setDrawerOpen, setSidebarSettingsOpen]);');
    expect(mainTsx).toContain('{mobilePortRelayFrameOpen ? null : gestureNavigation ? (');
    expect(mainTsx).toContain('drawerOpen={mobilePortRelayFrameOpen ? false : drawerOpen}');
    expect(mainTsx).toContain('const portRelayMobileFrameOverlay = mobilePortRelayFrameOpen');
  });

  test('adds a mobile long-press target switch menu for the relay floating button', () => {
    expect(mainTsx).toContain('orderPortRelayTargetsForMenu(');
    expect(mainTsx).toContain('const [portRelayTargetMenuOpen, setPortRelayTargetMenuOpen] = useState(false);');
    expect(mainTsx).toContain('const portRelayTargetMenuTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);');
    expect(mainTsx).toContain('const handlePortRelayFloatingPointerDown = useCallback(');
    expect(mainTsx).toContain('if (!mobilePortRelayFrameOpen) {');
    expect(mainTsx).toContain('setPortRelayTargetMenuOpen(true);');
    expect(mainTsx).toContain('const handleMobilePortRelayTargetMenuSelect = useCallback(async (target: PortRelayTarget) => {');
    expect(mainTsx).toContain('if (samePortRelayTarget(activePortRelayTarget, target)) {');
    expect(mainTsx).toContain("setPortRelayError('Access code is unknown on this device. Generate a new code before switching target.');");
    expect(mainTsx).toContain("openSettingsDetail('portRelay');");
    expect(mainTsx).toContain("await enablePortRelayForTarget(target, String(portRelaySnapshot.listenPort || portRelayListenPort), {framePath: '', openFrame: true, framePlacement: 'main'});");
    expect(mainTsx).toContain('const handlePortRelayFloatingTargetSelect = useCallback((target: PortRelayTarget) => {');
    expect(mainTsx).toContain('<PortRelayFloatingButton');
    expect(mainTsx).toContain('targetMenuOpen={portRelayTargetMenuOpen}');
    expect(mainTsx).toContain('targetMenuRef={portRelayTargetMenuRef}');
    expect(mainTsx).toContain('targets={portRelayTargetMenuTargets}');
    expect(mainTsx).toContain('activeTarget={activePortRelayTarget}');
    expect(mainTsx).toContain('switchingTarget={portRelayMenuSwitchingTarget}');
    expect(mainTsx).toContain('onPointerDown={handlePortRelayFloatingPointerDown}');
    expect(surfaceTsx).toContain('const targetMenu = targetMenuOpen && mobileFrameOpen');
    expect(surfaceTsx).toContain('className="port-relay-target-switch-menu"');
    expect(surfaceTsx).toContain('className="port-relay-target-switch-item"');
    expect(surfaceTsx).toContain('`${target.hubId}:${target.targetPort}`');

    expect(stylesCss).toContain('.port-relay-target-switch-menu');
    expect(stylesCss).toContain('.port-relay-target-switch-item');
  });

  test('keeps relay settings focused on hub local port mapping', () => {
    expect(mainTsx).toContain("const [portRelayTargets, setPortRelayTargets] = useState<PortRelayTarget[]>(");
    expect(mainTsx).toContain("const [selectedPortRelayTarget, setSelectedPortRelayTarget] = useState<PortRelayTarget | null>(");
    expect(mainTsx).toContain("const [portRelayDraftPort, setPortRelayDraftPort] = useState('80');");
    expect(mainTsx).not.toContain('const [portRelayTargetHost, setPortRelayTargetHost]');
    expect(mainTsx).not.toContain('setPortRelayTargetHost(snapshot.targetHost)');
    expect(mainTsx).toContain("targetHost: '127.0.0.1',");
    expect(detailTsx).toContain("const portRelayTargetDisplay = selectedTarget ? `${selectedTarget.hubId} -> 127.0.0.1:${selectedTarget.targetPort}` : 'No target';");
    expect(detailTsx).toContain('className="port-relay-target-inline"');
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

    expect(stylesCss).toContain('.port-relay-section');
    expect(stylesCss).toContain('.port-relay-target-inline');
    expect(stylesCss).toContain('.port-relay-target-list-row');
    expect(stylesCss).toContain('.port-relay-target-delete');
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

    expect(stylesCss).toContain('.port-relay-panel-shell');
    expect(stylesCss).toContain('.port-relay-control-section');
    expect(stylesCss).toContain('.port-relay-section-title');
    expect(stylesCss).toContain('.port-relay-copy-btn');
    expect(stylesCss).toContain('.port-relay-status-section::before');
  });

  test('keeps the relay status area to one line without widening the settings panel', () => {
    const statusStart = detailTsx.indexOf('className="port-relay-section port-relay-status-section"');
    const statusEnd = detailTsx.indexOf('{portRelayError || portRelaySnapshot.error ?', statusStart);
    const statusMarkup = detailTsx.slice(statusStart, statusEnd);

    expect(statusMarkup).toContain('className="port-relay-header"');
    expect(statusMarkup).toContain('className="port-relay-target-inline"');
    expect(statusMarkup).not.toContain('className="port-relay-target-row"');
    expect(statusMarkup).not.toContain('className="port-relay-url"');

    const statusCssStart = stylesCss.indexOf('.port-relay-status-section');
    const statusCssEnd = stylesCss.indexOf('.port-relay-form-grid', statusCssStart);
    const statusCss = stylesCss.slice(statusCssStart, statusCssEnd);

    expect(statusCss).toContain('min-width: 0;');
    expect(statusCss).toContain('overflow: hidden;');
    expect(statusCss).toContain('.port-relay-target-inline');
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
    expect(detailTsx).toContain("portRelayAccessCodeUnknown ? 'Reset Code' : 'Generate'");
    expect(mainTsx).toContain("setPortRelayError('Access code is unknown on this device. Generate a new code before copying.');");
    expect(mainTsx).toContain('setPortRelayKnownAccessCodeGeneration(typeof snapshot.accessCodeGeneration === \'number\' ? snapshot.accessCodeGeneration : null);');
  });
});
