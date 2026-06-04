import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
describe('web git graph popover layout', () => {
  test('uses centered/stretched graph axis and responsive desktop/mobile popover policy', () => {
    const projectRoot = path.join(__dirname, '..');
    const gitSidebarTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'git', 'GitSidebar.tsx'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(gitSidebarTsx).toContain('if (isWide) {');
    expect(gitSidebarTsx).toContain('Math.max(320, Math.round(window.innerWidth * 0.42))');
    expect(gitSidebarTsx).toContain('Math.round(window.innerWidth * 0.92)');
    expect(gitSidebarTsx).toContain(").closest('.list');");
    expect(gitSidebarTsx).toContain('const panelMidY = panelRect');
    expect(gitSidebarTsx).toContain('const topZoneY = panelRect');
    expect(gitSidebarTsx).toContain('const bottomZoneY = panelRect');
    expect(gitSidebarTsx).toContain('y = preferBelow ? bottomZoneY : topZoneY;');

    expect(stylesCss).toMatch(/\.git-worktree-row\s*\{\s*margin-top:\s*0;/);
    expect(stylesCss).toMatch(/\.git-commit-row\s*\{\s*margin-top:\s*0;/);
    expect(stylesCss).toContain('border-left-color: transparent;');
    expect(stylesCss).toContain('padding-left: 10px;');
    expect(stylesCss).toContain('align-self: stretch;');
    expect(stylesCss).toContain('--git-graph-axis: 6px;');
    expect(stylesCss).toContain('left: var(--git-graph-axis);');
    expect(stylesCss).toContain('transform: translate(-50%, -50%);');
    expect(stylesCss).toMatch(/\.git-graph-line\s*\{[^}]*top:\s*-1px;[^}]*bottom:\s*-1px;[^}]*left:\s*var\(--git-graph-axis\);/);
  });
});

