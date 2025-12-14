'use strict'

const HttpsServer = require("./src/webhttps");
const WebSocketServer = require('./src/websocket');
const express = require('express');
const http = require('http');
const cors = require('cors');
const parser = require('body-parser');
const app = express();
const server = http.createServer(app);
const options = { origin: '*', optionsSuccessStatus: 200 };

app.use(cors(options));
app.use(parser.json({ limit: '50mb' }));
app.use(parser.urlencoded({ limit: '50mb', extended: true }));

var peers = new Map();

const httpsServer = new HttpsServer({ app: app, peers: peers });
httpsServer.start();


const wsServer = new WebSocketServer({ httpServer: server, peers: peers });
wsServer.start();

wsServer.registerMessageHandler('heartbeat', (client, data) => {
  const id = data?.id;
  if (id && peers.has(id)) {
    peers.get(id).lastHeartbeat = Date.now();
    peers.get(id).isActive = true;
  }
});

setInterval(() => {
  const now = Date.now();
  const HEARTBEAT_THRESHOLD = 20000;
  for (const [peerId, data] of peers) {
    if (now - data.lastHeartbeat > HEARTBEAT_THRESHOLD) {
      peers.delete(peerId)
    }
  }
}, 10000);



