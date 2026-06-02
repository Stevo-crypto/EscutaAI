alert("EstudaAI Inicializado - Correção de EPUB e OCR Ativados!");

if (typeof window.speechSynthesis === 'undefined') {
    window.speechSynthesis = {
        speaking: false, pending: false, paused: false,
        speak: function() { }, cancel: function() { }, pause: function() { }, resume: function() { }
    };
    window.SpeechSynthesisUtterance = function(txt) { this.text = txt; this.lang = "pt-BR"; };
}

const fileInput = document.getElementById("fileInput");
const playBtn = document.getElementById("playBtn");
const stopBtn = document.getElementById("stopBtn");
const prevBtn = document.getElementById("prevBtn"); 
const nextBtn = document.getElementById("nextBtn"); 

const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const bookListContainer = document.getElementById("bookList");

const shelfToggleBtn = document.getElementById("shelfToggleBtn");
const shelfArrow = document.getElementById("shelfArrow");

const aumentarFonteBtn = document.getElementById("aumentarFonteBtn");
const diminuirFonteBtn = document.getElementById("diminuirFonteBtn"); 
const toggleDarkModeBtn = document.getElementById("toggleDarkModeBtn");

const lineCurrent = document.getElementById("lineCurrent");
const lineNext1 = document.getElementById("lineNext1");
const lineNext2 = document.getElementById("lineNext2");
const modalOverlay = document.getElementById("modalOverlay");
const modalTextArea = document.getElementById("modalTextArea");
const openModalBtn = document.getElementById("openModalBtn");
const closeModalBtn = document.getElementById("closeModalBtn");

let blocosDeTexto = []; 
let indiceAtual = 0;    
let estaPausado = false; 
let tamanhoFonteAtual = 1.1; 
let nomeArquivoAtual = "Documento Sem Nome";
let textoCompletoBruto = ""; 
let temporizadorFala = null;

let db;
const request = indexedDB.open("EstudaAIBiblioteca", 1);

request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("livros")) {
        db.createObjectStore("livros", { keyPath: "nome" });
    }
};

request.onsuccess = (e) => {
    db = e.target.result;
    carregarPrateleiraVisual(); 
    recuperarUltimoLivroLido();
};

function salvarLivroNoBanco(nome, texto, indice) {
    if (!db) return;
    const transacao = db.transaction(["livros"], "readwrite");
    const armazem = transacao.objectStore("livros");
    armazem.put({ nome: nome, texto: texto, indice: indice, dataModificacao: Date.now() });
    transacao.oncomplete = () => { carregarPrateleiraVisual(); };
}

function carregarPrateleiraVisual() {
    if (!db || !bookListContainer) return;
    const transacao = db.transaction(["livros"], "readonly");
    const armazem = transacao.objectStore("livros");
    const requisicao = armazem.getAll();

    requisicao.onsuccess = () => {
        const livros = requisicao.result;
        bookListContainer.innerHTML = ""; 
        if (livros.length === 0) {
            bookListContainer.innerHTML = "<p style='font-size:0.85rem; margin:5px; color:#888;'>Nenhum livro salvo ainda.</p>";
            return;
        }
        livros.sort((a, b) => b.dataModificacao - a.dataModificacao);
        livros.forEach(livro => {
            const paginas = livro.texto.split(/--- FIM DA PÁGINA \d+ ---/);
            let porcentagem = 0;
            if (paginas.length > 1) {
                porcentagem = Math.round((livro.indice / (partesDoLivro(livro.texto))) * 100);
                if (porcentagem > 100) porcentagem = 100;
            }
            const card = document.createElement("div");
            card.className = "book-card";
            if (livro.nome === nomeArquivoAtual) { card.style.borderColor = "#008b8b"; card.style.borderWidth = "2px"; }
            card.innerHTML = `
                <div class="book-info"><span class="book-name">${livro.nome}</span><span class="book-percentage">${porcentagem}%</span></div>
                <button class="btn-delete">❌</button>
                <div class="book-mini-progress-bg"><div class="book-mini-progress-fill" style="width: ${porcentagem}%;"></div></div>
            `;
            card.addEventListener("click", () => { trocarDeLivro(livro.nome); });
            card.querySelector(".btn-delete").addEventListener("click", (e) => { e.stopPropagation(); excluirLivroIndividual(livro.nome); });
            bookListContainer.appendChild(card);
        });
    };
}

