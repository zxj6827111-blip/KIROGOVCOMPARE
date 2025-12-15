#!/usr/bin/env python3
"""
简化版 Python 表格提取引擎（pdfplumber）
用于从政府信息公开年报 PDF 中提取表格

使用方式：
  python3 extract_tables_pdfplumber_v2.py <pdf_path> --schema <schema_path> --out -
"""

import sys
import json
import argparse
import pdfplumber
from typing import Dict, List, Any
import time


def load_schema(schema_path: str) -> Dict[str, Any]:
    """加载 schema 文件"""
    try:
        with open(schema_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f'Error loading schema: {e}', file=sys.stderr)
        sys.exit(1)


def extract_tables_from_pdf(pdf_path: str, schema: Dict[str, Any]) -> Dict[str, Any]:
    """从 PDF 中提取表格"""
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
            # 获取 schema 中的表格定义
            tables_raw = schema.get('tables', [])
            
            # 如果是 dict 格式，转换为 list
            if isinstance(tables_raw, dict):
                tables_raw = list(tables_raw.values())

            # 遍历每个表格定义
            for table_def in tables_raw:
                table_id = table_def.get('id', 'unknown')
                page_num = table_def.get('page', 0)

                # 检查页码是否有效
                if page_num >= len(pdf.pages):
                    result['issues'].append(f'表格 {table_id}: 页码 {page_num} 超出范围')
                    continue

                # 提取单个表格
                table_result = extract_single_table(
                    pdf.pages[page_num],
                    table_id,
                    table_def
                )
                result['tables'].append(table_result)

    except Exception as e:
        result['issues'].append(f'PDF 打开失败: {str(e)}')
        return result

    # 计算耗时
    elapsed_ms = int((time.time() - start_time) * 1000)
    result['runtime']['elapsed_ms'] = elapsed_ms

    return result


def extract_single_table(page: Any, table_id: str, table_def: Dict[str, Any]) -> Dict[str, Any]:
    """从页面中提取单个表格"""
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
        # 从页面中提取所有表格
        tables = page.extract_tables()
        
        if not tables or len(tables) == 0:
            table_result['issues'].append('页面中未找到表格')
            return table_result

        # 使用第一个表格
        extracted_table = tables[0]
        
        if not extracted_table or len(extracted_table) == 0:
            table_result['issues'].append('表格为空')
            return table_result

        # 填充行数据
        rows_def = table_def.get('rows', [])
        cols_def = table_def.get('columns', [])
        
        total_cells = len(rows_def) * len(cols_def)
        table_result['metrics']['totalCells'] = total_cells

        non_empty_count = 0
        numeric_count = 0
        numeric_total = 0
        matched_rows = 0

        # 遍历每一行
        for row_idx, row_def in enumerate(rows_def):
            row_key = row_def.get('key', f'row_{row_idx}')
            row_label = row_def.get('label', '')
            
            # 从提取的表格中获取对应行
            if row_idx < len(extracted_table):
                extracted_row = extracted_table[row_idx]
                row_has_data = False

                # 构建行数据
                row_data = {
                    'rowIndex': row_idx,
                    'rowKey': row_key,
                    'rowLabel': row_label,
                    'cells': []
                }

                # 遍历每一列
                for col_idx, col_def in enumerate(cols_def):
                    col_key = col_def.get('key', f'col_{col_idx}')
                    col_name = col_def.get('name', '')
                    col_type = col_def.get('type', 'string')

                    # 获取单元格值
                    cell_value = ''
                    if col_idx < len(extracted_row):
                        cell_value = str(extracted_row[col_idx] or '').strip()

                    # 构建单元格
                    cell = {
                        'rowIndex': row_idx,
                        'colIndex': col_idx,
                        'colKey': col_key,
                        'colName': col_name,
                        'colType': col_type,
                        'value': cell_value,
                        'rawValue': cell_value,
                    }

                    row_data['cells'].append(cell)

                    # 统计非空单元格
                    if cell_value:
                        non_empty_count += 1
                        row_has_data = True

                        # 统计数字解析
                        if col_type == 'number':
                            numeric_total += 1
                            try:
                                float(cell_value.replace(',', ''))
                                numeric_count += 1
                            except ValueError:
                                pass

                if row_has_data:
                    matched_rows += 1

                table_result['rows'].append(row_data)
            else:
                # 行不存在，创建空行
                row_data = {
                    'rowIndex': row_idx,
                    'rowKey': row_key,
                    'rowLabel': row_label,
                    'cells': []
                }

                for col_idx, col_def in enumerate(cols_def):
                    cell = {
                        'rowIndex': row_idx,
                        'colIndex': col_idx,
                        'colKey': col_def.get('key', f'col_{col_idx}'),
                        'colName': col_def.get('name', ''),
                        'colType': col_def.get('type', 'string'),
                        'value': '',
                        'rawValue': '',
                    }
                    row_data['cells'].append(cell)

                table_result['rows'].append(row_data)

        # 更新指标
        table_result['metrics']['nonEmptyCells'] = non_empty_count
        if total_cells > 0:
            table_result['metrics']['nonEmptyRatio'] = non_empty_count / total_cells
        if len(rows_def) > 0:
            table_result['metrics']['matchedRows'] = matched_rows
            table_result['metrics']['rowMatchRate'] = matched_rows / len(rows_def)
        if numeric_total > 0:
            table_result['metrics']['numericParseRate'] = numeric_count / numeric_total

        # 计算置信度
        non_empty_ratio = table_result['metrics']['nonEmptyRatio']
        row_match_rate = table_result['metrics']['rowMatchRate']
        numeric_parse_rate = table_result['metrics']['numericParseRate']

        confidence = (
            0.4 * non_empty_ratio +
            0.4 * row_match_rate +
            0.2 * numeric_parse_rate
        )
        table_result['confidence'] = round(confidence, 2)

        # 判定完整性
        if (non_empty_ratio >= 0.60 and
            row_match_rate >= 0.90 and
            confidence >= 0.80):
            table_result['completeness'] = 'complete'
        elif (non_empty_ratio >= 0.30 or row_match_rate >= 0.50):
            table_result['completeness'] = 'partial'
        else:
            table_result['completeness'] = 'failed'

    except Exception as e:
        table_result['issues'].append(f'表格提取异常: {str(e)}')

    return table_result


def main():
    parser = argparse.ArgumentParser(description='从 PDF 中提取表格')
    parser.add_argument('pdf_path', help='PDF 文件路径')
    parser.add_argument('--schema', required=True, help='Schema 文件路径')
    parser.add_argument('--out', default='-', help='输出文件路径（- 表示 stdout）')

    args = parser.parse_args()

    # 加载 schema
    schema = load_schema(args.schema)

    # 提取表格
    result = extract_tables_from_pdf(args.pdf_path, schema)

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
