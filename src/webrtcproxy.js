
async function exchangeSDPWithMediaMTX(camera, sdpOffer) {
  const mediaMtxUrl = `http://195.137.244.53:8889/${camera}/whep`;
  
  console.log(`🔄 SDP exchange for ${camera} -> ${mediaMtxUrl}`);
  
  const response = await fetch(mediaMtxUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/sdp',
      'Accept': 'application/sdp'
    },
    body: sdpOffer,
    timeout: 10000
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ MediaMTX ошибка: ${response.status}`, errorText);
    throw new Error(`MediaMTX: ${response.status} - ${errorText}`);
  }

  const sdpAnswer = await response.text();
  console.log(`✅ SDP exchange успешен (${sdpAnswer.length} байт)`);
  
  return sdpAnswer;
}

function ensureIceParams(answerSdp, localSdp) {
  if (!answerSdp.includes('ice-ufrag')) {
    const ufragMatch = localSdp.match(/a=ice-ufrag:(\S+)/);
    const pwdMatch = localSdp.match(/a=ice-pwd:(\S+)/);

    if (ufragMatch && pwdMatch) {
      answerSdp += `\r\na=ice-ufrag:${ufragMatch[1]}\r\na=ice-pwd:${pwdMatch[1]}`;
      console.log('📝 Добавлены ICE параметры в answer');
    }
  }
  return answerSdp;
}

async function handleWebRTCProxy(req, res) {
  const camera = req.params.camera || 'camera';
  
  console.log(`🎥 WebRTC прокси: ${camera}`);

  try {
    const sdpAnswer = await exchangeSDPWithMediaMTX(camera, req.body);

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
};


/*async function getStreamDirect(camera = 'camera') {
  console.log('🚀 Прямое подключение к MediaMTX для камеры:', camera);

  return new Promise(async (resolve, reject) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    const timeout = setTimeout(() => {
      reject(new Error('Timeout: No video track received'));
      pc.close();
    }, 10000);

    try {
      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.ontrack = (event) => {
        if (event.track.kind === 'video') {
          const stream = new MediaStream([event.track]);
          clearTimeout(timeout);
          resolve(stream);
        }
      };

      const offer = await pc.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false
      });

      await pc.setLocalDescription(offer);

      // Используем общую функцию для обмена SDP напрямую с MediaMTX
      const answerSdp = await exchangeSDPWithMediaMTX(camera, offer.sdp);

      // Добавляем ICE параметры если нужно
      const finalAnswer = pc.localDescription 
        ? ensureIceParams(answerSdp, pc.localDescription.sdp)
        : answerSdp;

      await pc.setRemoteDescription({
        type: 'answer',
        sdp: finalAnswer
      });

      console.log('✅ WebRTC соединение установлено');

    } catch (error) {
      clearTimeout(timeout);
      pc.close();
      reject(error);
    }
  });
}*/

module.exports = {
  handleWebRTCProxy,
 // getStreamDirect
};