import {
  chatComposerHasSendableTokens,
  normalizeChatComposerTokens,
  serializeChatComposerTokens,
  tokenizeKnownChatSlashCommands,
  type ChatComposerToken,
} from '../web/src/chat/composer/chatComposerTokens';

describe('chat composer tokens', () => {
  test('serializes skill and file capsules into text plus resource links', () => {
    const tokens: ChatComposerToken[] = [
      {type: 'skill', id: 's1', command: '/grill-me', label: 'Grill Me'},
      {type: 'text', text: ' in '},
      {type: 'file', id: 'f1', path: 'app/web/src/chat/fix_drop.py', name: 'fix_drop.py', label: ''},
      {type: 'text', text: ' please'},
    ];

    expect(serializeChatComposerTokens(tokens)).toEqual({
      text: '/grill-me in @fix_drop.py please',
      blocks: [
        {type: 'text', text: '/grill-me in @fix_drop.py please'},
        {type: 'resource_link', uri: 'app/web/src/chat/fix_drop.py', name: 'fix_drop.py'},
      ],
    });
  });

  test('uses shortest unique suffixes for duplicate basenames', () => {
    const tokens: ChatComposerToken[] = [
      {type: 'file', id: 'a', path: 'app/web/src/chat/fix_drop.py', name: 'fix_drop.py', label: ''},
      {type: 'text', text: ' and '},
      {type: 'file', id: 'b', path: 'server/chat/fix_drop.py', name: 'fix_drop.py', label: ''},
    ];

    expect(serializeChatComposerTokens(tokens).text).toBe(
      '@web/src/chat/fix_drop.py and @server/chat/fix_drop.py',
    );
  });

  test('wraps whitespace file labels in angle brackets', () => {
    const tokens: ChatComposerToken[] = [
      {type: 'file', id: 'f1', path: 'docs/my file.ts', name: 'my file.ts', label: ''},
    ];

    expect(serializeChatComposerTokens(tokens).text).toBe('@<my file.ts>');
  });

  test('deduplicates resource links while preserving repeated text mentions', () => {
    const tokens: ChatComposerToken[] = [
      {type: 'file', id: 'f1', path: 'app/a.ts', name: 'a.ts', label: ''},
      {type: 'text', text: ' then '},
      {type: 'file', id: 'f2', path: 'app/a.ts', name: 'a.ts', label: ''},
    ];

    expect(serializeChatComposerTokens(tokens)).toEqual({
      text: '@a.ts then @a.ts',
      blocks: [
        {type: 'text', text: '@a.ts then @a.ts'},
        {type: 'resource_link', uri: 'app/a.ts', name: 'a.ts'},
      ],
    });
  });

  test('normalizes adjacent text and empty tokens', () => {
    expect(
      normalizeChatComposerTokens([
        {type: 'text', text: 'a'},
        {type: 'text', text: ''},
        {type: 'text', text: 'b'},
      ]),
    ).toEqual([{type: 'text', text: 'ab'}]);
  });

  test('tokenizes complete known slash commands without changing unknown text', () => {
    expect(
      tokenizeKnownChatSlashCommands('/grill-me in /unknown', [
        {command: '/grill-me', label: 'Grill Me'},
      ]),
    ).toEqual([
      {type: 'skill', id: expect.any(String), command: '/grill-me', label: 'Grill Me'},
      {type: 'text', text: ' in /unknown'},
    ]);
  });

  test('reports sendable content from non-empty text or capsules', () => {
    expect(chatComposerHasSendableTokens([{type: 'text', text: '  '}])).toBe(false);
    expect(chatComposerHasSendableTokens([{type: 'skill', id: 's1', command: '/x', label: 'X'}])).toBe(true);
    expect(chatComposerHasSendableTokens([{type: 'file', id: 'f1', path: 'a.ts', name: 'a.ts', label: ''}])).toBe(true);
  });
});
