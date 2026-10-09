module.exports = {
  preset: "@react-native/jest-preset",
  roots: ["<rootDir>/test"],
  // Babel helpers injected into the web lib (outside rootDir) resolve from this app.
  modulePaths: ["<rootDir>/node_modules"],
  testMatch: ["**/*.test.ts"],
  // Transform the web lib (outside rootDir) with this project's babel config.
  transform: { "^.+\\.[jt]sx?$": ["babel-jest", { configFile: require.resolve("./babel.config.js") }] },
  transformIgnorePatterns: ["node_modules/(?!(react-native|@react-native|js-sha256)/)"],
};
