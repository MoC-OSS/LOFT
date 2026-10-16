import { randomUUID } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import { UUID } from '../../schemas/common';

// The cases `validate` of uuid 9 accepted and rejected, kept after the uuid package was dropped
describe('UUID', () => {
  test.each([
    ['a v4 UUID', 'f47ac10b-58cc-4372-a567-0e02b2c3d479'],
    ['a v1 UUID', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'],
    ['a v5 UUID', '886313e1-3b8a-5372-9b90-0c9aee199e5d'],
    ['an upper case UUID', 'F47AC10B-58CC-4372-A567-0E02B2C3D479'],
    ['the nil UUID', '00000000-0000-0000-0000-000000000000'],
    ['a UUID from randomUUID', randomUUID()]
  ])('accepts %s', (_, value) => {
    expect(UUID.safeParse(value).success).toBe(true);
  });

  test.each([
    ['a v6 UUID', '1ef21d2f-1207-6660-8c4f-419efbd44d48'],
    ['a v7 UUID', '01890a5d-ac96-774b-bcce-b302099a8057'],
    ['the max UUID', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
    ['a variant outside RFC 4122', 'f47ac10b-58cc-4372-c567-0e02b2c3d479'],
    ['a UUID without dashes', 'f47ac10b58cc4372a5670e02b2c3d479'],
    ['a UUID in braces', '{f47ac10b-58cc-4372-a567-0e02b2c3d479}'],
    ['a UUID with spaces around it', ' f47ac10b-58cc-4372-a567-0e02b2c3d479 '],
    ['an empty string', '']
  ])('rejects %s', (_, value) => {
    expect(UUID.safeParse(value).success).toBe(false);
  });
});
