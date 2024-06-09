'use strict'

const fastify = require('fastify');
const app = fastify();
const fs = require('fs');

const port = process.env.port || 8000;

app.post('/snapshot', async (req, _) => {

  fs.writeFileSync('../../../../var/data/snapshots/' + new Date().toDateString() + '.png', req.body?.image);

  return {
    error: false,
  };
});

app.listen(8000, '0.0.0.0').then(() => {
  console.log('Server running ...');
});