function partesDoLivro(texto) {
    const partes = texto.split(/--- FIM DA PÁGINA \d+ ---/);
    let total = 0;
    partes.forEach(p => { if(p.trim().length > 3) total++; });
    return total > 0 ? total : 1;
}

function excluirLivroIndividual(nome) {
    if (!db) return;
    if (confirm(`Deseja remover "${nome}" da sua prateleira?`)) {
        const transacao = db.transaction(["livros"], "readwrite");
        const armazem = transacao.objectStore("livros");
        armazem.delete(nome);
        transacao.oncomplete = () => {
            if (nome === nomeArquivoAtual) {
                pararAudioGeral(); localStorage.removeItem("estudaai_ultimo_livro");
                nomeArquivoAtual = "Documento Sem Nome"; blocosDeTexto = []; indiceAtual = 0; estaPausado = false;
                playBtn.textContent = "▶"; textoCompletoBruto = ""; modalTextArea.value = ""; renderizarModoFoco(); atualizarBarraProgresso();
            }
            carregarPrateleiraVisual();
        };
    }
}

function trocarDeLivro(nome) {
    const transacao = db.transaction(["livros"], "readonly");
    const armazem = transacao.objectStore("livros");
    const requisicao = armazem.get(nome);
    requisicao.onsuccess = () => {
        const livro = requisicao.result;
        if (livro) {
            pararAudioGeral(); estaPausado = true; playBtn.textContent = "▶";
            nomeArquivoAtual = livro.nome; textoCompletoBruto = livro.texto; modalTextArea.value = livro.texto; indiceAtual = livro.indice;
            reconstruirEstruturaPorPaginas(livro.texto);
            localStorage.setItem("estudaai_ultimo_livro", nome);
            atualizarBarraProgresso(); carregarPrateleiraVisual(); renderizarModoFoco();
        }
    };
}

function recuperarUltimoLivro Lido() {
    const ultimoNome = localStorage.getItem("estudaai_ultimo_livro");
    if (ultimoNome) trocarDeLivro(ultimoNome);
}

function reconstruirEstruturaPorPaginas(texto) {
    const partesRaw = texto.split(/--- FIM DA PÁGINA \d+ ---/);
    blocosDeTexto = [];
    for (let i = 0; i < partesRaw.length; i++) {
        let conteudoPagina = partesRaw[i].trim();
        if (conteudoPagina.length > 3) blocosDeTexto.push(conteudoPagina);
    }
}

function renderizarModoFoco() {
    if (blocosDeTexto.length === 0) {
        lineCurrent.textContent = "Selecione um arquivo (PDF, TXT, EPUB)...";
        lineNext1.textContent = ""; lineNext2.textContent = ""; return;
    }
    lineCurrent.textContent = blocosDeTexto[indiceAtual] ? blocosDeTexto[indiceAtual] : "Fim do arquivo.";
    lineNext1.textContent = blocosDeTexto[indiceAtual + 1] ? `[Pág. Seguinte]: ${blocosDeTexto[indiceAtual + 1].substring(0, 120)}...` : "";
    lineNext2.textContent = blocosDeTexto[indiceAtual + 2] ? `[Próxima Pág.]: ${blocosDeTexto[indiceAtual + 2].substring(0, 120)}...` : "";
    lineCurrent.scrollTop = 0;
}

function salvarProgressoNoDispositivo() { if (blocosDeTexto.length > 0) salvarLivroNoBanco(nomeArquivoAtual, textoCompletoBruto, indiceAtual); }

function atualizarBarraProgresso() {
    if (blocosDeTexto.length === 0) { progressBar.style.width = "0%"; progressText.textContent = "Progresso: Página 0 de 0"; return; }
    let numPaginaAtual = indiceAtual + 1; if (numPaginaAtual > blocosDeTexto.length) numPaginaAtual = blocosDeTexto.length;
    let porcentagem = Math.round((indiceAtual / blocosDeTexto.length) * 100); if (porcentagem > 100) porcentagem = 100;
    progressBar.style.width = porcentagem + "%"; progressText.textContent = `Página ${numPaginaAtual} de ${blocosDeTexto.length} (${porcentagem}%)`;
}

