#!/usr/bin/env node
"use strict";

// npm does not enforce packageManager by itself. Lifecycle scripts can still be
// bypassed by --ignore-scripts; CI additionally rejects competing lockfiles.
const agent = process.env.npm_config_user_agent ?? "";
if (!agent.startsWith("pnpm/")) {
  process.stderr.write(
    "\nThis project uses pnpm@9.15.4 workspaces, not npm or yarn.\n" +
    "Run: corepack enable && corepack prepare pnpm@9.15.4 --activate && pnpm install\n" +
    "If you already ran npm install, remove package-lock.json and reinstall with pnpm.\n\n",
  );
  process.exitCode = 1;
}
