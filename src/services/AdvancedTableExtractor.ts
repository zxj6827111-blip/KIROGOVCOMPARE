/**
 * 高级表格提取器
 * 使用两阶段策略：网格线优先 + 纯文本兜底
 */

import * as pdfjs from 'pdfjs-dist';

export interface LineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isHorizontal: boolean;
}

export interface TableCell {
  rowIndex: number;
  colIndex: number;
  content: string;
}

export interface ExtractedTable {
  rows: number;
  cols: number;
  cells: TableCell[];
  gridLinesFound: boolean;
}

export class AdvancedTableExtractor {
  /**
   * Stage A: 网格线优先提取
   * 使用 getOperatorList() 提取绘图路径中的线段
   */
  async extractTableWithGridLines(
    page: any,
    tableKeywords: string[],
    pageText: string
  ): Promise<ExtractedTable | null> {
    try {
      // 1. 定位表格位置
      const tableLocation = this.findTableLocation(pageText, tableKeywords);
      if (!tableLocation) {
        console.log('[AdvancedTableExtractor] 未找到表格位置');
        return null;
      }

      // 2. 提取操作列表（包含绘图路径）
      const operatorList = await page.getOperatorList();
      if (!operatorList) {
        console.log('[AdvancedTableExtractor] 无法获取操作列表');
        return null;
      }

      // 3. 从操作列表中提取线段
      const lines = this.extractLinesFromOperatorList(operatorList);
      if (lines.length === 0) {
        console.log('[AdvancedTableExtractor] 未找到线段');
        return null;
      }

      console.log(`[AdvancedTableExtractor] 提取了 ${lines.length} 条线段`);

      // 4. 过滤表格区域内的线段
      const tableLines = this.filterLinesInBbox(lines, tableLocation);
      if (tableLines.length === 0) {
        console.log('[AdvancedTableExtractor] 表格区域内无线段');
        return null;
      }

      console.log(`[AdvancedTableExtractor] 表格区域内有 ${tableLines.length} 条线段`);

      // 5. 聚类得到行边界和列边界
      const { rowBorders, colBorders } = this.clusterLines(tableLines);
      if (rowBorders.length === 0 || colBorders.length === 0) {
        console.log('[AdvancedTableExtractor] 无法聚类得到行列边界');
        return null;
      }

      console.log(`[AdvancedTableExtractor] 聚类得到 ${rowBorders.length} 条行边界，${colBorders.length} 条列边界`);

      // 6. 获取页面文本内容
      const textContent = await page.getTextContent();

      // 7. 将文本投影到单元格
      const cells = this.projectTextToCells(
        textContent.items,
        rowBorders,
        colBorders,
        tableLocation
      );

      console.log(`[AdvancedTableExtractor] 网格线提取成功: ${rowBorders.length - 1} 行 x ${colBorders.length - 1} 列，${cells.length} 个单元格`);

      return {
        rows: rowBorders.length - 1,
        cols: colBorders.length - 1,
        cells,
        gridLinesFound: true,
      };
    } catch (error) {
      console.error('[AdvancedTableExtractor] 网格线提取失败:', error);
      return null;
    }
  }

  /**
   * Stage B: 纯文本兜底提取
   * 当没有网格线时，通过文本坐标聚类推断列边界
   */
  async extractTableWithTextOnly(
    page: any,
    tableKeywords: string[],
    expectedColCount: number
  ): Promise<ExtractedTable | null> {
    try {
      const textContent = await page.getTextContent();
      if (!textContent.items || textContent.items.length === 0) {
        return null;
      }

      // 过滤有坐标的文本项
      const itemsWithCoords = textContent.items.filter((item: any) => {
        if (!item.str || !item.str.trim()) return false;
        if (item.transform && Array.isArray(item.transform) && item.transform.length >= 6) {
          return true;
        }
        return false;
      });

      if (itemsWithCoords.length === 0) {
        return null;
      }

      // 1. 按 Y 坐标聚类成行
      const lines = this.clusterTextByY(itemsWithCoords);
      if (lines.length === 0) {
        return null;
      }

      // 2. 推断列边界
      const colBoundaries = this.inferColumnBoundaries(lines, expectedColCount);
      if (colBoundaries.length === 0) {
        return null;
      }

      // 3. 将文本分配到单元格
      const cells = this.assignTextToCells(lines, colBoundaries);

      console.log(`[AdvancedTableExtractor] 纯文本提取成功: ${lines.length} 行 x ${colBoundaries.length - 1} 列`);

      return {
        rows: lines.length,
        cols: colBoundaries.length - 1,
        cells,
        gridLinesFound: false,
      };
    } catch (error) {
      console.error('[AdvancedTableExtractor] 纯文本提取失败:', error);
      return null;
    }
  }

