const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");

const APP_URL = "https://pontypoolstock.github.io/";
const APP_ORIGIN = new URL(APP_URL).origin;
const TITLE_BAR_HEIGHT = 36;

function openExternal(url) {
  const parsedUrl = new URL(url);
  if (!["http:", "https:", "mailto:"].includes(parsedUrl.protocol)) {
    console.warn("Blocked external link with unsupported protocol:", parsedUrl.protocol);
    return;
  }

  shell.openExternal(url).catch((error) => {
    console.error("Unable to open external link:", error);
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    title: "PontyPool Stock Manager",
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#212529",
      symbolColor: "#ffffff",
      height: TITLE_BAR_HEIGHT,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin !== APP_ORIGIN) {
      openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) {
      event.preventDefault();
      openExternal(url);
    }
  });

  window.webContents.on("will-redirect", (event, url) => {
    if (new URL(url).origin !== APP_ORIGIN) {
      event.preventDefault();
      openExternal(url);
    }
  });

  window.webContents.on("dom-ready", () => {
    const appLayoutStyles = `
      @media screen {
        body {
          box-sizing: border-box;
          padding-top: ${TITLE_BAR_HEIGHT}px !important;
        }
        .sidebar {
          top: ${TITLE_BAR_HEIGHT}px !important;
          height: calc(100vh - ${TITLE_BAR_HEIGHT}px) !important;
          height: calc(100dvh - ${TITLE_BAR_HEIGHT}px) !important;
        }
      }
    `;
    window.webContents.insertCSS(appLayoutStyles).catch((error) => {
      console.error("Unable to style the desktop app window:", error);
    });
  });

  window.loadURL(APP_URL).catch((error) => {
    console.error("Unable to load PontyPool Stock Manager:", error);
  });
}

ipcMain.handle("receipt:print", (event) => {
  const senderFrame = event.senderFrame;
  if (
    !senderFrame ||
    senderFrame !== event.sender.mainFrame ||
    new URL(senderFrame.url).origin !== APP_ORIGIN
  ) {
    throw new Error("Receipt printing is only available to the PontyPool app window.");
  }

  return new Promise((resolve, reject) => {
    try {
      event.sender.print(
        { silent: true, printBackground: true },
        (success, failureReason) => {
          if (!success) {
            reject(new Error(failureReason || "The default printer could not print the receipt."));
            return;
          }
          resolve({ ok: true });
        },
      );
    } catch (error) {
      reject(error);
    }
  });
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
