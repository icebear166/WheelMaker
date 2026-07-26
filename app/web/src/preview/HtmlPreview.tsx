import React, {useEffect, useId, useMemo, useRef} from 'react';

import {
  htmlPreviewFormFields,
  htmlPreviewSourceKey,
  type HtmlPreviewSource,
} from './htmlPreviewSource';

export type HtmlPreviewProps = {
  endpoint: string;
  csrfToken: string;
  source: HtmlPreviewSource;
};

export const HtmlPreview = React.memo(function HtmlPreview({
  endpoint,
  csrfToken,
  source,
}: HtmlPreviewProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const reactId = useId();
  const target = useMemo(
    () => `wheelmaker-html-preview-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [reactId],
  );
  const sourceKey = htmlPreviewSourceKey(source);
  const fields = htmlPreviewFormFields(source);

  useEffect(() => {
    if (endpoint && csrfToken) {
      formRef.current?.requestSubmit();
    }
  }, [endpoint, csrfToken, sourceKey]);

  return (
    <div className="html-preview">
      <form
        ref={formRef}
        method="post"
        action={endpoint}
        target={target}
        hidden
        aria-hidden="true"
      >
        {fields.map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <input type="hidden" name="csrfToken" value={csrfToken} />
      </form>
      <iframe
        className="html-preview-frame"
        name={target}
        title="HTML preview"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
    </div>
  );
});
