import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.js",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
  },
  webServer: [
    {
      command: "node ../src/server.js",
      url: "http://127.0.0.1:4173/research",
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      env: { PORT: "4173" },
    },
    {
      command: "node hermes-fixture.js",
      url: "http://127.0.0.1:8644/health",
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      env: { PORT: "8644", FIXTURE: "hang" },
    },
    {
      command: "node hermes-fixture.js",
      url: "http://127.0.0.1:8645/health",
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      env: { PORT: "8645", FIXTURE: "reset" },
    },
    {
      command: "node ../src/server.js",
      url: "http://127.0.0.1:4174/health",
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      env: {
        PORT: "4174",
        GALION_LLM: "hermes",
        GALION_LLM_URL: "http://127.0.0.1:8644/v1/chat/completions",
        GALION_LLM_TIMEOUT_MS: "600",
      },
    },
    {
      command: "node ../src/server.js",
      url: "http://127.0.0.1:4175/health",
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      env: {
        PORT: "4175",
        GALION_LLM: "hermes",
        GALION_LLM_URL: "http://127.0.0.1:8645/v1/chat/completions",
        GALION_LLM_TIMEOUT_MS: "5000",
      },
    },
  ],
});
