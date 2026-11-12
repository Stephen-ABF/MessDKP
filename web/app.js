const state = { user: null, csrfToken: '', sessionEpoch: 0, authPending: false, authMode: 'login', page: 'dashboard', raidId: null, auctionId: null, currentAuction: null, generation: 0, characters: [], raids: [], importPayload: null, items: [], itemFilters: { q: '', class: '', slot: '' }, selectedItemId: null, auctionFilters: { q: '', class: '', status: 'open' }, auctionDraftItemId: null, adjustmentCharacters: [], adjustmentCharacterId: null, mainReportId: null, reportAsOf: localCalendarDate(), reportClass: '', lootDraftId: null, lootTab: 'drafts', raidLootImportId: null, raidLootImport: null, raidLootPreview: null, raidLootEventPage: 0, captureId: null, tickId: null, characterTab: 'registry', profileId: null, access: null, accessData: null, preferredAttendanceRaid: null, auditFilters: {actorId:'',subjectUserId:'',characterId:'',action:'',q:'',from:'',to:'',limit:50,offset:0}, equipment: null, equipmentLoot: [], gearPicker: null, companionDevices: [], catalogStatus: null, spellNamesStatus: null, spellNamesOpen: false, profileTab: 'overview', inventoryCharacterId: null, inventoryPreview: null, inventoryResult: null, captureStatus: null };
let countdownTimer = null, companionPairingTimer = null, companionPollTimer = null;
const itemDetailsCache = new Map();
const attendanceClonePreviews = new Map();
let itemSurfaceVersion = 0, itemDialogVersion = 0, itemPreviewTimer = null, itemPreviewAnchor = null;
function localCalendarDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const $ = (selector, root = document) => root.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = value => Number(value || 0).toLocaleString('en-US');
const pageArea = page => ({dashboard:'overview',profile:'characters'})[page] || page;
const can = (area, level = 'read') => Boolean(state.user && Number(state.access?.permissions?.[area] || 0) >= ({view:1,read:2,write:3}[level] || Number(level) || 2));
const canReadPage = page => can(pageArea(page),'read') || page==='auctions'&&can('auctionAdmin','read') || page==='corrections'&&can('correctionReview','read');
const canViewPage = page => can(pageArea(page),'view') || page==='auctions'&&can('auctionAdmin','view') || page==='corrections'&&can('correctionReview','view');
const canEditEquipment = data => Boolean(data?.canEdit && data.character.ownerId===state.user?.id && ['main','alt'].includes(data.character.kind) && (can('overview','write')||can('mains','write')));
const officerAreas = ['attendance','ledger','items','captures','loot','claims','settings','audit','access'];
const mutationAreas = {'create-character':'characters','detach-character':'claims','approve-claim':'claims','create-raid':'attendance','preview-attendance-clone':'attendance','commit-attendance-clone':'attendance','preview-import':'attendance','adjust-dkp':'ledger','decide-attendance':'correctionReview','save-settings':'settings','create-auction':'auctionAdmin','place-bid':'auctions','preview-raid-loot':'loot','commit-raid-loot':'loot','exclude-raid-loot':'loot','prepare-raid-loot':'loot','refresh-spell-names':'items','discard-catalog':'items','import-catalog':'items','lookup-item':'items','connect-device':'captures','activate-device':'captures','revoke-device':'captures','create-capture':'captures','reconnect-capture':'captures','exclude-capture-event':'captures','prepare-capture':'captures','revoke-capture':'captures','create-loot':'loot','resolve-loot-candidate':'loot','request-attendance':'corrections','import-loot':'loot','match-loot':'loot','edit-loot-row':'loot','resolve-loot':'loot','publish-loot':'loot','save-access-profile':'access','create-access-profile':'access','save-access-user':'access'};
const actionAreas = {'claim':'characters','commit-import':'attendance','confirm-award':'auctionAdmin','withdraw-bid':'auctions','add-preset':'settings','remove-preset':'settings'};
function applyAccessControls(root = document) {
  root.querySelectorAll('[data-form]').forEach(form => {const area=mutationAreas[form.dataset.form];if(area&&!can(area,'write')) form.querySelectorAll('button,input,select,textarea').forEach(control=>{control.disabled=true;});});
  root.querySelectorAll('[data-action]').forEach(button=>{const area=actionAreas[button.dataset.action];if(area&&!can(area,'write'))button.hidden=true;});
  root.querySelectorAll('.notice:not(.error):not(.warning)').forEach(element=>{if(!element.querySelector('button,input,select,textarea,[data-action]'))element.remove();else {element.classList.remove('notice');element.classList.add('reference-block');}});
}
const date = value => {
  if (!value) return '-';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[2]}/${match[3]}/${match[1]}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' });
};
const sourceTime = value => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  return match ? `${match[2]}/${match[3]}/${match[1]} ${match[4]}:${match[5]}:${match[6]}` : String(value || '-');
};
const amount = value => `<span class="numeric ${Number(value) < 0 ? 'negative' : Number(value) > 0 ? 'positive' : ''}">${Number(value) > 0 ? '+' : ''}${escape(number(value))}</span>`;
const empty = (heading, description, action = '') => `<div class="empty"><h2>${escape(heading)}</h2><p>${escape(description)}</p>${action ? `<div class="actions">${action}</div>` : ''}</div>`;
const table = (headings, rows, compact = false) => `<div class="table-wrap${compact ? ' compact' : ''}"><table><thead><tr>${headings.map(item => `<th scope="col">${escape(item)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

async function api(path, { method = 'GET', body } = {}) {
  const requestSession = { id: state.user?.id ?? null, token: state.csrfToken, epoch: state.sessionEpoch };
  const sameSession = () => requestSession.id === (state.user?.id ?? null) && requestSession.token === state.csrfToken && requestSession.epoch === state.sessionEpoch;
  const staleError = () => Object.assign(new Error('The session changed while this request was running.'), { code: 'stale_session', silent: true });
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (state.csrfToken) headers['X-CSRF-Token'] = state.csrfToken;
  }
  let response;
  try { response = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { if (!sameSession()) throw staleError(); throw new Error('Guild Desk could not be reached. Check your connection and try again.'); }
  let data;
  try { data = await response.json(); }
  catch { if (!sameSession()) throw staleError(); throw new Error('The server returned an unexpected response. Please try again.'); }
  if (!sameSession()) throw staleError();
  if (!response.ok) {
    if (response.status === 401 && state.user) {
      setSession(null); renderShell(); renderAuth(); flash('Your session expired. Sign in again.', true);
    }
    const error = new Error(data.error || 'The request could not be completed.');
    error.status = response.status; error.code = data.code; throw error;
  }
  return data;
}
function apiMultipart(path,body,onProgress) {
  const session={id:state.user?.id ?? null,token:state.csrfToken,epoch:state.sessionEpoch};
  const current=()=>session.id===(state.user?.id ?? null)&&session.token===state.csrfToken&&session.epoch===state.sessionEpoch;
  const stale=()=>Object.assign(new Error('The session changed while the upload was running.'),{code:'stale_session',silent:true});
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('POST',`/api${path}`);xhr.withCredentials=true;xhr.setRequestHeader('Accept','application/json');if(session.token)xhr.setRequestHeader('X-CSRF-Token',session.token);
    xhr.upload.onprogress=event=>{if(current())onProgress?.({loaded:event.loaded,total:event.lengthComputable?event.total:null});};
    xhr.onerror=()=>reject(current()?new Error('Upload connection lost. Check catalog status before retrying.'):stale());
    xhr.onabort=()=>reject(current()?new Error('Upload stopped. Check catalog status before retrying.'):stale());
    xhr.onload=()=>{
      if(!current()){reject(stale());return;}
      let data;try{data=JSON.parse(xhr.responseText);}catch{reject(new Error('The server returned an unexpected upload response. Check catalog status before retrying.'));return;}
      if(xhr.status<200||xhr.status>=300){
        if(xhr.status===401&&state.user){setSession(null);renderShell();renderAuth();flash('Your session expired. Sign in again.',true);}
        const error=new Error(`${data.error || 'The catalog upload could not be completed.'}${Number.isSafeInteger(data.lineNumber)?` (line ${data.lineNumber})`:''}`);error.status=xhr.status;error.code=data.code;reject(error);return;
      }
      resolve(data);
    };
    xhr.send(body);
  });
}
function setSession(user, csrfToken = '', access = null) {
  if ((state.user?.id ?? null) !== (user?.id ?? null) || state.csrfToken !== csrfToken) {
    state.sessionEpoch++; state.generation++; clearInterval(countdownTimer); countdownTimer = null;
    clearCapturePairing(); stopCompanionPolling(); attendanceClonePreviews.clear();
    closeItemSurfaces(); itemDetailsCache.clear(); state.characters = []; state.raids = []; state.items = []; state.currentAuction = null; state.adjustmentCharacters = []; state.importPayload = null; state.accessData = null; state.accessSearch = ''; state.companionDevices=[];state.catalogStatus=null;state.spellNamesStatus=null;state.spellNamesOpen=false;state.raidLootPreview=null;state.raidLootImport=null;state.raidLootImportId=null;state.lootTab='drafts';state.raidLootEventPage=0;state.inventoryCharacterId=null;state.inventoryPreview=null;state.inventoryResult=null;state.profileTab='overview'; state.preferredAttendanceRaid = null; state.auditFilters = {actorId:'',subjectUserId:'',characterId:'',action:'',q:'',from:'',to:'',limit:50,offset:0};
  }
  state.equipment = null; state.equipmentLoot = []; state.gearPicker = null;
  state.user = user; state.csrfToken = csrfToken; state.access = access || user?.access || null;
}
function setAuthBusy(pending) {
  state.authPending = pending;
  $('#auth').querySelectorAll('button, input').forEach(element => { element.disabled = pending; });
  const logout = $('[data-action="logout"]'); if (logout) logout.disabled = pending;
}
function flash(message, error = false) {
  const element = $('#announcement');
  element.textContent = message; element.hidden = !message; element.classList.toggle('error', error);
}
function heading(title, description, eyebrow = 'Guild Desk') {
  $('#page-heading').innerHTML = `<div class="page-head"><div><div class="eyebrow">${escape(eyebrow)}</div><h1>${escape(title)}</h1><p>${escape(description)}</p></div></div>`;
}
function renderShell() {
  $('#startup').hidden = true;
  $('#workspace').hidden = !state.user;
  $('#auth').hidden = Boolean(state.user);
  $('#account-bar').hidden = !state.user;
  if (!state.user) { $('#account-bar').replaceChildren(); $('#page-content').replaceChildren(); $('#page-heading').replaceChildren(); return; }
  $('#account-bar').innerHTML = `<div class="identity"><strong>${escape(state.user.name)}</strong><small>${escape(state.access?.profileName || 'Guild member')}</small></div><button type="button" class="quiet" data-action="logout">Sign out</button>`;
  const links = [['dashboard','Overview'],['characters','Characters'],['mains','Mains and attendance'],['corrections','Missing attendance'],['auctions','Auctions']];
  const officer = [['attendance','Attendance'],['ledger','DKP ledger'],['items','Item references'],['captures','Live loot capture'],['loot','Boss loot preparation'],['claims','Character claims'],['settings','Reward settings'],['audit','Audit history'],['access','Access control']];
  const nav = rows => rows.filter(([key])=>canViewPage(key)).map(([key,label])=>`<button type="button" data-nav="${key}" ${(state.page===key||state.page==='profile'&&key==='characters')?'aria-current="page"':''}>${label}</button>`).join('');
  const officerLinks=nav(officer);
  $('#navigation').innerHTML = nav(links)+(officerLinks?`<span class="nav-label">Officer workspace</span>${officerLinks}`:'');
  setAuthBusy(state.authPending);
}
function renderAuth() {
  const register = state.authMode === 'register';
  $('#auth').innerHTML = `<section class="auth-intro"><div class="eyebrow">Your guild, accounted for</div><h1>A clear record of every raid night.</h1><p>Link your characters, review attendance, and keep your main's DKP history in one place.</p><ul><li>Officer-approved character ownership</li><li>Multiple attendance ticks per raid</li><li>Audited DKP earnings</li></ul></section><section class="auth-panel" aria-label="Member sign in"><div class="auth-tabs"><button type="button" data-auth="login" aria-pressed="${!register}">Sign in</button><button type="button" data-auth="register" aria-pressed="${register}">Create account</button></div><form id="auth-form" data-form="auth">${register ? '<label>Display name<input name="name" autocomplete="name" maxlength="80" required></label>' : ''}<label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label>Password<input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" ${register ? 'minlength="12" maxlength="128"' : ''} required>${register ? '<small>Use 12 to 128 characters.</small>' : ''}</label><div data-form-error class="field-error" role="alert" hidden></div><button class="primary" type="submit">${register ? 'Create account' : 'Sign in'}</button></form>${register ? '<div class="notice"><p><strong>Private first-time setup</strong></p><p>The first account becomes the administrator. Create that account while this test site remains owner-private.</p></div><p class="small muted section-gap">Password recovery and email delivery are not available in this first test build. Keep your sign-in details.</p>' : '<p class="small muted section-gap">New to this test site? Create an account, then request your character.</p>'}</section>`;
  applyAccessControls($('#auth'));
  setAuthBusy(state.authPending);
}
function reviewContext(element) {
  const lootRow=element.closest?.('[data-loot-row]'), captureRow=element.closest?.('[data-capture-event]'), importRow=element.closest?.('[data-raid-loot-event]'), tickRow=element.closest?.('[data-attendance-tick]'), form=element.closest?.('[data-form]');
  const anchor=lootRow || captureRow || importRow || tickRow;
  return {anchorTop:anchor?.getBoundingClientRect?.().top ?? null,scrollX:window.scrollX || 0,scrollY:window.scrollY || 0,lootRow:lootRow?.dataset.lootRow || null,captureEvent:captureRow?.dataset.captureEvent || null,raidLootEvent:importRow?.dataset.raidLootEvent || null,attendanceTick:tickRow?.dataset.attendanceTick || null,form:form?.dataset.form || null};
}
function restoreReviewContext(context) {
  const row=context.lootRow ? [...document.querySelectorAll('[data-loot-row]')].find(element=>element.dataset.lootRow===context.lootRow) : context.captureEvent ? [...document.querySelectorAll('[data-capture-event]')].find(element=>element.dataset.captureEvent===context.captureEvent) : context.raidLootEvent ? [...document.querySelectorAll('[data-raid-loot-event]')].find(element=>element.dataset.raidLootEvent===context.raidLootEvent) : context.attendanceTick ? [...document.querySelectorAll('[data-attendance-tick]')].find(element=>element.dataset.attendanceTick===context.attendanceTick) : null;
  const form=!row && context.form ? [...document.querySelectorAll('[data-form]')].find(element=>element.dataset.form===context.form && !element.dataset.row) : null;
  const target=row?.querySelector('details > summary') || row?.querySelector('form button') || row || form?.querySelector('button:not(:disabled)') || $('#main');
  const top=row&&Number.isFinite(context.anchorTop)&&row.getBoundingClientRect?Math.max(0,row.getBoundingClientRect().top+(window.scrollY || 0)-context.anchorTop):context.scrollY;
  target?.focus({preventScroll:true}); window.scrollTo?.({top,left:context.scrollX,behavior:'instant'});
}

async function navigate(page, recordId = null, detailId = null, options = {}) {
  const targetCharacterId=page==='dashboard'?state.equipment?.character.id:['mains','profile'].includes(page)?recordId:null;
  if(options.profileTab==='inventory'&&state.inventoryCharacterId===targetCharacterId)state.profileTab='inventory';
  else {state.profileTab='overview';state.inventoryCharacterId=null;state.inventoryPreview=null;state.inventoryResult=null;}
  clearCapturePairing(); stopCompanionPolling(); attendanceClonePreviews.clear(); state.captureStatus=null;
  closeItemSurfaces();
  clearInterval(countdownTimer); countdownTimer = null;
  const nextLootTab=page==='loot'&&options.lootTab==='raid-import'?'raid-import':'drafts';
  if(nextLootTab!=='raid-import'||!recordId||state.lootTab!==nextLootTab||state.raidLootImportId!==recordId){state.raidLootPreview=null;state.raidLootImport=null;state.raidLootEventPage=0;}
  state.lootTab=nextLootTab;state.raidLootImportId=page==='loot'&&nextLootTab==='raid-import'?recordId:null;
  state.gearPicker = null; state.equipment = null; state.equipmentLoot = []; state.profileId = page === 'profile' ? recordId : null;
  state.characterTab = page === 'characters' && recordId === 'create' ? 'create' : 'registry'; state.tickId = page === 'attendance' ? detailId : null;
  state.page = page; state.raidId = page === 'attendance' ? recordId : null; state.auctionId = page === 'auctions' ? recordId : null; state.currentAuction = null; state.importPayload = null; state.mainReportId = page === 'mains' ? recordId : null; state.lootDraftId = page === 'loot' && state.lootTab==='drafts' ? recordId : null; state.captureId = page === 'captures' ? recordId : null;
  const generation = ++state.generation;
  renderShell();
  if(options.preserveContext)$('#page-content').setAttribute('aria-busy','true');
  else {$('#page-content').removeAttribute('aria-busy');$('#page-content').innerHTML = '<div class="panel"><p class="muted" role="status">Loading records...</p></div>';}
  const titles = { dashboard: ['Your guild overview', 'Your characters, main DKP, and attendance at a glance.'], characters: ['Characters', 'Find your character in the registry and request a claim. Create a new character only when it is missing.'], attendance: ['Raid attendance', 'Each listed approved main earns the raid tick rate, regardless of zone.'], ledger: ['DKP ledger', 'A permanent record of posted DKP transactions.'], claims: ['Character claims', 'Review ownership and main or alt status before approving credit.'], audit: ['Audit history', 'See who changed guild records and when.'], auctions: ['Sealed auctions', 'Bid with your approved main. Officers confirm each item award before DKP is deducted.'], items: ['Item references', 'Search the uploaded EverQuest item catalog.'] };
  heading(...(titles[page] || titles.dashboard), officerAreas.includes(pageArea(page)) ? 'Officer workspace' : 'Member workspace');
  try {
    let html;
    if (!canReadPage(page)) { $('#page-content').removeAttribute('aria-busy'); $('#page-content').innerHTML = empty(canViewPage(page)?'Read access required':'Page unavailable', 'Ask an administrator for permission to read these records.'); return; }
    switch (page) {
      case 'characters': html = await charactersPage(); break;
      case 'profile': heading('Character overview', 'Equipment references and character identity.', 'Character profile'); html = await characterProfilePage(recordId); break;
      case 'mains': heading('Main DKP and attendance', 'Each dump is one check-in. Percentages use attended ticks divided by total guild ticks.', 'Guild summary'); html = recordId ? await mainAttendancePage(recordId) : await mainsPage(); break;
      case 'loot': heading('Boss loot preparation', 'Review boss loot before publishing auctions.', 'DKP manager workspace'); html = lootTabs()+(state.lootTab==='raid-import'?(recordId?await raidLootImportPage(recordId):await raidLootImportsPage()):(recordId?await lootDraftPage(recordId):await lootDraftsPage())); break;
      case 'captures': heading('Live loot capture', 'Receive abfloot channel messages from your local EverQuest log companion.', 'DKP manager workspace'); html = recordId ? await capturePage(recordId) : await capturesPage(); break;
      case 'attendance': html = recordId ? detailId ? await tickAttendancePage(recordId, detailId) : await raidPage(recordId) : await raidsPage(); break;
      case 'claims': html = await claimsPage(); break;
      case 'ledger': html = await ledgerPage(); break;
      case 'audit': html = await auditPage(); break;
      case 'access': heading('Access control','Manage access profiles and member permissions.','Administration'); html = await accessPage(); break;
      case 'items': html = await itemsPage(); break;
      case 'corrections': heading('Missing attendance', 'Request or review a correction for a specific recorded attendance tick.', 'Attendance corrections'); html = await correctionsPage(); break;
      case 'settings': heading('Reward settings', 'Set future raid rates, minimum bids, and expansion and raid-type presets.', 'Officer workspace'); html = await settingsPage(); break;
      case 'auctions': html = recordId ? await auctionPage(recordId) : await auctionsPage(); break;
      default: html = await dashboardPage();
    }
    if (generation !== state.generation || !state.user) return;
    $('#page-content').innerHTML = html; $('#page-content').removeAttribute('aria-busy');
    applyAccessControls($('#page-content'));
    startCountdowns(); startCompanionPolling();
    if (options.preserveContext) restoreReviewContext(options.preserveContext);
    else { $('#main').focus({ preventScroll: true }); window.scrollTo?.({top:0,left:0,behavior:'instant'}); }
  } catch (error) {
    if (error.silent || generation !== state.generation || !state.user) return;
    $('#page-content').removeAttribute('aria-busy');
    $('#page-content').innerHTML = `<div class="notice error" role="alert"><strong>${error.status === 403 ? 'Access required' : 'Records could not be loaded'}</strong><p>${escape(error.message)}</p></div><button type="button" data-action="retry">Try again</button>`;
  }
}
async function dashboardPage() {
  const data = await api('/dashboard');
  const own=data.characters || [], main=own.find(character=>character.kind==='main');
  if(main) return mainAttendancePage(main.id,true);
  return `<section class="panel">${empty('Claim your main character','Find your character in the registry and request ownership.',can('characters','view')?'<button type="button" class="primary" data-nav="characters">Open character registry</button>':'')}</section>${own.length?`<section class="panel"><h2>Your characters</h2>${characterTable(own)}</section>`:''}`;
}
function characterTabs() {
  return `<nav class="character-tabs" aria-label="Character views"><button type="button" data-action="character-registry" ${state.characterTab === 'registry' ? 'aria-current="page"' : ''}>Character registry</button><button type="button" data-action="character-create" ${state.characterTab === 'create' ? 'aria-current="page"' : ''}>Create new character</button></nav>`;
}
async function charactersPage() {
  const generation = state.generation;
  const { characters } = await api('/characters'); if (generation === state.generation && state.page === 'characters') state.characters = characters;
  const newCharacterForm = `<section class="panel"><div class="panel-head"><div><h2>Request a new character</h2><p>Use this when your character is not already in the registry. An officer must approve this character.</p></div></div><form data-form="create-character"><div class="form-grid"><label>Character name<input name="name" minlength="2" maxlength="64" pattern="[A-Za-z][A-Za-z'\\-]{1,63}" autocomplete="off" spellcheck="false" required><small>2 to 64 letters, apostrophes, or hyphens, beginning with a letter.</small></label><label>Current level<input name="level" type="number" min="1" max="255" step="1" required></label><label>Character class<select name="className" required><option value="">Choose the character class</option>${classChoices.map(([, className]) => `<option value="${escape(className)}">${escape(className)}</option>`).join('')}</select></label></div><div class="notice section-gap">The request creates an unclassified, unowned record and a pending claim for your account. It does not approve main status, assign ownership, or award DKP.</div><div class="form-actions"><button type="submit" class="primary">Request character and ownership</button></div><div data-form-error class="field-error" role="alert" hidden></div></form></section>`;
  if (state.characterTab === 'create') return `${characterTabs()}${newCharacterForm}`;
  return `${characterTabs()}<section class="panel"><div class="panel-head"><div><h2>Character registry</h2><p>Characters appear after an attendance import or a member character request.</p></div><span class="tag">${characters.length} characters</span></div>${characters.length ? `<div class="toolbar"><label><span class="small">Find a character</span><input type="search" id="character-search" placeholder="Search by name or class" autocomplete="off"></label></div><div id="character-table">${characterTable(characters)}</div>` : empty('No characters imported yet', can('attendance','write') ? 'Import attendance or request a character from the Create new character tab to start the registry.' : 'Import attendance or request a character from the Create new character tab.', can('attendance','write') ? '<button type="button" class="primary" data-nav="attendance">Open attendance</button>' : '')}</section><div class="notice">Claim approval links the character to an account and confirms main or alt status. Existing pending ticks are credited only for an approved main.</div>`;
}
function characterTable(characters) {
  if (!characters.length) return empty('No matching characters', 'Try another name or class.');
  return table(['Character', 'Class', 'Status', 'Owner', 'Action'], characters.map(character => {
    const mine = character.ownerId === state.user.id;
    let action = mine ? '<span class="small muted">Your character</span>' : character.ownerId ? '<span class="small muted">Assigned</span>' : character.claimStatus === 'pending' ? '<span class="tag">Claim pending</span>' : `<button type="button" class="quiet" data-action="claim" data-character="${escape(character.id)}">Request claim</button>`;
    return `<tr><td class="character-name"><button type="button" class="text-button" data-action="open-profile" data-character="${escape(character.id)}">${escape(character.name)}</button><span class="muted">Level ${escape(character.level)}</span></td><td>${escape(character.className)}</td><td><span class="tag">${escape(character.kind)}</span>${character.pendingTicks ? `<span class="muted">${escape(number(character.pendingTicks))} pending ticks</span>` : ''}</td><td>${escape(character.ownerName || 'Unclaimed')}</td><td>${action}</td></tr>`;
  }));
}
function detachAssignmentControl(assignment) {
  if (!can('claims','write') || assignment.outcome !== 'approved' || !assignment.currentlyAssigned) return '<span class="small muted">-</span>';
  return `<details class="detach-control"><summary>Detach / unclaim</summary><form data-form="detach-character" data-character="${escape(assignment.characterId)}" data-owner="${escape(assignment.userId)}" data-assignment="${escape(assignment.id)}"><p class="small muted">Remove this account assignment. Attendance, loot and the character's DKP ledger are retained. Active bids or pending awards must be resolved first.</p><label>Reason<textarea name="reason" maxlength="1000" rows="2" required></textarea></label><label class="review-check"><input type="checkbox" name="reviewed" required><span>I reviewed this character and account and want to detach them.</span></label><button type="submit">Detach character</button><div data-form-error class="field-error" role="alert" hidden></div></form></details>`;
}
async function claimsPage() {
  if (!can('claims','read')) throw Object.assign(new Error('Only administrators can review character claims.'), { status: 403 });
  const {claims, assignments = []} = await api('/claims');
  const pending = claims.filter(claim => claim.status === 'pending');
  return `<div class="notice">Each account has one approved main and any number of approved alts. An officer confirms character ownership and main or alt status.</div><section class="panel"><div class="panel-head"><h2>Pending character claims</h2><span class="tag">${pending.length} pending</span></div>${pending.length ? pending.map(claim => `<form data-form="approve-claim" data-claim="${escape(claim.id)}" class="panel"><div class="panel-head"><div><h3>${escape(claim.characterName)}</h3><p>Requested by ${escape(claim.userName)} (${escape(claim.userEmail)})</p><p>${escape(date(claim.createdAt))}</p></div><span class="tag">Needs review</span></div><div class="form-grid"><label>Confirmed character status<select name="kind" required><option value="">Choose main or alt</option><option value="main">Main - release pending DKP</option><option value="alt">Alt - no main DKP</option></select></label><button class="primary" type="submit">Approve character assignment</button></div><div data-form-error class="field-error" role="alert" hidden></div></form>`).join('') : empty('No claims waiting', 'Member character requests will appear here for your review.')}</section><section class="panel"><div class="panel-head"><h2>Resolved claim history</h2></div>${assignments.length ? table(['Character', 'Member', 'Main / Alt', 'Outcome', 'Resolved', 'Reason', 'Assigned by', 'Action'], assignments.map(assignment => `<tr><td class="character-name">${escape(assignment.characterName)}</td><td>${escape(assignment.userName)}</td><td>${escape(assignment.kind || '-')}</td><td><span class="tag${assignment.outcome !== 'approved' ? ' warning' : ''}">${escape(assignment.outcome)}</span></td><td>${escape(date(assignment.resolvedAt))}</td><td>${escape(assignment.reason || (assignment.outcome === 'approved' ? 'Character assignment approved' : '-'))}${assignment.outcome === 'detached' ? `<span class="muted">Detached by ${escape(assignment.actorName || 'Unknown officer')}</span>` : ''}</td><td>${escape(assignment.assignedBy || 'Unknown / legacy record')}</td><td>${detachAssignmentControl(assignment)}</td></tr>`)) : empty('No resolved claims yet', 'Approval and detach history will retain the member, main or alt type, and assigning officer.')}</section>`;
}
async function raidsPage() {
  const generation = state.generation;
  const [{ raids }, { settings }] = await Promise.all([api('/raids'), api('/settings')]); if (generation === state.generation && state.page === 'attendance') state.raids = raids;
  const today = new Date(); const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return `${can('attendance','write') ? `<section class="panel"><div class="panel-head"><div><h2>Create a raid night</h2><p>One raid night can contain multiple attendance dumps.</p></div></div><form data-form="create-raid"><div class="form-grid"><label>Raid name<input name="name" maxlength="120" placeholder="Raid name or expansion" required></label><label>Raid date<input name="date" type="date" value="${localDate}" required></label><label>DKP per eligible tick<input name="rate" id="raid-rate" type="number" min="1" max="1000000" step="1" value="${escape(settings.defaultTickRate)}" required><small>Applied to each approved main in each dump.</small></label>${settings.presets.length ? `<label>Expansion / raid-type preset<select id="raid-rate-preset"><option value="">Custom or default rate</option>${settings.presets.map((preset, index) => `<option value="${index}" data-rate="${escape(preset.rate)}">${escape(preset.expansion)} / ${escape(preset.raidType)} | ${escape(number(preset.rate))} DKP</option>`).join('')}</select></label>` : ''}<button class="primary" type="submit">Create raid night</button></div><div data-form-error class="field-error" role="alert" hidden></div></form></section>` : ''}<section class="panel"><div class="panel-head"><h2>Raid nights</h2><span class="tag">${raids.length} recorded</span></div>${raids.length ? table(['Raid', 'Date', 'Ticks', 'Rate', 'Details'], raids.map(raid => `<tr><td class="character-name">${escape(raid.name)}</td><td>${escape(date(raid.date))}</td><td>${escape(number(raid.tickCount))}</td><td>${escape(number(raid.rate))} DKP</td><td><button type="button" class="quiet" data-action="open-raid" data-raid="${escape(raid.id)}">Open raid</button></td></tr>`)) : empty('No raid nights yet', can('attendance','write') ? 'Create your first raid night above, then upload the attendance dumps.' : 'Your officers will add raid nights and attendance here.')}</section>`;
}
function attendanceCloneKey(raidId,tickId) {return JSON.stringify([raidId,tickId]);}
function tickCloneOrigin(tick,raidId) {
  const origin=tick.origin;if(origin?.kind!=='officer_clone')return '';
  return `<details class="tick-clone-origin"><summary>Officer-cloned attendance</summary><dl class="item-facts section-gap"><div><dt>Copied from</dt><dd><button type="button" class="text-button" data-action="open-tick" data-raid="${escape(raidId)}" data-tick="${escape(origin.sourceTickId)}">${escape(origin.sourceFileName)}</button><span class="muted">${escape(sourceTime(origin.sourceCaptureTime))}</span></dd></div><div><dt>Reason</dt><dd>${escape(origin.reason)}</dd></div><div><dt>Cloned by</dt><dd>${escape(origin.actorName || 'Unknown officer')}</dd></div><div><dt>Recorded</dt><dd>${escape(date(origin.clonedAt))}</dd></div><div><dt>DKP per main</dt><dd>${escape(number(origin.rate))}</dd></div></dl></details>`;
}
function attendanceCloneControl(raid,tick) {
  if(!can('attendance','write')||tick.origin?.kind==='officer_clone')return '';
  const key=attendanceCloneKey(raid.id,tick.id);
  return `<details class="attendance-clone" data-attendance-clone data-clone-key="${escape(key)}"><summary>Clone dump</summary><p class="small muted section-gap">Copy the attendance recorded in ${escape(tick.fileName)} at ${escape(sourceTime(tick.sourceTime))} into another tick of ${escape(raid.name)}.</p><form data-form="preview-attendance-clone" data-raid="${escape(raid.id)}" data-source="${escape(tick.id)}" data-clone-key="${escape(key)}"><label class="section-gap">New tick time on ${escape(date(raid.date))}<input name="targetTime" type="time" step="1" required><small>Use the same source clock as the raid dumps. The raid date is fixed.</small></label><label class="section-gap">Officer reason<textarea name="reason" rows="2" minlength="3" maxlength="500" required></textarea></label><div class="form-actions"><button type="submit">Preview attendance copy</button></div><div data-form-error class="field-error" role="alert" hidden></div></form><div data-clone-preview class="section-gap"></div></details>`;
}
function attendanceClonePreviewPanel(record) {
  const preview=record.preview;
  return `<section class="attendance-clone-review" aria-labelledby="attendance-clone-heading-${escape(record.sourceTickId)}"><h3 id="attendance-clone-heading-${escape(record.sourceTickId)}" tabindex="-1">Review copied attendance</h3><dl class="item-facts section-gap"><div><dt>Source capture</dt><dd>${escape(preview.source.fileName)}<span class="muted">${escape(sourceTime(preview.source.sourceTime))}</span></dd></div><div><dt>Same raid</dt><dd>${escape(preview.target.raidName)} | ${escape(date(preview.target.raidDate))}</dd></div><div><dt>New capture time</dt><dd>${escape(sourceTime(preview.target.sourceTime))}</dd></div><div><dt>Copied rows</dt><dd>${escape(number(preview.source.rowCount))}</dd></div><div><dt>DKP per approved main</dt><dd>${escape(number(preview.target.rate))}</dd></div></dl><p class="small section-gap">${escape(number(preview.counts.creditableMains))} creditable mains | ${escape(number(preview.counts.pending))} pending | ${escape(number(preview.counts.ineligible))} ineligible</p><p class="small section-gap"><strong>${escape(number(preview.counts.projectedDkp))} projected DKP</strong> from this new tick.</p><p class="small muted section-gap">The new tick is recorded as officer-cloned attendance with its source and reason.</p><div class="clone-roster section-gap">${table(['Character','Class','Zone','Status','DKP'],(preview.rows || []).map(row=>`<tr><td>${escape(row.name)}</td><td>${escape(row.className)}</td><td>${escape(row.zone)}</td><td>${escape(row.status)}</td><td>${amount(row.dkp)}</td></tr>`),true)}</div><p class="small section-gap"><strong>Reason:</strong> ${escape(preview.reason)}</p><form data-form="commit-attendance-clone" data-raid="${escape(record.raidId)}" data-source="${escape(record.sourceTickId)}" data-clone-key="${escape(record.key)}"><label class="review-check section-gap"><input type="checkbox" name="reviewed" required><span>I confirm this copied roster, new time, rate and reason for the additional attendance tick.</span></label><div class="form-actions"><button type="submit" class="primary">Confirm cloned attendance tick</button><button type="button" data-action="open-raid" data-raid="${escape(record.raidId)}">Refresh raid records</button></div><div data-form-error class="field-error" role="alert" hidden></div></form></section>`;
}
function clearAttendanceClonePreview(form) {
  const record=attendanceClonePreviews.get(form.dataset.cloneKey);if(record?.commitAttempted)return;
  attendanceClonePreviews.delete(form.dataset.cloneKey);const component=form.closest('[data-attendance-clone]');const target=component?.querySelector('[data-clone-preview]');target?.replaceChildren();
}
function retainAttendanceCloneRetry(form) {
  const record=attendanceClonePreviews.get(form.dataset.cloneKey);if(!record?.commitAttempted)return;
  const component=form.closest('[data-attendance-clone]'),preview=component?.querySelector('[data-form="preview-attendance-clone"]');
  preview?.querySelectorAll('input,textarea').forEach(control=>{control.readOnly=true;});preview?.querySelectorAll('button').forEach(button=>{button.disabled=true;});const retry=component?.querySelector('[data-form="commit-attendance-clone"] button[type="submit"]');if(retry)retry.textContent='Retry the same cloned tick';
}
function resetAttendanceCloneInputs(form) {
  const component=form.closest('[data-attendance-clone]'),source=component?.querySelector('[data-form="preview-attendance-clone"]');source?.querySelectorAll('input,textarea').forEach(control=>{control.readOnly=false;control.disabled=false;});source?.querySelectorAll('button').forEach(button=>{button.disabled=false;});
}

