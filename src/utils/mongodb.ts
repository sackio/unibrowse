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
   * Default: mongodb://localhost:27018/unibrowse
   */
  public async connect(uri?: string): Promise<void> {
    if (this.connected && this.client) {
      return;
    }

    const connectionUri = uri || process.env.MONGODB_URI || "mongodb://localhost:27018";
    const dbName = process.env.MONGODB_DB || "unibrowse";

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

    const recordings = this.db.collection("recordings");
    await recordings.createIndex({ id: 1 }, { unique: true });
    await recordings.createIndex({ createdAt: -1 });
    await recordings.createIndex({ tags: 1 });
    await recordings.createIndex({ title: "text", description: "text" });

    const recordingEvents = this.db.collection("recording_events");
    // Recordings are chunked across multiple docs to bypass Mongo's 16MB-per-doc
    // limit. Drop a stale unique-on-recordingId index from older deployments,
    // then create the compound (recordingId, chunkIndex) index.
    try {
      const existing = await recordingEvents.indexes();
      const stale = existing.find(
        (idx: any) => idx.unique && idx.key && idx.key.recordingId === 1 && Object.keys(idx.key).length === 1
      );
      if (stale) await recordingEvents.dropIndex(stale.name);
    } catch {}
    await recordingEvents.createIndex({ recordingId: 1, chunkIndex: 1 }, { unique: true });

    // Watch subscriptions, so a watch survives an mcp-server restart. Only the
    // SUBSCRIPTION is stored — events remain fire-and-forget by design.
    const watches = this.db.collection("watches");
    await watches.createIndex({ watchId: 1 }, { unique: true });
    await watches.createIndex({ extensionId: 1 });
    await watches.createIndex({ createdAt: 1 });

    // Files pulled out of a driven browser by browser_fetch_to_server. The
    // FILE is the deliverable and lives on disk; this is only the index that
    // makes it findable later, which is why the write path treats an insert
    // failure here as a warning rather than an error.
    const fetchedFiles = this.db.collection("fetched_files");
    await fetchedFiles.createIndex({ id: 1 }, { unique: true });
    await fetchedFiles.createIndex({ createdAt: -1 });
    await fetchedFiles.createIndex({ sha256: 1 });

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
   * Get fetched_files collection — the index for browser_fetch_to_server.
   */
  public getFetchedFilesCollection(): Collection {
    if (!this.db) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.db.collection("fetched_files");
  }

  /**
   * Get recordings collection
   */
  public getRecordingsCollection(): Collection {
    if (!this.db) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.db.collection("recordings");
  }

  /**
   * Get recording_events collection (rrweb events + network entries, separate to avoid 16MB doc limit)
   */
  public getRecordingEventsCollection(): Collection {
    if (!this.db) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.db.collection("recording_events");
  }

  /**
   * Get recording_annotations collection — one doc per user-drawn annotation
   * captured during a session recording. Separate collection because each doc
   * carries a base64 PNG screenshot (~100-300KB) and we want fast indexed
   * lookup by recordingId for the review UI / browser_get_recording tool.
   */
  public getRecordingAnnotationsCollection(): Collection {
    if (!this.db) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.db.collection("recording_annotations");
  }

  /**
   * Watch subscriptions collection — see src/watch/persistence.ts for what is
   * stored and, more importantly, what deliberately is not.
   */
  public getWatchesCollection(): Collection {
    if (!this.db) {
      throw new Error("MongoDB not connected. Call connect() first.");
    }
    return this.db.collection("watches");
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
