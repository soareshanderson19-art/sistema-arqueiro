import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Credenciais do novo projeto do Firebase Arqueiro
const firebaseConfig = {
  apiKey: "AIzaSyDKsvwc3N5mkHHJediS-RMrfPETLrmw7Xw",
  authDomain: "arqueiro-9791a.firebaseapp.com",
  databaseURL: "https://arqueiro-9791a-default-rtdb.firebaseio.com",
  projectId: "arqueiro-9791a",
  storageBucket: "arqueiro-9791a.firebasestorage.app",
  messagingSenderId: "267488763889",
  appId: "1:267488763889:web:d4db4ee1e914ff508c6e50",
  measurementId: "G-E1ZRK3SKTY"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// =========================================================================
// FUNÇÃO UTILITÁRIA GLOBAL (Conversor de arquivos para texto Base64)
// =========================================================================
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
};

// =========================================================================
// COMPRESSOR DE IMAGEM CLIENT-SIDE (Evita estourar o limite de 10MB do Firebase)
// =========================================================================
const comprimirImagem = (file, maxWidth = 800, maxHeight = 800, quality = 0.7) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// Estados e variáveis auxiliares
let currentRole = null;
let userId = null; 
let pairedId = null; 
let audioContext = null;

// Osciladores de som de alta potência
let sirenOsc1 = null;
let sirenOsc2 = null;
let sirenOsc3 = null;
let sirenOsc4 = null;
let sirenInterval = null;

let fakeCallOscL = null;
let fakeCallOscR = null;
let fakeCallInterval = null;
let lastGpsCoords = ""; 

// Coordenadas ativas (capturadas em background)
let currentCoords = null;

// Instâncias do Mapa Interativo Leaflet
let mapInstance = null;
let markerInstance = null;

// Estados das Novas Funções
let mediaRecorder = null;
let audioChunks = [];
let monitorTimer = null;
let monitorPin = "";

// Lógica de cliques rápidos do pânico (Mapeamento livre de zoom por duplo toque)
let panicTapsCount = 0;
let panicResetTimeout = null;
let lastTapTime = 0; 

function formatPhoneString(phone) {
  const cleaned = ('' + phone).replace(/\D/g, '');
  const match = cleaned.match(/^(\d{2})(\d{5})(\d{4})$/);
  if (match) return '(' + match[1] + ') ' + match[2] + '-' + match[3];
  const matchShort = cleaned.match(/^(\d{2})(\d{4})(\d{4})$/);
  if (matchShort) return '(' + matchShort[1] + ') ' + matchShort[2] + '-' + matchShort[3];
  return phone;
}

if (localStorage.getItem("arqueiro_role")) {
  currentRole = localStorage.getItem("arqueiro_role");
  userId = localStorage.getItem("arqueiro_user_id");
  setupInterface();
}

function setupInterface() {
  document.getElementById("screenLogin").classList.remove("active");
  document.body.className = ""; 

  if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
    Notification.requestPermission();
  }

  if (currentRole === 'protegida') {
    document.body.classList.add("theme-protegida");
    document.getElementById("screenProtegida").style.display = "flex";
    document.getElementById("p_codigo_id").innerText = formatPhoneString(userId);
    syncProtegidaData();
    iniciarRastreamentoGPSContinuo(); 
    sincronizarChatSecreto(userId);
  } else if (currentRole === 'guardiao') {
    document.body.classList.add("theme-guardiao");
    document.getElementById("screenGuardiao").style.display = "flex";
    const savedPair = localStorage.getItem("arqueiro_paired_id");
    if (savedPair) {
      pairedId = savedPair;
      iniciarMonitoramento(savedPair);
      sincronizarChatSecreto(savedPair);
    }
  }
}

