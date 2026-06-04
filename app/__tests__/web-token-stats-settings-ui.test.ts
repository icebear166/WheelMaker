import fs from 'fs';
import path from 'path';

describe('token stats settings UI source structure', () => {
  test('lazy loads the Token Stats detail and keeps card rendering outside main', () => {
    const projectRoot = path.join(__dirname, '..');
    const mainTsx = fs.readFileSync(path.join(projectRoot, 'web', 'src', 'app', 'WorkspaceApp.tsx'), 'utf8');
    const detailPath = path.join(projectRoot, 'web', 'src', 'settings', 'TokenStatsSettingsDetail.tsx');
    const detailTsx = fs.existsSync(detailPath) ? fs.readFileSync(detailPath, 'utf8') : '';

    expect(mainTsx).toContain("'tokenStats'");
    expect(mainTsx).toContain('renderTokenStatsSettingsDetail(options)');
    expect(mainTsx).toContain("import(/* webpackChunkName: \"settings\" */ '../settings/SettingsBundle')");
    expect(mainTsx).toContain('<TokenStatsSettingsDetail');
    expect(mainTsx).toContain('providers={tokenStatsProviders}');
    expect(mainTsx).toContain('loading={tokenStatsLoading}');
    expect(mainTsx).toContain('error={tokenStatsError}');
    expect(mainTsx).toContain('updatedAt={tokenStatsUpdatedAt}');
    expect(mainTsx).not.toContain('buildTokenStatCards,');
    expect(mainTsx).not.toContain('type TokenStatCardView');
    expect(mainTsx).not.toContain('const tokenStatCards = useMemo');
    expect(fs.existsSync(detailPath)).toBe(true);
    expect(detailTsx).toContain("import {buildTokenStatCards, type TokenProviderSectionView} from './tokenStatsView';");
    expect(detailTsx).toContain('const tokenStatCards = useMemo(');
    expect(detailTsx).toContain('buildTokenStatCards(providers)');
    expect(detailTsx).toContain('No token accounts discovered.');
    expect(detailTsx).toContain('token-stats-account-list-flat');
    expect(detailTsx).toContain("tagVariantClass('agent', card.agentTag)");
    expect(detailTsx).toContain('hubAccentStyle(hubTag)');
  });
});
