import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, get, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// Credenciais do seu projeto do Firebase Arqueiro
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
// FUNÇÕES UTILITÁRIAS DE GEOLOCALIZAÇÃO (Fórmula de Haversine)
// =========================================================================

// Calcula a distância exata entre duas coordenadas em km [1.1.3]
const calcularDistancia = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Raio da Terra em km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; 
};

// Converte arquivo para texto Base64
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
};

// Compressor de Imagem
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

// =========================================================================
// BANCO DE DADOS DE SEGURANÇA (Usado apenas se a Protegida estiver sem internet)
// =========================================================================
const pontosApoioPadrao = [
  {
    nome: "Delegacia da Mulher (DEAM - Alvorada)",
    endereco: "Rua Alberto Pasqualini, 404 - Sumaré, Alvorada/RS",
    telefone: "(51) 3442-1114",
    lat: -29.9892,
    lng: -51.0827,
    tipo: "delegacia"
  },
  {
    nome: "SIM - Serviços Integrados para Mulheres (Alvorada)",
    endereco: "Av. Presidente Getúlio Vargas, 3060 (Parada 48) - Americana, Alvorada/RS",
    telefone: "(51) 3411-1345",
    lat: -30.0045,
    lng: -51.0872,
    tipo: "defensoria"
  },
  {
    nome: "Delegacia da Mulher (DEAM - Porto Alegre)",
    endereco: "Rua Prof. Cristiano Fischer, 1610 - Jardim do Salso, Porto Alegre/RS",
    telefone: "(51) 3288-2173",
    lat: -30.0520,
    lng: -51.1685,
    tipo: "delegacia"
  }
];

// Estados e variáveis auxiliares
let currentRole = null;
let userId = null; 
let pairedId = null; 
let audioContext = null;

// Osciladores de som de alta potência (Sinal recebido no Guardião)
let sirenOsc1 = null;
let sirenOsc2 = null;
let sirenOsc3 = null;
let sirenOsc4 = null;
let sirenInterval = null;

// Osciladores de alarme e apito de socorro locais (Protegida)
let localSirenInterval = null;
let localOsc1 = null;
let localOsc2 = null;
let whistleOsc = null;

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

// Variáveis de Controle de Busca Geográfica do Usuário
let lastSearchedCity = "";
let lastSearchedCoords = null;

// Variáveis de Controle e Segurança
let isAlertActive = false; 
let editingSuspectId = null; 

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
  } else if (currentRole === 'guardiao') {
    document.body.classList.add("theme-guardiao");
    document.getElementById("screenGuardiao").style.display = "flex";
    const savedPair = localStorage.getItem("arqueiro_paired_id");
    if (savedPair) {
      pairedId = savedPair;
      iniciarMonitoramento(savedPair);
    }
  }
}

