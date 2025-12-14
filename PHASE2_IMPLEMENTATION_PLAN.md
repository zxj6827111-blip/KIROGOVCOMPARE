# 第二阶段实现计划

## 📋 阶段目标

第二阶段的主要目标是实现表格的前端显示和解析数据的持久化，使用户能够看到完整的、格式化的表格内容。

### 核心目标
1. ✅ 实现表格前端显示（二、三、四章节）
2. ✅ 实现解析数据的持久化存储
3. ✅ 改进错误处理和降级逻辑
4. ✅ 编写全面的测试用例

---

## 🎯 具体任务

### 任务 1：实现表格前端显示

#### 1.1 创建表格渲染组件
**目标**：创建一个通用的表格渲染组件，支持动态列和行

**文件**：`frontend/src/components/TableRenderer.js`

**功能**：
- 接收表格数据（行、列、单元格）
- 渲染为 HTML 表格
- 支持样式定制
- 支持响应式布局

**代码框架**：
```javascript
function TableRenderer({ table }) {
  // 渲染表格头
  // 渲染表格体
  // 处理合并单元格
  // 应用样式
}
```

#### 1.2 改进详情页面显示
**目标**：在详情页面中正确显示表格

**文件**：`src/public/admin.html`

**功能**：
- 识别表格类型（二、三、四章节）
- 调用表格渲染组件
- 处理表格数据格式
- 改进样式和布局

**代码框架**：
```javascript
// 在 openReportDetailPage 中
if (section.type === 'table') {
  // 调用表格渲染组件
  html += renderTable(section.tables);
}
```

#### 1.3 处理表格数据格式
**目标**：确保后端返回的表格数据能被前端正确渲染

**文件**：`src/services/PdfParseService.ts`

**功能**：
- 确保表格行列数据完整
- 处理合并单元格
- 处理特殊字符和格式
- 验证数据完整性

---

### 任务 2：实现解析数据的持久化存储

#### 2.1 创建解析数据存储服务
**目标**：将解析后的 PDF 数据保存到文件系统或数据库

**文件**：`src/services/ParsedDataStorageService.ts`

**功能**：
- 将解析数据序列化为 JSON
- 保存到指定路径
- 从路径读取解析数据
- 处理存储错误

**代码框架**：
```typescript
class ParsedDataStorageService {
  async saveParseData(assetId: string, parseData: any): Promise<void>
  async loadParseData(assetId: string): Promise<any>
  async deleteParseData(assetId: string): Promise<void>
}
```

#### 2.2 改进 PDF 解析流程
**目标**：在 PDF 解析完成后自动保存解析数据

**文件**：`src/services/PdfParseService.ts`

**功能**：
- 解析完成后调用存储服务
- 更新资产的 structuredDataPath
- 处理存储失败的情况
- 记录存储日志

**代码框架**：
```typescript
// 在 parsePDF 方法中
const parseResult = await this.parsePDF(filePath, assetId);
if (parseResult.success) {
  await storageService.saveParseData(assetId, parseResult.document);
}
```

#### 2.3 改进 API 端点
**目标**：从存储中读取解析数据并返回给前端

**文件**：`src/routes/assets.ts`

**功能**：
- 改进 `/parse` 端点
- 从存储中读取数据
- 处理数据不存在的情况
- 返回完整的解析数据

**代码框架**：
```typescript
router.get('/:assetId/parse', async (req: Request, res: Response) => {
  const parseData = await storageService.loadParseData(assetId);
  res.json(parseData);
});
```

---

### 任务 3：改进错误处理和降级逻辑

#### 3.1 添加错误处理
**目标**：处理各种可能的错误情况

**文件**：`src/services/PdfParseService.ts`、`src/routes/assets.ts`

**功能**：
- 处理文件不存在的情况
- 处理解析失败的情况
- 处理存储失败的情况
- 返回有意义的错误信息

**代码框架**：
```typescript
try {
  // 解析 PDF
} catch (error) {
  // 记录错误
  // 返回降级数据
  // 通知用户
}
```

#### 3.2 添加降级逻辑
**目标**：当解析失败时提供降级方案

