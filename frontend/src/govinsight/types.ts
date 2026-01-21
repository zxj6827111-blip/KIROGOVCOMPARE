
export interface AnnualData {
  year: number;
  // Table 2: Regulations & Admin Actions
  regulations: {
    published: number;
    abolished: number;
    active: number;
  };
  normativeDocuments: {
    published: number;
    abolished: number;
    active: number;
  };
  adminActions: {
    licensing: number;
    punishment: number;
    force: number;
  };
  fees: {
    amount: number; // In 10k CNY
  };
  // Table 3: Applications
  applications: {
    newReceived: number;
    carriedOver: number;
    totalHandled: number;
    sources: {
      natural: number;
      legal: number; // Corporate + others
    };
    outcomes: {
      public: number;
      partial: number;
      unable: number;
      notOpen: number;
      ignore: number; // Untreated/Other
      // Granular fields kept for backward compatibility if needed, but outcomesDetail is preferred
      unableNoInfo?: number;
      unableNeedCreation?: number;
      unableUnclear?: number;
      notOpenDanger?: number;
      notOpenProcess?: number;
      notOpenInternal?: number;
      notOpenThirdParty?: number;
      notOpenAdminQuery?: number;
      ignoreRepeat?: number;
      other?: number;
    };
    outcomesDetail?: {
      notOpen: {
        stateSecret: number;   // 1. 国家秘密
        lawForbidden: number;  // 2. 法律法规禁止
        danger: number;        // 3. 三安全一稳定
        thirdParty: number;    // 4. 第三方合法权益
        internal: number;      // 5. 内部事务信息
        process: number;       // 6. 过程性信息
        enforcement: number;   // 7. 行政执法案卷
        adminQuery: number;    // 8. 行政查询事项
      };
      unable: {
        noInfo: number;        // 1. 本机关不掌握
        needCreation: number;  // 2. 需要另行制作
        unclear: number;       // 3. 补正后仍不明确
      };
      untreated: {
        complaint: number;     // 1. 信访举报投诉
        repeat: number;        // 2. 重复申请
        publication: number;    // 3. 要求提供公开出版物
        massive: number;       // 4. 无正当理由大量反复
        confirm: number;       // 5. 要求确认或重新获取
      };
      other: {
        overdueCorrection: number; // 1. 逾期补正
        overdueFee: number;        // 2. 逾期缴费
        other: number;             // 3. 其他
      };
    };
    carriedForward: number;
  };
  // Table 4: Disputes
  disputes: {
    reconsideration: {
      total: number;
      maintained: number;
      corrected: number;
      other: number;
      pending: number;
    };
    litigation: {
      total: number;
      maintained: number;
      corrected: number;
      other: number;
      pending: number;
    };
  };
}

export type EntityType = 'province' | 'city' | 'district' | 'department';

export interface EntityProfile {
  id: string;
  name: string;
  type: EntityType;
  data: AnnualData[];
  children?: EntityProfile[]; // For hierarchical navigation
  parentPath?: string[]; // Helper for breadcrumbs e.g. ["江苏省", "南京市"]
}

// --- API TYPES (from backend) ---
export interface ApiResponse<T> {
  code: number;
  msg: string;
  data: T;
}

export interface AnnualDataRecord {
  year: number;
  org_id: string;
  org_name: string;
  org_type: string;
  parent_id: string | null;
  // 规章
  reg_published: number;
  reg_active: number;
  reg_abolished: number; // Added
  // 规范性文件
  doc_published: number;
  doc_active: number;
  doc_abolished: number; // Added
  // 行政许可/处罚
  action_licensing: number;
  action_punishment: number;
  // 依申请公开
  app_new: number;
  app_carried_over: number;
  source_natural: number;
  outcome_public: number;
  outcome_partial: number;
  outcome_unable: number;

  outcome_unable_no_info?: number;
  outcome_unable_need_creation?: number;
  outcome_unable_unclear?: number;
  outcome_not_open: number;
  outcome_not_open_danger?: number;
  outcome_not_open_process?: number;
  outcome_not_open_internal?: number;
  outcome_not_open_third_party?: number;
  outcome_not_open_admin_query?: number;
  outcome_not_open_state_secret?: number; // Added
  outcome_not_open_law_forbidden?: number; // Added
  outcome_not_open_enforcement?: number; // Added

  outcome_ignore: number;
  outcome_ignore_repeat?: number;
  outcome_complaint?: number; // Added
  outcome_publication?: number; // Added
  outcome_massive?: number; // Added
  outcome_confirm?: number; // Added

  outcome_overdue_correction?: number; // Added
  outcome_overdue_fee?: number; // Added
  outcome_other_reasons?: number; // Added

  outcome_other?: number;
  app_carried_forward: number;
  // 复议诉讼
  rev_total: number;
  rev_corrected: number;
  lit_total: number;
  lit_corrected: number;
}

export interface OrgItem {
  id: string;
  name: string;
  type: string;
  parent_id: string | null;
}