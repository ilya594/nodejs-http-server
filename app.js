'use strict'

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const parser = require('body-parser');

const bcrypt = require('bcrypt');



const port = process.env.port || 8000;
const auth = process.env.auth || 2;
//const host = 'localhost';

const options = {
  origin: '*',
  optionsSuccessStatus: 200,
};

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

const getPath = (fileName) => {
  const year = String(fileName).substring(6, 10);
  const month = String(fileName).substring(3, 5);
  return path.join(defaultPath, year, monthMap[month], fileName);
}

var peers = new Map();

const app = express();

app.use(cors(options));
app.use(parser.json({ limit: '50mb' }));
app.use(parser.urlencoded({ limit: '50mb', extended: true }));

const validatePin = async (received) => {
  const hash = received?.toString() || '';
  const pin = process.env.pin.toString();
  const result = await bcrypt.compare(pin, hash);
  return result;
}

app.post('/snapshot', async (request, response) => {

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

app.get('/snapshot', async (request, response) => {

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

app.get('/delsnapshot', async (request, response) => {

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



app.get('/ls', async (request, response) => {

  if (!request.body || !await validatePin(request.query.pin)) return response.sendStatus(400);

  const location = request.body.location || year;

  fs.readdir(path.join(defaultPath, location), (error, files) => {
    response.send(JSON.stringify({
      error: error,
      data: files,
    }));
  });
});

app.get('/lsall', async (request, response) => {

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

app.get('/valprediction', async (request, response) => {

  if (!request.body || ! await validatePin(request.query.pin)) return response.sendStatus(400);

  const prediction = request.query.prediction?.pop();

  const result = prediction.value === String(auth);

  response.send(JSON.stringify({
    data: result,
  }));
});

app.get('/login', async (request, response) => {

  if (!request.body) return response.sendStatus(400);

  response.send({
    result: await validatePin(request.query.pin) ? true : false
  });
});

app.get('/getpeersids', async (request, response) => {

  if (!request.body || !await validatePin(request.query.pin)) return response.sendStatus(400);

  response.send({
    data: Array.from(peers.keys()),
  });
});

app.post('/addpeerid', async (request, response) => {

  if (!request.body) return response.sendStatus(400);

  const id = request.body.id;

  if (id) {
    peers.set(id, {
      ...metadata,
      id,
      lastHeartbeat: Date.now(),
      registeredAt: Date.now(),
      isActive: true
    });
    response.send(JSON.stringify({
      error: false,
    }));
  } else {
    response.send(JSON.stringify({
      error: 'no id provided',
    }));
  }
});

app.post('/heartbeat', async (request, response) => {

  if (!request.body) return response.sendStatus(400);

  const id = request.body.id;

  if (id) {
    if (peers.has(id)) {
      peers.get(id).lastHeartbeat = Date.now();
      peers.get(id).isActive = true;
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

app.listen(port, async () => {
  console.log('server listening to port: ' + port);
});

setInterval(() => {
  const now = Date.now();
  const HEARTBEAT_THRESHOLD = 45000; // 45 seconds
  
  for (const [peerId, data] of peers) {
    if (now - data.lastHeartbeat > HEARTBEAT_THRESHOLD) {
      console.log(`Removing inactive streamer: ${peerId}`);
      removeStreamer(peerId);
    }
  }
}, 30000); // Run every 30 seconds

function removeStreamer(peerId) {
  if (peers.delete(peerId)) {
    //broadcastStreamerUpdate('removed', peerId);
  }
}