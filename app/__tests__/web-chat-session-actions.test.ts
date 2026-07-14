import {
  buildChatSessionActionOptions,
  filterChatSessionActionOptions,
  removeActiveSlashQuery,
  resolveStandaloneSessionAction,
} from '../web/src/chat/session/chatSessionActions';

describe('chat session action options', () => {
  const capabilities = {
    status: {supported: true},
    compact: {supported: false, reason: 'Compact is unavailable.'},
  };

  test('puts fixed commands before sorted skills and distinguishes their behavior', () => {
    const options = buildChatSessionActionOptions(['zoom-out', 'debug'], capabilities);

    expect(options.map(option => [option.name, option.kind, option.behavior])).toEqual([
      ['/compact', 'command', 'invoke'],
      ['/status', 'command', 'invoke'],
      ['/debug', 'skill', 'insert'],
      ['/zoom-out', 'skill', 'insert'],
    ]);
    expect(options[0]).toMatchObject({enabled: false, disabledReason: 'Compact is unavailable.', icon: 'codicon-circle-large-outline'});
    expect(options[1]).toMatchObject({enabled: true, icon: 'codicon-dashboard'});
    expect(options[2].icon).not.toBe(options[1].icon);
  });

  test('filters one unified list by name and description', () => {
    const options = buildChatSessionActionOptions(['debug'], capabilities);
    expect(filterChatSessionActionOptions(options, 'compact this').map(option => option.name)).toEqual(['/compact']);
    expect(filterChatSessionActionOptions(options, 'debug').map(option => option.name)).toEqual(['/debug']);
  });

  test('intercepts only standalone native commands and rejects args or attachments', () => {
    expect(resolveStandaloneSessionAction('/compact', 0)).toEqual({kind: 'compact'});
    expect(resolveStandaloneSessionAction('  /STATUS  ', 0)).toEqual({kind: 'status'});
    expect(resolveStandaloneSessionAction('/compact now', 0)).toEqual({kind: 'invalid', command: '/compact'});
    expect(resolveStandaloneSessionAction('/status', 1)).toEqual({kind: 'invalid', command: '/status'});
    expect(resolveStandaloneSessionAction('/debug', 0)).toBeNull();
  });

  test('removes only the active slash query for invoked commands', () => {
    expect(removeActiveSlashQuery('keep /sta tail', 9)).toEqual({text: 'keep  tail', cursor: 5});
  });
});
