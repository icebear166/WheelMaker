import {diffSkillSourceCatalog} from './skillManagementView';

test('diffs source catalogs case-insensitively by path and content hash', () => {
  const changes = diffSkillSourceCatalog(
    [
      {name: 'same', skillPath: 'skills/same/SKILL.md', contentSha256: 'a'},
      {name: 'changed', skillPath: 'skills/changed/SKILL.md', contentSha256: 'b'},
      {name: 'moved', skillPath: 'skills/old/SKILL.md', contentSha256: 'c'},
      {name: 'removed', skillPath: 'skills/removed/SKILL.md', contentSha256: 'd'},
    ],
    [
      {name: 'Same', skillPath: 'skills/same/SKILL.md', contentSha256: 'a'},
      {name: 'changed', skillPath: 'skills/changed/SKILL.md', contentSha256: 'next'},
      {name: 'moved', skillPath: 'skills/new/SKILL.md', contentSha256: 'c'},
      {name: 'added', skillPath: 'skills/added/SKILL.md', contentSha256: 'e'},
    ],
  );

  expect(changes).toEqual({
    added: ['added'],
    removed: ['removed'],
    changed: ['changed', 'moved'],
  });
});
