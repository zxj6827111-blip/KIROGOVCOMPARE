import React from 'react';

// 勾稽关系分析组件
const ConsistencyCheckAnalysis = ({ validationResults }) => {
    // If validationResults is strictly undefined/null, it means no validation data exists (e.g. old record)
    if (validationResults === undefined || validationResults === null) return null;

    return (
        <div className={`mt-4 border rounded-lg p-4 shadow-sm break-inside-avoid mb-6 ${validationResults.length === 0 ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'
            }`}>
            <h4 className={`text-sm font-bold mb-2 flex items-center ${validationResults.length === 0 ? 'text-green-900' : 'text-blue-900'
                }`}>
                <span className="mr-2">🧮</span> 表格数据勾稽关系分析
            </h4>

            {validationResults.length === 0 ? (
                <div className="flex items-center text-xs text-green-800 bg-green-100 p-2 rounded">
                    <span className="mr-2 text-green-600">✓</span>
                    <span>所有勾稽关系校验通过，数据逻辑一致。</span>
                </div>
            ) : (
                <div className="space-y-2">
                    {validationResults.map((issue, idx) => (
                        <div key={idx} className={`flex items-start text-xs p-2 rounded ${issue.severity === 'error' ? 'bg-red-50 text-red-800 border border-red-100' :
                            issue.severity === 'warning' ? 'bg-yellow-50 text-yellow-800 border border-yellow-100' :
                                'bg-gray-50 text-gray-700'
                            }`}>
                            <span className={`mr-2 font-bold px-1.5 py-0.5 rounded text-[10px] ${issue.severity === 'error' ? 'bg-red-200' : issue.severity === 'warning' ? 'bg-yellow-200' : 'bg-gray-200'
                                }`}>
                                {issue.severity === 'error' ? '错误' : issue.severity === 'warning' ? '警告' : '提示'}
                            </span>
                            <div className="flex-1">
                                <div className="font-medium">{issue.message}</div>
                                {issue.relatedValues && (
                                    <div className="mt-1 text-gray-500 font-mono">
                                        预期值: {issue.relatedValues.expected} | 实际值: {issue.relatedValues.actual}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ConsistencyCheckAnalysis;
