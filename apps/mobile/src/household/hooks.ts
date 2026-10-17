import { useQuery } from '@powersync/react';

export type Member = {
  user_id: string;
  email: string | null;
  role: string;
  created_at: string | null;
};

export function useMembers(householdId: string): Member[] {
  const { data } = useQuery<Member>(
    'select user_id, email, role, created_at from memberships where household_id = ? order by created_at',
    [householdId],
  );
  return data;
}

export function useHouseholdName(householdId: string | null): string | null {
  const { data } = useQuery<{ name: string }>('select name from households where id = ?', [
    householdId ?? '',
  ]);
  return data[0]?.name ?? null;
}
