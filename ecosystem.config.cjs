module.exports = {
  apps: [
    {
      name: 'kirogovcompare-backend',
      cwd: '/opt/KIROGOVCOMPARE',
      script: 'dist/index-llm.js',
      interpreter: 'node',
      node_args: '-r dotenv/config',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '8787',
      },
      autorestart: true,
      max_memory_restart: '1G',
      time: true,
    },
    {
      name: 'kirogovcompare-frontend',
      cwd: '/opt/KIROGOVCOMPARE',
      script: 'scripts/serve-frontend.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        FRONTEND_HOST: '0.0.0.0',
        FRONTEND_PORT: '53002',
        FRONTEND_BUILD_DIR: '/opt/KIROGOVCOMPARE/frontend/build',
        BACKEND_ORIGIN: 'http://127.0.0.1:8787',
      },
      autorestart: true,
      max_memory_restart: '512M',
      time: true,
    },
  ],
};
