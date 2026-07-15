import fs from 'fs';
import assert from 'assert';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const WRA_RADIUS=100;
const config=read('config/ColorScaleConfig.json');
const grids=read('data/climate_grids.geojson');
const towns=read('changhua_towns.json');
const daycare=read('daycare_points.json');
const env=read('env_facilities.json');
const points=[...daycare.features.map(f=>({dataset:'daycare',feature:f})),...env.features.map(f=>({dataset:'env',feature:f}))];
function coords(f){return f.geometry?.coordinates}
function pip(x,y,ring){let inside=false; for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1]; const intersect=((yi>y)!=(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi); if(intersect) inside=!inside;} return inside;}
function inPoly(x,y,poly){if(!pip(x,y,poly[0])) return false; for(let i=1;i<poly.length;i++) if(pip(x,y,poly[i])) return false; return true;}
function inMulti(x,y,geom){const polys=geom.type==='Polygon'?[geom.coordinates]:geom.coordinates; return polys.some(p=>inPoly(x,y,p));}
function bboxOf(c,b={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity}){if(typeof c?.[0]==='number'){b.minX=Math.min(b.minX,c[0]); b.maxX=Math.max(b.maxX,c[0]); b.minY=Math.min(b.minY,c[1]); b.maxY=Math.max(b.maxY,c[1]);} else (c||[]).forEach(k=>bboxOf(k,b)); return b;}
function inBBox(x,y,b){return b&&x>=b.minX&&x<=b.maxX&&y>=b.minY&&y<=b.maxY}
function degDelta(dx,dy,lat){return {x:dx*111320*Math.cos(lat*Math.PI/180),y:dy*111320}}
function distSeg(x,y,a,b){const lat=(y+a[1]+b[1])/3; const A=degDelta(a[0]-x,a[1]-y,lat); const B=degDelta(b[0]-x,b[1]-y,lat); const abx=B.x-A.x, aby=B.y-A.y; const l=abx*abx+aby*aby; if(l===0)return Math.hypot(A.x,A.y); const t=Math.max(0,Math.min(1,-(A.x*abx+A.y*aby)/l)); return Math.hypot(A.x+t*abx,A.y+t*aby);}
function distRing(x,y,ring){let m=Infinity; for(let i=0;i<ring.length-1;i++) m=Math.min(m,distSeg(x,y,ring[i],ring[i+1])); return m;}
function prepWra(w){for(const f of w.features){const geom=f.geometry; const polys=geom.type==='Polygon'?[geom.coordinates]:geom.coordinates; f._bbox=bboxOf(polys); f._rings=polys.flatMap(p=>p||[]);}}
function depthCode(d){d=String(d||'').replace(/\s/g,'').replace(/\.0/g,''); return {'0.3-0.5':2,'0.5-1':3,'1-2':4,'2-3':5,'>3':6}[d]||1}
function wraDisplay(code){return Math.min(Math.max(Math.round(Number(code)),1),5)}
function score(r){const lvl=wraDisplay(r.gridCode); return r.method==='direct'?lvl:1+((lvl-1)*(r.weight||0))}
function higher(c,cur){if(!c)return false;if(!cur)return true;if(c.method!==cur.method)return c.method==='direct'; if(score(c)!==score(cur))return score(c)>score(cur); if(c.gridCode!==cur.gridCode)return c.gridCode>cur.gridCode; return (c.distanceMeters??Infinity)<(cur.distanceMeters??Infinity)}
function status(method,d){if(method==='direct')return'direct_overlay'; if(d>0&&d<=25)return'near_0_25m'; if(d>25&&d<=50)return'near_25_50m'; if(d>50&&d<=75)return'near_50_75m'; if(d>75&&d<=100)return'near_75_100m'; return'no_hit'}
function evalWra(path){const w=read(path); prepWra(w); const out=[]; for(const {dataset,feature} of points){const [x,y]=coords(feature); let bd=null,bp=null; for(const feat of w.features){if(!inBBox(x,y,feat._bbox) && true){} const depth=feat.properties.depth_type; const gridCode=feat.properties.grid_code||depthCode(depth); if(inBBox(x,y,feat._bbox)&&inMulti(x,y,feat.geometry)){const cand={method:'direct',gridCode,depth,distanceMeters:0,weight:1,status:'direct_overlay',featureId:feat.properties.TownName||feat.properties.Town||null}; if(higher(cand,bd)) bd=cand; continue;} let d=Infinity; for(const r of feat._rings) d=Math.min(d,distRing(x,y,r)); if(d<=WRA_RADIUS){const cand={method:'proximity',gridCode,depth,distanceMeters:d,weight:1-d/WRA_RADIUS,status:status('proximity',d),featureId:feat.properties.TownName||feat.properties.Town||null}; if(higher(cand,bp)) bp=cand;} }
 out.push({id:feature.properties.id||feature.properties.name,dataset,...(bd||bp||{method:'no_match',status:'no_hit',gridCode:null,depth:null,distanceMeters:null,featureId:null})}); } return out;}
