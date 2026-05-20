import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Button from './Button';
import DataTable from './DataTable';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import Modal from './Modal';
import StatusBadge from './StatusBadge';

describe('common UI components', () => {
  test('renders shared button and status badge classes', () => {
    render(
      <>
        <Button variant="primary">保存</Button>
        <StatusBadge tone="success">完成</StatusBadge>
      </>
    );

    expect(screen.getByRole('button', { name: '保存' })).toHaveClass('kc-button--primary');
    expect(screen.getByText('完成')).toHaveClass('kc-status-badge--success');
  });

  test('renders data table, empty state, and error state', () => {
    render(
      <>
        <DataTable>
          <thead>
            <tr><th>名称</th></tr>
          </thead>
          <tbody>
            <tr><td>任务</td></tr>
          </tbody>
        </DataTable>
        <EmptyState title="暂无任务" description="创建后会显示在这里" />
        <ErrorState title="加载失败" message="网络异常" />
      </>
    );

    expect(screen.getByRole('table')).toHaveClass('kc-data-table');
    expect(screen.getByText('暂无任务')).toBeInTheDocument();
    expect(screen.getByText('网络异常')).toBeInTheDocument();
  });

  test('modal closes from close button and backdrop', () => {
    const onClose = jest.fn();
    const { rerender } = render(
      <Modal isOpen onClose={onClose} title="确认操作">
        <div>正文</div>
      </Modal>
    );

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <Modal isOpen onClose={onClose} title="确认操作">
        <div>正文</div>
      </Modal>
    );
    fireEvent.mouseDown(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
