
import { EntityProfile, AnnualData, AnnualDataRecord, OrgItem, EntityType } from './types';
import { fetchAnnualData } from './api';

const LEGACY_FEES_BY_YEAR: Record<number, number> = {
  2024: 96171.6,
  2023: 71940.7,
  2022: 65120.3,
  2021: 62450.5,
  2020: 58920.1
};

const LEGACY_2024_OUTCOME_DETAIL = {
  notOpen: {
    stateSecret: 2,
    lawForbidden: 31,
    danger: 5,
    thirdParty: 6,
    internal: 8,
    process: 12,
    enforcement: 9,
    adminQuery: 105
  },
  unable: {
    noInfo: 769,
    needCreation: 11,
    unclear: 2
  },
  untreated: {
    complaint: 62,
    repeat: 25,
    publication: 0,
    massive: 0,
    confirm: 1
  },
  other: {
    overdueCorrection: 71,
    overdueFee: 6,
    other: 110
  }
};

const isValidAnnualYear = (year: unknown): year is number =>
  Number.isInteger(year) && Number(year) >= 2000 && Number(year) <= 2100;

const hasAnyDetailedOutcomeValue = (record: AnnualDataRecord): boolean =>
  [
    record.outcome_not_open_state_secret,
    record.outcome_not_open_law_forbidden,
    record.outcome_not_open_danger,
    record.outcome_not_open_third_party,
    record.outcome_not_open_internal,
    record.outcome_not_open_process,
    record.outcome_not_open_enforcement,
    record.outcome_not_open_admin_query,
    record.outcome_unable_no_info,
    record.outcome_unable_need_creation,
    record.outcome_unable_unclear,
    record.outcome_complaint,
    record.outcome_ignore_repeat,
    record.outcome_publication,
    record.outcome_massive,
    record.outcome_confirm,
    record.outcome_overdue_correction,
    record.outcome_overdue_fee,
    record.outcome_other_reasons
  ].some((value) => typeof value === 'number' && value > 0);

const normalizeRecordsByYear = (records: AnnualDataRecord[]): AnnualDataRecord[] => {
  const deduped = new Map<number, AnnualDataRecord>();
  records
    .filter((record) => isValidAnnualYear(record.year))
    .forEach((record) => {
      if (!deduped.has(record.year)) {
        deduped.set(record.year, record);
      }
    });
  return Array.from(deduped.values());
};

// Legacy compat for views
export const districts: EntityProfile[] = [];
export const departments: EntityProfile[] = [];
export const provinceAvg: any = { data: [] };
export const nanjingCity: any = { data: [] };
export const mockShanghai: any = { data: [] };
export const mockSuzhou: any = { data: [] };

