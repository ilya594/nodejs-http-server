'use strict'

const fastify = require('fastify');
const app = fastify();
const fs = require('fs');
const cors = require('@fastify/cors');

const port = process.env.port || 8000;
const host = '0.0.0.0';

app.register(cors, { 
  origin: false,
}).then(() => {


  app.post('/snapshot', async (req, reply) => {
    fs.writeFileSync('../../../../var/data/snapshots/' + new Date().toDateString() + '.png', req.body?.image);
  
    reply.send({
      error: false,
    });
  });
  
  app.get('/snapshot', async (req, reply) => {  
    reply.send({
      error: false,
    });
  });
  
  app.listen({ port: port, host: host}).then(() => {
    console.log('Server running ...');
  });


});




