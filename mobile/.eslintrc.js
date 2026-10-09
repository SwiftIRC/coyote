module.exports = {
  root: true,
  extends: "@react-native",
  overrides: [
    {
      files: ["src/core/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              { group: ["react-native", "react-native-*", "@react-native*", "react", "../native/*", "../ui/*"],
                message: "core/ is pure: inject platform objects instead." },
            ],
          },
        ],
      },
    },
  ],
};
