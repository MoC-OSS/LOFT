import { Logger } from '../../shared/components/Logger';

/**
 * This module simulates an external file that creates its own Logger instance.
 * Used to test that Logger.configure() affects all Logger instances globally,
 * even those created in different modules/files.
 */
export const externalLogger = new Logger('ExternalModule');

export function logFromExternalModule(message: string): void {
  externalLogger.info(message);
}
