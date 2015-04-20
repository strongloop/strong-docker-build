var Docker = require('dockerode');
var async = require('async');
var exec = require('./lib/exec');
var fnpm = require('fstream-npm');
var path = require('path');
var tar = require('tar');
var through = require('through');

exports.buildDeployImage = buildDeployImage;

function buildDeployImage(opts, callback) {
  var docker = opts.docker || new Docker();
  var containers = {
    build: null,
    preDeploy: null,
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
    createBuildContainer, startBuildContainer,
    createPreDeployContainer, commitPreDeployContainer,
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
    cleanupBuild, cleanupDeploy, cleanupPreDeploy,
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
  function createPreDeployContainer(next) {
    var opts = {
      Image: 'debian:jessie',
      Entrypoint: ['useradd', '-m', 'strongloop'],
      Cmd: null,
    };
    docker.createContainer(opts, function(err, c) {
      if (err) {
        return next(err);
      }
      containers.preDeploy = c;
      c.start({}, next);
    });
  }

  function startBuildContainer(next) {
    containers.build.start(next);
  }

  function copyBuildToDeploy(next) {
    var tarc = {
      AttachStdout: true,
      AttachStderr: true,
      Cmd: [
        'tar', '-cf-', '-C', '/',
        'app',
        'usr/local/bin/node',
        'usr/local/bin/sl-run',
        'usr/local/lib/node_modules/strong-supervisor',
      ],
    };
    var tarx = {
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: true,
      OpenStdin: true,
      StdinOnce: true,
      Entrypoint: ['tar', '-C', '/', '-xvpf-'],
      Cmd: [],
      Image: preDeployImg,
    };
    var bytes = 0;
    var tarPipe = through(function inc(d) {
      bytes += d.length;
      this.queue(d);
    }, function report() {
      console.log('[build]  bytes read: %d', bytes);
      this.queue(null);
    });

    return async.series([
      injectBuild,
      extractBuild,
      wait,
    ], next);

    function injectBuild(next) {
      async.waterfall([
        createTarX,
        attachTarX,
        startTarX,
      ], next);
    }

    function extractBuild(next) {
      async.waterfall([
        createTarC,
        startTarC,
        captureTarC,
      ], next);
    }

    function createTarX(next) {
      docker.createContainer(tarx, next);
    }

    function attachTarX(c, next) {
      containers.deploy = c;
      var attachOpts = {
        stdin: true,
        stdout: true,
        stderr: true,
        stream: true,
      };
      containers.deploy.attach(attachOpts, next);
    }

    function startTarX(stream, next) {
      var count = 0;
      var counter = through(function(d) {
        count += d.toString().split('\n').length - 1;
      }, function() {
        console.log('[deploy] files written: %d', count);
      });
      console.log('[deploy] injecting build results');
      docker.modem.demuxStream(stream, counter, process.stdout);
      stream._output.on('end', function() {
        counter.end();
      });
      tarPipe.pipe(stream.req);
      containers.deploy.start(tarx, next);
    }

    function createTarC(next) {
      containers.build.exec(tarc, next);
    }

    function startTarC(exec, next) {
      exec.start(tarc, next);
    }

    function captureTarC(stream, next) {
      console.log('[build]  extracting build results');
      docker.modem.demuxStream(stream, tarPipe, process.stdout);
      stream.on('end', function() {
        tarPipe.end();
      });
      next();
    }

    function wait(next) {
      containers.deploy.wait(next);
    }
  }

  function commitPreDeployContainer(next) {
    var imgConfig = {
      comment: 'Built by strong-docker-build',
      author: 'strong-docker-build@' + require('./package.json').version,
    };
    containers.preDeploy.wait(function(err) {
      if (err) {
        return next(err);
      }
      containers.preDeploy.commit(imgConfig, function(err, res) {
        preDeployImg = res && res.Id;
        next(err);
      });
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

  function cleanupPreDeploy(next) {
    containers.preDeploy.remove({v: true, force: true}, next);
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
}
