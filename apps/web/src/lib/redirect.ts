const KEY = 'saha_return_to';

/** Preserve deep links through sign-in and registration without trusting query strings. */
export function rememberReturnTo(path: string): void {
  if (path.startsWith('/') && !path.startsWith('//')) sessionStorage.setItem(KEY, path);
}

export function consumeReturnTo(fallback = '/app'): string {
  const path = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  return path && path.startsWith('/') && !path.startsWith('//') ? path : fallback;
}
