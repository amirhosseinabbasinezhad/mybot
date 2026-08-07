const { MongoClient } = require("mongodb");

let clientPromise = global._mongoClientPromise;

function getDb() {
  if (!clientPromise) {
    const uri = process.env.MONGODB_URI;
    const client = new MongoClient(uri);
    clientPromise = client.connect();
    global._mongoClientPromise = clientPromise;
  }
  return clientPromise.then((client) => client.db("filmproxy"));
}

module.exports = { getDb };