module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.[jt]sx?$': [
      'babel-jest',
      {
        presets: ['@babel/preset-env', '@babel/preset-react', '@babel/preset-typescript'],
      },
    ],
    '^.+\\.mjs$': [
      'babel-jest',
      {
        presets: ['@babel/preset-env'],
      },
    ],
  },
  // Shiki ships ESM-only (.mjs); let Babel transform it and its ESM dependency
  // chain so renderer code can execute in Jest.
  transformIgnorePatterns: [
    '/node_modules/(?!@shikijs/|oniguruma|regex|hast-util|mdast-util|unist-util|property-information|space-separated-tokens|comma-separated-tokens|stringify-entities|character-entities|html-void-elements|ccount|zwitch|escape-string-regexp|decode-named-character-reference|trim-lines|devlop)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node', 'mjs'],
};
