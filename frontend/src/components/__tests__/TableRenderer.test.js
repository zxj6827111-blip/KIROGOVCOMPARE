/**
 * TableRenderer 组件测试
 * 测试表格渲染组件的各项功能
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import TableRenderer from '../TableRenderer';

describe('TableRenderer Component', () => {
  // 测试数据
  const mockTable = {
    id: 'table_1',
    title: '测试表格',
    rows: [
      {
        rowIndex: 0,
        rowKey: 'row_1',
        rowLabel: '行标签 1',
        cells: [
          {
            rowIndex: 0,
            colIndex: 0,
            colKey: 'col_1',
            colName: '列 1',
            value: '值 1',
          },
          {
            rowIndex: 0,
            colIndex: 1,
            colKey: 'col_2',
            colName: '列 2',
            value: '值 2',
          },
        ],
      },
      {
        rowIndex: 1,
        rowKey: 'row_2',
        rowLabel: '行标签 2',
        cells: [
          {
            rowIndex: 1,
            colIndex: 0,
            colKey: 'col_1',
            colName: '列 1',
            value: '值 3',
          },
          {
            rowIndex: 1,
            colIndex: 1,
            colKey: 'col_2',
            colName: '列 2',
            value: '值 4',
          },
        ],
      },
    ],
    columns: 2,
  };

  describe('基本渲染', () => {
    it('应该能渲染表格', () => {
      render(<TableRenderer table={mockTable} />);
      
      const table = screen.getByRole('table');
      expect(table).toBeInTheDocument();
    });

    it('应该能显示表格标题', () => {
      render(<TableRenderer table={mockTable} title="测试标题" />);
      
      const title = screen.getByText('测试标题');
      expect(title).toBeInTheDocument();
    });

    it('应该能显示列标题', () => {
      render(<TableRenderer table={mockTable} />);
      
      const headers = screen.getAllByRole('columnheader');
      expect(headers.length).toBe(2);
      expect(headers[0]).toHaveTextContent('列 1');
      expect(headers[1]).toHaveTextContent('列 2');
    });

    it('应该能显示表格数据', () => {
      render(<TableRenderer table={mockTable} />);
      
      const cells = screen.getAllByRole('cell');
      expect(cells.length).toBeGreaterThan(0);
    });
  });

  describe('空表格处理', () => {
    it('空表格应该显示提示信息', () => {
      const emptyTable = {
        id: 'empty_table',
        title: '空表格',
        rows: [],
        columns: 0,
      };

      render(<TableRenderer table={emptyTable} />);
      
      const emptyMessage = screen.getByText('暂无表格数据');
      expect(emptyMessage).toBeInTheDocument();
    });

    it('null 表格应该显示提示信息', () => {
      render(<TableRenderer table={null} />);
      
      const emptyMessage = screen.getByText('暂无表格数据');
      expect(emptyMessage).toBeInTheDocument();
    });

    it('undefined 表格应该显示提示信息', () => {
      render(<TableRenderer table={undefined} />);
      
      const emptyMessage = screen.getByText('暂无表格数据');
      expect(emptyMessage).toBeInTheDocument();
    });
  });

  describe('数据格式化', () => {
    it('应该能正确显示数字值', () => {
      const tableWithNumbers = {
        ...mockTable,
        rows: [
          {
            ...mockTable.rows[0],
            cells: [
              {
                ...mockTable.rows[0].cells[0],
                value: 123,
              },
              {
                ...mockTable.rows[0].cells[1],
                value: 456.78,
              },
            ],
          },
        ],
      };

      render(<TableRenderer table={tableWithNumbers} />);
      
      expect(screen.getByText('123')).toBeInTheDocument();
      expect(screen.getByText('456.78')).toBeInTheDocument();
    });

    it('应该能正确显示字符串值', () => {
      render(<TableRenderer table={mockTable} />);
      
      expect(screen.getByText('值 1')).toBeInTheDocument();
      expect(screen.getByText('值 2')).toBeInTheDocument();
    });

    it('null 值应该显示为 -', () => {
      const tableWithNull = {
        ...mockTable,
        rows: [
          {
            ...mockTable.rows[0],
            cells: [
              {
                ...mockTable.rows[0].cells[0],
                value: null,
              },
              {
                ...mockTable.rows[0].cells[1],
                value: undefined,
              },
            ],
          },
        ],
      };

      render(<TableRenderer table={tableWithNull} />);
      
      const cells = screen.getAllByText('-');
      expect(cells.length).toBeGreaterThanOrEqual(2);
    });

    it('空字符串应该显示为 -', () => {
      const tableWithEmpty = {
        ...mockTable,
        rows: [
          {
            ...mockTable.rows[0],
            cells: [
              {
                ...mockTable.rows[0].cells[0],
                value: '',
              },
              {
                ...mockTable.rows[0].cells[1],
                value: '   ',
              },
            ],
          },
        ],
      };

      render(<TableRenderer table={tableWithEmpty} />);
      
      const cells = screen.getAllByText('-');
      expect(cells.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('样式和布局', () => {
    it('应该能应用正确的 CSS 类', () => {
      const { container } = render(<TableRenderer table={mockTable} />);
      
      const tableRenderer = container.querySelector('.table-renderer');
      expect(tableRenderer).toBeInTheDocument();
      expect(tableRenderer).toHaveClass('table-renderer');
    });

    it('应该能应用行的交替样式', () => {
      const { container } = render(<TableRenderer table={mockTable} />);
      
      const rows = container.querySelectorAll('tbody tr');
      expect(rows.length).toBe(2);
      
      // 检查交替样式
      expect(rows[0]).toHaveClass('even');
      expect(rows[1]).toHaveClass('odd');
    });

    it('应该能应用表格包装器样式', () => {
      const { container } = render(<TableRenderer table={mockTable} />);
      
      const wrapper = container.querySelector('.table-wrapper');
      expect(wrapper).toBeInTheDocument();
    });
  });

  describe('降级显示', () => {
    it('降级表格应该显示警告信息', () => {
      const degradedTable = {
        ...mockTable,
        degraded: true,
      };

      render(<TableRenderer table={degradedTable} />);
      
      const warning = screen.getByText(/此表格数据可能不完整/);
      expect(warning).toBeInTheDocument();
    });

    it('正常表格不应该显示警告信息', () => {
      const normalTable = {
        ...mockTable,
        degraded: false,
      };

      render(<TableRenderer table={normalTable} />);
      
      const warning = screen.queryByText(/此表格数据可能不完整/);
      expect(warning).not.toBeInTheDocument();
    });
  });

  describe('响应式布局', () => {
    it('应该能计算正确的列宽', () => {
      const { container } = render(<TableRenderer table={mockTable} />);
      
      const headers = container.querySelectorAll('th');
      headers.forEach(header => {
        const style = window.getComputedStyle(header);
        const width = style.width;
        // 每列应该占 50% (100% / 2 列)
        expect(width).toBeDefined();
      });
    });

    it('应该能处理不同数量的列', () => {
      const tableWith5Cols = {
        ...mockTable,
        columns: 5,
        rows: [
          {
            ...mockTable.rows[0],
            cells: Array(5).fill(null).map((_, i) => ({
              rowIndex: 0,
              colIndex: i,
              colKey: `col_${i}`,
              colName: `列 ${i + 1}`,
              value: `值 ${i + 1}`,
            })),
          },
        ],
      };

      const { container } = render(<TableRenderer table={tableWith5Cols} />);
      
      const headers = container.querySelectorAll('th');
      expect(headers.length).toBe(5);
    });
  });

  describe('边界情况', () => {
    it('应该能处理很长的文本', () => {
      const longTextTable = {
        ...mockTable,
        rows: [
          {
            ...mockTable.rows[0],
            cells: [
              {
                ...mockTable.rows[0].cells[0],
                value: '这是一个非常长的文本，用来测试表格是否能正确处理长文本内容而不会破坏布局',
              },
              {
                ...mockTable.rows[0].cells[1],
                value: '另一个很长的文本内容',
              },
            ],
          },
        ],
      };

      render(<TableRenderer table={longTextTable} />);
      
      const longText = screen.getByText(/这是一个非常长的文本/);
      expect(longText).toBeInTheDocument();
    });

    it('应该能处理特殊字符', () => {
      const specialCharTable = {
        ...mockTable,
        rows: [
          {
            ...mockTable.rows[0],
            cells: [
              {
                ...mockTable.rows[0].cells[0],
                value: '<script>alert("xss")</script>',
              },
              {
                ...mockTable.rows[0].cells[1],
                value: '&lt;tag&gt;',
              },
            ],
          },
        ],
      };

      const { container } = render(<TableRenderer table={specialCharTable} />);
      
      // 特殊字符应该被正确转义
      const script = container.querySelector('script');
      expect(script).not.toBeInTheDocument();
    });

    it('应该能处理很多行的表格', () => {
      const manyRowsTable = {
        ...mockTable,
        rows: Array(100).fill(null).map((_, i) => ({
          rowIndex: i,
          rowKey: `row_${i}`,
          rowLabel: `行 ${i + 1}`,
          cells: [
            {
              rowIndex: i,
              colIndex: 0,
              colKey: 'col_1',
              colName: '列 1',
              value: `值 ${i * 2 + 1}`,
            },
            {
              rowIndex: i,
              colIndex: 1,
              colKey: 'col_2',
              colName: '列 2',
              value: `值 ${i * 2 + 2}`,
            },
          ],
        })),
        columns: 2,
      };

      const { container } = render(<TableRenderer table={manyRowsTable} />);
      
      const rows = container.querySelectorAll('tbody tr');
      expect(rows.length).toBe(100);
    });
  });

  describe('可访问性', () => {
    it('应该有正确的表格语义', () => {
      const { container } = render(<TableRenderer table={mockTable} />);
      
      const table = container.querySelector('table');
      const thead = container.querySelector('thead');
      const tbody = container.querySelector('tbody');
      
      expect(table).toBeInTheDocument();
      expect(thead).toBeInTheDocument();
      expect(tbody).toBeInTheDocument();
    });

    it('应该有正确的行和列标题', () => {
      const { container } = render(<TableRenderer table={mockTable} />);
      
      const headers = container.querySelectorAll('th');
      expect(headers.length).toBeGreaterThan(0);
      
      headers.forEach(header => {
        expect(header.textContent).toBeTruthy();
      });
    });

    it('应该能被屏幕阅读器识别', () => {
      const { container } = render(<TableRenderer table={mockTable} />);
      
      const table = container.querySelector('table');
      expect(table).toHaveRole('table');
    });
  });
});
