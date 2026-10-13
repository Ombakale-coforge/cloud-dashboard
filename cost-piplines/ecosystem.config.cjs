module.exports = {
  apps: [
    {
      name: 'cost-dashboard',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'src/server/index.ts',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
