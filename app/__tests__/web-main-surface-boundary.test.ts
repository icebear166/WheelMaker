import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'web/src/main.tsx'), 'utf8');

describe('main surface boundaries', () => {
  test('main delegates non-chat surfaces while keeping chat startup resident', () => {
    expect(main).toContain('AppConfirmDialog');
    expect(main).toContain("} from './shell/AppDialogs';");
    expect(main).toContain("import { FileExplorerTree, WorkspaceProjectSelector } from './file/FileExplorerTree';");
    expect(main).toContain("import { GitSidebar } from './git/GitSidebar';");
    expect(main).toContain("import { PortRelayFloatingButton, PortRelayFrameSurface } from './portRelay/PortRelayFrameSurface';");

    expect(main).not.toContain('const renderFileTree = (');
    expect(main).not.toContain('const renderWorkspaceProjectSelector = () =>');
    expect(main).not.toContain('className="section-title git-section-title"');
    expect(main).not.toContain('className="git-commit-popover"');
    expect(main).not.toContain('const renderPortRelayFrameSurface =');
    expect(main).not.toContain('className="port-relay-frame"');

    expect(main).toContain("if (tab === 'chat') {");
    expect(main).toContain('<ChatVirtuosoTurnList');
    expect(main).toContain("import ReactMarkdown, { type Components } from 'react-markdown';");
    expect(main).not.toContain('loadChatBundle');
    expect(main).not.toContain("React.lazy(() => import('./chat");
  });
});
