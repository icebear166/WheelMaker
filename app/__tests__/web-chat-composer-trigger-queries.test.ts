import {
  resolveChatFileMentionQuery,
  resolveChatSlashQuery,
} from '../web/src/chat/composer/chatComposerTriggerQueries';

describe('chat composer trigger queries', () => {
  test('resolves slash queries at text start or after whitespace', () => {
    expect(resolveChatSlashQuery('/', 1)).toEqual({start: 0, end: 1, query: ''});
    expect(resolveChatSlashQuery('hello /g', 8)).toEqual({start: 6, end: 8, query: 'g'});
    expect(resolveChatSlashQuery('hello\n/gr', 9)).toEqual({start: 6, end: 9, query: 'gr'});
  });

  test('rejects slash queries without a whitespace boundary', () => {
    expect(resolveChatSlashQuery('path/to', 7)).toBeNull();
    expect(resolveChatSlashQuery('hello(/grill-me', 15)).toBeNull();
    expect(resolveChatSlashQuery('hello,/grill-me', 15)).toBeNull();
  });

  test('resolves file mention queries at text start or after whitespace', () => {
    expect(resolveChatFileMentionQuery('@', 1)).toEqual({start: 0, end: 1, query: ''});
    expect(resolveChatFileMentionQuery('open @app', 9)).toEqual({start: 5, end: 9, query: 'app'});
    expect(resolveChatFileMentionQuery('open\t@src', 9)).toEqual({start: 5, end: 9, query: 'src'});
  });

  test('rejects file mention queries without a whitespace boundary', () => {
    expect(resolveChatFileMentionQuery('email@example.com', 17)).toBeNull();
    expect(resolveChatFileMentionQuery('scope/@file', 11)).toBeNull();
  });
});
