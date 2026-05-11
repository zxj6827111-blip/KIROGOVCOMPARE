import pool from '../config/database-llm';
import {
  CanonicalUnitType,
  GOVINSIGHT_CANONICAL_MAPPING_VERSION,
} from './GovInsightReportProtocol';

interface RegionRow {
  id: number;
  name: string;
  parent_id: number | null;
  level: number;
}

interface OverrideRow {
  region_id: number;
  canonical_name: string | null;
  unit_type: CanonicalUnitType | null;
  parent_region_id: number | null;
  city_region_id: number | null;
  confidence: number | null;
}

interface CanonicalUnitRecord {
  regionId: number;
  canonicalName: string;
  unitType: CanonicalUnitType;
  parentRegionId: number | null;
  cityRegionId: number | null;
  mappingSource: string;
  mappingVersion: string;
  confidence: number;
}

interface CanonicalOverrideSeed {
  regionId: number;
  canonicalName: string;
  unitType: CanonicalUnitType;
  parentRegionId: number | null;
  cityRegionId: number | null;
  confidence: number;
  note: string;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRegionRow(row: RegionRow): RegionRow {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    parent_id: toNullableNumber(row.parent_id),
    level: Number(row.level || 0),
  };
}

function normalizeOverrideRow(row: OverrideRow): OverrideRow {
  return {
    region_id: Number(row.region_id),
    canonical_name: row.canonical_name ? String(row.canonical_name) : null,
    unit_type: row.unit_type || null,
    parent_region_id: toNullableNumber(row.parent_region_id),
    city_region_id: toNullableNumber(row.city_region_id),
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
  };
}

const TOWN_STREET_SUFFIXES = ['镇', '乡', '街道', '街道办', '街道办事处'];
const FUNCTIONAL_ZONE_KEYWORDS = [
  '开发区',
  '高新区',
  '高新园',
  '新区',
  '园区',
  '科技园',
  '保税区',
  '自贸区',
  '示范区',
  '功能区',
  '创业园',
  '产业园',
  '科技一条街',
];
const FUNCTIONAL_ZONE_SUFFIXES = ['管委会'];
const DEPARTMENT_SUFFIXES = [
  '局',
  '委员会',
  '委',
  '办',
  '办公室',
  '办公厅',
  '中心',
  '馆',
  '院',
  '所',
  '支队',
  '大队',
  '分局',
  '管理局',
  '联合会',
];
const DEPARTMENT_KEYWORDS = [
  '人民政府办公室',
  '人民政府办公厅',
  '政府办公室',
  '国防动员办公室',
  '信访办公室',
  '投资促进办公室',
  '重大项目推进办公室',
  '国有资产监督管理办公室',
];
const DEPARTMENT_NAME_PARTS = [
  '人民银行',
  '人行',
  '残联',
  '妇联',
  '联合会',
  '供销社',
  '供销总社',
  '合作总社',
  '总工会',
  '医疗保障',
];
const DISTRICT_SUFFIXES = ['区', '县', '旗', '自治县'];
const PROVINCE_SUFFIXES = ['省', '自治区', '特别行政区'];
const CITY_SUFFIXES = ['市', '地区', '盟', '自治州'];

