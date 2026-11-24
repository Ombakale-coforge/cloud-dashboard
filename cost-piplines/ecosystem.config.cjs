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
    {
      name: 'daily-cost-report-email',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'src/cron_manager_report.ts',
      cwd: __dirname,
      autorestart: false,
      cron_restart: '0 9 * * *', // Runs every day at 9:00 AM (server local time)
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'azure-daily-cost-burst-alerts',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'src/send_azure_daily_burst_alerts.ts',
      cwd: __dirname,
      autorestart: false,
      cron_restart: '30 9 * * *', // Runs every day at 9:30 AM (server local time)
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

