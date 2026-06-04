import React from 'react';

export type CCSwitchProfileCard = {
  projectId: string;
  projectName: string;
  projectHub: string;
  projectAgents: string[];
  profiles: Array<{
    profileName: string;
    skills: string[];
  }>;
};

type CCSwitchSettingsDetailProps = {
  activeHub: string;
  activeAgent: string;
  profileCards: CCSwitchProfileCard[];
  tagVariantClass: (prefix: string, value: string) => string;
  hubAccentStyle: (hubId: string) => React.CSSProperties;
};

export function CCSwitchSettingsDetail({
  activeHub,
  activeAgent,
  profileCards,
  tagVariantClass,
  hubAccentStyle,
}: CCSwitchSettingsDetailProps) {
  return (
    <>
      <div className="settings-metadata-list">
        <div className="settings-metadata-card">
          <div className="settings-metadata-line settings-metadata-line-tags">
            <span
              className={`wide-project-hub-tag ${tagVariantClass('wide-project-hub', activeHub)}`}
              style={hubAccentStyle(activeHub)}
            >
              <span className="wide-project-hub-dot" aria-hidden="true" />
              <span className="wide-project-hub-label">Hub: {activeHub}</span>
            </span>
            <span className={`wide-session-agent-tag ${tagVariantClass('wide-session-agent', activeAgent)}`}>
              Agent: {activeAgent}
            </span>
          </div>
        </div>
        {profileCards.map(card => (
          <div key={`cc-switch:${card.projectId}`} className="settings-metadata-card">
            <div className="settings-metadata-line settings-metadata-line-tags">
              <span
                className={`wide-project-hub-tag ${tagVariantClass('wide-project-hub', card.projectHub)}`}
                style={hubAccentStyle(card.projectHub)}
              >
                <span className="wide-project-hub-dot" aria-hidden="true" />
                <span className="wide-project-hub-label">{card.projectHub}</span>
              </span>
              {card.projectAgents.map(agent => (
                <span
                  key={`cc-switch:${card.projectId}:agent:${agent}`}
                  className={`wide-session-agent-tag ${tagVariantClass('wide-session-agent', agent)}`}
                >
                  {agent}
                </span>
              ))}
            </div>
            <div className="settings-metadata-line settings-metadata-line-primary">
              <span className="settings-metadata-title" title={card.projectName}>{card.projectName}</span>
            </div>
            {card.profiles.map(profile => (
              <div key={`cc-switch:${card.projectId}:profile:${profile.profileName}`} className="settings-metadata-line">
                <span className={`wide-session-agent-tag ${tagVariantClass('wide-session-agent', profile.profileName)}`}>
                  {profile.profileName}
                </span>
                {profile.skills.length > 0 ? ` \u00b7 ${profile.skills.join(', ')}` : ' \u00b7 No skills'}
              </div>
            ))}
          </div>
        ))}
      </div>
      {profileCards.length === 0 ? (
        <div className="muted block">No CC Switch profile metadata found.</div>
      ) : null}
    </>
  );
}
