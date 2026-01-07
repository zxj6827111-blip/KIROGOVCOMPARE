import React, { useState, useEffect, useMemo } from 'react';
import './JobCenter.css'; // Reuse existing styles
import { apiClient } from '../apiClient';
import { User, Plus, Edit, Trash2, Shield, Lock, MapPin, X, Check } from 'lucide-react';

export default function UserManagement() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);

    // Form State
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        displayName: '',
        permissions: {
            manage_users: false,
            manage_cities: false,
            upload_reports: false,
            compare_reports: false,
        },
        dataScope: {
            regions: [], // Empty means all
        }
    });

    // Region Data
    const [regions, setRegions] = useState([]);
    // Selection state for cascading dropdowns
    const [selectedProvince, setSelectedProvince] = useState('');
    const [selectedCity, setSelectedCity] = useState('');
    const [selectedDistrict, setSelectedDistrict] = useState('');
    const [selectedStreet, setSelectedStreet] = useState('');

    useEffect(() => {
        loadUsers();
        loadRegions();
    }, []);

    const loadUsers = async () => {
        try {
            setLoading(true);
            const res = await apiClient.get('/users');
            setUsers(res.data);
        } catch (error) {
            console.error('Failed to load users:', error);
            alert('加载用户失败: ' + (error.response?.data?.error || error.message));
        } finally {
            setLoading(false);
        }
    };

    const loadRegions = async () => {
        try {
            const res = await apiClient.get('/regions');
            const list = res.data?.data || res.data || [];
            setRegions(Array.isArray(list) ? list : []);
        } catch (error) {
            console.error('Failed to load regions:', error);
        }
    };

    // Derived Selection Options - use Number/String coercion for Postgres compatibility
    const provinces = useMemo(() => regions.filter(r => Number(r.level) === 1), [regions]);
    const cities = useMemo(() => selectedProvince ? regions.filter(r => String(r.parent_id) === String(selectedProvince)) : [], [regions, selectedProvince]);
    const districts = useMemo(() => selectedCity ? regions.filter(r => String(r.parent_id) === String(selectedCity)) : [], [regions, selectedCity]);
    const streets = useMemo(() => selectedDistrict ? regions.filter(r => String(r.parent_id) === String(selectedDistrict)) : [], [regions, selectedDistrict]);

    // Handle cascading changes
    const handleProvinceChange = (e) => {
        setSelectedProvince(e.target.value);
        setSelectedCity('');
        setSelectedDistrict('');
        setSelectedStreet('');
    };
    const handleCityChange = (e) => {
        setSelectedCity(e.target.value);
        setSelectedDistrict('');
        setSelectedStreet('');
    };
    const handleDistrictChange = (e) => {
        setSelectedDistrict(e.target.value);
        setSelectedStreet('');
    };

    // Add selected region to scope
    const handleAddRegion = () => {
        // Find the most specific selected region by finding it in the visible options
        let targetId = selectedStreet || selectedDistrict || selectedCity || selectedProvince;
        console.log('Adding region, targetId:', targetId, 'type:', typeof targetId);
        console.log('Regions sample:', regions.slice(0, 3).map(r => ({id: r.id, type: typeof r.id, name: r.name})));
        
        if (!targetId) {
            console.log('No target ID selected');
            return;
        }

        // Find region: try both string and number match
        const targetIdStr = String(targetId);
        const region = regions.find(r => String(r.id) === targetIdStr);
        
        console.log('Found region:', region);
        
        if (!region) {
            console.warn('Region not found for targetId:', targetId);
            alert('无法找到对应的区域，请刷新页面重试');
            return;
        }
        
        if (!formData.dataScope.regions.includes(region.name)) {
            setFormData(prev => ({
                ...prev,
                dataScope: {
                    regions: [...prev.dataScope.regions, region.name]
                }
            }));
            console.log('Region added successfully:', region.name);
        } else {
            console.log('Region already exists:', region.name);
        }
        // Reset selection optionally? No, keep for multiple additions
    };

    const handleRemoveRegion = (regionName) => {
        setFormData(prev => ({
            ...prev,
            dataScope: {
                regions: prev.dataScope.regions.filter(r => r !== regionName)
            }
        }));
    };

    const handleOpenModal = (user = null) => {
        if (user) {
            setEditingUser(user);
            setFormData({
                username: user.username,
                password: '',
                displayName: user.displayName || '',
                permissions: {
                    manage_users: user.permissions?.manage_users || false,
                    manage_cities: user.permissions?.manage_cities || false,
                    manage_jobs: user.permissions?.manage_jobs || false,
                    view_reports: user.permissions?.view_reports || false,
                    upload_reports: user.permissions?.upload_reports || false,
                    compare_reports: user.permissions?.compare_reports || false,
                },
                dataScope: {
                    regions: user.dataScope?.regions || [],
                }
            });
        } else {
            setEditingUser(null);
            setFormData({
                username: '',
                password: '',
                displayName: '',
                permissions: {
                    manage_users: false,
                    manage_cities: false,
                    upload_reports: true,
                    compare_reports: true,
                },
                dataScope: {
                    regions: [],
                }
            });
        }
        // Reset selectors
        setSelectedProvince('');
        setSelectedCity('');
        setSelectedDistrict('');
        setSelectedStreet('');
        setModalOpen(true);
    };

    const handleDelete = async (userId) => {
        if (!userId) {
            alert('错误：未找到用户ID');
            return;
        }
        if (!window.confirm('确定要删除该用户吗？此操作无法撤销。')) return;

        try {
            console.log('Deleting user:', userId);
            await apiClient.delete(`/users/${userId}`);
            alert('删除成功'); // Immediate feedback
            loadUsers();
        } catch (error) {
            console.error('Delete failed:', error);
            alert('删除失败: ' + (error.response?.data?.error || error.message));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const payload = {
                ...formData,
                password: (editingUser && !formData.password) ? undefined : formData.password
            };

            if (editingUser) {
                await apiClient.put(`/users/${editingUser.id}`, payload);
            } else {
                await apiClient.post('/users', payload);
            }
            setModalOpen(false);
            loadUsers();
        } catch (error) {
            alert('保存失败: ' + (error.response?.data?.error || error.message));
        }
    };

    const togglePermission = (key) => {
        setFormData(prev => ({
            ...prev,
            permissions: {
                ...prev.permissions,
                [key]: !prev.permissions[key]
            }
        }));
    };

    return (
        <div className="job-center-container">
            <div className="job-header">
                <div className="job-title-row">
                    <div className="job-title-left">
                        <User size={24} color="#1890ff" />
                        <span className="job-title-text">用户权限管理</span>
                    </div>
                    <button className="primary-btn" onClick={() => handleOpenModal()}>
                        <Plus size={16} /> 新增用户
                    </button>
                </div>
                <div className="job-subtitle">管理系统用户、角色权限及数据范围</div>
            </div>

            <div className="job-list-card">
                {loading ? (
                    <div className="loading-state">加载中...</div>
                ) : (
                    <table className="job-table">
                        <thead>
                            <tr>
                                <th>用户名</th>
                                <th>显示名</th>
                                <th>权限</th>
                                <th>数据范围</th>
                                <th>最后登录</th>
                                <th style={{ width: 120 }}>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id}>
                                    <td className="font-medium">{user.username}</td>
                                    <td>{user.displayName}</td>
                                    <td>
                                        <div className="flex gap-1 flex-wrap">
                                            {user.permissions?.manage_users && <span className="tag-blue">用户管理</span>}
                                            {user.permissions?.manage_cities && <span className="tag-green">城市管理</span>}
                                            {user.permissions?.view_reports && <span className="tag-cyan">查看</span>}
                                            {user.permissions?.upload_reports && <span className="tag-orange">上传</span>}
                                            {user.permissions?.compare_reports && <span className="tag-purple">比对</span>}
                                            {user.permissions?.manage_jobs && <span className="tag-red">任务</span>}
                                            {Object.keys(user.permissions || {}).every(k => !user.permissions[k]) && <span className="text-gray-400 text-sm">无特殊权限</span>}
                                        </div>
                                    </td>
                                    <td>
                                        {(!user.dataScope?.regions || user.dataScope.regions.length === 0)
                                            ? <span className="text-gray-500">全部地区</span>
                                            : <span className="text-blue-600">{user.dataScope.regions.join(', ')}</span>
                                        }
                                    </td>
                                    <td className="text-gray-500 text-sm">
                                        {user.last_login_at || '-'}
                                    </td>
                                    <td>
                                        <div className="action-buttons">
                                            <button className="icon-btn edit" onClick={() => handleOpenModal(user)} title="编辑">
                                                <Edit size={16} />
                                            </button>
                                            {user.id !== 1 && (
                                                <button className="icon-btn delete" onClick={(e) => { e.stopPropagation(); handleDelete(user.id); }} title="删除">
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {modalOpen && (
                <div className="modal-overlay">
                    <div className="modal-content compact-modal">
                        <div className="modal-header">
                            <h3>{editingUser ? '编辑用户' : '新增用户'}</h3>
                            <button className="close-btn" onClick={() => setModalOpen(false)}><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="modal-body">
                            <div className="form-group">
                                <label>用户名</label>
                                <input
                                    type="text"
                                    value={formData.username}
                                    onChange={e => setFormData({ ...formData, username: e.target.value })}
                                    disabled={editingUser}
                                    required
                                    className="form-input"
                                />
                            </div>
                            <div className="form-group">
                                <label>密码 {editingUser && <span className="text-sm text-gray-400">(留空保持不变)</span>}</label>
                                <input
                                    type="password"
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                    required={!editingUser}
                                    minLength={6}
                                    className="form-input"
                                />
                            </div>
                            <div className="form-group">
                                <label>显示名</label>
                                <input
                                    type="text"
                                    value={formData.displayName}
                                    onChange={e => setFormData({ ...formData, displayName: e.target.value })}
                                    className="form-input"
                                />
                            </div>

                            <div className="section-divider"></div>
                            <div className="form-section-title">功能权限</div>
                            <div className="permissions-grid-compact">
                                <label className="checkbox-label"><input type="checkbox" checked={formData.permissions.manage_users} onChange={() => togglePermission('manage_users')} /> 用户管理</label>
                                <label className="checkbox-label"><input type="checkbox" checked={formData.permissions.manage_cities} onChange={() => togglePermission('manage_cities')} /> 城市管理</label>
                                <label className="checkbox-label"><input type="checkbox" checked={formData.permissions.view_reports} onChange={() => togglePermission('view_reports')} /> 查看报告</label>
                                <label className="checkbox-label"><input type="checkbox" checked={formData.permissions.upload_reports} onChange={() => togglePermission('upload_reports')} /> 上传报告</label>
                                <label className="checkbox-label"><input type="checkbox" checked={formData.permissions.compare_reports} onChange={() => togglePermission('compare_reports')} /> 比对报告</label>
                                <label className="checkbox-label"><input type="checkbox" checked={formData.permissions.manage_jobs} onChange={() => togglePermission('manage_jobs')} /> 任务管理</label>
                            </div>

                            <div className="section-divider"></div>
                            <div className="form-section-title">
                                数据范围 <span className="helper-text">(添加可见区域，为空则看全部)</span>
                            </div>

                            <div className="cascading-select-group">
                                <select value={selectedProvince} onChange={handleProvinceChange} className="form-select">
                                    <option value="">选择省份</option>
                                    {provinces.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                                <select value={selectedCity} onChange={handleCityChange} className="form-select" disabled={!selectedProvince}>
                                    <option value="">选择地市</option>
                                    {cities.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                                <select value={selectedDistrict} onChange={handleDistrictChange} className="form-select" disabled={!selectedCity}>
                                    <option value="">选择区县</option>
                                    {districts.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                                <select value={selectedStreet} onChange={e => setSelectedStreet(e.target.value)} className="form-select" disabled={!selectedDistrict}>
                                    <option value="">选择街道/镇</option>
                                    {streets.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                                <button type="button" className="btn-add-region" onClick={handleAddRegion} disabled={!selectedProvince}>
                                    添加
                                </button>
                            </div>

                            <div className="selected-regions-tags">
                                {formData.dataScope.regions.map(r => (
                                    <span key={r} className="region-tag">
                                        {r} <X size={12} className="remove-icon" onClick={() => handleRemoveRegion(r)} />
                                    </span>
                                ))}
                            </div>

                            <div className="modal-footer">
                                <button type="button" className="secondary-btn" onClick={() => setModalOpen(false)}>取消</button>
                                <button type="submit" className="primary-btn">保存</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <style jsx>{`
        .tag-blue { background: #e6f7ff; color: #1890ff; padding: 2px 8px; border-radius: 4px; font-size: 12px; border: 1px solid #91d5ff; }
        .tag-green { background: #f6ffed; color: #52c41a; padding: 2px 8px; border-radius: 4px; font-size: 12px; border: 1px solid #b7eb8f; }
        .tag-orange { background: #fff7e6; color: #fa8c16; padding: 2px 8px; border-radius: 4px; font-size: 12px; border: 1px solid #ffd591; }
        .tag-purple { background: #f9f0ff; color: #722ed1; padding: 2px 8px; border-radius: 4px; font-size: 12px; border: 1px solid #d3adf7; }
        .tag-cyan { background: #e6fffb; color: #13c2c2; padding: 2px 8px; border-radius: 4px; font-size: 12px; border: 1px solid #87e8de; }
        .tag-red { background: #fff1f0; color: #f5222d; padding: 2px 8px; border-radius: 4px; font-size: 12px; border: 1px solid #ffa39e; }
        
        .modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        .modal-content.compact-modal {
            background: #FFFFFF;
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            width: 500px; /* Reduced width */
            max-width: 90vw;
            display: flex;
            flex-direction: column;
            color: #333;
        }
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 12px;
            border-bottom: 1px solid #eee;
        }
        .modal-header h3 { margin: 0; font-size: 18px; font-weight: 600; color: #333; }
        .close-btn { background: none; border: none; cursor: pointer; color: #999; }
        .close-btn:hover { color: #333; }
        
        .form-group { margin-bottom: 12px; }
        .form-group label { display: block; margin-bottom: 6px; font-weight: 500; font-size: 14px; color: #333; }
        .form-input { width: 100%; padding: 8px; border: 1px solid #d9d9d9; border-radius: 4px; font-size: 14px; }
        
        .section-divider { height: 1px; background: #eee; margin: 16px 0; }
        .form-section-title { font-weight: 600; font-size: 14px; margin-bottom: 10px; color: #333; }
        .helper-text { font-size: 12px; color: #999; font-weight: normal; margin-left: 4px; }

        .permissions-grid-compact {
            display: grid;
            grid-template-columns: repeat(4, 1fr); /* 4 items in one row */
            gap: 10px;
            align-items: center;
        }
        .checkbox-label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            cursor: pointer;
            white-space: nowrap;
        }

        .cascading-select-group {
            display: flex;
            gap: 8px;
            margin-bottom: 10px;
            flex-wrap: wrap;
        }
        .form-select {
            flex: 1;
            padding: 6px;
            border: 1px solid #d9d9d9;
            border-radius: 4px;
            font-size: 13px;
            min-width: 80px;
        }
        .btn-add-region {
            background: #2563eb;
            color: #fff;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }
        .btn-add-region:disabled { background: #ccc; cursor: not-allowed; }

        .selected-regions-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            min-height: 32px;
            padding: 4px;
            border: 1px dashed #e5e7eb;
            border-radius: 4px;
        }
        .region-tag {
            background: #e0f2fe;
            color: #0284c7;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .remove-icon { cursor: pointer; }
        .remove-icon:hover { color: #0369a1; }

        .modal-footer {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid #eee;
        }
        .secondary-btn { background: #fff; border: 1px solid #d9d9d9; padding: 6px 15px; border-radius: 4px; cursor: pointer; color: #333; }
        .secondary-btn:hover { border-color: #2563eb; color: #2563eb; }
      `}</style>
        </div>
    );
}
