import path from "path";
import type { Configuration } from "webpack";

type Mode = Exclude<Configuration["mode"], undefined>;

const tsRule = {
  test: /\.ts$/,
  exclude: /node_modules/,
  use: [{ loader: "ts-loader" }],
};

/**
 * Desktop (Node.js) extension host bundle. VS Code extensions run in a Node.js
 * context on the desktop. 📖 https://webpack.js.org/configuration/node/
 */
const nodeConfig = (mode: Mode): Configuration => ({
  name: "extension",
  target: "node",
  mode,
  entry: "./src/extension.ts",
  output: {
    // 'main' in package.json points here.
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
  },
  externals: {
    vscode: "commonjs vscode", // created on-the-fly by the host; must stay external.
    // modules added here also need to be added in the .vscodeignore file
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: { rules: [tsRule] },
  devtool: "nosources-source-map",
  infrastructureLogging: { level: "log" },
});

/**
 * Web (Web Worker) extension host bundle for vscode.dev / github.dev (plan D-3).
 * `target: "webworker"` provides no Node builtins, so if any Node-only API (fs,
 * path, Buffer, …) leaks into the runtime graph webpack fails to resolve it here
 * — that build error IS the validation that the extension is web-safe. 'browser'
 * in package.json points at this bundle.
 */
const webConfig = (mode: Mode): Configuration => ({
  name: "web",
  target: "webworker",
  mode,
  entry: "./src/extension.ts",
  output: {
    path: path.resolve(__dirname, "dist", "web"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
  },
  externals: {
    vscode: "commonjs vscode",
  },
  resolve: {
    mainFields: ["browser", "module", "main"],
    extensions: [".ts", ".js"],
    // No Node core shims: the runtime is intentionally free of Node builtins.
    // Leaving fallback empty means an accidental Node import fails the build.
    fallback: {},
  },
  module: { rules: [tsRule] },
  devtool: "nosources-source-map",
  infrastructureLogging: { level: "log" },
});

const config = (_env: unknown, argv: { mode?: Configuration["mode"] }): Configuration[] => {
  const mode: Mode = argv.mode ?? "none";
  return [nodeConfig(mode), webConfig(mode)];
};

export default config;
