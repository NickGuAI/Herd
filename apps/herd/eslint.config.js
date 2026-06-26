import tseslint from 'typescript-eslint'

const colorAndFontContractRestrictedSyntax = [
  {
    selector: "Literal[value=/#[0-9a-fA-F]{3,6}\\b/]",
    message: 'Hex color literals are forbidden in apps/herd/{src,modules}/**/*.tsx — use a sumie/washi/ink/accent token. If the slot is missing, extend the palette in src/index.css + tailwind.config.ts. Allowlisted: charts (modules/telemetry/page.tsx), canvas (modules/rpg/**), xterm (modules/agents/page-shell/TerminalView.tsx).',
  },
  {
    selector: "Property[key.name='fontFamily']",
    message: "Inline `fontFamily:` overrides are forbidden — use Tailwind's `font-display` / `font-body` / `font-mono` classes.",
  },
  {
    selector: "ConditionalExpression[test.operator='==='][test.left.name='theme'][test.right.value='dark'][consequent.value=/^text-washi-white/]",
    message: "Do not branch dark mode to `text-washi-white`; use the semantic `text-sumi-black` / `text-sumi-diluted` token that auto-inverts.",
  },
]

export default [
  {
    ignores: ['dist/**', 'dist-server/**', 'node_modules/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {},
  },
  {
    files: ['src/**/*.tsx', 'modules/**/*.tsx'],
    ignores: ['**/__tests__/**'],
    rules: {
      'no-restricted-syntax': ['error', ...colorAndFontContractRestrictedSyntax],
    },
  },
  {
    files: [
      'modules/telemetry/page.tsx',
      'modules/telemetry/components/**/*.{ts,tsx}',
      'modules/agents/page-shell/TerminalView.tsx',
      'modules/rpg/screens/**/*.{ts,tsx}',
      // CommanderTileGrid renders an inline SVG data URL for the initials
      // avatar. When CSS tokens haven't resolved yet (pre-stylesheet-load),
      // it falls back to the literal light/dark Sumi-e scheme values from
      // docs/design-systems/sumi-e/COLOR_SCHEMES.md. The fallback pair is
      // necessary so dark-mode initials retain contrast during the brief
      // pre-style-load window. See codex-review feedback on PR #1423.
      'modules/org/components/CommanderTileGrid.tsx',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
]
