import pool, { dbType } from '../config/database-llm';
import { querySqlite } from '../config/sqlite';
import { AuthRequest } from '../middleware/auth';

/**
 * Synchronous version - only works with SQLite
 * Used by routes that haven't been migrated to async yet
 */
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
    if (dbType === 'postgres') {
      // For Postgres, return null to let the calling code handle it with async version
      // This is a fallback - routes should use getAllowedRegionIdsAsync instead
      console.warn('[getAllowedRegionIds] Called sync version with Postgres DB - returning null to allow all');
      return null;
    }
    const allowedRows = querySqlite(scopeIdsQuery);
    return allowedRows.map((row: any) => row.id);
  } catch (e) {
    console.error('Error calculating scope IDs:', e);
    return [];
  }
}

/**
 * Async version - works with both SQLite and PostgreSQL
 * Should be used by all routes going forward
 */
export async function getAllowedRegionIdsAsync(user?: AuthRequest['user']): Promise<number[] | null> {
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
    let allowedRows: any[];
    if (dbType === 'postgres') {
      const result = await pool.query(scopeIdsQuery);
      allowedRows = result.rows;
    } else {
      allowedRows = querySqlite(scopeIdsQuery);
    }
    return allowedRows.map((row: any) => row.id);
  } catch (e) {
    console.error('Error calculating scope IDs:', e);
    return [];
  }
}

