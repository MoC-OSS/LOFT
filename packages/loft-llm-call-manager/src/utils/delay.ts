import { waitForRetry } from '@moc-global/loft-definitions';

/** Waits `ms`. With a `signal`, an abort ends the wait at once: it clears the timer and rejects with the reason. */
export const delay = (ms: number, signal?: AbortSignal): Promise<void> => waitForRetry(ms, signal);
