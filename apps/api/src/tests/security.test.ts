import { describe, expect, it } from 'vitest';
import { hasPermission, hashPassword, normalizePhone, roleRank, verifyPassword } from '../common/security.js';
import type { Permission, Role } from '../domain/types.js';

// Local helper tests only — hashing/permissions are pure Node code; no database
// and certainly no PostgreSQL connection is exercised here.
describe('security helpers (local logic; not PostgreSQL)', () => {
  describe('normalizePhone', () => {
    it('normalizes formatted numbers to E.164', () => {
      expect(normalizePhone('  +1 (415) 555-0123 ')).toBe('+14155550123');
      expect(normalizePhone('085 123 4567')).toBe('+0851234567');
      expect(normalizePhone('+14155550123')).toBe('+14155550123');
    });

    it('rejects numbers outside the 8–15 digit range', () => {
      expect(() => normalizePhone('12345')).toThrow('INVALID_PHONE');
      expect(() => normalizePhone('+1 415 555 0123 99999')).toThrow('INVALID_PHONE');
    });
  });

  describe('password hashing', () => {
    it('uses a random salt and verifies the correct password', () => {
      const first = hashPassword('correct horse');
      const second = hashPassword('correct horse');

      expect(first).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
      expect(second).not.toBe(first);
      expect(verifyPassword('correct horse', first)).toBe(true);
      expect(verifyPassword('wrong horse', first)).toBe(false);
      expect(verifyPassword('correct horse', second)).toBe(true);
    });

    it('rejects malformed or unknown stored hashes', () => {
      expect(verifyPassword('anything', 'plaintext')).toBe(false);
      expect(verifyPassword('anything', 'bcrypt$abc$def')).toBe(false);
      expect(verifyPassword('anything', 'scrypt$abc$deadbeef')).toBe(false);
    });
  });

  describe('RBAC', () => {
    it('grants and denies permissions according to the role table', () => {
      expect(hasPermission('org_admin', 'member:manage')).toBe(true);
      expect(hasPermission('super_admin', 'report:export')).toBe(true);
      expect(hasPermission('mentor', 'schedule:manage')).toBe(true);
      expect(hasPermission('mentor', 'member:manage')).toBe(false);
      expect(hasPermission('student', 'member:manage')).toBe(false);
      expect(hasPermission('student', 'member:read')).toBe(false);
      expect(hasPermission('student', 'attendance:correct')).toBe(false);
      expect(hasPermission('student', 'report:read')).toBe(true);
      expect(hasPermission('guest', 'world:connect')).toBe(true);
      expect(hasPermission('guest', 'org:read')).toBe(false);

      const permissions: Permission[] = [
        'org:read', 'member:manage', 'schedule:manage', 'attendance:correct', 'report:export', 'world:connect',
      ];
      expect(permissions.filter((p) => hasPermission('student', p))).toEqual([
        'org:read', 'world:connect',
      ]);
    });

    it('returns false for unknown roles and ranks known roles', () => {
      expect(hasPermission('unknown' as Role, 'org:read')).toBe(false);
      expect(roleRank.guest).toBeLessThan(roleRank.student);
      expect(roleRank.mentor).toBeLessThan(roleRank.org_admin);
      expect(roleRank.org_admin).toBeLessThan(roleRank.super_admin);
    });
  });
});
