module.exports = {
  apps: [{
    name: 'stremio-addon',
    script: 'index.js',
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 7000,
      // Thêm PUBLIC_URL nếu dùng ngrok/cloudflare
      // PUBLIC_URL: 'https://your-domain.com'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
