var Docker = require('dockerode');
var async = require('async');
var through = require('through');

var docker = new Docker();

exports.singleLayer = singleLayerImage;
exports.copy = copyFromContainerImage;

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
    docker.createContainer(containerConfig, next);
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
  var bytes = 0;
  var tarPipe = through(function inc(d) {
    bytes += d.length;
    this.queue(d);
  }, function report() {
    console.log('[build]  bytes read: %d', bytes);
    this.queue(null);
  });

  return async.series([
    injectBuild,
    extractBuild,
    wait,
  ], function(err) {
    return callback(err, destContainer);
  });

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
    docker.createContainer(tarx, next);
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
    var count = 0;
    var counter = through(function(d) {
      count += d.toString().split('\n').length - 1;
    }, function() {
      console.log('[deploy] files written: %d', count);
    });
    console.log('[deploy] injecting build results');
    docker.modem.demuxStream(stream, counter, process.stdout);
    stream._output.on('end', function() {
      counter.end();
    });
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
    console.log('[build]  extracting build results');
    docker.modem.demuxStream(stream, tarPipe, process.stdout);
    stream.on('end', function() {
      tarPipe.end();
    });
    next();
  }

  function wait(next) {
    destContainer.wait(next);
  }
}
