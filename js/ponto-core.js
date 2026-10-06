/* Motor independente de interface. Horas locais America/Sao_Paulo; sem conversão UTC. */
(function(root){
 'use strict';
 const minutes=s=>{if(!/^\d{2,3}:\d{2}$/.test(s)||Number(s.split(':')[1])>59)throw Error('Use HH:MM.');const [h,m]=s.split(':').map(Number);return h*60+m;};
 const hm=n=>`${n<0?'−':''}${String(Math.floor(Math.abs(n)/60)).padStart(2,'0')}:${String(Math.abs(n)%60).padStart(2,'0')}`;
 function decode(buffer){const b=new Uint8Array(buffer);return new TextDecoder(b[0]===255&&b[1]===254?'utf-16le':b[0]===254&&b[1]===255?'utf-16be':'utf-8',{fatal:true}).decode(b).replace(/^\uFEFF/,'');}
 function parse(text){
 const device=text.match(/^#\s*DeviceUID\s*=\s*(.+)$/m)?.[1].trim();
 if(!device)throw Error('Arquivo sem DeviceUID. Use a exportação AttendLog do relógio.');
 const rows=[];const errors=[];
 text.split(/\r?\n/).forEach((line,i)=>{if(!/^\d+\t/.test(line))return;const c=line.split('\t');const match=c[10]?.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
 if(c.length<12||!match||!c[2]){errors.push(i+1);return;}
 const date=new Date(match[1]+'T12:00:00Z');
 if(isNaN(date)||date.toISOString().slice(0,10)!==match[1]||match[2].slice(0,2)>'23'||match[2].slice(3,5)>'59'||match[2].slice(6)>'59'){errors.push(i+1);return;}
 rows.push({numero:c[0],codigo:c[2],nome:c[3],tipo:c[7]+' / '+c[11],instante:match[1]+'T'+match[2],linha:line});});
 if(errors.length)throw Error('Linhas inválidas: '+errors.slice(0,15).join(', ')+'. Nenhuma batida foi importada.');
 const declared=text.match(/LogCount\s*=\s*(\d+)/)?.[1];
 if(!rows.length||declared&&Number(declared)!==rows.length)throw Error('Quantidade de registros diverge do cabeçalho. Confira a exportação.');
 return {device,rows,people:[...new Set(rows.map(x=>x.codigo))],start:rows.map(x=>x.instante.slice(0,10)).sort()[0],end:rows.map(x=>x.instante.slice(0,10)).sort().at(-1)};
 }
 const standard={weekday:['09:00','12:00','13:00','18:00'],saturday:['09:00','13:00'],late:5,extra:10,early:0,interval:'flexivel',threshold:'integral',extraPercent:60};
 function schedule(loja){return [1,4,5,6].includes(Number(loja))?JSON.parse(JSON.stringify(standard)):null;}
 function weekday(date){return new Date(date+'T12:00:00Z').getUTCDay();}
 function dates(start,end){const a=[];if(start>end)throw Error('Período invertido.');for(let d=new Date(start+'T12:00:00Z');d<=new Date(end+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1)){a.push(d.toISOString().slice(0,10));if(a.length>366)throw Error('Selecione até 366 dias.');}return a;}
 function evaluate(date,times,rule,kind='NORMAL'){
 const w=weekday(date);const expected=w===0?[]:(w===6?rule?.saturday:rule?.weekday)||[];
 if(!rule&&w!==0&&kind==='NORMAL')return {status:'SEM_JORNADA',worked:null,expected:0,delta:null,parts:[]};
 const target=expected.length===4?minutes(expected[1])-minutes(expected[0])+minutes(expected[3])-minutes(expected[2]):expected.length===2?minutes(expected[1])-minutes(expected[0]):0;
 if(['FERIADO','FOLGA','ABONO','FERIAS','AFASTAMENTO'].includes(kind)||w===0){return {status:times.length?'CONFERIR_DESCANSO':kind==='NORMAL'?'DOMINGO':kind,worked:times.length?null:0,expected:0,delta:times.length?null:0,parts:[]};}
 if(kind==='COMPENSACAO_PARCIAL'){
  if(!target)return {status:'SEM_JORNADA',worked:null,expected:target,delta:null,parts:[]};
  if(![2,4].includes(times.length))return {status:'INCOMPLETO',worked:null,expected:target,delta:null,parts:[]};
  const t=times.map(minutes);
  if(t.some((x,i)=>i&&x<=t[i-1]))return {status:'ORDEM_INVALIDA',worked:null,expected:target,delta:null,parts:[]};
  let worked=0;for(let i=0;i<t.length;i+=2)worked+=t[i+1]-t[i];
  if(worked>=target)return {status:'CONFERIR_COMPENSACAO',worked,expected:target,delta:null,parts:[]};
  return {status:'COMPENSACAO_PARCIAL',worked,expected:target,delta:worked-target,parts:[{label:'Compensação parcial (trabalho real menos jornada)',value:worked-target}]};
 }
 if(kind==='COMPENSACAO'){return {status:times.length?'CONFERIR_COMPENSACAO':!target?'SEM_JORNADA':'COMPENSACAO',worked:0,expected:target,delta:times.length||!target?null:-target,parts:[{label:'Compensação',value:-target}]};}
 if(times.length!==expected.length||![2,4].includes(times.length))return {status:times.length?'INCOMPLETO':'SEM_BATIDAS',worked:null,expected:target,delta:null,parts:[]};
 const t=times.map(minutes);if(t.some((x,i)=>i&&x<=t[i-1]))return {status:'ORDEM_INVALIDA',worked:null,expected:target,delta:null,parts:[]};
 let worked=0;for(let i=0;i<t.length;i+=2)worked+=t[i+1]-t[i];
 const e=expected.map(minutes);const parts=[];
 const add=(label,value,tolerance)=>{const v=Math.abs(value)<=tolerance?0:rule.threshold==='excedente'?Math.sign(value)*(Math.abs(value)-tolerance):value;parts.push({label,value:v,bruto:value,tolerance});};
 add('Entrada',e[0]-t[0],t[0]>e[0]?rule.late:rule.extra);
 if(t.length===4){
 if(rule.interval==='flexivel'){const delta=(e[2]-e[1])-(t[2]-t[1]);add('Intervalo',delta,delta<0?rule.late:rule.extra);}
 else{const d1=t[1]-e[1];add('Saída almoço',d1,d1<0?rule.early:rule.extra);const d2=e[2]-t[2];add('Retorno almoço',d2,d2<0?rule.late:rule.extra);}
 }
 const last=t.length-1;add('Saída',t[last]-e[last],t[last]<e[last]?rule.early:rule.extra);
 return {status:'OK',worked,expected:target,delta:parts.reduce((s,p)=>s+p.value,0),parts};
 }
 function latest(events,type,date,user){return events.filter(e=>e.tipo===type&&e.data_referencia<=date&&(user===undefined||String(e.usuario_id)===String(user))).sort((a,b)=>a.data_referencia.localeCompare(b.data_referencia)||a.criado_em.localeCompare(b.criado_em)||a.id.localeCompare(b.id)).at(-1);}
 function balance(events,date){return events.filter(e=>['BANCO','PAGAMENTO','ESTORNO'].includes(e.tipo)&&e.data_referencia<=date).reduce((s,e)=>s+e.minutos,0);}
 const api={minutes,hm,decode,parse,standard,schedule,weekday,dates,evaluate,latest,balance};root.PONTO_CORE=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