**文件**：`src/services/PdfParseService.ts`

**功能**：
- 返回基本的文本提取结果
- 返回空的表格结构
- 返回警告信息
- 允许用户手动修正

**代码框架**：
```typescript
// 降级方案
const degradedResult = {
  success: false,
  document: {
    sections: [], // 空章节
    warnings: [...]
  }
};
```

---

### 任务 4：编写全面的测试用例

#### 4.1 编写单元测试
**目标**：为新增功能编写单元测试

**文件**：`src/services/__tests__/ParsedDataStorageService.test.ts`

**测试项**：
- 保存解析数据
- 读取解析数据
- 删除解析数据
- 处理错误情况

**代码框架**：
```typescript
describe('ParsedDataStorageService', () => {
  test('should save parse data', async () => {
    // 测试保存功能
  });
  
  test('should load parse data', async () => {
    // 测试读取功能
  });
});
```

#### 4.2 编写集成测试
**目标**：测试整个流程的集成

**文件**：`src/services/__tests__/integration.test.ts`

**测试项**：
- PDF 解析 → 数据保存 → 数据读取
- 前端显示 → 表格渲染
- 错误处理 → 降级逻辑

**代码框架**：
```typescript
describe('Integration Tests', () => {
  test('should parse PDF and save data', async () => {
    // 测试完整流程
  });
});
```

#### 4.3 编写前端测试
**目标**：测试前端表格渲染

**文件**：`frontend/src/components/__tests__/TableRenderer.test.js`

**测试项**：
- 表格渲染
- 数据绑定
- 样式应用
- 响应式布局

---

## 📊 实现时间表

### 第 1 天：表格前端显示
- [ ] 创建表格渲染组件
- [ ] 改进详情页面显示
- [ ] 处理表格数据格式
- [ ] 基本测试

### 第 2 天：解析数据持久化
- [ ] 创建存储服务
- [ ] 改进 PDF 解析流程
- [ ] 改进 API 端点
- [ ] 集成测试

### 第 3 天：错误处理和测试
- [ ] 添加错误处理
- [ ] 添加降级逻辑
- [ ] 编写全面测试
- [ ] 性能优化

---

## 🔧 技术细节

### 表格渲染
```javascript
// 表格数据结构
{
  id: "sec3_requests",
  title: "收到和处理政府信息公开申请情况",
  rows: [
    {
      rowIndex: 0,
      rowKey: "new_received",
      rowLabel: "一、本年新收政府信息公开申请数量",
      cells: [
        { colIndex: 0, colKey: "natural_person", value: 100 },
        { colIndex: 1, colKey: "commercial_enterprise", value: 50 },
        // ...
      ]
    }
  ],
  columns: 7
}
```

### 存储路径
```
/uploads/{regionId}/{year}/parsed/{assetId}.json
```

### 错误处理
```typescript
// 错误类型
- ParseError: PDF 解析失败
- StorageError: 数据存储失败
- ValidationError: 数据验证失败
- NotFoundError: 数据不存在
```

---

## 📋 验收标准

### 表格显示
- [ ] 表格正确渲染
- [ ] 数据完整显示
- [ ] 样式美观
- [ ] 响应式布局

### 数据持久化
- [ ] 数据正确保存
- [ ] 数据正确读取
- [ ] 数据完整性验证
- [ ] 错误处理正确

### 测试覆盖
- [ ] 单元测试覆盖 > 80%
- [ ] 集成测试覆盖 > 70%
- [ ] 前端测试覆盖 > 60%
- [ ] 所有测试通过

---

## 🚀 后续计划

### 第三阶段（后续）
1. 引入 OCR 技术处理扫描版 PDF
2. 评估专门的 PDF 处理库
3. 性能优化和缓存机制
4. 用户反馈迭代

---

## 📞 支持和反馈

如有任何问题或建议，请：
1. 查看相关的文档
2. 运行测试脚本
3. 提交 Issue 或 PR

---

**阶段状态**：📋 计划中

**预计开始时间**：立即

**预计完成时间**：3 天

**版本**：1.0
