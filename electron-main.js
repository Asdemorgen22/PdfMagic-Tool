/* PdfMagicTool desktop shell — loads the offline bundle in an app window. */
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1040,
    height: 800,
    autoHideMenuBar: true,
    backgroundColor: "#FFFEF9",
    icon: path.join(__dirname, "icons", "icon-512.png"),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.setWindowOpenHandler(function (details) {
    if (details.url.startsWith("blob:") || details.url.startsWith("file:")) return { action: "allow" };
    shell.openExternal(details.url);
    return { action: "deny" };
  });
}

app.whenReady().then(function () {
  createWindow();
  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});
