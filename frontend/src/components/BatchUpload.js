import React, { useState, useEffect, useRef, useCallback } from 'react';
import './BatchUpload.css';
import { apiClient } from '../apiClient';
import RegionCascader from './RegionCascader';
import {
    UploadCloud, X, FileText, Clock, Loader, Check, XCircle,
    SkipForward, Edit2, Trash2, Play, AlertTriangle
} from 'lucide-react';

const MAX_FILES = 50;

// 从文件名提取年份
const extractYearFromFilename = (filename) => {
    const match = filename.match(/(\d{4})/);
    if (match) {
        const year = parseInt(match[1], 10);
        if (year >= 2000 && year <= 2050) {
            return year;
        }
    }
    return new Date().getFullYear();
};

// 从文件名提取区域名
const extractRegionFromFilename = (filename) => {
    // Remove extension and date suffix
    let name = filename.replace(/\.(pdf|html|htm|txt)$/i, '');
    // Remove date patterns like _2025-12-30 or -2025-12-30
    name = name.replace(/[-_]\d{4}-\d{2}-\d{2}$/, '');

    // 特别处理乡镇级别的名称
    const townPatterns = [
        // 匹配"XX镇"、"XX乡"、"XX街道"等
        /([\u4e00-\u9fa5]{2,6}(?:镇|乡|街道|办事处))(?:\d{4}年|政府信息|年度报告)/,
        // 匹配"县+镇"格式
        /(?:[\u4e00-\u9fa5]{2,4}县)([\u4e00-\u9fa5]{2,6}(?:镇|乡|街道|办事处))/,
        // 匹配文件名中的乡镇名
        /[-_]([\u4e00-\u9fa5]{2,4}县[\u4e00-\u9fa5]{2,6}(?:镇|乡|街道))/,
    ];

    for (const pattern of townPatterns) {
        const match = name.match(pattern);
        if (match && match[1]) {
            return match[1].replace(/\d+/g, '').trim();
        }
    }

    // 匹配部门名称 (XX局、XX委、XX办等)
    const deptPatterns = [
        // 特别匹配：国家税务总局XX市/县税务局
        /(国家税务总局[\u4e00-\u9fa5]{2,6}(?:市|区|县)税务局)(?:\d{4}年|年度|政府信息)/,
        // 匹配完整部门名称
        /([\u4e00-\u9fa5]{2,4}(?:省|市|区|县)[\u4e00-\u9fa5]{2,15}(?:局|委|办|中心|院|所|处|站|队))(?:\d{4}年|年度|政府信息)/,
        // 从文件名后半部分提取
        /[-_]([\u4e00-\u9fa5]{2,4}(?:市|区|县)[\u4e00-\u9fa5]{2,15}(?:局|委|办|中心|税务局))(?:[-_]|$)/,
        // 开头匹配
        /^([\u4e00-\u9fa5]{2,4}(?:市|区|县)[\u4e00-\u9fa5]{2,15}(?:局|委|办|中心|院|所|税务局))\d{4}/,
    ];

    for (const pattern of deptPatterns) {
        const match = name.match(pattern);
        if (match && match[1]) {
            return match[1].replace(/\d+/g, '').trim();
        }
    }

    // Common patterns for district/city level
    const patterns = [
        /^(.{2,30}(?:市|区|县|省|镇|乡|街道|办事处|委员会))(?:\d{4})?/,
        /\d{4}年?(.{2,30}(?:市|区|县|省|镇|乡|街道|办事处|委员会))/,
        /^(.{2,30}(?:市|区|县|省|街道|镇|乡))(?:\d{4}年)?(?:人民)?(?:政府|办事处|委员会)/,
        // 通用提取 - 包括局/委
        /(.{2,20}(?:市|区|县|街道|办事处|镇|乡|局|委|办))/,
    ];

    for (const pattern of patterns) {
        const match = name.match(pattern);
        if (match && match[1]) {
            const regionName = match[1].replace(/\d+/g, '').trim();
            if (regionName.length >= 2) {
                return regionName;
            }
        }
    }
    return '';
};

