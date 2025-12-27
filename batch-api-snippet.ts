// GET /api/reports/batch-check-status?report_ids=1,2,3
// Returns: { "1": 5, "2": 0, "3": 12 } (reportId => failCount)
router.get('/reports/batch-check-status', (req, res) => {
    try {
        const reportIdsParam = req.query.report_ids;
        if (!reportIdsParam || typeof reportIdsParam !== 'string') {
            return res.status(400).json({ error: 'report_ids query parameter required' });
        }

        const reportIds = reportIdsParam.split(',').map(id => Number(id.trim())).filter(id => !isNaN(id) && id > 0);
        if (reportIds.length === 0) {
            return res.json({});
        }

        ensureSqliteMigrations();

        // Get active version_ids for these reports
        const versionRows = querySqlite(`
      SELECT r.id as report_id, rv.id as version_id
      FROM reports r
      JOIN report_versions rv ON rv.report_id = r.id AND rv.is_active = 1
      WHERE r.id IN (${reportIds.join(',')})
    `) as Array<{ report_id: number; version_id: number }>;

        const versionMap = new Map(versionRows.map(v => [v.report_id, v.version_id]));

        // Batch query for FAIL items
        const versionIds = Array.from(versionMap.values());
        if (versionIds.length === 0) {
            return res.json({});
        }

        const failCounts = querySqlite(`
      SELECT report_version_id, COUNT(*) as cnt
      FROM report_consistency_items
      WHERE report_version_id IN (${versionIds.join(',')})
        AND auto_status = 'FAIL'
        AND human_status != 'dismissed'
      GROUP BY report_version_id
    `) as Array<{ report_version_id: number; cnt: number }>;

        const versionToCount = new Map(failCounts.map(fc => [fc.report_version_id, fc.cnt]));

        // Build result map: reportId => failCount
        const result: Record<string, number> = {};
        for (const [reportId, versionId] of versionMap) {
            result[String(reportId)] = versionToCount.get(versionId) || 0;
        }

        return res.json(result);
    } catch (error: any) {
        console.error('Error in batch-check-status:', error);
        return res.status(500).json({ error: 'internal_server_error', message: error.message });
    }
});

export default router;
