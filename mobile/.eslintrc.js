module.exports = {
  root: true,
  extends: "@react-native",
  overrides: [
    {
      files: ["src/core/**/*.ts"],
      rules: {
        // core decodes bytes (base64/UTF-8, UUIDs) where bitwise ops are intended.
        "no-bitwise": "off",
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
