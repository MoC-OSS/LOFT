/**
 * What a log may say about a failed provider request: the error's class, HTTP status, `type` and `code`. The message
 * and body are left out, as they can quote the provider's output.
 */
export function providerErrorSummary(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return { name: typeof error };
  const { status, type, code } = error as { status?: unknown; type?: unknown; code?: unknown };
  // The OpenAI and Anthropic SDKs' errors keep the name 'Error', so the class name tells them apart
  return { name: (error as { constructor?: { name?: unknown } }).constructor?.name, status, type, code };
}
