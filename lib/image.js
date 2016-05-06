// Copyright IBM Corp. 2015. All Rights Reserved.
// Node module: strong-docker-build
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

var async = require('async');
var docker = require('./lazy-docker');
var through = require('through');

exports.singleLayer = singleLayerImage;
exports.copy = copyFromContainerImage;
exports.start = startImage;

// Execut a command on an image, returning a new image of the result
function singleLayerImage(img, cmd, callback) {
  var containerConfig = {
    Image: img,
    Entrypoint: cmd,
    Cmd: null,
  };
  var imageConfig = {
    comment: 'Built by strong-docker-build',
    author: 'strong-docker-build@' + require('../package.json').version,
  };
  var container = null;
  var image = null;

  return async.waterfall([
    create,
    start,
    wait,
    commit,
    cleanup,
  ], function(err) {
    callback(err, image);
  });

  function create(next) {
    docker().createContainer(containerConfig, next);
  }

  function start(newContainer, next) {
    container = newContainer;
    container.start({}, next);
  }

  function wait(stream, next) {
    container.wait(next);
  }

  function commit(res, next) {
    container.commit(imageConfig, next);
  }

  function cleanup(img, next) {
    image = img;
    container.remove(next);
  }
}

// create new container from base image and paths from another container
function copyFromContainerImage(srcContainer, srcPaths, baseImage, callback) {
  var destContainer = null;
  var tarc = {
    AttachStdout: true,
    AttachStderr: true,
    Cmd: [
      'tar', '-cf-', '-C', '/',
    ].concat(srcPaths),
  };
  var tarx = {
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: true,
    OpenStdin: true,
    StdinOnce: true,
    Entrypoint: ['tar', '-C', '/', '-xvpf-'],
    Cmd: [],
    Image: baseImage,
  };
  var files = 0;
  var fileCounter = through(function count(d) {
    files += d.toString().split('\n').length - 1;
  });
  var bytes = 0;
  var tarPipe = through(function inc(d) {
    bytes += d.length;
    this.queue(d);
  });

  return async.series([
    injectBuild,
    extractBuild,
    wait,
  ], returnResults);

  function injectBuild(next) {
    async.waterfall([
      createTarX,
      attachTarX,
      startTarX,
    ], next);
  }

  function extractBuild(next) {
    async.waterfall([
      createTarC,
      startTarC,
      captureTarC,
    ], next);
  }

  function createTarX(next) {
    docker().createContainer(tarx, next);
  }

  function attachTarX(c, next) {
    destContainer = c;
    var attachOpts = {
      stdin: true,
      stdout: true,
      stderr: true,
      stream: true,
    };
    destContainer.attach(attachOpts, next);
  }

  function startTarX(stream, next) {
    docker().modem.demuxStream(stream, fileCounter, process.stdout);
    tarPipe.pipe(stream.req);
    destContainer.start(tarx, next);
  }

  function createTarC(next) {
    srcContainer.exec(tarc, next);
  }

  function startTarC(exec, next) {
    exec.start(tarc, next);
  }

  function captureTarC(stream, next) {
    docker().modem.demuxStream(stream, tarPipe, process.stdout);
    stream.on('end', function() {
      tarPipe.end();
    });
    next();
  }

  function wait(next) {
    destContainer.wait(next);
  }

  function returnResults(err) {
    callback(err, destContainer, {bytes: bytes, files: files});
  }
}

// create a container from an image suitable for running multiple execs on
function startImage(baseImage, env, callback) {
  var container = null;
  return async.waterfall([
    create,
    start,
    returnContainer,
  ], callback);

  function create(next) {
    var opts = {
      Image: baseImage,
      Cmd: ['sleep', '1000'],
      Env: env,
    };
    docker().createContainer(opts, next);
  }

  function start(c, next) {
    container = c;
    c.start(next);
  }

  function returnContainer(thing, next) {
    next(null, container, thing);
  }
}
