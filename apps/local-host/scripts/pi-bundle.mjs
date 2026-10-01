import { readFileSync } from "node:fs";

/** Pi's browser-safe OAuth loader needs static imports in a standalone Node Host. */
export const piBundlePlugin = {
  name: "bundle-pi-oauth",
  setup(builder) {
    builder.onLoad({ filter: /[\\/]auth[\\/]oauth[\\/]load\.js$/ }, args => {
      const source = readFileSync(args.path, "utf8");
      const contents = source.replace(/importOAuthModule\("\.\/([a-z-]+)\.ts"\)/g,
        (_, name) => 'import("./' + name + '.js")');
      if (source === contents) throw new Error("Pi OAuth loader changed; update the bundling adapter.");
      return { contents, loader: "js" };
    });
  },
};
export const piRequireBanner = "import { createRequire as piCreateRequire } from 'node:module';\nconst require = piCreateRequire(import.meta.url);";
