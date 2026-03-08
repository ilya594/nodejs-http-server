'use strict'


const HttpsServer = require("./src/webhttps");
const WebSocketServer = require('./src/websocket');
const HLSStreamWithDetector = require('./src/hlsproxy');
const { handleWebRTCProxy, getStreamDirect } = require('./src/webrtcproxy');
const { createProxyMiddleware } = require('http-proxy-middleware');
const express = require('express');
const http = require('http');
const cors = require('cors');
const parser = require('body-parser');
const app = express();
const server = http.createServer(app);
const options = { origin: '*', optionsSuccessStatus: 200 };
const path = require('path');
const { chatRouter } = require('./src/chatrouter'); // файл с твоим кодом
app.use(cors(options));
app.use(parser.json({ limit: '50mb' }));
app.use(parser.urlencoded({ limit: '50mb', extended: true }));

app.use(cors({
  origin: ['https://namchuk.solar', 'https://html-peer-viewer.onrender.com', 'http://localhost:8008', 'http://195.137.244.53:8000'],
  credentials: true
}));
app.use(express.text({ type: 'application/sdp' })); // Для SDP данных
app.use('/detections', express.static(path.join(__dirname, 'detections')));

app.post('/api/webrtc/:camera?', async (req, res) => {
  await handleWebRTCProxy(req, res);
});


app.use('/api/chat', chatRouter);

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

app.use('/api/chat', chatRouter);

wsServer.registerMessageHandler('getpeers', (client, data) => {
  client.ws.send(JSON.stringify({ peers: Array.from(peers.keys()) }));
});

const PEER_LIFETIME = 5000;
const SCAN_INTERVAL = 7000;

setInterval(() => {
  const now = Date.now();
  for (const [peerId, data] of peers) {
    if (now - data.lastHeartbeat > PEER_LIFETIME) {
      console.log('removing peer cuz of timeout: [' + peerId + '], size: [' + peers.size - 1 + ']');
      peers.delete(peerId);
    }
  }
}, SCAN_INTERVAL);

var detector = new HLSStreamWithDetector('camera', { frameSkip: 5 });
detector.initialize();







