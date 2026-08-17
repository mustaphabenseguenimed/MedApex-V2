import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart(),
    nitro({
      preset: "vercel",
      // tslib is pulled in transitively by @supabase/functions-js, but
      // Nitro's dependency tracer was leaving it external instead of
      // bundling it, so the deployed function couldn't find it at runtime
      // (ERR_MODULE_NOT_FOUND: Cannot find package 'tslib'). noExternals
      // forces it to be bundled directly into the output instead.
      noExternals: ["tslib"],
      traceDeps: ["tslib"],
    }),
    react(),
  ],
});