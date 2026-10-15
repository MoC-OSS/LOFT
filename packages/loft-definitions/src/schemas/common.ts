import { validate as uuidValidate } from 'uuid';
import { z } from 'zod';

export const UUID = z.string().refine((data) => uuidValidate(data), {
  message: 'Invalid UUID' // Custom error message
});
