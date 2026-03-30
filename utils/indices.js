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

    // ---------- TCI ----------
    const rawTCI=(state.temp==null?0:Math.abs(state.temp-22)*2.5)
                 + (state.rh==null?0:Math.abs(state.rh-50)*0.5)
                 + (state.pres==null?0:Math.abs(state.pres-1013)*0.02);
    const TCI_penalty_pct=clamp(rawTCI/76*100);
    const TCI=clamp(100-TCI_penalty_pct);

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

    // ---------- GEI ----------
    const corrWindow=lastWindow.slice(-(60*20));
    const gases=["co2","no2","co","nh3"];
    const corrSeries={};
    gases.forEach(k=>{corrSeries[k]=corrWindow.map(s=>s.measures[k]).filter(x=>x!=null);});
    const corrList=[];
    for(let i=0;i<gases.length;i++){
      for(let j=i+1;j<gases.length;j++){
        const a=corrSeries[gases[i]], b=corrSeries[gases[j]];
        if(a.length>=2 && a.length===b.length) corrList.push(Math.abs(pearson(a,b)));
      }
    }
    const meanCorr=corrList.length?mean(corrList):0;
    const GEI=clamp(100-meanCorr*100);

    // ---------- GAQI ----------
    const alpha={a1:0.45,a2:0.25,a3:0.2,a4:0.1};
    const GAQI=clamp(100-(alpha.a1*AQ_penalty+alpha.a2*TCI_penalty_pct+alpha.a3*(100-GEI)+alpha.a4*Volatility_penalty));

    return {
      AQL:Number(AQL.toFixed(2)), AQ_penalty:Number(AQ_penalty.toFixed(2)),
      TCI:Number(TCI.toFixed(2)), TCI_penalty_pct:Number(TCI_penalty_pct.toFixed(2)),
      SRI:Number(SRI.toFixed(2)), Volatility_penalty:Number(Volatility_penalty.toFixed(2)),
      GEI:Number(GEI.toFixed(2)),
      corr_co2_no2:Number(pearson(corrSeries.co2,corrSeries.no2).toFixed(3)),
      corr_co2_co:Number(pearson(corrSeries.co2,corrSeries.co).toFixed(3)),
      corr_co2_nh3:Number(pearson(corrSeries.co2,corrSeries.nh3).toFixed(3)),
      corr_no2_co:Number(pearson(corrSeries.no2,corrSeries.co).toFixed(3)),
      corr_no2_nh3:Number(pearson(corrSeries.no2,corrSeries.nh3).toFixed(3)),
      corr_co_nh3:Number(pearson(corrSeries.co,corrSeries.nh3).toFixed(3)),
      GAQI:Number(GAQI.toFixed(2))
    };

  } catch(err){
    console.error("computeIndices error:",err);
    return {AQL:0,AQ_penalty:0,TCI:0,TCI_penalty_pct:0,SRI:0,Volatility_penalty:0,GEI:0,
            corr_co2_no2:0,corr_co2_co:0,corr_co2_nh3:0,corr_no2_co:0,corr_no2_nh3:0,corr_co_nh3:0,GAQI:0};
  }
}
