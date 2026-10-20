/**
 * Log redaction shared by the API and the website's server-side code.
 * Anything that might be a secret is replaced before it reaches a log line.
 */

/** Keys whose values are never written to logs, at any depth. */
const SENSITIVE_KEY = /pass(word)?|secret|token|authori[sz]ation|cookie|session|api[-_]?key|otp|credential|database_?url|connection_?string/i;
/** Credentials embedded in connection strings / URLs (scheme://user:pass@host). */
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+)(:[^\s@/]*)?@/gi;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/g;

export const REDACTED = '[REDACTED]';

/** Masks credentials inside free text (error messages, URLs). */
export function redactText(text: string): string {
  return text.replace(URL_CREDENTIALS, `$1${REDACTED}@`).replace(BEARER, `$1 ${REDACTED}`);
}

/** Deep-copies a value, replacing sensitive keys and credentials inside strings. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[Truncated]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    return out;
  }
  return value;
}
