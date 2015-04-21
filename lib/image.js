var Docker = require('dockerode');
var async = require('async');

var docker = new Docker();

exports.singleLayer = singleLayerImage;

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
