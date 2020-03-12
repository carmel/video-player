// const Player = require('..')
// const p = new Player(document.getElementById('video'))
// p.load()
const gulp = require('gulp')

const browserSync = require('browser-sync').create()

const babel = require('gulp-babel')

const reload = browserSync.reload

gulp.task('browser-sync', ['es2015'], function() {
  browserSync.init({ server: './' })
  gulp.watch('./src/*.js', ['es2015'])
  gulp.watch('./src/*').on('change', reload)
})

gulp.task('es2015', function() {
  return gulp.src('./src/*.js').pipe(babel()).pipe(gulp.dest('./dist'))
})

gulp.task('default', ['browser-sync'])
