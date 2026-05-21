import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Edit2,
  ArrowUp,
  ArrowDown,
  ArrowRightLeft,
  MoveRight
} from 'lucide-react';
import { useToast } from './common/ToastProvider';
import { useConfirmDialog } from './common/ConfirmDialogProvider';

function RegionsManager() {
  const toast = useToast();
  const confirmAction = useConfirmDialog();
  const [regions, setRegions] = useState([]);
  const [isReordering, setIsReordering] = useState(false);

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
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [migrationSource, setMigrationSource] = useState(null);
  const [migrationTargetId, setMigrationTargetId] = useState('');
  const [migrationTargetProvinceId, setMigrationTargetProvinceId] = useState('');
  const [migrationTargetCityId, setMigrationTargetCityId] = useState('');
  const [migrationTargetDistrictId, setMigrationTargetDistrictId] = useState('');
  const [migrationPreview, setMigrationPreview] = useState(null);
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [migrationExecuting, setMigrationExecuting] = useState(false);

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
      toast.error('导入失败', err.message);
      setIsImporting(false);
    }
  };

  const handleDeleteRegion = async (e, region) => {
    e.stopPropagation();

    const confirmed = await confirmAction({
      title: '删除区域',
      message: `确定要删除 "${region.name}" 及其所有下级区域吗？`,
      confirmText: '删除',
      tone: 'danger',
    });
    if (!confirmed) return;

    try {
      await apiClient.delete(`/regions/${region.id}`);
      toast.success('区域已删除');
      fetchData();
    } catch (err) {
      const data = err.response?.data || {};
      const message = data.details
        ? `${data.error || '删除失败'}${data.details ? ` ${data.details}` : ''}`
        : (data.error || err.message);
      toast.error('删除失败', message);
    }
  };

  const closeMigrationModal = () => {
    setShowMigrationModal(false);
    setMigrationSource(null);
    setMigrationTargetId('');
    setMigrationTargetProvinceId('');
    setMigrationTargetCityId('');
    setMigrationTargetDistrictId('');
    setMigrationPreview(null);
    setMigrationLoading(false);
    setMigrationExecuting(false);
  };

  const runMigrationPreview = async (sourceRegionId, targetRegionId) => {
    setMigrationLoading(true);
    try {
      const resp = await apiClient.post('/regions/report-migration/preview', {
        source_region_id: sourceRegionId,
        target_region_id: targetRegionId
      });
      setMigrationPreview(resp.data?.data || null);
    } catch (err) {
      toast.error('迁移预检失败', err.response?.data?.error || err.message);
      setMigrationPreview(null);
    } finally {
      setMigrationLoading(false);
    }
  };

  const setMigrationTargetSelection = (targetId) => {
    const path = [];
    let cursor = regions.find(item => String(item.id) === String(targetId));
    const visited = new Set();
    while (cursor && !visited.has(cursor.id)) {
      path.unshift(cursor);
      visited.add(cursor.id);
      cursor = regions.find(item => String(item.id) === String(cursor.parent_id));
    }

    const province = path[0] || null;
    const city = path[1] || null;
    const district = path[2] || null;
    setMigrationTargetProvinceId(province ? String(province.id) : '');
    setMigrationTargetCityId(city ? String(city.id) : '');
    setMigrationTargetDistrictId(district ? String(district.id) : '');
    setMigrationTargetId(String(targetId));
  };

  const handleOpenMigration = async (e, region) => {
    e.stopPropagation();
    if (!region.parent_id) {
      toast.warning('无法迁移', '当前区域没有上级区域。');
      return;
    }

    setMigrationSource(region);
    setMigrationTargetSelection(region.parent_id);
    setMigrationPreview(null);
    setShowMigrationModal(true);
    await runMigrationPreview(region.id, region.parent_id);
  };

  const updateMigrationTarget = async (nextTargetId) => {
    setMigrationTargetId(nextTargetId);
    setMigrationPreview(null);
    if (migrationSource && nextTargetId) {
      await runMigrationPreview(migrationSource.id, Number(nextTargetId));
    }
  };

  const handleMigrationProvinceChange = async (event) => {
    const provinceId = event.target.value;
    const nextCity = migrationTargetOptions
      .filter(region => String(region.parent_id) === provinceId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))[0] || null;
    const nextDistrict = nextCity
      ? migrationTargetOptions
        .filter(region => String(region.parent_id) === String(nextCity.id))
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))[0] || null
      : null;
    const nextTarget = nextDistrict || nextCity || migrationTargetOptions.find(region => String(region.id) === provinceId);

    setMigrationTargetProvinceId(provinceId);
    setMigrationTargetCityId(nextCity ? String(nextCity.id) : '');
    setMigrationTargetDistrictId(nextDistrict ? String(nextDistrict.id) : '');
    if (nextTarget) {
      await updateMigrationTarget(String(nextTarget.id));
    }
  };

  const handleMigrationCityChange = async (event) => {
    const cityId = event.target.value;
    const nextDistrict = migrationTargetOptions
      .filter(region => String(region.parent_id) === cityId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))[0] || null;
    const nextTarget = nextDistrict || migrationTargetOptions.find(region => String(region.id) === cityId);

    setMigrationTargetCityId(cityId);
    setMigrationTargetDistrictId(nextDistrict ? String(nextDistrict.id) : '');
    if (nextTarget) {
      await updateMigrationTarget(String(nextTarget.id));
    }
  };

  const handleMigrationDistrictChange = async (event) => {
    const districtId = event.target.value;
    setMigrationTargetDistrictId(districtId);
    await updateMigrationTarget(districtId);
  };

  const handleExecuteMigration = async () => {
    if (!migrationSource || !migrationTargetId || migrationExecuting) return;
    const executableCount = migrationPreview?.summary?.executable_change_count || 0;
    const movableCount = migrationPreview?.summary?.movable_report_count || 0;
    const deleteCount = migrationPreview?.summary?.deleted_report_count || 0;
    if (executableCount === 0) {
      toast.warning('没有可处理报告', '当前预检结果没有可迁移或可自动解决的冲突报告。');
      return;
    }

    const target = regions.find(region => String(region.id) === String(migrationTargetId));
    const confirmed = await confirmAction({
      title: '执行报告迁移',
      message: `确认将「${migrationSource.name}」下 ${movableCount} 份报告迁移到「${target?.name || migrationTargetId}」吗？冲突年份会按上传时间保留最新报告，并清理 ${deleteCount} 份旧报告。`,
      confirmText: '执行迁移',
      tone: 'danger',
    });
    if (!confirmed) return;

    setMigrationExecuting(true);
    try {
      const resp = await apiClient.post('/regions/report-migration/execute', {
        source_region_id: migrationSource.id,
        target_region_id: Number(migrationTargetId)
      });
      setMigrationPreview(resp.data?.data || null);
      toast.success('迁移完成', `已迁移 ${resp.data?.moved_reports?.length || 0} 份报告，清理 ${resp.data?.deleted_reports?.length || 0} 份旧报告。`);
      await fetchData();
    } catch (err) {
      const data = err.response?.data || {};
      toast.error('迁移失败', data.error || err.message);
      if (data.data) {
        setMigrationPreview(data.data);
      }
    } finally {
      setMigrationExecuting(false);
    }
  };

  const scrollContainerRef = useRef(null);

  // --- Data Fetching ---
  const fetchData = async () => {
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
      console.error('Failed to load regions:', err);
    } finally {
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

  const getChildren = useCallback((parentId) => {
    return regions
      .filter(r => r.parent_id === parentId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [regions]);

  const getRootRegions = useCallback(() => {
    return regions
      .filter(r => !r.parent_id || r.level === 1)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [regions]);

  const migrationTargetOptions = useMemo(() => {
    if (!migrationSource) return [];
    const blockedIds = new Set([migrationSource.id]);
    let changed = true;
    while (changed) {
      changed = false;
      regions.forEach(region => {
        if (blockedIds.has(region.parent_id) && !blockedIds.has(region.id)) {
          blockedIds.add(region.id);
          changed = true;
        }
      });
    }

    return regions
      .filter(region => !blockedIds.has(region.id))
      .sort((a, b) => {
        const levelDiff = Number(a.level || 0) - Number(b.level || 0);
        if (levelDiff !== 0) return levelDiff;
        return (a.sort_order || 0) - (b.sort_order || 0);
      });
  }, [migrationSource, regions]);

  const migrationProvinceOptions = useMemo(() => {
    return migrationTargetOptions
      .filter(region => !region.parent_id || Number(region.level) === 1)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [migrationTargetOptions]);

  const migrationCityOptions = useMemo(() => {
    if (!migrationTargetProvinceId) return [];
    return migrationTargetOptions
      .filter(region => String(region.parent_id) === String(migrationTargetProvinceId))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [migrationTargetOptions, migrationTargetProvinceId]);

  const migrationDistrictOptions = useMemo(() => {
    if (!migrationTargetCityId) return [];
    return migrationTargetOptions
      .filter(region => String(region.parent_id) === String(migrationTargetCityId))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }, [migrationTargetOptions, migrationTargetCityId]);

  const selectedMigrationTarget = useMemo(() => {
    return regions.find(region => String(region.id) === String(migrationTargetId)) || null;
  }, [migrationTargetId, regions]);

  const formatMigrationRegionOption = (region) => {
    if (!region) return '';
    return `${region.name}（ID ${region.id}）`;
  };

  const formatReportTime = (value) => {
    if (!value) return '时间未知';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    return date.toLocaleString('zh-CN', { hour12: false });
  };

  const describeConflictResolution = (item) => {
    if (item?.resolution === 'keep_source') {
      return '源报告更新：迁移源报告，并清理目标旧报告';
    }
    if (item?.resolution === 'keep_target') {
      return '目标报告更新：保留目标报告，并清理源旧报告';
    }
    if (item?.resolution === 'blocked_same_upload_time') {
      return '上传时间相同或缺失：需要人工确认';
    }
    return '按上传时间保留最新报告';
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
      toast.success('区域已添加');
      fetchData(); // Refresh list
    } catch (err) {
      toast.error('添加失败', err.response?.data?.error || err.message);
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
      toast.success('区域已修改');
      fetchData();
    } catch (err) {
      toast.error('修改失败', err.response?.data?.error || err.message);
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

    const confirmed = await confirmAction({
      title: '移动分类',
      message: `确定要将「${item.name}」移动到「${actionName}」分类吗？`,
      confirmText: '移动',
      tone: 'default',
    });
    if (!confirmed) {
      return;
    }

    try {
      await apiClient.put(`/regions/${item.id}`, { level: newLevel });
      toast.success('分类已移动', `已移动到「${actionName}」。`);
      fetchData();
    } catch (err) {
      toast.error('移动失败', err.response?.data?.error || err.message);
    }
  };

  // --- Move Up/Down ---
  const handleMoveUp = async (e, item, siblings) => {
    e.stopPropagation();
    if (isReordering) return;
    const currentIndex = siblings.findIndex(s => s.id === item.id);
    if (currentIndex <= 0) return; // Already at top

    // Rebuild full sibling order with contiguous sort_order values.
    // This avoids jumps when existing sort_order has duplicates/null values.
    const reordered = [...siblings];
    const [movedItem] = reordered.splice(currentIndex, 1);
    reordered.splice(currentIndex - 1, 0, movedItem);
    const orders = reordered.map((r, index) => ({
      id: r.id,
      sort_order: index + 1
    }));

    try {
      setIsReordering(true);
      await apiClient.post('/regions/reorder', { orders });
      await fetchData();
    } catch (err) {
      toast.error('排序失败', err.response?.data?.error || err.message);
    } finally {
      setIsReordering(false);
    }
  };

  const handleMoveDown = async (e, item, siblings) => {
    e.stopPropagation();
    if (isReordering) return;
    const currentIndex = siblings.findIndex(s => s.id === item.id);
    if (currentIndex >= siblings.length - 1) return; // Already at bottom

    // Rebuild full sibling order with contiguous sort_order values.
    // This avoids jumps when existing sort_order has duplicates/null values.
    const reordered = [...siblings];
    const [movedItem] = reordered.splice(currentIndex, 1);
    reordered.splice(currentIndex + 1, 0, movedItem);
    const orders = reordered.map((r, index) => ({
      id: r.id,
      sort_order: index + 1
    }));

    try {
      setIsReordering(true);
      await apiClient.post('/regions/reorder', { orders });
      await fetchData();
    } catch (err) {
      toast.error('排序失败', err.response?.data?.error || err.message);
    } finally {
      setIsReordering(false);
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
  }, [getChildren, getRootRegions, selectionPath]);

  const lastSelected = selectionPath[selectionPath.length - 1];
  const showDetailPanel = lastSelected && isDepartment(lastSelected);
  const selectedReportCount = lastSelected ? (reportCountMap.get(String(lastSelected.id)) || 0) : 0;

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
            className={`p-1 hover:bg-blue-100 rounded text-gray-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed ${isFirst ? 'invisible' : ''}`}
            onClick={(e) => handleMoveUp(e, item, siblings)}
            disabled={isReordering || isFirst}
            title="上移"
          >
            <ArrowUp size={12} />
          </button>
          <button
            className={`p-1 hover:bg-blue-100 rounded text-gray-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed ${isLast ? 'invisible' : ''}`}
            onClick={(e) => handleMoveDown(e, item, siblings)}
            disabled={isReordering || isLast}
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
          {item.parent_id && count > 0 && (
            <button
              className="p-1 hover:bg-blue-100 rounded text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => handleOpenMigration(e, item)}
              title="报告迁移"
            >
              <MoveRight size={12} />
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
          {lastSelected?.parent_id && selectedReportCount > 0 && (
            <button
              className="px-3 py-1.5 text-sm border border-blue-200 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 flex items-center gap-2"
              onClick={(e) => handleOpenMigration(e, lastSelected)}
            >
              <MoveRight size={16} /> 报告迁移
            </button>
          )}
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
                <FileText size={16} /> 关联报告 ({selectedReportCount})
              </h4>
              <div className="space-y-3">
                <button
                  className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                  onClick={() => window.location.href = `/upload?regionId=${lastSelected.id}`}
                >
                  上传新报告
                </button>
                {lastSelected.parent_id && selectedReportCount > 0 && (
                  <button
                    className="w-full py-2 px-4 border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                    onClick={(e) => handleOpenMigration(e, lastSelected)}
                  >
                    <MoveRight size={16} /> 报告迁移
                  </button>
                )}
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

      {/* Report Migration Modal */}
      {showMigrationModal && migrationSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="report-migration-modal bg-white rounded-lg shadow-xl">
            <div className="report-migration-header">
              <div>
                <h3>报告迁移</h3>
                <p>将误挂在当前区域下的年报迁移到正确区域。预检会跳过同年份冲突，不会自动覆盖或删除报告。</p>
              </div>
              <button onClick={closeMigrationModal} className="report-migration-close" aria-label="关闭">
                <X size={18} />
              </button>
            </div>

            <div className="report-migration-body">
              <div className="report-migration-form">
                <label>
                  <span>源区域</span>
                  <input value={`${migrationSource.name}（ID ${migrationSource.id}）`} disabled />
                </label>
                <div className="report-migration-target-picker">
                  <label>
                    <span>省份</span>
                    <select value={migrationTargetProvinceId} onChange={handleMigrationProvinceChange}>
                      {migrationProvinceOptions.map(region => (
                        <option key={region.id} value={region.id}>
                          {formatMigrationRegionOption(region)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>地市</span>
                    <select
                      value={migrationTargetCityId}
                      onChange={handleMigrationCityChange}
                      disabled={!migrationTargetProvinceId || migrationCityOptions.length === 0}
                    >
                      {migrationCityOptions.map(region => (
                        <option key={region.id} value={region.id}>
                          {formatMigrationRegionOption(region)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>区县 / 单位</span>
                    <select
                      value={migrationTargetDistrictId || migrationTargetCityId}
                      onChange={handleMigrationDistrictChange}
                      disabled={!migrationTargetCityId}
                    >
                      {migrationTargetCityId && (
                        <option value={migrationTargetCityId}>
                          {formatMigrationRegionOption(migrationCityOptions.find(region => String(region.id) === String(migrationTargetCityId))) || '地市本级'}（本级）
                        </option>
                      )}
                      {migrationDistrictOptions.map(region => (
                        <option key={region.id} value={region.id}>
                          {formatMigrationRegionOption(region)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="report-migration-target-current">
                    当前目标：{selectedMigrationTarget ? formatMigrationRegionOption(selectedMigrationTarget) : '未选择'}
                  </div>
                </div>
              </div>

              {migrationLoading && (
                <div className="report-migration-loading">
                  <Loader size={16} className="animate-spin" /> 正在预检迁移影响...
                </div>
              )}

              {!migrationLoading && migrationPreview && (
                <>
                  <div className="report-migration-summary">
                    <div>
                      <span>源报告</span>
                      <strong>{migrationPreview.summary.source_report_count}</strong>
                    </div>
                    <div>
                      <span>可迁移</span>
                      <strong>{migrationPreview.summary.movable_report_count}</strong>
                    </div>
                    <div>
                      <span>冲突</span>
                      <strong>{migrationPreview.summary.conflict_report_count}</strong>
                    </div>
                    <div>
                      <span>将清理旧报告</span>
                      <strong>{migrationPreview.summary.deleted_report_count || 0}</strong>
                    </div>
                  </div>

                  <div className="report-migration-section">
                    <h4>可迁移报告</h4>
                    {migrationPreview.movable_reports.length === 0 ? (
                      <p className="report-migration-empty">没有无冲突报告。</p>
                    ) : (
                      <div className="report-migration-list">
                        {migrationPreview.movable_reports.map(report => (
                          <div key={report.id} className="report-migration-row">
                            <strong>{report.year}</strong>
                            <span>{report.unit_name || `报告 #${report.id}`}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="report-migration-section">
                    <h4>冲突年份</h4>
                    {migrationPreview.target_conflicts.length === 0 ? (
                      <p className="report-migration-empty">没有冲突年份。</p>
                    ) : (
                      <div className="report-migration-list">
                        {migrationPreview.target_conflicts.map(item => (
                          <div key={item.source_report.id} className="report-migration-row conflict detailed">
                            <strong>{item.source_report.year}</strong>
                            <span>
                              <b>{describeConflictResolution(item)}</b>
                              <small>
                                源：{item.source_report?.unit_name || `报告 #${item.source_report?.id}`}，
                                上传时间 {formatReportTime(item.source_report?.upload_time || item.source_report?.created_at)}
                              </small>
                              <small>
                                目标：{item.target_report?.unit_name || `报告 #${item.target_report?.id}`}，
                                上传时间 {formatReportTime(item.target_report?.upload_time || item.target_report?.created_at)}
                              </small>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="report-migration-actions">
              <button
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded"
                onClick={closeMigrationModal}
                disabled={migrationExecuting}
              >
                取消
              </button>
              <button
                className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded disabled:opacity-50"
                onClick={handleExecuteMigration}
                disabled={migrationLoading || migrationExecuting || !migrationPreview || (migrationPreview.summary.executable_change_count || 0) === 0}
              >
                {migrationExecuting ? '正在迁移...' : '按最新报告迁移'}
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
                  accept=".xlsx,.csv"
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

    </div >
  );
}

// Icon wrapper to avoid collision
const MapSizeIconFallback = () => <MapIcon size={12} />;

export default RegionsManager;
