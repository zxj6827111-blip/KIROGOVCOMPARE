
const { querySqlite, sqlValue } = require('./dist/config/sqlite');

try {
    const permissions = JSON.stringify({
        manage_users: false,
        manage_cities: false,
        upload_reports: false,
        compare_reports: true
    });

    // Exact name "淮安市" is standard for cities in China
    const dataScope = JSON.stringify({
        regions: ["淮安市"]
    });

    const sql = `
        UPDATE admin_users 
        SET permissions = ${sqlValue(permissions)}, 
            data_scope = ${sqlValue(dataScope)} 
        WHERE username = 'huaian'
    `;

    console.log('Executing:', sql);
    querySqlite(sql);

    // Verify
    const verify = querySqlite("SELECT * FROM admin_users WHERE username = 'huaian'");
    console.log('Updated User:', JSON.stringify(verify, null, 2));

} catch (e) {
    console.error(e);
}
