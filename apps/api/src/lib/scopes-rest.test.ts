import { describe, expect, it } from 'vitest';
import { expandRestScopes, validateScopes } from './rest-scopes.js';

// PR6a: finer REST scopes must be introduced WITHOUT changing what any existing
// coarse-scoped key can do. These tests pin that back-compat contract.
describe('expandRestScopes — coarse → fine back-compat', () => {
  const has = (scopes: string[], scope: string) => expandRestScopes(scopes).has(scope);

  it('read grants exactly the routes it granted before (docs+flows read, nothing else)', () => {
    expect(has(['read'], 'docs:read')).toBe(true);
    expect(has(['read'], 'flows:read')).toBe(true);
    expect(has(['read'], 'docs:write')).toBe(false);
    expect(has(['read'], 'flows:write')).toBe(false);
    expect(has(['read'], 'tasks:read')).toBe(false);
    expect(has(['read'], 'tasks:write')).toBe(false);
  });

  it('write grants only docs:write (matches the old write-only key)', () => {
    expect(has(['write'], 'docs:write')).toBe(true);
    // Historically a write-only key could NOT read — preserve that exactly.
    expect(has(['write'], 'docs:read')).toBe(false);
    expect(has(['write'], 'flows:read')).toBe(false);
  });

  it('tasks grants both task scopes and nothing else', () => {
    expect(has(['tasks'], 'tasks:read')).toBe(true);
    expect(has(['tasks'], 'tasks:write')).toBe(true);
    expect(has(['tasks'], 'docs:read')).toBe(false);
    expect(has(['tasks'], 'docs:write')).toBe(false);
  });

  it('a full-access legacy key (read+write+tasks) covers every fine scope its routes used', () => {
    const g = expandRestScopes(['read', 'write', 'tasks']);
    for (const s of ['docs:read', 'docs:write', 'flows:read', 'tasks:read', 'tasks:write']) {
      expect(g.has(s)).toBe(true);
    }
  });
});

describe('expandRestScopes — fine scopes do not over-grant', () => {
  it('a docs:read key can read docs but not flows or writes', () => {
    const g = expandRestScopes(['docs:read']);
    expect(g.has('docs:read')).toBe(true);
    expect(g.has('flows:read')).toBe(false);
    expect(g.has('docs:write')).toBe(false);
  });

  it('a docs:write key can write docs but cannot read them (must ask for docs:read too)', () => {
    const g = expandRestScopes(['docs:write']);
    expect(g.has('docs:write')).toBe(true);
    expect(g.has('docs:read')).toBe(false);
  });
});

describe('validateScopes accepts fine scopes and rejects junk', () => {
  it('keeps valid fine + coarse scopes', () => {
    expect(validateScopes(['docs:read', 'flows:read'])).toEqual(['docs:read', 'flows:read']);
    expect(validateScopes(['read', 'tasks:write'])).toEqual(['read', 'tasks:write']);
  });
  it('drops unknown scopes, falling back to read when nothing valid remains', () => {
    expect(validateScopes(['bogus', 'docs:delete'])).toEqual(['read']);
    expect(validateScopes([])).toEqual(['read']);
  });
});
