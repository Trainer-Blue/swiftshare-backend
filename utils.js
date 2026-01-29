import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";

import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as map from "lib0/map";
import { UTApi } from "uploadthing/server";

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

// disable gc when using snapshots!
const gcEnabled = process.env.GC !== "false" && process.env.GC !== "0";

let persistence = null;

export const setPersistence = (persistence_) => {
  persistence = persistence_;
};

export const getPersistence = () => persistence;

export const docs = new Map();

// Track pending file deletion timeouts
const pendingDeletions = new Map();

const messageSync = 0;
const messageAwareness = 1;

const updateHandler = (update, _origin, doc, _tr) => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeUpdate(encoder, update);
  const message = encoding.toUint8Array(encoder);
  doc.conns.forEach((_, conn) => send(doc, conn, message));
};

let contentInitializor = (_ydoc) => Promise.resolve();

export const setContentInitializor = (f) => {
  contentInitializor = f;
};

export class WSSharedDoc extends Y.Doc {
  constructor(name) {
    super({ gc: gcEnabled });
    this.name = name;
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    const awarenessChangeHandler = ({ added, updated, removed }, conn) => {
      const changedClients = added.concat(updated, removed);
      if (conn !== null) {
        const connControlledIDs = this.conns.get(conn);
        if (connControlledIDs !== undefined) {
          added.forEach((clientID) => {
            connControlledIDs.add(clientID);
          });
          removed.forEach((clientID) => {
            connControlledIDs.delete(clientID);
          });
        }
      }
      // broadcast awareness update
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
      );
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => {
        send(this, c, buff);
      });
    };
    this.awareness.on("update", awarenessChangeHandler);
    this.on("update", updateHandler);
    this.whenInitialized = contentInitializor(this);
  }
}

export const getYDoc = (docname, gc = true) =>
  map.setIfUndefined(docs, docname, () => {
    const doc = new WSSharedDoc(docname);
    doc.gc = gc;

    // Cancel pending deletion if someone rejoins
    if (pendingDeletions.has(docname)) {
      clearTimeout(pendingDeletions.get(docname));
      pendingDeletions.delete(docname);
      console.log(
        `⏸️  Cancelled file deletion for room: ${docname} (user rejoined)`,
      );
    }

    if (persistence !== null) {
      persistence.bindState(docname, doc);
    }
    docs.set(docname, doc);
    return doc;
  });

const messageListener = (conn, doc, message) => {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case messageSync:
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);

        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case messageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        );
        break;
      }
    }
  } catch (err) {
    console.error(err);
    doc.emit("error", [err]);
  }
};

const closeConn = async (doc, conn) => {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(
      doc.awareness,
      Array.from(controlledIds),
      null,
    );
    if (doc.conns.size === 0 && persistence !== null) {
      // Get file list from Y.Array before clearing
      const yfiles = doc.getArray("files");
      const fileList = yfiles.toArray();

      // Clear the files array before saving
      yfiles.delete(0, yfiles.length);

      // Save document immediately
      await persistence.writeState(doc.name, doc);

      // Schedule file deletion for 15 minutes later
      if (fileList.length > 0) {
        console.log(
          `⏰ Scheduling deletion of ${fileList.length} files for room: ${doc.name} in 60 minutes`,
        );

        const deletionTimeout = setTimeout(
          async () => {
            try {
              const utapi = new UTApi();
              const fileKeys = fileList.map((f) => f.key).filter(Boolean);
              if (fileKeys.length > 0) {
                await utapi.deleteFiles(fileKeys);
                console.log(
                  `🗑️  Deleted ${fileKeys.length} files from UploadThing for room: ${doc.name}`,
                );
              }
              pendingDeletions.delete(doc.name);
            } catch (error) {
              console.error("Failed to delete files from UploadThing:", error);
              pendingDeletions.delete(doc.name);
            }
          },
           60 * 60 * 1000,
        ); // 60 minutes

        pendingDeletions.set(doc.name, deletionTimeout);
      }

      doc.destroy();
      docs.delete(doc.name);
    }
  }
  conn.close();
};

const send = (doc, conn, m) => {
  if (
    conn.readyState !== wsReadyStateConnecting &&
    conn.readyState !== wsReadyStateOpen
  ) {
    closeConn(doc, conn);
  }
  try {
    conn.send(m, {}, (err) => {
      err != null && closeConn(doc, conn);
    });
  } catch (e) {
    closeConn(doc, conn);
  }
};

const pingTimeout = 30000;

export const setupWSConnection = (
  conn,
  req,
  { docName = (req.url || "").slice(1).split("?")[0], gc = true } = {},
) => {
  conn.binaryType = "arraybuffer";
  const doc = getYDoc(docName, gc);
  doc.conns.set(conn, new Set());

  console.log(
    `✅ User joined room: "${docName}" (${doc.conns.size} users connected)`,
  );

  conn.on("message", (message) =>
    messageListener(conn, doc, new Uint8Array(message)),
  );

  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) {
        closeConn(doc, conn);
      }
      clearInterval(pingInterval);
    } else if (doc.conns.has(conn)) {
      pongReceived = false;
      try {
        conn.ping();
      } catch (e) {
        closeConn(doc, conn);
        clearInterval(pingInterval);
      }
    }
  }, pingTimeout);

  conn.on("close", () => {
    const remainingUsers = doc.conns.size - 1;
    console.log(
      `❌ User left room: "${docName}" (${remainingUsers} users remaining)`,
    );
    closeConn(doc, conn);
    clearInterval(pingInterval);
  });

  conn.on("pong", () => {
    pongReceived = true;
  });

  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(
          doc.awareness,
          Array.from(awarenessStates.keys()),
        ),
      );
      send(doc, conn, encoding.toUint8Array(encoder));
    }
  }
};
