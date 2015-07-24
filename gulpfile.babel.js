var gulp       = require('gulp');
var path       = require('path');
var Promise    = require('bluebird')
var through2   = require("through2")
var map        = require("through2-map").obj
var reduce     = require("through2-reduce").obj
var _          = require('lodash')
var $          = require('gulp-load-plugins')();
var browserify = require("browserify")
var watchify   = require('watchify');
var source     = require('vinyl-source-stream')
var buffer     = require('vinyl-buffer')
var del        = require('del')
var hbs        = require('handlebars')

var dist = 'dist'
var app  = 'app'
var j    = path.join
var src  = gulp.src
var dest = gulp.dest
var assetManifest = {}


var imagemin = $.cache($.imagemin({
  progressive: true,
  interlaced: true
}), {
  key: file => {
    if (file.isBuffer())
      return [file.path, file.contents.toString('base64')].join('');
    return undefined;
  }
})


//var helpers = require(path.join(app, "helpers", "helpers.js"))(context);

hbs.registerHelper("assetFilesScss", revved => {

  var paths = assetManifest

  var a = Object.keys(paths).map(function(k) {
    var v = revved ? paths[k] : k;
    return "'" + v + "'";
  })
  return new hbs.SafeString(a.join(", "));

})

hbs.registerHelper("assetPath", key => {

  var paths = assetManifest
  return new hbs.SafeString(paths[key] || key);

})

hbs.renderSync = function renderSync(str, context) {
  context = context || {};

  try {
    var fn = (typeof str === 'function' ? str : hbs.compile(str, context));
    return fn(context);
  } catch (err) {
    return err;
  }
};


function images() {

  return src(j(app, 'images', '**', '*.{png,jpg,svg}'))
    .pipe(imagemin)
    .pipe($.rev())
    .pipe(dest(j(dist, 'images'))) // write revved images
    .pipe(collectManifest())
    .pipe(through2.obj(function(manifest, enc, cb) {
      _.merge(assetManifest, manifest)
      cb(null, manifest);
    }))

}

function styles() {

  return src(j(app, 'styles', '*.scss')) // render sass files first through handlebars
    .pipe($.changed('styles', {
      extension: '.scss'
    }))
    .pipe(through2.obj(function(file, enc, _cb) {
      var rendered = hbs.renderSync(file.contents.toString())
      //console.log(rendered)
      file.contents = new Buffer(rendered) // replaces imagepaths, for example
      file.path = file.path.replace(/\.scss$/,'.css')
      this.push(file) // push to the outer stream
      _cb();
    }))
    .pipe($.sass({
      sync: false,
      precision: 10,
      onError: console.error.bind(console, 'Sass error:')
    }))
    .pipe($.autoprefixer())
    //.pipe($.csso())
    .pipe($.rev())
    .pipe(dest(j(dist, 'styles'))) // write revved styles
    .pipe(collectManifest())
    .pipe(through2.obj(function(manifest, enc, cb) {
      _.merge(assetManifest, manifest)
      cb(null, manifest);
    }))
}

function scripts(config) {

  return browserify(j(app, 'scripts', 'main.js'))
    .bundle()
    .pipe(source('main.js'))
    .pipe(buffer())
    //.pipe($.uglify())
    .pipe($.rev())
    .pipe(dest(j(dist, 'scripts'))) // write revved scripts
    .pipe(collectManifest())
    .pipe(through2.obj(function(manifest, enc, cb) {
      _.merge(assetManifest, manifest)
      cb(null, manifest);
    }))

}

function html () {

  return src(j(app, '*.hbs'))
    .pipe(through2.obj(function(file, enc, _cb) {
      file.contents = new Buffer(hbs.renderSync(file.contents.toString())) // replaces imagepaths, for example
      file.path = file.path.replace(/\.hbs$/,'.html')
      this.push(file) // push to the outer stream
      _cb();
    }))
    //.pipe($.minifyHtml())
    .pipe(dest(dist))
}



///////////////////////////////
// TASKS FOR THE CLI //////////
///////////////////////////////


gulp.task('assets', gulp.series(images, gulp.parallel(styles, scripts), html))

gulp.task('clean', del.bind(del, [j(dist,'**','*')]))

gulp.task('default', () => {

  return Promise.promisify(gulp.series(
    'clean',
    'assets',
    cb => {
      console.log(assetManifest)
      cb()
    }
  ))()

});



function collectManifest(config) {

  var firstFile = null;
  var manifest = {};

  return through2.obj(function(file, enc, cb) {
    // ignore all non-rev'd files
    if (!file.path) {
      cb();
      return;
    }

    firstFile = firstFile || file;

    if (!file.revOrigPath) {
      manifest[relPath(firstFile.base, file.path)] = relPath(firstFile.base, file.path);

    } else {
      //console.log(file.revOrigBase, file.revOrigPath)
      manifest[relPath(file.revOrigBase, file.revOrigPath)] = relPath(firstFile.base, file.path);

    }

    cb();
  }, function(cb) {
    this.push(manifest);
    if(config) {
       config.paths = _.merge(config.paths, {assets: manifest});
    }
    cb();
  });

}

function relPath(base, filePath) {
  if (filePath.indexOf(base) !== 0) {
    return filePath.replace(/\\/g, '/');
  }

  var newPath = filePath.substr(base.length).replace(/\\/g, '/');

  if (newPath[0] === '/') {
    return newPath.substr(1);
  }

  return newPath;
}