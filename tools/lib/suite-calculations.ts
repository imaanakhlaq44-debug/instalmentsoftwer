import { checkLease, amendmentLetter, JURISDICTION_NAMES, type Finding, type Jurisdiction } from './lease-rules';
export type Currency = 'USD' | 'GBP';
export type Unit = 'money' | 'percent' | 'number' | 'text';
export type CalculationRow = { label: string; value: number; unit?: Unit; textValue?: string };
export type CalculationResult = { headline: string; value: number; unit?: Unit; textValue?: string; rows: CalculationRow[]; notes: string[]; status?: 'good' | 'warn' | 'alert'; error?: string; findings?: Finding[]; letter?: string };

/** UI input contract (all dates ISO YYYY-MM-DD). */
export const toolDefaults: Record<string, Record<string, any>> = {
  'prorated-rent': { monthlyRent: 1800, moveIn: '2026-05-15', moveOut: '', method: 'exact' },
  'rent-affordability': { incomeMode: 'annual', annualIncome: 72000, hourlyWage: 25, hoursPerWeek: 40, debt: 0 },
  'roommate-rent-splitter': { totalRent: 2400, rooms: [{ name: 'Room 1', area: 150, bath: false, view: false, parking: false }, { name: 'Room 2', area: 150, bath: false, view: false, parking: false }] },
  'rent-vs-buy': { rent: 2000, price: 350000, downPayment: 20, interest: 6.5, loanYears: 30, investmentReturn: 5, homeGrowth: 3, rentGrowth: 3, taxRate: 1.1, insurance: 1200, maintenancePct: 1, buyClosingPct: 2, sellClosingPct: 6, years: 10 },
  'rent-increase': { currentRent: 1800, newRent: 1900, noticeDate: '', renewalDate: '', jurisdiction: 'general', cpi: 0 },
  'move-in-cash': { rent: 1800, depositMonths: 1, lastMonth: false, moving: 500, fees: 100, utilities: 150 },
  'utility-splitter': { electric: 100, gas: 50, water: 60, internet: 60, billingDays: 30, people: [{ name: 'Roommate 1', away: 0, paid: 0 }, { name: 'Roommate 2', away: 0, paid: 0 }] },
  'moving-cost-estimator': { apartmentSize: '1', distance: 25, service: 'diy', fuelPrice: 3.5, mpg: 10, baseCost: 100, labor: 0 },
  'commute-vs-rent': { rentA: 2000, rentB: 1800, distanceA: 10, distanceB: 15, minutesA: 25, minutesB: 35, workdays: 22, mpg: 25, gasPrice: 3.5, transitA: 0, transitB: 0, mode: 'car' },
  'sublease-rate': { rent: 1800, startDate: '2026-06-01', endDate: '2026-08-31', premium: 10, includeUtilities: false, utilities: 0 },
  'cap-rate-calculator': { price: 300000, rent: 2200, taxes: 3000, insurance: 1200, maintenancePct: 1, vacancy: 5, otherExpenses: 0, downPayment: 20, interest: 6.5, loanYears: 30, closingCosts: 5000 },
  'rent-per-sqft': { rent: 2000, area: 1000, benchmark: 0 },
  'couple-rent-splitter': { rent: 2400, incomeA: 5000, incomeB: 3000, otherSharedExpenses: 0 },
  'security-deposit-refund': { depositAmount: 2000, state: 'california', moveOutDate: '2026-05-01', returnedAmount: 0 },
  'ai-lease-scanner': { jurisdiction: 'california', clauseCategory: 'deposit-fees', clauseText: 'Tenant agrees that the $2,000 security deposit is strictly non-refundable as a standard turnover cleaning fee upon lease termination.' },
};

