import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import CreateTask from './components/CreateTask';
import TaskDetail from './components/TaskDetail';
import AssetCatalog from './components/AssetCatalog';
import UploadReport from './components/UploadReport';
import { buildApiUrl, API_BASE_URL } from './apiClient';

function App() {
  const [currentPage, setCurrentPage] = useState('upload');
  const [selectedTask, setSelectedTask] = useState(null);

  // 初始化：检查 URL 中是否有 taskId 参数
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get('taskId');
    
    if (taskId) {
      // 从后端获取任务详情
      const fetchTask = async () => {
        try {
          const response = await axios.get(buildApiUrl(`/api/v1/tasks/${taskId}`));
          setSelectedTask(response.data);
          setCurrentPage('detail');
        } catch (error) {
          console.error('获取任务详情失败:', error);
          alert('❌ 获取任务详情失败');
        }
      };
      fetchTask();
    }
  }, []);

  // 创建任务
  const handleCreateTask = (task) => {
    if (task && task.taskId) {
      setSelectedTask(task);
      setCurrentPage('detail');
      alert(`✅ 任务创建成功！任务 ID: ${task.taskId}`);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>📊 政府信息公开年度报告差异比对系统</h1>
          <p>快速对比两份年度报告的差异</p>
        </div>
      </header>

      <nav className="nav">
        <button
          className={`nav-btn ${currentPage === 'create' ? 'active' : ''}`}
          onClick={() => setCurrentPage('create')}
        >
          ➕ 创建任务
        </button>
        <button
          className={`nav-btn ${currentPage === 'upload' ? 'active' : ''}`}
          onClick={() => setCurrentPage('upload')}
        >
          📤 上传报告
        </button>
        <button
          className={`nav-btn ${currentPage === 'catalog' ? 'active' : ''}`}
          onClick={() => setCurrentPage('catalog')}
        >
          📊 年报汇总
        </button>
      </nav>

      <main className="main">
        {currentPage === 'create' && (
          <CreateTask onCreateTask={handleCreateTask} />
        )}

        {currentPage === 'upload' && (
          <UploadReport />
        )}

        {currentPage === 'catalog' && (
          <AssetCatalog />
        )}

        {currentPage === 'detail' && selectedTask && (
          <TaskDetail task={selectedTask} onBack={() => setCurrentPage('create')} />
        )}
      </main>

      <footer className="footer">
        <p>© 2025 政府信息公开年度报告差异比对系统 | 后端 API: {API_BASE_URL || '同域 /dev proxy'}</p>
      </footer>
    </div>
  );
}

export default App;
