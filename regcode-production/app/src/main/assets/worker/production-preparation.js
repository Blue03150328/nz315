(function(root){'use strict';
 function defaults(today){const date=new Date(today.getFullYear(),today.getMonth(),today.getDate()),end=new Date(date);end.setFullYear(date.getFullYear()+2);if(end.getMonth()!==date.getMonth())end.setDate(0);const format=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');return {produceDate:format(date),expireDate:format(end)};}
 function label(p){return [p.trademark,p.name,p.content,p.dosage,p.spec_name,p.registration_no].filter(v=>v!=null&&String(v).trim()).join(' · ');}
 function lines(pools){return [...new Set((pools||[]).map(p=>p.line_name).filter(Boolean))];}
 // 全角、大小写与首尾空格归一；空格分隔的关键词可跨字段匹配。
 function matches(value,keyword){const normalize=v=>String(v==null?'':v).normalize('NFKC').toLowerCase();const text=normalize(value);return normalize(keyword).trim().split(/\s+/).every(word=>text.includes(word));}
 function productMatches(product,keyword){return matches(label(product),keyword);}
 root.WorkerPreparation={defaults,label,lines,matches,productMatches};
})(typeof window==='undefined'?globalThis:window);
