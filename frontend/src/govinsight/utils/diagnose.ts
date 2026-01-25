// 临时数据诊断工具 - 用于检查区县数据加载情况
// 使用方法: 在浏览器控制台运行 window.diagnoseDistrictData()

import { EntityProfile } from '../types';

export const diagnoseDistrictData = (entity: EntityProfile | null) => {
    if (!entity) {
        console.error('[Diagnose] No entity provided');
        return;
    }

    console.group('%c🔍 区县数据诊断报告', 'font-size: 16px; font-weight: bold; color: #2563eb;');

    console.log('%c1. 实体基本信息', 'font-weight: bold; color: #059669;');
    console.table({
        '实体ID': entity.id,
        '实体名称': entity.name,
        '实体类型': entity.type,
        '自身数据年份数': entity.data?.length || 0,
        '子实体数量': entity.children?.length || 0,
    });

    if (entity.data && entity.data.length > 0) {
        console.log('%c2. 自身年度数据', 'font-weight: bold; color: #059669;');
        console.table(entity.data.map(d => ({
            年份: d.year,
            新收: d.applications?.newReceived,
            受理: d.applications?.totalHandled,
            公开: d.applications?.outcomes?.public,
            部分公开: d.applications?.outcomes?.partial,
            复议总数: d.disputes?.reconsideration?.total,
            复议纠错: d.disputes?.reconsideration?.corrected,
        })));
    }

    if (entity.children && entity.children.length > 0) {
        console.log('%c3. 子实体数据概览', 'font-weight: bold; color: #059669;');

        const childrenSummary = entity.children.map(child => ({
            ID: child.id,
            名称: child.name,
            类型: child.type,
            '数据年份数': child.data?.length || 0,
            '最新年份': child.data && child.data.length > 0
                ? Math.max(...child.data.map(d => d.year))
                : '无',
            '有数据': child.data && child.data.length > 0 ? '✅' : '❌',
        }));

        console.table(childrenSummary);

        const withData = entity.children.filter(c => c.data && c.data.length > 0);
        const withoutData = entity.children.filter(c => !c.data || c.data.length === 0);

        console.log(`%c📊 统计: ${withData.length}/${entity.children.length} 个子实体有数据`,
            'font-size: 14px; color: #0891b2;');

        if (withoutData.length > 0) {
            console.warn('%c⚠️ 以下子实体缺少数据:', 'color: #dc2626; font-weight: bold;');
            withoutData.forEach(c => console.warn(`  - ${c.name} (${c.id})`));
        }

        // 详细检查第一个有数据的子实体
        if (withData.length > 0) {
            const sample = withData[0];
            console.log(`%c4. 样本子实体详细数据 (${sample.name})`, 'font-weight: bold; color: #059669;');
            console.table(sample.data?.map(d => ({
                年份: d.year,
                新收: d.applications?.newReceived,
                受理: d.applications?.totalHandled,
                公开: d.applications?.outcomes?.public,
                部分公开: d.applications?.outcomes?.partial,
                复议总数: d.disputes?.reconsideration?.total,
                复议纠错: d.disputes?.reconsideration?.corrected,
            })));
        }
    } else {
        console.warn('%c⚠️ 该实体没有子实体', 'color: #dc2626;');
    }

    console.groupEnd();
};

// 挂载到window对象供浏览器控制台调用
if (typeof window !== 'undefined') {
    (window as any).diagnoseDistrictData = diagnoseDistrictData;
}