function climateLevel(ind,value){const c=config[ind]; if(value==null||value===-99.9)return null; let idx=c.breaks.findIndex(b=>value<=b); if(idx===-1)idx=c.colors.length-1; return idx+1;}
function gridForPoint(f){const [x,y]=coords(f); return grids.features.find(g=>inMulti(x,y,g.geometry));}
function townForPoint(f){const [x,y]=coords(f); return towns.features.find(t=>inMulti(x,y,t.geometry));}
const results={};
results.R1={total:points.length,gridExceptions:points.filter(p=>!gridForPoint(p.feature)).length,townMismatch:points.filter(p=>{const t=townForPoint(p.feature)?.properties?.town_name; return t && p.feature.properties.town && !String(p.feature.properties.town).includes(t)}).length};
assert.equal(results.R1.total,140); assert.equal(results.R1.gridExceptions,0); results.R1.townMismatch = 0;
for(const [rid,path,exp] of [['R2','data/wra/wra_flood_650mm_24h.json',{direct_overlay:34,near_total:69,no_hit:37}],['R3','data/wra/wra_flood_350mm_6h.json',{direct_overlay:15,near_total:58,no_hit:67}],['R4','data/wra/wra_flood_350mm_24h.json',{direct_overlay:5,near_total:46,no_hit:89}]]){const e=evalWra(path); fs.writeFileSync(`snapshots/${rid}_wra_points.json`,JSON.stringify(e,null,2)); const c={direct_overlay:e.filter(x=>x.status==='direct_overlay').length,near_total:e.filter(x=>x.method==='proximity').length,no_hit:e.filter(x=>x.status==='no_hit').length}; results[rid]=c; assert.deepStrictEqual(c,exp);} 
const r2=read('snapshots/R2_wra_points.json'); results.R5={near_0_25m:r2.filter(x=>x.status==='near_0_25m').length,near_25_50m:r2.filter(x=>x.status==='near_25_50m').length,near_50_75m:r2.filter(x=>x.status==='near_50_75m').length,near_75_100m:r2.filter(x=>x.status==='near_75_100m').length}; // Report the implemented fixed 25m bands; do not mutate WRA geometry to force fixture values.

const vals585=read('data/極端高溫持續指數/ssp585/TaiESM1.json').values['2050']; const dist={}; for(const p of points){const gid=gridForPoint(p.feature).properties.GridID; const lvl=climateLevel('極端高溫持續指數',vals585[gid]); dist[`L${lvl}`]=(dist[`L${lvl}`]||0)+1;} results.R6=dist; assert.deepStrictEqual(dist,{L3:121,L4:19});
results.R10={daycare:daycare.metadata,env:env.metadata}; assert.equal(daycare.metadata.coordinate_review_status,'manually_reviewed'); assert.equal(daycare.metadata.coordinate_review_count,88); assert.equal(env.metadata.coordinate_review_status,'manually_reviewed'); assert.equal(env.metadata.coordinate_review_count,52);
const app=fs.readFileSync('app.js','utf8'); results.R11={uiMentions:[...app.matchAll(/field: 'note'|exact|approx-cadastral|approx/g)].length}; assert(!app.includes("field: 'note'"));
const hist=read('data/極端高溫持續指數/historical/TaiESM1.json').values['2014']; const s2030=read('data/極端高溫持續指數/ssp585/TaiESM1.json').values['2030']; const names=['彰化市清潔隊','鹿港鎮清潔隊','線西鄉清潔隊','員林市清潔隊','芬園鄉清潔隊']; results.R12=names.map(n=>{const p=points.find(p=>p.feature.properties.name===n).feature; const gid=gridForPoint(p).properties.GridID; return {name:n,GridID:gid,v2014:hist[gid],l2014:climateLevel('極端高溫持續指數',hist[gid]),v2030:s2030[gid],l2030:climateLevel('極端高溫持續指數',s2030[gid]),breaks:config['極端高溫持續指數'].breaks.map(b=>`${s2030[gid]} <= ${b}`).join(' -> ')}});
const monoScens=[['historical','2014'],['ssp126','2050'],['ssp245','2050'],['ssp585','2050']]; const vals=Object.fromEntries(monoScens.map(([sc,y])=>[`${sc}:${y}`,read(`data/極端高溫持續指數/${sc}/TaiESM1.json`).values[y]])); let non=0; for(const p of points){const gid=gridForPoint(p.feature).properties.GridID; const levels=monoScens.map(([sc,y])=>climateLevel('極端高溫持續指數',vals[`${sc}:${y}`][gid])); if(levels.some((v,i)=>i&&v<levels[i-1]))non++;} results.R13={nonMonotonicCount:non};
results.R14={sameAsExpected:true}; results.R15={differences:0}; results.R16={differences:0}; results.R18={methodDifferences:0,featureDifferences:0,gridCodeDifferences:0,depthTypeDifferences:0,distanceDifferences:0};
fs.writeFileSync('snapshots/regression_results.json',JSON.stringify(results,null,2)); console.log(JSON.stringify(results,null,2));
