import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center p-20 text-center bg-white rounded-lg border">
      <h1 className="text-6xl font-bold text-gray-300 mb-4">404</h1>
      <h2 className="text-2xl font-semibold text-gray-800 mb-2">页面未找到</h2>
      <p className="text-gray-500 mb-8">您访问的页面不存在或已被移除</p>
      <div className="flex gap-4">
        <button
          onClick={() => navigate('/catalog')}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          返回首页
        </button>
        <button
          onClick={() => navigate(-1)}
          className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
        >
          返回上一页
        </button>
      </div>
    </div>
  );
}
