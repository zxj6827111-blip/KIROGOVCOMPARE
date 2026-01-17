
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
      notOpen: number;
      unable: number;
      ignore: number; // Untreated/Other
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
  // 规范性文件
  doc_published: number;
  doc_active: number;
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
  outcome_not_open: number;
  outcome_ignore: number;
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