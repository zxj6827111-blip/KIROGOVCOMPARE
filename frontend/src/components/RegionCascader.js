
import React, { useState, useEffect, useMemo } from 'react';
import './RegionCascader.css';

/**
 * 4-level Cascading Region Selector
 * Province -> City -> District -> Department/Street
 * 
 * @param {Array} regions - Flat list of all regions
 * @param {string|number} value - Currently selected region ID
 * @param {function} onChange - Callback (id) => {}
 */
function RegionCascader({ regions = [], value, onChange }) {
    // Internal selection state
    const [level1, setLevel1] = useState(''); // Province / Top-level
    const [level2, setLevel2] = useState(''); // City
    const [level3, setLevel3] = useState(''); // District
    const [level4, setLevel4] = useState(''); // Department / Street

    // 1. Build Hierarchy Map for fast lookup
    const { regionMap, childrenMap, rootIds } = useMemo(() => {
        const rMap = new Map();
        const cMap = new Map();
        const roots = [];

        regions.forEach(r => {
            rMap.set(String(r.id), r);
            if (!cMap.has(String(r.id))) cMap.set(String(r.id), []);
        });

        regions.forEach(r => {
            if (r.parent_id) {
                const pid = String(r.parent_id);
                if (cMap.has(pid)) {
                    cMap.get(pid).push(r);
                } else {
                    // Parent might be missing or filtered out, treat as root if flexible?
                    // For now, only push if parent exists in cMap, else maybe root?
                    roots.push(r);
                }
            } else {
                roots.push(r);
            }
        });

        // Helper sort
        const sortFn = (a, b) => a.id - b.id;
        roots.sort(sortFn);
        cMap.forEach(list => list.sort(sortFn));

        return { regionMap: rMap, childrenMap: cMap, rootIds: roots.map(r => String(r.id)) };
    }, [regions]);

    // 2. Sync internal state when external `value` changes
    useEffect(() => {
        if (!value) {
            setLevel1('');
            setLevel2('');
            setLevel3('');
            setLevel4('');
            return;
        }

        const valStr = String(value);
        const target = regionMap.get(valStr);

        // If target not found in current regions list, do nothing or reset?
        if (!target) return;

        // Trace path upwards
        const path = [];
        let curr = target;
        while (curr) {
            path.unshift(String(curr.id));
            if (curr.parent_id && regionMap.has(String(curr.parent_id))) {
                curr = regionMap.get(String(curr.parent_id));
            } else {
                curr = null;
            }
        }

        // Assign to levels based on depth
        // Note: Data depth might vary. We fill L1->L4 sequentially.
        // If data uses specific levels (province=1, city=2), we could use r.level if available.
        // Assuming structure is consistent enough or just filling slots:
        setLevel1(path[0] || '');
        setLevel2(path[1] || '');
        setLevel3(path[2] || '');
        setLevel4(path[3] || '');

    }, [value, regionMap]);


    // 3. Handlers
    const handleChange = (level, id) => {
        let nextVal = id;

        if (level === 1) {
            setLevel1(id);
            setLevel2('');
            setLevel3('');
            setLevel4('');
            nextVal = id;
        } else if (level === 2) {
            setLevel2(id);
            setLevel3('');
            setLevel4('');
            if (!id) nextVal = level1; // Fallback to Level 1
        } else if (level === 3) {
            setLevel3(id);
            setLevel4('');
            if (!id) nextVal = level2; // Fallback to Level 2
        } else if (level === 4) {
            setLevel4(id);
            if (!id) nextVal = level3; // Fallback to Level 3
        }

        if (onChange) {
            onChange(nextVal);
        }
    };

    // Helper to render options
    const renderOptions = (parentId) => {
        const list = parentId
            ? childrenMap.get(String(parentId)) || []
            : rootIds.map(id => regionMap.get(id));

        return list.map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
        ));
    };

    const l1Options = rootIds.map(id => regionMap.get(id));
    const l2Options = level1 && childrenMap.get(level1) || [];
    const l3Options = level2 && childrenMap.get(level2) || [];
    const l4Options = level3 && childrenMap.get(level3) || [];

    return (
        <div className="region-cascader">
            {/* Level 1: Province */}
            <div className="region-select-wrapper">
                <select
                    className="region-select"
                    value={level1}
                    onChange={e => handleChange(1, e.target.value)}
                >
                    <option value="">-- 省/直辖市 --</option>
                    {l1Options.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
            </div>

            {/* Level 2: City */}
            <div className="region-select-wrapper">
                <select
                    className="region-select"
                    value={level2}
                    onChange={e => handleChange(2, e.target.value)}
                    disabled={!level1 && !level2} // Allow clearing if selected
                >
                    <option value="">-- 全市 (不限区县) --</option>
                    {l2Options.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
            </div>

            {/* Level 3: District */}
            <div className="region-select-wrapper">
                <select
                    className="region-select"
                    value={level3}
                    onChange={e => handleChange(3, e.target.value)}
                    disabled={!level2 && !level3}
                >
                    <option value="">-- 全区 (不限部门) --</option>
                    {l3Options.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
            </div>

            {/* Level 4: Dept / Street */}
            <div className="region-select-wrapper">
                <select
                    className="region-select"
                    value={level4}
                    onChange={e => handleChange(4, e.target.value)}
                    disabled={!level3 && !level4}
                >
                    <option value="">-- 部门/街道 (可选) --</option>
                    {l4Options.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
            </div>
        </div>
    );
}

export default RegionCascader;
