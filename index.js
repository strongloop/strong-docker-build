var Docker = require('dockerode');
var async = require('async');
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
    addApp,
    RUN('build', ['useradd', '-m', 'strongloop']),
    RUN('build',
      ['chown', '-R', 'strongloop:strongloop', '/app', '/usr/local']),
    RUN('build', ['su', 'strongloop', '-c',
                  'npm install -g --no-spin strong-supervisor']),
    RUN('build', ['su', 'strongloop', '-c',
                  'cd /app && npm install --no-spin --production']),
    copyBuildToDeploy,
    commitDeployContainer,
    cleanup,
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

  function addApp(next) {
    console.log('[build]  ADD %s /app', opts.appRoot);
    var execOpts = {
      AttachStdout: true,
      AttachStderr: true,
      AttachStdin: true,
      Cmd: ['tar', '-C', '/app', '--strip-components', '1', '-xvf-'],
    };
    containers.build.exec(execOpts, function(err, exec) {
      if (err) {
        return next(err);
      }
      exec.start({
        AttachStdout: true,
        AttachStderr: true,
        AttachStdin: true,
        stdin: true,
      }, function(err, stream) {
        if (err) {
          return next(err);
        }
        var pkgStream = packageStream(opts.appRoot);
        pkgStream.pipe(stream);
        docker.modem.demuxStream(stream, through(dot), process.stdout);
        stream.on('end', function() {
          if (dot.written) {
            console.log('done');
          }
          next();
        });

        function dot() {
          dot.written = true;
          process.stdout.write('.');
        }
      });
    });

    // mimic 'npm pack' as an fstream
    function packageStream(pkgPath) {
      var pkgStreamOpts = {
        path: path.resolve(pkgPath),
        type: 'Directory',
        isDirectory: true,
      };
      return fnpm(pkgStreamOpts).pipe(tar.Pack());
    }
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
    var tarXstream = null;
    var tarCstream = null;
    var bytes = 0;
    var tarPipe = through(function encode(d) {
      bytes += d.length;
      this.queue(d);
    }, function() {
      console.log('[build]  bytes read: %d', bytes);
      this.queue(null);
    });
    async.series([
      createTarX,
      attachTarX,
      startTarX,
      startTarC,
      pipeStreams,
      wait,
    ], next);

    function createTarX(next) {
      docker.createContainer(tarx, function(err, c) {
        containers.deploy = c;
        next(err);
      });
    }

    function attachTarX(next) {
      var attachOpts = {
        stdin: true,
        stdout: true,
        stderr: true,
        stream: true,
      };
      containers.deploy.attach(attachOpts, function(err, stream) {
        if (err) {
          return next(err);
        }
        tarXstream = stream;
        var count = 0;
        var counter = through(function(d) {
          count += d.toString().split('\n').length - 1;
        }, function() {
          console.log('[deploy] files written: %d', count);
        });
        console.log('[deploy] injecting build results');
        docker.modem.demuxStream(tarXstream, counter, process.stdout);
        tarXstream._output.on('end', function() {
          counter.end();
        });
        next();
      });
    }

    function startTarX(next) {
      containers.deploy.start(tarx, next);
    }

    function startTarC(next) {
      containers.build.exec(tarc, function(err, exec) {
        if (err) {
          return next(err);
        }
        exec.start(tarc, function(err, stream) {
          if (err) {
            return next(err);
          }
          console.log('[build]  extracting build results');
          tarCstream = stream;
          docker.modem.demuxStream(tarCstream, tarPipe, process.stdout);
          next();
        });
      });
    }

    function pipeStreams(next) {
      tarPipe.pipe(tarXstream.req);
      tarCstream.on('end', function() {
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

  function cleanup(next) {
    async.series([
      removeBuild, removeDeploy, removePreDeploy,
    ], next);

    function removeBuild(next) {
      containers.build.remove({v: true, force: true}, next);
    }
    function removeDeploy(next) {
      containers.deploy.remove({v: true, force: true}, next);
    }
    function removePreDeploy(next) {
      containers.preDeploy.remove({v: true, force: true}, next);
    }
  }

  function RUN(containerId, cmd) {
    return async.apply(simpleExec, containerId, cmd);
  }

  function simpleExec(containerId, cmd, callback) {
    var execOpts = {
      AttachStdout: true,
      Cmd: cmd,
    };
    console.log('[%s]%s RUN %s', containerId,
                containerId === 'build' ? ' ' : '',
                cmd.join(' '));
    return async.waterfall([
      createExec,
      startExec,
      waitExec,
    ], callback);

    function createExec(next) {
      containers[containerId].exec(execOpts, next);
    }
  }

  function startExec(exec, next) {
    exec.start({stream: true}, next);
  }

  function waitExec(stream, next) {
    docker.modem.demuxStream(stream, through(dot), process.stdout);
    stream.on('end', function() {
      if (dot.written) {
        console.log('done');
      }
    });
    stream.on('end', next);
    stream.on('error', next);

    function dot() {
      dot.written = true;
      process.stdout.write('.');
    }
  }
}
