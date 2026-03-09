// activity-server.js или добавь в существующий роутер
const express = require('express');
const fs = require('fs');
const path = require('path');

const activityRouter = express.Router();
const SNAPSHOTS_DIR = path.join(__dirname, 'saved_frames'); // путь к твоим снепшотам

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
            snapshots.forEach(filename => {
                let snapshotDate = parseSnapshotDate(filename);
                
                // Если не удалось распарсить из имени, используем mtime
                if (!snapshotDate) {
                    const filePath = path.join(SNAPSHOTS_DIR, filename);
                    const stats = fs.statSync(filePath);
                    snapshotDate = stats.mtime;
                }

                // Нормализуем до начала часа
                const hour = new Date(snapshotDate);
                hour.setMinutes(0, 0, 0);
                const hourKey = hour.getTime();

                // Проверяем, попадает ли в последние 24 часа
                const hoursDiff = (now.getTime() - hourKey) / (1000 * 60 * 60);
                if (hoursDiff <= 24 && hoursDiff >= 0) {
                    if (hourlyData.has(hourKey)) {
                        const data = hourlyData.get(hourKey);
                        data.count++;
                        data.snapshots.push(`/snapshots/${filename}`);
                    } else {
                        hourlyData.set(hourKey, {
                            timestamp: hourKey,
                            date: hour.toISOString(),
                            count: 1,
                            snapshots: [`/snapshots/${filename}`]
                        });
                    }
                }
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