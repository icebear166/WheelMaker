import {
  deleteChatComposerTokenById,
  insertChatComposerTokens,
  chatComposerCapsuleAfterPosition,
  chatComposerCapsuleBeforePosition,
} from '../web/src/chat/composer/chatComposerTokenEditing';
import type {ChatComposerToken} from '../web/src/chat/composer/chatComposerTokens';

describe('chat composer token editing', () => {
  test('replaces an active slash query and returns the token cursor after inserted tokens', () => {
    const inserted: ChatComposerToken[] = [
      {type: 'skill', id: 'skill:1', command: '/grill-me', label: 'Grill Me'},
      {type: 'text', text: ' '},
    ];

    expect(insertChatComposerTokens([{type: 'text', text: '/gri'}], 4, inserted)).toEqual({
      tokens: inserted,
      cursor: 2,
    });
  });

  test('inserts tokens at a plain cursor without replacing existing text', () => {
    const inserted: ChatComposerToken[] = [
      {type: 'file', id: 'file:1', path: 'app/fix_drop.py', name: 'fix_drop.py', label: ''},
      {type: 'text', text: ' '},
    ];

    expect(insertChatComposerTokens([{type: 'text', text: 'open now'}], 5, inserted)).toEqual({
      tokens: [
        {type: 'text', text: 'open '},
        {type: 'file', id: 'file:1', path: 'app/fix_drop.py', name: 'fix_drop.py', label: ''},
        {type: 'text', text: ' now'},
      ],
      cursor: 7,
    });
  });

  test('finds and removes capsule tokens by token cursor position', () => {
    const tokens: ChatComposerToken[] = [
      {type: 'text', text: 'a '},
      {type: 'file', id: 'file:1', path: 'app/a.ts', name: 'a.ts', label: 'a.ts'},
      {type: 'text', text: ' b'},
    ];

    expect(chatComposerCapsuleBeforePosition(tokens, 3)).toEqual(tokens[1]);
    expect(chatComposerCapsuleAfterPosition(tokens, 2)).toEqual(tokens[1]);
    expect(deleteChatComposerTokenById(tokens, 'file:1')).toEqual([{type: 'text', text: 'a  b'}]);
  });

  test('clamps insertion cursor to the token tape', () => {
    expect(insertChatComposerTokens([{type: 'text', text: 'abc'}], 99, [{type: 'text', text: '!'}])).toEqual({
      tokens: [{type: 'text', text: 'abc!'}],
      cursor: 4,
    });
  });
});
