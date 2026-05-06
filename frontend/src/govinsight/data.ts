
import {
  EntityProfile,
  AnnualData,
  AnnualDataRecord,
  OrgItem,
  EntityType,
  CanonicalEntityType,
} from './types';
import { fetchAnnualData } from './api';
import { isDistrictLikeGovInsightEntity } from './utils/entityClassification';

type ChildRecordRelation = 'self' | 'descendant';

interface ChildRecordMatch {
  record: AnnualDataRecord;
  relation: ChildRecordRelation;
}

const isValidAnnualYear = (year: unknown): year is number =>
  Number.isInteger(year) && Number(year) >= 2000 && Number(year) <= 2100;

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

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractRegionIdFromToken = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/(\d+)/);
    if (match) {
      const parsed = Number(match[1]);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
};

const toLegacyEntityType = (
  canonicalUnitType?: CanonicalEntityType | null,
  fallbackType?: string | null
): EntityType => {
  switch (canonicalUnitType) {
    case 'province':
      return 'province';
    case 'city':
      return 'city';
    case 'department':
      return 'department';
    case 'district':
    case 'town_street':
    case 'functional_zone':
      return 'district';
    default:
      if (fallbackType === 'province' || fallbackType === 'city' || fallbackType === 'department') {
        return fallbackType;
      }
      return 'district';
  }
};

const ENTITY_TYPE_ORDER: Record<EntityType, number> = {
  province: 0,
  city: 1,
  district: 2,
  department: 3,
};

const sortEntityTree = (nodes: EntityProfile[]): EntityProfile[] =>
  [...nodes]
    .sort((a, b) => {
      const typeDiff = (ENTITY_TYPE_ORDER[a.type] ?? 99) - (ENTITY_TYPE_ORDER[b.type] ?? 99);
      if (typeDiff !== 0) return typeDiff;
      return a.name.localeCompare(b.name, 'zh-CN');
    })
    .map((node) => ({
      ...node,
      children: node.children ? sortEntityTree(node.children) : [],
    }));

// Legacy compat for views
export const districts: EntityProfile[] = [];
export const departments: EntityProfile[] = [];
export const provinceAvg: any = { data: [] };
export const nanjingCity: any = { data: [] };
export const mockShanghai: any = { data: [] };
export const mockSuzhou: any = { data: [] };

// Transform API record to Frontend AnnualData
export const transformYearData = (record: AnnualDataRecord): AnnualData => {
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
      amount: record.fees_amount ?? 0
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
          stateSecret: record.outcome_not_open_state_secret ?? 0,
          lawForbidden: record.outcome_not_open_law_forbidden ?? 0,
          danger: record.outcome_not_open_danger ?? 0,
          thirdParty: record.outcome_not_open_third_party ?? 0,
          internal: record.outcome_not_open_internal ?? 0,
          process: record.outcome_not_open_process ?? 0,
          enforcement: record.outcome_not_open_enforcement ?? 0,
          adminQuery: record.outcome_not_open_admin_query ?? 0
        },
        unable: {
          noInfo: record.outcome_unable_no_info ?? 0,
          needCreation: record.outcome_unable_need_creation ?? 0,
          unclear: record.outcome_unable_unclear ?? 0
        },
        untreated: {
          complaint: record.outcome_complaint ?? 0,
          repeat: record.outcome_ignore_repeat ?? 0,
          publication: record.outcome_publication ?? 0,
          massive: record.outcome_massive ?? 0,
          confirm: record.outcome_confirm ?? 0
        },
        other: {
          overdueCorrection: record.outcome_overdue_correction ?? 0,
          overdueFee: record.outcome_overdue_fee ?? 0,
          other: record.outcome_other_reasons ?? 0
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
      type: toLegacyEntityType(item.canonical_unit_type, item.type),
      regionId: toNullableNumber(item.region_id) ?? extractRegionIdFromToken(item.id) ?? undefined,
      canonicalUnitType: item.canonical_unit_type || undefined,
      canonicalParentRegionId: toNullableNumber(item.canonical_parent_region_id),
      cityRegionId: toNullableNumber(item.city_region_id),
      materializeStatus: item.materialize_status || null,
      isOfficial: Boolean(item.is_official),
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

  return sortEntityTree(roots);
};

