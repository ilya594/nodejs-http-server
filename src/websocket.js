// websocket-server.js
'use strict';

const http = require('http');
const WebSocket = require('ws');

class WebSocketServer {
  constructor(config = {}) {
    this.config = {
      port: 10000,
      host: config.host || '0.0.0.0',
      path: config.path || '/ws',
      createHttpServer: config.createHttpServer !== false,
      // ... rest of config
    };
    
    this.server = config.httpServer || null;
    this.wss = null;
    this.isRunning = false;
    this.peers = config.peers;
    
    // Middleware and handler arrays
    this.connectionMiddleware = [];
    this.messageHandlers = new Map();
    this.closeHandlers = [];
    
    // Built-in handlers
    this.registerMessageHandler('ping', this.handlePing.bind(this));
    this.registerMessageHandler('echo', this.handleEcho.bind(this));
  }
  
  /**
   * Start the WebSocket server
   */
  async start() {
    if (this.isRunning) {
      throw new Error('WebSocket server is already running');
    }
    
    // Create HTTP server if not provided
    if (!this.server && this.config.createHttpServer) {
      this.server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          service: 'websocket',
          connectedClients: this.getConnectedCount()
        }));
      });
    }
    
    // Create WebSocket server
    const wssOptions = {
      server: this.server,
      path: this.config.path,
      perMessageDeflate: this.config.perMessageDeflate || false
    };
    
    this.wss = new WebSocket.Server(wssOptions);
    
    // Set up event listeners
    this.setupWSEvents();
    
    // Start listening if we have our own server
    if (this.config.createHttpServer) {
      await new Promise((resolve, reject) => {
        this.server.listen(this.config.port, this.config.host, () => {
          console.log(`WebSocket server listening on ${this.config.host}:${this.config.port}`);
          resolve();
        });
        
        this.server.on('error', reject);
      });
    }
    
    this.isRunning = true;
    return this;
  }
  
  /**
   * Set up WebSocket event listeners
   */
  setupWSEvents() {
    this.wss.on('connection', (ws, req) => {
      const client = {
        id: this.generateId(),
        ws,
        req,
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        connectedAt: Date.now(),
        metadata: {}
      };
      
      // Run connection middleware
      for (const middleware of this.connectionMiddleware) {
        middleware(client);
      }
      
      // Set up client event handlers
      this.setupClientHandlers(client);
      
      console.log(`Client ${client.id} connected from ${client.ip}`);
    });
  }
  
  /**
   * Set up handlers for a specific client
   */
  setupClientHandlers(client) {
    const { ws } = client;
    
    // Heartbeat
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    
    // Message handler
    ws.on('message', (data) => {
      this.handleClientMessage(client, data);
    });
    
    // Close handler
    ws.on('close', (code, reason) => {
      this.handleClientClose(client, code, reason);
    });
    
    // Error handler
    ws.on('error', (error) => {
      this.handleClientError(client, error);
    });
    
    // Send welcome message
    this.sendToClient(client.id, {
      type: 'welcome',
      clientId: client.id,
      timestamp: Date.now()
    });
  }
  
  /**
   * Handle message from client
   */
  async handleClientMessage(client, rawData) {
    try {
      const data = JSON.parse(rawData);
      
      // Find handler for this message type
      const handler = this.messageHandlers.get(data.type);
      if (handler) {
        await handler(client, data);
      } else {
        // No handler found
        this.sendToClient(client.id, {
          type: 'error',
          message: `No handler for message type: ${data.type}`
        });
      }
    } catch (error) {
      console.error(`Error handling message from ${client.id}:`, error);
      this.sendToClient(client.id, {
        type: 'error',
        message: 'Invalid message format'
      });
    }
  }
  
  /**
   * Handle client disconnection
   */
  handleClientClose(client, code, reason) {
    console.log(`Client ${client.id} disconnected:`, code, reason);
    
    for (const handler of this.closeHandlers) {
      handler(client, code, reason);
    }
  }
  
  /**
   * Handle client error
   */
  handleClientError(client, error) {
    console.error(`Error for client ${client.id}:`, error);
  }
  
  /**
   * Built-in handlers
   */
  handlePing(client, data) {
    this.sendToClient(client.id, { type: 'pong', timestamp: Date.now() });
  }
  
  handleEcho(client, data) {
    this.sendToClient(client.id, { 
      type: 'echo', 
      data: data.data,
      timestamp: Date.now() 
    });
  }
  
  /**
   * Register a message handler
   */
  registerMessageHandler(type, handler) {
    this.messageHandlers.set(type, handler);
    return this;
  }
  
  /**
   * Add connection middleware
   */
  useConnectionMiddleware(middleware) {
    this.connectionMiddleware.push(middleware);
    return this;
  }
  
  /**
   * Add close handler
   */
  onClose(handler) {
    this.closeHandlers.push(handler);
    return this;
  }
  
  /**
   * Send message to client
   */
  sendToClient(clientId, data) {
    const client = this.getClient(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }
  
  /**
   * Broadcast to all clients
   */
  broadcast(data, excludeClientId = null) {
    let count = 0;
    const jsonData = JSON.stringify(data);
    
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        // We'd need to track clientId in the ws object
        // For simplicity, we're not excluding here
        client.send(jsonData);
        count++;
      }
    });
    
    return count;
  }
  
  /**
   * Get connected client count
   */
  getConnectedCount() {
    let count = 0;
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) count++;
    });
    return count;
  }
  
  /**
   * Get client by ID (simplified - needs proper client storage)
   */
  getClient(clientId) {
    // Implementation depends on how you store clients
    // This is a simplified version
    return null;
  }
  
  /**
   * Generate unique ID
   */
  generateId() {
    return Math.random().toString(36).substr(2, 9);
  }
  
  /**
   * Stop the server
   */
  async stop() {
    if (!this.isRunning) return;
    
    // Close all connections
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1000, 'Server shutting down');
      }
    });
    
    // Close WebSocket server
    await new Promise((resolve) => {
      this.wss.close(resolve);
    });
    
    // Close HTTP server if we created it
    if (this.config.createHttpServer) {
      await new Promise((resolve) => {
        this.server.close(resolve);
      });
    }
    
    this.isRunning = false;
    console.log('WebSocket server stopped');
  }
}

module.exports = WebSocketServer;