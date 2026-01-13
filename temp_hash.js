const crypto = require('crypto');

// Generate password hash for 'test1234'
const password = 'test1234';
const salt = 'a1b2c3d4e5f6a7b8';  // Fixed salt for simplicity
const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
console.log('Password hash for test1234:');
console.log(salt + ':' + hash);
