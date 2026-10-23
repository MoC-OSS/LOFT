/** Where a detector found personal data in a text: `text.slice(start, end)`. */
export interface PiiMatch {
  readonly start: number;
  readonly end: number;
}

/**
 * Finds one type of personal data in a text. It must be synchronous, because traces are masked in the tracer's own
 * synchronous calls; its patterns must run in linear time on any input; and it must not find the placeholders, such
 * as `[REDACTED:EMAIL]`, or masked values, because the redactor runs again until the text no longer changes.
 */
export interface PiiDetector {
  /** The type shown in the placeholder, such as `EMAIL` in `[REDACTED:EMAIL]` */
  readonly type: string;
  detect(text: string): readonly PiiMatch[];
}

/**
 * A detector from a global regular expression. Each match is a candidate; `validate`, when given, returns the part of
 * the candidate that is valid, or undefined. When a candidate is not valid, the search goes on from its next character,
 * so a value inside a longer candidate is still found.
 */
export function regexDetector(
  type: string,
  pattern: RegExp,
  validate?: (candidate: string) => PiiMatch | undefined
): PiiDetector {
  if (!pattern.global) throw new Error(`The pattern of the ${type} detector must have the g flag`);
  return {
    type,
    detect(text) {
      // A copy, so the search does not depend on the pattern's lastIndex
      const search = new RegExp(pattern.source, pattern.flags);
      const matches: PiiMatch[] = [];
      for (let match = search.exec(text); match !== null; match = search.exec(text)) {
        const found = validate ? validate(match[0]) : { start: 0, end: match[0].length };
        if (found && found.end > found.start) {
          matches.push({ start: match.index + found.start, end: match.index + found.end });
          search.lastIndex = match.index + found.end;
        } else {
          search.lastIndex = match.index + 1;
        }
      }
      return matches;
    }
  };
}

// Letters and digits of any script, so addresses such as josé@exämple.de are found
const EMAIL = /[\p{L}\p{N}._%+-]{1,64}@(?:[\p{L}\p{N}-]{1,63}\.)+\p{L}{2,63}/uy;
const EMAIL_LOCAL_CHARACTER = /^[\p{L}\p{N}._%+-]$/u;
const MAX_LOCAL_PART = 64;

// Where the local part before the @ at `at` starts: up to 64 characters back, not before `floor`
function localPartStart(text: string, at: number, floor: number): number {
  let start = at;
  for (let characters = 0; characters < MAX_LOCAL_PART && start > floor; characters++) {
    const pairStart = text.codePointAt(start - 2) ?? 0;
    // A character outside the Basic Multilingual Plane takes two code units
    const width = start - 2 >= floor && pairStart > 0xffff ? 2 : 1;
    if (!EMAIL_LOCAL_CHARACTER.test(text.slice(start - width, start))) break;
    start -= width;
  }
  return start;
}

/**
 * E-mail addresses, including letters outside ASCII. The search starts at each @, so it costs little on text without
 * one, such as an encoded image, and runs in linear time on any text.
 */
export function emailDetector(): PiiDetector {
  return {
    type: 'EMAIL',
    detect(text) {
      const matches: PiiMatch[] = [];
      const pattern = new RegExp(EMAIL.source, EMAIL.flags);
      let floor = 0;
      for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
        if (at < floor) continue;
        pattern.lastIndex = localPartStart(text, at, floor);
        const match = pattern.exec(text);
        if (match === null) continue;
        matches.push({ start: match.index, end: match.index + match[0].length });
        floor = match.index + match[0].length;
      }
      return matches;
    }
  };
}

// Digits, optionally grouped by single spaces (including no-break spaces and tabs) or hyphens. Each repetition takes one
// digit, so the pattern runs in linear time, and a run is never part of a longer number
const DIGIT_RUN = /(?<!\d)\d(?:(?:[^\S\r\n]|-)?\d)*/g;
const CARD_SEPARATOR = /[^\S\r\n]|-/g;
const MIN_CARD_DIGITS = 13;
const MAX_CARD_DIGITS = 19;

