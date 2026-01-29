# SwiftShare.in Backend

The backend service for SwiftShare.in, a real-time collaborative text editor. It powers the synchronization engine using WebSockets and CRDTs (Conflict-free Replicated Data Types).

## 🛠️ Tech Stack

-   **Runtime**: Node.js
-   **WebSocket**: `ws` library for high-performance real-time communication.
-   **CRDT Engine**: `yjs` for conflict-free shared data types.
-   **Protocol**: `y-websocket` and `y-protocols` for efficient binary state synchronization.
-   **Database**: MongoDB for persistent document storage.

## 🚀 Getting Started

### Prerequisites

-   Node.js (v16+)
-   MongoDB Instance (Local or Atlas)

### Installation

1.  Navigate to the backend directory:
    ```bash
    cd backend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

### Configuration

Create a `.env` file in the root of the `backend` directory:

```env
PORT=1234
MONGO_DB_KEY=mongodb://localhost:27017/swiftshare # Or your Atlas connection string
```

### Running the Server

-   **Development**:
    ```bash
    npm run devStart
    ```
-   **Production**:
    ```bash
    npm start
    ```

## 🏗️ Architecture

### WebSocket Synchronization
The server implements the Yjs WebSocket protocol. When a client connects:
1.  **Connection**: A WebSocket connection is established.
2.  **Sync Step 1**: Server sends its state vector.
3.  **Sync Step 2**: Client calculates missing operations and sends them.
4.  **Updates**: Any new change from a client is broadcast to all other connected clients in the same "room".

### Persistence
-   **Strategy**: MongoDB is used to persist the binary update blobs.
-   **Loading**: On connection, the document state is loaded from MongoDB into memory.
-   **Saving**: Updates are debounced and flushed to MongoDB to ensure durability after number of users in room drops to 0.
