import React from 'react';

export const DistrictDataPlaceholder: React.FC = () => {
  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg px-4 py-3">
      <div className="font-semibold">区县维度待接入</div>
      <div className="mt-1 text-[11px]">
        区县年报/办件系统分布尚未接入，当前仅展示市级总盘；请上传区县年报或配置数据源。
      </div>
    </div>
  );
};
