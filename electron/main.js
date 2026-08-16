import { app, BrowserWindow, Menu, clipboard } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Direct text insertion into the active element
  const handlePaste = () => {
    const text = clipboard.readText();
    if (text) {
      win.webContents.insertText(text);
    }
  };

  // Context menu on right-click
  win.webContents.on("context-menu", () => {
    const contextMenu = Menu.buildFromTemplate([
      { role: "undo", label: "Undo" },
      { role: "redo", label: "Redo" },
      { type: "separator" },
      { role: "cut", label: "Cut" },
      { role: "copy", label: "Copy" },
      {
        label: "Paste",
        accelerator: "CmdOrCtrl+V",
        click: handlePaste,
      },
      { type: "separator" },
      { role: "selectAll", label: "Select All" },
    ]);
    contextMenu.popup();
  });

  // Register Ctrl+V handling at the application menu level
  const appMenu = Menu.buildFromTemplate([
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        {
          label: "Paste",
          accelerator: "CmdOrCtrl+V",
          click: handlePaste,
        },
        { role: "selectAll" },
      ],
    },
  ]);
  Menu.setApplicationMenu(appMenu);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});