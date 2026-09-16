module.exports = {
  apps: ["voucher", "manager", "main", "economy", "statistics", "guard", "moderation"].map((r) => ({
    name: `roar-${r}`,
    script: "src/app.mjs",
    args: r,
    instances: 1,
    autorestart: true,
    max_memory_restart: "300M",
    env: {
      NODE_ENV: "production",
      UV_THREADPOOL_SIZE: "128",
    },
    error_file: `logs/${r}-error.log`,
    out_file: `logs/${r}-out.log`,
    node_args: "--expose-gc --max-old-space-size=512",
  })),
};