// Exportações para o escopo global
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
// LÓGICA DE DETECÇÃO DE TOQUES RÁPIDOS (PÂNICO)
// ==============================================
window.registrarToquePanico = function(event) {
  if (event) {
    event.preventDefault(); 
    event.stopPropagation();
  }

  if (isAlertActive) return;

  const now = Date.now();
  if (now - lastTapTime < 100) return; 
  lastTapTime = now;

  panicTapsCount++;

  if (panicTapsCount === 1) {
    if (panicResetTimeout) clearTimeout(panicResetTimeout);
    panicResetTimeout = setTimeout(resetarToquesPanico, 2500);
  }

  atualizarVisualPanico();

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
// 3. FUNÇÃO: PAINEL DE DEFESA SONORA LOCAIS
// ==============================================
window.tocarAlarmeLocal = function() {
  if (localSirenInterval) return;

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  localOsc1 = audioContext.createOscillator();
  localOsc2 = audioContext.createOscillator();

  const gainNode = audioContext.createGain();
  gainNode.gain.setValueAtTime(1.0, audioContext.currentTime); 

  localOsc1.type = "sawtooth";
  localOsc2.type = "square";

  localOsc1.connect(gainNode);
  localOsc2.connect(gainNode);
  gainNode.connect(audioContext.destination);

  localOsc1.start();
  localOsc2.start();

  let toggle = true;
  localSirenInterval = setInterval(() => {
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    const freq = toggle ? 800 : 1200;
    localOsc1.frequency.setValueAtTime(freq, audioContext.currentTime);
    localOsc2.frequency.setValueAtTime(freq + 20, audioContext.currentTime);
    toggle = !toggle;
  }, 150);

  document.getElementById("btn_alarme_local").innerText = "🛑 Parar Alarme";
  document.getElementById("btn_alarme_local").style.background = "#000";
};

window.pararAlarmeLocal = function() {
  if (localSirenInterval) {
    clearInterval(localSirenInterval);
    localSirenInterval = null;
  }
  try {
    if (localOsc1) localOsc1.stop();
    if (localOsc2) localOsc2.stop();
  } catch (e) {}
  localOsc1 = null;
  localOsc2 = null;

  document.getElementById("btn_alarme_local").innerText = "🔊 Alarme de Pânico";
  document.getElementById("btn_alarme_local").style.background = "linear-gradient(135deg, var(--cpad, var(--primary)), var(--cpad-dark, #059669))";
};

window.alternarAlarmeLocal = function() {
  if (localSirenInterval) {
    window.pararAlarmeLocal();
  } else {
    window.tocarAlarmeLocal();
  }
};

window.alternarApitoSocorro = function() {
  if (whistleOsc) {
    try {
      whistleOsc.stop();
    } catch (e) {}
    whistleOsc = null;
    document.getElementById("btn_apito").innerText = "😗 Ativar Apito de Socorro";
    document.getElementById("btn_apito").style.background = "#4a5568";
  } else {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    whistleOsc = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    gainNode.gain.setValueAtTime(0.8, audioContext.currentTime);

    whistleOsc.type = "sine";
    whistleOsc.frequency.setValueAtTime(2500, audioContext.currentTime); 

    whistleOsc.connect(gainNode);
    gainNode.connect(audioContext.destination);
    whistleOsc.start();

    document.getElementById("btn_apito").innerText = "🛑 Parar Apito";
    document.getElementById("btn_apito").style.background = "#000";
  }
};


// ==============================================
// LÓGICA DE RASTREAMENTO GPS E PÂNICO
// ==============================================
function iniciarRastreamentoGPSContinuo() {
  if (!navigator.geolocation) return;
  
  const gpsBtn = document.getElementById("p_gps_btn");
  
  navigator.geolocation.watchPosition((position) => {
    currentCoords = {
      lat: position.coords.latitude,
      lng: position.coords.longitude
    };
    const gpsStatus = document.getElementById("p_gps_status");
    if (gpsStatus) {
      gpsStatus.innerHTML = `📍 GPS Ativo: <b>${currentCoords.lat.toFixed(5)}, ${currentCoords.lng.toFixed(5)}</b>`;
    }
    if (gpsBtn) {
      gpsBtn.innerText = "✅ GPS Atualizado (Ativo)";
      gpsBtn.style.background = "linear-gradient(135deg, #10b981, #059669)";
    }
    
    // Atualiza a lista de postos de apoio por distância na aba Apoio
    window.atualizarListaApoioProximidade();

    // Atualiza a posição no alerta em tempo real se estiver em perigo
    if (currentRole === 'protegida' && userId) {
      get(ref(db, `arqueiro/alertas/${userId}/status`)).then(async (snap) => {
        if (snap.exists() && snap.val() === "perigo") {
          await update(ref(db, `arqueiro/alertas/${userId}/gps`), {
            lat: currentCoords.lat,
            lng: currentCoords.lng
          });
        }
      });
    }
  }, (error) => {
    console.warn("Erro no rastreamento contínuo:", error.message);
  }, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  });
}

