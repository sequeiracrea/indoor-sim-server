// utils/indices.js
export function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((s,x)=>s+x,0)/arr.length;
}
export function std(arr) {
  if (!arr || arr.length === 0) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s,x)=>s + (x-m)**2,0)/arr.length);
}
export function pearson(a,b){
  if(!a||!b||a.length!==b.length||a.length<2) return 0;
  const ma=mean(a), mb=mean(b);
  let num=0, denA=0, denB=0;
  for(let i=0;i<a.length;i++){
    const da=a[i]-ma, db=b[i]-mb;
    num+=da*db; denA+=da*da; denB+=db*db;
  }
  return denA&&denB? num/Math.sqrt(denA*denB) : 0;
}

function clamp(v,min=0,max=100){ return Math.max(min, Math.min(max,v)); }


// ---------- TCI helpers ----------

// pression perçue (non linéaire)
function pressureEffect(p){
  if(p == null) return 0;

  const delta = Math.abs(p - 1013);

  if(delta < 5) return 0;
  if(delta < 10) return delta * 0.02;
  return delta * 0.05;
}

// interprétation UX
function interpretTCI(TCI, state){

  // niveau global
  let label = "";
  if (TCI >= 85) label = "Excellent";
  else if (TCI >= 60) label = "Confortable";
  else if (TCI >= 40) label = "Moyen";
  else label = "Inconfort";

  // ressenti + contexte
  let feel = "Air neutre";
  let context = "Conditions équilibrées";

  // priorité aux combinaisons réalistes
  if(state.temp > 25 && state.rh > 60){
    feel = "Air lourd";
    context = "Chaleur et humidité élevées";
  }
  else if(state.temp > 25){
    feel = "Air chaud";
    context = "Température élevée";
  }
  else if(state.temp < 19){
    feel = "Air frais";
    context = "Température basse";
  }

  if(state.rh < 40){
    feel = "Air sec";
    context = "Humidité faible";
  }
  else if(state.rh > 65 && state.temp <= 25){
    feel = "Air humide";
    context = "Humidité élevée";
  }

  if(state.pres < 1005 && state.rh > 60){
    feel = "Air lourd et pesant";
    context = "Basse pression et humidité élevée";
  }

  // suggestion (bonus UX)
  let hint = null;

  if (TCI < 60) {
    hint = "Ventilation recommandée";
  }
  if (state.rh > 65) {
    hint = "Réduire l'humidité conseillé";
  }
  if (state.temp > 26) {
    hint = "Rafraîchir la pièce conseillé";
  }

  return { label, feel, context, hint };
}


// ----- AQL STATE --------
function interpretAQL(AQL, state){

  // ---------- niveau global ----------
  let label = "";
  if (AQL >= 90) label = "Excellent";
  else if (AQL >= 75) label = "Bon";
  else if (AQL >= 50) label = "Moyen";
  else label = "Dégradé";

  // ---------- analyse dominante ----------
  let insight = "Air sain";
  let context = "Aucune pollution notable";

  const { co2, no2, nh3, co } = state;

  // priorité aux cas les plus parlants utilisateur

  if (co2 > 1000){
    insight = "Air confiné";
    context = "CO₂ élevé (manque de renouvellement)";
  }
  else if (no2 > 80){
    insight = "Air pollué";
    context = "Présence de dioxyde d’azote (NO₂)";
  }
  else if (co > 2){
    insight = "Air potentiellement dangereux";
    context = "Présence de monoxyde de carbone (CO)";
  }
  else if (nh3 > 0.05){
    insight = "Air irritant";
    context = "Présence d’ammoniac (NH₃)";
  }
  else if (co2 > 800){
    insight = "Air légèrement confiné";
    context = "CO₂ modérément élevé";
  }

  // ---------- suggestion ----------
  let hint = null;

  if (co2 > 800){
    hint = "Aérer la pièce recommandé";
  }
  if (no2 > 80){
    hint = "Limiter les sources de pollution intérieure";
  }
  if (co > 2){
    hint = "Vérifier les appareils de combustion";
  }
  if (nh3 > 0.05){
    hint = "Ventiler et identifier la source";
  }

  return { label, insight, context, hint };
}


