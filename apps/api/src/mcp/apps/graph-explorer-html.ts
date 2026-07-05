/**
 * Knowledge Graph Explorer MCP App HTML panel.
 * D3 v7 force-directed graph with community blobs, god-node pulse rings,
 * highlighted traversal path, and a detail drawer.
 * Data injected via window.__MNEMA_STRUCTURED_CONTENT__ from MCP structuredContent.
 */

let _html: string | null = null;

export function getGraphExplorerHtml(): string {
  if (_html) return _html;

  _html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Knowledge Graph</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<style>
:root {
  --bg:#050508; --surface:#121317; --surface2:#181A1F; --surface3:#22252B;
  --line:rgba(255,255,255,0.07); --ink:#F0EEE9; --ink-muted:rgba(240,238,233,0.45);
  --accent:#F0997B; --sans:'Inter',system-ui,sans-serif; --mono:'Fira Mono',monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--ink);font-family:var(--sans)}
#header{
  position:fixed;top:0;left:0;right:0;height:48px;z-index:20;
  background:var(--surface);border-bottom:1px solid var(--line);
  display:flex;align-items:center;padding:0 16px;gap:12px;
}
#header-title{font:600 13px/1 var(--sans);color:var(--ink);flex:1}
#header-stats{font:400 11px/1 var(--mono);color:var(--ink-muted)}
.hbtn{
  height:28px;padding:0 12px;border-radius:6px;border:1px solid var(--line);
  background:var(--surface2);color:var(--ink);font:500 11.5px/1 var(--sans);
  cursor:pointer;display:inline-flex;align-items:center;gap:5px;
}
.hbtn:hover{background:var(--surface3)}
svg#graph{position:fixed;top:48px;left:0;width:100%;height:calc(100% - 48px)}
#drawer{
  position:fixed;top:48px;right:0;width:260px;height:calc(100% - 48px);
  background:var(--surface);border-left:1px solid var(--line);
  padding:16px;overflow-y:auto;transform:translateX(100%);
  transition:transform 220ms cubic-bezier(0.16,1,0.3,1);z-index:15;
}
#drawer.open{transform:translateX(0)}
#drawer-label{font:600 14px/1.3 var(--sans);margin-bottom:4px}
#drawer-badges{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.badge{font:500 10px/1 var(--mono);padding:3px 7px;border-radius:4px;background:var(--surface2);letter-spacing:0.04em;text-transform:uppercase}
.badge-god{background:rgba(251,191,36,0.18);color:#fbbf24}
#drawer-stats{font:400 12px/1.6 var(--mono);color:var(--ink-muted);margin-bottom:10px}
#drawer-summary{font:400 12.5px/1.55 var(--sans);color:var(--ink-muted);margin-bottom:12px}
#drawer-connections{font:400 12px/1.6 var(--sans)}
#drawer-connections .conn{display:flex;align-items:baseline;gap:6px;padding:3px 0;border-top:1px solid var(--line)}
#drawer-connections .conn .ctype{font:500 10px/1 var(--mono);color:var(--ink-muted);min-width:80px}
@keyframes pulse-ring{0%,100%{opacity:.8;r:0}50%{opacity:.3;r:8}}
</style>
</head>
<body>
<div id="header">
  <span id="header-title">GRAPH</span>
  <span id="header-stats"></span>
  <button class="hbtn" id="btn-god-nodes">God-nodes</button>
  <button class="hbtn" id="btn-reset">Reset</button>
  <button class="hbtn" id="btn-export">&#8595; Export</button>
</div>
<svg id="graph">
  <defs>
    <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
      <polygon points="0 0, 6 2, 0 4" fill="rgba(255,255,255,0.2)"/>
    </marker>
    <!-- CSS glow simulation for regular nodes -->
    <filter id="node-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <!-- Stronger glow for god-nodes -->
    <filter id="god-node-glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="8" result="blur1"/>
      <feGaussianBlur stdDeviation="3" result="blur2"/>
      <feMerge><feMergeNode in="blur1"/><feMergeNode in="blur2"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <!-- Subtle edge glow -->
    <filter id="edge-glow">
      <feGaussianBlur stdDeviation="1.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g id="zoom-container">
    <g id="blobs-layer"></g>
    <g id="edges-layer"></g>
    <g id="nodes-layer"></g>
  </g>
</svg>
<div id="drawer">
  <div id="drawer-label"></div>
  <div id="drawer-badges"></div>
  <div id="drawer-stats"></div>
  <div id="drawer-summary"></div>
  <div id="drawer-connections"></div>
</div>
<script>
(function(){
  var NODE_COLORS = {
    doc:'#60a5fa', flow:'#fbbf24', flow_step:'#fbbf24',
    task:'#4ade80', session:'#52525b', concept:'#a78bfa',
    decision:'#f0997b', project:'#e879f9', rationale:'#f0997b'
  };

  var data = window.__MNEMA_STRUCTURED_CONTENT__;
  if (!data) { document.getElementById('header-title').textContent = 'No graph data — call traverse_graph or get_god_nodes'; return; }

  var nodes = (data.nodes || []).map(function(n){ return Object.assign({}, n); });
  var edges = data.edges || [];
  var highlighted = new Set(data.highlightedPath || []);
  var godNodes   = new Set(data.godNodes || []);
  var communities = data.communities || [];
  var commMap = {};
  communities.forEach(function(c){ commMap[c.id] = c.label; });

  // Stats
  var stats = nodes.length + ' nodes  ' + edges.length + ' edges  ' + godNodes.size + ' god-nodes';
  document.getElementById('header-stats').textContent = stats;
  document.getElementById('header-title').textContent = 'GRAPH · ' + (data.query ? (data.query.from + (data.query.to ? ' → ' + data.query.to : '')) : '');

  var svg = d3.select('#graph');
  var W = window.innerWidth, H = window.innerHeight - 48;
  var zoomContainer = d3.select('#zoom-container');
  var edgesLayer = d3.select('#edges-layer');
  var nodesLayer = d3.select('#nodes-layer');
  var blobsLayer = d3.select('#blobs-layer');

  // Zoom / pan
  var zoom = d3.zoom().scaleExtent([0.1, 8]).on('zoom', function(event){
    zoomContainer.attr('transform', event.transform);
  });
  svg.call(zoom);

  // Dismiss drawer on background click
  svg.on('click', function(event){
    if (event.target === svg.node() || event.target.tagName === 'svg') closeDrawer();
  });

  // Node radius
  function radius(d){ return 6 + Math.min((d.degree || 0) * 0.5, 12); }

  // Build simulation
  var nodeMap = {};
  nodes.forEach(function(n){ nodeMap[n.id] = n; });

  var sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(
      edges.map(function(e){ return {source: e.fromNodeId || e.from_node_id, target: e.toNodeId || e.to_node_id, data: e}; })
    ).id(function(d){ return d.id; }).distance(function(l){ return l.data && l.data.edgeType === 'part_of' ? 60 : 120; }))
    .force('charge', d3.forceManyBody().strength(function(d){ return -80 - (d.degree || 0) * 3; }))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collide', d3.forceCollide().radius(function(d){ return radius(d) + 4; }));

  // Edges
  var edgeSel = edgesLayer.selectAll('line').data(
    edges.map(function(e){ return {source: e.fromNodeId || e.from_node_id, target: e.toNodeId || e.to_node_id, data: e}; })
  ).enter().append('line')
    .attr('filter', 'url(#edge-glow)')
    .attr('stroke', function(d){
      var isPath = highlighted.has(d.source) && highlighted.has(d.target);
      return isPath ? '#fbbf24' : 'rgba(255,255,255,0.25)';
    })
    .attr('stroke-width', function(d){
      var isPath = highlighted.has(d.source) && highlighted.has(d.target);
      return isPath ? 2.5 : 1;
    })
    .attr('stroke-dasharray', function(d){
      if (!d.data) return null;
      if (d.data.provenance === 'INFERRED')  return '5,3';
      if (d.data.provenance === 'AMBIGUOUS') return '3,3';
      return null;
    })
    .attr('opacity', function(d){
      if (!d.data) return 0.5;
      if (highlighted.has(d.source) && highlighted.has(d.target)) return 1;
      if (d.data.provenance === 'INFERRED')  return 0.5;
      if (d.data.provenance === 'AMBIGUOUS') return 0.3;
      return 0.6;
    })
    .attr('marker-end', 'url(#arrowhead)');

  // God-node pulse rings
  var godRings = nodesLayer.selectAll('circle.god-ring').data(nodes.filter(function(n){ return n.isGodNode; }))
    .enter().append('circle')
    .attr('class', 'god-ring')
    .attr('r', function(d){ return radius(d) + 6; })
    .attr('fill', 'none')
    .attr('stroke', '#fbbf24')
    .attr('stroke-width', 1.5)
    .attr('opacity', 0.6);

  // Animate god rings
  function pulseGodRings() {
    godRings.transition().duration(1200).attr('opacity', 0.15).attr('r', function(d){ return radius(d) + 12; })
      .transition().duration(1200).attr('opacity', 0.6).attr('r', function(d){ return radius(d) + 6; })
      .on('end', pulseGodRings);
  }
  if (godRings.size() > 0) pulseGodRings();

  // Nodes
  var nodeSel = nodesLayer.selectAll('circle.node').data(nodes).enter().append('circle')
    .attr('class', 'node')
    .attr('r', radius)
    .attr('fill', function(d){ return highlighted.has(d.id) ? '#fbbf24' : (NODE_COLORS[d.entityType] || '#6b7280'); })
    .attr('stroke', function(d){ return d.isGodNode ? '#fbbf24' : 'rgba(255,255,255,0.15)'; })
    .attr('stroke-width', function(d){ return d.isGodNode ? 2 : 1; })
    .attr('opacity', function(d){ return highlighted.size > 0 ? (highlighted.has(d.id) ? 1 : 0.4) : 0.9; })
    .attr('filter', function(d){ return d.isGodNode ? 'url(#god-node-glow)' : 'url(#node-glow)'; })
    .style('cursor', 'pointer')
    .on('click', function(event, d){ event.stopPropagation(); openDrawer(d); });

  // Node drag
  nodeSel.call(d3.drag()
    .on('start', function(event, d){ if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag',  function(event, d){ d.fx = event.x; d.fy = event.y; })
    .on('end',   function(event, d){ if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

  // Labels for high-degree or highlighted nodes
  var labelSel = nodesLayer.selectAll('text.node-label').data(nodes.filter(function(n){ return n.degree >= 3 || highlighted.has(n.id) || n.isGodNode; }))
    .enter().append('text')
    .attr('class', 'node-label')
    .text(function(d){ return d.label && d.label.length > 20 ? d.label.slice(0, 18) + '…' : (d.label || ''); })
    .attr('font-size', '9px')
    .attr('fill', function(d){ return highlighted.has(d.id) ? '#fbbf24' : 'rgba(240,238,233,0.6)'; })
    .attr('text-anchor', 'middle')
    .attr('dy', function(d){ return -(radius(d) + 4); })
    .style('pointer-events', 'none');

  // Tick
  sim.on('tick', function(){
    edgeSel
      .attr('x1', function(d){ return d.source.x; }).attr('y1', function(d){ return d.source.y; })
      .attr('x2', function(d){ return d.target.x; }).attr('y2', function(d){ return d.target.y; });
    nodeSel.attr('cx', function(d){ return d.x; }).attr('cy', function(d){ return d.y; });
    godRings.attr('cx', function(d){ return d.x; }).attr('cy', function(d){ return d.y; });
    labelSel.attr('x', function(d){ return d.x; }).attr('y', function(d){ return d.y; });
  });

  // Zoom to fit after settling
  setTimeout(function(){ resetZoom(); }, 2500);

  function resetZoom(){
    var bounds = nodesLayer.node().getBBox();
    if (!bounds || bounds.width === 0) return;
    var pad = 40;
    var scale = Math.min((W - pad*2) / bounds.width, (H - pad*2) / bounds.height, 2);
    var tx = W/2 - scale * (bounds.x + bounds.width/2);
    var ty = H/2 - scale * (bounds.y + bounds.height/2);
    svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  // Drawer
  function openDrawer(d){
    document.getElementById('drawer-label').textContent = d.label;
    var badges = document.getElementById('drawer-badges');
    badges.innerHTML = '<span class="badge">' + d.entityType + '</span>';
    if (d.isGodNode) badges.innerHTML += '<span class="badge badge-god">★ god node</span>';
    if (d.communityLabel) badges.innerHTML += '<span class="badge">' + d.communityLabel + '</span>';

    document.getElementById('drawer-stats').textContent =
      'Degree: ' + (d.degree || 0) +
      '  ·  Betweenness: ' + ((d.betweennessCentrality || 0) * 100).toFixed(1) + '%' +
      (d.communityId != null ? '  ·  Community: ' + (commMap[d.communityId] || '#' + d.communityId) : '');

    document.getElementById('drawer-summary').textContent = d.summary || '';

    // Connections list
    var conns = document.getElementById('drawer-connections');
    var related = edges.filter(function(e){
      return (e.fromNodeId || e.from_node_id) === d.id || (e.toNodeId || e.to_node_id) === d.id;
    }).slice(0, 12);
    conns.innerHTML = related.map(function(e){
      var isOut = (e.fromNodeId || e.from_node_id) === d.id;
      var otherId = isOut ? (e.toNodeId || e.to_node_id) : (e.fromNodeId || e.from_node_id);
      var other = nodeMap[otherId];
      return '<div class="conn"><span class="ctype">' + (isOut ? '→ ' : '← ') + e.edgeType + '</span><span>' + (other ? other.label : otherId.slice(0,8)) + '</span></div>';
    }).join('');

    document.getElementById('drawer').classList.add('open');
  }
  function closeDrawer(){ document.getElementById('drawer').classList.remove('open'); }

  // Keyboard dismiss
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeDrawer(); });

  // God-nodes button
  document.getElementById('btn-god-nodes').addEventListener('click', function(){
    nodeSel.attr('opacity', function(d){ return d.isGodNode ? 1 : 0.2; });
    godRings.attr('opacity', 1);
  });

  // Reset button
  document.getElementById('btn-reset').addEventListener('click', function(){
    resetZoom();
    nodeSel.attr('opacity', function(d){ return highlighted.size > 0 ? (highlighted.has(d.id) ? 1 : 0.4) : 0.9; });
    closeDrawer();
  });

  // Export
  document.getElementById('btn-export').addEventListener('click', function(){
    var json = JSON.stringify({ nodes: nodes, edges: edges }, null, 2);
    var blob = new Blob([json], { type:'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'graph.json';
    a.click();
  });

  // Resize
  window.addEventListener('resize', function(){
    W = window.innerWidth; H = window.innerHeight - 48;
    sim.force('center', d3.forceCenter(W/2, H/2));
  });
})();
</script>
</body>
</html>`;

  return _html;
}
