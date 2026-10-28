import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * 分层规则（TECH_DESIGN §5.5）：
 * - core 只做纯 TS：无 Cocos / 微信 / DOM / IO / 网络 / 超越函数 / Math.random / Date.now。
 * - core 只被引用，不引用任何其他 workspace 包。
 * - client 的 app 层不直接调 wx.*，统一走 platform adapter。
 * - protocol 只放 DTO / 常量，不放业务逻辑；它可 type-only 引用 core。
 */
const CORE_RESTRICTED_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'process',
  'require',
];

const TRANSCENDENTAL_MATH = ['sin', 'cos', 'tan', 'exp', 'log', 'log2', 'log10', 'sqrt', 'pow'];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'client/**/library/**',
      'client/**/temp/**',
      'client/**/build/**',
      'client/**/profiles/**',
      'client/**/native/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'off',
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...CORE_RESTRICTED_GLOBALS],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'core 必须由调用方注入 Rng（AGENTS §3.2）' },
        { object: 'Date', property: 'now', message: 'core 的时间由调用方传入 EpochMs（AGENTS §3.1）' },
        {
          object: 'performance',
          property: 'now',
          message: 'core 的时间由调用方传入 EpochMs（AGENTS §3.1）',
        },
        ...TRANSCENDENTAL_MATH.map((property) => ({
          object: 'Math',
          property,
          message: 'core 禁止超越函数参与数值（PITFALLS P-024）',
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['cc', 'cc/*'], message: 'core 不得依赖 Cocos' },
            { group: ['wx', 'wx/*'], message: 'core 不得依赖微信 API' },
            {
              group: ['node:*', 'fs', 'path', 'http', 'https', 'net', 'ws', 'crypto'],
              message: 'core 不得做 IO / 网络 / 平台调用',
            },
            {
              group: ['@petbattle/protocol', '@petbattle/sim', '@petbattle/server'],
              message: 'core 只被引用，不引用其他包',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/protocol/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['cc', 'cc/*'], message: 'protocol 不得依赖 Cocos' },
            { group: ['wx', 'wx/*'], message: 'protocol 不得依赖微信 API' },
            {
              group: ['node:*', 'fs', 'path', 'http', 'https', 'net', 'ws'],
              message: 'protocol 只放 DTO / 常量，不得做 IO / 网络',
            },
            {
              group: ['@petbattle/sim', '@petbattle/server'],
              message: 'protocol 只能依赖 @petbattle/core 的类型',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['client/**/scripts/app/**/*.ts', 'client/**/scripts/**/app/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'wx', message: 'app 层走 platform adapter' }],
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['wx', 'wx/*'], message: 'app 层走 platform adapter' }] },
      ],
    },
  },
);
