// Allows overriding the web base path per build without editing app.json:
//   BASE_PATH=/compound-growth-chart pnpm exec expo export --platform web
// Without BASE_PATH, app.json's baseUrl (/mobile, for Replit) applies.
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    baseUrl: process.env.BASE_PATH ?? config.experiments?.baseUrl,
  },
});
