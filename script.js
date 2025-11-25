(function(){
  const $ = (sel, el=document)=> el.querySelector(sel);
  
  // Configuração Base
  const config = {
    nodeWidth: 180, nodeHeight: 38,
    duration: 500,
    // Configurações por layout
    horizontal: { nodeSep: 50, levelSep: 220 },
    vertical:   { nodeSep: 50, levelSep: 100 },
    radial:     { nodeSep: 0,  levelSep: 0 } // Radial calcula dinâmico
  };

  const graph = d3.select('#graph');
  const zoomLayer = d3.select('#zoomLayer');
  const gLinks = d3.select('.links');
  const gNodes = d3.select('.nodes');
  const tooltip = $('#tooltip');

  const state = {
    rootData: null, handles: new Map(), lastId: 0, selection: null, 
    searchHighlight: null, dupeHighlights: [],
    transform: { x:0, y:0, k:1 }, contextNode: null,
    layoutMode: 'horizontal' // horizontal, vertical, radial
  };

  // Ícones e Cores
  const fileTypeConfig = {
    'xlsx': { icon: 'table_view', color: '#10b981' },
    'xls':  { icon: 'table_view', color: '#10b981' },
    'csv':  { icon: 'table_rows', color: '#059669' },
    'pdf':  { icon: 'picture_as_pdf', color: '#ef4444' },
    'doc':  { icon: 'description',    color: '#3b82f6' },
    'docx': { icon: 'description',    color: '#3b82f6' },
    'txt':  { icon: 'article',        color: '#94a3b8' },
    'ppt':  { icon: 'slideshow', color: '#f97316' },
    'pptx': { icon: 'slideshow', color: '#f97316' },
    'js':   { icon: 'javascript',     color: '#f59e0b' },
    'html': { icon: 'html',           color: '#ea580c' },
    'css':  { icon: 'css',            color: '#0ea5e9' },
    'json': { icon: 'data_object',    color: '#64748b' },
    'py':   { icon: 'terminal',       color: '#3b82f6' },
    'png':  { icon: 'image',          color: '#8b5cf6' },
    'jpg':  { icon: 'image',          color: '#8b5cf6' },
    'jpeg': { icon: 'image',          color: '#8b5cf6' },
    'mp4':  { icon: 'movie',          color: '#ec4899' },
    'mp3':  { icon: 'audio_file',     color: '#14b8a6' },
    'zip':  { icon: 'folder_zip',     color: '#78350f' },
    'rar':  { icon: 'folder_zip',     color: '#78350f' },
    'exe':  { icon: 'wysiwyg',        color: '#64748b' },
    'default': { icon: 'draft',       color: '#94a3b8' },
    'folder':  { icon: 'folder',      color: '#f59e0b' },
    'folder_open': { icon: 'folder_open', color: '#f59e0b' }
  };

  // --- ZOOM ON SCROLL ---
  // D3 faz isso nativamente, apenas configuramos a escala
  const zoom = d3.zoom().scaleExtent([0.1, 5]).on('zoom', (ev) => {
    state.transform = ev.transform;
    zoomLayer.attr('transform', ev.transform);
  });
  
  graph.insert("rect", ":first-child").attr("width","100%").attr("height","100%")
    .attr("fill","transparent").style("pointer-events","all")
    .on('contextmenu', e => e.preventDefault());
  
  graph.call(zoom).on("dblclick.zoom", null);

  // --- LAYOUT LOGIC ---
  function getTreeLayout() {
    const mode = state.layoutMode;
    if (mode === 'radial') {
      // Radial precisa de separação angular
      return d3.tree()
        .size([2 * Math.PI, 1000]) // Angulo (radianos), Raio (arbitrário, ajustaremos na projeção)
        .separation((a, b) => (a.parent == b.parent ? 1 : 2) / a.depth);
    }
    const sets = config[mode];
    return d3.tree().nodeSize([sets.nodeSep, sets.levelSep]);
  }

  // Projeta coordenadas (x,y) do Tree Layout para a tela baseado no modo
  function project(d) {
    if (state.layoutMode === 'horizontal') return [d.y, d.x];
    if (state.layoutMode === 'vertical') return [d.x, d.y];
    if (state.layoutMode === 'radial') {
       // Converte polar para cartesiano
       // d.x = angulo, d.y = raio (depth * distancia)
       const angle = d.x - Math.PI / 2; // Gira -90 graus para começar em cima
       const radius = d.depth * 250; // Raio fixo por nível
       return [radius * Math.cos(angle), radius * Math.sin(angle)];
    }
    return [d.y, d.x];
  }

  // --- CORE LOGIC ---
  function createNode(name, type, parent = null, meta = {}) {
    state.lastId++;
    return {
      id: state.lastId, name, type,
      children: null, _children: null, parent,
      size: null, lastModified: null, // Novos campos de metadados
      ...meta
    };
  }

  function update(source) {
    if (!state.rootData) return;
    
    const treeLayout = getTreeLayout();
    const root = d3.hierarchy(state.rootData, d => d.children);
    treeLayout(root);
    
    const nodes = root.descendants();
    const links = root.links();

    // RENDER NÓS
    const nodeSel = gNodes.selectAll('g.node').data(nodes, d => d.data.id);
    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', d => `node ${d.data.type}`)
      .attr('opacity', 0)
      .on('click', (ev, d) => { ev.stopPropagation(); onNodeClick(ev, d); })
      .on('contextmenu', (ev, d) => onContextMenu(ev, d))
      // --- TOOLTIP EVENTS ---
      .on('mouseenter', (ev, d) => showTooltip(ev, d))
      .on('mousemove', (ev) => moveTooltip(ev))
      .on('mouseleave', () => hideTooltip());

    nodeEnter.append('rect')
      .attr('width', config.nodeWidth).attr('height', config.nodeHeight)
      .attr('x', 0).attr('y', -config.nodeHeight/2);

    nodeEnter.append('text').attr('class', 'icon')
      .attr('x', 20).attr('y', 8).attr('text-anchor','middle')
      .text(d => getIconData(d.data).icon)
      .style('fill', d => getIconData(d.data).color);

    nodeEnter.append('text').attr('class', 'label')
      .attr('x', 36).attr('y', 5)
      .text(d => truncate(d.data.name, 18));

    const nodeUpdate = nodeEnter.merge(nodeSel);
    
    // Animação de posição usando a função Project
    nodeUpdate.transition().duration(config.duration)
      .attr('transform', d => {
         const p = project(d);
         // Se for Radial, rotacionar o texto pode ser necessário (simplificado aqui para não virar de cabeça pra baixo)
         return `translate(${p[0]},${p[1]})`;
      })
      .attr('opacity', 1);
    
    nodeUpdate.classed('selected', d => d.data.id === state.selection);
    nodeUpdate.classed('highlight', d => d.data.id === state.searchHighlight);
    nodeUpdate.classed('dupe-highlight', d => state.dupeHighlights.includes(d.data.id));

    nodeUpdate.select('text.icon')
      .text(d => getIconData(d.data).icon)
      .style('fill', d => getIconData(d.data).color);

    // Ajuste de "Entrada" e "Saída" para animação suave
    const sourcePos = source.x0 !== undefined ? (state.layoutMode === 'horizontal' ? [source.y0, source.x0] : [source.x0, source.y0]) : [0,0];
    
    nodeSel.exit().transition().duration(config.duration)
      .attr('opacity', 0).remove(); // Remove simples para evitar bug visual na troca de layout

    // RENDER LINKS
    const linkSel = gLinks.selectAll('path.link').data(links, d => d.target.data.id);
    
    const linkEnter = linkSel.enter().append('path').attr('class', 'link')
      .attr('d', d => {
        // Link começa na posição do source
        return generateLink({source: source, target: source}); 
      });

    linkSel.merge(linkEnter).transition().duration(config.duration)
      .attr('d', d => generateLink(d));

    linkSel.exit().transition().duration(config.duration).attr('opacity',0).remove();

    nodes.forEach(d => { d.data.x0 = d.x; d.data.y0 = d.y; });
  }

  // Gerador de links dinâmico baseado no layout
  function generateLink(d) {
    const s = project(d.source);
    const t = project(d.target);
    
    if (state.layoutMode === 'horizontal') {
      return d3.linkHorizontal()({source: [s[0]+config.nodeWidth, s[1]], target: t});
    }
    if (state.layoutMode === 'vertical') {
      return d3.linkVertical()({source: [s[0], s[1]+config.nodeHeight/2], target: t});
    }
    if (state.layoutMode === 'radial') {
      // Linha simples para radial
      return `M ${s[0]} ${s[1]} L ${t[0]} ${t[1]}`;
    }
  }
  
  function getIconData(data) {
    if (data.type === 'directory') {
       const isOpen = data.children && data.children.length > 0;
       return isOpen ? fileTypeConfig['folder_open'] : fileTypeConfig['folder'];
    }
    const extension = ext(data.name);
    return fileTypeConfig[extension] || fileTypeConfig['default'];
  }

  // --- TOOLTIPS COM METADADOS ---
  function showTooltip(ev, d) {
    const data = d.data;
    let metaHTML = '';
    
    if (data.size) metaHTML += `<div><span>Tamanho:</span> ${formatSize(data.size)}</div>`;
    if (data.lastModified) {
        const date = new Date(data.lastModified);
        metaHTML += `<div><span>Modificado:</span> ${date.toLocaleDateString()}</div>`;
    }
    if (!data.size && !data.lastModified) metaHTML = '<div>Sem metadados extras</div>';

    tooltip.innerHTML = `
      <div style="font-weight:bold;margin-bottom:4px;border-bottom:1px solid #334155;padding-bottom:2px">
        ${data.name}
      </div>
      ${metaHTML}
    `;
    tooltip.classList.add('show');
    moveTooltip(ev);
  }

  function moveTooltip(ev) {
    const w = tooltip.offsetWidth;
    const h = tooltip.offsetHeight;
    // Evita sair da tela
    let left = ev.pageX + 15;
    let top = ev.pageY + 15;
    if (left + w > window.innerWidth) left = ev.pageX - w - 10;
    if (top + h > window.innerHeight) top = ev.pageY - h - 10;
    
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  function hideTooltip() { tooltip.classList.remove('show'); }
  
  function formatSize(bytes) {
    if(bytes === 0) return '0 B';
    const k = 1024, dm = 2, sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // --- CONTROLE DE LAYOUT ---
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.layoutMode = btn.dataset.mode;
      update(state.rootData); // Re-renderiza com nova projeção
      setTimeout(()=> $('#btnFit').click(), 600); // Centraliza
    };
  });

  // --- BUSCA, DUPLICADOS, IMPORT/EXPORT (Mesma lógica) ---
  $('#txtSearch').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    const list = $('#searchResults');
    if (!term || !state.rootData) {
      list.classList.remove('active'); state.searchHighlight = null; state.dupeHighlights = [];
      update(state.rootData); return;
    }
    const results = [];
    traverseSearch(state.rootData, term, [], results);
    list.innerHTML = '';
    results.slice(0, 50).forEach(res => { 
        const iconData = getIconData(res.node);
        const item = document.createElement('div');
        item.className = 'search-item';
        item.innerHTML = `<div class="search-item-name"><span class="material-symbols-rounded" style="color:${iconData.color}">${iconData.icon}</span>${res.node.name}</div><div class="search-item-path">${res.path.map(p=>p.name).join('/')}</div>`;
        item.onclick = () => { state.searchHighlight = res.node.id; state.dupeHighlights=[]; revealMultipleNodes([res.node]); list.classList.remove('active'); };
        list.appendChild(item);
    });
    list.classList.add('active');
  });

  $('#btnDupe').onclick = () => {
      const map = new Map();
      function scan(node) {
          if(node.type === 'file') {
             const list = map.get(node.name) || []; list.push(node); map.set(node.name, list);
          }
          (node.children||node._children||node.lazyChildren||[]).forEach(scan);
      }
      scan(state.rootData);
      const dupes = Array.from(map.entries()).filter(x => x[1].length > 1).sort((a,b)=>b[1].length-a[1].length);
      if(!dupes.length) return showToast("Sem duplicados.");
      
      const listContainer = $('#dupeList'); listContainer.innerHTML='';
      dupes.forEach(([name, list]) => {
          const div = document.createElement('div'); div.className='dupe-item';
          div.innerHTML = `<span class="dupe-name">${name}</span><span class="dupe-count">${list.length}</span>`;
          div.onclick = () => { $('#dialogOverlay').classList.remove('open'); state.dupeHighlights = list.map(n=>n.id); revealMultipleNodes(list); };
          listContainer.appendChild(div);
      });
      $('#dialogOverlay').classList.add('open');
  };
  $('#btnCloseDialog').onclick = () => $('#dialogOverlay').classList.remove('open');

  // --- LEITURA REAL DE ARQUIVOS COM METADADOS ---
  async function loadChildren(nodeData) {
    let children = [];
    if (nodeData.lazyChildren) {
      children = nodeData.lazyChildren.map(c => createNode(c.name, c.type, nodeData, {lazyChildren:c.children, size:c.size, lastModified:c.lastModified}));
      nodeData.lazyChildren = null;
    } else if (state.handles.has(nodeData.id)) {
      const dirHandle = state.handles.get(nodeData.id);
      try {
        for await (const [name, handle] of dirHandle.entries()) {
          if (name.startsWith('.')) continue;
          const type = handle.kind === 'directory' ? 'directory' : 'file';
          
          let meta = {};
          // Se for arquivo, tentamos pegar metadados
          // NOTA: GetFile() pode ser lento em pastas gigantes, mas é necessário para o tooltip
          if (type === 'file') {
             try {
               const file = await handle.getFile();
               meta.size = file.size;
               meta.lastModified = file.lastModified;
             } catch(err) { console.warn("Erro ao ler meta", name); }
          }
          
          const child = createNode(name, type, nodeData, meta);
          if (type==='directory') state.handles.set(child.id, handle);
          children.push(child);
        }
        children.sort((a,b)=>(a.type===b.type?0:a.type==='directory'?-1:1)||a.name.localeCompare(b.name));
      } catch(e){}
    }
    nodeData.children = children.length? children : [];
  }

  // --- IMPORT/EXPORT EXCEL ATUALIZADO PARA METADADOS ---
  function exportToExcel() {
    if(!state.rootData) return;
    const rows = [];
    function traverse(node, currentPath) {
      const fullPath = currentPath ? `${currentPath}/${node.name}` : node.name;
      rows.push({ 
          "Caminho": fullPath, "Tipo": node.type, 
          "Tamanho (Bytes)": node.size || "", 
          "Modificado": node.lastModified ? new Date(node.lastModified).toISOString() : "" 
      });
      (node.children||node._children||node.lazyChildren||[]).forEach(k => traverse(k, fullPath));
    }
    traverse(state.rootData, "");
    XLSX.writeFile(XLSX.utils.book_new(XLSX.utils.json_to_sheet(rows)), "mapa_completo.xlsx");
    showToast("Baixado!");
  }

  function importFromExcel(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = XLSX.utils.sheet_to_json(XLSX.read(new Uint8Array(e.target.result), {type:'array'}).Sheets[XLSX.read(new Uint8Array(e.target.result), {type:'array'}).SheetNames[0]]);
        const root = { name: "Raiz Importada", type: 'directory', children: [] };
        const map = { "": root }; 
        json.forEach(row => {
          let path = (row['Caminho']||row['Path']).replace(/\\/g, '/');
          const type = row['Tipo']||'file';
          const size = row['Tamanho (Bytes)'] || row['Size'];
          const mod = row['Modificado'] || row['Date'];
          
          let curPath = "", parent = root;
          path.split('/').forEach((part, i, arr) => {
            curPath = curPath ? `${curPath}/${part}` : part;
            if (!map[curPath]) {
              const newNode = createNode(part, i===arr.length-1?type:'directory', parent, {
                  size: (i===arr.length-1 ? size : null),
                  lastModified: (i===arr.length-1 ? mod : null)
              });
              parent.children = (parent.children||[]); parent.children.push(newNode);
              map[curPath] = newNode;
            }
            parent = map[curPath];
          });
        });
        initRoot(root.children[0] || root);
      } catch(e) { alert("Erro na importação."); }
    };
    reader.readAsArrayBuffer(file);
  }

  // --- HELPER FUNCTIONS ---
  async function revealMultipleNodes(targets) {
      for (const t of targets) {
          let c=t, p=[]; while(c){p.push(c); c=c.parent;} p.reverse();
          for(const n of p) { if(n._children){n.children=n._children;n._children=null;} if(n.lazyChildren&&!n.children) await loadChildren(n); }
      }
      update(state.rootData);
      setTimeout(()=> {
         // Lógica de Zoom simplificada para focar no primeiro item ou resetar
         // Se quiser focar exatamente, usa bounding box. Aqui vamos dar um reset no Fit para garantir que tudo apareça
         // Mas se preferir zoom:
         const t = targets[0];
         if(t) {
            const pos = project(t);
            // Centraliza no primeiro da lista
            graph.transition().duration(1000).call(zoom.transform, d3.zoomIdentity.translate($('#graph').clientWidth/2 - pos[0], $('#graph').clientHeight/2 - pos[1]).scale(1.2));
         }
      }, 600);
  }
  
  function traverseSearch(node, term, stack, res) {
      if(node.name.toLowerCase().includes(term)) res.push({node, path:[...stack]});
      (node.children||node._children||node.lazyChildren||[]).forEach(k=>{stack.push(node); traverseSearch(k, term, stack, res); stack.pop();});
  }
  
  async function onNodeClick(ev, d) {
    state.selection = d.data.id; updateSidebar(d.data);
    if(d.data.type==='directory'){
       if(d.children){d.data._children=d.data.children;d.data.children=null;}
       else{if(d.data._children){d.data.children=d.data._children;d.data._children=null;}else await loadChildren(d.data);}
       update(d);
    } else update(d);
  }

  function updateSidebar(data) {
    const p = getPath(data).map(n=>n.name).join('/');
    $('#details').innerHTML = `<div class="detail-item"><span class="detail-label">Nome</span><span class="detail-value"><b>${data.name}</b></span></div><div class="detail-item"><span class="detail-label">Tamanho</span><span class="detail-value">${formatSize(data.size||0)}</span></div><div class="detail-item"><span class="detail-label">Caminho</span><div class="path-box" id="pathBox">${p}</div></div>`;
    $('#pathBox').onclick=()=>navigator.clipboard.writeText(p);
    $('#breadcrumbs').innerHTML = getPath(data).map((n,i,arr)=>i===arr.length-1?`<span>${n.name}</span>`:`<a href="#">${n.name}</a>`).join('/');
  }

  function showToast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2000);}
  function onContextMenu(e,d){e.preventDefault();state.contextNode=d;const m=$('#contextMenu');m.style.left=e.pageX+'px';m.style.top=e.pageY+'px';m.style.display='block';}
  document.addEventListener('click',()=>{$('#contextMenu').style.display='none'; if(!event.target.closest('.search-wrap')) $('#searchResults').classList.remove('active');});
  function getPath(n){const p=[];let c=n;while(c){p.push(c);c=c.parent;}return p.reverse();}
  function ext(n){const i=n.lastIndexOf('.');return i>0?n.slice(i+1).toLowerCase():'';}
  function truncate(s,n){return s.length>n?s.slice(0,n-1)+'…':s;}

  // Events
  $('#btnExport').onclick=exportToExcel; $('#btnImport').onclick=()=>$('#fileInput').click(); $('#fileInput').onchange=(e)=>importFromExcel(e.target.files[0]);
  $('#ctxExpand').onclick=async()=>{await loadChildren(state.contextNode.data);update(state.contextNode);};
  $('#ctxCollapse').onclick=()=>{state.contextNode.data._children=state.contextNode.data.children;state.contextNode.data.children=null;update(state.contextNode);};
  $('#ctxCopy').onclick=()=>navigator.clipboard.writeText(getPath(state.contextNode.data).map(n=>n.name).join('/'));
  $('#btnFit').onclick=()=>{if(state.rootData) graph.transition().duration(750).call(zoom.transform, d3.zoomIdentity.translate(40,$('#graph').clientHeight/2).scale(1));};
  $('#btnPick').onclick=async()=>{try{const h=await showDirectoryPicker();initRoot({name:h.name,handle:h});}catch(e){}};
  window.onkeydown=(e)=>{if(e.ctrlKey&&e.key==='k'){e.preventDefault();$('#txtSearch').focus();}};

  function initRoot(data){
      state.lastId=0;state.handles=new Map();state.selection=null;
      gNodes.selectAll('*').remove();gLinks.selectAll('*').remove();
      state.rootData=createNode(data.name,'directory',null,{lazyChildren:data.children, size:data.size, lastModified:data.lastModified});
      if(data.handle)state.handles.set(state.rootData.id,data.handle);
      update({x0:0,y0:0}); $('#btnFit').click();
  }
  
  // Demo
  initRoot({name:'Layout Demo',children:[
     {name:'Docs',type:'directory',children:[{name:'Relatorio.pdf',size:102400,lastModified: Date.now()}]},
     {name:'Fotos',type:'directory',children:[{name:'ferias.jpg',size:2048000},{name:'perfil.png',size:512000}]},
     {name:'Duplicado.txt',type:'file',size:10}, {name:'Backup',type:'directory',children:[{name:'Duplicado.txt',type:'file',size:10}]}
  ]});
})();