  /**
   * 定位表格位置
   */
  private findTableLocation(pageText: string, keywords: string[]): any {
    for (const keyword of keywords) {
      const idx = pageText.indexOf(keyword);
      if (idx !== -1) {
        // 简化：假设表格在关键字下方
        return {
          top: 0,
          bottom: 1000,
          left: 0,
          right: 1000,
        };
      }
    }
    return null;
  }

  /**
   * 从操作列表中提取线段
   * 追踪 constructPath 操作来构建线段
   * PDF.js 使用数字编码操作：
   * - 1 = moveTo (m)
   * - 2 = lineTo (l)
   * - 3 = curveTo (c)
   * - 4 = closePath (h)
   * - 5 = rectangle (re)
   */
  private extractLinesFromOperatorList(operatorList: any): LineSegment[] {
    const lines: LineSegment[] = [];
    
    try {
      const { fnArray, argsArray } = operatorList;
      
      let currentPath: Array<{ x: number; y: number }> = [];
      let lastX = 0;
      let lastY = 0;

      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i];
        const args = argsArray[i] || [];

        // 1 = moveTo: 开始新路径
        if (fn === 1) {
          if (args.length >= 2) {
            lastX = args[0];
            lastY = args[1];
            currentPath = [{ x: lastX, y: lastY }];
          }
        }
        // 2 = lineTo: 添加线段
        else if (fn === 2) {
          if (args.length >= 2) {
            const x = args[0];
            const y = args[1];
            currentPath.push({ x, y });
            
            // 记录线段
            lines.push({
              x1: lastX,
              y1: lastY,
              x2: x,
              y2: y,
              isHorizontal: Math.abs(y - lastY) < 0.1,
            });
            
            lastX = x;
            lastY = y;
          }
        }
        // 3 = curveTo: 贝塞尔曲线（跳过）
        else if (fn === 3) {
          if (args.length >= 6) {
            lastX = args[4];
            lastY = args[5];
          }
        }
        // 4 = closePath: 闭合路径
        else if (fn === 4) {
          if (currentPath.length > 0) {
            const first = currentPath[0];
            lines.push({
              x1: lastX,
              y1: lastY,
              x2: first.x,
              y2: first.y,
              isHorizontal: Math.abs(first.y - lastY) < 0.1,
            });
            lastX = first.x;
            lastY = first.y;
          }
        }
        // 5 = rectangle: 矩形（可能用于表格边框）
        else if (fn === 5) {
          if (args.length >= 4) {
            const x = args[0];
            const y = args[1];
            const w = args[2];
            const h = args[3];
            
            // 矩形的四条边
            lines.push({ x1: x, y1: y, x2: x + w, y2: y, isHorizontal: true });
            lines.push({ x1: x + w, y1: y, x2: x + w, y2: y + h, isHorizontal: false });
            lines.push({ x1: x + w, y1: y + h, x2: x, y2: y + h, isHorizontal: true });
            lines.push({ x1: x, y1: y + h, x2: x, y2: y, isHorizontal: false });
          }
        }
      }
    } catch (error) {
      console.error('[AdvancedTableExtractor] 提取线段失败:', error);
    }

    return lines;
  }

  /**
   * 过滤表格区域内的线段
   */
  private filterLinesInBbox(lines: any[], bbox: any): any[] {
    return lines.filter(line => {
      // 简化实现：返回所有线段
      return true;
    });
  }

  /**
   * 聚类线段得到行列边界
   * 阈值 1~2px
   */
  private clusterLines(lines: LineSegment[]): { rowBorders: number[]; colBorders: number[] } {
    const threshold = 2; // 聚类阈值
    const horizontalLines: number[] = [];
    const verticalLines: number[] = [];

    // 分离水平线和竖线
    for (const line of lines) {
      if (line.isHorizontal) {
        // 水平线：使用 y 坐标
        horizontalLines.push(line.y1);
      } else {
        // 竖线：使用 x 坐标
        verticalLines.push(line.x1);
      }
    }

    // 聚类水平线得到行边界
    const rowBorders = this.clusterCoordinates(horizontalLines, threshold);
    
    // 聚类竖线得到列边界
    const colBorders = this.clusterCoordinates(verticalLines, threshold);

    return { rowBorders, colBorders };
  }

  /**
   * 聚类坐标
   * 将相近的坐标合并为一个
   */
  private clusterCoordinates(coords: number[], threshold: number): number[] {
    if (coords.length === 0) return [];

    // 排序
    coords.sort((a, b) => a - b);

    // 聚类
    const clusters: number[] = [];
    let currentCluster = [coords[0]];

    for (let i = 1; i < coords.length; i++) {
      if (coords[i] - currentCluster[currentCluster.length - 1] < threshold) {
        currentCluster.push(coords[i]);
      } else {
        // 计算聚类的平均值
        const avg = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
        clusters.push(avg);
        currentCluster = [coords[i]];
      }
    }

    // 处理最后一个聚类
    if (currentCluster.length > 0) {
      const avg = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
      clusters.push(avg);
    }

    return clusters;
  }

  /**
   * 将文本投影到单元格
   * 从 item.transform 提取坐标，投影到行列边界
   */
  private projectTextToCells(
    items: any[],
    rowBorders: number[],
    colBorders: number[],
    bbox: any
  ): TableCell[] {
    const cellMap = new Map<string, string[]>();

    for (const item of items) {
      if (!item.str || !item.str.trim()) continue;

      // 从 transform 提取坐标
      let x = 0;
      let y = 0;

      if (item.transform && Array.isArray(item.transform) && item.transform.length >= 6) {
        x = item.transform[4];
        y = item.transform[5];
      } else {
        continue; // 没有坐标信息，跳过
      }

      // 计算文本中心点
      const centerX = x + (item.width || 0) / 2;
      const centerY = y;

      // 找到对应的行和列
      let rowIndex = -1;
      let colIndex = -1;

      // 查找行
      for (let i = 0; i < rowBorders.length - 1; i++) {
        if (centerY >= rowBorders[i] && centerY < rowBorders[i + 1]) {
          rowIndex = i;
          break;
        }
      }

      // 查找列
      for (let i = 0; i < colBorders.length - 1; i++) {
        if (centerX >= colBorders[i] && centerX < colBorders[i + 1]) {
          colIndex = i;
          break;
        }
      }

      if (rowIndex !== -1 && colIndex !== -1) {
        const key = `${rowIndex}_${colIndex}`;
        if (!cellMap.has(key)) {
          cellMap.set(key, []);
        }
        cellMap.get(key)!.push(item.str);
      }
    }

    // 转换为 TableCell 数组
    const cells: TableCell[] = [];
    for (const [key, texts] of cellMap.entries()) {
      const [rowIndex, colIndex] = key.split('_').map(Number);
      cells.push({
        rowIndex,
        colIndex,
        content: texts.join(' '),
      });
    }

    return cells;
  }

  /**
   * 按 Y 坐标聚类文本成行
   * 从 item.transform 提取坐标
   */
  private clusterTextByY(items: any[]): any[] {
    const yGroups = new Map<number, any[]>();
    const threshold = 3; // Y 坐标阈值

    for (const item of items) {
      if (!item.str || !item.str.trim()) continue;

      // 从 transform 提取坐标
      let y = 0;
      if (item.transform && Array.isArray(item.transform) && item.transform.length >= 6) {
        y = item.transform[5]; // transform[5] 是 y 坐标
      } else {
        continue;
      }

      let foundGroup = false;
      for (const [groupY, groupItems] of yGroups.entries()) {
        if (Math.abs(y - groupY) < threshold) {
          groupItems.push(item);
          foundGroup = true;
          break;
        }
      }

      if (!foundGroup) {
        yGroups.set(y, [item]);
      }
    }

    // 按 Y 坐标从大到小排序（PDF 坐标系）
    const sortedYs = Array.from(yGroups.keys()).sort((a, b) => b - a);

    // 每行按 X 坐标排序
    const lines: any[] = [];
    for (const y of sortedYs) {
      const lineItems = yGroups.get(y)!.sort((a, b) => {
        const aX = a.transform ? a.transform[4] : 0;
        const bX = b.transform ? b.transform[4] : 0;
        return aX - bX;
      });
      lines.push(lineItems);
    }

    return lines;
  }

  /**
   * 推断列边界
   * 从 transform 提取 X 坐标，聚类得到列边界
   */
  private inferColumnBoundaries(lines: any[], expectedColCount: number): number[] {
    if (lines.length === 0) return [];

    // 收集所有 X 坐标
    const xCoords: number[] = [];
    for (const line of lines) {
      for (const item of line) {
        if (item.transform && Array.isArray(item.transform) && item.transform.length >= 6) {
          const x = item.transform[4];
          const width = item.width || 0;
          xCoords.push(x);
          xCoords.push(x + width);
        }
      }
    }

    if (xCoords.length === 0) {
      return [];
    }

    // 排序
    xCoords.sort((a, b) => a - b);

    // 聚类相近的 X 坐标（阈值 5px）
    const threshold = 5;
    const clusters: number[] = [];
    let currentCluster = [xCoords[0]];

    for (let i = 1; i < xCoords.length; i++) {
      if (xCoords[i] - currentCluster[currentCluster.length - 1] < threshold) {
        currentCluster.push(xCoords[i]);
      } else {
        const avg = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
        clusters.push(avg);
        currentCluster = [xCoords[i]];
      }
    }

    if (currentCluster.length > 0) {
      const avg = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
      clusters.push(avg);
    }

    // 如果聚类数量与期望列数接近，使用聚类结果
    if (clusters.length >= expectedColCount - 1 && clusters.length <= expectedColCount + 1) {
      return clusters;
    }

    // 否则均匀分割
    const minX = xCoords[0];
    const maxX = xCoords[xCoords.length - 1];
    const colWidth = (maxX - minX) / expectedColCount;

    const boundaries: number[] = [];
    for (let i = 0; i <= expectedColCount; i++) {
      boundaries.push(minX + i * colWidth);
    }

    return boundaries;
  }

  /**
   * 将文本分配到单元格
   * 从 transform 提取坐标，分配到列边界
   */
  private assignTextToCells(lines: any[], colBoundaries: number[]): TableCell[] {
    const cellMap = new Map<string, string[]>();

    for (let rowIndex = 0; rowIndex < lines.length; rowIndex++) {
      const line = lines[rowIndex];

      for (const item of line) {
        if (!item.str || !item.str.trim()) continue;

        // 从 transform 提取坐标
        let x = 0;
        if (item.transform && Array.isArray(item.transform) && item.transform.length >= 6) {
          x = item.transform[4];
        } else {
          continue;
        }

        // 计算文本中心点
        const centerX = x + (item.width || 0) / 2;

        // 找到对应的列
        let colIndex = -1;
        for (let i = 0; i < colBoundaries.length - 1; i++) {
          if (centerX >= colBoundaries[i] && centerX < colBoundaries[i + 1]) {
            colIndex = i;
            break;
          }
        }

        if (colIndex !== -1) {
          const key = `${rowIndex}_${colIndex}`;
          if (!cellMap.has(key)) {
            cellMap.set(key, []);
          }
          cellMap.get(key)!.push(item.str);
        }
      }
    }

    // 转换为 TableCell 数组
    const cells: TableCell[] = [];
    for (const [key, texts] of cellMap.entries()) {
      const [rowIndex, colIndex] = key.split('_').map(Number);
      cells.push({
        rowIndex,
        colIndex,
        content: texts.join(' '),
      });
    }

    return cells;
  }
}

export default new AdvancedTableExtractor();
