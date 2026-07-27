import {
  parseAnnualReportHtmlToForm,
} from '../services/filing/FilingHtmlImportService';

/** Minimal Hangzhou-style 国办 annual report HTML fixture (tables + section headings). */
const SAMPLE_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>测试市2025年政府信息公开工作年度报告</title></head>
<body>
<div id="zoom" class="article-content">
<p>根据《中华人民共和国政府信息公开条例》规定编制本报告。本报告中所列数据统计期限为2025年1月1日至12月31日。</p>
<p>一、总体情况</p>
<p>2025年，全市各级行政机关扎实推进政务公开工作。主动公开方面成效明显。</p>
<p>（一）主动公开。发布规章与规范性文件若干。</p>
<p>（二）依申请公开。规范办理程序。</p>
<p>二、主动公开政府信息情况</p>
<table>
<tr><td colspan="4">第二十条第（一）项</td></tr>
<tr><td>信息内容</td><td>本年制发件数</td><td>本年废止件数</td><td>现行有效件数</td></tr>
<tr><td>规章</td><td>3</td><td>5</td><td>74</td></tr>
<tr><td>行政规范性文件</td><td>564</td><td>984</td><td>4185</td></tr>
<tr><td colspan="4">第二十条第（五）项</td></tr>
<tr><td>信息内容</td><td colspan="3">本年处理决定数量</td></tr>
<tr><td>行政许可</td><td colspan="3">11398889</td></tr>
<tr><td colspan="4">第二十条第（六）项</td></tr>
<tr><td>信息内容</td><td colspan="3">本年处理决定数量</td></tr>
<tr><td>行政处罚</td><td colspan="3">6937489</td></tr>
<tr><td>行政强制</td><td colspan="3">166105</td></tr>
<tr><td colspan="4">第二十条第（八）项</td></tr>
<tr><td>信息内容</td><td colspan="3">本年收费金额（单位：万元）</td></tr>
<tr><td>行政事业性收费</td><td colspan="3">316441</td></tr>
</table>
<p>三、收到和处理政府信息公开申请情况</p>
<table>
<tr>
  <td colspan="3" rowspan="3">（本列数据的勾稽关系为：第一项加第二项之和，等于第三项加第四项之和）</td>
  <td colspan="7">申请人情况</td>
</tr>
<tr>
  <td>自然人</td><td colspan="5">法人或其他组织</td><td>总计</td>
</tr>
<tr>
  <td></td><td>商业企业</td><td>科研机构</td><td>社会公益组织</td><td>法律服务机构</td><td>其他</td><td></td>
</tr>
<tr><td colspan="3">一、本年新收政府信息公开申请数量</td><td>13612</td><td>252</td><td>0</td><td>45</td><td>128</td><td>32</td><td>14069</td></tr>
<tr><td colspan="3">二、上年结转政府信息公开申请数量</td><td>535</td><td>6</td><td>0</td><td>1</td><td>18</td><td>0</td><td>560</td></tr>
<tr><td rowspan="22">三、本年度办理结果</td><td colspan="2">（一）予以公开</td><td>5345</td><td>129</td><td>0</td><td>41</td><td>19</td><td>14</td><td>5548</td></tr>
<tr><td colspan="2">（二）部分公开（区分处理的，只计这一情形，不计其他情形）</td><td>2120</td><td>39</td><td>0</td><td>1</td><td>6</td><td>2</td><td>2168</td></tr>
<tr><td rowspan="8">（三）不予公开</td><td>1.属于国家秘密</td><td>13</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>13</td></tr>
<tr><td>2.其他法律行政法规禁止公开</td><td>30</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>30</td></tr>
<tr><td>3.危及“三安全一稳定”</td><td>11</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>11</td></tr>
<tr><td>4.保护第三方合法权益</td><td>49</td><td>2</td><td>0</td><td>0</td><td>0</td><td>0</td><td>51</td></tr>
<tr><td>5.属于三类内部事务信息</td><td>103</td><td>1</td><td>0</td><td>0</td><td>0</td><td>0</td><td>104</td></tr>
<tr><td>6.属于四类过程性信息</td><td>84</td><td>1</td><td>0</td><td>0</td><td>0</td><td>0</td><td>85</td></tr>
<tr><td>7.属于行政执法案卷</td><td>282</td><td>4</td><td>0</td><td>0</td><td>0</td><td>0</td><td>286</td></tr>
<tr><td>8.属于行政查询事项</td><td>147</td><td>0</td><td>0</td><td>0</td><td>1</td><td>2</td><td>150</td></tr>
<tr><td rowspan="3">（四）无法提供</td><td>1.本机关不掌握相关政府信息</td><td>3075</td><td>50</td><td>0</td><td>0</td><td>89</td><td>8</td><td>3222</td></tr>
<tr><td>2.没有现成信息需要另行制作</td><td>177</td><td>3</td><td>0</td><td>0</td><td>0</td><td>0</td><td>180</td></tr>
<tr><td>3.补正后申请内容仍不明确</td><td>19</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>19</td></tr>
<tr><td rowspan="5">（五）不予处理</td><td>1.信访举报投诉类申请</td><td>199</td><td>1</td><td>0</td><td>0</td><td>3</td><td>0</td><td>203</td></tr>
<tr><td>2.重复申请</td><td>147</td><td>1</td><td>0</td><td>0</td><td>0</td><td>0</td><td>148</td></tr>
<tr><td>3.要求提供公开出版物</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td></tr>
<tr><td>4.无正当理由大量反复申请</td><td>100</td><td>1</td><td>0</td><td>0</td><td>0</td><td>0</td><td>101</td></tr>
<tr><td>5.要求行政机关确认或重新出具已获取信息</td><td>5</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>5</td></tr>
<tr><td rowspan="3">（六）其他处理</td><td>1.申请人无正当理由逾期不补正、行政机关不再处理其政府信息公开申请</td><td>315</td><td>3</td><td>0</td><td>0</td><td>0</td><td>0</td><td>318</td></tr>
<tr><td>2.申请人逾期未按收费通知要求缴纳费用、行政机关不再处理其政府信息公开申请</td><td>202</td><td>0</td><td>0</td><td>1</td><td>0</td><td>0</td><td>203</td></tr>
<tr><td>3.其他</td><td>941</td><td>17</td><td>0</td><td>1</td><td>3</td><td>3</td><td>965</td></tr>
<tr><td colspan="2">（七）总计</td><td>13364</td><td>252</td><td>0</td><td>44</td><td>121</td><td>29</td><td>13810</td></tr>
<tr><td colspan="3">四、结转下年度继续办理</td><td>783</td><td>6</td><td>0</td><td>2</td><td>25</td><td>3</td><td>819</td></tr>
</table>
<p>四、政府信息公开行政复议、行政诉讼情况</p>
<table>
<tr><td colspan="5">行政复议</td><td colspan="10">行政诉讼</td></tr>
<tr>
  <td>结果维持</td><td>结果纠正</td><td>其他结果</td><td>尚未审结</td><td>总计</td>
  <td colspan="5">未经复议直接起诉</td><td colspan="5">复议后起诉</td>
