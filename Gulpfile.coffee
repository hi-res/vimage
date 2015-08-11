gulp 	    = require 'gulp'
coffeeify   = require 'gulp-coffeeify'
uglify 	    = require 'gulp-uglify'
rename 	    = require 'gulp-rename'
gulpif 	    = require 'gulp-if'
browserSync = require 'browser-sync'
ecstatic    = require 'ecstatic'

production  = process.env.NODE_ENV is 'production'

gulp.task 'scripts', ->

	gulp.src('src/vimage.coffee')
		.pipe(coffeeify(
			options: {
				debug: !production
				insertGlobals : true
				extensions: ['.coffee']
			}
		))
		.pipe gulpif production, uglify()
		.pipe gulpif production, rename('vimage.min.js')
		.pipe(gulp.dest('./build'))

gulp.task 'watch', ->

	gulp.watch('src/**/*.coffee', ['scripts'], browserSync.reload)

gulp.task 'server', ->

	require('http')
		.createServer ecstatic root: __dirname + '/'
		.listen 3000

gulp.task 'browser-sync', ->

	browserSync
		proxy: 'localhost:3000'
		notify: off

gulp.task('default', ['scripts', 'watch', 'server', 'browser-sync'])
gulp.task('build', ['scripts'])
