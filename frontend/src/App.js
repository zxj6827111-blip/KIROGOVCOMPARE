import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import CreateTask from './components/CreateTask';
import TaskDetail from './components/TaskDetail';
import AssetCatalog from './components/AssetCatalog';
import UploadReport from './components/UploadReport';
import ReportsList from './components/ReportsList';
import ReportDetail from './components/ReportDetail';
import ComparePage from './components/ComparePage';
import { apiClient, API_BASE_URL } from './apiClient';

function TaskDetailPage({ taskId, initialTask, onBack }) {
  const [task, setTask] = useState(initialTask || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!taskId || (initialTask && initialTask.taskId === taskId)) {
      return;
    }

    let cancelled = false;
    const fetchTask = async () => {
      setLoading(true);
      try {
        const response = await apiClient.get(`/v1/tasks/${taskId}`);
        if (cancelled) return;
        setTask(response.data);
      } catch (error) {
        console.error('获取任务详情失败:', error);
        alert('❌ 获取任务详情失败');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchTask();

    return () => {
      cancelled = true;
    };
  }, [initialTask, taskId]);

  if (!taskId) {
    return <div className="page-container">未提供 taskId 参数</div>;
  }

  if (loading || !task) {
    return <div className="page-container">加载任务详情中...</div>;
  }

  return <TaskDetail task={task} onBack={onBack} />;
}

function App() {
  const [currentPath, setCurrentPath] = useState(`${window.location.pathname}${window.location.search}`);
  const [initialTask, setInitialTask] = useState(null);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(`${window.location.pathname}${window.location.search}`);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (path) => {
    if (path === currentPath) return;
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  const location = useMemo(() => new URL(currentPath, window.location.origin), [currentPath]);
  const pathname = location.pathname;
  const searchParams = location.searchParams;

  useEffect(() => {
    if (pathname === '/') {
      navigate('/upload');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const handleCreateTask = (task) => {
    if (task && task.taskId) {
      setInitialTask(task);
      navigate(`/tasks/detail?taskId=${task.taskId}`);
      alert(`✅ 任务创建成功！任务 ID: ${task.taskId}`);
    }
  };

  const renderContent = () => {
    if (pathname === '/upload') return <UploadReport />;
    if (pathname === '/tasks/create') return <CreateTask onCreateTask={handleCreateTask} />;
    if (pathname === '/tasks/detail') {
      const taskId = searchParams.get('taskId');
      return (
        <TaskDetailPage
          taskId={taskId}
          initialTask={initialTask && initialTask.taskId === taskId ? initialTask : null}
          onBack={() => navigate('/tasks/create')}
        />
      );
    }
    if (pathname === '/catalog') return <AssetCatalog />;
    if (pathname === '/catalog/reports') {
      return (
        <ReportsList
          onSelectReport={(report) => {
            const reportId = report?.report_id || report?.reportId;
            if (reportId) {
              navigate(`/catalog/reports/${reportId}`);
            }
          }}
        />
      );
    }
    if (pathname.startsWith('/catalog/reports/')) {
      const reportId = pathname.split('/').pop();
      return <ReportDetail reportId={reportId} onBack={() => navigate('/catalog/reports')} />;
    }
    if (pathname === '/compare') return <ComparePage />;
    return <UploadReport />;
  };

  const isNavActive = (path) => pathname.startsWith(path);

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
          type="button"
          className={`nav-btn ${isNavActive('/tasks') ? 'active' : ''}`}
          onClick={() => navigate('/tasks/create')}
        >
          ➕ 创建任务
        </button>
        <button
          type="button"
          className={`nav-btn ${isNavActive('/upload') ? 'active' : ''}`}
          onClick={() => navigate('/upload')}
        >
          📤 上传报告
        </button>
        <button
          type="button"
          className={`nav-btn ${isNavActive('/catalog') ? 'active' : ''}`}
          onClick={() => navigate('/catalog')}
        >
          📊 年报汇总
        </button>
        <button
          type="button"
          className={`nav-btn ${isNavActive('/compare') ? 'active' : ''}`}
          onClick={() => navigate('/compare')}
        >
          🔀 报告比对
        </button>
      </nav>

      <main className="main">{renderContent()}</main>

      <footer className="footer">
        <p>© 2025 政府信息公开年度报告差异比对系统 | 后端 API: {API_BASE_URL || '同域 /dev proxy'}</p>
      </footer>
    </div>
  );
}

export default App;
