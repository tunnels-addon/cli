'use strict';

const child = require('child_process');
const cli = require('heroku-cli-util');
const co = require('co');
const Client = require('ssh2').Client;
const https = require('https')
const url = require('url');
const tty = require('tty')
const stream = require('stream')
const helpers = require('../lib/helpers')
const command = require('../lib/command')

module.exports = {
  topic: 'tunnels',
  command: 'ssh',
  description: 'Create an SSH session through the tunnel',
  help: 'Usage: heroku tunnels:ssh',
  variableArgs: true,
  flags: [{ name: 'dyno', char: 'd', hasValue: true }],
  needsApp: true,
  needsAuth: true,
  run: cli.command(co.wrap(run))
};

function * run(context, heroku) {
  let configVars = yield heroku.get(`/apps/${context.app}/config-vars`)

  yield helpers.updateClientKey(context, heroku, configVars, function(privateKey, dyno, response) {
    var message = `Connecting to ${cli.color.cyan.bold(dyno)} on ${cli.color.app(context.app)}`
    cli.action(message, {success: false}, co(function* () {
      cli.hush(response.body);
      var json = JSON.parse(response.body);
      _ssh(context, json['tunnel_host'], json['tunnel_port'], json['dyno_user'], privateKey)
    }))
  })
}

function _ssh(context, tunnelHost, tunnelPort, dynoUser, privateKey) {
  return new Promise((resolve, reject) => {
    var conn = new Client();
    conn.on('ready', function() {
      cli.action.done('up')
      if (context.args.length > 0) {
        let cmd = command.buildCommand(context.args)
        conn.exec(cmd, function(err, stream) {
          if (err) throw err;
          stream.on('close', function(code, signal) {
            conn.end();
            resolve();
          }).on('data', function(data) {
            cli.log(data.toString());
          }).on('data', reject);
        });
      } else {
        conn.shell(function(err, stream) {
          if (err) throw err;
          stream.on('close', function() {
            conn.end();
            resolve();
          })
          .on('data', _readData(stream))
          .on('error', reject)
          process.once('SIGINT', () => conn.end())
        });
      }
    }).connect({
      host: tunnelHost,
      port: tunnelPort,
      username: dynoUser,
      privateKey: privateKey
    });
  });
}

function _readData (c) {
  let firstLine = true
  return function(data) {
    if (firstLine) {
      firstLine = false
      _readStdin(c)
    }
    process.stdout.write(data)
  }
}

function _readStdin (c) {
  let stdin = process.stdin
  stdin.setEncoding('utf8')
  if (stdin.unref) stdin.unref()
  if (tty.isatty(0)) {
    stdin.setRawMode(true)
    stdin.pipe(c)
    let sigints = []
    stdin.on('data', function (c) {
      if (c === '\u0003') sigints.push(new Date())
      sigints = sigints.filter(d => d > new Date() - 1000)
      if (sigints.length >= 4) {
        cli.error('forcing dyno disconnect')
        process.exit(1)
      }
    })
  } else {
    stdin.pipe(new stream.Transform({
      objectMode: true,
      transform: (chunk, _, next) => c.write(chunk, next),
      flush: done => c.write('\x04', done)
    }))
  }
}
