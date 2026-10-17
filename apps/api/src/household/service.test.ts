import { describe, expect, it, vi } from 'vitest';
import type { AsUser } from '../db/asUser';
import type { PhotoStore } from '../photos/store';
import { createHouseholdService, HouseholdRefusal } from './service';

function refusalError(key: string) {
  return Object.assign(new Error(key), { code: 'P0001' });
}

function setup(results: unknown[][] | Error) {
  const statements: string[] = [];
  const tx = vi.fn(async (strings: TemplateStringsArray) => {
    statements.push(strings.join('?'));
    if (results instanceof Error) throw results;
    return results.shift() ?? [];
  });
  const asUser = (async (_token: string, fn: (t: unknown) => Promise<unknown>) =>
    fn(tx)) as unknown as AsUser;
  const photos: Pick<PhotoStore, 'move'> = { move: vi.fn().mockResolvedValue(undefined) };
  const service = createHouseholdService({ asUser, photos, log: vi.fn() });
  return { service, statements, photos };
}

describe('household service', () => {
  it('creates an invite and returns its code', async () => {
    const { service, statements } = setup([
      [{ id: 'i1', token: 'c'.repeat(43), expires_at: new Date('2026-10-24T00:00:00Z') }],
    ]);
    expect(await service.createInvite('jwt', 'member')).toEqual({
      id: 'i1',
      code: 'c'.repeat(43),
      expires_at: '2026-10-24T00:00:00.000Z',
    });
    expect(statements[0]).toContain('public.create_invite(');
  });

  it('turns a function refusal into a HouseholdRefusal, and passes anything else through', async () => {
    const refused = setup(refusalError('last_admin'));
    await expect(refused.service.setRole('jwt', 'u2', 'viewer')).rejects.toEqual(
      new HouseholdRefusal('last_admin'),
    );
    const broken = setup(new Error('connection reset'));
    await expect(broken.service.leave('jwt')).rejects.toThrow('connection reset');
  });

  it('lists invites only for an Admin', async () => {
    const member = setup([[{ role: 'member' }]]);
    await expect(member.service.listInvites('jwt')).rejects.toEqual(
      new HouseholdRefusal('forbidden'),
    );
    const admin = setup([
      [{ role: 'admin' }],
      [{ id: 'i1', role: 'viewer', expires_at: new Date(0), created_at: new Date(0) }],
    ]);
    expect(await admin.service.listInvites('jwt')).toEqual([
      {
        id: 'i1',
        role: 'viewer',
        expires_at: '1970-01-01T00:00:00.000Z',
        created_at: '1970-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('moves the photo files of a lone joiner after the accept', async () => {
    const { service, photos } = setup([
      [
        {
          household_id: 'h-new',
          from_household: 'h-old',
          moved_recipes: 2,
          moved_photos: ['p1', 'p2'],
        },
      ],
    ]);
    expect(await service.acceptInvite('jwt', 'c'.repeat(43))).toEqual({
      household_id: 'h-new',
      moved_recipes: 2,
    });
    expect(vi.mocked(photos.move).mock.calls).toEqual([
      ['h-old', 'h-new', 'p1'],
      ['h-old', 'h-new', 'p2'],
    ]);
  });

  it('a rename that matched no row is forbidden (not an Admin)', async () => {
    const { service } = setup([[]]);
    await expect(service.rename('jwt', 'Gelpis')).rejects.toEqual(
      new HouseholdRefusal('forbidden'),
    );
  });
});