const money = (n:number) => Math.round((n + Number.EPSILON) * 100) / 100;
const result = (headline:string, value:number, rows:CalculationRow[] = [], notes:string[] = [], status?:CalculationResult['status'], unit:Unit='money'):CalculationResult => ({ headline, value:money(value), unit, rows:rows.map(r=>({...r,unit:r.unit??'money',value:money(r.value)})), notes, ...(status?{status}:{}) });
const err = (message:string):CalculationResult => ({headline:'Unable to calculate', value:0, unit:'text', textValue:message, rows:[], notes:[], status:'alert', error:message});
function num(v:any,key:string,min=0,max=Number.MAX_SAFE_INTEGER):number { const n=typeof v[key]==='number'?v[key]:Number(v[key]); if(!Number.isFinite(n)||n<min||n>max) throw new Error(`${key} must be a finite number from ${min} to ${max}.`); return n; }
function date(v:any,key:string,optional=false):Date|null { if(optional && !v[key]) return null; const s=v[key]; if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${key} must be a valid YYYY-MM-DD date.`); const d=new Date(`${s}T00:00:00Z`); if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==s) throw new Error(`${key} must be a valid YYYY-MM-DD date.`); return d; }
const daysBetween=(a:Date,b:Date)=>Math.round((b.getTime()-a.getTime())/86400000);
const daysIn=(d:Date)=>new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
function mortgage(principal:number, annualPct:number, years:number) { const n=Math.round(years*12), r=annualPct/1200; const payment=r===0?principal/n:principal*r/(1-Math.pow(1+r,-n)); return {payment,n,r}; }
function compareRentBuy(v:any,c:Currency):CalculationResult {
 const rent=num(v,'rent'), price=num(v,'price',0.01), downPct=num(v,'downPayment',0,100), rate=num(v,'interest',0,100), loanY=num(v,'loanYears',1,50), opp=num(v,'investmentReturn',0,100), growth=num(v,'homeGrowth',-50,100), rentGrowth=num(v,'rentGrowth',-50,100), tax=num(v,'taxRate',0,30), ins=num(v,'insurance'), maint=num(v,'maintenancePct',0,30), buyFee=num(v,'buyClosingPct',0,100), fee=num(v,'sellClosingPct',0,100), years=num(v,'years',1,50);
 if(!Number.isInteger(years)) throw Error('Years of stay must be a whole number from 1 to 50.');
 const principal=price*(1-downPct/100), down=price*downPct/100, m=mortgage(principal,rate,loanY), horizon=Math.max(years,10);
 let rentCum=0,buyCum=down+price*buyFee/100,balance=principal;
 const points:Record<number,{rent:number,buy:number}>={};
 for(let mo=1;mo<=horizon*12;mo++){
   const elapsed=mo/12;
   const monthlyRent=rent*Math.pow(1+rentGrowth/100,(mo-1)/12);
   const home=price*Math.pow(1+growth/100,elapsed);
   rentCum+=monthlyRent;
   const interest=balance*m.r;
   const actualPayment=balance>0?Math.min(m.payment,balance+interest):0;
   balance=Math.max(0,balance-Math.max(0,actualPayment-interest));
   buyCum+=actualPayment+home*tax/1200+ins/12+home*maint/1200;
   const equity=home-balance-home*fee/100;
   const investmentGain=down*(Math.pow(1+opp/100,elapsed)-1);
   if(mo%12===0) points[mo/12]={rent:rentCum-investmentGain,buy:buyCum-equity};
 }
 let stable:number|null=null;
 for(let y=horizon;y>=1;y--){if(points[y].buy>points[y].rent)break;stable=y;}
 const rows:CalculationRow[]=[3,5,10].flatMap(y=>[{label:`Year ${y} net cost — renting`,value:points[y].rent,unit:'money' as Unit},{label:`Year ${y} net cost — buying`,value:points[y].buy,unit:'money' as Unit}]);
 rows.push({label:'Estimated monthly mortgage principal + interest',value:m.payment,unit:'money'},{label:`Your ${years}-year stay — renting net cost`,value:points[years].rent,unit:'money'},{label:`Your ${years}-year stay — buying net cost`,value:points[years].buy,unit:'money'});
 return {...result(stable?'Buying becomes cheaper from':`No lasting buy breakeven within ${horizon} years`,stable||0,rows,[`Model horizon: ${horizon} years. Breakeven means buying stays cheaper at every annual checkpoint from that year to this horizon; future results are not guaranteed.`,`Monthly amortization; rent and home value compound at your annual assumptions. Includes entered property tax, insurance, maintenance, buying costs and selling fees. Rent net cost subtracts the investment gain on the down payment only. Does not invest monthly cash-flow differences or buying costs, model tax relief, inflation-adjust costs to present value, or predict repairs. Negative net cost means modeled gains exceed outlays, not guaranteed profit.`, `Currency: ${c}. All growth and return rates are assumptions, not forecasts.`],stable?'good':'warn','number'),textValue:stable?`Year ${stable}`:'Not reached'};
}
export function calculateTool(slug:string,v:Record<string,any>,currency:'USD'|'GBP'):CalculationResult {
 try {
 switch(slug){
 case 'prorated-rent': {const rent=num(v,'monthlyRent'),a=date({...v,moveInDate:v.moveInDate??v.moveIn},'moveInDate')!,b=date({...v,moveOutDate:v.moveOutDate??v.moveOut},'moveOutDate',true); let mode=v.method??v.mode??'exact'; mode=mode==='thirty'?'30-day':mode==='annual'?'365-day':mode; if(!['exact','30-day','365-day'].includes(mode))throw Error('method must be exact, thirty, or annual.'); let total=0,occupied=0; const end=b||new Date(Date.UTC(a.getUTCFullYear(),a.getUTCMonth()+1,0)); if(end<a)throw Error('moveOut must be on or after moveIn.'); let cur=new Date(a); while(cur<=end){let last=new Date(Date.UTC(cur.getUTCFullYear(),cur.getUTCMonth()+1,0));let segEnd=last<end?last:end;let count=daysBetween(cur,segEnd)+1;const divisor=mode==='exact'?daysIn(cur):mode==='30-day'?30:365; total+=(mode==='365-day'?rent*12/365:rent/divisor)*count;occupied+=count;cur=new Date(Date.UTC(cur.getUTCFullYear(),cur.getUTCMonth()+1,1));} const div=mode==='exact'?daysIn(a):mode==='30-day'?30:365;return result('Prorated rent owed',total,[{label:'Daily rate (move-in month)',value:mode==='365-day'?rent*12/365:rent/div},{label:'Occupied days (inclusive)',value:occupied,unit:'number'},{label:'Days saved in move-in month',value:a.getUTCDate()-1,unit:'number'},{label:'Total unoccupied days in covered months',value:a.getUTCDate()-1+daysIn(end)-end.getUTCDate(),unit:'number'}],[mode==='365-day'?'365-day convention: monthly rent × 12 ÷ 365, allocated by occupied calendar day.':'Dates are counted inclusively; exact mode prorates each calendar month using its actual day count.']);}
 case 'rent-affordability': {const annual=v.incomeMode==='hourly'?num(v,'hourlyWage')*num(v,'hoursPerWeek',0,168)*52:num(v,'annualIncome');const debt=num(v,'debt');const monthly=annual/12, comfy=monthly*.25, max=monthly*.30, surplus=max-debt;return result('Rent at 30% of gross income',max,[{label:'Low comfortable rent (20% gross)',value:monthly*.20},{label:'Comfortable rent (25% gross)',value:comfy},{label:'Risk threshold (35% gross)',value:monthly*.35},{label:'30% gross guideline',value:max},{label:'3× monthly gross income',value:monthly/3},{label:'UK 40× annual income',value:annual/40},{label:'Monthly gross income',value:monthly},{label:'Monthly debt payments',value:debt},{label:'30% guideline after debt',value:Math.max(0,surplus)}],[`Income mode: ${v.incomeMode==='hourly'?'hourly wage × hours/week × 52':'annual gross income'}. Guidelines are screening rules, not a guarantee of affordability.`,...(debt>0?[debt>=max?`Your monthly debt payments are at or above the 30% figure, so that guideline leaves nothing for rent — treat the lower figures with caution.`:`After your monthly debt payments, the 30% guideline leaves ${currency==='GBP'?'£':'$'}${Math.round(surplus).toLocaleString('en-US')} a month for rent.`]:[])],debt>max?'warn':'good');}
 case 'roommate-rent-splitter': {const total=num(v,'totalRent'),rooms=v.rooms;if(!Array.isArray(rooms)||rooms.length<1||rooms.length>50)throw Error('rooms must contain 1–50 entries.');let raw=rooms.map((r:any,i:number)=>{const area=Number(r.area);if(!Number.isFinite(area)||area<=0)throw Error(`Room ${i+1} area must be positive.`);return {name:String(r.name||`Room ${i+1}`),weight:area*(1+(r.bath?.15:0)+(r.view?.05:0)+(r.parking?.10:0))};});const sum=raw.reduce((s:number,r:any)=>s+r.weight,0);let cents=Math.round(total*100),used=0;const alloc=raw.map((r:any,i:number)=>{const share=i===raw.length-1?cents-used:Math.floor(cents*r.weight/sum);used+=share;return {label:r.name,value:share/100,unit:'money' as Unit};});return result('Total allocated rent',total,[...alloc,...raw.map((r:any)=>({label:`${r.name} share`,value:r.weight/sum*100,unit:'percent' as Unit}))],['Base weight is room area; private bath +15%, view/balcony +5%, parking +10%. Percentages are relative weights, and final allocation reconciles to the rent to the cent.']);}
 case 'rent-vs-buy': return compareRentBuy(v,currency);
 case 'rent-increase': {const old=num(v,'currentRent'),next=num(v,'newRent');const notice=date(v,'noticeDate',true),effective=date(v,'renewalDate',true);const diff=next-old,pct=old?diff/old*100:0,j=String(v.jurisdiction||'').toLowerCase(),cpi=num(v,'cpi',0,100);const notes=['This is a calculator, not legal advice; notice periods and rent-control coverage depend on location, property and tenancy. No compliance determination is made.'];let status:CalculationResult['status']='good',days:number|undefined; if(notice&&effective&&effective<notice)throw Error('Increase effective date must not be before the notice date.'); if(notice&&effective)days=daysBetween(notice,effective);const ca=j.includes('california')||j==='ca',eng=j.includes('england')||j==='uk';if(old===0)throw Error('currentRent must be greater than zero to calculate an increase percentage.');if(ca){notes.push('California AB 1482 generally uses the lower of 5% + applicable CPI or 10% for covered units; illustrative only, not a legal determination. Coverage and notice rules vary. The CPI entered is illustrative, not fetched. Check [California Attorney General guidance](https://oag.ca.gov/tenants).');const cap=Math.min(10,5+cpi);if(pct>cap+1e-9)status='warn';if(notice&&effective){days=daysBetween(notice,effective);const required=pct>10+1e-9?90:30;if(days<required){notes.push(`Notice appears short: ${days} days supplied; ${required} days shown as an illustrative minimum.`);status='warn';}}}if(eng){notes.push('England only: from 1 May 2026, assured periodic rent increases generally require at least TWO CALENDAR MONTHS notice and can occur only once a year. Different tenancies and other UK nations have different rules. No compliance determination is made. Check [official England guidance](https://housinghub.campaign.gov.uk/private-renting-is-changing/).');if(notice&&effective){const due=new Date(notice);const day=due.getUTCDate();due.setUTCMonth(due.getUTCMonth()+2);if(due.getUTCDate()<day)due.setUTCDate(0);days=daysBetween(notice,effective);if(effective<due){notes.push(`Notice appears short: ${days} days supplied; effective date is earlier than two calendar months after notice.`);status='warn';}}}return result('Proposed rent increase',diff,[{label:'Increase percentage',value:pct,unit:'percent'},{label:'New monthly rent',value:next},...(days===undefined?[]:[{label:'Notice period (days)',value:days,unit:'number' as Unit}]),...(ca?[{label:'Illustrative AB 1482 cap (if covered)',value:Math.min(10,5+cpi),unit:'percent' as Unit}]:[])],notes,status);}
 case 'move-in-cash': {const rent=num(v,'rent'),dep=num(v,'depositMonths',0,24),moving=num(v,'moving'),fees=num(v,'fees'),utilities=num(v,'utilities');const rows=[{label:'First month rent',value:rent},{label:'Security deposit',value:rent*dep},{label:'Last month rent',value:v.lastMonth?rent:0},{label:'Moving costs',value:moving},{label:'Application/admin fees',value:fees},{label:'Utility connection deposits',value:utilities}];return result('Estimated move-in cash required',rows.reduce((s,r)=>s+r.value,0),rows,['Cash estimate includes refundable deposits, not just expenses. Enter only charges that apply to your agreement; deposit caps, permitted fees and advance-rent limits vary. England can prohibit some fees and advance-rent requests shown as optional inputs here. This calculator does not confirm that a charge is lawful.']);}
 case 'utility-splitter': {const days=num(v,'billingDays',1,366),people=v.people;if(!Array.isArray(people)||people.length<1||people.length>50)throw Error('people must contain 1–50 entries.');const fixed=num(v,'internet'),variable=num(v,'electric')+num(v,'gas')+num(v,'water');const elig=people.map((p:any,i:number)=>{const away=num(p,'away',0,days),paid=num(p,'paid');return {name:String(p.name||`Person ${i+1}`),pd:days-away,paid};});const pd=elig.reduce((s:number,p:any)=>s+p.pd,0);if(pd<=0)throw Error('At least one person-day is required.');let used=0;const due=elig.map((p:any,i:number)=>{let cents=i===elig.length-1?Math.round((fixed+variable)*100)-used:Math.round((fixed/people.length+variable*p.pd/pd)*100);used+=cents;return cents/100;});const rows=elig.map((p:any,i:number)=>({label:`${p.name} owes`,value:due[i],unit:'money' as Unit}));rows.push(...elig.map((p:any,i:number)=>({label:`${p.name} settlement (owed − paid)`,value:money(due[i]-p.paid),unit:'money' as Unit})));return result('Total shared utilities',fixed+variable,rows,['Internet is split equally regardless of absence; electric, gas and water are divided by person-days. Each settlement is that person\'s allocated share minus their prior payment: positive means still owed to the bill collector; negative means they overpaid and should be reimbursed by the other occupants. All shares reconcile to the bill after cent rounding.']);}
 case 'moving-cost-estimator': {const size=String(v.apartmentSize),capacity:any={'studio':'10ft','1':'15ft','2':'20ft','3':'26ft','1-bed':'15ft','2-bed':'20ft','3-bed+':'26ft'};if(!capacity[size])throw Error('apartmentSize must be studio, 1, 2, or 3.');const miles=num(v,'distance'),fuel=num(v,'fuelPrice'),mpg=num(v,'mpg',0.01),base=num(v,'baseCost'),labor=num(v,'labor');const truck=(v.service==='full'||v.service==='full-service')?'Full-service move':'DIY truck';const fuelCost=miles*2/mpg*fuel*(currency==='GBP'?4.54609:1),cost=base+fuelCost+labor;return result('Estimated moving budget',cost,[{label:'Recommended vehicle',value:0,unit:'text',textValue:capacity[size]},{label:'Estimated fuel (round trip)',value:fuelCost},{label:'Base/service cost',value:base},{label:'Labor estimate',value:labor},{label:'Service type',value:0,unit:'text',textValue:truck}],['Fuel estimate assumes round-trip distance at the entered loaded-move MPG; vehicle capacity and base price are rough planning assumptions, not live quotes.']);}
 case 'commute-vs-rent': {const a=num(v,'rentA'),b=num(v,'rentB'),da=num(v,'distanceA'),db=num(v,'distanceB'),ma=num(v,'minutesA'),mb=num(v,'minutesB'),wd=num(v,'workdays',0,31),mpg=num(v,'mpg',0.01),gas=num(v,'gasPrice'),ta=num(v,'transitA'),tb=num(v,'transitB');const ca=v.mode==='transit'?ta:da*2*wd/mpg*gas*(currency==='GBP'?4.54609:1),cb=v.mode==='transit'?tb:db*2*wd/mpg*gas*(currency==='GBP'?4.54609:1), cashA=a+ca,cashB=b+cb,hours=Math.abs(ma-mb)*2*wd*12/60;return result('Monthly cost difference (B − A)',cashB-cashA,[{label:'Apartment A monthly rent + commute',value:cashA},{label:'Apartment B monthly rent + commute',value:cashB},{label:'Annual hours lost: A',value:ma*2*wd*12/60,unit:'number'},{label:'Annual hours lost: B',value:mb*2*wd*12/60,unit:'number'},{label:'Annual time difference',value:hours,unit:'number'},{label:'Monthly cash savings from cheaper option',value:Math.abs(cashA-cashB)},{label:'Break-even value per additional commute hour',value:hours===0?0:Math.abs(cashA-cashB)*12/hours,...(hours===0?{unit:'text' as Unit,textValue:'Same commute time'}:cashA===cashB?{unit:'text' as Unit,textValue:'No cash savings'}:(cashB<cashA&&mb<=ma)||(cashA<cashB&&ma<=mb)?{unit:'text' as Unit,textValue:'Cheaper option is also faster'}:{})}],['Driving cost includes round-trip fuel only; USD uses US gallons and GBP uses imperial gallons converted to litres; transit mode uses entered monthly passes. Work year uses 12 × entered workdays/month. Break-even value of extra commute time is annual cash savings divided by annual additional hours; no wage input is required. If the cheaper option is faster, there is no time sacrifice.']);}
 case 'sublease-rate': {const rent=num(v,'rent'),start=date(v,'startDate')!,end=date(v,'endDate')!,premium=num(v,'premium',-100,500),util=num(v,'utilities');if(end<start)throw Error('endDate must be on or after startDate.');const days=daysBetween(start,end)+1,daily=rent*12/365*(1+premium/100)+(v.includeUtilities?util*12/365:0);return result('Suggested sublease total',daily*days,[{label:'Inclusive sublease days',value:days,unit:'number'},{label:'Suggested daily rate',value:daily},{label:'30-day equivalent total',value:daily*30},{label:'Monthly equivalent rate',value:(rent*12/365*(1+premium/100)+(v.includeUtilities?util*12/365:0))*365/12},{label:'Original monthly rent',value:rent}],['Uses 365-day annual convention for daily rent; furnished premium is user-entered and not a market valuation.',v.includeUtilities?'Utilities included at the entered monthly utility estimate.':'Utilities excluded.']);}
 case 'cap-rate-calculator': {const price=num(v,'price',0.01),rent=num(v,'rent'),tax=num(v,'taxes'),ins=num(v,'insurance'),maintPct=num(v,'maintenancePct',0,100),vac=num(v,'vacancy',0,100),other=num(v,'otherExpenses'),downPct=num(v,'downPayment',0,100),rate=num(v,'interest',0,100),years=num(v,'loanYears',1,50),closing=num(v,'closingCosts');const gross=rent*12,noi=gross*(1-vac/100)-tax-ins-price*maintPct/100-other,cap=noi/price*100,loan=price*(1-downPct/100),payment=mortgage(loan,rate,years).payment,annualCF=noi-payment*12,cashInvested=downPct*price/100+closing,coc=cashInvested?annualCF/cashInvested*100:0;return result('Capitalization rate',cap,[{label:'Annual net operating income (NOI)',value:noi},{label:'Cap rate',value:cap,unit:'percent'},{label:'Annual cash flow after debt service',value:annualCF},{label:'Cash-on-cash return',value:coc,unit:cashInvested?'percent':'text',...(cashInvested?{}:{textValue:'Not defined: no cash invested'})},{label:'Annual gross rent',value:gross},{label:'Annual debt service (P&I)',value:payment*12}],['Estimate: vacancy applied to gross rent; maintenance based on purchase price; excludes management, utilities and taxes not entered. Cap rate excludes financing; cash-on-cash uses down payment plus closing costs.'],noi<0?'alert':'good','percent');}
 case 'rent-per-sqft': {const rent=num(v,'rent'),area=num(v,'area',0.01),bench=num(v,'benchmark');const rate=rent/area;return result('Monthly rent per area unit',rate,[{label:`Monthly rate / ${currency==='GBP'?'sq m':'sq ft'}`,value:rate},{label:`Annual rate / ${currency==='GBP'?'sq m':'sq ft'}`,value:rate*12},...(bench>0?[{label:'Entered benchmark (monthly)',value:bench},{label:'Difference vs benchmark',value:rate-bench}]:[])],['Benchmark is user-provided; no market standard is assumed. Area units must match the benchmark (sq ft or sq m).']);}
 case 'couple-rent-splitter': {
  const rent=num(v,'rent',0.01), incA=num(v,'incomeA'), incB=num(v,'incomeB'), bills=num(v,'otherSharedExpenses');
  if(incA+incB<=0) throw Error('Enter at least one partner take-home pay.');
  const totalInc=incA+incB, sharePctA=(incA/totalInc)*100, sharePctB=(incB/totalInc)*100;
  const propRentA=rent*(incA/totalInc), propRentB=rent*(incB/totalInc), equalRent=rent/2;
  const equalCashA=Math.min(rent,Math.max(0,(rent+incA-incB)/2)), equalCashB=rent-equalCashA;
  const totalObligation=rent+bills, propTotalA=totalObligation*(incA/totalInc), propTotalB=totalObligation*(incB/totalInc);
  const rentToIncomePct=(rent/totalInc)*100;
  const roundedA=Math.round(sharePctA);
  return result(`Proportional split: Partner 1 pays ${roundedA}%, Partner 2 pays ${100-roundedA}%`,propRentA,[
    {label:'Partner 1 proportional rent',value:propRentA,unit:'money'},
    {label:'Partner 2 proportional rent',value:propRentB,unit:'money'},
    {label:'Partner 1 income share',value:sharePctA,unit:'percent'},
    {label:'Partner 2 income share',value:sharePctB,unit:'percent'},
    {label:'50/50 equal rent split (each)',value:equalRent,unit:'money'},
    {label:'Equal leftover cash: Partner 1 rent',value:equalCashA,unit:'money'},
    {label:'Equal leftover cash: Partner 2 rent',value:equalCashB,unit:'money'},
    ...(bills>0?[{label:'Partner 1 total (rent + shared expenses)',value:propTotalA,unit:'money' as Unit},{label:'Partner 2 total (rent + shared expenses)',value:propTotalB,unit:'money' as Unit}]:[]),
    {label:'Total combined monthly income',value:totalInc,unit:'money'},
    {label:'Household rent-to-income ratio',value:rentToIncomePct,unit:'percent'}
  ],[
    'Proportional split balances financial effort so both partners spend the exact same percentage of their take-home pay on housing.',
    'Equal leftover cash adjusts rent so each partner has the exact same discretionary spending money remaining after rent.',
    '50/50 equal split divides the lease in half, best when both partners have similar incomes.'
  ],rentToIncomePct>35?'warn':'good');
 }
 case 'security-deposit-refund': {
  const deposit=num(v,'depositAmount',0.01), state=String(v.state||'california').toLowerCase(), returned=num(v,'returnedAmount');
  if(!v.moveOutDate) throw Error('Enter your move-out date to work out the deadline.');
  const moveOut=date(v,'moveOutDate')!;
  if(returned>deposit) throw Error('The amount returned cannot be more than the deposit.');
  const rules:Record<string,{name:string;days:number;depositMultiple:number;withheldMultiple:number;fixed:number;citation:string;start:string;penalty:string}>={
    'california':{name:'California',days:21,depositMultiple:2,withheldMultiple:0,fixed:0,citation:'Cal. Civ. Code § 1950.5(g) and (l)',start:'after you move out',penalty:'In bad faith, a court may award up to twice the deposit in statutory damages, on top of the amount owed.'},
    'new-york':{name:'New York',days:14,depositMultiple:2,withheldMultiple:0,fixed:0,citation:'N.Y. Gen. Oblig. Law § 7-108(1-a)',start:'after you move out',penalty:'A landlord who misses the 14-day itemised statement loses the right to keep any of the deposit; a wilful violation can bring punitive damages of up to twice the deposit.'},
    'texas':{name:'Texas',days:30,depositMultiple:0,withheldMultiple:3,fixed:100,citation:'Tex. Prop. Code §§ 92.103 and 92.109',start:'after you move out and give a written forwarding address',penalty:'Bad-faith withholding makes the landlord liable for $100 plus three times the amount wrongfully withheld, plus reasonable attorney’s fees.'},
    'florida':{name:'Florida',days:15,depositMultiple:0,withheldMultiple:0,fixed:0,citation:'Fla. Stat. § 83.49(3)',start:'after you move out',penalty:'If the landlord does not return the deposit in 15 days or send written notice of a claim within 30 days, it loses the right to make a claim on the deposit.'},
    'england':{name:'England',days:10,depositMultiple:0,withheldMultiple:0,fixed:0,citation:'Housing Act 2004 ss.213–214; tenancy deposit scheme rules',start:'after you and the landlord agree how much you get back',penalty:'Deposit penalties in England apply when the deposit was not protected in a government-backed scheme within 30 days: a court can order 1 to 3 times the deposit. Disputes about deductions go to the scheme’s free resolution service.'},
    'general':{name:'General estimate',days:30,depositMultiple:0,withheldMultiple:0,fixed:0,citation:'State security-deposit statute',start:'after you move out (many states use 14–30 days)',penalty:'Penalties vary by state. Check your state’s security-deposit statute.'}
  };
  const rule=rules[state==='uk'?'england':state]||rules['general'];
  const deadline=new Date(moveOut.getTime()+rule.days*86400000);
  const deadlineText=rule.name==='England'?'10 days after you agree':new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(deadline);
  const unreturned=deposit-returned, penalty=deposit*rule.depositMultiple+unreturned*rule.withheldMultiple+(rule.withheldMultiple&&unreturned>0?rule.fixed:0);
  const rows:CalculationRow[]=[
    {label:'Return period',value:rule.days,unit:'text',textValue:`${rule.days} days ${rule.start}`},
    {label:'Deposit paid',value:deposit},
    {label:'Still not returned',value:unreturned},
  ];
  if(penalty>0&&unreturned>0) rows.push({label:'Maximum statutory penalty (bad faith)',value:penalty},{label:'Most you could claim (unreturned + penalty)',value:unreturned+penalty});
  return {...result(`Deposit due back by`,0,rows,[
    `${rule.name}: ${rule.citation}. ${rule.penalty}`,
    'Give your forwarding address in writing and keep dated move-out photos. Landlords can deduct for unpaid rent and damage beyond normal wear and tear, with an itemised statement.',
  ],unreturned>0?'warn':'good'),unit:'text',textValue:deadlineText};
 }
 case 'ai-lease-scanner': {
  const allowed=['california','new-york','texas','florida','england','scotland','general'];
  const j=(allowed.includes(String(v.jurisdiction))?String(v.jurisdiction):'general') as Jurisdiction;
  const text=String(v.clauseText||'').trim();
  if(!text) throw Error('Paste a lease clause, or pick one of the examples, to check it.');
  if(text.length>20000) throw Error('Paste up to 20,000 characters at a time.');
  const findings=checkLease(text,j);
  const alerts=findings.filter(f=>f.severity==='alert').length, warns=findings.filter(f=>f.severity==='warn').length;
  const status:CalculationResult['status']=alerts?'alert':warns?'warn':'good';
  const headline=findings.length?'Points to raise before signing':'Common red flags found';
  return {...result(headline,findings.length,[
    {label:'Rules checked for',value:0,unit:'text',textValue:JURISDICTION_NAMES[j]},
    {label:'Likely unlawful or void',value:alerts,unit:'number'},
    {label:'Worth negotiating',value:warns,unit:'number'},
    {label:'For information',value:findings.length-alerts-warns,unit:'number'},
  ],[findings.length?'Each point above shows the matching sentence and the rule it relates to. Send the amendment request before you sign.':'Nothing matched the common red flags this checker looks for. That does not mean the clause is lawful — it only checks a fixed list of well-known problem terms.','This is a pattern check, not legal advice. For a tenancy dispute, contact a tenant union, Citizens Advice / Shelter (UK), or a local legal aid office.'],status,'number'),textValue:findings.length?String(findings.length):'None',findings,letter:amendmentLetter(findings,j)};
 }
 default:return err(`Unknown calculator slug: ${slug}`);
 }
 } catch(e){return err(e instanceof Error?e.message:'Invalid calculator inputs.');}
}
