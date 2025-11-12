import express from "express";
import cors from "cors";
import { computeIndices } from "./utils/indices.js";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// --- État initial des mesures ---
let state = {
  co2: 600,
  no2: 40,
  nh3: 0.02,
  co: 0.5,
  temp: 22.5,
  rh: 50,
  pres: 1013,
};

// --- Fonction pour faire varier lentement les données ---
function vary(value, delta, min, max) {
  const change = (Math.random() * 2 - 1) * delta;
  let newVal = value + change;
  if (newVal < min) newVal = min + (min - newVal) * 0.2;
  if (newVal > max) newVal = max - (newVal - max) * 0.2;
  return parseFloat(newVal.toFixed(3));
}

// --- Mise à jour des données toutes les secondes ---
setInterval(() => {
  state.co2 = vary(state.co2, 20, 450, 1500);
  state.no2 = vary(state.no2, 2, 20, 120);
  state.nh3 = vary(state.nh3, 0.002, 0.01, 0.08);
  state.co = vary(state.co, 0.05, 0.2, 3);
  state.temp = vary(state.temp, 0.1, 19, 26);
  state.rh = vary(state.rh, 0.3, 35, 65);
  state.pres = vary(state.pres, 0.05, 1008, 1018);

  const { GAQI } = computeIndices(state);
  let color;
  if (GAQI >= 90) color = "\x1b[32m";       // vert
  else if (GAQI >= 70) color = "\x1b[36m";  // cyan
  else if (GAQI >= 50) color = "\x1b[33m";  // jaune
  else if (GAQI >= 30) color = "\x1b[35m";  // magenta
  else color = "\x1b[31m";                  // rouge
  console.log(`${color}GAQI: ${GAQI}\x1b[0m`);
}, 1000);

// --- Endpoint principal ---
app.get("/data", (req, res) => {
  const indices = computeIndices(state);
  res.json({
    timestamp: new Date().toISOString(),
    measures: state,
    indices,
  });
});

// --- Endpoint serveur ---
app.get("/", (req, res) => {
  res.send("🌐 Indoor Sim Server est en ligne ! Accédez à /data pour le JSON.");
});

app.listen(PORT, () => {
  console.log(`🌐 Serveur prêt sur http://localhost:${PORT}/data`);
});
