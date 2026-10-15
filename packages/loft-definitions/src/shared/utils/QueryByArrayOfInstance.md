# QueryByArrayOfObjects Documentation

This document provides a comprehensive overview of the `QueryByArrayOfObjects` class in TypeScript, combining both technical details and practical examples to help you understand and use this powerful querying utility.

## 1. Overview

### What Is QueryByArrayOfObjects?

`QueryByArrayOfObjects` extends JavaScript's built-in `Array` class to enable querying objects using a structured, MongoDB-inspired query language. This class adds a `.query()` method that filters items according to specified conditions, operators, and logical connectors.

### Why Use It?

- **Simplicity**: Store objects in a plain array, then filter them using a structured query.
- **Familiar Syntax**: Operators such as `$eq`, `$gt`, and `$or` are similar to MongoDB.
- **Protective Features**: Built-in query validation helps prevent prototype pollution and overly deep queries.

### Typical Use Cases

- **Filtering In-Memory Data**: Particularly useful for small- to medium-sized arrays where you want a straightforward way to filter based on complex logical conditions.
- **Prototyping**: When building prototypes that don't require a full-fledged database, you can seamlessly query arrays of objects.
- **Testing and Mocking**: For test suites or mocking database functionalities, provides an easy-to-use, in-memory query mechanism.

## 2. Features

### Core Features

1. **Array-Like Behavior**: Inherits from `Array<T>`, so you can use `push`, `map`, and other native methods.
2. **`query()` Method**: Takes an object describing your conditions and returns all items that match.
3. **Logical Operators**: Use `$and`, `$or`, `$nor`, `$not` to combine multiple conditions.
4. **Field Operators**: `$eq`, `$gt`, `$lte`, `$in`, `$contains`, `$regex`, etc.
5. **Prototype Pollution Checks**: Prevents malicious keys like `__proto__`, `constructor`, or `prototype`.

### Available Methods and Properties

| Member                              | Description                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| Static Property `MAX_QUERY_DEPTH`   | A constant that limits the recursion depth for nested queries (default = 50).                       |
| Constructor `constructor(...items)` | Accepts a list of items (`T[]`) to populate the array on instantiation. Appends items one by one.   |
| Method `query(query: FullQuery<T>)` | Validates the query, then filters the underlying array items. Returns a new array of matched items. |

## 3. Usage Examples

### Basic Setup and Simple Queries

```typescript
import { QueryByArrayOfObjects } from './QueryByArrayOfObjects';

// Basic setup with a Person interface
interface Person {
  id: number;
  name: string;
  age: number;
  address?: {
    city: string;
    country: string;
  };
}

// Create an instance with some data
const people = new QueryByArrayOfObjects<Person>(
  { id: 1, name: 'Alice', age: 30, address: { city: 'London', country: 'UK' } },
  { id: 2, name: 'Bob', age: 25, address: { city: 'Paris', country: 'France' } },
  { id: 3, name: 'Charlie', age: 40, address: { city: 'London', country: 'UK' } }
);

// Simple equality query
const londoners = people.query({
  'address.city': { $eq: 'London' }
});
```

### Complex Logical Queries

```typescript
// Combining multiple conditions with $and and $or
const complexQuery = people.query({
  $and: [
    {
      $or: [{ age: { $gte: 30 } }, { 'address.city': { $eq: 'Paris' } }]
    },
    { 'address.country': { $eq: 'UK' } }
  ]
});

// Using $not to exclude certain conditions
const notQuery = people.query({
  $not: {
    $or: [{ 'address.country': { $eq: 'France' } }, { age: { $lt: 30 } }]
  }
});
```

### Working with Arrays

