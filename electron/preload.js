const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  readClipboard: () => ipcRenderer.invoke("read-clipboard"),
});