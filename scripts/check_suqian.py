import psycopg2
import json

conn = psycopg2.connect(
    host="localhost",
    database="gov_report_diff",
    user="postgres",
    password="postgres"
)

cur = conn.cursor()

report_ids = [217, 218, 216, 9, 10]

# Simulate what the API does
cur.execute("""
    SELECT
        r.id as report_id,
        rv.id as version_id,
        rv.parsed_json,
        CASE
          WHEN rv.parsed_json IS NULL THEN false
          WHEN rv.parsed_json::text IN ('{}', 'null', '""') THEN false
          ELSE true
        END AS has_content_db,
        rv.check_total,
        rv.check_visual,
        rv.check_structure,
        rv.check_quality,
        rv.checks_updated_at
    FROM reports r
    JOIN report_versions rv ON rv.id = r.active_version_id
    WHERE r.id = ANY(%s)
""", (report_ids,))

rows = cur.fetchall()
print("API simulation:")
for row in rows:
    report_id = row[0]
    version_id = row[1]
    parsed_json = row[2]
    has_content_db = row[3]
    check_total = row[4]
    check_visual = row[5]
    check_structure = row[6]
    check_quality = row[7]
    checks_updated_at = row[8]
    
    checked = checks_updated_at is not None
    
    # Python type of has_content_db
    print(f"  report_id={report_id}")
    print(f"    has_content_db={has_content_db} (type={type(has_content_db).__name__})")
    print(f"    checked={checked}")
    print(f"    check_total={check_total}")
    
    # Check parsed_json structure
    if parsed_json:
        if isinstance(parsed_json, str):
            data = json.loads(parsed_json)
        else:
            data = parsed_json
        
        sections = data.get('sections', [])
        print(f"    sections_count={len(sections)}")
    else:
        print(f"    parsed_json=NULL")
    print()

cur.close()
conn.close()
