// utils/indices.js
export function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s,x)=>s+x,0)/arr.length;
}
export function std(arr) {
  if (!arr || arr.length === 0) return 0;
  const m = mean(arr);
  const v = arr.reduce((s,x)=> s + (x - m)*(x - m), 0) / arr.length;
  return Math.sqrt(v);
}
export function pearson(a, b) {
  if (!a || !b || a.length !== b.length || a.length < 2) return 0;
  const n = a.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0, denA = 0, denB = 0;
  for (let i=0;i<n;i++){
    const da = a[i] - ma;
    const db = b[i] - mb;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  if (den === 0) return 0;
  return num / den;
}

// helper: clamp
function clamp01(v){ return Math.max(0, Math.min(1, v)); }
function clamp(v, a=0, b=100){ return Math.max(a, Math.min(b, v)); }

// computeIndices: takes current state + window array (lastWindow entries: {timestamp, measures})
export function computeIndices(state, lastWindow = []) {
  // ---------- AQL ----------
  // thresholds (adjust if you want)
  const th = {
    co2: [600, 2000],
    no2: [40, 200],
    nh3: [0.01, 0.1],
    co: [0.5, 10]
  };
  function pollutantPenalty(x, good, bad) {
    if (x <= good) return 0;
    const p = (x - good) / (bad - good);
    return clamp(p * 100, 0, 100);
  }
  const p_co2 = pollutantPenalty(state.co2, th.co2[0], th.co2[1]);
  const p_no2 = pollutantPenalty(state.no2, th.no2[0], th.no2[1]);
  const p_nh3 = pollutantPenalty(state.nh3, th.nh3[0], th.nh3[1]);
  const p_co = pollutantPenalty(state.co, th.co[0], th.co[1]);
  const weightsPoll = { co2:0.5, no2:0.25, nh3:0.15, co:0.10 };
  const AQ_penalty = p_co2*weightsPoll.co2 + p_no2*weightsPoll.no2 + p_nh3*weightsPoll.nh3 + p_co*weightsPoll.co;
  const AQL = clamp(100 - AQ_penalty, 0, 100);

  // ---------- TCI ----------
  // raw penalty similar to earlier messages
  const raw_tci = Math.abs(state.temp - 22)*2.5 + Math.abs(state.rh - 50)*0.5 + Math.abs(state.pres - 1013)*0.02;
  const max_raw = 76; // normalization constant (tunable)
  const TCI_penalty_pct = clamp(raw_tci / max_raw * 100, 0, 100);
  const TCI = clamp(100 - TCI_penalty_pct, 0, 100);

  // ---------- SRI (volatility) ----------
  // compute std / amplitude on lastWindow (default last 60s)
  const last60 = lastWindow.slice(-60); // last 60 entries approx (if tick=1s)
  const co2_series = last60.map(s=>s.measures.co2);
  const temp_series = last60.map(s=>s.measures.temp);
  const rh_series = last60.map(s=>s.measures.rh);
  // take standard deviation (or 0 if too few points)
  const s_co2 = co2_series.length >= 2 ? std(co2_series) : 0;
  const s_temp = temp_series.length >= 2 ? std(temp_series) : 0;
  const s_rh = rh_series.length >= 2 ? std(rh_series) : 0;
  const beta = { co2:0.4, temp:0.3, rh:0.3 };
  // normalize each by expected max sigma
  const max_sigma = { co2:500, temp:3, rh:10 };
  const term = (s_co2 / max_sigma.co2) * beta.co2 + (s_temp / max_sigma.temp) * beta.temp + (s_rh / max_sigma.rh) * beta.rh;
  const SRI = clamp(100 - term * 100, 0, 100);
  const Volatility_penalty = clamp(term * 100, 0, 100);

  // ---------- GEI ----------
  // compute correlations on a longer window (last 10-30 min ideally)
  const corrWindow = lastWindow.slice(- (60 * 20)); // last 20 min approx
  const corrSeries = {};
  ['co2','no2','co','nh3'].forEach(k=>{
    corrSeries[k] = corrWindow.map(s=>s.measures[k]).filter(x=>x !== undefined && x !== null);
  });
  // compute pearson for pairs (co2,no2) and (co,nh3) as earlier formula
  const corr_co2_no2 = (corrSeries.co2.length >= 2 && corrSeries.no2.length === corrSeries.co2.length) ? pearson(corrSeries.co2, corrSeries.no2) : 0;
  const corr_co_nh3 = (corrSeries.co.length >= 2 && corrSeries.nh3.length === corrSeries.co.length) ? pearson(corrSeries.co, corrSeries.nh3) : 0;
  const GEI = clamp(100 - Math.abs(corr_co2_no2)*40 - Math.abs(corr_co_nh3)*40, 0, 100);

  // ---------- GAQI (global) ----------
  // Example weighted composition: (tune alpha weights as needed)
  const alpha = { a1:0.45, a2:0.25, a3:0.2, a4:0.10 };
  // comfort penalty uses TCI_penalty_pct, AQ_penalty is already 0..100, volatility_penalty is Volatility_penalty
  const GAQI_raw = 100 - (alpha.a1 * AQ_penalty + alpha.a2 * TCI_penalty_pct + alpha.a3 * (100 - GEI) + alpha.a4 * Volatility_penalty);
  const GAQI = clamp(GAQI_raw, 0, 100);

  // --- Return breakdown
  return {
    AQL: parseFloat(AQL.toFixed(2)),
    AQ_penalty: parseFloat(AQ_penalty.toFixed(2)),
    TCI: parseFloat(TCI.toFixed(2)),
    TCI_penalty_pct: parseFloat(TCI_penalty_pct.toFixed(2)),
    SRI: parseFloat(SRI.toFixed(2)),
    Volatility_penalty: parseFloat(Volatility_penalty.toFixed(2)),
    GEI: parseFloat(GEI.toFixed(2)),
    corr_co2_no2: parseFloat(corr_co2_no2.toFixed(3)),
    corr_co_nh3: parseFloat(corr_co_nh3.toFixed(3)),
    GAQI: parseFloat(GAQI.toFixed(2))
  };
}
