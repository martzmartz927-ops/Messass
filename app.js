(function(){
  "use strict";

  /* ================= API client ================= */
  const API_BASE = '/api';
  let TOKEN = localStorage.getItem('nexo_token') || null;

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    const res = await fetch(API_BASE + path, Object.assign({}, opts, { headers }));
    let data;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
    return data;
  }

  function setToken(t) {
    TOKEN = t;
    if (t) localStorage.setItem('nexo_token', t);
    else localStorage.removeItem('nexo_token');
  }

  /* ================= State ================= */
  const state = {
    screen: 'authScreen',
    authMode: 'login',
    user: null,
    settings: null,
    chats: [],
    activeChatId: null,
    activeChatPeer: null,
    messagesByChat: {},
    typingTimeouts: {},
    panelOpen: null,
    panelTab: 'stickers',
    stickers: [],
    gifs: [],
    pendingGalleryContext: 'chat', // 'chat' | 'profile'
    pendingImageForSaveAs: null,
    ws: null,
  };

  const AVATAR_COLORS = ['#5b8cff','#ff8a5b','#5bd6ff','#a05bff','#ff5b8a','#5bffb0','#ffcf5b'];
  function colorForName(name){
    let hash = 0;
    for(let i=0;i<(name||'').length;i++) hash = name.charCodeAt(i) + ((hash<<5)-hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }
  function initials(name){ return (name||'?').trim().charAt(0).toUpperCase() || '?'; }
  function renderAvatar(el, name, imgUrl, size){
    el.innerHTML = '';
    if(imgUrl){
      el.style.backgroundImage = `url(${imgUrl})`;
      el.style.background = `url(${imgUrl}) center/cover`;
      el.textContent = '';
    } else {
      el.style.backgroundImage = 'none';
      el.style.background = colorForName(name);
      el.textContent = initials(name);
    }
  }
  function escapeHtml(s){
    return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function fmtTime(ts){
    const d = new Date(ts);
    return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
  }
  function fmtLastSeen(ts){
    if (!ts) return 'не в сети';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'в сети';
    if (diff < 3600000) return `был(а) ${Math.floor(diff/60000)} мин назад`;
    if (diff < 86400000) return `был(а) ${Math.floor(diff/3600000)} ч назад`;
    const d = new Date(ts);
    return `был(а) ${d.getDate()}.${(d.getMonth()+1).toString().padStart(2,'0')}`;
  }
  function fmtChatTime(ts){
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return fmtTime(ts);
    const days = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays < 7) return days[d.getDay()];
    return `${d.getDate()}.${(d.getMonth()+1).toString().padStart(2,'0')}`;
  }

  let toastTimer;
  function showToast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> t.classList.remove('show'), 2200);
  }

  /* ================= Navigation ================= */
  function showScreen(id){
    document.querySelectorAll('.screen').forEach(s=> s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    state.screen = id;
    document.querySelectorAll('#bottomNav .nav-item').forEach(b=>{
      b.classList.toggle('active', b.dataset.screen === id);
    });
  }
  document.querySelectorAll('[data-screen]').forEach(el=>{
    el.addEventListener('click', ()=> showScreen(el.dataset.screen));
  });

  /* ================= Auth ================= */
  const authSub = document.getElementById('authSub');
  const authSubmit = document.getElementById('authSubmit');
  const authSwitch = document.getElementById('authSwitch');
  const registerFields = document.getElementById('registerFields');
  const authError = document.getElementById('authError');

  function renderAuthMode(){
    authError.textContent = '';
    if(state.authMode === 'login'){
      authSub.textContent = 'Войдите, чтобы продолжить';
      authSubmit.textContent = 'Войти';
      registerFields.style.display = 'none';
      authSwitch.innerHTML = 'Нет аккаунта? <a id="toRegister">Зарегистрироваться</a>';
    } else {
      authSub.textContent = 'Создайте новый аккаунт';
      authSubmit.textContent = 'Зарегистрироваться';
      registerFields.style.display = 'flex';
      authSwitch.innerHTML = 'Уже есть аккаунт? <a id="toLogin">Войти</a>';
    }
    bindAuthSwitchLink();
  }
  function bindAuthSwitchLink(){
    const link = authSwitch.querySelector('a');
    link.addEventListener('click', ()=>{
      state.authMode = state.authMode === 'login' ? 'register' : 'login';
      renderAuthMode();
    });
  }
  bindAuthSwitchLink();

  authSubmit.addEventListener('click', async ()=>{
    authError.textContent = '';
    const login = document.getElementById('authLogin').value.trim();
    const password = document.getElementById('authPassword').value;
    authSubmit.disabled = true;
    try {
      let data;
      if (state.authMode === 'register') {
        const nickname = document.getElementById('regNickname').value.trim();
        const username = document.getElementById('regUsername').value.trim();
        if (!nickname || !username) throw new Error('Заполните имя и username');
        data = await api('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ login, password, nickname, username })
        });
      } else {
        data = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ login, password })
        });
      }
      setToken(data.token);
      state.user = data.user;
      await afterLogin();
    } catch (e) {
      authError.textContent = e.message;
    } finally {
      authSubmit.disabled = false;
    }
  });

  async function afterLogin(){
    await loadSettings();
    applySettingsToUI();
    renderProfile();
    connectWebSocket();
    await loadChats();
    await loadStickerLibrary();
    showScreen('chatsScreen');
  }

  async function tryAutoLogin(){
    if (!TOKEN) return;
    try {
      const data = await api('/auth/me');
      state.user = data.user;
      await afterLogin();
    } catch {
      setToken(null);
    }
  }

  /* ================= WebSocket ================= */
  function connectWebSocket(){
    if (state.ws) { try { state.ws.close(); } catch{} }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(TOKEN)}`);
    state.ws = ws;

    ws.addEventListener('message', (ev)=>{
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      if (data.type === 'message') onIncomingMessage(data.message);
      if (data.type === 'message_deleted') onMessageDeleted(data.chatId, data.messageId);
      if (data.type === 'presence') onPresenceUpdate(data.userId, data.online);
      if (data.type === 'typing') onTypingEvent(data.chatId, data.userId);
    });
    ws.addEventListener('close', ()=>{
      setTimeout(()=>{ if (TOKEN) connectWebSocket(); }, 2000);
    });
    setInterval(()=>{ if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({type:'ping'})); }, 25000);
  }

  function onIncomingMessage(msg){
    if (!state.messagesByChat[msg.chatId]) state.messagesByChat[msg.chatId] = [];
    state.messagesByChat[msg.chatId].push(msg);
    if (state.activeChatId === msg.chatId) {
      appendMessageToDOM(msg);
      scrollMessagesToBottom();
    } else {
      const chat = state.chats.find(c=>c.id === msg.chatId);
      if (chat) chat.unread = (chat.unread || 0) + 1;
    }
    updateChatListPreview(msg);
    renderChatList(document.getElementById('chatSearchInput').value);
  }
  function onMessageDeleted(chatId, messageId){
    const list = state.messagesByChat[chatId];
    if (list) state.messagesByChat[chatId] = list.filter(m=>m.id !== messageId);
    if (state.activeChatId === chatId) {
      const el = document.querySelector(`[data-msg-id="${messageId}"]`);
      if (el) el.remove();
    }
  }
  function onPresenceUpdate(userId, online){
    const chat = state.chats.find(c=> c.peer && c.peer.id === userId);
    if (chat) chat.peer.isOnline = online;
    if (state.activeChatId && state.activeChatPeer && state.activeChatPeer.id === userId) {
      state.activeChatPeer.isOnline = online;
      updateDialogStatus();
    }
  }
  function onTypingEvent(chatId, userId){
    if (state.activeChatId !== chatId) return;
    const ind = document.getElementById('typingIndicator');
    ind.classList.remove('hidden');
    clearTimeout(state.typingTimeouts[chatId]);
    state.typingTimeouts[chatId] = setTimeout(()=> ind.classList.add('hidden'), 2500);
  }
  function updateChatListPreview(msg){
    const chat = state.chats.find(c=>c.id === msg.chatId);
    if (!chat) { loadChats(); return; }
    chat.lastMessage = { id: msg.id, type: msg.type, content: msg.content, senderId: msg.senderId, createdAt: msg.createdAt };
  }

  /* ================= Settings ================= */
  async function loadSettings(){
    const data = await api('/settings');
    state.settings = data.settings;
  }
  function applySettingsToUI(){
    const s = state.settings;
    if (!s) return;
    document.documentElement.setAttribute('data-theme', s.theme === 'light' ? 'light' : 'dark');
    document.documentElement.style.setProperty('--accent', s.accentColor || '#5b8cff');
    document.documentElement.style.setProperty('--chat-font-size', (s.chatFontSize || 15) + 'px');
  }
  async function patchSettings(patch){
    const data = await api('/settings', { method:'PATCH', body: JSON.stringify(patch) });
    state.settings = data.settings;
    applySettingsToUI();
  }

  /* ================= Chat list ================= */
  async function loadChats(){
    const data = await api('/chats');
    state.chats = data.chats;
    renderChatList();
  }

  function chatRowHTML(c){
    const name = c.isGroup ? c.title : (c.peer ? c.peer.nickname : 'Чат');
    let lastText = '—';
    if (c.lastMessage) {
      const lm = c.lastMessage;
      if (lm.type === 'text') lastText = lm.content;
      else if (lm.type === 'sticker') lastText = 'Стикер ' + lm.content;
      else if (lm.type === 'image') lastText = 'Фото';
      else if (lm.type === 'gif') lastText = 'GIF';
      else lastText = 'Файл';
    }
    return `
    <div class="chat-row" data-id="${c.id}">
      <div class="avatar" style="width:52px;height:52px;font-size:19px;"></div>
      <div class="chat-row-body">
        <div class="chat-row-top">
          <div class="chat-name">
            ${c.pinned ? '<svg class="pin-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2"><path d="M12 2l1.5 5.5L19 9l-4 4 1 6-4-3-4 3 1-6-4-4 5.5-1.5z"/></svg>' : ''}
            <span>${escapeHtml(name)}</span>
          </div>
          <div class="chat-time">${c.lastMessage ? fmtChatTime(c.lastMessage.createdAt) : ''}</div>
        </div>
        <div class="chat-row-bottom">
          <div class="chat-last">${escapeHtml(lastText)}</div>
          ${c.unread ? `<div class="badge">${c.unread}</div>` : ''}
        </div>
      </div>
    </div>`;
  }

  function renderChatList(filter){
    const listEl = document.getElementById('chatList');
    const f = (filter||'').toLowerCase();
    const sorted = [...state.chats].sort((a,b)=>{
      if (a.pinned !== b.pinned) return b.pinned - a.pinned;
      const at = a.lastMessage ? a.lastMessage.createdAt : 0;
      const bt = b.lastMessage ? b.lastMessage.createdAt : 0;
      return bt - at;
    });
    const filtered = sorted.filter(c=>{
      const name = c.isGroup ? c.title : (c.peer ? c.peer.nickname : '');
      return name.toLowerCase().includes(f);
    });
    if(filtered.length === 0){
      listEl.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><span>${state.chats.length ? 'Ничего не найдено' : 'Нет чатов. Начните новый диалог'}</span></div>`;
      return;
    }
    listEl.innerHTML = filtered.map(chatRowHTML).join('');
    listEl.querySelectorAll('.chat-row').forEach(row=>{
      const id = Number(row.dataset.id);
      const c = state.chats.find(x=>x.id===id);
      const name = c.isGroup ? c.title : (c.peer ? c.peer.nickname : '?');
      const img = c.peer ? (c.peer.avatarPath) : null;
      renderAvatar(row.querySelector('.avatar'), name, img, 52);
      row.addEventListener('click', ()=> openDialog(id));
    });
  }
  document.getElementById('chatSearchInput').addEventListener('input', e=> renderChatList(e.target.value));
  document.getElementById('chatsSearchBtn').addEventListener('click', ()=>{
    document.getElementById('chatSearchInput').focus();
  });

  /* ================= New chat modal ================= */
  const newChatModal = document.getElementById('newChatModal');
  document.getElementById('newChatBtn').addEventListener('click', ()=>{
    document.getElementById('userSearchInput').value = '';
    document.getElementById('userSearchResults').innerHTML = '';
    newChatModal.classList.remove('hidden');
    document.getElementById('userSearchInput').focus();
  });
  document.getElementById('newChatCancel').addEventListener('click', ()=> newChatModal.classList.add('hidden'));
  newChatModal.addEventListener('click', e=>{ if (e.target === newChatModal) newChatModal.classList.add('hidden'); });

  let userSearchDebounce;
  document.getElementById('userSearchInput').addEventListener('input', (e)=>{
    clearTimeout(userSearchDebounce);
    const q = e.target.value.trim();
    userSearchDebounce = setTimeout(async ()=>{
      if (!q) { document.getElementById('userSearchResults').innerHTML=''; return; }
      try {
        const data = await api('/users/search?q=' + encodeURIComponent(q));
        renderUserSearchResults(data.users);
      } catch(e){ /* ignore */ }
    }, 300);
  });
  function renderUserSearchResults(users){
    const el = document.getElementById('userSearchResults');
    if (!users.length) { el.innerHTML = `<div class="gallery-empty">Никого не найдено</div>`; return; }
    el.innerHTML = users.map(u=>`
      <div class="contact-row" data-id="${u.id}">
        <div class="avatar"></div>
        <div>
          <div class="contact-name">${escapeHtml(u.nickname)}</div>
          <div class="contact-sub">${escapeHtml(u.username)}</div>
        </div>
      </div>`).join('');
    el.querySelectorAll('.contact-row').forEach(row=>{
      const u = users.find(x=>x.id === Number(row.dataset.id));
      renderAvatar(row.querySelector('.avatar'), u.nickname, u.avatarPath, 44);
      row.addEventListener('click', async ()=>{
        const data = await api('/chats/direct', { method:'POST', body: JSON.stringify({ userId: u.id }) });
        newChatModal.classList.add('hidden');
        const existingIdx = state.chats.findIndex(c=>c.id === data.chat.id);
        if (existingIdx === -1) state.chats.push(data.chat);
        else state.chats[existingIdx] = data.chat;
        renderChatList();
        openDialog(data.chat.id);
      });
    });
  }

  /* ================= Dialog ================= */
  async function openDialog(id){
    const c = state.chats.find(x=>x.id===id);
    if(!c) return;
    c.unread = 0;
    state.activeChatId = id;
    state.activeChatPeer = c.peer;
    const name = c.isGroup ? c.title : (c.peer ? c.peer.nickname : '?');
    document.getElementById('dialogName').textContent = name;
    renderAvatar(document.getElementById('dialogAvatar'), name, c.peer ? c.peer.avatarPath : null, 38);
    updateDialogStatus();
    document.getElementById('typingIndicator').classList.add('hidden');
    closeStickerPanel();
    showScreen('dialogScreen');
    renderChatList(document.getElementById('chatSearchInput').value);

    const scroll = document.getElementById('messagesScroll');
    scroll.innerHTML = `<div class="center-loader"><div class="spinner"></div></div>`;
    const data = await api(`/chats/${id}/messages?limit=100`);
    state.messagesByChat[id] = data.messages;
    renderMessages(id);
  }
  function updateDialogStatus(){
    const statusEl = document.getElementById('dialogStatus');
    const peer = state.activeChatPeer;
    if (!peer) { statusEl.textContent = ''; return; }
    if (peer.isOnline) {
      statusEl.textContent = 'в сети';
      statusEl.classList.add('online');
    } else {
      statusEl.textContent = fmtLastSeen(peer.lastSeen);
      statusEl.classList.remove('online');
    }
  }
  document.getElementById('dialogBack').addEventListener('click', ()=>{
    state.activeChatId = null;
    state.activeChatPeer = null;
    showScreen('chatsScreen');
  });

  function messageHTML(m){
    const out = m.senderId === state.user.id;
    const rowClass = out ? 'out' : 'in';
    if (m.type === 'sticker') {
      return `<div class="msg-row ${rowClass}" data-msg-id="${m.id}"><div class="bubble sticker-msg">${m.content}</div></div>`;
    }
    if (m.type === 'image' || m.type === 'gif') {
      return `<div class="msg-row ${rowClass}" data-msg-id="${m.id}"><div class="media-card"><img src="${m.mediaPath}" loading="lazy"></div></div>`;
    }
    if (m.type === 'file') {
      return `<div class="msg-row ${rowClass}" data-msg-id="${m.id}">
        <a href="${m.mediaPath}" download="${escapeHtml(m.mediaName||'file')}" style="text-decoration:none;color:inherit;">
        <div class="file-card"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg><span>${escapeHtml(m.mediaName || 'Файл')}</span></div>
        </a></div>`;
    }
    return `<div class="msg-row ${rowClass}" data-msg-id="${m.id}"><div class="bubble">${escapeHtml(m.content)}<span class="bubble-time">${fmtTime(m.createdAt)}</span></div></div>`;
  }
  function renderMessages(chatId){
    const scroll = document.getElementById('messagesScroll');
    const msgs = state.messagesByChat[chatId] || [];
    if (!msgs.length) {
      scroll.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24"><path d="M21 12c0 4-4 7-9 7-1.2 0-2.3-.15-3.4-.44L3 20l1.6-4.1C3.6 14.7 3 13.4 3 12c0-4 4-7 9-7s9 3 9 7z"/></svg><span>Пока нет сообщений</span></div>`;
      return;
    }
    scroll.innerHTML = msgs.map(messageHTML).join('');
    scrollMessagesToBottom();
  }
  function appendMessageToDOM(m){
    const scroll = document.getElementById('messagesScroll');
    if (scroll.querySelector('.empty-state')) scroll.innerHTML = '';
    scroll.insertAdjacentHTML('beforeend', messageHTML(m));
  }
  function scrollMessagesToBottom(){
    const scroll = document.getElementById('messagesScroll');
    scroll.scrollTop = scroll.scrollHeight;
  }

  const messageInput = document.getElementById('messageInput');
  messageInput.addEventListener('input', ()=>{
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 100) + 'px';
    if (state.activeChatId && state.ws && state.ws.readyState === state.ws.OPEN) {
      state.ws.send(JSON.stringify({ type:'typing', chatId: state.activeChatId }));
    }
  });
  messageInput.addEventListener('keydown', e=>{
    const enterToSend = !state.settings || state.settings.chatEnterToSend;
    if(e.key === 'Enter' && !e.shiftKey && enterToSend){ e.preventDefault(); sendText(); }
  });
  document.getElementById('sendBtn').addEventListener('click', sendText);
  async function sendText(){
    const text = messageInput.value.trim();
    if(!text || !state.activeChatId) return;
    messageInput.value = '';
    messageInput.style.height = 'auto';
    try {
      const data = await api(`/chats/${state.activeChatId}/messages`, { method:'POST', body: JSON.stringify({ text }) });
      if (!state.messagesByChat[state.activeChatId]) state.messagesByChat[state.activeChatId] = [];
      state.messagesByChat[state.activeChatId].push(data.message);
      appendMessageToDOM(data.message);
      scrollMessagesToBottom();
      updateChatListPreview(data.message);
      renderChatList(document.getElementById('chatSearchInput').value);
    } catch(e){
      showToast(e.message);
    }
  }

  async function sendSticker(emoji){
    if (!state.activeChatId) return;
    const data = await api(`/chats/${state.activeChatId}/messages`, { method:'POST', body: JSON.stringify({ sticker: emoji }) });
    if (!state.messagesByChat[state.activeChatId]) state.messagesByChat[state.activeChatId] = [];
    state.messagesByChat[state.activeChatId].push(data.message);
    appendMessageToDOM(data.message);
    scrollMessagesToBottom();
    updateChatListPreview(data.message);
    renderChatList(document.getElementById('chatSearchInput').value);
  }
  async function sendMediaFile(file, kind){
    if (!state.activeChatId) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    try {
      const data = await api(`/chats/${state.activeChatId}/media`, { method:'POST', body: fd });
      if (!state.messagesByChat[state.activeChatId]) state.messagesByChat[state.activeChatId] = [];
      state.messagesByChat[state.activeChatId].push(data.message);
      appendMessageToDOM(data.message);
      scrollMessagesToBottom();
      updateChatListPreview(data.message);
      renderChatList(document.getElementById('chatSearchInput').value);
    } catch(e){ showToast(e.message); }
  }

  async function sendStoredMedia(mediaPath, kind){
    if (!state.activeChatId) return;
    try {
      const data = await api(`/chats/${state.activeChatId}/library-message`, { method:'POST', body: JSON.stringify({ mediaPath, kind }) });
      if (!state.messagesByChat[state.activeChatId]) state.messagesByChat[state.activeChatId] = [];
      state.messagesByChat[state.activeChatId].push(data.message);
      appendMessageToDOM(data.message);
      scrollMessagesToBottom();
      updateChatListPreview(data.message);
      renderChatList(document.getElementById('chatSearchInput').value);
    } catch(e){ showToast(e.message); }
  }

  document.getElementById('openGalleryQuick').addEventListener('click', ()=> document.getElementById('fileInputChatMedia').click());
  document.getElementById('fileInputChatMedia').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if (file) sendMediaFile(file, 'image');
    e.target.value = '';
  });
  document.getElementById('attachFileQuick').addEventListener('click', ()=> document.getElementById('fileInputChatFile').click());
  document.getElementById('fileInputChatFile').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if (file) sendMediaFile(file, 'file');
    e.target.value = '';
  });

  /* ================= Sticker / GIF panel ================= */
  const stickerPanel = document.getElementById('stickerPanel');
  function closeStickerPanel(){ stickerPanel.classList.add('hidden'); state.panelOpen = null; }
  function openStickerPanel(tab){
    state.panelOpen = tab;
    state.panelTab = tab;
    stickerPanel.classList.remove('hidden');
    document.querySelectorAll('#stickerPanel .panel-tabs .quick-btn').forEach(b=>{
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    renderPanelGrid();
  }
  document.getElementById('toggleStickerPanel').addEventListener('click', ()=>{
    if(state.panelOpen === 'stickers') closeStickerPanel(); else openStickerPanel('stickers');
  });
  document.getElementById('toggleGifPanel').addEventListener('click', ()=>{
    if(state.panelOpen === 'gifs') closeStickerPanel(); else openStickerPanel('gifs');
  });
  document.querySelectorAll('#stickerPanel .panel-tabs .quick-btn').forEach(b=>{
    b.addEventListener('click', ()=> openStickerPanel(b.dataset.tab));
  });

  const STICKER_EMOJI = ['😀','😂','🥰','😎','🤔','😴','🔥','👍','🎉','❤️','😭','🙌'];

  async function loadStickerLibrary(){
    try {
      const data = await api('/chats/library/stickers');
      state.stickers = data.stickers;
      state.gifs = data.gifs;
    } catch(e){ /* ignore */ }
  }

  function renderPanelGrid(){
    const grid = document.getElementById('panelGrid');
    grid.innerHTML = '';
    const addTile = document.createElement('button');
    addTile.className = 'add-gallery-tile';
    addTile.innerHTML = `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Добавить</span>`;
    addTile.addEventListener('click', ()=> document.getElementById('fileInputSticker').click());
    grid.appendChild(addTile);

    if(state.panelTab === 'stickers'){
      STICKER_EMOJI.forEach(emoji=>{
        const b = document.createElement('button');
        b.className = 'sticker-item';
        b.textContent = emoji;
        b.addEventListener('click', ()=> sendSticker(emoji));
        grid.appendChild(b);
      });
      state.stickers.forEach(s=>{
        const b = document.createElement('button');
        b.className = 'gif-item';
        b.innerHTML = `<img src="${s.media_path}">`;
        b.addEventListener('click', ()=> sendStoredMedia(s.media_path, 'image'));
        grid.appendChild(b);
      });
    } else {
      state.gifs.forEach(g=>{
        const b = document.createElement('button');
        b.className = 'gif-item';
        b.innerHTML = `<img src="${g.media_path}">`;
        b.addEventListener('click', ()=> sendStoredMedia(g.media_path, 'gif'));
        grid.appendChild(b);
      });
      if (!state.gifs.length) {
        grid.insertAdjacentHTML('beforeend', `<div class="panel-empty">Нет GIF. Добавьте через кнопку выше</div>`);
      }
    }
  }
  document.getElementById('fileInputSticker').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const kind = state.panelTab === 'gifs' ? 'gif' : 'sticker';
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    try {
      await api('/chats/library/stickers', { method:'POST', body: fd });
      await loadStickerLibrary();
      renderPanelGrid();
      showToast(kind === 'gif' ? 'GIF добавлен' : 'Стикер добавлен');
    } catch(err){ showToast(err.message); }
  });

  /* ================= Profile ================= */
  function renderProfile(){
    const u = state.user;
    if (!u) return;
    document.getElementById('profileName').textContent = u.nickname;
    document.getElementById('profileUsername').textContent = u.username;
    document.getElementById('profileBio').textContent = u.bio || 'Пара слов о себе';
    document.getElementById('infoLogin').textContent = u.login;
    document.getElementById('infoUsername').textContent = u.username;
    document.getElementById('infoNickname').textContent = u.nickname;
    document.getElementById('infoBio').textContent = u.bio || '—';
    renderAvatar(document.getElementById('profileAvatar'), u.nickname, u.avatarPath, 96);
  }

  document.getElementById('editAvatarBtn').addEventListener('click', ()=> document.getElementById('fileInputAvatar').click());
  document.getElementById('choosePhotoBtn').addEventListener('click', ()=> document.getElementById('fileInputAvatar').click());
  document.getElementById('fileInputAvatar').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      const data = await api('/users/me/avatar', { method:'POST', body: fd });
      state.user.avatarPath = data.avatarPath;
      renderProfile();
      showToast('Фото профиля обновлено');
    } catch(err){ showToast(err.message); }
  });

  const editProfileModal = document.getElementById('editProfileModal');
  document.getElementById('editProfileBtn').addEventListener('click', ()=>{
    document.getElementById('editNickname').value = state.user.nickname;
    document.getElementById('editUsername').value = state.user.username.replace('@','');
    document.getElementById('editBio').value = state.user.bio || '';
    document.getElementById('editProfileError').textContent = '';
    editProfileModal.classList.remove('hidden');
  });
  document.getElementById('editProfileCancel').addEventListener('click', ()=> editProfileModal.classList.add('hidden'));
  editProfileModal.addEventListener('click', e=>{ if(e.target === editProfileModal) editProfileModal.classList.add('hidden'); });
  document.getElementById('editProfileSave').addEventListener('click', async ()=>{
    const nickname = document.getElementById('editNickname').value.trim();
    const username = document.getElementById('editUsername').value.trim();
    const bio = document.getElementById('editBio').value.trim();
    try {
      const data = await api('/users/me', { method:'PATCH', body: JSON.stringify({ nickname, username, bio }) });
      state.user = data.user;
      renderProfile();
      editProfileModal.classList.add('hidden');
      showToast('Профиль обновлён');
    } catch(err){
      document.getElementById('editProfileError').textContent = err.message;
    }
  });

  /* ================= Contacts ================= */
  async function renderContacts(){
    const el = document.getElementById('contactsList');
    el.innerHTML = `<div class="center-loader"><div class="spinner"></div></div>`;
    try {
      const data = await api('/users/contacts');
      const contacts = data.contacts;
      if (!contacts.length) {
        el.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/></svg><span>Список контактов пуст. Добавьте кого-нибудь по username</span></div>`;
        return;
      }
      el.innerHTML = `<div class="section-label">ВСЕ КОНТАКТЫ</div>` + contacts.map(c=>`
        <div class="contact-row" data-id="${c.id}">
          <div class="avatar"></div>
          <div style="flex:1;">
            <div class="contact-name">${escapeHtml(c.nickname)}</div>
            <div class="contact-sub" style="${c.isOnline ? 'color:var(--online)':''}">${c.isOnline ? 'в сети' : fmtLastSeen(c.lastSeen)}</div>
          </div>
          <button class="icon-btn contact-remove" data-remove="${c.id}"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>`).join('');
      el.querySelectorAll('.contact-row').forEach(row=>{
        const c = contacts.find(x=>x.id === Number(row.dataset.id));
        renderAvatar(row.querySelector('.avatar'), c.nickname, c.avatarPath, 44);
        row.addEventListener('click', async (ev)=>{
          if (ev.target.closest('[data-remove]')) return;
          const data = await api('/chats/direct', { method:'POST', body: JSON.stringify({ userId: c.id }) });
          const existingIdx = state.chats.findIndex(x=>x.id === data.chat.id);
          if (existingIdx === -1) state.chats.push(data.chat);
          else state.chats[existingIdx] = data.chat;
          openDialog(data.chat.id);
        });
      });
      el.querySelectorAll('[data-remove]').forEach(btn=>{
        btn.addEventListener('click', async (ev)=>{
          ev.stopPropagation();
          await api('/users/contacts/' + btn.dataset.remove, { method:'DELETE' });
          renderContacts();
        });
      });
    } catch(e){
      el.innerHTML = `<div class="empty-state"><span>Ошибка загрузки контактов</span></div>`;
    }
  }
  document.getElementById('contactsSearchInput').addEventListener('input', async (e)=>{
    const q = e.target.value.trim();
    if (!q) { renderContacts(); return; }
    const el = document.getElementById('contactsList');
    try {
      const data = await api('/users/search?q=' + encodeURIComponent(q));
      if (!data.users.length) { el.innerHTML = `<div class="empty-state"><span>Никого не найдено</span></div>`; return; }
      el.innerHTML = `<div class="section-label">РЕЗУЛЬТАТЫ ПОИСКА</div>` + data.users.map(u=>`
        <div class="contact-row" data-id="${u.id}">
          <div class="avatar"></div>
          <div style="flex:1;">
            <div class="contact-name">${escapeHtml(u.nickname)}</div>
            <div class="contact-sub">${escapeHtml(u.username)}</div>
          </div>
          <button class="icon-btn" data-add="${u.id}"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
        </div>`).join('');
      el.querySelectorAll('.contact-row').forEach(row=>{
        const u = data.users.find(x=>x.id === Number(row.dataset.id));
        renderAvatar(row.querySelector('.avatar'), u.nickname, u.avatarPath, 44);
      });
      el.querySelectorAll('[data-add]').forEach(btn=>{
        btn.addEventListener('click', async (ev)=>{
          ev.stopPropagation();
          await api('/users/contacts', { method:'POST', body: JSON.stringify({ userId: Number(btn.dataset.add) }) });
          showToast('Контакт добавлен');
          renderContacts();
        });
      });
    } catch {}
  });
  document.getElementById('addContactBtn').addEventListener('click', ()=>{
    document.getElementById('contactsSearchInput').focus();
  });

  /* ================= Settings ================= */
  const SETTINGS_ICONS = {
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    bell:'<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    chat:'<path d="M21 12c0 4-4 7-9 7-1.2 0-2.3-.15-3.4-.44L3 20l1.6-4.1C3.6 14.7 3 13.4 3 12c0-4 4-7 9-7s9 3 9 7z"/>',
    lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    device:'<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M10 18h4"/>',
    data:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
    palette:'<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10.5" r="1" fill="currentColor" stroke="none"/>',
    trash:'<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  };
  const settingsData = [
    [
      {id:'account', icon:'user', color:'#5b8cff', title:'Аккаунт', desc:'Логин, username, пароль'},
      {id:'notifications', icon:'bell', color:'#ff8a5b', title:'Уведомления', desc:'Звуки и превью сообщений'},
    ],
    [
      {id:'appearance', icon:'palette', color:'#5bd6ff', title:'Оформление', desc:'Тема, акцентный цвет, размер текста'},
      {id:'privacy', icon:'lock', color:'#a05bff', title:'Конфиденциальность', desc:'Кто видит статус и фото'},
    ],
    [
      {id:'sessions', icon:'device', color:'#ff5b8a', title:'Устройства', desc:'Активные сессии'},
      {id:'data', icon:'data', color:'#ffcf5b', title:'Данные', desc:'Автозагрузка медиа'},
      {id:'language', icon:'globe', color:'#8a90a0', title:'Язык', desc:'Язык интерфейса'},
    ],
    [
      {id:'deleteAccount', icon:'trash', color:'#e5606a', title:'Удалить аккаунт', desc:'Необратимое действие'},
    ],
  ];

  function renderSettings(){
    const el = document.getElementById('settingsList');
    el.innerHTML = settingsData.map(group=>`
      <div class="settings-group">
        ${group.map(item=>`
          <div class="settings-row" data-id="${item.id}">
            <div class="settings-icon" style="background:${item.color}">
              <svg viewBox="0 0 24 24" style="stroke:#fff;">${SETTINGS_ICONS[item.icon]}</svg>
            </div>
            <div class="settings-text">
              <div class="settings-title">${item.title}</div>
              <div class="settings-desc">${item.desc}</div>
            </div>
            <svg class="chev" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
          </div>
        `).join('')}
      </div>
    `).join('');
    el.querySelectorAll('.settings-row').forEach(row=>{
      row.addEventListener('click', ()=> openSettingsDetail(row.dataset.id));
    });
  }

  function openSettingsDetail(id){
    const titles = {
      account:'Аккаунт', notifications:'Уведомления', appearance:'Оформление',
      privacy:'Конфиденциальность', sessions:'Устройства', data:'Данные', language:'Язык',
      deleteAccount:'Удалить аккаунт'
    };
    document.getElementById('settingsDetailTitle').textContent = titles[id] || 'Раздел';
    const content = document.getElementById('settingsDetailContent');
    content.innerHTML = '';
    showScreen('settingsDetailScreen');

    if (id === 'account') renderAccountSettings(content);
    else if (id === 'notifications') renderNotificationSettings(content);
    else if (id === 'appearance') renderAppearanceSettings(content);
    else if (id === 'privacy') renderPrivacySettings(content);
    else if (id === 'sessions') renderSessionsSettings(content);
    else if (id === 'data') renderDataSettings(content);
    else if (id === 'language') renderLanguageSettings(content);
    else if (id === 'deleteAccount') renderDeleteAccount(content);
  }
  document.getElementById('settingsDetailBack').addEventListener('click', ()=> showScreen('settingsScreen'));

  function toggleRow(label, checked, onChange){
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.innerHTML = `
      <div class="settings-text"><div class="settings-title">${label}</div></div>
      <label class="switch">
        <input type="checkbox" ${checked ? 'checked' : ''}>
        <span class="switch-track"></span>
      </label>`;
    row.querySelector('input').addEventListener('change', (e)=> onChange(e.target.checked));
    return row;
  }

  function renderAccountSettings(content){
    const group = document.createElement('div');
    group.className = 'settings-group';
    group.innerHTML = `
      <div class="info-row"><div class="info-label">Логин</div><div class="info-value">${escapeHtml(state.user.login)}</div></div>
      <div class="info-row"><div class="info-label">Username</div><div class="info-value">${escapeHtml(state.user.username)}</div></div>
    `;
    content.appendChild(group);

    const pwGroup = document.createElement('div');
    pwGroup.className = 'settings-group';
    pwGroup.style.padding = '14px';
    pwGroup.innerHTML = `
      <div class="settings-title" style="margin-bottom:10px;">Сменить пароль</div>
      <input class="field" id="curPass" type="password" placeholder="Текущий пароль">
      <input class="field" id="newPass" type="password" placeholder="Новый пароль (мин. 6 символов)">
      <div class="auth-error" id="pwError"></div>
      <button class="btn-primary" id="pwSave" style="margin-top:2px;">Сохранить пароль</button>
    `;
    content.appendChild(pwGroup);
    pwGroup.querySelector('#pwSave').addEventListener('click', async ()=>{
      const currentPassword = pwGroup.querySelector('#curPass').value;
      const newPassword = pwGroup.querySelector('#newPass').value;
      try {
        await api('/settings/password', { method:'POST', body: JSON.stringify({ currentPassword, newPassword }) });
        pwGroup.querySelector('#pwError').textContent = '';
        pwGroup.querySelector('#curPass').value = '';
        pwGroup.querySelector('#newPass').value = '';
        showToast('Пароль изменён');
      } catch(e){
        pwGroup.querySelector('#pwError').textContent = e.message;
      }
    });

    const logoutGroup = document.createElement('div');
    logoutGroup.className = 'settings-group';
    logoutGroup.innerHTML = `<div class="settings-row danger-btn" id="logoutRow"><div class="settings-text"><div class="settings-title">Выйти из аккаунта</div></div></div>`;
    content.appendChild(logoutGroup);
    logoutGroup.querySelector('#logoutRow').addEventListener('click', doLogout);
  }

  function renderNotificationSettings(content){
    const s = state.settings;
    const group = document.createElement('div');
    group.className = 'settings-group';
    group.appendChild(toggleRow('Уведомления о сообщениях', !!s.notifMessages, v=> patchSettings({notifMessages: v?1:0})));
    group.appendChild(toggleRow('Звук уведомлений', !!s.notifSound, v=> patchSettings({notifSound: v?1:0})));
    group.appendChild(toggleRow('Превью текста в уведомлении', !!s.notifPreview, v=> patchSettings({notifPreview: v?1:0})));
    content.appendChild(group);
  }

  function renderAppearanceSettings(content){
    const s = state.settings;
    const themeGroup = document.createElement('div');
    themeGroup.className = 'settings-group';
    themeGroup.innerHTML = `
      <div class="radio-row"><span>Тёмная тема</span><input type="radio" name="theme" value="dark" ${s.theme==='dark'?'checked':''}></div>
      <div class="radio-row"><span>Светлая тема</span><input type="radio" name="theme" value="light" ${s.theme==='light'?'checked':''}></div>
    `;
    themeGroup.querySelectorAll('input[name=theme]').forEach(r=>{
      r.addEventListener('change', ()=> patchSettings({ theme: r.value }));
    });
    content.appendChild(themeGroup);

    const colorGroup = document.createElement('div');
    colorGroup.className = 'settings-group';
    colorGroup.innerHTML = `<div class="settings-title" style="padding:12px 14px 0;">Акцентный цвет</div><div class="color-swatch-row" id="colorSwatchRow"></div>`;
    content.appendChild(colorGroup);
    const row = colorGroup.querySelector('#colorSwatchRow');
    AVATAR_COLORS.concat(['#ffffff','#ff4757']).forEach(c=>{
      const sw = document.createElement('button');
      sw.className = 'color-swatch' + (s.accentColor === c ? ' active' : '');
      sw.style.background = c;
      sw.addEventListener('click', ()=>{
        row.querySelectorAll('.color-swatch').forEach(x=>x.classList.remove('active'));
        sw.classList.add('active');
        patchSettings({ accentColor: c });
      });
      row.appendChild(sw);
    });

    const fontGroup = document.createElement('div');
    fontGroup.className = 'settings-group';
    fontGroup.style.padding = '14px';
    fontGroup.innerHTML = `
      <div class="settings-title" style="margin-bottom:8px;">Размер текста сообщений: <span id="fontSizeVal">${s.chatFontSize||15}</span>px</div>
      <input type="range" min="12" max="20" value="${s.chatFontSize||15}" id="fontSizeRange">
    `;
    content.appendChild(fontGroup);
    const range = fontGroup.querySelector('#fontSizeRange');
    range.addEventListener('input', ()=>{
      fontGroup.querySelector('#fontSizeVal').textContent = range.value;
      document.documentElement.style.setProperty('--chat-font-size', range.value + 'px');
    });
    range.addEventListener('change', ()=> patchSettings({ chatFontSize: Number(range.value) }));

    const enterGroup = document.createElement('div');
    enterGroup.className = 'settings-group';
    enterGroup.appendChild(toggleRow('Enter отправляет сообщение', !!s.chatEnterToSend, v=> patchSettings({chatEnterToSend: v?1:0})));
    content.appendChild(enterGroup);
  }

  function renderPrivacySettings(content){
    const s = state.settings;
    function selectGroup(label, field, options, current){
      const group = document.createElement('div');
      group.className = 'settings-group';
      group.innerHTML = `<div class="settings-title" style="padding:12px 14px 6px;">${label}</div>` +
        options.map(o=>`<div class="radio-row"><span>${o.label}</span><input type="radio" name="${field}" value="${o.value}" ${current===o.value?'checked':''}></div>`).join('');
      group.querySelectorAll(`input[name=${field}]`).forEach(r=>{
        r.addEventListener('change', ()=> patchSettings({ [field]: r.value }));
      });
      return group;
    }
    const privacyOptions = [
      {value:'everyone', label:'Все'},
      {value:'contacts', label:'Только контакты'},
      {value:'nobody', label:'Никто'},
    ];
    content.appendChild(selectGroup('Кто видит время захода', 'privacyLastSeen', privacyOptions, s.privacyLastSeen));
    content.appendChild(selectGroup('Кто видит фото профиля', 'privacyAvatar', privacyOptions, s.privacyAvatar));
    content.appendChild(selectGroup('Кто может добавить по username', 'privacyAddByUsername', privacyOptions, s.privacyAddByUsername));

    const rrGroup = document.createElement('div');
    rrGroup.className = 'settings-group';
    rrGroup.appendChild(toggleRow('Отправлять отметки о прочтении', !!s.readReceipts, v=> patchSettings({readReceipts: v?1:0})));
    content.appendChild(rrGroup);
  }

  async function renderSessionsSettings(content){
    content.innerHTML = `<div class="center-loader"><div class="spinner"></div></div>`;
    try {
      const data = await api('/auth/sessions');
      const group = document.createElement('div');
      group.className = 'settings-group';
      group.innerHTML = data.sessions.map(s=>`
        <div class="session-row">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div class="settings-title">${s.current ? 'Это устройство' : 'Другое устройство'}</div>
              <div class="session-meta">${escapeHtml((s.user_agent||'').slice(0,60))}</div>
              <div class="session-meta">Вход: ${new Date(s.created_at).toLocaleString('ru-RU')}</div>
            </div>
            ${s.current ? '' : `<button class="icon-btn" data-session="${s.id}"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`}
          </div>
        </div>
      `).join('');
      content.innerHTML = '';
      content.appendChild(group);
      group.querySelectorAll('[data-session]').forEach(btn=>{
        btn.addEventListener('click', async ()=>{
          await api('/auth/sessions/' + btn.dataset.session, { method:'DELETE' });
          renderSessionsSettings(content);
        });
      });
    } catch(e){
      content.innerHTML = `<div class="empty-state"><span>Ошибка загрузки сессий</span></div>`;
    }
  }

  function renderDataSettings(content){
    const s = state.settings;
    const group = document.createElement('div');
    group.className = 'settings-group';
    group.appendChild(toggleRow('Автозагрузка фото', !!s.dataAutodownloadPhotos, v=> patchSettings({dataAutodownloadPhotos: v?1:0})));
    group.appendChild(toggleRow('Автозагрузка файлов', !!s.dataAutodownloadFiles, v=> patchSettings({dataAutodownloadFiles: v?1:0})));
    content.appendChild(group);
  }

  function renderLanguageSettings(content){
    const s = state.settings;
    const group = document.createElement('div');
    group.className = 'settings-group';
    const langs = [{value:'ru', label:'Русский'},{value:'en', label:'English'}];
    group.innerHTML = langs.map(l=>`<div class="radio-row"><span>${l.label}</span><input type="radio" name="lang" value="${l.value}" ${s.language===l.value?'checked':''}></div>`).join('');
    group.querySelectorAll('input[name=lang]').forEach(r=>{
      r.addEventListener('change', ()=> patchSettings({ language: r.value }));
    });
    content.appendChild(group);
  }

  function renderDeleteAccount(content){
    const group = document.createElement('div');
    group.className = 'settings-group';
    group.style.padding = '14px';
    group.innerHTML = `
      <div class="settings-title" style="margin-bottom:8px;">Это действие необратимо</div>
      <div class="settings-desc" style="margin-bottom:14px;">Все ваши чаты, сообщения и файлы будут удалены безвозвратно.</div>
      <button class="btn-primary" style="background:var(--danger);" id="confirmDelete">Удалить аккаунт навсегда</button>
    `;
    content.appendChild(group);
    group.querySelector('#confirmDelete').addEventListener('click', async ()=>{
      if (!confirm('Вы уверены? Аккаунт будет удалён без возможности восстановления.')) return;
      try {
        await api('/settings/account', { method:'DELETE' });
        doLogout();
      } catch(e){ showToast(e.message); }
    });
  }

  async function doLogout(){
    try { await api('/auth/logout', { method:'POST' }); } catch {}
    setToken(null);
    if (state.ws) { try { state.ws.close(); } catch{} }
    location.reload();
  }

  /* ================= Init ================= */
  renderSettings();
  tryAutoLogin();

})();
