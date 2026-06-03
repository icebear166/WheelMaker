import React, {useMemo} from 'react';

import {buildTokenStatCards, type TokenProviderSectionView} from '../tokenStatsView';

type TokenStatsSettingsDetailProps = {
  providers: TokenProviderSectionView[];
  updatedAt: string;
  loading: boolean;
  error: string;
  tagVariantClass: (scope: 'agent' | 'hub', value: string) => string;
  hubAccentStyle: (hubId: string) => React.CSSProperties;
};

export function TokenStatsSettingsDetail({
  providers,
  updatedAt,
  loading,
  error,
  tagVariantClass,
  hubAccentStyle,
}: TokenStatsSettingsDetailProps) {
  const tokenStatCards = useMemo(
    () => buildTokenStatCards(providers),
    [providers],
  );

  return (
    <>
      {updatedAt ? (
        <div className="muted block">Updated: {updatedAt}</div>
      ) : null}
      {loading ? (
        <div className="muted block">Scanning online hubs...</div>
      ) : null}
      {error ? (
        <div className="muted block settings-metadata-error">{error}</div>
      ) : null}
      {!loading && tokenStatCards.length === 0 && !error ? (
        <div className="muted block">No token accounts discovered.</div>
      ) : null}
      <div className="settings-metadata-list token-stats-account-list-flat">
        {tokenStatCards.map(card => (
          <div key={card.id} className="settings-metadata-card">
            <div className="settings-metadata-line settings-metadata-line-tags">
              <span className={`token-stats-pill ${tagVariantClass('agent', card.agentTag)}`}>
                {card.agentTag}
              </span>
              {card.hubTags.map(hubTag => (
                <span
                  key={hubTag}
                  className={`token-stats-pill ${tagVariantClass('hub', hubTag)}`}
                  style={hubAccentStyle(hubTag)}
                >
                  {hubTag}
                </span>
              ))}
            </div>
            <div className="settings-metadata-line settings-metadata-line-primary">
              <span className="settings-metadata-title">{card.accountName}</span>
            </div>
            {card.message ? (
              <div className="settings-metadata-error">{card.message}</div>
            ) : null}
            {card.secondaryLine ? (
              <div className="settings-metadata-line">{card.secondaryLine}</div>
            ) : null}
            {card.tertiaryLine ? (
              <div className="settings-metadata-line">{card.tertiaryLine}</div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
