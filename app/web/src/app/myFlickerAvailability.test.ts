import {
  filterMyFlickerAgentTypes,
  hasMyFlickerPackage,
  MY_FLICKER_PACKAGE_NAME,
} from './myFlickerAvailability';

describe('MyFlicker availability', () => {
  it('uses the NPM package row as the availability signal', () => {
    expect(hasMyFlickerPackage([{packageName: MY_FLICKER_PACKAGE_NAME}])).toBe(true);
    expect(hasMyFlickerPackage([{packageName: '@openai/codex'}])).toBe(false);
    expect(hasMyFlickerPackage(undefined)).toBe(false);
  });

  it('removes Flicker agent choices without changing other agents', () => {
    expect(filterMyFlickerAgentTypes(['codex', 'flicker', 'cc-flicker'], false))
      .toEqual(['codex']);
    expect(filterMyFlickerAgentTypes(['codex', 'Flicker', 'CC-FLICKER'], true))
      .toEqual(['codex', 'Flicker', 'CC-FLICKER']);
  });
});
