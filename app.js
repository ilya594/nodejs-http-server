'use strict'

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const parser = require('body-parser');

const port = process.env.port || 8000;
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
  fs.mkdirSync(dirname);
}

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

const app = express();

app.use(cors(options));
app.use(parser.json({ limit: '50mb' }));
app.use(parser.urlencoded({ limit: '50mb', extended: true }));

app.post('/snapshot', async (request, response) => {

  if (!request.body) return response.sendStatus(400);

  const image = request.body.file;
  const name = request.body.name;

  const data = image.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(data, 'base64');

  fs.writeFile(handlePath(getPath(name)), buffer, () => {
    response.send(JSON.stringify({
      error: false,
    }));  
  });
});

app.get('/snapshot', async (_, response) => {
 response.send(JSON.stringify({
    error: false,
  }));
});



app.get('/ls', async (request, response) => {

  if (!request.body) return response.sendStatus(400);

  const location = request.body.location || '2024';

  fs.readdir(path.join(defaultPath, location), (error, files) => {
    response.send(JSON.stringify({
      error: error,
      data: files,
    }));
  });
});
  
app.listen(port, async () => {
  console.log('server listening to port: ' + port);
});