# GovInsight `unit_type / parent_region_id / year` 正式分析底座设计方案

编制日期：2026-04-14  
任务性质：实施前冻结方案，不含业务重构  
依据范围：
- 当前项目代码与数据库真实数据
- [GOVINSIGHT_CURRENT_STATE_AUDIT_2026-04-14.md](./GOVINSIGHT_CURRENT_STATE_AUDIT_2026-04-14.md)
- [GOVINSIGHT_AIREPORT_BACKENDIZATION_PLAN_2026-04-14.md](./GOVINSIGHT_AIREPORT_BACKENDIZATION_PLAN_2026-04-14.md)

---

## 一、方案结论摘要

### 1.1 结论先行

本次核查后的核心结论不是“系统缺少区县/部门数据”，而是：

1. 当前系统已经拥有大量 city / district / department / town_street / functional_zone 真实实体和对应年报数据。
2. 当前最大基础问题是**正式消费层没有冻结 `unit_type / parent_region_id / year`**，导致这些数据虽然存在，但无法稳定进入统一分析链路。
3. `regions.level` 当前只能稳定表达“树深度”，不能稳定表达“业务单位类型”。
4. 现有 `gov_open_annual_stats` 把 `level <= 2` 一律压成 `city`，其余一律压成 `district`，已经造成正式统计层错分。
5. `regions.parent_id` 从“结构完整性”角度整体可用，但仍应通过独立映射层固化为 canonical `parent_region_id`，不能继续依赖 `level` 推断。
6. `year` 在正式消费层必须绑定到 `reports.year + source_report_version_id`，并且**不能再允许 `year IS NULL` 空壳行进入正式报告消费**。
7. 不建议直接替换现有 `gov_open_annual_stats`；建议新增并行正式消费层 `gov_open_annual_stats_v2`（或等价正式表），并引入独立的 canonical 单位映射层。

### 1.2 建议冻结的总体设计

建议冻结如下底座方案：

1. 新增 canonical 单位映射层，建议命名为 `canonical_units` 或 `region_analysis_mapping`。
2. 正式 `unit_type` 至少冻结为：
   - `province`（支撑型，不进入正式报告正文消费）
   - `city`
   - `district`
   - `department`
   - `town_street`
   - `functional_zone`
   - `unknown`（阻断态，不进入正式 official 消费）
3. `parent_region_id` 以 `regions.parent_id` 为默认来源，但以后续 canonical 映射结果为准。
4. `year` 正式口径固定为 `reports.year`，正式消费层从 `reports` 出发，不再从 `regions LEFT JOIN reports` 出发。
5. 正式消费层建议新增 `gov_open_annual_stats_v2`，优先设计为**可审计的物化结果表**，而不是继续依赖仅凭视图实时拼装。
6. 正式 official 消费默认只吃：
   - `year IS NOT NULL`
   - `source_report_version_id` 已确定
   - `unit_type != 'unknown'`
   - `source_review_status = 'published'`
7. 若产品仍需要“预览/待审”数据，应单独以 `materialize_status='preview'` 或独立 preview 通道暴露，不应与 official 正式统计混用。

### 1.3 为什么现在必须先冻结这三项口径

若 `unit_type / parent_region_id / year` 不先定型，后续以下工作都会高概率返工：

1. 后端规则服务与 `report_payload_v1`
2. 区县/部门/镇街/功能区多层分析
3. 批量报告生成和复跑
4. 领导驾驶舱统一口径
5. AI 正文提示词中的单位分层语义
6. 风险排序、重点单位画像、附件清单的稳定产出

---

## 二、当前 `regions` 与实体层级现状

### 2.1 数据库与代码侧已确认的结构事实

代码与数据库交叉核查后，当前关键事实如下：

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| `regions` 字段 | `id/code/name/province/parent_id/level/sort_order/created_at/updated_at` | 数据库真实字段 |
| `reports` 字段关键项 | `region_id/year/unit_name/active_version_id` | `year` 非空 |
| `report_versions` 关键项 | `review_status/state/is_active/parsed_json/...` | 已支持版本链与审核态 |
| `fact_*` 表 | `fact_active_disclosure` / `fact_application` / `fact_legal_proceeding` | 已具备事实层基础 |
| `regions` 总量 | 1909 | 当前真实实体总数 |
| `regions.level` 分布 | 1:4 / 2:58 / 3:820 / 4:1027 | 不是业务类型，只是树深度 |
| `parent_id IS NULL` | 4 | 仅 4 个根节点 |
| `parent_id 非空` | 1905 | 绝大部分实体已挂父级 |
| `regions` 中有报告的实体 | 1043 | `reports.region_id` 去重后 |
| `regions` 中无报告的实体 | 866 | 与当前 stats 的 `year IS NULL` 行数完全相等 |
| `reports` 总量 | 3968 | 全部有 `active_version_id` |
| `report_versions` 总量 | 4019 | 45 个 report 存在多版本 |
| active version 审核态 | `published` 3963，`pending_review` 5 | 说明 current active 并不总是 official published |
| `gov_open_annual_stats` `year IS NULL` | 866 行 | 当前正式统计层存在空壳行 |

### 2.2 当前层级混乱的根因

根因不是单一数据脏，而是**三个层面同时错位**：

#### 根因 A：`regions.level` 是“树深度”，不是“业务实体类型”

