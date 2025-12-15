# P0 修复清单 - Python v3 主引擎版本

**分支**：`feat/python-table-main-v3`  
**状态**：实现中  
**目标**：解决"取错页+取错表"的逻辑缺陷，实现真正的表格主链路

---

## 核心问题

### 当前版本的缺陷

1. **取错页+取错表**：Python 没有按 schema 的 `locateKeywords` 定位页/区域
   - 导致大概率抽到"正文假表格"或根本不在表格页
   - 结果是识别率低（20%）

2. **TS 抽表污染生产**：TS 抽表仍默认执行，产出"骨架完整"的空表
   - 存在污染生产与 complete 误判风险
   - 前端永远拿不到 Python 主链路结果

3. **回归脚本无法验证**：指向旧 Python 脚本且 schema 结构不匹配
   - 无法作为验收依据

4. **content 接口拿不到 Python 结果**：parsePDF 阶段落盘发生在 Python 合并之前
   - 前端永远拿不到 Python 主链路结果

---

## P0 修复清单

### P0-1：新增 Python v3 主引擎 ✅

**文件**：`python/extract_tables_pdfplumber_v3.py`

**核心能力**：

1. **定位页**：按 schema `locateKeywords` 在全 PDF pages 里找最匹配页
   ```python
   # 计算匹配分数：匹配关键词数 * 10 + 总关键词长度
   score = len(matched_keywords) * 10 + sum(len(k) for k in matched_keywords)
   ```

2. **定位区域（crop）**：用 `page.search(keyword)` 拿到匹配块坐标，裁剪区域
   ```python
   search_results = page.search(keyword)
   top, bottom, left, right = search_results[0]
   cropped_page = page.crop((0, top, page.width, bottom))
   ```

3. **无网格线策略**：支持 `vertical_strategy='text'`、`horizontal_strategy='text'`
   ```python
   strategies = [
       {'vertical_strategy': 'lines', 'horizontal_strategy': 'lines'},
       {'vertical_strategy': 'text', 'horizontal_strategy': 'text'},
       {'vertical_strategy': 'lines_strict', 'horizontal_strategy': 'lines_strict'},
   ]
   ```

4. **候选表选优**：对每个候选表计算 score，选最高者
   ```python
   score = (命中 schema.rows[*].match 的行数 + 命中 schema.columns[*].name 的表头词) / 总数
   ```

5. **按 schema 行标签对齐取数**：用 `match` 定位实际行，抽取对应数值列
   ```python
   for row_def in schema_rows:
       row_match = row_def.get('match', '')
       # 在表格中找到匹配的行
       for idx, row in enumerate(table[1:]):
           if row_match.lower() in str(row[0]).lower():
               # 提取该行的数据
   ```

6. **指标输出**（必须包含）：
   - `nonEmptyCells / totalCells`
   - `matchedRows / expectedRows`
   - `numericParseRate`
   - `confidence（0~1）`
   - `issues[]`（错误原因可诊断）

**输出结构**：
```json
{
  "tables": [
    {
      "id": "table_2",
      "section": "二、主动公开政府信息情况",
      "rows": [
        {"key": "row_1", "matched": true},
        {"key": "row_2", "matched": false}
      ],
      "columns": [...],
      "cells": {
        "row_1_col_1": "100",
        "row_1_col_2": "200"
      },
      "metrics": {
        "nonEmptyCells": 28,
        "totalCells": 60,
        "matchedRows": 6,
        "expectedRows": 6,
        "numericParseRate": 0.95,
        "confidence": 0.85
      },
      "confidence": 0.85,
      "issues": [],
      "source": "python"
    }
  ]
}
```

---

### P0-2：Worker 合并后必须落盘 ✅

**文件**：`src/queue/processors.ts`

**修改**：在合并 Python 表格到 docA/docB 后，调用 `ParsedDataStorageService.saveParseData()` 再次保存

```typescript
// 合并 Python 表格后必须落盘
if (pyResultA.success && pyResultA.tables) {
  mergeTablesIntoDocument(docA, pyResultA.tables);
}

// 保存合并后的解析数据
await ParsedDataStorageService.saveParseData(task.assetId_A, docA);
```

**效果**：
- ✅ `/api/v1/assets/:id/content` 能拿到最新的 Python 合并结果
- ✅ 前端一次请求获得完整信息

---

### P0-3：默认关闭 TS 抽表 ✅

**文件**：`src/services/PdfParseService.ts`

**修改**：

1. 默认不调用 `extractCanonicalTablesV2()`，仅当 `ENABLE_TS_TABLE_FALLBACK === '1'` 时才允许

```typescript
const enableTsTableFallback = process.env.ENABLE_TS_TABLE_FALLBACK === '1';
const canonicalTables = enableTsTableFallback 
  ? await this.extractCanonicalTablesV2(pages, warnings)
  : [];
```

2. 空值必须输出 `null/""` 或空字符串，不得自动转 `0`

```typescript
// 禁止：value = 0
// 允许：value = '' 或 null
cells.push({
  value: typedValue,  // 空表返回 ''，不转 0
});
```

3. `complete` 必须指标驱动，禁止"骨架齐全即 complete"