modalTextArea.addEventListener("click", () => {
    if (blocosDeTexto.length === 0) return;
    const posicaoClique = modalTextArea.selectionStart;
    let acumuladorCaracteres = 0; let novoIndice = -1;
    for (let i = 0; i < blocosDeTexto.length; i++) {
        let tamanhoBloco = textoCompletoBruto.indexOf(`--- FIM DA PÁGINA ${i+1} ---`);
        if (tamanhoBloco === -1) tamanhoBloco = blocosDeTexto[i].length;
        if (posicaoClique >= acumuladorCaracteres && posicaoClique <= acumuladorCaracteres + tamanhoBloco) { novoIndice = i; break; }
        acumuladorCaracteres += blocosDeTexto[i].length + 30;
    }
    if (novoIndice !== -1) {
        pararAudioGeral(); indiceAtual = novoIndice; salvarProgressoNoDispositivo(); atualizarBarraProgresso(); renderizarModoFoco();
        modalOverlay.style.display = "none"; if (!estaPausado) lerBlocoAtual();
    }
});

openModalBtn.addEventListener("click", () => {
    if (!textoCompletoBruto) { alert("Nenhum livro carregado!"); return; }
    modalOverlay.style.display = "flex"; modalTextArea.focus();
});
closeModalBtn.addEventListener("click", () => { modalOverlay.style.display = "none"; });

fileInput.addEventListener("change", async (event) => {
    try {
        const arquivo = event.target.files[0]; if (!arquivo) return;
        pararAudioGeral(); blocosDeTexto = []; indiceAtual = 0; estaPausado = true; playBtn.textContent = "▶";
        lineCurrent.textContent = "Abrindo e analisando estrutura do arquivo...";
        nomeArquivoAtual = arquivo.name;
        
        const extensao = arquivo.name.toLowerCase();
        if (extensao.endsWith(".pdf")) { 
            lerArquivoPDF(arquivo); 
        } else if (extensao.endsWith(".epub")) {
            lerArquivoEPUB(arquivo);
        } else { 
            lerArquivoTXT(arquivo); 
        }
    } catch (erro) { alert("Erro: " + erro.message); }
});

function lerArquivoTXT(arquivo) {
    const leitor = new FileReader();
    leitor.onload = (e) => {
        let rawTxt = e.target.result; textoCompletoBruto = rawTxt + "\n\n--- FIM DA PÁGINA 1 ---"; modalTextArea.value = textoCompletoBruto;
        reconstruirEstruturaPorPaginas(textoCompletoBruto); localStorage.setItem("estudaai_ultimo_livro", nomeArquivoAtual);
        salvarLivroNoBanco(nomeArquivoAtual, textoCompletoBruto, 0); atualizarBarraProgresso(); renderizarModoFoco();
    };
    leitor.readAsText(arquivo);
}