// Exportações para o escopo global (para as chamadas inline nos elementos HTML)
window.selectRole = async function(role) {
  const name = document.getElementById("login_name").value.trim();
  const phoneInput = document.getElementById("login_phone").value.trim();

  if (!name || !phoneInput) {
    alert("Por favor, preencha seu Nome e seu Celular para entrar.");
    return;
  }

  const cleanedPhone = phoneInput.replace(/\D/g, "");
  if (cleanedPhone.length < 10) {
    alert("Por favor, insira um número de celular válido com DDD.");
    return;
  }

  currentRole = role;
  userId = cleanedPhone;

  localStorage.setItem("arqueiro_role", role);
  localStorage.setItem("arqueiro_user_id", userId);
  localStorage.setItem("arqueiro_user_name", name);

  await set(ref(db, `arqueiro/usuarios/${role}/${userId}`), {
    nome: name,
    telefone: cleanedPhone
  });

  setupInterface();
};

window.logout = function() {
  localStorage.clear();
  location.reload();
};

// ==============================================
// NOVA LÓGICA CORRIGIDA: TOQUES RÁPIDOS SEM BUG DE SEGURO
// ==============================================
window.registrarToquePanico = function(event) {
  if (event) {
    event.preventDefault(); // Impede o zoom e a escala por cliques triplos
    event.stopPropagation();
  }

  // Previne leitura duplicada (redundância rápida de touchstart + click em telas touch)
  const now = Date.now();
  if (now - lastTapTime < 100) return; 
  lastTapTime = now;

  panicTapsCount++;

  // Primeiro toque inicia o temporizador de expiração de 2.5 segundos
  if (panicTapsCount === 1) {
    if (panicResetTimeout) clearTimeout(panicResetTimeout);
    panicResetTimeout = setTimeout(resetarToquesPanico, 2500);
  }

  atualizarVisualPanico();

  // Ao registrar 5 toques rápidos o alerta é acionado imediatamente
  if (panicTapsCount >= 5) {
    if (panicResetTimeout) clearTimeout(panicResetTimeout);
    resetarToquesPanico();
    dispararAlertaPanico();
  }
};

function atualizarVisualPanico() {
  const progress = document.getElementById("panicProgress");
  const statusText = document.getElementById("panicStatusText");

  if (!progress) return;
  progress.classList.add("active");
  progress.style.border = "4px solid transparent";

  if (statusText) {
    statusText.innerHTML = `⚠️ Toques registrados: <b>${panicTapsCount} / 5</b>`;
  }

  // Preenchimento gradativo das bordas
  if (panicTapsCount >= 1) progress.style.borderTopColor = "var(--primary)";
  if (panicTapsCount >= 2) progress.style.borderRightColor = "var(--primary)";
  if (panicTapsCount >= 3) progress.style.borderBottomColor = "var(--primary)";
  if (panicTapsCount >= 4) progress.style.borderLeftColor = "var(--primary)";
}

function resetarToquesPanico() {
  panicTapsCount = 0;
  const progress = document.getElementById("panicProgress");
  const statusText = document.getElementById("panicStatusText");

  if (progress) {
    progress.classList.remove("active");
    progress.style.borderTopColor = "transparent";
    progress.style.borderRightColor = "transparent";
    progress.style.borderBottomColor = "transparent";
    progress.style.borderLeftColor = "transparent";
  }
  if (statusText) {
    statusText.innerText = "Toque rápido 5 vezes seguidas para disparar";
  }
}

// ==============================================
// 1. FUNÇÃO: GRAVAÇÃO SILENCIOSA EM NUVEM
// ==============================================
function iniciarGravacaoSilenciosa() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.warn("Dispositivo não suporta gravação de áudio nativa.");
    return;
  }

  audioChunks = [];
  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
      try {
        const base64Audio = await fileToBase64(audioBlob);
        await update(ref(db, `arqueiro/alertas/${userId}`), {
          audio: base64Audio
        });
      } catch (err) {
        console.error("Erro ao converter e subir áudio:", err);
      }
      stream.getTracks().forEach(track => track.stop()); 
    };

    mediaRecorder.start();

    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    }, 15000);

  }).catch((err) => {
    console.warn("Permissão de microfone negada ou inacessível.", err);
  });
}

