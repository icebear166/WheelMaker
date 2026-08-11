export const CHAT_SHARE_DOCUMENT_CLASS_NAME = 'wheelmaker-chat-share';

export const CHAT_SHARE_DOCUMENT_STYLE = `
.wheelmaker-chat-share .chat-share-header {
  margin: 0 0 28px;
  padding: 0 0 18px;
  border-bottom: 1px solid var(--border-subtle);
}
.wheelmaker-chat-share .chat-share-title {
  margin: 0 0 6px;
  font-size: 24px;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.wheelmaker-chat-share .chat-share-timestamp {
  color: var(--text-secondary);
  font-size: 12px;
}
.wheelmaker-chat-share .chat-share-entry {
  margin: 0;
  padding: 18px 0;
  border-bottom: 1px solid var(--border-subtle);
}
.wheelmaker-chat-share .chat-share-entry:last-child { border-bottom: 0; }
.wheelmaker-chat-share .chat-share-entry-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.wheelmaker-chat-share .chat-share-role {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.wheelmaker-chat-share .chat-share-status {
  padding: 2px 7px;
  border: 1px solid color-mix(in srgb, #d65a5a 55%, var(--border-subtle));
  border-radius: 999px;
  color: #d65a5a;
  font-size: 11px;
  font-weight: 600;
}
.wheelmaker-chat-share .chat-share-entry-markdown > :first-child { margin-top: 0; }
.wheelmaker-chat-share .chat-share-entry-markdown > :last-child { margin-bottom: 0; }
.wheelmaker-chat-share .chat-share-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.wheelmaker-chat-share .chat-share-attachment-label {
  display: inline-block;
  max-width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}
`;