async function dispararAlertaPanico() {
  isAlertActive = true; 

  const activeSuspectId = document.getElementById("p_select_suspeito").value;
  let suspectData = null;

  if (activeSuspectId !== 'nenhum') {
    const snap = await get(ref(db, `arqueiro/suspeitos/${userId}/${activeSuspectId}`));
    if (snap.exists()) suspectData = snap.val();
  }

  const gpsEnvio = currentCoords || {
    lat: -30.0084, // Fallback Alvorada/RS de testes
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

  // Garante escrita unificada dos dados de uma única vez para o Guardião
  await set(ref(db, `arqueiro/alertas/${userId}`), pacoteAlerta);

  // Exibe a tela de aviso gigante com botão Estou Bem
  document.getElementById("p_panic_warning_overlay").classList.add("active");

  panicStatusText.innerHTML = "🚨 <b>ALERTA DE PÂNICO DISPARADO!</b>";
  
  iniciarGravacaoSilenciosa(); 
  window.atualizarGPS(); 
}

// Botão "Estou Bem" (Reseta o Alerta para Seguro)
window.enviarEstouBem = async function() {
  if (!userId) return;

  // Desativa o alerta na nuvem do Firebase
  await update(ref(db, `arqueiro/alertas/${userId}`), {
    status: "seguro",
    audio: null 
  });

  isAlertActive = false; // Libera o botão de pânico para novos acionamentos
  panicTapsCount = 0;
  resetarToquesPanico();

  // Fecha o aviso gigante na tela da Protegida
  document.getElementById("p_panic_warning_overlay").classList.remove("active");
  alert("Alerta encerrado. Seu guardião foi informado de que você está bem.");
};

window.atualizarGPS = function() {
  const gpsBtn = document.getElementById("p_gps_btn");
  const gpsStatus = document.getElementById("p_gps_status");
  if (!navigator.geolocation) {
    gpsStatus.innerText = "GPS não suportado pelo seu navegador.";
    return;
  }

  if (gpsBtn) {
    gpsBtn.innerText = "⏳ GPS Atualizando...";
    gpsBtn.style.background = "linear-gradient(135deg, #f59e0b, #d97706)";
  }

  navigator.geolocation.getCurrentPosition(async (position) => {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    
    currentCoords = { lat, lng };
    gpsStatus.innerHTML = `📍 GPS Atualizado: <b>${lat.toFixed(5)}, ${lng.toFixed(5)}</b>`;

    if (gpsBtn) {
      gpsBtn.innerText = "✅ GPS Atualizado";
      gpsBtn.style.background = "linear-gradient(135deg, #10b981, #059669)";
    }

    // Atualiza a lista de apoio pela nova coordenada obtida
    window.atualizarListaApoioProximidade();

    // Se o pânico já estiver ativo, atualiza o GPS
    get(ref(db, `arqueiro/alertas/${userId}/status`)).then(async (snap) => {
      if (snap.exists() && snap.val() === "perigo") {
        await update(ref(db, `arqueiro/alertas/${userId}/gps`), {
          lat: lat,
          lng: lng
        });
      }
    });

  }, (error) => {
    gpsStatus.innerText = "Erro ao carregar GPS de alta precisão.";
    if (gpsBtn) {
      gpsBtn.innerText = "❌ Erro no GPS (Tentar Novamente)";
      gpsBtn.style.background = "linear-gradient(135deg, #ef4444, #dc2626)";
    }
    console.error(error);
  }, { enableHighAccuracy: true, timeout: 8000 });
};

// ==============================================
// LÓGICA DE EDICÃO E EXCLUSÃO DE SUSPEITOS
// ==============================================
window.editarSuspeito = async function(susId) {
  try {
    const snap = await get(ref(db, `arqueiro/suspeitos/${userId}/${susId}`));
    if (snap.exists()) {
      const sus = snap.val();
      editingSuspectId = susId;

      document.getElementById("sus_nome").value = sus.nome || "";
      document.getElementById("sus_caract").value = sus.caract || "";
      document.getElementById("sus_veiculo").value = sus.veiculo || "";

      document.getElementById("sus_form_title").innerText = "✏️ Editar Suspeito";
      const saveBtn = document.getElementById("btn_salvar_suspeito");
      saveBtn.innerText = "✏️ Atualizar Suspeito";
      saveBtn.style.background = "linear-gradient(135deg, #f59e0b, #d97706)";

      document.getElementById("btn_cancelar_edicao").style.display = "block";

      switchTab('suspeitos');
    }
  } catch (error) {
    console.error(error);
  }
};

window.cancelarEdicaoSuspeito = function() {
  editingSuspectId = null;

  document.getElementById("sus_nome").value = "";
  document.getElementById("sus_foto").value = "";
  document.getElementById("sus_caract").value = "";
  document.getElementById("sus_veiculo").value = "";

  document.getElementById("sus_form_title").innerText = "➕ Cadastrar Novo Suspeito";
  const saveBtn = document.getElementById("btn_salvar_suspeito");
  saveBtn.innerText = "Salvar no Acervo";
  saveBtn.style.background = "linear-gradient(135deg, var(--cpad, var(--primary)), var(--cpad-dark, #059669))";

  document.getElementById("btn_cancelar_edicao").style.display = "none";
};

window.removerSuspeito = async function(susId) {
  if (confirm("⚠️ Deseja realmente remover permanentemente este suspeito do seu acervo?")) {
    await set(ref(db, `arqueiro/suspeitos/${userId}/${susId}`), null);
    alert("Suspeito removido do acervo.");
  }
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
  } else if (editingSuspectId) {
    const snap = await get(ref(db, `arqueiro/suspeitos/${userId}/${editingSuspectId}`));
    if (snap.exists() && snap.val().foto) {
      fotoBase64 = snap.val().foto;
    }
  }

  const idSus = editingSuspectId || "sus_" + Date.now();
  await set(ref(db, `arqueiro/suspeitos/${userId}/${idSus}`), {
    id: idSus,
    nome: nome,
    foto: fotoBase64,
    caract: caract,
    veiculo: veiculo
  });

  window.cancelarEdicaoSuspeito();
  alert(editingSuspectId ? "Cadastro atualizado com sucesso!" : "Suspeito cadastrado com sucesso!");
};

