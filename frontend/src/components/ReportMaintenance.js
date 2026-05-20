import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './ReportMaintenance.css';
import { apiClient } from '../apiClient';
import {
    AlertCircle,
    AlertTriangle,
    ArrowLeft,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Download,
    Eye,
    FileCheck2,
    FileSearch,
    FileWarning,
    Inbox,
    ListFilter,
    Loader2,
    RefreshCw,
    RotateCcw,
    Search,
    ShieldCheck,
    X
} from 'lucide-react';
import { useTaskDrawer } from './tasks/TaskDrawerProvider';

const EMPTY_VALUE = '--';

const uploadStatusMap = {
    all: { label: '全部', value: '' },
    uploaded: { label: '已上传', tone: 'success', priority: 2, description: '已有年报文件或记录' },
    not_uploaded: { label: '未上传', tone: 'muted', priority: 1, description: '当前年度尚无年报记录' }
};

const parseStatusMap = {
    all: { label: '全部', value: '' },
    not_uploaded: { label: '未上传', tone: 'muted', priority: 0, description: '尚未上传，无法解析' },
    pending: { label: '待解析', tone: 'warning', priority: 1, description: '已上传，等待解析任务' },
    running: { label: '解析中', tone: 'info', priority: 2, description: '解析任务正在运行' },
    success: { label: '解析成功', tone: 'success', priority: 4, description: '结构化解析已完成' },
    failed: { label: '解析失败', tone: 'danger', priority: 3, description: '解析结果为空或解析任务失败' }
};

const compareStatusMap = {
    all: { label: '全部', value: '' },
    not_compared: { label: '未比对', tone: 'muted', priority: 1, description: '尚未生成校验结果' },
    normal: { label: '无异常', tone: 'success', priority: 3, description: '已比对且未发现异常' },
    abnormal: { label: '有异常', tone: 'danger', priority: 2, description: '表格或基础信息存在校验异常' }
};

const reviewStatusMap = {
    all: { label: '全部', value: '' },
    none: { label: '未进入复核', tone: 'muted', priority: 0, description: '尚未进入人工复核流程' },
    pending_review: { label: '待复核', tone: 'warning', priority: 2, description: '需要人工确认或发布' },
    passed: { label: '复核通过', tone: 'success', priority: 3, description: '前端兼容状态，等待后端归档字段' },
    returned: { label: '已退回', tone: 'danger', priority: 1, description: '版本已转为历史或退回' },
    archived: { label: '已归档', tone: 'success', priority: 4, description: '正式发布版本，按当前系统视为归档' }
};

const maintenanceStatusMap = {
    all: { label: '全部', tone: 'muted', priority: 99 },
    not_uploaded: { label: '未上传', tone: 'muted', priority: 1 },
    parse_failed: { label: '解析失败', tone: 'danger', priority: 0 },
    compare_abnormal: { label: '比对异常', tone: 'danger', priority: 2 },
    pending_review: { label: '待复核', tone: 'warning', priority: 3 },
    in_progress: { label: '处理中', tone: 'info', priority: 4 },
    completed: { label: '已完成', tone: 'success', priority: 5 }
};

const severityMap = {
    critical: { label: '严重', tone: 'danger', priority: 0 },
    warning: { label: '提醒', tone: 'warning', priority: 1 },
    normal: { label: '正常', tone: 'success', priority: 2 },
    info: { label: '信息', tone: 'info', priority: 3 }
};

const exceptionTypeMap = {
    all: { label: '全部', value: '' },
    structure: { label: '表格缺失' },
    visual: { label: '年份不匹配' },
    quality: { label: '单位名称不匹配' },
    table2: { label: '表一异常' },
    table3: { label: '表三异常' },
    table4: { label: '表四异常' },
    text: { label: '勾稽关系异常' }
};

const quickFilters = [
    { key: 'all', label: '全部', filters: {} },
    { key: 'not_uploaded', label: '未上传', filters: { uploadStatus: 'not_uploaded', maintenanceStatus: 'not_uploaded' } },
    { key: 'parse_failed', label: '解析失败', filters: { parseStatus: 'failed', maintenanceStatus: 'parse_failed' } },
    { key: 'compare_abnormal', label: '比对异常', filters: { compareStatus: 'abnormal', maintenanceStatus: 'compare_abnormal' } },
    { key: 'pending_review', label: '待复核', filters: { reviewStatus: 'pending_review', maintenanceStatus: 'pending_review' } },
    { key: 'completed', label: '已完成', filters: { reviewStatus: 'archived', maintenanceStatus: 'completed' } }
];

const getInitialParams = () => {
    const params = new URLSearchParams(window.location.search);
    const urlYear = params.get('year');
    const urlRegionId = params.get('main_region_id');

    return {
        year: urlYear ? Number(urlYear) : (new Date().getFullYear() - 1),
        regionId: urlRegionId ? Number(urlRegionId) : null
    };
};

const formatValue = (value) => {
    if (value === null || value === undefined || value === '') return EMPTY_VALUE;
    return value;
};

const formatNumber = (value) => {
    if (value === null || value === undefined || value === '') return EMPTY_VALUE;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toLocaleString('zh-CN') : EMPTY_VALUE;
};

