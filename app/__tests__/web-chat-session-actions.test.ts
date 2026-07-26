import {
  buildChatSessionActionOptions,
  chatSlashOptionDisplayName,
  filterChatSessionActionOptions,
  groupChatSlashMenuOptions,
  replaceActiveSlashQuery,
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
    expect(options[0]).toMatchObject({enabled: false, disabledReason: 'Compact is unavailable.', icon: 'circle'});
    expect(options[1]).toMatchObject({enabled: true, icon: 'layoutDashboard'});
    expect(options[2].icon).toBe('wand');
  });

  test('adds fast below status when the session exposes the fast config option', () => {
    const buildWithConfig = buildChatSessionActionOptions as unknown as (
      skills: string[],
      actionCapabilities: typeof capabilities,
      configOptions: Array<{id: string; currentValue?: string}>,
    ) => ReturnType<typeof buildChatSessionActionOptions>;
    const options = buildWithConfig(['debug'], capabilities, [
      {id: 'fast_mode', currentValue: 'on'},
    ]);

    expect(options.map(option => option.name)).toEqual([
      '/compact',
      '/status',
      '/fast',
      '/debug',
    ]);
    expect(options[2]).toMatchObject({
      action: 'fast',
      enabled: true,
      checked: true,
      icon: 'zap',
    });
    expect(options[2].description).toContain('On');
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
    expect(resolveStandaloneSessionAction('/fast', 0)).toEqual({kind: 'fast'});
    expect(resolveStandaloneSessionAction('/fast on', 0)).toEqual({kind: 'invalid', command: '/fast'});
    expect(resolveStandaloneSessionAction('/debug', 0)).toBeNull();
    expect(resolveStandaloneSessionAction('/goal ship', 0)).toBeNull();
  });

  test('shows Goal only when supported and inserts plain command text', () => {
    const supported = buildChatSessionActionOptions([], {
      ...capabilities,
      goal: {supported: true},
    });
    expect(supported).toContainEqual(expect.objectContaining({
      name: '/goal',
      behavior: 'insert-command',
      insertText: '/goal ',
      enabled: true,
    }));

    expect(buildChatSessionActionOptions(['goal'], capabilities).map(option => option.name)).not.toContain('/goal');
    expect(replaceActiveSlashQuery('keep /go tail', 8, '/goal ')).toEqual({
      text: 'keep /goal  tail',
      cursor: 11,
    });
  });

  test('removes only the active slash query for invoked commands', () => {
    expect(removeActiveSlashQuery('keep /sta tail', 9)).toEqual({text: 'keep  tail', cursor: 5});
  });
});

describe('slash menu grouping and display names', () => {
  test('groups options into Commands and Skills sections preserving order', () => {
    const options = buildChatSessionActionOptions(['zoom-out', 'debug'], {
      status: {supported: true},
      compact: {supported: true},
    });
    const sections = groupChatSlashMenuOptions(options);
    expect(sections.map(section => section.id)).toEqual(['commands', 'skills']);
    expect(sections[0].title).toBe('Commands');
    expect(sections[0].options.map(option => option.name)).toEqual(['/compact', '/status']);
    expect(sections[1].title).toBe('Skills');
    expect(sections[1].options.map(option => option.name)).toEqual(['/debug', '/zoom-out']);
  });

  test('omits empty sections', () => {
    const sections = groupChatSlashMenuOptions([]);
    expect(sections).toEqual([]);
  });

  test('display name strips the leading slash for menu rows', () => {
    expect(chatSlashOptionDisplayName('/compact')).toBe('compact');
    expect(chatSlashOptionDisplayName('//deep-skill')).toBe('deep-skill');
  });
});
