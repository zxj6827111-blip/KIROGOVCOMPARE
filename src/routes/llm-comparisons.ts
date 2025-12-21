import express from 'express';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { ensureSqliteMigrations, querySqlite, sqlValue } from '../config/sqlite';

const router = express.Router();

interface ParsedVersion {
  version_id: number;
  parsed_json: any;
}

function parseJsonSafe(value: any): any {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

function isParsedReady(version: ParsedVersion | undefined): boolean {
  if (!version) return false;
  if (version.parsed_json === null || version.parsed_json === undefined) return false;
  const parsed = parseJsonSafe(version.parsed_json);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return Object.keys(parsed).length > 0;
  }
  return true;
}

function buildLatestJob(comparisonId: number): any {
  const job = querySqlite(`
    SELECT id, status, progress, error_code, error_message
    FROM jobs
    WHERE comparison_id = ${sqlValue(comparisonId)}
    ORDER BY id DESC
    LIMIT 1;
  `)[0];

  if (!job) {
    return null;
  }

  return {
    job_id: job.id,
    status: job.status,
    progress: job.progress,
    error_code: job.error_code,
    error_message: job.error_message,
  };
}

function fetchParsedVersion(reportId: number): ParsedVersion | undefined {
  const version = querySqlite(`
    SELECT id as version_id, parsed_json
    FROM report_versions
    WHERE report_id = ${sqlValue(reportId)} AND is_active = 1
    LIMIT 1;
  `)[0];

  if (!version) {
    return undefined;
  }

  return {
    version_id: version.version_id,
    parsed_json: parseJsonSafe(version.parsed_json),
  };
}

function stringifyValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function buildDiffSection(title: string, entries: any[], emphasize: string): Paragraph[] {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_2,
      spacing: { after: 200 },
    }),
  ];

  if (!entries || !entries.length) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: '无变化项', italics: true })],
        spacing: { after: 150 },
      })
    );
    return paragraphs;
  }

  for (const entry of entries) {
    const bulletParts: TextRun[] = [
      new TextRun({ text: `路径：${entry.path || '(空路径)'}`, bold: true }),
      new TextRun({ text: `（${emphasize}）`, break: 1, bold: true }),
    ];

    if (entry.left !== undefined) {
      bulletParts.push(new TextRun({ text: `左侧：${stringifyValue(entry.left)}`, break: 1 }));
    }
    if (entry.right !== undefined) {
      bulletParts.push(new TextRun({ text: `右侧：${stringifyValue(entry.right)}`, break: 1 }));
    }

    paragraphs.push(
      new Paragraph({
        children: bulletParts,
        spacing: { after: 200 },
      })
    );
  }

  return paragraphs;
}

