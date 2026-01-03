import React, { useState, useEffect } from 'react';
import './Login.css';
import { apiClient } from '../apiClient';

function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({ reports: 0, regions: 0 });

  useEffect(() => {
    // Fetch system stats
    const fetchStats = async () => {
      try {
        // Use apiClient if it points to /api, or fetch directly if simpler
        // Assuming apiClient base URL is set correctly, but health endpoint is usually /api/health
        // We added /api/public-stats
        const res = await apiClient.get('/public-stats');
        setStats(res.data);
      } catch (err) {
        console.error('Failed to fetch stats', err);
      }
    };
    fetchStats();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post('/auth/login', { username, password });
      const { token, user } = response.data;

      localStorage.setItem('admin_token', token);
      localStorage.setItem('admin_user', JSON.stringify(user));

      onLoginSuccess(user);
    } catch (err) {
      const message = err.response?.data?.error || '登录失败，请检查用户名和密码';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container" style={{ backgroundImage: "url(/login-bg.png)" }}>
      <div className="login-card">
        {/* Header Section: Logo and Title */}
        <div className="login-header-section">
          <div className="login-brand">
            <img src="/logo-huzheng.png" alt="Logo" className="login-logo" />
            <div className="login-title-group">
              <h1 className="login-title">政府信息公开年度报告差异比对系统</h1>
            </div>
          </div>
        </div>

        {/* Content Section: Stats and Form */}
        <div className="login-content">
          <div className="login-stats">
            <div className="stat-item">
              <span className="stat-label">已收录年报:</span>
              <span className="stat-value">{stats.reports}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">覆盖区域:</span>
              <span className="stat-value">{stats.regions}</span>
            </div>
          </div>

          <div className="login-form-wrapper">
            <div className="login-form-header">
              <h2>用户名</h2>
            </div>

            <form onSubmit={handleSubmit} className="login-form">
              {error && <div className="login-error">{error}</div>}

              <div className="input-group">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="用户名"
                  className="login-input"
                />
              </div>

              <div className="input-group">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="密码"
                  className="login-input"
                />
              </div>

              <button type="submit" className="login-button" disabled={loading}>
                {loading ? '登录中...' : '登录'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
