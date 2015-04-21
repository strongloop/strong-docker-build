var async = require('async');
var exec = require('./lib/exec');
var image = require('./lib/image');
var path = require('path');

exports.buildDeployImage = buildDeployImage;

function buildDeployImage(opts, callback) {
  var containers = {
    build: null,
    deploy: null,
  };
  var app = require(path.resolve(opts.appRoot, 'package.json'));
  var repo = extractRepoName(opts.imgName, 'sl-docker-run/' + app.name);
  var tag = extractTagName(opts.imgName, app.version);
  var result = {
    name: repo + ':' + tag,
    id: null
  };
  var preDeployImg = null;
  var env = [];

  if (process.env.npm_config_registry) {
    env.push('npm_config_registry=' + process.env.npm_config_registry);
  }

  return async.series([
    createPreDeploy,
    createBuild,
    copyBuildToDeploy,
    commitDeployContainer,
    cleanupBuild, cleanupDeploy,
  ], function(err) {
    callback(err, result);
  });

  function createBuild(next) {
    var container = null;

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
          containers.build = container = c;
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

  function createPreDeploy(next) {
    var baseImage = 'debian:jessie';
    var cmd = ['useradd', '-m', 'strongloop'];
    image.singleLayer(baseImage, cmd, function(err, res) {
      preDeployImg = res && res.Id;
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
    image.copy(containers.build, paths, preDeployImg, function(err, c, counts) {
      console.log('Bytes read: %d', counts && counts.bytes);
      console.log('Files written: %d', counts && counts.files);
      containers.deploy = c;
      next(err);
    });
  }

  function commitDeployContainer(next) {
    var imgConfig = {
      // FROM debian:jessie
      Image: 'debian:jessie',
      // USER strongloop
      User: 'strongloop',
      // WORKDIR /app
      WorkingDir: '/app',
      // ENV PORT=3000
      Env: [
        'PORT=3000',
        'STRONGLOOP_CLUSTER=CPU',
      ],
      // EXPOSE 8700 3000
      ExposedPorts: {
        '8700/tcp': {},
        '3000/tcp': {},
      },
      // ENTRYPOINT ["/usr/local/bin/sl-run", "--control", "8700"]
      Entrypoint: [
        '/usr/local/bin/sl-run', '--control', '8700',
      ],
      repo: repo,
      tag: tag,
      comment: 'Built by strong-docker-build',
      author: 'strong-docker-build@' + require('./package.json').version,
    };
    console.log('[deploy] commiting: %s as %s:%s',
                containers.deploy.id.slice(0, 12),
                imgConfig.repo, imgConfig.tag);
    containers.deploy.commit(imgConfig, function(err, res) {
      result.id = res && res.Id;
      next(err);
    });
  }

  function cleanupBuild(next) {
    console.log('[build] removing container');
    containers.build.remove({v: true, force: true}, next);
  }

  function cleanupDeploy(next) {
    console.log('[deploy] removing container');
    containers.deploy.remove({v: true, force: true}, next);
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
