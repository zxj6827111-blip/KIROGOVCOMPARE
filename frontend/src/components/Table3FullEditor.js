import React from 'react';
import './ParsedDataEditor.css';

// 完整的表3编辑器组件 - 展示所有25行数据
const Table3FullEditor = ({ data, onChange }) => {
  const updateNestedField = (categoryPath, fieldPath, value) => {
    const newData = JSON.parse(JSON.stringify(data));
    const numValue = parseFloat(value);
    const finalValue = isNaN(numValue) ? value : numValue;
    
    // 处理category路径（如 'legalPerson.commercial'）
    const categoryParts = categoryPath.split('.');
    let target = newData;
    for (const part of categoryParts) {
      if (!target[part]) target[part] = {};
      target = target[part];
    }
    
    // 处理field路径（如 'results.granted'）
    const fieldParts = fieldPath.split('.');
    for (let i = 0; i < fieldParts.length - 1; i++) {
      if (!target[fieldParts[i]]) target[fieldParts[i]] = {};
      target = target[fieldParts[i]];
    }
    target[fieldParts[fieldParts.length - 1]] = finalValue;
    
    onChange(newData);
  };

  const renderFullCategory = (categoryPath, title) => {
    // 支持嵌套路径如 'legalPerson.commercial'
    const parts = categoryPath.split('.');
    let item = data;
    for (const p of parts) {
      item = item?.[p];
    }
    if (!item) return null;

    return (
      <div className="table3-category" key={categoryPath}>
        <h4 className="category-title">{title}</h4>
        
        <div className="field-row">
          <label>本年新收申请数量</label>
          <input
            type="number"
            value={item.newReceived ?? ''}
            onChange={(e) => updateNestedField(categoryPath, 'newReceived', e.target.value)}
          />
        </div>
        <div className="field-row">
          <label>上年结转数量</label>
          <input
            type="number"
            value={item.carriedOver ?? ''}
            onChange={(e) => updateNestedField(categoryPath, 'carriedOver', e.target.value)}
          />
        </div>

        {item.results && (
          <>
            <h5 className="subsection-title">（一）予以公开</h5>
            <div className="field-row">
              <label>予以公开</label>
              <input
                type="number"
                value={item.results.granted ?? ''}
                onChange={(e) => updateNestedField(categoryPath, 'results.granted', e.target.value)}
              />
            </div>

            <h5 className="subsection-title">（二）部分公开</h5>
            <div className="field-row">
              <label>部分公开</label>
              <input
                type="number"
                value={item.results.partialGrant ?? ''}
                onChange={(e) => updateNestedField(categoryPath, 'results.partialGrant', e.target.value)}
              />
            </div>

            <h5 className="subsection-title">（三）不予公开</h5>
            {typeof item.results.denied === 'object' && (
              <>
                <div className="field-row">
                  <label>1. 属于国家秘密</label>
                  <input
                    type="number"
                    value={item.results.denied.stateSecret ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.denied.stateSecret', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>2. 其他法律行政法规禁止公开</label>
                  <input
                    type="number"
                    value={item.results.denied.lawForbidden ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.denied.lawForbidden', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>3. 危及"三安全一稳定"</label>
                  <input
                    type="number"
                    value={item.results.denied.safetyStability ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.denied.safetyStability', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>4. 保护第三方合法权益</label>
                  <input
                    type="number"
                    value={item.results.denied.thirdPartyRights ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.denied.thirdPartyRights', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>5. 属于三类内部事务信息</label>
                  <input
                    type="number"
                    value={item.results.denied.internalAffairs ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.denied.internalAffairs', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>6. 属于四类过程性信息</label>
                  <input
                    type="number"
                    value={item.results.denied.processInfo ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.denied.processInfo', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>7. 属于行政执法案卷</label>
                  <input
                    type="number"
                    value={item.results.denied.enforcementCase ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.denied.enforcementCase', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>8. 属于行政查询事项</label>
                  <input
                    type="number"
                    value={item.results.denied.adminQuery ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.denied.adminQuery', e.target.value)}
                  />
                </div>
              </>
            )}

            <h5 className="subsection-title">（四）无法提供</h5>
            {typeof item.results.unableToProvide === 'object' && (
              <>
                <div className="field-row">
                  <label>1. 本机关不掌握相关政府信息</label>
                  <input
                    type="number"
                    value={item.results.unableToProvide.noInfo ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.unableToProvide.noInfo', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>2. 没有现成信息需要另行制作</label>
                  <input
                    type="number"
                    value={item.results.unableToProvide.needCreation ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.unableToProvide.needCreation', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>3. 补正后申请内容仍不明确</label>
                  <input
                    type="number"
                    value={item.results.unableToProvide.unclear ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.unableToProvide.unclear', e.target.value)}
                  />
                </div>
              </>
            )}

            <h5 className="subsection-title">（五）不予处理</h5>
            {typeof item.results.notProcessed === 'object' && (
              <>
                <div className="field-row">
                  <label>1. 信访举报投诉类申请</label>
                  <input
                    type="number"
                    value={item.results.notProcessed.complaint ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.notProcessed.complaint', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>2. 重复申请</label>
                  <input
                    type="number"
                    value={item.results.notProcessed.repeat ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.notProcessed.repeat', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>3. 要求提供公开出版物</label>
                  <input
                    type="number"
                    value={item.results.notProcessed.publication ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.notProcessed.publication', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>4. 无正当理由大量反复申请</label>
                  <input
                    type="number"
                    value={item.results.notProcessed.massiveRequests ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.notProcessed.massiveRequests', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>5. 要求行政机关确认或重新出具已获取信息</label>
                  <input
                    type="number"
                    value={item.results.notProcessed.confirmInfo ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.notProcessed.confirmInfo', e.target.value)}
                  />
                </div>
              </>
            )}

            <h5 className="subsection-title">（六）其他处理</h5>
            {typeof item.results.other === 'object' && (
              <>
                <div className="field-row">
                  <label>1. 申请人无正当理由逾期不补正、行政机关不再处理其政府信息公开申请</label>
                  <input
                    type="number"
                    value={item.results.other.overdueCorrection ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.other.overdueCorrection', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>2. 申请人逾期未缴费、行政机关不再处理其政府信息公开申请</label>
                  <input
                    type="number"
                    value={item.results.other.overdueFee ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.other.overdueFee', e.target.value)}
                  />
                </div>
                <div className="field-row">
                  <label>3. 其他原因</label>
                  <input
                    type="number"
                    value={item.results.other.otherReasons ?? ''}
                    onChange={(e) => updateNestedField(categoryPath, 'results.other.otherReasons', e.target.value)}
                  />
                </div>
              </>
            )}

            <h5 className="subsection-title">总计</h5>
            <div className="field-row">
              <label>本年度办结数量</label>
              <input
                type="number"
                value={item.results.totalProcessed ?? ''}
                onChange={(e) => updateNestedField(categoryPath, 'results.totalProcessed', e.target.value)}
              />
            </div>
            <div className="field-row">
              <label>结转下年度继续办理</label>
              <input
                type="number"
                value={item.results.carriedForward ?? ''}
                onChange={(e) => updateNestedField(categoryPath, 'results.carriedForward', e.target.value)}
              />
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="table3-full-editor">
      <h3>表3：收到和处理政府信息公开申请情况（完整编辑）</h3>
      <p className="editor-note">共7个类别，每个类别25行数据</p>
      
      <div className="categories-grid">
        <div className="category-column">
          {renderFullCategory('naturalPerson', '自然人')}
        </div>
        
        <div className="category-column">
          <h4 className="category-title">法人或其他组织</h4>
          {renderFullCategory('legalPerson.commercial', '① 商业企业')}
          {renderFullCategory('legalPerson.research', '② 科研机构')}
          {renderFullCategory('legalPerson.social', '③ 社会公益组织')}
          {renderFullCategory('legalPerson.legal', '④ 法律服务机构')}
          {renderFullCategory('legalPerson.other', '⑤ 其他')}
        </div>
        
        <div className="category-column">
          {renderFullCategory('total', '合计')}
        </div>
      </div>
    </div>
  );
};

export default Table3FullEditor;
