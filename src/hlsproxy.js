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

    // НОВЫЕ ПАРАМЕТРЫ ДЛЯ СОХРАНЕНИЯ СЕТКИ
    this.gridXCount = detectorConfig.xcount || 5;      // количество кадров по горизонтали
    this.gridYCount = detectorConfig.ycount || 5;      // количество кадров по вертикали
    this.gridBuffer = [];                               // буфер для накопления кадров
    this.gridSaveEnabled = detectorConfig.gridSaveEnabled || true; // включить/выключить режим сетки

    this.preBufferSec = 5;
    this.postBufferSec = 5;
    this.segmentDuration = 3;
    this.bufferSegmentsCount = 10;
    this.detectionStartTime = null;
    this.detectionEndTime = null;
    this.detectionActive = false;
    this.detectionTimeout = null;
    this.savePath = '/var/www/detections';
    this.maxClipDuration = 10;
    this.detectionsBuffer = [];
    this.clipStartTime = null;

    if (!fs.existsSync(this.savePath)) fs.mkdirSync(this.savePath, { recursive: true });
    if (!fs.existsSync(this.tempDir)) fs.mkdirSync(this.tempDir, { recursive: true });
  }

  async initialize() {
    console.log('🔄 Initializing detector...');
    await this.detector.initialize();
    this.start();
    console.log('✅ Detector ready');
    console.log(`📸 Grid save mode: ${this.gridSaveEnabled ? 'ENABLED' : 'DISABLED'} (${this.gridXCount}x${this.gridYCount} grid)`);
  }

  startBufferRecorder() {
    const { spawn } = require('child_process');

    console.log('Starting circular HLS buffer for pre/post recording...');
    this.bufferProcess = spawn('ffmpeg', [
      '-i', this.playlistUrl,
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-f', 'hls',
      '-hls_time', this.segmentDuration.toString(),
      '-hls_list_size', this.bufferSegmentsCount.toString(),
      '-hls_flags', 'append_list+discont_start',
      '-hls_segment_filename', path.join(path.resolve(this.tempDir), 'buf_%03d.ts'),
      '-hls_playlist_type', 'vod',
      path.join(path.resolve(this.tempDir), 'buffer.m3u8')
    ]);

    this.bufferProcess.stderr.on('data', (data) => {
      console.log(`Buffer FFmpeg: ${data.toString().trim()}`);
    });

    this.bufferProcess.on('close', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`Buffer FFmpeg failed with code ${code} (signal: ${signal})`);
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

        // ИЗМЕНЕНО: проверяем режим сохранения
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
  /**
   * НОВЫЙ МЕТОД: Добавляет кадр в буфер сетки и сохраняет при накоплении
   */
  async addFrameToGrid(frameData, detections) {
    if (!this.saveEnabled) return false;

    const now = Date.now() / 1000;

    // Проверяем cooldown для предотвращения слишком частых сохранений
    if (now - this.lastSaveTime < this.saveCooldown) {
      return false;
    }

    // Добавляем кадр в буфер с метаданными
    this.gridBuffer.push({
      data: frameData,
      detections: detections,
      timestamp: now,
      datetime: new Date().toISOString(), // Добавляем полную дату для формирования имени
      frameNumber: this.frameCounter
    });

    console.log(`📸 Added frame to grid buffer (${this.gridBuffer.length}/${this.gridXCount * this.gridYCount})`);

    // Если набрали достаточно кадров - сохраняем сетку
    if (this.gridBuffer.length >= this.gridXCount * this.gridYCount) {
      await this.saveGridImage();
      this.gridBuffer = []; // Очищаем буфер
      this.lastSaveTime = now;
      return true;
    }

    return false;
  }

  /**
   * НОВЫЙ МЕТОД: Сохраняет сетку из накопленных кадров
   */
  async saveGridImage() {
    try {
      // Получаем дату первого и последнего кадра в буфере
      const firstFrame = this.gridBuffer[0];
      const lastFrame = this.gridBuffer[this.gridBuffer.length - 1];

      // Форматируем даты для имени файла: YYYY-MM-DD_HH-MM-SS
      const formatDateForFilename = (isoString) => {
        return isoString
          .replace(/[:.]/g, '-')     // Заменяем : и . на -
          .replace('T', '_')          // Заменяем T на _
          .substring(0, 19);          // Оставляем только YYYY-MM-DD_HH-MM-SS
      };

      const startDateStr = formatDateForFilename(firstFrame.datetime);
      const endDateStr = formatDateForFilename(lastFrame.datetime);

      // Собираем все уникальные классы из всех кадров в буфере
      const allClasses = new Set();
      this.gridBuffer.forEach(item => {
        item.detections.forEach(d => allClasses.add(d.className));
      });
      const detectedStr = Array.from(allClasses).join('_') || 'empty';

      // Новый формат имени: [первая дата]-[последняя дата]_grid_объекты.jpg
      const filename = `[${startDateStr}]-[${endDateStr}]_grid_${this.gridXCount}x${this.gridYCount}_${detectedStr}.jpg`;
      const filepath = path.join(this.savePath, filename);

      // Создаем сетку из кадров
      await this.createGridImage(filepath);

      // Сохраняем метаданные для всех кадров в сетке
      const infoFile = filepath.replace('.jpg', '.json');
      const info = {
        timestamp: new Date().toISOString(),
        gridSize: `${this.gridXCount}x${this.gridYCount}`,
        camera: this.playlistUrl,
        resolution: `${this.width}x${this.height}`,
        timeRange: {
          start: firstFrame.datetime,
          end: lastFrame.datetime
        },
        frames: this.gridBuffer.map(item => ({
          frameNumber: item.frameNumber,
          datetime: item.datetime,
          timestamp: item.timestamp,
          detections: item.detections.map(d => ({
            className: d.className,
            score: d.score,
            bbox: d.bbox
          }))
        }))
      };

      fs.writeFileSync(infoFile, JSON.stringify(info, null, 2));

      console.log(`💾 Saved grid image: ${filename} (${this.gridBuffer.length} frames, ${allClasses.size} object types)`);
      console.log(`   Time range: ${startDateStr} → ${endDateStr}`);
      return filepath;

    } catch (error) {
      console.error('❌ Failed to save grid image:', error);
      return null;
    }
  }

  /**
   * НОВЫЙ МЕТОД: Создает изображение-сетку из буфера кадров
   */
  async createGridImage(outputPath) {
    return new Promise((resolve, reject) => {
      // Рассчитываем размеры выходного изображения
      const gridWidth = this.width * this.gridXCount;
      const gridHeight = this.height * this.gridYCount;

      // Создаем временную директорию для отдельных кадров
      const tempDir = path.join(this.tempDir, 'grid_temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Сохраняем каждый кадр из буфера как временный файл
      const tempFiles = [];
      const savePromises = this.gridBuffer.map((item, index) => {
        const tempFile = path.join(tempDir, `frame_${index.toString().padStart(3, '0')}.jpg`);
        tempFiles.push(tempFile);
        return this.convertRawToJPEG(item.data, tempFile);
      });

      // Ждем сохранения всех временных файлов
      Promise.all(savePromises)
        .then(() => {
          // Создаем фильтр для ffmpeg для создания сетки
          // Сложный фильтр: берем все входные файлы и размещаем их в сетке
          const filterComplex = [];

          // Добавляем каждый кадр как отдельный поток
          for (let i = 0; i < tempFiles.length; i++) {
            filterComplex.push(`[${i}:v] setpts=PTS, scale=${this.width}:${this.height} [img${i}]`);
          }

          // Создаем сетку из всех кадров
          const gridLayout = [];
          for (let row = 0; row < this.gridYCount; row++) {
            for (let col = 0; col < this.gridXCount; col++) {
              const idx = row * this.gridXCount + col;
              if (idx < tempFiles.length) {
                gridLayout.push(`[img${idx}]`);
              }
            }
          }

          // Соединяем все в одну команду
          // Используем hstack/vstack для создания сетки
          let layoutFilter = '';
          if (this.gridYCount === 1) {
            // Только горизонтальное объединение
            layoutFilter = `${gridLayout.join('')} hstack=inputs=${tempFiles.length}`;
          } else {
            // Сначала объединяем по горизонтали в строки, потом по вертикали
            const rowFilters = [];
            for (let row = 0; row < this.gridYCount; row++) {
              const rowInputs = [];
              for (let col = 0; col < this.gridXCount; col++) {
                const idx = row * this.gridXCount + col;
                if (idx < tempFiles.length) {
                  rowInputs.push(`[img${idx}]`);
                }
              }
              if (rowInputs.length > 0) {
                rowFilters.push(`${rowInputs.join('')} hstack=inputs=${rowInputs.length}[row${row}]`);
              }
            }

            // Объединяем строки по вертикали
            const rowRefs = [];
            for (let row = 0; row < rowFilters.length; row++) {
              rowRefs.push(`[row${row}]`);
            }
            layoutFilter = rowFilters.join(';') + ';' + rowRefs.join('') + ` vstack=inputs=${rowRefs.length}`;
          }

          const ffmpegArgs = [
            ...tempFiles.flatMap(file => ['-i', file]),
            '-filter_complex', layoutFilter,
            '-frames:v', '1',
            '-q:v', '2',
            '-y',
            outputPath
          ];

          console.log('Creating grid with ffmpeg...');

          const ffmpeg = spawn('ffmpeg', ffmpegArgs);

          ffmpeg.stderr.on('data', (data) => {
            // Можно закомментировать если не нужно видеть прогресс
            // console.log(`FFmpeg grid: ${data.toString().trim()}`);
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
              reject(new Error(`FFmpeg grid creation failed with code ${code}`));
            }
          });
        })
        .catch(reject);
    });
  }

  /**
   * ОРИГИНАЛЬНЫЙ МЕТОД: сохранение одного кадра (оставлен для обратной совместимости)
   */
  async checkAndSaveFrame(frameData, detections) {
    if (!this.saveEnabled) return false;

    const now = Date.now() / 1000;

    if (now - this.lastSaveTime < this.saveCooldown) {
      return false;
    }

    await this.saveFrame(frameData, detections);

    this.lastSaveTime = now;
    return true;
  }

  async saveFrame(frameData, detections = []) {
    try {
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
      '-ss', Math.max(0, (Date.now() / 1000 - clipEnd)).toFixed(1),
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
    this.detectionActive = false;
    this.detectionStartTime = null;
    this.detectionEndTime = null;
    this.clipStartTime = null;
    if (this.detectionTimeout) {
      clearTimeout(this.detectionTimeout);
      this.detectionTimeout = null;
    }
    if (!this.detectionActive) {
      this.detectionsBuffer = [];
    }
  }

  saveMetadata(mp4Path, startTime, endTime) {
    const metaPath = mp4Path.replace('.mp4', '.json');

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
        '-pix_fmt', 'bgr24',
        '-s', `${this.width}x${this.height}`,
        '-i', 'pipe:0',
        '-frames:v', '1',
        '-q:v', '2',
        '-y',
        outputPath
      ]);

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

      if (ffmpeg.stdin.destroyed || ffmpeg.killed) {
        reject(new Error('FFmpeg stdin already closed or process killed'));
        return;
      }

      ffmpeg.stdin.write(rawData, (err) => {
        if (err) {
          console.error('Write error:', err);
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