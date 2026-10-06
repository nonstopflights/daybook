import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePreview,publicAddress,pinnedLookup} from '../lib/link-preview';
import {noteLinks} from '../lib/links';
test('finds and deduplicates pasted links and editor link marks',()=>{
  assert.deepEqual(noteLinks('See https://example.com/item?variant=31. https://example.com/item?variant=31',{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Shop',marks:[{type:'link',attrs:{href:'https://shop.example/item'}}]}]}]}),['https://example.com/item?variant=31','https://shop.example/item']);
  assert.deepEqual(noteLinks('https://user:password@example.com'),[]);
});
test('reads social metadata regardless of attribute order and resolves images',()=>{
  const preview=parsePreview(`<title>Fallback</title><meta content='Pencil &amp; Pen' property='og:title'><meta name="description" content="A useful case"><meta property="og:image" content="/case.jpg"><meta property="og:site_name" content="Shop">`,'https://example.com/product');
  assert.deepEqual(preview,{url:'https://example.com/product',title:'Pencil & Pen',description:'A useful case',siteName:'Shop',image:'https://example.com/case.jpg'});
});
test('falls back to title and rejects non-web image URLs',()=>{
  assert.equal(parsePreview('<title>Page title</title><meta property="og:image" content="javascript:bad">','https://example.com').image,null);
  assert.equal(parsePreview('<title>Page title</title>','https://example.com').title,'Page title');
});
test('blocks loopback, private, link-local, and mapped IPs',()=>{
  for(const address of ['127.0.0.1','10.1.2.3','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1'])assert.equal(publicAddress(address),false,address);
  for(const address of ['8.8.8.8','2606:4700:4700::1111'])assert.equal(publicAddress(address),true,address);
});

test('upgrades site preview images to HTTPS for secure pages',()=>{
  assert.equal(parsePreview('<meta property="og:image" content="http://example.com/product.jpg">','https://example.com/product').image,'https://example.com/product.jpg');
});

test('pinned DNS lookup supports Node single and multiple address modes',()=>{
  const address={address:'8.8.8.8',family:4};
  pinnedLookup(address)('example.com',{all:true},(error,result)=>{assert.equal(error,null);assert.deepEqual(result,[address]);});
  pinnedLookup(address)('example.com',{all:false},(error,result,family)=>{assert.equal(error,null);assert.equal(result,address.address);assert.equal(family,4);});
});
