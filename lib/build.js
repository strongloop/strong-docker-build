var async = require('async');
var fnpm = require('fstream-npm');
var fstream = require('fstream');
var path = require('path');
var util = require('./util');
var tar = require('tar');

exports.packageStream = packageStream;
exports.listStream = listStream;
exports.image = buildImage;

// mimic 'npm pack' as an fstream
function packageStream(pkgPath) {
  return fnpm({path: pkgPath, type: 'Directory', isDirectory: true});
}

function listStream(files) {
  var root = path.dirname(files[0]);
  return fstream.Reader({path: root, root: root, filter: inFiles});

  function inFiles() {
    return this.path === root || files.indexOf(this.path) !== -1;
  }
}

function buildImage(docker, dockerfile, imgName, inputStream, callback) {
  return async.waterfall([
    startBuild,
    dumpStream,
    util.success(imgName),
  ], callback);

  function startBuild(callback) {
    var buildContext = createBuildContext(inputStream);
    var buildOpts = {dockerfile: dockerfile, t: imgName};
    docker.buildImage(buildContext, buildOpts, callback);
  }

  function dumpStream(stream, next) {
    docker.modem.followProgress(stream, onFinish, log);

    function onFinish(err) {
      next(err); // drop output
    }

    function log(event) {
      if (event.stream) {
        process.stderr.write(event.stream);
      }
    }
  }

  function createBuildContext(inputStream) {
    var buildContext = tar.Pack();
    var dockerfiles = path.resolve(__dirname, 'dockerfiles');
    buildContext.add(fstream.Reader(dockerfiles));
    return inputStream.pipe(buildContext);
  }
}
