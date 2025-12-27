import { MongoClient } from "mongodb";
import * as Y from "yjs";

const DB_NAME = "gaiapad";
const COLLECTION_NAME = "documents";

let client;
let db;
let collection;

// Initialize MongoDB connection
export async function initMongoDB() {
  try {
    // Read MONGO_URI here, after dotenv has loaded
    const MONGO_URI = process.env.MONGO_DB_KEY;

    if (!MONGO_URI) {
      throw new Error("MONGO_DB_KEY environment variable is not set");
    }

    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    collection = db.collection(COLLECTION_NAME);

    // Create index on docName for faster queries
    await collection.createIndex({ docName: 1 });

    console.log("✅ MongoDB connected successfully");
    return true;
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    return false;
  }
}

// Persistence implementation for Yjs
export const persistence = {
  /**
   * Bind state - Load document from MongoDB when first user connects
   */
  bindState: async (docName, ydoc) => {
    try {
      const storedDoc = await collection.findOne({ docName });

      if (storedDoc && storedDoc.state) {
        try {
          // Apply stored state to the Yjs document
          // MongoDB stores as Binary/BSON, convert to Uint8Array for Yjs
          const state = new Uint8Array(storedDoc.state.buffer);
          Y.applyUpdate(ydoc, state);
          console.log(`📥 Loaded document "${docName}" from MongoDB`);
        } catch (applyError) {
          console.error(
            `⚠️  Corrupted data for "${docName}", starting fresh:`,
            applyError.message
          );
          // Delete corrupted document
          await collection.deleteOne({ docName });
          console.log(`🗑️  Deleted corrupted document "${docName}"`);
        }
      } else {
        console.log(`📝 New document "${docName}" created`);
      }
    } catch (error) {
      console.error(`❌ Error loading document "${docName}":`, error);
    }
  },

  /**
   * Write state - Save document to MongoDB when last user disconnects
   */
  writeState: async (docName, ydoc) => {
    try {
      // Get the full document state as binary
      const state = Y.encodeStateAsUpdate(ydoc);

      // Save to MongoDB
      await collection.updateOne(
        { docName },
        {
          $set: {
            docName,
            state: Buffer.from(state),
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );

      console.log(`💾 Saved document "${docName}" to MongoDB`);
    } catch (error) {
      console.error(`Error saving document "${docName}":`, error);
    }
  },
};

// Close MongoDB connection
export async function closeMongoDB() {
  if (client) {
    await client.close();
    console.log("MongoDB connection closed");
  }
}
