import express, { Request, Response } from 'express';
import { Packer, Document, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun } from 'docx';
import TaskService from '../services/TaskService';
import AssetService from '../services/AssetService';

const router = express.Router();

function buildDocx({
  title,
  generatedAt,
  overview,
  keyPaths,
}: {
  title: string;
  generatedAt: string;
  overview: { changed: number; added: number; removed: number };
  keyPaths: string[];
}): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({
            children: [new TextRun({ text: `生成时间：${generatedAt}` })],
            spacing: { after: 200 },
          }),
          new Paragraph({ text: '差异概览', heading: HeadingLevel.HEADING_2 }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('变更类型')] }),
                  new TableCell({ children: [new Paragraph('数量')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('修改')] }),
                  new TableCell({ children: [new Paragraph(`${overview.changed}`)] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('新增')] }),
                  new TableCell({ children: [new Paragraph(`${overview.added}`)] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('删除')] }),
                  new TableCell({ children: [new Paragraph(`${overview.removed}`)] }),
                ],
              }),
            ],
          }),
          new Paragraph({ text: '关键变化路径', heading: HeadingLevel.HEADING_2 }),
          ...keyPaths.map(
            (item) =>
              new Paragraph({
                text: item,
                bullet: {
                  level: 0,
                },
              })
          ),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

router.get('/:id/export', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const format = (req.query.format as string) || 'docx';

    if (format !== 'docx') {
      return res.status(400).json({ error: 'Unsupported format' });
    }

    const task = await TaskService.getTaskById(id);
    if (!task) {
      return res.status(404).json({ error_code: 'COMPARE_NOT_READY', error: '任务不存在' });
    }

    if (task.status !== 'succeeded') {
      return res.status(409).json({ error_code: 'COMPARE_NOT_READY', error: '任务未完成' });
    }

    const diffResult = await TaskService.getViewModelForTask(id);
    if (!diffResult) {
      return res.status(404).json({ error_code: 'COMPARE_NOT_READY', error: '无比对结果' });
    }

    const [assetA, assetB] = await Promise.all([
      AssetService.getAssetById(task.assetId_A),
      AssetService.getAssetById(task.assetId_B),
    ]);

    const title = `${assetA?.region || '未知区域'} 年报比对 (${assetA?.year || '未知年份'} vs ${
      assetB?.year || '未知年份'
    })`;

    const stats = task.summary?.statistics || {};
    const overview = {
      changed: (stats.modifiedParagraphs || 0) + (stats.modifiedTables || 0),
      added: (stats.addedParagraphs || 0) + (stats.addedTables || 0),
      removed: (stats.deletedParagraphs || 0) + (stats.deletedTables || 0),
    };

    const keyPaths: string[] = [];
    const limit = 10;
    for (const section of diffResult.sections || []) {
      if (keyPaths.length >= limit) break;
      keyPaths.push(section.sectionTitle || '未命名章节');
      if (keyPaths.length >= limit) break;

      for (const para of section.paragraphs || []) {
        if (keyPaths.length >= limit) break;
        keyPaths.push(`${section.sectionTitle || '章节'} - 段落 ${para.type}`);
      }

      for (const table of section.tables || []) {
        if (keyPaths.length >= limit) break;
        keyPaths.push(`${section.sectionTitle || '章节'} - 表格 ${table.tableId || table.type}`);
      }
    }

    const buffer = await buildDocx({
      title,
      generatedAt: new Date().toISOString(),
      overview,
      keyPaths,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="comparison-${id}.docx"`);
    res.send(buffer);
  } catch (error) {
    console.error('导出比对结果失败:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