</tr>
<tr>
  <td></td><td></td><td></td><td></td><td></td>
  <td>结果维持</td><td>结果纠正</td><td>其他结果</td><td>尚未审结</td><td>总计</td>
  <td>结果维持</td><td>结果纠正</td><td>其他结果</td><td>尚未审结</td><td>总计</td>
</tr>
<tr>
  <td>376</td><td>97</td><td>196</td><td>121</td><td>790</td>
  <td>16</td><td>1</td><td>12</td><td>27</td><td>56</td>
  <td>74</td><td>1</td><td>30</td><td>51</td><td>156</td>
</tr>
</table>
<p>五、存在问题及改进情况</p>
<p>对照新要求新任务，仍存在以下短板：一是主动公开工作还需进一步规范。</p>
<p>六、其他需要报告的事项</p>
<p>依据《政府信息公开信息处理费管理办法》规定，2025年全市实际收取信息处理费共计400元。</p>
</div>
</body></html>`;

describe('FilingHtmlImportService (rule-based, no AI)', () => {
  it('parses Hangzhou-style HTML into 6-section form_json', () => {
    const { form_json, stats } = parseAnnualReportHtmlToForm(SAMPLE_HTML, {
      year: 2025,
      unitName: '测试市',
      regionId: 1,
    });

    expect(form_json.sections).toHaveLength(6);
    expect(form_json.sections.map((s: any) => s.type)).toEqual([
      'text',
      'table_2',
      'table_3',
      'table_4',
      'text',
      'text',
    ]);

    const t2 = form_json.sections[1].activeDisclosureData;
    expect(t2.regulations).toEqual({ made: 3, repealed: 5, valid: 74 });
    expect(t2.normativeDocuments).toEqual({ made: 564, repealed: 984, valid: 4185 });
    expect(t2.licensing.processed).toBe(11398889);
    expect(t2.punishment.processed).toBe(6937489);
    expect(t2.coercion.processed).toBe(166105);
    expect(t2.fees.amount).toBe(316441);

    const t3 = form_json.sections[2].tableData;
    expect(t3.naturalPerson.newReceived).toBe(13612);
    expect(t3.total.newReceived).toBe(14069);
    expect(t3.naturalPerson.results.granted).toBe(5345);
    expect(t3.total.results.granted).toBe(5548);
    expect(t3.naturalPerson.results.denied.stateSecret).toBe(13);
    expect(t3.naturalPerson.results.other.otherReasons).toBe(941);
    expect(t3.total.results.totalProcessed).toBe(13810);
    expect(t3.total.results.carriedForward).toBe(819);

    const t4 = form_json.sections[3].reviewLitigationData;
    expect(t4.review).toEqual({
      maintain: 376,
      correct: 97,
      other: 196,
      unfinished: 121,
      total: 790,
    });
    expect(t4.litigationDirect.total).toBe(56);
    expect(t4.litigationPostReview.total).toBe(156);

    expect(form_json.sections[0].content).toContain('扎实推进政务公开');
    expect(form_json.sections[4].content).toContain('短板');
    expect(form_json.sections[5].content).toContain('信息处理费');

    expect(stats.table2Filled).toBeGreaterThan(0);
    expect(stats.table3Filled).toBeGreaterThan(0);
    expect(stats.table4Filled).toBeGreaterThan(0);
    expect(stats.text1Chars).toBeGreaterThan(10);
  });
});
