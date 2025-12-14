import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './AssetCatalog.css';

const API_BASE_URL = 'http://localhost:3000/api/v1';

function AssetCatalog() {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [assetContent, setAssetContent] = useState(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [filters, setFilters] = useState({
    year: '',
    region: '',
    status: 'usable',
  });

  // 加载年报列表
  useEffect(() => {
    fetchAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const fetchAssets = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.year) params.append('year', filters.year);
      if (filters.region) params.append('region', filters.region);
      if (filters.status) params.append('status', filters.status);

      const response = await axios.get(`${API_BASE_URL}/assets?${params}`);
      setAssets(response.data.assets || []);
    } catch (error) {
      console.error('加载年报列表失败:', error);
      alert('❌ 加载年报列表失败');
    } finally {
      setLoading(false);
    }
  };

  // 查看年报详情
  const handleViewDetails = async (asset) => {
    try {
      setContentLoading(true);
      setSelectedAsset(asset);

      const response = await axios.get(`${API_BASE_URL}/assets/${asset.assetId}/content`);
      setAssetContent(response.data);
    } catch (error) {
      console.error('加载年报详情失败:', error);
      alert('❌ 加载年报详情失败');
    } finally {
      setContentLoading(false);
    }
  };

  // 关闭详情视图
  const handleCloseDetails = () => {
    setSelectedAsset(null);
    setAssetContent(null);
  };

  // 渲染年报列表
  const renderAssetList = () => {
    if (loading) {
      return <div className="loading">加载中...</div>;
    }

    if (assets.length === 0) {
      return <div className="empty-state">暂无年报数据</div>;
    }

    return (
      <div className="asset-list">
        <table className="asset-table">
          <thead>
            <tr>
              <th>文件名</th>
              <th>地区</th>
              <th>年份</th>
              <th>状态</th>
              <th>上传时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.assetId}>
                <td>{asset.fileName}</td>
                <td>{asset.region || '-'}</td>
                <td>{asset.year || '-'}</td>
                <td>
                  <span className={`status-badge status-${asset.status}`}>
                    {asset.status === 'usable' ? '可用' : '不可用'}
                  </span>
                </td>
                <td>{new Date(asset.uploadedAt).toLocaleDateString('zh-CN')}</td>
                <td>
                  <button
                    className="btn-view-details"
                    onClick={() => handleViewDetails(asset)}
                  >
                    查看详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // 渲染详情面板
  const renderDetailsPanel = () => {
    if (!selectedAsset) return null;

    return (
      <div className="details-panel">
        <div className="details-overlay" onClick={handleCloseDetails}></div>
        <div className="details-content">
          <div className="details-header">
            <h2>年报详情</h2>
            <button className="close-btn" onClick={handleCloseDetails}>✕</button>
          </div>

          <div className="details-body">
            <div className="asset-info">
              <div className="info-row">
                <label>文件名:</label>
                <span>{selectedAsset.fileName}</span>
              </div>
              <div className="info-row">
                <label>地区:</label>
                <span>{selectedAsset.region || '-'}</span>
              </div>
              <div className="info-row">
                <label>年份:</label>
                <span>{selectedAsset.year || '-'}</span>
              </div>
              <div className="info-row">
                <label>状态:</label>
                <span className={`status-badge status-${selectedAsset.status}`}>
                  {selectedAsset.status === 'usable' ? '可用' : '不可用'}
                </span>
              </div>
              <div className="info-row">
                <label>上传时间:</label>
                <span>{new Date(selectedAsset.uploadedAt).toLocaleString('zh-CN')}</span>
              </div>
            </div>

            {contentLoading ? (
              <div className="loading">加载详情中...</div>
            ) : assetContent ? (
              <div className="asset-content">
                <h3>年报内容</h3>
                {assetContent.parsedContent && assetContent.parsedContent.sections ? (
                  <div className="sections-container">
                    {assetContent.parsedContent.sections.map((section, idx) => (
                      <div key={idx} className="section">
                        <h4>{section.title}</h4>
                        <div className="section-content">
                          {section.content && (
                            <div className="section-text">
                              {typeof section.content === 'string' ? (
                                <p>{section.content}</p>
                              ) : Array.isArray(section.content) ? (
                                section.content.map((para, pIdx) => (
                                  <p key={pIdx}>{para.text || para}</p>
                                ))
                              ) : null}
                            </div>
                          )}
                          {section.tables && section.tables.length > 0 && (
                            <div className="section-tables">
                              {section.tables.map((table, tableIdx) => (
                                <div key={tableIdx} className="table-wrapper">
                                  {table.title && <h5>{table.title}</h5>}
                                  <table className="data-table">
                                    <tbody>
                                      {table.rows && table.rows.map((row, rowIdx) => (
                                        <tr key={rowIdx}>
                                          {row.cells && row.cells.map((cell, cellIdx) => (
                                            <td key={cellIdx}>{cell || '-'}</td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="content-preview">
                    <pre>{JSON.stringify(assetContent, null, 2)}</pre>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="asset-catalog">
      <div className="catalog-header">
        <h1>📊 年报汇总</h1>
        <p>查看和管理所有上传的政府信息公开年度报告</p>
      </div>

      <div className="filters">
        <div className="filter-group">
          <label>年份:</label>
          <input
            type="number"
            placeholder="输入年份"
            value={filters.year}
            onChange={(e) => setFilters({ ...filters, year: e.target.value })}
          />
        </div>
        <div className="filter-group">
          <label>地区:</label>
          <input
            type="text"
            placeholder="输入地区"
            value={filters.region}
            onChange={(e) => setFilters({ ...filters, region: e.target.value })}
          />
        </div>
        <div className="filter-group">
          <label>状态:</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">全部</option>
            <option value="usable">可用</option>
            <option value="unusable">不可用</option>
          </select>
        </div>
        <button className="btn-reset" onClick={() => setFilters({ year: '', region: '', status: 'usable' })}>
          重置
        </button>
      </div>

      {renderAssetList()}
      {renderDetailsPanel()}
    </div>
  );
}

export default AssetCatalog;
