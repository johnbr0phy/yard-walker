#!/usr/bin/env node
/* Yard Walker build: imports the three yard generators verbatim and assembles
   the single-file game. The yards stay pure drawing tools; this script slices
   each one's generation code (everything in its <script> up to the UI boot
   line `const cv=document…`) and wraps it in a namespaced IIFE. Game code and
   shell come from src/. Output: index.html. */
const fs = require("fs");
const path = require("path");

const HOME = path.resolve(__dirname, "..");
const YARDS = [
  { key: "SHIPYARD", file: path.join(HOME, "starships/index.html"),
    exports: "return {build:buildShip, mesh:shipMesh, partExtents:partExtents, inSolid:inSolid};" },
  { key: "BASEYARD", file: path.join(HOME, "moonbase/index.html"),
    exports: "return {build:buildShip, mesh:shipMesh, partExtents:partExtents, CRATERS:CRATERS};" },
  { key: "MECHYARD", file: path.join(HOME, "mech-yard/index.html"),
    exports: "return {build:buildMech, mesh:shipMesh, partExtents:partExtents};" },
];

function extract(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const a = lines.findIndex(l => l.trim() === "<script>");
  const b = lines.findIndex(l => l.startsWith("const cv=document"));
  if (a < 0 || b < 0 || b <= a) throw new Error("cut markers not found in " + file);
  return lines.slice(a + 1, b).join("\n");
}

let html = fs.readFileSync(path.join(__dirname, "src/template.html"), "utf8");
for (const y of YARDS) {
  const body = extract(y.file);
  const mod = `window.${y.key}=(function(){\n${body}\n${y.exports}\n})();`;
  html = html.replace(`/*INJECT:${y.key}*/`, () => mod);
  console.log(`${y.key}: ${(mod.length / 1024).toFixed(0)} KB from ${path.relative(HOME, y.file)}`);
}
const game = fs.readFileSync(path.join(__dirname, "src/game.js"), "utf8");
html = html.replace("/*INJECT:GAME*/", () => game);

fs.writeFileSync(path.join(__dirname, "index.html"), html);
console.log(`index.html: ${(html.length / 1024).toFixed(0)} KB`);
