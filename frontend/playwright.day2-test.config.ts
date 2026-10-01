import baseConfig from './playwright.config';

// Runs the V2 Day 2 fixture against the isolated local API on port 5018.
// Keep both the frontend URL and its proxy separate from the usual 4200/5017 pair.
export default {
  ...baseConfig,
  use: {
    ...baseConfig.use,
    baseURL: 'http://127.0.0.1:4201',
  },
  webServer: {
    ...baseConfig.webServer,
    command:
      'npm run start -- --host 127.0.0.1 --port 4201 --proxy-config src/proxy.day2-test.conf.json',
    url: 'http://127.0.0.1:4201',
    reuseExistingServer: false,
  },
};
