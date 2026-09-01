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
      // The AI extraction calls in questions.functions.ts allow up to 150s
      // per attempt (with retries), but Vercel's default function timeout
      // (10-15s, unconfigured otherwise) was killing conversion-tool
      // requests mid-chunk before they could finish. "max" resolves to
      // whatever the account's plan actually allows.
      vercel: {
        functions: {
          maxDuration: "max",
        },
      },
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
