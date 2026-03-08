module.exports = {
  apps: [
    {
      name: "attm-listener",
      script: "index.js",
      env: {
        NODE_ENV: "production",
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
