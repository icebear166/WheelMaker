import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
function readMain(): string {
  const projectRoot = path.join(__dirname, '..');
  return fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
}

function readStyles(): string {
  const projectRoot = path.join(__dirname, '..');
  return readWebStyles(projectRoot);
}

function readWebSource(relativePath: string): string {
  const projectRoot = path.join(__dirname, '..');
  return fs.readFileSync(path.join(projectRoot, 'web', 'src', relativePath), 'utf8');
}

function extractFunctionBody(source: string, functionName: string): string {
  const marker = `const ${functionName} = async`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const arrowStart = source.indexOf(') => {', start);
  expect(arrowStart).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf('{', arrowStart);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart, index + 1);
    }
  }
  throw new Error(`Unable to extract ${functionName}`);
}

describe('workspace project lightweight UI wiring', () => {
  test('user project switching uses lightweight sync instead of switchProject', () => {
    const main = readMain();
    const syncBody = extractFunctionBody(main, 'syncWorkspaceProject');
    const projectMenuBlock = main.slice(
      main.indexOf('const projectMenu ='),
      main.indexOf('const refreshButtonContent'),
    );

    expect(syncBody).toContain('workspaceController.switchProjectLightweight');
    expect(syncBody).toContain('workspaceStore.rememberGlobalState({');
    expect(syncBody).toContain('selectedProjectId: nextProjectId');
    expect(projectMenuBlock).toContain('syncWorkspaceProject(projectItem.projectId');
    expect(projectMenuBlock).not.toContain('switchProject(projectItem.projectId)');
  });

  test('chat session selection syncs workspace project without a full workspace load', () => {
    const main = readMain();
    const body = extractFunctionBody(main, 'selectProjectChatSession');
    const syncBody = extractFunctionBody(main, 'syncWorkspaceProject');

    expect(body).toContain('syncWorkspaceProject(targetProjectId');
    expect(body).toContain("reason: 'chat'");
    expect(body).not.toContain('switchProject(');
    expect(syncBody).toContain('workspaceController.switchProjectLightweight');
  });
});
