'use strict';

const child = require('child_process');
const path = require('path');
const cli = require('heroku-cli-util');
const https = require('https')
const http = require('http')
const fs = require('fs')
const co = require('co');
const helpers = require('../lib/helpers')

module.exports = {
  topic: 'tunnels',
  command: 'jconsole',
  description: 'Launch JConsole into an app',
  help: 'Usage: heroku tunnels:jconsole',
  args: [],
  needsApp: true,
  needsAuth: true,
  run: cli.command(co.wrap(run))
};

function * run(context, heroku) {
  let configVars = yield heroku.get(`/apps/${context.app}/config-vars`)

  helpers.withTunnelInfo(
    context,
    heroku,
    configVars,
    {ssh: true}
  ).then(response => {
    cli.hush(response.body);
    var json = JSON.parse(response.body);

    var user = json['dyno_user']
    var dyno_ip = json['dyno_ip']
    var host = json['tunnel_host']
    var port = json['tunnel_port']
    var key = helpers.massagePrivateKey(json['private_key'])

    cli.hush('server: ' + user + '@' + host + ':' + port)

    helpers.socksv5({
      host: host,
      port: port,
      username: user,
      privateKey: key
    }, function() {
      cli.log("Launching JConsole...")
      child.exec(`jconsole -J-DsocksProxyHost=localhost -J-DsocksProxyPort=1080 ${dyno_ip}:1098`)
    });
  }).catch(error => {
    cli.error(error.response.body);
  });
}