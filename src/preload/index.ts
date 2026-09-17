import { contextBridge } from "electron";
import { APP_NAME } from "../shared/brand";
// Expose metadata only. File access, shells and arbitrary IPC are not renderer APIs.
contextBridge.exposeInMainWorld("roopre", Object.freeze({ name: APP_NAME }));
