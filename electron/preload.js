const { contextBridge, ipcRenderer } = require("electron");

// Registry of local callbacks for manual testing
const listeners = new Map();

contextBridge.exposeInMainWorld("electronAPI", {
  readClipboard: () => ipcRenderer.invoke("read-clipboard"),
  
  on: (channel, callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);

    // Store references for local debugging
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(callback);

    return () => {
      ipcRenderer.removeListener(channel, subscription);
      listeners.get(channel)?.delete(callback);
    };
  },

  // Direct test function without Main Process involvement
  simulateIPC: (channel, data) => {
    const channelListeners = listeners.get(channel);
    if (channelListeners) {
      channelListeners.forEach(cb => cb(data));
      console.log(`[PRELOAD TEST] Simulating event '${channel}' for ${channelListeners.size} listener(s)`);
    } else {
      console.warn(`[PRELOAD TEST] No listeners found for channel '${channel}'`);
    }
  }
});