function syncProtegidaData() {
  onValue(ref(db, `arqueiro/suspeitos/${userId}`), (snapshot) => {
    const select = document.getElementById("p_select_suspeito");
    const listDiv = document.getElementById("p_lista_suspeitos");
    
    select.innerHTML = '<option value="nenhum">Nenhum suspeito selecionado</option>';
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
            <div class="suspect-metadata" style="margin-bottom: 6px;"><strong>Veículo:</strong> ${sus.veiculo || '--'}</div>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-secondary" onclick="editarSuspeito('${sus.id}')" style="padding: 4px 8px; font-size: 0.72rem; border-radius: 4px;">✏️ Editar</button>
              <button class="btn btn-danger" onclick="removerSuspeito('${sus.id}')" style="padding: 4px 8px; font-size: 0.72rem; border-radius: 4px; background: #dc2626;">🗑️ Excluir</button>
            </div>
          </div>
        `;
        listDiv.appendChild(item);
      });
    } else {
      listDiv.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 20px 0;">Nenhum agressor ou suspeito cadastrado.</p>';
    }
  });
}

// =========================================================================
// SISTEMA DE MAPEAMENTO FLEXÍVEL DE APOIO (POR CIDADE E PROXIMIDADE)
// =========================================================================

// Busca o nome do local atual de forma simplificada (ex: "Bairro, Cidade")
async function obterNomeLocal(lat, lng) {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, {
      headers: { 'User-Agent': 'SistemaArqueiro/1.0' }
    });
    if (response.ok) {
      const data = await response.json();
      const addr = data.address;
      // Monta o nome do local de forma legível (ex: "Sumaré, Alvorada" ou "Centro, Alegrete")
      const localidade = addr.suburb || addr.neighbourhood || addr.city || addr.town || addr.municipality || "Sua localização";
      const cidade = addr.city || addr.town || addr.municipality || "";
      return localidade !== cidade && cidade ? `${localidade} (${cidade})` : localidade;
    }
  } catch (e) {
    console.error("Erro na leitura amigável do local:", e);
  }
  return "Sua localização"; // Fallback seguro
}

// Busca o endereço detalhado completo (Rua, Número, Bairro, Cidade) para o Guardião
async function obterEnderecoAproximado(lat, lng) {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, {
      headers: {
        'User-Agent': 'SistemaArqueiro/1.0'
      }
    });
    if (response.ok) {
      const data = await response.json();
      const addr = data.address;
      if (addr) {
        const rua = addr.road || addr.pedestrian || addr.suburb || "Rua não identificada";
        const numero = addr.house_number ? `, nº ${addr.house_number}` : ", s/n";
        const bairro = addr.suburb || addr.neighbourhood ? ` - ${addr.suburb || addr.neighbourhood}` : "";
        const cidade = addr.city || addr.town || addr.municipality ? ` (${addr.city || addr.town || addr.village || addr.municipality})` : "";
        return `${rua}${numero}${bairro}${cidade}`;
      }
      return data.display_name || "Endereço aproximado não localizado";
    }
  } catch (e) {
    console.error("Erro ao buscar endereço aproximado:", e);
  }
  return "Localização obtida (Rua não identificada)";
}

// Busca dinamicamente os postos de apoio prioritários perto das coordenadas GPS da Protegida
async function pesquisarPostosLocaisPorGPS(lat, lng) {
  const queries = [
    { tipo: "delegacia", q: "Delegacia", icon: "👮" },
    { tipo: "bombeiros", q: "Bombeiros", icon: "🚒" },
    { tipo: "hospital", q: "Hospital", icon: "🏥" }
  ];

  const resultados = [];

  for (const item of queries) {
    try {
      // Passamos 'lat' e 'lon' como parâmetros da URL de busca do Nominatim.
      // Isso força a API a procurar e priorizar os resultados mais próximos deste ponto geográfico.
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(item.q)}&format=json&lat=${lat}&lon=${lng}&limit=3`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'SistemaArqueiro/1.0' }
      });
      if (response.ok) {
        const data = await response.json();
        data.forEach(place => {
          const dist = calcularDistancia(lat, lng, parseFloat(place.lat), parseFloat(place.lon));
          // Filtra para pegar apenas postos de apoio num raio razoável (ex: até 50km)
          if (dist <= 50) {
            resultados.push({
              nome: place.name || place.display_name.split(",")[0],
              endereco: place.display_name,
              lat: parseFloat(place.lat),
              lng: parseFloat(place.lon),
              tipo: item.tipo,
              icon: item.icon,
              distancia: dist
            });
          }
        });
      }
    } catch (e) {
      console.error("Erro ao pesquisar " + item.q, e);
    }
  }

  // Se não encontrar resultados dinâmicos (offline ou sem retorno), usa os postos padrão Porto Alegre/Alvorada de backup
  if (resultados.length === 0) {
    return pontosApoioPadrao.map(p => {
      const dist = calcularDistancia(lat, lng, p.lat, p.lng);
      return { ...p, distancia: dist };
    });
  }

  // Ordena por proximidade
  resultados.sort((a, b) => a.distancia - b.distancia);
  
  // Retorna os 5 postos de apoio mais próximos no total para manter a tela limpa
  return resultados.slice(0, 5);
}

