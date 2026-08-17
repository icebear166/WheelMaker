import React from 'react';
import {PreviewWorkbenchChrome} from './PreviewWorkbenchChrome';

export type PreviewWorkbenchViewProps = React.ComponentProps<typeof PreviewWorkbenchChrome>;

/**
 * Shared Preview host view. The main Workspace and the detached window supply
 * their own data/actions, while Chrome and drawer layout remain one component.
 */
export function PreviewWorkbenchView(props: PreviewWorkbenchViewProps) {
  return <PreviewWorkbenchChrome {...props} />;
}
