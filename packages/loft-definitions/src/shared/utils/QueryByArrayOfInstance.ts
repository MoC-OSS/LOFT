// ------------------ Query Types ------------------
type QueryOperator<T> = {
  [key: string]: T | T[] | string | RegExp | undefined;
} & (
  | { $eq?: T }
  | { $ne?: T }
  | { $gt?: T }
  | { $gte?: T }
  | { $lt?: T }
  | { $lte?: T }
  | { $in?: T[] }
  | { $contains?: string }
  | { $regex?: RegExp }
);

type Query<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? QueryOperator<T[K]> | QueryOperator<U>[]
    : QueryOperator<T[K]> | Query<T[K]>;
};

type LogicalQuery<T> = {
  $and?: FullQuery<T>[];
  $or?: FullQuery<T>[];
  $nor?: FullQuery<T>[];
  $not?: FullQuery<T>;
};

type FullQuery<T> = Query<T> | LogicalQuery<T>;

/** Basic check: does an object have at least one known operator key? */
function isQueryOperator<T>(val: any): val is QueryOperator<T> {
  if (!val || typeof val !== 'object') return false;
  return ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$contains', '$regex'].some((k) =>
    Object.prototype.hasOwnProperty.call(val, k)
  );
}

// ------------------ Implementation ------------------
export class QueryByArrayOfObjects<T> extends Array<T> {
  public static MAX_QUERY_DEPTH = 50; // recursion limit for query objects

  /**
   * IMPORTANT for large-data scenarios:
   * If the caller does `new QueryByArrayOfObjects(...veryLargeArray)`,
   * the spread may blow the call stack before the constructor runs in some JS engines.
   * A safer approach is to pass the array normally or use a static factory.
   */
  constructor(...items: T[]) {
    super();
    // Push items one-by-one to avoid large spread calls inside the constructor.
    // But if the call itself is `...items` of length 100k, that can still exceed the stack
    // *before* we get here, depending on the engine.
    for (const item of items) {
      super.push(item);
    }
  }

  /**
   * Public method: validate the query, then filter.
   */
  query(query: FullQuery<T>): T[] {
    // 1) Validate
    this.validateQuery(query);

    // 2) Filter
    return this.filter((item) => this.evaluate(item, query));
  }

