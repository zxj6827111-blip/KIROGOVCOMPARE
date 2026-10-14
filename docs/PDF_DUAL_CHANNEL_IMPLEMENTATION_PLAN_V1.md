# PDF 双通道解析升级实施计划 V1.0

项目：KIROGOVCOMPARE

目标： 提升政府预决算 PDF 导入准确率，通过确定性解析 + 双通道互验，实现
PDF 解析质量达到 HTML 采集水平。

版本：V1.0

------------------------------------------------------------------------

# 1. 背景与问题定义

当前系统支持 HTML 导入和 PDF 导入，两者最终进入统一解析链路。

HTML 具备天然结构：

-   table
-   row
-   column
-   rowspan
-   colspan

PDF 当前流程：

    PDF
     ↓
    pdfjs文字流
     ↓
    坐标分析
     ↓
    规则猜测table
     ↓
    Markdown table
     ↓
    LLM解析

核心问题：

PDF 表格结构不是确定获取，而是推断，因此容易出现：

-   表存在但数字错误
-   表头错位
-   跨页表污染
-   合计校验失败

------------------------------------------------------------------------

# 2. 总体设计原则

## 2.1 不替换现有 PDF 解析

禁止：

-   删除 pdfjs 路径
-   全面迁移 OCR
-   全面替换 LLM

保留现有解析能力。

------------------------------------------------------------------------

## 2.2 新增 PDF 双通道解析

架构：

                     PDF
                      |
            ---------------------
            |                   |
         Channel A          Channel B
         pdfjs              pdfplumber
            |                   |
        markdown            grid table
            |                   |
            --------------------
                     |
              canonical mapper
                     |
              skeleton compare
                     |
              gate decision
                     |
           --------------------
           |                  |
     deterministic        LLM fallback

------------------------------------------------------------------------

# 3. 实施阶段

# Phase 0：基础能力建设

目标：

建立双通道基础，不改变生产行为。

## 3.1 修复依赖

增加：

    @napi-rs/canvas

版本：

    0.1.100

验收：

    npm ci

    require.resolve("@napi-rs/canvas")

成功。

------------------------------------------------------------------------

# Phase 0.2 Python Sidecar

新增：

    scripts/pdf_lattice_extract.py

要求：

输入：

PDF路径

输出：

JSON。

格式：

``` json
{
  "ok": true,
  "engine": "pdfplumber",
  "version": "0.11.10",
  "pages": []
}
```

要求：

-   stdout 只输出 JSON
-   日志输出 stderr
-   失败返回 ok:false
-   不允许影响 Node 主流程

------------------------------------------------------------------------

# Phase 0.3 Candidate Output 契约验证

最高优先级。

必须证明：

    PDF
     |
    sidecar
     |
    grid mapper
     |
    candidate parsed_json
     |
    MaterializeService
     |
    ConsistencyCheckService

能够完整运行。

必须通过：

    hasParsedContent()

    MaterializeService.getSection()

    ConsistencyCheckService.runChecks()

否则不得进入 Shadow。

------------------------------------------------------------------------

# Phase 1：Shadow 模式

环境：

    PDF_DUAL_CHANNEL_MODE=shadow

行为：

保持原流程：

    PDF
     |
    LLM
     |
    accepted

同时运行：

    pdfplumber

记录：

    parse_runs.dual_channel_json

禁止：

修改最终输出。

------------------------------------------------------------------------

# Phase 2：确定性直入

开启：

    PDF_DUAL_CHANNEL_MODE=enforce

只允许：

## agree

条件：

-   两通道一致
-   skeleton一致
-   consistency PASS
-   sourceGate passed

动作：

candidate_output 直接 accepted。

不调用 LLM。

------------------------------------------------------------------------

## agree_b_superset

允许 B 包含 A。

必须满足：

-   多出的行必须匹配合法字段
-   非页眉
-   非重复合计
-   公共字段 parseSourceNumber 一致

否则进入 conflict。

