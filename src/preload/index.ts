import { contextBridge } from "electron";
// Expose metadata only. File access, shells and arbitrary IPC are not renderer APIs.
contextBridge.exposeInMainWorld("roopre", Object.freeze({ name: "Roopre" }));
