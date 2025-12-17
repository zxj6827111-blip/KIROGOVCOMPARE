import React, { useState, useEffect } from 'react';
import './CreateTask.css';
import { apiClient } from '../apiClient';

function CreateTask({ onCreateTask }) {
  const [region, setRegion] = useState('');
  const [yearA, setYearA] = useState('');
  const [yearB, setYearB] = useState('');
  const [loading, setLoading] = useState(false);
  const [regions, setRegions] = useState([]);
  const [years, setYears] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [urlA, setUrlA] = useState('');
  const [urlB, setUrlB] = useState('');
  const [uploadMode, setUploadMode] = useState('region'); // 'region', 'url', 'upload'
  const [fileA, setFileA] = useState(null);
  const [fileB, setFileB] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // 加载城市列表
  useEffect(() => {
    const loadRegions = async () => {
      try {
        const response = await apiClient.get('/v1/catalog/regions');
        const regionsList = response.data.regions || [];
        setRegions(regionsList);
        
        // 设置第一个城市为默认值
        if (regionsList.length > 0) {
          setRegion(regionsList[0].regionId);
        }
      } catch (error) {
        console.error('加载城市列表失败:', error);
      }
    };
    loadRegions();
  }, []);

  // 加载年份列表
  useEffect(() => {
    const loadYears = async () => {
      try {
        if (!region) return;
        
        const response = await apiClient.get(`/v1/catalog/years?region=${region}`);
        const yearsList = response.data.years.map(y => y.year).sort((a, b) => b - a);
        setYears(yearsList);
        
        // 自动设置年份 A 和 B
        if (yearsList.length >= 2) {
          setYearA(yearsList[0].toString());
          setYearB(yearsList[1].toString());
        } else if (yearsList.length === 1) {
          setYearA(yearsList[0].toString());
          setYearB('');
        } else {
          setYearA('');
          setYearB('');
        }
      } catch (error) {
        console.error('加载年份列表失败:', error);
      }
    };
    loadYears();
  }, [region]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!region || !yearA || !yearB) {
      alert('请选择城市和年份');
      return;
    }

    if (yearA === yearB) {
      alert('两个年份不能相同');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post('/v1/tasks/compare/region-year', {
        region,
        yearA: parseInt(yearA),
        yearB: parseInt(yearB),
      });
      // 创建成功后跳转到详情页面
      if (onCreateTask) {
        onCreateTask(response.data);
      }
    } catch (error) {
      alert('❌ 创建任务失败');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleAdvancedSubmit = async (e) => {
    e.preventDefault();

    if (!urlA.trim() || !urlB.trim()) {
      alert('请输入两个 URL');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post('/v1/tasks/compare/url', {
        urlA,
        urlB,
      });
      // 创建成功后跳转到详情页面
      setUrlA('');
      setUrlB('');
      if (onCreateTask) {
        onCreateTask(response.data);
      }
    } catch (error) {
      alert('❌ 创建任务失败');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    e.preventDefault();

    if (!fileA || !fileB) {
      alert('请选择两个 PDF 文件');
      return;
    }

    setLoading(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append('fileA', fileA);
      formData.append('fileB', fileB);

      const response = await apiClient.post(
        '/v1/tasks/compare/upload',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          onUploadProgress: (progressEvent) => {
            const progress = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            setUploadProgress(progress);
          },
        }
      );

      setFileA(null);
      setFileB(null);
      setUploadProgress(0);

      if (onCreateTask) {
        onCreateTask(response.data);
      }
    } catch (error) {
      alert('❌ 文件上传失败: ' + (error.response?.data?.error || error.message));
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="create-task-container">
      <div className="create-task-card">
        <h2>➕ 创建新的比对任务</h2>
        <p className="subtitle">选择比对方式</p>

        {/* 模式选择 */}
        <div className="mode-selector" style={{ marginBottom: '20px' }}>
          <button
            type="button"
            className={`mode-btn ${uploadMode === 'region' ? 'active' : ''}`}
            onClick={() => setUploadMode('region')}
          >
            📍 按地区年份
          </button>
          <button
            type="button"
            className={`mode-btn ${uploadMode === 'url' ? 'active' : ''}`}
            onClick={() => setUploadMode('url')}
          >
            🔗 按 URL
          </button>
          <button
            type="button"
            className={`mode-btn ${uploadMode === 'upload' ? 'active' : ''}`}
            onClick={() => setUploadMode('upload')}
          >
            📤 上传文件
          </button>
        </div>

        {uploadMode === 'region' && (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="region">选择城市</label>
            <select
              id="region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              disabled={loading}
            >
              {regions.map(r => (
                <option key={r.regionId} value={r.regionId}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            <div className="form-group">
              <label htmlFor="yearA">年份 A</label>
              <select
                id="yearA"
                value={yearA}
                onChange={(e) => setYearA(e.target.value)}
                disabled={loading}
              >
                {years.map(y => (
                  <option key={y} value={y}>{y}年</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="yearB">年份 B</label>
              <select
                id="yearB"
                value={yearB}
                onChange={(e) => setYearB(e.target.value)}
                disabled={loading}
              >
                {years.map(y => (
                  <option key={y} value={y}>{y}年</option>
                ))}
              </select>
            </div>
          </div>

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? '创建中...' : '🚀 创建任务'}
          </button>
        </form>
        )}

        {uploadMode === 'url' && (
        <form onSubmit={handleAdvancedSubmit}>
          <div className="form-group">
            <label htmlFor="urlA">第一份报告 URL</label>
            <input
              id="urlA"
              type="url"
              placeholder="https://example.com/report1.pdf"
              value={urlA}
              onChange={(e) => setUrlA(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="urlB">第二份报告 URL</label>
            <input
              id="urlB"
              type="url"
              placeholder="https://example.com/report2.pdf"
              value={urlB}
              onChange={(e) => setUrlB(e.target.value)}
              disabled={loading}
            />
          </div>

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? '创建中...' : '🚀 创建任务'}
          </button>
        </form>
        )}

        {uploadMode === 'upload' && (
        <form onSubmit={handleFileUpload}>
          <div className="form-group">
            <label htmlFor="fileA">选择第一份 PDF 文件</label>
            <input
              id="fileA"
              type="file"
              accept=".pdf"
              onChange={(e) => setFileA(e.target.files?.[0] || null)}
              disabled={loading}
            />
            {fileA && <p className="file-name">✓ {fileA.name}</p>}
          </div>

          <div className="form-group">
            <label htmlFor="fileB">选择第二份 PDF 文件</label>
            <input
              id="fileB"
              type="file"
              accept=".pdf"
              onChange={(e) => setFileB(e.target.files?.[0] || null)}
              disabled={loading}
            />
            {fileB && <p className="file-name">✓ {fileB.name}</p>}
          </div>

          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${uploadProgress}%` }}>
                {uploadProgress}%
              </div>
            </div>
          )}

          <button type="submit" className="submit-btn" disabled={loading || !fileA || !fileB}>
            {loading ? `上传中... ${uploadProgress}%` : '🚀 上传并创建任务'}
          </button>
        </form>
        )}

        <div className="info-box">
          <h3>📝 说明</h3>
          <ul>
            <li>选择城市和年份，系统自动查找对应的年报</li>
            <li>支持对比同一城市不同年份的报告</li>
            <li>高级选项支持直接输入 URL 进行比对</li>
            <li>处理时间取决于报告大小，通常需要几分钟</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default CreateTask;
