module.exports = {
  apps: [
    {
      name: 'middleware',
      script: 'server.js',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
