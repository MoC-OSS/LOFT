/**
 * Creates a context proxy that overrides specific properties
 * while preserving all other properties and operations on the original context.
 * This is useful for injecting wrapped services (like tracer) into contexts
 * without mutating the original context object.
 */
export function createContextProxyWithOverrides<T extends Record<string, any>>(context: T, overrides: Partial<T>): T {
  const overrideKeys = new Set(Object.keys(overrides));

  return new Proxy(context, {
    get(target, prop, receiver) {
      if (overrideKeys.has(prop as string)) {
        return overrides[prop as keyof T];
      }
      return Reflect.get(target, prop, receiver);
    },

    set(target, prop, value, receiver) {
      if (overrideKeys.has(prop as string)) {
        // Silently ignore attempts to change overridden properties
        return true;
      }
      // All other changes go to original context
      return Reflect.set(target, prop, value, receiver);
    },

    has(target, prop) {
      return Reflect.has(target, prop);
    },

    deleteProperty(target, prop) {
      if (overrideKeys.has(prop as string)) {
        // Cannot delete overridden properties
        return false;
      }
      return Reflect.deleteProperty(target, prop);
    }
  }) as T;
}
