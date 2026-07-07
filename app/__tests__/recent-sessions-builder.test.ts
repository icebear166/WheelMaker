import {buildRecentChatSessionRows} from '../web/src/chat/mobileChatQuickSwitch';

function makeSession(sessionId: string, updatedAt: string): any {
  return {sessionId, updatedAt, agentType: 'codex'};
}

function makeProject(projectId: string, name: string, hubId: string): any {
  return {projectId, name, hubId};
}

test('buildRecentChatSessionRows keeps distinct project names', () => {
  const projects = [
    makeProject('p-wheelmaker', 'WheelMaker', 'hub-a'),
    makeProject('p-jcgo', 'JCGO', 'hub-b'),
    makeProject('p-skills', 'skills', 'hub-c'),
  ];
  const sessionsByProjectId: Record<string, any[]> = {
    'p-wheelmaker': [
      makeSession('s1', '2026-07-07T23:44:00+08:00'),
      makeSession('s2', '2026-07-07T23:32:00+08:00'),
    ],
    'p-jcgo': [makeSession('s3', '2026-07-07T09:03:00+08:00')],
    'p-skills': [makeSession('s4', '2026-07-07T11:51:00+08:00')],
  };
  const rows = buildRecentChatSessionRows({projects, sessionsByProjectId, limit: 8});
  const names = rows.map(r => r.projectName);
  console.log('PROJECT NAMES:', JSON.stringify(names));
  expect(names).toContain('WheelMaker');
  expect(names).toContain('JCGO');
  expect(names).toContain('skills');
  // No single name repeated for all rows.
  const distinct = new Set(names);
  expect(distinct.size).toBeGreaterThan(1);
});
