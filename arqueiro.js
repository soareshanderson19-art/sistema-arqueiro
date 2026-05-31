import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, onValue, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

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

// Estados e variáveis auxiliares
let currentRole = null;
let userId = null; 
let pairedId = null; 
let panicTimer = null;
let audioContext = null;

// Osciladores extras para som mais encorpado e estrondoso
let sirenOsc1 = null;
let sirenOsc2 = null;
let sirenOsc3 = null;
let sirenOsc4 = null;
let sirenInterval = null;

let fakeCallOscL = null;
let fakeCallOscR = null;
let fakeCallInterval = null;
let lastGpsCoords = ""; 

// Inicialização da interface e solicitações de permissão
if (localStorage.getItem("arqueiro_role")) {
  currentRole = localStorage.getItem("arqueiro_role");
  userId = localStorage.getItem("arqueiro_user_id") || "P-" + Math.floor(Math.random() * 900000 + 100000);
  localStorage.setItem("arqueiro_user_id", userId);
  setupInterface();
}

function setupInterface() {
  document.getElementById("screenLogin").classList.remove("active");
  document.body.className = ""; 

  // Pede permissão para notificações nativas em segundo plano
  if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
    Notification.requestPermission();
  }

  if (currentRole === 'protegida') {
    document.body.classList.add("theme-protegida");
    document.getElementById("screenProtegida").style.display = "flex";
    document.getElementById("p_codigo_id").innerText = userId;
    syncProtegidaData();
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

// Vincula funções ao objeto 'window' global para que os cliques inline do HTML funcionem
window.selectRole = function(role) {
  currentRole = role;
  localStorage.setItem("arqueiro_role", role);
  userId = localStorage.getItem("arqueiro_user_id") || "P-" + Math.floor(Math.random() * 900000 + 100000);
  localStorage.setItem("arqueiro_user_id", userId);
  setupInterface();
};

window.logout = function() {
  localStorage.clear();
  location.reload();
};

// ==============================================
// SEÇÃO: DEFESA - CHAMADA FALSA SIMULADA
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

  // Toque clássico americano de telefone (frequências de 440Hz + 480Hz)
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

    // Pulsação padrão de ringtone (toca por 1.5s, para por 2s)
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
// SEÇÃO: PROTEGIDA - LÓGICA DE PÂNICO E GPS
// ==============================================
const panicBtn = document.getElementById("panicBtn");
const panicProgress = document.getElementById("panicProgress");
const panicStatusText = document.getElementById("panicStatusText");

if (panicBtn) {
  panicBtn.addEventListener("mousedown", iniciarContagemPanico);
  panicBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    iniciarContagemPanico();
  });
}

window.addEventListener("mouseup", pararContagemPanico);
window.addEventListener("touchend", pararContagemPanico);

function iniciarContagemPanico() {
  let count = 0;
  panicStatusText.innerText = "⏳ Mantendo pressionado...";
  panicProgress.classList.add("active");
  
  panicTimer = setInterval(() => {
    count += 1;
    panicProgress.style.borderTopColor = `rgba(239, 68, 68, ${count / 5})`;
    panicProgress.style.transform = `rotate(${(count / 5) * 360 - 90}deg)`;

    if (count >= 5) {
      clearInterval(panicTimer);
      dispararAlertaPanico();
    }
  }, 1000);
}

function pararContagemPanico() {
  if (panicTimer) {
    clearInterval(panicTimer);
    panicTimer = null;
    panicProgress.classList.remove("active");
    panicProgress.style.transform = "rotate(-90deg)";
    panicStatusText.innerText = "Mantenha pressionado para disparar o alerta";
  }
}

async function dispararAlertaPanico() {
  const activeSuspectId = document.getElementById("p_select_suspeito").value;
  let suspectData = null;

  if (activeSuspectId !== 'nenhum') {
    const snap = await get(ref(db, `arqueiro/suspeitos/${userId}/${activeSuspectId}`));
    if (snap.exists()) suspectData = snap.val();
  }

  await set(ref(db, `arqueiro/alertas/${userId}`), {
    status: "perigo",
    timestamp: new Date().toISOString(),
    suspeito: suspectData
  });

  panicStatusText.innerHTML = "🚨 <b>ALERTA DE PÂNICO DISPARADO!</b>";
  window.atualizarGPS(); 
}

window.atualizarGPS = function() {
  const gpsStatus = document.getElementById("p_gps_status");
  if (!navigator.geolocation) {
    gpsStatus.innerText = "GPS não suportado pelo seu navegador.";
    return;
  }

  gpsStatus.innerText = "⏳ Carregando localização GPS...";

  navigator.geolocation.getCurrentPosition(async (position) => {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    
    gpsStatus.innerHTML = `📍 GPS Enviado: <b>${lat.toFixed(5)}, ${lng.toFixed(5)}</b>`;

    await set(ref(db, `arqueiro/alertas/${userId}/gps`), {
      lat: lat,
      lng: lng
    });
  }, (error) => {
    gpsStatus.innerText = "Erro ao carregar GPS. Verifique se as permissões de localização estão ativas.";
    console.error(error);
  }, { enableHighAccuracy: true });
};

