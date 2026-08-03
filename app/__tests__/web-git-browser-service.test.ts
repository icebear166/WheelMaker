import fs from 'fs';
import path from 'path';
import {RegistryRepository} from '../web/src/registry/RegistryRepository';

test('git log forwards project, refs, cursor, and limit', async () => {
  const request = jest.fn(async () => ({payload: {commits: [{sha: 'abc'}]}}));
  const repository = new RegistryRepository({request} as never);

  await expect(repository.gitLog('p2', 'HEAD', '50', 50, ['main', 'origin/main']))
    .resolves.toEqual([{sha: 'abc'}]);
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    method: 'project.git.log',
    projectId: 'p2',
    payload: {ref: 'HEAD', refs: ['main', 'origin/main'], cursor: '50', limit: 50},
  }));
});

test('workspace service exposes explicit project-scoped git methods', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../web/src/registry/RegistryWorkspaceService.ts'),
    'utf8',
  );
  expect(source).toContain('async listProjectGitCommits(');
  expect(source).toContain('async listProjectGitBranches(');
  expect(source).toContain('async getProjectGitStatus(');
  expect(source).toContain('async readProjectWorkingTreeFileDiff(');
});
