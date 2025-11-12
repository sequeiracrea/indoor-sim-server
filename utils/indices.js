export function computeIndices(data) {
  const { co2, no2, nh3, co, temp, rh, pres } = data;

  // --- AQL (Air Quality Level) ---
  const penalty = (x, g, b) => Math.max(0, Math.min(1, (x - g) / (b - g))) * 100;
  const w = { co2: 0.5, no2: 0.25, nh3: 0.15, co: 0.1 };
  const p_co2 = penalty(co2, 600, 2000);
  const p_no2 = penalty(no2, 40, 200);
  const p_nh3 = penalty(nh3, 0.01, 0.1);
  const p_co = penalty(co, 0.5, 10);
  const AQ_penalty = w.co2 * p_co2 + w.no2 * p_no2 + w.nh3 * p_nh3 + w.co * p_co;
  const AQL = 100 - AQ_penalty;

  // --- TCI (Thermal Comfort Index) ---
  const raw =
    Math.abs(temp - 22) * 2.5 +
    Math.abs(rh - 50) * 0.5 +
    Math.abs(pres - 1013) * 0.02;
  const TCI_penalty = Math.min(100, (raw / 76) * 100);
  const TCI = 100 - TCI_penalty;

  // --- GEI (Gas Equilibrium Index) ---
  const fakeCorr1 = 0.1 + Math.random() * 0.2;
  const fakeCorr2 = 0.05 + Math.random() * 0.2;
  const GEI = 100 - Math.abs(fakeCorr1) * 40 - Math.abs(fakeCorr2) * 40;

  // --- SRI (Stability & Reactivity Index) ---
  const σ_co2 = Math.random() * 50;
  const σ_temp = Math.random() * 0.5;
  const σ_rh = Math.random() * 2;
  const β = { co2: 0.4, temp: 0.3, rh: 0.3 };
  const term =
    (σ_co2 / 500) * β.co2 +
    (σ_temp / 3) * β.temp +
    (σ_rh / 10) * β.rh;
  const SRI = Math.max(0, 100 - term * 100);

  // --- GAQI (Global Air & Comfort Index) ---
  const α = { a1: 0.4, a2: 0.4, a3: 0.2 };
  const Comfort_penalty = TCI_penalty;
  const Volatility_penalty = 100 - SRI;
  const GAQI =
    100 -
    (α.a1 * AQ_penalty +
      α.a2 * Comfort_penalty +
      α.a3 * Volatility_penalty);

  return {
    AQL: round(AQL),
    GEI: round(GEI),
    TCI: round(TCI),
    SRI: round(SRI),
    GAQI: round(GAQI),
  };
}

function round(v) {
  return Math.round(v * 10) / 10;
}
