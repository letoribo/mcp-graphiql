import { app, BrowserWindow, Menu, clipboard, protocol } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

// Disable web security globally at the Chromium engine level to bypass CORS completely
app.commandLine.appendSwitch("disable-web-security");
process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;

// Register custom Privileged Scheme for ASAR UI assets before app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      codeCache: true,
    },
  },
]);

// Helper for resolution of content-type for protocol responses
function getMimeType(filePath) {
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".js")) return "text/javascript";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  mainWindow.webContents.openDevTools();

  const handlePaste = () => {
    const text = clipboard.readText();
    if (text) {
      mainWindow.webContents.insertText(text);
    }
  };

  // Setup context menu for right-click actions
  mainWindow.webContents.on("context-menu", () => {
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

  // Application top menu template
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

  // Override request headers (Origin/User-Agent) for external GraphQL APIs
  const filter = { urls: ["http://*/*", "https://*/*"] };

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      // Ignore local config server requests
      if (details.url.includes("localhost:3000") || details.url.includes("127.0.0.1:3000")) {
        return callback({ requestHeaders: details.requestHeaders });
      }

      try {
        const targetUrl = new URL(details.url);
        details.requestHeaders["Origin"] = targetUrl.origin;
        details.requestHeaders["User-Agent"] =
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
      } catch (e) {
        // Ignore invalid URL parsing errors
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadURL("app://app/index.html");
  }
}

app.whenReady().then(async () => {
  // Safe ASAR protocol handler with direct fs reading
  protocol.handle("app", async (request) => {
    const parsedUrl = new URL(request.url);
    let relativePath = parsedUrl.pathname;

    // Normalize empty paths or root requests to index.html
    if (relativePath === "/" || relativePath === "/index.html" || !relativePath) {
      relativePath = "index.html";
    }

    // Strip ALL leading slashes
    relativePath = relativePath.replace(/^\/+/, "");

    const appRoot = app.getAppPath();
    const candidatePaths = [
      path.join(appRoot, "dist", relativePath),
      path.join(appRoot, relativePath),
      path.resolve(__dirname, "..", "dist", relativePath),
      path.resolve(__dirname, "..", relativePath),
    ];

    let targetPath = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        targetPath = p;
        break;
      }
    }

    if (!targetPath) {
      console.error("[Protocol Error] Asset not found:", relativePath, "Root:", appRoot);
      try {
        console.log("[ASAR Root Contents]:", fs.readdirSync(appRoot));
        if (fs.existsSync(path.join(appRoot, "dist"))) {
          console.log("[ASAR Dist Contents]:", fs.readdirSync(path.join(appRoot, "dist")));
        }
      } catch (e) {
        console.error("[Protocol Error] Diagnostic read failed:", e.message);
      }
      return new Response("File Not Found", { status: 404 });
    }

    try {
      const data = await fs.promises.readFile(targetPath);
      return new Response(data, {
        headers: {
          "Content-Type": getMimeType(targetPath),
        },
      });
    } catch (err) {
      console.error("[Protocol Error] Failed to read asset:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  });

  if (app.isPackaged) {
    try {
      await import("../server.js");
    } catch (err) {
      console.warn("[Main Process] Background server warning:", err.message);
    }
  }

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});