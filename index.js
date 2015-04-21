var Docker = require('dockerode');
var async = require('async');
var exec = require('./lib/exec');
var fnpm = require('fstream-npm');
var image = require('./lib/image');
var path = require('path');
var tar = require('tar');

exports.buildDeployImage = buildDeployImage;

function buildDeployImage(opts, callback) {
  var docker = opts.docker || new Docker();
  var containers = {
    build: null,
    deploy: null,
  };
  var app = require(path.resolve(opts.appRoot, 'package.json'));
  var repo = opts.imgName && opts.imgName.split(':')[0]
                          || ('sl-docker-run/' + app.name);
  var tag = opts.imgName && opts.imgName.split(':')[1]
                         || app.version;
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
    IMAGE('debian:jessie', ['useradd', '-m', 'strongloop']),
    createBuildContainer, startBuildContainer,
    RUN('build', ['mkdir', '-p', '/app']),
    ADD('build', opts.appRoot, '/app'),
    RUN('build', ['useradd', '-m', 'strongloop']),
    RUN('build',
      ['chown', '-R', 'strongloop:strongloop', '/app', '/usr/local']),
    RUN('build', ['su', 'strongloop', '-c',
                  'npm install -g --no-spin strong-supervisor']),
    RUN('build', ['su', 'strongloop', '-c',
                  'cd /app && npm install --no-spin --production']),
    copyBuildToDeploy,
    commitDeployContainer,
    cleanupBuild, cleanupDeploy,
  ], function(err) {
    callback(err, result);
  });

  function createBuildContainer(next) {
    var opts = {
      Image: 'node:latest',
      Cmd: ['sleep', '1000'],
      Env: env,
    };
    console.log('[build]  FROM %s', opts.Image);
    docker.createContainer(opts, function(err, c) {
      containers.build = c;
      next(err);
    });
  }

  function startBuildContainer(next) {
    containers.build.start(next);
  }

  function copyBuildToDeploy(next) {
    var paths = [
      'app',
      'usr/local/bin/node',
      'usr/local/bin/sl-run',
      'usr/local/lib/node_modules/strong-supervisor',
    ];
    image.copy(containers.build, paths, preDeployImg, function(err, c) {
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
    containers.build.remove({v: true, force: true}, next);
  }

  function cleanupDeploy(next) {
    containers.deploy.remove({v: true, force: true}, next);
  }

  function RUN(containerId, cmd) {
    return runCmd;

    function runCmd(next) {
      console.log('[%s]%s RUN %s', containerId,
                  containerId === 'build' ? ' ' : '',
                  cmd.join(' '));
      exec.simple(containers[containerId], cmd, next);
    }
  }

  function ADD(containerId, src, dst) {
    return addApp;

    function addApp(next) {
      var cmd = ['tar', '-C', dst, '--strip-components', '1', '-xvf-'];
      var pkgStreamOpts = {
        path: path.resolve(src),
        type: 'Directory',
        isDirectory: true,
      };
      console.log('[%s]  ADD %s /app', containerId, src);
      exec.streamIn(containers[containerId], cmd, function(err, stream) {
        if (err) {
          return next(err);
        }
        // mimic 'npm pack'
        fnpm(pkgStreamOpts)
          .pipe(tar.Pack())
          .pipe(stream)
          .on('end', next);
      });
    }
  }

  function IMAGE(img, cmd) {
    return makeImage;

    function makeImage(next) {
      image.singleLayer(img, cmd, function(err, res) {
        preDeployImg = res && res.Id;
        next(err);
      });
    }
  }
}
