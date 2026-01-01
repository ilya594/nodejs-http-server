// https-server.js
'use strict';

const fs = require('fs');
const path = require('path');




const bcrypt = require('bcrypt');

const port = process.env.port || 8000;

const auth = process.env.auth || 2;
//const host = 'localhost';



const validatePin = async (received) => {
    const hash = received?.toString() || '';
    const pin = process.env.pin.toString();
    const result = await bcrypt.compare(pin, hash);
    return result;
}

const getPath = (fileName) => {
    const year = String(fileName).substring(6, 10);
    const month = String(fileName).substring(3, 5);
    return path.join(defaultPath, year, monthMap[month], fileName);
}

const handlePath = (filePath) => {
    var dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        return true;
    }
    handlePath(dirname);
    console.log('handling path. creating mkdirSync name: ' + dirname);
    fs.mkdirSync(dirname);
}

const year = '2025';

const defaultPath = './../../../../var/data/snapshots/';

const monthMap = {
    '01': 'January', '02': 'February', '03': 'March',
    '04': 'April', '05': 'May', '06': 'June',
    '07': 'July', '08': 'August', '09': 'September',
    '10': 'October', '11': 'November', '12': 'December'
};







class HttpsServer {
    constructor(config = {}) {
        this.app = config.app;

        this.peers = config.peers;


        this.app.post('/snapshot', async (request, response) => {

            if (!request.body || !validatePin(request.body.pin)) return response.sendStatus(400);

            const image = request.body.file;
            const name = request.body.name;

            console.log('receiving post request: [image: ' + Boolean(image) + ', name: ' + name + ']');

            const data = image.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(data, 'base64');

            const filePath = getPath(name);
            const fullPath = path.resolve(filePath);

            handlePath(fullPath);


            console.log('writing file buffer to disk: path: ' + fullPath);

            fs.writeFile(fullPath, buffer, () => {
                response.send(JSON.stringify({
                    error: false,
                }));
            });
        });

 

        this.app.get('/scissordir', async (request, response) => {
            if (!await validatePin(request.query.pin)) return response.sendStatus(400);

            console.log('Starting /scissordir - downloading and deleting ALL snapshots');

            // Helper to get month name from month number (for path)
            const getMonthName = (monthNumber) => {
                const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
                return months[parseInt(monthNumber) - 1] || monthNumber;
            };

            // Helper function to get all snapshots
            const getAllSnapshots = async () => {
                return new Promise((resolve, reject) => {
                    const folders = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];

                    let allSnapshots = [];
                    let processedFolders = 0;

                    // If no folders exist, return empty
                    if (processedFolders === 0 && folders.length === 0) {
                        resolve(allSnapshots);
                        return;
                    }

                    folders.forEach(folder => {
                        const folderPath = path.join(defaultPath, year, folder);

                        // Check if folder exists
                        fs.access(folderPath, fs.constants.F_OK, (err) => {
                            if (err) {
                                // Folder doesn't exist, skip
                                processedFolders++;
                                if (processedFolders === folders.length) {
                                    resolve(allSnapshots);
                                }
                                return;
                            }

                            // Read files in folder
                            fs.readdir(folderPath, (error, files) => {
                                if (error) {
                                    console.error(`Error reading ${folder}:`, error);
                                } else if (files && files.length > 0) {
                                    // Filter for snapshot files if needed
                                    files.forEach(fileName => {
                                        // Optional: check if it's a snapshot file
                                        // if (fileName.endsWith('.snapshot') || fileName.includes('snap')) {
                                        allSnapshots.push({
                                            id: fileName,
                                            name: fileName,
                                            month: folder,
                                            monthNumber: Object.keys(monthMap).find(key => monthMap[key] === folder) || '01',
                                            path: path.join(folderPath, fileName)
                                        });
                                        // }
                                    });
                                }

                                processedFolders++;
                                if (processedFolders === folders.length) {
                                    resolve(allSnapshots);
                                }
                            });
                        });
                    });
                });
            };

            // Download a snapshot using your existing endpoint pattern
            const downloadSnapshot = async (snapshot) => {
                return new Promise((resolve) => {
                    const filePath = snapshot.path;

                    fs.readFile(filePath, (error, data) => {
                        if (error) {
                            console.error(`Download failed for ${snapshot.name}:`, error);
                            resolve({ success: false, error: error.message });
                        } else {
                            // Save to a downloads directory
                            const downloadsDir = path.join(__dirname, 'downloads', year, snapshot.month);

                            // Create directory if it doesn't exist
                            if (!fs.existsSync(downloadsDir)) {
                                fs.mkdirSync(downloadsDir, { recursive: true });
                            }

                            const downloadPath = path.join(downloadsDir, snapshot.name);

                            fs.writeFile(downloadPath, data, (writeError) => {
                                if (writeError) {
                                    console.error(`Failed to save download for ${snapshot.name}:`, writeError);
                                    resolve({ success: false, error: writeError.message });
                                } else {
                                    console.log(`Downloaded and saved: ${snapshot.name} to ${downloadPath}`);
                                    resolve({
                                        success: true,
                                        path: downloadPath,
                                        size: data.length,
                                        base64: Buffer.from(data).toString('base64').substring(0, 50) + '...' // Preview
                                    });
                                }
                            });
                        }
                    });
                });
            };

            // Delete a snapshot (your existing pattern)
            const delSnapshot = async (snapshot) => {
                return new Promise((resolve) => {
                    const filePath = snapshot.path;

                    fs.unlink(filePath, (error) => {
                        if (error) {
                            console.error(`Delete failed for ${snapshot.name}:`, error);
                            resolve({ success: false, error: error.message });
                        } else {
                            console.log(`Deleted: ${snapshot.name}`);
                            resolve({ success: true });
                        }
                    });
                });
            };

            // Main processing function
            const processAllSnapshots = async () => {
                try {
                    // Get all snapshots
                    console.log('Scanning for snapshots...');
                    const allSnapshots = await getAllSnapshots();

                    if (!allSnapshots || allSnapshots.length === 0) {
                        console.log('No snapshots found to process.');
                        return {
                            success: true,
                            processed: 0,
                            message: 'No snapshots found',
                            details: {
                                total: 0,
                                downloaded: 0,
                                deleted: 0,
                                errors: []
                            }
                        };
                    }

                    console.log(`Found ${allSnapshots.length} snapshots to process`);

                    const results = {
                        total: allSnapshots.length,
                        downloaded: 0,
                        deleted: 0,
                        errors: []
                    };

                    // Process each snapshot synchronously
                    for (let i = 0; i < allSnapshots.length; i++) {
                        const snapshot = allSnapshots[i];
                        const progress = `[${i + 1}/${allSnapshots.length}]`;

                        console.log(`${progress} Processing: ${snapshot.name} (${snapshot.month})`);

                        try {
                            // 1. Download (and save locally)
                            const downloadResult = await downloadSnapshot(snapshot);
                            if (!downloadResult.success) {
                                results.errors.push({
                                    snapshot: snapshot.name,
                                    operation: 'download',
                                    error: downloadResult.error,
                                    timestamp: new Date().toISOString()
                                });
                                console.error(`${progress} ✗ Download failed: ${downloadResult.error}`);
                                continue; // Skip deletion if download failed
                            }
                            results.downloaded++;
                            console.log(`${progress} ✓ Downloaded: ${downloadResult.size} bytes`);

                            // 2. Delete from source
                            const deleteResult = await delSnapshot(snapshot);
                            if (!deleteResult.success) {
                                results.errors.push({
                                    snapshot: snapshot.name,
                                    operation: 'delete',
                                    error: deleteResult.error,
                                    timestamp: new Date().toISOString()
                                });
                                console.error(`${progress} ✗ Delete failed: ${downloadResult.error}`);
                            } else {
                                results.deleted++;
                                console.log(`${progress} ✓ Deleted successfully`);
                            }

                        } catch (error) {
                            results.errors.push({
                                snapshot: snapshot.name,
                                operation: 'process',
                                error: error.message,
                                timestamp: new Date().toISOString()
                            });
                            console.error(`${progress} 💥 Processing error: ${error.message}`);
                        }

                        // Optional: small delay to prevent overwhelming
                        if (i < allSnapshots.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                    }

                    // Summary
                    console.log('\n' + '='.repeat(50));
                    console.log('PROCESSING COMPLETE');
                    console.log('='.repeat(50));
                    console.log(`Total snapshots found: ${results.total}`);
                    console.log(`Successfully downloaded: ${results.downloaded}`);
                    console.log(`Successfully deleted: ${results.deleted}`);
                    console.log(`Total errors: ${results.errors.length}`);

                    if (results.errors.length > 0) {
                        console.log('\nError details:');
                        results.errors.forEach((err, idx) => {
                            console.log(`  ${idx + 1}. ${err.snapshot} - ${err.operation}: ${err.error}`);
                        });
                    }

                    return {
                        success: results.errors.length === 0 || results.downloaded > 0,
                        processed: results.total,
                        message: `Processed ${results.total} snapshots (${results.downloaded} downloaded, ${results.deleted} deleted)`,
                        details: results
                    };

                } catch (error) {
                    console.error('Fatal error in processing:', error);
                    return {
                        success: false,
                        error: error.message,
                        details: { total: 0, downloaded: 0, deleted: 0, errors: [{ error: error.message }] }
                    };
                }
            };

            // Execute and send response
            try {
                console.log('Starting snapshot processing...');
                const result = await processAllSnapshots();

                response.json({
                    success: result.success,
                    message: result.message,
                    timestamp: new Date().toISOString(),
                    stats: {
                        total: result.details?.total || 0,
                        downloaded: result.details?.downloaded || 0,
                        deleted: result.details?.deleted || 0,
                        errors: result.details?.errors?.length || 0
                    },
                    details: result.details
                });

            } catch (error) {
                console.error('Unhandled error in /scissordir:', error);
                response.status(500).json({
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });

        this.app.get('/snapshot', async (request, response) => {

            if (!request.body || !await validatePin(request.query.pin)) return response.sendStatus(400);

            const month = request.query.month;
            const name = request.query.name;

            const filePath = path.join(defaultPath, year, month, name);
            const fullPath = path.resolve(filePath);

            console.log('trying to read file: path: ' + fullPath);

            //let result = null;

            fs.readFile(fullPath, (error, data) => {
                if (error) {
                    console.log(error);
                    response.send(null);
                } else {
                    response.send(Buffer.from(data).toString('base64'));
                }
            });
        });

        this.app.get('/delsnapshot', async (request, response) => {

            if (!request.body || !await validatePin(request.query.pin)) return response.sendStatus(400);

            const month = request.query.month;
            const name = request.query.name;

            const filePath = path.join(defaultPath, year, month, name);
            const fullPath = path.resolve(filePath);

            fs.unlink(fullPath, (error) => {
                response.send({
                    data: !Boolean(error)
                });
            });
        });



        this.app.get('/ls', async (request, response) => {

            if (!request.body || !await validatePin(request.query.pin)) return response.sendStatus(400);

            const location = request.body.location || year;

            fs.readdir(path.join(defaultPath, location), (error, files) => {
                response.send(JSON.stringify({
                    error: error,
                    data: files,
                }));
            });
        });

        this.app.get('/lsall', async (request, response) => {

            if (!await validatePin(request.query.pin)) return response.sendStatus(400);

            console.log('app get: lsall');

            const folders = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

            const read = (folder) => {

                const folderPath = path.join(defaultPath, year, folder);

                console.log('reading: ' + folderPath);

                handlePath(folderPath + '/dummy.file');

                fs.readdir(folderPath, (error, files) => {
                    if (error) {
                        console.log('error on reading: ' + folder);
                    }
                    list.push(files);
                    if (i < folders.length - 1) {
                        i = i + 1;
                        read(folders[i]);
                    } else {
                        response.send(JSON.stringify({
                            error: error,
                            data: list,
                        }));
                    }
                });
            }

            let list = new Array();
            let i = 0;
            read(folders[i]);
        });

        this.app.get('/valprediction', async (request, response) => {

            if (!request.body || ! await validatePin(request.query.pin)) return response.sendStatus(400);

            const prediction = request.query.prediction?.pop();

            const result = prediction.value === String(auth);

            response.send(JSON.stringify({
                data: result,
            }));
        });

        this.app.get('/login', async (request, response) => {

            if (!request.body) return response.sendStatus(400);

            response.send({
                result: await validatePin(request.query.pin) ? true : false
            });
        });

        this.app.get('/getpeersids', async (request, response) => {

            if (!request.body || !await validatePin(request.query.pin)) return response.sendStatus(400);

            response.send({
                data: Array.from(this.peers.keys()),
            });
        });

        this.app.post('/addpeerid', async (request, response) => {

            if (!request.body) return response.sendStatus(400);

            const id = request.body.id;

            if (id) {
                this.peers.set(id, {
                    id,
                    lastHeartbeat: Date.now(),
                    registeredAt: Date.now(),
                    isActive: true
                });
                console.log('peer added: [' + id + '], size: [' + this.peers.size + ']');
                response.send(JSON.stringify({
                    error: false,
                }));
            } else {
                response.send(JSON.stringify({
                    error: 'no id provided',
                }));
            }
        });

        this.app.post('/removepeerid', async (request, response) => {

            if (!request.body) return response.sendStatus(400);

            const id = request.body.id;

            if (id) {
                if (this.peers.delete(id)) {
                    response.send(JSON.stringify({
                        error: false,
                    }));
                    console.log('peer removed: [' + id + '], size: [' + this.peers.size + ']');
                } else {
                    response.send(JSON.stringify({
                        error: 'no id provided',
                    }));
                }
            }
        });

        this.app.post('/heartbeat', async (request, response) => {

            if (!request.body) return response.sendStatus(400);

            const id = request.body.id;

            if (id) {
                if (this.peers.has(id)) {
                    this.peers.get(id).lastHeartbeat = Date.now();
                    this.peers.get(id).isActive = true;
                }
                response.send(JSON.stringify({
                    error: false,
                }));
            } else {
                response.send(JSON.stringify({
                    error: 'no id provided',
                }));
            }
        });
    }

    start() {
        this.app.listen(port, async () => {
            console.log('server listening to port: ' + port);
        });
    }

}

module.exports = HttpsServer;