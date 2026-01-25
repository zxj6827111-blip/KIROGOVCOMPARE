/**
 * Test script to verify the include_children parameter works correctly
 */

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

async function testAPI() {
  console.log('Testing /api/gov-insight/annual-data with include_children parameter...\n');

  try {
    // Test 1: Fetch Huai'an city data WITHOUT children
    console.log('Test 1: Fetching Huai\'an data WITHOUT children');
    const url1 = `${API_BASE}/api/gov-insight/annual-data?org_id=city_320800`;
    const res1 = await fetch(url1, { credentials: 'include' });
    const data1 = await res1.json();
    console.log(`  - Status: ${res1.status}`);
    console.log(`  - Records count: ${data1.data?.length || 0}`);
    console.log(`  - Org IDs: ${[...new Set(data1.data?.map((r: any) => r.org_id))].join(', ')}\n`);

    // Test 2: Fetch Huai'an city data WITH children
    console.log('Test 2: Fetching Huai\'an data WITH children');
    const url2 = `${API_BASE}/api/gov-insight/annual-data?org_id=city_320800&include_children=true`;
    const res2 = await fetch(url2, { credentials: 'include' });
    const data2 = await res2.json();
    console.log(`  - Status: ${res2.status}`);
    console.log(`  - Records count: ${data2.data?.length || 0}`);
    
    // Group by org_name
    const orgMap = new Map();
    data2.data?.forEach((r: any) => {
      if (!orgMap.has(r.org_name)) {
        orgMap.set(r.org_name, []);
      }
      orgMap.get(r.org_name).push(r.year);
    });

    console.log(`  - Organizations found (${orgMap.size}):`);
    orgMap.forEach((years, name) => {
      console.log(`    * ${name}: ${years.join(', ')}`);
    });

    // Verify we got children
    const childrenCount = data2.data?.filter((r: any) => r.parent_id === 'city_320800').length || 0;
    console.log(`\n  - Children records: ${childrenCount}`);
    
    if (childrenCount > 0) {
      console.log('\n✅ SUCCESS: API correctly returns children data when include_children=true');
    } else {
      console.log('\n❌ FAILED: No children data returned');
    }

  } catch (err) {
    console.error('Error testing API:', err);
  }
}

testAPI();
