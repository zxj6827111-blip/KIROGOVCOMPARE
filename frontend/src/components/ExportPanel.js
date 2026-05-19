import React from 'react';
import { Download, ExternalLink, FileDown, Printer } from 'lucide-react';
import Button from './common/Button';
import StatusBadge from './common/StatusBadge';
import './ExportPanel.css';

function ExportPanel({
  compact = false,
  disabled = false,
  exportLabel = '生成 PDF',
  isCreating = false,
  onCreatePdfJob,
  onOpenJobs,
  onPrintPreview,
  printLabel = '打印预览',
  statusText = '异步导出',
}) {
  return (
    <div className={`export-panel ${compact ? 'export-panel--compact' : ''}`}>
      {!compact && (
        <div className="export-panel__info">
          <StatusBadge tone="info">
            <FileDown size={13} />
            {statusText}
          </StatusBadge>
          <span>正式报告 PDF 使用任务中心生成；打印预览仅用于网页查看和手动打印。</span>
        </div>
      )}
      <div className="export-panel__actions">
        <Button
          size={compact ? 'sm' : 'md'}
          variant="primary"
          icon={isCreating ? null : <Download size={16} />}
          onClick={onCreatePdfJob}
          disabled={disabled || isCreating}
        >
          {isCreating ? '创建任务中...' : exportLabel}
        </Button>
        {onPrintPreview && (
          <Button
            size={compact ? 'sm' : 'md'}
            variant="secondary"
            icon={<Printer size={16} />}
            onClick={onPrintPreview}
            disabled={disabled}
          >
            {printLabel}
          </Button>
        )}
        {onOpenJobs && (
          <Button
            size={compact ? 'sm' : 'md'}
            variant="ghost"
            icon={<ExternalLink size={16} />}
            onClick={onOpenJobs}
          >
            查看导出任务
          </Button>
        )}
      </div>
    </div>
  );
}

export default ExportPanel;
