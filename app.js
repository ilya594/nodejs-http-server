'use strict'

const fastify = require('fastify');
const app = fastify();
const fs = require('fs');

const port = process.env.port || 8000;
const host = '0.0.0.0';

app.post('/snapshot', async (req, _) => {

  fs.writeFileSync('../../../../var/data/snapshots/' + new Date().toDateString() + '.png', req.body?.image);

  return {
    error: false,
  };
});

app.get('/snapshot', async (req, _) => {  
  return {
    error: false,
  }
});

app.listen({ port: port, host: host}).then(() => {
  console.log('Server running ...');
});


