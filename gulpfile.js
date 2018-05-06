var gulp = require('gulp');
var concat = require('gulp-concat');
var rename = require('gulp-rename');
var uglify = require('gulp-uglify');


var PATH = 'src/Tattler-js/';

var ALL_FILES = [
	PATH + 'Tattler.js'
];


var build = function () {
	gulp.src(ALL_FILES)
		.pipe(concat('tattler.min.js'))
		.pipe(uglify())
		.pipe(gulp.dest('dist'));
};


gulp.task('build', function () {
	build();
});