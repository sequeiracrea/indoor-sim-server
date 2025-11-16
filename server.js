// server.js
import express from "express";
import cors from "cors";
import { computeIndices, pearson, std, mean } from "./utils/indices.js";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ----------------- CONFIG -----------------
const TICK_MS = 1000;                 // fréquence tick (1s)
const HISTORY_SECONDS = 60 * 30;     // buffer 30 minutes (30*60)
const SAMPLE_RATE = 1;                // 1 sample / second
// ------------------------------------------

// --- état courant (valeurs simulées) ---
let state = {
  co2: 600,
  no2: 40,
  nh3: 0.02,
  co: 0.5,
  temp: 22.5,
  rh: 50,
  pres: 1013,
};

// --- ring buffer (historique) ---
const history = []; // array of {ts, measures}
function pushHistory(meas) {
  history.push(meas);
  if (history.length > HISTORY_SECONDS) history.shift();
}

// --- simple vary function (same as before) ---
function vary(value, delta, min, max) {
  const change = (Math.random() * 2 - 1) * delta;
  let newVal = value + change;
  if (newVal < min) newVal = min + (min - newVal) * 0.2;
  if (newVal > max) newVal = max - (newVal - max) * 0.2;
  return parseFloat(newVal.toFixed(3));
}

// --- simulation tick ---
setInterval(() => {
  state.co2 = vary(state.co2, 20, 450, 1500);
  state.no2 = vary(state.no2, 2, 20, 120);
  state.nh3 = vary(state.nh3, 0.002, 0.01, 0.08);
  state.co = vary(state.co, 0.05, 0.2, 3);
  state.temp = vary(state.temp, 0.12, 19, 26);
  state.rh = vary(state.rh, 0.3, 35, 65);
  state.pres = vary(state.pres, 0.05, 1008, 1018);

  const timestamp = new Date().toISOString();
  const measures = { ...state };
  const entry = { timestamp, measures };

  // push in history
  pushHistory(entry);
}, TICK_MS);

// Helper: get window slice (last N seconds)
function windowSeconds(sec) {
  const len = history.length;
  if (len === 0) return [];
  const cutoff = Date.now() - sec * 1000;
  return history.filter(h => new Date(h.timestamp).getTime() >= cutoff);
}

// --- Endpoints ---

// 1) /data  -> current measures + indices (single object)
app.get("/data", (req, res) => {
  const lastWindow = windowSeconds(60); // 60s for volatility
  const indices = computeIndices(state, lastWindow);
  res.json({
    timestamp: new Date().toISOString(),
    measures: state,
    indices,
  });
});

// 2) /history?sec=300  -> time series last N seconds (default 1800s)
app.get("/history", (req, res) => {
  const sec = parseInt(req.query.sec || `${HISTORY_SECONDS}`, 10);
  const slice = windowSeconds(sec);
  // shape: [{timestamp, measures:{...}}]
  res.json({
    requested_sec: sec,
    length: slice.length,
    series: slice,
  });
});

// 3) /corr?vars=co2,no2,co  -> correlation matrix for listed vars over last N sec
app.get("/corr", (req, res) => {
  const vars = (req.query.vars || "co2,no2,nh3,co").split(",").map(s => s.trim());
  const sec = parseInt(req.query.sec || "1800", 10); // default 30 min
  const slice = windowSeconds(sec);
  // build arrays
  const series = {};
  vars.forEach(v => series[v] = slice.map(s => s.measures[v] ?? null).filter(x=>x!==null));
  // compute pairwise pearson
  const corr = {};
  for (let i = 0; i < vars.length; i++) {
    for (let j = i; j < vars.length; j++) {
      const a = series[vars[i]];
      const b = series[vars[j]];
      const key = `${vars[i]}-${vars[j]}`;
      const r = (a.length >= 2 && b.length >= 2 && a.length === b.length) ? pearson(a,b) : 0;
      corr[key] = parseFloat((r || 0).toFixed(3));
    }
  }
  res.json({
    vars,
    sec,
    corr,
  });
});

// 4) /scatterbar?sec=600&x=temp&y=rh&step=60 -> return points for scatterbar page
app.get("/scatterbar", (req, res) => {
  const sec = parseInt(req.query.sec || "3600", 10); // default 1h
  const xVar = req.query.x || "temp";
  const yVar = req.query.y || "rh";
  const step = parseInt(req.query.step || "60", 10); // sampling step seconds
  const slice = windowSeconds(sec);
  // sample every `step` seconds: group by bucket
  const points = [];
  for (let i = 0; i < slice.length; i += step) {
    const s = slice[i];
    if (!s) continue;
    const measures = s.measures;
    const total = (measures.co2 ||0) + (measures.no2||0) + (measures.nh3||0) + (measures.co||0);
    points.push({
      timestamp: s.timestamp,
      x: measures[xVar],
      y: measures[yVar],
      co2: measures.co2,
      no2: measures.no2,
      nh3: measures.nh3,
      co: measures.co,
      total: parseFloat(total.toFixed(3)),
      // optional: event flag (if total or co2 too high)
      event: (measures.co2 > 1200 || measures.no2 > 150) ? "spike" : null
    });
  }
  res.json({
    requested_sec: sec,
    xVar, yVar, step,
    count: points.length,
    points,
  });
});

// 5) /gaqi-breakdown -> detailed breakdown used for GAQI page/subbars
app.get("/gaqi-breakdown", (req,res) => {
  const last60 = windowSeconds(60);
  const indices = computeIndices(state, last60);
  // Also compute component penalties in detail (recompute here to return breakdown)
  // computeIndices returns AQL,GEI,TCI,SRI,GAQI -- we will return them
  res.json({
    timestamp: new Date().toISOString(),
    measures: state,
    indices,
  });
});

// health
app.get("/health", (req,res) => res.json({ ok:true, time: new Date().toISOString(), historyLen: history.length }));

// start
app.listen(PORT, () => {
  console.log(`🌐 Serveur prêt sur http://localhost:${PORT}/data`);
});
