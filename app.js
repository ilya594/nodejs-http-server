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
app.use(cors({
  origin: [
    'https://namchuk.solar',
    'https://www.namchuk.solar',
    'http://localhost:3000', // для локальной разработки
    'http://localhost:5173'  // если используете Vite
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use('/hls/:cameraName/:stream(*)', createProxyMiddleware({
  target: 'http://195.137.244.53:8888',
  changeOrigin: true,
  pathRewrite: (path, req) => {
    const cameraName = req.params.cameraName;
    const stream = req.params.stream || '';
    return `/${cameraName}/${stream}`;
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log(`[HLS Proxy] ${req.method} ${req.originalUrl} -> ${proxyReq.path}`);
  },
  onProxyRes: (proxyRes, req, res) => {
    // Исправляем заголовки для HLS
    proxyRes.headers['access-control-allow-origin'] = '*';
    proxyRes.headers['access-control-allow-methods'] = 'GET, HEAD, OPTIONS';
    proxyRes.headers['access-control-expose-headers'] = '*';
    
    // Content-Type для разных типов файлов
    if (req.url.endsWith('.m3u8')) {
      proxyRes.headers['content-type'] = 'application/vnd.apple.mpegurl';
      proxyRes.headers['cache-control'] = 'no-cache, no-store, must-revalidate';
    } else if (req.url.match(/\.(ts|mp4)$/)) {
      proxyRes.headers['content-type'] = 'video/MP2T';
      proxyRes.headers['cache-control'] = 'public, max-age=86400';
    }
  }
}));

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

// ========== ПРОСТОЙ ПРОКСИ ДЛЯ ПРОВЕРКИ ==========
app.get('/check-stream/:cameraName', async (req, res) => {
  const { cameraName } = req.params;
  const hlsUrl = `http://195.137.244.53:8888/${cameraName}/video1_stream.m3u8`;
  
  try {
    const response = await fetch(hlsUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const manifest = await response.text();
    
    res.json({
      success: true,
      camera: cameraName,
      url: `${req.protocol}://${req.get('host')}/hls/${cameraName}/video1_stream.m3u8`,
      manifestPreview: manifest.substring(0, 500)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      camera: cameraName,
      error: error.message,
      originalUrl: hlsUrl
    });
  }
});

// ========== ВАШИ СУЩЕСТВУЮЩИЕ РОУТЫ ==========
app.get('/', (req, res) => {
  res.json({
    service: 'HLS Proxy Server',
    endpoints: {
      hlsProxy: 'GET /hls/:camera/:stream',
      checkStream: 'GET /check-stream/:camera',
      // добавьте ваши существующие эндпоинты
    },
    example: 'https://nodejs-http-server.onrender.com/hls/camera/video1_stream.m3u8'
  });
});

// Ваши другие роуты остаются здесь
app.get('/api/data', (req, res) => {
  res.json({ message: 'Your existing API' });
});

app.post('/api/data', express.json(), (req, res) => {
  res.json({ received: req.body });
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



