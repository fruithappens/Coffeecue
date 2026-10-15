import { isPublicPath, PUBLIC_SCREEN_PATHS } from './publicPaths';

test('customer, display and sign-up pages are public', () => {
  ['/start', '/my', '/my?e=ABC', '/order', '/display/menu', '/setup/abc123', '/status'].forEach((p) => {
    expect(isPublicPath(p)).toBe(true);
  });
});

test('staff pages and look-alikes are not', () => {
  ['/run', '/barista', '/login', '/', '/starting', '/mystery', '/displayed'].forEach((p) => {
    expect(isPublicPath(p)).toBe(false);
  });
  expect(PUBLIC_SCREEN_PATHS).toContain('/start');
});
