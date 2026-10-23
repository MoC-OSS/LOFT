import { Type } from '@moc-global/loft-definitions';
import { configureMockLoggerStrategy } from '@moc-global/loft-test-suite';
import { describe, expect, it, vi } from 'vitest';

import {
  createRedactor,
  creditCardDetector,
  defaultPiiDetectors,
  emailDetector,
  ibanDetector,
  ipv4Detector,
  type PiiDetector,
  piiRedaction,
  regexDetector
} from '../pii';
import { ibanValid, luhnValid } from '../pii/detectors';
import { replacement } from '../pii/redact';

const logger = configureMockLoggerStrategy();

const found = (detector: PiiDetector, text: string) =>
  detector.detect(text).map((match) => text.slice(match.start, match.end));

describe('detectors', () => {
  it('finds e-mail addresses, including letters outside ASCII', () => {
    expect(found(emailDetector(), 'Write to jane.doe+news@example.co.uk or josé@exämple.de today.')).toEqual([
      'jane.doe+news@example.co.uk',
      'josé@exämple.de'
    ]);
    expect(found(emailDetector(), 'no address @ here, nor user@localhost')).toEqual([]);
  });

  it('finds card numbers that pass the Luhn check, grouped or not, and nothing inside a longer number', () => {
    const text = 'Card 4111 1111 1111 1111, also 5500-0000-0000-0004 and 4111111111111111; not 4111111111111112.';
    expect(found(creditCardDetector(), text)).toEqual([
      '4111 1111 1111 1111',
      '5500-0000-0000-0004',
      '4111111111111111'
    ]);
    expect(found(creditCardDetector(), 'order 41111111111111110000 and 4111 1111 1111 1111 2025')).toEqual([
      '4111 1111 1111 1111'
    ]);
    expect(luhnValid('79927398713')).toBe(true);
    expect(luhnValid('79927398710')).toBe(false);
  });

  it('finds IBANs that pass the mod-97 check, and not the capital word after one', () => {
    expect(found(ibanDetector(), 'Pay to DE89 3704 0044 0532 0130 00 TODAY or GB82WEST12345698765432.')).toEqual([
      'DE89 3704 0044 0532 0130 00',
      'GB82WEST12345698765432'
    ]);
    expect(found(ibanDetector(), 'DE89 3704 0044 0532 0130 01')).toEqual([]);
    expect(found(ibanDetector(), 'XX89 3704 0044 0532 0130 00 and DE89 3704 0044 0532 0130')).toEqual([]);
    expect(ibanValid('GB82WEST12345698765432')).toBe(true);
  });

  it('finds IPv4 addresses, but not version strings or longer dotted numbers', () => {
    expect(found(ipv4Detector(), 'From 192.168.1.25. Version 1.2.3.4.5 and 300.1.1.1 are not.')).toEqual([
      '192.168.1.25'
    ]);
  });

  it('defaults to e-mail, card and IBAN; IP is opt-in', () => {
    expect(defaultPiiDetectors().map((detector) => detector.type)).toEqual(['EMAIL', 'CARD', 'IBAN']);
  });

  it('rejects a pattern without the g flag', () => {
    expect(() => regexDetector('X', /x/)).toThrow('must have the g flag');
  });

  it('scans long hostile inputs in linear time', () => {
    const inputs = [
      'a'.repeat(200_000),
      '1'.repeat(200_000),
      '1 '.repeat(100_000),
      `${'a.'.repeat(100_000)}@`,
      `${'A1 '.repeat(70_000)}`,
      '1.'.repeat(100_000),
      '5-'.repeat(100_000),
      '5 '.repeat(100_000),
      `${'a'.repeat(60)}@`.repeat(3_000),
      'a@'.repeat(100_000)
    ];
    const started = performance.now();
    for (const input of inputs)
      for (const detector of [...defaultPiiDetectors(), ipv4Detector()]) detector.detect(input);
    // Each input is scanned in milliseconds; the bound only catches catastrophic backtracking
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe('createRedactor', () => {
  const detectors = [...defaultPiiDetectors(), ipv4Detector()];

  it('replaces findings by a placeholder with their type, or by a masked copy', () => {
    const text = 'Mail jane@example.com, card 4111 1111 1111 1111, ip 10.0.0.1.';
    expect(createRedactor(detectors, 'redact')(text)).toBe(
      'Mail [REDACTED:EMAIL], card [REDACTED:CARD], ip [REDACTED:IP].'
    );
    expect(createRedactor(detectors, 'mask')(text)).toBe(
      'Mail ****@*******.com, card **** **** **** 1111, ip **.*.*.1.'
    );
  });

  it('reports each finding, and leaves text without findings as it was', () => {
    const onFound = vi.fn();
    const redact = createRedactor(detectors, 'redact', onFound);
    expect(redact('a@b.io and c@d.io')).toBe('[REDACTED:EMAIL] and [REDACTED:EMAIL]');
    expect(onFound.mock.calls).toEqual([['EMAIL'], ['EMAIL']]);
    expect(redact('nothing here')).toBe('nothing here');
  });

  it('redacts a finding that a replacement exposes, such as a card number written right after an IBAN', () => {
    expect(createRedactor(detectors, 'redact')('DE89 3704 0044 0532 0130 004111 1111 1111 1111')).toBe(
      '[REDACTED:IBAN][REDACTED:CARD]'
    );
  });

  it('keeps the earlier of overlapping findings', () => {
    const word = regexDetector('WORD', /abcdefgh/g);
    const inner = regexDetector('INNER', /efghijkl/g);
    expect(createRedactor([word, inner], 'redact')('abcdefghijklmn')).toBe('[REDACTED:WORD]ijklmn');
  });

  it('gives the same text when applied twice, for both strategies', () => {
    // A seeded generator, so a failing text can be reproduced
    let state = 20261023;
    const random = () => {
      state = (state * 1103515245 + 12345) % 2 ** 31;
      return state / 2 ** 31;
    };
    const pieces = [
      'jane@example.com',
      '4111 1111 1111 1111',
      'DE89 3704 0044 0532 0130 00',
      '10.1.2.3',
      ' text ',
      '.',
      '@',
      '-'
    ];
    for (const strategy of ['redact', 'mask'] as const) {
      const redact = createRedactor(detectors, strategy);
      for (let round = 0; round < 300; round++) {
        const text = Array.from({ length: 8 }, () => pieces[Math.floor(random() * pieces.length)]).join('');
        const once = redact(text);
        expect(redact(once), text).toBe(once);
      }
    }
  });

  it('masks at most the last four letters or digits, and a quarter of short values', () => {
    expect(replacement('4111111111111111', 'CARD', 'mask')).toBe('************1111');
    expect(replacement('1.2.3.4', 'IP', 'mask')).toBe('*.*.*.4');
    expect(replacement('ab', 'X', 'mask')).toBe('**');
  });
});

const message = (text: string, role = Type.LLM.UnifiedMessageRole.user): Type.Entity.CreateMessage => ({
  sessionId: 's',
  ctx: {},
  content: [{ type: 'text', text }],
  role,
  author: 'user',
  llmName: 'llm',
  manifestName: 'manifest',
  llmIgnore: false
});

const chain = () => ({ next: vi.fn() });

describe('piiRedaction', () => {
  it('masks traces only by default', () => {
    const middleware = piiRedaction();
    expect(middleware.name).toBe('pii-redaction');
    expect(middleware.maskTrace?.('mail jane@example.com')).toBe('mail [REDACTED:EMAIL]');
    expect(middleware.input).toBeUndefined();
    expect(middleware.toolResult).toBeUndefined();
    expect(middleware.afterGenerate).toBeUndefined();
  });

  it('with input on, redacts the direct messages and augmented context and reports what it found', async () => {
    const onDetect = vi.fn();
    const middleware = piiRedaction({ input: true, traces: false, onDetect });
    const payload = {
      directMessages: [message('I am jane@example.com, card 4111 1111 1111 1111')],
      augmentedContext: [message('CRM: jane@example.com', Type.LLM.UnifiedMessageRole.system)]
    };
    const next = chain();

    const result = await middleware.input!({} as never, payload, next as never);

    expect(result.directMessages[0].content).toEqual([
      { type: 'text', text: 'I am [REDACTED:EMAIL], card [REDACTED:CARD]' }
    ]);
    expect(result.augmentedContext[0].content).toEqual([{ type: 'text', text: 'CRM: [REDACTED:EMAIL]' }]);
    expect(next.next).toHaveBeenCalledOnce();
    expect(onDetect.mock.calls).toEqual([
      [{ type: 'EMAIL', count: 2, stage: 'input' }],
      [{ type: 'CARD', count: 1, stage: 'input' }]
    ]);
    expect(middleware.maskTrace).toBeUndefined();
  });

  it('with toolResults on, redacts the text of a tool output', async () => {
    const middleware = piiRedaction({ toolResults: true, strategy: 'mask' });
    await expect(
      Promise.resolve(
        middleware.toolResult!(
          { content: [{ type: 'text', text: 'card 4111111111111111' }], isError: false },
          {
            toolName: 'crm',
            source: 'mcp'
          }
        )
      )
    ).resolves.toEqual({ content: [{ type: 'text', text: 'card ************1111' }], isError: false });
  });

  it('with output on, redacts the reply and the stored tool calls and results, in place', async () => {
    const middleware = piiRedaction({ output: true });
    const reply = { ...message('Your e-mail is jane@example.com', Type.LLM.UnifiedMessageRole.assistant) };
    const toolCall = {
      ...message('', Type.LLM.UnifiedMessageRole.assistant),
      content: [
        {
          type: 'tool_call' as const,
          method: 'tools/call' as const,
          params: { name: 'send', arguments: { to: 'jane@example.com' } }
        }
      ]
    };
    const payload = { llmResponse: { topChoice: reply, choices: [reply], usedTools: [toolCall] } };

    await middleware.afterGenerate!({} as never, payload as never, chain() as never);

    expect(reply.content).toEqual([{ type: 'text', text: 'Your e-mail is [REDACTED:EMAIL]' }]);
    expect(JSON.stringify(toolCall.content)).not.toContain('jane@example.com');
  });
});

describe('detectors on values written next to other text (review findings)', () => {
  const redact = createRedactor(defaultPiiDetectors(), 'redact');

  it.each([
    ['4111 1111 1111 1111 123', '[REDACTED:CARD] 123'],
    ['card 4111 1111 1111 1111 12/27', 'card [REDACTED:CARD] 12/27'],
    ['I bought 2 4111 1111 1111 1111', 'I bought 2 [REDACTED:CARD]'],
    ['ref 7 4111 1111 1111 1111', 'ref 7 [REDACTED:CARD]'],
    ['4111111111111111-12/26', '[REDACTED:CARD]-12/26'],
    ['Visa-4111111111111111', 'Visa-[REDACTED:CARD]'],
    [
      `4111${String.fromCodePoint(0xa0)}1111${String.fromCodePoint(0xa0)}1111${String.fromCodePoint(0xa0)}1111`,
      '[REDACTED:CARD]'
    ]
  ])('finds the card in %j', (text, expected) => {
    expect(redact(text)).toBe(expected);
  });

  it('does not take a number that cannot be a card number', () => {
    // Passes Luhn, but no card network starts with 9
    expect(redact('order 9111111111111110')).toBe('order 9111111111111110');
  });

  it.each([
    ['de89 3704 0044 0532 0130 00 today', '[REDACTED:IBAN] today'],
    ['DE89-3704-0044-0532-0130-00', '[REDACTED:IBAN]'],
    ['AB12 DE89 3704 0044 0532 0130 00', 'AB12 [REDACTED:IBAN]']
  ])('finds the IBAN in %j', (text, expected) => {
    expect(redact(text)).toBe(expected);
  });

  it('masks an e-mail address without keeping anything before the @, so it is not found again', () => {
    const onFound = vi.fn();
    const mask = createRedactor(defaultPiiDetectors(), 'mask', onFound);
    const masked = mask('abcdefghijklmnopqrstuvwxyz@a.bc');
    expect(masked).toBe('**************************@a.bc');
    expect(mask(masked)).toBe(masked);
    expect(onFound).toHaveBeenCalledTimes(1);
  });
});

describe('detectors and options (second review)', () => {
  it('finds every card number in one run of grouped digits', () => {
    expect(found(creditCardDetector(), 'cards 4111 1111 1111 1111 5500 0000 0000 0004 on file')).toEqual([
      '4111 1111 1111 1111',
      '5500 0000 0000 0004'
    ]);
  });

  it('finds an e-mail address with letters outside the Basic Multilingual Plane, and at most 64 before the @', () => {
    const script = String.fromCodePoint(0x1d49c);
    expect(found(emailDetector(), `write to ${script}lice@example.com`)).toEqual([`${script}lice@example.com`]);
    expect(found(emailDetector(), `${'a'.repeat(70)}@example.com`)).toEqual([`${'a'.repeat(64)}@example.com`]);
    expect(found(emailDetector(), 'a@b and jane@example.com, x@y')).toEqual(['jane@example.com']);
  });

  it('needs at least one detector', () => {
    expect(() => piiRedaction({ detectors: [] })).toThrow('at least one detector');
  });

  it('goes on redacting when onDetect throws', async () => {
    const guard = piiRedaction({
      input: true,
      onDetect: () => {
        throw new Error('metrics down');
      }
    });
    const payload = {
      directMessages: [
        {
          role: Type.LLM.UnifiedMessageRole.user,
          author: 'u',
          content: [{ type: 'text' as const, text: 'jane@example.com' }]
        }
      ],
      augmentedContext: []
    };

    const result = await guard.input!({} as never, payload as never, { next: () => undefined } as never);

    expect(result.directMessages[0].content).toEqual([{ type: 'text', text: '[REDACTED:EMAIL]' }]);
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).toContain('onDetect');
  });
});
