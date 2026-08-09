/** @type {import('stylelint').Config} */
const config = {
  extends: ['stylelint-config-standard'],
  rules: {
    'color-function-notation': null,
    'color-no-hex': true,
    'custom-property-pattern': '^sv-[a-z0-9-]+$',
    'declaration-block-single-line-max-declarations': null,
    'media-feature-range-notation': null,
    'no-descending-specificity': null,
    'selector-class-pattern': [
      '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$',
      { message: 'Use kebab-case with one optional BEM modifier.' },
    ],
    'selector-pseudo-class-no-unknown': [
      true,
      { ignorePseudoClasses: ['global'] },
    ],
  },
  overrides: [
    {
      files: ['src/styles/tokens.css'],
      rules: {
        'color-no-hex': null,
      },
    },
  ],
}

export default config