// ==============================================
// 2. FUNÇÃO: CAMINHO MONITORADO COM TIMER & PIN
// ==============================================
window.iniciarCaminhoMonitorado = function() {
  const minInput = document.getElementById("timer_min").value;
  const pinInput = document.getElementById("timer_pin").value.trim();

  const min = parseInt(minInput);
  if (isNaN(min) || min <= 0 || !pinInput) {
    alert("Por favor, informe o tempo em minutos e crie um PIN de desativação.");
    return;
  }

  monitorPin = pinInput;
  let timeLeft = min * 60;

  document.getElementById("timer_config").style.display = "none";
  document.getElementById("timer_active").style.display = "block";

  monitorTimer = setInterval(() => {
    timeLeft--;
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    document.getElementById("timer_countdown").innerText = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

    if (timeLeft <= 0) {
      clearInterval(monitorTimer);
      dispararAlertaPanico(); 
    }
  }, 1000);
};

window.desativarCaminhoMonitorado = function() {
  const pinInput = prompt("SISTEMA DE SEGURANÇA:\nInsira o seu PIN secreto para desativar o rastreamento:");
  if (pinInput === monitorPin) {
    clearInterval(monitorTimer);
    document.getElementById("timer_config").style.display = "block";
    document.getElementById("timer_active").style.display = "none";
    document.getElementById("timer_min").value = "";
    document.getElementById("timer_pin").value = "";
    alert("Rastreamento de caminho encerrado com sucesso.");
  } else {
    alert("⚠️ PIN INCORRETO! O cronômetro de pânico continua ativo.");
  }
};

// ==============================================
// 3. FUNÇÃO: CHAT SECRETO AUTODESTRUTIVO (10S)
// ==============================================
window.enviarMensagemSecreta = async function() {
  const inputId = currentRole === 'protegida' ? 'p_chat_input' : 'g_chat_input';
  const inputEl = document.getElementById(inputId);
  const text = inputEl.value.trim();
  if (!text) return;

  const targetId = currentRole === 'protegida' ? userId : pairedId;
  const msgId = "msg_" + Date.now();
  
  const msgRef = ref(db, `arqueiro/chats/${targetId}/${msgId}`);
  await set(msgRef, {
    id: msgId,
    sender: currentRole,
    text: text,
    timestamp: Date.now()
  });

  inputEl.value = "";

  setTimeout(async () => {
    await set(msgRef, null);
  }, 10000);
};

function sincronizarChatSecreto(chatId) {
  onValue(ref(db, `arqueiro/chats/${chatId}`), (snapshot) => {
    const listId = currentRole === 'protegida' ? 'p_chat_messages' : 'g_chat_messages';
    const container = document.getElementById(listId);
    if (!container) return;

    container.innerHTML = "";

    if (snapshot.exists()) {
      const msgs = Object.values(snapshot.val());
      msgs.sort((a, b) => a.timestamp - b.timestamp);

      msgs.forEach(msg => {
        const bubble = document.createElement("div");
        bubble.className = `chat-bubble ${msg.sender === currentRole ? 'sent' : 'received'}`;
        bubble.innerText = msg.text;
        container.appendChild(bubble);
      });
      container.scrollTop = container.scrollHeight; 
    } else {
      container.innerHTML = `<p style="text-align: center; color: var(--text-muted); font-size: 0.78rem; padding: 20px 0;">Nenhuma mensagem ativa. Mensagens enviadas somem em 10 segundos.</p>`;
    }
  });
}

// ==============================================
// LÓGICA DO SIMULADOR DE LIGAÇÃO FALSA
// ==============================================
window.iniciarChamadaFalsa = function() {
  document.getElementById("screenFakeCall").classList.add("active");
  tocarToqueDeLigacao();
};

window.atenderChamadaFalsa = function() {
  pararToqueDeLigacao();
  document.querySelector(".caller-status").innerText = "Em chamada (00:01)...";
  document.querySelector(".caller-status").style.color = "#22c55e";
};

window.encerrarChamadaFalsa = function() {
  pararToqueDeLigacao();
  document.getElementById("screenFakeCall").classList.remove("active");
  document.querySelector(".caller-status").innerText = "Móvel...";
  document.querySelector(".caller-status").style.color = "#22c55e";
};