router.post('/comparisons', (req, res) => {
  try {
    const { region_id, year_a, year_b, left_report_id, right_report_id } = req.body;

    if (!region_id && (!left_report_id || !right_report_id)) {
      return res.status(400).json({ error: 'region_id/year_a/year_b 或 report_id 组合不能为空' });
    }

    let regionId = region_id ? Number(region_id) : undefined;
    let yearA = year_a !== undefined ? Number(year_a) : undefined;
    let yearB = year_b !== undefined ? Number(year_b) : undefined;
    let leftReportId = left_report_id !== undefined ? Number(left_report_id) : undefined;
    let rightReportId = right_report_id !== undefined ? Number(right_report_id) : undefined;

    if (regionId !== undefined && (!Number.isInteger(regionId) || regionId < 1)) {
      return res.status(400).json({ error: 'region_id 无效' });
    }

    const validateYear = (year: number | undefined): boolean => year !== undefined && Number.isInteger(year);
    if (yearA !== undefined && !validateYear(yearA)) {
      return res.status(400).json({ error: 'year_a 无效' });
    }
    if (yearB !== undefined && !validateYear(yearB)) {
      return res.status(400).json({ error: 'year_b 无效' });
    }

    if (leftReportId !== undefined && (!Number.isInteger(leftReportId) || leftReportId < 1)) {
      return res.status(400).json({ error: 'left_report_id 无效' });
    }
    if (rightReportId !== undefined && (!Number.isInteger(rightReportId) || rightReportId < 1)) {
      return res.status(400).json({ error: 'right_report_id 无效' });
    }

    ensureSqliteMigrations();

    if (regionId && yearA !== undefined && yearB !== undefined) {
      if (yearA > yearB) {
        [yearA, yearB] = [yearB, yearA];
      }
      const leftReport = querySqlite(
        `SELECT id, region_id, year FROM reports WHERE region_id = ${sqlValue(regionId)} AND year = ${sqlValue(yearA)} LIMIT 1;`
      )[0];
      const rightReport = querySqlite(
        `SELECT id, region_id, year FROM reports WHERE region_id = ${sqlValue(regionId)} AND year = ${sqlValue(yearB)} LIMIT 1;`
      )[0];

      if (!leftReport || !rightReport) {
        return res.status(404).json({ error: '报告不存在' });
      }

      leftReportId = leftReport.id;
      rightReportId = rightReport.id;
    }

    if (leftReportId === undefined || rightReportId === undefined) {
      return res.status(400).json({ error: '报告信息不足，无法创建比对' });
    }

    const leftReport = querySqlite(`SELECT id, region_id, year FROM reports WHERE id = ${sqlValue(leftReportId)} LIMIT 1;`)[0];
    const rightReport = querySqlite(`SELECT id, region_id, year FROM reports WHERE id = ${sqlValue(rightReportId)} LIMIT 1;`)[0];

    if (!leftReport || !rightReport) {
      return res.status(404).json({ error: '报告不存在' });
    }

    if (leftReport.region_id !== rightReport.region_id) {
      return res.status(400).json({ error: '必须比较同一地区的报告' });
    }

    regionId = leftReport.region_id;
    yearA = Math.min(leftReport.year, rightReport.year);
    yearB = Math.max(leftReport.year, rightReport.year);

    if (leftReport.year > rightReport.year) {
      [leftReportId, rightReportId] = [rightReportId, leftReportId];
    }

    const leftVersion = fetchParsedVersion(leftReportId);
    const rightVersion = fetchParsedVersion(rightReportId);

    if (!isParsedReady(leftVersion) || !isParsedReady(rightVersion)) {
      return res.status(409).json({ error: '解析未完成', error_code: 'PARSE_NOT_READY' });
    }

    const existingComparison = querySqlite(`
      SELECT id FROM comparisons WHERE region_id = ${sqlValue(regionId)} AND year_a = ${sqlValue(yearA)} AND year_b = ${sqlValue(yearB)} LIMIT 1;
    `)[0];

    const comparison = querySqlite(`
      INSERT INTO comparisons (region_id, year_a, year_b, left_report_id, right_report_id)
      VALUES (${sqlValue(regionId)}, ${sqlValue(yearA)}, ${sqlValue(yearB)}, ${sqlValue(leftReportId)}, ${sqlValue(rightReportId)})
      ON CONFLICT(region_id, year_a, year_b) DO UPDATE SET
        left_report_id = excluded.left_report_id,
        right_report_id = excluded.right_report_id
      RETURNING id;
    `)[0];

    if (!comparison?.id) {
      return res.status(500).json({ error: 'comparison 创建失败' });
    }

    const existingJob = querySqlite(`
      SELECT id FROM jobs
      WHERE comparison_id = ${sqlValue(comparison.id)} AND status IN ('queued', 'running')
      ORDER BY id DESC
      LIMIT 1;
    `)[0];

    let jobId: number;
    if (existingJob?.id) {
      jobId = existingJob.id;
    } else {
      const newJob = querySqlite(`
        INSERT INTO jobs (report_id, kind, status, progress, comparison_id)
        VALUES (${sqlValue(leftReportId)}, 'compare', 'queued', 0, ${sqlValue(comparison.id)})
        RETURNING id;
      `)[0];
      jobId = newJob.id;
    }

    return res.status(existingComparison ? 200 : 201).json({
      comparison_id: comparison.id,
      job_id: jobId,
    });
  } catch (error) {
    console.error('Error creating comparison:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/comparisons', (req, res) => {
  try {
    const { region_id, year_a, year_b } = req.query;

    ensureSqliteMigrations();

    const conditions: string[] = [];
    if (region_id !== undefined) {
      const regionIdNum = Number(region_id);
      if (!Number.isInteger(regionIdNum) || regionIdNum < 1) {
        return res.status(400).json({ error: 'region_id 无效' });
      }
      conditions.push(`region_id = ${sqlValue(regionIdNum)}`);
    }
    if (year_a !== undefined) {
      const yearANum = Number(year_a);
      if (!Number.isInteger(yearANum)) {
        return res.status(400).json({ error: 'year_a 无效' });
      }
      conditions.push(`year_a = ${sqlValue(yearANum)}`);
    }
    if (year_b !== undefined) {
      const yearBNum = Number(year_b);
      if (!Number.isInteger(yearBNum)) {
        return res.status(400).json({ error: 'year_b 无效' });
      }
      conditions.push(`year_b = ${sqlValue(yearBNum)}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = querySqlite(`
      SELECT
        c.id,
        c.region_id,
        c.year_a,
        c.year_b,
        c.left_report_id,
        c.right_report_id
      FROM comparisons c
      ${whereClause}
      ORDER BY c.id DESC;
    `);

    return res.json({
      data: rows.map((row: any) => ({
        id: row.id,
        region_id: row.region_id,
        year_a: row.year_a,
        year_b: row.year_b,
        left_report_id: row.left_report_id,
        right_report_id: row.right_report_id,
        latest_job: buildLatestJob(row.id),
      })),
    });
  } catch (error) {
    console.error('Error listing comparisons:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/comparisons/:id', (req, res) => {
  try {
    const comparisonId = Number(req.params.id);
    if (!Number.isInteger(comparisonId) || comparisonId < 1) {
      return res.status(400).json({ error: 'comparison_id 无效' });
    }

    ensureSqliteMigrations();

    const comparison = querySqlite(`
      SELECT id, region_id, year_a, year_b, left_report_id, right_report_id
      FROM comparisons
      WHERE id = ${sqlValue(comparisonId)}
      LIMIT 1;
    `)[0];

    if (!comparison) {
      return res.status(404).json({ error: 'comparison 不存在' });
    }

    const resultRow = querySqlite(`
      SELECT diff_json FROM comparison_results WHERE comparison_id = ${sqlValue(comparisonId)} LIMIT 1;
    `)[0];

    let diffJson: any = null;
    if (resultRow?.diff_json !== undefined) {
      diffJson = parseJsonSafe(resultRow.diff_json);
    }

    return res.json({
      id: comparison.id,
      region_id: comparison.region_id,
      year_a: comparison.year_a,
      year_b: comparison.year_b,
      left_report_id: comparison.left_report_id,
      right_report_id: comparison.right_report_id,
      latest_job: buildLatestJob(comparison.id),
      diff_json: diffJson,
    });
  } catch (error) {
    console.error('Error fetching comparison detail:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/comparisons/:id/export', async (req, res) => {
  try {
    const comparisonId = Number(req.params.id);
    if (!Number.isInteger(comparisonId) || comparisonId < 1) {
      return res.status(400).json({ error: 'comparison_id 无效' });
    }

    ensureSqliteMigrations();

    const comparison = querySqlite(`
      SELECT c.id, c.region_id, c.year_a, c.year_b, c.left_report_id, c.right_report_id,
             r.name as region_name
      FROM comparisons c
      LEFT JOIN regions r ON r.id = c.region_id
      WHERE c.id = ${sqlValue(comparisonId)}
      LIMIT 1;
    `)[0];

    if (!comparison) {
      return res.status(404).json({ error: 'comparison 不存在' });
    }

    // Fetch parsed content from both reports
    const leftVersion = fetchParsedVersion(comparison.left_report_id);
    const rightVersion = fetchParsedVersion(comparison.right_report_id);

    const leftParsed = leftVersion?.parsed_json || {};
    const rightParsed = rightVersion?.parsed_json || {};

    // Get unit name from parsed data or reports
    const leftReport = querySqlite(`SELECT unit_name FROM reports WHERE id = ${sqlValue(comparison.left_report_id)} LIMIT 1;`)[0];
    const rightReport = querySqlite(`SELECT unit_name FROM reports WHERE id = ${sqlValue(comparison.right_report_id)} LIMIT 1;`)[0];
    const unitName = leftReport?.unit_name || rightReport?.unit_name || comparison.region_name || '未知单位';

    const paragraphs: Paragraph[] = [];

    // Title
    paragraphs.push(
      new Paragraph({
        text: `${unitName} 政府信息公开年度报告比对分析`,
        heading: HeadingLevel.TITLE,
        spacing: { after: 300 },
      })
    );

    // Basic info
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({ text: `比对年份：${comparison.year_a} 年 vs ${comparison.year_b} 年`, bold: true }),
        ],
        spacing: { after: 200 },
      })
    );

    paragraphs.push(
      new Paragraph({
        text: `生成时间：${new Date().toLocaleString('zh-CN')}`,
        spacing: { after: 300 },
      })
    );

    // Summary section
    paragraphs.push(
      new Paragraph({
        text: '一、比对摘要',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 200 },
      })
    );

    // Extract sections from both reports
    const leftSections = Array.isArray(leftParsed.sections) ? leftParsed.sections : [];
    const rightSections = Array.isArray(rightParsed.sections) ? rightParsed.sections : [];

    const sectionTitles = [
      '一、总体情况',
      '二、主动公开政府信息情况',
      '三、收到和处理政府信息公开申请情况',
      '四、政府信息公开行政复议、行政诉讼情况',
      '五、存在的主要问题及改进情况',
      '六、其他需要报告的事项',
    ];

    // Count sections
    const leftCount = leftSections.length;
    const rightCount = rightSections.length;

    paragraphs.push(
      new Paragraph({
        text: `本次比对分析了 ${comparison.year_a} 年和 ${comparison.year_b} 年两份年度报告，${comparison.year_a} 年报告包含 ${leftCount} 个章节，${comparison.year_b} 年报告包含 ${rightCount} 个章节。`,
        spacing: { after: 200 },
      })
    );

    // Section-by-section comparison
    paragraphs.push(
      new Paragraph({
        text: '二、章节内容对比',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 200 },
      })
    );

    for (const title of sectionTitles) {
      const leftSec = leftSections.find((s: any) => s.title?.includes(title.substring(0, 6)) || s.title === title);
      const rightSec = rightSections.find((s: any) => s.title?.includes(title.substring(0, 6)) || s.title === title);

      paragraphs.push(
        new Paragraph({
          text: title,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 150 },
        })
      );

      // Left year content
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `【${comparison.year_a} 年】`, bold: true }),
          ],
          spacing: { after: 100 },
        })
      );

      if (leftSec?.content) {
        const content = String(leftSec.content).substring(0, 500);
        paragraphs.push(
          new Paragraph({
            text: content + (leftSec.content.length > 500 ? '...(内容已截断)' : ''),
            spacing: { after: 150 },
          })
        );
      } else if (leftSec?.type === 'table_2' || leftSec?.type === 'table_3' || leftSec?.type === 'table_4') {
        paragraphs.push(
          new Paragraph({
            text: '（此章节为表格数据，详见原报告）',
            spacing: { after: 150 },
          })
        );
      } else {
        paragraphs.push(
          new Paragraph({
            text: '（无此章节内容）',
            spacing: { after: 150 },
          })
        );
      }

      // Right year content
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `【${comparison.year_b} 年】`, bold: true }),
          ],
          spacing: { after: 100 },
        })
      );

      if (rightSec?.content) {
        const content = String(rightSec.content).substring(0, 500);
        paragraphs.push(
          new Paragraph({
            text: content + (rightSec.content.length > 500 ? '...(内容已截断)' : ''),
            spacing: { after: 200 },
          })
        );
      } else if (rightSec?.type === 'table_2' || rightSec?.type === 'table_3' || rightSec?.type === 'table_4') {
        paragraphs.push(
          new Paragraph({
            text: '（此章节为表格数据，详见原报告）',
            spacing: { after: 200 },
          })
        );
      } else {
        paragraphs.push(
          new Paragraph({
            text: '（无此章节内容）',
            spacing: { after: 200 },
          })
        );
      }
    }

    // Footer
    paragraphs.push(
      new Paragraph({
        text: '--- 报告结束 ---',
        spacing: { before: 400 },
      })
    );

    const doc = new Document({
      sections: [
        {
          children: paragraphs,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = `comparison_${unitName}_${comparison.year_a}_vs_${comparison.year_b}.docx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    return res.send(buffer);
  } catch (error) {
    console.error('Error exporting comparison docx:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
