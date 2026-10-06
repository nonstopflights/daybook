import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {get as httpGet} from 'node:http';
import {get as httpsGet} from 'node:https';

export type LinkPreview = {url:string;title:string;description:string;siteName:string;image:string|null};
export function publicAddress(address:string):boolean {
  if(isIP(address)===6) return /^2[0-9a-f]{3}:/i.test(address)&&!/^2001:(?:0:|db8:|10:|20:)/i.test(address);
  if(isIP(address)!==4)return false;
  const [a,b]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));
}
const decode=(value:string)=>value.replace(/&(?:amp|quot|apos|lt|gt|#39|#x([0-9a-f]+)|#(\d+));/gi,(match,hex,decimal)=>hex||decimal?String.fromCodePoint(Math.min(parseInt(hex||decimal,hex?16:10),0x10ffff)):({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&#39;':"'"}[match.toLowerCase()]||match)).replace(/\s+/g,' ').trim();
export function parsePreview(html:string,url:string):LinkPreview {
  const meta=new Map<string,string>();
  for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){
    const attrs=new Map<string,string>();
    for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs.set(match[1].toLowerCase(),decode(match[2]??match[3]??match[4]));
    const key=attrs.get('property')||attrs.get('name');if(key&&attrs.get('content')&&!meta.has(key.toLowerCase()))meta.set(key.toLowerCase(),attrs.get('content')!);
  }
  const host=new URL(url).hostname.replace(/^www\./,'');
  let image:string|null=null;
  try{const value=meta.get('og:image')||meta.get('twitter:image');if(value){const resolved=new URL(value,url);if(['https:','http:'].includes(resolved.protocol)&&!resolved.username&&!resolved.password)image=resolved.href;}}catch{}
  return {url,title:(meta.get('og:title')||meta.get('twitter:title')||decode(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'')||host).slice(0,300),description:(meta.get('og:description')||meta.get('description')||meta.get('twitter:description')||'').slice(0,500),siteName:(meta.get('og:site_name')||host).slice(0,100),image};
}
async function readPage(url:URL,signal:AbortSignal):Promise<{html?:string;redirect?:string}> {
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port))throw new Error('Invalid URL');
  const addresses=await lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true});
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('Private address');
  const address=addresses[0];
  return new Promise((resolve,reject)=>{
    const request=(url.protocol==='https:'?httpsGet:httpGet)(url,{signal,headers:{'User-Agent':'Daybook-LinkPreview/1.0',Accept:'text/html'},lookup:(_hostname,_options,callback)=>callback(null,address.address,address.family)},response=>{
      if(response.statusCode&&response.statusCode>=300&&response.statusCode<400&&response.headers.location){response.resume();resolve({redirect:response.headers.location});return;}
      if(response.statusCode!==200||!response.headers['content-type']?.includes('text/html')){response.resume();reject(new Error('No HTML preview'));return;}
      const chunks:Buffer[]=[];let size=0;
      response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>1_000_000){response.destroy(new Error('Page too large'));return;}chunks.push(chunk);});
      response.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8')}));response.on('error',reject);
    });request.on('error',reject);
  });
}
const cache=new Map<string,{expires:number;value:LinkPreview}>();
export async function fetchPreview(raw:string):Promise<LinkPreview>{
  const original=new URL(raw);const key=original.href;const existing=cache.get(key);if(existing&&existing.expires>Date.now())return existing.value;
  const signal=AbortSignal.timeout(8000);let url=original;
  for(let hop=0;hop<4;hop++){const result=await readPage(url,signal);if(result.redirect){url=new URL(result.redirect,url);continue;}const value=parsePreview(result.html||'',url.href);value.url=key;if(cache.size>=500)cache.delete(cache.keys().next().value!);cache.set(key,{expires:Date.now()+3600000,value});return value;}
  throw new Error('Too many redirects');
}