window.atualizarListaApoioProximidade = async function() {
  const container = document.getElementById("p_lista_apoio_dinamica");
  const statusText = document.getElementById("p_apoio_gps_status");
  if (!container) return;

  if (!currentCoords) {
    statusText.innerHTML = "⏳ Aguardando sinal do GPS para carregar os postos de apoio mais próximos...";
    renderizarListaApoio(pontosApoioPadrao.map(p => ({ ...p, distancia: 0 })), false);
    return;
  }

  try {
    const localNome = await obterNomeLocal(currentCoords.lat, currentCoords.lng);
    
    // Evita requisições repetidas se as coordenadas não mudaram significativamente
    if (lastSearchedCity === localNome && lastSearchedCoords) {
      const distSinceLastSearch = calcularDistancia(currentCoords.lat, currentCoords.lng, lastSearchedCoords.lat, lastSearchedCoords.lng);
      if (distSinceLastSearch < 1.0) {
        return; // Retorna sem refazer a requisição à API
      }
    }

    lastSearchedCity = localNome;
    lastSearchedCoords = currentCoords;

    statusText.innerHTML = `🔍 Buscando postos de apoio próximos de <b>${localNome}</b>...`;

    // Realiza a busca focada nas coordenadas atuais
    const locaisProximos = await pesquisarPostosLocaisPorGPS(currentCoords.lat, currentCoords.lng);
    statusText.innerHTML = `📍 Postos de apoio mais próximos de <b>${localNome}</b>:`;
    renderizarListaApoio(locaisProximos, true);

  } catch (error) {
    console.error("Erro na busca de apoio dinâmico:", error);
    statusText.innerHTML = "⚠️ Não foi possível obter postos dinâmicos. Exibindo acervo padrão de Porto Alegre/Alvorada:";
    renderizarListaApoio(pontosApoioPadrao.map(p => ({ ...p, distancia: 0 })), false);
  }
};

function renderizarListaApoio(lista, mostrarDistancia) {
  const container = document.getElementById("p_lista_apoio_dinamica");
  if (!container) return;
  container.innerHTML = "";

  lista.forEach((ponto, index) => {
    const item = document.createElement("div");
    item.style.borderBottom = index < lista.length - 1 ? "1px dashed var(--border)" : "none";
    item.style.paddingBottom = "12px";
    item.style.marginBottom = "8px";

    const distanciaTexto = mostrarDistancia 
      ? `<span style="background: var(--primary-glow); color: var(--text); padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 0.72rem; margin-left: 6px;">A ${ponto.distancia.toFixed(1)} km</span>` 
      : "";

    item.innerHTML = `
      <p style="margin-bottom: 6px; font-size: 0.88rem; line-height: 1.4;">
        <b>${index + 1}. ${ponto.nome}</b> ${distanciaTexto}<br/>
        <span style="color: var(--text-muted); font-size: 0.8rem;">${ponto.endereco}</span>
      </p>
      <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ponto.nome + ' ' + ponto.endereco)}" target="_blank" class="btn" style="padding: 6px 12px; font-size: 0.78rem; text-decoration: none; display: inline-flex; width: auto; font-weight: 700; margin-top: 4px; border-radius: 6px;">🗺️ Traçar Rota</a>
    `;
    container.appendChild(item);
  });
}

window.switchTab = function(tabName) {
  document.querySelectorAll(".p-tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));

  document.getElementById(`p_tab_${tabName}`).classList.add("active");
  event.currentTarget.classList.add("active");

  if (tabName === 'apoio') {
    window.atualizarListaApoioProximidade();
  }
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
};

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

        // Ficha do Suspeito Selecionado no Alerta
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

// ==============================================
// SINTETIZADOR DE SIRENE POLICIAL METÁLICA E ESTRONDOSA (Web Audio Synth)
// ==============================================
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