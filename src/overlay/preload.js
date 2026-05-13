const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quotaBubble", {
  onLoading: (callback) => ipcRenderer.on("quota:loading", callback),
  onData: (callback) => ipcRenderer.on("quota:data", (_event, data) => callback(data)),
  close: () => ipcRenderer.send("bubble:close"),
  refresh: () => ipcRenderer.send("bubble:refresh"),
  hotspotClick: () => ipcRenderer.send("hotspot:click")
});
