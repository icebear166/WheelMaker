export type WheelMakerNotificationType = 'chat.prompt.completed';

export type PromptCompletionNotificationStatus =
  | 'completed'
  | 'cancelled'
  | 'interrupted'
  | 'failed';

export type WheelMakerNotificationPayload = {
  type: WheelMakerNotificationType;
  projectId: string;
  sessionId: string;
  turnIndex: number;
  title: string;
  body: string;
  status: PromptCompletionNotificationStatus;
  url: string;
};
