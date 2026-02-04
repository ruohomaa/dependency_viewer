import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import ReactFlow, { Background, Controls, Panel, type Node, type Edge, useNodesState, useEdgesState, MarkerType, Handle, Position, ReactFlowProvider } from 'reactflow';
import dagre from 'dagre';
import * as d3 from 'd3-force';
import 'reactflow/dist/style.css';
import './App.css';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const DataNode = ({ data, selected }: any) => {
  return (
     <div style={{
         width: '100%', height: '100%', borderRadius: '50%',
         backgroundColor: `hsla(${data.hue}, 70%, 70%, 1)`,
         border: selected ? '3px solid #333' : `2px solid hsla(${data.hue}, 70%, 40%, 1)`,
         display: 'flex', alignItems: 'center', justifyContent: 'center',
         boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
     }}>
         {data.showLabel && (
             <div style={{ 
                 position: 'absolute', 
                 left: '100%', 
                 marginLeft: '8px', 
                 whiteSpace: 'nowrap', 
                 fontSize: '12px',
                 fontWeight: 500,
                 textShadow: '0 0 2px white',
                 pointerEvents: 'none' 
             }}>
                 {data.label}
             </div>
         )}
         <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
         <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
     </div>
  );
};
const nodeTypes = { dataNode: DataNode };

const getColorForType = (type: string) => {
  let hash = 0;
  for (let i = 0; i < type.length; i++) {
    hash = type.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return hue;
};

const getGroupedLayoutElements = (nodes: Node[], edges: Edge[]) => {
  if (nodes.length === 0) return { nodes: [] };

  // 1. Group Nodes and Edges
  const typeGroups: Record<string, { nodes: Node[], internalEdges: Edge[] }> = {};
  const nodeTypeMap = new Map<string, string>();

  nodes.forEach(n => {
    const type = n.data.type || 'Other';
    nodeTypeMap.set(n.id, type);
    if (!typeGroups[type]) typeGroups[type] = { nodes: [], internalEdges: [] };
    typeGroups[type].nodes.push(n);
  });

  edges.forEach(e => {
    const sourceType = nodeTypeMap.get(e.source);
    const targetType = nodeTypeMap.get(e.target);
    if (sourceType && targetType && sourceType === targetType) {
      typeGroups[sourceType].internalEdges.push(e);
    }
  });

  const finalChildNodes: Node[] = [];
  const groupDimensions: Record<string, { width: number, height: number }> = {};
  const TITLE_HEIGHT = 40;

  // 2. Layout Internals and Measure Groups
  Object.keys(typeGroups).forEach(type => {
      const { nodes: gNodes } = typeGroups[type];
      
      // Sort nodes by label for consistent ordering
      gNodes.sort((a, b) => (a.data.label || '').localeCompare(b.data.label || ''));

      const count = gNodes.length;
      const NODE_SIZE = 50;
      const SPACING = 15;
      
      // Use Phyllotaxis arrangement (sunflower pattern) for compact circular packing
      // spacing constant c needs to factor in node size
      const c = (NODE_SIZE + SPACING) * 0.75; 
      
      // Calculate max extent to clear container size
      // Theoretically max radius is for the last item
      const maxRadius = count > 0 ? c * Math.sqrt(count) + (NODE_SIZE/2) : (NODE_SIZE + SPACING);

      const padding = 40;
      const groupWidth = (maxRadius * 2) + padding;
      const groupHeight = (maxRadius * 2) + padding;
      
      const centerX = groupWidth / 2;
      // Center Y accounts for title height offset
      const centerY = (groupHeight / 2) + TITLE_HEIGHT;

      gNodes.forEach((node, index) => {
          // Angle = index * 137.5 degrees (golden angle)
          const angle = index * 2.39996; 
          const r = c * Math.sqrt(index);

          // ReactFlow position is top-left
          const w = typeof node.style?.width === 'number' ? node.style.width : NODE_SIZE;
          const h = typeof node.style?.height === 'number' ? node.style.height : NODE_SIZE;
          
          const x = centerX + r * Math.cos(angle) - (w / 2);
          const y = centerY + r * Math.sin(angle) - (h / 2);

          node.position = { x, y };
      });

      groupDimensions[type] = {
          width: groupWidth,
          height: groupHeight + TITLE_HEIGHT
      };
  });

  // 3. Layout Groups (Inter-Type)
  const masterGraph = new dagre.graphlib.Graph();
  masterGraph.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 200 }); 
  masterGraph.setDefaultEdgeLabel(() => ({}));

  Object.keys(groupDimensions).forEach(type => {
      masterGraph.setNode(type, { 
          width: groupDimensions[type].width, 
          height: groupDimensions[type].height 
      });
  });

  const distinctEdges = new Set<string>();
  edges.forEach(e => {
      const sType = nodeTypeMap.get(e.source);
      const tType = nodeTypeMap.get(e.target);
      if (sType && tType && sType !== tType) {
          const key = `${sType}->${tType}`;
          if (!distinctEdges.has(key)) {
              masterGraph.setEdge(sType, tType);
              distinctEdges.add(key);
          }
      }
  });

  dagre.layout(masterGraph);

  // Apply master layout offsets to all children
  Object.keys(groupDimensions).forEach(type => {
      const g = masterGraph.node(type);
      const groupTopLeftX = g.x - (groupDimensions[type].width / 2);
      const groupTopLeftY = g.y - (groupDimensions[type].height / 2);

      const { nodes: gNodes } = typeGroups[type];
      gNodes.forEach(node => {
         node.position.x += groupTopLeftX;
         node.position.y += groupTopLeftY;
         finalChildNodes.push(node);
      });
  });

  return { nodes: finalChildNodes };
};


