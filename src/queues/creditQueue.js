// src/queues/creditQueue.js
const { Queue } = require('bullmq');
const Redis = require('ioredis');

const connection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null,
});

const creditQueue = new Queue('credit-recalculation', { connection });

module.exports = { creditQueue, connection };