function tocarToqueDeLigacao() {
  if (fakeCallInterval) return;

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  fakeCallInterval = setInterval(() => {
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    fakeCallOscL = audioContext.createOscillator();
    fakeCallOscR = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    fakeCallOscL.type = "sine";
    fakeCallOscR.type = "sine";

    fakeCallOscL.frequency.setValueAtTime(440, audioContext.currentTime);
    fakeCallOscR.frequency.setValueAtTime(480, audioContext.currentTime);

    gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);

    fakeCallOscL.connect(gainNode);
    fakeCallOscR.connect(gainNode);
    gainNode.connect(audioContext.destination);

    fakeCallOscL.start();
    fakeCallOscR.start();

    setTimeout(() => {
      try {
        fakeCallOscL.stop();
        fakeCallOscR.stop();
      } catch (e) {}
    }, 1500);

  }, 3500);
}

function pararToqueDeLigacao() {
  if (fakeCallInterval) {
    clearInterval(fakeCallInterval);
    fakeCallInterval = null;
  }
  try {
    if (fakeCallOscL) fakeCallOscL.stop();
    if (fakeCallOscR) fakeCallOscR.stop();
  } catch (e) {}
}

// ==============================================
// LÓGICA DE PÂNICO E RASTREAMENTO GPS
// ==============================================
function iniciarRastreamentoGPSContinuo() {
  if (!navigator.geolocation) return;
  
  navigator.geolocation.watchPosition((position) => {
    currentCoords = {
      lat: position.coords.latitude,
      lng: position.coords.longitude
    };
    const gpsStatus = document.getElementById("p_gps_status");
    if (gpsStatus) {
      gpsStatus.innerHTML = `📍 GPS Ativo: <b>${currentCoords.lat.toFixed(5)}, ${currentCoords.lng.toFixed(5)}</b>`;
    }
  }, (error) => {
    console.warn("Erro no rastreamento em background:", error.message);
  }, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  });
}

async function dispararAlertaPanico() {
  const activeSuspectId = document.getElementById("p_select_suspeito").value;
  let suspectData = null;

  if (activeSuspectId !== 'nenhum') {
    const snap = await get(ref(db, `arqueiro/suspeitos/${userId}/${activeSuspectId}`));
    if (snap.exists()) suspectData = snap.val();
  }

  const gpsEnvio = currentCoords || {
    lat: -30.0084,
    lng: -51.0844,
    teste: true
  };

  const pacoteAlerta = {
    status: "perigo",
    timestamp: new Date().toISOString(),
    suspeito: suspectData || null,
    gps: gpsEnvio,
    audio: null 
  };

  await set(ref(db, `arqueiro/alertas/${userId}`), pacoteAlerta);

  panicStatusText.innerHTML = "🚨 <b>ALERTA DE PÂNICO DISPARADO!</b>";
  
  iniciarGravacaoSilenciosa(); 
  window.atualizarGPS(); 
}

window.atualizarGPS = function() {
  const gpsStatus = document.getElementById("p_gps_status");
  if (!navigator.geolocation) {
    gpsStatus.innerText = "GPS não suportado pelo seu navegador.";
    return;
  }

  navigator.geolocation.getCurrentPosition(async (position) => {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    
    currentCoords = { lat, lng };
    gpsStatus.innerHTML = `📍 GPS Atualizado: <b>${lat.toFixed(5)}, ${lng.toFixed(5)}</b>`;

    await update(ref(db, `arqueiro/alertas/${userId}/gps`), {
      lat: lat,
      lng: lng
    });
  }, (error) => {
    console.error(error);
  }, { enableHighAccuracy: true });
};

