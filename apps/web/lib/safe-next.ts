/** Only allow same-site relative redirects after login (prevents open redirects). */
export function safeNext(value: string | null | undefined, fallback = '/home'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
