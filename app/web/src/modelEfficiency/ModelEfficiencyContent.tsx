import React from 'react';

import {selectTopModelEfficiencyItems} from './modelEfficiencyModel';
import {
  EFFORT_ORDER,
  MODEL_FAMILIES,
  type ModelEfficiencyFamily,
  type ModelEfficiencyItem,
  type ModelEfficiencySnapshot,
} from './modelEfficiencyTypes';

const FAMILY_LABELS: Record<ModelEfficiencyFamily, string> = {
  'gpt-5.6-sol': 'Sol',
  'gpt-5.6-terra': 'Terra',
  'gpt-5.6-luna': 'Luna',
};

function formatScore(score: number): string {
  return String(Math.round(score));
}

export function formatModelEfficiencyCost(averageCostUsd?: number): string {
  return averageCostUsd === undefined ? '—' : `$${averageCostUsd.toFixed(2)}`;
}

export function formatModelEfficiencyDuration(averageTaskSeconds?: number): string {
  if (averageTaskSeconds === undefined) return '—';
  const minutes = Math.max(0, Math.round(averageTaskSeconds / 60));
  return `${minutes}m`;
}

function formatEffortLabel(effort: ModelEfficiencyItem['effort']): string {
  return `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

function ScoreCard({
  item,
  familyLabel,
}: {
  item: ModelEfficiencyItem;
  familyLabel: string;
}) {
  return (
    <article className="model-efficiency-recommendation" data-model-efficiency-card={true}>
      <span className="model-efficiency-model-name">
        {familyLabel} {formatEffortLabel(item.effort)}
      </span>
      <strong className="model-efficiency-score">{formatScore(item.score)}</strong>
      <span className="model-efficiency-meta">
        <span>{formatModelEfficiencyCost(item.averageCostUsd)}</span>
        <span>{formatModelEfficiencyDuration(item.averageTaskSeconds)}</span>
      </span>
    </article>
  );
}

export function ModelEfficiencySimpleContent({items}: {items: readonly ModelEfficiencyItem[]}) {
  return (
    <div className="model-efficiency-simple-list" aria-label="Model efficiency top scores">
      {MODEL_FAMILIES.map(family => (
        <section
          className="model-efficiency-family-row"
          data-model-efficiency-family={family}
          aria-label={`${FAMILY_LABELS[family]} top scores`}
          key={family}
        >
          {selectTopModelEfficiencyItems(items.filter(item => item.family === family)).map(item => (
            <ScoreCard
              item={item}
              familyLabel={FAMILY_LABELS[family]}
              key={item.effort}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function DetailFamily({
  family,
  items,
}: {
  family: ModelEfficiencyFamily;
  items: readonly ModelEfficiencyItem[];
}) {
  const familyItems = items
    .filter(item => item.family === family)
    .sort((left, right) => EFFORT_ORDER.indexOf(left.effort) - EFFORT_ORDER.indexOf(right.effort));
  if (familyItems.length === 0) return null;

  const label = FAMILY_LABELS[family];
  return (
    <section className="model-efficiency-detail-family">
      <h3>{label}</h3>
      <table aria-label={`${label} model efficiency`}>
        <thead>
          <tr>
            <th scope="col">Effort</th>
            <th scope="col">Score</th>
            <th scope="col">Cost</th>
            <th scope="col">Time</th>
          </tr>
        </thead>
        <tbody>
          {familyItems.map(item => (
            <tr data-model-efficiency-effort={item.effort} key={item.effort}>
              <td>{item.effort}</td>
              <td>{formatScore(item.score)}</td>
              <td>{formatModelEfficiencyCost(item.averageCostUsd)}</td>
              <td>{formatModelEfficiencyDuration(item.averageTaskSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ModelEfficiencyDetailContent({items}: {items: readonly ModelEfficiencyItem[]}) {
  return (
    <div className="model-efficiency-detail-list">
      {MODEL_FAMILIES.map(family => (
        <DetailFamily family={family} items={items} key={family} />
      ))}
    </div>
  );
}

export function ModelEfficiencySnapshotContent({
  snapshot,
  mode,
  onRetry,
}: {
  snapshot: ModelEfficiencySnapshot;
  mode: 'simple' | 'detail';
  onRetry?: () => void;
}) {
  if (snapshot.items.length === 0) {
    if (snapshot.status === 'error') {
      return (
        <div className="model-efficiency-state error" role="alert">
          <span>{snapshot.error || 'Unable to load CodexRadar data.'}</span>
          {onRetry ? (
            <button type="button" aria-label="Retry model efficiency" onClick={onRetry}>Retry</button>
          ) : null}
        </div>
      );
    }
    if (snapshot.status === 'idle' || snapshot.status === 'loading') {
      return (
        <div className="model-efficiency-skeleton" aria-label="Loading model efficiency">
          {MODEL_FAMILIES.map(family => (
            <span className="model-efficiency-skeleton-row" key={family}>
              <span className="model-efficiency-skeleton-rail" />
              <span className="model-efficiency-skeleton-rail" />
              <span className="model-efficiency-skeleton-rail" />
            </span>
          ))}
        </div>
      );
    }
    return <div className="model-efficiency-state">No supported model data</div>;
  }

  return (
    <>
      {snapshot.error ? (
        <div className="model-efficiency-inline-error" role="alert">{snapshot.error}</div>
      ) : null}
      {mode === 'detail'
        ? <ModelEfficiencyDetailContent items={snapshot.items} />
        : <ModelEfficiencySimpleContent items={snapshot.items} />}
    </>
  );
}

export function formatModelEfficiencyUpdatedAt(updatedAt?: string): string {
  if (!updatedAt) return '';
  const date = new Date(updatedAt);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `Updated ${year}-${month}-${day} ${hour}:${minute} UTC`;
}
