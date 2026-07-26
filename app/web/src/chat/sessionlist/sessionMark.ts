import type {RegistrySessionMarkColor} from '../../registry/registryTypes';

export const SESSION_MARK_OPTIONS: ReadonlyArray<{
  color: RegistrySessionMarkColor;
  label: string;
}> = [
  {color: 'red', label: 'Red'},
  {color: 'yellow', label: 'Yellow'},
  {color: 'green', label: 'Green'},
  {color: 'blue', label: 'Blue'},
];

export function sessionMarkColorClass(markColor: RegistrySessionMarkColor): string {
  return `session-mark-${markColor}`;
}
