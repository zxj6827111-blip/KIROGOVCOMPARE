import React, { useEffect, useState, useRef, useMemo } from 'react';
import './RegionsManager.css';
import { apiClient } from '../apiClient';
import {
  ChevronRight,
  Map as MapIcon,
  Building2,
  FileText,
  Trash2,
  Plus,
  Loader,
  Upload,
  X,
  Download,
  AlertTriangle,
  Edit2,
  ArrowUp,
  ArrowDown,
  ArrowRightLeft
} from 'lucide-react';

function RegionsManager() {
  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Selection Path: Array of full region objects representing the "active" path.
  const [selectionPath, setSelectionPath] = useState([]);

  // Map for quick report counts: regionId -> count
  const [reportCountMap, setReportCountMap] = useState(new Map());

  // --- New State for Features ---
  const [showAddModal, setShowAddModal] = useState(false);
  const [addParentId, setAddParentId] = useState(null); // ID of the column where "Add" was clicked
  const [newRegionName, setNewRegionName] = useState('');
  const [showBatchUpload, setShowBatchUpload] = useState(false);
  const [batchFile, setBatchFile] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ percentage: 0, current: 0, total: 0, message: '' });

  // Edit Region State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRegion, setEditingRegion] = useState(null);
  const [editName, setEditName] = useState('');

  // Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    message: '',
    onConfirm: null,
  });

  const closeConfirm = () => {
    setConfirmDialog({ isOpen: false, message: '', onConfirm: null });
  };

  const showConfirm = (message, onConfirm) => {
    setConfirmDialog({
      isOpen: true,
      message,
      onConfirm: () => {
        try {
          onConfirm();
        } catch (e) {
          console.log('Error executing onConfirm callback:', e);
        }
        closeConfirm();
      }
    });
  };

  const confirmBatchUpload = async () => {
    if (!batchFile) return;

    setIsImporting(true);
    setImportProgress({ percentage: 0, current: 0, total: 0, message: '开始上传...' });

    const formData = new FormData();
    formData.append('file', batchFile);

    try {
      // Use fetch directly for streaming support
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${apiClient.defaults.baseURL}/regions/import`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process line by line
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (!line.trim()) continue;

          try {
            const data = JSON.parse(line);
            if (data.error) throw new Error(data.error);
            setImportProgress(data);
          } catch (e) {
            console.warn('Failed to parse progress line:', line, e);
          }
        }
      }

      // Success
      setTimeout(() => {
        setShowBatchUpload(false);
        setBatchFile(null);
        setIsImporting(false);
        fetchData();
      }, 500);

    } catch (err) {
      alert('导入失败: ' + err.message);
      setIsImporting(false);
    }
  };

  const handleDeleteRegion = async (e, region) => {
    e.stopPropagation();

    showConfirm(`确定要删除 "${region.name}" 及其所有下级区域吗？`, async () => {
      setLoading(true);
      try {
        await apiClient.delete(`/regions/${region.id}`);
        fetchData();
      } catch (err) {
        alert('删除失败: ' + (err.response?.data?.error || err.message));
        setLoading(false);
      }
    });
  };

  const scrollContainerRef = useRef(null);

  // --- Data Fetching ---
  const fetchData = async () => {
    setLoading(true);
    try {
      const [regionsResp, reportsResp] = await Promise.all([
        apiClient.get('/regions'),
        apiClient.get('/reports')
      ]);
      const regionsData = regionsResp.data.data || regionsResp.data;
      setRegions(Array.isArray(regionsData) ? regionsData : []);

      // Calculate report counts
      const counts = new Map();
      const reportsData = reportsResp.data.data || reportsResp.data;
      const reportsList = Array.isArray(reportsData) ? reportsData : [];
      reportsList.forEach(r => {
        const rid = String(r.region_id);
        counts.set(rid, (counts.get(rid) || 0) + 1);
      });
      setReportCountMap(counts);
    } catch (err) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- Auto-scroll Logic ---
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        left: scrollContainerRef.current.scrollWidth,
        behavior: 'smooth'
      });
    }
  }, [selectionPath]);

  // --- Helpers ---
  // 判断是否为部门：名称优先（名称以区县后缀结尾一定是区县），否则用 level 字段判断
  const isDepartment = (region) => {
    if (!region) return false;
    const name = typeof region === 'string' ? region : region.name;
    if (!name) return false;

    // 1. 名称优先：如果名称以行政区划后缀结尾，一定是区县（非部门）
    const regionSuffixes = ["省", "市", "区", "县", "乡", "镇", "街道"];
    const isRegionByName = regionSuffixes.some(s => name.endsWith(s));
    if (isRegionByName) {
      return false; // 名称匹配行政区划，不是部门
    }

    // 2. 名称不匹配时，用 level 字段判断：level=3 表示部门，level=2 表示区县
    if (typeof region === 'object' && region.level !== undefined && region.level !== null) {
      return region.level === 3;
    }

    // 3. 兜底：名称不以区县后缀结尾且没有 level 字段，视为部门
    return true;
  };

  const getChildren = (parentId) => {
    return regions
      .filter(r => r.parent_id === parentId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  };

  const getRootRegions = () => {
    return regions
      .filter(r => !r.parent_id || r.level === 1)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  };

  // --- Handlers ---
  const handleItemClick = (region, columnIndex) => {
    const newPath = selectionPath.slice(0, columnIndex);
    newPath.push(region);
    setSelectionPath(newPath);
  };

  const handleAddClick = (parentId) => {
    setAddParentId(parentId);
    setNewRegionName('');
    setShowAddModal(true);
  };

  const confirmAddRegion = async () => {
    if (!newRegionName.trim()) return;
    try {
      // Generate a unique code
      const code = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      await apiClient.post('/regions', {
        code: code,
        name: newRegionName,
        parent_id: addParentId
      });
      setShowAddModal(false);
      fetchData(); // Refresh list
    } catch (err) {
      alert('添加失败: ' + (err.response?.data?.error || err.message));
    }
  };

  // --- Edit Region ---
  const handleEditClick = (e, region) => {
    e.stopPropagation();
    setEditingRegion(region);
    setEditName(region.name);
    setShowEditModal(true);
  };

  const confirmEditRegion = async () => {
    if (!editName.trim() || !editingRegion) return;
    try {
      await apiClient.put(`/regions/${editingRegion.id}`, { name: editName });
      setShowEditModal(false);
      setEditingRegion(null);
      fetchData();
    } catch (err) {
      alert('修改失败: ' + (err.response?.data?.error || err.message));
    }
  };

  // --- Change Category (Department <-> District) ---
  const handleChangeCategory = async (e, item) => {
    e.stopPropagation();
    const isDept = isDepartment(item);
    // If currently a department (level 3), move to district (level 2)
    // If currently a district (level 2), move to department (level 3)
    const newLevel = isDept ? 2 : 3;
    const actionName = isDept ? '区县' : '部门';

    if (!window.confirm(`确定要将「${item.name}」移动到「${actionName}」分类吗？`)) {
      return;
    }

    try {
      await apiClient.put(`/regions/${item.id}`, { level: newLevel });
      fetchData();
    } catch (err) {
      alert('移动失败: ' + (err.response?.data?.error || err.message));
    }
  };

  // --- Move Up/Down ---
  const handleMoveUp = async (e, item, siblings) => {
    e.stopPropagation();
    const currentIndex = siblings.findIndex(s => s.id === item.id);
    if (currentIndex <= 0) return; // Already at top

    const prevItem = siblings[currentIndex - 1];
    // Swap sort_order
    const orders = [
      { id: item.id, sort_order: prevItem.sort_order || currentIndex - 1 },
      { id: prevItem.id, sort_order: item.sort_order || currentIndex }
    ];

    try {
      await apiClient.post('/regions/reorder', { orders });
      fetchData();
    } catch (err) {
      alert('排序失败: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleMoveDown = async (e, item, siblings) => {
    e.stopPropagation();
    const currentIndex = siblings.findIndex(s => s.id === item.id);
    if (currentIndex >= siblings.length - 1) return; // Already at bottom

    const nextItem = siblings[currentIndex + 1];
    // Swap sort_order
    const orders = [
      { id: item.id, sort_order: nextItem.sort_order || currentIndex + 1 },
      { id: nextItem.id, sort_order: item.sort_order || currentIndex }
    ];

    try {
      await apiClient.post('/regions/reorder', { orders });
      fetchData();
    } catch (err) {
      alert('排序失败: ' + (err.response?.data?.error || err.message));
    }
  };

  // --- Render Logic: Columns ---
  const columnsToRender = useMemo(() => {
    const cols = [];

    // Column 0: Roots
    cols.push({
      id: 'root',
      items: getRootRegions(),
      parentId: null,
      level: 0
    });

    // Subsequent Columns based on path
    selectionPath.forEach((selectedRegion, index) => {
      if (!isDepartment(selectedRegion)) {
        const children = getChildren(selectedRegion.id);
        if (children.length > 0 || !isDepartment(selectedRegion)) {
          cols.push({
            id: selectedRegion.id,
            items: children,
            parentId: selectedRegion.id,
            level: index + 1
          });
        }
      }
    });

    return cols;
  }, [regions, selectionPath]);

  const lastSelected = selectionPath[selectionPath.length - 1];
  const showDetailPanel = lastSelected && isDepartment(lastSelected);

  // --- Render Helper for List Items ---
  const renderColumnItem = (item, colIndex, activeItem, siblings) => {
    const isActive = activeItem?.id === item.id;
    const isDept = isDepartment(item);
    const count = reportCountMap.get(String(item.id)) || 0;
    const itemIndex = siblings.findIndex(s => s.id === item.id);
    const isFirst = itemIndex === 0;
    const isLast = itemIndex === siblings.length - 1;

    return (
      <div
        key={item.id}
        onClick={() => handleItemClick(item, colIndex)}
        className={`column-item group relative ${isActive ? 'active' : ''}`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {isDept ? <Building2 size={16} className="shrink-0 opacity-70" /> : <MapIcon size={16} className="shrink-0 opacity-70" />}
          <span className="truncate font-medium">{item.name}</span>
        </div>

        <div className="flex items-center gap-1">
          {/* Sort buttons */}
          <button
            className={`p-1 hover:bg-blue-100 rounded text-gray-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity ${isFirst ? 'invisible' : ''}`}
            onClick={(e) => handleMoveUp(e, item, siblings)}
            title="上移"
          >
            <ArrowUp size={12} />
          </button>
          <button
            className={`p-1 hover:bg-blue-100 rounded text-gray-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity ${isLast ? 'invisible' : ''}`}
            onClick={(e) => handleMoveDown(e, item, siblings)}
            title="下移"
          >
            <ArrowDown size={12} />
          </button>
          {/* Edit button */}
          <button
            className="p-1 hover:bg-blue-100 rounded text-gray-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => handleEditClick(e, item)}
            title="编辑名称"
          >
            <Edit2 size={12} />
          </button>
          {/* Change Category button - only show for items with parent */}
          {item.parent_id && (
            <button
              className="p-1 hover:bg-orange-100 rounded text-gray-400 hover:text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => handleChangeCategory(e, item)}
              title={isDept ? "移动到区县" : "移动到部门"}
            >
              <ArrowRightLeft size={12} />
            </button>
          )}
          {/* Delete button */}
          <button
            className="p-1 hover:bg-red-100 rounded text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => handleDeleteRegion(e, item)}
            title="删除区域"
          >
            <Trash2 size={12} />
          </button>
          {count > 0 && (
            <span className={`text-xs px-1.5 rounded-full ${isActive ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
              {count}
            </span>
          )}
          {!isDept && <ChevronRight size={14} className="opacity-50" />}
        </div>
      </div>
    );
  };

  return (
    <div className="miller-layout h-full flex flex-col relative">
      {/* Header */}
      <div className="miller-header p-4 border-b border-gray-200 bg-white flex justify-between items-center shrink-0">
        <div>
          <p className="text-lg font-medium text-gray-800">
            {selectionPath.map(r => r.name).join(' / ') || '全区'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="px-3 py-1.5 text-sm border border-gray-200 rounded hover:bg-gray-50 flex items-center gap-2"
            onClick={() => setShowBatchUpload(true)}
          >
            <Upload size={16} /> 批量上传
          </button>
          <button className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50" onClick={fetchData}>
            刷新
          </button>
        </div>
      </div>

      {/* Columns Container */}
      <div
        className="miller-container flex-1 flex overflow-x-auto bg-gray-50"
        ref={scrollContainerRef}
      >
        {columnsToRender.map((col, colIndex) => {
          const activeItem = selectionPath[colIndex];

          const adminItems = col.items.filter(i => !isDepartment(i));
          const deptItems = col.items.filter(i => isDepartment(i));

          return (
            <div key={col.id} className="miller-column">
              <div className="flex-1 overflow-y-auto relative">
                {col.items.length === 0 && (
                  <div className="p-4 text-gray-400 text-sm italic text-center mt-10">
                    暂无下级区域
                  </div>
                )}

                {/* Group A: Administrative Regions */}
                {adminItems.length > 0 && (
                  <>
                    <div className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-400 border-b border-slate-100 uppercase flex items-center gap-2 backdrop-blur-sm bg-opacity-90">
                      <MapSizeIconFallback /> 行政区划
                    </div>
                    {adminItems.map(item => renderColumnItem(item, colIndex, activeItem, adminItems))}
                  </>
                )}

                {/* Group B: Departments */}
                {deptItems.length > 0 && (
                  <>
                    <div className="sticky top-0 z-10 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-400 border-b border-slate-100 uppercase flex items-center gap-2 backdrop-blur-sm bg-opacity-90 mt-0">
                      <Building2 size={12} /> 直属部门
                    </div>
                    {deptItems.map(item => renderColumnItem(item, colIndex, activeItem, deptItems))}
                  </>
                )}
              </div>

              {/* Column Footer: Add Region Button */}
              <div className="border-t border-gray-200 p-2 bg-white/50 backdrop-blur-sm sticky bottom-0">
                <button
                  className="w-full text-left text-xs text-gray-500 hover:text-blue-600 px-2 py-1 flex items-center gap-1"
                  onClick={() => handleAddClick(col.parentId)}
                >
                  <Plus size={12} /> 添加区域...
                </button>
              </div>
            </div>
          );
        })}

        {/* Detail Panel */}
        {showDetailPanel && (
          <div className="miller-detail-panel">
            <div className="p-6 border-b border-gray-100 flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4 text-blue-600">
                <Building2 size={32} />
              </div>
              <h3 className="text-xl font-bold text-gray-800">{lastSelected.name}</h3>
              <div className="text-sm text-gray-400 mt-1 uppercase tracking-wide">Department / 部门</div>
            </div>
            <div className="p-6">
              <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <FileText size={16} /> 关联报告 ({reportCountMap.get(String(lastSelected.id)) || 0})
              </h4>
              <div className="space-y-3">
                <button
                  className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                  onClick={() => window.location.href = `/upload?regionId=${lastSelected.id}`}
                >
                  上传新报告
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Region Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-96 shadow-xl animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold mb-4">添加新区域 / 部门</h3>
            <input
              autoFocus
              type="text"
              placeholder="请输入名称 (如: 宿城区 或 某某局)"
              className="w-full border border-gray-300 rounded p-2 mb-4 focus:ring-2 focus:ring-blue-500 outline-none"
              value={newRegionName}
              onChange={e => setNewRegionName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmAddRegion()}
            />
            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded"
                onClick={() => setShowAddModal(false)}
              >
                取消
              </button>
              <button
                className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded"
                onClick={confirmAddRegion}
              >
                确认添加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Region Modal */}
      {showEditModal && editingRegion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-96 shadow-xl animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold mb-4">修改区域名称</h3>
            <input
              autoFocus
              type="text"
              placeholder="请输入新名称"
              className="w-full border border-gray-300 rounded p-2 mb-4 focus:ring-2 focus:ring-blue-500 outline-none"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmEditRegion()}
            />
            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded"
                onClick={() => { setShowEditModal(false); setEditingRegion(null); }}
              >
                取消
              </button>
              <button
                className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded"
                onClick={confirmEditRegion}
              >
                确认修改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Region Import Modal */}
      {showBatchUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 w-[500px] shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">批量导入城市列表</h3>
              <button onClick={() => setShowBatchUpload(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              上传 Excel 或 CSV 文件，按"省份、城市、区县、街道"四列格式导入城市层级结构。
            </p>
            <div className="flex gap-2 mb-4">
              <a
                href="/api/regions/template"
                download
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded hover:bg-gray-50 text-sm"
              >
                <Download size={16} /> 下载模板
              </a>
            </div>
            {/* New File Input UI */}
            <div className="mb-6">
              <label
                htmlFor="batch-file-upload"
                className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${batchFile ? 'border-blue-300 bg-blue-50' : 'border-gray-300'
                  }`}
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  {batchFile ? (
                    <>
                      <FileText className="w-8 h-8 text-blue-500 mb-2" />
                      <p className="text-sm text-blue-600 font-medium">{batchFile.name}</p>
                      <p className="text-xs text-gray-500">{(batchFile.size / 1024).toFixed(1)} KB</p>
                    </>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 text-gray-400 mb-2" />
                      <p className="text-sm text-gray-500"><span className="font-semibold">点击上传</span> 或拖拽文件</p>
                      <p className="text-xs text-gray-400">支持 Excel / CSV</p>
                    </>
                  )}
                </div>
                <input
                  id="batch-file-upload"
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => setBatchFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>

            {/* Progress Bar UI */}
            {isImporting && (
              <div className="mb-6 animate-in slide-in-from-top-2 duration-300">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-blue-600 font-medium">{importProgress.message}</span>
                  <span className="text-gray-500">{importProgress.percentage}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-blue-600 h-full transition-all duration-300 ease-out"
                    style={{ width: `${importProgress.percentage}%` }}
                  ></div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                disabled={isImporting}
                onClick={() => { setShowBatchUpload(false); setBatchFile(null); }}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={confirmBatchUpload}
                disabled={!batchFile || isImporting}
                className={`px-4 py-2 text-sm text-white rounded flex items-center gap-2 ${(!batchFile || isImporting) ? 'bg-blue-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
              >
                {isImporting ? <Loader size={16} className="animate-spin" /> : <Upload size={16} />}
                {isImporting ? '正在导入...' : '确认导入'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirm Modal */}
      {
        confirmDialog.isOpen && (
          <div className="confirm-modal-overlay">
            <div className="confirm-modal">
              <div className="confirm-modal-icon">
                <AlertTriangle size={48} />
              </div>
              <h3>确认操作</h3>
              <p>{confirmDialog.message}</p>
              <div className="confirm-modal-actions">
                <button className="btn-cancel-modal" onClick={closeConfirm}>取消</button>
                <button className="btn-confirm-modal" onClick={confirmDialog.onConfirm}>确定</button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}

// Icon wrapper to avoid collision
const MapSizeIconFallback = () => <MapIcon size={12} />;

export default RegionsManager;
