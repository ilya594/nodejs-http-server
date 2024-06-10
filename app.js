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

  fs.writeFile(path.join('./../../../../var/data/snapshots/' + name), buffer, () => {
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
  
app.listen(port, async () => {
  console.log('server listening to port: ' + port);
});