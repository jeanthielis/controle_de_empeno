import { createApp, ref, computed, onMounted, watch, nextTick } from 'vue';
import { db } from './firebase-config.js'; 
import { 
    collection, addDoc, doc, deleteDoc, updateDoc, onSnapshot, query, orderBy 
} from 'firebase/firestore';

createApp({
    setup() {
        const notificacoes = ref([]);
        const notify = (titulo, mensagem, tipo = 'info') => {
            const id = Date.now();
            notificacoes.value.push({ id, titulo, mensagem, tipo });
            setTimeout(() => notificacoes.value = notificacoes.value.filter(n => n.id !== id), 4000);
        };

        const isDarkMode = ref(false);
        const toggleDarkMode = () => {
            isDarkMode.value = !isDarkMode.value;
            if (isDarkMode.value) { document.documentElement.classList.add('dark'); localStorage.setItem('theme', 'dark'); } 
            else { document.documentElement.classList.remove('dark'); localStorage.setItem('theme', 'light'); }
        };

        const currentView = ref('login'); 
        const loginData = ref({ user: '', pass: '', remember: false });
        const loading = ref(false);
        const salvandoAuto = ref(false);
        const relatorioSelecionado = ref(null);
        
        const adminTab = ref('dashboard'); 
        const mobileMenuOpen = ref(false); 
        
        const showStartModal = ref(true);
        
        const filtros = ref({ 
            dataInicio: '', 
            dataFim: '', 
            produto: '', 
            lote: '', 
            posFolga: '',
            resultado: '' 
        });

        const setFiltroRapido = (tipo) => {
            const hoje = new Date();
            const timezoneOffset = hoje.getTimezoneOffset() * 60000;
            const dataLocal = new Date(hoje.getTime() - timezoneOffset);
            const strHoje = dataLocal.toISOString().split('T')[0];
            
            if (tipo === 'hoje') {
                filtros.value.dataInicio = strHoje;
                filtros.value.dataFim = strHoje;
                filtros.value.resultado = '';
            } else if (tipo === 'reprovados_hoje') {
                filtros.value.dataInicio = strHoje;
                filtros.value.dataFim = strHoje;
                filtros.value.resultado = 'Reprovado';
            } else if (tipo === 'mes') {
                const primeiroDia = new Date(dataLocal.getFullYear(), dataLocal.getMonth(), 1).toISOString().split('T')[0];
                filtros.value.dataInicio = primeiroDia;
                filtros.value.dataFim = strHoje;
                filtros.value.resultado = '';
            }
        };

        const filtroAdminProdutos = ref(''); 
        const novoUsuarioForm = ref({ nome: '', matricula: '', admin: false });
        const cadastros = ref({ formatos: [], produtos: [], linhas: [], inspecoes: [], usuarios: [] });

        const currentInspectionId = ref(null);
        const produtoSearch = ref('');
        const mostrandoListaProdutos = ref(false);
        const form = ref({ linha: '', formatoId: '', produto: '', lote: '', posFolga: '', pecas: [] });
        const reportText = ref('');

        const navigateAdmin = (tab) => { adminTab.value = tab; mobileMenuOpen.value = false; };

        const iniciarAnalise = () => {
            if (!form.value.linha || !form.value.formatoId || !form.value.produto || !form.value.lote || !form.value.posFolga) {
                notify('Atenção', 'Preencha todos os campos do cabeçalho para iniciar a análise.', 'erro');
                return;
            }
            showStartModal.value = false;
            salvarRascunho();
        };

        let chartInstance = null;
        let trendChartInstance = null;
        let lateralChartInstance = null; 
        let centralChartInstance = null; 
        
        const filtrosGrafico = ref({ formato: '', data: new Date().toISOString().slice(0, 7) }); 

        const updateCharts = () => {
            const formatoId = filtrosGrafico.value.formato;
            
            // --- GRÁFICO 1: Barras de Qualidade ---
            const ctxQuality = document.getElementById('qualityChart');
            if (ctxQuality) {
                const [ano, mes] = filtrosGrafico.value.data.split('-');

                const dadosFiltrados = cadastros.value.inspecoes.filter(i => {
                    const data = i.dataHora && i.dataHora.seconds ? new Date(i.dataHora.seconds * 1000) : new Date();
                    const matchData = data.getFullYear() == ano && (data.getMonth() + 1) == mes;
                    const matchFormato = formatoId ? i.formatoId === formatoId : true;
                    return matchData && matchFormato;
                });

                const diasNoMes = new Date(ano, mes, 0).getDate();
                const labels = Array.from({length: diasNoMes}, (_, i) => i + 1);
                const aprovados = new Array(diasNoMes).fill(0);
                const reprovados = new Array(diasNoMes).fill(0);

                dadosFiltrados.forEach(i => {
                    const data = i.dataHora && i.dataHora.seconds ? new Date(i.dataHora.seconds * 1000) : new Date();
                    const dia = data.getDate() - 1; 
                    if (i.resultado === 'Aprovado') aprovados[dia]++;
                    else reprovados[dia]++;
                });

                if (chartInstance) chartInstance.destroy();

                chartInstance = new Chart(ctxQuality, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [
                            { label: 'Aprovados', data: aprovados, backgroundColor: '#10b981', borderRadius: 4 },
                            { label: 'Reprovados', data: reprovados, backgroundColor: '#ef4444', borderRadius: 4 }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } }, plugins: { legend: { position: 'bottom' } } }
                });
            }

            // --- PREPARAÇÃO DADOS PARA OS GRÁFICOS DE LINHA ---
            let inspecoesLinha = [...cadastros.value.inspecoes];
            if (formatoId) {
                inspecoesLinha = inspecoesLinha.filter(i => i.formatoId === formatoId);
            }

            const ultimasInspecoes = inspecoesLinha
                .sort((a,b) => {
                    const tA = a.dataHora?.seconds || 0;
                    const tB = b.dataHora?.seconds || 0;
                    return tA - tB;
                })
                .slice(-20); 

            const labelsTrend = ultimasInspecoes.map(i => {
                if (formatoId && i.lote) return `Lote ${i.lote}`;
                return i.formatoNome ? i.formatoNome : formatarData(i.dataHora);
            });

            // --- GRÁFICO 2: Tendência de Média Central ---
            const ctxTrend = document.getElementById('trendChart');
            if (ctxTrend) {
                const dataTrend = ultimasInspecoes.map(i => {
                    let sum = 0; let count = 0;
                    if(i.pecas) {
                        i.pecas.forEach(p => {
                            if(p.centrais) {
                                Object.values(p.centrais).forEach(v => {
                                    if(v !== null && v !== '') { sum += parseFloat(v); count++; }
                                });
                            }
                        });
                    }
                    return count > 0 ? (sum / count).toFixed(2) : 0;
                });

                if (trendChartInstance) trendChartInstance.destroy();

                trendChartInstance = new Chart(ctxTrend, {
                    type: 'line',
                    data: {
                        labels: labelsTrend,
                        datasets: [{
                            label: 'Média Desvio Central',
                            data: dataTrend,
                            borderColor: '#8b5cf6',
                            backgroundColor: 'rgba(139, 92, 246, 0.2)',
                            fill: true,
                            tension: 0.4,
                            pointBackgroundColor: '#8b5cf6'
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: false } } }
                });
            }

            // --- GRÁFICO 3: Controlo Lateral (Min/Max/Picos) ---
            const ctxLateral = document.getElementById('lateralChart');
            if (ctxLateral) {
                const dataMaxMeasured = [];
                const dataMinMeasured = [];
                const dataLimitMax = [];
                const dataLimitMin = [];

                ultimasInspecoes.forEach(i => {
                    let maxVal = -9999; let minVal = 9999; let hasData = false;
                    if (i.pecas) {
                        i.pecas.forEach(p => {
                            if (p.laterais) {
                                Object.values(p.laterais).forEach(v => {
                                    if (v !== null && v !== '') {
                                        const num = parseFloat(v);
                                        if (num > maxVal) maxVal = num;
                                        if (num < minVal) minVal = num;
                                        hasData = true;
                                    }
                                });
                            }
                        });
                    }
                    if (hasData) { dataMaxMeasured.push(maxVal); dataMinMeasured.push(minVal); } 
                    else { dataMaxMeasured.push(null); dataMinMeasured.push(null); }

                    const limites = i.limitesSnapshot || { latMax: 0.5, latMin: -0.5 };
                    dataLimitMax.push(limites.latMax);
                    dataLimitMin.push(limites.latMin);
                });

                if (lateralChartInstance) lateralChartInstance.destroy();

                lateralChartInstance = new Chart(ctxLateral, {
                    type: 'line',
                    data: {
                        labels: labelsTrend, 
                        datasets: [
                            { label: 'Limite Max', data: dataLimitMax, borderColor: 'rgba(239, 68, 68, 0.6)', borderDash: [5, 5], pointRadius: 0, borderWidth: 2, fill: false, tension: 0 },
                            { label: 'Limite Min', data: dataLimitMin, borderColor: 'rgba(239, 68, 68, 0.6)', borderDash: [5, 5], pointRadius: 0, borderWidth: 2, fill: false, tension: 0 },
                            { label: 'Pico (Max)', data: dataMaxMeasured, borderColor: '#3b82f6', backgroundColor: '#3b82f6', pointRadius: 4, borderWidth: 2, fill: false, tension: 0.3 },
                            { label: 'Vale (Min)', data: dataMinMeasured, borderColor: '#f59e0b', backgroundColor: '#f59e0b', pointRadius: 4, borderWidth: 2, fill: false, tension: 0.3 }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: function(context) { return context.dataset.label + ': ' + context.parsed.y.toFixed(2); } } } }, scales: { y: { title: { display: true, text: 'Medição Lateral' } } } }
                });
            }

            // --- GRÁFICO 4: Controlo Central (Min/Max/Picos) ---
            const ctxCentral = document.getElementById('centralChart');
            if (ctxCentral) {
                const dataMaxCentral = [];
                const dataMinCentral = [];
                const dataLimitMaxCentral = [];
                const dataLimitMinCentral = [];

                ultimasInspecoes.forEach(i => {
                    let maxVal = -9999; let minVal = 9999; let hasData = false;
                    if (i.pecas) {
                        i.pecas.forEach(p => {
                            if (p.centrais) {
                                Object.values(p.centrais).forEach(v => {
                                    if (v !== null && v !== '') {
                                        const num = parseFloat(v);
                                        if (num > maxVal) maxVal = num;
                                        if (num < minVal) minVal = num;
                                        hasData = true;
                                    }
                                });
                            }
                        });
                    }
                    if (hasData) { dataMaxCentral.push(maxVal); dataMinCentral.push(minVal); } 
                    else { dataMaxCentral.push(null); dataMinCentral.push(null); }

                    const limites = i.limitesSnapshot || { centMax: 1.0, centMin: -1.0 };
                    dataLimitMaxCentral.push(limites.centMax);
                    dataLimitMinCentral.push(limites.centMin);
                });

                if (centralChartInstance) centralChartInstance.destroy();

                centralChartInstance = new Chart(ctxCentral, {
                    type: 'line',
                    data: {
                        labels: labelsTrend, 
                        datasets: [
                            { label: 'Limite Max', data: dataLimitMaxCentral, borderColor: 'rgba(239, 68, 68, 0.6)', borderDash: [5, 5], pointRadius: 0, borderWidth: 2, fill: false, tension: 0 },
                            { label: 'Limite Min', data: dataLimitMinCentral, borderColor: 'rgba(239, 68, 68, 0.6)', borderDash: [5, 5], pointRadius: 0, borderWidth: 2, fill: false, tension: 0 },
                            { label: 'Pico Central (Max)', data: dataMaxCentral, borderColor: '#10b981', backgroundColor: '#10b981', pointRadius: 4, borderWidth: 2, fill: false, tension: 0.3 },
                            { label: 'Vale Central (Min)', data: dataMinCentral, borderColor: '#8b5cf6', backgroundColor: '#8b5cf6', pointRadius: 4, borderWidth: 2, fill: false, tension: 0.3 }
                        ]
                    },
                    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: function(context) { return context.dataset.label + ': ' + context.parsed.y.toFixed(2); } } } }, scales: { y: { title: { display: true, text: 'Medição Central' } } } }
                });
            }
        };

        const baixarPrintRelatorio = async () => {
            const btn = document.getElementById('btn-print-action');
            if(btn) btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i> Gerando...';

            try {
                const original = document.getElementById('modal-relatorio-content');
                const clone = original.cloneNode(true);
                
                clone.style.position = 'absolute';
                clone.style.top = '-9999px';
                clone.style.left = '0';
                clone.style.width = '800px'; 
                clone.style.height = 'auto'; 
                clone.style.zIndex = '-1000';
                clone.style.overflow = 'visible';
                
                const isDark = isDarkMode.value;
                clone.style.backgroundColor = isDark ? '#0f172a' : '#ffffff';
                clone.style.color = isDark ? '#f1f5f9' : '#1e293b';
                
                clone.classList.remove('h-full', 'max-h-[90vh]'); 

                const scrollableDiv = clone.querySelector('.overflow-y-auto');
                if (scrollableDiv) {
                    scrollableDiv.classList.remove('overflow-y-auto', 'flex-1', 'modal-scroll');
                    scrollableDiv.style.height = 'auto';
                    scrollableDiv.style.overflow = 'visible';
                }

                const originalInputs = original.querySelectorAll('input');
                const clonedInputs = clone.querySelectorAll('input');

                originalInputs.forEach((origInput, index) => {
                    const cloneInput = clonedInputs[index];
                    if (cloneInput) {
                        const valor = origInput.value;
                        const textDiv = document.createElement('div');
                        textDiv.innerText = valor;
                        textDiv.className = cloneInput.className; 
                        textDiv.style.display = 'flex';
                        textDiv.style.alignItems = 'center';
                        textDiv.style.justifyContent = 'center';
                        textDiv.style.background = isDark ? '#1e293b' : '#ffffff'; 
                        textDiv.style.border = isDark ? '1px solid #334155' : '1px solid #e2e8f0'; 
                        
                        if(origInput.classList.contains('border-red-500')) {
                            textDiv.style.borderColor = '#ef4444';
                            textDiv.style.backgroundColor = isDark ? '#450a0a' : '#fef2f2';
                            textDiv.style.color = '#ef4444';
                        }

                        cloneInput.parentNode.replaceChild(textDiv, cloneInput);
                    }
                });

                document.body.appendChild(clone);

                const canvas = await html2canvas(clone, {
                    backgroundColor: isDark ? '#0f172a' : '#ffffff',
                    scale: 2, 
                    windowWidth: 800
                });
                
                document.body.removeChild(clone);

                let dataSegura;
                const rawData = relatorioSelecionado.value.dataHora;
                if (rawData && rawData.seconds) dataSegura = new Date(rawData.seconds * 1000);
                else dataSegura = rawData ? new Date(rawData) : new Date();

                const nomeArquivoData = dataSegura.toLocaleString('pt-BR').replace(/\//g, '-').replace(/:/g, '-').replace(', ', '_');
                const link = document.createElement('a');
                link.download = `Relatorio_${nomeArquivoData}.png`;
                link.href = canvas.toDataURL("image/png");
                link.click();
                
                notify('Sucesso', 'Imagem salva com valores.', 'sucesso');

            } catch (e) {
                console.error(e);
                notify('Erro', 'Falha ao gerar imagem.', 'erro');
            } finally {
                if(btn) btn.innerHTML = '<i class="ph-bold ph-image"></i> Baixar Imagem';
            }
        };

        const stats = computed(() => {
            const lista = cadastros.value.inspecoes;
            const hoje = new Date().toLocaleDateString('pt-BR');
            return {
                total: lista.length,
                posFolga: lista.filter(i => i.posFolga === 'Sim').length,
                reprovados: lista.filter(i => i.resultado === 'Reprovado').length,
                hoje: lista.filter(i => formatarData(i.dataHora).includes(hoje)).length
            };
        });

        const relatoriosFiltrados = computed(() => {
            return cadastros.value.inspecoes.filter(item => {
                const matchProduto = filtros.value.produto ? item.produto?.toLowerCase().includes(filtros.value.produto.toLowerCase()) : true;
                const matchLote = filtros.value.lote ? item.lote?.toLowerCase().includes(filtros.value.lote.toLowerCase()) : true;
                const matchPosFolga = filtros.value.posFolga ? item.posFolga === filtros.value.posFolga : true;
                const matchResultado = filtros.value.resultado ? item.resultado === filtros.value.resultado : true;
                
                let matchData = true;
                if (filtros.value.dataInicio && filtros.value.dataFim) {
                    const dataItem = item.dataHora?.seconds ? new Date(item.dataHora.seconds * 1000) : new Date(item.dataHora);
                    const inicio = new Date(filtros.value.dataInicio + 'T00:00:00');
                    const fim = new Date(filtros.value.dataFim + 'T23:59:59');
                    matchData = (dataItem >= inicio && dataItem <= fim);
                } else {
                    const itemDateStr = formatarData(item.dataHora);
                    const hoje = new Date().toLocaleDateString('pt-BR'); 
                    const ontem = new Date(); ontem.setDate(ontem.getDate() - 1); 
                    const ontemStr = ontem.toLocaleDateString('pt-BR');
                    matchData = (itemDateStr === hoje || itemDateStr === ontemStr);
                }

                return matchProduto && matchLote && matchPosFolga && matchResultado && matchData;
            }).sort((a,b) => b.dataHora - a.dataHora);
        });

        const exportarCSV = () => {
            if (relatoriosFiltrados.value.length === 0) {
                notify('Aviso', 'Não há dados para exportar com os filtros atuais.', 'erro');
                return;
            }
            
            let csv = '\uFEFF'; 
            csv += "Data;Hora;Inspetor;Linha;Produto;Formato;Lote;Pós Folga;Resultado\n";
            
            relatoriosFiltrados.value.forEach(rel => {
                const dataObj = rel.dataHora?.seconds ? new Date(rel.dataHora.seconds * 1000) : new Date(rel.dataHora);
                const dataStr = dataObj.toLocaleDateString('pt-BR');
                const horaStr = dataObj.toLocaleTimeString('pt-BR');
                
                const inspetor = rel.inspetor || '';
                const linha = rel.linha || '';
                const produto = rel.produto || '';
                const formato = rel.formatoNome || '';
                const lote = rel.lote || '';
                const posFolga = rel.posFolga || '';
                const resultado = rel.resultado || '';
                
                csv += `"${dataStr}";"${horaStr}";"${inspetor}";"${linha}";"${produto}";"${formato}";"${lote}";"${posFolga}";"${resultado}"\n`;
            });

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", `Inspecao_Qualidade_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            notify('Sucesso', 'Ficheiro Excel gerado com sucesso.', 'sucesso');
        };

        const removerInspecao = async (id) => {
            if(confirm('Tem certeza que deseja EXCLUIR este registo?')) {
                try { await deleteDoc(doc(db, "inspecoes", id)); notify('Excluído', 'Registo removido.', 'sucesso'); } 
                catch(e) { notify('Erro', 'Erro ao excluir.', 'erro'); }
            }
        };

        const produtosFiltrados = computed(() => { if (!produtoSearch.value) return cadastros.value.produtos; return cadastros.value.produtos.filter(p => p.nome.toLowerCase().includes(produtoSearch.value.toLowerCase())); });
        const selecionarProduto = (nome) => { form.value.produto = nome; produtoSearch.value = nome; mostrandoListaProdutos.value = false; salvarRascunho(); };
        
        const produtosAdminFiltrados = computed(() => { 
            let lista = [...cadastros.value.produtos]; 
            lista.reverse(); 
            if (filtroAdminProdutos.value) { 
                lista = lista.filter(p => p.nome.toLowerCase().includes(filtroAdminProdutos.value.toLowerCase())); 
            } 
            return lista.slice(0, 5); 
        });

        const salvarAlteracoesAdmin = async () => {
            if (!relatorioSelecionado.value) return;
            const rel = relatorioSelecionado.value;
            let novoResultado = 'Aprovado';
            rel.pecas.forEach(p => { Object.values(p.laterais).forEach(v => { if (!getStatusRelatorio(rel, v, 'lateral')) novoResultado = 'Reprovado'; }); Object.values(p.centrais).forEach(v => { if (!getStatusRelatorio(rel, v, 'central')) novoResultado = 'Reprovado'; }); });
            rel.resultado = novoResultado;
            try { await updateDoc(doc(db, "inspecoes", rel.id), { pecas: rel.pecas, resultado: novoResultado }); notify('Salvo', 'Atualizado.', 'sucesso'); relatorioSelecionado.value = null; } catch (e) { notify('Erro', 'Falha ao salvar.', 'erro'); }
        };

        const handleLogin = () => { loading.value = true; setTimeout(() => { const { user, pass, remember } = loginData.value; const userLower = user.toLowerCase(); if (userLower === 'admin' && pass === 'admin') { currentView.value = 'admin'; notify('Super Admin', 'OK', 'sucesso'); loading.value = false; return; } const usuarioEncontrado = cadastros.value.usuarios.find(u => u.login === userLower && u.matricula === pass); if (usuarioEncontrado) { if (remember) { localStorage.setItem('qc_user', userLower); localStorage.setItem('qc_pass', pass); } else { localStorage.removeItem('qc_user'); localStorage.removeItem('qc_pass'); } if (usuarioEncontrado.admin) { currentView.value = 'admin'; } else { currentView.value = 'inspector'; if(form.value.pecas.length === 0) adicionarPeca(); showStartModal.value = true; } notify('Bem-vindo', `Olá, ${usuarioEncontrado.nome}`, 'sucesso'); } else { notify('Erro', 'Incorreto.', 'erro'); } loading.value = false; }, 600); };
        const cadastrarUsuario = async () => { const { nome, matricula, admin } = novoUsuarioForm.value; if (!nome || !matricula) { notify('Erro', 'Preencha tudo', 'erro'); return; } const partesNome = nome.trim().toLowerCase().split(' '); const primeiroNome = partesNome[0]; const ultimoSobrenome = partesNome.length > 1 ? partesNome[partesNome.length - 1] : ''; const loginGerado = ultimoSobrenome ? `${primeiroNome}.${ultimoSobrenome}` : primeiroNome; const loginFinal = loginGerado.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); try { await addDoc(collection(db, "usuarios"), { nome: nome, matricula: matricula, login: loginFinal, admin: admin }); novoUsuarioForm.value = { nome: '', matricula: '', admin: false }; notify('Sucesso', `Login: ${loginFinal}`, 'sucesso'); } catch (e) { notify('Erro', e.message, 'erro'); } };
        
        const mascararInput = (event, pecaObj, tipo, chave) => { let input = event.target; let valorOriginal = input.value; let isNegative = valorOriginal.includes('-'); let numeros = valorOriginal.replace(/\D/g, ''); let digitosReais = numeros.replace(/^0+/, ''); let valorVisual = ''; let valorFloat = 0; if (numeros.length > 0) { valorFloat = parseInt(numeros) / 100; valorVisual = valorFloat.toFixed(2).replace('.', ','); } if (isNegative) { valorVisual = '-' + valorVisual; valorFloat = valorFloat * -1; } if (numeros.length === 0 && !isNegative) { valorVisual = ''; valorFloat = null; } else if (numeros.length === 0 && isNegative) { valorVisual = '-'; } if (tipo === 'laterais') { pecaObj.lateraisDisplay[chave] = valorVisual; pecaObj.laterais[chave] = valorFloat; } else { pecaObj.centraisDisplay[chave] = valorVisual; pecaObj.centrais[chave] = valorFloat; } input.value = valorVisual; if (digitosReais.length >= 3) focarProximoInput(input); salvarRascunho(); };
        
        const salvarRascunho = async () => { if (!form.value.formatoId || showStartModal.value) return; salvandoAuto.value = true; const limitesSnapshot = { latMin: configAtiva.value.latMin, latMax: configAtiva.value.latMax, centMin: configAtiva.value.centMin, centMax: configAtiva.value.centMax }; let resultadoGeral = 'Aprovado'; form.value.pecas.forEach(p => { Object.values(p.laterais).forEach(v => { if(getStatusClass(v, 'lateral') === 'status-bad') resultadoGeral = 'Reprovado'; }); Object.values(p.centrais).forEach(v => { if(getStatusClass(v, 'central') === 'status-bad') resultadoGeral = 'Reprovado'; }); }); const dados = { inspetor: loginData.value.user, dataHora: new Date(), linha: form.value.linha, produto: form.value.produto, formatoId: form.value.formatoId, formatoNome: configAtiva.value.nome, limitesSnapshot: limitesSnapshot, lote: form.value.lote ? form.value.lote.toUpperCase() : '', posFolga: form.value.posFolga, resultado: resultadoGeral, pecas: form.value.pecas.map(p => ({ laterais: p.laterais, centrais: p.centrais })), status: 'rascunho' }; try { if (currentInspectionId.value) { await updateDoc(doc(db, "inspecoes", currentInspectionId.value), dados); } else { const ref = await addDoc(collection(db, "inspecoes"), dados); currentInspectionId.value = ref.id; } } catch (e) { console.error(e); } finally { setTimeout(() => salvandoAuto.value = false, 500); } };
        
        const gerarRelatorioFinal = async () => {
            if (!form.value.linha || !form.value.produto || !form.value.formatoId) { notify('Erro', 'Cabeçalho incompleto.', 'erro'); return; }
            if (!form.value.posFolga) { notify('Atenção', 'Preencha se é Pós Folga.', 'erro'); return; }
            await salvarRascunho(); if(currentInspectionId.value) await updateDoc(doc(db, "inspecoes", currentInspectionId.value), { status: 'finalizado' });
            const now = new Date(); const dataStr = now.toLocaleDateString('pt-BR'); const conf = configAtiva.value;
            let txt = `*RELATÓRIO DE EMPENO*\n*Data:* ${dataStr} ${now.toLocaleTimeString().slice(0,5)}\n*Responsável:* ${loginData.value.user}\n`;
            if (form.value.posFolga === 'Sim') txt += `*Pós Folga:* Sim\n`;
            txt += `*Linha:* ${form.value.linha}\n*Produto:* ${form.value.produto}\n*Formato:* ${conf.nome}\n*Lote:* ${form.value.lote}\n\nRange Lateral:(${conf.latMin} a ${conf.latMax})\nRange Central:(${conf.centMin} a ${conf.centMax})\n\n`;
            form.value.pecas.forEach((p, i) => { txt += `*Peça ${i+1}*\n`; ['A', 'B', 'C', 'D'].forEach(lado => { const val = p.laterais[lado]; const visual = p.lateraisDisplay[lado]; if (val !== null && val !== '') { const icon = getStatusClass(val, 'lateral') === 'status-ok' ? '🟢' : '🔴'; txt += `${icon} Lado ${lado}: ${visual}\n`; } }); txt += `*Central*\n`; [1, 2].forEach(num => { const val = p.centrais[num]; const visual = p.centraisDisplay[num]; const label = num === 1 ? 'Lado A' : 'Lado B'; if (val !== null && val !== '') { const icon = getStatusClass(val, 'central') === 'status-ok' ? '🟢' : '🔴'; txt += `${icon} ${label}: ${visual}\n`; } }); txt += `\n`; });
            reportText.value = txt; notify('Sucesso', 'Gerado.', 'sucesso');
        };

        const getStatusRelatorio = (relatorio, valor, tipo) => { if (valor === null || valor === undefined || valor === '') return true; const num = parseFloat(valor); const limites = relatorio.limitesSnapshot || cadastros.value.formatos.find(f => f.id === relatorio.formatoId) || { latMin: -99, latMax: 99, centMin: -99, centMax: 99 }; const min = tipo === 'lateral' ? limites.latMin : limites.centMin; const max = tipo === 'lateral' ? limites.latMax : limites.centMax; return (num >= min && num <= max); };
        const configAtiva = computed(() => cadastros.value.formatos.find(f => f.id === form.value.formatoId) || { nome: '...', latMin: -99, latMax: 99, centMin: -99, centMax: 99 });
        const getStatusClass = (val, tipo) => { if (val == null || val === '') return ''; const min = tipo === 'lateral' ? configAtiva.value.latMin : configAtiva.value.centMin; const max = tipo === 'lateral' ? configAtiva.value.latMax : configAtiva.value.centMax; return (val >= min && val <= max) ? 'status-ok' : 'status-bad'; };
        const focarProximoInput = (el) => { const inputs = Array.from(document.querySelectorAll('.input-medicao')); const idx = inputs.indexOf(el); if (idx > -1 && idx < inputs.length - 1) inputs[idx + 1].focus(); };
        const adicionarPeca = () => { form.value.pecas.push({ laterais: {A:null,B:null,C:null,D:null}, lateraisDisplay: {A:'',B:'',C:'',D:''}, centrais: {1:null,2:null}, centraisDisplay: {1:'',2:''} }); salvarRascunho(); };
        const removerPeca = (idx) => { if (form.value.pecas.length > 0) { form.value.pecas.splice(idx, 1); salvarRascunho(); } };
        const formatarData = (ts) => ts && ts.seconds ? new Date(ts.seconds * 1000).toLocaleDateString('pt-BR') : '-';
        const abrirDetalhesRelatorio = (r) => relatorioSelecionado.value = r;
        
        const limparFiltros = () => filtros.value = { dataInicio: '', dataFim: '', produto: '', lote: '', posFolga: '', resultado: '' };
        
        const logout = () => { currentView.value = 'login'; loginData.value = { user: '', pass: '', remember: false }; localStorage.removeItem('qc_user'); localStorage.removeItem('qc_pass'); };
        
        const novaInspecaoLimpa = () => { 
            reportText.value = ''; 
            currentInspectionId.value = null; 
            form.value.pecas = []; 
            form.value.lote = ''; 
            form.value.posFolga = ''; 
            form.value.produto = ''; 
            form.value.linha = ''; 
            form.value.formatoId = '';
            produtoSearch.value = ''; 
            showStartModal.value = true;
            adicionarPeca(); 
        };
        
        const novoFormato = async () => { const n = prompt("Nome do Formato:"); if(n) addDoc(collection(db,"formatos"), {nome:n, latMin:-0.5, latMax:0.5, centMin:-1, centMax:1}); };
        
        const novoItemSimples = async (collectionName) => { 
            const n = prompt("Nome:"); 
            if(!n) return; 
            const nomeTrimmed = n.trim();
            const existe = cadastros.value[collectionName].some(item => item.nome.toLowerCase() === nomeTrimmed.toLowerCase());
            if (existe) {
                notify('Atenção', 'Este item já está cadastrado.', 'erro');
                return;
            }
            try {
                await addDoc(collection(db, collectionName), {nome: nomeTrimmed}); 
                notify('Sucesso', 'Cadastrado com sucesso.', 'sucesso');
            } catch(e) {
                notify('Erro', 'Falha ao cadastrar.', 'erro');
            }
        };

        const importarProdutosCSV = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (e) => {
                const text = e.target.result;
                const linhas = text.split('\n').map(l => l.trim()).filter(l => l);
                let importados = 0;
                notify('Importação', 'A processar...', 'info');
                
                for (const nome of linhas) {
                    const existe = cadastros.value.produtos.some(p => p.nome.toLowerCase() === nome.toLowerCase());
                    if (!existe) {
                        try {
                            await addDoc(collection(db, 'produtos'), {nome: nome});
                            importados++;
                        } catch(err) { console.error(err); }
                    }
                }
                notify('Concluído', `${importados} novos produtos importados.`, 'sucesso');
                event.target.value = '';
            };
            reader.readAsText(file);
        };

        const atualizarItemSimples = async (collectionName, item) => { 
            const nomeTrimmed = item.nome.trim();
            const existe = cadastros.value[collectionName].some(i => i.nome.toLowerCase() === nomeTrimmed.toLowerCase() && i.id !== item.id);
            if (existe) {
                notify('Atenção', 'Já existe um item com este nome.', 'erro');
                return; 
            }
            try {
                await updateDoc(doc(db, collectionName, item.id), {nome: nomeTrimmed}); 
            } catch(e) {
                notify('Erro', 'Falha ao atualizar.', 'erro');
            }
        };

        const atualizarFormato = async (f) => { const {id,...d}=f; await updateDoc(doc(db,"formatos",id),d); };
        const removerItem = async (c, id) => { if(confirm("Excluir?")) deleteDoc(doc(db,c,id)); };
        const copiarTexto = () => navigator.clipboard.writeText(reportText.value);
        const enviarZap = () => window.open(`https://wa.me/?text=${encodeURIComponent(reportText.value)}`, '_blank');

        onMounted(() => {
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) { isDarkMode.value = true; document.documentElement.classList.add('dark'); } else { document.documentElement.classList.remove('dark'); }
            const savedUser = localStorage.getItem('qc_user'); const savedPass = localStorage.getItem('qc_pass'); if(savedUser && savedPass) { loginData.value = { user: savedUser, pass: savedPass, remember: true }; }
            onSnapshot(collection(db, "formatos"), s => cadastros.value.formatos = s.docs.map(d=>({id:d.id,...d.data()})));
            onSnapshot(collection(db, "produtos"), s => cadastros.value.produtos = s.docs.map(d=>({id:d.id,...d.data()})));
            onSnapshot(collection(db, "linhas"), s => cadastros.value.linhas = s.docs.map(d=>({id:d.id,...d.data()})));
            onSnapshot(collection(db, "usuarios"), s => cadastros.value.usuarios = s.docs.map(d=>({id:d.id,...d.data()})));
            onSnapshot(query(collection(db, "inspecoes"), orderBy("dataHora", "desc")), s => {
                cadastros.value.inspecoes = s.docs.map(d=>({id:d.id,...d.data()}));
                nextTick(() => { if (adminTab.value === 'dashboard') updateCharts(); });
            });
        });

        watch([filtrosGrafico.value, adminTab], () => { if (adminTab.value === 'dashboard') nextTick(updateCharts); });

        return {
            notificacoes, salvandoAuto, currentView, loginData, handleLogin, logout, loading,
            adminTab, mobileMenuOpen, navigateAdmin, cadastros, filtros, relatoriosFiltrados, limparFiltros,
            relatorioSelecionado, abrirDetalhesRelatorio, getStatusRelatorio, salvarAlteracoesAdmin, removerInspecao, baixarPrintRelatorio,
            form, mascararInput, getStatusClass, adicionarPeca, removerPeca, salvarRascunho, gerarRelatorioFinal, reportText, novaInspecaoLimpa,
            novoFormato, novoItemSimples, removerItem, atualizarFormato, atualizarItemSimples, importarProdutosCSV, exportarCSV,
            formatarData, copiarTexto, enviarZap, stats, novoUsuarioForm, cadastrarUsuario, setFiltroRapido,
            produtoSearch, produtosFiltrados, selecionarProduto, mostrandoListaProdutos, filtroAdminProdutos, produtosAdminFiltrados,
            isDarkMode, toggleDarkMode, filtrosGrafico, showStartModal, iniciarAnalise
        };
    }
}).mount('#app');
