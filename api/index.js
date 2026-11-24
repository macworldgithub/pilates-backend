// Use tsc output so Nest's emitted decorator metadata is preserved. Importing
// main through serverless never starts a listener or seeds the database.
module.exports = require('../dist/serverless').default;
