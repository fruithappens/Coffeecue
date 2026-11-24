import { markSwitchedView, clearSwitchedView, hasSwitchedView } from './switchedView';

beforeEach(() => sessionStorage.clear());

test('only a tab that came through Switch view is remembered', () => {
  expect(hasSwitchedView()).toBe(false);
  markSwitchedView();
  expect(hasSwitchedView()).toBe(true);
  clearSwitchedView();
  expect(hasSwitchedView()).toBe(false);
});