const getEffectiveType = (type: string, name: string) => {
  // If it has the word Test in it then it is a test class
  if (type === 'ApexClass' && name && name.includes('Test')) {
    return 'ApexTestClass';
  }
  return type;
};

const matchFilter = (label: string, filter: string) => {
    if (!filter) return true;
    if (!label) return false;
    
    const l = label.toLowerCase();
    const f = filter.toLowerCase();
    
    if (f.includes('*')) {
        // Escape regex special characters except *
        const regexStr = '^' + f.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
        return new RegExp(regexStr).test(l);
    }
    
    return l.includes(f);
};

function AppContent() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [rawData, setRawData] = useState<any[]>([]);
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set());
  const [typeFilters, setTypeFilters] = useState<Record<string, string>>({});
  const [globalFilter, setGlobalFilter] = useState('');
  
  // Force Simulation
  const simulationRef = useRef<any>(null);
  
  // Search State
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedItems, setSelectedItems] = useState<Map<string, any>>(new Map()); // Map<id, Item>
  const [isLoading, setIsLoading] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(true);
  const [isLegendExpanded, setIsLegendExpanded] = useState(true);
  const [fetchedResults, setFetchedResults] = useState<Map<string, any[]>>(new Map());
  const [useLocalDb, setUseLocalDb] = useState(false);
  const [showLabels, setShowLabels] = useState(true);

  useEffect(() => {
     // Re-layout when effective nodes/edges change
     if (nodes.length > 0) {
        // Run static layout first
        const { nodes: layoutNodes } = getGroupedLayoutElements(nodes, edges);

        // Initialize Force Simulation
        if (simulationRef.current) {
            simulationRef.current.stop();
        }

        const simNodes = layoutNodes.map(n => ({ 
            ...n, 
            x: n.position.x, 
            y: n.position.y,
            // Store initial group position for clustering force
            initialX: n.position.x,
            initialY: n.position.y
        }));
        
        const simLinks = edges.map(e => ({ ...e, source: e.source, target: e.target }));

        const simulation = d3.forceSimulation(simNodes as any)
            .force("charge", d3.forceManyBody().strength(-300))
            .force("link", d3.forceLink(simLinks as any).id((d: any) => d.id).distance(100))
            .force("collide", d3.forceCollide().radius((d: any) => (d.style?.width || 50) / 2 + 10))
            // Add a force to pull nodes back to their group center/initial position to maintain clusters
            .force("x", d3.forceX((d: any) => d.initialX).strength(0.05))
            .force("y", d3.forceY((d: any) => d.initialY).strength(0.05))
            .alphaDecay(0.05);

        simulation.on("tick", () => {
             setNodes(prev => prev.map(n => {
                 const simNode = simNodes.find(sn => sn.id === n.id);
                 if (simNode) {
                     return { ...n, position: { x: simNode.x, y: simNode.y } };
                 }
                 return n;
             }));
        });

        simulationRef.current = simulation;

        return () => {
            if (simulationRef.current) simulationRef.current.stop();
        };
     }
  }, [nodes.length, edges.length]); // Only re-run if count changes, not on positions

  const onNodeDragStart = useCallback((_: any, node: Node) => {
      if (!simulationRef.current) return;
      simulationRef.current.alphaTarget(0.3).restart();
      const n = simulationRef.current.nodes().find((d: any) => d.id === node.id);
      if (n) {
          n.fx = node.position.x;
          n.fy = node.position.y;
      }
  }, []);

  const onNodeDrag = useCallback((_: any, node: Node) => {
      if (!simulationRef.current) return;
      const n = simulationRef.current.nodes().find((d: any) => d.id === node.id);
      if (n) {
          n.fx = node.position.x;
          n.fy = node.position.y;
      }
  }, []);

  const onNodeDragStop = useCallback((_: any, node: Node) => {
      if (!simulationRef.current) return;
      if (!(_ as any).active) simulationRef.current.alphaTarget(0);
      const n = simulationRef.current.nodes().find((d: any) => d.id === node.id);
      if (n) {
          n.fx = null;
          n.fy = null;
      }
  }, []);

  // Derive all unique types from raw data
  const allTypes = useMemo(() => {
    const types = new Set<string>();
    rawData.forEach((d) => {
      if (d.metadataComponentType) types.add(getEffectiveType(d.metadataComponentType, d.metadataComponentName));
      if (d.refMetadataComponentType) types.add(getEffectiveType(d.refMetadataComponentType, d.refMetadataComponentName || d.refMetadataComponentComponentName));
    });
    return Array.from(types).sort();
  }, [rawData]);

  // Handle Search
  useEffect(() => {
    if (searchTerm.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
        const apiUrl = import.meta.env.DEV ? `http://localhost:3000/api/components?q=${searchTerm}` : `/api/components?q=${searchTerm}`;
        fetch(apiUrl)
            .then(res => res.json())
            .then(data => {
                setSearchResults(data);
            })
            .catch(err => console.error("Search failed", err));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchDependencies = (item: any) => {
    let apiUrl = import.meta.env.DEV ? `http://localhost:3000/api/dependencies/${item.id}` : `/api/dependencies/${item.id}`;
    if (useLocalDb) apiUrl += '?source=local';
    // To support user request "view ... from local database", let's assume if we are in "Local View" mode
    
    fetch(apiUrl)
      .then(res => res.json())
      .then(fetchedData => {
         const stubData = {
             id: `stub-${item.id}`,
             metadataComponentId: item.id,
             metadataComponentName: item.name,
             metadataComponentType: item.type,
             refMetadataComponentId: null,
             refMetadataComponentName: null,
             refMetadataComponentType: null
         };
         const newData = [stubData, ...fetchedData];
         
         setFetchedResults(prev => {
             const next = new Map(prev);
             next.set(item.id, newData);
             return next;
         });
      })
      .catch(err => console.error("Fetch failed", err))
      .finally(() => setIsLoading(false));
  };

  const toggleSearchSelection = (item: any) => {
    const isSelected = selectedItems.has(item.id);

    if (isSelected) {
        setSelectedItems(prev => {
            const next = new Map(prev);
            if (next.has(item.id)) next.delete(item.id);
            return next;
        });
    } else {
        setSelectedItems(prev => {
            const next = new Map(prev);
            next.set(item.id, item);
            return next;
        });
        if (!fetchedResults.has(item.id)) {
            fetchDependencies(item);
        }
    }
  };

  const clearSelection = () => {
    setSelectedItems(new Map());
    setFetchedResults(new Map());
  };

  const loadAllDependencies = () => {
      setIsLoading(true);
      const apiUrl = import.meta.env.DEV ? `http://localhost:3000/api/dependencies` : `/api/dependencies`;
      
      fetch(apiUrl)
        .then(res => res.json())
        .then(data => {
            console.log(`Loaded ${data.length} dependencies`);
            setRawData(data);
            
             setVisibleTypes(prevTypes => {
                const nextTypes = new Set(prevTypes);
                data.forEach((d: any) => {
                    if (d.metadataComponentType) nextTypes.add(getEffectiveType(d.metadataComponentType, d.metadataComponentName));
                    if (d.refMetadataComponentType) nextTypes.add(getEffectiveType(d.refMetadataComponentType, d.refMetadataComponentName || d.refMetadataComponentComponentName));
                });
                return nextTypes;
            });
        })
        .catch(err => console.error("Failed to load all dependencies", err))
        .finally(() => setIsLoading(false));
  };

  const onNodeDoubleClick = (_: React.MouseEvent, node: Node) => {
      const apiUrl = import.meta.env.DEV ? `http://localhost:3000/api/open` : `/api/open`;
      fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: node.id })
      })
      .then(res => {
          if (!res.ok) return res.json().then(e => { throw new Error(e.error) });
      })
      .catch(err => {
          console.error("Failed to open in Salesforce:", err);
          alert(`Failed to open in Salesforce: ${err.message}`);
      });
  };

  useEffect(() => {
     if (selectedItems.size > 0) {
        const nextRawData: any[] = [];
        const seenIds = new Set<string>();
        
        selectedItems.forEach((_, id) => {
            const items = fetchedResults.get(id);
            if (items) {
                items.forEach((d: any) => {
                    if (!seenIds.has(d.id)) {
                        seenIds.add(d.id);
                        nextRawData.push(d);
                    }
                });
            }
        });
        setRawData(nextRawData);
     }
  }, [selectedItems, fetchedResults]);

  useEffect(() => {
    if (rawData.length === 0) {
        setNodes([]);
        setEdges([]);
        return;
    }

    const newNodes = new Map<string, Node>();
    const newEdges: Edge[] = [];
    
    // Helper to calculate size based on lines of code
    const calcSize = (size?: number) => {
        if (!size) return 20; 
        const v = 15 + (Math.log(size || 10) * 5); // Adjusted log scale
        return Math.min(Math.max(v, 20), 80);
    };

    rawData.forEach((d: any, index: number) => {
      const sourceType = getEffectiveType(d.metadataComponentType, d.metadataComponentName);
      const targetType = d.refMetadataComponentType
        ? getEffectiveType(d.refMetadataComponentType, d.refMetadataComponentComponentName || d.refMetadataComponentName)
        : null;
      
      const isVisible = (type: string, name: string) => {
          if (!visibleTypes.has(type)) return false;
          const filter = typeFilters[type] !== undefined ? typeFilters[type] : globalFilter;
          return matchFilter(name, filter);
      };

      const isSourceVisible = isVisible(sourceType, d.metadataComponentName);
      const isTargetVisible = targetType ? isVisible(targetType, d.refMetadataComponentComponentName || d.refMetadataComponentName) : false;

      // Create Source Node
      if (isSourceVisible && d.metadataComponentId && !newNodes.has(d.metadataComponentId)) {
        const size = calcSize(d.metadataComponentSize);
        newNodes.set(d.metadataComponentId, {
          id: d.metadataComponentId,
          position: { x: 0, y: 0 },
          type: 'dataNode',
          data: { 
              label: d.metadataComponentName, 
              type: sourceType, 
              hue: getColorForType(sourceType),
              showLabel: showLabels 
          },
          style: { width: size, height: size },
        });
      }
      
      // Create Target Node
      if (isTargetVisible && d.refMetadataComponentId && !newNodes.has(d.refMetadataComponentId)) {
        const size = calcSize(d.refMetadataComponentSize);
        newNodes.set(d.refMetadataComponentId, {
          id: d.refMetadataComponentId,
          position: { x: 0, y: 0 },
          type: 'dataNode',
          data: { 
              label: d.refMetadataComponentComponentName || d.refMetadataComponentName, 
              type: targetType!, 
              hue: getColorForType(targetType!),
              showLabel: showLabels 
          },
          style: { width: size, height: size },
        });
      }

      // Create Edge only if both nodes are visible
      if (isSourceVisible && isTargetVisible && d.metadataComponentId && d.refMetadataComponentId && d.metadataComponentId !== d.refMetadataComponentId) {
        newEdges.push({
          id: d.id || `e${d.metadataComponentId}-${d.refMetadataComponentId}-${index}`,
          source: d.metadataComponentId,
          target: d.refMetadataComponentId,
          type: 'straight',
          style: { stroke: '#ccc', strokeWidth: 1 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#ccc' },
        });
      }
    });

    const { nodes: layoutedNodes } = getGroupedLayoutElements(
      Array.from(newNodes.values()),
      newEdges
    );

    setNodes(layoutedNodes);
    setEdges(newEdges);
  }, [rawData, visibleTypes, typeFilters, globalFilter]); // Removed showLabels, handled separately

  // Separate effect to update labels without re-layout
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.type === 'dataNode') {
          return { ...node, data: { ...node.data, showLabel: showLabels } };
        }
        return node;
      })
    );
  }, [showLabels]);

  const toggleType = (type: string) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setVisibleTypes(new Set(allTypes));
    } else {
      setVisibleTypes(new Set());
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow 
        nodes={nodes} 
        edges={edges} 
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        fitView
        minZoom={0.01}
        maxZoom={4}
      >
        <Background />
        <Controls />
        
        <Panel position="top-left" style={{ background: 'white', color: 'black', padding: '10px', borderRadius: '5px', boxShadow: '0 0 10px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', maxHeight: '80vh', maxWidth: '350px' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                 <button onClick={() => setUseLocalDb(!useLocalDb)} style={{ 
                     background: useLocalDb ? '#0070d2' : '#f4f6f9',
                     color: useLocalDb ? 'white' : 'black',
                     border: '1px solid #ddd',
                     padding: '5px 10px',
                     borderRadius: '4px',
                     cursor: 'pointer',
                     flex: 1, fontSize: '12px'
                 }}>
                     {useLocalDb ? 'Source: Local DB' : 'Source: Salesforce'}
                 </button>
                 
                 <button onClick={loadAllDependencies} style={{
                     background: '#4caf50',
                     color: 'white',
                     border: 'none',
                     padding: '5px 10px',
                     borderRadius: '4px',
                     cursor: 'pointer',
                     flex: 1, fontSize: '12px'
                 }}>
                     Load All (DB)
                 </button>
            </div>            
            <div style={{ marginBottom: '10px' }}>
                 <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                   <input 
                     type="checkbox" 
                     checked={showLabels} 
                     onChange={(e) => setShowLabels(e.target.checked)}
                     style={{ marginRight: '8px' }}
                   />
                   Show Labels
                 </label>
            </div>
            <div 
                style={{ fontWeight: 'bold', marginBottom: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setIsSearchExpanded(!isSearchExpanded)}
            >
                <span>Search Metadata {isLoading && <span style={{fontSize: '0.8em', fontWeight: 'normal', color: '#666'}}>(Loading...)</span>}</span>
                <span style={{ marginLeft: '10px' }}>{isSearchExpanded ? '▼' : '▶'}</span>
            </div>
            {isSearchExpanded && (
                <>
                <div style={{ display: 'flex', gap: '5px', marginBottom: '5px' }}>
                <input 
                    type="text"  
                    placeholder="Type to search..." 
                    value={searchTerm} 
                    onChange={(e) => setSearchTerm(e.target.value)} 
                    style={{ padding: '8px', flex: 1, border: '1px solid #ccc', borderRadius: '4px', color: 'black', background: 'white' }}
                />

            </div>

            {selectedItems.size > 0 && (
                <div style={{ marginBottom: '10px', padding: '5px', background: '#f0f0f0', borderRadius: '4px', maxHeight: '100px', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px', fontSize: '12px', fontWeight: 'bold' }}>
                        <span>Selected Items:</span>
                        <button onClick={clearSelection} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '11px', textDecoration: 'underline' }}>Clear</button>
                    </div>
                    {Array.from(selectedItems.values()).map(item => (
                        <div key={item.id} style={{ fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
                            <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '5px' }}>{item.name}</span>
                            <span style={{color: '#666', fontSize: '10px'}}>{item.type}</span>
                             <button onClick={() => toggleSearchSelection(item)} style={{ marginLeft: '5px', background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}>✕</button>
                        </div>
                    ))}
                </div>
            )}

            {searchTerm.length > 1 && searchResults.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: '5px 0 0 0', maxHeight: '300px', overflowY: 'auto', border: '1px solid #eee', background: 'white', color: 'black' }}>
                    {searchResults.map((res: any) => (
                        <li 
                            key={res.id} 
                            style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: '8px' }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f9f9f9'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                            onClick={() => toggleSearchSelection(res)}
                        >
                            <input 
                                type="checkbox" 
                                checked={selectedItems.has(res.id)} 
                                readOnly 
                                style={{ cursor: 'pointer' }}
                            />
                            <div>
                                <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{res.name}</div>
                                <div style={{ fontSize: '11px', color: '#666' }}>{res.type}</div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            </>
            )}
        </Panel>

        <Panel position="top-right" className="legend">
          <div 
             style={{ fontWeight: 'bold', marginBottom: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: isLegendExpanded ? '1px solid #ccc' : 'none', paddingBottom: isLegendExpanded ? '5px' : '0' }}
             onClick={() => setIsLegendExpanded(!isLegendExpanded)}
          >
            <span>Filter Types</span>
            <span style={{ marginLeft: '10px' }}>{isLegendExpanded ? '▼' : '▶'}</span>
          </div>
          {isLegendExpanded && (
          <>
          <div style={{ marginBottom: '5px' }}>
            <input 
                type="text"
                placeholder="Global Filter (* for wildcard)"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                style={{ width: '100%', padding: '4px', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '3px' }}
            />
          </div>
          <div className="legend-item" style={{ fontWeight: 'bold', borderBottom: '1px solid #ccc', paddingBottom: '5px', marginBottom: '5px' }}>
            <input 
              type="checkbox" 
              checked={allTypes.length > 0 && visibleTypes.size === allTypes.length}
              disabled={allTypes.length === 0}
              ref={input => {
                if (input) {
                  input.indeterminate = visibleTypes.size > 0 && visibleTypes.size < allTypes.length;
                }
              }}
              onChange={(e) => toggleAll(e.target.checked)}
            />
            <span>All Metadata Types</span>
          </div>
          {allTypes.length === 0 && <div style={{padding: '5px', color: '#666'}}>No data loaded</div>}
          {allTypes.map((type) => (
            <div key={type} className="legend-item" style={{ justifyContent: 'space-between' }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }}>
                  <input
                    type="checkbox"
                    checked={visibleTypes.has(type)}
                    onChange={() => toggleType(type)}
                  />
                   <span style={{ 
                      display: 'inline-block', 
                      width: '12px', 
                      height: '12px', 
                      backgroundColor: `hsl(${getColorForType(type)}, 60%, 60%)`,
                      borderRadius: '2px',
                      border: '1px solid rgba(0,0,0,0.1)',
                      marginLeft: '6px',
                      marginRight: '6px'
                  }}></span>
                  {type}
                </label>
                <input 
                   type="text"
                   placeholder="Filter"
                   value={typeFilters[type] || ''}
                   onChange={(e) => {
                       const val = e.target.value;
                       setTypeFilters(prev => {
                           const next = {...prev};
                           if (val) next[type] = val;
                           else delete next[type];
                           return next;
                       });
                   }}
                   onClick={(e) => e.stopPropagation()}
                   style={{ width: '60px', padding: '2px', fontSize: '11px', border: '1px solid #ccc', borderRadius: '3px' }}
                />
            </div>
          ))}
          </>
          )}
        </Panel>
      </ReactFlow>
    </div>
  );
}

function App() {
  return (
    <ReactFlowProvider>
      <AppContent />
    </ReactFlowProvider>
  );
}

export default App;
