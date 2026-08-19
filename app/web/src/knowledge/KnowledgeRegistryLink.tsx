import React from 'react';
import {Icon} from '../common/Icon';
import {normalizeKnowledgeRegistryURL} from './knowledgeRegistry';

const UNCONFIGURED_MESSAGE =
  'Personal Wiki is not configured. Set knowledgeRegistry.publicUrl on the Registry server.';

type KnowledgeRegistryLinkProps = {
  publicUrl?: string;
  onUnconfigured?: (message: string) => void;
};

export function KnowledgeRegistryLink({
  publicUrl,
  onUnconfigured,
}: KnowledgeRegistryLinkProps) {
  const href = normalizeKnowledgeRegistryURL(publicUrl);
  if (!href) {
    return (
      <button
        type="button"
        className="chat-drawer-toggle chat-knowledge-registry-link"
        onClick={() => onUnconfigured?.(UNCONFIGURED_MESSAGE)}
        data-tooltip="Personal Wiki is not configured"
        aria-label="Open Personal Wiki"
      >
        <Icon name="swatchBook" />
      </button>
    );
  }

  return (
    <a
      className="chat-drawer-toggle chat-knowledge-registry-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-tooltip="Open Personal Wiki"
      aria-label="Open Personal Wiki"
    >
      <Icon name="swatchBook" />
    </a>
  );
}
