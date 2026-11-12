import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = file => readFile(path.join(root, file), 'utf8');
const exists = async file => { try { await access(path.join(root, file)); return true; } catch { return false; } };
const api = await read('worker/api.mjs');
const html = await read('web/index.html');
const javascript = await read('web/app.js');
const css = await read('web/styles.css');
const localBuild=process.argv.includes('--local');
const manifest = await exists('.openai/hosting.json')?JSON.parse(await read('.openai/hosting.json')):{d1:'DB'};
if (!manifest.project_id&&!localBuild) throw new Error('Use node build.mjs --local for a local build, or configure the existing Site identity before hosting.');
if (manifest.static) throw new Error('Guild Desk requires its server-backed Worker, not static hosting.');
if (manifest.d1 !== 'DB') throw new Error('Configure the DB database binding before building.');
const itemSource = await exists('worker/items.mjs') ? await read('worker/items.mjs') : '';
const auctionSource = await exists('worker/auctions.mjs') ? await read('worker/auctions.mjs') : '';
const auctionRuleSource = auctionSource ? await read('worker/auction-rules.mjs') : '';
const adminSource = await exists('worker/admin.mjs') ? await read('worker/admin.mjs') : '';
const catalogSource = await read('worker/catalog-import.mjs');
const inventorySource = await read('worker/inventory.mjs');
const spellNameSource = await read('worker/spell-names.mjs');
const raidLootImportSource = await read('worker/raid-loot-import.mjs');
const attendanceCloneSource = await read('worker/attendance-clones.mjs');
const reportsSource = await read('worker/reports.mjs');
const lootSource = await read('worker/loot.mjs');
const logParserSource = await read('worker/log-parser.mjs');
const capturesSource = await read('worker/captures.mjs');
const detailsSource=await read('worker/details.mjs');
const equipmentSource=await read('worker/equipment.mjs');
const accessSource=await read('worker/access.mjs');
const authorizationSource=await read('worker/authorization.mjs');
const auditLogSource=await read('worker/audit-log.mjs');
const optionsSource=await read('worker/member-options.mjs');
const deviceSource=await read('worker/companion-devices.mjs');
const stripExports = source => {
  if (/^\s*import\s/m.test(source)) throw new Error('Worker modules must remain self-contained for this dependency-free bundler.');
  return source.replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm, '');
};
const withoutRuleImport = auctionSource.replace(/^import\s+\{[^}]+\}\s+from\s+['"]\.\/auction-rules\.mjs['"];?\s*$/gm, '');
const modules = [
  `const handleApi=(()=>{\n${stripExports(api)}\nreturn handleApi;\n})();`,
  `const catalogHelpers=(()=>{\n${stripExports(catalogSource)}\nreturn {handleCatalogApi,getCatalogItem,hydrateCatalogItem,catalogReferenceStatement,searchCatalogItems,getCatalogStatus};\n})();`,
  `const spellNameHelpers=(()=>{\n${stripExports(spellNameSource)}\nreturn {enrichItem,enrichItems,handleSpellNamesApi};\n})();`,
  itemSource ? `const itemCacheHelpers=(()=>{\n${stripExports(itemSource)}\nreturn {createItemApi,cacheItemDetails,getCachedItemDetails,VERIFIED_ITEM_REFERENCES};\n})();\nconst rawItemApi=itemCacheHelpers.createItemApi({catalog:catalogHelpers,fileOnly:true});\nconst handleItemApi=async(request,env,context)=>{const response=await rawItemApi(request,env,context);if(!response?.ok)return response;const data=await response.json(),options={cacheKey:env.SPELL_CACHE_KEY||env.DB};if(data.item)data.item=await spellNameHelpers.enrichItem(env.DB,data.item,options);if(Array.isArray(data.items))data.items=await spellNameHelpers.enrichItems(env.DB,data.items,options);return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});};` : '',
  auctionSource ? `const auctionRuleHelpers=(()=>{\n${stripExports(auctionRuleSource)}\nreturn {proposeAuction,AuctionRuleError};\n})();\nconst handleAuctionApi=(()=>{\nconst {proposeAuction,AuctionRuleError}=auctionRuleHelpers;\n${stripExports(withoutRuleImport)}\nreturn handleAuctionApi;\n})();` : '',
  adminSource ? `const handleAdminApi=(()=>{\n${stripExports(adminSource)}\nreturn handleAdminApi;\n})();` : '',
  `const handleReportsApi=(()=>{\n${stripExports(reportsSource)}\nreturn handleReportsApi;\n})();`,
  `const attendanceCloneHelpers=(()=>{\n${stripExports(attendanceCloneSource)}\nreturn {handleAttendanceCloneApi,decorateAttendanceTicks};\n})();`,
  `const chatParserHelpers=(()=>{\n${stripExports(logParserSource)}\nreturn {parseLootChannelLine,parseChatLootSources};\n})();`,
  `const handleLootApi=(()=>{\n${stripExports(lootSource)}\nreturn createLootApi({...chatParserHelpers,catalog:catalogHelpers,fileOnly:true,cacheItemDetails:itemCacheHelpers.cacheItemDetails});\n})();`,
  `const handleRaidLootImportApi=(()=>{\n${stripExports(raidLootImportSource)}\nreturn createRaidLootImportApi({handleLootApi});\n})();`,
  `const handleCaptureApi=(()=>{\n${stripExports(capturesSource)}\nreturn createCaptureApi({parseLootChannelLine:chatParserHelpers.parseLootChannelLine,handleLootApi});\n})();`,
  `const handleDetailsApi=(()=>{\n${stripExports(detailsSource)}\nreturn handleDetailsApi;\n})();`,
  `const inventoryHelpers=(()=>{\n${stripExports(inventorySource)}\nreturn {createInventoryApi,getInventoryAugments};\n})();\nconst handleInventoryApi=inventoryHelpers.createInventoryApi({catalog:catalogHelpers});`,
  `const handleEquipmentApi=(()=>{\n${stripExports(equipmentSource)}\nreturn createEquipmentApi({catalog:catalogHelpers,loadInventoryAugments:(db,id)=>inventoryHelpers.getInventoryAugments(db,id,{withOperations:true})});\n})();`,
  `const accessHelpers=(()=>{\n${stripExports(accessSource)}\nreturn {resolveAccess,handleAccessApi};\n})();`,
  `const authorizationHelpers=(()=>{\n${stripExports(authorizationSource)}\nreturn {authorizeRoute,guardedDatabase};\n})();`,
  `const handleAuditLogApi=(()=>{\n${stripExports(auditLogSource)}\nreturn handleAuditLogApi;\n})();`,
  `const handleMemberOptions=(()=>{\n${stripExports(optionsSource)}\nreturn handleMemberOptions;\n})();`,
  `const handleCompanionDeviceApi=(()=>{\n${stripExports(deviceSource)}\nreturn createCompanionDeviceApi({handleCaptureApi});\n})();`
].filter(Boolean).join('\n');
const bundled = `// Guild Desk v0.7.0 - generated by build.mjs. Edit source files instead.\n${modules}\nconst GUILD_DESK_HTML=${JSON.stringify(html)};\nconst GUILD_DESK_JS=${JSON.stringify(javascript)};\nconst GUILD_DESK_CSS=${JSON.stringify(css)};\n
function staticResponse(body, type) {
  return new Response(body, { headers: {
    'Content-Type': type + '; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
  }});
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    env = {...env, FEATURE_AUCTIONS:${!!auctionSource}, FEATURE_ADMIN:${!!adminSource}, FEATURE_OWNERSHIP:true, FEATURE_ACCESS:true};
    try {
      if (url.pathname === '/api/health') return Response.json({service:'guild-desk',version:'0.7.0',database:!!env.DB,storage:env.LOCAL_STORAGE?.persistent?'persistent_sqlite':env.LOCAL_STORAGE?'temporary':'hosted_binding'},{headers:{'Cache-Control':'no-store'}});
      if (url.pathname.startsWith('/api/companion/')) return await handleCaptureApi(request,env,{});
      if (url.pathname.startsWith('/api/companion-device/')) return await handleCompanionDeviceApi(request,env,{});
      if (['/api/me','/api/register','/api/login','/api/logout'].includes(url.pathname)) {
        const response=await handleApi(request,env);
        if(response.ok&&url.pathname!=='/api/logout'){
          const data=await response.json();
          if(data.user)data.access=await accessHelpers.resolveAccess(env.DB,data.user);
          return new Response(JSON.stringify(data),{status:response.status,headers:response.headers});
        }
        return response;
      }
      if (url.pathname.startsWith('/api/')) {
      // This is a new bodyless identity lookup. Forward only its cookie, not
      // the caller's upload size/type or other entity headers.
      const identityHeaders=new Headers();
      if(request.headers.has('cookie'))identityHeaders.set('cookie',request.headers.get('cookie'));
      const me=await handleApi(new Request(new URL('/api/me',url),{headers:identityHeaders}),env);
      if(!me.ok)return me;
      const identity=await me.json();
      if(!identity.user)return Response.json({error:'Sign in to use Guild Desk.',code:'unauthorized'},{status:401,headers:{'Cache-Control':'no-store'}});
      const access=await accessHelpers.resolveAccess(env.DB,identity.user);
      const policy=await authorizationHelpers.authorizeRoute(request,env.DB,{...identity,access});
      const scopedDB=authorizationHelpers.guardedDatabase(env.DB,identity.user.id,policy.grants);
      const accessRoute=url.pathname==='/api/access'||url.pathname.startsWith('/api/access/');
      // Access edits guard their own transactions and may intentionally revoke
      // the caller's rights. Their post-commit response must remain readable.
      const scopedEnv={...env,DB:accessRoute?env.DB:scopedDB,SPELL_CACHE_KEY:env.DB},auth={...identity,access,user:{...identity.user,role:policy.legacyRole}};
      let response;
      if(new RegExp('^/api/characters/[^/]+/equipment/references$').test(url.pathname)){
        const catalog=new URL(request.url);catalog.pathname='/api/items';
        response=await handleItemApi(new Request(catalog,request),scopedEnv,auth);
      } else {
      const featureHandler = url.pathname==='/api/access'||url.pathname.startsWith('/api/access/') ? accessHelpers.handleAccessApi :
        (url.pathname==='/api/catalog/spell-names'||url.pathname==='/api/catalog/spell-names/refresh') ? spellNameHelpers.handleSpellNamesApi :
        (url.pathname==='/api/loot-imports'||url.pathname.startsWith('/api/loot-imports/')) ? handleRaidLootImportApi :
        new RegExp('^/api/raids/[^/]+/ticks/[^/]+/clone(?:/preview)?$').test(url.pathname) ? attendanceCloneHelpers.handleAttendanceCloneApi :
        (url.pathname==='/api/catalog'||url.pathname.startsWith('/api/catalog/')) ? catalogHelpers.handleCatalogApi :
        new RegExp('^/api/characters/[^/]+/inventory/(?:preview|import)$').test(url.pathname) ? handleInventoryApi :
        url.pathname==='/api/audit' ? handleAuditLogApi :
        (url.pathname==='/api/companion-devices'||url.pathname.startsWith('/api/companion-devices/')) ? handleCompanionDeviceApi :
        ['/api/raid-options','/api/attendance-requests/options','/api/ledger/characters'].includes(url.pathname) ? handleMemberOptions :
        new RegExp('^/api/characters/[^/]+/equipment(?:/[^/]+)?$').test(url.pathname) ? handleEquipmentApi :
        (new RegExp('^/api/raids/[^/]+/ticks/[^/]+$').test(url.pathname)||new RegExp('^/api/reports/mains/[^/]+/loot$').test(url.pathname)) ? handleDetailsApi :
        ${itemSource ? `(url.pathname === '/api/items' || url.pathname.startsWith('/api/items/')) ? handleItemApi :` : ''}
        ${auctionSource ? `(url.pathname === '/api/auctions' || url.pathname.startsWith('/api/auctions/')) ? handleAuctionApi :` : ''}
        ${adminSource ? `['/api/settings','/api/adjustments','/api/attendance-requests'].some(p=>url.pathname===p||url.pathname.startsWith(p+'/')) ? handleAdminApi :` : ''}
        (url.pathname==='/api/reports'||url.pathname.startsWith('/api/reports/')) ? handleReportsApi :
        (url.pathname==='/api/loot'||url.pathname.startsWith('/api/loot/')) ? handleLootApi :
        (url.pathname==='/api/captures'||url.pathname.startsWith('/api/captures/')) ? handleCaptureApi : null;
      if (featureHandler) {
        response=await featureHandler(request,scopedEnv,auth);
      } else response=await handleApi(request,scopedEnv,{userId:identity.user.id,role:policy.legacyRole});
      }
      if(request.method==='GET'&&response?.ok&&new RegExp('^/api/raids/[^/]+(?:/ticks/[^/]+)?$').test(url.pathname)){
        const data=await response.json();
        if(Array.isArray(data.ticks))data.ticks=await attendanceCloneHelpers.decorateAttendanceTicks(scopedDB,data.ticks);
        if(data.tick)data.tick=(await attendanceCloneHelpers.decorateAttendanceTicks(scopedDB,[data.tick]))[0];
        response=new Response(JSON.stringify(data),{status:response.status,headers:response.headers});
      }
      if(scopedDB.authorityDenied)return Response.json({error:'Your access changed. Refresh before retrying.',code:'forbidden'},{status:403,headers:{'Cache-Control':'no-store'}});
      return response||Response.json({error:'Not found.',code:'not_found'},{status:404});
      }
      if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405});
      if (url.pathname === '/app.js') return staticResponse(request.method==='HEAD'?'':GUILD_DESK_JS,'text/javascript');
      if (url.pathname === '/app.css') return staticResponse(request.method==='HEAD'?'':GUILD_DESK_CSS,'text/css');
      if (url.pathname === '/' || url.pathname === '/index.html') return staticResponse(request.method==='HEAD'?'':GUILD_DESK_HTML,'text/html');
      return new Response('Not found',{status:404});
    } catch (error) {
      if(error?.status===403)return Response.json({error:error.message,code:'forbidden'},{status:403,headers:{'Cache-Control':'no-store'}});
      console.error('Guild Desk request failed:',error?.name||'Error');
      return Response.json({error:'The request could not be completed. Please try again.',code:'server_error'},{status:500,headers:{'Cache-Control':'no-store'}});
    }
  }
};
`;
await mkdir(path.join(root, 'dist/server'), { recursive: true });
await writeFile(path.join(root, 'dist/server/index.js'), bundled, 'utf8');
if(manifest.project_id){await mkdir(path.join(root,'dist/.openai'),{recursive:true});await writeFile(path.join(root,'dist/.openai/hosting.json'),JSON.stringify(manifest,null,2)+'\n','utf8');}
console.log('Built Guild Desk Worker with real accounts, attendance APIs, and bundled interface.');
