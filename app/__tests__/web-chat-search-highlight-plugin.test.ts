import {createChatSearchHighlightPlugin} from '../web/src/chat/search/chatSearchHighlightPlugin';

type TestNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  value?: string;
  children?: TestNode[];
};

function runPlugin(tree: TestNode, query: string): TestNode {
  createChatSearchHighlightPlugin(query)()(tree);
  return tree;
}

describe('chat search highlight rehype plugin', () => {
  test('wraps matched text in mark elements, case-insensitive', () => {
    const tree: TestNode = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          children: [{type: 'text', value: 'Deploy the API'}],
        },
      ],
    };
    runPlugin(tree, 'deploy');
    expect(tree.children?.[0].children).toEqual([
      {
        type: 'element',
        tagName: 'mark',
        properties: {className: ['chat-search-match']},
        children: [{type: 'text', value: 'Deploy'}],
      },
      {type: 'text', value: ' the API'},
    ]);
  });

  test('highlights nested elements but skips code and pre', () => {
    const tree: TestNode = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          children: [
            {
              type: 'element',
              tagName: 'strong',
              children: [{type: 'text', value: 'deploy now'}],
            },
          ],
        },
        {
          type: 'element',
          tagName: 'pre',
          children: [
            {
              type: 'element',
              tagName: 'code',
              children: [{type: 'text', value: 'deploy --prod'}],
            },
          ],
        },
      ],
    };
    runPlugin(tree, 'deploy');
    expect(tree.children?.[0].children?.[0].children).toEqual([
      {
        type: 'element',
        tagName: 'mark',
        properties: {className: ['chat-search-match']},
        children: [{type: 'text', value: 'deploy'}],
      },
      {type: 'text', value: ' now'},
    ]);
    expect(tree.children?.[1].children?.[0].children).toEqual([{type: 'text', value: 'deploy --prod'}]);
  });

  test('marks the active result separately when requested', () => {
    const tree: TestNode = {
      type: 'root',
      children: [
        {type: 'element', tagName: 'p', children: [{type: 'text', value: 'Deploy now'}]},
      ],
    };
    createChatSearchHighlightPlugin('deploy', {active: true})()(tree);
    expect(tree.children?.[0].children?.[0].properties).toEqual({
      className: ['chat-search-match', 'chat-search-match-active'],
    });
  });

  test('leaves trees without matches untouched and ignores empty queries', () => {
    const tree: TestNode = {
      type: 'root',
      children: [
        {type: 'element', tagName: 'p', children: [{type: 'text', value: 'nothing here'}]},
      ],
    };
    runPlugin(tree, 'zz');
    expect(tree.children?.[0].children).toEqual([{type: 'text', value: 'nothing here'}]);
    runPlugin(tree, '   ');
    expect(tree.children?.[0].children).toEqual([{type: 'text', value: 'nothing here'}]);
  });
});