const formatDateTime = (value) => {
    if (!value) return EMPTY_VALUE;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const getLevelName = (level) => {
    switch (Number(level)) {
        case 0:
        case 1:
            return '省级';
        case 2:
            return '市级';
        case 3:
            return '区县级';
        case 4:
            return '街道/乡镇';
        default:
            return level === null || level === undefined ? EMPTY_VALUE : `Level ${level}`;
    }
};

const getStatusMeta = (map, key) => map[key] || { label: formatValue(key), tone: 'muted', priority: 99 };

const getMaintenanceStatus = (uploadStatus, parseStatus, compareStatus, reviewStatus) => {
    if (uploadStatus === 'not_uploaded') return 'not_uploaded';
    if (parseStatus === 'failed') return 'parse_failed';
    if (compareStatus === 'abnormal') return 'compare_abnormal';
    if (reviewStatus === 'pending_review') return 'pending_review';
    if (reviewStatus === 'archived' || reviewStatus === 'passed') return 'completed';
    return 'in_progress';
};

const normalizeLegacyStatus = (row) => {
    const legacyStatus = String(row?.status || '').trim();
    if (legacyStatus === 'missing') {
        return {
            upload_status: 'not_uploaded',
            parse_status: 'not_uploaded',
            compare_status: 'not_compared',
            review_status: 'none',
            archive_status: 'not_archived',
            maintenance_status: 'not_uploaded'
        };
    }
    if (legacyStatus === 'empty' || legacyStatus === 'text_empty') {
        return {
            upload_status: 'uploaded',
            parse_status: 'failed',
            compare_status: 'not_compared',
            review_status: 'none',
            archive_status: 'not_archived',
            maintenance_status: 'parse_failed'
        };
    }
    return {};
};

const normalizeMaintenanceRow = (row) => {
    const legacy = normalizeLegacyStatus(row);
    const uploadStatus = row.upload_status || legacy.upload_status || (row.report_id ? 'uploaded' : 'not_uploaded');
    const parseStatus = row.parse_status || legacy.parse_status || (uploadStatus === 'not_uploaded' ? 'not_uploaded' : 'pending');
    const compareStatus = row.compare_status || legacy.compare_status || 'not_compared';
    const reviewStatus = row.review_status || legacy.review_status || 'none';
    const maintenanceStatus = row.maintenance_status || legacy.maintenance_status || getMaintenanceStatus(
        uploadStatus,
        parseStatus,
        compareStatus,
        reviewStatus
    );

    return {
        ...row,
        unit_id: row.unit_id || row.region_id,
        unit_name: row.unit_name || row.region_name,
        parent_unit_name: row.parent_unit_name || row.parent_path || '',
        upload_status: uploadStatus,
        parse_status: parseStatus,
        compare_status: compareStatus,
        review_status: reviewStatus,
        archive_status: row.archive_status || legacy.archive_status || (reviewStatus === 'archived' ? 'archived' : 'not_archived'),
        maintenance_status: maintenanceStatus,
        abnormal_count: row.abnormal_count ?? null,
        abnormal_types: Array.isArray(row.abnormal_types) ? row.abnormal_types : []
    };
};

const isRowCritical = (row) => row.parse_status === 'failed' || Number(row.abnormal_count || 0) >= 5;

const getRowKey = (row) => String(row.report_id || `region-${row.region_id}`);

const normalizeRows = (payload) => {
    const rows = payload?.regions || payload?.rows || payload?.items || [];
    return Array.isArray(rows) ? rows.map(normalizeMaintenanceRow) : [];
};

const summarizeAnnualReportMaintenanceData = (payload, rows) => {
    const summary = payload?.summary || {};
    const getProvided = (...keys) => {
        for (const key of keys) {
            const value = summary[key] ?? payload?.[key];
            if (value !== undefined && value !== null && value !== '') return Number(value);
        }
        return null;
    };
    const countBy = (predicate) => rows.filter(predicate).length;

    const total = getProvided('maintenance_total', 'total') ?? rows.length;
    const uploaded = getProvided('uploaded_count') ?? countBy((row) => row.upload_status === 'uploaded' || row.report_id);
    const parseSuccess = getProvided('parse_success_count') ?? countBy((row) => row.parse_status === 'success');
    const parseFailed = getProvided('parse_failed_count') ?? countBy((row) => row.parse_status === 'failed');
    const compareAbnormal = getProvided('compare_abnormal_count') ?? countBy((row) => row.compare_status === 'abnormal');
    const pendingReview = getProvided('pending_review_count') ?? countBy((row) => row.review_status === 'pending_review');

    // 当前后端尚无独立 archiveStatus 字段时，正式发布版本按已归档兼容计算。
    const archived = getProvided('archived_count') ?? countBy((row) => row.archive_status === 'archived' || row.review_status === 'archived');
    const notUploaded = getProvided('not_uploaded_count', 'missing_count') ?? Math.max(total - uploaded, 0);

    return {
        total,
        uploaded,
        parseSuccess,
        parseFailed,
        compareAbnormal,
        pendingReview,
        archived,
        notUploaded,
        issueTotal: getProvided('issue_total') ?? rows.reduce((sum, row) => sum + Number(row.abnormal_count || 0), 0)
    };
};

const countRows = (rows, predicate) => rows.filter(predicate).length;

const buildExceptionDistribution = (rows, summary) => {
    const byType = Object.keys(exceptionTypeMap)
        .filter((key) => key !== 'all')
        .map((key) => ({
            key,
            label: exceptionTypeMap[key].label,
            count: countRows(rows, (row) => Array.isArray(row.abnormal_types) && row.abnormal_types.includes(key))
        }))
        .filter((item) => item.count > 0);

    return {
        core: [
            { key: 'parse_failed', label: '解析失败', count: summary.parseFailed, tone: 'danger' },
            { key: 'compare_abnormal', label: '比对异常', count: summary.compareAbnormal, tone: 'danger' },
            { key: 'pending_review', label: '待人工复核', count: summary.pendingReview, tone: 'warning' },
            { key: 'not_uploaded', label: '未上传', count: summary.notUploaded, tone: 'muted' }
        ],
        byType
    };
};

const applyFilters = (rows, filters) => {
    const keyword = filters.keyword.trim().toLowerCase();
    const parentKeyword = filters.parentUnit.trim().toLowerCase();

    return rows.filter((row) => {
        const regionName = String(row.region_name || '').toLowerCase();
        const parentName = String(row.parent_unit_name || row.parent_path || '').toLowerCase();
        const unitName = String(row.unit_name || row.region_name || '').toLowerCase();
        const abnormalTypes = Array.isArray(row.abnormal_types) ? row.abnormal_types : [];

        if (filters.regionText && !regionName.includes(filters.regionText.trim().toLowerCase())) return false;
        if (filters.level && String(row.level) !== String(filters.level)) return false;
        if (parentKeyword && !parentName.includes(parentKeyword)) return false;
        if (filters.maintenanceStatus && row.maintenance_status !== filters.maintenanceStatus) return false;
        if (keyword && !unitName.includes(keyword)) return false;
        if (filters.uploadStatus && row.upload_status !== filters.uploadStatus) return false;
        if (filters.parseStatus && row.parse_status !== filters.parseStatus) return false;
        if (filters.compareStatus && row.compare_status !== filters.compareStatus) return false;
        if (filters.reviewStatus && row.review_status !== filters.reviewStatus) return false;
        if (filters.exceptionType && !abnormalTypes.includes(filters.exceptionType)) return false;
        return true;
    });
};

const buildDetailItems = (row) => [
    ['单位名称', row.unit_name || row.region_name],
    ['地区', row.region_name],
    ['层级', getLevelName(row.level)],
    ['上级单位', row.parent_unit_name || row.parent_path],
    ['年份', row.year],
    ['文件名称', row.file_name],
    ['上传时间', formatDateTime(row.upload_time)],
    ['解析状态', getStatusMeta(parseStatusMap, row.parse_status).label],
    ['比对状态', getStatusMeta(compareStatusMap, row.compare_status).label],
    ['复核状态', getStatusMeta(reviewStatusMap, row.review_status).label],
    ['最后更新时间', formatDateTime(row.updated_at)]
];

const buildIssueItems = (row) => {
    const types = Array.isArray(row.abnormal_types) ? row.abnormal_types : [];
    if (!row.report_id) {
        return [{
            type: '未上传',
            table: EMPTY_VALUE,
            field: EMPTY_VALUE,
            severity: severityMap.warning.label,
            description: '当前年度尚未上传年报文件。',
            current: EMPTY_VALUE,
            expected: '上传本年度政府信息公开年报'
        }];
    }
    if (row.parse_status === 'failed') {
        return [{
            type: '解析失败',
            table: EMPTY_VALUE,
            field: EMPTY_VALUE,
            severity: severityMap.critical.label,
            description: row.latest_job?.error_message || '解析结果为空或解析任务失败，请重新解析后复核。',
            current: getStatusMeta(parseStatusMap, row.parse_status).label,
            expected: '解析成功'
        }];
    }
    if (Number(row.abnormal_count || 0) === 0 && types.length === 0) {
        return [];
    }
    const mappedTypes = types.length > 0 ? types : ['quality'];
    return mappedTypes.map((type) => ({
        type: exceptionTypeMap[type]?.label || type,
        table: type.startsWith('table') ? exceptionTypeMap[type]?.label : EMPTY_VALUE,
        field: EMPTY_VALUE,
        severity: type === 'visual' || type === 'quality' ? severityMap.warning.label : severityMap.critical.label,
        description: '该单位存在待处理校验异常，详情可进入报告详情页查看校验项。',
        current: `${formatNumber(row.abnormal_count)} 个异常`,
        expected: '复核确认或修正后归档'
    }));
};

function StatusBadge({ map, value }) {
    const meta = getStatusMeta(map, value);
    return <span className={`status-badge tone-${meta.tone || 'muted'}`}>{meta.label}</span>;
}

function ReportMaintenance({ onBack, onNavigate }) {
    const taskDrawer = useTaskDrawer();
    const initialParams = useMemo(() => getInitialParams(), []);
    const [year, setYear] = useState(initialParams.year);
    const [regionId, setRegionId] = useState(initialParams.regionId);
    const [regionPath, setRegionPath] = useState([]);
    const [regions, setRegions] = useState([]);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [exporting, setExporting] = useState('');
    const [activeQuickFilter, setActiveQuickFilter] = useState('all');
    const [filters, setFilters] = useState({
        regionText: '',
        level: '',
        parentUnit: '',
        maintenanceStatus: '',
        keyword: '',
        uploadStatus: '',
        parseStatus: '',
        compareStatus: '',
        reviewStatus: '',
        exceptionType: ''
    });
    const [appliedFilters, setAppliedFilters] = useState(filters);
    const [selectedKeys, setSelectedKeys] = useState([]);
    const [pageSize, setPageSize] = useState(50);
    const [page, setPage] = useState(1);
    const [drawer, setDrawer] = useState({ type: '', row: null });
    const [actionMessage, setActionMessage] = useState('');
    const [reparseBusyKey, setReparseBusyKey] = useState('');

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        params.set('year', year);
        if (regionId) {
            params.set('main_region_id', regionId);
        } else {
            params.delete('main_region_id');
        }
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }, [year, regionId]);

    const years = useMemo(() => {
        const currentYear = new Date().getFullYear();
        const yearList = [];
        for (let y = currentYear; y >= 2015; y--) {
            yearList.push(y);
        }
        return yearList;
    }, []);

    useEffect(() => {
        const fetchRegions = async () => {
            try {
                const resp = await apiClient.get('/regions');
                const regionRows = resp.data?.data ?? resp.data ?? [];
                setRegions(Array.isArray(regionRows) ? regionRows : []);
            } catch (err) {
                console.error('Failed to fetch regions:', err);
            }
        };
        fetchRegions();
    }, []);

    useEffect(() => {
        if (regions.length > 0 && regionId && regionPath.length === 0) {
            const regionMap = new Map(regions.map((region) => [Number(region.id), region]));
            const path = [];
            let current = regionMap.get(Number(regionId));
            while (current) {
                path.unshift(Number(current.id));
                current = regionMap.get(Number(current.parent_id));
            }
            if (path.length > 0) {
                setRegionPath(path);
            }
        }
    }, [regions, regionId, regionPath.length]);

    const regionTree = useMemo(() => {
        const byParent = new Map();
        regions.forEach((region) => {
            const parentKey = region.parent_id != null ? String(region.parent_id) : null;
            if (!byParent.has(parentKey)) byParent.set(parentKey, []);
            byParent.get(parentKey).push(region);
        });
        byParent.forEach((items) => items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
        return byParent;
    }, [regions]);

    const getRegionOptions = useCallback((parentId) => {
        return regionTree.get(parentId != null ? String(parentId) : null) || [];
    }, [regionTree]);

    const cascadeLevels = [
        { label: '省份', placeholder: '全部省份' },
        { label: '城市', placeholder: '全部城市' },
        { label: '区县', placeholder: '全部区县' },
        { label: '街道', placeholder: '全部街道' }
    ];

    const handleCascadeChange = (level, value) => {
        const nextPath = [...regionPath.slice(0, level)];
        if (value) nextPath.push(Number(value));
        setRegionPath(nextPath);
        setRegionId(nextPath.length > 0 ? nextPath[nextPath.length - 1] : null);
        setPage(1);
    };

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ year: String(year) });
            if (regionId) params.set('region_id', String(regionId));
            const resp = await apiClient.get(`/report-maintenance?${params.toString()}`);
            setData(resp.data?.data || { regions: [], summary: {} });
            setSelectedKeys([]);
            setPage(1);
        } catch (err) {
            const message = err.response?.data?.error || err.message || '请求失败';
            setError(`加载年报维护数据失败：${message}`);
        } finally {
            setLoading(false);
        }
    }, [year, regionId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const rows = useMemo(() => normalizeRows(data), [data]);
    const summary = useMemo(() => summarizeAnnualReportMaintenanceData(data, rows), [data, rows]);
    const exceptionDistribution = useMemo(() => buildExceptionDistribution(rows, summary), [rows, summary]);
    const filteredRows = useMemo(() => applyFilters(rows, appliedFilters), [rows, appliedFilters]);
    const selectedRows = useMemo(() => {
        const selectedSet = new Set(selectedKeys);
        return rows.filter((row) => selectedSet.has(getRowKey(row)));
    }, [rows, selectedKeys]);

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const normalizedPage = Math.min(page, totalPages);
    const pageRows = useMemo(() => {
        const start = (normalizedPage - 1) * pageSize;
        return filteredRows.slice(start, start + pageSize);
    }, [filteredRows, normalizedPage, pageSize]);

    useEffect(() => {
        if (page !== normalizedPage) setPage(normalizedPage);
    }, [page, normalizedPage]);

    const archiveRate = summary.total > 0 ? Math.round((summary.archived / summary.total) * 100) : 0;
    const pendingCount = Math.max(summary.total - summary.archived, 0);

    const updateFilter = (key, value) => {
        setFilters((prev) => ({ ...prev, [key]: value }));
        setActiveQuickFilter('custom');
    };

    const handleApplyFilters = () => {
        setAppliedFilters(filters);
        setPage(1);
        setSelectedKeys([]);
    };

    const handleResetFilters = () => {
        const nextFilters = {
            regionText: '',
            level: '',
            parentUnit: '',
            maintenanceStatus: '',
            keyword: '',
            uploadStatus: '',
            parseStatus: '',
            compareStatus: '',
            reviewStatus: '',
            exceptionType: ''
        };
        setFilters(nextFilters);
        setAppliedFilters(nextFilters);
        setActiveQuickFilter('all');
        setPage(1);
        setSelectedKeys([]);
    };

    const handleQuickFilter = (quick) => {
        const nextFilters = {
            regionText: '',
            level: '',
            parentUnit: '',
            maintenanceStatus: '',
            keyword: '',
            uploadStatus: '',
            parseStatus: '',
            compareStatus: '',
            reviewStatus: '',
            exceptionType: '',
            ...quick.filters
        };
        setFilters(nextFilters);
        setAppliedFilters(nextFilters);
        setActiveQuickFilter(quick.key);
        setPage(1);
        setSelectedKeys([]);
    };

    const handleExport = async (scope) => {
        setExporting(scope);
        try {
            const params = new URLSearchParams({ year: String(year), scope });
            if (regionId) params.set('region_id', String(regionId));
            const resp = await apiClient.get(`/report-maintenance/export?${params.toString()}`, {
                responseType: 'blob'
            });
            const url = window.URL.createObjectURL(new Blob([resp.data]));
            const link = document.createElement('a');
            link.href = url;
            const nameMap = { all: '全部', abnormal: '异常', review: '待复核' };
            link.setAttribute('download', `年报维护_${year}年_${nameMap[scope] || '导出'}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            const message = err.response?.data?.error || err.message || '导出失败';
            setActionMessage(`导出失败：${message}`);
        } finally {
            setExporting('');
        }
    };

    const handleSelectAllPage = (checked) => {
        const pageKeys = pageRows.map(getRowKey);
        if (checked) {
            setSelectedKeys((prev) => Array.from(new Set([...prev, ...pageKeys])));
        } else {
            setSelectedKeys((prev) => prev.filter((key) => !pageKeys.includes(key)));
        }
    };

    const handleSelectRow = (row, checked) => {
        const key = getRowKey(row);
        if (checked) {
            setSelectedKeys((prev) => Array.from(new Set([...prev, key])));
        } else {
            setSelectedKeys((prev) => prev.filter((item) => item !== key));
        }
    };

    const navigateToDetail = (row) => {
        if (row.report_id && onNavigate) {
            onNavigate(`/catalog/reports/${row.report_id}`);
            return;
        }
        setActionMessage('该单位尚未上传年报，暂无详情页。');
    };

    const openIssueDrawer = (row) => {
        setDrawer({ type: 'issues', row });
    };

    const openDetailDrawer = (row) => {
        setDrawer({ type: 'detail', row });
    };

    const handleReparse = async (row) => {
        if (!row.report_id) {
            setActionMessage('该单位尚未上传年报，无法重新解析。');
            return;
        }
        if (!window.confirm(`确认重新解析“${row.unit_name || row.region_name}”的年报吗？`)) return;
        const key = getRowKey(row);
        setReparseBusyKey(key);
        try {
            const resp = await apiClient.post(`/reports/${row.report_id}/parse`, null, {
                params: { force: 'true' }
            });
            const jobId = resp.data?.job_id;
            if (jobId) {
                taskDrawer.trackParseJob({
                    job_id: jobId,
                    report_id: row.report_id,
                    version_id: row.effective_version_id,
                    status: 'queued',
                    progress: 0,
                    step_name: '重新解析已提交',
                    file_name: row.file_name || row.unit_name || row.region_name,
                });
                taskDrawer.openDrawer();
            }
            setActionMessage(jobId ? `已提交重新解析任务 #${jobId}。` : '已提交重新解析任务。');
            fetchData();
        } catch (err) {
            const message = err.response?.data?.message || err.response?.data?.error || err.message || '重新解析失败';
            setActionMessage(`重新解析失败：${message}`);
        } finally {
            setReparseBusyKey('');
        }
    };

    const pageAllSelected = pageRows.length > 0 && pageRows.every((row) => selectedKeys.includes(getRowKey(row)));
    const canBatchReparse = selectedRows.some((row) => row.report_id);
    const canBatchExportAbnormal = selectedRows.some((row) => row.compare_status === 'abnormal' || row.parse_status === 'failed');

    const batchPlaceholder = (label) => {
        if (selectedRows.length === 0) {
            setActionMessage('请先选择需要处理的单位。');
            return;
        }
        setActionMessage(`${label}接口暂未接入，当前先保留操作入口。`);
    };

    const closeDrawer = () => setDrawer({ type: '', row: null });

    return (
        <div className="report-maintenance-page">
            <div className="report-maintenance-header">
                <div className="header-left">
                    <button className="back-btn" onClick={onBack}>
                        <ArrowLeft size={18} />
                        <span>返回</span>
                    </button>
                    <div className="header-title">
                        <h2>
                            <FileSearch size={24} className="title-icon" />
                            年报维护工作台
                        </h2>
                        <p className="subtitle">按年度对各单位政府信息公开年报的上传、解析、比对、复核和归档情况进行集中维护。</p>
                    </div>
                </div>
                <div className="header-right">
                    <button className="secondary-btn" onClick={() => handleExport('all')} disabled={Boolean(exporting) || loading}>
                        <Download size={16} className={exporting === 'all' ? 'spin' : ''} />
                        <span>{exporting === 'all' ? '导出中...' : '导出全部'}</span>
                    </button>
                    <button className="primary-btn" onClick={() => handleExport('abnormal')} disabled={Boolean(exporting) || loading}>
                        <Download size={16} className={exporting === 'abnormal' ? 'spin' : ''} />
                        <span>{exporting === 'abnormal' ? '导出中...' : '导出异常'}</span>
                    </button>
                    <button className="icon-btn" onClick={fetchData} disabled={loading} title="刷新">
                        <RefreshCw size={18} className={loading ? 'spin' : ''} />
                    </button>
                </div>
            </div>

            <div className="summary-grid" aria-label="年报维护统计">
                {[
                    { key: 'total', label: '应维护单位', value: summary.total, icon: Inbox, tone: 'info' },
                    { key: 'uploaded', label: '已上传年报', value: summary.uploaded, icon: FileCheck2, tone: 'info' },
                    { key: 'parseSuccess', label: '解析成功', value: summary.parseSuccess, icon: CheckCircle2, tone: 'success' },
                    { key: 'parseFailed', label: '解析失败', value: summary.parseFailed, icon: AlertCircle, tone: 'danger' },
                    { key: 'compareAbnormal', label: '比对异常', value: summary.compareAbnormal, icon: FileWarning, tone: 'danger' },
                    { key: 'pendingReview', label: '待人工复核', value: summary.pendingReview, icon: AlertTriangle, tone: 'warning' },
                    { key: 'archived', label: '已完成归档', value: summary.archived, icon: ShieldCheck, tone: 'success' }
                ].map((card) => {
                    const Icon = card.icon;
                    return (
                        <div className={`summary-card tone-${card.tone}`} key={card.key}>
                            <div className="summary-card-head">
                                <span>{card.label}</span>
                                <Icon size={18} />
                            </div>
                            <strong>{formatNumber(card.value)}</strong>
                        </div>
                    );
                })}
            </div>

            <section className="progress-panel">
                <div className="progress-copy">
                    <strong>当前年度共 {formatNumber(summary.total)} 家单位，已上传 {formatNumber(summary.uploaded)} 家，解析成功 {formatNumber(summary.parseSuccess)} 家，待处理 {formatNumber(pendingCount)} 家，已完成归档 {formatNumber(summary.archived)} 家。</strong>
                    <span>归档完成率 {archiveRate}%</span>
                </div>
                <div className="progress-track" aria-label="归档完成率">
                    <div className="progress-fill" style={{ width: `${archiveRate}%` }} />
                </div>
            </section>

            <section className="exception-panel">
                <div className="section-title">
                    <ListFilter size={18} />
                    <span>异常分布</span>
                </div>
                <div className="exception-list">
                    {exceptionDistribution.core.map((item) => (
                        <button
                            type="button"
                            key={item.key}
                            className={`exception-pill tone-${item.tone}`}
                            onClick={() => {
                                const quick = quickFilters.find((entry) => entry.key === item.key);
                                if (quick) handleQuickFilter(quick);
                            }}
                        >
                            <span>{item.label}</span>
                            <strong>{formatNumber(item.count)}</strong>
                        </button>
                    ))}
                    {exceptionDistribution.byType.length > 0 ? exceptionDistribution.byType.map((item) => (
                        <button
                            type="button"
                            key={item.key}
                            className="exception-pill tone-info"
                            onClick={() => {
                                const nextFilters = { ...filters, exceptionType: item.key };
                                setFilters(nextFilters);
                                setAppliedFilters(nextFilters);
                                setActiveQuickFilter('custom');
                                setPage(1);
                            }}
                        >
                            <span>{item.label}</span>
                            <strong>{formatNumber(item.count)}</strong>
                        </button>
                    )) : (
                        <span className="exception-hint">暂无细分异常类型数据，已预留展示结构。</span>
                    )}
                </div>
            </section>

            <section className="filter-section">
                <div className="filter-row">
                    <label className="filter-group">
                        <span>年份</span>
                        <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
                            {years.map((item) => <option key={item} value={item}>{item}年</option>)}
                        </select>
                    </label>

                    {cascadeLevels.map((level, index) => {
                        const parentId = index === 0 ? null : regionPath[index - 1];
                        const options = getRegionOptions(parentId);
                        if (index > 0 && !regionPath[index - 1]) return null;
                        if (index > 0 && options.length === 0) return null;
                        return (
                            <label className="filter-group" key={level.label}>
                                <span>{level.label}</span>
                                <select
                                    value={regionPath[index] || ''}
                                    onChange={(event) => handleCascadeChange(index, event.target.value)}
                                >
                                    <option value="">{level.placeholder}</option>
                                    {options.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
                                </select>
                            </label>
                        );
                    })}

                    <label className="filter-group">
                        <span>地区</span>
                        <input value={filters.regionText} onChange={(event) => updateFilter('regionText', event.target.value)} placeholder="地区关键词" />
                    </label>
                    <label className="filter-group compact">
                        <span>层级</span>
                        <select value={filters.level} onChange={(event) => updateFilter('level', event.target.value)}>
                            <option value="">全部</option>
                            <option value="1">省级</option>
                            <option value="2">市级</option>
                            <option value="3">区县级</option>
                            <option value="4">街道/乡镇</option>
                        </select>
                    </label>
                    <label className="filter-group">
                        <span>上级单位</span>
                        <input value={filters.parentUnit} onChange={(event) => updateFilter('parentUnit', event.target.value)} placeholder="上级单位关键词" />
                    </label>
                    <label className="filter-group">
                        <span>维护状态</span>
                        <select value={filters.maintenanceStatus} onChange={(event) => updateFilter('maintenanceStatus', event.target.value)}>
                            {Object.entries(maintenanceStatusMap).map(([key, meta]) => <option key={key} value={key === 'all' ? '' : key}>{meta.label}</option>)}
                        </select>
                    </label>
                </div>

                <div className="filter-row">
                    <label className="filter-group keyword">
                        <span>单位名称关键词</span>
                        <div className="search-input">
                            <Search size={16} />
                            <input value={filters.keyword} onChange={(event) => updateFilter('keyword', event.target.value)} placeholder="请输入单位名称" />
                        </div>
                    </label>
                    <label className="filter-group">
                        <span>上传状态</span>
                        <select value={filters.uploadStatus} onChange={(event) => updateFilter('uploadStatus', event.target.value)}>
                            {Object.entries(uploadStatusMap).map(([key, meta]) => <option key={key} value={key === 'all' ? '' : key}>{meta.label}</option>)}
                        </select>
                    </label>
                    <label className="filter-group">
                        <span>解析状态</span>
                        <select value={filters.parseStatus} onChange={(event) => updateFilter('parseStatus', event.target.value)}>
                            {Object.entries(parseStatusMap).map(([key, meta]) => <option key={key} value={key === 'all' ? '' : key}>{meta.label}</option>)}
                        </select>
                    </label>
                    <label className="filter-group">
                        <span>比对状态</span>
                        <select value={filters.compareStatus} onChange={(event) => updateFilter('compareStatus', event.target.value)}>
                            {Object.entries(compareStatusMap).map(([key, meta]) => <option key={key} value={key === 'all' ? '' : key}>{meta.label}</option>)}
                        </select>
                    </label>
                    <label className="filter-group">
                        <span>复核状态</span>
                        <select value={filters.reviewStatus} onChange={(event) => updateFilter('reviewStatus', event.target.value)}>
                            {Object.entries(reviewStatusMap).map(([key, meta]) => <option key={key} value={key === 'all' ? '' : key}>{meta.label}</option>)}
                        </select>
                    </label>
                    <label className="filter-group">
                        <span>异常类型</span>
                        <select value={filters.exceptionType} onChange={(event) => updateFilter('exceptionType', event.target.value)}>
                            {Object.entries(exceptionTypeMap).map(([key, meta]) => <option key={key} value={key === 'all' ? '' : key}>{meta.label}</option>)}
                        </select>
                    </label>
                    <div className="filter-actions">
                        <button className="primary-btn" onClick={handleApplyFilters} disabled={loading}>
                            <Search size={16} />
                            查询
                        </button>
                        <button className="secondary-btn" onClick={handleResetFilters} disabled={loading}>
                            <RotateCcw size={16} />
                            重置
                        </button>
                    </div>
                </div>

                <div className="quick-filter-row">
                    {quickFilters.map((quick) => (
                        <button
                            key={quick.key}
                            className={`quick-filter ${activeQuickFilter === quick.key ? 'active' : ''}`}
                            onClick={() => handleQuickFilter(quick)}
                            type="button"
                        >
                            {quick.label}
                        </button>
                    ))}
                </div>
            </section>

            {actionMessage && (
                <div className="action-message">
                    <span>{actionMessage}</span>
                    <button onClick={() => setActionMessage('')} title="关闭"><X size={14} /></button>
                </div>
            )}

            {error && <div className="alert error">{error}</div>}

            <section className="table-panel">
                <div className="table-toolbar">
                    <div>
                        <strong>维护明细</strong>
                        <span>共 {formatNumber(filteredRows.length)} 条，已选 {formatNumber(selectedKeys.length)} 条</span>
                    </div>
                    <div className="batch-actions">
                        <button className="secondary-btn" onClick={() => batchPlaceholder('批量重新解析')} disabled={!canBatchReparse}>
                            <RefreshCw size={15} />
                            批量重新解析
                        </button>
                        <button className="secondary-btn" onClick={() => batchPlaceholder('批量导出异常')} disabled={!canBatchExportAbnormal}>
                            <Download size={15} />
                            批量导出异常
                        </button>
                        <button className="secondary-btn" onClick={() => batchPlaceholder('批量标记待复核 / 已复核')} disabled={selectedRows.length === 0}>
                            <ShieldCheck size={15} />
                            批量复核
                        </button>
                    </div>
                </div>

                <div className="table-scroll">
                    <table className="maintenance-table">
                        <thead>
                            <tr>
                                <th className="select-col">
                                    <input type="checkbox" checked={pageAllSelected} onChange={(event) => handleSelectAllPage(event.target.checked)} aria-label="选择当前页" />
                                </th>
                                <th className="index-col">序号</th>
                                <th className="unit-col sticky-left">单位名称</th>
                                <th>地区</th>
                                <th>层级</th>
                                <th>上级单位</th>
                                <th>年份</th>
                                <th>上传状态</th>
                                <th>解析状态</th>
                                <th>比对状态</th>
                                <th>异常数</th>
                                <th>复核状态</th>
                                <th>最后更新时间</th>
                                <th className="actions-col sticky-right">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr>
                                    <td colSpan="14">
                                        <div className="table-state">
                                            <Loader2 size={26} className="spin" />
                                            <span>正在加载维护数据...</span>
                                        </div>
                                    </td>
                                </tr>
                            )}
                            {!loading && !error && pageRows.length === 0 && (
                                <tr>
                                    <td colSpan="14">
                                        <div className="table-state empty">
                                            <Inbox size={28} />
                                            <strong>暂无符合条件的数据</strong>
                                            <span>可调整筛选条件后重新查询。</span>
                                        </div>
                                    </td>
                                </tr>
                            )}
                            {!loading && pageRows.map((row, index) => {
                                const rowKey = getRowKey(row);
                                return (
                                    <tr key={rowKey} className={isRowCritical(row) ? 'critical-row' : ''}>
                                        <td className="select-col">
                                            <input type="checkbox" checked={selectedKeys.includes(rowKey)} onChange={(event) => handleSelectRow(row, event.target.checked)} aria-label={`选择${row.unit_name || row.region_name}`} />
                                        </td>
                                        <td className="index-col">{(normalizedPage - 1) * pageSize + index + 1}</td>
                                        <td className="unit-col sticky-left">
                                            <button className="unit-link" onClick={() => navigateToDetail(row)} title={row.unit_name || row.region_name}>
                                                {formatValue(row.unit_name || row.region_name)}
                                            </button>
                                        </td>
                                        <td title={row.region_name}>{formatValue(row.region_name)}</td>
                                        <td>{getLevelName(row.level)}</td>
                                        <td className="muted-cell" title={row.parent_unit_name || row.parent_path}>{formatValue(row.parent_unit_name || row.parent_path)}</td>
                                        <td>{formatValue(row.year)}</td>
                                        <td><StatusBadge map={uploadStatusMap} value={row.upload_status} /></td>
                                        <td><StatusBadge map={parseStatusMap} value={row.parse_status} /></td>
                                        <td><StatusBadge map={compareStatusMap} value={row.compare_status} /></td>
                                        <td>
                                            {Number(row.abnormal_count || 0) > 0 ? (
                                                <button className="issue-count" onClick={() => openIssueDrawer(row)}>{formatNumber(row.abnormal_count)}</button>
                                            ) : (
                                                <span className="muted-cell">{row.abnormal_count === null || row.abnormal_count === undefined ? EMPTY_VALUE : 0}</span>
                                            )}
                                        </td>
                                        <td><StatusBadge map={reviewStatusMap} value={row.review_status} /></td>
                                        <td className="muted-cell">{formatDateTime(row.updated_at)}</td>
                                        <td className="actions-col sticky-right">
                                            <button className="link-action" onClick={() => openDetailDrawer(row)}><Eye size={14} />查看详情</button>
                                            <button className="link-action" onClick={() => openIssueDrawer(row)}><AlertCircle size={14} />查看异常</button>
                                            <button className="link-action" onClick={() => handleReparse(row)} disabled={!row.report_id || reparseBusyKey === rowKey}>
                                                <RefreshCw size={14} className={reparseBusyKey === rowKey ? 'spin' : ''} />重新解析
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="pagination-bar">
                    <span>第 {formatNumber(normalizedPage)} / {formatNumber(totalPages)} 页</span>
                    <label>
                        每页
                        <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
                            <option value="20">20</option>
                            <option value="50">50</option>
                            <option value="100">100</option>
                        </select>
                        条
                    </label>
                    <div className="pagination-buttons">
                        <button className="icon-btn" onClick={() => setPage((prev) => Math.max(prev - 1, 1))} disabled={normalizedPage <= 1}>
                            <ChevronLeft size={16} />
                        </button>
                        <button className="icon-btn" onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))} disabled={normalizedPage >= totalPages}>
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            </section>

            {drawer.row && (
                <div className="drawer-mask" onClick={closeDrawer}>
                    <aside className="maintenance-drawer" onClick={(event) => event.stopPropagation()}>
                        <div className="drawer-header">
                            <div>
                                <strong>{drawer.type === 'issues' ? '异常详情' : '单位年报详情'}</strong>
                                <span>{drawer.row.unit_name || drawer.row.region_name}</span>
                            </div>
                            <button className="icon-btn" onClick={closeDrawer} title="关闭"><X size={18} /></button>
                        </div>

                        {drawer.type === 'detail' ? (
                            <div className="drawer-content">
                                <div className="detail-grid">
                                    {buildDetailItems(drawer.row).map(([label, value]) => (
                                        <div key={label}>
                                            <span>{label}</span>
                                            <strong title={String(value || '')}>{formatValue(value)}</strong>
                                        </div>
                                    ))}
                                </div>
                                <div className="drawer-actions">
                                    <button className="primary-btn" onClick={() => navigateToDetail(drawer.row)} disabled={!drawer.row.report_id}>进入详情页</button>
                                    <button className="secondary-btn" onClick={() => handleReparse(drawer.row)} disabled={!drawer.row.report_id}>重新解析</button>
                                </div>
                            </div>
                        ) : (
                            <div className="drawer-content">
                                {buildIssueItems(drawer.row).length === 0 ? (
                                    <div className="drawer-empty">
                                        <CheckCircle2 size={28} />
                                        <strong>暂无异常</strong>
                                        <span>当前单位没有待展示的异常项。</span>
                                    </div>
                                ) : (
                                    <div className="issue-table-wrap">
                                        <table className="issue-table">
                                            <thead>
                                                <tr>
                                                    <th>异常类型</th>
                                                    <th>异常说明</th>
                                                    <th>所属表格</th>
                                                    <th>字段名称</th>
                                                    <th>当前值</th>
                                                    <th>期望值 / 规则说明</th>
                                                    <th>严重程度</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {buildIssueItems(drawer.row).map((item, index) => (
                                                    <tr key={`${item.type}-${index}`}>
                                                        <td>{item.type}</td>
                                                        <td>{item.description}</td>
                                                        <td>{item.table}</td>
                                                        <td>{item.field}</td>
                                                        <td>{item.current}</td>
                                                        <td>{item.expected}</td>
                                                        <td>{item.severity}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                <div className="drawer-actions">
                                    <button className="primary-btn" onClick={() => navigateToDetail(drawer.row)} disabled={!drawer.row.report_id}>进入详情页查看校验项</button>
                                </div>
                            </div>
                        )}
                    </aside>
                </div>
            )}
        </div>
    );
}

export default ReportMaintenance;
