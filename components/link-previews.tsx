'use client';
import {useEffect,useState} from 'react';
import type {Doc} from '@/lib/types';
import type {LinkPreview} from '@/lib/link-preview';
import {noteLinks} from '@/lib/links';
const requests=new Map<string,Promise<LinkPreview|null>>();
function load(url:string){let request=requests.get(url);if(!request){request=fetch('/api/link-preview?url='+encodeURIComponent(url)).then(async response=>response.ok?await response.json() as LinkPreview:null).catch(()=>null);if(requests.size>=500)requests.delete(requests.keys().next().value!);requests.set(url,request);}return request;}
function Preview({url}:{url:string}){
  const [preview,setPreview]=useState<LinkPreview|null>(null),[broken,setBroken]=useState(false);
  useEffect(()=>{let active=true;void load(url).then(value=>{if(active)setPreview(value);});return()=>{active=false;};},[url]);
  const host=new URL(url).hostname.replace(/^www\./,'');
  return <a className="link-preview" href={url} target="_blank" rel="noopener noreferrer" onClick={event=>event.stopPropagation()}>{preview?.image&&!broken&&<img src={preview.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setBroken(true)}/>}<span className="link-preview-details"><strong>{preview?.title||host}</strong>{preview?.description&&<span className="link-preview-description">{preview.description}</span>}<span className="link-preview-site">{preview?.siteName||host}</span></span></a>;
}
export function LinkPreviews({text,doc}:{text:string;doc?:Doc}){const links=noteLinks(text,doc);return links.length?<div className="link-previews">{links.map(url=><Preview key={url} url={url}/>)}</div>:null;}
