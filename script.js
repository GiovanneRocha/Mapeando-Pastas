/* Mapa de Pastas — Árvore Hierárquica (Tree Layout) */
(function(){
  const $ = (sel, el=document)=> el.querySelector(sel);

  // Configurações visuais
  const config = {
    nodeWidth: 180,
    nodeHeight: 40,
    levelSpacing: 220, 
    nodeSpacing: 50,   
    duration: 500      
  };

  const graph = d3.select('#graph');
  const zoomLayer = d3.select('#zoomLayer');
  const gLinks = d3.select('.links');
  const gNodes = d3.select('.nodes');

  // Estado da aplicação
  const state = {
    rootData: null,      
    handles: new Map(),  
    lastId: 0,
    selection: null
  };

  const treeLayout = d3.tree().nodeSize([config.nodeSpacing, config.levelSpacing]);

  // --- CORREÇÃO DE MOVIMENTAÇÃO (ZOOM/PAN) ---
  const zoom = d3.zoom()
    .scaleExtent([0.1, 4]) // Permite afastar bem e aproximar bem
    .on('zoom', (ev) => {
      zoomLayer.attr('transform', ev.transform);
    });

  // Aplica o zoom ao elemento SVG inteiro
  // Adiciona um retângulo transparente no fundo para garantir captura do clique
  graph.insert("rect", ":first-child")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("fill", "transparent")
    .style("pointer-events", "all"); // Garante que o fundo pegue o arraste

  graph.call(zoom).on("dblclick.zoom", null); // Desativa zoom duplo clique se quiser

  // --- FIM DA CORREÇÃO ---

  function createNode(name, type, parent = null, meta = {}) {
    state.lastId++;
    return {
      id: state.lastId,
      name: name, type: type,
      children: null, _children: null, dataChildren: [],
      parent: parent, ...meta
    };
  }

  function update(source) {
    if (!state.rootData) return;

    const root = d3.hierarchy(state.rootData, d => d.children);
    treeLayout(root);

    const nodes = root.descendants();
    const links = root.links();

    nodes.forEach(d => { d.y = d.depth * config.levelSpacing; });

    // --- NÓS ---
    const nodeSel = gNodes.selectAll('g.node').data(nodes, d => d.data.id);

    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', d => `node ${d.data.type}`)
      .attr('transform', d => `translate(${source.y0 || 0},${source.x0 || 0})`)
      .attr('opacity', 0)
      .on('click', (ev, d) => {
        ev.stopPropagation(); // Importante: Clicar no nó não deve disparar arraste imediato bugado
        onNodeClick(ev, d);
      });

    nodeEnter.append('rect')
      .attr('width', config.nodeWidth).attr('height', config.nodeHeight)
      .attr('x', 0).attr('y', -config.nodeHeight / 2);

    nodeEnter.append('circle').attr('cx', 20).attr('cy', 0).attr('r', 10);
    nodeEnter.append('path')
      .attr('transform', 'translate(12, -8) scale(0.8)')
      .attr('d', d => d.data.type === 'directory' ? 'M2 4h4l2 2h8v10H2z' : 'M4 2h8l4 4v12H4z');

    nodeEnter.append('text').attr('class', 'label')
      .attr('x', 38).attr('y', 4).text(d => truncate(d.data.name, 20));
    
    nodeEnter.append('text').attr('class', 'badge')
      .attr('x', config.nodeWidth - 10).attr('y', 12)
      .attr('text-anchor', 'end').text(d => d.data.type === 'directory' ? '' : ext(d.data.name));

    const nodeUpdate = nodeEnter.merge(nodeSel);
    nodeUpdate.transition().duration(config.duration)
      .attr('transform', d => `translate(${d.y},${d.x})`).attr('opacity', 1);
    
    nodeUpdate.classed('selected', d => d.data.id === state.selection);

    nodeSel.exit().transition().duration(config.duration)
      .attr('transform', d => `translate(${source.y},${source.x})`).attr('opacity', 0).remove();

    // --- LINKS ---
    const linkSel = gLinks.selectAll('path.link').data(links, d => d.target.data.id);
    const diagonal = d3.linkHorizontal().x(d => d.y).y(d => d.x);

    const linkEnter = linkSel.enter().append('path')
      .attr('class', 'link')
      .attr('d', d => {
        const o = { x: source.x0 || source.x, y: source.y0 || source.y };
        return diagonal({ source: o, target: o });
      });

    linkSel.merge(linkEnter).transition().duration(config.duration).attr('d', diagonal);

    linkSel.exit().transition().duration(config.duration)
      .attr('d', d => {
        const o = { x: source.x, y: source.y };
        return diagonal({ source: o, target: o });
      }).remove();

    nodes.forEach(d => { d.data.x0 = d.x; d.data.y0 = d.y; });
  }

  async function onNodeClick(event, d) {
    state.selection = d.data.id;
    updateDetails(d);
    
    if (d.data.type === 'directory') {
      if (d.children) {
        d.data._children = d.data.children;
        d.data.children = null;
      } else {
        if (d.data._children) {
          d.data.children = d.data._children;
          d.data._children = null;
        } else {
          await loadChildren(d.data);
        }
      }
      update(d);
    } else {
      update(d);
    }
  }

  async function loadChildren(nodeData) {
    let children = [];
    if (nodeData.lazyChildren) {
      children = nodeData.lazyChildren.map(c => 
        createNode(c.name, c.type, nodeData, { lazyChildren: c.children })
      );
      nodeData.lazyChildren = null;
    } else if (state.handles.has(nodeData.id)) {
      const dirHandle = state.handles.get(nodeData.id);
      try {
        for await (const [name, handle] of dirHandle.entries()) {
          if (name.startsWith('.')) continue;
          const type = handle.kind === 'directory' ? 'directory' : 'file';
          const child = createNode(name, type, nodeData);
          if (type === 'directory') state.handles.set(child.id, handle);
          children.push(child);
        }
        children.sort((a,b) => (a.type === b.type ? 0 : a.type==='directory'?-1:1) || a.name.localeCompare(b.name));
      } catch(e) { console.error(e); }
    }
    nodeData.children = children.length > 0 ? children : [];
  }

  function truncate(s, n){ return s.length>n? s.slice(0,n-1)+'…': s; }
  function ext(name){ const i=name.lastIndexOf('.'); return i>0? name.slice(i+1).toLowerCase(): ''; }

  function updateDetails(d3Node) {
    const d = d3Node.data;
    const path = getPath(d).map(n=>n.name).join('/');
    const crumbs = getPath(d).map(n => `<a href="#" onclick="return false;">${n.name}</a>`).join(' / ');
    $('#breadcrumbs').innerHTML = crumbs || 'Raiz';
    $('#details').innerHTML = `
      <div style="margin-bottom:8px"><b>${d.name}</b></div>
      <div style="font-size:12px; color:#666">
        <div>Tipo: ${d.type === 'directory' ? 'Pasta' : 'Arquivo ' + ext(d.name).toUpperCase()}</div>
        <div>Caminho: ${path}</div>
      </div>
    `;
  }

  function getPath(nodeData) {
    const path = []; let cur = nodeData;
    while(cur) { path.push(cur); cur = cur.parent; }
    return path.reverse();
  }

  function initRoot(dataObj) {
    state.lastId = 0; state.handles = new Map(); state.selection = null;
    gNodes.selectAll('*').remove(); gLinks.selectAll('*').remove();
    
    state.rootData = createNode(dataObj.name || 'Raiz', 'directory', null, { lazyChildren: dataObj.children });
    if (dataObj.handle) state.handles.set(state.rootData.id, dataObj.handle);

    onNodeClick(null, { data: state.rootData });
    
    // Centralizar inicialmente
    setTimeout(()=> $('#btnFit').click(), 100);
  }

  $('#btnPick').onclick = async () => {
    if(!window.showDirectoryPicker) return alert('Navegador não suportado.');
    try { const handle = await showDirectoryPicker(); initRoot({ name: handle.name, handle: handle }); } catch(e) {}
  };
  $('#btnImport').onclick = () => $('#fileJson').click();
  $('#fileJson').onchange = (e) => {
    const f = e.target.files[0]; if(f) { const r = new FileReader(); r.onload = () => initRoot(JSON.parse(r.result)); r.readAsText(f); }
  };
  $('#btnExport').onclick = () => {
    const serialize = (n) => ({ name: n.name, type: n.type, children: (n.children || n._children || []).map(serialize) });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(serialize(state.rootData),null,2)],{type:'application/json'}));
    a.download = 'mapa.json'; a.click();
  };
  
  // Função de Centralizar melhorada para garantir o reset da posição
  $('#btnFit').onclick = () => {
    if(!state.rootData) return;
    const {width, height} = graph.node().getBoundingClientRect();
    // Move para x=40 (margem esquerda) e centraliza verticalmente
    graph.transition().duration(750)
      .call(zoom.transform, d3.zoomIdentity.translate(40, height/2).scale(1));
  };

  $('#btnSaveSVG').onclick = () => {
    const svgData = new XMLSerializer().serializeToString(document.getElementById('graph'));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([svgData], {type:'image/svg+xml;charset=utf-8'}));
    a.download = 'mapa.svg'; a.click();
  };
  $('#txtSearch').oninput = (e) => {
    const term = e.target.value.toLowerCase();
    gNodes.selectAll('.node').classed('dimmed', d => term && !d.data.name.toLowerCase().includes(term));
  };
  window.onkeydown = (e) => { if(e.ctrlKey && e.key === 'k') { e.preventDefault(); $('#txtSearch').focus(); }};

  initRoot({
    name: 'Projeto Modelo',
    children: [
      { name: 'src', type: 'directory', children: [
          { name: 'index.js', type: 'file' },
          { name: 'styles', type: 'directory', children: [{name:'main.css', type:'file'}] }
      ]},
      { name: 'package.json', type: 'file' }
    ]
  });
})();