async function raidPage(raidId) {
  const [{raid,ticks,attendance},correctionOptions]=await Promise.all([api(`/raids/${encodeURIComponent(raidId)}`),can('corrections','read')?api('/attendance-requests/options'):Promise.resolve({character:null,ticks:[]})]);
  if (state.page === 'attendance' && state.raidId === raidId) heading(raid.name, `${date(raid.date)} | ${number(raid.rate)} DKP per approved-main tick`, 'Raid attendance');
  const pending = attendance.filter(row => row.status === 'pending').length;
  const credited = attendance.filter(row => row.status === 'credited').length;
  const captures = new Map(ticks.map(tick => [tick.id, tick.sourceTime]));
  const main=correctionOptions.character;
  const uncreditedTicks=(correctionOptions.ticks || []).filter(tick=>tick.raidId===raidId);
  const correctionForm = can('corrections','read') ? `<section class="panel"><div class="panel-head"><div><h2>Request missing attendance</h2><p>Requests are for your own approved main and a specific existing tick.</p></div><button type="button" data-nav="corrections">Request history</button></div>${!main ? empty('Approve your main first', 'Claim your main character and have an officer approve it before requesting attendance.', '<button type="button" data-nav="characters">Open characters</button>') : !uncreditedTicks.length ? empty(ticks.length ? 'No missing eligible ticks in this raid' : 'No recorded ticks to request yet', ticks.length ? 'No available attendance correction is needed for this raid.' : 'An officer must import a dump before a request can reference its tick.') : `<form data-form="request-attendance" data-character="${escape(main.id)}"><div class="notice">Requesting for ${escape(main.name)}. An officer must approve the original tick rate before any correction credit is posted.</div><label>Missing tick<select name="tickId" required><option value="">Choose a recorded source capture</option>${uncreditedTicks.map(tick => `<option value="${escape(tick.id)}">${escape(sourceTime(tick.sourceTime))} | ${escape(tick.fileName)}</option>`).join('')}</select></label><label class="section-gap">Why should this tick include your main?<textarea name="reason" maxlength="1000" rows="3" required></textarea></label><div class="form-actions"><button type="submit" class="primary">Submit attendance request</button></div><p class="small muted section-gap">One request is kept per main and tick. Review request history before submitting again.</p><div data-form-error class="field-error" role="alert" hidden></div></form>`}</section>` : '';
  return `<div class="toolbar"><button type="button" data-nav="attendance">Back to raid nights</button></div><div class="stats"><section class="stat"><span class="stat-label">Attendance ticks</span><strong>${escape(number(ticks.length))}</strong></section><section class="stat"><span class="stat-label">Credited attendance rows</span><strong>${escape(number(credited))}</strong></section><section class="stat"><span class="stat-label">Pending rows</span><strong>${escape(number(pending))}</strong></section></div>${correctionForm}${can('attendance','write') ? `<section class="panel"><div class="panel-head"><div><h2>Upload attendance dumps</h2><p>Preview the batch before posting attendance and DKP.</p></div></div><form data-form="preview-import"><label>Attendance files<input name="files" id="attendance-files" type="file" accept=".txt,text/plain" multiple required><small>Use the original exported filenames. Uploaded copies with a (1) suffix are supported.</small></label><ul id="selected-files" class="file-list"></ul><div class="form-actions"><button type="submit" class="primary">Preview imports</button></div><div data-form-error class="field-error" role="alert" hidden></div></form><div id="import-preview" class="section-gap" hidden></div></section>` : ''}<section class="panel" id="attendance-clone-workspace"><div class="panel-head"><div><h2>Attendance ticks</h2><p>Uploaded dump times come from filenames; cloned times are supplied by an officer. Their timezone is unconfirmed.</p></div></div>${ticks.length ? table(['Source capture','File','Rows',...(can('attendance','write')?['Action']:[])],ticks.map(tick=>`<tr tabindex="-1" data-attendance-tick="${escape(tick.id)}"><td><button type="button" class="text-button" data-action="open-tick" data-raid="${escape(raid.id)}" data-tick="${escape(tick.id)}">${escape(sourceTime(tick.sourceTime))}</button></td><td>${escape(tick.fileName)}${tickCloneOrigin(tick,raid.id)}</td><td>${escape(number(tick.rowCount))}</td>${can('attendance','write')?`<td>${attendanceCloneControl(raid,tick)}</td>`:''}</tr>`)) : empty('No attendance imported', 'Each unique dump will create one attendance tick.')}</section><section class="panel"><div class="panel-head"><h2>Attendance records</h2><span class="tag">${attendance.length} rows</span></div>${attendance.length ? table(['Character', 'Capture time', 'Class', 'Zone', 'Status', 'DKP'], attendance.map(row => `<tr><td>${escape(row.characterName)}</td><td>${escape(sourceTime(captures.get(row.tickId)))}</td><td>${escape(row.className)}</td><td>${escape(row.zone)}</td><td><span class="tag">${escape(row.status)}</span></td><td class="amount">${amount(row.dkp)}</td></tr>`)) : empty('No attendance rows', 'Imported characters and their credit status will appear here.')}</section>`;
}
async function tickAttendancePage(raidId, tickId) {
  const {raid, tick, attendance} = await api(`/raids/${encodeURIComponent(raidId)}/ticks/${encodeURIComponent(tickId)}`);
  if (state.page === 'attendance' && state.raidId === raidId && state.tickId === tickId) heading('Attendance source capture', `${raid.name} | ${sourceTime(tick.sourceTime)}`, 'Raid attendance');
  return `<div class="toolbar"><button type="button" data-action="open-raid" data-raid="${escape(raid.id)}">Back to ${escape(raid.name)}</button></div><section class="panel" tabindex="-1" data-attendance-tick="${escape(tick.id)}"><div class="panel-head"><div><h2>${escape(sourceTime(tick.sourceTime))}</h2><p>${escape(tick.fileName)}</p></div><span class="tag">${escape(number(attendance.length))} attendance records</span></div><p class="small muted">${tick.origin?.kind === 'officer_clone' ? 'This tick was reconstructed by an officer. The selected time uses the raid source clock; see the original capture below.' : 'This view contains only this source capture. Source time is preserved as recorded; its timezone is unconfirmed.'}</p>${tickCloneOrigin(tick,raid.id)}<div id="attendance-clone-workspace">${attendanceCloneControl(raid,tick)}</div>${attendance.length ? table(['Character', 'Class', 'Zone', 'Status', 'DKP'], attendance.map(row => `<tr><td class="character-name">${escape(row.characterName)}</td><td>${escape(row.className)}</td><td>${escape(row.zone)}</td><td><span class="tag">${escape(row.status)}</span></td><td class="amount">${amount(row.dkp)}</td></tr>`)) : empty('No attendance records in this tick', 'No other source captures are included in this view.')}</section>`;
}
function importPreview(data) {
  return `<div class="panel-head"><div><h2>Import preview</h2><p>${escape(number(data.totalRows))} source rows. No points have been posted by this preview.</p></div></div>${table(['File / source time', 'Rows', 'Status', 'Mains', 'Pending', 'Alts'], data.files.map(file => `<tr><td>${escape(file.name)}<span class="muted">${escape(sourceTime(file.sourceTime))}</span></td><td>${escape(number(file.rowCount))}</td><td>${escape(file.status)}</td><td>${escape(number(file.eligibleMains))}</td><td>${escape(number(file.unclaimed))}</td><td>${escape(number(file.alts))}</td></tr>`))}${data.files.some(file => file.warnings.length) ? `<div class="notice warning section-gap"><strong>Review these warnings</strong><ul class="file-list">${data.files.flatMap(file => file.warnings.map(warning => `<li>${escape(file.name)}: ${escape(warning)}</li>`)).join('')}</ul></div>` : ''}<div class="notice section-gap">Approved mains earn the raid rate. Unclaimed names retain pending ticks. Alts earn no main DKP. Duplicate snapshots do not earn credit again.</div><div class="actions"><button type="button" class="primary" data-action="commit-import">Confirm and import this batch</button><button type="button" data-action="cancel-import">Cancel preview</button></div><div data-commit-error class="field-error" role="alert" hidden></div>`;
}
async function ledgerPage() {
  const generation = state.generation;
  const [{ entries }, characterData] = await Promise.all([api('/ledger'), can('ledger','write') ? api('/ledger/characters') : Promise.resolve({ characters: [] })]);
  const adjustmentCharacters = characterData.characters;
  if (generation === state.generation && state.page === 'ledger') state.adjustmentCharacters = adjustmentCharacters;
  const adjustmentForm = can('ledger','write') ? `<section class="panel"><div class="panel-head"><div><h2>Officer DKP adjustment</h2><p>Record a separate, audited change. Original attendance and award entries are preserved.</p></div></div>${adjustmentCharacters.length ? `<form data-form="adjust-dkp" data-idempotency-key="${crypto.randomUUID()}"><div class="form-grid"><label>Main character<select name="characterId" id="adjustment-character" required><option value="">Choose an approved main</option>${adjustmentCharacters.map(character => `<option value="${escape(character.id)}" ${state.adjustmentCharacterId === character.id ? 'selected' : ''}>${escape(character.name)} | ${escape(number(character.balance))} DKP</option>`).join('')}</select></label><label>Signed DKP amount<input name="amount" id="adjustment-amount" type="number" step="1" placeholder="5 or -5" required><small>Positive adds DKP; negative subtracts it. Zero is not an adjustment.</small></label><label class="full">Reason for the adjustment<textarea name="reason" maxlength="1000" rows="3" required></textarea></label></div><p class="small muted section-gap" id="adjustment-projection">Choose a main and amount to preview the balance.</p><div class="form-actions"><button type="submit" class="primary">Record DKP adjustment</button></div><div data-form-error class="field-error" role="alert" hidden></div></form>` : empty('No approved main to adjust', 'Approve a character claim as main before posting an adjustment.')}</section>` : '';
  return `${adjustmentForm}<section class="panel"><div class="panel-head"><div><h2>DKP transactions</h2><p>Newest entries first. This test build shows up to 500 entries.</p></div></div>${entries.length ? table(['Character', 'Amount', 'Reason / source', 'Recorded by', 'Date'], entries.map(entry => `<tr><td>${escape(entry.characterName)}</td><td class="amount">${amount(entry.amount)}</td><td>${escape(entry.reason)}${entry.raidName ? `<span class="muted">${escape(entry.raidName)}${entry.sourceTime ? ` | ${escape(sourceTime(entry.sourceTime))}` : ''}</span>` : ''}</td><td>${escape(entry.actorName)}</td><td>${escape(date(entry.createdAt))}</td></tr>`)) : empty('No DKP posted yet', 'Approved-main attendance credits and confirmed adjustments or awards will appear here.')}</section>`;
}
function actionLabel(value) { return String(value || '').replace(/[_.:-]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase()); }
async function auditPage() {
  const data = await api(`/audit?${new URLSearchParams(Object.entries(state.auditFilters).filter(([,value])=>value!=='' && value!==null && value!==undefined))}`), filters=data.filters || {};
  const choice=(key,label,rows)=>`<label>${label}<select name="${key}"><option value="">All ${label.toLowerCase()}</option>${(rows || []).map(row=>`<option value="${escape(typeof row==='string'?row:row.id)}" ${state.auditFilters[key]===(typeof row==='string'?row:row.id)?'selected':''}>${escape(typeof row==='string'?actionLabel(row):row.name)}</option>`).join('')}</select></label>`;
  return `<section class="panel"><div class="panel-head"><div><h2>Guild activity</h2><p>${escape(number(data.total || 0))} matching actions</p></div></div><form data-form="filter-audit" class="audit-filters"><label>Search history<input type="search" name="q" maxlength="200" value="${escape(state.auditFilters.q)}" placeholder="Name, reason or activity"></label>${choice('actorId','Recorded by',filters.actors)}${choice('subjectUserId','Member',filters.subjects)}${choice('characterId','Character',filters.characters)}${choice('action','Activity',filters.actions)}<label>From<input name="from" type="date" value="${escape(state.auditFilters.from)}"></label><label>Through<input name="to" type="date" value="${escape(state.auditFilters.to)}"></label><button type="submit">Filter history</button><button type="button" data-action="clear-audit">Clear filters</button><div data-form-error class="field-error" role="alert" hidden></div></form>${data.entries.length ? `<ul class="audit-list">${data.entries.map(entry=>`<li><h3>${escape(entry.actionLabel || actionLabel(entry.action))}</h3><p class="small">${escape(entry.actorName || 'System')}${entry.subjectUserName ? ` | ${escape(entry.subjectUserName)}`:''}${entry.characterName?` | ${escape(entry.characterName)}`:''}</p><p class="small muted">${escape(typeof entry.details==='string'?entry.details:JSON.stringify(entry.details))}</p><time datetime="${escape(entry.createdAt)}">${escape(date(entry.createdAt))}</time></li>`).join('')}</ul>`:empty('No matching activity','Change the filters to search other records.')}<div class="form-actions"><button type="button" data-action="audit-page" data-offset="${Math.max(0,Number(data.offset)-Number(data.limit))}" ${Number(data.offset)<=0?'disabled':''}>Previous</button><span class="small muted">${data.total ? `${number(Number(data.offset)+1)} - ${number(Math.min(Number(data.offset)+data.entries.length,data.total))} of ${number(data.total)}`:'0 results'}</span><button type="button" data-action="audit-page" data-offset="${Number(data.offset)+Number(data.limit)}" ${Number(data.offset)+data.entries.length>=Number(data.total)?'disabled':''}>Next</button></div></section>`;
}
function permissionFields(areas,values,inherit=false,effective={}) {
  return table(['Area',inherit?'Override':'Access',...(inherit?['Effective access']:[])],areas.map(area=>`<tr><td>${escape(area.label)}</td><td><select name="permission-${escape(area.key)}" aria-label="${escape(area.label)} ${inherit?'override':'access'}">${inherit?`<option value="" ${values[area.key]===undefined?'selected':''}>Inherit profile</option>`:''}${[[0,'No access'],[1,'View menu'],[2,'Read records'],[3,'Write changes']].map(([level,label])=>`<option value="${level}" ${values[area.key]===level?'selected':''}>${label}</option>`).join('')}</select></td>${inherit?`<td>${escape(['No access','View','Read','Write'][effective[area.key]] || 'No access')}</td>`:''}</tr>`),true);
}
async function accessPage() {
  const generation=state.generation,data=await api('/access'); if(generation===state.generation)state.accessData=data;
  const query=String(state.accessSearch || '').toLowerCase(), users=data.users.filter(user=>`${user.name} ${user.email} ${user.profileName}`.toLowerCase().includes(query));
  const error='<div data-form-error class="field-error" role="alert" hidden></div>';
  return `<section class="panel"><h2>Access profiles</h2><p class="small muted">View shows a menu. Read opens its records. Write permits changes. Member-specific overrides take precedence.</p><div class="access-profiles">${data.profiles.map(profile=>`<details class="access-card"><summary>${escape(profile.name)}</summary><form data-form="save-access-profile" data-profile="${escape(profile.id)}" data-revision="${escape(profile.revision)}"><label class="section-gap">Profile name<input name="name" maxlength="80" required value="${escape(profile.name)}"></label>${permissionFields(data.areas,profile.permissions)}<div class="form-actions"><button type="submit" class="primary">Save profile</button></div>${error}</form></details>`).join('')}</div>${can('access','write')?`<details class="access-card"><summary>Create access profile</summary><form data-form="create-access-profile"><label class="section-gap">Profile name<input name="name" maxlength="80" required></label>${permissionFields(data.areas,data.profiles.find(profile=>profile.id==='member')?.permissions || {})}<div class="form-actions"><button type="submit" class="primary">Create profile</button></div>${error}</form></details>`:''}</section><section class="panel"><div class="panel-head"><h2>Member access</h2><span class="tag">${users.length} members</span></div><form data-form="filter-access" class="toolbar"><label>Find an account<input type="search" name="q" maxlength="120" value="${escape(state.accessSearch || '')}" placeholder="Name, email or profile"></label><button type="submit">Find member</button></form>${users.map(user=>`<details class="access-card"><summary>${escape(user.name)} <span class="small muted">${escape(user.profileName)}</span></summary><p class="small muted section-gap">${escape(user.email)}</p><form data-form="save-access-user" data-user="${escape(user.id)}" data-revision="${escape(user.revision)}"><label class="section-gap">Access profile<select name="profileId">${data.profiles.map(profile=>`<option value="${escape(profile.id)}" ${user.profileId===profile.id?'selected':''}>${escape(profile.name)}</option>`).join('')}</select></label>${permissionFields(data.areas,user.overrides || {},true,user.permissions)}<div class="form-actions"><button type="submit" class="primary">Save member access</button></div>${error}</form></details>`).join('') || empty('No matching members','Search another name or email.')}</section>`;
}
async function correctionsPage() {
  const [{requests}, options] = await Promise.all([api('/attendance-requests'), can('corrections','read') ? api('/attendance-requests/options') : Promise.resolve({character:null,ticks:[]})]);
  const availableTicks=state.preferredAttendanceRaid ? options.ticks.filter(tick=>tick.raidId===state.preferredAttendanceRaid) : options.ticks;
  const requestForm = can('corrections','write') ? `<section class="panel"><h2>Request missing attendance</h2>${state.preferredAttendanceRaid?'<div class="toolbar section-gap"><span class="small muted">Showing missing captures for the selected raid.</span><button type="button" data-action="all-attendance-options">Show all raids</button></div>':''}${options.character ? availableTicks.length ? `<form data-form="request-attendance" data-character="${escape(options.character.id)}" class="section-gap"><label>Missing tick for ${escape(options.character.name)}<select name="tickId" required><option value="">Choose a source capture</option>${availableTicks.map((tick,index)=>`<option value="${escape(tick.id)}" ${state.preferredAttendanceRaid&&index===0?'selected':''}>${escape(tick.raidName)} | ${escape(sourceTime(tick.sourceTime))} | ${escape(tick.fileName)}</option>`).join('')}</select></label><label class="section-gap">Reason<textarea name="reason" maxlength="1000" rows="3" required></textarea></label><div class="form-actions"><button type="submit" class="primary">Request attendance</button></div><div data-form-error class="field-error" role="alert" hidden></div></form>` : '<p class="small muted section-gap">No uncredited attendance ticks are available in this selection.</p>' : `<p class="small muted section-gap">An approved main is required.</p>${can('characters','view')?'<button type="button" data-nav="characters" class="section-gap">Open character registry</button>':''}`}</section>` : '';
  const pending = requests.filter(request => request.status === 'pending');
  const resolved = requests.filter(request => request.status !== 'pending');
  const card = request => `<section class="panel"><div class="panel-head"><div><h2>${escape(request.characterName)} | ${escape(request.raidName)}</h2><p>Requested by ${escape(request.requesterName)} on ${escape(date(request.createdAt))}</p></div><span class="tag">Pending | ${escape(number(request.tickRate))} DKP</span></div><p><strong>Source tick: ${escape(sourceTime(request.sourceTime))}</strong></p><p class="section-gap">${escape(request.reason)}</p>${can('correctionReview','write') ? `<form data-form="decide-attendance" data-request="${escape(request.id)}" class="section-gap"><label>Officer decision reason<textarea name="reason" maxlength="1000" rows="2" required></textarea></label><div class="form-actions"><button type="submit" class="primary" data-decision="approve">Approve original ${escape(number(request.tickRate))} DKP tick</button><button type="submit" data-decision="reject">Reject request</button></div><div data-form-error class="field-error" role="alert" hidden></div></form>` : '<p class="small muted section-gap">Waiting for officer review. No correction DKP has been posted.</p>'}</section>`;
  return `<div class="notice"><strong>Original attendance is preserved.</strong><p>An officer-approved correction posts the original tick rate once, with its own reason and audit entry. Already-credited attendance is not credited twice.</p></div>${requestForm}${pending.length ? pending.map(card).join('') : `<section class="panel">${empty('No pending requests', can('correctionReview','write') ? 'Member requests for missing attendance will appear here.' : 'Open a raid night and choose a missing tick for your approved main.')}</section>`}<section class="panel"><div class="panel-head"><h2>${can('correctionReview','read') ? 'Resolved request history' : 'Your resolved requests'}</h2><span class="tag">${resolved.length} resolved</span></div>${resolved.length ? table(['Main / raid', 'Tick', 'Outcome', 'Decision'], resolved.map(request => `<tr><td><strong>${escape(request.characterName)}</strong><span class="muted">${escape(request.raidName)}</span></td><td>${escape(sourceTime(request.sourceTime))}<span class="muted">${escape(number(request.tickRate))} DKP original rate</span></td><td><span class="tag${request.status === 'rejected' ? ' warning' : ''}">${escape(request.status)}</span></td><td>${escape(request.decisionReason || '-')}<span class="muted">${escape(request.decidedByName || 'Officer')} | ${escape(date(request.decidedAt))}</span></td></tr>`)) : empty('No resolved requests yet', 'Approved and rejected requests will remain in this history.')}</section>`;
}
function presetRow(preset = { expansion: '', raidType: '', rate: 5 }) {
  return `<div class="preset-row" data-preset-row><label>Expansion<input data-preset-field="expansion" value="${escape(preset.expansion)}" maxlength="120" required></label><label>Raid type<input data-preset-field="raidType" value="${escape(preset.raidType)}" maxlength="120" required></label><label>DKP per tick<input data-preset-field="rate" type="number" min="1" max="1000000" step="1" value="${escape(preset.rate)}" required></label><button type="button" data-action="remove-preset">Remove preset</button></div>`;
}
async function settingsPage() {
  if (!can('settings','read')) throw Object.assign(new Error('Only administrators can change reward settings.'), { status: 403 });
  const { settings } = await api('/settings');
  return `<div class="notice"><strong>Settings apply to new records only.</strong><p>Existing raids, ticks, attendance requests, auctions, and ledger history keep their original rates and prices.</p></div><section class="panel"><div class="panel-head"><div><h2>Default rewards and minimum bids</h2><p>${settings.updatedAt ? `Last updated ${escape(date(settings.updatedAt))}` : 'Using the initial guild defaults.'}</p></div></div><form data-form="save-settings"><div class="form-grid"><label>Default DKP per attendance tick<input name="defaultTickRate" type="number" min="1" max="1000000" step="1" value="${escape(settings.defaultTickRate)}" required></label><label>Default minimum bid and price<input name="minimumBid" type="number" min="1" max="1000000" step="1" value="${escape(settings.minimumBid)}" required></label></div><div class="panel-head section-gap"><div><h2>Expansion and raid-type presets</h2><p>Define your own expansion names and reward rates. Select a preset when creating a new raid.</p></div><button type="button" data-action="add-preset">Add reward preset</button></div><div id="reward-presets">${settings.presets.map(presetRow).join('')}</div><p class="small muted">At most 100 presets. Each expansion and raid-type pair must be unique.</p><div class="form-actions"><button type="submit" class="primary">Save future reward settings</button></div><div data-form-error class="field-error" role="alert" hidden></div></form></section>`;
}
function exactTime(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value || '-') : parsed.toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
}
function countdown(value) { return `<span class="countdown numeric" data-deadline="${escape(value)}">Deadline ${escape(exactTime(value))}</span>`; }
function startCountdowns() {
  clearInterval(countdownTimer); countdownTimer = null;
  const elements = [...document.querySelectorAll('[data-deadline]')]; if (!elements.length) return;
  function update() {
    if (!elements.some(element => element.isConnected)) { clearInterval(countdownTimer); countdownTimer = null; return; }
    for (const element of elements) {
      if (!element.isConnected) continue;
      const remaining = Math.ceil((new Date(element.dataset.deadline).getTime() - Date.now()) / 1000);
      if (!Number.isFinite(remaining)) { element.textContent = 'Review the published deadline'; continue; }
      if (remaining <= 0) { element.textContent = 'Deadline reached - refresh server status'; continue; }
      const hours = Math.floor(remaining / 3600); const minutes = Math.floor((remaining % 3600) / 60); const seconds = remaining % 60;
      element.textContent = `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s remaining`;
    }
  }
  update(); countdownTimer = setInterval(update, 1000);
}
async function auctionsPage() {
  const query = new URLSearchParams(state.auctionFilters);
  const [data, references, settingsData] = await Promise.all([api(`/auctions?${query}`), can('auctionAdmin','write') ? api('/items?limit=100') : Promise.resolve({ items: [] }), can('auctionAdmin','write') ? api('/settings') : Promise.resolve(null)]);
  const selected = references.items.find(item => item.itemId === state.auctionDraftItemId);
  const unknown = Boolean(selected && selected.name === null);
  const creation = can('auctionAdmin','write') ? `<section class="panel"><div class="panel-head"><div><h2>Publish a sealed auction</h2><p>Publishing opens bidding immediately for exactly 24 hours.</p></div><button type="button" data-nav="items">Manage item references</button></div>${references.items.length ? `<form data-form="create-auction"><div class="form-grid"><label class="full">Item reference<select name="itemId" id="auction-item-reference" required><option value="">Choose a saved item reference</option>${references.items.map(item => `<option value="${escape(item.itemId)}" data-unresolved="${item.name === null}" ${selected?.itemId === item.itemId ? 'selected' : ''}>${escape(item.name || `Unresolved item ${item.itemId}`)} | ID ${escape(item.itemId)}</option>`).join('')}</select></label><label class="full" id="auction-title-label" ${unknown ? '' : 'hidden'}>Item name from the game<input name="title" id="auction-game-title" maxlength="200" ${unknown ? 'required' : 'disabled'}><small>Officer-supplied name. EQResource metadata remains unverified.</small></label><label>Number of copies<input name="quantity" type="number" min="1" max="50" step="1" value="1" required></label><label>Minimum bid and price<input name="minimumBid" type="number" min="1" max="1000000" step="1" value="${escape(settingsData.settings.minimumBid)}" required><small>Whole DKP. Bid increments are 1 DKP.</small></label></div><div class="form-actions"><button type="submit" class="primary">Publish 24-hour auction</button></div><div data-form-error class="field-error" role="alert" hidden></div></form>` : empty('Look up an item reference first', 'Auctions use a saved EQResource item ID. An unresolved reference can use an officer-supplied game item name.', '<button type="button" data-nav="items">Open item references</button>')}</section>` : '';
  return `${creation}<section class="panel"><div class="panel-head"><div><h2>Guild auctions</h2><p>Other bidders, amounts, and participation remain hidden until the server deadline.</p></div><button type="button" data-action="refresh-auctions">Refresh</button></div><form data-form="filter-auctions" class="item-filters"><label>Item name<input name="q" type="search" value="${escape(state.auctionFilters.q)}" maxlength="120" placeholder="Search auctions"></label><label>Usable by<select name="class"><option value="">Any class</option>${classChoices.map(([code, name]) => `<option value="${code}" ${state.auctionFilters.class === code ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label>Status<select name="status">${[['open', 'Open'], ['closed', 'Closed'], ['all', 'All auctions']].map(([key, label]) => `<option value="${key}" ${state.auctionFilters.status === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button type="submit">Filter auctions</button><div data-form-error class="field-error full" role="alert" hidden></div></form>${data.auctions.length ? `<div class="auction-list">${data.auctions.map(auction => `<article class="auction-row"><div><div class="actions"><h3>${itemTrigger(auction.itemId, auction.itemName)}</h3><span class="tag">${escape(auction.status)}</span>${auction.metadataStatus === 'unresolved' ? '<span class="tag warning">Officer-supplied name</span>' : ''}</div><p class="small muted">${escape(number(auction.quantity))} ${auction.quantity === 1 ? 'copy' : 'copies'} | Minimum ${escape(number(auction.minimumBid))} DKP | ${escape(metadataList(auction.classes))}</p><p class="small">${auction.status === 'open' ? countdown(auction.closesAt) : `Closed deadline: ${escape(exactTime(auction.closesAt))}`}</p><p class="small muted">${auction.status === 'open' ? auction.ownBid ? `Your bid: ${escape(number(auction.ownBid.amount))} DKP` : 'Your bid: none' : auction.resultsReady ? `${escape(number(auction.confirmedAwardCount))} of ${escape(number(auction.awardCount))} awards confirmed` : 'View final results'}</p></div><button type="button" class="${auction.status === 'open' ? 'primary' : ''}" data-action="open-auction" data-auction="${escape(auction.id)}">${auction.status === 'open' ? 'View / bid' : 'View results'}</button></article>`).join('')}</div>` : empty('No matching auctions', can('auctionAdmin','write') ? 'Publish an auction above or change the filters.' : 'An officer will publish loot here. You can also change the filters to review closed auctions.')}</section>`;
}
function currentBidLimit(eligibility) {
  const value=eligibility?.maxBid ?? eligibility?.balance; return Number.isSafeInteger(value)?Math.max(0,value):null;
}
async function auctionPage(auctionId) {
  const generation = state.generation;
  const data = await api(`/auctions/${encodeURIComponent(auctionId)}`);
  const auction = data.auction;
  if (generation === state.generation && state.page === 'auctions' && state.auctionId === auctionId) {
    state.currentAuction = auction;
    heading(auction.itemName, `${number(auction.quantity)} ${auction.quantity === 1 ? 'copy' : 'copies'} | Minimum ${number(auction.minimumBid)} DKP | Sealed bidding`, 'Guild auction');
  }
  const own = auction.ownBid;
  let bidding = '';
  if (auction.status === 'open' && can('auctions','write')) {
    const eligibility=auction.ownEligibility || {}, maxBid=currentBidLimit(eligibility), canPlace=eligibility.eligible&&maxBid!==null&&maxBid>=Number(auction.minimumBid);
    bidding=`<section class="panel"><div class="panel-head"><div><h2>Your sealed bid</h2><p class="small muted">Maximum per bid: ${maxBid===null?'Unavailable':`${escape(number(maxBid))} DKP`}</p></div><span class="tag">Main characters only</span></div>${canPlace?`<form data-form="place-bid" data-auction="${escape(auction.id)}"><div class="form-grid"><label>Bid amount in DKP<input name="amount" type="number" min="${escape(auction.minimumBid)}" max="${escape(maxBid)}" step="1" value="${escape(Math.min(maxBid,own?.amount ?? auction.minimumBid))}" required><small>Each bid is capped at your current DKP. Bids on other items do not reduce this limit.</small></label><button type="submit" class="primary">${own?'Save sealed bid':'Place sealed bid'}</button></div><div data-form-error class="field-error" role="alert" hidden></div></form>`:`<p class="field-error" role="status">${escape(eligibility.reason || (maxBid===null?'Refresh to load your current DKP before bidding.':`The minimum bid is ${number(auction.minimumBid)} DKP; your current per-bid limit is ${number(maxBid)} DKP.`))}</p>`}${own?`<div class="under-line"><div><strong>Current bid: ${escape(number(own.amount))} DKP</strong><p class="small muted">Tie priority since ${escape(exactTime(own.firstSubmittedAt))}</p></div><button type="button" data-action="withdraw-bid" data-auction="${escape(auction.id)}">Withdraw bid</button></div>${maxBid!==null&&own.amount>maxBid?'<p class="small warning-text section-gap">Your saved bid exceeds your current balance. Reduce it or withdraw it.</p>':''}`:''}</section>`;
  }
  const awards = data.awards || [];
  const awarded = new Map(awards.map(award => [award.characterId, award]));
  const results = auction.status === 'closed' ? `<section class="panel"><div class="panel-head"><div><h2>Final bids and results</h2><p>All final active bids are visible to guild members after closing.</p></div><span class="tag">${escape(number(awards.length))} awards | ${escape(number(Math.max(0, auction.quantity - awards.length)))} unawarded copies</span></div>${data.bids?.length ? table(['Character / member', 'Bid', 'Outcome', 'Price'], data.bids.map(bid => `<tr><td><strong>${escape(bid.characterName)}</strong><span class="muted">${escape(bid.userName)}</span></td><td class="amount">${escape(number(bid.amount))}</td><td>${awarded.has(bid.characterId) ? '<span class="tag">Winner</span>' : bid.eligible ? 'Not awarded' : 'Ineligible'}</td><td class="amount">${awarded.has(bid.characterId) ? `${escape(number(awarded.get(bid.characterId).price))} DKP` : '-'}</td></tr>`)) : empty('No eligible bids to award', 'No DKP is deducted for unawarded copies.')}<p class="small muted section-gap">Winners pay the next ranked eligible bid plus 1, capped at their own bid. A winner with no lower bid pays the minimum. Ties use the earliest submission of the current amount, then server acceptance order.</p></section>${awards.length ? `<section class="panel"><div class="panel-head"><div><h2>Item awards</h2><p>Closing records results. An officer confirms each item before its DKP charge is posted.</p></div></div>${table(['Recipient', 'Price', 'DKP balance', 'Award status', 'Action'], awards.map(award => {
    const canSeeBalance = award.currentBalance !== null;
    const projected = canSeeBalance ? award.currentBalance - (award.status === 'pending' ? award.price : 0) : null;
    return `<tr><td><strong>${escape(award.characterName)}</strong><span class="muted">${escape(award.userName)}</span></td><td class="amount">${escape(number(award.price))}</td><td>${canSeeBalance ? `<span class="numeric ${award.currentBalance < 0 ? 'negative' : ''}">${escape(number(award.currentBalance))} current</span>${award.status === 'pending' ? `<span class="muted ${projected < 0 ? 'negative' : ''}">${escape(number(projected))} projected after award</span>` : ''}` : '<span class="muted">Private</span>'}</td><td><span class="tag">${escape(award.status)}</span>${award.confirmedAt ? `<span class="muted">${escape(exactTime(award.confirmedAt))}</span>` : ''}</td><td>${can('auctionAdmin','write') && award.status === 'pending' ? `<button type="button" class="primary" data-action="confirm-award" data-auction="${escape(auction.id)}" data-character="${escape(award.characterId)}">Confirm ${escape(number(award.price))} DKP award</button>` : award.status === 'confirmed' ? '<span class="small muted">Charged once</span>' : '<span class="small muted">Awaiting officer</span>'}</td></tr>`;
  }))}<div class="notice section-gap">Negative balances are allowed. Officers handle them through explicit, audited adjustments; this site does not automatically forgive or block the charge.</div></section>` : ''}` : '';
  return `<div class="toolbar"><button type="button" data-nav="auctions">Back to auctions</button><button type="button" data-action="refresh-auction" data-auction="${escape(auction.id)}">${auction.status === 'open' ? 'Refresh server status' : 'Refresh results'}</button></div><section class="panel"><div class="panel-head"><div><h2>${auction.status === 'open' ? 'Bidding is open' : 'Bidding is closed'}</h2><p>Published ${escape(exactTime(auction.publishedAt))}</p></div><span class="tag">${escape(auction.mode)}</span></div><p><strong>Deadline: ${escape(exactTime(auction.closesAt))}</strong></p>${auction.status === 'open' ? `<p class="section-gap">${countdown(auction.closesAt)}</p><p class="small muted">The countdown uses this device's clock. The server enforces the exact deadline. Refresh to load server results.</p>` : ''}<div class="under-line"><span class="small muted">${escape(metadataList(auction.classes))}${auction.metadataStatus === 'unresolved' ? ' | Item name supplied by an officer; source metadata unverified' : ''}</span><span class="actions">${itemTrigger(auction.itemId, 'View full item details')}${sourceLink(auction)}</span></div></section>${bidding}${results}<section class="panel"><div class="panel-head"><div><h2>${auction.status === 'open' ? 'Your bid history' : 'Auction bid history'}</h2><p>${auction.status === 'open' ? 'Before closing, this view contains only your own events.' : 'All bid changes and withdrawals are available after closing.'}</p></div><button type="button" data-action="auction-audit" data-auction="${escape(auction.id)}">Load bid history</button></div><div id="auction-audit"></div></section>`;
}
const classChoices = [['WAR', 'Warrior'], ['CLR', 'Cleric'], ['PAL', 'Paladin'], ['RNG', 'Ranger'], ['SHD', 'Shadow Knight'], ['DRU', 'Druid'], ['MNK', 'Monk'], ['BRD', 'Bard'], ['ROG', 'Rogue'], ['SHM', 'Shaman'], ['NEC', 'Necromancer'], ['WIZ', 'Wizard'], ['MAG', 'Magician'], ['ENC', 'Enchanter'], ['BST', 'Beastlord'], ['BER', 'Berserker']];
function sourceLink(item, label = 'Open EQResource') {
  try {
    const url = new URL(item.sourceUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'items.eqresource.com' || url.pathname !== '/items.php' || !/^\d+$/.test(url.searchParams.get('id') || '')) return '<span class="muted">Source link unavailable</span>';
    return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`;
  } catch { return '<span class="muted">Source link unavailable</span>'; }
}
const metadataList = value => value === null ? 'Unknown' : Array.isArray(value) ? value.map(item => item === 'ALL' ? 'All (verified)' : item).join(', ') || 'None recorded' : 'Unknown';
function catalogDiscardControl(entry,catalog) {
  if(!can('items','write')||entry.id===catalog.active?.id||!['staging','ready'].includes(entry.status))return '<span class="muted">-</span>';
  return `<details class="catalog-discard"><summary>Discard incomplete import</summary><form data-form="discard-catalog" data-import="${escape(entry.id)}" class="section-gap"><p class="small muted">Discard this incomplete file so it can be uploaded again. The active item database is retained.</p><label class="review-check section-gap"><input type="checkbox" name="reviewed" required><span>I want to discard this incomplete import.</span></label><div class="form-actions"><button type="submit">Discard import</button></div><div data-form-error class="field-error" role="alert" hidden></div></form></details>`;
}

function spellNameCacheSection(status) {
  if(!status)return '';
  return `<details class="spell-name-cache section-gap" ${state.spellNamesOpen?'open':''}><summary>Effect name cache${status.available?` - ${escape(number(status.entryCount))} names`:''}</summary>${status.statusError?`<p class="small warning-text section-gap">${escape(status.statusError)}</p>`:`<dl class="item-facts section-gap"><div><dt>Cache</dt><dd>${status.available?'Available':'Not downloaded yet'}</dd></div><div><dt>Source modified</dt><dd>${escape(date(status.sourceModifiedAt))}</dd></div><div><dt>Cache retrieved</dt><dd>${escape(date(status.fetchedAt))}</dd></div></dl><p class="small muted section-gap">Names come from the dated Raidloot spell file. Unlisted effects stay unnamed.</p>${status.lastError?`<p class="small warning-text section-gap">${escape(status.lastError)}</p>`:''}${status.retryAfter?`<p class="small muted section-gap">Automatic retry after ${escape(date(status.retryAfter))}.</p>`:''}`} ${can('items','write')?`<form data-form="refresh-spell-names"><div class="form-actions"><button type="submit">${status.available?'Refresh effect names':'Retry effect names'}</button></div><div data-form-error class="field-error" role="alert" hidden></div></form>`:''}</details>`;
}

function catalogSection(catalog,spellNames=state.spellNamesStatus) {
  const active=catalog.active,limits=catalog.limits || {},uploadMiB=Number(limits.uploadBytes || 0)/(1024*1024);
  return `<section class="panel"><div class="panel-head"><div><h2>Uploaded item database</h2><p>${active?`${escape(number(active.itemCount))} items available`:'No item catalog uploaded yet'}</p></div><button type="button" data-nav="items">Refresh catalog status</button></div>${active?`<dl class="item-facts section-gap"><div><dt>Active file</dt><dd>${escape(active.fileName)}</dd></div><div><dt>Catalog date</dt><dd>${escape(date(active.sourceDate))}</dd></div><div><dt>Imported</dt><dd>${escape(date(active.importedAt))}</dd></div></dl><details class="section-gap"><summary>File details</summary><p class="small muted section-gap">${escape(number(active.fieldCount))} fields per item</p><code class="catalog-hash">SHA-256: ${escape(active.fileSha256)}</code></details>`:''}${can('items','write')?`<details class="catalog-upload section-gap" ${active?'':'open'}><summary>${active?'Update item database':'Upload item database'}</summary><p class="small muted section-gap">Choose the SODEQ item export as .txt or .txt.gz. Searches use the uploaded file; EQResource opens only as an external item link.</p><p class="small section-gap"><a href="https://items.sodeq.org/download.php" target="_blank" rel="noopener noreferrer">Download SODEQ item data</a></p><form data-form="import-catalog" data-revision="${escape(catalog.revision)}" class="section-gap"><div class="form-grid"><label>Item data file<input id="catalog-file" name="file" type="file" accept=".txt,.gz,text/plain,application/gzip,application/x-gzip" required><small>${uploadMiB?`Up to ${escape(number(uploadMiB))} MiB.`:''} All records are validated before the active database changes.</small></label><label>Catalog date (optional)<input name="sourceDate" type="date"></label></div><p id="catalog-file-selection" class="small muted section-gap"></p><progress id="catalog-upload-progress" class="catalog-upload-progress section-gap" max="100" hidden aria-label="Item database upload"></progress><p id="catalog-upload-status" class="small section-gap" role="status"></p><div class="form-actions"><button type="submit" class="primary">${active?'Upload updated database':'Upload database'}</button></div><div data-form-error class="field-error" role="alert" hidden></div></form></details>`:''}${catalog.imports?.length?`<details class="section-gap"><summary>Import history</summary>${table(['File','Status','Catalog date','Items','Imported','Action'],catalog.imports.map(entry=>`<tr><td>${escape(entry.fileName)}</td><td><span class="tag">${entry.id===active?.id?'Active':entry.status==='staging'?'Incomplete':entry.status==='ready'?'Ready':entry.status==='failed'?'Failed':escape(actionLabel(entry.status))}</span>${entry.error?`<span class="muted">${escape(entry.error)}</span>`:''}</td><td>${escape(date(entry.sourceDate))}</td><td>${escape(number(entry.itemCount))}</td><td>${escape(date(entry.importedAt))}</td><td>${catalogDiscardControl(entry,catalog)}</td></tr>`),true)}</details>`:''}${spellNameCacheSection(spellNames)}</section>`;
}

async function itemsPage() {
  const generation = state.generation;
  const query = new URLSearchParams({ ...state.itemFilters, limit: '50' });
  const [data,catalog,spellNames]=await Promise.all([api(`/items?${query}`),api('/catalog'),api('/catalog/spell-names').catch(error=>{if(error.silent)throw error;return{statusError:error.message};})]); if(generation===state.generation&&state.page==='items'){state.items=data.items;state.catalogStatus=catalog;state.spellNamesStatus=spellNames;}
  const selected = data.items.find(item => item.itemId === state.selectedItemId);
  const form = `<form data-form="filter-items" class="item-filters"><label>Item name or exact ID<input name="q" type="search" maxlength="120" value="${escape(state.itemFilters.q)}" placeholder="Search uploaded catalog"></label><label>Class<select name="class"><option value="">Any class</option>${classChoices.map(([code, name]) => `<option value="${code}" ${state.itemFilters.class === code ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label>Slot<select name="slot"><option value="">Any slot</option>${['AMMO','ARMS','BACK','CHARM','CHEST','EAR','FACE','FEET','FINGER','HANDS','HEAD','LEGS','NECK','PRIMARY','RANGE','SECONDARY','SHOULDERS','WAIST','WRIST'].map(slot => `<option value="${slot}" ${state.itemFilters.slot === slot ? 'selected' : ''}>${slot.charAt(0)+slot.slice(1).toLowerCase()}</option>`).join('')}</select></label><button type="submit">Search catalog</button><div data-form-error class="field-error full" role="alert" hidden></div></form>`;
  return `${catalogSection(catalog,spellNames)}<div class="notice"><strong>Uploaded item catalog</strong><p>${escape(data.sourceNotice)}</p><p>Items come from the uploaded catalog. EQResource links open separately for reference.</p></div>${can('items','write') ? `<section class="panel"><div class="panel-head"><div><h2>Look up an item reference</h2><p>Look up a catalog item ID, or paste an item hardlink or Advanced Loot reference.</p></div></div><form data-form="lookup-item"><label>Item ID or reference<input name="itemId" maxlength="1000" placeholder="81773 or https://items.eqresource.com/items.php?id=81773" required><small>Advanced Loot format: itemID^iconID^name. A supplied name is not treated as verified item metadata.</small></label><div class="form-actions"><button type="submit" class="primary">Look up item</button></div><div data-form-error class="field-error" role="alert" hidden></div></form></section>` : ''}<section class="panel"><div class="panel-head"><div><h2>Local item catalog</h2><p>Search item names and IDs from the uploaded catalog.</p></div><span class="tag">${escape(number(data.total))} matches</span></div>${form}${data.items.length ? table(['Item', 'Classes', 'Slot', 'Metadata', 'Details'], data.items.map(item => `<tr><td>${itemTrigger(item.itemId, item.name || `Item ${item.itemId}`)}<span class="muted">EQ item ID ${escape(item.itemId)}</span>${sourceLink(item, 'EQResource item link')}</td><td>${escape(metadataList(item.classes))}</td><td>${escape(metadataList(item.slots))}</td><td><span class="tag${item.metadataStatus === 'unresolved' ? ' warning' : ''}">${item.sourceStatus?.status==='uploaded'?'Uploaded item data':item.metadataStatus==='verified_reference'?'Saved reference':'Details unavailable'}</span></td><td><button type="button" class="quiet" data-action="item-detail" data-item-preview="${escape(item.itemId)}" data-item="${escape(item.itemId)}">View details</button></td></tr>`)) : empty('No matching references', 'Try another filter or ask an officer to add a reference. Upload an item catalog to make more items available.')}${data.total > data.items.length ? '<p class="small muted section-gap">Showing the first 50 matches. Narrow your search to find a specific reference.</p>' : ''}</section><div id="item-detail">${selected ? itemDetail(selected) : ''}</div>`;
}
function itemDetail(item) {
  return `<section class="panel"><div class="panel-head"><div><h2>Saved item reference</h2><p>${escape(item.name || `Item ${item.itemId}`)} | EQ item ID ${escape(item.itemId)}</p></div>${itemTrigger(item.itemId, 'Full item details and guild loot history')}</div><p class="small muted">Open the item to view all cached stats, source status, previous loot appearances, and final auction results.</p></section>`;
}
const attendanceWindows = [['days30', '30 days'], ['days60', '60 days'], ['days90', '90 days'], ['allTime', 'All time']];
function attendanceValue(value) {
  const fraction = `${number(value?.attendedTicks || 0)} / ${number(value?.totalTicks || 0)} ticks`;
  const percentage = value?.percentage === null || value?.percentage === undefined ? '-' : `${number(value.percentage)}%`;
  return `<strong class="numeric">${escape(percentage)}</strong><span class="muted small">${escape(fraction)}</span>`;
}
function reportFilter(groups = [], characterId = null) {
  return `<form data-form="filter-mains" ${characterId ? `data-character="${escape(characterId)}"` : ''} class="report-filters"><label>Attendance through<input name="asOf" type="date" value="${escape(state.reportAsOf)}" required></label>${characterId ? '' : `<label>Class<select name="class"><option value="">All classes</option>${groups.map(group => `<option value="${escape(group.className)}" ${state.reportClass === group.className ? 'selected' : ''}>${escape(group.className)}</option>`).join('')}</select></label>`}<button type="submit">Update attendance view</button><div data-form-error class="field-error full" role="alert" hidden></div></form>`;
}
async function mainsPage() {
  const data = await api(`/reports/mains?${new URLSearchParams({ asOf: state.reportAsOf })}`);
  const groups = data.classGroups.filter(group => !state.reportClass || group.className === state.reportClass);
  const sections = groups.map(group => `<section class="panel"><div class="panel-head"><h2>${escape(group.className)}</h2><span class="tag">${escape(number(group.mains.length))} mains</span></div><div class="mains-table">${table(['Main / member', 'Current DKP', ...attendanceWindows.map(([, label]) => label)], group.mains.map(main => `<tr><td><button type="button" class="text-button" data-action="main-attendance" data-character="${escape(main.id)}">${escape(main.name)}</button><span class="muted">${escape(main.ownerName || '-')}</span></td><td class="amount ${main.balance < 0 ? 'negative' : ''}">${escape(number(main.balance))}</td>${attendanceWindows.map(([key]) => `<td>${attendanceValue(main.windows[key])}</td>`).join('')}</tr>`))}</div></section>`).join('');
  return `<section class="panel"><div class="panel-head"><div><h2>Guild mains by class</h2><p>Current DKP includes every posted credit, award charge, and adjustment.</p></div><span class="tag">${escape(number(data.mains.length))} approved mains</span></div>${reportFilter(data.classGroups)}<div class="notice section-gap"><strong>One dump = one check-in.</strong><p>Attendance is credited ticks divided by all guild ticks in the selected window. Three of six is 50%; six of six is 100%. Approved corrections count once.</p><p class="small muted">Attendance through ${escape(date(data.asOf))}. DKP is the current ledger balance. No join-date proration or bidding restriction is applied.</p></div></section>${sections || `<section class="panel">${empty('No approved mains in this view', 'Approve main character claims or choose another class.')}</section>`}`;
}
async function mainAttendancePage(characterId, overview = false) {
  const generation = state.generation;
  const [data, lootData, equipment] = await Promise.all([api(`/reports/mains/${encodeURIComponent(characterId)}/attendance?${new URLSearchParams({ asOf: state.reportAsOf })}`), api(`/reports/mains/${encodeURIComponent(characterId)}/loot`), api(`/characters/${encodeURIComponent(characterId)}/equipment`)]);
  if (generation === state.generation) { state.equipment = equipment; state.equipmentLoot = (lootData.loot || []).filter(entry => entry.status === 'confirmed'); }
  const main = data.main;
  const attendedRaids=data.raids.filter(raid=>Number(raid.attendedTicks)>0), ownsMain=equipment.character.ownerId===state.user?.id && equipment.character.kind==='main';
  const profileHeader = `${overview ? '' : '<div class="toolbar"><button type="button" data-nav="mains">Back to all mains</button></div>'}<section class="panel"><div class="panel-head"><div><h2>${escape(main.name)}</h2><p>${escape(main.className)} | ${escape(main.ownerName || '-')}</p></div><strong class="main-balance numeric ${main.balance < 0 ? 'negative' : ''}">${escape(number(main.balance))} current DKP</strong></div></section>`;
  const tabs=inventoryTabs(equipment);
  if(state.profileTab==='inventory'&&canEditEquipment(equipment))return profileHeader+tabs+inventoryPanel(equipment);
  return `${profileHeader}${tabs}${equipmentPanel(equipment)}<section class="panel"><h2>Attendance overview</h2>${overview ? reportFilter([], characterId).replace('data-form="filter-mains"','data-form="filter-overview"') : reportFilter([], characterId)}<div class="attendance-window-grid section-gap">${attendanceWindows.map(([key, label]) => `<section><h3>${label}</h3>${attendanceValue(main.windows[key])}<p class="small muted">${data.windows[key].startDate ? `${escape(date(data.windows[key].startDate))} through ` : 'All recorded dates through '}${escape(date(data.asOf))}</p></section>`).join('')}</div></section><section class="panel"><div class="panel-head"><h2>Attendance by raid</h2><span class="tag">Tick-based check-ins</span></div>${attendedRaids.length ? table(['Raid','Date','Total dumps','Attendance','Action'], attendedRaids.map(raid=>`<tr><td>${can('attendance','read')?`<button type="button" class="text-button" data-action="open-raid" data-raid="${escape(raid.id)}">${escape(raid.name)}</button>`:escape(raid.name)}</td><td>${escape(date(raid.date))}</td><td class="amount">${escape(number(raid.totalTicks))}</td><td>${attendanceValue(raid)}</td><td>${ownsMain&&can('corrections','write')&&Number(raid.attendedTicks)<Number(raid.totalTicks)?`<button type="button" class="quiet small" data-action="request-raid-attendance" data-raid="${escape(raid.id)}">Request attendance</button>`:''}</td></tr>`)) : empty('No attended raids yet','Raid nights appear here after your first recorded check-in.')}<p class="small muted section-gap">Window percentages use total check-ins divided by total dumps, not an average of each raid's percentage.</p></section>${mainLootSection(lootData.loot || [])}`;
}

async function characterProfilePage(characterId) {
  const generation = state.generation;
  const equipment = await api(`/characters/${encodeURIComponent(characterId)}/equipment`);
  const loot = equipment.character.kind === 'main' ? (await api(`/reports/mains/${encodeURIComponent(characterId)}/loot`)).loot || [] : [];
  if (generation === state.generation) { state.equipment = equipment; state.equipmentLoot = loot.filter(entry => entry.status === 'confirmed'); }
  const profileHeader = `<div class="toolbar"><button type="button" data-nav="characters">Back to character registry</button></div><section class="panel"><div class="panel-head"><div><h2>${escape(equipment.character.name)}</h2><p>${escape(equipment.character.className)} | ${escape(equipment.character.kind || 'Unclassified')}</p></div>${equipment.character.kind === 'main' ? `<button type="button" data-action="main-attendance" data-character="${escape(characterId)}">DKP, attendance and loot</button>` : ''}</div></section>`;
  const tabs=inventoryTabs(equipment);
  if(state.profileTab==='inventory'&&canEditEquipment(equipment))return profileHeader+tabs+inventoryPanel(equipment);
  return `${profileHeader}${tabs}${equipmentPanel(equipment)}${equipment.character.kind === 'main' ? mainLootSection(loot) : ''}`;
}
function inventoryTabs(data) {
  if(!canEditEquipment(data))return '';
  return `<nav class="character-tabs profile-tabs" aria-label="Character profile views"><button type="button" data-action="profile-overview" ${state.profileTab==='overview'?'aria-current="page"':''}>Overview</button><button type="button" data-action="profile-inventory" ${state.profileTab==='inventory'?'aria-current="page"':''}>Inventory</button></nav>`;
}
function installedAugments(augments,compact=false) {
  if(!Array.isArray(augments)||!augments.length)return '';
  const rows=`<ul class="installed-augments">${augments.map(augment=>`<li><span class="muted">Socket ${escape(augment.socket)}:</span> ${itemTrigger(augment.itemId,augment.name || `Item ${augment.itemId}`)}</li>`).join('')}</ul>`;
  return compact?`<details class="gear-augments"><summary>Augments (${augments.length})</summary>${rows}</details>`:rows;
}
function inventoryPanel(data) {
  return `<section class="panel" id="inventory-workspace"><div class="panel-head"><div><h2>Inventory for ${escape(data.character.name)}</h2><p>Import equipped items and installed augments from an EverQuest inventory export.</p></div></div><form data-form="inventory-preview"><label>Inventory export<input id="inventory-file" name="file" type="file" accept=".txt,text/plain" required><small>Run /outputfile inventory in EverQuest, then choose the exported text file. Up to 2 MiB. Bags, storage and keyring entries are excluded from equipment.</small></label><div class="form-actions"><button type="submit" class="primary">Preview equipped items</button></div><div data-form-error class="field-error" role="alert" hidden></div></form>${state.inventoryResult?`<p class="inventory-result section-gap" role="status">${state.inventoryResult.alreadyApplied?'This import was already applied.':`${escape(number(state.inventoryResult.imported))} equipment slots imported.`} DKP and loot awards are unchanged.</p>`:''}<div id="inventory-preview" class="section-gap" ${state.inventoryPreview||state.inventoryResult?.preview?'':'hidden'}>${state.inventoryPreview?inventoryPreviewPanel(state.inventoryPreview):state.inventoryResult?.preview?inventoryPreviewPanel({...state.inventoryResult,completed:true}):''}</div></section>`;
}
function inventoryPreviewPanel(saved) {
  const preview=saved.preview,summary=preview.summary || {},completed=Boolean(saved.completed);
  const rows=preview.slots.map(row=>`<tr><td>${completed?row.itemId===null?'No change':saved.importedKeys?.includes(row.slotKey)?'<span class="tag">Imported</span>':'Not selected':row.itemId===null?'<span class="muted">-</span>':`<label class="inventory-choice"><input type="checkbox" name="inventory-slot" value="${escape(row.slotKey)}" ${row.currentItemId===null&&row.selectedByDefault?'checked':''}><span>${row.currentItemId===null?'Import':row.status==='same'?'Refresh item / augments':'Overwrite saved item'}</span></label>`}</td><td><strong>${escape(row.label)}</strong></td><td>${row.currentItemId===null?'<span class="muted">Empty</span>':itemTrigger(row.currentItemId,row.currentItemName || `Item ${row.currentItemId}`)}</td><td>${row.itemId===null?'<span class="muted">Empty export slot</span>':`${itemTrigger(row.itemId,row.itemName || row.exportedName || `Item ${row.itemId}`)}<span class="muted">ID ${escape(row.itemId)} | Line ${escape(row.line)}</span>${row.itemName&&row.exportedName&&row.itemName!==row.exportedName?`<span class="muted">Export name: ${escape(row.exportedName)}</span>`:''}`}</td><td>${installedAugments(row.augments) || '<span class="muted">None</span>'}</td><td>${row.itemId===null?'No change':!row.catalogAvailable?'<span class="warning-text">Item details unavailable in uploaded catalog</span>':row.status==='same'?(completed?'Same item':'Same item; select to refresh augments'):'Uploaded item data'}</td></tr>`);
  const mapping=table([completed?'Result':'Import','Slot',completed?'Before import':'Saved item','Exported item','Installed augments','Details'],rows);
  return `<section aria-labelledby="inventory-preview-heading"><h3 id="inventory-preview-heading" tabindex="-1">${completed?'Inventory import results':'Review equipment'} for ${escape(preview.character.name)}</h3><p class="small muted section-gap">${escape(saved.fileName)}</p><div class="capture-counts section-gap"><span><strong>${escape(number(summary.equipped))}</strong> equipped items</span><span><strong>${escape(number(summary.augmentCount))}</strong> installed augments</span><span><strong>${escape(number(summary.storageRows))}</strong> storage rows</span><span><strong>${escape(number(summary.keyRingRows))}</strong> keyring rows</span></div><p class="small muted section-gap">${escape(number(summary.ignoredRows))} non-equipment rows ignored. Empty exported slots never clear saved gear.${completed?'':' Existing gear stays unchanged unless you select its overwrite checkbox.'}</p>${completed?mapping:`<form data-form="inventory-import" class="section-gap">${mapping}<div class="form-actions"><button type="submit" class="primary" ${saved.conflicted?'disabled':''}>Import selected equipment</button></div><div data-form-error class="field-error" role="alert" hidden></div></form><form data-form="inventory-repreview" class="section-gap"><button type="submit">Preview this file again</button><div data-form-error class="field-error" role="alert" hidden></div></form>`}</section>`;
}
async function previewInventoryFile(fileName,text,characterId,generation) {
  const preview=await api(`/characters/${encodeURIComponent(characterId)}/inventory/preview`,{method:'POST',body:{fileName,text}});
  if(generation!==state.generation||!canEditEquipment(state.equipment)||state.equipment.character.id!==characterId)return;
  state.inventoryCharacterId=characterId;state.inventoryPreview={characterId,fileName,text,preview,conflicted:false};state.inventoryResult=null;
  const target=$('#inventory-preview');if(target){target.hidden=false;target.innerHTML=inventoryPreviewPanel(state.inventoryPreview);$('#inventory-preview-heading',target)?.focus({preventScroll:true});}
}

function equipmentPanel(data) {
  data = {...data,canEdit:canEditEquipment(data)};
  const character = data.character;
  const classCode = classChoices.find(([,name]) => name === character.className)?.[0] || 'EQ';
  return `<section class="panel equipment-panel"><div class="panel-head"><div><h2>Character equipment</h2><p>${data.canEdit ? 'Select a slot to add confirmed loot or a saved item reference.' : 'Equipment references recorded for this character.'}</p></div><span class="tag">${data.slots.filter(slot => slot.itemId !== null).length} / ${data.slots.length} slots</span></div><p class="small muted">A profile reference records your gear; it does not award loot or change DKP. Review class and slot requirements in item details; the partial cache does not enforce them. No total stats are inferred.</p><div class="equipment-board" aria-label="Equipment for ${escape(character.name)}"><div class="equipment-identity"><div class="class-sigil" aria-hidden="true">${escape(classCode)}</div><strong>${escape(character.name)}</strong><span>${escape(character.className)}</span><small>Character overview</small></div>${data.slots.map(slot => `<div class="gear-slot gear-${escape(slot.key)}"><span class="gear-label">${escape(slot.label)}</span>${slot.itemId !== null ? `${itemTrigger(slot.itemId, slot.itemName || `Item ${slot.itemId}`)}${installedAugments(slot.augments,true)}<span class="gear-source">${slot.source === 'award' ? 'Confirmed loot won' : 'Reference added by member'}</span>${data.canEdit ? `<button type="button" class="gear-change" data-action="gear-open" data-slot="${escape(slot.key)}" aria-label="Change ${escape(slot.label)} equipment">Change</button>` : ''}` : data.canEdit ? `<button type="button" class="gear-empty" data-action="gear-open" data-slot="${escape(slot.key)}" aria-label="Select an item for ${escape(slot.label)}">+<span>Choose item</span></button>` : '<span class="gear-empty-readonly">Empty slot</span>'}</div>`).join('')}</div><div id="equipment-picker" hidden></div></section>`;
}
async function renderEquipmentPicker(focusSearch = false) {
  const picker = state.gearPicker, equipment = state.equipment, generation = state.generation;
  const target = $('#equipment-picker');
  if (!picker || !canEditEquipment(equipment) || !target) return;
  const slot = equipment.slots.find(row => row.key === picker.slotKey); if (!slot) return;
  const version = ++picker.version;
  target.hidden = false;
  target.innerHTML = '<p role="status" class="section-gap">Loading equipment choices...</p>';
  try {
    const data = picker.tab === 'reference' ? await api(`/characters/${encodeURIComponent(equipment.character.id)}/equipment/references?${new URLSearchParams({q:picker.query,limit:'50'})}`) : null;
    if (state.gearPicker !== picker || generation !== state.generation || version !== picker.version || !target.isConnected) return;
    const choices = picker.tab === 'won' ? [...new Map(state.equipmentLoot.map(entry => [entry.itemId,{itemId:entry.itemId,name:entry.itemName}])).values()] : data.items;
    target.innerHTML = `<section class="gear-picker" aria-labelledby="gear-picker-heading"><div class="panel-head"><div><h3 id="gear-picker-heading" tabindex="-1">Choose ${escape(slot.label)}</h3><p>Current: ${escape(slot.itemName || 'Empty slot')}</p></div><button type="button" data-action="gear-close">Close choices</button></div><nav class="character-tabs" aria-label="Equipment item source"><button type="button" data-action="gear-tab" data-tab="won" aria-current="${picker.tab === 'won' ? 'page' : 'false'}">Confirmed loot won</button><button type="button" data-action="gear-tab" data-tab="reference" aria-current="${picker.tab === 'reference' ? 'page' : 'false'}">Saved references</button></nav>${picker.tab === 'reference' ? `<form data-form="gear-search" class="gear-search"><label>Search saved item names or exact IDs<input name="q" type="search" maxlength="120" value="${escape(picker.query)}" placeholder="Item name or EQ item ID"></label><button type="submit">Search catalog</button><div data-form-error class="field-error" role="alert" hidden></div></form><p class="small muted">Reference items are not proof of loot won. An officer can add missing EQResource references in Item references.</p>` : '<p class="small muted">Only confirmed awards for this character are listed. Pending awards and open sealed bids are excluded.</p>'}${choices.length ? table(['Item','Source','Select'], choices.map(item => `<tr><td>${itemTrigger(item.itemId,item.name || `Item ${item.itemId}`)}</td><td>${picker.tab === 'won' ? 'Confirmed loot won' : 'Reference added by member'}</td><td><button type="button" data-action="gear-select" data-item="${escape(item.itemId)}">Use in ${escape(slot.label)}</button></td></tr>`),true) : empty('No matching items',picker.tab === 'won' ? 'Use Saved references to record an item that is not in confirmed loot history.' : 'Try another saved name or exact ID. This is a partial item cache.')}<div id="gear-picker-error" class="field-error section-gap" role="alert" tabindex="-1" hidden></div>${slot.itemId !== null ? '<button type="button" class="section-gap" data-action="gear-clear">Clear this slot</button>' : ''}</section>`;
    $(focusSearch ? 'input[name="q"]' : '#gear-picker-heading',target)?.focus({preventScroll:true});
  } catch (error) {
    if (!error.silent && state.gearPicker === picker && generation === state.generation && version === picker.version && target.isConnected) target.innerHTML = `<div class="notice error" role="alert">${escape(error.message)}</div><button type="button" data-action="gear-tab" data-tab="${escape(picker.tab)}">Retry choices</button><button type="button" data-action="gear-close">Close choices</button>`;
  }
}
async function saveEquipmentChoice(itemId, button) {
  const picker = state.gearPicker, equipment = state.equipment, generation = state.generation;
  if (!picker || !canEditEquipment(equipment) || picker.busy) return;
  picker.busy = true;
  const controls = [...$('#equipment-picker').querySelectorAll('button,input')]; controls.forEach(control => {control.disabled = true;});
  try {
    await api(`/characters/${encodeURIComponent(equipment.character.id)}/equipment/${encodeURIComponent(picker.slotKey)}`,{method:'PUT',body:{itemId,expectedItemId:picker.expectedItemId}});
    if (state.gearPicker !== picker || generation !== state.generation) return;
    flash('Equipment reference saved. Loot awards and DKP are unchanged.');
    const page = state.page, id = page === 'dashboard' ? null : page === 'mains' ? state.mainReportId : state.profileId;
    await navigate(page,id);
    $(`[data-action="gear-open"][data-slot="${picker.slotKey}"]`)?.focus({preventScroll:true});
  } catch (error) {
    if (error.silent || state.gearPicker !== picker || generation !== state.generation) return;
    if (error.status === 409) {
      const page = state.page, id = page === 'dashboard' ? null : page === 'mains' ? state.mainReportId : state.profileId;
      await navigate(page,id); flash(`${error.message} The latest equipment is now loaded. Choose the slot again.`,true);
    } else { const output = $('#gear-picker-error'); if (output) {output.textContent = error.message; output.hidden = false; output.focus?.();} }
  } finally { picker.busy = false; controls.forEach(control => {if(control.isConnected)control.disabled = false;}); }
}

function mainLootSection(loot) {
  return `<section class="panel"><div class="panel-head"><div><h2>Loot won</h2><p>Winning bids and award charges from settled auctions. Open sealed bids are not listed.</p></div><span class="tag">${escape(number(loot.length))} awards</span></div>${loot.length ? table(['Item', 'Winning bid', 'DKP charged', 'Award status', 'Date'], loot.map(entry => `<tr><td>${itemTrigger(entry.itemId, entry.itemName)}</td><td class="amount">${escape(number(entry.winningBid))} DKP</td><td class="amount">${entry.status === 'confirmed' ? `${escape(number(entry.price))} DKP` : `<span class="muted">Pending confirmation<br>${escape(number(entry.price))} DKP proposed</span>`}</td><td><span class="tag">${escape(entry.status)}</span></td><td>${escape(date(entry.confirmedAt || entry.closedAt))}</td></tr>`)) : empty('No loot awards yet', 'Won items will appear here after an auction settles. Click an item to see its details, guild appearances and previous bids.')}</section>`;
}
function itemTrigger(itemId, label) {
  return `<button type="button" class="item-link" data-action="item-detail" data-item="${escape(itemId)}" data-item-preview="${escape(itemId)}" aria-haspopup="dialog">${escape(label)}</button>`;
}
function safeItemImage(value) {
  if(typeof value!=='string'||!value)return null;
  try {const url=new URL(value,window.location.origin);return ['http:','https:'].includes(url.protocol)&&url.origin===window.location.origin&&!url.username&&!url.password&&/\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(url.pathname)?url.href:null;}catch{return null;}
}
function itemValue(value) {
  if (value === null || value === undefined) return 'Unknown';
  if (typeof value === 'object') return Array.isArray(value) ? value.map(itemValue).join('\n') : Object.entries(value).map(([key, field]) => `${key}: ${itemValue(field)}`).join('\n');
  return String(value);
}
function isZeroItemValue(value) {
  return typeof value==='number'?value===0:typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))&&Number(value)===0;
}
function isTechnicalEffectField(label) {
  const key=String(label || '').replace(/[^a-z0-9]/gi,'');
  return /^(?:click|worn|focus|proc|effect|scroll|bard|mount|blessing|familiar)/i.test(key)||/^spell(?:id|effect|type|level|unk|name)/i.test(key);
}
function isUnknownItemField(label) {
  return /^(?:unk|unknown)/i.test(String(label || '').replace(/[^a-z0-9]/gi,''))||/(?:^|[_\s-])unk(?:nown)?(?:[_\s-]|\d|$)/i.test(String(label || ''));
}
function friendlyEffectName(value) {
  if(typeof value!=='string')return null;
  const name=value.trim().replace(/\s*\((?=[^)]*\b(?:cast(?:ing)?\s*time|level|type|charges?)\s*:)[^)]*\)\s*$/i,'').trim();
  if(!name||Number.isFinite(Number(name))||/^(?:unknown|unresolved|none|n\/a|null)$/i.test(name)||/^(?:spell|effect)(?:\s*(?:id|#))?\s*[:#]?\s*\d+\b/i.test(name)||/\b(?:click|worn|focus|proc)?(?:type|level\d*|unk\d*|rate)\s*[:=]/i.test(name))return null;
  return name;
}
function itemEffects(details) {
  const records=Array.isArray(details.effectRecords)?details.effectRecords:[],known=[],seen=new Set();let unresolved=false;
  const add=(kind,value)=>{if(!['click','worn','focus'].includes(kind))return;const name=friendlyEffectName(value);if(!name){unresolved=true;return;}const label=kind[0].toUpperCase()+kind.slice(1),key=`${kind}:${name.toLowerCase()}`;if(!seen.has(key)){seen.add(key);known.push({label,name});}};
  if(records.length)records.forEach(record=>{if(record&&typeof record==='object')add(String(record.kind || '').toLowerCase(),friendlyEffectName(record.name) || record.resolvedName || record.name);});
  else if(Array.isArray(details.effects))details.effects.forEach(value=>{if(typeof value!=='string')return;const match=/^\s*(click|worn|focus)(?:\s+effect)?\s*:\s*(.*?)\s*$/i.exec(value);if(match)add(match[1].toLowerCase(),match[2]);});
  return {known,unresolved};
}
function itemStatSections(stats) {
  const entries=Object.entries(stats || {}).filter(([key,value])=>!isZeroItemValue(value)&&!isTechnicalEffectField(key)), normalized=key=>key.replace(/[^a-z0-9]/gi,'').toLowerCase();
  const labels={ac:'AC',hp:'HP',mana:'MANA',endurance:'END',requiredlevel:'Required level',recommendedlevel:'Recommended level',strength:'STR',stamina:'STA',agility:'AGI',dexterity:'DEX',wisdom:'WIS',intelligence:'INT',charisma:'CHA',magicresist:'MAGIC',fireresist:'FIRE',coldresist:'COLD',diseaseresist:'DISEASE',poisonresist:'POISON',corruptionresist:'CORRUPTION',hpregen:'HP regen',manaregen:'Mana regen',enduranceregen:'Endurance regen',healamount:'Heal amount',spelldamage:'Spell damage',clairvoyance:'Clairvoyance',attack:'Attack'};
  Object.assign(labels,Object.fromEntries([['strength','STR'],['stamina','STA'],['agility','AGI'],['dexterity','DEX'],['wisdom','WIS'],['intelligence','INT'],['charisma','CHA']].map(([key,label])=>[`heroic${key}`,`Heroic ${label}`])));
  const used=new Set(), group=(title,keys,css='')=>{const rows=keys.flatMap(wanted=>entries.filter(([key])=>normalized(key)===wanted));rows.forEach(([key])=>used.add(key));return rows.length?`<section class="eq-stat-section ${css}">${title?`<h4>${title}</h4>`:''}<dl class="eq-stats">${rows.map(([key,value])=>`<div><dt>${escape(labels[normalized(key)] || key.replace(/([a-z])([A-Z])/g,'$1 $2'))}:</dt><dd>${escape(itemValue(value))}</dd></div>`).join('')}</dl></section>`:''};
  const primary=group('', ['ac','hp','mana','endurance'],'eq-primary-stats'), levels=group('', ['requiredlevel','recommendedlevel'],'eq-level-stats');
  const attributes=group('Attributes',['strength','stamina','agility','dexterity','wisdom','intelligence','charisma'].flatMap(key=>[key,`heroic${key}`]));
  const resistances=group('Resistances',['magicresist','fireresist','coldresist','diseaseresist','poisonresist','corruptionresist']);
  const combat=group('Combat and recovery',['hpregen','regen','regeneration','manaregen','enduranceregen','healamount','healing','spelldamage','spelldmg','clairvoyance','attack']);
  const extra=entries.filter(([key])=>!used.has(key)&&!/weight|tribute/i.test(key));
  return primary+levels+attributes+resistances+combat+(extra.length?`<section class="eq-stat-section"><h4>Other recorded stats</h4><dl class="eq-stats">${extra.map(([key,value])=>`<div><dt>${escape(key.replace(/([a-z])([A-Z])/g,'$1 $2'))}:</dt><dd>${escape(itemValue(value))}</dd></div>`).join('')}</dl></section>`:'');
}
function itemMetadata(item, compact = false) {
  const image = safeItemImage(item.iconUrl), details = item.details || {};
  const fields = Array.isArray(details.fields) ? details.fields : [];
  const stats = item.stats && typeof item.stats === 'object' ? Object.entries(item.stats) : [];
  const effects = itemEffects(details);
  const augments = Array.isArray(details.augments) ? details.augments : [];
  const sourceFields=fields.filter(field=>!isZeroItemValue(field.value)&&!isTechnicalEffectField(field.label)&&!isUnknownItemField(field.label)&&!/^(?:class|race|slot|flags?)$/i.test(field.label || ''));
  return `<article class="eq-pane"><header class="eq-item-heading">${image ? `<img class="eq-item-icon" src="${escape(image)}" alt="Item icon for ${escape(item.name || `item ${item.itemId}`)}" loading="lazy" referrerpolicy="no-referrer">` : ''}<div><h${compact ? '3' : '2'}>${escape(item.name || `Item ${item.itemId}`)}</h${compact ? '3' : '2'}><p class="eq-item-id">EQ item ${escape(item.itemId)}</p></div></header><p class="eq-flags">${escape(metadataList(item.flags))}</p><dl class="eq-eligibility"><div><dt>Slot:</dt><dd>${escape(metadataList(item.slots))}</dd></div><div><dt>Class:</dt><dd>${escape(metadataList(item.classes))}</dd></div><div><dt>Race:</dt><dd>${escape(metadataList(item.races))}</dd></div></dl>${stats.length ? itemStatSections(item.stats) : '<p class="eq-missing">Recorded stats are not available. Unknown values are not assumed to be zero.</p>'}${effects.known.length ? `<section class="eq-effects"><h4>Effects</h4>${effects.known.map(effect=>`<p><span class="eq-effect-kind">${escape(effect.label)}:</span> ${escape(effect.name)}</p>`).join('')}</section>` : ''}${effects.unresolved?'<p class="eq-missing">Effect name unavailable in current reference.</p>':''}${augments.length ? `<section class="eq-augments"><h4>Augment slots</h4>${augments.map(value => `<p>${escape(itemValue(value))}</p>`).join('')}</section>` : ''}${details.lore ? `<p class="eq-lore">${escape(itemValue(details.lore))}</p>` : ''}${!compact && sourceFields.length ? `<details class="eq-source-fields"><summary>All available item fields</summary><dl>${sourceFields.map(field => `<div><dt>${escape(field.label)}</dt><dd>${escape(itemValue(field.value))}</dd></div>`).join('')}</dl></details>` : ''}</article>${item.sourceStatus?.message ? `<p class="small muted section-gap">${escape(item.sourceStatus.message)}</p>` : ''}${!item.metadataComplete ? '<p class="small muted section-gap">Partial item cache. Missing fields and effects are not inferred; use EQResource to verify the original item.</p>' : ''}<div class="under-line">${sourceLink(item)}${compact ? `<button type="button" data-action="item-detail" data-item="${escape(item.itemId)}">Full item details and loot history</button>` : ''}</div>${!compact && item.advancedLoot ? `<div class="reference-block section-gap"><strong>Advanced Loot reference</strong><p class="loot-reference">${escape(item.advancedLoot)}</p></div>` : ''}${!compact ? `<dl class="item-facts section-gap"><div><dt>Source checked</dt><dd>${escape(item.sourceCheckedAt || 'Not provided')}</dd></div><div><dt>Source updated</dt><dd>${escape(item.sourceUpdatedAt || 'Not provided')}</dd></div><div><dt>Metadata retrieved</dt><dd>${escape(date(item.retrievedAt))}</dd></div><div><dt>Verification</dt><dd>${escape(item.verificationMethod || 'Unknown')}</dd></div></dl>` : ''}`;
}
async function cachedItemDetails(itemId, force = false) {
  const key = `${state.sessionEpoch}:${itemId}`;
  if (!force && itemDetailsCache.has(key)) return itemDetailsCache.get(key);
  const pending = api(`/items/${encodeURIComponent(itemId)}`).then(data => data.item);
  itemDetailsCache.set(key, pending);
  try { return await pending; } catch (error) { if (itemDetailsCache.get(key) === pending) itemDetailsCache.delete(key); throw error; }
}
function closeItemPreview() {
  clearTimeout(itemPreviewTimer); itemPreviewTimer = null; itemSurfaceVersion++; itemPreviewAnchor = null;
  const panel = $('#item-preview'); if (panel) { panel.hidden = true; panel.replaceChildren(); }
}
function closeItemSurfaces() { itemDialogVersion++; const dialog = $('#item-dialog'); if (dialog?.open) dialog.close(); closeItemPreview(); }
function positionItemPreview() {
  const panel = $('#item-preview'); if (!itemPreviewAnchor?.isConnected || panel.hidden) return;
  const rect = itemPreviewAnchor.getBoundingClientRect();
  const width = Math.min(430, window.innerWidth - 24);
  panel.style.width = `${width}px`;
  panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
  const height = Math.min(panel.offsetHeight, window.innerHeight - 32);
  panel.style.top = `${Math.max(12, rect.bottom + height + 12 <= window.innerHeight ? rect.bottom + 8 : rect.top - height - 8)}px`;
}
async function showItemPreview(anchor) {
  clearTimeout(itemPreviewTimer);
  if ($('#item-dialog').open || itemPreviewAnchor === anchor) return;
  const itemId = Number(anchor.dataset.itemPreview); if (!Number.isSafeInteger(itemId) || itemId < 1 || !state.user) return;
  const version = ++itemSurfaceVersion, epoch = state.sessionEpoch;
  itemPreviewAnchor = anchor; const panel = $('#item-preview'); panel.innerHTML = '<p role="status">Loading cached item details...</p>'; panel.hidden = false; positionItemPreview();
  try {
    const item = await cachedItemDetails(itemId);
    if (version !== itemSurfaceVersion || epoch !== state.sessionEpoch) return;
    if (!anchor.isConnected) { closeItemPreview(); return; }
    panel.innerHTML = itemMetadata(item, true); applyAccessControls(panel); positionItemPreview();
  } catch (error) { if (!error.silent && version === itemSurfaceVersion) { panel.innerHTML = `<p>${escape(error.message)}</p>${sourceLink({ sourceUrl: `https://items.eqresource.com/items.php?id=${itemId}` })}`; positionItemPreview(); } }
}
async function openItemDetails(itemId) {
  if (!Number.isSafeInteger(itemId) || itemId < 1) return;
  closeItemPreview(); const dialog = $('#item-dialog'), target = $('#item-dialog-content');
  const version = ++itemDialogVersion, epoch = state.sessionEpoch;
  dialog.dataset.item = String(itemId); $('#item-dialog-title').textContent = 'Item details'; target.innerHTML = '<p role="status">Loading full cached item details and guild loot history...</p>';
  if (!dialog.open) dialog.showModal();
  try {
    const [item, historyResult] = await Promise.all([cachedItemDetails(itemId), api(`/loot/items/${encodeURIComponent(itemId)}/history`).then(data => ({ data })).catch(error => ({ error }))]);
    if (version !== itemDialogVersion || epoch !== state.sessionEpoch || !dialog.open || dialog.dataset.item !== String(itemId)) return;
    $('#item-dialog-title').textContent = item.name || `Item ${itemId}`;
    target.innerHTML = `<section class="panel">${itemMetadata(item)}</section><div id="item-loot-history">${historyResult.data ? itemLootHistory(historyResult.data) : `<section class="panel"><h2>Guild loot history</h2><p class="small muted">${escape(historyResult.error?.message || 'History could not be loaded.')}</p></section>`}</div>`;
      applyAccessControls(target);
  } catch (error) { if (!error.silent && version === itemDialogVersion && dialog.open) target.innerHTML = `<div class="notice error" role="alert">${escape(error.message)}</div>${sourceLink({ sourceUrl: `https://items.eqresource.com/items.php?id=${itemId}` })}`; }
}
function itemLootHistory(data) {
  const appearances = data.appearances || [], auctions = data.auctions || [];
  return `<section class="panel"><div class="panel-head"><div><h2>Guild loot history</h2><p>${escape(number(data.appearanceCount))} published appearances | ${escape(number(data.totalQuantity))} total copies</p></div></div>${appearances.length ? table(['Boss / raid', 'Copies', 'Published', 'Auction'], appearances.map(row => `<tr><td>${escape(row.bossName)}<span class="muted">${escape(row.raidName || 'No raid linked')}</span></td><td class="amount">${escape(number(row.quantity))}</td><td>${escape(date(row.publishedAt))}</td><td><button type="button" data-action="open-auction" data-auction="${escape(row.auctionId)}">View auction</button></td></tr>`)) : empty('No published boss loot yet', 'Drafts do not count as guild loot appearances.')}</section><section class="panel"><h2>Previous bids and awards</h2><p class="small muted section-gap">Live sealed bid amounts and awards remain hidden from everyone until final results are available.</p>${auctions.length ? auctions.map(auction => {
    const closed = auction.status === 'closed' && auction.resultsReady === true;
    const bids = closed && Array.isArray(auction.bids) ? auction.bids : [];
    const awards = closed && Array.isArray(auction.awards) ? auction.awards : [];
    return `<article class="history-auction"><div class="panel-head"><div><h3>${escape(auction.itemName)}</h3><p>${escape(number(auction.quantity))} copies | Deadline ${escape(date(auction.closesAt))}</p></div><button type="button" data-action="open-auction" data-auction="${escape(auction.id)}">Open auction</button></div>${!closed ? '<p class="small muted">Sealed or awaiting final results. Bids and awards are hidden.</p>' : `${bids.length ? table(['Bidder / member', 'Bid', 'Eligibility'], bids.map(bid => `<tr><td>${escape(bid.characterName)}<span class="muted">${escape(bid.userName)}</span></td><td class="amount">${escape(number(bid.amount))} DKP</td><td>${bid.eligible ? 'Eligible' : 'Ineligible'}</td></tr>`)) : '<p class="small muted">No bids recorded.</p>'}<h4 class="section-gap">Awards</h4>${awards.length ? table(['Recipient / member', 'Price', 'Status'], awards.map(award => `<tr><td>${escape(award.characterName)}<span class="muted">${escape(award.userName)}</span></td><td class="amount">${escape(number(award.price))} DKP</td><td>${escape(award.status)}</td></tr>`)) : '<p class="small muted">No awards recorded.</p>'}`}</article>`;
  }).join('') : '<p class="small muted section-gap">No auctions recorded for this item.</p>'}</section>`;
}
function lootTabs() {
  return `<nav class="character-tabs" aria-label="Boss loot views"><button type="button" data-action="loot-drafts" ${state.lootTab==='drafts'?'aria-current="page"':''}>Boss drafts</button><button type="button" data-action="raid-loot-imports" ${state.lootTab==='raid-import'?'aria-current="page"':''}>Raid-night import</button></nav>`;
}
function raidLootWarnings(warnings=[]) {return warnings.length?`<div class="notice warning section-gap"><h3>Review import warnings</h3><ul>${warnings.map(warning=>`<li>${escape(itemValue(warning))}</li>`).join('')}</ul></div>`:'';}
function raidLootEventTable(data,preview=false) {
  const events=data.events || [],size=100,page=Math.min(state.raidLootEventPage,Math.max(0,Math.ceil(events.length/size)-1)),offset=page*size;
  const rows=events.slice(offset,offset+size).map(event=>{
    const group=(data.groups || []).find(group=>event.groupId&&group.id===event.groupId || event.groupKey&&group.key===event.groupKey),editable=!preview&&!event.handoffGroupId&&!event.preparedDraftId&&Number.isSafeInteger(event.revision)&&can('loot','write')&&(group?group.status==='review':(data.groups || []).every(row=>row.status==='review'));
    return `<tr tabindex="-1" data-raid-loot-event="${escape(event.id)}"><td>${escape(event.itemName)}</td><td class="amount">${escape(number(event.quantity))}</td><td>${escape(event.holder || 'Not recorded')}</td><td>${escape(event.bossName || 'Needs boss context')}</td><td>${escape(event.observedAt || event.timeText || 'Not recorded')}</td><td><span class="tag ${event.excluded?'warning':''}">${event.excluded?'Excluded':'Included'}</span>${event.exclusionReason?`<span class="muted">${escape(event.exclusionReason)}</span>`:''}${event.alreadyImported?'<span class="muted">Previously imported</span>':''}${event.possibleOverlap?'<span class="warning-text">Possible overlap</span>':''}</td><td>${event.preparedDraftId?`<button type="button" data-action="open-loot-draft" data-draft="${escape(event.preparedDraftId)}">Open prepared boss draft</button>`:editable?`<details><summary>${event.excluded?'Restore row':'Exclude row'}</summary><form data-form="exclude-raid-loot" data-import="${escape(data.id)}" data-event="${escape(event.id)}" data-excluded="${event.excluded?'false':'true'}" data-revision="${escape(event.revision)}" class="section-gap"><label>Reason<textarea name="reason" minlength="3" maxlength="1000" rows="2" required></textarea></label><button type="submit" class="section-gap">${event.excluded?'Restore included row':'Exclude from boss loot'}</button><div data-form-error class="field-error" role="alert" hidden></div></form></details>`:''}</td></tr>`;
  });
  return `${events.length?table(['Item','Qty','Holding looter','Boss','Time as recorded','State','Action'],rows,true):empty('No loot rows','Review the selected format, filters and date window.')}<div class="form-actions"><button type="button" data-action="raid-loot-page" data-page="${Math.max(0,page-1)}" ${page===0?'disabled':''}>Previous rows</button><span class="small muted">${events.length?`${number(offset+1)} - ${number(Math.min(offset+size,events.length))} of ${number(events.length)}`:'0 rows'}</span><button type="button" data-action="raid-loot-page" data-page="${page+1}" ${offset+size>=events.length?'disabled':''}>Next rows</button></div>`;
}
function raidLootPreviewPanel(preview) {
  return `<section class="panel" aria-labelledby="raid-loot-preview-heading"><h2 id="raid-loot-preview-heading" tabindex="-1">Review raid-night loot</h2><p class="small muted section-gap">${escape(preview.fileName)} | Raid date ${escape(date(preview.raidDate))}</p><div class="capture-counts section-gap"><span><strong>${escape(number(preview.eventCount))}</strong> source events</span><span><strong>${escape(number(preview.totalQuantity))}</strong> item copies</span><span><strong>${escape(number(preview.newCount))}</strong> new events</span><span><strong>${escape(number(preview.duplicateCount))}</strong> duplicate events</span></div>${raidLootWarnings(preview.warnings)}<h3 class="section-gap">Boss groups</h3>${table(['Boss','Events','Included','Copies'],(preview.groups || []).map(group=>`<tr><td>${escape(group.bossName || 'Needs boss context')}</td><td>${escape(number(group.eventCount))}</td><td>${escape(number(group.includedCount))}</td><td>${escape(number(group.totalQuantity))}</td></tr>`),true)}<h3 class="section-gap">Loot rows</h3><div id="raid-loot-events">${raidLootEventTable(preview,true)}</div><p class="small muted section-gap">Holding looters are item custodians, not auction winners. Saving the import does not publish auctions or change DKP.</p><form data-form="commit-raid-loot">${preview.possibleOverlapCount?`<label class="review-check section-gap"><input type="checkbox" name="confirmDistinctLegacy" required><span>I reviewed ${escape(number(preview.possibleOverlapCount))} possible overlaps. These are separate loot events, not another export of the same loot.</span></label>`:''}<label class="review-check section-gap"><input type="checkbox" name="reviewed" required><span>I reviewed the date, boss context, quantities, holding looters, exclusions and warnings.</span></label><div class="form-actions"><button type="submit" class="primary">Save reviewed raid-night import</button></div><div data-form-error class="field-error" role="alert" hidden></div></form></section>`;
}
async function raidLootImportsPage() {
  const [{imports},{raids}]=await Promise.all([api('/loot-imports'),api('/raid-options')]);
  return `<div id="raid-loot-workspace">${can('loot','write')?`<section class="panel"><h2>Import a raid night</h2><p class="small muted section-gap">Guild Desk tracker JSON preserves boss and time context. Legacy Excel TSV has no boss or time columns: use one boss context for that file; missing times stay unknown.</p><form data-form="preview-raid-loot" class="section-gap"><div class="form-grid"><label>Export format<select name="format" id="raid-loot-format"><option value="tracker-json">Guild Desk tracker JSON</option><option value="tracker-tsv">Excel TSV - Item / Qty / Looter (single boss)</option><option value="eq-log">EverQuest log text</option></select></label><label>Raid night<select name="raidId" id="raid-loot-raid"><option value="">No raid linked</option>${raids.map(raid=>`<option value="${escape(raid.id)}" data-date="${escape(raid.date)}">${escape(raid.name)} | ${escape(date(raid.date))}</option>`).join('')}</select></label><label>Raid date<input name="raidDate" type="date" required></label><label>Boss name for missing context<input name="bossName" maxlength="120" id="raid-loot-boss" placeholder="Required for legacy Excel TSV"></label><label class="full">Loot export or raid log<input name="raidFile" type="file" accept=".json,.tsv,.txt,.log,application/json,text/plain,text/tab-separated-values"><small>Up to 3 MiB and 5,000 loot events. Use the tracker export or selected log text for larger logs.</small></label><label class="full">Or paste export text<textarea name="text" rows="6" spellcheck="false"></textarea></label><label>Source label for pasted input<input name="sourceLabel" maxlength="240" placeholder="Optional label"></label></div><details class="section-gap"><summary>Filters and optional tracker settings</summary><div class="form-grid section-gap"><label class="full">Tracker settings (filters)<input name="settingsFile" id="raid-loot-settings" type="file" accept=".json,application/json"><small>Only my_character, looters and ignore_items are read. Local log paths and automatic monitoring settings stay on your computer.</small></label><button type="button" data-action="clear-raid-loot-settings">Clear settings file</button><label>Your in-game character<input name="myCharacter" maxlength="64" autocomplete="off"><small>Resolves You in log lines.</small></label><label>Allowed holding looters<textarea name="looters" rows="3" placeholder="One character per line"></textarea></label><label>Ignored item names<textarea name="ignoreItems" rows="3" placeholder="One full item name per line"></textarea></label><label>Start time (optional)<input name="startTime" type="time" step="1"></label><label>End time (optional)<input name="endTime" type="time" step="1"></label></div></details><div class="form-actions"><button type="submit" class="primary">Preview raid-night import</button></div><div data-form-error class="field-error" role="alert" hidden></div></form></section>`:''}<div id="raid-loot-preview"></div></div><section class="panel"><div class="panel-head"><h2>Saved raid-night imports</h2><button type="button" data-action="raid-loot-imports">Refresh imports</button></div>${imports.length?table(['Source','Raid date','Events','Review'],imports.map(entry=>`<tr><td>${escape(entry.fileName)}<span class="muted">${escape(entry.format || '')}</span></td><td>${escape(date(entry.raidDate))}</td><td>${escape(number(entry.eventCount))}</td><td><button type="button" data-action="open-raid-loot-import" data-import="${escape(entry.id)}">Review import</button></td></tr>`)):empty('No raid-night imports','Preview an export above, then save it for boss-by-boss review.')}</section>`;
}
async function raidLootImportPage(importId) {
  const generation=state.generation,{import:entry}=await api(`/loot-imports/${encodeURIComponent(importId)}`);if(generation===state.generation)state.raidLootImport=entry;
  return `<div id="raid-loot-workspace"><div class="toolbar"><button type="button" data-action="raid-loot-imports">Back to raid-night imports</button><button type="button" data-action="refresh-raid-loot-import" data-import="${escape(entry.id)}">Refresh import</button></div><section class="panel"><h2>${escape(entry.fileName)}</h2><p class="small muted section-gap">Raid date ${escape(date(entry.raidDate))}. Holding looters are custodians; no item awards or DKP changes are created by this import.</p>${raidLootWarnings(entry.warnings)}<h3 class="section-gap">Prepare each boss</h3>${(entry.groups || []).map(group=>`<section class="raid-loot-group section-gap"><div class="panel-head"><div><h3>${escape(group.bossName==='Unassigned source'?(group.status==='review'?'Boss context required':'Original source had no boss name'):group.bossName || 'Boss context required')}</h3><p>${escape(number(group.includedCount))} included events | ${escape(number(group.totalQuantity))} copies</p></div><span class="tag">${escape(group.status)}</span></div>${group.draftId?`<button type="button" data-action="open-loot-draft" data-draft="${escape(group.draftId)}">Review existing boss draft</button>`:can('loot','write')&&['review','preparing'].includes(group.status)?`<form data-form="prepare-raid-loot" data-import="${escape(entry.id)}" data-group="${escape(group.id)}" data-preparing="${group.status==='preparing'?'true':'false'}">${group.status==='preparing'?'<p class="small muted section-gap">Retry the frozen boss snapshot. Captured rows remain unchanged.</p>':`<label>Boss name<input name="bossName" maxlength="120" value="${escape(group.bossName==='Unassigned source'?'':group.bossName || '')}" placeholder="Enter the boss or source name" required></label>`}<div class="form-actions"><button type="submit" class="primary" ${Number(group.includedCount)<1?'disabled':''}>${group.status==='preparing'?'Retry boss draft preparation':'Prepare boss draft'}</button>${Number(group.includedCount)<1?'<span class="small muted">No included loot remains. Review excluded rows or existing draft links below.</span>':''}</div><div data-form-error class="field-error" role="alert" hidden></div></form>`:''}</section>`).join('')}<h3 class="section-gap">Imported loot rows</h3><div id="raid-loot-events">${raidLootEventTable(entry)}</div></section></div>`;
}
async function raidLootPayload(form,values) {
  const file=$('input[name="raidFile"]',form).files[0],pasted=String(values.text || '');if(file&&pasted.trim())throw new Error('Choose one source: a file or pasted text.');
  if(file&&file.size>3*1024*1024)throw new Error('Choose a text export no larger than 3 MiB.');
  const text=file?await file.text():pasted;if(!text.trim())throw new Error('Choose an export file or paste its text.');if(new TextEncoder().encode(text).byteLength>3*1024*1024)throw new Error('The source text exceeds 3 MiB.');
  try {const candidate=JSON.parse(text);if(candidate&&typeof candidate==='object'&&!Array.isArray(candidate)&&('log_path'in candidate||'auto_start_monitoring'in candidate||('my_character'in candidate&&'looters'in candidate&&'ignore_items'in candidate&&!Array.isArray(candidate.events))))throw new Error('Settings file has no loot events; choose a Guild Desk export, Excel export, or raid log.');}catch(error){if(error.message.startsWith('Settings file has no loot events'))throw error;}
  const list=value=>String(value || '').split(/\r?\n/).map(entry=>entry.trim()).filter(Boolean),settings=$('input[name="settingsFile"]',form).files[0];let mapped={};
  if(settings){if(settings.size>256*1024)throw new Error('Choose a tracker settings file no larger than 256 KiB.');let config;try{config=JSON.parse(await settings.text());}catch{throw new Error('Tracker settings must be valid JSON.');}if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('Tracker settings must contain a JSON object.');if('my_character'in config&&typeof config.my_character!=='string')throw new Error('my_character must be text.');for(const key of ['looters','ignore_items'])if(key in config&&(!Array.isArray(config[key])||config[key].some(value=>typeof value!=='string')))throw new Error(`${key} must be an array of names.`);mapped={myCharacter:config.my_character,looters:config.looters,ignoreItems:config.ignore_items};}
  const myCharacter=String(values.myCharacter || '').trim()||mapped.myCharacter||'',looters=String(values.looters || '').trim()?list(values.looters):mapped.looters||[],ignoreItems=String(values.ignoreItems || '').trim()?list(values.ignoreItems):mapped.ignoreItems||[];
  const body={format:values.format,fileName:file?.name||String(values.sourceLabel || '').trim()||`Pasted ${values.format}`,text,raidId:values.raidId||null,raidDate:values.raidDate,myCharacter,looters,ignoreItems};
  if(String(values.bossName || '').trim())body.bossName=String(values.bossName).trim();if(values.startTime)body.startTime=values.startTime.length===5?values.startTime+':00':values.startTime;if(values.endTime)body.endTime=values.endTime.length===5?values.endTime+':00':values.endTime;
  if(body.format==='tracker-tsv'&&!body.bossName)throw new Error('Legacy Excel TSV needs an explicit boss name.');
  $('[name="myCharacter"]',form).value=myCharacter;$('[name="looters"]',form).value=looters.join('\n');$('[name="ignoreItems"]',form).value=ignoreItems.join('\n');return body;
}
function clearRaidLootPreview() {state.raidLootPreview=null;state.raidLootEventPage=0;const target=$('#raid-loot-preview');if(target)target.replaceChildren();}

async function lootDraftsPage() {
  const [{ drafts }, { raids }] = await Promise.all([api('/loot/drafts'), api('/raid-options')]);
  return `<section class="panel"><div class="panel-head"><div><h2>Prepare a boss loot batch</h2><p>Save the original loot text, resolve item IDs, and review the full batch before publishing.</p></div></div><form data-form="create-loot"><div class="form-grid"><label>Boss name<input name="bossName" maxlength="120" required placeholder="Boss defeated"></label><label>Raid night<select name="raidId"><option value="">No raid linked</option>${raids.map(raid => `<option value="${escape(raid.id)}">${escape(raid.name)} | ${escape(date(raid.date))}</option>`).join('')}</select></label><label class="full">Input format<select name="format"><option value="names">Item names / Advanced Loot references</option><option value="log">EverQuest log text (review unknown lines)</option></select><small>Names: one item per line; quantities such as 2 x Item Name or Item Name (x2). Advanced Loot IDs and EQResource links are accepted. Log parsing recognizes direct Advanced Loot references; other log lines require review.</small></label><label class="full">Paste loot text<textarea name="text" rows="8" placeholder="2 x Item Name&#10;Another Item Name"></textarea></label><label class="full">Or add text / log files<input name="files" type="file" accept=".txt,.log,text/plain" multiple><small>Paste, upload, or combine both. Up to 200 nonempty source lines and 1,000 pieces per batch; up to 50 copies of one item per auction.</small></label></div><div class="form-actions"><button type="submit" class="primary">Create loot draft</button></div><div data-form-error class="field-error" role="alert" hidden></div></form></section><section class="panel"><div class="panel-head"><h2>Boss loot batches</h2><span class="tag">${escape(number(drafts.length))} recent batches</span></div>${drafts.length ? table(['Boss / created', 'Pieces / item groups', 'Review', 'Status', 'Open'], drafts.map(draft => `<tr><td>${escape(draft.bossName)}<span class="muted">${escape(date(draft.createdAt))}</span></td><td>${escape(number(draft.totalPieces))} pieces<span class="muted">${escape(number(draft.itemCount))} groups</span></td><td>${escape(number(draft.unresolvedCount))} unresolved</td><td><span class="tag">${escape(draft.status)}</span></td><td><button type="button" data-action="open-loot-draft" data-draft="${escape(draft.id)}">${draft.status === 'published' ? 'View batch' : 'Review draft'}</button></td></tr>`)) : empty('No boss loot batches', 'Create a draft from the loot window names or an exported text file.')}</section>`;
}
async function lootDraftPage(id) {
  const { draft } = await api(`/loot/drafts/${encodeURIComponent(id)}`);
  return lootDraftView(draft);
}
function lootDraftView(draft) {
  const published = draft.status === 'published';
  const context = `data-draft="${escape(draft.id)}" data-revision="${escape(draft.revision)}"`;
  const unresolved = draft.items.filter(row => ['unmatched', 'ambiguous'].includes(row.matchStatus));
  return `<div class="toolbar"><button type="button" data-nav="loot">Back to boss loot batches</button><button type="button" data-action="refresh-loot-draft" data-draft="${escape(draft.id)}">Refresh draft</button></div><div id="loot-workspace"><section class="panel"><div class="panel-head"><div><h2>${escape(draft.bossName)}</h2><p>${escape(number(draft.totalPieces))} pieces | ${escape(number(draft.itemCount))} item groups | Revision ${escape(draft.revision)}</p></div><span class="tag">${escape(draft.status)}</span></div>${draft.warnings.length ? `<div class="notice warning"><strong>Import review</strong><ul>${draft.warnings.map(warning => `<li>${escape(warning)}</li>`).join('')}</ul></div>` : ''}${published ? `<div class="notice"><strong>Batch published</strong><p>${escape(date(draft.publishedAt))}. Each auction shares one 24-hour bidding window. Award confirmation deducts DKP.</p></div>` : `<div class="notice"><strong>${escape(number(draft.unresolvedCount))} item groups need review</strong><p>Match names against the uploaded catalog and confirm ambiguous or manual IDs.</p></div><form data-form="match-loot" ${context}><div class="form-actions"><button type="submit" ${unresolved.length ? '' : 'disabled'}>Search first ${Math.min(10, unresolved.length)} unresolved names</button><span class="small muted">Up to 10 names per search. No auctions are published.</span></div><div data-form-error class="field-error" role="alert" hidden></div></form>`}</section><div class="loot-rows">${draft.items.map(row => lootDraftRow(row, draft)).join('')}</div>${!published ? `<section class="panel"><h2>Manager review and publication</h2><p class="small muted section-gap">All included item groups must be resolved. Publishing creates the entire boss batch together, with sealed bidding for 24 hours. No DKP is reserved or deducted.</p><form data-form="publish-loot" ${context}><label class="review-check section-gap"><input type="checkbox" name="reviewed" required ${draft.readyToPublish ? '' : 'disabled'}><span>I reviewed the item names, EQ item IDs, quantities, and ignored lines for this boss.</span></label><div class="form-actions"><button type="submit" class="primary" ${draft.readyToPublish ? '' : 'disabled'}>Publish all boss auctions for 24 hours</button>${!draft.readyToPublish ? '<span class="small negative">Resolve every included row before publishing.</span>' : ''}</div><div data-form-error class="field-error" role="alert" hidden></div></form></section>` : ''}<section class="panel"><h2>Original import sources</h2><p class="small muted section-gap">Original text is retained for review and audit. Edits to item groups do not alter this input.</p>${draft.sources.map(source => `<details class="source-block"><summary>${escape(source.name)} | ${escape(source.format)}</summary><pre class="source-item-text">${escape(source.text)}</pre></details>`).join('')}</section></div>`;
}
function lootDraftRow(row, draft) {
  const published = draft.status === 'published', ignored = row.matchStatus === 'ignored';
  const context = `data-draft="${escape(draft.id)}" data-revision="${escape(draft.revision)}" data-row="${escape(row.id)}"`;
  return `<article tabindex="-1" data-loot-row="${escape(row.id)}" class="panel loot-row ${ignored ? 'loot-ignored' : ''}"><div class="panel-head"><div><h3>${row.itemId ? itemTrigger(row.itemId, row.displayName || row.name) : escape(row.displayName || row.name)}</h3><p>${escape(number(row.quantity))} copies${row.itemId ? ` | EQ ID ${escape(row.itemId)}` : ' | No resolved EQ item ID'}</p></div><span class="tag ${['matched', 'manual_verified', 'ignored'].includes(row.matchStatus) ? '' : 'warning'}">${escape(row.matchStatus.replaceAll('_', ' '))}</span></div>${row.note ? `<p class="small muted">${escape(row.note)}</p>` : ''}${row.sourceUrl ? `<p class="small section-gap">${sourceLink(row)}</p>` : ''}${row.itemId && row.metadataStatus !== 'verified_reference' ? '<p class="small muted section-gap">Item ID is recorded; complete item metadata may still be unavailable.</p>' : ''}${!published ? `${['unmatched', 'ambiguous'].includes(row.matchStatus) ? `<form data-form="match-loot" ${context}><div class="form-actions"><button type="submit">Match name in item catalog</button></div><div data-form-error class="field-error" role="alert" hidden></div></form>` : ''}${row.candidates.length ? `<div class="candidate-list section-gap"><h4>Catalog matches</h4>${row.candidates.map(candidate => `<form data-form="resolve-loot-candidate" ${context} data-item="${escape(candidate.itemId)}"><div><strong>${escape(candidate.name)}</strong><span class="small muted">ID ${escape(candidate.itemId)} | ${escape(candidate.match)} match | ${sourceLink(candidate)}</span></div><button type="submit">Confirm this item</button><div data-form-error class="field-error full" role="alert" hidden></div></form>`).join('')}</div>` : ''}<details class="section-gap" ${['needs_review', 'ambiguous', 'unmatched'].includes(row.matchStatus) ? 'open' : ''}><summary>Review name, quantity, or manual item ID</summary><form data-form="edit-loot-row" ${context} class="form-grid section-gap"><label>Game item name<input name="name" maxlength="200" value="${escape(row.name)}" required></label><label>Copies<input name="quantity" type="number" min="1" max="50" step="1" value="${escape(row.quantity)}" required></label><label class="full">EQ item ID<input name="itemId" type="number" min="1" step="1" value="${escape(row.itemId || '')}" placeholder="Numeric ID from EQResource or Advanced Loot"><small>A manual ID is a manager-confirmed mapping. It does not claim verified item stats.</small></label><label class="review-check full"><input name="confirm" type="checkbox"><span>I reviewed and confirm this EQ item ID for the game item.</span></label><div class="form-actions full"><button type="submit">Save row review</button><button type="submit" formnovalidate name="ignore" value="${ignored ? 'false' : 'true'}">${ignored ? 'Restore included row' : 'Ignore non-loot line'}</button></div><div data-form-error class="field-error full" role="alert" hidden></div></form></details>` : row.auctionId ? `<div class="form-actions"><button type="button" data-action="open-auction" data-auction="${escape(row.auctionId)}">Open auction</button></div>` : ''}<details class="section-gap"><summary>Original source lines (${escape(number(row.rawLines.length))})</summary><ul class="raw-lines">${row.rawLines.map(line => `<li><span class="small muted">${escape(line.sourceName)}:${escape(line.lineNumber)}</span><code>${escape(line.text)}</code></li>`).join('')}</ul></details></article>`;
}
function clearCapturePairing() {
  clearTimeout(companionPairingTimer); companionPairingTimer=null;
  const devicePanel=$('#device-pairing'); if(devicePanel) {const link=$('a',devicePanel);link?.removeAttribute('href');devicePanel.remove();}
  const panel = $('#capture-pairing');
  if (!panel) return;
  const input = $('textarea', panel); if (input) input.value = '';
  panel.remove();
}
function captureCompanionInstructions() {
  return `<details class="section-gap"><summary>Companion setup help</summary><ol class="capture-instructions"><li>Run Start-Companion.cmd on the computer running EverQuest.</li><li>Connect this browser to the local companion, then choose your EverQuest log file once in its window.</li><li>Keep the companion open. Each new boss capture uses the same saved connection and log.</li></ol></details>`;
}
function activeCompanionDevices(devices) { return devices.filter(device=>device.status==='active'&&(!device.expiresAt||new Date(device.expiresAt).getTime()>Date.now())); }
function preferredCompanionDevice(devices,captureId=null) {
  const active=activeCompanionDevices(devices); let preferred=null;
  try {preferred=localStorage.getItem(`guild-desk:${state.user.id}:companion`);}catch{}
  return active.find(device=>captureId&&device.activeCaptureId===captureId)?.id || active.find(device=>device.id===preferred)?.id || active[0]?.id || '';
}
function rememberCompanionDevice(id) { try {localStorage.setItem(`guild-desk:${state.user.id}:companion`,id);}catch{} }
function companionSetupPanel(devices) {
  const active=activeCompanionDevices(devices);
  return `<section class="panel companion-setup"><div class="panel-head"><div><h2>Log companion</h2><p>${active.length?`${active.length} saved ${active.length===1?'companion':'companions'}`:'Connect your EverQuest computer once.'}</p></div><a class="button-link" href="http://127.0.0.1:4831/" target="_blank" rel="noopener noreferrer">Open companion</a></div>${active.length?'':`<p class="small muted">Run Start-Companion.cmd first, then connect below and choose your log file in the companion.</p>`}<details ${active.length?'':'open'} class="section-gap"><summary>Connect or manage a computer</summary><form data-form="connect-device" class="form-grid section-gap"><label>Computer label<input name="label" maxlength="80" value="My raid computer" required autocomplete="off"></label><button type="submit" class="primary">Connect companion</button><div data-form-error class="field-error full" role="alert" hidden></div></form>${devices.length?table(['Computer','Connection','Last seen','Action'],devices.map(device=>`<tr><td>${escape(device.label)}</td><td>${escape(device.status)}</td><td>${escape(date(device.lastSeenAt))}</td><td>${device.status!=='revoked'?`<form data-form="revoke-device" data-device="${escape(device.id)}"><button type="submit" class="quiet">Disconnect</button><div data-form-error class="field-error" role="alert" hidden></div></form>`:''}</td></tr>`),true):''}</details>${captureCompanionInstructions()}<div class="form-actions"><button type="button" data-nav="captures">Refresh connection status</button></div></section>`;
}
function companionReadiness(captureId,devices) {
  const assigned=activeCompanionDevices(devices).filter(device=>device.activeCaptureId===captureId);
  if(assigned.some(device=>{const age=Date.now()-new Date(device.lastSeenAt).getTime();return device.readyCaptureId===captureId&&Number.isFinite(age)&&age>=-5000&&age<=30000;}))return 'Watching abfloot. You can post the boss loot now.';
  return assigned.length?'Waiting for companion. Open it and wait for Watching before posting loot.':'Start this capture on a saved companion, then wait for Watching before posting loot.';
}
function stopCompanionPolling() { clearInterval(companionPollTimer); companionPollTimer=null; }
function startCompanionPolling() {
  stopCompanionPolling(); if(state.page!=='captures'||!state.captureId||state.captureStatus!=='open'||!can('captures','write'))return;
  const captureId=state.captureId,generation=state.generation;let pending=false;
  companionPollTimer=setInterval(async()=>{if(pending)return;pending=true;try {const {devices}=await api('/companion-devices');if(generation!==state.generation||state.page!=='captures'||state.captureId!==captureId)return;state.companionDevices=devices;const status=$('#capture-device-readiness');if(status)status.textContent=companionReadiness(captureId,devices);}catch(error){if(error.status===403)stopCompanionPolling();if(!error.silent&&generation===state.generation){const status=$('#capture-device-readiness');if(status)status.textContent='Companion status unavailable. Refresh before posting loot.';}}finally{pending=false;}},3000);
}

function captureDevicePanel(session,devices) {
  if(!can('captures','write'))return '';
  const selected=preferredCompanionDevice(devices,session.id), active=activeCompanionDevices(devices);
  return `<section class="panel"><h2>Capture on your computer</h2><p id="capture-device-readiness" class="companion-readiness section-gap" role="status">${escape(companionReadiness(session.id,devices))}</p>${active.length?`<form data-form="activate-device" data-capture="${escape(session.id)}" class="form-grid section-gap"><label>Connected companion<select name="deviceId" required>${active.map(device=>`<option value="${escape(device.id)}" ${device.id===selected?'selected':''}>${escape(device.label)}${device.activeCaptureId===session.id?' - this capture':''}</option>`).join('')}</select></label><button type="submit" class="primary">Start / resume capture</button><div data-form-error class="field-error full" role="alert" hidden></div></form>`:'<p class="small muted section-gap">Connect a companion from Live loot capture before starting this boss.</p>'}<a class="small" href="http://127.0.0.1:4831/" target="_blank" rel="noopener noreferrer">Open companion window</a></section>`;
}
function companionConnectUrl(pairing) {
  const site=new URL(pairing.siteUrl);
  if(!['http:','https:'].includes(site.protocol)||site.origin!==window.location.origin||site.username||site.password||typeof pairing.code!=='string'||!pairing.code||pairing.code.length>512)throw new Error('The companion connection response is invalid.');
  const bytes=new TextEncoder().encode(JSON.stringify({siteUrl:pairing.siteUrl,code:pairing.code}));
  const encoded=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return `http://127.0.0.1:4831/#connect=${encoded}`;
}
function showDevicePairing(pairing) {
  const href=companionConnectUrl(pairing); clearCapturePairing();
  $('#page-content').insertAdjacentHTML('afterbegin',`<section id="device-pairing" class="panel"><h2>Connect this computer</h2><p class="small muted section-gap">Start the companion, open this connection, and approve the request in its window. This link expires in 10 minutes.</p><div class="form-actions"><a id="device-pairing-link" class="button-link primary" href="${escape(href)}" target="_blank" rel="noopener noreferrer">Connect in companion</a><button type="button" data-action="hide-device-pairing">Hide connection link</button><button type="button" data-nav="captures">I connected - refresh status</button></div></section>`);
  $('#device-pairing-link').focus(); companionPairingTimer=setTimeout(()=>{clearCapturePairing();flash('The companion connection link expired. Connect again if needed.');},600000);
}
async function capturesPage() {
  const generation=state.generation;
  const [{sessions},{raids},{devices}] = await Promise.all([api('/captures'),api('/raid-options'),can('captures','write')?api('/companion-devices'):Promise.resolve({devices:[]})]);
  if(generation===state.generation)state.companionDevices=devices;
  const active=activeCompanionDevices(devices), selected=preferredCompanionDevice(devices);
  return `${can('captures','write')?companionSetupPanel(devices):''}<section class="panel"><div class="panel-head"><div><h2>New boss capture</h2><p>Link loot in abfloot while your companion is running.</p></div></div><form data-form="create-capture"><div class="form-grid"><label>Boss name<input name="bossName" maxlength="120" required placeholder="Boss defeated"></label><label>Connected companion<select name="deviceId"><option value="">Choose connected computer</option>${active.map(device=>`<option value="${escape(device.id)}" ${device.id===selected?'selected':''}>${escape(device.label)}</option>`).join('')}</select></label></div><details class="section-gap"><summary>Advanced capture options</summary><div class="form-grid section-gap"><label>Raid night<select name="raidId"><option value="">No raid linked</option>${raids.map(raid=>`<option value="${escape(raid.id)}">${escape(raid.name)} | ${escape(date(raid.date))}</option>`).join('')}</select></label><label>Channel<input name="channelName" value="abfloot" readonly></label><label>Allowed senders<input name="allowedSenders" maxlength="1000" placeholder="All channel participants" autocomplete="off" spellcheck="false"></label><label class="review-check"><input name="manualPairing" type="checkbox"><span>Use advanced manual pairing instead of a saved companion.</span></label></div></details><div class="form-actions"><button type="submit" class="primary">Start boss capture</button></div><div data-form-error class="field-error" role="alert" hidden></div></form></section><section class="panel"><div class="panel-head"><h2>Boss captures</h2><button type="button" data-nav="captures">Refresh captures</button></div>${sessions.length?table(['Boss / created','Loot','Warnings','Status','Review'],sessions.map(session=>`<tr><td>${escape(session.bossName)}<span class="muted">${escape(date(session.createdAt))}</span></td><td>${escape(number(session.itemCount))} pieces<span class="muted">${escape(number(session.eventCount))} messages</span></td><td>${escape(number(session.warningCount))}</td><td><span class="tag">${escape(session.status)}</span></td><td><button type="button" data-action="open-capture" data-capture="${escape(session.id)}">Review loot</button></td></tr>`)):empty('No boss captures','Connect a companion, then start your first boss capture.')}</section>`;
}
async function capturePage(id) {
  const generation=state.generation;
  const [data,{devices}]=await Promise.all([api(`/captures/${encodeURIComponent(id)}`),can('captures','write')?api('/companion-devices'):Promise.resolve({devices:[]})]);
  if(generation===state.generation){state.companionDevices=devices;state.captureStatus=data.session.status;} return captureView({...data,devices});
}
function captureItemGroups(events) {
  const groups = new Map();
  for (const event of events.filter(row => !row.ignored)) for (const item of event.items || []) {
    const name = String(item.name || '').trim(); if (!name) continue;
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    const group = groups.get(key) || { name, quantity: 0, needsReview: false };
    group.quantity++; group.needsReview ||= item.needsReview === true; groups.set(key, group);
  }
  return [...groups.values()];
}
function captureView(data) {
  const { session, events, warnings } = data;
  const open = session.status === 'open', preparing = session.status === 'preparing';
  const groups = captureItemGroups(events), pieceCount = groups.reduce((sum, group) => sum + group.quantity, 0);
  const expired = open && new Date(session.expiresAt).getTime() <= Date.now();
  const canPrepare = preparing || (open && events.some(event => !event.ignored && event.items?.some(item => String(item.name || '').trim())));
  return `<div class="toolbar"><button type="button" data-nav="captures">Back to capture sessions</button><button type="button" data-action="open-capture" data-capture="${escape(session.id)}">Refresh captured loot</button></div><div id="capture-workspace"><section class="panel"><div class="panel-head"><div><h2>${escape(session.bossName)}</h2><p>${escape(session.channelName)} | ${escape(session.allowedSenders.length ? session.allowedSenders.join(', ') : 'All channel participants')}</p></div><span class="tag ${preparing ? 'warning' : ''}">${escape(session.status)}</span></div><div class="capture-counts"><span><strong>${escape(number(session.eventCount))}</strong> messages received</span><span><strong>${escape(number(session.itemCount))}</strong> included item occurrences</span><span><strong>${escape(number(session.ignoredCount))}</strong> excluded messages</span><span><strong>${escape(number(session.warningCount))}</strong> warnings</span></div><p class="small muted section-gap">Created ${escape(date(session.createdAt))}. Companion connection expires <span id="capture-connection-expiry">${escape(date(session.expiresAt))}</span>. This view updates when you refresh.</p>${expired ? '<div id="capture-expired-notice" class="notice warning section-gap"><strong>Capture connection expired</strong><p>New companion uploads are no longer accepted. Reconnect the companion below, or review the captured messages and prepare their boss draft.</p></div>' : ''}${preparing ? '<div class="notice warning section-gap"><strong>Capture is frozen while its boss draft is prepared.</strong><p>New messages and message edits have stopped. Retry preparation below to recover the same draft safely.</p></div>' : session.status === 'revoked' ? '<div class="notice warning section-gap"><strong>Capture connection revoked</strong><p>Uploads have stopped. These original messages remain available for review; this capture cannot prepare a new draft.</p></div>' : ''}${warnings.length ? `<div class="notice warning section-gap"><strong>Capture warnings</strong><ul>${warnings.map(warning => `<li>${escape(itemValue(warning))}</li>`).join('')}</ul></div>` : ''}${session.draftId ? `<div class="form-actions"><button type="button" class="primary" data-action="open-loot-draft" data-draft="${escape(session.draftId)}">Review boss loot draft</button></div>` : ''}${captureCompanionInstructions()}</section>${open ? captureDevicePanel(session,data.devices || [])+captureReconnect(session) : ''}<section class="panel"><div class="panel-head"><div><h2>Included loot preview</h2><p>${escape(number(pieceCount))} pieces / ${escape(number(groups.length))} names in the messages below</p></div></div><div class="notice"><p>Each occurrence counts as a copy, including repeated item names. Repeated messages remain included until you exclude them. Names flagged for review may contain concatenated item links; resolve them in the boss draft.</p></div>${groups.length ? table(['Captured item name', 'Copies', 'Review'], groups.map(group => `<tr><td>${escape(group.name)}</td><td class="amount">${escape(number(group.quantity))}</td><td>${group.needsReview ? '<span class="tag warning">Needs review</span>' : '<span class="muted">Match item ID in draft</span>'}</td></tr>`)) : empty('No included loot names yet', 'Post loot to abfloot while the companion is running, then refresh this capture.')}</section><section class="panel"><div class="panel-head"><div><h2>Captured messages</h2><p>Original log lines stay recorded when messages are excluded.</p></div></div>${events.length ? `<div class="capture-events">${events.map(event => captureEventView(event, session)).join('')}</div>` : empty('Waiting for channel messages', 'The companion reads newly appended lines. Existing log history is not replayed.')}</section>${open || preparing ? `<section class="panel"><h2>${preparing ? 'Retry boss draft preparation' : 'Stop capture and review loot'}</h2><p class="small muted section-gap">Finishing stops new messages and copies the included loot into one saved boss draft. Item matching, quantity review, and auction publication happen in that draft.</p><form data-form="prepare-capture" data-capture="${escape(session.id)}"><input name="reviewed" type="hidden" value="on"><div class="form-actions"><button type="submit" class="primary" ${canPrepare ? '' : 'disabled'}>${preparing ? 'Retry preparation safely' : 'Stop capture and review loot'}</button>${!canPrepare ? '<span class="small muted">At least one included message with a loot name is required.</span>' : ''}</div><div data-form-error class="field-error" role="alert" hidden></div></form></section>` : ''}${open ? `<section class="panel"><h2>Stop this connection</h2><p class="small muted section-gap">Revoke the companion connection if this capture is no longer needed. Messages are retained. A revoked capture cannot prepare a boss draft.</p><form data-form="revoke-capture" data-capture="${escape(session.id)}"><div class="form-actions"><button type="submit">Revoke capture connection</button></div><div data-form-error class="field-error" role="alert" hidden></div></form></section>` : ''}</div>`;
}
function captureReconnect(session) {
  return `<details class="panel"><summary>Advanced manual connection</summary><p class="small muted section-gap">Use manual JSON pairing only if the saved companion connection is unavailable. Reconnecting replaces the old manual connection and retains captured messages.</p><form data-form="reconnect-capture" data-capture="${escape(session.id)}"><div class="form-actions"><button type="submit">Generate manual pairing</button></div><div data-form-error class="field-error" role="alert" hidden></div></form></details>`;
}
function captureEventView(event, session) {
  return `<article tabindex="-1" data-capture-event="${escape(event.eventId)}" class="capture-event ${event.ignored ? 'capture-event-ignored' : ''}"><div class="panel-head"><div><h3>${escape(event.sender || 'Unknown sender')}</h3><p>${escape(sourceTime(event.sourceTime))} | ${escape(event.fileName)} | Offset ${escape(event.offset)}</p></div><span class="tag ${event.ignored ? '' : event.items.some(item => item.needsReview) ? 'warning' : ''}">${event.ignored ? 'Excluded' : `${number(event.items.length)} item occurrences`}</span></div><pre class="capture-raw-line">${escape(event.line)}</pre>${event.items.length ? `<ul class="capture-item-lines">${event.items.map(item => `<li>${escape(item.name)}${item.needsReview ? ' <span class="tag warning">Needs review</span>' : ''}${item.note ? `<span class="small muted">${escape(item.note)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="small muted section-gap">No loot names parsed from this message.</p>'}${event.warnings.length ? `<ul class="capture-warning-list">${event.warnings.map(warning => `<li>${escape(itemValue(warning))}</li>`).join('')}</ul>` : ''}${session.status === 'open' ? `<form data-form="exclude-capture-event" data-capture="${escape(session.id)}" data-event="${escape(event.eventId)}" data-ignore="${event.ignored ? 'false' : 'true'}"><div class="form-actions"><button type="submit">${event.ignored ? 'Include this message again' : 'Exclude this message from loot'}</button></div><div data-form-error class="field-error" role="alert" hidden></div></form>` : ''}</article>`;
}
function showCapturePairing(pairing, reconnect = false) {
  clearCapturePairing();
  $('#page-content').insertAdjacentHTML('afterbegin', `<details id="capture-pairing" class="panel capture-pairing"><summary>Advanced manual pairing</summary><h2 id="capture-pairing-heading" tabindex="-1">Connect your local log companion</h2><div class="notice warning section-gap"><strong>Copy this one-time pairing JSON before leaving or refreshing this page.</strong><p>It authorizes uploads to this capture for up to 24 hours. It will not be shown again. Keep it private.</p></div><label class="section-gap">Pairing JSON<textarea readonly rows="9" autocomplete="off" spellcheck="false" aria-describedby="capture-pairing-status"></textarea></label><div class="form-actions"><button type="button" class="primary" data-action="copy-capture-pairing">Copy pairing JSON</button><button type="button" data-action="hide-capture-pairing">Hide pairing JSON</button></div><p id="capture-pairing-status" class="small muted section-gap" role="status">Run node companion/start.mjs, paste this JSON, and choose the full path to your EverQuest log file.</p></details>`);
  $('textarea', $('#capture-pairing')).value = JSON.stringify(pairing);
  $('summary',$('#capture-pairing')).focus();
  flash('Ready to connect. Copy the one-time pairing JSON into the local companion.');
  if (reconnect) $('#capture-pairing-status').textContent = 'The old connection has stopped. Restart the companion with this fresh JSON and keep its same local state so pending messages are retried without being counted twice.';
}
window.addEventListener('pagehide', ()=>{clearCapturePairing();stopCompanionPolling();});
document.addEventListener('pointerover', event => { const anchor = event.target.closest('[data-item-preview]'); if (anchor && event.pointerType !== 'touch') showItemPreview(anchor); if (event.target.closest('#item-preview')) clearTimeout(itemPreviewTimer); });
document.addEventListener('pointerout', event => { if (event.target.closest('[data-item-preview],#item-preview') && !event.relatedTarget?.closest?.('[data-item-preview],#item-preview')) itemPreviewTimer = setTimeout(closeItemPreview, 220); });
document.addEventListener('focusin', event => { const anchor = event.target.closest('[data-item-preview]'); if (anchor) showItemPreview(anchor); else if (!event.target.closest('#item-preview')) closeItemPreview(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeItemPreview(); });
document.addEventListener('error', event => {
  if (!event.target.matches?.('img.eq-item-icon')) return;
  const fallback = document.createElement('div'); fallback.className = 'item-image-missing'; fallback.textContent = 'Source image unavailable'; event.target.replaceWith(fallback);
}, true);
window.addEventListener('resize', closeItemPreview);
document.addEventListener('scroll', event => { if (!event.target.closest?.('#item-preview')) closeItemPreview(); }, true);
function formError(form, message) {
  const output = $('[data-form-error]', form); if (!output) return; output.textContent = message; output.hidden = !message;
}
const formLockStates = new WeakMap();
function lockForm(form, locked) {
  if (locked) {
    const controls = [...form.querySelectorAll('button, input, select, textarea')];
    formLockStates.set(form, controls.map(element => [element, element.disabled]));
    controls.forEach(element => { element.disabled = true; });
  } else {
    for (const [element, wasDisabled] of formLockStates.get(form) || []) element.disabled = wasDisabled;
    formLockStates.delete(form);
  }
}
function updateAdjustmentProjection() {
  const selected = $('#adjustment-character'); const input = $('#adjustment-amount'); const output = $('#adjustment-projection');
  if (!selected || !input || !output) return;
  const character = state.adjustmentCharacters.find(item => item.id === selected.value); const change = Number(input.value);
  if (!character || input.value === '' || !Number.isSafeInteger(change) || change === 0) { output.textContent = 'Choose a main and a nonzero whole-number amount to preview the balance.'; output.classList.remove('negative'); return; }
  const projected = character.balance + change;
  output.textContent = `Projected balance for ${character.name}: ${number(projected)} DKP.${projected < 0 ? ' A negative balance is allowed and remains recorded.' : ''} The server records the actual balance when saved.`;
  output.classList.toggle('negative', projected < 0);
}
function auctionCreationPayload(values) {
  const payload = { itemId: Number(values.itemId), quantity: Number(values.quantity), minimumBid: Number(values.minimumBid) };
  const title = String(values.title || '').trim();
  if (title) payload.title = title;
  return payload;
}
function clearChangedAuctionCreationKey(form) {
  if (!form?.dataset.creationPayload) return;
  const signature = JSON.stringify(auctionCreationPayload(Object.fromEntries(new FormData(form))));
  if (signature !== form.dataset.creationPayload) { delete form.dataset.creationKey; delete form.dataset.creationPayload; }
}

document.addEventListener('click', async event => {
  const auth = event.target.closest('[data-auth]');
  if (auth) { if (!state.authPending) { state.authMode = auth.dataset.auth; renderAuth(); } return; }
  const nav = event.target.closest('[data-nav]');
  if (nav) { if (state.user) { if(nav.dataset.nav==='corrections')state.preferredAttendanceRaid=null; flash(''); await navigate(nav.dataset.nav); } return; }
  const action = event.target.closest('[data-action]'); if (!action || action.disabled) return;
  try {
    const area=actionAreas[action.dataset.action]; if(area&&!can(area,'write')) throw new Error('Write access is required for this action.');
    switch (action.dataset.action) {
      case 'add-preset': {
        const container = $('#reward-presets');
        if (container.children.length >= 100) { flash('A maximum of 100 reward presets can be saved.', true); break; }
        container.insertAdjacentHTML('beforeend', presetRow({ expansion: '', raidType: '', rate: Number($('input[name="defaultTickRate"]').value) || 5 }));
        container.lastElementChild.querySelector('input').focus(); break;
      }
      case 'remove-preset': action.closest('[data-preset-row]').remove(); break;
      case 'logout':
        if (state.authPending) break;
        clearCapturePairing();
        setAuthBusy(true);
        try { await api('/logout', { method: 'POST' }); setSession(null); flash('You have signed out.'); renderShell(); renderAuth(); }
        finally { setAuthBusy(false); }
        break;
      case 'clear-audit': state.auditFilters={actorId:'',subjectUserId:'',characterId:'',action:'',q:'',from:'',to:'',limit:50,offset:0}; await navigate('audit'); break;
      case 'audit-page': state.auditFilters.offset=Number(action.dataset.offset)||0; await navigate('audit'); break;
      case 'retry': await navigate(state.page, state.page === 'profile' ? state.profileId : state.page === 'auctions' ? state.auctionId : state.page === 'mains' ? state.mainReportId : state.page === 'loot' ? state.lootTab==='raid-import'?state.raidLootImportId:state.lootDraftId : state.page === 'captures' ? state.captureId : state.page === 'characters' && state.characterTab === 'create' ? 'create' : state.raidId, state.tickId,{lootTab:state.lootTab}); break;
      case 'request-raid-attendance': if(can('corrections','write')) {state.preferredAttendanceRaid=action.dataset.raid;await navigate('corrections');} break;
      case 'all-attendance-options': state.preferredAttendanceRaid=null;await navigate('corrections');break;
      case 'profile-overview': {const id=state.page==='dashboard'?null:state.page==='mains'?state.mainReportId:state.profileId;await navigate(state.page,id);break;}
      case 'profile-inventory': if(canEditEquipment(state.equipment)){state.inventoryCharacterId=state.equipment.character.id;const id=state.page==='dashboard'?null:state.page==='mains'?state.mainReportId:state.profileId;await navigate(state.page,id,null,{profileTab:'inventory'});} break;
      case 'open-profile': await navigate('profile', action.dataset.character); break;
      case 'gear-open': { const slot = state.equipment?.slots.find(row => row.key === action.dataset.slot); if (!canEditEquipment(state.equipment) || !slot || state.gearPicker?.busy) break; state.gearPicker = {slotKey:slot.key,expectedItemId:slot.itemId,tab:state.equipmentLoot.length ? 'won' : 'reference',query:'',version:0,busy:false}; await renderEquipmentPicker(); break; }
      case 'gear-tab': if (state.gearPicker && !state.gearPicker.busy && ['won','reference'].includes(action.dataset.tab)) {state.gearPicker.tab = action.dataset.tab; await renderEquipmentPicker();} break;
      case 'gear-close': if (!state.gearPicker?.busy) {const slotKey = state.gearPicker?.slotKey; state.gearPicker = null; $('#equipment-picker').hidden = true; $('#equipment-picker').replaceChildren(); $(`[data-action="gear-open"][data-slot="${slotKey}"]`)?.focus({preventScroll:true});} break;
      case 'gear-select': if (Number.isSafeInteger(Number(action.dataset.item)) && Number(action.dataset.item) > 0) await saveEquipmentChoice(Number(action.dataset.item),action); break;
      case 'gear-clear': await saveEquipmentChoice(null,action); break;
      case 'open-raid': flash(''); await navigate('attendance', action.dataset.raid); break;
      case 'open-tick': flash(''); await navigate('attendance', action.dataset.raid, action.dataset.tick); break;
      case 'character-registry': await navigate('characters'); break;
      case 'character-create': await navigate('characters', 'create'); break;
      case 'open-auction': flash(''); await navigate('auctions', action.dataset.auction); break;
      case 'refresh-auctions': await navigate('auctions'); break;
      case 'refresh-auction': await navigate('auctions', action.dataset.auction); break;
      case 'withdraw-bid': {
        action.disabled = true; const auctionId = action.dataset.auction;
        const data = await api(`/auctions/${encodeURIComponent(auctionId)}/bid`, { method: 'DELETE' });
        flash(data.withdrawn ? 'Your bid was withdrawn. Your DKP balance is unchanged.' : 'No active bid remained to withdraw.');
        if (state.page === 'auctions' && state.auctionId === auctionId) await navigate('auctions', auctionId);
        break;
      }
      case 'confirm-award': {
        action.disabled = true; const auctionId = action.dataset.auction;
        const data = await api(`/auctions/${encodeURIComponent(auctionId)}/awards/${encodeURIComponent(action.dataset.character)}/confirm`, { method: 'POST' });
        flash(`${data.alreadyConfirmed ? 'Award was already confirmed; no duplicate charge.' : 'Item award confirmed and DKP deducted.'} Current recipient balance: ${number(data.balance)} DKP.${data.balance < 0 ? ' The negative balance is recorded for officer follow-up.' : ''}`);
        if (state.page === 'auctions' && state.auctionId === auctionId) await navigate('auctions', auctionId);
        break;
      }
      case 'auction-audit': {
        action.disabled = true; const auctionId = action.dataset.auction;
        await navigate('auctions', auctionId);
        const generation = state.generation;
        const data = await api(`/auctions/${encodeURIComponent(auctionId)}/audit`);
        if (state.page !== 'auctions' || state.auctionId !== auctionId || state.generation !== generation) break;
        const target = $('#auction-audit');
        if (target) target.innerHTML = data.entries.length ? table(['Character / member', 'Action', 'Amount', 'Accepted'], data.entries.map(entry => `<tr><td>${escape(entry.characterName)}<span class="muted">${escape(entry.userName)}</span></td><td>${escape(entry.action)}</td><td class="amount">${entry.amount === null ? '-' : `${escape(number(entry.amount))} DKP`}</td><td>${escape(exactTime(entry.acceptedAt))}</td></tr>`)) : empty('No bid events to show', 'Accepted bids, updates, and withdrawals will appear here.');
        break;
      }
      case 'item-detail': await openItemDetails(Number(action.dataset.item)); break;
      case 'close-item-dialog': itemDialogVersion++; $('#item-dialog').close(); break;
      case 'main-attendance': await navigate('mains', action.dataset.character); break;
      case 'loot-drafts': await navigate('loot');break;
      case 'raid-loot-imports': await navigate('loot',null,null,{lootTab:'raid-import'});break;
      case 'open-raid-loot-import': await navigate('loot',action.dataset.import,null,{lootTab:'raid-import'});break;
      case 'refresh-raid-loot-import': await navigate('loot',action.dataset.import,null,{lootTab:'raid-import',preserveContext:reviewContext(action)});break;
      case 'clear-raid-loot-settings': {const form=action.closest('[data-form="preview-raid-loot"]');if(form){$('input[name="settingsFile"]',form).value='';clearRaidLootPreview();}break;}
      case 'raid-loot-page': {state.raidLootEventPage=Math.max(0,Number(action.dataset.page)||0);const entry=state.raidLootImport||state.raidLootPreview?.preview;if(entry){const target=$('#raid-loot-events');target.innerHTML=raidLootEventTable(entry,!state.raidLootImport);target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView?.({block:'start',behavior:'instant'});}break;}
      case 'open-loot-draft': await navigate('loot', action.dataset.draft); break;
      case 'refresh-loot-draft': await navigate('loot', action.dataset.draft); break;
      case 'open-capture': await navigate('captures', action.dataset.capture); break;
      case 'hide-device-pairing': clearCapturePairing(); break;
      case 'hide-capture-pairing': clearCapturePairing(); break;
      case 'copy-capture-pairing': {
        const panel = $('#capture-pairing'), input = panel ? $('textarea', panel) : null; if (!input) break;
        action.disabled = true;
        try {
          if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
          await navigator.clipboard.writeText(input.value);
          if (input.isConnected) $('#capture-pairing-status').textContent = 'Pairing JSON copied. Paste it into the local companion.';
        } catch {
          if (input.isConnected) { input.focus(); input.select(); $('#capture-pairing-status').textContent = 'Select and copy the pairing JSON with Ctrl+C, then paste it into the companion.'; }
        } finally { if (action.isConnected) action.disabled = false; }
        break;
      }
      case 'claim':
        action.disabled = true; await api('/claims', { method: 'POST', body: { characterId: action.dataset.character } }); flash('Character claim submitted. An officer must approve the assignment.'); await navigate('characters'); break;
      case 'cancel-import':
        state.importPayload = null; $('#import-preview').hidden = true; $('#import-preview').replaceChildren(); break;
      case 'commit-import': {
        if (!state.importPayload || !state.raidId) return;
        const committingRaidId = state.raidId;
        const committingPayload = state.importPayload;
        const committingGeneration = state.generation;
        const panel = $('#import-preview'); panel.querySelectorAll('button').forEach(button => { button.disabled = true; }); $('#attendance-files').disabled = true;
        try {
          const data = await api(`/raids/${encodeURIComponent(committingRaidId)}/import`, { method: 'POST', body: { files: committingPayload, commit: true } });
          flash(`Import complete: ${number(data.importedTicks)} new ticks, ${number(data.duplicateTicks)} duplicates skipped, ${number(data.creditedDkp)} DKP posted.`);
          if (committingGeneration === state.generation && state.page === 'attendance' && state.raidId === committingRaidId) { state.importPayload = null; await navigate('attendance', committingRaidId); }
        } catch (error) {
          if (error.silent) break;
          if (panel.isConnected) {
            panel.querySelectorAll('button').forEach(button => { button.disabled = false; }); $('#attendance-files').disabled = false;
            const output = $('[data-commit-error]', panel); output.textContent = error.message; output.hidden = false;
          } else flash(error.message, true);
        }
        break;
      }
    }
  } catch (error) { action.disabled = false; if (!error.silent) flash(error.message, true); }
});
document.addEventListener('input', event => {
  const cloneForm=event.target.closest?.('[data-form="preview-attendance-clone"]');if(cloneForm)clearAttendanceClonePreview(cloneForm);
  if(event.target.closest?.('[data-form="preview-raid-loot"]'))clearRaidLootPreview();
  clearChangedAuctionCreationKey(event.target.closest('form[data-form="create-auction"]'));
  if (event.target.id === 'adjustment-amount') updateAdjustmentProjection();
  if (event.target.id === 'character-search') {
    const query = event.target.value.toLowerCase().trim();
    $('#character-table').innerHTML = characterTable(state.characters.filter(character => `${character.name} ${character.className}`.toLowerCase().includes(query))); applyAccessControls($('#character-table'));
  }
});
document.addEventListener('change', event => {
  const raidForm=event.target.closest?.('[data-form="preview-raid-loot"]');if(raidForm){clearRaidLootPreview();if(event.target.id==='raid-loot-format')$('#raid-loot-boss',raidForm).required=event.target.value==='tracker-tsv';if(event.target.id==='raid-loot-raid'){const option=event.target.selectedOptions?.[0];if(option?.dataset.date)$('[name="raidDate"]',raidForm).value=option.dataset.date;}}
  clearChangedAuctionCreationKey(event.target.closest('form[data-form="create-auction"]'));
  if (event.target.id === 'adjustment-character') { state.adjustmentCharacterId = event.target.value; updateAdjustmentProjection(); return; }
  if (event.target.id === 'raid-rate-preset') {
    const rate = event.target.selectedOptions[0]?.dataset.rate;
    if (rate) $('#raid-rate').value = rate;
    return;
  }
  if (event.target.id === 'auction-item-reference') {
    const unresolved = event.target.selectedOptions[0]?.dataset.unresolved === 'true';
    const title = $('#auction-game-title'); $('#auction-title-label').hidden = !unresolved;
    title.required = unresolved; title.disabled = !unresolved; if (!unresolved) title.value = '';
    return;
  }
  if(event.target.id==='inventory-file'){state.inventoryPreview=null;state.inventoryResult=null;const preview=$('#inventory-preview');if(preview){preview.hidden=true;preview.replaceChildren();}return;}
  if(event.target.id==='catalog-file'){const file=event.target.files[0],output=$('#catalog-file-selection');if(output)output.textContent=file?`${file.name} - ${number(file.size)} bytes`:'';return;}
  if (event.target.id !== 'attendance-files') return;
  state.importPayload = null; $('#import-preview').hidden = true; $('#import-preview').replaceChildren();
  $('#selected-files').innerHTML = [...event.target.files].map(file => `<li>${escape(file.name)} (${escape(number(file.size))} bytes)</li>`).join('');
});
document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-form]'); if (!form) return;
  event.preventDefault(); if (form.dataset.form === 'auth' && state.authPending) return;
  const ignoringLootRow = form.dataset.form === 'edit-loot-row' && event.submitter?.name === 'ignore';
  if (!ignoringLootRow && !form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form)); const kind = form.dataset.form;
  const submissionGeneration = state.generation;
  const savedReviewContext = reviewContext(form);
  const lootWorkspace = form.closest('#loot-workspace, #capture-workspace, #inventory-workspace, #raid-loot-workspace, #attendance-clone-workspace');
  if (lootWorkspace?.dataset.busy === 'true') return;
  formError(form, ''); lockForm(form, true);
  const lootControls = lootWorkspace ? [...lootWorkspace.querySelectorAll('button,input,select,textarea')].map(control => [control, control.disabled]) : [];
  if (lootWorkspace) { lootWorkspace.dataset.busy = 'true'; lootControls.forEach(([control]) => { control.disabled = true; }); }
  try {
    if(['inventory-preview','inventory-import','inventory-repreview'].includes(kind)&&!canEditEquipment(state.equipment))throw new Error('Only this approved character owner can import inventory.');
    const area=mutationAreas[kind]; if(area&&!can(area,'write')) throw new Error('Write access is required for this action.');
    if (kind === 'auth') {
      setAuthBusy(true);
      const data = await api(state.authMode === 'register' ? '/register' : '/login', { method: 'POST', body: values });
      setSession(data.user, data.csrfToken, data.access); setAuthBusy(false); flash(`Welcome, ${state.user.name}.`); renderShell(); await navigate('dashboard');
    } else if (kind === 'filter-audit') {
      state.auditFilters={...state.auditFilters,...Object.fromEntries(['actorId','subjectUserId','characterId','action','q','from','to'].map(key=>[key,String(values[key] || '').trim()])),offset:0}; await navigate('audit');
    } else if (kind === 'filter-access') {
      state.accessSearch=String(values.q || '').trim(); await navigate('access');
    } else if (['save-access-profile','create-access-profile','save-access-user'].includes(kind)) {
      const permissions=Object.fromEntries(state.accessData.areas.filter(area=>values[`permission-${area.key}`]!=='' && values[`permission-${area.key}`]!==undefined).map(area=>[area.key,Number(values[`permission-${area.key}`])]));
      const isUser=kind==='save-access-user',create=kind==='create-access-profile';
      const data=await api(isUser?`/access/users/${encodeURIComponent(form.dataset.user)}`:create?'/access/profiles':`/access/profiles/${encodeURIComponent(form.dataset.profile)}`,{method:create?'POST':'PUT',body:isUser?{profileId:values.profileId,overrides:permissions,expectedRevision:Number(form.dataset.revision)}:{name:String(values.name).trim(),permissions,...(!create?{expectedRevision:Number(form.dataset.revision)}:{})}});
      if (!form.isConnected || submissionGeneration!==state.generation) return;
      state.access=data.access; flash('Access settings saved.'); await navigate(can('access','read')?'access':'dashboard');
    } else if (kind === 'gear-search') {
      if (state.gearPicker && !state.gearPicker.busy) {state.gearPicker.query = String(values.q || '').trim(); state.gearPicker.tab = 'reference'; await renderEquipmentPicker(true);}
    } else if (kind === 'filter-overview') {
      state.reportAsOf=values.asOf; await navigate('dashboard');
    } else if (kind === 'filter-mains') {
      state.reportAsOf = values.asOf; state.reportClass = values.class || ''; await navigate('mains', form.dataset.character || null);
    } else if (kind === 'connect-device') {
      const data=await api('/companion-devices',{method:'POST',body:{label:String(values.label || '').trim()}});
      if(form.isConnected&&submissionGeneration===state.generation)showDevicePairing(data.pairing);
    } else if (kind === 'activate-device' || kind === 'revoke-device') {
      const deviceId=kind==='activate-device'?String(values.deviceId || ''):form.dataset.device;
      if(!state.companionDevices.some(device=>device.id===deviceId))throw new Error('Refresh the companion list before changing this connection.');
      await api(`/companion-devices/${encodeURIComponent(deviceId)}/${kind==='activate-device'?'activate':'revoke'}`,{method:'POST',body:kind==='activate-device'?{captureId:form.dataset.capture}:{}});
      if(!form.isConnected||submissionGeneration!==state.generation)return;
      if(kind==='activate-device')rememberCompanionDevice(deviceId);
      flash(kind==='activate-device'?'Capture sent to your companion. Keep its window open to monitor the log.':'Companion disconnected. Captured messages are retained.');
      await navigate('captures',state.captureId,null,{preserveContext:savedReviewContext});
    } else if (kind === 'create-capture') {
      const manual=values.manualPairing==='on', deviceId=String(values.deviceId || '');
      if(!manual&&!activeCompanionDevices(state.companionDevices).some(device=>device.id===deviceId))throw new Error('Connect a companion and refresh its status, or select advanced manual pairing.');
      const body={bossName:String(values.bossName).trim(),channelName:'abfloot',allowedSenders:String(values.allowedSenders || '').split(',').map(name=>name.trim()).filter(Boolean)};
      if(values.raidId)body.raidId=values.raidId;
      const data=await api('/captures',{method:'POST',body});
      if(!form.isConnected||submissionGeneration!==state.generation)return;
      let activationError=null;
      if(!manual) {try {await api(`/companion-devices/${encodeURIComponent(deviceId)}/activate`,{method:'POST',body:{captureId:data.session.id}});rememberCompanionDevice(deviceId);}catch(error){if(error.silent)return;activationError=error.message;}}
      if(!form.isConnected||submissionGeneration!==state.generation)return;
      const detailGeneration=state.generation+1;await navigate('captures',data.session.id);
      if(state.page==='captures'&&state.captureId===data.session.id&&state.generation===detailGeneration&&state.user&&!state.authPending) {
        if(manual)showCapturePairing(data.pairing);
        else flash(activationError?`Capture saved. ${activationError} Start it from the companion controls below.`:'Boss capture assigned. Wait for Watching before posting loot in abfloot.',Boolean(activationError));
      }
    } else if (kind === 'reconnect-capture') {
      const captureId = form.dataset.capture;
      clearCapturePairing();
      const data = await api(`/captures/${encodeURIComponent(captureId)}/pair`, { method: 'POST', body: {} });
      if (!form.isConnected || submissionGeneration !== state.generation || state.page !== 'captures' || state.captureId !== captureId || state.authPending) return;
      const expiry = $('#capture-connection-expiry'); if (expiry) expiry.textContent = date(data.session.expiresAt);
      $('#capture-expired-notice')?.remove();
      showCapturePairing(data.pairing, true);
    } else if (['exclude-capture-event', 'prepare-capture', 'revoke-capture'].includes(kind)) {
      const captureId = form.dataset.capture;
      let route = `/captures/${encodeURIComponent(captureId)}`, method = 'POST', body;
      if (kind === 'exclude-capture-event') { route += `/events/${encodeURIComponent(form.dataset.event)}`; method = 'PUT'; body = { ignore: form.dataset.ignore === 'true' }; }
      else if (kind === 'prepare-capture') {
        if (values.reviewed !== 'on') throw new Error('Confirm that the capture is ready before preparing the boss draft.');
        route += '/prepare';
      } else route += '/revoke';
      const data = await api(route, { method, body });
      if (!form.isConnected || submissionGeneration !== state.generation || state.page !== 'captures' || state.captureId !== captureId) return;
      if (kind === 'prepare-capture') { flash('Capture finished. Review item matches and quantities in the boss draft before publishing auctions.'); await navigate('loot', data.draftId); }
      else { flash(kind === 'revoke-capture' ? 'Capture connection revoked. Its original messages are retained.' : form.dataset.ignore === 'true' ? 'Message excluded from loot. Its original log line is retained.' : 'Message included in loot again.'); await navigate('captures', captureId, null, kind==='exclude-capture-event'?{preserveContext:savedReviewContext}:{}); }
    } else if (kind === 'preview-raid-loot') {
      const payload=await raidLootPayload(form,values);if(!form.isConnected||submissionGeneration!==state.generation)return;
      const {preview}=await api('/loot-imports/preview',{method:'POST',body:payload});if(!form.isConnected||submissionGeneration!==state.generation)return;
      state.raidLootPreview={payload,preview};state.raidLootImport=null;state.raidLootEventPage=0;$('#raid-loot-preview').innerHTML=raidLootPreviewPanel(preview);$('#raid-loot-preview-heading')?.focus({preventScroll:true});
    } else if (kind === 'commit-raid-loot') {
      const saved=state.raidLootPreview;if(!saved)throw new Error('Preview the raid-night source before saving.');if(values.reviewed!=='on')throw new Error('Confirm the raid-night preview review.');if(saved.preview.possibleOverlapCount&&values.confirmDistinctLegacy!=='on')throw new Error('Review and confirm that overlapping legacy rows are separate loot events.');
      const data=await api('/loot-imports',{method:'POST',body:{...saved.payload,expectedPreviewHash:saved.preview.previewHash,confirmDistinctLegacy:values.confirmDistinctLegacy==='on'}});if(!form.isConnected||submissionGeneration!==state.generation)return;
      state.raidLootPreview=null;await navigate('loot',data.import.id,null,{lootTab:'raid-import'});flash(data.alreadyImported?'This source was already imported. Its saved boss groups are shown.':'Raid-night loot saved. Review exclusions and prepare each boss draft. No auctions were published.');
    } else if (kind === 'exclude-raid-loot') {
      await api(`/loot-imports/${encodeURIComponent(form.dataset.import)}/events/${encodeURIComponent(form.dataset.event)}`,{method:'PUT',body:{excluded:form.dataset.excluded==='true',reason:String(values.reason || '').trim(),expectedRevision:Number(form.dataset.revision)}});if(!form.isConnected||submissionGeneration!==state.generation)return;
      await navigate('loot',form.dataset.import,null,{lootTab:'raid-import',preserveContext:savedReviewContext});flash('Loot row review saved. Original source data is retained.');
    } else if (kind === 'prepare-raid-loot') {
      const data=await api(`/loot-imports/${encodeURIComponent(form.dataset.import)}/groups/${encodeURIComponent(form.dataset.group)}/prepare`,{method:'POST',body:form.dataset.preparing==='true'?{}:{bossName:String(values.bossName || '').trim()}});if(!form.isConnected||submissionGeneration!==state.generation)return;
      await navigate('loot',data.draftId);flash(data.alreadyPrepared?'The existing boss draft is open.':'Boss draft prepared. Review item matches and quantities before publishing auctions.');
    } else if (kind === 'create-loot') {
      const files = await Promise.all([...$('input[name="files"]', form).files].map(async file => ({ name: file.name, text: await file.text(), format: values.format })));
      if (!String(values.text || '').trim() && !files.length) throw new Error('Paste loot text or select a text / log file.');
      if (!form.isConnected || submissionGeneration !== state.generation) return;
      const payload = { bossName: String(values.bossName).trim(), format: values.format, text: values.text || '', files };
      if (values.raidId) payload.raidId = values.raidId;
      const signature = JSON.stringify(payload);
      if (form.dataset.creationPayload !== signature || !form.dataset.creationKey) { form.dataset.creationPayload = signature; form.dataset.creationKey = crypto.randomUUID(); }
      const data = await api('/loot/drafts', { method: 'POST', body: { ...payload, idempotencyKey: form.dataset.creationKey } });
      if (form.isConnected && submissionGeneration === state.generation) { flash('Loot draft saved. Review names, quantities, and catalog matches before publishing.'); await navigate('loot', data.draft.id); }
    } else if (['match-loot', 'resolve-loot-candidate', 'edit-loot-row', 'publish-loot'].includes(kind)) {
      const draftId = form.dataset.draft;
      const body = { expectedRevision: Number(form.dataset.revision) };
      let route = `/loot/drafts/${encodeURIComponent(draftId)}`, method = 'POST';
      if (kind === 'match-loot') { route += '/match'; if (form.dataset.row) body.rowIds = [form.dataset.row]; }
      if (kind === 'publish-loot') {
        if (values.reviewed !== 'on') throw new Error('Confirm the manager review before publishing.');
        route += '/publish';
      }
      if (kind === 'resolve-loot-candidate' || kind === 'edit-loot-row') {
        method = 'PUT'; route += `/items/${encodeURIComponent(form.dataset.row)}`;
        if (kind === 'resolve-loot-candidate') { body.itemId = Number(form.dataset.item); body.confirm = true; }
        else if (event.submitter?.name === 'ignore') body.ignore = event.submitter.value === 'true';
        else {
          body.name = String(values.name).trim(); body.quantity = Number(values.quantity);
          if (values.confirm === 'on') {
            if (!Number.isSafeInteger(Number(values.itemId)) || Number(values.itemId) < 1) throw new Error('Enter a positive numeric EQ item ID to confirm.');
            body.itemId = Number(values.itemId); body.confirm = true;
          } else if (String(values.itemId || '').trim()) throw new Error('Check the ID confirmation box to save this item ID.');
        }
      }
      const data = await api(route, { method, body });
      if (form.isConnected && submissionGeneration === state.generation && state.page === 'loot' && state.lootDraftId === draftId) {
        flash(kind === 'publish-loot' ? data.alreadyPublished ? 'This boss batch was already published. Its original auctions are shown.' : `${number(data.auctions.length)} boss auctions published together for 24 hours. No DKP was reserved.` : kind === 'match-loot' ? `Searched ${number(data.searched)} names. ${number(data.remaining)} unresolved groups remain.` : 'Loot row review saved.');
        itemDetailsCache.clear(); await navigate('loot', draftId, null, kind==='publish-loot'?{}:{preserveContext:savedReviewContext});
      }
    } else if (kind === 'create-character') {
      const level = Number(values.level);
      if (!Number.isSafeInteger(level) || level < 1 || level > 255) throw new Error('Enter the character level as a whole number from 1 to 255.');
      await api('/characters', { method: 'POST', body: { name: String(values.name).trim(), level, className: values.className } });
      flash('Character and ownership claim requested. An officer must approve the assignment and main or alt status before ownership or main DKP is granted.');
      await navigate('characters');
    } else if (kind === 'detach-character') {
      if (!can('claims','write') || values.reviewed !== 'on') throw new Error('Review and confirm this character detachment.');
      const data = await api(`/characters/${encodeURIComponent(form.dataset.character)}/detach`, { method: 'POST', body: { reason: String(values.reason || '').trim(), expectedOwnerId: form.dataset.owner, expectedAssignmentId: form.dataset.assignment } });
      if (!form.isConnected || submissionGeneration !== state.generation) return;
      flash(data.alreadyDetached ? 'This assignment was already detached. No duplicate action was recorded.' : 'Character detached. Its attendance, loot and DKP ledger remain recorded.');
      await navigate('claims');
    } else if (kind === 'approve-claim') {
      const data = await api(`/claims/${encodeURIComponent(form.dataset.claim)}/approve`, { method: 'POST', body: { kind: values.kind } });
      flash(`Character assignment approved as ${values.kind}. ${number(data.creditedDkp)} pending DKP credited.`); await navigate('claims');
    } else if (kind === 'request-attendance') {
      const data = await api('/attendance-requests', { method: 'POST', body: { tickId: values.tickId, characterId: form.dataset.character, reason: values.reason } });
      flash(data.duplicate ? 'This attendance request is already recorded. Review its status below.' : 'Missing-attendance request submitted for officer review. No correction points have been posted yet.');
      await navigate('corrections');
    } else if (kind === 'decide-attendance') {
      const decision = event.submitter?.dataset.decision;
      if (!['approve', 'reject'].includes(decision)) throw new Error('Choose Approve or Reject for this attendance request.');
      const data = await api(`/attendance-requests/${encodeURIComponent(form.dataset.request)}/${decision}`, { method: 'POST', body: { reason: values.reason } });
      flash(`${data.duplicate ? 'This decision was already recorded.' : `Attendance request ${decision === 'approve' ? 'approved' : 'rejected'}.`} ${number(data.creditedDkp)} DKP posted; no duplicate credit is created.`);
      await navigate('corrections');
    } else if (kind === 'save-settings') {
      const presets = [...form.querySelectorAll('[data-preset-row]')].map(row => ({ expansion: $('[data-preset-field="expansion"]', row).value.trim(), raidType: $('[data-preset-field="raidType"]', row).value.trim(), rate: Number($('[data-preset-field="rate"]', row).value) }));
      const data = await api('/settings', { method: 'PUT', body: { defaultTickRate: Number(values.defaultTickRate), minimumBid: Number(values.minimumBid), presets } });
      flash(data.changed ? 'Future reward settings saved. Existing raids, auctions, and DKP history are unchanged.' : 'Settings already match these values. No historical records were changed.');
      await navigate('settings');
    } else if (kind === 'adjust-dkp') {
      const amount = Number(values.amount);
      if (!Number.isSafeInteger(amount) || amount === 0) throw new Error('Enter a nonzero signed whole-number DKP adjustment.');
      const data = await api('/adjustments', { method: 'POST', body: { characterId: values.characterId, amount, reason: values.reason, idempotencyKey: form.dataset.idempotencyKey } });
      flash(`${data.duplicate ? 'This adjustment was already recorded; no duplicate charge was posted.' : 'Officer adjustment recorded with its ledger and audit entries.'} Current balance: ${number(data.balance)} DKP.`);
      await navigate('ledger');
    } else if (kind === 'create-raid') {
      const data = await api('/raids', { method: 'POST', body: { name: values.name, date: values.date, rate: Number(values.rate) } });
      flash('Raid night created. You can preview and import its attendance dumps below.'); await navigate('attendance', data.raid.id);
    } else if (kind === 'create-auction') {
      const payload = auctionCreationPayload(values);
      const signature = JSON.stringify(payload);
      if (form.dataset.creationPayload !== signature || !form.dataset.creationKey) {
        form.dataset.creationKey = crypto.randomUUID(); form.dataset.creationPayload = signature;
      }
      const data = await api('/auctions', { method: 'POST', body: { ...payload, idempotencyKey: form.dataset.creationKey } });
      delete form.dataset.creationKey; delete form.dataset.creationPayload;
      state.auctionDraftItemId = null;
      flash(`Auction published. Bidding closes ${exactTime(data.auction.closesAt)}.`); await navigate('auctions', data.auction.id);
    } else if (kind === 'filter-auctions') {
      state.auctionFilters = { q: String(values.q || '').trim(), class: String(values.class || ''), status: String(values.status || 'open') };
      await navigate('auctions');
    } else if (kind === 'place-bid') {
      const amount = Number(values.amount); const auctionId = form.dataset.auction;
      if (!Number.isSafeInteger(amount) || amount < 1) throw new Error('Enter a positive whole-number DKP bid.');
      const current=state.currentAuction, limit=current?.id===auctionId?currentBidLimit(current.ownEligibility):null;
      if(limit===null)throw new Error('Refresh the auction to load your current DKP before bidding.');
      if(amount>limit)throw new Error(`Your bid cannot exceed your current ${number(limit)} DKP per-bid limit.`);
      await api(`/auctions/${encodeURIComponent(auctionId)}/bid`, { method: 'PUT', body: { amount } });
      flash('Your sealed bid is saved. No DKP was reserved or deducted.');
      if (state.page === 'auctions' && state.auctionId === auctionId) await navigate('auctions', auctionId);
    } else if (kind === 'preview-attendance-clone') {
      const raidId=form.dataset.raid,sourceTickId=form.dataset.source,key=attendanceCloneKey(raidId,sourceTickId),payload={targetTime:String(values.targetTime || '').trim(),reason:String(values.reason || '').trim()};
      if(state.page!=='attendance'||state.raidId!==raidId)throw new Error('Open this source tick in its own raid before cloning.');
      if(payload.reason.length<3||payload.reason.length>500)throw new Error('Enter an officer reason from 3 to 500 characters.');
      if(!/^\d{2}:\d{2}(?::\d{2})?$/.test(payload.targetTime))throw new Error('Choose the new tick time.');
      const previous=attendanceClonePreviews.get(key);if(previous?.commitAttempted)throw new Error('Retry the retained confirmation or refresh raid records before starting another clone.');
      const preview=await api(`/raids/${encodeURIComponent(raidId)}/ticks/${encodeURIComponent(sourceTickId)}/clone/preview`,{method:'POST',body:payload});
      if(!form.isConnected||submissionGeneration!==state.generation)return;
      if(preview.source?.tickId!==sourceTickId||preview.target?.raidId!==raidId||!preview.previewToken)throw new Error('The clone preview context changed. Refresh the raid before continuing.');
      const signature=JSON.stringify(payload),record={key,raidId,sourceTickId,payload,preview,idempotencyKey:previous?.signature===signature?previous.idempotencyKey:crypto.randomUUID(),signature,commitAttempted:false};
      attendanceClonePreviews.set(key,record);const component=form.closest('[data-attendance-clone]'),target=component?.querySelector('[data-clone-preview]');if(target){target.innerHTML=attendanceClonePreviewPanel(record);target.querySelector('h3')?.focus({preventScroll:true});}
    } else if (kind === 'commit-attendance-clone') {
      const record=attendanceClonePreviews.get(form.dataset.cloneKey);if(!record||record.raidId!==form.dataset.raid||record.sourceTickId!==form.dataset.source)throw new Error('Preview this source attendance before confirming the clone.');
      if(state.page!=='attendance'||state.raidId!==record.raidId)throw new Error('Return to the source raid before confirming this clone.');if(values.reviewed!=='on')throw new Error('Confirm the copied roster, target time, rate and reason.');
      if(!record.commitBody)record.commitBody={...record.payload,previewToken:record.preview.previewToken,idempotencyKey:record.idempotencyKey};record.commitAttempted=true;
      const data=await api(`/raids/${encodeURIComponent(record.raidId)}/ticks/${encodeURIComponent(record.sourceTickId)}/clone`,{method:'POST',body:record.commitBody});if(!form.isConnected||submissionGeneration!==state.generation)return;
      await navigate('attendance',record.raidId,state.tickId,{preserveContext:savedReviewContext});flash(data.replayed?'This cloned tick was already recorded. No duplicate attendance or DKP was posted.':`Cloned attendance recorded at ${sourceTime(data.tick.sourceTime)}. ${number(data.creditedDkp)} DKP posted.`);
    } else if (kind === 'preview-import') {
      const previewRaidId = state.raidId;
      const previewGeneration = state.generation;
      const files = [...$('#attendance-files').files];
      if (!files.length) throw new Error('Choose at least one attendance dump.');
      if (files.length > 10) throw new Error('Choose up to 10 attendance dumps per batch.');
      const payload = await Promise.all(files.map(async file => ({ name: file.name, text: await file.text() })));
      const data = await api(`/raids/${encodeURIComponent(previewRaidId)}/import`, { method: 'POST', body: { files: payload, commit: false } });
      if (!form.isConnected || state.raidId !== previewRaidId || state.generation !== previewGeneration) return;
      state.importPayload = payload; $('#import-preview').innerHTML = importPreview(data); applyAccessControls($('#import-preview')); $('#import-preview').hidden = false;
      flash('Preview ready. Review the results before confirming the import.');
    } else if (kind === 'filter-items') {
      state.itemFilters = { q: String(values.q || '').trim(), class: String(values.class || ''), slot: String(values.slot || '') };
      state.selectedItemId = null; await navigate('items');
     } else if (kind === 'inventory-preview' || kind === 'inventory-repreview') {
      const characterId=state.equipment.character.id;
      let fileName,text;
      if(kind==='inventory-repreview'){const saved=state.inventoryPreview;if(!saved||saved.characterId!==characterId)throw new Error('Choose the inventory export and preview it again.');fileName=saved.fileName;text=saved.text;}
      else {const file=$('input[name="file"]',form).files[0];if(!file)throw new Error('Choose the EverQuest inventory export.');if(file.size>2*1024*1024)throw new Error('Choose an inventory text file no larger than 2 MiB.');fileName=file.name;text=await file.text();}
      if(!form.isConnected||submissionGeneration!==state.generation)return;
      await previewInventoryFile(fileName,text,characterId,submissionGeneration);
    } else if (kind === 'inventory-import') {
      const saved=state.inventoryPreview;if(!saved||saved.characterId!==state.equipment.character.id)throw new Error('Preview this character inventory before importing.');
      const selected=[...form.querySelectorAll('input[name="inventory-slot"]:checked')].map(input=>input.value);
      const selections=selected.map(slotKey=>{const row=saved.preview.slots.find(row=>row.slotKey===slotKey&&row.itemId!==null);if(!row)throw new Error('The equipment selection changed. Preview the file again.');return{slotKey,expectedItemId:row.currentItemId};});
      if(!selections.length)throw new Error('Select one or more equipment slots to import.');
      const data=await api(`/characters/${encodeURIComponent(saved.characterId)}/inventory/import`,{method:'POST',body:{importId:saved.preview.importId,fileName:saved.fileName,text:saved.text,selections}});
      if(!form.isConnected||submissionGeneration!==state.generation)return;
      state.inventoryResult={...data,fileName:saved.fileName,preview:saved.preview,importedKeys:selections.map(selection=>selection.slotKey)};state.inventoryPreview=null;itemDetailsCache.clear();
      const id=state.page==='dashboard'?null:state.page==='mains'?state.mainReportId:state.profileId;
      await navigate(state.page,id,null,{profileTab:'inventory',preserveContext:savedReviewContext});
    } else if (kind === 'refresh-spell-names') {
      const data=await api('/catalog/spell-names/refresh',{method:'POST'});
      if(!form.isConnected||submissionGeneration!==state.generation)return;
      state.spellNamesStatus=data;state.spellNamesOpen=true;itemDetailsCache.clear();
      await navigate('items',null,null,{preserveContext:savedReviewContext});flash(`Effect name cache updated: ${number(data.entryCount)} names. Check the source date shown in the cache details.`);
    } else if (kind === 'discard-catalog') {
      const catalog=state.catalogStatus,entry=catalog?.imports?.find(row=>row.id===form.dataset.import);
      if(values.reviewed!=='on')throw new Error('Confirm that this incomplete import should be discarded.');
      if(!entry||entry.id===catalog.active?.id||!['staging','ready'].includes(entry.status))throw new Error('Only an incomplete import can be discarded. Refresh catalog status.');
      const data=await api(`/catalog/imports/${encodeURIComponent(entry.id)}/discard`,{method:'POST',body:{}});
      if(!form.isConnected||submissionGeneration!==state.generation)return;
      const result=data.imports?.find(row=>row.id===entry.id),becameActive=data.active?.id===entry.id;
      state.catalogStatus=data;await navigate('items',null,null,{preserveContext:savedReviewContext});flash(becameActive?'This import became active and was not discarded.':result?.status==='failed'?'Incomplete import discarded. The active item database is unchanged.':'Import status refreshed. Review the latest catalog state.',becameActive);
    } else if (kind === 'import-catalog') {
      const file=$('input[name="file"]',form).files[0],limit=state.catalogStatus?.limits?.uploadBytes;
      if(!file)throw new Error('Choose the SODEQ item data file.');
      if(limit&&file.size>limit)throw new Error(`Choose a file no larger than ${number(limit/(1024*1024))} MiB.`);
      const payload=new FormData();payload.append('file',file);payload.append('expectedRevision',String(form.dataset.revision));if(values.sourceDate)payload.append('sourceDate',values.sourceDate);
      const progress=$('#catalog-upload-progress',form),status=$('#catalog-upload-status',form);progress.hidden=false;progress.removeAttribute('value');status.textContent='Uploading and validating item data...';
      const data=await apiMultipart('/catalog/import',payload,({loaded,total})=>{if(!form.isConnected||submissionGeneration!==state.generation)return;if(total&&loaded<total){progress.value=Math.min(100,Math.floor(loaded/total*100));status.textContent=`Uploading item data: ${progress.value}%`;}else{progress.removeAttribute('value');status.textContent='Upload sent. Validating and saving item data...';}});
      if(!form.isConnected||submissionGeneration!==state.generation)return;
      itemDetailsCache.clear();state.catalogStatus={...state.catalogStatus,...data};
      await navigate('items');flash(data.alreadyImported?'This file is already the active item database.':`Item database updated: ${number(data.itemCount ?? data.active?.itemCount)} items available.`);
    } else if (kind === 'lookup-item') {
      const data=await api('/items/lookup',{method:'POST',body:{itemId:values.itemId}});
      if(!form.isConnected||submissionGeneration!==state.generation)return;
      itemDetailsCache.delete(`${state.sessionEpoch}:${data.item.itemId}`);
      state.itemFilters={q:String(data.item.itemId),class:'',slot:''};state.selectedItemId=data.item.itemId;
      flash(data.item.sourceStatus?.message || 'Local item reference saved.');await navigate('items');
    }
  } catch (error) {
    if(!error.silent&&kind==='commit-attendance-clone'&&error.status===409&&form.isConnected&&submissionGeneration===state.generation){attendanceClonePreviews.delete(form.dataset.cloneKey);form.dataset.clonePreviewInvalid='true';error.message+=' Preview the source again before confirming.';}
    if(!error.silent&&kind==='inventory-import'&&error.status===409&&state.inventoryPreview){state.inventoryPreview.conflicted=true;form.dataset.inventoryConflict='true';}
    if(!error.silent&&kind==='import-catalog'&&form.isConnected){const progress=$('#catalog-upload-progress',form),status=$('#catalog-upload-status',form);if(progress)progress.hidden=true;if(status)status.textContent='Check catalog status before retrying if the upload connection was interrupted.';}
    if(!error.silent&&kind==='exclude-raid-loot'&&error.status===409&&form.isConnected&&submissionGeneration===state.generation){await navigate('loot',form.dataset.import,null,{lootTab:'raid-import',preserveContext:savedReviewContext});flash(`${error.message} Latest import status loaded; review the row again.`,true);}
    else if (!error.silent && kind==='place-bid' && error.code==='bid_exceeds_balance' && form.isConnected && submissionGeneration===state.generation) {await navigate('auctions',form.dataset.auction,null,{preserveContext:savedReviewContext});flash(error.message,true);}
    else if (!error.silent && kind === 'create-character' && error.code === 'character_exists') {
      await navigate('characters'); flash(`${error.message} Review the existing registry below; no duplicate character was created.`, true);
    } else if (!error.silent) formError(form, error.message);
  }
  finally { if (kind === 'auth') setAuthBusy(false); if (lootWorkspace?.isConnected) { delete lootWorkspace.dataset.busy; lootControls.forEach(([control, wasDisabled]) => { control.disabled = wasDisabled; }); } if (form.isConnected) {lockForm(form,false);if(form.dataset.inventoryConflict==='true')form.querySelector('button[type="submit"]')?.setAttribute('disabled','');retainAttendanceCloneRetry(form);if(form.dataset.clonePreviewInvalid==='true'){form.querySelector('button[type="submit"]')?.setAttribute('disabled','');resetAttendanceCloneInputs(form);}} }
});
$('.brand').addEventListener('click', event => { event.preventDefault(); if (state.user) { flash(''); navigate('dashboard'); } });
async function start() {
  try { const data = await api('/me'); setSession(data.user, data.csrfToken || '', data.access); renderShell(); if (state.user) await navigate('dashboard'); else renderAuth(); }
  catch (error) { if (error.silent) return; $('#startup').innerHTML = `<div class="notice error" role="alert"><strong>Guild Desk could not open</strong><p>${escape(error.message)}</p></div><button type="button" id="retry-start">Try again</button>`; $('#retry-start').addEventListener('click', start); }
}
start();