window.cadastrarSuspeito = async function() {
  const nome = document.getElementById("sus_nome").value.trim();
  const caract = document.getElementById("sus_caract").value.trim();
  const veiculo = document.getElementById("sus_veiculo").value.trim();
  const fileInput = document.getElementById("sus_foto");

  if (!nome) {
    alert("Por favor, preencha pelo menos o Nome do suspeito.");
    return;
  }

  let fotoBase64 = "";
  if (fileInput.files && fileInput.files[0]) {
    try {
      fotoBase64 = await comprimirImagem(fileInput.files[0]);
    } catch (e) {
      console.error("Erro ao comprimir imagem:", e);
      alert("Erro ao processar o arquivo de imagem.");
      return;
    }
  }

  const idSus = "sus_" + Date.now();
  await set(ref(db, `arqueiro/suspeitos/${userId}/${idSus}`), {
    id: idSus,
    nome: nome,
    foto: fotoBase64,
    caract: caract,
    veiculo: veiculo
  });

  document.getElementById("sus_nome").value = "";
  document.getElementById("sus_foto").value = "";
  document.getElementById("sus_caract").value = "";
  document.getElementById("sus_veiculo").value = "";

  alert("Suspeito cadastrado com sucesso!");
};

function syncProtegidaData() {
  onValue(ref(db, `arqueiro/suspeitos/${userId}`), (snapshot) => {
    const select = document.getElementById("p_select_suspeito");
    const listDiv = document.getElementById("p_lista_suspeitos");
    
    select.innerHTML = '<option value="nenhum">Nenhum suspeito por perto</option>';
    listDiv.innerHTML = '';

    if (snapshot.exists()) {
      const dados = snapshot.val();
      Object.values(dados).forEach(sus => {
        const opt = document.createElement("option");
        opt.value = sus.id;
        opt.innerText = sus.nome;
        select.appendChild(opt);

        const item = document.createElement("div");
        item.className = "suspect-item";
        item.innerHTML = `
          <img src="${sus.foto || 'https://placehold.co/100x100?text=Sem+Foto'}" class="suspect-photo" onerror="this.src='https://placehold.co/100x100?text=Sem+Foto'">
          <div class="suspect-info">
            <div class="suspect-name">${sus.nome}</div>
            <div class="suspect-metadata"><strong>Físico:</strong> ${sus.caract || '--'}</div>
            <div class="suspect-metadata"><strong>Veículo:</strong> ${sus.veiculo || '--'}</div>
          </div>
        `;
        listDiv.appendChild(item);
      });
    } else {
      listDiv.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 20px 0;">Nenhum agressor ou suspeito cadastrado.</p>';
    }
  });
}

window.switchTab = function(tabName) {
  document.querySelectorAll(".p-tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));

  document.getElementById(`p_tab_${tabName}`).classList.add("active");
  event.currentTarget.classList.add("active");
};

window.conectarProtegida = function() {
  const code = document.getElementById("g_input_id").value.trim();
  if (!code) {
    alert("Por favor, digite o número do celular da protegida.");
    return;
  }
  const cleanedPair = code.replace(/\D/g, "");
  pairedId = cleanedPair;
  localStorage.setItem("arqueiro_paired_id", cleanedPair);
  iniciarMonitoramento(cleanedPair);
  sincronizarChatSecreto(cleanedPair);
};

// API de Geocodificação Reversa Gratuita (OpenStreetMap Nominatim)
async function obterEnderecoAproximado(lat, lng) {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, {
      headers: {
        'User-Agent': 'SistemaArqueiro/1.0'
      }
    });
    if (response.ok) {
      const data = await response.json();
      return data.display_name || "Endereço aproximado não localizado";
    }
  } catch (e) {
    console.error("Erro ao buscar endereço:", e);
  }
  return "Localização obtida (Rua não identificada)";
}

