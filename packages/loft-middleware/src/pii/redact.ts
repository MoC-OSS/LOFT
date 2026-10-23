import type { TextMap } from '../content';
import type { PiiDetector } from './detectors';

/**
 * How a finding is replaced:
 * - `redact`: by a placeholder with its type, such as `[REDACTED:EMAIL]`;
 * - `mask`: by the same text with its letters and digits starred, except the last quarter of them, at most 4, such
 *   as `**** **** **** 1111`. Nothing before an `@` is kept, so a masked e-mail address is not one any more.
 */
export type PiiStrategy = 'redact' | 'mask';

// Passes until the text no longer changes; each pass replaces at least one finding, which no detector finds again
const MAX_PASSES = 16;

interface Finding {
  start: number;
  end: number;
  type: string;
}

/** The redacted form of a value. Neither form contains anything a built-in detector finds again. */
export function replacement(value: string, type: string, strategy: PiiStrategy): string {
  if (strategy === 'redact') return `[REDACTED:${type}]`;
  const total = value.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  let keep = Math.min(4, Math.floor(total / 4));
  let starred = '';
  for (let index = value.length - 1; index >= 0; index--) {
    const character = value[index];
    if (character === '@') keep = 0;
    if (/[\p{L}\p{N}]/u.test(character) && keep-- <= 0) starred = '*' + starred;
    else starred = character + starred;
  }
  return starred;
}

// Findings in text order; of overlapping findings, the earlier one wins, and of two starting together, the longer
function withoutOverlaps(findings: Finding[]): Finding[] {
  const sorted = [...findings].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Finding[] = [];
  for (const finding of sorted) {
    if (kept.length === 0 || finding.start >= kept[kept.length - 1].end) kept.push(finding);
  }
  return kept;
}

/**
 * A function that replaces what the detectors find in a text, calling `onFound` with the type of each finding.
 * Applying it twice gives the same text as applying it once.
 */
export function createRedactor(
  detectors: readonly PiiDetector[],
  strategy: PiiStrategy,
  onFound?: (type: string) => void
): TextMap {
  // One pass over the text. A replacement can expose a finding next to it, such as a card number written right after
  // an IBAN, which a pattern does not take when it follows a digit
  const redactOnce = (text: string): string => {
    const findings = withoutOverlaps(
      detectors.flatMap((detector) => detector.detect(text).map((match) => ({ ...match, type: detector.type })))
    );
    if (findings.length === 0) return text;
    let result = '';
    let position = 0;
    for (const finding of findings) {
      result += text.slice(position, finding.start);
      result += replacement(text.slice(finding.start, finding.end), finding.type, strategy);
      position = finding.end;
      onFound?.(finding.type);
    }
    return result + text.slice(position);
  };
  return (text) => {
    let current = text;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const next = redactOnce(current);
      if (next === current) break;
      current = next;
    }
    return current;
  };
}