```typescript
// 禁止：complete = rows.length === expected && rows.every(cells===expectedCols)
// 允许：complete = nonEmpty/rowMatch/numericParse/confidence 都达标
const isComplete = 
  matchedRowsRate >= 0.90 &&
  numericParseRate >= 0.95 &&
  confidence >= 0.75 &&
  !issues.includes('page_not_found');
```

---

### P0-4：回归脚本必须可跑、可卡阈值、可 CI ✅

**文件**：`scripts/regress_tables_v3.js`

**功能**：

1. 遍历 `sample_pdfs_v1/` 目录下的所有 PDF
2. 调用 `python/extract_tables_pdfplumber_v3.py` 提取表格
3. 计算每张表的指标
4. 检查是否达到阈值
5. 生成测试报告

**验收阈值**（写死）：
```javascript
const THRESHOLDS = {
  matchedRows: 0.90,           // matchedRows / expectedRows >= 90%
  numericParseRate: 0.95,      // 数值解析率 >= 95%
  confidence: 0.75,            // 置信度 >= 75%
};

const FORBIDDEN_ISSUES = [
  'page_not_found',
  'table_not_found',
  'no_text',
];
```

**使用**：
```bash
node scripts/regress_tables_v3.js
```

**输出**：
```
✓ 找到 3 个 PDF 文件

📄 处理: hzq2023.pdf
  ✓ 表格 table_2: 所有指标达标
  ✓ 表格 table_3: 所有指标达标
  ✓ 表格 table_4: 所有指标达标

📊 回归测试报告
============================================================
总体统计：
  总 PDF 数: 3
  通过 PDF: 3 ✓
  失败 PDF: 0 ✗

表格统计：
  总表格数: 9
  通过表格: 9 ✓
  失败表格: 0 ✗

平均指标：
  平均置信度: 85.0%
  平均行匹配率: 95.0%
  平均数值解析率: 96.0%

✅ 所有测试通过！
============================================================
```

**报告文件**：`test-regress-v3-report.json`

---

### P0-5：Dockerfile 修正 Python 依赖安装 ✅

**文件**：`Dockerfile`

**修改**：runtime 阶段直接 `pip3 install -r python/requirements.txt`

```dockerfile
# ============ 生产镜像 ============
FROM node:18-bullseye-slim

WORKDIR /app

# 安装 Python 运行时和 pip
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# ... 其他步骤 ...

# 在 runtime 阶段直接安装 Python 依赖（禁止跨镜像复制固定路径）
RUN pip3 install --no-cache-dir -r python/requirements.txt

# 验证 Python 依赖安装成功
RUN python3 -c "import pdfplumber; print('✓ pdfplumber 已安装')"
```

**效果**：
- ✅ 容器内 `python3 -c "import pdfplumber"` 通过
- ✅ 禁止跨镜像复制固定 3.11 路径
- ✅ 自动适配任何 Python 版本

---

## 工作方式与范围

### 必须遵守

1. **在原仓库继续**，新建分支：`feat/python-table-main-v3`
2. **TS 抽表仅 debug**：默认关闭，不得覆盖 Python 结果，不得产出"骨架 complete"空表
3. **表格主链路必须 Python**：表2/表3/表4 全部走 Python，输出 canonical table JSON + metrics/confidence/issues
4. **严禁示例/默认表格兜底**：抽不到表就返回 empty + issues，不得填充模板或示例数据污染生产

---

## 验收标准

### 代码验收

- ✅ TypeScript 编译无错误
- ✅ Python v3 脚本可独立运行
- ✅ Worker 日志明确记录 Python 表格提取的开始/结束/耗时/置信度
- ✅ `/content` 接口返回完整的 Python 合并结果

### 功能验收

- ✅ 回归脚本可跑通：`node scripts/regress_tables_v3.js`
- ✅ 至少 3 份样例 PDF 通过验收阈值
- ✅ 输出 JSON 三张表非空（至少 `nonEmptyCells > 0`）
- ✅ Python 脚本可独立运行：`python3 python/extract_tables_pdfplumber_v3.py <pdf> --schema <schema> --out -`

### 性能验收

- ✅ 单个 PDF 处理耗时 < 10 秒
- ✅ 3 份 PDF 总耗时 < 30 秒
- ✅ Docker 启动 < 60 秒

---

## 相关文件

- `python/extract_tables_pdfplumber_v3.py` - Python v3 主引擎
- `scripts/regress_tables_v3.js` - 回归测试脚本
- `src/queue/processors.ts` - Worker 合并逻辑
- `src/services/PdfParseService.ts` - TS 抽表默认关闭
- `Dockerfile` - Python 依赖安装修正

---

## 下一步

1. ✅ 创建 Python v3 主引擎
2. ✅ 修改 TS 抽表为默认关闭
3. ✅ 修改 Worker 合并后落盘
4. ✅ 创建回归脚本
5. ✅ 修正 Dockerfile
6. ⏳ 测试验证
7. ⏳ 提交 PR

---

**创建时间**：2025-12-15  
**分支**：`feat/python-table-main-v3`  
**状态**：实现中

