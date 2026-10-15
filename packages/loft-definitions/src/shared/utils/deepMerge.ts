import { z } from 'zod';

import { Interface } from '../..';

/**
 * Performs a deep merge of source object into target object.
 * Works only with JSON-compatible types:
 * - null
 * - boolean
 * - number
 * - string
 * - arrays of JSON-compatible types
 * - objects with string keys and JSON-compatible values
 *
 * Special types (Date, RegExp, Map, Set, Symbol, Function) will be:
 * - Date: preserved as Date objects
 * - Others: ignored with warning
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  log: Interface.Logger,
  seen = new WeakMap()
): Record<string, unknown> {
  // Input validation
  if (!target || !source || typeof target !== 'object' || typeof source !== 'object') {
    log.error('Invalid input: both target and source must be objects', { target, source });
    throw new Error('Both target and source must be objects');
  }

  // If we've seen the source object before, return its cached result
  if (seen.has(source)) {
    log.debug('Circular reference detected, returning cached result');
    return seen.get(source);
  }

  // Create result object and cache it immediately to handle circular refs
  const result: Record<string, unknown> = {};
  seen.set(source, result);

  // Process each property
  for (const key in source) {
    // Skip prototype pollution attempts
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      log.warn('Skipping prototype pollution attempt', { key });
      continue;
    }

    const sourceValue = source[key];
    const targetValue = target[key];

    // Handle special types
    if (sourceValue instanceof Date) {
      log.debug('Preserving Date object', { key });
      result[key] = sourceValue;
      continue;
    }

    if (
      sourceValue instanceof RegExp ||
      sourceValue instanceof Map ||
      sourceValue instanceof Set ||
      typeof sourceValue === 'function' ||
      typeof sourceValue === 'symbol'
    ) {
      log.warn(`Ignoring non-JSON value at "${key}": ${String(sourceValue)}`);
      continue;
    }

    // Handle null, primitives and arrays
    if (
      sourceValue === null ||
      typeof sourceValue === 'boolean' ||
      typeof sourceValue === 'number' ||
      typeof sourceValue === 'string'
    ) {
      result[key] = sourceValue;
      continue;
    }

    // Handle arrays
    if (Array.isArray(sourceValue)) {
      result[key] = sourceValue
        .map((item) => {
          if (item instanceof Date) {
            return item;
          }
          if (
            item instanceof RegExp ||
            item instanceof Map ||
            item instanceof Set ||
            typeof item === 'function' ||
            typeof item === 'symbol'
          ) {
            log.warn(`Ignoring non-JSON value in array: ${String(item)}`);
            return undefined;
          }
          if (Array.isArray(item)) {
            return [...item];
          }
          if (item && typeof item === 'object') {
            return deepMerge({}, item as Record<string, unknown>, log, seen);
          }
          return item;
        })
        .filter((item) => item !== undefined);
      continue;
    }

    // Handle nested objects
    if (typeof sourceValue === 'object') {
      if (targetValue && typeof targetValue === 'object' && !Array.isArray(targetValue)) {
        result[key] = deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>,
          log,
          seen
        );
      } else {
        result[key] = deepMerge({}, sourceValue as Record<string, unknown>, log, seen);
      }
    }
  }

  // Copy properties from target that don't exist in source
  for (const key in target) {
    if (!(key in result)) {
      const targetValue = target[key];

      // Handle special types
      if (targetValue instanceof Date) {
        result[key] = targetValue;
        continue;
      }

      if (
        targetValue instanceof RegExp ||
        targetValue instanceof Map ||
        targetValue instanceof Set ||
        typeof targetValue === 'function' ||
        typeof targetValue === 'symbol'
      ) {
        log.warn(`Ignoring non-JSON value from target at "${key}": ${String(targetValue)}`);
        continue;
      }

      // Handle JSON-compatible values
      if (
        targetValue === null ||
        typeof targetValue === 'boolean' ||
        typeof targetValue === 'number' ||
        typeof targetValue === 'string' ||
        Array.isArray(targetValue) ||
        typeof targetValue === 'object'
      ) {
        result[key] = targetValue;
      }
    }
  }

  log.debug('Merge completed successfully');
  return result;
}

export function isRecord(obj: unknown): obj is Record<string, unknown> {
  return z.object({}).passthrough().safeParse(obj).success;
}

export function areEnumsEqual(enum1: any, enum2: any): boolean {
  const keys1 = Object.keys(enum1);
  const keys2 = Object.keys(enum2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    if (enum1[key] !== enum2[key]) {
      return false;
    }
  }

  for (const key of keys2) {
    if (enum2[key] !== enum1[key]) {
      return false;
    }
  }

  return true;
}
