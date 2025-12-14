# 快速测试参考指南

## 测试命令

### 运行所有测试
```bash
npm test
```

### 运行特定测试套件
```bash
# 属性基测试
npm test src/services/__tests__/properties.test.ts

# 集成测试
npm test src/services/__tests__/integration.test.ts

# PDF 解析测试
npm test src/services/__tests__/PdfParseService.test.ts
```

### 运行特定测试用例
```bash
# 运行包含 "Property 1" 的测试
npm test -- -t "Property 1"

# 运行包含 "批量处理" 的测试
npm test -- -t "批量处理"
```

### 生成覆盖率报告
```bash
npm test -- --coverage
```

### 监视模式（开发时使用）
```bash
npm test -- --watch
```

## 测试结构

### 属性基测试 (10 个)
**文件**: `src/services/__tests__/properties.test.ts`

```
Property 1: 任务状态单调性
Property 2: 资产哈希去重
Property 3: 解析缓存复用
Property 4: AI建议缓存命中
Property 5: 差异摘要统计准确性
Property 6: 表格对齐降级
Property 7: DOCX导出失败降级
Property 8: 任务重试追溯
Property 9: AI建议版本管理
Property 10: 警告字段完整性
```

### 集成测试 (4 个)
**文件**: `src/services/__tests__/integration.test.ts`

```
✓ 应该能完整处理 PDF 解析和结构化
✓ 应该能批量处理多个 PDF 文件
✓ 应该能正确处理表格降级
✓ 应该能提取三张核心表格的数据
```

### PDF 解析测试 (9 个)
**文件**: `src/services/__tests__/PdfParseService.test.ts`

```
✓ 应该能解析有效的 PDF 文件
✓ 应该能批量处理多个 PDF 文件
✓ 应该能提取文本内容
✓ 应该能识别标题和章节
✓ 应该能提取表格
✓ 应该能处理表格解析失败
✓ 应该能提取元数据
✓ 应该能处理无效的 PDF 文件
✓ 应该能生成警告信息
```

## 测试统计

| 指标 | 值 |
|------|-----|
| 总测试套件 | 3 |
| 总测试用例 | 23 |
| 通过率 | 100% |
| 总执行时间 | ~27.6s |

## 常见问题

### Q: 测试失败了怎么办？
A: 
1. 检查错误信息
2. 查看相关的测试文件
3. 运行单个测试进行调试
4. 检查 fixtures 目录是否存在

### Q: 如何添加新的属性基测试？
A:
1. 在 `properties.test.ts` 中添加新的 `test()` 块
2. 使用 `fc.property()` 定义属性
3. 使用 `fc.assert()` 验证属性
4. 运行测试确保通过

### Q: 如何调试集成测试？
A:
1. 在测试中添加 `console.log()` 语句
2. 运行单个测试: `npm test -- -t "测试名称"`
3. 查看控制台输出
4. 根据需要修改测试

### Q: 测试文件在哪里？
A:
- 属性基测试: `src/services/__tests__/properties.test.ts`
- 集成测试: `src/services/__tests__/integration.test.ts`
- PDF 解析测试: `src/services/__tests__/PdfParseService.test.ts`
- Fixtures: `fixtures/` 目录

## 测试框架

- **测试框架**: Jest 29.x
- **属性基测试**: fast-check 3.x
- **语言**: TypeScript 5.x
- **运行时**: Node.js 18+

## 修改的文件

### 模型层
- `src/models/AISuggestion.ts`
- `src/models/BatchJob.ts`

### 测试层
- `src/services/__tests__/properties.test.ts`
- `src/services/__tests__/integration.test.ts`
- `src/services/__tests__/PdfParseService.test.ts`

## 验证清单

运行以下命令验证所有测试通过：

```bash
npm test
```

预期输出：
```
Test Suites: 3 passed, 3 total
Tests:       23 passed, 23 total
Snapshots:   0 total
Time:        ~27.6 s
Ran all test suites.
```

## 文档

- `TEST_COMPLETION_REPORT.md` - 详细测试报告
- `TESTING_PHASE_COMPLETION.md` - 阶段完成总结
- `WORK_COMPLETION_SUMMARY.md` - 工作完成总结
- `.kiro/specs/gov-report-diff/tasks.md` - 任务清单

## 下一步

1. ✓ 属性基测试完成
2. ✓ 集成测试完成
3. ⏳ API 集成测试 (待做)
4. ⏳ 数据库集成测试 (待做)
5. ⏳ 部署到测试环境 (待做)

---

**最后更新**: 2025-01-13  
**状态**: ✓ 所有测试通过

