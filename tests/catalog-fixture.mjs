// Small artificial upload for integration tests, never the downloaded game dump.
const columns=['itemclass','id','name','classes','races','slots','ac','hp','mana','endurance','focuseffect','focusname','worneffect','wornname','clickeffect','clickname'];
export const TEST_CATALOG_TEXT=[columns.join('|'),
 [0,81773,'Blood of the Dhampyre',65535,65535,2048,185,2006,2006,2006,1,'Fixture Focus',2,'Fixture Dodge',3,'Prismatic Ward VIII'],
 [0,44354,'Ancient Pearlescent Mask',65535,65535,8,5,800,0,0,-1,'',1,'Serpent Sight',-1,''],
 [0,1608,"Froglok Bonecaster's Robe",65535,65535,131072,10,100,100,0,-1,'',-1,'',-1,'']
 ].map(row=>Array.isArray(row)?row.join('|'):row).join('\n')+'\n';
export async function uploadTestCatalog(worker,DB,origin,auth){
 const form=new FormData();form.append('file',new File([TEST_CATALOG_TEXT],'synthetic-items.txt'));form.append('expectedRevision','0');
 const response=await worker.fetch(new Request(origin+'/api/catalog/import',{method:'POST',headers:{Origin:origin,Cookie:auth.cookie,'X-CSRF-Token':auth.csrfToken??auth.csrf},body:form}),{DB},{});
 const result=await response.json();if(response.status!==200)throw new Error('Synthetic catalog upload failed: '+JSON.stringify(result));return result;
}
