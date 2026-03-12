// hls-stream-with-detector.js (исправленная версия)
const { spawn } = require('child_process');
const Detector = require('./obdetection');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); // ДЛЯ ЛУЧШЕГО ХЭШИРОВАНИЯ

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

    // УЛУЧШЕНО: более надежное хранение хэшей
    this.recentFrames = new Map();
    this.recentFramesMaxSize = 30; // Увеличил до 30
    this.frameHashThreshold = 0.95;

    // ДОБАВЛЕНО: флаг для предотвращения одновременного сохранения
    this.isSavingGrid = false;

    // ДОБАВЛЕНО: таймер для принудительной очистки буфера (если долго нет детекций)
    this.gridTimeout = null;
    this.gridMaxWaitTime = 30000; // 30 секунд максимум ожидания

    if (!fs.existsSync(this.savePath)) fs.mkdirSync(this.savePath, { recursive: true });
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
  }

  // УЛУЧШЕНО: более надежное хэширование с crypto
  calculateFrameHash(frameData) {
    return crypto.createHash('md5').update(frameData.slice(0, 10000)).digest('hex');
  }

  // УЛУЧШЕНО: проверка на дубликат с временной защитой
  isDuplicateFrame(frameData) {
    const hash = this.calculateFrameHash(frameData);
    const now = Date.now();

    // Проверяем, есть ли такой хэш и не слишком ли он старый
    if (this.recentFrames.has(hash)) {
      const lastSeen = this.recentFrames.get(hash);
      // Если кадр уже был за последние 5 секунд - считаем дубликатом
      if (now - lastSeen < 5000) {
        console.log(`⚠️ Duplicate frame detected (hash: ${hash.substring(0, 8)}...)`);
        return true;
      }
    }

    // Добавляем новый хэш
    this.recentFrames.set(hash, now);

    // Ограничиваем размер Map
    if (this.recentFrames.size > this.recentFramesMaxSize) {
      const oldestKey = this.recentFrames.keys().next().value;
      this.recentFrames.delete(oldestKey);
    }

    return false;
  }

  // ДОБАВЛЕНО: сброс таймера буфера
  resetGridTimeout() {
    if (this.gridTimeout) {
      clearTimeout(this.gridTimeout);
    }

    // Устанавливаем новый таймер
    this.gridTimeout = setTimeout(() => {
      if (this.gridBuffer.length > 0 && !this.isSavingGrid) {
        console.log(`⚠️ Grid buffer timeout (${this.gridBuffer.length} frames). Saving partial grid...`);
        // Сохраняем то, что есть (если больше 1 кадра)
        if (this.gridBuffer.length >= 2) {
          this.saveGridImage(true); // true = принудительное сохранение
        } else {
          this.gridBuffer = []; // Просто очищаем если только 1 кадр
        }
      }
    }, this.gridMaxWaitTime);
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
      // Можно раскомментировать для отладки
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

        // УЛУЧШЕНО: проверка на дубликат с учетом времени
        if (this.isDuplicateFrame(frameData)) {
          return;
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

    // УЛУЧШЕНО: не добавляем кадры если идет сохранение
    if (this.isSavingGrid) {
      console.log('⏳ Grid is being saved, skipping frame...');
      return false;
    }

    const now = Date.now() / 1000;

    this.gridBuffer.push({
      data: frameData,
      detections: detections,
      timestamp: now,
      datetime: new Date().toISOString(),
      frameNumber: this.frameCounter
    });

    console.log(`📸 Added frame to grid buffer (${this.gridBuffer.length}/${this.gridXCount * this.gridYCount})`);

    // Сбрасываем таймер при добавлении кадра
    this.resetGridTimeout();

    if (this.gridBuffer.length >= this.gridXCount * this.gridYCount) {
      // УЛУЧШЕНО: небольшая задержка перед сохранением
      await new Promise(resolve => setTimeout(resolve, 100));

      // ДОБАВЛЕНО: проверка что буфер все еще полный (мог измениться за время задержки)
      if (this.gridBuffer.length >= this.gridXCount * this.gridYCount && !this.isSavingGrid) {
        await this.saveGridImage();
      }
      return true;
    }

    return false;
  }

  async saveGridImage(force = false) {
    // УЛУЧШЕНО: защита от множественных сохранений
    if (this.isSavingGrid) {
      console.log('⏳ Already saving grid, skipping...');
      return null;
    }

    this.isSavingGrid = true;

    // Отменяем таймер
    if (this.gridTimeout) {
      clearTimeout(this.gridTimeout);
      this.gridTimeout = null;
    }

    try {
      // ДОБАВЛЕНО: проверка что буфер не пуст
      if (this.gridBuffer.length === 0) {
        console.log('⚠️ Grid buffer is empty, nothing to save');
        return null;
      }

      const firstFrame = this.gridBuffer[0];
      const lastFrame = this.gridBuffer[this.gridBuffer.length - 1];

      const formatDateForFilename = (isoString) => {
        return isoString
          .replace(/[:.]/g, '-')
          .replace('T', '_')
          .substring(0, 19);
      };

      const startDateStr = formatDateForFilename(firstFrame.datetime);
      const endDateStr = formatDateForFilename(lastFrame.datetime);

      // УЛУЧШЕНО: уникальность имени с микросекундами если force
      let filename;
      if (force) {
        const now = new Date().toISOString()
          .replace(/[:.]/g, '-')
          .replace('T', '_')
          .substring(0, 23);
        filename = `[${startDateStr}]-[${endDateStr}]_partial_${now}.jpeg`;
      } else {
        filename = `[${startDateStr}]-[${endDateStr}].jpeg`;
      }

      const filepath = path.join(this.savePath, filename);

      // УЛУЧШЕНО: атомарная проверка существования файла
      try {
        await fs.promises.access(filepath, fs.constants.F_OK);
        console.log(`⚠️ File already exists: ${filename}`);

        // Если файл существует, добавляем суффикс
        const baseName = filename.replace('.jpeg', '');
        filename = `${baseName}_${Date.now()}.jpeg`;
        console.log(`   Using alternative name: ${filename}`);
      } catch (e) {
        // Файл не существует - отлично!
      }

      // Копируем буфер для сохранения
      const bufferToSave = [...this.gridBuffer];

      // Очищаем буфер ДО сохранения, чтобы новые кадры не добавлялись
      this.gridBuffer = [];

      // Создаем изображение
      await this.createGridImage(bufferToSave, path.join(this.savePath, filename));

      console.log(`💾 Saved grid image: ${filename} (${bufferToSave.length} frames)`);
      console.log(`   Time range: ${startDateStr} → ${endDateStr}`);

      // Обновляем lastSaveTime
      this.lastSaveTime = Date.now() / 1000;

      return filepath;

    } catch (error) {
      console.error('❌ Failed to save grid image:', error);

      // В случае ошибки возвращаем кадры обратно в буфер?
      // Лучше не надо, чтобы не создавать циклы

      return null;
    } finally {
      // Всегда снимаем флаг сохранения
      this.isSavingGrid = false;
    }
  }

  async createGridImage(buffer, outputPath) {
    return new Promise((resolve, reject) => {
      const tempDir = path.join(this.tempDir, 'grid_temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFiles = [];
      const savePromises = buffer.map((item, index) => {
        const tempFile = path.join(tempDir, `frame_${Date.now()}_${index.toString().padStart(3, '0')}.jpg`);
        tempFiles.push(tempFile);
        return this.convertRawToJPEG(item.data, tempFile);
      });

      Promise.all(savePromises)
        .then(() => {
          // УЛУЧШЕНО: используем точный подсчет для сетки
          const actualCount = tempFiles.length;
          const gridCols = Math.min(this.gridXCount, actualCount);
          const gridRows = Math.ceil(actualCount / gridCols);

          const ffmpegArgs = [
            ...tempFiles.flatMap(file => ['-i', file]),
            '-filter_complex',
            `tile=${gridCols}x${gridRows}`,
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
              console.log(`✅ Grid image created: ${path.basename(outputPath)}`);
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

    if (now - this.lastSaveTime < this.saveCooldown) {
      return false;
    }

    const date = new Date();
    const dateStr = date.toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .substring(0, 19);

    const filename = `[${dateStr}].jpeg`;
    const filepath = path.join(this.savePath, filename);

    // Проверяем существование файла
    try {
      await fs.promises.access(filepath, fs.constants.F_OK);
      console.log(`⚠️ File already exists for this second: ${filename}`);
      return false;
    } catch (e) {
      // Файла нет - сохраняем
    }

    await this.saveFrame(frameData, filepath);

    this.lastSaveTime = now;
    return true;
  }

  async saveFrame(frameData, filepath) {
    try {
      await this.convertRawToJPEG(frameData, filepath);
      console.log(`💾 Saved: ${path.basename(filepath)}`);
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

    // Очищаем таймеры
    if (this.gridTimeout) {
      clearTimeout(this.gridTimeout);
      this.gridTimeout = null;
    }
  }
}

module.exports = HLSStreamWithDetector;