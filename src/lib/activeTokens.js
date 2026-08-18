const redis = require('./redisClient'); // adjust path if yours differs

// TTL matches the JWT's own expiresIn ('1d'). This means Redis automatically
// evicts a token's entry once it would have expired anyway — no cleanup job
// needed. If you ever change the JWT's expiresIn, update this to match.
const TOKEN_TTL_SECONDS = 60 * 60 * 24;

function keyFor(token) {
    return `active_token:${token}`;
}

async function addToken(token) {
    await redis.set(keyFor(token), '1', 'EX', TOKEN_TTL_SECONDS);
}

async function removeToken(token) {
    await redis.del(keyFor(token));
}

async function isTokenActive(token) {
    const exists = await redis.exists(keyFor(token));
    return exists === 1;
}

module.exports = { addToken, removeToken, isTokenActive };