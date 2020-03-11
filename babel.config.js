module.exports = {
  presets: [
    require('@babel/preset-env')
  ],
  plugins: [
    require('@babel/plugin-proposal-class-properties'),
    require('@babel/plugin-syntax-dynamic-import'),
    require('@babel/plugin-transform-runtime') // Makes `rollup-plugin-babel` complain
  ],
  ignore: [
    'dist/*.js',
    'packages/**/*.js'
  ]
}