在 [src/routes/llm-regions.ts](/E:/Software%20Development/KIROGOVCOMPARE/src/routes/llm-regions.ts#L12) 中，`parent_id` 存在时，`level = parent.level + 1`；并限制在 1..4（[32](/E:/Software%20Development/KIROGOVCOMPARE/src/routes/llm-regions.ts#L32)、[39](/E:/Software%20Development/KIROGOVCOMPARE/src/routes/llm-regions.ts#L39)）。

这意味着：

1. `level` 受挂载位置影响，而不是受“区县/部门/镇街/功能区”业务语义影响。
2. 同一 `level` 内完全可能混有不同业务类型。
3. 一旦挂载结构特殊，例如直辖市、功能区、同层管委会，`level` 就无法表达真实单位口径。

#### 根因 B：当前 stats 视图把非 city 实体大面积压成 `district`

在 [src/db/migrations-llm.ts:589](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L589) 的 `gov_open_annual_stats` 视图中：

1. 基表从 `regions LEFT JOIN reports` 出发（[601](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L601)）。
2. `org_id` 按 `level <= 2 => city_...`，否则 `district_...`（[705](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L705)）。
3. `org_type` 同样按 `level <= 2 => city`，否则 `district`（[710](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L710)）。
4. `parent_id` 也沿用同样的二元前缀逻辑（[715](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L715)）。

直接后果：

1. 上海区县（`level=2`）被压成 `city`
2. 上海市级部门（`level=2`）也被压成 `city`
3. 南通市经济技术开发区管委会（`level=2`）被压成 `city`
4. 大量部门、镇街、功能区全部被压成 `district`

#### 根因 C：前端仍在用名称启发式兜底识别

当前前端仍存在基于名称后缀的隐式识别逻辑：

1. [frontend/src/govinsight/leader-cockpit/selectors.ts:593](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/leader-cockpit/selectors.ts#L593) `isDistrictName`
2. [frontend/src/govinsight/leader-cockpit/selectors.ts:598](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/leader-cockpit/selectors.ts#L598) `isDepartmentName`
3. [frontend/src/govinsight/leader-cockpit/selectors.ts:605](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/leader-cockpit/selectors.ts#L605) `classifyEntity`

同时，前端数据层还在做年份过滤和 fallback：

1. [frontend/src/govinsight/data.ts:43](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/data.ts#L43) `isValidAnnualYear`
2. [frontend/src/govinsight/data.ts:69](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/data.ts#L69) `normalizeRecordsByYear`
3. [frontend/src/govinsight/data.ts:344](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/data.ts#L344) 对 `org_type` 缺省回落为 `'district'`

这说明：后端还未输出稳定的正式单位口径，前端在被迫补洞。

### 2.3 `regions` 体系的真实实体类型清单

以下是基于真实 `regions` 样本、父子关系和名称规则做的**试分类统计**。该分类仅用于本次方案设计推演，不等同于已落库正式口径。

| 试分类 `unit_type` | 全量实体数 | 有报告实体数 | 无报告实体数 | 说明 |
| --- | ---: | ---: | ---: | --- |
| `province` | 3 | 0 | 3 | 江苏省、浙江省、安徽省，仅作挂载根 |
| `city` | 7 | 4 | 3 | 含上海市、南京市、苏州市、杭州市、宿迁市、淮安市、南通市 |
| `district` | 49 | 27 | 22 | 含区、县、县级市、直辖市市辖区 |
| `department` | 1285 | 701 | 584 | 规模最大，当前被严重压扁 |
| `town_street` | 503 | 272 | 231 | 已存在大量镇街级数据 |
| `functional_zone` | 57 | 36 | 21 | 已存在独立功能区/开发区/园区数据 |
| `unknown` | 5 | 3 | 2 | 少量需人工映射 |

### 2.4 当前正式 stats 层错分程度

将“试分类结果”与当前 `gov_open_annual_stats` 的 `org_type` 做对照后，可得到：

| 建议 `unit_type` | 当前 `gov_open_annual_stats.org_type` | 有数据实体数 | 结论 |
| --- | --- | ---: | --- |
| `city` | `city` | 4 | 基本正确 |
| `district` | `city` | 3 | 上海直辖市区县被错压为 `city` |
| `district` | `district` | 24 | 正常 |
| `department` | `district` | 701 | 全部错压 |
| `town_street` | `district` | 272 | 全部错压 |
| `functional_zone` | `district` | 36 | 全部错压 |
| `unknown` | `district` | 3 | 暂不可直接消费 |

这说明：当前 stats 层不是“少量异常”，而是**结构性错分**。

### 2.5 典型错分样本

| 样本 | 当前现象 | 实际建议 |
| --- | --- | --- |
| `黄浦区`（1427） | `level=2`，stats 记为 `city` | 应为 `district` |
| `普陀区`（1431） | `level=2`，stats 记为 `city` | 应为 `district` |
| `市发展和改革委员会`（1662） | `level=2`，stats 记为 `city` | 应为 `department` |
| `南通市经济技术开发区管委会`（2182） | `level=2`，stats 记为 `city` | 应为 `functional_zone` |
| `宿迁经济技术开发区`（780） | stats 记为 `district` | 应为 `functional_zone` |
| `宿城区项里街道办事处`（975） | stats 记为 `district` | 应为 `town_street` |
| `启东市交通局`（2330） | stats 记为 `district` | 应为 `department` |

### 2.6 `parent_id` 现状可信度

`parent_id` 的结构完整性明显高于 `level` 和 `org_type`：

1. `parent_id` 为空的只有 4 个根节点。
2. 非空父子关系共 1905 条。
3. 其中 1902 条满足 `child.level = parent.level + 1`。
4. 仅 3 条存在“层级差不等于 1”的异常：
   - 2182 `南通市经济技术开发区管委会`：`level=2`，父级 `南通市` 也是 `level=2`
   - 2646 `区信访局`：`level=3`，父级 `鼓楼区` 也是 `level=3`
   - 2647 `区生态环境局`：`level=3`，父级 `鼓楼区` 也是 `level=3`

结论：

1. `parent_id` 在“结构关系”层面整体可信。
2. 异常主要体现为 `level` 不可信，而不是 `parent_id` 大面积错挂。
3. 正式方案可以把 `parent_id` 作为 canonical `parent_region_id` 的默认来源，但仍需映射层兜底。

### 2.7 当前还存在的名称层风险

名称不能直接作为正式主键使用，证据如下：

1. 同名单位大量存在，例如：
   - `区财政局` 出现 20 次
   - `区市场监督管理局` 出现 20 次
   - `区发展和改革委员会` 出现 19 次
2. `reports.unit_name` 与 `regions.name` 不一致的记录有 2831 条。
3. 例如：
   - `区发展和改革委员会` 的 `unit_name` 可能是完整长名，也可能混入来源页标题、下划线、附带辖区名。
   - `区人民政府办公室` 的 `unit_name` 可能直接是“上海市黄浦区”。

结论：

1. 正式口径不能依赖 `unit_name` 反推单位。
2. 正式底座必须以 `region_id` 为主键，以 canonical mapping 负责 `unit_type / parent_region_id / canonical_name`。

---

## 三、canonical `unit_type` 设计

### 3.1 建议冻结的 `unit_type` 枚举

| `unit_type` | 是否进入正式报告消费 | 业务定义 | 当前自动识别可行性 |
| --- | --- | --- | --- |
| `province` | 否 | 仅用于树根挂载的省级节点 | 高 |
| `city` | 是 | 地级市或直辖市本级节点 | 高 |
| `district` | 是 | 区、县、县级市、直辖市市辖区 | 高 |
| `department` | 是 | 市/区县/功能区所属部门、委办局、群团、直属机构等 | 高，但需扩展关键词 |
| `town_street` | 是 | 镇、乡、街道及街道办事处 | 高 |
| `functional_zone` | 是 | 经济技术开发区、高新区、园区、新区、示范区、商务区、保税区等功能区 | 中高，需要处理“新区/高新区”歧义 |
| `unknown` | 否 | 当前规则无法稳定归类的实体 | 必须人工确认 |

### 3.2 为什么建议保留 `province`

虽然正式报告分析主体是“地市-区县-部门”，但当前 `regions` 树根中真实存在省级节点：

1. 江苏省
2. 浙江省
3. 安徽省

若完全不保留 `province`：

1. 正常地级市的父级就会丢失；
2. `parent_region_id` 会在 city 层出现两种语义（有的为 null，有的为省）；
3. 后续做跨省数据扩展会再次返工。

因此建议：

1. `province` 作为 canonical registry 中的支撑型枚举保留；
2. 但不进入正式报告主消费口径；
3. 正式报表/API 默认不返回 `province` 行。

### 3.3 各类 `unit_type` 的业务定义与判断依据

| `unit_type` | 业务定义 | 自动判断依据 | 需人工兜底的情况 |
| --- | --- | --- | --- |
| `city` | 地级市或直辖市本级 | 根节点且名称为`*市`；或父级为省且名称为`*市` | 极少 |
| `district` | 区、县、县级市、直辖市市辖区 | 名称后缀为`区/县/旗`；或父级为地市且名称后缀为`市`；或直辖市父级下的`*区/浦东新区` | “新区”类需区分是行政区还是功能区 |
| `department` | 部门、委办局、群团、直属机构 | 包含/后缀为`委员会/局/办/办公厅/办公室/中心/馆/所/院/分局/总社/残联/妇联/人行/...` | 短名称、截断名称、历史简称 |
| `town_street` | 镇、乡、街道、街道办事处 | 后缀`镇/乡/街道`，或名称含`街道办事处` | 极少 |
| `functional_zone` | 开发区/高新区/园区/示范区/商务区/新区等 | 名称包含`开发区/高新区/园区/产业园/软件园/科技园/商务区/...`；或含`管委会`且明显对应功能区 | `新区`、复合括号名称、区内管委会 |
| `unknown` | 无法稳定归类 | 不满足以上规则 | 必须人工处理 |

### 3.4 建议的分类优先级与冲突处理规则

建议冻结如下优先级：

1. **人工映射覆盖一切**
   - 若 `canonical_units` 中存在手工确认结果，则直接采用。
2. **直辖市/特殊白名单规则优先**
   - 例如 `浦东新区` 应识别为 `district`，不能被 `新区` 规则误判为 `functional_zone`。
3. **`town_street` 优先于 `department`**
   - 因为很多“街道办事处”也带“办”字，不能误判成部门。
4. **明显功能区优先于部门**
   - 例如 `南通市经济技术开发区管委会` 虽带“管委会”，但本体仍应是 `functional_zone`。
5. **`department` 优先于 `district`**
   - 例如 `市发展和改革委员会` 即便与直辖市区县同层，也应先识别为部门。
6. **`district` 与 `city` 需结合父级判断**
   - 名称后缀为 `市` 的实体，若父级为省则是 `city`；若父级为地市，则通常是县级市，归入 `district`。
7. **无法稳定识别则落 `unknown`**
   - 不允许系统默默猜成 `district`。

### 3.5 自动识别策略建议

建议采用“两层自动识别 + 一层人工兜底”：

#### 第一层：结构规则

优先使用：

1. `region_id`
2. `parent_id`
3. 父级是否为省级根节点
4. 是否为直辖市场景

#### 第二层：名称规则

使用冻结后的关键字/后缀规则：

1. 行政区：`区/县/旗/县级市`
2. 镇街：`镇/乡/街道/街道办事处`
3. 功能区：`开发区/高新区/园区/产业园/科技园/商务区/示范区/...`
4. 部门：`委员会/局/办/办公厅/办公室/中心/馆/所/院/分局/残联/妇联/总社/...`

#### 第三层：人工映射

当出现以下情况时必须人工确认：

1. 名称截断，如 `区医疗保障`
2. 非标准简称，如 `人行`
3. 场/农场/林场/原种场等边界单位
4. 复合体，如 `高新区（如城街道、城南街道）`
5. 同时具有功能区与街道语义的组合名称

### 3.6 自动识别覆盖度评估

基于当前 1909 条 `regions` 样本做的试分类结果：

1. 自动识别可稳定覆盖 1904 条。
2. 仅 5 条落入 `unknown`：
   - 770 `人民银行宿迁市分行`
   - 856 `昆沭高新园`
   - 1084 `泗阳棉花原种场`
   - 1085 `泗阳农场`
   - 2434 `区医疗保障`

这说明当前库内实体并非“完全无法自动归类”，而是：

1. 大面上可以规则识别；
2. 小面上需要人工映射表冻结。

### 3.7 建议的人工兜底策略

建议新增 `canonical_units`（或 `region_analysis_mapping`）表，至少包含：

| 字段 | 用途 |
| --- | --- |
| `region_id` | 绑定 `regions.id` |
| `canonical_name` | 正式展示名 |
| `unit_type` | 冻结后的 canonical 类型 |
| `parent_region_id` | 冻结后的 canonical 父级 |
| `city_region_id` | 所属地市/直辖市 id，便于直接聚合 |
| `mapping_source` | `auto` / `manual` / `imported` |
| `rule_code` | 自动识别命中的规则编号 |
| `confidence` | `high` / `medium` / `low` |
| `effective_from_year` | 允许未来处理历史组织变更 |
| `effective_to_year` | 同上 |
| `mapping_version` | 冻结版本号 |
| `notes` | 人工说明 |
| `reviewed_by/reviewed_at` | 审计追踪 |

---

## 四、`parent_region_id` 设计

### 4.1 设计原则

建议冻结如下原则：

1. `parent_region_id` 表达的是**canonical 直接父级**，不是 `level-1` 推断结果。
2. `parent_region_id` 的默认来源是 `regions.parent_id`。
3. 但正式消费层中使用的，必须是**canonical 映射表确认后的父级**。
4. `parent_region_id` 应存原始 `region_id` 数值，不再沿用 `city_123 / district_456` 这类旧前缀字符串。
5. 允许极少量人工 override，但 override 应写入映射表，不允许散落在业务代码。

### 4.2 对现有 `regions.parent_id` 的可信度判断

结论：**可复用，但不能裸奔**。

原因：

1. 结构完整性强：1905 条父子关系，仅 3 条层差异常。
2. 数据库中不存在大面积孤儿节点。
3. 大多数样本的父级语义与真实业务挂载关系一致。
4. 当前主要问题是 `level` 与 `org_type` 失真，而不是 `parent_id` 大面积错误。

因此建议：

1. `regions.parent_id` 作为 canonical 生成的默认输入；
2. 通过 `canonical_units.parent_region_id` 冻结最终结果；
3. 正式消费层只读 canonical 结果，不直接读原始 `regions.parent_id`。

### 4.3 各类单位的推荐父级规则

| `unit_type` | 推荐 `parent_region_id` | 是否可直接沿用当前 `parent_id` | 备注 |
| --- | --- | --- | --- |
| `province` | `NULL` | 是 | 仅树根 |
| `city` | 正常地市保留省级父级；直辖市为 `NULL` | 是 | 同时建议额外提供 `city_region_id = self` |
| `district` | 所属地市或直辖市 | 是 | 例如黄浦区 -> 上海市，如皋市 -> 南通市 |
| `department` | 所属 city / district / functional_zone | 大多是 | 需以 canonical 单位而非 `level` 判断父级语义 |
| `town_street` | 默认所属 district；若当前父级本身是 `functional_zone`，则保留功能区父级 | 大多是 | 例如开发区下辖街道 |
| `functional_zone` | 所属 city 或 district | 大多是 | 直辖市特殊场景需按实际挂载确认 |
| `unknown` | 暂保留原始 `parent_id`，但 official 消费阻断 | 仅过渡 | 不能进入正式统计 |

### 4.4 为什么建议额外引入 `city_region_id`

仅有 `parent_region_id` 还不够高效，原因如下：

1. `department` 可能直接挂 city，也可能挂 district，也可能挂 functional_zone。
2. `town_street` 可能挂 district，也可能挂 functional_zone。
3. 领导驾驶舱、主报告聚合、重点单位画像都常常要“按所属地市”直接汇总。

因此建议在 canonical 映射层和 v2 消费层都增加：

| 字段 | 含义 |
| --- | --- |
| `city_region_id` | 该单位归属的顶层地市/直辖市 id |
| `city_name` | 便于直接展示和筛选 |

推荐规则：

1. `city`：`city_region_id = self`
2. `district`：向上追溯最近的 `city`
3. `department`：向上追溯所属 city
4. `town_street`：向上追溯所属 city
5. `functional_zone`：向上追溯所属 city

### 4.5 是否需要独立中间映射层

结论：**需要**。

原因：

1. `regions` 当前没有 `unit_type` 字段。
2. `regions.level` 无法承载正式业务类型。
3. `reports.unit_name` 不稳定，不能做正式主键。
4. 未来还可能出现历史组织变更、父级调整、名称修订。
5. 若不建立映射层，后续所有 worker、API、前端、AI payload 都会再次自行猜类型。

建议：

1. 新建 `canonical_units`（推荐）或 `region_analysis_mapping`
2. 把 `unit_type / parent_region_id / city_region_id / mapping_version` 固化在此层
3. `gov_open_annual_stats_v2` 只消费这一层，不再自己推断

---

## 五、`year` 正式口径设计

### 5.1 正式 `year` 定义

建议冻结：

1. `year` 的唯一正式来源是 `reports.year`
2. `year` 表示“该 `region_id` 对应年度报告的报告年份”
3. 正式消费层不再从 `gov_open_annual_stats.year` 的 null/非 null 状态反推是否有数据

### 5.2 为什么现有 `year` 口径不够安全

当前 `gov_open_annual_stats` 从 `regions LEFT JOIN reports` 出发（[src/db/migrations-llm.ts:601](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L601)），因此：

1. 只要 `regions` 中存在实体，即使没有 report，也会生成一行 stats 空壳
2. 这 866 个无报告实体全部以 `year = NULL` 出现在当前 stats 层
3. 前端又在 [frontend/src/govinsight/data.ts:43](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/data.ts#L43) 和 [69](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/data.ts#L69) 里自行过滤 invalid year
4. `/api/gov-insight/years` 当前是 `SELECT DISTINCT year FROM gov_open_annual_stats`（[src/routes/gov-insight.ts:317](/E:/Software%20Development/KIROGOVCOMPARE/src/routes/gov-insight.ts#L317)），本身也没有后端侧排除 null

结论：

1. 现在的 `year` 有“后端出空壳，前端再过滤”的责任错位。
2. 正式消费层必须后端一次性收口。

### 5.3 正式过滤规则

建议冻结以下规则：

1. `reports.year IS NOT NULL`
2. `reports.active_version_id IS NOT NULL`
3. `source_report_version_id` 必须能确定
4. `unit_type != 'unknown'`
5. `materialize_status in ('official', 'preview')` 中，正式报告默认只读 `official`

### 5.4 active report、published version、year 的绑定规则

当前库中已具备：

1. `reports(region_id, year)` 唯一约束（[src/db/migrations-llm.ts:786](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L786)、[796](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L796)）
2. `reports.active_version_id` 指向当前选中的版本（[255](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L255)）
3. `report_versions.review_status` 默认存在（[261](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L261)）

但当前现实数据里仍有 5 个 active version 是 `pending_review`，不是 `published`。

因此建议冻结如下源版本选择规则：

| 场景 | `source_report_version_id` 选择 | `materialize_status` | 是否进入 official |
| --- | --- | --- | --- |
| `active_version.review_status = 'published'` | 取 `active_version_id` | `official` | 是 |
| `active_version.review_status = 'pending_review'`，但存在已发布版本 | 取“最新 published 版本” | `official` | 是 |
| `active_version.review_status = 'pending_review'`，且无 published 版本 | 取 active version | `preview` | 否 |
| 无 active version / facts 缺失 / mapping 未定 | 不生成 official 行 | `blocked_*` | 否 |

### 5.5 多版本处理规则

当前 45 个 report 存在多版本。

正式口径建议：

1. `reports` 仍然是一年一单位一 report
2. `report_versions` 是该 report 的多解析/修订版本
3. 正式统计只允许一个明确的 `source_report_version_id`
4. 若要保留 preview 与 official 并行，应通过 `materialize_status` 区分，而不是让多个版本同时争用同一 official 行

### 5.6 是否需要 `stats_snapshot_at / source_report_version_id`

结论：**必须需要**。

建议至少保留：

| 字段 | 作用 |
| --- | --- |
| `source_report_id` | 溯源到 `reports` |
| `source_report_version_id` | 溯源到具体 source 版本 |
| `source_review_status` | 区分 official / preview |
| `source_state` | 记录 `parsed/manual_corrected/pending_review` |
| `stats_snapshot_at` | 明确本条统计是什么时间物化的 |
| `mapping_version` | 使用了哪一版单位口径 |
| `metric_version` | 使用了哪一版指标映射/聚合规则 |

### 5.7 主报告、区县清单、部门清单、重点单位画像的 `year` 是否必须一致

建议：**必须一致**。

原因：

1. 它们属于同一轮年度正式分析产物。
2. 若主报告用 2024，而部门画像混入 2025，会直接破坏所有排序、对比和附件解释。
3. 同一批次产物应共享：
   - `analysis_year`
   - `stats_snapshot_at`
   - `mapping_version`
   - `metric_version`

---

## 六、正式消费层 v2 设计

### 6.1 设计目标

`gov_open_annual_stats_v2` 的目标不是取代 facts 层，而是作为：

1. 面向正式报告与驾驶舱的**标准消费层**
2. 面向 AI 成文前的**稳定结构化输入层**
3. 面向审计与回溯的**可追踪物化结果层**

建议它是“表或可审计物化表”，而不是继续用一个只做拼接的视图。

### 6.2 设计建议：优先采用“正式物化结果表”

推荐形态：

1. `canonical_units`：冻结单位类型与父级关系
2. `gov_open_annual_stats_v2`：按 `region_id + year + source_report_version_id` 物化的正式消费表
3. 兼容期保留旧 `gov_open_annual_stats` 只读，不再新增业务依赖

不建议继续把 v2 设计成“直接从 `regions LEFT JOIN reports` 的 materialized view”，因为：

1. 无法天然排除 `year IS NULL`
2. 无法清晰区分 official / preview
3. 审计字段不够自然
4. 多版本选择逻辑会越来越复杂

### 6.3 v2 标识字段建议

| 字段 | 来源 | 是否正式计算必需 | 说明 |
| --- | --- | --- | --- |
| `region_id` | `canonical_units.region_id` | 是 | 正式单位主键 |
| `parent_region_id` | `canonical_units.parent_region_id` | 是 | canonical 父级 |
| `city_region_id` | `canonical_units.city_region_id` | 强烈建议 | 地市归属，便于直接聚合 |
| `unit_type` | `canonical_units.unit_type` | 是 | 正式单位类型 |
| `org_name` | `canonical_units.canonical_name`，无则 `regions.name` | 是 | 正式展示名 |
| `year` | `reports.year` | 是 | 正式报告年份 |
| `source_report_id` | `reports.id` | 是 | 审计追溯 |
| `source_report_version_id` | 版本选择结果 | 是 | 审计追溯 |

### 6.4 v2 正式指标字段建议

以下字段建议进入 v2，并作为**原始基数层**冻结。比率、排序、风险判断建议放规则层，不建议在 v2 中硬存。

#### 6.4.1 主体 raw 指标

| 字段 | 来源 | 用途 |
| --- | --- | --- |
| `reg_published` | `fact_active_disclosure(category='regulations').made_count` | 主报告/附件/驾驶舱 |
| `reg_active` | `fact_active_disclosure(...).valid_count` | 同上 |
| `reg_abolished` | `fact_active_disclosure(...).repealed_count` | 同上 |
| `doc_published` | `fact_active_disclosure(category='normative_documents').made_count` | 同上 |
| `doc_active` | `fact_active_disclosure(...).valid_count` | 同上 |
| `doc_abolished` | `fact_active_disclosure(...).repealed_count` | 同上 |
| `action_licensing` | `fact_active_disclosure(category='licensing').processed_count` | 同上 |
| `action_punishment` | `fact_active_disclosure(category='punishment').processed_count` | 同上 |
| `action_force` | `fact_active_disclosure(category='coercion').processed_count` | 同上 |
| `fees_amount` | `fact_active_disclosure(category='fees').amount` | 同上 |
| `app_new` | `fact_application(response_type='new_received')` | 申请量、同比、排序 |
| `app_carried_over` | `fact_application(response_type='carried_over')` | 结转率 |
| `app_carried_forward` | `fact_application(response_type='carried_forward')` | 下一年结转 |
| `source_natural` | `fact_application(applicant_type='natural_person')` | 申请来源结构 |
| `outcome_public` | `fact_application(response_type='granted')` | 实质公开率 |
| `outcome_partial` | `fact_application(response_type='partial_grant')` | 同上 |
| `outcome_not_open` | 各拒绝类汇总 | 风险、占比、结构 |
| `outcome_unable` | 各无法提供类汇总 | 风险、占比、结构 |
| `outcome_ignore` | 各不予处理类汇总 | 风险、占比、结构 |
| `outcome_other` | 其他处理汇总 | 边界说明 |
| `outcome_unable_no_info` | `unable_no_info` | “不掌握相关信息”占比 |
| `rev_total` | `fact_legal_proceeding(case_type='review', result='total')` | 复议规模 |
| `rev_corrected` | `... result='correct'` | 复议纠正率 |
| `lit_total` | 诉讼总量 | 诉讼规模 |
| `lit_corrected` | 诉讼纠正量 | 诉讼纠正率 |

#### 6.4.2 建议保留的兼容明细字段

为了兼容现有正式报告与后续规则层，建议 v2 保留当前 view 中已经存在的以下 detail 字段：

1. `outcome_not_open_state_secret`
2. `outcome_not_open_law_forbidden`
3. `outcome_not_open_danger`
4. `outcome_not_open_process`
5. `outcome_not_open_internal`
6. `outcome_not_open_third_party`
7. `outcome_not_open_enforcement`
8. `outcome_not_open_admin_query`
9. `outcome_complaint`
10. `outcome_ignore_repeat`
11. `outcome_publication`
12. `outcome_massive`
13. `outcome_confirm`
14. `outcome_overdue_correction`
15. `outcome_overdue_fee`
16. `outcome_other_reasons`

建议理由：

1. 这些字段在当前 view 已经存在，不增加事实抽取复杂度。
2. 后续规则服务需要基于这些 raw detail 计算风险标签，而不是只拿一层汇总结果。

### 6.5 建议不在 v2 中硬存的内容

以下内容建议留在规则层/metrics service，而不是 v2 表字段：

1. 同比
2. 占比
3. 结转率
4. 实质公开率
5. 纠正率
6. 风险等级
7. 风险标签
8. 重点单位排序

原因：这些都属于“规则计算结果”，不是原始事实层。

### 6.6 v2 审计与追溯字段建议

| 字段 | 作用 | 是否必需 |
| --- | --- | --- |
| `source_report_id` | 追溯到 `reports` | 是 |
| `source_report_version_id` | 追溯到具体 version | 是 |
| `source_review_status` | 区分 official / preview | 是 |
| `source_state` | 记录 `parsed/manual_corrected/pending_review` | 是 |
| `source_unit_name_raw` | 保留原始 `reports.unit_name` 供审计 | 建议 |
| `stats_snapshot_at` | 记录物化时间 | 是 |
| `materialize_status` | `official/preview/blocked_*` | 是 |
| `mapping_version` | 单位口径版本 | 是 |
| `metric_version` | 指标聚合版本 | 是 |
| `materialize_message` | 失败/阻断说明 | 建议 |

### 6.7 v2 适用场景

| 场景 | 是否直接使用 v2 | 说明 |
| --- | --- | --- |
| 市级主报告 | 是 | 主报告正文与附件都应从 v2 + 规则层出发 |
| 区县监测表 | 是 | 直接按 `unit_type='district'` |
| 部门监测表 | 是 | 直接按 `unit_type='department'` |
| 镇街/功能区监测 | 是 | 可按 `town_street` / `functional_zone` 单列 |
| 重点单位画像 | 是 | 先从 v2 取 raw facts，再进规则层和 AI |
| 领导驾驶舱 | 是 | 使用 `city_region_id + unit_type + year` 聚合 |

### 6.8 建议的唯一键与索引方向

建议冻结以下方向：

1. official 行唯一键：`(region_id, year, materialize_status)`，其中 `materialize_status='official'` 应至多一条
2. 常用索引：
   - `(year, unit_type)`
   - `(year, city_region_id, unit_type)`
   - `(source_report_version_id)`
   - `(materialize_status, year)`

---

## 七、真实样本核查结果

以下样本均来自真实数据库。  
“当前 `org_type`”指当前 `gov_open_annual_stats` 中对应实体的现状；若该实体没有正式 report，则可能只存在 `year=NULL` 空壳行。

### 7.1 主样本 18 条

| region_id | org_name | current level | current `org_type` | current parent_id | current year 覆盖 | 建议 `unit_type` | 建议 `parent_region_id` | 判断依据 | 置信度 |
| ---: | --- | ---: | --- | ---: | --- | --- | ---: | --- | --- |
| 720 | 宿迁市 | 2 | `city` | 715 | 2020-2025 | `city` | 715 | 省级根下地级市 | 高 |
| 1426 | 上海市 | 1 | `city`（仅 `year=NULL` 空壳） | `NULL` | 无 report；stats 仅空壳 | `city` | `NULL` | 直辖市根节点 | 高 |
| 2135 | 南通市 | 2 | `city` | 715 | 2023-2024 | `city` | 715 | 省级根下地级市 | 高 |
| 1427 | 黄浦区 | 2 | `city` | 1426 | 2021-2025 | `district` | 1426 | 直辖市下市辖区，不能因 `level=2` 判成 city | 高 |
| 1431 | 普陀区 | 2 | `city` | 1426 | 2019-2025 | `district` | 1426 | 同上 | 高 |
| 723 | 秦淮区 | 3 | `district` | 717 | 2024 | `district` | 717 | 南京市下辖区 | 高 |
| 2176 | 如皋市 | 3 | `district` | 2135 | 2021-2024 | `district` | 2135 | 县级市，分析口径应归 district 层 | 高 |
| 1662 | 市发展和改革委员会 | 2 | `city`（仅 `year=NULL` 空壳） | 1426 | 无 report；stats 仅空壳 | `department` | 1426 | 上海市级部门，与区县同层但语义不同 | 高 |
| 761 | 市残联 | 3 | `district` | 720 | 2021-2025 | `department` | 720 | 群团/直属机构，应按部门管理 | 中 |
| 2330 | 启东市交通局 | 4 | `district` | 2178 | 2021-2025 | `department` | 2178 | 县级市下辖部门 | 高 |
| 2594 | 区国防动员办公室 | 4 | `district` | 724 | 2023-2025 | `department` | 724 | 鼓楼区下辖部门 | 高 |
| 975 | 宿城区项里街道办事处 | 4 | `district` | 777 | 2021-2025 | `town_street` | 777 | 明确街道办事处 | 高 |
| 2349 | 启东市汇龙镇 | 4 | `district` | 2178 | 2021-2025 | `town_street` | 2178 | 明确镇级单位 | 高 |
| 2545 | 南京市秦淮区月牙湖街道办事处 | 4 | `district` | 723 | 2025 | `town_street` | 723 | 明确街道办事处 | 高 |
| 780 | 宿迁经济技术开发区 | 3 | `district` | 720 | 2024 | `functional_zone` | 720 | 典型开发区 | 高 |
| 825 | 淮安经济技术开发区 | 3 | `district` | 721 | 2021-2024 | `functional_zone` | 721 | 典型开发区 | 高 |
| 2182 | 南通市经济技术开发区管委会 | 2 | `city`（仅 `year=NULL` 空壳） | 2135 | 无 report；stats 仅空壳 | `functional_zone` | 2135 | 名称是开发区本体，不应因“管委会”或 `level=2` 判成 city/department | 高 |
| 2268 | 高新区（如城街道、城南街道） | 4 | `district` | 2176 | 2021-2025 | `functional_zone` | 2176 | 复合名称，主体仍是高新区 | 中 |

### 7.2 需人工映射关注样本 2 条

| region_id | org_name | current level | current `org_type` | current parent_id | current year 覆盖 | 建议 `unit_type` | 建议 `parent_region_id` | 判断依据 | 置信度 |
| ---: | --- | ---: | --- | ---: | --- | --- | ---: | --- | --- |
| 770 | 人民银行宿迁市分行 | 3 | `district` | 720 | 2021-2025 | `department`（建议） | 720 | 更像驻地金融机构/专项部门，需业务确认是否纳入部门口径 | 低 |
| 2434 | 区医疗保障 | 4 | `district`（仅 `year=NULL` 空壳） | 2180 | 无 report；stats 仅空壳 | `department`（建议） | 2180 | 名称疑似截断，可能本应为“区医疗保障局”或同类机构 | 低 |

### 7.3 样本核查得出的关键信号

1. 真实数据里已经存在 city / district / department / town_street / functional_zone 五类实体。
2. 区县、部门、镇街、功能区数据都不是“概念上想要”，而是数据库里已经有真实 `region_id + report + fact`。
3. 当前不能正式消费它们，主要是因为：
   - `unit_type` 未冻结
   - current stats 压扁
   - `year=NULL` 空壳混入
4. 绝大多数样本的 `parent_id` 可以直接沿用，只需 canonical 映射层确认。

---

## 八、兼容与迁移方案

### 8.1 是否直接替换现有 `gov_open_annual_stats`

结论：**不建议直接替换，建议并行新增 v2**。

原因：

1. 当前前后端、驾驶舱、AI 链路仍依赖旧 `gov_open_annual_stats`
2. 旧层含 `city_/district_` 前缀字符串、`year=NULL` 空壳、错误 `org_type`
3. 若直接原地改，会同时牵动：
   - API 出参
   - 前端实体树
   - 驾驶舱筛选
   - AI 报告链路

建议：

1. 保留旧层作为 `legacy`
2. 新增：
   - `canonical_units`
   - `gov_open_annual_stats_v2`
3. 新功能和新报告链路只接 v2

### 8.2 历史数据是否需要补跑

建议：**需要补跑，但分批进行**。

推荐顺序：

1. 先补跑 2021-2025
   - 这是当前可用数据主体
   - 已覆盖大量部门、镇街、功能区
2. 2019-2020 作为兼容补录
   - 当前样本非常少
   - 可在主链稳定后补齐

### 8.3 API 兼容策略

建议：

1. 旧 API 保持不动，避免本轮牵动业务。
2. 新增 v2 查询接口，或在后端加 feature flag。
3. 兼容层只做字段转换，不再做口径猜测。

推荐顺序：

1. 后端先提供 v2-only 内部接口
2. 驾驶舱与新报告生成先切 v2
3. 老前端页面最后再评估是否迁移或维持 legacy

### 8.4 前端、worker、驾驶舱如何切换

| 模块 | 当前依赖 | 建议切换方式 |
| --- | --- | --- |
| GovInsight 主页面 | 旧 `gov_open_annual_stats` | 新报表链路单独接 v2 |
| `aiReport` / 报告生成 worker | 旧 stats + 前端规则 | 改为后端读取 `gov_open_annual_stats_v2 + canonical_units` |
| 领导驾驶舱 | 当前仍有名称启发式 | 改为直接消费 `unit_type` 和 `city_region_id` |
| PDF/打印导出 | 取决于上游 payload | 上游换 v2 后基本无需重做 |

### 8.5 新旧口径如何对照校验

建议至少做三类对照：

1. **同口径字段一致性**
   - 对同一 `region_id + year`，比较 v1 与 v2 的 raw 指标是否一致
   - 仅允许因版本选择、published 过滤、`year=NULL` 排除造成的可解释差异
2. **单位分类差异**
   - 比较当前 `org_type` 与 canonical `unit_type`
   - 重点解释部门/镇街/功能区从 `district` 拆分出去后的数量变化
3. **样本抽检**
   - 至少对本报告列出的 20 条样本逐条确认

### 8.6 开工前必须先确认的事项

必须在实施前明确以下事项：

1. official 是否严格只吃 `review_status='published'`
2. preview 是否需要与 official 并存
3. `province` 是否只保留在 registry，不进入任何前端消费
4. `functional_zone` 是否作为正式一级独立类型保留
5. 复合实体（如 `高新区（如城街道、城南街道）`）是否统一按功能区处理
6. 人工映射的责任主体是谁
7. 首批人工确认名单范围是多少

### 8.7 哪些问题如果现在不解决，后续一定返工

1. 不冻结 `unit_type`，后续 rules service 必返工
2. 不冻结 `parent_region_id`，后续区县/部门/镇街聚合必返工
3. 不冻结 `year` 与 source version 选择，正式报告与驾驶舱无法共口径
4. 不设 `canonical_units` 映射层，后续每个模块都会继续各自猜类型
5. 不区分 official / preview，待审数据会混入正式分析

---

## 九、主要风险与待确认事项

### 9.1 已确认风险

| 风险 | 当前证据 | 影响 |
| --- | --- | --- |
| `level` 被误当实体类型 | `regions` 创建逻辑按父级深度递增 | 所有类型判断都可能错 |
| current stats 二元压缩 | `level<=2 => city`，否则 `district` | 区县/部门/镇街/功能区全部错分 |
| `year=NULL` 空壳混入 | 当前 stats 有 866 行空壳 | 会污染年份、单位列表、报告选择 |
| active version 不等于 official published | 当前有 5 个 active version 为 `pending_review` | 正式报告可能吃到待审数据 |
| 名称不可作主键 | 同名单位大量存在、`unit_name` 大量不一致 | 不能靠名称反推单位 |

### 9.2 尚不确定事项

以下事项本次可提出建议，但仍需业务确认：

1. `人民银行宿迁市分行` 是否纳入 `department`
2. `农场/林场/原种场` 是否需要新增独立类型，还是并入 `functional_zone/other`
3. `高新区（如城街道、城南街道）` 这类复合体是否统一视为功能区本体
4. `新区` 名称在更多城市中是否都能稳定区分行政区与功能区
5. 是否需要按年份维护 `effective_from_year / effective_to_year`

### 9.3 推荐的风险处理方式

1. 已知稳定类型先冻结
2. 灰区实体先入 `canonical_units` 手工映射
3. 对 `unknown` 保持阻断，不进入 official
4. preview 与 official 严格分流

---

## 十、建议冻结的正式口径清单

建议本次评审后直接冻结以下口径：

### 10.1 单位口径

1. 正式 `unit_type` 枚举：
   - `province`
   - `city`
   - `district`
   - `department`
   - `town_street`
   - `functional_zone`
   - `unknown`
2. `province` 为支撑型，不进入正式正文消费
3. `unknown` 为阻断型，不进入 official 消费

### 10.2 父级口径

1. `parent_region_id` 默认来自 `regions.parent_id`
2. 最终以 canonical 映射层结果为准
3. 不再使用 `city_123 / district_456` 前缀字符串作为正式父级标识
4. 补充 `city_region_id` 作为正式分析归属字段

### 10.3 年份口径

1. `year` 唯一来源为 `reports.year`
2. `year IS NULL` 行一律不进入正式消费
3. 同一分析批次的主报告、区县表、部门表、画像必须共享同一 `year`
4. 正式统计必须绑定 `source_report_version_id`

### 10.4 版本/审核口径

1. official 只吃 published 版本
2. pending review 只能进 preview，不进 official
3. 必须记录：
   - `source_report_version_id`
   - `mapping_version`
   - `metric_version`
   - `stats_snapshot_at`

### 10.5 消费层口径

1. 新增 `gov_open_annual_stats_v2`
2. 旧 `gov_open_annual_stats` 进入 legacy 维护状态
3. 新规则、新报告、新驾驶舱统一接 v2

---

## 十一、《如果这份方案通过评审，后续第一阶段实施可以直接启动的前提条件》

若本方案评审通过，第一阶段可以直接启动的前提条件建议如下：

1. `unit_type` 枚举确认并冻结
2. `parent_region_id` 规则确认并冻结
3. `city_region_id` 补充字段确认
4. `year` official 绑定规则确认
5. official / preview 边界确认
6. `canonical_units` 字段方案确认
7. `gov_open_annual_stats_v2` 字段范围确认
8. 首批人工映射名单确认
   - 至少覆盖本报告列出的低置信样本
   - 至少覆盖 `新区/高新区/园区/农场/林场/人行/截断名称` 这几类边界
9. 新旧口径验收方式确认
   - raw 指标差异如何解释
   - 单位分类差异是否允许
   - official published 缺失时是否允许 preview 显示

在以上条件具备后，第一阶段实施建议直接进入：

1. 建 canonical 映射层
2. 批量回填 `unit_type / parent_region_id / city_region_id`
3. 落地 `gov_open_annual_stats_v2`
4. 以 20 条样本 + 2024/2025 主数据做第一轮对账

---

## 附：本次方案设计直接依赖的关键证据位置

1. `regions.level` 按父级递增：
   - [src/routes/llm-regions.ts:12](/E:/Software%20Development/KIROGOVCOMPARE/src/routes/llm-regions.ts#L12)
   - [src/routes/llm-regions.ts:32](/E:/Software%20Development/KIROGOVCOMPARE/src/routes/llm-regions.ts#L32)
   - [src/routes/llm-regions.ts:39](/E:/Software%20Development/KIROGOVCOMPARE/src/routes/llm-regions.ts#L39)
2. 当前 `gov_open_annual_stats` 的 `city/district` 二元压缩：
   - [src/db/migrations-llm.ts:589](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L589)
   - [src/db/migrations-llm.ts:601](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L601)
   - [src/db/migrations-llm.ts:705](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L705)
   - [src/db/migrations-llm.ts:710](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L710)
   - [src/db/migrations-llm.ts:715](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L715)
3. facts 层已存在：
   - [src/db/migrations-llm.ts:388](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L388)
   - [src/db/migrations-llm.ts:404](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L404)
   - [src/db/migrations-llm.ts:417](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L417)
4. `reports(region_id, year)` 唯一性：
   - [src/db/migrations-llm.ts:786](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L786)
   - [src/db/migrations-llm.ts:796](/E:/Software%20Development/KIROGOVCOMPARE/src/db/migrations-llm.ts#L796)
5. 前端仍在做 year/org_type fallback：
   - [frontend/src/govinsight/data.ts:43](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/data.ts#L43)
   - [frontend/src/govinsight/data.ts:69](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/data.ts#L69)
   - [frontend/src/govinsight/data.ts:344](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/data.ts#L344)
6. 驾驶舱仍存在名称启发式类型识别：
   - [frontend/src/govinsight/leader-cockpit/selectors.ts:593](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/leader-cockpit/selectors.ts#L593)
   - [frontend/src/govinsight/leader-cockpit/selectors.ts:598](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/leader-cockpit/selectors.ts#L598)
   - [frontend/src/govinsight/leader-cockpit/selectors.ts:605](/E:/Software%20Development/KIROGOVCOMPARE/frontend/src/govinsight/leader-cockpit/selectors.ts#L605)
7. 当前 GovInsight API 仍直接读旧 stats：
   - [src/routes/gov-insight.ts:233](/E:/Software%20Development/KIROGOVCOMPARE/src/routes/gov-insight.ts#L233)
   - [src/routes/gov-insight.ts:317](/E:/Software%20Development/KIROGOVCOMPARE/src/routes/gov-insight.ts#L317)
   - [src/routes/gov-insight.ts:359](/E:/Software%20Development/KIROGOVCOMPARE/src/routes/gov-insight.ts#L359)
   - [src/routes/gov-insight.ts:411](/E:/Software%20Development/KIROGOVCOMPARE/src/routes/gov-insight.ts#L411)

