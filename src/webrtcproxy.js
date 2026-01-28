app.use(cors({
  origin: ['https://namchuk.solar', 'https://html-peer-viewer.onrender.com', 'http://localhost:8008'],
  credentials: true
}));
app.use(express.text({ type: 'application/sdp' })); // Для SDP данных


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