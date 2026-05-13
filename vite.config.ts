import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@mlightcad/libredwg-web/wasm/libredwg-web.wasm",
        replacement: path.resolve(
          __dirname,
          "node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm"
        )
      }
    ]
  }
});
