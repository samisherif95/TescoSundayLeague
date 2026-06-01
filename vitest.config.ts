import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Unit tests run in Node against pure logic + mocked Prisma/email/push.
// `vite-tsconfig-paths` wires up the `@/*` → `src/*` alias from tsconfig so
// test imports match the app's.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
