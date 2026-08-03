import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'web/src/main.tsx'), 'utf8');
const workspaceApp = fs.readFileSync(path.join(root, 'web/src/app/WorkspaceApp.tsx'), 'utf8');

describe('main surface boundaries', () => {
  test('main only owns the bootstrap render boundary', () => {
    expect(main).toContain("import { App, workspaceAppReady } from './app/WorkspaceApp';");
    expect(main).toContain("import { requestPersistentBrowserStorageOnStartup } from './platform/storagePersistence';");
    expect(main).toContain('requestPersistentBrowserStorageOnStartup();');
    expect(main).toContain('workspaceAppReady.then(() => {');
    expect(main).toContain("createRoot(document.getElementById('root')!).render(<><App /><GlobalTooltip /></>);");
    expect(main).not.toContain('AppConfirmDialog');
    expect(main).not.toContain('<ChatVirtuosoTurnList');
  });

  test('workspace app keeps chat resident and Preview file support isolated', () => {
    expect(workspaceApp).toContain('AppConfirmDialog');
    expect(workspaceApp).toContain("} from '../shell/AppDialogs';");
    expect(workspaceApp).toContain("import { FileExplorerTree } from '../file/FileExplorerTree';");
    expect(workspaceApp).not.toContain("../git/GitSidebar");
    expect(workspaceApp).toContain("from '../git/GitHistoryPanel';");
    expect(workspaceApp).toContain("from '../git/GitStatusSurface';");
    expect(workspaceApp).toContain("import { PortRelayFrameSurface } from '../portRelay/PortRelayFrameSurface';");

    expect(workspaceApp).not.toContain('const renderFileTree = (');
    expect(workspaceApp).not.toContain('const renderWorkspaceProjectSelector = () =>');
    expect(workspaceApp).not.toContain('className="section-title git-section-title"');
    expect(workspaceApp).not.toContain('className="git-commit-popover"');
    expect(workspaceApp).not.toContain('const renderPortRelayFrameSurface =');
    expect(workspaceApp).not.toContain('const portRelayMobileFrameOverlay = mobilePortRelayFrameOpen');
    expect(workspaceApp).not.toContain("portRelayFramePlacement === 'main'");
    expect(workspaceApp).not.toContain("portRelayFramePlacement === 'chatPreview'");
    expect(workspaceApp).not.toContain('className="port-relay-frame"');

    expect(workspaceApp).toContain('<ChatVirtuosoTurnList');
    expect(workspaceApp).toContain('<FileExplorerTree');
    expect(workspaceApp).toContain("import ReactMarkdown, { type Components } from 'react-markdown';");
    expect(workspaceApp).not.toContain('loadChatBundle');
    expect(workspaceApp).not.toContain("React.lazy(() => import('../chat");
  });

  test('derives registry startup endpoints only from the current page base URL', () => {
    expect(workspaceApp).toContain("import {deriveRegistryEndpoints} from '../registry/registryBaseUrl';");
    expect(workspaceApp).toContain('deriveRegistryEndpoints(document.baseURI');
    expect(workspaceApp).not.toContain('resolveInitialRegistryAddress');
    expect(fs.existsSync(path.join(root, 'web/src/app/workspaceBootstrap.ts'))).toBe(false);
  });
});
