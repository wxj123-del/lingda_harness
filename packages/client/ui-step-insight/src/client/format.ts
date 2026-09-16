/** Locale-neutral exact numeric presentation for the ledger. */
import type { StepRow } from './types.ts'
import type { Translate } from './locales.ts'

/**
 * Format counters without compact notation.
 * @param value - exact counter or absent value.
 * @returns A readable count, rounding fractional rates to two decimals.
 */
export function number(value: number | null | undefined): string {
  return value == null ? '\u2014' : value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/**
 * Preserve the distinction between exact counts and partial accounting.
 * @param exact - authoritative aggregate.
 * @param minimum - sum of reported buckets.
 * @returns Exact count or explicit lower bound.
 */
export function accounted(exact: number | null, minimum: number | null): string {
  return exact !== null ? number(exact) : minimum === null ? number(null) : `≥${number(minimum)}`
}

/**
 * Name one request attempt in the user's language.
 * @param row - request identity.
 * @param t - bound product dictionary.
 * @returns Compact request label.
 */
export function rowLabel(row: StepRow, t: Translate): string {
  if (row.kind === 'compaction') return `${t('compaction')} #${row.seq}`
  return `${t('turn')} ${row.turn} / ${t('step')} ${row.step}${row.attempt > 1 ? ` / ${t('attempt')} ${row.attempt}` : ''}`
}
