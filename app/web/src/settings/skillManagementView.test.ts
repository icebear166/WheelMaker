import {
  readSkillSourceExpanded,
  skillSourceExpandedPreferenceKey,
  writeSkillSourceExpanded,
} from './skillManagementView';

const hubSource = {
  hubId: 'hub-a',
  scope: 'hub' as const,
  sourceKey: 'github.com/acme/skills',
};

const projectSource = {
  hubId: 'hub-a',
  scope: 'project' as const,
  projectName: 'project-a',
  sourceKey: 'github.com/acme/skills',
};

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    valueFor: (key: string) => values.get(key),
  };
}

test('uses an identity-safe preference key for each Source scope', () => {
  expect(skillSourceExpandedPreferenceKey(hubSource))
    .not.toBe(skillSourceExpandedPreferenceKey(projectSource));
  expect(skillSourceExpandedPreferenceKey(hubSource))
    .toContain(encodeURIComponent(hubSource.sourceKey));
});

test('defaults a Source to expanded and stores explicit collapsed state', () => {
  const storage = memoryStorage();
  expect(readSkillSourceExpanded(hubSource, storage)).toBe(true);

  writeSkillSourceExpanded(hubSource, false, storage);
  expect(readSkillSourceExpanded(hubSource, storage)).toBe(false);

  writeSkillSourceExpanded(hubSource, true, storage);
  expect(readSkillSourceExpanded(hubSource, storage)).toBe(true);
  expect(storage.valueFor('wheelmaker.skills.sourceExpanded.v1')).toBe('{}');
});

test('falls back to expanded when session preference storage is corrupt or unavailable', () => {
  const corrupt = memoryStorage({
    'wheelmaker.skills.sourceExpanded.v1': '{not-json',
  });
  expect(readSkillSourceExpanded(hubSource, corrupt)).toBe(true);

  const throwingStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };
  expect(readSkillSourceExpanded(hubSource, throwingStorage)).toBe(true);
  expect(() => writeSkillSourceExpanded(hubSource, false, throwingStorage)).not.toThrow();
});

test('uses sessionStorage by default instead of persistent localStorage', () => {
  const key = skillSourceExpandedPreferenceKey(hubSource);
  const local = memoryStorage({
    'wheelmaker.skills.sourceExpanded.v1': JSON.stringify({[key]: false}),
  });
  const session = memoryStorage();
  const localDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const sessionDescriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
  Object.defineProperty(window, 'localStorage', {configurable: true, value: local});
  Object.defineProperty(window, 'sessionStorage', {configurable: true, value: session});
  try {
    expect(readSkillSourceExpanded(hubSource)).toBe(true);
    writeSkillSourceExpanded(hubSource, false);
    expect(session.valueFor('wheelmaker.skills.sourceExpanded.v1'))
      .toBe(JSON.stringify({[key]: false}));
    expect(local.valueFor('wheelmaker.skills.sourceExpanded.v1'))
      .toBe(JSON.stringify({[key]: false}));
  } finally {
    if (localDescriptor) Object.defineProperty(window, 'localStorage', localDescriptor);
    if (sessionDescriptor) Object.defineProperty(window, 'sessionStorage', sessionDescriptor);
  }
});