const PHASE1_FROZEN_OVERRIDE_SEEDS: CanonicalOverrideSeed[] = [
  {
    regionId: 1437,
    canonicalName: '浦东新区',
    unitType: 'district',
    parentRegionId: 1426,
    cityRegionId: 1426,
    confidence: 1,
    note: 'phase1 frozen boundary seed',
  },
  {
    regionId: 781,
    canonicalName: '湖滨新区',
    unitType: 'functional_zone',
    parentRegionId: 720,
    cityRegionId: 720,
    confidence: 1,
    note: 'phase1 frozen boundary seed',
  },
  {
    regionId: 782,
    canonicalName: '洋河新区',
    unitType: 'functional_zone',
    parentRegionId: 720,
    cityRegionId: 720,
    confidence: 1,
    note: 'phase1 frozen boundary seed',
  },
  {
    regionId: 2182,
    canonicalName: '南通市经济技术开发区管委会',
    unitType: 'functional_zone',
    parentRegionId: 2135,
    cityRegionId: 2135,
    confidence: 1,
    note: 'phase1 frozen boundary seed',
  },
  {
    regionId: 2268,
    canonicalName: '高新区（如城街道、城南街道）',
    unitType: 'functional_zone',
    parentRegionId: 2176,
    cityRegionId: 2135,
    confidence: 1,
    note: 'phase1 frozen boundary seed',
  },
  {
    regionId: 1084,
    canonicalName: '泗阳棉花原种场',
    unitType: 'department',
    parentRegionId: 779,
    cityRegionId: 720,
    confidence: 1,
    note: 'phase1 frozen boundary seed: 原种场按县级部门口径纳入',
  },
  {
    regionId: 1085,
    canonicalName: '泗阳农场',
    unitType: 'department',
    parentRegionId: 779,
    cityRegionId: 720,
    confidence: 1,
    note: 'phase1 frozen boundary seed: 农场按县级部门口径纳入',
  },
  {
    regionId: 2348,
    canonicalName: '启东市国家统计局启东调查',
    unitType: 'department',
    parentRegionId: 2178,
    cityRegionId: 2135,
    confidence: 1,
    note: 'phase1 frozen boundary seed: 调查机构按县级部门口径纳入',
  },
  {
    regionId: 856,
    canonicalName: '昆沭高新园',
    unitType: 'functional_zone',
    parentRegionId: 775,
    cityRegionId: 720,
    confidence: 1,
    note: 'phase2 frozen boundary seed: 高新园按功能区口径纳入',
  },
  {
    regionId: 1066,
    canonicalName: '泗阳县残疾人联合会',
    unitType: 'department',
    parentRegionId: 779,
    cityRegionId: 720,
    confidence: 1,
    note: 'phase2 frozen boundary seed: 联合会按县级部门口径纳入',
  },
  {
    regionId: 1155,
    canonicalName: '淮安区人行',
    unitType: 'department',
    parentRegionId: 818,
    cityRegionId: 721,
    confidence: 1,
    note: 'phase2 frozen boundary seed: 人行简称按县级部门口径纳入',
  },
  {
    regionId: 1661,
    canonicalName: '市人民政府办公厅',
    unitType: 'department',
    parentRegionId: 1426,
    cityRegionId: 1426,
    confidence: 1,
    note: 'phase2 frozen boundary seed: 办公厅按市级部门口径纳入',
  },
  {
    regionId: 2172,
    canonicalName: '南通市供销合作总社',
    unitType: 'department',
    parentRegionId: 2135,
    cityRegionId: 2135,
    confidence: 1,
    note: 'phase2 frozen boundary seed: 合作总社按市级部门口径纳入',
  },
  {
    regionId: 2368,
    canonicalName: '生命健康科技园',
    unitType: 'functional_zone',
    parentRegionId: 2178,
    cityRegionId: 2135,
    confidence: 1,
    note: 'phase2 frozen boundary seed: 科技园按功能区口径纳入',
  },
  {
    regionId: 2434,
    canonicalName: '区医疗保障',
    unitType: 'department',
    parentRegionId: 2180,
    cityRegionId: 2135,
    confidence: 1,
    note: 'phase2 frozen boundary seed: 截断名称按区级部门口径纳入',
  },
];

const endsWithAny = (value: string, suffixes: string[]) => suffixes.some((suffix) => value.endsWith(suffix));
const includesAny = (value: string, parts: string[]) => parts.some((part) => value.includes(part));

function normalizeName(name: string): string {
  return String(name || '').trim();
}

function inferUnitType(region: RegionRow, parent: RegionRow | null): { unitType: CanonicalUnitType; confidence: number } {
  const name = normalizeName(region.name);

  if (region.parent_id === null && endsWithAny(name, PROVINCE_SUFFIXES)) {
    return { unitType: 'province', confidence: 0.99 };
  }

  if (region.parent_id === null || (!parent && (region.level <= 1 || endsWithAny(name, CITY_SUFFIXES)))) {
    return { unitType: 'city', confidence: 0.95 };
  }

  if (endsWithAny(name, TOWN_STREET_SUFFIXES)) {
    return { unitType: 'town_street', confidence: 0.95 };
  }

  if (region.level <= 2 && endsWithAny(name, CITY_SUFFIXES)) {
    return { unitType: 'city', confidence: 0.92 };
  }

  if (includesAny(name, FUNCTIONAL_ZONE_KEYWORDS) || endsWithAny(name, FUNCTIONAL_ZONE_SUFFIXES)) {
    return { unitType: 'functional_zone', confidence: 0.9 };
  }

  if (
    endsWithAny(name, DEPARTMENT_SUFFIXES) ||
    includesAny(name, DEPARTMENT_KEYWORDS) ||
    includesAny(name, DEPARTMENT_NAME_PARTS)
  ) {
    return { unitType: 'department', confidence: 0.88 };
  }

  if (endsWithAny(name, DISTRICT_SUFFIXES) || (name.endsWith('市') && region.parent_id !== null)) {
    return { unitType: 'district', confidence: 0.85 };
  }

  return { unitType: 'unknown', confidence: 0.35 };
}

