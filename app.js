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

app.use(cors({
  origin: ['https://namchuk.solar', 'https://html-peer-viewer.onrender.com', 'http://localhost:8008'],
  credentials: true
}));
app.use(express.text({ type: 'application/sdp' })); // Для SDP данных

// Конфигурация
const MEDIAMTX_URL = 'http://195.137.244.53:8889';
//const PORT = process.env.PORT || 3000;

// Middleware для CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// Прокси для камеры
app.use('/camera', createProxyMiddleware({
  target: MEDIAMTX_URL,
  changeOrigin: true,
  pathRewrite: {
    '^/camera': '/camera', // Меняем путь если нужно
  },
  onProxyReq: (proxyReq, req, res) => {
    // Можно добавить заголовки аутентификации если нужно
    // proxyReq.setHeader('Authorization', 'Basic ' + Buffer.from('user:pass').toString('base64'));
    
    // Для RTSP/RTMP потоков
    if (req.url.includes('.m3u8') || req.url.includes('.ts')) {
      proxyReq.setHeader('Accept', 'application/vnd.apple.mpegurl');
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    // Меняем заголовки ответа
    delete proxyRes.headers['x-frame-options'];
    
    // Для HLS потоков
    if (req.url.includes('.m3u8')) {
      proxyRes.headers['content-type'] = 'application/vnd.apple.mpegurl';
    }
    
    // Для MPEG-TS
    if (req.url.includes('.ts')) {
      proxyRes.headers['content-type'] = 'video/MP2T';
    }
    
    // Убираем ограничения
    proxyRes.headers['access-control-allow-origin'] = '*';
    proxyRes.headers['access-control-expose-headers'] = '*';
  },
  logger: console
}));


app.post('/api/webrtc/:camera?', async (req, res) => {
  const camera = req.params.camera || 'camera';
  const mediaMtxUrl = `http://195.137.244.53:8889/${camera}/whep`;

  console.log(`🎥 WebRTC прокси: ${camera} -> ${mediaMtxUrl}`);

  try {
    // Пересылаем SDP offer на MediaMTX
    const response = await fetch(mediaMtxUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp',
        'Accept': 'application/sdp'
      },
      body: req.body,
      timeout: 10000 // 10 секунд таймаут
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ MediaMTX ошибка: ${response.status}`, errorText);
      throw new Error(`MediaMTX: ${response.status} - ${errorText}`);
    }

    // Получаем SDP answer
    const sdpAnswer = await response.text();
    console.log(`✅ WebRTC прокси успешен (${sdpAnswer.length} байт)`);

    // Возвращаем ответ клиенту
    res.set({
      'Content-Type': 'application/sdp',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store'
    });

    res.send(sdpAnswer);

  } catch (error) {
    console.error('🔥 WebRTC прокси ошибка:', error.message);
    res.status(500).json({
      error: 'WebRTC proxy failed',
      details: error.message,
      camera,
      timestamp: new Date().toISOString()
    });
  }
});

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