function BatchUpload({ onClose, isEmbedded = false }) {
    const [regions, setRegions] = useState([]);
    const [files, setFiles] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [isDragging, setIsDragging] = useState(false);
    const [model, setModel] = useState('qwen3-235b');
    const [editingId, setEditingId] = useState(null);
    const [batchId, setBatchId] = useState(null); // Track current batch session
    const fileInputRef = useRef(null);

    // 加载区域列表
    useEffect(() => {
        const loadRegions = async () => {
            try {
                const resp = await apiClient.get('/regions');
                let rows = resp.data?.data ?? resp.data?.regions ?? resp.data ?? [];
                if (!Array.isArray(rows)) rows = [];

                // 构建层级树
                const regionMap = new Map();
                const roots = [];

                rows.forEach(r => {
                    r.children = [];
                    regionMap.set(Number(r.id), r);
                });

                rows.forEach(r => {
                    const parentIdNum = r.parent_id ? Number(r.parent_id) : null;
                    if (parentIdNum && regionMap.has(parentIdNum)) {
                        regionMap.get(parentIdNum).children.push(r);
                    } else {
                        roots.push(r);
                    }
                });

                // 排序
                const sortNodes = (nodes) => {
                    nodes.sort((a, b) => a.id - b.id);
                    nodes.forEach(n => sortNodes(n.children));
                };
                sortNodes(roots);

                // 扁平化
                const sortedRows = [];
                const traverse = (nodes) => {
                    nodes.forEach(n => {
                        const { children, ...rest } = n;
                        sortedRows.push(rest);
                        traverse(n.children);
                    });
                };
                traverse(roots);

                setRegions(sortedRows);
            } catch (err) {
                console.error('Failed to load regions:', err);
            }
        };
        loadRegions();
    }, []);

    // Build region map for ancestor lookup
    const regionMap = React.useMemo(() => {
        const map = new Map();
        regions.forEach(r => map.set(Number(r.id), r));
        return map;
    }, [regions]);

    // 自动匹配区域 (基于层级和祖先匹配)
    const autoMatchRegion = useCallback((name) => {
        if (!name || !regions.length) return '';

        let bestMatchId = '';
        let maxScore = -1;

        // 预处理搜索词
        const searchName = name.replace(/(?:人民政府|办事处|委员会|政府|总局)$/g, '');

        regions.forEach(r => {
            // 1. 基础名称匹配
            // 数据库名称去后缀
            let dbName = r.name.replace(/(?:人民政府|办事处|委员会|政府|总局)$/g, '');

            // 如果核心名称太短（<2），必须完全匹配
            if (dbName.length < 2 && !searchName.includes(dbName)) return;

            let score = 0;

            // 匹配逻辑:
            // A. 搜索词包含区域名 (权重高)
            // B. 区域名包含搜索词 (权重低)

            if (searchName.includes(dbName)) {
                score += 10;
                // 长度奖励：优先匹配由更多字组成的名称 (例如 "沭阳县税务局" > "税务局")
                score += dbName.length * 0.5;
            } else if (dbName.includes(searchName)) {
                score += 5;
            } else {
                return; // 名称不匹配，跳过
            }

            // 2. 祖先上下文匹配 (关键)
            // 向上查找所有祖先，如果祖先的名字也出现在搜索词中，给予高额奖励
            let current = r;
            let ancestorMatchCount = 0;

            // 防止死循环 (max depth 10)
            let depth = 0;
            while (current.parent_id && regionMap.has(Number(current.parent_id)) && depth < 10) {
                const parent = regionMap.get(Number(current.parent_id));
                const parentName = parent.name.replace(/(?:人民政府|办事处|委员会|政府)$/g, '');

                // 如果搜索词中包含了祖先名称 (例如 "沭阳县" 在 "沭阳县教育局" 中)
                // 注意：需要避免短名误判，但行政区划通常较独特
                if (searchName.includes(parentName)) {
                    score += 20; // 匹配到一级祖先奖励20分
                    ancestorMatchCount++;
                }

                current = parent;
                depth++;
            }

            // 如果是同分，优先层级更深的 (通常更具体)
            if (score > maxScore) {
                maxScore = score;
                bestMatchId = String(r.id);
            } else if (score === maxScore) {
                // 同分情况，优先层级深
                if (r.level > (regionMap.get(Number(bestMatchId))?.level || 0)) {
                    bestMatchId = String(r.id);
                }
            }
        });

        return bestMatchId;
    }, [regions, regionMap]);

    // 获取区域路径
    const getRegionPath = useCallback((regionId) => {
        const region = regions.find(r => String(r.id) === String(regionId));
        if (!region) return '';

        const path = [region.name];
        let current = region;
        while (current.parent_id) {
            const parent = regions.find(r => Number(r.id) === Number(current.parent_id));
            if (parent) {
                path.unshift(parent.name);
                current = parent;
            } else {
                break;
            }
        }
        return path.join(' / ');
    }, [regions]);

    // 检查重复报告
    const checkDuplicate = async (unitName, year) => {
        if (!unitName || !year) return { exists: false };
        try {
            const resp = await apiClient.get('/reports', { params: { unit_name: unitName, year } });
            // API returns { data: [...] } or { reports: [...] } depending on version, generic access
            const list = resp.data?.data || resp.data?.reports || [];

            if (list.length > 0) {
                // Check if the report has content
                // Since GET /reports now returns 'has_content', use it.
                // If existing report has NO content, treating it as "not blocking upload" (will be overwritten).
                // Or better: Indicate it exists but is overwriteable.
                const existing = list[0];
                return {
                    exists: true,
                    hasContent: existing.has_content ?? true  // Default to true if field missing (backward compat)
                };
            }
            return { exists: false };
        } catch (error) {
            console.error('Check duplicate failed:', error);
            return { exists: false };
        }
    };

    // 批量检查文件是否存在
    const checkFilesExistence = async (fileItems) => {
        const results = await Promise.all(fileItems.map(async (f) => {
            if (!f.unitName || !f.year) return { id: f.id, exists: false, hasContent: false };
            const { exists, hasContent } = await checkDuplicate(f.unitName, f.year);
            return { id: f.id, exists, hasContent };
        }));

        setFiles(prev => prev.map(f => {
            const res = results.find(r => r.id === f.id);
            return res ? { ...f, duplicate: res.exists, duplicateEmpty: res.exists && !res.hasContent } : f;
        }));
    };

    // 处理文件选择
    const handleFilesSelect = useCallback((fileList) => {
        const existingCount = files.length;
        const newFileArray = Array.from(fileList);

        if (existingCount + newFileArray.length > MAX_FILES) {
            alert(`最多支持${MAX_FILES}个文件，当前已有${existingCount}个`);
            return;
        }

        const newFiles = newFileArray.map(file => {
            const regionName = extractRegionFromFilename(file.name);
            const regionId = autoMatchRegion(regionName);
            return {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                file,
                filename: file.name,
                year: extractYearFromFilename(file.name),
                unitName: regionName,
                regionId,
                matchStatus: regionId ? 'auto' : 'unmatched',
                status: 'pending',
                message: '',
                reportId: null,
            };
        });

        setFiles(prev => [...prev, ...newFiles]);
        checkFilesExistence(newFiles);
    }, [files.length, autoMatchRegion, checkFilesExistence]);

    // 拖拽处理
    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFilesSelect(e.dataTransfer.files);
    };

    const handleFileInputChange = (e) => {
        if (e.target.files) {
            handleFilesSelect(e.target.files);
        }
        e.target.value = '';
    };

    // 删除文件
    const removeFile = (id) => {
        setFiles(prev => prev.filter(f => f.id !== id));
    };

    // 更新文件信息
    const updateFile = (id, updates) => {
        setFiles(prev => prev.map(f =>
            f.id === id ? { ...f, ...updates, matchStatus: updates.regionId ? 'manual' : f.matchStatus } : f
        ));
    };




    // 上传单个文件
    const uploadSingleFile = async (fileItem, currentBatchId) => {
        const formData = new FormData();
        formData.append('region_id', fileItem.regionId);
        formData.append('year', fileItem.year);
        if (fileItem.unitName) {
            formData.append('unit_name', fileItem.unitName);
        }
        formData.append('file', fileItem.file);
        formData.append('auto_parse', 'true');
        if (model) formData.append('model', model);
        if (currentBatchId) formData.append('batch_id', currentBatchId); // Pass batch_id explicitly

        const response = await apiClient.post('/reports', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        });

        return response.data;
    };

    // 开始批量处理
    const startProcessing = async () => {
        // 检查是否有未分配区域的文件
        const unmatchedFiles = files.filter(f => !f.regionId && f.status === 'pending');
        if (unmatchedFiles.length > 0) {
            alert(`有 ${unmatchedFiles.length} 个文件未分配区域，请先完成分配`);
            return;
        }

        const pendingFiles = files.filter(f => f.status === 'pending');
        if (pendingFiles.length === 0) {
            alert('没有待处理的文件');
            return;
        }

        // Generate unique batch ID for this upload session
        const newBatchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        setBatchId(newBatchId);

        setIsProcessing(true);

        for (let i = 0; i < files.length; i++) {
            const fileItem = files[i];
            if (fileItem.status !== 'pending') continue;

            setCurrentIndex(i);

            // 更新状态为上传中
            setFiles(prev => prev.map(f =>
                f.id === fileItem.id ? { ...f, status: 'uploading', message: '上传中...' } : f
            ));

            try {
                const uploadResult = await uploadSingleFile(fileItem, newBatchId);
                const jobId = uploadResult.job_id || uploadResult.jobId;
                const versionId = uploadResult.version_id || uploadResult.versionId;

                if (jobId && versionId) {
                    // 更新状态为提交成功/解析中
                    setFiles(prev => prev.map(f =>
                        f.id === fileItem.id ? { ...f, status: 'parsing', message: '已提交，后台解析中...' } : f
                    ));

                    // 不再等待解析完成，直接处理下一个
                    // const job = await pollJob(versionId); ...
                } else {
                    setFiles(prev => prev.map(f =>
                        f.id === fileItem.id ? { ...f, status: 'success', message: '✅ 上传成功' } : f
                    ));
                }
            } catch (error) {
                if (error.response?.status === 409) {
                    setFiles(prev => prev.map(f =>
                        f.id === fileItem.id ? { ...f, status: 'skipped', message: '⏭️ 已存在' } : f
                    ));
                } else {
                    setFiles(prev => prev.map(f =>
                        f.id === fileItem.id ? {
                            ...f,
                            status: 'failed',
                            message: error.response?.data?.error || error.message || '上传失败'
                        } : f
                    ));
                }
            }

            // 短暂延迟避免请求过快
            await new Promise(r => setTimeout(r, 500));
        }

        setIsProcessing(false);
        setCurrentIndex(-1);

        // FIX: Redirect to Task Center after batch upload completes
        setTimeout(() => {
            window.location.href = '/jobs';
        }, 1500); // Brief delay to show final statistics
    };

    // 计算进度
    const getProgress = () => {
        // parsing counts as completed for the upload phase (handoff successful)
        const completed = files.filter(f =>
            ['success', 'failed', 'skipped', 'parsing'].includes(f.status)
        ).length;
        return {
            completed,
            total: files.length,
            percent: files.length ? Math.round(completed / files.length * 100) : 0,
        };
    };

    // 获取统计
    const getStats = () => {
        return {
            pending: files.filter(f => f.status === 'pending').length,
            success: files.filter(f => ['success', 'parsing'].includes(f.status)).length,
            failed: files.filter(f => f.status === 'failed').length,
            skipped: files.filter(f => f.status === 'skipped').length,
            unmatched: files.filter(f => !f.regionId).length,
        };
    };

    const progress = getProgress();
    const stats = getStats();

    // 获取状态图标
    const getStatusIcon = (status) => {
        switch (status) {
            case 'pending': return <Clock size={18} className="text-secondary" />;
            case 'uploading': return <Loader size={18} className="spin text-primary" />;
            case 'parsing': return <Loader size={18} className="spin text-warning" />;
            case 'success': return <Check size={18} className="text-success" />;
            case 'failed': return <XCircle size={18} className="text-danger" />;
            case 'skipped': return <SkipForward size={18} className="text-muted" />;
            default: return <AlertTriangle size={18} className="text-muted" />;
        }
    };

    // 获取匹配状态样式
    const getMatchStatusClass = (file) => {
        if (!file.regionId) return 'unmatched';
        if (file.matchStatus === 'manual') return 'manual';
        return 'auto';
    };

    return (
        <div className={`batch-upload-container ${isEmbedded ? 'embedded' : 'modal'}`}>
            <div className="batch-upload-content">
                {!isEmbedded && (
                    <div className="batch-upload-header">
                        <h2><UploadCloud size={24} style={{ marginRight: '10px' }} /> 批量上传报告</h2>
                        <button className="close-btn" onClick={onClose} disabled={isProcessing}>
                            <X size={20} />
                        </button>
                    </div>
                )}

                {/* AI模型选择 */}
                <div className="form-section">
                    <label>AI 模型</label>
                    <select
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        disabled={isProcessing}
                    >
                        <option value="qwen3-235b">通义千问 Qwen3-235B (ModelScope)</option>
                        <option value="mimo-v2">小米 MiMo V2 (极速版)</option>
                        <option value="deepseek-v3">DeepSeek V3.2 (ModelScope)</option>
                        <option value="gemini/gemini-2.5-flash">Gemini 2.5 Flash</option>
                        <option value="gemini/gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
                        <option value="gemini/gemini-2.5-pro">Gemini 2.5 Pro</option>
                        <option value="gemini/gemini-3-flash">互政AI-flash</option>
                    </select>
                </div>

                {/* 拖拽区域 */}
                <div
                    className={`drop-zone ${isDragging ? 'dragging' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => !isProcessing && fileInputRef.current?.click()}
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileInputChange}
                        accept=".pdf,.html,.txt"
                        multiple
                        style={{ display: 'none' }}
                        disabled={isProcessing}
                    />
                    <div className="drop-hint">
                        <span className="upload-icon"><UploadCloud size={48} strokeWidth={1.5} /></span>
                        <p><strong>点击选择多个文件</strong> 或 <strong>拖拽文件至此</strong></p>
                        <p className="hint">支持 PDF、HTML 或 TXT 文件，最多 {MAX_FILES} 个</p>
                    </div>
                </div>

                {/* 文件列表 */}
                {files.length > 0 && (
                    <div className="file-list-section">
                        <div className="file-list-header">
                            <h3><FileText size={18} style={{ marginRight: '8px' }} /> 文件列表 ({files.length}个)</h3>
                            {stats.unmatched > 0 && (
                                <span className="warning-badge">
                                    <AlertTriangle size={14} style={{ marginRight: '4px' }} />
                                    {stats.unmatched}个未分配区域
                                </span>
                            )}
                        </div>

                        <div className="file-list">
                            {files.map((fileItem, index) => (
                                <div
                                    key={fileItem.id}
                                    className={`file-item ${fileItem.status} ${getMatchStatusClass(fileItem)} ${currentIndex === index ? 'processing' : ''}`}
                                >
                                    <div className="file-main">
                                        <span className="file-status">{getStatusIcon(fileItem.status)}</span>
                                        <span className="file-name" title={fileItem.filename}>
                                            {fileItem.filename.length > 30
                                                ? fileItem.filename.substring(0, 30) + '...'
                                                : fileItem.filename}
                                        </span>
                                        {fileItem.duplicate && (
                                            <span className="duplicate-badge" style={{
                                                marginLeft: '8px',
                                                color: fileItem.duplicateEmpty ? '#f56c6c' : '#e6a23c',
                                                backgroundColor: fileItem.duplicateEmpty ? '#fef0f0' : '#fdf6ec',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                fontSize: '12px',
                                                border: fileItem.duplicateEmpty ? '1px solid #fde2e2' : '1px solid #faecd8'
                                            }}>
                                                {fileItem.duplicateEmpty ? <span><XCircle size={12} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} /> 无内容 (可覆盖)</span> : <span><AlertTriangle size={12} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} /> 报告已存在</span>}
                                            </span>
                                        )}
                                    </div>

                                    {editingId === fileItem.id ? (
                                        // 编辑模式
                                        <div className="file-edit">
                                            <div className="edit-row">
                                                <label>年份:</label>
                                                <input
                                                    type="number"
                                                    value={fileItem.year}
                                                    onChange={(e) => {
                                                        const newYear = parseInt(e.target.value) || new Date().getFullYear();
                                                        updateFile(fileItem.id, { year: newYear });
                                                        checkDuplicate(fileItem.unitName, newYear).then(res =>
                                                            updateFile(fileItem.id, { duplicate: res.exists, duplicateEmpty: res.exists && !res.hasContent })
                                                        );
                                                    }}
                                                />
                                            </div>
                                            <div className="edit-row">
                                                <label>单位:</label>
                                                <input
                                                    type="text"
                                                    value={fileItem.unitName}
                                                    onChange={(e) => {
                                                        const newName = e.target.value;
                                                        updateFile(fileItem.id, { unitName: newName });
                                                        checkDuplicate(newName, fileItem.year).then(res =>
                                                            updateFile(fileItem.id, { duplicate: res.exists, duplicateEmpty: res.exists && !res.hasContent })
                                                        );
                                                    }}
                                                    placeholder="单位名称"
                                                />
                                            </div>
                                            <div className="edit-row">
                                                <label>区域:</label>
                                                <RegionCascader
                                                    regions={regions}
                                                    value={fileItem.regionId}
                                                    onChange={(val) => updateFile(fileItem.id, { regionId: val })}
                                                />
                                            </div>
                                            <div className="edit-actions">
                                                <button className="btn-small" onClick={() => setEditingId(null)}>完成</button>
                                            </div>
                                        </div>
                                    ) : (
                                        // 显示模式
                                        <div className="file-info">
                                            <span className="file-year">{fileItem.year}年</span>
                                            <span className={`file-region ${!fileItem.regionId ? 'missing' : ''}`}>
                                                {fileItem.regionId
                                                    ? getRegionPath(fileItem.regionId)
                                                    : <span className="flex-center"><AlertTriangle size={12} style={{ marginRight: 4 }} /> 未分配</span>}
                                            </span>
                                            {fileItem.message && (
                                                <span className="file-message">{fileItem.message}</span>
                                            )}
                                        </div>
                                    )}

                                    <div className="file-actions">
                                        {fileItem.status === 'pending' && !isProcessing && (
                                            <>
                                                <button
                                                    className="btn-icon"
                                                    onClick={() => setEditingId(editingId === fileItem.id ? null : fileItem.id)}
                                                    title="编辑"
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                                <button
                                                    className="btn-icon danger"
                                                    onClick={() => removeFile(fileItem.id)}
                                                    title="删除"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 进度条 */}
                {isProcessing && (
                    <div className="progress-section">
                        <div className="progress-bar">
                            <div
                                className="progress-fill"
                                style={{ width: `${progress.percent}%` }}
                            />
                        </div>
                        <div className="progress-text">
                            进度: {progress.completed}/{progress.total} ({progress.percent}%)
                        </div>
                    </div>
                )}

                {/* 统计信息 */}
                {files.length > 0 && !isProcessing && progress.completed > 0 && (
                    <div className="stats-section">
                        <span className="stat success"><Check size={14} /> 成功: {stats.success}</span>
                        <span className="stat failed"><XCircle size={14} /> 失败: {stats.failed}</span>
                        <span className="stat skipped"><SkipForward size={14} /> 跳过: {stats.skipped}</span>
                    </div>
                )}

                {/* 操作按钮 */}
                <div className="batch-actions">
                    {!isProcessing ? (
                        <>
                            <button
                                className="btn-cancel"
                                onClick={() => setFiles([])}
                                disabled={files.length === 0}
                            >
                                清空列表
                            </button>
                            <button
                                className="btn-primary"
                                onClick={startProcessing}
                                disabled={files.length === 0 || stats.pending === 0}
                            >
                                <Play size={16} fill="currentColor" style={{ marginRight: '8px' }} /> 开始批量上传 ({stats.pending}个)
                            </button>
                        </>
                    ) : (
                        <button className="btn-cancel" disabled>
                            处理中，请等待...
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default BatchUpload;
