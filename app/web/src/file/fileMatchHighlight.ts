export type FileMatchHighlightSegment = {
  text: string;
  match: boolean;
};

// The file index search is fuzzy, so highlight a contiguous case-insensitive
// substring hit first and fall back to greedy subsequence matching (VS Code
// quick-open style). Returns the whole text unmatched when the query is not a
// subsequence of it.
export function splitFileMatchHighlight(text: string, query: string): FileMatchHighlightSegment[] {
  if (!text) {
    return [];
  }
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [{text, match: false}];
  }
  const lowerText = text.toLowerCase();
  const substringIndex = lowerText.indexOf(normalizedQuery);
  if (substringIndex >= 0) {
    const segments: FileMatchHighlightSegment[] = [];
    if (substringIndex > 0) {
      segments.push({text: text.slice(0, substringIndex), match: false});
    }
    segments.push({
      text: text.slice(substringIndex, substringIndex + normalizedQuery.length),
      match: true,
    });
    if (substringIndex + normalizedQuery.length < text.length) {
      segments.push({text: text.slice(substringIndex + normalizedQuery.length), match: false});
    }
    return segments;
  }
  const matchFlags: boolean[] = [];
  let queryIndex = 0;
  for (let index = 0; index < text.length; index += 1) {
    const isMatch =
      queryIndex < normalizedQuery.length && lowerText[index] === normalizedQuery[queryIndex];
    if (isMatch) {
      queryIndex += 1;
    }
    matchFlags.push(isMatch);
  }
  if (queryIndex < normalizedQuery.length) {
    return [{text, match: false}];
  }
  const segments: FileMatchHighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = cursor + 1;
    while (end < text.length && matchFlags[end] === matchFlags[cursor]) {
      end += 1;
    }
    segments.push({text: text.slice(cursor, end), match: matchFlags[cursor]});
    cursor = end;
  }
  return segments;
}
