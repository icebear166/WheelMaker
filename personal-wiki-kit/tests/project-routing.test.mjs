import assert from 'node:assert/strict';
import { join, normalize } from 'node:path';
import test from 'node:test';

import {
  parseProjectRouting,
  resolveProjectIds,
} from '../src/project-routing.mjs';

const base = normalize(join('C:\\', 'example', 'work'));

function parse(routes) {
  return parseProjectRouting(JSON.stringify({ schema: 1, routes }), {
    projectIds: new Set(['shared-engine-projects', 'nested-project']),
  });
}

test('project routing allows multiple roots to map to one Wiki project', () => {
  const routing = parse([
    {
      projectId: 'shared-engine-projects',
      roots: [join(base, 'ProjectA'), join(base, 'ProjectB')],
    },
  ]);

  assert.deepEqual(resolveProjectIds(routing, {
    sourcePaths: [join(base, 'ProjectA', 'Source', 'A.cs'), join(base, 'ProjectB', 'Source', 'B.cs')],
  }), {
    projectIds: ['shared-engine-projects'],
    unmatchedSources: [],
  });
});

test('project routing uses the longest containing root and merges multiple sources', () => {
  const routing = parse([
    { projectId: 'shared-engine-projects', roots: [join(base, 'ProjectA'), join(base, 'ProjectB')] },
    { projectId: 'nested-project', roots: [join(base, 'ProjectA', 'Packages', 'Nested')] },
  ]);

  assert.deepEqual(resolveProjectIds(routing, {
    sourcePaths: [
      join(base, 'ProjectA', 'Packages', 'Nested', 'module.cs'),
      join(base, 'ProjectB', 'Source', 'world.cs'),
      join(base, 'Unknown', 'file.txt'),
    ],
  }), {
    projectIds: ['nested-project', 'shared-engine-projects'],
    unmatchedSources: [join(base, 'Unknown', 'file.txt')],
  });
});

test('project routing returns empty project ids when no source matches', () => {
  const routing = parse([
    { projectId: 'shared-engine-projects', roots: [join(base, 'ProjectA')] },
  ]);
  const source = join(base, 'Unknown');
  assert.deepEqual(resolveProjectIds(routing, { workspacePath: source }), {
    projectIds: [],
    unmatchedSources: [source],
  });
});

test('project routing rejects unknown fields, project ids, and duplicate roots', () => {
  assert.throws(
    () => parseProjectRouting('{"schema":1,"routes":[],"defaultProject":"x"}'),
    /不支持的字段 defaultProject/,
  );
  assert.throws(
    () => parse([{ projectId: 'unknown-project', roots: [join(base, 'ProjectA')] }]),
    /未知项目 ID/,
  );
  assert.throws(
    () => parse([
      { projectId: 'shared-engine-projects', roots: [join(base, 'ProjectA')] },
      { projectId: 'nested-project', roots: [join(base, 'ProjectA')] },
    ]),
    /同时分配/,
  );
});
