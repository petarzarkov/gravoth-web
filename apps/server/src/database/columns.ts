import { customType } from 'drizzle-orm/pg-core';

/**
 * A `jsonb` column that hands its value to `Bun.SQL` as it is.
 *
 * drizzle's own `jsonb()` stringifies the value first, and `Bun.SQL` then sends that string as a string, so Postgres
 * stores a JSON **string** holding the document (`"[{\"id\":...}]"`) instead of the array: measured on Bun 1.4.5 with
 * drizzle-orm 0.45.2, and caught by `hero_builds_json_shapes`. `Bun.SQL` serialises an object or an array itself, so
 * passing it through stores the document; reads come back parsed. Every column of this type holds an object or an
 * array, never a bare number (which `Bun.SQL` would send as a number, and Postgres would refuse for jsonb).
 */
export const jsonb = <T>(name: string) =>
  customType<{ data: T; driverData: T }>({
    dataType: () => 'jsonb',
    toDriver: (value) => value,
    fromDriver: (value) => value,
  })(name);

/**
 * A `bytea` column, which drizzle-orm 0.45 does not have. `Bun.SQL` sends a `Uint8Array` (or a `Buffer`) parameter as
 * binary and reads a `bytea` back as a `Buffer`, so the value passes through as it is, like `jsonb` above: measured on
 * Bun 1.4.5 with drizzle-orm 0.45.2 (zero bytes, high bytes and 3 MB of random bytes come back exactly, and
 * Postgres's own `octet_length` and `sha256` agree), and held to it by `saves.test.ts`.
 */
export const bytea = (name: string) =>
  customType<{ data: Uint8Array; driverData: Uint8Array }>({
    dataType: () => 'bytea',
    toDriver: (value) => value,
    fromDriver: (value) => value,
  })(name);
