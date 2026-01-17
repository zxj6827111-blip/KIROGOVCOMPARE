
import { transformToEntity, RawDBRecord } from './adapter';
import { EntityProfile } from '../types';

// NOTE: To integrate with your existing system's apiClient, uncomment the line below 
// and ensure the path is correct (e.g. '../apiClient' if it is in src root).
// import apiClient from '../apiClient';

export const fetchGovernanceData = async (): Promise<EntityProfile[]> => {
  try {
    // 1. Call Backend Interface (Cloud PG API)
    // Using native fetch to avoid dependency on potentially missing 'apiClient' module causing import errors
    const response = await fetch('/api/gov-insight/annual-data', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // 'Authorization': 'Bearer ...' // Add token here if your legacy app requires it
      }
    });
    
    if (!response.ok) {
        console.warn(`GovInsight: API returned ${response.status}`);
        // Return empty to allow UI to show "No Data" or fallback to mock
        return [];
    }

    const data = await response.json();
    
    // Compatibility handling: API might return array directly or wrapped in { data: ... }
    const rawList: RawDBRecord[] = Array.isArray(data) ? data : (data.data || []);

    if (!rawList || rawList.length === 0) {
      console.warn("GovInsight: No data returned from API");
      return [];
    }

    // 2. Data Grouping: Flattened list -> Group by org_id
    const groups: { [key: string]: RawDBRecord[] } = {};
    
    rawList.forEach(record => {
      if (!groups[record.org_id]) {
        groups[record.org_id] = [];
      }
      groups[record.org_id].push(record);
    });

    // 3. Transform & Aggregate
    const profiles: EntityProfile[] = Object.values(groups)
      .map(records => transformToEntity(records))
      .filter((p): p is EntityProfile => p !== null);

    // 4. Handle Parent-Child Relationships
    const cities = profiles.filter(p => p.type === 'city');
    const districts = profiles.filter(p => p.type === 'district');
    
    cities.forEach(city => {
      // Simple logic: If Nanjing, mount all districts. 
      // In production, match by org_parent_id
      if (city.id === 'city_nanjing') {
        city.children = districts;
      }
    });

    return profiles;

  } catch (error) {
    console.error("GovInsight: API Fetch Error", error);
    throw error;
  }
};
