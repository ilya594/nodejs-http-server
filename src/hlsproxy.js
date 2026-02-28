// hls-stream-with-detector.js
const { spawn } = require('child_process');
const Detector = require('./obdetection');
const fs = require('fs');
const path = require('path');



class HLSStreamWithDetector {
  constructor(cameraName = 'camera', detectorConfig = {}) {
    this.playlistUrl = `http://195.137.244.53:8888/${cameraName}/index.m3u8`;
    this.tempDir = './temp_hls';
    this.detector = new Detector(detectorConfig);
    this.frameCallback = null;
    this.frameSkip = detectorConfig.frameSkip || 5;
    this.frameCounter = 0;
    this.saveEnabled = detectorConfig.saveEnabled || true;
    this.lastSaveTime = 0;
    this.saveCooldown = detectorConfig.saveCooldown || 3;

    this.preBufferSec = 5;
    this.postBufferSec = 5;
    this.segmentDuration = 3;           // секунды на сегмент — удобно 2-4 с
    this.bufferSegmentsCount = 10;       // ~18 с буфера (хватит с запасом)
    this.detectionStartTime = null;
    this.detectionEndTime = null;
    this.detectionActive = false;
    this.detectionTimeout = null;
    this.savePath = '/var/www/detections';     // куда класть готовые клипы
    this.maxClipDuration = 10;                // максимальная длительность одного клипа (секунды)
    this.detectionsBuffer = [];               // массив всех детекций за текущий эпизод
    this.clipStartTime = null;                // начало текущего клипа

    if (!fs.existsSync(this.savePath)) fs.mkdirSync(this.savePath, { recursive: true });
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
  }

  async initialize() {
    console.log('🔄 Initializing detector...');
    await this.detector.initialize();
    this.start();
    //this.startBufferRecorder();
    console.log('✅ Detector ready');
  }

