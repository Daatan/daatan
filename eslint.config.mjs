import coreWebVitals from 'eslint-config-next/core-web-vitals'
import jsxA11y from 'eslint-plugin-jsx-a11y'

const config = [
  {
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'infra/**', 'next-env.d.ts', 'src/generated/**', 'prisma/generated/**'],
  },
  ...coreWebVitals,
  // eslint-config-next registers the jsx-a11y plugin (scoped to these files); recommended's
  // own plugin object is a different instance and ESLint rejects the redefinition, so take
  // only its rules.
  { files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'], rules: jsxA11y.flatConfigs.recommended.rules },
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'],
    settings: {
      // eslint-plugin-react's "detect" calls an API removed in ESLint 10 and crashes lint.
      // Keep in step with the installed React major.
      react: { version: '18.3.1' },
    },
    rules: {
      // React Compiler rules that eslint-plugin-react-hooks 7 (via eslint-config-next 16) turned
      // on as errors. They flag existing patterns, not new bugs; kept visible as warnings until
      // the React 19 step (#1938) decides which to fix and which to switch off.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='__html'] > CallExpression[callee.object.name='JSON'][callee.property.name='stringify']",
          message: 'Do not serialize data directly into dangerouslySetInnerHTML — JSON.stringify does not escape </script> (stored XSS). Render structured data through the <JsonLd> component, or use jsonLdSafe() from @/lib/jsonLd.',
        },
      ],
    },
  },
]

export default config
