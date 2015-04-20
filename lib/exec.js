var Docker = require('dockerode');
var async = require('async');
var through = require('through');

var docker = new Docker();

exports.simple = simpleExec;

function simpleExec(container, cmd, callback) {
  var execOpts = {
    AttachStdout: true,
    Cmd: cmd,
  };
  return async.waterfall([
    createExec,
    startExec,
    waitExec,
  ], callback);

  function createExec(next) {
    container.exec(execOpts, next);
  }
}

function startExec(exec, next) {
  exec.start({stream: true}, next);
}

function waitExec(stream, next) {
  docker.modem.demuxStream(stream, through(dot), process.stdout);
  stream.on('end', function() {
    if (dot.written) {
      console.log('done');
    }
  });
  stream.on('end', next);
  stream.on('error', next);

  function dot() {
    dot.written = true;
    process.stdout.write('.');
  }
}
