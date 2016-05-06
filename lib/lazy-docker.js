// Copyright IBM Corp. 2015. All Rights Reserved.
// Node module: strong-docker-build
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

var Docker = require('dockerode');
var lodash = require('lodash');

module.exports = lodash.memoize(function() {
  return new Docker();
});
