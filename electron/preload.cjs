const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pontypoolDesktop", Object.freeze({
  printReceipt: () => ipcRenderer.invoke("receipt:print"),
}));