function lerArquivoPDF(arquivo) {
    const leitor = new FileReader();
    leitor.onload = async function (e) {
        try {
            const dados = new Uint8Array(e.target.result);
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            const carregandoPDF = pdfjsLib.getDocument({ data: dados, useWorkerFetch: false, isEvalSupported: false });
            const pdf = await carregandoPDF.promise; let textoAcumuladoGeral = ""; const totalPaginas = pdf.numPages;
            
            const canvasOculto = document.createElement('canvas');
            const contextoCanvas = canvasOculto.getContext('2d');

            for (let i = 1; i <= totalPaginas; i++) {
                lineCurrent.textContent = `Processando página ${i} de ${totalPaginas}...`;
                try {
                    const pagina = await pdf.getPage(i); 
                    const conteudoTexto = await pagina.getTextContent();
                    
                    let textoPaginaCru = ""; 
                    for (const item of conteudoTexto.items) { textoPaginaCru += item.str + " "; }
                    
                    let textoPaginaLimpo = textoPaginaCru
                        .replace(/[\r\n\t\f\v]/g, " ") 
                        .replace(/\s+/g, " ")          
                        .trim();
                    
                    let apenasLetras = textoPaginaLimpo.replace(/[^a-zA-ZáàâãéèêíïóôõöúçñÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇÑ\s]/g, "");
                    
                    if (textoPaginaLimpo.length > 25 && apenasLetras.trim().length > (textoPaginaLimpo.length * 0.4)) {
                        textoAcumuladoGeral += textoPaginaLimpo + `\n\n--- FIM DA PÁGINA ${i} ---\n\n`;
                    } else {
                        lineCurrent.textContent = `Escaneando texto por inteligência artificial na pág. ${i}...`;
                        
                        const visualizacao = pagina.getViewport({ scale: 1.5 });
                        canvasOculto.height = visualizacao.height;
                        canvasOculto.width = visualizacao.width;
                        
                        await pagina.render({ canvasContext: contextoCanvas, viewport: visualizacao }).promise;
                        const imagemUrl = canvasOculto.toDataURL('image/jpeg');
                        
                        const resultadoOcr = await Tesseract.recognize(imagemUrl, 'por');
                        let textoOcrLimpo = resultadoOcr.data.text.replace(/[\r\n\t\f\v]/g, " ").replace(/\s+/g, " ").trim();
                        
                        if (textoOcrLimpo.length > 3) {
                            textoAcumuladoGeral += textoOcrLimpo + `\n\n--- FIM DA PÁGINA ${i} ---\n\n`;
                        } else {
                            textoAcumuladoGeral += "[Página vazia ou sem texto legível]\n\n" + `--- FIM DA PÁGINA ${i} ---\n\n`;
                        }
                    }
                } catch (erroPagina) {
                    textoAcumuladoGeral += "[Erro ao processar dados desta página]\n\n" + `--- FIM DA PÁGINA ${i} ---\n\n`;
                    continue;
                }
            }
            
            textoCompletoBruto = textoAcumuladoGeral; modalTextArea.value = textoAcumuladoGeral;
            reconstruirEstruturaPorPaginas(textoAcumuladoGeral); localStorage.setItem("estudaai_ultimo_livro", nomeArquivoAtual);
            salvarLivroNoBanco(nomeArquivoAtual, textoAcumuladoGeral, 0); atualizarBarraProgresso(); renderizarModoFoco();
        } catch (err) { alert("Erro PDF: " + err.message); }
    };
    leitor.readAsArrayBuffer(arquivo);
}

// FUNÇÃO EPUB CORRIGIDA CONFORME A DOCUMENTAÇÃO ATUAL DA BIBLIOTECA
function lerArquivoEPUB(arquivo) {
    if (typeof ePub === 'undefined') {
        alert("Biblioteca EPUB não inicializada no index.html.");
        return;
    }
    const leitor = new FileReader();
    leitor.onload = async function (e) {
        try {
            lineCurrent.textContent = "Processando capítulos do EPUB...";
            const livroEpub = ePub(e.target.result);
            await livroEpub.ready;
            
            let textoAcumuladoGeral = "";
            let contadorPagina = 1;
            
            // Método correto de navegação sequencial da estrutura do EpubJS
            const secoesDoLivro = livroEpub.spine;
            
            for (let i = 0; i < secoesDoLivro.length; i++) {
                const itemSpine = secoesDoLivro.get(i);
                if (itemSpine) {
                    // Carrega o documento do capítulo diretamente pelo core do livro
                    await itemSpine.load(livroEpub.load.bind(livroEpub));
                    const documentoCapitulo = itemSpine.document;
                    
                    if (documentoCapitulo && documentoCapitulo.body) {
                        let textoCapitulo = documentoCapitulo.body.innerText || documentoCapitulo.body.textContent || "";
                        let textoLimpo = textoCapitulo.replace(/\s+/g, " ").trim();
                        
                        if (textoLimpo.length > 10) {
                            textoAcumuladoGeral += textoLimpo + `\n\n--- FIM DA PÁGINA ${contadorPagina} ---\n\n`;
                            contadorPagina++;
                        }
                    }
                    itemSpine.unload();
                }
            }
            
            if (textoAcumuladoGeral.trim() === "") {
                lineCurrent.textContent = "Este arquivo EPUB não possui texto extraível legível.";
                return;
            }

            textoCompletoBruto = textoAcumuladoGeral; modalTextArea.value = textoAcumuladoGeral;
            reconstruirEstruturaPorPaginas(textoAcumuladoGeral); localStorage.setItem("estudaai_ultimo_livro", nomeArquivoAtual);
            salvarLivroNoBanco(nomeArquivoAtual, textoAcumuladoGeral, 0); atualizarBarraProgresso(); renderizarModoFoco();
        } catch (erroEpub) {
            alert("Erro ao ler EPUB: " + erroEpub.message);
            lineCurrent.textContent = "Falha ao abrir arquivo EPUB.";
        }
    };
    leitor.readAsArrayBuffer(arquivo);
}

