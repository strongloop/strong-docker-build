var env = process.env;
var fs = require('fs');
var http = require('http');

console.log('PID %d', process.pid);
console.log('CWD %s', process.cwd());
console.log('ENV.supervisor_profile:', env.supervisor_profile);
console.log('ENV.PATH:', env.PATH);
console.log('ENV.PWD:', env.PWD);

// Check binary dependencies were compiled
require('buffertools');
// Check dev dependencies weren't installed
var debug = null;
try {
  debug = require('debug');
} catch(e) {
  console.log('debug missing, as expected');
}
if (debug) {
  throw Error('dev dependency "debug" was installed');
}

http.createServer(onRequest)
    .listen(process.env.PORT || 0, function() {
  console.log('pid %d listening on %s', process.pid, this.address().port);

  // Used to verify process existence/health
  fs.writeFileSync('app.pid', process.pid);
  fs.writeFileSync('app.port', this.address().port);
});

function onRequest(req, res) {
  switch (req.url) {
    case '/env':
      res.end(JSON.stringify(process.env, null, 2) + '\n\n');
      break;
    default:
      res.end(req.method + ' ' + req.url + '\n\n');
      break;
  }
}
