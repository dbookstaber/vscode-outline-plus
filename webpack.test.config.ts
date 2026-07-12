import CopyWebpackPlugin from "copy-webpack-plugin";
import { glob } from "glob";
import path from "path";
import type { Configuration } from "webpack";

const testFilePaths = glob.sync("./src/test/**/*.test.ts");

const testConfig: Configuration = {
  name: "test",
  target: "node",
  mode: "none",

  // Flatten every test file to a single output directory (dist-tests/<name>.js)
  // using the basename as the bundle name. `path.basename` is separator-
  // agnostic, so this is deterministic on Windows and POSIX alike — unlike the
  // previous `testFilePath.replace("src/test/", "")`, which was a no-op on
  // Windows (glob returns backslash-separated paths there) and let bundles land
  // at unpredictable depths under dist-tests. A flat, single-depth layout lets
  // openSampleDocument resolve samples with one direct `path.join`.
  // (Test basenames are unique across the suite, so flattening is collision-free.)
  entry: Object.fromEntries(
    testFilePaths.map((testFilePath) => [
      path.basename(testFilePath, ".ts"),
      path.resolve(__dirname, testFilePath),
    ])
  ),

  output: {
    path: path.resolve(__dirname, "dist-tests"),
    filename: "[name].js",
    libraryTarget: "commonjs2",
  },

  externals: {
    vscode: "commonjs vscode",
  },

  resolve: {
    extensions: [".ts", ".js"],
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: "ts-loader" }],
      },
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [{ from: "src/test/samples", to: "samples" }],
    }),
  ],
  devtool: "source-map",
};

export default testConfig;
