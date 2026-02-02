import { useEffect, useState, useMemo } from 'react';
import ReactFlow, { Background, Controls, Panel, type Node, type Edge, useNodesState, useEdgesState, MarkerType } from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';
import './App.css';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 350;

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
  
  const NODE_HEIGHT = 50; 
  const PADDING = 20;
  const TITLE_HEIGHT = 40;

  // 2. Layout Internals and Measure Groups
  Object.keys(typeGroups).forEach(type => {
      const { nodes: gNodes, internalEdges: gEdges } = typeGroups[type];
      
      const gGraph = new dagre.graphlib.Graph();
      gGraph.setGraph({ rankdir: 'TB', marginx: 0, marginy: 0 }); 
      gGraph.setDefaultEdgeLabel(() => ({}));

      gNodes.forEach(node => {
          gGraph.setNode(node.id, { width: nodeWidth, height: NODE_HEIGHT });
      });

      gEdges.forEach(edge => {
          gGraph.setEdge(edge.source, edge.target);
      });

      dagre.layout(gGraph);

      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;

      // Handle single node case or empty graph logic implicitly handled by loop
      gNodes.forEach(node => {
          const n = gGraph.node(node.id);
          const x = n.x - (nodeWidth / 2);
          const y = n.y - (NODE_HEIGHT / 2);
          
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x + nodeWidth > maxX) maxX = x + nodeWidth;
          if (y + NODE_HEIGHT > maxY) maxY = y + NODE_HEIGHT;
          
          // Store raw position relative to graph origin
          node.position = { x, y };
      });
      
      // Shift all nodes to be relative to parent group [0,0] + PADDING
      gNodes.forEach(node => {
         node.position.x = node.position.x - minX + PADDING;
         node.position.y = node.position.y - minY + PADDING + TITLE_HEIGHT;
         node.parentNode = type; 
         node.extent = 'parent';
         finalChildNodes.push(node);
      });

      groupDimensions[type] = {
          width: (maxX - minX) + (PADDING * 2),
          height: (maxY - minY) + (PADDING * 2) + TITLE_HEIGHT
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

  const groupNodes: Node[] = [];
  Object.keys(groupDimensions).forEach(type => {
      const g = masterGraph.node(type);
      const hue = getColorForType(type);
      groupNodes.push({
          id: type,
          data: { label: type },
          position: { 
            x: g.x - (groupDimensions[type].width / 2), 
            y: g.y - (groupDimensions[type].height / 2) 
          },
          style: { 
            width: groupDimensions[type].width, 
            height: groupDimensions[type].height,
            backgroundColor: `hsla(${hue}, 70%, 90%, 0.3)`,
            border: `2px dashed hsl(${hue}, 50%, 40%)`,
            borderRadius: '8px',
            fontSize: '20px',
            fontWeight: 'bold',
            color: `hsl(${hue}, 50%, 20%)`,
            // textTransform: 'uppercase', // Removed uppercase
            display: 'flex',
            justifyContent: 'flex-end', // Align to right
            alignItems: 'flex-start', // Align to top
            paddingTop: '10px',
            paddingRight: '20px', // Add right padding
            zIndex: -1,
          }
      });
  });

  return { nodes: [...groupNodes, ...finalChildNodes] };
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
    setIsLoading(true);
    const apiUrl = import.meta.env.DEV ? `http://localhost:3000/api/dependencies/${item.id}` : `/api/dependencies/${item.id}`;
    
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

  useEffect(() => {
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
     
     setVisibleTypes(prevTypes => {
         const nextTypes = new Set(prevTypes);
         nextRawData.forEach((d: any) => {
            if (d.metadataComponentType) nextTypes.add(getEffectiveType(d.metadataComponentType, d.metadataComponentName));
            if (d.refMetadataComponentType) nextTypes.add(getEffectiveType(d.refMetadataComponentType, d.refMetadataComponentName || d.refMetadataComponentComponentName));
         });
         return nextTypes;
     });
  }, [selectedItems, fetchedResults]);




  useEffect(() => {
    if (rawData.length === 0) {
        setNodes([]);
        setEdges([]);
        return;
    }

    const newNodes = new Map<string, Node>();
    const newEdges: Edge[] = [];
    
    rawData.forEach((d: any, index: number) => {
      const sourceType = getEffectiveType(d.metadataComponentType, d.metadataComponentName);
      const targetType = d.refMetadataComponentType
        ? getEffectiveType(d.refMetadataComponentType, d.refMetadataComponentComponentName || d.refMetadataComponentName)
        : null;
      
      const isSourceVisible = visibleTypes.has(sourceType);
      const isTargetVisible = targetType ? visibleTypes.has(targetType) : false;

      // Create Source Node
      if (isSourceVisible && d.metadataComponentId && !newNodes.has(d.metadataComponentId)) {
        newNodes.set(d.metadataComponentId, {
          id: d.metadataComponentId,
          position: { x: 0, y: 0 },
          data: { label: d.metadataComponentName, type: sourceType },
          style: { width: nodeWidth },
        });
      }
      
      // Create Target Node
      if (isTargetVisible && d.refMetadataComponentId && !newNodes.has(d.refMetadataComponentId)) {
        newNodes.set(d.refMetadataComponentId, {
          id: d.refMetadataComponentId,
          position: { x: 0, y: 0 },
          data: { label: d.refMetadataComponentComponentName || d.refMetadataComponentName, type: targetType },
          style: { width: nodeWidth },
        });
      }

      // Create Edge only if both nodes are visible
      if (isSourceVisible && isTargetVisible && d.metadataComponentId && d.refMetadataComponentId) {
        newEdges.push({
          id: `e${d.metadataComponentId}-${d.refMetadataComponentId}-${index}`,
          source: d.metadataComponentId,
          target: d.refMetadataComponentId,
          markerEnd: {
             type: MarkerType.ArrowClosed,
          },
        });
      }
    });

    const { nodes: layoutedNodes } = getGroupedLayoutElements(
      Array.from(newNodes.values()),
      newEdges
    );

    setNodes(layoutedNodes);
    setEdges(newEdges);
  }, [rawData, visibleTypes]);

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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Background />
        <Controls />
        
        <Panel position="top-left" style={{ background: 'white', color: 'black', padding: '10px', borderRadius: '5px', boxShadow: '0 0 10px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', maxHeight: '80vh', maxWidth: '350px' }}>
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
