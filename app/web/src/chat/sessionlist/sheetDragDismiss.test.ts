import {resolveSheetReleaseDuration} from './sheetDragDismiss';

describe('resolveSheetReleaseDuration', () => {
  it('maps release velocity to a bounded return duration', () => {
    expect(resolveSheetReleaseDuration(0)).toBe(180);
    expect(resolveSheetReleaseDuration(0.4)).toBe(140);
    expect(resolveSheetReleaseDuration(0.8)).toBe(100);
    expect(resolveSheetReleaseDuration(2)).toBe(100);
    expect(resolveSheetReleaseDuration(-0.4)).toBe(140);
  });
});
