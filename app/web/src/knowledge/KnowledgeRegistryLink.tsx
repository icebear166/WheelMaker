import React from 'react';
import {Icon} from '../common/Icon';
import {normalizeKnowledgeRegistryURL} from './knowledgeRegistry';

type KnowledgeRegistryLinkProps = {
  publicUrl?: string;
};

export function KnowledgeRegistryLink({publicUrl}: KnowledgeRegistryLinkProps) {
  const href = normalizeKnowledgeRegistryURL(publicUrl);
  if (!href) return null;

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
