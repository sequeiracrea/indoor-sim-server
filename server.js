// server.js
import express from "express";
import cors from "cors";
import { computeIndices } from "./utils/indices.js";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// --- state & history ---
let state = {
  co2: 600,
  no2: 40,
  nh3: 0.02,
  co: 0.5,
  temp: 22.5,
  rh: 50,
  pres: 1013
};

const HISTORY_MAX = 3600;
const history = [];

// curseur de lecture pour /data
let streamIndex = 0;

// lecture auto
let streamPlaying = true;

// -----------------------------------------------
// stockage measures + indices
// -----------------------------------------------
function pushHistory(measures) {

  const lastWindow = history.slice(-60);
  const indices = computeIndices(measures, lastWindow);

  history.push({
    timestamp: new Date().toISOString(),
    measures: { ...measures },
    indices: { ...indices }
  });

  // limite history
  if (history.length > HISTORY_MAX) {
    history.shift();

    // correction du curseur
    if (streamIndex > 0) streamIndex--;
  }

  // si premier point
  if (history.length === 1) {
    streamIndex = 0;
  }

}

// -----------------------------------------------
// variation simulation
// -----------------------------------------------
function vary(value, delta, min, max) {

  const change = (Math.random() * 2 - 1) * delta;

  let newVal = value + change;

  if (newVal < min) newVal = min + (min - newVal) * 0.2;
  if (newVal > max) newVal = max - (newVal - max) * 0.2;

  return parseFloat(newVal.toFixed(3));

}

// -----------------------------------------------
// tick simulation
// -----------------------------------------------
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

}, 2000);

// -----------------------------------------------
// avance timeline
// -----------------------------------------------
setInterval(() => {

  if (!streamPlaying) return;

  if (streamIndex < history.length - 1) {
    streamIndex++;
  }

}, 1000);

// -----------------------------------------------
function windowSeconds(sec) {

  const cutoff = Date.now() - sec * 1000;

  return history.filter(h =>
    new Date(h.timestamp).getTime() >= cutoff
  );

}

// --------------------
// ROUTES API
// --------------------

app.get("/health", (req, res) => {

  res.json({
    ok: true,
    time: new Date().toISOString(),
    historyLen: history.length,
    streamIndex
  });

});

// -----------------------------------------------
// /data
// -----------------------------------------------
app.get("/data", (req, res) => {

  try {

    if (history.length === 0) {

      return res.json({
        timestamp: new Date().toISOString(),
        measures: state,
        indices: computeIndices(state, [])
      });

    }

    const entry = history[streamIndex];

    return res.json({
      timestamp: entry.timestamp,
      measures: entry.measures,
      indices: entry.indices,
      streamIndex,
      historyLength: history.length
    });

  } catch (err) {

    console.error("/data error:", err);

    return res.status(500).json({
      error: err.message
    });

  }

});

// -----------------------------------------------
// /history
// -----------------------------------------------
app.get("/history", (req, res) => {

  try {

    const sec = parseInt(req.query.sec || "1800", 10);

    const slice = windowSeconds(sec);

    return res.json({
      requested_sec: sec,
      length: slice.length,
      series: slice.map(s => ({
        timestamp: s.timestamp,
        measures: s.measures,
        indices: s.indices || {}
      }))
    });

  } catch (err) {

    console.error("/history error:", err);

    return res.status(500).json({
      error: err.message
    });

  }

});

// -----------------------------------------------
// STREAM CONTROL (nouveaux endpoints)
// -----------------------------------------------

app.get("/stream/set", (req, res) => {

  const idx = parseInt(req.query.index || 0);

  streamIndex = Math.max(
    0,
    Math.min(idx, history.length - 1)
  );

  res.json({
    streamIndex,
    historyLength: history.length
  });

});

app.get("/stream/play", (req, res) => {

  streamPlaying = true;

  res.json({
    playing: true,
    streamIndex
  });

});

app.get("/stream/pause", (req, res) => {

  streamPlaying = false;

  res.json({
    playing: false,
    streamIndex
  });

});

// -----------------------------------------------
// /corr
// -----------------------------------------------
app.get("/corr", (req, res) => {

  try {

    const vars = (req.query.vars || "co2,no2,nh3,co")
      .split(",")
      .map(s => s.trim());

    const sec = parseInt(req.query.sec || "1800", 10);

    const slice = windowSeconds(sec);

    const series = {};

    vars.forEach(v => {

      series[v] = slice
        .map(s => s.measures[v])
        .filter(x => x != null);

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

            const da=a[k]-ma;
            const db=b[k]-mb;

            num+=da*db;
            denA+=da*da;
            denB+=db*db;

          }

          const den=Math.sqrt(denA*denB);

          r = den===0?0:num/den;

        }

        corr[`${vars[i]}-${vars[j]}`] =
          parseFloat((r||0).toFixed(3));

      }

    }

    res.json({ vars, sec, corr });

  } catch (err) {

    console.error("/corr error:", err);

    res.status(500).json({
      error: err.message
    });

  }

});

// -----------------------------------------------

app.use((err, req, res, next) => {

  console.error("Unhandled error:", err);

  res.status(500).json({
    error: "server error"
  });

});

// -----------------------------------------------

app.listen(PORT, () => {

  console.log(
    `🌐 Serveur prêt sur http://localhost:${PORT}/data`
  );

});