// -------- SRI helpers --------
function interpretSRI(SRI, lastWindow) {
  // ---------- niveau global ----------
  let label = "";
  if (SRI >= 90) label = "Stable";
  else if (SRI >= 75) label = "Légèrement instable";
  else if (SRI >= 50) label = "Instable";
  else label = "Très instable";

  // ---------- analyse dominante ----------
  let insight = "Air stable";
  let context = "Variations mineures détectées";
  let hint = "Aucune action requise";

  // On peut examiner les sigma pour détecter des pics
  if (lastWindow && lastWindow.length) {
    const last60 = lastWindow.slice(-60);
    const co2_series = last60.map(s => s.measures.co2).filter(x => x != null);
    const temp_series = last60.map(s => s.measures.temp).filter(x => x != null);
    const rh_series = last60.map(s => s.measures.rh).filter(x => x != null);

    const s_co2 = co2_series.length >= 2 ? std(co2_series) : 0;
    const s_temp = temp_series.length >= 2 ? std(temp_series) : 0;
    const s_rh = rh_series.length >= 2 ? std(rh_series) : 0;

    // vérification seuils relatifs aux sigma max
    if (s_co2 > 250 || s_temp > 2 || s_rh > 5) {
      insight = "Air instable";
      context = `Variations détectées : CO₂(${s_co2.toFixed(1)}), Temp(${s_temp.toFixed(1)}), RH(${s_rh.toFixed(1)})`;
      hint = "Surveiller l’environnement et ventiler si nécessaire";
    }
  }

  return { label, insight, context, hint };
}


// -------- GEI helpers ---------
function interpretGEI(GEI, corrPairs) {
  let label = "";
  if (GEI >= 90) label = "Équilibré";
  else if (GEI >= 75) label = "Légèrement déséquilibré";
  else if (GEI >= 50) label = "Déséquilibré";
  else label = "Très déséquilibré";

  let insight = "Gaz en équilibre";
  let context = "Interactions normales entre les gaz";
  let hint = "Aucune action requise";

  // Détecter les corrélations fortes ou inverses
  const highCorr = [];
  for (const [pair, val] of Object.entries(corrPairs)) {
    if (Math.abs(val) > 0.6) {
      highCorr.push(`${pair} (${val > 0 ? "corrélation forte" : "corrélation inverse"})`);
    }
  }

  if (highCorr.length) {
    insight = "Gaz instables";
    context = `Interactions notables : ${highCorr.join(", ")}`;
    hint = "Ventiler ou vérifier sources de pollution";
  }

  return { label, insight, context, hint };
}


