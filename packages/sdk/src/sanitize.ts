const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/(authorization|cookie|set-cookie|x-api-key|apikey)\s*:\s*[^\n,;]+/gi, '$1: [REDACTED]'],
  [/(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[=:]\s*["']?[^\s,"'}]+/gi, '$1=[REDACTED]'],
  [/(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']+/gi, '$1://[REDACTED]'],
  [/(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, '$1 [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[JWT REDACTED]'],
];

/** Remove credentials and common secret shapes before telemetry leaves the process. */
export function sanitize(value: string | undefined, maxLength = 16_000): string | undefined {
  if (!value) return undefined;
  let redacted = value;
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted.slice(0, maxLength);
}

export function sanitizeObject(
  input: Record<string, unknown> | undefined,
  depth = 3,
): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const blocked = /password|passwd|secret|token|authorization|cookie|apikey|api_key|credential|private/i;
  const walk = (object: Record<string, unknown>, level: number): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(object).slice(0, 30)) {
      if (blocked.test(key)) {
        result[key] = '[REDACTED]';
      } else if (level >= depth) {
        result[key] = '[TRUNCATED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = walk(value as Record<string, unknown>, level + 1);
      } else if (Array.isArray(value)) {
        result[key] = value.slice(0, 10).map((item) =>
          item && typeof item === 'object'
            ? walk(item as Record<string, unknown>, level + 1)
            : typeof item === 'string'
              ? sanitize(item, 500)
              : item,
        );
      } else if (typeof value === 'string') {
        result[key] = sanitize(value, 1000);
      } else {
        result[key] = value;
      }
    }
    return result;
  };
  return walk(input, 0);
}