function pararAudioGeral() {
    if (temporizadorFala) { clearTimeout(temporizadorFala); temporizadorFala = null; }
    if (window.AppInventor) { window.AppInventor.setWebViewString("PARAR_AUDIO"); }
}

function lerBlocoAtual() {
    if (indiceAtual >= blocosDeTexto.length || estaPausado) {
        if (indiceAtual >= blocosDeTexto.length && blocosDeTexto.length > 0) {
            atualizarBarraProgresso(); alert("Fim do documento!"); reiniciarLeituraSemDeletar();
        }
        return;
    }
    const textoParaFalar = blocosDeTexto[indiceAtual];
    if (!textoParaFalar || textoParaFalar.trim() === "") { indiceAtual++; lerBlocoAtual(); return; }

    renderizarModoFoco();
    if (temporizadorFala) clearTimeout(temporizadorFala);

    if (window.AppInventor) {
        window.AppInventor.setWebViewString(textoParaFalar.trim());
        
        const tempoEsperaCalculado = (textoParaFalar.length * 75) + 1500;
        temporizadorFala = setTimeout(() => {
            if (!estaPausado) {
                indiceAtual++; salvarProgressoNoDispositivo(); atualizarBarraProgresso(); lerBlocoAtual();
            }
        }, tempoEsperaCalculado);
    }
}

function reiniciarLeituraSemDeletar() {
    pararAudioGeral(); estaPausado = true; playBtn.textContent = "▶"; 
    indiceAtual = 0; salvarProgressoNoDispositivo(); atualizarBarraProgresso(); renderizarModoFoco();
}

playBtn.addEventListener("click", () => {
    if (blocosDeTexto.length === 0) { alert("Selecione um arquivo!"); return; }
    if (!estaPausado) { estaPausado = true; playBtn.textContent = "▶"; pararAudioGeral(); } 
    else { estaPausado = false; playBtn.textContent = "⏸"; lerBlocoAtual(); }
});

stopBtn.addEventListener("click", () => { reiniciarLeituraSemDeletar(); });
prevBtn.addEventListener("click", () => { if (indiceAtual > 0) { pararAudioGeral(); indiceAtual--; salvarProgressoNoDispositivo(); atualizarBarraProgresso(); renderizarModoFoco(); if (!estaPausado) lerBlocoAtual(); } });
nextBtn.addEventListener("click", () => { if (indiceAtual < blocosDeTexto.length - 1) { pararAudioGeral(); indiceAtual++; salvarProgressoNoDispositivo(); atualizarBarraProgresso(); renderizarModoFoco(); if (!estaPausado) lerBlocoAtual(); } });
shelfToggleBtn.addEventListener("click", () => { bookListContainer.classList.toggle("show"); shelfArrow.textContent = bookListContainer.classList.contains("show") ? "▼" : "▶"; });
aumentarFonteBtn.addEventListener("click", () => { tamanhoFonteAtual += 0.1; lineCurrent.style.fontSize = tamanhoFonteAtual + "rem"; });
diminuirFonteBtn.addEventListener("click", () => { if (tamanhoFonteAtual > 0.8) { tamanhoFonteAtual -= 0.1; lineCurrent.style.fontSize = tamanhoFonteAtual + "rem"; } });
toggleDarkModeBtn.addEventListener("click", () => { document.body.classList.toggle("dark-mode"); toggleDarkModeBtn.textContent = document.body.classList.contains("dark-mode") ? "☀️ Modo Claro" : "🌙 Modo Escuro"; });
