import { describe, expect, it } from 'vitest';

import { createDeepImmutableProxy } from '../../shared/utils';

describe('createDeepImmutableProxy', () => {
  // Testing simple objects
  it('should create an immutable proxy for a simple object', () => {
    const original = { name: 'Test', value: 42 };
    const proxy = createDeepImmutableProxy(original);

    // Check that we can read properties
    expect(proxy.name).toBe('Test');
    expect(proxy.value).toBe(42);

    // Check that we cannot modify properties
    expect(() => {
      (proxy as any).name = 'New Name';
    }).toThrow();

    // Check that we cannot add new properties
    expect(() => {
      (proxy as any).newProp = 'new';
    }).toThrow();

    // Check that we cannot delete properties
    expect(() => {
      delete (proxy as any).name;
    }).toThrow();
  });

  // Testing nested objects
  it('should recursively protect nested objects', () => {
    const original = {
      user: {
        profile: {
          name: 'Test',
          settings: { theme: 'dark' }
        }
      }
    };
    const proxy = createDeepImmutableProxy(original);

    // Check access to nested properties
    expect(proxy.user.profile.name).toBe('Test');
    expect(proxy.user.profile.settings.theme).toBe('dark');

    // Check that we cannot modify nested objects
    expect(() => {
      (proxy as any).user.profile.name = 'New Name';
    }).toThrow();

    expect(() => {
      (proxy as any).user.profile.settings.theme = 'light';
    }).toThrow();
  });

  // Testing arrays
  it('should protect arrays and their elements', () => {
    const original = {
      items: [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' }
      ]
    };
    const proxy = createDeepImmutableProxy(original);

    // Check access to array elements
    expect(proxy.items[0].name).toBe('Item 1');

    // Check that we cannot modify the array
    expect(() => {
      proxy.items.push({ id: 3, name: 'Item 3' });
    }).toThrow();

    expect(() => {
      proxy.items[0].name = 'Modified';
    }).toThrow();
  });

  // Testing functions
  it('should handle functions correctly', () => {
    const original = {
      arrowFn: () => 'arrow',
      regularMethod() {
        return 'method';
      }
    };
    const proxy = createDeepImmutableProxy(original);

    // Arrow functions should work
    expect(proxy.arrowFn()).toBe('arrow');

    // Regular methods should be blocked
    expect(() => {
      proxy.regularMethod();
    }).toThrow();
  });

  // Testing Symbol properties
  it('should handle Symbol properties correctly', () => {
    const testSymbol = Symbol('test');
    const methodSymbol = Symbol('method');

    class TestClass {
      private [testSymbol] = 'symbol value';
      [methodSymbol]() {
        return this[testSymbol];
      }
    }

    const instance = new TestClass();
    const proxy = createDeepImmutableProxy(instance);

    // Symbol methods should work
    expect(proxy[methodSymbol]()).toBe('symbol value');
  });

  // Testing circular references
  it('should handle circular references correctly', () => {
    const original: any = { name: 'Cycle' };
    original.self = original;

    const proxy = createDeepImmutableProxy(original);

    // Check that proxy is created successfully
    expect(proxy.name).toBe('Cycle');
    expect(proxy.self).toBeDefined();
    expect(proxy.self.name).toBe('Cycle');

    // Check that modification protection works
    expect(() => {
      proxy.self.name = 'New Name';
    }).toThrow();
  });

  // Testing special case for getTest
  it('should return undefined for getTest method', () => {
    const original = {
      getTest: () => 'test result'
    };
    const proxy = createDeepImmutableProxy(original);

    expect(proxy.getTest()).toBeUndefined();
  });

  // Testing constructor
  it('should preserve constructor access', () => {
    class TestClass {
      prop = 'value';
    }

    const instance = new TestClass();
    const proxy = createDeepImmutableProxy(instance);

    expect(proxy.constructor).toBe(TestClass);
  });

  // Testing primitive values
  it('should handle primitive values correctly', () => {
    const primitives = {
      nullValue: null,
      undefinedValue: undefined,
      numberValue: 42,
      stringValue: 'test',
      booleanValue: true
    };
    const proxy = createDeepImmutableProxy(primitives);

    expect(proxy.nullValue).toBeNull();
    expect(proxy.undefinedValue).toBeUndefined();
    expect(proxy.numberValue).toBe(42);
    expect(proxy.stringValue).toBe('test');
    expect(proxy.booleanValue).toBe(true);
  });

  // Testing Date objects
  it('should handle Date objects correctly', () => {
    const original = {
      date: new Date('2024-03-20')
    };
    const proxy = createDeepImmutableProxy(original);

    expect(proxy.date instanceof Date).toBe(true);
    expect(proxy.date.getTime()).toBe(original.date.getTime());

    expect(() => {
      proxy.date.setFullYear(2025);
    }).toThrow();
  });

  // Testing Map and Set
  it('should handle Map and Set correctly', () => {
    const original = {
      map: new Map([['key', 'value']]),
      set: new Set(['item'])
    };
    const proxy = createDeepImmutableProxy(original);

    expect(proxy.map.get('key')).toBe('value');
    expect(proxy.set.has('item')).toBe(true);

    expect(() => {
      proxy.map.set('newKey', 'newValue');
    }).toThrow();

    expect(() => {
      proxy.set.add('newItem');
    }).toThrow();
  });

  // Testing prototype chain
  it('should preserve prototype chain and methods', () => {
    class Parent {
      parentMethod() {
        return 'parent';
      }
    }

    class Child extends Parent {
      childMethod() {
        return 'child';
      }
    }

    const instance = new Child();
    const proxy = createDeepImmutableProxy(instance);

    expect(proxy instanceof Child).toBe(true);
    expect(proxy instanceof Parent).toBe(true);
    expect(() => proxy.parentMethod()).toThrow();
    expect(() => proxy.childMethod()).toThrow();
  });

  // Testing properties with getter/setter
  it('should handle properties with getters and setters', () => {
    const original = {
      _value: 42,
      get value() {
        return this._value;
      },
      set value(v) {
        this._value = v;
      }
    };
    const proxy = createDeepImmutableProxy(original);

    expect(proxy.value).toBe(42);
    expect(() => {
      proxy.value = 100;
    }).toThrow();
  });

  // Testing arrays with different methods
  it('should handle array methods correctly', () => {
    const original = {
      array: [1, 2, 3]
    };
    const proxy = createDeepImmutableProxy(original);

    // Non-mutating methods should work
    expect(proxy.array.map((x) => x * 2)).toEqual([2, 4, 6]);
    expect(proxy.array.filter((x) => x > 1)).toEqual([2, 3]);
    expect(proxy.array.slice(1)).toEqual([2, 3]);

    // Mutating methods should be blocked
    expect(() => proxy.array.sort()).toThrow();
    expect(() => proxy.array.reverse()).toThrow();
    expect(() => proxy.array.splice(0, 1)).toThrow();
    expect(() => proxy.array.fill(0)).toThrow();
  });

  // Testing nested Map/Set
  it('should handle nested Maps and Sets', () => {
    const original = {
      data: new Map<string, Set<number> | Map<string, string>>([
        ['key1', new Set([1, 2, 3])],
        ['key2', new Map([['nested', 'value']])]
      ])
    };
    const proxy = createDeepImmutableProxy(original);

    const set = proxy.data.get('key1');
    const map = proxy.data.get('key2');
    expect(set instanceof Set && set.has(2)).toBe(true);
    expect(map instanceof Map && map.get('nested')).toBe('value');

    expect(() => {
      const s = proxy.data.get('key1');
      if (s instanceof Set) s.add(4);
    }).toThrow();
    expect(() => {
      const m = proxy.data.get('key2');
      if (m instanceof Map) m.set('new', 'value');
    }).toThrow();
  });

  // Testing defineProperty
  it('should prevent Object.defineProperty usage', () => {
    const original = { prop: 'value' };
    const proxy = createDeepImmutableProxy(original);

    expect(() => {
      Object.defineProperty(proxy, 'newProp', {
        value: 'new',
        writable: true
      });
    }).toThrow();
  });

  // Testing Object.freeze compatibility
  it('should be compatible with Object.freeze', () => {
    const original = { prop: 'value' };
    const proxy = createDeepImmutableProxy(original);

    expect(() => {
      Object.freeze(proxy);
    }).not.toThrow();

    expect(Object.isFrozen(proxy)).toBe(true);
  });

  // Testing returning complex objects from methods
  it('should handle complex objects returned from methods', () => {
    const original = {
      [Symbol('method')]() {
        return { nested: { value: 42 } };
      }
    };
    const proxy = createDeepImmutableProxy(original);

    const result = proxy[Symbol('method')]();
    expect(result.nested.value).toBe(42);
    expect(() => {
      result.nested.value = 100;
    }).toThrow();
  });

  // Testing error handling
  it('should preserve error objects', () => {
    const original = {
      error: new Error('test error'),
      throwError: () => {
        throw new Error('thrown error');
      }
    };
    const proxy = createDeepImmutableProxy(original);

    expect(proxy.error.message).toBe('test error');
    expect(() => proxy.throwError()).toThrow('thrown error');
  });

  // Testing properties with descriptors
  it('should handle property descriptors correctly', () => {
    const original = {};
    Object.defineProperty(original, 'readOnly', {
      value: 'constant',
      writable: false,
      configurable: false
    });
    const proxy = createDeepImmutableProxy(original);

    const descriptor = Object.getOwnPropertyDescriptor(proxy, 'readOnly');
    expect(descriptor?.writable).toBe(false);
    expect(descriptor?.configurable).toBe(false);
  });

  // Testing prototype pollution
  it('should prevent prototype pollution attempts', () => {
    const original = {};
    const proxy = createDeepImmutableProxy(original);

    expect(() => {
      (proxy as any).__proto__ = { malicious: true };
    }).toThrow();

    expect(() => {
      (proxy as any).constructor = { malicious: true };
    }).toThrow();

    expect(() => {
      (proxy as any).prototype = { malicious: true };
    }).toThrow();
  });

  // Testing modification attempts through Object.assign
  it('should prevent modifications via Object.assign', () => {
    const original = { prop: 'value' };
    const proxy = createDeepImmutableProxy(original);

    expect(() => {
      Object.assign(proxy, { newProp: 'new' });
    }).toThrow();
  });

  // Testing behavior with Proxy.revocable
  it('should work correctly with Proxy.revocable', () => {
    const original = { prop: 'value' };
    const proxy = createDeepImmutableProxy(original);

    expect(() => {
      const { proxy: revocable } = Proxy.revocable(proxy, {});
      expect(revocable.prop).toBe('value');
    }).not.toThrow();
  });

  // Testing behavior with WeakRef
  it('should handle WeakRef correctly', () => {
    const original = { prop: 'value' };
    const weakRef = new WeakRef(original);
    const proxy = createDeepImmutableProxy({ ref: weakRef });

    expect(proxy.ref).toBeInstanceOf(WeakRef);
    expect(proxy.ref.deref()).toBe(original);
  });

  // Testing behavior with reflection methods
  it('should handle reflection methods correctly', () => {
    const original = { prop: 'value' };
    const proxy = createDeepImmutableProxy(original);

    expect(Reflect.get(proxy, 'prop')).toBe('value');
    expect(() => Reflect.set(proxy, 'prop', 'new')).toThrow();
    expect(() => Reflect.deleteProperty(proxy, 'prop')).toThrow();
  });

  // Testing behavior with Symbol.iterator
  it('should handle Symbol.iterator correctly', () => {
    const original = {
      *[Symbol.iterator]() {
        yield 1;
        yield 2;
      }
    };
    const proxy = createDeepImmutableProxy(original);

    expect([...proxy]).toEqual([1, 2]);
  });

  // Testing behavior with Promise
  it('should handle Promise correctly', async () => {
    const original = {
      promise: Promise.resolve({ data: 'value' })
    };
    const proxy = createDeepImmutableProxy(original);

    const result = await proxy.promise;
    expect(result.data).toBe('value');
    expect(() => {
      result.data = 'new';
    }).toThrow();
  });

  // Testing behavior with TypedArray
  it('should handle TypedArrays correctly', () => {
    const original = {
      array: new Uint8Array([1, 2, 3])
    };
    const proxy = createDeepImmutableProxy(original);

    expect(proxy.array instanceof Uint8Array).toBe(true);
    expect(() => {
      proxy.array[0] = 4;
    }).toThrow();
  });

  // Testing behavior with BigInt
  it('should handle BigInt correctly', () => {
    const original = {
      bigInt: BigInt('9007199254740991')
    };
    const proxy = createDeepImmutableProxy(original);

    expect(proxy.bigInt).toBe(BigInt('9007199254740991'));
  });

  // Testing behavior with SharedArrayBuffer
  it('should handle SharedArrayBuffer correctly', () => {
    const original = {
      buffer: new SharedArrayBuffer(4)
    };
    const proxy = createDeepImmutableProxy(original);

    expect(proxy.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(proxy.buffer.byteLength).toBe(4);
  });

  // Testing behavior with Promise chain
  it('should handle Promise chain correctly', async () => {
    const original = {
      promise: Promise.resolve({ data: 'value' }).then((result) => ({ ...result, extra: 'data' }))
    };
    const proxy = createDeepImmutableProxy(original);

    const result = await proxy.promise;
    expect(result.data).toBe('value');
    expect(result.extra).toBe('data');
    expect(() => {
      result.extra = 'modified';
    }).toThrow();
  });

  // Testing behavior with async/await functions
  it('should handle async functions correctly', async () => {
    const original = {
      async asyncMethod() {
        return { data: 'async result' };
      }
    };
    const proxy = createDeepImmutableProxy(original);

    const result = await proxy.asyncMethod();
    expect(result.data).toBe('async result');
    expect(() => {
      result.data = 'modified';
    }).toThrow();
  });

  // Testing behavior with nested proxies
  it('should handle nested proxies correctly', () => {
    const inner = createDeepImmutableProxy({ value: 42 });
    const outer = createDeepImmutableProxy({ nested: inner });

    expect(outer.nested.value).toBe(42);
    expect(() => {
      outer.nested.value = 100;
    }).toThrow();
  });

  // Testing behavior with methods that return this
  it('should handle methods returning this', () => {
    class ChainableClass {
      value = 0;
      increment() {
        this.value++;
        return this;
      }
    }
    const proxy = createDeepImmutableProxy(new ChainableClass());

    expect(() => {
      proxy.increment();
    }).toThrow();
  });

  // Testing behavior with Object.create(null)
  it('should handle objects without prototype', () => {
    const original = Object.create(null);
    original.prop = 'value';
    const proxy = createDeepImmutableProxy(original);

    expect(proxy.prop).toBe('value');
    expect(() => {
      proxy.prop = 'new';
    }).toThrow();
  });

  // Testing behavior with methods that return primitives
  it('should handle methods returning primitives', () => {
    const original = {
      toString() {
        return 'custom string';
      },
      valueOf() {
        return 42;
      }
    };
    const proxy = createDeepImmutableProxy(original);

    expect(() => proxy.toString()).toThrow();
    expect(() => proxy.valueOf()).toThrow();
  });

  // Testing behavior with [native code] methods
  it('should allow native code methods', () => {
    const original = {
      regex: /test/,
      date: new Date()
    };
    const proxy = createDeepImmutableProxy(original);

    expect(() => proxy.regex.test('test')).not.toThrow();
    expect(() => proxy.date.getTime()).not.toThrow();
  });

  // Testing behavior with defineProperty for freeze-like changes
  it('should allow freeze-like defineProperty changes', () => {
    const original = { prop: 'value' };
    const proxy = createDeepImmutableProxy(original);

    expect(() => {
      Object.defineProperty(proxy, 'prop', {
        value: 'value',
        writable: false,
        configurable: false
      });
    }).not.toThrow();
  });

  // Testing behavior with proxy for Promise methods
  it('should handle Promise methods correctly', async () => {
    const original = {
      promise: Promise.resolve(42)
        .then((x) => x * 2)
        .catch(() => 0)
        .finally(() => {})
    };
    const proxy = createDeepImmutableProxy(original);

    const result = await proxy.promise;
    expect(result).toBe(84);
  });
});
