import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDatabaseConnectionString } from './connection-string.js';

test('requires encrypted connections using standard PostgreSQL SSL semantics', () => {
  const result = new URL(normalizeDatabaseConnectionString(
    'postgresql://db.example.com/postgres',
    true
  ));

  assert.equal(result.searchParams.get('sslmode'), 'require');
  assert.equal(result.searchParams.get('uselibpqcompat'), 'true');
});

test('preserves local connection strings without an SSL mode', () => {
  const connectionString = 'postgresql://localhost/postgres';

  assert.equal(normalizeDatabaseConnectionString(connectionString, false), connectionString);
});

test('preserves explicit full certificate verification', () => {
  const result = new URL(normalizeDatabaseConnectionString(
    'postgresql://db.example.com/postgres?sslmode=verify-full&sslrootcert=%2Fetc%2Fca.crt'
  ));

  assert.equal(result.searchParams.get('sslmode'), 'verify-full');
  assert.equal(result.searchParams.get('sslrootcert'), '/etc/ca.crt');
  assert.equal(result.searchParams.get('uselibpqcompat'), 'true');
});

test('rejects explicitly disabled SSL', () => {
  assert.throws(
    () => normalizeDatabaseConnectionString(
      'postgresql://db.example.com/postgres?sslmode=disable'
    ),
    { message: 'DATABASE_URL must use SSL.' }
  );
});
