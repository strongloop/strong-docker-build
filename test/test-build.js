var builder = require('../');
var docker = require('../lib/lazy-docker');
var path = require('path');
var tap = require('tap');

var appRoot = path.resolve(__dirname, 'sample-app');
var builtImage = null;

tap.test('node base image', {timeout: 90000}, function(t) {
  docker().pull('node:0.10', {repo: 'node'}, function(err, stream) {
    t.ifError(err, 'start pull node:0.10 without error');
    docker().modem.followProgress(stream, function(err) {
      t.ifError(err, 'pull node:0.10 without error');
      t.end();
    });
  });
});

tap.test('debian:jessie base image', {timeout: 90000}, function(t) {
  docker().pull('debian:jessie', {repo: 'debian'}, function(err, stream) {
    t.ifError(err, 'start pull debian:jessie without error');
    docker().modem.followProgress(stream, function(err) {
      t.ifError(err, 'finish pull debian:jessie without error');
      t.end();
    });
  });
});

tap.test('remove existing default', function(t) {
  var img = docker().getImage('sl-docker-run/test-app:0.0.0');
  img.remove({force: true}, function() {
    t.ok(true, 'removed existing image if existed');
    t.end();
  });
});

tap.test('build default', {timeout: 180000}, function(t) {
  builder.buildDeployImage({appRoot: appRoot}, function(err, res) {
    t.ifError(err, 'builds successfully');
    t.equal(res.name, 'sl-docker-run/test-app:0.0.0', 'Image named and tagged');
    t.end();
  });
});

tap.test('wait for default image', function(t) {
  t.ok(true, 'let docker finalize image');
  setTimeout(t.end.bind(t), 750);
});

tap.test('inspect image', function(t) {
  docker().getImage('sl-docker-run/test-app:0.0.0')
          .inspect(function(err, image) {
    t.ifError(err, 'Image should be inspectable');
    builtImage = image;
    var cfg = image.Config;
    var size = image.VirtualSize;
    var expectedEntryPoint = ['/usr/local/bin/sl-run', '--control', '8700'];
    t.equivalent(cfg.Entrypoint, expectedEntryPoint, 'Runs sl-run');
    t.equal(cfg.WorkingDir, '/app', 'Runs from /app');
    t.assert(size < 180 * 1024 * 1024, 'Image is less than 180MB');
    t.end();
  });
});

tap.test('remove existing custom image', function(t) {
  docker().getImage('strong-docker-build:test')
          .remove({force: true}, function() {
    t.ok(true, 'removed existing image if existed');
    t.end();
  });
});

tap.test('build custom image', {timeout: 180000}, function(t) {
  var opts = {appRoot: appRoot, imgName: 'strong-docker-build:test'};
  builder.buildDeployImage(opts, function(err, res) {
    t.ifError(err, 'rebuild builds successfully');
    t.equal(res.name, 'strong-docker-build:test', 'Rebuild named and tagged');
    t.end();
  });
});

tap.test('wait for  custom image', function(t) {
  t.ok(true, 'let docker finalize image');
  setTimeout(t.end.bind(t), 750);
});

tap.test('inspect rebuilt image', function(t) {
  docker().getImage('strong-docker-build:test').inspect(function(err, image) {
    t.ifError(err, 'Rebuild image should be inspectable');
    t.ok(image.VirtualSize * 0.99999 < builtImage.VirtualSize &&
         image.VirtualSize * 1.00001 > builtImage.VirtualSize,
         'Rebuild image within 0.0001% of original image size');
    t.end();
  });
});
