import fs from 'fs';
import path from 'path';

describe('request permission workspace wiring', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'src', 'app', 'WorkspaceApp.tsx'),
    'utf8',
  );
  const dialogSource = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'src', 'chat', 'permission', 'ChatPermissionDialog.tsx'),
    'utf8',
  );
  const styles = fs.readFileSync(
    path.join(__dirname, '..', 'web', 'src', 'styles', 'chat.css'),
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

  test('anchors a non-modal permission card above the composer without blocking the chat', () => {
    const composerContentIndex = source.indexOf('className="chat-composer-content"');
    const composerFrameIndex = source.indexOf('className={`chat-composer-frame');
    const dialogIndex = source.lastIndexOf('<ChatPermissionDialog');
    expect(composerContentIndex).toBeGreaterThan(0);
    expect(dialogIndex).toBeGreaterThan(composerContentIndex);
    expect(dialogIndex).toBeLessThan(composerFrameIndex);
    expect(dialogSource).not.toContain('chat-permission-overlay');
    expect(dialogSource).not.toContain('.focus()');
    expect(styles).not.toContain('.chat-permission-overlay');
    expect(styles).toMatch(/\.chat-permission-dialog\s*\{[^}]*position:\s*absolute;/s);
    expect(styles).not.toMatch(/\.chat-permission-dialog\s*\{[^}]*backdrop-filter:/s);
  });
});
