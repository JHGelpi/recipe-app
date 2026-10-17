import { describe, expect, it } from 'vitest';
import {
  householdErrorOf,
  householdRenameSchema,
  inviteCreateSchema,
  inviteTokenBodySchema,
  memberRoleBodySchema,
} from './household';

const CODE = 'k3J9xQ2mZb7LwP0aYc5RdT8vNf1HgE4sUo6IiKjMnBq';

describe('household schemas', () => {
  it('accepts a role for an invite or a member, and refuses anything else', () => {
    expect(inviteCreateSchema.safeParse({ role: 'viewer' }).success).toBe(true);
    expect(memberRoleBodySchema.safeParse({ role: 'admin' }).success).toBe(true);
    expect(inviteCreateSchema.safeParse({ role: 'owner' }).success).toBe(false);
    expect(inviteCreateSchema.safeParse({ role: 'member', extra: 1 }).success).toBe(false);
  });

  it('accepts only a 43-character base64url invite code', () => {
    expect(CODE).toHaveLength(43);
    expect(inviteTokenBodySchema.safeParse({ token: CODE }).success).toBe(true);
    expect(inviteTokenBodySchema.safeParse({ token: `${CODE}=` }).success).toBe(false);
    expect(inviteTokenBodySchema.safeParse({ token: CODE.replace('k', '+') }).success).toBe(false);
    expect(inviteTokenBodySchema.safeParse({ token: 'short' }).success).toBe(false);
  });

  it('trims a household name and holds it to 1–200 characters', () => {
    expect(householdRenameSchema.parse({ name: '  Gelpi household ' }).name).toBe(
      'Gelpi household',
    );
    expect(householdRenameSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(householdRenameSchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
  });

  it('recognises the database functions’ refusal keys and nothing else', () => {
    expect(householdErrorOf('last_admin')).toBe('last_admin');
    expect(householdErrorOf('invite_expired')).toBe('invite_expired');
    expect(householdErrorOf('relation "x" does not exist')).toBeNull();
    expect(householdErrorOf(undefined)).toBeNull();
  });
});
