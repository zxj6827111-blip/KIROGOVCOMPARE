import fs from 'fs';
import path from 'path';
import Ajv2020, { ErrorObject, ValidateFunction } from 'ajv/dist/2020';
import {
  STRUCTURED_PACKAGE_ERROR_CODES,
  STRUCTURED_PACKAGE_SCHEMA_VERSION,
  StructuredPackageError,
} from '../../config/structuredPackage';
import { PROJECT_ROOT } from '../../config/constants';
import { hasParsedContent } from '../../utils/parsedContent';

export interface PackageSourceEnvelope {
  schema_version: string;
  package_version: string;
  generator: {
    name: string;
    version: string;
  };
  source: {
    pdf_filename: string;
    markdown_filename: string;
    pdf_sha256: string;
    markdown_sha256: string;
    organization_name?: string | null;
    report_year?: number | null;
    report_title?: string | null;
  };
  parsed_json: Record<string, unknown>;
}

const SCHEMA_RELATIVE = path.join('src', 'schemas', 'kirogov-package', '1.0', 'source.schema.json');

let cachedValidator: ValidateFunction | null = null;
let cachedSchema: Record<string, unknown> | null = null;

function resolveSchemaPath(): string {
  // Prefer colocated schema next to compiled JS (dist/schemas or src/schemas via ts-node).
  const candidates = [
    path.join(__dirname, '..', '..', 'schemas', 'kirogov-package', '1.0', 'source.schema.json'),
    path.join(PROJECT_ROOT, SCHEMA_RELATIVE),
    path.join(PROJECT_ROOT, 'dist', 'schemas', 'kirogov-package', '1.0', 'source.schema.json'),
    path.join(PROJECT_ROOT, 'src', 'schemas', 'kirogov-package', '1.0', 'source.schema.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new StructuredPackageError(
    STRUCTURED_PACKAGE_ERROR_CODES.SCHEMA_VALIDATION_FAILED,
    '找不到材料包 JSON Schema 文件'
  );
}

export function loadPackageSchema(): Record<string, unknown> {
  if (cachedSchema) return cachedSchema;
  const schemaPath = resolveSchemaPath();
  const raw = fs.readFileSync(schemaPath, 'utf8');
  cachedSchema = JSON.parse(raw) as Record<string, unknown>;
  return cachedSchema;
}

function getValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator;
  const schema = loadPackageSchema();
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
  });
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

/** Reset caches (tests only). */
export function __resetPackageSchemaCache(): void {
  cachedValidator = null;
  cachedSchema = null;
}

function translateAjvError(err: ErrorObject): string {
  const pathHint = err.instancePath || '/';
  const keyword = err.keyword;
  if (keyword === 'required') {
    const missing = (err.params as { missingProperty?: string })?.missingProperty;
    return `缺少必填字段: ${missing || pathHint}`;
  }
  if (keyword === 'const') {
    return `字段 ${pathHint} 取值不符合固定要求`;
  }
  if (keyword === 'enum' || keyword === 'type') {
    return `字段 ${pathHint} 类型或取值不正确`;
  }
  if (keyword === 'pattern') {
    return `字段 ${pathHint} 格式不正确（例如 SHA256 必须为 64 位十六进制）`;
  }
  if (keyword === 'minimum' || keyword === 'maximum') {
    return `字段 ${pathHint} 数值超出允许范围`;
  }
  if (keyword === 'additionalProperties') {
    const extra = (err.params as { additionalProperty?: string })?.additionalProperty;
    return `存在未允许的顶级或嵌套字段: ${extra || pathHint}`;
  }
  if (keyword === 'minItems') {
    return `字段 ${pathHint} 数组不能为空`;
  }
  return `字段 ${pathHint} 校验失败: ${err.message || keyword}`;
}

/**
 * Parse source.json text and validate against versioned schema.
 * Bare NaN/Infinity tokens are already rejected by JSON.parse (invalid JSON),
 * and non-finite numbers cannot survive JSON.parse, so no full-text pre-scan
 * is needed — a pre-scan would false-positive on legal string values that
 * merely contain the words "NaN"/"Infinity".
 */
export function parseAndValidateSourceJson(rawText: string): PackageSourceEnvelope {
  if (!rawText || !String(rawText).trim()) {
    throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.JSON_PARSE_FAILED, 'source.json 为空');
  }

  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch (error: any) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.JSON_PARSE_FAILED,
      `source.json 无法解析: ${error?.message || '语法错误'}`
    );
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.JSON_PARSE_FAILED,
      'source.json 根节点必须是对象'
    );
  }

  const envelope = data as Record<string, unknown>;
  if (envelope.schema_version !== undefined && envelope.schema_version !== STRUCTURED_PACKAGE_SCHEMA_VERSION) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
      `不支持的 schema_version: ${String(envelope.schema_version)}（当前仅支持 ${STRUCTURED_PACKAGE_SCHEMA_VERSION}）`
    );
  }

  const validate = getValidator();
  const ok = validate(data);
  if (!ok) {
    const errors = (validate.errors || []).map(translateAjvError);
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.SCHEMA_VALIDATION_FAILED,
      `source.json 未通过 Schema 校验: ${errors.slice(0, 8).join('；')}`,
      { errors }
    );
  }

  const typed = data as PackageSourceEnvelope;
  assertParsedJsonMaterializable(typed.parsed_json);
  return typed;
}

/**
 * Ensure parsed_json has enough structure for materialize (table sections).
 * Does not call AI or invent missing numbers.
 */
