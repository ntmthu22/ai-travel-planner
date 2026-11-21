import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "dist", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The browser script: plain JavaScript, only browser globals it really uses.
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        fetch: "readonly",
        location: "readonly",
        history: "readonly",
        crypto: "readonly",
        structuredClone: "readonly",
        URLSearchParams: "readonly",
      },
    },
  },
);
