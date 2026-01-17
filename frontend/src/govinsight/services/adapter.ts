
import { AnnualData, EntityProfile, EntityType } from '../types';

// 1. 定义后端原始数据的接口 (根据您实际数据库字段修改)
export interface RawDBRecord {
  year: number;
  org_id: string;
  org_name: string;
  org_type: string; // 'city' | 'district' | 'department'
  
  // Table 2: 规章与行政行为
  reg_published: number;
  reg_abolished: number;
  reg_active: number;
  doc_published: number; // 规范性文件
  doc_abolished: number;
  doc_active: number;
  action_licensing: number;
  action_punishment: number;
  action_force: number;
  fee_amount: number;

  // Table 3: 依申请公开
  app_new: number;
  app_carried_over: number;
  app_total_handled: number;
  source_natural: number;
  source_legal: number;
  outcome_public: number;
  outcome_partial: number;
  outcome_not_open: number;
  outcome_unable: number;
  outcome_ignore: number;
  app_carried_forward: number;

  // Table 4: 复议诉讼
  rev_total: number;       // 复议总数
  rev_maintained: number;
  rev_corrected: number;
  rev_other: number;
  rev_pending: number;
  
  lit_total: number;       // 诉讼总数
  lit_maintained: number;
  lit_corrected: number;
  lit_other: number;
  lit_pending: number;
}

// 2. 转换函数：将一行数据库记录 -> 转换为 AnnualData 对象
export const transformYearData = (record: RawDBRecord): AnnualData => {
  return {
    year: record.year,
    regulations: {
      published: record.reg_published || 0,
      abolished: record.reg_abolished || 0,
      active: record.reg_active || 0
    },
    normativeDocuments: {
      published: record.doc_published || 0,
      abolished: record.doc_abolished || 0,
      active: record.doc_active || 0
    },
    adminActions: {
      licensing: record.action_licensing || 0,
      punishment: record.action_punishment || 0,
      force: record.action_force || 0
    },
    fees: {
      amount: record.fee_amount || 0
    },
    applications: {
      newReceived: record.app_new || 0,
      carriedOver: record.app_carried_over || 0,
      totalHandled: record.app_total_handled || 0,
      sources: {
        natural: record.source_natural || 0,
        legal: record.source_legal || 0
      },
      outcomes: {
        public: record.outcome_public || 0,
        partial: record.outcome_partial || 0,
        notOpen: record.outcome_not_open || 0,
        unable: record.outcome_unable || 0,
        ignore: record.outcome_ignore || 0
      },
      carriedForward: record.app_carried_forward || 0
    },
    disputes: {
      reconsideration: {
        total: record.rev_total || 0,
        maintained: record.rev_maintained || 0,
        corrected: record.rev_corrected || 0,
        other: record.rev_other || 0,
        pending: record.rev_pending || 0
      },
      litigation: {
        total: record.lit_total || 0,
        maintained: record.lit_maintained || 0,
        corrected: record.lit_corrected || 0,
        other: record.lit_other || 0,
        pending: record.lit_pending || 0
      }
    }
  };
};

// 3. 聚合函数：将多行记录 -> 转换为 EntityProfile
export const transformToEntity = (records: RawDBRecord[]): EntityProfile | null => {
  if (!records || records.length === 0) return null;

  // 假设这些记录属于同一个组织
  const meta = records[0]; 
  
  return {
    id: meta.org_id,
    name: meta.org_name,
    type: meta.org_type as EntityType,
    data: records.map(transformYearData).sort((a, b) => a.year - b.year)
  };
};
