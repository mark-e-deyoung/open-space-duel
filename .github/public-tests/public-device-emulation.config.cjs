const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: /public-device-emulation\.spec\.cjs/,
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.DEPLOYED_BASE_URL || 'https://mark-e-deyoung.github.io/open-space-duel/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'iphone13-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'pixel7-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
