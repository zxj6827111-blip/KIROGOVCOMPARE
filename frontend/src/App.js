import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import TaskList from './components/TaskList';
import CreateTask from './components/CreateTask';
import TaskDetail from './components/TaskDetail';
import AssetCatalog from './components/AssetCatalog';

const API_BASE_URL = 'http://localhost:3000/api/v1';

function App() {
  const [currentPage, setCurrentPage] = useState('create');
  const [selectedTask, setSelectedTask] = useState(null);

  // 初始化：检查 URL 中是否有 taskId 参数
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get('taskId');
    
    if (taskId) {
      // 从后端获取任务详情
      const fetchTask = async () => {
        try {
          const response = await axios.get(`${API_BASE_URL}/tasks/${taskId}`);
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

  // 查看任务详情
  const handleViewTask = (task) => {
    setSelectedTask(task);
    setCurrentPage('detail');
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

        {currentPage === 'catalog' && (
          <AssetCatalog />
        )}

        {currentPage === 'detail' && selectedTask && (
          <TaskDetail task={selectedTask} onBack={() => setCurrentPage('create')} />
        )}
      </main>

      <footer className="footer">
        <p>© 2025 政府信息公开年度报告差异比对系统 | 后端 API: http://localhost:3000</p>
      </footer>
    </div>
  );
}

export default App;
