import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ComparisonDetailView from './ComparisonDetailView';
import ComparisonPrintView from './print/ComparisonPrintView';
import { apiClient } from '../apiClient';

jest.mock('../apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('./DiffText', () => function MockDiffText({ newText }) {
  return <div>{newText}</div>;
});

jest.mock('./TableViews', () => ({
  Table2View: () => <div>table2</div>,
  Table3View: () => <div>table3</div>,
  Table4View: () => <div>table4</div>,
  SimpleDiffTable: ({ title }) => <div>{title}</div>,
}));

jest.mock('./CrossYearCheckView', () => {
  const ReactLocal = require('react');

  return function MockCrossYearCheckView({ onReadyChange }) {
    ReactLocal.useEffect(() => {
      if (onReadyChange) onReadyChange(true);
    }, [onReadyChange]);
    return <div data-testid="cross-year-check" />;
  };
});

jest.mock('./tasks/TaskDrawerProvider', () => ({
  useTaskDrawer: () => ({
    trackPdfJob: jest.fn(),
    openDrawer: jest.fn(),
  }),
}));

const comparisonData = {
  id: 158,
  region_name: '沭阳县交通运输局',
  year_a: 2024,
  year_b: 2025,
  left_report_id: 97,
  right_report_id: 2258,
  similarity: 60,
  check_status: '正常',
  diff_json: {
    summary: {
      textRepetition: 21,
      items: [],
    },
  },
  section_metrics: {
    text: [
      { title: '一、总体情况', similarity: 65, oldLength: 919, newLength: 909 },
      { title: '五、存在的主要问题及改进情况', similarity: 33, oldLength: 213, newLength: 374 },
      { title: '六、其他需要报告的事项', similarity: 54, oldLength: 163, newLength: 119 },
    ],
    average: 51,
    method: 'simple_average_text_sections',
  },
  left_content: {
    sections: [
      {
        type: 'text',
        title: '一、总体情况',
        content: '旧报告正文内容',
      },
    ],
  },
  right_content: {
    sections: [
      {
        type: 'text',
        title: '一、总体情况',
        content: '新报告正文内容',
      },
    ],
  },
};

const misalignedFifthSectionData = {
  ...comparisonData,
  similarity: 42,
  section_metrics: { text: [], average: 42, method: 'simple_average_text_sections' },
  left_content: {
    sections: [
      {
        type: 'text',
        title: '五、存在的主要问题及改进情况',
        content: '旧版主要问题正文',
      },
    ],
  },
  right_content: {
    sections: [
      {
        type: 'text',
        title: '五、存在的主要问题和改进情况',
        content: '新版整改措施正文',
      },
    ],
  },
};

describe('comparison similarity display', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  test('detail page uses API similarity and shows text section metrics', async () => {
    apiClient.get.mockResolvedValue({ data: comparisonData });

    render(<ComparisonDetailView comparisonId={158} />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/comparisons/158/result');
    });

    expect(screen.getByText('正文文字重复率 60%')).toBeInTheDocument();
    expect(screen.queryByText('21%')).not.toBeInTheDocument();
    expect(screen.getByText(/黄底只标记两版中的相同文本片段/)).toBeInTheDocument();

    const detailMetrics = screen.getByLabelText('正文章节重复率明细');
    expect(screen.getByText('正文章节重复率明细')).toBeInTheDocument();
    expect(screen.getByText('顶部数值为下列正文 text 章节的简单平均')).toBeInTheDocument();
    expect(detailMetrics).toHaveTextContent('一、总体情况');
    expect(detailMetrics).toHaveTextContent('65%');
    expect(detailMetrics).toHaveTextContent('五、存在的主要问题及改进情况');
    expect(detailMetrics).toHaveTextContent('33%');
    expect(detailMetrics).toHaveTextContent('六、其他需要报告的事项');
    expect(detailMetrics).toHaveTextContent('54%');
    expect(screen.getByText('五、存在的主要问题及改进情况：正文重复率 33%，文字变化较大，建议重点复核。')).toBeInTheDocument();
    expect(screen.getByText('六、其他需要报告的事项：正文重复率 54%，低于 60% 参考线，建议关注新增或改写内容。')).toBeInTheDocument();
    expect(screen.queryByText('暂无结构化差异摘要。')).not.toBeInTheDocument();
  });

  test('detail page aligns fifth-section title variants into one comparison row', async () => {
    apiClient.get.mockResolvedValue({ data: misalignedFifthSectionData });

    render(<ComparisonDetailView comparisonId={158} />);

    await waitFor(() => {
      expect(screen.getByText('旧版主要问题正文')).toBeInTheDocument();
    });

    const sectionCard = screen.getByText('五、存在的主要问题及改进情况').closest('.bg-white');
    expect(screen.getByText('新版整改措施正文')).toBeInTheDocument();
    expect(sectionCard).toHaveTextContent('旧版主要问题正文');
    expect(sectionCard).toHaveTextContent('新版整改措施正文');
    expect(screen.queryByText('五、存在的主要问题和改进情况')).not.toBeInTheDocument();
  });

  test('print page uses API similarity and shows text section metrics', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => comparisonData,
    });

    render(<ComparisonPrintView comparisonId={158} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost/api/comparisons/158/result',
        { headers: undefined }
      );
    });

    await waitFor(() => {
      expect(screen.getByText('60%')).toBeInTheDocument();
    });
    expect(screen.queryByText('21%')).not.toBeInTheDocument();
    expect(screen.getByText(/仅统计正文 text 章节/)).toBeInTheDocument();
    const printMetrics = screen.getByLabelText('正文章节重复率明细');
    expect(screen.getByText('正文章节重复率明细')).toBeInTheDocument();
    expect(printMetrics).toHaveTextContent('一、总体情况');
    expect(printMetrics).toHaveTextContent('65%');
    expect(screen.getByText('五、存在的主要问题及改进情况：正文重复率 33%，文字变化较大，建议重点复核。')).toBeInTheDocument();
    expect(screen.getByText('六、其他需要报告的事项：正文重复率 54%，低于 60% 参考线，建议关注新增或改写内容。')).toBeInTheDocument();
  });

  test('print page aligns fifth-section title variants into one comparison row', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => misalignedFifthSectionData,
    });

    render(<ComparisonPrintView comparisonId={158} />);

    await waitFor(() => {
      expect(screen.getByText('旧版主要问题正文')).toBeInTheDocument();
    });

    expect(screen.getByText('新版整改措施正文')).toBeInTheDocument();
    expect(screen.getAllByText('五、存在的主要问题及改进情况')).toHaveLength(1);
    expect(screen.queryByText('五、存在的主要问题和改进情况')).not.toBeInTheDocument();
  });
});
