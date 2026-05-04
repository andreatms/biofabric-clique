function uploadJsonFile() {
                const fileInput = document.getElementById('jsonfile');
                const file = fileInput.files[0];

                if (!file) {
                    alert('Please select a JSON file first.');
                    return;
                }

                const formData = new FormData();
                formData.append('jsonfile', file);

                fetch('/upload-json', {
                    method: 'POST',
                    body: formData
                })
                    .then(response => response.json())
                    .then(data => {
                        console.log('Success:', data);
                        alert('JSON file uploaded successfully!');
                        loadJsonList();
                        loadOptions();
                    })
                    .catch((error) => {
                        console.error('Error:', error);
                        alert('Error uploading JSON file.');
                    });
            }

            function deleteJsonFile(fileId) {
                fetch(`/delete-json-file/${fileId}`, {
                    method: 'DELETE'
                })
                    .then(response => response.json())
                    .then(data => {
                        console.log('Success:', data);
                        alert('JSON file deleted successfully!');
                        loadJsonList();
                        loadOptions();
                    })
                    .catch((error) => {
                        console.error('Error:', error);
                        alert('Error deleting JSON file.');
                    });
            }

            function loadJsonList() {
                fetch('/uploaded-json-files')
                    .then(response => response.json())
                    .then(data => {
                        const tbl = document.getElementById('loaded-json-file-list');
                        const tbody = tbl ? tbl.querySelector('tbody') : null;
                        if (!tbody) return;
                        tbody.innerHTML = '';
                        if (data.files.length === 0) {
                            tbody.innerHTML = '<tr><td colspan="2" class="list-empty">No files</td></tr>';
                            return;
                        }
                        data.files.forEach(file => {
                            const tr = document.createElement('tr');
                            tr.innerHTML = `<td>${file.name}</td>
                                <td class="td-actions actions-col">
                                  <div class="actions-wrap">
                                    <button class="btn-sm" onclick="drawGraphById('${file.id}')">Draw</button>
                                    <button class="btn-sm btn-danger" onclick="deleteJsonFile('${file.id}')">&#128465;</button>
                                  </div>
                                </td>`;
                            tbody.appendChild(tr);
                        });
                    })
                    .catch((error) => {
                        console.error('Error:', error);
                    });
            }

            function forceReloadJson() {
                loadJsonList();
            }

            
            loadJsonList();


            var graphData = null;
            var solData = null;
            let graphSetsCache = [];

            const urlParams = new URLSearchParams(window.location.search);
            const initialGraphId = urlParams.get('graph') || urlParams.get('dataset');
            const initialSetName = urlParams.get('set');
            const initialSetGraphId = urlParams.get('setGraph');

            loadOptions();
            loadGraphSetList();

            function loadOptions() {
                return fetch('/uploaded-json-files')
                    .then(response => response.json())
                    .then(data => {
                        const fileList = document.getElementById('graph-select');
                        fileList.innerHTML = '';

                        data.files.forEach(file => {
                            const newOption = document.createElement('option');
                            newOption.value = file.id;
                            newOption.textContent = file.name;
                            fileList.appendChild(newOption);
                        });

                        if (initialGraphId && data.files.some(file => file.id === initialGraphId)) {
                            drawGraphById(initialGraphId);
                        }

                                                if (initialSetName && initialSetGraphId) {
                                                        setTimeout(() => drawGraphFromSet(initialSetName, initialSetGraphId), 0);
                                                }
                    })
                    .catch((error) => {
                        console.error('Error:', error);
                    });
            }

                        function drawGraphFromSet(setName, graphId, shouldScroll = true) {
                            if (!setName || !graphId) {
                                alert('Select a set and a set graph.');
                                return;
                            }
                            fetch(`/graph-sets/${encodeURIComponent(setName)}/graphs/${encodeURIComponent(graphId)}`)
                                .then(r => r.json())
                                .then(data => {
                                    if (data.error) throw new Error(data.error);
                                    graphData = data;
                                    renderGraph();
                                    if (shouldScroll) {
                                        const graphSection = document.getElementById('graph-section');
                                        if (graphSection) graphSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }
                                })
                                .catch((error) => {
                                    console.error('Error:', error);
                                    alert('Error loading set graph: ' + error.message);
                                });
                        }

                        function drawGraphFromSetSelection() {
                            const setSel = document.getElementById('graph-set-select');
                            const graphSel = document.getElementById('graph-set-graph-select');
                            if (!setSel || !graphSel) return;
                            drawGraphFromSet(setSel.value, graphSel.value, true);
                        }

                        function syncSetGraphSelect(setName) {
                            const graphSel = document.getElementById('graph-set-graph-select');
                            if (!graphSel) return;
                            graphSel.innerHTML = '';

                            const found = graphSetsCache.find((s) => s.setName === setName);
                            const graphs = found && Array.isArray(found.graphs) ? found.graphs : [];
                            if (!graphs.length) {
                                const opt = document.createElement('option');
                                opt.value = '';
                                opt.textContent = 'No graph in set';
                                graphSel.appendChild(opt);
                                return;
                            }

                            graphs.forEach((g) => {
                                const opt = document.createElement('option');
                                opt.value = g.id;
                                opt.textContent = `${g.id} (${g.nodes}n/${g.edges}e)`;
                                graphSel.appendChild(opt);
                            });

                            if (initialSetName === setName && initialSetGraphId && graphs.some((g) => g.id === initialSetGraphId)) {
                                graphSel.value = initialSetGraphId;
                            }
                        }

                        function loadGraphSetList() {
                            fetch('/graph-sets')
                                .then(r => r.json())
                                .then(async (data) => {
                                    const sets = data.sets || [];
                                    const detailed = [];
                                    for (const s of sets) {
                                        try {
                                            const dr = await fetch(`/graph-sets/${encodeURIComponent(s.setName)}`);
                                            const dj = await dr.json();
                                            if (dr.ok && !dj.error) detailed.push(dj);
                                        } catch (_) {}
                                    }
                                    graphSetsCache = detailed;

                                    const setSel = document.getElementById('graph-set-select');
                                    const tbody = document.getElementById('loaded-set-graph-list')?.querySelector('tbody');
                                    if (!setSel || !tbody) return;

                                    setSel.innerHTML = '';
                                    tbody.innerHTML = '';

                                    if (!graphSetsCache.length) {
                                        const opt = document.createElement('option');
                                        opt.value = '';
                                        opt.textContent = 'No sets available';
                                        setSel.appendChild(opt);
                                        tbody.innerHTML = '<tr><td colspan="5" class="list-empty">No sets available</td></tr>';
                                        syncSetGraphSelect('');
                                        return;
                                    }

                                    graphSetsCache.forEach((setData) => {
                                        const opt = document.createElement('option');
                                        opt.value = setData.setName;
                                        opt.textContent = `${setData.setName} (${(setData.graphs || []).length})`;
                                        setSel.appendChild(opt);

                                        (setData.graphs || []).forEach((g) => {
                                            const tr = document.createElement('tr');
                                            tr.innerHTML = `
                                                <td>${setData.setName}</td>
                                                <td>${g.id}</td>
                                                <td>${g.nodes ?? '-'}</td>
                                                <td>${g.edges ?? '-'}</td>
                                                <td class="td-actions actions-col">
                                                    <div class="actions-wrap">
                                                        <button class="btn-sm" onclick="drawGraphFromSet('${setData.setName}','${g.id}',true)">Draw</button>
                                                    </div>
                                                </td>`;
                                            tbody.appendChild(tr);
                                        });
                                    });

                                    if (initialSetName && graphSetsCache.some((s) => s.setName === initialSetName)) {
                                        setSel.value = initialSetName;
                                    }
                                    syncSetGraphSelect(setSel.value);
                                })
                                .catch((error) => {
                                    console.error('Error loading graph sets:', error);
                                });
                        }

                        document.getElementById('graph-set-select').addEventListener('change', (e) => {
                            syncSetGraphSelect(e.target.value);
                        });

            function drawGraphById(graphId) {
            const graphSelect = document.getElementById('graph-select');
            if (!graphSelect) return;
            graphSelect.value = graphId;
            drawGraph(graphId, true);
        }

            function drawGraph(graphId, shouldScroll) {
            const selectedGraphId = graphId || document.getElementById('graph-select').value;
            if (!selectedGraphId) {
                alert('Select a graph to draw.');
                return;
            }

            fetch(`/jsonFiles/${selectedGraphId}`)
                .then(response => response.json())
                .then(data => {
                    graphData = data;
                    renderGraph();
                    if (shouldScroll) {
                        const graphSection = document.getElementById('graph-section');
                        if (graphSection) {
                            graphSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }
                    }
                })
                .catch((error) => {
                    console.error('Error:', error);
                });
        }

        function renderGraph() {
            d3.select("#graph").selectAll("*").remove();
            if (!graphData) { alert("No graph data loaded."); return; }

            const width = 1000, height = 600;
            const stripeW = 4; 

            
            const cliques = graphData.cliques || [];
            const edgeCliqueMap = new Map();          
            graphData.links.forEach(l => edgeCliqueMap.set(l.id, []));
            cliques.forEach(c => {
                const cSet = new Set(c.nodes);
                graphData.links.forEach(l => {
                    
                    const s = (typeof l.source === 'object') ? l.source.id : l.source;
                    const t = (typeof l.target === 'object') ? l.target.id : l.target;
                    if (cSet.has(s) && cSet.has(t)) edgeCliqueMap.get(l.id).push(c.id);
                });
            });

            
            const coloredLinks = graphData.links.map(l => ({
                ...l,
                cliques: edgeCliqueMap.get(l.id) || []
            }));

            
            const stripeData = [];
            coloredLinks.forEach(link => {
                const lc = link.cliques.length > 0 ? link.cliques : [0];
                lc.forEach((cliqueId, i) => {
                    stripeData.push({ link, cliqueId, index: i, total: lc.length });
                });
            });

            const svg = d3.select("#graph")
                .append("svg")
                .attr("width", width)
                .attr("height", height);

            const simulation = d3.forceSimulation(graphData.nodes)
                .force("link", d3.forceLink(coloredLinks).id(d => d.id).distance(100))
                .force("charge", d3.forceManyBody().strength(-100))
                .force("center", d3.forceCenter(width / 2, height / 2));

            
            const linkStripes = svg.append("g")
                .attr("class", "links")
                .selectAll("line")
                .data(stripeData)
                .enter().append("line")
                .attr("stroke-width", d => d.total > 1 ? stripeW : 2)
                .attr("stroke", d => d.cliqueId > 0
                    ? d3.schemeCategory10[d.cliqueId % 10]
                    : "#999");

            
            const linkLabel = svg.append("g")
                .attr("class", "link-labels")
                .selectAll("text")
                .data(coloredLinks)
                .enter().append("text")
                .attr("font-size", 12)
                .attr("fill", "#555")
                .attr("dy", -5)
                .text(d => d.id);

            
            const node = svg.append("g")
                .attr("class", "nodes")
                .selectAll("circle")
                .data(graphData.nodes)
                .enter().append("circle")
                .attr("r", 10)
                .attr("fill", "#69b3a2")
                .call(d3.drag()
                    .on("start", dragstarted)
                    .on("drag", dragged)
                    .on("end", dragended));

            const nodeLabel = svg.append("g")
                .attr("class", "node-labels")
                .selectAll("text")
                .data(graphData.nodes)
                .enter().append("text")
                .attr("font-size", 14)
                .attr("fill", "#222")
                .attr("text-anchor", "middle")
                .attr("dy", -15)
                .text(d => d.id);

            node.append("title").text(d => d.id);

            
            simulation.on("tick", () => {
                linkStripes
                    .attr("x1", d => {
                        const s = d.link.source, t = d.link.target;
                        const len = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2) || 1;
                        const nx = -(t.y - s.y) / len;
                        const off = (d.index - (d.total - 1) / 2) * stripeW;
                        return s.x + nx * off;
                    })
                    .attr("y1", d => {
                        const s = d.link.source, t = d.link.target;
                        const len = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2) || 1;
                        const ny = (t.x - s.x) / len;
                        const off = (d.index - (d.total - 1) / 2) * stripeW;
                        return s.y + ny * off;
                    })
                    .attr("x2", d => {
                        const s = d.link.source, t = d.link.target;
                        const len = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2) || 1;
                        const nx = -(t.y - s.y) / len;
                        const off = (d.index - (d.total - 1) / 2) * stripeW;
                        return t.x + nx * off;
                    })
                    .attr("y2", d => {
                        const s = d.link.source, t = d.link.target;
                        const len = Math.sqrt((t.x - s.x) ** 2 + (t.y - s.y) ** 2) || 1;
                        const ny = (t.x - s.x) / len;
                        const off = (d.index - (d.total - 1) / 2) * stripeW;
                        return t.y + ny * off;
                    });

                node.attr("cx", d => d.x).attr("cy", d => d.y);
                nodeLabel.attr("x", d => d.x).attr("y", d => d.y);
                linkLabel
                    .attr("x", d => (d.source.x + d.target.x) / 2)
                    .attr("y", d => (d.source.y + d.target.y) / 2);
            });

            function dragstarted(event, d) {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x; d.fy = d.y;
            }
            function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
            function dragended(event, d) {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null; d.fy = null;
            }
        }

