import js from "@eslint/js";
import ts from "typescript-eslint";

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { "allow": ["warn", "error", "info"] }]
    }
  },
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "apps/web/vite.config.ts",
      "eslint.config.js"
    ]
  }
);
