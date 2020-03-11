// import buble from '@rollup/plugin-buble'
import babel from 'rollup-plugin-babel'
import node from '@rollup/plugin-node-resolve'
import cjs from '@rollup/plugin-commonjs'
import { terser } from 'rollup-plugin-terser'
// import ms from 'ms'
// ！！！注意：配置plugins项时，`babel()`务必写在`commonjs()`上面，否则会出现意想不到的错误
export default [
  // browser-friendly UMD build
  {
    input: 'src/player.js',
    output: {
      name: 'video-player',
      file: 'dist/video-player.umd.js',
      format: 'umd'
    },
    plugins: [
      // buble({
      //   exclude: 'node_modules/* *'
      // }),
      node(), // so Rollup can find `ms`
      babel({
        babelrc: false, // 不使用外部babel配置
        exclude: 'node_modules/* *',
        runtimeHelpers: true,
        sourceMaps: true,
        presets: [
          require('@babel/preset-env')
        ],
        plugins: [
          require('@babel/plugin-proposal-class-properties'),
          require('@babel/plugin-syntax-dynamic-import'),
          require('@babel/plugin-transform-runtime') // Makes `rollup-plugin-babel` complain
        ],
        ignore: [
          'dist/* .js',
          'packages/* */* .js'
        ]
      }),
      cjs(), // so Rollup can convert `ms` to an ES module
      terser()
    ]
  },

  // CommonJS (for Node) and ES module (for bundlers) build.
  // (We could have three entries in the configuration array
  // instead of two, but it's quicker to generate multiple
  // builds from a single configuration where possible, using
  // an array for the `output` option, where we can specify
  // `file` and `format` for each target)
  {
    input: 'src/player.js',
    // external: ['ms'],
    output: [
      { file: 'dist/video-player.cjs.js', format: 'cjs' },
      { file: 'dist/video-player.min.js', format: 'cjs', plugins: [terser()] },
      { file: 'dist/video-player.esm.js' }
    ]
  }
]