// Transform API record to Frontend AnnualData
export const transformYearData = (record: AnnualDataRecord): AnnualData => {
  const useLegacy2024OutcomeDetail = record.year === 2024 && !hasAnyDetailedOutcomeValue(record);

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
      amount: record.fees_amount ?? LEGACY_FEES_BY_YEAR[record.year] ?? 0
    },
    applications: {
      newReceived: record.app_new || 0,
      carriedOver: record.app_carried_over || 0,
      totalHandled: (record.app_new || 0) + (record.app_carried_over || 0),
      sources: {
        natural: record.source_natural || 0,
        legal: Math.max(0, (record.app_new || 0) - (record.source_natural || 0))
      },
      outcomes: {
        public: record.outcome_public || 0,
        partial: record.outcome_partial || 0,
        notOpen: record.outcome_not_open || 0,
        unable: record.outcome_unable || 0,
        ignore: record.outcome_ignore || 0,
        // Granular (Optional)
        unableNoInfo: record.outcome_unable_no_info,
        unableNeedCreation: record.outcome_unable_need_creation,
        unableUnclear: record.outcome_unable_unclear,
        notOpenDanger: record.outcome_not_open_danger,
        notOpenProcess: record.outcome_not_open_process,
        notOpenInternal: record.outcome_not_open_internal,
        notOpenThirdParty: record.outcome_not_open_third_party,
        notOpenAdminQuery: record.outcome_not_open_admin_query,
        ignoreRepeat: record.outcome_ignore_repeat,
        other: record.outcome_other
      },
      outcomesDetail: {
        notOpen: {
          stateSecret: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.notOpen.stateSecret : (record.outcome_not_open_state_secret ?? 0),
          lawForbidden: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.notOpen.lawForbidden : (record.outcome_not_open_law_forbidden ?? 0),
          danger: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.notOpen.danger : (record.outcome_not_open_danger ?? 0),
          thirdParty: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.notOpen.thirdParty : (record.outcome_not_open_third_party ?? 0),
          internal: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.notOpen.internal : (record.outcome_not_open_internal ?? 0),
          process: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.notOpen.process : (record.outcome_not_open_process ?? 0),
          enforcement: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.notOpen.enforcement : (record.outcome_not_open_enforcement ?? 0),
          adminQuery: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.notOpen.adminQuery : (record.outcome_not_open_admin_query ?? 0)
        },
        unable: {
          noInfo: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.unable.noInfo : (record.outcome_unable_no_info ?? 0),
          needCreation: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.unable.needCreation : (record.outcome_unable_need_creation ?? 0),
          unclear: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.unable.unclear : (record.outcome_unable_unclear ?? 0)
        },
        untreated: {
          complaint: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.untreated.complaint : (record.outcome_complaint ?? 0),
          repeat: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.untreated.repeat : (record.outcome_ignore_repeat ?? 0),
          publication: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.untreated.publication : (record.outcome_publication ?? 0),
          massive: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.untreated.massive : (record.outcome_massive ?? 0),
          confirm: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.untreated.confirm : (record.outcome_confirm ?? 0)
        },
        other: {
          overdueCorrection: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.other.overdueCorrection : (record.outcome_overdue_correction ?? 0),
          overdueFee: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.other.overdueFee : (record.outcome_overdue_fee ?? 0),
          other: useLegacy2024OutcomeDetail ? LEGACY_2024_OUTCOME_DETAIL.other.other : (record.outcome_other_reasons ?? 0)
        }
      },

      carriedForward: record.app_carried_forward || 0
    },
    disputes: {
      reconsideration: {
        total: record.rev_total || 0,
        maintained: 0,
        corrected: record.rev_corrected || 0,
        other: 0,
        pending: 0
      },
      litigation: {
        total: record.lit_total || 0,
        maintained: 0,
        corrected: record.lit_corrected || 0,
        other: 0,
        pending: 0
      }
    }
  };
};

// Build tree from flat org list
export const buildRegionTree = (items: OrgItem[]): EntityProfile[] => {
  const map = new Map<string, EntityProfile>();
  const roots: EntityProfile[] = [];

  // First pass: create nodes
  items.forEach(item => {
    map.set(item.id, {
      id: item.id,
      name: item.name,
      type: item.type as EntityType,
      data: [], // Data loaded on demand
      children: [],
      parentPath: [] // To be filled
    });
  });

  // Second pass: link parents
  // Sort to ensure parents processed (optional if using Map reference)
  items.forEach(item => {
    const node = map.get(item.id)!;
    if (item.parent_id && map.has(item.parent_id)) {
      const parent = map.get(item.parent_id)!;
      parent.children = parent.children || [];
      parent.children.push(node);
      node.parentPath = [...(parent.parentPath || []), parent.name];
    } else {
      roots.push(node);
    }
  });

  return roots;
};

// Helper function to check if an entity name is a real "district" (区/县) vs a "department" (局/委员会)
const isDistrictName = (name: string): boolean => {
  // 扩展后缀列表,支持更多变体
  const districtSuffixes = [
    '区', '县', '市',  // 基本行政区划
    '开发区', '园区', '文旅区', '高新区', '经开区', '工业园区',  // 开发区类
    '新区', '示范区', '保税区', '自贸区',  // 特殊功能区
    '镇', '乡', '街道', '办事处'  // 基层行政区划
  ];
  return districtSuffixes.some(suffix => name.endsWith(suffix));
};

