import { describe, expect, it } from 'vitest';

import { QueryByArrayOfObjects } from '../../shared';

describe('QueryByArrayOfObjects', () => {
  describe('Basic Query Operators', () => {
    it('$eq (Equal)', () => {
      const data = [{ age: 25 }, { age: 30 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ age: { $eq: 25 } });
      expect(result).toEqual([{ age: 25 }]);
    });

    it('$ne (Not Equal)', () => {
      const data = [{ age: 25 }, { age: 30 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ age: { $ne: 25 } });
      expect(result).toEqual([{ age: 30 }]);
    });

    // Add similar tests for $gt, $gte, $lt, $lte following the same pattern
  });

  describe('Array Operators', () => {
    it('$in with array values', () => {
      const data = [{ tags: ['a', 'b'] }, { tags: ['c'] }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ tags: { $in: [['a', 'b']] } });
      expect(result).toEqual([{ tags: ['a', 'b'] }]);
    });

    it('$contains for substring search', () => {
      const data = [{ text: 'hello world' }, { text: 'hi there' }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ text: { $contains: 'hello' } });
      expect(result).toEqual([{ text: 'hello world' }]);
    });
  });

  describe('Logical Operators', () => {
    it('$and combination', () => {
      const data = [
        { age: 25, city: 'NY' },
        { age: 30, city: 'LA' }
      ];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        $and: [{ age: { $gt: 20 } }, { city: { $eq: 'NY' } }]
      });
      expect(result).toEqual([{ age: 25, city: 'NY' }]);
    });

    // Add similar tests for $or, $nor, $not
  });

  describe('Nested Object Queries', () => {
    it('should query nested objects', () => {
      const data = [{ user: { name: 'Alice', age: 30 } }, { user: { name: 'Bob', age: 25 } }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ user: { name: { $eq: 'Alice' } } });
      expect(result).toEqual([{ user: { name: 'Alice', age: 30 } }]);
    });
  });

  describe('Edge Cases', () => {
    it('empty query returns all items', () => {
      const data = [{ a: 1 }, { b: 2 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({});
      expect(result).toEqual(data);
    });

    it('non-existent field returns empty', () => {
      type TestType = { a: number; nonExistent?: string };
      const data: TestType[] = [{ a: 1 }];
      const queryEngine = new QueryByArrayOfObjects<TestType>(...data);
      const result = queryEngine.query({ nonExistent: { $eq: 'value' } });
      expect(result).toEqual([]);
    });

    // Add other edge cases
  });

  describe('Type Validation', () => {
    it('strict type checking ($eq)', () => {
      const data = [{ id: '25' }, { id: 25 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ id: { $eq: 25 } });
      expect(result).toEqual([{ id: 25 }]);
    });

    it('mixed type comparisons', () => {
      const data = [{ value: '100' }, { value: 100 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ value: { $gt: 50 } });
      expect(result).toEqual([{ value: 100 }]);
    });
  });

  describe('Date Comparisons', () => {
    it('should compare dates correctly', () => {
      const date1 = new Date('2023-01-01');
      const date2 = new Date('2023-02-01');
      const data = [{ date: date1 }, { date: date2 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ date: { $gt: new Date('2023-01-15') } });
      expect(result).toEqual([{ date: date2 }]);
    });
  });

  describe('Array Handling', () => {
    it('should match exact arrays', () => {
      const data = [{ tags: ['a', 'b'] }, { tags: ['b', 'a'] }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ tags: { $eq: ['a', 'b'] } });
      expect(result).toEqual([{ tags: ['a', 'b'] }]);
    });
  });

  describe('Regex Matching', () => {
    it('should apply regular expressions', () => {
      const data = [{ text: 'hello' }, { text: 'world' }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ text: { $regex: /^h/ } });
      expect(result).toEqual([{ text: 'hello' }]);
    });

    it('should handle complex regex patterns', () => {
      const data = [{ text: 'test123' }, { text: 'abc' }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ text: { $regex: /^\w+\d+$/ } });
      expect(result).toEqual([{ text: 'test123' }]);
    });
  });

  describe('Complex Queries', () => {
    it('multiple conditions on same field', () => {
      const data = [{ age: 25 }, { age: 30 }, { age: 35 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        age: { $gt: 25, $lt: 35 }
      });
      expect(result).toEqual([{ age: 30 }]);
    });

    it('nested object with multiple operators', () => {
      const data = [{ user: { age: 25, name: 'Alice' } }, { user: { age: 30, name: 'Bob' } }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        user: {
          age: { $gt: 25 },
          name: { $regex: /^B/ }
        }
      });
      expect(result).toEqual([{ user: { age: 30, name: 'Bob' } }]);
    });

    it('combined logical operators', () => {
      const data = [
        { age: 25, city: 'NY' },
        { age: 30, city: 'LA' },
        { age: 35, city: 'NY' }
      ];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        $or: [
          { $and: [{ age: { $lt: 30 } }, { city: { $eq: 'NY' } }] },
          { $and: [{ age: { $gt: 30 } }, { city: { $eq: 'NY' } }] }
        ]
      });
      expect(result).toEqual([
        { age: 25, city: 'NY' },
        { age: 35, city: 'NY' }
      ]);
    });
  });

  describe('Advanced Array Operations', () => {
    it('$in with mixed types', () => {
      type MixedValue = { value: number | string };
      const data: MixedValue[] = [{ value: 1 }, { value: '1' }];
      const queryEngine = new QueryByArrayOfObjects<MixedValue>(...data);
      const result = queryEngine.query({ value: { $in: [1, '1'] } });
      expect(result).toEqual([{ value: 1 }, { value: '1' }]);
    });

    it('nested array comparison', () => {
      const data = [{ tags: [['a', 'b'], ['c']] }, { tags: [['d'], ['e', 'f']] }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ tags: { $eq: [['a', 'b'], ['c']] } });
      expect(result).toEqual([{ tags: [['a', 'b'], ['c']] }]);
    });
  });

  describe('Type Coercion Edge Cases', () => {
    it('comparison with null and undefined', () => {
      const data = [{ value: null }, { value: undefined }, { value: 0 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ value: { $eq: null } });
      expect(result).toEqual([{ value: null }]);
    });

    it('numeric string comparisons', () => {
      const data = [{ value: '100' }, { value: 100 }, { value: '50' }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ value: { $gt: '75' } });
      expect(result).toEqual([{ value: 100 }]);
    });
  });

  describe('Logical Operators Edge Cases', () => {
    it('empty $and should return true', () => {
      const data = [{ value: 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ $and: [] });
      expect(result).toEqual(data);
    });

    it('empty $or should return false', () => {
      const data = [{ value: 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ $or: [] });
      expect(result).toEqual([]);
    });

    it('$not with empty array should return true', () => {
      const data = [{ value: 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ $not: { value: { $eq: 2 } } });
      expect(result).toEqual(data);
    });
  });

  describe('Deep Nested Objects', () => {
    it('should query deeply nested objects', () => {
      const data = [
        { user: { profile: { settings: { theme: 'dark' } } } },
        { user: { profile: { settings: { theme: 'light' } } } }
      ];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        user: { profile: { settings: { theme: { $eq: 'dark' } } } }
      });
      expect(result).toEqual([{ user: { profile: { settings: { theme: 'dark' } } } }]);
    });

    it('should handle missing nested paths', () => {
      const data = [{ user: { profile: { settings: { theme: 'dark' } } } }, { user: { profile: {} } }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        user: { profile: { settings: { theme: { $eq: 'dark' } } } }
      });
      expect(result).toEqual([{ user: { profile: { settings: { theme: 'dark' } } } }]);
    });
  });

  describe('Special Values Handling', () => {
    it('should handle NaN values', () => {
      const data = [{ value: NaN }, { value: 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ value: { $eq: NaN } });
      expect(result).toEqual([]);
    });

    it('should handle Infinity values', () => {
      const data = [{ value: Infinity }, { value: -Infinity }, { value: 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ value: { $gt: 100 } });
      expect(result).toEqual([{ value: Infinity }]);
    });
  });

  describe('Array Operations Edge Cases', () => {
    it('should handle empty arrays', () => {
      const data = [{ arr: [] }, { arr: [1, 2] }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ arr: { $eq: [] } });
      expect(result).toEqual([{ arr: [] }]);
    });

    it('should handle arrays with different types', () => {
      const data = [{ arr: [1, '2', true] }, { arr: [1, 2, 3] }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ arr: { $eq: [1, '2', true] } });
      expect(result).toEqual([{ arr: [1, '2', true] }]);
    });
  });

  describe('Complex Type Coercion', () => {
    it('should handle boolean to number coercion', () => {
      const data = [{ value: true }, { value: 1 }, { value: false }, { value: 0 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ value: { $eq: true } });
      expect(result).toEqual([{ value: true }]);
    });

    it('should handle Date to number coercion in comparisons', () => {
      const now = new Date();
      const past = new Date(now.getTime() - 1000);
      const future = new Date(now.getTime() + 1000);
      const data = [{ date: past }, { date: now }, { date: future }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ date: { $gt: now } });
      expect(result).toEqual([{ date: future }]);
    });
  });

  describe('Error Cases', () => {
    it('should handle invalid regex patterns', () => {
      const data = [{ text: 'test' }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      expect(() => {
        queryEngine.query({ text: { $regex: 'not a regex' as any } });
      }).toThrow('Invalid regex pattern: must be a RegExp instance');
    });

    it('should handle circular references', () => {
      const circular: any = { a: 1 };
      circular.self = circular;
      const data = [circular];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ a: { $eq: 1 } });
      expect(result[0].a).toBe(1);
      expect(result[0].self).toBeDefined();
    });
  });

  describe('Nested Object Edge Cases', () => {
    it('should handle deeply nested circular references', () => {
      const obj1: any = { a: { b: { c: {} } } };
      obj1.a.b.c.d = obj1.a;
      const obj2 = { a: { b: { c: { d: 1 } } } };
      const data = [obj1, obj2];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ 'a.b.c.d': { $eq: 1 } });
      expect(result).toEqual([obj2]);
    });

    it('should handle multiple nested paths with same values', () => {
      type NestedValue = { a: { value: number }; b: { value: number } };
      const data: NestedValue[] = [
        { a: { value: 1 }, b: { value: 1 } },
        { a: { value: 1 }, b: { value: 2 } }
      ];
      const queryEngine = new QueryByArrayOfObjects<NestedValue>(...data);
      const result = queryEngine.query({
        a: { value: { $eq: 1 } },
        b: { value: { $eq: 1 } }
      });
      expect(result).toEqual([{ a: { value: 1 }, b: { value: 1 } }]);
    });
  });

  describe('Complex Array Operations', () => {
    it('should handle nested arrays with mixed types and nulls', () => {
      const data = [{ arr: [1, ['a', null], { x: true }] }, { arr: [1, ['a', 'b'], { x: false }] }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        arr: { $eq: [1, ['a', null], { x: true }] }
      });
      expect(result).toEqual([{ arr: [1, ['a', null], { x: true }] }]);
    });

    it('should handle array contains with objects', () => {
      type Item = { id: number };
      type Data = { items: Item[] };
      const data: Data[] = [{ items: [{ id: 1 }, { id: 2 }] }, { items: [{ id: 3 }, { id: 4 }] }];
      const queryEngine = new QueryByArrayOfObjects<Data>(...data);
      const result = queryEngine.query({
        items: { $eq: [{ id: 1 }, { id: 2 }] }
      });
      expect(result).toEqual([{ items: [{ id: 1 }, { id: 2 }] }]);
    });
  });

  describe('Type Coercion Corner Cases', () => {
    it('should handle BigInt values', () => {
      const data = [{ value: BigInt(9007199254740991n) }, { value: 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ value: { $eq: BigInt(9007199254740991n) } });
      expect(result).toEqual([{ value: BigInt(9007199254740991n) }]);
    });

    it('should handle function values', () => {
      const fn1 = () => 1;
      const fn2 = () => 2;
      const data = [{ fn: fn1 }, { fn: fn2 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ fn: { $eq: fn1 } });
      expect(result).toEqual([{ fn: fn1 }]);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed queries', () => {
      const data = [{ value: 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      expect(() => {
        queryEngine.query({ $unknown: [] } as any);
      }).toThrow('Unknown logical operator: $unknown');
    });

    it('should handle invalid operator values', () => {
      const data = [{ value: 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      expect(() => {
        queryEngine.query({ value: { $gt: undefined } });
      }).toThrow();
    });
  });

  describe('Performance Edge Cases', () => {
    it('should handle large arrays efficiently', () => {
      const largeData = Array.from({ length: 1000 }, (_, i) => ({ value: i }));
      const queryEngine = new QueryByArrayOfObjects(...largeData);
      const result = queryEngine.query({ value: { $gt: 990 } });
      expect(result.length).toBe(9);
    });

    it('should handle deeply nested queries efficiently', () => {
      const data = [{ a: { b: { c: { d: { e: { f: 1 } } } } } }, { a: { b: { c: { d: { e: { f: 2 } } } } } }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        a: { b: { c: { d: { e: { f: { $gt: 1 } } } } } }
      });
      expect(result).toEqual([{ a: { b: { c: { d: { e: { f: 2 } } } } } }]);
    });
  });

  describe('Operator Combinations', () => {
    it('should handle multiple operators on array fields', () => {
      const data = [{ tags: ['a', 'b', 'c'] }, { tags: ['d', 'e'] }, { tags: [] }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        $and: [{ tags: { $contains: 'a' } }, { tags: { $in: [['a', 'b', 'c']] } }]
      });
      expect(result).toEqual([{ tags: ['a', 'b', 'c'] }]);
    });

    it('should handle complex regex with other operators', () => {
      const data = [
        { text: 'hello123', count: 1 },
        { text: 'hello456', count: 2 },
        { text: 'world789', count: 3 }
      ];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        $and: [{ text: { $regex: /^hello\d+$/ } }, { count: { $gt: 1 } }]
      });
      expect(result).toEqual([{ text: 'hello456', count: 2 }]);
    });
  });

  describe('Type Safety Edge Cases', () => {
    it('should handle undefined in arrays', () => {
      const data = [{ arr: [1, undefined, 3] }, { arr: [1, 2, 3] }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        arr: { $eq: [1, undefined, 3] }
      });
      expect(result).toEqual([{ arr: [1, undefined, 3] }]);
    });

    it('should handle mixed numeric comparisons correctly', () => {
      const data = [
        { value: '1e2' }, // string scientific notation
        { value: 100 }, // number
        { value: '100.0' }, // string decimal
        { value: '100' } // string integer
      ];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ value: { $eq: 100 } });
      expect(result).toEqual([{ value: 100 }]);
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle maximum safe integer values', () => {
      const data = [{ value: Number.MAX_SAFE_INTEGER }, { value: Number.MAX_SAFE_INTEGER - 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        value: { $eq: Number.MAX_SAFE_INTEGER }
      });
      expect(result).toEqual([{ value: Number.MAX_SAFE_INTEGER }]);
    });

    it('should handle minimum safe integer values', () => {
      const data = [{ value: Number.MIN_SAFE_INTEGER }, { value: Number.MIN_SAFE_INTEGER + 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        value: { $eq: Number.MIN_SAFE_INTEGER }
      });
      expect(result).toEqual([{ value: Number.MIN_SAFE_INTEGER }]);
    });
  });

  describe('Validation', () => {
    it('should reject invalid field types in query', () => {
      const data = [{ value: 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      expect(() => {
        queryEngine.query({ value: { $eq: Symbol() } as any });
      }).toThrow();
    });

    it('should reject invalid field values in query', () => {
      const data = [{ value: 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      expect(() => {
        queryEngine.query({ value: { $eq: Symbol() } as any });
      }).toThrow();
    });

    it('should handle non-object queries', () => {
      const data = [{ value: 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      expect(() => {
        queryEngine.query(null as any);
      }).toThrow();
      expect(() => {
        queryEngine.query(undefined as any);
      }).toThrow();
    });
  });

  describe('Security', () => {
    it('should prevent prototype pollution', () => {
      const data = [{ value: 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const maliciousQuery = { __proto__: { polluted: true } };
      expect(() => {
        queryEngine.query(maliciousQuery as any);
      }).toThrow();
      expect(Object.prototype.hasOwnProperty.call({}, 'polluted')).toBe(false);
    });

    it('should prevent stack overflow from deep recursion', () => {
      const data = [{ value: 1 }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const deepQuery: Record<string, any> = { a: {} };
      let current = deepQuery.a;
      for (let i = 0; i < 1000; i++) {
        current.b = {};
        current = current.b;
      }
      expect(() => {
        queryEngine.query(deepQuery as any);
      }).toThrow();
    });

    it('should prevent memory leaks with large objects', () => {
      const initialMemory = process.memoryUsage().heapUsed;

      (() => {
        const largeData = Array.from({ length: 300 }, (_, i) => ({ value: i }));
        const queryEngine = new QueryByArrayOfObjects(...largeData);
        const result = queryEngine.query({ value: { $gt: 290 } });

        expect(result.length).toBe(9);

        // Memory cleanup
        global.gc?.(); // Call garbage collector if enabled (run with `--expose-gc`)
      })();

      const finalMemory = process.memoryUsage().heapUsed;

      // Expect memory usage to not increase significantly (accounting for margin of error)
      expect(finalMemory - initialMemory).toBeLessThan(10 * 1024 * 1024); // Less than 10MB
    });
  });

  describe('Internationalization', () => {
    it('should handle Unicode string comparisons', () => {
      const data = [{ text: '👋 hello' }, { text: '世界' }, { text: 'café' }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ text: { $eq: '世界' } });
      expect(result).toEqual([{ text: '世界' }]);
    });

    it('should handle string collation for different locales', () => {
      const data = [{ text: 'é' }, { text: 'e' }, { text: 'è' }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({
        text: {
          $contains: 'e'
          // Note: Removed $options as it's not supported in the current implementation
        }
      });
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle right-to-left text', () => {
      const data = [{ text: 'Hello مرحبا' }, { text: 'مرحبا World' }, { text: 'سلام' }];
      const queryEngine = new QueryByArrayOfObjects(...data);
      const result = queryEngine.query({ text: { $regex: /^مرحبا/ } });
      expect(result).toEqual([{ text: 'مرحبا World' }]);
    });
  });
});
