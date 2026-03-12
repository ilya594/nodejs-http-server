// hls-stream-with-detector.js
const { spawn } = require('child_process');
const Detector = require('./obdetection');
const fs = require('fs');
const path = require('path');

class HLSStreamWithDetector {
  constructor(cameraName = 'camera', detectorConfig = {}) {
    this.playlistUrl = 'http://195.137.244.53:8888/camera/index.m3u8';
    this.tempDir = './temp_hls';
    this.savePath = '/var/www/detections/';
    this.detector = new Detector(detectorConfig);
    this.frameCallback = null;
    this.frameSkip = detectorConfig.frameSkip || 5;
    this.frameCounter = 0;
    this.saveEnabled = detectorConfig.saveEnabled || true;
    this.lastSaveTime = 0;
    this.saveCooldown = detectorConfig.saveCooldown || 4;

    // Параметры для сохранения сетки
    this.gridXCount = detectorConfig.xcount || 4;
    this.gridYCount = detectorConfig.ycount || 4;
    this.gridBuffer = [];
    this.gridSaveEnabled = detectorConfig.gridSaveEnabled || true;
    
    // ДОБАВЛЕНО: хранение последних сохраненных кадров для предотвращения дубликатов
    this.recentFrames = new Map(); // Храним хэши последних кадров
    this.recentFramesMaxSize = 10; // Храним до 10 последних хэшей
    this.frameHashThreshold = 0.85; // Порог схожести (если нужно)

    if (!fs.existsSync(this.savePath)) fs.mkdirSync(this.savePath, { recursive: true });
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
  }

  // ДОБАВЛЕНО: простой хэш для сравнения кадров
  calculateFrameHash(frameData) {
    // Берем выборку пикселей для быстрого сравнения
    const sampleSize = 100;
    const step = Math.floor(frameData.length / sampleSize);
    let hash = 0;
    
    for (let i = 0; i < frameData.length; i += step) {
      hash = ((hash << 5) - hash) + frameData[i];
      hash |= 0; // Преобразуем в 32-битное целое
    }
    
    return hash.toString(16);
  }

  // ДОБАВЛЕНО: проверка на дубликат кадра
  isDuplicateFrame(frameData) {
    const hash = this.calculateFrameHash(frameData);
    
    if (this.recentFrames.has(hash)) {
      console.log(`⚠️ Duplicate frame detected (hash: ${hash.substring(0, 8)}...)`);
      return true;
    }
    
    // Добавляем новый хэш
    this.recentFrames.set(hash, Date.now());
    
    // Ограничиваем размер Map
    if (this.recentFrames.size > this.recentFramesMaxSize) {
      const oldestKey = this.recentFrames.keys().next().value;
      this.recentFrames.delete(oldestKey);
    }
    
    return false;
  }

  async initialize() {
    console.log('🔄 Initializing detector...');
    await this.detector.initialize();
    this.start();
    console.log('✅ Detector ready');
    console.log(`📸 Grid save mode: ${this.gridSaveEnabled ? 'ENABLED' : 'DISABLED'} (${this.gridXCount}x${this.gridYCount} grid)`);
  }

  async start(options = {}) {
    const {
      width = 1280,
      height = 720,
      fps = 20,
      pixelFormat = 'bgr24'
    } = options;
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.pixelFormat = pixelFormat;
    console.log(`📡 Connecting to HLS stream: ${this.playlistUrl}`);

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
    const frameSize = width * height * 3;

    this.process.stdout.on('data', (data) => {
      frameBuffer = Buffer.concat([frameBuffer, data]);

      while (frameBuffer.length >= frameSize) {
        const frameData = frameBuffer.slice(0, frameSize);
        frameBuffer = frameBuffer.slice(frameSize);

        this.processFrame(frameData, width, height);
      }
    });

    this.process.stderr.on('data', (data) => {
      // console.log(`FFmpeg: ${data.toString()}`);
    });

    this.process.on('close', (code) => {
      console.log(`FFmpeg process closed with code ${code}...restarting in 10seconds..`);
      setTimeout(() => this.start(), 10000);
    });
  }

  async processFrame(frameData, width, height) {
    this.frameCounter++;

    if (this.frameCounter % this.frameSkip !== 0) {
      return;
    }

    try {
      const detections = await this.detector.detectFromBuffer(frameData);

      if (detections.length > 0) {
        console.log(`[Frame ${this.frameCounter}] Found ${detections.length} objects`);

        // ИСПРАВЛЕНО: проверка на дубликат кадра
        if (this.isDuplicateFrame(frameData)) {
          return; // Пропускаем дубликат
        }

        if (this.gridSaveEnabled) {
          await this.addFrameToGrid(frameData, detections);
        } else {
          await this.checkAndSaveFrame(frameData, detections);
        }

        if (this.frameCallback) {
          this.frameCallback(detections, frameData, width, height);
        }
      }
    } catch (error) {
      console.error('Detection error:', error);
    }
  }

  async addFrameToGrid(frameData, detections) {
    if (!this.saveEnabled) return false;

    const now = Date.now() / 1000;

    // ИСПРАВЛЕНО: lastSaveTime теперь только для режима без сетки
    // Для сетки используем другой подход

    this.gridBuffer.push({
      data: frameData,
      detections: detections,
      timestamp: now,
      datetime: new Date().toISOString(),
      frameNumber: this.frameCounter
    });

    console.log(`📸 Added frame to grid buffer (${this.gridBuffer.length}/${this.gridXCount * this.gridYCount})`);

    if (this.gridBuffer.length >= this.gridXCount * this.gridYCount) {
      await this.saveGridImage();
      this.gridBuffer = []; // Очищаем буфер
      // ИСПРАВЛЕНО: НЕ обновляем lastSaveTime здесь!
      return true;
    }

    return false;
  }