// Converte arquivos locais de imagem para Base64 (Texto)
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

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
      fotoBase64 = await fileToBase64(fileInput.files[0]);
    } catch (e) {
      console.error("Erro ao processar imagem:", e);
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
    alert("Por favor, cole o código da protegida.");
    return;
  }
  pairedId = code;
  localStorage.setItem("arqueiro_paired_id", code);
  iniciarMonitoramento(code);
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

  onValue(ref(db, `arqueiro/alertas/${idProtegida}`), (snapshot) => {
    const card = document.getElementById("g_status_card");
    const icon = document.getElementById("g_status_icon");
    const title = document.getElementById("g_status_title");
    const desc = document.getElementById("g_status_desc");
    const btnControls = document.getElementById("g_alarm_buttons");
    const suspectCard = document.getElementById("g_suspect_card");
    const addressEl = document.getElementById("g_status_address");

    if (snapshot.exists()) {
      const alerta = snapshot.val();

      if (alerta.status === "perigo") {
        card.classList.add("alarm-screen");
        icon.innerText = "🚨";
        title.innerText = "PÂNICO ATIVADO!";
        desc.innerHTML = `Sua protegida está em perigo!<br/>Alerta disparado às ${new Date(alerta.timestamp).toLocaleTimeString()}`;
        btnControls.style.display = "block";
        
        tocarSirenePolicial();

        // Envia notificação nativa para o celular do Guardião (mesmo em segundo plano)
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("🚨 EMERGÊNCIA — SISTEMA ARQUEIRO", {
            body: "Sua protegida acionou o pânico! Clique para abrir o mapa de socorro.",
            tag: "arqueiro-panic",
            requireInteraction: true 
          });
        }

        if (alerta.gps) {
          const linkMaps = document.getElementById("g_link_maps");
          linkMaps.href = `https://www.google.com/maps/dir/?api=1&destination=${alerta.gps.lat},${alerta.gps.lng}`;
          linkMaps.style.display = "flex";

          const coordsKey = `${alerta.gps.lat},${alerta.gps.lng}`;
          if (lastGpsCoords !== coordsKey) {
            lastGpsCoords = coordsKey;
            addressEl.style.display = "block";
            addressEl.innerText = "📍 Buscando endereço aproximado...";
            
            obterEnderecoAproximado(alerta.gps.lat, alerta.gps.lng).then(addr => {
              addressEl.innerHTML = `📍 <b>Endereço aproximado:</b><br/>${addr}`;
            });
          }
        } else {
          addressEl.style.display = "none";
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
  lastGpsCoords = "";
}

window.desligarSonsSinal = async function() {
  pararSireneSom();
  if (pairedId) {
    await set(ref(db, `arqueiro/alertas/${pairedId}/status`), "seguro");
  }
};

// =========================================================================
// NOVO SINTETIZADOR DE SIRENE POLICIAL METÁLICA E ESTRONDOSA (Web Audio Synth)
// =========================================================================
function tocarSirenePolicial() {
  if (sirenInterval) return;

  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  // Criamos quatro osciladores independentes dessintonizados para dar som massivo
  sirenOsc1 = audioContext.createOscillator();
  sirenOsc2 = audioContext.createOscillator();
  sirenOsc3 = audioContext.createOscillator();
  sirenOsc4 = audioContext.createOscillator();

  const gainNode = audioContext.createGain();
  // Volume alto de 0.85 para ser estrondoso e piercing
  gainNode.gain.setValueAtTime(0.85, audioContext.currentTime);

  sirenOsc1.type = "sawtooth"; // Som agressivo de serra
  sirenOsc2.type = "sawtooth"; 
  sirenOsc3.type = "square";   // Onda quadrada ruidosa
  sirenOsc4.type = "sine";     // Frequência de sub-grave para vibração

  // Conecta todos ao nó de volume
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
    
    // Oscilação rápida e dissonante de frequências agudas
    const baseFreq = toggle ? 700 : 1100;
    
    sirenOsc1.frequency.setValueAtTime(baseFreq, audioContext.currentTime);
    sirenOsc2.frequency.setValueAtTime(baseFreq + 10, audioContext.currentTime); // Dissonância de batimento
    sirenOsc3.frequency.setValueAtTime(baseFreq / 2, audioContext.currentTime);  // Sub-oitava ruidosa
    sirenOsc4.frequency.setValueAtTime(baseFreq * 1.5, audioContext.currentTime); // Harmônica aguda e irritante
    
    toggle = !toggle;
  }, 250); // Alternância muito rápida (estilo sirene de pânico/alarme industrial)
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