function iniciarMonitoramento(idProtegida) {
  document.getElementById("g_vincular_card").style.display = "none";
  document.getElementById("g_monitoramento_area").style.display = "block";

  // Busca o nome do perfil da Protegida para exibir no painel do Guardião
  get(ref(db, `arqueiro/usuarios/protegida/${idProtegida}`)).then((userSnap) => {
    if (userSnap.exists()) {
      const userDados = userSnap.val();
      document.querySelector(".app-subtitle").innerText = `Monitorando: ${userDados.nome.toUpperCase()}`;
    } else {
      document.querySelector(".app-subtitle").innerText = `Monitorando: ${formatPhoneString(idProtegida)}`;
    }
  }).catch(err => console.error(err));

  // Sincroniza e exibe permanentemente todos os suspeitos que a Protegida cadastrou
  onValue(ref(db, `arqueiro/suspeitos/${idProtegida}`), (snapshot) => {
    const listDiv = document.getElementById("g_all_suspects_list");
    const card = document.getElementById("g_all_suspects_card");
    listDiv.innerHTML = '';

    if (snapshot.exists()) {
      card.style.display = "block";
      const dados = snapshot.val();
      Object.values(dados).forEach(sus => {
        const item = document.createElement("div");
        item.className = "suspect-item";
        item.innerHTML = `
          <img src="${sus.foto || 'https://placehold.co/100x100?text=Sem+Foto'}" class="suspect-photo" onerror="this.src='https://placehold.co/100x100?text=Sem+Foto'">
          <div class="suspect-info">
            <div class="suspect-name">${sus.nome}</div>
            <div class="suspect-metadata"><strong>Físico:</strong> ${sus.caract || '--'}</div>
            <div class="suspect-metadata"><strong>Veículo:</strong> ${sus.veiculo || '--'}</div>
          </div>
        `;
        listDiv.appendChild(item);
      });
    } else {
      card.style.display = "none";
    }
  });

  // Ouvinte em tempo real de alertas de Pânico
  onValue(ref(db, `arqueiro/alertas/${idProtegida}`), (snapshot) => {
    const card = document.getElementById("g_status_card");
    const icon = document.getElementById("g_status_icon");
    const title = document.getElementById("g_status_title");
    const desc = document.getElementById("g_status_desc");
    const btnControls = document.getElementById("g_alarm_buttons");
    const suspectCard = document.getElementById("g_suspect_card");
    const addressEl = document.getElementById("g_status_address");
    const audioContainer = document.getElementById("g_audio_container");
    const audioPlayer = document.getElementById("g_audio_player");

    if (snapshot.exists()) {
      const alerta = snapshot.val();

      if (alerta.status === "perigo") {
        card.classList.add("alarm-screen");
        icon.innerText = "🚨";
        title.innerText = "PÂNICO ATIVADO!";
        desc.innerHTML = `Sua protegida está em perigo!<br/>Alerta disparado às ${new Date(alerta.timestamp).toLocaleTimeString()}`;
        btnControls.style.display = "block";
        
        tocarSirenePolicial();

        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("🚨 EMERGÊNCIA — SISTEMA ARQUEIRO", {
            body: "Sua protegida acionou o pânico! Verifique o mapa imediatamente.",
            tag: "arqueiro-panic",
            requireInteraction: true 
          });
        }

        // Toca a gravação silenciosa de áudio enviada da nuvem
        if (alerta.audio) {
          audioContainer.style.display = "block";
          audioPlayer.src = alerta.audio;
        } else {
          audioContainer.style.display = "none";
        }

        if (alerta.gps) {
          const lat = alerta.gps.lat;
          const lng = alerta.gps.lng;

          const linkMaps = document.getElementById("g_link_maps");
          linkMaps.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
          linkMaps.style.display = "flex";

          // Mapa Interativo integrado na tela do Guardião (Leaflet)
          const mapEl = document.getElementById("g_map");
          mapEl.style.display = "block";

          if (!mapInstance) {
            mapInstance = L.map('g_map').setView([lat, lng], 16);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '© OpenStreetMap'
            }).addTo(mapInstance);
            markerInstance = L.marker([lat, lng]).addTo(mapInstance)
              .bindPopup("Protegida está aqui!").openPopup();
          } else {
            const newLatLng = new L.LatLng(lat, lng);
            markerInstance.setLatLng(newLatLng);
            mapInstance.setView(newLatLng, 16);
          }

          setTimeout(() => {
            if (mapInstance) mapInstance.invalidateSize();
          }, 100);

          const coordsKey = `${lat},${lng}`;
          if (lastGpsCoords !== coordsKey) {
            lastGpsCoords = coordsKey;
            addressEl.style.display = "block";
            addressEl.innerText = "📍 Buscando endereço aproximado...";
            
            obterEnderecoAproximado(lat, lng).then(addr => {
              addressEl.innerHTML = `📍 <b>Endereço aproximado:</b><br/>${addr}`;
            });
          }
        } else {
          addressEl.style.display = "none";
          document.getElementById("g_map").style.display = "none";
        }

        if (alerta.suspeito) {
          suspectCard.style.display = "block";
          document.getElementById("g_suspect_photo").src = alerta.suspeito.foto || '';
          document.getElementById("g_suspect_name").innerText = alerta.suspeito.nome;
          document.getElementById("g_suspect_caract").innerText = alerta.suspeito.caract || 'Não informado';
          document.getElementById("g_suspect_veiculo").innerText = alerta.suspeito.veiculo || 'Não informado';
        } else {
          suspectCard.style.display = "none";
        }
      } else {
        normalizarPainelGuardiao();
      }
    } else {
      normalizarPainelGuardiao();
    }
  });
}

