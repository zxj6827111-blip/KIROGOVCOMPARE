#!/usr/bin/env python3
"""
Python v3 表格提取引擎 - 关键词定位 + crop + 候选表打分 + 行标签对齐

核心能力：
1. 定位页：按 schema locateKeywords 在全 PDF pages 里找最匹配页
2. 定位区域（crop）：用 page.search(keyword) 拿到匹配块坐标，裁剪区域
3. 无网格线策略：支持 vertical_strategy='text'、horizontal_strategy='text'
4. 候选表选优：对每个候选表计算 score，选最高者
5. 按 schema 行标签对齐取数：用 match 定位实际行，抽取对应数值列
6. 指标输出：nonEmptyCells、matchedRows、numericParseRate、confidence、issues
"""

import json
import sys
import argparse
from typing import Dict, List, Tuple, Optional, Any
import pdfplumber
import re
from pathlib import Path


class TableExtractorV3:
    def __init__(self, pdf_path: str, schema: Dict[str, Any]):
        self.pdf_path = pdf_path
        self.schema = schema
        self.pdf = pdfplumber.open(pdf_path)
        self.results = {
            'tables': [],
            'metrics': {
                'total_pages': len(self.pdf.pages),
                'pages_searched': 0,
                'tables_found': 0,
            },
            'issues': []
        }

    def locate_page(self) -> Optional[int]:
        """
        按 schema locateKeywords 在全 PDF pages 里找最匹配页
        返回页码（0-based），如果找不到返回 None
        """
        locate_keywords = self.schema.get('locateKeywords', [])
        if not locate_keywords:
            self.results['issues'].append('no_locate_keywords')
            return None

        best_page_idx = None
        best_score = 0

        for page_idx, page in enumerate(self.pdf.pages):
            page_text = page.extract_text() or ''
            
            # 计算匹配分数：匹配关键词数 + 关键词长度权重
            matched_keywords = []
            for keyword in locate_keywords:
                if keyword.lower() in page_text.lower():
                    matched_keywords.append(keyword)
            
            if matched_keywords:
                # 分数 = 匹配关键词数 * 10 + 总关键词长度
                score = len(matched_keywords) * 10 + sum(len(k) for k in matched_keywords)
                
                if score > best_score:
                    best_score = score
                    best_page_idx = page_idx

        if best_page_idx is None:
            self.results['issues'].append('page_not_found')
            return None

        self.results['metrics']['pages_searched'] = len(self.pdf.pages)
        return best_page_idx

    def locate_region(self, page, keyword: str) -> Optional[Tuple[float, float, float, float]]:
        """
        用 page.search(keyword) 拿到匹配块坐标，返回 (top, bottom, left, right)
        """
        try:
            search_results = page.search(keyword)
            if not search_results:
                return None
            
            # 取第一个匹配结果的坐标
            result = search_results[0]
            return (result['top'], result['bottom'], result['left'], result['right'])
        except Exception:
            return None

    def crop_region(self, page, top: float, bottom: float) -> Any:
        """
        裁剪页面的指定区域（从 top 到 bottom）
        """
        try:
            return page.crop((0, top, page.width, bottom))
        except Exception:
            return None

    def extract_tables_from_region(self, cropped_page) -> List[List[List[str]]]:
        """
        从裁剪后的区域提取表格，支持无网格线策略
        """
        try:
            # 尝试多种策略
            strategies = [
                {'vertical_strategy': 'lines', 'horizontal_strategy': 'lines'},
                {'vertical_strategy': 'text', 'horizontal_strategy': 'text'},
                {'vertical_strategy': 'lines_strict', 'horizontal_strategy': 'lines_strict'},
            ]
            
            for strategy in strategies:
                try:
                    tables = cropped_page.extract_tables(table_settings=strategy)
                    if tables:
                        return tables
                except Exception:
                    continue
            
            return []
        except Exception:
            return []

    def score_table(self, table: List[List[str]], schema_rows: List[Dict], schema_cols: List[Dict]) -> float:
        """
        对候选表计算分数：
        - 命中 schema.rows[*].match 的行数
        - 命中 schema.columns[*].name 的表头词
        """
        if not table or not table[0]:
            return 0.0

        score = 0.0
        max_score = 0.0

        # 表头匹配分数
        header_row = table[0]
        for col_def in schema_cols:
            max_score += 1.0
            col_name = col_def.get('name', '')
            for cell in header_row:
                if cell and col_name.lower() in cell.lower():
                    score += 1.0
                    break

        # 行标签匹配分数
        for row_def in schema_rows:
            max_score += 1.0
            row_match = row_def.get('match', '')
            for row in table[1:]:  # 跳过表头
                if row and row_match.lower() in str(row[0]).lower():
                    score += 1.0
                    break

        if max_score == 0:
            return 0.0

        return score / max_score

    def align_and_extract_row(self, table: List[List[str]], row_def: Dict, schema_cols: List[Dict]) -> Tuple[List[str], int]:
        """
        按 schema 行标签对齐，从表格中提取对应行的数据
        返回 (row_data, matched_row_idx)
        """
        row_match = row_def.get('match', '')
        matched_row_idx = -1

        # 在表格中找到匹配的行
        for idx, row in enumerate(table[1:], start=1):  # 跳过表头
            if row and row_match.lower() in str(row[0]).lower():
                matched_row_idx = idx
                break

        if matched_row_idx == -1:
            return [], -1

        # 提取该行的数据
        row_data = table[matched_row_idx]
        return row_data, matched_row_idx

    def calculate_metrics(self, table_data: Dict) -> Dict:
        """
        计算表格指标：
        - nonEmptyCells / totalCells
        - matchedRows / expectedRows
        - numericParseRate
        - confidence
        """
        cells = table_data.get('cells', {})
        rows = table_data.get('rows', [])
        columns = table_data.get('columns', [])

        # 非空单元格数
        non_empty_cells = sum(1 for v in cells.values() if v and str(v).strip())
        total_cells = len(rows) * len(columns) if rows and columns else 0

        # 行匹配率
        matched_rows = sum(1 for r in rows if r.get('matched', False))
        expected_rows = len(rows)
        matched_rows_rate = matched_rows / expected_rows if expected_rows > 0 else 0

        # 数值解析率
        numeric_cells = 0
        numeric_parsed = 0
        for v in cells.values():
            if v and str(v).strip():
                numeric_cells += 1
                try:
                    float(str(v).replace(',', '').replace('万', '').replace('元', '').strip())
                    numeric_parsed += 1
                except ValueError:
                    pass

        numeric_parse_rate = numeric_parsed / numeric_cells if numeric_cells > 0 else 0

        # 置信度 = (行匹配率 + 数值解析率 + 非空率) / 3
        non_empty_rate = non_empty_cells / total_cells if total_cells > 0 else 0
        confidence = (matched_rows_rate + numeric_parse_rate + non_empty_rate) / 3

        return {
            'nonEmptyCells': non_empty_cells,
            'totalCells': total_cells,
            'matchedRows': matched_rows,
            'expectedRows': expected_rows,
            'numericParseRate': round(numeric_parse_rate, 2),
            'confidence': round(confidence, 2),
        }

    def extract_table(self, table_id: str, table_def: Dict, page_idx: int, page) -> Optional[Dict]:
        """
        提取单个表格
        """
        schema_rows = self.schema.get('rows', [])
        schema_cols = self.schema.get('columns', [])

        # 定位区域
        locate_keyword = table_def.get('locateKeyword', '')
        if not locate_keyword:
            return None

        region = self.locate_region(page, locate_keyword)
        if not region:
            return {
                'id': table_id,
                'section': table_def.get('section', ''),
                'rows': [],
                'columns': schema_cols,
                'cells': {},
                'metrics': {'nonEmptyCells': 0, 'totalCells': 0, 'matchedRows': 0, 'expectedRows': len(schema_rows)},
                'confidence': 0.0,
                'issues': ['table_not_found'],
                'source': 'python',
            }

        top, bottom, left, right = region
        # 扩展区域（向下扩展以包含完整表格）
        bottom = min(bottom + 200, page.height)

        cropped_page = self.crop_region(page, top, bottom)
        if not cropped_page:
            return None

        # 提取表格
        tables = self.extract_tables_from_region(cropped_page)
        if not tables:
            return {
                'id': table_id,
                'section': table_def.get('section', ''),
                'rows': [],
                'columns': schema_cols,
                'cells': {},
                'metrics': {'nonEmptyCells': 0, 'totalCells': 0, 'matchedRows': 0, 'expectedRows': len(schema_rows)},
                'confidence': 0.0,
                'issues': ['no_text'],
                'source': 'python',
            }

        # 候选表选优
        best_table = None
        best_score = 0
        for table in tables:
            score = self.score_table(table, schema_rows, schema_cols)
            if score > best_score:
                best_score = score
                best_table = table

        if not best_table:
            best_table = tables[0]

        # 按 schema 行标签对齐取数
        cells = {}
        rows_data = []
        issues = []

        for row_def in schema_rows:
            row_key = row_def.get('key', '')
            row_data, matched_idx = self.align_and_extract_row(best_table, row_def, schema_cols)

            if matched_idx == -1:
                rows_data.append({'key': row_key, 'matched': False})
                issues.append(f'row_not_matched:{row_key}')
            else:
                rows_data.append({'key': row_key, 'matched': True})
                # 提取该行的数据
                for col_idx, col_def in enumerate(schema_cols):
                    col_key = col_def.get('key', '')
                    cell_value = row_data[col_idx] if col_idx < len(row_data) else ''
                    # 不转换为 0，保持原值或空字符串
                    cells[f'{row_key}_{col_key}'] = cell_value if cell_value else ''

        # 计算指标
        table_data = {
            'id': table_id,
            'section': table_def.get('section', ''),
            'rows': rows_data,
            'columns': schema_cols,
            'cells': cells,
        }
        metrics = self.calculate_metrics(table_data)

        return {
            'id': table_id,
            'section': table_def.get('section', ''),
            'rows': rows_data,
            'columns': schema_cols,
            'cells': cells,
            'metrics': metrics,
            'confidence': metrics['confidence'],
            'issues': issues,
            'source': 'python',
        }

    def extract_all_tables(self) -> Dict:
        """
        提取所有表格
        """
        # 定位页
        page_idx = self.locate_page()
        if page_idx is None:
            return self.results

        page = self.pdf.pages[page_idx]

        # 提取每个表格
        tables_def = self.schema.get('tables', [])
        for table_def in tables_def:
            table_id = table_def.get('id', '')
            table_result = self.extract_table(table_id, table_def, page_idx, page)
            if table_result:
                self.results['tables'].append(table_result)
                self.results['metrics']['tables_found'] += 1

        return self.results

    def close(self):
        """关闭 PDF"""
        if self.pdf:
            self.pdf.close()


def main():
    parser = argparse.ArgumentParser(description='Python v3 表格提取引擎')
    parser.add_argument('pdf_path', help='PDF 文件路径')
    parser.add_argument('--schema', required=True, help='Schema JSON 文件路径')
    parser.add_argument('--out', default='-', help='输出文件路径（默认 stdout）')

    args = parser.parse_args()

    # 读取 schema
    try:
        with open(args.schema, 'r', encoding='utf-8') as f:
            schema = json.load(f)
    except Exception as e:
        print(json.dumps({'error': f'Failed to load schema: {str(e)}'}), file=sys.stderr)
        sys.exit(1)

    # 提取表格
    try:
        extractor = TableExtractorV3(args.pdf_path, schema)
        results = extractor.extract_all_tables()
        extractor.close()

        # 输出结果
        output = json.dumps(results, ensure_ascii=False, indent=2)
        if args.out == '-':
            print(output)
        else:
            with open(args.out, 'w', encoding='utf-8') as f:
                f.write(output)

    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