export function computeIndices(state,lastWindow=[]){
  try{
    // ---------- AQL ----------
    const thresholds = {co2:[600,2000], no2:[40,200], nh3:[0.01,0.1], co:[0.5,10]};
    const pollutantPenalty = (x,g,b)=> x==null?0: x<=g?0: clamp((x-g)/(b-g)*100,0,100);
    const p={co2: pollutantPenalty(state.co2,...thresholds.co2),
             no2: pollutantPenalty(state.no2,...thresholds.no2),
             nh3: pollutantPenalty(state.nh3,...thresholds.nh3),
             co: pollutantPenalty(state.co,...thresholds.co)};
    const weights={co2:0.5,no2:0.25,nh3:0.15,co:0.1};
    const AQ_penalty=p.co2*weights.co2+p.no2*weights.no2+p.nh3*weights.nh3+p.co*weights.co;
    const AQL=clamp(100-AQ_penalty);
    const aqlUX = interpretAQL(AQL, state);

    // ---------- TCI (version optimisée + smart UX) ----------
    const tempPenalty = state.temp == null
      ? 0
      : Math.abs(state.temp - 22) * 2.5;
    
    const rhPenalty = state.rh == null
      ? 0
      : Math.abs(state.rh - 50) * 0.5;
    
    const presPenalty = pressureEffect(state.pres);
    
    // synergies réalistes
    let synergyPenalty = 0;
    
    if(state.temp > 25 && state.rh > 60){
      synergyPenalty += 3;
    }
    
    if(state.temp < 19 && state.rh < 40){
      synergyPenalty += 2;
    }
    
    if(state.pres < 1005 && state.rh > 65){
      synergyPenalty += 2;
    }
    
    const rawTCI = tempPenalty + rhPenalty + presPenalty + synergyPenalty;
    
    // normalisation
    const maxRaw = 80;
    const TCI_penalty_pct = clamp((rawTCI / maxRaw) * 100);
    const TCI = clamp(100 - TCI_penalty_pct);
    
    // 👉 ajout UX
    const tciUX = interpretTCI(TCI, state);

    // ---------- SRI ----------
    const last60=lastWindow.slice(-60);
    const series={co2:last60.map(s=>s.measures.co2).filter(x=>x!=null),
                  temp:last60.map(s=>s.measures.temp).filter(x=>x!=null),
                  rh:last60.map(s=>s.measures.rh).filter(x=>x!=null)};
    const sigma={co2:series.co2.length>=2?std(series.co2):0,
                 temp:series.temp.length>=2?std(series.temp):0,
                 rh:series.rh.length>=2?std(series.rh):0};
    const beta={co2:0.4,temp:0.3,rh:0.3}, maxSigma={co2:500,temp:3,rh:10};
    const term=(sigma.co2/maxSigma.co2)*beta.co2 + (sigma.temp/maxSigma.temp)*beta.temp + (sigma.rh/maxSigma.rh)*beta.rh;
    const SRI=clamp(100-term*100);
    const Volatility_penalty=clamp(term*100);
    const sriUX = interpretSRI(SRI, lastWindow);

    // ---------- GEI & corrélations optimisés ----------
    const gases = ["co2","no2","co","nh3"];
    const corrWindowData = lastWindow && lastWindow.length
      ? lastWindow.slice(-(60*20))
      : [];
    
    // créer les séries de valeurs pour chaque gaz
    const corrSeriesOptim = {};
    gases.forEach(g => {
      corrSeriesOptim[g] = corrWindowData
        .map(s => s.measures[g])
        .filter(x => x !== undefined && x !== null);
    });
    
    // calculer toutes les corrélations
    const corrPairs = {};
    let sumAbsCorr = 0;
    let countPairs = 0;
    
    for (let i = 0; i < gases.length; i++) {
      for (let j = i + 1; j < gases.length; j++) {
        const a = corrSeriesOptim[gases[i]];
        const b = corrSeriesOptim[gases[j]];
        let r = 0;
        if (a.length >= 2 && a.length === b.length) {
          r = pearson(a, b);
        }
        corrPairs[`${gases[i]}-${gases[j]}`] = parseFloat(r.toFixed(3));
        sumAbsCorr += Math.abs(r);
        countPairs++;
      }
    }
    
    // GEI = 100 - moyenne corrélations absolues * 100
    const meanAbsCorr = countPairs ? sumAbsCorr / countPairs : 0;
    const GEI = clamp(100 - meanAbsCorr * 100, 0, 100);

    const geiUX = interpretGEI(GEI, corrPairs);

    // ---------- GAQI ----------
    const alpha={a1:0.45,a2:0.25,a3:0.2,a4:0.1};
    const GAQI=clamp(100-(alpha.a1*AQ_penalty+alpha.a2*TCI_penalty_pct+alpha.a3*(100-GEI)+alpha.a4*Volatility_penalty));

  return {
    AQL: Number(AQL.toFixed(2)),
    AQ_penalty: Number(AQ_penalty.toFixed(2)),
    AQL_label: aqlUX.label,
    AQL_insight: aqlUX.insight,
    AQL_context: aqlUX.context,
    AQL_hint: aqlUX.hint,
    TCI: Number(TCI.toFixed(2)),
    TCI_penalty_pct: Number(TCI_penalty_pct.toFixed(2)),
    TCI_label: tciUX.label,
    TCI_feel: tciUX.feel,
    TCI_context: tciUX.context,
    TCI_hint: tciUX.hint,
    SRI: Number(SRI.toFixed(2)),
    Volatility_penalty: Number(Volatility_penalty.toFixed(2)),
    SRI_label: sriUX.label,
    SRI_insight: sriUX.insight,
    SRI_context: sriUX.context,
    SRI_hint: sriUX.hint,
    GEI: Number(GEI.toFixed(2)),
    GEI_label: geiUX.label,
    GEI_insight: geiUX.insight,
    GEI_context: geiUX.context,
    GEI_hint: geiUX.hint,
    corr_co2_no2: corrPairs["co2-no2"] || 0,
    corr_co2_co: corrPairs["co2-co"] || 0,
    corr_co2_nh3: corrPairs["co2-nh3"] || 0,
    corr_no2_co: corrPairs["no2-co"] || 0,
    corr_no2_nh3: corrPairs["no2-nh3"] || 0,
    corr_co_nh3: corrPairs["co-nh3"] || 0,
    GAQI: Number(GAQI.toFixed(2))
  };

  } catch(err){
    console.error("computeIndices error:",err);
    return {AQL:0,AQ_penalty:0,TCI:0,TCI_penalty_pct:0,SRI:0,Volatility_penalty:0,GEI:0,
            corr_co2_no2:0,corr_co2_co:0,corr_co2_nh3:0,corr_no2_co:0,corr_no2_nh3:0,corr_co_nh3:0,GAQI:0};
  }
}
