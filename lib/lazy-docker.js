var Docker = require('dockerode');
var lodash = require('lodash');

module.exports = lodash.memoize(function() {
  return new Docker();
});
