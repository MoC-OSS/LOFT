import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { Logger } from '../../shared';
import { deepMerge } from '../../shared/utils';

const log = new Logger('DEEP_MERGE_TEST');

describe('deepMerge', () => {
  let seen: WeakMap<object, any>;
  let warnSpy: any;

  beforeEach(() => {
    seen = new WeakMap();
    warnSpy = vi.spyOn(log, 'warn');
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('primitive values', () => {
    test('should merge simple objects with primitive values', () => {
      const target = { a: 1, b: 'hello' };
      const source = { b: 'world', c: true };
      expect(deepMerge(target, source, log, seen)).toEqual({ a: 1, b: 'world', c: true });
    });

    test('should handle null and undefined values', () => {
      const target = { a: null, b: undefined, c: 1 };
      const source = { a: 1, b: 2, d: null };
      expect(deepMerge(target, source, log, seen)).toEqual({ a: 1, b: 2, c: 1, d: null });
    });
  });

  describe('arrays', () => {
    test('should replace arrays instead of merging them', () => {
      const target = { arr: [1, 2, 3] };
      const source = { arr: [4, 5] };
      expect(deepMerge(target, source, log, seen)).toEqual({ arr: [4, 5] });
    });

    test('should handle nested arrays', () => {
      const target = { arr: [1, [2, 3]] };
      const source = { arr: [4, [5, 6]] };
      expect(deepMerge(target, source, log, seen)).toEqual({ arr: [4, [5, 6]] });
    });
  });

  describe('nested objects', () => {
    test('should deep merge nested objects', () => {
      const target = {
        nested: {
          a: 1,
          b: { x: 1, y: 2 }
        }
      };
      const source = {
        nested: {
          b: { y: 3, z: 4 },
          c: 5
        }
      };
      expect(deepMerge(target, source, log, seen)).toEqual({
        nested: {
          a: 1,
          b: { x: 1, y: 3, z: 4 },
          c: 5
        }
      });
    });

    test('should handle deeply nested objects', () => {
      const target = {
        level1: {
          level2: {
            level3: {
              a: 1,
              b: 2
            }
          }
        }
      };
      const source = {
        level1: {
          level2: {
            level3: {
              b: 3,
              c: 4
            }
          }
        }
      };
      expect(deepMerge(target, source, log, seen)).toEqual({
        level1: {
          level2: {
            level3: {
              a: 1,
              b: 3,
              c: 4
            }
          }
        }
      });
    });

    test('should handle nested objects with special types', () => {
      const target = {
        nested: {
          date: new Date('2023-01-01'),
          obj: {
            fn: () => 'test1',
            deep: {
              regex: /test1/,
              map: new Map([['a', 1]]),
              normal: { x: 1 }
            }
          }
        }
      };

      const source = {
        nested: {
          date: new Date('2024-01-01'),
          obj: {
            fn: () => 'test2',
            deep: {
              regex: /test2/,
              map: new Map([['b', 2]]),
              normal: { y: 2 }
            }
          }
        }
      };

      const result = deepMerge(target, source, log, seen);
      const typedResult = result as typeof target;

      // Check date separately
      expect(typedResult.nested.date).toBeInstanceOf(Date);
      expect(typedResult.nested.date).toEqual(new Date('2024-01-01'));

      // Check that special types are removed
      expect(typedResult.nested.obj.fn).toBeUndefined();
      expect(typedResult.nested.obj.deep.regex).toBeUndefined();
      expect(typedResult.nested.obj.deep.map).toBeUndefined();

      // Check that regular objects are merged correctly
      expect(typedResult.nested.obj.deep.normal).toEqual({ x: 1, y: 2 });
    });

    test('should handle arrays with nested objects and special types', () => {
      const target = {
        items: [
          { id: 1, date: new Date('2023-01-01') },
          { id: 2, fn: () => 'test1', obj: { x: 1 } }
        ]
      };

      const source = {
        items: [
          { id: 1, date: new Date('2024-01-01') },
          { id: 2, fn: () => 'test2', obj: { y: 2 } }
        ]
      };

      const result = deepMerge(target, source, log, seen);
      const resultItems = result.items as typeof source.items;

      // Check date separately
      const dateValue = resultItems[0]?.date as Date;
      expect(dateValue).toBeInstanceOf(Date);
      expect(dateValue).toEqual(new Date('2024-01-01'));

      // Check the rest of the first item structure
      expect(resultItems[0].id).toBe(1);

      // Check the second item
      expect(resultItems[1]).toEqual({
        id: 2,
        obj: { y: 2 }
      });

      // Check that function is removed
      expect('fn' in resultItems[1]).toBe(false);
    });

    test('should handle deeply nested objects with mixed types', () => {
      const target = {
        level1: {
          a: new Date('2023-01-01'),
          level2: {
            b: { x: 1 },
            level3: {
              c: new Map([['a', 1]]),
              d: { y: 2 }
            }
          }
        }
      };

      const source = {
        level1: {
          a: new Date('2024-01-01'),
          level2: {
            b: { z: 3 },
            level3: {
              c: new Map([['b', 2]]),
              d: { w: 4 }
            }
          }
        }
      };

      const result = deepMerge(target, source, log, seen);
      const typedResult = result as typeof target;

      // Check structure separately
      expect(typedResult.level1.level2).toEqual({
        b: { x: 1, z: 3 },
        level3: {
          d: { y: 2, w: 4 }
        }
      });

      // Check date separately
      expect(typedResult.level1.a).toBeInstanceOf(Date);
      expect(typedResult.level1.a).toEqual(new Date('2024-01-01'));
    });
  });

  describe('mixed types', () => {
    test('should handle object replacing primitive', () => {
      const target = { a: 1 };
      const source = { a: { nested: 2 } };
      expect(deepMerge(target, source, log, seen)).toEqual({ a: { nested: 2 } });
    });

    test('should handle primitive replacing object', () => {
      const target = { a: { nested: 2 } };
      const source = { a: 1 };
      expect(deepMerge(target, source, log, seen)).toEqual({ a: 1 });
    });

    test('should handle mixed nested structures', () => {
      const target = {
        a: 1,
        b: { x: 1, y: [1, 2] },
        c: [3, 4],
        d: { z: { deep: true } }
      };
      const source = {
        a: { nested: 2 },
        b: { y: [3], z: 5 },
        c: null,
        d: { z: { deep: false, more: 1 } }
      };
      expect(deepMerge(target, source, log, seen)).toEqual({
        a: { nested: 2 },
        b: { x: 1, y: [3], z: 5 },
        c: null,
        d: { z: { deep: false, more: 1 } }
      });
    });
  });

  describe('special types handling', () => {
    test('should preserve Date objects', () => {
      const date1 = new Date('2023-01-01');
      const date2 = new Date('2024-01-01');
      const target = { date: date1 };
      const source = { date: date2 };
      const result = deepMerge(target, source, log, seen);
      expect(result.date).toBeInstanceOf(Date);
      expect(result.date).toEqual(date2);
    });

    test('should ignore RegExp with warning', () => {
      const target = { regex: /test1/ };
      const source = { regex: /test2/ };
      const result = deepMerge(target, source, log, seen);
      expect(result.regex).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });

    test('should ignore functions with warning', () => {
      const target = { fn: () => 'test1' };
      const source = { fn: () => 'test2' };
      const result = deepMerge(target, source, log, seen);
      expect(result.fn).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });

    test('should ignore symbols with warning', () => {
      const target = { sym: Symbol('test1') };
      const source = { sym: Symbol('test2') };
      const result = deepMerge(target, source, log, seen);
      expect(result.sym).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });

    test('should ignore Map and Set with warning', () => {
      const target = {
        map: new Map([['a', 1]]),
        set: new Set([1, 2])
      };
      const source = {
        map: new Map([['b', 2]]),
        set: new Set([3, 4])
      };
      const result = deepMerge(target, source, log, seen);
      expect(result.map).toBeUndefined();
      expect(result.set).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe('error cases', () => {
    test('should handle circular references', () => {
      const target: any = { a: 1 };
      target.self = target;

      const source: any = { b: 2 };
      source.self = source;

      const result = deepMerge(target, source, log, seen);
      expect(result.a).toBe(1);
      expect(result.b).toBe(2);
      expect(result.self).toBe(result);
    });

    test('should handle invalid inputs', () => {
      const target = { a: 1 };

      expect(() => deepMerge(target, null as any, log, seen)).toThrow();
      expect(() => deepMerge(null as any, target, log, seen)).toThrow();
      expect(() => deepMerge(undefined as any, undefined as any, log, seen)).toThrow();
    });

    test('should handle prototype pollution attempts', () => {
      const target = { a: 1 };
      const source = { __proto__: { malicious: true } };
      const result = deepMerge(target, source, log, seen);
      expect(result.a).toBe(1);
      expect(({} as any).malicious).toBeUndefined();
    });
  });

  describe('JSON compatibility', () => {
    test('should produce JSON-serializable result', () => {
      const target = {
        date: new Date('2023-01-01'),
        regex: /test/,
        map: new Map([['a', 1]]),
        set: new Set([1, 2]),
        fn: () => 'test',
        symbol: Symbol('test'),
        normal: {
          number: 42,
          string: 'hello',
          bool: true,
          null: null,
          array: [1, 2, 3]
        }
      };

      const source = {
        newDate: new Date('2024-01-01'),
        newRegex: /test2/,
        newMap: new Map([['b', 2]]),
        newSet: new Set([3, 4]),
        newFn: () => 'test2',
        newSymbol: Symbol('test2'),
        normal: {
          number: 43,
          newString: 'world'
        }
      };

      const result = deepMerge(target, source, log, seen);

      // Should not throw
      expect(() => JSON.stringify(result)).not.toThrow();

      // Check that dates remain Date objects
      expect(result.date).toBeInstanceOf(Date);
      expect(result.date).toEqual(new Date('2023-01-01'));
      expect(result.newDate).toBeInstanceOf(Date);
      expect(result.newDate).toEqual(new Date('2024-01-01'));

      // Check that non-JSON values are removed
      expect(result.regex).toBeUndefined();
      expect(result.newRegex).toBeUndefined();
      expect(result.map).toBeUndefined();
      expect(result.newMap).toBeUndefined();
      expect(result.set).toBeUndefined();
      expect(result.newSet).toBeUndefined();
      expect(result.fn).toBeUndefined();
      expect(result.newFn).toBeUndefined();
      expect(result.symbol).toBeUndefined();
      expect(result.newSymbol).toBeUndefined();

      // Check that normal values are preserved
      expect(result.normal).toEqual({
        number: 43,
        string: 'hello',
        bool: true,
        null: null,
        array: [1, 2, 3],
        newString: 'world'
      });
    });
  });
});
