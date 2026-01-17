
import { EntityProfile, AnnualData, AnnualDataRecord, OrgItem, EntityType } from './types';
import { fetchAnnualData } from './api';

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
      abolished: 0, // Not in View
      active: record.reg_active || 0
    },
    normativeDocuments: {
      published: record.doc_published || 0,
      abolished: 0, // Not in View
      active: record.doc_active || 0
    },
    adminActions: {
      licensing: record.action_licensing || 0,
      punishment: record.action_punishment || 0,
      force: 0 // Not in View
    },
    fees: {
      amount: 0 // Not in View
    },
    applications: {
      newReceived: record.app_new || 0,
      carriedOver: record.app_carried_over || 0,
      totalHandled: 0, // Calculated?
      sources: {
        natural: record.source_natural || 0,
        legal: 0 // Calculated?
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

// Async data loader (Lazy load data for an entity)
export const loadEntityData = async (entity: EntityProfile): Promise<EntityProfile> => {
  try {
    const records = await fetchAnnualData(undefined, entity.id);
    const annualData = records.map(transformYearData).sort((a, b) => a.year - b.year);
    return {
      ...entity,
      data: annualData
    };
  } catch (err) {
    console.warn(`Failed to load data for ${entity.name}`, err);
    return entity;
  }
};