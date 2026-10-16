import { z } from 'zod';

// The pattern `validate` of uuid 9 used: versions 1 to 5 and the nil UUID, in any letter case
const UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;

export const UUID = z.string().refine((data) => UUID_PATTERN.test(data), {
  message: 'Invalid UUID' // Custom error message
});
