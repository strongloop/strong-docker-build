// Copyright IBM Corp. 2015. All Rights Reserved.
// Node module: strong-docker-build
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

var async = require('async');
var docker = require('./lazy-docker');
var fnpm = require('fstream-npm');
var path = require('path');
var tar = require('tar');
var through = require('through');

exports.simple = simpleExec;
exports.streamIn = streamInExec;
exports.addApp = addAppExec;

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
  docker().modem.demuxStream(stream, through(dot), process.stdout);
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

function addAppExec(container, src, dst, callback) {
  var cmd = ['tar', '-C', dst, '--strip-components', '1', '-xvf-'];
  var pkg = {path: path.resolve(src), type: 'Directory'};

  // mimic 'npm pack'
  return async.waterfall([
    createSink,
    streamApp,
  ], callback);

  function createSink(next) {
    streamInExec(container, cmd, next);
  }

  function streamApp(stream, next) {
    fnpm(pkg).pipe(tar.Pack()).pipe(stream).on('end', next);
  }
}
