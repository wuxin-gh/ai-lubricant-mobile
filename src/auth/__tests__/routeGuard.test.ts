import { resolveRootDestination } from '../routeGuard';

describe('root route guard', () => {
  it('keeps an admin on login while portal choice is open', () => {
    expect(resolveRootDestination({ ready: true, authenticated: true, isAdmin: true, mode: 'user', needsPortalChoice: true, rootSegment: 'login' })).toBeNull();
  });

  it('routes chosen admin mode to management', () => {
    expect(resolveRootDestination({ ready: true, authenticated: true, isAdmin: true, mode: 'admin', needsPortalChoice: false, rootSegment: 'login' })).toBe('/management');
  });

  it('rejects non-admin management deep links', () => {
    expect(resolveRootDestination({ ready: true, authenticated: true, isAdmin: false, mode: 'admin', needsPortalChoice: false, rootSegment: 'management' })).toBe('/(tabs)/tasks');
  });

  it('routes unauthenticated users to login', () => {
    expect(resolveRootDestination({ ready: true, authenticated: false, isAdmin: false, mode: 'user', needsPortalChoice: false, rootSegment: 'tasks' })).toBe('/login');
  });
});
