// obdetection.js
'use strict';

// Динамический импорт для ES Module
let AutoModel, AutoProcessor, RawImage;

// Загружаем модуль асинхронно
async function loadTransformers() {
    try {
        const transformers = await import('@xenova/transformers');
        AutoModel = transformers.AutoModel;
        AutoProcessor = transformers.AutoProcessor;
        RawImage = transformers.RawImage;
        console.log('✅ Transformers.js loaded successfully');
    } catch (error) {
        console.error('❌ Failed to load Transformers.js:', error);
        throw error;
    }
}

class Detector {

    constructor(config = {}) { }

    async initialize() {
        console.log('🔄 Initializing YOLO detector...');

        // Загружаем transformers если ещё не загружен
        if (!this.transformersLoaded) {
            await loadTransformers();
            this.transformersLoaded = true;
        }


        try {
            this.model = await AutoModel.from_pretrained('onnx-community/yolov10n', { quantized: true });
            this.processor = await AutoProcessor.from_pretrained('onnx-community/yolov10n');

            this.isInitialized = true;
            console.log('✅ YOLO detector initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize detector:', error);
            throw error;
        }
    }

    async detectFromBuffer(frameData, width = 1280, height = 720) {
        const image = new RawImage(frameData, width, height, 3);
        const { pixel_values, original_sizes } = await this.processor(image);
        const startTime = performance.now();
        const { output0 } = await this.model({ images: pixel_values });
        const inferenceTime = performance.now() - startTime;

        const predictions = output0.tolist()[0];

        const threshold = 0.5;
        const detections = [];

        for (const [xmin, ymin, xmax, ymax, score, classId] of predictions) {
            if (score < threshold) continue;

            const detection = {
                bbox: [xmin, ymin, xmax, ymax],
                score: score,
                classId: classId,
                className: this.model.config.id2label[classId] || `class_${classId}`,
                inferenceTime: inferenceTime
            };

            detections.push(detection);
            console.log(`🔍 Found "${detection.className}" at [${xmin.toFixed(0)}, ${ymin.toFixed(0)}, ${xmax.toFixed(0)}, ${ymax.toFixed(0)}] with score ${score.toFixed(2)} (${inferenceTime.toFixed(0)}ms)`);
        }
        return detections;
    }

    async detect(track) {
        if (!this.isInitialized) {
            throw new Error('Detector not initialized. Call initialize() first.');
        }

        this.frameCounter++;
        if (this.frameCounter % this.frameSkip !== 0) {
            return [];
        }

        try {
            const imageCapture = new ImageCapture(track);
            const bitmap = await imageCapture.grabFrame();

            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            const image = new RawImage(imageData.data, canvas.width, canvas.height, 4);

            const { pixel_values, original_sizes } = await this.processor(image);

            const startTime = performance.now();
            const { output0 } = await this.model({ images: pixel_values });
            const inferenceTime = performance.now() - startTime;

            const predictions = output0.tolist()[0];

            const threshold = 0.5;
            const detections = [];

            for (const [xmin, ymin, xmax, ymax, score, classId] of predictions) {
                if (score < threshold) continue;

                const detection = {
                    bbox: [xmin, ymin, xmax, ymax],
                    score: score,
                    classId: classId,
                    className: this.model.config.id2label[classId] || `class_${classId}`,
                    inferenceTime: inferenceTime
                };

                detections.push(detection);
                console.log(`🔍 Found "${detection.className}" at [${xmin.toFixed(0)}, ${ymin.toFixed(0)}, ${xmax.toFixed(0)}, ${ymax.toFixed(0)}] with score ${score.toFixed(2)} (${inferenceTime.toFixed(0)}ms)`);
            }
            this.onDetection(detections);
            return detections;

        } catch (error) {
            console.error('❌ Detection error:', error);
            return [];
        }
    }
}

module.exports = Detector;