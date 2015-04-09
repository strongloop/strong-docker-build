var builder = require('../');
var Docker = require('dockerode');
var path = require('path');
var tap = require('tap');

var appRoot = path.resolve(__dirname, 'sample-app');
var docker = new Docker();
var builtImage = null;

tap.test('build image', {timeout: 60000}, function(t) {
  builder.buildSlimImage({appRoot: appRoot}, function(err, image) {
    t.ifError(err, 'builds successfully');
    t.equal(image, 'strongloop/strong-app:slim', 'Image is named and tagged');
    t.end();
  });
});

tap.test('inspect image', function(t) {
  docker.getImage('strongloop/strong-app:slim').inspect(function(err, image) {
    t.ifError(err, 'Image should be inspectable');
    builtImage = image;
    var cfg = image.Config;
    var size = image.VirtualSize;
    var expectedEntryPoint = ['/usr/local/bin/sl-run', '--control', '8700'];
    t.equivalent(cfg.Entrypoint, expectedEntryPoint, 'Runs sl-run');
    t.equal(cfg.WorkingDir, '/app', 'Runs from /app');
    t.assert(size < 200 * 1024 * 1024, 'Image is less than 200MB');
    t.end();
  });
});

tap.test('rebuild image', {timeout: 60000}, function(t) {
  var opts = {appRoot: appRoot, imgName: 'strong-docker-build:test'};
  builder.buildSlimImage(opts, function(err, image) {
    t.ifError(err, 'rebuild builds successfully');
    t.equal(image, 'strong-docker-build:test', 'Rebuild is named and tagged');
    t.end();
  });
});

tap.test('inspect rebuilt image', function(t) {
  docker.getImage('strong-docker-build:test').inspect(function(err, image) {
    t.ifError(err, 'Rebuild image should be inspectable');
    t.equal(image.VirtualSize, builtImage.VirtualSize, 'Rebuild is same size');
    t.end();
  });
});
