// import buble from '@rollup/plugin-buble'
import babel from 'rollup-plugin-babel'
import node from '@rollup/plugin-node-resolve'
import cjs from '@rollup/plugin-commonjs'
import { eslint } from 'rollup-plugin-eslint'
import uglify from 'rollup-plugin-uglify'
import pkg from './package.json'
// import ms from 'ms'
// ！！！注意：配置plugins项时，`babel()`务必写在`commonjs()`上面，否则会出现意想不到的错误
export default [
  // browser-friendly UMD build
  {
    input: 'src/player.js',
    output: {
      name: 'howLongUntilLunch',
      file: pkg.browser,
      format: 'umd'
    },
    plugins: [
      // buble({
      //   exclude: 'node_modules/**'
      // }),
      babel({
        babelrc: false, // 不使用外部babel配置
        exclude: 'node_modules/**',
        runtimeHelpers: true,
        // sourceMaps: true,
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
      }),
      node(), // so Rollup can find `ms`
      cjs(), // so Rollup can convert `ms` to an ES module
      eslint({
        exclude: [
          'src/styles/**'
        ]
      }),
      (process.env.NODE_ENV === 'production' && uglify())
    ]
  },

  // CommonJS (for Node) and ES module (for bundlers) build.
  // (We could have three entries in the configuration array
  // instead of two, but it's quicker to generate multiple
  // builds from a single configuration where possible, using
  // an array for the `output` option, where we can specify
  // `file` and `format` for each target)
  {
    input: 'src/main.js',
    // external: ['ms'],
    output: [
      { file: pkg.main, format: 'cjs' },
      { file: pkg.module, format: 'es' }
    ]
  }
]
