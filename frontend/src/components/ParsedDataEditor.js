import React, { useState } from 'react';
import './ParsedDataEditor.css';
import { apiClient } from '../apiClient';
import Table3FullEditor from './Table3FullEditor';

const ParsedDataEditor = ({ reportId, versionId, parsedJson, onSave, onCancel }) => {
  // 确保parsedJson是对象
  let initialData = parsedJson;
  if (typeof parsedJson === 'string') {
    try {
      initialData = JSON.parse(parsedJson);
    } catch (e) {
      console.error('Failed to parse parsedJson:', e);
      initialData = { sections: [] };
    }
  }
  if (!initialData || typeof initialData !== 'object') {
    initialData = { sections: [] };
  }

  const [editedData, setEditedData] = useState(JSON.parse(JSON.stringify(initialData)));
  const [activeTab, setActiveTab] = useState('tables');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 调试：检查数据结构
  console.log('ParsedDataEditor received parsedJson:', parsedJson);
  console.log('ParsedDataEditor initialData:', initialData);
  console.log('ParsedDataEditor editedData:', editedData);

  // 一键排版文字内容
  const handleFormatText = (sectionIdx) => {
    const newData = JSON.parse(JSON.stringify(editedData));
    const section = newData.sections[sectionIdx];

    if (section && section.content) {
      let formatted = section.content;

      // 1. 删除多余空格和换行
      formatted = formatted.replace(/\s+/g, ' ').trim();

      // 2. 在中文标点后添加适当换行
      formatted = formatted.replace(/([。！？])\s*/g, '$1\n');

      // 3. 在段落标记（一、二、三或(一)(二)(三)）前添加换行
      formatted = formatted.replace(/([^\n])\s*([一二三四五六七八九十]+、|\([一二三四五六七八九十]+\))/g, '$1\n\n$2');

      // 4. 清理多余的连续换行（最多保留2个）
      formatted = formatted.replace(/\n{3,}/g, '\n\n');

      // 5. 去除行首行尾空格
      formatted = formatted.split('\n').map(line => line.trim()).join('\n');

      section.content = formatted;
      setEditedData(newData);
    }
  };

  const handleTextChange = (sectionIdx, value) => {

    const newData = JSON.parse(JSON.stringify(editedData));
    if (newData.sections && newData.sections[sectionIdx]) {
      newData.sections[sectionIdx].content = value;
    }
    setEditedData(newData);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');

    try {
      await apiClient.patch(
        `/reports/${reportId}/parsed-data`,
        { parsed_json: editedData }
      );

      alert('保存成功！建议重新运行一致性校验。');
      onSave(editedData);
    } catch (err) {
      setError(err.response?.data?.error || err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = JSON.stringify(editedData) !== JSON.stringify(parsedJson);

  return (
    <div className="parsed-data-editor">
      <div className="editor-header">
        <h3>📝 编辑解析数据</h3>
        <div className="editor-actions">
          <button className="btn-cancel" onClick={onCancel} disabled={saving}>
            取消
          </button>
          <button
            className="btn-save"
            onClick={handleSave}
            disabled={saving || !hasChanges}
          >
            {saving ? '保存中...' : '保存修改'}
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="editor-tabs">
        <button
          className={`tab ${activeTab === 'tables' ? 'active' : ''}`}
          onClick={() => setActiveTab('tables')}
        >
          表格数据
        </button>
        <button
          className={`tab ${activeTab === 'text' ? 'active' : ''}`}
          onClick={() => setActiveTab('text')}
        >
          文字内容
        </button>
      </div>

      <div className="editor-content">
        {activeTab === 'tables' && (
          <div className="tables-editor">
            {!editedData?.sections || editedData.sections.length === 0 ? (
              <div className="no-data">
                <p>没有解析数据</p>
                <p style={{ fontSize: '12px', color: '#999' }}>
                  调试：editedData = {editedData ? 'exists' : 'null'},
                  sections = {editedData?.sections ? `array(${editedData.sections.length})` : 'null'}
                </p>
              </div>
            ) : (
              <>
                {(() => {
                  const tableSections = editedData.sections.filter(s =>
                    s.type === 'table_2' || s.type === 'table_3' || s.type === 'table_4'
                  );

                  console.log('Table sections found:', tableSections.length);
                  tableSections.forEach((s, i) => {
                    console.log(`  [${i}] ${s.type}:`, s);
                  });

                  if (tableSections.length === 0) {
                    return (
                      <div className="no-data">
                        <p>该报告没有表格数据</p>
                        <details style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
                          <summary>查看所有section（共{editedData.sections.length}个）</summary>
                          <ul>
                            {editedData.sections.map((s, i) => (
                              <li key={i}>
                                [{i}] {s.title} - type: {s.type} -
                                {s.type === 'table_2' && ` activeDisclosureData: ${s.activeDisclosureData ? 'exists' : 'null'}`}
                                {s.type === 'table_3' && ` tableData: ${s.tableData ? 'exists' : 'null'}`}
                                {s.type === 'table_4' && ` reviewLitigationData: ${s.reviewLitigationData ? 'exists' : 'null'}`}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    );
                  }

                  return null;
                })()}

                {editedData.sections.map((section, sectionIdx) => {
                  if (section.type === 'table_2') {
                    console.log('Rendering table_2, section:', section);
                    const data = section.activeDisclosureData;

                    if (!data || typeof data !== 'object') {
                      return (
                        <div key={sectionIdx} className="table-section">
                          <h4>{section.title || '表2: 主动公开政府信息情况'}</h4>
                          <div style={{ padding: '15px', background: '#f0f0f0', borderRadius: '4px', color: '#666' }}>
                            该表格暂无数据。
                          </div>
                        </div>
                      );
                    }

                    const updateTable2Field = (category, field, value) => {
                      const newData = JSON.parse(JSON.stringify(editedData));
                      const numValue = parseFloat(value);
                      if (!newData.sections[sectionIdx].activeDisclosureData[category]) {
                        newData.sections[sectionIdx].activeDisclosureData[category] = {};
                      }
                      newData.sections[sectionIdx].activeDisclosureData[category][field] = isNaN(numValue) ? value : numValue;
                      setEditedData(newData);
                    };

                    return (
                      <div key={sectionIdx} className="table-section">
                        <h4>{section.title || '表2: 主动公开政府信息情况'}</h4>

                        {/* 规章 */}
                        {data.regulations && (
                          <div className="table2-group">
                            <h5>一、规章</h5>
                            <div className="field-row">
                              <label>制定数量</label>
                              <input type="number" value={data.regulations.made ?? ''}
                                onChange={(e) => updateTable2Field('regulations', 'made', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>废止数量</label>
                              <input type="number" value={data.regulations.repealed ?? ''}
                                onChange={(e) => updateTable2Field('regulations', 'repealed', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>有效数量</label>
                              <input type="number" value={data.regulations.valid ?? ''}
                                onChange={(e) => updateTable2Field('regulations', 'valid', e.target.value)} />
                            </div>
                          </div>
                        )}

                        {/* 规范性文件 */}
                        {data.normativeDocuments && (
                          <div className="table2-group">
                            <h5>二、规范性文件</h5>
                            <div className="field-row">
                              <label>制定数量</label>
                              <input type="number" value={data.normativeDocuments.made ?? ''}
                                onChange={(e) => updateTable2Field('normativeDocuments', 'made', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>废止数量</label>
                              <input type="number" value={data.normativeDocuments.repealed ?? ''}
                                onChange={(e) => updateTable2Field('normativeDocuments', 'repealed', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>有效数量</label>
                              <input type="number" value={data.normativeDocuments.valid ?? ''}
                                onChange={(e) => updateTable2Field('normativeDocuments', 'valid', e.target.value)} />
                            </div>
                          </div>
                        )}

                        {/* 行政许可 */}
                        {data.licensing && (
                          <div className="table2-group">
                            <h5>三、行政许可</h5>
                            <div className="field-row">
                              <label>办件数</label>
                              <input type="number" value={data.licensing.processed ?? ''}
                                onChange={(e) => updateTable2Field('licensing', 'processed', e.target.value)} />
                            </div>
                          </div>
                        )}

                        {/* 行政处罚 */}
                        {data.punishment && (
                          <div className="table2-group">
                            <h5>四、行政处罚</h5>
                            <div className="field-row">
                              <label>办件数</label>
                              <input type="number" value={data.punishment.processed ?? ''}
                                onChange={(e) => updateTable2Field('punishment', 'processed', e.target.value)} />
                            </div>
                          </div>
                        )}

                        {/* 行政强制 */}
                        {data.coercion && (
                          <div className="table2-group">
                            <h5>五、行政强制</h5>
                            <div className="field-row">
                              <label>办件数</label>
                              <input type="number" value={data.coercion.processed ?? ''}
                                onChange={(e) => updateTable2Field('coercion', 'processed', e.target.value)} />
                            </div>
                          </div>
                        )}

                        {/* 收费 */}
                        {data.fees && (
                          <div className="table2-group">
                            <h5>六、政府信息公开收费</h5>
                            <div className="field-row">
                              <label>收取费用金额（万元）</label>
                              <input type="number" step="0.01" value={data.fees.amount ?? ''}
                                onChange={(e) => updateTable2Field('fees', 'amount', e.target.value)} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  if (section.type === 'table_3') {
                    console.log('Rendering table_3, section:', section);
                    const data = section.tableData;

                    if (!data || typeof data !== 'object') {
                      return (
                        <div key={sectionIdx} className="table-section">
                          <h4>{section.title || '表3: 收到和处理政府信息公开申请情况'}</h4>
                          <div style={{ padding: '15px', background: '#f0f0f0', borderRadius: '4px', color: '#666' }}>
                            该表格暂无数据。
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={sectionIdx} className="table-section">
                        <Table3FullEditor
                          data={data}
                          onChange={(newData) => {
                            const updated = JSON.parse(JSON.stringify(editedData));
                            updated.sections[sectionIdx].tableData = newData;
                            setEditedData(updated);
                          }}
                        />
                      </div>
                    );
                  }

                  if (section.type === 'table_4') {
                    console.log('Rendering table_4, section:', section);
                    const data = section.reviewLitigationData;

                    if (!data || typeof data !== 'object') {
                      return (
                        <div key={sectionIdx} className="table-section">
                          <h4>{section.title || '表4: 政府信息公开行政复议、行政诉讼情况'}</h4>
                          <div style={{ padding: '15px', background: '#f0f0f0', borderRadius: '4px', color: '#666' }}>
                            该表格暂无数据。
                          </div>
                        </div>
                      );
                    }

                    const updateTable4Field = (category, field, value) => {
                      const newData = JSON.parse(JSON.stringify(editedData));
                      const numValue = parseFloat(value);
                      if (!newData.sections[sectionIdx].reviewLitigationData[category]) {
                        newData.sections[sectionIdx].reviewLitigationData[category] = {};
                      }
                      newData.sections[sectionIdx].reviewLitigationData[category][field] = isNaN(numValue) ? value : numValue;
                      setEditedData(newData);
                    };

                    return (
                      <div key={sectionIdx} className="table-section">
                        <h4>{section.title || '表4: 政府信息公开行政复议、行政诉讼情况'}</h4>

                        {/* 行政复议 */}
                        {data.review && (
                          <div className="table4-group">
                            <h5>行政复议</h5>
                            <div className="field-row">
                              <label>维持</label>
                              <input type="number" value={data.review.maintain ?? ''}
                                onChange={(e) => updateTable4Field('review', 'maintain', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>纠正</label>
                              <input type="number" value={data.review.correct ?? ''}
                                onChange={(e) => updateTable4Field('review', 'correct', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>其他</label>
                              <input type="number" value={data.review.other ?? ''}
                                onChange={(e) => updateTable4Field('review', 'other', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>尚未审结</label>
                              <input type="number" value={data.review.unfinished ?? ''}
                                onChange={(e) => updateTable4Field('review', 'unfinished', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>总计</label>
                              <input type="number" value={data.review.total ?? ''}
                                onChange={(e) => updateTable4Field('review', 'total', e.target.value)} />
                            </div>
                          </div>
                        )}

                        {/* 未经复议直接起诉 */}
                        {data.litigationDirect && (
                          <div className="table4-group">
                            <h5>未经复议直接起诉</h5>
                            <div className="field-row">
                              <label>维持</label>
                              <input type="number" value={data.litigationDirect.maintain ?? ''}
                                onChange={(e) => updateTable4Field('litigationDirect', 'maintain', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>纠正</label>
                              <input type="number" value={data.litigationDirect.correct ?? ''}
                                onChange={(e) => updateTable4Field('litigationDirect', 'correct', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>其他</label>
                              <input type="number" value={data.litigationDirect.other ?? ''}
                                onChange={(e) => updateTable4Field('litigationDirect', 'other', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>尚未审结</label>
                              <input type="number" value={data.litigationDirect.unfinished ?? ''}
                                onChange={(e) => updateTable4Field('litigationDirect', 'unfinished', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>总计</label>
                              <input type="number" value={data.litigationDirect.total ?? ''}
                                onChange={(e) => updateTable4Field('litigationDirect', 'total', e.target.value)} />
                            </div>
                          </div>
                        )}

                        {/* 复议后起诉 */}
                        {data.litigationPostReview && (
                          <div className="table4-group">
                            <h5>复议后起诉</h5>
                            <div className="field-row">
                              <label>维持</label>
                              <input type="number" value={data.litigationPostReview.maintain ?? ''}
                                onChange={(e) => updateTable4Field('litigationPostReview', 'maintain', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>纠正</label>
                              <input type="number" value={data.litigationPostReview.correct ?? ''}
                                onChange={(e) => updateTable4Field('litigationPostReview', 'correct', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>其他</label>
                              <input type="number" value={data.litigationPostReview.other ?? ''}
                                onChange={(e) => updateTable4Field('litigationPostReview', 'other', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>尚未审结</label>
                              <input type="number" value={data.litigationPostReview.unfinished ?? ''}
                                onChange={(e) => updateTable4Field('litigationPostReview', 'unfinished', e.target.value)} />
                            </div>
                            <div className="field-row">
                              <label>总计</label>
                              <input type="number" value={data.litigationPostReview.total ?? ''}
                                onChange={(e) => updateTable4Field('litigationPostReview', 'total', e.target.value)} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }

                  return null;
                })}
              </>
            )}
          </div>
        )}

        {activeTab === 'text' && (
          <div className="text-editor">
            {!editedData?.sections || editedData.sections.length === 0 ? (
              <div className="no-sections">无文字内容数据</div>
            ) : (
              editedData.sections
                .filter(section => section.type === 'text' && section.content)
                .map((section, idx) => {
                  const sectionIdx = editedData.sections.indexOf(section);
                  return (
                    <div key={idx} className="section-editor">
                      <div className="section-header">
                        <label>{section.title || `文本段落 ${idx + 1}`}</label>
                        <button
                          className="btn-format"
                          onClick={() => handleFormatText(sectionIdx)}
                          title="一键排版：自动添加段落换行和格式化"
                        >
                          ✨ 一键排版
                        </button>
                      </div>
                      <textarea
                        value={section.content || ''}
                        onChange={(e) => handleTextChange(sectionIdx, e.target.value)}
                        rows={15}
                      />
                    </div>
                  );
                })
            )}
            {editedData?.sections && editedData.sections.filter(s => s.type === 'text').length === 0 && (
              <div className="no-sections">该报告没有文字段落</div>
            )}
          </div>
        )}
      </div>

      {hasChanges && (
        <div className="changes-warning">
          ⚠️ 您有未保存的修改。保存后建议重新运行一致性校验。
        </div>
      )}
    </div>
  );
};

export default ParsedDataEditor;
