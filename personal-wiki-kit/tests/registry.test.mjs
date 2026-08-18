import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRegistryDocuments } from '../src/content.mjs';

const taxonomySource = `
schema: 1
sections:
  - id: software-development
    title: 软件开发
    description: 通用软件工程知识。
    order: 10
    categories:
      - id: architecture
        title: 架构
        description: 系统边界与组件职责。
        order: 10
`;

const projectsSource = `
schema: 1
projects:
  - id: example-project
    title: 示例项目
    description: 完全虚构的公共测试项目。
    order: 10
`;

const articlesSource = `
schema: 1
articles:
  - id: example-article
    section: software-development
    category: architecture
    projects: [example-project]
    order: 10
`;

function parse(overrides = {}) {
  return parseRegistryDocuments({
    taxonomySource,
    projectsSource,
    articlesSource,
    articleIds: ['example-article'],
    ...overrides,
  });
}

test('registry parser returns valid sorted assignments', () => {
  const result = parse();
  assert.equal(result.taxonomy[0].id, 'software-development');
  assert.equal(result.projects[0].id, 'example-project');
  assert.deepEqual(result.assignments.get('example-article'), {
    id: 'example-article',
    section: 'software-development',
    category: 'architecture',
    projects: ['example-project'],
    order: 10,
  });
});

test('registry parser rejects missing and dangling article registrations', () => {
  assert.throws(
    () => parse({ articleIds: ['example-article', 'missing-article'] }),
    /missing-article has no article registration/,
  );
  assert.throws(
    () => parse({ articleIds: [] }),
    /example-article has no matching Markdown file/,
  );
});

test('registry parser rejects duplicate peer order', () => {
  const duplicate = `${articlesSource}
  - id: second-article
    section: software-development
    category: architecture
    projects: []
    order: 10
`;
  assert.throws(
    () => parse({
      articlesSource: duplicate,
      articleIds: ['example-article', 'second-article'],
    }),
    /peer order 10 is duplicated/,
  );
});

test('registry parser rejects unknown project and category ids', () => {
  assert.throws(
    () => parse({ articlesSource: articlesSource.replace('architecture', 'unknown-category') }),
    /unknown category software-development\/unknown-category/,
  );
  assert.throws(
    () => parse({ articlesSource: articlesSource.replace('example-project]', 'missing-project]') }),
    /unknown project missing-project/,
  );
});
