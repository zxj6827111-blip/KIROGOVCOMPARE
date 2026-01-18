import React, { useState, useEffect, useMemo } from 'react';
import './RegionCascader.css';

/**
 * 4-Level Region Cascader Component
 * @param {Object} props
 * @param {Array} props.regions - Flat list of all regions with id, parent_id, name, level
 * @param {string} props.value - Currently selected region ID
 * @param {Function} props.onChange - Callback (newRegionId) => void
 */
const RegionCascader = ({ regions, value, onChange }) => {
    // State for each level selection
    const [selections, setSelections] = useState({
        province: '',
        city: '',
        district: '',
        street: ''
    });

    // Build lookup maps for efficient access
    const { regionMap, childrenMap } = useMemo(() => {
        const rMap = new Map();
        const cMap = new Map();

        regions.forEach(r => {
            rMap.set(String(r.id), r);
            const pid = r.parent_id ? String(r.parent_id) : 'root';
            if (!cMap.has(pid)) cMap.set(pid, []);
            cMap.get(pid).push(r);
        });

        return { regionMap: rMap, childrenMap: cMap };
    }, [regions]);

    // Initialize selections based on incoming value
    useEffect(() => {
        if (!value) {
            setSelections({ province: '', city: '', district: '', street: '' });
            return;
        }

        const path = [];
        let current = regionMap.get(String(value));

        while (current) {
            path.unshift(current);
            if (current.parent_id) {
                current = regionMap.get(String(current.parent_id));
            } else {
                current = null;
            }
        }

        const newSelections = {
            province: '',
            city: '',
            district: '',
            street: ''
        };

        // Map path to levels based on depth (assuming hierarchy depth)
        // Or better: Assign based on path index since we traverse up to root
        // A typical path: Province -> City -> District -> Street

        if (path.length > 0) newSelections.province = String(path[0].id);
        if (path.length > 1) newSelections.city = String(path[1].id);
        if (path.length > 2) newSelections.district = String(path[2].id);
        if (path.length > 3) newSelections.street = String(path[3].id);

        setSelections(newSelections);
    }, [value, regionMap]);

    // Handle change at any level
    const handleChange = (level, id) => {
        const newSelections = { ...selections };

        if (level === 'province') {
            newSelections.province = id;
            newSelections.city = '';
            newSelections.district = '';
            newSelections.street = '';
        } else if (level === 'city') {
            newSelections.city = id;
            newSelections.district = '';
            newSelections.street = '';
        } else if (level === 'district') {
            newSelections.district = id;
            newSelections.street = '';
        } else if (level === 'street') {
            newSelections.street = id;
        }

        // Update internal state
        setSelections(newSelections);

        // Determine effective selected ID (the deepest selected level)
        let effectiveId = '';
        if (newSelections.street) effectiveId = newSelections.street;
        else if (newSelections.district) effectiveId = newSelections.district;
        else if (newSelections.city) effectiveId = newSelections.city;
        else if (newSelections.province) effectiveId = newSelections.province;

        onChange(effectiveId);
    };

    // Helper to get options for a level
    const getOptions = (parentId) => {
        return childrenMap.get(parentId ? String(parentId) : 'root') || [];
    };

    // We assume top level items have no parent_id or parent_id is null
    // But in some datasets they might be children of 'China' or similar. 
    // Based on previous BatchUpload.js, roots are those where parent_id is missing or not in map.
    // childrenMap uses 'root' for items with no parent_id.

    // Calculate options for each dropdown
    const provinceOptions = useMemo(() => {
        // Find roots: items with no parent or parent not in regions
        return regions.filter(r => !r.parent_id || !regionMap.has(String(r.parent_id)));
    }, [regions, regionMap]);

    const cityOptions = selections.province ? getOptions(selections.province) : [];
    const districtOptions = selections.city ? getOptions(selections.city) : [];
    const streetOptions = selections.district ? getOptions(selections.district) : [];

    return (
        <div className="region-cascader">
            <select
                className="cascader-select"
                value={selections.province}
                onChange={(e) => handleChange('province', e.target.value)}
                title="省/直辖市"
            >
                <option value="">省/直辖市</option>
                {provinceOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>

            <select
                className="cascader-select"
                value={selections.city}
                onChange={(e) => handleChange('city', e.target.value)}
                disabled={!selections.province}
                title="市"
            >
                <option value="">市</option>
                {cityOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>

            <select
                className="cascader-select"
                value={selections.district}
                onChange={(e) => handleChange('district', e.target.value)}
                disabled={!selections.city}
                title="区/县"
            >
                <option value="">区/县</option>
                {districtOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>

            <select
                className="cascader-select"
                value={selections.street}
                onChange={(e) => handleChange('street', e.target.value)}
                disabled={!selections.district}
                title="街道/镇"
            >
                <option value="">街道/镇</option>
                {streetOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
        </div>
    );
};

export default RegionCascader;
