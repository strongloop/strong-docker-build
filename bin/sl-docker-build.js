#!/usr/bin/env node

var builder = require('../');
var path = require('path');

var opts = {
  appRoot: path.resolve(process.argv[2] || '.'),
  imgName: process.argv[3] || 'strongloop/strong-app:slim',
};

builder.buildSlimImage(opts, function(err, imgName) {
  if (err) {
    console.error('Failed to build image:', err);
    process.exit(1);
  } else {
    console.log('Image created:', imgName);
  }
});
