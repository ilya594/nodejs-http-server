// activity-server.js или добавь в существующий роутер
const express = require('express');
const fs = require('fs');
const path = require('path');

const activityRouter = express.Router();
const SNAPSHOTS_DIR = '/var/www/detections/'; // путь к твоим снепшотам

// Вспомогательная функция для парсинга даты из имени файла
function parseSnapshotDate(filename) {
    // Формат: [2026-02-28_06-25-29]-[2026-02-28_07-06-11].jpg
    const match = filename.match(/\[(.*?)\]-\[(.*?)\]/);

    if (match) {
        const startDateStr = match[1]; // "2026-02-28_06-25-29"
        const [datePart, timePart] = startDateStr.split('_');
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute, second] = timePart.split('-').map(Number);

        return new Date(year, month - 1, day, hour, minute, second);
    }

    // Если имя не соответствует формату, используем время создания файла
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
            const hourlyData = new Array(24).fill(null).map((_, hour) => {
                const hourDate = new Date(startOfDay);
                hourDate.setHours(hour, 0, 0, 0);

                return {
                    hour: hour, // 0-23
                    timestamp: hourDate.getTime(),
                    date: hourDate.toISOString(),
                    count: 0,
                    snapshots: []
                };
            });

            // Обрабатываем снапшоты
            snapshots.forEach(filename => {
                let snapshotDate = parseSnapshotDate(filename);

                if (snapshotDate >= startOfDay && snapshotDate <= endOfDay) {
                    const hour = snapshotDate.getHours(); // 0-23
                    hourlyData[hour].count++;
                    hourlyData[hour].snapshots.push(`/snapshots/${filename}`);
                }
            });

            // Возвращаем сразу массив (уже отсортирован по часам)
            res.json(hourlyData);
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
            const hourlyData = new Array(24).fill(null).map((_, hour) => {
                const hourDate = new Date(startOfDay);
                hourDate.setHours(hour, 0, 0, 0);

                return {
                    hour: hour, // 0-23
                    timestamp: hourDate.getTime(),
                    date: hourDate.toISOString(),
                    count: 0,
                    snapshots: []
                };
            });

            // Обрабатываем снапшоты
            snapshots.forEach(filename => {
                let snapshotDate = parseSnapshotDate(filename);

                if (snapshotDate >= startOfDay && snapshotDate <= endOfDay) {
                    const hour = snapshotDate.getHours(); // 0-23
                    hourlyData[hour].count++;
                    hourlyData[hour].snapshots.push(`/snapshots/${filename}`);
                }
            });

            // Возвращаем сразу массив (уже отсортирован по часам)
            res.json(hourlyData);
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