import { createApp, ref, computed, onMounted, watch, nextTick } from 'vue';
import { db } from './firebase-config.js'; 
import { collection, addDoc, doc, deleteDoc, updateDoc, onSnapshot, query, orderBy } from 'firebase/firestore';

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
        const loginData = ref({ user: '', pass: '', remember: false, perfil: '', nome: '' });
        const loading = ref(false);
        const salvandoAuto = ref(false);
        const relatorioSelecionado = ref(null);
        
        const adminTab = ref('dashboard'); 
        const mobileMenuOpen = ref(false); 
        
        const tipoGrafico = ref('fechamento96');
        const showStartModal = ref(true);
        const inspectorTab = ref('empeno'); // 'empeno' only now

        // ─── DIMENSIONAIS ─────────────────────────────────────────────────────────
        const showDimStartModal = ref(true);
        const currentDimId = ref(null);
        const salvandoDim = ref(false);
        const dimReportText = ref('');
        const dimSelecionado = ref(null);
        const filtrosDim = ref({ dataInicio: '', dataFim: '', produto: '', lote: '', resultado: '', formatoId: '' });
        const produtoSearchDim = ref('');
        const mostrandoListaProdutosDim = ref(false);

        const formDim = ref({
            linha: '', formatoId: '', produto: '', lote: '',
            espessuraDeclarada: null,
            pecasEspessura: [],
            medicoesTamanhoEsquadro: []
        });

        const configDimAtiva = computed(() =>
            cadastros.value.formatos.find(f => f.id === formDim.value.formatoId) ||
            { nome: '...', tamanhoMin: undefined, tamanhoMax: undefined, esquadroMin: undefined, esquadroMax: undefined }
        );

        const selecionarProdutoDim = (nome) => { formDim.value.produto = nome; produtoSearchDim.value = nome; mostrandoListaProdutosDim.value = false; salvarDimRascunho(); };
        const produtosFiltradosDim = computed(() => {
            if (!produtoSearchDim.value) return cadastros.value.produtos;
            return cadastros.value.produtos.filter(p => p.nome.toLowerCase().includes(produtoSearchDim.value.toLowerCase()));
        });

        const iniciarDimensionais = () => {
            if (!formDim.value.linha || !formDim.value.formatoId || !formDim.value.produto || !formDim.value.lote) {
                notify('Atenção', 'Preencha todos os campos para iniciar.', 'erro'); return;
            }
            showDimStartModal.value = false; salvarDimRascunho();
        };

        const irParaDimensionais = () => {
            currentView.value = 'dimensionais';
            mobileMenuOpen.value = false;
            showDimStartModal.value = true;
        };
        const voltarAdminDeDim = () => { currentView.value = 'admin'; adminTab.value = 'dashboard'; };

        // Espessura nos dimensionais
        const espessuraDimMin = computed(() => formDim.value.espessuraDeclarada ? +(formDim.value.espessuraDeclarada * 0.95).toFixed(4) : null);
        const espessuraDimMax = computed(() => formDim.value.espessuraDeclarada ? +(formDim.value.espessuraDeclarada * 1.05).toFixed(4) : null);

        const calcMediaPecaDim = (peca) => {
            const vals = (peca.pontos || []).filter(v => v !== null && v !== '' && !isNaN(parseFloat(v)));
            if (!vals.length) return null;
            return vals.reduce((a, b) => a + parseFloat(b), 0) / vals.length;
        };
        const getStatusEspessuraDim = (media) => {
            if (media === null || media === undefined || espessuraDimMin.value === null) return '';
            return (media >= espessuraDimMin.value && media <= espessuraDimMax.value) ? 'status-ok' : 'status-bad';
        };
        const adicionarPecaEspessuraDim = () => { formDim.value.pecasEspessura.push({ prensa: '', cavidade: '', pontos: [null] }); salvarDimRascunho(); };
        const removerPecaEspessuraDim = (idx) => { formDim.value.pecasEspessura.splice(idx, 1); salvarDimRascunho(); };
        const adicionarPontoDim = (peca) => { peca.pontos.push(null); salvarDimRascunho(); };
        const removerPontoDim = (peca, pidx) => { if (peca.pontos.length > 1) { peca.pontos.splice(pidx, 1); salvarDimRascunho(); } };

        const resultadoEspessuraDim = computed(() => {
            if (!formDim.value.espessuraDeclarada || !formDim.value.pecasEspessura.length) return null;
            const medias = formDim.value.pecasEspessura.map(p => calcMediaPecaDim(p)).filter(m => m !== null);
            if (!medias.length) return null;
            return medias.every(m => m >= espessuraDimMin.value && m <= espessuraDimMax.value) ? 'Aprovado' : 'Reprovado';
        });

        // Tamanho & Esquadro nos dimensionais
        const getStatusTamanhoDim = (valor) => {
            if (valor === null || valor === '' || valor === undefined) return '';
            const fmt = configDimAtiva.value;
            if (fmt.tamanhoMin === undefined) return '';
            return (parseFloat(valor) >= fmt.tamanhoMin && parseFloat(valor) <= fmt.tamanhoMax) ? 'status-ok' : 'status-bad';
        };
        const getStatusEsquadroDim = (valor) => {
            if (valor === null || valor === '' || valor === undefined) return '';
            const fmt = configDimAtiva.value;
            if (fmt.esquadroMin === undefined) return '';
            return (parseFloat(valor) >= fmt.esquadroMin && parseFloat(valor) <= fmt.esquadroMax) ? 'status-ok' : 'status-bad';
        };
        const adicionarMedicaoTEDim = () => { formDim.value.medicoesTamanhoEsquadro.push({ retifica: '', tamanho: null, esquadro: null }); salvarDimRascunho(); };
        const removerMedicaoTEDim = (idx) => { formDim.value.medicoesTamanhoEsquadro.splice(idx, 1); salvarDimRascunho(); };
        const resultadoTEDim = computed(() => {
            const meds = formDim.value.medicoesTamanhoEsquadro;
            if (!meds.length) return null;
            for (const m of meds) {
                if (getStatusTamanhoDim(m.tamanho) === 'status-bad') return 'Reprovado';
                if (getStatusEsquadroDim(m.esquadro) === 'status-bad') return 'Reprovado';
            }
            return meds.some(m => m.tamanho !== null || m.esquadro !== null) ? 'Aprovado' : null;
        });

        // Detectores
        const temDadosEspessuraDim = computed(() => {
            if (!formDim.value.espessuraDeclarada) return false;
            return formDim.value.pecasEspessura.some(p => (p.pontos||[]).some(v => v !== null && v !== '' && !isNaN(parseFloat(v))));
        });
        const temDadosTEDim = computed(() =>
            formDim.value.medicoesTamanhoEsquadro.some(m => (m.tamanho !== null && m.tamanho !== '') || (m.esquadro !== null && m.esquadro !== ''))
        );

        // Abas dimensionais
        const dimTab = ref('espessura'); // 'espessura' | 'tamanho'

        // Salvar rascunho dimensional
        const salvarDimRascunho = async () => {
            if (!formDim.value.formatoId || showDimStartModal.value) return;
            salvandoDim.value = true;
            let resultado = 'Aprovado';
            if (resultadoEspessuraDim.value === 'Reprovado') resultado = 'Reprovado';
            if (resultadoTEDim.value === 'Reprovado') resultado = 'Reprovado';
            const fmt = configDimAtiva.value;
            const dados = {
                tipo: 'dimensional',
                inspetor: loginData.value.user,
                nomeInspetor: loginData.value.nome || loginData.value.user,
                dataHora: new Date(),
                linha: formDim.value.linha,
                produto: formDim.value.produto,
                formatoId: formDim.value.formatoId,
                formatoNome: fmt.nome,
                lote: formDim.value.lote ? formDim.value.lote.toUpperCase() : '',
                resultado,
                limitesSnapshot: {
                    tamanhoMin: fmt.tamanhoMin, tamanhoMax: fmt.tamanhoMax,
                    esquadroMin: fmt.esquadroMin, esquadroMax: fmt.esquadroMax
                },
                espessuraDeclarada: temDadosEspessuraDim.value ? formDim.value.espessuraDeclarada : null,
                pecasEspessura: temDadosEspessuraDim.value
                    ? formDim.value.pecasEspessura
                        .filter(p => (p.pontos||[]).some(v => v !== null && v !== ''))
                        .map(p => ({ prensa: p.prensa, cavidade: p.cavidade, pontos: p.pontos.filter(v => v !== null && v !== ''), media: calcMediaPecaDim(p) }))
                    : [],
                medicoesTamanhoEsquadro: temDadosTEDim.value
                    ? formDim.value.medicoesTamanhoEsquadro.filter(m => (m.tamanho !== null && m.tamanho !== '') || (m.esquadro !== null && m.esquadro !== ''))
                    : [],
                status: 'rascunho'
            };
            try {
                if (currentDimId.value) { await updateDoc(doc(db, 'dimensionais', currentDimId.value), dados); }
                else { const r = await addDoc(collection(db, 'dimensionais'), dados); currentDimId.value = r.id; }
            } catch(e) { console.error(e); }
            finally { setTimeout(() => salvandoDim.value = false, 500); }
        };

        // Concluir dimensional
        const concluirDimensionais = async () => {
            if (!formDim.value.linha || !formDim.value.produto || !formDim.value.formatoId || !formDim.value.lote) {
                notify('Erro', 'Cabeçalho incompleto.', 'erro'); return;
            }
            if (!temDadosEspessuraDim.value && !temDadosTEDim.value) {
                notify('Atenção', 'Nenhuma medição preenchida.', 'erro'); return;
            }
            await salvarDimRascunho();
            if (currentDimId.value) await updateDoc(doc(db, 'dimensionais', currentDimId.value), { status: 'finalizado' });

            const now = new Date();
            const fmt = configDimAtiva.value;
            const dataHora = `${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR').slice(0,5)}`;
            let resultadoFinal = (resultadoEspessuraDim.value === 'Reprovado' || resultadoTEDim.value === 'Reprovado') ? 'REPROVADO ❌' : 'APROVADO ✅';

            let txt = `*RELATÓRIO DE EMPENO*\n`;
            txt += `*Data:* ${dataHora}\n`;
            txt += `*Responsável:* ${loginData.value.nome || loginData.value.user}\n`;
            txt += `*Linha:* ${formDim.value.linha}\n`;
            txt += `*Produto:* ${formDim.value.produto}\n`;
            txt += `*Formato:* ${fmt.nome}\n`;
            txt += `*Lote:* ${formDim.value.lote}\n`;

            if (temDadosEspessuraDim.value) {
                txt += `\nRange Espessura:(${espessuraDimMin.value?.toFixed(2)} a ${espessuraDimMax.value?.toFixed(2)})\n`;
                formDim.value.pecasEspessura.forEach(p => {
                    const pontosValidos = (p.pontos||[]).filter(v => v !== null && v !== '' && !isNaN(parseFloat(v)));
                    if (!pontosValidos.length) return;
                    const med = calcMediaPecaDim(p);
                    const ok = med !== null && getStatusEspessuraDim(med) === 'status-ok';
                    const id = [p.prensa ? `Prensa ${p.prensa}` : '', p.cavidade ? `Cav ${p.cavidade}` : ''].filter(Boolean).join(' / ') || 'Peça';
                    txt += `\n*${id}*\n`;
                    pontosValidos.forEach((v, pi) => { txt += `Ponto ${pi+1}: ${parseFloat(v).toFixed(2)}mm\n`; });
                    txt += `${ok ? '🟢' : '🔴'} Média: ${med !== null ? med.toFixed(2) : '-'}mm\n`;
                });
            }

            if (temDadosTEDim.value) {
                txt += `\nRange Tamanho:(${fmt.tamanhoMin} a ${fmt.tamanhoMax})\n`;
                txt += `Range Esquadro:(${fmt.esquadroMin} a ${fmt.esquadroMax})\n`;
                let n = 0;
                formDim.value.medicoesTamanhoEsquadro.forEach(m => {
                    const tt = m.tamanho !== null && m.tamanho !== '';
                    const te = m.esquadro !== null && m.esquadro !== '';
                    if (!tt && !te) return;
                    n++;
                    txt += `\n*Medição ${n}${m.retifica ? ' — Ret. ' + m.retifica : ''}*\n`;
                    if (tt) { const ok = getStatusTamanhoDim(m.tamanho) === 'status-ok'; txt += `${ok ? '🟢' : '🔴'} Tamanho: ${m.tamanho}mm\n`; }
                    if (te) { const ok = getStatusEsquadroDim(m.esquadro) === 'status-ok'; txt += `${ok ? '🟢' : '🔴'} Esquadro: ${m.esquadro}mm\n`; }
                });
            }

            txt += `\n*━━━━━━━━━━━━━━━━━━━━*\n*RESULTADO: ${resultadoFinal}*\n*━━━━━━━━━━━━━━━━━━━━*`;
            dimReportText.value = txt;
            notify('Sucesso', 'Dimensional concluído!', 'sucesso');
        };

        const novoDimLimpo = () => {
            dimReportText.value = ''; currentDimId.value = null;
            formDim.value = { linha: '', formatoId: '', produto: '', lote: '', espessuraDeclarada: null, pecasEspessura: [], medicoesTamanhoEsquadro: [] };
            produtoSearchDim.value = ''; showDimStartModal.value = true; dimTab.value = 'espessura';
        };

        // Histórico dimensionais no admin
        const dimSelecionadoModal = ref(null);
        const filtrosDimAdmin = ref({ dataInicio: '', dataFim: '', produto: '', lote: '', resultado: '', formatoId: '' });
        const dimensionaisFiltrados = computed(() => {
            return (cadastros.value.dimensionais || []).filter(item => {
                const matchProduto = filtrosDimAdmin.value.produto ? item.produto?.toLowerCase().includes(filtrosDimAdmin.value.produto.toLowerCase()) : true;
                const matchLote = filtrosDimAdmin.value.lote ? item.lote?.toLowerCase().includes(filtrosDimAdmin.value.lote.toLowerCase()) : true;
                const matchResultado = filtrosDimAdmin.value.resultado ? item.resultado === filtrosDimAdmin.value.resultado : true;
                const matchFormatoId = filtrosDimAdmin.value.formatoId ? item.formatoId === filtrosDimAdmin.value.formatoId : true;
                let matchData = true;
                if (filtrosDimAdmin.value.dataInicio && filtrosDimAdmin.value.dataFim) {
                    const dataItem = item.dataHora?.seconds ? new Date(item.dataHora.seconds * 1000) : new Date(item.dataHora);
                    const inicio = new Date(filtrosDimAdmin.value.dataInicio + 'T00:00:00');
                    const fim = new Date(filtrosDimAdmin.value.dataFim + 'T23:59:59');
                    matchData = dataItem >= inicio && dataItem <= fim;
                }
                return matchProduto && matchLote && matchResultado && matchFormatoId && matchData;
            }).sort((a,b) => (b.dataHora?.seconds||0) - (a.dataHora?.seconds||0));
        });
        const removerDimensional = async (id) => {
            if (confirm('Excluir este registro dimensional?')) {
                try { await deleteDoc(doc(db, 'dimensionais', id)); notify('Excluído', 'Registro removido.', 'sucesso'); }
                catch(e) { notify('Erro', 'Falha ao excluir.', 'erro'); }
            }
        };
        
        const filtros = ref({ dataInicio: '', dataFim: '', produto: '', lote: '', posFolga: '', resultado: '', formatoId: '' });

        const setFiltroRapido = (tipo) => {
            const hoje = new Date();
            const timezoneOffset = hoje.getTimezoneOffset() * 60000;
            const dataLocal = new Date(hoje.getTime() - timezoneOffset);
            const strHoje = dataLocal.toISOString().split('T')[0];
            
            if (tipo === 'hoje') {
                filtros.value.dataInicio = strHoje; filtros.value.dataFim = strHoje; filtros.value.resultado = '';
            } else if (tipo === 'reprovados_hoje') {
                filtros.value.dataInicio = strHoje; filtros.value.dataFim = strHoje; filtros.value.resultado = 'Reprovado';
            } else if (tipo === 'mes') {
                const primeiroDia = new Date(dataLocal.getFullYear(), dataLocal.getMonth(), 1).toISOString().split('T')[0];
                filtros.value.dataInicio = primeiroDia; filtros.value.dataFim = strHoje; filtros.value.resultado = '';
            }
        };

        const filtroAdminProdutos = ref(''); 
        // Atualizado para receber o perfil
        const novoUsuarioForm = ref({ nome: '', matricula: '', perfil: 'inspetor' });
        const cadastros = ref({ formatos: [], produtos: [], linhas: [], inspecoes: [], usuarios: [], dimensionais: [] });

        const currentInspectionId = ref(null);
        const produtoSearch = ref('');
        const mostrandoListaProdutos = ref(false);
        const form = ref({ 
            linha: '', formatoId: '', produto: '', lote: '', posFolga: '', pecas: [],
            espessuraDeclarada: null,
            pecasEspessura: [],            // [{ prensa: '1', cavidade: '2', pontos: [val, val, ...] }]
            medicoesTamanhoEsquadro: []    // [{ retifica: '1', tamanho: null, esquadro: null }]
        });
        const reportText = ref('');

        const navigateAdmin = (tab) => { adminTab.value = tab; mobileMenuOpen.value = false; };

        // Funções de Navegação do Admin para Inspeção
        const irParaInspecao = () => {
            currentView.value = 'inspector';
            mobileMenuOpen.value = false;
            if(form.value.pecas.length === 0) adicionarPeca();
            showStartModal.value = true;
        };

        const voltarAdmin = () => {
            currentView.value = 'admin';
            adminTab.value = 'dashboard';
        };

        const iniciarAnalise = () => {
            if (!form.value.linha || !form.value.formatoId || !form.value.produto || !form.value.lote || !form.value.posFolga) {
                notify('Atenção', 'Preencha todos os campos do cabeçalho para iniciar a análise.', 'erro'); return;
            }
            showStartModal.value = false; salvarRascunho();
        };

        // NOVO: Função para calcular os extremos na tabela
        const getExtremos = (pecas) => {
            if (!pecas || !Array.isArray(pecas) || pecas.length === 0) return { lat: '-', cent: '-' };
            let maxLat = -Infinity, minLat = Infinity, maxCent = -Infinity, minCent = Infinity;
            let hasLat = false, hasCent = false;
            
            pecas.forEach(p => {
                if (p.laterais) {
                    Object.values(p.laterais).forEach(v => {
                        if (v !== null && v !== '') {
                            const num = parseFloat(v);
                            if (num > maxLat) maxLat = num;
                            if (num < minLat) minLat = num;
                            hasLat = true;
                        }
                    });
                }
                if (p.centrais) {
                    Object.values(p.centrais).forEach(v => {
                        if (v !== null && v !== '') {
                            const num = parseFloat(v);
                            if (num > maxCent) maxCent = num;
                            if (num < minCent) minCent = num;
                            hasCent = true;
                        }
                    });
                }
            });

            const formatNum = (n) => n.toFixed(2).replace('.', ',');

            return {
                lat: hasLat ? `${formatNum(minLat)} a ${formatNum(maxLat)}` : '-',
                cent: hasCent ? `${formatNum(minCent)} a ${formatNum(maxCent)}` : '-'
            };
        };

        let chartInstance = null;
        let trendChartInstance = null;
        let lateralChartInstance = null; 
        let centralChartInstance = null; 
        
        const filtrosGrafico = ref({ formato: '', data: new Date().toISOString().slice(0, 7) }); 

        const updateCharts = () => {
            const formatoId = filtrosGrafico.value.formato;
            
            const dadosBase = cadastros.value.inspecoes.filter(i => {
                if (tipoGrafico.value === 'pos_folga') return i.posFolga === 'Sim';
                return i.posFolga === 'Não'; 
            });
            
            const ctxQuality = document.getElementById('qualityChart');
            if (ctxQuality) {
                const [ano, mes] = filtrosGrafico.value.data.split('-');

                const dadosFiltrados = dadosBase.filter(i => {
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
                    if (i.resultado === 'Aprovado') aprovados[dia]++; else reprovados[dia]++;
                });

                if (chartInstance) chartInstance.destroy();

                chartInstance = new Chart(ctxQuality, {
                    type: 'bar',
                    data: { labels: labels, datasets: [ { label: 'Aprovados', data: aprovados, backgroundColor: '#10b981', borderRadius: 4 }, { label: 'Reprovados', data: reprovados, backgroundColor: '#ef4444', borderRadius: 4 } ] },
                    options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } }, plugins: { legend: { position: 'bottom' } } }
                });
            }

            let inspecoesLinha = [...dadosBase];
            if (formatoId) { inspecoesLinha = inspecoesLinha.filter(i => i.formatoId === formatoId); }

            const ultimasInspecoes = inspecoesLinha
                .sort((a,b) => { const tA = a.dataHora?.seconds || 0; const tB = b.dataHora?.seconds || 0; return tA - tB; })
                .slice(-20); 

            const labelsTrend = ultimasInspecoes.map(i => {
                if (formatoId && i.lote) return `Lote ${i.lote}`;
                return i.formatoNome ? i.formatoNome : formatarData(i.dataHora);
            });

            const ctxTrend = document.getElementById('trendChart');
            if (ctxTrend) {
                const dataTrend = ultimasInspecoes.map(i => {
                    let sum = 0; let count = 0;
                    if(i.pecas) { i.pecas.forEach(p => { if(p.centrais) { Object.values(p.centrais).forEach(v => { if(v !== null && v !== '') { sum += parseFloat(v); count++; } }); } }); }
                    return count > 0 ? (sum / count).toFixed(2) : 0;
                });

                if (trendChartInstance) trendChartInstance.destroy();

                trendChartInstance = new Chart(ctxTrend, {
                    type: 'line',
                    data: { labels: labelsTrend, datasets: [{ label: 'Média Desvio Central', data: dataTrend, borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.2)', fill: true, tension: 0.4, pointBackgroundColor: '#8b5cf6' }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: false } } }
                });
            }

            const ctxLateral = document.getElementById('lateralChart');
            if (ctxLateral) {
                const dataMaxMeasured = []; const dataMinMeasured = []; const dataLimitMax = []; const dataLimitMin = [];

                ultimasInspecoes.forEach(i => {
                    let maxVal = -9999; let minVal = 9999; let hasData = false;
                    if (i.pecas) { i.pecas.forEach(p => { if (p.laterais) { Object.values(p.laterais).forEach(v => { if (v !== null && v !== '') { const num = parseFloat(v); if (num > maxVal) maxVal = num; if (num < minVal) minVal = num; hasData = true; } }); } }); }
                    if (hasData) { dataMaxMeasured.push(maxVal); dataMinMeasured.push(minVal); } else { dataMaxMeasured.push(null); dataMinMeasured.push(null); }
                    const limites = i.limitesSnapshot || { latMax: 0.5, latMin: -0.5 };
                    dataLimitMax.push(limites.latMax); dataLimitMin.push(limites.latMin);
                });

                if (lateralChartInstance) lateralChartInstance.destroy();

                lateralChartInstance = new Chart(ctxLateral, {
                    type: 'line',
                    data: { labels: labelsTrend, datasets: [
                            { label: 'Limite Max', data: dataLimitMax, borderColor: 'rgba(239, 68, 68, 0.6)', borderDash: [5, 5], pointRadius: 0, borderWidth: 2, fill: false, tension: 0 },
                            { label: 'Limite Min', data: dataLimitMin, borderColor: 'rgba(239, 68, 68, 0.6)', borderDash: [5, 5], pointRadius: 0, borderWidth: 2, fill: false, tension: 0 },
                            { label: 'Pico (Max)', data: dataMaxMeasured, borderColor: '#3b82f6', backgroundColor: '#3b82f6', pointRadius: 4, borderWidth: 2, fill: false, tension: 0.3 },
                            { label: 'Vale (Min)', data: dataMinMeasured, borderColor: '#f59e0b', backgroundColor: '#f59e0b', pointRadius: 4, borderWidth: 2, fill: false, tension: 0.3 }
                        ] },
                    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: function(context) { return context.dataset.label + ': ' + context.parsed.y.toFixed(2); } } } }, scales: { y: { title: { display: true, text: 'Medição Lateral' } } } }
                });
            }

            const ctxCentral = document.getElementById('centralChart');
            if (ctxCentral) {
                const dataMaxCentral = []; const dataMinCentral = []; const dataLimitMaxCentral = []; const dataLimitMinCentral = [];

                ultimasInspecoes.forEach(i => {
                    let maxVal = -9999; let minVal = 9999; let hasData = false;
                    if (i.pecas) { i.pecas.forEach(p => { if (p.centrais) { Object.values(p.centrais).forEach(v => { if (v !== null && v !== '') { const num = parseFloat(v); if (num > maxVal) maxVal = num; if (num < minVal) minVal = num; hasData = true; } }); } }); }
                    if (hasData) { dataMaxCentral.push(maxVal); dataMinCentral.push(minVal); } else { dataMaxCentral.push(null); dataMinCentral.push(null); }
                    const limites = i.limitesSnapshot || { centMax: 1.0, centMin: -1.0 };
                    dataLimitMaxCentral.push(limites.centMax); dataLimitMinCentral.push(limites.centMin);
                });

                if (centralChartInstance) centralChartInstance.destroy();

                centralChartInstance = new Chart(ctxCentral, {
                    type: 'line',
                    data: { labels: labelsTrend, datasets: [
                            { label: 'Limite Max', data: dataLimitMaxCentral, borderColor: 'rgba(239, 68, 68, 0.6)', borderDash: [5, 5], pointRadius: 0, borderWidth: 2, fill: false, tension: 0 },
                            { label: 'Limite Min', data: dataLimitMinCentral, borderColor: 'rgba(239, 68, 68, 0.6)', borderDash: [5, 5], pointRadius: 0, borderWidth: 2, fill: false, tension: 0 },
                            { label: 'Pico Central (Max)', data: dataMaxCentral, borderColor: '#10b981', backgroundColor: '#10b981', pointRadius: 4, borderWidth: 2, fill: false, tension: 0.3 },
                            { label: 'Vale Central (Min)', data: dataMinCentral, borderColor: '#8b5cf6', backgroundColor: '#8b5cf6', pointRadius: 4, borderWidth: 2, fill: false, tension: 0.3 }
                        ] },
                    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: function(context) { return context.dataset.label + ': ' + context.parsed.y.toFixed(2); } } } }, scales: { y: { title: { display: true, text: 'Medição Central' } } } }
                });
            }
        };

        const baixarPrintRelatorio = async () => { /* Mantido */
            const btn = document.getElementById('btn-print-action');
            if(btn) btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i> Gerando...';

            try {
                const original = document.getElementById('modal-relatorio-content');
                const clone = original.cloneNode(true);
                
                clone.style.position = 'absolute'; clone.style.top = '-9999px'; clone.style.left = '0'; clone.style.width = '800px'; clone.style.height = 'auto'; clone.style.zIndex = '-1000'; clone.style.overflow = 'visible';
                
                const isDark = isDarkMode.value;
                clone.style.backgroundColor = isDark ? '#0f172a' : '#ffffff'; clone.style.color = isDark ? '#f1f5f9' : '#1e293b';
                clone.classList.remove('h-full', 'max-h-[90vh]'); 

                const scrollableDiv = clone.querySelector('.overflow-y-auto');
                if (scrollableDiv) { scrollableDiv.classList.remove('overflow-y-auto', 'flex-1', 'modal-scroll'); scrollableDiv.style.height = 'auto'; scrollableDiv.style.overflow = 'visible'; }

                const originalInputs = original.querySelectorAll('input');
                const clonedInputs = clone.querySelectorAll('input');

                originalInputs.forEach((origInput, index) => {
                    const cloneInput = clonedInputs[index];
                    if (cloneInput) {
                        const valor = origInput.value;
                        const textDiv = document.createElement('div');
                        textDiv.innerText = valor; textDiv.className = cloneInput.className; 
                        textDiv.style.display = 'flex'; textDiv.style.alignItems = 'center'; textDiv.style.justifyContent = 'center'; textDiv.style.background = isDark ? '#1e293b' : '#ffffff'; textDiv.style.border = isDark ? '1px solid #334155' : '1px solid #e2e8f0'; 
                        
                        if(origInput.classList.contains('border-red-500')) { textDiv.style.borderColor = '#ef4444'; textDiv.style.backgroundColor = isDark ? '#450a0a' : '#fef2f2'; textDiv.style.color = '#ef4444'; }
                        cloneInput.parentNode.replaceChild(textDiv, cloneInput);
                    }
                });

                document.body.appendChild(clone);
                const canvas = await html2canvas(clone, { backgroundColor: isDark ? '#0f172a' : '#ffffff', scale: 2, windowWidth: 800 });
                document.body.removeChild(clone);

                let dataSegura; const rawData = relatorioSelecionado.value.dataHora;
                if (rawData && rawData.seconds) dataSegura = new Date(rawData.seconds * 1000); else dataSegura = rawData ? new Date(rawData) : new Date();

                const nomeArquivoData = dataSegura.toLocaleString('pt-BR').replace(/\//g, '-').replace(/:/g, '-').replace(', ', '_');
                const link = document.createElement('a'); link.download = `Relatorio_${nomeArquivoData}.png`; link.href = canvas.toDataURL("image/png"); link.click();
                
                notify('Sucesso', 'Imagem salva com valores.', 'sucesso');
            } catch (e) {
                console.error(e); notify('Erro', 'Falha ao gerar imagem.', 'erro');
            } finally {
                if(btn) btn.innerHTML = '<i class="ph-bold ph-image"></i> Baixar Imagem';
            }
        };

        const stats = computed(() => {
            const lista = cadastros.value.inspecoes; const hoje = new Date().toLocaleDateString('pt-BR');
            return { total: lista.length, posFolga: lista.filter(i => i.posFolga === 'Sim').length, reprovados: lista.filter(i => i.resultado === 'Reprovado').length, hoje: lista.filter(i => formatarData(i.dataHora).includes(hoje)).length };
        });

        const relatoriosFiltrados = computed(() => {
            return cadastros.value.inspecoes.filter(item => {
                const matchProduto = filtros.value.produto ? item.produto?.toLowerCase().includes(filtros.value.produto.toLowerCase()) : true;
                const matchLote = filtros.value.lote ? item.lote?.toLowerCase().includes(filtros.value.lote.toLowerCase()) : true;
                const matchPosFolga = filtros.value.posFolga ? item.posFolga === filtros.value.posFolga : true;
                const matchResultado = filtros.value.resultado ? item.resultado === filtros.value.resultado : true;
                const matchFormatoId = filtros.value.formatoId ? item.formatoId === filtros.value.formatoId : true; 
                
                let matchData = true;
                if (filtros.value.dataInicio && filtros.value.dataFim) {
                    const dataItem = item.dataHora?.seconds ? new Date(item.dataHora.seconds * 1000) : new Date(item.dataHora);
                    const inicio = new Date(filtros.value.dataInicio + 'T00:00:00'); const fim = new Date(filtros.value.dataFim + 'T23:59:59');
                    matchData = (dataItem >= inicio && dataItem <= fim);
                } else {
                    const itemDateStr = formatarData(item.dataHora); const hoje = new Date().toLocaleDateString('pt-BR'); 
                    const ontem = new Date(); ontem.setDate(ontem.getDate() - 1); const ontemStr = ontem.toLocaleDateString('pt-BR');
                    matchData = (itemDateStr === hoje || itemDateStr === ontemStr);
                }
                return matchProduto && matchLote && matchPosFolga && matchResultado && matchFormatoId && matchData;
            }).sort((a,b) => b.dataHora - a.dataHora);
        });

        const limparFiltros = () => filtros.value = { dataInicio: '', dataFim: '', produto: '', lote: '', posFolga: '', resultado: '', formatoId: '' };

        const exportarCSV = () => {
            try {
                if (!relatoriosFiltrados.value || relatoriosFiltrados.value.length === 0) { notify('Aviso', 'Não há dados para exportar com os filtros atuais.', 'erro'); return; }
                let maxPecas = 0;
                relatoriosFiltrados.value.forEach(rel => { if (rel.pecas && rel.pecas.length > maxPecas) { maxPecas = rel.pecas.length; } });
                
                let csv = '\uFEFF'; let cabecalho = "Data;Hora;Inspetor;Linha;Produto;Formato;Lote;Pós Folga;Resultado";
                for (let i = 1; i <= maxPecas; i++) { cabecalho += `;P${i}_Lat_A;P${i}_Lat_B;P${i}_Lat_C;P${i}_Lat_D;P${i}_Cent_1;P${i}_Cent_2`; }
                csv += cabecalho + "\n";
                const formatNum = (val) => val !== null && val !== undefined && val !== '' ? val.toString().replace('.', ',') : '';

                relatoriosFiltrados.value.forEach(rel => {
                    let dataStr = '-'; let horaStr = '-';
                    if (rel.dataHora) { const dataObj = rel.dataHora.seconds ? new Date(rel.dataHora.seconds * 1000) : new Date(rel.dataHora); if (!isNaN(dataObj)) { dataStr = dataObj.toLocaleDateString('pt-BR'); horaStr = dataObj.toLocaleTimeString('pt-BR'); } }
                    const inspetor = rel.inspetor ? rel.inspetor.toString() : ''; const linha = rel.linha ? rel.linha.toString() : ''; const produto = rel.produto ? rel.produto.toString() : '';
                    const formato = rel.formatoNome ? rel.formatoNome.toString() : ''; const lote = rel.lote ? rel.lote.toString() : ''; const posFolga = rel.posFolga ? rel.posFolga.toString() : ''; const resultado = rel.resultado ? rel.resultado.toString() : '';
                    
                    let row = `"${dataStr}";"${horaStr}";"${inspetor}";"${linha}";"${produto}";"${formato}";"${lote}";"${posFolga}";"${resultado}"`;

                    for (let i = 0; i < maxPecas; i++) {
                        if (rel.pecas && rel.pecas[i]) {
                            const p = rel.pecas[i];
                            const la = p.laterais ? p.laterais.A : ''; const lb = p.laterais ? p.laterais.B : ''; const lc = p.laterais ? p.laterais.C : ''; const ld = p.laterais ? p.laterais.D : '';
                            const c1 = p.centrais ? p.centrais['1'] : ''; const c2 = p.centrais ? p.centrais['2'] : '';
                            row += `;"${formatNum(la)}";"${formatNum(lb)}";"${formatNum(lc)}";"${formatNum(ld)}";"${formatNum(c1)}";"${formatNum(c2)}"`;
                        } else { row += `;"";"";"";"";"";""`; }
                    }
                    csv += row + "\n";
                });

                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                if (window.navigator && window.navigator.msSaveOrOpenBlob) { window.navigator.msSaveOrOpenBlob(blob, `Inspecao_Qualidade_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.csv`); } else {
                    const link = document.createElement("a"); const url = URL.createObjectURL(blob);
                    link.setAttribute("href", url); link.setAttribute("download", `Inspecao_Qualidade_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.csv`);
                    link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url); 
                }
                notify('Sucesso', 'Relatório Excel gerado com valores das medições!', 'sucesso');
            } catch (error) { console.error("Erro detalhado na exportação: ", error); notify('Erro', 'Falha ao tentar gerar o arquivo.', 'erro'); }
        };

        const removerInspecao = async (id) => {
            if(confirm('Tem certeza que deseja EXCLUIR este registro?')) {
                try { await deleteDoc(doc(db, "inspecoes", id)); notify('Excluído', 'Registro removido.', 'sucesso'); } 
                catch(e) { notify('Erro', 'Erro ao excluir.', 'erro'); }
            }
        };

        const produtosFiltrados = computed(() => { if (!produtoSearch.value) return cadastros.value.produtos; return cadastros.value.produtos.filter(p => p.nome.toLowerCase().includes(produtoSearch.value.toLowerCase())); });
        const selecionarProduto = (nome) => { form.value.produto = nome; produtoSearch.value = nome; mostrandoListaProdutos.value = false; salvarRascunho(); };
        const produtosAdminFiltrados = computed(() => { let lista = [...cadastros.value.produtos]; lista.reverse(); if (filtroAdminProdutos.value) { lista = lista.filter(p => p.nome.toLowerCase().includes(filtroAdminProdutos.value.toLowerCase())); } return lista.slice(0, 5); });
        
        const salvarAlteracoesAdmin = async () => {
            if (!relatorioSelecionado.value) return; const rel = relatorioSelecionado.value; let novoResultado = 'Aprovado';
            rel.pecas.forEach(p => { Object.values(p.laterais).forEach(v => { if (!getStatusRelatorio(rel, v, 'lateral')) novoResultado = 'Reprovado'; }); Object.values(p.centrais).forEach(v => { if (!getStatusRelatorio(rel, v, 'central')) novoResultado = 'Reprovado'; }); });
            rel.resultado = novoResultado;
            try { await updateDoc(doc(db, "inspecoes", rel.id), { pecas: rel.pecas, resultado: novoResultado }); notify('Salvo', 'Atualizado.', 'sucesso'); relatorioSelecionado.value = null; } catch (e) { notify('Erro', 'Falha ao salvar.', 'erro'); }
        };

        // Modificado para carregar a role Analista
        const handleLogin = () => { 
            loading.value = true; 
            setTimeout(() => { 
                const { user, pass, remember } = loginData.value; 
                const userLower = user.toLowerCase(); 
                if (userLower === 'admin' && pass === 'admin') { 
                    currentView.value = 'admin'; 
                    loginData.value.perfil = 'admin';
                    loginData.value.nome = 'Administrador';
                    notify('Super Admin', 'OK', 'sucesso'); loading.value = false; return; 
                } 
                const usuarioEncontrado = cadastros.value.usuarios.find(u => u.login === userLower && u.matricula === pass); 
                if (usuarioEncontrado) { 
                    const perfilAtribuido = usuarioEncontrado.perfil || (usuarioEncontrado.admin ? 'admin' : 'inspetor');
                    loginData.value.perfil = perfilAtribuido;
                    loginData.value.nome = usuarioEncontrado.nome || userLower;

                    if (remember) { 
                        localStorage.setItem('qc_user', userLower); localStorage.setItem('qc_pass', pass); 
                    } else { 
                        localStorage.removeItem('qc_user'); localStorage.removeItem('qc_pass'); 
                    } 
                    
                    if (perfilAtribuido === 'admin' || perfilAtribuido === 'analista') { 
                        currentView.value = 'admin'; 
                    } else { 
                        currentView.value = 'inspector'; 
                        if(form.value.pecas.length === 0) adicionarPeca(); showStartModal.value = true; 
                    }
                    notify('Bem-vindo', `Olá, ${usuarioEncontrado.nome}`, 'sucesso'); 
                } else { 
                    notify('Erro', 'Incorreto.', 'erro'); 
                } 
                loading.value = false; 
            }, 600); 
        };
        
        const cadastrarUsuario = async () => { 
            const { nome, matricula, perfil } = novoUsuarioForm.value; 
            if (!nome || !matricula) { notify('Erro', 'Preencha tudo', 'erro'); return; } 
            const partesNome = nome.trim().toLowerCase().split(' '); const primeiroNome = partesNome[0]; const ultimoSobrenome = partesNome.length > 1 ? partesNome[partesNome.length - 1] : ''; const loginGerado = ultimoSobrenome ? `${primeiroNome}.${ultimoSobrenome}` : primeiroNome; const loginFinal = loginGerado.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
            const isAdmin = perfil === 'admin';
            try { 
                await addDoc(collection(db, "usuarios"), { nome: nome, matricula: matricula, login: loginFinal, admin: isAdmin, perfil: perfil }); 
                novoUsuarioForm.value = { nome: '', matricula: '', perfil: 'inspetor' }; notify('Sucesso', `Login: ${loginFinal}`, 'sucesso'); 
            } catch (e) { notify('Erro', e.message, 'erro'); } 
        };
        
        const mascararInput = (event, pecaObj, tipo, chave) => { let input = event.target; let valorOriginal = input.value; let isNegative = valorOriginal.includes('-'); let numeros = valorOriginal.replace(/\D/g, ''); let digitosReais = numeros.replace(/^0+/, ''); let valorVisual = ''; let valorFloat = 0; if (numeros.length > 0) { valorFloat = parseInt(numeros) / 100; valorVisual = valorFloat.toFixed(2).replace('.', ','); } if (isNegative) { valorVisual = '-' + valorVisual; valorFloat = valorFloat * -1; } if (numeros.length === 0 && !isNegative) { valorVisual = ''; valorFloat = null; } else if (numeros.length === 0 && isNegative) { valorVisual = '-'; } if (tipo === 'laterais') { pecaObj.lateraisDisplay[chave] = valorVisual; pecaObj.laterais[chave] = valorFloat; } else { pecaObj.centraisDisplay[chave] = valorVisual; pecaObj.centrais[chave] = valorFloat; } input.value = valorVisual; if (digitosReais.length >= 3) focarProximoInput(input); salvarRascunho(); };

        // ─── DETECTORES DE DADOS PREENCHIDOS ────────────────────────────────────
        // Cada seção só é considerada se tiver ao menos um valor real preenchido.

        const temDadosEmpeno = computed(() => {
            return form.value.pecas.some(p =>
                Object.values(p.laterais).some(v => v !== null && v !== '') ||
                Object.values(p.centrais).some(v => v !== null && v !== '')
            );
        });

        const temDadosEspessura = computed(() => {
            if (!form.value.espessuraDeclarada) return false;
            return form.value.pecasEspessura.some(p =>
                (p.pontos || []).some(v => v !== null && v !== '' && !isNaN(parseFloat(v)))
            );
        });

        const temDadosTamanhoEsquadro = computed(() => {
            return form.value.medicoesTamanhoEsquadro.some(m =>
                (m.tamanho !== null && m.tamanho !== '') ||
                (m.esquadro !== null && m.esquadro !== '')
            );
        });

        // ─── SALVAR RASCUNHO (inteligente) ───────────────────────────────────────
        const salvarRascunho = async () => {
            if (!form.value.formatoId || showStartModal.value) return;
            salvandoAuto.value = true;

            const limitesSnapshot = {
                latMin: configAtiva.value.latMin, latMax: configAtiva.value.latMax,
                centMin: configAtiva.value.centMin, centMax: configAtiva.value.centMax,
                tamanhoMin: configAtiva.value.tamanhoMin, tamanhoMax: configAtiva.value.tamanhoMax,
                esquadroMin: configAtiva.value.esquadroMin, esquadroMax: configAtiva.value.esquadroMax
            };

            // Resultado: só avalia seções que têm dados preenchidos
            let resultadoGeral = 'Aprovado';
            if (temDadosEmpeno.value) {
                form.value.pecas.forEach(p => {
                    Object.values(p.laterais).forEach(v => { if (getStatusClass(v, 'lateral') === 'status-bad') resultadoGeral = 'Reprovado'; });
                    Object.values(p.centrais).forEach(v => { if (getStatusClass(v, 'central') === 'status-bad') resultadoGeral = 'Reprovado'; });
                });
            }
            if (temDadosEspessura.value && resultadoEspessura.value === 'Reprovado') resultadoGeral = 'Reprovado';
            if (temDadosTamanhoEsquadro.value && resultadoTamanhoEsquadro.value === 'Reprovado') resultadoGeral = 'Reprovado';

            // Monta payload: só inclui seções com dados
            const dados = {
                inspetor: loginData.value.user, dataHora: new Date(),
                linha: form.value.linha, produto: form.value.produto,
                formatoId: form.value.formatoId, formatoNome: configAtiva.value.nome,
                limitesSnapshot, lote: form.value.lote ? form.value.lote.toUpperCase() : '',
                posFolga: form.value.posFolga, resultado: resultadoGeral,
                // Empeno: inclui sempre (estrutura base), mas marca se tem dados
                pecas: form.value.pecas.map(p => ({ laterais: p.laterais, centrais: p.centrais })),
                temDadosEmpeno: temDadosEmpeno.value,
                // Espessura: só salva se tiver dado real
                espessuraDeclarada: temDadosEspessura.value ? (form.value.espessuraDeclarada || null) : null,
                pecasEspessura: temDadosEspessura.value
                    ? form.value.pecasEspessura
                        .filter(p => (p.pontos || []).some(v => v !== null && v !== '' && !isNaN(parseFloat(v))))
                        .map(p => ({ prensa: p.prensa, cavidade: p.cavidade, pontos: p.pontos.filter(v => v !== null && v !== ''), media: calcMediaPecaEspessura(p) }))
                    : [],
                // Tamanho & Esquadro: só salva medições com ao menos um valor
                medicoesTamanhoEsquadro: temDadosTamanhoEsquadro.value
                    ? form.value.medicoesTamanhoEsquadro.filter(m => (m.tamanho !== null && m.tamanho !== '') || (m.esquadro !== null && m.esquadro !== ''))
                    : [],
                status: 'rascunho'
            };

            try {
                if (currentInspectionId.value) { await updateDoc(doc(db, "inspecoes", currentInspectionId.value), dados); }
                else { const ref = await addDoc(collection(db, "inspecoes"), dados); currentInspectionId.value = ref.id; }
            } catch (e) { console.error(e); }
            finally { setTimeout(() => salvandoAuto.value = false, 500); }
        };

        // ─── GERAR RELATÓRIO FINAL (inteligente) ─────────────────────────────────
        const gerarRelatorioFinal = async () => {
            if (!form.value.linha || !form.value.produto || !form.value.formatoId) { notify('Erro', 'Cabeçalho incompleto.', 'erro'); return; }
            if (!form.value.posFolga) { notify('Atenção', 'Preencha se é Pós Folga.', 'erro'); return; }
            if (!temDadosEmpeno.value && !temDadosEspessura.value && !temDadosTamanhoEsquadro.value) {
                notify('Atenção', 'Nenhuma medição foi preenchida.', 'erro'); return;
            }

            await salvarRascunho();
            if (currentInspectionId.value) await updateDoc(doc(db, "inspecoes", currentInspectionId.value), { status: 'finalizado' });

            const now = new Date();
            const conf = configAtiva.value;
            const dataHora = `${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR').slice(0,5)}`;

            // Calcula resultado geral para o banner final
            let resultadoFinal = 'APROVADO ✅';
            if (temDadosEmpeno.value) {
                for (const p of form.value.pecas) {
                    for (const v of Object.values(p.laterais)) { if (getStatusClass(v, 'lateral') === 'status-bad') { resultadoFinal = 'REPROVADO ❌'; break; } }
                    for (const v of Object.values(p.centrais)) { if (getStatusClass(v, 'central') === 'status-bad') { resultadoFinal = 'REPROVADO ❌'; break; } }
                }
            }
            if (temDadosEspessura.value   && resultadoEspessura.value   === 'Reprovado') resultadoFinal = 'REPROVADO ❌';
            if (temDadosTamanhoEsquadro.value && resultadoTamanhoEsquadro.value === 'Reprovado') resultadoFinal = 'REPROVADO ❌';

            let txt = '';

            // ── CABEÇALHO (igual à foto) ──
            txt += `*RELATÓRIO DE EMPENO*\n`;
            txt += `*Data:* ${dataHora}\n`;
            txt += `*Responsável:* ${loginData.value.nome || loginData.value.user}\n`;
            txt += `*Linha:* ${form.value.linha}\n`;
            txt += `*Produto:* ${form.value.produto}\n`;
            txt += `*Formato:* ${conf.nome}\n`;
            txt += `*Lote:* ${form.value.lote}`;
            if (form.value.posFolga === 'Sim') txt += ` *(Pós Folga)*`;
            txt += `\n`;

            // ── SEÇÃO EMPENO ──
            if (temDadosEmpeno.value) {
                txt += `\nRange Lateral:(${conf.latMin} a ${conf.latMax})\n`;
                txt += `Range Central:(${conf.centMin} a ${conf.centMax})\n`;

                let numPeca = 0;
                form.value.pecas.forEach((p) => {
                    const lats  = ['A','B','C','D'].filter(l => p.laterais[l] !== null && p.laterais[l] !== '');
                    const cents = [1, 2].filter(c => p.centrais[c] !== null && p.centrais[c] !== '');
                    if (!lats.length && !cents.length) return;
                    numPeca++;
                    txt += `\n*Peça ${numPeca}*\n`;
                    lats.forEach(lado => {
                        const ok = getStatusClass(p.laterais[lado], 'lateral') === 'status-ok';
                        txt += `${ok ? '🟢' : '🔴'} Lado ${lado}: ${p.lateraisDisplay[lado]}\n`;
                    });
                    if (cents.length) {
                        txt += `*Central*\n`;
                        cents.forEach(num => {
                            const label = num === 1 ? 'A' : 'B';
                            const ok = getStatusClass(p.centrais[num], 'central') === 'status-ok';
                            txt += `${ok ? '🟢' : '🔴'} Lado ${label}: ${p.centraisDisplay[num]}\n`;
                        });
                    }
                });
            }

            // ── SEÇÃO ESPESSURA ──
            if (temDadosEspessura.value) {
                txt += `\n*ESPESSURA*\n`;
                txt += `Declarada: ${form.value.espessuraDeclarada}mm  Range:(${espessuraMin.value?.toFixed(2)} a ${espessuraMax.value?.toFixed(2)})\n`;
                form.value.pecasEspessura.forEach(p => {
                    const pontosValidos = (p.pontos || []).filter(v => v !== null && v !== '' && !isNaN(parseFloat(v)));
                    if (!pontosValidos.length) return;
                    const med = calcMediaPecaEspessura(p);
                    const ok  = med !== null && getStatusEspessura(med) === 'status-ok';
                    const id  = [p.prensa ? `Prensa ${p.prensa}` : '', p.cavidade ? `Cav ${p.cavidade}` : ''].filter(Boolean).join(' / ') || 'Peça';
                    txt += `\n*${id}*\n`;
                    pontosValidos.forEach((v, pi) => {
                        txt += `Ponto ${pi + 1}: ${parseFloat(v).toFixed(2)}mm\n`;
                    });
                    txt += `${ok ? '🟢' : '🔴'} Média: ${med !== null ? med.toFixed(2) : '-'}mm\n`;
                });
            }

            // ── SEÇÃO TAMANHO & ESQUADRO ──
            if (temDadosTamanhoEsquadro.value) {
                txt += `\n*TAMANHO & ESQUADRO*\n`;
                if (conf.tamanhoMin !== undefined) {
                    txt += `Range Tamanho:(${conf.tamanhoMin} a ${conf.tamanhoMax})\n`;
                    txt += `Range Esquadro:(${conf.esquadroMin} a ${conf.esquadroMax})\n`;
                }
                let numMed = 0;
                form.value.medicoesTamanhoEsquadro.forEach(m => {
                    const temTam = m.tamanho !== null && m.tamanho !== '';
                    const temEsq = m.esquadro !== null && m.esquadro !== '';
                    if (!temTam && !temEsq) return;
                    numMed++;
                    const retLabel = m.retifica ? ` — Ret. ${m.retifica}` : '';
                    txt += `\n*Medição ${numMed}${retLabel}*\n`;
                    if (temTam) { const ok = getStatusTamanho(m.tamanho) === 'status-ok'; txt += `${ok ? '🟢' : '🔴'} Tamanho: ${m.tamanho}mm\n`; }
                    if (temEsq) { const ok = getStatusEsquadro(m.esquadro) === 'status-ok'; txt += `${ok ? '🟢' : '🔴'} Esquadro: ${m.esquadro}mm\n`; }
                });
            }

            /*── RESULTADO FINAL ──
            txt += `\n*━━━━━━━━━━━━━━━━━━━━*\n`;
            txt += `*RESULTADO: ${resultadoFinal}*\n`;
            txt += `*━━━━━━━━━━━━━━━━━━━━*`;*/

            reportText.value = txt;
            notify('Sucesso', 'Relatório gerado!', 'sucesso');
        };
        const getStatusRelatorio = (relatorio, valor, tipo) => {
            if (valor === null || valor === undefined || valor === '') return true;
            const num = parseFloat(valor);
            if (tipo === 'tamanho' || tipo === 'esquadro') {
                const fmt = cadastros.value.formatos.find(f => f.id === relatorio.formatoId);
                if (!fmt) return true;
                const min = tipo === 'tamanho' ? fmt.tamanhoMin : fmt.esquadroMin;
                const max = tipo === 'tamanho' ? fmt.tamanhoMax : fmt.esquadroMax;
                if (min === undefined || max === undefined) return true;
                return num >= min && num <= max;
            }
            const limites = relatorio.limitesSnapshot || cadastros.value.formatos.find(f => f.id === relatorio.formatoId) || { latMin: -99, latMax: 99, centMin: -99, centMax: 99 };
            const min = tipo === 'lateral' ? limites.latMin : limites.centMin;
            const max = tipo === 'lateral' ? limites.latMax : limites.centMax;
            return (num >= min && num <= max);
        };
        const configAtiva = computed(() => cadastros.value.formatos.find(f => f.id === form.value.formatoId) || { nome: '...', latMin: -99, latMax: 99, centMin: -99, centMax: 99 });
        const getStatusClass = (val, tipo) => { if (val == null || val === '') return ''; const min = tipo === 'lateral' ? configAtiva.value.latMin : configAtiva.value.centMin; const max = tipo === 'lateral' ? configAtiva.value.latMax : configAtiva.value.centMax; return (val >= min && val <= max) ? 'status-ok' : 'status-bad'; };
        const focarProximoInput = (el) => { const inputs = Array.from(document.querySelectorAll('.input-medicao')); const idx = inputs.indexOf(el); if (idx > -1 && idx < inputs.length - 1) inputs[idx + 1].focus(); };

        // ─── ESPESSURA ──────────────────────────────────────────────────────────
        // Estrutura: pecasEspessura = [{ prensa: '1', cavidade: '2', pontos: [val, val, ...] }]
        // Prensa e Cavidade = identificadores da peça (ex: Prensa 2, Cavidade 4)
        // Pontos = medições numéricas; média dos pontos = resultado da peça

        const espessuraMin = computed(() => form.value.espessuraDeclarada ? +(form.value.espessuraDeclarada * 0.95).toFixed(4) : null);
        const espessuraMax = computed(() => form.value.espessuraDeclarada ? +(form.value.espessuraDeclarada * 1.05).toFixed(4) : null);

        const calcMediaPecaEspessura = (peca) => {
            const vals = (peca.pontos || []).filter(v => v !== null && v !== '' && !isNaN(parseFloat(v)));
            if (!vals.length) return null;
            return vals.reduce((a, b) => a + parseFloat(b), 0) / vals.length;
        };

        const getStatusEspessura = (media) => {
            if (media === null || media === undefined) return '';
            if (espessuraMin.value === null) return '';
            return (media >= espessuraMin.value && media <= espessuraMax.value) ? 'status-ok' : 'status-bad';
        };

        const adicionarPecaEspessura = () => {
            form.value.pecasEspessura.push({ prensa: '', cavidade: '', pontos: [null] });
            salvarRascunho();
        };
        const removerPecaEspessura = (idx) => { form.value.pecasEspessura.splice(idx, 1); salvarRascunho(); };
        const adicionarPontoNaPeca = (peca) => { peca.pontos.push(null); salvarRascunho(); };
        const removerPontoDaPeca = (peca, pidx) => { if (peca.pontos.length > 1) { peca.pontos.splice(pidx, 1); salvarRascunho(); } };

        const resultadoEspessura = computed(() => {
            if (!form.value.espessuraDeclarada || !form.value.pecasEspessura.length) return null;
            const medias = form.value.pecasEspessura.map(p => calcMediaPecaEspessura(p)).filter(m => m !== null);
            if (!medias.length) return null;
            return medias.every(m => m >= espessuraMin.value && m <= espessuraMax.value) ? 'Aprovado' : 'Reprovado';
        });

        // ─── TAMANHO & ESQUADRO ─────────────────────────────────────────────────
        // Range vem do formato (tamanhoMin/tamanhoMax/esquadroMin/esquadroMax)
        // Retífica = campo informativo de rastreabilidade apenas (texto livre)
        // Estrutura: medicoesTamanhoEsquadro = [{ retifica: '1', tamanho: null, esquadro: null }]

        const getStatusTamanho = (valor) => {
            if (valor === null || valor === '' || valor === undefined) return '';
            const fmt = configAtiva.value;
            if (fmt.tamanhoMin === undefined || fmt.tamanhoMax === undefined) return '';
            return (parseFloat(valor) >= fmt.tamanhoMin && parseFloat(valor) <= fmt.tamanhoMax) ? 'status-ok' : 'status-bad';
        };
        const getStatusEsquadro = (valor) => {
            if (valor === null || valor === '' || valor === undefined) return '';
            const fmt = configAtiva.value;
            if (fmt.esquadroMin === undefined || fmt.esquadroMax === undefined) return '';
            return (parseFloat(valor) >= fmt.esquadroMin && parseFloat(valor) <= fmt.esquadroMax) ? 'status-ok' : 'status-bad';
        };
        const adicionarMedicaoTE = () => { form.value.medicoesTamanhoEsquadro.push({ retifica: '', tamanho: null, esquadro: null }); salvarRascunho(); };
        const removerMedicaoTE = (idx) => { form.value.medicoesTamanhoEsquadro.splice(idx, 1); salvarRascunho(); };
        const resultadoTamanhoEsquadro = computed(() => {
            const meds = form.value.medicoesTamanhoEsquadro;
            if (!meds.length) return null;
            for (const m of meds) {
                if (getStatusTamanho(m.tamanho) === 'status-bad') return 'Reprovado';
                if (getStatusEsquadro(m.esquadro) === 'status-bad') return 'Reprovado';
            }
            const temValor = meds.some(m => m.tamanho !== null || m.esquadro !== null);
            return temValor ? 'Aprovado' : null;
        });
        const adicionarPeca = () => { form.value.pecas.push({ laterais: {A:null,B:null,C:null,D:null}, lateraisDisplay: {A:'',B:'',C:'',D:''}, centrais: {1:null,2:null}, centraisDisplay: {1:'',2:''} }); salvarRascunho(); };
        const removerPeca = (idx) => { if (form.value.pecas.length > 0) { form.value.pecas.splice(idx, 1); salvarRascunho(); } };
        const formatarData = (ts) => ts && ts.seconds ? new Date(ts.seconds * 1000).toLocaleDateString('pt-BR') : '-';
        const abrirDetalhesRelatorio = (r) => relatorioSelecionado.value = r;
        const logout = () => { currentView.value = 'login'; loginData.value = { user: '', pass: '', remember: false, perfil: '' }; localStorage.removeItem('qc_user'); localStorage.removeItem('qc_pass'); };
        const novaInspecaoLimpa = () => { reportText.value = ''; currentInspectionId.value = null; form.value.pecas = []; form.value.lote = ''; form.value.posFolga = ''; form.value.produto = ''; form.value.linha = ''; form.value.formatoId = ''; form.value.espessuraDeclarada = null; form.value.pecasEspessura = []; form.value.medicoesTamanhoEsquadro = []; produtoSearch.value = ''; showStartModal.value = true; inspectorTab.value = 'empeno'; adicionarPeca(); };
        const novoFormato = async () => { const n = prompt("Nome do Formato:"); if(n) addDoc(collection(db,"formatos"), {nome:n, latMin:-0.5, latMax:0.5, centMin:-1, centMax:1}); };
        const novoItemSimples = async (collectionName) => { const n = prompt("Nome:"); if(!n) return; const nomeTrimmed = n.trim(); const existe = cadastros.value[collectionName].some(item => item.nome.toLowerCase() === nomeTrimmed.toLowerCase()); if (existe) { notify('Atenção', 'Este item já está cadastrado.', 'erro'); return; } try { await addDoc(collection(db, collectionName), {nome: nomeTrimmed}); notify('Sucesso', 'Cadastrado com sucesso.', 'sucesso'); } catch(e) { notify('Erro', 'Falha ao cadastrar.', 'erro'); } };
        const importarProdutosCSV = (event) => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = async (e) => { const text = e.target.result; const linhas = text.split('\n').map(l => l.trim()).filter(l => l); let importados = 0; notify('Importação', 'A processar...', 'info'); for (const nome of linhas) { const existe = cadastros.value.produtos.some(p => p.nome.toLowerCase() === nome.toLowerCase()); if (!existe) { try { await addDoc(collection(db, 'produtos'), {nome: nome}); importados++; } catch(err) { console.error(err); } } } notify('Concluído', `${importados} novos produtos importados.`, 'sucesso'); event.target.value = ''; }; reader.readAsText(file); };
        const atualizarItemSimples = async (collectionName, item) => { const nomeTrimmed = item.nome.trim(); const existe = cadastros.value[collectionName].some(i => i.nome.toLowerCase() === nomeTrimmed.toLowerCase() && i.id !== item.id); if (existe) { notify('Atenção', 'Já existe um item com este nome.', 'erro'); return; } try { await updateDoc(doc(db, collectionName, item.id), {nome: nomeTrimmed}); } catch(e) { notify('Erro', 'Falha ao atualizar.', 'erro'); } };
        const atualizarFormato = async (f) => { const {id,...d}=f; await updateDoc(doc(db,"formatos",id),d); };
        const removerItem = async (c, id) => { if(confirm("Excluir?")) deleteDoc(doc(db,c,id)); };
        const copiarTextoDim = () => navigator.clipboard.writeText(dimReportText.value).then(() => notify('Copiado', 'Texto copiado!', 'sucesso'));
        const enviarZapDim = () => window.open(`https://wa.me/?text=${encodeURIComponent(dimReportText.value)}`, '_blank');

        // ── Gerar HTML interno do card para imagem/PDF ────────────────────────
        const gerarHTMLCardDim = () => {
            const rel = {
                nomeInspetor: loginData.value.nome || loginData.value.user,
                dataHora: new Date(),
                linha: formDim.value.linha,
                produto: formDim.value.produto,
                formatoNome: configDimAtiva.value.nome,
                lote: formDim.value.lote,
                espessuraDeclarada: formDim.value.espessuraDeclarada,
                pecasEspessura: formDim.value.pecasEspessura,
                medicoesTamanhoEsquadro: formDim.value.medicoesTamanhoEsquadro,
                limitesSnapshot: {
                    tamanhoMin: configDimAtiva.value.tamanhoMin, tamanhoMax: configDimAtiva.value.tamanhoMax,
                    esquadroMin: configDimAtiva.value.esquadroMin, esquadroMax: configDimAtiva.value.esquadroMax
                }
            };
            const dataStr = rel.dataHora.toLocaleDateString('pt-BR') + ' ' + rel.dataHora.toLocaleTimeString('pt-BR').slice(0,5);
            const aprovado = (resultadoEspessuraDim.value !== 'Reprovado' && resultadoTEDim.value !== 'Reprovado');

            let html = `<div style="border-bottom:2px solid #7c3aed;padding-bottom:14px;margin-bottom:20px;">
                <div style="font-size:20px;font-weight:900;color:#7c3aed;margin-bottom:6px;">📐 ANÁLISE DIMENSIONAL</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px;color:#475569;">
                    <span><b>Data:</b> ${dataStr}</span><span><b>Inspetor:</b> ${rel.nomeInspetor}</span>
                    <span><b>Linha:</b> ${rel.linha}</span><span><b>Formato:</b> ${rel.formatoNome}</span>
                    <span><b>Produto:</b> ${rel.produto}</span><span><b>Lote:</b> ${rel.lote}</span>
                </div></div>`;

            // Espessura
            if (temDadosEspessuraDim.value && rel.espessuraDeclarada) {
                const eMin = +(rel.espessuraDeclarada * 0.95).toFixed(3);
                const eMax = +(rel.espessuraDeclarada * 1.05).toFixed(3);
                html += `<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;border-bottom:1px solid #ede9fe;padding-bottom:4px;">Espessura — Declarada: ${rel.espessuraDeclarada}mm | Range: ${eMin}–${eMax}mm</div>`;
                rel.pecasEspessura.forEach((p, i) => {
                    const pontosValidos = (p.pontos||[]).filter(v => v !== null && v !== '');
                    if (!pontosValidos.length) return;
                    const med = calcMediaPecaDim(p);
                    const ok = med !== null && med >= eMin && med <= eMax;
                    const id = [p.prensa ? `Prensa ${p.prensa}` : '', p.cavidade ? `Cav ${p.cavidade}` : ''].filter(Boolean).join(' / ') || `Peça ${i+1}`;
                    html += `<div style="background:${ok ? '#f0fdf4' : '#fef2f2'};border:1px solid ${ok ? '#bbf7d0' : '#fecaca'};border-radius:8px;padding:8px 12px;margin-bottom:6px;">
                        <div style="font-weight:700;font-size:12px;color:${ok ? '#166534' : '#991b1b'}">${ok ? '✅' : '❌'} ${id} — Média: ${med !== null ? med.toFixed(3) : '-'}mm</div>
                        <div style="font-size:11px;color:#64748b;margin-top:2px;">${pontosValidos.map((v,pi) => `P${pi+1}: ${parseFloat(v).toFixed(3)}mm`).join('  |  ')}</div>
                    </div>`;
                });
                html += `</div>`;
            }

            // Tamanho & Esquadro
            if (temDadosTEDim.value) {
                const ls = rel.limitesSnapshot;
                html += `<div style="margin-bottom:16px;"><div style="font-size:11px;font-weight:700;color:#ea580c;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;border-bottom:1px solid #ffedd5;padding-bottom:4px;">Tamanho & Esquadro${ls.tamanhoMin !== undefined ? ` — Tam: ${ls.tamanhoMin}–${ls.tamanhoMax} | Esq: ${ls.esquadroMin}–${ls.esquadroMax}` : ''}</div>`;
                rel.medicoesTamanhoEsquadro.forEach((m, i) => {
                    const tt = m.tamanho !== null && m.tamanho !== ''; const te = m.esquadro !== null && m.esquadro !== '';
                    if (!tt && !te) return;
                    const okT = tt && ls.tamanhoMin !== undefined ? parseFloat(m.tamanho) >= ls.tamanhoMin && parseFloat(m.tamanho) <= ls.tamanhoMax : true;
                    const okE = te && ls.esquadroMin !== undefined ? parseFloat(m.esquadro) >= ls.esquadroMin && parseFloat(m.esquadro) <= ls.esquadroMax : true;
                    html += `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px 12px;margin-bottom:6px;">
                        <div style="font-weight:700;font-size:12px;color:#9a3412;">Medição ${i+1}${m.retifica ? ' — Ret. ' + m.retifica : ''}</div>
                        <div style="font-size:12px;margin-top:4px;display:flex;gap:16px;">
                            ${tt ? `<span>${okT ? '✅' : '❌'} Tamanho: <b>${m.tamanho}mm</b></span>` : ''}
                            ${te ? `<span>${okE ? '✅' : '❌'} Esquadro: <b>${m.esquadro}mm</b></span>` : ''}
                        </div></div>`;
                });
                html += `</div>`;
            }

            // Resultado
            html += `<div style="margin-top:20px;padding:14px;border-radius:10px;text-align:center;font-size:18px;font-weight:900;background:${aprovado ? '#f0fdf4' : '#fef2f2'};color:${aprovado ? '#166534' : '#991b1b'};border:2px solid ${aprovado ? '#86efac' : '#fca5a5'};">
                RESULTADO: ${aprovado ? 'APROVADO ✅' : 'REPROVADO ❌'}
            </div>
            <div style="margin-top:14px;font-size:10px;color:#94a3b8;text-align:right;">QualityControl — Empeno Pro</div>`;

            return html;
        };

        // ── Baixar imagem ─────────────────────────────────────────────────────
        const baixarImagemDim = async () => {
            const btn = document.getElementById('btn-img-dim');
            if (btn) btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin text-xl"></i>';
            try {
                const card = document.getElementById('dim-print-card');
                card.innerHTML = gerarHTMLCardDim();
                card.style.display = 'block';
                await nextTick();
                const canvas = await html2canvas(card, { backgroundColor: '#ffffff', scale: 2, windowWidth: 620 });
                card.style.display = 'none';
                const now = new Date();
                const fileName = `Dimensional_${formDim.value.lote || 'sem_lote'}_${now.toLocaleDateString('pt-BR').replace(/\//g,'-')}.png`;
                const link = document.createElement('a'); link.download = fileName; link.href = canvas.toDataURL('image/png'); link.click();
                notify('Sucesso', 'Imagem gerada!', 'sucesso');
            } catch(e) { console.error(e); notify('Erro', 'Falha ao gerar imagem.', 'erro'); }
            finally { if (btn) btn.innerHTML = '<i class="ph-fill ph-image text-xl text-violet-500"></i> Imagem'; }
        };

        // ── Baixar PDF ────────────────────────────────────────────────────────
        const baixarPDFDim = () => {
            const now = new Date();
            const dataStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR').slice(0,5);
            const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Dimensional</title>
            <style>body{margin:0;padding:32px;font-family:Arial,sans-serif;font-size:13px;color:#1e293b;}
            @media print{body{padding:20px;} .no-print{display:none;} @page{margin:1cm;}}</style></head>
            <body>${gerarHTMLCardDim()}
            <script>window.onload=function(){window.print();}<\/script></body></html>`;
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const win = window.open(url, '_blank');
            if (!win) notify('Atenção', 'Permita pop-ups para gerar o PDF.', 'info');
            notify('PDF', 'Use "Salvar como PDF" no diálogo de impressão.', 'info');
        };

        // ── Baixar CSV ────────────────────────────────────────────────────────
        const baixarCSVDim = () => {
            try {
                const now = new Date();
                const dataStr = now.toLocaleDateString('pt-BR');
                const horaStr = now.toLocaleTimeString('pt-BR').slice(0,5);
                let csv = '\uFEFF'; // BOM UTF-8

                // Cabeçalho geral
                csv += `Data;Hora;Inspetor;Linha;Produto;Formato;Lote;Resultado\n`;
                const aprovado = resultadoEspessuraDim.value !== 'Reprovado' && resultadoTEDim.value !== 'Reprovado';
                csv += `"${dataStr}";"${horaStr}";"${loginData.value.nome || loginData.value.user}";"${formDim.value.linha}";"${formDim.value.produto}";"${configDimAtiva.value.nome}";"${formDim.value.lote}";"${aprovado ? 'Aprovado' : 'Reprovado'}"\n\n`;

                // Espessura
                if (temDadosEspessuraDim.value) {
                    const eMin = +(formDim.value.espessuraDeclarada * 0.95).toFixed(3);
                    const eMax = +(formDim.value.espessuraDeclarada * 1.05).toFixed(3);
                    csv += `ESPESSURA\nDeclarada;${formDim.value.espessuraDeclarada}mm;Min;${eMin};Max;${eMax}\n`;
                    csv += `Peça;Prensa;Cavidade;${Array.from({length:10},(_,i)=>'Ponto '+(i+1)).join(';')};Média;Status\n`;
                    formDim.value.pecasEspessura.forEach((p, i) => {
                        const pontos = (p.pontos||[]).filter(v => v !== null && v !== '');
                        if (!pontos.length) return;
                        const med = calcMediaPecaDim(p);
                        const ok = med !== null && med >= eMin && med <= eMax;
                        const pontosStr = pontos.map(v => parseFloat(v).toFixed(3)).join(';');
                        csv += `"Peça ${i+1}";"${p.prensa||''}";"${p.cavidade||''}";${pontosStr};"${med !== null ? med.toFixed(3) : ''}";"${ok ? 'Aprovado' : 'Reprovado'}"\n`;
                    });
                    csv += `\n`;
                }

                // Tamanho & Esquadro
                if (temDadosTEDim.value) {
                    const ls = { tamanhoMin: configDimAtiva.value.tamanhoMin, tamanhoMax: configDimAtiva.value.tamanhoMax, esquadroMin: configDimAtiva.value.esquadroMin, esquadroMax: configDimAtiva.value.esquadroMax };
                    csv += `TAMANHO & ESQUADRO\n`;
                    if (ls.tamanhoMin !== undefined) csv += `Range Tamanho;${ls.tamanhoMin};${ls.tamanhoMax};Range Esquadro;${ls.esquadroMin};${ls.esquadroMax}\n`;
                    csv += `Medição;Retífica;Tamanho (mm);Status Tamanho;Esquadro (mm);Status Esquadro\n`;
                    formDim.value.medicoesTamanhoEsquadro.forEach((m, i) => {
                        const tt = m.tamanho !== null && m.tamanho !== ''; const te = m.esquadro !== null && m.esquadro !== '';
                        if (!tt && !te) return;
                        const okT = tt && ls.tamanhoMin !== undefined ? parseFloat(m.tamanho) >= ls.tamanhoMin && parseFloat(m.tamanho) <= ls.tamanhoMax : null;
                        const okE = te && ls.esquadroMin !== undefined ? parseFloat(m.esquadro) >= ls.esquadroMin && parseFloat(m.esquadro) <= ls.esquadroMax : null;
                        csv += `"Medição ${i+1}";"${m.retifica||''}";"${tt ? m.tamanho : ''}";"${okT !== null ? (okT ? 'Aprovado' : 'Reprovado') : ''}";"${te ? m.esquadro : ''}";"${okE !== null ? (okE ? 'Aprovado' : 'Reprovado') : ''}"\n`;
                    });
                }

                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `Dimensional_${formDim.value.lote || 'sem_lote'}_${now.toLocaleDateString('pt-BR').replace(/\//g,'-')}.csv`;
                link.click(); URL.revokeObjectURL(link.href);
                notify('Sucesso', 'CSV exportado!', 'sucesso');
            } catch(e) { console.error(e); notify('Erro', 'Falha ao gerar CSV.', 'erro'); }
        };

        const copiarTexto = () => navigator.clipboard.writeText(reportText.value);
        const enviarZap = () => window.open(`https://wa.me/?text=${encodeURIComponent(reportText.value)}`, '_blank');

        onMounted(() => {
            const loader = document.getElementById('initial-loader');
            if (loader) { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 500); }
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) { isDarkMode.value = true; document.documentElement.classList.add('dark'); } else { document.documentElement.classList.remove('dark'); }
            const savedUser = localStorage.getItem('qc_user'); const savedPass = localStorage.getItem('qc_pass');
            if (savedUser && savedPass) { loginData.value = { user: savedUser, pass: savedPass, remember: true, perfil: '', nome: '' }; }
            
            onSnapshot(collection(db, "formatos"), s => cadastros.value.formatos = s.docs.map(d=>({id:d.id,...d.data()})));
            onSnapshot(collection(db, "produtos"), s => cadastros.value.produtos = s.docs.map(d=>({id:d.id,...d.data()})));
            onSnapshot(collection(db, "linhas"), s => cadastros.value.linhas = s.docs.map(d=>({id:d.id,...d.data()})));
            onSnapshot(collection(db, "usuarios"), s => {
                cadastros.value.usuarios = s.docs.map(d=>({id:d.id,...d.data()}));
                // Restaura nome completo quando "lembrar sessão" fez login automático
                if (loginData.value.user && !loginData.value.nome) {
                    const u = cadastros.value.usuarios.find(u => u.login === loginData.value.user);
                    if (u) { loginData.value.nome = u.nome || loginData.value.user; loginData.value.perfil = u.perfil || (u.admin ? 'admin' : 'inspetor'); }
                }
            });
            onSnapshot(query(collection(db, "inspecoes"), orderBy("dataHora", "desc")), s => {
                cadastros.value.inspecoes = s.docs.map(d=>({id:d.id,...d.data()}));
                nextTick(() => { if (adminTab.value === 'dashboard') updateCharts(); });
            });
            onSnapshot(query(collection(db, "dimensionais"), orderBy("dataHora", "desc")), s => {
                cadastros.value.dimensionais = s.docs.map(d=>({id:d.id,...d.data()}));
            });
        });

        watch(() => [filtrosGrafico.value.formato, filtrosGrafico.value.data, adminTab.value, tipoGrafico.value], () => { 
            if (adminTab.value === 'dashboard') nextTick(updateCharts); 
        });

        return {
            notificacoes, salvandoAuto, currentView, loginData, handleLogin, logout, loading,
            adminTab, mobileMenuOpen, navigateAdmin, cadastros, filtros, relatoriosFiltrados, limparFiltros,
            relatorioSelecionado, abrirDetalhesRelatorio, getStatusRelatorio, salvarAlteracoesAdmin, removerInspecao, baixarPrintRelatorio,
            form, mascararInput, getStatusClass, adicionarPeca, removerPeca, salvarRascunho, gerarRelatorioFinal, reportText, novaInspecaoLimpa,
            novoFormato, novoItemSimples, removerItem, atualizarFormato, atualizarItemSimples, importarProdutosCSV, exportarCSV, getExtremos,
            irParaInspecao, voltarAdmin,
            formatarData, copiarTexto, enviarZap, stats, novoUsuarioForm, cadastrarUsuario, setFiltroRapido,
            produtoSearch, produtosFiltrados, selecionarProduto, mostrandoListaProdutos, filtroAdminProdutos, produtosAdminFiltrados,
            isDarkMode, toggleDarkMode, filtrosGrafico, showStartModal, iniciarAnalise, tipoGrafico,
            // Detectores empeno
            temDadosEmpeno, temDadosEspessura, temDadosTamanhoEsquadro,
            // Empeno tabs (mantido só empeno)
            inspectorTab, espessuraMin, espessuraMax,
            calcMediaPecaEspessura, getStatusEspessura, resultadoEspessura,
            adicionarPecaEspessura, removerPecaEspessura, adicionarPontoNaPeca, removerPontoDaPeca,
            getStatusTamanho, getStatusEsquadro, adicionarMedicaoTE, removerMedicaoTE, resultadoTamanhoEsquadro,
            configAtiva,
            // ── DIMENSIONAIS ──
            formDim, configDimAtiva, showDimStartModal, salvandoDim, dimReportText, dimTab,
            currentDimId, produtoSearchDim, mostrandoListaProdutosDim, produtosFiltradosDim,
            selecionarProdutoDim, iniciarDimensionais, irParaDimensionais, voltarAdminDeDim,
            espessuraDimMin, espessuraDimMax, calcMediaPecaDim, getStatusEspessuraDim,
            adicionarPecaEspessuraDim, removerPecaEspessuraDim, adicionarPontoDim, removerPontoDim,
            resultadoEspessuraDim, temDadosEspessuraDim,
            getStatusTamanhoDim, getStatusEsquadroDim, adicionarMedicaoTEDim, removerMedicaoTEDim,
            resultadoTEDim, temDadosTEDim,
            salvarDimRascunho, concluirDimensionais, novoDimLimpo,
            dimSelecionadoModal, filtrosDimAdmin, dimensionaisFiltrados, removerDimensional,
            copiarTextoDim, enviarZapDim, baixarImagemDim, baixarPDFDim, baixarCSVDim
        };
    }
}).mount('#app');
