// activity-server.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const activityRouter = express.Router();
const SNAPSHOTS_DIR = '/var/www/detections/'; // путь к снепшотам

// Вспомогательная функция для парсинга даты из имени файла
function parseSnapshotDate(filename) {
    // Формат: [2026-02-28_06-25-29]-[2026-02-28_07-06-11].jpeg
    const match = filename.match(/\[(.*?)\]-\[(.*?)\]/);

    if (match) {
        const startDateStr = match[1]; // "2026-02-28_06-25-29"
        const [datePart, timePart] = startDateStr.split('_');
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute, second] = timePart.split('-').map(Number);

        return new Date(year, month - 1, day, hour, minute, second);
    }

    return null;
}

activityRouter.get('/activity', (req, res) => {
    console.log('[NServer] Getting activity data...');
    
    try {
        fs.readdir(SNAPSHOTS_DIR, (err, files) => {
            console.log(`[NServer] Reading directory: ${SNAPSHOTS_DIR}`);
            
            if (err) {
                console.error('[NServer] Error reading snapshots directory:', err);
                return res.status(500).json({ error: 'Failed to read snapshots' });
            }

            // Фильтруем только изображения
            const snapshots = files.filter(f =>
                f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')
            );
            
            console.log(`[NServer] Found ${snapshots.length} snapshots`);

            // ИСПРАВЛЕНО: Определяем начало и конец текущих суток
            const now = new Date();
            const startOfDay = new Date(now);
            startOfDay.setHours(0, 0, 0, 0); // Начало дня 00:00:00
            
            const endOfDay = new Date(now);
            endOfDay.setHours(23, 59, 59, 999); // Конец дня 23:59:59

            console.log(`[NServer] Day range: ${startOfDay.toISOString()} -> ${endOfDay.toISOString()}`);

            // ИСПРАВЛЕНО: Создаем массив на 24 часа
            const hourlyData = new Array(24).fill(null).map((_, hour) => {
                const hourDate = new Date(startOfDay);
                hourDate.setHours(hour, 0, 0, 0);

                return {
                    hour: hour,
                    timestamp: hourDate.getTime(),
                    date: hourDate.toISOString(),
                    count: 0,
                    snapshots: []
                };
            });

            // Обрабатываем снапшоты
            snapshots.forEach(filename => {
                const snapshotDate = parseSnapshotDate(filename);
                
                if (snapshotDate) {
                    // Проверяем, попадает ли в сегодняшний день
                    if (snapshotDate >= startOfDay && snapshotDate <= endOfDay) {
                        const hour = snapshotDate.getHours(); // 0-23
                        
                        // ИСПРАВЛЕНО: Проверяем что hour в допустимом диапазоне
                        if (hour >= 0 && hour < 24) {
                            hourlyData[hour].count++;
                            hourlyData[hour].snapshots.push(`/snapshots/${filename}`);
                            
                            console.log(`[NServer] File: ${filename} -> hour ${hour}, count: ${hourlyData[hour].count}`);
                        }
                    }
                }
            });

            // Логируем результат для отладки
            console.log('[NServer] Hourly data:');
            hourlyData.forEach(h => {
                if (h.count > 0) {
                    console.log(`  Hour ${h.hour}: ${h.count} snapshots`);
                }
            });

            res.json(hourlyData);
        });
    } catch (error) {
        console.error('[NServer] Error generating activity data:', error);
        res.status(500).json({ error: 'Failed to generate activity data' });
    }
});

module.exports = { activityRouter };