/**
 * Schema ensure for the explicit department marker on region nodes.
 *
 * The tree stores 行政区划 and 部门 in one table, and `level` cannot separate
 * them: a department under a 区县 lands on level 4, which is also the 乡镇
 * level. `is_department` is the authoritative declaration written by the
 * batch import and the 区域管理 "移动分类" toggle.
 *
 * The column is intentionally nullable and intentionally NOT backfilled:
 * NULL means "never declared, classify by name", so inference stays live for
 * legacy rows and a misclassified node only needs one explicit write to stick.
 */
import type { MigrationClient } from './migrationRunner';

export async function ensureRegionDepartmentSchema(client: MigrationClient): Promise<void> {
  await client.query(`
    ALTER TABLE regions ADD COLUMN IF NOT EXISTS is_department BOOLEAN;

    CREATE INDEX IF NOT EXISTS idx_regions_is_department
      ON regions(is_department)
      WHERE is_department IS NOT NULL;
  `);
}
