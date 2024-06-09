'use strict'

const fastify = require('fastify');
const app = fastify();
const fs = require('fs');

const port = process.env.port || 8000;

app.post('/snapshot', async (req, _) => {

  fs.writeFileSync('../../../../var/data/snapshots/' + new Date().toDateString() + '.png', req.data);

  return {
    error: false,
  };
});

app.listen({ port: port }).then(() => {
  console.log('Server running at http://localhost:8000/');
});