```typescript
interface User {
  id: number;
  name: string;
  tags: string[];
}

const users = new QueryByArrayOfObjects<User>(
  { id: 1, name: 'Alice', tags: ['admin', 'beta-tester'] },
  { id: 2, name: 'Bob', tags: ['user'] },
  { id: 3, name: 'Charlie', tags: ['admin', 'team-lead'] }
);

// Find users with specific tag
const admins = users.query({
  tags: { $contains: 'admin' }
});

// Find users with any of multiple tags
const specialUsers = users.query({
  tags: { $in: ['admin', 'team-lead'] }
});
```

### Date Comparisons

```typescript
interface Task {
  id: number;
  title: string;
  deadline: Date;
}

const tasks = new QueryByArrayOfObjects<Task>(
  { id: 1, title: 'Report', deadline: new Date('2024-01-01') },
  { id: 2, title: 'Meeting', deadline: new Date('2024-05-10') },
  { id: 3, title: 'Prototype', deadline: new Date('2023-12-31') }
);

// Find tasks due after a certain date
const upcomingTasks = tasks.query({
  deadline: { $gt: new Date('2024-01-01') }
});
```

## 4. Implementation Details

### How It Works

Internally, the class:

1. **Validates** your query to ensure it's well-formed
2. **Recursively** checks each array item against your query operators
3. **Returns** a new array with all matching items

### Query Validation and Security

- `validateQuery(q: any, depth: number)`: Recursively ensures the query is valid
- `checkPrototypePollution(obj: any)`: Prevents prototype pollution attempts
- Depth checking prevents stack overflow from malicious queries

## 5. Type Definitions

```typescript
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
```

## 6. Limitations and Considerations

### Known Limitations

- **Maximum Query Depth**: Limited to `MAX_QUERY_DEPTH` (default = 50)
- **Large Arrays**: Constructor spread operator may cause stack overflow
- **Performance**: Not optimized for very large datasets

### Unsuitable Scenarios

- **High Volume Data**: Use a real database for millions of records
- **Real-Time Updates**: Better suited for static or slowly changing data
- **Deep Nested Structures**: May hit recursion limits with very deep objects

## 7. Error Handling

| Error Message                     | Cause                      | Resolution                    |
| --------------------------------- | -------------------------- | ----------------------------- |
| "Query too deep"                  | Exceeded `MAX_QUERY_DEPTH` | Simplify query structure      |
| "Query must be a non-null object" | Invalid query input        | Ensure query is an object     |
| "Unknown operator: $xyz"          | Invalid operator           | Use supported operators only  |
| "Prototype pollution attempt"     | Dangerous key detected     | Remove/rename suspicious keys |
| "Invalid regex pattern"           | Non-RegExp for $regex      | Use proper RegExp object      |

## 8. Best Practices

### Query Design

- Keep queries shallow when possible
- Use logical operators judiciously
- Validate external query inputs
- Consider caching frequent query results

### Performance Optimization

- **Reduce Nesting**: Flatten complex queries where possible
- **Preprocess Data**: Consider indexing frequently queried fields
- **Batch Operations**: Group related queries together
- **Cache Results**: Store results of expensive queries

### Large Dataset Handling

- Avoid constructor spreading with large arrays
- Consider chunking or streaming data
- Use appropriate data structures for your use case

## 9. Installation and Setup

1. Add the File:

```typescript
import { QueryByArrayOfObjects } from './QueryByArrayOfObjects';
```

2. Create an Instance:

```typescript
const items = new QueryByArrayOfObjects({ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' });
```

3. Start Querying:

```typescript
const results = items.query({ id: { $eq: 1 } });
```

## 10. Advanced Examples

See the comprehensive examples in the [Usage Examples](#3-usage-examples) section for detailed demonstrations of:

- Nested field queries
- Complex logical operations
- Array field handling
- Date comparisons
- Type-safe querying

## 11. Contributing

When contributing to `QueryByArrayOfObjects`:

1. Maintain type safety
2. Add tests for new features
3. Document changes thoroughly
4. Consider backward compatibility
5. Follow existing code style

---

This documentation aims to be both comprehensive and practical. For specific use cases or questions not covered here, please refer to the source code or raise an issue in the repository.
