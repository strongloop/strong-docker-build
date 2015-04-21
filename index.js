var async = require('async');
var exec = require('./lib/exec');
var image = require('./lib/image');
var path = require('path');

exports.buildDeployImage = buildDeployImage;

function buildDeployImage(opts, callback) {
  var app = require(path.resolve(opts.appRoot, 'package.json'));
  var repo = extractRepoName(opts.imgName, 'sl-docker-run/' + app.name);
  var tag = extractTagName(opts.imgName, app.version);
  var preDeployImage = null;
  var buildContainer = null;
  var deployContainer = null;
  var deployImage = null;
  var buildDetails = null;

  return async.series([
    createPreDeploy,
    createBuild,
    inspectBuild,
    copyBuildToDeploy,
    commitDeployContainer,
    cleanupBuild, cleanupDeploy,
  ], function(err) {
    callback(err, {name: repo + ':' + tag, id: deployImage});
  });

  function createBuild(next) {
    var container = null;
    var env = [];
    if (process.env.npm_config_registry) {
      env.push('npm_config_registry=' + process.env.npm_config_registry);
    }

    return async.series([
      FROM('node:latest'),
      RUN(['mkdir', '-p', '/app']),
      ADD(opts.appRoot, '/app'),
      RUN(['useradd', '-m', 'strongloop']),
      RUN(['chown', '-R', 'strongloop:strongloop', '/app', '/usr/local']),
      RUN(as('strongloop', 'npm install -g --no-spin strong-supervisor')),
      RUN(as('strongloop', 'cd /app && npm install --no-spin --production')),
    ], next);

    function FROM(baseImage) {
      return startAndCreate;

      function startAndCreate(next) {
        console.log('[build] FROM %s', baseImage);
        image.start(baseImage, env, function(err, c) {
          buildContainer = container = c;
          next(err);
        });
      }
    }

    function RUN(cmd) {
      return runCmd;

      function runCmd(next) {
        console.log('[build] RUN %s', cmd.join(' '));
        exec.simple(container, cmd, next);
      }
    }

    function ADD(src, dst) {
      return addApp;

      function addApp(next) {
        console.log('[build] ADD %s %s', path.relative('.', src), dst);
        exec.addApp(container, src, dst, next);
      }
    }

    function as(user, cmd) {
      return ['su', user, '-c', cmd];
    }
  }

  function inspectBuild(next) {
    buildContainer.inspect(function(err, details) {
      buildDetails = details;
      next(err);
    });
  }

  function createPreDeploy(next) {
    var baseImage = 'debian:jessie';
    var cmd = ['useradd', '-m', 'strongloop'];
    image.singleLayer(baseImage, cmd, function(err, res) {
      preDeployImage = res && res.Id;
      next(err);
    });
  }

  function copyBuildToDeploy(next) {
    var paths = [
      'app',
      'usr/local/bin/node',
      'usr/local/bin/sl-run',
      'usr/local/lib/node_modules/strong-supervisor',
    ];
    console.log('Copying build results from build container to final image');
    image.copy(buildContainer, paths, preDeployImage, function(err, c, counts) {
      console.log('Bytes read: %d', counts && counts.bytes);
      console.log('Files written: %d', counts && counts.files);
      deployContainer = c;
      next(err);
    });
  }

  function commitDeployContainer(next) {
    var imgConfig = {
      Image: 'debian:jessie',
      User: 'strongloop',
      WorkingDir: '/app',
      Env: [
        'PORT=3000',
        'STRONGLOOP_CLUSTER=CPU',
      ].concat(buildDetails.Config.Env.filter(function(e) {
        return /NODE_VERSION/.test(e);
      })),
      ExposedPorts: {
        '8700/tcp': {},
        '3000/tcp': {},
      },
      Entrypoint: [
        '/usr/local/bin/sl-run', '--control', '8700',
      ],
      repo: repo,
      tag: tag,
      comment: 'Built by strong-docker-build',
      author: 'strong-docker-build@' + require('./package.json').version,
    };
    console.log('[deploy] commiting: %s as %s:%s',
                deployContainer.id.slice(0, 12),
                imgConfig.repo, imgConfig.tag);
    deployContainer.commit(imgConfig, function(err, res) {
      deployImage = res && res.Id;
      next(err);
    });
  }

  function cleanupBuild(next) {
    console.log('[build] removing container');
    buildContainer.remove({v: true, force: true}, next);
  }

  function cleanupDeploy(next) {
    console.log('[deploy] removing container');
    deployContainer.remove({v: true, force: true}, next);
  }
}

function extractRepoName(imgName, dflt) {
  var repo = imgName && imgName.split(':')[0];
  return repo || dflt;
}

function extractTagName(imgName, dflt) {
  var tag = imgName && imgName.split(':')[1];
  return tag || dflt;
}
