/**
 * Spec §6: the synced membership row is the truth; the token's claims catch
 * up when refreshed. A difference means the household or role changed.
 */
export function membershipAction(
  row: { household_id: string; role: string } | undefined,
  claims: { householdId: string; role: string },
): 'refresh' | 'none' {
  if (!row) return 'none';
  return row.household_id !== claims.householdId || row.role !== claims.role ? 'refresh' : 'none';
}
