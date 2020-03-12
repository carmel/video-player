# video-player
Modified version based on shaka
### compiled into different bundle that you need
+ For browsers:
```shell
# compile to a <script> containing a self-executing function ('iife')
$ rollup player.js --file bundle.js --format iife
```

+ For Node.js:
```shell
# compile to a CommonJS module ('cjs')
$ rollup player.js --file bundle.js --format cjs
```

+ For both browsers and Node.js:
```shell
# UMD format requires a bundle name
$ rollup player.js --file bundle.js --format umd --name "myBundle"
```