  async saveGridImage() {
    try {
      const firstFrame = this.gridBuffer[0];
      const lastFrame = this.gridBuffer[this.gridBuffer.length - 1];

      // Форматируем даты: YYYY-MM-DD_HH-MM-SS
      const formatDateForFilename = (isoString) => {
        return isoString
          .replace(/[:.]/g, '-')
          .replace('T', '_')
          .substring(0, 19);
      };

      const startDateStr = formatDateForFilename(firstFrame.datetime);
      const endDateStr = formatDateForFilename(lastFrame.datetime);

      // ДОБАВЛЕНО: проверка существования файла
      const filename = `[${startDateStr}]-[${endDateStr}].jpeg`;
      const filepath = path.join(this.savePath, filename);

      // Проверяем, не существует ли уже такой файл
      if (fs.existsSync(filepath)) {
        console.log(`⚠️ File already exists: ${filename}`);
        return filepath;
      }

      await this.createGridImage(filepath);

      console.log(`💾 Saved grid image: ${filename} (${this.gridBuffer.length} frames)`);
      console.log(`   Time range: ${startDateStr} → ${endDateStr}`);
      
      // ДОБАВЛЕНО: обновляем lastSaveTime ТОЛЬКО после успешного сохранения сетки
      this.lastSaveTime = Date.now() / 1000;
      
      return filepath;

    } catch (error) {
      console.error('❌ Failed to save grid image:', error);
      return null;
    }
  }

  async createGridImage(outputPath) {
    return new Promise((resolve, reject) => {
      const tempDir = path.join(this.tempDir, 'grid_temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFiles = [];
      const savePromises = this.gridBuffer.map((item, index) => {
        const tempFile = path.join(tempDir, `frame_${index.toString().padStart(3, '0')}.jpg`);
        tempFiles.push(tempFile);
        return this.convertRawToJPEG(item.data, tempFile);
      });

      Promise.all(savePromises)
        .then(() => {
          const ffmpegArgs = [
            ...tempFiles.flatMap(file => ['-i', file]),
            '-filter_complex',
            `concat=n=${tempFiles.length}:v=1:a=0,scale=${this.width}:${this.height},tile=${this.gridXCount}x${this.gridYCount}`,
            '-frames:v', '1',
            '-q:v', '2',
            '-y',
            outputPath
          ];

          console.log('Creating grid with ffmpeg...');

          const ffmpeg = spawn('ffmpeg', ffmpegArgs);

          let stderrData = '';
          ffmpeg.stderr.on('data', (data) => {
            stderrData += data.toString();
          });

          ffmpeg.on('error', (err) => {
            reject(err);
          });

          ffmpeg.on('close', (code) => {
            // Очищаем временные файлы
            tempFiles.forEach(file => {
              try { fs.unlinkSync(file); } catch (e) { }
            });

            if (code === 0) {
              console.log(`✅ Grid image created: ${outputPath}`);
              resolve(outputPath);
            } else {
              console.error('FFmpeg stderr:', stderrData);
              reject(new Error(`FFmpeg grid creation failed with code ${code}`));
            }
          });
        })
        .catch(reject);
    });
  }

  async checkAndSaveFrame(frameData, detections) {
    if (!this.saveEnabled) return false;

    const now = Date.now() / 1000;

    // Проверяем cooldown
    if (now - this.lastSaveTime < this.saveCooldown) {
      return false;
    }

    // ДОБАВЛЕНО: дополнительная проверка на дубликат по времени
    const date = new Date();
    const dateStr = date.toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .substring(0, 19);
    
    const filename = `[${dateStr}].jpeg`;
    const filepath = path.join(this.savePath, filename);

    // Проверяем, не существует ли уже файл с такой же секундой
    if (fs.existsSync(filepath)) {
      console.log(`⚠️ File already exists for this second: ${filename}`);
      return false;
    }

    await this.saveFrame(frameData);

    this.lastSaveTime = now;
    return true;
  }

  async saveFrame(frameData) {
    try {
      const now = new Date();
      const dateStr = now.toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .substring(0, 19);

      const filename = `[${dateStr}].jpeg`;
      const filepath = path.join(this.savePath, filename);

      // ДОБАВЛЕНО: финальная проверка перед сохранением
      if (fs.existsSync(filepath)) {
        console.log(`⚠️ File already exists: ${filename}`);
        return null;
      }

      await this.convertRawToJPEG(frameData, filepath);

      console.log(`💾 Saved: ${filename}`);
      return filepath;

    } catch (error) {
      console.error('❌ Failed to save frame:', error);
      return null;
    }
  }

  async convertRawToJPEG(rawData, outputPath) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 'rawvideo',
        '-pix_fmt', 'bgr24',
        '-s', `${this.width}x${this.height}`,
        '-i', 'pipe:0',
        '-frames:v', '1',
        '-q:v', '2',
        '-y',
        outputPath
      ]);

      let stderrData = '';
      ffmpeg.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      ffmpeg.on('error', (err) => {
        reject(err);
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(outputPath);
        } else {
          console.error('FFmpeg error details:', stderrData);
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      if (ffmpeg.stdin.destroyed || ffmpeg.killed) {
        reject(new Error('FFmpeg stdin already closed or process killed'));
        return;
      }

      ffmpeg.stdin.write(rawData, (err) => {
        if (err) {
          reject(err);
          return;
        }
        ffmpeg.stdin.end();
      });
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