export class CanonicalUnitsService {
  async seedPhase1FrozenOverrides(): Promise<{ upserts: number }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const seed of PHASE1_FROZEN_OVERRIDE_SEEDS) {
        await client.query(
          `
          INSERT INTO canonical_unit_mapping_overrides (
            region_id,
            canonical_name,
            unit_type,
            parent_region_id,
            city_region_id,
            confidence,
            note,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (region_id)
          DO UPDATE SET
            canonical_name = EXCLUDED.canonical_name,
            unit_type = EXCLUDED.unit_type,
            parent_region_id = EXCLUDED.parent_region_id,
            city_region_id = EXCLUDED.city_region_id,
            confidence = EXCLUDED.confidence,
            note = EXCLUDED.note,
            updated_at = NOW()
          `,
          [
            seed.regionId,
            seed.canonicalName,
            seed.unitType,
            seed.parentRegionId,
            seed.cityRegionId,
            seed.confidence,
            seed.note,
          ]
        );
      }
      await client.query('COMMIT');
      return { upserts: PHASE1_FROZEN_OVERRIDE_SEEDS.length };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async syncAll(): Promise<{ upserts: number }> {
    const [regionsRes, overridesRes] = await Promise.all([
      pool.query<RegionRow>('SELECT id, name, parent_id, level FROM regions ORDER BY id ASC'),
      pool.query<OverrideRow>(
        `
        SELECT region_id, canonical_name, unit_type, parent_region_id, city_region_id, confidence
        FROM canonical_unit_mapping_overrides
        `
      ),
    ]);

    const regions = regionsRes.rows.map(normalizeRegionRow);
    const regionMap = new Map<number, RegionRow>(regions.map((row) => [Number(row.id), row]));
    const overrideMap = new Map<number, OverrideRow>(
      overridesRes.rows.map((row) => {
        const normalized = normalizeOverrideRow(row);
        return [Number(normalized.region_id), normalized];
      })
    );

    const inferredTypes = new Map<number, { unitType: CanonicalUnitType; confidence: number }>();

    for (const region of regions) {
      const override = overrideMap.get(Number(region.id));
      if (override?.unit_type) {
        inferredTypes.set(Number(region.id), {
          unitType: override.unit_type,
          confidence: Number(override.confidence ?? 1),
        });
        continue;
      }

      inferredTypes.set(Number(region.id), inferUnitType(region, region.parent_id ? regionMap.get(region.parent_id) || null : null));
    }

    const resolveCityRegionId = (regionId: number): number | null => {
      let cursor: RegionRow | undefined = regionMap.get(regionId);
      let depth = 0;
      while (cursor && depth < 16) {
        const override = overrideMap.get(Number(cursor.id));
        if (override?.city_region_id) return Number(override.city_region_id);

        const inferred = inferredTypes.get(Number(cursor.id));
        if (inferred?.unitType === 'city') {
          return Number(cursor.id);
        }

        if (!cursor.parent_id) break;
        cursor = regionMap.get(cursor.parent_id);
        depth += 1;
      }
      return null;
    };

    const records: CanonicalUnitRecord[] = regions.map((region) => {
      const override = overrideMap.get(Number(region.id));
      const inferred = inferredTypes.get(Number(region.id)) || { unitType: 'unknown' as const, confidence: 0.35 };
      const unitType = override?.unit_type || inferred.unitType;
      return {
        regionId: Number(region.id),
        canonicalName: normalizeName(override?.canonical_name || region.name),
        unitType,
        parentRegionId: override?.parent_region_id ?? region.parent_id ?? null,
        cityRegionId: override?.city_region_id ?? (unitType === 'city' ? Number(region.id) : resolveCityRegionId(Number(region.id))),
        mappingSource: override ? 'manual_override' : 'rule_auto_v1',
        mappingVersion: GOVINSIGHT_CANONICAL_MAPPING_VERSION,
        confidence: Number(override?.confidence ?? inferred.confidence),
      };
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const record of records) {
        await client.query(
          `
          INSERT INTO canonical_units (
            region_id,
            canonical_name,
            unit_type,
            parent_region_id,
            city_region_id,
            mapping_source,
            confidence,
            mapping_version,
            effective_from_year,
            effective_to_year,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL, NOW(), NOW())
          ON CONFLICT (region_id)
          DO UPDATE SET
            canonical_name = EXCLUDED.canonical_name,
            unit_type = EXCLUDED.unit_type,
            parent_region_id = EXCLUDED.parent_region_id,
            city_region_id = EXCLUDED.city_region_id,
            mapping_source = EXCLUDED.mapping_source,
            confidence = EXCLUDED.confidence,
            mapping_version = EXCLUDED.mapping_version,
            updated_at = NOW()
          `,
          [
            record.regionId,
            record.canonicalName,
            record.unitType,
            record.parentRegionId,
            record.cityRegionId,
            record.mappingSource,
            record.confidence,
            record.mappingVersion,
          ]
        );
      }
      await client.query('COMMIT');
      return { upserts: records.length };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export const canonicalUnitsService = new CanonicalUnitsService();
