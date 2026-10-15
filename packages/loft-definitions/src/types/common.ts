import { z } from 'zod';

import { Schema } from '..';

export type UUID = z.infer<typeof Schema.UUID>;
export type Insertable<T, K extends keyof T = never> = Omit<T, K | 'id' | 'sequenceId' | 'createdAt' | 'updatedAt'>;
export type Updatable<T, K extends keyof T = never> = Partial<Omit<T, K | 'id'>>;
