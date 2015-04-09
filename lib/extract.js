var async = require('async');
var fs = require('fs');
var path = require('path');
var success = require('./util').success;

exports.paths = extractPaths;

function extractPaths(docker, imgId, paths, callback) {
  var tempContainer = null;

  return async.waterfall([
    makeTempContainer,
    extractPathsFromContainer,
    cleanupTempContainer
  ], callback);

  function makeTempContainer(next) {
    docker.createContainer({Image: imgId}, next);
  }

  function extractPathsFromContainer(container, callback) {
    var absolutePaths = paths.map(resolvePath);
    tempContainer = container;
    async.map(absolutePaths, async.apply(extractPath, container), callback);
  }

  function cleanupTempContainer(paths, next) {
    tempContainer.remove(function(err) {
      next(err, paths);
    });
  }
}

function resolvePath(pathSpec) {
  pathSpec.tar = path.resolve(pathSpec.tar);
  return pathSpec;
}

function extractPath(container, pathSpec, callback) {
  return async.waterfall([
    getTarStream,
    writeFile,
    success(pathSpec.tar),
  ], callback);

  function getTarStream(callback) {
    container.copy({Resource: pathSpec.path}, callback);
  }

  function writeFile(stream, callback) {
    var file = fs.createWriteStream(pathSpec.tar);
    console.error('extracting %s -> %s', pathSpec.path, pathSpec.tar);
    stream.pipe(file).on('finish', callback);
  }
}