------------------------------------------------------------------------

# Phase 3：视觉补救升级

当前视觉补救只处理缺表。

升级为 suspect table。

触发：

-   表缺失
-   visual_border_missing=true
-   dual_channel conflict
-   consistency FAIL

流程：

    PDF
     |
    截图
     |
    vision model
     |
    重新提取
     |
    重新验证

只有改善才采纳：

    FAIL数量下降

------------------------------------------------------------------------

# 4. 新增文件

## Python

    scripts/pdf_lattice_extract.py

负责 pdfplumber 解析。

## TypeScript

新增：

    src/services/pdf-dual-channel/

包含：

## LatticeSidecarClient.ts

职责：

-   调用 Python
-   timeout
-   SIGTERM
-   SIGKILL
-   AbortSignal
-   并发限制

## tableGridMapping.ts

职责：

grid 转 canonical skeleton。

要求：

纯函数。

禁止：

访问数据库。

## PdfDualChannelService.ts

负责：

1.  Channel A
2.  Channel B
3.  Mapping
4.  Compare
5.  Gate

------------------------------------------------------------------------

# 5. 数据库设计

parse_runs 增加：

``` sql
dual_channel_json JSONB
```

结构：

``` json
{
  "version":"v1",
  "verdict":"agree",
  "source":"dual_channel",
  "confidence":0.99,
  "conflicts":[]
}
```

建议增加：

    parse_quality_level

枚举：

    ai
    dual
    manual
    failed

------------------------------------------------------------------------

# 6. 环境变量

新增：

    PDF_DUAL_CHANNEL_MODE

    off
    shadow
    enforce

版本：

    PDF_DUAL_CHANNEL_VERSION=v1

Python：

    PDF_LATTICE_PYTHON_PATH

脚本：

    PDF_LATTICE_SCRIPT_PATH

引擎：

    PDF_LATTICE_ENGINE=pdfplumber

超时：

    PDF_LATTICE_TIMEOUT_MS=60000

------------------------------------------------------------------------

# 7. 测试要求

新增：

## pdfDualChannelMapping.test.ts

覆盖：

-   普通表
-   跨页表
-   合并单元格
-   NA
-   EMPTY
-   ZERO

## pdfDualChannelGate.test.ts

覆盖全部决策。

## pdfDualChannelSidecar.test.ts

验证：

-   Python正常
-   Python不存在
-   timeout
-   JSON异常

## pdfDualChannelRunner.test.ts

验证：

Shadow：

不改变结果。

Enforce agree：

不调用 LLM。

Conflict：

调用 LLM。

------------------------------------------------------------------------

# 8. 验收标准

## Phase0

必须：

    npm test PASS

    npm run build PASS

    db migrate PASS

并且 fixture PDF：

    PDF
     ↓
    candidate
     ↓
    parsed_json
     ↓
    materialize

成功。

------------------------------------------------------------------------

## Phase1 Shadow

至少：

200份 PDF。

统计：

-   agree比例
-   conflict比例
-   channel_error比例
-   candidate优于AI比例

------------------------------------------------------------------------

## Phase2 Production

确定性路径：

    consistency FAIL = 0

性能：

    p50 < 10s

任务失败率：

接近0。

------------------------------------------------------------------------

# 9. 禁止事项

禁止：

1.  删除 LLM 路径。
2.  直接替换 pdfjs。
3.  未经过 Shadow 直接 enforce。
4.  没有数据验证扩大规则。
5.  修改 Materialize 契约但没有测试。

------------------------------------------------------------------------

# 10. 回滚

立即：

    PDF_DUAL_CHANNEL_MODE=off

恢复旧流程。

删除 sidecar：

自动回退：

channel_error。

------------------------------------------------------------------------

# 11. 最终目标

完成后：

PDF解析拥有：

第一层：

pdfjs文字解析

第二层：

pdfplumber结构解析

第三层：

业务勾稽验证

最终达到：

HTML解析准确率水平。
