import { querySqlite } from '../config/sqlite';
import { AuthRequest } from '../middleware/auth';

export function getAllowedRegionIds(user?: AuthRequest['user']): number[] | null {
  if (!user || !user.dataScope || !Array.isArray(user.dataScope.regions) || user.dataScope.regions.length === 0) {
    return null;
  }

  const scopeNames = user.dataScope.regions.map((n: string) => `'${n.replace(/'/g, "''")}'`).join(',');
  const scopeIdsQuery = `
    WITH RECURSIVE allowed_ids AS (
      SELECT id FROM regions WHERE name IN (${scopeNames})
      UNION ALL
      SELECT r.id FROM regions r JOIN allowed_ids p ON r.parent_id = p.id
    )
    SELECT id FROM allowed_ids
  `;

  try {
    const allowedRows = querySqlite(scopeIdsQuery);
    return allowedRows.map((row: any) => row.id);
  } catch (e) {
    console.error('Error calculating scope IDs:', e);
    return [];
  }
}
