import fs from 'fs';
import path from 'path';

describe('request permission workspace wiring', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'),
    'utf8',
  );

  test('requires a corrected session read before showing the current request', () => {
    expect(source).toContain('permissionReadGateRef.current.isReady(selectedChatEncodedKey)');
    expect(source).toContain('const permissionReadEpoch = markPermissionReadPending(runtimeKey);');
    expect(source).toContain('markPermissionReadReady(resultRuntimeKey, permissionReadEpoch);');
    expect(source).toContain('permissionReadGateRef.current.disconnect();');
  });

  test('submits through the project-scoped API, then repairs turns without optimistic close', () => {
    expect(source).toContain('service.respondProjectSessionPermission(');
    expect(source).toContain('await refreshSessionTurns(selectedKey.sessionId, selectedKey.projectId, runtimeKey);');
    expect(source).toContain('permissionSubmission.optionId');
    expect(source).toContain('<ChatPermissionDialog');
  });

  test('prioritizes the permission marker and blocks composer submission only for the active session', () => {
    expect(source).toContain('if (pendingPermissionCount > 0)');
    expect(source).toContain('session-state-leading permission-pending');
    expect(source).toContain('chatAttachmentUploadPending || !!selectedActivePermission');
    expect(source).toContain('if (selectedActivePermission)');
  });
});
