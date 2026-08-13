import fs from 'fs';
import path from 'path';

function readSourceText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

describe('external file share and HTML export wiring', () => {
  const projectRoot = path.join(__dirname, '..');
  const mainPath = path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx');
  const shareManagerPath = path.join(projectRoot, 'web', 'src', 'shares', 'ShareManager.tsx');

  test('share manager project sources carry an external marker', () => {
    const shareManagerTsx = readSourceText(shareManagerPath);
    const sourceStart = shareManagerTsx.indexOf('export type ShareManagerProjectSource = {');
    expect(sourceStart).toBeGreaterThanOrEqual(0);
    const sourceEnd = shareManagerTsx.indexOf('};', sourceStart);
    expect(sourceEnd).toBeGreaterThan(sourceStart);

    expect(shareManagerTsx.slice(sourceStart, sourceEnd)).toContain('external?: boolean');
  });

  test('markdown HTML export input carries an external marker', () => {
    const mainTsx = readSourceText(mainPath);
    const inputStart = mainTsx.indexOf('type StartMarkdownHtmlExportInput = {');
    expect(inputStart).toBeGreaterThanOrEqual(0);
    const inputEnd = mainTsx.indexOf('};', inputStart);
    expect(inputEnd).toBeGreaterThan(inputStart);

    expect(mainTsx.slice(inputStart, inputEnd)).toContain('external?: boolean');
  });

  test('chat file link menu routes external share and export through the external read path', () => {
    const mainTsx = readSourceText(mainPath);
    const handlerStart = mainTsx.indexOf('const handleChatFileLinkMenuAction =');
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    const handlerEnd = mainTsx.indexOf('const copyChatFilePreviewPath', handlerStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handlerBody = mainTsx.slice(handlerStart, handlerEnd);

    expect(handlerBody).toContain('shareKindForExternalPath');
    expect(handlerBody).toContain('service.readExternalFile(menuProjectId');
    expect(handlerBody).toContain('external: true');
  });

  test('preview tab menu routes external share and export through the external read path', () => {
    const mainTsx = readSourceText(mainPath);
    const handlerStart = mainTsx.indexOf('const handlePreviewTabMenuAction =');
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    const handlerEnd = mainTsx.indexOf('const renderPreviewTabActions', handlerStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handlerBody = mainTsx.slice(handlerStart, handlerEnd);

    expect(handlerBody).toContain('shareKindForExternalPath');
    expect(handlerBody).toContain('external: true');
  });

  test('markdown HTML export resolves external images via the external read path', () => {
    const mainTsx = readSourceText(mainPath);
    const resolverStart = mainTsx.indexOf('const createMarkdownImageResolver = useCallback(');
    expect(resolverStart).toBeGreaterThanOrEqual(0);
    const resolverEnd = mainTsx.indexOf('const startMarkdownHtmlExport = async', resolverStart);
    expect(resolverEnd).toBeGreaterThan(resolverStart);
    const resolverBody = mainTsx.slice(resolverStart, resolverEnd);

    expect(resolverBody).toContain('resolveExternalMarkdownImagePath');
    expect(resolverBody).toContain('service.readExternalFile(');
  });

  test('share capture reads external content and images via the external read path', () => {
    const mainTsx = readSourceText(mainPath);
    const captureStart = mainTsx.indexOf('const captureShareSource = useCallback(');
    expect(captureStart).toBeGreaterThanOrEqual(0);
    const captureEnd = mainTsx.indexOf('const promptMarkdownHtmlExportNameError', captureStart);
    expect(captureEnd).toBeGreaterThan(captureStart);
    const captureBody = mainTsx.slice(captureStart, captureEnd);

    expect(captureBody).toContain('resolveExternalMarkdownImagePath');
    expect(captureBody).toContain('service.readExternalFile(');
  });
});
