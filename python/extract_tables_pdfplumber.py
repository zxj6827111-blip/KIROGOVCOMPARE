#!/usr/bin/env python3
"""
Python 表格提取引擎（pdfplumber）
用于从政府信息公开年报 PDF 中提取三张核心表格

使用方式：
  python3 extract_tables_pdfplumber.py <pdf_path> --schema <schema_path> --out -
"""

import sys
import json
import argparse
import pdfplumber
from typing import Dict, List, Any, Optional, Tuple
import re
import time

# 表格 ID 映射
TABLE_IDS = {
    'sec2_art20_active_disclosure': '表2：主动公开政府信息情况',
    'sec3_requests': '表3：收到和处理政府信息公开申请情况',
    'sec4_review_litigation': '表4：政府信息公开行政复议、行政诉讼情况',
}


class TableExtractor:
    """表格提取器"""

    def __init__(self, schema: Dict[str, Any]):
        self.schema = schema
        # 支持 tables 为 list 或 dict
        tables_raw = schema.get('tables', [])
        if isinstance(tables_raw, list):
            # 转换 list 为 dict（key 为 table id）
            self.tables_schema = {}
            for table_def in tables_raw:
                table_id = table_def.get('id', f'table_{len(self.tables_schema)}')
                self.tables_schema[table_id] = table_def
        else:
            self.tables_schema = tables_raw

    def extract_tables(self, pdf_path: str) -> Dict[str, Any]:
        """从 PDF 中提取所有表格"""
        start_time = time.time()
        result = {
            'schema_version': 'annual_report_table_schema_v2',
            'tables': [],
            'issues': [],
            'confidence': 0.5,
            'runtime': {
                'engine': 'pdfplumber',
                'elapsed_ms': 0,
            },
        }

        try:
            with pdfplumber.open(pdf_path) as pdf:
                # 遍历每个表格定义
                for table_id, table_def in self.tables_schema.items():
                    if table_id not in TABLE_IDS:
                        continue

                    extracted = self._extract_single_table(pdf, table_id, table_def)
                    result['tables'].append(extracted)

        except Exception as e:
            result['issues'].append(f'PDF 打开失败: {str(e)}')
            return result

        # 计算耗时
        elapsed_ms = int((time.time() - start_time) * 1000)
        result['runtime']['elapsed_ms'] = elapsed_ms

        return result

    def _extract_single_table(self, pdf: Any, table_id: str, table_def: Dict[str, Any]) -> Dict[str, Any]:
        """提取单个表格"""
        table_result = {
            'id': table_id,
            'title': table_def.get('title', ''),
            'section': table_def.get('section', ''),
            'rows': [],
            'columns': table_def.get('columns', []),
            'metrics': {
                'totalCells': 0,
                'nonEmptyCells': 0,
                'nonEmptyRatio': 0.0,
                'expectedRows': len(table_def.get('rows', [])),
                'matchedRows': 0,
                'rowMatchRate': 0.0,
                'numericParseRate': 0.0,
            },
            'confidence': 0.0,
            'completeness': 'failed',
            'issues': [],
        }

        try:
            # 获取表格定义中的页码和位置信息
            page_num = table_def.get('page', 0)
            if page_num >= len(pdf.pages):
                table_result['issues'].append(f'页码 {page_num} 超出范围')
                return table_result

            page = pdf.pages[page_num]

            # 尝试从页面中提取表格
            tables = page.extract_tables()
            if not tables:
                table_result['issues'].append('页面中未找到表格')
                return table_result

            # 使用第一个表格（简化版本，实际可能需要更复杂的匹配逻辑）
            extracted_table = tables[0] if tables else None
            if not extracted_table:
                table_result['issues'].append('表格提取失败')
                return table_result

            # 填充单元格数据
            self._populate_cells(table_result, extracted_table, table_def)

            # 计算指标
            self._calculate_metrics(table_result)

            # 判定完整性
            self._determine_completeness(table_result)

        except Exception as e:
            table_result['issues'].append(f'表格提取异常: {str(e)}')

        return table_result

    def _populate_cells(self, table_result: Dict[str, Any], extracted_table: List[List[str]], table_def: Dict[str, Any]) -> None:
        """填充单元格数据"""
        rows = table_def.get('rows', [])
        columns = table_def.get('columns', [])

        total_cells = len(rows) * len(columns)
        table_result['metrics']['totalCells'] = total_cells

        non_empty_count = 0
        numeric_count = 0
        numeric_total = 0
        matched_rows = 0

        for row_idx, row_def in enumerate(rows):
            row_key = row_def.get('key', f'row_{row_idx}')
            row_has_data = False

            for col_idx, col_def in enumerate(columns):
                col_key = col_def.get('key', f'col_{col_idx}')
                cell_key = f'{row_key}__{col_key}'

                # 从提取的表格中获取单元格值
                cell_value = None
                cell_text = ''
                confidence = 0.0

                if row_idx < len(extracted_table) and col_idx < len(extracted_table[row_idx]):
                    cell_text = str(extracted_table[row_idx][col_idx] or '').strip()
                    if cell_text:
                        cell_value = self._parse_cell_value(cell_text)
                        confidence = 0.85  # 简化版本，实际可能需要更复杂的置信度计算
                        non_empty_count += 1
                        row_has_data = True

                        # 检查是否为数值
                        if isinstance(cell_value, (int, float)):
                            numeric_count += 1
                        numeric_total += 1

                table_result['cells'][cell_key] = {
                    'text': cell_text,
                    'value': cell_value,
                    'raw_text': cell_text,
                    'confidence': confidence,
                }

            if row_has_data:
                matched_rows += 1

        table_result['metrics']['nonEmptyCells'] = non_empty_count
        table_result['metrics']['matchedRows'] = matched_rows
        if total_cells > 0:
            table_result['metrics']['nonEmptyRatio'] = non_empty_count / total_cells
        if len(rows) > 0:
            table_result['metrics']['rowMatchRate'] = matched_rows / len(rows)
        if numeric_total > 0:
            table_result['metrics']['numericParseRate'] = numeric_count / numeric_total

    def _parse_cell_value(self, text: str) -> Any:
        """解析单元格值（尝试转换为数值）"""
        text = text.strip()
        if not text:
            return None

        # 尝试解析为整数
        try:
            return int(text)
        except ValueError:
            pass

        # 尝试解析为浮点数
        try:
            return float(text)
        except ValueError:
            pass

        # 返回原始文本
        return text

    def _calculate_metrics(self, table_result: Dict[str, Any]) -> None:
        """计算表格指标"""
        metrics = table_result['metrics']

        # 计算综合置信度（简化版本）
        non_empty_ratio = metrics.get('nonEmptyRatio', 0.0)
        row_match_rate = metrics.get('rowMatchRate', 0.0)
        numeric_parse_rate = metrics.get('numericParseRate', 0.0)

        # 综合置信度 = 0.4 * 非空比例 + 0.4 * 行匹配率 + 0.2 * 数值解析率
        confidence = (
            0.4 * non_empty_ratio +
            0.4 * row_match_rate +
            0.2 * numeric_parse_rate
        )
        table_result['confidence'] = round(confidence, 2)

    def _determine_completeness(self, table_result: Dict[str, Any]) -> None:
        """判定表格完整性"""
        metrics = table_result['metrics']
        confidence = table_result['confidence']

        non_empty_ratio = metrics.get('nonEmptyRatio', 0.0)
        row_match_rate = metrics.get('rowMatchRate', 0.0)

        # 完整性判定规则
        if (non_empty_ratio >= 0.60 and
            row_match_rate >= 0.90 and
            confidence >= 0.80):
            table_result['completeness'] = 'complete'
        elif (non_empty_ratio >= 0.30 or row_match_rate >= 0.50):
            table_result['completeness'] = 'partial'
        else:
            table_result['completeness'] = 'failed'


def load_schema(schema_path: str) -> Dict[str, Any]:
    """加载 schema 文件"""
    try:
        with open(schema_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f'Error loading schema: {e}', file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description='从 PDF 中提取表格')
    parser.add_argument('pdf_path', help='PDF 文件路径')
    parser.add_argument('--schema', required=True, help='Schema 文件路径')
    parser.add_argument('--out', default='-', help='输出文件路径（- 表示 stdout）')

    args = parser.parse_args()

    # 加载 schema
    schema = load_schema(args.schema)

    # 创建提取器
    extractor = TableExtractor(schema)

    # 提取表格
    result = extractor.extract_tables(args.pdf_path)

    # 输出结果
    output = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out == '-':
        print(output)
    else:
        try:
            with open(args.out, 'w', encoding='utf-8') as f:
                f.write(output)
        except Exception as e:
            print(f'Error writing output: {e}', file=sys.stderr)
            sys.exit(1)


if __name__ == '__main__':
    main()