  startBufferRecorder() {
    const { spawn } = require('child_process');

    console.log('Starting circular HLS buffer for pre/post recording...');
    //delete_segments+
    this.bufferProcess = spawn('ffmpeg', [
      '-i', this.playlistUrl,
      '-c:v', 'copy',                // без перекодирования — быстро и качественно
      '-c:a', 'copy',
      '-f', 'hls',
      '-hls_time', this.segmentDuration.toString(),
      '-hls_list_size', this.bufferSegmentsCount.toString(),
      '-hls_flags', 'append_list+discont_start',
      '-hls_segment_filename', path.join(path.resolve(this.tempDir), 'buf_%03d.ts'),
      '-hls_playlist_type', 'vod',   // или event, но delete_segments важнее
      path.join(path.resolve(this.tempDir), 'buffer.m3u8')
    ]);

    this.bufferProcess.stderr.on('data', (data) => {
      console.log(`Buffer FFmpeg: ${data.toString().trim()}`);
    });

    this.bufferProcess.on('close', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`Buffer FFmpeg failed with code ${code} (signal: ${signal})`);
        // Попробуй перезапустить через 10 с
        setTimeout(() => this.startBufferRecorder(), 10000);
      }
    });
    this.bufferProcess.on('close', (code) => {
      console.log(`Buffer FFmpeg exited with code ${code}`);
    });
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

  /*async processFrame(frameData, width, height) {
    this.frameCounter++;
    if (this.frameCounter % this.frameSkip !== 0) return;

    try {
      const detections = await this.detector.detectFromBuffer(frameData, width, height);
      const now = Date.now() / 1000;

      if (detections.length > 0) {
        // Добавляем все детекции в буфер (с текущим временем)
        detections.forEach(det => {
          this.detectionsBuffer.push({
            timestamp: now,
            className: det.className,
            score: det.score,
            bbox: det.bbox,
            inferenceTime: det.inferenceTime
          });
        });

        if (!this.detectionActive) {
          this.detectionActive = true;
          this.detectionStartTime = now;
          this.clipStartTime = now - this.preBufferSec; // начало клипа с pre-buffer
          console.log(`[Detection] Started at ${new Date(now * 1000).toISOString()}`);
        }

        this.detectionEndTime = now;

        // Проверяем, не пора ли разбить на новый клип
        if (now - this.clipStartTime >= this.maxClipDuration) {
          // Сохраняем текущий клип (до текущего момента)
          await this.finalizeAndSaveClip(this.clipStartTime, now);
          // Начинаем новый клип с небольшим перекрытием (например, 2 секунды)
          this.clipStartTime = now - 2;
        }

        // Сбрасываем/обновляем таймер пост-буфера
        if (this.detectionTimeout) clearTimeout(this.detectionTimeout);
        this.detectionTimeout = setTimeout(() => this.finalizeAndSaveClip(this.clipStartTime, this.detectionEndTime + this.postBufferSec), (this.postBufferSec + 2) * 1000);
      }

      if (this.frameCallback) {
        this.frameCallback(detections, frameData, width, height);
      }
    } catch (err) {
      console.error('Detection error in processFrame:', err);
    }
  }*/

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

  async finalizeAndSaveClip(clipStart, clipEnd) {
    if (!this.detectionActive) return;

    const duration = clipEnd - clipStart;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = path.join(this.savePath, `${timestamp}_detection_${Math.round(duration)}s.mp4`);

    console.log(`Saving clip: ${clipStart.toFixed(1)}s → ${clipEnd.toFixed(1)}s (${duration.toFixed(1)}s) → ${outputFile}`);
    const playlistPath = path.join(path.resolve(this.tempDir), 'buffer.m3u8');

    let attempts = 0;
    while (attempts < 5 && !require('fs').existsSync(playlistPath)) {
      console.log(`Waiting for buffer.m3u8... attempt ${attempts + 1}`);
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    }

    if (!require('fs').existsSync(playlistPath)) {
      console.error('buffer.m3u8 still missing after waiting. Skipping clip.');
      this.resetDetection();
      return;
    }
    const ffmpegArgs = [
      '-i', path.join(path.resolve(this.tempDir), 'buffer.m3u8'),
      '-ss', Math.max(0, (Date.now() / 1000 - clipEnd)).toFixed(1), // смещение от текущего момента назад
      '-t', duration.toFixed(1),
      '-c', 'copy',
      '-y',
      outputFile
    ];

    console.log('CLIP FFMPEG COMMAND:', ['ffmpeg', ...ffmpegArgs].join(' '));

    const { spawn } = require('child_process');
    const clipProcess = spawn('ffmpeg', ffmpegArgs);

    clipProcess.stderr.on('data', (data) => {
      console.error(`CLIP FFMPEG STDERR: ${data.toString().trim()}`);
    });

    return new Promise((resolve, reject) => {
      clipProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`Clip saved: ${outputFile}`);
          this.saveMetadata(outputFile, clipStart, clipEnd);
          resolve(outputFile);
        } else {
          console.error(`Clip creation failed with code ${code}`);
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      clipProcess.on('error', err => {
        console.error('Clip process error:', err);
        reject(err);
      });
    });
  }

  resetDetection() {
    // Очищаем буфер только когда весь эпизод детекции закончился
    // (после последнего клипа)
    this.detectionActive = false;
    this.detectionStartTime = null;
    this.detectionEndTime = null;
    this.clipStartTime = null;
    if (this.detectionTimeout) {
      clearTimeout(this.detectionTimeout);
      this.detectionTimeout = null;
    }
    // Буфер очищаем только если нет активной детекции
    if (!this.detectionActive) {
      this.detectionsBuffer = [];
    }
  }

  saveMetadata(mp4Path, startTime, endTime) {
    const metaPath = mp4Path.replace('.mp4', '.json');

    // Фильтруем детекции, которые попали в интервал этого клипа
    const clipDetections = this.detectionsBuffer.filter(det =>
      det.timestamp >= startTime && det.timestamp <= endTime
    );

    const meta = {
      startTime: new Date(startTime * 1000).toISOString(),
      endTime: new Date(endTime * 1000).toISOString(),
      duration: endTime - startTime,
      camera: this.playlistUrl,
      totalDetections: clipDetections.length,
      detections: clipDetections
    };

    require('fs').writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    console.log(`Metadata saved: ${metaPath} (${clipDetections.length} detections)`);
  }

  async convertRawToJPEG(rawData, outputPath) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-f', 'rawvideo',
        '-pix_fmt', 'bgr24',         // У тебя BGR24 в основном потоке, но здесь rgb24 — проверь!
        '-s', `${this.width}x${this.height}`,
        '-i', 'pipe:0',
        '-frames:v', '1',
        '-q:v', '2',
        '-y',
        outputPath
      ]);

      // Логируем ошибки FFmpeg — ОБЯЗАТЕЛЬНО!
      ffmpeg.stderr.on('data', (data) => {
        console.error(`FFmpeg STDERR (save frame): ${data.toString().trim()}`);
      });

      ffmpeg.on('error', (err) => {
        reject(err);
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      // Проверяем, можно ли писать
      if (ffmpeg.stdin.destroyed || ffmpeg.killed) {
        reject(new Error('FFmpeg stdin already closed or process killed'));
        return;
      }

      // Пишем данные
      ffmpeg.stdin.write(rawData, (err) => {
        if (err) {
          console.error('Write error:', err);
          reject(err);
          return;
        }

        // Только после успешной записи — end()
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