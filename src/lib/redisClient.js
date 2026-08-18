const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);

redis.on('error', (err) => {
    console.error('Redis connection error:', err);
});

module.exports = redis;