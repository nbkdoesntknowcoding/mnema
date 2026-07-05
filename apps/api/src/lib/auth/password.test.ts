/**
 * Phase 4 — built-in password hashing (scrypt). Roundtrip + rejection + salt uniqueness.
 */
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('roundtrips a correct password', () => {
    const h = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', h)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const h = hashPassword('s3cret-value');
    expect(verifyPassword('wrong', h)).toBe(false);
  });

  it('rejects null / malformed stored hashes', () => {
    expect(verifyPassword('x', null)).toBe(false);
    expect(verifyPassword('x', 'notscrypt$a$b')).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
    expect(verifyPassword('x', 'scrypt$$')).toBe(false);
  });

  it('uses a unique salt per hash', () => {
    expect(hashPassword('same-password')).not.toBe(hashPassword('same-password'));
  });
});
