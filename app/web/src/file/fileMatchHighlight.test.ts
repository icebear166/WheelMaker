import {splitFileMatchHighlight} from './fileMatchHighlight';

describe('splitFileMatchHighlight', () => {
  it('returns no segments for empty text', () => {
    expect(splitFileMatchHighlight('', 'app')).toEqual([]);
  });

  it('returns the whole text unmatched for a blank query', () => {
    expect(splitFileMatchHighlight('app.ts', '   ')).toEqual([{text: 'app.ts', match: false}]);
  });

  it('highlights a contiguous case-insensitive substring hit', () => {
    expect(splitFileMatchHighlight('WorkspaceApp.tsx', 'app')).toEqual([
      {text: 'Workspace', match: false},
      {text: 'App', match: true},
      {text: '.tsx', match: false},
    ]);
  });

  it('trims the query before matching', () => {
    expect(splitFileMatchHighlight('app.ts', ' app ')).toEqual([
      {text: 'app', match: true},
      {text: '.ts', match: false},
    ]);
  });

  it('falls back to greedy subsequence matching', () => {
    expect(splitFileMatchHighlight('fileMatchHighlight.ts', 'fmh')).toEqual([
      {text: 'f', match: true},
      {text: 'ile', match: false},
      {text: 'M', match: true},
      {text: 'atc', match: false},
      {text: 'h', match: true},
      {text: 'Highlight.ts', match: false},
    ]);
  });

  it('marks subsequence characters case-insensitively', () => {
    const segments = splitFileMatchHighlight('fileMatchHighlight.ts', 'FMH');
    expect(segments.filter(segment => segment.match).map(segment => segment.text)).toEqual([
      'f',
      'M',
      'h',
    ]);
  });

  it('returns the whole text unmatched when the query is not a subsequence', () => {
    expect(splitFileMatchHighlight('app.ts', 'zzq')).toEqual([{text: 'app.ts', match: false}]);
  });
});
