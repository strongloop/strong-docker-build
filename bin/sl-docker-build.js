#!/usr/bin/env node
// Copyright IBM Corp. 2015. All Rights Reserved.
// Node module: strong-docker-build
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

var builder = require('../');
var path = require('path');

var opts = {
  appRoot: path.resolve(process.argv[2] || '.'),
  imgName: process.argv[3],
};

builder.buildDeployImage(opts, function(err, res) {
  if (err) {
    console.error('Failed to build image:', err);
    process.exit(1);
  } else {
    console.log('Image created:', res);
  }
});
