const { app, BrowserWindow, ipcMain } = require("electron");
const { writeFileSync } = require("node:fs");
const path = require("node:path");
const { toCsv } = require("./csv.js");

const notes = [{ id: 1, title: "First note" }];

ipcMain.handle("notes:export", () => {
  const destination = path.join(app.getPath("downloads"), "notes.csv");
  writeFileSync(destination, toCsv(notes), "utf8");
  return destination;
});

void app.whenReady().then(() => {
  const window = new BrowserWindow({
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  void window.loadFile("index.html");
});
