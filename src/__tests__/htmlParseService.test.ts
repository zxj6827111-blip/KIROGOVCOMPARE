import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import HtmlParseService from '../services/HtmlParseService';

async function writeTempHtml(html: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gov-report-html-'));
  const filePath = path.join(dir, 'report.html');
  await fs.writeFile(filePath, html, 'utf8');
  return filePath;
}

describe('HtmlParseService', () => {
  it('extracts the annual report body from an inner content container without page chrome', async () => {
    const filePath = await writeTempHtml(`
      <!doctype html>
      <html>
        <head><meta charset="utf-8"><title>2025年黄浦区财政局政府信息公开工作年度报告</title></head>
        <body>
          <div class="site-switch">繁體版 ENGLISH 日本語 한국어 FRANÇAIS 无障碍 长者版</div>
          <div class="site-nav">首页 政务公开 公共服务 政民互动 专题专栏</div>
          <div class="breadcrumb">当前位置：首页 &gt; 政府信息公开 &gt; 年报</div>
          <div class="ewb-main container">
            <div id="webeditorview">
              <div id="ivs_content">
                <h1>2025年黄浦区财政局政府信息公开工作年度报告</h1>
                <p>一、总体情况</p>
                <p>2025年，黄浦区财政局持续推进政府信息公开工作，规范发布财政资金使用、预算决算等信息。</p>
                <p>二、主动公开政府信息情况</p>
                <table border="1">
                  <tr><th>信息内容</th><th>本年制发件数</th><th>本年废止件数</th><th>现行有效件数</th></tr>
                  <tr><td>规章</td><td>0</td><td>0</td><td>0</td></tr>
                  <tr><td>行政规范性文件</td><td>3</td><td>1</td><td>12</td></tr>
                </table>
                <p>三、收到和处理政府信息公开申请情况</p>
                <table border="1">
                  <tr><th>申请人情况</th><th>自然人</th><th>法人或其他组织</th></tr>
                  <tr><td>本年新收政府信息公开申请数量</td><td>12</td><td>1</td></tr>
                </table>
                <p>四、政府信息公开行政复议、行政诉讼情况</p>
                <table border="1">
                  <tr><th>行政复议</th><th>行政诉讼</th></tr>
                  <tr><td>0</td><td>0</td></tr>
                  <tr><td>0</td><td>0</td></tr>
                  <tr><td>0</td><td>0</td></tr>
                  <tr><td>0</td><td>0</td></tr>
                </table>
                <p>五、存在的主要问题及改进情况</p>
                <p>财政政策解读形式还需进一步丰富，下一步将提升公开内容可读性。</p>
                <p>六、其他需要报告的事项</p>
                <p>本年度未收取信息处理费。</p>
              </div>
            </div>
          </div>
          <div class="article-tools">字体：【大 中 小】 分享到 打印 关闭</div>
          <footer>主办单位：上海市黄浦区人民政府 ICP备案 公安备案 网站地图</footer>
        </body>
      </html>
    `);

    const parsed = await HtmlParseService.parseHtmlToMarkdown(filePath);

    expect(parsed.success).toBe(true);
    expect(parsed.metadata?.content_selector).toBe('#ivs_content');
    expect(parsed.extracted_text).toContain('2025年黄浦区财政局政府信息公开工作年度报告');
    expect(parsed.extracted_text).toContain('一、总体情况');
    expect(parsed.extracted_text).toContain('财政政策解读形式还需进一步丰富');
    expect(parsed.extracted_text).toContain('| 信息内容 | 本年制发件数 | 本年废止件数 | 现行有效件数 |');
    expect(parsed.extracted_text).not.toContain('繁體版');
    expect(parsed.extracted_text).not.toContain('ENGLISH');
    expect(parsed.extracted_text).not.toContain('当前位置');
    expect(parsed.extracted_text).not.toContain('字体：【大 中 小】');
    expect(parsed.extracted_text).not.toContain('ICP备案');
  });

  it('uses report markers to find a generic article body when no site-specific id exists', async () => {
    const filePath = await writeTempHtml(`
      <html>
        <body>
          <div class="top">首页 一网通办 政务公开 公共服务</div>
          <main>
            <section class="article-content">
              <h2>2025年某单位政府信息公开工作年度报告</h2>
              <div>一、总体情况</div>
              <div>本机关依法推进政府信息公开工作，主动公开目录持续完善。</div>
              <div>二、主动公开政府信息情况</div>
              <table>
                <tr><th>信息内容</th><th>本年制发件数</th></tr>
                <tr><td>规章</td><td>0</td></tr>
              </table>
              <div>三、收到和处理政府信息公开申请情况</div>
              <div>本年度收到申请10件。</div>
              <div>四、政府信息公开行政复议、行政诉讼情况</div>
              <div>未发生行政复议和行政诉讼。</div>
              <div>五、存在的主要问题及改进情况</div>
              <div>公开渠道还需优化。</div>
              <div>六、其他需要报告的事项</div>
              <div>无其他需要报告的事项。</div>
            </section>
          </main>
          <div class="bottom">分享到 打印 关闭 友情链接 网站地图</div>
        </body>
      </html>
    `);

    const parsed = await HtmlParseService.parseHtmlToMarkdown(filePath);

    expect(parsed.success).toBe(true);
    expect(parsed.metadata?.content_selector).toBe('.article-content');
    expect(parsed.extracted_text).toContain('2025年某单位政府信息公开工作年度报告');
    expect(parsed.extracted_text).toContain('六、其他需要报告的事项');
    expect(parsed.extracted_text).toContain('| 信息内容 | 本年制发件数 |');
    expect(parsed.extracted_text).not.toContain('首页 一网通办');
    expect(parsed.extracted_text).not.toContain('友情链接');
  });
});
