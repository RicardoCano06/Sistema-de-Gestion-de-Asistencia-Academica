interface FormatDateTimeOptions {
  locale?: string;
  withSeconds?: boolean;
}

export function formatDateTime24(value: string | number | Date | null | undefined, options: FormatDateTimeOptions = {}): string {
  if (!value) return '-';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const { locale = 'es-PY', withSeconds = false } = options;

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(date);
}

export function formatDateOnly(value: string | number | Date | null | undefined, locale = 'es-PY'): string {
  if (!value) return '-';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
