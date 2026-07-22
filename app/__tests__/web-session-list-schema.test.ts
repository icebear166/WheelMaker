import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';
describe('web session list schema', () => {
  test('uses sessionId without legacy chatId compatibility', () => {
    const projectRoot = path.join(__dirname, '..');
    const repositoryTs = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'registry', 'RegistryRepository.ts'), 'utf8');
    const serviceTs = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'registry', 'RegistryWorkspaceService.ts'), 'utf8');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const registryTypes = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'registry', 'registryTypes.ts'), 'utf8');
    const stylesCss = readWebStyles(projectRoot);

    expect(repositoryTs).toContain('RegistryMethods.SessionList');
    expect(repositoryTs).toContain('RegistryMethods.SessionRead');
    expect(repositoryTs).toContain('RegistryMethods.SessionMarkRead');
    expect(repositoryTs).toContain("typeof input.sessionId === 'string'");
    expect(repositoryTs).toContain('input.running === true');
    expect(repositoryTs).toContain('typeof input.lastDoneTurnIndex ===');
    expect(repositoryTs).toContain('typeof input.lastDoneSuccess ===');
    expect(repositoryTs).toContain('typeof input.lastReadTurnIndex ===');
    expect(repositoryTs).toContain('pinned: input.pinned === true');
    expect(repositoryTs).toContain('RegistryMethods.SessionPin');
    expect(serviceTs).toContain('async markProjectSessionRead(');
    expect(serviceTs).toContain('async pinProjectSession(');
    expect(registryTypes).toContain('running?: boolean;');
    expect(registryTypes).toContain('lastDoneTurnIndex?: number;');
    expect(registryTypes).toContain('lastDoneSuccess?: boolean;');
    expect(registryTypes).toContain('lastReadTurnIndex?: number;');
    expect(registryTypes).toContain('pinned?: boolean;');
    expect(registryTypes).toContain('pendingPermissionCount?: number;');
    expect(repositoryTs).toContain('pendingPermissionCount: typeof input.pendingPermissionCount');
    expect(mainTsx).toContain('const renderSessionStateMarker = (session: RegistryChatSession, activeProjectId = projectIdRef.current) => {');
    expect(mainTsx).toContain('return resolveChatSessionVisualStateValue(session);');
    expect(mainTsx).not.toContain('resolveChatSessionVisualStateValue(session, {');
    expect(mainTsx).toContain('service.markProjectSessionRead(activeProjectId, sessionId, cursor)');
    expect(mainTsx).toContain('const mergedSession = mergeKnownChatSessionForProject(eventProjectId, payload.session);');
    expect(mainTsx).toContain('rememberChatSessionSummary(eventProjectId, mergedSession);');
    expect(mainTsx).toContain('workspaceStore.rememberChatSession(eventProjectId, mergedSession, {');
    expect(stylesCss).toContain('grid-template-columns: 9px minmax(0, 1fr) auto auto;');
    expect(stylesCss).toContain('.session-state-marker.running');
    expect(stylesCss).toContain('.session-state-marker.failed-unviewed .session-state-dot');
    expect(repositoryTs).not.toContain('input.chatId');
    expect(mainTsx).toContain("const baseTitle = 'WheelMaker';");
    expect(mainTsx).toContain('const currentProjectTitle = useMemo(');
    expect(mainTsx).toContain("document.title = projectTitle ? `${baseTitle} - ${projectTitle}` : baseTitle;");
    expect(mainTsx).toContain("}, [currentProjectTitle]);");
  });
});

