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

describe('comparison similarity display', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    window.history.pushState({}, '', '/');
  });

  test('detail page uses API similarity as the displayed text repetition value', async () => {
    apiClient.get.mockResolvedValue({ data: comparisonData });

    render(<ComparisonDetailView comparisonId={158} />);

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/comparisons/158/result');
    });

    expect(screen.getByText('正文文字重复率 60%')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.queryByText('21%')).not.toBeInTheDocument();
    expect(screen.getByText(/黄底只标记两版中的相同文本片段/)).toBeInTheDocument();
  });

  test('print page uses API similarity instead of local or diff summary values', async () => {
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

    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.queryByText('21%')).not.toBeInTheDocument();
    expect(screen.getByText(/仅统计正文 text 章节/)).toBeInTheDocument();
  });
});
