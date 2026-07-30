export type SkillRetryNotice<T> = {
  message: string;
  retry: {kind: 'action'; target: T};
};

export function createSkillRetryNotice<T>(
  message: string,
  target?: T,
): SkillRetryNotice<T> | null {
  if (!target) {
    return null;
  }
  return {
    message,
    retry: {kind: 'action', target},
  };
}
