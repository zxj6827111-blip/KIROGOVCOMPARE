# Fixtures (Internal Only)

本目录用于**内部测试/验收**，包含真实政务公开年报 PDF 样例与清单（manifest），用于：

- PDF 解析与结构化的回归测试
- 差异比对与摘要生成的验收
- DOCX 导出样式与内容完整性的验收

## 安全与合规

- 真实 PDF 材料严禁提交到公开仓库或对外分发。
- 如需共享，请使用公司内网存储（私有 Git / 私有对象存储 / 内网文件服务）。

## 目录约定

- `manifest.csv`：样例清单（文件路径 + 元数据），用于批量入库/回归测试
- `sample_pdfs_v1/`：样例 PDF 文件目录（可按版本递增，如 sample_pdfs_v2）
- `_template/`：模板/Schema（不含真实数据）；若放置 Word 模板，请用 .gitignore 忽略

> 代码侧应以 `manifest.csv` 作为“可重复的事实来源”，不要依赖文件名猜测年份/地区（可作为启发式兜底）。

## 建议的 .gitignore

建议忽略真实 PDF 与内部模板原件：

- `fixtures/**/*.pdf`
- `fixtures/_template/*.docx`

如真实材料已误提交，请执行 `git rm --cached` 以从索引移除，再提交一次修复提交。
