'use strict'

const HttpsServer = require("./src/webhttps");
const WebSocketServer = require('./src/websocket');
const { createProxyMiddleware } = require('http-proxy-middleware');
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
  if (!id) return;
  if (peers.has(id)) {
    peers.get(id).lastHeartbeat = Date.now();
    peers.get(id).isActive = true;
  } else {
    console.log('adding peer to map: [' + id + '], size: [' + (peers.size + 1) + ']');
    peers.set(id, {
      id,
      lastHeartbeat: Date.now(),
      registeredAt: Date.now(),
      isActive: true
    });
  }
});

wsServer.registerMessageHandler('getpeers', (client, data) => {
  client.ws.send(JSON.stringify({ peers: peers.keys() }));
});

const PEER_LIFETIME = 20000;
const SCAN_INTERVAL = 10000;

setInterval(() => {
  const now = Date.now();
  for (const [peerId, data] of peers) {
    if (now - data.lastHeartbeat > PEER_LIFETIME) {
      console.log('removing peer cuz of timeout: [' + peerId + '], size: [' + peers.size - 1 + ']');
      peers.delete(peerId);
    }
  }
}, SCAN_INTERVAL);



