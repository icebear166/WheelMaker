import React from 'react';

export const ChatActivityDots = React.memo(function ChatActivityDots() {
  return (
    <span className="chat-activity-dots" aria-hidden="true">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
});
