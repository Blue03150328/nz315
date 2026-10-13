(function(root){'use strict';
 function defaults(today){const date=new Date(today.getFullYear(),today.getMonth(),today.getDate()),end=new Date(date);end.setFullYear(date.getFullYear()+2);if(end.getMonth()!==date.getMonth())end.setDate(0);const format=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');return {produceDate:format(date),expireDate:format(end)};}
 function label(p){return [p.trademark,p.name,p.content,p.dosage,p.spec_name,p.registration_no].filter(v=>v!=null&&String(v).trim()).join(' · ');}
 function lines(pools){return [...new Set((pools||[]).map(p=>p.line_name).filter(Boolean))];}
 root.WorkerPreparation={defaults,label,lines};
})(typeof window==='undefined'?globalThis:window);