// Async data loader (Lazy load data for an entity)
export const loadEntityData = async (entity: EntityProfile): Promise<EntityProfile> => {
  try {
    const targetId = entity.id.trim().toLowerCase();
    const targetRegionId = entity.regionId ?? extractRegionIdFromToken(entity.id);

    // Fetch data for the entity AND its children in one call
    const records = await fetchAnnualData(undefined, entity.id, true);

    // Separate records using normalized IDs for robustness
    const validYearRecords = records.filter((record) => isValidAnnualYear(record.year));

    const entityRecords = normalizeRecordsByYear(
      validYearRecords.filter((r) => {
        const recordRegionId = toNullableNumber(r.region_id) ?? extractRegionIdFromToken(r.org_id);
        return r.org_id?.trim().toLowerCase() === targetId || (targetRegionId !== null && recordRegionId === targetRegionId);
      })
    );

    // Child records: parent_id matches targetId
    // 修复: 不再依赖isDistrictName,而是使用org_type或parent_id关系
    // Child records filtering and mapping
    const validChildIds = new Set(entity.children?.map(c => c.id.trim().toLowerCase()));
    const validChildRegionIds = new Set(
      (entity.children || [])
        .map((child) => child.regionId ?? extractRegionIdFromToken(child.id))
        .filter((value): value is number => value !== null)
    );

    const relevantRecords = validYearRecords.filter(r => {
      const oid = r.org_id?.trim().toLowerCase();
      const pid = r.parent_id?.trim().toLowerCase();
      const recordRegionId = toNullableNumber(r.region_id) ?? extractRegionIdFromToken(r.org_id);
      const parentRegionId =
        toNullableNumber(r.canonical_parent_region_id) ??
        extractRegionIdFromToken(r.parent_id);

      // Case 1: Record is a known child (Direct Match)
      if (oid && validChildIds.has(oid)) return true;
      if (recordRegionId !== null && validChildRegionIds.has(recordRegionId)) return true;

      // Case 2: Record is a child of a known child (Grandchild Match)
      if (pid && validChildIds.has(pid)) return true;
      if (parentRegionId !== null && validChildRegionIds.has(parentRegionId)) return true;

      return false;
    });

    // Group child records by effective child id, but keep track of whether
    // the row belongs to the child itself or only to one of its descendants.
    const childRecordsMap = new Map<string, ChildRecordMatch[]>();

    relevantRecords.forEach(r => {
      const oid = r.org_id?.trim().toLowerCase() || '';
      const pid = r.parent_id?.trim().toLowerCase() || '';
      const recordRegionId = toNullableNumber(r.region_id) ?? extractRegionIdFromToken(r.org_id);
      const parentRegionId =
        toNullableNumber(r.canonical_parent_region_id) ??
        extractRegionIdFromToken(r.parent_id);

      let effectiveId = '';
      let relation: ChildRecordRelation = 'descendant';

      if (validChildIds.has(oid)) {
        effectiveId = oid;
        relation = 'self';
      } else if (recordRegionId !== null && validChildRegionIds.has(recordRegionId)) {
        const matchedChild = entity.children?.find((child) => {
          const childRegionId = child.regionId ?? extractRegionIdFromToken(child.id);
          return childRegionId === recordRegionId;
        });
        effectiveId = matchedChild?.id.trim().toLowerCase() || '';
        relation = 'self';
      } else if (validChildIds.has(pid)) {
        effectiveId = pid;
      } else if (parentRegionId !== null && validChildRegionIds.has(parentRegionId)) {
        const matchedChild = entity.children?.find((child) => {
          const childRegionId = child.regionId ?? extractRegionIdFromToken(child.id);
          return childRegionId === parentRegionId;
        });
        effectiveId = matchedChild?.id.trim().toLowerCase() || '';
      }

      if (effectiveId) {
        if (!childRecordsMap.has(effectiveId)) {
          childRecordsMap.set(effectiveId, []);
        }
        childRecordsMap.get(effectiveId)!.push({ record: r, relation });
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

    // Transform entity data
    const annualData = normalizedEntityRecords.map(transformYearData).sort((a, b) => a.year - b.year);

    // Build children
    const childrenFromAPI: EntityProfile[] = [];
    childRecordsMap.forEach((matches, orgId) => {
      const preferredRecords = matches
        .filter((match) => match.relation === 'self')
        .map((match) => match.record);
      const hasOwnRecords = preferredRecords.length > 0;
      const recordsForChild = (preferredRecords.length > 0 ? preferredRecords : matches.map((match) => match.record))
        .sort(prioritizeGovernment);

      const normalizedChildRecords = normalizeRecordsByYear(recordsForChild);
      const firstRec = normalizedChildRecords[0] || recordsForChild[0];
      if (!firstRec) return;
      const childData = normalizedChildRecords.map(transformYearData).sort((a, b) => a.year - b.year);

      const existingChild = entity.children?.find(c => c.id.trim().toLowerCase() === orgId);

      childrenFromAPI.push({
        id: existingChild?.id || orgId,
        name: hasOwnRecords ? firstRec.org_name : (existingChild?.name || firstRec.org_name),
        type: hasOwnRecords
          ? toLegacyEntityType(firstRec.canonical_unit_type, firstRec.org_type)
          : (existingChild?.type || toLegacyEntityType(firstRec.canonical_unit_type, firstRec.org_type)),
        regionId: existingChild?.regionId ?? toNullableNumber(firstRec.region_id) ?? extractRegionIdFromToken(firstRec.org_id) ?? undefined,
        canonicalUnitType: existingChild?.canonicalUnitType || firstRec.canonical_unit_type || undefined,
        canonicalParentRegionId:
          existingChild?.canonicalParentRegionId ??
          toNullableNumber(firstRec.canonical_parent_region_id),
        cityRegionId: existingChild?.cityRegionId ?? toNullableNumber(firstRec.city_region_id),
        materializeStatus: firstRec.materialize_status || existingChild?.materializeStatus || null,
        isOfficial: firstRec.is_official ?? existingChild?.isOfficial ?? false,
        data: childData,
        children: existingChild?.children || [],
        parentPath: [...(entity.parentPath || []), entity.name]
      });
    });

    // Merge (only keep districts)
    const mergedChildren = [...childrenFromAPI];
    entity.children?.forEach(existingChild => {
      const normalizedChildId = existingChild.id.trim().toLowerCase();
      const isGeographicChild = isDistrictLikeGovInsightEntity(existingChild);
      if (!childRecordsMap.has(normalizedChildId) && isGeographicChild) {
        mergedChildren.push({
          ...existingChild,
          data: existingChild.data || []
        });
      }
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
