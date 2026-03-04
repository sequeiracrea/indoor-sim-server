import express from "express";
import cors from "cors";
import { computeIndices } from "./utils/indices.js";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

/* ============================================================
   CONFIG OPTIMISÉE RENDER + PROTOPIE
============================================================ */

const TICK_INTERVAL = 2000;           // 2 secondes
const HISTORY_HOURS = 4;              // 4 heures
const HISTORY_MAX = (HISTORY_HOURS * 3600) / (TICK_INTERVAL / 1000);
// = 7200 entrées

/* ============================================================
   STATE
============================================================ */

let state = {
  co2: 600,
  no2: 40,
  nh3: 0.02,
  co: 0.5,
  temp: 22.5,
  rh: 50,
  pres: 1013
};

const history = [];

/* ============================================================
   HISTORY
============================================================ */

function pushHistory(measures) {
  const lastWindow = history.slice(-30); // 1 min approx (30 * 2s)
  const indices = computeIndices(measures, lastWindow);

  history.push({
    timestamp: Date.now(), // plus rapide qu'ISO
    measures: { ...measures },
    indices: { ...indices }
  });

  if (history.length > HISTORY_MAX) history.shift();
}

function windowSeconds(sec) {
  const cutoff = Date.now() - sec * 1000;
  return history.filter(h => h.timestamp >= cutoff);
}

/* ============================================================
   SIMULATION
============================================================ */

function vary(value, delta, min, max) {
  const change = (Math.random() * 2 - 1) * delta;
  let newVal = value + change;

  if (newVal < min) newVal = min;
  if (newVal > max) newVal = max;

  return parseFloat(newVal.toFixed(3));
}

setInterval(() => {
  try {
    state.co2 = vary(state.co2, 20, 450, 1500);
    state.no2 = vary(state.no2, 2, 20, 120);
    state.nh3 = vary(state.nh3, 0.002, 0.01, 0.08);
    state.co = vary(state.co, 0.05, 0.2, 3);
    state.temp = vary(state.temp, 0.12, 19, 26);
    state.rh = vary(state.rh, 0.3, 35, 65);
    state.pres = vary(state.pres, 0.05, 1008, 1018);

    pushHistory(state);
  } catch (err) {
    console.error("Tick error:", err);
  }
}, TICK_INTERVAL);

/* ============================================================
   ROUTES
============================================================ */

// Health (léger)
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    history_points: history.length,
    max_points: HISTORY_MAX
  });
});

// Dernière valeur (dashboard temps réel)
app.get("/data", (req, res) => {
  try {
    const lastWindow = history.slice(-30);
    const indices = computeIndices(state, lastWindow);

    res.json({
      timestamp: Date.now(),
      measures: state,
      indices
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   HISTORY OPTIMISÉ PROTOPIE
============================================================ */

app.get("/history", (req, res) => {
  try {
    const sec = Math.min(parseInt(req.query.sec || "14400", 10), 14400); 
    // max 4h

    const step = Math.max(parseInt(req.query.step || "15", 10), 1);
    // défaut = 15 → super fluide ProtoPie

    const slice = windowSeconds(sec);

    const reduced = slice.filter((_, i) => i % step === 0);

    res.json({
      sec,
      step,
      original_points: slice.length,
      returned_points: reduced.length,
      series: reduced
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   CORRELATION LIMITÉE (évite surcharge free tier)
============================================================ */

app.get("/corr", (req, res) => {
  try {
    const vars = (req.query.vars || "co2,no2,nh3,co")
      .split(",")
      .map(s => s.trim());

    const sec = Math.min(parseInt(req.query.sec || "1800", 10), 1800);
    // max 30 min pour éviter calcul lourd

    const slice = windowSeconds(sec);

    const series = {};
    vars.forEach(v => {
      series[v] = slice.map(s => s.measures[v]).filter(x => x != null);
    });

    const corr = {};

    for (let i = 0; i < vars.length; i++) {
      for (let j = i; j < vars.length; j++) {

        const a = series[vars[i]] || [];
        const b = series[vars[j]] || [];
        let r = 0;

        if (a.length >= 2 && a.length === b.length) {
          const n = a.length;
          const ma = a.reduce((s,x)=>s+x,0)/n;
          const mb = b.reduce((s,x)=>s+x,0)/n;

          let num=0, denA=0, denB=0;

          for (let k=0;k<n;k++){
            const da=a[k]-ma, db=b[k]-mb;
            num+=da*db;
            denA+=da*da;
            denB+=db*db;
          }

          const den=Math.sqrt(denA*denB);
          r = den===0?0:num/den;
        }

        corr[`${vars[i]}-${vars[j]}`] = Number(r.toFixed(3));
      }
    }

    res.json({ vars, sec, corr });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============================================================
   START
============================================================ */

app.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`);
});
