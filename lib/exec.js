var Docker = require('dockerode');
var async = require('async');
var through = require('through');

var docker = new Docker();

exports.simple = simpleExec;
exports.streamIn = streamInExec;

function simpleExec(container, cmd, callback) {
  var execOpts = {
    AttachStdout: true,
    Cmd: cmd,
  };
  return async.waterfall([
    createExec,
    startExec,
    captureExec,
    waitExec,
  ], callback);

  function createExec(next) {
    container.exec(execOpts, next);
  }
}

function startExec(exec, next) {
  exec.start({stdin: true}, next);
}

function waitExec(stream, next) {
  stream.on('end', next);
  stream.on('error', next);
}

function streamInExec(container, cmd, callback) {
  var execOpts = {
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: true,
    Cmd: cmd,
  };

  return async.waterfall([
    createExec,
    startExec,
    captureExec,
  ], callback);

  function createExec(next) {
    container.exec(execOpts, next);
  }
}

function captureExec(stream, next) {
  docker.modem.demuxStream(stream, through(dot), process.stdout);
  stream.on('end', function() {
    if (dot.written) {
      console.log('done');
    }
  });

  return next(null, stream);

  function dot() {
    dot.written = true;
    process.stdout.write('.');
  }
}
