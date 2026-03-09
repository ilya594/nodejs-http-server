// activity-server.js или добавь в существующий роутер
const express = require('express');
const fs = require('fs');
const path = require('path');

const activityRouter = express.Router();
const SNAPSHOTS_DIR = '/var/www/detections/'; // путь к твоим снепшотам

// Вспомогательная функция для парсинга даты из имени файла
function parseSnapshotDate(filename) {
    // Формат: [2026-03-09_11-54-29]-[2026-03-09_11-55-27].jpeg
    const match = filename.match(/\[(.*?)\]-\[(.*?)\]/);

    if (match) {
        const startDateStr = match[1]; // "2026-03-09_11-54-29"
        const [datePart, timePart] = startDateStr.split('_');
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute, second] = timePart.split('-').map(Number);

        // ВАЖНО: создаем дату с учетом локального часового пояса
        // Используем конструктор с локальными значениями
        return new Date(year, month - 1, day, hour, minute, second);
    }

    return null;
}

// Получить данные для графика активности
activityRouter.get('/activity', (req, res) => {
    console.log('getting activity')
    try {
        // Читаем все файлы в директории со снепшотами
        fs.readdir(SNAPSHOTS_DIR, (err, files) => {
            console.log('[NServer] activity router: reading dir: [' + SNAPSHOTS_DIR + ']');
            if (err) {
                console.error('Error reading snapshots directory:', err);
                return res.status(500).json({ error: 'Failed to read snapshots' });
            }

            // Фильтруем только изображения
            const snapshots = files.filter(f =>
                f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')
            );

            // Группируем по часам (последние 24 часа)
            const now = new Date();
            const hourlyData = new Map();

            // Инициализируем все 24 часа нулями
            for (let i = 0; i < 24; i++) {
                const hour = new Date(now);
                hour.setHours(now.getHours() - i, 0, 0, 0);
                const hourKey = hour.getTime();
                hourlyData.set(hourKey, {
                    timestamp: hourKey,
                    date: hour.toISOString(),
                    count: 0,
                    snapshots: []
                });
            }

            // Обрабатываем каждый снапшот
            // Самый надежный способ - использовать строку в формате YYYY-MM-DD-HH
            snapshots.forEach(filename => {
                let snapshotDate = parseSnapshotDate(filename);

                if (!snapshotDate) return;

                // ПОЛУЧАЕМ ЛОКАЛЬНЫЕ КОМПОНЕНТЫ ДАТЫ
                const year = snapshotDate.getFullYear();
                const month = snapshotDate.getMonth();
                const day = snapshotDate.getDate();
                const hour = snapshotDate.getHours(); // Локальный час!

                // СОЗДАЕМ UTC TIMESTAMP, который представляет НАЧАЛО ЛОКАЛЬНОГО ЧАСА
                // Например для 11:54 LOCAL создаем timestamp 2026-03-09 11:00:00 LOCAL
                const localHourStart = new Date(year, month, day, hour, 0, 0);

                // Получаем UTC timestamp для этого момента
                const hourKey = localHourStart.getTime();

                // Теперь hourKey для 11:54 LOCAL будет соответствовать 11:00 LOCAL
                // А в UTC это будет например 08:00 или 09:00 в зависимости от часового пояса

                console.log(`File: ${filename}`);
                console.log(`  Local time: ${snapshotDate.toLocaleString()}`);
                console.log(`  Hour start local: ${localHourStart.toLocaleString()}`);
                console.log(`  Hour key (UTC ms): ${hourKey}`);
                console.log(`  Hour key as UTC: ${new Date(hourKey).toISOString()}`);

                 // Группируем по этому ключу
                if (!hourlyMap.has(hourKey)) {
                    hourlyMap.set(hourKey, {
                        timestamp: new Date(year, month - 1, day, hour, 0, 0).getTime(),
                        date: new Date(Date.UTC(year, month - 1, day, hour, 0, 0)).toISOString(),
                        count: 0,
                        snapshots: []
                    });
                }

                const data = hourlyMap.get(hourKey);
                data.count++;
                data.snapshots.push(`/snapshots/${filename}`);
            });



            // Преобразуем Map в массив и сортируем по времени
            const result = Array.from(hourlyData.values())
                .sort((a, b) => a.timestamp - b.timestamp);

            res.json(result);
        });
    } catch (error) {
        console.error('Error generating activity data:', error);
        res.status(500).json({ error: 'Failed to generate activity data' });
    }
});

// Опционально: эндпоинт для получения статистики за период
activityRouter.get('/activity/range', (req, res) => {
    try {
        const { start, end } = req.query;
        const startDate = start ? new Date(start) : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const endDate = end ? new Date(end) : new Date();

        fs.readdir(SNAPSHOTS_DIR, (err, files) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to read snapshots' });
            }

            const snapshots = files.filter(f =>
                f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')
            );

            const result = [];
            const hourlyMap = new Map();

            snapshots.forEach(filename => {
                let snapshotDate = parseSnapshotDate(filename);

                if (!snapshotDate) {
                    const filePath = path.join(SNAPSHOTS_DIR, filename);
                    const stats = fs.statSync(filePath);
                    snapshotDate = stats.mtime;
                }

                if (snapshotDate >= startDate && snapshotDate <= endDate) {
                    const hour = new Date(snapshotDate);
                    hour.setMinutes(0, 0, 0);
                    const hourKey = hour.getTime();

                    if (!hourlyMap.has(hourKey)) {
                        hourlyMap.set(hourKey, {
                            timestamp: hourKey,
                            date: hour.toISOString(),
                            count: 0,
                            snapshots: []
                        });
                    }

                    const data = hourlyMap.get(hourKey);
                    data.count++;
                    data.snapshots.push(`/snapshots/${filename}`);
                }
            });

            const sortedResult = Array.from(hourlyMap.values())
                .sort((a, b) => a.timestamp - b.timestamp);

            res.json(sortedResult);
        });
    } catch (error) {
        console.error('Error generating activity range:', error);
        res.status(500).json({ error: 'Failed to generate activity range' });
    }
});

// Опционально: получить список всех снапшотов (если еще нет)
activityRouter.get('/snapshots', (req, res) => {
    fs.readdir(SNAPSHOTS_DIR, (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to read snapshots directory' });
        }

        const images = files.filter(f =>
            f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')
        );

        res.json(images);
    });
});

module.exports = { activityRouter };