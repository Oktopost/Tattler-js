var gulp = require('gulp');
var concat = require('gulp-concat');
var rename = require('gulp-rename');
var uglify = require('gulp-uglify');

var TATTLER_JS = 'src/Tattler-js/tattler.js';
var SOCKET_IO = 'node_modules/socket.io-client/dist/socket.io.js';

var ALL_FILES = [
	TATTLER_JS,
	SOCKET_IO
];

var build = function () {
	gulp.src(TATTLER_JS)
		.pipe(concat('tattler.min.js'))
		.pipe(uglify())
		.pipe(gulp.dest('dist'));
};


gulp.task('build', function () {
	build();
});