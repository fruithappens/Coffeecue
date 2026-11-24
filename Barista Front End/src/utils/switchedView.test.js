import { markSwitchedView, clearSwitchedView, hasSwitchedView, isAdminLogin } from './switchedView';

beforeEach(() => sessionStorage.clear());

test('only a tab that came through Switch view is remembered', () => {
  expect(hasSwitchedView()).toBe(false);
  markSwitchedView();
  expect(hasSwitchedView()).toBe(true);
  clearSwitchedView();
  expect(hasSwitchedView()).toBe(false);
});

test('only an admin login skips the PIN', () => {
  for (const [role, yes] of [['admin', true], ['Admin', true], ['barista', false], ['staff', false], [undefined, false]]) {
    localStorage.setItem('coffee_system_user', JSON.stringify({ role }));
    expect(isAdminLogin()).toBe(yes);
  }
  localStorage.setItem('coffee_system_user', 'junk');
  expect(isAdminLogin()).toBe(false);
});
