export type PortalModeValue = 'user' | 'admin';

export function resolveRootDestination(input: {
  ready: boolean;
  authenticated: boolean;
  isAdmin: boolean;
  mode: PortalModeValue;
  needsPortalChoice: boolean;
  rootSegment?: string;
}): '/login' | '/management' | '/(tabs)/tasks' | null {
  if (!input.ready) return null;
  const inLogin = input.rootSegment === 'login';
  const inManagement = input.rootSegment === 'management';
  if (!input.authenticated) return inLogin ? null : '/login';
  if (inLogin) {
    if (input.needsPortalChoice) return null;
    return input.mode === 'admin' && input.isAdmin ? '/management' : '/(tabs)/tasks';
  }
  if (inManagement && !(input.mode === 'admin' && input.isAdmin)) return '/(tabs)/tasks';
  return null;
}