  // -------------- 1) Validate the query --------------
  public validateQuery(q: any, depth = 0) {
    if (depth > QueryByArrayOfObjects.MAX_QUERY_DEPTH) {
      throw new Error('Query too deep');
    }
    if (!q || typeof q !== 'object') {
      throw new Error('Query must be a non-null object');
    }
    // Check for suspicious keys or prototypes
    this.checkPrototypePollution(q);

    // Check for duplicate keys at this level
    const keys = Object.getOwnPropertyNames(q);
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k)) {
        throw new Error(`Duplicate key in query object: ${k}`);
      }
      seen.add(k);
    }

    const hasLogical =
      Object.prototype.hasOwnProperty.call(q, '$and') ||
      Object.prototype.hasOwnProperty.call(q, '$or') ||
      Object.prototype.hasOwnProperty.call(q, '$nor') ||
      Object.prototype.hasOwnProperty.call(q, '$not');

    if (hasLogical) {
      // If top-level key starts with '$' but not recognized => throw
      for (const k of keys) {
        if (k.startsWith('$') && !['$and', '$or', '$nor', '$not'].includes(k)) {
          throw new Error(`Unknown logical operator: ${k}`);
        }
      }

      // Now validate sub-queries
      if (q.$and) {
        if (!Array.isArray(q.$and)) {
          throw new Error('Operator $and requires an array');
        }
        q.$and.forEach((sub: any) => this.validateQuery(sub, depth + 1));
      }
      if (q.$or) {
        if (!Array.isArray(q.$or)) {
          throw new Error('Operator $or requires an array');
        }
        q.$or.forEach((sub: any) => this.validateQuery(sub, depth + 1));
      }
      if (q.$nor) {
        if (!Array.isArray(q.$nor)) {
          throw new Error('Operator $nor requires an array');
        }
        q.$nor.forEach((sub: any) => this.validateQuery(sub, depth + 1));
      }
      if (q.$not) {
        this.validateQuery(q.$not, depth + 1);
      }
    } else {
      // Field-level queries
      for (const fieldKey of keys) {
        // If there's a '$' at the start in field-level => unknown operator
        if (fieldKey.startsWith('$')) {
          throw new Error(`Unknown logical operator: ${fieldKey}`);
        }

        const val = q[fieldKey];
        if (isQueryOperator<T>(val)) {
          // Check each operator
          for (const op in val) {
            if (!['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$contains', '$regex'].includes(op)) {
              throw new Error(`Unknown operator: ${op}`);
            }
            const opVal = val[op];
            if (opVal === undefined) {
              throw new Error(`Invalid operator value: undefined for ${op}`);
            }

            // Since all data will be JSON decoded, Symbol values are not possible
            if (typeof opVal === 'symbol') {
              throw new Error('Invalid operator value: Symbol values are not supported as all data is JSON decoded');
            }

            // If it's an object => validate recursively
            if (opVal && typeof opVal === 'object') {
              this.validateQuery(opVal, depth + 1);
            }
          }
        } else if (val && typeof val === 'object') {
          // Possibly nested subquery
          this.validateQuery(val, depth + 1);
        }
      }
    }
  }

  /**
   * Check for "prototype pollution" or suspicious keys.
   */
  public checkPrototypePollution(obj: any) {
    if (!obj || typeof obj !== 'object') return;

    if (obj instanceof Date || obj instanceof RegExp) return;
    if (Array.isArray(obj)) return;

    const proto = Object.getPrototypeOf(obj);
    // We allow {} or null
    if (proto !== Object.prototype && proto !== null) {
      throw new Error('Prototype pollution attempt');
    }

    const keys = Object.getOwnPropertyNames(obj);
    for (const k of keys) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
        throw new Error('Prototype pollution attempt');
      }
    }
  }

  // -------------- 2) Evaluate docs against query --------------
  public evaluate(item: T, query: FullQuery<T>): boolean {
    // If logical query
    if ('$and' in query || '$or' in query || '$nor' in query || '$not' in query) {
      const logQ = query as LogicalQuery<T>;
      if (logQ.$and) {
        return logQ.$and.every((sub) => this.evaluate(item, sub));
      }
      if (logQ.$or) {
        return logQ.$or.some((sub) => this.evaluate(item, sub));
      }
      if (logQ.$nor) {
        return !logQ.$nor.some((sub) => this.evaluate(item, sub));
      }
      if (logQ.$not) {
        return !this.evaluate(item, logQ.$not);
      }
      return false;
    }

    // Field-level
    const objQ = query as Query<T>;
    for (const field in objQ) {
      const conditions = objQ[field];
      const fieldValue = this.getValueByPath(item, field);
      // If field doesn't exist => fail
      if (fieldValue === undefined) return false;

      if (isQueryOperator(conditions)) {
        // Evaluate each operator
        for (const op in conditions) {
          const cVal = conditions[op as keyof QueryOperator<T>];
          let pass = true;
          switch (op) {
            case '$eq':
              // reference or deep equality, symbol included
              pass = this.deepEqual(fieldValue, cVal);
              break;
            case '$ne':
              pass = !this.deepEqual(fieldValue, cVal);
              break;
            case '$gt':
              pass = this.compare(fieldValue, cVal) > 0;
              break;
            case '$gte':
              pass = this.compare(fieldValue, cVal) >= 0;
              break;
            case '$lt':
              pass = this.compare(fieldValue, cVal) < 0;
              break;
            case '$lte':
              pass = this.compare(fieldValue, cVal) <= 0;
              break;
            case '$in':
              if (!Array.isArray(cVal)) pass = false;
              else pass = (cVal as T[]).some((x) => this.deepEqual(fieldValue, x));
              break;
            case '$contains':
              if (typeof fieldValue === 'string' && typeof cVal === 'string') {
                pass = fieldValue.includes(cVal);
              } else if (Array.isArray(fieldValue)) {
                pass = fieldValue.some((el) => this.deepEqual(el, cVal));
              } else {
                pass = false;
              }
              break;
            case '$regex':
              if (!((cVal as any) instanceof RegExp)) {
                throw new Error('Invalid regex pattern: must be a RegExp instance');
              }
              pass = typeof fieldValue === 'string' && (cVal as RegExp).test(fieldValue);
              break;
          }
          if (!pass) return false;
        }
      } else if (conditions && typeof conditions === 'object') {
        // Possibly nested sub-query
        if (!this.evaluate(fieldValue as any, conditions as FullQuery<any>)) {
          return false;
        }
      } else {
        // Not an operator => fail
        return false;
      }
    }
    return true;
  }

  // Dot-notation
  public getValueByPath(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;
    for (const p of parts) {
      if (current == null) return undefined;
      current = current[p];
    }
    return current;
  }

  // Strict deep-equal
  public deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime();
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => this.deepEqual(v, b[i]));
    }
    if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      return ka.every((k) => this.deepEqual(a[k], b[k]));
    }
    return false;
  }

  // Compare with numeric/string logic
  public compare(a: any, b: any): number {
    if (a instanceof Date) a = a.getTime();
    if (b instanceof Date) b = b.getTime();

    const typeA = typeof a;
    const typeB = typeof b;

    // Attempt to interpret strings as numbers
    if (typeB === 'string') {
      const parsed = Number(b);
      if (!Number.isNaN(parsed)) {
        // numeric string
        if (typeA === 'number') {
          return a - parsed;
        }
        return 0;
      } else {
        // normal string
        if (typeA === 'string') {
          return a.localeCompare(b);
        }
        return 0;
      }
    }
    if (typeB === 'number') {
      if (typeA === 'number') {
        return a - b;
      }
      return 0;
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a.localeCompare(b);
    }
    // fallback => treat as "equal"
    return 0;
  }

  static get [Symbol.species]() {
    return Array;
  }
}
