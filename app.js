'use strict'


const express = require('express');
const http = require('http');
const cors = require('cors');
const parser = require('body-parser');
const app = express();
const server = http.createServer(app);
const options = { origin: '*', optionsSuccessStatus: 200 };

app.use(cors(options));
app.use(parser.json({ limit: '50mb' }));
app.use(parser.urlencoded({ limit: '50mb', extended: true }));


const port = process.env.port || 8000;

app.post('/api/describe', async (req, res) => {

  res.send({ message: 'test answer ok' });

});


this.app.listen(port, async () => {
  console.log('server listening to port: ' + port);
});





