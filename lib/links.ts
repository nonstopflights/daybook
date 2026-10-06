import type {Doc} from './types';
export function noteLinks(text:string,doc?:Doc):string[]{
  const candidates=[...(text.match(/https?:\/\/[^\s<>"']+/gi)||[])];
  function walk(node:unknown){if(!node||typeof node!=='object')return;const value=node as {marks?:{type:string;attrs?:{href?:string}}[];content?:unknown[]};for(const mark of value.marks||[])if(mark.type==='link'&&mark.attrs?.href)candidates.push(mark.attrs.href);value.content?.forEach(walk);}
  walk(doc);
  const links=new Set<string>();for(const candidate of candidates){try{const url=new URL(candidate.replace(/[.,;!?]+$/,''));if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)links.add(url.href);}catch{}}
  return [...links].slice(0,3);
}
