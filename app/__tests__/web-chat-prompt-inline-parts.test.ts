import {
  buildChatPromptInlineParts,
} from '../web/src/chat/composer/chatPromptInlineParts';
import {
  isProjectFileResourceLinkBlock,
  isPromptAttachmentContentBlock,
} from '../web/src/chat/composer/chatPromptAttachments';
import type {RegistrySessionContentBlock} from '../web/src/registry/registryTypes';

describe('chat prompt inline parts', () => {
  test('renders new prompt text and resource links as inline file parts', () => {
    const blocks: RegistrySessionContentBlock[] = [
      {type: 'text', text: '/grill-me in @fix_drop.py please'},
      {type: 'resource_link', uri: 'app/fix_drop.py', name: 'fix_drop.py'},
    ];

    expect(buildChatPromptInlineParts(blocks, [{command: '/grill-me', label: 'Grill Me'}])).toEqual([
      {type: 'skill', command: '/grill-me', label: 'Grill Me'},
      {type: 'text', text: ' in '},
      {type: 'file', label: 'fix_drop.py', path: 'app/fix_drop.py', name: 'fix_drop.py'},
      {type: 'text', text: ' please'},
    ]);
  });

  test('supports bracketed file mentions with spaces', () => {
    const blocks: RegistrySessionContentBlock[] = [
      {type: 'text', text: 'read @<my file.ts>'},
      {type: 'resource_link', uri: 'docs/my file.ts', name: 'my file.ts'},
    ];

    expect(buildChatPromptInlineParts(blocks, []).at(-1)).toEqual({
      type: 'file',
      label: 'my file.ts',
      path: 'docs/my file.ts',
      name: 'my file.ts',
    });
  });

  test('leaves manual at text unchanged when no resource link matches', () => {
    expect(buildChatPromptInlineParts([{type: 'text', text: 'see @fix_drop.py'}], [])).toEqual([
      {type: 'text', text: 'see @fix_drop.py'},
    ]);
  });

  test('classifies project file resource links separately from uploaded attachments', () => {
    const mention = {type: 'resource_link', uri: 'app/a.ts', name: 'a.ts'} as RegistrySessionContentBlock;
    const uploaded = {type: 'resource_link', uri: 'file:///D:/a.ts', name: 'a.ts'} as RegistrySessionContentBlock;

    expect(isProjectFileResourceLinkBlock(mention)).toBe(true);
    expect(isPromptAttachmentContentBlock(mention)).toBe(false);
    expect(isProjectFileResourceLinkBlock(uploaded)).toBe(false);
    expect(isPromptAttachmentContentBlock(uploaded)).toBe(true);
  });
});
