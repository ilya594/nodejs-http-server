// hls-stream-with-detector.js
const { spawn } = require('child_process');
const Detector = require('./obdetection');

class HLSStreamWithDetector {
  constructor(cameraName = 'camera', detectorConfig = {}) {
    this.playlistUrl = `http://195.137.244.53:8888/${cameraName}/index.m3u8`;
    this.tempDir = './temp_hls';
    this.detector = new Detector(detectorConfig);
    this.frameCallback = null;
    this.frameSkip = detectorConfig.frameSkip || 5;
    this.frameCounter = 0;
    this.saveEnabled  = detectorConfig.saveEnabled || true;
    
    // Создаем временную папку если нужно
    const fs = require('fs');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir);
    }
  }

  async initialize() {
    console.log('🔄 Initializing detector...');
    await this.detector.initialize();
    this.start();
    console.log('✅ Detector ready');
  }

  async start(options = {}) {
    const {
      width = 1280,
      height = 720,
      fps = 20,
      pixelFormat = 'bgr24'
    } = options;

    console.log(`📡 Connecting to HLS stream: ${this.playlistUrl}`);
    
    // FFmpeg для чтения HLS и конвертации в raw video
    this.process = spawn('ffmpeg', [
      '-i', this.playlistUrl,
      '-f', 'image2pipe',
      '-pix_fmt', pixelFormat,
      '-vcodec', 'rawvideo',
      '-s', `${width}x${height}`,
      '-r', fps.toString(),
      '-'
    ]);

    let frameBuffer = Buffer.alloc(0);
    const frameSize = width * height * 3; // 3 канала для BGR

    this.process.stdout.on('data', (data) => {
      frameBuffer = Buffer.concat([frameBuffer, data]);
      
      while (frameBuffer.length >= frameSize) {
        const frameData = frameBuffer.slice(0, frameSize);
        frameBuffer = frameBuffer.slice(frameSize);
        
        // Обрабатываем кадр в детекторе
        this.processFrame(frameData, width, height);
      }
    });

    this.process.stderr.on('data', (data) => {
      // FFmpeg логи (можно отключить если мешают)
      // console.log(`FFmpeg: ${data.toString()}`);
    });

    this.process.on('close', (code) => {
      console.log(`FFmpeg process closed with code ${code}`);
    });
  }

  async processFrame(frameData, width, height) {
    this.frameCounter++;
    
    // Пропускаем кадры для производительности
    if (this.frameCounter % this.frameSkip !== 0) {
      return;
    }

    try {
      // Конвертируем raw данные в формат для детектора
      // Вариант А: если детектор принимает буфер напрямую
      const detections = await this.detector.detectFromBuffer(frameData);
      
      // Вариант Б: если нужно собрать изображение
      // const { RawImage } = require('@xenova/transformers');
      // const image = new RawImage(frameData, width, height, 3);
      // const detections = await this.detector._detect(image);
      
      if (detections.length > 0) {
        console.log(`[Frame ${this.frameCounter}] Found ${detections.length} objects`);
        await this.checkAndSaveFrame(frameData, detections);
        // Вызываем колбэк если есть
        if (this.frameCallback) {
          this.frameCallback(detections, frameData, width, height);
        }
      }
    } catch (error) {
      console.error('Detection error:', error);
    }
  }

    /**
   * Проверяет нужно ли сохранить кадр и сохраняет если нужно
   */
  async checkAndSaveFrame(frameData, detections) {
    if (!this.saveEnabled) return false;
    
    const now = Date.now() / 1000; // текущее время в секундах
 
    if (now - this.lastSaveTime < this.saveCooldown) {
      return false;
    }

    await this.saveFrame(frameData, detections);
    
    this.lastSaveTime = now;
    return true;
  }


  async saveFrame(frameData, detections = []) {
    try {
      // Генерируем имя файла
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const detectedStr = Array.from(new Set(detections.map(d => d.className))).join('_');
      const filename = `${timestamp}_frame${this.frameCounter}_${detectedStr}.jpg`;
      const filepath = path.join(this.savePath, filename);
      

      await this.convertRawToJPEG(frameData, filepath);

      const infoFile = filepath.replace('.jpg', '.json');
      const info = {
        timestamp: new Date().toISOString(),
        frameNumber: this.frameCounter,
        camera: this.playlistUrl,
        resolution: `${this.width}x${this.height}`,
        detections: detections.map(d => ({
          className: d.className,
          score: d.score,
          bbox: d.bbox
        }))
      };
      
      fs.writeFileSync(infoFile, JSON.stringify(info, null, 2));
      
      console.log(`💾 Saved: ${filename} (${detections.length} objects)`);
      return filepath;
      
    } catch (error) {
      console.error('❌ Failed to save frame:', error);
      return null;
    }
  }

  convertRawToJPEG(rawData, outputPath) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 'rawvideo',
        '-pix_fmt', 'rgb24',
        '-s', `${this.width}x${this.height}`,
        '-i', 'pipe:0',
        '-frames:v', '1',
        '-q:v', '2', // качество JPEG (2-31, меньше = лучше)
        '-y', // перезаписывать файл
        outputPath
      ]);
      
      ffmpeg.stdin.write(rawData);
      ffmpeg.stdin.end();
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
      
      ffmpeg.on('error', reject);
    });
  }

  onFrame(callback) {
    this.frameCallback = callback;
  }

  stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}

module.exports = HLSStreamWithDetector;