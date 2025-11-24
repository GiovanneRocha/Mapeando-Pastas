(function(){
  const $ = (sel, el=document)=> el.querySelector(sel);
  
  const config = {
    nodeWidth: 180, nodeHeight: 38,
    levelSpacing: 220, nodeSpacing: 50,
    duration: 500, lineStyle: 'curve' 
  };

  const graph = d3.select('#graph');
  const zoomLayer = d3.select('#zoomLayer');
  const gLinks = d3.select('.links');
  const gNodes = d3.select('.nodes');
  const treeLayout = d3.tree().nodeSize([config.nodeSpacing, config.levelSpacing]);

  const state = {
    rootData: null, handles: new Map(), lastId: 0, selection: null,
    transform: { x:0, y:0, k:1 }, contextNode: null
  };

  const iconMap = {
    'xlsx': 'table_view', 'xls': 'table_view', 'csv': 'table_rows',
    'js': 'javascript', 'html': 'html', 'css': 'css',
    'json': 'data_object', 'py': 'terminal', 'png': 'image', 'jpg': 'image', 
    'pdf': 'picture_as_pdf', 'zip': 'folder_zip', 'default': 'draft'
  };

  // --- ZOOM ---
  const zoom = d3.zoom().scaleExtent([0.1, 3]).on('zoom', (ev) => {
    state.transform = ev.transform;
    zoomLayer.attr('transform', ev.transform);
    updateMinimap();
  });
  
  graph.insert("rect", ":first-child").attr("width","100%").attr("height","100%")
    .attr("fill","transparent").style("pointer-events","all")
    .on('contextmenu', e => e.preventDefault());
  
  graph.call(zoom).on("dblclick.zoom", null);

  // --- CORE LOGIC ---
  function createNode(name, type, parent = null, meta = {}) {
    state.lastId++;
    return {
      id: state.lastId, name, type,
      children: null, _children: null, parent, ...meta
    };
  }

  function update(source) {
    if (!state.rootData) return;
    const root = d3.hierarchy(state.rootData, d => d.children);
    treeLayout(root);
    
    const nodes = root.descendants();
    nodes.forEach(d => { d.y = d.depth * config.levelSpacing; });
    const links = root.links();

    // RENDER NÓS
    const nodeSel = gNodes.selectAll('g.node').data(nodes, d => d.data.id);
    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', d => `node ${d.data.type}`)
      .attr('transform', d => `translate(${source.y0||0},${source.x0||0})`)
      .attr('opacity', 0)
      .on('click', (ev, d) => { ev.stopPropagation(); onNodeClick(ev, d); })
      .on('contextmenu', (ev, d) => onContextMenu(ev, d));

    nodeEnter.append('rect')
      .attr('width', config.nodeWidth).attr('height', config.nodeHeight)
      .attr('x', 0).attr('y', -config.nodeHeight/2);

    nodeEnter.append('text').attr('class', 'icon')
      .attr('x', 20).attr('y', 8).attr('text-anchor','middle')
      .text(d => getIconName(d.data));

    nodeEnter.append('text').attr('class', 'label')
      .attr('x', 36).attr('y', 5)
      .text(d => truncate(d.data.name, 18));

    const nodeUpdate = nodeEnter.merge(nodeSel);
    nodeUpdate.transition().duration(config.duration)
      .attr('transform', d => `translate(${d.y},${d.x})`).attr('opacity', 1);
    
    nodeUpdate.classed('selected', d => d.data.id === state.selection);
    nodeUpdate.select('text.icon').text(d => getIconName(d.data));

    nodeSel.exit().transition().duration(config.duration)
      .attr('transform', d => `translate(${source.y},${source.x})`).attr('opacity', 0).remove();

    // RENDER LINKS
    const linkSel = gLinks.selectAll('path.link').data(links, d => d.target.data.id);
    const pathFn = config.lineStyle === 'curve' ? linkCurved : linkElbow;
    
    const linkEnter = linkSel.enter().append('path').attr('class', 'link')
      .attr('d', d => {
        const o = {x: source.x0||source.x, y: source.y0||source.y};
        return pathFn({source:o, target:o});
      });

    linkSel.merge(linkEnter).transition().duration(config.duration).attr('d', pathFn);
    linkSel.exit().transition().duration(config.duration)
      .attr('d', d => {
         const o = {x: source.x, y: source.y};
         return pathFn({source:o, target:o});
      }).remove();

    nodes.forEach(d => { d.data.x0 = d.x; d.data.y0 = d.y; });
    setTimeout(updateMinimap, config.duration + 50);
  }

  function linkCurved(d) { return d3.linkHorizontal().x(d=>d.y).y(d=>d.x)(d); }
  function linkElbow(d) {
    const s = d.source, t = d.target; const midY = (s.y + t.y)/2;
    return `M ${s.y} ${s.x} H ${midY} V ${t.x} H ${t.y}`;
  }
  
  function getIconName(data) {
    if (data.type === 'directory') return (data.children && data.children.length > 0) ? 'folder_open' : 'folder';
    return iconMap[ext(data.name)] || iconMap['default'];
  }

  // --- 4. EXCEL EXPORT ---
  function exportToExcel() {
    if(!state.rootData) return;
    
    const rows = [];
    // Função recursiva para "achatar" a árvore em lista de caminhos
    function traverse(node, currentPath) {
      const fullPath = currentPath ? `${currentPath}/${node.name}` : node.name;
      rows.push({
        "Caminho": fullPath,
        "Tipo": node.type
      });
      // Verifica filhos carregados ou escondidos
      const kids = node.children || node._children || node.lazyChildren || [];
      kids.forEach(k => traverse(k, fullPath));
    }

    traverse(state.rootData, "");

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Mapa");
    
    // Nome do arquivo
    const fileName = (state.rootData.name || "mapa") + ".xlsx";
    XLSX.writeFile(workbook, fileName);
    showToast("Planilha baixada!");
  }

  // --- 5. EXCEL IMPORT ---
  function importFromExcel(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet);

        if(!json.length) throw new Error("Planilha vazia");
        
        // Algoritmo: Reconstruir árvore a partir de caminhos
        const rootName = "Raiz Importada";
        const root = { name: rootName, type: 'directory', children: [] };
        
        // Mapa temporário para encontrar pais
        const map = { "": root }; 

        json.forEach(row => {
          let path = row['Caminho'] || row['caminho'] || row['Path'];
          const type = row['Tipo'] || row['tipo'] || row['Type'] || 'file';
          
          if(!path) return;
          // Normaliza barras
          path = path.replace(/\\/g, '/');
          const parts = path.split('/');
          
          let currentPath = "";
          let parent = root;

          parts.forEach((part, index) => {
            // Constrói caminho acumulativo para usar como chave
            const isLast = index === parts.length - 1;
            const parentPath = currentPath;
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            // Se ainda não existe esse nó no mapa
            if (!map[currentPath]) {
              const newNode = {
                name: part,
                type: isLast ? type : 'directory', // Se é meio do caminho, é pasta
                children: []
              };
              // Adiciona ao pai
              parent.children = parent.children || [];
              parent.children.push(newNode);
              // Registra no mapa
              map[currentPath] = newNode;
            }
            parent = map[currentPath];
          });
        });

        // Se a raiz importada tiver só 1 filho que parece ser a raiz real, usa ele
        let finalRoot = root;
        if(root.children.length === 1) {
            finalRoot = root.children[0];
        }

        initRoot(finalRoot);
        showToast("Excel importado com sucesso!");

      } catch(err) {
        console.error(err);
        alert("Erro ao ler Excel. Verifique se há colunas 'Caminho' e 'Tipo'.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // --- INTERAÇÃO E DETALHES ---
  async function onNodeClick(ev, d) {
    hideContextMenu();
    state.selection = d.data.id;
    updateSidebar(d.data);

    if (d.data.type === 'directory') {
      if (d.children) {
        d.data._children = d.data.children; d.data.children = null;
      } else {
        if (d.data._children) { d.data.children = d.data._children; d.data._children = null; }
        else { await loadChildren(d.data); }
      }
      update(d);
    } else {
      update(d);
    }
  }

  function updateSidebar(data) {
    const pathArr = getPath(data);
    const fullPathStr = pathArr.map(n => n.name).join('/');
    
    $('#details').innerHTML = `
      <div class="detail-item">
        <span class="detail-label">Nome</span>
        <span class="detail-value"><b>${data.name}</b></span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Tipo</span>
        <span class="detail-value">${data.type === 'directory' ? 'Pasta' : 'Arquivo ' + ext(data.name).toUpperCase()}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Caminho</span>
        <div class="path-box" id="pathBox" title="Clique para copiar">${fullPathStr}</div>
      </div>
    `;
    $('#pathBox').onclick = () => {
      navigator.clipboard.writeText(fullPathStr).then(() => showToast("Caminho copiado!"));
    };

    const bcHTML = pathArr.map((n, i) => {
      const isLast = i === pathArr.length - 1;
      return isLast ? `<span>${n.name}</span>` : `<a href="#">${n.name}</a>`;
    }).join(' <span style="color:#cbd5e1">/</span> ');
    $('#breadcrumbs').innerHTML = bcHTML;
  }

  async function loadChildren(nodeData) {
    let children = [];
    if (nodeData.lazyChildren) {
      children = nodeData.lazyChildren.map(c => createNode(c.name, c.type, nodeData, {lazyChildren:c.children}));
      nodeData.lazyChildren = null;
    } else if (state.handles.has(nodeData.id)) {
      const dirHandle = state.handles.get(nodeData.id);
      try {
        for await (const [name, handle] of dirHandle.entries()) {
          if (name.startsWith('.')) continue;
          const type = handle.kind === 'directory' ? 'directory' : 'file';
          const child = createNode(name, type, nodeData);
          if (type==='directory') state.handles.set(child.id, handle);
          children.push(child);
        }
        children.sort((a,b)=>(a.type===b.type?0:a.type==='directory'?-1:1)||a.name.localeCompare(b.name));
      } catch(e){}
    }
    nodeData.children = children.length? children : [];
  }

  function updateMinimap() {
    const miniSvg = d3.select('#miniSvg');
    const root = d3.hierarchy(state.rootData, d=>d.children);
    treeLayout(root);
    const nodes = root.descendants();
    if(nodes.length === 0) return;

    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    nodes.forEach(d => {
      if(d.y < minX) minX = d.y; if(d.y > maxX) maxX = d.y;
      if(d.x < minY) minY = d.x; if(d.x > maxY) maxY = d.x;
    });
    const w = maxX - minX + 200; const h = maxY - minY + 100;
    const scale = Math.min(160/w, 100/h);
    const offsetX = (-minX * scale) + 10;
    const offsetY = (-minY * scale) + (100 - h*scale)/2;

    const dots = miniSvg.selectAll('circle').data(nodes, d=>d.data.id);
    dots.enter().append('circle').attr('r', 2).attr('fill','#94a3b8')
      .merge(dots)
      .attr('cx', d => d.y * scale + offsetX)
      .attr('cy', d => d.x * scale + offsetY);
    dots.exit().remove();

    const view = $('#miniViewport');
    const t = state.transform;
    const visW = $('#graph').clientWidth / t.k; 
    const visH = $('#graph').clientHeight / t.k;
    
    view.style.width = (visW * scale) + 'px';
    view.style.height = (visH * scale) + 'px';
    view.style.left = (((-t.x/t.k) - minX) * scale + 10) + 'px';
    view.style.top = (((-t.y/t.k) - minY) * scale + offsetY) + 'px';
  }

  function showToast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
  }

  // --- HELPERS ---
  function onContextMenu(e, d) {
    e.preventDefault(); state.contextNode = d;
    const m = $('#contextMenu');
    m.style.left = e.pageX + 'px'; m.style.top = e.pageY + 'px'; m.style.display = 'block';
  }
  function hideContextMenu(){ $('#contextMenu').style.display='none'; }
  document.addEventListener('click', hideContextMenu);
  
  function getPath(nodeData) { const p=[]; let c=nodeData; while(c){p.push(c); c=c.parent;} return p.reverse(); }
  function ext(n){ const i=n.lastIndexOf('.'); return i>0?n.slice(i+1).toLowerCase():''; }
  function truncate(s, n){ return s.length>n? s.slice(0,n-1)+'…': s; }

  // --- CONTROLES ---
  $('#btnExport').onclick = exportToExcel;
  $('#btnImport').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => { if(e.target.files[0]) importFromExcel(e.target.files[0]); };

  $('#ctxExpand').onclick = async () => { if(state.contextNode) { await loadChildren(state.contextNode.data); update(state.contextNode); }};
  $('#ctxCollapse').onclick = () => { if(state.contextNode && state.contextNode.data.children) { state.contextNode.data._children = state.contextNode.data.children; state.contextNode.data.children = null; update(state.contextNode); }};
  $('#ctxCopy').onclick = () => {
    const p = getPath(state.contextNode.data).map(n=>n.name).join('/');
    navigator.clipboard.writeText(p).then(()=>showToast("Caminho copiado!"));
  };
  
  $('#btnToggleLines').onclick = () => {
    config.lineStyle = config.lineStyle === 'curve' ? 'elbow' : 'curve';
    $('#lblLines').textContent = config.lineStyle === 'curve' ? 'Curvas' : 'Retas';
    update({x0:0, y0:0});
  };
  $('#btnFit').onclick = () => {
    if(!state.rootData) return;
    const h = $('#graph').clientHeight;
    graph.transition().duration(750).call(zoom.transform, d3.zoomIdentity.translate(40, h/2).scale(1));
  };
  $('#btnPick').onclick = async () => {
    try { const h = await showDirectoryPicker(); initRoot({name:h.name, handle:h}); } catch(e){}
  };
  $('#txtSearch').oninput = (e) => {
    const v = e.target.value.toLowerCase();
    gNodes.selectAll('.node').classed('dimmed', d => v && !d.data.name.toLowerCase().includes(v));
  };
  window.onkeydown = (e) => { if(e.ctrlKey && e.key === 'k') { e.preventDefault(); $('#txtSearch').focus(); }};

  function initRoot(data) {
    state.lastId=0; state.handles=new Map(); state.selection=null;
    gNodes.selectAll('*').remove(); gLinks.selectAll('*').remove();
    state.rootData = createNode(data.name, 'directory', null, {lazyChildren:data.children});
    if(data.handle) state.handles.set(state.rootData.id, data.handle);
    update({x0:0, y0:0});
    $('#btnFit').click();
  }
  
  // Demo Inicial
  initRoot({
    name: 'Projeto Excel',
    children: [
      { name: 'dados', type:'directory', children: [
        {name:'vendas.xlsx', type:'file'}, {name:'clientes.csv', type:'file'}
      ]},
      { name: 'relatorios', type:'directory', children: [{name:'anual.pdf', type:'file'}]},
      { name: 'lista_importacao.xlsx', type:'file'}
    ]
  });
})();