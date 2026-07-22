import React from 'react';

import {selectModelRecommendations} from './modelEfficiencyModel';
import {
  EFFORT_ORDER,
  MODEL_FAMILIES,
  type ModelEfficiencyFamily,
  type ModelEfficiencyItem,
  type ModelEfficiencySnapshot,
  type RecommendationRole,
} from './modelEfficiencyTypes';

const FAMILY_LABELS: Record<ModelEfficiencyFamily, string> = {
  'gpt-5.6-sol': 'Sol',
  'gpt-5.6-terra': 'Terra',
  'gpt-5.6-luna': 'Luna',
};

const RECOMMENDATION_ROLES: Array<{
  id: RecommendationRole;
  label: string;
}> = [
  {id: 'quality', label: 'Quality'},
  {id: 'balanced', label: 'Balanced'},
  {id: 'economy', label: 'Economy'},
];

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

export function formatModelEfficiencyCost(averageCostUsd?: number): string {
  return averageCostUsd === undefined ? '—' : `$${averageCostUsd.toFixed(2)}`;
}

export function formatModelEfficiencyDuration(averageTaskSeconds?: number): string {
  if (averageTaskSeconds === undefined) return '—';
  const seconds = Math.max(0, Math.round(averageTaskSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function RecommendationCell({
  item,
  role,
}: {
  item: ModelEfficiencyItem | null;
  role: RecommendationRole;
}) {
  return (
    <td className={`model-efficiency-simple-cell role-${role}`} data-model-efficiency-role={role}>
      {item ? (
        <span className="model-efficiency-recommendation">
          <strong>{item.effort}</strong>
          <span>IQ {formatScore(item.score)}</span>
          <span>{formatModelEfficiencyCost(item.averageCostUsd)}</span>
          <span>{formatModelEfficiencyDuration(item.averageTaskSeconds)}</span>
        </span>
      ) : <span className="model-efficiency-missing">—</span>}
    </td>
  );
}

export function ModelEfficiencySimpleContent({items}: {items: readonly ModelEfficiencyItem[]}) {
  return (
    <table className="model-efficiency-simple-table" aria-label="Model efficiency recommendations">
      <colgroup>
        <col className="model-efficiency-model-column" />
        <col span={3} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Model</th>
          {RECOMMENDATION_ROLES.map(role => <th scope="col" key={role.id}>{role.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {MODEL_FAMILIES.map(family => {
          const recommendations = selectModelRecommendations(
            items.filter(item => item.family === family),
          );
          return (
            <tr data-model-efficiency-family={family} key={family}>
              <th scope="row">{FAMILY_LABELS[family]}</th>
              {RECOMMENDATION_ROLES.map(role => (
                <RecommendationCell
                  item={recommendations[role.id]}
                  role={role.id}
                  key={role.id}
                />
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
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
            <th scope="col">IQ</th>
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
      return <div className="model-efficiency-state">Loading CodexRadar data…</div>;
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
