import { useEffect, useState, useMemo } from 'react';
import ReactFlow, { Background, Controls, Panel, type Node, type Edge, useNodesState, useEdgesState, MarkerType, Handle, Position } from 'reactflow';
import dagre from 'dagre';
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
  const GROUP_PADDING = 30;

  // 2. Layout Internals and Measure Groups
  Object.keys(typeGroups).forEach(type => {
      const { nodes: gNodes, internalEdges: gEdges } = typeGroups[type];

      // Identify connected components within the group
      const adjacency = new Map<string, string[]>();
      gNodes.forEach(n => adjacency.set(n.id, []));
      gEdges.forEach(e => {
         adjacency.get(e.source)?.push(e.target);
         adjacency.get(e.target)?.push(e.source);
      });

      const visited = new Set<string>();
      const componentBlocks: { id: string, width: number, height: number, nodes: Node[], offsetX: number, offsetY: number }[] = [];

      gNodes.forEach(node => {
          if (visited.has(node.id)) return;
          
          // BFS for component
          const componentNodes: Node[] = [];
          const queue = [node];
          visited.add(node.id);
          while(queue.length > 0) {
              const curr = queue.shift()!;
              componentNodes.push(curr);
              adjacency.get(curr.id)?.forEach(nid => {
                  if (!visited.has(nid)) {
                      visited.add(nid);
                      const n = gNodes.find(gn => gn.id === nid);
                      if (n) queue.push(n);
                  }
              });
          }

          // Layout this component
          if (componentNodes.length === 1) {
              const n = componentNodes[0];
              const w = typeof n.style?.width === 'number' ? n.style.width : 50;
              const h = typeof n.style?.height === 'number' ? n.style.height : 50;
              // Reset position relative to block
              n.position = { x: 0, y: 0 }; 
              componentBlocks.push({
                  id: n.id,
                  width: w,
                  height: h,
                  nodes: [n],
                  offsetX: 0,
                  offsetY: 0
              });
          } else {
             // Use Dagre for the component
             const subGraph = new dagre.graphlib.Graph();
             subGraph.setGraph({ rankdir: 'LR', marginx: 0, marginy: 0, nodesep: 15, ranksep: 30 });
             subGraph.setDefaultEdgeLabel(() => ({}));

             componentNodes.forEach(n => {
                const w = typeof n.style?.width === 'number' ? n.style.width : 50;
                const h = typeof n.style?.height === 'number' ? n.style.height : 50;
                subGraph.setNode(n.id, { width: w, height: h });
             });

             const componentNodeIds = new Set(componentNodes.map(n => n.id));
             gEdges.forEach(e => {
                 if (componentNodeIds.has(e.source) && componentNodeIds.has(e.target)) {
                     subGraph.setEdge(e.source, e.target);
                 }
             });

             dagre.layout(subGraph);

             let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
             componentNodes.forEach(n => {
                 const dn = subGraph.node(n.id);
                 const w = dn.width;
                 const h = dn.height;
                 // Dagre gives center coordinates
                 const left = dn.x - w/2;
                 const top = dn.y - h/2;
                 if (left < minX) minX = left;
                 if (top < minY) minY = top;
                 if (left + w > maxX) maxX = left + w;
                 if (top + h > maxY) maxY = top + h;
                 
                 // Store relative to component bounding box
                 n.position = { x: left, y: top }; // Temporary, will shift by minX/minY later
             });

             // Shift nodes to be 0,0 based
             componentNodes.forEach(n => {
                 n.position.x -= minX;
                 n.position.y -= minY;
             });

             componentBlocks.push({
                 id: `comp-${componentNodes[0].id}`,
                 width: maxX - minX,
                 height: maxY - minY,
                 nodes: componentNodes,
                 offsetX: 0,
                 offsetY: 0
             });
          }
      });

      // Pack the component blocks
      // Heuristic: try to make it roughly square
      const totalArea = componentBlocks.reduce((acc, b) => acc + (b.width * b.height), 0);
      const targetWidth = Math.max(200, Math.sqrt(totalArea) * 1.5);

      let currentX = 0;
      let currentY = 0;
      let rowMaxHeight = 0;
      let groupMaxX = 0;
      let groupMaxY = 0;
      const PADDING = 20;

      // Sort blocks by height makes packing slightly cleaner
      componentBlocks.sort((a, b) => b.height - a.height);

      componentBlocks.forEach(block => {
          if (currentX + block.width > targetWidth && currentX > 0) {
              currentX = 0;
              currentY += rowMaxHeight + PADDING;
              rowMaxHeight = 0;
          }

          block.offsetX = currentX;
          block.offsetY = currentY;

          currentX += block.width + PADDING;
          if (block.height > rowMaxHeight) rowMaxHeight = block.height;
          
          if (currentX > groupMaxX) groupMaxX = currentX;
      });
      groupMaxY = currentY + rowMaxHeight;

      // Finalize node positions within the group
      componentBlocks.forEach(block => {
          block.nodes.forEach(node => {
              node.position.x += block.offsetX + GROUP_PADDING;
              node.position.y += block.offsetY + GROUP_PADDING + TITLE_HEIGHT;
          });
      });

      groupDimensions[type] = {
          width: groupMaxX + (GROUP_PADDING * 2),
          height: groupMaxY + (GROUP_PADDING * 2) + TITLE_HEIGHT
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

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [rawData, setRawData] = useState<any[]>([]);
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set());
  
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
      
      const isSourceVisible = visibleTypes.has(sourceType);
      const isTargetVisible = targetType ? visibleTypes.has(targetType) : false;

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
  }, [rawData, visibleTypes]); // Removed showLabels, handled separately

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
            <label key={type} className="legend-item">
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
                  border: '1px solid rgba(0,0,0,0.1)'
              }}></span>
              {type}
            </label>
          ))}
          </>
          )}
        </Panel>
      </ReactFlow>
    </div>
  );
}

export default App;