/** Whether the digits pass the Luhn check that payment card numbers carry. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

// Card numbers start with 2 to 6: Mastercard, American Express, Diners, JCB, Visa, Discover, UnionPay, Maestro
const ISSUER = /^[2-6]/;

interface DigitGroup extends PiiMatch {
  digits: string;
}

function digitGroups(run: string): DigitGroup[] {
  const groups: DigitGroup[] = [];
  let start = 0;
  for (const separator of run.matchAll(CARD_SEPARATOR)) {
    groups.push({ start, end: separator.index, digits: run.slice(start, separator.index) });
    start = separator.index + 1;
  }
  groups.push({ start, end: run.length, digits: run.slice(start) });
  return groups;
}

const doubled = (digit: number): number => (digit > 4 ? digit * 2 - 9 : digit * 2);

// The last group of the longest card number that starts with the given group, or -1. The Luhn sums are kept for both
// parities as digits are added, so each start costs at most 19 digits
function cardEnd(groups: readonly DigitGroup[], first: number): number {
  if (!ISSUER.test(groups[first].digits)) return -1;
  let end = -1;
  let length = 0;
  // The Luhn sum when the digits at even positions from the left are doubled, and when those at odd positions are
  let evenDoubled = 0;
  let oddDoubled = 0;
  for (let last = first; last < groups.length; last++) {
    const { digits } = groups[last];
    if (length + digits.length > MAX_CARD_DIGITS) break;
    for (const character of digits) {
      const digit = character.charCodeAt(0) - 48;
      evenDoubled += length % 2 === 0 ? doubled(digit) : digit;
      oddDoubled += length % 2 === 1 ? doubled(digit) : digit;
      length++;
    }
    // The last digit is never doubled, nor is any digit an even distance from it
    const sum = (length - 1) % 2 === 0 ? oddDoubled : evenDoubled;
    if (length >= MIN_CARD_DIGITS && sum % 10 === 0) end = last;
  }
  return end;
}

/**
 * Payment card numbers: 13 to 19 digits, optionally grouped by single spaces or hyphens, that start with 2 to 6, as
 * the major card networks do, and pass the Luhn check. A card number is found inside a longer run of grouped digits,
 * such as one followed by its security code; of the card numbers that start with the same group, the longest wins.
 * About one in ten other numbers of that length passes too, so long numeric ids can be redacted.
 */
export function creditCardDetector(): PiiDetector {
  return {
    type: 'CARD',
    detect(text) {
      const matches: PiiMatch[] = [];
      for (const run of text.matchAll(DIGIT_RUN)) {
        // Most runs, such as those in encoded data, are too short to hold a card number
        if (run[0].length < MIN_CARD_DIGITS) continue;
        const groups = digitGroups(run[0]);
        for (let first = 0; first < groups.length; first++) {
          const last = cardEnd(groups, first);
          if (last < 0) continue;
          matches.push({ start: run.index + groups[first].start, end: run.index + groups[last].end });
          first = last;
        }
      }
      return matches;
    }
  };
}

// A country code, two check digits and 11 to 30 letters or digits, optionally grouped by single spaces or hyphens, in
// capitals or not
const IBAN = /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/gi;

/** Whether a compact IBAN (no separators, in capitals) passes its mod-97 check. */
export function ibanValid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const value = Number.parseInt(character, 36);
    remainder = Number(`${remainder}${value}`) % 97;
  }
  return remainder === 1;
}

// IBAN lengths by country, from the SWIFT IBAN registry
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BI: 27,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DJ: 27,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FK: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MN: 20,
  MR: 27,
  MT: 31,
  MU: 30,
  NI: 28,
  NL: 18,
  NO: 15,
  OM: 23,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  RU: 33,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  SO: 23,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
  YE: 30
};

// The IBAN the candidate starts with. The country's IBAN length decides where it ends, so a word after it is not
// taken in
function validIban(candidate: string): PiiMatch | undefined {
  const upper = candidate.toUpperCase();
  const length = IBAN_LENGTHS[upper.slice(0, 2)];
  if (length === undefined) return undefined;
  let characters = 0;
  for (let end = 1; end <= upper.length; end++) {
    if (upper[end - 1] !== ' ' && upper[end - 1] !== '-') characters++;
    if (characters === length)
      return ibanValid(upper.slice(0, end).replace(/[ -]/g, '')) ? { start: 0, end } : undefined;
  }
  return undefined;
}

/** International bank account numbers (IBAN) of a known country and length that pass the mod-97 check. */
export const ibanDetector = (): PiiDetector => regexDetector('IBAN', IBAN, validIban);

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
// Not part of a longer dotted number, such as a version string; a sentence may end after it
const IPV4 = new RegExp(`(?<![\\d.])${OCTET}(?:\\.${OCTET}){3}(?!\\d|\\.\\d)`, 'g');

/** IPv4 addresses. Opt-in: version numbers and other dotted numbers can look like one. */
export const ipv4Detector = (): PiiDetector => regexDetector('IP', IPV4);

/** The detectors used when none are given: e-mail addresses, payment card numbers and IBANs. */
export const defaultPiiDetectors = (): PiiDetector[] => [emailDetector(), creditCardDetector(), ibanDetector()];