function normalizarPainelGuardiao() {
  window.desligarSonsSinal();
  const card = document.getElementById("g_status_card");
  card.classList.remove("alarm-screen");
  document.getElementById("g_status_icon").innerText = "🛡️";
  document.getElementById("g_status_title").innerText = "TUDO SEGURO";
  document.getElementById("g_status_desc").innerText = "Nenhum alerta ativo no momento.";
  document.getElementById("g_alarm_buttons").style.display = "none";
  document.getElementById("g_suspect_card").style.display = "none";
  document.getElementById("g_status_address").style.display = "none";
  document.getElementById("g_map").style.display = "none";
  document.getElementById("g_audio_container").style.display = "none";
  lastGpsCoords = "";
}

window.desligarSonsSinal = async function() {
  pararSireneSom();
  if (pairedId) {
    await update(ref(db, `arqueiro/alertas/${pairedId}`), {
      status: "seguro",
      audio: null 
    });
  }
};

// =========================================================================
// SINTETIZADOR DE SIRENE POLICIAL METÁLICA E ESTRONDOSA (Web Audio Synth)
// =========================================================================
function tocarSirenePolicial() {
  if (sirenInterval) return;

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  sirenOsc1 = audioContext.createOscillator();
  sirenOsc2 = audioContext.createOscillator();
  sirenOsc3 = audioContext.createOscillator();
  sirenOsc4 = audioContext.createOscillator();

  const gainNode = audioContext.createGain();
  gainNode.gain.setValueAtTime(0.85, audioContext.currentTime);

  sirenOsc1.type = "sawtooth";
  sirenOsc2.type = "sawtooth"; 
  sirenOsc3.type = "square";   
  sirenOsc4.type = "sine";     

  sirenOsc1.connect(gainNode);
  sirenOsc2.connect(gainNode);
  sirenOsc3.connect(gainNode);
  sirenOsc4.connect(gainNode);
  gainNode.connect(audioContext.destination);

  sirenOsc1.start();
  sirenOsc2.start();
  sirenOsc3.start();
  sirenOsc4.start();

  let toggle = true;
  sirenInterval = setInterval(() => {
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    
    const baseFreq = toggle ? 700 : 1100;
    
    sirenOsc1.frequency.setValueAtTime(baseFreq, audioContext.currentTime);
    sirenOsc2.frequency.setValueAtTime(baseFreq + 10, audioContext.currentTime); 
    sirenOsc3.frequency.setValueAtTime(baseFreq / 2, audioContext.currentTime);  
    sirenOsc4.frequency.setValueAtTime(baseFreq * 1.5, audioContext.currentTime); 
    
    toggle = !toggle;
  }, 250); 
}

function pararSireneSom() {
  if (sirenInterval) {
    clearInterval(sirenInterval);
    sirenInterval = null;
  }
  try {
    if (sirenOsc1) sirenOsc1.stop();
    if (sirenOsc2) sirenOsc2.stop();
    if (sirenOsc3) sirenOsc3.stop();
    if (sirenOsc4) sirenOsc4.stop();
  } catch (e) {}
  sirenOsc1 = null;
  sirenOsc2 = null;
  sirenOsc3 = null;
  sirenOsc4 = null;
}