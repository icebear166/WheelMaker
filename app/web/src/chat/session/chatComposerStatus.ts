import type {
  RegistrySessionConfigOption,
  RegistrySessionUsage,
} from '../../registry/registryTypes';

export type ChatContextUsageView = {
  available: boolean;
  percent: number;
  percentText: string;
  usedText: string;
  sizeText: string;
  summaryText: string;
  title: string;
};

export type ChatComposerStatusOptions = {
  modelOption?: RegistrySessionConfigOption;
  reasoningOption?: RegistrySessionConfigOption;
  secondaryOptions: RegistrySessionConfigOption[];
  overflowOptions: RegistrySessionConfigOption[];
  showOverflowToggle: boolean;
};

function optionSearchText(option: RegistrySessionConfigOption): string {
  return [option.id, option.category, option.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function isChatModelOption(
  option: RegistrySessionConfigOption,
): boolean {
  return optionSearchText(option).includes('model');
}

export function isChatReasoningOption(
  option: RegistrySessionConfigOption,
): boolean {
  const text = optionSearchText(option);
  return (
    text.includes('reasoning') ||
    text.includes('effort') ||
    text.includes('thought')
  );
}

export function chatConfigCurrentLabel(
  option: RegistrySessionConfigOption,
): string {
  const currentValue = option.currentValue ?? '';
  const current = option.options?.find(item => item.value === currentValue);
  return current?.name || currentValue || option.name || option.id;
}

export function formatCompactTokenCount(value: number): string {
  const normalized = Math.max(0, Math.trunc(value));
  if (normalized >= 1_000_000) {
    const millions = normalized / 1_000_000;
    return `${
      Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)
    }m`;
  }
  if (normalized >= 1_000) {
    return `${Math.round(normalized / 1_000)}k`;
  }
  return String(normalized);
}

export function formatChatContextUsage(
  usage?: RegistrySessionUsage | null,
): ChatContextUsageView | null {
  if (
    !usage ||
    !Number.isFinite(usage.used) ||
    !Number.isFinite(usage.size ?? 0) ||
    !usage.size ||
    usage.size <= 0
  ) {
    return null;
  }
  const used = Math.max(0, Math.trunc(usage.used));
  const size = Math.max(1, Math.trunc(usage.size));
  const percent = Math.min(100, Math.max(0, Math.ceil((used / size) * 100)));
  const usedText = formatCompactTokenCount(used);
  const sizeText = formatCompactTokenCount(size);
  const summaryText = `${usedText.toUpperCase()}/${sizeText.toUpperCase()} ${percent}%`;
  return {
    available: true,
    percent,
    percentText: `${percent}%`,
    usedText,
    sizeText,
    summaryText,
    title: `Context window: ${percent}% used (${usedText} / ${sizeText} tokens)`,
  };
}

export function isChatFastModeOption(
  option: RegistrySessionConfigOption,
): boolean {
  return option.id === 'fast_mode';
}

function secondaryOptionRank(option: RegistrySessionConfigOption): number {
  const text = optionSearchText(option);
  if (text.includes('personality')) {
    return 0;
  }
  if (text.includes('approval') || text.includes('access') || text.includes('permission')) {
    return 1;
  }
  return 9;
}

export function splitChatComposerStatusOptions(
  options: RegistrySessionConfigOption[],
  compact: boolean,
): ChatComposerStatusOptions {
  const modelOption = options.find(isChatModelOption);
  const reasoningOption = options.find(
    option => option !== modelOption && isChatReasoningOption(option),
  );
  const coreIds = new Set(
    [modelOption?.id, reasoningOption?.id].filter((id): id is string => !!id),
  );
  const secondaryOptions = options
    .filter(option => !coreIds.has(option.id) && !isChatFastModeOption(option))
    .map((option, index) => ({ option, index, rank: secondaryOptionRank(option) }))
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank;
      }
      return left.index - right.index;
    })
    .map(item => item.option);
  return {
    modelOption,
    reasoningOption,
    secondaryOptions: compact ? [] : secondaryOptions,
    overflowOptions: compact ? secondaryOptions : [],
    showOverflowToggle: compact && secondaryOptions.length > 0,
  };
}
