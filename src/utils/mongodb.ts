import { MongoClient, Db, Collection } from "mongodb";

/**
 * MongoDB connection singleton for macro storage
 */
class MongoDB {
  private static instance: MongoDB;
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private connected: boolean = false;

  private constructor() {}

  public static getInstance(): MongoDB {
    if (!MongoDB.instance) {
      MongoDB.instance = new MongoDB();
    }
    return MongoDB.instance;
  }

  /**
   * Connect to MongoDB
   * Default: mongodb://192.168.1.42:27017/browser_mcp
   */
  public async connect(uri?: string): Promise<void> {
    if (this.connected && this.client) {
      return;
    }

    const connectionUri = uri || process.env.MONGODB_URI || "mongodb://192.168.1.42:27017";
    const dbName = process.env.MONGODB_DB || "browser_mcp";

    try {
      this.client = new MongoClient(connectionUri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });

      await this.client.connect();
      this.db = this.client.db(dbName);
      this.connected = true;

      // Create indexes
      await this.ensureIndexes();

      console.log(`[MongoDB] Connected to ${connectionUri}/${dbName}`);
    } catch (error) {
      console.error("[MongoDB] Connection failed:", error);
      this.connected = false;
      throw error;
    }
  }

  /**
   * Ensure required indexes exist
   */
  private async ensureIndexes(): Promise<void> {
    if (!this.db) return;

    const macros = this.db.collection("macros");

    // Create indexes
    await macros.createIndex({ id: 1 }, { unique: true });
    await macros.createIndex({ site: 1, category: 1 });
    await macros.createIndex({ site: 1, name: 1 }, { unique: true });
    await macros.createIndex({ tags: 1 }); // Multikey index
    await macros.createIndex({ createdAt: 1 });
    await macros.createIndex({ reliability: 1 });

    console.log("[MongoDB] Indexes created successfully");
  }

  /**
   * Get macros collection
   */
  public getMacrosCollection(): Collection {
    if (!this.db) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.db.collection("macros");
  }

  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from MongoDB
   */
  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.connected = false;
      this.client = null;
      this.db = null;
      console.log("[MongoDB] Disconnected");
    }
  }

  /**
   * Health check
   */
  public async ping(): Promise<boolean> {
    if (!this.db) return false;
    try {
      await this.db.admin().ping();
      return true;
    } catch {
      return false;
    }
  }
}

export const mongodb = MongoDB.getInstance();
