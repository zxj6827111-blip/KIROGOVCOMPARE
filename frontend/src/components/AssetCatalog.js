import React from 'react';
import './CreateTask.css';

function AssetCatalog() {
  return (
    <div className="create-task-container">
      <div className="create-task-card">
        <h2>📚 年报汇总</h2>
        <p className="subtitle">即将提供更多统计视图，敬请期待。</p>
        <div className="info-box">
          <h3>💡 使用提示</h3>
          <ul>
            <li>上传或创建任务后，可以在任务详情页查看对比结果。</li>
            <li>后续将支持按地区、年份快速浏览已摄入的报告。</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default AssetCatalog;
