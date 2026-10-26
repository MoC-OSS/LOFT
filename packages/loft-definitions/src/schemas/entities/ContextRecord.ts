// import { ZodType, z } from 'zod';

import { z, ZodType } from 'zod';

// Any JSON value: ctx is stored as JSON, so lists and null are as valid as strings, numbers and objects
export const RecursiveValue: ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(RecursiveValue),
    z.record(z.string(), RecursiveValue)
  ])
);

export const Record: ZodType<Record<string, any>> = z.record(z.string(), RecursiveValue);

export const ContextRecord = z.custom<Record<string, any>>(
  (data) => {
    // Check if data is an object
    if (typeof data !== 'object' || data === null) {
      return false;
    }

    const validationResult = Record.safeParse(data);

    return validationResult.success;
  },
  {
    // Validator settings
    message: 'Expected an unknown object (empty or with properties)'
  }
);
