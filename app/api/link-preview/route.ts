import {NextRequest} from 'next/server';
import {authorize,errorResponse} from '@/lib/auth';
import {fetchPreview} from '@/lib/link-preview';
export const runtime='nodejs';
export async function GET(req:NextRequest){
  try{authorize(req);}catch(error){return errorResponse(error);}
  const url=req.nextUrl.searchParams.get('url');
  if(!url||url.length>4096)return Response.json({error:'Invalid link'},{status:400});
  try{return Response.json(await fetchPreview(url));}catch{return Response.json({error:'Preview unavailable'},{status:422});}
}
