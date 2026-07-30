import {createSkillRetryNotice} from './skillRetryNotice';

test('keeps background skill scan failures inline', () => {
  expect(createSkillRetryNotice('Node.js 22+ is required')).toBeNull();
});

test('creates a retry notice for a user-triggered skill action', () => {
  const target = {kind: 'skillUpdate', hubId: 'local-hub'} as const;

  expect(createSkillRetryNotice('Node.js 22+ is required', target)).toEqual({
    message: 'Node.js 22+ is required',
    retry: {kind: 'action', target},
  });
});
