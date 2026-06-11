import fs from 'fs';
import path from 'path';

import {readWebStyles} from '../testHelpers/webStyles';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

describe('web chat inline composer capsule wiring', () => {
  test('uses rich composer tokens for inline skill and file capsules', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = readSourceText(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'));
    const stylesCss = readWebStyles(projectRoot);

    expect(mainTsx).toContain("import { ChatRichComposer, type ChatRichComposerHandle } from '../chat/composer/ChatRichComposer';");
    expect(mainTsx).toContain('const [chatComposerTokens, setChatComposerTokens] = useState<ChatComposerToken[]>([]);');
    expect(mainTsx).toContain('const serializedComposer = serializeChatComposerTokens(sourceTokens);');
    expect(mainTsx).toContain('chatRichComposerRef.current?.insertSkill');
    expect(mainTsx).toContain('chatRichComposerRef.current?.insertFile');
    expect(mainTsx).not.toContain('className="chat-file-mention-chip"');
    expect(mainTsx).toContain('<ChatRichComposer');
    expect(stylesCss).toContain('.chat-rich-composer');
    expect(stylesCss).toContain('.chat-composer-capsule');
    const capsuleRuleStart = stylesCss.indexOf('.chat-composer-capsule,\n.chat-prompt-inline-capsule {');
    const capsuleRuleEnd = stylesCss.indexOf('}', capsuleRuleStart);
    const capsuleRule = stylesCss.slice(capsuleRuleStart, capsuleRuleEnd);
    expect(capsuleRule).toContain('gap: 1px;');
  });
});
