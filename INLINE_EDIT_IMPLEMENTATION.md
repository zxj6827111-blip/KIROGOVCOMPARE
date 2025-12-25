# 内联编辑功能实现摘要

由于代码被 `git checkout` 撤销，需要重新实现。

## 核心需求
1. 在表格旁边添加 "✏️ 编辑" 按钮
2. 点击后展开完整的表3编辑表单（自然人 + 法人5个子类 + 合计）
3. 每个类别显示25行数据的完整结构

## 数据结构
表3 的 tableData 结构：
```javascript
{
  naturalPerson: {
    newReceived, carriedOver,
    results: {
      granted, partialGrant,
      denied: { stateSecret, lawForbidden, safetyStability, thirdPartyRights, internalAffairs, processInfo, enforcementCase, adminQuery },
      unableToProvide: { noInfo, needCreation, unclear },
      notProcessed: { complaint, repeat, publication, massiveRequests, confirmInfo },
      other: { overdueCorrection, overdueFee, otherReasons },
      totalProcessed, carriedForward
    }
  },
  legalPerson: {
    commercial: { ...同上结构 },
    research: { ...同上结构 },
    social: { ...同上结构 },
    legal: { ...同上结构 },
    other: { ...同上结构 }
  },
  total: { ...同上结构 }
}
```

## 实现方案
使用 ParsedDataEditor.js 作为弹出编辑器，而非内联展开（避免代码过于复杂）。

步骤：
1. 在 ReportDetail.js 添加状态 `[editingReport, setEditingReport]`
2. 在表格标题旁添加 "✏️ 编辑" 按钮
3. 点击按钮后显示 ParsedDataEditor 组件（覆盖层模式）
4. 在 ParsedDataEditor 中扩展表3编辑器显示完整25行×7列数据
