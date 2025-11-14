/* Mapa de Pastas — Fluxo Interativo */
(function(){
  const $ = (sel, el=document)=> el.querySelector(sel);
  const $$ = (sel, el=document)=> el.querySelectorAll(sel);

  const graph = d3.select('#graph');
  const zoomLayer = d3.select('#zoomLayer');
  const gLinks = d3.select('.links');
  const gNodes = d3.select('.nodes');

  const state = {
    nodes: [],
    links: [],
    byId: new Map(),
    id: 0,
    selection: null,
    handles: new Map(), // id -> FileSystemHandle (não serializa)
    rootId: null
  };

  const sim = d3.forceSimulation()
    .force('link', d3.forceLink().id(d=>d.id).distance(80).strength(0.6))
    .force('charge', d3.forceManyBody().strength(-260))
    .force('center', d3.forceCenter())
    .force('collide', d3.forceCollide().radius(d=>d.r||34).iterations(2));

  const zoom = d3.zoom().scaleExtent([0.2, 2.5]).on('zoom', (ev)=>{
    zoomLayer.attr('transform', ev.transform);
  });
  graph.call(zoom);

  function newId(){ state.id+=1; return state.id; }

  function makeNode({name, type, parentId=null, meta={}}){
    const n = {
      id: newId(),
      name, type, parentId,
      expanded: false,
      fx: undefined, fy: undefined,
      x: (Math.random()*200-100), y: (Math.random()*200-100),
      r: type==='directory'? 42: 34,
      ...meta
    };
    state.nodes.push(n);
    state.byId.set(n.id, n);
    if(parentId){ state.links.push({source: parentId, target: n.id}); }
    return n;
  }

  function setRoot(node){ state.rootId = node.id; }

  function childrenOf(id){ return state.nodes.filter(n=>n.parentId===id); }

  function pathToRoot(id){
    const p=[]; let cur = state.byId.get(id);
    while(cur){ p.push(cur); cur = cur.parentId? state.byId.get(cur.parentId): null; }
    return p.reverse();
  }

  function render(){
    // LINKS
    const linkSel = gLinks.selectAll('path.link').data(state.links, d=>d.source.id+"->"+d.target.id);
    linkSel.exit().remove();
    linkSel.enter().append('path').attr('class','link');

    // NODES
    const nodeSel = gNodes.selectAll('g.node').data(state.nodes, d=>d.id);
    nodeSel.exit().remove();

    const nodeEnter = nodeSel.enter().append('g')
      .attr('class', d=>`node ${d.type}`)
      .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended))
      .on('click', (ev,d)=> onNodeClick(ev,d));

    nodeEnter.append('rect').attr('width', 180).attr('height', 50).attr('x', -90).attr('y', -25);

    // Icone simples
    nodeEnter.append('circle').attr('cx', -68).attr('cy', 0).attr('r', 12)
      .attr('fill', d=> d.type==='directory' ? '#cfe3f2' : '#eaf0f6').attr('stroke', '#bcd2e4');
    nodeEnter.append('path')
      .attr('d', d=> d.type==='directory' ? 'M-75,-4 h10 l3,4 h12 v12 h-25 z' : 'M-76,-8 h16 l6,6 v16 h-22 z')
      .attr('fill', d=> d.type==='directory' ? '#4a83b6' : '#7b8b9c');

    nodeEnter.append('text').attr('class','label').attr('x', -48).attr('y', 2).text(d=>truncate(d.name, 22));

    nodeEnter.append('text').attr('class','badge').attr('x', 78).attr('y', 18)
      .text(d=> d.type==='directory' ? 'pasta' : ext(d.name));

    const merged = nodeEnter.merge(nodeSel);

    sim.nodes(state.nodes).on('tick', ()=>{
      gLinks.selectAll('path.link')
        .attr('d', d=> `M ${d.source.x} ${d.source.y} L ${d.target.x} ${d.target.y}`);
      gNodes.selectAll('g.node')
        .attr('transform', d=> `translate(${d.x},${d.y})`);
    });
    sim.force('link').links(state.links);
    sim.alpha(0.9).restart();
  }

  function dragstarted(event, d){
    if(!event.active) sim.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
  }
  function dragged(event, d){ d.fx = event.x; d.fy = event.y; }
  function dragended(event, d){ if(!event.active) sim.alphaTarget(0); d.fx=null; d.fy=null; }

  function truncate(s, n){ return s.length>n? s.slice(0,n-1)+'…': s; }
  function ext(name){ const i=name.lastIndexOf('.'); return i>0? name.slice(i+1).toLowerCase(): 'arquivo'; }

  function onNodeClick(ev, d){
    selectNode(d.id);
    if(d.type==='directory') toggleExpand(d);
  }

  function selectNode(id){
    state.selection = id;
    gNodes.selectAll('g.node').classed('selected', d=> d.id===id);
    // Breadcrumbs
    const bc = pathToRoot(id);
    const nav = bc.map((n,i)=> `<a href="#" data-id="${n.id}">${n.name}</a>${i<bc.length-1?' / ':''}`).join('');
    $('#breadcrumbs').innerHTML = nav || '–';
    $('#breadcrumbs').querySelectorAll('a').forEach(a=>{
      a.addEventListener('click', (e)=>{ e.preventDefault(); const nid=+a.dataset.id; centerOnNode(nid); selectNode(nid); });
    });
    // Details
    const node = state.byId.get(id);
    const kids = childrenOf(id).length;
    $('#details').innerHTML = `
      <div><b>Nome:</b> ${node.name}</div>
      <div><b>Tipo:</b> ${node.type==='directory'?'Pasta':'Arquivo'}</div>
      <div><b>Caminho:</b> ${node.path||'—'}</div>
      <div><b>Filhos:</b> ${kids}</div>
    `;
  }

  function centerOnNode(id){
    const n = state.byId.get(id); if(!n) return;
    const {width,height} = graph.node().getBoundingClientRect();
    const t = d3.zoomTransform(graph.node());
    const scale = t.k;
    const x = width/2 - n.x*scale; const y = height/2 - n.y*scale;
    graph.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(x,y).scale(scale));
  }

  async function toggleExpand(node){
    if(node.expanded){
      // Colapsar: remover subárvore
      collapse(node.id);
      node.expanded=false;
      render();
      return;
    }
    // Expandir
    if(node.lazyChildren){
      node.lazyChildren.forEach(c=> addChild(node, c));
      node.lazyChildren = null;
    } else if(node.fsKind==='directory' && state.handles.has(node.id)){
      const dirHandle = state.handles.get(node.id);
      for await (const [name, handle] of dirHandle.entries()){
        if (name.startsWith('.')) continue; // ignora ocultos
        if(handle.kind === 'directory'){
          const child = makeNode({name, type:'directory', parentId: node.id, meta:{ path: (node.path? node.path+"/":"")+name, fsKind:'directory' }});
          state.handles.set(child.id, handle);
        } else {
          makeNode({name, type:'file', parentId: node.id, meta:{ path: (node.path? node.path+"/":"")+name, fsKind:'file' }});
        }
      }
    }
    node.expanded = true;
    render();
  }

  function addChild(parent, childDesc){
    const child = makeNode({
      name: childDesc.name,
      type: childDesc.type,
      parentId: parent.id,
      meta: { path: (parent.path? parent.path+"/":"") + childDesc.name, fsKind: childDesc.type==='directory'?'directory':'file' }
    });
    if(childDesc.type==='directory' && childDesc.children && childDesc.children.length){
      // lazy: só liga como lazyChildren do filho para expandir depois
      child.lazyChildren = childDesc.children;
    }
    return child;
  }

  function collapse(id){
    const toRemove = new Set();
    (function walk(nid){
      const kids = childrenOf(nid);
      kids.forEach(k=>{ toRemove.add(k.id); walk(k.id); });
    })(id);
    // remove links
    state.links = state.links.filter(l=> !toRemove.has(l.target.id));
    // remove nodes
    state.nodes = state.nodes.filter(n=> !toRemove.has(n.id));
    [...toRemove].forEach(i=> state.byId.delete(i));
  }

  async function pickDirectory(){
    if(!('showDirectoryPicker' in window)){
      alert('Seu navegador não suporta o Acesso ao Sistema de Arquivos. Use Chrome/Edge ou importe um JSON.');
      return;
    }
    try{
      const dir = await window.showDirectoryPicker();
      // Reset
      Object.assign(state, {nodes:[],links:[],byId:new Map(),handles:new Map(),id:0,selection:null, rootId:null});
      const root = makeNode({name: dir.name || 'Raiz', type:'directory', parentId:null, meta:{path: dir.name || '/', fsKind:'directory'}});
      setRoot(root);
      state.handles.set(root.id, dir);
      render();
      // auto expandir primeiro nível
      await toggleExpand(root);
      selectNode(root.id);
    }catch(err){ if(err && err.name!=='AbortError'){ console.error(err); alert('Não foi possível acessar a pasta.'); }}
  }

  function importJSON(obj){
    // Reset
    Object.assign(state, {nodes:[],links:[],byId:new Map(),handles:new Map(),id:0,selection:null, rootId:null});
    const root = makeNode({name: obj.name||'Raiz', type:'directory', parentId:null, meta:{path: obj.name||'/'}});
    setRoot(root);
    root.lazyChildren = obj.children||[];
    render();
    toggleExpand(root);
    selectNode(root.id);
  }

  function exportJSON(){
    function build(nid){
      const n = state.byId.get(nid);
      const kids = childrenOf(nid).map(k=> build(k.id));
      return { name: n.name, type: n.type, children: kids };
    }
    const data = build(state.rootId);
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = (state.byId.get(state.rootId)?.name||'mapa')+".json";
    a.click(); URL.revokeObjectURL(a.href);
  }

  function saveSVG(){
    const svg = document.getElementById('graph');
    const serializer = new XMLSerializer();
    // Inline estilos mínimos
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const source = serializer.serializeToString(svg);
    const blob = new Blob([source], {type:'image/svg+xml;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'mapa-pastas.svg'; a.click();
    URL.revokeObjectURL(a.href);
  }

  function savePNG(){
    const svg = document.getElementById('graph');
    const serializer = new XMLSerializer();
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const source = serializer.serializeToString(svg);
    const img = new Image();
    const svg64 = btoa(unescape(encodeURIComponent(source)));
    img.onload = function(){
      const canvas = document.createElement('canvas');
      canvas.width = svg.clientWidth; canvas.height = svg.clientHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#fff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img, 0, 0);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png'); a.download='mapa-pastas.png'; a.click();
    };
    img.src = 'data:image/svg+xml;base64,' + svg64;
  }

  function applySearch(q){
    q = (q||'').trim().toLowerCase();
    const nodes = gNodes.selectAll('g.node');
    if(!q){ nodes.classed('dimmed', false); return; }
    nodes.classed('dimmed', d=> !d.name.toLowerCase().includes(q));
  }

  // Controles UI
  $('#btnPick').addEventListener('click', pickDirectory);
  $('#btnImport').addEventListener('click', ()=> $('#fileJson').click());
  $('#fileJson').addEventListener('change', (ev)=>{
    const f = ev.target.files?.[0]; if(!f) return;
    const reader = new FileReader();
    reader.onload = ()=>{ try { const obj = JSON.parse(reader.result); importJSON(obj); } catch(e){ alert('JSON inválido.'); } };
    reader.readAsText(f);
  });
  $('#btnExport').addEventListener('click', exportJSON);
  $('#btnSaveSVG').addEventListener('click', saveSVG);
  $('#btnSavePNG').addEventListener('click', savePNG);
  $('#txtSearch').addEventListener('input', (e)=> applySearch(e.target.value));
  window.addEventListener('keydown', (e)=>{ if(e.ctrlKey && e.key.toLowerCase()==='k'){ e.preventDefault(); $('#txtSearch').focus(); } });

  // Inicialização com exemplo
  const exemplo = {
    name: 'Projeto',
    type: 'directory',
    children: [
      { name: 'docs', type:'directory', children:[ {name:'README.md', type:'file'}, {name:'arquitetura.drawio', type:'file'} ] },
      { name: 'src', type:'directory', children:[ {name:'index.js', type:'file'}, {name:'app', type:'directory', children:[{name:'App.jsx', type:'file'},{name:'App.css', type:'file'}]} ] },
      { name: 'package.json', type:'file' },
      { name: 'LICENSE', type:'file' }
    ]
  };
  importJSON(exemplo);

})();
