import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import type { ActionPackTemplateInstance, LeaderCockpitModel, MetricValue, ReasonCategory, ReasonItem } from '../types';
import { ReasonTree } from '../components/ReasonTree';
import { AttributionTopList } from '../components/AttributionTopList';
import { formatNumber, formatPercent } from '../utils';
import { metricDefinitions, metricEvidence } from '../definitions';

interface Step2ReasonsProps {
  model: LeaderCockpitModel;
  onShowDefinition: (definition: MetricValue['definition'] | undefined) => void;
  onShowEvidence: (evidence: MetricValue['evidence'] | undefined) => void;
  onCreateActionPack: (pack: ActionPackTemplateInstance) => void;
}

export const Step2Reasons: React.FC<Step2ReasonsProps> = ({
  model,
  onShowDefinition,
  onShowEvidence,
  onCreateActionPack,
}) => {
  const [selectedReason, setSelectedReason] = useState<ReasonItem | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ReasonCategory | null>(null);

  const topAttributions = useMemo(() => {
    return model.reasons.topReasons.map((reason) => ({
      id: reason.id,
      label: reason.name,
      value: reason.value,
      share: reason.share,
      status: reason.status,
    }));
  }, [model.reasons.topReasons]);

  const serviceRatioData = model.trends.serviceRatio.points.map((point) => ({
    year: point.year,
    value: point.status === 'ok' ? point.value : null,
  }));

  const handleSelectReason = (item: ReasonItem, category: ReasonCategory) => {
    setSelectedReason(item);
    setSelectedCategory(category);
  };

  const handleCreatePack = () => {
    if (!selectedReason) return;
    const basePack = model.actionPacks.templates[0];
    if (!basePack) return;
    const nextPack = {
      ...basePack,
      title: `围绕“${selectedReason.name}”的整改行动包`,
      risk: `原因项“${selectedReason.name}”占比偏高，存在被关注风险。`,
    };
    onCreateActionPack(nextPack);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">办理结果与原因结构（年度）</h3>
                <p className="text-xs text-slate-400">三类归因结构，点击原因查看行动建议</p>
              </div>
            </div>
            <ReasonTree categories={model.reasons.categories} onSelect={handleSelectReason} />
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">监管—服务结构比（许可 vs 执法）趋势</h3>
                <p className="text-xs text-slate-400">结构代理指标，不直接等同营商环境优劣</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => onShowDefinition(metricDefinitions.serviceRatio)}
                  className="text-blue-600"
                >
                  i 口径
                </button>
                <button
                  type="button"
                  onClick={() => onShowEvidence(metricEvidence.serviceRatio)}
                  className="text-slate-500"
                >
                  查看证据
                </button>
              </div>
            </div>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serviceRatioData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="year" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <AttributionTopList
            title="Top 原因"
            items={topAttributions}
            missingText="待接入原因结构数据"
          />

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-slate-800 mb-3">原因详情</h4>
            {selectedReason ? (
              <div className="space-y-3 text-xs">
                <div className="text-slate-700 font-semibold">{selectedReason.name}</div>
                <div className="text-slate-500">归因分类：{selectedCategory?.name}</div>
                <div className="text-slate-500">数量：{selectedReason.value !== undefined ? formatNumber(selectedReason.value) : '—'}</div>
                <div className="text-slate-500">占比：{selectedReason.share !== undefined ? formatPercent(selectedReason.share, 1) : '—'}</div>
                <div className="text-slate-500">趋势：{selectedReason.trend !== null && selectedReason.trend !== undefined ? `${selectedReason.trend >= 0 ? '+' : ''}${selectedReason.trend}%` : '暂无同比数据'}</div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleCreatePack}
                    className="w-full px-3 py-2 rounded text-xs font-semibold bg-emerald-600 text-white"
                  >
                    生成行动包
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400">选择原因项查看详情</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
