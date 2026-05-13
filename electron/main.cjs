const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const preferredPort = 3006;
let mainWindow = null;
let nextServerProcess = null;

app.setName("会议助手");

async function createWindow() {
  const portAvailable = await isPortAvailable(preferredPort);

  if (!portAvailable) {
    dialog.showErrorBox(
      "会议助手启动失败",
      `端口 ${preferredPort} 已被占用。请关闭已经打开的会议助手窗口，或重启电脑后再试。`
    );
    app.quit();
    return;
  }

  try {
    await startNextServer(preferredPort);
  } catch (error) {
    dialog.showErrorBox("会议助手启动失败", getErrorMessage(error));
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    title: "AI 会议助手",
    backgroundColor: "#f3f4f6",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await mainWindow.loadURL(`http://127.0.0.1:${preferredPort}`);
}

async function startNextServer(port) {
  const appRoot = getAppRoot();
  const serverPath = path.join(appRoot, ".next-build", "standalone", "server.js");
  const childEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    MEETING_ASSISTANT_USER_DATA: app.getPath("userData"),
    MEETING_ASSISTANT_RESOURCES_DIR: app.isPackaged ? process.resourcesPath : appRoot
  };

  nextServerProcess = spawn(process.execPath, [serverPath], {
    env: childEnv,
    cwd: path.dirname(serverPath),
    stdio: "ignore",
    windowsHide: true
  });

  nextServerProcess.once("exit", (code) => {
    if (code && !mainWindow) {
      dialog.showErrorBox("会议助手启动失败", "本地服务启动失败，请重启软件后再试。");
      app.quit();
    }
  });

  await waitForServer(port, 30000);
}

function getAppRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app");
  }

  return path.join(__dirname, "..");
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = http.createServer();

    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

function waitForServer(port, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(`http://127.0.0.1:${port}`, (response) => {
        response.resume();
        resolve();
      });

      request.once("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error("本地服务启动超时，请重启软件后再试。"));
          return;
        }

        setTimeout(check, 300);
      });
      request.setTimeout(1000, () => {
        request.destroy();
      });
    };

    check();
  });
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "本地服务启动失败，请重启软件后再试。";
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (nextServerProcess) {
    nextServerProcess.kill();
  }

  app.quit();
});