function isFiniteNumberOrNull(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function assertNumericLeaf(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'boolean') {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
      `${path} 必须是数字或 null，不能是布尔值`
    );
  }
  if (typeof value === 'string') {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
      `${path} 必须是数字或 null，不能是字符串`
    );
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
      `${path} 包含非法数字`
    );
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertNumericLeaf(v, `${path}.${k}`);
    }
    return;
  }
  if (typeof value !== 'number' && value !== null) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
      `${path} 类型无效（期望数字或 null）`
    );
  }
}

const TABLE2_REQUIRED_KEYS = [
  'regulations',
  'normativeDocuments',
  'licensing',
  'punishment',
  'coercion',
  'fees',
] as const;

function assertTable2Structure(data: Record<string, unknown>): void {
  let known = 0;
  for (const key of TABLE2_REQUIRED_KEYS) {
    if (data[key] !== undefined) {
      known += 1;
      if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) {
        throw new StructuredPackageError(
          STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
          `table_2.activeDisclosureData.${key} 必须是对象`
        );
      }
    }
  }
  if (known === 0) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
      'table_2.activeDisclosureData 缺少业务字段（regulations/normativeDocuments/licensing/punishment/coercion/fees）'
    );
  }
  assertNumericLeaf(data, 'activeDisclosureData');
}

function assertTable3Structure(data: Record<string, unknown>): void {
  const applicantKeys = ['naturalPerson', 'legalPerson', 'total'];
  const hasApplicant = applicantKeys.some((k) => data[k] !== undefined && data[k] !== null);
  if (!hasApplicant) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
      'table_3.tableData 缺少申请人分类字段（naturalPerson/legalPerson/total）'
    );
  }
  assertNumericLeaf(data, 'tableData');
}

function assertTable4Structure(data: Record<string, unknown>): void {
  const caseKeys = ['review', 'litigationDirect', 'litigationPostReview'];
  const hasCase = caseKeys.some((k) => data[k] !== undefined && data[k] !== null);
  if (!hasCase) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
      'table_4.reviewLitigationData 缺少案件分类字段（review/litigationDirect/litigationPostReview）'
    );
  }
  assertNumericLeaf(data, 'reviewLitigationData');
}

export function assertParsedJsonMaterializable(parsedJson: unknown): void {
  if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
      'parsed_json 必须是对象'
    );
  }
  if (!hasParsedContent(parsedJson)) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
      'parsed_json 缺少有效的表二/表三/表四内容，无法物化'
    );
  }

  const sections = (parsedJson as { sections?: unknown }).sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
      'parsed_json.sections 不能为空'
    );
  }

  let hasTable2 = false;
  let hasTable3 = false;
  let hasTable4 = false;

  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    const rec = section as Record<string, unknown>;
    const t = String(rec.type || '');

    if (t === 'table_2') {
      hasTable2 = true;
      if (!rec.activeDisclosureData || typeof rec.activeDisclosureData !== 'object' || Array.isArray(rec.activeDisclosureData)) {
        throw new StructuredPackageError(
          STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
          'table_2 缺少 activeDisclosureData 对象'
        );
      }
      assertTable2Structure(rec.activeDisclosureData as Record<string, unknown>);
    } else if (rec.activeDisclosureData) {
      // Loose payload without type still validated if present
      hasTable2 = true;
      if (typeof rec.activeDisclosureData !== 'object' || Array.isArray(rec.activeDisclosureData)) {
        throw new StructuredPackageError(
          STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
          'activeDisclosureData 必须是对象'
        );
      }
      assertTable2Structure(rec.activeDisclosureData as Record<string, unknown>);
    }

    if (t === 'table_3') {
      hasTable3 = true;
      if (!rec.tableData || typeof rec.tableData !== 'object' || Array.isArray(rec.tableData)) {
        throw new StructuredPackageError(
          STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
          'table_3 缺少 tableData 对象'
        );
      }
      assertTable3Structure(rec.tableData as Record<string, unknown>);
    } else if (rec.tableData) {
      hasTable3 = true;
      if (typeof rec.tableData !== 'object' || Array.isArray(rec.tableData)) {
        throw new StructuredPackageError(
          STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
          'tableData 必须是对象'
        );
      }
      assertTable3Structure(rec.tableData as Record<string, unknown>);
    }

    if (t === 'table_4') {
      hasTable4 = true;
      if (!rec.reviewLitigationData || typeof rec.reviewLitigationData !== 'object' || Array.isArray(rec.reviewLitigationData)) {
        throw new StructuredPackageError(
          STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
          'table_4 缺少 reviewLitigationData 对象'
        );
      }
      assertTable4Structure(rec.reviewLitigationData as Record<string, unknown>);
    } else if (rec.reviewLitigationData) {
      hasTable4 = true;
      if (typeof rec.reviewLitigationData !== 'object' || Array.isArray(rec.reviewLitigationData)) {
        throw new StructuredPackageError(
          STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
          'reviewLitigationData 必须是对象'
        );
      }
      assertTable4Structure(rec.reviewLitigationData as Record<string, unknown>);
    }
  }

  if (!hasTable2 && !hasTable3 && !hasTable4) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE,
      'parsed_json 必须包含表二、表三或表四中的至少一张结构化表'
    );
  }
}

export function loadSourceJsonFromFile(filePath: string): PackageSourceEnvelope {
  const raw = fs.readFileSync(filePath, 'utf8');
  return parseAndValidateSourceJson(raw);
}
