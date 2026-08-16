// Allows overriding the web base path per build without editing app.json:
//   BASE_PATH=/some-path pnpm exec expo export --platform web
// Defaults to the GitHub Pages sub-path (https://<user>.github.io/compound-growth-chart).
module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    baseUrl: process.env.BASE_PATH ?? config.experiments?.baseUrl,
  },
});
