var async = require('async');
var build = require('./lib/build');
var Docker = require('dockerode');
var extract = require('./lib/extract');

exports.buildSlimImage = buildSlimImage;

function buildSlimImage(opts, callback) {
  var docker = opts.docker || new Docker();
  opts.imgName = opts.imgName || 'strongloop/strong-app:slim';

  return async.waterfall([
    // install strong-supervisor and app using a full-featured image
    buildPackages,
    // extract strong-supervisor and app, with their addons compiled
    extractBuildArtifacts,
    // create new image based on a slim image (no dev tools) using the
    // pre-compiled strong-supervisor and app from the first image
    composeImage,
  ], callback);

  function buildPackages(callback) {
    console.log('Preparing binaries for container...');
    var dockerfile = 'dockerfiles/build.Dockerfile';
    var imgName = 'strongloop/builder:builder';
    var payload = build.packageStream(opts.appRoot);
    build.image(docker, dockerfile, imgName, payload, callback);
  }

  function extractBuildArtifacts(imgId, callback) {
    console.log('extracting artifacts from ', imgId);
    var paths = [
      {tar: 'app.tar', path: '/app'},
      {tar: 'global.tar', path: '/usr/local/'},
    ];
    extract.paths(docker, imgId, paths, callback);
  }

  function composeImage(files, callback) {
    console.log('composing app container...');
    var dockerfile = 'dockerfiles/compose.Dockerfile';
    var imgName = opts.imgName;
    var payload = build.listStream(files);
    build.image(docker, dockerfile, imgName, payload, callback);
  }
}