// Async data loader (Lazy load data for an entity)
export const loadEntityData = async (entity: EntityProfile): Promise<EntityProfile> => {
  try {
    const targetId = entity.id.trim().toLowerCase();
    console.log('[loadEntityData] %cSTART', 'background: #222; color: #bada55', {
      id: entity.id,
      name: entity.name,
      normalizedId: targetId
    });

    // Fetch data for the entity AND its children in one call
    const records = await fetchAnnualData(undefined, entity.id, true);
    console.log('[loadEntityData] Received', records.length, 'total records from API');

    if (records.length > 0) {
      console.log('[loadEntityData] First record raw:', records[0]);
    }

    // Separate records using normalized IDs for robustness
    const validYearRecords = records.filter((record) => isValidAnnualYear(record.year));
    if (validYearRecords.length !== records.length) {
      console.log('[loadEntityData] Dropped invalid-year records:', records.length - validYearRecords.length);
    }

    const entityRecords = normalizeRecordsByYear(
      validYearRecords.filter(r => r.org_id?.trim().toLowerCase() === targetId)
    );

    // Child records: parent_id matches targetId
    // 修复: 不再依赖isDistrictName,而是使用org_type或parent_id关系
    // Child records filtering and mapping
    const validChildIds = new Set(entity.children?.map(c => c.id.trim().toLowerCase()));

    const relevantRecords = validYearRecords.filter(r => {
      const oid = r.org_id?.trim().toLowerCase();
      const pid = r.parent_id?.trim().toLowerCase();

      // Case 1: Record is a known child (Direct Match)
      if (oid && validChildIds.has(oid)) return true;

      // Case 2: Record is a child of a known child (Grandchild Match)
      if (pid && validChildIds.has(pid)) return true;

      return false;
    });

    console.log('[loadEntityData] Match Results:', {
      ownRecords: entityRecords.length,
      relevantRecords: relevantRecords.length,
      method: 'Extended Parent/Child Search'
    });

    // Group children records by the District ID (effective ID)
    const childRecordsMap = new Map<string, AnnualDataRecord[]>();

    relevantRecords.forEach(r => {
      const oid = r.org_id?.trim().toLowerCase() || '';
      const pid = r.parent_id?.trim().toLowerCase() || '';

      let effectiveId = '';

      if (validChildIds.has(oid)) {
        effectiveId = oid;
      } else if (validChildIds.has(pid)) {
        effectiveId = pid;
      }

      if (effectiveId) {
        if (!childRecordsMap.has(effectiveId)) {
          childRecordsMap.set(effectiveId, []);
        }
        childRecordsMap.get(effectiveId)!.push(r);
      }
    });

    // Helper to prioritize "Government" records if multiple exist for same year
    const prioritizeGovernment = (a: AnnualDataRecord, b: AnnualDataRecord) => {
      const score = (rec: AnnualDataRecord) => {
        const name = rec.org_name || '';
        if (name.includes('人民政府') || name.includes('管委会')) return 2;
        if (name.includes('政府办') || name.includes('办公室')) return 1;
        return 0;
      };
      return score(b) - score(a); // High score first
    };

    const normalizedEntityRecords = normalizeRecordsByYear([...entityRecords].sort(prioritizeGovernment));

    // Sort records within each district group
    childRecordsMap.forEach((recs, key) => {
      recs.sort(prioritizeGovernment);
    });

    // Transform entity data
    const annualData = normalizedEntityRecords.map(transformYearData).sort((a, b) => a.year - b.year);

    // Build children
    const childrenFromAPI: EntityProfile[] = [];
    childRecordsMap.forEach((recs, orgId) => {
      const normalizedChildRecords = normalizeRecordsByYear(recs);
      const firstRec = normalizedChildRecords[0] || recs[0];
      const childData = normalizedChildRecords.map(transformYearData).sort((a, b) => a.year - b.year);

      const existingChild = entity.children?.find(c => c.id.trim().toLowerCase() === orgId);

      childrenFromAPI.push({
        id: existingChild?.id || orgId,
        name: firstRec.org_name,
        type: (firstRec.org_type || 'district') as EntityType,
        data: childData,
        children: existingChild?.children || [],
        parentPath: [...(entity.parentPath || []), entity.name]
      });
    });

    // Merge (only keep districts)
    const mergedChildren = [...childrenFromAPI];
    entity.children?.forEach(existingChild => {
      const normalizedChildId = existingChild.id.trim().toLowerCase();
      if (!childRecordsMap.has(normalizedChildId) && isDistrictName(existingChild.name)) {
        mergedChildren.push({
          ...existingChild,
          data: existingChild.data || []
        });
      }
    });

    console.log('[loadEntityData] %cFINISH', 'background: #222; color: #bada55', {
      totalChildren: mergedChildren.length,
      withData: mergedChildren.filter(c => c.data.length > 0).length,
      names: mergedChildren.map(c => c.name)
    });

    return {
      ...entity,
      data: annualData,
      children: mergedChildren
    };
  } catch (err) {
    console.warn(`Failed to load data for ${entity.name}`, err);
    return entity;
  }
};
